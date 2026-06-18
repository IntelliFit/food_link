package billing

import (
	"math"
	"strings"

	"food_link/backend/pkg/config"
)

const (
	defaultCreditsPerCNY                 = 25
	defaultUSDToCNY                      = 7.25
	defaultCostMultiplier                = 3
	defaultMinimumCredits                = 1
	defaultMaximumCreditsPerRequest      = 20
	defaultInputUSDPerMillionTokens      = 0.435
	defaultOutputUSDPerMillionTokens     = 0.87
	defaultCachedInputUSDPerMillionToken = 0.435
)

type TokenUsage struct {
	InputTokens          int `json:"input_tokens"`
	OutputTokens         int `json:"output_tokens"`
	TotalTokens          int `json:"total_tokens"`
	CachedInputTokens    int `json:"cached_input_tokens,omitempty"`
	CacheMissInputTokens int `json:"cache_miss_input_tokens,omitempty"`
}

type PricingInput struct {
	Model string
	Usage TokenUsage
}

type PricingResult struct {
	Model                         string  `json:"model"`
	InputTokens                   int     `json:"input_tokens"`
	OutputTokens                  int     `json:"output_tokens"`
	TotalTokens                   int     `json:"total_tokens"`
	CachedInputTokens             int     `json:"cached_input_tokens,omitempty"`
	CacheMissInputTokens          int     `json:"cache_miss_input_tokens,omitempty"`
	InputUSDPerMillionTokens      float64 `json:"input_usd_per_million_tokens"`
	OutputUSDPerMillionTokens     float64 `json:"output_usd_per_million_tokens"`
	CachedInputUSDPerMillionToken float64 `json:"cached_input_usd_per_million_tokens,omitempty"`
	ProviderCostCNY               float64 `json:"provider_cost_cny"`
	ChargedCNY                    float64 `json:"charged_cny"`
	CreditsCharged                int     `json:"credits_charged"`
	UncappedCreditsCharged        int     `json:"uncapped_credits_charged"`
	CreditsPerCNY                 float64 `json:"credits_per_cny"`
	USDToCNY                      float64 `json:"usd_to_cny"`
	CostMultiplier                float64 `json:"cost_multiplier"`
	GrossMarginRate               float64 `json:"gross_margin_rate"`
	MinimumCredits                int     `json:"minimum_credits"`
	MaximumCreditsPerRequest      int     `json:"maximum_credits_per_request"`
	Capped                        bool    `json:"capped"`
	PricingSource                 string  `json:"pricing_source"`
}

func PriceTokenUsage(input PricingInput, cfg config.AIUsagePricingConfig) PricingResult {
	pricing := normalizePricingConfig(cfg)
	usage := normalizeTokenUsage(input.Usage)
	model := strings.TrimSpace(input.Model)
	if model == "" {
		model = strings.TrimSpace(pricing.DefaultTextModel)
	}
	if model == "" {
		model = "deepseek-v4-pro"
	}

	inputTokens := maxInt(usage.InputTokens, 0)
	outputTokens := maxInt(usage.OutputTokens, 0)
	cachedInputTokens := maxInt(usage.CachedInputTokens, 0)
	cacheMissInputTokens := maxInt(usage.CacheMissInputTokens, 0)
	unclassifiedInputTokens := inputTokens
	if cachedInputTokens+cacheMissInputTokens > 0 {
		unclassifiedInputTokens = maxInt(inputTokens-cachedInputTokens-cacheMissInputTokens, 0)
	}

	inputCostUSD := float64(unclassifiedInputTokens+cacheMissInputTokens) / 1_000_000 * pricing.InputUSDPerMillionTokens
	if cachedInputTokens > 0 {
		inputCostUSD += float64(cachedInputTokens) / 1_000_000 * pricing.CachedInputUSDPerMillionTokens
	}
	outputCostUSD := float64(outputTokens) / 1_000_000 * pricing.OutputUSDPerMillionTokens
	providerCostCNY := (inputCostUSD + outputCostUSD) * pricing.USDToCNY
	chargedCNY := providerCostCNY * pricing.CostMultiplier
	credits := int(math.Ceil(chargedCNY * pricing.CreditsPerCNY))
	if credits < pricing.MinimumCredits {
		credits = pricing.MinimumCredits
	}
	uncappedCredits := credits
	capped := false
	if pricing.MaximumCreditsPerRequest > 0 && credits > pricing.MaximumCreditsPerRequest {
		credits = pricing.MaximumCreditsPerRequest
		capped = true
	}
	grossMarginRate := 0.0
	if pricing.CostMultiplier > 0 {
		grossMarginRate = 1 - 1/pricing.CostMultiplier
	}

	return PricingResult{
		Model:                         model,
		InputTokens:                   inputTokens,
		OutputTokens:                  outputTokens,
		TotalTokens:                   usage.TotalTokens,
		CachedInputTokens:             cachedInputTokens,
		CacheMissInputTokens:          cacheMissInputTokens,
		InputUSDPerMillionTokens:      pricing.InputUSDPerMillionTokens,
		OutputUSDPerMillionTokens:     pricing.OutputUSDPerMillionTokens,
		CachedInputUSDPerMillionToken: pricing.CachedInputUSDPerMillionTokens,
		ProviderCostCNY:               roundMoney(providerCostCNY),
		ChargedCNY:                    roundMoney(chargedCNY),
		CreditsCharged:                credits,
		UncappedCreditsCharged:        uncappedCredits,
		CreditsPerCNY:                 pricing.CreditsPerCNY,
		USDToCNY:                      pricing.USDToCNY,
		CostMultiplier:                pricing.CostMultiplier,
		GrossMarginRate:               roundRatio(grossMarginRate),
		MinimumCredits:                pricing.MinimumCredits,
		MaximumCreditsPerRequest:      pricing.MaximumCreditsPerRequest,
		Capped:                        capped,
		PricingSource:                 pricing.PricingSource,
	}
}

