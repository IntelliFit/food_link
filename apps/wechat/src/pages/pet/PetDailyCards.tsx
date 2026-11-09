import { View, Text, Input } from '@tarojs/components'
import { useState } from 'react'
import { PetAvatar } from '../../components/PetAvatar'
import type { PetProfile, PetStatus } from '../../utils/api'
import type { TodayRowView } from '../../utils/nutrition-state-view'
import type { PetDailyGapRow, PetDailyTask, PetDailyWeek, PetMood } from './pet-daily-api'
import { petTaskHint, petWeekTitle } from './pet-tools'

const TASK_ICONS: Record<string, string> = {
  vegetables: 'icon-a-144-lvye',
  fiber: 'icon-a-144-lvye',
  potassium: 'icon-a-144-lvye',
  protein: 'icon-egg',
  calcium: 'icon-drink',
  water: 'icon-drink',
  sodium: 'icon-huore',
  added_sugar: 'icon-lingshi',
  sat_fat: 'icon-huore',
  energy: 'icon-rice',
}

/** 宠物 + 名字和等级 + 今天的一句话 */
export function PetHero({ pet, name, status, mood, line, onOpenPet }: {
  pet?: PetProfile | null
  name: string
  status?: PetStatus | null
  mood: PetMood
  line: string
  onOpenPet?: () => void
}) {
  return (
    <View className='pet-tab-hero'>
      <View className='pet-tab-hero-avatar' onClick={onOpenPet}>
        <PetAvatar
          pet={pet}
          size={88}
          motion='companion'
          mood={status?.mood}
          state={status?.state}
          mealState={status?.meal_state}
        />
      </View>
      <View className='pet-tab-hero-copy'>
        <View className='pet-tab-hero-name-line'>
          <Text className='pet-tab-hero-name'>{name}</Text>
          {pet?.level ? <Text className='pet-tab-hero-level'>Lv.{pet.level}</Text> : null}
          {mood.label ? <Text className={`pet-tab-mood pet-tab-mood--${mood.key || 'calm'}`}>{mood.label}</Text> : null}
        </View>
        <Text className='pet-tab-hero-line'>{line}</Text>
      </View>
    </View>
  )
}

/** 「我在意的」一整行：左边名字，右边选了哪几项，点开是关注弹窗 */
export function PetFocusRow({ labels, onOpen }: { labels: string[]; onOpen: () => void }) {
  return (
    <View className='pet-tab-card pet-tab-focus-row' onClick={onOpen}>
      <Text className='pet-tab-focus-row-title'>我在意的</Text>
      <View className='pet-tab-focus-row-chips'>
        {labels.length ? labels.map((label) => (
          <Text key={label} className='pet-tab-focus-row-chip'>{label}</Text>
        )) : <Text className='pet-tab-focus-row-empty'>选 1–3 项，今天还差什么就按它排</Text>}
      </View>
      <Text className='iconfont icon-right pet-tab-focus-row-arrow' />
    </View>
  )
}

function DetailRow({ row }: { row: TodayRowView }) {
  if (!row.known) {
    return (
      <View className='pet-tab-gap'>
        <View className='pet-tab-gap-head'>
          <Text className='pet-tab-gap-label'>{row.label}</Text>
          <Text className='pet-tab-gap-text'>还不知道</Text>
        </View>
        {row.note ? <Text className='pet-tab-muted'>{row.note}</Text> : null}
      </View>
    )
  }
  const warn = row.tone === 'warn' || row.tone === 'over'
  return (
    <View className='pet-tab-gap'>
      <View className='pet-tab-gap-head'>
        <Text className='pet-tab-gap-label'>{row.label}{row.badge ? ` · ${row.badge}` : ''}</Text>
        <Text className={`pet-tab-gap-text ${warn ? 'is-warn' : ''}`}>
          {row.valueText} {row.targetText}{row.gapText ? ` · ${row.gapText}` : ''}
        </Text>
      </View>
      <View className='pet-tab-gap-track'>
        <View className={`pet-tab-gap-fill ${warn ? 'is-warn' : ''}`} style={{ width: `${row.percent}%` }} />
      </View>
      {row.note ? <Text className='pet-tab-muted'>{row.note}</Text> : null}
    </View>
  )
}

