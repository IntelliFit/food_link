package service

import (
	"context"
	"food_link/backend/internal/auth/repo"
	"food_link/backend/pkg/logger"
	"food_link/backend/pkg/storage"
	"log/slog"
	"time"
)

type AccountObjectCleaner interface {
	DeleteAccountObjects(context.Context, string) error
	DeleteAccountReferences(context.Context, string, []storage.AccountObjectRef) error
}
type AccountDeletionService struct {
	users         *repo.UserRepo
	objects       AccountObjectCleaner
	retentionDays int
	now           func() time.Time
}
type AccountDeletionStatus struct {
	State       string     `json:"state"`
	RequestedAt *time.Time `json:"requested_at,omitempty"`
	ExecuteAt   *time.Time `json:"execute_at,omitempty"`
	CanCancel   bool       `json:"can_cancel"`
}

func NewAccountDeletionService(users *repo.UserRepo, objects AccountObjectCleaner, retentionDays int) *AccountDeletionService {
	return &AccountDeletionService{users: users, objects: objects, retentionDays: retentionDays, now: time.Now}
}
func (s *AccountDeletionService) Status(ctx context.Context, id string) (AccountDeletionStatus, error) {
	d, err := s.users.DeletionStatus(ctx, id)
	if err != nil {
		return AccountDeletionStatus{}, repo.ErrDeletionUnavailable
	}
	if d == nil {
		return AccountDeletionStatus{State: "active"}, nil
	}
	return AccountDeletionStatus{State: d.State, RequestedAt: &d.RequestedAt, ExecuteAt: &d.ExecuteAt, CanCancel: d.State == "pending" && s.now().Before(d.ExecuteAt)}, nil
}
func (s *AccountDeletionService) Request(ctx context.Context, id string, days int) (AccountDeletionStatus, error) {
	if _, err := s.users.RequestDeletion(ctx, id, days, s.now()); err != nil {
		return AccountDeletionStatus{}, err
	}
	logger.Info(ctx, "账号注销申请已受理", slog.String("user_id", id), slog.Int("cooling_off_days", days))
	return s.Status(ctx, id)
}
func (s *AccountDeletionService) Cancel(ctx context.Context, id string) error {
	if err := s.users.CancelDeletion(ctx, id, s.now()); err != nil {
		return err
	}
	logger.Info(ctx, "账号注销申请已撤销", slog.String("user_id", id))
	return nil
}
func (s *AccountDeletionService) Sweep(ctx context.Context) error {
	return s.users.WithDeletionLease(ctx, func() error {
		rows, err := s.users.DueDeletions(ctx, s.now())
		if err != nil {
			return err
		}
		for _, row := range rows {
			if ctx.Err() != nil {
				return ctx.Err()
			}
			if err := s.users.BeginDeletion(ctx, row.UserID, s.now()); err != nil {
				logger.Error(ctx, "账号注销清理状态切换失败", err, slog.String("user_id", row.UserID))
				continue
			}
			if s.objects == nil {
				return repo.ErrDeletionUnavailable
			}
			jobCtx, cancel := context.WithTimeout(ctx, 2*time.Minute)
			var images []storage.AccountObjectRef
			err = s.users.ValidateDeletionEvidencePolicy(jobCtx, row.UserID, s.retentionDays)
			if err == nil {
				images, err = s.users.DeletionImages(jobCtx, row.UserID)
			}
			if err == nil {
				for i := row.ImageCursor; i < len(images); i++ {
					if err = s.objects.DeleteAccountReferences(jobCtx, row.UserID, images[i:i+1]); err != nil {
						break
					}
					if err = s.users.SaveDeletionImageCursor(jobCtx, row.UserID, i+1); err != nil {
						break
					}
				}
			}
			if err == nil {
				err = s.objects.DeleteAccountObjects(jobCtx, row.UserID)
			}
			if err == nil {
				err = s.users.FinishDeletion(jobCtx, row.UserID, s.now(), s.retentionDays)
			}
			cancel()
			if err != nil {
				logger.Error(ctx, "账号永久清理失败，等待重试", err, slog.String("user_id", row.UserID))
				continue
			}
			logger.Info(ctx, "账号永久清理完成", slog.String("user_id", row.UserID))
		}
		return s.users.PurgeDeletionReceipts(ctx, s.now())
	})
}
func (s *AccountDeletionService) Run(ctx context.Context) {
	for {
		if err := s.Sweep(ctx); err != nil && ctx.Err() == nil {
			logger.Error(ctx, "账号注销巡检失败", err)
		}
		timer := time.NewTimer(time.Minute)
		select {
		case <-ctx.Done():
			timer.Stop()
			return
		case <-timer.C:
		}
	}
}
