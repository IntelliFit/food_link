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

export interface HomeIntakeData {
  current: number
  target: number
  progress: number
  macros: {
    protein: { current: number; target: number }
    carbs: { current: number; target: number }
    fat: { current: number; target: number }
  }
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
  daily_limit: number | null
  daily_used: number | null
  daily_remaining: number | null
  daily_credits_max?: number
  daily_credits_used?: number
  daily_credits_remaining?: number
  system_credits_remaining?: number
  earned_credits_balance?: number
  total_credits_available?: number
  trial_active?: boolean
  points_balance?: number
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
  additionalContext?: string
  modelName?: string
  is_multi_view?: boolean
  execution_mode?: ExecutionMode
  analysis_engine?: AnalysisEngine
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
