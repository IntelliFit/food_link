export interface ApiResponse<T = unknown> {
  code: number
  message: string
  data: T
}

export type CanonicalMealType =
  | 'breakfast'
  | 'morning_snack'
  | 'lunch'
  | 'afternoon_snack'
  | 'dinner'
  | 'evening_snack'

export type MealType = CanonicalMealType | 'snack'
export type DietGoal = 'fat_loss' | 'muscle_gain' | 'maintain' | 'none'
export type ActivityTiming = 'post_workout' | 'daily' | 'before_sleep' | 'none'
export type UserGoal = 'muscle_gain' | 'fat_loss' | 'maintain'
export type ExecutionMode =
  | 'lite'
  | 'standard'
  | 'standard_web_search'
  | 'fast'
  | 'fast_web_search'
  | 'standard_packaged_experiment'
  | 'strict'
  | 'strict_separate'
  | 'strict_web_search'
  | 'experimental'
  | 'gemini35_flash'
  | 'gemini35_flash_grouped'

export type AnalysisEngine = 'legacy_direct' | 'db_first'

export interface Nutrients {
  calories: number
  protein: number
  carbs: number
  fat: number
  fiber: number
  sugar: number
  waterMl?: number
  water_ml?: number
  sodiumMg?: number
  sodium_mg?: number
  [key: string]: number | undefined
}

export interface UnitNutritionPer100g extends Nutrients {}

export interface FoodItem {
  itemId?: number
  name: string
  type?: string
  food_type?: string
  category?: string
  estimatedWeightGrams: number
  originalWeightGrams: number
  grossWeightGrams?: number
  gross_weight_grams?: number
  ediblePortionRatio?: number
  edible_portion_ratio?: number
  ediblePortionReason?: string
  edible_portion_reason?: string
  ediblePortionSource?: string
  edible_portion_source?: string
  suggestedRatio?: number
  suggestedRatioReason?: string
  suggestedRatioSource?: string
  suggested_ratio?: number
  suggested_ratio_reason?: string
  suggested_ratio_source?: string
  waterMl?: number
  water_ml?: number
  nutrients: Nutrients
  unit_nutrition_per_100g?: UnitNutritionPer100g
  matched_food_id?: string | null
  matchedFoodId?: string | null
  nutrition_source?: string | null
  nutritionSource?: string | null
  nutrition_source_category?: string | null
  nutritionSourceCategory?: string | null
  packaged_food_id?: string
  packagedFoodId?: string
  package_match_status?: string
  packageMatchStatus?: string
  package_match_confidence?: number
  packageMatchConfidence?: number
  package_weight_source?: string
  packageWeightSource?: string
  package_weight_applied?: boolean
  packageWeightApplied?: boolean
  package_weight_reason?: string
  packageWeightReason?: string
  packaged_candidates?: Array<Record<string, unknown>>
  packagedCandidates?: Array<Record<string, unknown>>
}

export interface FoodRecordItemPayload {
  name: string
  weight: number
  ratio: number
  intake: number
  image_path?: string
  image_paths?: string[]
  gross_weight_grams?: number
  edible_portion_ratio?: number
  edible_portion_reason?: string
  edible_portion_source?: string
  suggested_ratio?: number
  suggested_ratio_reason?: string
  suggested_ratio_source?: string
  water_ml?: number
  nutrition_source?: string | null
  nutrition_source_category?: string | null
  matched_food_id?: string | null
  packaged_food_id?: string
  package_match_status?: string
  package_match_confidence?: number
  package_weight_source?: string
  package_weight_applied?: boolean
  package_weight_reason?: string
  packaged_candidates?: Array<Record<string, unknown>>
  nutrients: Nutrients
  manual_source?: 'public_library' | 'nutrition_library' | 'packaged_food' | 'custom'
  manual_source_id?: string
  manual_source_title?: string
  manual_portion_label?: string
}

export type FoodRecordEntryType =
  | 'food_image'
  | 'food_text'
  | 'food_library'
  | 'favorite_recipe'
  | 'analyze_history'
  | 'campus_canteen'
  | 'public_food_library'
  | 'unknown'

export interface SaveFoodRecordRequest {
  meal_type: MealType
  image_path?: string
  image_paths?: string[]
  description?: string
  insight?: string
  items: FoodRecordItemPayload[]
  total_calories: number
  total_protein: number
  total_carbs: number
  total_fat: number
  total_weight_grams: number
  diet_goal?: DietGoal
  activity_timing?: ActivityTiming
  pfc_ratio_comment?: string
  absorption_notes?: string
  context_advice?: string
  source_task_id?: string
  entry_type?: FoodRecordEntryType
  date?: string
}

