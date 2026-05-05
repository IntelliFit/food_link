-- Upgrades content_violations table constraints to include new categories: harassment, spam

-- 1. Drop the old constraint
ALTER TABLE public.content_violations DROP CONSTRAINT IF EXISTS content_violations_category_check;

-- 2. Add the new constraint with updated category list
ALTER TABLE public.content_violations ADD CONSTRAINT content_violations_category_check CHECK (
    violation_category = ANY (ARRAY[
      'pornography'::text,
      'violence'::text,
      'politics'::text,
      'irrelevant_image'::text,
      'inappropriate_text'::text,
      'crime'::text,
      'harassment'::text,
      'spam'::text,
      'other'::text
    ])
);
