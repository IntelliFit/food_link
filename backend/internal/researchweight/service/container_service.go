package service

import (
	"context"
	"fmt"
	"log/slog"
	"slices"
	"strings"

	"food_link/backend/internal/researchweight/domain"
	"food_link/backend/pkg/logger"

	"github.com/google/uuid"
)

// ContainerInput saves one empty container a contributor weighed, with the
// photo of the scale reading as evidence.
type ContainerInput struct {
	Name          string  `json:"name"`
	ContainerType string  `json:"container_type"`
	Grams         float64 `json:"grams"`
	PhotoURL      string  `json:"photo_url"`
}

func (s *SampleService) ListContainers(ctx context.Context, userID string) ([]domain.ContainerView, error) {
	containers, err := s.repo.ListContainers(ctx, userID)
	if err != nil {
		return nil, err
	}
	views := make([]domain.ContainerView, 0, len(containers))
	for index := range containers {
		views = append(views, s.toContainerView(&containers[index]))
	}
	return views, nil
}

func (s *SampleService) CreateContainer(ctx context.Context, userID string, input ContainerInput) (*domain.ContainerView, error) {
	name := strings.TrimSpace(input.Name)
	if name == "" || runeLen(name) > 20 {
		return nil, badRequest("请给容器起一个不超过20字的名字")
	}
	containerType := strings.TrimSpace(input.ContainerType)
	if !slices.Contains(domain.ContainerTypes, containerType) {
		return nil, badRequest("请选择容器类型")
	}
	grams := round1(input.Grams)
	if grams <= 0 || grams > domain.MaxContainerGrams {
		return nil, badRequest("请填写空容器的读数")
	}
	key := s.keyResolver(userID)(strings.TrimSpace(input.PhotoURL))
	if key == "" {
		return nil, badRequest("请拍空容器放在秤上的读数")
	}
	existing, err := s.repo.ListContainers(ctx, userID)
	if err != nil {
		return nil, err
	}
	if len(existing) >= domain.MaxSavedContainers {
		return nil, badRequest(fmt.Sprintf("常用容器最多保存%d个，请先停用不用的", domain.MaxSavedContainers))
	}
	container := &domain.Container{
		ID: uuid.NewString(), UserID: userID, Name: name, ContainerType: containerType,
		Grams: grams, PhotoObjectKey: key, Status: domain.ContainerActive,
	}
	if err := s.repo.CreateContainer(ctx, container); err != nil {
		return nil, err
	}
	logger.Info(ctx, "称重科研常用容器已保存", slog.String("user_id", userID), slog.String("container_id", container.ID))
	view := s.toContainerView(container)
	return &view, nil
}

// ArchiveContainer hides a saved container from new samples; samples that
// already used it keep the weight they were submitted with.
func (s *SampleService) ArchiveContainer(ctx context.Context, userID, id string) error {
	return s.repo.ArchiveContainer(ctx, userID, strings.TrimSpace(id))
}

func (s *SampleService) toContainerView(container *domain.Container) domain.ContainerView {
	return domain.ContainerView{
		ID: container.ID, Name: container.Name, ContainerType: container.ContainerType,
		Grams: container.Grams, PhotoURL: s.accessURL(container.PhotoObjectKey), CreatedAt: container.CreatedAt,
	}
}
