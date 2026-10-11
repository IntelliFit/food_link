package service

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"unicode/utf8"

	commonerrors "food_link/backend/internal/common/errors"
	"food_link/backend/internal/productupdate/domain"
	"food_link/backend/internal/productupdate/repo"
	"food_link/backend/pkg/logger"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

var versionPattern = regexp.MustCompile(`^(0|[1-9][0-9]{0,5})\.(0|[1-9][0-9]{0,5})\.(0|[1-9][0-9]{0,5})$`)
var ErrConflict = &commonerrors.AppError{Code: 10005, Message: "通知状态已变化，请刷新；已发布内容不可修改", HTTPStatus: http.StatusConflict}

type Input struct {
	Title      string `json:"title"`
	Content    string `json:"content"`
	MinVersion string `json:"min_version"`
}
type Service struct{ repo *repo.Repository }

func New(r *repo.Repository) *Service { return &Service{repo: r} }

func ValidVersion(v string) bool { return versionPattern.MatchString(v) }
func Eligible(version, minimum string) bool {
	if !ValidVersion(version) || !ValidVersion(minimum) {
		return false
	}
	a, b := strings.Split(version, "."), strings.Split(minimum, ".")
	for i := range a {
		x, _ := strconv.Atoi(a[i])
		y, _ := strconv.Atoi(b[i])
		if x != y {
			return x > y
		}
	}
	return true
}
func (in *Input) Validate() error {
	in.Title, in.Content, in.MinVersion = strings.TrimSpace(in.Title), strings.TrimSpace(in.Content), strings.TrimSpace(in.MinVersion)
	if utf8.RuneCountInString(in.Title) < 1 || utf8.RuneCountInString(in.Title) > 32 || utf8.RuneCountInString(in.Content) < 1 || utf8.RuneCountInString(in.Content) > 1200 || !ValidVersion(in.MinVersion) {
		return commonerrors.ErrBadRequest
	}
	return nil
}
func (s *Service) result(ctx context.Context, err error, action, id string) error {
	if err == nil {
		return nil
	}
	if errors.Is(err, repo.ErrConflict) {
		logger.Warn(ctx, "产品通知状态冲突", slog.String("action", action), slog.String("update_id", id))
		return ErrConflict
	}
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return commonerrors.ErrNotFound
	}
	logger.Error(ctx, "产品通知数据库操作失败", err, slog.String("action", action), slog.String("update_id", id))
	return err
}
func (s *Service) List(ctx context.Context, userID, version string, admin bool) ([]domain.Update, error) {
	if !admin && !ValidVersion(version) {
		return nil, commonerrors.ErrBadRequest
	}
	items, err := s.repo.List(ctx, userID, admin)
	if err != nil {
		return nil, s.result(ctx, err, "list", "")
	}
	if admin {
		return items, nil
	}
	visible := make([]domain.Update, 0)
	for _, item := range items {
		if Eligible(version, item.MinVersion) {
			visible = append(visible, item)
		}
	}
	return visible, nil
}
func (s *Service) Save(ctx context.Context, id, admin string, in Input) (*domain.Update, error) {
	if err := in.Validate(); err != nil {
		return nil, err
	}
	item := &domain.Update{Title: in.Title, Content: in.Content, MinVersion: in.MinVersion, CreatedBy: admin}
	var err error
	if id == "" {
		err = s.repo.Create(ctx, item)
	} else {
		if _, err := uuid.Parse(id); err != nil {
			return nil, commonerrors.ErrBadRequest
		}
		item.ID = id
		err = s.repo.Edit(ctx, id, map[string]any{"title": in.Title, "content": in.Content, "min_version": in.MinVersion})
	}
	return item, s.result(ctx, err, "save", id)
}
func (s *Service) Transition(ctx context.Context, id, action string) error {
	if _, err := uuid.Parse(id); err != nil {
		return commonerrors.ErrBadRequest
	}
	from, to := "draft", "published"
	if action == "withdraw" {
		from, to = "published", "withdrawn"
	} else if action != "publish" {
		return commonerrors.ErrBadRequest
	}
	err := s.repo.Transition(ctx, id, from, to)
	if err == nil {
		logger.Info(ctx, "产品通知状态变更完成", slog.String("update_id", id), slog.String("status", to))
	}
	return s.result(ctx, err, action, id)
}
func (s *Service) Acknowledge(ctx context.Context, id, userID, version string) error {
	if _, err := uuid.Parse(id); err != nil {
		return commonerrors.ErrBadRequest
	}
	if userID == "" {
		return commonerrors.ErrUnauthorized
	}
	if !ValidVersion(version) {
		return commonerrors.ErrBadRequest
	}
	return s.result(ctx, s.repo.Acknowledge(ctx, id, userID, func(item domain.Update) bool { return Eligible(version, item.MinVersion) }), "acknowledge", id)
}
