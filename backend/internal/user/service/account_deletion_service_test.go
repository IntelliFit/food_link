package service

import (
	"context"
	"errors"
	"food_link/backend/internal/auth/repo"
	"food_link/backend/internal/migration"
	migrationdo "food_link/backend/internal/migration/do"
	"food_link/backend/pkg/storage"
	"food_link/backend/pkg/testdb"
	"github.com/google/uuid"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
	"testing"
	"time"
)

type deletionObjects struct {
	fail            bool
	calls           int
	refs            []string
	failReferenceAt int
}

func (o *deletionObjects) DeleteAccountReferences(_ context.Context, _ string, refs []storage.AccountObjectRef) error {
	for _, ref := range refs {
		o.refs = append(o.refs, ref.Value)
	}
	if o.failReferenceAt > 0 && len(o.refs) == o.failReferenceAt {
		return errors.New("test legacy image deletion failure")
	}
	return nil
}

func (o *deletionObjects) DeleteAccountObjects(context.Context, string) error {
	o.calls++
	if o.fail {
		return errors.New("test storage unavailable")
	}
	return nil
}

func TestAccountDeletionLifecycle(t *testing.T) {
	defer testdb.Stop()
	ctx := context.Background()
	setup := func(t *testing.T) (*gorm.DB, *AccountDeletionService, string, string) {
		db := testdb.New(t)
		require.NoError(t, db.Exec(`CREATE TABLE weapp_user(id uuid PRIMARY KEY,openid text,nickname text,searchable boolean,public_records boolean,friends_can_view_records boolean,public_favorite_recipes boolean);
CREATE TABLE user_food_records(id uuid PRIMARY KEY,user_id uuid,image_path text);
CREATE TABLE public_food_library(id uuid PRIMARY KEY,user_id uuid,status text);
CREATE TABLE user_pro_memberships(id uuid PRIMARY KEY,user_id uuid);
CREATE TABLE pro_membership_payment_records(id uuid PRIMARY KEY,user_id uuid,order_no text,status text,amount numeric,wx_open_id text,notify_payload text);`).Error)
		id, other := uuid.NewString(), uuid.NewString()
		require.NoError(t, db.Exec(`INSERT INTO weapp_user VALUES(?,?,'first',true,false,true,NULL),(?,?,'other',true,true,true,true)`, id, "openid-first", other, "openid-other").Error)
		require.NoError(t, db.Exec(`INSERT INTO user_food_records VALUES(?,?,?),(?,?,?)`, uuid.NewString(), id, "original.jpg", uuid.NewString(), other, "other.jpg").Error)
		require.NoError(t, db.Exec(`INSERT INTO public_food_library VALUES(?,?,'published')`, uuid.NewString(), id).Error)
		require.NoError(t, migration.MigrateAccountDeletion(ctx, db, "public"))
		require.NoError(t, migration.MigrateAccountDeletion(ctx, db, "public"))
		s := NewAccountDeletionService(repo.NewUserRepo(db), &deletionObjects{}, 30)
		s.now = func() time.Time { return time.Date(2026, 11, 12, 4, 0, 0, 0, time.UTC) }
		return db, s, id, other
	}
	t.Run("request preserves data and cancellation restores exact privacy", func(t *testing.T) {
		db, s, id, _ := setup(t)
		start := s.now()
		_, err := s.Request(ctx, id, 5)
		require.Error(t, err)
		status, err := s.Request(ctx, id, 7)
		require.NoError(t, err)
		require.True(t, start.Add(7*24*time.Hour).Equal(*status.ExecuteAt))
		require.True(t, status.CanCancel)
		var flags struct {
			Searchable, PublicRecords, FriendsCanViewRecords *bool
			PublicFavoriteRecipes                            *bool
		}
		require.NoError(t, db.Table("weapp_user").Where("id = ?", id).Scan(&flags).Error)
		require.False(t, *flags.Searchable)
		require.False(t, *flags.FriendsCanViewRecords)
		require.ErrorIs(t, s.users.CheckAccountAccess(ctx, id, start.UnixNano()-1, "/api/user/account/deletion", "GET"), repo.ErrDeletionSession)
		require.NoError(t, s.users.CheckAccountAccess(ctx, id, start.UnixNano()+1, "/api/user/account/deletion", "GET"))
		require.ErrorIs(t, s.users.CheckAccountAccess(ctx, id, start.UnixNano()+1, "/api/user/profile", "GET"), repo.ErrAccountDeleting)
		require.Error(t, db.Exec("INSERT INTO user_food_records VALUES(?,?,?)", uuid.NewString(), id, "late.jpg").Error)
		s.now = func() time.Time { return start.Add(24 * time.Hour) }
		duplicate, err := s.Request(ctx, id, 0)
		require.NoError(t, err)
		require.Equal(t, *status.ExecuteAt, *duplicate.ExecuteAt)
		require.NoError(t, s.Cancel(ctx, id))
		require.NoError(t, db.Table("weapp_user").Where("id = ?", id).Scan(&flags).Error)
		require.True(t, *flags.Searchable)
		require.False(t, *flags.PublicRecords)
		require.True(t, *flags.FriendsCanViewRecords)
		require.Nil(t, flags.PublicFavoriteRecipes)
		var foodState string
		require.NoError(t, db.Table("public_food_library").Select("status").Where("user_id = ?", id).Scan(&foodState).Error)
		require.Equal(t, "published", foodState)
		require.ErrorIs(t, s.users.CheckAccountAccess(ctx, id, start.UnixNano()+1, "/api/user/profile", "GET"), repo.ErrDeletionSession)
		require.NoError(t, s.users.CheckAccountAccess(ctx, id, s.now().UnixNano()+1, "/api/user/profile", "GET"))
		require.NoError(t, db.Exec("INSERT INTO user_food_records VALUES(?,?,?)", uuid.NewString(), id, "restored.jpg").Error)
	})
	t.Run("deadline locks cancellation and failed cleanup retries", func(t *testing.T) {
		db, s, id, other := setup(t)
		start := s.now()
		require.NoError(t, db.Exec("INSERT INTO pro_membership_payment_records VALUES(?,?,?,'paid',9.9,?,'private')", uuid.NewString(), id, "test-order", "secret-payer").Error)
		_, err := s.Request(ctx, id, 7)
		require.NoError(t, err)
		s.now = func() time.Time { return start.Add(7 * 24 * time.Hour) }
		require.ErrorIs(t, s.Cancel(ctx, id), repo.ErrDeletionTooLate)
		objects := s.objects.(*deletionObjects)
		objects.fail = true
		require.NoError(t, s.Sweep(ctx))
		status, err := s.Status(ctx, id)
		require.NoError(t, err)
		require.Equal(t, "cleaning", status.State)
		require.False(t, status.CanCancel)
		user, err := s.users.FindByID(ctx, id)
		require.NoError(t, err)
		require.NotNil(t, user)
		objects.fail = false
		s.retentionDays = 0
		require.NoError(t, s.Sweep(ctx))
		require.Equal(t, 1, objects.calls, "missing evidence policy must stop before removing account objects")
		s.retentionDays = 30
		require.NoError(t, s.Sweep(ctx))
		status, err = s.Status(ctx, id)
		require.NoError(t, err)
		require.Equal(t, "completed", status.State)
		user, err = s.users.FindByID(ctx, id)
		require.NoError(t, err)
		require.Nil(t, user)
		user, err = s.users.FindByID(ctx, other)
		require.NoError(t, err)
		require.NotNil(t, user)
		var count int64
		require.NoError(t, db.Table("user_food_records").Where("user_id = ?", other).Count(&count).Error)
		require.EqualValues(t, 1, count)
		require.Error(t, db.Exec("INSERT INTO user_food_records VALUES(?,?,?)", uuid.NewString(), id, "resurrected.jpg").Error)
		var retained []migrationdo.AccountDeletionRetainedDO
		require.NoError(t, db.Find(&retained).Error)
		require.Len(t, retained, 1)
		require.Contains(t, retained[0].Payload, "test-order")
		require.NotContains(t, retained[0].Payload, "secret-payer")
		require.NotContains(t, retained[0].Payload, "private")
		s.now = func() time.Time { return start.AddDate(0, 0, 40) }
		require.NoError(t, s.Sweep(ctx))
		require.NoError(t, db.Model(&migrationdo.AccountDeletionRetainedDO{}).Count(&count).Error)
		require.Zero(t, count)
	})
	t.Run("immediate request has no cancellation window", func(t *testing.T) {
		_, s, id, _ := setup(t)
		status, err := s.Request(ctx, id, 0)
		require.NoError(t, err)
		require.False(t, status.CanCancel)
		require.ErrorIs(t, s.Cancel(ctx, id), repo.ErrDeletionTooLate)
		require.NoError(t, s.Sweep(ctx))
		status, err = s.Status(ctx, id)
		require.NoError(t, err)
		require.Equal(t, "completed", status.State)
	})
	t.Run("legacy images keep shared files and resume after partial failure", func(t *testing.T) {
		db, s, id, other := setup(t)
		first := "00000000-0000-4000-8000-000000000001.jpg"
		second := "00000000-0000-4000-8000-000000000002.jpg"
		shared := "00000000-0000-4000-8000-000000000003.jpg"
		for _, row := range []struct{ owner, image string }{{id, first}, {id, second}, {id, shared}, {other, shared}} {
			require.NoError(t, db.Exec("INSERT INTO user_food_records VALUES(?,?,?)", uuid.NewString(), row.owner, row.image).Error)
		}
		_, err := s.Request(ctx, id, 0)
		require.NoError(t, err)
		images, err := s.users.DeletionImages(ctx, id)
		require.NoError(t, err)
		require.Len(t, images, 3)
		require.True(t, images[2].Shared)
		objects := s.objects.(*deletionObjects)
		objects.failReferenceAt = 2
		require.NoError(t, s.Sweep(ctx))
		d, err := s.users.DeletionStatus(ctx, id)
		require.NoError(t, err)
		require.Equal(t, "cleaning", d.State)
		require.Equal(t, 1, d.ImageCursor)
		objects.failReferenceAt = 0
		require.NoError(t, s.Sweep(ctx))
		require.Equal(t, []string{first, second, second, shared}, objects.refs)
	})
	t.Run("suspension waits for an in-flight owned upload", func(t *testing.T) {
		_, s, id, _ := setup(t)
		started := make(chan struct{})
		release := make(chan struct{})
		writeDone := make(chan error, 1)
		go func() {
			writeDone <- s.users.WithActiveAccountWrite(ctx, id, func() error { close(started); <-release; return nil })
		}()
		<-started
		requested := make(chan error, 1)
		go func() { _, err := s.Request(ctx, id, 7); requested <- err }()
		select {
		case err := <-requested:
			t.Fatalf("suspension committed before upload finished: %v", err)
		case <-time.After(100 * time.Millisecond):
		}
		close(release)
		require.NoError(t, <-writeDone)
		require.NoError(t, <-requested)
	})
}
