import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
import {
  ActivityIndicator,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import * as ImagePicker from 'expo-image-picker'
import type { NativeStackScreenProps } from '@react-navigation/native-stack'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { AlertTriangle, Camera, ImagePlus, Images, Info, PackageCheck, RefreshCw, X } from 'lucide-react-native'
import type { PackagedFoodItem } from '@food-link/core'
import type { PackagedFoodCorrectionReasonType } from '@food-link/api-client'
import { apiClient } from '../api'
import type { RootStackParamList } from '../navigation/types'
import { useColorScheme } from '../providers/ColorSchemeProvider'
import { AppAlert as Alert } from '../providers/DialogProvider'
import { userFacingErrorMessage } from '../utils/errors'

type Props = NativeStackScreenProps<RootStackParamList, 'PackagedFoodCorrection'>
type EnergyUnit = 'kj' | 'kcal'
type EvidenceImage = { id: string; uri: string; remoteUrl?: string; uploading: boolean }

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

type ErrorKey = keyof FormState | 'evidence' | 'comment'
type FormErrors = Partial<Record<ErrorKey, string>>
type NumericFieldKey = 'netWeightG' | 'servingWeightG' | 'nutritionBasis' | 'calories' | 'protein' | 'carbs' | 'fat' | 'fiber' | 'sugar' | 'sodiumMg'

const MAX_IMAGES = 5
const KJ_PER_KCAL = 4.184
const reasonOptions: Array<{ value: PackagedFoodCorrectionReasonType; label: string }> = [
  { value: 'nutrition_wrong', label: '营养有误' },
  { value: 'name_wrong', label: '名称有误' },
  { value: 'spec_wrong', label: '规格有误' },
  { value: 'barcode_wrong', label: '条码有误' },
  { value: 'duplicate', label: '重复商品' },
  { value: 'other', label: '其他问题' },
]

const nutrientFields: Array<{ key: NumericFieldKey; label: string; unit?: string; placeholder?: string }> = [
  { key: 'calories', label: '能量', placeholder: '按上面口径填写' },
  { key: 'protein', label: '蛋白质', unit: 'g' },
  { key: 'carbs', label: '碳水', unit: 'g' },
  { key: 'fat', label: '脂肪', unit: 'g' },
  { key: 'fiber', label: '膳食纤维', unit: 'g' },
  { key: 'sugar', label: '糖', unit: 'g' },
  { key: 'sodiumMg', label: '钠', unit: 'mg' },
]

const emptyForm: FormState = {
  brand: '', productName: '', specText: '', barcode: '', flavorText: '', packageCategory: '', ingredientsText: '',
  netWeightG: '', servingWeightG: '', nutritionBasis: '100', energyUnit: 'kcal', calories: '', protein: '', carbs: '',
  fat: '', fiber: '', sugar: '', sodiumMg: '',
}

function usePalette() {
  const { isDark } = useColorScheme()
  return useMemo(() => ({
    page: isDark ? '#0f1513' : '#f5f8f6', card: isDark ? '#18211e' : '#ffffff', soft: isDark ? '#202b27' : '#f0f7f3',
    input: isDark ? '#111916' : '#f8faf9', text: isDark ? '#f2f7f4' : '#17211d', secondary: isDark ? '#bdc9c3' : '#5f6d66',
    muted: isDark ? '#94a39b' : '#7c8a83', border: isDark ? '#34433d' : '#dfe9e3', brand: '#059669', brandPressed: '#047857',
    brandSoft: isDark ? '#143b30' : '#e7f8f1', warning: isDark ? '#f7c96b' : '#9a5c0a', warningSoft: isDark ? '#3a2d14' : '#fff4dd',
    danger: isDark ? '#fca5a5' : '#c93744', dangerBorder: isDark ? '#6b3037' : '#efb8bd', scrim: 'rgba(3, 9, 7, 0.64)',
  }), [isDark])
}

const normalizeString = (value: unknown) => String(value || '').trim()
const parseNumber = (value: string) => value.trim() ? Number(value.trim()) : Number.NaN
const numberOrZero = (value: string) => { const number = Number(value.trim()); return Number.isFinite(number) && number >= 0 ? number : 0 }
const positiveNumber = (value: string, fallback = 100) => { const number = Number(value.trim()); return Number.isFinite(number) && number > 0 ? number : fallback }
const formatNumber = (value: unknown) => { const number = Number(value); return Number.isFinite(number) && number > 0 ? String(Number(number.toFixed(2))) : '' }
const basisFromItem = (item: PackagedFoodItem) => Number.parseInt(String(item.nutrition_basis_unit || '').replace(/[^\d]/g, ''), 10) || 100
const correctionImageId = (index: number) => `correction-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 8)}`

function formFromItem(item: PackagedFoodItem): FormState {
  const basis = basisFromItem(item)
  const perBasis = (value: unknown) => formatNumber((Number(value) || 0) * basis / 100)
  return {
    brand: normalizeString(item.brand), productName: normalizeString(item.product_name), specText: normalizeString(item.spec_text),
    barcode: normalizeString(item.barcode), flavorText: normalizeString(item.flavor_text), packageCategory: normalizeString(item.package_category),
    ingredientsText: normalizeString(item.ingredients_text), netWeightG: formatNumber(item.net_weight_g), servingWeightG: formatNumber(item.serving_weight_g),
    nutritionBasis: String(basis), energyUnit: normalizeString(item.energy_unit_raw).toLowerCase() === 'kj' ? 'kj' : 'kcal',
    calories: perBasis(item.kcal_per_100g), protein: perBasis(item.protein_per_100g), carbs: perBasis(item.carbs_per_100g),
    fat: perBasis(item.fat_per_100g), fiber: perBasis(item.fiber_per_100g), sugar: perBasis(item.sugar_per_100g), sodiumMg: perBasis(item.sodium_mg_per_100g),
  }
}

export function PackagedFoodCorrectionScreen({ navigation, route }: Props) {
  const palette = usePalette()
  const insets = useSafeAreaInsets()
  const requestRef = useRef(0)
  const productNameRef = useRef<TextInput>(null)
  const netWeightRef = useRef<TextInput>(null)
  const packagedFoodId = route.params.packagedFoodId.trim()
  const [item, setItem] = useState<PackagedFoodItem | null>(null)
  const [form, setForm] = useState<FormState>(emptyForm)
  const [reasonType, setReasonType] = useState<PackagedFoodCorrectionReasonType>('nutrition_wrong')
  const [comment, setComment] = useState('')
  const [evidenceImages, setEvidenceImages] = useState<EvidenceImage[]>([])
  const [errors, setErrors] = useState<FormErrors>({})
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [sourcePickerVisible, setSourcePickerVisible] = useState(false)
  const uploading = evidenceImages.some((image) => image.uploading)

  const mergedImages = useMemo(() => {
    const seen = new Set<string>()
    const values: Array<{ key: string; uri: string; url: string; removable: boolean; uploading: boolean }> = []
    for (const url of item?.source_image_urls || []) {
      const normalized = normalizeString(url)
      if (!normalized || seen.has(normalized)) continue
      seen.add(normalized)
      values.push({ key: `original-${normalized}`, uri: normalized, url: normalized, removable: false, uploading: false })
    }
    for (const image of evidenceImages) {
      const url = normalizeString(image.remoteUrl)
      const dedupeKey = url || image.id
      if (seen.has(dedupeKey)) continue
      seen.add(dedupeKey)
      values.push({ key: image.id, uri: image.uri, url, removable: true, uploading: image.uploading })
    }
    return values.slice(0, MAX_IMAGES)
  }, [evidenceImages, item?.source_image_urls])

  const load = async () => {
    const request = ++requestRef.current
    setLoading(true)
    setLoadError('')
    try {
      const nextItem = await apiClient.getPackagedFoodItem(packagedFoodId)
      if (request !== requestRef.current) return
      setItem(nextItem)
      setForm(formFromItem(nextItem))
      setEvidenceImages([])
      setErrors({})
    } catch (error) {
      if (request === requestRef.current) setLoadError(userFacingErrorMessage(error, '暂时无法读取这条包装食品，请稍后重试。'))
    } finally {
      if (request === requestRef.current) setLoading(false)
    }
  }

  useEffect(() => {
    if (!packagedFoodId) {
      setLoading(false)
      setLoadError('缺少包装食品 ID，无法发起纠错。')
      return
    }
    void load()
    return () => { requestRef.current += 1 }
  }, [packagedFoodId])

  const updateField = (key: keyof FormState, value: string) => {
    setForm((current) => ({ ...current, [key]: value }))
    setErrors((current) => ({ ...current, [key]: undefined }))
  }

  const validateNumericField = (key: NumericFieldKey) => {
    const value = form[key]
    const parsed = parseNumber(value)
    const requiredPositive = key === 'netWeightG' || key === 'nutritionBasis'
    const message = requiredPositive && (!Number.isFinite(parsed) || parsed <= 0)
      ? key === 'netWeightG' ? '请填写大于 0 的净含量' : '营养口径必须大于 0'
      : value.trim() && (!Number.isFinite(parsed) || parsed < 0) ? '请输入 0 或正数' : undefined
    setErrors((current) => ({ ...current, [key]: message }))
    return message
  }

  const uploadAssets = async (assets: ImagePicker.ImagePickerAsset[]) => {
    const remaining = Math.max(0, MAX_IMAGES - mergedImages.length)
    const selected = assets.slice(0, remaining)
    if (!selected.length) return
    const pending = selected.map((asset, index) => ({ id: correctionImageId(index), uri: asset.uri, uploading: true }))
    setEvidenceImages((current) => [...current, ...pending])
    setErrors((current) => ({ ...current, evidence: undefined }))
    let failed = 0
    for (let index = 0; index < selected.length; index += 1) {
      const asset = selected[index]
      const target = pending[index]
      try {
        const uploaded = await apiClient.uploadAnalyzeImageFile({
          fileUri: asset.uri,
          fileName: asset.fileName || `packaged-correction-${Date.now()}-${index + 1}.jpg`,
          mimeType: asset.mimeType || 'image/jpeg',
        })
        setEvidenceImages((current) => current.map((image) => image.id === target.id ? { ...image, remoteUrl: uploaded.imageUrl, uploading: false } : image))
      } catch {
        failed += 1
        setEvidenceImages((current) => current.filter((image) => image.id !== target.id))
      }
    }
    if (failed) {
      Alert.alert(
        failed === selected.length ? '上传失败' : '部分图片上传失败',
        failed === selected.length ? '没有图片上传成功，请检查网络后重试。' : `有 ${failed} 张图片未上传成功，其余图片已保留。`,
      )
    }
  }

  const pickEvidence = async (source: 'camera' | 'library') => {
    if (uploading || submitting) return
    const remaining = MAX_IMAGES - mergedImages.length
    if (remaining <= 0) return Alert.alert('图片已满', '当前商品原图与补充证据合计最多 5 张。')
    try {
      if (source === 'camera') {
        const permission = await ImagePicker.requestCameraPermissionsAsync()
        if (!permission.granted) return Alert.alert('需要相机权限', '请允许使用相机拍摄包装正面、营养表或配料表。')
      }
      const result = source === 'camera'
        ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.82 })
        : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.82, allowsMultipleSelection: true, selectionLimit: remaining })
      if (!result.canceled && result.assets.length) await uploadAssets(result.assets)
    } catch (error) {
      Alert.alert('选择图片失败', userFacingErrorMessage(error, '暂时无法选择图片，请稍后重试。'))
    }
  }

  const validate = () => {
    const next: FormErrors = {}
    if (!form.productName.trim()) next.productName = '请填写商品名称'
    const netWeight = parseNumber(form.netWeightG)
    if (!Number.isFinite(netWeight) || netWeight <= 0) next.netWeightG = '请填写大于 0 的净含量'
    const basis = parseNumber(form.nutritionBasis)
    if (!Number.isFinite(basis) || basis <= 0) next.nutritionBasis = '营养口径必须大于 0'
    for (const key of ['servingWeightG', 'calories', 'protein', 'carbs', 'fat', 'fiber', 'sugar', 'sodiumMg'] as NumericFieldKey[]) {
      const value = form[key]
      const parsed = parseNumber(value)
      if (value.trim() && (!Number.isFinite(parsed) || parsed < 0)) next[key] = '请输入 0 或正数'
    }
    if (!mergedImages.some((image) => image.url)) next.evidence = '请至少保留或补充 1 张证据图'
    if (reasonType === 'other' && !comment.trim()) next.comment = '选择“其他问题”时请补充说明'
    return next
  }

  const submit = async () => {
    if (submitting) return
    if (uploading) return Alert.alert('图片正在上传', '图片上传完成后才能提交纠错提案。')
    const next = validate()
    setErrors(next)
    if (Object.keys(next).length) {
      if (next.productName) productNameRef.current?.focus()
      else if (next.netWeightG) netWeightRef.current?.focus()
      return
    }
    Keyboard.dismiss()
    const basis = positiveNumber(form.nutritionBasis)
    const sourceImageUrls = mergedImages.map((image) => image.url).filter(Boolean)
    setSubmitting(true)
    try {
      const result = await apiClient.submitPackagedFoodCorrection({
        packagedFoodId,
        reasonType,
        comment: comment.trim() || undefined,
        brand: form.brand.trim() || undefined,
        productName: form.productName.trim(),
        displayName: form.productName.trim(),
        specText: form.specText.trim() || undefined,
        barcode: form.barcode.trim() || undefined,
        flavorText: form.flavorText.trim() || undefined,
        packageCategory: form.packageCategory.trim() || undefined,
        ingredientsText: form.ingredientsText.trim() || undefined,
        sourceImageUrls,
        nutritionBasisUnit: `${basis}g`,
        energyUnitRaw: form.energyUnit,
        conversionStatus: 'converted',
        reviewStatus: 'pending',
        netWeightG: numberOrZero(form.netWeightG),
        servingWeightG: numberOrZero(form.servingWeightG) || numberOrZero(form.netWeightG),
        kcalPer100g: ((form.energyUnit === 'kj' ? numberOrZero(form.calories) / KJ_PER_KCAL : numberOrZero(form.calories)) * 100) / basis,
        proteinPer100g: numberOrZero(form.protein) * 100 / basis,
        carbsPer100g: numberOrZero(form.carbs) * 100 / basis,
        fatPer100g: numberOrZero(form.fat) * 100 / basis,
        fiberPer100g: numberOrZero(form.fiber) * 100 / basis,
        sugarPer100g: numberOrZero(form.sugar) * 100 / basis,
        sodiumMgPer100g: numberOrZero(form.sodiumMg) * 100 / basis,
        ingestMethod: 'user_correction_submission',
        rawLabelPayload: { nutrition_basis: { type: 'per_weight', value: basis, unit: 'g' }, entry_source: 'packaged_food_correction' },
      })
      Alert.alert('纠错提案已提交', result.message || '后台审核通过后才会更新正式包装食品库。', [
        { text: '返回任务', onPress: () => navigation.goBack() },
      ])
    } catch (error) {
      Alert.alert('提交失败', userFacingErrorMessage(error, '暂时无法提交，请检查填写内容和网络后重试。'))
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return <View style={[styles.center, { backgroundColor: palette.page }]}><ActivityIndicator size="large" color={palette.brand} /></View>
  }

  if (loadError || !item) {
    return (
      <View style={[styles.center, styles.errorPage, { backgroundColor: palette.page }]}>
        <AlertTriangle size={34} color={palette.warning} />
        <Text accessibilityRole="alert" style={[styles.errorTitle, { color: palette.text }]}>无法打开纠错页面</Text>
        <Text style={[styles.errorDescription, { color: palette.secondary }]}>{loadError || '没有找到这条包装食品。'}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="重新加载包装食品"
          onPress={() => void load()}
          style={({ pressed }) => [styles.retryButton, { borderColor: palette.brand }, pressed && styles.pressed]}
        >
          <RefreshCw size={20} color={palette.brand} />
          <Text style={[styles.retryText, { color: palette.brand }]}>重试</Text>
        </Pressable>
      </View>
    )
  }

  return (
    <KeyboardAvoidingView
      style={[styles.screen, { backgroundColor: palette.page }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 88 : 0}
    >
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.content, { paddingBottom: 116 + Math.max(insets.bottom, 12) }]}
        keyboardShouldPersistTaps="handled"
        contentInsetAdjustmentBehavior="automatic"
      >
        <View style={[styles.hero, { backgroundColor: palette.brandSoft, borderColor: palette.border }]}>
          <View style={[styles.heroIcon, { backgroundColor: palette.card }]}><PackageCheck size={26} color={palette.brand} /></View>
          <View style={styles.flex}>
            <Text style={[styles.heroTitle, { color: palette.text }]}>包装食品库纠错共建</Text>
            <Text style={[styles.description, { color: palette.secondary }]}>请按包装实物修正信息，并补充图片证据。审核通过后才会更新正式包装食品库。</Text>
          </View>
          <View style={[styles.currentItem, { backgroundColor: palette.card, borderColor: palette.border }]}>
            <Text style={[styles.currentTitle, { color: palette.text }]}>{item.product_name || '当前商品'}</Text>
            <Text style={[styles.currentDescription, { color: palette.secondary }]}>当前库内：{item.brand || '未填品牌'} / {item.spec_text || `${formatNumber(item.net_weight_g) || '--'}g`}</Text>
          </View>
        </View>

        <Section title="问题类型" palette={palette}>
          <View style={styles.chipRow}>
            {reasonOptions.map((option) => {
              const selected = reasonType === option.value
              return (
                <Pressable
                  key={option.value}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  accessibilityLabel={option.label}
                  onPress={() => {
                    setReasonType(option.value)
                    setErrors((current) => ({ ...current, comment: undefined }))
                  }}
                  style={({ pressed }) => [styles.chip, { backgroundColor: selected ? palette.brand : palette.soft, borderColor: selected ? palette.brand : palette.border }, pressed && styles.pressed]}
                >
                  <Text style={[styles.chipText, { color: selected ? '#ffffff' : palette.text }]}>{option.label}</Text>
                </Pressable>
              )
            })}
          </View>
          <Label text={reasonType === 'other' ? '问题说明 *' : '问题说明'} color={palette.text} />
          <TextInput
            value={comment}
            onChangeText={(value) => {
              setComment(value)
              setErrors((current) => ({ ...current, comment: undefined }))
            }}
            onBlur={() => {
              if (reasonType === 'other' && !comment.trim()) setErrors((current) => ({ ...current, comment: '选择“其他问题”时请补充说明' }))
            }}
            placeholder="补充说明你改了什么，证据来自哪张包装图。"
            placeholderTextColor={palette.muted}
            maxLength={300}
            multiline
            textAlignVertical="top"
            style={[styles.textarea, { backgroundColor: palette.input, borderColor: errors.comment ? palette.dangerBorder : palette.border, color: palette.text }]}
          />
          <ErrorText message={errors.comment} color={palette.danger} />
        </Section>

        <Section
          title={`证据图片（${mergedImages.length}/${MAX_IMAGES}）`}
          description="默认带上当前商品原始入库图片；可补拍包装正面、营养表或配料表。"
          palette={palette}
        >
          <View style={styles.imageGrid}>
            {mergedImages.map((image, index) => (
              <View key={image.key} style={[styles.imageWrap, { backgroundColor: palette.soft, borderColor: palette.border }]}>
                <Image source={{ uri: image.uri }} style={styles.image} accessibilityLabel={`${image.removable ? '补充' : '原始'}证据图片 ${index + 1}`} />
                {image.uploading ? <View style={[styles.imageScrim, { backgroundColor: palette.scrim }]}><ActivityIndicator color="#ffffff" /></View> : null}
                {image.removable ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`移除第 ${index + 1} 张补充证据图片`}
                    onPress={() => setEvidenceImages((current) => current.filter((entry) => entry.id !== image.key))}
                    style={({ pressed }) => [styles.removeImage, { backgroundColor: palette.scrim }, pressed && styles.pressed]}
                  ><X size={18} color="#ffffff" /></Pressable>
                ) : (
                  <View style={[styles.originalBadge, { backgroundColor: palette.scrim }]}><Text style={styles.originalBadgeText}>原图</Text></View>
                )}
              </View>
            ))}
            {mergedImages.length < MAX_IMAGES ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="添加包装纠错证据图片"
                accessibilityHint="可以拍照或从相册选择"
                accessibilityState={{ disabled: uploading || submitting, busy: uploading }}
                disabled={uploading || submitting}
                onPress={() => setSourcePickerVisible(true)}
                style={({ pressed }) => [styles.addImage, { backgroundColor: palette.brandSoft, borderColor: palette.brand }, pressed && styles.pressed]}
              >
                {uploading ? <ActivityIndicator color={palette.brand} /> : <><ImagePlus size={27} color={palette.brand} /><Text style={[styles.addImageText, { color: palette.brand }]}>添加图片</Text></>}
              </Pressable>
            ) : null}
          </View>
          <ErrorText message={errors.evidence} color={palette.danger} />
        </Section>

        <Section title="修正后的商品信息" description="带 * 的字段为必填，内容应与证据图保持一致。" palette={palette}>
          <Field label="品牌" value={form.brand} onChangeText={(value) => updateField('brand', value)} placeholder="例如：乐事" palette={palette} />
          <Field
            inputRef={productNameRef}
            label="商品名称 *"
            value={form.productName}
            onChangeText={(value) => updateField('productName', value)}
            onBlur={() => setErrors((current) => ({ ...current, productName: form.productName.trim() ? undefined : '请填写商品名称' }))}
            placeholder="例如：原切薯片黄瓜味"
            error={errors.productName}
            palette={palette}
          />
          <View style={styles.fieldGrid}>
            <Field compact label="规格" value={form.specText} onChangeText={(value) => updateField('specText', value)} placeholder="例如：70g" palette={palette} />
            <Field compact label="条码" value={form.barcode} onChangeText={(value) => updateField('barcode', value)} placeholder="商品条码" keyboardType="number-pad" palette={palette} />
          </View>
          <View style={styles.fieldGrid}>
            <Field compact label="口味" value={form.flavorText} onChangeText={(value) => updateField('flavorText', value)} placeholder="例如：黄瓜味" palette={palette} />
            <Field compact label="分类" value={form.packageCategory} onChangeText={(value) => updateField('packageCategory', value)} placeholder="例如：薯片" palette={palette} />
          </View>
          <Label text="配料说明" color={palette.text} />
          <TextInput
            value={form.ingredientsText}
            onChangeText={(value) => updateField('ingredientsText', value)}
            placeholder="可选，补充关键配料信息"
            placeholderTextColor={palette.muted}
            maxLength={400}
            multiline
            textAlignVertical="top"
            style={[styles.textarea, styles.smallTextarea, { backgroundColor: palette.input, borderColor: palette.border, color: palette.text }]}
          />
        </Section>

        <Section title="营养数据" description="营养值按包装标签的口径填写，提交时会统一换算为每 100g。" palette={palette}>
          <View style={styles.fieldGrid}>
            <Field
              compact
              inputRef={netWeightRef}
              label="净含量(g) *"
              value={form.netWeightG}
              onChangeText={(value) => updateField('netWeightG', value)}
              onBlur={() => validateNumericField('netWeightG')}
              placeholder="例如：70"
              keyboardType="decimal-pad"
              error={errors.netWeightG}
              palette={palette}
            />
            <Field
              compact
              label="每份重量(g)"
              value={form.servingWeightG}
              onChangeText={(value) => updateField('servingWeightG', value)}
              onBlur={() => validateNumericField('servingWeightG')}
              placeholder="例如：35"
              keyboardType="decimal-pad"
              error={errors.servingWeightG}
              palette={palette}
            />
          </View>
          <View style={styles.fieldGrid}>
            <Field
              compact
              label="营养口径(g) *"
              value={form.nutritionBasis}
              onChangeText={(value) => updateField('nutritionBasis', value)}
              onBlur={() => validateNumericField('nutritionBasis')}
              placeholder="一般填 100"
              keyboardType="decimal-pad"
              error={errors.nutritionBasis}
              palette={palette}
            />
            <View style={styles.compactField}>
              <Label text="能量单位" color={palette.text} />
              <View style={styles.unitRow}>
                {(['kcal', 'kj'] as EnergyUnit[]).map((unit) => {
                  const selected = form.energyUnit === unit
                  return (
                    <Pressable
                      key={unit}
                      accessibilityRole="radio"
                      accessibilityState={{ selected }}
                      accessibilityLabel={unit === 'kj' ? '千焦' : '千卡'}
                      onPress={() => updateField('energyUnit', unit)}
                      style={({ pressed }) => [styles.unitChip, { backgroundColor: selected ? palette.brand : palette.soft, borderColor: selected ? palette.brand : palette.border }, pressed && styles.pressed]}
                    ><Text style={[styles.unitText, { color: selected ? '#ffffff' : palette.text }]}>{unit === 'kj' ? 'kJ' : 'kcal'}</Text></Pressable>
                  )
                })}
              </View>
            </View>
          </View>
          <View style={styles.fieldGrid}>
            {nutrientFields.map((field) => (
              <Field
                key={field.key}
                compact
                label={`${field.label}${field.unit ? `(${field.unit})` : ''}`}
                value={form[field.key]}
                onChangeText={(value) => updateField(field.key, value)}
                onBlur={() => validateNumericField(field.key)}
                placeholder={field.placeholder}
                keyboardType="decimal-pad"
                error={errors[field.key]}
                palette={palette}
              />
            ))}
          </View>
          <View style={[styles.infoNote, { backgroundColor: palette.warningSoft }]}>
            <Info size={19} color={palette.warning} />
            <Text style={[styles.infoText, { color: palette.secondary }]}>如标签写“每份 35g”，营养口径填写 35；如果直接标每 100g，就填写 100。</Text>
          </View>
        </Section>
      </ScrollView>

      <View style={[styles.footer, { backgroundColor: palette.card, borderColor: palette.border, paddingBottom: Math.max(insets.bottom, 12) }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="提交包装食品纠错提案"
          accessibilityState={{ disabled: submitting || uploading, busy: submitting }}
          disabled={submitting || uploading}
          onPress={() => void submit()}
          style={({ pressed }) => [styles.submit, { backgroundColor: pressed ? palette.brandPressed : palette.brand }, (submitting || uploading) && styles.disabled]}
        >
          {submitting ? <ActivityIndicator color="#ffffff" /> : <Text style={styles.submitText}>{uploading ? '图片上传完成后可提交' : '提交纠错提案'}</Text>}
        </Pressable>
      </View>

      <Modal transparent animationType="fade" visible={sourcePickerVisible} onRequestClose={() => setSourcePickerVisible(false)}>
        <View style={styles.sheetBackdrop}>
          <Pressable accessibilityRole="button" accessibilityLabel="取消选择图片来源" style={styles.sheetDismiss} onPress={() => setSourcePickerVisible(false)} />
          <View accessibilityViewIsModal style={[styles.sheet, { backgroundColor: palette.card, borderColor: palette.border, paddingBottom: Math.max(insets.bottom, 16) }]}>
            <View style={styles.sheetHandle} />
            <Text style={[styles.sheetTitle, { color: palette.text }]}>添加证据图片</Text>
            <Text style={[styles.sheetDescription, { color: palette.secondary }]}>还可以添加 {MAX_IMAGES - mergedImages.length} 张，建议优先拍包装正面、营养表和配料表。</Text>
            <SheetAction
              icon={<Camera size={23} color={palette.brand} />}
              title="拍照"
              hint="使用相机拍摄当前包装"
              background={palette.brandSoft}
              palette={palette}
              onPress={() => { setSourcePickerVisible(false); void pickEvidence('camera') }}
            />
            <SheetAction
              icon={<Images size={23} color={palette.brand} />}
              title="从相册选择"
              hint="一次最多选择剩余张数"
              background={palette.soft}
              palette={palette}
              onPress={() => { setSourcePickerVisible(false); void pickEvidence('library') }}
            />
            <Pressable accessibilityRole="button" accessibilityLabel="取消" onPress={() => setSourcePickerVisible(false)} style={({ pressed }) => [styles.sheetCancel, { borderColor: palette.border }, pressed && styles.pressed]}>
              <Text style={[styles.sheetCancelText, { color: palette.secondary }]}>取消</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  )
}

