import { useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, Image, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import * as ImagePicker from 'expo-image-picker'
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import {
  type ActivityTiming,
  type ExecutionMode,
  type MealType,
  type MembershipStatus,
  inferDefaultMealTypeFromLocalTime,
} from '@food-link/core'
import {
  Camera,
  Check,
  Coffee,
  Cookie,
  Dumbbell,
  History,
  Image as ImageIcon,
  Info,
  Moon,
  RotateCcw,
  Soup,
  Sparkles,
  Utensils,
  Wifi,
  X,
  type LucideIcon,
} from 'lucide-react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { apiClient } from '../api'
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
type HelpSheetState = { title: string; content: string } | null

const MAX_ANALYZE_IMAGES = 3

const MODE_OPTIONS: Array<{ value: AnalyzeBaseMode; label: string; desc: string }> = [
  { value: 'fast', label: '快速', desc: '更快出结果，适合先记录下来。' },
  { value: 'standard', label: '普通', desc: '日常推荐，兼顾速度和准确度。' },
  { value: 'strict', label: '精准', desc: '更细估重，适合复杂餐盘。' },
]

const MEAL_OPTIONS: Array<{ value: MealType; label: string; icon: LucideIcon }> = [
  { value: 'breakfast', label: '早餐', icon: Coffee },
  { value: 'morning_snack', label: '早加餐', icon: Cookie },
  { value: 'lunch', label: '午餐', icon: Soup },
  { value: 'afternoon_snack', label: '午加餐', icon: Utensils },
  { value: 'dinner', label: '晚餐', icon: Moon },
  { value: 'evening_snack', label: '晚加餐', icon: Cookie },
]

const ACTIVITY_TIMING_OPTIONS: Array<{ value: ActivityTiming; label: string; icon: LucideIcon }> = [
  { value: 'post_workout', label: '练后', icon: Dumbbell },
  { value: 'daily', label: '日常', icon: Check },
  { value: 'before_sleep', label: '睡前', icon: Moon },
  { value: 'none', label: '无', icon: Sparkles },
]

const HELP_TEXT = {
  photo: [
    '1. 尽量让食物完整出现在画面里。',
    '2. 光线偏暗时打开闪光灯或换到明亮位置。',
    '3. 多道菜可以一次拍全，也可以补充多张角度图。',
  ].join('\n'),
  text: '补充“学校食堂大份”“额外加辣油”“饭盒约 500ml”这类上下文，AI 会用它修正重量和食材判断。',
  webSearch: '联网校准会参考品牌、包装规格或常见菜品信息，适合外卖、预包装食品和校园餐。',
  separate: '分项模式只在精准模式下可用，会尽量把每一种食物拆开估重。',
  multiView: '多视角辅助适合上传 2-3 张同一餐盘的不同角度，帮助判断隐藏食材和体积。',
  ratio: 'AI 摄入比例会给出可食用比例建议，适合吃剩、多人分食或只吃部分餐品的场景。',
  meal: '餐次会影响当日记录归类，也会作为营养建议的参考。',
  timing: '运动时机会影响补给建议，例如练后更关注蛋白质与碳水恢复。',
}

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
  const insets = useSafeAreaInsets()
  const [loading, setLoading] = useState(false)
  const [membershipLoading, setMembershipLoading] = useState(false)
  const [membership, setMembership] = useState<MembershipStatus | null>(null)
  const [imageAssets, setImageAssets] = useState<AnalyzeImageAsset[]>([])
  const [mealType, setMealType] = useState<MealType>(route.params?.mealType || inferDefaultMealTypeFromLocalTime())
  const [baseMode, setBaseMode] = useState<AnalyzeBaseMode>('standard')
  const [webSearchEnabled, setWebSearchEnabled] = useState(false)
  const [separateFoodEstimateEnabled, setSeparateFoodEstimateEnabled] = useState(false)
  const [multiViewEnabled, setMultiViewEnabled] = useState(false)
  const [suggestRatioEnabled, setSuggestRatioEnabled] = useState(true)
  const [activityTiming, setActivityTiming] = useState<ActivityTiming>('none')
  const [additionalContext, setAdditionalContext] = useState('')
  const [helpSheet, setHelpSheet] = useState<HelpSheetState>(null)
  const date = route.params?.date || todayKey()

  const executionMode = useMemo(
    () => resolveExecutionModeFromOptions(baseMode, webSearchEnabled, separateFoodEstimateEnabled),
    [baseMode, webSearchEnabled, separateFoodEstimateEnabled],
  )
  const quota = useMemo(() => buildAnalyzeQuota(membership), [membership])
  const isQuotaExhausted = Boolean(quota && quota.remaining <= 0)
  const confirmDisabled = loading || imageAssets.length === 0 || isQuotaExhausted
  const bottomInset = Math.max(insets.bottom, 12)

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

  useEffect(() => {
    let active = true
    setMembershipLoading(true)
    apiClient.getMyMembership(date)
      .then((status) => {
        if (active) setMembership(status)
      })
      .catch(() => {
        if (active) setMembership(null)
      })
      .finally(() => {
        if (active) setMembershipLoading(false)
      })
    return () => {
      active = false
    }
  }, [date])

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

  const removeImage = (uri: string) => {
    setImageAssets((current) => current.filter((asset) => asset.uri !== uri))
  }

  const submitAnalyze = async () => {
    if (imageAssets.length === 0) {
      await dialog.alert('请先选择图片', `可以拍照或从相册选择，最多支持 ${MAX_ANALYZE_IMAGES} 张图片一起识别。`, 'warning')
      return
    }
    if (isQuotaExhausted) {
      await dialog.alert('积分不足', '当前可用积分不足，暂时不能发起图片分析。', 'warning')
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
    <View style={styles.analyzePage}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.content, { paddingBottom: 170 + bottomInset }]}
      >
        {quota ? (
          <QuotaBar
            quota={quota}
            executionMode={executionMode}
            isPro={Boolean(membership?.is_pro)}
            exhausted={isQuotaExhausted}
          />
        ) : membershipLoading ? <View style={styles.quotaSpacer} /> : null}

        <Pressable style={({ pressed }) => [styles.photoTipBar, pressed && styles.pressed]} onPress={() => setHelpSheet({ title: '摄影技巧', content: HELP_TEXT.photo })}>
          <View style={styles.photoTipDot} />
          <Text style={styles.photoTipText}>摄影技巧</Text>
          <Text style={styles.photoTipAction}>查看</Text>
        </Pressable>

        <View style={styles.imagePreviewSection}>
          {imageAssets.length > 0 ? (
            <View style={styles.imageGrid}>
              {imageAssets.map((asset, index) => (
                <View key={`${asset.uri}-${index}`} style={[styles.gridItem, multiViewEnabled && styles.gridItemMultiview]}>
                  <Image source={{ uri: asset.uri }} style={styles.gridImage} />
                  <Pressable style={styles.removeButton} onPress={() => removeImage(asset.uri)}>
                    <X size={14} color="#fff" strokeWidth={3} />
                  </Pressable>
                </View>
              ))}
              {imageAssets.length < MAX_ANALYZE_IMAGES ? (
                <Pressable style={({ pressed }) => [styles.gridItem, styles.addImageTile, pressed && styles.pressed]} onPress={() => pickImages('library')}>
                  <Text style={styles.addImageIcon}>+</Text>
                  <Text style={styles.addImageText}>添加</Text>
                </Pressable>
              ) : null}
            </View>
          ) : (
            <View style={styles.emptyPreview}>
              <Camera size={34} color="#9ca3af" strokeWidth={1.8} />
              <Text style={styles.emptyPreviewTitle}>点击拍摄/上传食物</Text>
              <Text style={styles.emptyPreviewText}>相册上传最多支持 {MAX_ANALYZE_IMAGES} 张，多图将作为一次识别提交</Text>
              <View style={styles.placeholderActions}>
                <PickerPill icon={Camera} label="拍照" onPress={() => pickImages('camera')} />
                <PickerPill icon={ImageIcon} label="相册" onPress={() => pickImages('library')} />
              </View>
            </View>
          )}

          <View style={styles.qualityZone}>
            <View style={styles.modeCompact}>
              <View style={styles.modeCompactLeft}>
                <Text style={styles.modeCompactTitle}>识别模式</Text>
                <Text style={styles.modeSummary}>{executionModeLabel(executionMode)}</Text>
              </View>
              <View style={styles.modeSwitchRow}>
                {MODE_OPTIONS.map((option) => (
                  <ModeSwitchItem
                    key={option.value}
                    label={option.label}
                    active={baseMode === option.value}
                    onPress={() => setBaseMode(option.value)}
                  />
                ))}
              </View>
            </View>

            <View style={styles.analysisOptionsRow}>
              <AnalysisOptionCard
                title="联网校准"
                enabled={webSearchEnabled}
                onPress={() => setWebSearchEnabled((value) => !value)}
                onHelpPress={() => setHelpSheet({ title: '联网校准', content: HELP_TEXT.webSearch })}
              />
              <AnalysisOptionCard
                title="分项模式"
                enabled={separateFoodEstimateEnabled}
                disabled={baseMode !== 'strict'}
                onPress={() => setSeparateFoodEstimateEnabled((value) => !value)}
                onHelpPress={() => setHelpSheet({ title: '分项模式', content: HELP_TEXT.separate })}
              />
            </View>

            <CompactSwitchRow
              title="多视角辅助"
              icon={RotateCcw}
              enabled={multiViewEnabled}
              onPress={() => setMultiViewEnabled((value) => !value)}
              onHelpPress={() => setHelpSheet({ title: '多视角辅助', content: HELP_TEXT.multiView })}
            />
            <CompactSwitchRow
              title="AI摄入比例"
              icon={Sparkles}
              enabled={suggestRatioEnabled}
              onPress={() => setSuggestRatioEnabled((value) => !value)}
              onHelpPress={() => setHelpSheet({ title: 'AI 摄入比例', content: HELP_TEXT.ratio })}
            />
          </View>
        </View>

        <View style={styles.detailsSection}>
          <SectionHeader title="文字补充" onHelpPress={() => setHelpSheet({ title: '文字补充', content: HELP_TEXT.text })} />
          <View style={styles.inputWrapper}>
            <TextInput
              value={additionalContext}
              onChangeText={setAdditionalContext}
              placeholder="例如：这是学校食堂的大份，额外加了辣油，用的是 500ml 便当盒..."
              placeholderTextColor="#9ca3af"
              multiline
              maxLength={200}
              style={styles.detailsInput}
            />
          </View>
        </View>

        <View style={styles.mealSection}>
          <SectionHeader title="餐次" onHelpPress={() => setHelpSheet({ title: '餐次', content: HELP_TEXT.meal })} />
          <View style={styles.mealOptions}>
            {MEAL_OPTIONS.map((option) => (
              <MealOption
                key={option.value}
                label={option.label}
                icon={option.icon}
                active={mealType === option.value}
                onPress={() => setMealType(option.value)}
              />
            ))}
          </View>
        </View>

        <View style={styles.stateSection}>
          <SectionHeader title="运动时机" onHelpPress={() => setHelpSheet({ title: '运动时机', content: HELP_TEXT.timing })} />
          <View style={styles.stateOptions}>
            {ACTIVITY_TIMING_OPTIONS.map((option) => (
              <StateOption
                key={option.value}
                label={option.label}
                icon={option.icon}
                active={activityTiming === option.value}
                onPress={() => setActivityTiming(option.value)}
              />
            ))}
          </View>
        </View>

        {SHOW_DEBUG_LOGIN ? (
          <View style={styles.debugSection}>
            <Text style={styles.debugTitle}>示例结果预览</Text>
            <Text style={styles.debugText}>仅开发环境显示，用来快速检查图片结果和文字结果页面。</Text>
            <View style={styles.debugActions}>
              <DebugButton label="图片结果" onPress={openDemoResult} />
              <DebugButton label="文字结果" onPress={openDemoTextResult} />
            </View>
          </View>
        ) : null}
      </ScrollView>

      <View style={[styles.confirmSection, { paddingBottom: bottomInset }]}>
        <Pressable
          disabled={confirmDisabled}
          style={({ pressed }) => [styles.confirmButton, confirmDisabled && styles.confirmButtonDisabled, pressed && !confirmDisabled && styles.pressed]}
          onPress={() => void submitAnalyze()}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={[styles.confirmButtonText, confirmDisabled && styles.confirmButtonTextDisabled]} numberOfLines={1} adjustsFontSizeToFit>
              {confirmButtonLabel(imageAssets.length, isQuotaExhausted)}
            </Text>
          )}
        </Pressable>
        <Pressable style={({ pressed }) => [styles.historyLink, pressed && styles.pressed]} onPress={() => navigation.navigate('AnalyzeHistory')}>
          <History size={16} color="#00bc7d" strokeWidth={2.4} />
          <Text style={styles.historyLinkText}>查看识别记录</Text>
        </Pressable>
      </View>

      <HelpSheet sheet={helpSheet} onClose={() => setHelpSheet(null)} />
    </View>
  )
}

