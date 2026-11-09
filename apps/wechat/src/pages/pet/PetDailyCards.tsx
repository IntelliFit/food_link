import { View, Text, Input } from '@tarojs/components'
import { useState } from 'react'
import { PetAvatar } from '../../components/PetAvatar'
import type { PetProfile, PetStatus } from '../../utils/api'
import type { TodayRowView } from '../../utils/nutrition-state-view'
import type { PetDailyGapRow, PetDailyTask } from './pet-daily-api'
import { petTaskHint } from './pet-tools'

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

function GapRow({ label, text, percent, warn }: { label: string; text: string; percent: number; warn: boolean }) {
  return (
    <View className='pet-brief__gap'>
      <View className='pet-brief__gap-line'>
        <Text className='pet-brief__gap-label'>{label}</Text>
        <Text className={`pet-brief__gap-value ${warn ? 'is-warn' : ''}`}>{text}</Text>
      </View>
      <View className='pet-brief__bar'>
        <View className={`pet-brief__bar-fill ${warn ? 'is-warn' : ''}`} style={{ width: `${Math.max(0, Math.min(100, percent))}%` }} />
      </View>
    </View>
  )
}

function DetailRow({ row }: { row: TodayRowView }) {
  if (!row.known) {
    return (
      <View className='pet-brief__gap'>
        <View className='pet-brief__gap-line'>
          <Text className='pet-brief__gap-label'>{row.label}</Text>
          <Text className='pet-brief__gap-value'>还不知道</Text>
        </View>
        {row.note ? <Text className='pet-brief__note'>{row.note}</Text> : null}
      </View>
    )
  }
  const warn = row.tone === 'warn' || row.tone === 'over'
  return (
    <>
      <GapRow
        label={row.badge ? `${row.label} · ${row.badge}` : row.label}
        text={`${row.valueText} ${row.targetText}${row.gapText ? ` · ${row.gapText}` : ''}`}
        percent={row.percent}
        warn={warn}
      />
      {row.note ? <Text className='pet-brief__note'>{row.note}</Text> : null}
    </>
  )
}

/** 「我在意的」唯一的改法：简报卡底下这一行，点它打开弹窗 */
function FocusLine({ labels, onOpen }: { labels: string[]; onOpen: () => void }) {
  return (
    <View className='pet-brief__focus' onClick={onOpen}>
      {labels.length ? (
        <>
          <Text className='pet-brief__focus-label'>按你在意的排</Text>
          {labels.map((label) => <Text key={label} className='pet-brief__focus-chip'>{label}</Text>)}
          <Text className='pet-brief__focus-edit'>改 ›</Text>
        </>
      ) : (
        <>
          <Text className='pet-brief__focus-label'>选 1–3 项你在意的，今天还差就按它排</Text>
          <Text className='pet-brief__focus-edit'>去选 ›</Text>
        </>
      )}
    </View>
  )
}

export type PetBriefToday = {
  gaps: PetDailyGapRow[]
  mealsToday: number
  focusLabels: string[]
  details: TodayRowView[]
  detailsOpen: boolean
  detailsLoading: boolean
  planText: string
}

/**
 * 第一眼：深绿简报卡（和首页 V3 一样）。宠物 + 今天一句话 + 今天还差；右上角是本周分数，
 * 点它进完整分析；底下一行是「我在意的」。今天还没记时不画空进度条，只给「拍第一餐」。
 */
export function PetBrief({ pet, status, name, dayLabel, weekChip, line, today, onOpenWeek, onOpenPet, onOpenFocus, onToggleDetails, onFirstMeal }: {
  pet?: PetProfile | null
  status?: PetStatus | null
  name: string
  dayLabel: string
  weekChip: string
  line: string
  today: PetBriefToday | null
  onOpenWeek: () => void
  onOpenPet?: () => void
  onOpenFocus: () => void
  onToggleDetails: () => void
  onFirstMeal: () => void
}) {
  const showDetails = Boolean(today?.detailsOpen && today.details.length)
  return (
    <View className='pet-brief'>
      <View className='pet-brief__top'>
        <Text className='pet-brief__day'>{dayLabel}</Text>
        {weekChip ? (
          <View className='pet-brief__chip' onClick={onOpenWeek}>
            <Text className='pet-brief__chip-text'>{weekChip} ›</Text>
          </View>
        ) : null}
      </View>
      <View className='pet-brief__main'>
        <View className='pet-brief__avatar' onClick={onOpenPet}>
          <PetAvatar pet={pet || {}} size={62} motion='companion' mood={status?.mood} state={status?.state} mealState={status?.meal_state} />
        </View>
        <View className='pet-brief__copy'>
          <Text className='pet-brief__name'>{pet?.level ? `${name} · Lv.${pet.level}` : name}</Text>
          <Text className='pet-brief__line'>{line}</Text>
        </View>
      </View>
      {today && today.mealsToday > 0 ? (
        <View className='pet-brief__panel'>
          <View className='pet-brief__panel-head'>
            <Text className='pet-brief__panel-title'>今天还差</Text>
            <View className='pet-brief__more' onClick={onToggleDetails}>
              {today.detailsLoading ? <View className='pet-tab-spinner pet-tab-spinner--light' /> : (
                <Text className='pet-brief__more-text'>已记 {today.mealsToday} 餐 · {today.detailsOpen ? '收起' : '看全部'} ›</Text>
              )}
            </View>
          </View>
          {showDetails ? (
            <>
              {today.planText ? <Text className='pet-brief__note'>{today.planText}</Text> : null}
              {today.details.map((row) => <DetailRow key={row.key} row={row} />)}
            </>
          ) : today.gaps.length ? today.gaps.map((row) => (
            <GapRow key={row.key} label={row.label} text={row.text} percent={row.percent} warn={row.warn} />
          )) : (
            <Text className='pet-brief__note'>目前都在范围里，下一餐照这样吃就好。</Text>
          )}
          <FocusLine labels={today.focusLabels} onOpen={onOpenFocus} />
        </View>
      ) : today ? (
        <View className='pet-brief__empty'>
          <View className='pet-brief__gold-btn' onClick={onFirstMeal}>
            <Text className='pet-brief__gold-btn-text'>拍第一餐</Text>
          </View>
          <FocusLine labels={today.focusLabels} onOpen={onOpenFocus} />
        </View>
      ) : null}
    </View>
  )
}

