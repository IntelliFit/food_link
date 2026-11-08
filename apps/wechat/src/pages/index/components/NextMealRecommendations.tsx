import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Image, Swiper, SwiperItem, Text, View } from '@tarojs/components'
import Taro, { useDidHide, useDidShow } from '@tarojs/taro'
import { getAccessToken, getFoodRecordById, getFoodRecordList, getPublicFoodLibraryItem, previewMeals, recordMealRecommendationFeedback, type DietRecommendationOption, type DietRecommendationResult, type FoodRecord } from '../../../utils/api'
import { showDietDecisionEvidence } from '../../../utils/diet-decision-evidence'
import { currentMealLocation, rememberMealLocation } from '../../../utils/meal-location'
import { mealLocationFailure, mealPreviewFailure, requestMealLocation } from '../../../utils/meal-location-request'
import { canNavigateMeal, navigateToMeal } from '../../../utils/meal-navigation'
import { ensureWeappPrivacyAuthorized } from '../../../utils/weapp-privacy'
import { mealSource, mealTitle } from '../../../utils/meal-presentation'
import { rememberRecommendedDish } from '../../../utils/meal-dish-recommended'
import { collectFoodDisplayImageUrls } from '../../../utils/food-display-image'
import { mergeJudgedPreview, readMealPreviewCache, recentMealRecords, recordMealName, writeMealPreviewCache } from '../../../utils/meal-preview-cache'
import PetThinking, { type PetThinkingPet } from '../../../components/PetThinking'
import { petDisplayName } from '../../../utils/pet-name'
import MealRefineBadge, { type MealRefineState } from './MealRefineBadge'
import { mealWaitText, type MealWaitStage } from './meal-wait-steps'
import './NextMealRecommendations.scss'

/** The meal the server chose for the card, which late at night differs from the one asked for. */
export type NextMealCardMeal = Pick<DietRecommendationResult, 'meal_type' | 'meal_date' | 'meal_label'>

type Props = {
  mealType: 'breakfast' | 'lunch' | 'dinner'
  mealName: string
  refreshKey: string
  onAdjust: (option?: DietRecommendationOption, meal?: NextMealCardMeal) => void
  /** The user's own partner, shown while the card waits; hidden when the user hid it. */
  pet?: PetThinkingPet | null
  petHidden?: boolean
}

// The home page settles its nutrition totals a moment after opening, which
// changes refreshKey; waiting this long sends one preview instead of two.
const LOAD_SETTLE_MS = 350
// The server finds open venues, then scores today's gaps, then compares dishes.
// These only advance the words while the answer is still on its way.
const WAIT_STAGE_STEPS: Array<[MealWaitStage, number]> = [['scoring', 700], ['comparing', 1800]]