func HasTokenUsage(usage TokenUsage) bool {
	return usage.InputTokens > 0 || usage.OutputTokens > 0 || usage.TotalTokens > 0
}

func normalizePricingConfig(cfg config.AIUsagePricingConfig) config.AIUsagePricingConfig {
	if cfg.CreditsPerCNY <= 0 {
		cfg.CreditsPerCNY = defaultCreditsPerCNY
	}
	if cfg.USDToCNY <= 0 {
		cfg.USDToCNY = defaultUSDToCNY
	}
	if cfg.CostMultiplier <= 0 {
		cfg.CostMultiplier = defaultCostMultiplier
	}
	if cfg.MinimumCredits <= 0 {
		cfg.MinimumCredits = defaultMinimumCredits
	}
	if cfg.MaximumCreditsPerRequest <= 0 {
		cfg.MaximumCreditsPerRequest = defaultMaximumCreditsPerRequest
	}
	if cfg.InputUSDPerMillionTokens <= 0 {
		cfg.InputUSDPerMillionTokens = defaultInputUSDPerMillionTokens
	}
	if cfg.OutputUSDPerMillionTokens <= 0 {
		cfg.OutputUSDPerMillionTokens = defaultOutputUSDPerMillionTokens
	}
	if cfg.CachedInputUSDPerMillionTokens <= 0 {
		cfg.CachedInputUSDPerMillionTokens = defaultCachedInputUSDPerMillionToken
	}
	if strings.TrimSpace(cfg.DefaultTextModel) == "" {
		cfg.DefaultTextModel = "deepseek-v4-pro"
	}
	if strings.TrimSpace(cfg.PricingSource) == "" {
		cfg.PricingSource = "default:pet-chat-2026-06"
	}
	return cfg
}

func normalizeTokenUsage(usage TokenUsage) TokenUsage {
	usage.InputTokens = maxInt(usage.InputTokens, 0)
	usage.OutputTokens = maxInt(usage.OutputTokens, 0)
	usage.TotalTokens = maxInt(usage.TotalTokens, 0)
	if usage.InputTokens == 0 && usage.TotalTokens > usage.OutputTokens {
		usage.InputTokens = usage.TotalTokens - usage.OutputTokens
	}
	if usage.OutputTokens == 0 && usage.TotalTokens > usage.InputTokens {
		usage.OutputTokens = usage.TotalTokens - usage.InputTokens
	}
	if usage.TotalTokens == 0 {
		usage.TotalTokens = usage.InputTokens + usage.OutputTokens
	}
	return usage
}

func roundMoney(value float64) float64 {
	return math.Round(value*1_000_000) / 1_000_000
}

func roundRatio(value float64) float64 {
	return math.Round(value*10_000) / 10_000
}

func maxInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}
