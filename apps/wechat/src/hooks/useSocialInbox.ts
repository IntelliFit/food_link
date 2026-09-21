import { useCallback, useEffect, useRef, useState } from 'react'
import { useDidHide, useDidShow } from '@tarojs/taro'
import { getSocialInboxSnapshot, refreshSocialInbox, subscribeSocialInbox } from '../utils/social-inbox'

/** Only visible home/community pages check for messages; no background polling. */
export function useSocialInbox() {
  const [inbox, setInbox] = useState(getSocialInboxSnapshot)
  const active = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const cycle = useRef(0)
  const stop = useCallback(() => {
    active.current = false
    cycle.current += 1
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
  }, [])

  useEffect(() => subscribeSocialInbox(() => {
    if (active.current) setInbox(getSocialInboxSnapshot())
  }), [])

  useDidShow(() => {
    stop()
    active.current = true
    const currentCycle = cycle.current
    setInbox(getSocialInboxSnapshot())
    const check = async () => {
      await refreshSocialInbox(true)
      if (!active.current || cycle.current !== currentCycle) return
      setInbox(getSocialInboxSnapshot())
      timer.current = setTimeout(() => { void check() }, 60000)
    }
    timer.current = setTimeout(() => { void check() }, 300)
  })
  useDidHide(stop)
  useEffect(() => stop, [stop])
  return inbox
}