export interface FoodRecordItemRow {
  name: string
  weight: number
  ratio: number
  intake: number
  nutrients: Nutrients
  image_path?: string | null
  image_paths?: string[] | null
  gross_weight_grams?: number
  edible_portion_ratio?: number
  edible_portion_reason?: string | null
  edible_portion_source?: string | null
  suggested_ratio?: number
  suggested_ratio_reason?: string | null
  suggested_ratio_source?: string | null
  waterMl?: number
  water_ml?: number
  nutrition_source?: string | null
  nutrition_source_category?: string | null
  matched_food_id?: string | null
  packaged_food_id?: string
  package_match_status?: string
  package_match_confidence?: number
  package_weight_source?: string
  package_weight_applied?: boolean
  package_weight_reason?: string
  packaged_candidates?: Array<Record<string, unknown>>
  manual_source?: 'public_library' | 'nutrition_library' | 'packaged_food' | 'custom'
  manual_source_id?: string
  manual_source_title?: string
  manual_portion_label?: string
}

export interface FoodRecord {
  id: string
  user_id: string
  meal_type: MealType
  image_path?: string | null
  image_paths?: string[] | null
  description?: string | null
  insight?: string | null
  items: FoodRecordItemRow[]
  total_calories: number
  total_protein: number
  total_carbs: number
  total_fat: number
  total_weight_grams: number
  record_time: string
  created_at: string
  diet_goal?: string | null
  activity_timing?: string | null
  source_task_id?: string | null
}

export interface HomeMicronutrientItem {
  current: number
  target: number
  progress: number
}

export interface HomeIntakeData {
  current: number
  target: number
  progress: number
  macros: {
    protein: { current: number; target: number }
    carbs: { current: number; target: number }
    fat: { current: number; target: number }
  }
  micros?: Record<string, HomeMicronutrientItem | number>
}

export interface HomeMealRecordEntry {
  id: string
  record_time?: string
  total_calories?: number
  total_protein?: number
  total_carbs?: number
  total_fat?: number
  image_path?: string | null
  image_paths?: string[] | null
  title?: string
  full_record?: FoodRecord
}

export interface HomeMealItem {
  type: string
  name: string
  time: string
  calorie: number
  target: number
  progress: number
  tags: string[]
  image_path?: string | null
  image_paths?: string[] | null
  images?: string[] | null
  primary_record_id?: string | null
  primaryRecordId?: string | null
  meal_record_entries?: HomeMealRecordEntry[] | null
  protein?: number
  carbs?: number
  fat?: number
  water_ml?: number
  waterMl?: number
  description?: string
}

export interface HomeDashboard {
  intakeData: HomeIntakeData
  meals: HomeMealItem[]
  exerciseBurnedKcal?: number
  achievement?: HomeAchievement | null
  nutritionTarget?: HomeNutritionTarget | null
  expirySummary?: HomeFoodExpirySummary | null
}

export interface HomeAchievement {
  streak_days?: number
  record_days?: number
  total_records?: number
  [key: string]: unknown
}

export interface HomeTargetCalibrationSuggestion {
  available?: boolean
  suggested_kcal?: number
  current_kcal?: number
  delta_kcal?: number
  reason?: string
  food_record_days?: number
  weight_records?: number
  source?: string
}

export interface HomeNutritionTarget {
  calories?: number
  protein?: number
  carbs?: number
  fat?: number
  source?: 'manual' | 'system_initial' | 'profile' | 'dynamic' | 'default' | string
  diet_goal?: DietGoal | string
  base_calorie_target?: number
  suggested_calorie_target?: number
  today_exercise_kcal?: number
  exercise_added_kcal?: number
  exercise_surplus_kcal?: number
  exercise_threshold_kcal?: number
  recent_exercise_avg_kcal?: number
  recent_exercise_days?: number
  activity_multiplier?: number
  explanation?: string
  macro_explanation?: string
  calibration_suggestion?: HomeTargetCalibrationSuggestion | null
  [key: string]: unknown
}

export interface HomeFoodExpiryItem {
  id: string
  food_name: string
  expire_date: string
  urgency?: 'expired' | 'today' | 'soon' | 'fresh'
  urgency_label?: string
  days_until_expire?: number | null
}

export interface HomeFoodExpirySummary {
  active_count: number
  expired_count: number
  today_count: number
  soon_count: number
  preview_items?: HomeFoodExpiryItem[]
}

export interface LoginResponse {
  access_token: string
  refresh_token: string
  token_type: string
  expires_in: number
  user_id: string
  openid: string
  unionid?: string
  phoneNumber?: string
  purePhoneNumber?: string
  countryCode?: string
  diet_goal?: string
}

