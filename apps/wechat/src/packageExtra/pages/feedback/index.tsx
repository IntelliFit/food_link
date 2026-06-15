import { Image, Text, Textarea, View } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { Button, Switch } from '@taroify/core'
import '@taroify/core/button/style'
import '@taroify/core/switch/style'
import { useMemo, useState } from 'react'

import {
  FEEDBACK_MAX_IMAGES,
  getRecentRequestTraces,
  RECENT_REQUEST_TRACE_LIMIT,
  showUnifiedApiError,
  submitFeedback,
  uploadFeedbackImage,
  type FeedbackCategory,
} from '../../../utils/api'
import { CONSOLE_LOG_BUFFER_LIMIT } from '../../../utils/console-log-buffer'
import { chooseImageWithPrivacy, isPrivacyAuthorizeError, showPrivacyAuthorizeFailure } from '../../../utils/weapp-privacy'
import { withAuth } from '../../../utils/withAuth'
import { FlPageThemeRoot } from '../../../components/FlPageThemeRoot'

import './index.scss'

type FeedbackCategoryOption = {
  value: FeedbackCategory
  label: string
  desc: string
}

type FeedbackImageItem = {
  id: string
  localPath: string
  remoteUrl?: string
  uploading?: boolean
}

const CATEGORY_OPTIONS: FeedbackCategoryOption[] = [
  { value: 'bug', label: '问题反馈', desc: '页面异常、识别失败、数据不对' },
  { value: 'suggestion', label: '功能建议', desc: '想要的新功能或体验优化' },
  { value: 'experience', label: '使用体验', desc: '流程、文案、交互上的感受' },
  { value: 'other', label: '其他', desc: '其他想告诉我们的内容' },
]

