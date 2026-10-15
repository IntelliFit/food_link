import { act, fireEvent, render, renderHook, screen } from '@testing-library/react'
import Taro, { useDidShow } from '@tarojs/taro'
import { useState } from 'react'
import { ProfileModeSwitch } from '../../src/components/ProfileModeSwitch'
import { useHomeExperienceMode } from '../../src/components/useHomeExperienceMode'
import { BALANCED_THEME_IDS, type BalancedThemeId } from '../../src/utils/balanced-theme'
import { HOME_EXPERIENCE_MODE_EVENT, type HomeExperienceMode } from '../../src/utils/home-experience'

let mockTheme: BalancedThemeId = 'clarity-order'
let mockScheme = 'light'
jest.mock('../../src/components/BalancedThemeContext', () => ({ useBalancedTheme: () => ({ theme: mockTheme }) }))
jest.mock('../../src/components/AppColorSchemeContext', () => ({ useAppColorScheme: () => ({ scheme: mockScheme }) }))

beforeEach(() => {
  jest.clearAllMocks()
  mockTheme = 'clarity-order'; mockScheme = 'light'
})

test.each(BALANCED_THEME_IDS)('%s keeps its own profile skin and selected balanced segment', theme => {
  mockTheme = theme
  const change = jest.fn()
  const { container, rerender } = render(<ProfileModeSwitch mode='balanced' onChange={change} />)
  expect(container.firstChild).toHaveClass(`profile-mode-switch--${theme}`)
  expect(screen.getByRole('button', { name: '均衡模式，当前已选' })).toHaveAttribute('aria-pressed', 'true')
  fireEvent.click(screen.getByRole('button', { name: '均衡模式，当前已选' }))
  expect(change).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '养生模式' }))
  expect(change).toHaveBeenCalledWith('wellness')
  rerender(<ProfileModeSwitch mode='wellness' onChange={change} />)
  expect(container.firstChild).toHaveClass('profile-mode-switch--ink-wellness')
  expect(container.querySelector('.profile-mode-switch__track')).toHaveClass('is-wellness')
  fireEvent.click(screen.getByRole('button', { name: '均衡模式' }))
  expect(change).toHaveBeenLastCalledWith('balanced')
  expect(mockTheme).toBe(theme)
})

test('dark skin applies only to balanced; dialogs remove the whole control', () => {
  mockScheme = 'dark'; mockTheme = 'way-of-water'
  const { container, rerender } = render(<ProfileModeSwitch mode='balanced' onChange={jest.fn()} />)
  expect(container.firstChild).toHaveClass('is-dark')
  rerender(<ProfileModeSwitch mode='wellness' onChange={jest.fn()} />)
  expect(container.firstChild).not.toHaveClass('is-dark')
  rerender(<ProfileModeSwitch mode='wellness' onChange={jest.fn()} hidden />)
  expect(screen.queryByRole('group', { name: '饮食模式' })).not.toBeInTheDocument()
})

test.each<[HomeExperienceMode, number, number, HomeExperienceMode]>([
  ['balanced', 0, 60, 'wellness'], ['wellness', 60, 0, 'balanced'],
])('horizontal swipe selects %s target once without a synthetic click or parent pet gesture', (mode, from, to, target) => {
  const change = jest.fn(), parent = jest.fn()
  render(<div onClick={parent} onTouchStart={parent} onTouchMove={parent} onTouchEnd={parent}><ProfileModeSwitch mode={mode} onChange={change} /></div>)
  const group = screen.getByRole('group', { name: '饮食模式' })
  fireEvent.touchStart(group, { touches: [{ clientX: from, clientY: 10 }] })
  fireEvent.touchMove(group, { touches: [{ clientX: to, clientY: 12 }] })
  fireEvent.touchEnd(group, { changedTouches: [{ clientX: to, clientY: 12 }] })
  fireEvent.click(screen.getByRole('button', { name: target === 'wellness' ? '养生模式' : '均衡模式' }))
  expect(change).toHaveBeenCalledTimes(1)
  expect(change).toHaveBeenCalledWith(target)
  expect(parent).not.toHaveBeenCalled()
})

test('vertical scrolling and cancelled touches never change modes', () => {
  const change = jest.fn()
  render(<ProfileModeSwitch mode='balanced' onChange={change} />)
  const group = screen.getByRole('group', { name: '饮食模式' })
  fireEvent.touchStart(group, { touches: [{ clientX: 10, clientY: 10 }] })
  fireEvent.touchEnd(group, { changedTouches: [{ clientX: 30, clientY: 80 }] })
  fireEvent.click(screen.getByRole('button', { name: '养生模式' }))
  expect(change).not.toHaveBeenCalled()
  fireEvent.touchStart(group, { touches: [{ clientX: 0, clientY: 10 }] })
  fireEvent.touchCancel(group)
  fireEvent.touchEnd(group, { changedTouches: [{ clientX: 70, clientY: 10 }] })
  expect(change).not.toHaveBeenCalled()
})