/** 今天还差：默认按关注排的前 3 行；「看全部」展开今天每一项营养素和计划 */
export function PetGapsCard({ gaps, mealsToday, mealLine, petName, details, detailsOpen, detailsLoading, planText, onToggleDetails, onPickMeal }: {
  gaps: PetDailyGapRow[]
  mealsToday: number
  mealLine: string
  petName: string
  details: TodayRowView[]
  detailsOpen: boolean
  detailsLoading: boolean
  planText: string
  onToggleDetails: () => void
  onPickMeal: () => void
}) {
  const showDetails = detailsOpen && details.length > 0
  return (
    <View className='pet-tab-card'>
      <View className='pet-tab-card-head'>
        <Text className='pet-tab-card-title'>今天还差</Text>
        <View className='pet-tab-card-side-wrap'>
          <Text className='pet-tab-card-side'>已记 {mealsToday} 餐</Text>
          {mealsToday > 0 ? (
            <View className='pet-tab-more' onClick={onToggleDetails}>
              {detailsLoading ? <View className='pet-tab-spinner' /> : <Text className='pet-tab-more-text'>{detailsOpen ? '收起' : '看全部'}</Text>}
            </View>
          ) : null}
        </View>
      </View>
      {showDetails ? (
        <>
          {planText ? <Text className='pet-tab-muted'>{planText}</Text> : null}
          {details.map((row) => <DetailRow key={row.key} row={row} />)}
        </>
      ) : gaps.length ? gaps.map((row) => (
        <View key={row.key} className='pet-tab-gap'>
          <View className='pet-tab-gap-head'>
            <Text className='pet-tab-gap-label'>{row.label}</Text>
            <Text className={`pet-tab-gap-text ${row.warn ? 'is-warn' : ''}`}>{row.text}</Text>
          </View>
          <View className='pet-tab-gap-track'>
            <View className={`pet-tab-gap-fill ${row.warn ? 'is-warn' : ''}`} style={{ width: `${row.percent}%` }} />
          </View>
        </View>
      )) : (
        <Text className='pet-tab-muted'>
          {mealsToday > 0 ? '目前都在范围里，下一餐照这样吃就好。' : '今天还没记录，记一餐我就知道还差什么。'}
        </Text>
      )}
      <View className='pet-tab-meal'>
        <Text className='pet-tab-meal-line'>{mealLine}</Text>
        <View className='pet-tab-meal-btn' onClick={onPickMeal}>
          <Text className='pet-tab-meal-btn-text'>让{petName}挑一份</Text>
        </View>
      </View>
    </View>
  )
}

export function PetTaskRow({ task, addingWater, onAction, onAddWater }: {
  task: PetDailyTask
  addingWater: boolean
  onAction: (task: PetDailyTask) => void
  onAddWater: () => void
}) {
  const showWater = task.kind === 'water' && !task.done
  return (
    <View
      className={`pet-tab-card pet-tab-task ${task.done ? 'is-done' : ''}`}
      onClick={task.done || showWater ? undefined : () => onAction(task)}
    >
      <View className='pet-tab-task-icon'>
        <Text className={`iconfont ${task.done ? 'icon-good' : TASK_ICONS[task.key] || 'icon-rice'}`} />
      </View>
      <View className='pet-tab-task-main'>
        <Text className='pet-tab-task-title'>今天的任务：{task.title}</Text>
        <Text className='pet-tab-task-hint'>{petTaskHint(task)}</Text>
      </View>
      {showWater ? (
        <View className={`pet-tab-water-btn ${addingWater ? 'is-busy' : ''}`} onClick={addingWater ? undefined : onAddWater}>
          {addingWater ? <View className='pet-tab-spinner' /> : <Text className='pet-tab-water-btn-text'>+1 杯</Text>}
        </View>
      ) : null}
    </View>
  )
}

export function PetWeekRow({ week, onOpen }: { week: PetDailyWeek; onOpen: () => void }) {
  const title = petWeekTitle(week)
  const sub = week.habits.length ? week.habits.join(' · ') : '多记几天，就能看出这周的规律'
  return (
    <View className='pet-tab-card pet-tab-week' onClick={onOpen}>
      <View className='pet-tab-week-main'>
        <View className='pet-tab-week-title'>
          <Text className='pet-tab-week-score'>{title.score}</Text>
          {title.delta ? <Text className={`pet-tab-week-delta ${title.better ? 'is-better' : ''}`}>{title.delta}</Text> : null}
        </View>
        <Text className='pet-tab-week-sub'>{sub}</Text>
      </View>
      <Text className='pet-tab-week-link'>完整分析</Text>
      <Text className='iconfont icon-right pet-tab-week-arrow' />
    </View>
  )
}

export function PetAskBar({ placeholder, onAsk }: { placeholder: string; onAsk: (question: string) => void }) {
  const [question, setQuestion] = useState('')
  const send = () => {
    onAsk(question)
    setQuestion('')
  }
  return (
    <View className='pet-tab-ask'>
      <Input
        className='pet-tab-ask-input'
        value={question}
        placeholder={placeholder}
        placeholderClass='pet-tab-ask-placeholder'
        confirmType='send'
        maxlength={200}
        onInput={(event) => setQuestion(event.detail.value)}
        onConfirm={send}
      />
      <View className='pet-tab-ask-send' onClick={send}>
        <Text className='iconfont icon-send pet-tab-ask-send-icon' />
      </View>
    </View>
  )
}

export function PetDailySkeleton() {
  return (
    <View className='pet-tab-skeleton'>
      <View className='pet-tab-skeleton-block pet-tab-skeleton-block--hero' />
      <View className='pet-tab-skeleton-block pet-tab-skeleton-block--tall' />
      <View className='pet-tab-skeleton-block' />
      <View className='pet-tab-skeleton-block' />
    </View>
  )
}
