import { useMemo } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import type { HomeIntakeData } from '@food-link/core'
import { colors, compactFont } from '../theme'

type MicroKey =
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

type MicroCard = {
  key: MicroKey
  label: string
  unit: string
  accent: string
  current: number
  target: number
  progress: number
}

const MICRO_CONFIGS: Array<Omit<MicroCard, 'current' | 'target' | 'progress'>> = [
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

function parseMicroValue(raw: unknown) {
  if (raw && typeof raw === 'object') {
    const item = raw as Record<string, unknown>
    const current = Number(item.current)
    const target = Number(item.target)
    const progress = Number(item.progress)
    return {
      current: Number.isFinite(current) && current > 0 ? current : 0,
      target: Number.isFinite(target) && target > 0 ? target : 0,
      progress: Number.isFinite(progress) && progress > 0 ? progress : 0,
    }
  }
  const current = Number(raw)
  return {
    current: Number.isFinite(current) && current > 0 ? current : 0,
    target: 0,
    progress: 0,
  }
}

function formatMicroNumber(value: number) {
  if (value >= 100) return String(Math.round(value))
  const rounded = Math.round((value + Number.EPSILON) * 10) / 10
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)
}

export function HomeMicrosSection({ intakeData }: { intakeData?: HomeIntakeData | null }) {
  const micronutrients = useMemo<MicroCard[]>(() => {
    const micros = intakeData?.micros || {}
    return MICRO_CONFIGS.map((config) => ({
      ...config,
      ...parseMicroValue(micros[config.key]),
    }))
  }, [intakeData?.micros])

  const hasAnyCurrent = micronutrients.some((item) => item.current > 0)

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.kicker}>微量营养</Text>
        <Text style={styles.countText}>{hasAnyCurrent ? `${micronutrients.length}项` : '待记录'}</Text>
      </View>

      {hasAnyCurrent ? (
        <View style={styles.grid}>
          {micronutrients.map((item) => {
            const showTarget = item.target > 0
            const progressPct = Math.min(100, Math.max(0, item.progress))
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
                <Text style={styles.label} numberOfLines={1}>{item.label}</Text>
                <View style={styles.valueRow}>
                  <Text style={[styles.value, { color: item.accent }]}>{formatMicroNumber(item.current)}</Text>
                  <Text style={styles.unit}>
                    {showTarget ? `/${formatMicroNumber(item.target)}${item.unit}` : item.unit}
                  </Text>
                </View>
                {showTarget && (
                  <View style={styles.progressTrack}>
                    <View style={[styles.progressFill, { width: `${progressPct}%`, backgroundColor: item.accent }]} />
                  </View>
                )}
              </View>
            )
          })}
        </View>
      ) : (
        <View style={styles.emptyBox}>
          <Text style={styles.emptyText}>记录饮食后显示微量营养</Text>
        </View>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    marginTop: 10,
    paddingHorizontal: 2,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  kicker: {
    color: colors.text,
    fontSize: compactFont(13),
    fontWeight: '800',
  },
  countText: {
    color: colors.textMuted,
    fontSize: compactFont(11),
    fontWeight: '700',
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  card: {
    borderRadius: 8,
    borderWidth: 1,
    minHeight: 70,
    paddingHorizontal: 10,
    paddingVertical: 8,
    width: '31.8%',
  },
  label: {
    color: colors.textSecondary,
    fontSize: compactFont(10),
    fontWeight: '700',
    marginBottom: 5,
  },
  valueRow: {
    alignItems: 'baseline',
    flexDirection: 'row',
    minHeight: 22,
  },
  value: {
    fontSize: compactFont(16),
    fontWeight: '900',
  },
  unit: {
    color: colors.textMuted,
    fontSize: compactFont(9),
    fontWeight: '700',
    marginLeft: 2,
  },
  progressTrack: {
    backgroundColor: 'rgba(30, 41, 59, 0.08)',
    borderRadius: 999,
    height: 4,
    marginTop: 8,
    overflow: 'hidden',
  },
  progressFill: {
    borderRadius: 999,
    height: '100%',
  },
  emptyBox: {
    alignItems: 'center',
    backgroundColor: '#f5f8f4',
    borderRadius: 8,
    justifyContent: 'center',
    minHeight: 64,
  },
  emptyText: {
    color: colors.textMuted,
    fontSize: compactFont(12),
    fontWeight: '700',
  },
})
