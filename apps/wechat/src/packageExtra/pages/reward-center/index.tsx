import { View, Text } from '@tarojs/components'
import Taro, { useDidShow } from '@tarojs/taro'
import { useMemo, useState } from 'react'
import {
  getRewardCenter,
  type InviteRewardCenterSummary,
  type InviteRewardRecord,
  type RewardCenterResponse,
  type RewardCenterTask,
} from '../../../utils/api'
import {
  extraPkgUrl,
  SUBPACKAGE_ABOUT_ROOT,
  SUBPACKAGE_EXTRA_ROOT,
  SUBPACKAGE_STATS_METABOLIC_ROOT,
  SUBPACKAGE_USER_GROUP_ROOT,
} from '../../../utils/subpackage-extra'
import { useAppColorScheme } from '../../../components/AppColorSchemeContext'
import {
  getRewardLevelMeta,
  getRewardLevelProgress,
  formatRewardLevelRange,
} from '../../../utils/membership'

import './index.scss'

function RewardCenterPage() {
  const { scheme } = useAppColorScheme()
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState<RewardCenterResponse | null>(null)

  useDidShow(() => {
    loadData()
  })

  const loadData = async () => {
    setLoading(true)
    try {
      const next = await getRewardCenter()
      setData(next)
    } catch (error: any) {
      console.error('[reward-center] load failed:', error)
      Taro.showToast({ title: error?.message || '加载失败', icon: 'none' })
    } finally {
      setLoading(false)
    }
  }

  const handleTaskClick = (task: RewardCenterTask) => {
    if (!task.action_path || isTaskDisabled(task)) return
    const url = task.action_type === 'public_food_upload'
      ? extraPkgUrl('/pages/campus-food-share/index?task_mode=reward_center')
      : resolveRewardTaskUrl(task.action_path)
    Taro.navigateTo({
      url,
      fail: (error) => {
        console.error('[reward-center] navigate failed:', { url, error })
        Taro.showToast({ title: '页面跳转失败', icon: 'none' })
      },
    })
  }

  const quickTasks = (data?.tasks || []).filter(isTaskAvailable).slice(0, 2)
  const inviteReward = data?.invite_reward || null
  const showInviteReward = hasInviteReward(inviteReward)

  const balance = data?.earned_credits_balance ?? 0
  const levelMeta = useMemo(() => getRewardLevelMeta(balance), [balance])
  const levelProgress = useMemo(() => getRewardLevelProgress(balance, levelMeta), [balance, levelMeta])
  const levelRangeText = useMemo(() => formatRewardLevelRange(balance, levelMeta), [balance, levelMeta])

  return (
    <View className={`reward-center-page ${scheme === 'dark' ? 'reward-center-page--dark' : ''}`}>
      <View className='reward-hero'>
        <Text className='reward-hero__title'>奖励积分</Text>
        <View className='reward-hero__level'>
          <Text className='reward-hero__level-text'>{levelRangeText} · Lv{levelMeta.level} {levelMeta.title}</Text>
          <View className='reward-hero__segments'>
            {Array.from({ length: 10 }).map((_, i) => {
              const filledCount = Math.min(Math.max(Math.ceil(levelProgress / 10), 0), 10)
              return <View key={i} className={`reward-hero__seg ${i < filledCount ? 'reward-hero__seg--filled' : ''}`} />
            })}
          </View>
        </View>
        <View className='reward-hero__stats'>
          <View className='reward-stat'>
            <Text className='reward-stat__value'>{balance}</Text>
            <Text className='reward-stat__label'>当前余额</Text>
          </View>
          <View className='reward-stat'>
            <Text className='reward-stat__value'>{data?.today_earned_credits ?? 0}</Text>
            <Text className='reward-stat__label'>今日已获得</Text>
          </View>
        </View>
      </View>

      {!loading && quickTasks.length > 0 && (
        <View className='reward-quick-section'>
          <View className='reward-quick-section__head'>
            <Text className='reward-quick-section__title'>最快拿分</Text>
            <Text className='reward-quick-section__hint'>做完就能继续用奖励积分</Text>
          </View>
          <View className='reward-quick-list'>
            {quickTasks.map(task => (
              <View key={task.action_type} className='reward-quick-card' onClick={() => handleTaskClick(task)}>
                <View>
                  <Text className='reward-quick-card__name'>{formatTaskName(task)}</Text>
                  <Text className='reward-quick-card__desc'>
                    {formatTaskProgress(task)} · +{task.reward_amount} 积分
                  </Text>
                </View>
                <Text className='reward-quick-card__button'>去完成</Text>
              </View>
            ))}
          </View>
        </View>
      )}

      <View className='reward-section'>
        <Text className='reward-section__title'>
          今日进度 {data?.today_task_overview.completed_count ?? 0}/{data?.today_task_overview.total_count ?? 0}
        </Text>
        {loading ? (
          <View className='reward-loading'>
            <View className='reward-loading__spinner' />
          </View>
        ) : (
          <View className='reward-task-list'>
            {(data?.tasks || []).map(task => {
              const disabled = isTaskDisabled(task)
              const hasLimit = typeof task.daily_limit === 'number' && task.daily_limit > 0
              return (
                <View key={task.action_type} className='reward-task-card'>
                  <View className='reward-task-card__head'>
                    <View>
                      <Text className='reward-task-card__name'>{formatTaskName(task)}</Text>
                      <Text className='reward-task-card__reward'>完成一次 +{task.reward_amount} 奖励积分</Text>
                    </View>
                    <Text className='reward-task-card__status'>{task.status}</Text>
                  </View>
                  <View className='reward-task-card__meta'>
                    <Text>{hasLimit ? `今日进度 ${task.today_count}/${task.daily_limit}` : `今日已提交 ${task.today_count}`}</Text>
                    <Text>{hasLimit ? `每日上限 ${task.daily_limit}` : '不限次数，新商品才奖励'}</Text>
                  </View>
                  <View
                    className={`reward-task-card__button ${disabled ? 'reward-task-card__button--disabled' : ''}`}
                    onClick={() => handleTaskClick(task)}
                  >
                    {disabled ? '今日已满' : '去完成'}
                  </View>
                </View>
              )
            })}
          </View>
        )}
      </View>

      {!loading && showInviteReward && (
        <View className='reward-invite-section'>
          <View className='reward-invite-section__head'>
            <View>
              <Text className='reward-invite-section__title'>邀请奖励</Text>
              <Text className='reward-invite-section__hint'>邀请好友或完成受邀记录，双方各得 15 积分</Text>
            </View>
          </View>

          {inviteReward?.as_invitee_summary && (
            <View className='reward-invite-card reward-invite-card--invitee'>
              <View className='reward-invite-card__head'>
                <View>
                  <Text className='reward-invite-card__eyebrow'>我是被邀请人</Text>
                  <Text className='reward-invite-card__title'>
                    已记录 {inviteReward.as_invitee_summary.completed_days}/{inviteReward.as_invitee_summary.required_days} 个自然日
                  </Text>
                </View>
                <Text className='reward-invite-card__bonus'>+{inviteReward.as_invitee_summary.reward_credits} 积分</Text>
              </View>
              <View className='reward-invite-progress'>
                <View
                  className='reward-invite-progress__bar'
                  style={{ width: `${inviteeProgressPercent(inviteReward.as_invitee_summary.completed_days, inviteReward.as_invitee_summary.required_days)}%` }}
                />
              </View>
              <View className='reward-invite-days'>
                <Text className={`reward-invite-days__item ${(inviteReward.as_invitee_summary.completed_days ?? 0) >= 1 ? 'reward-invite-days__item--active' : ''}`}>
                  第 1 天{(inviteReward.as_invitee_summary.completed_days ?? 0) >= 1 ? ' ✓' : ''}
                </Text>
                <Text className={`reward-invite-days__item ${(inviteReward.as_invitee_summary.completed_days ?? 0) >= 2 ? 'reward-invite-days__item--active' : ''}`}>
                  第 2 天{(inviteReward.as_invitee_summary.completed_days ?? 0) >= 2 ? ' ✓' : ''}
                </Text>
              </View>
              <Text className='reward-invite-card__desc'>
                {inviteReward.as_invitee_summary.remaining_days > 0
                  ? `还差 ${inviteReward.as_invitee_summary.remaining_days} 个不同自然日，记满后你和邀请人各得 ${inviteReward.as_invitee_summary.reward_credits} 积分`
                  : `已满足 2 个不同自然日记录条件，奖励状态：${inviteReward.as_invitee_summary.record?.status_label || '已完成'}`}
              </Text>
              <Text className='reward-invite-card__note'>
                {inviteReward.as_invitee_summary.deadline_text || inviteReward.as_invitee_summary.next_action_text || '继续保持记录即可'}
              </Text>
            </View>
          )}

          {inviteReward?.as_inviter_summary && (
            <View className='reward-invite-card reward-invite-card--inviter'>
              <View className='reward-invite-card__head'>
                <View>
                  <Text className='reward-invite-card__eyebrow'>我是邀请人</Text>
                  <Text className='reward-invite-card__title'>成功完成 {inviteReward.as_inviter_summary.completed_count} 次邀请</Text>
                </View>
                <Text className='reward-invite-card__bonus'>预计 +{inviteReward.as_inviter_summary.estimated_credits} 积分</Text>
              </View>
              <View className='reward-invite-stats'>
                <View className='reward-invite-stat'>
                  <Text className='reward-invite-stat__value'>{inviteReward.as_inviter_summary.invited_count}</Text>
                  <Text className='reward-invite-stat__label'>已邀请</Text>
                </View>
                <View className='reward-invite-stat'>
                  <Text className='reward-invite-stat__value'>{inviteReward.as_inviter_summary.completed_count}</Text>
                  <Text className='reward-invite-stat__label'>已达标</Text>
                </View>
                <View className='reward-invite-stat'>
                  <Text className='reward-invite-stat__value'>{inviteReward.as_inviter_summary.estimated_credits}</Text>
                  <Text className='reward-invite-stat__label'>预计可得</Text>
                </View>
              </View>
              <Text className='reward-invite-card__desc'>
                已到账 {inviteReward.as_inviter_summary.earned_credits} 积分，仍有 {inviteReward.as_inviter_summary.pending_count} 位好友达标后可继续获得奖励。
              </Text>
              {Array.isArray(inviteReward.as_inviter_summary.records) && inviteReward.as_inviter_summary.records.length > 0 && (
                <View className='reward-invite-friend-list'>
                  {inviteReward.as_inviter_summary.records.map(record => (
                    <View className='reward-invite-friend' key={record.referral_id}>
                      <View className='reward-invite-friend__main'>
                        <Text className='reward-invite-friend__name'>{record.other_nickname || shortInviteID(record.other_user_id) || '好友'}</Text>
                        <Text className='reward-invite-friend__desc'>{record.requirement_text || record.next_action_text || '邀请奖励状态待确认'}</Text>
                      </View>
                      <Text className={`reward-invite-friend__status ${inviteStatusClass(record)}`}>
                        {record.status_label || record.status || '未知'}
                      </Text>
                    </View>
                  ))}
                </View>
              )}
            </View>
          )}
        </View>
      )}
    </View>
  )
}

