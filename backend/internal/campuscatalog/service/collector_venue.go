package service

import (
	"context"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"food_link/backend/internal/campuscatalog/domain"
	commonerrors "food_link/backend/internal/common/errors"
	"food_link/backend/pkg/logger"
	"github.com/google/uuid"
)

type venueCollectorRepository interface {
	FindVenueCollectorApplication(context.Context, string, string, string, string) (*domain.CollectorApplication, error)
	CreateCollectorApplication(context.Context, *domain.CollectorApplication) error
	HasActiveVenueCollectorScope(context.Context, string, string, string, string, time.Time) (bool, error)
}

func (s *CatalogService) applyVenueCollector(ctx context.Context, userID string, input CollectorApplicationInput) (*domain.CollectorApplication, error) {
	venueType := strings.TrimSpace(input.VenueType)
	if venueType != "community" && venueType != "corporate" && venueType != "office_park" {
		return nil, badRequest("请选择校园、社区、园区或公司食堂")
	}
	if strings.TrimSpace(input.SchoolID) != "" || pointerValue(input.CampusID) != "" || pointerValue(input.CanteenID) != "" {
		return nil, badRequest("社区、园区和公司申请无需学校目录")
	}
	organization, canteen, note := strings.TrimSpace(input.OrganizationName), strings.TrimSpace(input.CanteenName), strings.TrimSpace(input.ApplicantNote)
	if organization == "" || len([]rune(organization)) > 200 || len([]rune(canteen)) > 200 || len([]rune(note)) > 500 {
		return nil, badRequest("请填写机构名称（最多200字），食堂名称最多200字，申请说明最多500字")
	}
	repo, ok := s.repo.(venueCollectorRepository)
	if !ok {
		return nil, appError("食堂批量授权服务未配置")
	}
	existing, err := repo.FindVenueCollectorApplication(ctx, userID, venueType, organization, canteen)
	if err != nil {
		return nil, err
	}
	if existing != nil {
		return existing, nil
	}
	now := time.Now()
	application := &domain.CollectorApplication{
		ID: uuid.NewString(), UserID: userID, VenueType: venueType,
		OrganizationName: domain.CollectorPlaceName(organization), ScopeCanteenName: domain.CollectorPlaceName(canteen),
		ApplicantNote: note, Status: "pending", CreatedAt: &now, UpdatedAt: &now,
	}
	if err := repo.CreateCollectorApplication(ctx, application); err != nil {
		// A concurrent retry may have won the pending-scope unique index.
		if existing, findErr := repo.FindVenueCollectorApplication(ctx, userID, venueType, organization, canteen); findErr == nil && existing != nil {
			return existing, nil
		}
		logger.Error(ctx, "提交食堂批量采集申请失败", err, slog.String("user_id", userID), slog.String("venue_type", venueType))
		return nil, err
	}
	logger.Info(ctx, "食堂批量采集申请已提交", slog.String("user_id", userID), slog.String("application_id", application.ID), slog.String("venue_type", venueType))
	return application, nil
}

func (s *CatalogService) requireVenueCollectorScope(ctx context.Context, userID, venueType, organization, canteen string) error {
	repo, ok := s.repo.(venueCollectorRepository)
	if !ok {
		return appError("食堂批量授权服务未配置")
	}
	allowed, err := repo.HasActiveVenueCollectorScope(ctx, userID, venueType, organization, canteen, time.Now())
	if err != nil {
		logger.Error(ctx, "检查食堂批量采集权限失败", err, slog.String("user_id", userID), slog.String("venue_type", venueType))
		return err
	}
	if !allowed {
		logger.Warn(ctx, "食堂批量采集范围未获授权", slog.String("user_id", userID), slog.String("venue_type", venueType))
		return &commonerrors.AppError{Code: 20003, Message: "尚未获得该食堂范围的批量上传权限", HTTPStatus: http.StatusForbidden}
	}
	return nil
}
