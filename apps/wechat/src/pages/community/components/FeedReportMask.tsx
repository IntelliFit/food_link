import { Text, View } from '@tarojs/components'

import './FeedReportMask.scss'

interface FeedReportMaskProps {
  visible: boolean
  onReport: () => void
  onCancel: () => void
}

export function FeedReportMask({ visible, onReport, onCancel }: FeedReportMaskProps) {
  if (!visible) return null
  return (
    <View className='feed-report-mask' onClick={onCancel}>
      <View className='feed-report-mask-bg' />
      <View className='feed-report-mask-content'>
        <View className='feed-report-mask-btn' onClick={(e) => { e.stopPropagation(); onReport() }}>
          <Text className='feed-report-mask-btn-icon'>🚨</Text>
          <Text className='feed-report-mask-btn-text'>举报</Text>
        </View>
        <View className='feed-report-mask-hint' onClick={(e) => e.stopPropagation()}>
          <Text className='feed-report-mask-hint-text'>长按触发 · 点击空白处取消</Text>
        </View>
      </View>
    </View>
  )
}
