import { useEffect, useMemo, useState } from 'react'
import { Image, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import * as ImagePicker from 'expo-image-picker'
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import {
  getMealTypeLabel,
  inferDefaultMealTypeFromLocalTime,
  type ActivityTiming,
  type ExecutionMode,
  type MealType,
} from '@food-link/core'
import { Camera, Check, FileText, Image as ImageIcon, RotateCcw, Sparkles, Utensils, Wifi, type LucideIcon } from 'lucide-react-native'
import { apiClient } from '../api'
import { AppButton } from '../components/AppButton'
import { Card } from '../components/Card'
import { Page } from '../components/Page'
import { SHOW_DEBUG_LOGIN } from '../config'
import type { RootStackParamList } from '../navigation/types'
import { useAppDialog } from '../providers/DialogProvider'
import { colors } from '../theme'
import { todayKey } from '../utils/date'
import { createDemoAnalysisTask, createDemoTextAnalysisTask, demoFoodImageUrl } from '../utils/demoAnalysisTask'
import { userFacingErrorMessage } from '../utils/errors'

type AnalyzeRoute = RouteProp<RootStackParamList, 'Analyze'>
type AnalyzeBaseMode = 'fast' | 'standard' | 'strict'
type AnalyzeImageAsset = ImagePicker.ImagePickerAsset

const MAX_ANALYZE_IMAGES = 3

const MODE_OPTIONS: Array<{ value: AnalyzeBaseMode; label: string; desc: string }> = [
  { value: 'fast', label: '快速', desc: '更快出结果' },
  { value: 'standard', label: '普通', desc: '日常推荐' },
  { value: 'strict', label: '精准', desc: '更细估重' },
]

const MEAL_OPTIONS: Array<{ value: MealType; label: string }> = [
  { value: 'breakfast', label: '早餐' },
  { value: 'morning_snack', label: '早加餐' },
  { value: 'lunch', label: '午餐' },
  { value: 'afternoon_snack', label: '午加餐' },
  { value: 'dinner', label: '晚餐' },
  { value: 'evening_snack', label: '晚加餐' },
]

const ACTIVITY_TIMING_OPTIONS: Array<{ value: ActivityTiming; label: string }> = [
  { value: 'post_workout', label: '练后' },
  { value: 'daily', label: '日常' },
  { value: 'before_sleep', label: '睡前' },
  { value: 'none', label: '无' },
]

const resolveExecutionModeFromOptions = (
  baseMode: AnalyzeBaseMode,
  webSearchEnabled: boolean,
  separateFoodEstimateEnabled: boolean,
): ExecutionMode => {
  if (baseMode === 'fast') return webSearchEnabled ? 'fast_web_search' : 'fast'
  if (baseMode === 'standard') return webSearchEnabled ? 'standard_web_search' : 'standard'
  if (webSearchEnabled) return 'strict_web_search'
  if (separateFoodEstimateEnabled) return 'strict_separate'
  return 'strict'
}

export function AnalyzeScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  const route = useRoute<AnalyzeRoute>()
  const dialog = useAppDialog()
  const [loading, setLoading] = useState(false)
  const [imageAssets, setImageAssets] = useState<AnalyzeImageAsset[]>([])
  const [mealType, setMealType] = useState<MealType>(route.params?.mealType || inferDefaultMealTypeFromLocalTime())
  const [date, setDate] = useState(route.params?.date || todayKey())
  const [baseMode, setBaseMode] = useState<AnalyzeBaseMode>('standard')
  const [webSearchEnabled, setWebSearchEnabled] = useState(false)
  const [separateFoodEstimateEnabled, setSeparateFoodEstimateEnabled] = useState(false)
  const [multiViewEnabled, setMultiViewEnabled] = useState(false)
  const [suggestRatioEnabled, setSuggestRatioEnabled] = useState(true)
  const [activityTiming, setActivityTiming] = useState<ActivityTiming>('none')
  const [additionalContext, setAdditionalContext] = useState('')
  const executionMode = useMemo(
    () => resolveExecutionModeFromOptions(baseMode, webSearchEnabled, separateFoodEstimateEnabled),
    [baseMode, webSearchEnabled, separateFoodEstimateEnabled],
  )

  useEffect(() => {
    if (route.params?.source) {
      void pickImages(route.params.source)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (baseMode !== 'strict' && separateFoodEstimateEnabled) {
      setSeparateFoodEstimateEnabled(false)
    }
  }, [baseMode, separateFoodEstimateEnabled])

  const pickImages = async (source: 'camera' | 'library') => {
    const permission = source === 'camera'
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (!permission.granted) {
      await dialog.alert(source === 'camera' ? '需要相机权限' : '需要相册权限', '请选择食物图片用于分析。', 'warning')
      return
    }

    const picked = source === 'camera'
      ? await ImagePicker.launchCameraAsync({ allowsEditing: false, quality: 0.85 })
      : await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ['images'],
          allowsEditing: false,
          allowsMultipleSelection: true,
          selectionLimit: MAX_ANALYZE_IMAGES,
          quality: 0.85,
        })
    if (picked.canceled || !picked.assets[0]) return

    const nextAssets = picked.assets.slice(0, MAX_ANALYZE_IMAGES)
    setImageAssets((current) => [...current, ...nextAssets].slice(0, MAX_ANALYZE_IMAGES))
  }

  const removeImage = (uri: string) => {
    setImageAssets((current) => current.filter((asset) => asset.uri !== uri))
  }

  const submitAnalyze = async () => {
    if (imageAssets.length === 0) {
      await dialog.alert('请先选择图片', '可以拍照或从相册选择，最多支持 3 张图片一起识别。', 'warning')
      return
    }
    setLoading(true)
    try {
      const uploadedUrls: string[] = []
      for (let index = 0; index < imageAssets.length; index += 1) {
        const asset = imageAssets[index]
        const uploaded = await apiClient.uploadAnalyzeImageFile({
          fileUri: asset.uri,
          fileName: asset.fileName || `food-${index + 1}.jpg`,
          mimeType: asset.mimeType || 'image/jpeg',
        })
        uploadedUrls.push(uploaded.imageUrl)
      }
      const submitted = await apiClient.submitAnalyzeTask({
        image_url: uploadedUrls[0],
        image_urls: uploadedUrls,
        meal_type: mealType,
        date,
        timezone_offset_minutes: new Date().getTimezoneOffset(),
        diet_goal: 'none',
        activity_timing: activityTiming,
        additionalContext: additionalContext.trim() || undefined,
        is_multi_view: multiViewEnabled,
        suggest_ratio_enabled: suggestRatioEnabled,
        execution_mode: executionMode,
        analysis_engine: 'db_first',
      })
      navigation.replace('AnalyzeLoading', {
        taskId: submitted.task_id,
        imageUri: imageAssets[0]?.uri,
        imageUris: imageAssets.map((asset) => asset.uri),
        mealType,
        date,
        taskType: 'food',
        executionMode,
      })
    } catch (error) {
      await dialog.alert('分析失败', userFacingErrorMessage(error), 'danger')
    } finally {
      setLoading(false)
    }
  }

  const openDemoResult = () => {
    navigation.navigate('Result', {
      task: createDemoAnalysisTask(),
      imageUri: demoFoodImageUrl,
      mealType,
      date,
    })
  }

  const openDemoTextResult = () => {
    navigation.navigate('TextResult', {
      task: createDemoTextAnalysisTask(),
      mealType,
      date,
    })
  }

  return (
    <Page title="记录" subtitle={`${date} · ${getMealTypeLabel(mealType)}`}>
      <Card>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>记录餐食</Text>
          <Text style={styles.badge}>AI 分析</Text>
        </View>
        <Text style={styles.subtitle}>先选择图片，再按需要调整识别模式和补充信息。后台会继续分析，离开页面也不会取消任务。</Text>
        {imageAssets.length > 0 ? (
          <View style={styles.previewGrid}>
            {imageAssets.map((asset, index) => (
              <View key={`${asset.uri}-${index}`} style={styles.previewTile}>
                <Image source={{ uri: asset.uri }} style={styles.previewImage} />
                <Pressable style={styles.removeImageButton} onPress={() => removeImage(asset.uri)}>
                  <Text style={styles.removeImageText}>×</Text>
                </Pressable>
              </View>
            ))}
          </View>
        ) : (
          <Pressable style={styles.emptyPreview} onPress={() => pickImages('library')}>
            <ImageIcon size={26} color={colors.textMuted} />
            <Text style={styles.emptyPreviewTitle}>还没有选择图片</Text>
            <Text style={styles.emptyPreviewText}>相册最多支持 {MAX_ANALYZE_IMAGES} 张，多张会作为一次识别提交。</Text>
          </Pressable>
        )}
        <View style={styles.recordGrid}>
          <RecordGridAction
            title="拍照识别"
            desc="拍摄餐食后再确认设置"
            icon={Camera}
            tone="green"
            disabled={loading}
            onPress={() => pickImages('camera')}
          />
          <RecordGridAction
            title="相册上传"
            desc="选择已有食物图片"
            icon={ImageIcon}
            tone="blue"
            disabled={loading}
            onPress={() => pickImages('library')}
          />
          <RecordGridAction
            title="文本输入"
            desc="一句话描述吃了什么"
            icon={FileText}
            tone="gold"
            onPress={() => navigation.navigate('TextRecord')}
          />
          <RecordGridAction
            title="食物库输入"
            desc="按食物和重量精确录入"
            icon={Utensils}
            tone="purple"
            onPress={() => navigation.navigate('ManualRecord')}
          />
        </View>
      </Card>

      <Card>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>识别设置</Text>
          <Text style={styles.modeBadge}>{executionModeLabel(executionMode)}</Text>
        </View>
        <View style={styles.segmentedRow}>
          {MODE_OPTIONS.map((option) => (
            <SegmentedButton
              key={option.value}
              title={option.label}
              desc={option.desc}
              active={baseMode === option.value}
              onPress={() => setBaseMode(option.value)}
            />
          ))}
        </View>
        <View style={styles.optionGrid}>
          <ToggleOption
            title="联网校准"
            desc="校准包装规格和品牌商品"
            icon={Wifi}
            enabled={webSearchEnabled}
            onPress={() => setWebSearchEnabled((value) => !value)}
          />
          <ToggleOption
            title="分项模式"
            desc="精准模式下分开估重"
            icon={Sparkles}
            enabled={separateFoodEstimateEnabled}
            disabled={baseMode !== 'strict'}
            onPress={() => setSeparateFoodEstimateEnabled((value) => !value)}
          />
          <ToggleOption
            title="多视角辅助"
            desc="多张图辅助判断份量"
            icon={RotateCcw}
            enabled={multiViewEnabled}
            onPress={() => setMultiViewEnabled((value) => !value)}
          />
          <ToggleOption
            title="AI 摄入比例"
            desc="自动建议可食比例"
            icon={Check}
            enabled={suggestRatioEnabled}
            onPress={() => setSuggestRatioEnabled((value) => !value)}
          />
        </View>
        <Text style={styles.fieldLabel}>餐次</Text>
        <ChipGroup options={MEAL_OPTIONS} value={mealType} onChange={setMealType} />
        <Text style={styles.fieldLabel}>运动时机</Text>
        <ChipGroup options={ACTIVITY_TIMING_OPTIONS} value={activityTiming} onChange={setActivityTiming} />
        <Text style={styles.fieldLabel}>文字补充</Text>
        <TextInput
          value={additionalContext}
          onChangeText={setAdditionalContext}
          placeholder="例：学校食堂大份，额外加了辣油，用的是 500ml 便当盒"
          placeholderTextColor={colors.textMuted}
          multiline
          maxLength={200}
          style={styles.textArea}
        />
        <Text style={styles.dateHint}>记录日期：{date}</Text>
        <TextInput
          value={date}
          onChangeText={setDate}
          placeholder="YYYY-MM-DD"
          placeholderTextColor={colors.textMuted}
          style={styles.dateInput}
        />
        <AppButton
          label={imageAssets.length > 0 ? `开始识别 ${imageAssets.length} 张图片` : '选择图片并识别'}
          loading={loading}
          onPress={() => (imageAssets.length > 0 ? void submitAnalyze() : void pickImages('library'))}
        />
        <Text style={styles.submitHint}>提交后会进入等待页；也可以先离开，稍后在识别记录查看。</Text>
      </Card>

      <Card>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>更多记录</Text>
        </View>
        <View style={styles.recordQuickList}>
          <RecordQuickAction title="我的收藏" desc="快速记录常吃餐食" onPress={() => navigation.navigate('Recipes')} />
          <RecordQuickAction title="识别记录" desc="查看以往识别结果" onPress={() => navigation.navigate('AnalyzeHistory')} />
          <RecordQuickAction title="包装食品" desc="上传营养成分表或商品包装" onPress={() => navigation.navigate('PackagedFoodEdit')} />
          <RecordQuickAction title="食物库" desc="浏览营养库与自定义食物" onPress={() => navigation.navigate('FoodLibrary')} />
        </View>
      </Card>

      {SHOW_DEBUG_LOGIN ? (
        <Card>
          <Text style={styles.sectionTitle}>示例结果预览</Text>
          <Text style={styles.subtitle}>打开一份示例识别结果，快速体验比例、人数分摊和保存前调整。</Text>
          <AppButton label="打开示例识别结果" variant="secondary" onPress={openDemoResult} />
          <View style={styles.demoButtonGap}>
            <AppButton label="打开示例文字结果" variant="secondary" onPress={openDemoTextResult} />
          </View>
        </Card>
      ) : null}
    </Page>
  )
}

