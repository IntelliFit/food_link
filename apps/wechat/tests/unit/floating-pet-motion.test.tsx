import * as React from 'react'
import Taro, { useDidShow } from '@tarojs/taro'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { FloatingPetAssistant } from '../../src/components/FloatingPetAssistant'
import { JIANWEN_COMPANION_SRC } from '../../src/utils/pet-companion-preference'
import type { PetProfile } from '../../src/utils/api'
import { PET_TRANSPORT_CHANGED, petTransportStorageKey } from '../../src/utils/pet-transport-storage'

let mockWellness = false
let mockDelayReady = false
let mockRigReady: (() => void) | undefined
let mockDelayHandoff = false
let mockPresented: (() => void) | undefined
let mockHandoffComplete: (() => void) | undefined
let mockDelayTravel = false
let mockTravelComplete: (() => void) | undefined
jest.mock('../../src/components/InkWellness', () => ({ useInkWellness: () => mockWellness }))
jest.mock('../../src/utils/api', () => ({ getAccessToken: () => 'test-token' }))
jest.mock('../../src/utils/withAuth', () => ({ redirectToLogin: jest.fn() }))
jest.mock('../../src/components/PetChatContent', () => ({ PetChatContent: () => null }))

const advance = (ms: number) => act(() => { jest.advanceTimersByTime(ms) })
const mount = () => render(<FloatingPetAssistant companionSpriteOverride={JIANWEN_COMPANION_SRC} onChatOpenChange={jest.fn()} />)
let storage: Map<string, unknown>
let listeners: Map<string, Set<() => void>>

beforeEach(() => {
  jest.clearAllMocks()
  Object.assign(Taro, { nextTick: jest.fn(callback => callback()) })
  Object.assign(Taro, { getWindowInfo: jest.fn(() => ({ windowWidth: 375, windowHeight: 667 })), hideKeyboard: jest.fn().mockResolvedValue(undefined), onKeyboardHeightChange: jest.fn(), offKeyboardHeightChange: jest.fn() })
  storage = new Map(); listeners = new Map()
  ;(Taro.getStorageSync as jest.Mock).mockImplementation(key => storage.get(key))
  ;(Taro.setStorageSync as jest.Mock).mockImplementation((key, value) => storage.set(key, value))
  ;(Taro.eventCenter.on as jest.Mock).mockImplementation((event, callback) => { if (!listeners.has(event)) listeners.set(event, new Set()); listeners.get(event)!.add(callback) })
  ;(Taro.eventCenter.off as jest.Mock).mockImplementation((event, callback) => listeners.get(event)?.delete(callback))
  mockWellness = false
  mockDelayReady = false; mockRigReady = undefined
  mockDelayHandoff = false; mockPresented = undefined; mockHandoffComplete = undefined
  mockDelayTravel = false; mockTravelComplete = undefined
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
  expect(container.querySelector('.pet-assistant-transport .pet-rig')).toHaveAttribute('data-motion', 'bicycle')
  expect(container.querySelector('.pet-assistant-transport .pet-rig')).not.toHaveClass('is-paused')
  expect(container.querySelector('.pet-assistant-rider-limbs')).toBeNull()
  expect(container.querySelector('.pet-assistant-rider-arms')).toBeNull()
  advance(980); fireEvent.transitionEnd(container.querySelector('#home-floating-pet')!)
  expect(container.querySelector('#home-floating-pet')).toHaveClass('pet-assistant-float--docked')
  advance(5000)
  expect(container.querySelector('#home-floating-pet')).toHaveClass('pet-assistant-float--docked')
  fireEvent.click(screen.getByRole('button', { name: '叫回宠物' }))
  expect(container.querySelector('#home-floating-pet')).toHaveClass('pet-assistant-float--returning')
  expect(container.querySelector('.pet-assistant-transport .pet-rig')).toHaveAttribute('data-motion', 'bicycle')
  advance(1800); fireEvent.animationEnd(container.querySelector('#home-floating-pet')!)
  expect(container.querySelector('#home-floating-pet')).toHaveClass('pet-assistant-float--playing')
})

