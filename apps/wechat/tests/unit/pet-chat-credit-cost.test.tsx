import { act, fireEvent, render, screen } from '@testing-library/react'
import Taro from '@tarojs/taro'
import PetChatPage from '../../src/packageExtra/pages/pet-chat/index'
import { compressImagePathForUpload, estimatePetChat, streamGeneratePetChat, uploadAnalyzeImageFile } from '../../src/utils/api'
import { rememberMealLocation } from '../../src/utils/meal-location'
import { chooseImageWithPrivacy } from '../../src/utils/weapp-privacy'

jest.mock('../../src/utils/withAuth', () => ({
  withAuth: (Component: any) => Component,
}))

jest.mock('../../src/utils/api', () => ({
  getAccessToken: jest.fn(() => 'test-access-token'),
  estimatePetChat: jest.fn(),
  compressImagePathForUpload: jest.fn(),
  getPetChatSession: jest.fn(),
  getLatestPetChatSession: jest.fn(),
  getPetSummary: jest.fn(),
  getStatsSummary: jest.fn(),
  listPetChatSessions: jest.fn(),
  showUnifiedApiError: jest.fn(),
  streamGeneratePetChat: jest.fn(),
  uploadAnalyzeImageFile: jest.fn(),
  updateHealthProfile: jest.fn(),
}))

jest.mock('../../src/utils/weapp-privacy', () => ({
  chooseImageWithPrivacy: jest.fn(),
  ensureWeappPrivacyAuthorized: jest.fn(() => Promise.resolve()),
  isPrivacyAuthorizeError: jest.fn(() => false),
  showPrivacyAuthorizeFailure: jest.fn(),
}))

jest.mock('../../src/components/AppColorSchemeContext', () => ({
  useAppColorScheme: () => ({ scheme: 'light' }),
}))

jest.mock('../../src/utils/theme-navigation-bar', () => ({
  applyThemeNavigationBar: jest.fn(),
}))

jest.mock('../../src/components/PetAvatar', () => ({
  PetAvatar: () => <div aria-label='宠物头像' />,
}))

