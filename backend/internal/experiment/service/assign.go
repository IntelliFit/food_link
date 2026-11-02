package service

import (
	"crypto/sha256"
	"encoding/binary"
	"fmt"
	"regexp"

	"food_link/backend/internal/experiment/domain"
)

const bucketCount = 10000

var (
	experimentKeyPattern = regexp.MustCompile(`^[a-z][a-z0-9_]{2,63}$`)
	variantKeyPattern    = regexp.MustCompile(`^[a-z][a-z0-9_]{0,31}$`)
	anonIDPattern        = regexp.MustCompile(`^[A-Za-z0-9_-]{8,128}$`)
	eventNamePattern     = regexp.MustCompile(`^[a-z][a-z0-9_.]{1,63}$`)
)

// Bucket maps a unit to a stable slot in [0, bucketCount). The salt lets two
// experiments split the same visitors independently.
func Bucket(salt, unit string) int {
	sum := sha256.Sum256([]byte(salt + ":" + unit))
	return int(binary.BigEndian.Uint64(sum[:8]) % bucketCount)
}

// PickVariant walks the cumulative weights. A zero total falls back to the
// control so a misconfigured test never breaks the page.
func PickVariant(variants []domain.Variant, bucket int) string {
	if len(variants) == 0 {
		return ""
	}
	total := 0
	for _, v := range variants {
		total += v.Weight
	}
	if total <= 0 {
		return variants[0].Key
	}
	point := bucket * total / bucketCount
	acc := 0
	for _, v := range variants {
		acc += v.Weight
		if point < acc {
			return v.Key
		}
	}
	return variants[len(variants)-1].Key
}

// validateExperiment checks a definition on its own and, when it replaces a
// stored one that already started, that the split cannot be reshuffled.
func validateExperiment(next domain.Experiment, prev *domain.Experiment) error {
	if !experimentKeyPattern.MatchString(next.Key) {
		return fmt.Errorf("实验标识只能用小写字母、数字和下划线，3–64 位")
	}
	if len([]rune(next.Description)) > 500 {
		return fmt.Errorf("实验说明不能超过 500 字")
	}
	switch next.Status {
	case domain.StatusDraft, domain.StatusRunning, domain.StatusStopped:
	default:
		return fmt.Errorf("不支持的实验状态 %q", next.Status)
	}
	switch next.Audience {
	case domain.AudienceAll, domain.AudienceNewUsers:
	default:
		return fmt.Errorf("不支持的实验人群 %q", next.Audience)
	}
	if err := validateVariants(next.Variants); err != nil {
		return err
	}
	if n := len([]rune(next.Salt)); n == 0 || n > 64 {
		return fmt.Errorf("分组种子长度须为 1–64")
	}
	if next.OverrideVariant != nil && !hasVariant(next.Variants, *next.OverrideVariant) {
		return fmt.Errorf("强制分组 %q 不在分组列表里", *next.OverrideVariant)
	}
	if prev == nil {
		return nil
	}
	if prev.Status == domain.StatusStopped && next.Status != domain.StatusStopped {
		return fmt.Errorf("已结束的实验不能重新开始，请新建一个实验")
	}
	if prev.StartedAt == nil {
		return nil
	}
	if next.Status == domain.StatusDraft {
		return fmt.Errorf("已开始的实验不能退回草稿")
	}
	if next.Audience != prev.Audience {
		return fmt.Errorf("实验开始后不能修改实验人群")
	}
	if next.Salt != prev.Salt {
		return fmt.Errorf("实验开始后不能修改分组种子")
	}
	if !sameVariantKeys(prev.Variants, next.Variants) {
		return fmt.Errorf("实验开始后不能增删或重排分组，只能调整权重")
	}
	return nil
}

func validateVariants(variants []domain.Variant) error {
	if len(variants) < 2 || len(variants) > 4 {
		return fmt.Errorf("分组数须为 2–4 个，第一个是对照组")
	}
	seen := map[string]bool{}
	total := 0
	for _, v := range variants {
		if !variantKeyPattern.MatchString(v.Key) {
			return fmt.Errorf("分组标识 %q 只能用小写字母、数字和下划线", v.Key)
		}
		if seen[v.Key] {
			return fmt.Errorf("分组标识 %q 重复", v.Key)
		}
		seen[v.Key] = true
		if v.Weight < 0 || v.Weight > 100 {
			return fmt.Errorf("分组 %q 的权重须在 0–100 之间", v.Key)
		}
		total += v.Weight
	}
	if total == 0 {
		return fmt.Errorf("分组权重之和须大于 0")
	}
	return nil
}

func hasVariant(variants []domain.Variant, key string) bool {
	for _, v := range variants {
		if v.Key == key {
			return true
		}
	}
	return false
}

func sameVariantKeys(a, b []domain.Variant) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i].Key != b[i].Key {
			return false
		}
	}
	return true
}