test('wellness uses the same native ride handoff without the instant CSS vehicle', () => {
  mockWellness = true
  mockDelayHandoff = true
  const { container } = mount()
  expect(container.querySelector('.pet-assistant--wellness')).toHaveClass('pet-assistant--refined-motion')
  fireEvent.click(screen.getByRole('button', { name: '暂时收起宠物' }))
  expect(container.querySelector('#home-floating-pet')).toHaveClass('pet-assistant-float--boarding')
  expect(container.querySelector('.pet-assistant-ride')).toBeNull()
  act(() => mockPresented?.()); act(() => mockHandoffComplete?.())
  expect(container.querySelector('#home-floating-pet')).toHaveClass('pet-assistant-float--running')
})

test('a photo with no measured seated anchors uses its own walk and no borrowed bicycle or limbs', () => {
  const { container } = render(<FloatingPetAssistant pet={{ id: 'photo', name: '照片伙伴', pet_seed: 'photo', color: 'blue', shape: 'round', pattern: 'none', accessory: 'none', personality: 'gentle', level: 1, experience: 0, level_exp: 0, next_level_exp: 100, level_progress: 0, total_events: 0, avatar_type: 'pixel_self', pixel_avatar_url: 'photo.png', pixel_motion_version: 1, pixel_motion_atlas_url: 'photo-atlas.png' }} onChatOpenChange={jest.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: '暂时收起宠物' }))
  expect(container.querySelector('.pet-motion-atlas')).toHaveClass('pet-motion-atlas--walk')
  expect(container.querySelector('.pet-motion-atlas__sheet')).toHaveAttribute('src', 'photo-atlas.png')
  expect(container.querySelector('.pet-assistant-ride')).toBeNull()
  expect(container.querySelector('.pet-assistant-rider-arms')).toBeNull()
  expect(container.querySelector('.pet-assistant-rider-limbs')).toBeNull()
})
test.each(['scooter', 'skateboard'])('the confirmed %s is used for the actual departure and return', vehicle => {
  storage.set('user_id', 'a')
  storage.set(petTransportStorageKey('a', 'p', JIANWEN_COMPANION_SRC), { version: 1, appearance: JIANWEN_COMPANION_SRC, vehicle })
  const { container } = render(<FloatingPetAssistant pet={{ id: 'p', name: '健文', builtin_avatar_id: 'jianwen-01' } as PetProfile} companionSpriteOverride={JIANWEN_COMPANION_SRC} onChatOpenChange={jest.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: '暂时收起宠物' }))
  expect(container.querySelector('.pet-transport-actor')).toHaveAttribute('data-vehicle', vehicle)
  expect(container.querySelector('.pet-rig__source')).toHaveAttribute('src', JIANWEN_COMPANION_SRC)
  expect(container.querySelector('.pet-assistant-ride--fitted')).toBeNull()
  advance(980); fireEvent.transitionEnd(container.querySelector('#home-floating-pet')!)
  fireEvent.click(screen.getByRole('button', { name: '叫回宠物' }))
  expect(container.querySelector('.pet-transport-actor')).toHaveAttribute('data-vehicle', vehicle)
  advance(1800); fireEvent.animationEnd(container.querySelector('#home-floating-pet')!)
  expect(container.querySelector('.pet-assistant-transport')).toHaveClass('is-standby')
  expect(container.querySelector('.pet-transport-actor')).toHaveClass('is-paused')
})
test('changing preference mid-trip waits for the next trip instead of popping a different vehicle', () => {
  storage.set('user_id', 'a')
  const key = petTransportStorageKey('a', 'p', JIANWEN_COMPANION_SRC)
  storage.set(key, { version: 1, appearance: JIANWEN_COMPANION_SRC, vehicle: 'skateboard' })
  const { container } = render(<FloatingPetAssistant pet={{ id: 'p', name: '健文', builtin_avatar_id: 'jianwen-01' } as PetProfile} companionSpriteOverride={JIANWEN_COMPANION_SRC} onChatOpenChange={jest.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: '暂时收起宠物' }))
  storage.set(key, { version: 1, appearance: JIANWEN_COMPANION_SRC, vehicle: 'scooter' })
  act(() => { for (const callback of listeners.get(PET_TRANSPORT_CHANGED) || []) callback() })
  expect(container.querySelector('.pet-transport-actor')).toHaveAttribute('data-vehicle', 'skateboard')
  advance(980); fireEvent.transitionEnd(container.querySelector('#home-floating-pet')!)
  expect(container.querySelector('.pet-transport-actor')).toHaveAttribute('data-vehicle', 'skateboard')
  fireEvent.click(screen.getByRole('button', { name: '叫回宠物' }))
  expect(container.querySelector('.pet-transport-actor')).toHaveAttribute('data-vehicle', 'skateboard')
  advance(1800); fireEvent.animationEnd(container.querySelector('#home-floating-pet')!)
  expect(container.querySelector('.pet-transport-actor')).toHaveAttribute('data-vehicle', 'scooter')
  fireEvent.click(screen.getByRole('button', { name: '暂时收起宠物' }))
  expect(container.querySelector('.pet-transport-actor')).toHaveAttribute('data-vehicle', 'scooter')
})
test('a cold departure waits for the first painted vehicle and then reuses it through docking and recall', () => {
  mockDelayReady = true
  const { container } = mount()
  const transport = container.querySelector('.pet-assistant-transport .pet-rig')!
  fireEvent.click(screen.getByRole('button', { name: '暂时收起宠物' }))
  expect(container.querySelector('#home-floating-pet')).toHaveClass('pet-assistant-float--playing')
  expect(container.querySelector('.pet-assistant-transport')).toHaveAttribute('aria-hidden', 'true')
  act(() => mockRigReady?.())
  expect(container.querySelector('#home-floating-pet')).toHaveClass('pet-assistant-float--running')
  expect(container.querySelector('.pet-assistant-transport .pet-rig')).toBe(transport)
  advance(980); fireEvent.transitionEnd(container.querySelector('#home-floating-pet')!)
  expect(container.querySelector('.pet-assistant-transport .pet-rig')).toBe(transport)
  expect(transport).toHaveClass('is-paused')
  fireEvent.click(screen.getByRole('button', { name: '叫回宠物' }))
  expect(container.querySelector('.pet-assistant-transport .pet-rig')).toBe(transport)
  advance(1800); fireEvent.animationEnd(container.querySelector('#home-floating-pet')!)
  expect(container.querySelector('.pet-assistant-transport .pet-rig')).toBe(transport)
  expect(container.querySelector('.pet-assistant-transport')).toHaveClass('is-standby')
})

