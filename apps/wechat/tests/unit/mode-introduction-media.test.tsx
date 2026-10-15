import * as React from 'react'
import { act, render } from '@testing-library/react'
import Taro from '@tarojs/taro'
import { ModeIntroMedia } from '../../src/components/ModeIntroMedia'
import { MODE_INTRODUCTION_CHAPTERS } from '../../src/utils/mode-introduction-chapters'

let mockArtwork: any, mockVideo: any
const mockPlay = jest.fn(), mockPause = jest.fn()
jest.mock('../../src/components/ModeIntroArtwork', () => ({ ModeIntroArtwork: (props: any) => { mockArtwork = props; return null } }))
jest.mock('@tarojs/components', () => ({ Video: (props: any) => { mockVideo = props; return <video data-testid='movie' /> } }))
beforeEach(() => {
  jest.useFakeTimers(); jest.clearAllMocks(); mockVideo = undefined
  Object.assign(Taro, { createVideoContext: jest.fn(() => ({ play: mockPlay, pause: mockPause })) })
  Object.assign(Taro, { nextTick: jest.fn(callback => callback()) })
})
afterEach(() => jest.useRealTimers())
const chapter = MODE_INTRODUCTION_CHAPTERS[0]

test('a ready file remains under its poster until a real video frame progresses; a silent decoder times out', () => {
  const failed = jest.fn()
  const view = render(<ModeIntroMedia chapter={chapter} attempt={0} paused={false} onEnded={() => true} onError={failed} />)
  act(() => mockArtwork.onMediaReady('wxfile://usr/intro.mp4'))
  expect(mockVideo.className).not.toContain('is-visible')
  act(() => jest.advanceTimersByTime(18000))
  expect(failed).toHaveBeenCalledTimes(1)
  view.unmount()
})

test('paused time does not cause a startup error, and actual frame progress cancels the watchdog', () => {
  const failed = jest.fn(), ended = jest.fn(() => true)
  const view = render(<ModeIntroMedia chapter={chapter} attempt={0} paused onEnded={ended} onError={failed} />)
  act(() => mockArtwork.onMediaReady('wxfile://usr/intro.mp4'))
  act(() => jest.advanceTimersByTime(20000))
  expect(failed).not.toHaveBeenCalled()
  view.rerender(<ModeIntroMedia chapter={chapter} attempt={0} paused={false} onEnded={ended} onError={failed} />)
  act(() => mockVideo.onTimeUpdate({ detail: { currentTime: 0.2 } }))
  expect(mockVideo.className).toContain('is-visible')
  act(() => jest.advanceTimersByTime(20000))
  expect(failed).not.toHaveBeenCalled()
})

test('an end rejected during the pause boundary is consumed exactly once when playback resumes', () => {
  const ended = jest.fn().mockReturnValueOnce(false).mockReturnValue(true), failed = jest.fn()
  const view = render(<ModeIntroMedia chapter={chapter} attempt={0} paused={false} onEnded={ended} onError={failed} />)
  act(() => mockArtwork.onMediaReady('wxfile://usr/intro.mp4'))
  act(() => mockVideo.onEnded())
  view.rerender(<ModeIntroMedia chapter={chapter} attempt={0} paused onEnded={ended} onError={failed} />)
  view.rerender(<ModeIntroMedia chapter={chapter} attempt={0} paused={false} onEnded={ended} onError={failed} />)
  expect(ended).toHaveBeenCalledTimes(2)
  act(() => mockVideo.onEnded())
  expect(ended).toHaveBeenCalledTimes(2)
})

test('disposed native callbacks cannot advance another chapter and the old decoder is paused', () => {
  const ended = jest.fn(() => true), failed = jest.fn()
  const view = render(<ModeIntroMedia chapter={chapter} attempt={0} paused={false} onEnded={ended} onError={failed} />)
  act(() => mockArtwork.onMediaReady('wxfile://usr/intro.mp4'))
  const old = mockVideo
  view.unmount()
  act(() => { old.onEnded(); old.onError(); old.onLoadedMetaData() })
  expect(ended).not.toHaveBeenCalled(); expect(failed).not.toHaveBeenCalled(); expect(mockPause).toHaveBeenCalled()
})
