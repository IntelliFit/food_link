import {
  buildDualAngleCaptureViews,
  buildPrecisionOptions,
  isPrecisionCaptureComplete,
  isVideoKeyframeCaptureComplete,
  needsPrecisionUserAction,
} from '../../src/utils/precision-mode'

describe('精准模式双角度与交互契约', () => {
  it('仅接受两张不同图片并固定映射俯拍与 45° 斜拍', () => {
    expect(isPrecisionCaptureComplete(['top.jpg', 'oblique.jpg'])).toBe(true)
    expect(isPrecisionCaptureComplete(['same.jpg', 'same.jpg'])).toBe(false)
    expect(isPrecisionCaptureComplete(['top.jpg'])).toBe(false)
    expect(buildDualAngleCaptureViews(['top.jpg', 'oblique.jpg'])).toEqual([
      { role: 'top_down', image_url: 'top.jpg' },
      { role: 'oblique_45', image_url: 'oblique.jpg' },
    ])
    expect(() => buildDualAngleCaptureViews(['same.jpg', 'same.jpg'])).toThrow('两张不同角度')
  })

  it('三个精准选项可以同时组合', () => {
    expect(buildPrecisionOptions(true, true, true)).toEqual({
      interactive: true,
      separate: true,
      web_search: true,
    })
  })

  it('视频模式只接受 3 至 5 个按时间递增且不重复的关键帧', () => {
    expect(isVideoKeyframeCaptureComplete([
      { role: 'video_keyframe_1', image_url: '1.jpg', timestamp_ms: 500 },
      { role: 'video_keyframe_2', image_url: '2.jpg', timestamp_ms: 1500 },
      { role: 'video_keyframe_3', image_url: '3.jpg', timestamp_ms: 2500 },
    ])).toBe(true)
    expect(isVideoKeyframeCaptureComplete([
      { role: 'video_keyframe_1', image_url: 'same.jpg', timestamp_ms: 500 },
      { role: 'video_keyframe_2', image_url: 'same.jpg', timestamp_ms: 1500 },
      { role: 'video_keyframe_3', image_url: '3.jpg', timestamp_ms: 2500 },
    ])).toBe(false)
  })

  it('追问和重拍状态都会进入独立确认页', () => {
    expect(needsPrecisionUserAction({ precisionStatus: 'needs_user_input' })).toBe(true)
    expect(needsPrecisionUserAction({ precisionStatus: 'needs_retake' })).toBe(true)
    expect(needsPrecisionUserAction({ precisionStatus: 'done' })).toBe(false)
  })
})
