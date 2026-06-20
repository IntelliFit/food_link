import { useCallback, useMemo, useState } from 'react'
import { useFocusEffect } from '@react-navigation/native'
import type { HomeDashboard, PetSummary, StatsSummary } from '@food-link/core'
import { apiClient } from '../api'
import { todayKey } from '../utils/date'
import { userFacingErrorMessage } from '../utils/errors'

export function useHomeDashboard(selectedDate?: string) {
  const initialRecordDate = useMemo(todayKey, [])
  const recordDate = selectedDate || initialRecordDate
  const [dashboard, setDashboard] = useState<HomeDashboard | null>(null)
  const [petSummary, setPetSummary] = useState<PetSummary | null>(null)
  const [weekStats, setWeekStats] = useState<StatsSummary | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadHome = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [dashboardData, petData, statsData] = await Promise.all([
        apiClient.getHomeDashboard(recordDate),
        apiClient.getPetSummary(recordDate).catch(() => null),
        apiClient.getStatsSummary('week').catch(() => null),
      ])
      setDashboard(dashboardData)
      setPetSummary(petData)
      setWeekStats(statsData)
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

  return { recordDate, dashboard, petSummary, weekStats, loading, error, loadHome }
}
