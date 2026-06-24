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

const PACKAGED_FOOD_EDIT_DRAFT_KEY = 'packagedFoodEditDraft'

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

type NutritionMap = Record<string, number>

type DerivedPackagedNutrition = {
  unit: NutritionMap
  servingWeightG?: number
}

type ServingNutritionVariant = {
  weightG: number
  count: number
  nutrition: NutritionMap
}

const NUTRITION_KEYS = [
  'calories',
  'protein',
  'carbs',
  'fat',
  'fiber',
  'sugar',
  'saturatedFat',
  'cholesterolMg',
  'sodiumMg',
] as const

const NUMBER_RE = /[-+]?\d+(?:\.\d+)?/
const SERVING_WEIGHT_RE = /([0-9]+(?:\.[0-9]+)?)\s*(?:g|克)/i
const SPEC_COUNT_WEIGHT_RE = /([0-9]+(?:\.[0-9]+)?)\s*(?:支|个|枚|条|包|袋|杯|份)[^0-9]{0,24}(?:每|单|\/)[^0-9]{0,8}([0-9]+(?:\.[0-9]+)?)\s*(?:g|克)/gi

function hasCoreNutrition(unit?: Record<string, unknown> | null) {
  if (!unit) return false
  return Number(unit.calories) > 0 || Number(unit.protein) > 0 || Number(unit.carbs) > 0 || Number(unit.fat) > 0
}

function toNutritionMap(unit?: Record<string, unknown> | null): NutritionMap {
  const out: NutritionMap = {}
  if (!unit) return out
  NUTRITION_KEYS.forEach((key) => {
    const value = Number(unit[key])
    if (Number.isFinite(value) && value > 0) out[key] = value
  })
  return out
}

function derivePackagedNutrition(packaged?: PackagedProductExtractResult | null): DerivedPackagedNutrition {
  const existing = toNutritionMap(packaged?.unit_nutrition_per_100g)
  if (hasCoreNutrition(existing)) return { unit: existing, servingWeightG: Number(packaged?.serving_weight_g) || undefined }
  const derived = deriveMultiServingNutrition(packaged)
  return derived || { unit: existing, servingWeightG: Number(packaged?.serving_weight_g) || undefined }
}

function deriveMultiServingNutrition(packaged?: PackagedProductExtractResult | null): DerivedPackagedNutrition | null {
  const payload = packaged?.raw_label_payload
  if (!payload || typeof payload !== 'object') return null
  const variants: ServingNutritionVariant[] = Object.entries(payload).map(([label, value]) => {
    const raw = value && typeof value === 'object' ? value as Record<string, unknown> : null
    if (!raw) return null
    const weightG = parseServingWeight(label) || parseServingWeightFromPayload(raw)
    const nutrition = parseServingNutrition(raw)
    if (weightG <= 0 || !hasCoreNutrition(nutrition)) return null
    return { weightG, count: 0, nutrition }
  }).filter(Boolean) as ServingNutritionVariant[]
  if (variants.length < 2) return null

  const countsByWeight = parseSpecCountsByServingWeight(packaged?.spec_text || '')
  variants.forEach((variant) => {
    variant.count = countsByWeight[servingWeightKey(variant.weightG)] || 0
  })
  const fallbackCount = Number(packaged?.unit_count) > 0 ? Number(packaged?.unit_count) / variants.length : 1
  variants.forEach((variant) => {
    if (variant.count <= 0) variant.count = fallbackCount
  })

  const totalWeight = variants.reduce((sum, variant) => sum + variant.weightG * variant.count, 0)
  const totalCount = variants.reduce((sum, variant) => sum + variant.count, 0)
  const netWeight = Number(packaged?.net_weight_g) || Number((packaged as any)?.net_content_value) || 0
  if (totalWeight <= 0) return null
  if (netWeight > 0 && Math.abs(totalWeight - netWeight) > Math.max(5, netWeight * 0.03)) return null

  const unit: NutritionMap = {}
  NUTRITION_KEYS.forEach((key) => {
    const total = variants.reduce((sum, variant) => sum + (variant.nutrition[key] || 0) * variant.count, 0)
    if (total > 0) unit[key] = total * 100 / totalWeight
  })
  if (!hasCoreNutrition(unit)) return null
  return {
    unit,
    servingWeightG: totalCount > 0 ? totalWeight / totalCount : undefined,
  }
}

function parseServingWeight(text: string) {
  const match = String(text || '').match(SERVING_WEIGHT_RE)
  const value = match ? Number(match[1]) : 0
  return Number.isFinite(value) ? value : 0
}

function parseServingWeightFromPayload(raw: Record<string, unknown>) {
  for (const key of ['serving_weight_g', 'servingWeightG', '每份重量', '单支重量', '每支重量']) {
    const direct = Number(raw[key])
    if (Number.isFinite(direct) && direct > 0) return direct
    const parsed = parseServingWeight(String(raw[key] || ''))
    if (parsed > 0) return parsed
  }
  return 0
}

