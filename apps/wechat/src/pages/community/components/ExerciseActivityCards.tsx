import { Text, View } from '@tarojs/components'
import type { ExerciseActivityItem } from '../../../utils/api'
import './ExerciseActivityCards.scss'

export type ExerciseActivityDisplayItem = ExerciseActivityItem & {
  displayName: string
  calorieText: string
  metaText: string
  intensityLabel: string
}

function toFiniteNumber(value: unknown): number | null {
  const numberValue = Number(value)
  return Number.isFinite(numberValue) ? numberValue : null
}

function formatCompactNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/, '')
}

function formatIntensity(value?: string | null): string {
  const normalized = String(value || '').trim().toLowerCase()
  const labels: Record<string, string> = {
    low: '低强度',
    light: '低强度',
    moderate: '中等强度',
    medium: '中等强度',
    high: '高强度',
    vigorous: '高强度',
  }
  return labels[normalized] || String(value || '').trim()
}

export function extractExerciseActivityDisplayItems(items?: ExerciseActivityItem[] | null): ExerciseActivityDisplayItem[] {
  if (!Array.isArray(items)) return []

  return items
    .map((item) => {
      const displayName = String(item?.name || '').trim()
      if (!displayName) return null

      const calories = toFiniteNumber(item.calories_kcal)
      const duration = toFiniteNumber(item.duration_min)
      const sets = toFiniteNumber(item.sets)
      const reps = toFiniteNumber(item.reps)
      const met = toFiniteNumber(item.met)
      const metaParts: string[] = []

      if (duration && duration > 0) {
        metaParts.push(`${formatCompactNumber(duration)}分钟`)
      }
      if (sets && sets > 0 && reps && reps > 0) {
        metaParts.push(`${formatCompactNumber(sets)}组 x ${formatCompactNumber(reps)}次`)
      } else if (sets && sets > 0) {
        metaParts.push(`${formatCompactNumber(sets)}组`)
      }
      if (met && met > 0) {
        metaParts.push(`MET ${formatCompactNumber(met)}`)
      }

      return {
        ...item,
        displayName,
        calorieText: calories && calories > 0 ? `${Math.round(calories)} kcal` : '已估算',
        metaText: metaParts.join(' · '),
        intensityLabel: formatIntensity(item.intensity),
      }
    })
    .filter((item): item is ExerciseActivityDisplayItem => !!item)
}

export function hasExerciseActivityCards(items?: ExerciseActivityItem[] | null): boolean {
  return extractExerciseActivityDisplayItems(items).length > 0
}

export interface ExerciseActivityCardsProps {
  items?: ExerciseActivityItem[] | null
  onItemClick?: (row: ExerciseActivityDisplayItem) => void
}

export function ExerciseActivityCards({ items, onItemClick }: ExerciseActivityCardsProps) {
  const displayItems = extractExerciseActivityDisplayItems(items)
  if (displayItems.length === 0) return null

  return (
    <View className='feed-exercise-activities'>
      {displayItems.map((row, index) => (
        <View
          key={`exercise-${index}-${row.displayName}`}
          className='feed-exercise-activity-card'
          onClick={(e) => {
            e.stopPropagation()
            onItemClick?.(row)
          }}
        >
          <View className='feed-exercise-activity-thumb'>
            <Text className='iconfont icon-zengji feed-exercise-activity-icon' />
          </View>
          <View className='feed-exercise-activity-info'>
            <View className='feed-exercise-activity-title-row'>
              <Text className='feed-exercise-activity-title'>{row.displayName}</Text>
              {row.intensityLabel ? (
                <View className='feed-exercise-activity-badge'>
                  <Text className='feed-exercise-activity-badge-text'>{row.intensityLabel}</Text>
                </View>
              ) : null}
            </View>
            {row.metaText ? (
              <Text className='feed-exercise-activity-meta'>{row.metaText}</Text>
            ) : null}
            <Text className='feed-exercise-activity-calories'>{row.calorieText}</Text>
          </View>
        </View>
      ))}
    </View>
  )
}
