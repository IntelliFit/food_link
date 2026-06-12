package domain

// FeedbackType 定义 analysis_feedback_samples 表中 feedback_type 的合法取值。
const (
	FeedbackTypeCorrection        = "correction"
	FeedbackTypeRetry             = "retry"
	FeedbackTypeManualEntry       = "manual_entry"
	FeedbackTypeFailed            = "failed"
	FeedbackTypeWeightMismatch    = "weight_mismatch"
	FeedbackTypeNutritionMismatch = "nutrition_mismatch"
	FeedbackTypeSuspectDistrust   = "suspect_distrust"
	FeedbackTypeRecordCorrected   = "record_corrected"
)

// ResolutionState 定义 analysis_feedback_samples 表中 resolution_state 的合法取值。
// 用于区分一条反馈样本是“用户纠正后已接受”还是“用户仍然不信任当前识别结果”。
const (
	ResolutionStateUserCorrected = "user_corrected"
	ResolutionStateStillDistrust = "still_distrust"
)

// IsLegacyCorrectionFeedback 返回 feedback_type 是否属于旧的 correction 任务自动采集类型。
// 这类 feedback 仍按 correction_task_id 做幂等冲突键。
func IsLegacyCorrectionFeedback(feedbackType string) bool {
	return feedbackType == FeedbackTypeCorrection || feedbackType == FeedbackTypeFailed
}

// IsValidFeedbackType 校验 feedback_type 取值是否合法。
func IsValidFeedbackType(feedbackType string) bool {
	switch feedbackType {
	case FeedbackTypeCorrection,
		FeedbackTypeRetry,
		FeedbackTypeManualEntry,
		FeedbackTypeFailed,
		FeedbackTypeWeightMismatch,
		FeedbackTypeNutritionMismatch,
		FeedbackTypeSuspectDistrust,
		FeedbackTypeRecordCorrected:
		return true
	}
	return false
}

// IsValidResolutionState 校验 resolution_state 取值是否合法。
func IsValidResolutionState(state string) bool {
	switch state {
	case ResolutionStateUserCorrected, ResolutionStateStillDistrust:
		return true
	}
	return false
}
