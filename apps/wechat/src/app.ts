import './perf-polyfill'
import { flushRecentConsoleLogs, installConsoleLogCapture } from './utils/console-log-buffer'

installConsoleLogCapture()

import { createElement, type PropsWithChildren, useEffect } from 'react'
import Taro, { useLaunch } from '@tarojs/taro'
import { flushRecentRequestTraces, getAccessToken } from './utils/api'
import { extraPkgUrl } from './utils/subpackage-extra'
import { writePendingFriendInviteCode } from './utils/pending-friend-invite'
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

function handleDeepLink(options?: any) {
  const launchPath = String(options?.path || '').trim()
  const rawScene = String(options?.query?.scene || '').trim()
  let decodedScene = rawScene
  try {
    decodedScene = decodeURIComponent(rawScene)
  } catch {
    // 保留原始 scene，继续兼容未编码参数。
  }
  const sceneParams = new URLSearchParams(decodedScene)
  const target = String(options?.query?.target || sceneParams.get('target') || '').trim()
  const queryPath = String(options?.query?.path || sceneParams.get('path') || '').trim()
  const path = queryPath || launchPath
  const wantsRewardCenter = target === 'my-vouchers'
    || target === 'reward-center'
    || path.includes('my-vouchers')
    || path.includes('reward-center')
  const alreadyOnRewardCenter = launchPath.includes('reward-center')
  if (wantsRewardCenter && !alreadyOnRewardCenter) {
    Taro.navigateTo({
      url: extraPkgUrl('/pages/reward-center/index?section=rewards'),
      fail: (error) => {
        console.error('[app] deep link navigate failed:', error)
      },
    })
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

  const inviteCodeFromScene = (params.get('fi') || params.get('invite_code') || '').trim()
  const inviteCodeFromQuery = String(options?.query?.fi || options?.query?.invite_code || '').trim()
  const inviteCode = inviteCodeFromScene || inviteCodeFromQuery
  console.log('[invite-debug][app] 扫码邀请参数解析', {
    rawScene,
    decodedScene,
    inviteCodeFromScene,
    inviteCodeFromQuery,
    inviteCode,
    query: options?.query,
  })
  if (!inviteCode) return

  try {
    writePendingFriendInviteCode(inviteCode, 'app_scene')
    console.log('[invite-debug][app] 已写入 pending_friend_invite_code', inviteCode)
  } catch {
    // ignore storage errors
  }

  if (getAccessToken()) {
    // 已登录用户也进入邀请页确认，不在 App 启动阶段静默发送好友申请。
    // 新注册用户的好友申请会等头像昵称写入数据库后再触发。
    Taro.navigateTo({
      url: `${extraPkgUrl('/pages/invite-friends/index')}?invite_code=${encodeURIComponent(inviteCode)}`,
    })
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
    handleDeepLink(options)
  })

  useEffect(() => {
    const getCurrentRoute = () => {
      try {
        const pages = Taro.getCurrentPages()
        return String(pages[pages.length - 1]?.route || '')
      } catch {
        return ''
      }
    }
    const onShow = (options: any) => {
      console.log('[app] onAppShow, options:', options)
      handleInviteScene(options)
      handleDeepLink(options)
    }
    const onHide = () => {
      flushRecentRequestTraces()
      flushRecentConsoleLogs()
    }
    const onGlobalError = (error: unknown) => {
      console.error('[app-global-error]', {
        route: getCurrentRoute(),
        message: String(error || '').slice(0, 1200),
      })
    }
    const onUnhandledRejection = (event: { reason?: unknown }) => {
      const reason = event?.reason
      console.error('[app-unhandled-rejection]', {
        route: getCurrentRoute(),
        message: reason instanceof Error ? reason.message : String(reason || '').slice(0, 1200),
      })
    }
    const onMemoryWarning = (event: { level?: number }) => {
      console.warn('[app-memory-warning]', {
        route: getCurrentRoute(),
        level: event?.level,
      })
    }
    const taroAppEvents = Taro as any
    Taro.onAppShow(onShow)
    Taro.onAppHide(onHide)
    taroAppEvents.onError?.(onGlobalError)
    taroAppEvents.onUnhandledRejection?.(onUnhandledRejection)
    taroAppEvents.onMemoryWarning?.(onMemoryWarning)
    return () => {
      Taro.offAppShow(onShow)
      Taro.offAppHide(onHide)
      taroAppEvents.offError?.(onGlobalError)
      taroAppEvents.offUnhandledRejection?.(onUnhandledRejection)
      taroAppEvents.offMemoryWarning?.(onMemoryWarning)
    }
  }, [])

  // children 为当前页面；Provider 供全站主题与「我的」页切换
  return createElement(AppColorSchemeProvider, null, createElement(PrivacyAuthorizationModal), children)
}

export default App
