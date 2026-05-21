import { View, Text, ScrollView, Input } from '@tarojs/components'
import { useState } from 'react'
import Taro, { useDidShow } from '@tarojs/taro'
import { withAuth } from '../../../utils/withAuth'
import {
  compressImagePathForUpload,
  createPackagedFood,
  getAnalyzeTask,
  showUnifiedApiError,
  submitPackagedNutritionLabelRecognition,
  uploadAnalyzeImageFile,
  type CreatePackagedFoodRequest,
  type PackagedNutritionLabelRecognition,
} from '../../../utils/api'
import { chooseImageWithPrivacy, isPrivacyAuthorizeError, showPrivacyAuthorizeFailure } from '../../../utils/weapp-privacy'
import './index.scss'

const PACKAGED_FOOD_EDIT_DRAFT_KEY = 'packagedFoodEditDraft'
const PACKAGED_FOOD_EDIT_SAVED_KEY = 'packagedFoodEditSaved'

type Draft = {
  itemId?: number
  brand: string
  productName: string
  netWeightG: string
  calories: string
  protein: string
  carbs: string
  fat: string
  fiber: string
  sugar: string
  sodiumMg: string
  saturatedFat: string
  cholesterolMg: string
  potassiumMg: string
  calciumMg: string
  ironMg: string
  magnesiumMg: string
  zincMg: string
  vitaminARaeMcg: string
  vitaminCMg: string
  vitaminDMcg: string
  vitaminEMg: string
  vitaminKMcg: string
  thiaminMg: string
  riboflavinMg: string
  niacinMg: string
  vitaminB6Mg: string
  folateMcg: string
  vitaminB12Mcg: string
}

const emptyDraft: Draft = {
  brand: '',
  productName: '',
  netWeightG: '',
  calories: '',
  protein: '',
  carbs: '',
  fat: '',
  fiber: '',
  sugar: '',
  sodiumMg: '',
  saturatedFat: '',
  cholesterolMg: '',
  potassiumMg: '',
  calciumMg: '',
  ironMg: '',
  magnesiumMg: '',
  zincMg: '',
  vitaminARaeMcg: '',
  vitaminCMg: '',
  vitaminDMcg: '',
  vitaminEMg: '',
  vitaminKMcg: '',
  thiaminMg: '',
  riboflavinMg: '',
  niacinMg: '',
  vitaminB6Mg: '',
  folateMcg: '',
  vitaminB12Mcg: '',
}

const moreNutritionFields: Array<{ field: keyof Draft; label: string; unit: string }> = [
  { field: 'saturatedFat', label: '饱和脂肪', unit: 'g' },
  { field: 'cholesterolMg', label: '胆固醇', unit: 'mg' },
  { field: 'potassiumMg', label: '钾', unit: 'mg' },
  { field: 'calciumMg', label: '钙', unit: 'mg' },
  { field: 'ironMg', label: '铁', unit: 'mg' },
  { field: 'magnesiumMg', label: '镁', unit: 'mg' },
  { field: 'zincMg', label: '锌', unit: 'mg' },
  { field: 'vitaminARaeMcg', label: '维生素A', unit: 'mcg' },
  { field: 'vitaminCMg', label: '维生素C', unit: 'mg' },
  { field: 'vitaminDMcg', label: '维生素D', unit: 'mcg' },
  { field: 'vitaminEMg', label: '维生素E', unit: 'mg' },
  { field: 'vitaminKMcg', label: '维生素K', unit: 'mcg' },
  { field: 'thiaminMg', label: '维生素B1', unit: 'mg' },
  { field: 'riboflavinMg', label: '维生素B2', unit: 'mg' },
  { field: 'niacinMg', label: '烟酸', unit: 'mg' },
  { field: 'vitaminB6Mg', label: '维生素B6', unit: 'mg' },
  { field: 'folateMcg', label: '叶酸', unit: 'mcg' },
  { field: 'vitaminB12Mcg', label: '维生素B12', unit: 'mcg' },
]

const numberFromDraft = (value: string) => {
  const n = Number(String(value || '').trim())
  return Number.isFinite(n) && n >= 0 ? n : 0
}