export interface MembershipStatus {
  is_pro: boolean
  status: 'inactive' | 'active' | 'expired' | 'cancelled'
  current_plan_code?: string | null
  first_activated_at?: string | null
  current_period_start?: string | null
  expires_at?: string | null
  last_paid_at?: string | null
  daily_limit: number | null
  daily_used: number | null
  daily_remaining: number | null
  daily_credits_max?: number
  daily_credits_used?: number
  daily_credits_remaining?: number
  daily_credits_base?: number
  daily_bonus_credits?: number
  invite_bonus_credits?: number
  share_bonus_credits?: number
  system_credits_remaining?: number
  earned_credits_balance?: number
  earned_credits_consumed_today?: number
  total_credits_available?: number
  credits_reset_at?: string | null
  trial_active?: boolean
  trial_expires_at?: string | null
  trial_days_total?: number
  trial_policy?: unknown
  early_user_rank?: number | null
  early_user_limit?: number
  early_paid_user_rank?: number | null
  early_paid_user_limit?: number
  early_user_paid_bonus_multiplier?: number
  early_user_paid_bonus_eligible?: boolean
  early_user_paid_bonus_source?: unknown
  early_user_paid_bonus_active?: boolean
  points_balance?: number
}

export interface MembershipPlan {
  code: string
  name: string
  description?: string | null
  amount: number
  original_amount?: number | null
  savings?: number | null
  duration_months: number
  tier?: string | null
  period?: string | null
  daily_credits?: number
  sort_order?: number
}

export type MembershipPaymentChannel = 'wechat' | 'wechat_app' | 'wechat_mini_program' | 'alipay' | string
export type MembershipPaymentTradeType = 'JSAPI' | 'APP' | string

export interface CreateMembershipPaymentOptions {
  payChannel?: MembershipPaymentChannel
  tradeType?: MembershipPaymentTradeType
  client?: string
}

export interface WechatAppPayParams {
  appId: string
  partnerId: string
  prepayId: string
  package?: string
  packageValue: string
  nonceStr: string
  timeStamp: string
  sign: string
}

export interface MembershipPaymentOrder {
  order_no: string
  plan_code: string
  amount: number
  original_amount?: number
  order_mode?: string
  upgrade_terms?: Record<string, unknown> | null
  pay_channel?: MembershipPaymentChannel
  trade_type?: MembershipPaymentTradeType
  prepay_id?: string
  pay_params?: Record<string, string> & Partial<WechatAppPayParams>
  status?: string
  [key: string]: unknown
}

export interface AnalyzeTaskSubmitParams {
  image_url: string
  image_urls?: string[]
  meal_type?: MealType
  date?: string
  timezone_offset_minutes?: number
  diet_goal?: string
  activity_timing?: string
  user_goal?: string
  remaining_calories?: number
  suggest_ratio_enabled?: boolean
  additionalContext?: string
  modelName?: string
  is_multi_view?: boolean
  execution_mode?: ExecutionMode
  analysis_engine?: AnalysisEngine
}

export interface UpdateFoodRecordRequest {
  meal_type?: MealType
  items?: FoodRecordItemPayload[]
  total_calories?: number
  total_protein?: number
  total_carbs?: number
  total_fat?: number
  total_weight_grams?: number
  description?: string
  image_path?: string
  image_paths?: string[]
  diet_goal?: DietGoal
  activity_timing?: ActivityTiming
}

export interface AnalysisTask {
  id: string
  user_id: string
  task_type: string
  image_url?: string | null
  image_paths?: string[] | null
  text_input?: string | null
  status: 'pending' | 'processing' | 'done' | 'failed' | 'violated' | 'timed_out' | 'cancelled'
  payload?: Record<string, unknown>
  result?: {
    items?: FoodItem[]
    description?: string
    insight?: string
    total_calories?: number
    total_protein?: number
    total_carbs?: number
    total_fat?: number
    total_weight_grams?: number
    score_enabled?: boolean
    micronutrient_score?: number
    macro_balance_score?: number
    calorie_score?: number
    final_score?: number
    [key: string]: unknown
  } | null
  error_message?: string
  trace_id?: string | null
  traceId?: string | null
  is_recorded?: boolean
  record_id?: string
  created_at: string
  updated_at: string
}

export interface AnalyzeTaskStatusCount {
  total: number
  pending: number
  processing: number
  done: number
  failed: number
  violated?: number
  timed_out?: number
  cancelled?: number
}

export interface UserInfo {
  id: string
  openid?: string
  unionid?: string
  username?: string | null
  has_password?: boolean
  password_set_at?: string | null
  nickname: string
  avatar: string
  cover_image?: string
  motto?: string
  telephone?: string
  create_time?: string
  update_time?: string
  height?: number | null
  weight?: number | null
  birthday?: string | null
  gender?: string | null
  activity_level?: string | null
  bmr?: number | null
  tdee?: number | null
  onboarding_completed?: boolean
  execution_mode?: ExecutionMode | null
  searchable?: boolean
  public_records?: boolean
}

