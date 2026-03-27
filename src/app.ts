import { PropsWithChildren } from 'react'
import { useLaunch, useDidShow } from '@tarojs/taro'
import Taro from '@tarojs/taro'
import { getAccessToken, requestFriendByInviteCode } from './utils/api'

import './app.scss'

let lastInviteKey = ''
let lastInviteAt = 0

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value || '')
  } catch {
    return value || ''
  }
}

function parseInviteCode(raw: unknown): string {
  const source = String(raw || '').trim()
  if (!source) return ''

  const decoded = safeDecode(safeDecode(source)).trim()
  if (!decoded) return ''

  // 支持 fi=xxxx / a=1&fi=xxxx 两种格式
  if (decoded.includes('=')) {
    const params = new URLSearchParams(decoded)
    const fi = (params.get('fi') || '').trim()
    if (fi) return fi
  }

  // 兼容直接传 fi 值（6-12 位十六进制）
  if (/^[0-9a-f]{6,12}$/i.test(decoded)) return decoded.toLowerCase()
  return ''
}

function getInviteCodeFromOptions(options: any): string {
  const q = options?.query || {}

  // 小程序码 scene 参数会放在 query.scene；query.fi 作为兜底
  const fromQueryScene = parseInviteCode(q.scene)
  if (fromQueryScene) return fromQueryScene

  const fromQueryFi = parseInviteCode(q.fi)
  if (fromQueryFi) return fromQueryFi

  // options.scene 通常是数字场景值（如 1047），仅作为低优先兜底
  const fromScene = parseInviteCode(options?.scene)
  if (fromScene) return fromScene

  return ''
}

function App({ children }: PropsWithChildren<any>) {
  const handleInviteFromOptions = (options: any) => {
    const inviteCode = getInviteCodeFromOptions(options)
    if (!inviteCode) return
    const now = Date.now()
    if (lastInviteKey === inviteCode && now - lastInviteAt < 2000) return
    lastInviteKey = inviteCode
    lastInviteAt = now

    try {
      Taro.setStorageSync('pending_friend_invite_code', inviteCode)
    } catch {
      // ignore storage errors
    }

    if (getAccessToken()) {
      requestFriendByInviteCode(inviteCode).catch((e) => {
        console.error('[scan invite] auto request failed:', e)
      })
      return
    }

    // 扫码未登录时先进入登录页，登录后自动发起好友请求（需对方同意）
    const loginUrl = `/pages/login/index?invite_code=${encodeURIComponent(inviteCode)}`
    const pages = Taro.getCurrentPages()
    const currentRoute = pages.length > 0 ? `/${pages[pages.length - 1].route || ''}` : ''
    if (currentRoute === '/pages/login/index') return

    setTimeout(() => {
      Taro.navigateTo({ url: loginUrl }).catch(() => {
        Taro.redirectTo({ url: loginUrl }).catch(() => { /* ignore */ })
      })
    }, 80)
  }

  useLaunch((options) => {
    console.log('App launched.')
    handleInviteFromOptions(options)
  })

  useDidShow((options) => {
    handleInviteFromOptions(options)
  })

  // children 是将要会渲染的页面
  return children
}
  


export default App