export default function NextMealRecommendations({ mealType, mealName, refreshKey, onAdjust, pet, petHidden }: Props) {
  // stale: last answer read from the phone, shown until a fresh one arrives.
  const [snapshot, setSnapshot] = useState<{ owner: string; meal: string; date: string; result: DietRecommendationResult; stale?: boolean }>()
  const [busy, setBusy] = useState(true)
  // The rule pick is on screen and the model's own pick is still on its way.
  const [refining, setRefining] = useState(false)
  const [recent, setRecent] = useState<FoodRecord[]>([])
  const interacted = useRef(false)
  const selectedSourceId = useRef('')
  // Every step taken since this load started, newest last.
  const [waitStages, setWaitStages] = useState<MealWaitStage[]>([])
  const waitTimers = useRef<Array<ReturnType<typeof setTimeout>>>([])
  // Shows 挑好了 for a moment after the model's pick replaced the rule pick.
  const [refineDone, setRefineDone] = useState(false)
  const refineDoneTimer = useRef<ReturnType<typeof setTimeout>>()
  const loadTimer = useRef<ReturnType<typeof setTimeout>>()
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
    const date = refreshKey.split(':')[0]
    const cached = readMealPreviewCache(token, mealType, date)
    setSnapshot(previous => {
      if (previous?.owner === token && previous.meal === mealType && previous.date === date) return previous
      return cached ? { owner: token, meal: mealType, date, result: cached, stale: true } : previous
    })
    setBusy(true)
    setWaitStages([])
    setRefining(false)
    setRecent([])
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
            setWaitStages(['locating'])
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
      const current = () => token === getAccessToken() && seq === sequence.current && visible.current
      const request = { meal_type: mealType, location, radius_km: 5, exclude_source_ids: excluded.current.ids }
      // Step 1: the rule pick comes back at once, so the card is never blank for long.
      startWaitStages()
      let data: DietRecommendationResult
      try {
        data = await previewMeals({ ...request, judge_mode: 'skip' })
      } finally {
        stopWaitStages()
      }
      if (!current()) return
      if (!Array.isArray(data?.recommendations)) throw new Error('餐食推荐响应不完整')
      setSnapshot({ owner: token, meal: mealType, date, result: data })
      setSelected(0)
      interacted.current = false
      setPhotos({})
      setFailedPhotos({})
      loadPhotos(data, current)
      writeMealPreviewCache(token, mealType, date, data)
      if (!data.recommendations.length) void loadRecent(date, current)
      setBusy(false)
      // Free the load lock so 换一组 or a location update can start over while step 2 runs.
      if (loading.current?.seq === seq) loading.current = undefined
      if (!data.judge_pending) return
      // Step 2: the model's own pick, which can take 15s; nobody waits on it.
      setRefining(true)
      try {
        const judged = await previewMeals({ ...request, judge_mode: 'background' })
        if (!current()) return
        const merged = mergeJudgedPreview(judged, interacted.current, selectedSourceId.current)
        if (!merged) return
        setSnapshot({ owner: token, meal: mealType, date, result: merged.result })
        setSelected(merged.selected)
        loadPhotos(merged.result, current)
        writeMealPreviewCache(token, mealType, date, merged.result)
        showRefineDone()
      } catch {
        // The rule pick already on screen stays; this step is only a refinement.
      } finally {
        if (seq === sequence.current) setRefining(false)
      }
    } catch (requestError) {
      if (seq === sequence.current && token === getAccessToken() && visible.current) {
        setError(mealPreviewFailure(requestError))
      }
    } finally {
      if (seq === sequence.current) { setBusy(false); setLocating(false) }
      if (loading.current?.seq === seq) loading.current = undefined
    }
  }, [mealType, refreshKey])

  function startWaitStages() {
    stopWaitStages()
    setWaitStages(previous => [...previous.filter(stage => stage === 'locating'), 'searching'])
    waitTimers.current = WAIT_STAGE_STEPS.map(([stage, at]) => setTimeout(() => setWaitStages(previous => [...previous, stage]), at))
  }

  function stopWaitStages() {
    waitTimers.current.forEach(clearTimeout)
    waitTimers.current = []
  }

  function showRefineDone() {
    if (refineDoneTimer.current) clearTimeout(refineDoneTimer.current)
    setRefineDone(true)
    refineDoneTimer.current = setTimeout(() => setRefineDone(false), 2000)
  }

  const scheduleLoad = useCallback(() => {
    if (loadTimer.current) clearTimeout(loadTimer.current)
    loadTimer.current = setTimeout(() => { loadTimer.current = undefined; void load() }, LOAD_SETTLE_MS)
  }, [load])

  // Existing source details contain real photos that the lightweight preview may omit.
  function loadPhotos(data: DietRecommendationResult, current: () => boolean) {
    void Promise.allSettled(data.recommendations.slice(0, 3).map(async item => {
      if (item.image_path || !item.source_id) return
      const record = item.source === 'food_record'
        ? (await getFoodRecordById(item.source_id)).record
        : item.source === 'public_food_library'
          ? await getPublicFoodLibraryItem(item.source_id)
          : null
      const photo = record ? collectFoodDisplayImageUrls(record)[0] : ''
      if (photo && current()) setPhotos(previous => ({ ...previous, [item.source_id!]: photo }))
    }))
  }

  // Nothing to recommend: show what the user ate for this meal on the last three days.
  async function loadRecent(date: string, current: () => boolean) {
    const day = Date.parse(`${date}T00:00:00Z`)
    if (Number.isNaN(day)) return
    const dates = [1, 2, 3].map(offset => new Date(day - offset * 86400000).toISOString().slice(0, 10))
    const lists = await Promise.allSettled(dates.map(item => getFoodRecordList(item)))
    const records = lists.flatMap(list => (list.status === 'fulfilled' ? list.value.records : []))
    if (current()) setRecent(recentMealRecords(records, mealType))
  }

  // The saved answer needs no network, so it shows at once, before the settled load.
  useEffect(() => {
    const date = refreshKey.split(':')[0]
    if (!owner) return
    const cached = readMealPreviewCache(owner, mealType, date)
    if (!cached) return
    setSnapshot(previous => (previous?.owner === owner && previous.meal === mealType && previous.date === date ? previous : { owner, meal: mealType, date, result: cached, stale: true }))
  }, [owner, mealType, refreshKey])
  useEffect(() => { scheduleLoad(); return () => { sequence.current += 1 } }, [scheduleLoad, refreshKey, owner])
  useEffect(() => () => {
    if (loadTimer.current) clearTimeout(loadTimer.current)
    if (refineDoneTimer.current) clearTimeout(refineDoneTimer.current)
    stopWaitStages()
  }, [])
  useDidShow(() => { visible.current = true; setPageVisible(true); scheduleLoad() })
  useDidHide(() => {
    visible.current = false; setPageVisible(false); setInViewport(false); sequence.current += 1; loading.current = undefined
    if (loadTimer.current) { clearTimeout(loadTimer.current); loadTimer.current = undefined }
  })
  const options = (result?.recommendations || []).slice(0, 3)
  const option = options[selected] || options[0]
  const selectedPhoto = option && !failedPhotos[option.source_id || ''] && (option.image_path || photos[option.source_id || ''])
  const stale = !!result && !!snapshot?.stale
  const refineState: MealRefineState | undefined = refineDone ? 'done' : refining ? 'refining' : busy && stale ? 'updating' : undefined
  selectedSourceId.current = option?.source_id || ''

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
    if (!pageVisible || !inViewport || busy || stale || !runId || !key) return
    const timer = setTimeout(() => {
      if (owner !== getAccessToken() || !visible.current) return
      void recordMealRecommendationFeedback({ run_id: runId, option_keys: [key], action: 'shown' }).catch(() => {})
      rememberRecommendedDish(option?.source, option?.source_id, 'shown')
    }, 600)
    return () => clearTimeout(timer)
  }, [pageVisible, inViewport, busy, stale, result?.recommendation_id, option?.option_key, option?.source, option?.source_id, owner])

  const adjust = (item: DietRecommendationOption) => {
    rememberRecommendedDish(item.source, item.source_id, 'chatted')
    if (result?.recommendation_id && item.option_key) void recordMealRecommendationFeedback({ run_id: result.recommendation_id, option_keys: [item.option_key], action: 'selected' }).catch(() => {})
    onAdjust(item, result)
  }

  const navigate = async (item: DietRecommendationOption) => {
    if (navigationPending.current) return
    navigationPending.current = true
    rememberRecommendedDish(item.source, item.source_id, 'navigated')
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
          <Text className='meal-picks__kicker'>{result?.meal_label || mealName}吃这个</Text>
          {stale && <Text className='meal-picks__stale'>上次推荐</Text>}
        </View>
        <View className='meal-picks__dots'>
          {(busy || refining) && !locating && <View className='meal-picks__spinner' aria-label='正在获取餐食推荐' />}
          {options.map((item, index) => <View key={item.source_id || index} aria-label={`查看第${index + 1}个餐食`} className={`meal-picks__dot${selected === index ? ' is-active' : ''}`} onClick={() => { interacted.current = true; setSelected(index) }} />)}
        </View>
        <View className='meal-picks__locate' aria-label='更新位置，查找附近餐食' onClick={() => !busy && void load(true)}>
          {locating ? <View className='meal-picks__spinner' /> : <Text className='iconfont icon-dizhi' />}
        </View>
      </View>
      {!!locationNotice && <View className='meal-picks__notice'><Text>{locationNotice}</Text>{locationSettings && <Text className='meal-picks__text-action' onClick={() => void openLocationSettings()}>去设置</Text>}</View>}
      {busy && !option ? (
        <PetThinking pet={pet} hidePet={!!petHidden} steps={(waitStages.length ? waitStages : ['searching' as MealWaitStage]).map(stage => mealWaitText(stage, petDisplayName(pet?.name)))} />
      ) : option ? (
        <View key={result?.recommendation_id || 'meal'} className={`meal-picks__served${stale ? ' is-stale' : ''}`}>
          {refineState && <MealRefineBadge pet={pet} hidePet={!!petHidden} state={refineState} />}
          <Swiper className={`meal-picks__swiper${selectedPhoto ? '' : ' meal-picks__swiper--no-photo'}`} current={selected} onChange={event => { if (event.detail.source === 'touch') interacted.current = true; setSelected(event.detail.current) }} duration={260}>
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
        </View>
      ) : (
        <View className='meal-picks__empty'>
          <Text onClick={() => void load()}>{error || '暂时没找到合适的餐食'}</Text>
          {!error && recent.length > 0 && (
            <View className='meal-picks__recent'>
              <Text className='meal-picks__recent-title'>最近吃过的{mealName}</Text>
              {recent.map(record => (
                <View key={record.id} className='meal-picks__recent-row'>
                  <Text className='meal-picks__recent-name'>{recordMealName(record)}</Text>
                  <Text className='meal-picks__recent-kcal'>{Math.round(record.total_calories || 0)} kcal</Text>
                </View>
              ))}
            </View>
          )}
          <View className='meal-picks__cta' onClick={() => onAdjust()}><Text>聊聊想吃什么</Text><Text className='iconfont icon-right-arrow' /></View>
        </View>
      )}
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
