import { View, Text, Image, Textarea, PageMeta } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { useState } from 'react'
import {
  classifyGooseDuckChicken,
  compressImagePathForUpload,
  getAccessToken,
  imageToBase64,
  showUnifiedApiError,
  uploadAnalyzeImage,
  uploadAnalyzeImageFile,
} from '../../../utils/api'
import type { GooseDuckChickenClassifyResult } from '../../../utils/api'
import { chooseImageWithPrivacy, isPrivacyAuthorizeError, showPrivacyAuthorizeFailure } from '../../../utils/weapp-privacy'
import { redirectToLogin, withAuth } from '../../../utils/withAuth'
import { GOOSE_DUCK_CHICKEN_BG_URL } from '../../../utils/static-asset-cdn-url'
import './index.scss'

const shouldFallbackToLegacyAnalyzeUpload = (error: unknown): boolean => {
  const message = String((error as any)?.message || error || '').toLowerCase()
  return (
    message.includes('http 404') ||
    message.includes('http 405') ||
    message.includes('http 415') ||
    message.includes('not found')
  )
}

function GooseDuckChickenPage() {
  const [imagePath, setImagePath] = useState('')
  const [additionalInfo, setAdditionalInfo] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState<GooseDuckChickenClassifyResult | null>(null)

  const chooseImage = async () => {
    try {
      const result = await chooseImageWithPrivacy({
        count: 1,
        sizeType: ['compressed'],
        sourceType: ['album', 'camera'],
      })
      const nextPath = result.tempFilePaths?.[0] || ''
      if (nextPath) {
        setImagePath(nextPath)
        setResult(null)
      }
    } catch (error) {
      if (isPrivacyAuthorizeError(error)) {
        showPrivacyAuthorizeFailure(error)
        return
      }
      Taro.showToast({ title: '选图失败，请重试', icon: 'none' })
    }
  }

  const previewImage = () => {
    if (!imagePath) return
    Taro.previewImage({ current: imagePath, urls: [imagePath] })
  }

  const submitSpecialClassify = async () => {
    if (submitting) return
    if (!getAccessToken()) {
      redirectToLogin()
      return
    }
    if (!imagePath) {
      Taro.showToast({ title: '请先上传一张图片', icon: 'none' })
      return
    }

    setSubmitting(true)
    Taro.showLoading({ title: '', mask: true })
    try {
      const uploadPath = await compressImagePathForUpload(imagePath)
      let imageUrl = ''
      try {
        const uploaded = await uploadAnalyzeImageFile(uploadPath || imagePath)
        imageUrl = uploaded.imageUrl
      } catch (fileUploadError) {
        if (!shouldFallbackToLegacyAnalyzeUpload(fileUploadError)) {
          throw fileUploadError
        }
        const base64 = await imageToBase64(uploadPath || imagePath)
        const uploaded = await uploadAnalyzeImage(base64)
        imageUrl = uploaded.imageUrl
      }

      const userContext = additionalInfo.trim()
      const classifyResult = await classifyGooseDuckChicken({
        image_url: imageUrl,
        additional_context: userContext || undefined,
      })

      Taro.hideLoading()
      setSubmitting(false)
      setResult(classifyResult)
    } catch (error) {
      Taro.hideLoading()
      setSubmitting(false)
      await showUnifiedApiError(error, '专线识别失败，请重试')
    }
  }

  return (
    <View className='goose-page'>
      <PageMeta pageStyle='background: #f7f2eb;' />

      <View className='goose-hero'>
        <Image
          className='goose-hero-bg'
          src={GOOSE_DUCK_CHICKEN_BG_URL}
          mode='aspectFill'
        />
        <View className='goose-hero-content'>
          <Text className='goose-hero-kicker'>鹅腿阿姨热点识别</Text>
          <Text className='goose-hero-title'>鹅腿、鸭腿，还是鸡腿？</Text>
          <Text className='goose-hero-desc'>上传一张图片，食探会用专项识别流程，只围绕鹅 / 鸭 / 鸡做判断。</Text>
        </View>
      </View>

      <View className='goose-upload-card'>
        {imagePath ? (
          <View className='goose-preview-wrap'>
            <Image className='goose-preview' src={imagePath} mode='aspectFill' onClick={previewImage} />
            <View className='goose-remove' onClick={() => {
              setImagePath('')
              setResult(null)
            }}
            >
              <Text className='goose-remove-text'>×</Text>
            </View>
          </View>
        ) : (
          <View className='goose-upload-placeholder' onClick={chooseImage}>
            <Text className='goose-upload-plus'>+</Text>
            <Text className='goose-upload-title'>上传要识别的图片</Text>
            <Text className='goose-upload-desc'>鹅腿、鸭腿、鸡腿，或“鹅腿阿姨”同款图都可以</Text>
          </View>
        )}

        {imagePath ? (
          <View className='goose-repick' onClick={chooseImage}>
            <Text className='goose-repick-text'>换一张图片</Text>
          </View>
        ) : null}
      </View>

      <View className='goose-info-card'>
        <Text className='goose-section-title'>补充线索</Text>
        <Textarea
          className='goose-textarea'
          value={additionalInfo}
          maxlength={120}
          placeholder='例如：这是校门口买的、外皮偏甜、带竹签、看起来像烤腿...'
          placeholderClass='goose-textarea-placeholder'
          onInput={(e) => setAdditionalInfo(e.detail.value)}
        />
      </View>

      <View className='goose-rule-card'>
        <Text className='goose-rule-title'>当前是单纯识别通道</Text>
        <Text className='goose-rule-text'>这条通道只判断鹅 / 鸭 / 鸡，不进入普通食物分析、营养回算或饮食记录结果页。</Text>
      </View>

      {result ? (
        <View className='goose-result-card'>
          <Text className='goose-result-kicker'>识别结果</Text>
          <Text className='goose-result-label'>{result.label || '不确定'}</Text>
          <Text className='goose-result-confidence'>置信度 {Math.round((result.confidence || 0) * 100)}%</Text>
          <Text className='goose-result-reason'>{result.reason}</Text>
          {result.evidence?.length ? (
            <View className='goose-result-evidence'>
              {result.evidence.slice(0, 3).map((item, index) => (
                <Text key={`${item}-${index}`} className='goose-result-evidence-item'>· {item}</Text>
              ))}
            </View>
          ) : null}
        </View>
      ) : null}

      <View className='goose-submit' onClick={submitSpecialClassify}>
        <Text className='goose-submit-text'>{submitting ? '正在提交' : '开始专线识别'}</Text>
      </View>
    </View>
  )
}

export default withAuth(GooseDuckChickenPage)
