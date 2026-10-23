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

describe('custom tab bar record button', () => {
  let storage: Record<string, unknown>
  let app: { eventCenter?: { callbacks: Record<string, () => void> } }
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

  const tapRecordButton = (tabBar: TabBarInstance) => {
    tabBar.switchTab({ currentTarget: { dataset: { index: 2, path: '/pages/index/index', iscenter: true } } })
  }

  beforeEach(() => {
    jest.useFakeTimers()
    storage = {}
    app = {}
    wxMock = {
      navigateTo: jest.fn(),
      switchTab: jest.fn(),
      showToast: jest.fn(),
      setStorageSync: jest.fn((key: string, value: unknown) => { storage[key] = value }),
      getStorageSync: jest.fn((key: string) => storage[key]),
      removeStorageSync: jest.fn((key: string) => { delete storage[key] }),
    }
    ;(global as any).wx = wxMock
    ;(global as any).getApp = () => app
    ;(global as any).getCurrentPages = () => [{ route: HOME_ROUTE }]
  })

  afterEach(() => {
    jest.useRealTimers()
    delete (global as any).Component
    delete (global as any).wx
    delete (global as any).getApp
    delete (global as any).getCurrentPages
  })

  it('keeps waiting for a late home listener instead of jumping to the analyze page', () => {
    const tabBar = loadTabBar()
    const showMenu = jest.fn()

    tapRecordButton(tabBar)
    jest.advanceTimersByTime(1500)
    expect(wxMock.navigateTo).not.toHaveBeenCalled()

    app.eventCenter = { callbacks: { showRecordMenu: showMenu } }
    jest.advanceTimersByTime(1000)

    expect(showMenu).toHaveBeenCalledTimes(1)
    expect(wxMock.navigateTo).not.toHaveBeenCalled()
    expect(tabBar.data.recordOpening).toBe(false)
    expect(storage.showRecordMenuModal).toBeUndefined()
  })

  it('never opens the analyze page with leftover photos when the home listener is missing', () => {
    const tabBar = loadTabBar()
    storage.analyzeImagePaths = ['wxfile://old-meal.jpg']

    tapRecordButton(tabBar)
    jest.advanceTimersByTime(20000)

    expect(wxMock.navigateTo).not.toHaveBeenCalled()
    expect(wxMock.showToast).toHaveBeenCalledWith(expect.objectContaining({ title: '记录入口打开失败，请重试' }))
    expect(tabBar.data.recordOpening).toBe(false)
    expect(storage.showRecordMenuModal).toBeUndefined()
  })
})
