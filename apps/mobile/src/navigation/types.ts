import type { AnalysisTask, CommunityFeedTargetType, ExecutionMode, FoodExpiryItem, ManualFoodItem, MealType, PrecisionReferenceObjectInput } from '@food-link/core'

export type ManualRecordSourceChannel = 'recommended' | 'campus' | 'favorites' | 'custom'

export type MainTabParamList = {
  HomeTab: undefined
  StatsTab: undefined
  CommunityTab: undefined
  ProfileTab: undefined
}

export type PublicFoodShareDraft = {
  foodName?: string
  description?: string
  imageUrls?: string
  merchantName?: string
  merchantAddress?: string
  calories?: string
  protein?: string
  carbs?: string
  fat?: string
  sourceKind?: 'restaurant' | 'homemade' | 'campus'
  schoolName?: string
  campusName?: string
  canteenName?: string
  floor?: string
  windowName?: string
  price?: string
  priceType?: 'fixed' | 'weight' | 'range' | 'combo' | 'unknown'
  priceMin?: string
  priceMax?: string
  priceUnit?: string
  priceCollectedAt?: string
  portionDescription?: string
  tasteRating?: string
  suitableForFatLoss?: boolean
  tags?: string
  notes?: string
  campusLocationText?: string
  province?: string
  city?: string
  district?: string
  detailAddress?: string
  latitude?: string
  longitude?: string
}

export type LocationSelection = {
  name?: string
  address?: string
  lonlat?: string
  longitude?: number
  latitude?: number
  province?: string
  city?: string
  district?: string
  promptCity?: string
}

export type RootStackParamList = {
  Login: undefined
  MainTabs: undefined
  Analyze: {
    source?: 'camera' | 'library'
    mealType?: MealType
    date?: string
    precisionSessionId?: string
    referenceObjects?: PrecisionReferenceObjectInput[]
  } | undefined
  GooseDuckChicken: undefined
  AnalyzeLoading: { taskId?: string; imageUri?: string; imageUris?: string[]; mealType: MealType; date: string; task?: AnalysisTask; taskType?: 'food' | 'food_text' | 'exercise'; executionMode?: ExecutionMode } | undefined
  Result: { task: AnalysisTask; imageUri?: string; mealType: MealType; date: string }
  TextResult: { task: AnalysisTask; mealType: MealType; date: string }
  TextRecord: { date?: string; mealType?: MealType } | undefined
  ManualRecord:
    | { quickItem?: ManualFoodItem; sourceChannel?: ManualRecordSourceChannel; date?: string; mealType?: MealType }
    | undefined
  FoodLibrary: { initialTab?: 'all' | 'custom' | 'results' | 'create' } | undefined
  FoodLibraryDetail: { itemId?: string; item?: ManualFoodItem } | undefined
  DayRecord: { date?: string } | undefined
  RecordDetail: { recordId: string; initialAction?: 'edit' | 'share' | 'delete' }
  AnalyzeHistory: undefined
  StatsMetabolic: undefined
  TrendDetail: { kind: 'weight' | 'water' | 'exercise'; date?: string }
  HealthProfile: undefined
  HealthProfileView: undefined
  ProfileSettings: { userId?: string; action?: 'delete-account' } | undefined
  AccountSecurity: undefined
  BodyMetricRecord: { type: 'weight' | 'water' | 'exercise'; date?: string }
  Expiry: undefined
  ExpiryEdit: { itemId?: string; item?: FoodExpiryItem } | undefined
  RewardCenter: undefined
  MembershipCenter: undefined
  Recipes: undefined
  RecipeDetail: { recipeId: string }
  RecipeEdit: { recipeId?: string } | undefined
  PublicFood: { mode?: 'all' | 'campus' | 'mine' | 'collections' } | undefined
  PublicFoodDetail: { itemId: string; isCampus?: boolean }
  PublicFoodShare:
    | { editId?: string; mode?: 'campus' | 'public'; draft?: PublicFoodShareDraft; selectedLocation?: LocationSelection }
    | undefined
  CommunityFeedDetail: { targetId: string; targetType: CommunityFeedTargetType }
  CommunitySearch: { keyword?: string } | undefined
  PublicProfile: { userId: string }
  FollowList: { userId: string; type: 'followers' | 'following' }
  Conversations: undefined
  PrivateChat: { userId: string; nickname?: string }
  BodyTrends: { tab?: 'weight' | 'water' | 'exercise' } | undefined
  PackagedFoodEdit: { taskId?: string } | undefined
  PackagedFoodTaskDetail: { taskId: string }
  LocationSearch:
    | { returnTo?: 'PublicFoodShare'; editId?: string; mode?: 'campus' | 'public'; draft?: PublicFoodShareDraft }
    | undefined
  CampusCanteen: undefined
  PrivacySettings: undefined
  MembershipAgreement: undefined
  UserGroup: undefined
  CheckinLeaderboard: undefined
  InviteFriends: { inviteCode?: string; invite_code?: string; fi?: string } | undefined
  PetHome: undefined
  PetChat: undefined
  Agreements: undefined
  PrivacyPolicy: undefined
  AutoRenewAudit: undefined
  CirclePostEdit: { postId?: string } | undefined
  Friends: undefined
  Notifications: undefined
  About: undefined
  AboutFeedback: undefined
}
