import {
  ANALYZE_VIDEO_COMPRESSION_PROFILES,
  compressAnalyzeVideoToLimit,
} from '../../src/utils/analyze-video'

describe('analyze video compression', () => {
  it('keeps a video already within the upload limit', async () => {
    const compress = jest.fn()
    const result = await compressAnalyzeVideoToLimit(
      { tempFilePath: 'source.mp4', size: 1024 },
      2048,
      compress,
    )

    expect(result).toEqual({ tempFilePath: 'source.mp4', size: 1024 })
    expect(compress).not.toHaveBeenCalled()
  })

  it('tries quality-preserving profiles from the original video until one fits', async () => {
    const compress = jest
      .fn()
      .mockResolvedValueOnce({ tempFilePath: 'high.mp4', size: 9 * 1024 * 1024 })
      .mockResolvedValueOnce({ tempFilePath: 'medium.mp4', size: 6 * 1024 * 1024 })

    const result = await compressAnalyzeVideoToLimit(
      { tempFilePath: 'source.mp4', size: 20 * 1024 * 1024 },
      8 * 1024 * 1024,
      compress,
    )

    expect(result.tempFilePath).toBe('medium.mp4')
    expect(compress).toHaveBeenNthCalledWith(1, 'source.mp4', ANALYZE_VIDEO_COMPRESSION_PROFILES[0])
    expect(compress).toHaveBeenNthCalledWith(2, 'source.mp4', ANALYZE_VIDEO_COMPRESSION_PROFILES[1])
    expect(compress).toHaveBeenCalledTimes(2)
  })

  it('continues with the next profile when a device rejects one profile', async () => {
    const compress = jest
      .fn()
      .mockRejectedValueOnce(new Error('profile unsupported'))
      .mockResolvedValueOnce({ tempFilePath: 'fallback.mp4', size: 5 * 1024 * 1024 })

    const result = await compressAnalyzeVideoToLimit(
      { tempFilePath: 'source.mp4', size: 20 * 1024 * 1024 },
      8 * 1024 * 1024,
      compress,
    )

    expect(result.tempFilePath).toBe('fallback.mp4')
    expect(compress).toHaveBeenCalledTimes(2)
  })
})
