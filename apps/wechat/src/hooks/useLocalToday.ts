import { useCallback, useEffect, useRef, useState } from 'react'
import { useDidHide, useDidShow } from '@tarojs/taro'
import { getTodayRecordDateKey } from '../utils/record-date'

/** Keep the visible page's local day current, including after background suspension. */
export function useLocalToday(onDayChange?: (previousDay: string, today: string) => void): string {
  const [today, setToday] = useState(getTodayRecordDateKey)
  const todayRef = useRef(today)
  const onDayChangeRef = useRef(onDayChange)
  onDayChangeRef.current = onDayChange
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const visible = useRef(true)

  const stop = useCallback(() => {
    visible.current = false
    if (timer.current !== null) clearTimeout(timer.current)
    timer.current = null
  }, [])

  const start = useCallback(() => {
    stop()
    visible.current = true
    const checkDay = () => {
      if (!visible.current) return
      const nextDay = getTodayRecordDateKey()
      const previousDay = todayRef.current
      if (nextDay !== previousDay) {
        todayRef.current = nextDay
        setToday(nextDay)
        onDayChangeRef.current?.(previousDay, nextDay)
      }
      const now = new Date()
      const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
      timer.current = setTimeout(checkDay, Math.max(1, midnight.getTime() - now.getTime() + 50))
    }
    checkDay()
  }, [stop])

  useDidShow(start)
  useDidHide(stop)
  useEffect(() => {
    start()
    return stop
  }, [start, stop])
  return today
}
