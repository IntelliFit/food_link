import Taro from '@tarojs/taro'
import { HOME_MODULE_LAYOUT_PREFIX, defaultHomeModuleLayout, homeModuleLocks, isHomeModuleVisible, isHomeQuickStatVisible, markOrganizeHintSeen, moveHomeModule, normalizeHomeModuleLayout, readHomeModuleLayout, saveHomeModuleLayout, shouldShowOrganizeHint, toggleHomeQuickStat } from '../../src/pages/index/utils/home-module-layout'
import { HOME_ORGANIZE_GUIDE_STEP, HOME_RECORD_ONBOARDING_STEPS } from '../../src/pages/index/home-onboarding-steps'

function useStorage(initial: Array<[string, unknown]>): Map<string, unknown> {
  const storage = new Map<string, unknown>(initial)
  ;(Taro.getStorageSync as jest.Mock).mockImplementation(key => storage.get(key))
  ;(Taro.setStorageSync as jest.Mock).mockImplementation((key, value) => storage.set(key, value))
  return storage
}

const V4_DEFAULT_ORDER = ['diet', 'nextMeal', 'body', 'supplements', 'expiry', 'rewards', 'meals', 'recap']

describe('home module preferences', () => {
  it('puts the banner first, keeps related modules together and hides expiry by default', () => {
    const defaults = defaultHomeModuleLayout()
    expect(defaults.order).toEqual(['rewards', 'diet', 'nextMeal', 'body', 'supplements', 'meals', 'expiry', 'recap'])
    expect(defaults.hidden).toEqual(['supplements', 'expiry'])
    expect(isHomeModuleVisible(defaults, 'expiry')).toBe(false)
    expect(isHomeModuleVisible(defaults, 'expiry', homeModuleLocks(true))).toBe(true)
  })
  it('repairs stored unknown/duplicate modules without hiding the core diet view', () => {
    const result = normalizeHomeModuleLayout({ order: ['meals', 'meals', 'old-module'], hidden: ['diet', 'expiry'] })
    expect(result.order[0]).toBe('meals')
    expect(new Set(result.order).size).toBe(defaultHomeModuleLayout().order.length)
    expect(result.hidden).toEqual(['expiry'])
    expect(result.quickStats).toEqual(['weight', 'exercise', 'sleep'])
  })
  it('keeps expiry alerts visible while letting users hide optional supplements', () => {
    const layout = { ...defaultHomeModuleLayout(), hidden: ['supplements', 'expiry'] as const }
    const saved = normalizeHomeModuleLayout(layout)
    const locks = homeModuleLocks(true)
    expect(isHomeModuleVisible(saved, 'supplements', locks)).toBe(false)
    expect(isHomeModuleVisible(saved, 'expiry', locks)).toBe(true)
    expect(isHomeModuleVisible(saved, 'expiry', homeModuleLocks(false))).toBe(false)
    expect(saved.hidden).toEqual(['supplements', 'expiry'])
  })
  it('moves an item one position while keeping all hidden preferences', () => {
    const layout = normalizeHomeModuleLayout({ hidden: ['rewards'] })
    const moved = moveHomeModule(layout, 'meals', -1)
    expect(moved.order.indexOf('meals')).toBe(layout.order.indexOf('meals') - 1)
    expect(moved.hidden).toEqual(['rewards'])
    expect(layout.order).toEqual(defaultHomeModuleLayout().order)
  })
  it('separates preferences between users and guests', () => {
    const storage = useStorage([['user_id', 'alice']])
    saveHomeModuleLayout(normalizeHomeModuleLayout({ hidden: ['rewards'] }))
    storage.set('user_id', 'bob')
    expect(readHomeModuleLayout().hidden).toEqual(['supplements', 'expiry'])
    storage.set('user_id', 'alice')
    expect(readHomeModuleLayout().hidden).toEqual(['rewards'])
  })
  it('defaults to three quick cards and lets each metric be selected independently', () => {
    const defaults = defaultHomeModuleLayout()
    expect(defaults.quickStats).toEqual(['weight', 'exercise', 'sleep'])
    expect(isHomeQuickStatVisible(defaults, 'water')).toBe(false)
    const four = toggleHomeQuickStat(defaults, 'water', true)
    expect(four.quickStats).toEqual(['weight', 'water', 'exercise', 'sleep'])
    const sleepOnly = ['weight', 'water', 'exercise'].reduce(
      (layout, id) => toggleHomeQuickStat(layout, id as 'weight' | 'water' | 'exercise', false),
      four,
    )
    expect(sleepOnly.quickStats).toEqual(['sleep'])
    expect(isHomeModuleVisible(sleepOnly, 'body')).toBe(true)
    expect(isHomeModuleVisible(toggleHomeQuickStat(sleepOnly, 'sleep', false), 'body')).toBe(false)
  })
  it('preserves old body and sleep visibility choices during migration', () => {
    const sleepOnly = normalizeHomeModuleLayout({
      order: ['nextMeal', 'diet', 'supplements', 'rewards', 'meals', 'expiry', 'sleep', 'recap', 'body'],
      hidden: ['body'],
    })
    expect(sleepOnly.quickStats).toEqual(['sleep'])
    expect(sleepOnly.order).toEqual(['nextMeal', 'diet', 'supplements', 'rewards', 'meals', 'expiry', 'body', 'recap'])
    expect(normalizeHomeModuleLayout({ order: ['body', 'sleep'], hidden: ['sleep'] }).quickStats).toEqual(['weight', 'water', 'exercise'])
    expect(normalizeHomeModuleLayout({ order: ['body', 'sleep'], hidden: [] }).quickStats).toEqual(['weight', 'exercise', 'sleep'])
    expect(normalizeHomeModuleLayout({}).quickStats).toEqual(defaultHomeModuleLayout().quickStats)
  })
})

