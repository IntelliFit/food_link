import * as React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { BalancedThemeExperience } from '../../src/components/BalancedThemeExperience'
import { BALANCED_THEME_IDS, type BalancedThemeId } from '../../src/utils/balanced-theme'
import { loadBalancedScenes } from '../../src/utils/balanced-theme-scenes'

let mockTheme: BalancedThemeId = 'clarity-order'
let mockWellness = false
jest.mock('../../src/components/BalancedThemeContext', () => ({ useBalancedTheme: () => ({ theme: mockTheme }) }))
jest.mock('../../src/components/InkWellness', () => ({ useInkWellness: () => mockWellness }))
jest.mock('../../src/utils/balanced-theme-scenes', () => ({
  BALANCED_SCENES: { miniatureGarden: '/garden.webp', waterVessel: '/water.webp' },
  loadBalancedScenes: jest.fn().mockResolvedValue(undefined),
}))
const home = { date: '2026-09-28', mealCount: 2, waterMl: 850, calories: 1024, authenticated: true, loading: false }
beforeEach(() => { mockWellness = false; mockTheme = 'clarity-order'; jest.clearAllMocks(); (loadBalancedScenes as jest.Mock).mockResolvedValue(undefined) })

describe('balanced theme live experiences', () => {
  it.each(BALANCED_THEME_IDS)('%s opens the actual record action instead of cycling a visual stage', async theme => {
    mockTheme = theme
    const onRecord = jest.fn()
    const { container } = render(<BalancedThemeExperience surface='home' home={home} onRecord={onRecord} />)
    fireEvent.click(container.querySelector('#bt-action-record')!)
    expect(onRecord).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(screen.queryByText('场景未能打开，轻触重试')).not.toBeInTheDocument())
  })
  it('updates metric values from the page and hides cached data for a guest', () => {
    const { rerender } = render(<BalancedThemeExperience surface='home' home={home} />)
    expect(screen.getByText('850 ml')).toBeInTheDocument()
    rerender(<BalancedThemeExperience surface='home' home={{ ...home, waterMl: 1100 }} />)
    expect(screen.getByText('1100 ml')).toBeInTheDocument()
    rerender(<BalancedThemeExperience surface='home' home={{ ...home, authenticated: false }} />)
    expect(screen.queryByText('850 ml')).not.toBeInTheDocument()
    expect(screen.getAllByText('登录后记录')).toHaveLength(3)
  })
  it('shows no pretend social authors or counters and delegates publishing', () => {
    const onPublish = jest.fn()
    const { container } = render(<BalancedThemeExperience surface='community' onPublish={onPublish} />)
    fireEvent.click(container.querySelector('#bt-action-publish')!)
    expect(onPublish).toHaveBeenCalledTimes(1)
    expect(container.textContent).not.toMatch(/王阿姨|128|张建国|70岁/)
  })
  it('retries a failed scene download without blocking core actions', async () => {
    mockTheme = 'miniature-world'
    ;(loadBalancedScenes as jest.Mock).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(undefined)
    const onRecord = jest.fn()
    const { container } = render(<BalancedThemeExperience surface='home' home={home} onRecord={onRecord} />)
    await screen.findByText('场景未能打开，轻触重试')
    fireEvent.click(container.querySelector('#bt-action-record')!)
    expect(onRecord).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByText('场景未能打开，轻触重试'))
    await waitFor(() => expect(screen.queryByText('场景未能打开，轻触重试')).not.toBeInTheDocument())
  })
  it('leaves the exclusive wellness mode untouched', () => {
    mockWellness = true
    const { container } = render(<BalancedThemeExperience surface='home' home={home} />)
    expect(container).toBeEmptyDOMElement()
    expect(loadBalancedScenes).not.toHaveBeenCalled()
  })
})
