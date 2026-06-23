import { View, Text, Image, Button } from '@tarojs/components'
import { Button as TaroifyButton } from '@taroify/core'
import '@taroify/core/button/style'
import './NewUserOnboardingModals.scss'

export interface NewUserOnboardingModalsProps {
  showProfileForm: boolean
  showPhoneBindModal: boolean
  tempAvatar: string
  tempNickname: string
  onChooseAvatar: (e: { detail?: { avatarUrl?: string } }) => void | Promise<void>
  onUseWechatProfile?: () => void | Promise<void>
  onNicknameInput: (value: string) => void
  onNicknameBlur?: (e: { detail?: { value?: string } }) => void
  onSaveProfile: () => void
  onBindPhone: (e: { detail?: { code?: string } }) => void | Promise<void>
  onSkipPhone: () => void
  profileSaveLabel?: string
  /** 调试预览角标，例如「仅 UI 预览」 */
  previewBadge?: string
}

export function NewUserOnboardingModals({
  showProfileForm,
  showPhoneBindModal,
  tempAvatar,
  tempNickname,
  onUseWechatProfile,
  onSaveProfile,
  onBindPhone,
  onSkipPhone,
  profileSaveLabel = '进入首页',
  previewBadge,
}: NewUserOnboardingModalsProps) {
  const handleUseWechatProfile = onUseWechatProfile || (() => {})

  return (
    <>
      {showPhoneBindModal && (
        <View className='nuo-modals profile-form-modal phone-bind-modal'>
          {previewBadge ? (
            <View className='nuo-modals-preview-badge'>
              <Text className='nuo-modals-preview-badge-text'>{previewBadge}</Text>
            </View>
          ) : null}
          <View className='profile-form-content'>
            <View className='profile-form-header'>
              <Text className='profile-form-title'>完善账号</Text>
              <Text className='profile-form-desc'>授权手机号便于好友搜索与账号安全</Text>
            </View>
            <View className='phone-bind-actions'>
              <Button
                className='wx-login-btn-native phone-bind-btn'
                openType='getPhoneNumber'
                onGetPhoneNumber={onBindPhone}
              >
                授权手机号
              </Button>
              <TaroifyButton className='skip-phone-btn' variant='text' onClick={onSkipPhone}>
                暂不绑定
              </TaroifyButton>
            </View>
          </View>
        </View>
      )}

      {showProfileForm && (
        <View className='nuo-modals profile-form-modal'>
          {previewBadge ? (
            <View className='nuo-modals-preview-badge'>
              <Text className='nuo-modals-preview-badge-text'>{previewBadge}</Text>
            </View>
          ) : null}
          <View className='profile-form-content'>
            <View className='profile-form-header'>
              <Text className='profile-form-title'>完善个人信息</Text>
              <Text className='profile-form-desc'>点击头像或昵称，授权后一键使用微信资料</Text>
            </View>
            <View className='profile-form-body'>
              <View
                className='avatar-choose-wrapper'
                onClick={handleUseWechatProfile}
              >
                {tempAvatar ? (
                  <Image src={tempAvatar} className='avatar-image' mode='aspectFill' />
                ) : (
                  <Text
                    className='iconfont icon-camera camera-icon'
                    style={{ fontSize: '60rpx', color: '#ccc' }}
                  >
                    📷
                  </Text>
                )}
                <View className='choose-tip'>点击使用微信头像</View>
              </View>

              <View className='nickname-picker' onClick={handleUseWechatProfile}>
                <Text className={`nickname-picker-value ${tempNickname ? '' : 'placeholder'}`}>
                  {tempNickname || '点击使用微信昵称'}
                </Text>
                <Text className='nickname-picker-action'>点击授权</Text>
              </View>
            </View>

            <TaroifyButton
              className='save-btn'
              block
              shape='round'
              disabled={!tempAvatar || !tempNickname}
              onClick={onSaveProfile}
            >
              {profileSaveLabel}
            </TaroifyButton>
            {(!tempAvatar || !tempNickname) && (
              <Text className='profile-form-tip'>请完善头像和昵称后再进入</Text>
            )}
          </View>
        </View>
      )}
    </>
  )
}