export interface HealthReportIndicator {
  name?: string
  value?: string | number
  unit?: string
  flag?: string
  reference_range?: string
  [key: string]: unknown
}

export interface HealthReportExtract {
  indicators?: HealthReportIndicator[]
  conclusions?: string[]
  suggestions?: string[]
  medical_notes?: string
  _image_urls?: string[]
  _status?: 'processing' | 'done' | 'failed' | string
  _error?: string
  [key: string]: unknown
}

export interface HealthCondition {
  medical_history?: string[]
  diet_preference?: string[]
  allergies?: string[]
  health_notes?: string
  routine_type?: string
  routine_sleep_hour?: number
  routine_wake_hour?: number
  daily_life_activity_level?: string
  report_extract?: HealthReportExtract
  dashboard_targets?: Record<string, number>
  [key: string]: unknown
}

export interface HealthProfile extends UserInfo {
  diet_goal?: string | null
  health_condition?: HealthCondition
  daily_life_activity_level?: string
  mode_set_by?: string | null
  mode_set_at?: string | null
  mode_reason?: string | null
  mode_commitment_days?: number | null
  mode_switch_count_30d?: number | null
}

export type StatsRange = 'week' | 'month'

export interface StatsInsightResult {
  analysis_summary?: string
  analysis_summary_generated_date?: string
  analysis_summary_needs_refresh?: boolean
  analysis_summary_daily_limit?: number
  analysis_summary_used_today?: number
  content?: string
  generated_date?: string
  date_range?: string
  range?: string
  needs_refresh?: boolean
  daily_limit?: number
  used_today?: number
  [key: string]: unknown
}

export interface StatsCustomFocusResult {
  card?: Record<string, unknown>
  custom_focus_daily_limit?: number
  custom_focus_used_today?: number
  custom_focus_remaining_today?: number
}

export interface DietRecommendationResult {
  title?: string
  summary?: string
  recommendations?: Array<{
    title?: string
    reason?: string
    foods?: string[]
    calories?: number
    protein?: number
    carbs?: number
    fat?: number
    [key: string]: unknown
  }>
  [key: string]: unknown
}

export interface BodyMetricWeightEntry {
  id?: string
  date: string
  value: number
  client_id?: string | null
  recorded_at?: string | null
}

export interface BodyMetricWaterLogItem {
  id?: string
  date: string
  amount_ml: number
  recorded_at?: string | null
}

export interface BodyMetricWaterDay {
  date: string
  total: number
  logs: number[]
  log_items?: BodyMetricWaterLogItem[]
}

export interface BodyMetricsSummary {
  range: StatsRange
  start_date: string
  end_date: string
  weight_entries: BodyMetricWeightEntry[]
  weight_trend_daily?: Array<{ date: string; value: number }>
  latest_weight?: BodyMetricWeightEntry | null
  previous_weight?: BodyMetricWeightEntry | null
  weight_change?: number | null
  water_goal_ml: number
  today_water: BodyMetricWaterDay
  water_daily: BodyMetricWaterDay[]
  total_water_ml: number
  avg_daily_water_ml: number
  water_recorded_days: number
}

export interface RiskCard {
  key: string
  title: string
  score: number
  tone: 'positive' | 'neutral' | 'warning' | 'danger'
  brief: string
  summary: string
  basis: string
  action: string
  delta: number
}

export interface HealthIndex {
  has_enough_data: boolean
  overall_score: number
  projected_score: number
  overall_trend_label: string
  overview_copy: string
  risk_cards: RiskCard[]
  top_issues: Array<{ title: string; detail: string }>
  action_list: string[]
}

export interface StatsSummary {
  range: StatsRange
  start_date: string
  end_date: string
  tdee: number
  streak_days: number
  recorded_days?: number
  total_calories: number
  avg_calories_per_day: number
  cal_surplus_deficit: number
  total_protein: number
  total_carbs: number
  total_fat: number
  by_meal: Record<string, number>
  daily_calories: Array<{ date: string; calories: number }>
  macro_percent: { protein: number; carbs: number; fat: number }
  analysis_summary: string
  analysis_summary_generated_date?: string
  analysis_summary_needs_refresh?: boolean
  analysis_summary_daily_limit?: number
  analysis_summary_used_today?: number
  body_metrics?: BodyMetricsSummary
  health_index?: HealthIndex
}

export type CommunityFeedSortBy = 'recommended' | 'latest' | 'hot' | 'balanced'
export type CommunityAuthorScope = 'all' | 'priority' | 'public'
export type CommunityFeedTargetType = 'food_record' | 'exercise_log' | 'campus_food' | 'circle_post'
export type CommunityFeedContentType = 'all' | CommunityFeedTargetType

