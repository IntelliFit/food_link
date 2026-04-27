-- 扩展 user_food_records.meal_type 到 6 餐次（兼容 legacy snack）
-- 执行方式：在 PostgreSQL ????/SQL ???? 手动执行

ALTER TABLE public.user_food_records
DROP CONSTRAINT IF EXISTS user_food_records_meal_type_check;

ALTER TABLE public.user_food_records
ADD CONSTRAINT user_food_records_meal_type_check
CHECK (
  meal_type = ANY (
    ARRAY[
      'breakfast'::text,
      'morning_snack'::text,
      'lunch'::text,
      'afternoon_snack'::text,
      'dinner'::text,
      'evening_snack'::text,
      -- 兼容旧版本
      'snack'::text
    ]
  )
);
