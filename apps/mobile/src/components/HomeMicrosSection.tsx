import { useMemo } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import type { HomeDashboard } from '@food-link/core'

export type HomeMicronutrientKey =
  | 'fiber'
  | 'sugar'
  | 'saturatedFat'
  | 'cholesterolMg'
  | 'sodiumMg'
  | 'potassiumMg'
  | 'calciumMg'
  | 'ironMg'
  | 'magnesiumMg'
  | 'zincMg'
  | 'vitaminARaeMcg'
  | 'vitaminCMg'
  | 'vitaminDMcg'
  | 'vitaminEMg'
  | 'vitaminKMcg'
  | 'thiaminMg'
  | 'riboflavinMg'
  | 'niacinMg'
  | 'vitaminB6Mg'
  | 'folateMcg'
  | 'vitaminB12Mcg'

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

function formatDisplayNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}

function formatMicronutrientValue(value: number): string {
  if (value >= 100) {
    return formatDisplayNumber(Math.round(value))
  }
  const rounded = Math.round((value + Number.EPSILON) * 10) / 10
  return formatDisplayNumber(rounded)
}

function useMicronutrients(intakeData: HomeDashboard['intakeData'] | undefined) {
  return useMemo<MicronutrientCard[]>(() => (
    MICRONUTRIENT_CONFIGS
      .map((item) => {
        const parsed = parseMicronutrientValue(intakeData?.micros?.[item.key])
        return {
          ...item,
          current: parsed.current,
          target: parsed.target,
          progress: parsed.progress,
        }
      })
  ), [intakeData?.micros])
}

export interface HomeMicrosSectionProps {
  intakeData?: HomeDashboard['intakeData']
  dashboardBusy?: boolean
  isGuest?: boolean
}

export function HomeMicrosSection({
  intakeData,
  dashboardBusy = false,
  isGuest = false,
}: HomeMicrosSectionProps) {
  const micronutrients = useMicronutrients(intakeData)
  const hasMicros = micronutrients.length > 0
  const statusText = useMemo(() => {
    if (dashboardBusy) return '同步中'
    if (hasMicros) return `${micronutrients.length}项`
    if (isGuest) return '登录后'
    return '待记录'
  }, [dashboardBusy, hasMicros, isGuest, micronutrients.length])

  return (
    <View style={styles.container}>
      <View style={styles.head}>
        <View style={styles.copy}>
          <Text style={styles.kicker}>微量营养</Text>
        </View>
        <View style={styles.status}>
          <Text style={styles.statusText}>{statusText}</Text>
        </View>
      </View>

      {dashboardBusy ? (
        <View style={styles.grid}>
          {MICRONUTRIENT_CONFIGS.map((item) => (
            <View key={item.key} style={[styles.card, styles.skeletonCard]}>
              <View style={[styles.skeleton, styles.skeletonLabel]} />
              <View style={[styles.skeleton, styles.skeletonValue]} />
              <View style={[styles.skeleton, styles.skeletonProgress]} />
            </View>
          ))}
        </View>
      ) : hasMicros ? (
        <View style={styles.grid}>
          {micronutrients.map((item) => {
            const showTarget = item.target > 0
            const progressPct = Math.min(100, item.progress)
            return (
              <View
                key={item.key}
                style={[
                  styles.card,
                  {
                    borderColor: `${item.accent}33`,
                    backgroundColor: `${item.accent}10`,
                  },
                ]}
              >
                <Text style={styles.label}>{item.label}</Text>
                <View style={styles.valueRow}>
                  <Text style={[styles.value, { color: item.accent }]}>
                    {formatMicronutrientValue(item.current)}
                  </Text>
                  {showTarget ? (
                    <Text style={styles.target}>
                      /{formatMicronutrientValue(item.target)}{item.unit}
                    </Text>
                  ) : (
                    <Text style={styles.unit}>{item.unit}</Text>
                  )}
                </View>
                {showTarget && (
                  <View style={styles.progressBg}>
                    <View
                      style={[
                        styles.progressFill,
                        { width: `${progressPct}%`, backgroundColor: item.accent },
                      ]}
                    />
                  </View>
                )}
              </View>
            )
          })}
        </View>
      ) : (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>{isGuest ? '登录后显示微量营养' : '记录饮食后显示微量营养'}</Text>
        </View>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'column',
    paddingTop: 0,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: 8,
  },
  copy: {
    flex: 1,
    minWidth: 0,
  },
  kicker: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '800',
    color: '#34495e',
  },
  status: {
    flexShrink: 0,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: '#f3f8f5',
  },
  statusText: {
    fontSize: 9,
    lineHeight: 12,
    fontWeight: '700',
    color: '#5aa783',
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
  },
  card: {
    minWidth: 0,
    minHeight: 48,
    paddingVertical: 5,
    paddingHorizontal: 6,
    borderRadius: 7,
    borderWidth: 1,
    borderColor: 'transparent',
    width: '24%',
  },
  skeletonCard: {
    backgroundColor: '#f8fafc',
    borderColor: '#eef2f7',
  },
  skeleton: {
    borderRadius: 999,
    backgroundColor: '#eef2f7',
  },
  skeletonLabel: {
    width: 32,
    height: 9,
  },
  skeletonValue: {
    width: 36,
    height: 14,
    marginTop: 6,
  },
  skeletonProgress: {
    width: '100%',
    height: 3,
    marginTop: 5,
  },
  label: {
    fontSize: 9,
    fontWeight: '600',
    lineHeight: 12,
    color: '#475569',
    overflow: 'hidden',
  },
  valueRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 2,
    marginTop: 3,
  },
  value: {
    fontSize: 13,
    lineHeight: 16,
    fontWeight: '700',
  },
  target: {
    fontSize: 8,
    lineHeight: 10,
    color: '#94a3b8',
  },
  unit: {
    fontSize: 8,
    lineHeight: 10,
    color: '#94a3b8',
  },
  progressBg: {
    width: '100%',
    height: 3,
    borderRadius: 999,
    backgroundColor: 'rgba(0,0,0,0.06)',
    marginTop: 4,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 999,
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    paddingRight: 4,
    paddingBottom: 4,
  },
  emptyText: {
    fontSize: 11,
    lineHeight: 16,
    color: '#94a3b8',
  },
})
