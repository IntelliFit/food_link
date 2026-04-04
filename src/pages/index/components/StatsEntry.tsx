import { View, Text } from '@tarojs/components'
import { IconTrendingUp, IconChevronRight } from '../../../components/iconfont'

interface StatsEntryProps {
  onClick: () => void
}

export function StatsEntry({ onClick }: StatsEntryProps) {
  return (
    <View className='stats-entry-section' onClick={onClick}>
      <View className='stats-entry-card'>
        <View className='stats-entry-icon'>
          <IconTrendingUp size={24} color='#ffffff' />
        </View>
        <View className='stats-entry-text'>
          <Text className='stats-entry-title'>查看饮食统计</Text>
          <Text className='stats-entry-desc'>了解您的饮食趋势和营养分析</Text>
        </View>
        <IconChevronRight size={20} color='#ffffff' />
      </View>
    </View>
  )
}
