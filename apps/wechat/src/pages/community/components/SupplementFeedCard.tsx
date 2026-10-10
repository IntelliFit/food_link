import { Image, View, Text } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { useState } from 'react'
import type { CommunityFeedRecord } from '../../../utils/api'
import { formatSupplementDose } from '../../../utils/supplements'
import './SupplementFeedCard.scss'

export function SupplementFeedCard({ record, showAll = false }: { record: CommunityFeedRecord; showAll?: boolean }) {
  const [failedImages, setFailedImages] = useState<string[]>([])
  const components = record.supplement_components || []
  const visible = showAll ? components : components.slice(0, 3)
  const brand = record.supplement_product?.brand?.trim()
  const images = Array.from(new Set((record.supplement_product?.image_urls || []).filter(Boolean)))
  const cover = images.find((url) => !failedImages.includes(url))
  const preview = (url: string) => { void Taro.previewImage({ current: url, urls: images }) }
  const markFailed = (url: string) => setFailedImages((current) => current.includes(url) ? current : [...current, url])

  return (
    <View className={`supplement-feed-card${showAll ? ' supplement-feed-card--detail' : ''}`}>
      <View className='supplement-feed-card__head'>
        <View
          className={`supplement-feed-card__cover${cover ? '' : ' supplement-feed-card__cover--empty'}`}
          onClick={(event) => {
            if (cover) { event.stopPropagation(); preview(cover) }
          }}
        >
          {cover ? (
            <>
              <Image className='supplement-feed-card__image' src={cover} mode='aspectFit' onError={() => markFailed(cover)} />
              {images.length > 1 && <Text className='supplement-feed-card__image-count'>{images.length}图</Text>}
            </>
          ) : <View className='supplement-feed-card__capsule' />}
        </View>
        <View className='supplement-feed-card__identity'>
          {brand && <Text className='supplement-feed-card__brand'>{brand}</Text>}
          <Text className='supplement-feed-card__name'>{record.supplement_name || '补剂'}</Text>
          <View className='supplement-feed-card__dose'>
            <Text className='supplement-feed-card__dose-label'>本次服用</Text>
            <Text className='supplement-feed-card__dose-value'>{formatSupplementDose(Number(record.servings), record.serving_label || '1份')}</Text>
          </View>
        </View>
      </View>
      {visible.length > 0 && (
        <View className='supplement-feed-card__components'>
          <Text className='supplement-feed-card__section-label'>本次摄入</Text>
          {visible.map((component, index) => {
            const amount = Number(component.amount) * Number(record.servings || 1)
            return (
              <View key={`${component.code}-${index}`} className='supplement-feed-card__component'>
                <View className='supplement-feed-card__component-info'>
                  <Text>{component.name}</Text>
                  {showAll && component.form && <Text className='supplement-feed-card__form'>{component.form}</Text>}
                </View>
                <Text className='supplement-feed-card__amount'>{amount > 0 && Number.isFinite(amount) ? `${Number(amount.toFixed(3))} ${component.unit}` : '含量未标注'}</Text>
              </View>
            )
          })}
          {!showAll && components.length > visible.length && <Text className='supplement-feed-card__more'>全部 {components.length} 项成分 · 查看详情 ›</Text>}
        </View>
      )}
      {showAll && images.length > 1 && (
        <View className='supplement-feed-card__labels'>
          <Text className='supplement-feed-card__section-label'>瓶身与标签</Text>
          <View className='supplement-feed-card__label-images'>
            {images.filter((url) => !failedImages.includes(url)).map((url) => (
              <Image
                key={url}
                className='supplement-feed-card__label-image'
                src={url}
                mode='aspectFit'
                onError={() => markFailed(url)}
                onClick={(event) => { event.stopPropagation(); preview(url) }}
              />
            ))}
          </View>
        </View>
      )}
    </View>
  )
}