test('automatic recall completes the same vehicle round trip before preparing a new preference', () => {
  storage.set('user_id', 'a')
  const key = petTransportStorageKey('a', 'p', JIANWEN_COMPANION_SRC)
  storage.set(key, { version: 1, appearance: JIANWEN_COMPANION_SRC, vehicle: 'bicycle' })
  const ref = React.createRef<any>()
  const { container } = render(<FloatingPetAssistant ref={ref} pet={{ id: 'p', name: '健文', builtin_avatar_id: 'jianwen-01' } as PetProfile} companionSpriteOverride={JIANWEN_COMPANION_SRC} onChatOpenChange={jest.fn()} />)
  act(() => ref.current.onPageScroll(20))
  storage.set(key, { version: 1, appearance: JIANWEN_COMPANION_SRC, vehicle: 'scooter' })
  act(() => { for (const callback of listeners.get(PET_TRANSPORT_CHANGED) || []) callback() })
  advance(980); fireEvent.transitionEnd(container.querySelector('#home-floating-pet')!)
  expect(container.querySelector('.pet-transport-actor')).toHaveAttribute('data-vehicle', 'bicycle')
  advance(2140)
  expect(container.querySelector('#home-floating-pet')).toHaveClass('pet-assistant-float--returning')
  expect(container.querySelector('.pet-transport-actor')).toHaveAttribute('data-vehicle', 'bicycle')
  advance(1800); fireEvent.animationEnd(container.querySelector('#home-floating-pet')!)
  expect(container.querySelector('.pet-transport-actor')).toHaveAttribute('data-vehicle', 'scooter')
})

