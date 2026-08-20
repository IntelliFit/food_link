import { Image, Input, ScrollView, Text, Textarea, View } from '@tarojs/components'
import Taro, { useDidShow } from '@tarojs/taro'
import { useState } from 'react'
import { useAppColorScheme } from '../../../components/AppColorSchemeContext'
import {
  createFoodNutritionContribution,
  getMyFoodNutritionContributions,
  imageToBase64,
  showUnifiedApiError,
  uploadAnalyzeImage,
  type FoodNutritionContribution,
} from '../../../utils/api'
import { applyThemeNavigationBar } from '../../../utils/theme-navigation-bar'
import { chooseImageWithPrivacy, isPrivacyAuthorizeError, showPrivacyAuthorizeFailure } from '../../../utils/weapp-privacy'
import './index.scss'

const MAX_IMAGES = 5
const statusText: Record<string, string> = { pending: '待审核', approved: '已通过', rejected: '已驳回' }

export default function StandardFoodContributionPage() {
  const { scheme } = useAppColorScheme()
  const [name, setName] = useState('')
  const [kcal, setKcal] = useState('')
  const [protein, setProtein] = useState('')
  const [carbs, setCarbs] = useState('')
  const [fat, setFat] = useState('')
  const [sourceText, setSourceText] = useState('')
  const [imagePaths, setImagePaths] = useState<string[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [history, setHistory] = useState<FoodNutritionContribution[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)

  useDidShow(() => {
    applyThemeNavigationBar(scheme)
    setHistoryLoading(true)
    getMyFoodNutritionContributions().then(setHistory).catch(() => {}).finally(() => setHistoryLoading(false))
  })

  const chooseEvidence = async () => {
    const remain = MAX_IMAGES - imagePaths.length
    if (remain <= 0) {
      Taro.showToast({ title: '最多上传5张证据图片', icon: 'none' })
      return
    }
    try {
      const selected = await chooseImageWithPrivacy({ count: remain, sizeType: ['compressed'], sourceType: ['album', 'camera'] })
      if (!selected.tempFilePaths?.length) return
      Taro.showLoading({ title: '', mask: true })
      const uploaded: string[] = []
      for (const localPath of selected.tempFilePaths) {
        const result = await uploadAnalyzeImage(await imageToBase64(localPath))
        uploaded.push(result.imageUrl)
      }
      setImagePaths((current) => [...current, ...uploaded].slice(0, MAX_IMAGES))
    } catch (error) {
      if (isPrivacyAuthorizeError(error)) showPrivacyAuthorizeFailure(error)
      else if (!String((error as any)?.errMsg || '').includes('cancel')) await showUnifiedApiError(error, '上传失败')
    } finally {
      Taro.hideLoading()
    }
  }

  const submit = async () => {
    const values = [kcal, protein, carbs, fat].map(Number)
    if (!name.trim()) return void Taro.showToast({ title: '请填写食物名称', icon: 'none' })
    if (!Number.isFinite(values[0]) || values[0] <= 0 || values.slice(1).some((value) => !Number.isFinite(value) || value < 0)) {
      return void Taro.showToast({ title: '请填写有效的每100g营养', icon: 'none' })
    }
    if (!sourceText.trim() && imagePaths.length === 0) {
      return void Taro.showToast({ title: '请填写来源或上传证据', icon: 'none' })
    }
    setSubmitting(true)
    try {
      const item = await createFoodNutritionContribution({
        canonical_name: name.trim(), kcal_per_100g: values[0], protein_per_100g: values[1],
        carbs_per_100g: values[2], fat_per_100g: values[3], source_text: sourceText.trim(),
        evidence_image_paths: imagePaths,
      })
      setHistory((current) => [item, ...current])
      setName(''); setKcal(''); setProtein(''); setCarbs(''); setFat(''); setSourceText(''); setImagePaths([])
      Taro.showToast({ title: '已提交审核', icon: 'success' })
    } catch (error) {
      await showUnifiedApiError(error, '提交失败')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <ScrollView scrollY className={`standard-contribution ${scheme === 'dark' ? 'standard-contribution--dark' : ''}`}>
      <View className='standard-card standard-intro'>
        <Text className='standard-intro__title'>填写每100g营养</Text>
        <Text className='standard-intro__desc'>适合米饭、鸡蛋、蔬菜等通用食物。包装商品请返回选择“包装食品”。</Text>
      </View>
      <View className='standard-card standard-form'>
        <Text className='standard-label'>食物名称 *</Text>
        <Input className='standard-input' value={name} placeholder='例如：熟鸡蛋' onInput={(e) => setName(e.detail.value)} />
        <View className='standard-grid'>
          {[
            { label: '热量', unit: 'kcal', value: kcal, setter: setKcal },
            { label: '蛋白质', unit: 'g', value: protein, setter: setProtein },
            { label: '碳水', unit: 'g', value: carbs, setter: setCarbs },
            { label: '脂肪', unit: 'g', value: fat, setter: setFat },
          ].map(({ label, unit, value, setter }) => (
            <View className='standard-field' key={label}>
              <Text className='standard-label'>{label}/100g *</Text>
              <View className='standard-input-wrap'>
                <Input className='standard-input' type='digit' value={value} onInput={(e) => setter(e.detail.value)} />
                <Text>{unit}</Text>
              </View>
            </View>
          ))}
        </View>
        <Text className='standard-label'>来源说明</Text>
        <Textarea className='standard-textarea' value={sourceText} placeholder='例如：中国食物成分表、产品营养标签或检测报告' onInput={(e) => setSourceText(e.detail.value)} />
        <View className='standard-evidence-head'>
          <Text className='standard-label'>证据图片（{imagePaths.length}/{MAX_IMAGES}）</Text>
          <Text className='standard-hint'>来源说明和图片至少一项</Text>
        </View>
        <View className='standard-images'>
          {imagePaths.map((url, index) => (
            <View className='standard-image-wrap' key={url}>
              <Image className='standard-image' src={url} mode='aspectFill' />
              <Text className='standard-image-remove' onClick={() => setImagePaths((current) => current.filter((_, i) => i !== index))}>×</Text>
            </View>
          ))}
          {imagePaths.length < MAX_IMAGES && <View className='standard-image-add' onClick={() => void chooseEvidence()}><Text>＋</Text><Text>添加</Text></View>}
        </View>
        <View className={`standard-submit ${submitting ? 'disabled' : ''}`} onClick={() => !submitting && void submit()}>
          {submitting ? <View className='standard-spinner' /> : <Text>提交审核</Text>}
        </View>
      </View>
      <View className='standard-history'>
        <Text className='standard-history__title'>我的贡献</Text>
        {historyLoading ? <View className='standard-spinner standard-spinner--dark' /> : history.length === 0 ? (
          <Text className='standard-empty'>还没有标准食物贡献</Text>
        ) : history.map((item) => (
          <View className='standard-history-item' key={item.id}>
            <View><Text className='standard-history-name'>{item.canonical_name}</Text><Text className='standard-history-meta'>{Math.round(item.kcal_per_100g)} kcal/100g</Text></View>
            <View><Text className={`standard-status standard-status--${item.status}`}>{statusText[item.status] || item.status}</Text>{item.review_note ? <Text className='standard-review-note'>{item.review_note}</Text> : null}</View>
          </View>
        ))}
      </View>
    </ScrollView>
  )
}
