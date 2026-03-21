import { PropsWithChildren } from 'react'
import { useLaunch } from '@tarojs/taro'
import Taro from '@tarojs/taro'
import { getAccessToken, acceptFriendInvite } from './utils/api'

import './app.scss'

function App({ children }: PropsWithChildren<any>) {
  useLaunch((options) => {
    console.log('App launched.')
    const rawScene = String(options?.scene || '')
    const decodedScene = (() => {
      try {
        return decodeURIComponent(rawScene)
      } catch {
        return rawScene
      }
    })()
    const params = new URLSearchParams(decodedScene)
    const inviteCode = (params.get('fi') || '').trim()
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
