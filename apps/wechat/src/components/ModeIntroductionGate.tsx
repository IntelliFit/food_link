import Taro, { useDidShow } from '@tarojs/taro'
import { useCallback, useEffect, useRef, useState, type ComponentType, type PropsWithChildren } from 'react'
import { HOME_EXPERIENCE_MODE_EVENT } from '../utils/home-experience'
import { completeModeIntroduction, getModeIntroductionSession } from '../utils/mode-introduction'
import { ModeIntroduction } from './ModeIntroduction'

async function reopenCurrentPage() {
  const pages = Taro.getCurrentPages()
  const page = pages[pages.length - 1]
  if (!page?.route) throw new Error('Missing current page')
  const query = Object.entries(page.options || {}).map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`).join('&')
  await Taro.reLaunch({ url: `/${page.route.replace(/^\//, '')}${query ? `?${query}` : ''}` })
}

/** Resumes an interrupted first choice before mounting page guides or business content. */
export function ModeIntroductionGate({ children, onCompleted }: PropsWithChildren<{ onCompleted?: () => void }>) {
  const [session, setSession] = useState(getModeIntroductionSession)
  const sessionRef = useRef(session)
  sessionRef.current = session
  const notified = useRef(false)
  const reopening = useRef<{ userId: string; token: string } | null>(null)
  const sync = useCallback(() => {
    const next = getModeIntroductionSession()
    // Keep this page gated until a fresh native onLoad/onShow can mount its business hooks.
    if (reopening.current?.userId === next.userId && reopening.current?.token === next.token) return
    reopening.current = null
    setSession(previous => {
      const sameOwner = previous.userId === next.userId && previous.token === next.token
      // A hidden pending page also missed onLoad. Wait for its own onShow to reopen it.
      if (sameOwner && previous.required && !next.required) return previous
      return sameOwner && previous.required === next.required ? previous : next
    })
  }, [])
  useEffect(() => {
    Taro.eventCenter.on(HOME_EXPERIENCE_MODE_EVENT, sync)
    sync()
    return () => { Taro.eventCenter.off(HOME_EXPERIENCE_MODE_EVENT, sync) }
  }, [sync])
  useDidShow(() => {
    const next = getModeIntroductionSession(), previous = sessionRef.current
    if (!onCompleted && !reopening.current && previous.required && !next.required && previous.userId === next.userId && previous.token === next.token) {
      reopening.current = next
      void reopenCurrentPage().catch(() => {
        reopening.current = null
        Taro.showToast({ title: '页面未能打开，请重新确认', icon: 'none' })
      })
      return
    }
    sync()
  })
  useEffect(() => {
    if (!session.required && session.userId && session.token && onCompleted && !notified.current) {
      notified.current = true
      onCompleted()
    }
  }, [session, onCompleted])
  if (!session.required) return <>{children}</>
  return <ModeIntroduction key={`${session.userId}:${session.token}`} onConfirm={async mode => {
    reopening.current = session
    const saved = completeModeIntroduction(mode, session)
    if (!saved || onCompleted) {
      reopening.current = null
      if (saved) setSession(getModeIntroductionSession())
      else sync()
      return saved
    }
    try {
      await reopenCurrentPage()
      return true
    } catch {
      // Choice is durable; retain this gate so retry never late-mounts an uninitialised page.
      throw new Error('默认模式已保存，但页面未能打开，请点击确认重试。')
    }
  }}
  />
}

/** Bare deep-link pages need the same gate before their own effects can mount. */
export function withModeIntroduction<P extends object>(Page: ComponentType<P>) {
  return function IntroducedPage(props: P) { return <ModeIntroductionGate><Page {...props} /></ModeIntroductionGate> }
}
