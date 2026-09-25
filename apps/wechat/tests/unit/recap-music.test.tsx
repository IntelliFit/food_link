import { act, fireEvent, render, screen } from '@testing-library/react'
import Taro, { useDidHide, useDidShow } from '@tarojs/taro'
import { RecapMusic } from '../../src/components/RecapMusic'

let hide: () => void
let show: () => void
let onPlay: () => void
let onPause: () => void
let onError: () => void
const audio = {
  src: '', loop: false, autoplay: false, obeyMuteSwitch: false, volume: 0,
  play: jest.fn(() => onPlay()), pause: jest.fn(() => onPause()), destroy: jest.fn(),
  onPlay: (callback: () => void) => { onPlay = callback },
  onPause: (callback: () => void) => { onPause = callback },
  onError: (callback: () => void) => { onError = callback },
}
beforeEach(() => {
  jest.useFakeTimers(); jest.clearAllMocks()
  ;(Taro.getStorageSync as jest.Mock).mockReturnValue('on')
  ;(useDidHide as jest.Mock).mockImplementation(callback => { hide = callback })
  ;(useDidShow as jest.Mock).mockImplementation(callback => { show = callback })
  Object.assign(Taro, { createInnerAudioContext: jest.fn(() => audio) })
})
afterEach(() => jest.useRealTimers())

test('weekly music fades in, survives page updates, pauses on hide and is destroyed on close', () => {
  const { rerender, unmount } = render(<RecapMusic active />)
  act(() => jest.advanceTimersByTime(800))
  expect(audio.volume).toBeCloseTo(.18)
  expect(audio.loop).toBe(true)
  expect(audio.obeyMuteSwitch).toBe(true)
  rerender(<RecapMusic active />)
  expect(audio.play).toHaveBeenCalledTimes(1)
  act(() => hide())
  expect(audio.volume).toBe(0)
  expect(audio.pause).toHaveBeenCalled()
  act(() => show())
  expect(audio.play).toHaveBeenCalledTimes(2)
  unmount()
  expect(audio.destroy).toHaveBeenCalledTimes(1)
  expect(jest.getTimerCount()).toBe(0)
})

test('mute is remembered and background return does not turn it back on', () => {
  const { unmount } = render(<RecapMusic active />)
  fireEvent.click(screen.getByRole('button', { name: '关闭周报轻音乐' }))
  expect(Taro.setStorageSync).toHaveBeenCalledWith('recap-music-preference-v1', 'off')
  act(() => hide()); act(() => show())
  expect(audio.play).toHaveBeenCalledTimes(1)
  unmount()
})

test('play failure offers a gesture retry without blocking the report', () => {
  const { unmount } = render(<RecapMusic active />)
  act(() => onError())
  fireEvent.click(screen.getByRole('button', { name: '重试播放周报轻音乐' }))
  expect(audio.play).toHaveBeenCalledTimes(2)
  expect(screen.queryByText('点按播放')).not.toBeInTheDocument()
  unmount()
})
