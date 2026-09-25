import { Text, View } from '@tarojs/components'
import Taro, { useDidHide, useDidShow } from '@tarojs/taro'
import { useEffect, useRef, useState } from 'react'

const PREFERENCE = 'recap-music-preference-v1'

export function RecapMusic({ active }: { active: boolean }) {
  const [enabled, setEnabled] = useState(() => {
    try { return Taro.getStorageSync(PREFERENCE) !== 'off' } catch { return true }
  })
  const [visible, setVisible] = useState(true)
  const [playing, setPlaying] = useState(false)
  const [failed, setFailed] = useState(false)
  const context = useRef<Taro.InnerAudioContext | null>(null)
  const fade = useRef<ReturnType<typeof setInterval>>()
  const desired = useRef(false)
  desired.current = active && visible && enabled
  useDidHide(() => setVisible(false))
  useDidShow(() => setVisible(true))

  useEffect(() => {
    let alive = true
    try {
      const audio = Taro.createInnerAudioContext()
      context.current = audio
      audio.autoplay = false
      audio.loop = true
      audio.obeyMuteSwitch = true
      audio.volume = 0
      audio.src = '/packageRecap/assets/recap-v5/debussy-reverie.mp3'
      audio.onPlay(() => {
        if (!alive) return
        if (!desired.current) { audio.pause(); return }
        setPlaying(true); setFailed(false)
        clearInterval(fade.current)
        let tick = 0
        fade.current = setInterval(() => {
          audio.volume = Math.min(.18, ++tick * .018)
          if (tick >= 10) clearInterval(fade.current)
        }, 80)
      })
      audio.onPause(() => { if (alive) setPlaying(false) })
      audio.onError(() => {
        clearInterval(fade.current)
        if (alive) { setPlaying(false); setFailed(true) }
      })
    } catch { setFailed(true) }
    return () => {
      alive = false
      clearInterval(fade.current)
      context.current?.destroy()
      context.current = null
    }
  }, [])

  useEffect(() => {
    const audio = context.current
    if (!audio) return
    clearInterval(fade.current)
    if (active && visible && enabled) {
      audio.volume = 0
      audio.play()
    } else {
      audio.pause()
      audio.volume = 0
      setPlaying(false)
    }
  }, [active, visible, enabled])

  const toggle = () => {
    const next = failed || !enabled
    setEnabled(next)
    try { Taro.setStorageSync(PREFERENCE, next ? 'on' : 'off') } catch { /* Device preference is optional. */ }
    if (failed && next && active && visible) {
      desired.current = true
      context.current?.play()
    }
  }
  const showCredit = () => {
    void Taro.showModal({
      title: '梦幻曲 · 德彪西',
      content: '钢琴：Luis Kolodin（2020）。来源：IMSLP #805131。授权：CC BY-SA 4.0。此音频截取前90秒，压缩并淡入淡出，沿用相同授权。\nhttps://creativecommons.org/licenses/by-sa/4.0/',
      confirmText: '复制来源',
      cancelText: '关闭',
      success: result => {
        if (result.confirm) void Taro.setClipboardData({ data: 'https://imslp.org/wiki/Special:ReverseLookup/805131' })
      },
    })
  }
  return <View className={`recap-music${playing ? ' is-playing' : ''}`} role='button' aria-label={failed ? '重试播放周报轻音乐' : enabled ? '关闭周报轻音乐' : '开启周报轻音乐'} onClick={toggle} onLongPress={showCredit}>
    <Text>♫</Text>{!playing && <View className='recap-music__slash' />}
    {failed && <Text className='recap-music__hint'>点按播放</Text>}
  </View>
}
