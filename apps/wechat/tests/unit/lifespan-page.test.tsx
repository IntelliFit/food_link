import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import Taro from '@tarojs/taro'

import { LifespanEntry } from '../../src/components/LifespanEntry'
import { buildModel } from '../../src/packageLifespan/model/predictor'
import { playPoster, threeYouPoster } from '../../src/packageLifespan/model/share'
import LifespanPredictorPage from '../../src/packageLifespan/pages/predictor/index'
import { getAccessToken, getHealthProfile } from '../../src/utils/api'

jest.mock('../../src/utils/api', () => ({
  getAccessToken: jest.fn(),
  getHealthProfile: jest.fn(),
  getShareQrEnvVersion: jest.fn(() => 'release'),
  getUnlimitedQRCode: jest.fn(),
}))
jest.mock('../../src/utils/weapp-canvas-image', () => ({ resolveCanvasImageSrc: jest.fn() }))
jest.mock('../../src/components/AppColorSchemeContext', () => ({ useAppColorScheme: () => ({ scheme: 'light' }) }))
jest.mock('../../src/utils/subpackage-extra', () => ({ extraPkgUrl: (path: string) => `/packageExtra${path}` }))

const STORED = {
  id: 'me', label: '我', sex: 'male', age: 32, height_cm: 175, weight_kg: 78, smoking: 'never', alcohol: 'less_than_daily',
  pa_met_h: 14, fruit_g: 60, fish_g: 15, sleep_h: 6.5, energy_balance_kcal: 60,
}

function mockStorage(initial: unknown): Map<string, unknown> {
  const store = new Map<string, unknown>([['lifespan_people_v1', initial]])
  Object.assign(Taro, {
    getStorageSync: jest.fn((key: string) => store.get(key)),
    setStorageSync: jest.fn((key: string, value: unknown) => { store.set(key, value) }),
    removeStorageSync: jest.fn((key: string) => { store.delete(key) }),
    createSelectorQuery: jest.fn(() => ({
      select: () => ({ fields: () => ({ exec: (callback: (result: unknown[]) => void) => callback([null]) }) }),
    })),
    nextTick: jest.fn((callback: () => void) => callback()),
    setNavigationBarColor: jest.fn(),
    navigateTo: jest.fn(),
    switchTab: jest.fn(),
    showModal: jest.fn(async () => ({ confirm: true })),
    showToast: jest.fn(),
  })
  return store
}

describe('profile entry', () => {
  it('opens the predictor without asking for a login', () => {
    mockStorage(undefined)
    render(<LifespanEntry />)
    expect(screen.getByText('模拟估算，不用于诊断')).toBeInTheDocument()
    fireEvent.click(screen.getByText('寿命预测器'))
    expect(Taro.navigateTo).toHaveBeenCalledWith({ url: '/packageLifespan/pages/predictor/index' })
  })
})

