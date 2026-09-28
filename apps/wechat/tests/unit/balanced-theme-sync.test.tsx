import * as React from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import Taro, { useDidShow } from '@tarojs/taro'
import { BalancedThemeProvider, useBalancedTheme } from '../../src/components/BalancedThemeContext'
import { BALANCED_THEME_STORAGE_KEY } from '../../src/utils/balanced-theme'

const listeners = new Set<() => void>()
const pageShows = new Set<() => void>()
let stored = 'clarity-order'
function Page({ name }: { name: string }) {
  const { theme, setTheme } = useBalancedTheme()
  return <button onClick={() => setTheme('way-of-water')}>{name}:{theme}</button>
}
beforeEach(() => {
  listeners.clear(); pageShows.clear(); stored = 'clarity-order'
  ;(Taro.getStorageSync as jest.Mock).mockImplementation(key => key === BALANCED_THEME_STORAGE_KEY ? stored : undefined)
  ;(Taro.setStorageSync as jest.Mock).mockImplementation((key, value) => { if (key === BALANCED_THEME_STORAGE_KEY) stored = value })
  ;(Taro.eventCenter.on as jest.Mock).mockImplementation((_event, fn) => listeners.add(fn))
  ;(Taro.eventCenter.off as jest.Mock).mockImplementation((_event, fn) => listeners.delete(fn))
  ;(Taro.eventCenter.trigger as jest.Mock).mockImplementation(() => { listeners.forEach(fn => fn()) })
  ;(useDidShow as jest.Mock).mockImplementation(callback => React.useEffect(() => {
    pageShows.add(callback)
    return () => { pageShows.delete(callback) }
  }, [callback]))
})

it('synchronizes cached roots and fallback consumers after selecting a theme', () => {
  const { unmount } = render(<><BalancedThemeProvider><Page name='我的' /></BalancedThemeProvider><BalancedThemeProvider><Page name='圈子' /></BalancedThemeProvider><Page name='边界页面' /></>)
  fireEvent.click(screen.getByText('我的:clarity-order'))
  expect(screen.getByText('圈子:way-of-water')).toBeInTheDocument()
  expect(screen.getByText('边界页面:way-of-water')).toBeInTheDocument()
  unmount()
  expect(listeners.size).toBe(0)
})

it('reconciles the current stored theme when a hidden tab returns', () => {
  render(<BalancedThemeProvider><Page name='圈子' /></BalancedThemeProvider>)
  stored = 'eastern-salon'
  act(() => { [...pageShows].forEach(fn => fn()) })
  expect(screen.getByText('圈子:eastern-salon')).toBeInTheDocument()
})
