import { useEffect, useState } from 'react'
import { View, Text, Image } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { FlPageThemeRoot } from '../../../components/FlPageThemeRoot'
import { useAppColorScheme } from '../../../components/AppColorSchemeContext'
import { applyThemeNavigationBar } from '../../../utils/theme-navigation-bar'
import {
  getDefaultUserGroupQr,
  type UserGroupQrConfig,
} from './group-config'
import './index.scss'

export default function UserGroupPage() {
  const { scheme } = useAppColorScheme()
  const [activeGroup] = useState<UserGroupQrConfig>(getDefaultUserGroupQr())

  useEffect(() => {
    applyThemeNavigationBar(scheme, { lightBackground: '#f7faf8', darkBackground: '#101716' })
  }, [scheme])

  const handlePreviewQr = () => {
    Taro.previewImage({
      current: activeGroup.qrImage,
      urls: [activeGroup.qrImage],
    })
  }

  const handleCopyGroupName = async () => {
    await Taro.setClipboardData({ data: activeGroup.title })
    Taro.showToast({ title: '群名已复制', icon: 'success' })
  }

  return (
    <FlPageThemeRoot>
      <View className={`user-group-page ${scheme === 'dark' ? 'user-group-page--dark' : ''}`}>
        <View className='user-group-hero'>
          <Text className='user-group-eyebrow'>食探交流群</Text>
          <Text className='user-group-title'>一起把食探做得更好用</Text>
          <Text className='user-group-subtitle'>反馈识别问题、提功能建议，也可以看看其他用户怎么记录饮食。</Text>
        </View>

        <View className='qr-card'>
          <View className='qr-card__head'>
            <View className='qr-card__copy'>
              <Text className='qr-card__title'>{activeGroup.title}</Text>
              <Text className='qr-card__subtitle'>{activeGroup.subtitle}</Text>
            </View>
            <View className='qr-card__tag'>
              <Text className='qr-card__tag-text'>永久有效</Text>
            </View>
          </View>

          <View className='qr-frame' onClick={handlePreviewQr}>
            <Image
              className='qr-image'
              src={activeGroup.qrImage}
              mode='aspectFit'
              showMenuByLongpress
            />
          </View>

          <Text className='qr-expiry'>这是当前唯一用户群二维码，可长期使用</Text>

          <View className='action-row'>
            <View className='primary-action' onClick={handlePreviewQr}>
              <Text className='primary-action__text'>打开二维码</Text>
            </View>
            <View className='secondary-action' onClick={handleCopyGroupName}>
              <Text className='secondary-action__text'>复制群名</Text>
            </View>
          </View>
        </View>

        <View className='hint-card'>
          <Text className='hint-title'>加入方式</Text>
          <Text className='hint-text'>点击二维码可放大查看；也可以长按二维码，在微信菜单中识别或保存图片。</Text>
        </View>
      </View>
    </FlPageThemeRoot>
  )
}