test('a delayed native tap cannot undo a swipe after the parent changes mode; the next touch works', () => {
  jest.useFakeTimers()
  const change = jest.fn()
  function Controlled() {
    const [mode, setMode] = useState<HomeExperienceMode>('balanced')
    return <ProfileModeSwitch mode={mode} onChange={next => { change(next); setMode(next) }} />
  }
  render(<Controlled />)
  const group = screen.getByRole('group', { name: '饮食模式' })
  fireEvent.touchStart(group, { touches: [{ clientX: 0, clientY: 10 }] })
  fireEvent.touchEnd(group, { changedTouches: [{ clientX: 70, clientY: 10 }] })
  act(() => jest.advanceTimersByTime(800))
  fireEvent.click(screen.getByRole('button', { name: '均衡模式' }))
  expect(change.mock.calls).toEqual([['wellness']])
  const balanced = screen.getByRole('button', { name: '均衡模式' })
  fireEvent.touchStart(balanced, { touches: [{ clientX: 20, clientY: 10 }] })
  fireEvent.touchEnd(balanced, { changedTouches: [{ clientX: 20, clientY: 10 }] })
  fireEvent.click(balanced)
  expect(change.mock.calls).toEqual([['wellness'], ['balanced']])
  jest.useRealTimers()
})

describe('shared mode synchronization', () => {
  let store: Record<string, unknown>
  let show: () => void
  const listeners = new Map<string, Set<() => void>>()
  beforeEach(() => {
    store = { user_id: 'user-1', 'home_experience_config_v2:user-1': { version: 2, mode: 'balanced' } }
    listeners.clear()
    ;(Taro.getStorageSync as jest.Mock).mockImplementation(key => store[key])
    ;(Taro.setStorageSync as jest.Mock).mockImplementation((key, value) => { store[key] = value })
    ;(Taro.eventCenter.on as jest.Mock).mockImplementation((name, callback) => {
      if (!listeners.has(name)) listeners.set(name, new Set())
      listeners.get(name)!.add(callback)
    })
    ;(Taro.eventCenter.off as jest.Mock).mockImplementation((name, callback) => listeners.get(name)?.delete(callback))
    ;(Taro.eventCenter.trigger as jest.Mock).mockImplementation(name => listeners.get(name)?.forEach(callback => callback()))
    ;(useDidShow as jest.Mock).mockImplementation(callback => { show = callback })
  })
  test('changes native tabbar immediately and synchronizes other mounted consumers; active choice is idempotent', () => {
    const tabbar = jest.fn()
    ;(Taro.getCurrentPages as jest.Mock).mockReturnValue([{ getTabBar: () => ({ setData: tabbar }) }])
    const first = renderHook(useHomeExperienceMode), second = renderHook(useHomeExperienceMode)
    act(() => { expect(first.result.current.changeMode('wellness')).toBe(true) })
    expect(second.result.current.mode).toBe('wellness')
    expect(store['home_experience_config_v2:user-1']).toEqual({ version: 2, mode: 'wellness' })
    expect(store.home_display_mode_v1).toBe('wellness')
    expect(tabbar).toHaveBeenLastCalledWith({ wellnessActive: true })
    ;(Taro.eventCenter.trigger as jest.Mock).mockClear()
    act(() => { expect(second.result.current.changeMode('wellness')).toBe(false) })
    expect(Taro.eventCenter.trigger).not.toHaveBeenCalled()
    first.unmount(); second.unmount()
    expect(listeners.get(HOME_EXPERIENCE_MODE_EVENT)?.size).toBe(0)
  })
  test('page show reads the current account and subsequent selection never writes the old account', () => {
    const { result } = renderHook(useHomeExperienceMode)
    store.user_id = 'user-2'; store['home_experience_config_v2:user-2'] = { version: 2, mode: 'wellness' }
    act(() => show())
    expect(result.current.mode).toBe('wellness')
    act(() => { result.current.changeMode('balanced') })
    expect(store['home_experience_config_v2:user-2']).toEqual({ version: 2, mode: 'balanced' })
    expect(store['home_experience_config_v2:user-1']).toEqual({ version: 2, mode: 'balanced' })
    expect(Taro.setStorageSync).not.toHaveBeenCalledWith('home_experience_config_v2:user-1', expect.anything())
  })
})
