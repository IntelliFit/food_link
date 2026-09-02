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
	"testing"

	"github.com/stretchr/testify/require"
)

func TestCreateNativeOrderReturnsQRCodeURL(t *testing.T) {
	privateKey, err := rsa.GenerateKey(rand.Reader, 2048)
	require.NoError(t, err)
	encoded, err := x509.MarshalPKCS8PrivateKey(privateKey)
	require.NoError(t, err)
	privatePEM := pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: encoded})

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		require.Equal(t, "/v3/pay/transactions/native", r.URL.Path)
		require.NotEmpty(t, r.Header.Get("Authorization"))
		var body map[string]any
		require.NoError(t, json.NewDecoder(r.Body).Decode(&body))
		require.Equal(t, "OA123", body["out_trade_no"])
		require.Equal(t, "https://api.example.test/api/developer/payment/wechat/notify", body["notify_url"])
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		_, _ = w.Write([]byte(`{"code_url":"weixin://wxpay/bizpayurl?pr=test"}`))
	}))
	defer server.Close()
	previousBase := wechatPayAPIBase
	wechatPayAPIBase = server.URL
	t.Cleanup(func() { wechatPayAPIBase = previousBase })

	client := NewClient("mch-1", "serial-1", "app-1", "https://api.example.test/api/developer/payment/wechat/notify", string(privatePEM))
	codeURL, err := client.CreateNativeOrder("OA123", "食探 API 点数", 2900)
	require.NoError(t, err)
	require.Equal(t, "weixin://wxpay/bizpayurl?pr=test", codeURL)
}

func TestQueryOrderReturnsWechatTradeState(t *testing.T) {
	privateKey, err := rsa.GenerateKey(rand.Reader, 2048)
	require.NoError(t, err)
	encoded, err := x509.MarshalPKCS8PrivateKey(privateKey)
	require.NoError(t, err)
	privatePEM := pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: encoded})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		require.Equal(t, "/v3/pay/transactions/out-trade-no/OA123", r.URL.Path)
		require.Equal(t, "mch-1", r.URL.Query().Get("mchid"))
		require.NotEmpty(t, r.Header.Get("Authorization"))
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"trade_state":"SUCCESS","transaction_id":"wx-1","amount":{"total":2900}}`))
	}))
	defer server.Close()
	previousBase := wechatPayAPIBase
	wechatPayAPIBase = server.URL
	t.Cleanup(func() { wechatPayAPIBase = previousBase })
	client := NewClient("mch-1", "serial-1", "app-1", "https://api.example.test/notify", string(privatePEM))
	state, err := client.QueryOrder(context.Background(), "OA123")
	require.NoError(t, err)
	require.Equal(t, "SUCCESS", state["trade_state"])
}
