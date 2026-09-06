import { useMemo, useState } from 'react'
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
  type DimensionValue,
} from 'react-native'
import { AlertTriangle, X } from 'lucide-react-native'
import type {
  HomeDashboard,
  SupplementComponentTotal,
  SupplementDashboardSummary,
} from '@food-link/core'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useColorScheme } from '../providers/ColorSchemeProvider'

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
  foodCurrent: number
  supplementCurrent: number
  target: number
  progress: number
}

type MicrosPalette = ReturnType<typeof createMicrosPalette>

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

function clampPercentage(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(100, Math.max(0, value))
}

function percentageWidth(value: number): DimensionValue {
  return (String(clampPercentage(value)) + '%') as DimensionValue
}

function parseMicronutrientValue(raw: unknown): {
  current: number
  foodCurrent: number
  supplementCurrent: number
  target: number
  progress: number
} {
  if (raw && typeof raw === 'object') {
    const obj = raw as Record<string, unknown>
    const current = Number(obj.current)
    const target = Number(obj.target)
    const progress = Number(obj.progress)
    const foodCurrent = Number(obj.food_current)
    const supplementCurrent = Number(obj.supplement_current)
    const normalizedCurrent = Number.isFinite(current) && current > 0 ? current : 0
    const normalizedSupplement = Number.isFinite(supplementCurrent) && supplementCurrent > 0
      ? supplementCurrent
      : 0
    return {
      current: normalizedCurrent,
      foodCurrent: Number.isFinite(foodCurrent) && foodCurrent > 0
        ? foodCurrent
        : Math.max(0, normalizedCurrent - normalizedSupplement),
      supplementCurrent: normalizedSupplement,
      target: Number.isFinite(target) && target > 0 ? target : 0,
      progress: Number.isFinite(progress) && progress > 0 ? progress : 0,
    }
  }
  const value = Number(raw)
  const normalized = Number.isFinite(value) && value > 0 ? value : 0
  return {
    current: normalized,
    foodCurrent: normalized,
    supplementCurrent: 0,
    target: 0,
    progress: 0,
  }
}

function formatDisplayNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}

function formatMicronutrientValue(value: number): string {
  if (value >= 100) return formatDisplayNumber(Math.round(value))
  const rounded = Math.round((value + Number.EPSILON) * 10) / 10
  return formatDisplayNumber(rounded)
}

function useMicronutrients(intakeData: HomeDashboard['intakeData'] | undefined) {
  return useMemo<MicronutrientCard[]>(() => (
    MICRONUTRIENT_CONFIGS.map((item) => {
      const parsed = parseMicronutrientValue(intakeData?.micros?.[item.key])
      return {
        ...item,
        current: parsed.current,
        foodCurrent: parsed.foodCurrent,
        supplementCurrent: parsed.supplementCurrent,
        target: parsed.target,
        progress: parsed.progress,
      }
    })
  ), [intakeData?.micros])
}

function createMicrosPalette(isDark: boolean) {
  return {
    text: isDark ? '#e7eeeb' : '#34495e',
    textSecondary: isDark ? '#b6c5bf' : '#475569',
    textMuted: isDark ? '#8fa39a' : '#7a8792',
    statusBackground: isDark ? '#20302a' : '#f3f8f5',
    statusText: isDark ? '#7fd2ad' : '#5aa783',
    skeleton: isDark ? '#25312d' : '#eef2f7',
    skeletonCard: isDark ? '#1b2521' : '#f8fafc',
    skeletonBorder: isDark ? '#2b3934' : '#eef2f7',
    progressTrack: isDark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.06)',
    panel: isDark ? '#18231f' : '#fbfdfc',
    panelBorder: isDark ? '#2a3a34' : '#e6ece9',
    panelItem: isDark ? '#20312a' : '#f0f7f4',
    warningBackground: isDark ? '#352f21' : '#f8f3e8',
    warningBorder: isDark ? '#5a4d2d' : '#eadfca',
    warningText: isDark ? '#f1d58e' : '#77633d',
    modalBackground: isDark ? '#18211e' : '#ffffff',
    modalHandle: isDark ? '#45554f' : '#d8dfdc',
    modalDivider: isDark ? '#2b3934' : '#edf1ef',
    modalNote: isDark ? '#20312a' : '#f2f8f5',
    modalClose: isDark ? '#25312d' : '#f1f5f3',
    backdrop: 'rgba(15,23,42,0.52)',
  }
}