export interface CommunityFeedQueryParams {
  meal_type?: MealType
  diet_goal?: DietGoal
  sort_by?: CommunityFeedSortBy
  content_type?: CommunityFeedContentType
  priority_author_ids?: string[]
  author_scope?: CommunityAuthorScope
  author_id?: string
}

export type CommunityFeedRecord = FoodRecord & {
  feed_type?: CommunityFeedTargetType
  title?: string | null
  body?: string | null
  exercise_type?: string | null
  exercise_desc?: string | null
  calories_burned?: number | null
  duration_min?: number | null
  ai_reasoning?: string | null
  price?: number | null
  school?: string | null
  canteen?: string | null
  fiber?: number | null
  sugar?: number | null
  sodium_mg?: number | null
}

export interface FeedCommentItem {
  id: string
  user_id: string
  record_id?: string | null
  target_type?: CommunityFeedTargetType
  target_id?: string
  parent_comment_id?: string | null
  reply_to_user_id?: string | null
  reply_to_nickname?: string
  content: string
  created_at: string
  nickname: string
  avatar: string
}

export interface CommunityFeedItem {
  target_type?: CommunityFeedTargetType
  target_id?: string
  record: CommunityFeedRecord
  author: { id: string; nickname: string; avatar: string }
  like_count: number
  liked: boolean
  is_mine?: boolean
  comments?: FeedCommentItem[]
  comment_count?: number
  recommend_reason?: string
}

export interface CommunityFeedContext {
  allowed: boolean
  reason?: string
  record?: CommunityFeedRecord
  author?: { id?: string; nickname?: string; avatar?: string }
  like_count?: number
  liked?: boolean
  is_mine?: boolean
  comments?: FeedCommentItem[]
  comment_count?: number
}

export type CommunitySearchTab = 'content' | 'users'

export interface CommunitySearchAuthor {
  id: string
  nickname?: string
  avatar?: string
}

export interface ContentSearchResult {
  target_type: CommunityFeedTargetType | string
  target_id: string
  user_id?: string
  description?: string
  title?: string
  body?: string
  image_path?: string | null
  image_paths?: string[] | null
  record_time?: string
  created_at?: string
  total_calories?: number
  total_protein?: number
  total_carbs?: number
  total_fat?: number
  fiber?: number
  sugar?: number
  sodium_mg?: number
  exercise_desc?: string
  exercise_type?: string
  calories_burned?: number
  duration_min?: number
  meal_type?: string
  diet_goal?: string
  author: CommunitySearchAuthor
  liked?: boolean
  like_count?: number
  comment_count?: number
}

export interface UserSearchResult {
  id: string
  nickname?: string
  avatar?: string
  is_friend?: boolean
  is_self?: boolean
}

export interface CommunitySearchResult {
  list: ContentSearchResult[] | UserSearchResult[]
  has_more: boolean
  content_count: number
  user_count: number
}

export interface CheckinLeaderboardItem {
  user_id: string
  nickname: string
  avatar?: string
  checkin_count: number
  record_count?: number
  is_me?: boolean
  rank?: number
}

export interface FollowUserItem {
  id?: string
  user_id?: string
  nickname?: string
  avatar?: string
  is_following?: boolean
  followers_count?: number
  following_count?: number
}

export interface FollowListResponse {
  list: FollowUserItem[]
  has_more?: boolean
  offset?: number
}

export interface FollowStats {
  followers_count?: number
  following_count?: number
  is_following?: boolean
}

export interface FriendInviteProfile {
  user_id?: string
  id?: string
  nickname?: string
  avatar?: string
  invite_code?: string
  is_friend?: boolean
  is_self?: boolean
  status?: string
}

export interface FriendInviteResolveResult extends FriendInviteProfile {
  relation?: string
  request_status?: string
}

export interface RewardCenterTask {
  code: string
  action_type?: string
  name: string
  description?: string
  reward_amount: number
  daily_limit?: number | null
  today_count: number
  status?: string
  action_path?: string | null
  completed?: boolean
}

export interface RewardCenterResponse {
  earned_credits_balance: number
  today_earned_credits: number
  today_task_overview: {
    completed_count: number
    total_count: number
  }
  tasks: RewardCenterTask[]
}

export interface FoodExpiryDashboard {
  active_count: number
  expired_count: number
  today_count: number
  soon_count: number
  processed_count: number
  preview_items: HomeFoodExpiryItem[]
}

export interface ManualFoodItem {
  id?: string
  title?: string
  name?: string
  source?: 'recent' | 'public_library' | 'nutrition_library' | 'packaged_food' | 'custom' | string
  source_label?: string
  source_id?: string
  default_weight_grams?: number
  total_calories?: number
  total_protein?: number
  total_carbs?: number
  total_fat?: number
  calories?: number
  protein?: number
  carbs?: number
  fat?: number
  portion_label?: string
  recommend_reason?: string
  image_path?: string | null
  image_paths?: string[] | null
  nutrients_per_100g?: Record<string, number>
  extra_nutrients?: Record<string, number>
  [key: string]: unknown
}