const KNOWN_PACKAGE_ROOTS = [
  SUBPACKAGE_EXTRA_ROOT,
  SUBPACKAGE_ABOUT_ROOT,
  SUBPACKAGE_USER_GROUP_ROOT,
  SUBPACKAGE_STATS_METABOLIC_ROOT,
]

function resolveRewardTaskUrl(actionPath: string): string {
  const raw = String(actionPath || '').trim()
  if (!raw) return extraPkgUrl('/pages/reward-center/index')
  if (KNOWN_PACKAGE_ROOTS.some(root => raw.startsWith(`${root}/`))) {
    return raw
  }
  return extraPkgUrl(raw)
}

function isTaskDisabled(task: RewardCenterTask): boolean {
  return typeof task.daily_limit === 'number' && task.daily_limit > 0 && task.today_count >= task.daily_limit
}

function isTaskAvailable(task: RewardCenterTask): boolean {
  return !!task.action_path && !isTaskDisabled(task)
}

function formatTaskProgress(task: RewardCenterTask): string {
  if (typeof task.daily_limit === 'number' && task.daily_limit > 0) {
    return `今日 ${task.today_count}/${task.daily_limit}`
  }
  return `今日已提交 ${task.today_count}`
}

function formatTaskName(task: RewardCenterTask): string {
  if (task.action_type === 'public_food_upload') {
    return '上传公共食物/校园食堂菜品'
  }
  return task.name
}

function hasInviteReward(summary: InviteRewardCenterSummary | null): boolean {
  return Boolean(summary?.as_invitee_summary || summary?.as_inviter_summary)
}

function inviteeProgressPercent(completedDays: number, requiredDays: number): number {
  if (!requiredDays || requiredDays <= 0) return 0
  return Math.max(0, Math.min(100, Math.round((completedDays / requiredDays) * 100)))
}

function shortInviteID(value?: string | null): string {
  if (!value) return ''
  return value.length <= 8 ? value : `${value.slice(0, 4)}...${value.slice(-4)}`
}

function inviteStatusClass(record: InviteRewardRecord): string {
  if (record.status_label === '已过期') return 'reward-invite-friend__status--blocked'
  switch (record.status) {
    case 'reward_completed':
      return 'reward-invite-friend__status--completed'
    case 'reward_blocked':
    case 'cancelled':
      return 'reward-invite-friend__status--blocked'
    case 'reward_active':
      return 'reward-invite-friend__status--active'
    default:
      return 'reward-invite-friend__status--pending'
  }
}

export default RewardCenterPage
