import { View, Text, Image, Button } from '@tarojs/components'
import React, { useEffect, useMemo, useState } from 'react'
import Taro, { useRouter, useShareAppMessage, useShareTimeline } from '@tarojs/taro'
import {
  acceptFriendInvite,
  getAccessToken,
  getFriendInviteProfile,
  getFriendInviteProfileByCode,
  getUnlimitedQRCode,
  showUnifiedApiError,
  type FriendInviteProfile,
} from '../../../utils/api'
import { extraPkgUrl } from '../../../utils/subpackage-extra'
import { withAuth } from '../../../utils/withAuth'

import './index.scss'

function InviteFriendsPage() {
  const router = useRouter()
  const routeInviteCode = String(router.params?.invite_code || '').trim()
  const routeFromUserId = String(router.params?.from_user_id || '').trim()
  const currentUserId = String(Taro.getStorageSync('user_id') || '').trim()

  const [profile, setProfile] = useState<FriendInviteProfile | null>(null)
  const [inviteCode, setInviteCode] = useState(routeInviteCode)
  const [loading, setLoading] = useState(true)
  const [qrLoading, setQrLoading] = useState(false)
  const [qrCodeImage, setQrCodeImage] = useState('')
  const [accepting, setAccepting] = useState(false)

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
    ? `${inviterNickname}邀请你加入食探，达标后各得15积分`
    : '加入食探并完成2天打卡，双方各得15积分'

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
        }
      } catch (error) {
        if (!cancelled) {
          setInviteCode(routeInviteCode)
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

  useEffect(() => {
    if (!inviteCode || !isInviteOwner || !getAccessToken()) {
      setQrCodeImage('')
      return
    }

    let cancelled = false

    const loadQr = async () => {
      setQrLoading(true)
      const scene = `fi=${inviteCode}`
      const isDevelopmentEnv =
        typeof process !== 'undefined' && process?.env?.NODE_ENV === 'development'
      const envCandidates: Array<'develop' | 'trial' | 'release'> = isDevelopmentEnv
        ? ['develop', 'trial', 'release']
        : ['release', 'trial', 'develop']

      try {
        for (const envVersion of envCandidates) {
          try {
            const { base64 } = await getUnlimitedQRCode(scene, 'pages/index/index', envVersion)
            if (!cancelled) setQrCodeImage(base64)
            return
          } catch (error) {
            console.warn(`[invite-friends] qr load failed env=${envVersion}`, error)
          }
        }
      } finally {
        if (!cancelled) setQrLoading(false)
      }
    }

    void loadQr()
    return () => {
      cancelled = true
    }
  }, [inviteCode, isInviteOwner])

  const handleCopyInviteCode = async () => {
    if (!inviteCode) {
      Taro.showToast({ title: '邀请码暂不可用', icon: 'none' })
      return
    }
    await Taro.setClipboardData({ data: inviteCode })
    Taro.showToast({ title: '邀请码已复制', icon: 'success' })
  }

  const handlePreviewQr = () => {
    if (!qrCodeImage) return
    Taro.previewImage({ urls: [qrCodeImage], current: qrCodeImage })
  }

  const handleInviteAction = async () => {
    if (!inviteCode) {
      Taro.showToast({ title: '邀请码暂不可用', icon: 'none' })
      return
    }

    if (!getAccessToken()) {
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
      : '直接加好友并开始打卡'

  return (
    <View className='invite-page'>
      <View className='invite-hero'>
        <Text className='invite-eyebrow'>邀请有礼</Text>
        <Text className='invite-title'>
          {inviterNickname
            ? `${inviterNickname} 邀你加入食探`
            : isInviteOwner
              ? '把食探分享给新朋友'
              : '加入食探并开始健康打卡'}
        </Text>
        <Text className='invite-subtitle'>新用户 7 天内完成 2 个自然日有效记录，双方各得 15 积分，每月最多 10 人</Text>
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
                ? '通过小程序卡片或二维码邀请新朋友，不必先分享打卡海报'
                : '完成注册后继续记录饮食或运动，满足规则即可到账'}
            </Text>
          </View>
        </View>
        <View className='invite-code-chip' onClick={handleCopyInviteCode}>
          <Text className='invite-code-chip__label'>邀请码</Text>
          <Text className='invite-code-chip__value'>{inviteCode || '--'}</Text>
        </View>
      </View>

      <View className='invite-card rules-card'>
        <View className='rule-item'>
          <Text className='rule-item__index'>01</Text>
          <Text className='rule-item__text'>必须是从未注册过食探的新用户</Text>
        </View>
        <View className='rule-item'>
          <Text className='rule-item__index'>02</Text>
          <Text className='rule-item__text'>注册后 7 天内完成 2 个自然日饮食或运动记录</Text>
        </View>
        <View className='rule-item'>
          <Text className='rule-item__index'>03</Text>
          <Text className='rule-item__text'>达标后双方各得 15 积分，邀请人每月上限 10 人</Text>
        </View>
      </View>

      {isInviteOwner && (
        <View className='invite-card qr-card'>
          <View className='qr-card__head'>
            <Text className='qr-card__title'>扫码也能加入</Text>
            <Text className='qr-card__desc'>把这个二维码展示给朋友，或保存后发到群里</Text>
          </View>
          <View className='qr-box' onClick={handlePreviewQr}>
            {qrLoading ? (
              <View className='qr-box__loading' />
            ) : qrCodeImage ? (
              <Image className='qr-box__image' src={qrCodeImage} mode='aspectFit' />
            ) : (
              <Text className='qr-box__fallback'>二维码暂不可用</Text>
            )}
          </View>
        </View>
      )}

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
            {accepting ? '处理中...' : ctaText}
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

export default withAuth(InviteFriendsPage, { public: true })
