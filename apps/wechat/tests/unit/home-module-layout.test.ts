import Taro from '@tarojs/taro'
import { defaultHomeModuleLayout, homeModuleLocks, isHomeModuleVisible, isHomeQuickStatVisible, moveHomeModule, normalizeHomeModuleLayout, readHomeModuleLayout, saveHomeModuleLayout, toggleHomeQuickStat } from '../../src/pages/index/utils/home-module-layout'

describe('home module preferences', () => {
  it('repairs stored unknown/duplicate modules without hiding the core diet view', () => {
    const result = normalizeHomeModuleLayout({ order: ['meals', 'meals', 'old-module'], hidden: ['diet', 'expiry'] })
    expect(result.order[0]).toBe('meals')
    expect(new Set(result.order).size).toBe(defaultHomeModuleLayout().order.length)
    expect(result.hidden).toEqual(['expiry'])
    expect(result.quickStats).toEqual(['weight', 'water', 'sleep'])
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
    const storage = new Map<string, unknown>([['user_id', 'alice']])
    ;(Taro.getStorageSync as jest.Mock).mockImplementation(key => storage.get(key))
    ;(Taro.setStorageSync as jest.Mock).mockImplementation((key, value) => storage.set(key, value))
    saveHomeModuleLayout(normalizeHomeModuleLayout({ hidden: ['rewards'] }))
    storage.set('user_id', 'bob')
    expect(readHomeModuleLayout().hidden).toEqual(['supplements'])
    storage.set('user_id', 'alice')
    expect(readHomeModuleLayout().hidden).toEqual(['rewards'])
  })
  it('defaults to three quick cards and lets each metric be selected independently', () => {
    const defaults = defaultHomeModuleLayout()
    expect(defaults.quickStats).toEqual(['weight', 'water', 'sleep'])
    expect(isHomeQuickStatVisible(defaults, 'exercise')).toBe(false)
    const four = toggleHomeQuickStat(defaults, 'exercise', true)
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
    expect(normalizeHomeModuleLayout({ order: ['body', 'sleep'], hidden: [] }).quickStats).toEqual(['weight', 'water', 'sleep'])
    expect(normalizeHomeModuleLayout({}).quickStats).toEqual(defaultHomeModuleLayout().quickStats)
  })
})
