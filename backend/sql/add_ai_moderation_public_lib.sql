-- Optional Migration for AI Moderation Feature
-- The `status` column in `public_food_library` now supports 'pending', 'published', and 'rejected' states.
-- If you previously set a CHECK constraint on this table restricting the `status` column to only 'published', 
-- you will need to update it. Otherwise, this script is not needed.

-- Example for updating a CHECK constraint (replace 'public_food_library_status_check' with actual constraint name if applicable):
-- ALTER TABLE public_food_library DROP CONSTRAINT public_food_library_status_check;
-- ALTER TABLE public_food_library ADD CONSTRAINT public_food_library_status_check CHECK (status IN ('pending', 'published', 'rejected'));
