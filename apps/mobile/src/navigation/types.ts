import type { AnalysisTask, CommunityFeedTargetType, FoodExpiryItem, ManualFoodItem, MealType } from '@food-link/core'

export type MainTabParamList = {
  HomeTab: undefined
  StatsTab: undefined
  CommunityTab: undefined
  ProfileTab: undefined
}

export type RootStackParamList = {
  Login: undefined
  MainTabs: undefined
  Analyze: { source?: 'camera' | 'library'; mealType?: MealType; date?: string } | undefined
  AnalyzeLoading: { taskId?: string; imageUri?: string; mealType: MealType; date: string; task?: AnalysisTask; taskType?: 'food' | 'food_text' | 'exercise' } | undefined
  Result: { task: AnalysisTask; imageUri?: string; mealType: MealType; date: string }
  TextResult: { task: AnalysisTask; mealType: MealType; date: string }
  TextRecord: undefined
  ManualRecord: undefined
  FoodLibrary: undefined
  FoodLibraryDetail: { itemId?: string; item?: ManualFoodItem } | undefined
  DayRecord: { date?: string } | undefined
  RecordDetail: { recordId: string }
  AnalyzeHistory: undefined
  AiAssistant: undefined
  StatsMetabolic: undefined
  TrendDetail: { kind: 'weight' | 'water' | 'exercise' }
  HealthProfile: undefined
  HealthProfileView: undefined
  ProfileSettings: { userId?: string } | undefined
  AccountSecurity: undefined
  BodyMetricRecord: { type: 'weight' | 'water' | 'exercise' }
  Expiry: undefined
  ExpiryEdit: { itemId?: string; item?: FoodExpiryItem } | undefined
  RewardCenter: undefined
  MembershipCenter: undefined
  Recipes: undefined
  RecipeEdit: { recipeId?: string } | undefined
  PublicFood: { mode?: 'all' | 'campus' | 'mine' | 'collections' } | undefined
  PublicFoodDetail: { itemId: string; isCampus?: boolean }
  PublicFoodShare: { editId?: string; mode?: 'campus' | 'public' } | undefined
  CommunityFeedDetail: { targetId: string; targetType: CommunityFeedTargetType }
  PublicProfile: { userId: string }
  FollowList: { userId: string; type: 'followers' | 'following' }
  Conversations: undefined
  PrivateChat: { userId: string; nickname?: string }
  BodyTrends: undefined
  PackagedFoodEdit: { taskId?: string } | undefined
  PackagedFoodTaskDetail: { taskId: string }
  LocationSearch: undefined
  CampusCanteen: undefined
  PrivacySettings: undefined
  MembershipAgreement: undefined
  UserGroup: undefined
  CheckinLeaderboard: undefined
  InviteFriends: { inviteCode?: string; invite_code?: string; fi?: string } | undefined
  PetHome: undefined
  PetLab: undefined
  Agreements: undefined
  PrivacyPolicy: undefined
  AutoRenewAudit: undefined
  CirclePostEdit: { postId?: string } | undefined
  Friends: undefined
  Notifications: undefined
  AboutFeedback: undefined
}