function SegmentedButton({
  title,
  desc,
  active,
  onPress,
}: {
  title: string
  desc: string
  active: boolean
  onPress: () => void
}) {
  return (
    <Pressable style={({ pressed }) => [styles.segmentedItem, active && styles.segmentedItemActive, pressed && styles.pressed]} onPress={onPress}>
      <Text style={[styles.segmentedTitle, active && styles.segmentedTitleActive]} numberOfLines={1}>{title}</Text>
      <Text style={[styles.segmentedDesc, active && styles.segmentedDescActive]} numberOfLines={1}>{desc}</Text>
    </Pressable>
  )
}

function ToggleOption({
  title,
  desc,
  icon,
  enabled,
  disabled,
  onPress,
}: {
  title: string
  desc: string
  icon: LucideIcon
  enabled: boolean
  disabled?: boolean
  onPress: () => void
}) {
  const Icon = icon
  return (
    <Pressable
      disabled={disabled}
      style={({ pressed }) => [
        styles.toggleCard,
        enabled && styles.toggleCardActive,
        disabled && styles.disabled,
        pressed && styles.pressed,
      ]}
      onPress={onPress}
    >
      <View style={styles.toggleTopRow}>
        <Icon size={18} color={enabled ? colors.brandDark : colors.textSecondary} strokeWidth={2.4} />
        <View style={[styles.switchTrack, enabled && styles.switchTrackActive]}>
          <View style={[styles.switchKnob, enabled && styles.switchKnobActive]} />
        </View>
      </View>
      <Text style={styles.toggleTitle}>{title}</Text>
      <Text style={styles.toggleDesc}>{desc}</Text>
    </Pressable>
  )
}

