import { View, Text } from '@tarojs/components'
import Taro, { useDidShow, useRouter } from '@tarojs/taro'
import { useEffect, useMemo, useState } from 'react'
import {
  getRewardCenter,
  getMyVouchers,
  useVoucher as activateReward,
  type RewardCenterResponse,
  type RewardCenterTask,
  type VoucherItem,
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
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState<RewardCenterResponse | null>(null)
  const [vouchers, setVouchers] = useState<VoucherItem[]>([])
  const [activatingRewardID, setActivatingRewardID] = useState('')

  useDidShow(() => {
    loadData()
  })

  useEffect(() => {
    if (loading || vouchers.length === 0 || router.params?.section !== 'rewards') return
    Taro.nextTick(() => {
      Taro.pageScrollTo({ selector: '.reward-available-section', duration: 250 })
    })
  }, [loading, router.params?.section, vouchers.length])

  const loadData = async () => {
    setLoading(true)
    const rewardCenterRequest = getRewardCenter()
    const availableRewardsRequest = getMyVouchers('pending')
    try {
      const next = await rewardCenterRequest
      setData(next)
    } catch (error: any) {
      console.error('[reward-center] task load failed:', error)
      Taro.showToast({ title: error?.message || '获取任务失败', icon: 'none' })
    }
    try {
      const rewardRes = await availableRewardsRequest
      // 邀请会员奖励有独立入口，不再混进“赚积分”。
      setVouchers((rewardRes.items || []).filter(item => item.voucher_type !== 'invite_light_week'))
    } catch (error) {
      // 可用奖励是附加能力，接口异常不能再把原有赚积分任务一起清空。
      console.error('[reward-center] available rewards load failed:', error)
      setVouchers([])
    }
    setLoading(false)
  }

  const handleActivateReward = async (reward: VoucherItem) => {
    if (reward.status !== 'pending' || activatingRewardID) return
    const confirmed = await Taro.showModal({
      title: '现在启用奖励？',
      content: '启用后奖励会立即到账。你也可以取消，留到以后再启用。',
      confirmText: '现在启用',
      cancelText: '以后再用',
      confirmColor: '#00bc7d',
    })
    if (!confirmed.confirm) return

    setActivatingRewardID(reward.id)
    try {
      await activateReward(reward.id)
      Taro.showToast({ title: '奖励已启用', icon: 'success' })
      await loadData()
    } catch (error: any) {
      console.error('[reward-center] activate reward failed:', error)
      Taro.showToast({ title: error?.message || '启用失败', icon: 'none' })
    } finally {
      setActivatingRewardID('')
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

      {!loading && vouchers.length > 0 && (
        <View className='reward-section reward-available-section'>
          <View className='reward-section__head'>
            <View>
              <Text className='reward-section__title'>可用奖励</Text>
              <Text className='reward-section__hint'>已获得的奖励可以留到需要时再启用</Text>
            </View>
          </View>
          <View className='reward-voucher-list'>
            {vouchers.map(voucher => {
              const activating = activatingRewardID === voucher.id
              return (
                <View key={voucher.id} className='reward-voucher-card'>
                  <View className='reward-voucher-card__main'>
                    <Text className='reward-voucher-card__title'>{voucher.title}</Text>
                    {voucher.description ? (
                      <Text className='reward-voucher-card__desc'>{voucher.description}</Text>
                    ) : null}
                    <Text className='reward-voucher-card__note'>{rewardActivationNote(voucher)}</Text>
                  </View>
                  <View
                    className={`reward-voucher-card__button ${activating ? 'reward-voucher-card__button--loading' : ''}`}
                    onClick={() => handleActivateReward(voucher)}
                  >
                    {activating ? <View className='reward-voucher-card__spinner' /> : <Text>现在启用</Text>}
                  </View>
                </View>
              )
            })}
          </View>
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

function rewardActivationNote(reward: VoucherItem): string {
  if (reward.voucher_type === 'registration_trial') {
    return '未启用前不会开始计算会员天数'
  }
  return '未启用前奖励不会计入当前余额'
}

export default RewardCenterPage
