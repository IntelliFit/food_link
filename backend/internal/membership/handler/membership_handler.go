package handler

import (
	"context"
	"encoding/xml"
	"io"
	"log/slog"
	"net/http"
	"strings"

	authmw "food_link/backend/internal/auth"
	commonerrors "food_link/backend/internal/common/errors"
	"food_link/backend/internal/common/response"
	"food_link/backend/internal/membership/service"
	"food_link/backend/pkg/logger"

	"github.com/gin-gonic/gin"
)

const wechatPapayNotifyMaxBodyBytes = 1 << 20

type MembershipService interface {
	ListPlans(ctx context.Context, userID string) ([]map[string]any, error)
	GetMyMembership(ctx context.Context, userID string, date string) (map[string]any, error)
	GetRewardCenter(ctx context.Context, userID string) (map[string]any, error)
	CreatePaymentWithInput(ctx context.Context, userID string, input service.CreateMembershipPaymentInput) (map[string]any, error)
	SyncWechatPayment(ctx context.Context, userID, orderNo string) (map[string]any, error)
	WechatNotify(ctx context.Context, paymentID string) error
	HandleWechatNotify(ctx context.Context, headers http.Header, body []byte) (map[string]any, error)
	ClaimSharePosterReward(ctx context.Context, userID string, input service.SharePosterRewardClaimInput) (map[string]any, error)
}

type MembershipHandler struct {
	svc MembershipService
}

func NewMembershipHandler(svc MembershipService) *MembershipHandler {
	return &MembershipHandler{svc: svc}
}

// GET /api/membership/plans
func (h *MembershipHandler) ListPlans(c *gin.Context) {
	userID := c.GetString(authmw.ContextUserIDKey)
	data, err := h.svc.ListPlans(c.Request.Context(), userID)
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, map[string]any{"list": data})
}

// GET /api/membership/me
func (h *MembershipHandler) GetMyMembership(c *gin.Context) {
	userID := c.GetString(authmw.ContextUserIDKey)
	if userID == "" {
		response.Error(c, commonerrors.ErrUnauthorized)
		return
	}
	date := strings.TrimSpace(c.Query("date"))
	data, err := h.svc.GetMyMembership(c.Request.Context(), userID, date)
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, data)
}

// GET /api/membership/reward-center
func (h *MembershipHandler) GetRewardCenter(c *gin.Context) {
	userID := c.GetString(authmw.ContextUserIDKey)
	if userID == "" {
		response.Error(c, commonerrors.ErrUnauthorized)
		return
	}
	data, err := h.svc.GetRewardCenter(c.Request.Context(), userID)
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, data)
}

// POST /api/membership/pay/create
func (h *MembershipHandler) CreatePayment(c *gin.Context) {
	var body struct {
		PlanCode   string `json:"plan_code"`
		PlanID     string `json:"plan_id"`
		PayChannel string `json:"pay_channel"`
		TradeType  string `json:"trade_type"`
		Client     string `json:"client"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		response.Error(c, err)
		return
	}
	planCode := body.PlanCode
	if planCode == "" {
		planCode = body.PlanID
	}
	if planCode == "" {
		response.Error(c, &commonerrors.AppError{Code: 10002, Message: "plan_code required", HTTPStatus: 400})
		return
	}
	userID := c.GetString(authmw.ContextUserIDKey)
	if userID == "" {
		response.Error(c, commonerrors.ErrUnauthorized)
		return
	}
	client := strings.TrimSpace(body.Client)
	if client == "" {
		client = membershipPaymentClientFromRequest(c.Request)
	}
	data, err := h.svc.CreatePaymentWithInput(c.Request.Context(), userID, service.CreateMembershipPaymentInput{
		PlanCode:   planCode,
		PayChannel: body.PayChannel,
		TradeType:  body.TradeType,
		Client:     client,
	})
	if err != nil {
		response.Error(c, err)
		return
	}
	logMembershipAPI(c, "payment_create_ok",
		slog.String("plan_code", planCode),
		slog.String("order_no", membershipMapString(data, "order_no")),
		slog.String("pay_channel", membershipMapString(data, "pay_channel")),
		slog.String("trade_type", membershipMapString(data, "trade_type")),
		slog.Float64("amount", membershipMapFloat64(data, "amount")),
		slog.String("order_mode", membershipMapString(data, "order_mode")),
	)
	response.Success(c, data)
}

func membershipPaymentClientFromRequest(req *http.Request) string {
	if req == nil {
		return ""
	}
	for _, name := range []string{"X-Food-Link-Client", "X-Client-Platform", "X-App-Client"} {
		value := strings.ToLower(strings.TrimSpace(req.Header.Get(name)))
		switch value {
		case "mobile_app", "app", "android", "ios":
			return "mobile_app"
		}
	}
	return ""
}

// POST /api/membership/pay/sync
func (h *MembershipHandler) SyncPayment(c *gin.Context) {
	var body struct {
		OrderNo string `json:"order_no"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		response.Error(c, err)
		return
	}
	userID := c.GetString(authmw.ContextUserIDKey)
	if userID == "" {
		response.Error(c, commonerrors.ErrUnauthorized)
		return
	}
	data, err := h.svc.SyncWechatPayment(c.Request.Context(), userID, body.OrderNo)
	if err != nil {
		response.Error(c, err)
		return
	}
	logMembershipAPI(c, "payment_sync_ok",
		slog.String("order_no", strings.TrimSpace(body.OrderNo)),
		slog.Bool("payment.synced", membershipMapBool(data, "synced")),
		slog.String("payment.status", membershipMapString(data, "status")),
		slog.String("wechat.trade_state", membershipMapString(data, "trade_state")),
	)
	response.Success(c, data)
}