function ChipGroup<T extends string>({
  options,
  value,
  onChange,
}: {
  options: Array<{ value: T; label: string }>
  value: T
  onChange: (value: T) => void
}) {
  return (
    <View style={styles.chipGroup}>
      {options.map((option) => {
        const active = value === option.value
        return (
          <Pressable
            key={option.value}
            style={({ pressed }) => [styles.chip, active && styles.chipActive, pressed && styles.pressed]}
            onPress={() => onChange(option.value)}
          >
            <Text style={[styles.chipText, active && styles.chipTextActive]}>{option.label}</Text>
          </Pressable>
        )
      })}
    </View>
  )
}

function RecordGridAction({
  title,
  desc,
  icon,
  tone,
  disabled,
  onPress,
}: {
  title: string
  desc: string
  icon: LucideIcon
  tone: 'green' | 'blue' | 'gold' | 'purple'
  disabled?: boolean
  onPress: () => void
}) {
  const Icon = icon

  return (
    <Pressable
      disabled={disabled}
      style={({ pressed }) => [
        styles.recordActionCard,
        tone === 'green' && styles.recordActionGreen,
        tone === 'blue' && styles.recordActionBlue,
        tone === 'gold' && styles.recordActionGold,
        tone === 'purple' && styles.recordActionPurple,
        disabled && styles.disabled,
        pressed && styles.pressed,
      ]}
      onPress={onPress}
    >
      <View
        style={[
          styles.recordActionIcon,
          tone === 'green' && styles.recordIconGreen,
          tone === 'blue' && styles.recordIconBlue,
          tone === 'gold' && styles.recordIconGold,
          tone === 'purple' && styles.recordIconPurple,
        ]}
      >
        <Icon size={22} color={recordActionIconColor[tone]} strokeWidth={2.5} />
      </View>
      <Text style={styles.recordActionTitle}>{title}</Text>
      <Text style={styles.recordActionDesc}>{desc}</Text>
    </Pressable>
  )
}

