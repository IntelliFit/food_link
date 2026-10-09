import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Image, Swiper, SwiperItem, Text, View } from '@tarojs/components'
import Taro, { useDidHide, useDidShow } from '@tarojs/taro'
import { getAccessToken, getFoodRecordById, getPublicFoodLibraryItem, previewMeals, recordMealRecommendationFeedback, type DietRecommendationOption, type DietRecommendationResult } from '../../../utils/api'
import { showDietDecisionEvidence } from '../../../utils/diet-decision-evidence'
import { currentMealLocation, rememberMealLocation } from '../../../utils/meal-location'
import { ensureWeappPrivacyAuthorized } from '../../../utils/weapp-privacy'
import { mealSource, mealTitle } from '../../../utils/meal-presentation'
import { collectFoodDisplayImageUrls } from '../../../utils/food-display-image'
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
  const [photos, setPhotos] = useState<Record<string, string>>({})
  const [failedPhotos, setFailedPhotos] = useState<Record<string, boolean>>({})
	const [pageVisible, setPageVisible] = useState(true)
	const [inViewport, setInViewport] = useState(false)
	const excluded = useRef<{ scope: string; ids: string[] }>({ scope: '', ids: [] })
	const swapping = useRef(false)
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
      const scope = `${token}:${new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10)}:${mealType}`
      if (excluded.current.scope !== scope) excluded.current = { scope, ids: [] }
      const data = await previewMeals({ meal_type: mealType, location, radius_km: 5, exclude_source_ids: excluded.current.ids })
      if (token !== getAccessToken() || seq !== sequence.current || !visible.current) return
      setSnapshot({ owner: token, result: data })
      setSelected(0)
      setPhotos({})
      setFailedPhotos({})
      // Existing source details contain real photos that the lightweight preview may omit.
      void Promise.allSettled(data.recommendations.slice(0, 3).map(async item => {
        if (item.image_path || !item.source_id) return
        const record = item.source === 'food_record'
          ? (await getFoodRecordById(item.source_id)).record
          : item.source === 'public_food_library'
            ? await getPublicFoodLibraryItem(item.source_id)
            : null
        const photo = record ? collectFoodDisplayImageUrls(record)[0] : ''
        if (photo && seq === sequence.current && token === getAccessToken() && visible.current) {
          setPhotos(previous => ({ ...previous, [item.source_id!]: photo }))
        }
      }))
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
  useDidShow(() => { visible.current = true; setPageVisible(true); void load() })
  useDidHide(() => { visible.current = false; setPageVisible(false); setInViewport(false); sequence.current += 1 })
  const options = (result?.recommendations || []).slice(0, 3)
  const option = options[selected] || options[0]
  const selectedPhoto = option && !failedPhotos[option.source_id || ''] && (option.image_path || photos[option.source_id || ''])

  useEffect(() => {
    setInViewport(false)
    if (!pageVisible || busy || !result?.recommendation_id) return
    const page = Taro.getCurrentInstance().page
    if (!page) return
    const observer = Taro.createIntersectionObserver(page, { thresholds: [0, 0.5] })
    observer.relativeToViewport().observe('#next-meal-recommendations', entry => setInViewport((entry.intersectionRatio || 0) >= 0.5))
    return () => observer.disconnect()
  }, [pageVisible, busy, result?.recommendation_id])

  useEffect(() => {
    const runId = result?.recommendation_id
    const key = option?.option_key
    if (!pageVisible || !inViewport || busy || !runId || !key) return
    const timer = setTimeout(() => {
      if (owner !== getAccessToken() || !visible.current) return
      void recordMealRecommendationFeedback({ run_id: runId, option_keys: [key], action: 'shown' }).catch(() => {})
    }, 600)
    return () => clearTimeout(timer)
  }, [pageVisible, inViewport, busy, result?.recommendation_id, option?.option_key, owner])

  const adjust = (item: DietRecommendationOption) => {
    if (result?.recommendation_id && item.option_key) void recordMealRecommendationFeedback({ run_id: result.recommendation_id, option_keys: [item.option_key], action: 'selected' }).catch(() => {})
    onAdjust(item)
  }

  const swap = async () => {
    if (busy || swapping.current || !options.length) return
    swapping.current = true
    setBusy(true)
    const token = getAccessToken()
    const keys = options.map(item => item.option_key).filter((key): key is string => !!key)
    excluded.current.ids = Array.from(new Set([...excluded.current.ids, ...options.map(item => item.source_id).filter((id): id is string => !!id)])).slice(-60)
    try {
      if (result?.recommendation_id && keys.length) await recordMealRecommendationFeedback({ run_id: result.recommendation_id, option_keys: keys, action: 'skip' }).catch(() => {})
      if (token === getAccessToken() && visible.current) await load()
    } finally { swapping.current = false }
  }

  return (
    <View id='next-meal-recommendations' className='meal-picks'>
      <View className='meal-picks__head'>
        <View className='meal-picks__heading-copy'>
          <Text className='meal-picks__kicker'>{mealName}吃这个</Text>
        </View>
        <View className='meal-picks__dots'>
          {options.map((item, index) => <View key={item.source_id || index} aria-label={`查看第${index + 1}个餐食`} className={`meal-picks__dot${selected === index ? ' is-active' : ''}`} onClick={() => setSelected(index)} />)}
        </View>
        <View className='meal-picks__locate' aria-label='更新位置，查找附近餐食' onClick={() => !busy && void load(true)}>
          {locating ? <View className='meal-picks__spinner' /> : <Text className='iconfont icon-dizhi' />}
        </View>
      </View>
      {busy ? (
        <View className='meal-picks__skeleton' aria-label='正在检索真实餐食'>
          <View /><View />
        </View>
      ) : option ? (
        <>
          <Swiper className={`meal-picks__swiper${selectedPhoto ? '' : ' meal-picks__swiper--no-photo'}`} current={selected} onChange={event => setSelected(event.detail.current)} duration={260}>
            {options.map(item => {
              const photo = failedPhotos[item.source_id || ''] ? '' : item.image_path || photos[item.source_id || '']
              return (
              <SwiperItem key={`${item.source}:${item.source_id}`}>
                <View className={`meal-picks__slide${photo ? '' : ' meal-picks__slide--no-photo'}`}>
                  {photo ? <Image className='meal-picks__image' src={photo} mode='aspectFill' onError={() => setFailedPhotos(previous => ({ ...previous, [item.source_id || '']: true }))} /> : null}
                  <View className='meal-picks__content'>
                    <Text className='meal-picks__title'>{mealTitle(item)}</Text>
                    <View className='meal-picks__source-row'>
                      <Text className='iconfont icon-dizhi meal-picks__source-icon' />
                      <Text className='meal-picks__source'>{mealSource(item).replace(/ · 直线 [\d.]+ km$/, '')}</Text>
                    </View>
                    {item.distance_km != null ? <View className='meal-picks__fit'><Text className='iconfont icon-dizhi' /><Text>直线 {item.distance_km.toFixed(1)} km</Text></View> : null}
                    <View className='meal-picks__cta' onClick={() => adjust(item)}>
                      <Text>聊聊这餐</Text>
                      <Text className='iconfont icon-right-arrow' />
                    </View>
                  </View>
                </View>
              </SwiperItem>
            )})}
          </Swiper>
        </>
      ) : <View className='meal-picks__empty'><Text onClick={() => void load()}>{error || '暂时没找到合适的餐食'}</Text><View className='meal-picks__cta' onClick={() => onAdjust()}><Text>聊聊想吃什么</Text><Text className='iconfont icon-right-arrow' /></View></View>}
      {!busy && (
        <>
          {!!option && /^foodlink-diet-decision-v[23](?:\.|$)/.test(result?.decision_engine_version || '') && <View className='meal-picks__footer'>
            {result?.decision_basis ? <View className='meal-picks__text-action' aria-role='button' onClick={() => void showDietDecisionEvidence(result.decision_basis!, option.reason, { result, option }).catch(() => {})}><Text>为什么推荐</Text></View> : null}
            <View className='meal-picks__text-action' aria-role='button' onClick={() => void swap()}><Text>换一组</Text><Text className='iconfont icon-right-arrow' /></View>
          </View>}
          {!!error && !!option && <Text className='meal-picks__error'>{error}</Text>}
        </>
      )}
    </View>
  )
}
