import { act, render } from '@testing-library/react'
import Taro from '@tarojs/taro'
import { PetActor } from '../../src/components/PetActor'
import { PetAvatar } from '../../src/components/PetAvatar'

const photo = {
  id: 'photo-one', name: '我的照片伙伴', avatar_type: 'pixel_self' as const,
  pixel_avatar_url: 'https://avatar.example.com/photo-one-idle.png',
  pixel_avatar_blink_url: 'https://avatar.example.com/photo-one-blink.png',
  pixel_avatar_squash_url: 'https://avatar.example.com/photo-one-squash.png',
  pixel_avatar_jump_url: 'https://avatar.example.com/photo-one-jump.png',
}
const replacement = {
  ...photo, id: 'photo-two', name: '另一位照片伙伴',
  pixel_avatar_url: 'https://avatar.example.com/photo-two-idle.png',
  pixel_avatar_blink_url: 'https://avatar.example.com/photo-two-blink.png',
  pixel_avatar_squash_url: 'https://avatar.example.com/photo-two-squash.png',
  pixel_avatar_jump_url: 'https://avatar.example.com/photo-two-jump.png',
}
beforeEach(() => {
  jest.clearAllMocks(); jest.useFakeTimers()
  ;(Taro.getStorageSync as jest.Mock).mockImplementation(key => key === 'user_id' ? 'photo-owner' : '')
})
afterEach(() => jest.useRealTimers())
function wait(ms: number) { act(() => { jest.advanceTimersByTime(ms) }) }
function avatar(container: HTMLElement) { return container.querySelector('.pet-avatar')! }

test('a paused photo actor cancels an in-flight blink, stays on its own idle image and resumes only when active', () => {
  const { container, rerender, unmount } = render(<PetActor pet={photo} action='idle' active />)
  expect(container.querySelector('.pet-avatar__image')).toHaveAttribute('src', photo.pixel_avatar_url)
  wait(900)
  expect(avatar(container)).toHaveClass('pet-avatar--blinking')
  rerender(<PetActor pet={photo} action='idle' active={false} />)
  expect(container.querySelector('.pet-actor')).toHaveClass('pet-actor--paused')
  expect(avatar(container)).not.toHaveClass('pet-avatar--blinking')
  expect(jest.getTimerCount()).toBe(0)
  wait(30000)
  expect(avatar(container)).not.toHaveClass('pet-avatar--blinking')
  expect(container.querySelector('.pet-avatar__image')).toHaveAttribute('src', photo.pixel_avatar_url)
  rerender(<PetActor pet={photo} action='idle' active />)
  wait(899); expect(avatar(container)).not.toHaveClass('pet-avatar--blinking')
  wait(1); expect(avatar(container)).toHaveClass('pet-avatar--blinking')
  unmount(); expect(jest.getTimerCount()).toBe(0)
})

test('switching a paused photo actor replaces all old frames without restarting the old identity timer', () => {
  const { container, rerender, unmount } = render(<PetActor pet={photo} active />)
  wait(900)
  rerender(<PetActor pet={photo} active={false} />)
  rerender(<PetActor pet={replacement} active={false} />)
  expect(container.querySelector('.pet-actor')).toHaveAttribute('aria-label', '另一位照片伙伴，idle')
  expect(container.querySelector('.pet-avatar__image')).toHaveAttribute('src', replacement.pixel_avatar_url)
  expect(container.querySelector('.pet-avatar__frame--blink')).toHaveAttribute('src', replacement.pixel_avatar_blink_url)
  expect(container.querySelector(`img[src='${photo.pixel_avatar_url}']`)).not.toBeInTheDocument()
  expect(container.querySelector(`img[src='${photo.pixel_avatar_blink_url}']`)).not.toBeInTheDocument()
  expect(container.querySelector(`img[src='${photo.pixel_avatar_squash_url}']`)).not.toBeInTheDocument()
  expect(container.querySelector(`img[src='${photo.pixel_avatar_jump_url}']`)).not.toBeInTheDocument()
  wait(30000); expect(jest.getTimerCount()).toBe(0)
  rerender(<PetActor pet={replacement} active />)
  wait(900); expect(avatar(container)).toHaveClass('pet-avatar--blinking')
  unmount(); expect(jest.getTimerCount()).toBe(0)
})

test('unsupported photo actions and paused supported jumps retain that same character instead of substituting a template', () => {
  const { container, rerender } = render(<PetActor pet={photo} action='cook' showStatus active={false} />)
  expect(container.querySelector('.pet-actor__status')).toHaveTextContent('这套形象暂未提供此动作')
  expect(container.querySelector('.pet-avatar__image')).toHaveAttribute('src', photo.pixel_avatar_url)
  expect(container.querySelector('.pet-actor__sheet')).not.toBeInTheDocument()
  expect(jest.getTimerCount()).toBe(0)
  rerender(<PetActor pet={photo} action='jump' active />)
  expect(container.querySelector('.pet-actor__custom')).toHaveAttribute('src', photo.pixel_avatar_jump_url)
  rerender(<PetActor pet={photo} action='jump' active={false} />)
  expect(container.querySelector('.pet-actor__custom')).not.toBeInTheDocument()
  expect(container.querySelector('.pet-avatar__image')).toHaveAttribute('src', photo.pixel_avatar_url)
  expect(jest.getTimerCount()).toBe(0)
})

test('the default Avatar retains its existing blink and companion hop schedule', () => {
  const { container, unmount } = render(<PetAvatar pet={photo} motion='companion' />)
  expect(jest.getTimerCount()).toBe(2)
  wait(900); expect(avatar(container)).toHaveClass('pet-avatar--blinking')
  wait(170); expect(avatar(container)).not.toHaveClass('pet-avatar--blinking')
  wait(330); expect(avatar(container)).toHaveClass('pet-avatar--motion-squash')
  wait(110); expect(avatar(container)).toHaveClass('pet-avatar--motion-jump')
  unmount(); expect(jest.getTimerCount()).toBe(0)
})

test('explicitly suspending Avatar during a hop resets its frame and cancels both animation timers', () => {
  const { container, rerender, unmount } = render(<PetAvatar pet={photo} motion='companion' />)
  wait(1510); expect(avatar(container)).toHaveClass('pet-avatar--motion-jump')
  rerender(<PetAvatar pet={photo} motion='companion' active={false} />)
  for (const name of ['pet-avatar--motion-jump', 'pet-avatar--motion-squash', 'pet-avatar--blinking']) expect(avatar(container)).not.toHaveClass(name)
  expect(jest.getTimerCount()).toBe(0)
  wait(30000)
  for (const name of ['pet-avatar--motion-jump', 'pet-avatar--motion-squash', 'pet-avatar--blinking']) expect(avatar(container)).not.toHaveClass(name)
  unmount(); expect(jest.getTimerCount()).toBe(0)
})
