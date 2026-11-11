import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import Taro from '@tarojs/taro'
import RecordManualPage from '../../src/packageExtra/pages/record-manual'
import { fetchManualFoodCatalog, fetchManualCustomFoods, getAccessToken, saveManualCustomFood, saveFoodRecord } from '../../src/utils/api'

jest.mock('@tarojs/components', () => {
  const React = require('react')
  return {
    View: ({ children, ...props }: any) => React.createElement('div', props, children),
    Text: ({ children, ...props }: any) => React.createElement('span', props, children),
    Picker: ({ children }: any) => React.createElement('div', {}, children),
    Image: ({ mode: _mode, ...props }: any) => React.createElement('img', props),
    Input: ({ onInput, onBlur, confirmType: _confirmType, type: _type, ...props }: any) => React.createElement('input', {
      ...props, onChange: (event: any) => onInput?.({ detail: { value: event.target.value } }), onBlur: (event: any) => onBlur?.({ detail: { value: event.target.value } }),
    }),
    ScrollView: ({ children }: any) => React.createElement('div', {}, children),
    PageContainer: ({ children, show }: any) => show ? React.createElement('div', {}, children) : null,
  }
})
jest.mock('../../src/utils/api', () => ({
  getAccessToken: jest.fn(),
  fetchManualFoodCatalog: jest.fn(),
  fetchManualCustomFoods: jest.fn(async () => ({ items: [] })),
  saveManualCustomFood: jest.fn(),
  saveFoodRecord: jest.fn(async () => ({ id: 'recorded-food' })),
  showUnifiedApiError: jest.fn(),
}))
jest.mock('../../src/utils/withAuth', () => ({ withAuth: (component: unknown) => component }))
jest.mock('../../src/components/AppColorSchemeContext', () => ({ useAppColorScheme: () => ({ scheme: 'light' }) }))
jest.mock('../../src/components/MealImpactCard', () => ({ useMealImpactSheet: () => ({ sheet: null, show: jest.fn() }) }))
jest.mock('../../src/utils/theme-navigation-bar', () => ({ applyThemeNavigationBar: jest.fn() }))
jest.mock('../../src/utils/home-dashboard-local-cache', () => ({ refreshHomeDashboardLocalSnapshotFromCloud: jest.fn() }))
jest.mock('../../src/utils/infer-default-meal-type', () => ({
  inferDefaultMealTypeFromLocalTime: () => 'breakfast',
  getRecommendedMealTypeWithFallback: async () => 'breakfast',
}))

const oats = {
  id: 'oats', source: 'nutrition_library', title: '原味燕麦', subtitle: '',
  default_weight_grams: 100, display_unit: 'g', display_unit_label: 'g',
  total_calories: 350, total_protein: 10, total_carbs: 60, total_fat: 7,
}

