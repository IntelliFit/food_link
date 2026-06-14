import { useCallback, useEffect, useMemo, useState } from 'react'
import type { HomeDashboard } from '@food-link/core'
import { apiClient } from '../api'
import { todayKey } from '../utils/date'

export function useHomeDashboard() {
  const recordDate = useMemo(todayKey, [])
  const [dashboard, setDashboard] = useState<HomeDashboard | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadHome = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setDashboard(await apiClient.getHomeDashboard(recordDate))
    } catch (err) {
      setError(err instanceof Error ? err.message : '获取首页失败')
    } finally {
      setLoading(false)
    }
  }, [recordDate])

  useEffect(() => {
    void loadHome()
  }, [loadHome])

  return { recordDate, dashboard, loading, error, loadHome }
}
