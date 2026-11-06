package app

import (
	"context"

	campuscampaignservice "food_link/backend/internal/campuscampaign/service"
	researchweightservice "food_link/backend/internal/researchweight/service"
)

// campusCampaignAttributor lets weighed samples carry the contributor's
// campus campaign without the research module depending on campaigns.
type campusCampaignAttributor struct {
	campaigns *campuscampaignservice.CampaignService
}

func (a campusCampaignAttributor) AttributeSample(ctx context.Context, userID string, input researchweightservice.SubmitInput) (*researchweightservice.SampleAttribution, error) {
	result, err := a.campaigns.AttributeSample(ctx, userID, campuscampaignservice.SampleAttributionInput{
		StationSessionID: input.StationSessionID, CatalogItemID: input.CatalogItemID, PairedFoodRecordID: input.PairedFoodRecordID,
	})
	if err != nil || result == nil {
		return nil, err
	}
	return &researchweightservice.SampleAttribution{
		CampaignID: result.CampaignID, Channel: result.Channel, StationSessionID: result.StationSessionID,
		CanteenID: result.CanteenID, CatalogItemID: result.CatalogItemID, PairedFoodRecordID: result.PairedFoodRecordID,
	}, nil
}
