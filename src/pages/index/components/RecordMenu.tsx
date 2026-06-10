import { useState, useEffect, useRef } from 'react'
import { View, Text, Input } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { redirectToLogin } from '../../../utils/withAuth'
import { getAccessToken, getMyMembership, showUnifiedApiError, type MembershipStatus } from '../../../utils/api'
import { extraPkgUrl } from '../../../utils/subpackage-extra'
import {
  getFoodAnalysisCreditBlockMessage,
  isFoodAnalysisCreditExhausted,
} from '../../../utils/membership'
import {
  IconCamera,
  IconAlbum,
  IconText,
  IconEdit,
  IconChevronRight,
  IconTrendingUp
} from '../../../components/iconfont'
import {
  openAnalyzePageFromMenu,
  openDebugAnalyzeLoadingFromMenu,
  openDebugHealthProfileFromMenu,
  openDebugRecordDetailPosterFromMenu,
  openDebugResultPageFromMenu
} from '../../../utils/dev-debug-tools'
import { getDevDebugUiTestImageUrl, setDevDebugUiTestImageUrl } from '../../../utils/dev-debug-storage'
import { persistRecordTargetDate } from '../../../utils/record-date'
import { useAppColorScheme } from '../../../components/AppColorSchemeContext'
import { chooseImageWithPrivacy, isPrivacyAuthorizeError, showPrivacyAuthorizeFailure } from '../../../utils/weapp-privacy'
import CreditShortageSheet from '../../../components/CreditShortageSheet'
import { DevNewUserOnboardingPreview } from '../../../components/DevNewUserOnboardingPreview'

interface RecordMenuProps {
  visible: boolean
  onClose: () => void
  selectedDate: string
}

// 顶部2x2网格功能 - 拍照识别、相册上传、文本输入、手动输入
const GRID_FEATURES: Array<{
  id: string
  label: string
  color: string
  backgroundColor: string
  borderColor: string
  iconBackgroundColor: string
  darkColor: string
  darkBackgroundColor: string
  darkBorderColor: string
  darkIconBackgroundColor: string
  Icon: typeof IconCamera
  isNew?: boolean
}> = [
  {
    id: 'camera',
    label: '拍照识别',
    color: '#38a97b',
    backgroundColor: '#f9fefc',
    borderColor: '#d9faeb',
    iconBackgroundColor: '#ebfcf4',
    darkColor: '#6ff6bc',
    darkBackgroundColor: 'rgba(111, 246, 188, 0.10)',
    darkBorderColor: 'rgba(111, 246, 188, 0.22)',
    darkIconBackgroundColor: 'rgba(111, 246, 188, 0.16)',
    Icon: IconCamera,
  },
  {
    id: 'album',
    label: '相册上传',
    color: '#4295bc',
    backgroundColor: '#f9fdfe',
    borderColor: '#d9f2fa',
    iconBackgroundColor: '#ebf7fc',
    darkColor: '#81d6fb',
    darkBackgroundColor: 'rgba(129, 214, 251, 0.10)',
    darkBorderColor: 'rgba(129, 214, 251, 0.22)',
    darkIconBackgroundColor: 'rgba(129, 214, 251, 0.16)',
    Icon: IconAlbum,
  },
  {
    id: 'text',
    label: '文本输入',
    color: '#9f823a',
    backgroundColor: '#fefcf7',
    borderColor: '#f7e9ce',
    iconBackgroundColor: '#fbf5e6',
    darkColor: '#fcd666',
    darkBackgroundColor: 'rgba(252, 214, 102, 0.10)',
    darkBorderColor: 'rgba(252, 214, 102, 0.22)',
    darkIconBackgroundColor: 'rgba(252, 214, 102, 0.16)',
    Icon: IconText,
  },
  {
    id: 'manual',
    label: '手动输入',
    color: '#6951bd',
    backgroundColor: '#fefcfe',
    borderColor: '#e6defa',
    iconBackgroundColor: '#f3effc',
    darkColor: '#b39ef4',
    darkBackgroundColor: 'rgba(179, 158, 244, 0.10)',
    darkBorderColor: 'rgba(179, 158, 244, 0.22)',
    darkIconBackgroundColor: 'rgba(179, 158, 244, 0.16)',
    Icon: IconEdit,
  },
]

