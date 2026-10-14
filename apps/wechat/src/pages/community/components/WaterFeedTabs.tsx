import { Text, View } from '@tarojs/components'
import * as React from 'react'

type Scope = 'priority' | 'public' | 'all'
type Props = { scope: Scope; onSelect: (scope: Scope) => void; onPublish: () => void }

/** Publish stays in the normal document flow instead of covering feed content. */
export function WaterFeedTabs({ scope, onSelect, onPublish }: Props) {
  return <View className='water-feed-tabs'>
    <View className='water-feed-tabs__controls'>
      {([{ key: 'priority', label: '关注' }, { key: 'public', label: '发现' }, { key: 'all', label: '附近' }] as const).map(tab => <View key={tab.key} role='button' aria-pressed={scope === tab.key} className={`water-feed-tabs__tab${scope === tab.key ? ' is-active' : ''}`} onClick={() => onSelect(tab.key)}><Text>{tab.label}</Text></View>)}
      <View id='water-feed-publish' className='water-feed-tabs__publish' role='button' aria-label='发布动态' hoverClass='water-feed-tabs__publish--pressed' onClick={onPublish}><Text>＋ 发布</Text></View>
    </View>
    <Text className='water-feed-tabs__verse'>同一片水面，连着不同的生活</Text>
  </View>
}