/** 第二眼：下一顿怎么补，整页唯一的大按钮 */
export function PetMealCard({ label, dish, note, buttonText, onPick }: {
  label: string
  dish: string
  note: string
  buttonText: string
  onPick: () => void
}) {
  return (
    <View className='pet-card pet-meal'>
      <Text className='pet-meal__label'>{label}</Text>
      <Text className='pet-meal__dish'>{dish}</Text>
      {note ? <Text className='pet-meal__note'>{note}</Text> : null}
      <View className='pet-meal__btn' onClick={onPick}>
        <Text className='pet-meal__btn-text'>{buttonText}</Text>
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
      className={`pet-card pet-task ${task.done ? 'is-done' : ''}`}
      onClick={task.done || showWater ? undefined : () => onAction(task)}
    >
      <View className='pet-task__icon'>
        <Text className={`iconfont ${task.done ? 'icon-good' : TASK_ICONS[task.key] || 'icon-rice'}`} />
      </View>
      <View className='pet-task__main'>
        <Text className='pet-task__title'>今天的任务：{task.title}</Text>
        <Text className='pet-task__hint'>{petTaskHint(task)}</Text>
      </View>
      {showWater ? (
        <View className={`pet-task__water ${addingWater ? 'is-busy' : ''}`} onClick={addingWater ? undefined : onAddWater}>
          {addingWater ? <View className='pet-tab-spinner' /> : <Text className='pet-task__water-text'>+1 杯</Text>}
        </View>
      ) : null}
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
    <View className='pet-ask'>
      <Input
        className='pet-ask__input'
        value={question}
        placeholder={placeholder}
        placeholderClass='pet-ask__placeholder'
        confirmType='send'
        maxlength={200}
        onInput={(event) => setQuestion(event.detail.value)}
        onConfirm={send}
      />
      <View className='pet-ask__send' onClick={send}>
        <Text className='iconfont icon-send pet-ask__send-icon' />
      </View>
    </View>
  )
}

/** 加载中：和成品一样的形状，不写「加载中」 */
export function PetDailySkeleton({ pet }: { pet?: PetProfile | null }) {
  return (
    <>
      <View className='pet-brief'>
        <View className='pet-brief__main'>
          <View className='pet-brief__avatar'>
            <PetAvatar pet={pet || {}} size={62} motion='companion' />
          </View>
          <View className='pet-brief__copy pet-skel-col'>
            <View className='pet-skel pet-skel--dark' style={{ width: '40%', height: '24rpx' }} />
            <View className='pet-skel pet-skel--dark' style={{ width: '90%', height: '36rpx' }} />
            <View className='pet-skel pet-skel--dark' style={{ width: '70%', height: '36rpx' }} />
          </View>
        </View>
        <View className='pet-brief__panel'>
          <View className='pet-skel pet-skel--dark' style={{ height: '24rpx' }} />
          <View className='pet-skel pet-skel--dark' style={{ height: '24rpx' }} />
          <View className='pet-skel pet-skel--dark' style={{ height: '24rpx' }} />
        </View>
      </View>
      <View className='pet-card pet-skel-col'>
        <View className='pet-skel' style={{ width: '30%', height: '24rpx' }} />
        <View className='pet-skel' style={{ width: '80%', height: '40rpx' }} />
        <View className='pet-skel' style={{ height: '88rpx', borderRadius: '44rpx' }} />
      </View>
    </>
  )
}
