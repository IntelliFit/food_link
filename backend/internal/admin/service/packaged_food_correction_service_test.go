package service

import (
	"context"
	"testing"

	commonerrors "food_link/backend/internal/common/errors"
	foodrecorddomain "food_link/backend/internal/foodrecord/domain"
	foodrecordrepo "food_link/backend/internal/foodrecord/repo"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type packagedFoodCorrectionRepoStub struct {
	reviewErr error
}

func (s *packagedFoodCorrectionRepoStub) ListPackagedFoodCorrectionSubmissions(context.Context, foodrecordrepo.ListPackagedFoodCorrectionsInput) (*foodrecordrepo.ListPackagedFoodCorrectionsResult, error) {
	return nil, nil
}

func (s *packagedFoodCorrectionRepoStub) GetPackagedFoodCorrectionSubmission(context.Context, string) (*foodrecorddomain.PackagedFoodCorrectionSubmission, error) {
	return nil, nil
}

func (s *packagedFoodCorrectionRepoStub) GetPackagedFoodByID(context.Context, string) (*foodrecorddomain.PackagedFood, error) {
	return nil, nil
}

func (s *packagedFoodCorrectionRepoStub) ReviewPackagedFoodCorrectionSubmission(context.Context, string, bool, string, string) (*foodrecorddomain.PackagedFoodCorrectionSubmission, *foodrecorddomain.PackagedFood, error) {
	return nil, nil, s.reviewErr
}

func TestPackagedFoodCorrectionReviewReturnsConflictForProcessedSubmission(t *testing.T) {
	svc := NewPackagedFoodCorrectionService(&packagedFoodCorrectionRepoStub{reviewErr: foodrecordrepo.ErrPackagedFoodCorrectionAlreadyReviewed})

	_, err := svc.Review(context.Background(), "submission-1", ReviewPackagedFoodCorrectionInput{Action: "approve"}, "admin-1")

	var appErr *commonerrors.AppError
	require.ErrorAs(t, err, &appErr)
	assert.Equal(t, 409, appErr.HTTPStatus)
	assert.Contains(t, appErr.Message, "已处理")
}

func TestPackagedFoodCorrectionReviewReturnsConflictForStaleSubmission(t *testing.T) {
	svc := NewPackagedFoodCorrectionService(&packagedFoodCorrectionRepoStub{reviewErr: foodrecordrepo.ErrPackagedFoodCorrectionStale})

	_, err := svc.Review(context.Background(), "submission-1", ReviewPackagedFoodCorrectionInput{Action: "approve"}, "admin-1")

	var appErr *commonerrors.AppError
	require.ErrorAs(t, err, &appErr)
	assert.Equal(t, 409, appErr.HTTPStatus)
	assert.Contains(t, appErr.Message, "已过期")
}
