import { View, Text, Image } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { useCallback, useEffect, useState } from 'react'
import { getMealImpact, getPetDailyBrief, type MealImpact } from '../../utils/api'
import { experiments } from '../../utils/experiments'
import { PetAvatar } from '../PetAvatar'
import {
  buildImpactRows,
  dayWord,
  headerText,
  mealSubtitle,
  pickPetFeedback,
  withTimeout,
  type MealImpactMeal,
  type MealImpactRow,
  type PetFeedback,
} from './meal-impact-view'

// 脚本和样式拆在 packageExtra/meal-impact.js / .wxss（config/index.ts 的 meal-impact 规则），页面自动 @import 样式
import './index.scss'

export type MealImpactSource = 'result' | 'result_text' | 'manual'

const IMPACT_DEADLINE_MS = 3000
/** 营养变化到了之后，宠物那句话最多再等这么久，免得弹层出来后又长高一截 */
const PET_GRACE_MS = 600
/** 小麦 Tab：今天还差什么，刚记的这餐会在那里完成今天的任务 */
const PET_TAB_URL = '/pages/pet/index'
/** 完整分析是二级页，看过去某天时去这里 */
const STATS_DETAIL_URL = '/pages/stats/index'

interface LoadedImpact {
  impact: MealImpact
  rows: MealImpactRow[]
  pet: PetFeedback | null
}

/** 两个请求同时发；接口还没上线、失败或超过 3 秒都当没有，页面照原样往下走 */
async function loadMealImpact(recordId: string): Promise<LoadedImpact | null> {
  const petPromise = withTimeout(getPetDailyBrief(IMPACT_DEADLINE_MS), IMPACT_DEADLINE_MS).catch(() => null)
  let impact: MealImpact
  try {
    impact = await withTimeout(getMealImpact(recordId, IMPACT_DEADLINE_MS), IMPACT_DEADLINE_MS)
  } catch {
    return null
  }
  const rows = buildImpactRows(impact)
  if (!rows.length) return null
  const daily = await withTimeout(petPromise, PET_GRACE_MS).catch(() => null)
  return { impact, rows, pet: pickPetFeedback(daily) }
}

function ImpactRowView({ row }: { row: MealImpactRow }) {
  return (
    <View className={`meal-impact__row meal-impact__row--${row.tone}`}>
      <View className='meal-impact__row-line'>
        <View className='meal-impact__row-name'>
          <Text className='meal-impact__row-label'>{row.label}</Text>
          {row.deltaText ? <Text className='meal-impact__row-delta'>{row.deltaText}</Text> : null}
          {row.badge ? <Text className='meal-impact__row-badge'>{row.badge}</Text> : null}
        </View>
        {row.note ? (
          <Text className='meal-impact__row-note'>{row.note}</Text>
        ) : (
          <Text className='meal-impact__row-total'>
            <Text className='meal-impact__row-after'>{row.totalText}</Text>
            {row.targetText ? ` ${row.targetText}` : ''}
          </Text>
        )}
      </View>
      {row.note ? null : (
        <View className='meal-impact__bar'>
          <View className='meal-impact__bar-before' style={{ width: `${row.beforePct}%` }} />
          <View className='meal-impact__bar-meal' style={{ width: `${row.deltaPct}%` }} />
        </View>
      )}
    </View>
  )
}

interface MealImpactSheetProps {
  source: MealImpactSource
  recordId: string
  meal?: MealImpactMeal
  /** 完成、关闭（shown=true），或者没拿到数据（shown=false）：页面继续原来的流程（回首页、打卡图） */
  onFinish: (shown: boolean) => void
  /** 去了分析页：页面原来的流程不再继续 */
  onLeave: () => void
}

