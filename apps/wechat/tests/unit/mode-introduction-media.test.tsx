import * as React from 'react'
import { act, render } from '@testing-library/react'
import Taro, { useDidHide, useDidShow } from '@tarojs/taro'
import { ModeIntroMedia } from '../../src/components/ModeIntroMedia'
import { MODE_INTRODUCTION_CHAPTERS } from '../../src/utils/mode-introduction-chapters'

let mockArtwork: any, mockVideo: any
const mockPlay = jest.fn(), mockPause = jest.fn(), mockSeek = jest.fn()
const hides = new Set<() => void>(), shows = new Set<() => void>()
jest.mock('../../src/components/ModeIntroArtwork', () => ({ ModeIntroArtwork: (props: any) => { mockArtwork = props; return null } }))
jest.mock('@tarojs/components', () => ({ Video: (props: any) => { mockVideo = props; return <video data-testid='movie' /> } }))
beforeEach(() => {
  jest.useFakeTimers(); jest.clearAllMocks(); mockVideo = undefined; hides.clear(); shows.clear()
  Object.assign(Taro, { createVideoContext: jest.fn(() => ({ play: mockPlay, pause: mockPause, seek: mockSeek })) })
  Object.assign(Taro, { nextTick: jest.fn(callback => callback()) })
  ;(useDidHide as jest.Mock).mockImplementation(fn => React.useEffect(() => { hides.add(fn); return () => { hides.delete(fn) } }, [fn]))
  ;(useDidShow as jest.Mock).mockImplementation(fn => React.useEffect(() => { shows.add(fn); return () => { shows.delete(fn) } }, [fn]))
})
afterEach(() => jest.useRealTimers())
const chapter = MODE_INTRODUCTION_CHAPTERS[0]

test('a ready file remains under its poster until a real video frame progresses; a silent decoder times out', () => {
  const failed = jest.fn()
  const view = render(<ModeIntroMedia chapter={chapter} attempt={0} paused={false} onError={failed} />)
  act(() => mockArtwork.onMediaReady('wxfile://usr/intro.mp4'))
  expect(mockVideo.className).not.toContain('is-visible')
  act(() => jest.advanceTimersByTime(18000))
  expect(failed).toHaveBeenCalledTimes(1)
  view.unmount()
})

test('paused time does not cause a startup error, and actual frame progress cancels the watchdog', () => {
  const failed = jest.fn()
  const view = render(<ModeIntroMedia chapter={chapter} attempt={0} paused onError={failed} />)
  act(() => mockArtwork.onMediaReady('wxfile://usr/intro.mp4'))
  act(() => jest.advanceTimersByTime(20000))
  expect(failed).not.toHaveBeenCalled()
  view.rerender(<ModeIntroMedia chapter={chapter} attempt={0} paused={false} onError={failed} />)
  act(() => mockVideo.onTimeUpdate({ detail: { currentTime: 0.2 } }))
  expect(mockVideo.className).toContain('is-visible')
  for (let i = 1; i <= 20; i++) act(() => { jest.advanceTimersByTime(1000); mockVideo.onTimeUpdate({ detail: { currentTime: i % 8 + 0.2 } }) })
  expect(failed).not.toHaveBeenCalled()
})

test('the same chapter loops and repeated end events cannot turn it into a permanent still', () => {
  const failed = jest.fn()
  const view = render(<ModeIntroMedia chapter={chapter} attempt={0} paused={false} onError={failed} />)
  act(() => mockArtwork.onMediaReady('wxfile://usr/intro.mp4'))
  expect(mockVideo.loop).toBe(true)
  mockPlay.mockClear()
  act(() => { mockVideo.onEnded(); mockVideo.onEnded() })
  expect(mockSeek).toHaveBeenCalledTimes(2)
  expect(mockPlay).toHaveBeenCalledTimes(2)
  view.rerender(<ModeIntroMedia chapter={chapter} attempt={0} paused onError={failed} />)
  mockPlay.mockClear()
  act(() => mockVideo.onEnded())
  expect(mockPlay).not.toHaveBeenCalled()
  view.rerender(<ModeIntroMedia chapter={chapter} attempt={0} paused={false} onError={failed} />)
  expect(mockPlay).toHaveBeenCalled()
})

test('background pauses resume only when the user had been playing; native pauses recover', () => {
  const failed = jest.fn()
  const view = render(<ModeIntroMedia chapter={chapter} attempt={0} paused={false} onError={failed} />)
  act(() => mockArtwork.onMediaReady('wxfile://usr/intro.mp4'))
  act(() => jest.advanceTimersByTime(700))
  mockPlay.mockClear()
  act(() => { hides.forEach(fn => fn()); mockVideo.onPause(); jest.advanceTimersByTime(20000) })
  expect(mockPlay).not.toHaveBeenCalled(); expect(failed).not.toHaveBeenCalled()
  act(() => shows.forEach(fn => fn()))
  expect(mockPlay).toHaveBeenCalled()
  mockPlay.mockClear()
  act(() => { mockVideo.onPause(); jest.advanceTimersByTime(350) })
  expect(mockPlay).toHaveBeenCalledTimes(1)
  view.rerender(<ModeIntroMedia chapter={chapter} attempt={0} paused onError={failed} />)
  mockPlay.mockClear()
  act(() => { hides.forEach(fn => fn()); shows.forEach(fn => fn()); mockVideo.onPause(); jest.advanceTimersByTime(1000) })
  expect(mockPlay).not.toHaveBeenCalled()
})

test('stalled playback is detected even after the first frame has progressed', () => {
  const failed = jest.fn()
  render(<ModeIntroMedia chapter={chapter} attempt={0} paused={false} onError={failed} />)
  act(() => mockArtwork.onMediaReady('wxfile://usr/intro.mp4'))
  act(() => mockVideo.onTimeUpdate({ detail: { currentTime: 1 } }))
  act(() => jest.advanceTimersByTime(18000))
  expect(failed).toHaveBeenCalledTimes(1)
})

test('disposed native callbacks cannot advance another chapter and the old decoder is paused', () => {
  const failed = jest.fn()
  const view = render(<ModeIntroMedia chapter={chapter} attempt={0} paused={false} onError={failed} />)
  act(() => mockArtwork.onMediaReady('wxfile://usr/intro.mp4'))
  const old = mockVideo
  view.unmount()
  mockPlay.mockClear()
  act(() => { old.onEnded(); old.onError(); old.onLoadedMetaData(); old.onPause(); jest.advanceTimersByTime(2000) })
  expect(mockPlay).not.toHaveBeenCalled(); expect(failed).not.toHaveBeenCalled(); expect(mockPause).toHaveBeenCalled()
})
