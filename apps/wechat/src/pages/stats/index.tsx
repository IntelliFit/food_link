import { View, Text, ScrollView, Input, Switch, Checkbox, Image } from '@tarojs/components'
import { useState, useEffect, useCallback, useRef } from 'react'
import Taro, { useDidHide, useDidShow } from '@tarojs/taro'
import { readStatsPageCache, writeStatsPageCache } from '../../utils/stats-page-cache'
import { restoreRiskFocusKeys } from './risk-focus-preference'
import { showDietDecisionEvidence } from '../../utils/diet-decision-evidence'
import {
  getStatsSummary,
  generateStatsInsight,
  getBodyMetricsSummary,
  addHealthFocus,
  removeHealthFocus,
  generateCustomFocusCard,
  getAnalyzeTask,
  showUnifiedApiError,
  type StatsSummary,
  type BodyMetricWeightEntry,
  type BodyMetricWaterDay,
  type HealthIndex,
  type RiskCard,
  type RiskOption,
  type RiskTone,
} from '../../utils/api'
import {
  customFocusCardFromTask,
  readPendingCustomFocusTasks,
  removePendingCustomFocusTask,
  savePendingCustomFocusTask,
  type PendingCustomFocusTask,
} from '../../utils/custom-focus-task'
import { IconExpand, IconCollapse } from '../../components/iconfont'
import healthScoreForest from '../../assets/stats/health-score-forest.webp'
import './index.scss'
import { withAuth, redirectToLogin } from '../../utils/withAuth'
import { useAppColorScheme } from '../../components/AppColorSchemeContext'