test('opening and closing chat retains the prepared transport instance and hides it directly', () => {
  const ref = React.createRef<any>()
  const { container } = render(<FloatingPetAssistant ref={ref} companionSpriteOverride={JIANWEN_COMPANION_SRC} onChatOpenChange={jest.fn()} />)
  const transport = container.querySelector('.pet-assistant-transport .pet-rig')!
  act(() => ref.current.openChat())
  expect(container.querySelector('.pet-assistant-transport .pet-rig')).toBe(transport)
  expect(transport).toHaveAttribute('data-visible', 'false')
  fireEvent.click(container.querySelector('#pet-assistant-chat-mask')!)
  expect(container.querySelector('.pet-assistant-transport .pet-rig')).toBe(transport)
  act(() => ref.current.onPageScroll(20))
  expect(container.querySelector('#home-floating-pet')).toHaveClass('pet-assistant-float--running')
  expect(transport).toHaveAttribute('data-visible', 'true')
})

test('native travel finishes only after its final drawing and ignores CSS and child animation completion', () => {
  mockDelayTravel = true
  const { container } = mount()
  const root = container.querySelector('#home-floating-pet')!
  fireEvent.click(screen.getByRole('button', { name: '暂时收起宠物' }))
  advance(1000)
  expect(root).toHaveClass('pet-assistant-float--running')
  fireEvent.transitionEnd(container.querySelector('.pet-assistant-traveler')!)
  expect(root).toHaveClass('pet-assistant-float--running')
  fireEvent.transitionEnd(root)
  expect(root).toHaveClass('pet-assistant-float--running')
  advance(1000)
  expect(root).toHaveClass('pet-assistant-float--running')
  act(() => mockTravelComplete?.())
  expect(root).toHaveClass('pet-assistant-float--docked')
  fireEvent.click(screen.getByRole('button', { name: '叫回宠物' }))
  advance(1850)
  expect(root).toHaveClass('pet-assistant-float--returning')
  fireEvent.animationEnd(root)
  expect(root).toHaveClass('pet-assistant-float--returning')
  act(() => mockTravelComplete?.())
  expect(root).toHaveClass('pet-assistant-float--playing')
})

test('a fresh transport owner after suppression does not retain the failed walking geometry', () => {
  const pet = { id: 'p', name: '健文', builtin_avatar_id: 'jianwen-01' } as PetProfile
  const renderPet = (suppressed: boolean) => <FloatingPetAssistant pet={pet} companionSpriteOverride={JIANWEN_COMPANION_SRC} suppressed={suppressed} onChatOpenChange={jest.fn()} />
  const { container, rerender } = render(renderPet(false))
  const size = (container.querySelector('.pet-assistant-transport') as HTMLElement).style.width
  fireEvent.error(container.querySelector('.pet-assistant-transport .pet-rig__source')!)
  expect(container.querySelector('.pet-transport-actor')).toHaveAttribute('data-vehicle', 'walk')
  rerender(renderPet(true))
  expect(container.querySelector('#home-floating-pet')).toBeNull()
  rerender(renderPet(false))
  expect(container.querySelector('.pet-transport-actor')).toHaveAttribute('data-vehicle', 'bicycle')
  expect((container.querySelector('.pet-assistant-transport') as HTMLElement).style.width).toBe(size)
})

