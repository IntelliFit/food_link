-- Optional Migration for AI Moderation Feature
-- The `status` column in `public_food_library` now supports 'pending', 'published', and 'rejected' states.

ALTER TABLE public_food_library DROP CONSTRAINT public_food_library_status_check;
ALTER TABLE public_food_library ADD CONSTRAINT public_food_library_status_check CHECK (status IN ('pending', 'published', 'rejected'));

-- Update analysis_tasks tag type check
ALTER TABLE analysis_tasks DROP CONSTRAINT analysis_tasks_task_type_check;
ALTER TABLE analysis_tasks ADD CONSTRAINT analysis_tasks_task_type_check CHECK (task_type IN ('food', 'health_report', 'food_text', 'public_food_library_text'));