function Section({ title, description, palette, children }: { title: string; description?: string; palette: ReturnType<typeof usePalette>; children: ReactNode }) {
  return (
    <View style={[styles.card, { backgroundColor: palette.card, borderColor: palette.border }]}>
      <Text style={[styles.sectionTitle, { color: palette.text }]}>{title}</Text>
      {description ? <Text style={[styles.sectionDescription, { color: palette.secondary }]}>{description}</Text> : null}
      {children}
    </View>
  )
}

function Label({ text, color }: { text: string; color: string }) {
  return <Text style={[styles.label, { color }]}>{text}</Text>
}

function ErrorText({ message, color }: { message?: string; color: string }) {
  return message ? <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={[styles.errorText, { color }]}>{message}</Text> : null
}

function Field({
  inputRef, label, value, onChangeText, onBlur, placeholder, keyboardType, error, compact, palette,
}: {
  inputRef?: RefObject<TextInput | null>
  label: string
  value: string
  onChangeText: (value: string) => void
  onBlur?: () => void
  placeholder?: string
  keyboardType?: 'default' | 'number-pad' | 'decimal-pad'
  error?: string
  compact?: boolean
  palette: ReturnType<typeof usePalette>
}) {
  return (
    <View style={compact ? styles.compactField : undefined}>
      <Label text={label} color={palette.text} />
      <TextInput
        ref={inputRef}
        value={value}
        onChangeText={onChangeText}
        onBlur={onBlur}
        placeholder={placeholder}
        placeholderTextColor={palette.muted}
        keyboardType={keyboardType}
        style={[styles.input, { backgroundColor: palette.input, borderColor: error ? palette.dangerBorder : palette.border, color: palette.text }]}
      />
      <ErrorText message={error} color={palette.danger} />
    </View>
  )
}

