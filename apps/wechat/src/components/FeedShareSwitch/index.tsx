import { Switch, Text, View } from '@tarojs/components'
import { feedShareAudienceText } from '../../utils/feed-share'
import './index.scss'

interface FeedShareSwitchProps {
  value: boolean
  accountPublic: boolean
  onChange: (value: boolean) => void
  disabled?: boolean
}

export default function FeedShareSwitch({ value, accountPublic, onChange, disabled }: FeedShareSwitchProps) {
  return (
    <View className='feed-share-switch'>
      <View className='feed-share-switch-copy'>
        <Text className='feed-share-switch-title'>同步到圈子</Text>
        <Text className='feed-share-switch-audience'>{feedShareAudienceText(value, accountPublic)}</Text>
      </View>
      <Switch
        className='feed-share-switch-control'
        checked={value}
        disabled={disabled}
        color='#00bc7d'
        onChange={(event) => onChange(event.detail.value)}
      />
    </View>
  )
}
