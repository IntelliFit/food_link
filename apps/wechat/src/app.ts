import './perf-polyfill'
import { installConsoleLogCapture } from './utils/console-log-buffer'

installConsoleLogCapture()

import { createElement, type PropsWithChildren, useEffect } from 'react'
import Taro, { useLaunch } from '@tarojs/taro'
import { getAccessToken, acceptFriendInvite } from './utils/api'
import { extraPkgUrl } from './utils/subpackage-extra'
import { AppColorSchemeProvider } from './components/AppColorSchemeContext'
import { PrivacyAuthorizationModal } from './components/PrivacyAuthorizationModal'
import { cleanupGeneratedUserFiles } from './utils/weapp-user-files'

import './app.scss'

// 不需要登录的页面白名单（与 getCurrentPageRoute 一致，含分包根路径）
const PUBLIC_PAGES = new Set([
  extraPkgUrl('/pages/login/index'),
  extraPkgUrl('/pages/agreement/index'),
  extraPkgUrl('/pages/privacy/index'),
  extraPkgUrl('/pages/about/index'),
])

const COMMUNITY_FEED_CACHE_KEYS = [
  'community_feed_cache',
  'community_feed_timestamp',
  'community_feed_cache_session_id_v1',
]
const COMMUNITY_FEED_SESSION_ID_KEY = 'community_feed_session_id_v1'

function resetPreviousCommunityFeedSession() {
  try {
    COMMUNITY_FEED_CACHE_KEYS.forEach((key) => Taro.removeStorageSync(key))
    Taro.setStorageSync(
      COMMUNITY_FEED_SESSION_ID_KEY,
      `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    )
  } catch {
    // ignore startup cache cleanup errors
  }
}

function handleInviteScene(options?: any) {
  // 小程序码参数在 options.query.scene，不是 options.scene（后者是场景值数字）
  const rawScene = String(options?.query?.scene || '')
  const decodedScene = (() => {
    try {
      return decodeURIComponent(rawScene)
    } catch {
      return rawScene
    }
  })()
  const params = new URLSearchParams(decodedScene)

  // pf=profile follow（个人主页分享扫码关注），与 fi=friend invite（好友邀请）独立
  const profileFollowCode = (params.get('pf') || '').trim()
  if (profileFollowCode) {
    try {
      Taro.setStorageSync('auto_follow', profileFollowCode)
    } catch {
      // ignore storage errors
    }
    Taro.navigateTo({
      url: `${extraPkgUrl('/pages/profile-settings/index')}?auto_follow=1`,
    })
    return
  }

  const inviteCodeFromScene = (params.get('fi') || '').trim()
  const inviteCodeFromQuery = String(options?.query?.fi || '').trim()
  const inviteCode = inviteCodeFromScene || inviteCodeFromQuery
  if (!inviteCode) return

  try {
    Taro.setStorageSync('pending_friend_invite_code', inviteCode)
  } catch {
    // ignore storage errors
  }

  if (getAccessToken()) {
    acceptFriendInvite(inviteCode).catch(() => { /* ignore */ })
    return
  }

  // 扫码未登录时先进入公开邀请页，用户可以先看到奖励规则，再决定登录/注册
  Taro.navigateTo({
    url: `${extraPkgUrl('/pages/invite-friends/index')}?invite_code=${encodeURIComponent(inviteCode)}`,
  })
}

function App({ children }: PropsWithChildren<any>) {
  useLaunch((options) => {
    console.log('App launched.')
    resetPreviousCommunityFeedSession()
    cleanupGeneratedUserFiles().catch(() => { /* ignore startup cleanup errors */ })
    handleInviteScene(options)
  })

  useEffect(() => {
    const onShow = (options: any) => {
      console.log('[app] onAppShow, options:', options)
      handleInviteScene(options)
    }
    Taro.onAppShow(onShow)
    return () => {
      Taro.offAppShow(onShow)
    }
  }, [])

  // children 为当前页面；Provider 供全站主题与「我的」页切换
  return createElement(AppColorSchemeProvider, null, createElement(PrivacyAuthorizationModal), children)
}

export default App
