import { useCallback, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Image,
  type ImageStyle,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import * as ImagePicker from 'expo-image-picker'
import { useFocusEffect } from '@react-navigation/native'
import type { NativeStackScreenProps } from '@react-navigation/native-stack'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { BookOpenText, Camera, CheckCircle2, Clock3, ImagePlus, Images, Info, Leaf, RefreshCw, X, XCircle } from 'lucide-react-native'
import type { FoodNutritionContribution, FoodNutritionContributionStatus } from '@food-link/core'
import { apiClient } from '../api'
import type { RootStackParamList } from '../navigation/types'
import { useColorScheme } from '../providers/ColorSchemeProvider'
import { AppAlert as Alert } from '../providers/DialogProvider'
import { userFacingErrorMessage } from '../utils/errors'

type Props = NativeStackScreenProps<RootStackParamList, 'StandardFoodContribution'>
type NutrientKey = 'kcal' | 'protein' | 'carbs' | 'fat'
type FormErrors = Partial<Record<'name' | NutrientKey | 'evidence', string>>
type EvidenceImage = { id: string; uri: string; remoteUrl?: string; uploading: boolean }

const MAX_IMAGES = 5
const nutrientFields: Array<{ key: NutrientKey; label: string; unit: string; placeholder: string }> = [
  { key: 'kcal', label: '热量/100g', unit: 'kcal', placeholder: '例如 144' },
  { key: 'protein', label: '蛋白质/100g', unit: 'g', placeholder: '例如 13.3' },
  { key: 'carbs', label: '碳水/100g', unit: 'g', placeholder: '例如 2.8' },
  { key: 'fat', label: '脂肪/100g', unit: 'g', placeholder: '例如 8.8' },
]

function usePalette() {
  const { isDark } = useColorScheme()
  return useMemo(() => ({
    page: isDark ? '#0f1513' : '#f5f8f6', card: isDark ? '#18211e' : '#ffffff',
    soft: isDark ? '#202b27' : '#f0f7f3', input: isDark ? '#111916' : '#f8faf9',
    text: isDark ? '#f2f7f4' : '#17211d', secondary: isDark ? '#bdc9c3' : '#5f6d66',
    muted: isDark ? '#94a39b' : '#7c8a83', border: isDark ? '#34433d' : '#dfe9e3',
    brand: '#059669', brandPressed: '#047857', brandSoft: isDark ? '#143b30' : '#e7f8f1',
    danger: isDark ? '#fca5a5' : '#c93744', dangerBorder: isDark ? '#6b3037' : '#efb8bd',
    pendingText: isDark ? '#f7c96b' : '#8b5b16', pendingBg: isDark ? '#3a2d14' : '#fff3d8',
    approvedText: isDark ? '#6ee7b7' : '#087c59', approvedBg: isDark ? '#173c30' : '#def8ed',
    rejectedText: isDark ? '#fca5a5' : '#b53c3c', rejectedBg: isDark ? '#48242a' : '#fde8e8',
    scrim: 'rgba(3, 9, 7, 0.58)',
  }), [isDark])
}

const numberValue = (value: string) => value.trim() ? Number(value.trim()) : Number.NaN
const evidenceId = (index: number) => `evidence-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 8)}`
const statusLabel = (status: FoodNutritionContributionStatus) => status === 'approved' ? '已通过' : status === 'rejected' ? '已驳回' : '待审核'
const formatNumber = (value: number) => Number.isFinite(value) ? String(Number(value.toFixed(2))) : '0'

export function StandardFoodContributionScreen({ navigation, route }: Props) {
  const palette = usePalette()
  const insets = useSafeAreaInsets()
  const nameRef = useRef<TextInput>(null)
  const nutrientRefs = useRef<Record<NutrientKey, TextInput | null>>({ kcal: null, protein: null, carbs: null, fat: null })
  const requestRef = useRef(0)
  const [name, setName] = useState('')
  const [values, setValues] = useState<Record<NutrientKey, string>>({ kcal: '', protein: '', carbs: '', fat: '' })
  const [sourceText, setSourceText] = useState('')
  const [images, setImages] = useState<EvidenceImage[]>([])
  const [errors, setErrors] = useState<FormErrors>({})
  const [submitting, setSubmitting] = useState(false)
  const [sourcePickerVisible, setSourcePickerVisible] = useState(false)
  const [history, setHistory] = useState<FoodNutritionContribution[]>([])
  const [historyLoading, setHistoryLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [historyError, setHistoryError] = useState('')
  const uploading = images.some((image) => image.uploading)
  const remoteImages = images.map((image) => image.remoteUrl || '').filter(Boolean)

  const loadHistory = useCallback(async (refresh = false) => {
    const request = ++requestRef.current
    refresh ? setRefreshing(true) : setHistoryLoading(true)
    setHistoryError('')
    try {
      const items = await apiClient.listMyFoodNutritionContributions()
      if (request === requestRef.current) setHistory(items)
    } catch (error) {
      if (request === requestRef.current) setHistoryError(userFacingErrorMessage(error, '暂时无法读取贡献记录，请稍后重试。'))
    } finally {
      if (request === requestRef.current) { setHistoryLoading(false); setRefreshing(false) }
    }
  }, [])

  useFocusEffect(useCallback(() => {
    void loadHistory()
    return () => { requestRef.current += 1 }
  }, [loadHistory]))

  const setNutrient = (key: NutrientKey, value: string) => {
    setValues((current) => ({ ...current, [key]: value }))
    setErrors((current) => ({ ...current, [key]: undefined }))
  }

  const validateNutrient = (key: NutrientKey) => {
    const value = numberValue(values[key])
    const message = !Number.isFinite(value) ? '请填写有效数字' : key === 'kcal' && value <= 0 ? '热量必须大于 0' : key !== 'kcal' && value < 0 ? '请输入 0 或正数' : undefined
    setErrors((current) => ({ ...current, [key]: message }))
  }

  const uploadAssets = async (assets: ImagePicker.ImagePickerAsset[]) => {
    const selected = assets.slice(0, Math.max(0, MAX_IMAGES - images.length))
    if (!selected.length) return
    const pending = selected.map((asset, index) => ({ id: evidenceId(index), uri: asset.uri, uploading: true }))
    setImages((current) => [...current, ...pending].slice(0, MAX_IMAGES))
    setErrors((current) => ({ ...current, evidence: undefined }))
    let failed = 0
    for (let index = 0; index < selected.length; index += 1) {
      const asset = selected[index]
      const target = pending[index]
      try {
        const uploaded = await apiClient.uploadAnalyzeImageFile({
          fileUri: asset.uri,
          fileName: asset.fileName || `standard-food-${Date.now()}-${index + 1}.jpg`,
          mimeType: asset.mimeType || 'image/jpeg',
        })
        setImages((current) => current.map((image) => image.id === target.id ? { ...image, remoteUrl: uploaded.imageUrl, uploading: false } : image))
      } catch {
        failed += 1
        setImages((current) => current.filter((image) => image.id !== target.id))
      }
    }
    if (failed) Alert.alert(failed === selected.length ? '上传失败' : '部分图片上传失败', failed === selected.length ? '没有图片上传成功，请检查网络后重试。' : `有 ${failed} 张图片未上传成功，其余图片已经保留。`)
  }

  const pickEvidence = async (source: 'camera' | 'library') => {
    if (uploading || submitting) return
    const remaining = MAX_IMAGES - images.length
    if (remaining <= 0) return Alert.alert('图片已满', '证据图片最多上传 5 张。')
    try {
      if (source === 'camera') {
        const permission = await ImagePicker.requestCameraPermissionsAsync()
        if (!permission.granted) return Alert.alert('需要相机权限', '请允许使用相机拍摄营养来源、标签或检测报告。')
      }
      const result = source === 'camera'
        ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.82 })
        : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.82, allowsMultipleSelection: true, selectionLimit: remaining })
      if (!result.canceled && result.assets.length) await uploadAssets(result.assets)
    } catch (error) {
      Alert.alert('选择图片失败', userFacingErrorMessage(error, '暂时无法选择图片，请稍后重试。'))
    }
  }

  const showEvidenceSource = () => {
    if (uploading || submitting) return
    setSourcePickerVisible(true)
  }

  const chooseEvidenceSource = (source: 'camera' | 'library') => {
    setSourcePickerVisible(false)
    void pickEvidence(source)
  }

  const validateForm = (): FormErrors => {
    const next: FormErrors = {}
    const trimmed = name.trim()
    if (!trimmed) next.name = '请填写食物名称'
    else if (Array.from(trimmed).length > 100) next.name = '食物名称不能超过 100 个字'
    nutrientFields.forEach(({ key }) => {
      const value = numberValue(values[key])
      if (!Number.isFinite(value)) next[key] = '请填写有效数字'
      else if (key === 'kcal' && value <= 0) next[key] = '热量必须大于 0'
      else if (key !== 'kcal' && value < 0) next[key] = '请输入 0 或正数'
    })
    if (!sourceText.trim() && !remoteImages.length) next.evidence = '来源说明和证据图片至少填写一项'
    return next
  }

  const focusFirstError = (next: FormErrors) => {
    if (next.name) return nameRef.current?.focus()
    const key = nutrientFields.find((field) => next[field.key])?.key
    if (key) nutrientRefs.current[key]?.focus()
  }

  const resetForm = () => {
    setName(''); setValues({ kcal: '', protein: '', carbs: '', fat: '' }); setSourceText(''); setImages([]); setErrors({})
  }

  const submit = async () => {
    if (submitting) return
    if (uploading) return Alert.alert('图片正在上传', '图片上传完成后才能提交审核。')
    const next = validateForm()
    setErrors(next)
    if (Object.keys(next).length) return focusFirstError(next)
    Keyboard.dismiss()
    setSubmitting(true)
    try {
      const item = await apiClient.createFoodNutritionContribution({
        canonical_name: name.trim(), kcal_per_100g: numberValue(values.kcal), protein_per_100g: numberValue(values.protein),
        carbs_per_100g: numberValue(values.carbs), fat_per_100g: numberValue(values.fat), source_text: sourceText.trim(), evidence_image_paths: remoteImages,
      })
      setHistory((current) => [item, ...current.filter((entry) => entry.id !== item.id)])
      resetForm()
      Alert.alert('已提交审核', '审核通过后会奖励 1 积分，可在下方查看审核状态。', route.params?.source === 'reward_center'
        ? [{ text: '继续贡献' }, { text: '返回奖励中心', onPress: () => navigation.goBack() }]
        : [{ text: '知道了' }])
    } catch (error) {
      Alert.alert('提交失败', userFacingErrorMessage(error, '暂时无法提交，请检查填写内容后重试。'))
    } finally { setSubmitting(false) }
  }

  return (
    <KeyboardAvoidingView style={[styles.screen, { backgroundColor: palette.page }]} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={Platform.OS === 'ios' ? 88 : 0}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.content, { paddingBottom: Math.max(insets.bottom, 20) + 28 }]}
        keyboardShouldPersistTaps="handled"
        contentInsetAdjustmentBehavior="automatic"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void loadHistory(true)} colors={[palette.brand]} tintColor={palette.brand} />}
      >
        <View style={[styles.intro, { backgroundColor: palette.brandSoft, borderColor: palette.border }]} accessibilityRole="summary">
          <View style={[styles.introIcon, { backgroundColor: palette.card }]}><BookOpenText size={24} color={palette.brand} /></View>
          <View style={styles.flex}>
            <Text style={[styles.introTitle, { color: palette.text }]}>填写每 100g 营养</Text>
            <Text style={[styles.description, { color: palette.secondary }]}>适合米饭、鸡蛋、蔬菜等通用食物。包装商品请使用“包装食品”上传。</Text>
          </View>
        </View>

        <View style={[styles.card, { backgroundColor: palette.card, borderColor: palette.border }]}>
          <Text style={[styles.title, { color: palette.text }]}>基础信息</Text>
          <Text style={[styles.description, { color: palette.secondary }]}>带 * 的字段为必填，营养值统一按每 100g 填写。</Text>
          <Label text="食物名称 *" color={palette.text} />
          <TextInput
            ref={nameRef} testID="standard-food-name" accessibilityLabel="食物名称，必填" value={name}
            onChangeText={(value) => { setName(value); setErrors((current) => ({ ...current, name: undefined })) }}
            onBlur={() => setErrors((current) => ({ ...current, name: !name.trim() ? '请填写食物名称' : undefined }))}
            placeholder="例如：熟鸡蛋" placeholderTextColor={palette.muted} maxLength={100} returnKeyType="next"
            onSubmitEditing={() => nutrientRefs.current.kcal?.focus()}
            style={[styles.input, { backgroundColor: palette.input, borderColor: errors.name ? palette.dangerBorder : palette.border, color: palette.text }]}
          />
          <ErrorText message={errors.name} color={palette.danger} />

          <View style={styles.nutrientGrid}>
            {nutrientFields.map((field) => (
              <View key={field.key} style={styles.nutrientField}>
                <Label text={`${field.label} *`} color={palette.text} />
                <View style={[styles.numericWrap, { backgroundColor: palette.input, borderColor: errors[field.key] ? palette.dangerBorder : palette.border }]}>
                  <TextInput
                    ref={(node) => { nutrientRefs.current[field.key] = node }} testID={`standard-food-${field.key}`}
                    accessibilityLabel={`${field.label}，必填`} value={values[field.key]} onChangeText={(value) => setNutrient(field.key, value)}
                    onBlur={() => validateNutrient(field.key)} placeholder={field.placeholder} placeholderTextColor={palette.muted}
                    keyboardType="decimal-pad" style={[styles.numericInput, { color: palette.text }]}
                  />
                  <Text style={[styles.unit, { color: palette.secondary }]}>{field.unit}</Text>
                </View>
                <ErrorText message={errors[field.key]} color={palette.danger} />
              </View>
            ))}
          </View>

          <Label text="来源说明" color={palette.text} />
          <TextInput
            testID="standard-food-source" accessibilityLabel="来源说明" accessibilityHint="来源说明和证据图片至少填写一项"
            value={sourceText} onChangeText={(value) => { setSourceText(value); setErrors((current) => ({ ...current, evidence: undefined })) }}
            onBlur={() => { if (!sourceText.trim() && !remoteImages.length) setErrors((current) => ({ ...current, evidence: '来源说明和证据图片至少填写一项' })) }}
            placeholder="例如：中国食物成分表、产品营养标签或检测报告" placeholderTextColor={palette.muted}
            maxLength={1000} multiline textAlignVertical="top"
            style={[styles.sourceInput, { backgroundColor: palette.input, borderColor: errors.evidence ? palette.dangerBorder : palette.border, color: palette.text }]}
          />

          <View style={styles.evidenceHeader}>
            <View><Label text={`证据图片（${images.length}/${MAX_IMAGES}）`} color={palette.text} /><Text style={[styles.helper, { color: palette.secondary }]}>来源说明和图片至少一项</Text></View>
            <Info size={18} color={palette.muted} />
          </View>
          <View style={styles.imageGrid}>
            {images.map((image, index) => (
              <View key={image.id} style={[styles.imageWrap, { borderColor: palette.border, backgroundColor: palette.soft }]}>
                <Image source={{ uri: image.uri }} style={styles.image as ImageStyle} accessibilityLabel={`第 ${index + 1} 张证据图片`} />
                {image.uploading ? <View style={[styles.imageScrim, { backgroundColor: palette.scrim }]}><ActivityIndicator color="#ffffff" /></View> : null}
                <Pressable
                  accessibilityRole="button" accessibilityLabel={`移除第 ${index + 1} 张证据图片`} disabled={submitting}
                  onPress={() => setImages((current) => current.filter((item) => item.id !== image.id))}
                  style={({ pressed }) => [styles.removeImage, { backgroundColor: palette.scrim }, pressed && styles.pressed]}
                ><X size={18} color="#ffffff" /></Pressable>
              </View>
            ))}
            {images.length < MAX_IMAGES ? (
              <Pressable
                testID="standard-food-add-evidence" accessibilityRole="button" accessibilityLabel="添加证据图片"
                accessibilityHint="可以拍照或从相册选择" accessibilityState={{ disabled: uploading || submitting, busy: uploading }}
                disabled={uploading || submitting} onPress={showEvidenceSource}
                style={({ pressed }) => [styles.addImage, { borderColor: palette.brand, backgroundColor: palette.brandSoft }, (pressed || uploading || submitting) && styles.pressed]}
              >
                {uploading ? <ActivityIndicator color={palette.brand} /> : <><ImagePlus size={26} color={palette.brand} /><Text style={[styles.addImageText, { color: palette.brand }]}>添加图片</Text></>}
              </Pressable>
            ) : null}
          </View>
          <ErrorText message={errors.evidence} color={palette.danger} />
          <Pressable
            testID="standard-food-submit" accessibilityRole="button" accessibilityLabel="提交标准食物审核"
            accessibilityHint="审核通过后奖励一积分" accessibilityState={{ disabled: submitting || uploading, busy: submitting }}
            disabled={submitting || uploading} onPress={() => void submit()}
            style={({ pressed }) => [styles.submit, { backgroundColor: pressed ? palette.brandPressed : palette.brand }, (submitting || uploading) && styles.disabled]}
          >
            {submitting ? <ActivityIndicator color="#ffffff" /> : <Text style={styles.submitText}>{uploading ? '图片上传完成后可提交' : '提交审核'}</Text>}
          </Pressable>
          <Text style={[styles.submitHint, { color: palette.muted }]}>审核通过后奖励 1 积分；重复或证据不足的内容可能被合并或驳回。</Text>
        </View>

        <View testID="standard-food-history" style={[styles.card, styles.historyCard, { backgroundColor: palette.card, borderColor: palette.border }]}>
          <View style={styles.historyHeader}>
            <View style={styles.flex}><Text style={[styles.title, { color: palette.text }]}>我的贡献</Text><Text style={[styles.description, { color: palette.secondary }]}>下拉页面可以刷新审核状态</Text></View>
            {!historyLoading ? <Pressable accessibilityRole="button" accessibilityLabel="刷新贡献记录" onPress={() => void loadHistory()} style={({ pressed }) => [styles.refresh, pressed && styles.pressed]}><RefreshCw size={21} color={palette.brand} /></Pressable> : null}
          </View>
          {historyLoading ? (
            <View style={styles.historyLoading}><ActivityIndicator color={palette.brand} /></View>
          ) : historyError ? (
            <View style={[styles.message, { backgroundColor: palette.soft }]}>
              <XCircle size={25} color={palette.danger} />
              <Text accessibilityRole="alert" style={[styles.messageText, { color: palette.secondary }]}>{historyError}</Text>
              <Pressable accessibilityRole="button" accessibilityLabel="重试加载贡献记录" onPress={() => void loadHistory()} style={({ pressed }) => [styles.retry, { borderColor: palette.brand }, pressed && styles.pressed]}><Text style={[styles.retryText, { color: palette.brand }]}>重试</Text></Pressable>
            </View>
          ) : history.length === 0 ? (
            <View style={[styles.message, { backgroundColor: palette.soft }]}><Leaf size={27} color={palette.brand} /><Text style={[styles.messageText, { color: palette.secondary }]}>还没有标准食物贡献</Text><Text style={[styles.messageHint, { color: palette.muted }]}>填写上方信息，提交你的第一条贡献</Text></View>
          ) : history.map((item, index) => <HistoryItem key={item.id} item={item} last={index === history.length - 1} palette={palette} />)}
        </View>
      </ScrollView>
      <Modal
        transparent
        animationType="fade"
        visible={sourcePickerVisible}
        onRequestClose={() => setSourcePickerVisible(false)}
      >
        <View style={styles.sourcePickerBackdrop}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="取消选择图片来源"
            style={styles.sourcePickerDismiss}
            onPress={() => setSourcePickerVisible(false)}
          />
          <View
            accessibilityViewIsModal
            style={[
              styles.sourcePickerSheet,
              {
                backgroundColor: palette.card,
                borderColor: palette.border,
                paddingBottom: Math.max(insets.bottom, 16),
              },
            ]}
          >
            <View style={styles.sourcePickerHandle} />
            <Text style={[styles.sourcePickerTitle, { color: palette.text }]}>添加证据图片</Text>
            <Text style={[styles.sourcePickerDescription, { color: palette.secondary }]}>还可以添加 {MAX_IMAGES - images.length} 张，选择营养标签、成分表或检测报告。</Text>
            <Pressable
              testID="standard-food-camera"
              accessibilityRole="button"
              accessibilityLabel="拍照添加证据图片"
              onPress={() => chooseEvidenceSource('camera')}
              style={({ pressed }) => [styles.sourcePickerAction, { backgroundColor: palette.brandSoft }, pressed && styles.pressed]}
            >
              <Camera size={23} color={palette.brand} />
              <View style={styles.flex}><Text style={[styles.sourcePickerActionTitle, { color: palette.text }]}>拍照</Text><Text style={[styles.sourcePickerActionHint, { color: palette.secondary }]}>使用相机拍摄来源材料</Text></View>
            </Pressable>
            <Pressable
              testID="standard-food-library"
              accessibilityRole="button"
              accessibilityLabel="从相册选择证据图片"
              onPress={() => chooseEvidenceSource('library')}
              style={({ pressed }) => [styles.sourcePickerAction, { backgroundColor: palette.soft }, pressed && styles.pressed]}
            >
              <Images size={23} color={palette.brand} />
              <View style={styles.flex}><Text style={[styles.sourcePickerActionTitle, { color: palette.text }]}>从相册选择</Text><Text style={[styles.sourcePickerActionHint, { color: palette.secondary }]}>一次最多选择剩余张数</Text></View>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="取消"
              onPress={() => setSourcePickerVisible(false)}
              style={({ pressed }) => [styles.sourcePickerCancel, { borderColor: palette.border }, pressed && styles.pressed]}
            >
              <Text style={[styles.sourcePickerCancelText, { color: palette.secondary }]}>取消</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  )
}

