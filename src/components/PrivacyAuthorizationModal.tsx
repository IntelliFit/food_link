import { Button, Text, View } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { useEffect, useRef, useState } from 'react'
import './PrivacyAuthorizationModal.scss'

declare const wx: any

type PrivacyResolvePayload = {
  event: 'agree' | 'disagree'
  buttonId: string
}

type PrivacyResolve = (payload: PrivacyResolvePayload) => void

const DEFAULT_PRIVACY_CONTRACT_NAME = '《用户隐私保护指引》'

function getWxPrivacyApi(): any {
  if (typeof wx !== 'undefined') return wx
  return Taro as any
}

export function PrivacyAuthorizationModal() {
  const [visible, setVisible] = useState(false)
  const [contractName, setContractName] = useState(DEFAULT_PRIVACY_CONTRACT_NAME)
  const resolveRef = useRef<PrivacyResolve | null>(null)

  const refreshPrivacyContractName = () => {
    const wxApi = getWxPrivacyApi()
    if (typeof wxApi.getPrivacySetting !== 'function') return
    wxApi.getPrivacySetting({
      success: (res: { privacyContractName?: string }) => {
        const nextName = String(res?.privacyContractName || '').trim()
        if (nextName) {
          setContractName(nextName)
        }
      },
    })
  }

  useEffect(() => {
    refreshPrivacyContractName()
    const wxApi = getWxPrivacyApi()
    if (typeof wxApi.onNeedPrivacyAuthorization !== 'function') return

    const handleNeedPrivacyAuthorization = (resolve: PrivacyResolve) => {
      resolveRef.current = resolve
      refreshPrivacyContractName()
      setVisible(true)
    }

    wxApi.onNeedPrivacyAuthorization(handleNeedPrivacyAuthorization)
    return () => {
      if (typeof wxApi.offNeedPrivacyAuthorization === 'function') {
        wxApi.offNeedPrivacyAuthorization(handleNeedPrivacyAuthorization)
      }
    }
  }, [])

  const settle = (event: PrivacyResolvePayload['event'], buttonId: string) => {
    const resolve = resolveRef.current
    resolveRef.current = null
    setVisible(false)
    if (resolve) {
      resolve({ event, buttonId })
    }
  }

  const handleOpenContract = () => {
    const wxApi = getWxPrivacyApi()
    if (typeof wxApi.openPrivacyContract !== 'function') return
    wxApi.openPrivacyContract({
      fail: () => {
        Taro.showToast({ title: '暂时无法打开隐私指引', icon: 'none' })
      },
    })
  }

  if (!visible) return null

  return (
    <View className='privacy-auth-mask'>
      <View className='privacy-auth-dialog'>
        <Text className='privacy-auth-title'>隐私保护指引</Text>
        <Text className='privacy-auth-desc'>
          为了使用拍照识别、相册选图、位置等功能，请先阅读并同意
          <Text className='privacy-auth-link' onClick={handleOpenContract}>{contractName}</Text>
          。
        </Text>
        <View className='privacy-auth-actions'>
          <Button
            id='privacy-disagree-btn'
            className='privacy-auth-btn privacy-auth-btn--ghost'
            onClick={() => settle('disagree', 'privacy-disagree-btn')}
          >
            暂不同意
          </Button>
          <Button
            id='privacy-agree-btn'
            className='privacy-auth-btn privacy-auth-btn--primary'
            openType={'agreePrivacyAuthorization' as any}
            onAgreePrivacyAuthorization={() => settle('agree', 'privacy-agree-btn')}
          >
            同意并继续
          </Button>
        </View>
      </View>
    </View>
  )
}
