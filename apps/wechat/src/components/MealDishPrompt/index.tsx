import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { View, Text, Image, ScrollView } from '@tarojs/components'
import Taro from '@tarojs/taro'
import SchoolPicker from '../SchoolPicker'
import CanteenPicker from '../CanteenPicker'
import { useAppColorScheme } from '../AppColorSchemeContext'
import { showUnifiedApiError, type SchoolCanteenItem, type SchoolItem } from '../../utils/api'
import { requestMealLocation } from '../../utils/meal-location-request'
import {
  answerMealDishPrompt,
  getMealDishCanteenDishes,
  getMealDishPrompt,
  startMealDishPrompt,
  type MealDishAnswer,
  type MealDishCanteen,
  type MealDishDishes,
  type MealDishItem,
  type MealDishView,
} from '../../utils/meal-dish-api'
import { clearRecommendedDish, recentRecommendedDish } from '../../utils/meal-dish-recommended'
import { canteenHint, chosenSummary, dishesForWindow, isAnswering, stepOf } from './meal-dish-state'
import { PriceStep, RecommendedStep } from './steps'
import './index.scss'

interface MealDishPromptProps {
  taskId: string
  surface: 'wait' | 'result'
  /** 等待页：识别已完成，卡片按识别结果把最像的菜排到前面。 */
  recognitionReady?: boolean
  /** 照片缩略图，补实拍图那一步展示。 */
  photoUrl?: string
  onBusyChange?: (busy: boolean) => void
  onVisibleChange?: (visible: boolean) => void
}

interface Located {
  latitude: number
  longitude: number
  accuracy?: number
}

type LocationStatus = 'granted' | 'denied' | 'unavailable' | 'unknown'

/** 只在用户已授权时静默定位，不在等待页弹授权框。 */
async function silentLocation(): Promise<{ status: LocationStatus; located?: Located }> {
  try {
    const setting = await Taro.getSetting()
    const granted = setting.authSetting?.['scope.userLocation']
    if (granted === false) return { status: 'denied' }
    if (granted !== true) return { status: 'unknown' }
    const res = await requestMealLocation()
    return { status: 'granted', located: { latitude: res.latitude, longitude: res.longitude, accuracy: res.accuracy } }
  } catch {
    return { status: 'unavailable' }
  }
}

