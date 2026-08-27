import { act, render, screen, waitFor } from '@testing-library/react'
import Taro from '@tarojs/taro'
import PetHomePage from '../../src/packageExtra/pages/pet-home/index'
import { getPetSummary } from '../../src/utils/api'

jest.mock('../../src/utils/withAuth', () => ({
  withAuth: (Component: any) => Component,
}))

jest.mock('../../src/utils/api', () => ({
  claimPetEvent: jest.fn(),
  customizePetPixelAvatar: jest.fn(),
  getPetSummary: jest.fn(),
  selectPetAppearance: jest.fn(),
  showUnifiedApiError: jest.fn(),
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

jest.mock('../../src/utils/weapp-privacy', () => ({
  chooseImageWithPrivacy: jest.fn(),
  isPrivacyAuthorizeError: jest.fn(),
  showPrivacyAuthorizeFailure: jest.fn(),
}))

describe('pet home appearance actions', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(Taro.useDidShow as jest.Mock).mockImplementation(() => {})
  })

  it('does not offer the retired random appearance action', () => {
    render(<PetHomePage />)

    expect(screen.getByText('专属像素分身')).toBeInTheDocument()
    expect(screen.getByText('首页成长伙伴')).toBeInTheDocument()
    expect(screen.queryByText('随机换外观')).not.toBeInTheDocument()
  })

  it('shows pet experience instead of membership credits', async () => {
    let didShowCallback: (() => void) | undefined
    ;(Taro.useDidShow as jest.Mock).mockImplementation((callback: () => void) => {
      didShowCallback = callback
    })
    ;(getPetSummary as jest.Mock).mockResolvedValue({
      pet: {
        id: 'pet-1',
        name: '豆豆',
        level: 1,
        experience: 88,
        level_exp: 88,
        next_level_exp: 100,
        level_progress: 88,
        total_events: 7,
        selection_candidates: [],
      },
      status: {},
      today: {},
      rewards: {},
    })

    render(<PetHomePage />)
    act(() => didShowCallback?.())

    await waitFor(() => expect(screen.getAllByText('88')).toHaveLength(1))
    expect(screen.getByText('经验')).toBeInTheDocument()
    expect(screen.queryByText('积分')).not.toBeInTheDocument()
  })
})
