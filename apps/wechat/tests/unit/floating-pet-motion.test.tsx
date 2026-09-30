import * as React from 'react'
import { useDidShow } from '@tarojs/taro'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { FloatingPetAssistant } from '../../src/components/FloatingPetAssistant'
import { JIANWEN_COMPANION_SRC } from '../../src/utils/pet-companion-preference'

let mockWellness = false
jest.mock('../../src/components/InkWellness', () => ({ useInkWellness: () => mockWellness }))
jest.mock('../../src/utils/api', () => ({ getAccessToken: () => 'test-token' }))
jest.mock('../../src/utils/withAuth', () => ({ redirectToLogin: jest.fn() }))
jest.mock('../../src/components/PetChatContent', () => ({ PetChatContent: () => null }))

const advance = (ms: number) => act(() => { jest.advanceTimersByTime(ms) })
const mount = () => render(<FloatingPetAssistant companionSpriteOverride={JIANWEN_COMPANION_SRC} onChatOpenChange={jest.fn()} />)

beforeEach(() => {
  mockWellness = false
  jest.useFakeTimers()
  // Page visibility callbacks fire after mount in WeChat, not during React render.
  ;(useDidShow as jest.Mock).mockImplementation(() => undefined)
})
afterEach(() => { jest.useRealTimers() })

test('balanced companion rests between short gestures rather than constantly walking or kicking', () => {
  const { container } = mount()
  const pet = container.querySelector('#home-floating-pet')!
  advance(1200)
  expect(pet).toHaveClass('is-idle')
  expect(pet).not.toHaveClass('is-walking')
  advance(5200)
  expect(pet).toHaveClass('is-blink')
  advance(1200)
  expect(pet).toHaveClass('is-idle')
  advance(6500)
  expect(pet).toHaveClass('is-look')
})

test('a user kick finishes before another play can count and returns to idle', () => {
  const { container } = mount()
  const play = container.querySelector('#pet-assistant-daily-play')!
  fireEvent.click(play)
  fireEvent.click(play)
  expect(screen.getByText('1/3')).toBeInTheDocument()
  expect(container.querySelector('#home-floating-pet')).toHaveClass('is-kick')
  advance(1200)
  expect(container.querySelector('#home-floating-pet')).toHaveClass('is-idle')
  fireEvent.click(play)
  expect(screen.getByText('2/3')).toBeInTheDocument()
})

test('manual docking leaves a working recall button and does not return automatically', () => {
  const { container } = mount()
  fireEvent.click(screen.getByRole('button', { name: '暂时收起宠物' }))
  advance(980)
  expect(container.querySelector('#home-floating-pet')).toHaveClass('pet-assistant-float--docked')
  advance(5000)
  expect(container.querySelector('#home-floating-pet')).toHaveClass('pet-assistant-float--docked')
  fireEvent.click(screen.getByRole('button', { name: '叫回宠物' }))
  expect(container.querySelector('#home-floating-pet')).toHaveClass('pet-assistant-float--returning')
  advance(1800)
  expect(container.querySelector('#home-floating-pet')).toHaveClass('pet-assistant-float--playing')
})

test('wellness retains its existing movement cycle', () => {
  mockWellness = true
  const { container } = mount()
  expect(container.querySelector('.pet-assistant--refined-motion')).toBeNull()
  advance(1200)
  expect(container.querySelector('#home-floating-pet')).toHaveClass('is-walking')
})
