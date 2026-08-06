package service

import (
	"context"
	"encoding/json"
	"strings"

	"food_link/backend/internal/foodmedia"
	"food_link/backend/internal/search/repo"
	"food_link/backend/pkg/storage"
)

type ManualFoodItem struct {
	Name              string   `json:"name"`
	ManualSource      string   `json:"manual_source"`
	ManualSourceID    string   `json:"manual_source_id"`
	ManualSourceTitle string   `json:"manual_source_title"`
	SourceLabel       string   `json:"source_label"`
	ImagePath         string   `json:"image_path"`
	ImagePaths        []string `json:"image_paths"`
	PackagedFoodID    string   `json:"packaged_food_id"`
	MatchedFoodID     string   `json:"matched_food_id"`
	NutritionSource   string   `json:"nutrition_source"`
	Nutrients         struct {
		Calories float64 `json:"calories"`
	} `json:"nutrients"`
}

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

	ExerciseDesc   *string  `json:"exercise_desc,omitempty"`
	ExerciseType   *string  `json:"exercise_type,omitempty"`
	CaloriesBurned *float64 `json:"calories_burned"`
	DurationMin    *int     `json:"duration_min"`

	MealType      *string          `json:"meal_type,omitempty"`
	DietGoal      *string          `json:"diet_goal,omitempty"`
	EntryType     *string          `json:"entry_type,omitempty"`
	SourceTaskID  *string          `json:"source_task_id,omitempty"`
	RecipeID      *string          `json:"recipe_id,omitempty"`
	Items         []map[string]any `json:"items,omitempty"`
	ManualItems   []ManualFoodItem `json:"manual_food_items,omitempty"`
	ExerciseItems []map[string]any `json:"exercise_items,omitempty"`

	Author map[string]string `json:"author"`

	Liked        bool `json:"liked"`
	LikeCount    int  `json:"like_count"`
	CommentCount int  `json:"comment_count"`
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
	SearchUsers(ctx context.Context, currentUserID, keyword string, offset, limit int) ([]repo.UserRow, error)
	GetUserProfiles(ctx context.Context, userIDs []string) (map[string]*repo.UserProfileRow, error)
	GetFriendIDs(ctx context.Context, userID string) (map[string]bool, error)
	CountContent(ctx context.Context, currentUserID, keyword string) (int64, error)
	CountUsers(ctx context.Context, currentUserID, keyword string) (int64, error)
	GetLikesForTargets(ctx context.Context, targets []repo.LikeTarget, currentUserID string) (map[string]*repo.TargetLikeInfo, error)
	CountCommentsForTargets(ctx context.Context, targets []repo.LikeTarget) (map[string]int64, error)
}

type SearchService struct {
	repo         SearchRepo
	storage      *storage.Client
	blockChecker BlockChecker
}

type BlockChecker interface {
	GetBlockedPairUserIDs(ctx context.Context, userID string) ([]string, error)
}

func NewSearchService(searchRepo SearchRepo, storageClient *storage.Client) *SearchService {
	return &SearchService{
		repo:    searchRepo,
		storage: storageClient,
	}
}

