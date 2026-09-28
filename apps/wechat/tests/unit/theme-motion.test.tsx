import * as React from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import Taro, { useDidHide, useDidShow } from '@tarojs/taro'
import { THEME_MOTION_EVENT, THEME_MOTION_KEY, useThemeMotion } from '../../src/components/ThemeMotion'

const listeners = new Set<(enabled: boolean) => void>()
const shows = new Set<() => void>()
const hides = new Set<() => void>()
let stored: unknown
function Page({ name }: { name: string }) {
  const { active, enabled, setEnabled } = useThemeMotion()
  return <button onClick={() => setEnabled(!enabled)}>{name}:{enabled ? 'on' : 'off'}:{active ? 'running' : 'paused'}</button>
}
beforeEach(() => {
  stored = undefined; listeners.clear(); shows.clear(); hides.clear()
  ;(Taro.getStorageSync as jest.Mock).mockImplementation(key => key === THEME_MOTION_KEY ? stored : undefined)
  ;(Taro.setStorageSync as jest.Mock).mockImplementation((key, value) => { if (key === THEME_MOTION_KEY) stored = value })
  ;(Taro.eventCenter.on as jest.Mock).mockImplementation((event, fn) => { if (event === THEME_MOTION_EVENT) listeners.add(fn) })
  ;(Taro.eventCenter.off as jest.Mock).mockImplementation((_event, fn) => listeners.delete(fn))
  ;(Taro.eventCenter.trigger as jest.Mock).mockImplementation((event, value) => { if (event === THEME_MOTION_EVENT) listeners.forEach(fn => fn(value)) })
  ;(useDidShow as jest.Mock).mockImplementation(fn => React.useEffect(() => { shows.add(fn); return () => { shows.delete(fn) } }, [fn]))
  ;(useDidHide as jest.Mock).mockImplementation(fn => React.useEffect(() => { hides.add(fn); return () => { hides.delete(fn) } }, [fn]))
})

it('persists the static preference and synchronizes already mounted tabs', () => {
  const result = render(<><Page name='home' /><Page name='profile' /></>)
  fireEvent.click(screen.getByText('profile:on:running'))
  expect(screen.getByText('home:off:paused')).toBeInTheDocument()
  expect(stored).toBe(false)
  result.unmount()
  expect(listeners.size).toBe(0)
  render(<Page name='new-session' />)
  expect(screen.getByText('new-session:off:paused')).toBeInTheDocument()
})

it('pauses hidden pages and reconciles the preference before resuming', () => {
  render(<Page name='home' />)
  act(() => { [...hides].forEach(fn => fn()) })
  expect(screen.getByText('home:on:paused')).toBeInTheDocument()
  stored = false
  act(() => { [...shows].forEach(fn => fn()) })
  expect(screen.getByText('home:off:paused')).toBeInTheDocument()
  fireEvent.click(screen.getByText('home:off:paused'))
  expect(screen.getByText('home:on:running')).toBeInTheDocument()
})

it('keeps the current session usable when local storage is unavailable', () => {
  ;(Taro.setStorageSync as jest.Mock).mockImplementation(() => { throw new Error('storage unavailable') })
  render(<><Page name='home' /><Page name='profile' /></>)
  fireEvent.click(screen.getByText('profile:on:running'))
  expect(screen.getByText('home:off:paused')).toBeInTheDocument()
})
