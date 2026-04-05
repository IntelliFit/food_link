import { View, Text, Image } from '@tarojs/components'
import { Empty, Button } from '@taroify/core'
import { IconBreakfast, IconLunch, IconDinner, IconSnack, IconChevronRight } from '../../../components/iconfont'
import { formatDisplayNumber } from '../utils/helpers'
import type { HomeMealItem } from '../../../utils/api'

// 餐次对应的 iconfont 图标及颜色
const MEAL_ICON_CONFIG = {
  breakfast: { Icon: IconBreakfast, color: '#00bc7d', bgColor: '#ecfdf5', label: '早餐' },
  morning_snack: { Icon: IconSnack, color: '#00bc7d', bgColor: '#ecfdf5', label: '早加餐' },
  lunch: { Icon: IconLunch, color: '#00bc7d', bgColor: '#ecfdf5', label: '午餐' },
  afternoon_snack: { Icon: IconSnack, color: '#00bc7d', bgColor: '#ecfdf5', label: '午加餐' },
  dinner: { Icon: IconDinner, color: '#00bc7d', bgColor: '#ecfdf5', label: '晚餐' },
  evening_snack: { Icon: IconSnack, color: '#00bc7d', bgColor: '#ecfdf5', label: '晚加餐' },
  snack: { Icon: IconSnack, color: '#00bc7d', bgColor: '#ecfdf5', label: '加餐' }
} as const

// 餐次进度条颜色：正常为绿色，超过100%为红色警示
const MEAL_PROGRESS_COLOR_NORMAL = '#00bc7d'
const MEAL_PROGRESS_COLOR_WARNING = '#ef4444'

// 百分比文字颜色
const PERCENT_COLOR_NORMAL = '#00bc7d'
const PERCENT_COLOR_WARNING = '#ef4444'

const SNACK_MEAL_TYPES = new Set(['morning_snack', 'afternoon_snack', 'evening_snack', 'snack'])

function normalizeDisplayNumber(value: unknown): number {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : 0
}

function calculateProgressPercent(current: number, target: number): number {
  if (target <= 0) {
    return current > 0 ? 100 : 0
  }
  return Math.max(0, Number(((current / target) * 100).toFixed(1)))
}

function normalizeProgressPercent(value: unknown, current?: unknown, target?: unknown): number {
  const numeric = Number(value)
  if (Number.isFinite(numeric)) {
    return Math.max(0, Number(numeric.toFixed(1)))
  }

  if (current != null && target != null) {
    return calculateProgressPercent(normalizeDisplayNumber(current), normalizeDisplayNumber(target))
  }

  return 0
}

function clampVisualProgress(progress: number): number {
  return Math.min(100, Math.max(0, progress))
}

function formatProgressText(progress: number): string {
  return `${Math.round(progress)}%`
}

export interface MealsSectionProps {
  meals: HomeMealItem[]
  loading: boolean
  onViewAllMeals: () => void
  onQuickRecord: (type: 'photo' | 'text') => void
  onPreviewImages: (meal: HomeMealItem, startIndex?: number) => void
}

