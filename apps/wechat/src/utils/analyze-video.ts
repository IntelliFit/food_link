export interface AnalyzeVideoCompressionProfile {
  bitrate: number
  fps: number
  resolution: number
}

export interface AnalyzeVideoFile {
  tempFilePath: string
  size: number
}

export const ANALYZE_VIDEO_COMPRESSION_PROFILES: AnalyzeVideoCompressionProfile[] = [
  { bitrate: 3000, fps: 24, resolution: 0.8 },
  { bitrate: 1800, fps: 24, resolution: 0.7 },
  { bitrate: 1000, fps: 24, resolution: 0.6 },
]

/**
 * 从原视频逐档压缩，避免在已经压缩过的文件上再次压缩造成累计画质损失。
 * 每档都记录最小的有效结果；达到上传限制后立即返回。
 */
export async function compressAnalyzeVideoToLimit(
  source: AnalyzeVideoFile,
  maxSizeBytes: number,
  compress: (
    sourcePath: string,
    profile: AnalyzeVideoCompressionProfile,
  ) => Promise<AnalyzeVideoFile>,
): Promise<AnalyzeVideoFile> {
  if (source.tempFilePath && source.size > 0 && source.size <= maxSizeBytes) return source

  let smallest: AnalyzeVideoFile | null = null
  let lastError: unknown
  for (const profile of ANALYZE_VIDEO_COMPRESSION_PROFILES) {
    try {
      const candidate = await compress(source.tempFilePath, profile)
      if (!candidate.tempFilePath || candidate.size <= 0) continue
      if (!smallest || candidate.size < smallest.size) smallest = candidate
      if (candidate.size <= maxSizeBytes) return candidate
    } catch (error) {
      lastError = error
    }
  }

  if (smallest) return smallest
  if (lastError instanceof Error) throw lastError
  throw new Error('视频压缩失败')
}