export default function MealDishPrompt({ taskId, surface, recognitionReady, photoUrl, onBusyChange, onVisibleChange }: MealDishPromptProps) {
  const { scheme } = useAppColorScheme()
  const [view, setView] = useState<MealDishView | null>(null)
  const [offerLocation, setOfferLocation] = useState(false)
  const [dishes, setDishes] = useState<MealDishDishes | null>(null)
  const [activeWindow, setActiveWindow] = useState('')
  const [expanded, setExpanded] = useState(false)
  const [changingCanteen, setChangingCanteen] = useState(false)
  const [pending, setPending] = useState(false)
  const [schoolPickerVisible, setSchoolPickerVisible] = useState(false)
  const [pickedSchool, setPickedSchool] = useState<SchoolItem | null>(null)
  const [recommendDismissed, setRecommendDismissed] = useState(false)
  const locatedRef = useRef<Located | undefined>(undefined)

  const step = changingCanteen ? 'canteen' : stepOf(view, offerLocation, recommendDismissed)

  useEffect(() => {
    onBusyChange?.(pending || isAnswering(step))
  }, [onBusyChange, pending, step])

  useEffect(() => {
    onVisibleChange?.(step !== 'hidden')
  }, [onVisibleChange, step])

  const loadDishes = useCallback(async (canteenId: string) => {
    const next = await getMealDishCanteenDishes(canteenId, taskId)
    setDishes(next)
    setExpanded(false)
    const best = next.dishes.find(dish => dish.id === next.best_dish_id)
    setActiveWindow(best?.window_name || next.windows[0]?.name || '')
  }, [taskId])

  const start = useCallback(async (input: { status: LocationStatus; located?: Located; force?: boolean }) => {
    const recommended = recentRecommendedDish()
    const next = await startMealDishPrompt({
      task_id: taskId,
      surface,
      location_status: input.status,
      latitude: input.located?.latitude,
      longitude: input.located?.longitude,
      force: input.force,
      recommended_item_id: recommended?.item_id,
      recommended_kind: recommended?.kind,
    })
    setView(next)
    return next
  }, [surface, taskId])

  useEffect(() => {
    if (!taskId) return
    let cancelled = false
    void (async () => {
      try {
        let current: MealDishView | null = null
        if (surface === 'result') {
          const existing = await getMealDishPrompt(taskId)
          if (cancelled) return
          if (existing.eligible) {
            setView(existing)
            current = existing
          }
        }
        if (!current) {
          const location = await silentLocation()
          if (cancelled) return
          locatedRef.current = location.located
          current = await start(location)
          if (cancelled) return
          // 等待页没有任何食堂线索时，问一句要不要定位；结果页保持安静。
          setOfferLocation(surface === 'wait' && !current.eligible && location.status !== 'granted')
        }
        // 重新进入时已经选了食堂但还没选菜：接着展示这个食堂的菜单。
        const prompt = current.prompt
        if (prompt?.chosen_canteen_id && !prompt.chosen_item_id && !prompt.skipped_at && !current.candidates?.length) {
          await loadDishes(prompt.chosen_canteen_id)
        }
      } catch (error) {
        console.error('读取食堂菜品关联失败:', error)
      }
    })()
    return () => { cancelled = true }
  }, [loadDishes, start, surface, taskId])

  // 识别在用户选菜时完成：重新取一次，把识别最像的菜排到前面。
  useEffect(() => {
    const canteenId = view?.prompt?.chosen_canteen_id
    if (!recognitionReady || step !== 'dish' || !canteenId || dishes?.recognition_ready) return
    void loadDishes(canteenId).catch(() => undefined)
  }, [dishes?.recognition_ready, loadDishes, recognitionReady, step, view?.prompt?.chosen_canteen_id])

  const run = useCallback(async (action: () => Promise<void>, failure: string) => {
    if (pending) return
    setPending(true)
    try {
      await action()
    } catch (error) {
      await showUnifiedApiError(error, failure)
    } finally {
      setPending(false)
    }
  }, [pending])

  const answer = useCallback(async (input: MealDishAnswer, promptId?: string) => {
    const id = promptId || view?.prompt?.id
    if (!id) return null
    const next = await answerMealDishPrompt(id, { surface, ...input })
    setView(next)
    return next
  }, [surface, view?.prompt?.id])

  const chooseCanteen = (canteen: Pick<MealDishCanteen, 'id'>, promptId?: string) => run(async () => {
    const located = locatedRef.current
    await answer({
      step: 'canteen',
      canteen_id: canteen.id,
      latitude: located?.latitude,
      longitude: located?.longitude,
      accuracy_m: located?.accuracy,
    }, promptId)
    setChangingCanteen(false)
    await loadDishes(canteen.id)
  }, '保存食堂失败')

  const chooseDish = (dish: MealDishItem, ranked = dishes?.dishes.map(item => item.id) ?? view?.candidates?.map(item => item.id) ?? []) => run(async () => {
    const next = await answer({ step: 'dish', item_id: dish.id, suggested_item_ids: ranked.slice(0, 12) })
    if (next && stepOf(next, false) === 'done' && surface === 'wait') {
      Taro.showToast({ title: '已关联菜品', icon: 'success' })
    }
  }, '保存菜品失败')

  // 首页推荐的菜一键确认：它就是唯一的候选，排第 1。
  const confirmRecommended = (dish: MealDishItem) => {
    clearRecommendedDish()
    void chooseDish(dish, [dish.id])
  }

  const answerPrice = (kind: 'same' | 'changed' | 'skipped', price?: number) => run(async () => {
    const next = await answer({ step: 'price', price_kind: kind, price })
    if (kind !== 'skipped') {
      Taro.showToast({ title: next?.prompt?.price_applied_at ? '两人一致，价格已更新' : '谢谢，已记下这个价格', icon: 'none' })
    }
  }, '提交价格失败')

  const answerPhoto = (consent: boolean) => run(async () => {
    const next = await answer({ step: 'photo', photo_consent: consent })
    const credits = next?.prompt?.reward_credits || 0
    if (consent) Taro.showToast({ title: credits > 0 ? `已换上你的照片 积分+${credits}` : '已换上你的照片', icon: 'none' })
  }, '提交照片失败')

  const skip = (notListed = false) => run(async () => {
    if (!view?.prompt) {
      // 没有线索时用户点“不在食堂”，也留一条记录，统计非食堂餐的占比。
      const forced = await start({ status: 'unknown', located: locatedRef.current, force: true })
      if (forced.prompt) await answer({ step: 'skip' }, forced.prompt.id)
    } else {
      await answer({ step: 'skip', not_listed: notListed })
    }
    setOfferLocation(false)
    setChangingCanteen(false)
    if (notListed) Taro.showToast({ title: '收到，会补上这个窗口的菜单', icon: 'none' })
  }, '操作失败')

  const locate = () => run(async () => {
    const res = await requestMealLocation()
    locatedRef.current = { latitude: res.latitude, longitude: res.longitude, accuracy: res.accuracy }
    const next = await start({ status: 'granted', located: locatedRef.current })
    if (!next.eligible) Taro.showToast({ title: '附近没有已收录的食堂，可以手动选', icon: 'none' })
  }, '定位失败')

  const pickCanteen = (canteen: SchoolCanteenItem) => {
    setPickedSchool(null)
    void (async () => {
      let promptId = view?.prompt?.id
      if (!promptId) {
        try {
          const forced = await start({ status: locatedRef.current ? 'granted' : 'unknown', located: locatedRef.current, force: true })
          promptId = forced.prompt?.id
        } catch (error) {
          await showUnifiedApiError(error, '保存食堂失败')
          return
        }
      }
      setOfferLocation(false)
      await chooseCanteen({ id: canteen.id }, promptId)
    })()
  }

  const windowDishes = useMemo(
    () => (dishes ? dishesForWindow(dishes.dishes, activeWindow, expanded) : []),
    [activeWindow, dishes, expanded],
  )
  const windowTotal = useMemo(
    () => (dishes ? dishesForWindow(dishes.dishes, activeWindow, true).length : 0),
    [activeWindow, dishes],
  )

  if (step === 'hidden') return null
  const isDark = scheme === 'dark'
  const rootClass = `meal-dish-card meal-dish-card--${surface === 'wait' ? 'glass' : 'light'}${isDark ? ' meal-dish-card--dark' : ''}`
  // 结果页兜底：直接给出识别最像的 3 道，选菜时后端顺带确认食堂。
  const showCandidates = surface === 'result' && !changingCanteen && !dishes
    && (step === 'canteen' || step === 'dish') && (view?.candidates?.length || 0) > 0
  const candidatesFrom = view?.candidates_from
  const openFullMenu = () => {
    if (!candidatesFrom) return
    if (view?.prompt?.chosen_canteen_id === candidatesFrom.id) void run(() => loadDishes(candidatesFrom.id), '读取菜单失败')
    else void chooseCanteen(candidatesFrom)
  }

  return (
    <>
      <View className={rootClass}>
        {step === 'offer' && (
          <View>
            <View className='meal-dish-head'>
              <Text className='meal-dish-eyebrow'>顺手记一下</Text>
              <Text className='meal-dish-skip' onClick={() => void skip()}>不在食堂</Text>
            </View>
            <Text className='meal-dish-title'>在食堂吃的吗？</Text>
            <Text className='meal-dish-sub'>选一下食堂和菜，下次识别更准，还能看到同窗口的价格</Text>
            <View className='meal-dish-actions'>
              <View className='meal-dish-btn meal-dish-btn--primary' onClick={() => void locate()}>
                <Text className='meal-dish-btn-text'>定位附近食堂</Text>
              </View>
              <View className='meal-dish-btn' onClick={() => setSchoolPickerVisible(true)}>
                <Text className='meal-dish-btn-text'>手动选</Text>
              </View>
            </View>
          </View>
        )}

        {step === 'recommended' && view?.recommended_dish && (
          <RecommendedStep
            dish={view.recommended_dish}
            onConfirm={() => confirmRecommended(view.recommended_dish!)}
            onReject={() => { clearRecommendedDish(); setRecommendDismissed(true) }}
          />
        )}

        {step === 'canteen' && !showCandidates && (
          <View>
            <View className='meal-dish-head'>
              <Text className='meal-dish-eyebrow'>{surface === 'wait' ? '识别的同时' : '补一下来源'}</Text>
              <Text className='meal-dish-skip' onClick={() => (changingCanteen ? setChangingCanteen(false) : void skip())}>
                {changingCanteen ? '返回' : '不在食堂'}
              </Text>
            </View>
            <Text className='meal-dish-title'>在哪个食堂吃的？</Text>
            <View className='meal-dish-canteens'>
              {(view?.canteens || []).map(canteen => (
                <View key={canteen.id} className='meal-dish-canteen' onClick={() => void chooseCanteen(canteen)}>
                  <Text className='meal-dish-canteen-name'>{canteen.name}</Text>
                  <Text className='meal-dish-canteen-hint'>{canteenHint(canteen.reason_text, canteen.dish_count)}</Text>
                </View>
              ))}
              <View className='meal-dish-canteen meal-dish-canteen--other' onClick={() => setSchoolPickerVisible(true)}>
                <Text className='meal-dish-canteen-name'>其他食堂</Text>
                <Text className='meal-dish-canteen-hint'>按学校查找</Text>
              </View>
            </View>
          </View>
        )}

        {showCandidates && (
          <View>
            <View className='meal-dish-head'>
              <Text className='meal-dish-eyebrow' onClick={() => setChangingCanteen(true)}>{candidatesFrom?.name || '食堂'} · 换</Text>
              <Text className='meal-dish-skip' onClick={() => void skip()}>都不是</Text>
            </View>
            <Text className='meal-dish-title'>吃的是这几道之一吗？</Text>
            <View className='meal-dish-grid meal-dish-grid--three'>
              {(view?.candidates || []).map(dish => <DishTile key={dish.id} dish={dish} onClick={() => void chooseDish(dish)} />)}
            </View>
            <Text className='meal-dish-link' onClick={openFullMenu}>看全部菜</Text>
          </View>
        )}

        {step === 'dish' && !showCandidates && (
          <View>
            <View className='meal-dish-head'>
              <Text className='meal-dish-eyebrow' onClick={() => setChangingCanteen(true)}>
                {dishes?.canteen.name || view?.chosen_canteen?.name || '食堂'} · 换
              </Text>
              <Text className='meal-dish-skip' onClick={() => void skip(true)}>菜单上没有</Text>
            </View>
            <Text className='meal-dish-title'>
              {recognitionReady && surface === 'wait' ? '识别好了，选完就看结果' : '吃的哪道？'}
            </Text>
            {!dishes ? (
              <View className='meal-dish-grid'>
                {[0, 1, 2, 3].map(index => <View key={index} className='meal-dish-tile meal-dish-tile--skeleton' />)}
              </View>
            ) : dishes.dishes.length === 0 ? (
              <Text className='meal-dish-sub'>这个食堂的菜单还没收录，点“菜单上没有”告诉我们</Text>
            ) : (
              <View>
                {dishes.windows.length > 1 && (
                  <ScrollView className='meal-dish-windows' scrollX enhanced showScrollbar={false}>
                    {dishes.windows.map(window => (
                      <View
                        key={window.name}
                        className={`meal-dish-window${window.name === activeWindow ? ' active' : ''}`}
                        onClick={() => { setActiveWindow(window.name); setExpanded(false) }}
                      >
                        <Text className='meal-dish-window-text'>{window.name}</Text>
                      </View>
                    ))}
                  </ScrollView>
                )}
                <View className='meal-dish-grid'>
                  {windowDishes.map(dish => (
                    <DishTile key={dish.id} dish={dish} best={dish.id === dishes.best_dish_id} onClick={() => void chooseDish(dish)} />
                  ))}
                </View>
                {windowTotal > windowDishes.length && (
                  <Text className='meal-dish-link' onClick={() => setExpanded(true)}>看全部</Text>
                )}
              </View>
            )}
          </View>
        )}

        {step === 'photo' && (
          <View>
            <View className='meal-dish-head'>
              <Text className='meal-dish-eyebrow'>{chosenSummary(view)}</Text>
            </View>
            <View className='meal-dish-photo-row'>
              {photoUrl ? <Image className='meal-dish-photo' src={photoUrl} mode='aspectFill' /> : null}
              <View className='meal-dish-photo-copy'>
                <Text className='meal-dish-title'>这道菜还没有实拍图</Text>
                <Text className='meal-dish-sub'>用你这张照片当它的菜品图？审核通过后积分 +1</Text>
              </View>
            </View>
            <View className='meal-dish-actions'>
              <View className='meal-dish-btn meal-dish-btn--primary' onClick={() => void answerPhoto(true)}>
                <Text className='meal-dish-btn-text'>可以，用这张</Text>
              </View>
              <View className='meal-dish-btn' onClick={() => void answerPhoto(false)}>
                <Text className='meal-dish-btn-text'>不用</Text>
              </View>
            </View>
          </View>
        )}

        {step === 'price' && view?.price_ask && (
          <PriceStep
            summary={chosenSummary(view)}
            ask={view.price_ask}
            onSame={() => void answerPrice('same')}
            onChanged={price => void answerPrice('changed', price)}
            onSkip={() => void answerPrice('skipped')}
          />
        )}

        {step === 'done' && (
          <View className='meal-dish-done'>
            <Text className='meal-dish-done-mark'>✓</Text>
            <View className='meal-dish-done-copy'>
              <Text className='meal-dish-done-title'>已关联 {chosenSummary(view)}</Text>
              <Text className='meal-dish-sub'>
                {view?.prompt?.photo_contributed_at ? '你的照片已提交为菜品图' : '下次在这个食堂拍照会更快'}
              </Text>
            </View>
          </View>
        )}

        {pending && <View className='meal-dish-pending' />}
      </View>

      {/* 选择器放在卡片外：卡片的 backdrop-filter 会让 fixed 浮层被裁在卡片里。 */}
      <SchoolPicker
        visible={schoolPickerVisible}
        onSelect={school => { setSchoolPickerVisible(false); setPickedSchool(school) }}
        onCancel={() => setSchoolPickerVisible(false)}
      />
      <CanteenPicker
        visible={!!pickedSchool}
        school={pickedSchool}
        campus={null}
        onSelect={({ canteen }) => pickCanteen(canteen)}
        onCancel={() => setPickedSchool(null)}
      />
    </>
  )
}

function DishTile({ dish, best, onClick }: { dish: MealDishItem; best?: boolean; onClick: () => void }) {
  return (
    <View className={`meal-dish-tile${best ? ' best' : ''}`} onClick={onClick}>
      {dish.has_real_photo && dish.image_url ? (
        <Image className='meal-dish-tile-image' src={dish.image_url} mode='aspectFill' lazyLoad />
      ) : (
        <View className='meal-dish-tile-image meal-dish-tile-image--empty'>
          <Text className='meal-dish-tile-initial'>{dish.name.slice(0, 1)}</Text>
        </View>
      )}
      {best && <Text className='meal-dish-tile-badge'>像这道</Text>}
      <Text className='meal-dish-tile-name'>{dish.name}</Text>
      {dish.price_text ? <Text className='meal-dish-tile-price'>{dish.price_text}</Text> : null}
    </View>
  )
}
