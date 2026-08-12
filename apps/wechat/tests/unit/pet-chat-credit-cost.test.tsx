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

    expect(estimatePetChat).toHaveBeenCalledWith('推荐食谱', 'week')
    expect(screen.getByText('预计消耗 3 积分')).toBeInTheDocument()

    fireEvent.click(screen.getByText('发送'))
    expect(streamGeneratePetChat).toHaveBeenCalledWith(
      '推荐食谱',
      'week',
      '',
      true,
      expect.any(Object),
    )
  })
})
