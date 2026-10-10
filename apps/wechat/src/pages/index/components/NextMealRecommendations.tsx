import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Image, Swiper, SwiperItem, Text, View } from '@tarojs/components'
import Taro, { useDidHide, useDidShow } from '@tarojs/taro'
import { getAccessToken, getFoodRecordById, getPublicFoodLibraryItem, previewMeals, recordMealRecommendationFeedback, type DietRecommendationOption, type DietRecommendationResult } from '../../../utils/api'
import { showDietDecisionEvidence } from '../../../utils/diet-decision-evidence'
import { currentMealLocation, rememberMealLocation } from '../../../utils/meal-location'
import { mealLocationFailure, mealPreviewFailure, requestMealLocation } from '../../../utils/meal-location-request'
import { canNavigateMeal, navigateToMeal } from '../../../utils/meal-navigation'
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
  const [snapshot, setSnapshot] = useState<{ owner: string; meal: string; date: string; result: DietRecommendationResult }>()
  const [busy, setBusy] = useState(true)
  const [locating, setLocating] = useState(false)
  const [error, setError] = useState('')
  const [locationNotice, setLocationNotice] = useState('')
  const [locationSettings, setLocationSettings] = useState(false)
  const [navigating, setNavigating] = useState('')
  const navigationPending = useRef(false)
  const loading = useRef<{ scope: string; seq: number }>()
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
  const result = snapshot?.owner === owner && snapshot.meal === mealType && snapshot.date === refreshKey.split(':')[0] ? snapshot.result : undefined

  const load = useCallback(async (requestLocation = false) => {
    const token = getAccessToken() || ''
    const loadScope = `${token}:${mealType}:${refreshKey}`
    if (loading.current?.scope === loadScope) return
    const seq = ++sequence.current
    if (!token) { setSnapshot(undefined); setBusy(false); return }
    loading.current = { scope: loadScope, seq }
    setBusy(true)
    setError('')
    try {
      let location = currentMealLocation(token)
      if (requestLocation) { setLocationNotice(''); setLocationSettings(false) }
      if (requestLocation || !location) {
        try {
          const settings = await Taro.getSetting()
          if (requestLocation && settings.authSetting['scope.userLocation'] === false) {
            throw new Error('auth denied')
          }
          // Only an explicit click may trigger a first-time permission prompt.
          if (requestLocation || settings.authSetting['scope.userLocation'] === true) {
            setLocating(true)
            if (requestLocation) await ensureWeappPrivacyAuthorized()
            const fix = await requestMealLocation()
            if (token !== getAccessToken() || seq !== sequence.current) return
            const fresh = rememberMealLocation(token, { latitude: fix.latitude, longitude: fix.longitude, accuracy_m: fix.accuracy, coordinate_type: 'gcj02', captured_at: Date.now() })
            if (fresh) {
              location = fresh
              setLocationNotice('')
              setLocationSettings(false)
            } else {
              if (location) rememberMealLocation(token, location)
              setLocationNotice(`定位精度不足；${location ? '暂用最近一次有效位置' : '当前仅显示非附近餐食参考'}`)
            }
          } else {
            setLocationNotice('还未取得当前位置；点击位置图标查找附近餐食')
          }
        } catch (locationError) {
          if (seq !== sequence.current || token !== getAccessToken()) return
          const failure = mealLocationFailure(locationError)
          setLocationNotice(`${failure.message}；${location ? '暂用最近一次有效位置' : '当前仅显示非附近餐食参考'}`)
          setLocationSettings(!!failure.settings)
        } finally {
          if (seq === sequence.current) setLocating(false)
        }
      }
      if (token !== getAccessToken() || seq !== sequence.current || !visible.current) return
      const scope = `${token}:${new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10)}:${mealType}`
      if (excluded.current.scope !== scope) excluded.current = { scope, ids: [] }
      const data = await previewMeals({ meal_type: mealType, location, radius_km: 5, exclude_source_ids: excluded.current.ids })
      if (token !== getAccessToken() || seq !== sequence.current || !visible.current) return
      if (!Array.isArray(data?.recommendations)) throw new Error('餐食推荐响应不完整')
      setSnapshot({ owner: token, meal: mealType, date: refreshKey.split(':')[0], result: data })
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
    } catch (requestError) {
      if (seq === sequence.current && token === getAccessToken() && visible.current) {
        setError(mealPreviewFailure(requestError))
      }
    } finally {
      if (seq === sequence.current) { setBusy(false); setLocating(false) }
      if (loading.current?.seq === seq) loading.current = undefined
    }
  }, [mealType, refreshKey])

  useEffect(() => { void load(); return () => { sequence.current += 1 } }, [load, refreshKey, owner])
  useDidShow(() => { visible.current = true; setPageVisible(true); void load() })
  useDidHide(() => { visible.current = false; setPageVisible(false); setInViewport(false); sequence.current += 1; loading.current = undefined })
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

  const navigate = async (item: DietRecommendationOption) => {
    if (navigationPending.current) return
    navigationPending.current = true
    setNavigating(item.source_id || item.title)
    try { await navigateToMeal(item) }
    catch (navigationError) { void Taro.showToast({ title: (navigationError as Error).message || '暂时无法打开地图', icon: 'none' }) }
    finally { navigationPending.current = false; setNavigating('') }
  }

  const openLocationSettings = async () => {
    const token = getAccessToken()
    try {
      const setting = await Taro.openSetting()
      if (token === getAccessToken() && visible.current && setting.authSetting['scope.userLocation']) await load(true)
    } catch { void Taro.showToast({ title: '设置未打开，可点击位置图标重试', icon: 'none' }) }
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
          {busy && !locating && <View className='meal-picks__spinner' aria-label='正在获取餐食推荐' />}
          {options.map((item, index) => <View key={item.source_id || index} aria-label={`查看第${index + 1}个餐食`} className={`meal-picks__dot${selected === index ? ' is-active' : ''}`} onClick={() => setSelected(index)} />)}
        </View>
        <View className='meal-picks__locate' aria-label='更新位置，查找附近餐食' onClick={() => !busy && void load(true)}>
          {locating ? <View className='meal-picks__spinner' /> : <Text className='iconfont icon-dizhi' />}
        </View>
      </View>
      {!!locationNotice && <View className='meal-picks__notice'><Text>{locationNotice}</Text>{locationSettings && <Text className='meal-picks__text-action' onClick={() => void openLocationSettings()}>去设置</Text>}</View>}
      {busy && !option ? (
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
                      {canNavigateMeal(item) && <View className='meal-picks__navigate' aria-role='button' aria-label='导航到餐食地点' onClick={() => void navigate(item)}>{navigating === (item.source_id || item.title) ? <View className='meal-picks__spinner' /> : <Text>导航</Text>}</View>}
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
          {!!error && !!option && <Text className='meal-picks__error' onClick={() => void load()}>本次刷新未成功，保留上次推荐。{error}</Text>}
        </>
      )}
    </View>
  )
}