function parseSpecCountsByServingWeight(spec: string) {
  const out: Record<string, number> = {}
  const text = String(spec || '')
  SPEC_COUNT_WEIGHT_RE.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = SPEC_COUNT_WEIGHT_RE.exec(text)) !== null) {
    const count = Number(match[1])
    const weight = Number(match[2])
    if (Number.isFinite(count) && count > 0 && Number.isFinite(weight) && weight > 0) {
      out[servingWeightKey(weight)] = (out[servingWeightKey(weight)] || 0) + count
    }
  }
  return out
}

function servingWeightKey(weight: number) {
  return String(Math.round(weight * 10))
}

function parseServingNutrition(raw: Record<string, unknown>): NutritionMap {
  const out: NutritionMap = {}
  Object.entries(raw).forEach(([label, value]) => {
    const key = servingNutritionKey(label)
    if (!key) return
    const { amount, unit } = parseNutritionValue(value)
    if (amount <= 0) return
    if (key === 'calories') {
      out[key] = energyToKcalLabel(amount, unit)
    } else if (key.endsWith('Mg') && isGramUnit(unit)) {
      out[key] = amount * 1000
    } else {
      out[key] = amount
    }
  })
  return out
}

function servingNutritionKey(label: string): string {
  const key = String(label || '').toLowerCase().replace(/[\s_-]/g, '')
  if (key.includes('能量') || key.includes('energy') || key.includes('calorie') || key.includes('kcal')) return 'calories'
  if (key.includes('饱和脂肪') || key.includes('saturatedfat')) return 'saturatedFat'
  if (key.includes('蛋白') || key.includes('protein')) return 'protein'
  if (key.includes('碳水') || key.includes('carb')) return 'carbs'
  if (key.includes('脂肪') || key === 'fat') return 'fat'
  if (key.includes('膳食纤维') || key.includes('fiber') || key.includes('fibre')) return 'fiber'
  if (key.includes('糖') || key.includes('sugar')) return 'sugar'
  if (key.includes('胆固醇') || key.includes('cholesterol')) return 'cholesterolMg'
  if (key.includes('钠') || key.includes('sodium')) return 'sodiumMg'
  return ''
}

function parseNutritionValue(value: unknown) {
  if (value && typeof value === 'object') {
    const raw = value as Record<string, unknown>
    const amount = Number(raw.value)
    if (Number.isFinite(amount) && amount > 0) return { amount, unit: String(raw.unit || '').toLowerCase() }
  }
  const text = String(value || '')
  const numberText = text.match(NUMBER_RE)?.[0] || ''
  const amount = Number(numberText)
  return {
    amount: Number.isFinite(amount) ? amount : 0,
    unit: text.toLowerCase(),
  }
}

function energyToKcalLabel(value: number, unit: string) {
  if (unit.includes('kj') || unit.includes('千焦')) return value / 4.184
  return value
}

function isGramUnit(unit: string) {
  if (!unit || unit.includes('mg') || unit.includes('毫克')) return false
  return unit.includes('g') || unit.includes('克')
}

function describeBlockedReason(auto?: PackagedAutoIngestResult | null) {
  switch (auto?.reason) {
    case 'missing_net_content':
    case 'missing_net_weight':
      return '缺少净含量/规格。可以重拍包装正面，也可以补充净含量后提交待审核。'
    case 'missing_product_name':
      return '缺少商品名称。可以重拍包装正面，也可以补充品牌和品名后提交待审核。'
    case 'missing_nutrition':
      return '营养成分表不完整。可以重拍营养表，也可以按包装标签补齐后提交待审核。'
    case 'conversion_not_closed':
      return '营养口径无法可靠换算。请确认每100g/每份和每份重量，补齐后提交待审核。'
    case 'conflict':
      return '包装信息之间存在冲突。请重新拍清楚正面净含量和营养表，或补充确认后的标签信息。'
    case 'low_extract_confidence':
    case 'low_name_confidence':
    case 'low_spec_confidence':
    case 'low_nutrition_confidence':
      return '图片文字识别不够稳定。可以减少反光后重拍，也可以确认已识别字段并补齐缺失信息。'
    default:
      return '这次识别结果还不够完整。可以重拍更清晰图片，或补齐缺失字段后提交待审核。'
  }
}

function detailResultTitle(task?: AnalysisTask | null, packaged?: PackagedProductExtractResult | null, reward?: PackagedUploadRewardResult | null) {
  if (!task) return '正在读取任务'
  if (task.status === 'failed' || task.status === 'timed_out' || task.status === 'cancelled') return '这次没有分析成功'
  if (isTaskStillRunning(task.status)) return '已收到，后台分析中'
  if (reward?.awarded) return '新商品已入库'
  if (reward?.already_exists || packaged?.auto_ingest_result?.upsert_action === 'updated') return '商品库已有同商品'
  if (packaged?.auto_ingest_result?.status === 'ingested') return '商品已入库'
  return '暂未入库'
}

