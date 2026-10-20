package app

import (
	campuscatalogservice "food_link/backend/internal/campuscatalog/service"
	"food_link/backend/pkg/config"
)

// captureRewardRules maps the canteen_capture config section onto the reward
// rules. Unset amounts stay zero, which the service treats as "not announced".
func captureRewardRules(cfg config.CanteenCaptureConfig) campuscatalogservice.CaptureRewardRules {
	options := make([]campuscatalogservice.CaptureMembershipOption, 0, len(cfg.MembershipOptions))
	for _, option := range cfg.MembershipOptions {
		options = append(options, campuscatalogservice.CaptureMembershipOption{
			Code: option.Code, Title: option.Title, PlanCode: option.PlanCode, Days: option.Days, CostCents: option.CostCents,
		})
	}
	return campuscatalogservice.CaptureRewardRules{
		WindowCents:        cfg.WindowRewardCents,
		PhotoHalfCents:     cfg.PhotoHalfBonusCents,
		PhotoFullCents:     cfg.PhotoFullBonusCents,
		WithdrawMinCents:   cfg.WithdrawMinCents,
		MembershipOptions:  options,
		DisableAutoPublish: cfg.DisableAutoPublish,
	}
}