export interface ManualFoodBrowseResult {
  recent_items?: ManualFoodItem[]
  collected_public_library?: ManualFoodItem[]
  public_library?: ManualFoodItem[]
  nutrition_library?: ManualFoodItem[]
  stats?: Record<string, unknown>
}

export interface ManualFoodCatalogCategory {
  key: string
  label: string
  count?: number
}

export interface ManualFoodCatalogResult {
  categories?: ManualFoodCatalogCategory[]
  items: ManualFoodItem[]
  category?: string
  page?: number
  page_size?: number
  has_more?: boolean
  stats?: Record<string, unknown>
}

export interface FoodExpiryItem {
  id: string
  user_id?: string
  food_name: string
  category?: string
  storage_type?: string
  quantity_note?: string | null
  expire_date: string
  opened_date?: string | null
  note?: string | null
  source_type?: string
  status?: 'active' | 'consumed' | 'discarded' | string
  created_at?: string
  updated_at?: string
  days_until_expire?: number | null
  urgency?: 'expired' | 'today' | 'soon' | 'fresh' | string
  urgency_label?: string
}

export interface RecipeItem {
  id: string
  user_id?: string
  recipe_name: string
  description?: string | null
  image_path?: string | null
  items?: Array<Record<string, unknown>>
  total_calories: number
  total_protein: number
  total_carbs: number
  total_fat: number
  total_weight_grams: number
  tags?: string[]
  meal_type?: MealType | string | null
  is_favorite?: boolean
  use_count?: number
  last_used_at?: string | null
  created_at?: string
  updated_at?: string
}

export interface PublicFoodAuthor {
  id?: string
  nickname?: string
  avatar?: string
}

export interface PublicFoodItem {
  id: string
  user_id?: string
  source_record_id?: string | null
  analysis_task_id?: string | null
  image_path?: string | null
  image_paths?: string[]
  total_calories: number
  total_protein: number
  total_carbs: number
  total_fat: number
  items?: Array<Record<string, unknown>>
  description?: string
  insight?: string
  food_name: string
  merchant_name?: string
  merchant_address?: string
  detail_address?: string
  taste_rating?: number | null
  suitable_for_fat_loss?: boolean
  user_tags?: string[]
  user_notes?: string
  latitude?: number | null
  longitude?: number | null
  province?: string
  city?: string
  district?: string
  status?: string
  type?: string
  like_count?: number
  comment_count?: number
  collection_count?: number
  avg_rating?: number
  liked?: boolean
  collected?: boolean
  author?: PublicFoodAuthor
  recommend_reason?: string
  is_campus_food?: boolean
  school_name?: string
  campus_name?: string
  canteen_name?: string
  floor?: string
  window_name?: string
  price?: number
  price_type?: string
  price_min?: number
  price_max?: number
  price_unit?: string
  price_collected_at?: string
  portion_description?: string
  campus_location_text?: string
  school_logo_url?: string
  analysis_status?: string
  analysis_error?: string
  published_at?: string
  created_at?: string
  updated_at?: string
}

export interface PackagedFoodItem {
  id?: string
  brand?: string
  product_name?: string
  display_name?: string
  search_text?: string
  barcode?: string
  spec_text?: string
  flavor_text?: string
  package_category?: string
  ingredients_text?: string
  ocr_raw_text?: string
  extract_confidence?: number
  field_confidence?: Record<string, unknown>
  ingest_method?: string
  source_image_urls?: string[]
  nutrition_basis_unit?: string
  energy_unit_raw?: string
  raw_label_payload?: Record<string, unknown>
  conversion_status?: string
  net_weight_g?: number
  serving_weight_g?: number
  kcal_per_100g?: number
  protein_per_100g?: number
  carbs_per_100g?: number
  fat_per_100g?: number
  fiber_per_100g?: number
  sugar_per_100g?: number
  saturated_fat_per_100g?: number
  cholesterol_mg_per_100g?: number
  sodium_mg_per_100g?: number
  potassium_mg_per_100g?: number
  calcium_mg_per_100g?: number
  iron_mg_per_100g?: number
  magnesium_mg_per_100g?: number
  zinc_mg_per_100g?: number
  vitamin_a_rae_mcg_per_100g?: number
  vitamin_c_mg_per_100g?: number
  vitamin_d_mcg_per_100g?: number
  vitamin_e_mg_per_100g?: number
  vitamin_k_mcg_per_100g?: number
  thiamin_mg_per_100g?: number
  riboflavin_mg_per_100g?: number
  niacin_mg_per_100g?: number
  vitamin_b6_mg_per_100g?: number
  folate_mcg_per_100g?: number
  vitamin_b12_mcg_per_100g?: number
  review_status?: string
  created_at?: string
  updated_at?: string
  [key: string]: unknown
}

