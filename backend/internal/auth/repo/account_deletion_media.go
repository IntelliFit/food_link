package repo

import (
	"context"
	"encoding/json"
	"food_link/backend/pkg/storage"
	"github.com/google/uuid"
	"github.com/lib/pq"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"net/url"
	"path"
	"sort"
	"strings"
)

var deletionImageSources = []struct {
	table, owner string
	columns      []string
}{
	{"user_food_records", "user_id", []string{"image_path", "image_paths"}},
	{"analysis_tasks", "user_id", []string{"image_url", "image_paths"}},
	{"user_exercise_logs", "user_id", []string{"image_url", "image_urls"}},
	{"user_circle_posts", "user_id", []string{"image_url", "image_urls", "image_paths"}},
	{"user_custom_foods", "user_id", []string{"image_path", "image_paths"}},
	{"public_food_library", "user_id", []string{"image_path", "image_paths"}},
	{"user_feedback", "user_id", []string{"image_urls"}},
	{"food_expiry_items", "user_id", []string{"image_url"}},
	{"private_messages", "sender_id", []string{"image_url"}},
}

// Legacy UUID-root uploads did not encode ownership. Only collect explicit
// original-image fields, preserving files still referenced by another user.
func (r *UserRepo) DeletionImages(ctx context.Context, id string) ([]storage.AccountObjectRef, error) {
	refs := []storage.AccountObjectRef{}
	seen := map[string]bool{}
	keys := []string{}
	for _, source := range deletionImageSources {
		for _, column := range source.columns {
			if !r.db.Migrator().HasColumn(source.table, column) {
				continue
			}
			var values []string
			if err := r.db.WithContext(ctx).Table(source.table).Select(column+"::text").Where(source.owner+" = ? AND "+column+" IS NOT NULL", id).Scan(&values).Error; err != nil {
				return nil, err
			}
			for _, raw := range values {
				var value any
				if json.Unmarshal([]byte(raw), &value) != nil {
					value = raw
				}
				for _, image := range deletionImageStrings(value) {
					if seen[image] {
						continue
					}
					seen[image] = true
					u, err := url.Parse(image)
					if err != nil {
						continue
					}
					key := path.Base(u.Path)
					if _, err := uuid.Parse(strings.TrimSuffix(key, path.Ext(key))); err != nil {
						continue
					}
					keys = append(keys, key)
					refs = append(refs, storage.AccountObjectRef{Bucket: "food-images", Value: image})
				}
			}
		}
	}
	shared := map[string]bool{}
	if len(keys) > 0 {
		for _, source := range deletionImageSources {
			for _, column := range source.columns {
				if !r.db.Migrator().HasColumn(source.table, column) {
					continue
				}
				var matches []string
				query := `SELECT key FROM unnest(?::text[]) AS wanted(key) WHERE EXISTS (SELECT 1 FROM ` + source.table + ` WHERE ` + source.owner + `::text <> ? AND ` + column + `::text LIKE '%' || wanted.key || '%')`
				if err := r.db.WithContext(ctx).Raw(query, pq.Array(keys), id).Scan(&matches).Error; err != nil {
					return nil, err
				}
				for _, key := range matches {
					shared[key] = true
				}
			}
		}
		if r.db.Migrator().HasColumn("campus_food_catalog_items", "image_paths") {
			var matches []string
			if err := r.db.WithContext(ctx).Raw(`SELECT key FROM unnest(?::text[]) AS wanted(key) WHERE EXISTS (SELECT 1 FROM campus_food_catalog_items WHERE image_paths::text LIKE '%' || wanted.key || '%')`, pq.Array(keys)).Scan(&matches).Error; err != nil {
				return nil, err
			}
			for _, key := range matches {
				shared[key] = true
			}
		}
	}
	for i, ref := range refs {
		u, _ := url.Parse(ref.Value)
		refs[i].Shared = shared[path.Base(u.Path)]
	}
	sort.Slice(refs, func(i, j int) bool { return refs[i].Value < refs[j].Value })
	return refs, nil
}

func (r *UserRepo) SaveDeletionImageCursor(ctx context.Context, id string, cursor int) error {
	return r.db.WithContext(ctx).Model(&AccountDeletion{}).Where("user_id = ? AND state = ?", id, "cleaning").Update("image_cursor", cursor).Error
}
func deletionImageStrings(value any) []string {
	switch v := value.(type) {
	case string:
		if strings.TrimSpace(v) != "" {
			return []string{v}
		}
	case []any:
		out := []string{}
		for _, item := range v {
			out = append(out, deletionImageStrings(item)...)
		}
		return out
	}
	return nil
}

func (r *UserRepo) WithActiveAccountWrite(ctx context.Context, id string, write func() error) error {
	return r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var user User
		if err := tx.Clauses(clause.Locking{Strength: "KEY SHARE"}).Where("id = ?", id).First(&user).Error; err != nil {
			return ErrDeletionSession
		}
		var count int64
		if err := tx.Model(&AccountDeletion{}).Where("user_id = ? AND state <> ?", id, "cancelled").Count(&count).Error; err != nil {
			return ErrDeletionUnavailable
		}
		if count > 0 {
			return ErrAccountDeleting
		}
		return write()
	})
}
