ALTER TABLE public.comment_tasks
  ADD COLUMN IF NOT EXISTS extra jsonb NULL;
