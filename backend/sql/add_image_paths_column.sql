-- Add image_paths column to user_food_records table
ALTER TABLE user_food_records
ADD COLUMN image_paths jsonb DEFAULT '[]'::jsonb;

-- Add image_paths column to analysis_tasks table
ALTER TABLE analysis_tasks
ADD COLUMN image_paths jsonb DEFAULT '[]'::jsonb;
