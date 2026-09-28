import { useCallback, useEffect, useRef, useState } from 'react'
import { useDidHide, useDidShow } from '@tarojs/taro'
import { getSocialInboxSnapshot, refreshSocialInbox, subscribeSocialInbox } from '../utils/social-inbox'

/** Poll only while the owning tab is visible. Concurrent callers share one request. */
export function useSocialInbox() {
  const [inbox, setInbox] = useState(getSocialInboxSnapshot)
  const active = useRef(false)
  const cycle = useRef(0)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const stop = useCallback(() => { active.current = false; cycle.current += 1; if (timer.current) clearTimeout(timer.current); timer.current = null }, [])
  useEffect(() => subscribeSocialInbox(() => { if (active.current) setInbox(getSocialInboxSnapshot()) }), [])
  useDidShow(() => {
    stop(); active.current = true
    const current = cycle.current
    setInbox(getSocialInboxSnapshot())
    const check = async () => {
      await refreshSocialInbox(true)
      if (!active.current || cycle.current !== current) return
      setInbox(getSocialInboxSnapshot())
      timer.current = setTimeout(() => { void check() }, 60000)
    }
    timer.current = setTimeout(() => { void check() }, 900)
  })
  useDidHide(stop)
  useEffect(() => stop, [stop])
  return inbox
}
