package service

import (
	"context"
	"log/slog"
	"time"

	migrationdo "food_link/backend/internal/migration/do"
	"food_link/backend/internal/push/domain"
	"food_link/backend/internal/push/repo"
	"food_link/backend/pkg/logger"
)

func (s *Service) planEvents(ctx context.Context, setting repo.Settings, devices []migrationdo.PushDeviceDO, now time.Time) error {
	p := setting.Preferences
	if p.Validate() != nil {
		return nil
	}
	for _, kind := range []string{domain.PrivateMessageEvent, domain.AnalysisCompletedEvent} {
		if !p.EventEnabled(kind) {
			continue
		}
		for _, device := range devices {
			if device.ProtocolVersion < domain.EventProtocolVersion || !s.deviceProjectValid(device.Provider, device.ProjectID, device.Platform) {
				continue
			}
			events, err := s.repo.PendingEvents(ctx, setting.UserID, device.ID, kind, p.EventSince[kind], now)
			if err != nil {
				return s.storageError(ctx, "scan_events", setting.UserID)
			}
			for _, event := range events {
				job := migrationdo.PushDeliveryDO{UserID: setting.UserID, DeviceID: device.ID, Provider: providerName(device.Provider),
					DedupeKey: repo.EventKey(setting.UserID, device.ID, kind, event.ID), ResourceID: event.ID,
					TokenHash: repo.TokenHash(device.Token), PreferencesVersion: setting.UpdatedAt,
					Kind: kind, LocalDate: "", Status: "pending", NotBefore: p.NextEventTime(now),
					ExpiresAt: event.OccurredAt.Add(domain.EventLifetime), CreatedAt: now, UpdatedAt: now}
				if err := s.repo.Enqueue(ctx, job); err != nil {
					return s.storageError(ctx, "enqueue_event", setting.UserID)
				}
			}
			if len(events) > 0 {
				logger.Info(ctx, "业务事件提醒已入队", slog.String("user_id", setting.UserID), slog.String("kind", kind), slog.Int("count", len(events)))
			}
		}
	}
	return nil
}
