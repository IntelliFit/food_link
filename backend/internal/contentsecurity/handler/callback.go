package handler

import (
	"bytes"
	"crypto/aes"
	"crypto/cipher"
	"crypto/hmac"
	"crypto/sha1"
	"encoding/base64"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"encoding/xml"
	"io"
	"net/http"
	"sort"
	"strings"

	commonerrors "food_link/backend/internal/common/errors"
	"food_link/backend/internal/common/response"
	"food_link/backend/internal/contentsecurity/service"
	"food_link/backend/pkg/config"
	"github.com/gin-gonic/gin"
)

type Callback struct {
	svc                  *service.Service
	appID, token, aesKey string
}

func NewCallback(svc *service.Service, cfg *config.Config) *Callback {
	token := strings.TrimSpace(cfg.Wechat.ContentSecurity.MessageToken)
	if token == "" {
		token = strings.TrimSpace(cfg.Wechat.XPay.MessageToken)
	}
	return &Callback{svc: svc, appID: cfg.WechatMiniProgramAppID(), token: token, aesKey: cfg.Wechat.ContentSecurity.EncodingAESKey}
}

type mediaEvent struct {
	Event   string `json:"Event" xml:"Event"`
	AppID   string `json:"appid" xml:"appid"`
	Version int    `json:"version" xml:"version"`
	service.APIResponse
}

func (h *Callback) Notify(c *gin.Context) {
	if c.Request.Method == http.MethodGet {
		echo := c.Query("echostr")
		if !signature(h.token, c.Query("timestamp"), c.Query("nonce"), c.Query("signature"), "") {
			response.Error(c, commonerrors.ErrUnauthorized)
			return
		}
		c.String(http.StatusOK, echo)
		return
	}
	if !h.process(c, false) {
		c.String(http.StatusOK, "success")
	}
}

// Intercept preserves the configured XPay URL while routing media events to moderation.
func (h *Callback) Intercept(c *gin.Context) {
	if !h.process(c, true) {
		c.Next()
	}
}

func (h *Callback) process(c *gin.Context, shared bool) bool {
	raw, err := io.ReadAll(io.LimitReader(c.Request.Body, (1<<20)+1))
	if err != nil || len(raw) > 1<<20 {
		response.Error(c, commonerrors.ErrBadRequest)
		c.Abort()
		return true
	}
	c.Request.Body = io.NopCloser(bytes.NewReader(raw))
	var envelope struct {
		Encrypt string `json:"Encrypt" xml:"Encrypt"`
	}
	if decode(raw, &envelope) != nil {
		if shared {
			return false
		}
		response.Error(c, commonerrors.ErrBadRequest)
		return true
	}
	payload := raw
	if envelope.Encrypt != "" {
		if !signature(h.token, c.Query("timestamp"), c.Query("nonce"), c.Query("msg_signature"), envelope.Encrypt) {
			response.Error(c, commonerrors.ErrUnauthorized)
			c.Abort()
			return true
		}
		payload, err = h.decrypt(envelope.Encrypt)
		if err != nil {
			response.Error(c, commonerrors.ErrUnauthorized)
			c.Abort()
			return true
		}
	}
	var event mediaEvent
	if decode(payload, &event) != nil {
		response.Error(c, commonerrors.ErrBadRequest)
		c.Abort()
		return true
	}
	if event.Event != "wxa_media_check" {
		return false
	}
	if envelope.Encrypt == "" && !signature(h.token, c.Query("timestamp"), c.Query("nonce"), c.Query("signature"), "") {
		response.Error(c, commonerrors.ErrUnauthorized)
		c.Abort()
		return true
	}
	if event.AppID != h.appID || event.Version != 2 {
		response.Error(c, commonerrors.ErrUnauthorized)
		c.Abort()
		return true
	}
	if err := h.svc.RecordMediaResult(c.Request.Context(), event.APIResponse); err != nil {
		response.Error(c, err)
		c.Abort()
		return true
	}
	c.String(http.StatusOK, "success")
	c.Abort()
	return true
}

func signature(token, timestamp, nonce, supplied, encrypted string) bool {
	if token == "" || timestamp == "" || nonce == "" || supplied == "" {
		return false
	}
	parts := []string{token, timestamp, nonce}
	if encrypted != "" {
		parts = append(parts, encrypted)
	}
	sort.Strings(parts)
	sum := sha1.Sum([]byte(strings.Join(parts, "")))
	return hmac.Equal([]byte(hex.EncodeToString(sum[:])), []byte(strings.ToLower(supplied)))
}

func decode(raw []byte, value any) error {
	if bytes.HasPrefix(bytes.TrimSpace(raw), []byte("<")) {
		return xml.Unmarshal(raw, value)
	}
	return json.Unmarshal(raw, value)
}

func (h *Callback) decrypt(encoded string) ([]byte, error) {
	key, err := base64.StdEncoding.DecodeString(strings.TrimRight(h.aesKey, "=") + "=")
	if err != nil || len(key) != 32 {
		return nil, commonerrors.ErrUnauthorized
	}
	ciphertext, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil || len(ciphertext) == 0 || len(ciphertext)%aes.BlockSize != 0 {
		return nil, commonerrors.ErrUnauthorized
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, commonerrors.ErrUnauthorized
	}
	plain := make([]byte, len(ciphertext))
	cipher.NewCBCDecrypter(block, key[:aes.BlockSize]).CryptBlocks(plain, ciphertext)
	padding := int(plain[len(plain)-1])
	if padding < 1 || padding > 32 || padding > len(plain) {
		return nil, commonerrors.ErrUnauthorized
	}
	for _, b := range plain[len(plain)-padding:] {
		if int(b) != padding {
			return nil, commonerrors.ErrUnauthorized
		}
	}
	plain = plain[:len(plain)-padding]
	if len(plain) < 20 {
		return nil, commonerrors.ErrUnauthorized
	}
	length := int(binary.BigEndian.Uint32(plain[16:20]))
	if length > len(plain)-20 || string(plain[20+length:]) != h.appID {
		return nil, commonerrors.ErrUnauthorized
	}
	return plain[20 : 20+length], nil
}
