package handler

import (
	"log/slog"
	"strings"

	authmw "food_link/backend/internal/auth"
	"food_link/backend/internal/common/handlerlog"

	"github.com/gin-gonic/gin"
)

func logMembershipAPI(c *gin.Context, action string, attrs ...slog.Attr) {
	handlerlog.Log(c, "membership", action, membershipAPILogMessage(action), append([]slog.Attr{
		handlerlog.UserID(c, authmw.ContextUserIDKey),
	}, attrs...)...)
}

func membershipAPILogMessage(action string) string {
	switch action {
	case "payment_create_ok":
		return "会员支付订单创建成功"
	case "payment_sync_ok":
		return "会员支付状态同步完成"
	case "wechat_notify_ok":
		return "微信支付回调处理完成"
	case "xpay_payment_create_ok":
		return "虚拟支付订单创建成功"
	case "share_poster_reward_claim_ok":
		return "分享海报奖励领取完成"
	default:
		return "会员接口处理完成"
	}
}

func membershipMapString(data map[string]any, key string) string {
	if data == nil {
		return ""
	}
	if value, ok := data[key].(string); ok {
		return strings.TrimSpace(value)
	}
	return ""
}

func membershipMapBool(data map[string]any, key string) bool {
	if data == nil {
		return false
	}
	value, _ := data[key].(bool)
	return value
}

func membershipMapInt(data map[string]any, key string) int {
	if data == nil {
		return 0
	}
	switch value := data[key].(type) {
	case int:
		return value
	case int64:
		return int(value)
	case float64:
		return int(value)
	default:
		return 0
	}
}

func membershipMapFloat64(data map[string]any, key string) float64 {
	if data == nil {
		return 0
	}
	switch value := data[key].(type) {
	case float64:
		return value
	case float32:
		return float64(value)
	case int:
		return float64(value)
	case int64:
		return float64(value)
	default:
		return 0
	}
}