function QuotaBar({
  quota,
  executionMode,
  isPro,
  exhausted,
}: {
  quota: AnalyzeQuota
  executionMode: ExecutionMode
  isPro: boolean
  exhausted: boolean
}) {
  const warn = !exhausted && quota.remaining <= 2
  return (
    <View style={styles.quotaBar}>
      <View style={[styles.quotaDot, isPro && styles.quotaDotPro, warn && styles.quotaDotWarn, exhausted && styles.quotaDotExhausted]} />
      <Text style={[styles.quotaText, exhausted && styles.quotaTextExhausted]} numberOfLines={1} adjustsFontSizeToFit>
        {formatQuotaText(quota, executionMode)}
      </Text>
    </View>
  )
}

function PickerPill({ icon, label, onPress }: { icon: LucideIcon; label: string; onPress: () => void }) {
  const Icon = icon
  return (
    <Pressable style={({ pressed }) => [styles.pickerPill, pressed && styles.pressed]} onPress={onPress}>
      <Icon size={14} color="#047857" strokeWidth={2.4} />
      <Text style={styles.pickerPillText}>{label}</Text>
    </Pressable>
  )
}

function ModeSwitchItem({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable style={({ pressed }) => [styles.modeSwitchItem, active && styles.modeSwitchItemActive, pressed && styles.pressed]} onPress={onPress}>
      <Text style={[styles.modeSwitchText, active && styles.modeSwitchTextActive]} numberOfLines={1}>{label}</Text>
    </Pressable>
  )
}

