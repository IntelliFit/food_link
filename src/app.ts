import './perf-polyfill'
import { createElement, type PropsWithChildren } from 'react'
import Taro, { useLaunch } from '@tarojs/taro'
import { getAccessToken, acceptFriendInvite } from './utils/api'
import { extraPkgUrl } from './utils/subpackage-extra'
import { AppColorSchemeProvider } from './components/AppColorSchemeContext'

import './app.scss'

// 不需要登录的页面白名单（与 getCurrentPageRoute 一致，含分包根路径）
const PUBLIC_PAGES = new Set([
  extraPkgUrl('/pages/login/index'),
  extraPkgUrl('/pages/agreement/index'),
  extraPkgUrl('/pages/privacy/index'),
  extraPkgUrl('/pages/about/index'),
])

function App({ children }: PropsWithChildren<any>) {
  useLaunch((options) => {
    console.log('App launched.')
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
  return createElement(AppColorSchemeProvider, null, children)
}

export default App
