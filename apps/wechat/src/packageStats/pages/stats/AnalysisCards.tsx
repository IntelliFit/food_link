import { Text, View } from '@tarojs/components'
import type { FocusPillTone, StatsRange } from './analysis-view'

// 完整分析页的卡片（样式在本页 index.scss，组件不自己引样式）

const RANGE_OPTIONS: Array<{ key: StatsRange; label: string }> = [
  { key: 'week', label: '近一周' },
  { key: 'month', label: '近一个月' },
]

/** 近一周 | 近一个月 */
export function RangeSegment({ range, disabled, onChange }: {
  range: StatsRange
  disabled: boolean
  onChange: (next: StatsRange) => void
}) {
  return (
    <View className={`sa-seg ${disabled ? 'is-disabled' : ''}`}>
      {RANGE_OPTIONS.map(option => (
        <View
          key={option.key}
          className={`sa-seg__item ${range === option.key ? 'is-on' : ''}`}
          aria-role='button'
          aria-label={`${option.label}${range === option.key ? '，已选中' : ''}`}
          onClick={() => onChange(option.key)}
        >
          <Text>{option.label}</Text>
        </View>
      ))}
    </View>
  )
}

/** 深绿总评卡：综合分、比上周、一句话原因 */
export function SummaryCard({ label, score, delta, reason, note }: {
  label: string
  score: number
  delta: string
  reason: string
  note: string
}) {
  return (
    <View className='sa-brief'>
      <Text className='sa-brief__day'>{label}</Text>
      <View className='sa-score'>
        <Text className='sa-score__value'>{score}</Text>
        <Text className='sa-score__unit'>/ 100 饮食综合分</Text>
        {delta ? <View className='sa-chip-gold sa-score__chip'><Text>{delta}</Text></View> : null}
      </View>
      {reason ? <Text className='sa-brief__line sa-brief__line--reason'>{reason}</Text> : null}
      {note ? <Text className='sa-brief__note'>{note}</Text> : null}
    </View>
  )
}

/** 记录不到 2 天：说清还差几天，最近 7 天哪几天记了 */
export function GateSummaryCard({ label, headline, dots, note }: {
  label: string
  headline: string
  dots: boolean[]
  note: string
}) {
  return (
    <View className='sa-brief'>
      <Text className='sa-brief__day'>{label}</Text>
      <Text className='sa-brief__line'>{headline}</Text>
      <View className='sa-mini-dots' aria-hidden>
        {dots.map((hit, index) => <View key={index} className={`sa-mini-dots__dot ${hit ? 'is-hit' : ''}`} />)}
      </View>
      <Text className='sa-brief__note'>{note}</Text>
    </View>
  )
}

export type FocusRowView = {
  key: string
  title: string
  reason: string
  /** 分数或「—」 */
  scoreText: string
  tone: FocusPillTone
  /** 自定义关注的「支持参考」等 */
  badge: string
  refreshing: boolean
}

/** 我在意的：只显示，改在伙伴页 */
export function FocusScoresCard({ rows, emptyText, onOpen, onEdit }: {
  rows: FocusRowView[]
  emptyText: string
  onOpen: (key: string) => void
  onEdit: () => void
}) {
  return (
    <View className='sa-card'>
      <View className='sa-card__title'>
        <Text className='sa-card__name'>我在意的</Text>
        <Text className='sa-card__link' aria-role='button' onClick={onEdit}>在伙伴页改 ›</Text>
      </View>
      {rows.length === 0 ? <Text className='sa-card__empty'>{emptyText}</Text> : rows.map(row => (
        <View
          key={row.key}
          className='sa-frow'
          aria-role='button'
          aria-label={`查看${row.title}的依据`}
          onClick={() => onOpen(row.key)}
        >
          <View className='sa-frow__text'>
            <View className='sa-frow__name-line'>
              <Text className='sa-frow__name'>{row.title}</Text>
              {row.badge ? <Text className='sa-frow__badge'>{row.badge}</Text> : null}
              {row.refreshing ? <Text className='iconfont icon-jiazaixiao sa-frow__spinner' /> : null}
            </View>
            {row.reason ? <Text className='sa-frow__reason'>{row.reason}</Text> : null}
          </View>
          <View className={`sa-pill is-${row.tone}`}><Text>{row.scoreText}</Text></View>
        </View>
      ))}
    </View>
  )
}

/** 先改这两点：第一句加粗 */
export function FixFirstCard({ actions }: { actions: Array<{ lead: string; rest: string }> }) {
  return (
    <View className='sa-card'>
      <View className='sa-card__title'>
        <Text className='sa-card__name'>{actions.length > 1 ? '先改这两点' : '先改这一点'}</Text>
      </View>
      {actions.map((action, index) => (
        <View key={`${index}-${action.lead}`} className='sa-todo'>
          <View className='sa-todo__num'><Text>{index + 1}</Text></View>
          <Text className='sa-todo__text'>
            <Text className='sa-todo__lead'>{action.lead}</Text>
            {action.rest}
          </Text>
        </View>
      ))}
    </View>
  )
}