function AnalysisOptionCard({
  title,
  enabled,
  disabled,
  onPress,
  onHelpPress,
}: {
  title: string
  enabled: boolean
  disabled?: boolean
  onPress: () => void
  onHelpPress: () => void
}) {
  return (
    <Pressable
      disabled={disabled}
      style={({ pressed }) => [
        styles.analysisOptionCard,
        enabled && styles.analysisOptionCardActive,
        disabled && styles.disabled,
        pressed && !disabled && styles.pressed,
      ]}
      onPress={onPress}
    >
      <View style={styles.analysisOptionLeft}>
        <Text style={styles.analysisOptionTitle} numberOfLines={1}>{title}</Text>
        <HelpIcon onPress={onHelpPress} />
      </View>
      <SwitchPill enabled={enabled} small />
    </Pressable>
  )
}

function CompactSwitchRow({
  title,
  icon,
  enabled,
  onPress,
  onHelpPress,
}: {
  title: string
  icon: LucideIcon
  enabled: boolean
  onPress: () => void
  onHelpPress: () => void
}) {
  const Icon = icon
  return (
    <Pressable style={({ pressed }) => [styles.compactSwitchRow, pressed && styles.pressed]} onPress={onPress}>
      <View style={styles.compactSwitchLeft}>
        <Icon size={15} color="#64748b" strokeWidth={2.3} />
        <Text style={styles.compactSwitchTitle}>{title}</Text>
        <HelpIcon onPress={onHelpPress} />
      </View>
      <SwitchPill enabled={enabled} />
    </Pressable>
  )
}

