package service

import (
	"reflect"
	"strings"
)

// Older internal callers construct the DTO directly. Capture their nonzero
// fields before defaults are applied; HTTP continuation uses exact field keys.
func preparePrecisionContinuationFields(input *SubmitTaskInput) {
	if input == nil || !hasPrecisionSessionID(*input) || input.ContinuationFields != nil {
		return
	}
	input.ContinuationFields = map[string]bool{}
	value := reflect.ValueOf(*input)
	typ := value.Type()
	for index := 0; index < value.NumField(); index++ {
		key := strings.Split(typ.Field(index).Tag.Get("json"), ",")[0]
		if key != "" && key != "-" && !value.Field(index).IsZero() {
			input.ContinuationFields[key] = true
		}
	}
	if options := input.PrecisionOptions; options != nil {
		input.ContinuationFields["precision_options.interactive"] = options.Interactive != nil
		input.ContinuationFields["precision_options.separate"] = options.Separate
		input.ContinuationFields["precision_options.web_search"] = options.WebSearch
	}
}

func mergePrecisionContinuationPayload(input SubmitTaskInput, submitted, previous map[string]any) map[string]any {
	preparePrecisionContinuationFields(&input)
	fields := input.ContinuationFields
	merged := copyMap(previous)
	for requestKey, payloadKey := range map[string]string{
		"date": "recorded_on", "meal_type": "meal_type", "province": "province", "city": "city", "district": "district",
		"diet_goal": "diet_goal", "activity_timing": "activity_timing", "user_goal": "user_goal", "remaining_calories": "remaining_calories",
		"suggest_ratio_enabled": "suggest_ratio_enabled", "analysis_engine": "analysis_engine", "precise_micronutrients": "precise_micronutrients",
		"modelName": "modelName", "timezone_offset_minutes": "timezone_offset_minutes", "capture_protocol": "capture_protocol",
		"capture_views": "capture_views", "video_capture": "video_capture", "previousResult": "previousResult", "correctionItems": "correctionItems",
	} {
		if fields[requestKey] {
			if value, ok := submitted[payloadKey]; ok {
				merged[payloadKey] = value
			}
		}
	}
	if fields["additionalContext"] {
		prior := strings.TrimSpace(stringFromAny(previous["additionalContext"]))
		next := strings.TrimSpace(input.AdditionalContext)
		if prior != "" && next != "" && prior != next {
			next = prior + "\n本轮补充（与先前说明冲突时以本轮为准）：" + next
		}
		merged["additionalContext"] = next
	}
	if (fields["text"] || fields["text_input"]) && strings.TrimSpace(input.TextInput) != "" {
		merged["text"] = input.TextInput
	}
	if fields["image_url"] && input.ImageURL != "" {
		merged["image_url"] = input.ImageURL
		if !fields["image_urls"] {
			merged["image_urls"] = []string{input.ImageURL}
		}
	}
	if fields["image_urls"] && len(input.ImageURLs) > 0 {
		merged["image_urls"] = input.ImageURLs
		if !fields["image_url"] {
			merged["image_url"] = input.ImageURLs[0]
		}
	}
	if fields["is_multi_view"] {
		merged["is_multi_view"] = input.IsMultiView
	}
	if fields["continue_with_uncertainty"] {
		merged["continue_with_uncertainty"] = input.ContinueWithUncertainty
	}
	if fields["reference_objects"] {
		merged["reference_objects"] = input.ReferenceObjects
	}
	if fields["reference_object"] && input.ReferenceObject != nil {
		for _, key := range []string{"reference_object", "reference_objects"} {
			if value, ok := submitted[key]; ok {
				merged[key] = value
			}
		}
	}
	if fields["precision_options"] && input.PrecisionOptions != nil {
		options := copyMap(mapFromAny(previous["precision_options"]))
		for _, key := range []string{"interactive", "separate", "web_search"} {
			if fields["precision_options."+key] {
				switch key {
				case "interactive":
					if input.PrecisionOptions.Interactive != nil {
						options[key] = *input.PrecisionOptions.Interactive
					}
				case "separate":
					options[key] = input.PrecisionOptions.Separate
				case "web_search":
					options[key] = input.PrecisionOptions.WebSearch
				}
			}
		}
		merged["precision_options"] = options
	}
	if fields["answers"] && len(input.Answers) > 0 {
		answers := append([]map[string]any(nil), mapSliceFromAny(previous["answers"])...)
		for _, answer := range mapSliceFromAny(submitted["answers"]) {
			found := false
			for index, old := range answers {
				if stringFromAny(old["question_id"]) == stringFromAny(answer["question_id"]) {
					answers[index], found = answer, true
					break
				}
			}
			if !found {
				answers = append(answers, answer)
			}
		}
		merged["answers"] = answers
	}
	for key, value := range input.ExtraPayload {
		merged[key] = value
	}
	for _, key := range []string{"source_type", "content_security_required"} {
		if value, ok := submitted[key]; ok {
			merged[key] = value
		}
	}
	return merged
}
