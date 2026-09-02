package do

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestAllModelsIncludesOpenPlatformBillingTables(t *testing.T) {
	tables := map[string]bool{}
	for _, model := range AllModels() {
		if named, ok := model.(interface{ TableName() string }); ok {
			tables[named.TableName()] = true
		}
	}
	for _, table := range []string{
		"open_api_apps",
		"open_api_keys",
		"open_api_requests",
		"open_api_usage_ledger",
		"open_api_credit_packages",
		"open_api_payment_orders",
	} {
		require.True(t, tables[table], table)
	}
}
