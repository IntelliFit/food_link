import { act, fireEvent, render, screen } from '@testing-library/react'
import Taro from '@tarojs/taro'
import PetChatPage from '../../src/packageExtra/pages/pet-chat/index'
import { estimatePetChat, streamGeneratePetChat } from '../../src/utils/api'

jest.mock('../../src/utils/withAuth', () => ({
  withAuth: (Component: any) => Component,
}))

jest.mock('../../src/utils/api', () => ({
  estimatePetChat: jest.fn(),
  getPetChatSession: jest.fn(),
  getLatestPetChatSession: jest.fn(),
  getPetSummary: jest.fn(),
  getStatsSummary: jest.fn(),
  listPetChatSessions: jest.fn(),
  showUnifiedApiError: jest.fn(),
  streamGeneratePetChat: jest.fn(),
  updateHealthProfile: jest.fn(),
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
    ;(Taro.useDidShow as jest.Mock).mockImplementation(() => {})
    ;(Taro as typeof Taro & { setNavigationBarTitle: jest.Mock }).setNavigationBarTitle = jest.fn()
    ;(estimatePetChat as jest.Mock).mockResolvedValue({ pricing: { credits_charged: 3 } })
  })

  afterEach(() => {
    jest.useRealTimers()
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

    expect(estimatePetChat).toHaveBeenCalledWith('推荐食谱', 'week', false)
    expect(screen.getByText('预计消耗 3 积分')).toBeInTheDocument()

    fireEvent.click(screen.getByText('发送'))
    expect(streamGeneratePetChat).toHaveBeenCalledWith(
      '推荐食谱',
      'week',
      '',
      true,
      expect.any(Object),
      false,
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

    expect(estimatePetChat).toHaveBeenCalledWith('推荐食谱', 'week', true)
    fireEvent.click(screen.getByText('发送'))
    expect(streamGeneratePetChat).toHaveBeenCalledWith(
      '推荐食谱',
      'week',
      '',
      true,
      expect.any(Object),
      true,
    )
  })

  it('renders Agent progress and five evidence-backed campus cards from the unified stream', async () => {
    render(<PetChatPage />)

    fireEvent.click(screen.getByText('今天吃什么'))
    expect(screen.getByText('预计消耗 1 积分')).toBeInTheDocument()
    fireEvent.click(screen.getByText('发送'))

    const callbacks = (streamGeneratePetChat as jest.Mock).mock.calls[0][4]
    const recommendations = Array.from({ length: 5 }, (_, index) => ({
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
          generated_by: 'qwen3.6-flash',
          ai_used: true,
          ai_rerank_count: 20,
          resolved_school: { id: 'thu-id', name: '清华大学' },
        },
      })
      callbacks.onChunk('我调用工具核对了真实菜品。')
      callbacks.onDone({ session_id: 'session-campus' })
    })

    expect(screen.getByText('真实校园食物库 · Agent 工具核对 20 道')).toBeInTheDocument()
    expect(screen.getByText('校园菜1')).toBeInTheDocument()
    expect(screen.getByText('校园菜5')).toBeInTheDocument()
    expect(screen.getByText('≈286 kcal')).toBeInTheDocument()
    expect(screen.getByText('库内估算 · 份量 183g · 视觉估重 · 置信度 68%')).toBeInTheDocument()
  })
})
