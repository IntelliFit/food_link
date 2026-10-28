package repo

import (
	"context"
	"time"
)

// UserSignals is what decides how much a user may be asked: how long they
// have been registered, how regularly they log meals, whether they answer
// the prompt, and whether they already contribute dishes.
type UserSignals struct {
	RegisteredAt     *time.Time
	RecordDays       int
	Prompts          int
	AnsweredPrompts  int
	PublishedUploads int
	Captures         int
}

const userSignalsSQL = `SELECT
  (SELECT create_time FROM weapp_user WHERE id = @user) AS registered_at,
  (SELECT count(DISTINCT (created_at AT TIME ZONE 'Asia/Shanghai')::date) FROM user_food_records
    WHERE user_id = @user AND created_at >= @record_since) AS record_days,
  (SELECT count(*) FROM meal_dish_prompts WHERE user_id = @user AND created_at >= @prompt_since) AS prompts,
  (SELECT count(*) FROM meal_dish_prompts WHERE user_id = @user AND created_at >= @prompt_since
    AND chosen_item_id IS NOT NULL) AS answered_prompts,
  (SELECT count(*) FROM public_food_library WHERE user_id = @user AND status = 'published') AS published_uploads,
  (SELECT count(*) FROM canteen_capture_sessions WHERE user_id = @user AND status = 'submitted') AS captures`

func (r *Repo) UserSignals(ctx context.Context, userID string, recordSince, promptSince time.Time) (UserSignals, error) {
	var signals UserSignals
	err := r.db.WithContext(ctx).Raw(userSignalsSQL, map[string]any{
		"user": userID, "record_since": recordSince, "prompt_since": promptSince,
	}).Scan(&signals).Error
	return signals, err
}

// PriceAsk is one earlier price question to this user, newest first.
type PriceAsk struct {
	AskedAt time.Time
	Kind    string
}

// PriceAsks returns the user's latest price questions and how many were
// asked since dayStart (the daily cap).
func (r *Repo) PriceAsks(ctx context.Context, userID string, dayStart time.Time, limit int) ([]PriceAsk, int, error) {
	asks := []PriceAsk{}
	db := r.db.WithContext(ctx)
	if err := db.Raw(`SELECT price_asked_at AS asked_at, price_answer_kind AS kind FROM meal_dish_prompts
WHERE user_id = ? AND price_asked_at IS NOT NULL ORDER BY price_asked_at DESC LIMIT ?`, userID, limit).Scan(&asks).Error; err != nil {
		return nil, 0, err
	}
	var today int64
	if err := db.Raw(`SELECT count(*) FROM meal_dish_prompts WHERE user_id = ? AND price_asked_at >= ?`, userID, dayStart).
		Scan(&today).Error; err != nil {
		return nil, 0, err
	}
	return asks, int(today), nil
}

// PriceAgreement counts distinct users who reported this price for the dish
// since the given time.
func (r *Repo) PriceAgreement(ctx context.Context, itemID string, price float64, since time.Time) (int, error) {
	var users int64
	err := r.db.WithContext(ctx).Raw(`SELECT count(DISTINCT user_id) FROM meal_dish_prompts
WHERE chosen_item_id = ? AND price_answer_kind IN ('same', 'changed') AND abs(price_answer - ?) < 0.01
  AND price_answered_at >= ?`, itemID, price, since).Scan(&users).Error
	return int(users), err
}
