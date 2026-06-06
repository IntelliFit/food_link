import { View, Text, ScrollView, Input } from '@tarojs/components'
import { useState, useEffect, useCallback, useRef, type CSSProperties } from 'react'
import Taro, { useDidShow } from '@tarojs/taro'
import { readStatsPageCache, writeStatsPageCache } from '../../utils/stats-page-cache'
import { Switch } from '@taroify/core'
import {
  getStatsSummary,
  generateStatsInsight,
  getBodyMetricsSummary,
  addHealthFocus,
  removeHealthFocus,
  generateCustomFocusCard,
  showUnifiedApiError,
  type StatsSummary,
  type BodyMetricWeightEntry,
  type BodyMetricWaterDay,
  type HealthIndex,
  type RiskCard,
  type RiskOption,
  type RiskTone,
} from '../../utils/api'
import { IconBreakfast, IconLunch, IconDinner, IconSnack, IconExpand, IconCollapse } from '../../components/iconfont'
import '../../assets/iconfont/iconfont.css'
import './index.scss'
import { withAuth, redirectToLogin } from '../../utils/withAuth'
import { useAppColorScheme } from '../../components/AppColorSchemeContext'

const MEAL_NAMES: Record<string, string> = {
  breakfast: '早餐',
  morning_snack: '早加餐',
  lunch: '午餐',
  afternoon_snack: '午加餐',
  dinner: '晚餐',
  evening_snack: '晚加餐',
  snack: '午加餐'
}

const MEAL_ICONS = {
  breakfast: IconBreakfast,
  morning_snack: IconSnack,
  lunch: IconLunch,
  afternoon_snack: IconSnack,
  dinner: IconDinner,
  evening_snack: IconSnack,
  snack: IconSnack
} as const

/** 餐次结构配色：仅分早餐 / 午餐 / 晚餐三色；各时段加餐与对应主餐同色（与首页主色、蓝、橙一致） */
const MEAL_STRUCTURE_COLORS = {
  breakfast: '#5cb896',
  lunch: '#5c9ed4',
  dinner: '#f0985c',
} as const

function mealStructureAccent(mealKey: string): string {
  if (mealKey === 'breakfast' || mealKey === 'morning_snack') {
    return MEAL_STRUCTURE_COLORS.breakfast
  }
  if (mealKey === 'lunch' || mealKey === 'afternoon_snack' || mealKey === 'snack') {
    return MEAL_STRUCTURE_COLORS.lunch
  }
  if (mealKey === 'dinner' || mealKey === 'evening_snack') {
    return MEAL_STRUCTURE_COLORS.dinner
  }
  return MEAL_STRUCTURE_COLORS.breakfast
}

function formatLocalDate(date: Date = new Date()): string {
  const year = date.getFullYear()
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  return `${year}-${month}-${day}`
}