describe('food library page detail and custom editor integration', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(Taro as any).getCurrentInstance = jest.fn(() => ({ router: { params: {} } }))
    ;(Taro as any).vibrateShort = jest.fn(async () => ({}))
    ;(Taro.getStorageSync as jest.Mock).mockReturnValue(undefined)
    ;(getAccessToken as jest.Mock).mockReturnValue('')
    ;(fetchManualCustomFoods as jest.Mock).mockReset().mockResolvedValue({ items: [], has_more: false })
    ;(fetchManualFoodCatalog as jest.Mock).mockResolvedValue({
      items: [oats], categories: [{ key: 'common', label: '常见' }], page: 1, has_more: false,
    })
  })

  it('opens the item from the page and keeps direct add separate from viewing', async () => {
    render(<RecordManualPage />)
    const card = await screen.findByLabelText('查看原味燕麦详情')
    const add = screen.getByLabelText('添加原味燕麦到本餐')
    fireEvent.click(add)
    expect(screen.queryByText('食物详情')).not.toBeInTheDocument()
    expect(add).toHaveTextContent('100g')

    fireEvent.click(card)
    expect(screen.getByText('食物详情')).toBeInTheDocument()
    const details = screen.getByText('食物详情').closest('.manual-food-detail') as HTMLElement
    expect(within(details).getByText('350')).toBeInTheDocument()
    fireEvent.click(screen.getByText('加入本餐'))
    expect(screen.queryByText('食物详情')).not.toBeInTheDocument()
    expect(add).toHaveTextContent('200g')
  })

  it('saves the simplified editor through the existing public custom-food flow', async () => {
    ;(getAccessToken as jest.Mock).mockReturnValue('test-token')
    ;(saveManualCustomFood as jest.Mock).mockImplementation(async (input) => ({
      ...input, id: 'saved-food', source: 'custom', can_edit: true, subtitle: '',
    }))
    render(<RecordManualPage />)
    await screen.findByLabelText('查看原味燕麦详情')
    fireEvent.click(screen.getByText('手动新建'))
    fireEvent.change(screen.getByPlaceholderText('例如 家里卤牛肉'), { target: { value: '家里卤牛肉' } })
    fireEvent.change(screen.getByPlaceholderText('填写已知热量'), { target: { value: '500' } })
    fireEvent.click(screen.getByText('保存食物'))

    await waitFor(() => expect(saveManualCustomFood).toHaveBeenCalledTimes(1))
    expect(saveManualCustomFood).toHaveBeenCalledWith(expect.objectContaining({
      title: '家里卤牛肉', default_weight_grams: 100, share_to_public: true,
      total_calories: 119.5, total_protein: 0,
    }))
    await waitFor(() => expect(screen.queryByText('新建自定义食物')).not.toBeInTheDocument())
    expect(screen.getByLabelText('查看家里卤牛肉详情')).toBeInTheDocument()
  })

  it.each([
    { title: '体积牛奶', measurement: { amount: 250, unit: 'ml', basis_amount: 100, basis_unit: 'ml', nutrients_per_basis: { calories: 60 } }, clicks: 1, amount: 250, calories: 150, grams: 0 },
    { title: '按个食物', measurement: { amount: 1, unit: 'piece', basis_amount: 1, basis_unit: 'piece', nutrients_per_basis: { calories: 80 } }, clicks: 2, amount: 2, calories: 160, grams: 0 },
    { title: '按份餐食', measurement: { amount: 1, unit: 'serving', basis_amount: 100, basis_unit: 'g', nutrients_per_basis: { calories: 200 }, unit_conversions: { serving: 150 } }, clicks: 1, amount: 1, calories: 300, grams: 150 },
  ])('records $title with native amount and only known gram mass', async ({ title, measurement, clicks, amount, calories, grams }) => {
    ;(getAccessToken as jest.Mock).mockReturnValue('test-token')
    ;(fetchManualFoodCatalog as jest.Mock).mockResolvedValue({ items: [{ ...oats, title, id: title, default_weight_grams: grams, measurement }], categories: [{ key: 'common', label: '常见' }], page: 1, has_more: false })
    render(<RecordManualPage />)
    const add = await screen.findByLabelText(`添加${title}到本餐`)
    for (let index = 0; index < clicks; index++) fireEvent.click(add)
    fireEvent.click(screen.getByText('选好了，核对本餐'))
    fireEvent.click(screen.getByText(/^确认记录到\d+月\d+日$/))
    await waitFor(() => expect(saveFoodRecord).toHaveBeenCalledTimes(1))
    expect(saveFoodRecord).toHaveBeenCalledWith(expect.objectContaining({
      total_calories: calories, total_weight_grams: grams,
      items: [expect.objectContaining({ weight: grams, intake: grams, measurement: expect.objectContaining({ amount, unit: measurement.unit }), nutrients: expect.objectContaining({ calories }) })],
    }))
  })

  it('creates a 250ml custom food without sending a fake gram or per100g value', async () => {
    ;(getAccessToken as jest.Mock).mockReturnValue('test-token')
    ;(saveManualCustomFood as jest.Mock).mockImplementation(async (input) => ({ ...input, id: 'milk-custom', source: 'custom', can_edit: true, subtitle: '' }))
    render(<RecordManualPage />)
    await screen.findByLabelText('查看原味燕麦详情')
    fireEvent.click(screen.getByText('手动新建'))
    fireEvent.click(screen.getByText('ml'))
    const editor = screen.getByText('新建自定义食物').closest('.custom-food-editor') as HTMLElement
    fireEvent.click(within(editor).getByText('kcal'))
    fireEvent.change(screen.getByPlaceholderText('例如 家里卤牛肉'), { target: { value: '手建牛奶' } })
    fireEvent.change(screen.getByPlaceholderText('填写已知热量'), { target: { value: '60' } })
    fireEvent.click(screen.getByText('调整'))
    const portionInput = screen.getByText('默认一份数量 ml').parentElement!.querySelector('input')!
    fireEvent.change(portionInput, { target: { value: '250' } })
    fireEvent.click(screen.getByText('保存食物'))
    await waitFor(() => expect(saveManualCustomFood).toHaveBeenCalledTimes(1))
    expect(saveManualCustomFood).toHaveBeenCalledWith(expect.objectContaining({
      total_calories: 150, default_weight_grams: 0, nutrients_per_100g: undefined,
      measurement: expect.objectContaining({ amount: 250, unit: 'ml', basis_amount: 100, basis_unit: 'ml', nutrients_per_basis: expect.objectContaining({ calories: 60 }) }),
    }))
  })

  it('emits the native measurement from picker mode', async () => {
    const emit = jest.fn()
    ;(Taro as any).getCurrentInstance = jest.fn(() => ({ router: { params: { picker: '1' } }, page: { getOpenerEventChannel: () => ({ emit }) } }))
    ;(fetchManualFoodCatalog as jest.Mock).mockResolvedValue({ items: [{ ...oats, title: '选择牛奶', measurement: { amount: 250, unit: 'ml', basis_amount: 100, basis_unit: 'ml', nutrients_per_basis: { calories: 60 } } }], categories: [{ key: 'common', label: '常见' }], page: 1, has_more: false })
    render(<RecordManualPage />)
    fireEvent.click(await screen.findByLabelText('添加选择牛奶到本餐'))
    fireEvent.click(screen.getByText('选好了，核对添加'))
    fireEvent.click(screen.getByText('确认添加到本餐'))
    expect(emit).toHaveBeenCalledWith(expect.any(String), [expect.objectContaining({ weight: 0, intake: 0, measurement: expect.objectContaining({ amount: 250, unit: 'ml' }), nutrients: expect.objectContaining({ calories: 150 }) })])
    expect(saveFoodRecord).not.toHaveBeenCalled()
  })

  it('blocks adding a food whose portion-to-label relationship is unknown', async () => {
    ;(fetchManualFoodCatalog as jest.Mock).mockResolvedValue({ items: [{ ...oats, measurement: { amount: 1, unit: 'serving', basis_amount: 100, basis_unit: 'g', nutrients_per_basis: { calories: 200 } } }], categories: [{ key: 'common', label: '常见' }], page: 1, has_more: false })
    render(<RecordManualPage />)
    fireEvent.click(await screen.findByLabelText('添加原味燕麦到本餐'))
    expect(Taro.showToast).toHaveBeenCalledWith(expect.objectContaining({ title: '请先补全食物的单位换算关系' }))
    expect(screen.queryByText('选好了，核对本餐')).not.toBeInTheDocument()
  })

  it('saves a user-defined 6g serving and records two servings against the original per100g nutrition', async () => {
    ;(getAccessToken as jest.Mock).mockReturnValue('test-token')
    ;(saveManualCustomFood as jest.Mock).mockImplementation(async input => ({ ...input, id: 'my-snack', source: 'custom', can_edit: true, subtitle: '' }))
    const { container } = render(<RecordManualPage />)
    await screen.findByLabelText('查看原味燕麦详情')
    fireEvent.click(screen.getByText('手动新建'))
    fireEvent.change(screen.getByPlaceholderText('例如 家里卤牛肉'), { target: { value: '自定义小份奶酪' } })
    fireEvent.click(within(container.querySelector('.custom-food-editor')! as HTMLElement).getByText('kcal'))
    fireEvent.change(screen.getByPlaceholderText('填写已知热量'), { target: { value: '500' } })
    fireEvent.click(screen.getByText('调整'))
    fireEvent.click(Array.from(container.querySelectorAll('.custom-editor-portion-settings .custom-basis-chip')).find(element => element.textContent === '份')!)
    fireEvent.click(screen.getByText('按整包计算每份大小'))
    fireEvent.change(screen.getByLabelText('整包总量g'), { target: { value: '90' } })
    fireEvent.change(screen.getByLabelText('一包有多少份'), { target: { value: '15' } })
    fireEvent.click(screen.getByText('设为默认一份'))
    fireEvent.click(screen.getByText('保存食物'))
    await waitFor(() => expect(saveManualCustomFood).toHaveBeenCalledTimes(1))
    expect(saveManualCustomFood).toHaveBeenCalledWith(expect.objectContaining({
      default_weight_grams: 6, total_calories: 30,
      measurement: expect.objectContaining({ amount: 1, unit: 'serving', basis_amount: 100, basis_unit: 'g', unit_conversions: { g: 1, serving: 6 }, nutrients_per_basis: expect.objectContaining({ calories: 500 }) }),
    }))
    const add = await screen.findByLabelText('添加自定义小份奶酪到本餐')
    fireEvent.click(add)
    fireEvent.click(add)
    fireEvent.click(screen.getByText('选好了，核对本餐'))
    fireEvent.click(screen.getByText(/^确认记录到\d+月\d+日$/))
    await waitFor(() => expect(saveFoodRecord).toHaveBeenCalledTimes(1))
    expect(saveFoodRecord).toHaveBeenCalledWith(expect.objectContaining({ total_calories: 60, total_weight_grams: 12, items: [expect.objectContaining({ weight: 12, measurement: expect.objectContaining({ amount: 2, unit: 'serving' }) })] }))
  })

  it('shows every cloud page and preserves distinct packaged imports with the same name', async () => {
    ;(getAccessToken as jest.Mock).mockReturnValue('test-token')
    const custom = Array.from({ length: 120 }, (_, index) => ({ ...oats, source: 'custom', can_edit: true, id: `custom-${index}`, title: `手建食物${index}` }))
    const packages = ['small', 'large'].map(id => ({ ...oats, source: 'packaged_food', source_label: '包装导入', can_edit: false, id, title: '同名包装不同规格' }))
    ;(fetchManualCustomFoods as jest.Mock).mockImplementation(async (_limit, offset) => offset === 0 ? { items: custom, has_more: true } : { items: packages, has_more: false })
    render(<RecordManualPage />)
    await waitFor(() => expect(fetchManualCustomFoods).toHaveBeenCalledWith(120, 120))
    fireEvent.click(screen.getAllByText('自定义')[0])
    await waitFor(() => expect(screen.getAllByText('122 个食物 · 含手动新建和拍包装导入').length).toBeGreaterThan(0))
    const imported = screen.getAllByLabelText('查看同名包装不同规格详情')
    expect(imported).toHaveLength(2)
    expect(within(imported[0]).queryByText('编辑')).not.toBeInTheDocument()
    expect(screen.getByLabelText('查看手建食物119详情')).toBeInTheDocument()
  })

  it('keeps cloud custom foods when optional recent-record recovery fails', async () => {
    ;(getAccessToken as jest.Mock).mockReturnValue('test-token')
    ;(fetchManualCustomFoods as jest.Mock).mockResolvedValue({ items: [{ ...oats, source: 'custom', can_edit: true, title: '云端食物' }], has_more: false })
    ;(fetchManualFoodCatalog as jest.Mock).mockImplementation(async category => {
      if (category === 'recent') throw new Error('recent unavailable')
      return { items: [oats], categories: [{ key: 'common', label: '常见' }], page: 1, has_more: false }
    })
    render(<RecordManualPage />)
    await screen.findByLabelText('查看原味燕麦详情')
    fireEvent.click(screen.getAllByText('自定义')[0])
    expect(await screen.findByLabelText('查看云端食物详情')).toBeInTheDocument()
    expect(screen.queryByText('部分食物未同步，点此重试')).not.toBeInTheDocument()
  })

  it('keeps a partial cloud page and allows retrying a failed next page', async () => {
    ;(getAccessToken as jest.Mock).mockReturnValue('test-token')
    ;(fetchManualCustomFoods as jest.Mock).mockImplementation(async (_limit, offset) => {
      if (offset > 0) throw new Error('page failed')
      return { items: [{ ...oats, source: 'custom', title: '已同步食物' }], has_more: true }
    })
    render(<RecordManualPage />)
    await screen.findByLabelText('查看原味燕麦详情')
    fireEvent.click(screen.getAllByText('自定义')[0])
    await screen.findByText('部分食物未同步，点此重试')
    expect(screen.getByLabelText('查看已同步食物详情')).toBeInTheDocument()
    ;(fetchManualCustomFoods as jest.Mock).mockResolvedValue({ items: [{ ...oats, source: 'custom', title: '已同步食物' }, { ...oats, source: 'packaged_food', id: 'recovered', title: '恢复的包装' }], has_more: false })
    fireEvent.click(screen.getByText('部分食物未同步，点此重试'))
    expect(await screen.findByLabelText('查看恢复的包装详情')).toBeInTheDocument()
    expect(screen.queryByText('部分食物未同步，点此重试')).not.toBeInTheDocument()
  })

  it('keeps a newly saved food when an earlier cloud refresh finishes late', async () => {
    ;(getAccessToken as jest.Mock).mockReturnValue('test-token')
    let finishRefresh!: (value: unknown) => void
    ;(fetchManualCustomFoods as jest.Mock).mockImplementationOnce(() => new Promise(resolve => { finishRefresh = resolve }))
    ;(saveManualCustomFood as jest.Mock).mockImplementation(async input => ({ ...input, id: 'saved-food', source: 'custom', can_edit: true, subtitle: '' }))
    const { container } = render(<RecordManualPage />)
    await screen.findByLabelText('查看原味燕麦详情')
    fireEvent.click(screen.getByText('手动新建'))
    fireEvent.change(screen.getByPlaceholderText('例如 家里卤牛肉'), { target: { value: '刚保存的食物' } })
    fireEvent.click(within(container.querySelector('.custom-food-editor')! as HTMLElement).getByText('kcal'))
    fireEvent.change(screen.getByPlaceholderText('填写已知热量'), { target: { value: '200' } })
    fireEvent.click(screen.getByText('保存食物'))
    await screen.findByLabelText('查看刚保存的食物详情')
    await act(async () => finishRefresh({ items: [{ ...oats, id: 'saved-food', source: 'custom', title: '刚保存的食物', total_calories: 100 }], has_more: false }))
    expect(screen.getByLabelText('查看刚保存的食物详情').querySelector('.food-sub')).toHaveTextContent('200 kcal')
  })
})
