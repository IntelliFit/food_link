import './perf-polyfill'
import { PropsWithChildren } from 'react'
import Taro, { useLaunch } from '@tarojs/taro'
import { getAccessToken, acceptFriendInvite } from './utils/api'

import './app.scss'

// 不需要登录的页面白名单
const PUBLIC_PAGES = new Set([
  '/pages/login/index',
  '/pages/agreement/index',
  '/pages/privacy/index',
  '/pages/about/index',
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

    // 扫码未登录时先进入登录页，登录后会自动处理邀请码并建立好友关系
    Taro.navigateTo({
      url: `/pages/login/index?invite_code=${encodeURIComponent(inviteCode)}&redirect=${encodeURIComponent('/pages/community/index')}`
    })
  })

  // children 是将要会渲染的页面
  return children
}

export default App