describe('predictor page', () => {
  beforeEach(() => {
    ;(getAccessToken as jest.Mock).mockReturnValue(null)
    ;(getHealthProfile as jest.Mock).mockReset()
  })

  it('works logged out: asks for the basics, then shows the result and stores it on the phone only', async () => {
    const store = mockStorage(undefined)
    const view = render(<LifespanPredictorPage />)
    expect(getHealthProfile).not.toHaveBeenCalled()

    fireEvent.click(screen.getByText('开始算'))
    expect(screen.getByText('请选择性别')).toBeInTheDocument()

    fireEvent.click(screen.getByText('男'))
    const inputs = view.container.querySelectorAll('input')
    const fill = (index: number, value: string) => {
      const props = Object.entries(inputs[index]).find(([key]) => key.startsWith('__reactProps'))?.[1] as { onInput: (e: unknown) => void }
      act(() => props.onInput({ detail: { value } }))
    }
    fill(0, '32')
    fill(1, '175')
    fill(2, '78')
    fireEvent.click(screen.getByText('开始算'))

    await screen.findByText('调完以后，平均活到')
    expect(screen.getByText('每天多吃一个苹果')).toBeInTheDocument()
    expect(store.get('lifespan_people_v1')).toEqual([expect.objectContaining({ id: 'me', label: '我', age: 32 })])
  })

  it('fills the form from the health profile when logged in', async () => {
    mockStorage(undefined)
    ;(getAccessToken as jest.Mock).mockReturnValue('token')
    ;(getHealthProfile as jest.Mock).mockResolvedValue({ gender: 'female', birthday: '1990-01-01', height: 165, weight: 55 })
    render(<LifespanPredictorPage />)
    expect(await screen.findByText(/已从健康档案带入/)).toBeInTheDocument()
  })

  it('still lets you fill the form in when the health profile cannot be read', async () => {
    mockStorage(undefined)
    ;(getAccessToken as jest.Mock).mockReturnValue('token')
    ;(getHealthProfile as jest.Mock).mockRejectedValue(new Error('offline'))
    render(<LifespanPredictorPage />)
    await waitFor(() => expect(getHealthProfile).toHaveBeenCalled())
    expect(screen.getByText('开始算')).toBeInTheDocument()
    expect(screen.queryByText(/已从健康档案带入/)).not.toBeInTheDocument()
  })

  it('updates the headline when a life card is applied and removed', async () => {
    mockStorage([STORED])
    render(<LifespanPredictorPage />)
    await screen.findByText('78.7')
    fireEvent.click(screen.getByText('每天一杯奶茶'))
    expect(await screen.findByText('75.3')).toBeInTheDocument()
    expect(screen.getByText(/已加上/)).toBeInTheDocument()
    fireEvent.click(screen.getByText('每天一杯奶茶'))
    expect(await screen.findByText('78.7')).toBeInTheDocument()
  })

  it('shows less gain after choosing a later start and half adherence', async () => {
    mockStorage([STORED])
    render(<LifespanPredictorPage />)
    await screen.findByText('78.7')
    fireEvent.click(screen.getByText('每天多吃一个苹果'))
    const full = (await screen.findAllByText(/^\+\d\.\d 年$/))[0].textContent
    fireEvent.click(screen.getAllByText('做到一半')[0])
    fireEvent.click(screen.getByText('50 岁才开始'))
    expect(await screen.findByText(/从 50 岁开始 · 做到一半/)).toBeInTheDocument()
    expect(full).toBe('+2.4 年')
    expect(screen.getAllByText('+1.0 年').length).toBeGreaterThan(0)
  })

  it('keeps slider changes when a life card is added afterwards', async () => {
    mockStorage([STORED])
    const view = render(<LifespanPredictorPage />)
    await screen.findByText('78.7')
    const slider = view.container.querySelector('input[type="range"][max="400"]') as Element
    const props = Object.entries(slider).find(([key]) => key.startsWith('__reactProps'))?.[1] as { onChange: (e: unknown) => void }
    act(() => props.onChange({ detail: { value: 300 } }))
    fireEvent.click(screen.getByText('每天多吃一个苹果'))
    expect(await screen.findByText('500 g/天')).toBeInTheDocument()
    fireEvent.click(screen.getByText('每天多吃一个苹果'))
    expect(await screen.findByText('300 g/天')).toBeInTheDocument()
  })

  it('keeps what was tuned when switching tabs and back', async () => {
    mockStorage([STORED])
    render(<LifespanPredictorPage />)
    await screen.findByText('78.7')
    fireEvent.click(screen.getByText('每天多吃一个苹果'))
    fireEvent.click(screen.getByText('三个你'))
    fireEvent.click(await screen.findByText('自己调'))
    expect(await screen.findByText(/已加上/)).toBeInTheDocument()
    expect(screen.queryByText('78.7')).not.toBeInTheDocument()
  })

  it('reads correctly when letting go would lengthen life for an underweight person', async () => {
    mockStorage([{ ...STORED, age: 18, height_cm: 150, weight_kg: 40, energy_balance_kcal: 0, fruit_g: 60, fish_g: 15 }])
    render(<LifespanPredictorPage />)
    fireEvent.click(await screen.findByText('三个你'))
    fireEvent.click(await screen.findByText('寿命分布'))
    const reading = await screen.findByText(/离世年龄是一条分布/)
    expect(reading.textContent).not.toContain('-')
    expect(reading.textContent).toContain('放飞把分布往右推了')
    expect(screen.getByText(/外推：年龄 18 岁/)).toBeInTheDocument()
  })

  it('switches between the two tabs and can reset', async () => {
    mockStorage([STORED])
    render(<LifespanPredictorPage />)
    fireEvent.click(await screen.findByText('三个你'))
    expect(await screen.findByText('最值得改的三件事')).toBeInTheDocument()
    expect(screen.getByText('多吃水果')).toBeInTheDocument()
    fireEvent.click(screen.getByText('再掷一次'))
    expect(screen.getByText('第 2 次')).toBeInTheDocument()
    fireEvent.click(screen.getByText('不只这三件，自己调调看 ›'))
    fireEvent.click(await screen.findByText('每天一包烟'))
    fireEvent.click(screen.getByText('回到现在'))
    expect(await screen.findByText('78.7')).toBeInTheDocument()
  })

  it('sends the three-change buttons to the existing pages', async () => {
    mockStorage([STORED])
    render(<LifespanPredictorPage />)
    fireEvent.click(await screen.findByText('三个你'))
    fireEvent.click(await screen.findByText('下一餐加一份水果 ›'))
    expect(Taro.switchTab).toHaveBeenCalledWith({ url: '/pages/index/index' })
    fireEvent.click(screen.getByText('去设置饮食方案 ›'))
    expect(Taro.navigateTo).toHaveBeenCalledWith({ url: '/packageExtra/pages/nutrition-plans/index' })
  })

  it('adds a family member on the phone and calculates for them', async () => {
    const store = mockStorage([STORED])
    const view = render(<LifespanPredictorPage />)
    fireEvent.click(await screen.findByText('换个人'))
    fireEvent.click(screen.getByText('＋ 新建一个人'))
    fireEvent.click(screen.getByText('妈妈'))
    fireEvent.click(screen.getByText('女'))
    const inputs = view.container.querySelectorAll('.lp-sheet input')
    ;['60', '160', '58'].forEach((value, index) => {
      const props = Object.entries(inputs[index]).find(([key]) => key.startsWith('__reactProps'))?.[1] as { onInput: (e: unknown) => void }
      act(() => props.onInput({ detail: { value } }))
    })
    fireEvent.click(screen.getByText('开始算'))
    expect(await screen.findByText(/在算：妈妈 · 女 60 岁/)).toBeInTheDocument()
    expect(store.get('lifespan_people_v1')).toHaveLength(2)
  })

  it('removes people from the phone after confirming', async () => {
    const store = mockStorage([STORED, { ...STORED, id: 'p1', label: '爸爸', age: 58 }])
    render(<LifespanPredictorPage />)
    fireEvent.click(await screen.findByText('换个人'))
    fireEvent.click(screen.getByText('删除我'))
    await screen.findByText(/在算：爸爸/)
    expect(store.get('lifespan_people_v1')).toEqual([expect.objectContaining({ id: 'p1' })])

    fireEvent.click(screen.getByText('三个你'))
    fireEvent.click(await screen.findByText('清除这台手机上的寿命预测器数据'))
    await screen.findByText('先算一次')
    expect(store.has('lifespan_people_v1')).toBe(false)
  })
})

