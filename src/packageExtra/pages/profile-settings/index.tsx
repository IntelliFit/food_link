import { View, Text, Image, Button, Input } from '@tarojs/components'
import { useState, useEffect, useCallback } from 'react'
import Taro from '@tarojs/taro'
import { updateUserInfo, uploadUserAvatar, imageToBase64, showUnifiedApiError, clearAllStorage, deleteAccount } from '../../../utils/api'
import { FlPageThemeRoot } from '../../../components/FlPageThemeRoot'
import { useAppColorScheme } from '../../../components/AppColorSchemeContext'
import { applyThemeNavigationBar } from '../../../utils/theme-navigation-bar'
import './index.scss'

export default function ProfileSettingsPage() {
  const { scheme } = useAppColorScheme()
  const [tempAvatar, setTempAvatar] = useState('')
  const [tempNickname, setTempNickname] = useState('')
  const [userId, setUserId] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    applyThemeNavigationBar(scheme, { lightBackground: '#f8fafc', darkBackground: '#101716' })
  }, [scheme])

  useEffect(() => {
    const stored = Taro.getStorageSync('userInfo')
    const cachedUserId = String(Taro.getStorageSync('user_id') || '').trim()
    if (stored) {
      setTempAvatar(stored.avatar || '')
      setTempNickname(stored.name || '')
      setUserId(String(stored.id || cachedUserId).trim())
    } else {
      setUserId(cachedUserId)
    }
  }, [])

  const handleCopyUserId = useCallback(() => {
    const value = userId.trim()
    if (!value) {
      Taro.showToast({ title: '暂无用户ID', icon: 'none' })
      return
    }
    Taro.setClipboardData({
      data: value,
      success: () => {
        Taro.showToast({ title: '已复制用户ID', icon: 'success' })
      },
      fail: (err) => {
        console.error('[profile-settings] copy user id failed:', err)
        Taro.showToast({ title: '复制失败', icon: 'none' })
      }
    })
  }, [userId])

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

  const handleDeleteAccount = async () => {
    const modalRes = await Taro.showModal({
      title: '注销账号',
      content: '注销后，您的账号及健康记录、饮食分析历史、好友关系等数据会被删除，本地登录状态也会清空。确定要注销账号吗？',
      confirmText: '确认注销',
      confirmColor: '#ef4444',
      cancelText: '再想想'
    })
    if (!modalRes.confirm) return

    try {
      Taro.showLoading({ title: '注销中...' })
      await deleteAccount()
      clearAllStorage()
      Taro.hideLoading()
      Taro.showToast({ title: '已注销账号', icon: 'success' })
      setTimeout(() => {
        Taro.switchTab({ url: '/pages/index/index' })
      }, 1200)
    } catch (error) {
      Taro.hideLoading()
      console.error('注销账号失败:', error)
      await showUnifiedApiError(error, '注销失败')
    }
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

      const stored = Taro.getStorageSync('userInfo')
      const cachedUserId = String(Taro.getStorageSync('user_id') || '').trim()
      const nextUserId = userId || String(stored?.id || cachedUserId).trim()
      const newUserInfo = {
        avatar: tempAvatar,
        name: tempNickname,
        meta: stored?.meta || '',
        id: nextUserId,
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

        {userId && (
          <View className='user-id-section'>
            <View className='user-id-section-head'>
              <Text className='form-label'>用户ID</Text>
              <View className='user-id-copy-btn' onClick={handleCopyUserId}>
                <Text className='user-id-copy-btn-text'>复制</Text>
              </View>
            </View>
            <Text className='user-id-full'>{userId}</Text>
          </View>
        )}
      </View>

      <Button className='save-btn' onClick={handleSave} disabled={loading}>
        保存
      </Button>

      <View className='delete-account-section' onClick={handleDeleteAccount}>
        <Text className='delete-account-text'>注销账号</Text>
      </View>
    </View>
    </FlPageThemeRoot>
  )
}
