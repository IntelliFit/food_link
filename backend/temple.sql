-- WARNING: This schema is for context only and is not meant to be run.
-- Table order and constraints may not be valid for execution.

CREATE TABLE public.critical_samples (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  created_at timestamp with time zone DEFAULT now(),
  timestamp bigint,
  food_name text,
  image_url text,
  ai_weight double precision,
  user_weight double precision,
  deviation_percent integer,
  user_id uuid DEFAULT auth.uid(),
  CONSTRAINT critical_samples_pkey PRIMARY KEY (id),
  CONSTRAINT critical_samples_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id)
);
CREATE TABLE public.meal_items (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  meal_id uuid,
  name text,
  estimated_weight_grams double precision,
  original_weight_grams double precision,
  consumed_percentage integer DEFAULT 100,
  nutrients jsonb,
  user_id uuid NOT NULL DEFAULT auth.uid(),
  CONSTRAINT meal_items_pkey PRIMARY KEY (id),
  CONSTRAINT meal_items_meal_id_fkey FOREIGN KEY (meal_id) REFERENCES public.meals(id)
);
CREATE TABLE public.meals (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  created_at timestamp with time zone DEFAULT now(),
  timestamp bigint,
  description text,
  insight text,
  image_url text,
  global_scale integer DEFAULT 100,
  user_id uuid DEFAULT auth.uid(),
  CONSTRAINT meals_pkey PRIMARY KEY (id),
  CONSTRAINT meals_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id)
);
CREATE TABLE public.staple_meals (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  created_at timestamp with time zone DEFAULT now(),
  name text,
  image_url text,
  total_calories double precision,
  items jsonb,
  user_id uuid DEFAULT auth.uid(),
  CONSTRAINT staple_meals_pkey PRIMARY KEY (id),
  CONSTRAINT staple_meals_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id)
);