const QUICK_ACCESS_ITEMS = [
  {
    id: 'favorites',
    label: '我的收藏',
    desc: '快速记录常吃餐食',
  },
  {
    id: 'history',
    label: '识别记录',
    desc: '查看以往识别记录',
  },
] as const

const MEMBERSHIP_PREFLIGHT_TIMEOUT_MS = 1200

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T | null> {
  return Promise.race([
    promise,
    new Promise<null>((resolve) => {
      setTimeout(() => resolve(null), timeoutMs)
    }),
  ])
}

export function RecordMenu({ visible, onClose, selectedDate }: RecordMenuProps) {
  const { scheme } = useAppColorScheme()
  const isDark = scheme === 'dark'
  const [devToolsOpen, setDevToolsOpen] = useState(false)
  const [onboardingPreviewOpen, setOnboardingPreviewOpen] = useState(false)
  /** 预置测试图 URL（仅 development 本地 UI 调试） */
  const [previewImageUrl, setPreviewImageUrl] = useState('')
  const [creditSheet, setCreditSheet] = useState<{ visible: boolean; membershipStatus: MembershipStatus | null }>({
    visible: false,
    membershipStatus: null,
  })
  /** 弹窗打开时预取会员状态，点击「相册上传」时直接使用缓存结果 */
  const membershipPromiseRef = useRef<Promise<MembershipStatus | null> | null>(null)

  useEffect(() => {
    if (!visible) {
      setDevToolsOpen(false)
      membershipPromiseRef.current = null
      return
    }
    if (__ENABLE_DEV_DEBUG_UI__) {
      setPreviewImageUrl(getDevDebugUiTestImageUrl())
    }
    membershipPromiseRef.current = getMyMembership().catch(() => null)
  }, [visible])

  if (!visible && !onboardingPreviewOpen) return null

  const handleGridClick = (modeId: string) => {
    const recordDate = persistRecordTargetDate(selectedDate)

    switch (modeId) {
      case 'camera':
      case 'album': {
        // 与 record 页「相册」一致：先校验今日次数，避免选图上传后 submit 才 429
        if (!getAccessToken()) {
          redirectToLogin()
          break
        }
        void (async () => {
          try {
            // 优先使用弹窗打开时预取的结果，未命中则降级发起新请求
            const membershipStatus = await withTimeout(
              membershipPromiseRef.current ?? getMyMembership(),
              MEMBERSHIP_PREFLIGHT_TIMEOUT_MS
            )
            if (membershipStatus && isFoodAnalysisCreditExhausted(membershipStatus)) {
              setCreditSheet({ visible: true, membershipStatus })
              return
            }
          } catch {
            // 会员接口失败时仍允许选图，由分析提交接口提示
          }
          onClose()
          chooseImageWithPrivacy({
            count: modeId === 'album' ? 5 : 1,
            sizeType: ['compressed'],
            sourceType: modeId === 'camera' ? ['camera'] : ['album'],
          }).then((res) => {
            const tempPaths = res.tempFilePaths || []
            if (tempPaths.length > 0) {
              Taro.setStorageSync('analyzeImagePath', tempPaths[0])
              Taro.setStorageSync('analyzeImagePaths', tempPaths)
            }
            Taro.navigateTo({ url: `${extraPkgUrl('/pages/analyze/index')}?date=${encodeURIComponent(recordDate)}` })
          }).catch((err) => {
            if (err.errMsg?.includes('cancel')) return
            if (isPrivacyAuthorizeError(err)) {
              showPrivacyAuthorizeFailure(err)
              return
            }
            void showUnifiedApiError(new Error('选择图片失败'), '选择图片失败')
          })
        })()
        break
      }
      case 'text':
        onClose()
        Taro.navigateTo({ url: `${extraPkgUrl('/pages/record-text/index')}?date=${encodeURIComponent(recordDate)}` })
        break
      case 'manual':
        onClose()
        Taro.navigateTo({ url: `${extraPkgUrl('/pages/record-manual/index')}?date=${encodeURIComponent(recordDate)}` })
        break
    }
  }

  const handleQuickAccessClick = (modeId: string) => {
    persistRecordTargetDate(selectedDate)
    onClose()
    switch (modeId) {
      case 'favorites':
        Taro.navigateTo({ url: extraPkgUrl('/pages/recipes/index') })
        break
      case 'history':
        Taro.navigateTo({ url: extraPkgUrl('/pages/analyze-history/index') })
        break
    }
  }

  const runDevTool = (fn: () => void) => {
    onClose()
    fn()
  }

  const handleSavePreviewImageUrl = () => {
    setDevDebugUiTestImageUrl(previewImageUrl)
    Taro.showToast({
      title: previewImageUrl.trim() ? '已保存测试图链接' : '已清空（将使用无图）',
      icon: 'none',
      duration: 1800
    })
  }

  return (
    <>
    {visible ? (
    <View className='record-menu-modal' catchMove>
      <View className='record-menu-mask' onClick={onClose} />
      <View className={`record-menu-content${isDark ? ' record-menu-content--dark' : ''}`}>
        {/* 顶部圆角指示条 */}
        <View className='record-menu-handle-bar' />

        {/* 2x2 功能网格 */}
        <View className='record-menu-grid-v2'>
          {GRID_FEATURES.map((feature) => {
            const IconComponent = feature.Icon
            const featureColor = isDark ? feature.darkColor : feature.color
            const featureBackground = isDark ? feature.darkBackgroundColor : feature.backgroundColor
            const featureBorder = isDark ? feature.darkBorderColor : feature.borderColor
            const iconBackground = isDark ? feature.darkIconBackgroundColor : feature.iconBackgroundColor
            return (
              <View
                key={feature.id}
                id={`record-menu-guide-${feature.id}`}
                className={`record-menu-grid-card record-menu-grid-card--${feature.id}`}
                style={{ backgroundColor: featureBackground, borderColor: featureBorder }}
                onClick={() => handleGridClick(feature.id)}
              >
                {feature.isNew && (
                  <View className='record-menu-new-badge'>
                    <Text className='record-menu-new-text'>NEW</Text>
                  </View>
                )}
                <View className='record-menu-grid-icon-wrap' style={{ backgroundColor: iconBackground }}>
                  <IconComponent size={40} color={featureColor} />
                </View>
                <View className='record-menu-grid-text-wrap'>
                  <Text className='record-menu-grid-label' style={{ color: featureColor }}>
                    {feature.label}
                  </Text>
                </View>
              </View>
            )
          })}
        </View>

        {/* 底部快捷入口 */}
        <View className='record-menu-list-v2'>
          {QUICK_ACCESS_ITEMS.map((item) => (
            <View
              key={item.id}
              className='record-menu-list-item-v2'
              onClick={() => handleQuickAccessClick(item.id)}
            >
              <View className='record-menu-list-left'>
                <View className='record-menu-list-texts'>
                  <Text className='record-menu-list-label-v2'>{item.label}</Text>
                  <Text className='record-menu-list-desc-v2'>{item.desc}</Text>
                </View>
              </View>
              <View className='record-menu-list-right'>
                <Text className='iconfont icon-right-arrow record-menu-list-arrow-v2' />
              </View>
            </View>
          ))}

          {__ENABLE_DEV_DEBUG_UI__ && (
            <View className='record-menu-dev-toolkit'>
              <View
                className='record-menu-dev-trigger'
                onClick={() => setDevToolsOpen((o) => !o)}
              >
                <View className='record-menu-dev-trigger-left'>
                  <View className='record-menu-dev-kcal-badge'>
                    <Text className='record-menu-dev-kcal-text'>kcal</Text>
                  </View>
                  <View className='record-menu-dev-trigger-titles'>
                    <Text className='record-menu-dev-trigger-title'>调试工具</Text>
                    <Text className='record-menu-dev-trigger-sub'>预置图 · 假数据 · 仅测 UI</Text>
                  </View>
                </View>
                <View className='record-menu-dev-trigger-right'>
                  <IconTrendingUp size={22} color='#00bc7d' />
                  <IconChevronRight
                    size={16}
                    color='#94a3b8'
                    className={
                      devToolsOpen
                        ? 'record-menu-dev-chevron record-menu-dev-chevron-open'
                        : 'record-menu-dev-chevron'
                    }
                  />
                </View>
              </View>
              {devToolsOpen && (
                <View className='record-menu-dev-panel'>
                  <View className='record-menu-dev-url-block'>
                    <Text className='record-menu-dev-url-label'>预置测试图片链接（https）</Text>
                    <Input
                      className='record-menu-dev-url-input'
                      type='text'
                      value={previewImageUrl}
                      placeholder='粘贴图片 URL，用于结果/海报等 UI 调试'
                      placeholderClass='record-menu-dev-url-placeholder'
                      onInput={(e) => setPreviewImageUrl(e.detail.value)}
                    />
                    <View className='record-menu-dev-url-actions'>
                      <View className='record-menu-dev-url-save' onClick={handleSavePreviewImageUrl}>
                        <Text className='record-menu-dev-url-save-text'>保存</Text>
                      </View>
                    </View>
                    <Text className='record-menu-dev-url-hint'>
                      营养等数据为本地随机编造，不请求分析接口；域名需在小程序后台配置 download 合法域名。
                    </Text>
                  </View>
                  <View className='record-menu-dev-items'>
                    <View
                      className='record-menu-dev-item'
                      onClick={() => runDevTool(openDebugAnalyzeLoadingFromMenu)}
                    >
                      <Text className='record-menu-dev-item-label'>模拟 Loading</Text>
                      <Text className='record-menu-dev-item-desc'>使用上方预置图（若有）</Text>
                    </View>
                    <View
                      className='record-menu-dev-item'
                      onClick={() => runDevTool(openDebugResultPageFromMenu)}
                    >
                      <Text className='record-menu-dev-item-label'>模拟分析结果页</Text>
                      <Text className='record-menu-dev-item-desc'>随机营养数据 + 预置图</Text>
                    </View>
                    <View
                      className='record-menu-dev-item'
                      onClick={() => runDevTool(openDebugRecordDetailPosterFromMenu)}
                    >
                      <Text className='record-menu-dev-item-label'>记录详情（分享海报）</Text>
                      <Text className='record-menu-dev-item-desc'>本地预览，不调保存接口</Text>
                    </View>
                    <View
                      className='record-menu-dev-item'
                      onClick={() => runDevTool(openAnalyzePageFromMenu)}
                    >
                      <Text className='record-menu-dev-item-label'>打开拍照分析页</Text>
                      <Text className='record-menu-dev-item-desc'>正常实拍分析流程</Text>
                    </View>
                    <View
                      className='record-menu-dev-item'
                      onClick={() => {
                        onClose()
                        setOnboardingPreviewOpen(true)
                      }}
                    >
                      <Text className='record-menu-dev-item-label'>新用户引导预览</Text>
                      <Text className='record-menu-dev-item-desc'>登录页弹窗各场景（不跳转新页面）</Text>
                    </View>
                    <View
                      className='record-menu-dev-item record-menu-dev-item-last'
                      onClick={() => runDevTool(openDebugHealthProfileFromMenu)}
                    >
                      <Text className='record-menu-dev-item-label'>进入画像引导</Text>
                      <Text className='record-menu-dev-item-desc'>健康档案问卷调试入口</Text>
                    </View>
                  </View>
                </View>
              )}
            </View>
          )}
        </View>
      </View>
      <CreditShortageSheet
        visible={creditSheet.visible}
        membershipStatus={creditSheet.membershipStatus}
        requiredCredits={2}
        scenarioLabel='食物分析'
        message={creditSheet.membershipStatus ? getFoodAnalysisCreditBlockMessage(creditSheet.membershipStatus) : undefined}
        onClose={() => setCreditSheet({ visible: false, membershipStatus: null })}
      />
    </View>
    ) : null}
    <DevNewUserOnboardingPreview
      visible={onboardingPreviewOpen}
      onClose={() => setOnboardingPreviewOpen(false)}
    />
    </>
  )
}
