import { Image, Text, View } from '@tarojs/components'
import Taro from '@tarojs/taro'

type FeedImageGridProps = {
  urls: string[]
  onImageClick?: (url: string, index: number, urls: string[]) => void
}

const MAX_VISIBLE_IMAGES = 9

function getLayoutClass(count: number): string {
  if (count === 1) return 'is-single'
  if (count === 2) return 'is-two'
  if (count === 4) return 'is-four'
  return 'is-three-column'
}

/**
 * 朋友圈式动态图片布局：单图保持原比例，多图使用 2/3 列方形缩略图。
 * 点击缩略图后始终使用完整 URL 列表预览原图。
 */
export function FeedImageGrid({ urls, onImageClick }: FeedImageGridProps) {
  const validUrls = urls.filter(Boolean)
  if (validUrls.length === 0) return null

  const visibleUrls = validUrls.slice(0, MAX_VISIBLE_IMAGES)
  const hiddenCount = validUrls.length - visibleUrls.length
  const layoutClass = getLayoutClass(visibleUrls.length)

  const handleImageClick = (url: string, index: number) => {
    if (onImageClick) {
      onImageClick(url, index, validUrls)
      return
    }
    Taro.previewImage({ current: url, urls: validUrls })
  }

  return (
    <View className={`feed-photo-grid ${layoutClass}`}>
      {visibleUrls.map((url, index) => (
        <View
          key={`${url}-${index}`}
          className='feed-photo-grid-item'
          onClick={(event) => {
            event.stopPropagation()
            handleImageClick(url, index)
          }}
        >
          <Image
            src={url}
            mode={visibleUrls.length === 1 ? 'widthFix' : 'aspectFill'}
            className={`feed-photo-grid-image${visibleUrls.length > 1 ? ' feed-circle-post-image' : ''}`}
            lazyLoad
          />
          {hiddenCount > 0 && index === visibleUrls.length - 1 && (
            <View className='feed-photo-grid-more'>
              <Text className='feed-photo-grid-more-text'>+{hiddenCount}</Text>
            </View>
          )}
        </View>
      ))}
    </View>
  )
}