function MealImpactSheet({ source, recordId, meal, onFinish, onLeave }: MealImpactSheetProps) {
  const [loaded, setLoaded] = useState<LoadedImpact | null>(null)

  useEffect(() => {
    let disposed = false
    void loadMealImpact(recordId).then((result) => {
      if (disposed) return
      if (!result) {
        onFinish(false)
        return
      }
      setLoaded(result)
      experiments.track('meal_impact_view', {
        source,
        changes: result.rows.length,
        has_pet: !!result.pet,
        task_done: result.pet?.exp != null,
      })
    })
    return () => {
      disposed = true
    }
    // 每条记录只拉一次；onFinish 换引用不重新请求
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recordId])

  if (!loaded) {
    // 等数据时挡住页面，防止再点一次保存；只用视觉提示
    return (
      <View className='meal-impact meal-impact--pending' catchMove>
        <View className='meal-impact__dots'>
          <View className='meal-impact__dot' />
          <View className='meal-impact__dot' />
          <View className='meal-impact__dot' />
        </View>
      </View>
    )
  }

  const { impact, rows, pet } = loaded
  const now = new Date()
  const date = impact.date || meal?.date
  const day = dayWord(date, now)
  const subtitle = meal ? mealSubtitle(meal) : ''
  const headline = String(impact.headline || '').trim()

  const close = (target: 'done' | 'close') => {
    experiments.track('meal_impact_click', { source, target })
    onFinish(true)
  }

  const goStats = () => {
    experiments.track('meal_impact_click', { source, target: 'stats' })
    onLeave()
    const open = day === '今天'
      ? Taro.switchTab({ url: PET_TAB_URL })
      : Taro.navigateTo({ url: STATS_DETAIL_URL })
    void open.catch(() => onFinish(true))
  }

  return (
    <View className='meal-impact' catchMove>
      <View className='meal-impact__mask' onClick={() => close('close')} />
      <View className='meal-impact__panel'>
        <View className='meal-impact__header'>
          <View className='meal-impact__title'>
            <View className='meal-impact__check' />
            <Text>{headerText(impact.meal_type || meal?.mealType, date, now)}</Text>
          </View>
          <View className='meal-impact__close' onClick={() => close('close')}>
            <Text className='meal-impact__close-text'>×</Text>
          </View>
        </View>

        {meal?.title ? (
          <View className='meal-impact__meal'>
            {meal.imageUrl ? <Image className='meal-impact__photo' src={meal.imageUrl} mode='aspectFill' /> : null}
            <View className='meal-impact__meal-text'>
              <Text className='meal-impact__meal-title'>{meal.title}</Text>
              {subtitle ? <Text className='meal-impact__meal-sub'>{subtitle}</Text> : null}
            </View>
          </View>
        ) : null}

        <View className='meal-impact__card'>
          <View className='meal-impact__card-head'>
            <Text className='meal-impact__card-title'>这一餐让{day}</Text>
            <Text className='meal-impact__legend'>深色那段是这一餐</Text>
          </View>
          {headline ? <Text className='meal-impact__headline'>{headline}</Text> : null}
          {rows.map(row => <ImpactRowView key={row.key} row={row} />)}
        </View>

        {pet ? (
          <View className='meal-impact__pet'>
            <View className='meal-impact__pet-avatar'>
              <PetAvatar pet={pet.pet} mood={pet.mood} size={52} />
            </View>
            <View className='meal-impact__pet-body'>
              {pet.line ? <Text className='meal-impact__pet-line'>{pet.line}</Text> : null}
              {pet.exp != null ? (
                <View className='meal-impact__pet-task'>
                  <View className='meal-impact__pet-task-check' />
                  <Text>任务完成 +{pet.exp} 经验</Text>
                </View>
              ) : null}
            </View>
          </View>
        ) : null}

        <View className='meal-impact__actions'>
          <View className='meal-impact__primary' hoverClass='meal-impact__btn--pressed' onClick={goStats}>
            <Text>{day === '今天' ? '看今天还差什么' : '去分析页看看'}</Text>
          </View>
          <View className='meal-impact__secondary' hoverClass='meal-impact__btn--pressed' onClick={() => close('done')}>
            <Text>完成</Text>
          </View>
        </View>
      </View>
    </View>
  )
}

interface PendingImpact {
  recordId: string
  meal?: MealImpactMeal
  onDone: (shown: boolean) => void
}

/**
 * 保存一餐后告诉用户「这一餐让今天变了什么」。
 * 页面在原来要回首页 / 弹打卡图的地方调 show(recordId, meal, 原来的下一步)；
 * 拿不到数据就直接走原来的下一步（shown=false），用户看不出差别。
 */
export function useMealImpactSheet(source: MealImpactSource) {
  const [pending, setPending] = useState<PendingImpact | null>(null)

  const show = useCallback((recordId: string, meal: MealImpactMeal | undefined, onDone: (shown: boolean) => void) => {
    if (!recordId) {
      onDone(false)
      return
    }
    setPending({ recordId, meal, onDone })
  }, [])

  const sheet = pending ? (
    <MealImpactSheet
      key={pending.recordId}
      source={source}
      recordId={pending.recordId}
      meal={pending.meal}
      onFinish={(shown) => {
        setPending(null)
        pending.onDone(shown)
      }}
      onLeave={() => setPending(null)}
    />
  ) : null

  return { show, sheet }
}

export { mealSummaryFromSavePayload } from './meal-impact-view'
export type { MealImpactMeal } from './meal-impact-view'
