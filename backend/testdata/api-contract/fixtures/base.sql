INSERT INTO weapp_user (
  id,
  openid,
  unionid,
  nickname,
  avatar,
  telephone,
  height,
  weight,
  gender,
  activity_level,
  health_condition,
  bmr,
  tdee,
  onboarding_completed,
  diet_goal,
  searchable,
  public_records,
  execution_mode,
  mode_set_by,
  earned_credits_balance,
  points_balance,
  create_time,
  update_time
) VALUES
(
  '{{auth.user1.id}}',
  '{{auth.user1.openid}}',
  '{{auth.user1.unionid}}',
  'E2E User',
  'user1/avatar.jpg',
  '13800000000',
  170,
  60,
  'male',
  'moderate',
  '{"routine_type":"23:00 睡，07:00 起"}'::jsonb,
  1500,
  2100,
  true,
  'none',
  true,
  true,
  'standard',
  'system',
  20,
  100,
  now() - interval '10 days',
  now()
),
(
  '{{auth.user2.id}}',
  '{{auth.user2.openid}}',
  '{{auth.user2.unionid}}',
  'E2E Friend',
  'user2/avatar.jpg',
  NULL,
  168,
  58,
  'female',
  'light',
  '{}'::jsonb,
  1450,
  1900,
  true,
  'none',
  true,
  true,
  'standard',
  'system',
  10,
  100,
  now() - interval '8 days',
  now()
);

INSERT INTO membership_plan_config (
  code,
  name,
  amount,
  duration_months,
  is_active,
  description,
  tier,
  period,
  daily_credits,
  original_amount,
  sort_order
) VALUES
('light_monthly', '轻享月卡', 19.9, 1, true, 'E2E light plan', 'light', 'monthly', 10, 29.9, 1),
('standard_monthly', '标准月卡', 39.9, 1, true, 'E2E standard plan', 'standard', 'monthly', 30, 59.9, 2);

INSERT INTO user_pro_memberships (
  user_id,
  current_plan_code,
  status,
  first_activated_at,
  current_period_start,
  expires_at,
  daily_credits
) VALUES (
  '{{auth.user1.id}}',
  'standard_monthly',
  'active',
  now() - interval '1 day',
  now() - interval '1 day',
  now() + interval '29 days',
  30
);

INSERT INTO user_body_metric_settings (user_id, water_goal_ml)
VALUES ('{{auth.user1.id}}', 2000);

INSERT INTO user_water_logs (user_id, recorded_on, amount_ml, source_type, recorded_at)
VALUES
('{{auth.user1.id}}', DATE '2026-05-14', 300, 'manual', TIMESTAMPTZ '2026-05-14 08:00:00+08'),
('{{auth.user1.id}}', DATE '2026-05-14', 250, 'manual', TIMESTAMPTZ '2026-05-14 11:00:00+08');

INSERT INTO user_weight_records (user_id, recorded_on, weight_kg, source_type, created_at, updated_at)
VALUES ('{{auth.user1.id}}', DATE '2026-05-14', 60.5, 'manual', TIMESTAMPTZ '2026-05-14 07:30:00+08', TIMESTAMPTZ '2026-05-14 07:30:00+08');

INSERT INTO user_exercise_logs (id, user_id, exercise_desc, calories_burned, duration_min, recorded_on, recorded_at)
VALUES ('00000000-0000-0000-0000-000000000041', '{{auth.user1.id}}', '慢跑 30 分钟', 220, 30, DATE '2026-05-14', TIMESTAMPTZ '2026-05-14 18:00:00+08');

INSERT INTO user_food_records (
  id,
  user_id,
  meal_type,
  image_path,
  image_paths,
  description,
  insight,
  items,
  total_calories,
  total_protein,
  total_carbs,
  total_fat,
  total_weight_grams,
  record_time,
  hidden_from_feed
) VALUES (
  '{{record.lunch.id}}',
  '{{auth.user1.id}}',
  'lunch',
  'user1/lunch.jpg',
  '["user1/lunch.jpg"]'::jsonb,
  'E2E 午餐',
  '测试洞察',
  '[{"name":"米饭","weight":200,"intake":200,"ratio":100,"calorie":230,"protein":4.8,"carbs":51,"fat":0.6,"nutrients":{"calories":230,"protein":4.8,"carbs":51,"fat":0.6}}]'::jsonb,
  230,
  4.8,
  51,
  0.6,
  200,
  TIMESTAMPTZ '2026-05-14 12:10:00+08',
  false
);

INSERT INTO food_expiry_items (
  id,
  user_id,
  food_name,
  quantity_note,
  storage_type,
  source_type,
  status,
  expire_date,
  created_at,
  updated_at
) VALUES (
  '{{expiry.milk.id}}',
  '{{auth.user1.id}}',
  '牛奶',
  '2盒',
  'refrigerated',
  'manual',
  'active',
  DATE '2026-05-16',
  now(),
  now()
);

INSERT INTO manual_food_library (id, name, category, calories, protein, carbs, fat)
VALUES ('00000000-0000-0000-0000-000000000061', '米饭', '主食', 116, 2.6, 25.9, 0.3);

INSERT INTO user_recipes (
  id,
  user_id,
  recipe_name,
  description,
  items,
  total_calories,
  total_protein,
  total_carbs,
  total_fat,
  total_weight_grams,
  tags,
  meal_type,
  is_favorite,
  use_count
) VALUES (
  '{{recipe.basic.id}}',
  '{{auth.user1.id}}',
  'E2E 米饭套餐',
  '基础测试菜谱',
  '[{"name":"米饭","weight":200,"calorie":230}]'::jsonb,
  230,
  4.8,
  51,
  0.6,
  200,
  ARRAY['主食'],
  'lunch',
  true,
  0
);
