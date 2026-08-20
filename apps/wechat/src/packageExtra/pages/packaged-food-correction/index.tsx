import { View, Text, ScrollView, Input, Image, Textarea } from '@tarojs/components'
import Taro, { useDidShow, useRouter } from '@tarojs/taro'
import { useMemo, useState } from 'react'
import {
  getPackagedFoodItem,
  showUnifiedApiError,
  submitPackagedFoodCorrection,
  uploadAnalyzeImageFile,
  type PackagedFoodCorrectionReasonType,
  type PackagedFoodItem,
  type SubmitPackagedFoodCorrectionRequest,
} from '../../../utils/api'
import { withAuth } from '../../../utils/withAuth'
import { chooseImageWithPrivacy, isPrivacyAuthorizeError, showPrivacyAuthorizeFailure } from '../../../utils/weapp-privacy'
import './index.scss'

type EnergyUnit = 'kj' | 'kcal'

type FormState = {
  brand: string
  productName: string
  specText: string
  barcode: string
  flavorText: string
  packageCategory: string
  ingredientsText: string
  netWeightG: string
  servingWeightG: string
  nutritionBasis: string
  energyUnit: EnergyUnit
  calories: string
  protein: string
  carbs: string
  fat: string
  fiber: string
  sugar: string
  sodiumMg: string
}

const reasonOptions: Array<{ value: PackagedFoodCorrectionReasonType; label: string }> = [
  { value: 'nutrition_wrong', label: '营养有误' },
  { value: 'name_wrong', label: '名称有误' },
  { value: 'spec_wrong', label: '规格有误' },
  { value: 'barcode_wrong', label: '条码有误' },
  { value: 'duplicate', label: '重复商品' },
  { value: 'other', label: '其他问题' },
]

const emptyForm: FormState = {
  brand: '',
  productName: '',
  specText: '',
  barcode: '',
  flavorText: '',
  packageCategory: '',
  ingredientsText: '',
  netWeightG: '',
  servingWeightG: '',
  nutritionBasis: '100',
  energyUnit: 'kcal',
  calories: '',
  protein: '',
  carbs: '',
  fat: '',
  fiber: '',
  sugar: '',
  sodiumMg: '',
}

const KJ_PER_KCAL = 4.184

function normalizeString(value: unknown) {
  return String(value || '').trim()
}

function formatNumber(value: unknown) {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return ''
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100)
}

function numberValue(value: string) {
  const n = Number(String(value || '').trim())
  return Number.isFinite(n) && n >= 0 ? n : 0
}

function positiveNumberValue(value: string, fallback = 100) {
  const n = Number(String(value || '').trim())
  return Number.isFinite(n) && n > 0 ? n : fallback
}

function basisFromItem(item: PackagedFoodItem) {
  return Number.parseInt(String(item.nutrition_basis_unit || '').replace(/[^\d]/g, ''), 10) || 100
}

function formFromItem(item: PackagedFoodItem): FormState {
  const basis = basisFromItem(item)
  const perBasis = (value?: number) => formatNumber((Number(value) || 0) * basis / 100)
  return {
    brand: normalizeString(item.brand),
    productName: normalizeString(item.product_name),
    specText: normalizeString(item.spec_text),
    barcode: normalizeString(item.barcode),
    flavorText: normalizeString(item.flavor_text),
    packageCategory: normalizeString(item.package_category),
    ingredientsText: normalizeString(item.ingredients_text),
    netWeightG: formatNumber(item.net_weight_g),
    servingWeightG: formatNumber(item.serving_weight_g),
    nutritionBasis: String(basis),
    energyUnit: normalizeString(item.energy_unit_raw).toLowerCase() === 'kj' ? 'kj' : 'kcal',
    calories: perBasis(item.kcal_per_100g),
    protein: perBasis(item.protein_per_100g),
    carbs: perBasis(item.carbs_per_100g),
    fat: perBasis(item.fat_per_100g),
    fiber: perBasis(item.fiber_per_100g),
    sugar: perBasis(item.sugar_per_100g),
    sodiumMg: perBasis(item.sodium_mg_per_100g),
  }
}

function energyToKcal(value: number, unit: EnergyUnit) {
  return unit === 'kj' ? value / KJ_PER_KCAL : value
}

function nutritionPer100g(value: string, basis: number) {
  return basis > 0 ? (numberValue(value) * 100) / basis : numberValue(value)
}

