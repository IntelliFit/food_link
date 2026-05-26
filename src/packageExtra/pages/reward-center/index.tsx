import { View, Text } from '@tarojs/components'
import Taro, { useDidShow } from '@tarojs/taro'
import { useState } from 'react'
import { getRewardCenter, type RewardCenterResponse, type RewardCenterTask } from '../../../utils/api'
import {
  extraPkgUrl,
  SUBPACKAGE_ABOUT_ROOT,
  SUBPACKAGE_EXTRA_ROOT,
  SUBPACKAGE_STATS_METABOLIC_ROOT,
  SUBPACKAGE_USER_GROUP_ROOT,
} from '../../../utils/subpackage-extra'
import { useAppColorScheme } from '../../../components/AppColorSchemeContext'

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
    const url = resolveRewardTaskUrl(task.action_path)
    Taro.navigateTo({
      url,
      fail: (error) => {
        console.error('[reward-center] navigate failed:', { url, error })
        Taro.showToast({ title: '页面跳转失败', icon: 'none' })
      },
    })
  }

  const quickTasks = (data?.tasks || []).filter(isTaskAvailable).slice(0, 2)

  return (
    <View className={`reward-center-page ${scheme === 'dark' ? 'reward-center-page--dark' : ''}`}>
      <View className='reward-hero'>
        <Text className='reward-hero__title'>奖励积分</Text>
        <Text className='reward-hero__subtitle'>把今天能拿的积分都集中看清楚</Text>
        <View className='reward-hero__stats'>
          <View className='reward-stat'>
            <Text className='reward-stat__value'>{data?.earned_credits_balance ?? 0}</Text>
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
                  <Text className='reward-quick-card__name'>{task.name}</Text>
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
                      <Text className='reward-task-card__name'>{task.name}</Text>
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

export default RewardCenterPage
