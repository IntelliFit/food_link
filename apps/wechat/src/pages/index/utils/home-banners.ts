import { petDisplayName } from '../../../utils/pet-name'
import { CAFETERIA_HERO_BG_URL } from '../../../utils/static-asset-cdn-url'
import { extraPkgUrl } from '../../../utils/subpackage-extra'

export interface HomeBanner {
  key: string
  className: string
  kicker: string
  title: string
  desc: string
  actionText: string
  url: string
  bgImage?: string
  /** 底栏页面只能用 switchTab 打开。 */
  tab?: boolean
}

export interface HomeBannerInput {
  /** 用户自己的伙伴名字；没有就用默认名。 */
  petName?: string | null
  /** 今天还能赚的积分；不提示时传 null。 */
  rewardCredits: number | null
  rewardTaskText: string
}

/**
 * 首页轮播只放现在重点推的项目，2026-11 起：高校伙伴计划排第一，
 * 鹅腿鸭腿识别和食堂菜品共建已下线（页面还在，「我的」里照样能进）。
 */
export function buildHomeBanners({ petName, rewardCredits, rewardTaskText }: HomeBannerInput): HomeBanner[] {
  const rewardBanner: HomeBanner[] = rewardCredits != null && rewardCredits > 0 ? [{
    key: 'reward',
    className: 'home-reward-hint--reward',
    kicker: '今日可赚积分',
    title: `今天还可以赚 ${rewardCredits} 积分`,
    desc: rewardTaskText,
    actionText: '去赚',
    url: extraPkgUrl('/pages/reward-center/index'),
  }] : []
  return [
    {
      key: 'campus-partner',
      className: 'home-reward-hint--campus',
      kicker: '高校社团合作',
      title: '高校伙伴计划',
      desc: '和健身社团一起称食堂的饭，扫社团的码加入',
      actionText: '去加入',
      url: extraPkgUrl('/pages/campus-campaign/index'),
      bgImage: CAFETERIA_HERO_BG_URL,
    },
    {
      key: 'partner',
      className: 'home-reward-hint--partner',
      kicker: '新功能',
      title: '下一顿吃什么？',
      desc: `问问${petDisplayName(petName)}，按你今天吃的告诉你怎么补`,
      actionText: '去问问',
      url: '/pages/pet/index',
      tab: true,
    },
    {
      key: 'invite',
      className: 'home-reward-hint--invite',
      kicker: '邀请有礼',
      title: '邀请好友，一起得会员',
      desc: '好友有效使用 2 天，你得 7 天、好友得 3 天',
      actionText: '去邀请',
      url: extraPkgUrl('/pages/invite-friends/index'),
    },
    {
      key: 'food-map',
      className: 'home-reward-hint--food-map',
      kicker: '附近好吃的',
      title: '美食图谱',
      desc: '看看附近餐食的热量和营养',
      actionText: '去看看',
      url: extraPkgUrl('/pages/food-library/index'),
    },
    {
      key: 'research-weight',
      className: 'home-reward-hint--research',
      kicker: '科研共建',
      title: '称重科研计划',
      desc: '用食物秤称一顿饭，审核通过得积分',
      actionText: '去参加',
      url: extraPkgUrl('/pages/research-weight/index'),
    },
    {
      key: 'lifespan',
      className: 'home-reward-hint--lifespan',
      kicker: '寿命预测器 · 模拟估算，不用于诊断',
      title: '同一个你，三种吃法，三条人生',
      desc: '用你的饮食，算出活到各个年龄的概率',
      actionText: '去算算',
      url: '/packageLifespan/pages/predictor/index',
    },
    ...rewardBanner,
    {
      key: 'feedback',
      className: 'home-reward-hint--feedback',
      kicker: '帮助我们一起成长',
      title: '意见反馈',
      desc: '提交宝贵建议，最高可得 +5 积分',
      actionText: '去反馈',
      url: extraPkgUrl('/pages/feedback/index'),
    },
  ]
}
