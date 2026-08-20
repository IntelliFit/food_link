package handler

import (
	"strings"

	authmw "food_link/backend/internal/auth"
	"food_link/backend/internal/common/handlerlog"
	"food_link/backend/pkg/logger"

	"github.com/gin-gonic/gin"
	"log/slog"
)

func logFoodRecordAPI(c *gin.Context, action string, attrs ...slog.Attr) {
	handlerlog.Log(c, "food_record", action, foodRecordAPILogMessage(action), append([]slog.Attr{
		handlerlog.UserID(c, authmw.ContextUserIDKey),
	}, attrs...)...)
}

func logFoodRecordAPIError(c *gin.Context, action string, err error, attrs ...slog.Attr) {
	if c == nil || c.Request == nil {
		return
	}
	base := append([]slog.Attr{
		logger.APIAction("food_record", action),
		handlerlog.UserID(c, authmw.ContextUserIDKey),
	}, attrs...)
	logger.Error(c.Request.Context(), "饮食记录接口处理失败", err, base...)
}

func foodRecordAPILogMessage(action string) string {
	switch action {
	case "save":
		return "饮食记录保存请求进入"
	case "save_ok":
		return "饮食记录保存成功"
	case "update_ok":
		return "饮食记录更新成功"
	case "delete_ok":
		return "饮食记录删除成功"
	case "share_ok":
		return "饮食记录分享数据读取成功"
	case "upload_analyze_image_ok":
		return "识别图片上传成功"
	case "upload_analyze_image_file_ok":
		return "识别图片文件上传成功"
	case "packaged_food_create_ok":
		return "包装食品库记录保存成功"
	case "packaged_food_correction_submit":
		return "包装食品纠错提案请求进入"
	case "packaged_food_correction_submit_ok":
		return "包装食品纠错提案提交成功"
	case "packaged_nutrition_label_recognize_ok":
		return "包装食品营养标签识别完成"
	case "packaged_nutrition_label_submit":
		return "包装食品营养标签识别任务请求进入"
	case "packaged_nutrition_label_submit_ok":
		return "包装食品营养标签识别任务已提交"
	case "packaged_product_extract_submit":
		return "包装商品提取任务请求进入"
	case "packaged_product_extract_submit_ok":
		return "包装商品提取任务已提交"
	case "critical_samples_save_ok":
		return "偏差样本保存成功"
	default:
		return "饮食记录接口处理完成"
	}
}

func bindAnalysisTaskID(c *gin.Context, taskID string) {
	taskID = strings.TrimSpace(taskID)
	if taskID == "" {
		return
	}
	c.Set("analysis.task_id", taskID)
}

func taskIDAttr(c *gin.Context) slog.Attr {
	return logger.AnalysisTaskID(strings.TrimSpace(c.GetString("analysis.task_id")))
}