func (s *SearchService) ConfigureBlockChecker(checker BlockChecker) {
	s.blockChecker = checker
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
	rows = s.filterBlockedContentRows(ctx, currentUserID, rows)

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

	// Collect target pairs and batch-fetch like/comment data
	targets := make([]repo.LikeTarget, 0, len(rows))
	for i := range rows {
		targets = append(targets, repo.LikeTarget{TargetType: rows[i].TargetType, TargetID: rows[i].TargetID})
	}
	likeMap, _ := s.repo.GetLikesForTargets(ctx, targets, currentUserID)
	commentCountMap, _ := s.repo.CountCommentsForTargets(ctx, targets)

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
		imagePath := cloneOptionalString(row.ImagePath)
		var items []map[string]any
		var manualItems []ManualFoodItem
		if row.TargetType == "food_record" {
			items = s.parseRecordItems(row.Items)
			items = foodmedia.EnrichFoodRecordDisplayFields(ctx, nil, s.storage, &imagePath, &imagePaths, items)
			manualItems = s.extractManualFoodItemsFromMaps(items)
		}
		var exerciseItems []map[string]any
		if row.TargetType == "exercise_log" {
			exerciseItems = s.parseRecordItems(row.ExerciseItems)
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
			EntryType:      row.EntryType,
			SourceTaskID:   row.SourceTaskID,
			RecipeID:       row.RecipeID,
			Items:          items,
			ManualItems:    manualItems,
			ExerciseItems:  exerciseItems,
			Liked:          getLikeInfo(likeMap, row.TargetType, row.TargetID).Liked,
			LikeCount:      getLikeInfo(likeMap, row.TargetType, row.TargetID).Count,
			CommentCount:   int(commentCountMap[row.TargetType+":"+row.TargetID]),
			Author:         author,
		}
		results[i].ImagePath = imagePath
		results[i].ImagePaths = imagePaths
	}
	return results, hasMore, nil
}

func getLikeInfo(likeMap map[string]*repo.TargetLikeInfo, targetType, targetID string) *repo.TargetLikeInfo {
	key := targetType + ":" + targetID
	if info, ok := likeMap[key]; ok {
		return info
	}
	return &repo.TargetLikeInfo{}
}

func cloneOptionalString(value *string) *string {
	if value == nil {
		return nil
	}
	cloned := strings.TrimSpace(*value)
	if cloned == "" {
		return nil
	}
	return &cloned
}

func (s *SearchService) parseRecordItems(raw *string) []map[string]any {
	if raw == nil || strings.TrimSpace(*raw) == "" {
		return nil
	}
	var items []map[string]any
	if err := json.Unmarshal([]byte(*raw), &items); err != nil {
		return nil
	}
	return items
}

func (s *SearchService) extractManualFoodItemsFromMaps(items []map[string]any) []ManualFoodItem {
	if len(items) == 0 {
		return nil
	}
	payload, err := json.Marshal(items)
	if err != nil {
		return nil
	}
	var parsed []ManualFoodItem
	if err := json.Unmarshal(payload, &parsed); err != nil {
		return nil
	}
	out := make([]ManualFoodItem, 0, len(parsed))
	for _, it := range parsed {
		src, srcID := s.resolveManualSource(it)
		if src == "" {
			continue
		}
		resolved := s.resolveFoodImageURLs(it)
		imagePath := ""
		if len(resolved) > 0 {
			imagePath = resolved[0]
		}
		title := strings.TrimSpace(it.ManualSourceTitle)
		if title == "" {
			title = strings.TrimSpace(it.Name)
		}
		label := strings.TrimSpace(it.SourceLabel)
		if label == "" {
			label = foodmedia.ManualSourceLabel(src)
		}
		out = append(out, ManualFoodItem{
			Name:              it.Name,
			ManualSource:      src,
			ManualSourceID:    srcID,
			ManualSourceTitle: title,
			SourceLabel:       label,
			ImagePath:         imagePath,
			ImagePaths:        resolved,
			Nutrients:         it.Nutrients,
		})
	}
	return out
}

func (s *SearchService) resolveManualSource(it ManualFoodItem) (string, string) {
	if src := strings.TrimSpace(it.ManualSource); src != "" {
		return src, strings.TrimSpace(it.ManualSourceID)
	}
	if id := strings.TrimSpace(it.PackagedFoodID); id != "" {
		return "packaged_food", id
	}
	if id := strings.TrimSpace(it.MatchedFoodID); id != "" {
		return "nutrition_library", id
	}
	if strings.Contains(strings.ToLower(it.NutritionSource), "packaged") {
		return "packaged_food", ""
	}
	return "", ""
}

