package service

import (
	"fmt"
	"time"

	"food_link/backend/internal/researchweight/domain"
)

// ReviewEvidence is what the server knows about a sample beyond the sample
// itself, all collected by the server (never sent by the client).
type ReviewEvidence struct {
	// Readings by photo object key, as the reading models saw them.
	Readings map[string][]domain.ScaleReading
	// Duplicates holds this sample's photo keys whose bytes match another
	// upload that backs someone else's (or an earlier) sample.
	Duplicates map[string]bool
	// EvalShowsScale holds evaluation photo keys where a readable scale
	// display is visible, which would let a model read the answer.
	EvalShowsScale map[string]bool
	// RewardedToday counts the contributor's paid samples in the last 24h.
	RewardedToday int64
	Now           time.Time
}

const (
	tierA = "A"
	tierB = "B"
	tierC = "C"
)

// tierRank orders tiers so a check can only lower the result.
var tierRank = map[string]int{tierA: 0, tierB: 1, tierC: 2}

type autoDecision struct {
	review     domain.AutoReview
	reject     bool
	rejectNote string
	downNote   string
}

func (d *autoDecision) add(check domain.AutoCheck) {
	d.review.Checks = append(d.review.Checks, check)
}

// lower records a check that caps the tier, keeping the first reason that
// set the final tier as the note for the contributor.
func (d *autoDecision) lower(tier string, check domain.AutoCheck, note string) {
	d.add(check)
	if tierRank[tier] > tierRank[d.review.Tier] {
		d.review.Tier = tier
		d.downNote = note
	}
}

func (d *autoDecision) fail(check domain.AutoCheck, note string) {
	d.add(check)
	if !d.reject {
		d.reject, d.rejectNote = true, note
	}
}

// DecideAutoReview grades a pending sample from its server-side evidence.
// Plausibility never uses model estimates of the food: rejecting weights
// the model disagrees with would bias the benchmark towards easy dishes.
func DecideAutoReview(sample *domain.Sample, ev ReviewEvidence) domain.AutoReview {
	d := &autoDecision{review: domain.AutoReview{Version: domain.AutoReviewVersion, Tier: tierA, Checks: []domain.AutoCheck{}}}
	checkReadings(d, sample, ev)
	checkEvalPhotos(d, sample, ev)
	checkDuplicates(d, sample, ev)
	checkPlausibility(d, sample)
	for _, flag := range sampleFlags(sample) {
		d.lower(tierB, domain.AutoCheck{Name: "flag", Status: domain.CheckFlag, Detail: flag}, "空盒照片早于饭菜照片")
	}
	d.review.DecidedAt = ev.Now.UTC().Format(time.RFC3339)
	if d.reject {
		d.review.Decision, d.review.Tier, d.review.Credits = domain.DecisionReject, "", 0
		d.review.Note = d.rejectNote
		return d.review
	}
	d.review.Decision = domain.DecisionApprove
	d.review.Credits = autoCredits(sample, d.review.Tier)
	d.review.Note = approvalNote(d.review.Tier, d.downNote)
	if d.review.Credits > 0 && ev.RewardedToday >= domain.DailyRewardedLimit {
		d.add(domain.AutoCheck{Name: "daily_reward_cap", Status: domain.CheckFlag, Detail: fmt.Sprintf("%d", ev.RewardedToday)})
		d.review.Credits = 0
		d.review.Note += fmt.Sprintf("；今天已有%d条计分，这条不再计分", ev.RewardedToday)
	}
	return d.review
}

func autoCredits(sample *domain.Sample, tier string) int {
	if tier == tierC {
		return 0
	}
	return DefaultRewardCredits(sample)
}

func approvalNote(tier, reason string) string {
	switch tier {
	case tierA:
		return "自动审核通过（A 级）"
	case tierB:
		return fmt.Sprintf("自动审核通过（B 级）：%s", reason)
	}
	return fmt.Sprintf("已收录（C 级，不计分）：%s", reason)
}

func checkReadings(d *autoDecision, sample *domain.Sample, ev ReviewEvidence) {
	for _, photo := range sample.Photos {
		expected, ok := expectedReading(sample, photo)
		if !ok {
			continue
		}
		status := classifyReading(ev.Readings[photo.ObjectKey], expected, sample.ScalePrecisionGrams, photo.Source == domain.PhotoSourceLibrary)
		check := domain.AutoCheck{Name: "reading", Status: domain.CheckPass, Detail: status, PhotoRole: photo.Role, ItemIndex: photo.ItemIndex}
		where := readingLabel(photo)
		switch status {
		case domain.ReadingAgreeMatch:
			d.add(check)
		case domain.ReadingSingleMatch:
			check.Status = domain.CheckFlag
			d.lower(tierB, check, where+"只有一个模型读出读数")
		case domain.ReadingSplit:
			check.Status = domain.CheckFlag
			d.lower(tierB, check, where+"两个模型读数不一致")
		case domain.ReadingLibrary:
			check.Status = domain.CheckFlag
			d.lower(tierB, check, where+"用了常用容器的重量")
		case domain.ReadingUnreadable:
			check.Status = domain.CheckFlag
			d.lower(tierC, check, where+"秤上的数字没能自动读出")
		case domain.ReadingMismatch:
			check.Status = domain.CheckFlag
			d.lower(tierC, check, where+"填写的读数和照片对不上")
		case domain.ReadingMismatchConfirmed:
			check.Status = domain.CheckFail
			d.fail(check, where+"填写的读数和照片里秤上的数字不一致，请重拍或改正后再提交")
		}
	}
}

