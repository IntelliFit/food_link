import { act, render } from '@testing-library/react'
import Taro from '@tarojs/taro'
import { PetRigActor } from '../../src/components/PetRigActor'
import { PET_RIGS } from '../../src/utils/pet-rig'
import { drawPetRig } from '../../src/utils/pet-rig-render'

jest.mock('../../src/utils/pet-rig-render', () => ({ drawPetRig: jest.fn() }))
const draw = drawPetRig as jest.Mock
let node: any, image: any, hide: () => void, show: () => void
let original: Record<string, unknown>
beforeEach(() => {
  jest.useFakeTimers(); jest.clearAllMocks()
  original = Object.fromEntries(['createSelectorQuery', 'onAppHide', 'onAppShow', 'offAppHide', 'offAppShow'].map(key => [key, Taro[key]]))
  image = { onload: null, onerror: null }
  Object.defineProperty(image, 'src', { set: () => image.onload?.() })
  node = { width: 0, height: 0, getContext: () => ({ translate: jest.fn(), scale: jest.fn() }), createImage: jest.fn(() => {
    if (!node.createImage.mock.calls.length || node.createImage.mock.calls.length === 1) return image
    const extra: any = { onload: null, onerror: null }
    Object.defineProperty(extra, 'src', { set: () => extra.onload?.() })
    return extra
  }), requestAnimationFrame: jest.fn(() => node.requestAnimationFrame.mock.calls.length), cancelAnimationFrame: jest.fn() }
  Object.assign(Taro, {
    createSelectorQuery: jest.fn(() => ({ select: () => ({ fields: () => ({ exec: (callback: any) => callback([{ node, width: 100, height: 110 }]) }) }) })),
    onAppHide: jest.fn(callback => { hide = callback }), onAppShow: jest.fn(callback => { show = callback }), offAppHide: jest.fn(), offAppShow: jest.fn(),
  })
})
afterEach(() => { Object.assign(Taro, original); jest.useRealTimers(); delete (window as any).matchMedia })
const ready = () => act(() => { jest.advanceTimersByTime(40) })
const latestPose = () => draw.mock.calls[draw.mock.calls.length - 1][3]
const tick = (timestamp: number) => act(() => { const calls = node.requestAnimationFrame.mock.calls; calls[calls.length - 1][0](timestamp) })

test('low frame rates retain the walking cadence while long stalls do not fast-forward', () => {
  render(<PetRigActor rig={PET_RIGS.guigui} action='walk' />)
  ready(); tick(100)
  for (let time = 200; time <= 1000; time += 100) tick(time)
  expect(latestPose().phase).toBeCloseTo(.5, 6)
  tick(1500)
  expect(latestPose().phase).toBeCloseTo(1400 / 1800, 6)
  tick(50000)
  expect(latestPose().phase).toBeCloseTo(1450 / 1800, 6)
})
test('pause freezes the current contact pose; resume ignores time spent paused', () => {
  const { rerender } = render(<PetRigActor rig={PET_RIGS.guigui} vehicle='bicycle' />)
  ready(); tick(100); tick(120)
  const phase = latestPose().phase
  expect(phase).toBeGreaterThan(0)
  rerender(<PetRigActor rig={PET_RIGS.guigui} vehicle='bicycle' active={false} />)
  expect(node.cancelAnimationFrame).toHaveBeenCalled()
  expect(latestPose().phase).toBe(phase)
  const pausedPaints = draw.mock.calls.length
  tick(50000); expect(draw).toHaveBeenCalledTimes(pausedPaints)
  rerender(<PetRigActor rig={PET_RIGS.guigui} vehicle='bicycle' />)
  tick(100000); expect(latestPose().phase).toBe(phase)
  tick(100020); expect(latestPose().phase).toBeGreaterThan(phase)
})
test('changing tool starts its own cycle while retaining the already loaded identity', () => {
  const { rerender, unmount } = render(<PetRigActor rig={PET_RIGS.huatuo} vehicle='bicycle' />)
  ready(); tick(100); tick(150)
  rerender(<PetRigActor rig={PET_RIGS.huatuo} vehicle='scooter' />)
  expect(latestPose().phase).toBe(0)
  expect(latestPose().stage).toBe('滑行')
  expect(node.createImage).toHaveBeenCalledTimes(2)
  hide(); const count = draw.mock.calls.length; tick(100000)
  expect(draw).toHaveBeenCalledTimes(count)
  show(); expect(draw.mock.calls.length).toBeGreaterThan(count)
  unmount()
  expect(image.onload).toBeNull()
  expect(Taro.offAppHide).toHaveBeenCalledWith(hide)
  expect(Taro.offAppShow).toHaveBeenCalledWith(show)
})
test('reduced motion draws a stable pose and never starts an animation clock', () => {
  const media = { matches: true, addEventListener: jest.fn(), removeEventListener: jest.fn() }
  Object.assign(window, { matchMedia: () => media })
  const { unmount } = render(<PetRigActor rig={PET_RIGS.doudou} vehicle='bicycle' />)
  ready()
  expect(draw).toHaveBeenCalled()
  expect(latestPose().phase).toBe(0)
  expect(node.requestAnimationFrame).not.toHaveBeenCalled()
  unmount(); expect(media.removeEventListener).toHaveBeenCalled()
})
test('unmount before native image loading prevents late painting and callbacks', () => {
  const callback = jest.fn()
  const { unmount } = render(<PetRigActor rig={PET_RIGS.jianwen} vehicle='scooter' onUnavailable={callback} />)
  unmount(); act(() => { jest.advanceTimersByTime(500) })
  expect(node.createImage).not.toHaveBeenCalled()
  expect(draw).not.toHaveBeenCalled()
  expect(callback).not.toHaveBeenCalled()
})
test('app returning to foreground does not resume a canvas on a hidden page', () => {
  render(<PetRigActor rig={PET_RIGS.guigui} vehicle='scooter' />)
  ready()
  const hideCalls = (Taro.useDidHide as jest.Mock).mock.calls
  act(() => { hideCalls[hideCalls.length - 1][0]() })
  const count = node.requestAnimationFrame.mock.calls.length
  act(() => { hide(); show() })
  expect(node.requestAnimationFrame).toHaveBeenCalledTimes(count)
  const showCalls = (Taro.useDidShow as jest.Mock).mock.calls
  act(() => { showCalls[showCalls.length - 1][0]() })
  expect(node.requestAnimationFrame.mock.calls.length).toBeGreaterThan(count)
})
