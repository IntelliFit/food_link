package wechatpay

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"strconv"
	"time"
)

// MiniProgramPayParams represents the parameters needed to invoke WeChat Pay in mini program.
type MiniProgramPayParams struct {
	AppID     string `json:"appId"`
	TimeStamp string `json:"timeStamp"`
	NonceStr  string `json:"nonceStr"`
	Package   string `json:"package"`
	SignType  string `json:"signType"`
	PaySign   string `json:"paySign"`
}

// BuildMiniProgramPayParams builds the parameters for mini program to invoke WeChat Pay.
func BuildMiniProgramPayParams(appID, prepayID, privateKeyPEM string) (*MiniProgramPayParams, error) {
	timeStamp := strconv.FormatInt(time.Now().Unix(), 10)
	nonceBytes := make([]byte, 16)
	if _, err := rand.Read(nonceBytes); err != nil {
		return nil, err
	}
	nonceStr := hex.EncodeToString(nonceBytes)
	packageValue := fmt.Sprintf("prepay_id=%s", prepayID)

	message := fmt.Sprintf("%s\n%s\n%s\n%s\n", appID, timeStamp, nonceStr, packageValue)
	paySign, err := SignRSA256(message, privateKeyPEM)
	if err != nil {
		return nil, fmt.Errorf("sign pay params: %w", err)
	}

	return &MiniProgramPayParams{
		AppID:     appID,
		TimeStamp: timeStamp,
		NonceStr:  nonceStr,
		Package:   packageValue,
		SignType:  "RSA",
		PaySign:   paySign,
	}, nil
}
