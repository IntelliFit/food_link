import { View, Text, Image, Button, Input } from '@tarojs/components'
import { useState, useEffect } from 'react'
import Taro from '@tarojs/taro'
import { updateUserInfo, uploadUserAvatar, imageToBase64, showUnifiedApiError } from '../../../utils/api'
import { FlPageThemeRoot } from '../../../components/FlPageThemeRoot'
import { useAppColorScheme } from '../../../components/AppColorSchemeContext'
import CustomNavBar, { getNavBarHeight } from '../../../components/CustomNavBar'
import './index.scss'

export default function ProfileSettingsPage() {
  const { scheme } = useAppColorScheme()
  const [tempAvatar, setTempAvatar] = useState('')
  const [tempNickname, setTempNickname] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const stored = Taro.getStorageSync('userInfo')
    if (stored) {
      setTempAvatar(stored.avatar || '')
      setTempNickname(stored.name || '')
    }
  }, [])

  const handleChooseAvatar = async (e: any) => {
    const { avatarUrl } = e.detail
    const needUpload = avatarUrl && !avatarUrl.startsWith('https://')

    if (needUpload) {
      Taro.showLoading({ title: '上传中...' })
      try {
        const base64 = await imageToBase64(avatarUrl)
        const { imageUrl } = await uploadUserAvatar(base64)
        setTempAvatar(imageUrl)
        Taro.hideLoading()
      } catch (err: any) {
        Taro.hideLoading()
        await showUnifiedApiError(err, '上传失败')
      }
    } else {
      setTempAvatar(avatarUrl)
    }
  }

  const handleNicknameInput = (e: any) => {
    setTempNickname(e.detail.value)
  }

  const handleNicknameBlur = (e: any) => {
    setTempNickname(e.detail.value)
  }

  const handleSave = async () => {
    if (!tempAvatar || !tempNickname) {
      Taro.showToast({ title: '请完善头像和昵称', icon: 'none' })
      return
    }

    setLoading(true)
    Taro.showLoading({ title: '保存中...' })
    try {
      await updateUserInfo({
        nickname: tempNickname,
        avatar: tempAvatar
      })

      const newUserInfo = { avatar: tempAvatar, name: tempNickname, meta: '' }
      const stored = Taro.getStorageSync('userInfo')
      if (stored) {
        newUserInfo.meta = stored.meta || ''
      }
      Taro.setStorageSync('userInfo', newUserInfo)

      Taro.hideLoading()
      Taro.showToast({ title: '保存成功', icon: 'success' })
      setTimeout(() => {
        Taro.navigateBack()
      }, 600)
    } catch (err: any) {
      Taro.hideLoading()
      await showUnifiedApiError(err, '保存失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <FlPageThemeRoot>
    <View className={`profile-settings-page ${scheme === 'dark' ? 'profile-settings-page--dark' : ''}`}>
      <CustomNavBar
        title='个人设置'
        showBack
        color={scheme === 'dark' ? '#ffffff' : '#000000'}
        background={scheme === 'dark' ? '#101716' : '#f8fafc'}
      />
      <View className='settings-card'>
        <View className='avatar-section'>
          <Text className='form-label'>更换头像</Text>
          <Button
            className='avatar-choose-btn'
            openType='chooseAvatar'
            onChooseAvatar={handleChooseAvatar}
          >
            <View className='avatar-choose-wrapper'>
              {tempAvatar ? (
                <Image src={tempAvatar} className='avatar-preview' mode='aspectFill' />
              ) : (
                <View className='avatar-placeholder'>
                  <Text className='avatar-placeholder-text'>点击选择</Text>
                </View>
              )}
            </View>
          </Button>
        </View>

        <View className='nickname-section'>
          <Text className='form-label'>修改昵称</Text>
          <Input
            className='nickname-input'
            type='nickname'
            placeholder='请输入昵称'
            value={tempNickname}
            onBlur={handleNicknameBlur}
            onInput={handleNicknameInput}
          />
        </View>
      </View>

      <Button className='save-btn' onClick={handleSave} disabled={loading}>
        保存
      </Button>
    </View>
    </FlPageThemeRoot>
  )
}
