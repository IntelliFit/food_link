package domain

import (
	"time"

	"food_link/backend/internal/migration/do"
)

// AutoReviewVersion is written to reviewed_by and auto_review.version so
// samples decided by different pipeline rules can be told apart later.
const AutoReviewVersion = "auto:v1"

const (
	ReviewModeManual = "manual"
	ReviewModeAuto   = "auto"

	// DailyRewardedLimit caps how many automatically approved samples earn
	// credits per contributor per 24 hours; later ones are kept unpaid.
	DailyRewardedLimit = 10
	// EvalPhotoMaxAge flags evaluation photos taken long before submission.
	EvalPhotoMaxAge = 48 * time.Hour
	// MinItemNetGrams is the smallest plausible weighed portion.
	MinItemNetGrams = 5.0
	// MaxAutoReviewAttempts stops retrying a sample that keeps failing; it
	// then waits for an administrator.
	MaxAutoReviewAttempts = 6
	// ReadingGiveUpAfter is how long a model outage keeps a sample pending
	// before its unreadable photos are graded as unreadable.
	ReadingGiveUpAfter = 24 * time.Hour
)

// Per-photo reading outcomes, from strongest to weakest evidence.
const (
	ReadingAgreeMatch        = "agree_match"        // two models read it and both match the typed value
	ReadingSingleMatch       = "single_match"       // one model read it and it matches
	ReadingSplit             = "split"              // one model matches, the other read something else
	ReadingMismatchConfirmed = "mismatch_confirmed" // two models agree with each other, not with the typed value
	ReadingMismatch          = "mismatch"           // the readable reading differs, unconfirmed
	ReadingUnreadable        = "unreadable"         // no model could read the display
	ReadingLibrary           = "library"            // saved container photo without a stored reading
)

// Check statuses.
const (
	CheckPass = "pass"
	CheckFlag = "flag"
	CheckFail = "fail"
)

// Decision actions.
const (
	DecisionApprove = "approve"
	DecisionReject  = "reject"
)

type ScaleReading = do.ResearchWeightScaleReading
type PhotoCheck = do.ResearchWeightPhotoCheckDO
type AutoReview = do.ResearchWeightAutoReview
type AutoCheck = do.ResearchWeightAutoCheck

// ScaleReadView is what the mini program gets after a scale photo is read.
type ScaleReadView struct {
	Readable bool     `json:"readable"`
	Grams    *float64 `json:"grams,omitempty"`
	RawValue string   `json:"raw_value,omitempty"`
	Unit     string   `json:"unit,omitempty"`
	// ResolutionGrams is the display step, so the client compares typed
	// values with the same tolerance as the server.
	ResolutionGrams float64 `json:"resolution_grams,omitempty"`
	Agreement       string  `json:"agreement"`
	Message         string  `json:"message,omitempty"`
}

// Reading agreements returned to the mini program.
const (
	AgreementAgree      = "agree"
	AgreementSingle     = "single"
	AgreementDisagree   = "disagree"
	AgreementUnreadable = "unreadable"
)
