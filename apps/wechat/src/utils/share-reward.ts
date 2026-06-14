import Taro from '@tarojs/taro'
import {
  claimSharePosterReward,
  type ClaimSharePosterRewardInput,
  type ClaimSharePosterRewardResponse,
} from './api'

export async function claimSharePosterRewardQuietly(
  input: string | ClaimSharePosterRewardInput
): Promise<ClaimSharePosterRewardResponse | null> {
  try {
    const reward = await claimSharePosterReward(input)
    if (reward.claimed && reward.credits > 0) {
      Taro.showToast({ title: `分享奖励 +${reward.credits} 积分`, icon: 'success' })
    } else if (reward.daily_cap_reached) {
      Taro.showToast({ title: '今日分享奖励已达上限', icon: 'none' })
    }
    return reward
  } catch (error) {
    console.warn('[share-reward] claim share reward failed', error)
    return null
  }
}
