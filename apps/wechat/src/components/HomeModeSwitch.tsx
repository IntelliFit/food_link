import { View, Text, type ITouchEvent } from '@tarojs/components'
import { useEffect, useRef } from 'react'
import { useBalancedTheme } from './BalancedThemeContext'
import { useAppColorScheme } from './AppColorSchemeContext'
import type { HomeExperienceMode } from '../utils/home-experience'
import './HomeModeSwitch.scss'

export function HomeModeSwitch({ mode, onChange, hidden = false }: {
  mode: HomeExperienceMode; onChange: (mode: HomeExperienceMode) => void; hidden?: boolean
}) {
  const { theme } = useBalancedTheme(), { scheme } = useAppColorScheme()
  const start = useRef<{ x: number; y: number }>()
  const ignoreGestureClick = useRef(false)
  useEffect(() => { if (hidden) { start.current = undefined; ignoreGestureClick.current = false } }, [hidden])
  if (hidden) return null
  const choose = (next: HomeExperienceMode) => { if (next !== mode) onChange(next) }
  const touchStart = (event: ITouchEvent) => {
    event.stopPropagation()
    ignoreGestureClick.current = event.touches.length !== 1
    const touch = event.touches[0]
    start.current = touch && !ignoreGestureClick.current ? { x: touch.clientX, y: touch.clientY } : undefined
  }
  const touchEnd = (event: ITouchEvent) => {
    event.stopPropagation()
    const touch = event.changedTouches[0], origin = start.current
    start.current = undefined
    if (!touch || !origin) return
    const dx = touch.clientX - origin.x, dy = touch.clientY - origin.y
    if (Math.abs(dx) >= 18 && Math.abs(dx) > Math.abs(dy) * 1.4) {
      // Native tap may arrive after a busy mode re-render. Keep this gesture
      // consumed until the next independent touch, rather than a short timer.
      ignoreGestureClick.current = true
      choose(dx > 0 ? 'wellness' : 'balanced')
    } else if (Math.abs(dy) >= 18) ignoreGestureClick.current = true
  }
  const style = mode === 'wellness' ? 'ink-wellness' : theme
  return <View
    id='home-mode-toggle'
    className={`home-mode-float home-mode-float--${style}${scheme === 'dark' && mode !== 'wellness' ? ' is-dark' : ''}`}
    role='group'
    aria-label='饮食模式'
    catchMove
    onClick={event => event.stopPropagation()}
    onTouchStart={touchStart}
    onTouchMove={event => event.stopPropagation()}
    onTouchEnd={touchEnd}
    onTouchCancel={event => { event.stopPropagation(); start.current = undefined; ignoreGestureClick.current = true }}
  >
    <View className={`home-mode-float__track${mode === 'wellness' ? ' is-wellness' : ''}`}>
      <View className='home-mode-float__thumb' aria-hidden />
      {(['balanced', 'wellness'] as const).map(value => <View
        key={value}
        id={`home-mode-${value}`}
        className={`home-mode-float__option${value === mode ? ' is-selected' : ''}`}
        role='button'
        aria-pressed={value === mode}
        aria-label={`${value === 'balanced' ? '均衡' : '养生'}模式${value === mode ? '，当前已选' : ''}`}
        onClick={event => { event.stopPropagation(); if (!ignoreGestureClick.current) choose(value) }}
      >
        <Text className='home-mode-float__symbol' aria-hidden>{value === 'balanced' ? '◉' : '☯'}</Text>
        <Text>{value === 'balanced' ? '均衡' : '养生'}</Text>
      </View>)}
    </View>
  </View>
}