export interface PackagedNutritionLabelResult {
  brand?: string
  product_name?: string
  net_weight_g?: number
  serving_weight_g?: number
  kcal_per_100g?: number
  protein_per_100g?: number
  carbs_per_100g?: number
  fat_per_100g?: number
  fiber_per_100g?: number
  sugar_per_100g?: number
  saturated_fat_per_100g?: number
  cholesterol_mg_per_100g?: number
  sodium_mg_per_100g?: number
  potassium_mg_per_100g?: number
  calcium_mg_per_100g?: number
  iron_mg_per_100g?: number
  magnesium_mg_per_100g?: number
  zinc_mg_per_100g?: number
  vitamin_a_rae_mcg_per_100g?: number
  vitamin_c_mg_per_100g?: number
  vitamin_d_mcg_per_100g?: number
  vitamin_e_mg_per_100g?: number
  vitamin_k_mcg_per_100g?: number
  thiamin_mg_per_100g?: number
  riboflavin_mg_per_100g?: number
  niacin_mg_per_100g?: number
  vitamin_b6_mg_per_100g?: number
  folate_mcg_per_100g?: number
  vitamin_b12_mcg_per_100g?: number
  confidence?: number
  raw_text?: string
  [key: string]: unknown
}

export interface PackagedAutoIngestResult {
  status?: string
  reason?: string
  upsert_action?: string
  packaged_food_id?: string
  missing_fields?: string[]
  conflict_reasons?: string[]
}

export interface PackagedProductExtractResult {
  brand?: string
  product_name?: string
  display_name?: string
  search_text?: string
  product_family_key?: string
  flavor_text?: string
  package_category?: string
  net_content_value?: number
  net_content_unit?: string
  unit_count?: number
  unit_content_value?: number
  unit_content_unit?: string
  review_status?: string
  net_weight_g?: number
  serving_weight_g?: number
  spec_text?: string
  barcode?: string
  ingredients_text?: string
  unit_nutrition_per_100g?: Record<string, number>
  nutrition_basis_unit?: string
  energy_unit_raw?: string
  raw_nutrition_basis?: Record<string, unknown>
  raw_nutrition_per_basis?: Record<string, unknown>
  raw_label_payload?: Record<string, unknown>
  conversion_status?: string
  field_confidence?: Record<string, number>
  extract_confidence?: number
  needs_more_images?: string[]
  missing_fields?: string[]
  auto_ingest_result?: PackagedAutoIngestResult
  packaged_food_id?: string
  ocr_raw_text?: string
  source_image_urls?: string[]
}

export interface LocationSearchPOI {
  id?: string
  title?: string
  name?: string
  address?: string
  category?: string
  tel?: string
  location?: {
    lat?: number
    lng?: number
  }
  latitude?: number
  longitude?: number
  [key: string]: unknown
}

export interface LocationSearchResult {
  keyword?: string
  pois?: LocationSearchPOI[]
  list?: LocationSearchPOI[]
  items?: LocationSearchPOI[]
  count?: number
  [key: string]: unknown
}

export interface PublicFoodComment {
  id: string
  user_id: string
  library_item_id?: string
  parent_comment_id?: string | null
  reply_to_user_id?: string | null
  reply_to_nickname?: string
  content: string
  rating?: number | null
  created_at?: string
  nickname?: string
  avatar?: string
  replies?: PublicFoodComment[]
}

export interface CampusRelatedFeedItem {
  id: string
  food_name?: string
  image_path?: string | null
  image_paths?: string[] | null
  school_name?: string | null
  canteen_name?: string | null
  campus_location?: string | null
  school_logo_url?: string | null
  total_calories?: number
  total_protein?: number
  price?: number | null
  price_unit?: string | null
  like_count?: number
  comment_count?: number
  collection_count?: number
  published_at?: string | null
}

export interface CampusFoodDetail {
  item: PublicFoodItem
  metrics?: {
    protein_per_yuan?: number
    price_per_100_kcal?: number
  }
  similar_items?: PublicFoodItem[] | null
  related_feeds?: CampusRelatedFeedItem[] | null
}

export interface PublicProfile {
  id: string
  nickname?: string
  avatar?: string
  cover_image?: string
  record_days?: number
  create_time?: string
  motto?: string
  followers_count?: number
  following_count?: number
  is_following?: boolean
}

export interface FriendUserItem {
  id: string
  nickname?: string
  avatar?: string
  is_friend?: boolean
  is_pending?: boolean
}

