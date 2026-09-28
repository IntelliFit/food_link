import Taro from '@tarojs/taro'
import { defaultHomeModuleLayout, homeModuleLocks, isHomeModuleVisible, moveHomeModule, normalizeHomeModuleLayout, readHomeModuleLayout, saveHomeModuleLayout } from '../../src/pages/index/utils/home-module-layout'

describe('home module preferences', () => {
  it('repairs stored unknown/duplicate modules without hiding the core diet view', () => {
    const result = normalizeHomeModuleLayout({ order: ['meals', 'meals', 'old-module'], hidden: ['diet', 'expiry'] })
    expect(result.order[0]).toBe('meals')
    expect(new Set(result.order).size).toBe(defaultHomeModuleLayout().order.length)
    expect(result.hidden).toEqual(['expiry'])
  })
  it('keeps urgent reminders visible without erasing the user preference', () => {
    const layout = { ...defaultHomeModuleLayout(), hidden: ['supplements', 'expiry'] as const }
    const saved = normalizeHomeModuleLayout(layout)
    const locks = homeModuleLocks(true, true)
    expect(isHomeModuleVisible(saved, 'supplements', locks)).toBe(true)
    expect(isHomeModuleVisible(saved, 'expiry', locks)).toBe(true)
    expect(isHomeModuleVisible(saved, 'expiry', homeModuleLocks(false, false))).toBe(false)
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
    expect(readHomeModuleLayout().hidden).toEqual([])
    storage.set('user_id', 'alice')
    expect(readHomeModuleLayout().hidden).toEqual(['rewards'])
  })
})
