import { View, Text, Input, Image, Canvas, PageMeta, Swiper, SwiperItem } from '@tarojs/components'
import rewardPointsBannerBg from '../../assets/home-handbook/reward-points.jpg'
import feedbackBannerBg from '../../assets/home-handbook/feedback.jpg'
import wellnessFoodScanBannerBg from '../../assets/wellness/food-scan-banner.jpg'
import wellnessSolarTermBg from '../../assets/wellness/solar-term-autumn.jpg'
import { CAFETERIA_HERO_BG_URL, GOOSE_DUCK_CHICKEN_BG_URL } from '../../utils/static-asset-cdn-url'
import React from 'react'
import Taro, { useDidHide, useDidShow, useShareAppMessage, useShareTimeline } from '@tarojs/taro'
import { Empty, Button } from '@taroify/core'
import {
  getHomeDashboard,
  getStatsSummary,
  getAccessToken,
  updateDashboardTargets,
  getBodyMetricsSummary,
  getExerciseLogs,
  getShareQrEnvVersion,
  getUnlimitedQRCode,
  getFriendInviteProfile,
  getHealthProfile,
  getSharedFoodRecord,
  getFoodRecordById,
  getPetSummary,
  claimPetEvent,
  getMyMembership,
  getRewardCenter,
  saveBodyWeightRecord,
  addBodyWaterLog,
  resetBodyWaterLogs,
  mapCalendarDateToApi,
  resolveHomeMealPrimaryRecordId,
  deleteFoodRecord,
  createUserRecipe,
  getFoodExpiryDashboard,
  generateDietRecommendation,
  type DashboardTargets,
  type DashboardTargetsUpdateInput,
  type DietRecommendationResult,
  type DietRecommendationScene,
  type HomeAchievement,
  type HomeIntakeData,
  type HomeMealItem,
  type HomeNutritionTarget,
  type HomeTargetCalibrationSuggestion,
  type PetSummary,
  type PetProfile,
  type BodyMetricWeightEntry,
  type BodyMetricWaterDay,
  type HomeFoodExpiryItem,
  type HomeFoodExpirySummary,
  type FoodRecord,
  type MembershipStatus,
  type RewardCenterResponse,
  type RewardCenterTask,
  type StatsSummary,
  getCachedMealFullRecord,
  showUnifiedApiError
} from '../../utils/api'
import {
  drawDailySummaryPoster,
  computeDailySummaryPosterHeight,
  DAILY_SUMMARY_POSTER_MAX_HEIGHT,
  POSTER_WIDTH,
  type DailySummaryPosterInput
} from '../../utils/poster'
import { isShowShareImageMenuCancel } from '../../utils/weapp-share-image'
import { resolveCanvasImageSrc } from '../../utils/weapp-canvas-image'
import { claimSharePosterRewardQuietly } from '../../utils/share-reward'

import { IconBreakfast, IconLunch, IconDinner, IconSnack, IconWaterDrop } from '../../components/iconfont'
import { FOOD_EXPIRY_CHANGED_EVENT } from '../../utils/food-expiry-events'
import {
  HOME_DASHBOARD_REFRESH_EVENT,
  HOME_INTAKE_DATA_CHANGED_EVENT,
  COMMUNITY_FEED_CHANGED_EVENT,
  HOME_DASHBOARD_CACHE_TTL_MS
} from '../../utils/home-events'
import { HOME_RECORD_MENU_FLAG_KEY, consumeHomeRecordMenuDate } from '../../utils/home-record-menu'
import {
  DEFAULT_EXPIRY_SUMMARY,
  getStoredHomeDashboardSnapshots,
  getStoredHomeDashboardSnapshotByDate,
  saveHomeDashboardSnapshot,
  type HomeDashboardLocalSnapshot
} from '../../utils/home-dashboard-local-cache'

import './index.scss'
import { withAuth, redirectToLogin } from '../../utils/withAuth'
import { extraPkgUrl } from '../../utils/subpackage-extra'
import { collectFoodDisplayImageUrls, hasFoodDisplayImage } from '../../utils/food-display-image'
import { isAllowedRecordDate, isTodayRecordDate } from '../../utils/record-date'
import { getMembershipCreditSummary, LOW_CREDIT_REWARD_HINT_THRESHOLD } from '../../utils/membership'
import { useAppColorScheme } from '../../components/AppColorSchemeContext'

// 导入拆分出的模块
import { type WeightRecordEntry, type BodyMetricsStorage, type WaterRecord, type MacroKey, type WeekHeatmapState, type WeekHeatmapCell, type TargetFormState, type MacroTargets } from './types'
import {
  DEFAULT_INTAKE,
  WEIGHT_HISTORY_LIMIT,
  QUICK_WATER_AMOUNTS,
  WATER_GOAL_DEFAULT,
  SHORT_DAY_NAMES,
  HOME_WARNING_RED
} from './utils/constants'
import { formatDisplayNumber, formatNumberWithComma, formatDateKey, createTargetForm, createWeekHeatmapCells } from './utils/helpers'
import { useAnimatedNumber, useAnimatedProgress } from './hooks'
import { TargetEditor, GreetingSection, DateSelector, StatsEntry, RecordMenu, MealActionSheet, MealRecordsDialog, MealRecordEditModal, MealRecordPosterModal, DietRecommendationSheet, MicrosSection, type MealPosterSharePayload } from './components'
import OnboardingGuide from '../../components/OnboardingGuide'
import { PetAvatar } from '../../components/PetAvatar'
import { isHealthProfileReminderSnoozed, snoozeHealthProfileReminder } from '../../utils/health-profile-reminder'
import {
  ONBOARDING_HOME_RECORD_GUIDE_KEY,
  consumeHomeRecordGuideAfterOnboarding,
  shouldOfferOnboardingGuide,
} from '../../utils/onboarding-guide-storage'
import { HOME_RECORD_ONBOARDING_STEPS } from './home-onboarding-steps'
import { HOME_PET_PROFILE_CHANGED_EVENT } from '../../utils/pet-events'
import { buildFoodRecordFavoriteDraft } from '../../utils/food-record-flow'

const BACKFILL_HINT_DISMISSED_DATES_KEY = 'home_backfill_hint_dismissed_dates_v1'
const HOME_SELECTED_DATE_KEY = 'home_selected_date_v1'
const HOME_PET_COLLAPSED_KEY = 'home_pet_companion_collapsed_v4'
const HOME_PET_FLOAT_POSITION_KEY = 'home_pet_companion_float_position_v4'
const HOME_PET_HIDDEN_KEY = 'home_pet_companion_hidden_v1'
const HOME_PET_HIDDEN_CHANGED_EVENT = 'home_pet_companion_hidden_changed'
const HOME_MODE_STORAGE_KEY = 'home_display_mode_v1'
const CANVAS_ICON_FONT_SOURCE = __ICON_CDN_BASE_URL__
  ? `url("${__ICON_CDN_BASE_URL__.replace(/\/+$/, '')}/iconfont.ttf")`
  : ''

type HomeDisplayMode = 'balanced' | 'wellness'

function getStoredHomeDisplayMode(): HomeDisplayMode {
  try {
    return Taro.getStorageSync(HOME_MODE_STORAGE_KEY) === 'wellness' ? 'wellness' : 'balanced'
  } catch (_) {
    return 'balanced'
  }
}

function saveHomeDisplayMode(mode: HomeDisplayMode) {
  try {
    Taro.setStorageSync(HOME_MODE_STORAGE_KEY, mode)
  } catch (_) {}
}

function isValidHomeDate(date?: string): date is string {
  return typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)
}

function saveLastHomeSelectedDate(date: string) {
  if (!isValidHomeDate(date)) return
  try {
    Taro.setStorageSync(HOME_SELECTED_DATE_KEY, date)
  } catch (_) {}
}

function getLastHomeSelectedDate(fallback: string): string {
  try {
    const stored = Taro.getStorageSync(HOME_SELECTED_DATE_KEY)
    if (isValidHomeDate(stored)) return stored
  } catch (_) {}
  return isValidHomeDate(fallback) ? fallback : formatDateKey(new Date())
}

function getTodayLocalDateKey(): string {
  return formatDateKey(new Date())
}

function isRewardTaskAvailable(task: RewardCenterTask): boolean {
  if (!task.action_path) return false
  if (typeof task.daily_limit === 'number' && task.daily_limit > 0) {
    return task.today_count < task.daily_limit
  }
  return true
}

function getAvailableRewardCredits(data: RewardCenterResponse | null): number {
  if (!data) return 0
  return (data.tasks || [])
    .filter(isRewardTaskAvailable)
    .reduce((sum, task) => sum + Math.max(Number(task.reward_amount || 0), 0), 0)
}

function formatRewardHintTaskText(tasks: RewardCenterTask[]): string {
  const labels = tasks
    .filter(isRewardTaskAvailable)
    .slice(0, 2)
    .map(task => `${task.name.replace(/^每日/, '')} +${task.reward_amount}`)
  return labels.length > 0 ? labels.join(' · ') : '完成任务即可补充奖励积分'
}

/** 与记录详情页海报一致：邀请码用于小程序码 scene */
function getInviteCodeFromUserId(userId: string): string {
  const raw = (userId || '').replace(/-/g, '').toLowerCase()
  return raw.length >= 8 ? raw.slice(0, 8) : ''
}

/** 海报顶栏：月日一行 */
function formatPosterDatePrimary(dateKey: string): string {
  const parts = dateKey.split('-').map(Number)
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) {
    return dateKey
  }
  const [_y, m, d] = parts
  return `${m}月${d}日`
}

/** 海报顶栏：星期一行 */
function formatPosterWeekdayLabel(dateKey: string): string {
  const parts = dateKey.split('-').map(Number)
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) {
    return ''
  }
  const [y, m, d] = parts
  const dt = new Date(y, m - 1, d)
  return `周${SHORT_DAY_NAMES[dt.getDay()] ?? '—'}`
}

// 与后端/统计周对齐：真实日历为 2026 时，仅在与「可能带错年」的接口字段比对时做归一
function normalizeTo2025(dateStr: string): string {
  return dateStr.replace(/^2026-/, '2025-')
}

/** 升级后把本机仍用 2025-xx-xx 存的「今天」喝水/体重键迁到真实年，避免与云端 2026 不一致 */
function migrateLegacy2025BodyMetricKeys(metrics: BodyMetricsStorage): BodyMetricsStorage {
  const today = formatDateKey(new Date())
  if (!today.startsWith('2026-')) return metrics
  const legacy = today.replace(/^2026-/, '2025-')
  if (legacy === today) return metrics
  const nextWater = { ...metrics.waterByDate }
  if (nextWater[legacy]) {
    nextWater[today] = nextWater[legacy]
    delete nextWater[legacy]
  }
  const nextWeight = metrics.weightEntries.map((e) =>
    e.date === legacy ? { ...e, date: today } : e
  )
  const next = { ...metrics, waterByDate: nextWater, weightEntries: nextWeight }
  if (JSON.stringify(next) !== JSON.stringify(metrics)) {
    saveBodyMetrics(next)
  }
  return next
}

function buildWeekHeatmapCellsFromStorage(): WeekHeatmapCell[] {
  const today = new Date()
  const cells: WeekHeatmapCell[] = []
  for (let offset = -3; offset <= 3; offset++) {
    const date = new Date(today)
    date.setDate(today.getDate() + offset)
    const dateKey = formatDateKey(date)
    const snap = getStoredHomeDashboardSnapshotByDate(dateKey)
    // 兼容升级前写入的不完整首页缓存，避免旧快照缺少 intakeData 时阻断整页渲染。
    const storedCalories = Number(snap?.intakeData?.current)
    const storedTarget = Number(snap?.intakeData?.target)
    const calories = Number.isFinite(storedCalories) ? storedCalories : 0
    const target = Number.isFinite(storedTarget) && storedTarget > 0 ? storedTarget : 2000
    const hasRecord = calories > 0 || Boolean(snap?.meals?.length)
    cells.push({
      date: dateKey,
      dayName: SHORT_DAY_NAMES[date.getDay()],
      dayNum: String(date.getDate()),
      calories,
      target,
      intakeRatio: hasRecord ? calories / target : 0,
      state: !hasRecord ? 'none' : calories > target ? 'surplus' : 'deficit',
      isToday: offset === 0,
      hasRecord
    })
  }
  return cells
}

function createCalendarHeatmapCell(
  dateKey: string,
  caloriesRaw: unknown,
  targetRaw: unknown,
  hasMealRecord = false
): WeekHeatmapCell {
  const dateParts = dateKey.split('-').map(Number)
  const date = new Date(dateParts[0], dateParts[1] - 1, dateParts[2])
  const caloriesValue = Number(caloriesRaw)
  const targetValue = Number(targetRaw)
  const calories = Number.isFinite(caloriesValue) ? caloriesValue : 0
  const target = Number.isFinite(targetValue) && targetValue > 0 ? targetValue : 2000
  const hasRecord = calories > 0 || hasMealRecord
  return {
    date: dateKey,
    dayName: SHORT_DAY_NAMES[date.getDay()],
    dayNum: String(date.getDate()),
    calories,
    target,
    intakeRatio: hasRecord ? calories / target : 0,
    state: !hasRecord ? 'none' : calories > target ? 'surplus' : 'deficit',
    isToday: dateKey === formatDateKey(new Date()),
    hasRecord,
  }
}

function buildCalendarHeatmapCellsFromStorage(stats?: StatsSummary | null): WeekHeatmapCell[] {
  const byDate = new Map<string, WeekHeatmapCell>()
  stats?.daily_calories?.forEach((day) => {
    byDate.set(day.date, createCalendarHeatmapCell(day.date, day.calories, stats.tdee, day.calories > 0))
  })
  getStoredHomeDashboardSnapshots().forEach((snapshot) => {
    byDate.set(snapshot.date, createCalendarHeatmapCell(
      snapshot.date,
      snapshot.intakeData?.current,
      snapshot.intakeData?.target,
      Boolean(snapshot.meals?.length)
    ))
  })
  return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date))
}

function parseCompleteNumber(value: string): number | null {
  const normalized = value.trim()
  if (!normalized || !/^\d+(\.\d+)?$/.test(normalized)) {
    return null
  }
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : null
}

function sanitizeTargetInput(value: string): string {
  const cleaned = value.replace(/[^\d.]/g, '')
  if (!cleaned) return ''

  const dotIndex = cleaned.indexOf('.')
  if (dotIndex === -1) {
    return cleaned.replace(/^0+(?=\d)/, '')
  }

  const integerPartRaw = cleaned.slice(0, dotIndex).replace(/\./g, '')
  const decimalPart = cleaned.slice(dotIndex + 1).replace(/\./g, '').slice(0, 1)
  const integerPart = integerPartRaw ? integerPartRaw.replace(/^0+(?=\d)/, '') : '0'

  return decimalPart ? `${integerPart}.${decimalPart}` : `${integerPart}.`
}

function roundTargetValue(value: number): number {
  return Math.max(0, Math.round((value + Number.EPSILON) * 10) / 10)
}

function formatTargetInput(value: number): string {
  const rounded = roundTargetValue(value)
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)
}

function parseMacroTargets(form: TargetFormState): MacroTargets | null {
  const protein = parseCompleteNumber(form.proteinTarget)
  const carbs = parseCompleteNumber(form.carbsTarget)
  const fat = parseCompleteNumber(form.fatTarget)

  if (protein == null || carbs == null || fat == null) {
    return null
  }

  return { protein, carbs, fat }
}

function calcCaloriesFromMacros(macros: MacroTargets): number {
  return macros.protein * 4 + macros.carbs * 4 + macros.fat * 9
}

function scaleMacrosByCalorieTarget(nextCalorie: number, baseMacros: MacroTargets): MacroTargets {
  const baseCalories = calcCaloriesFromMacros(baseMacros)

  if (baseCalories <= 0) {
    const protein = (nextCalorie * 0.3) / 4
    const carbs = (nextCalorie * 0.4) / 4
    const fat = (nextCalorie * 0.3) / 9
    return { protein, carbs, fat }
  }

  const ratio = nextCalorie / baseCalories
  return {
    protein: baseMacros.protein * ratio,
    carbs: baseMacros.carbs * ratio,
    fat: baseMacros.fat * ratio
  }
}

function getMacroTargetsFromIntake(intake: HomeIntakeData): MacroTargets {
  return {
    protein: roundTargetValue(intake.macros.protein.target),
    carbs: roundTargetValue(intake.macros.carbs.target),
    fat: roundTargetValue(intake.macros.fat.target)
  }
}

function getStoredPetCollapsed(): boolean {
  try {
    return Taro.getStorageSync(HOME_PET_COLLAPSED_KEY) === '1'
  } catch (_) {
    return false
  }
}

function getStoredPetHidden(): boolean {
  try {
    return Taro.getStorageSync(HOME_PET_HIDDEN_KEY) === '1'
  } catch (_) {
    return false
  }
}

function getPetFloatMetrics(collapsed: boolean) {
  const info = Taro.getSystemInfoSync()
  const rpx = info.windowWidth / 750
  let menuBottom = 0
  try {
    const menuRect = (Taro as any).getMenuButtonBoundingClientRect?.()
    menuBottom = Number(menuRect?.bottom || 0)
  } catch (_) {}
  const width = (collapsed ? 160 : 360) * rpx
  const height = (collapsed ? 160 : 190) * rpx
  const margin = 24 * rpx
  return {
    windowWidth: info.windowWidth,
    windowHeight: info.windowHeight,
    width,
    height,
    margin,
    defaultTop: Math.max(104 * rpx, menuBottom + 10 * rpx),
    defaultLeft: collapsed
      ? info.windowWidth - width / 2
      : Math.max(margin, info.windowWidth - width - 20 * rpx)
  }
}

function clampPetFloatPosition(left: number, top: number, collapsed: boolean) {
  const metrics = getPetFloatMetrics(collapsed)
  const clampedLeft = collapsed
    ? metrics.windowWidth - metrics.width / 2
    : Math.max(metrics.margin, Math.min(left, metrics.windowWidth - metrics.width - metrics.margin))
  return {
    left: clampedLeft,
    top: Math.max(metrics.margin, Math.min(top, metrics.windowHeight - metrics.height - metrics.margin))
  }
}

function getStoredPetFloatPosition(collapsed: boolean): { left: number; top: number } {
  try {
    const stored = Taro.getStorageSync(HOME_PET_FLOAT_POSITION_KEY)
    if (stored && typeof stored === 'object') {
      const left = Number(stored.left)
      const top = Number(stored.top)
      if (Number.isFinite(left) && Number.isFinite(top)) {
        return clampPetFloatPosition(left, top, collapsed)
      }
    }
  } catch (_) {}
  const metrics = getPetFloatMetrics(collapsed)
  return { left: metrics.defaultLeft, top: metrics.defaultTop }
}

function savePetFloatPosition(position: { left: number; top: number }) {
  try {
    Taro.setStorageSync(HOME_PET_FLOAT_POSITION_KEY, position)
  } catch (_) {}
}

function alignPayloadWithCalorieTarget(payload: DashboardTargets): { payload: DashboardTargets; adjusted: boolean } {
  const caloriesFromMacros = payload.protein_target * 4 + payload.carbs_target * 4 + payload.fat_target * 9
  if (Math.abs(caloriesFromMacros - payload.calorie_target) <= 1) {
    return { payload, adjusted: false }
  }

  const scaledMacros = scaleMacrosByCalorieTarget(payload.calorie_target, {
    protein: payload.protein_target,
    carbs: payload.carbs_target,
    fat: payload.fat_target
  })

  return {
    adjusted: true,
    payload: {
      calorie_target: payload.calorie_target,
      protein_target: Number(formatTargetInput(scaledMacros.protein)),
      carbs_target: Number(formatTargetInput(scaledMacros.carbs)),
      fat_target: Number(formatTargetInput(scaledMacros.fat))
    }
  }
}

function calculateProgressPercent(current: number, target: number): number {
  if (target <= 0) {
    return current > 0 ? 100 : 0
  }
  return Math.max(0, Number(((current / target) * 100).toFixed(1)))
}

function normalizeDisplayNumber(value: unknown): number {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : 0
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

/** dashboard 的 exerciseBurnedKcal：兼容 JSON 中数字被解析为字符串的情况 */
function parseExerciseBurnedKcal(raw: unknown): number {
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return raw
  }
  if (typeof raw === 'string') {
    const n = parseFloat(raw.trim())
    return Number.isFinite(n) ? n : 0
  }
  return 0
}

/** 与记运动页同源：合并 dashboard 与 exercise-logs；取二者较大值，避免 logs 空列表返回 0 时盖住 dashboard 已有汇总（真机偶发） */
function mergeExerciseKcalFromDashboardAndLogs(dashboardRaw: unknown, logsTotal: unknown): number {
  const dash = parseExerciseBurnedKcal(dashboardRaw)
  const fromLogs =
    typeof logsTotal === 'number' && Number.isFinite(logsTotal)
      ? logsTotal
      : typeof logsTotal === 'string'
        ? parseFloat(logsTotal.trim())
        : NaN
  if (Number.isFinite(fromLogs)) {
    return Math.max(dash, fromLogs)
  }
  return dash
}