describe('putting every account back on the recommended layout once', () => {
  const custom = { order: ['meals', 'diet', 'nextMeal', 'body', 'supplements', 'expiry', 'rewards', 'recap'], hidden: ['recap'], quickStats: ['weight', 'water'], density: 'compact' }
  it.each(['v5', 'v4', 'v3', 'v2'])('replaces a %s layout, custom choices included, and drops the old key', (version) => {
    const oldKey = `home_module_layout_${version}:alice`
    const storage = useStorage([['user_id', 'alice'], [oldKey, version === 'v4' ? { ...custom, order: V4_DEFAULT_ORDER } : custom]])
    ;(Taro.removeStorageSync as jest.Mock).mockImplementation(key => storage.delete(key))
    const layout = readHomeModuleLayout()
    expect(layout).toEqual(defaultHomeModuleLayout())
    expect(storage.get(`${HOME_MODULE_LAYOUT_PREFIX}alice`)).toEqual(layout)
    expect(storage.has(oldKey)).toBe(false)
  })
  it('keeps what people choose after the reset', () => {
    useStorage([['user_id', 'alice'], [`${HOME_MODULE_LAYOUT_PREFIX}alice`, custom]])
    const layout = readHomeModuleLayout()
    expect(layout.order).toEqual(custom.order)
    expect(layout.hidden).toEqual(['recap'])
    expect(layout.density).toBe('compact')
  })
  it('still opens the home if old keys cannot be removed', () => {
    useStorage([['user_id', 'alice'], ['home_module_layout_v5:alice', custom]])
    ;(Taro.removeStorageSync as jest.Mock).mockImplementation(() => { throw new Error('storage busy') })
    expect(readHomeModuleLayout()).toEqual(defaultHomeModuleLayout())
  })
  it('starts accounts with nothing stored on the recommended layout', () => {
    useStorage([['user_id', 'alice']])
    expect(readHomeModuleLayout()).toEqual(defaultHomeModuleLayout())
  })
})

describe('telling people about 整理首页', () => {
  it('ends the home tour on the organize button', () => {
    expect(HOME_RECORD_ONBOARDING_STEPS[HOME_ORGANIZE_GUIDE_STEP].selector).toBe('#home-layout-edit')
    expect(HOME_ORGANIZE_GUIDE_STEP).toBe(HOME_RECORD_ONBOARDING_STEPS.length - 1)
  })
  it('shows the hint once per account', () => {
    const storage = useStorage([['user_id', 'alice']])
    expect(shouldShowOrganizeHint()).toBe(true)
    markOrganizeHintSeen()
    expect(shouldShowOrganizeHint()).toBe(false)
    storage.set('user_id', 'bob')
    expect(shouldShowOrganizeHint()).toBe(true)
  })
})