function SupplementTotalsPanel({
  title,
  note,
  items,
  palette,
  testID,
}: {
  title: string
  note: string
  items: SupplementComponentTotal[]
  palette: MicrosPalette
  testID: string
}) {
  if (!items.length) return null

  return (
    <View
      testID={testID}
      style={[styles.componentsPanel, { backgroundColor: palette.panel, borderColor: palette.panelBorder }]}
    >
      <View style={styles.componentsHead}>
        <Text style={[styles.componentsTitle, { color: palette.text }]}>{title}</Text>
        <Text style={[styles.componentsNote, { color: palette.textMuted }]}>{note}</Text>
      </View>
      <View style={styles.componentsList}>
        {items.slice(0, 6).map((item) => (
          <View
            key={item.code + '-' + item.unit}
            style={[styles.componentItem, { backgroundColor: palette.panelItem }]}
          >
            <Text style={[styles.componentName, { color: palette.textSecondary }]} numberOfLines={1}>
              {item.name}
            </Text>
            <Text style={[styles.componentAmount, { color: palette.textMuted }]} numberOfLines={1}>
              {formatMicronutrientValue(item.amount)}{item.unit}
            </Text>
          </View>
        ))}
      </View>
    </View>
  )
}

export interface HomeMicrosSectionProps {
  intakeData?: HomeDashboard['intakeData']
  dashboardBusy?: boolean
  isGuest?: boolean
  supplementSummary?: SupplementDashboardSummary | null
  reduceMotion?: boolean
}