function SwitchPill({ enabled, small }: { enabled: boolean; small?: boolean }) {
  return (
    <View style={[small ? styles.switchTrackSmall : styles.switchTrack, enabled && styles.switchTrackOn]}>
      <View style={[small ? styles.switchKnobSmall : styles.switchKnob, enabled && (small ? styles.switchKnobSmallOn : styles.switchKnobOn)]} />
    </View>
  )
}

function SectionHeader({ title, onHelpPress }: { title: string; onHelpPress: () => void }) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <HelpIcon onPress={onHelpPress} />
    </View>
  )
}

function HelpIcon({ onPress }: { onPress: () => void }) {
  return (
    <Pressable style={({ pressed }) => [styles.helpIcon, pressed && styles.pressed]} onPress={onPress} hitSlop={8}>
      <Info size={12} color="#9ca3af" strokeWidth={2.4} />
    </Pressable>
  )
}

function MealOption({ label, icon, active, onPress }: { label: string; icon: LucideIcon; active: boolean; onPress: () => void }) {
  const Icon = icon
  return (
    <Pressable style={({ pressed }) => [styles.mealOption, active && styles.mealOptionActive, pressed && styles.pressed]} onPress={onPress}>
      <Icon size={19} color={active ? '#00bc7d' : '#6b7280'} strokeWidth={2.3} />
      <Text style={[styles.mealLabel, active && styles.mealLabelActive]} numberOfLines={1}>{label}</Text>
    </Pressable>
  )
}

