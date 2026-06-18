import { View, Text } from '@tarojs/components'
import { useMemo } from 'react'
import { type HomeIntakeData, type Nutrients } from '../../../utils/api'
import { formatDisplayNumber } from '../utils/helpers'

type HomeMicronutrientKey = keyof Pick<Nutrients,
  'fiber' |
  'sodiumMg' |
  'potassiumMg' |
  'calciumMg' |
  'ironMg' |
  'vitaminARaeMcg' |
  'vitaminCMg' |
  'vitaminDMcg'
>

type MicronutrientCard = {
  key: HomeMicronutrientKey
  label: string
  unit: string
  accent: string
  value: number
}

const MICRONUTRIENT_CONFIGS: Array<{
  key: HomeMicronutrientKey
  label: string
  unit: string
  accent: string
}> = [
  { key: 'fiber', label: '膳食纤维', unit: 'g', accent: '#5dbb8a' },
  { key: 'sodiumMg', label: '钠', unit: 'mg', accent: '#ef8b73' },
  { key: 'potassiumMg', label: '钾', unit: 'mg', accent: '#57a99a' },
  { key: 'calciumMg', label: '钙', unit: 'mg', accent: '#6aa7d8' },
  { key: 'ironMg', label: '铁', unit: 'mg', accent: '#d88d5a' },
  { key: 'vitaminARaeMcg', label: '维A', unit: 'mcg', accent: '#e0a14a' },
  { key: 'vitaminCMg', label: '维C', unit: 'mg', accent: '#71c16f' },
  { key: 'vitaminDMcg', label: '维D', unit: 'mcg', accent: '#8a7be0' },
]

function normalizeMicronutrientValue(value: unknown): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return 0
  return parsed
}

function formatMicronutrientValue(value: number): string {
  if (value >= 100) {
    return formatDisplayNumber(Math.round(value))
  }
  const rounded = Math.round((value + Number.EPSILON) * 10) / 10
  return formatDisplayNumber(rounded)
}

function useMicronutrients(intakeData: HomeIntakeData) {
  return useMemo<MicronutrientCard[]>(() => (
    MICRONUTRIENT_CONFIGS
      .map((item) => ({
        ...item,
        value: normalizeMicronutrientValue(intakeData.micros?.[item.key]),
      }))
      .filter((item) => item.value > 0)
  ), [intakeData.micros])
}

export interface MicrosSectionProps {
  intakeData: HomeIntakeData
  dashboardBusy: boolean
  isGuest: boolean
}

export function MicrosSection({
  intakeData,
  dashboardBusy,
  isGuest,
}: MicrosSectionProps) {
  const micronutrients = useMicronutrients(intakeData)
  const hasMicros = micronutrients.length > 0

  const statusText = useMemo(() => {
    if (dashboardBusy) return '同步中'
    if (hasMicros) return `${micronutrients.length}项`
    if (isGuest) return '登录后'
    return '待记录'
  }, [dashboardBusy, hasMicros, isGuest, micronutrients.length])

  return (
    <View className='micros-preview'>
      <View className='micros-preview-head'>
        <View className='micros-preview-copy'>
          <Text className='micros-preview-kicker'>微量营养</Text>
        </View>
        <View className='micros-preview-status'>
          <Text className='micros-preview-status-text'>{statusText}</Text>
        </View>
      </View>

      {dashboardBusy ? (
        <View className='micros-preview-grid'>
          {Array.from({ length: 8 }).map((_, index) => (
            <View key={index} className='micros-preview-card micros-preview-card--loading'>
              <View className='micros-skeleton micros-skeleton--label' />
              <View className='micros-skeleton micros-skeleton--value' />
            </View>
          ))}
        </View>
      ) : hasMicros ? (
        <View className='micros-preview-grid'>
          {micronutrients.map((item) => (
            <View
              key={item.key}
              className='micros-preview-card'
              style={{
                borderColor: `${item.accent}33`,
                background: `${item.accent}10`,
              }}
            >
              <Text className='micros-preview-card-label'>{item.label}</Text>
              <View className='micros-preview-card-value-row'>
                <Text className='micros-preview-card-value' style={{ color: item.accent }}>
                  {formatMicronutrientValue(item.value)}
                </Text>
                <Text className='micros-preview-card-unit'>{item.unit}</Text>
              </View>
            </View>
          ))}
        </View>
      ) : (
        <View className='micros-preview-empty'>
          <Text className='micros-preview-empty-text'>
            {isGuest ? '登录后显示微量营养' : '记录饮食后显示微量营养'}
          </Text>
        </View>
      )}
    </View>
  )
}