export function HomeMicrosSection({
  intakeData,
  dashboardBusy = false,
  isGuest = false,
  supplementSummary,
  reduceMotion = false,
}: HomeMicrosSectionProps) {
  const { isDark } = useColorScheme()
  const insets = useSafeAreaInsets()
  const palette = createMicrosPalette(isDark)
  const [sourceDetailKey, setSourceDetailKey] = useState<HomeMicronutrientKey | null>(null)
  const micronutrients = useMicronutrients(intakeData)
  const hasMicros = micronutrients.length > 0
  const sourceDetail = sourceDetailKey
    ? micronutrients.find((item) => item.key === sourceDetailKey) || null
    : null
  const sourceDetailTotal = (sourceDetail?.foodCurrent || 0) + (sourceDetail?.supplementCurrent || 0)
  const sourceDetailFoodWidth = sourceDetailTotal > 0
    ? clampPercentage(((sourceDetail?.foodCurrent || 0) / sourceDetailTotal) * 100)
    : 0
  const sourceDetailSupplementWidth = sourceDetailTotal > 0
    ? clampPercentage(((sourceDetail?.supplementCurrent || 0) / sourceDetailTotal) * 100)
    : 0

  const statusText = useMemo(() => {
    if (hasMicros) return micronutrients.length + '项'
    if (isGuest) return '登录后'
    return '待记录'
  }, [hasMicros, isGuest, micronutrients.length])

  return (
    <View style={styles.container}>
      <View style={styles.head}>
        <View style={styles.copy}>
          <Text style={[styles.kicker, { color: palette.text }]}>微量营养</Text>
        </View>
        <View style={[styles.status, { backgroundColor: palette.statusBackground }]}>
          {dashboardBusy ? (
            <ActivityIndicator size="small" color={palette.statusText} />
          ) : (
            <Text style={[styles.statusText, { color: palette.statusText }]}>{statusText}</Text>
          )}
        </View>
      </View>

      <View style={styles.legend} accessibilityLabel="进度条颜色：绿色代表食物，蓝色代表补剂">
        <View style={styles.legendItem}>
          <View style={[styles.sourceDot, styles.foodSource]} />
          <Text style={[styles.legendText, { color: palette.textMuted }]}>食物</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.sourceDot, styles.supplementSource]} />
          <Text style={[styles.legendText, { color: palette.textMuted }]}>补剂</Text>
        </View>
      </View>

      {dashboardBusy ? (
        <View style={styles.grid}>
          {MICRONUTRIENT_CONFIGS.map((item) => (
            <View
              key={item.key}
              style={[
                styles.card,
                { backgroundColor: palette.skeletonCard, borderColor: palette.skeletonBorder },
              ]}
            >
              <View style={[styles.skeleton, styles.skeletonLabel, { backgroundColor: palette.skeleton }]} />
              <View style={[styles.skeleton, styles.skeletonValue, { backgroundColor: palette.skeleton }]} />
              <View style={[styles.skeleton, styles.skeletonProgress, { backgroundColor: palette.skeleton }]} />
            </View>
          ))}
        </View>
      ) : hasMicros ? (
        <View style={styles.grid}>
          {micronutrients.map((item) => {
            const showTarget = item.target > 0
            const progressPct = clampPercentage(item.progress)
            const hasSupplement = item.supplementCurrent > 0
            const foodWidth = item.current > 0
              ? clampPercentage((item.foodCurrent / item.current) * progressPct)
              : 0
            const supplementWidth = item.current > 0
              ? clampPercentage((item.supplementCurrent / item.current) * progressPct)
              : 0
            const cardStyle = [
              styles.card,
              {
                borderColor: item.accent + '33',
                backgroundColor: item.accent + (isDark ? '18' : '10'),
              },
            ]
            const content = (
              <>
                <View style={styles.labelRow}>
                  <Text style={[styles.label, { color: palette.textSecondary }]} numberOfLines={1}>
                    {item.label}
                  </Text>
                  {hasSupplement ? (
                    <View style={styles.supplementBadge}>
                      <Text style={styles.supplementBadgeText}>补</Text>
                    </View>
                  ) : null}
                </View>
                <View style={styles.valueRow}>
                  <Text style={[styles.value, { color: item.accent }]}>
                    {formatMicronutrientValue(item.current)}
                  </Text>
                  {showTarget ? (
                    <Text style={[styles.target, { color: palette.textMuted }]} numberOfLines={1}>
                      /{formatMicronutrientValue(item.target)}{item.unit}
                    </Text>
                  ) : (
                    <Text style={[styles.unit, { color: palette.textMuted }]}>{item.unit}</Text>
                  )}
                </View>
                {showTarget ? (
                  <View style={[styles.progressBg, { backgroundColor: palette.progressTrack }]}>
                    <View
                      style={[
                        styles.progressFill,
                        styles.foodProgress,
                        {
                          width: percentageWidth(foodWidth || (hasSupplement ? 0 : progressPct)),
                          backgroundColor: hasSupplement ? '#61ae8d' : item.accent,
                        },
                      ]}
                    />
                    {hasSupplement ? (
                      <View
                        style={[
                          styles.progressFill,
                          styles.supplementProgress,
                          { width: percentageWidth(supplementWidth) },
                        ]}
                      />
                    ) : null}
                  </View>
                ) : null}
              </>
            )

            return hasSupplement ? (
              <Pressable
                key={item.key}
                testID={'home-micro-' + item.key}
                accessibilityRole="button"
                accessibilityLabel={
                  item.label + '今日合计' + formatMicronutrientValue(item.current) + item.unit
                  + '，食物' + formatMicronutrientValue(item.foodCurrent) + item.unit
                  + '，补剂' + formatMicronutrientValue(item.supplementCurrent) + item.unit
                }
                accessibilityHint="打开营养素来源详情"
                onPress={() => setSourceDetailKey(item.key)}
                style={({ pressed }) => [cardStyle, pressed && styles.pressed]}
              >
                {content}
              </Pressable>
            ) : (
              <View key={item.key} style={cardStyle}>
                {content}
              </View>
            )
          })}
        </View>
      ) : (
        <View style={styles.empty}>
          <Text style={[styles.emptyText, { color: palette.textMuted }]}>
            {isGuest ? '登录后显示微量营养' : '记录饮食后显示微量营养'}
          </Text>
        </View>
      )}

      {supplementSummary?.duplicate_components?.length ? (
        <View
          testID="home-micros-duplicate-warning"
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
          style={[
            styles.duplicateBanner,
            { backgroundColor: palette.warningBackground, borderColor: palette.warningBorder },
          ]}
        >
          <AlertTriangle size={18} color={palette.warningText} />
          <View style={styles.duplicateCopy}>
            <Text style={[styles.duplicateTitle, { color: palette.warningText }]}>发现重复成分</Text>
            <Text style={[styles.duplicateText, { color: palette.warningText }]}>
              {supplementSummary.duplicate_components.join('、')}。请核对补剂柜中的标签与计划。
            </Text>
          </View>
        </View>
      ) : null}

      <SupplementTotalsPanel
        testID="home-micros-additional-nutrients"
        title="其他标签营养素"
        note="已记录，暂未配置参考目标"
        items={supplementSummary?.additional_nutrients || []}
        palette={palette}
      />
      <SupplementTotalsPanel
        testID="home-micros-functional-components"
        title="功能成分"
        note="按实际摄入记录，不计入营养达标率"
        items={supplementSummary?.functional_components || []}
        palette={palette}
      />

      <Modal
        visible={Boolean(sourceDetail)}
        transparent
        statusBarTranslucent
        animationType={reduceMotion ? 'none' : 'slide'}
        onRequestClose={() => setSourceDetailKey(null)}
      >
        <View style={styles.modalLayer}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="关闭营养素来源"
            style={[styles.modalBackdrop, { backgroundColor: palette.backdrop }]}
            onPress={() => setSourceDetailKey(null)}
          />
          {sourceDetail ? (
            <View
              testID="home-micros-source-sheet"
              accessibilityViewIsModal
              style={[
                styles.sourceSheet,
                {
                  backgroundColor: palette.modalBackground,
                  paddingBottom: Math.max(insets.bottom, 16),
                },
              ]}
            >
              <View style={[styles.sheetHandle, { backgroundColor: palette.modalHandle }]} />
              <View style={styles.sheetHead}>
                <View style={styles.sheetHeading}>
                  <Text style={[styles.sheetKicker, { color: palette.textMuted }]}>营养素来源</Text>
                  <Text style={[styles.sheetTitle, { color: palette.text }]}>{sourceDetail.label}</Text>
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="关闭营养素来源"
                  hitSlop={4}
                  onPress={() => setSourceDetailKey(null)}
                  style={({ pressed }) => [
                    styles.sheetClose,
                    { backgroundColor: palette.modalClose },
                    pressed && styles.pressed,
                  ]}
                >
                  <X size={22} color={palette.textSecondary} />
                </Pressable>
              </View>

              <View style={styles.sheetTotal}>
                <Text style={[styles.sheetTotalLabel, { color: palette.textMuted }]}>今日合计</Text>
                <Text style={[styles.sheetTotalValue, { color: palette.text }]}>
                  {formatMicronutrientValue(sourceDetail.current)}{sourceDetail.unit}
                </Text>
              </View>
              <View style={[styles.sheetBar, { backgroundColor: palette.progressTrack }]}>
                <View style={[styles.foodSource, { width: percentageWidth(sourceDetailFoodWidth) }]} />
                <View style={[styles.supplementSource, { width: percentageWidth(sourceDetailSupplementWidth) }]} />
              </View>

              <View style={[styles.sheetRow, { borderBottomColor: palette.modalDivider }]}>
                <View style={styles.sheetRowLabel}>
                  <View style={[styles.sourceDot, styles.foodSource]} />
                  <Text style={[styles.sheetRowText, { color: palette.textSecondary }]}>食物</Text>
                </View>
                <Text style={[styles.sheetRowValue, { color: palette.text }]}>
                  {formatMicronutrientValue(sourceDetail.foodCurrent)}{sourceDetail.unit}
                </Text>
              </View>
              <View style={[styles.sheetRow, { borderBottomColor: palette.modalDivider }]}>
                <View style={styles.sheetRowLabel}>
                  <View style={[styles.sourceDot, styles.supplementSource]} />
                  <Text style={[styles.sheetRowText, { color: palette.textSecondary }]}>补剂</Text>
                </View>
                <Text style={[styles.sheetRowValue, { color: palette.text }]}>
                  {formatMicronutrientValue(sourceDetail.supplementCurrent)}{sourceDetail.unit}
                </Text>
              </View>

              {sourceDetail.target > 0 ? (
                <Text style={[styles.sheetNote, { color: palette.textSecondary, backgroundColor: palette.modalNote }]}>
                  当前参考目标 {formatMicronutrientValue(sourceDetail.target)}{sourceDetail.unit}
                  {sourceDetail.current > sourceDetail.target
                    ? '，合计高出 '
                      + formatMicronutrientValue(sourceDetail.current - sourceDetail.target)
                      + sourceDetail.unit
                    : ''}
                </Text>
              ) : null}
            </View>
          ) : null}
        </View>
      </Modal>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'column',
    paddingTop: 0,
  },
  head: {
    minHeight: 32,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: 4,
  },
  copy: {
    flex: 1,
    minWidth: 0,
  },
  kicker: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '800',
  },
  status: {
    minWidth: 36,
    minHeight: 24,
    flexShrink: 0,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusText: {
    fontSize: 9,
    lineHeight: 12,
    fontWeight: '700',
  },
  legend: {
    minHeight: 24,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 12,
    marginBottom: 5,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  sourceDot: {
    width: 6,
    height: 6,
    borderRadius: 999,
  },
  foodSource: {
    backgroundColor: '#61ae8d',
  },
  supplementSource: {
    backgroundColor: '#5d8fcb',
  },
  legendText: {
    fontSize: 9,
    lineHeight: 12,
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
    paddingHorizontal: 5,
    borderRadius: 7,
    borderWidth: 1,
    width: '24%',
  },
  pressed: {
    opacity: 0.72,
  },
  skeleton: {
    borderRadius: 999,
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
  labelRow: {
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 2,
  },
  label: {
    minWidth: 0,
    flex: 1,
    fontSize: 9,
    fontWeight: '600',
    lineHeight: 12,
    overflow: 'hidden',
  },
  supplementBadge: {
    width: 14,
    height: 14,
    flexShrink: 0,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#5d8fcb',
  },
  supplementBadgeText: {
    color: '#fff',
    fontSize: 8,
    lineHeight: 10,
    fontWeight: '800',
  },
  valueRow: {
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 2,
    marginTop: 3,
  },
  value: {
    fontSize: 13,
    lineHeight: 16,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  target: {
    minWidth: 0,
    flexShrink: 1,
    fontSize: 8,
    lineHeight: 10,
  },
  unit: {
    fontSize: 8,
    lineHeight: 10,
  },
  progressBg: {
    width: '100%',
    height: 3,
    flexDirection: 'row',
    borderRadius: 999,
    marginTop: 4,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
  },
  foodProgress: {
    borderTopLeftRadius: 999,
    borderBottomLeftRadius: 999,
  },
  supplementProgress: {
    backgroundColor: '#5d8fcb',
    borderTopRightRadius: 999,
    borderBottomRightRadius: 999,
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
  },
  duplicateBanner: {
    minHeight: 48,
    marginTop: 8,
    paddingHorizontal: 10,
    paddingVertical: 9,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  duplicateCopy: {
    minWidth: 0,
    flex: 1,
    gap: 2,
  },
  duplicateTitle: {
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '800',
  },
  duplicateText: {
    fontSize: 11,
    lineHeight: 16,
  },
  componentsPanel: {
    marginTop: 8,
    padding: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
  },
  componentsHead: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 8,
  },
  componentsTitle: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '800',
  },
  componentsNote: {
    flex: 1,
    textAlign: 'right',
    fontSize: 9,
    lineHeight: 13,
  },
  componentsList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 5,
    marginTop: 8,
  },
  componentItem: {
    minWidth: 0,
    width: '31.8%',
    paddingHorizontal: 7,
    paddingVertical: 6,
    borderRadius: 8,
  },
  componentName: {
    fontSize: 10,
    lineHeight: 14,
    fontWeight: '700',
  },
  componentAmount: {
    marginTop: 2,
    fontSize: 9,
    lineHeight: 13,
  },
  modalLayer: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  modalBackdrop: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  sourceSheet: {
    width: '100%',
    paddingTop: 8,
    paddingHorizontal: 20,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -8 },
    shadowOpacity: 0.15,
    shadowRadius: 20,
    elevation: 18,
  },
  sheetHandle: {
    width: 36,
    height: 4,
    marginBottom: 14,
    alignSelf: 'center',
    borderRadius: 999,
  },
  sheetHead: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  sheetHeading: {
    minWidth: 0,
    flex: 1,
  },
  sheetKicker: {
    fontSize: 11,
    lineHeight: 15,
  },
  sheetTitle: {
    marginTop: 2,
    fontSize: 21,
    lineHeight: 28,
    fontWeight: '800',
  },
  sheetClose: {
    width: 48,
    height: 48,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
  },
  sheetTotal: {
    marginTop: 14,
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
  },
  sheetTotalLabel: {
    fontSize: 13,
    lineHeight: 18,
  },
  sheetTotalValue: {
    fontSize: 21,
    lineHeight: 28,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  sheetBar: {
    width: '100%',
    height: 7,
    marginTop: 8,
    flexDirection: 'row',
    overflow: 'hidden',
    borderRadius: 999,
  },
  sheetRow: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  sheetRowLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  sheetRowText: {
    fontSize: 14,
    lineHeight: 20,
  },
  sheetRowValue: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  sheetNote: {
    marginTop: 12,
    marginBottom: 4,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    fontSize: 12,
    lineHeight: 18,
  },
})
