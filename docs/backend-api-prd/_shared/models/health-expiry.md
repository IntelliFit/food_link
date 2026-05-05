# Health Expiry

| Model | Fields | Source |
| --- | --- | --- |
| `HealthProfileUpdateRequest` | gender, birthday, height, weight, activity_level, medical_history, diet_preference, allergies, report_extract, report_image_url, diet_goal, health_notes, dashboard_targets, precision_reference_defaults, execution_mode, mode_set_by, mode_reason | `backend/main.py:6036` |
| `DashboardTargetsUpdateRequest` | calorie_target, protein_target, carbs_target, fat_target | `backend/main.py:6028` |
| `UploadReportImageRequest` | base64Image | `backend/main.py:7097` |
| `SubmitReportExtractionTaskRequest` | imageUrl | `backend/main.py:7124` |
| `HealthReportOcrRequest` | imageUrl, base64Image | `backend/main.py:7156` |
| `FoodExpiryItemUpsertRequest` | food_name, category, storage_type, quantity_note, expire_date, opened_date, note, source_type, status | `backend/main.py:5999` |
| `FoodExpiryRecognitionRequest` | image_urls, additional_context | `backend/main.py:6011` |
| `FoodExpiryStatusUpdateRequest` | status | `backend/main.py:6016` |
| `FoodExpirySubscribeRequest` | subscribe_status, err_msg | `backend/main.py:6020` |
