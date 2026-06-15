import { useCallback, useEffect, useMemo, useState } from 'react'
import type { HomeDashboard, PetSummary } from '@food-link/core'
import { apiClient } from '../api'
import { todayKey } from '../utils/date'

export function useHomeDashboard() {
  const recordDate = useMemo(todayKey, [])
  const [dashboard, setDashboard] = useState<HomeDashboard | null>(null)
  const [petSummary, setPetSummary] = useState<PetSummary | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadHome = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [dashboardData, petData] = await Promise.all([
        apiClient.getHomeDashboard(recordDate),
        apiClient.getPetSummary(recordDate).catch(() => null),
      ])
      setDashboard(dashboardData)
      setPetSummary(petData)
    } catch (err) {
      setError(err instanceof Error ? err.message : '获取首页失败')
    } finally {
      setLoading(false)
    }
  }, [recordDate])

  useEffect(() => {
    void loadHome()
  }, [loadHome])

  return { recordDate, dashboard, petSummary, loading, error, loadHome }
}
