import { Image, PageContainer, ScrollView, Text, View } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { useEffect, useMemo, useState } from 'react'
import type { ManualFoodSearchResult } from '../../../utils/api'
import { collectFoodDisplayImageUrls } from '../../../utils/food-display-image'
import { manualFoodResultPortionText } from '../../../utils/manual-food-serving'
import { formatFoodMeasurementBasis } from '../../../utils/food-measure'
import { manualFoodDetailNutrition, manualFoodNutritionBasis, manualFoodSourceName } from './manual-food-detail'
import './ManualFoodDetailSheet.scss'

interface ManualFoodDetailSheetProps {
  item: ManualFoodSearchResult | null
  dark?: boolean
  portionText?: string
  onClose: () => void
  onAdd: (item: ManualFoodSearchResult) => void
}

export function ManualFoodDetailSheet({ item, dark, portionText, onClose, onAdd }: ManualFoodDetailSheetProps) {
  const [perHundred, setPerHundred] = useState(false)
  const [showMore, setShowMore] = useState(false)
  const nativeContainer = useMemo(() => typeof Taro.canIUse === 'function' && Taro.canIUse('page-container'), [])
  useEffect(() => { setPerHundred(false); setShowMore(false) }, [item?.id, item?.source])

  const content = item ? (() => {
    const images = collectFoodDisplayImageUrls(item)
    const basis = manualFoodNutritionBasis(item)
    const { macroRows, microRows } = manualFoodDetailNutrition(item, perHundred)
    return (
      <View className={`manual-food-detail${dark ? ' manual-food-detail--dark' : ''}`} onClick={(event) => event.stopPropagation()}>
        <View className='manual-food-detail__header'>
          <Text className='manual-food-detail__heading'>食物详情</Text>
          <View className='manual-food-detail__close' onClick={onClose}><Text>关闭</Text></View>
        </View>
        <ScrollView scrollY className='manual-food-detail__scroll'>
          {images.length > 0 && (
            <View className='manual-food-detail__images'>
              <Image className='manual-food-detail__image' src={images[0]} mode='aspectFit' onClick={() => Taro.previewImage({ current: images[0], urls: images })} />
              {images.length > 1 && <Text className='manual-food-detail__image-count' onClick={() => Taro.previewImage({ current: images[0], urls: images })}>查看全部 {images.length} 张</Text>}
            </View>
          )}
          <Text className='manual-food-detail__title'>{item.title}</Text>
          <Text className='manual-food-detail__source'>{manualFoodSourceName(item)}</Text>
          {!!item.subtitle && <Text className='manual-food-detail__description'>{item.subtitle}</Text>}
          <View className='manual-food-detail__basis'>
            <View className={!perHundred ? 'active' : ''} onClick={() => setPerHundred(false)}><Text>{portionText || manualFoodResultPortionText(item)}</Text></View>
            {basis && <View className={perHundred ? 'active' : ''} onClick={() => setPerHundred(true)}><Text>{item.measurement ? formatFoodMeasurementBasis(item.measurement) : `每100${basis}`}</Text></View>}
          </View>
          <View className='manual-food-detail__macros'>
            {macroRows.map((row) => <View key={row.key}><Text>{row.label}</Text><Text className='manual-food-detail__value'>{row.value}<Text className='manual-food-detail__unit'> {row.unit}</Text></Text></View>)}
          </View>
          {microRows.length > 0 && (
            <>
              <View className='manual-food-detail__more' onClick={() => setShowMore((current) => !current)}><Text>更多营养</Text><Text>{showMore ? '收起' : '展开'}</Text></View>
              {showMore && <View className='manual-food-detail__micros'>{microRows.map((row) => <View key={row.key}><Text>{row.label}</Text><Text>{row.value} {row.unit}</Text></View>)}</View>}
            </>
          )}
          {!!item.recommend_reason && <Text className='manual-food-detail__description'>{item.recommend_reason}</Text>}
          {!!item.items?.length && <View className='manual-food-detail__ingredients'><Text>包含食物</Text>{item.items.map((food, index) => <Text key={`${food.name}-${index}`}>{food.name}</Text>)}</View>}
        </ScrollView>
        <View className='manual-food-detail__footer'><View className='manual-food-detail__add' onClick={() => { onAdd(item); onClose() }}><Text>加入本餐</Text></View></View>
      </View>
    )
  })() : null

  if (nativeContainer) {
    return <PageContainer show={!!item} position='bottom' round zIndex={90} onBeforeLeave={onClose} onClickOverlay={onClose} overlayStyle='background: rgba(15, 23, 42, 0.46)' customStyle='background: transparent'>{content}</PageContainer>
  }
  return item ? <View className='manual-food-detail-mask' onClick={onClose}>{content}</View> : null
}
