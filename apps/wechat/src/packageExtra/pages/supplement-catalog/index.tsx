import { Input, ScrollView, Text, View } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { useEffect, useState } from 'react'
import {
  listSupplementCatalog,
  showUnifiedApiError,
  type SupplementCatalogItem,
} from '../../../utils/api'
import { SUPPLEMENT_CATALOG_SELECTION_KEY } from '../../../utils/supplements'
import { FlPageThemeRoot } from '../../../components/FlPageThemeRoot'

import './index.scss'

const CATEGORY_LABELS: Record<string, string> = {
  vitamin: '维生素',
  mineral: '矿物质',
  sports: '运动营养',
  wellness: '日常健康',
}

function componentSummary(item: SupplementCatalogItem): string {
  return (item.components || [])
    .slice(0, 3)
    .map((component) => `${component.name} ${component.amount}${component.unit}`)
    .join(' · ')
}

export default function SupplementCatalogPage() {
  const [query, setQuery] = useState('')
  const [items, setItems] = useState<SupplementCatalogItem[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    const timer = setTimeout(() => {
      setLoading(true)
      void listSupplementCatalog(query)
        .then((result) => { if (active) setItems(result) })
        .catch(async (error) => {
          if (!active) return
          setItems([])
          await showUnifiedApiError(error, '加载公共补剂库失败')
        })
        .finally(() => { if (active) setLoading(false) })
    }, 250)
    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [query])

  const choose = (item: SupplementCatalogItem) => {
    Taro.setStorageSync(SUPPLEMENT_CATALOG_SELECTION_KEY, item)
    Taro.navigateBack()
  }

  return (
    <FlPageThemeRoot>
      <View className='supplement-catalog-page'>
        <View className='supplement-catalog-hero'>
          <Text className='supplement-catalog-title'>从补剂库选择</Text>
          <Text className='supplement-catalog-sub'>选择模板后会自动填写成分，保存前请按照自己的瓶身标签核对。</Text>
          <View className='supplement-catalog-search'>
            <Text className='iconfont icon-sousuo' />
            <Input value={query} placeholder='搜索维生素、矿物质或功能成分' onInput={(event) => setQuery(event.detail.value)} />
          </View>
        </View>

        <ScrollView scrollY className='supplement-catalog-scroll'>
          {loading ? (
            <View className='supplement-catalog-skeletons'>{[0, 1, 2, 3].map((key) => <View key={key} className='supplement-catalog-skeleton' />)}</View>
          ) : (
            <View className='supplement-catalog-list'>
              {items.map((item) => (
                <View key={item.id} className='supplement-catalog-card' onClick={() => choose(item)}>
                  <View className='supplement-catalog-icon'><Text className='iconfont icon-yiliaohangyedeICON-' /></View>
                  <View className='supplement-catalog-copy'>
                    <View className='supplement-catalog-name-row'>
                      <Text className='supplement-catalog-name'>{item.name}</Text>
                      <Text className='supplement-catalog-category'>{CATEGORY_LABELS[item.category] || '补剂'}</Text>
                    </View>
                    <Text className='supplement-catalog-components'>{componentSummary(item)}</Text>
                    <Text className='supplement-catalog-description'>{item.description}</Text>
                  </View>
                  <Text className='supplement-catalog-pick'>选用</Text>
                </View>
              ))}
              {!items.length && (
                <View className='supplement-catalog-empty'>
                  <Text className='supplement-catalog-empty-title'>暂时没有匹配模板</Text>
                  <Text className='supplement-catalog-empty-sub'>返回后可以拍摄瓶身标签添加。</Text>
                </View>
              )}
            </View>
          )}
          <Text className='supplement-catalog-note'>模板仅用于快速记录，不代表推荐剂量。</Text>
        </ScrollView>
      </View>
    </FlPageThemeRoot>
  )
}