test('an appearance round trip never reuses an old ready callback for a newly mounted canvas', () => {
  const pet = { id: 'p', name: '健文', builtin_avatar_id: 'jianwen-01' } as PetProfile
  const renderPet = (sprite: string) => <FloatingPetAssistant pet={pet} companionSpriteOverride={sprite} onChatOpenChange={jest.fn()} />
  const { container, rerender } = render(renderPet(JIANWEN_COMPANION_SRC))
  const oldReady = mockRigReady
  mockDelayReady = true
  rerender(renderPet('/assets/pets/companions/companion-fbd87f73-v1.png'))
  rerender(renderPet(JIANWEN_COMPANION_SRC))
  fireEvent.click(screen.getByRole('button', { name: '暂时收起宠物' }))
  act(() => oldReady?.())
  expect(container.querySelector('#home-floating-pet')).toHaveClass('pet-assistant-float--playing')
  act(() => mockRigReady?.())
  expect(container.querySelector('#home-floating-pet')).toHaveClass('pet-assistant-float--running')
})

test('a failed appearance can be revisited with fresh riding geometry', () => {
  const pet = { id: 'p', name: '健文', builtin_avatar_id: 'jianwen-01' } as PetProfile
  const renderPet = (sprite: string) => <FloatingPetAssistant pet={pet} companionSpriteOverride={sprite} onChatOpenChange={jest.fn()} />
  const { container, rerender } = render(renderPet(JIANWEN_COMPANION_SRC))
  const size = (container.querySelector('.pet-assistant-transport') as HTMLElement).style.width
  fireEvent.error(container.querySelector('.pet-assistant-transport .pet-rig__source')!)
  rerender(renderPet('/assets/pets/companions/companion-fbd87f73-v1.png'))
  rerender(renderPet(JIANWEN_COMPANION_SRC))
  expect(container.querySelector('.pet-transport-actor')).toHaveAttribute('data-vehicle', 'bicycle')
  expect((container.querySelector('.pet-assistant-transport') as HTMLElement).style.width).toBe(size)
})

test('switching home modes retains the prepared transport instead of cold mounting a different animation', () => {
  const onChatOpenChange = jest.fn()
  const renderPet = () => <FloatingPetAssistant companionSpriteOverride={JIANWEN_COMPANION_SRC} onChatOpenChange={onChatOpenChange} />
  const { container, rerender } = render(renderPet())
  const transport = container.querySelector('.pet-assistant-transport .pet-rig')
  mockWellness = true
  rerender(renderPet())
  mockDelayReady = true; mockWellness = false
  rerender(renderPet())
  fireEvent.click(screen.getByRole('button', { name: '暂时收起宠物' }))
  expect(container.querySelector('#home-floating-pet')).toHaveClass('pet-assistant-float--running')
  expect(container.querySelector('.pet-assistant-transport .pet-rig')).toBe(transport)
})

test('switching home modes keeps the same journey and its automatic recall', () => {
  const ref = React.createRef<any>()
  const onChatOpenChange = jest.fn()
  const renderPet = () => <FloatingPetAssistant ref={ref} companionSpriteOverride={JIANWEN_COMPANION_SRC} onChatOpenChange={onChatOpenChange} />
  const { container, rerender } = render(renderPet())
  act(() => ref.current.onPageScroll(20))
  advance(400)
  expect(container.querySelector('#home-floating-pet')).toHaveClass('pet-assistant-float--running')
  mockWellness = true; rerender(renderPet())
  expect(container.querySelector('#home-floating-pet')).toHaveClass('pet-assistant-float--running')
  advance(2720)
  expect(container.querySelector('#home-floating-pet')).toHaveClass('pet-assistant-float--returning')
  advance(1800)
  expect(container.querySelector('#home-floating-pet')).toHaveClass('pet-assistant-float--playing')
  mockWellness = false; rerender(renderPet())
  expect(container.querySelector('#home-floating-pet')).toHaveClass('pet-assistant-float--playing')
})

