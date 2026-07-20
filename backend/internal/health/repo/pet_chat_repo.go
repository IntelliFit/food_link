package repo

import (
	"context"
	"time"

	"food_link/backend/internal/health/domain"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

type petChatSessionDO struct {
	ID                  string         `gorm:"column:id;type:uuid;primaryKey"`
	UserID              string         `gorm:"column:user_id;type:uuid;not null"`
	PetID               *string        `gorm:"column:pet_id;type:uuid"`
	Title               string         `gorm:"column:title;type:text;not null;default:''"`
	RangeType           string         `gorm:"column:range_type;type:text;not null;default:'week'"`
	Status              string         `gorm:"column:status;type:text;not null;default:'active'"`
	ContextStartDate    *time.Time     `gorm:"column:context_start_date;type:date"`
	ContextEndDate      *time.Time     `gorm:"column:context_end_date;type:date"`
	ContextFingerprint  string         `gorm:"column:context_fingerprint;type:text;not null;default:''"`
	RecordedDays        int            `gorm:"column:recorded_days;type:integer;not null;default:0"`
	LastQuestion        string         `gorm:"column:last_question;type:text;not null;default:''"`
	LastAnswer          string         `gorm:"column:last_answer;type:text;not null;default:''"`
	LastMessageAt       *time.Time     `gorm:"column:last_message_at;type:timestamptz"`
	TotalCreditsCharged int            `gorm:"column:total_credits_charged;type:integer;not null;default:0"`
	Meta                map[string]any `gorm:"column:meta;type:jsonb;serializer:json;not null;default:'{}'::jsonb"`
	CreatedAt           time.Time      `gorm:"column:created_at;type:timestamptz;not null;default:now()"`
	UpdatedAt           time.Time      `gorm:"column:updated_at;type:timestamptz;not null;default:now()"`
}

func (petChatSessionDO) TableName() string { return "pet_chat_sessions" }

type petChatMessageDO struct {
	ID               string         `gorm:"column:id;type:uuid;primaryKey"`
	SessionID        string         `gorm:"column:session_id;type:uuid;not null"`
	UserID           string         `gorm:"column:user_id;type:uuid;not null"`
	Role             string         `gorm:"column:role;type:text;not null"`
	Content          string         `gorm:"column:content;type:text;not null"`
	MessageType      string         `gorm:"column:message_type;type:text;not null;default:''"`
	RangeType        string         `gorm:"column:range_type;type:text;not null;default:'week'"`
	CreditsCharged   int            `gorm:"column:credits_charged;type:integer;not null;default:0"`
	AIUsagePricing   map[string]any `gorm:"column:ai_usage_pricing;type:jsonb;serializer:json;not null;default:'{}'::jsonb"`
	EstimatedPricing map[string]any `gorm:"column:estimated_pricing;type:jsonb;serializer:json;not null;default:'{}'::jsonb"`
	Meta             map[string]any `gorm:"column:meta;type:jsonb;serializer:json;not null;default:'{}'::jsonb"`
	CreatedAt        time.Time      `gorm:"column:created_at;type:timestamptz;not null;default:now()"`
}

func (petChatMessageDO) TableName() string { return "pet_chat_messages" }

func (r *StatsRepo) CreatePetChatSession(ctx context.Context, session domain.PetChatSession) (*domain.PetChatSession, error) {
	now := time.Now()
	if session.ID == "" {
		session.ID = uuid.NewString()
	}
	if session.Status == "" {
		session.Status = "active"
	}
	if session.RangeType == "" {
		session.RangeType = "week"
	}
	if session.Meta == nil {
		session.Meta = map[string]any{}
	}
	row := petChatSessionFromDomain(session)
	row.CreatedAt = now
	row.UpdatedAt = now
	if err := r.db.WithContext(ctx).Create(&row).Error; err != nil {
		return nil, err
	}
	out := petChatSessionToDomain(row)
	return &out, nil
}

func (r *StatsRepo) GetPetChatSession(ctx context.Context, userID, sessionID string) (*domain.PetChatSession, error) {
	var row petChatSessionDO
	if err := r.db.WithContext(ctx).
		Where("user_id = ? AND id = ? AND status <> ?", userID, sessionID, "deleted").
		First(&row).Error; err != nil {
		return nil, err
	}
	out := petChatSessionToDomain(row)
	return &out, nil
}

func (r *StatsRepo) GetPetChatSessionMessages(ctx context.Context, userID, sessionID string, limit int) ([]domain.PetChatMessage, error) {
	if limit <= 0 || limit > 80 {
		limit = 40
	}
	var messageRows []petChatMessageDO
	if err := r.db.WithContext(ctx).
		Where("user_id = ? AND session_id = ?", userID, sessionID).
		Order("created_at DESC").
		Limit(limit).
		Find(&messageRows).Error; err != nil {
		return nil, err
	}
	messages := make([]domain.PetChatMessage, 0, len(messageRows))
	for i := len(messageRows) - 1; i >= 0; i-- {
		messages = append(messages, petChatMessageToDomain(messageRows[i]))
	}
	return messages, nil
}

func (r *StatsRepo) ListPetChatSessions(ctx context.Context, userID string, limit int) ([]domain.PetChatSession, error) {
	if limit <= 0 || limit > 100 {
		limit = 40
	}
	var rows []petChatSessionDO
	if err := r.db.WithContext(ctx).
		Where("user_id = ? AND status <> ?", userID, "deleted").
		Order("updated_at DESC").
		Limit(limit).
		Find(&rows).Error; err != nil {
		return nil, err
	}
	out := make([]domain.PetChatSession, 0, len(rows))
	for _, row := range rows {
		out = append(out, petChatSessionToDomain(row))
	}
	return out, nil
}

func (r *StatsRepo) GetLatestPetChatSessionWithMessages(ctx context.Context, userID string, limit int) (*domain.PetChatSession, []domain.PetChatMessage, error) {
	if limit <= 0 || limit > 80 {
		limit = 40
	}
	var sessionRow petChatSessionDO
	if err := r.db.WithContext(ctx).
		Where("user_id = ? AND status = ?", userID, "active").
		Order("updated_at DESC").
		First(&sessionRow).Error; err != nil {
		return nil, nil, err
	}
	var messageRows []petChatMessageDO
	if err := r.db.WithContext(ctx).
		Where("user_id = ? AND session_id = ?", userID, sessionRow.ID).
		Order("created_at ASC").
		Limit(limit).
		Find(&messageRows).Error; err != nil {
		return nil, nil, err
	}
	session := petChatSessionToDomain(sessionRow)
	messages := make([]domain.PetChatMessage, 0, len(messageRows))
	for _, row := range messageRows {
		messages = append(messages, petChatMessageToDomain(row))
	}
	return &session, messages, nil
}

func (r *StatsRepo) AddPetChatMessage(ctx context.Context, message domain.PetChatMessage) (*domain.PetChatMessage, error) {
	if message.ID == "" {
		message.ID = uuid.NewString()
	}
	if message.Meta == nil {
		message.Meta = map[string]any{}
	}
	if message.AIUsagePricing == nil {
		message.AIUsagePricing = map[string]any{}
	}
	if message.EstimatedPricing == nil {
		message.EstimatedPricing = map[string]any{}
	}
	if message.RangeType == "" {
		message.RangeType = "week"
	}
	row := petChatMessageFromDomain(message)
	row.CreatedAt = time.Now()
	if err := r.db.WithContext(ctx).Create(&row).Error; err != nil {
		return nil, err
	}
	out := petChatMessageToDomain(row)
	return &out, nil
}

func (r *StatsRepo) TouchPetChatSession(ctx context.Context, sessionID, userID, question, answer string, creditsCharged int) error {
	now := time.Now()
	updates := map[string]any{
		"status":                "active",
		"last_question":         question,
		"last_answer":           answer,
		"last_message_at":       now,
		"updated_at":            now,
		"total_credits_charged": gorm.Expr("total_credits_charged + ?", creditsCharged),
	}
	return r.db.WithContext(ctx).
		Model(&petChatSessionDO{}).
		Where("id = ? AND user_id = ?", sessionID, userID).
		Updates(updates).Error
}

func (r *StatsRepo) SetPetChatSessionStatus(ctx context.Context, sessionID, userID, status string) error {
	return r.db.WithContext(ctx).Model(&petChatSessionDO{}).
		Where("id = ? AND user_id = ?", sessionID, userID).
		Updates(map[string]any{"status": status, "updated_at": time.Now()}).Error
}

func petChatSessionFromDomain(in domain.PetChatSession) petChatSessionDO {
	return petChatSessionDO{
		ID:                  in.ID,
		UserID:              in.UserID,
		PetID:               in.PetID,
		Title:               in.Title,
		RangeType:           in.RangeType,
		Status:              in.Status,
		ContextStartDate:    parsePetChatDate(in.ContextStartDate),
		ContextEndDate:      parsePetChatDate(in.ContextEndDate),
		ContextFingerprint:  in.ContextFingerprint,
		RecordedDays:        in.RecordedDays,
		LastQuestion:        in.LastQuestion,
		LastAnswer:          in.LastAnswer,
		LastMessageAt:       in.LastMessageAt,
		TotalCreditsCharged: in.TotalCreditsCharged,
		Meta:                in.Meta,
		CreatedAt:           in.CreatedAt,
		UpdatedAt:           in.UpdatedAt,
	}
}

func petChatSessionToDomain(in petChatSessionDO) domain.PetChatSession {
	return domain.PetChatSession{
		ID:                  in.ID,
		UserID:              in.UserID,
		PetID:               in.PetID,
		Title:               in.Title,
		RangeType:           in.RangeType,
		Status:              in.Status,
		ContextStartDate:    formatPetChatDate(in.ContextStartDate),
		ContextEndDate:      formatPetChatDate(in.ContextEndDate),
		ContextFingerprint:  in.ContextFingerprint,
		RecordedDays:        in.RecordedDays,
		LastQuestion:        in.LastQuestion,
		LastAnswer:          in.LastAnswer,
		LastMessageAt:       in.LastMessageAt,
		TotalCreditsCharged: in.TotalCreditsCharged,
		Meta:                in.Meta,
		CreatedAt:           in.CreatedAt,
		UpdatedAt:           in.UpdatedAt,
	}
}

func petChatMessageFromDomain(in domain.PetChatMessage) petChatMessageDO {
	return petChatMessageDO{
		ID:               in.ID,
		SessionID:        in.SessionID,
		UserID:           in.UserID,
		Role:             in.Role,
		Content:          in.Content,
		MessageType:      in.MessageType,
		RangeType:        in.RangeType,
		CreditsCharged:   in.CreditsCharged,
		AIUsagePricing:   in.AIUsagePricing,
		EstimatedPricing: in.EstimatedPricing,
		Meta:             in.Meta,
		CreatedAt:        in.CreatedAt,
	}
}

func petChatMessageToDomain(in petChatMessageDO) domain.PetChatMessage {
	return domain.PetChatMessage{
		ID:               in.ID,
		SessionID:        in.SessionID,
		UserID:           in.UserID,
		Role:             in.Role,
		Content:          in.Content,
		MessageType:      in.MessageType,
		RangeType:        in.RangeType,
		CreditsCharged:   in.CreditsCharged,
		AIUsagePricing:   in.AIUsagePricing,
		EstimatedPricing: in.EstimatedPricing,
		Meta:             in.Meta,
		CreatedAt:        in.CreatedAt,
	}
}

func parsePetChatDate(value string) *time.Time {
	if value == "" {
		return nil
	}
	t, err := time.Parse("2006-01-02", value)
	if err != nil {
		return nil
	}
	return &t
}

func formatPetChatDate(value *time.Time) string {
	if value == nil {
		return ""
	}
	return value.Format("2006-01-02")
}
