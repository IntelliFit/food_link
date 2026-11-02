package service

import (
	"testing"

	"food_link/backend/pkg/config"
	"github.com/stretchr/testify/require"
)

func TestA6CurrentDomainUsesGeminiNativeRoute(t *testing.T) {
	require.True(t, isGeminiNativeModel(gemini3FlashModel, config.DefaultA6BaseURL))
	require.Equal(t,
		"https://api.a6api.vip/v1beta/models/gemini-3-flash-preview:generateContent",
		geminiNativeEndpoint(config.DefaultA6BaseURL, gemini3FlashModel))
}

func TestA6VisionRoutingMovesRetiredDomainToCurrentOne(t *testing.T) {
	s := NewAnalyzeService(nil, nil, nil)
	s.ConfigureA6VisionRouting("key", "https://api.a6api.com", config.VisionRoutingConfig{})
	client, ok := s.visionChannels.a6.(*OfoxAIClient)
	require.True(t, ok)
	require.Equal(t, config.DefaultA6BaseURL, client.BaseURL)
}
