# Analyze

| Model | Fields | Source |
| --- | --- | --- |
| `AnalyzeRequest` | base64Image, base64Image, image_url, image_urls, additionalContext, modelName, modelNames, user_goal, diet_goal, activity_timing, remaining_calories, meal_type, timezone_offset_minutes, province, city, district, execution_mode | `backend/main.py:2592` |
| `AnalyzeResponse` | description, insight, items, pfc_ratio_comment, absorption_notes, context_advice, analysis_engine, analysis_duration_ms, resolved_count, unresolved_count, recognitionOutcome, rejectionReason, retakeGuidance, allowedFoodCategory, followupQuestions, precisionSessionId, precisionStatus, precisionRoundIndex, pendingRequirements, retakeInstructions, referenceObjectNeeded, referenceObjectSuggestions, detectedItemsSummary, splitStrategy, uncertaintyNotes, redirectTaskId | `backend/main.py:2612` |
| `AnalyzeBatchRequest` | image_urls, meal_type, timezone_offset_minutes, diet_goal, activity_timing, user_goal, remaining_calories, additionalContext, modelName, execution_mode, reference_objects | `backend/main.py:3718` |
| `AnalyzeBatchResponse` | task_id, image_count, result | `backend/main.py:3733` |
| `AnalyzeTextRequest` | text, user_goal, remaining_calories, diet_goal, activity_timing, analysis_engine | `backend/main.py:5108` |
| `AnalyzeTextSubmitRequest` | text, meal_type, timezone_offset_minutes, province, city, district, diet_goal, activity_timing, user_goal, remaining_calories, additionalContext, execution_mode, analysis_engine, date, previousResult, correctionItems, precision_session_id, reference_objects, subscribe_status | `backend/main.py:5274` |
| `AnalyzeSubmitRequest` | image_url, image_urls, meal_type, timezone_offset_minutes, province, city, district, diet_goal, activity_timing, user_goal, remaining_calories, additionalContext, modelName, is_multi_view, execution_mode, date, analysis_engine, previousResult, correctionItems, precision_session_id, reference_objects, subscribe_status | `backend/main.py:4297` |
| `ContinuePrecisionSessionRequest` | source_type, image_url, image_urls, text, date, additionalContext, meal_type, timezone_offset_minutes, province, city, district, diet_goal, activity_timing, user_goal, remaining_calories, is_multi_view, reference_objects | `backend/main.py:5297` |
