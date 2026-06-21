package handler

import (
	"log/slog"

	authmw "food_link/backend/internal/auth"
	"food_link/backend/internal/common/handlerlog"
	"food_link/backend/internal/user/service"

	"github.com/gin-gonic/gin"
)

func logUserAPI(c *gin.Context, action string, attrs ...slog.Attr) {
	handlerlog.Log(c, "user", action, userAPILogMessage(action), append([]slog.Attr{
		handlerlog.UserID(c, authmw.ContextUserIDKey),
	}, attrs...)...)
}

func userAPILogMessage(action string) string {
	switch action {
	case "profile_update_ok":
		return "用户资料更新成功"
	case "bind_phone_ok":
		return "手机号绑定成功"
	case "avatar_upload_ok":
		return "用户头像上传成功"
	case "dashboard_targets_update_ok":
		return "首页营养目标更新成功"
	case "health_profile_update_ok":
		return "健康档案更新成功"
	case "health_report_ocr_ok":
		return "健康报告图片识别完成"
	case "health_report_ocr_extract_ok":
		return "健康报告提取完成"
	case "health_report_task_submit_ok":
		return "健康报告提取任务已提交"
	case "cover_image_upload_ok":
		return "个人主页封面上传成功"
	case "health_report_image_upload_ok":
		return "健康报告图片上传成功"
	case "last_seen_analyze_history_update_ok":
		return "识别记录已读时间更新成功"
	case "health_disclaimer_ack_ok":
		return "健康免责声明确认成功"
	case "delete_account_ok":
		return "账号注销成功"
	case "health_focuses_update_ok":
		return "健康关注列表更新成功"
	case "health_focus_add_ok":
		return "健康关注添加成功"
	case "health_focus_remove_ok":
		return "健康关注删除成功"
	default:
		return "用户接口处理完成"
	}
}

func updateProfileFieldCount(input service.UpdateProfileInput) int {
	count := 0
	if input.Nickname != nil {
		count++
	}
	if input.Avatar != nil {
		count++
	}
	if input.CoverImage != nil {
		count++
	}
	if input.Telephone != nil {
		count++
	}
	if input.Searchable != nil {
		count++
	}
	if input.PublicRecords != nil {
		count++
	}
	if input.Motto != nil {
		count++
	}
	return count
}

func updateHealthProfileFieldCount(input service.UpdateHealthProfileInput) int {
	count := 0
	if input.Gender != nil {
		count++
	}
	if input.Birthday != nil {
		count++
	}
	if input.Height != nil {
		count++
	}
	if input.Weight != nil {
		count++
	}
	if input.ActivityLevel != nil {
		count++
	}
	if input.DailyLifeActivityLevel != nil {
		count++
	}
	if input.DietGoal != nil {
		count++
	}
	if input.ExecutionMode != nil {
		count++
	}
	if input.ModeSetBy != nil {
		count++
	}
	if input.ModeReason != nil {
		count++
	}
	if input.MedicalHistory != nil {
		count++
	}
	if input.DietPreference != nil {
		count++
	}
	if input.Allergies != nil {
		count++
	}
	if input.HealthNotes != nil {
		count++
	}
	if input.RoutineType != nil {
		count++
	}
	if input.RoutineSleepHour != nil {
		count++
	}
	if input.RoutineWakeHour != nil {
		count++
	}
	if input.DashboardTargets != nil {
		count++
	}
	if len(input.ReportExtract) > 0 {
		count++
	}
	if input.ReportImageURL != nil {
		count++
	}
	if input.PrecisionReferenceDefaults != nil {
		count++
	}
	return count
}

func stringListCount(values *service.StringList) int {
	if values == nil {
		return 0
	}
	return len(*values)
}

func dashboardTargetCount(input *service.UpdateDashboardTargetsInput) int {
	if input == nil {
		return 0
	}
	return 4 + len(input.MicroTargets)
}
