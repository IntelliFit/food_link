import { Button, Input, Text, View } from '@tarojs/components'
import Taro, { useDidShow } from '@tarojs/taro'
import { useState } from 'react'
import { bindPhone, clearAllStorage, deleteAccount, getUserProfile, showUnifiedApiError } from '../../../utils/api'
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
  const [deleteDialogVisible, setDeleteDialogVisible] = useState(false)
  const [deleteConfirmation, setDeleteConfirmation] = useState('')
  const [deleting, setDeleting] = useState(false)

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

  const closeDeleteDialog = () => {
    if (deleting) return
    setDeleteDialogVisible(false)
    setDeleteConfirmation('')
  }

  const handleDeleteAccount = async () => {
    if (deleting || deleteConfirmation.trim() !== '注销账号') return
    try {
      setDeleting(true)
      await deleteAccount(deleteConfirmation.trim())
      clearAllStorage()
      Taro.showToast({ title: '账号已注销', icon: 'success' })
      setTimeout(() => {
        Taro.reLaunch({ url: '/pages/index/index' })
      }, 900)
    } catch (error) {
      console.error('[account-security] delete account failed:', error)
      await showUnifiedApiError(error, '注销失败，请稍后重试')
    } finally {
      setDeleting(false)
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

      <View className='account-security-danger-card'>
        <View className='account-security-danger-heading'>
          <View className='account-security-danger-icon'>
            <Text className='iconfont icon-jiesuo account-security-danger-icon-text' />
          </View>
          <View className='account-security-danger-copy'>
            <Text className='account-security-danger-title'>注销账号</Text>
            <Text className='account-security-danger-description'>注销后将永久删除你的健康档案、记录和账户资料，且无法恢复。</Text>
          </View>
        </View>
        <Button className='account-security-delete-btn' onClick={() => setDeleteDialogVisible(true)}>注销账号</Button>
      </View>

      {deleteDialogVisible && (
        <View className='account-security-dialog-mask' onClick={closeDeleteDialog}>
          <View className='account-security-dialog' onClick={(event) => event.stopPropagation()}>
            <Text className='account-security-dialog-title'>确认注销账号</Text>
            <Text className='account-security-dialog-description'>这是不可恢复的操作。请输入“注销账号”后继续。</Text>
            <Text className='account-security-dialog-label'>确认文案</Text>
            <Input className='account-security-dialog-input' value={deleteConfirmation} placeholder='注销账号' maxlength={8} onInput={(event) => setDeleteConfirmation(event.detail.value)} />
            <View className='account-security-dialog-actions'>
              <Button className='account-security-dialog-cancel' disabled={deleting} onClick={closeDeleteDialog}>取消</Button>
              <Button className={`account-security-dialog-confirm ${deleteConfirmation.trim() === '注销账号' ? '' : 'account-security-dialog-confirm--disabled'}`} disabled={deleting || deleteConfirmation.trim() !== '注销账号'} onClick={handleDeleteAccount}>
                {deleting ? <View className='account-security-btn-spinner account-security-btn-spinner--danger' /> : '确认注销'}
              </Button>
            </View>
          </View>
        </View>
      )}
    </View>
  )
}

export default withAuth(AccountSecurity)
