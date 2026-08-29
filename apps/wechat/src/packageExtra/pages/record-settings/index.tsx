import { Switch, Text, View } from '@tarojs/components'
import { useEffect, useState } from 'react'
import Taro from '@tarojs/taro'
import { FlPageThemeRoot } from '../../../components/FlPageThemeRoot'
import { useAppColorScheme } from '../../../components/AppColorSchemeContext'
import { applyThemeNavigationBar } from '../../../utils/theme-navigation-bar'
import { readAutoRecordPreference, saveAutoRecordPreference } from '../../../utils/analyze-task-reminder'
import './index.scss'

export default function RecordSettingsPage() {
  const { scheme } = useAppColorScheme()
  const [autoRecordEnabled, setAutoRecordEnabled] = useState(() => readAutoRecordPreference().enabled)

  const handleAutoRecordChange = (event: { detail: { value: boolean } }) => {
    const enabled = event.detail.value === true
    saveAutoRecordPreference(enabled)
    setAutoRecordEnabled(enabled)
    Taro.showToast({ title: enabled ? '以后识别完成将自动记录' : '已关闭默认自动记录', icon: 'none' })
  }

  useEffect(() => {
    applyThemeNavigationBar(scheme, { lightBackground: '#f5f8f7', darkBackground: '#101716' })
  }, [scheme])

  return (
    <FlPageThemeRoot>
      <View className='record-settings-page'>
        <View className='record-settings-card'>
          <View className='record-settings-row'>
            <View className='record-settings-copy'>
              <Text className='record-settings-title'>识别完成后自动记录</Text>
              <Text className='record-settings-desc'>拍照或文字识别提交后，按拍摄时选择的餐次自动写入饮食记录。</Text>
            </View>
            <Switch
              checked={autoRecordEnabled}
              color='#5cb896'
              onChange={handleAutoRecordChange}
            />
          </View>
        </View>
        <View className='record-settings-note'>
          <Text>需要补拍、选择包装规格、识别失败或内容违规时不会自动记录，小宠物仍会提醒你处理。</Text>
        </View>
      </View>
    </FlPageThemeRoot>
  )
}
