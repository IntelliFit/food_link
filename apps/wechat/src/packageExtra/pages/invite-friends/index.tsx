import { View, Text, Image, Button } from '@tarojs/components'
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import Taro, { useRouter, useShareAppMessage, useShareTimeline } from '@tarojs/taro'
import {
  acceptFriendInvite,
  getAccessToken,
  getFriendInviteProfile,
  getFriendInviteProfileByCode,
  getMyVouchers,
  getRewardCenter,
  showUnifiedApiError,
  useVoucher as activateReward,
  type FriendInviteProfile,
  type InviteRewardCenterSummary,
  type InviteRewardRecord,
  type VoucherItem,
} from '../../../utils/api'
import { extraPkgUrl } from '../../../utils/subpackage-extra'
import { withAuth } from '../../../utils/withAuth'
import { writePendingFriendInviteCode } from '../../../utils/pending-friend-invite'

import './index.scss'

function InviteFriendsPage() {
  const router = useRouter()
  const routeInviteCode = String(router.params?.invite_code || '').trim()
  const routeFromUserId = String(router.params?.from_user_id || '').trim()
  const currentUserId = String(Taro.getStorageSync('user_id') || '').trim()

  const [profile, setProfile] = useState<FriendInviteProfile | null>(null)
  const [inviteCode, setInviteCode] = useState(routeInviteCode)
  const [loading, setLoading] = useState(true)
  const [accepting, setAccepting] = useState(false)
  const [rewardLoading, setRewardLoading] = useState(false)
  const [rewardSummary, setRewardSummary] = useState<InviteRewardCenterSummary | null>(null)
  const [membershipRewards, setMembershipRewards] = useState<VoucherItem[]>([])
  const [activatingRewardID, setActivatingRewardID] = useState('')

  const inviterUserId = profile?.user_id || routeFromUserId
  const inviterNickname = profile?.nickname || ''
  const inviterAvatar = profile?.avatar || ''
  const isInviteOwner = Boolean(currentUserId && inviterUserId && currentUserId === inviterUserId)

  const sharePath = useMemo(() => {
    const params: string[] = []
    if (inviterUserId) params.push(`from_user_id=${encodeURIComponent(inviterUserId)}`)
    if (inviteCode) params.push(`invite_code=${encodeURIComponent(inviteCode)}`)
    const query = params.length > 0 ? `?${params.join('&')}` : ''
    return `${extraPkgUrl('/pages/invite-friends/index')}${query}`
  }, [inviterUserId, inviteCode])

  const shareTitle = inviterNickname
    ? `${inviterNickname}邀请你加入食探：完成2天记录，你得3天会员`
    : '加入食探完成2天记录，你得3天会员，邀请人得7天'

  useShareAppMessage(() => ({
    title: shareTitle,
    path: sharePath,
  }))

  useShareTimeline(() => {
    const query: string[] = []
    if (inviterUserId) query.push(`from_user_id=${encodeURIComponent(inviterUserId)}`)
    if (inviteCode) query.push(`invite_code=${encodeURIComponent(inviteCode)}`)
    return {
      title: shareTitle,
      query: query.join('&'),
    }
  })

  useEffect(() => {
    if (!inviteCode) return
    try {
      writePendingFriendInviteCode(inviteCode, 'invite_page')
      console.log('[invite-debug][invite-page] 已写入 pending_friend_invite_code', {
        routeInviteCode,
        routeFromUserId,
        inviteCode,
        storedInviteCode: String(Taro.getStorageSync('pending_friend_invite_code') || ''),
      })
    } catch {
      // ignore storage errors
    }
  }, [inviteCode, routeFromUserId, routeInviteCode])

  useEffect(() => {
    let cancelled = false

    const loadProfile = async () => {
      setLoading(true)
      try {
        let nextProfile: FriendInviteProfile | null = null
        if (routeFromUserId) {
          nextProfile = await getFriendInviteProfile(routeFromUserId)
        } else if (currentUserId) {
          nextProfile = await getFriendInviteProfile(currentUserId)
        } else if (routeInviteCode) {
          nextProfile = await getFriendInviteProfileByCode(routeInviteCode)
        }

        if (!cancelled && nextProfile) {
          setProfile(nextProfile)
          setInviteCode(nextProfile.invite_code || routeInviteCode)
          console.log('[invite-debug][invite-page] 邀请资料加载完成', {
            routeInviteCode,
            routeFromUserId,
            nextInviteCode: nextProfile.invite_code || '',
            finalInviteCode: nextProfile.invite_code || routeInviteCode,
          })
        }
      } catch (error) {
        if (!cancelled) {
          setInviteCode(routeInviteCode)
          console.log('[invite-debug][invite-page] 邀请资料加载失败，使用路由邀请码', {
            routeInviteCode,
            routeFromUserId,
          })
          console.warn('[invite-friends] load profile failed', error)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void loadProfile()
    return () => {
      cancelled = true
    }
  }, [currentUserId, routeFromUserId, routeInviteCode])

  const loadInviteRewards = useCallback(async () => {
    if (!isInviteOwner || !getAccessToken()) {
      setRewardSummary(null)
      setMembershipRewards([])
      return
    }

    setRewardLoading(true)
    const progressRequest = getRewardCenter()
    const rewardsRequest = getMyVouchers('pending')
    try {
      const rewardCenter = await progressRequest
      setRewardSummary(rewardCenter.invite_reward || null)
    } catch (error) {
      console.error('[invite-friends] reward progress load failed', error)
      setRewardSummary(null)
    }
    try {
      const rewards = await rewardsRequest
      setMembershipRewards((rewards.items || []).filter(item => item.voucher_type === 'invite_light_week'))
    } catch (error) {
      console.error('[invite-friends] membership rewards load failed', error)
      setMembershipRewards([])
    }
    setRewardLoading(false)
  }, [isInviteOwner])

  useEffect(() => {
    void loadInviteRewards()
  }, [loadInviteRewards])

  useEffect(() => {
    if (rewardLoading || router.params?.section !== 'rewards') return
    Taro.nextTick(() => {
      Taro.pageScrollTo({ selector: '.invite-rewards-section', duration: 250 })
    })
  }, [rewardLoading, router.params?.section])

  const handleCopyInviteCode = async () => {
    if (!inviteCode) {
      Taro.showToast({ title: '邀请码暂不可用', icon: 'none' })
      return
    }
    await Taro.setClipboardData({ data: inviteCode })
    Taro.showToast({ title: '邀请码已复制', icon: 'success' })
  }

  const handleActivateMembershipReward = async (reward: VoucherItem) => {
    if (reward.status !== 'pending' || activatingRewardID) return
    const grantDays = membershipRewardDays(reward)
    const confirmed = await Taro.showModal({
      title: `现在启用 ${grantDays} 天会员？`,
      content: `确认后会立即开始 ${grantDays} 天轻度版会员。也可以先留着，等需要时再启用。`,
      confirmText: '现在启用',
      cancelText: '以后再用',
      confirmColor: '#10b981',
    })
    if (!confirmed.confirm) return

    setActivatingRewardID(reward.id)
    try {
      await activateReward(reward.id)
      Taro.showToast({ title: '会员奖励已启用', icon: 'success' })
      await loadInviteRewards()
    } catch (error) {
      await showUnifiedApiError(error, '启用会员奖励失败')
    } finally {
      setActivatingRewardID('')
    }
  }

  const handleInviteAction = async () => {
    if (!inviteCode) {
      Taro.showToast({ title: '邀请码暂不可用', icon: 'none' })
      return
    }

    if (!getAccessToken()) {
      console.log('[invite-debug][invite-page] 未登录，跳转登录并透传邀请码', {
        inviteCode,
        sharePath,
      })
      Taro.navigateTo({
        url: `${extraPkgUrl('/pages/login/index')}?invite_code=${encodeURIComponent(inviteCode)}&redirect=${encodeURIComponent(sharePath)}`,
      })
      return
    }

    if (isInviteOwner) {
      Taro.showToast({ title: '请把邀请页分享给新朋友', icon: 'none' })
      return
    }

    if (accepting) return
    setAccepting(true)
    try {
      const res = await acceptFriendInvite(inviteCode)
      Taro.showToast({
        title: res.status === 'request_sent' ? `已向${res.nickname || '对方'}发送申请` : '你们已是好友',
        icon: 'success',
      })
    } catch (error) {
      await showUnifiedApiError(error, '添加好友失败')
    } finally {
      setAccepting(false)
    }
  }

  const ctaText = !getAccessToken()
    ? '登录注册并领取邀请'
    : isInviteOwner
      ? '请转发给新朋友'
      : '直接加好友并开始使用'

  return (
    <View className='invite-page'>
      <View className='invite-hero'>
        <Text className='invite-eyebrow'>邀请好友得会员</Text>
        <Text className='invite-title'>
          {inviterNickname
            ? `${inviterNickname} 邀你加入食探`
            : isInviteOwner
              ? '邀请好友，一起得会员'
              : '加入食探并开始健康打卡'}
        </Text>
        <Text className='invite-subtitle'>新朋友注册后 7 天内完成 2 个不同自然日有效记录：邀请人得 7 天会员，新朋友得 3 天会员。</Text>
      </View>

      <View className='invite-benefits'>
        <View className='invite-benefit invite-benefit--owner'>
          <Text className='invite-benefit__eyebrow'>邀请人</Text>
          <Text className='invite-benefit__days'>7 天</Text>
          <Text className='invite-benefit__label'>轻度版会员</Text>
        </View>
        <View className='invite-benefit__arrow'>→</View>
        <View className='invite-benefit invite-benefit--friend'>
          <Text className='invite-benefit__eyebrow'>新朋友</Text>
          <Text className='invite-benefit__days'>3 天</Text>
          <Text className='invite-benefit__label'>轻度版会员</Text>
        </View>
      </View>

      <View className='invite-card inviter-card'>
        <View className='inviter-card__main'>
          {inviterAvatar ? (
            <Image className='inviter-avatar' src={inviterAvatar} mode='aspectFill' />
          ) : (
            <View className='inviter-avatar inviter-avatar--placeholder'>
              <Text className='inviter-avatar-text'>食</Text>
            </View>
          )}
          <View className='inviter-copy'>
            <Text className='inviter-name'>
              {inviterNickname || (isInviteOwner ? '我的邀请页' : '邀请你加入食探')}
            </Text>
            <Text className='inviter-desc'>
              {isInviteOwner
                ? '邀请码和分享链接都能绑定邀请关系'
                : '完成注册后继续记录饮食或运动，满足规则即可获得会员奖励'}
            </Text>
          </View>
        </View>
        <View className='invite-code-chip' onClick={handleCopyInviteCode}>
          <Text className='invite-code-chip__label'>邀请码</Text>
          <Text className='invite-code-chip__value'>{inviteCode || '--'}</Text>
        </View>
      </View>

      {isInviteOwner && (
        <View className='invite-card invite-rewards-section'>
          <View className='invite-section-head'>
            <View>
              <Text className='invite-section-title'>可启用的会员奖励</Text>
              <Text className='invite-section-desc'>奖励不会自动计时，等需要时再启用</Text>
            </View>
          </View>
          {rewardLoading ? (
            <View className='invite-section-loading'><View className='invite-spinner' /></View>
          ) : membershipRewards.length === 0 ? (
            <View className='invite-reward-empty'>达标后的 3 天或 7 天会员奖励会保存在这里</View>
          ) : (
            <View className='invite-reward-list'>
              {membershipRewards.map(reward => {
                const activating = activatingRewardID === reward.id
                return (
                  <View className='invite-reward-row' key={reward.id}>
                    <View className='invite-reward-row__main'>
                      <Text className='invite-reward-row__title'>{reward.title}</Text>
                      <Text className='invite-reward-row__desc'>{reward.description || '邀请达标会员奖励'}</Text>
                    </View>
                    <View
                      className={`invite-reward-row__button ${activating ? 'invite-reward-row__button--loading' : ''}`}
                      onClick={() => handleActivateMembershipReward(reward)}
                    >
                      {activating ? <View className='invite-reward-row__spinner' /> : <Text>现在启用</Text>}
                    </View>
                  </View>
                )
              })}
            </View>
          )}
        </View>
      )}

      {isInviteOwner && (
        <View className='invite-card invite-progress-card'>
          <View className='invite-section-head'>
            <View>
              <Text className='invite-section-title'>邀请进度</Text>
              <Text className='invite-section-desc'>好友必须在注册后 7 天内完成 2 个不同自然日有效记录</Text>
            </View>
          </View>

          {rewardLoading ? (
            <View className='invite-section-loading'><View className='invite-spinner' /></View>
          ) : (
            <>
              {rewardSummary?.as_inviter_summary && (
                <View className='invite-progress-block'>
                  <Text className='invite-progress-block__title'>我邀请的好友</Text>
                  <View className='invite-progress-stats'>
                    <View className='invite-progress-stat'>
                      <Text className='invite-progress-stat__value'>{rewardSummary.as_inviter_summary.invited_count}</Text>
                      <Text className='invite-progress-stat__label'>已邀请</Text>
                    </View>
                    <View className='invite-progress-stat'>
                      <Text className='invite-progress-stat__value'>{rewardSummary.as_inviter_summary.completed_count}</Text>
                      <Text className='invite-progress-stat__label'>已达标</Text>
                    </View>
                    <View className='invite-progress-stat'>
                      <Text className='invite-progress-stat__value'>{rewardSummary.as_inviter_summary.pending_count}</Text>
                      <Text className='invite-progress-stat__label'>待达标</Text>
                    </View>
                  </View>
                  {Array.isArray(rewardSummary.as_inviter_summary.records) && rewardSummary.as_inviter_summary.records.length > 0 && (
                    <View className='invite-friend-list'>
                      {rewardSummary.as_inviter_summary.records.map(record => (
                        <View className='invite-friend-row' key={record.referral_id}>
                          <View className='invite-friend-row__main'>
                            <Text className='invite-friend-row__name'>{record.other_nickname || shortInviteID(record.other_user_id) || '好友'}</Text>
                            <Text className='invite-friend-row__desc'>{record.requirement_text || record.next_action_text || '邀请进度待更新'}</Text>
                          </View>
                          <Text className={`invite-friend-row__status ${inviteStatusClass(record)}`}>
                            {record.status_label || record.status || '未知'}
                          </Text>
                        </View>
                      ))}
                    </View>
                  )}
                </View>
              )}

              {rewardSummary?.as_invitee_summary && (
                <View className='invite-progress-block invite-progress-block--invitee'>
                  <View className='invite-progress-block__head'>
                    <View>
                      <Text className='invite-progress-block__title'>我的受邀任务</Text>
                      <Text className='invite-progress-block__desc'>完成后获得 3 天轻度版会员</Text>
                    </View>
                    <Text className='invite-progress-block__count'>
                      {rewardSummary.as_invitee_summary.completed_days}/{rewardSummary.as_invitee_summary.required_days} 天
                    </Text>
                  </View>
                  <View className='invite-day-progress'>
                    <View
                      className='invite-day-progress__bar'
                      style={{ width: `${inviteProgressPercent(rewardSummary.as_invitee_summary.completed_days, rewardSummary.as_invitee_summary.required_days)}%` }}
                    />
                  </View>
                  <Text className='invite-progress-block__note'>
                    {rewardSummary.as_invitee_summary.deadline_text || rewardSummary.as_invitee_summary.next_action_text || '继续记录即可'}
                  </Text>
                </View>
              )}

              {!rewardSummary?.as_inviter_summary && !rewardSummary?.as_invitee_summary && (
                <View className='invite-progress-empty'>
                  <Text className='invite-progress-empty__title'>还没有邀请记录</Text>
                  <Text className='invite-progress-empty__desc'>把邀请码或邀请链接发给新朋友，注册后会自动出现在这里。</Text>
                </View>
              )}
            </>
          )}
        </View>
      )}

      <View className='invite-card rules-card'>
        <View className='rule-item'>
          <Text className='rule-item__index'>01</Text>
          <Text className='rule-item__text'>必须是从未注册过食探的新用户</Text>
        </View>
        <View className='rule-item'>
          <Text className='rule-item__index'>02</Text>
          <Text className='rule-item__text'>注册后 7 天内完成 2 个自然日任意功能使用</Text>
        </View>
        <View className='rule-item'>
          <Text className='rule-item__index'>03</Text>
          <Text className='rule-item__text'>达标后邀请人得 7 天、新朋友得 3 天；奖励可留到以后手动启用，邀请人每月最多奖励 10 位好友</Text>
        </View>
      </View>

      <View className='invite-actions'>
        {isInviteOwner ? (
          <>
            <Button className='invite-btn invite-btn--primary' openType='share'>
              立即转发邀请
            </Button>
            <Button className='invite-btn invite-btn--ghost' onClick={handleCopyInviteCode}>
              复制邀请码
            </Button>
          </>
        ) : (
          <Button className='invite-btn invite-btn--primary' onClick={handleInviteAction} disabled={accepting}>
            {accepting ? <View className='invite-btn__spinner' /> : ctaText}
          </Button>
        )}
      </View>

      {!loading && !inviterUserId && !inviteCode && (
        <View className='invite-empty'>
          <Text className='invite-empty__text'>当前还没有可用的邀请码</Text>
        </View>
      )}
    </View>
  )
}

function membershipRewardDays(reward: VoucherItem): number {
  const value = Number(reward.reward_payload?.grant_days)
  return Number.isFinite(value) && value > 0 ? value : 7
}

function inviteProgressPercent(completedDays: number, requiredDays: number): number {
  if (!requiredDays || requiredDays <= 0) return 0
  return Math.max(0, Math.min(100, Math.round((completedDays / requiredDays) * 100)))
}

function shortInviteID(value?: string | null): string {
  if (!value) return ''
  return value.length <= 8 ? value : `${value.slice(0, 4)}...${value.slice(-4)}`
}

function inviteStatusClass(record: InviteRewardRecord): string {
  if (record.status_label === '已过期') return 'invite-friend-row__status--blocked'
  switch (record.status) {
    case 'reward_completed':
      return 'invite-friend-row__status--completed'
    case 'reward_blocked':
    case 'cancelled':
      return 'invite-friend-row__status--blocked'
    case 'reward_active':
      return 'invite-friend-row__status--active'
    default:
      return 'invite-friend-row__status--pending'
  }
}

export default withAuth(InviteFriendsPage, { public: true })
