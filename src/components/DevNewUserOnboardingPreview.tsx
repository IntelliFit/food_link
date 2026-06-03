import { View, Text } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { useCallback, useState } from 'react'
import { NewUserOnboardingModals } from './NewUserOnboardingModals'
import { processChooseAvatarSelection } from '../utils/new-user-profile-form'
import {
  NEW_USER_ONBOARDING_SCENARIOS,
  type NewUserOnboardingScenario,
} from '../utils/new-user-onboarding-scenarios'
import './DevNewUserOnboardingPreview.scss'

interface DevNewUserOnboardingPreviewProps {
  visible: boolean
  onClose: () => void
}

/** 开发态：在首页内预览登录页新用户引导弹窗，不跳转分包页面 */
export function DevNewUserOnboardingPreview({ visible, onClose }: DevNewUserOnboardingPreviewProps) {
  const [pickerOpen, setPickerOpen] = useState(true)
  const [activeScenario, setActiveScenario] = useState<NewUserOnboardingScenario | null>(null)
  const [showProfileForm, setShowProfileForm] = useState(false)
  const [showPhoneBindModal, setShowPhoneBindModal] = useState(false)
  const [tempAvatar, setTempAvatar] = useState('')
  const [tempNickname, setTempNickname] = useState('')
  const [chainPhoneAfterProfile, setChainPhoneAfterProfile] = useState(false)

  const resetModalState = useCallback(() => {
    setShowProfileForm(false)
    setShowPhoneBindModal(false)
    setTempAvatar('')
    setTempNickname('')
    setChainPhoneAfterProfile(false)
    setActiveScenario(null)
    setPickerOpen(true)
  }, [])

  const handleCloseAll = useCallback(() => {
    resetModalState()
    onClose()
  }, [onClose, resetModalState])

  const openScenario = useCallback((scenario: NewUserOnboardingScenario) => {
    setActiveScenario(scenario)
    setTempAvatar(scenario.initialAvatar || '')
    setTempNickname(scenario.initialNickname || '')
    setChainPhoneAfterProfile(Boolean(scenario.chainPhoneBind))
    setPickerOpen(false)

    if (scenario.openPhoneBind) {
      setShowProfileForm(false)
      setShowPhoneBindModal(true)
      return
    }
    setShowPhoneBindModal(false)
    setShowProfileForm(true)
  }, [])

  const handleChooseAvatar = async (e: { detail?: { avatarUrl?: string } }) => {
    const avatarUrl = e.detail?.avatarUrl
    if (!avatarUrl) return
    await processChooseAvatarSelection(avatarUrl, setTempAvatar)
  }

  const handleSaveProfile = () => {
    if (!tempAvatar || !tempNickname) {
      Taro.showToast({ title: '请完善头像和昵称', icon: 'none' })
      return
    }
    Taro.showToast({ title: '预览：已模拟保存资料', icon: 'none', duration: 2000 })
    setShowProfileForm(false)
    if (chainPhoneAfterProfile) {
      setTimeout(() => {
        setShowPhoneBindModal(true)
      }, 400)
      return
    }
    handleCloseAll()
  }

  const handleBindPhone = async (e: { detail?: { code?: string } }) => {
    const phoneCode = e.detail?.code
    if (!phoneCode) {
      Taro.showToast({ title: '预览：未授权手机号', icon: 'none' })
      handleCloseAll()
      return
    }
    Taro.showToast({ title: '预览：已模拟绑定手机号', icon: 'success' })
    handleCloseAll()
  }

  const handleSkipPhone = () => {
    Taro.showToast({ title: '预览：跳过绑定', icon: 'none' })
    handleCloseAll()
  }

  if (!visible || !__ENABLE_DEV_DEBUG_UI__) {
    return null
  }

  const modalVisible = showProfileForm || showPhoneBindModal

  return (
    <View className='dev-onboarding-preview-root'>
      {pickerOpen && !modalVisible && (
        <View className='dev-onboarding-preview-sheet'>
          <View className='dev-onboarding-preview-sheet-inner'>
            <View className='dev-onboarding-preview-header'>
              <Text className='dev-onboarding-preview-title'>新用户引导预览</Text>
              <Text className='dev-onboarding-preview-sub'>
                与登录页弹窗相同，不调保存/绑定接口。正式注册走「登录页」而非本工具。
              </Text>
            </View>
            <View className='dev-onboarding-preview-list'>
              {NEW_USER_ONBOARDING_SCENARIOS.map((scenario) => (
                <View
                  key={scenario.id}
                  className='dev-onboarding-preview-item'
                  onClick={() => openScenario(scenario)}
                >
                  <Text className='dev-onboarding-preview-item-title'>{scenario.title}</Text>
                  <Text className='dev-onboarding-preview-item-desc'>{scenario.desc}</Text>
                </View>
              ))}
            </View>
            <View className='dev-onboarding-preview-footer'>
              <View className='dev-onboarding-preview-cancel' onClick={handleCloseAll}>
                <Text className='dev-onboarding-preview-cancel-text'>关闭</Text>
              </View>
            </View>
          </View>
        </View>
      )}

      {modalVisible && (
        <>
          <View className='dev-onboarding-preview-backdrop' onClick={handleCloseAll} />
          <View className='dev-onboarding-preview-close-bar'>
            <View className='dev-onboarding-preview-close-btn' onClick={handleCloseAll}>
              <Text className='dev-onboarding-preview-close-text'>关闭预览</Text>
            </View>
          </View>
          <NewUserOnboardingModals
            showProfileForm={showProfileForm}
            showPhoneBindModal={showPhoneBindModal}
            tempAvatar={tempAvatar}
            tempNickname={tempNickname}
            onChooseAvatar={handleChooseAvatar}
            onNicknameInput={setTempNickname}
            onSaveProfile={handleSaveProfile}
            onBindPhone={handleBindPhone}
            onSkipPhone={handleSkipPhone}
            profileSaveLabel={
              chainPhoneAfterProfile && showProfileForm ? '保存并继续' : '进入首页'
            }
            previewBadge={
              activeScenario ? `UI 预览 · ${activeScenario.title}` : 'UI 预览'
            }
          />
        </>
      )}
    </View>
  )
}