function RecordQuickAction({ title, desc, onPress }: { title: string; desc: string; onPress: () => void }) {
  return (
    <Pressable style={({ pressed }) => [styles.recordQuickAction, pressed && styles.pressed]} onPress={onPress}>
      <View style={styles.recordQuickText}>
        <Text style={styles.recordQuickTitle}>{title}</Text>
        <Text style={styles.recordQuickDesc}>{desc}</Text>
      </View>
      <Text style={styles.recordQuickChevron}>›</Text>
    </Pressable>
  )
}

const recordActionIconColor = {
  green: '#38a97b',
  blue: '#4295bc',
  gold: '#9f823a',
  purple: '#6951bd',
} as const

function executionModeLabel(mode: ExecutionMode): string {
  if (mode === 'fast') return '快速'
  if (mode === 'fast_web_search') return '快速联网'
  if (mode === 'standard_web_search') return '普通联网'
  if (mode === 'strict') return '精准'
  if (mode === 'strict_separate') return '精准分项'
  if (mode === 'strict_web_search') return '精准联网'
  return '普通'
}

const styles = StyleSheet.create({
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: colors.text,
  },
  badge: {
    color: colors.brandDark,
    fontWeight: '800',
  },
  modeBadge: {
    color: colors.brandDark,
    fontSize: 13,
    fontWeight: '800',
  },
  subtitle: {
    marginTop: 8,
    marginBottom: 18,
    color: colors.textSecondary,
    lineHeight: 20,
  },
  previewGrid: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 14,
  },
  previewTile: {
    flex: 1,
    minHeight: 108,
  },
  previewImage: {
    width: '100%',
    aspectRatio: 1,
    borderRadius: 14,
    backgroundColor: colors.surfaceMuted,
  },
  removeImageButton: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(15, 23, 42, 0.68)',
  },
  removeImageText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '800',
    lineHeight: 20,
  },
  emptyPreview: {
    minHeight: 128,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 14,
    marginBottom: 14,
    backgroundColor: colors.surfaceMuted,
  },
  emptyPreviewTitle: {
    marginTop: 8,
    color: colors.text,
    fontSize: 15,
    fontWeight: '800',
  },
  emptyPreviewText: {
    marginTop: 4,
    color: colors.textSecondary,
    fontSize: 12,
    lineHeight: 17,
    textAlign: 'center',
  },
  recordGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  recordActionCard: {
    width: '48.5%',
    minHeight: 122,
    borderRadius: 18,
    borderWidth: 1,
    padding: 14,
  },
  recordActionGreen: {
    backgroundColor: '#f9fefc',
    borderColor: '#d9faeb',
  },
  recordActionBlue: {
    backgroundColor: '#f9fdfe',
    borderColor: '#d9f2fa',
  },
  recordActionGold: {
    backgroundColor: '#fefcf7',
    borderColor: '#f7e9ce',
  },
  recordActionPurple: {
    backgroundColor: '#fefcfe',
    borderColor: '#e6defa',
  },
  recordActionIcon: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  recordIconGreen: {
    backgroundColor: '#ebfcf4',
  },
  recordIconBlue: {
    backgroundColor: '#ebf7fc',
  },
  recordIconGold: {
    backgroundColor: '#fbf5e6',
  },
  recordIconPurple: {
    backgroundColor: '#f3effc',
  },
  recordActionTitle: {
    color: colors.text,
    fontWeight: '900',
    fontSize: 16,
  },
  recordActionDesc: {
    color: colors.textSecondary,
    fontSize: 12,
    lineHeight: 17,
    marginTop: 5,
  },
  recordQuickList: {
    marginTop: 2,
  },
  recordQuickAction: {
    minHeight: 66,
    flexDirection: 'row',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  recordQuickText: {
    flex: 1,
    paddingRight: 12,
  },
  recordQuickTitle: {
    color: colors.text,
    fontWeight: '900',
  },
  recordQuickDesc: {
    marginTop: 3,
    color: colors.textSecondary,
    lineHeight: 18,
  },
  recordQuickChevron: {
    color: colors.textMuted,
    fontSize: 28,
  },
  segmentedRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 14,
  },
  segmentedItem: {
    flex: 1,
    minHeight: 58,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    justifyContent: 'center',
    paddingHorizontal: 10,
    backgroundColor: colors.surfaceMuted,
  },
  segmentedItemActive: {
    borderColor: colors.brand,
    backgroundColor: colors.brandSoft,
  },
  segmentedTitle: {
    color: colors.text,
    fontWeight: '900',
    textAlign: 'center',
  },
  segmentedTitleActive: {
    color: colors.brandDark,
  },
  segmentedDesc: {
    marginTop: 3,
    color: colors.textSecondary,
    fontSize: 11,
    textAlign: 'center',
  },
  segmentedDescActive: {
    color: colors.brandDark,
  },
  optionGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 12,
  },
  toggleCard: {
    width: '48.7%',
    minHeight: 92,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 12,
    backgroundColor: colors.surfaceMuted,
  },
  toggleCardActive: {
    borderColor: colors.brand,
    backgroundColor: '#f0fdf7',
  },
  toggleTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  switchTrack: {
    width: 34,
    height: 20,
    borderRadius: 10,
    padding: 2,
    backgroundColor: '#d1d5db',
  },
  switchTrackActive: {
    backgroundColor: colors.brand,
  },
  switchKnob: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#fff',
  },
  switchKnobActive: {
    transform: [{ translateX: 14 }],
  },
  toggleTitle: {
    marginTop: 9,
    color: colors.text,
    fontWeight: '900',
  },
  toggleDesc: {
    marginTop: 3,
    color: colors.textSecondary,
    fontSize: 11,
    lineHeight: 15,
  },
  fieldLabel: {
    marginTop: 16,
    marginBottom: 8,
    color: colors.text,
    fontWeight: '900',
  },
  chipGroup: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    minHeight: 34,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceMuted,
  },
  chipActive: {
    borderColor: colors.brand,
    backgroundColor: colors.brandSoft,
  },
  chipText: {
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: '700',
  },
  chipTextActive: {
    color: colors.brandDark,
  },
  textArea: {
    minHeight: 92,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: colors.text,
    backgroundColor: colors.surfaceMuted,
    textAlignVertical: 'top',
    lineHeight: 20,
  },
  dateHint: {
    marginTop: 12,
    color: colors.textSecondary,
    fontSize: 12,
  },
  dateInput: {
    minHeight: 42,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 12,
    color: colors.text,
    backgroundColor: colors.surfaceMuted,
    marginTop: 6,
    marginBottom: 12,
  },
  submitHint: {
    marginTop: 9,
    color: colors.textSecondary,
    fontSize: 12,
    lineHeight: 17,
    textAlign: 'center',
  },
  demoButtonGap: {
    marginTop: 10,
  },
  pressed: {
    opacity: 0.72,
  },
  disabled: {
    opacity: 0.52,
  },
})