// expectedReading is the typed value a scale photo must show.
func expectedReading(sample *domain.Sample, photo domain.Photo) (float64, bool) {
	item := func() (*domain.Item, bool) {
		if photo.ItemIndex == nil || *photo.ItemIndex < 0 || *photo.ItemIndex >= len(sample.Items) {
			return nil, false
		}
		return &sample.Items[*photo.ItemIndex], true
	}
	switch photo.Role {
	case domain.RoleTareScale:
		return sample.TareGrams, true
	case domain.RoleGrossScale:
		if sample.GrossReadingGrams == nil {
			return 0, false
		}
		return *sample.GrossReadingGrams, true
	case domain.RoleItemScale:
		if it, ok := item(); ok {
			return it.CumulativeReadingGrams, true
		}
	case domain.RoleContainerGross:
		if it, ok := item(); ok && it.GrossReadingGrams != nil {
			return *it.GrossReadingGrams, true
		}
	case domain.RoleContainerTare:
		if it, ok := item(); ok && it.TareGrams != nil {
			return *it.TareGrams, true
		}
	}
	return 0, false
}

func classifyReading(readings []domain.ScaleReading, expected, precision float64, library bool) string {
	if library && len(readings) == 0 {
		return domain.ReadingLibrary
	}
	readable := make([]domain.ScaleReading, 0, len(readings))
	for _, reading := range readings {
		if reading.Readable && reading.Grams != nil {
			readable = append(readable, reading)
		}
	}
	matches := 0
	for _, reading := range readable {
		if readingMatches(reading, expected, precision) {
			matches++
		}
	}
	switch {
	case len(readable) == 0:
		return domain.ReadingUnreadable
	case len(readable) == 1 && matches == 1:
		return domain.ReadingSingleMatch
	case len(readable) == 1:
		return domain.ReadingMismatch
	case matches == len(readable):
		return domain.ReadingAgreeMatch
	case matches > 0:
		return domain.ReadingSplit
	}
	if agreement, _ := ReadingAgreement(readable, precision); agreement == domain.AgreementAgree {
		return domain.ReadingMismatchConfirmed
	}
	return domain.ReadingMismatch
}

func readingLabel(photo domain.Photo) string {
	index := 0
	if photo.ItemIndex != nil {
		index = *photo.ItemIndex + 1
	}
	switch photo.Role {
	case domain.RoleTareScale:
		return "空容器读数"
	case domain.RoleGrossScale:
		return "总读数"
	case domain.RoleItemScale:
		return fmt.Sprintf("第%d项读数", index)
	case domain.RoleContainerGross:
		return fmt.Sprintf("第%d盒连盒读数", index)
	case domain.RoleContainerTare:
		return fmt.Sprintf("第%d盒空盒读数", index)
	}
	return "读数"
}

func isEvalRole(role string) bool {
	switch role {
	case domain.RoleEvalTop, domain.RoleEvalAngle, domain.RoleEvalTopRef, domain.RoleEvalAngleRef:
		return true
	}
	return false
}

func checkEvalPhotos(d *autoDecision, sample *domain.Sample, ev ReviewEvidence) {
	submitted := ev.Now
	if sample.CreatedAt != nil {
		submitted = *sample.CreatedAt
	}
	for _, photo := range sample.Photos {
		if !isEvalRole(photo.Role) {
			continue
		}
		check := domain.AutoCheck{Name: "eval_photo", Status: domain.CheckFlag, PhotoRole: photo.Role}
		if ev.EvalShowsScale[photo.ObjectKey] {
			check.Detail = "shows_scale_display"
			d.lower(tierC, check, "饭菜照片里能看到秤的读数")
			continue
		}
		switch photo.Source {
		case "album":
			check.Detail = "album"
			d.lower(tierC, check, "饭菜照片来自相册")
			continue
		case "":
			check.Detail = "unknown_source"
			d.lower(tierB, check, "饭菜照片来源未知")
			continue
		}
		if at, err := time.Parse(time.RFC3339, photo.CapturedAt); err == nil && submitted.Sub(at) > domain.EvalPhotoMaxAge {
			check.Detail = "stale"
			d.lower(tierB, check, "饭菜照片拍摄时间早于提交两天以上")
			continue
		}
		check.Status = domain.CheckPass
		d.add(check)
	}
}

func checkDuplicates(d *autoDecision, sample *domain.Sample, ev ReviewEvidence) {
	for _, photo := range sample.Photos {
		if ev.Duplicates[photo.ObjectKey] {
			d.fail(domain.AutoCheck{Name: "duplicate_photo", Status: domain.CheckFail, PhotoRole: photo.Role, ItemIndex: photo.ItemIndex},
				"有照片和已提交过的照片完全相同，请重新拍摄")
		}
	}
}

// checkPlausibility only looks at physical limits of the weighed food itself.
func checkPlausibility(d *autoDecision, sample *domain.Sample) {
	if len(sample.Items) == 0 {
		if sample.TotalNetGrams < domain.MinItemNetGrams {
			d.lower(tierB, domain.AutoCheck{Name: "net_too_small", Status: domain.CheckFlag, Detail: fmt.Sprintf("%.1f", sample.TotalNetGrams)}, "净重过小")
		}
		return
	}
	for index, item := range sample.Items {
		if item.Grams < domain.MinItemNetGrams {
			itemIndex := index
			d.lower(tierB, domain.AutoCheck{Name: "net_too_small", Status: domain.CheckFlag, Detail: fmt.Sprintf("%.1f", item.Grams), ItemIndex: &itemIndex},
				fmt.Sprintf("第%d项净重过小", index+1))
		}
	}
}