// 体重/喝水相关辅助函数
function deriveWeightSummary(entries: WeightRecordEntry[], date: string) {
  const sorted = sortWeightEntries(entries)
  const latestEntry = findLatestWeightEntryByDate(sorted, date)
  const todayEntry = sorted.find(e => e.date === date)
  const previousEntry = sorted.find(e => e.date < date)
  const weightChange = latestEntry && previousEntry ? latestEntry.value - previousEntry.value : null

  return {
    latestWeight: latestEntry,
    todayWeight: todayEntry,
    previousWeight: previousEntry,
    weightChange,
    hasRecord: sorted.length > 0
  }
}

function findLatestWeightEntryByDate(entries: WeightRecordEntry[], date: string): WeightRecordEntry | null {
  const sorted = entries.filter(e => e.date <= date).sort((a, b) => b.date.localeCompare(a.date))
  return sorted[0] || null
}

function sortWeightEntries(entries: WeightRecordEntry[]): WeightRecordEntry[] {
  return [...entries].sort((a, b) => a.date.localeCompare(b.date))
}

/** 与 dashboard / 身体指标 API 一致：展示年 2026 时，云端/库内 2025-xx-xx 应对齐到 2026-xx-xx */
function bmDateKey(date: string): string {
  return mapCalendarDateToApi(date) ?? date
}

/**
 * 合并本机 waterByDate / 体重条目的日期键，避免同日 2025/2026 两套键导致查不到、按日切换永远不变
 */
function normalizeBodyMetricsStorageKeys(metrics: BodyMetricsStorage): BodyMetricsStorage {
  const nextWater: Record<string, BodyMetricWaterDay> = {}
  for (const [k, v] of Object.entries(metrics.waterByDate)) {
    const nk = bmDateKey(k)
    const merged = nextWater[nk]
    if (!merged) {
      nextWater[nk] = { ...v, date: nk }
    } else {
      const pick = merged.total >= v.total ? merged : { ...v, date: nk }
      nextWater[nk] = {
        date: nk,
        total: Math.max(merged.total, v.total),
        logs: pick.logs,
      }
    }
  }
  const byDate = new Map<string, WeightRecordEntry>()
  for (const e of metrics.weightEntries) {
    const nk = bmDateKey(e.date)
    const prev = byDate.get(nk)
    const nextE: WeightRecordEntry = { ...e, date: nk }
    if (!prev) {
      byDate.set(nk, nextE)
    } else {
      const nt = nextE.recorded_at || ''
      const pt = prev.recorded_at || ''
      byDate.set(nk, nt >= pt ? nextE : prev)
    }
  }
  const weightEntries = sortWeightEntries([...byDate.values()]).slice(-WEIGHT_HISTORY_LIMIT)
  return { ...metrics, waterByDate: nextWater, weightEntries }
}

function getStoredBodyMetrics(): BodyMetricsStorage {
  try {
    const stored = Taro.getStorageSync('body_metrics_storage')
    if (stored) {
      const migrated = migrateLegacy2025BodyMetricKeys(stored as BodyMetricsStorage)
      return normalizeBodyMetricsStorageKeys(migrated)
    }
  } catch {
    // ignore
  }
  return {
    weightEntries: [],
    waterByDate: {},
    waterGoalMl: WATER_GOAL_DEFAULT
  }
}

function saveBodyMetrics(metrics: BodyMetricsStorage) {
  try {
    Taro.setStorageSync('body_metrics_storage', metrics)
  } catch {
    // ignore
  }
}

function applyCloudBodyMetrics(storage: BodyMetricsStorage, cloud: {
  weight_entries?: BodyMetricWeightEntry[]
  water_daily?: BodyMetricWaterDay[]
  water_goal_ml?: number
}): BodyMetricsStorage {
  let next = normalizeBodyMetricsStorageKeys({
    ...storage,
    weightEntries: [...storage.weightEntries],
    waterByDate: { ...storage.waterByDate },
    waterGoalMl: cloud.water_goal_ml || storage.waterGoalMl || WATER_GOAL_DEFAULT
  })

  if (cloud.weight_entries?.length) {
    const byDate = new Map<string, WeightRecordEntry>()
    next.weightEntries.forEach((e) => {
      const d = bmDateKey(e.date)
      byDate.set(d, { ...e, date: d })
    })
    for (const entry of cloud.weight_entries) {
      const d = bmDateKey(entry.date)
      byDate.set(d, {
        date: d,
        value: entry.value,
        recorded_at: entry.recorded_at || undefined
      })
    }
    next.weightEntries = sortWeightEntries([...byDate.values()]).slice(-WEIGHT_HISTORY_LIMIT)
  }

  if (cloud.water_daily?.length) {
    for (const day of cloud.water_daily) {
      const d = bmDateKey(day.date)
      const cloudTotal = Math.max(0, Number(day.total) || 0)
      const cloudLogs = (day.logs || []).map((value) => Math.max(0, Number(value) || 0))
      const local = next.waterByDate[d]
      const localTotal = Math.max(0, Number(local?.total) || 0)
      const useLocal = localTotal > cloudTotal
      next.waterByDate[d] = {
        date: d,
        total: useLocal ? localTotal : cloudTotal,
        logs: useLocal ? (local?.logs || []) : cloudLogs
      }
    }
  }

  return next
}

function getTodayWater(metrics: BodyMetricsStorage, date: string): BodyMetricWaterDay {
  const d = bmDateKey(date)
  return metrics.waterByDate[d] || metrics.waterByDate[date] || { date, total: 0, logs: [] }
}

