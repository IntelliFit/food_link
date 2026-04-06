import { type HomeIntakeData, type HomeMealItem, type BodyMetricWaterDay } from '../../../utils/api'

export interface WeightRecordEntry {
  date: string
  value: number
  recorded_at?: string
}

export interface BodyMetricsStorage {
  weightEntries: WeightRecordEntry[]
  waterByDate: Record<string, BodyMetricWaterDay>
  waterGoalMl: number
}

export interface WaterRecord {
  date: string
  amount: number
}

export type MacroKey = keyof HomeIntakeData['macros']
export type WeekHeatmapState = 'none' | 'surplus' | 'deficit'

export interface WeekHeatmapCell {
  date: string
  dayName: string
  dayNum: string
  calories: number
  target: number
  intakeRatio: number
  state: WeekHeatmapState
  isToday: boolean
}

export interface TargetFormState {
  calorieTarget: string
  proteinTarget: string
  carbsTarget: string
  fatTarget: string
}

export interface MacroTargets {
  protein: number
  carbs: number
  fat: number
}

// 目标编辑组件Props（简化版 - 仅精确模式）
export interface TargetEditorProps {
  visible: boolean
  targetForm: TargetFormState
  saving: boolean
  onTargetFormChange: (form: TargetFormState) => void
  onSave: () => void
  onClose: () => void
}

// ==================== 新拆分组件的 Props ====================

// GreetingSection Props
export interface GreetingSectionProps {
  onOpenTargetEditor?: () => void
}

// DateSelector Props
export interface DateSelectorProps {
  weekHeatmapCells: WeekHeatmapCell[]
  selectedDate: string
  onDateSelect: (date: string) => void
}

// CalorieCard Props
export interface CalorieCardProps {
  intakeData: HomeIntakeData
  isSwitchingDate: boolean
  animatedRemainingCalories: number
  calorieProgress: number
  onOpenTargetEditor: () => void
}

// MacrosSection Props
export interface MacrosSectionProps {
  intakeData: HomeIntakeData
  isSwitchingDate: boolean
  animatedMacroValues: Record<MacroKey, number>
  animatedMacroProgress: Record<MacroKey, number>
}

// WeightSummary 类型
export interface WeightSummary {
  latestWeight: WeightRecordEntry | null
  todayWeight: WeightRecordEntry | null
  previousWeight: WeightRecordEntry | null
  weightChange: number | null
  hasRecord: boolean
}

// BodyStatusSection Props
export interface BodyStatusSectionProps {
  weightSummary: WeightSummary
  todayWater: BodyMetricWaterDay
  waterGoalMl: number
  waterProgress: number
  animatedWaterTotal: number
  animatedWaterProgress: number
  onOpenWeightEditor: () => void
  onOpenWaterEditor: () => void
}

// MealsSection Props
export interface MealsSectionProps {
  meals: HomeMealItem[]
  loading: boolean
  onViewAllMeals: () => void
  onQuickRecord: (type: 'photo' | 'text') => void
  onPreviewImages: (meal: HomeMealItem, startIndex?: number) => void
}

// StatsEntry Props
export interface StatsEntryProps {
  onOpenStats: () => void
}