test('a prepared but not presented ride keeps standing visible and never starts moving', () => {
  mockDelayHandoff = true
  const { container } = mount()
  fireEvent.click(screen.getByRole('button', { name: '暂时收起宠物' }))
  expect(container.querySelector('#home-floating-pet')).toHaveClass('pet-assistant-float--boarding')
  expect(container.querySelector('#home-floating-pet')).not.toHaveClass('is-welcoming')
  expect(container.querySelector('.pet-assistant-traveler')).not.toHaveClass('is-standby')
  act(() => mockPresented?.())
  expect(container.querySelector('.pet-assistant-traveler')).toHaveClass('is-standby')
  expect(container.querySelector('#home-floating-pet')).toHaveClass('pet-assistant-float--boarding')
  act(() => mockHandoffComplete?.())
  expect(container.querySelector('#home-floating-pet')).toHaveClass('pet-assistant-float--running')
})

test('missing presentation cancels the departure instead of flashing an unseen vehicle into motion', () => {
  mockDelayHandoff = true
  const { container } = mount()
  fireEvent.click(screen.getByRole('button', { name: '暂时收起宠物' }))
  const oldComplete = mockHandoffComplete
  advance(2100)
  expect(container.querySelector('#home-floating-pet')).toHaveClass('pet-assistant-float--playing')
  act(() => oldComplete?.())
  expect(container.querySelector('#home-floating-pet')).toHaveClass('pet-assistant-float--playing')
})

test('a callback from a cancelled boarding cannot start a later boarding attempt', () => {
  mockDelayHandoff = true
  const { container } = mount()
  fireEvent.click(screen.getByRole('button', { name: '暂时收起宠物' }))
  const oldComplete = mockHandoffComplete
  advance(2100)
  fireEvent.click(screen.getByRole('button', { name: '暂时收起宠物' }))
  act(() => oldComplete?.())
  expect(container.querySelector('#home-floating-pet')).toHaveClass('pet-assistant-float--boarding')
  act(() => mockHandoffComplete?.())
  expect(container.querySelector('#home-floating-pet')).toHaveClass('pet-assistant-float--running')
})

test('returning retains the ride until the native alighting handoff finishes', () => {
  const { container } = mount()
  fireEvent.click(screen.getByRole('button', { name: '暂时收起宠物' }))
  advance(980); fireEvent.transitionEnd(container.querySelector('#home-floating-pet')!)
  fireEvent.click(screen.getByRole('button', { name: '叫回宠物' }))
  mockDelayHandoff = true
  advance(1800); fireEvent.animationEnd(container.querySelector('#home-floating-pet')!)
  expect(container.querySelector('#home-floating-pet')).toHaveClass('pet-assistant-float--alighting')
  expect(container.querySelector('.pet-assistant-traveler')).toHaveClass('is-standby')
  act(() => mockHandoffComplete?.())
  expect(container.querySelector('#home-floating-pet')).toHaveClass('pet-assistant-float--playing')
  expect(container.querySelector('.pet-assistant-traveler .pet-actor')).toHaveStyle({ transform: 'scaleX(-1)' })
})

test.each(['boarding', 'running', 'returning'])('late pet data cancels %s before exposing its unprepared new canvas', phase => {
  const ref = React.createRef<any>(), onChatOpenChange = jest.fn()
  const renderPet = (pet?: PetProfile) => <FloatingPetAssistant ref={ref} pet={pet} companionSpriteOverride={JIANWEN_COMPANION_SRC} onChatOpenChange={onChatOpenChange} />
  const { container, rerender } = render(renderPet())
  mockDelayHandoff = phase === 'boarding'
  act(() => ref.current.onPageScroll(20))
  if (phase === 'returning') {
    advance(980); fireEvent.transitionEnd(container.querySelector('#home-floating-pet')!)
    fireEvent.click(screen.getByRole('button', { name: '叫回宠物' }))
  }
  expect(container.querySelector('#home-floating-pet')).toHaveClass(`pet-assistant-float--${phase}`)
  const oldCanvas = container.querySelector('.pet-assistant-transport .pet-rig'), oldComplete = mockHandoffComplete
  mockDelayReady = true; mockDelayHandoff = true
  rerender(renderPet({ id: 'p', name: '健文', builtin_avatar_id: 'jianwen-01' } as PetProfile))
  const newCanvas = container.querySelector('.pet-assistant-transport .pet-rig')
  expect(newCanvas).not.toBe(oldCanvas)
  expect(newCanvas).toHaveAttribute('data-visible', 'false')
  expect(newCanvas).toHaveClass('is-paused')
  expect(container.querySelector('#home-floating-pet')).toHaveClass('pet-assistant-float--playing')
  act(() => oldComplete?.())
  act(() => ref.current.onPageScroll(40))
  expect(container.querySelector('#home-floating-pet')).toHaveClass('pet-assistant-float--playing')
  act(() => mockRigReady?.())
  expect(container.querySelector('#home-floating-pet')).toHaveClass('pet-assistant-float--boarding')
})

