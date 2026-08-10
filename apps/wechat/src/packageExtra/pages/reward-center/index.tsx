import { View, Text } from '@tarojs/components'
import Taro, { useDidShow, useRouter } from '@tarojs/taro'
import { useEffect, useState } from 'react'
import {
  getRewardCenter,
  claimLoginCheckIn,
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
import './index.scss'

function RewardCenterPage() {
  const { scheme } = useAppColorScheme()
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState<RewardCenterResponse | null>(null)
  const [vouchers, setVouchers] = useState<VoucherItem[]>([])
  const [activatingRewardID, setActivatingRewardID] = useState('')
  const [checkingIn, setCheckingIn] = useState(false)

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

  const handleLoginCheckIn = async () => {
    if (checkingIn || data?.check_in?.claimed_today) return
    setCheckingIn(true)
    try {
      const result = await claimLoginCheckIn()
      Taro.showToast({ title: `签到成功，+${result.reward_amount}积分`, icon: 'success' })
      await loadData()
    } catch (error: any) {
      console.error('[reward-center] login check-in failed:', error)
      Taro.showToast({ title: error?.message || '签到失败，请稍后重试', icon: 'none' })
    } finally {
      setCheckingIn(false)
    }
  }

  const handleTaskClick = (task: RewardCenterTask) => {
    if (task.action_type === 'login_check_in') {
      if (!isTaskDisabled(task)) void handleLoginCheckIn()
      return
    }
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

  const rewardTasks = data?.tasks || []

  const balance = data?.earned_credits_balance ?? 0

  return (
    <View className={`reward-center-page ${scheme === 'dark' ? 'reward-center-page--dark' : ''}`}>
      <View className='reward-hero'>
        <Text className='iconfont icon-a-144-lvye reward-hero__art' />
        <Text className='reward-hero__title'>签到打卡赚积分</Text>
        <Text className='reward-hero__subtitle'>奖励积分长期保留，不会每日清零</Text>
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

      <View className='reward-quick-section'>
        <View className='reward-quick-section__head'>
          <View className='reward-quick-section__heading'>
            <View className='reward-quick-section__icon-wrap'>
              <Text className='iconfont icon-huore reward-quick-section__icon' />
            </View>
            <Text className='reward-quick-section__title'>最快拿分</Text>
          </View>
          {!loading && (
            <Text className='reward-quick-section__hint'>
              今日完成 {data?.today_task_overview.completed_count ?? 0}/{data?.today_task_overview.total_count ?? 0}
            </Text>
          )}
        </View>
        {loading ? (
          <View className='reward-quick-loading'>
            <View className='reward-quick-loading__spinner' />
          </View>
        ) : rewardTasks.length > 0 ? (
          <View className='reward-quick-list'>
            {rewardTasks.map(task => {
              const disabled = isTaskDisabled(task)
              return (
                <View
                  key={task.action_type}
                  className={`reward-quick-card ${disabled ? 'reward-quick-card--disabled' : ''}`}
                  onClick={() => handleTaskClick(task)}
                >
                  <View className='reward-quick-card__icon-wrap'>
                    <Text className={`iconfont ${getTaskIconClass(task)} reward-quick-card__icon`} />
                  </View>
                  <View className='reward-quick-card__main'>
                    <View className='reward-quick-card__title-row'>
                      <Text className='reward-quick-card__name'>{formatTaskName(task)}</Text>
                      <Text className='reward-quick-card__reward'>+{task.reward_amount}积分</Text>
                    </View>
                    {task.description ? <Text className='reward-quick-card__desc'>{task.description}</Text> : null}
                  </View>
                  <Text className={`reward-quick-card__button ${disabled ? 'reward-quick-card__button--disabled' : ''}`}>
                    {task.action_type === 'login_check_in'
                      ? (checkingIn ? '签到中' : (disabled ? '已签到' : '签到'))
                      : (disabled ? '今日已满' : '去完成')}
                  </Text>
                </View>
              )
            })}
          </View>
        ) : (
          <Text className='reward-quick-empty'>暂时没有可完成的任务</Text>
        )}

        <View className='reward-use-guide'>
          <View className='reward-use-guide__head'>
            <View className='reward-use-guide__heading'>
              <View className='reward-use-guide__heading-icon-wrap'>
                <Text className='iconfont icon-youhuiquan reward-use-guide__heading-icon' />
              </View>
              <Text className='reward-use-guide__title'>积分怎么用</Text>
            </View>
          </View>
          <View className='reward-use-guide__list'>
            <View className='reward-use-guide__item'>
              <View className='reward-use-guide__icon-wrap'>
                <Text className='iconfont icon-dumbbell reward-use-guide__icon' />
              </View>
              <View className='reward-use-guide__content'>
                <View className='reward-use-guide__label-row'>
                  <Text className='reward-use-guide__cost'>1积分</Text>
                  <Text className='reward-use-guide__name'>记录运动</Text>
                </View>
                <Text className='reward-use-guide__path'>主页 → 今日记录 → 运动</Text>
              </View>
            </View>
            <View className='reward-use-guide__item'>
              <View className='reward-use-guide__icon-wrap'>
                <Text className='iconfont icon-paizhao-xianxing reward-use-guide__icon' />
              </View>
              <View className='reward-use-guide__content'>
                <View className='reward-use-guide__label-row'>
                  <Text className='reward-use-guide__cost'>2积分</Text>
                  <Text className='reward-use-guide__name'>普通食物分析</Text>
                </View>
                <Text className='reward-use-guide__path'>主页拍照 → 选择普通模式</Text>
              </View>
            </View>
            <View className='reward-use-guide__item'>
              <View className='reward-use-guide__icon-wrap'>
                <Text className='iconfont icon-target reward-use-guide__icon' />
              </View>
              <View className='reward-use-guide__content'>
                <View className='reward-use-guide__label-row'>
                  <Text className='reward-use-guide__cost'>4积分</Text>
                  <Text className='reward-use-guide__name'>精准食物分析</Text>
                </View>
                <Text className='reward-use-guide__path'>主页拍照 → 选择精准模式</Text>
              </View>
            </View>
          </View>
        </View>
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

function formatTaskName(task: RewardCenterTask): string {
  if (task.action_type === 'public_food_upload') {
    return '上传公共食物/校园食堂菜品'
  }
  return task.name
}

function getTaskIconClass(task: RewardCenterTask): string {
  if (task.action_type === 'login_check_in') return 'icon-good'
  if (task.action_type === 'share_poster') return 'icon-share'
  if (task.action_type === 'packaged_food_upload') return 'icon-picture'
  if (task.action_type === 'public_food_upload') return 'icon-foodshop'
  return 'icon-good'
}

function rewardActivationNote(reward: VoucherItem): string {
  if (reward.voucher_type === 'registration_trial') {
    return '未启用前不会开始计算会员天数'
  }
  return '未启用前奖励不会计入当前余额'
}

export default RewardCenterPage