function SheetAction({ icon, title, hint, background, palette, onPress }: { icon: ReactNode; title: string; hint: string; background: string; palette: ReturnType<typeof usePalette>; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={title} onPress={onPress} style={({ pressed }) => [styles.sheetAction, { backgroundColor: background }, pressed && styles.pressed]}>
      {icon}
      <View style={styles.flex}>
        <Text style={[styles.sheetActionTitle, { color: palette.text }]}>{title}</Text>
        <Text style={[styles.sheetActionHint, { color: palette.secondary }]}>{hint}</Text>
      </View>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  scroll: { flex: 1 },
  content: { width: '100%', maxWidth: 760, alignSelf: 'center', paddingHorizontal: 16, paddingTop: 16, gap: 16 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  errorPage: { paddingHorizontal: 28 },
  errorTitle: { marginTop: 14, fontSize: 21, lineHeight: 28, fontWeight: '700', textAlign: 'center' },
  errorDescription: { marginTop: 8, fontSize: 16, lineHeight: 24, textAlign: 'center' },
  retryButton: { minWidth: 116, minHeight: 48, marginTop: 20, borderWidth: 1, borderRadius: 14, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  retryText: { fontSize: 16, fontWeight: '700' },
  flex: { flex: 1, minWidth: 0 },
  hero: { borderWidth: 1, borderRadius: 20, padding: 18, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start', gap: 14 },
  heroIcon: { width: 50, height: 50, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  heroTitle: { fontSize: 21, lineHeight: 28, fontWeight: '700' },
  description: { marginTop: 5, fontSize: 16, lineHeight: 24 },
  currentItem: { width: '100%', borderWidth: 1, borderRadius: 15, padding: 14 },
  currentTitle: { fontSize: 17, lineHeight: 24, fontWeight: '700' },
  currentDescription: { marginTop: 4, fontSize: 14, lineHeight: 21 },
  card: { borderWidth: 1, borderRadius: 20, padding: 18 },
  sectionTitle: { fontSize: 20, lineHeight: 27, fontWeight: '700' },
  sectionDescription: { marginTop: 5, marginBottom: 2, fontSize: 15, lineHeight: 22 },
  chipRow: { marginTop: 16, flexDirection: 'row', flexWrap: 'wrap', gap: 9 },
  chip: { minHeight: 48, borderWidth: 1, borderRadius: 999, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center' },
  chipText: { fontSize: 15, lineHeight: 21, fontWeight: '600' },
  label: { marginTop: 18, marginBottom: 8, fontSize: 16, lineHeight: 22, fontWeight: '600' },
  input: { minHeight: 52, borderWidth: 1, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 11, fontSize: 16 },
  textarea: { minHeight: 112, borderWidth: 1, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16, lineHeight: 23 },
  smallTextarea: { minHeight: 92 },
  errorText: { marginTop: 6, fontSize: 14, lineHeight: 20, fontWeight: '500' },
  fieldGrid: { marginHorizontal: -5, flexDirection: 'row', flexWrap: 'wrap' },
  compactField: { width: '50%', minWidth: 144, paddingHorizontal: 5 },
  imageGrid: { marginTop: 16, flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  imageWrap: { width: 104, height: 104, borderWidth: 1, borderRadius: 16, overflow: 'hidden' },
  image: { width: '100%', height: '100%' },
  imageScrim: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, alignItems: 'center', justifyContent: 'center' },
  removeImage: { position: 'absolute', top: 0, right: 0, width: 48, height: 48, borderBottomLeftRadius: 18, alignItems: 'center', justifyContent: 'center' },
  originalBadge: { position: 'absolute', left: 7, bottom: 7, minHeight: 26, borderRadius: 999, paddingHorizontal: 8, alignItems: 'center', justifyContent: 'center' },
  originalBadgeText: { color: '#ffffff', fontSize: 12, fontWeight: '700' },
  addImage: { width: 104, height: 104, borderWidth: 1.5, borderStyle: 'dashed', borderRadius: 16, alignItems: 'center', justifyContent: 'center', gap: 7 },
  addImageText: { fontSize: 14, fontWeight: '600' },
  unitRow: { minHeight: 52, flexDirection: 'row', gap: 8 },
  unitChip: { flex: 1, minHeight: 52, borderWidth: 1, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  unitText: { fontSize: 15, fontWeight: '700' },
  infoNote: { marginTop: 18, borderRadius: 14, padding: 13, flexDirection: 'row', alignItems: 'flex-start', gap: 9 },
  infoText: { flex: 1, fontSize: 14, lineHeight: 21 },
  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: 16, paddingTop: 10 },
  submit: { width: '100%', maxWidth: 728, alignSelf: 'center', minHeight: 52, borderRadius: 15, paddingHorizontal: 18, alignItems: 'center', justifyContent: 'center' },
  submitText: { color: '#ffffff', fontSize: 16, lineHeight: 22, fontWeight: '700' },
  disabled: { opacity: 0.55 },
  pressed: { opacity: 0.68 },
  sheetBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(3, 9, 7, 0.56)' },
  sheetDismiss: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
  sheet: { width: '100%', maxWidth: 760, alignSelf: 'center', borderWidth: 1, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 18, paddingTop: 10 },
  sheetHandle: { width: 42, height: 4, alignSelf: 'center', borderRadius: 2, backgroundColor: '#9ca3af', opacity: 0.72 },
  sheetTitle: { marginTop: 18, fontSize: 20, lineHeight: 27, fontWeight: '700' },
  sheetDescription: { marginTop: 6, marginBottom: 16, fontSize: 15, lineHeight: 22 },
  sheetAction: { minHeight: 72, borderRadius: 16, paddingHorizontal: 16, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 10 },
  sheetActionTitle: { fontSize: 16, lineHeight: 22, fontWeight: '700' },
  sheetActionHint: { marginTop: 2, fontSize: 14, lineHeight: 20 },
  sheetCancel: { minHeight: 52, borderWidth: 1, borderRadius: 15, alignItems: 'center', justifyContent: 'center', marginTop: 2 },
  sheetCancelText: { fontSize: 16, lineHeight: 22, fontWeight: '600' },
})