function Label({ text, color }: { text: string; color: string }) {
  return <Text style={[styles.label, { color }]}>{text}</Text>
}

function ErrorText({ message, color }: { message?: string; color: string }) {
  if (!message) return null
  return <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={[styles.error, { color }]}>{message}</Text>
}

function HistoryItem({ item, last, palette }: { item: FoodNutritionContribution; last: boolean; palette: ReturnType<typeof usePalette> }) {
  const pending = item.status === 'pending'
  const approved = item.status === 'approved'
  const color = pending ? palette.pendingText : approved ? palette.approvedText : palette.rejectedText
  const background = pending ? palette.pendingBg : approved ? palette.approvedBg : palette.rejectedBg
  const StatusIcon = pending ? Clock3 : approved ? CheckCircle2 : XCircle
  return (
    <View style={[styles.historyItem, !last && { borderBottomColor: palette.border, borderBottomWidth: StyleSheet.hairlineWidth }]} accessible accessibilityLabel={`${item.canonical_name}，${statusLabel(item.status)}，每100克 ${formatNumber(item.kcal_per_100g)} 千卡`}>
      <View style={styles.historyTop}>
        <View style={styles.flex}><Text style={[styles.historyName, { color: palette.text }]}>{item.canonical_name}</Text><Text style={[styles.historyNutrition, { color: palette.secondary }]}>{formatNumber(item.kcal_per_100g)} kcal · 蛋白质 {formatNumber(item.protein_per_100g)}g</Text></View>
        <View style={[styles.badge, { backgroundColor: background }]}><StatusIcon size={15} color={color} /><Text style={[styles.badgeText, { color }]}>{statusLabel(item.status)}</Text></View>
      </View>
      {item.review_note ? <View style={[styles.reviewNote, { backgroundColor: palette.soft }]}><Info size={17} color={palette.muted} /><Text style={[styles.reviewText, { color: palette.secondary }]}>{item.review_note}</Text></View> : null}
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  scroll: { flex: 1 },
  content: { width: '100%', maxWidth: 760, alignSelf: 'center', paddingHorizontal: 16, paddingTop: 16, gap: 16 },
  flex: { flex: 1, minWidth: 0 },
  intro: { borderWidth: 1, borderRadius: 20, padding: 18, flexDirection: 'row', alignItems: 'flex-start', gap: 14 },
  introIcon: { width: 48, height: 48, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  introTitle: { fontSize: 20, lineHeight: 27, fontWeight: '700' },
  title: { fontSize: 20, lineHeight: 27, fontWeight: '700' },
  description: { marginTop: 5, fontSize: 16, lineHeight: 24 },
  card: { borderWidth: 1, borderRadius: 20, padding: 18 },
  label: { marginTop: 20, marginBottom: 8, fontSize: 16, lineHeight: 22, fontWeight: '600' },
  input: { minHeight: 52, borderWidth: 1, borderRadius: 14, paddingHorizontal: 15, paddingVertical: 12, fontSize: 16 },
  nutrientGrid: { marginHorizontal: -5, flexDirection: 'row', flexWrap: 'wrap' },
  nutrientField: { width: '50%', minWidth: 144, paddingHorizontal: 5 },
  numericWrap: { minHeight: 52, borderWidth: 1, borderRadius: 14, paddingLeft: 14, paddingRight: 12, flexDirection: 'row', alignItems: 'center' },
  numericInput: { flex: 1, minWidth: 0, paddingVertical: 11, fontSize: 16 },
  unit: { marginLeft: 6, fontSize: 14, fontWeight: '600' },
  sourceInput: { minHeight: 116, borderWidth: 1, borderRadius: 14, paddingHorizontal: 15, paddingVertical: 13, fontSize: 16, lineHeight: 23 },
  error: { marginTop: 6, fontSize: 14, lineHeight: 20, fontWeight: '500' },
  evidenceHeader: { marginTop: 2, flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12 },
  helper: { marginTop: -4, fontSize: 14, lineHeight: 20 },
  imageGrid: { marginTop: 12, flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  imageWrap: { width: 104, height: 104, borderWidth: 1, borderRadius: 16, overflow: 'hidden' },
  image: { width: '100%', height: '100%' },
  imageScrim: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, alignItems: 'center', justifyContent: 'center' },
  removeImage: { position: 'absolute', top: 0, right: 0, width: 48, height: 48, borderBottomLeftRadius: 18, alignItems: 'center', justifyContent: 'center' },
  addImage: { width: 104, height: 104, borderWidth: 1.5, borderStyle: 'dashed', borderRadius: 16, alignItems: 'center', justifyContent: 'center', gap: 7 },
  addImageText: { fontSize: 14, fontWeight: '600' },
  submit: { minHeight: 52, marginTop: 24, borderRadius: 15, paddingHorizontal: 18, paddingVertical: 13, alignItems: 'center', justifyContent: 'center' },
  disabled: { opacity: 0.55 },
  submitText: { color: '#ffffff', fontSize: 16, lineHeight: 22, fontWeight: '700', textAlign: 'center' },
  submitHint: { marginTop: 9, fontSize: 14, lineHeight: 21, textAlign: 'center' },
  historyCard: { minHeight: 176 },
  historyHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 },
  refresh: { width: 48, height: 48, marginTop: -9, marginRight: -10, alignItems: 'center', justifyContent: 'center' },
  historyLoading: { minHeight: 112, alignItems: 'center', justifyContent: 'center' },
  message: { minHeight: 132, marginTop: 16, borderRadius: 16, padding: 18, alignItems: 'center', justifyContent: 'center' },
  messageText: { marginTop: 10, fontSize: 16, lineHeight: 23, textAlign: 'center' },
  messageHint: { marginTop: 3, fontSize: 14, lineHeight: 20, textAlign: 'center' },
  retry: { minWidth: 96, minHeight: 48, marginTop: 14, borderWidth: 1, borderRadius: 14, paddingHorizontal: 20, alignItems: 'center', justifyContent: 'center' },
  retryText: { fontSize: 15, fontWeight: '700' },
  historyItem: { paddingVertical: 16 },
  historyTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  historyName: { fontSize: 17, lineHeight: 24, fontWeight: '600' },
  historyNutrition: { marginTop: 4, fontSize: 14, lineHeight: 20 },
  badge: { minHeight: 32, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6, flexDirection: 'row', alignItems: 'center', gap: 5 },
  badgeText: { fontSize: 13, lineHeight: 18, fontWeight: '700' },
  reviewNote: { marginTop: 11, borderRadius: 12, padding: 11, flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  reviewText: { flex: 1, fontSize: 14, lineHeight: 20 },
  sourcePickerBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(3, 9, 7, 0.56)' },
  sourcePickerDismiss: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
  sourcePickerSheet: { width: '100%', maxWidth: 760, alignSelf: 'center', borderWidth: 1, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 18, paddingTop: 10 },
  sourcePickerHandle: { width: 42, height: 4, alignSelf: 'center', borderRadius: 2, backgroundColor: '#9ca3af', opacity: 0.72 },
  sourcePickerTitle: { marginTop: 18, fontSize: 20, lineHeight: 27, fontWeight: '700' },
  sourcePickerDescription: { marginTop: 6, marginBottom: 16, fontSize: 15, lineHeight: 22 },
  sourcePickerAction: { minHeight: 72, borderRadius: 16, paddingHorizontal: 16, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 10 },
  sourcePickerActionTitle: { fontSize: 16, lineHeight: 22, fontWeight: '700' },
  sourcePickerActionHint: { marginTop: 2, fontSize: 14, lineHeight: 20 },
  sourcePickerCancel: { minHeight: 52, borderWidth: 1, borderRadius: 15, alignItems: 'center', justifyContent: 'center', marginTop: 2 },
  sourcePickerCancelText: { fontSize: 16, lineHeight: 22, fontWeight: '600' },
  pressed: { opacity: 0.68 },
})
