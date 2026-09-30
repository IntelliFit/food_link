import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import Taro from '@tarojs/taro'
import StatsPage from '../../src/pages/stats'

jest.mock('../../src/components/InkWellness', () => ({ useInkWellness: () => false }))
jest.mock('../../src/components/BalancedThemeExperience', () => ({ BalancedThemeExperience: () => null }))
jest.mock('../../src/components/ThemeDailyReview', () => ({ ThemeDailyReview: () => null }))
jest.mock('../../src/components/BalancedThemeContext', () => ({ useBalancedTheme: () => ({ theme: 'way-of-water' }) }))
jest.mock('../../src/components/AppColorSchemeContext', () => ({ useAppColorScheme: () => ({ scheme: 'light' }) }))
jest.mock('../../src/utils/withAuth', () => ({ withAuth: (page: unknown) => page, redirectToLogin: jest.fn() }))

it('keeps all analysis panels accessible to guests without fetching personal data', () => {
  ;(Taro.getStorageSync as jest.Mock).mockReturnValue('')
  const { container } = render(<StatsPage />)
  expect(screen.getByText('浏览分析示例')).toBeInTheDocument()
  const tabs = container.querySelectorAll('.segment-item')
  expect(Array.from(tabs).map(tab => tab.textContent)).toEqual(['健康指数', 'AI方案', '热量分布'])
  fireEvent.click(tabs[0])
  expect(container.querySelector('.analysis-panel-content.is-active .risk-overview-card')).toBeInTheDocument()
  fireEvent.click(tabs[2])
  expect(container.querySelector('.analysis-panel-content.is-active')?.textContent).toContain('热量分布界面示例')
  fireEvent.click(tabs[1])
  expect(container.querySelector('.analysis-panel-content.is-active')?.textContent).toContain('AI 方案界面示例')
  expect(Taro.request).not.toHaveBeenCalled()
})
