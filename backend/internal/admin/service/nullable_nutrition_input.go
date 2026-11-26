package service

import (
	"encoding/json"
	"food_link/backend/internal/foodrecord/domain"
)

// Omission is unknown on creation; on PATCH omission is unchanged and explicit
// null clears the value. Neither case can be silently turned into a numeric zero.
func (input *CreateFoodNutritionInput) UnmarshalJSON(data []byte) error {
	type plain CreateFoodNutritionInput
	var value plain
	if err := json.Unmarshal(data, &value); err != nil {
		return err
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(data, &fields); err != nil {
		return err
	}
	*input = CreateFoodNutritionInput(value)
	for column := range domain.NutritionFields {
		raw, ok := fields[column]
		if !ok || string(raw) == "null" {
			input.UnknownNutritionFields = append(input.UnknownNutritionFields, column)
		}
	}
	return nil
}
func (input *UpdateFoodNutritionInput) UnmarshalJSON(data []byte) error {
	type plain UpdateFoodNutritionInput
	var value plain
	if err := json.Unmarshal(data, &value); err != nil {
		return err
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(data, &fields); err != nil {
		return err
	}
	*input = UpdateFoodNutritionInput(value)
	for column := range domain.NutritionFields {
		raw, ok := fields[column]
		if ok && string(raw) == "null" {
			input.UnknownNutritionFields = append(input.UnknownNutritionFields, column)
		}
	}
	return nil
}
