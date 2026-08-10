import { fireEvent, render } from '@testing-library/react'
import Taro from '@tarojs/taro'
import { GreetingSection } from '../../src/pages/index/components/GreetingSection'
import { openPetChat, openPetSettings } from '../../src/utils/pet-navigation'

describe('pet navigation', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(Taro.getCurrentPages as jest.Mock).mockReturnValue([])
  })

  it('opens pet chat when the user taps the pet in the home greeting', () => {
    const { container } = render(
      <GreetingSection
        mode='balanced'
        onModeToggle={jest.fn()}
        petAvatar={<span>宠物头像</span>}
        onPetPress={openPetChat}
      />,
    )

    fireEvent.click(container.querySelector('#home-greeting-pet') as Element)

    expect(Taro.navigateTo).toHaveBeenCalledWith({
      url: '/packageExtra/pages/pet-chat/index',
    })
  })

  it('returns to pet settings without stacking it when it is already the previous page', () => {
    ;(Taro.getCurrentPages as jest.Mock).mockReturnValue([
      { route: 'pages/index/index' },
      { route: 'packageExtra/pages/pet-home/index' },
      { route: 'packageExtra/pages/pet-chat/index' },
    ])

    openPetSettings()

    expect(Taro.navigateBack).toHaveBeenCalledWith({ delta: 1 })
    expect(Taro.navigateTo).not.toHaveBeenCalled()
  })

  it('returns to pet chat without stacking it when it is already the previous page', () => {
    ;(Taro.getCurrentPages as jest.Mock).mockReturnValue([
      { route: 'pages/index/index' },
      { route: 'packageExtra/pages/pet-chat/index' },
      { route: 'packageExtra/pages/pet-home/index' },
    ])

    openPetChat()

    expect(Taro.navigateBack).toHaveBeenCalledWith({ delta: 1 })
    expect(Taro.navigateTo).not.toHaveBeenCalled()
  })
})
