package service

import (
	"context"
	"log/slog"
	"math"
	"strings"
	"time"

	"food_link/backend/internal/mealdish/domain"
	"food_link/backend/internal/mealdish/repo"
	"food_link/backend/pkg/logger"
)

const (
	priceFreshFor     = 60 * 24 * time.Hour
	priceSkipCooldown = 7 * 24 * time.Hour
	priceAgreeUsers   = 2
	maxCanteenPrice   = 500.0
)

// PriceCorrector writes an agreed price back to the campus catalog as a
// normal versioned correction.
type PriceCorrector interface {
	ApplyAgreedPrice(ctx context.Context, userID, itemID string, price float64, collectedAt time.Time) error
}

// PriceAsk is the price question the page shows after the dish step.
type PriceAsk struct {
	CurrentPrice *float64 `json:"current_price,omitempty"`
	PriceText    string   `json:"price_text"`
}

type priceAskInput struct {
	cohort     string
	photoAsked bool
	dish       repo.DishRow
	now        time.Time
	askedToday int
	recent     []repo.PriceAsk
}

// priceAskDecision says whether to ask this user what the dish costs now.
// It asks at most one extra question per meal (none when the photo question
// is already shown), only active users, only fixed-price catalog dishes
// whose price is missing or old, once a day, and backs off for a week after
// two unanswered questions in a row.
func priceAskDecision(in priceAskInput) (bool, string) {
	switch {
	case in.cohort != domain.CohortActive && in.cohort != domain.CohortContributor:
		return false, "cohort"
	case in.photoAsked:
		return false, "photo_first"
	case !in.dish.InCatalog:
		return false, "not_in_catalog"
	}
	priceType := strings.TrimSpace(in.dish.PriceType)
	if priceType != "" && priceType != "fixed" && priceType != "unknown" {
		return false, "not_fixed_price"
	}
	hasPrice := in.dish.Price > 0
	if hasPrice && in.dish.PriceSetAt != nil && in.now.Sub(*in.dish.PriceSetAt) < priceFreshFor {
		return false, "fresh"
	}
	if in.askedToday > 0 {
		return false, "daily_cap"
	}
	if len(in.recent) >= 2 && unanswered(in.recent[0].Kind) && unanswered(in.recent[1].Kind) &&
		in.now.Sub(in.recent[0].AskedAt) < priceSkipCooldown {
		return false, "cooldown"
	}
	return true, "ask"
}

func unanswered(kind string) bool {
	return kind == "" || kind == domain.PriceSkipped
}

// shouldAskPrice loads the user's recent price questions and decides.
func (s *Service) shouldAskPrice(ctx context.Context, prompt *domain.Prompt, dish *repo.DishRow, photoAsked bool) bool {
	if prompt.PriceAskedAt != nil || dish == nil {
		return false
	}
	now := s.now()
	in := priceAskInput{cohort: prompt.Cohort, photoAsked: photoAsked, dish: *dish, now: now}
	if ok, _ := priceAskDecision(in); !ok {
		return false
	}
	recent, today, err := s.repo.PriceAsks(ctx, prompt.UserID, localDayStart(now), 2)
	if err != nil {
		logger.Warn(ctx, "读取价格追问记录失败，本次不问", slog.String("user_id", prompt.UserID), logger.Err(err))
		return false
	}
	in.recent, in.askedToday = recent, today
	ok, reason := priceAskDecision(in)
	logger.Info(ctx, "食堂菜品价格追问判定", slog.String("prompt_id", prompt.ID), slog.String("cohort", prompt.Cohort),
		slog.Bool("ask", ok), slog.String("reason", reason))
	return ok
}

var shanghai = time.FixedZone("Asia/Shanghai", 8*3600)

func localDayStart(now time.Time) time.Time {
	local := now.In(shanghai)
	return time.Date(local.Year(), local.Month(), local.Day(), 0, 0, 0, 0, shanghai)
}

