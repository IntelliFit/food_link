package service

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestPapayTemplateIDsCoverMembershipMatrix(t *testing.T) {
	expected := map[string]string{
		"light_monthly": "214835", "standard_monthly": "214826", "advanced_monthly": "214836",
		"light_quarterly": "214837", "standard_quarterly": "214838", "advanced_quarterly": "214839",
		"light_yearly": "214840", "standard_yearly": "214841", "advanced_yearly": "214842",
	}
	assert.Equal(t, expected, papayTemplateIDsByPlanCode)
}

func TestPapayV2SignatureAndXMLRoundTrip(t *testing.T) {
	values := map[string]string{
		"appid": "wx-food-link", "mch_id": "1900000001", "out_trade_no": "PAP202607130001", "total_fee": "1990",
	}
	values["sign"] = signPapayV2(values, "api-v2-key")
	assert.True(t, verifyPapayV2Sign(values, "api-v2-key"))
	assert.False(t, verifyPapayV2Sign(values, "wrong-key"))

	body, err := marshalPapayV2XML(values)
	require.NoError(t, err)
	decoded, err := parsePapayV2XML(body)
	require.NoError(t, err)
	assert.Equal(t, values, decoded)
}

func TestPapayPreNotifyTimeIsTwoChinaDaysBeforeRenewal(t *testing.T) {
	due := time.Date(2026, time.July, 15, 23, 30, 0, 0, time.UTC)
	notifyAt := papayPreNotifyTime(due)
	assert.Equal(t, time.Date(2026, time.July, 14, 10, 0, 0, 0, chinaLocation()), notifyAt)
	assert.Equal(t, time.Date(2026, time.July, 16, 10, 0, 0, 0, chinaLocation()), papayChargeTime(due))
}
