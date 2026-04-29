import { useState, useEffect } from 'react'
import { View, Text, Input } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { redirectToLogin } from '../../../utils/withAuth'
import { getAccessToken, getMyMembership } from '../../../utils/api'
import { extraPkgUrl } from '../../../utils/subpackage-extra'
import {
  getFoodAnalysisBlockedActionText,
  getFoodAnalysisCreditBlockMessage,
  isFoodAnalysisCreditExhausted,
} from '../../../utils/membership'
import {
  IconCamera,
  IconAlbum,
  IconText,
  IconEdit,
  IconHistory,
  IconFavorite,
  IconChevronRight,
  IconTrendingUp
} from '../../../components/iconfont'
import {
  openAnalyzePageFromMenu,
  openDebugAnalyzeLoadingFromMenu,
  openDebugRecordDetailPosterFromMenu,
  openDebugResultPageFromMenu
} from '../../../utils/dev-debug-tools'
import { getDevDebugUiTestImageUrl, setDevDebugUiTestImageUrl } from '../../../utils/dev-debug-storage'

interface RecordMenuProps {
  visible: boolean
  onClose: () => void
}

// 顶部2x2网格功能 - 拍照识别、相册上传、文本输入、手动输入
const GRID_FEATURES: Array<{
  id: string
  label: string
  color: string
  Icon: typeof IconCamera
  isNew?: boolean
}> = [
  {
    id: 'camera',
    label: '拍照识别',
    color: '#e85d75',
    Icon: IconCamera,
  },
  {
    id: 'album',
    label: '相册上传',
    color: '#10b981',
    Icon: IconAlbum,
  },
  {
    id: 'text',
    label: '文本输入',
    color: '#f59e0b',
    Icon: IconText,
  },
  {
    id: 'manual',
    label: '手动输入',
    color: '#3b82f6',
    Icon: IconEdit,
  },
]

const QUICK_ACCESS_ITEMS = [
  {
    id: 'favorites',
    label: '我的收藏',
    desc: '快速记录常吃餐食',
    Icon: IconFavorite,
    color: '#f59e0b',
  },
  {
    id: 'history',
    label: '历史记录',
    desc: '查看以往识别记录',
    Icon: IconHistory,
    color: '#6b7280',
  },
] as const

export function RecordMenu({ visible, onClose }: RecordMenuProps) {
  const [devToolsOpen, setDevToolsOpen] = useState(false)
  /** 预置测试图 URL（仅 development 本地 UI 调试） */
  const [previewImageUrl, setPreviewImageUrl] = useState('')

  useEffect(() => {
    if (!visible) {
      setDevToolsOpen(false)
      return
    }
    if (__ENABLE_DEV_DEBUG_UI__) {
      setPreviewImageUrl(getDevDebugUiTestImageUrl())
    }
  }, [visible])

  if (!visible) return null

  const handleGridClick = (modeId: string) => {
    onClose()

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
            const membershipStatus = await getMyMembership()
            if (isFoodAnalysisCreditExhausted(membershipStatus)) {
              const content = getFoodAnalysisCreditBlockMessage(membershipStatus)
              const confirmText = getFoodAnalysisBlockedActionText(membershipStatus)
              const showUpgrade = content.includes('开通') || content.includes('升级') || membershipStatus.is_pro
              Taro.showModal({
                title: '积分不足',
                content,
                confirmText: showUpgrade ? confirmText : '知道了',
                cancelText: '取消',
                showCancel: showUpgrade,
                success: (r) => {
                  if (showUpgrade && r.confirm) {
                    Taro.navigateTo({ url: extraPkgUrl('/pages/pro-membership/index') })
                  }
                }
              })
              return
            }
          } catch {
            // 会员接口失败时仍允许选图，由分析提交接口提示
          }
          Taro.chooseImage({
            count: modeId === 'album' ? 5 : 1,
            sizeType: ['compressed'],
            sourceType: modeId === 'camera' ? ['camera'] : ['album'],
            success: (res) => {
              const tempPaths = res.tempFilePaths || []
              if (tempPaths.length > 0) {
                Taro.setStorageSync('analyzeImagePath', tempPaths[0])
                Taro.setStorageSync('analyzeImagePaths', tempPaths)
              }
              Taro.navigateTo({ url: extraPkgUrl('/pages/analyze/index') })
            },
            fail: (err) => {
              if (err.errMsg?.includes('cancel')) return
              Taro.showToast({ title: '选择图片失败', icon: 'none' })
            }
          })
        })()
        break
      }
      case 'text':
        Taro.navigateTo({ url: extraPkgUrl('/pages/record-text/index') })
        break
      case 'manual':
        Taro.navigateTo({ url: extraPkgUrl('/pages/record-manual/index') })
        break
    }
  }

  const handleQuickAccessClick = (modeId: string) => {
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
    <View className='record-menu-modal' catchMove>
      <View className='record-menu-mask' onClick={onClose} />
      <View className='record-menu-content'>
        {/* 顶部圆角指示条 */}
        <View className='record-menu-handle-bar' />

        {/* 2x2 功能网格 */}
        <View className='record-menu-grid-v2'>
          {GRID_FEATURES.map((feature) => {
            const IconComponent = feature.Icon
            return (
              <View
                key={feature.id}
                className='record-menu-grid-card'
                onClick={() => handleGridClick(feature.id)}
              >
                {feature.isNew && (
                  <View className='record-menu-new-badge'>
                    <Text className='record-menu-new-text'>NEW</Text>
                  </View>
                )}
                <View className='record-menu-grid-icon-wrap'>
                  <IconComponent size={40} color={feature.color} />
                </View>
                <View className='record-menu-grid-text-wrap'>
                  <Text className='record-menu-grid-label' style={{ color: feature.color }}>
                    {feature.label}
                  </Text>
                </View>
              </View>
            )
          })}
        </View>

        {/* 底部快捷入口 */}
        <View className='record-menu-list-v2'>
          {QUICK_ACCESS_ITEMS.map((item) => {
            const IconComponent = item.Icon
            return (
              <View
                key={item.id}
                className='record-menu-list-item-v2'
                onClick={() => handleQuickAccessClick(item.id)}
              >
                <View className='record-menu-list-left'>
                  <View className='record-menu-list-icon-wrap' style={{ backgroundColor: `${item.color}15` }}>
                    <IconComponent size={24} color={item.color} />
                  </View>
                  <View className='record-menu-list-texts'>
                    <Text className='record-menu-list-label-v2'>{item.label}</Text>
                    <Text className='record-menu-list-desc-v2'>{item.desc}</Text>
                  </View>
                </View>
                <View className='record-menu-list-right'>
                  <IconChevronRight size={16} color='#d1d5db' />
                </View>
              </View>
            )
          })}

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
                      className='record-menu-dev-item record-menu-dev-item-last'
                      onClick={() => runDevTool(openAnalyzePageFromMenu)}
                    >
                      <Text className='record-menu-dev-item-label'>打开拍照分析页</Text>
                      <Text className='record-menu-dev-item-desc'>正常实拍分析流程</Text>
                    </View>
                  </View>
                </View>
              )}
            </View>
          )}
        </View>
      </View>
    </View>
  )
}
