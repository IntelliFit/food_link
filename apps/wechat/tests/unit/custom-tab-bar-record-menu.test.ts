import { join } from 'path'

type TabBarDefinition = {
  data: Record<string, unknown>
  methods: Record<string, (...args: unknown[]) => unknown>
}

type TabBarInstance = Record<string, any> & {
  data: Record<string, unknown>
  setData: (patch: Record<string, unknown>) => void
}

const HOME_ROUTE = 'pages/index/index'
const CAMERA_PAGE = '/packageCamera/pages/shoot/index'

describe('custom tab bar camera button', () => {
  let storage: Record<string, unknown>
  let wxMock: {
    navigateTo: jest.Mock
    switchTab: jest.Mock
    showToast: jest.Mock
    setStorageSync: jest.Mock
    getStorageSync: jest.Mock
    removeStorageSync: jest.Mock
  }

  const loadTabBar = (): TabBarInstance => {
    let definition: TabBarDefinition | null = null
    ;(global as any).Component = (def: TabBarDefinition) => { definition = def }
    jest.isolateModules(() => {
      require(join(process.cwd(), 'custom-tab-bar/index.js'))
    })
    if (!definition) throw new Error('custom tab bar did not register a Component')
    const def = definition as TabBarDefinition
    const instance: TabBarInstance = {
      data: { ...def.data },
      setData(patch) {
        this.data = { ...this.data, ...patch }
      },
    }
    Object.entries(def.methods).forEach(([name, fn]) => {
      instance[name] = fn.bind(instance)
    })
    return instance
  }

  const tapCameraButton = (tabBar: TabBarInstance) => {
    tabBar.switchTab({ currentTarget: { dataset: { index: 2, path: '/pages/index/index', iscenter: true } } })
  }

  beforeEach(() => {
    storage = {}
    wxMock = {
      navigateTo: jest.fn(),
      switchTab: jest.fn(),
      showToast: jest.fn(),
      setStorageSync: jest.fn((key: string, value: unknown) => { storage[key] = value }),
      getStorageSync: jest.fn((key: string) => storage[key]),
      removeStorageSync: jest.fn((key: string) => { delete storage[key] }),
    }
    ;(global as any).wx = wxMock
    ;(global as any).getApp = () => ({})
    ;(global as any).getCurrentPages = () => [{ route: HOME_ROUTE }]
  })

  afterEach(() => {
    delete (global as any).Component
    delete (global as any).wx
    delete (global as any).getApp
    delete (global as any).getCurrentPages
  })

  it('starts a new camera session without carrying a stale home date', () => {
    storage.home_selected_date_v1 = '2026-11-06'
    const tabBar = loadTabBar()

    tapCameraButton(tabBar)

    expect(wxMock.navigateTo).toHaveBeenCalledTimes(1)
    expect(wxMock.navigateTo.mock.calls[0][0].url).toBe(CAMERA_PAGE)
    expect(wxMock.getStorageSync).not.toHaveBeenCalledWith('home_selected_date_v1')
    expect(wxMock.switchTab).not.toHaveBeenCalled()
    expect(storage.showRecordMenuModal).toBeUndefined()
    expect(tabBar.data.recordOpening).toBe(true)

    wxMock.navigateTo.mock.calls[0][0].complete()
    expect(tabBar.data.recordOpening).toBe(false)
  })

  it('leaves the date to the camera page when home has none or a broken one', () => {
    storage.home_selected_date_v1 = 'yesterday'
    const tabBar = loadTabBar()

    tapCameraButton(tabBar)

    expect(wxMock.navigateTo.mock.calls[0][0].url).toBe(CAMERA_PAGE)
  })

  it('ignores a second tap while the camera is opening and never reuses old photos', () => {
    storage.analyzeImagePaths = ['wxfile://old-meal.jpg']
    const tabBar = loadTabBar()

    tapCameraButton(tabBar)
    tapCameraButton(tabBar)

    expect(wxMock.navigateTo).toHaveBeenCalledTimes(1)
    expect(wxMock.navigateTo.mock.calls[0][0].url.startsWith(CAMERA_PAGE)).toBe(true)
  })

  it('tells the user when the camera page cannot open', () => {
    const tabBar = loadTabBar()

    tapCameraButton(tabBar)
    const call = wxMock.navigateTo.mock.calls[0][0]
    call.fail()
    call.complete()

    expect(wxMock.showToast).toHaveBeenCalledWith(expect.objectContaining({ title: '打开相机失败，请重试' }))
    expect(tabBar.data.recordOpening).toBe(false)
  })
})
