import {
  DEFAULT_HOME_MODULE_ORDER,
  getHomeModuleDragClientY,
  getHomeModuleLayoutStorageKey,
  moveVisibleHomeModule,
  moveVisibleHomeModuleBySteps,
  normalizeHomeModuleLayout,
  setHomeModuleVisibility,
} from '../../src/pages/index/utils/homeModuleLayout'

describe('home module layout', () => {
  it('repairs invalid stored values and appends newly available modules', () => {
    const result = normalizeHomeModuleLayout({
      order: ['meals', 'calories', 'meals', 'removed-module'],
      hidden: ['stats', 'removed-module', 'stats'],
    })

    expect(result.order.slice(0, 3)).toEqual(['meals', 'health', 'diet'])
    expect(result.order).toHaveLength(DEFAULT_HOME_MODULE_ORDER.length)
    expect(new Set(result.order).size).toBe(DEFAULT_HOME_MODULE_ORDER.length)
    expect(result.hidden).toEqual([])
  })

  it('moves only visible modules and keeps hidden modules available', () => {
    const hidden = setHomeModuleVisibility(normalizeHomeModuleLayout(null), 'rewards', false)
    const moved = moveVisibleHomeModule(hidden, 'meals', -1)

    expect(moved.hidden).toEqual(['supplements', 'expiry', 'rewards'])
    expect(moved.order.filter((id) => !moved.hidden.includes(id))).toEqual([
      'greeting',
      'calendar',
      'meals',
      'diet',
      'health',
    ])
    expect(setHomeModuleVisibility(moved, 'rewards', true).hidden).toEqual(['supplements', 'expiry'])

    const movedAcrossTwo = moveVisibleHomeModuleBySteps(moved, 'meals', -2)
    expect(movedAcrossTwo.order.filter((id) => !movedAcrossTwo.hidden.includes(id)).indexOf('meals')).toBe(0)
  })

  it('isolates guest and account storage keys', () => {
    expect(getHomeModuleLayoutStorageKey()).toBe('home_module_layout_v1_guest')
    expect(getHomeModuleLayoutStorageKey('user-8')).toBe('home_module_layout_v1_user-8')
  })

  it('reads drag coordinates from touch and devtools-compatible event shapes', () => {
    expect(getHomeModuleDragClientY({ touches: [{ clientY: 120 }] })).toBe(120)
    expect(getHomeModuleDragClientY({ changedTouches: [{ pageY: 96 }] })).toBe(96)
    expect(getHomeModuleDragClientY({ mpEvent: { touches: [{ y: 72 }] } })).toBe(72)
    expect(getHomeModuleDragClientY({ nativeEvent: { changedTouches: [{ clientY: 48 }] } })).toBe(48)
    expect(getHomeModuleDragClientY({ detail: { y: 24 } })).toBe(24)
    expect(getHomeModuleDragClientY({})).toBeNull()
  })
})
