import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Text, View } from '@tarojs/components'
import Taro, { useDidHide, useDidShow } from '@tarojs/taro'
import { getAccessToken, previewMeals, type DietRecommendationOption, type DietRecommendationResult } from '../../../utils/api'
import { currentMealLocation, rememberMealLocation } from '../../../utils/meal-location'
import { ensureWeappPrivacyAuthorized } from '../../../utils/weapp-privacy'
import './NextMealRecommendations.scss'

type Props = {
  mealType: 'breakfast' | 'lunch' | 'dinner'
  mealName: string
  refreshKey: string
  onAdjust: (option?: DietRecommendationOption) => void
}

export default function NextMealRecommendations({ mealType, mealName, refreshKey, onAdjust }: Props) {
  const [snapshot, setSnapshot] = useState<{ owner: string; result: DietRecommendationResult }>()
  const [busy, setBusy] = useState(true)
  const [locating, setLocating] = useState(false)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState(0)
  const sequence = useRef(0)
  const visible = useRef(true)
  const owner = getAccessToken() || ''
  const result = snapshot?.owner === owner ? snapshot.result : undefined

  const load = useCallback(async (requestLocation = false) => {
    const token = getAccessToken() || ''
    const seq = ++sequence.current
    if (!token) { setSnapshot(undefined); setBusy(false); return }
    setBusy(true)
    setError('')
    try {
      let location = currentMealLocation(token)
      if (requestLocation) setLocating(true)
      if (requestLocation || !location) {
        try {
          const settings = await Taro.getSetting()
          // Only an explicit click may trigger a first-time permission prompt.
          if (requestLocation || settings.authSetting['scope.userLocation'] === true) {
            if (requestLocation) await ensureWeappPrivacyAuthorized()
            const fix = await Taro.getLocation({ type: 'gcj02' })
            if (token !== getAccessToken() || seq !== sequence.current) return
            location = rememberMealLocation(token, { latitude: fix.latitude, longitude: fix.longitude, accuracy_m: fix.accuracy, coordinate_type: 'gcj02', captured_at: Date.now() })
            if (!location && requestLocation) setError('定位精度不足，先看历史餐食')
          }
        } catch {
          if (requestLocation) setError('未获得位置，先看历史餐食；可在小程序设置中允许定位')
        }
      }
      if (token !== getAccessToken() || seq !== sequence.current) return
      const data = await previewMeals({ meal_type: mealType, location })
      if (token !== getAccessToken() || seq !== sequence.current || !visible.current) return
      setSnapshot({ owner: token, result: data })
      setSelected(0)
    } catch {
      if (seq === sequence.current && token === getAccessToken()) {
        setSnapshot(undefined)
        setError('餐食读取失败，点击重试')
      }
    } finally {
      if (seq === sequence.current) { setBusy(false); setLocating(false) }
    }
  }, [mealType])

  useEffect(() => { void load(); return () => { sequence.current += 1 } }, [load, refreshKey, owner])
  useDidShow(() => { visible.current = true; void load() })
  useDidHide(() => { visible.current = false; sequence.current += 1 })
  const options = result?.recommendations || []
  const option = options[selected] || options[0]
  const area = result?.location_hint
  const areaLabel = area ? `${area.province}${area.city}${area.district}` : ''
  const portion = option?.items.map(item => `${item.name}${item.amount ? ` ${item.amount}` : '（份量待确认）'}`).join(' + ')

  return (
    <View className='next-meal-guidance'>
      <View className='next-meal-guidance__head'>
        <Text className='next-meal-guidance__kicker'>下一餐 · {mealName}</Text>
        <View className='meal-choices__locate' onClick={() => !busy && void load(true)}>
          {locating ? <View className='meal-choices__spinner' /> : <Text>{currentMealLocation(owner) ? '更新位置' : '加入附近'}</Text>}
        </View>
      </View>
      {busy ? (
        <View className='next-meal-guidance__skeleton' aria-label='正在检索真实餐食'>
          <View className='next-meal-guidance__skeleton-long' /><View className='next-meal-guidance__skeleton-medium' />
        </View>
      ) : option ? (
        <>
          <View className='meal-choices__tabs'>
            {options.map((item, index) => <View key={`${item.source}:${item.source_id}`} className={`meal-choices__tab${index === selected ? ' is-active' : ''}`} onClick={() => setSelected(index)}><Text>{index + 1} · {item.decision_label || '餐食备选'}</Text></View>)}
          </View>
          <View onClick={() => onAdjust(option)}>
            <Text className='next-meal-guidance__title'>{portion || option.title}</Text>
            <Text className='next-meal-guidance__detail'>{option.source_label}{option.distance_km !== undefined ? ` · 直线约 ${option.distance_km.toFixed(1)}km` : ''}</Text>
            <Text className='meal-choices__reason'>{option.reason}</Text>
          </View>
        </>
      ) : <Text className='next-meal-guidance__detail' onClick={() => void load()}>{error || '暂无满足条件、份量可核对的完整一餐，点此重试或补充需求'}</Text>}
      {!busy && (
        <>
          {!!error && !!option && <Text className='meal-choices__note'>{error}</Text>}
          {!currentMealLocation(owner) && !!areaLabel && <Text className='meal-choices__note'>最近记录地区：{areaLabel} · 非实时位置</Text>}
          <View className='next-meal-guidance__footer' onClick={() => onAdjust(option)}>
            <Text className='next-meal-guidance__cost'>{options.length > 1 ? `${options.length} 个选择 · 选一份就好` : '真实数据参考 · 免费'}</Text>
            <Text className='next-meal-guidance__action'>补充需求 / 调整 ›</Text>
          </View>
        </>
      )}
    </View>
  )
}