export interface PrivateMessageItem {
  ID?: string
  id?: string
  SenderID?: string
  sender_id?: string
  ReceiverID?: string
  receiver_id?: string
  Content?: string
  content?: string
  ImageURL?: string
  image_url?: string
  ContentType?: string
  content_type?: string
  IsRead?: boolean
  is_read?: boolean
  CreatedAt?: string
  created_at?: string
  DeletedAt?: string | null
  deleted_at?: string | null
  DeletedByUserID?: string
  deleted_by_user_id?: string
}

export interface ConversationSummary {
  UserID?: string
  user_id?: string
  Nickname?: string
  nickname?: string
  Avatar?: string
  avatar?: string
  LastMessage?: PrivateMessageItem
  last_message?: PrivateMessageItem
  UnreadCount?: number
  unread_count?: number
}

export interface FriendRequestItem {
  id: string
  from_user_id?: string
  to_user_id?: string
  status?: string
  created_at?: string
  updated_at?: string
  from_nickname?: string
  from_avatar?: string
  counterpart_user_id?: string
  counterpart_nickname?: string
  counterpart_avatar?: string
}

export interface CommunityNotificationItem {
  id: string
  notification_type: string
  record_id?: string | null
  target_type?: string
  target_id?: string
  comment_id?: string | null
  parent_comment_id?: string | null
  content_preview?: string
  is_read: boolean
  created_at?: string | null
  actor?: {
    id?: string
    nickname?: string
    avatar?: string
  }
}

export interface ExerciseLogItem {
  id: string
  user_id?: string
  date?: string
  recorded_on?: string
  recorded_at?: string
  exercise_desc?: string | null
  exercise_type?: string | null
  calories_burned?: number | null
  duration_min?: number | null
  created_at?: string
  image_url?: string | null
  ai_reasoning?: string | null
}

export interface PetAppearanceCandidate {
  id: string
  pet_seed: string
  name: string
  color: string
  shape: string
  pattern: string
  accessory: string
  personality: string
  archetype?: string
  style?: string
  score?: number
  match_reasons?: string[]
}

export interface PetProfile {
  id: string
  pet_seed: string
  name: string
  color: string
  shape: string
  pattern: string
  accessory: string
  personality: string
  level: number
  experience: number
  level_exp: number
  next_level_exp: number
  level_progress: number
  total_events: number
  archetype?: string
  match_reasons?: string[]
  needs_selection?: boolean
  selection_candidates?: PetAppearanceCandidate[]
  free_profile_rematch_available?: boolean
  growth_unlocks?: string[]
}

export interface PetDailyScore {
  date: string
  habit_score: number
  exp_gained: number
  details?: Record<string, unknown>
}

export interface PetStatus {
  mood: string
  state: string
  message: string
  task_text: string
  inactivity_days: number
  can_revive: boolean
}

export interface PetEvent {
  id: string
  event_date: string
  event_type: string
  title: string
  message: string
  task_text: string
  habit_score: number
  exp_reward: number
  credit_reward: number
  can_claim: boolean
  is_read: boolean
  is_claimed: boolean
  details?: Record<string, unknown>
}

export interface PetSummary {
  pet: PetProfile
  today: PetDailyScore
  status: PetStatus
  event?: PetEvent
  rewards: {
    daily_credit_cap: number
  }
}

export interface PetClaimResult {
  pet: PetProfile
  event: PetEvent
  credits_awarded: number
  exp_awarded: number
  earned_credits_balance?: number
}

export interface PetChatEstimateResponse {
  question: string
  range: StatsRange
  estimated_credits: number
  balance?: number
  can_afford?: boolean
}

export interface PetChatResponse {
  answer: string
  question: string
  range: StatsRange
  session_id?: string
  credits_used?: number
  remaining_balance?: number
}

export interface PetChatHistoryMessage {
  id: string
  session_id?: string
  role: 'user' | 'assistant' | 'pet' | string
  content: string
  message_type?: string
  meta?: Record<string, unknown>
  created_at?: string
}

export interface PetChatSession {
  id?: string
  ID?: string
  user_id?: string
  title?: string
  range_type?: StatsRange | string
  RangeType?: StatsRange | string
  last_question?: string
  last_answer?: string
  last_message_at?: string
  created_at?: string
  updated_at?: string
}

export interface PetChatHistoryResponse {
  session?: PetChatSession | null
  messages: PetChatHistoryMessage[]
}

export interface PetChatSessionSummary {
  id?: string
  ID?: string
  title?: string
  range_type?: StatsRange | string
  RangeType?: StatsRange | string
  last_question?: string
  last_answer?: string
  last_message_at?: string
  created_at?: string
  updated_at?: string
}

export interface PetChatSessionsResponse {
  sessions: PetChatSessionSummary[]
}