function StateOption({ label, icon, active, onPress }: { label: string; icon: LucideIcon; active: boolean; onPress: () => void }) {
  const Icon = icon
  return (
    <Pressable style={({ pressed }) => [styles.stateOption, active && styles.stateOptionActive, pressed && styles.pressed]} onPress={onPress}>
      <Icon size={18} color={active ? '#00bc7d' : '#6b7280'} strokeWidth={2.3} />
      <Text style={[styles.stateLabel, active && styles.stateLabelActive]} numberOfLines={1} adjustsFontSizeToFit>{label}</Text>
    </Pressable>
  )
}

function DebugButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable style={({ pressed }) => [styles.debugButton, pressed && styles.pressed]} onPress={onPress}>
      <Text style={styles.debugButtonText}>{label}</Text>
    </Pressable>
  )
}

function HelpSheet({ sheet, onClose }: { sheet: HelpSheetState; onClose: () => void }) {
  const insets = useSafeAreaInsets()
  return (
    <Modal visible={Boolean(sheet)} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.helpSheet}>
        <Pressable style={styles.helpSheetMask} onPress={onClose} />
        <View style={[styles.helpSheetContent, { paddingBottom: Math.max(insets.bottom, 18) + 20 }]}>
          <View style={styles.helpSheetHandle} />
          <View style={styles.helpSheetHeader}>
            <Text style={styles.helpSheetTitle}>{sheet?.title}</Text>
            <Pressable style={styles.helpSheetClose} onPress={onClose}>
              <X size={18} color="#475569" strokeWidth={2.4} />
            </Pressable>
          </View>
          <Text style={styles.helpSheetBody}>{sheet?.content}</Text>
        </View>
      </View>
    </Modal>
  )
}

type AnalyzeQuota = {
  max: number
  used: number
  remaining: number
}