// POST /api/payment/wechat/notify/membership
func (h *MembershipHandler) WechatNotify(c *gin.Context) {
	body, err := io.ReadAll(c.Request.Body)
	if err != nil {
		response.Error(c, err)
		return
	}
	data, err := h.svc.HandleWechatNotify(c.Request.Context(), c.Request.Header, body)
	if err != nil {
		response.Error(c, err)
		return
	}
	logMembershipAPI(c, "wechat_notify_ok",
		slog.Int("http.request.body.size", len(body)),
		slog.String("wechat.notify.code", membershipMapString(data, "code")),
	)
	response.Raw(c, http.StatusOK, data)
}

// POST /api/payment/wechat/papay/contract/terminate-notify
func (h *MembershipHandler) PapayContractTerminateNotify(c *gin.Context) {
	body, err := readLimitedNotifyBody(c.Request.Body, wechatPapayNotifyMaxBodyBytes)
	if err != nil {
		logger.Warn(c.Request.Context(), "微信委托代扣解约通知读取失败", logger.Err(err))
		writeWechatPapayXML(c, "FAIL", "读取通知失败")
		return
	}

	notice, parseErr := parsePapayContractNotice(body)
	attrs := []slog.Attr{
		slog.Int("http.request.body.size", len(body)),
		slog.String("wechat.app_id", notice.AppID),
		slog.String("wechat.mch_id", notice.MchID),
		slog.String("wechat.contract_id", notice.ContractID),
		slog.String("wechat.contract_code", notice.ContractCode),
		slog.String("wechat.plan_id", notice.PlanID),
		slog.String("wechat.change_type", notice.ChangeType),
		slog.String("wechat.return_code", notice.ReturnCode),
		slog.String("wechat.result_code", notice.ResultCode),
	}
	if parseErr != nil {
		logger.Warn(c.Request.Context(), "微信委托代扣解约通知 XML 解析失败，占位接口仍返回成功",
			append(attrs, logger.Err(parseErr))...,
		)
	} else {
		logger.Info(c.Request.Context(), "收到微信委托代扣解约通知，占位接口已应答成功", attrs...)
	}

	writeWechatPapayXML(c, "SUCCESS", "OK")
}

// POST /api/membership/rewards/share-poster/claim
func (h *MembershipHandler) ClaimSharePosterReward(c *gin.Context) {
	var body service.SharePosterRewardClaimInput
	if err := c.ShouldBindJSON(&body); err != nil {
		response.Error(c, err)
		return
	}
	userID := c.GetString(authmw.ContextUserIDKey)
	if userID == "" {
		response.Error(c, commonerrors.ErrUnauthorized)
		return
	}
	data, err := h.svc.ClaimSharePosterReward(c.Request.Context(), userID, body)
	if err != nil {
		response.Error(c, err)
		return
	}
	logMembershipAPI(c, "share_poster_reward_claim_ok",
		slog.String("record_id", strings.TrimSpace(body.RecordID)),
		slog.String("share_scope", strings.TrimSpace(body.ShareScope)),
		slog.Bool("reward.claimed", membershipMapBool(data, "claimed")),
		slog.Bool("reward.already_claimed", membershipMapBool(data, "already_claimed")),
		slog.Bool("reward.daily_cap_reached", membershipMapBool(data, "daily_cap_reached")),
		slog.Int("reward.credits", membershipMapInt(data, "credits")),
	)
	response.Success(c, data)
}

type papayContractNotice struct {
	XMLName      xml.Name `xml:"xml"`
	ReturnCode   string   `xml:"return_code"`
	ReturnMsg    string   `xml:"return_msg"`
	ResultCode   string   `xml:"result_code"`
	ErrCode      string   `xml:"err_code"`
	ErrCodeDes   string   `xml:"err_code_des"`
	AppID        string   `xml:"appid"`
	MchID        string   `xml:"mch_id"`
	OpenID       string   `xml:"openid"`
	ContractID   string   `xml:"contract_id"`
	ContractCode string   `xml:"contract_code"`
	PlanID       string   `xml:"plan_id"`
	ChangeType   string   `xml:"change_type"`
	OperateTime  string   `xml:"operate_time"`
}

func parsePapayContractNotice(body []byte) (papayContractNotice, error) {
	var notice papayContractNotice
	if len(strings.TrimSpace(string(body))) == 0 {
		return notice, nil
	}
	err := xml.Unmarshal(body, &notice)
	return notice, err
}

func readLimitedNotifyBody(body io.Reader, maxBytes int64) ([]byte, error) {
	limited := io.LimitReader(body, maxBytes+1)
	data, err := io.ReadAll(limited)
	if err != nil {
		return nil, err
	}
	if int64(len(data)) > maxBytes {
		return nil, &commonerrors.AppError{Code: 10002, Message: "notify body too large", HTTPStatus: http.StatusRequestEntityTooLarge}
	}
	return data, nil
}

func writeWechatPapayXML(c *gin.Context, returnCode, returnMsg string) {
	payload := []byte("<xml><return_code><![CDATA[" + returnCode + "]]></return_code><return_msg><![CDATA[" + returnMsg + "]]></return_msg></xml>")
	c.Data(http.StatusOK, "application/xml; charset=utf-8", payload)
}