function detailResultDesc(task?: AnalysisTask | null, packaged?: PackagedProductExtractResult | null, reward?: PackagedUploadRewardResult | null) {
  if (!task) return '请稍等片刻，正在读取任务状态。'
  if (task.status === 'failed' || task.status === 'timed_out' || task.status === 'cancelled') {
    return taskFailureMessage(task)
  }
  if (isTaskStillRunning(task.status)) {
    return '系统已收到这一种商品的照片，正在识别品牌、品名、净含量和营养成分表。你可以稍后刷新查看结果。'
  }
  const auto = packaged?.auto_ingest_result
  if (reward?.awarded) {
    return `识别结果已写入食物库，因为数据库原本没有这个商品，本次奖励积分 +${Number(reward.reward_credits) || 1}。`
  }
  if (reward?.already_exists || auto?.upsert_action === 'updated') {
    return '识别结果匹配到数据库已有同商品，本次会用于更新数据，但不重复发放奖励积分。'
  }
  if (auto?.status === 'ingested') {
    return '商品已成功入库；本次未发放奖励积分，请以奖励记录为准。'
  }
  return describeBlockedReason(auto)
}

function statusText(task?: AnalysisTask | null, packaged?: PackagedProductExtractResult | null, reward?: PackagedUploadRewardResult | null) {
  if (!task) return '加载中'
  if (task.status === 'failed' || task.status === 'timed_out' || task.status === 'cancelled') return '分析失败'
  if (isTaskStillRunning(task.status)) return '后台分析中'
  if (reward?.awarded) return `已入库，奖励积分 +${Number(reward.reward_credits) || 1}`
  if (reward?.already_exists || packaged?.auto_ingest_result?.upsert_action === 'updated') return '数据库已有，本次不奖励'
  if (packaged?.auto_ingest_result?.status === 'ingested') return '已入库，本次不奖励'
  return '未入库，可补充'
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
  const derivedNutrition = useMemo(() => derivePackagedNutrition(packaged), [packaged])
  const nutrition = derivedNutrition.unit

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

  const supplementResult = () => {
    if (!packaged) return
    const netWeight = Number(packaged.net_weight_g) || Number((packaged as any).net_content_value) || 0
    Taro.setStorageSync(PACKAGED_FOOD_EDIT_DRAFT_KEY, {
      sourceTaskId: taskId,
      recognizedNameHint: packaged.product_name,
      frontImageUrl: imageUrls[0] || '',
      nutritionImageUrl: imageUrls[1] || '',
      ingredientsImageUrl: imageUrls[2] || '',
      brand: packaged.brand || '',
      productName: packaged.product_name || '',
      flavorText: packaged.flavor_text || '',
      packageCategory: packaged.package_category || '',
      specText: packaged.spec_text || '',
      barcode: packaged.barcode || '',
      ingredientsText: packaged.ingredients_text || '',
      netWeightG: netWeight > 0 ? String(netWeight) : '',
      servingWeightG: packaged.serving_weight_g ? String(packaged.serving_weight_g) : derivedNutrition.servingWeightG ? String(derivedNutrition.servingWeightG) : '',
      nutritionBasis: '100',
      energyUnit: 'kcal',
      calories: nutrition.calories != null ? String(nutrition.calories) : '',
      protein: nutrition.protein != null ? String(nutrition.protein) : '',
      carbs: nutrition.carbs != null ? String(nutrition.carbs) : '',
      fat: nutrition.fat != null ? String(nutrition.fat) : '',
      fiber: nutrition.fiber != null ? String(nutrition.fiber) : '',
      sugar: nutrition.sugar != null ? String(nutrition.sugar) : '',
      sodiumMg: nutrition.sodiumMg != null ? String(nutrition.sodiumMg) : '',
    })
    Taro.navigateTo({ url: '/packageExtra/pages/packaged-food-edit/index?mode=manual&task_mode=reward_center' })
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
            {packaged && !isTaskStillRunning(task?.status) && auto?.status !== 'ingested' && (
              <View className='detail-action-btn secondary' onClick={supplementResult}>
                <Text className='detail-action-text secondary'>补充信息</Text>
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
            <View className={`detail-card result ${reward?.awarded || auto?.status === 'ingested' ? 'success' : 'warning'}`}>
              <Text className='detail-card-title'>{detailResultTitle(task, packaged, reward)}</Text>
              <Text className='detail-card-desc'>{detailResultDesc(task, packaged, reward)}</Text>
            </View>

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
