package wechatpay

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/json"
	"encoding/pem"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestTransferBillCreateAndQuery(t *testing.T) {
	privateKey, err := rsa.GenerateKey(rand.Reader, 2048)
	require.NoError(t, err)
	encoded, err := x509.MarshalPKCS8PrivateKey(privateKey)
	require.NoError(t, err)
	privatePEM := pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: encoded})

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		require.True(t, strings.HasPrefix(r.Header.Get("Authorization"), authSchema+" mchid=\"1105991965\""))
		w.Header().Set("Content-Type", "application/json")
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/v3/fund-app/mch-transfer/transfer-bills":
			var body map[string]any
			require.NoError(t, json.NewDecoder(r.Body).Decode(&body))
			require.Equal(t, "PW1", body["out_bill_no"])
			require.Equal(t, float64(3000), body["transfer_amount"])
			require.Len(t, body["transfer_scene_report_infos"], 2)
			_, _ = w.Write([]byte(`{"out_bill_no":"PW1","transfer_bill_no":"1330","state":"WAIT_USER_CONFIRM","package_info":"pkg"}`))
		case r.Method == http.MethodGet && r.URL.Path == "/v3/fund-app/mch-transfer/transfer-bills/out-bill-no/PW1":
			_, _ = w.Write([]byte(`{"mch_id":"1105991965","out_bill_no":"PW1","state":"SUCCESS","transfer_amount":3000,"openid":"o-1"}`))
		default:
			w.WriteHeader(http.StatusNotFound)
			_, _ = w.Write([]byte(`{"code":"NOT_FOUND","message":"记录不存在"}`))
		}
	}))
	defer server.Close()
	previousBase := wechatPayAPIBase
	wechatPayAPIBase = server.URL
	t.Cleanup(func() { wechatPayAPIBase = previousBase })

	client := NewClient("1105991965", "serial-1", "wx-mini", "", string(privatePEM))
	ctx := context.Background()
	created, err := client.CreateTransferBill(ctx, TransferBillRequest{
		AppID: "wx-mini", OutBillNo: "PW1", TransferSceneID: "1005", OpenID: "o-1", TransferAmount: 3000, TransferRemark: "佣金",
		TransferSceneReportInfos: []TransferSceneReportInfo{{InfoType: "岗位类型", InfoContent: "推广员"}, {InfoType: "报酬说明", InfoContent: "佣金"}},
	})
	require.NoError(t, err)
	require.Equal(t, "WAIT_USER_CONFIRM", created.State)
	require.Equal(t, "pkg", created.PackageInfo)

	queried, err := client.QueryTransferBill(ctx, "PW1")
	require.NoError(t, err)
	require.Equal(t, "SUCCESS", queried.State)
	require.Equal(t, int64(3000), queried.TransferAmount)

	_, err = client.QueryTransferBill(ctx, "PW2")
	require.True(t, IsNotFound(err))
	var apiErr *APIError
	require.ErrorAs(t, err, &apiErr)
	require.Equal(t, "NOT_FOUND", apiErr.Code)
}
