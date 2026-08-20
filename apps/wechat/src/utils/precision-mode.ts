import type {
  AnalyzeResponse,
  PrecisionCaptureViewInput,
  PrecisionOptionsInput,
} from './api'

export const isPrecisionCaptureComplete = (paths: Array<string | null | undefined>): boolean => {
  const topDown = String(paths[0] || '').trim()
  const oblique = String(paths[1] || '').trim()
  return Boolean(topDown && oblique && topDown !== oblique)
}

export const buildDualAngleCaptureViews = (imageUrls: string[]): PrecisionCaptureViewInput[] => {
  if (!isPrecisionCaptureComplete(imageUrls) || imageUrls.length !== 2) {
    throw new Error('精准模式需要两张不同角度的图片')
  }
  return [
    { role: 'top_down', image_url: imageUrls[0] },
    { role: 'oblique_45', image_url: imageUrls[1] },
  ]
}

export const isVideoKeyframeCaptureComplete = (views: PrecisionCaptureViewInput[]): boolean => {
  if (views.length < 3 || views.length > 5) return false
  const urls = new Set<string>()
  let previousTimestamp = -1
  return views.every((view, index) => {
    const expectedRole = `video_keyframe_${index + 1}`
    const imageUrl = String(view.image_url || '').trim()
    const timestamp = Number(view.timestamp_ms || 0)
    if (view.role !== expectedRole || !imageUrl || urls.has(imageUrl) || timestamp <= previousTimestamp) return false
    urls.add(imageUrl)
    previousTimestamp = timestamp
    return true
  })
}

export const buildPrecisionOptions = (
  interactive: boolean,
  separate: boolean,
  webSearch: boolean,
): PrecisionOptionsInput => ({
  interactive,
  separate,
  web_search: webSearch,
})

export const needsPrecisionUserAction = (result?: Partial<AnalyzeResponse> | null): boolean => (
  Boolean(result?.userActionRequired)
  || result?.precisionStatus === 'needs_user_input'
  || result?.precisionStatus === 'needs_retake'
)
