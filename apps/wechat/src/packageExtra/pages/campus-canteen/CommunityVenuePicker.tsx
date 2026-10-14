import { useEffect, useMemo, useState } from 'react'
import { View, Text, Input, ScrollView, Button } from '@tarojs/components'
import type { CanteenLocationItem } from '../../../utils/api'

export interface CommunityOrganization {
  key: string
  name: string
  city: string
  district: string
}

interface Props {
  mode: 'organization' | 'canteen' | null
  organization: CommunityOrganization | null
  canteen: CanteenLocationItem | null
  locations: CanteenLocationItem[]
  loading: boolean
  error: boolean
  onOrganization: (value: CommunityOrganization | null) => void
  onCanteen: (value: CanteenLocationItem | null) => void
  onRetry: () => void
  onClose: () => void
}

export default function CommunityVenuePicker(props: Props) {
  const [keyword, setKeyword] = useState('')
  useEffect(() => { setKeyword('') }, [props.mode, props.organization?.key])
  const organizations = useMemo(() => {
    const byKey = new Map<string, CommunityOrganization>()
    for (const location of props.locations) {
      byKey.set(location.organization_key, { key: location.organization_key, name: location.organization_name, city: location.city, district: location.district })
    }
    return [...byKey.values()]
  }, [props.locations])
  const query = keyword.trim().toLowerCase()
  const visibleOrganizations = organizations.filter((item) => [item.name, item.city, item.district].join(' ').toLowerCase().includes(query))
  const visibleCanteens = props.locations.filter((item) => item.organization_key === props.organization?.key && [item.canteen_name, item.address].join(' ').toLowerCase().includes(query))
  if (!props.mode) return null
  const isOrganization = props.mode === 'organization'
  return (
    <View className='community-picker-overlay' onClick={props.onClose}>
      <View className='community-picker-sheet' onClick={(e) => e.stopPropagation()}>
        <View className='community-picker-head'>
          <Text className='community-picker-title'>{isOrganization ? '选择社区 / 园区' : '选择食堂'}</Text>
          <Button className='community-picker-close' ariaLabel='关闭地点选择' onClick={props.onClose}>×</Button>
        </View>
        <Input className='community-picker-search' placeholder={isOrganization ? '搜社区、园区或城市' : '搜食堂名称'} value={keyword} onInput={(e) => setKeyword(e.detail.value)} />
        <ScrollView className='community-picker-list' scrollY showScrollbar={false}>
          <Button id='community-location-all' className='community-picker-option' onClick={() => isOrganization ? props.onOrganization(null) : props.onCanteen(null)}>{isOrganization ? '全部社区与园区' : '全部食堂'}</Button>
          {props.loading ? <View className='loading-state'><View className='loading-spinner-md' /></View> : props.error ? (
            <View className='community-picker-empty'><Text>地点列表暂时不可用</Text><Button className='community-picker-retry' onClick={props.onRetry}>重试</Button></View>
          ) : (isOrganization ? visibleOrganizations.length : visibleCanteens.length) === 0 ? (
            <View className='community-picker-empty'><Text>{query ? '没有找到匹配的地点' : '暂无已收录地点'}</Text></View>
          ) : isOrganization ? visibleOrganizations.map((item) => (
            <Button key={item.key} id={`community-organization-${item.key}`} className={`community-picker-option ${props.organization?.key === item.key ? 'active' : ''}`} onClick={() => props.onOrganization(item)}>
              <Text className='community-picker-name'>{item.name}</Text>
              <Text className='community-picker-caption'>{[item.city, item.district].filter(Boolean).join(' · ')}</Text>
            </Button>
          )) : visibleCanteens.map((item) => (
            <Button key={item.canteen_key} id={`community-canteen-${item.canteen_key}`} className={`community-picker-option ${props.canteen?.canteen_key === item.canteen_key ? 'active' : ''}`} onClick={() => props.onCanteen(item)}>
              <Text className='community-picker-name'>{item.canteen_name}</Text>
              <Text className='community-picker-caption'>{item.address || props.organization?.name}</Text>
            </Button>
          ))}
        </ScrollView>
      </View>
    </View>
  )
}
