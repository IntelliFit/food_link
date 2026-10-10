import Taro, { useDidShow } from '@tarojs/taro'
import { useCallback, useEffect, useRef, useState } from 'react'
import { getAccessToken } from '../utils/api'
import { mealRequest, type MealMeetup } from '../utils/meal-meetup'

export function useMealDetail() {
  const id = String(Taro.getCurrentInstance().router?.params.id || '')
  const [row, setRow] = useState<MealMeetup>()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const epoch = useRef(0)
  const account = useRef(getAccessToken())
  const reload = useCallback(async () => {
    const turn = ++epoch.current
    const token = getAccessToken()
    if (account.current !== token) { setRow(undefined); account.current = token }
    setLoading(true); setError('')
    try {
      if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error('约饭链接无效')
      const next = await mealRequest<MealMeetup>(`/${id}`)
      if (turn === epoch.current && token === getAccessToken()) setRow(next)
    } catch (e) { if (turn === epoch.current) { setRow(undefined); setError(e instanceof Error ? e.message : '约饭暂时无法获取') } }
    finally { if (turn === epoch.current) setLoading(false) }
  }, [id])
  useDidShow(() => { void reload() })
  useEffect(() => () => { epoch.current++ }, [])
  return { id, row, loading, error, reload }
}
