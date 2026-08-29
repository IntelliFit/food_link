package main

import (
	"testing"

	"food_link/backend/pkg/config"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestValidateExpectedTargetRequiresExactMatch(t *testing.T) {
	cfg := &config.Config{}
	cfg.Database.Host = "154.8.205.78"
	cfg.Database.Name = "food-link"
	cfg.Database.Schema = "public"
	opts := options{expectedHost: "154.8.205.78", expectedDB: "food-link", expectedSchema: "public"}

	require.NoError(t, validateExpectedTarget(cfg, opts))

	opts.expectedDB = "other"
	assert.ErrorContains(t, validateExpectedTarget(cfg, opts), "目标不匹配")
}

func TestValidateExpectedTargetRequiresAllGuards(t *testing.T) {
	cfg := &config.Config{}
	cfg.Database.Host = "154.8.205.78"
	cfg.Database.Name = "food-link"

	err := validateExpectedTarget(cfg, options{})

	assert.ErrorContains(t, err, "必须同时提供")
}
