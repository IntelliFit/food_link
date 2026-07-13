import { Text, View, Textarea } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { useState } from 'react'

import { FEED_REPORT_REASON_OPTIONS, type FeedReportReason, submitFeedReport, type CommunityFeedTargetType, showUnifiedApiError } from '../../../utils/api'

import './FeedReportSheet.scss'

interface FeedReportSheetProps {
  visible: boolean
  targetType: CommunityFeedTargetType
  targetId: string
  onClose: () => void
  onSuccess?: () => void
}

const MAX_EXTRA_LENGTH = 200

export function FeedReportSheet({ visible, targetType, targetId, onClose, onSuccess }: FeedReportSheetProps) {
  const [reason, setReason] = useState<FeedReportReason | ''>('')
  const [extra, setExtra] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = async () => {
    if (!reason) {
      Taro.showToast({ title: '请选择举报原因', icon: 'none' })
      return
    }
    setSubmitting(true)
    try {
      await submitFeedReport(targetType, targetId, { reason, extra_content: extra })
      Taro.showToast({ title: '举报已提交', icon: 'success' })
      setReason('')
      setExtra('')
      onSuccess?.()
      onClose()
    } catch (e) {
      console.error('举报失败', e)
      await showUnifiedApiError(e, '举报失败')
    } finally {
      setSubmitting(false)
    }
  }

  const handleClose = () => {
    if (submitting) return
    onClose()
  }

  // iOS WeChat can leak native textarea placeholders through hidden parents.
  if (!visible) return null

  return (
    <View className='feed-report-sheet-overlay feed-report-sheet-overlay--visible' catchMove>
      <View className='feed-report-sheet-mask' onClick={(e) => { e.stopPropagation(); handleClose() }} />
      <View className='feed-report-sheet-content'>
        <View className='feed-report-sheet-card'>
          <View className='feed-report-sheet-header'>
            <Text className='feed-report-sheet-title'>举报动态</Text>
            <Text className='feed-report-sheet-subtitle'>请选择举报原因</Text>
          </View>
          <View className='feed-report-sheet-reasons'>
            {FEED_REPORT_REASON_OPTIONS.map((item) => (
              <View
                key={item.value}
                className={`feed-report-sheet-reason ${reason === item.value ? 'is-active' : ''}`}
                onClick={() => setReason(item.value)}
              >
                <Text className='feed-report-sheet-reason-text'>{item.label}</Text>
                {reason === item.value ? <Text className='feed-report-sheet-reason-check'>✓</Text> : null}
              </View>
            ))}
          </View>
          <View className='feed-report-sheet-extra'>
            <Textarea
              className='feed-report-sheet-input'
              placeholder='补充说明（选填）'
              maxlength={MAX_EXTRA_LENGTH}
              value={extra}
              onInput={(e) => setExtra(e.detail.value)}
            />
            <Text className='feed-report-sheet-count'>{extra.length}/{MAX_EXTRA_LENGTH}</Text>
          </View>
          <View className='feed-report-sheet-actions'>
            <View className='feed-report-sheet-btn feed-report-sheet-btn--cancel' onClick={handleClose}>
              <Text className='feed-report-sheet-btn-text'>取消</Text>
            </View>
            <View
              className={`feed-report-sheet-btn feed-report-sheet-btn--submit ${!reason || submitting ? 'is-disabled' : ''}`}
              onClick={() => {
                if (!reason || submitting) return
                void handleSubmit()
              }}
            >
              <Text className='feed-report-sheet-btn-text'>{submitting ? '提交中...' : '提交举报'}</Text>
            </View>
          </View>
        </View>
      </View>
    </View>
  )
}
