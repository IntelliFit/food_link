package wechatpay

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
)

// TransferSceneReportInfo is one 转账场景报备信息 entry; scene 1005 (佣金报酬)
// needs exactly 岗位类型 and 报酬说明.
type TransferSceneReportInfo struct {
	InfoType    string `json:"info_type"`
	InfoContent string `json:"info_content"`
}

// TransferBillRequest starts a 商家转账 to a user's wallet. Amounts are in fen.
type TransferBillRequest struct {
	AppID                    string                    `json:"appid"`
	OutBillNo                string                    `json:"out_bill_no"`
	TransferSceneID          string                    `json:"transfer_scene_id"`
	OpenID                   string                    `json:"openid"`
	TransferAmount           int64                     `json:"transfer_amount"`
	TransferRemark           string                    `json:"transfer_remark"`
	NotifyURL                string                    `json:"notify_url,omitempty"`
	UserRecvPerception       string                    `json:"user_recv_perception,omitempty"`
	TransferSceneReportInfos []TransferSceneReportInfo `json:"transfer_scene_report_infos"`
}

// TransferBill is WeChat's view of one transfer, as returned when it is
// created, when it is queried, and in the decrypted notification.
type TransferBill struct {
	MchID          string `json:"mch_id"`
	OutBillNo      string `json:"out_bill_no"`
	TransferBillNo string `json:"transfer_bill_no"`
	AppID          string `json:"appid"`
	State          string `json:"state"`
	TransferAmount int64  `json:"transfer_amount"`
	OpenID         string `json:"openid"`
	FailReason     string `json:"fail_reason"`
	PackageInfo    string `json:"package_info"`
	CreateTime     string `json:"create_time"`
	UpdateTime     string `json:"update_time"`
}

// APIError is a non-2xx answer from WeChat Pay with its error code.
type APIError struct {
	Status  int
	Code    string
	Message string
}

func (e *APIError) Error() string {
	return fmt.Sprintf("wechat pay %d %s: %s", e.Status, e.Code, e.Message)
}

// IsNotFound reports whether WeChat itself says it has no such bill, which
// for a transfer means it was never created. A bare 404 from a proxy does
// not count.
func IsNotFound(err error) bool {
	var apiErr *APIError
	return errors.As(err, &apiErr) && apiErr.Code == "NOT_FOUND"
}

// CreateTransferBill starts a merchant transfer. Sending the same out_bill_no
// again returns the bill already created, so a retry after a timeout or an
// error is safe as long as the number stays the same.
func (c *Client) CreateTransferBill(ctx context.Context, req TransferBillRequest) (*TransferBill, error) {
	body, err := json.Marshal(req)
	if err != nil {
		return nil, fmt.Errorf("marshal payload: %w", err)
	}
	var bill TransferBill
	if err := c.call(ctx, http.MethodPost, "/v3/fund-app/mch-transfer/transfer-bills", body, &bill); err != nil {
		return nil, err
	}
	return &bill, nil
}

// QueryTransferBill reads a transfer by out_bill_no. WeChat keeps bills
// queryable for 30 days.
func (c *Client) QueryTransferBill(ctx context.Context, outBillNo string) (*TransferBill, error) {
	var bill TransferBill
	path := "/v3/fund-app/mch-transfer/transfer-bills/out-bill-no/" + url.PathEscape(outBillNo)
	if err := c.call(ctx, http.MethodGet, path, nil, &bill); err != nil {
		return nil, err
	}
	return &bill, nil
}

func (c *Client) call(ctx context.Context, method, canonicalURL string, body []byte, out any) error {
	auth, err := c.buildAuthorization(method, canonicalURL, string(body))
	if err != nil {
		return err
	}
	var reader io.Reader
	if body != nil {
		reader = bytes.NewReader(body)
	}
	req, err := http.NewRequestWithContext(ctx, method, wechatPayAPIBase+canonicalURL, reader)
	if err != nil {
		return fmt.Errorf("new request: %w", err)
	}
	req.Header.Set("Authorization", auth)
	req.Header.Set("Accept", "application/json")
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	req.Header.Set("User-Agent", "food-link/1.0")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return fmt.Errorf("do request: %w", err)
	}
	defer resp.Body.Close()
	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("read response: %w", err)
	}
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		var detail struct {
			Code    string `json:"code"`
			Message string `json:"message"`
		}
		_ = json.Unmarshal(respBody, &detail)
		if detail.Message == "" {
			detail.Message = string(respBody)
		}
		return &APIError{Status: resp.StatusCode, Code: detail.Code, Message: detail.Message}
	}
	if err := json.Unmarshal(respBody, out); err != nil {
		return fmt.Errorf("unmarshal response: %w", err)
	}
	return nil
}
