import { act, render, screen, waitFor } from '@testing-library/react'
import Taro from '@tarojs/taro'
import PetChatPage from '../../src/packageExtra/pages/pet-chat/index'
import { getLatestPetChatSession, getPetSummary, getStatsSummary } from '../../src/utils/api'

jest.mock('../../src/utils/withAuth', () => ({
  withAuth: (Component: any) => Component,
}))

jest.mock('../../src/utils/api', () => ({
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

describe('pet chat latest message', () => {
  let didShow: (() => void) | undefined

  beforeEach(() => {
    jest.clearAllMocks()
    didShow = undefined
    ;(Taro.useDidShow as jest.Mock).mockImplementation((callback: () => void) => {
      didShow = callback
    })
    ;(Taro as typeof Taro & { setNavigationBarTitle: jest.Mock }).setNavigationBarTitle = jest.fn()
    ;(getStatsSummary as jest.Mock).mockResolvedValue({ range: 'week' })
    ;(getPetSummary as jest.Mock).mockResolvedValue({ pet: { name: '团团' } })
    ;(getLatestPetChatSession as jest.Mock).mockResolvedValue({
      session: { id: 'session-1', range_type: 'week' },
      messages: [
        { id: 'message-old', role: 'user', content: '较早的问题' },
        { id: 'message-latest', role: 'assistant', content: '最近的回答' },
      ],
    })
  })

  it('anchors the conversation to the newest message after history loads', async () => {
    const { container } = render(<PetChatPage />)

    await act(async () => {
      didShow?.()
    })

    expect(await screen.findByText('最近的回答')).toBeInTheDocument()
    const scrollView = container.querySelector('.pet-chat-scroll')
    const latestMessage = container.querySelector('#pet-chat-message-message-latest')

    expect(latestMessage).toHaveTextContent('最近的回答')
    await waitFor(() => {
      expect(scrollView).toHaveAttribute('scrollintoview', 'pet-chat-message-message-latest')
    })
  })
})
