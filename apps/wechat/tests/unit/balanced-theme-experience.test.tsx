import * as React from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { BalancedThemeExperience } from '../../src/components/BalancedThemeExperience'
import { BALANCED_THEME_IDS, type BalancedThemeId } from '../../src/utils/balanced-theme'
import { loadBalancedScenes, reportBalancedSceneImageError, retryBalancedScenes } from '../../src/utils/balanced-theme-scenes'
import easternProfileGold from '../../src/assets/balanced-themes/eastern-profile-gold-v11.webp'

let mockTheme: BalancedThemeId = 'clarity-order'
let mockWellness = false
jest.mock('../../src/assets/balanced-themes/eastern-profile-gold-v11.webp', () => ({ __esModule: true, default: '/eastern-profile-gold.webp' }))
jest.mock('../../src/components/BalancedThemeContext', () => ({ useBalancedTheme: () => ({ theme: mockTheme }) }))
jest.mock('../../src/components/InkWellness', () => ({ useInkWellness: () => mockWellness }))
jest.mock('../../src/utils/balanced-theme-scenes', () => {
  const loadBalancedScenes = jest.fn().mockResolvedValue(undefined)
  let revision = 0
  const listeners = new Set<(revision: number, imageError?: boolean, detail?: string) => void>()
  return {
  BALANCED_SCENES: { miniatureGarden: '/garden.webp', waterVessel: '/water.webp', miniatureProfile: '/miniature-profile.webp', picturebookProfile: '/picturebook-profile.webp', galleryProfile: '/gallery-profile.webp' },
    loadBalancedScenes,
    retryBalancedScenes: () => loadBalancedScenes().then(() => { revision += 1; listeners.forEach(listener => listener(revision)) }),
    getBalancedScenesRevision: () => revision,
    subscribeBalancedScenes: (listener: (revision: number, imageError?: boolean, detail?: string) => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    reportBalancedSceneImageError: (detail?: string) => listeners.forEach(listener => listener(revision, true, detail)),
  }
})
const home = { date: '2026-09-28', mealCount: 2, waterMl: 850, calories: 1024, authenticated: true, loading: false }
beforeEach(() => { mockWellness = false; mockTheme = 'clarity-order'; jest.clearAllMocks(); (loadBalancedScenes as jest.Mock).mockResolvedValue(undefined) })

describe('balanced theme live experiences', () => {
  it('shows the native error only in development diagnostics and preserves the retry action', async () => {
    const globals = globalThis as unknown as { __ENABLE_DEV_DEBUG_UI__?: boolean }
    const previous = globals.__ENABLE_DEV_DEBUG_UI__
    globals.__ENABLE_DEV_DEBUG_UI__ = true
    try {
      mockTheme = 'miniature-world'
      const { rerender } = render(<BalancedThemeExperience surface='home' home={home} />)
      await waitFor(() => expect(screen.queryByText('场景未能打开，轻触重试')).not.toBeInTheDocument())
      act(() => reportBalancedSceneImageError('组件下载：loadSubpackage: fail'))
      expect(screen.getByText(/诊断 S3｜组件下载：loadSubpackage: fail/)).toBeInTheDocument()
      globals.__ENABLE_DEV_DEBUG_UI__ = false
      rerender(<BalancedThemeExperience surface='home' home={home} />)
      expect(screen.queryByText(/诊断 S3/)).not.toBeInTheDocument()
      expect(screen.getByText('场景未能打开，轻触重试')).toBeInTheDocument()
    } finally {
      if (previous === undefined) delete globals.__ENABLE_DEV_DEBUG_UI__
      else globals.__ENABLE_DEV_DEBUG_UI__ = previous
    }
  })
  it.each(BALANCED_THEME_IDS)('%s keeps its intended home actions usable', async theme => {
    mockTheme = theme
    const onRecord = jest.fn()
    const onMeals = jest.fn()
    const onWater = jest.fn()
    const { container } = render(<BalancedThemeExperience surface='home' home={home} onRecord={onRecord} onMeals={onMeals} onWater={onWater} />)
    if (theme === 'way-of-water') {
      expect(container.querySelector('#bt-action-record')).not.toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: '查看今日饮食记录' }))
      fireEvent.click(screen.getByRole('button', { name: '记录今日饮水' }))
      expect(onMeals).toHaveBeenCalledTimes(1)
      expect(onWater).toHaveBeenCalledTimes(1)
    } else {
      fireEvent.click(container.querySelector('#bt-action-record')!)
      expect(onRecord).toHaveBeenCalledTimes(1)
    }
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
  it('does not render the retired floating water publishing action', async () => {
    mockTheme = 'way-of-water'
    const onPublish = jest.fn()
    const onRecord = jest.fn()
    const { container } = render(<BalancedThemeExperience surface='community' onPublish={onPublish} onRecord={onRecord} />)
    expect(container.querySelector('#bt-action-publish')).not.toBeInTheDocument()
    expect(onPublish).not.toHaveBeenCalled()
    expect(onRecord).not.toHaveBeenCalled()
    await waitFor(() => expect(screen.queryByText('场景未能打开，轻触重试')).not.toBeInTheDocument())
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
  it('keeps profile content usable through a failed portrait and remounts its retry', async () => {
    mockTheme = 'modern-gallery'
    const openProfile = jest.fn()
    const { container } = render(<BalancedThemeExperience surface='profile'><button onClick={openProfile}>当前用户资料</button></BalancedThemeExperience>)
    await waitFor(() => expect(container.querySelector('.bt-profile-backdrop')).toBeInTheDocument())
    const firstImage = container.querySelector('.bt-profile-backdrop')!
    const hero = container.querySelector('#balanced-theme-experience-profile')!
    expect(hero).not.toHaveClass('bt-profile-art--loaded')
    fireEvent.load(firstImage)
    expect(hero).toHaveClass('bt-profile-art--loaded')
    fireEvent.error(firstImage)
    expect(hero).not.toHaveClass('bt-profile-art--loaded')
    fireEvent.click(screen.getByText('当前用户资料'))
    expect(openProfile).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByText('场景未能打开，轻触重试'))
    await waitFor(() => expect(screen.queryByText('场景未能打开，轻触重试')).not.toBeInTheDocument())
    const retryImage = container.querySelector('.bt-profile-backdrop')!
    expect(retryImage).not.toBe(firstImage)
    fireEvent.load(retryImage)
    expect(hero).toHaveClass('bt-profile-art--loaded')
  })
  it('shows bundled eastern profile art even when the separate scene package fails', async () => {
    mockTheme = 'eastern-salon'
    ;(loadBalancedScenes as jest.Mock).mockRejectedValueOnce(new Error('offline'))
    const { container } = render(<BalancedThemeExperience surface='profile'><button>当前用户资料</button></BalancedThemeExperience>)
    expect(container.querySelector('.bt-profile-backdrop')).toHaveAttribute('src', easternProfileGold)
    await screen.findByText('场景未能打开，轻触重试')
    expect(container.querySelector('.bt-profile-backdrop')).toHaveAttribute('src', easternProfileGold)
  })
  it('requires a fresh decoded portrait after another consumer starts a shared retry', async () => {
    mockTheme = 'modern-gallery'
    const { container } = render(<BalancedThemeExperience surface='profile'><button>当前用户资料</button></BalancedThemeExperience>)
    await waitFor(() => expect(container.querySelector('.bt-profile-backdrop')).toBeInTheDocument())
    const firstImage = container.querySelector('.bt-profile-backdrop')!
    const hero = container.querySelector('#balanced-theme-experience-profile')!
    fireEvent.load(firstImage)
    expect(hero).toHaveClass('bt-profile-art--loaded')
    await act(async () => { await retryBalancedScenes() })
    expect(hero).not.toHaveClass('bt-profile-art--loaded')
    const nextImage = container.querySelector('.bt-profile-backdrop')!
    expect(nextImage).not.toBe(firstImage)
    fireEvent.load(nextImage)
    expect(hero).toHaveClass('bt-profile-art--loaded')
  })
  it('keeps the real profile actions usable when embedded in a scene or switched to wellness', async () => {
    mockTheme = 'miniature-world'
    const login = jest.fn()
    const content = <button onClick={login}>真实资料入口</button>
    const { rerender } = render(<BalancedThemeExperience surface='profile'>{content}</BalancedThemeExperience>)
    fireEvent.click(screen.getByText('真实资料入口'))
    expect(login).toHaveBeenCalledTimes(1)
    mockWellness = true
    rerender(<BalancedThemeExperience surface='profile'>{content}</BalancedThemeExperience>)
    fireEvent.click(screen.getByText('真实资料入口'))
    expect(login).toHaveBeenCalledTimes(2)
    expect(screen.queryByText('旅行者档案')).not.toBeInTheDocument()
    await waitFor(() => expect(screen.getByText('真实资料入口')).toBeInTheDocument())
  })
  it('replaces the profile portrait on the same page and removes it in water and wellness without losing live actions', async () => {
    mockTheme = 'miniature-world'
    const openProfile = jest.fn()
    const content = <button onClick={openProfile}>当前用户资料</button>
    const { container, rerender } = render(<BalancedThemeExperience surface='profile'>{content}</BalancedThemeExperience>)
    await waitFor(() => expect(container.querySelector('.bt-profile-backdrop')).toHaveAttribute('src', '/miniature-profile.webp'))
    for (const [theme, asset] of [['picturebook-companion', '/picturebook-profile.webp'], ['modern-gallery', '/gallery-profile.webp'], ['eastern-salon', easternProfileGold]] as const) {
      mockTheme = theme
      rerender(<BalancedThemeExperience surface='profile'>{content}</BalancedThemeExperience>)
      await waitFor(() => expect(container.querySelectorAll('.bt-profile-backdrop')).toHaveLength(1))
      expect(container.querySelector('.bt-profile-backdrop')).toHaveAttribute('src', asset)
      fireEvent.click(screen.getByText('当前用户资料'))
    }
    mockTheme = 'way-of-water'
    rerender(<BalancedThemeExperience surface='profile'>{content}</BalancedThemeExperience>)
    expect(container.querySelector('.bt-profile-backdrop')).not.toBeInTheDocument()
    mockWellness = true
    rerender(<BalancedThemeExperience surface='profile'>{content}</BalancedThemeExperience>)
    expect(container.querySelector('.bt-profile-backdrop')).not.toBeInTheDocument()
    fireEvent.click(screen.getByText('当前用户资料'))
    expect(openProfile).toHaveBeenCalledTimes(4)
  })
})
