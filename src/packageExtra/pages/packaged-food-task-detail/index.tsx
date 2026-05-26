import { Image, ScrollView, Text, View } from '@tarojs/components'
import Taro, { useDidShow, useRouter } from '@tarojs/taro'
import { useMemo, useState } from 'react'
import {
  getAnalyzeTask,
  sanitizeUserFacingErrorMessage,
  type AnalysisTask,
  type PackagedAutoIngestResult,
  type PackagedProductExtractResult,
  type PackagedUploadRewardResult,
} from '../../../utils/api'
import { withAuth } from '../../../utils/withAuth'
import './index.scss'

function normalizeString(value: unknown) {
  return String(value || '').trim()
}

function extractPackagedResult(task?: AnalysisTask | null): PackagedProductExtractResult | null {
  const result = (task?.result || {}) as Record<string, any>
  const packagedProduct = (result.packaged_product || result.nutrition || {}) as PackagedProductExtractResult
  return Object.keys(packagedProduct).length > 0 ? packagedProduct : null
}

function extractRewardResult(task?: AnalysisTask | null): PackagedUploadRewardResult | null {
  const result = (task?.result || {}) as Record<string, any>
  const reward = (result.reward_result || {}) as PackagedUploadRewardResult
  return Object.keys(reward).length > 0 ? reward : null
}

function isTaskStillRunning(status?: string) {
  return ['pending', 'processing'].includes(String(status || '').trim())
}

