import { act, render } from '@testing-library/react'
import Taro from '@tarojs/taro'
import { createElement } from 'react'
import { PetRigActor } from '../../src/components/PetRigActor'
import { PET_RIGS } from '../../src/utils/pet-rig'
import { drawPetRig } from '../../src/utils/pet-rig-render'
import { PetActor } from '../../src/components/PetActor'

jest.mock('../../src/utils/pet-rig-render', () => ({ drawPetRig: jest.fn() }))
const draw = drawPetRig as jest.Mock
let node: any, image: any, ctx: any, hide: () => void, show: () => void
let original: Record<string, unknown>
let canvasError: (() => void) | undefined
beforeEach(() => {
  jest.useFakeTimers(); jest.clearAllMocks()
  canvasError = undefined
  // Canvas error is a native event; React DOM does not attach it to a canvas element.
  jest.spyOn(require('@tarojs/components'), 'Canvas').mockImplementation((props: any) => {
    canvasError = props.onError as (() => void) | undefined
    return createElement('canvas', { ...props, onError: undefined })
  })
  original = Object.fromEntries(['createSelectorQuery', 'nextTick', 'onAppHide', 'onAppShow', 'offAppHide', 'offAppShow'].map(key => [key, Taro[key]]))
  image = { onload: null, onerror: null }
  Object.defineProperty(image, 'src', { set: () => image.onload?.() })
  ctx = { translate: jest.fn(), scale: jest.fn(), clearRect: jest.fn(), save: jest.fn(), restore: jest.fn() }
  node = { width: 0, height: 0, getContext: () => ctx, createImage: jest.fn(() => {
    if (!node.createImage.mock.calls.length || node.createImage.mock.calls.length === 1) return image
    const extra: any = { onload: null, onerror: null }
    Object.defineProperty(extra, 'src', { set: () => extra.onload?.() })
    return extra
  }), requestAnimationFrame: jest.fn(() => node.requestAnimationFrame.mock.calls.length), cancelAnimationFrame: jest.fn() }
  Object.assign(Taro, {
    nextTick: jest.fn(callback => callback()),
    createSelectorQuery: jest.fn(() => ({ select: () => ({ fields: () => ({ exec: (callback: any) => callback([{ node, width: 100, height: 110 }]) }) }) })),
    onAppHide: jest.fn(callback => { hide = callback }), onAppShow: jest.fn(callback => { show = callback }), offAppHide: jest.fn(), offAppShow: jest.fn(),
  })
})
afterEach(() => { Object.assign(Taro, original); jest.restoreAllMocks(); jest.useRealTimers(); delete (window as any).matchMedia })
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

test('idle and gestures preserve a warmed canvas and do not reload approved artwork', () => {
  const pet = { builtin_avatar_id: 'jianwen-01', name: '健文' }
  const { container, rerender } = render(<PetActor pet={pet} action='idle' />)
  ready()
  const canvas = container.querySelector('canvas')!
  const loads = node.createImage.mock.calls.length
  expect(container.querySelector('.pet-actor__rig')).toHaveClass('is-standby')
  for (const action of ['walk', 'blink', 'idle', 'jump', 'idle'] as const) {
    rerender(<PetActor pet={pet} action={action} />)
    expect(container.querySelector('canvas')).toBe(canvas)
    expect(node.createImage).toHaveBeenCalledTimes(loads)
  }
})

test('transport readiness is reported after the first paint and again after a tool change', () => {
  const onReady = jest.fn(() => { expect(draw).toHaveBeenCalled() })
  const { rerender } = render(<PetRigActor rig={PET_RIGS.guigui} vehicle='bicycle' active={false} onReady={onReady} />)
  expect(onReady).not.toHaveBeenCalled()
  ready()
  expect(onReady).toHaveBeenCalledTimes(1)
  const loads = node.createImage.mock.calls.length
  rerender(<PetRigActor rig={PET_RIGS.guigui} vehicle='scooter' active={false} onReady={onReady} />)
  expect(onReady).toHaveBeenCalledTimes(2)
  expect(node.createImage).toHaveBeenCalledTimes(loads)
})

test('standby hides the native canvas itself while a paused preview remains visible', () => {
  const { container, rerender } = render(<PetRigActor rig={PET_RIGS.guigui} vehicle='bicycle' visible={false} />)
  ready()
  const canvas = container.querySelector('canvas')!
  expect(canvas).toHaveStyle({ opacity: '0', visibility: 'hidden' })
  expect(canvas).toHaveAttribute('hidden')
  expect(draw).not.toHaveBeenCalled()
  expect(node.requestAnimationFrame).not.toHaveBeenCalled()
  rerender(<PetRigActor rig={PET_RIGS.guigui} vehicle='bicycle' active={false} />)
  expect(container.querySelector('canvas')).toBe(canvas)
  expect(canvas).toHaveStyle({ opacity: '1', visibility: 'visible' })
  expect(canvas).not.toHaveAttribute('hidden')
  expect(draw).toHaveBeenCalled()
  expect(node.requestAnimationFrame).not.toHaveBeenCalled()
})

test('the idle standby canvas is hidden directly', () => {
  const { container } = render(<PetActor pet={{ builtin_avatar_id: 'jianwen-01' }} action='idle' />)
  ready()
  expect(container.querySelector('canvas')).toHaveStyle({ opacity: '0', visibility: 'hidden' })
})

test('a native canvas error stops its clock and invokes the existing fallback', () => {
  const onUnavailable = jest.fn()
  const { container } = render(<PetRigActor rig={PET_RIGS.guigui} vehicle='bicycle' onUnavailable={onUnavailable} />)
  ready()
  act(() => canvasError?.())
  expect(onUnavailable).toHaveBeenCalledTimes(1)
  expect(node.cancelAnimationFrame).toHaveBeenCalled()
  expect(container.querySelector('canvas')).toHaveStyle({ opacity: '0' })
})

test('return direction flips pixels in the same canvas without changing its clock or source', () => {
  const { container, rerender } = render(<PetRigActor rig={PET_RIGS.guigui} vehicle='bicycle' />)
  ready(); tick(100); tick(150)
  const canvas = container.querySelector('canvas'), phase = latestPose().phase, loads = node.createImage.mock.calls.length
  rerender(<PetRigActor rig={PET_RIGS.guigui} vehicle='bicycle' facing='left' />)
  expect(container.querySelector('canvas')).toBe(canvas)
  expect(node.createImage).toHaveBeenCalledTimes(loads)
  expect(latestPose().phase).toBe(phase)
  expect(ctx.translate).toHaveBeenCalledWith(200, 0)
  expect(ctx.scale).toHaveBeenCalledWith(-1, 1)
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
