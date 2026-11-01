package wechattransfer

import (
	"context"
	"crypto"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"net/http"
	"strconv"
	"testing"
	"time"

	"food_link/backend/internal/migration"
	"food_link/backend/pkg/testdb"
	"food_link/backend/pkg/wechatpay"

	"github.com/google/uuid"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

const testAPIV3Key = "0123456789abcdef0123456789abcdef"

type notifyFixture struct {
	svc   *Service
	key   *rsa.PrivateKey
	now   time.Time
	hooks []Bill
}

func newNotifyFixture(t *testing.T) *notifyFixture {
	t.Helper()
	db := testdb.New(t)
	require.NoError(t, migration.MigrateWechatTransfer(context.Background(), db, "public"))
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	require.NoError(t, err)
	der, err := x509.MarshalPKIXPublicKey(&key.PublicKey)
	require.NoError(t, err)
	f := &notifyFixture{key: key, now: time.Date(2026, 11, 1, 10, 0, 0, 0, time.UTC)}
	f.svc = NewService(db, nil, Settings{
		MchID: "1105991965", AppID: "wx-mini", APIV3Key: testAPIV3Key,
		PublicKey: string(pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: der})),
	})
	f.svc.SetClock(func() time.Time { return f.now })
	f.svc.Register(BizPromoterWithdrawal, func(_ context.Context, _ *gorm.DB, bill Bill) error {
		f.hooks = append(f.hooks, bill)
		return nil
	})
	return f
}

func (f *notifyFixture) bill(t *testing.T, amount int64) *Bill {
	t.Helper()
	var bill *Bill
	require.NoError(t, f.svc.db.Transaction(func(tx *gorm.DB) error {
		var err error
		bill, err = f.svc.Insert(tx, NewBill{
			BizType: BizPromoterWithdrawal, BizID: uuid.NewString(), OutPrefix: "PW", OpenID: "o-payee",
			AmountCents: amount, Remark: "食探推广佣金", ReportInfos: []wechatpay.TransferSceneReportInfo{{InfoType: "岗位类型", InfoContent: "推广员"}},
		})
		return err
	}))
	return bill
}

// notify builds a signed, encrypted notification the way WeChat sends one.
func (f *notifyFixture) notify(t *testing.T, plain map[string]any, signedAt time.Time) (http.Header, []byte) {
	t.Helper()
	plaintext, err := json.Marshal(plain)
	require.NoError(t, err)
	block, err := aes.NewCipher([]byte(testAPIV3Key))
	require.NoError(t, err)
	gcm, err := cipher.NewGCM(block)
	require.NoError(t, err)
	nonce := "abcdefghijkl"
	sealed := gcm.Seal(nil, []byte(nonce), plaintext, []byte("mch_payment"))
	body, err := json.Marshal(map[string]any{
		"id": uuid.NewString(), "event_type": "MCHTRANSFER.BILL.FINISHED", "resource_type": "encrypt-resource",
		"resource": map[string]any{
			"algorithm": "AEAD_AES_256_GCM", "ciphertext": base64.StdEncoding.EncodeToString(sealed),
			"nonce": nonce, "associated_data": "mch_payment",
		},
	})
	require.NoError(t, err)
	timestamp := strconv.FormatInt(signedAt.Unix(), 10)
	headerNonce := uuid.NewString()
	digest := sha256.Sum256([]byte(timestamp + "\n" + headerNonce + "\n" + string(body) + "\n"))
	signature, err := rsa.SignPKCS1v15(rand.Reader, f.key, crypto.SHA256, digest[:])
	require.NoError(t, err)
	headers := http.Header{}
	headers.Set("Wechatpay-Signature", base64.StdEncoding.EncodeToString(signature))
	headers.Set("Wechatpay-Timestamp", timestamp)
	headers.Set("Wechatpay-Nonce", headerNonce)
	return headers, body
}

