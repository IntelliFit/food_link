# Recipes Exercise

| Model | Fields | Source |
| --- | --- | --- |
| `CreateRecipeRequest` | recipe_name, description, image_path, items, total_calories, total_protein, total_carbs, total_fat, total_weight_grams, tags, meal_type, is_favorite | `backend/main.py:10665` |
| `UpdateRecipeRequest` | recipe_name, description, image_path, items, total_calories, total_protein, total_carbs, total_fat, total_weight_grams, tags, meal_type, is_favorite | `backend/main.py:10681` |
| `UseRecipeRequest` | meal_type | `backend/main.py:10801` |
| `ExerciseCaloriesEstimateRequest` | exercise_desc | `backend/main.py:12207` |
| `ExerciseLogResponse` | id, exercise_desc, calories_burned, recorded_on, recorded_at, ai_reasoning | `backend/main.py:12211` |
