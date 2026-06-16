package service

import (
	"context"
	"strings"

	"food_link/backend/internal/search/repo"
	"food_link/backend/pkg/storage"
)

type ContentSearchResult struct {
	TargetType string `json:"target_type"`
	TargetID   string `json:"target_id"`
	UserID     string `json:"user_id"`

	Description string   `json:"description,omitempty"`
	Title       *string  `json:"title,omitempty"`
	Body        *string  `json:"body,omitempty"`
	ImagePath   *string  `json:"image_path,omitempty"`
	ImagePaths  []string `json:"image_paths,omitempty"`

	RecordTime *string `json:"record_time"`
	CreatedAt  *string `json:"created_at"`

	TotalCalories *float64 `json:"total_calories"`
	TotalProtein  *float64 `json:"total_protein"`
	TotalCarbs    *float64 `json:"total_carbs"`
	TotalFat      *float64 `json:"total_fat"`
	Fiber         *float64 `json:"fiber"`
	Sugar         *float64 `json:"sugar"`
	SodiumMg      *float64 `json:"sodium_mg"`

	ExerciseDesc  *string  `json:"exercise_desc,omitempty"`
	ExerciseType  *string  `json:"exercise_type,omitempty"`
	CaloriesBurned *float64 `json:"calories_burned"`
	DurationMin   *int     `json:"duration_min"`

	MealType *string `json:"meal_type,omitempty"`
	DietGoal *string `json:"diet_goal,omitempty"`

	Author map[string]string `json:"author"`
}

type UserSearchResult struct {
	ID       string `json:"id"`
	Nickname string `json:"nickname"`
	Avatar   string `json:"avatar"`
	IsFriend bool   `json:"is_friend"`
	IsSelf   bool   `json:"is_self"`
}

type SearchRepo interface {
	SearchContent(ctx context.Context, currentUserID, keyword string, offset, limit int) ([]repo.ContentRow, error)
	SearchUsers(ctx context.Context, keyword string, offset, limit int) ([]repo.UserRow, error)
	GetUserProfiles(ctx context.Context, userIDs []string) (map[string]*repo.UserProfileRow, error)
	GetFriendIDs(ctx context.Context, userID string) (map[string]bool, error)
	CountContent(ctx context.Context, currentUserID, keyword string) (int64, error)
	CountUsers(ctx context.Context, keyword string) (int64, error)
}

type SearchService struct {
	repo    SearchRepo
	storage *storage.Client
}

func NewSearchService(searchRepo SearchRepo, storageClient *storage.Client) *SearchService {
	return &SearchService{
		repo:    searchRepo,
		storage: storageClient,
	}
}

func (s *SearchService) SearchContent(ctx context.Context, currentUserID, keyword string, offset, limit int) ([]ContentSearchResult, bool, error) {
	keyword = strings.TrimSpace(keyword)
	if keyword == "" {
		return nil, false, nil
	}

	rows, err := s.repo.SearchContent(ctx, currentUserID, keyword, offset, limit+1)
	if err != nil {
		return nil, false, err
	}

	hasMore := len(rows) > limit
	if hasMore {
		rows = rows[:limit]
	}

	// Collect unique author IDs
	authorIDs := make(map[string]struct{})
	for i := range rows {
		if rows[i].UserID != "" {
			authorIDs[rows[i].UserID] = struct{}{}
		}
	}
	ids := make([]string, 0, len(authorIDs))
	for id := range authorIDs {
		ids = append(ids, id)
	}
	profiles, _ := s.repo.GetUserProfiles(ctx, ids)

	results := make([]ContentSearchResult, len(rows))
	for i, row := range rows {
		author := map[string]string{"id": row.UserID, "nickname": "用户", "avatar": ""}
		if profile, ok := profiles[row.UserID]; ok {
			nickname := profile.Nickname
			if nickname == "" {
				nickname = "用户"
			}
			author["nickname"] = nickname
			author["avatar"] = s.resolveAvatarURL(profile.Avatar)
		}

		var imagePaths []string
		if row.ImagePaths != nil && *row.ImagePaths != "" {
			imagePaths = s.resolveImagePaths(*row.ImagePaths)
		}

		desc := row.Description
		if row.TargetType == "circle_post" {
			if row.Title != nil && *row.Title != "" {
				desc = *row.Title
			} else if row.Body != nil && *row.Body != "" {
				desc = *row.Body
			}
		}

		results[i] = ContentSearchResult{
			TargetType:     row.TargetType,
			TargetID:       row.TargetID,
			UserID:         row.UserID,
			Description:    desc,
			Title:          row.Title,
			Body:           row.Body,
			ImagePath:      row.ImagePath,
			ImagePaths:     imagePaths,
			RecordTime:     row.RecordTime,
			CreatedAt:      row.CreatedAt,
			TotalCalories:  row.TotalCalories,
			TotalProtein:   row.TotalProtein,
			TotalCarbs:     row.TotalCarbs,
			TotalFat:       row.TotalFat,
			Fiber:          row.Fiber,
			Sugar:          row.Sugar,
			SodiumMg:       row.SodiumMg,
			ExerciseDesc:   row.ExerciseDesc,
			ExerciseType:   row.ExerciseType,
			CaloriesBurned: row.CaloriesBurned,
			DurationMin:    row.DurationMin,
			MealType:       row.MealType,
			DietGoal:       row.DietGoal,
			Author:         author,
		}
	}
	return results, hasMore, nil
}

func (s *SearchService) SearchUsers(ctx context.Context, currentUserID, keyword string, offset, limit int) ([]UserSearchResult, bool, error) {
	keyword = strings.TrimSpace(keyword)
	if keyword == "" {
		return nil, false, nil
	}

	rows, err := s.repo.SearchUsers(ctx, keyword, offset, limit+1)
	if err != nil {
		return nil, false, err
	}

	hasMore := len(rows) > limit
	if hasMore {
		rows = rows[:limit]
	}

	friendMap, _ := s.repo.GetFriendIDs(ctx, currentUserID)

	results := make([]UserSearchResult, len(rows))
	for i, row := range rows {
		results[i] = UserSearchResult{
			ID:       row.ID,
			Nickname: row.Nickname,
			Avatar:   s.resolveAvatarURL(row.Avatar),
			IsFriend: friendMap[row.ID],
			IsSelf:   row.ID == currentUserID,
		}
	}
	return results, hasMore, nil
}

type SearchCounts struct {
	ContentCount int64 `json:"content_count"`
	UserCount    int64 `json:"user_count"`
}

func (s *SearchService) GetSearchCounts(ctx context.Context, currentUserID, keyword string) (*SearchCounts, error) {
	keyword = strings.TrimSpace(keyword)
	if keyword == "" {
		return &SearchCounts{}, nil
	}
	contentCount, err := s.repo.CountContent(ctx, currentUserID, keyword)
	if err != nil {
		return nil, err
	}
	userCount, err := s.repo.CountUsers(ctx, keyword)
	if err != nil {
		return nil, err
	}
	return &SearchCounts{
		ContentCount: contentCount,
		UserCount:    userCount,
	}, nil
}

func (s *SearchService) resolveAvatarURL(value string) string {
	value = strings.TrimSpace(value)
	if value == "" || s.storage == nil {
		return value
	}
	resolved := s.storage.ResolveReferenceURL("user-avatars", value)
	if resolved == "" {
		return value
	}
	return resolved
}

func (s *SearchService) resolveImagePaths(raw string) []string {
	parts := strings.Split(raw, ",")
	result := make([]string, 0, len(parts))
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p == "" {
			continue
		}
		result = append(result, p)
	}
	return result
}