func TestNotifyFinishesBillOnceAndRejectsForgeries(t *testing.T) {
	ctx := context.Background()
	f := newNotifyFixture(t)
	bill := f.bill(t, 3000)
	plain := map[string]any{
		"out_bill_no": bill.OutBillNo, "transfer_bill_no": "1330000001", "state": StateSuccess, "mch_id": "1105991965",
		"transfer_amount": 3000, "openid": "o-payee", "create_time": "2026-11-01T18:00:00+08:00", "update_time": "2026-11-01T18:00:05+08:00",
	}

	headers, body := f.notify(t, plain, f.now)
	tampered := append([]byte{}, body...)
	tampered[len(tampered)-2] = ' '
	require.ErrorIs(t, f.svc.HandleNotify(ctx, headers, tampered), ErrBadNotify)
	oldHeaders, oldBody := f.notify(t, plain, f.now.Add(-10*time.Minute))
	require.ErrorIs(t, f.svc.HandleNotify(ctx, oldHeaders, oldBody), ErrBadNotify, "replayed notifications are refused")
	require.Empty(t, f.hooks)

	require.NoError(t, f.svc.HandleNotify(ctx, headers, body))
	require.NoError(t, f.svc.HandleNotify(ctx, headers, body), "WeChat resends; the second one is a no-op")
	require.Len(t, f.hooks, 1)
	require.Equal(t, StateSuccess, f.hooks[0].State)
	saved, err := f.svc.Get(ctx, bill.ID)
	require.NoError(t, err)
	require.Equal(t, "1330000001", saved.TransferBillNo)
	require.NotNil(t, saved.FinishedAt)
	require.NotNil(t, saved.WechatUpdatedAt)
	require.NotEmpty(t, saved.NotifyPayload)

	other := f.bill(t, 2000)
	plain["out_bill_no"], plain["transfer_amount"] = other.OutBillNo, 9999
	headers, body = f.notify(t, plain, f.now)
	require.Error(t, f.svc.HandleNotify(ctx, headers, body), "an amount that does not match is refused")
	saved, err = f.svc.Get(ctx, other.ID)
	require.NoError(t, err)
	require.Equal(t, StateCreated, saved.State)

	plain["out_bill_no"] = "PW00000000UNKNOWN"
	headers, body = f.notify(t, plain, f.now)
	require.NoError(t, f.svc.HandleNotify(ctx, headers, body), "bills that are not ours are acknowledged")
}

func TestApplyNeverMovesABillBackwards(t *testing.T) {
	ctx := context.Background()
	f := newNotifyFixture(t)
	bill := f.bill(t, 1000)
	_, err := f.svc.apply(ctx, bill.ID, &wechatpay.TransferBill{State: StateWaitUserConfirm, PackageInfo: "pkg"}, nil, "")
	require.NoError(t, err)
	saved, err := f.svc.apply(ctx, bill.ID, &wechatpay.TransferBill{State: StateFail, FailReason: createFailed}, nil, StateCreated)
	require.NoError(t, err)
	require.Equal(t, StateWaitUserConfirm, saved.State, "giving up only closes a bill WeChat never acknowledged")
	saved, err = f.svc.apply(ctx, bill.ID, &wechatpay.TransferBill{State: StateAccepted}, nil, "")
	require.NoError(t, err)
	require.Equal(t, StateWaitUserConfirm, saved.State)
	require.Equal(t, "pkg", saved.PackageInfo)
	saved, err = f.svc.apply(ctx, bill.ID, &wechatpay.TransferBill{State: StateCancelled, FailReason: "OVERDUE_CLOSE"}, nil, "")
	require.NoError(t, err)
	require.Equal(t, StateCancelled, saved.State)
	require.Empty(t, saved.PackageInfo, "a finished bill cannot be confirmed any more")
	_, err = f.svc.apply(ctx, bill.ID, &wechatpay.TransferBill{State: "DONE"}, nil, "")
	require.Error(t, err)
	require.Len(t, f.hooks, 2)

	closed := f.bill(t, 1000)
	_, err = f.svc.apply(ctx, closed.ID, &wechatpay.TransferBill{State: StateFail, FailReason: createFailed}, nil, StateCreated)
	require.NoError(t, err)
	saved, err = f.svc.apply(ctx, closed.ID, &wechatpay.TransferBill{State: StateSuccess}, nil, "")
	require.NoError(t, err)
	require.Equal(t, StateFail, saved.State)
	reloaded, err := f.svc.Get(ctx, closed.ID)
	require.NoError(t, err)
	require.Contains(t, reloaded.LastError, "SUCCESS", "a payout found after giving up is flagged for a person")
}
