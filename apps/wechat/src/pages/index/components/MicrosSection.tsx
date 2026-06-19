import { View, Text } from '@tarojs/components'
import { useMemo } from 'react'
import { type HomeIntakeData, type Nutrients } from '../../../utils/api'
import { formatDisplayNumber } from '../utils/helpers'

type HomeMicronutrientKey = keyof Pick<Nutrients,
  'fiber' |
  'sugar' |
  'saturatedFat' |
  'cholesterolMg' |
  'sodiumMg' |
  'potassiumMg' |
  'calciumMg' |
  'ironMg' |
  'magnesiumMg' |
  'zincMg' |
  'vitaminARaeMcg' |
  'vitaminCMg' |
  'vitaminDMcg' |
  'vitaminEMg' |
  'vitaminKMcg' |
  'thiaminMg' |
  'riboflavinMg' |
  'niacinMg' |
  'vitaminB6Mg' |
  'folateMcg' |
  'vitaminB12Mcg'
>

type MicronutrientCard = {
  key: HomeMicronutrientKey
  label: string
  unit: string
  accent: string
  current: number
  target: number
  progress: number
}

const MICRONUTRIENT_CONFIGS: Array<{
  key: HomeMicronutrientKey
  label: string
  unit: string
  accent: string
}> = [
  { key: 'fiber', label: '膳食纤维', unit: 'g', accent: '#5dbb8a' },
  { key: 'sugar', label: '糖', unit: 'g', accent: '#e88cb8' },
  { key: 'saturatedFat', label: '饱和脂肪', unit: 'g', accent: '#d4a373' },
  { key: 'cholesterolMg', label: '胆固醇', unit: 'mg', accent: '#bc8f8f' },
  { key: 'sodiumMg', label: '钠', unit: 'mg', accent: '#ef8b73' },
  { key: 'potassiumMg', label: '钾', unit: 'mg', accent: '#57a99a' },
  { key: 'calciumMg', label: '钙', unit: 'mg', accent: '#6aa7d8' },
  { key: 'ironMg', label: '铁', unit: 'mg', accent: '#d88d5a' },
  { key: 'magnesiumMg', label: '镁', unit: 'mg', accent: '#7eb8da' },
  { key: 'zincMg', label: '锌', unit: 'mg', accent: '#a8a4ce' },
  { key: 'vitaminARaeMcg', label: '维A', unit: 'mcg', accent: '#e0a14a' },
  { key: 'vitaminCMg', label: '维C', unit: 'mg', accent: '#71c16f' },
  { key: 'vitaminDMcg', label: '维D', unit: 'mcg', accent: '#8a7be0' },
  { key: 'vitaminEMg', label: '维E', unit: 'mg', accent: '#c0a46e' },
  { key: 'vitaminKMcg', label: '维K', unit: 'mcg', accent: '#8fbc8f' },
  { key: 'thiaminMg', label: '维B1', unit: 'mg', accent: '#d4a5a5' },
  { key: 'riboflavinMg', label: '维B2', unit: 'mg', accent: '#9fb4cc' },
  { key: 'niacinMg', label: '烟酸', unit: 'mg', accent: '#b8a9c9' },
  { key: 'vitaminB6Mg', label: '维B6', unit: 'mg', accent: '#a3c4a3' },
  { key: 'folateMcg', label: '叶酸', unit: 'mcg', accent: '#d8b4a0' },
  { key: 'vitaminB12Mcg', label: '维B12', unit: 'mcg', accent: '#9ecae1' },
]

function parseMicronutrientValue(raw: unknown): { current: number; target: number; progress: number } {
  if (raw && typeof raw === 'object') {
    const obj = raw as Record<string, unknown>
    const current = Number(obj.current)
    const target = Number(obj.target)
    const progress = Number(obj.progress)
    return {
      current: Number.isFinite(current) && current > 0 ? current : 0,
      target: Number.isFinite(target) && target > 0 ? target : 0,
      progress: Number.isFinite(progress) && progress > 0 ? progress : 0,
    }
  }
  const value = Number(raw)
  return {
    current: Number.isFinite(value) && value > 0 ? value : 0,
    target: 0,
    progress: 0,
  }
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
      .map((item) => {
        const parsed = parseMicronutrientValue(intakeData.micros?.[item.key])
        return {
          ...item,
          current: parsed.current,
          target: parsed.target,
          progress: parsed.progress,
        }
      })
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
          {Array.from({ length: MICRONUTRIENT_CONFIGS.length }).map((_, index) => (
            <View key={index} className='micros-preview-card micros-preview-card--loading'>
              <View className='micros-skeleton micros-skeleton--label' />
              <View className='micros-skeleton micros-skeleton--value' />
              <View className='micros-skeleton micros-skeleton--progress' />
            </View>
          ))}
        </View>
      ) : hasMicros ? (
        <View className='micros-preview-grid'>
          {micronutrients.map((item) => {
            const showTarget = item.target > 0
            const progressPct = Math.min(100, item.progress)
            return (
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
                    {formatMicronutrientValue(item.current)}
                  </Text>
                  {showTarget && (
                    <Text className='micros-preview-card-target'>
                      /{formatMicronutrientValue(item.target)}{item.unit}
                    </Text>
                  )}
                  {!showTarget && (
                    <Text className='micros-preview-card-unit'>{item.unit}</Text>
                  )}
                </View>
                {showTarget && (
                  <View className='micros-preview-progress-bg'>
                    <View
                      className='micros-preview-progress-fill'
                      style={{
                        width: `${progressPct}%`,
                        backgroundColor: item.accent,
                      }}
                    />
                  </View>
                )}
              </View>
            )
          })}
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