func priceAskView(dish *repo.DishRow) *PriceAsk {
	ask := &PriceAsk{PriceText: formatPrice(dish.Price, dish.PriceMin, dish.PriceMax, dish.PriceType)}
	if dish.Price > 0 {
		price := dish.Price
		ask.CurrentPrice = &price
	}
	return ask
}

// priceAnswer records "still the same", a new price, or a skip.
func (s *Service) priceAnswer(ctx context.Context, prompt *domain.Prompt, input AnswerInput, now time.Time) (map[string]any, error) {
	if prompt.PriceAskedAt == nil || prompt.ChosenItemID == nil {
		return nil, badRequest("这道菜不需要确认价格")
	}
	if prompt.PriceAnswerKind != "" {
		return map[string]any{}, nil
	}
	updates := map[string]any{"price_answered_at": now}
	switch strings.TrimSpace(input.PriceKind) {
	case domain.PriceSkipped:
		updates["price_answer_kind"] = domain.PriceSkipped
		return updates, nil
	case domain.PriceSame:
		dish, err := s.repo.DishByID(ctx, *prompt.ChosenItemID)
		if err != nil {
			return nil, err
		}
		if dish == nil || dish.Price <= 0 {
			return nil, badRequest("这道菜还没有价格，请直接填写")
		}
		updates["price_answer_kind"], updates["price_answer"] = domain.PriceSame, dish.Price
	case domain.PriceChanged:
		if input.Price == nil || *input.Price <= 0 || *input.Price > maxCanteenPrice {
			return nil, badRequest("请填写 0 到 500 元之间的价格")
		}
		price := math.Round(*input.Price*100) / 100
		updates["price_answer_kind"], updates["price_answer"] = domain.PriceChanged, price
	default:
		return nil, badRequest("请选择价格是否有变化")
	}
	return updates, nil
}

// applyPriceIfAgreed writes the price back once two users reported the same
// value: a new price, or a fresh collection date for a confirmed one. One
// user's answer never changes the catalog.
func (s *Service) applyPriceIfAgreed(ctx context.Context, userID string, prompt *domain.Prompt) {
	if s.prices == nil || prompt.ChosenItemID == nil || prompt.PriceAnswer == nil || prompt.PriceAppliedAt != nil {
		return
	}
	if prompt.PriceAnswerKind != domain.PriceSame && prompt.PriceAnswerKind != domain.PriceChanged {
		return
	}
	now := s.now()
	price, itemID := *prompt.PriceAnswer, *prompt.ChosenItemID
	users, err := s.repo.PriceAgreement(ctx, itemID, price, now.Add(-priceFreshFor))
	if err != nil {
		logger.Warn(ctx, "统计价格一致人数失败", slog.String("item_id", itemID), logger.Err(err))
		return
	}
	if users < priceAgreeUsers {
		return
	}
	dish, err := s.repo.DishByID(ctx, itemID)
	if err != nil || dish == nil {
		return
	}
	// A third agreeing answer right after the write changes nothing.
	if math.Abs(dish.Price-price) < 0.01 && dish.PriceSetAt != nil && now.Sub(*dish.PriceSetAt) < 24*time.Hour {
		return
	}
	if err := s.prices.ApplyAgreedPrice(ctx, userID, itemID, price, now); err != nil {
		logger.Warn(ctx, "写回众包价格失败", slog.String("item_id", itemID), slog.Float64("price", price), logger.Err(err))
		return
	}
	if err := s.repo.UpdatePrompt(ctx, userID, prompt.ID, map[string]any{"price_applied_at": now}); err != nil {
		logger.Warn(ctx, "记录价格写回时间失败", slog.String("prompt_id", prompt.ID), logger.Err(err))
	}
	logger.Info(ctx, "众包价格已写回食堂菜品", slog.String("item_id", itemID), slog.Float64("price", price), slog.Int("users", users))
}
