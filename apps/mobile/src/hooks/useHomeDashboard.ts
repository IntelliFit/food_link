import { useCallback, useMemo, useRef, useState } from 'react'
import { useFocusEffect } from '@react-navigation/native'
import type { BodyMetricsSummary, HomeDashboard, PetSummary, StatsSummary } from '@food-link/core'
import { apiClient } from '../api'
import { todayKey } from '../utils/date'
import { userFacingErrorMessage } from '../utils/errors'
import {
  ensureHomeDashboardCache,
  getStoredHomeDashboardSnapshotByDate,
  type HomeDashboardLocalSnapshot,
  isHomeDashboardSnapshotFresh,
  refreshHomeDashboardLocalSnapshotFromCloud,
  saveHomeDashboardSnapshot,
} from '../utils/home-dashboard-local-cache'
import {
  FOOD_EXPIRY_CHANGED_EVENT,
  HOME_DASHBOARD_REFRESH_EVENT,
  HOME_INTAKE_DATA_CHANGED_EVENT,
  onHomeDashboardEvent,
} from '../utils/home-events'

const HOME_DASHBOARD_CACHE_TTL_MS = 30 * 60 * 1000

function parseExerciseBurnedKcal(raw: unknown): number {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw
  if (typeof raw === 'string') {
    const parsed = parseFloat(raw.trim())
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

function mergeExerciseKcalFromDashboardAndLogs(dashboardRaw: unknown, logsTotal: unknown): number {
  const dashboard = parseExerciseBurnedKcal(dashboardRaw)
  const fromLogs =
    typeof logsTotal === 'number' && Number.isFinite(logsTotal)
      ? logsTotal
      : typeof logsTotal === 'string'
        ? parseFloat(logsTotal.trim())
        : NaN
  if (Number.isFinite(fromLogs)) return Math.max(dashboard, fromLogs)
  return dashboard
}

const fallbackWeekStats: StatsSummary = {
  range: 'week',
  start_date: todayKey(),
  end_date: todayKey(),
  tdee: 2000,
  streak_days: 0,
  total_calories: 0,
  avg_calories_per_day: 0,
  cal_surplus_deficit: 0,
  total_protein: 0,
  total_carbs: 0,
  total_fat: 0,
  by_meal: { breakfast: 0, lunch: 0, dinner: 0 },
  daily_calories: [],
  macro_percent: { protein: 0, carbs: 0, fat: 0 },
  analysis_summary: '',
}

const blankDashboard: HomeDashboard = {
  intakeData: {
    current: 0,
    target: 0,
    progress: 0,
    macros: {
      protein: { current: 0, target: 0 },
      carbs: { current: 0, target: 0 },
      fat: { current: 0, target: 0 },
    },
  },
  meals: [],
}

export function useHomeDashboard(selectedDate?: string) {
  const initialRecordDate = useMemo(todayKey, [])
  const recordDate = selectedDate || initialRecordDate

  const [dashboard, setDashboard] = useState<HomeDashboard | null>(null)
  const [petSummary, setPetSummary] = useState<PetSummary | null>(null)
  const [weekStats, setWeekStats] = useState<StatsSummary | null>(fallbackWeekStats)
  const [bodyMetrics, setBodyMetrics] = useState<BodyMetricsSummary | null>(null)
  const [exerciseBurnedKcal, setExerciseBurnedKcal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadDashboardSeqRef = useRef(0)
  const loadDashboardPendingRef = useRef<{ date: string; seq: number } | null>(null)
  const homeDataStaleRef = useRef(false)

  const applySnapshot = useCallback((snapshot: HomeDashboardLocalSnapshot) => {
    setDashboard({
      intakeData: snapshot.intakeData,
      meals: snapshot.meals,
      exerciseBurnedKcal: snapshot.exerciseBurnedKcal,
      achievement: snapshot.achievement,
      nutritionTarget: snapshot.nutritionTarget || null,
      expirySummary: snapshot.expirySummary,
    })
    setExerciseBurnedKcal(snapshot.exerciseBurnedKcal || 0)
    setError(null)
  }, [])

  const loadHome = useCallback(async (targetDate?: string, silent = false, force = false) => {
    const resolvedDate = targetDate && targetDate !== '' ? targetDate : recordDate

    if (
      loadDashboardPendingRef.current &&
      loadDashboardPendingRef.current.date === resolvedDate
    ) {
      return
    }

    const seq = ++loadDashboardSeqRef.current
    loadDashboardPendingRef.current = { date: resolvedDate, seq }

    let localSnapshot: HomeDashboardLocalSnapshot | null = null
    try {
      localSnapshot = await getStoredHomeDashboardSnapshotByDate(resolvedDate).catch(() => null)
    } catch {
      localSnapshot = null
    }

    const canUseLocalFresh = isHomeDashboardSnapshotFresh(localSnapshot, HOME_DASHBOARD_CACHE_TTL_MS)
    const canUseFreshCache = !force && !homeDataStaleRef.current && canUseLocalFresh

    if (canUseFreshCache && localSnapshot) {
      applySnapshot(localSnapshot)
      setLoading(false)
      setSyncing(false)
      if (loadDashboardPendingRef.current?.seq === seq) {
        loadDashboardPendingRef.current = null
      }
      return
    }

    const shouldSyncSilently = silent || localSnapshot != null
    if (shouldSyncSilently) {
      if (localSnapshot) {
        applySnapshot(localSnapshot)
      } else {
        setDashboard(blankDashboard)
      }
      setSyncing(true)
    } else {
      setLoading(true)
    }

    setError(null)
    try {
      const [dashboardData, petData, statsData, bodyMetricsData, exerciseLogsData] = await Promise.all([
        apiClient.getHomeDashboard(resolvedDate),
        apiClient.getPetSummary(resolvedDate).catch(() => null),
        apiClient.getStatsSummary('week').catch(() => null),
        apiClient.getBodyMetricsSummary('month').catch(() => null),
        apiClient.getExerciseLogs({ date: resolvedDate }).catch(() => null),
      ])

      if (seq !== loadDashboardSeqRef.current) return
      if (!dashboardData) {
        throw new Error('home dashboard is empty')
      }

      const nextExerciseBurnedKcal = mergeExerciseKcalFromDashboardAndLogs(
        dashboardData.exerciseBurnedKcal,
        exerciseLogsData?.total_calories,
      )
      const nextDashboard: HomeDashboard = {
        ...dashboardData,
        exerciseBurnedKcal: nextExerciseBurnedKcal,
      }

      setDashboard(nextDashboard)
      setPetSummary(petData)
      setWeekStats(statsData || fallbackWeekStats)
      setBodyMetrics(bodyMetricsData)
      setExerciseBurnedKcal(nextExerciseBurnedKcal)
      homeDataStaleRef.current = false

      await saveHomeDashboardSnapshot({
        date: resolvedDate,
        updatedAt: Date.now(),
        intakeData: dashboardData.intakeData,
        meals: dashboardData.meals,
        expirySummary: dashboardData.expirySummary || { active_count: 0, expired_count: 0, today_count: 0, soon_count: 0, preview_items: [] },
        exerciseBurnedKcal: nextExerciseBurnedKcal,
        achievement: dashboardData.achievement || { streak_days: 0, green_days: 0 },
        nutritionTarget: dashboardData.nutritionTarget || null,
      })
    } catch (err) {
      if (seq !== loadDashboardSeqRef.current) return
      const msg = userFacingErrorMessage(err, '获取首页失败')
      setError(msg)
      if (localSnapshot) {
        applySnapshot(localSnapshot)
      } else {
        setDashboard(blankDashboard)
      }
      setWeekStats((current) => current || fallbackWeekStats)
    } finally {
      if (loadDashboardPendingRef.current?.seq === seq) {
        loadDashboardPendingRef.current = null
      }
      if (seq === loadDashboardSeqRef.current) {
        setLoading(false)
        setSyncing(false)
      }
    }
  }, [applySnapshot, recordDate])

  const markHomeStale = useCallback((date?: string, force = false) => {
    const target = date || todayKey()
    const current = recordDate
    homeDataStaleRef.current = true
    if (target !== current) {
      return
    }
    if (force) {
      void loadHome(current, true, true)
      return
    }
    void loadHome(current, true, false)
  }, [loadHome, recordDate])

  useFocusEffect(
    useCallback(() => {
      void loadHome(recordDate, false)
      void ensureHomeDashboardCache()
      return () => {}
    }, [loadHome, recordDate]),
  )

  useFocusEffect(
    useCallback(() => {
      void refreshHomeDashboardLocalSnapshotFromCloud(recordDate).catch(() => undefined)
    }, [recordDate]),
  )

  useFocusEffect(
    useCallback(() => {
      const offRefresh = onHomeDashboardEvent(HOME_DASHBOARD_REFRESH_EVENT, (payload) => {
        markHomeStale(payload?.date, Boolean(payload?.force))
      })
      const offChanged = onHomeDashboardEvent(HOME_INTAKE_DATA_CHANGED_EVENT, (payload) => {
        markHomeStale(payload?.date, Boolean(payload?.force))
      })
      const offExpiryChanged = onHomeDashboardEvent(FOOD_EXPIRY_CHANGED_EVENT, (payload) => {
        markHomeStale(payload?.date, Boolean(payload?.force))
      })
      return () => {
        offRefresh()
        offChanged()
        offExpiryChanged()
      }
    }, [markHomeStale]),
  )

  return {
    recordDate,
    dashboard,
    petSummary,
    weekStats,
    bodyMetrics,
    exerciseBurnedKcal,
    loading,
    syncing,
    error,
    loadHome,
    markHomeStale,
  }
}
