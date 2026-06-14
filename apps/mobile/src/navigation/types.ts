import type { AnalysisTask, MealType } from '@food-link/core'

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
  AnalyzeLoading: { taskId?: string; imageUri?: string; mealType: MealType; date: string; task?: AnalysisTask } | undefined
  Result: { task: AnalysisTask; imageUri?: string; mealType: MealType; date: string }
  TextRecord: undefined
  ManualRecord: undefined
  FoodLibrary: undefined
  DayRecord: { date?: string } | undefined
  RecordDetail: { recordId: string }
  AnalyzeHistory: undefined
  HealthProfile: undefined
  BodyMetricRecord: { type: 'weight' | 'water' | 'exercise' }
  Expiry: undefined
  RewardCenter: undefined
  CirclePostEdit: undefined
  Friends: undefined
  Notifications: undefined
  NativePlaceholder: { title: string; description: string }
}
