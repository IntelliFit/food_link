import { Image, Text, View } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { useState } from 'react'

import './AdaptiveImageGrid.scss'

type AdaptiveImageGridProps = {
  urls: string[]
  className?: string
  imageClassName?: string
  compact?: boolean
  presentation?: 'feed' | 'detail'
  onImageClick?: (url: string, index: number, urls: string[]) => void
}

const MAX_VISIBLE_IMAGES = 9
const GAP_RPX = 8
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

function getLayoutClass(count: number): string {
  if (count === 1) return 'is-single'
  if (count === 2) return 'is-two'
  if (count === 4) return 'is-four'
  return 'is-three-column'
}

/** 有界单图、按宽高比排多图；只利用图片加载尺寸，不下载额外图片或持久化缓存。 */
export function AdaptiveImageGrid({ urls, className = '', imageClassName = '', compact = false, presentation = 'feed', onImageClick }: AdaptiveImageGridProps) {
  const [ratios, setRatios] = useState<Record<string, number>>({})
  const validUrls = urls.filter((url) => typeof url === 'string' && url.trim())
  if (validUrls.length === 0) return null

  const visibleUrls = validUrls.slice(0, MAX_VISIBLE_IMAGES)
  const hiddenCount = validUrls.length - visibleUrls.length
  const isSingle = visibleUrls.length === 1
  const isDetail = presentation === 'detail'
  const columns = visibleUrls.length === 2 || visibleUrls.length === 4 ? 2 : 3
  const singleRatio = ratios[visibleUrls[0]] || 1
  // 普通竖拍完整保留；极长图/全景图放进有界画框，用 aspectFit 保留全图。
  const singleFrameRatio = isDetail ? 4 / 3 : clamp(singleRatio, 1 / 3, 3)
  const singleWidth = Math.min(compact ? 360 : 480, (compact ? 420 : 480) * singleFrameRatio)
  const rows: string[][] = []
  for (let index = 0; index < visibleUrls.length; index += isSingle ? 1 : columns) {
    rows.push(visibleUrls.slice(index, index + (isSingle ? 1 : columns)))
  }

  const handleImageLoad = (url: string, width: number, height: number) => {
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return
    const ratio = width / height
    setRatios((previous) => {
      if (previous[url] === ratio) return previous
      const next: Record<string, number> = {}
      visibleUrls.forEach((visibleUrl) => {
        if (previous[visibleUrl]) next[visibleUrl] = previous[visibleUrl]
      })
      next[url] = ratio
      return next
    })
  }

  const handleImageClick = (url: string, index: number) => {
    if (onImageClick) {
      onImageClick(url, index, validUrls)
      return
    }
    void Taro.previewImage({ current: url, urls: validUrls })
  }

  return (
    <View
      className={`feed-photo-grid ${getLayoutClass(visibleUrls.length)}${compact ? ' is-compact' : ''}${isDetail ? ' is-detail' : ''} ${className}`}
      style={isDetail ? { width: '100%' } : isSingle ? { width: `${singleWidth}rpx` } : undefined}
    >
      {rows.map((row, rowIndex) => {
        const rowRatios = row.map((url) => isSingle ? singleFrameRatio : clamp(ratios[url] || 1, 3 / 4, 3 / 2))
        return (
          <View
            key={rowIndex}
            className='feed-photo-grid-row'
            style={{
              // 单列必须占满：小于 1fr 的独立轨道会只占容器的一部分。
              gridTemplateColumns: row.length === 1 ? '1fr' : rowRatios.map((ratio) => `${ratio}fr`).join(' '),
              // 最后不足一行时保留缩略图大小，不把剩余一张/两张放大占满一行。
              width: !isSingle && row.length < columns
                ? `calc(${row.length / columns * 100}% - ${(columns - row.length) / columns * GAP_RPX}rpx)`
                : '100%',
            }}
          >
            {row.map((url, columnIndex) => {
              const index = rowIndex * (isSingle ? 1 : columns) + columnIndex
              const ratio = ratios[url] || 1
              const frameRatio = rowRatios[columnIndex]
              const mode = isDetail && isSingle ? 'aspectFill' : isSingle && ratio === frameRatio ? 'widthFix' : ratio === frameRatio ? 'aspectFill' : 'aspectFit'
              return (
                <View
                  key={`${url}-${index}`}
                  className='feed-photo-grid-item'
                  style={{ paddingBottom: `${100 / frameRatio}%` }}
                  onClick={(event) => {
                    event.stopPropagation()
                    handleImageClick(url, index)
                  }}
                >
                  <Image
                    src={url}
                    mode={mode}
                    className={`feed-photo-grid-image${!isSingle ? ' feed-circle-post-image' : ''} ${imageClassName}`}
                    onLoad={(event) => handleImageLoad(url, Number(event.detail.width), Number(event.detail.height))}
                    lazyLoad
                  />
                  {isDetail && isSingle && <Text className='feed-photo-grid-original'>查看原图</Text>}
                  {hiddenCount > 0 && index === visibleUrls.length - 1 && (
                    <View className='feed-photo-grid-more'>
                      <Text className='feed-photo-grid-more-text'>+{hiddenCount}</Text>
                    </View>
                  )}
                </View>
              )
            })}
          </View>
        )
      })}
    </View>
  )
}
