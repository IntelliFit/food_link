package service

import (
	"context"
	"errors"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type packagedVisionRoutingStub struct {
	nonMetaErr   error
	metaErr      error
	nonMetaCalls int
	metaCalls    int
}

func (s *packagedVisionRoutingStub) AnalyzeWithImagesAndTemperature(_ context.Context, _ string, _ []string, _ float64) (map[string]any, error) {
	s.nonMetaCalls++
	return nil, s.nonMetaErr
}

func (s *packagedVisionRoutingStub) AnalyzeWithImagesAndTemperatureMeta(_ context.Context, _ string, _ []string, _ float64) (map[string]any, map[string]any, error) {
	s.metaCalls++
	return nil, nil, s.metaErr
}

func TestFoodNutritionServiceRoutesLabelAndPackagedProductToSeparateClients(t *testing.T) {
	labelErr := errors.New("label client called")
	productErr := errors.New("product client called")
	labelClient := &packagedVisionRoutingStub{nonMetaErr: labelErr}
	productClient := &packagedVisionRoutingStub{metaErr: productErr}
	svc := NewFoodNutritionService(nil)
	svc.ConfigureNutritionLabelVisionClient(labelClient)
	svc.ConfigurePackagedProductVisionClient(productClient)

	_, err := svc.RecognizePackagedNutritionLabel(context.Background(), "https://example.com/label.jpg")
	require.ErrorIs(t, err, labelErr)
	assert.Equal(t, 1, labelClient.nonMetaCalls)
	assert.Equal(t, 0, productClient.nonMetaCalls)

	_, _, err = svc.ExtractPackagedProductWithMeta(context.Background(), []string{"https://example.com/front.jpg"}, "蛋白棒")
	require.ErrorIs(t, err, productErr)
	assert.Equal(t, 1, productClient.metaCalls)
	assert.Equal(t, 0, labelClient.metaCalls)
}
