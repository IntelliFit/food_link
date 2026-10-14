import * as React from 'react'
import { act, render } from '@testing-library/react'
import Taro, { useDidShow } from '@tarojs/taro'
import { FlPageThemeRoot } from '../../src/components/FlPageThemeRoot'
import { BalancedThemeExperience } from '../../src/components/BalancedThemeExperience'
import { useInkWellness } from '../../src/components/InkWellness'
import { BALANCED_THEME_IDS, type BalancedThemeId } from '../../src/utils/balanced-theme'
import { HOME_EXPERIENCE_MODE_EVENT, saveHomeExperienceConfig } from '../../src/utils/home-experience'

let mockTheme: BalancedThemeId = 'clarity-order'
let mockScheme = 'light'
jest.mock('../../src/components/BalancedThemeContext', () => ({ useBalancedTheme: () => ({ theme: mockTheme }) }))
jest.mock('../../src/components/AppColorSchemeContext', () => ({ useAppColorSchemeOptional: () => ({ scheme: mockScheme }) }))
jest.mock('../../src/utils/theme-navigation-bar', () => ({ applyThemeNavigationBar: jest.fn() }))
jest.mock('../../src/utils/balanced-theme-scenes', () => ({ BALANCED_SCENES: { naturalPaper: '/paper.webp' }, loadBalancedScenes: jest.fn().mockResolvedValue(undefined), getBalancedScenesRevision: () => 0, subscribeBalancedScenes: () => () => {}, reportBalancedSceneImageError: jest.fn() }))

const listeners = new Map<string, Set<() => void>>()
const shows = new Set<() => void>()
let storage: Record<string, unknown>

function Content() {
  const wellness = useInkWellness()
  return <div data-mode={wellness ? 'wellness' : 'balanced'} />
}
function Pages() {
  return <>{(['home', 'stats', 'community', 'profile'] as const).map(surface =>
    <FlPageThemeRoot key={surface}><BalancedThemeExperience surface={surface}><Content /></BalancedThemeExperience></FlPageThemeRoot>
  )}</>
}
beforeEach(() => {
  mockScheme = 'light'
  listeners.clear(); shows.clear()
  storage = { user_id: 'account', 'home_experience_config_v2:account': { version: 2, mode: 'balanced' } }
  ;(Taro.getStorageSync as jest.Mock).mockImplementation(key => storage[key])
  ;(Taro.setStorageSync as jest.Mock).mockImplementation((key, value) => { storage[key] = value })
  ;(Taro.eventCenter.on as jest.Mock).mockImplementation((event, fn) => {
    if (!listeners.has(event)) listeners.set(event, new Set())
    listeners.get(event)!.add(fn)
  })
  ;(Taro.eventCenter.off as jest.Mock).mockImplementation((event, fn) => listeners.get(event)?.delete(fn))
  ;(Taro.eventCenter.trigger as jest.Mock).mockImplementation(event => listeners.get(event)?.forEach(fn => fn()))
  ;(useDidShow as jest.Mock).mockImplementation(fn => React.useEffect(() => { shows.add(fn); return () => { shows.delete(fn) } }, [fn]))
})

it('keeps ink paper isolated and restores the balanced dark shell on a same-page switch', () => {
  mockScheme = 'dark'
  const { container } = render(<Pages />)
  expect(container.querySelectorAll('.fl-d')).toHaveLength(4)
  act(() => { saveHomeExperienceConfig({ version: 2, mode: 'wellness' }) })
  expect(container.querySelectorAll('.fl-page-theme-root--wellness')).toHaveLength(4)
  expect(container.querySelector('.fl-d')).toBeNull()
  act(() => { saveHomeExperienceConfig({ version: 2, mode: 'balanced' }) })
  expect(container.querySelectorAll('.fl-d')).toHaveLength(4)
})

it.each(BALANCED_THEME_IDS)('%s removes balanced shells and scenes immediately on a visible-mode switch', theme => {
  mockTheme = theme
  const { container, unmount } = render(<Pages />)
  expect(container.querySelectorAll('.fl-page-theme-root--balanced')).toHaveLength(4)
  act(() => { saveHomeExperienceConfig({ version: 2, mode: 'wellness' }) })
  expect(container.querySelectorAll('.fl-page-theme-root--wellness')).toHaveLength(4)
  expect(container.querySelector('.fl-page-theme-root--balanced')).toBeNull()
  expect(container.querySelector(`[class*="fl-balanced-theme--"]`)).toBeNull()
  expect(container.querySelector('.bt-experience')).toBeNull()
  expect(container.querySelector('.natural-page-paper')).toBeNull()
  expect(container.querySelectorAll('[data-mode="wellness"]')).toHaveLength(4)
  act(() => { saveHomeExperienceConfig({ version: 2, mode: 'balanced' }) })
  expect(container.querySelectorAll(`.fl-balanced-theme--${theme}`)).toHaveLength(4)
  expect(container.querySelector('.fl-page-theme-root--wellness')).toBeNull()
  unmount()
  expect(listeners.get(HOME_EXPERIENCE_MODE_EVENT)?.size).toBe(0)
})

it('reconciles a hidden page or changed account without a mode event', () => {
  mockTheme = 'natural-symbiosis'
  const { container } = render(<Pages />)
  storage.user_id = 'another-account'
  storage['home_experience_config_v2:another-account'] = { version: 2, mode: 'wellness' }
  act(() => { [...shows].forEach(fn => fn()) })
  expect(container.querySelectorAll('.fl-page-theme-root--wellness')).toHaveLength(4)
  expect(container.querySelector('[class*="fl-balanced-theme--"]')).toBeNull()
  expect(container.querySelector('.natural-page-paper')).toBeNull()
})
