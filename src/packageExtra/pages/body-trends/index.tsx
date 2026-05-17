import { View } from '@tarojs/components'
import { useEffect } from 'react'
import Taro, { useRouter } from '@tarojs/taro'
import { extraPkgUrl } from '../../../utils/subpackage-extra'
import { normalizeRouteDate } from '../body-metrics-shared'

type BodyTrendTab = 'weight' | 'water' | 'exercise'

function normalizeTab(value: unknown): BodyTrendTab {
  if (value === 'water' || value === 'exercise') return value
  return 'weight'
}

function BodyTrendsCompatPage() {
  const router = useRouter()

  useEffect(() => {
    const tab = normalizeTab(router.params?.tab)
    const date = normalizeRouteDate(String(router.params?.date || ''))
    const page = tab === 'weight'
      ? '/pages/weight-record/index'
      : tab === 'water'
        ? '/pages/water-record/index'
        : '/pages/exercise-record/index'
    Taro.redirectTo({ url: `${extraPkgUrl(page)}?date=${encodeURIComponent(date)}` })
  }, [router.params?.date, router.params?.tab])

  return <View className='body-trends-compat-page' />
}

export default BodyTrendsCompatPage
