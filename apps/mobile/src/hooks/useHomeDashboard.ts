import { useCallback, useMemo, useState } from 'react'
import { useFocusEffect } from '@react-navigation/native'
import type { BodyMetricsSummary, HomeDashboard, PetSummary, StatsSummary } from '@food-link/core'
import { apiClient } from '../api'
import { todayKey } from '../utils/date'
import { userFacingErrorMessage } from '../utils/errors'

function parseExerciseBurnedKcal(raw: unknown): number {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw
  if (typeof raw === 'string') {
    const n = parseFloat(raw.trim())
    return Number.isFinite(n) ? n : 0
  }
  return 0
}

function mergeExerciseKcalFromDashboardAndLogs(dashboardRaw: unknown, logsTotal: unknown): number {
  const dash = parseExerciseBurnedKcal(dashboardRaw)
  const fromLogs =
    typeof logsTotal === 'number' && Number.isFinite(logsTotal)
      ? logsTotal
      : typeof logsTotal === 'string'
        ? parseFloat(logsTotal.trim())
        : NaN
  if (Number.isFinite(fromLogs)) return Math.max(dash, fromLogs)
  return dash
}

export function useHomeDashboard(selectedDate?: string) {
  const initialRecordDate = useMemo(todayKey, [])
  const recordDate = selectedDate || initialRecordDate
  const [dashboard, setDashboard] = useState<HomeDashboard | null>(null)
  const [petSummary, setPetSummary] = useState<PetSummary | null>(null)
  const [weekStats, setWeekStats] = useState<StatsSummary | null>(null)
  const [bodyMetrics, setBodyMetrics] = useState<BodyMetricsSummary | null>(null)
  const [exerciseBurnedKcal, setExerciseBurnedKcal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadHome = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [dashboardData, petData, statsData, bodyMetricsData, exerciseLogsData] = await Promise.all([
        apiClient.getHomeDashboard(recordDate),
        apiClient.getPetSummary(recordDate).catch(() => null),
        apiClient.getStatsSummary('week').catch(() => null),
        apiClient.getBodyMetricsSummary('month').catch(() => null),
        apiClient.getExerciseLogs({ date: recordDate }).catch(() => null),
      ])
      setDashboard(dashboardData)
      setPetSummary(petData)
      setWeekStats(statsData)
      setBodyMetrics(bodyMetricsData)
      setExerciseBurnedKcal(mergeExerciseKcalFromDashboardAndLogs(dashboardData.exerciseBurnedKcal, exerciseLogsData?.total_calories))
    } catch (err) {
      setError(userFacingErrorMessage(err, '获取首页失败'))
    } finally {
      setLoading(false)
    }
  }, [recordDate])

  useFocusEffect(
    useCallback(() => {
      void loadHome()
    }, [loadHome]),
  )

  return { recordDate, dashboard, petSummary, weekStats, bodyMetrics, exerciseBurnedKcal, loading, error, loadHome }
}