describe('share cards', () => {
  const person = { sex: 'male', age: 32, height_cm: 175, weight_kg: 78, smoking: 'never', alcohol: 'less_than_daily', pa_met_h: 14, fruit_g: 60, fish_g: 15, sleep_h: 6.5, energy_balance_kcal: 60 } as const
  const model = buildModel(person)
  const hidden = { showWeight: false, showAge: false }
  const shown = { showWeight: true, showAge: true }
  const today = model.branches[0]
  const tuned = model.branches[1]
  const share = { person, label: '爸爸', summary: '戒烟', today, tuned, delta: tuned.le.mean - today.le.mean }
  const textOf = (value: unknown) => JSON.stringify(value)

  it('leaves weight and age out by default and always carries the disclaimer', () => {
    const three = textOf(threeYouPoster('我', model, 0, hidden))
    const play = textOf(playPoster(share, hidden))
    for (const card of [three, play]) {
      expect(card).toContain('模拟估算，不用于诊断')
      expect(card).not.toContain('kg')
      expect(card).not.toContain('32 岁')
    }
    expect(three).toContain('同一个我，三种吃法')
    expect(play).toContain('爸爸试了：戒烟')
    expect(play).toContain('平均多活')
  })

  it('adds weight and age only when turned on', () => {
    expect(textOf(threeYouPoster('我', model, 0, shown))).toContain('从 32 岁开始分岔')
    const play = textOf(playPoster(share, shown))
    expect(play).toContain('kg')
    expect(play).toContain('从 32 岁起')
  })

  it('keeps the body shape neutral until weight is shown', () => {
    const neutral = threeYouPoster('我', model, 0, hidden).columns.map(column => column.bmi)
    expect(new Set(neutral).size).toBe(1)
    const real = threeYouPoster('我', model, 0, shown).columns.map(column => column.bmi)
    expect(new Set(real).size).toBeGreaterThan(1)
    expect(new Set(playPoster(share, hidden).columns.map(column => column.bmi)).size).toBe(1)
  })

  it('labels one life as one simulation and uses a later note age for older people', () => {
    expect(threeYouPoster('我', model, 0, hidden).columns[0].caption).toBe('这次模拟')
    const older = buildModel({ ...person, age: 70 })
    expect(threeYouPoster('爸爸', older, 0, shown).columns[0].note).toContain('90 岁')
  })

  it('says fewer years when the change makes things worse', () => {
    const worse = playPoster({ ...share, summary: '每天一包烟', tuned: model.branches[2], delta: -3 }, hidden)
    expect(worse.highlight).toMatchObject({ before: '在这个模型里，平均少活', value: '3.0', tone: 'c' })
  })
})
