import './perf-polyfill'
import { createElement, type PropsWithChildren } from 'react'
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

function App({ children }: PropsWithChildren<any>) {
  useLaunch((options) => {
    console.log('App launched.')
    resetPreviousCommunityFeedSession()
    cleanupGeneratedUserFiles().catch(() => { /* ignore startup cleanup errors */ })
    // 小程序码参数在 options.query.scene，不是 options.scene（后者是场景值数字）
    const rawScene = String((options as any)?.query?.scene || '')
    const decodedScene = (() => {
      try {
        return decodeURIComponent(rawScene)
      } catch {
        return rawScene
      }
    })()
    const params = new URLSearchParams(decodedScene)
    const inviteCodeFromScene = (params.get('fi') || '').trim()
    const inviteCodeFromQuery = String((options as any)?.query?.fi || '').trim()
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
  })

  // children 为当前页面；Provider 供全站主题与「我的」页切换
  return createElement(AppColorSchemeProvider, null, createElement(PrivacyAuthorizationModal), children)
}

export default App