test('a changed parked identity recalls using its own supported vehicle', () => {
  const onChatOpenChange = jest.fn(), pet = { id: 'p', name: '健文', builtin_avatar_id: 'jianwen-01' } as PetProfile
  const { container, rerender } = render(<FloatingPetAssistant pet={pet} onChatOpenChange={onChatOpenChange} />)
  fireEvent.click(screen.getByRole('button', { name: '暂时收起宠物' }))
  advance(980); fireEvent.transitionEnd(container.querySelector('#home-floating-pet')!)
  rerender(<FloatingPetAssistant pet={{ ...pet, id: 'photo', builtin_avatar_id: undefined, avatar_type: 'pixel_self', pixel_avatar_url: 'photo.png' }} onChatOpenChange={onChatOpenChange} />)
  expect(container.querySelector('#home-floating-pet')).toHaveClass('pet-assistant-float--docked')
  fireEvent.click(screen.getByRole('button', { name: '叫回宠物' }))
  expect(container.querySelector('.pet-transport-actor')).toHaveAttribute('data-vehicle', 'walk')
})

test('a second departure preserves the arrived standing direction until its native turn', () => {
  const { container } = mount()
  fireEvent.click(screen.getByRole('button', { name: '暂时收起宠物' }))
  advance(980); fireEvent.transitionEnd(container.querySelector('#home-floating-pet')!)
  fireEvent.click(screen.getByRole('button', { name: '叫回宠物' }))
  advance(1800); fireEvent.animationEnd(container.querySelector('#home-floating-pet')!)
  mockDelayHandoff = true
  fireEvent.click(screen.getByRole('button', { name: '暂时收起宠物' }))
  expect(container.querySelector('.pet-assistant-traveler .pet-actor')).toHaveStyle({ transform: 'scaleX(-1)' })
  expect(container.querySelector('.pet-assistant-transport .pet-rig')).toHaveAttribute('data-boarding-facing', 'left')
  act(() => mockPresented?.())
  expect(container.querySelector('#home-floating-pet')).toHaveClass('pet-assistant-float--boarding')
  act(() => mockHandoffComplete?.())
  expect(container.querySelector('#home-floating-pet')).toHaveClass('pet-assistant-float--running')
})

test('native canvas lane is a fixed sibling outside the moving floating controller', () => {
  const { container } = mount()
  const lane = container.querySelector('.pet-assistant-transport--lane')!
  expect(lane.closest('#home-floating-pet')).toBeNull()
  expect(lane).toHaveStyle({ position: 'fixed', left: '0px', width: '375px' })
})

test('an expired automatic recall waits for the last departure frame instead of jumping to the edge', () => {
  mockDelayTravel = true
  const ref = React.createRef<any>(), { container } = render(<FloatingPetAssistant ref={ref} companionSpriteOverride={JIANWEN_COMPANION_SRC} onChatOpenChange={jest.fn()} />)
  act(() => ref.current.onPageScroll(20))
  advance(4000)
  expect(container.querySelector('#home-floating-pet')).toHaveClass('pet-assistant-float--running')
  act(() => mockTravelComplete?.())
  expect(container.querySelector('#home-floating-pet')).toHaveClass('pet-assistant-float--returning')
})

