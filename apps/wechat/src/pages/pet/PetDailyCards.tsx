import { View, Text, Input } from '@tarojs/components'
import { useState } from 'react'
import { PetAvatar } from '../../components/PetAvatar'
import type { PetProfile, PetStatus } from '../../utils/api'
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

/** 第一行：等级经验 + 「我在意的」入口 */
export function PetLevelRow({ pet, focusText, onOpenFocus }: {
  pet?: PetProfile | null
  focusText: string
  onOpenFocus: () => void
}) {
  return (
    <View className='pet-tab-level'>
      <View className='pet-tab-level-main'>
        <Text className='pet-tab-level-badge'>Lv.{pet?.level || 1}</Text>
        <View className='pet-tab-exp-track'>
          <View className='pet-tab-exp-fill' style={{ width: `${pet?.level_progress ?? 0}%` }} />
        </View>
        <Text className='pet-tab-exp-text'>{pet?.level_exp ?? 0}/{pet?.next_level_exp || 100}</Text>
      </View>
      <View className='pet-tab-focus-entry' onClick={onOpenFocus}>
        <Text className='pet-tab-focus-entry-label'>我在意的</Text>
        <Text className='pet-tab-focus-entry-value'>{focusText}</Text>
        <Text className='iconfont icon-right pet-tab-focus-entry-arrow' />
      </View>
    </View>
  )
}

export function PetHero({ pet, status, mood, line, onOpenPet }: {
  pet?: PetProfile | null
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
        <Text className='pet-tab-hero-line'>{line}</Text>
        <Text className={`pet-tab-mood pet-tab-mood--${mood.key || 'calm'}`}>{mood.label}</Text>
      </View>
    </View>
  )
}

export function PetGapsCard({ gaps, mealsToday, mealLine, onPickMeal }: {
  gaps: PetDailyGapRow[]
  mealsToday: number
  mealLine: string
  onPickMeal: () => void
}) {
  return (
    <View className='pet-tab-card'>
      <View className='pet-tab-card-head'>
        <Text className='pet-tab-card-title'>今天还差</Text>
        <Text className='pet-tab-card-side'>已记 {mealsToday} 餐</Text>
      </View>
      {gaps.length ? gaps.map((row) => (
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
          <Text className='pet-tab-meal-btn-text'>让小麦挑一份</Text>
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
