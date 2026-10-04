import { act, render } from '@testing-library/react'
import Taro from '@tarojs/taro'
import PetAdventurePage from '../../src/packagePetStudio/pages/adventure/index'
import PetKitchenPage from '../../src/packagePetStudio/pages/kitchen/index'
import { getPetSummary } from '../../src/utils/api'
import { createAdventureProgress } from '../../src/utils/pet-adventure-progress'
import { newGrowthSave } from '../../src/utils/pet-growth'

jest.mock('../../src/utils/withAuth', () => ({ withAuth: (Component: any) => Component }))
jest.mock('../../src/utils/api', () => ({ getPetSummary: jest.fn() }))
let show: (() => void) | undefined
let storage: Map<string, unknown>

beforeEach(() => {
  jest.clearAllMocks(); show = undefined
  const current = newGrowthSave(); current.stars = 12
  storage = new Map<string, unknown>([
    ['user_id', 'test-user'],
    ['pet_adventure_progress_v1:test-user:pet', { ...createAdventureProgress(), starBalance: 45, xp: 85, inventory: ['plant'], settledRoundIds: ['old-round'] }],
    ['pet_growth_v2:test-user', current],
  ])
  ;(Taro.useDidShow as jest.Mock).mockImplementation(callback => { show = callback })
  ;(Taro.redirectTo as jest.Mock).mockResolvedValue(undefined)
  ;(Taro.getStorageSync as jest.Mock).mockImplementation(key => storage.get(key) || '')
  ;(Taro.setStorageSync as jest.Mock).mockImplementation((key, value) => storage.set(key, value))
})

test.each([
  ['adventure', PetAdventurePage, '正在打开伙伴冒险', '?game=adventure'],
  ['kitchen', PetKitchenPage, '正在打开伙伴时光', ''],
] as const)('the cached %s route redirects to the unified hub without reading or mutating either wallet', (game, Page, label, query) => {
  const before = [...storage.entries()].map(([key, value]) => [key, JSON.parse(JSON.stringify(value))])
  const { container } = render(<Page />)
  expect(container.querySelector(`[aria-label='${label}']`)).toBeInTheDocument()
  act(() => { show?.() })
  expect(Taro.redirectTo).toHaveBeenCalledTimes(1)
  expect(Taro.redirectTo).toHaveBeenCalledWith({ url: `/packagePetStudio/pages/index/index${query}` })
  act(() => { show?.() })
  expect(Taro.redirectTo).toHaveBeenCalledTimes(2)
  expect(Taro.getStorageSync).not.toHaveBeenCalled()
  expect(Taro.setStorageSync).not.toHaveBeenCalled()
  expect(Taro.removeStorageSync).not.toHaveBeenCalled()
  expect(getPetSummary).not.toHaveBeenCalled()
  expect([...storage.entries()]).toEqual(before)
  expect(container.querySelector('button')).not.toBeInTheDocument()
})

test('both cached paths remain registered in the pet subpackage for existing links', () => {
  const globals = globalThis as unknown as Record<string, unknown>
  const original = globals.defineAppConfig
  globals.defineAppConfig = (config: unknown) => config
  try {
    const config = jest.requireActual('../../src/app.config').default as { subpackages: { root: string; pages: string[] }[] }
    const petPackage = config.subpackages.find(item => item.root === 'packagePetStudio')
    expect(petPackage?.pages).toEqual(expect.arrayContaining(['pages/index/index', 'pages/adventure/index', 'pages/kitchen/index']))
  } finally {
    if (original === undefined) delete globals.defineAppConfig
    else globals.defineAppConfig = original
  }
})