test('a late native lane measurement cannot restart departure after chat interrupts it', () => {
  let measured: ((rows: unknown[]) => void) | undefined
  const previous = Taro.createSelectorQuery
  Object.assign(Taro, { createSelectorQuery: () => ({ select: () => ({ fields: () => ({ exec: (callback: (rows: unknown[]) => void) => { measured = callback } }) }) }) })
  try {
    const ref = React.createRef<any>(), { container } = render(<FloatingPetAssistant ref={ref} companionSpriteOverride={JIANWEN_COMPANION_SRC} onChatOpenChange={jest.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '暂时收起宠物' }))
    expect(container.querySelector('#home-floating-pet')).toHaveClass('pet-assistant-float--playing')
    act(() => ref.current.openChat())
    act(() => measured?.([{ left: 280, top: 400 }]))
    expect(container.querySelector('#home-floating-pet')).toHaveClass('is-chat-open', 'pet-assistant-float--playing')
    expect(container.querySelector('.pet-assistant-transport')).toHaveAttribute('aria-hidden', 'true')
  } finally { Object.assign(Taro, { createSelectorQuery: previous }) }
})

test('native pixels wait for the measured lane geometry to commit', () => {
  let acknowledge: (() => void) | undefined
  Object.assign(Taro, { nextTick: jest.fn(callback => { acknowledge = callback }) })
  const { container } = mount()
  fireEvent.click(screen.getByRole('button', { name: '暂时收起宠物' }))
  expect(container.querySelector('#home-floating-pet')).toHaveClass('pet-assistant-float--playing')
  expect(container.querySelector('.pet-assistant-transport .pet-rig')).toHaveAttribute('data-visible', 'false')
  act(() => acknowledge?.())
  expect(container.querySelector('#home-floating-pet')).toHaveClass('pet-assistant-float--running')
})

test('a failed moving native canvas cancels its trip before switching to the walker', () => {
  mockDelayTravel = true
  const { container } = mount()
  fireEvent.click(screen.getByRole('button', { name: '暂时收起宠物' }))
  const oldComplete = mockTravelComplete
  advance(1300)
  fireEvent.transitionEnd(container.querySelector('#home-floating-pet')!)
  fireEvent.error(container.querySelector('.pet-assistant-transport .pet-rig__source')!)
  expect(container.querySelector('#home-floating-pet')).toHaveClass('pet-assistant-float--playing')
  act(() => oldComplete?.())
  expect(container.querySelector('#home-floating-pet')).toHaveClass('pet-assistant-float--playing')
  expect(container.querySelector('.pet-transport-actor')).toHaveAttribute('data-vehicle', 'walk')
})

jest.mock('../../src/components/PetRigActor', () => ({ PetRigActor: ({ rig, vehicle, action, active, visible, boardingFacing, handoff, travel, onTravelComplete, onPresented, onHandoffComplete, onReady, onUnavailable }: any) => {
  const React = require('react')
  if (onReady) mockRigReady = onReady
  if (handoff) { mockPresented = onPresented; mockHandoffComplete = onHandoffComplete }
  if (travel) mockTravelComplete = onTravelComplete
  React.useLayoutEffect(() => { if (!mockDelayReady) onReady?.() }, [rig, vehicle])
  React.useLayoutEffect(() => { if (handoff && !mockDelayHandoff) { onPresented?.(); onHandoffComplete?.() } }, [handoff])
  React.useLayoutEffect(() => { if (travel && !mockDelayTravel) { const timer = setTimeout(onTravelComplete, travel.duration); return () => clearTimeout(timer) } }, [travel?.id])
  return React.createElement('div', { className: `pet-rig${active ? '' : ' is-paused'}`, 'data-source': rig.src, 'data-motion': vehicle || action, 'data-visible': String(visible), 'data-boarding-facing': boardingFacing }, React.createElement('img', { className: 'pet-rig__source', src: rig.src, onError: onUnavailable }))
} }))