func (s *SearchService) resolveFoodImageURLs(item ManualFoodItem) []string {
	if s.storage == nil {
		seen := make(map[string]struct{})
		var out []string
		collectRaw := func(v string) {
			v = strings.TrimSpace(v)
			if v == "" {
				return
			}
			if _, ok := seen[v]; ok {
				return
			}
			seen[v] = struct{}{}
			out = append(out, v)
		}
		for _, p := range item.ImagePaths {
			collectRaw(p)
		}
		collectRaw(item.ImagePath)
		return out
	}
	seen := make(map[string]struct{})
	var out []string
	collect := func(v string) {
		v = strings.TrimSpace(v)
		if v == "" {
			return
		}
		resolved := s.storage.ResolveReferenceURL("food-images", v)
		if resolved == "" {
			return
		}
		if _, ok := seen[resolved]; ok {
			return
		}
		seen[resolved] = struct{}{}
		out = append(out, resolved)
	}
	for _, p := range item.ImagePaths {
		collect(p)
	}
	collect(item.ImagePath)
	return out
}

func (s *SearchService) SearchUsers(ctx context.Context, currentUserID, keyword string, offset, limit int) ([]UserSearchResult, bool, error) {
	keyword = strings.TrimSpace(keyword)
	if keyword == "" {
		return nil, false, nil
	}

	rows, err := s.repo.SearchUsers(ctx, currentUserID, keyword, offset, limit+1)
	if err != nil {
		return nil, false, err
	}
	rows = s.filterBlockedUserRows(ctx, currentUserID, rows)

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
	userCount, err := s.repo.CountUsers(ctx, currentUserID, keyword)
	if err != nil {
		return nil, err
	}
	return &SearchCounts{
		ContentCount: contentCount,
		UserCount:    userCount,
	}, nil
}

func (s *SearchService) blockedUserSet(ctx context.Context, userID string) map[string]bool {
	userID = strings.TrimSpace(userID)
	if s.blockChecker == nil || userID == "" {
		return map[string]bool{}
	}
	ids, err := s.blockChecker.GetBlockedPairUserIDs(ctx, userID)
	if err != nil {
		return map[string]bool{}
	}
	out := make(map[string]bool, len(ids))
	for _, id := range ids {
		if strings.TrimSpace(id) != "" {
			out[id] = true
		}
	}
	return out
}

func (s *SearchService) filterBlockedContentRows(ctx context.Context, currentUserID string, rows []repo.ContentRow) []repo.ContentRow {
	blockedSet := s.blockedUserSet(ctx, currentUserID)
	if len(blockedSet) == 0 {
		return rows
	}
	out := make([]repo.ContentRow, 0, len(rows))
	for _, row := range rows {
		if row.UserID == currentUserID || !blockedSet[row.UserID] {
			out = append(out, row)
		}
	}
	return out
}

func (s *SearchService) filterBlockedUserRows(ctx context.Context, currentUserID string, rows []repo.UserRow) []repo.UserRow {
	blockedSet := s.blockedUserSet(ctx, currentUserID)
	if len(blockedSet) == 0 {
		return rows
	}
	out := make([]repo.UserRow, 0, len(rows))
	for _, row := range rows {
		if row.ID == currentUserID || !blockedSet[row.ID] {
			out = append(out, row)
		}
	}
	return out
}

func (s *SearchService) resolveAvatarURL(value string) string {
	value = strings.TrimSpace(value)
	if value == "" || s.storage == nil {
		return value
	}
	resolved := s.storage.ResolveUserAvatarURL(value)
	if resolved == "" {
		return value
	}
	return resolved
}

func (s *SearchService) resolveImagePaths(raw string) []string {
	var jsonPaths []string
	if err := json.Unmarshal([]byte(raw), &jsonPaths); err == nil {
		return dedupeTrimmedStrings(jsonPaths)
	}
	parts := strings.Split(raw, ",")
	result := make([]string, 0, len(parts))
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p == "" {
			continue
		}
		result = append(result, p)
	}
	return dedupeTrimmedStrings(result)
}

func dedupeTrimmedStrings(values []string) []string {
	if len(values) == 0 {
		return nil
	}
	out := make([]string, 0, len(values))
	seen := make(map[string]struct{}, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		out = append(out, value)
	}
	if len(out) == 0 {
		return nil
	}
	return out
}
