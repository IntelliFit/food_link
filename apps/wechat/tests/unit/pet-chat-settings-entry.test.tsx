import { fireEvent, render, screen } from '@testing-library/react'
import Taro from '@tarojs/taro'
import PetChatPage from '../../src/packageExtra/pages/pet-chat/index'

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

describe('pet chat settings entry', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(Taro.useDidShow as jest.Mock).mockImplementation(() => {})
    ;(Taro.getCurrentPages as jest.Mock).mockReturnValue([])
    ;(Taro as typeof Taro & { setNavigationBarTitle: jest.Mock }).setNavigationBarTitle = jest.fn()
  })

  it('opens pet settings from the pet identity without showing extra labels', () => {
    const { container } = render(<PetChatPage />)

    expect(screen.queryByText(/宠物设置/)).not.toBeInTheDocument()
    expect(screen.queryByText('饮食与训练陪伴助手')).not.toBeInTheDocument()
    fireEvent.click(container.querySelector('.pet-chat-identity') as Element)

    expect(Taro.navigateTo).toHaveBeenCalledWith({
      url: '/packageExtra/pages/pet-home/index',
    })
  })
})