function normalizeInsightText(raw: string): string {
  if (!raw) return ''

  return raw
    .replace(/\r\n/g, '\n')
    .replace(/```+/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

type InsightInlinePart = {
  text: string
  underline?: boolean
  strong?: boolean
}

type InsightMarkdownBlock = {
  type: 'heading' | 'paragraph' | 'list'
  text?: string
  items?: string[]
}

function parseInsightInline(text: string): InsightInlinePart[] {
  const parts: InsightInlinePart[] = []
  const pattern = /<u>(.*?)<\/u>|__(.*?)__|\*\*(.*?)\*\*/g
  let cursor = 0
  let match: RegExpExecArray | null
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > cursor) {
      parts.push({ text: text.slice(cursor, match.index) })
    }
    if (match[1] != null) {
      parts.push({ text: match[1], underline: true })
    } else if (match[2] != null) {
      parts.push({ text: match[2], underline: true })
    } else if (match[3] != null) {
      parts.push({ text: match[3], strong: true })
    }
    cursor = pattern.lastIndex
  }
  if (cursor < text.length) {
    parts.push({ text: text.slice(cursor) })
  }
  return parts.filter(part => part.text)
}

function stripInsightMarkdownPrefix(line: string): string {
  return line
    .replace(/^\s{0,3}#{1,6}\s*/, '')
    .replace(/^\s*[-*+]\s+/, '')
    .replace(/^\s*\d+[.)]\s+/, '')
    .trim()
}

function parseInsightMarkdown(text: string): InsightMarkdownBlock[] {
  const blocks: InsightMarkdownBlock[] = []
  const lines = normalizeInsightText(text).split('\n')
  let paragraph: string[] = []
  let listItems: string[] = []

  const flushParagraph = () => {
    if (paragraph.length) {
      blocks.push({ type: 'paragraph', text: paragraph.join('\n').trim() })
      paragraph = []
    }
  }
  const flushList = () => {
    if (listItems.length) {
      blocks.push({ type: 'list', items: listItems })
      listItems = []
    }
  }

  lines.forEach(rawLine => {
    const line = rawLine.trim()
    if (!line) {
      flushParagraph()
      flushList()
      return
    }
    if (/^\s{0,3}#{1,6}\s+/.test(rawLine)) {
      flushParagraph()
      flushList()
      blocks.push({ type: 'heading', text: stripInsightMarkdownPrefix(rawLine) })
      return
    }
    if (/^\s*([-*+]|\d+[.)])\s+/.test(rawLine)) {
      flushParagraph()
      listItems.push(stripInsightMarkdownPrefix(rawLine))
      return
    }
    flushList()
    paragraph.push(line)
  })
  flushParagraph()
  flushList()
  return blocks
}

function renderInsightInline(text: string) {
  return parseInsightInline(text).map((part, index) => (
    <Text
      key={`${part.text}-${index}`}
      className={`${part.underline ? 'analysis-md-underline' : ''}${part.strong ? ' analysis-md-strong' : ''}`}
    >
      {part.text}
    </Text>
  ))
}

function renderInsightMarkdown(text: string) {
  return parseInsightMarkdown(text).map((block, index) => {
    if (block.type === 'heading') {
      return (
        <Text key={`heading-${index}`} className='analysis-md-heading'>
          {renderInsightInline(block.text || '')}
        </Text>
      )
    }
    if (block.type === 'list') {
      return (
        <View key={`list-${index}`} className='analysis-md-list'>
          {(block.items || []).map((item, itemIndex) => (
            <View key={`${item}-${itemIndex}`} className='analysis-md-list-item'>
              <Text className='analysis-md-list-bullet'>•</Text>
              <Text className='analysis-md-list-text'>{renderInsightInline(item)}</Text>
            </View>
          ))}
        </View>
      )
    }
    return (
      <Text key={`paragraph-${index}`} className='analysis-md-paragraph'>
        {renderInsightInline(block.text || '')}
      </Text>
    )
  })
}

type HeatmapCell = {
  date: string
  calories: number
  delta: number
  level: 1 | 2
  state: 'none' | 'surplus' | 'deficit'
}

type AnalysisPanelKey = 'health' | 'nutrition' | 'structure'

const ANALYSIS_PANEL_TABS: Array<{ key: AnalysisPanelKey; label: string }> = [
  { key: 'health', label: '健康指数' },
  { key: 'nutrition', label: 'AI分析' },
  { key: 'structure', label: '热量分布' },
]

const DEFAULT_RISK_KEYS = ['hypertension', 'diabetes', 'cardio', 'weight']
const RISK_PREF_STORAGE_KEY = 'stats_risk_focus_keys'

function isCustomRiskKey(key: string): boolean {
  return String(key || '').startsWith('custom:')
}

function toSafeNumber(value: unknown, fallback = 0): number {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : fallback
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, value))
}

function scoreToTone(score: number): RiskTone {
  if (score >= 78) return 'positive'
  if (score >= 60) return 'neutral'
  if (score >= 42) return 'warning'
  return 'danger'
}

function scoreToLabel(score: number): string {
  if (score >= 78) return '偏保护'
  if (score >= 60) return '基本中性'
  if (score >= 42) return '需要关注'
  return '重点关注'
}

function scoreToFocusOverview(score: number, hasCustomFocus: boolean): string {
  if (score >= 78) {
    return hasCustomFocus
      ? '你当前关注的指标整体更偏向保护，自定义方向也会跟随卡片一起纳入参考。'
      : '你当前关注的核心指标整体更偏向保护。'
  }
  if (score >= 60) {
    return hasCustomFocus
      ? '你当前关注的指标总体还算稳，但自定义方向和核心指标里已经有一些可优化项。'
      : '你当前关注的核心指标总体还算稳，但已经出现一些可优化项。'
  }
  if (score >= 42) {
    return hasCustomFocus
      ? '你当前关注的指标已经出现明显拖累，建议优先处理分数最低的关注项。'
      : '你当前关注的核心指标已经出现明显拖累，建议优先处理分数最低的一项。'
  }
  return hasCustomFocus
    ? '你当前关注的指标处在较高压力区，先从最可执行的一项小步调整。'
    : '你当前关注的核心指标处在较高压力区，先从最可执行的一项小步调整。'
}

function averageRiskCardScore(cards: RiskCard[], projectDelta = false): number | null {
  const validScores = cards
    .map(card => {
      const baseScore = toSafeNumber(card.score, NaN)
      if (!Number.isFinite(baseScore)) return null
      const delta = projectDelta ? toSafeNumber(card.delta, 0) : 0
      return Math.round(Math.max(0, Math.min(100, baseScore + delta)))
    })
    .filter((score): score is number => typeof score === 'number')

  if (validScores.length === 0) return null
  return Math.round(validScores.reduce((sum, score) => sum + score, 0) / validScores.length)
}

function riskCardIcon(key: string): string {
  switch (key) {
    case 'hypertension': return 'tianpingzuo'
    case 'diabetes': return 'tanshui-dabiao'
    case 'cardio': return 'dumbbell'
    case 'weight': return 'weight-scale'
    case 'colorectal': return 'a-144-lvye'
    case 'longevity': return 'shangzhang'
    default: return 'target'
  }
}

function riskCardIconColor(key: string, isDark: boolean): string {
  if (isDark) {
    switch (key) {
      case 'hypertension': return '#f87171'
      case 'diabetes': return '#60a5fa'
      case 'cardio': return '#fbbf24'
      case 'weight': return '#4ade80'
      case 'colorectal': return '#a3e635'
      case 'longevity': return '#c084fc'
      default: return '#34d399'
    }
  }
  switch (key) {
    case 'hypertension': return '#c45c5c'
    case 'diabetes': return '#5a9bc7'
    case 'cardio': return '#c9965c'
    case 'weight': return '#5aa86e'
    case 'colorectal': return '#8ab060'
    case 'longevity': return '#a070b0'
    default: return '#5aa896'
  }
}

function riskCardIconBgColor(key: string, isDark: boolean): string {
  if (isDark) {
    switch (key) {
      case 'hypertension': return 'rgba(248, 113, 113, 0.16)'
      case 'diabetes': return 'rgba(96, 165, 250, 0.16)'
      case 'cardio': return 'rgba(251, 191, 36, 0.16)'
      case 'weight': return 'rgba(74, 222, 128, 0.16)'
      case 'colorectal': return 'rgba(163, 230, 53, 0.16)'
      case 'longevity': return 'rgba(192, 132, 252, 0.16)'
      default: return 'rgba(52, 211, 153, 0.16)'
    }
  }
  switch (key) {
    case 'hypertension': return '#fdf2f2'
    case 'diabetes': return '#eff6fc'
    case 'cardio': return '#fef7ed'
    case 'weight': return '#f0fdf4'
    case 'colorectal': return '#f4fbea'
    case 'longevity': return '#faf5ff'
    default: return '#f0fdf9'
  }
}

function customRiskCardToOption(card: RiskCard): RiskOption {
  return {
    key: card.key,
    title: card.focus_label || card.title,
    short: card.focus_label || card.title,
    is_custom: true,
  }
}

function customFocusToOption(focus: { id: string; label: string }): RiskOption {
  return {
    key: `custom:${focus.id}`,
    title: focus.label,
    short: focus.label,
    is_custom: true,
  }
}

function pendingCustomRiskCardFromOption(option: RiskOption): RiskCard {
  return {
    key: option.key,
    title: option.title,
    score: 60,
    tone: 'neutral',
    brief: '点开生成 AI 卡片',
    summary: `已选择「${option.title}」作为自定义关注方向，当前周期还没有可展示的 AI 卡片。`,
    basis: '该关注方向已保存，但当前统计周期尚未生成或刷新对应卡片。',
    action: '点击下方手动更新 AI 卡片，基于近期饮食趋势生成参考。',
    delta: 5,
    is_custom: true,
    needs_refresh: true,
    focus_label: option.title,
  }
}

function riskCardBgGradient(key: string): string {
  switch (key) {
    case 'hypertension': return 'linear-gradient(145deg, #fee2e2 0%, #ffffff 22%, #ffffff 100%)'
    case 'diabetes': return 'linear-gradient(145deg, #dbeafe 0%, #ffffff 22%, #ffffff 100%)'
    case 'cardio': return 'linear-gradient(145deg, #ffedd5 0%, #ffffff 22%, #ffffff 100%)'
    case 'weight': return 'linear-gradient(145deg, #dcfce7 0%, #ffffff 22%, #ffffff 100%)'
    case 'colorectal': return 'linear-gradient(145deg, #ecfccb 0%, #ffffff 22%, #ffffff 100%)'
    case 'longevity': return 'linear-gradient(145deg, #f3e8ff 0%, #ffffff 22%, #ffffff 100%)'
    default: return 'linear-gradient(145deg, #dcfce7 0%, #ffffff 22%, #ffffff 100%)'
  }
}

const WATER_GOAL_DEFAULT = 2000

type StoredBodyMetrics = {
  weightEntries: Array<{ date: string; value: number; recorded_at?: string }>
  waterByDate: Record<string, { date: string; total: number; logs: number[] }>
  waterGoalMl: number
}

function normalizeStoredBodyMetrics(raw: unknown): StoredBodyMetrics {
  const fallback: StoredBodyMetrics = {
    weightEntries: [],
    waterByDate: {},
    waterGoalMl: WATER_GOAL_DEFAULT,
  }

  if (!raw || typeof raw !== 'object') {
    return fallback
  }

  const source = raw as Record<string, unknown>

  const weightEntries = Array.isArray(source.weightEntries)
    ? source.weightEntries
      .map(item => {
        if (!item || typeof item !== 'object') return null
        const obj = item as Record<string, unknown>
        const date = typeof obj.date === 'string' ? obj.date : ''
        const value = toSafeNumber(obj.value, NaN)
        const recordedAt = typeof obj.recorded_at === 'string' ? obj.recorded_at : undefined
        if (!date || !Number.isFinite(value)) return null
        return { date, value, recorded_at: recordedAt }
      })
      .filter((item): item is NonNullable<typeof item> => Boolean(item))
    : []

  const waterByDate: StoredBodyMetrics['waterByDate'] = {}
  if (source.waterByDate && typeof source.waterByDate === 'object' && !Array.isArray(source.waterByDate)) {
    Object.entries(source.waterByDate as Record<string, unknown>).forEach(([key, value]) => {
      if (!value || typeof value !== 'object') return
      const obj = value as Record<string, unknown>
      const date = typeof obj.date === 'string' && obj.date ? obj.date : key
      const total = toSafeNumber(obj.total)
      const logs = Array.isArray(obj.logs)
        ? obj.logs
          .map(log => toSafeNumber(log, NaN))
          .filter(log => Number.isFinite(log))
        : []
      if (!date) return
      waterByDate[date] = { date, total, logs }
    })
  }

  const waterGoalMl = toSafeNumber(source.waterGoalMl, WATER_GOAL_DEFAULT)

  return {
    weightEntries,
    waterByDate,
    waterGoalMl,
  }
}

function getStoredBodyMetrics(): StoredBodyMetrics {
  try {
    return normalizeStoredBodyMetrics(Taro.getStorageSync('body_metrics_storage'))
  } catch {
    // ignore
  }
  return normalizeStoredBodyMetrics(null)
}

function hasAuthToken(): boolean {
  try {
    return Boolean(Taro.getStorageSync('access_token'))
  } catch {
    return false
  }
}

function StatsPage() {
  const { scheme } = useAppColorScheme()
  const [range, setRange] = useState<'week' | 'month'>('week')
  const [analysisPanel, setAnalysisPanel] = useState<AnalysisPanelKey>('health')
  const rangeRef = useRef(range)
  rangeRef.current = range
  const [riskDetailModal, setRiskDetailModal] = useState<{ visible: boolean; card: RiskCard | null }>({ visible: false, card: null })
  const [riskPickerVisible, setRiskPickerVisible] = useState(false)

  // 自定义 tabBar 显隐同步：弹窗打开时隐藏底栏
  useEffect(() => {
    try {
      if (riskDetailModal.visible || riskPickerVisible) {
        Taro.setStorageSync('stats_risk_detail_visible', '1')
      } else {
        Taro.removeStorageSync('stats_risk_detail_visible')
      }
    } catch {
      // ignore
    }
    return () => {
      try {
        Taro.removeStorageSync('stats_risk_detail_visible')
      } catch {
        // ignore
      }
    }
  }, [riskDetailModal.visible, riskPickerVisible])
  const [selectedRiskKeys, setSelectedRiskKeys] = useState<string[]>(() => {
    try {
      const stored = Taro.getStorageSync(RISK_PREF_STORAGE_KEY)
      if (Array.isArray(stored)) {
        const cleaned = stored.map(item => String(item || '').trim()).filter(Boolean)
        return cleaned.length > 0 ? cleaned : DEFAULT_RISK_KEYS
      }
    } catch {
      // ignore
    }
    return DEFAULT_RISK_KEYS
  })
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    heatmap: true,
    calories: true,
    macro: true,
    meals: true,
    streak: false,
    body: true,
    ai: false,
  })

  /** 静默联网刷新中（已有缓存展示时）：左上角微型 spinner，不占文档流 */
  const [dataSyncing, setDataSyncing] = useState(false)
  const [loading, setLoading] = useState(() => {
    if (!hasAuthToken()) return false
    return readStatsPageCache('week') === null
  })
  const [data, setData] = useState<StatsSummary | null>(() => {
    if (!hasAuthToken()) return null
    return readStatsPageCache('week')
  })
  const [error, setError] = useState<string | null>(null)
  /** 未登录：可进入分析 Tab 浏览引导，不拉取需登录接口 */
  const [guestBrowse, setGuestBrowse] = useState(() => !hasAuthToken())
  const [aiDisplayText, setAiDisplayText] = useState('')
  const typingTimerRef = useRef<any>(null)
  const [isTyping, setIsTyping] = useState(false)
  const [insightActionLoading, setInsightActionLoading] = useState(false)
  const [insightError, setInsightError] = useState<string | null>(null)
  const [showCalories, setShowCalories] = useState(false)
  const [customFocusInput, setCustomFocusInput] = useState('')
  const [customFocusAdding, setCustomFocusAdding] = useState(false)
  const [customFocusRefreshingKey, setCustomFocusRefreshingKey] = useState<string | null>(null)

  const fetchIdRef = useRef(0)
  const statsFirstShowRef = useRef(true)

  /**
   * 拉取分析页聚合数据；silent=true 时不顶掉界面（已有缓存时后台刷新并写盘）
   */
  const refreshFromNetwork = useCallback(async (r: 'week' | 'month', silent: boolean) => {
    const token = Taro.getStorageSync('access_token')
    if (!token) {
      setGuestBrowse(true)
      setData(null)
      setLoading(false)
      return
    }

    setGuestBrowse(false)
    const reqId = ++fetchIdRef.current

    if (!silent) {
      setLoading(true)
      setError(null)
    } else {
      setDataSyncing(true)
    }

    try {
      const [statsRes, bodyMetricsRes] = await Promise.all([
        getStatsSummary(r),
        getBodyMetricsSummary(r).catch(() => null),
      ])

      if (reqId !== fetchIdRef.current) return

      const cloudWeightEntries = Array.isArray(bodyMetricsRes?.weight_entries)
        ? bodyMetricsRes.weight_entries.filter(
          (entry): entry is BodyMetricWeightEntry => Boolean(entry && typeof entry.date === 'string'),
        )
        : []
      const cloudWaterDaily = Array.isArray(bodyMetricsRes?.water_daily)
        ? bodyMetricsRes.water_daily
          .filter((entry): entry is BodyMetricWaterDay => Boolean(entry && typeof entry.date === 'string'))
          .map(entry => ({
            date: entry.date,
            total: toSafeNumber(entry.total),
            logs: Array.isArray(entry.logs)
              ? entry.logs.map(log => toSafeNumber(log, NaN)).filter(log => Number.isFinite(log))
              : [],
          }))
        : []

      const hasCloudWeight = cloudWeightEntries.length > 0
      const hasCloudWater = cloudWaterDaily.some(d => toSafeNumber(d.total) > 0)

      const storedMetrics =
        !hasCloudWeight || !hasCloudWater ? getStoredBodyMetrics() : null

      const storedWeightEntries = (storedMetrics?.weightEntries || []).map(e => ({
        date: e.date,
        value: e.value,
        recorded_at: e.recorded_at,
      }))
      const storedWaterDaily = Object.values(storedMetrics?.waterByDate || {}).map(w => ({
        date: w.date,
        total: toSafeNumber(w.total),
        logs: Array.isArray(w.logs)
          ? w.logs.map(log => toSafeNumber(log, NaN)).filter(log => Number.isFinite(log))
          : [],
      }))

      const weightEntries = hasCloudWeight ? cloudWeightEntries : storedWeightEntries
      const waterDaily = hasCloudWater ? cloudWaterDaily : storedWaterDaily

      const totalWaterMl = waterDaily.reduce((sum: number, d) => sum + toSafeNumber(d.total), 0)
      const recordedDays = waterDaily.filter(d => toSafeNumber(d.total) > 0).length
      const avgDailyWaterMl = recordedDays > 0 ? Math.round(totalWaterMl / recordedDays) : 0

      const sortedWeight = [...weightEntries].sort((a, b) => `${b.date || ''}`.localeCompare(`${a.date || ''}`))
      const latestWeight = sortedWeight[0] || null
      const previousWeight = sortedWeight[1] || null
      const weightChange =
        latestWeight && previousWeight
          ? Math.round((latestWeight.value - previousWeight.value) * 10) / 10
          : null

      if (weightEntries.length > 0 || waterDaily.length > 0) {
        statsRes.body_metrics = {
          range: r,
          start_date: bodyMetricsRes?.start_date ?? '',
          end_date: bodyMetricsRes?.end_date ?? '',
          weight_trend_daily: bodyMetricsRes?.weight_trend_daily,
          weight_entries: weightEntries,
          latest_weight: latestWeight,
          previous_weight: previousWeight,
          weight_change: weightChange,
          water_daily: waterDaily,
          today_water: bodyMetricsRes?.today_water ?? {
            date: formatLocalDate(),
            total: 0,
            logs: [],
          },
          water_goal_ml: toSafeNumber(
            bodyMetricsRes?.water_goal_ml,
            storedMetrics?.waterGoalMl || WATER_GOAL_DEFAULT,
          ),
          total_water_ml: hasCloudWater ? (bodyMetricsRes?.total_water_ml || 0) : totalWaterMl,
          avg_daily_water_ml: hasCloudWater ? (bodyMetricsRes?.avg_daily_water_ml || 0) : avgDailyWaterMl,
          water_recorded_days: hasCloudWater ? (bodyMetricsRes?.water_recorded_days || 0) : recordedDays,
        }
      }

      setData(statsRes)
      writeStatsPageCache(r, statsRes)
      setError(null)
    } catch (e: unknown) {
      if (reqId !== fetchIdRef.current) return
      console.error('[stats] refreshFromNetwork failed:', e)
      const cached = readStatsPageCache(r)
      if (cached) {
        setData(cached)
        setError(null)
      } else if (!silent) {
        setError('获取统计失败，请稍后重试')
        await showUnifiedApiError(e, '获取统计失败')
      }
    } finally {
      if (reqId !== fetchIdRef.current) return
      if (!silent) {
        setLoading(false)
      } else {
        setDataSyncing(false)
      }
    }
  }, [])

  useEffect(() => {
    if (!hasAuthToken()) {
      setGuestBrowse(true)
      setLoading(false)
      return
    }
    setGuestBrowse(false)
    const cached = readStatsPageCache(range)
    if (cached) {
      setData(cached)
      setError(null)
      setLoading(false)
    } else {
      setLoading(true)
      setData(null)
    }
    void refreshFromNetwork(range, Boolean(cached))
  }, [range, refreshFromNetwork])

  useDidShow(() => {
    if (statsFirstShowRef.current) {
      statsFirstShowRef.current = false
      return
    }
    if (!hasAuthToken()) return
    void refreshFromNetwork(rangeRef.current, true)
  })

  const handleGenerateInsight = useCallback(async () => {
    if (!data || insightActionLoading) return
    if (Math.max(0, toSafeNumber(data.recorded_days, 0)) <= 0) {
      setInsightError('还没有饮食记录，先记录至少一餐后再生成 AI 风险解读。')
      return
    }

    setInsightActionLoading(true)
    setInsightError(null)
    try {
      const res = await generateStatsInsight(range)
      const full = normalizeInsightText((res.analysis_summary || '').trim())
      if (!full) throw new Error('AI 洞察生成失败')

      setData(prev => {
        if (!prev) return prev
        const next: StatsSummary = {
          ...prev,
          analysis_summary: full,
          analysis_summary_generated_date: res.analysis_summary_generated_date || formatLocalDate(),
          analysis_summary_needs_refresh: Boolean(res.analysis_summary_needs_refresh),
          analysis_summary_daily_limit: res.analysis_summary_daily_limit ?? prev.analysis_summary_daily_limit,
          analysis_summary_used_today: res.analysis_summary_used_today ?? ((prev.analysis_summary_used_today || 0) + 1),
        }
        writeStatsPageCache(range, next)
        return next
      })

      Taro.showToast({
        title: '洞察已更新',
        icon: 'success'
      })
    } catch (e: unknown) {
      const message = (e as Error).message || 'AI 洞察生成失败，请稍后重试'
      setInsightError(message)
      await showUnifiedApiError(e, 'AI 洞察生成失败')
    } finally {
      setInsightActionLoading(false)
    }
  }, [data, insightActionLoading, range])

  const mergeCustomFocusCard = useCallback((card: RiskCard) => {
    setData(prev => {
      if (!prev?.health_index) return prev
      const existing = prev.health_index.custom_risk_cards ?? []
      const nextCustom = [
        card,
        ...existing.filter(item => item.key !== card.key),
      ]
      const existingOptions = prev.health_index.all_risk_options ?? []
      const nextCustomOption = customRiskCardToOption(card)
      const nextOptions = existingOptions.some(item => item.key === card.key)
        ? existingOptions.map(item => item.key === card.key ? { ...item, ...nextCustomOption } : item)
        : [...existingOptions, nextCustomOption]
      const next: StatsSummary = {
        ...prev,
        health_index: {
          ...prev.health_index,
          custom_risk_cards: nextCustom,
          all_risk_options: nextOptions,
        },
      }
      writeStatsPageCache(range, next)
      return next
    })
  }, [range])

  const mergeCustomFocusOptions = useCallback((focuses: Array<{ id: string; label: string }>) => {
    setData(prev => {
      if (!prev?.health_index) return prev
      const existingOptions = prev.health_index.all_risk_options ?? []
      const nextOptions = [...existingOptions]
      focuses.forEach(focus => {
        if (!focus.id || !focus.label) return
        const option = customFocusToOption(focus)
        const index = nextOptions.findIndex(item => item.key === option.key)
        if (index >= 0) {
          nextOptions[index] = { ...nextOptions[index], ...option }
        } else {
          nextOptions.push(option)
        }
      })
      const next: StatsSummary = {
        ...prev,
        health_index: {
          ...prev.health_index,
          all_risk_options: nextOptions,
        },
      }
      writeStatsPageCache(range, next)
      return next
    })
  }, [range])

  const handleAddCustomFocus = useCallback(async () => {
    const label = customFocusInput.trim()
    if (!label || customFocusAdding) return
    if (!(data?.health_index?.has_enough_data ?? false)) {
      Taro.showToast({ title: '先连续记录两天', icon: 'none' })
      return
    }
    setCustomFocusAdding(true)
    try {
      const addRes = await addHealthFocus(label)
      mergeCustomFocusOptions(addRes.focuses)
      const focusId = addRes.focus_id || addRes.focuses.find(item => item.label === label)?.id
      if (!focusId) throw new Error('添加关注失败')
      const genRes = await generateCustomFocusCard(range, focusId)
      mergeCustomFocusCard(genRes.card)
      const customKey = `custom:${focusId}`
      setSelectedRiskKeys(prev => {
        const next = prev.includes(customKey) ? prev : [...prev, customKey]
        try {
          Taro.setStorageSync(RISK_PREF_STORAGE_KEY, next)
        } catch {
          // ignore
        }
        return next
      })
      setCustomFocusInput('')
      Taro.showToast({
        title: addRes.already_exists ? 'AI 卡片已生成' : 'AI 关注已添加',
        icon: 'success',
      })
    } catch (e: unknown) {
      await showUnifiedApiError(e, '添加 AI 关注失败')
    } finally {
      setCustomFocusAdding(false)
    }
  }, [customFocusAdding, customFocusInput, data, mergeCustomFocusCard, mergeCustomFocusOptions, range])

  const handleRemoveCustomFocus = useCallback(async (focusId: string) => {
    if (!focusId) return
    try {
      await removeHealthFocus(focusId)
      const customKey = `custom:${focusId}`
      setSelectedRiskKeys(prev => {
        const next = prev.filter(key => key !== customKey)
        const normalized = next.length > 0 ? next : DEFAULT_RISK_KEYS
        try {
          Taro.setStorageSync(RISK_PREF_STORAGE_KEY, normalized)
        } catch {
          // ignore
        }
        return normalized
      })
      setData(prev => {
        if (!prev?.health_index) return prev
        const next: StatsSummary = {
          ...prev,
          health_index: {
            ...prev.health_index,
            custom_risk_cards: (prev.health_index.custom_risk_cards ?? []).filter(
              card => card.key !== customKey,
            ),
            all_risk_options: prev.health_index.all_risk_options.filter(
              item => item.key !== customKey,
            ),
          },
        }
        writeStatsPageCache(range, next)
        return next
      })
      Taro.showToast({ title: '已移除', icon: 'success' })
    } catch (e: unknown) {
      await showUnifiedApiError(e, '移除关注失败')
    }
  }, [range])

  const handleRefreshCustomFocus = useCallback(async (card: RiskCard) => {
    if (!card.is_custom || customFocusRefreshingKey) return
    const focusId = card.key.replace(/^custom:/, '')
    if (!focusId) return
    setCustomFocusRefreshingKey(card.key)
    try {
      const genRes = await generateCustomFocusCard(range, focusId)
      mergeCustomFocusCard(genRes.card)
      setRiskDetailModal({ visible: true, card: genRes.card })
      Taro.showToast({ title: '卡片已更新', icon: 'success' })
    } catch (e: unknown) {
      await showUnifiedApiError(e, '刷新 AI 卡片失败')
    } finally {
      setCustomFocusRefreshingKey(null)
    }
  }, [customFocusRefreshingKey, mergeCustomFocusCard, range])

  // AI 洞察打字机效果：当 analysis_summary 从空变为非空时，按字符逐步显示
  useEffect(() => {
    const full = data?.analysis_summary || ''

    // 如果还没有洞察，清空显示并停止打字
    if (!full) {
      setAiDisplayText('')
      setIsTyping(false)
      if (typingTimerRef.current) {
        clearInterval(typingTimerRef.current)
        typingTimerRef.current = null
      }
      return
    }

    // 已经完全展示，无需重新打字
    if (aiDisplayText === full && !isTyping) {
      return
    }

    if (typingTimerRef.current) {
      clearInterval(typingTimerRef.current)
      typingTimerRef.current = null
    }

    let index = 0
    const step = 2 // 每次输出的字符数
    setAiDisplayText('')
    setIsTyping(true)

    const timer = setInterval(() => {
      index += step
      if (index >= full.length) {
        setAiDisplayText(full)
        setIsTyping(false)
        if (typingTimerRef.current) {
          clearInterval(typingTimerRef.current)
          typingTimerRef.current = null
        }
      } else {
        setAiDisplayText(full.slice(0, index))
      }
    }, 40)

    typingTimerRef.current = timer

    return () => {
      if (typingTimerRef.current) {
        clearInterval(typingTimerRef.current)
        typingTimerRef.current = null
      }
    }
    // 只在后端完整洞察文本变化时重新触发打字
  }, [data?.analysis_summary])

  if (guestBrowse) {
    return (
      <View className={`stats-page stats-page--guest ${scheme === 'dark' ? 'stats-page--dark' : ''}`}>
        <View className='stats-guest-card'>
          <Text className='stats-guest-title'>登录后查看饮食分析</Text>
          <Text className='stats-guest-desc'>可先浏览首页热量与营养概览，需要账号同步时再登录</Text>
          <View className='stats-guest-btn' onClick={() => redirectToLogin()}>
            <Text className='stats-guest-btn-text'>去登录</Text>
          </View>
        </View>
      </View>
    )
  }

  if (loading && !data) {
    return (
      <View className={`stats-page ${scheme === 'dark' ? 'stats-page--dark' : ''}`}>
        <View className='loading-wrap'>
          <View className='loading-spinner-md' />
        </View>
      </View>
    )
  }

  if (error && !data) {
    return (
      <View className={`stats-page ${scheme === 'dark' ? 'stats-page--dark' : ''}`}>
        <View className='error-wrap'>
          <Text className='iconfont icon-jiesuo error-icon' />
          <Text className='error-text'>{error}</Text>
          <View className='btn-primary' onClick={() => void refreshFromNetwork(range, false)}>
            <Text className='btn-text'>重试</Text>
          </View>
        </View>
      </View>
    )
  }

  const d = data!
  const totalCalories = toSafeNumber(d.total_calories)
  const tdee = toSafeNumber(d.tdee)
  const avgCaloriesPerDay = toSafeNumber(d.avg_calories_per_day)
  const totalProtein = toSafeNumber(d.total_protein)
  const totalCarbs = toSafeNumber(d.total_carbs)
  const totalFat = toSafeNumber(d.total_fat)
  const hasInsight = Boolean(d.analysis_summary?.trim())
  const insightGeneratedDate = d.analysis_summary_generated_date || ''
  const insightNeedsRefresh = Boolean(d.analysis_summary_needs_refresh)
  const insightDailyLimit = Math.max(1, toSafeNumber(d.analysis_summary_daily_limit, 3))
  const insightUsedToday = Math.max(0, toSafeNumber(d.analysis_summary_used_today, 0))
  const insightRemainingToday = Math.max(0, insightDailyLimit - insightUsedToday)
  const recordedDays = Math.max(0, toSafeNumber(d.recorded_days, 0))
  const hasAnyDietData = recordedDays > 0
  const canUseStatsInsight = hasAnyDietData
  const canGenerateInsight = canUseStatsInsight && insightRemainingToday > 0
  const normalizedInsightText = normalizeInsightText(d.analysis_summary || '')
  const displayInsightText = canUseStatsInsight
    ? normalizeInsightText(aiDisplayText || (hasInsight && !isTyping ? normalizedInsightText : ''))
    : ''
  const bodyMetrics = d.body_metrics
  const macroPercent = {
    protein: toSafeNumber(d.macro_percent?.protein),
    carbs: toSafeNumber(d.macro_percent?.carbs),
    fat: toSafeNumber(d.macro_percent?.fat)
  }
  const byMeal = {
    breakfast: toSafeNumber(d.by_meal?.breakfast),
    morning_snack: toSafeNumber(d.by_meal?.morning_snack),
    lunch: toSafeNumber(d.by_meal?.lunch),
    afternoon_snack: toSafeNumber(d.by_meal?.afternoon_snack ?? d.by_meal?.snack),
    dinner: toSafeNumber(d.by_meal?.dinner),
    evening_snack: toSafeNumber(d.by_meal?.evening_snack)
  } as const
  const chartDays = range === 'week' ? d.daily_calories.slice(-7) : d.daily_calories.slice(-14)

  // Calculate max calories for the chart scaling
  const maxDailyCalories = d.daily_calories.length > 0
    ? Math.max(...d.daily_calories.map(i => i.calories))
    : 2000
  const weightTrend = bodyMetrics?.weight_entries || []
  const latestWeight = bodyMetrics?.latest_weight || null
  const previousWeight = bodyMetrics?.previous_weight || null
  const weightChange = bodyMetrics?.weight_change
  const waterDaily = bodyMetrics?.water_daily || []
  const waterGoalMl = toSafeNumber(bodyMetrics?.water_goal_ml, 2000)
  const avgDailyWaterMl = toSafeNumber(bodyMetrics?.avg_daily_water_ml)
  const totalWaterMl = toSafeNumber(bodyMetrics?.total_water_ml)
  const waterRecordedDays = toSafeNumber(bodyMetrics?.water_recorded_days)
  const waterTrend = range === 'week' ? waterDaily.slice(-7) : waterDaily.slice(-14)
  const maxWaterValue = waterTrend.length > 0
    ? Math.max(waterGoalMl, ...waterTrend.map(item => toSafeNumber(item.total)))
    : waterGoalMl
  const weightChartEntries = weightTrend.slice(-(range === 'week' ? 7 : 10))
  const weightChartValues = weightChartEntries.map(item => toSafeNumber(item.value))
  const weightChartMin = weightChartValues.length > 0 ? Math.min(...weightChartValues) : 0
  const weightChartMax = weightChartValues.length > 0 ? Math.max(...weightChartValues) : 0
  const weightChartRange = Math.max(weightChartMax - weightChartMin, 1)
  const weightChartPoints = weightChartEntries.map((item, index) => {
    const x = weightChartEntries.length <= 1
      ? 300
      : 32 + (index / (weightChartEntries.length - 1)) * 536
    const y = 154 - ((toSafeNumber(item.value) - weightChartMin) / weightChartRange) * 112
    return `${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' ')
  const weightChartGridColor = scheme === 'dark' ? '#2f3d39' : '#e2e8f0'
  const weightChartSvg = weightChartEntries.length > 1
    ? `url("data:image/svg+xml,${encodeURIComponent(
      `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 600 180'><line x1='32' y1='42' x2='568' y2='42' stroke='${weightChartGridColor}' stroke-width='2'/><line x1='32' y1='98' x2='568' y2='98' stroke='${weightChartGridColor}' stroke-width='2'/><line x1='32' y1='154' x2='568' y2='154' stroke='${weightChartGridColor}' stroke-width='2'/><polyline points='${weightChartPoints}' fill='none' stroke='#5cb896' stroke-width='8' stroke-linecap='round' stroke-linejoin='round'/></svg>`
    )}")`
    : ''
  const heatmapCells: HeatmapCell[] = d.daily_calories.map((item) => {
    const hasRecord = item.calories > 0
    const delta = hasRecord ? item.calories - tdee : 0
    const deltaRatio = hasRecord ? Math.abs(delta) / Math.max(tdee, 1) : 0
    const level: HeatmapCell['level'] = deltaRatio > 0.15 ? 2 : 1

    return {
      date: item.date,
      calories: item.calories,
      delta,
      level,
      state: !hasRecord ? 'none' : delta > 0 ? 'surplus' : 'deficit'
    }
  })
  const healthIndex = d.health_index
  const hasEnoughHealthIndexData = healthIndex?.has_enough_data ?? false
  const overallRiskScore = healthIndex?.overall_score ?? 0
  const projectedOverallScore = healthIndex?.projected_score ?? 0
  const signalChips = healthIndex?.signal_chips ?? []
  const riskCards = healthIndex?.risk_cards ?? []
  const customRiskCards = healthIndex?.custom_risk_cards ?? []
  const allDisplayRiskCards = [...riskCards, ...customRiskCards]
  const customFocusMeta = healthIndex?.custom_focus_meta
  const allRiskOptions = (() => {
    const base = healthIndex?.all_risk_options ?? []
    const seen = new Set<string>()
    const merged: RiskOption[] = []
    base.forEach(item => {
      if (!item.key || seen.has(item.key)) return
      seen.add(item.key)
      merged.push(item)
    })
    customRiskCards.forEach(card => {
      if (!card.key || seen.has(card.key)) return
      seen.add(card.key)
      merged.push(customRiskCardToOption(card))
    })
    return merged
  })()

  const selectedRiskItems = selectedRiskKeys
    .map(key => allRiskOptions.find(item => item.key === key))
    .filter((item): item is RiskOption => Boolean(item))
  const orderedRiskOptions = [
    ...selectedRiskItems,
    ...allRiskOptions.filter(item => !selectedRiskKeys.includes(item.key)),
  ]
  const visibleRiskCards = selectedRiskKeys
    .map(key => {
      const card = allDisplayRiskCards.find(item => item.key === key)
      if (card) return card
      const option = allRiskOptions.find(item => item.key === key)
      return option?.is_custom ? pendingCustomRiskCardFromOption(option) : null
    })
    .filter((card): card is RiskCard => Boolean(card))
  const focusOverallScore = averageRiskCardScore(visibleRiskCards) ?? overallRiskScore
  const focusProjectedScore = averageRiskCardScore(visibleRiskCards, true) ?? projectedOverallScore
  const hasVisibleCustomFocus = visibleRiskCards.some(card => card.is_custom)
  const focusOverviewCopy = scoreToFocusOverview(focusOverallScore, hasVisibleCustomFocus)
  const focusScoreHint = hasVisibleCustomFocus
    ? '按当前展示的核心指标与自定义 AI 指标综合计算'
    : '按当前展示的核心关注指标综合计算'
  const selectedRiskSummary = selectedRiskItems.map(item => item.short).join('、')
  const topIssues = healthIndex?.top_issues ?? []
  const actionList = healthIndex?.action_list ?? []
  const toggleSection = (key: string) => {
    setExpandedSections(prev => ({
      ...prev,
      [key]: !prev[key],
    }))
  }

  const openRangeSelector = () => {
    if (loading) return
    Taro.showActionSheet({
      itemList: ['近一周', '近一个月'],
    }).then(res => {
      const nextRange = res.tapIndex === 1 ? 'month' : 'week'
      if (nextRange !== rangeRef.current) {
        setRange(nextRange)
      }
    }).catch(() => {
      // 用户取消选择
    })
  }

  const toggleRiskPreference = (riskKey: string) => {
    setSelectedRiskKeys(prev => {
      const exists = prev.includes(riskKey)
      const next = exists ? prev.filter(item => item !== riskKey) : [...prev, riskKey]
      const normalized = next.length > 0 ? next : [riskKey]
      try {
        Taro.setStorageSync(RISK_PREF_STORAGE_KEY, normalized)
      } catch {
        // ignore
      }
      if (riskDetailModal.card?.key === riskKey && exists) {
        setRiskDetailModal(prev => ({ ...prev, card: null }))
      }
      return normalized
    })
  }

  return (
    <View className={`stats-page ${scheme === 'dark' ? 'stats-page--dark' : ''}`}>
      {dataSyncing ? (
        <View className='stats-page__data-sync'>
          <View className='stats-page__data-sync-spinner' />
        </View>
      ) : null}
      <View
        className={`stats-range-dropdown ${loading ? 'is-loading' : ''}`}
        onClick={openRangeSelector}
      >
        <Text className='stats-range-dropdown__label'>{range === 'week' ? '近一周' : '近一个月'}</Text>
        <Text className='iconfont icon-right-arrow stats-range-dropdown__arrow' />
      </View>
      <ScrollView className='scroll-wrap' scrollY enhanced showScrollbar={false}>
        {!hasEnoughHealthIndexData ? (
          <View className='stats-card health-index-gate-card'>
            <View className='health-index-gate-icon'>
              <Text className='iconfont icon-shangzhang health-index-gate-icon-text' />
            </View>
            <View className='health-index-gate-copy'>
              <Text className='health-index-gate-title'>连续记录两天后显示健康指数</Text>
              <Text className='health-index-gate-desc'>
                当前已记录 {d.recorded_days ?? 0} 天。请连续记录两天以上，我们会基于更稳定的饮食趋势展示你的健康参考指数。
              </Text>
            </View>
          </View>
        ) : (
          <>
            <View className='stats-card risk-overview-card'>
              <View className='risk-overview-top'>
                <View className='risk-overview-copy'>
                  <Text className='risk-overview-title'>关注综合分</Text>
                </View>
                <View className='risk-overview-actions'>
                  <View className={`risk-overview-badge tone-${scoreToTone(focusOverallScore)}`}>
                    <Text className='risk-overview-badge-label'>{scoreToLabel(focusOverallScore)}</Text>
                  </View>
                </View>
              </View>

              <View className='risk-overview-score-row'>
                <Text className='risk-overview-score'>{focusOverallScore}</Text>
                <Text className='risk-overview-score-unit'>/ 100</Text>
              </View>
              <Text className='risk-overview-score-hint'>{focusScoreHint}</Text>

              <Text className='risk-overview-summary'>{focusOverviewCopy}</Text>

              <View className='risk-overview-chip-row'>
                {signalChips.map((chip) => (
                  <View key={chip.label} className='risk-overview-chip'>
                    <Text className='risk-overview-chip-label'>{chip.label}</Text>
                    <Text className='risk-overview-chip-value'>{chip.value}</Text>
                  </View>
                ))}
              </View>
            </View>
            {Taro.getStorageSync('health_disclaimer_dismissed') !== '1' && (
              <View className='health-disclaimer-banner'>
                <Text className='health-disclaimer-banner__dot' />
                <Text className='health-disclaimer-banner__text'>结果仅供参考，不代替医学判断</Text>
                <Text
                  className='health-disclaimer-banner__btn'
                  onClick={() => {
                    Taro.setStorageSync('health_disclaimer_dismissed', '1')
                    Taro.showToast({ title: '已确认', icon: 'success' })
                  }}
                >
                  我知道了
                </Text>
              </View>
            )}
          </>
        )}
        <View className='analysis-tabs-container'>
          <View className={`segmented-control analysis-panel-control ${loading ? 'is-loading' : ''}`}>
            {loading && (
              <View className='tabs-loading'>
                <View className='loading-spinner-md' />
              </View>
            )}
            {ANALYSIS_PANEL_TABS.map(item => (
              <View
                key={item.key}
                className={`segment-item ${analysisPanel === item.key ? 'active' : ''}`}
                onClick={() => !loading && setAnalysisPanel(item.key)}
              >
                <Text>{item.label}</Text>
              </View>
            ))}
          </View>
        </View>

        {analysisPanel === 'health' && hasEnoughHealthIndexData ? (
          <>
        <View className='risk-section-header'>
          <Text className='risk-section-title'>健康指标关注</Text>
          <View
            className='risk-focus-edit-btn'
            onClick={(e) => {
              e.stopPropagation()
              setRiskPickerVisible(true)
            }}
          >
            <Text className='iconfont icon-target risk-focus-edit-icon' />
            <Text className='risk-focus-edit-text'>我的关注</Text>
          </View>
        </View>

        <View className='risk-card-grid'>
          {visibleRiskCards.map((card) => (
            <View
              key={card.key}
              className='stats-card risk-card'
              style={{ background: riskCardBgGradient(card.key) }}
              onClick={() => setRiskDetailModal({ visible: true, card })}
            >
              <View className='risk-card-main-row'>
                <View
                  className='risk-card-icon-circle'
                  style={{ background: riskCardIconBgColor(card.key, scheme === 'dark') }}
                >
                  <Text
                    className={`iconfont icon-${riskCardIcon(card.key)} risk-card-icon`}
                    style={{ color: riskCardIconColor(card.key, scheme === 'dark') }}
                  />
                </View>
                <View className='risk-card-score-wrap'>
                  <Text className='risk-card-score'>{card.score}</Text>
                  <Text className='risk-card-score-unit'>分</Text>
                </View>
              </View>
              <Text className='risk-card-title'>{card.title}</Text>
              {card.is_custom ? (
                <View className='risk-card-ai-badge-row'>
                  <Text className='risk-card-ai-badge'>AI</Text>
                  {card.needs_refresh ? (
                    <Text className='risk-card-ai-refresh-hint'>待更新</Text>
                  ) : null}
                </View>
              ) : null}
              <Text className='risk-card-summary'>{card.brief}</Text>
            </View>
          ))}
        </View>

        {riskPickerVisible ? (
          <View
            className='risk-focus-modal'
            onClick={() => setRiskPickerVisible(false)}
          >
            <View className='risk-focus-modal-mask' />
            <View
              className='risk-focus-modal-content'
              onClick={(e) => e.stopPropagation()}
            >
              <View className='risk-focus-modal-handle' />
              <View className='risk-focus-modal-header'>
                <View className='risk-focus-modal-title-wrap'>
                  <Text className='risk-focus-modal-title'>我的关注</Text>
                  <Text className='risk-focus-modal-subtitle'>选择你想优先看的健康方向</Text>
                </View>
                <View className='risk-focus-modal-count'>
                  <Text className='risk-focus-modal-count-text'>已选 {selectedRiskItems.length}</Text>
                </View>
              </View>
              <Text className='risk-focus-modal-summary'>当前：{selectedRiskSummary}</Text>
              <View className='risk-custom-focus-add'>
                <Input
                  className='risk-custom-focus-input'
                  value={customFocusInput}
                  maxlength={12}
                  placeholder='添加你关心的方向，如控尿酸'
                  onInput={(e) => setCustomFocusInput(String(e.detail.value || ''))}
                />
                <View
                  className={`risk-custom-focus-add-btn${customFocusAdding ? ' is-loading' : ''}`}
                  onClick={() => {
                    if (!customFocusAdding) void handleAddCustomFocus()
                  }}
                >
                  <Text className='risk-custom-focus-add-btn-text'>
                    {customFocusAdding ? '生成中…' : '添加关注'}
                  </Text>
                </View>
              </View>
              {customFocusMeta ? (
                <Text className='risk-custom-focus-meta'>
                  AI 卡片每次消耗 {customFocusMeta.generate_cost} 积分，今日还可生成 {customFocusMeta.remaining_today} / {customFocusMeta.daily_limit} 次，最多 {customFocusMeta.max_focuses} 个自定义关注
                </Text>
              ) : null}
              <View className='risk-picker-grid risk-picker-grid--modal'>
                {orderedRiskOptions.map((item) => {
                  const active = selectedRiskKeys.includes(item.key)
                  const focusId = isCustomRiskKey(item.key) ? item.key.replace(/^custom:/, '') : ''
                  return (
                    <View
                      key={item.key}
                      className={`risk-picker-chip ${active ? 'active' : ''} ${item.is_custom ? 'is-custom' : ''}`}
                      onClick={() => toggleRiskPreference(item.key)}
                      onLongPress={() => {
                        if (item.is_custom && focusId) {
                          Taro.showModal({
                            title: '移除自定义关注',
                            content: `确定移除「${item.title}」吗？`,
                            success: (res) => {
                              if (res.confirm) void handleRemoveCustomFocus(focusId)
                            },
                          })
                        }
                      }}
                    >
                      <Text className='risk-picker-chip__title'>
                        {item.title}
                        {item.is_custom ? ' · AI' : ''}
                      </Text>
                      <Text className='risk-picker-chip__action'>
                        {item.is_custom ? (active ? '长按移除' : '点按添加') : (active ? '显示中' : '点按添加')}
                      </Text>
                    </View>
                  )
                })}
              </View>
              <View
                className='risk-focus-modal-close'
                onClick={() => setRiskPickerVisible(false)}
              >
                <Text className='risk-focus-modal-close-text'>完成</Text>
              </View>
            </View>
          </View>
        ) : null}

        {/* 友好度详情底部弹窗 */}
        {riskDetailModal.visible && riskDetailModal.card && (
          <View
            className='risk-detail-modal'
            onClick={() => setRiskDetailModal({ visible: false, card: null })}
          >
            <View className='risk-detail-backdrop' />
            <View
              className='risk-detail-panel'
              onClick={(e) => e.stopPropagation()}
            >
              <View className='risk-detail-handle' />
              <View className='risk-detail-header'>
                <View className='risk-detail-title-row'>
                  <Text className='risk-detail-title'>{riskDetailModal.card.title}</Text>
                  {riskDetailModal.card.is_custom ? (
                    <Text className='risk-detail-ai-badge'>AI</Text>
                  ) : null}
                </View>
                <View className='risk-detail-score-row'>
                  <Text className='risk-detail-score'>{riskDetailModal.card.score}</Text>
                  <Text className='risk-detail-score-unit'>分</Text>
                  <View className={`risk-detail-badge tone-${riskDetailModal.card.tone}`}>
                    <Text className='risk-detail-badge-text'>{scoreToLabel(riskDetailModal.card.score)}</Text>
                  </View>
                </View>
              </View>
              <View className='risk-detail-body'>
                {riskDetailModal.card.is_custom ? (
                  <Text className='risk-detail-ai-disclaimer'>
                    基于饮食趋势的趋势性参考，不构成医学诊断或治疗建议。
                  </Text>
                ) : null}
                <Text className='risk-detail-section-text'>{riskDetailModal.card.summary}</Text>
                <View className='risk-detail-divider' />
                <Text className='risk-detail-section-label'>判断依据</Text>
                <Text className='risk-detail-section-text'>{riskDetailModal.card.basis}</Text>
                <View className='risk-detail-divider' />
                <Text className='risk-detail-section-label'>最小改善动作</Text>
                <Text className='risk-detail-section-text'>{riskDetailModal.card.action}</Text>
                <View className='risk-detail-delta'>
                  <Text className='risk-detail-delta-text'>预计可提升 {riskDetailModal.card.delta} 分</Text>
                </View>
                {riskDetailModal.card.is_custom && riskDetailModal.card.needs_refresh ? (
                  <View
                    className={`risk-detail-refresh-btn${customFocusRefreshingKey === riskDetailModal.card.key ? ' is-loading' : ''}`}
                    onClick={() => {
                      if (customFocusRefreshingKey !== riskDetailModal.card?.key) {
                        void handleRefreshCustomFocus(riskDetailModal.card!)
                      }
                    }}
                  >
                    <Text className='risk-detail-refresh-text'>
                      {customFocusRefreshingKey === riskDetailModal.card.key ? '更新中…' : '手动更新 AI 卡片'}
                    </Text>
                  </View>
                ) : null}
              </View>
              <View
                className='risk-detail-close-btn'
                onClick={() => setRiskDetailModal({ visible: false, card: null })}
              >
                <Text className='risk-detail-close-text'>知道了</Text>
              </View>
            </View>
          </View>
        )}

        <View className='action-section-header'>
          <View className='action-section-title-wrap'>
            <Text className='action-section-title'>这段时间最值得先改的地方</Text>
          </View>
        </View>
        <View className='action-plan-grid'>
            <View className='action-plan-panel action-plan-panel--red'>
              <Text className='action-plan-panel__title'>当前主要拖累项</Text>
              {topIssues.length > 0 ? (
                topIssues.map((issue) => (
                  <View key={issue.title} className='action-plan-item'>
                    <Text className='action-plan-item__bullet action-plan-item__bullet--error'>×</Text>
                    <View className='action-plan-item__copy'>
                      <Text className='action-plan-item__title'>{issue.title}</Text>
                      <Text className='action-plan-item__detail'>{issue.detail}</Text>
                    </View>
                  </View>
                ))
              ) : (
                <Text className='action-plan-panel__empty'>当前没有特别突出的单一问题，重点保持稳定记录和小幅优化。</Text>
              )}
            </View>

            <View className='action-plan-panel action-plan-panel--green'>
              <Text className='action-plan-panel__title'>建议你先这样改</Text>
              {actionList.map((action) => (
                <View key={action} className='action-plan-item'>
                  <Text className='action-plan-item__bullet'>•</Text>
                  <View className='action-plan-item__copy'>
                    <Text className='action-plan-item__title'>{action}</Text>
                  </View>
                </View>
              ))}
            </View>
          </View>
          <View className='action-score-delta'>
            <Text className='action-score-delta__dot' />
            <Text className='action-score-delta__text'>如果完成修改，关注综合分约为 {focusOverallScore} → {focusProjectedScore}</Text>
          </View>

          </>
        ) : null}

        {analysisPanel === 'nutrition' ? (
          <>
        <View className='stats-card ai-insight-card'>
          <View className='ai-insight-card-top'>
            <View className='ai-insight-card-title-wrap'>
              <Text className='ai-insight-card-title'>AI 风险解读</Text>
            </View>
          </View>
          <View className='ai-insight-card-body'>
            {canUseStatsInsight && insightGeneratedDate ? (
              <View className={`analysis-status${insightNeedsRefresh ? ' warning' : ''}`}>
                <View className='analysis-status-copy'>
                  <Text className='analysis-status-text'>
                    {insightNeedsRefresh
                      ? `当前展示的是 ${insightGeneratedDate} 生成的缓存，你最近新增了饮食记录，可按需手动更新。`
                      : `当前展示的是 ${insightGeneratedDate} 生成的缓存。`}
                  </Text>
                  <Text className='analysis-status-subtext'>
                    深度解读每次消耗 1 积分，今日还可更新 {insightRemainingToday} / {insightDailyLimit} 次。
                  </Text>
                </View>
                {canGenerateInsight ? (
                  <View
                    className={`analysis-status-action${insightActionLoading ? ' is-loading' : ''}`}
                    onClick={(e) => {
                      e.stopPropagation()
                      if (!insightActionLoading) handleGenerateInsight()
                    }}
                  >
                    {insightActionLoading ? (
                      <Text className='iconfont icon-jiazaixiao analysis-status-action-icon' />
                    ) : (
                      <Text className='analysis-status-action-text'>手动更新</Text>
                    )}
                  </View>
                ) : (
                  <View className='analysis-status-action is-disabled'>
                    <Text className='analysis-status-action-text'>今日已用完</Text>
                  </View>
                )}
              </View>
            ) : null}
            {insightError ? (
              <View className='analysis-error'>
                <Text className='analysis-error-text'>{insightError}</Text>
              </View>
            ) : null}
            {!canUseStatsInsight ? (
              <View className='analysis-empty analysis-empty--gate'>
                <Text className='analysis-empty-title'>先记录饮食后再生成 AI 风险解读</Text>
                <Text className='analysis-empty-text'>当前统计周期还没有饮食记录，暂时无法判断热量、餐次和宏量营养趋势。记录至少一餐后，这里会基于真实数据生成解读。</Text>
              </View>
            ) : insightActionLoading ? (
              <View className='analysis-loading-card'>
                <View className='analysis-loading-card-header'>
                  <Text className='iconfont icon-jiazaixiao analysis-loading-card-icon' />
                  <View className='analysis-loading-card-copy'>
                    <Text className='analysis-loading-card-title'>正在更新 AI 风险解读</Text>
                    <Text className='analysis-loading-card-text'>会基于你当前统计周期的最新饮食记录重新生成这段分析。</Text>
                  </View>
                </View>
                <View className='analysis-skeleton-group'>
                  <View className='analysis-skeleton-line w-92' />
                  <View className='analysis-skeleton-line w-100' />
                  <View className='analysis-skeleton-line w-86' />
                  <View className='analysis-skeleton-line w-96' />
                  <View className='analysis-skeleton-line w-70' />
                </View>
              </View>
            ) : displayInsightText ? (
              <View className='analysis-content'>{renderInsightMarkdown(displayInsightText)}</View>
            ) : isTyping ? (
              <View className='analysis-loading'>
                <Text className='iconfont icon-jiazaixiao analysis-loading-icon' />
                <Text className='analysis-loading-text'>
                  正在展示已生成的洞察...
                </Text>
              </View>
            ) : (
              <View className='analysis-empty'>
                <Text className='analysis-empty-text'>这里不会在每次打开页面时自动重新分析。你可以在需要时手动生成一次。</Text>
                <View
                  className={`analysis-empty-action${!canGenerateInsight ? ' is-disabled' : ''}`}
                  onClick={() => {
                    if (canGenerateInsight) handleGenerateInsight()
                  }}
                >
                  <Text className='analysis-empty-action-text'>
                    {canGenerateInsight
                      ? `生成本${range === 'week' ? '周' : '月'}深度解读（1积分）`
                      : '今日生成次数已用完'}
                  </Text>
                </View>
              </View>
            )}
          </View>
        </View>

          </>
        ) : null}

        {analysisPanel === 'structure' ? (
          hasAnyDietData ? (
            <>
        <View className='stats-card chart-card evidence-card'>
          <View className='card-header chart-card-header card-header--collapsible' onClick={() => toggleSection('calories')}>
            <View className='chart-title-group'>
              <Text className='iconfont icon-shangzhang chart-title-icon' />
              <View className='card-header-copy'>
                <Text className='card-title'>热量摄入趋势</Text>
                <Text className='card-subtitle'>{range === 'week' ? '最近 7 天' : '最近 14 天'}摄入变化和超标情况</Text>
              </View>
            </View>
            <View className='card-header-actions'>
              <View className='card-header-arrow'>{expandedSections.calories ? <IconCollapse size={24} color='#94a3b8' /> : <IconExpand size={24} color='#94a3b8' />}</View>
            </View>
          </View>
          {expandedSections.calories ? (
            <View className='card-collapsible-content'>
              <View style={{ marginBottom: '20rpx' }}>
                <View className='chart-switch-wrap' onClick={(e) => e.stopPropagation()}>
                  <Text className='chart-switch-label'>显示数值</Text>
                  <Switch
                    className='chart-switch'
                    checked={showCalories}
                    onChange={(v: any) => setShowCalories(Boolean(typeof v === 'object' ? v?.detail?.value : v))}
                    style={{ '--switch-checked-background-color': '#5cb896' } as CSSProperties}
                  />
                </View>
              </View>
              {chartDays.length > 0 ? (
                <View className='bar-chart-container'>
                  {chartDays.map((item) => {
                    const heightPct = Math.max((item.calories / maxDailyCalories) * 100, 10)
                    return (
                      <View key={item.date} className='chart-col'>
                        {showCalories ? (
                          <Text className='bar-calorie-text'>{Math.round(item.calories)}</Text>
                        ) : null}
                        <View className='bar-wrapper'>
                          <View
                            className={`bar-fill ${item.calories > tdee ? 'over' : ''}`}
                            style={{ height: `${heightPct}%` }}
                          />
                        </View>
                        <Text className='bar-label'>{item.date.slice(5)}</Text>
                      </View>
                    )
                  })}
                </View>
              ) : (
                <View className='chart-empty-state'>
                  <Text className='empty-text'>暂无数据</Text>
                </View>
              )}
            </View>
          ) : null}
        </View>

        <View className='stats-card macro-card evidence-card'>
          <View className='card-header card-header--collapsible' onClick={() => toggleSection('macro')}>
            <Text className='iconfont icon-tianpingzuo chart-title-icon' />
            <View className='card-header-copy'>
              <Text className='card-title'>宏量营养结构</Text>
              <Text className='card-subtitle'>蛋白质、碳水和脂肪的摄入占比</Text>
            </View>
            <View className='card-header-arrow'>{expandedSections.macro ? <IconCollapse size={24} color='#94a3b8' /> : <IconExpand size={24} color='#94a3b8' />}</View>
          </View>
          {expandedSections.macro ? (
            <View className='card-collapsible-content'>
              <View className='macro-list'>
                <View className='macro-row'>
                  <View className='macro-info'>
                    <View className='macro-label-wrap'>
                      <Text className='iconfont icon-danbaizhi macro-icon protein' />
                      <Text className='macro-name'>蛋白质</Text>
                    </View>
                    <Text className='macro-detail'>{totalProtein.toFixed(0)}g / {macroPercent.protein}%</Text>
                  </View>
                  <View className='progress-track'>
                    <View className='progress-fill protein' style={{ width: `${clampPercent(macroPercent.protein)}%` }}></View>
                  </View>
                </View>

                <View className='macro-row'>
                  <View className='macro-info'>
                    <View className='macro-label-wrap'>
                      <Text className='iconfont icon-tanshui-dabiao macro-icon carbs' />
                      <Text className='macro-name'>碳水化合物</Text>
                    </View>
                    <Text className='macro-detail'>{totalCarbs.toFixed(0)}g / {macroPercent.carbs}%</Text>
                  </View>
                  <View className='progress-track'>
                    <View className='progress-fill carbs' style={{ width: `${clampPercent(macroPercent.carbs)}%` }}></View>
                  </View>
                </View>

                <View className='macro-row'>
                  <View className='macro-info'>
                    <View className='macro-label-wrap'>
                      <Text className='iconfont icon-zhifangyouheruhuazhifangzhipin macro-icon fat' />
                      <Text className='macro-name'>脂肪</Text>
                    </View>
                    <Text className='macro-detail'>{totalFat.toFixed(0)}g / {macroPercent.fat}%</Text>
                  </View>
                  <View className='progress-track'>
                    <View className='progress-fill fat' style={{ width: `${clampPercent(macroPercent.fat)}%` }}></View>
                  </View>
                </View>
              </View>
            </View>
          ) : null}
        </View>

        <View className='stats-card meal-structure-card evidence-card'>
          <View className='card-header card-header--collapsible' onClick={() => toggleSection('meals')}>
            <Text className='iconfont icon-canciguanli chart-title-icon' />
            <View className='card-header-copy'>
              <Text className='card-title'>餐次热量分布</Text>
              <Text className='card-subtitle'>早餐、午餐、晚餐和加餐的热量占比</Text>
            </View>
            <View className='card-header-arrow'>{expandedSections.meals ? <IconCollapse size={24} color='#94a3b8' /> : <IconExpand size={24} color='#94a3b8' />}</View>
          </View>
          {expandedSections.meals ? (
            <View className='card-collapsible-content'>
              <View className='meal-gauges-grid'>
                {(['breakfast', 'morning_snack', 'lunch', 'afternoon_snack', 'dinner', 'evening_snack'] as const).map((key) => {
                  const cal = byMeal[key]
                  const pct = totalCalories > 0 ? (cal / totalCalories) * 100 : 0
                  const MealIcon = MEAL_ICONS[key]
                  const color = mealStructureAccent(key)
                  const trackColor = scheme === 'dark' ? '#2f353a' : '#f0f0f0'
                  const radius = 43
                  const circumference = 2 * Math.PI * radius
                  const progress = Math.min(pct / 100, 1)

                  return (
                    <View key={key} className='meal-gauge-item'>
                      <View className='meal-gauge-left'>
                        <View className='meal-gauge-icon-wrap' style={{ backgroundColor: `${color}14` }}>
                          <MealIcon size={20} color={color} />
                        </View>
                        <Text className='meal-gauge-label'>{MEAL_NAMES[key]}</Text>
                        <Text className='meal-gauge-percent' style={{ color }}>{pct.toFixed(1)}%</Text>
                      </View>

                      <View className='meal-gauge-right'>
                        <View className='meal-gauge-circle'>
                          <View
                            className='meal-gauge-ring'
                            style={{
                              backgroundImage: `url("data:image/svg+xml,${encodeURIComponent(
                                `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><circle cx='50' cy='50' r='${radius}' fill='none' stroke='${trackColor}' stroke-width='12'/><circle cx='50' cy='50' r='${radius}' fill='none' stroke='${color}' stroke-width='12' stroke-linecap='round' stroke-dasharray='${circumference}' stroke-dashoffset='${circumference * (1 - progress)}'/></svg>`
                              )}")`,
                              backgroundSize: '100% 100%'
                            }}
                          />
                          <View className='meal-gauge-center'>
                            <Text className='meal-gauge-cal' style={{ color }}>{Math.round(cal)}</Text>
                          </View>
                        </View>
                      </View>
                    </View>
                  )
                })}
              </View>
            </View>
          ) : null}
        </View>

        <View className='stats-card body-metrics-card evidence-card'>
          <View className='card-header card-header--collapsible' onClick={() => toggleSection('body')}>
            <Text className='iconfont icon-shangzhang chart-title-icon' />
            <View className='card-header-copy'>
              <Text className='card-title'>长期健康指标</Text>
              <Text className='card-subtitle'>体重趋势和喝水趋势</Text>
            </View>
            <View className='card-header-arrow'>{expandedSections.body ? <IconCollapse size={24} color='#94a3b8' /> : <IconExpand size={24} color='#94a3b8' />}</View>
          </View>
          {expandedSections.body ? (
            <View className='card-collapsible-content'>
              <View className='body-metrics-grid'>
                <View className='body-metric-panel'>
                  <View className='body-metric-panel-header'>
                    <Text className='body-metric-title'>体重趋势</Text>
                    {latestWeight ? (
                      <Text className='body-metric-main'>
                        {latestWeight.value.toFixed(1)} kg
                      </Text>
                    ) : (
                      <Text className='body-metric-empty'>还没有云端体重记录</Text>
                    )}
                  </View>
                  {latestWeight ? (
                    <Text className='body-metric-sub'>
                      {previousWeight
                        ? `${weightChange && weightChange > 0 ? '+' : ''}${toSafeNumber(weightChange).toFixed(1)} kg，较上次`
                        : '已开始累计体重趋势'}
                    </Text>
                  ) : null}
                  {weightChartEntries.length > 0 ? (
                    <View className='weight-line-chart-wrap'>
                      <View
                        className={`weight-line-chart ${weightChartEntries.length <= 1 ? 'single-point' : ''}`}
                        style={weightChartSvg ? { backgroundImage: weightChartSvg } : undefined}
                      >
                        {weightChartEntries.length === 1 ? (
                          <View className='weight-line-single-dot' />
                        ) : null}
                        <View className='weight-line-point-layer'>
                          {weightChartEntries.map((item, index) => {
                            const left = weightChartEntries.length <= 1
                              ? 50
                              : 5.3 + (index / (weightChartEntries.length - 1)) * 89.4
                            const top = weightChartEntries.length <= 1
                              ? 50
                              : 23.3 + (1 - ((toSafeNumber(item.value) - weightChartMin) / weightChartRange)) * 62.2
                            return (
                              <View
                                key={item.date}
                                className='weight-line-point'
                                style={{ left: `${left}%`, top: `${top}%` }}
                              >
                                <Text className='weight-line-point-value'>{item.value.toFixed(1)}</Text>
                              </View>
                            )
                          })}
                        </View>
                      </View>
                      <View className='weight-line-label-row'>
                        {weightChartEntries.map((item) => (
                          <Text key={item.date} className='weight-line-label'>{item.date.slice(5)}</Text>
                        ))}
                      </View>
                    </View>
                  ) : null}
                </View>

                <View className='body-metric-panel water-panel'>
                  <View className='body-metric-panel-header'>
                    <Text className='body-metric-title'>喝水趋势</Text>
                    <Text className='body-metric-main'>
                      {avgDailyWaterMl.toFixed(0)} ml
                    </Text>
                  </View>
                  <Text className='body-metric-sub'>
                    日均 {avgDailyWaterMl.toFixed(0)} ml，目标 {waterGoalMl} ml，累计 {totalWaterMl.toFixed(0)} ml
                  </Text>
                  {waterTrend.length > 0 ? (
                    <View className='water-trend-chart'>
                      {waterTrend.map((item) => {
                        const pct = maxWaterValue > 0 ? Math.max((toSafeNumber(item.total) / maxWaterValue) * 100, 8) : 8
                        return (
                          <View key={item.date} className='water-trend-col'>
                            <View className='water-trend-bar-wrap'>
                              <View className='water-trend-bar' style={{ height: `${pct}%` }} />
                            </View>
                            <Text className='water-trend-label'>{item.date.slice(5)}</Text>
                          </View>
                        )
                      })}
                    </View>
                  ) : null}
                  <View className='water-metric-footer'>
                    <Text className='water-metric-note'>
                      {waterRecordedDays > 0 ? `已有 ${waterRecordedDays} 天饮水记录` : '还没有云端喝水记录'}
                    </Text>
                  </View>
                </View>
              </View>
            </View>
          ) : null}
        </View>
            </>
          ) : (
            <View className='stats-card stats-data-gate-card'>
              <View className='health-index-gate-icon'>
                <Text className='iconfont icon-canciguanli health-index-gate-icon-text' />
              </View>
              <View className='health-index-gate-copy'>
                <Text className='health-index-gate-title'>记录饮食后查看营养结构</Text>
                <Text className='health-index-gate-desc'>
                  当前统计周期还没有饮食记录。先记录一餐后，这里会展示热量趋势、宏量营养占比和餐次分布。
                </Text>
              </View>
            </View>
          )
        ) : null}

        <View className='footer-placeholder' />
      </ScrollView>
    </View>
  )
}

export default withAuth(StatsPage, { public: true })