function buildAnalyzeQuota(status: MembershipStatus | null): AnalyzeQuota | null {
  if (!status) return null
  const max = numericValue(status.daily_credits_max ?? status.daily_limit)
  const remaining = numericValue(status.total_credits_available ?? status.daily_credits_remaining ?? status.daily_remaining)
  const explicitUsed = status.daily_credits_used ?? status.daily_used
  const used = explicitUsed == null && max > 0 ? Math.max(0, max - remaining) : numericValue(explicitUsed)
  return {
    max,
    used,
    remaining,
  }
}

function numericValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0
}

function formatQuotaText(quota: AnalyzeQuota, mode: ExecutionMode): string {
  const modeLabel = executionModeLabel(mode)
  if (quota.max > 0) {
    return `今日已用 ${quota.used}/${quota.max} 积分 · 剩余 ${quota.remaining} · ${modeLabel}`
  }
  return `可用积分 ${quota.remaining} · ${modeLabel}`
}

function confirmButtonLabel(imageCount: number, isQuotaExhausted: boolean): string {
  if (isQuotaExhausted) return '积分不足，暂不可分析'
  if (imageCount === 0) return '请先拍照或选图'
  return `分析 ${imageCount} 张图片`
}

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
  analyzePage: {
    flex: 1,
    backgroundColor: '#f7f8fa',
  },
  content: {
    paddingTop: 12,
    paddingHorizontal: 10,
  },
  quotaSpacer: {
    height: 8,
  },
  quotaBar: {
    minHeight: 24,
    marginBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 5,
  },
  quotaDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#00bc7d',
  },
  quotaDotPro: {
    backgroundColor: '#10b981',
  },
  quotaDotWarn: {
    backgroundColor: '#f59e0b',
  },
  quotaDotExhausted: {
    backgroundColor: '#ef4444',
  },
  quotaText: {
    maxWidth: '92%',
    color: '#94a3b8',
    fontSize: 11,
    lineHeight: 16,
  },
  quotaTextExhausted: {
    color: '#ef4444',
  },
  photoTipBar: {
    minHeight: 28,
    marginBottom: 7,
    paddingVertical: 4,
    paddingHorizontal: 9,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(0,188,125,0.18)',
    backgroundColor: 'rgba(0,188,125,0.08)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  photoTipDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: '#00bc7d',
  },
  photoTipText: {
    flex: 1,
    color: '#047857',
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '600',
  },
  photoTipAction: {
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 999,
    overflow: 'hidden',
    backgroundColor: '#00bc7d',
    color: '#fff',
    fontSize: 10,
    lineHeight: 14,
    fontWeight: '700',
  },
  imagePreviewSection: {
    marginBottom: 10,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#fff',
    elevation: 1,
    shadowColor: '#000',
    shadowOpacity: 0.03,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 1 },
  },
  imageGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    padding: 8,
  },
  gridItem: {
    width: '31.7%',
    aspectRatio: 1,
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: '#f3f4f6',
    borderWidth: 1,
    borderColor: 'transparent',
  },
  gridItemMultiview: {
    borderColor: '#00bc7d',
  },
  gridImage: {
    width: '100%',
    height: '100%',
  },
  addImageTile: {
    borderStyle: 'dashed',
    borderColor: '#d1d5db',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f9fafb',
  },
  addImageIcon: {
    color: '#9ca3af',
    fontSize: 30,
    lineHeight: 34,
    fontWeight: '300',
  },
  addImageText: {
    marginTop: 4,
    color: '#9ca3af',
    fontSize: 12,
    fontWeight: '600',
  },
  removeButton: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  emptyPreview: {
    minHeight: 160,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
    backgroundColor: '#eef1f5',
  },
  emptyPreviewTitle: {
    marginTop: 8,
    color: '#4b5563',
    fontSize: 15,
    lineHeight: 21,
    fontWeight: '600',
  },
  emptyPreviewText: {
    marginTop: 4,
    maxWidth: 270,
    textAlign: 'center',
    color: '#9ca3af',
    fontSize: 12,
    lineHeight: 18,
  },
  placeholderActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 14,
  },
  pickerPill: {
    minHeight: 30,
    minWidth: 80,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(0,188,125,0.22)',
    backgroundColor: '#fff',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
  },
  pickerPillText: {
    color: '#047857',
    fontSize: 12,
    fontWeight: '700',
  },
  qualityZone: {
    borderTopWidth: 1,
    borderTopColor: 'rgba(0,0,0,0.03)',
  },
  modeCompact: {
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0,0,0,0.03)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  modeCompactLeft: {
    flexShrink: 0,
  },
  modeCompactTitle: {
    color: '#374151',
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '700',
  },
  modeSummary: {
    marginTop: 1,
    color: '#00bc7d',
    fontSize: 10,
    lineHeight: 14,
    fontWeight: '700',
  },
  modeSwitchRow: {
    flex: 1,
    maxWidth: 220,
    flexDirection: 'row',
    gap: 5,
  },
  modeSwitchItem: {
    flex: 1,
    minHeight: 28,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  modeSwitchItemActive: {
    borderColor: '#00bc7d',
    backgroundColor: '#00bc7d',
  },
  modeSwitchText: {
    color: '#64748b',
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
  },
  modeSwitchTextActive: {
    color: '#fff',
  },
  analysisOptionsRow: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    flexDirection: 'row',
    gap: 6,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0,0,0,0.03)',
  },
  analysisOptionCard: {
    flex: 1,
    minHeight: 36,
    paddingHorizontal: 7,
    borderRadius: 7,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    backgroundColor: '#f8fafc',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 4,
  },
  analysisOptionCardActive: {
    borderColor: 'rgba(0,188,125,0.35)',
    backgroundColor: 'rgba(0,188,125,0.08)',
  },
  analysisOptionLeft: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  analysisOptionTitle: {
    flexShrink: 1,
    color: '#374151',
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '700',
  },
  compactSwitchRow: {
    minHeight: 38,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0,0,0,0.03)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  compactSwitchLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  compactSwitchTitle: {
    color: '#374151',
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
  },
  switchTrack: {
    width: 44,
    height: 24,
    borderRadius: 999,
    padding: 2,
    backgroundColor: '#e5e7eb',
  },
  switchTrackSmall: {
    width: 32,
    height: 18,
    borderRadius: 999,
    padding: 2,
    backgroundColor: '#e5e7eb',
  },
  switchTrackOn: {
    backgroundColor: '#00bc7d',
  },
  switchKnob: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#fff',
    elevation: 1,
  },
  switchKnobSmall: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: '#fff',
    elevation: 1,
  },
  switchKnobOn: {
    transform: [{ translateX: 20 }],
  },
  switchKnobSmallOn: {
    transform: [{ translateX: 14 }],
  },
  sectionHeader: {
    marginBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  sectionTitle: {
    paddingLeft: 8,
    borderLeftWidth: 3,
    borderLeftColor: '#00bc7d',
    color: '#111827',
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '800',
  },
  helpIcon: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: '#d1d5db',
    alignItems: 'center',
    justifyContent: 'center',
  },
  detailsSection: {
    marginBottom: 10,
    padding: 12,
    borderRadius: 12,
    backgroundColor: '#fff',
    elevation: 1,
    shadowColor: '#000',
    shadowOpacity: 0.03,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 1 },
  },
  inputWrapper: {
    minHeight: 80,
    borderRadius: 8,
    backgroundColor: '#f9fafb',
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  detailsInput: {
    minHeight: 72,
    color: '#111827',
    fontSize: 14,
    lineHeight: 20,
    textAlignVertical: 'top',
    padding: 0,
  },
  mealSection: {
    marginBottom: 10,
    padding: 12,
    borderRadius: 12,
    backgroundColor: '#fff',
    elevation: 1,
    shadowColor: '#000',
    shadowOpacity: 0.03,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 1 },
  },
  mealOptions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: 8,
  },
  mealOption: {
    width: '48.5%',
    minHeight: 56,
    paddingHorizontal: 8,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'transparent',
    backgroundColor: '#f9fafb',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  mealOptionActive: {
    borderColor: '#00bc7d',
    backgroundColor: '#f0fdf9',
  },
  mealLabel: {
    color: '#4b5563',
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
  },
  mealLabelActive: {
    color: '#00bc7d',
    fontWeight: '800',
  },
  stateSection: {
    marginBottom: 10,
    padding: 12,
    borderRadius: 12,
    backgroundColor: '#fff',
    elevation: 1,
    shadowColor: '#000',
    shadowOpacity: 0.03,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 1 },
  },
  stateOptions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 6,
  },
  stateOption: {
    flex: 1,
    minHeight: 56,
    paddingHorizontal: 5,
    paddingVertical: 9,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'transparent',
    backgroundColor: '#f9fafb',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  stateOptionActive: {
    borderColor: '#00bc7d',
    backgroundColor: '#f0fdf9',
  },
  stateLabel: {
    color: '#4b5563',
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '600',
  },
  stateLabelActive: {
    color: '#00bc7d',
    fontWeight: '800',
  },
  debugSection: {
    marginBottom: 10,
    padding: 12,
    borderRadius: 12,
    backgroundColor: '#fff',
  },
  debugTitle: {
    color: colors.text,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '800',
  },
  debugText: {
    marginTop: 4,
    color: colors.textSecondary,
    fontSize: 12,
    lineHeight: 18,
  },
  debugActions: {
    marginTop: 10,
    flexDirection: 'row',
    gap: 8,
  },
  debugButton: {
    flex: 1,
    minHeight: 34,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: '#d1fae5',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f0fdf9',
  },
  debugButtonText: {
    color: '#047857',
    fontSize: 12,
    fontWeight: '800',
  },
  confirmSection: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingTop: 6,
    paddingHorizontal: 16,
    alignItems: 'center',
    gap: 12,
    backgroundColor: 'rgba(247,248,250,0.96)',
    borderTopWidth: 1,
    borderTopColor: 'rgba(226,232,240,0.75)',
  },
  confirmButton: {
    width: '100%',
    maxWidth: 300,
    minHeight: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    backgroundColor: '#00bc7d',
    elevation: 3,
    shadowColor: '#00bc7d',
    shadowOpacity: 0.3,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
  },
  confirmButtonDisabled: {
    backgroundColor: '#e5e7eb',
    elevation: 0,
    shadowOpacity: 0,
  },
  confirmButtonText: {
    color: '#fff',
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '800',
  },
  confirmButtonTextDisabled: {
    color: '#9ca3af',
  },
  historyLink: {
    minHeight: 36,
    paddingHorizontal: 20,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#00bc7d',
    backgroundColor: '#fff',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
  },
  historyLinkText: {
    color: '#00bc7d',
    fontSize: 14,
    lineHeight: 19,
    fontWeight: '700',
  },
  helpSheet: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  helpSheetMask: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: 'rgba(15,23,42,0.35)',
  },
  helpSheetContent: {
    width: '100%',
    paddingTop: 10,
    paddingHorizontal: 18,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    backgroundColor: '#fff',
  },
  helpSheetHandle: {
    alignSelf: 'center',
    width: 38,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#e2e8f0',
    marginBottom: 12,
  },
  helpSheetHeader: {
    minHeight: 34,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  helpSheetTitle: {
    flex: 1,
    color: '#111827',
    fontSize: 17,
    lineHeight: 23,
    fontWeight: '800',
  },
  helpSheetClose: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f1f5f9',
  },
  helpSheetBody: {
    marginTop: 8,
    color: '#475569',
    fontSize: 14,
    lineHeight: 22,
  },
  disabled: {
    opacity: 0.55,
  },
  pressed: {
    opacity: 0.78,
    transform: [{ scale: 0.98 }],
  },
})