export function MealsSection({
  meals,
  loading,
  onViewAllMeals,
  onQuickRecord,
  onPreviewImages
}: MealsSectionProps) {
  return (
    <View className='meals-section'>
      <View className='section-header'>
        <Text className='section-title'>今日餐食</Text>
        <View className='view-all-btn' onClick={onViewAllMeals}>
          <Text className='view-all-text'>查看全部</Text>
          <IconChevronRight size={16} color='#00bc7d' />
        </View>
      </View>
      
      <View className='meals-list'>
        {loading ? (
          <View className='meals-loading'>
            <View className='loading-spinner-md' />
          </View>
        ) : meals.length === 0 ? (
          <View className='meals-empty'>
            <Empty>
              <Empty.Image />
              <Empty.Description>暂无今日餐食</Empty.Description>
              <Button
                shape='round'
                color='primary'
                className='empty-record-btn'
                onClick={() => onQuickRecord('photo')}
              >
                去记录一餐
              </Button>
            </Empty>
          </View>
        ) : (
          meals.map((meal, index) => {
            const config = MEAL_ICON_CONFIG[meal.type as keyof typeof MEAL_ICON_CONFIG] ?? MEAL_ICON_CONFIG.snack
            const { Icon, color, bgColor, label } = config
            const isSnackMeal = SNACK_MEAL_TYPES.has(meal.type)
            const mealCalorie = normalizeDisplayNumber(meal.calorie)
            const mealTarget = normalizeDisplayNumber(meal.target)
            const mealProgress = normalizeProgressPercent(meal.progress, mealCalorie, mealTarget)
            const mealImageUrls = Array.isArray(meal.image_paths) && meal.image_paths.length > 0
              ? meal.image_paths.filter(Boolean)
              : (meal.image_path ? [meal.image_path] : [])
            const previewImage = mealImageUrls[0] || ''
            const hasRealImage = mealImageUrls.length > 0
            const targetText = isSnackMeal
              ? `参考 ${formatDisplayNumber(mealTarget)} kcal`
              : `目标 ${formatDisplayNumber(mealTarget)} kcal`
            
            return (
              <View key={`${meal.type}-${index}`} className={`meal-item ${mealProgress > 100 ? 'is-warning' : ''}`}>
                <View
                  className={`meal-media-wrap ${hasRealImage ? 'is-photo' : 'is-icon'}`}
                  onClick={() => onPreviewImages(meal)}
                >
                  {hasRealImage ? (
                    <Image
                      className='meal-thumb-image'
                      src={previewImage}
                      mode='aspectFill'
                    />
                  ) : (
                    <View className='meal-icon-wrap' style={{ backgroundColor: bgColor }}>
                      <Icon size={24} color={color} />
                    </View>
                  )}
                  {hasRealImage && mealImageUrls.length > 1 && (
                    <View className='meal-thumb-badge'>
                      <Text className='meal-thumb-badge-text'>{mealImageUrls.length}张</Text>
                    </View>
                  )}
                </View>
                <View className='meal-content'>
                  <View className='meal-main'>
                    <Text className='meal-name'>{meal.name || label}</Text>
                    <Text className='meal-calorie'>{formatDisplayNumber(mealCalorie)} kcal</Text>
                  </View>
                  {isSnackMeal ? (
                    // 加餐显示：进度条 + 时间 + 标签
                    <>
                      <View className='meal-progress-wrap'>
                        <View className='meal-progress-bar-bg'>
                          <View
                            className={`meal-progress-bar-fill ${mealProgress > 100 ? 'is-warning' : ''}`}
                            style={{
                              width: `${clampVisualProgress(mealProgress)}%`,
                              backgroundColor: mealProgress > 100 ? MEAL_PROGRESS_COLOR_WARNING : MEAL_PROGRESS_COLOR_NORMAL
                            }}
                          />
                        </View>
                        <View className='meal-progress-meta'>
                          <Text className='meal-progress-percent' style={{ color: mealProgress > 100 ? PERCENT_COLOR_WARNING : PERCENT_COLOR_NORMAL }}>{formatProgressText(mealProgress)}</Text>
                          <Text className='meal-progress-text'>{targetText}</Text>
                        </View>
                      </View>
                      {meal.time && <Text className='meal-time'>{meal.time}</Text>}
                      {meal.tags?.length > 0 && (
                        <View className='meal-tags'>
                          {meal.tags.slice(0, 2).map((tag) => (
                            <Text key={tag} className='meal-tag'>{tag}</Text>
                          ))}
                        </View>
                      )}
                    </>
                  ) : (
                    // 正餐完整显示：进度条 + 目标
                    <>
                      <View className='meal-progress-wrap'>
                        <View className='meal-progress-bar-bg'>
                          <View
                            className={`meal-progress-bar-fill ${mealProgress > 100 ? 'is-warning' : ''}`}
                            style={{
                              width: `${clampVisualProgress(mealProgress)}%`,
                              backgroundColor: mealProgress > 100 ? MEAL_PROGRESS_COLOR_WARNING : MEAL_PROGRESS_COLOR_NORMAL
                            }}
                          />
                        </View>
                        <View className='meal-progress-meta'>
                          <Text className='meal-progress-percent' style={{ color: mealProgress > 100 ? PERCENT_COLOR_WARNING : PERCENT_COLOR_NORMAL }}>{formatProgressText(mealProgress)}</Text>
                          <Text className='meal-progress-text'>{targetText}</Text>
                        </View>
                      </View>
                      {meal.time && <Text className='meal-time'>{meal.time}</Text>}
                      {meal.tags?.length > 0 && (
                        <View className='meal-tags'>
                          {meal.tags.map((tag) => (
                            <Text key={tag} className='meal-tag'>{tag}</Text>
                          ))}
                        </View>
                      )}
                    </>
                  )}
                </View>
              </View>
            )
          })
        )}
      </View>
    </View>
  )
}