function PackagedFoodCorrectionPage() {
  const router = useRouter()
  const packagedFoodId = normalizeString(router.params?.packaged_food_id)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [item, setItem] = useState<PackagedFoodItem | null>(null)
  const [form, setForm] = useState<FormState>(emptyForm)
  const [reasonType, setReasonType] = useState<PackagedFoodCorrectionReasonType>('nutrition_wrong')
  const [comment, setComment] = useState('')
  const [evidenceImages, setEvidenceImages] = useState<string[]>([])

  const mergedImageUrls = useMemo(() => {
    const urls = [...(item?.source_image_urls || []), ...evidenceImages]
      .map(normalizeString)
      .filter(Boolean)
    return Array.from(new Set(urls))
  }, [item, evidenceImages])

  useDidShow(() => {
    if (!packagedFoodId || loading || item?.id === packagedFoodId) return
    setLoading(true)
    void (async () => {
      try {
        const nextItem = await getPackagedFoodItem(packagedFoodId)
        setItem(nextItem)
        setForm(formFromItem(nextItem))
      } catch (error) {
        await showUnifiedApiError(error, '加载包装食品库商品失败')
      } finally {
        setLoading(false)
      }
    })()
  })

  const updateField = (field: keyof FormState, value: string) => {
    setForm((current) => ({ ...current, [field]: value }))
  }

  const chooseEvidenceImage = async () => {
    if (mergedImageUrls.length >= 5) {
      Taro.showToast({ title: '包装图片总计最多5张', icon: 'none' })
      return
    }
    try {
      const chosen = await chooseImageWithPrivacy({
        count: 1,
        sizeType: ['compressed'],
        sourceType: ['album', 'camera'],
      })
      const tempPath = chosen.tempFilePaths?.[0]
      if (!tempPath) return
      Taro.showLoading({ title: '', mask: true })
      const uploaded = await uploadAnalyzeImageFile(tempPath)
      setEvidenceImages((current) => Array.from(new Set([...current, uploaded.imageUrl])).slice(0, 5))
      Taro.hideLoading()
      Taro.showToast({ title: '证据图已添加', icon: 'success' })
    } catch (error) {
      Taro.hideLoading()
      if (isPrivacyAuthorizeError(error)) {
        showPrivacyAuthorizeFailure(error)
      } else {
        await showUnifiedApiError(error, '上传证据图失败')
      }
    }
  }

  const removeEvidenceImage = (url: string) => {
    setEvidenceImages((current) => current.filter((currentUrl) => currentUrl !== url))
  }

  const handleSubmit = async () => {
    if (saving) return
    if (!packagedFoodId) {
      Taro.showToast({ title: '缺少纠错商品 ID', icon: 'none' })
      return
    }
    if (!form.productName.trim()) {
      Taro.showToast({ title: '请填写商品名称', icon: 'none' })
      return
    }
    if (numberValue(form.netWeightG) <= 0) {
      Taro.showToast({ title: '请填写净含量', icon: 'none' })
      return
    }
    if (mergedImageUrls.length === 0) {
      Taro.showToast({ title: '请至少补充 1 张证据图', icon: 'none' })
      return
    }
    if (reasonType === 'other' && !comment.trim()) {
      Taro.showToast({ title: '请补充问题说明', icon: 'none' })
      return
    }

    const basis = positiveNumberValue(form.nutritionBasis, 100)
    const payload: SubmitPackagedFoodCorrectionRequest = {
      packaged_food_id: packagedFoodId,
      reason_type: reasonType,
      comment: comment.trim() || undefined,
      brand: form.brand.trim() || undefined,
      product_name: form.productName.trim(),
      display_name: form.productName.trim(),
      spec_text: form.specText.trim() || undefined,
      barcode: form.barcode.trim() || undefined,
      flavor_text: form.flavorText.trim() || undefined,
      package_category: form.packageCategory.trim() || undefined,
      ingredients_text: form.ingredientsText.trim() || undefined,
      source_image_urls: mergedImageUrls,
      nutrition_basis_unit: `${basis}g`,
      energy_unit_raw: form.energyUnit,
      conversion_status: 'converted',
      review_status: 'pending',
      net_weight_g: numberValue(form.netWeightG),
      serving_weight_g: numberValue(form.servingWeightG) || numberValue(form.netWeightG),
      kcal_per_100g: (energyToKcal(numberValue(form.calories), form.energyUnit) * 100) / basis,
      protein_per_100g: nutritionPer100g(form.protein, basis),
      carbs_per_100g: nutritionPer100g(form.carbs, basis),
      fat_per_100g: nutritionPer100g(form.fat, basis),
      fiber_per_100g: nutritionPer100g(form.fiber, basis),
      sugar_per_100g: nutritionPer100g(form.sugar, basis),
      sodium_mg_per_100g: nutritionPer100g(form.sodiumMg, basis),
      ingest_method: 'user_correction_submission',
      raw_label_payload: {
        nutrition_basis: { type: 'per_weight', value: basis, unit: 'g' },
        entry_source: 'packaged_food_correction',
      },
    }

    setSaving(true)
    Taro.showLoading({ title: '', mask: true })
    try {
      await submitPackagedFoodCorrection(payload)
      Taro.hideLoading()
      Taro.showToast({ title: '纠错提案已提交', icon: 'success' })
      setTimeout(() => Taro.navigateBack(), 500)
    } catch (error) {
      Taro.hideLoading()
      await showUnifiedApiError(error, '提交包装食品纠错失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <View className='packaged-food-correction-page'>
      <ScrollView className='packaged-food-correction-scroll' scrollY>
        <View className='section-card hero-card'>
          <Text className='hero-title'>包装食品库纠错共建</Text>
          <Text className='hero-desc'>
            请按包装实物修正信息，并补充图片证据。提案会进入后台审核，通过后才会更新正式包装食品库。
          </Text>
          {!!item && (
            <View className='current-card'>
              <Text className='current-title'>{item.product_name || '当前商品'}</Text>
              <Text className='current-desc'>
                当前库内：{item.brand || '未填品牌'} / {item.spec_text || `${formatNumber(item.net_weight_g)}g`}
              </Text>
            </View>
          )}
        </View>

        <View className='section-card'>
          <Text className='section-title'>问题类型</Text>
          <View className='reason-row'>
            {reasonOptions.map((option) => (
              <View
                key={option.value}
                className={`reason-chip ${reasonType === option.value ? 'active' : ''}`}
                onClick={() => setReasonType(option.value)}
              >
                <Text className='reason-chip-text'>{option.label}</Text>
              </View>
            ))}
          </View>
          <Textarea
            className='comment-textarea'
            maxlength={300}
            value={comment}
            onInput={(event) => setComment(event.detail.value)}
            placeholder='补充说明你改了什么，证据来自哪张包装图。'
          />
        </View>

        <View className='section-card'>
          <Text className='section-title'>证据图片</Text>
          <Text className='section-hint'>
            默认会带上当前商品原始入库图片；原图与补充图合计最多5张，可拍包装正面、营养表或配料表。
          </Text>
          <View className='image-grid'>
            {mergedImageUrls.map((url) => {
              const isExtra = evidenceImages.includes(url)
              return (
                <View key={url} className='image-card'>
                  <Image className='image' src={url} mode='aspectFill' />
                  {isExtra && (
                    <View className='image-remove' onClick={() => removeEvidenceImage(url)}>
                      <Text className='image-remove-text'>移除</Text>
                    </View>
                  )}
                </View>
              )
            })}
          </View>
          <View className='upload-btn' onClick={chooseEvidenceImage}>
            <Text className='upload-btn-text'>补充证据图</Text>
          </View>
        </View>

        <View className='section-card'>
          <Text className='section-title'>修正后的商品信息</Text>
          <View className='field'>
            <Text className='label'>品牌</Text>
            <Input className='input' value={form.brand} onInput={(e) => updateField('brand', e.detail.value)} placeholder='例如：乐事' />
          </View>
          <View className='field'>
            <Text className='label'>商品名称</Text>
            <Input className='input' value={form.productName} onInput={(e) => updateField('productName', e.detail.value)} placeholder='例如：原切薯片黄瓜味' />
          </View>
          <View className='field-grid'>
            <View className='field'>
              <Text className='label'>规格</Text>
              <Input className='input' value={form.specText} onInput={(e) => updateField('specText', e.detail.value)} placeholder='例如：70g' />
            </View>
            <View className='field'>
              <Text className='label'>条码</Text>
              <Input className='input' value={form.barcode} onInput={(e) => updateField('barcode', e.detail.value)} placeholder='商品条码' />
            </View>
          </View>
          <View className='field-grid'>
            <View className='field'>
              <Text className='label'>口味</Text>
              <Input className='input' value={form.flavorText} onInput={(e) => updateField('flavorText', e.detail.value)} placeholder='例如：黄瓜味' />
            </View>
            <View className='field'>
              <Text className='label'>分类</Text>
              <Input className='input' value={form.packageCategory} onInput={(e) => updateField('packageCategory', e.detail.value)} placeholder='例如：薯片' />
            </View>
          </View>
          <View className='field'>
            <Text className='label'>配料说明</Text>
            <Textarea className='comment-textarea small' value={form.ingredientsText} onInput={(e) => updateField('ingredientsText', e.detail.value)} placeholder='可选，补充关键配料信息' maxlength={400} />
          </View>
        </View>

        <View className='section-card'>
          <Text className='section-title'>营养数据</Text>
          <View className='field-grid'>
            <View className='field'>
              <Text className='label'>净含量(g)</Text>
              <Input className='input' type='digit' value={form.netWeightG} onInput={(e) => updateField('netWeightG', e.detail.value)} placeholder='例如：70' />
            </View>
            <View className='field'>
              <Text className='label'>每份重量(g)</Text>
              <Input className='input' type='digit' value={form.servingWeightG} onInput={(e) => updateField('servingWeightG', e.detail.value)} placeholder='例如：35' />
            </View>
          </View>
          <View className='field-grid'>
            <View className='field'>
              <Text className='label'>营养口径(g)</Text>
              <Input className='input' type='digit' value={form.nutritionBasis} onInput={(e) => updateField('nutritionBasis', e.detail.value)} placeholder='一般填 100' />
            </View>
            <View className='field'>
              <Text className='label'>能量单位</Text>
              <View className='unit-row'>
                <View className={`unit-chip ${form.energyUnit === 'kcal' ? 'active' : ''}`} onClick={() => updateField('energyUnit', 'kcal')}>
                  <Text className='unit-chip-text'>kcal</Text>
                </View>
                <View className={`unit-chip ${form.energyUnit === 'kj' ? 'active' : ''}`} onClick={() => updateField('energyUnit', 'kj')}>
                  <Text className='unit-chip-text'>kJ</Text>
                </View>
              </View>
            </View>
          </View>
          <View className='field-grid'>
            <View className='field'>
              <Text className='label'>能量</Text>
              <Input className='input' type='digit' value={form.calories} onInput={(e) => updateField('calories', e.detail.value)} placeholder='按上面口径填写' />
            </View>
            <View className='field'>
              <Text className='label'>蛋白质(g)</Text>
              <Input className='input' type='digit' value={form.protein} onInput={(e) => updateField('protein', e.detail.value)} />
            </View>
            <View className='field'>
              <Text className='label'>碳水(g)</Text>
              <Input className='input' type='digit' value={form.carbs} onInput={(e) => updateField('carbs', e.detail.value)} />
            </View>
            <View className='field'>
              <Text className='label'>脂肪(g)</Text>
              <Input className='input' type='digit' value={form.fat} onInput={(e) => updateField('fat', e.detail.value)} />
            </View>
            <View className='field'>
              <Text className='label'>膳食纤维(g)</Text>
              <Input className='input' type='digit' value={form.fiber} onInput={(e) => updateField('fiber', e.detail.value)} />
            </View>
            <View className='field'>
              <Text className='label'>糖(g)</Text>
              <Input className='input' type='digit' value={form.sugar} onInput={(e) => updateField('sugar', e.detail.value)} />
            </View>
            <View className='field'>
              <Text className='label'>钠(mg)</Text>
              <Input className='input' type='digit' value={form.sodiumMg} onInput={(e) => updateField('sodiumMg', e.detail.value)} />
            </View>
          </View>
        </View>

        <View className='footer-spacer' />
      </ScrollView>

      <View className='footer'>
        <View className={`submit-btn ${saving ? 'loading' : ''}`} onClick={handleSubmit}>
          <Text className='submit-btn-text'>{saving ? '提交中...' : '提交纠错提案'}</Text>
        </View>
      </View>
    </View>
  )
}

export default withAuth(PackagedFoodCorrectionPage)
