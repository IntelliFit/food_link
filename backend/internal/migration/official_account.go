package migration

import (
	"context"
	"database/sql"
	"fmt"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

const (
	// The openid can never come from a WeChat code exchange, so nobody can log in as
	// this account. To hand it to a real WeChat later, update this one column.
	officialAccountOpenID   = "system:foodlink-official"
	officialAccountNickname = "食探官方"
	officialAccountAvatar   = "_system/default_avatar.jpg"
)

type officialPost struct {
	key   string
	title string
	body  string
}

// Listed newest first: the introduction stays on top of the feed.
var officialAccountPosts = []officialPost{
	{
		key:   "intro",
		title: "这里是食探官方",
		body:  "大家好，这里是食探官方账号。\n\n我们会在这里分享食探的使用方法、功能更新和一些日常饮食小知识。",
	},
	{
		key:   "photo-tips",
		title: "拍照记录怎么拍更准",
		body:  "几个小习惯，能让识别结果更接近实际：\n\n1. 尽量把整份食物拍全，光线不要太暗。\n2. 有多道菜时，尽量让每道菜都露出来，不要互相遮挡。\n3. 酱料、用油量这些从照片上看不出来，可以补一句文字说明。\n4. 识别结果有出入时，可以点“识别有误”纠错。\n\nAI 给出的是估算值，适合看长期趋势，不必纠结某一餐的小误差。",
	},
	{
		key:   "record-modes",
		title: "三种记录方式怎么选",
		body:  "拍照：食物就在眼前时最方便。\n\n文字：吃完才想起来记，或者手边没有照片时，用一句话描述就可以。\n\n食物库：吃的东西比较固定时，可以直接搜索添加，再调整克重。\n\n哪种顺手就用哪种，能坚持记录最重要。",
	},
	{
		key:   "exercise-detail",
		title: "运动记录可以写得更细",
		body:  "记运动时，可以直接写做了什么，比如“跑步 30 分钟”。\n\n如果想估算得更细，可以切换到“精准估算”，补充总时长、强度等信息。力量训练可以写上动作、重量、组数和次数。",
	},
	{
		key:   "imperfect-meals",
		title: "吃得不完美，也值得记下来",
		body:  "偶尔吃多了一顿，或者吃了想吃的零食，也可以照常记录。\n\n记录是为了看清自己的饮食习惯，不是为了给自己打分。看到规律之后，再慢慢调整就好。\n\n如果有疾病或特殊饮食需求，请以医生或营养师的建议为准。",
	},
}

// Published only once the mini program that shows the save switch is live.
var officialAccountPrivacyPost = officialPost{
	key:   "privacy-default",
	title: "你的记录谁能看到",
	body:  "关于圈子里的记录，说清楚三件事：\n\n1. 新注册账号保存的饮食、运动记录和照片默认对所有用户公开，第一次保存记录后会提醒你。\n2. 不想公开，可以在【我的】-【隐私设置】关闭“允许陌生人看到”，这样只有互相加了好友的人能看到。\n3. 再关闭“互相好友可以看到”，就只有你自己能看到。\n\n这些开关随时可以改。",
}

// OfficialAccountOptions selects what SeedOfficialAccount writes.
type OfficialAccountOptions struct {
	Apply       bool
	PrivacyPost bool
}

// OfficialAccountResult reports what exists and what the run wrote.
type OfficialAccountResult struct {
	SchemaReady    bool
	AccountExists  bool
	AccountCreated bool
	PostsExisting  int
	PostsCreated   int
	PostsPending   int
	Applied        bool
}

func officialAccountID() string {
	return uuid.NewSHA1(uuid.NameSpaceURL, []byte("foodlink:official-account")).String()
}

func officialPostID(key string) string {
	return uuid.NewSHA1(uuid.NameSpaceURL, []byte("foodlink:official-post:"+key)).String()
}

// SeedOfficialAccount creates the no-login official account, marked as agreeing to
// public records so the privacy flip leaves it alone, and publishes the posts. It is
// safe to repeat and never overwrites existing rows. Without Apply it runs in a
// read-only transaction and only counts. Post text bypasses per-user WeChat
// moderation because this openid cannot be checked, so every post here is reviewed
// in code.
func SeedOfficialAccount(ctx context.Context, db *gorm.DB, schema string, opts OfficialAccountOptions) (OfficialAccountResult, error) {
	var result OfficialAccountResult
	posts := officialAccountPosts
	if opts.PrivacyPost {
		// Newest first, so the announcement sits above the introduction.
		posts = append([]officialPost{officialAccountPrivacyPost}, officialAccountPosts...)
	}
	err := db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := setLocalSearchPath(tx, schema); err != nil {
			return err
		}
		accountID := officialAccountID()
		var ready int64
		if err := tx.Raw(`SELECT COUNT(*) FROM information_schema.columns
			WHERE table_schema = current_schema() AND table_name = 'weapp_user' AND column_name = 'public_records_consented_at'`).Scan(&ready).Error; err != nil {
			return fmt.Errorf("check consent column: %w", err)
		}
		result.SchemaReady = ready > 0
		if !result.SchemaReady && opts.Apply {
			return fmt.Errorf("weapp_user.public_records_consented_at 不存在，请先执行 -only-feed-privacy")
		}

		var existing, taken int64
		if err := tx.Raw(`SELECT COUNT(*) FROM weapp_user WHERE id = ?`, accountID).Scan(&existing).Error; err != nil {
			return fmt.Errorf("find official account: %w", err)
		}
		if err := tx.Raw(`SELECT COUNT(*) FROM weapp_user WHERE id <> ? AND (openid = ? OR lower(trim(coalesce(nickname, ''))) = lower(trim(?)))`,
			accountID, officialAccountOpenID, officialAccountNickname).Scan(&taken).Error; err != nil {
			return fmt.Errorf("check official account conflict: %w", err)
		}
		if taken > 0 {
			return fmt.Errorf("昵称或 openid 已被其他账号占用: %s", officialAccountNickname)
		}
		result.AccountExists = existing > 0

		now := time.Now().UTC()
		if !result.AccountExists && opts.Apply {
			if err := tx.Exec(`INSERT INTO weapp_user
				(id, openid, nickname, avatar, public_records, public_records_consented_at, public_records_reconfirm_pending, searchable, create_time)
				VALUES (?, ?, ?, ?, TRUE, ?, FALSE, FALSE, ?)`,
				accountID, officialAccountOpenID, officialAccountNickname, officialAccountAvatar, now, now).Error; err != nil {
				return fmt.Errorf("create official account: %w", err)
			}
			result.AccountCreated = true
		}

		for index, post := range posts {
			postID := officialPostID(post.key)
			var found int64
			if err := tx.Raw(`SELECT COUNT(*) FROM user_circle_posts WHERE id = ?`, postID).Scan(&found).Error; err != nil {
				return fmt.Errorf("find official post %s: %w", post.key, err)
			}
			if found > 0 {
				result.PostsExisting++
				continue
			}
			if !opts.Apply {
				result.PostsPending++
				continue
			}
			createdAt := now.Add(-time.Duration(index) * time.Minute)
			if err := tx.Exec(`INSERT INTO user_circle_posts
				(id, user_id, title, body, content, image_paths, hidden_from_feed, created_at, updated_at)
				VALUES (?, ?, ?, ?, '', '[]'::jsonb, FALSE, ?, ?)`,
				postID, accountID, post.title, post.body, createdAt, createdAt).Error; err != nil {
				return fmt.Errorf("create official post %s: %w", post.key, err)
			}
			result.PostsCreated++
		}
		result.Applied = opts.Apply
		return nil
	}, &sql.TxOptions{ReadOnly: !opts.Apply})
	return result, err
}