function normalizeMetricNumber(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

function foodRecordItemWaterMl(item: FoodRecord['items'][number]): number {
  const waterMl = normalizeMetricNumber(item.water_ml ?? item.waterMl ?? item.nutrients?.water_ml ?? item.nutrients?.waterMl)
  if (waterMl <= 0) return 0
  const weight = normalizeMetricNumber(item.weight)
  const cappedWaterMl = weight > 0 ? Math.min(waterMl, weight) : waterMl
  const ratio = normalizeMetricNumber(item.ratio)
  if (ratio > 0) return cappedWaterMl * ratio / 100
  const intake = normalizeMetricNumber(item.intake)
  if (intake > 0 && weight > 0) return cappedWaterMl * intake / weight
  if (intake === 0 && weight === 0) return cappedWaterMl
  return 0
}

function calculateFoodRecordWaterMl(record: FoodRecord | null | undefined): number {
  const total = (record?.items || []).reduce((sum, item) => sum + foodRecordItemWaterMl(item), 0)
  return Math.max(0, Math.round(total))
}

function reduceWaterForDate(metrics: BodyMetricsStorage, date: string, amount: number, expectedMaxTotal?: number): BodyMetricsStorage {
  const amountMl = Math.max(0, Math.round(amount))
  const key = bmDateKey(date)
  const current = getTodayWater(metrics, date)
  const currentTotal = Math.max(0, Number(current.total) || 0)
  const targetTotal = Math.max(0, Math.min(
    typeof expectedMaxTotal === 'number' && Number.isFinite(expectedMaxTotal)
      ? expectedMaxTotal
      : currentTotal - amountMl,
    currentTotal
  ))
  const delta = currentTotal - targetTotal
  if (delta <= 0) return metrics

  let remaining = delta
  const logs = [...(current.logs || [])]
  for (let i = logs.length - 1; i >= 0 && remaining > 0; i--) {
    const value = Math.max(0, Number(logs[i]) || 0)
    if (value <= remaining) {
      remaining -= value
      logs.splice(i, 1)
    } else {
      logs[i] = value - remaining
      remaining = 0
    }
  }

  return {
    ...metrics,
    waterByDate: {
      ...metrics.waterByDate,
      [key]: {
        date: key,
        total: targetTotal,
        logs
      }
    }
  }
}

function addWaterToMetrics(metrics: BodyMetricsStorage, date: string, amount: number): BodyMetricsStorage {
  const key = bmDateKey(date)
  const current = getTodayWater(metrics, date)
  const updated: BodyMetricWaterDay = {
    date: key,
    total: current.total + amount,
    logs: [...current.logs, amount]
  }
  return {
    ...metrics,
    waterByDate: {
      ...metrics.waterByDate,
      [key]: updated
    }
  }
}

function clearWaterForDate(metrics: BodyMetricsStorage, date: string): BodyMetricsStorage {
  const next = { ...metrics, waterByDate: { ...metrics.waterByDate } }
  delete next.waterByDate[bmDateKey(date)]
  delete next.waterByDate[date]
  return next
}

function getDismissedBackfillDates(): string[] {
  const stored = Taro.getStorageSync(BACKFILL_HINT_DISMISSED_DATES_KEY)
  return Array.isArray(stored)
    ? stored.filter((date): date is string => typeof date === 'string' && date.length > 0)
    : []
}

function saveDismissedBackfillDates(dates: string[]) {
  Taro.setStorageSync(BACKFILL_HINT_DISMISSED_DATES_KEY, Array.from(new Set(dates)))
}

/** 真机弱网时身体指标接口偶发失败，短延迟重试一次；仍失败则返回 null，由本机缓存 + 日期键规范化兜底 */
async function fetchBodyMetricsSummaryRetry(): Promise<
  Awaited<ReturnType<typeof getBodyMetricsSummary>> | null
> {
  try {
    return await getBodyMetricsSummary('week')
  } catch {
    await new Promise<void>((resolve) => setTimeout(resolve, 350))
    try {
      return await getBodyMetricsSummary('week')
    } catch {
      return null
    }
  }
}

function getExpiryUrgencyText(item: HomeFoodExpiryItem): string {
  if (item.urgency_level === 'overdue') return '已过期'
  if (item.urgency_level === 'today') return '今天截止'
  if (item.urgency_level === 'soon') {
    const days = Math.max(1, Number(item.days_left ?? 1))
    return `${days}天内到期`
  }
  return '待处理'
}

function formatExpiryMeta(item: HomeFoodExpiryItem): string {
  return [item.deadline_label, item.storage_location || '', item.quantity_text || '']
    .filter(Boolean)
    .join(' · ')
}

function getExpiryTagClass(urgency: HomeFoodExpiryItem['urgency_level']): string {
  if (urgency === 'overdue') return 'overdue'
  if (urgency === 'today') return 'today'
  if (urgency === 'soon') return 'soon'
  return 'normal'
}

// 餐次对应的 iconfont 图标及颜色（与分析页保持一致）
const MEAL_ICON_CONFIG = {
  breakfast: { Icon: IconBreakfast, color: '#00bc7d', bgColor: '#ecfdf5', label: '早餐', iconClass: 'icon-zaocan1' },
  morning_snack: { Icon: IconSnack, color: '#8b5cf6', bgColor: '#f3e8ff', label: '加餐', iconClass: 'icon-lingshi' },
  lunch: { Icon: IconLunch, color: '#00bc7d', bgColor: '#ecfdf5', label: '午餐', iconClass: 'icon-wucan' },
  afternoon_snack: { Icon: IconSnack, color: '#8b5cf6', bgColor: '#f3e8ff', label: '加餐', iconClass: 'icon-lingshi' },
  dinner: { Icon: IconDinner, color: '#00bc7d', bgColor: '#ecfdf5', label: '晚餐', iconClass: 'icon-wancan' },
  evening_snack: { Icon: IconSnack, color: '#8b5cf6', bgColor: '#f3e8ff', label: '加餐', iconClass: 'icon-lingshi' },
  snack: { Icon: IconSnack, color: '#8b5cf6', bgColor: '#f3e8ff', label: '零食', iconClass: 'icon-lingshi' }
} as const

// 营养素配置
const MACRO_CONFIGS: Array<{
  key: MacroKey
  label: string
  subLabel: string
  color: string
  unit: string
  iconClass: string
}> = [
  { key: 'protein', label: '蛋白质', subLabel: '剩余', color: '#5c9ed4', unit: 'g', iconClass: 'icon-danbaizhi' },
  { key: 'carbs', label: '碳水', subLabel: '剩余', color: '#d4ac52', unit: 'g', iconClass: 'icon-tanshui-dabiao' },
  { key: 'fat', label: '脂肪', subLabel: '剩余', color: '#f0985c', unit: 'g', iconClass: 'icon-zhifangyouheruhuazhifangzhipin' }
]

type HomeHandbookBanner = {
  key: string
  title: string
  desc: string
  bgImage: string
  url: string
}

function IndexPage() {
  const { scheme } = useAppColorScheme()
  const initialSelectedDate = formatDateKey(new Date())
  const initialHomeSelectedDate = initialSelectedDate
  const initialLocalSnapshot = getStoredHomeDashboardSnapshotByDate(initialHomeSelectedDate)
  const [intakeData, setIntakeData] = React.useState<HomeIntakeData>(initialLocalSnapshot?.intakeData || DEFAULT_INTAKE)
  const [nutritionTarget, setNutritionTarget] = React.useState<HomeNutritionTarget | null>(initialLocalSnapshot?.nutritionTarget || null)
  const [meals, setMeals] = React.useState<HomeMealItem[]>(initialLocalSnapshot?.meals || [])
  const [expirySummary, setExpirySummary] = React.useState<HomeFoodExpirySummary>(initialLocalSnapshot?.expirySummary || DEFAULT_EXPIRY_SUMMARY)
  const [weekHeatmapCells, setWeekHeatmapCells] = React.useState<WeekHeatmapCell[]>(() => buildWeekHeatmapCellsFromStorage())
  const [calendarHistoryCells, setCalendarHistoryCells] = React.useState<WeekHeatmapCell[]>(() => buildCalendarHeatmapCellsFromStorage())
  const [loading, setLoading] = React.useState(!initialLocalSnapshot)
  const [isSwitchingDate, setIsSwitchingDate] = React.useState(false)
  /** 后台静默同步中：左上角微型 spinner，不占文档流 */
  const [dataSyncing, setDataSyncing] = React.useState(false)
  const [petCollapsed, setPetCollapsed] = React.useState(getStoredPetCollapsed)
  const [petHidden, setPetHidden] = React.useState(getStoredPetHidden)
  const [petFloatPosition, setPetFloatPosition] = React.useState(() => getStoredPetFloatPosition(getStoredPetCollapsed()))
  const [petDragging, setPetDragging] = React.useState(false)
  const [petSummary, setPetSummary] = React.useState<PetSummary | null>(null)
  const [petClaiming, setPetClaiming] = React.useState(false)
  const [petCelebrating, setPetCelebrating] = React.useState(false)
  const [membershipStatus, setMembershipStatus] = React.useState<MembershipStatus | null>(null)
  const [rewardCenter, setRewardCenter] = React.useState<RewardCenterResponse | null>(null)
  const [handbookBannerIndex, setHandbookBannerIndex] = React.useState(0)
  const [homeMode, setHomeMode] = React.useState<HomeDisplayMode>(getStoredHomeDisplayMode)
  const petSummarySeqRef = React.useRef(0)
  const petDidShowCountRef = React.useRef(0)
  const petCelebrationTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const petDragRef = React.useRef<{
    pointerId: number
    startClientX: number
    startClientY: number
    startLeft: number
    startTop: number
    moved: boolean
  } | null>(null)
  /** 标记本次 touch 是否已经在 touchend 里处理过展开/收起，避免 touchend 后又触发 card onClick */
  const petClickHandledRef = React.useRef(false)

  const applyHomeNavigationPalette = React.useCallback((mode: HomeDisplayMode) => {
    void Taro.setNavigationBarColor({
      frontColor: '#000000',
      backgroundColor: mode === 'wellness' ? '#f7f4eb' : '#f4faf8',
      animation: { duration: 180, timingFunc: 'easeInOut' }
    }).catch(() => {
      // 状态栏配色属于视觉增强，不影响首页主流程。
    })
  }, [])

  React.useEffect(() => {
    applyHomeNavigationPalette(homeMode)
  }, [applyHomeNavigationPalette, homeMode])

  useDidShow(() => {
    applyHomeNavigationPalette(homeMode)
  })

  useDidHide(() => {
    applyHomeNavigationPalette('balanced')
  })
  const [showTargetEditor, setShowTargetEditor] = React.useState(false)
  const [savingTargets, setSavingTargets] = React.useState(false)
  const [nutritionExpanded, setNutritionExpanded] = React.useState(false)
  const [targetForm, setTargetForm] = React.useState<TargetFormState>(createTargetForm(DEFAULT_INTAKE))
  const targetScaleBaseMacrosRef = React.useRef<MacroTargets>(getMacroTargetsFromIntake(DEFAULT_INTAKE))

  const [selectedDate, setSelectedDate] = React.useState(initialHomeSelectedDate)

  // 体重/喝水状态
  const [bodyMetrics, setBodyMetrics] = React.useState<BodyMetricsStorage>(getStoredBodyMetrics())
  /** 首页「运动」卡片：当日消耗千卡（与 dashboard 同步） */
  const [exerciseBurnedKcal, setExerciseBurnedKcal] = React.useState(initialLocalSnapshot?.exerciseBurnedKcal || 0)
  const [showWeightEditor, setShowWeightEditor] = React.useState(false)
  const [weightInput, setWeightInput] = React.useState('')
  const [savingWeight, setSavingWeight] = React.useState(false)
  const [showWaterEditor, setShowWaterEditor] = React.useState(false)
  const [waterEditorDate, setWaterEditorDate] = React.useState(initialHomeSelectedDate)
  const [waterInput, setWaterInput] = React.useState('')
  /** 自定义水量输入框聚焦（与草稿数字共同决定是否显示「添加」） */
  const [waterInputFocused, setWaterInputFocused] = React.useState(false)
  const [savingWater, setSavingWater] = React.useState(false)
  const waterBlurTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  /** 快速切换日期时忽略非最新一次 dashboard 的响应（微信小程序无 AbortController，无法掐断请求） */
  const loadDashboardSeqRef = React.useRef(0)
  /** 切日同步专用的 seq ref，避免与 loadDashboard 共用导致竞态丢弃 */
  const syncDashboardSeqRef = React.useRef(0)
  /** 防止并发重复请求：同日期 dashboard 正在加载中时跳过新调用 */
  const loadDashboardPendingRef = React.useRef<{ date: string; seq: number } | null>(null)
  /** 防止并发重复请求：切日同步专用的 pending ref */
  const syncDashboardPendingRef = React.useRef<{ date: string; seq: number } | null>(null)
  /** 最近一次成功拉取 dashboard 的日期与时间戳（用于回到首页时跳过重复请求） */
  const homeLastLoadRef = React.useRef<{ date: string; ts: number } | null>(null)
  /** 为 true 时下次「今日」展示必须重拉（饮食/运动/保质期等变更） */
  const homeDataStaleRef = React.useRef(true)

  // 记录菜单弹窗状态
  const [showRecordMenu, setShowRecordMenu] = React.useState(false)
  const [showHomeOnboardingGuide, setShowHomeOnboardingGuide] = React.useState(false)
  const [homeGuideTransitionPending, setHomeGuideTransitionPending] = React.useState(false)
  const homeGuideTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const [dismissedBackfillDates, setDismissedBackfillDates] = React.useState<string[]>(() => getDismissedBackfillDates())
  const selectedDateRef = React.useRef(selectedDate)
  const commitSelectedDate = React.useCallback((date: string) => {
    const nextDate = isValidHomeDate(date) ? date : formatDateKey(new Date())
    selectedDateRef.current = nextDate
    saveLastHomeSelectedDate(nextDate)
    setSelectedDate(nextDate)
    return nextDate
  }, [])
  const openRecordMenuFromRequest = React.useCallback(() => {
    const pendingDate = consumeHomeRecordMenuDate()
    if (pendingDate) {
      commitSelectedDate(pendingDate)
    }
    setShowRecordMenu(true)
  }, [commitSelectedDate])

  const handleHomeGuideBeforeNext = React.useCallback(async (stepIndex: number, nextIndex: number) => {
    if (nextIndex >= 1 && nextIndex <= 4) {
      setShowRecordMenu(true)
      await new Promise<void>((resolve) => setTimeout(resolve, stepIndex === 0 ? 400 : 220))
    }
  }, [])

  /** 首页仪表盘返回的成就（连续记录 / 全绿天数） */
  const dismissHealthProfilePrompt = React.useCallback(() => {
    snoozeHealthProfileReminder()
    setShowHealthProfilePrompt(false)
  }, [])

  const closeHomeOnboardingGuide = React.useCallback(() => {
    setShowHomeOnboardingGuide(false)
    setHomeGuideTransitionPending(false)
  }, [])

  const openHealthProfileFromPrompt = React.useCallback(() => {
    setShowHealthProfilePrompt(false)
    Taro.navigateTo({ url: extraPkgUrl('/pages/health-profile/index') })
  }, [])

  const [homeAchievement, setHomeAchievement] = React.useState<HomeAchievement>(initialLocalSnapshot?.achievement || { streak_days: 0, green_days: 0 })
  const [dailyPosterGenerating, setDailyPosterGenerating] = React.useState(false)
  const [dailyPosterImageUrl, setDailyPosterImageUrl] = React.useState<string | null>(null)
  const [showDailyPosterModal, setShowDailyPosterModal] = React.useState(false)
  const [dietRecVisible, setDietRecVisible] = React.useState(false)
  const [dietRecScene, setDietRecScene] = React.useState<DietRecommendationScene>('eat_out')
  const [dietRecLoading, setDietRecLoading] = React.useState(false)
  const [dietRecResult, setDietRecResult] = React.useState<DietRecommendationResult | null>(null)
  const [showHealthProfilePrompt, setShowHealthProfilePrompt] = React.useState(false)
  const dietRecRequestSeqRef = React.useRef(0)

  const loadRewardHintData = React.useCallback(async () => {
    if (!getAccessToken()) {
      setMembershipStatus(null)
      setRewardCenter(null)
      return
    }
    try {
      const [membership, center] = await Promise.all([
        getMyMembership().catch(() => null),
        getRewardCenter().catch(() => null),
      ])
      setMembershipStatus(membership)
      setRewardCenter(center)
    } catch {
      // 奖励提示是增强信息，失败时不影响首页主链路。
    }
  }, [])

  // 餐食卡片操作状态
  const [mealActionSheetVisible, setMealActionSheetVisible] = React.useState(false)
  const [mealActionRecordId, setMealActionRecordId] = React.useState<string | null>(null)
  const [mealActionRecord, setMealActionRecord] = React.useState<FoodRecord | null>(null)
  const mealFavoriteInFlightRef = React.useRef(false)
  const [showRecordEditModal, setShowRecordEditModal] = React.useState(false)
  const homePageScrollLocked = showRecordEditModal || showHomeOnboardingGuide || dietRecVisible
  const [showRecordPosterModal, setShowRecordPosterModal] = React.useState(false)
  /** 同一餐次多条记录时的选择面板 */
  const [mealRecordsDialogVisible, setMealRecordsDialogVisible] = React.useState(false)
  const [mealRecordsDialogMeal, setMealRecordsDialogMeal] = React.useState<HomeMealItem | null>(null)

  const showRecordPosterModalRef = React.useRef(false)
  const showDailyPosterModalRef = React.useRef(false)
  const mealPosterShareForAppMessageRef = React.useRef<MealPosterSharePayload | null>(null)
  const dailyPosterShareForAppMessageRef = React.useRef<{ imageUrl: string } | null>(null)

  React.useEffect(() => {
    showRecordPosterModalRef.current = showRecordPosterModal
  }, [showRecordPosterModal])

  React.useEffect(() => {
    showDailyPosterModalRef.current = showDailyPosterModal
  }, [showDailyPosterModal])

  React.useEffect(() => () => {
    if (homeGuideTimerRef.current) {
      clearTimeout(homeGuideTimerRef.current)
    }
  }, [])

  React.useEffect(() => {
    const handleHiddenChanged = (hidden?: boolean) => {
      setPetHidden(typeof hidden === 'boolean' ? hidden : getStoredPetHidden())
    }
    Taro.eventCenter.on(HOME_PET_HIDDEN_CHANGED_EVENT, handleHiddenChanged)
    return () => {
      Taro.eventCenter.off(HOME_PET_HIDDEN_CHANGED_EVENT, handleHiddenChanged)
    }
  }, [])

  const handleMealPosterShareContext = React.useCallback((ctx: MealPosterSharePayload | null) => {
    mealPosterShareForAppMessageRef.current = ctx
  }, [])

  React.useEffect(() => {
    if (showDailyPosterModal && dailyPosterImageUrl) {
      dailyPosterShareForAppMessageRef.current = { imageUrl: dailyPosterImageUrl }
    } else {
      dailyPosterShareForAppMessageRef.current = null
    }
  }, [showDailyPosterModal, dailyPosterImageUrl])

  // 加载指定日期的首页数据
  const loadDashboard = React.useCallback(async (targetDate?: string, silent = false) => {
    const resolvedDate =
      targetDate !== undefined && targetDate !== ''
        ? targetDate
        : (selectedDateRef.current || formatDateKey(new Date()))

    // 若同日期请求已在进行中，跳过本次调用（解决 useDidShow 多次触发导致的大量重复请求）
    if (
      loadDashboardPendingRef.current &&
      loadDashboardPendingRef.current.date === resolvedDate
    ) {
      return
    }
    const seq = ++loadDashboardSeqRef.current
    loadDashboardPendingRef.current = { date: resolvedDate, seq }
    /** 无参调用（如保质期事件、保存目标后刷新）必须与日历选中日期一致，否则会拉到「后端默认今天」覆盖当前选中日期的数据 */
    // resolvedDate 已在上方计算

    if (!getAccessToken()) {
      setIntakeData(DEFAULT_INTAKE)
      setNutritionTarget(null)
      setMeals([])
      setExpirySummary(DEFAULT_EXPIRY_SUMMARY)
      setExerciseBurnedKcal(0)
      setHomeAchievement({ streak_days: 0, green_days: 0 })
      setTargetForm(createTargetForm(DEFAULT_INTAKE))
      setWeekHeatmapCells(createWeekHeatmapCells())
      setLoading(false)
      setIsSwitchingDate(false)
      return
    }

    if (!silent) {
      setLoading(true)
    } else {
      setDataSyncing(true)
    }
    try {
      const exerciseLogParams = { date: resolvedDate }
      console.log('[DEBUG] loadDashboard start, date=', resolvedDate, 'seq=', seq)
      // 首页主数据是首屏唯一硬依赖。其余接口提前并发启动，但都作为后台增强，
      // 不能因为弱网超时而阻塞已经成功返回的 dashboard 渲染。
      const statsPromise = getStatsSummary('month').catch((err) => {
        console.error('[home-dashboard] getStatsSummary failed:', err)
        return null
      })
      const bodyMetricsPromise = fetchBodyMetricsSummaryRetry()
      const exerciseLogsPromise = getExerciseLogs(exerciseLogParams).catch((err) => {
        console.error('[home-dashboard] getExerciseLogs failed:', err)
        return null
      })

      const res = await getHomeDashboard(resolvedDate)
      if (seq !== loadDashboardSeqRef.current) {
        return
      }
      const intake = res.intakeData
      // DEBUG: 打印首页餐食原始数据，排查 description / meal_record_entries 是否为空
      console.log('[DEBUG] getHomeDashboard meals raw:', JSON.stringify(res.meals || [], null, 2))
      if (Array.isArray(res.meals)) {
        res.meals.forEach((m, i) => {
          console.log(`[DEBUG] meal[${i}] type=${m.type} name=${m.name} description=${m.description} entriesCount=${Array.isArray(m.meal_record_entries) ? m.meal_record_entries.length : 'N/A'}`)
          if (Array.isArray(m.meal_record_entries)) {
            m.meal_record_entries.forEach((e, j) => {
              console.log(`[DEBUG]   entry[${j}] id=${e.id} title=${e.title} total_calories=${e.total_calories}`)
            })
          }
        })
      }
      setIntakeData(intake)
      setNutritionTarget(res.nutritionTarget || null)
      setMeals(res.meals || [])
      setExpirySummary(res.expirySummary || DEFAULT_EXPIRY_SUMMARY)
      const initialExerciseKcal = mergeExerciseKcalFromDashboardAndLogs(res.exerciseBurnedKcal, undefined)
      let nextExerciseKcal = initialExerciseKcal
      setExerciseBurnedKcal(nextExerciseKcal)
      const nextAchievement = res.achievement ?? { streak_days: 0, green_days: 0 }
      setHomeAchievement(nextAchievement)
      setTargetForm(createTargetForm(intake))

      // 1. 先保存到本地 storage
      const normalizedDate = mapCalendarDateToApi(resolvedDate) || resolvedDate
      const nextSnapshot: HomeDashboardLocalSnapshot = {
        date: normalizedDate,
        updatedAt: Date.now(),
        intakeData: intake,
        meals: res.meals || [],
        expirySummary: res.expirySummary || DEFAULT_EXPIRY_SUMMARY,
        exerciseBurnedKcal: nextExerciseKcal,
        achievement: nextAchievement,
        nutritionTarget: res.nutritionTarget || null
      }
      const currentSnapshot = getStoredHomeDashboardSnapshotByDate(normalizedDate)
      console.log('[DEBUG] about to save snapshot, date=', normalizedDate, 'currentSnapshotExists=', !!currentSnapshot)
      if (!currentSnapshot || JSON.stringify({
        intakeData: currentSnapshot.intakeData,
        meals: currentSnapshot.meals,
        expirySummary: currentSnapshot.expirySummary,
        exerciseBurnedKcal: currentSnapshot.exerciseBurnedKcal,
        achievement: currentSnapshot.achievement,
        nutritionTarget: currentSnapshot.nutritionTarget || null
      }) !== JSON.stringify({
        intakeData: nextSnapshot.intakeData,
        meals: nextSnapshot.meals,
        expirySummary: nextSnapshot.expirySummary,
        exerciseBurnedKcal: nextSnapshot.exerciseBurnedKcal,
        achievement: nextSnapshot.achievement,
        nutritionTarget: nextSnapshot.nutritionTarget || null
      })) {
        saveHomeDashboardSnapshot(nextSnapshot)
      } else {
        saveHomeDashboardSnapshot({ ...currentSnapshot, updatedAt: Date.now() })
      }

      // 主接口完成后立即展示首屏；周统计、身体指标和运动在下方继续后台合并。
      setWeekHeatmapCells(buildWeekHeatmapCellsFromStorage())

      homeLastLoadRef.current = { date: resolvedDate, ts: Date.now() }
      homeDataStaleRef.current = false
      setLoading(false)
      setIsSwitchingDate(false)

      const [stats, bodyMetricsRes, exerciseLogsRes] = await Promise.all([
        statsPromise,
        bodyMetricsPromise,
        exerciseLogsPromise
      ])
      if (seq !== loadDashboardSeqRef.current) {
        return
      }

      if (exerciseLogsRes) {
        nextExerciseKcal = mergeExerciseKcalFromDashboardAndLogs(
          res.exerciseBurnedKcal,
          exerciseLogsRes.total_calories
        )
        setExerciseBurnedKcal(nextExerciseKcal)
        if (nextExerciseKcal !== initialExerciseKcal) {
          const latestSnapshot = getStoredHomeDashboardSnapshotByDate(normalizedDate)
          if (latestSnapshot) {
            saveHomeDashboardSnapshot({
              ...latestSnapshot,
              updatedAt: Date.now(),
              exerciseBurnedKcal: nextExerciseKcal
            })
          }
        }
      }

      // 从 storage 优先、stats 回退构建 7 天热力图；stats 失败时保留首屏缓存结果。
      if (stats) {
        setCalendarHistoryCells(buildCalendarHeatmapCellsFromStorage(stats))
        const today = new Date()
        const nextWeekHeatmapCells: WeekHeatmapCell[] = []
        for (let offset = -3; offset <= 3; offset++) {
          const date = new Date(today)
          date.setDate(today.getDate() + offset)
          const dateKey = formatDateKey(date)
          const snap = getStoredHomeDashboardSnapshotByDate(dateKey)
          const dayData = stats.daily_calories.find(d => normalizeTo2025(d.date) === normalizeTo2025(dateKey))
          const calories = snap ? snap.intakeData.current : (dayData?.calories || 0)
          const target = snap ? snap.intakeData.target : (stats.tdee || 2000)
          const hasRecord = calories > 0 || Boolean(snap?.meals?.length)
          nextWeekHeatmapCells.push({
            date: dateKey,
            dayName: SHORT_DAY_NAMES[date.getDay()],
            dayNum: String(date.getDate()),
            calories,
            target,
            intakeRatio: hasRecord ? calories / target : 0,
            state: !hasRecord ? 'none' : calories > target ? 'surplus' : 'deficit',
            isToday: offset === 0,
            hasRecord
          })
        }
        console.log('[DEBUG] weekHeatmapCells built:', nextWeekHeatmapCells.map(c => ({ date: c.date, state: c.state, calories: c.calories })))
        setWeekHeatmapCells(nextWeekHeatmapCells)
      }

      // 应用云端身体指标数据（失败时仍规范化本机日期键，避免 2025/2026 混用导致按日切换永远不变）
      console.log('[DEBUG] bodyMetricsRes:', JSON.stringify({
        water_goal_ml: bodyMetricsRes?.water_goal_ml,
        today_water: bodyMetricsRes?.today_water,
        water_daily: bodyMetricsRes?.water_daily,
        water_daily_length: bodyMetricsRes?.water_daily?.length
      }))
      if (bodyMetricsRes) {
        setBodyMetrics(prev => {
          const next = applyCloudBodyMetrics(prev, {
            weight_entries: bodyMetricsRes.weight_entries,
            water_daily: bodyMetricsRes.water_daily,
            water_goal_ml: bodyMetricsRes.water_goal_ml
          })
          saveBodyMetrics(next)
          return next
        })
      } else {
        setBodyMetrics(prev => {
          const next = normalizeBodyMetricsStorageKeys(prev)
          saveBodyMetrics(next)
          return next
        })
      }

    } catch (error) {
      if (seq !== loadDashboardSeqRef.current) {
        return
      }
      console.error('首页 dashboard 加载失败:', error)
      await showUnifiedApiError(error, '获取首页数据失败')
      const localFallback = getStoredHomeDashboardSnapshotByDate(resolvedDate)
      if (localFallback) {
        setIntakeData(localFallback.intakeData)
        setNutritionTarget(localFallback.nutritionTarget || null)
        setMeals(localFallback.meals || [])
        setExpirySummary(localFallback.expirySummary || DEFAULT_EXPIRY_SUMMARY)
        setExerciseBurnedKcal(localFallback.exerciseBurnedKcal || 0)
        setHomeAchievement(localFallback.achievement || { streak_days: 0, green_days: 0 })
        setTargetForm(createTargetForm(localFallback.intakeData || DEFAULT_INTAKE))
        setWeekHeatmapCells(buildWeekHeatmapCellsFromStorage())
        setCalendarHistoryCells(buildCalendarHeatmapCellsFromStorage())
      } else {
        setIntakeData(DEFAULT_INTAKE)
        setNutritionTarget(null)
        setMeals([])
        setExpirySummary(DEFAULT_EXPIRY_SUMMARY)
        setExerciseBurnedKcal(0)
        setHomeAchievement({ streak_days: 0, green_days: 0 })
        setWeekHeatmapCells(createWeekHeatmapCells())
        setCalendarHistoryCells([])
        setTargetForm(createTargetForm(DEFAULT_INTAKE))
      }
    } finally {
      if (loadDashboardPendingRef.current?.seq === seq) {
        loadDashboardPendingRef.current = null
      }
      if (seq === loadDashboardSeqRef.current) {
        setLoading(false)
        setIsSwitchingDate(false)
        setDataSyncing(false)
      }
    }
  }, [setIntakeData, setMeals, setWeekHeatmapCells, setTargetForm, setLoading, setIsSwitchingDate])

  // 独立的后台缓存补齐逻辑：与主请求并行，互不干扰
  async function ensureHomeDashboardCache(): Promise<void> {
    if (!getAccessToken()) return
    try {
      const snapshots = getStoredHomeDashboardSnapshots()
      if (snapshots.length >= 7) return
      const today = new Date()
      const missingDates: string[] = []
      Array.from({ length: 7 }).forEach((_, idx) => {
        const offset = idx - 6
        const d = new Date(today)
        d.setDate(today.getDate() + offset)
        const dateKey = formatDateKey(d)
        if (!getStoredHomeDashboardSnapshotByDate(dateKey)) {
          missingDates.push(dateKey)
        }
      })
      if (missingDates.length === 0) return
      console.log('[dashboard-backfill] missing dates:', missingDates)
      const results = await Promise.all(
        missingDates.map(async (date) => {
          try {
            const dayRes = await getHomeDashboard(date)
            const normDate = mapCalendarDateToApi(date) || date
            return {
              date: normDate,
              updatedAt: Date.now(),
              intakeData: dayRes.intakeData,
              meals: dayRes.meals || [],
              expirySummary: dayRes.expirySummary || DEFAULT_EXPIRY_SUMMARY,
              exerciseBurnedKcal: dayRes.exerciseBurnedKcal || 0,
              achievement: dayRes.achievement || { streak_days: 0, green_days: 0 },
              nutritionTarget: dayRes.nutritionTarget || null
            } as HomeDashboardLocalSnapshot
          } catch (err) {
            console.error('[dashboard-backfill] fetch failed for', date, err)
            return null
          }
        })
      )
      results.forEach((snapshot) => {
        if (snapshot) saveHomeDashboardSnapshot(snapshot)
      })
      // 完成后从缓存刷新热图 UI
      setWeekHeatmapCells(buildWeekHeatmapCellsFromStorage())
      // 若当前选中日期已补齐，同步刷新首页数据
      const currentDate = selectedDateRef.current || formatDateKey(new Date())
      const refreshed = getStoredHomeDashboardSnapshotByDate(currentDate)
      if (refreshed) {
        setIntakeData(refreshed.intakeData)
        setNutritionTarget(refreshed.nutritionTarget || null)
        setMeals(refreshed.meals || [])
        setExpirySummary(refreshed.expirySummary || DEFAULT_EXPIRY_SUMMARY)
        setExerciseBurnedKcal(refreshed.exerciseBurnedKcal || 0)
        setHomeAchievement(refreshed.achievement || { streak_days: 0, green_days: 0 })
        setTargetForm(createTargetForm(refreshed.intakeData || DEFAULT_INTAKE))
      }
      console.log('[dashboard-backfill] done')
    } catch (err) {
      console.error('[dashboard-backfill] unhandled error', err)
    }
  }

  // 每次显示页面时刷新数据
  const skipNextRefreshRef = React.useRef(false)

  useDidShow(() => {
    setPetHidden(getStoredPetHidden())
    if (getAccessToken()) {
      void getHealthProfile()
        .then((profile) => {
          const status = profile.onboarding_status || (profile.onboarding_completed === true ? 'completed' : 'pending')
          setShowHealthProfilePrompt(status !== 'completed' && !isHealthProfileReminderSnoozed())
        })
        .catch(() => {
          // 档案提示为增强信息，读取失败不影响首页主链路。
        })
    } else {
      setShowHealthProfilePrompt(false)
    }
    const today = formatDateKey(new Date())
    const currentSelected = selectedDateRef.current

    // 检查是否需要显示记录菜单（从底部导航栏中间按钮点击）
    const shouldShowRecordMenu = Taro.getStorageSync(HOME_RECORD_MENU_FLAG_KEY)
    if (shouldShowRecordMenu) {
      Taro.removeStorageSync(HOME_RECORD_MENU_FLAG_KEY)
      openRecordMenuFromRequest()
    } else {
      const requestedAfterOnboarding = consumeHomeRecordGuideAfterOnboarding()
      if (requestedAfterOnboarding || shouldOfferOnboardingGuide(ONBOARDING_HOME_RECORD_GUIDE_KEY)) {
        if (homeGuideTimerRef.current) clearTimeout(homeGuideTimerRef.current)
        setHomeGuideTransitionPending(requestedAfterOnboarding)
        setShowHomeOnboardingGuide(false)
        // switchTab 后等待首页布局完成，确保高亮区域可计算且首次落页不会漏掉引导。
        homeGuideTimerRef.current = setTimeout(() => {
          setShowHomeOnboardingGuide(true)
          homeGuideTimerRef.current = null
        }, requestedAfterOnboarding ? 350 : 0)
      } else {
        setShowHomeOnboardingGuide(false)
      }
    }

    if (skipNextRefreshRef.current) {
      skipNextRefreshRef.current = false
      return
    }

    // 数据变脏（饮食/运动/保质期变更）时，无论当前选中哪天都应刷新
    const shouldRefresh = (currentSelected === today || !currentSelected) || homeDataStaleRef.current
    if (!shouldRefresh) {
      return
    }

    const targetDate = currentSelected || today

    if (!getAccessToken()) {
      // 未登录时也需要 loadDashboard 来设置默认值并关闭 loading
      void loadDashboard(targetDate, false)
      return
    }

    void loadRewardHintData()

    // 刷新食物保质期待办数量
    void (async () => {
      try {
        const expiry = await getFoodExpiryDashboard().catch(() => null)
        // 计算 profile tab badge 总数：食物保质期待办 + 好友请求
        const expiryTodo = expiry
          ? (expiry.expired_count || 0) + (expiry.today_count || 0) + (expiry.soon_count || 0)
          : 0
        // 食物保质期：如果今天已看过，不算未读
        const todayStr = new Date().toISOString().slice(0, 10)
        const lastSeenFoodExpiry = Taro.getStorageSync('food_expiry_last_seen_date')
        const foodExpiryBadge = lastSeenFoodExpiry === todayStr ? 0 : expiryTodo
        const friendBadge = Number(Taro.getStorageSync('profile_tab_badge_friend_count') || 0)
        Taro.setStorageSync('profile_tab_badge_count', foodExpiryBadge + friendBadge)
      } catch {
        // 静默失败，保留旧值
      }
    })()

    // 若本地缓存的 meals 缺少营养聚合字段，视为脏数据，强制走云端刷新
    const localSnapshot = getStoredHomeDashboardSnapshotByDate(targetDate)
    if (localSnapshot && (localSnapshot.meals || []).some(
      (meal) => typeof meal.protein !== 'number' ||
        typeof meal.carbs !== 'number' ||
        typeof meal.fat !== 'number' ||
        typeof (meal.water_ml ?? meal.waterMl) !== 'number'
    )) {
      homeDataStaleRef.current = true
    }

    // 独立启动缓存补齐，与主请求并行，互不干扰
    // 放在 canCache 判断之前，确保即使主请求被跳过也会检查缓存
    void ensureHomeDashboardCache()

    const last = homeLastLoadRef.current
    const localSnapshotChangedAfterLastLoad =
      !!(localSnapshot && last && (localSnapshot.updatedAt || 0) > last.ts)
    const canCache =
      !homeDataStaleRef.current &&
      last !== null &&
      last.date === targetDate &&
      Date.now() - last.ts < HOME_DASHBOARD_CACHE_TTL_MS &&
      !localSnapshotChangedAfterLastLoad
    if (canCache) {
      return
    }
    if (localSnapshot) {
      setIntakeData(localSnapshot.intakeData)
      setNutritionTarget(localSnapshot.nutritionTarget || null)
      setMeals(localSnapshot.meals || [])
      setExpirySummary(localSnapshot.expirySummary || DEFAULT_EXPIRY_SUMMARY)
      setExerciseBurnedKcal(localSnapshot.exerciseBurnedKcal || 0)
      setHomeAchievement(localSnapshot.achievement || { streak_days: 0, green_days: 0 })
      setTargetForm(createTargetForm(localSnapshot.intakeData || DEFAULT_INTAKE))
      setLoading(false)
    }
    void loadDashboard(targetDate, Boolean(localSnapshot))
  })

  useShareAppMessage(() => {
    if (showRecordPosterModalRef.current && mealPosterShareForAppMessageRef.current?.imageUrl) {
      const m = mealPosterShareForAppMessageRef.current
      const img = m.imageUrl
      // 若 imageUrl 是 canvasToTempFilePath 生成的本地临时路径，部分基础库/真机分享时无法识别
      // fallback 到记录原图（网络地址），确保分享卡片能正常显示自定义封面
      const isLocalTmp = /^wxfile:\/\/tmp\//i.test(img) || /^https?:\/\/tmp\//i.test(img)
      const shareImageUrl = isLocalTmp && mealActionRecord?.image_path ? mealActionRecord.image_path : img
      return { title: m.title, path: m.path, imageUrl: shareImageUrl }
    }
    if (showDailyPosterModalRef.current && dailyPosterShareForAppMessageRef.current?.imageUrl) {
      const d = dailyPosterShareForAppMessageRef.current
      const img = d.imageUrl
      const isLocalTmp = /^wxfile:\/\/tmp\//i.test(img) || /^https?:\/\/tmp\//i.test(img)
      // 每日小结海报无对应记录原图，本地路径在支持的基础库下可用；不支持的会自动用小程序默认封面
      const shareImageUrl = isLocalTmp ? undefined : img
      return {
        title: '今日饮食小结',
        path: '/pages/index/index',
        imageUrl: shareImageUrl
      }
    }
    return { title: '食探 - AI 智能饮食记录', path: '/pages/index/index' }
  })

  useShareTimeline(() => ({
    title: '食探 - AI 智能饮食记录'
  }))

  React.useEffect(() => {
    Taro.showShareMenu({
      withShareTicket: true,
      menus: ['shareAppMessage', 'shareTimeline']
    } as any)
    // 清理旧版本缓存，避免脏数据干扰
    try {
      Taro.removeStorageSync('home_dashboard_local_cache_v1')
      Taro.removeStorageSync('home_dashboard_local_cache_v2')
    } catch {
      /* ignore */
    }
  }, [])

  React.useEffect(() => () => {
    if (waterBlurTimerRef.current) {
      clearTimeout(waterBlurTimerRef.current)
    }
  }, [])

  /** 「今日小结」预览：自定义 tabBar 通过 storage 隐藏底栏（见 custom-tab-bar/updateHidden） */
  React.useEffect(() => {
    if (showDailyPosterModal) {
      try {
        Taro.setStorageSync('home_poster_modal_visible', '1')
      } catch {
        /* ignore */
      }
    } else {
      try {
        Taro.removeStorageSync('home_poster_modal_visible')
      } catch {
        /* ignore */
      }
    }
    return () => {
      try {
        Taro.removeStorageSync('home_poster_modal_visible')
      } catch {
        /* ignore */
      }
    }
  }, [showDailyPosterModal])

  /** 饮食/运动/保质期等变更：标记脏数据，并在需要时立即同步首页与身体指标 */
  React.useEffect(() => {
    const markHomeStale = (payload?: { date?: string; force?: boolean }): void => {
      skipNextRefreshRef.current = false
      homeDataStaleRef.current = true
      const today = formatDateKey(new Date())
      const currentSelected = selectedDateRef.current || today
      const changedDate = payload?.date || today
      if (currentSelected !== changedDate) {
        return
      }
      const localSnapshot = getStoredHomeDashboardSnapshotByDate(changedDate)
      if (!localSnapshot) {
        if (payload?.force) {
          void loadDashboard(changedDate, true)
        }
        return
      }
      setIntakeData(localSnapshot.intakeData)
      setNutritionTarget(localSnapshot.nutritionTarget || null)
      setMeals(localSnapshot.meals || [])
      setExpirySummary(localSnapshot.expirySummary || DEFAULT_EXPIRY_SUMMARY)
      setExerciseBurnedKcal(localSnapshot.exerciseBurnedKcal || 0)
      setHomeAchievement(localSnapshot.achievement || { streak_days: 0, green_days: 0 })
      setTargetForm(createTargetForm(localSnapshot.intakeData || DEFAULT_INTAKE))
      setWeekHeatmapCells(buildWeekHeatmapCellsFromStorage())
      // 从 storage 重新加载身体指标，使饮食记录保存后的乐观饮水更新立即生效
      setBodyMetrics(getStoredBodyMetrics())
      if (payload?.force) {
        void loadDashboard(changedDate, true)
      }
    }
    Taro.eventCenter.on(FOOD_EXPIRY_CHANGED_EVENT, markHomeStale)
    Taro.eventCenter.on(HOME_DASHBOARD_REFRESH_EVENT, markHomeStale)
    Taro.eventCenter.on(HOME_INTAKE_DATA_CHANGED_EVENT, markHomeStale)
    return () => {
      Taro.eventCenter.off(FOOD_EXPIRY_CHANGED_EVENT, markHomeStale)
      Taro.eventCenter.off(HOME_DASHBOARD_REFRESH_EVENT, markHomeStale)
      Taro.eventCenter.off(HOME_INTAKE_DATA_CHANGED_EVENT, markHomeStale)
    }
  }, [])

  // 监听记录菜单标记变化（解决首页直接点击绿色按钮无响应问题）
  React.useEffect(() => {
    const checkRecordMenuFlag = () => {
      const shouldShow = Taro.getStorageSync(HOME_RECORD_MENU_FLAG_KEY)
      if (shouldShow) {
        Taro.removeStorageSync(HOME_RECORD_MENU_FLAG_KEY)
        openRecordMenuFromRequest()
      }
    }

    // 立即检查一次
    checkRecordMenuFlag()

    // 设置轮询检查（每50ms检查一次，最多检查60秒）
    // 使用更短的间隔和更长的持续时间，确保捕获标记
    let checkCount = 0
    const maxChecks = 1200
    const timer = setInterval(() => {
      checkRecordMenuFlag()
      checkCount++
      if (checkCount >= maxChecks) {
        clearInterval(timer)
      }
    }, 50)

    return () => clearInterval(timer)
  }, [openRecordMenuFromRequest])

  // 额外：监听全局事件（备用方案，确保可靠性）
  React.useEffect(() => {
    const showRecordMenuHandler = () => {
      console.log('[DEBUG] 通过全局事件触发显示记录菜单')
      openRecordMenuFromRequest()
    }
    Taro.eventCenter.on('showRecordMenu', showRecordMenuHandler)
    return () => {
      Taro.eventCenter.off('showRecordMenu', showRecordMenuHandler)
    }
  }, [openRecordMenuFromRequest])

  // 额外方案：监听 app 实例上的事件中心（供原生组件如 custom-tab-bar 使用）
  React.useEffect(() => {
    const showRecordMenuHandler = () => {
      console.log('[DEBUG] 通过 app eventCenter 触发显示记录菜单')
      openRecordMenuFromRequest()
    }

    // 注册到 app 实例的事件中心，供 custom-tab-bar 调用
    try {
      const app = Taro.getApp()
      if (app) {
        if (!app.eventCenter) {
          app.eventCenter = { callbacks: {} }
        }
        if (!app.eventCenter.callbacks) {
          app.eventCenter.callbacks = {}
        }
        app.eventCenter.callbacks['showRecordMenu'] = showRecordMenuHandler
      }
    } catch (err) {
      console.error('[DEBUG] 注册 app eventCenter 失败:', err)
    }

    return () => {
      try {
        const app = Taro.getApp()
        if (app && app.eventCenter && app.eventCenter.callbacks) {
          delete app.eventCenter.callbacks['showRecordMenu']
        }
      } catch (err) {
        console.error('[DEBUG] 清理 app eventCenter 失败:', err)
      }
    }
  }, [openRecordMenuFromRequest])

  const openTargetEditor = () => {
    if (!getAccessToken()) {
      redirectToLogin()
      return
    }
    targetScaleBaseMacrosRef.current = getMacroTargetsFromIntake(intakeData)
    setTargetForm(createTargetForm(intakeData))
    setShowTargetEditor(true)
  }

  const handleTargetInput = (key: keyof TargetFormState, value: string) => {
    setTargetForm((prev) => {
      const sanitizedValue = sanitizeTargetInput(value)
      const nextForm: TargetFormState = { ...prev, [key]: sanitizedValue }

      if (key === 'calorieTarget') {
        const nextCalorie = parseCompleteNumber(sanitizedValue)
        if (nextCalorie == null) {
          return nextForm
        }

        const baseMacros = targetScaleBaseMacrosRef.current
        const scaledMacros = scaleMacrosByCalorieTarget(nextCalorie, baseMacros)
        return {
          ...prev,
          calorieTarget: formatTargetInput(nextCalorie),
          proteinTarget: formatTargetInput(scaledMacros.protein),
          carbsTarget: formatTargetInput(scaledMacros.carbs),
          fatTarget: formatTargetInput(scaledMacros.fat)
        }
      }

      if (key === 'proteinTarget' || key === 'carbsTarget' || key === 'fatTarget') {
        const macros = parseMacroTargets(nextForm)
        if (macros == null) {
          return nextForm
        }
        targetScaleBaseMacrosRef.current = macros

        return {
          ...nextForm,
          calorieTarget: formatTargetInput(calcCaloriesFromMacros(macros))
        }
      }

      return nextForm
    })
  }

  const parseMicroTarget = (value: string): number | null => {
    const parsed = parseCompleteNumber(value)
    if (parsed == null) return null
    if (parsed < 0 || parsed > 100000) return null
    return parsed
  }

  const handleSaveTargets = async () => {
    const macroPayload: DashboardTargets = {
      calorie_target: Number(targetForm.calorieTarget),
      protein_target: Number(targetForm.proteinTarget),
      carbs_target: Number(targetForm.carbsTarget),
      fat_target: Number(targetForm.fatTarget)
    }

    if (Object.values(macroPayload).some((value) => !Number.isFinite(value))) {
      Taro.showToast({ title: '请填写完整的数字目标', icon: 'none' })
      return
    }

    if (macroPayload.calorie_target < 500 || macroPayload.calorie_target > 6000) {
      Taro.showToast({ title: '热量目标需在 500-6000 kcal', icon: 'none' })
      return
    }

    if (macroPayload.protein_target < 0 || macroPayload.protein_target > 500) {
      Taro.showToast({ title: '蛋白质目标需在 0-500 g', icon: 'none' })
      return
    }

    if (macroPayload.carbs_target < 0 || macroPayload.carbs_target > 1000) {
      Taro.showToast({ title: '碳水目标需在 0-1000 g', icon: 'none' })
      return
    }

    if (macroPayload.fat_target < 0 || macroPayload.fat_target > 300) {
      Taro.showToast({ title: '脂肪目标需在 0-300 g', icon: 'none' })
      return
    }

    const normalized = alignPayloadWithCalorieTarget(macroPayload)
    const savePayload: DashboardTargetsUpdateInput = {
      ...normalized.payload,
      micro_targets: buildMicroTargetsFromForm(targetForm),
    }

    setSavingTargets(true)
    try {
      const { saveScope } = await updateDashboardTargets(savePayload)
      setShowTargetEditor(false)
      await loadDashboard(selectedDateRef.current || formatDateKey(new Date()))
      if (saveScope === 'local') {
        Taro.showToast({
          title: normalized.adjusted
            ? '已按热量自动校准后暂存本机；后端升级后将自动同步云端'
            : '已暂存本机；部署最新后端后将自动同步云端',
          icon: 'none',
          duration: 3200,
        })
      } else {
        Taro.showToast({
          title: normalized.adjusted ? '已按热量自动校准并保存基础目标' : '基础目标已更新',
          icon: 'success'
        })
      }
    } catch (error) {
      await showUnifiedApiError(error, '保存失败')
    } finally {
      setSavingTargets(false)
    }
  }

  const buildMicroTargetsFromForm = (form: TargetFormState): Record<string, number> => {
    const microTargets: Record<string, number> = {}
    const microFields: Array<{ key: keyof TargetFormState; targetKey: string }> = [
      { key: 'fiberTarget', targetKey: 'fiber_target' },
      { key: 'sugarTarget', targetKey: 'sugar_target' },
      { key: 'saturatedFatTarget', targetKey: 'saturated_fat_target' },
      { key: 'cholesterolMgTarget', targetKey: 'cholesterol_mg_target' },
      { key: 'sodiumMgTarget', targetKey: 'sodium_mg_target' },
      { key: 'potassiumMgTarget', targetKey: 'potassium_mg_target' },
      { key: 'calciumMgTarget', targetKey: 'calcium_mg_target' },
      { key: 'ironMgTarget', targetKey: 'iron_mg_target' },
      { key: 'magnesiumMgTarget', targetKey: 'magnesium_mg_target' },
      { key: 'zincMgTarget', targetKey: 'zinc_mg_target' },
      { key: 'vitaminARaeMcgTarget', targetKey: 'vitamin_a_rae_mcg_target' },
      { key: 'vitaminCMgTarget', targetKey: 'vitamin_c_mg_target' },
      { key: 'vitaminDMcgTarget', targetKey: 'vitamin_d_mcg_target' },
      { key: 'vitaminEMgTarget', targetKey: 'vitamin_e_mg_target' },
      { key: 'vitaminKMcgTarget', targetKey: 'vitamin_k_mcg_target' },
      { key: 'thiaminMgTarget', targetKey: 'thiamin_mg_target' },
      { key: 'riboflavinMgTarget', targetKey: 'riboflavin_mg_target' },
      { key: 'niacinMgTarget', targetKey: 'niacin_mg_target' },
      { key: 'vitaminB6MgTarget', targetKey: 'vitamin_b6_mg_target' },
      { key: 'folateMcgTarget', targetKey: 'folate_mcg_target' },
      { key: 'vitaminB12McgTarget', targetKey: 'vitamin_b12_mcg_target' },
    ]
    for (const { key, targetKey } of microFields) {
      const value = parseMicroTarget(form[key])
      if (value != null) {
        microTargets[targetKey] = value
      }
    }
    return microTargets
  }

  const handleApplyCalibrationSuggestion = async (suggestion: HomeTargetCalibrationSuggestion) => {
    if (!suggestion?.suggested_kcal || suggestion.suggested_kcal <= 0) return
    const baseMacros = parseMacroTargets(targetForm) || getMacroTargetsFromIntake(intakeData)
    const scaledMacros = scaleMacrosByCalorieTarget(suggestion.suggested_kcal, baseMacros)
    const aligned = alignPayloadWithCalorieTarget({
      calorie_target: suggestion.suggested_kcal,
      protein_target: Number(formatTargetInput(scaledMacros.protein)),
      carbs_target: Number(formatTargetInput(scaledMacros.carbs)),
      fat_target: Number(formatTargetInput(scaledMacros.fat))
    })
    const payload: DashboardTargetsUpdateInput = {
      ...aligned.payload,
      micro_targets: buildMicroTargetsFromForm(targetForm),
    }
    setTargetForm(createTargetForm({
      ...intakeData,
      target: payload.calorie_target,
      macros: {
        protein: { ...intakeData.macros.protein, target: payload.protein_target },
        carbs: { ...intakeData.macros.carbs, target: payload.carbs_target },
        fat: { ...intakeData.macros.fat, target: payload.fat_target }
      }
    }))
    setSavingTargets(true)
    try {
      await updateDashboardTargets(payload)
      setShowTargetEditor(false)
      await loadDashboard(selectedDateRef.current || formatDateKey(new Date()))
      Taro.showToast({ title: '基础目标已按建议更新', icon: 'success' })
    } catch (error) {
      await showUnifiedApiError(error, '应用建议失败')
    } finally {
      setSavingTargets(false)
    }
  }

  const handleDismissCalibrationSuggestion = () => {
    Taro.showToast({ title: '已暂不调整', icon: 'none' })
  }

  const handleQuickRecord = () => {
    if (!getAccessToken()) {
      redirectToLogin()
      return
    }
    setShowRecordMenu(true)
  }

  const handleViewAllMeals = () => {
    if (!getAccessToken()) {
      redirectToLogin()
      return
    }
    const raw = selectedDateRef.current || formatDateKey(new Date())
    const d = mapCalendarDateToApi(raw) || raw
    Taro.navigateTo({ url: `${extraPkgUrl('/pages/day-record/index')}?date=${encodeURIComponent(d)}` })
  }

  /** 「查看饮食统计」入口：进入当日记录列表 */
  const openDayRecordForSelectedDate = React.useCallback(() => {
    if (!getAccessToken()) {
      redirectToLogin()
      return
    }
    const d = mapCalendarDateToApi(selectedDate) || selectedDate
    Taro.navigateTo({ url: `${extraPkgUrl('/pages/day-record/index')}?date=${encodeURIComponent(d)}` })
  }, [selectedDate])

  /** 今日餐食单条 → 弹出记录操作菜单（多条同餐时先选记录） */
  const openMealRecordDetail = React.useCallback((meal: HomeMealItem) => {
    if (!getAccessToken()) {
      redirectToLogin()
      return
    }

    const openActionSheet = (recordId: string) => {
      setMealActionRecordId(recordId)
      setMealActionSheetVisible(true)
    }

    const entries = Array.isArray(meal.meal_record_entries) ? meal.meal_record_entries.filter((e) => e && String(e.id || '').trim()) : []
    if (entries.length === 0) {
      const rid = resolveHomeMealPrimaryRecordId(meal)
      if (!rid) {
        const raw = selectedDateRef.current || formatDateKey(new Date())
        const d = mapCalendarDateToApi(raw) || raw
        Taro.navigateTo({ url: `${extraPkgUrl('/pages/day-record/index')}?date=${encodeURIComponent(d)}` })
        return
      }
      openActionSheet(rid)
      return
    }
    if (entries.length === 1) {
      openActionSheet(entries[0].id)
      return
    }
    // 多条记录 → 弹出自定义面板
    setMealRecordsDialogMeal(meal)
    setMealRecordsDialogVisible(true)
  }, [])

  /** 从多记录面板中选择一条 → 关闭面板 → 打开操作菜单 */
  const handleSelectMealRecord = React.useCallback((recordId: string) => {
    setMealRecordsDialogVisible(false)
    setMealActionRecordId(recordId)
    setMealActionSheetVisible(true)
  }, [])

  const handleMealEdit = async () => {
    if (!mealActionRecordId) return
    Taro.showLoading({ title: '', mask: true })
    try {
      const res = await getFoodRecordById(mealActionRecordId)
      setMealActionRecord(res.record)
      setShowRecordEditModal(true)
    } catch (e: any) {
      await showUnifiedApiError(e, '加载失败')
    } finally {
      Taro.hideLoading()
    }
  }

  const handleMealFavorite = async () => {
    if (!mealActionRecordId || mealFavoriteInFlightRef.current) return

    mealFavoriteInFlightRef.current = true
    try {
      Taro.showLoading({ title: '', mask: true })
      let record = getCachedMealFullRecord(mealActionRecordId)
      if (!record || !String(record.id || '').trim()) {
        const res = await getFoodRecordById(mealActionRecordId)
        record = res.record
      }
      Taro.hideLoading()

      if (!record) {
        Taro.showToast({ title: '记录加载失败', icon: 'none' })
        return
      }
      if (record.recipe_id) {
        Taro.showToast({ title: '该餐食已在我的收藏中', icon: 'none' })
        return
      }

      const draft = buildFoodRecordFavoriteDraft(record)
      if (draft.items.length === 0) {
        Taro.showToast({ title: '没有可收藏的食物', icon: 'none' })
        return
      }

      const modalResult = await Taro.showModal({
        title: '收藏餐食',
        content: draft.suggestedName,
        editable: true,
        placeholderText: '请输入收藏名称',
        confirmText: '收藏',
        confirmColor: '#10b981',
      } as any)
      if (!modalResult.confirm) return

      const recipeName = String((modalResult as any).content || '').trim()
      if (!recipeName) {
        Taro.showToast({ title: '请输入收藏名称', icon: 'none' })
        return
      }

      const { suggestedName: _suggestedName, ...recipeData } = draft
      Taro.showLoading({ title: '', mask: true })
      await createUserRecipe({ ...recipeData, recipe_name: recipeName })
      Taro.hideLoading()
      Taro.showToast({ title: '收藏成功', icon: 'success' })
    } catch (e: any) {
      Taro.hideLoading()
      await showUnifiedApiError(e, '收藏失败')
    } finally {
      mealFavoriteInFlightRef.current = false
    }
  }

  const handleMealPoster = async () => {
    if (!mealActionRecordId) return
    const cachedRecord = getCachedMealFullRecord(mealActionRecordId)
    if (
      cachedRecord &&
      String(cachedRecord.id || '').trim() &&
      String(cachedRecord.user_id || '').trim()
    ) {
      setMealActionRecord(cachedRecord)
      setShowRecordPosterModal(true)
      return
    }
    Taro.showLoading({ title: '加载中...', mask: true })
    try {
      const res = await getFoodRecordById(mealActionRecordId)
      const nextRecord = res.record
      if (!nextRecord || !String(nextRecord.id || '').trim() || !String(nextRecord.user_id || '').trim()) {
        throw new Error('记录信息不完整，请稍后重试')
      }
      setMealActionRecord(nextRecord)
      setShowRecordPosterModal(true)
    } catch (e: any) {
      await showUnifiedApiError(e, '加载失败')
    } finally {
      Taro.hideLoading()
    }
  }

  const handleMealShare = async () => {
    if (!mealActionRecordId) return
    try {
      Taro.showLoading({ title: '加载中...', mask: true })
      let record = getCachedMealFullRecord(mealActionRecordId)
      if (!record || !String(record.id || '').trim()) {
        const res = await getFoodRecordById(mealActionRecordId)
        record = res.record
      }
      if (!record) {
        Taro.hideLoading()
        Taro.showToast({ title: '记录加载失败', icon: 'none' })
        return
      }
      const items = (record.items || []).map((item: any) => ({
        name: item.name || '',
        weight: item.weight || 0,
        nutrients: item.nutrients
      }))
      const shareData = {
        imageUrl: record.image_path || '',
        imageUrls: record.image_paths || [],
        description: record.description || '',
        insight: record.insight || '',
        items,
        totalCalories: record.total_calories || 0,
        totalProtein: record.total_protein || 0,
        totalCarbs: record.total_carbs || 0,
        totalFat: record.total_fat || 0
      }
      Taro.setStorageSync('analyzeShareData', shareData)
      Taro.hideLoading()
      Taro.navigateTo({ url: `${extraPkgUrl('/pages/food-library-share/index')}?from_analyze=1` })
    } catch (e: any) {
      Taro.hideLoading()
      await showUnifiedApiError(e, '加载失败')
    }
  }

  const handleMealDelete = async () => {
    if (!mealActionRecordId) return
    const currentDate = selectedDateRef.current || formatDateKey(new Date())
    const waterTotalBeforeDelete = getTodayWater(bodyMetrics, currentDate).total
    const { confirm } = await Taro.showModal({
      title: '确认删除',
      content: '确定要删除这条饮食记录吗？删除后不可恢复。',
      confirmText: '删除',
      confirmColor: '#e53e3e',
    })
    if (!confirm) return

    Taro.showLoading({ title: '删除中...', mask: true })
    try {
      let deletedWaterMl = calculateFoodRecordWaterMl(getCachedMealFullRecord(mealActionRecordId))
      if (deletedWaterMl <= 0) {
        try {
          const res = await getFoodRecordById(mealActionRecordId)
          deletedWaterMl = calculateFoodRecordWaterMl(res.record)
        } catch {
          deletedWaterMl = 0
        }
      }

      await deleteFoodRecord(mealActionRecordId)

      // 先从当前 meals 中移除被删记录，做乐观更新
      let found = false
      const updatedMeals = meals.map((meal) => {
        const entries = meal.meal_record_entries || []
        const idx = entries.findIndex((e) => e.id === mealActionRecordId)
        if (idx === -1) return meal
        found = true
        const newEntries = entries.filter((_, i) => i !== idx)
        if (newEntries.length === 0) return null
        return { ...meal, meal_record_entries: newEntries }
      }).filter(Boolean) as HomeMealItem[]

      if (found) {
        setMeals(updatedMeals)
      }

      // 重新从后端拉取当日 dashboard，确保能量、宏量等数据准确
      await syncDashboardForDate(currentDate)
      if (deletedWaterMl > 0) {
        const expectedMaxWaterTotal = Math.max(0, waterTotalBeforeDelete - deletedWaterMl)
        setBodyMetrics(prev => {
          const next = reduceWaterForDate(prev, currentDate, deletedWaterMl, expectedMaxWaterTotal)
          saveBodyMetrics(next)
          return next
        })
      }

      try {
        Taro.eventCenter.trigger(HOME_INTAKE_DATA_CHANGED_EVENT)
        Taro.eventCenter.trigger(COMMUNITY_FEED_CHANGED_EVENT)
      } catch {
        /* ignore */
      }

      Taro.showToast({ title: '已删除', icon: 'success' })
    } catch (e: any) {
      await showUnifiedApiError(e, '删除失败')
    } finally {
      Taro.hideLoading()
    }
  }

  const handleRecordEditSuccess = () => {
    setShowRecordEditModal(false)
    const raw = selectedDateRef.current || formatDateKey(new Date())
    syncDashboardForDate(raw)
  }

  const openFoodExpiryList = () => {
    if (!getAccessToken()) {
      redirectToLogin()
      return
    }
    Taro.navigateTo({ url: extraPkgUrl('/pages/expiry/index') })
  }

  const openFoodExpiryEdit = (id: string) => {
    if (!getAccessToken()) {
      redirectToLogin()
      return
    }
    Taro.navigateTo({ url: `${extraPkgUrl('/pages/expiry-edit/index')}?id=${encodeURIComponent(id)}` })
  }

  const openExerciseRecord = () => {
    if (!getAccessToken()) {
      redirectToLogin()
      return
    }
    const date = selectedDateRef.current || formatDateKey(new Date())
    Taro.navigateTo({ url: `${extraPkgUrl('/pages/exercise-record/index')}?date=${encodeURIComponent(date)}` })
  }

  const openBodyMetricRecord = (type: 'weight' | 'water' | 'exercise') => {
    if (!getAccessToken()) {
      redirectToLogin()
      return
    }
    const date = selectedDateRef.current || formatDateKey(new Date())
    const page = type === 'weight'
      ? '/pages/weight-record/index'
      : type === 'water'
        ? '/pages/water-record/index'
        : '/pages/exercise-record/index'
    Taro.navigateTo({
      url: `${extraPkgUrl(page)}?date=${encodeURIComponent(date)}`
    })
  }

  const buildDietRecommendationPayload = React.useCallback((scene: DietRecommendationScene) => {
    const macros = intakeData.macros
    const calorieRemaining = Math.max(0, Number((intakeData.target - intakeData.current).toFixed(1)))
    const proteinGap = Math.max(0, Number(((macros.protein?.target || 0) - (macros.protein?.current || 0)).toFixed(1)))
    const carbsGap = Math.max(0, Number(((macros.carbs?.target || 0) - (macros.carbs?.current || 0)).toFixed(1)))
    const fatGap = Math.max(0, Number(((macros.fat?.target || 0) - (macros.fat?.current || 0)).toFixed(1)))
    return {
      scene,
      date: mapCalendarDateToApi(selectedDateRef.current || selectedDate) || selectedDate,
      calorie_remaining: calorieRemaining,
      macro_gaps: {
        calories: calorieRemaining,
        protein: proteinGap,
        carbs: carbsGap,
        fat: fatGap
      },
      targets: {
        calories: intakeData.target,
        protein: macros.protein?.target || 0,
        carbs: macros.carbs?.target || 0,
        fat: macros.fat?.target || 0
      },
      current: {
        calories: intakeData.current,
        protein: macros.protein?.current || 0,
        carbs: macros.carbs?.current || 0,
        fat: macros.fat?.current || 0
      },
      meals: (meals || []).map((meal) => ({
        type: meal.type,
        name: meal.name,
        description: meal.description || '',
        calories: normalizeDisplayNumber(meal.calorie),
        protein: normalizeDisplayNumber(meal.protein),
        carbs: normalizeDisplayNumber(meal.carbs),
        fat: normalizeDisplayNumber(meal.fat)
      }))
    }
  }, [intakeData, meals, selectedDate])

  const requestDietRecommendation = React.useCallback(async (scene: DietRecommendationScene) => {
    if (!getAccessToken()) {
      redirectToLogin()
      return
    }
    setDietRecScene(scene)
    setDietRecVisible(true)
    setDietRecLoading(true)
    const requestSeq = ++dietRecRequestSeqRef.current
    try {
      const result = await generateDietRecommendation(buildDietRecommendationPayload(scene))
      if (requestSeq === dietRecRequestSeqRef.current) {
        setDietRecResult(result)
      }
    } catch (error) {
      if (requestSeq === dietRecRequestSeqRef.current) {
        await showUnifiedApiError(error, '生成推荐失败')
      }
    } finally {
      if (requestSeq === dietRecRequestSeqRef.current) {
        setDietRecLoading(false)
      }
    }
  }, [buildDietRecommendationPayload])

  const openDietRecommendation = React.useCallback((scene: DietRecommendationScene) => {
    void requestDietRecommendation(scene)
  }, [requestDietRecommendation])

  const handleDietRecommendationSceneChange = React.useCallback((scene: DietRecommendationScene) => {
    if (scene === dietRecScene && dietRecResult) return
    void requestDietRecommendation(scene)
  }, [dietRecScene, dietRecResult, requestDietRecommendation])

  const refreshDietRecommendation = React.useCallback(() => {
    void requestDietRecommendation(dietRecScene)
  }, [dietRecScene, requestDietRecommendation])

  // 切日专用轻量同步：仅拉取该日 dashboard + 运动，不重复请求周统计/身体指标
  const syncDashboardForDate = React.useCallback(async (date: string) => {
    // 若同日期请求已在进行中，跳过本次调用
    if (
      syncDashboardPendingRef.current &&
      syncDashboardPendingRef.current.date === date
    ) {
      return
    }
    const seq = ++syncDashboardSeqRef.current
    syncDashboardPendingRef.current = { date, seq }
    if (!getAccessToken()) {
      syncDashboardPendingRef.current = null
      return
    }
    setDataSyncing(true)
    try {
      const [res, exerciseLogsRes, bodyMetricsRes] = await Promise.all([
        getHomeDashboard(date),
        getExerciseLogs({ date }).catch(() => null),
        getBodyMetricsSummary('week').catch(() => null)
      ])
      if (seq !== syncDashboardSeqRef.current) return
      const intake = res.intakeData
      const nextExerciseKcal = mergeExerciseKcalFromDashboardAndLogs(res.exerciseBurnedKcal, exerciseLogsRes?.total_calories)
      const nextAchievement = res.achievement ?? { streak_days: 0, green_days: 0 }
      setIntakeData(intake)
      setMeals(res.meals || [])
      setExpirySummary(res.expirySummary || DEFAULT_EXPIRY_SUMMARY)
      setExerciseBurnedKcal(nextExerciseKcal)
      setHomeAchievement(nextAchievement)
      setNutritionTarget(res.nutritionTarget || null)
      setTargetForm(createTargetForm(intake))
      const normalizedDate = mapCalendarDateToApi(date) || date
      saveHomeDashboardSnapshot({
        date: normalizedDate,
        updatedAt: Date.now(),
        intakeData: intake,
        nutritionTarget: res.nutritionTarget || null,
        meals: res.meals || [],
        expirySummary: res.expirySummary || DEFAULT_EXPIRY_SUMMARY,
        exerciseBurnedKcal: nextExerciseKcal,
        achievement: nextAchievement
      })
      setCalendarHistoryCells(prev => {
        const nextCell = createCalendarHeatmapCell(
          normalizedDate,
          intake.current,
          intake.target,
          Boolean(res.meals?.length)
        )
        return [...prev.filter(cell => cell.date !== normalizedDate), nextCell]
          .sort((a, b) => a.date.localeCompare(b.date))
      })
      if (bodyMetricsRes) {
        setBodyMetrics(prev => {
          const next = applyCloudBodyMetrics(prev, {
            weight_entries: bodyMetricsRes.weight_entries,
            water_daily: bodyMetricsRes.water_daily,
            water_goal_ml: bodyMetricsRes.water_goal_ml
          })
          saveBodyMetrics(next)
          return next
        })
      }
      // 同步更新该日期在周热图中的颜色
      setWeekHeatmapCells(prev => prev.map(cell => {
        if (cell.date !== date) return cell
        const calories = intake.current
        const target = intake.target
        const hasRecord = calories > 0 || (meals.length > 0)
        return {
          ...cell,
          calories,
          target,
          intakeRatio: hasRecord ? calories / target : 0,
          state: !hasRecord ? 'none' : calories > target ? 'surplus' : 'deficit',
          hasRecord
        }
      }))
      homeLastLoadRef.current = { date, ts: Date.now() }
      homeDataStaleRef.current = false
    } catch (err) {
      // 静默失败，不打扰用户；本地缓存已保证基本可用性
    } finally {
      if (syncDashboardPendingRef.current?.seq === seq) {
        syncDashboardPendingRef.current = null
      }
      setDataSyncing(false)
    }
  }, [setIntakeData, setMeals, setExpirySummary, setExerciseBurnedKcal, setHomeAchievement, setTargetForm])

  const handleDateSelect = (date: string) => {
    console.log('[DEBUG] 点击日期:', date, '当前日期:', selectedDate)
    skipNextRefreshRef.current = true
    const committedDate = commitSelectedDate(date)
    // 1. 无条件从本地缓存读取并立刻渲染
    const localSnapshot = getStoredHomeDashboardSnapshotByDate(committedDate)
    if (localSnapshot) {
      console.log('[DEBUG] 命中本地缓存:', committedDate)
      setIntakeData(localSnapshot.intakeData)
      setNutritionTarget(localSnapshot.nutritionTarget || null)
      setMeals(localSnapshot.meals || [])
      setExpirySummary(localSnapshot.expirySummary || DEFAULT_EXPIRY_SUMMARY)
      setExerciseBurnedKcal(localSnapshot.exerciseBurnedKcal || 0)
      setHomeAchievement(localSnapshot.achievement || { streak_days: 0, green_days: 0 })
      setTargetForm(createTargetForm(localSnapshot.intakeData || DEFAULT_INTAKE))
    } else {
      console.log('[DEBUG] 未命中本地缓存, 清空为默认态:', committedDate)
      setIntakeData(DEFAULT_INTAKE)
      setNutritionTarget(null)
      setMeals([])
      setExpirySummary(DEFAULT_EXPIRY_SUMMARY)
      setExerciseBurnedKcal(0)
      setHomeAchievement({ streak_days: 0, green_days: 0 })
      setTargetForm(createTargetForm(DEFAULT_INTAKE))
    }
    // 2. 结束 loading，确保用户立刻看到内容（或默认空态）
    setLoading(false)
    setIsSwitchingDate(false)
    // 3. 后台异步同步该日数据
    void syncDashboardForDate(committedDate)
  }

  // 体重/喝水相关回调函数
  const openWeightEditor = () => {
    if (!getAccessToken()) {
      redirectToLogin()
      return
    }
    const summary = deriveWeightSummary(bodyMetrics.weightEntries, selectedDate)
    setWeightInput(summary.latestWeight ? String(summary.latestWeight.value) : '')
    setShowWeightEditor(true)
  }

  const handleSaveWeight = async () => {
    const value = parseCompleteNumber(weightInput)
    if (value == null || value < 20 || value > 300) {
      Taro.showToast({ title: '请输入有效的体重值 (20-300 kg)', icon: 'none' })
      return
    }

    setSavingWeight(true)
    try {
      const res = await saveBodyWeightRecord(value, selectedDate)

      setBodyMetrics(prev => {
        const existingIndex = prev.weightEntries.findIndex(e => e.date === selectedDate)
        let nextEntries: WeightRecordEntry[]

        if (existingIndex >= 0) {
          nextEntries = [...prev.weightEntries]
          nextEntries[existingIndex] = {
            date: selectedDate,
            value: res.item.value,
            recorded_at: res.item.recorded_at || new Date().toISOString()
          }
        } else {
          nextEntries = [
            ...prev.weightEntries,
            {
              date: selectedDate,
              value: res.item.value,
              recorded_at: res.item.recorded_at || new Date().toISOString()
            }
          ]
        }

        nextEntries = sortWeightEntries(nextEntries).slice(-WEIGHT_HISTORY_LIMIT)
        const next = { ...prev, weightEntries: nextEntries }
        saveBodyMetrics(next)
        return next
      })

      setShowWeightEditor(false)
      Taro.showToast({ title: '体重已记录', icon: 'success' })
    } catch (error) {
      await showUnifiedApiError(error, '保存失败')
    } finally {
      setSavingWeight(false)
    }
  }

  const openWaterEditor = () => {
    if (!getAccessToken()) {
      redirectToLogin()
      return
    }
    const recordDate = getLastHomeSelectedDate(selectedDateRef.current || selectedDate || formatDateKey(new Date()))
    if (waterBlurTimerRef.current) {
      clearTimeout(waterBlurTimerRef.current)
      waterBlurTimerRef.current = null
    }
    setWaterEditorDate(recordDate)
    setWaterInput('')
    setWaterInputFocused(false)
    setShowWaterEditor(true)
  }

  const addWaterAmount = async (amount: number, targetDate = waterEditorDate || selectedDateRef.current || selectedDate) => {
    if (!getAccessToken()) {
      redirectToLogin()
      return
    }

    const recordDate = targetDate || formatDateKey(new Date())

    setSavingWater(true)
    try {
      await addBodyWaterLog(amount, recordDate)

      setBodyMetrics(prev => {
        const next = addWaterToMetrics(prev, recordDate, amount)
        saveBodyMetrics(next)
        return next
      })

      Taro.showToast({ title: `已添加 ${amount}ml`, icon: 'success' })
    } catch (error) {
      await showUnifiedApiError(error, '记录失败')
    } finally {
      setSavingWater(false)
    }
  }

  const handleSaveWater = async () => {
    const amount = parseCompleteNumber(waterInput)
    if (amount == null || amount < 1 || amount > 5000) {
      Taro.showToast({ title: '请输入有效的喝水量 (1-5000 ml)', icon: 'none' })
      return
    }

    await addWaterAmount(amount, waterEditorDate)
    setShowWaterEditor(false)
    setWaterInput('')
    setWaterInputFocused(false)
  }

  const clearTodayWater = async () => {
    if (!getAccessToken()) {
      redirectToLogin()
      return
    }

    try {
      const recordDate = waterEditorDate || selectedDateRef.current || selectedDate || formatDateKey(new Date())
      await resetBodyWaterLogs(recordDate)

      setBodyMetrics(prev => {
        const next = clearWaterForDate(prev, recordDate)
        saveBodyMetrics(next)
        return next
      })

      setShowWaterEditor(false)
      setWaterInputFocused(false)
      Taro.showToast({ title: '已清空今日喝水记录', icon: 'success' })
    } catch (error) {
      await showUnifiedApiError(error, '清空失败')
    }
  }

  // 餐食图片预览
  const previewHomeMealImages = (meal: HomeMealItem, startIndex = 0) => {
    const images = collectFoodDisplayImageUrls(meal)
    if (images.length === 0) return

    Taro.previewImage({
      current: images[startIndex] || images[0],
      urls: images
    })
  }

  // 刷新身体指标数据
  const refreshBodyMetrics = React.useCallback(async () => {
    if (!getAccessToken()) return
    try {
      const res = await getBodyMetricsSummary('week')
      setBodyMetrics(prev => {
        const next = applyCloudBodyMetrics(prev, {
          weight_entries: res.weight_entries,
          water_daily: res.water_daily,
          water_goal_ml: res.water_goal_ml
        })
        saveBodyMetrics(next)
        return next
      })
    } catch (error) {
      console.error('刷新身体指标失败:', error)
    }
  }, [])

  const totalCurrent = normalizeDisplayNumber(intakeData.current)
  const totalTarget = normalizeDisplayNumber(intakeData.target)
  const remainingCalories = Math.max(0, Number((totalTarget - totalCurrent).toFixed(1)))
  const calorieProgress = normalizeProgressPercent(intakeData.progress, totalCurrent, totalTarget)
  /** 摄入超过目标时，下方进度条用警示红（与营养素超标一致） */
  const isCalorieOver = totalCurrent > totalTarget
  /** 左侧主数字：未超标为剩余可摄入；超标为超出目标的量（正数） */
  const calorieHeadlineBase = isCalorieOver
    ? Number((totalCurrent - totalTarget).toFixed(1))
    : remainingCalories

  /** 与 selectedDate 组合：切日后先 busy 再 idle；仅传日期时 resetDep 不变，遮罩结束时看不到缓动 */
  const dashboardBusy = loading || isSwitchingDate
  const dashboardAnimResetKey = `${selectedDate}|${dashboardBusy ? 'busy' : 'idle'}`

  /** 与主热量条、三大营养素圆环同为 600ms + easeOutCubic，避免数字与条不同步 */
  const animatedHeadlineCalories = useAnimatedNumber(calorieHeadlineBase, 600, 0, dashboardAnimResetKey)
  /** 登录用户展示食物保质期区块（无数据时显示引导） */
  const showFoodExpiryBlock = Boolean(getAccessToken())
  /** 未登录访客态 */
  const isGuest = !getAccessToken()

  const calorieInputValue = parseCompleteNumber(targetForm.calorieTarget)
  const macroInputValues = parseMacroTargets(targetForm)
  const caloriesFromMacroInputs = macroInputValues ? calcCaloriesFromMacros(macroInputValues) : null
  const calorieGap =
    calorieInputValue != null && caloriesFromMacroInputs != null
      ? Number((calorieInputValue - caloriesFromMacroInputs).toFixed(1))
      : null
  const isRelationAligned = calorieGap != null && Math.abs(calorieGap) <= 1

  // 体重/喝水计算
  const weightSummary = React.useMemo(() =>
    deriveWeightSummary(bodyMetrics.weightEntries, selectedDate),
    [bodyMetrics.weightEntries, selectedDate]
  )

  const todayWater = React.useMemo(() =>
    getTodayWater(bodyMetrics, selectedDate),
    [bodyMetrics, selectedDate]
  )

  const waterEditorWater = React.useMemo(() =>
    getTodayWater(bodyMetrics, waterEditorDate || selectedDate),
    [bodyMetrics, selectedDate, waterEditorDate]
  )

  const waterProgress = calculateProgressPercent(todayWater.total, bodyMetrics.waterGoalMl)

  /** 三大营养素：用于圆环与中心克数缓动（与主热量条、喝水条一致，从 0/上一段插值到当前） */
  const proteinCur = normalizeDisplayNumber(intakeData.macros.protein.current)
  const proteinTargetRaw = normalizeDisplayNumber(intakeData.macros.protein.target)
  const proteinRingPct = Math.min(100, calculateProgressPercent(proteinCur, proteinTargetRaw))

  const carbsCur = normalizeDisplayNumber(intakeData.macros.carbs.current)
  const carbsTargetRaw = normalizeDisplayNumber(intakeData.macros.carbs.target)
  const carbsRingPct = Math.min(100, calculateProgressPercent(carbsCur, carbsTargetRaw))

  const fatCur = normalizeDisplayNumber(intakeData.macros.fat.current)
  const fatTargetRaw = normalizeDisplayNumber(intakeData.macros.fat.target)
  const fatRingPct = Math.min(100, calculateProgressPercent(fatCur, fatTargetRaw))

  const waterDraftMl = parseCompleteNumber(waterInput)
  const showWaterAddFooter =
    waterInputFocused || (waterDraftMl != null && waterDraftMl > 0)

  // 喝水动画：切换日期时不播放动画，直接显示最终数字
  const animatedWaterTotal = useAnimatedNumber(todayWater.total, 600, 0, dashboardAnimResetKey, true)
  const animatedWaterProgress = useAnimatedProgress(waterProgress, 600, 0, dashboardAnimResetKey, true)

  /** 主热量进度条宽度（0～100），与上方 headline 数字同源缓动 */
  const animatedMainCalorieBarPct = useAnimatedProgress(
    dashboardBusy ? 0 : clampVisualProgress(calorieProgress),
    600,
    0,
    dashboardAnimResetKey
  )

  const animatedMacroProteinNum = useAnimatedNumber(dashboardBusy ? 0 : proteinCur, 600, 0, dashboardAnimResetKey)
  const animatedMacroCarbsNum = useAnimatedNumber(dashboardBusy ? 0 : carbsCur, 600, 0, dashboardAnimResetKey)
  const animatedMacroFatNum = useAnimatedNumber(dashboardBusy ? 0 : fatCur, 600, 0, dashboardAnimResetKey)

  const animatedMacroProteinRing = useAnimatedProgress(dashboardBusy ? 0 : proteinRingPct, 600, 0, dashboardAnimResetKey)
  const animatedMacroCarbsRing = useAnimatedProgress(dashboardBusy ? 0 : carbsRingPct, 600, 0, dashboardAnimResetKey)
  const animatedMacroFatRing = useAnimatedProgress(dashboardBusy ? 0 : fatRingPct, 600, 0, dashboardAnimResetKey)

  /** 运动消耗：切换日期时不播放动画，直接显示最终数字 */
  const exerciseAnimTarget = dashboardBusy ? 0 : exerciseBurnedKcal
  const animatedExerciseBurnedKcal = useAnimatedNumber(exerciseAnimTarget, 600, 0, dashboardAnimResetKey, true)
  const loadPetSummary = React.useCallback(async (date: string) => {
    if (!getAccessToken()) {
      setPetSummary(null)
      return
    }
    const seq = ++petSummarySeqRef.current
    try {
      const summary = await getPetSummary(date)
      if (seq === petSummarySeqRef.current) {
        setPetSummary(summary)
      }
    } catch (error) {
      console.warn('宠物状态加载失败，使用本地原型兜底:', error)
      if (seq === petSummarySeqRef.current) {
        setPetSummary(null)
      }
    }
  }, [])

  React.useEffect(() => {
    void loadPetSummary(selectedDate)
  }, [loadPetSummary, selectedDate])

  useDidShow(() => {
    if (petDidShowCountRef.current === 0) {
      petDidShowCountRef.current += 1
      return
    }
    void loadPetSummary(selectedDateRef.current)
  })

  React.useEffect(() => {
    const handlePetProfileChanged = (pet: PetProfile) => {
      if (!pet?.id) return
      setPetSummary((previous) => previous ? { ...previous, pet } : previous)
    }
    Taro.eventCenter.on(HOME_PET_PROFILE_CHANGED_EVENT, handlePetProfileChanged)
    return () => {
      Taro.eventCenter.off(HOME_PET_PROFILE_CHANGED_EVENT, handlePetProfileChanged)
    }
  }, [])

  const healthyHabitScore = React.useMemo(() => {
    if (dashboardBusy || isGuest) return 0
    let score = 0
    if (totalCurrent > 0 && totalTarget > 0 && totalCurrent <= totalTarget) score += 1
    if (proteinTargetRaw > 0 && proteinCur >= proteinTargetRaw * 0.75) score += 1
    if (todayWater.total >= bodyMetrics.waterGoalMl * 0.6) score += 1
    if (exerciseBurnedKcal > 0) score += 1
    return score
  }, [
    bodyMetrics.waterGoalMl,
    dashboardBusy,
    exerciseBurnedKcal,
    isGuest,
    proteinCur,
    proteinTargetRaw,
    todayWater.total,
    totalCurrent,
    totalTarget
  ])
  const petEvent = petSummary?.event && !petSummary.event.is_claimed ? petSummary.event : null
  const petMood = petSummary?.status?.mood || (dashboardBusy || isGuest
    ? 'calm'
    : healthyHabitScore >= 3
      ? 'happy'
      : healthyHabitScore >= 1
        ? 'calm'
        : 'sleepy')
  const petState = petSummary?.status?.state || petMood
  const petMealState = petSummary?.status?.meal_state || (totalCurrent > 0 ? 'fed' : 'hungry')
  const petDialogText = petEvent?.message || (dashboardBusy
    ? '我看看今天的状态。'
    : isGuest
      ? '登录后，我会一直陪你。'
      : petMealState === 'satisfied'
        ? '三餐记好啦，今天也很棒。'
        : petMealState === 'fed'
          ? '这一餐记住啦。'
          : '今天还没见到你的饭哦。')
  const triggerPetCelebration = React.useCallback(() => {
    if (petCelebrationTimerRef.current) {
      clearTimeout(petCelebrationTimerRef.current)
    }
    setPetCelebrating(false)
    petCelebrationTimerRef.current = setTimeout(() => {
      setPetCelebrating(true)
      petCelebrationTimerRef.current = setTimeout(() => {
        setPetCelebrating(false)
        petCelebrationTimerRef.current = null
      }, 820)
    }, 16)
  }, [])

  React.useEffect(() => () => {
    if (petCelebrationTimerRef.current) {
      clearTimeout(petCelebrationTimerRef.current)
    }
  }, [])

  const handleClaimPetEvent = React.useCallback(async () => {
    if (!petEvent || petClaiming) return
    setPetClaiming(true)
    try {
      const result = await claimPetEvent(petEvent.id)
      setPetSummary((prev) => prev ? { ...prev, pet: result.pet, event: result.event, status: { ...prev.status, message: '奖励已收下，我又长大了一点。' } } : prev)
      triggerPetCelebration()
      const parts: string[] = []
      if (result.credits_awarded > 0) parts.push(`+${result.credits_awarded}积分`)
      if (result.exp_awarded > 0) parts.push(`+${result.exp_awarded}经验`)
      Taro.showToast({ title: parts.length ? `领取成功 ${parts.join(' ')}` : '已领取', icon: 'none' })
    } catch (error) {
      await showUnifiedApiError(error, '领取宠物奖励失败')
    } finally {
      setPetClaiming(false)
    }
  }, [petClaiming, petEvent, triggerPetCelebration])
  const togglePetCollapsed = React.useCallback(() => {
    setPetCollapsed((prev) => {
      const next = !prev
      try {
        Taro.setStorageSync(HOME_PET_COLLAPSED_KEY, next ? '1' : '0')
      } catch (_) {}
      setPetFloatPosition((current) => {
        const adjusted = clampPetFloatPosition(current.left, current.top, next)
        savePetFloatPosition(adjusted)
        return adjusted
      })
      return next
    })
  }, [])
  const openPetChat = React.useCallback(() => {
    Taro.navigateTo({ url: extraPkgUrl('/pages/pet-chat/index') })
  }, [])
  const handlePetTouchStart = React.useCallback((event) => {
    const touch = event.touches?.[0]
    if (!touch) return
    petDragRef.current = {
      pointerId: touch.identifier ?? 0,
      startClientX: touch.clientX,
      startClientY: touch.clientY,
      startLeft: petFloatPosition.left,
      startTop: petFloatPosition.top,
      moved: false
    }
    setPetDragging(true)
  }, [petFloatPosition.left, petFloatPosition.top])

  const handlePetTouchMove = React.useCallback((event) => {
    const drag = petDragRef.current
    if (!drag) return
    const touches = Array.from(event.touches || []) as Array<{ identifier?: number; clientX: number; clientY: number }>
    const touch = touches.find((item: any) => (item.identifier ?? 0) === drag.pointerId) || touches[0]
    if (!touch) return
    const dx = touch.clientX - drag.startClientX
    const dy = touch.clientY - drag.startClientY
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) {
      drag.moved = true
    }
    setPetFloatPosition(clampPetFloatPosition(drag.startLeft + dx, drag.startTop + dy, petCollapsed))
  }, [petCollapsed])

  const handlePetTouchEnd = React.useCallback(() => {
    const drag = petDragRef.current
    petDragRef.current = null
    setPetDragging(false)
    setPetFloatPosition((current) => {
      const adjusted = clampPetFloatPosition(current.left, current.top, petCollapsed)
      savePetFloatPosition(adjusted)
      return adjusted
    })
    if (!drag) return
    if (drag.moved) {
      // 发生过拖动，阻止后续 click 被当成点击卡片
      petClickHandledRef.current = true
      return
    }
    if (petCollapsed) {
      // 收起态轻触展开；由 card onClick 兜底处理，这里先标记避免重复触发
      petClickHandledRef.current = true
      togglePetCollapsed()
    }
  }, [petCollapsed, togglePetCollapsed])

  const handleShareDailyPosterImage = React.useCallback(() => {
    if (!dailyPosterImageUrl) return
    // @ts-ignore
    Taro.showShareImageMenu({
      path: dailyPosterImageUrl,
      success: () => {
        void claimSharePosterRewardQuietly({ share_scope: 'daily_summary', share_date: selectedDate })
      },
      fail: (err: { errMsg?: string }) => {
        if (isShowShareImageMenuCancel(err)) return
        console.error('showShareImageMenu fail', err)
        void showUnifiedApiError(new Error('分享失败，请保存图片后手动发送'), '分享失败，请保存图片后手动发送')
      }
    })
  }, [dailyPosterImageUrl, selectedDate])

  const handleSaveDailyPoster = React.useCallback(() => {
    if (!dailyPosterImageUrl) return
    Taro.showShareImageMenu({
      path: dailyPosterImageUrl,
      fail: (err: { errMsg?: string }) => {
        if (isShowShareImageMenuCancel(err)) return
        console.error('showShareImageMenu fail', err)
        void showUnifiedApiError(new Error('打开图片菜单失败，请重试'), '打开图片菜单失败，请重试')
      }
    })
  }, [dailyPosterImageUrl])

  const handleShareDailySummary = React.useCallback(() => {
    if (!getAccessToken()) {
      redirectToLogin()
      return
    }
    if (loading || isSwitchingDate) {
      Taro.showToast({ title: '数据加载中，请稍候', icon: 'none' })
      return
    }
    if (dailyPosterGenerating) return

    setDailyPosterGenerating(true)
    Taro.showLoading({ title: '生成分享图...' })

    const query = Taro.createSelectorQuery()
    query
      .select('#homeDailyPosterCanvas')
      .fields({ node: true, size: true })
      .exec((res) => {
        if (!res?.[0]?.node) {
          Taro.hideLoading()
          setDailyPosterGenerating(false)
          Taro.showToast({ title: '画布未就绪，请重试', icon: 'none' })
          return
        }
        const canvas = res[0].node as HTMLCanvasElement & {
          createImage?: () => {
            src: string
            onload: () => void
            onerror: (err?: unknown) => void
            width: number
            height: number
          }
        }
        const dpr = 2

        const loadImage = async (src: string): Promise<{ width: number; height: number } | null> => {
          if (!src || !canvas.createImage) return null

          let localSrc: string
          try {
            localSrc = await resolveCanvasImageSrc(src)
          } catch (e) {
            console.error('resolveCanvasImageSrc fail', src, e)
            return null
          }

          return new Promise<{ width: number; height: number } | null>((resolve) => {
            const img = canvas.createImage!()
            img.onload = () => resolve(img)
            img.onerror = (e) => {
              console.error('Load image fail', localSrc, e)
              resolve(null)
            }
            img.src = localSrc
          })
        }

        const loadQRImage = async (inviteCode: string) => {
          const scene = inviteCode ? `fi=${inviteCode}` : 'share=1'
          try {
            const { base64 } = await getUnlimitedQRCode(scene, 'pages/index/index', getShareQrEnvVersion())
            const img = await loadImage(base64)
            if (img) return img
          } catch (e) {
            console.warn('QR code load failed for env=release', e)
          }
          return null
        }

        const run = async (): Promise<void> => {
          let inviteCode = ''
          let sharerNickname = ''
          let avatarUrl = ''
          try {
            const uid = Taro.getStorageSync('user_id') as string
            if (uid) {
              const profile = await getFriendInviteProfile(uid)
              sharerNickname = profile.nickname || ''
              avatarUrl = profile.avatar || ''
              inviteCode = profile.invite_code || getInviteCodeFromUserId(uid)
            }
          } catch {
            /* 无头像昵称仍可出图 */
          }

          const [qrImg, avatarImg] = await Promise.all([loadQRImage(inviteCode), loadImage(avatarUrl || '')])

          const ctx = canvas.getContext('2d')
          if (!ctx) {
            Taro.hideLoading()
            setDailyPosterGenerating(false)
            Taro.showToast({ title: '画布不可用', icon: 'none' })
            return
          }

          const totalCurrent = normalizeDisplayNumber(intakeData.current)
          const totalTarget = normalizeDisplayNumber(intakeData.target)
          const waterProg = clampVisualProgress(
            calculateProgressPercent(todayWater.total, bodyMetrics.waterGoalMl)
          )

          const posterData: DailySummaryPosterInput = {
            dateLabelPrimary: formatPosterDatePrimary(selectedDate),
            dateLabelSecondary: formatPosterWeekdayLabel(selectedDate),
            posterDateKey: selectedDate,
            intakeCurrent: totalCurrent,
            intakeTarget: totalTarget,
            streakDays: Math.max(0, Math.floor(homeAchievement.streak_days)),
            greenDays: Math.max(0, Math.floor(homeAchievement.green_days)),
            macros: {
              protein: {
                current: normalizeDisplayNumber(intakeData.macros.protein.current),
                target: normalizeDisplayNumber(intakeData.macros.protein.target)
              },
              carbs: {
                current: normalizeDisplayNumber(intakeData.macros.carbs.current),
                target: normalizeDisplayNumber(intakeData.macros.carbs.target)
              },
              fat: {
                current: normalizeDisplayNumber(intakeData.macros.fat.current),
                target: normalizeDisplayNumber(intakeData.macros.fat.target)
              }
            },
            waterProgressPct: waterProg,
            waterCurrentMl: todayWater.total,
            waterGoalMl: bodyMetrics.waterGoalMl,
            exerciseKcal: Math.round(exerciseBurnedKcal)
          }

          const heightPx = computeDailySummaryPosterHeight(posterData)

          canvas.width = POSTER_WIDTH * dpr
          canvas.height = heightPx * dpr

          // 预加载 iconfont，供 Canvas 绘制底部统计图标使用；字体走 CDN，避免占用主包体积。
          if (CANVAS_ICON_FONT_SOURCE) {
            try {
              const fontLoader = (canvas as any).loadFontFace
                ? (canvas as any).loadFontFace({
                    family: 'iconfont',
                    source: CANVAS_ICON_FONT_SOURCE,
                  })
                : Taro.loadFontFace({
                    family: 'iconfont',
                    source: CANVAS_ICON_FONT_SOURCE,
                    global: true,
                  })
              await fontLoader
              await new Promise((r) => setTimeout(r, 300))
            } catch {
              // ignore font load errors
            }
          }

          // 字体加载后重新获取 context，确保 canvas 能使用新字体
          const posterCtx = canvas.getContext('2d')
          if (posterCtx) {
            posterCtx.scale(dpr, dpr)
          }

          drawDailySummaryPoster(posterCtx || ctx, {
            width: POSTER_WIDTH,
            height: heightPx,
            data: posterData,
            qrCodeImage: qrImg,
            sharerNickname,
            sharerAvatarImage: avatarImg
          })

          // JPG：真机存相册对 PNG/透明导出偶发失败；今日小结海报为实底
          Taro.canvasToTempFilePath({
            canvas: canvas as any,
            destWidth: POSTER_WIDTH * 2,
            destHeight: heightPx * 2,
            fileType: 'jpg',
            quality: 0.95,
            success: (resp) => {
              Taro.hideLoading()
              setDailyPosterGenerating(false)
              setDailyPosterImageUrl(resp.tempFilePath)
              setShowDailyPosterModal(true)
            },
            fail: (err) => {
              Taro.hideLoading()
              setDailyPosterGenerating(false)
              void showUnifiedApiError(new Error('生成失败'), '生成失败')
              console.error('canvasToTempFilePath fail', err)
            }
          })
        }

        void run().catch((e) => {
          Taro.hideLoading()
          setDailyPosterGenerating(false)
          void showUnifiedApiError(e, '生成失败')
          console.error('daily summary poster', e)
        })
      })
  }, [
    loading,
    isSwitchingDate,
    dailyPosterGenerating,
    intakeData,
    selectedDate,
    todayWater,
    bodyMetrics.waterGoalMl,
    exerciseBurnedKcal,
    homeAchievement
  ])

  const backfillDismissedDateSet = new Set(dismissedBackfillDates)
  const showBackfillHint =
    isAllowedRecordDate(selectedDate) &&
    !isTodayRecordDate(selectedDate) &&
    !dashboardBusy &&
    !isGuest &&
    !backfillDismissedDateSet.has(selectedDate)
  const membershipCredits = getMembershipCreditSummary(membershipStatus)
  const availableRewardCredits = getAvailableRewardCredits(rewardCenter)
  const rewardHintTasks = rewardCenter?.tasks || []
  const showRewardCreditHint =
    availableRewardCredits > 0 &&
    (membershipCredits.remaining < LOW_CREDIT_REWARD_HINT_THRESHOLD || rewardHintTasks.some(isRewardTaskAvailable))
  const rewardHintTaskText = formatRewardHintTaskText(rewardHintTasks)
  const handbookBanners: HomeHandbookBanner[] = [
    {
      key: 'goose-duck-chicken',
      title: '鹅腿还是鸭腿？',
      desc: '上传图片，让食探只在鹅 / 鸭 / 鸡里做判断',
      url: extraPkgUrl('/pages/goose-duck-chicken/index'),
      bgImage: GOOSE_DUCK_CHICKEN_BG_URL,
    },
    ...(showRewardCreditHint ? [{
      key: 'reward',
      title: `今天还可以赚 ${availableRewardCredits} 积分`,
      desc: rewardHintTaskText,
      url: extraPkgUrl('/pages/reward-center/index'),
      bgImage: rewardPointsBannerBg,
    }] : []),
    {
      key: 'campus',
      title: '食探校园食堂计划',
      desc: '一起补全食堂菜品、价格、窗口和营养信息',
      url: extraPkgUrl('/pages/campus-canteen/index'),
      bgImage: CAFETERIA_HERO_BG_URL,
    },
    {
      key: 'feedback',
      title: '意见反馈',
      desc: '提交宝贵建议，最高可得 +5 积分',
      url: extraPkgUrl('/pages/feedback/index'),
      bgImage: feedbackBannerBg,
    },
  ]
  const activeHandbookBannerIndex = handbookBannerIndex % handbookBanners.length

  const handleHandbookBannerClick = React.useCallback((banner: HomeHandbookBanner) => {
    Taro.navigateTo({
      url: banner.url,
      fail: (error) => {
        console.warn('首页内容横幅跳转失败', { url: banner.url, error })
        Taro.showToast({
          title: '内容加载失败，请稍后重试',
          icon: 'none',
        })
      },
    })
  }, [])
  const openBackfillRecordMenu = () => {
    setShowRecordMenu(true)
  }

  const switchHomeMode = React.useCallback(() => {
    setHomeMode((current) => {
      const next = current === 'balanced' ? 'wellness' : 'balanced'
      saveHomeDisplayMode(next)
      return next
    })
  }, [])

  const wellnessCaloriePct = Math.min(100, calculateProgressPercent(totalCurrent, normalizeDisplayNumber(intakeData.target)))
  const petVisualCollapsed = petCollapsed
  const bodyStatusCards = (
    <View className='body-status-section'>
      <View className='body-status-card weight-card' onClick={() => openBodyMetricRecord('weight')} onLongPress={openWeightEditor}>
        <View className='body-status-header'>
          <View className='body-status-title-wrap'>
            <Text className='iconfont icon-weight-scale' style={{ marginRight: '6rpx', fontSize: '26rpx', color: '#6b7280' }} />
            <Text className='body-status-title'>体重</Text>
          </View>
        </View>
        <View className='body-status-content'>
          {dashboardBusy ? (
            <View style={{ display: 'flex', alignItems: 'center', gap: '12rpx', minHeight: '52rpx' }}>
              <Text className='body-status-value' style={{ color: '#9ca3af' }}>--</Text>
              <View className='loading-spinner' style={{ width: '22rpx', height: '22rpx', borderWidth: '3rpx' }} />
            </View>
          ) : isGuest ? (
            <Text className='body-status-value' style={{ color: '#9ca3af' }}>--</Text>
          ) : weightSummary.latestWeight ? (
            <>
              <Text className='body-status-value'>{weightSummary.latestWeight.value.toFixed(1)}</Text>
              <Text className='body-status-unit'>kg</Text>
              {weightSummary.weightChange !== null && (
                <Text className={`body-status-change ${weightSummary.weightChange > 0 ? 'up' : 'down'}`}>
                  {weightSummary.weightChange > 0 ? '+' : ''}{weightSummary.weightChange.toFixed(1)}
                </Text>
              )}
            </>
          ) : (
            <Text className='body-status-empty'>点击记录</Text>
          )}
        </View>
        <Text className='body-status-hint'>
          {isGuest
            ? '记录体重，追踪变化'
            : weightSummary.latestWeight
              ? `上次记录: ${weightSummary.latestWeight.date.slice(5)}`
              : '点击记录体重'}
        </Text>
      </View>

      <View className='body-status-card water-card' onClick={() => openBodyMetricRecord('water')} onLongPress={openWaterEditor}>
        <View className='body-status-header'>
          <View className='body-status-title-wrap'>
            <Text className='iconfont icon-drink' style={{ marginRight: '6rpx', fontSize: '26rpx', color: '#5c9ed4' }} />
            <Text className='body-status-title'>喝水</Text>
          </View>
        </View>
        <View className='body-status-content'>
          {dashboardBusy ? (
            <View style={{ display: 'flex', alignItems: 'center', gap: '12rpx', minHeight: '52rpx' }}>
              <Text className='body-status-value' style={{ color: '#9ca3af' }}>--</Text>
              <View className='loading-spinner' style={{ width: '22rpx', height: '22rpx', borderWidth: '3rpx' }} />
            </View>
          ) : isGuest ? (
            <Text className='body-status-value' style={{ color: '#9ca3af' }}>--</Text>
          ) : (
            <>
              <Text className='body-status-value'>{Math.round(animatedWaterTotal)}</Text>
              <Text className='body-status-unit'>ml</Text>
            </>
          )}
        </View>
        <Text className='body-status-hint'>
          {dashboardBusy || isGuest ? '点击记录喝水' : `${Math.round(animatedWaterProgress)}% / 目标 ${bodyMetrics.waterGoalMl}ml`}
        </Text>
      </View>

      <View className='body-status-card exercise-card' onClick={() => openBodyMetricRecord('exercise')} onLongPress={openExerciseRecord}>
        <View className='body-status-header'>
          <View className='body-status-title-wrap'>
            <Text className='iconfont icon-dumbbell' style={{ marginRight: '6rpx', fontSize: '26rpx', color: '#f0985c' }} />
            <Text className='body-status-title'>运动</Text>
          </View>
        </View>
        <View className='body-status-content'>
          {dashboardBusy ? (
            <View style={{ display: 'flex', alignItems: 'center', gap: '12rpx', minHeight: '52rpx' }}>
              <Text className='body-status-value' style={{ color: '#9ca3af' }}>--</Text>
              <View className='loading-spinner' style={{ width: '22rpx', height: '22rpx', borderWidth: '3rpx' }} />
            </View>
          ) : isGuest ? (
            <Text className='body-status-value' style={{ color: '#9ca3af' }}>--</Text>
          ) : (
            <>
              <Text className='body-status-value'>{Math.round(animatedExerciseBurnedKcal)}</Text>
              <Text className='body-status-unit'>kcal</Text>
            </>
          )}
        </View>
        <Text className='body-status-hint'>点击记录运动</Text>
      </View>
    </View>
  )
  const handleDismissBackfillHint = async () => {
    const { confirm } = await Taro.showModal({
      title: '取消补录提醒',
      content: '取消后，这一天的补录提醒将不再显示。仍可随时通过首页记录入口补录历史餐食。',
      confirmText: '确认取消',
      cancelText: '继续保留',
      confirmColor: '#5cb896'
    })
    if (!confirm) return
    setDismissedBackfillDates((prev) => {
      const next = Array.from(new Set([...prev, selectedDate]))
      saveDismissedBackfillDates(next)
      return next
    })
  }

  return (
    <View
      className={`home-page home-page--${homeMode} ${scheme === 'dark' ? 'home-page--dark' : ''} ${showRecordEditModal || showHomeOnboardingGuide ? 'home-page--modal-open' : ''}`}
    >
      <PageMeta
        pageStyle={
          homePageScrollLocked
            ? 'overflow: hidden; height: 100vh;'
            : 'overflow: visible;'
        }
      />
      {/* 后台静默同步中：左上角微型 spinner */}
      {dataSyncing ? (
        <View className='home-page__data-sync'>
          <View className='home-page__data-sync-spinner' />
        </View>
      ) : null}
      {!petHidden ? (
        <View
          className={`pet-companion-float ${petVisualCollapsed ? 'is-collapsed' : 'is-expanded'} ${petDragging ? 'is-dragging' : ''} ${petCelebrating ? 'is-celebrating' : ''}`}
          style={{
            left: `${petFloatPosition.left}px`,
            top: `${petFloatPosition.top}px`
          }}
          onTouchStart={handlePetTouchStart}
          onTouchMove={handlePetTouchMove}
          onTouchEnd={handlePetTouchEnd}
          onTouchCancel={handlePetTouchEnd}
        >
          <View
            className='pet-companion-card'
            onClick={() => {
              const handled = petClickHandledRef.current
              petClickHandledRef.current = false
              if (handled) return
              if (petVisualCollapsed) {
                togglePetCollapsed()
              }
              // 展开态点击卡片空白处不进入对话，只有「点我聊聊」进入
            }}
          >
            <View className='pet-companion-content'>
              <View
                className='pet-companion-chat'
                onClick={(event) => {
                  event.stopPropagation()
                  openPetChat()
                }}
              >
                <Text className='pet-companion-chat-text'>{petDialogText}</Text>
              </View>
            </View>
            <View
              className='pet-companion-stage'
              onClick={(event) => {
                event.stopPropagation()
                const handled = petClickHandledRef.current
                petClickHandledRef.current = false
                if (handled) return
                if (petVisualCollapsed) {
                  togglePetCollapsed()
                  return
                }
                openPetChat()
              }}
            >
              <View className={`pet-companion-aura is-${petMealState}`} />
              <PetAvatar
                pet={petSummary?.pet}
                size='large'
                mood={petMood}
                state={petState}
                mealState={petMealState}
                motion='companion'
                className='pet-companion-avatar'
              />
              <View className='pet-companion-stage-shadow' />
            </View>
            {!petVisualCollapsed ? (
              <View
                className='pet-companion-collapse'
                onClick={(event) => {
                  event.stopPropagation()
                  togglePetCollapsed()
                }}
              >
                <View className='pet-companion-collapse-icon' />
              </View>
            ) : null}
          </View>
        </View>
      ) : null}
      {/* 页面内容 */}
      <View className='page-content'>
        {/* 问候区 */}
        <GreetingSection onSharePress={handleShareDailySummary} />
        <View className='home-mode-switch-row'>
            <View className='home-mode-switch' onClick={switchHomeMode}>
              <Text className='home-mode-switch__arrow'>⇄</Text>
              <Text className='home-mode-switch__text'>{homeMode === 'balanced' ? '养生模式' : '均衡模式'}</Text>
            </View>
        </View>

        {!getAccessToken() && (
          <View
            className='home-login-banner'
            onClick={() => redirectToLogin()}
          >
            <Text className='home-login-banner-text'>
              登录后可同步饮食记录、身体数据与云端目标
            </Text>
            <View className='home-login-banner-btn'>
              <Text className='home-login-banner-btn-text'>去登录</Text>
            </View>
          </View>
        )}

        {/* 日期选择器 */}
        {showHealthProfilePrompt && !homeGuideTransitionPending && (
          <View className='home-health-profile-prompt'>
            <View className='home-health-profile-prompt__icon'>健</View>
            <View className='home-health-profile-prompt__content' onClick={openHealthProfileFromPrompt}>
              <Text className='home-health-profile-prompt__title'>完善健康档案，获得更贴合你的建议</Text>
              <Text className='home-health-profile-prompt__desc'>每日目标、饮食分析会结合你的身体数据、过敏与饮食偏好。</Text>
            </View>
            <View className='home-health-profile-prompt__actions'>
              <View className='home-health-profile-prompt__go' onClick={openHealthProfileFromPrompt}>
                <Text>去完善</Text>
              </View>
              <View className='home-health-profile-prompt__dismiss' onClick={dismissHealthProfilePrompt}>
                <Text>7天后提醒</Text>
              </View>
            </View>
          </View>
        )}

        <DateSelector
          cells={weekHeatmapCells}
          historyCells={calendarHistoryCells}
          selectedDate={selectedDate}
          onSelect={handleDateSelect}
        />
        {homeMode === 'balanced' ? (
          <View className='balanced-home-content'>
        {/* 热量总览卡片 + 三大营养素合并（仅展示与编辑目标，不整卡跳转） */}
        <View className='main-card combined-card'>
          <View className='main-card-header'>
            <View className='main-card-title'>
              <Text className='card-label'>
                {dashboardBusy ? '剩余可摄入' : isCalorieOver ? '已超出' : '剩余可摄入'}
              </Text>
              {dashboardBusy ? (
                <View style={{ display: 'flex', alignItems: 'center', gap: '12rpx', marginTop: '8rpx' }}>
                  <Text className='card-value' style={{ fontSize: '36rpx', color: '#9ca3af' }}>--</Text>
                  <View className='loading-spinner' style={{ width: '24rpx', height: '24rpx', borderWidth: '3rpx' }} />
                </View>
              ) : isGuest ? (
                <Text className='card-value' style={{ color: '#9ca3af' }}>--</Text>
              ) : (
                <Text className={`card-value${isCalorieOver ? ' is-over' : ''}`}>
                  {isCalorieOver
                    ? formatDisplayNumber(Math.round(animatedHeadlineCalories))
                    : formatNumberWithComma(Math.round(animatedHeadlineCalories))}
                </Text>
              )}
              {!dashboardBusy && !isGuest && <Text className='card-unit'>kcal</Text>}
            </View>
            <View className='target-section'>
              {dashboardBusy || isGuest ? (
                <View className='target-energy-nums-only'>
                  <Text className='target-energy-num-muted'>--</Text>
                  <Text className='target-energy-slash-only'>/</Text>
                  <Text className='target-energy-num-muted'>--</Text>
                </View>
              ) : (
                <View className='target-energy-nums-only'>
                  <Text className={`target-energy-intake-num${isCalorieOver ? ' is-over' : ''}`}>
                    {formatDisplayNumber(Math.round(intakeData.current))}
                  </Text>
                  <Text className='target-energy-slash-only'>/</Text>
                  <Text className='target-energy-target-num'>
                    {formatDisplayNumber(Math.round(intakeData.target))}
                  </Text>
                </View>
              )}
              <View className='target-action-row'>
                <View className='target-edit-btn' onClick={openTargetEditor}>
                  <Text className='iconfont icon-target target-edit-icon' />
                  <Text className='target-edit-text'>目标设置</Text>
                </View>
              </View>
            </View>
          </View>

          <View className='progress-section'>
            <View className={`progress-bar-bg thick${dashboardBusy ? ' loading-pulse' : ''}`}>
              <View
                className={`progress-bar-fill thick${isCalorieOver ? ' is-over' : ''}`}
                style={{ width: `${animatedMainCalorieBarPct}%` }}
              />
            </View>
          </View>

          <View className={`nutrition-expand-shell${nutritionExpanded ? ' is-expanded' : ''}`}>
            <View
              className='nutrition-expand-main'
              onClick={() => setNutritionExpanded((value) => !value)}
            >
              <View className='nutrition-expand-title-row'>
                <Text className='nutrition-expand-title'>营养概览</Text>
                <View className='nutrition-expand-affordance'>
                  <Text className={`iconfont ${nutritionExpanded ? 'icon-collapse' : 'icon-expand'} nutrition-expand-affordance-icon`} />
                  <Text className='nutrition-expand-affordance-text'>
                    {nutritionExpanded ? '收起' : '展开更多'}
                  </Text>
                </View>
              </View>

              <View className='macros-section-horizontal'>
                {MACRO_CONFIGS.map(({ key, label, color, unit, iconClass }) => {
                  const macro = intakeData.macros[key]
                  const targetValue = macro?.target || 0
                  const currentRaw = normalizeDisplayNumber(macro?.current)
                  const targetRaw = normalizeDisplayNumber(macro?.target)
                  const macroPct = calculateProgressPercent(currentRaw, targetRaw)
                  const isMacroOver = macroPct > 100
                  const macroExcessG = isMacroOver
                    ? Number((Math.max(0, currentRaw - targetRaw)).toFixed(1))
                    : null
                  const ringStrokeColor = isMacroOver ? HOME_WARNING_RED : color
                  const intakeTextColor = isMacroOver ? HOME_WARNING_RED : color

                  const ringAnimPct =
                    key === 'protein'
                      ? animatedMacroProteinRing
                      : key === 'carbs'
                        ? animatedMacroCarbsRing
                        : animatedMacroFatRing
                  const intakeAnimNum =
                    key === 'protein'
                      ? animatedMacroProteinNum
                      : key === 'carbs'
                        ? animatedMacroCarbsNum
                        : animatedMacroFatNum

                  return (
                    <View key={key} className={`macro-card-horizontal ${isMacroOver ? 'is-warning' : ''}`}>
                      <View className='macro-left-content'>
                        <View className='macro-excess-slot'>
                          {macroExcessG != null && macroExcessG > 0 && (
                            <Text className='macro-over-hint'>+{formatDisplayNumber(macroExcessG)}{unit}</Text>
                          )}
                        </View>
                        <View className='macro-title-row'>
                          <Text className={`iconfont ${iconClass}`} style={{ color, marginRight: '6rpx', fontSize: '26rpx' }} />
                          <Text className='macro-label-horizontal'>{label}</Text>
                        </View>
                        <View className='macro-value-row'>
                          <Text className='macro-current-value-inline' style={{ color: intakeTextColor }}>
                            {formatDisplayNumber(intakeAnimNum)}
                          </Text>
                          <Text className='macro-target-total'>
                            / {formatDisplayNumber(targetValue)}{unit}
                          </Text>
                        </View>
                        <View className='macro-progress-bar-bg'>
                          <View
                            className='macro-progress-bar-fill'
                            style={{
                              width: `${dashboardBusy ? 0 : Math.min(100, ringAnimPct)}%`,
                              backgroundColor: ringStrokeColor
                            }}
                          />
                        </View>
                      </View>
                    </View>
                  )
                })}
              </View>
            </View>

            {nutritionExpanded && (
              <View className='nutrition-expanded-body'>
                <MicrosSection
                  intakeData={intakeData}
                  dashboardBusy={dashboardBusy}
                  isGuest={isGuest}
                />
              </View>
            )}
          </View>
        </View>

        {!isGuest && (
          <View className='home-handbook-swiper'>
            <Swiper
              className='home-handbook-swiper__track'
              current={activeHandbookBannerIndex}
              circular
              autoplay
              interval={5000}
              duration={360}
              nextMargin='42rpx'
              onChange={(event) => setHandbookBannerIndex(event.detail.current)}
            >
              {handbookBanners.map((banner) => (
                <SwiperItem key={banner.key} className='home-handbook-swiper__item'>
                  <View className='home-handbook-card' onClick={() => handleHandbookBannerClick(banner)}>
                    <Image className='home-handbook-card__bg' src={banner.bgImage} mode='aspectFill' />
                    <View className='home-handbook-card__shade' />
                    <View className='home-handbook-card__copy'>
                      <Text className='home-handbook-card__title'>{banner.title}</Text>
                      <Text className='home-handbook-card__desc'>{banner.desc}</Text>
                    </View>
                  </View>
                </SwiperItem>
              ))}
            </Swiper>
            <View className='home-handbook-swiper__dots'>
              {handbookBanners.map((banner, index) => (
                <Text
                  key={banner.key}
                  className={`home-handbook-swiper__dot ${index === activeHandbookBannerIndex ? 'active' : ''}`}
                />
              ))}
            </View>
          </View>
        )}

        {showBackfillHint && (
          <View className='home-backfill-hint'>
            <Text className='home-backfill-hint__dot' />
            <View className='home-backfill-hint__copy'>
              <Text className='home-backfill-hint__text'>可补录这一天的食物、体重、喝水和运动记录</Text>
            </View>
            <View className='home-backfill-hint__actions'>
              <Text className='home-backfill-hint__action' onClick={openBackfillRecordMenu}>去补录</Text>
              <Text className='home-backfill-hint__cancel' onClick={handleDismissBackfillHint}>取消</Text>
            </View>
          </View>
        )}

        {/* 体重、喝水、运动状态卡片 */}
        {bodyStatusCards}

        {/* 今日餐食区域 */}
        <View className='meals-section'>
          <View className='section-header'>
            <View className='meals-title-wrap'>
              <Text className='iconfont icon-canciguanli meals-title-icon' />
              <Text className='meals-title'>今日餐食</Text>
            </View>
            <View className='view-all-btn' onClick={handleViewAllMeals}>
              <Text className='iconfont icon-right-arrow view-all-arrow' />
            </View>
          </View>

          <View className='meals-list'>
            {loading ? (
              <View className='meals-skeleton'>
                {[1, 2, 3].map((i) => (
                  <View key={i} className='meal-skeleton-item'>
                    <View className='meal-skeleton-thumb' />
                    <View className='meal-skeleton-body'>
                      <View className='meal-skeleton-top'>
                        <View className='home-line-title' />
                        <View className='home-line-cal' />
                      </View>
                      <View className='home-skeleton-bar' />
                      <View className='meal-skeleton-foot'>
                        <View className='home-line-foot-l' />
                        <View className='home-line-foot-r' />
                      </View>
                    </View>
                  </View>
                ))}
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
                    onClick={handleQuickRecord}
                  >
                    去记录一餐
                  </Button>
                </Empty>
              </View>
            ) : (
              meals.map((meal, index) => {
                const config = MEAL_ICON_CONFIG[meal.type as keyof typeof MEAL_ICON_CONFIG] ?? MEAL_ICON_CONFIG.snack
                const { Icon, color, bgColor, label } = config
                const mealCalorie = normalizeDisplayNumber(meal.calorie)
                const mealTarget = normalizeDisplayNumber(meal.target)
                const mealProgress = normalizeProgressPercent(meal.progress, mealCalorie, mealTarget)
                const mealImageUrls = collectFoodDisplayImageUrls(meal)
                const previewImage = mealImageUrls[0] || ''
                const hasRealImage = hasFoodDisplayImage(meal)
                const mealRecordCount = Array.isArray(meal.meal_record_entries)
                  ? meal.meal_record_entries.filter((entry) => entry && String(entry.id || '').trim()).length
                  : 0
                const mealIntakeRatio = typeof (meal.intake_ratio ?? meal.intakeRatio) === 'number'
                  ? Number(meal.intake_ratio ?? meal.intakeRatio)
                  : null


                return (
                  <View
                    key={`${meal.type}-${index}`}
                    className={`meal-item meal-item--tappable ${mealProgress > 100 ? 'is-warning' : ''}`}
                    onClick={() => openMealRecordDetail(meal)}
                  >
                    <View
                      className={`meal-media-wrap ${hasRealImage ? 'is-photo' : 'is-icon'}`}
                      onClick={(e) => {
                        e.stopPropagation()
                        if (hasRealImage) previewHomeMealImages(meal)
                      }}
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
                      <View className='meal-media-type-tag'>
                        <Text className='meal-media-type-tag-text'>{label}</Text>
                      </View>
                    </View>
                    <View className='meal-content'>
                      {/* 第一行：描述 + 时间胶囊 */}
                      <View className='meal-header-block'>
                        <Text className='meal-desc' numberOfLines={1}>
                          {meal.description || meal.meal_record_entries?.map((e) => e.title).filter(Boolean).join('、') || meal.name || label}
                        </Text>
                        {mealRecordCount > 1 ? (
                          <View className='meal-count-badge'>
                            <Text className='meal-count-badge-text'>{mealRecordCount}次</Text>
                          </View>
                        ) : null}
                        {meal.time ? (
                          <View className='meal-time-pill'>
                            <Text className='meal-time-pill-text'>{meal.time}</Text>
                          </View>
                        ) : null}
                      </View>
                      {/* 第二行：🔥 卡路里 + 餐次目标 */}
                      <View className='meal-calorie-row'>
                        <View className='meal-calorie-wrap'>
                          <Text className='iconfont icon-huore' style={{ color: '#f0985c', fontSize: '24rpx', marginRight: '4rpx' }} />
                          <Text className='meal-calorie'>
                            {formatDisplayNumber(mealCalorie)}
                            <Text className='meal-calorie-unit'> kcal</Text>
                          </Text>
                        </View>
                        <View className='meal-calorie-extra'>
                          {mealIntakeRatio != null ? (
                            <>
                              <Text
                                className='meal-intake-ratio-text'
                                style={{ color: mealIntakeRatio > 100 ? HOME_WARNING_RED : undefined }}
                              >
                                摄入 {formatDisplayNumber(mealIntakeRatio)}%
                              </Text>
                            </>
                          ) : null}
                        </View>
                      </View>
                      {/* 第三行：三大营养素 + 含水量 */}
                      <View className='meal-macros-row'>
                        {typeof meal.protein === 'number' && (
                          <View className='meal-macro-pill'>
                            <Text className='iconfont icon-danbaizhi' style={{ color: '#5c9ed4', fontSize: '22rpx', marginRight: '4rpx' }} />
                            <Text className='meal-macro-text'>{formatDisplayNumber(meal.protein)}g</Text>
                          </View>
                        )}
                        {typeof meal.carbs === 'number' && (
                          <View className='meal-macro-pill'>
                            <Text className='iconfont icon-tanshui-dabiao' style={{ color: '#dcac52', fontSize: '22rpx', marginRight: '4rpx' }} />
                            <Text className='meal-macro-text'>{formatDisplayNumber(meal.carbs)}g</Text>
                          </View>
                        )}
                        {typeof meal.fat === 'number' && (
                          <View className='meal-macro-pill'>
                            <Text className='iconfont icon-zhifangyouheruhuazhifangzhipin' style={{ color: '#f0985c', fontSize: '22rpx', marginRight: '4rpx' }} />
                            <Text className='meal-macro-text'>{formatDisplayNumber(meal.fat)}g</Text>
                          </View>
                        )}
                        {typeof (meal.water_ml ?? meal.waterMl) === 'number' && Number(meal.water_ml ?? meal.waterMl) > 0 && (
                          <View className='meal-macro-pill'>
                            <Text className='iconfont icon-drink' style={{ color: '#70B8A0', fontSize: '22rpx', marginRight: '4rpx' }} />
                            <Text className='meal-macro-text'>{formatDisplayNumber(Number(meal.water_ml ?? meal.waterMl))}ml</Text>
                          </View>
                        )}
                      </View>
                    </View>
                  </View>
                )
              })
            )}
          </View>
        </View>

        {/* 食物保质期：快到期提醒（数据来自首页 dashboard） */}
        {showFoodExpiryBlock && (
          <View className='expiry-section'>
            <View className='section-header'>
              <View className='meals-title-wrap'>
                <Text className='iconfont icon-kefulan meals-title-icon' />
                <Text className='meals-title expiry-title'>食物保质期</Text>
              </View>
              <View className='view-all-btn' onClick={openFoodExpiryList}>
                <Text className='iconfont icon-right-arrow view-all-arrow' />
              </View>
            </View>

            <View className='expiry-card'>
              {loading ? (
                <View className='expiry-skeleton'>
                  {[1, 2, 3].map((i) => (
                    <View key={i} className='expiry-skeleton-item'>
                      <View className='expiry-skeleton-thumb' />
                      <View className='expiry-skeleton-body'>
                        <View className='expiry-skeleton-top'>
                          <View className='home-line-title' />
                          <View className='home-line-tag' />
                        </View>
                        <View className='expiry-skeleton-mid'>
                          <View className='home-line-foot-l' />
                        </View>
                      </View>
                    </View>
                  ))}
                </View>
              ) : expirySummary.pendingCount === 0 ? (
                <View className='expiry-empty' onClick={openFoodExpiryList}>
                  <Text className='expiry-empty-title'>暂无待吃完记录</Text>
                  <Text className='expiry-empty-desc'>
                    添加家中食物与预计吃完时间，我们会在首页展示最紧急的几项并提醒即将过期。
                  </Text>
                </View>
              ) : (
                <>
                  <View className='expiry-list'>
                    {expirySummary.items.map((item) => {
                      const isUrgent = item.urgency_level === 'overdue' || item.urgency_level === 'today'
                      const iconClass = isUrgent ? 'icon-guoqi1' : 'icon-kefulan'
                      const iconColor =
                        item.urgency_level === 'overdue' ? '#dc2626'
                        : item.urgency_level === 'today' ? '#ea580c'
                        : item.urgency_level === 'soon' ? '#d97706'
                        : '#6b7280'
                      const bgColor =
                        item.urgency_level === 'overdue' ? '#fee2e2'
                        : item.urgency_level === 'today' ? '#ffedd5'
                        : item.urgency_level === 'soon' ? '#fef3c7'
                        : '#f3f4f6'

                      return (
                        <View
                          key={item.id}
                          className='expiry-item'
                          onClick={() => openFoodExpiryEdit(item.id)}
                        >
                          <View className='expiry-media-wrap'>
                            <View className='expiry-icon-wrap' style={{ backgroundColor: bgColor }}>
                              <Text className={`iconfont ${iconClass}`} style={{ color: iconColor, fontSize: '52rpx' }} />
                            </View>
                          </View>
                          <View className='expiry-content'>
                            <View className='expiry-header-block'>
                              <Text className='expiry-name' numberOfLines={1}>{item.food_name}</Text>
                              <View className='expiry-time-pill'>
                                <Text className='expiry-time-pill-text'>{getExpiryUrgencyText(item)}</Text>
                              </View>
                            </View>
                            <View className='expiry-meta-row'>
                              <Text className='expiry-meta-text'>{formatExpiryMeta(item) || '点击编辑'}</Text>
                            </View>
                          </View>
                        </View>
                      )
                    })}
                  </View>
                </>
              )}
            </View>
          </View>
        )}

        {/* 查看统计入口 */}
        <StatsEntry onClick={openDayRecordForSelectedDate} />

            {/* 底部留白 */}
            <View className='bottom-spacer' />
          </View>
        ) : (
          <View className='wellness-home-content'>
            <View className='wellness-overview-card'>
              <View className='wellness-overview-main'>
                <View className='wellness-calorie-gauge' style={{ '--wellness-progress': `${wellnessCaloriePct}%` } as React.CSSProperties}>
                  <View className='wellness-calorie-gauge__center'>
                    <Text className='wellness-calorie-gauge__label'>剩余可摄入</Text>
                    <Text className='wellness-calorie-gauge__value'>
                      {dashboardBusy || isGuest ? '--' : formatNumberWithComma(Math.round(Math.max(0, totalTarget - totalCurrent)))}
                    </Text>
                    <Text className='wellness-calorie-gauge__unit'>kcal</Text>
                    <Text className='iconfont icon-a-144-lvye wellness-calorie-gauge__leaf' />
                  </View>
                </View>

                <View className='wellness-overview-detail'>
                  <Text className='wellness-intake-summary'>
                    已摄入 {dashboardBusy || isGuest ? '--' : formatDisplayNumber(Math.round(totalCurrent))} kcal / {dashboardBusy || isGuest ? '--' : formatDisplayNumber(Math.round(totalTarget))} kcal
                  </Text>
                  <View className='wellness-total-progress'>
                    <View className='wellness-total-progress__fill' style={{ width: `${wellnessCaloriePct}%` }} />
                  </View>
                  <View className='wellness-macros'>
                    {MACRO_CONFIGS.map(({ key, label, color, unit, iconClass }) => {
                      const macro = intakeData.macros[key]
                      const current = normalizeDisplayNumber(macro?.current)
                      const target = normalizeDisplayNumber(macro?.target)
                      const pct = Math.min(100, calculateProgressPercent(current, target))
                      return (
                        <View key={key} className='wellness-macro'>
                          <View className='wellness-macro__title'>
                            <Text className={`iconfont ${iconClass} wellness-macro__icon`} style={{ color }} />
                            <Text>{label}</Text>
                          </View>
                          <View className='wellness-macro__numbers'>
                            <Text className='wellness-macro__current'>{dashboardBusy || isGuest ? '--' : formatDisplayNumber(current)}</Text>
                            <Text className='wellness-macro__target'> / {dashboardBusy || isGuest ? '--' : formatDisplayNumber(target)}{unit}</Text>
                          </View>
                          <View className='wellness-macro__track'>
                            <View className='wellness-macro__fill' style={{ width: `${pct}%` }} />
                          </View>
                        </View>
                      )
                    })}
                  </View>
                </View>
              </View>

              <View className={`nutrition-expand-shell wellness-nutrition-shell${nutritionExpanded ? ' is-expanded' : ''}`}>
                <View
                  className='nutrition-expand-main'
                  onClick={() => setNutritionExpanded((value) => !value)}
                >
                  <View className='nutrition-expand-title-row'>
                    <Text className='nutrition-expand-title'>营养概览</Text>
                    <View className='nutrition-expand-affordance'>
                      <Text className={`iconfont ${nutritionExpanded ? 'icon-collapse' : 'icon-expand'} nutrition-expand-affordance-icon`} />
                      <Text className='nutrition-expand-affordance-text'>
                        {nutritionExpanded ? '收起' : '展开更多'}
                      </Text>
                    </View>
                  </View>
                </View>

                {nutritionExpanded && (
                  <View className='nutrition-expanded-body wellness-nutrition-expanded-body'>
                    <MicrosSection
                      intakeData={intakeData}
                      dashboardBusy={dashboardBusy}
                      isGuest={isGuest}
                    />
                  </View>
                )}
              </View>
            </View>

            <View className='wellness-daily-advice'>
              <Image className='wellness-daily-advice__bg' src={wellnessSolarTermBg} mode='aspectFill' />
              <View className='wellness-daily-advice__shade' />
              <View className='wellness-daily-advice__inner'>
                <View className='wellness-daily-advice__heading'>
                  <Text className='iconfont icon-a-144-lvye wellness-daily-advice__icon' />
                  <Text className='wellness-daily-advice__title'>今日养生建议</Text>
                </View>
                <View className='wellness-daily-advice__content'>
                  <View className='wellness-daily-advice__season-copy'>
                    <Text className='wellness-daily-advice__term'>立秋</Text>
                    <Text className='wellness-daily-advice__summary'>润燥养肺，饮食宜清淡</Text>
                  </View>
                  <View className='wellness-daily-advice__items'>
                    <View className='wellness-daily-advice__item'>
                      <Text className='wellness-daily-advice__tag'>宜</Text>
                      <Text className='wellness-daily-advice__item-text'>绿色蔬菜</Text>
                    </View>
                    <View className='wellness-daily-advice__item'>
                      <Text className='wellness-daily-advice__tag'>建议</Text>
                      <Text className='wellness-daily-advice__item-text'>优质蛋白</Text>
                    </View>
                    <View className='wellness-daily-advice__item'>
                      <Text className='wellness-daily-advice__tag is-warm'>少</Text>
                      <Text className='wellness-daily-advice__item-text'>辛辣油腻</Text>
                    </View>
                  </View>
                </View>
              </View>
            </View>

            <View className='wellness-food-banner' onClick={handleQuickRecord}>
              <Image className='wellness-food-banner__bg' src={wellnessFoodScanBannerBg} mode='aspectFill' />
              <View className='wellness-food-banner__shade' />
              <View className='wellness-food-banner__copy'>
                <Text className='wellness-food-banner__eyebrow'>今日养生食鉴</Text>
                <Text className='wellness-food-banner__title'>AI 食物识别</Text>
                <Text className='wellness-food-banner__desc'>拍照看看这份食物是否适合今日养生</Text>
                <View className='wellness-food-banner__action'>
                  <Text>识别记录</Text>
                  <Text className='iconfont icon-right-arrow wellness-food-banner__arrow' />
                </View>
              </View>
            </View>

            {bodyStatusCards}

            <View className='bottom-spacer' />
          </View>
        )}
      </View>

      {/* 目标编辑弹窗 */}
      <TargetEditor
        visible={showTargetEditor}
        targetForm={targetForm}
        saving={savingTargets}
        calibrationSuggestion={nutritionTarget?.calibration_suggestion || null}
        onTargetFieldChange={handleTargetInput}
        onSave={handleSaveTargets}
        onApplyCalibration={handleApplyCalibrationSuggestion}
        onDismissCalibration={handleDismissCalibrationSuggestion}
        onClose={() => setShowTargetEditor(false)}
      />

      {/* 体重编辑弹窗 */}
      {showWeightEditor && (
        <View className='target-modal' catchMove>
          <View className='target-modal-mask' onClick={() => !savingWeight && setShowWeightEditor(false)} />
          <View className='target-modal-content'>
            <View className='target-modal-header'>
              <Text className='target-modal-title'>记录体重</Text>
              <Text className='target-modal-desc'>{selectedDate} 的体重记录</Text>
            </View>

            <View className='target-form-list'>
              <View className='target-form-item'>
                <Text className='target-form-label'>体重 (kg)</Text>
                <View className='target-input-wrap'>
                  <Input
                    className='target-input'
                    type='digit'
                    value={weightInput}
                    onInput={(e) => setWeightInput(e.detail.value)}
                    placeholder='请输入体重'
                  />
                  <Text className='target-input-unit'>kg</Text>
                </View>
              </View>
            </View>

            {weightSummary.latestWeight && weightSummary.latestWeight.date !== selectedDate && (
              <View className='target-relation-hint'>
                <Text className='target-relation-hint-title'>
                  最新记录: {weightSummary.latestWeight.value.toFixed(1)} kg ({weightSummary.latestWeight.date})
                </Text>
              </View>
            )}

            <View className='target-modal-actions'>
              <View className='target-modal-btn secondary' onClick={() => !savingWeight && setShowWeightEditor(false)}>
                <Text className='target-modal-btn-text secondary'>取消</Text>
              </View>
              <View className='target-modal-btn primary' onClick={handleSaveWeight}>
                {savingWeight ? <View className='btn-spinner' /> : <Text className='target-modal-btn-text primary'>保存</Text>}
              </View>
            </View>
          </View>
        </View>
      )}

      {/* 喝水编辑弹窗 */}
      {showWaterEditor && (
        <View className='target-modal' catchMove>
          <View
            className='target-modal-mask'
            onClick={() => {
              if (!savingWater) {
                if (waterBlurTimerRef.current) {
                  clearTimeout(waterBlurTimerRef.current)
                  waterBlurTimerRef.current = null
                }
                setWaterInputFocused(false)
                setShowWaterEditor(false)
              }
            }}
          />
          <View className='target-modal-content water-modal-content'>
            <View className='target-modal-header'>
              <Text className='target-modal-title'>记录喝水</Text>
              <Text className='target-modal-desc'>{waterEditorDate} 已喝 {waterEditorWater.total} ml</Text>
              {waterEditorWater.total > 0 ? (
                <Text
                  className='water-modal-clear-link'
                  onClick={(e) => {
                    e.stopPropagation()
                    if (!savingWater) void clearTodayWater()
                  }}
                >
                  清空今日记录
                </Text>
              ) : null}
            </View>

            {/* 快捷水量按钮 */}
            <View className='water-quick-actions'>
              {QUICK_WATER_AMOUNTS.map(amount => (
                <View
                  key={amount}
                  className='water-quick-btn'
                  onClick={() => addWaterAmount(amount, waterEditorDate)}
                >
                  <IconWaterDrop size={16} color='#5c9ed4' />
                  <Text className='water-quick-btn-text'>+{amount}ml</Text>
                </View>
              ))}
            </View>

            <View className='target-form-list'>
              <View className='target-form-item'>
                <Text className='target-form-label'>自定义水量 (ml)</Text>
                <View className='target-input-wrap'>
                  <Input
                    className='target-input'
                    type='number'
                    value={waterInput}
                    onInput={(e) => setWaterInput(e.detail.value)}
                    onFocus={() => {
                      if (waterBlurTimerRef.current) {
                        clearTimeout(waterBlurTimerRef.current)
                        waterBlurTimerRef.current = null
                      }
                      setWaterInputFocused(true)
                    }}
                    onBlur={() => {
                      waterBlurTimerRef.current = setTimeout(() => {
                        setWaterInputFocused(false)
                        waterBlurTimerRef.current = null
                      }, 200)
                    }}
                    placeholder='输入水量'
                  />
                  <Text className='target-input-unit'>ml</Text>
                </View>
              </View>
            </View>

            {waterEditorWater.logs.length > 0 ? (
              <Text className='water-modal-records-hint'>
                已记录 {waterEditorWater.logs.length} 次，共 {waterEditorWater.total} ml
              </Text>
            ) : null}

            {showWaterAddFooter ? (
              <View className='target-modal-actions water-modal-actions-single'>
                <View className='target-modal-btn primary' onClick={handleSaveWater}>
                  {savingWater ? <View className='btn-spinner' /> : <Text className='target-modal-btn-text primary'>添加</Text>}
                </View>
              </View>
            ) : null}
          </View>
        </View>
      )}

      {/* 记录菜单弹窗 */}
      <RecordMenu visible={showRecordMenu} onClose={() => setShowRecordMenu(false)} selectedDate={selectedDate} />

      <OnboardingGuide
        visible={showHomeOnboardingGuide}
        steps={HOME_RECORD_ONBOARDING_STEPS}
        storageKey={ONBOARDING_HOME_RECORD_GUIDE_KEY}
        onClose={closeHomeOnboardingGuide}
        onBeforeNext={handleHomeGuideBeforeNext}
      />

      <DietRecommendationSheet
        visible={dietRecVisible}
        scene={dietRecScene}
        loading={dietRecLoading}
        result={dietRecResult}
        onClose={() => setDietRecVisible(false)}
        onChangeScene={handleDietRecommendationSceneChange}
        onRefresh={refreshDietRecommendation}
      />

      <View className='poster-canvas-wrap'>
        <Canvas
          type='2d'
          id='homeDailyPosterCanvas'
          className='poster-canvas'
          style={{ width: `${POSTER_WIDTH}px`, height: `${DAILY_SUMMARY_POSTER_MAX_HEIGHT}px` }}
        />
      </View>

      {showDailyPosterModal && dailyPosterImageUrl && (
        <View className='poster-modal poster-modal--sheet' catchMove>
          <View className='poster-modal-shell' catchMove>
            <View className='poster-modal-topbar poster-modal-topbar--light poster-modal-topbar--title-only'>
              <Text className='poster-modal-title poster-modal-title--light'>分享今日卡片</Text>
            </View>
            <View className='poster-modal-dark-body'>
              <View
                className='poster-modal-inline-back'
                onClick={() => setShowDailyPosterModal(false)}
              >
                {/* 与记录详情海报弹层相同的 × 关闭（poster-modal-close-x） */}
                <View className='poster-modal-close poster-modal-inline-close-hit'>
                  <Text className='poster-modal-close-x'>×</Text>
                </View>
              </View>
              <View className='poster-scroll-area'>
                <View className='poster-modal-scroll-inner'>
                  <View className='poster-modal-card-wrap'>
                    <Image src={dailyPosterImageUrl} mode='widthFix' className='poster-modal-image' />
                  </View>
                </View>
              </View>
            </View>
            <View className='poster-modal-bottom-bar'>
              <View className='poster-share-channel' onClick={handleShareDailyPosterImage}>
                <View className='poster-share-channel-icon poster-share-channel-icon-wechat'>
                  <Text className='iconfont icon-wechat poster-share-channel-glyph' />
                </View>
                <Text className='poster-share-channel-label'>微信</Text>
              </View>
              <View className='poster-share-channel' onClick={handleSaveDailyPoster}>
                <View className='poster-share-channel-icon poster-share-channel-icon-save'>
                  <Text className='iconfont icon-download poster-share-channel-glyph' />
                </View>
                <Text className='poster-share-channel-label'>保存图片</Text>
              </View>
            </View>
          </View>
        </View>
      )}

      {/* 同一餐次多条记录选择面板 */}
      <MealRecordsDialog
        visible={mealRecordsDialogVisible}
        meal={mealRecordsDialogMeal}
        onClose={() => setMealRecordsDialogVisible(false)}
        onSelectRecord={handleSelectMealRecord}
      />

      {/* 餐食卡片操作菜单 */}
      <MealActionSheet
        visible={mealActionSheetVisible}
        onClose={() => setMealActionSheetVisible(false)}
        onEdit={handleMealEdit}
        onFavorite={handleMealFavorite}
        onPoster={handleMealPoster}
        onShare={handleMealShare}
        onDelete={handleMealDelete}
      />

      {/* 餐食记录编辑弹窗 */}
      <MealRecordEditModal
        visible={showRecordEditModal}
        record={mealActionRecord}
        onClose={() => setShowRecordEditModal(false)}
        onSuccess={handleRecordEditSuccess}
      />

      {/* 餐食记录海报弹窗 */}
      <MealRecordPosterModal
        visible={showRecordPosterModal}
        record={mealActionRecord}
        onClose={() => setShowRecordPosterModal(false)}
        onShareContextChange={handleMealPosterShareContext}
      />
    </View>
  )
}

export default withAuth(IndexPage, { public: true })