function FeedbackPage() {
  const [category, setCategory] = useState<FeedbackCategory>('bug')
  const [content, setContent] = useState('')
  const [contact, setContact] = useState('')
  const [images, setImages] = useState<FeedbackImageItem[]>([])
  const [attachRecentRequests, setAttachRecentRequests] = useState(true)
  const [submitting, setSubmitting] = useState(false)

  const traceCount = useMemo(() => getRecentRequestTraces().length, [])
  const contentLength = content.trim().length
  const hasUploadingImage = images.some((item) => item.uploading)
  const canSubmit = contentLength >= 5 && !submitting && !hasUploadingImage

  const handleChooseImages = async () => {
    const remain = FEEDBACK_MAX_IMAGES - images.length
    if (remain <= 0) {
      Taro.showToast({ title: `最多上传 ${FEEDBACK_MAX_IMAGES} 张图片`, icon: 'none' })
      return
    }
    try {
      const res = await chooseImageWithPrivacy({
        count: remain,
        sizeType: ['compressed'],
        sourceType: ['album', 'camera'],
      })
      const tempFiles = res.tempFilePaths || []
      for (const localPath of tempFiles) {
        const id = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
        setImages((current) => [...current, { id, localPath, uploading: true }].slice(0, FEEDBACK_MAX_IMAGES))
        void uploadSingleImage(id, localPath)
      }
    } catch (error) {
      if (isPrivacyAuthorizeError(error)) {
        showPrivacyAuthorizeFailure()
        return
      }
      console.error('选择图片失败', error)
      Taro.showToast({ title: '选择图片失败', icon: 'none' })
    }
  }

  async function uploadSingleImage(id: string, localPath: string) {
    try {
      const { imageUrl } = await uploadFeedbackImage(localPath)
      setImages((current) =>
        current.map((item) => (item.id === id ? { ...item, remoteUrl: imageUrl, uploading: false } : item))
      )
    } catch (error) {
      console.error('上传反馈图片失败', error)
      setImages((current) => current.filter((item) => item.id !== id))
      await showUnifiedApiError(error, '图片上传失败')
    }
  }

  const handleRemoveImage = (id: string) => {
    setImages((current) => current.filter((item) => item.id !== id))
  }

  const handleSubmit = async () => {
    if (!canSubmit) {
      Taro.showToast({ title: '请至少填写 5 个字', icon: 'none' })
      return
    }
    const imageUrls = images.map((item) => item.remoteUrl).filter((url): url is string => !!url)
    if (images.length > 0 && imageUrls.length !== images.length) {
      Taro.showToast({ title: '图片仍在上传中', icon: 'none' })
      return
    }
    try {
      setSubmitting(true)
      await submitFeedback({
        category,
        content,
        contact,
        attachRecentRequests,
        imageUrls,
      })
      Taro.showToast({ title: '反馈已提交', icon: 'success' })
      setTimeout(() => {
        Taro.navigateBack()
      }, 500)
    } catch (error) {
      console.error('提交反馈失败', error)
      await showUnifiedApiError(error, '提交失败，请稍后重试')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <FlPageThemeRoot>
    <View className='feedback-page'>
      <View className='feedback-hero'>
        <Text className='feedback-hero-title'>告诉我们你遇到的问题</Text>
        <Text className='feedback-hero-desc'>提交后会进入排查列表，我们会结合请求 trace 与截图更快定位原因。</Text>
      </View>

      <View className='feedback-card'>
        <Text className='feedback-section-title'>反馈类型</Text>
        <View className='feedback-category-grid'>
          {CATEGORY_OPTIONS.map((item) => (
            <View
              key={item.value}
              className={`feedback-category ${category === item.value ? 'is-active' : ''}`}
              onClick={() => setCategory(item.value)}
            >
              <Text className='feedback-category-title'>{item.label}</Text>
              <Text className='feedback-category-desc'>{item.desc}</Text>
            </View>
          ))}
        </View>
      </View>

      <View className='feedback-card'>
        <View className='feedback-title-row'>
          <Text className='feedback-section-title'>反馈内容</Text>
          <Text className='feedback-count'>{content.length}/500</Text>
        </View>
        <Textarea
          className='feedback-textarea'
          value={content}
          maxlength={500}
          placeholder='请描述你遇到的问题、期望的效果，或告诉我们发生的大致时间。'
          onInput={(event) => setContent(event.detail.value)}
        />
      </View>

      <View className='feedback-card'>
        <View className='feedback-title-row'>
          <Text className='feedback-section-title'>截图（选填）</Text>
          <Text className='feedback-count'>{images.length}/{FEEDBACK_MAX_IMAGES}</Text>
        </View>
        <Text className='feedback-image-desc'>可上传页面报错、识别结果等截图，最多 {FEEDBACK_MAX_IMAGES} 张。</Text>
        <View className='feedback-image-grid'>
          {images.map((item) => (
            <View key={item.id} className='feedback-image-item'>
              <Image className='feedback-image-preview' src={item.localPath} mode='aspectFill' />
              {item.uploading ? <View className='feedback-image-mask'>上传中</View> : null}
              <View className='feedback-image-remove' onClick={() => handleRemoveImage(item.id)}>×</View>
            </View>
          ))}
          {images.length < FEEDBACK_MAX_IMAGES ? (
            <View className='feedback-image-add' onClick={() => void handleChooseImages()}>
              <Text className='feedback-image-add-icon'>+</Text>
              <Text className='feedback-image-add-text'>添加图片</Text>
            </View>
          ) : null}
        </View>
      </View>

      <View className='feedback-card'>
        <Text className='feedback-section-title'>联系方式（选填）</Text>
        <Textarea
          className='feedback-contact'
          value={contact}
          maxlength={120}
          placeholder='可填写微信号、手机号或邮箱，便于我们需要时联系你。'
          onInput={(event) => setContact(event.detail.value)}
        />
      </View>

      <View className='feedback-card feedback-diagnostic'>
        <View className='feedback-diagnostic-main'>
          <Text className='feedback-section-title'>附带请求诊断</Text>
          <Text className='feedback-diagnostic-desc'>
            {`将附带最近 ${Math.min(traceCount, RECENT_REQUEST_TRACE_LIMIT)} 条请求的 traceId、状态码和耗时，以及最近 ${CONSOLE_LOG_BUFFER_LIMIT} 条 console 日志，不包含 token、请求体或图片。`}
          </Text>
        </View>
        <Switch
          checked={attachRecentRequests}
          onChange={setAttachRecentRequests}
          style={{ '--switch-checked-background-color': '#00bc7d' } as React.CSSProperties}
        />
      </View>

      <View className='feedback-submit-bar'>
        <Button
          className='feedback-submit'
          color='primary'
          block
          loading={submitting}
          disabled={!canSubmit}
          onClick={handleSubmit}
        >
          提交反馈
        </Button>
      </View>
    </View>
    </FlPageThemeRoot>
  )
}

export default withAuth(FeedbackPage)