function formatTaskTime(value?: string) {
  const date = new Date(String(value || ''))
  if (Number.isNaN(date.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function formatNumber(value: unknown, unit = '') {
  const n = Number(value)
  if (!Number.isFinite(n) || n < 0) return `0${unit}`
  const rounded = Math.round(n * 10) / 10
  return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded}${unit}`
}

function describeBlockedReason(auto?: PackagedAutoIngestResult | null) {
  switch (auto?.reason) {
    case 'missing_net_weight':
      return '缺少净含量/规格，请重拍包装正面，让净含量完整入镜。'
    case 'missing_product_name':
      return '缺少商品名称，请重拍包装正面，让品牌和品名完整入镜。'
    case 'missing_nutrition':
      return '营养成分表不完整，请重拍能量、蛋白质、脂肪、碳水和钠。'
    case 'conversion_not_closed':
      return '营养口径无法可靠换算，请确认每100g/每份和每份重量拍清楚。'
    case 'conflict':
      return '包装信息之间存在冲突，请重新拍清楚正面净含量和营养表。'
    case 'low_extract_confidence':
    case 'low_name_confidence':
    case 'low_spec_confidence':
    case 'low_nutrition_confidence':
      return '图片文字识别不够稳定，请减少反光和倾斜后重拍。'
    default:
      return '这次识别结果还不够稳定，请重新上传更清晰图片。'
  }
}

function statusText(task?: AnalysisTask | null, packaged?: PackagedProductExtractResult | null, reward?: PackagedUploadRewardResult | null) {
  if (!task) return '加载中'
  if (task.status === 'failed' || task.status === 'timed_out' || task.status === 'cancelled') return '分析失败'
  if (isTaskStillRunning(task.status)) return '后台分析中'
  if (reward?.awarded) return `已入库，奖励积分 +${Number(reward.reward_credits) || 1}`
  if (reward?.already_exists || packaged?.auto_ingest_result?.upsert_action === 'updated') return '数据库已有，本次不奖励'
  if (packaged?.auto_ingest_result?.status === 'ingested') return '已入库，本次不奖励'
  return '未入库，请重拍'
}

function taskFailureMessage(task?: AnalysisTask | null) {
  if (!task) return '请重新上传更清晰图片。'
  if (task.status === 'failed' || task.status === 'timed_out' || task.status === 'cancelled') {
    return '这次分析失败，请重新上传更清晰图片。'
  }
  return sanitizeUserFacingErrorMessage(task.error_message, '请重新上传更清晰图片。')
}

function imageUrlsForTask(task?: AnalysisTask | null, packaged?: PackagedProductExtractResult | null) {
  const urls = [
    ...((task?.image_paths || []) as string[]),
    task?.image_url || '',
    ...((packaged?.source_image_urls || []) as string[]),
  ].map(normalizeString).filter(Boolean)
  return Array.from(new Set(urls))
}

function PackagedFoodTaskDetailPage() {
  const router = useRouter()
  const taskId = normalizeString(router.params?.task_id)
  const [task, setTask] = useState<AnalysisTask | null>(null)
  const [loading, setLoading] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')

  const packaged = useMemo(() => extractPackagedResult(task), [task])
  const reward = useMemo(() => extractRewardResult(task), [task])
  const auto = packaged?.auto_ingest_result || null
  const imageUrls = useMemo(() => imageUrlsForTask(task, packaged), [task, packaged])
  const nutrition = packaged?.unit_nutrition_per_100g || {}

  const loadTask = async (showToast = false) => {
    if (!taskId || loading) return
    setLoading(true)
    setErrorMessage('')
    try {
      const nextTask = await getAnalyzeTask(taskId)
      setTask(nextTask)
      if (showToast) Taro.showToast({ title: '已刷新', icon: 'success' })
    } catch (error) {
      const message = sanitizeUserFacingErrorMessage(error, '获取任务详情失败')
      setErrorMessage(message)
      if (showToast) Taro.showToast({ title: message, icon: 'none' })
    } finally {
      setLoading(false)
    }
  }

  useDidShow(() => {
    loadTask()
  })

  const retryUpload = () => {
    Taro.navigateTo({ url: '/packageExtra/pages/packaged-food-edit/index?task_mode=reward_center' })
  }

  return (
    <View className='packaged-task-detail-page'>
      <ScrollView className='packaged-task-detail-scroll' scrollY>
        <View className={`detail-hero status-${task?.status || 'pending'}`}>
          <Text className='detail-hero-kicker'>零食上传任务</Text>
          <Text className='detail-hero-title'>{packaged?.product_name || `零食照片 ${imageUrls.length || 1} 张`}</Text>
          <Text className='detail-hero-status'>{statusText(task, packaged, reward)}</Text>
          <Text className='detail-hero-time'>{formatTaskTime(task?.created_at)}</Text>
          <View className='detail-actions'>
            <View className={`detail-action-btn ${loading ? 'loading' : ''}`} onClick={() => loadTask(true)}>
              <Text className='detail-action-text'>{loading ? '刷新中' : '刷新状态'}</Text>
            </View>
            {!isTaskStillRunning(task?.status) && (
              <View className='detail-action-btn secondary' onClick={retryUpload}>
                <Text className='detail-action-text secondary'>重新上传</Text>
              </View>
            )}
          </View>
        </View>

        {errorMessage && (
          <View className='detail-card warning'>
            <Text className='detail-card-title'>暂时无法读取</Text>
            <Text className='detail-card-desc'>{errorMessage}</Text>
          </View>
        )}

        <View className='detail-card'>
          <Text className='detail-card-title'>上传图片</Text>
          {imageUrls.length > 0 ? (
            <View className='image-grid'>
              {imageUrls.map((url, index) => (
                <Image key={`${url}-${index}`} className='uploaded-image' src={url} mode='aspectFill' />
              ))}
            </View>
          ) : (
            <Text className='detail-card-desc'>暂无图片信息。</Text>
          )}
        </View>

        {packaged ? (
          <>
            <View className='detail-card'>
              <Text className='detail-card-title'>结构化结果</Text>
              <View className='field-grid'>
                <View className='field-item'>
                  <Text className='field-label'>品牌</Text>
                  <Text className='field-value'>{packaged.brand || '未识别'}</Text>
                </View>
                <View className='field-item'>
                  <Text className='field-label'>品名</Text>
                  <Text className='field-value'>{packaged.product_name || '未识别'}</Text>
                </View>
                <View className='field-item'>
                  <Text className='field-label'>规格</Text>
                  <Text className='field-value'>{packaged.spec_text || `${formatNumber(packaged.net_weight_g, 'g')}`}</Text>
                </View>
                <View className='field-item'>
                  <Text className='field-label'>条码</Text>
                  <Text className='field-value'>{packaged.barcode || '未识别'}</Text>
                </View>
              </View>
            </View>

            <View className='detail-card'>
              <Text className='detail-card-title'>营养换算</Text>
              <View className='nutrition-row'>
                <View className='nutrition-chip'>
                  <Text className='nutrition-value'>{formatNumber(nutrition.calories)}</Text>
                  <Text className='nutrition-label'>kcal/{packaged.nutrition_basis_unit || '100g'}</Text>
                </View>
                <View className='nutrition-chip'>
                  <Text className='nutrition-value'>{formatNumber(nutrition.protein, 'g')}</Text>
                  <Text className='nutrition-label'>蛋白质</Text>
                </View>
                <View className='nutrition-chip'>
                  <Text className='nutrition-value'>{formatNumber(nutrition.carbs, 'g')}</Text>
                  <Text className='nutrition-label'>碳水</Text>
                </View>
                <View className='nutrition-chip'>
                  <Text className='nutrition-value'>{formatNumber(nutrition.fat, 'g')}</Text>
                  <Text className='nutrition-label'>脂肪</Text>
                </View>
              </View>
              <Text className='detail-card-desc'>换算状态：{packaged.conversion_status || '未知'}；置信度：{formatNumber((Number(packaged.extract_confidence) || 0) * 100, '%')}</Text>
            </View>

            <View className={`detail-card ${auto?.status === 'ingested' ? 'success' : 'warning'}`}>
              <Text className='detail-card-title'>入库与奖励</Text>
              <Text className='detail-card-desc'>
                {reward?.awarded
                  ? `新商品已入库，奖励积分 +${Number(reward.reward_credits) || 1}。`
                  : reward?.already_exists || auto?.upsert_action === 'updated'
                    ? '数据库已有同商品，本次不发放奖励积分。'
                    : auto?.status === 'ingested'
                      ? '商品已入库，本次不发放奖励积分。'
                      : describeBlockedReason(auto)}
              </Text>
              <Text className='detail-card-note'>商品库 ID：{packaged.packaged_food_id || auto?.packaged_food_id || reward?.packaged_food_id || '未入库'}</Text>
            </View>
          </>
        ) : (
          <View className='detail-card'>
            <Text className='detail-card-title'>{isTaskStillRunning(task?.status) ? '还在分析中' : '暂无结构化结果'}</Text>
            <Text className='detail-card-desc'>
              {isTaskStillRunning(task?.status)
                ? '后台还在识别，稍后刷新即可查看品名、规格、营养换算和奖励结果。'
                : taskFailureMessage(task)}
            </Text>
          </View>
        )}
      </ScrollView>
    </View>
  )
}

export default withAuth(PackagedFoodTaskDetailPage)