function PackagedFoodEditPage() {
  const [draft, setDraft] = useState<Draft>(emptyDraft)
  const [saving, setSaving] = useState(false)
  const [recognizing, setRecognizing] = useState(false)
  const [showMoreNutrition, setShowMoreNutrition] = useState(false)

  useDidShow(() => {
    try {
      const saved = Taro.getStorageSync(PACKAGED_FOOD_EDIT_DRAFT_KEY)
      if (saved && typeof saved === 'object') {
        setDraft({ ...emptyDraft, ...saved })
      }
    } catch {}
  })

  const updateField = (field: keyof Draft, value: string) => {
    setDraft(current => ({ ...current, [field]: value }))
  }

  const formatRecognizedNumber = (value: unknown) => {
    const n = Number(value)
    if (!Number.isFinite(n) || n <= 0) return ''
    return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100)
  }

  const fillIfRecognized = (current: Draft, field: keyof Draft, value: unknown) => {
    const next = formatRecognizedNumber(value)
    return next ? { ...current, [field]: next } : current
  }

  const applyRecognizedNutrition = (nutrition: PackagedNutritionLabelRecognition) => {
    setDraft(current => {
      let next = { ...current }
      const productName = String(nutrition.product_name || '').trim()
      const brand = String(nutrition.brand || '').trim()
      if (productName) next.productName = productName
      if (brand) next.brand = brand
      next = fillIfRecognized(next, 'netWeightG', nutrition.net_weight_g)
      next = fillIfRecognized(next, 'calories', nutrition.kcal_per_100g)
      next = fillIfRecognized(next, 'protein', nutrition.protein_per_100g)
      next = fillIfRecognized(next, 'carbs', nutrition.carbs_per_100g)
      next = fillIfRecognized(next, 'fat', nutrition.fat_per_100g)
      next = fillIfRecognized(next, 'fiber', nutrition.fiber_per_100g)
      next = fillIfRecognized(next, 'sugar', nutrition.sugar_per_100g)
      next = fillIfRecognized(next, 'sodiumMg', nutrition.sodium_mg_per_100g)
      next = fillIfRecognized(next, 'saturatedFat', nutrition.saturated_fat_per_100g)
      next = fillIfRecognized(next, 'cholesterolMg', nutrition.cholesterol_mg_per_100g)
      next = fillIfRecognized(next, 'potassiumMg', nutrition.potassium_mg_per_100g)
      next = fillIfRecognized(next, 'calciumMg', nutrition.calcium_mg_per_100g)
      next = fillIfRecognized(next, 'ironMg', nutrition.iron_mg_per_100g)
      next = fillIfRecognized(next, 'magnesiumMg', nutrition.magnesium_mg_per_100g)
      next = fillIfRecognized(next, 'zincMg', nutrition.zinc_mg_per_100g)
      next = fillIfRecognized(next, 'vitaminARaeMcg', nutrition.vitamin_a_rae_mcg_per_100g)
      next = fillIfRecognized(next, 'vitaminCMg', nutrition.vitamin_c_mg_per_100g)
      next = fillIfRecognized(next, 'vitaminDMcg', nutrition.vitamin_d_mcg_per_100g)
      next = fillIfRecognized(next, 'vitaminEMg', nutrition.vitamin_e_mg_per_100g)
      next = fillIfRecognized(next, 'vitaminKMcg', nutrition.vitamin_k_mcg_per_100g)
      next = fillIfRecognized(next, 'thiaminMg', nutrition.thiamin_mg_per_100g)
      next = fillIfRecognized(next, 'riboflavinMg', nutrition.riboflavin_mg_per_100g)
      next = fillIfRecognized(next, 'niacinMg', nutrition.niacin_mg_per_100g)
      next = fillIfRecognized(next, 'vitaminB6Mg', nutrition.vitamin_b6_mg_per_100g)
      next = fillIfRecognized(next, 'folateMcg', nutrition.folate_mcg_per_100g)
      next = fillIfRecognized(next, 'vitaminB12Mcg', nutrition.vitamin_b12_mcg_per_100g)
      return next
    })
  }

  const handleRecognizeNutritionLabel = async () => {
    if (recognizing) return
    try {
      const chooseRes = await chooseImageWithPrivacy({
        count: 1,
        sizeType: ['compressed'],
        sourceType: ['camera', 'album'],
      })
      const localPath = chooseRes.tempFilePaths?.[0]
      if (!localPath) return
      setRecognizing(true)
      Taro.showLoading({ title: '识别中...', mask: true })
      const uploadPath = await compressImagePathForUpload(localPath)
      const { imageUrl } = await uploadAnalyzeImageFile(uploadPath)
      const { task_id: taskId } = await submitPackagedNutritionLabelRecognition(imageUrl)
      const nutrition = await pollNutritionLabelTask(taskId)
      applyRecognizedNutrition(nutrition)
      Taro.hideLoading()
      Taro.showToast({ title: '已填充识别结果', icon: 'success' })
    } catch (error) {
      Taro.hideLoading()
      if (isPrivacyAuthorizeError(error)) {
        showPrivacyAuthorizeFailure(error)
      } else {
        await showUnifiedApiError(error, '识别营养成分表失败')
      }
    } finally {
      setRecognizing(false)
    }
  }

  const pollNutritionLabelTask = async (taskId: string): Promise<PackagedNutritionLabelRecognition> => {
    const started = Date.now()
    while (Date.now() - started < 120000) {
      await new Promise(resolve => setTimeout(resolve, 1800))
      const task = await getAnalyzeTask(taskId)
      if (task.status === 'done') {
        const result = (task.result || {}) as Record<string, any>
        const nutrition = result.nutrition as PackagedNutritionLabelRecognition | undefined
        if (!nutrition) {
          throw new Error('识别任务已完成，但没有返回营养成分')
        }
        return nutrition
      }
      if (task.status === 'failed' || task.status === 'timed_out' || task.status === 'cancelled') {
        throw new Error(task.error_message || '识别营养成分表失败')
      }
    }
    throw new Error('识别时间较长，请稍后重试')
  }

  const handleSubmit = async () => {
    if (saving) return
    const productName = draft.productName.trim()
    const netWeightG = numberFromDraft(draft.netWeightG)
    if (!productName) {
      Taro.showToast({ title: '请填写零食名称', icon: 'none' })
      return
    }
    if (netWeightG <= 0) {
      Taro.showToast({ title: '请填写重量', icon: 'none' })
      return
    }

    const payload: CreatePackagedFoodRequest = {
      brand: draft.brand.trim() || undefined,
      product_name: productName,
      net_weight_g: netWeightG,
      serving_weight_g: netWeightG,
      kcal_per_100g: numberFromDraft(draft.calories),
      protein_per_100g: numberFromDraft(draft.protein),
      carbs_per_100g: numberFromDraft(draft.carbs),
      fat_per_100g: numberFromDraft(draft.fat),
      fiber_per_100g: numberFromDraft(draft.fiber),
      sugar_per_100g: numberFromDraft(draft.sugar),
      sodium_mg_per_100g: numberFromDraft(draft.sodiumMg),
      saturated_fat_per_100g: numberFromDraft(draft.saturatedFat),
      cholesterol_mg_per_100g: numberFromDraft(draft.cholesterolMg),
      potassium_mg_per_100g: numberFromDraft(draft.potassiumMg),
      calcium_mg_per_100g: numberFromDraft(draft.calciumMg),
      iron_mg_per_100g: numberFromDraft(draft.ironMg),
      magnesium_mg_per_100g: numberFromDraft(draft.magnesiumMg),
      zinc_mg_per_100g: numberFromDraft(draft.zincMg),
      vitamin_a_rae_mcg_per_100g: numberFromDraft(draft.vitaminARaeMcg),
      vitamin_c_mg_per_100g: numberFromDraft(draft.vitaminCMg),
      vitamin_d_mcg_per_100g: numberFromDraft(draft.vitaminDMcg),
      vitamin_e_mg_per_100g: numberFromDraft(draft.vitaminEMg),
      vitamin_k_mcg_per_100g: numberFromDraft(draft.vitaminKMcg),
      thiamin_mg_per_100g: numberFromDraft(draft.thiaminMg),
      riboflavin_mg_per_100g: numberFromDraft(draft.riboflavinMg),
      niacin_mg_per_100g: numberFromDraft(draft.niacinMg),
      vitamin_b6_mg_per_100g: numberFromDraft(draft.vitaminB6Mg),
      folate_mcg_per_100g: numberFromDraft(draft.folateMcg),
      vitamin_b12_mcg_per_100g: numberFromDraft(draft.vitaminB12Mcg),
    }

    setSaving(true)
    Taro.showLoading({ title: '保存中...', mask: true })
    try {
      await createPackagedFood(payload)
      Taro.setStorageSync(PACKAGED_FOOD_EDIT_SAVED_KEY, { itemId: draft.itemId })
      Taro.removeStorageSync(PACKAGED_FOOD_EDIT_DRAFT_KEY)
      Taro.hideLoading()
      Taro.showToast({ title: '已保存到零食库', icon: 'success' })
      setTimeout(() => {
        Taro.navigateBack()
      }, 450)
    } catch (error) {
      Taro.hideLoading()
      await showUnifiedApiError(error, '保存零食数据失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <View className='packaged-food-edit-page'>
      <ScrollView className='packaged-food-edit-scroll' scrollY>
        <View className='edit-section'>
          <Text className='section-title'>基础信息</Text>
          <View className='recognize-card'>
            <View className='recognize-copy'>
              <Text className='recognize-title'>拍照识别营养成分表</Text>
              <Text className='recognize-desc'>拍清楚包装背面的营养成分表，识别后会自动填充下面的字段。</Text>
            </View>
            <View className={`recognize-btn ${recognizing ? 'loading' : ''}`} onClick={handleRecognizeNutritionLabel}>
              <Text className='recognize-btn-text'>{recognizing ? '识别中...' : '拍照识别'}</Text>
            </View>
          </View>
          <View className='field'>
            <Text className='field-label'>名称</Text>
            <Input className='field-input' value={draft.productName} placeholder='零食名称' onInput={(e) => updateField('productName', e.detail.value)} />
          </View>
          <View className='field'>
            <Text className='field-label'>品牌</Text>
            <Input className='field-input' value={draft.brand} placeholder='可选' onInput={(e) => updateField('brand', e.detail.value)} />
          </View>
          <View className='field'>
            <Text className='field-label'>重量</Text>
            <View className='field-input-with-unit'>
              <Input className='field-input' type='digit' value={draft.netWeightG} placeholder='净含量或本次包装重量' onInput={(e) => updateField('netWeightG', e.detail.value)} />
              <Text className='field-unit'>g</Text>
            </View>
          </View>
        </View>

        <View className='edit-section'>
          <Text className='section-title'>每100g营养成分</Text>
          <View className='nutrition-grid'>
            <View className='field compact'>
              <Text className='field-label'>热量</Text>
              <View className='field-input-with-unit'>
                <Input className='field-input' type='digit' value={draft.calories} placeholder='0' onInput={(e) => updateField('calories', e.detail.value)} />
                <Text className='field-unit'>kcal</Text>
              </View>
            </View>
            <View className='field compact'>
              <Text className='field-label'>蛋白质</Text>
              <View className='field-input-with-unit'>
                <Input className='field-input' type='digit' value={draft.protein} placeholder='0' onInput={(e) => updateField('protein', e.detail.value)} />
                <Text className='field-unit'>g</Text>
              </View>
            </View>
            <View className='field compact'>
              <Text className='field-label'>碳水</Text>
              <View className='field-input-with-unit'>
                <Input className='field-input' type='digit' value={draft.carbs} placeholder='0' onInput={(e) => updateField('carbs', e.detail.value)} />
                <Text className='field-unit'>g</Text>
              </View>
            </View>
            <View className='field compact'>
              <Text className='field-label'>脂肪</Text>
              <View className='field-input-with-unit'>
                <Input className='field-input' type='digit' value={draft.fat} placeholder='0' onInput={(e) => updateField('fat', e.detail.value)} />
                <Text className='field-unit'>g</Text>
              </View>
            </View>
            <View className='field compact'>
              <Text className='field-label'>膳食纤维</Text>
              <View className='field-input-with-unit'>
                <Input className='field-input' type='digit' value={draft.fiber} placeholder='0' onInput={(e) => updateField('fiber', e.detail.value)} />
                <Text className='field-unit'>g</Text>
              </View>
            </View>
            <View className='field compact'>
              <Text className='field-label'>糖</Text>
              <View className='field-input-with-unit'>
                <Input className='field-input' type='digit' value={draft.sugar} placeholder='0' onInput={(e) => updateField('sugar', e.detail.value)} />
                <Text className='field-unit'>g</Text>
              </View>
            </View>
            <View className='field compact wide'>
              <Text className='field-label'>钠</Text>
              <View className='field-input-with-unit'>
                <Input className='field-input' type='digit' value={draft.sodiumMg} placeholder='0' onInput={(e) => updateField('sodiumMg', e.detail.value)} />
                <Text className='field-unit'>mg</Text>
              </View>
            </View>
          </View>
        </View>

        <View className='edit-section more-section'>
          <View className='more-header' onClick={() => setShowMoreNutrition(current => !current)}>
            <View className='more-title-wrap'>
              <Text className='section-title more-title'>更多营养成分</Text>
              <Text className='more-subtitle'>维生素、矿物质等可选数据</Text>
            </View>
            <Text className={`more-arrow ${showMoreNutrition ? 'open' : ''}`}>⌄</Text>
          </View>
          {showMoreNutrition && (
            <View className='nutrition-grid more-grid'>
              {moreNutritionFields.map((item) => (
                <View key={item.field} className='field compact'>
                  <Text className='field-label'>{item.label}</Text>
                  <View className='field-input-with-unit'>
                    <Input
                      className='field-input'
                      type='digit'
                      value={String(draft[item.field] || '')}
                      placeholder='0'
                      onInput={(e) => updateField(item.field, e.detail.value)}
                    />
                    <Text className='field-unit'>{item.unit}</Text>
                  </View>
                </View>
              ))}
            </View>
          )}
        </View>
        <View className='edit-footer-spacer' />
      </ScrollView>

      <View className='edit-footer'>
        <View className={`save-btn ${saving ? 'loading' : ''}`} onClick={handleSubmit}>
          <Text className='save-btn-text'>{saving ? '保存中...' : '保存到零食库'}</Text>
        </View>
      </View>
    </View>
  )
}

export default withAuth(PackagedFoodEditPage)
