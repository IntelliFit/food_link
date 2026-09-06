import * as FileSystem from 'expo-file-system/legacy'
import { Video } from 'react-native-compressor'
import type { PrecisionCaptureViewInput } from '@food-link/core'

export const MAX_ANALYZE_VIDEO_SIZE_BYTES = 8 * 1024 * 1024
export const MIN_ANALYZE_VIDEO_DURATION_MS = 2_000
export const MAX_ANALYZE_VIDEO_DURATION_MS = 12_000

type AnalyzeVideoFile = {
  uri: string
  size: number
}

const COMPRESSION_PROFILES = [
  { maxSize: 960, bitrate: 3_000_000 },
  { maxSize: 840, bitrate: 1_800_000 },
  { maxSize: 720, bitrate: 1_000_000 },
] as const

export async function getAnalyzeVideoFileSize(uri: string): Promise<number> {
  const info = await FileSystem.getInfoAsync(uri)
  return info.exists && typeof info.size === 'number' ? info.size : 0
}

/**
 * 每一档都从原视频重新压缩，避免在已压缩结果上继续降质。
 * 与小程序一致：达到 8MB 门槛立即返回，否则保留最小有效结果供调用方判定。
 */
export async function compressAnalyzeVideoToLimit(
  source: AnalyzeVideoFile,
  onProgress?: (progress: number) => void,
): Promise<AnalyzeVideoFile> {
  if (source.uri && source.size > 0 && source.size <= MAX_ANALYZE_VIDEO_SIZE_BYTES) return source

  let smallest: AnalyzeVideoFile | null = null
  let lastError: unknown
  for (let index = 0; index < COMPRESSION_PROFILES.length; index += 1) {
    const profile = COMPRESSION_PROFILES[index]
    try {
      const outputUri = await Video.compress(
        source.uri,
        {
          compressionMethod: 'manual',
          maxSize: profile.maxSize,
          bitrate: profile.bitrate,
          minimumFileSizeForCompress: 0,
          progressDivider: 2,
        },
        (value) => {
          const stageStart = index / COMPRESSION_PROFILES.length
          const stageProgress = Math.max(0, Math.min(1, Number(value) || 0)) / COMPRESSION_PROFILES.length
          onProgress?.(Math.round((stageStart + stageProgress) * 100))
        },
      )
      const candidate = { uri: outputUri, size: await getAnalyzeVideoFileSize(outputUri) }
      if (!candidate.uri || candidate.size <= 0) continue
      if (!smallest || candidate.size < smallest.size) smallest = candidate
      if (candidate.size <= MAX_ANALYZE_VIDEO_SIZE_BYTES) {
        onProgress?.(100)
        return candidate
      }
    } catch (error) {
      lastError = error
    }
  }

  if (smallest) return smallest
  if (lastError instanceof Error) throw lastError
  throw new Error('视频压缩失败')
}


export function isVideoKeyframeCaptureComplete(frames: PrecisionCaptureViewInput[]): boolean {
  if (frames.length < 3 || frames.length > 5) return false
  return frames.every((frame, index) => (
    frame.role === `video_keyframe_${index + 1}`
    && Boolean(String(frame.image_url || '').trim())
  ))
}