describe('pet chat credit cost', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    jest.clearAllMocks()
    rememberMealLocation('test-access-token')
    ;(Taro.useDidShow as jest.Mock).mockImplementation(() => {})
    ;(Taro as typeof Taro & { setNavigationBarTitle: jest.Mock }).setNavigationBarTitle = jest.fn()
    ;(estimatePetChat as jest.Mock).mockResolvedValue({ pricing: { credits_charged: 3 } })
    ;(compressImagePathForUpload as jest.Mock).mockImplementation(async (path: string) => path)
    ;(uploadAnalyzeImageFile as jest.Mock).mockResolvedValue({ imageUrl: 'https://cdn-food-images.example.com/pet-chat/meal.jpg' })
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('gets location only after a tap and passes it into the recommendation request', async () => {
    const locate = jest.fn().mockResolvedValue({ latitude: 40, longitude: 116, accuracy: 30 })
    ;(Taro as unknown as { getLocation: jest.Mock }).getLocation = locate
    render(<PetChatPage />)
    expect(locate).not.toHaveBeenCalled()
    await act(async () => {
      fireEvent.click(screen.getByText('使用当前位置'))
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(locate).toHaveBeenCalledWith({ type: 'gcj02' })
    expect(screen.getByText('已使用当前位置 · 更新')).toBeInTheDocument()
    fireEvent.click(screen.getByText('发送'))
    expect((streamGeneratePetChat as jest.Mock).mock.calls[0][8]).toEqual(expect.objectContaining({ latitude: 40, longitude: 116, coordinate_type: 'gcj02' }))
  })

  it('fills a quick question, shows its estimate, then allows sending', async () => {
    render(<PetChatPage />)

    fireEvent.click(screen.getByText('推荐食谱'))
    expect(streamGeneratePetChat).not.toHaveBeenCalled()
    expect(screen.getByText('预计消耗 -- 积分')).toBeInTheDocument()

    await act(async () => {
      jest.advanceTimersByTime(350)
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(estimatePetChat).toHaveBeenCalledWith('推荐食谱', 'week', false, [])
    expect(screen.getByText('预计消耗 3 积分')).toBeInTheDocument()

    fireEvent.click(screen.getByText('发送'))
    expect(streamGeneratePetChat).toHaveBeenCalledWith(
      '推荐食谱',
      'week',
      '',
      true,
      expect.any(Object),
      false,
      [],
      undefined,
      undefined,
    )
  })

  it('enables deep thinking for estimates and generated replies', async () => {
    render(<PetChatPage />)

    fireEvent.click(screen.getByLabelText('深度思考开关'))
    fireEvent.click(screen.getByText('推荐食谱'))

    await act(async () => {
      jest.advanceTimersByTime(350)
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(estimatePetChat).toHaveBeenCalledWith('推荐食谱', 'week', true, [])
    fireEvent.click(screen.getByText('发送'))
    expect(streamGeneratePetChat).toHaveBeenCalledWith(
      '推荐食谱',
      'week',
      '',
      true,
      expect.any(Object),
      true,
      [],
      undefined,
      undefined,
    )
  })

  it('uploads a photo, estimates an image-only question, and sends the CDN URL', async () => {
    ;(chooseImageWithPrivacy as jest.Mock).mockResolvedValue({ tempFilePaths: ['wxfile://meal.jpg'] })
    const { container } = render(<PetChatPage />)

    await act(async () => {
      fireEvent.click(screen.getByText('照片'))
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(container.querySelector('.pet-chat-image-draft-preview')).toBeInTheDocument()
    expect(uploadAnalyzeImageFile).toHaveBeenCalledWith('wxfile://meal.jpg')

    await act(async () => {
      jest.advanceTimersByTime(350)
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(estimatePetChat).toHaveBeenCalledWith(
      '帮我看看这张图里与饮食和健康有关的重点',
      'week',
      false,
      ['https://cdn-food-images.example.com/pet-chat/meal.jpg'],
    )

    fireEvent.click(screen.getByText('发送'))
    expect(streamGeneratePetChat).toHaveBeenCalledWith(
      '帮我看看这张图里与饮食和健康有关的重点',
      'week',
      '',
      true,
      expect.any(Object),
      false,
      ['https://cdn-food-images.example.com/pet-chat/meal.jpg'],
      undefined,
      undefined,
    )
  })

  it('renders Agent progress and three decision-engine campus choices from the unified stream', async () => {
    render(<PetChatPage />)

    fireEvent.click(screen.getByText('今天吃什么'))
    expect(screen.getByText('预计消耗 1 积分')).toBeInTheDocument()
    fireEvent.click(screen.getByText('发送'))

    const callbacks = (streamGeneratePetChat as jest.Mock).mock.calls[0][4]
    const decisionRoles = ['health_goal', 'easy_to_follow', 'balanced_best'] as const
    const decisionLabels = ['最符合健康目标', '最容易坚持', '综合最优']
    const recommendations = Array.from({ length: 3 }, (_, index) => ({
      title: `校园菜${index + 1}`,
      reason: '由 Agent 根据真实工具结果选择',
      source: 'public_food_library',
      source_id: `food-${index + 1}`,
      calories: 286 + index,
      protein: 40,
      carbs: 20,
      fat: 8,
      items: [{ name: `校园菜${index + 1}`, amount: '183g' }],
      is_campus_food: true,
      canteen_name: '紫荆园',
      floor: '4F',
      window_name: '健康轻食',
      nutrition_basis: index === 0 ? 'library_estimate' : 'library_record',
      weight_method: index === 0 ? 'visual_estimate' : undefined,
      weight_confidence: index === 0 ? 0.68 : undefined,
      decision_role: decisionRoles[index],
      decision_label: decisionLabels[index],
      decision_score: 92 - index * 3,
    }))

    await act(async () => {
      callbacks.onProgress({ label: '正在搜索清华食堂', status: 'running' })
    })
    expect(screen.getByText('正在搜索清华食堂')).toBeInTheDocument()

    await act(async () => {
      callbacks.onDietResult({
        recommendation: {
          scene: 'eat_out',
          title: '校园餐 Agent 推荐',
          summary: '已核对',
          calorie_remaining: 600,
          macro_gaps: { calories: 600, protein: 40, carbs: 80, fat: 20 },
          recommendations,
          generated_by: 'qwen3.8-flash',
          ai_used: true,
          ai_rerank_count: 20,
          decision_engine_version: 'foodlink-diet-decision-v1',
          resolved_school: { id: 'thu-id', name: '清华大学' },
        },
      })
      callbacks.onChunk('我调用工具核对了真实菜品。')
      callbacks.onDone({ session_id: 'session-campus' })
    })

    expect(screen.getByText('真实校园食物库 · 决策引擎选择 · AI 负责解释')).toBeInTheDocument()
    expect(screen.getByText('校园菜1')).toBeInTheDocument()
    expect(screen.getByText('校园菜3')).toBeInTheDocument()
    expect(screen.getByText('最符合健康目标')).toBeInTheDocument()
    expect(screen.getByText('最容易坚持')).toBeInTheDocument()
    expect(screen.getByText('综合最优')).toBeInTheDocument()
    expect(screen.getByText('该取向匹配度 92 分')).toBeInTheDocument()
    expect(screen.getByText('≈286 kcal')).toBeInTheDocument()
    expect(screen.getByText('库内估算 · 份量 183g · 视觉估重 · 置信度 68%')).toBeInTheDocument()
  })

  it('opens the selected original food from a composed meal and handles cancellation', async () => {
    const choose = jest.fn().mockResolvedValue({ tapIndex: 1 })
    ;(Taro as unknown as { showActionSheet: jest.Mock }).showActionSheet = choose
    render(<PetChatPage />)
    fireEvent.click(screen.getByText('今天吃什么'))
    fireEvent.click(screen.getByText('发送'))
    const callbacks = (streamGeneratePetChat as jest.Mock).mock.calls[0][4]
    const components = [
      { title: '蒸鸡肉', source: 'public_food_library', source_id: 'meat', price: 12, price_unit: '元/份', is_campus_food: true },
      { title: '米饭', source: 'public_food_library', source_id: 'rice', price: 2, price_unit: '元/份', is_campus_food: true },
    ]
    await act(async () => {
      callbacks.onDietResult({ recommendation: {
        scene: 'eat_out', title: '整餐建议', summary: '按记录份量合计', generated_by: 'qwen3.8-flash', ai_used: true,
        calorie_remaining: 600, macro_gaps: { calories: 600, protein: 40, carbs: 80, fat: 20 },
        recommendations: [{ title: '蒸鸡肉 + 米饭', source: 'meal_plan', source_id: 'meal:test', calories: 440,
          protein: 34, carbs: 50, fat: 12, price: 14, price_unit: '元/餐', items: [], meal_components: components }],
      } })
      callbacks.onDone({ session_id: 'composed-meal-session' })
    })
    await act(async () => { fireEvent.click(screen.getByText(/查看组合中的菜品/)) })
    expect(choose).toHaveBeenCalledWith({ itemList: ['蒸鸡肉', '米饭'] })
    expect(Taro.navigateTo).toHaveBeenCalledWith({ url: '/packageExtra/pages/food-library-detail/index?id=rice&scene=campus' })
    ;(Taro.navigateTo as jest.Mock).mockClear()
    choose.mockRejectedValueOnce(new Error('cancel'))
    await act(async () => { fireEvent.click(screen.getByText(/查看组合中的菜品/)) })
    expect(Taro.navigateTo).not.toHaveBeenCalled()
  })

  it('keeps the home meal advice visible and appends a training context before sending', () => {
    ;(Taro.useLoad as jest.Mock).mockImplementation((callback: (options: Record<string, string>) => void) => callback({
      entry: 'home_next_meal',
      date: '2026-09-26',
      meal_type: 'lunch',
      meal_label: encodeURIComponent('午餐'),
      advice: encodeURIComponent('优先补蛋白，搭配适量主食'),
      starter: encodeURIComponent('今天午餐吃什么？'),
    }))

    render(<PetChatPage />)

    expect(screen.getByText('来自首页 · 下一餐建议')).toBeInTheDocument()
    expect(screen.getByText('基础建议：优先补蛋白，搭配适量主食')).toBeInTheDocument()
    expect(screen.getAllByLabelText('宠物头像')).toHaveLength(1)

    fireEvent.click(screen.getByText('刚训练完'))
    expect(screen.getByRole('textbox')).toHaveValue('今天午餐吃什么？ 补充：刚训练完')
    fireEvent.click(screen.getByText('发送'))

    expect(streamGeneratePetChat).toHaveBeenCalledWith(
      '今天午餐吃什么？ 补充：刚训练完',
      'week',
      '',
      true,
      expect.any(Object),
      false,
      [],
      {
        source: 'home_next_meal',
        date: '2026-09-26',
        meal_type: 'lunch',
        meal_label: '午餐',
        basic_advice: '优先补蛋白，搭配适量主食',
      },
      undefined,
    )
  })
})
