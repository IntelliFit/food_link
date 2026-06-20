import { Button, Text, View } from '@tarojs/components'
import Taro, { useDidShow } from '@tarojs/taro'
import { useState } from 'react'
import { bindPhone, getUserProfile, showUnifiedApiError } from '../../../utils/api'
import type { UserInfo } from '../../../utils/api'
import { withAuth } from '../../../utils/withAuth'
import './index.scss'

function maskPhone(phone?: string | null): string {
  const digits = String(phone || '').replace(/\D/g, '')
  const normalized = digits.length > 11 ? digits.slice(-11) : digits
  if (normalized.length !== 11) return ''
  return `${normalized.slice(0, 3)}****${normalized.slice(7)}`
}

function AccountSecurity() {
  const [profile, setProfile] = useState<UserInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [binding, setBinding] = useState(false)

  const phone = profile?.telephone || ''
  const maskedPhone = maskPhone(phone)
  const hasPhone = Boolean(maskedPhone)

  const loadProfile = async () => {
    try {
      setLoading(true)
      const data = await getUserProfile()
      setProfile(data)
      if (data.telephone) {
        Taro.setStorageSync('phoneNumber', data.telephone)
      }
    } catch (error) {
      console.error('[account-security] load profile failed:', error)
      await showUnifiedApiError(error, '加载失败')
    } finally {
      setLoading(false)
    }
  }

  useDidShow(() => {
    void loadProfile()
  })

  const handleBindPhone = async (event: { detail?: { code?: string } }) => {
    if (binding || hasPhone) return

    const phoneCode = event.detail?.code
    if (!phoneCode) {
      Taro.showToast({ title: '未授权手机号', icon: 'none' })
      return
    }

    try {
      setBinding(true)
      const result = await bindPhone(phoneCode)
      const nextPhone = result.purePhoneNumber || result.telephone
      if (nextPhone) {
        Taro.setStorageSync('phoneNumber', nextPhone)
        setProfile(prev => prev ? { ...prev, telephone: nextPhone } : prev)
      }
      Taro.showToast({ title: '绑定成功', icon: 'success' })
      await loadProfile()
    } catch (error) {
      console.error('[account-security] bind phone failed:', error)
      await showUnifiedApiError(error, '绑定失败')
    } finally {
      setBinding(false)
    }
  }

  if (loading && !profile) {
    return (
      <View className='account-security-page account-security-page--center'>
        <View className='account-security-spinner' />
      </View>
    )
  }

  return (
    <View className='account-security-page'>
      <View className='account-security-hero'>
        <View className='account-security-hero-icon'>
          <Text className='iconfont icon-user account-security-hero-icon-text' />
        </View>
        <View className='account-security-hero-copy'>
          <Text className='account-security-title'>账号安全</Text>
          <Text className='account-security-subtitle'>手机号用于跨端登录、好友搜索与账号找回。</Text>
        </View>
      </View>

      <View className='account-security-card'>
        <View className='account-security-row'>
          <View className='account-security-row-main'>
            <Text className='account-security-row-label'>手机号</Text>
            <Text className='account-security-row-value'>{hasPhone ? maskedPhone : '未绑定'}</Text>
          </View>
          <View className={`account-security-status ${hasPhone ? 'account-security-status--ok' : ''}`}>
            <Text className='account-security-status-text'>{hasPhone ? '已绑定' : '待绑定'}</Text>
          </View>
        </View>

        {hasPhone ? (
          <View className='account-security-bound-note'>
            <Text className='account-security-note-text'>当前账号已绑定手机号。</Text>
          </View>
        ) : (
          <View className='account-security-bind-block'>
            <Text className='account-security-note-text'>微信授权后会写入当前账号，不会公开完整号码。</Text>
            <Button
              className={`account-security-bind-btn ${binding ? 'account-security-bind-btn--disabled' : ''}`}
              disabled={binding}
              openType='getPhoneNumber'
              onGetPhoneNumber={handleBindPhone}
            >
              {binding ? <View className='account-security-btn-spinner' /> : <Text className='account-security-bind-text'>授权绑定手机号</Text>}
            </Button>
          </View>
        )}
      </View>
    </View>
  )
}

export default withAuth(AccountSecurity)