const MEAL_NAMES: Record<string, string> = {
  breakfast: '早餐',
  morning_snack: '上午加餐',
  lunch: '午餐',
  afternoon_snack: '下午加餐',
  dinner: '晚餐',
  evening_snack: '晚间加餐',
  snack: '下午加餐'
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
  type: 'heading' | 'paragraph' | 'list' | 'table'
  text?: string
  items?: string[]
  headers?: string[]
  rows?: string[][]
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

function parseMarkdownTableLine(line: string): string[] {
  const cells = line.split('|').map(cell => cell.trim())
  if (cells[0] === '') cells.shift()
  if (cells[cells.length - 1] === '') cells.pop()
  return cells
}

function isMarkdownTableDelimiter(line: string): boolean {
  const trimmed = line.trim()
  if (!trimmed.includes('|')) return false
  const cells = parseMarkdownTableLine(trimmed)
  return cells.length > 0 && cells.every(cell => /^:?-{2,}:?$/.test(cell))
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

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i]
    const line = rawLine.trim()

    if (!line) {
      flushParagraph()
      flushList()
      continue
    }

    if (line.includes('|')) {
      const nextLine = lines[i + 1]
      if (nextLine !== undefined && isMarkdownTableDelimiter(nextLine)) {
        flushParagraph()
        flushList()
        const headers = parseMarkdownTableLine(rawLine)
        i++ // skip delimiter line
        const rows: string[][] = []
        i++ // start from first body row
        while (i < lines.length && lines[i].trim().includes('|')) {
          rows.push(parseMarkdownTableLine(lines[i]))
          i++
        }
        blocks.push({ type: 'table', headers, rows })
        i-- // let outer loop process the first non-table line
        continue
      }
    }

    if (/^\s{0,3}#{1,6}\s+/.test(rawLine)) {
      flushParagraph()
      flushList()
      blocks.push({ type: 'heading', text: stripInsightMarkdownPrefix(rawLine) })
      continue
    }

    if (/^\s*([-*+]|\d+[.)])\s+/.test(rawLine)) {
      flushParagraph()
      listItems.push(stripInsightMarkdownPrefix(rawLine))
      continue
    }

    flushList()
    paragraph.push(line)
  }
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
    if (block.type === 'table') {
      const headers = block.headers || []
      const rows = block.rows || []
      const colCount = Math.max(1, headers.length)
      return (
        <View key={`table-${index}`} className='analysis-md-table-wrapper'>
          <View
            className='analysis-md-table'
            style={{ gridTemplateColumns: `repeat(${colCount}, minmax(140rpx, 1fr))` }}
          >
            {headers.map((header, headerIndex) => (
              <View
                key={`th-${headerIndex}`}
                className='analysis-md-table-cell analysis-md-table-header'
              >
                {renderInsightInline(header)}
              </View>
            ))}
            {rows.map((row, rowIndex) =>
              row.map((cell, cellIndex) => (
                <View key={`td-${rowIndex}-${cellIndex}`} className='analysis-md-table-cell'>
                  {renderInsightInline(cell)}
                </View>
              ))
            )}
          </View>
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
  { key: 'health', label: '健康关注' },
  { key: 'nutrition', label: '饮食解读' },
  { key: 'structure', label: '趋势' },
]

const DEFAULT_RISK_KEYS = ['hypertension', 'diabetes', 'cardio', 'weight', 'micronutrient']
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

function customFocusConfidenceLabel(confidence?: string): string {
  switch (confidence) {
    case 'high': return '高置信度'
    case 'medium': return '中置信度'
    case 'low': return '低置信度'
    default: return '证据待补充'
  }
}

function customFocusScoreChangeLabel(change?: number): string {
  if (typeof change !== 'number' || !Number.isFinite(change)) return ''
  if (change > 0) return `较上次 +${change}`
  if (change < 0) return `较上次 ${change}`
  return '与上次持平'
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

function riskCardIcon(key: string): string {
  switch (key) {
    case 'hypertension': return 'tianpingzuo'
    case 'diabetes': return 'tanshui-dabiao'
    case 'cardio': return 'dumbbell'
    case 'weight': return 'weight-scale'
    case 'colorectal': return 'a-144-lvye'
    case 'longevity': return 'shangzhang'
    case 'micronutrient': return 'yiliaohangyedeICON-'
    default: return 'target'
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
  const [overviewExpanded, setOverviewExpanded] = useState(false)
  const [actionsExpanded, setActionsExpanded] = useState(false)
  const [issuesExpanded, setIssuesExpanded] = useState(false)
  const [customFocusFormVisible, setCustomFocusFormVisible] = useState(false)
  const [insightExpanded, setInsightExpanded] = useState(false)
  const [insightCanExpand, setInsightCanExpand] = useState(false)
  const [mealValuesInCalories, setMealValuesInCalories] = useState(false)

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
      return restoreRiskFocusKeys(Taro.getStorageSync(RISK_PREF_STORAGE_KEY), DEFAULT_RISK_KEYS)
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
    body: false,
    ai: false,
  })

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
  const [insightActionLoading, setInsightActionLoading] = useState(false)
  const [insightError, setInsightError] = useState<string | null>(null)
  const [showCalories, setShowCalories] = useState(false)
  const [customFocusInput, setCustomFocusInput] = useState('')
  const [customFocusAdding, setCustomFocusAdding] = useState(false)
  const [customFocusRefreshingKey, setCustomFocusRefreshingKey] = useState<string | null>(null)

  const fetchIdRef = useRef(0)
  const refreshPendingRef = useRef<Partial<Record<'week' | 'month', number>>>({})
  const statsFirstShowRef = useRef(true)
  const statsPageVisibleRef = useRef(true)
  const customFocusPollingTaskIdsRef = useRef<Set<string>>(new Set())

  useDidShow(() => {
    statsPageVisibleRef.current = true
  })
  useDidHide(() => {
    statsPageVisibleRef.current = false
  })
  useEffect(() => () => {
    statsPageVisibleRef.current = false
  }, [])

  /**
   * 拉取分析页聚合数据；silent=true 时不顶掉界面（已有缓存时后台刷新并写盘）
   */
  const refreshFromNetwork = useCallback(async (r: 'week' | 'month', silent: boolean) => {
    if (refreshPendingRef.current[r] !== undefined) return

    const token = Taro.getStorageSync('access_token')
    if (!token) {
      setGuestBrowse(true)
      setData(null)
      setLoading(false)
      return
    }

    setGuestBrowse(false)
    const reqId = ++fetchIdRef.current
    refreshPendingRef.current[r] = reqId

    if (!silent) {
      setLoading(true)
      setError(null)
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
            ...entry,
            date: entry.date,
            total: toSafeNumber(entry.total),
            logs: Array.isArray(entry.logs)
              ? entry.logs.map(log => toSafeNumber(log, NaN)).filter(log => Number.isFinite(log))
              : [],
            log_items: Array.isArray(entry.log_items)
              ? entry.log_items.map(item => ({
                  ...item,
                  amount_ml: toSafeNumber(item.amount_ml),
                }))
              : undefined,
          }))
        : []

      const hasCloudWeight = cloudWeightEntries.length > 0
      const hasCloudWater = Boolean(bodyMetricsRes && Array.isArray(bodyMetricsRes.water_daily))

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

      if (bodyMetricsRes || weightEntries.length > 0 || waterDaily.length > 0) {
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
      if (refreshPendingRef.current[r] === reqId) {
        delete refreshPendingRef.current[r]
      }
      if (reqId !== fetchIdRef.current) return
      if (!silent) {
        setLoading(false)
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

  const pollCustomFocusTask = useCallback(async (pending: PendingCustomFocusTask) => {
    if (customFocusPollingTaskIdsRef.current.has(pending.taskId)) return
    customFocusPollingTaskIdsRef.current.add(pending.taskId)
    if (statsPageVisibleRef.current) setCustomFocusRefreshingKey(pending.focusKey)
    try {
      for (let attempt = 0; attempt < 60; attempt++) {
        if (!statsPageVisibleRef.current) return
        const task = await getAnalyzeTask(pending.taskId)
        if (!readPendingCustomFocusTasks().some(item => item.taskId === pending.taskId)) return
        if (task.status === 'done') {
          const card = customFocusCardFromTask(task)
          removePendingCustomFocusTask(pending.taskId)
          if (!card) throw new Error('后台任务已完成，但没有返回关注卡片')
          if (pending.range === rangeRef.current && statsPageVisibleRef.current) {
            mergeCustomFocusCard(card)
            setRiskDetailModal(prev => prev.card?.key === card.key ? { ...prev, card } : prev)
            Taro.showToast({ title: '卡片已更新', icon: 'success' })
          }
          void refreshFromNetwork(pending.range, true)
          return
        }
        if (task.status === 'failed' || task.status === 'timed_out' || task.status === 'cancelled') {
          removePendingCustomFocusTask(pending.taskId)
          throw new Error('后台更新失败，请稍后重试')
        }
        await new Promise(resolve => setTimeout(resolve, 2000))
      }
      if (statsPageVisibleRef.current) {
        Taro.showToast({ title: '仍在后台更新，可稍后回来查看', icon: 'none' })
      }
    } catch (e: unknown) {
      if (statsPageVisibleRef.current) {
        await showUnifiedApiError(e, '刷新 AI 卡片失败')
      }
    } finally {
      customFocusPollingTaskIdsRef.current.delete(pending.taskId)
      setCustomFocusRefreshingKey(prev => prev === pending.focusKey ? null : prev)
    }
  }, [mergeCustomFocusCard, refreshFromNetwork])

  useDidShow(() => {
    readPendingCustomFocusTasks().forEach(task => {
      void pollCustomFocusTask(task)
    })
  })

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
    let focusSaved = false
    try {
      const addRes = await addHealthFocus(label)
      mergeCustomFocusOptions(addRes.focuses)
      const focusId = addRes.focus_id || addRes.focuses.find(item => item.label === label)?.id
      if (!focusId) throw new Error('添加关注失败')
      focusSaved = true
      setCustomFocusInput('')
      const customKey = `custom:${focusId}`
      const showCustomFocus = () => {
        setSelectedRiskKeys(prev => {
          const next = prev.includes(customKey) ? prev : [...prev, customKey]
          try {
            Taro.setStorageSync(RISK_PREF_STORAGE_KEY, next)
          } catch {
            // ignore
          }
          return next
        })
      }
      if (addRes.already_exists) {
        showCustomFocus()
        Taro.showToast({ title: '该关注已存在，已显示', icon: 'none' })
        return
      }
      if (data?.health_index?.custom_focus_meta?.remaining_today === 0) {
        Taro.showToast({ title: '关注已保存，明天可生成卡片', icon: 'none' })
        return
      }
      const genRes = await generateCustomFocusCard(range, focusId)
      if (genRes.status === 'done' && genRes.card) {
        showCustomFocus()
        mergeCustomFocusCard(genRes.card)
        Taro.showToast({ title: 'AI 关注已添加', icon: 'success' })
        return
      }
      if (!genRes.task_id) throw new Error('服务器未返回后台任务编号')
      showCustomFocus()
      const pendingTask: PendingCustomFocusTask = {
        taskId: genRes.task_id,
        range,
        focusId,
        focusKey: customKey,
        createdAt: Date.now(),
      }
      savePendingCustomFocusTask(pendingTask)
      Taro.showToast({
        title: '已开始生成，可离开此页',
        icon: 'none',
      })
      void pollCustomFocusTask(pendingTask)
    } catch (e: unknown) {
      await showUnifiedApiError(e, focusSaved ? '关注已保存，卡片生成失败' : '添加 AI 关注失败')
    } finally {
      setCustomFocusAdding(false)
    }
  }, [customFocusAdding, customFocusInput, data, mergeCustomFocusCard, mergeCustomFocusOptions, pollCustomFocusTask, range])

  const handleRemoveCustomFocus = useCallback(async (focusId: string) => {
    if (!focusId) return
    try {
      await removeHealthFocus(focusId)
      readPendingCustomFocusTasks()
        .filter(task => task.focusId === focusId)
        .forEach(task => removePendingCustomFocusTask(task.taskId))
      const customKey = `custom:${focusId}`
      setSelectedRiskKeys(prev => {
        const next = prev.filter(key => key !== customKey)
        try {
          Taro.setStorageSync(RISK_PREF_STORAGE_KEY, next)
        } catch {
          // ignore
        }
        return next
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

  const confirmRemoveCustomFocus = useCallback((focusId: string, title: string) => {
    Taro.showModal({
      title: '移除自定义关注',
      content: `移除「${title}」后会释放一个名额，确定继续吗？`,
      success: (res) => {
        if (res.confirm) void handleRemoveCustomFocus(focusId)
      },
    })
  }, [handleRemoveCustomFocus])

  const handleRefreshCustomFocus = useCallback(async (card: RiskCard) => {
    if (!card.is_custom || customFocusRefreshingKey) return
    const focusId = card.key.replace(/^custom:/, '')
    if (!focusId) return
    setCustomFocusRefreshingKey(card.key)
    try {
      const genRes = await generateCustomFocusCard(range, focusId)
      if (genRes.status === 'done' && genRes.card) {
        mergeCustomFocusCard(genRes.card)
        setRiskDetailModal({ visible: true, card: genRes.card })
        setCustomFocusRefreshingKey(null)
        Taro.showToast({ title: '卡片已更新', icon: 'success' })
        return
      }
      if (!genRes.task_id) throw new Error('服务器未返回后台任务编号')
      const pendingTask: PendingCustomFocusTask = {
        taskId: genRes.task_id,
        range,
        focusId,
        focusKey: card.key,
        createdAt: Date.now(),
      }
      savePendingCustomFocusTask(pendingTask)
      Taro.showToast({ title: '已在后台更新，可离开此页', icon: 'none' })
      void pollCustomFocusTask(pendingTask)
    } catch (e: unknown) {
      setCustomFocusRefreshingKey(null)
      await showUnifiedApiError(e, '刷新 AI 卡片失败')
    }
  }, [customFocusRefreshingKey, mergeCustomFocusCard, pollCustomFocusTask, range])

  // 周期切换只重置展示状态，不改变个人关注、缓存或生成规则。
  useEffect(() => {
    setOverviewExpanded(false)
    setActionsExpanded(false)
    setIssuesExpanded(false)
    setMealValuesInCalories(false)
    setRiskPickerVisible(false)
    setRiskDetailModal({ visible: false, card: null })
  }, [range])

  useEffect(() => {
    setInsightExpanded(false)
    setInsightCanExpand(false)
  }, [range, data?.analysis_summary])

  // 测量完整原文；仅折叠过长报告，不裁剪/重新总结内容。
  useEffect(() => {
    if (analysisPanel !== 'nutrition' || !data?.analysis_summary) return
    let cancelled = false
    Taro.nextTick(() => {
      if (cancelled) return
      const foldHeight = Taro.getWindowInfo().windowWidth * 720 / 750
      Taro.createSelectorQuery().select('.analysis-content').boundingClientRect((rect) => {
        if (!cancelled && rect && !Array.isArray(rect)) {
          setInsightCanExpand(rect.height > foldHeight + 1)
        }
      }).exec()
    })
    return () => { cancelled = true }
  }, [analysisPanel, data?.analysis_summary, range, loading])

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
    ? normalizedInsightText
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
  const maxDailyCalories = Math.max(tdee, ...chartDays.map(i => Math.max(toSafeNumber(i.calories), toSafeNumber(i.target?.snapshot.targets.calorie_target))), 1) * 1.12
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
  const customFocusCost = customFocusMeta?.generate_cost ?? 1
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
  const addedCustomFocusCount = allRiskOptions.filter(item => item.is_custom).length

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
  const isPendingRiskCard = (card: RiskCard) => Boolean(card.is_custom && !customRiskCards.some(item => item.key === card.key))
  const hasRiskScore = (card: RiskCard) => !isPendingRiskCard(card) && card.score_available !== false
  const hasVisibleCustomFocus = visibleRiskCards.some(card => card.is_custom)
  const focusOverallScore = overallRiskScore
  const focusProjectedScore = projectedOverallScore
  const focusOverviewCopy = scoreToFocusOverview(focusOverallScore, hasVisibleCustomFocus)
  const focusScoreHint = hasVisibleCustomFocus
    ? '仅纳入可评分的支持参考；旧专项分已停用，不代表身体变化'
    : '基于已记录数据的应用参考，不代表身体健康评分'
  const topIssues = healthIndex?.top_issues ?? []
  const actionList = Array.from(new Set([
    ...(d.diet_decision_basis?.food_group_priorities?.length ? d.diet_decision_basis.actions : []),
    ...(healthIndex?.action_list ?? []),
  ]))
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
      try {
        Taro.setStorageSync(RISK_PREF_STORAGE_KEY, next)
      } catch {
        // ignore
      }
      if (riskDetailModal.card?.key === riskKey && exists) {
        setRiskDetailModal(prev => ({ ...prev, card: null }))
      }
      return next
    })
  }

  return (
    <View className={`stats-page stats-page--editorial ${scheme === 'dark' ? 'stats-page--dark' : ''}`}>
      <View className='stats-page-title'><Text>分析</Text></View>
      <View
        className={`stats-range-dropdown ${loading ? 'is-loading' : ''}`}
        onClick={openRangeSelector}
      >
        <Text className='stats-range-dropdown__label'>{range === 'week' ? '近一周' : '近一个月'}</Text>
        <Text className='iconfont icon-right-arrow stats-range-dropdown__arrow' />
      </View>
      <View className='analysis-tabs-container'>
        <View className={`segmented-control analysis-panel-control ${loading ? 'is-loading' : ''}`}>
          {ANALYSIS_PANEL_TABS.map(item => (
            <View
              key={item.key}
              className={`segment-item ${analysisPanel === item.key ? 'active' : ''}`}
              aria-role='button'
              aria-label={`${item.label}${analysisPanel === item.key ? '，已选中' : ''}`}
              onClick={() => { if (!loading) setAnalysisPanel(item.key) }}
            >
              <Text>{item.label}</Text>
            </View>
          ))}
          {loading ? <View className='tabs-loading'><View className='loading-spinner-md' /></View> : null}
        </View>
      </View>
      <ScrollView className='scroll-wrap' scrollY={!riskPickerVisible && !riskDetailModal.visible} enhanced showScrollbar={false}>
        {error && data ? <View className='analysis-error'><Text>{error}</Text></View> : null}
        {analysisPanel === 'health' && !hasEnoughHealthIndexData ? (
          <View className='stats-card health-index-gate-card'>
            <View className='health-index-gate-icon'>
              <Text className='iconfont icon-shangzhang health-index-gate-icon-text' />
            </View>
            <View className='health-index-gate-copy'>
              <Text className='health-index-gate-title'>记录至少 2 天后显示饮食参考分</Text>
              <Text className='health-index-gate-desc'>
                当前已记录 {recordedDays} 天。继续记录后，这里会展示饮食趋势和关注方向。
              </Text>
            </View>
          </View>
        ) : analysisPanel === 'health' ? (
          <>
            <View className='stats-card risk-overview-card'>
              <Image className='risk-overview-background' src={healthScoreForest} mode='aspectFill' aria-hidden />
              <View className='risk-overview-top'>
                <View className='risk-overview-copy'>
                  <View className='risk-overview-title-line'>
                    <Text className='risk-overview-title'>饮食综合分</Text>
                    <View className='stats-info-button' aria-role='button' aria-label='查看综合分依据' onClick={() => setOverviewExpanded(value => !value)}>
                      <Text className='iconfont icon-target' />
                    </View>
                  </View>
                </View>
                <View className='risk-overview-actions'>
                  <View className={`risk-overview-badge tone-${scoreToTone(focusOverallScore)}`}>
                    <Text className='risk-overview-badge-label'>{scoreToLabel(focusOverallScore)}</Text>
                  </View>
                </View>
              </View>

              <View className='risk-overview-compact-row'>
                <View className='risk-overview-score-column'>
                  <View className='risk-overview-score-row'>
                    <Text className='risk-overview-score'>{focusOverallScore}</Text>
                    <Text className='risk-overview-score-unit'>/ 100</Text>
                  </View>
                  <View className='risk-overview-scale' aria-hidden>
                    <View className='risk-overview-scale-track'>
                      <View className='risk-overview-scale-fill' style={{ width: `${clampPercent(focusOverallScore)}%` }} />
                    </View>
                    <View className='risk-overview-scale-labels'><Text>0</Text><Text>100</Text></View>
                  </View>
                </View>
                <View className='risk-overview-records'>
                  <Text className='risk-overview-record-days'>已记录 {recordedDays} 天</Text>
                  <Text className='risk-overview-record-caption'>基于可评分的记录</Text>
                </View>
              </View>
              {overviewExpanded ? <View className='risk-overview-expanded'>
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
                <Text className='risk-overview-estimate'>改善后的综合分估计：{focusOverallScore} → {focusProjectedScore}，不代表实际健康变化。</Text>
              </View> : null}
            </View>
          </>
        ) : null}

        {analysisPanel === 'health' && hasEnoughHealthIndexData ? (
          <>
        <View className='stats-card stats-actions-card'>
          <Text className='card-title'>优先调整</Text>
          {actionList.length > 0 ? (actionsExpanded ? actionList : actionList.slice(0, 2)).map((action, index) => {
            const separatorIndex = action.search(/[，。；,;]/)
            const emphasisEnd = separatorIndex > 0 ? separatorIndex + 1 : action.length
            return (
              <View className='stats-priority-item' key={`${index}-${action}`}>
                <Text className='stats-priority-number'>{index + 1}</Text>
                <View className='stats-priority-text'>
                  <Text className='stats-priority-headline'>{action.slice(0, emphasisEnd)}</Text>
                  {emphasisEnd < action.length ? <Text className='stats-priority-followup'>{action.slice(emphasisEnd)}</Text> : null}
                </View>
              </View>
            )
          }) : <Text className='stats-empty-copy'>暂无额外调整建议，继续记录即可。</Text>}
          {actionList.length > 2 ? <View className='stats-text-action' onClick={() => setActionsExpanded(value => !value)}><Text>{actionsExpanded ? '收起' : `展开全部 ${actionList.length} 项`}</Text><Text className='iconfont icon-right-arrow' /></View> : null}
          {d.diet_decision_basis ? <View className='stats-decision-actions'>
            <View className='stats-text-action' onClick={() => void showDietDecisionEvidence(d.diet_decision_basis!).catch(() => {})}><Text>查看依据</Text></View>
            <View className='stats-text-action' onClick={() => void Taro.switchTab({ url: '/pages/index/index' })}><Text>看看下一餐</Text><Text className='iconfont icon-right-arrow' /></View>
          </View> : null}
        </View>
        <View className='risk-section-header'>
          <Text className='risk-section-title'>我的关注</Text>
          <View
            className='risk-focus-edit-btn'
            onClick={(e) => {
              e.stopPropagation()
              setRiskPickerVisible(true)
            }}
          >
            <Text className='risk-focus-edit-text'>管理</Text>
          </View>
        </View>

        <View className='risk-card-grid'>
          {visibleRiskCards.map((card) => (
            <View
              key={card.key}
              className='stats-card risk-card'
              aria-role='button'
              aria-label={`查看${card.title}的饮食参考依据`}
              onClick={() => setRiskDetailModal({ visible: true, card })}
            >
              <View className='risk-card-icon-circle'><Text className={`iconfont icon-${riskCardIcon(card.key)} risk-card-icon`} /></View>
              <View className='risk-card-copy'>
              <Text className='risk-card-title'>{card.title}</Text>
              {card.is_custom ? (
                <View className='risk-card-ai-badge-row'>
                  <Text className='risk-card-ai-badge'>{card.score_available === false ? '支持建议' : '支持参考'}</Text>
                  <Text className='risk-card-ai-confidence'>{customFocusConfidenceLabel(card.confidence)}</Text>
                  {customFocusRefreshingKey === card.key ? (
                    <Text className='iconfont icon-jiazaixiao risk-card-ai-refresh-spinner' />
                  ) : card.needs_refresh ? (
                    <Text className='risk-card-ai-refresh-hint'>待更新</Text>
                  ) : null}
                </View>
              ) : null}
              <Text className='risk-card-summary'>{card.brief}</Text>
              </View>
              <View className={`risk-card-score-wrap tone-${hasRiskScore(card) ? scoreToTone(card.score) : 'pending'}`}>
                <Text className='risk-card-score'>{hasRiskScore(card) ? card.score : '—'}</Text>
                {hasRiskScore(card) ? <Text className='risk-card-score-unit'>分</Text> : null}
              </View>
              <Text className='iconfont icon-right-arrow risk-card-chevron' />
            </View>
          ))}
        </View>
        {visibleRiskCards.length === 0 ? (
          <View className='risk-focus-empty' onClick={() => setRiskPickerVisible(true)}><Text>选择你想关注的方向</Text><Text className='iconfont icon-right-arrow' /></View>
        ) : null}

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
                  <Text className='risk-focus-modal-count-text'>显示 {selectedRiskItems.length} 项</Text>
                </View>
              </View>
              <ScrollView className='risk-focus-options-scroll' scrollY showScrollbar={false}>
              <View className='risk-picker-grid risk-picker-grid--modal'>
                {orderedRiskOptions.map((item) => {
                  const active = selectedRiskKeys.includes(item.key)
                  const focusId = isCustomRiskKey(item.key) ? item.key.replace(/^custom:/, '') : ''
                  return (
                    <View key={item.key} className={`risk-picker-chip ${active ? 'active' : ''} ${item.is_custom ? 'is-custom' : ''}`}>
                      <View className='risk-picker-option-toggle' aria-role='button' aria-label={`${item.title}${active ? '，已显示' : '，已隐藏'}`} onClick={() => toggleRiskPreference(item.key)}>
                        <View className='risk-picker-checkbox' style={{ pointerEvents: 'none' }}><Checkbox value={item.key} checked={active} color='#214f3c' /></View>
                        <Text className='risk-picker-chip__title'>{item.title}</Text>
                      </View>
                      {item.is_custom ? <View className='risk-picker-chip__remove' aria-role='button' aria-label={`永久移除${item.title}`} onClick={() => { if (focusId) confirmRemoveCustomFocus(focusId, item.title) }}><Text>移除</Text></View> : null}
                    </View>
                  )
                })}
              </View>
              <View className='stats-custom-focus-toggle' onClick={() => setCustomFocusFormVisible(value => !value)}><Text>新增自定义关注</Text>{customFocusFormVisible ? <IconCollapse size={20} color='#718078' /> : <IconExpand size={20} color='#718078' />}</View>
              {customFocusFormVisible ? <>
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
                  {customFocusAdding ? (
                    <Text className='iconfont icon-jiazaixiao risk-custom-focus-add-spinner' />
                  ) : (
                    <Text className='risk-custom-focus-add-btn-text'>{`添加 · ${customFocusCost} 积分`}</Text>
                  )}
                </View>
              </View>
              {customFocusMeta ? (
                <Text className='risk-custom-focus-meta'>
                  自定义关注 {addedCustomFocusCount}/{customFocusMeta.max_focuses} 个 · 今日可生成 {customFocusMeta.remaining_today}/{customFocusMeta.daily_limit} 次
                </Text>
              ) : null}
              </> : null}
              </ScrollView>
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
                    <Text className='risk-detail-ai-badge'>{riskDetailModal.card.score_available === false ? '支持建议' : '支持参考'}</Text>
                  ) : null}
                </View>
                <View className='risk-detail-score-row'>
                  <Text className='risk-detail-score'>{hasRiskScore(riskDetailModal.card) ? riskDetailModal.card.score : '—'}</Text>
                  {hasRiskScore(riskDetailModal.card) ? <>
                  <Text className='risk-detail-score-unit'>分</Text>
                  <View className={`risk-detail-badge tone-${riskDetailModal.card.tone}`}>
                    <Text className='risk-detail-badge-text'>{scoreToLabel(riskDetailModal.card.score)}</Text>
                  </View>
                  </> : null}
                </View>
              </View>
              <ScrollView className='risk-detail-body' scrollY showScrollbar={false}>
                {riskDetailModal.card.action ? <View className='risk-detail-priority'><Text className='risk-detail-section-label'>可以先这样调整</Text><Text className='risk-detail-section-text'>{riskDetailModal.card.action}</Text></View> : null}
                {riskDetailModal.card.is_custom ? (
                  <>
                    <Text className='risk-detail-ai-disclaimer'>
                      基于饮食与记录证据的支持度，不代表真实力量、皮肤状态或医学诊断。
                    </Text>
                    <View className='risk-detail-meta-row'>
                      <Text className={`risk-detail-confidence is-${riskDetailModal.card.confidence || 'unknown'}`}>
                        {customFocusConfidenceLabel(riskDetailModal.card.confidence)}
                      </Text>
                      {customFocusScoreChangeLabel(riskDetailModal.card.score_change) ? (
                        <Text className='risk-detail-score-change'>{customFocusScoreChangeLabel(riskDetailModal.card.score_change)}</Text>
                      ) : null}
                    </View>
                  </>
                ) : null}
                {riskDetailModal.card.summary ? <Text className='risk-detail-section-text'>{riskDetailModal.card.summary}</Text> : null}
                {riskDetailModal.card.is_custom && riskDetailModal.card.score_reason ? (
                  <>
                    <View className='risk-detail-divider' />
                    <Text className='risk-detail-section-label'>评分方法</Text>
                    <Text className='risk-detail-section-text'>{riskDetailModal.card.score_reason}</Text>
                  </>
                ) : null}
                {riskDetailModal.card.is_custom && riskDetailModal.card.change_reason ? (
                  <>
                    <View className='risk-detail-divider' />
                    <Text className='risk-detail-section-label'>与上次相比</Text>
                    <Text className='risk-detail-section-text'>{riskDetailModal.card.change_reason}</Text>
                  </>
                ) : null}
                {riskDetailModal.card.basis ? <>
                <View className='risk-detail-divider' />
                <Text className='risk-detail-section-label'>判断依据</Text>
                <Text className='risk-detail-section-text'>{riskDetailModal.card.basis}</Text>
                </> : null}
                {riskDetailModal.card.is_custom && (riskDetailModal.card.evidence?.length || 0) > 0 ? (
                  <View className='risk-detail-evidence-list'>
                    {riskDetailModal.card.evidence!.map(item => (
                      <View key={item} className='risk-detail-evidence-item'>
                        <Text className='risk-detail-evidence-bullet'>•</Text>
                        <Text className='risk-detail-evidence-text'>{item}</Text>
                      </View>
                    ))}
                  </View>
                ) : null}
                {riskDetailModal.card.is_custom && (riskDetailModal.card.missing_evidence?.length || 0) > 0 ? (
                  <>
                    <View className='risk-detail-divider' />
                    <Text className='risk-detail-section-label'>还缺哪些证据</Text>
                    <Text className='risk-detail-section-text'>{riskDetailModal.card.missing_evidence!.join('、')}</Text>
                  </>
                ) : null}
                {hasRiskScore(riskDetailModal.card) && !riskDetailModal.card.is_custom ? <View className='risk-detail-delta'>
                  <Text className='risk-detail-delta-text'>饮食参考分预计可提升 {riskDetailModal.card.delta} 分，并非实际健康结果。</Text>
                </View> : null}
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
                      {customFocusRefreshingKey === riskDetailModal.card.key ? (
                        <Text className='iconfont icon-jiazaixiao risk-detail-refresh-spinner' />
                      ) : `更新 · ${customFocusCost} 积分`}
                    </Text>
                  </View>
                ) : null}
              </ScrollView>
              <View
                className='risk-detail-close-btn'
                onClick={() => setRiskDetailModal({ visible: false, card: null })}
              >
                <Text className='risk-detail-close-text'>关闭</Text>
              </View>
            </View>
          </View>
        )}

        {topIssues.length > 0 ? <View className='stats-card stats-issues-card'>
          <View className='card-header card-header--collapsible' onClick={() => setIssuesExpanded(value => !value)}><Text className='card-title'>记录中值得留意的地方</Text>{issuesExpanded ? <IconCollapse size={20} color='#718078' /> : <IconExpand size={20} color='#718078' />}</View>
          {issuesExpanded ? topIssues.map((issue, index) => <View key={`${index}-${issue.title}`} className='stats-issue-item'><Text className='stats-issue-title'>{issue.title}</Text><Text className='stats-issue-detail'>{issue.detail}</Text></View>) : null}
        </View> : null}

          </>
        ) : null}

        {analysisPanel === 'nutrition' ? (
          <>
        <View className='stats-card ai-insight-card'>
          <View className='ai-insight-card-top'>
            <View className='ai-insight-card-title-wrap'>
              <Text className='ai-insight-card-title'>本{range === 'week' ? '周' : '月'}饮食解读</Text>
            </View>
          </View>
          <View className='ai-insight-card-body'>
            {canUseStatsInsight && insightGeneratedDate ? (
              <View className={`analysis-status${insightNeedsRefresh ? ' warning' : ''}`}>
                <View className='analysis-status-copy'>
                  <Text className='analysis-status-text'>
                    更新于 {insightGeneratedDate}
                  </Text>
                  {insightNeedsRefresh ? <Text className='analysis-status-new'>有新记录</Text> : null}
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
                      <Text className='analysis-status-action-text'>更新 · 1积分</Text>
                    )}
                  </View>
                ) : (
                  <View className='analysis-status-action is-disabled'>
                    <Text className='analysis-status-action-text'>今日已用完</Text>
                  </View>
                )}
              </View>
            ) : null}
            {canUseStatsInsight ? <Text className='analysis-quota'>今日剩余 {insightRemainingToday}/{insightDailyLimit} 次</Text> : null}
            {insightError ? (
              <View className='analysis-error'>
                <Text className='analysis-error-text'>{insightError}</Text>
              </View>
            ) : null}
            {!canUseStatsInsight ? (
              <View className='analysis-empty analysis-empty--gate'>
                <Text className='analysis-empty-title'>记录一餐，开始了解自己的饮食</Text>
                <Text className='analysis-empty-text'>本周期还没有饮食记录，暂时无法生成解读。</Text>
              </View>
            ) : displayInsightText ? (
              <>
                <View className={`analysis-report ${insightCanExpand && !insightExpanded ? 'is-collapsed' : ''}`}>
                  <View className='analysis-content'>{renderInsightMarkdown(displayInsightText)}</View>
                </View>
                {insightCanExpand ? <View className='stats-text-action analysis-report-toggle' aria-role='button' aria-label={insightExpanded ? '收起完整解读' : '展开完整解读'} onClick={() => setInsightExpanded(value => !value)}><Text>{insightExpanded ? '收起' : '展开全文'}</Text>{insightExpanded ? <IconCollapse size={20} color='#718078' /> : <IconExpand size={20} color='#718078' />}</View> : null}
              </>
            ) : !insightActionLoading ? (
              <View className='analysis-empty'>
                <Text className='analysis-empty-title'>还没有本{range === 'week' ? '周' : '月'}解读</Text>
                <Text className='analysis-empty-text'>需要时手动生成，之后可随时查看。</Text>
                <View
                  className={`analysis-empty-action${!canGenerateInsight ? ' is-disabled' : ''}`}
                  onClick={() => { if (canGenerateInsight) handleGenerateInsight() }}
                >
                  <Text className='analysis-empty-action-text'>{canGenerateInsight ? '生成解读 · 1积分' : '今日生成次数已用完'}</Text>
                </View>
              </View>
            ) : null}
            {insightActionLoading ? (
              <View className='analysis-loading-card'>
                <View className='analysis-loading-card-header'>
                  <Text className='iconfont icon-jiazaixiao analysis-loading-card-icon' />
                </View>
                <View className='analysis-skeleton-group'>
                  <View className='analysis-skeleton-line w-92' />
                  <View className='analysis-skeleton-line w-100' />
                  <View className='analysis-skeleton-line w-86' />
                  <View className='analysis-skeleton-line w-96' />
                  <View className='analysis-skeleton-line w-70' />
                </View>
              </View>
            ) : null}
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
                <Text className='card-title'>热量摄入 <Text className='stats-unit'>(kcal)</Text></Text>
                <Text className='card-subtitle'>{range === 'week' ? '最近 7 天' : '近一个月统计 · 图示最近 14 天'}</Text>
              </View>
            </View>
            <View className='card-header-actions'>
              {expandedSections.calories ? <View className='chart-switch-wrap' onClick={(e) => e.stopPropagation()}>
                <Text className='chart-switch-label'>数值</Text>
                <Switch
                  className='chart-switch'
                  checked={showCalories}
                  color='#5cb896'
                  onChange={(event) => setShowCalories(event.detail.value)}
                />
              </View> : null}
              <View className='card-header-arrow'>{expandedSections.calories ? <IconCollapse size={24} color='#94a3b8' /> : <IconExpand size={24} color='#94a3b8' />}</View>
            </View>
          </View>
          {expandedSections.calories ? (
            <View className='card-collapsible-content'>
              {chartDays.length > 0 ? (
                <View className='bar-chart-container'>
                  {tdee > 0 ? <View className='calorie-reference-line' style={{ bottom: `${44 + clampPercent(tdee / maxDailyCalories * 100) * 2.6}rpx` }}><Text>参考消耗 {Math.round(tdee)}</Text></View> : null}
                  {chartDays.map((item) => {
                    const heightPct = clampPercent(toSafeNumber(item.calories) / maxDailyCalories * 100)
                    return (
                      <View key={item.date} className='chart-col'>
                        {showCalories ? (
                          <Text className='bar-calorie-text'>{item.calories > 0 ? Math.round(item.calories) : '—'}</Text>
                        ) : null}
                        <View className='bar-wrapper'>
                          {item.target && <View className='nutrition-plan-chart-target' style={{ bottom: `${clampPercent(toSafeNumber(item.target.snapshot.targets.calorie_target) / maxDailyCalories * 100)}%` }} />}
                          <View
                            className={`bar-fill ${item.calories > tdee ? 'over' : ''}`}
                            style={{ height: `${heightPct}%` }}
                          />
                          {item.calories <= 0 ? <Text className='stats-chart-no-data'>—</Text> : null}
                        </View>
                        <Text className='bar-label'>{range === 'week' ? item.date.slice(5) : item.date.slice(8)}</Text>
                      </View>
                    )
                  })}
                </View>
              ) : (
                <View className='chart-empty-state'>
                  <Text className='empty-text'>暂无数据</Text>
                </View>
              )}
              <Text className='stats-chart-note'>{chartDays[0]?.date.slice(5)} — {chartDays[chartDays.length - 1]?.date.slice(5)} · 横线表示无摄入数据；参考消耗为估算值。</Text>
              {d.recorded_target_totals && <Text className='stats-chart-note'>绿短线为每日饮食目标；仅有记录的 {d.recorded_days} 天：摄入 {Math.round(d.total_calories)} / 计划 {Math.round(d.recorded_target_totals.calorie_target || 0)} kcal。{chartDays.some(item => item.target?.historical_reference) ? '部分旧日期使用参考目标。' : ''}</Text>}
            </View>
          ) : null}
        </View>

        <View className='stats-card macro-card evidence-card'>
          <View className='card-header card-header--collapsible' onClick={() => toggleSection('macro')}>
            <Text className='iconfont icon-tianpingzuo chart-title-icon' />
            <View className='card-header-copy stats-inline-heading'>
              <Text className='card-title'>营养构成</Text>
              <Text className='card-subtitle'>本{range === 'week' ? '周' : '月'}累计 · 能量占比</Text>
            </View>
            <View className='card-header-arrow'>{expandedSections.macro ? <IconCollapse size={24} color='#94a3b8' /> : <IconExpand size={24} color='#94a3b8' />}</View>
          </View>
          {expandedSections.macro ? (
            <View className='card-collapsible-content'>
              <View className='macro-list'>
                <View className='macro-row stats-macro-row'>
                  <Text className='macro-name'>蛋白质</Text>
                  <View className='progress-track'>
                    <View className='progress-fill protein' style={{ width: `${clampPercent(macroPercent.protein)}%` }}></View>
                  </View>
                  <Text className='stats-macro-grams'>{totalProtein.toFixed(0)}g</Text>
                  <Text className='stats-macro-percent'>{macroPercent.protein}%</Text>
                </View>

                <View className='macro-row stats-macro-row'>
                  <Text className='macro-name'>碳水</Text>
                  <View className='progress-track'>
                    <View className='progress-fill carbs' style={{ width: `${clampPercent(macroPercent.carbs)}%` }}></View>
                  </View>
                  <Text className='stats-macro-grams'>{totalCarbs.toFixed(0)}g</Text>
                  <Text className='stats-macro-percent'>{macroPercent.carbs}%</Text>
                </View>

                <View className='macro-row stats-macro-row'>
                  <Text className='macro-name'>脂肪</Text>
                  <View className='progress-track'>
                    <View className='progress-fill fat' style={{ width: `${clampPercent(macroPercent.fat)}%` }}></View>
                  </View>
                  <Text className='stats-macro-grams'>{totalFat.toFixed(0)}g</Text>
                  <Text className='stats-macro-percent'>{macroPercent.fat}%</Text>
                </View>
              </View>
            </View>
          ) : null}
        </View>

        <View className='stats-card meal-structure-card evidence-card'>
          <View className='card-header card-header--collapsible' onClick={() => toggleSection('meals')}>
            <Text className='iconfont icon-canciguanli chart-title-icon' />
            <View className='card-header-copy'>
              <Text className='card-title'>餐次分布</Text>
              <Text className='card-subtitle'>本周期热量占比</Text>
            </View>
            {expandedSections.meals ? <View
              className='stats-meal-value-toggle'
              aria-role='button'
              aria-label={mealValuesInCalories ? '切换显示餐次热量占比' : '切换显示餐次摄入热量'}
              onClick={(event) => { event.stopPropagation(); setMealValuesInCalories(value => !value) }}
            ><Text>{mealValuesInCalories ? '看占比' : '看热量'}</Text></View> : null}
            <View className='card-header-arrow'>{expandedSections.meals ? <IconCollapse size={24} color='#94a3b8' /> : <IconExpand size={24} color='#94a3b8' />}</View>
          </View>
          {expandedSections.meals ? (
            <View className='card-collapsible-content'>
              <View className='stats-meal-list'>
                {(['breakfast', 'morning_snack', 'lunch', 'afternoon_snack', 'dinner', 'evening_snack'] as const).map((key) => {
                  const cal = byMeal[key]
                  const pct = totalCalories > 0 ? (cal / totalCalories) * 100 : 0
                  return (
                    <View key={key} className={`stats-meal-row ${mealValuesInCalories ? 'shows-calories' : ''}`}>
                      <Text className='stats-meal-name'>{MEAL_NAMES[key]}</Text>
                      <View className='progress-track'><View className='progress-fill' style={{ width: `${clampPercent(pct)}%` }} /></View>
                      <Text className='stats-meal-percent'>{mealValuesInCalories ? `${Math.round(cal)} kcal` : totalCalories > 0 ? `${pct.toFixed(1)}%` : '—'}</Text>
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
              <Text className='card-title'>体重与喝水</Text>
              <Text className='card-subtitle'>体重最近 {range === 'week' ? '7' : '10'} 次 · 饮水最近 {range === 'week' ? '7' : '14'} 天</Text>
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
                    {waterRecordedDays > 0 ? (
                    <Text className='body-metric-main'>
                      {avgDailyWaterMl.toFixed(0)} ml
                    </Text>
                    ) : <Text className='body-metric-empty'>暂无喝水记录</Text>}
                  </View>
                  <Text className='body-metric-sub'>
                    {waterRecordedDays > 0 ? `日均 ${avgDailyWaterMl.toFixed(0)} ml，目标 ${waterGoalMl} ml，累计 ${totalWaterMl.toFixed(0)} ml` : `饮水目标 ${waterGoalMl} ml`}
                  </Text>
                  {waterRecordedDays > 0 && waterTrend.length > 0 ? (
                    <View className='water-trend-chart'>
                      {waterTrend.map((item) => {
                        const pct = maxWaterValue > 0 ? clampPercent(toSafeNumber(item.total) / maxWaterValue * 100) : 0
                        return (
                          <View key={item.date} className='water-trend-col'>
                            <View className='water-trend-bar-wrap'>
                              <View className='water-trend-bar' style={{ height: `${pct}%` }} />
                              {toSafeNumber(item.total) <= 0 ? <Text className='stats-chart-no-data'>—</Text> : null}
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

        <View className='stats-page-disclaimer'>
          <Text className='stats-page-disclaimer__text'>结果仅供参考，不代替医学判断</Text>
        </View>
      </ScrollView>
    </View>
  )
}

export default withAuth(StatsPage, { public: true })
