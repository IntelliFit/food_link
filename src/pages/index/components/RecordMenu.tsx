import { View, Text } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { getAccessToken, getMyMembership } from '../../../utils/api'
import {
  IconCamera,
  IconAlbum,
  IconText,
  IconEdit,
  IconHistory,
  IconChevronRight
} from '../../../components/iconfont'

interface RecordMenuProps {
  visible: boolean
  onClose: () => void
}

// 顶部2x2网格功能 - 拍照识别、相册上传、文本输入、手动输入
const GRID_FEATURES = [
  {
    id: 'camera',
    label: '拍照识别',
    color: '#e85d75',
    bgColor: '#fef2f4',
    Icon: IconCamera,
  },
  {
    id: 'album',
    label: '相册上传',
    color: '#10b981',
    bgColor: '#ecfdf5',
    Icon: IconAlbum,
  },
  {
    id: 'text',
    label: '文本输入',
    color: '#f59e0b',
    bgColor: '#fffbeb',
    Icon: IconText,
  },
  {
    id: 'manual',
    label: '手动输入',
    color: '#3b82f6',
    bgColor: '#eff6ff',
    Icon: IconEdit,
  },
]

// 底部只有历史记录
const HISTORY_ITEM = {
  id: 'history',
  label: '历史记录',
  Icon: IconHistory,
  color: '#6b7280',
}

export function RecordMenu({ visible, onClose }: RecordMenuProps) {
  if (!visible) return null

  const handleGridClick = (modeId: string) => {
    onClose()

    switch (modeId) {
      case 'camera':
        // record 为 tabBar 页，必须用 switchTab，navigateTo 会失败无反应
        Taro.switchTab({ url: '/pages/record/index' })
        break
      case 'album': {
        // 与 record 页「相册」一致：先校验今日次数，避免选图上传后 submit 才 429
        if (!getAccessToken()) {
          Taro.navigateTo({ url: '/pages/login/index' })
          break
        }
        void (async () => {
          try {
            const membershipStatus = await getMyMembership()
            if (membershipStatus.daily_remaining !== null && membershipStatus.daily_remaining <= 0) {
              const isPro = membershipStatus.is_pro
              Taro.showModal({
                title: '今日次数已用完',
                content: isPro
                  ? `今日 ${membershipStatus.daily_limit ?? 30} 次拍照已用完，请明日再试。`
                  : `免费版每日限 ${membershipStatus.daily_limit ?? 30} 次，开通食探会员可享更高额度与精准模式等功能。`,
                confirmText: isPro ? '知道了' : '去开通',
                cancelText: '取消',
                showCancel: !isPro,
                success: (r) => {
                  if (!isPro && r.confirm) {
                    Taro.navigateTo({ url: '/pages/pro-membership/index' })
                  }
                }
              })
              return
            }
          } catch {
            // 会员接口失败时仍允许选图，由分析提交接口提示
          }
          Taro.chooseImage({
            count: 1,
            sizeType: ['compressed'],
            sourceType: ['album'],
            success: (res) => {
              const imagePath = res.tempFilePaths[0]
              Taro.setStorageSync('analyzeImagePath', imagePath)
              Taro.navigateTo({ url: '/pages/analyze/index' })
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
        Taro.navigateTo({ url: '/pages/record-text/index' })
        break
      case 'manual':
        Taro.navigateTo({ url: '/pages/record-manual/index' })
        break
    }
  }

  const handleHistoryClick = () => {
    onClose()
    Taro.navigateTo({ url: '/pages/analyze-history/index' })
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
                style={{ backgroundColor: feature.bgColor }}
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

        {/* 底部历史记录 */}
        <View className='record-menu-list-v2'>
          <View
            className='record-menu-list-item-v2'
            onClick={handleHistoryClick}
          >
            <View className='record-menu-list-left'>
              <View className='record-menu-list-icon-wrap' style={{ backgroundColor: `${HISTORY_ITEM.color}15` }}>
                <HISTORY_ITEM.Icon size={24} color={HISTORY_ITEM.color} />
              </View>
              <Text className='record-menu-list-label-v2'>{HISTORY_ITEM.label}</Text>
            </View>
            <View className='record-menu-list-right'>
              <IconChevronRight size={16} color='#d1d5db' />
            </View>
          </View>
        </View>
      </View>
    </View>
  )
}
