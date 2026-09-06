import { useCallback, useMemo, useState } from 'react'
import { ActivityIndicator, Image, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import * as ImagePicker from 'expo-image-picker'
import { useFocusEffect, useNavigation } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import type { ExecutionMode, HealthProfile, HealthReportExtract, MembershipStatus } from '@food-link/core'
import { Camera, Check, ChevronRight, Edit3, Image as ImageIcon, LockKeyhole, Plus, Trash2, Upload, X } from 'lucide-react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { apiClient } from '../api'
import type { RootStackParamList } from '../navigation/types'
import { useAppDialog } from '../providers/DialogProvider'
import { useColorScheme } from '../providers/ColorSchemeProvider'
import { colors } from '../theme'
import { userFacingErrorMessage, userFacingMessage } from '../utils/errors'
import { readImageAsBase64DataUrl } from '../utils/image'

type EditField =
  | 'gender'
  | 'birthday'
  | 'height'
  | 'weight'
  | 'diet_goal'
  | 'daily_life_activity_level'
  | 'execution_mode'
  | 'medical_history'
  | 'diet_preference'
  | 'allergies'
  | 'routine_type'
  | 'health_notes'
  | 'report_extract'

type ChoiceOption = { value: string; label: string }
type HealthProfileViewPalette = {
  page: string
  surface: string
  surfaceRaised: string
  surfaceMuted: string
  surfacePressed: string
  text: string
  textSecondary: string
  textMuted: string
  border: string
  divider: string
  brand: string
  brandStrong: string
  brandSoft: string
  brandOnSoft: string
  input: string
  secondaryButton: string
  secondaryButtonText: string
  handle: string
  danger: string
  dangerSoft: string
  scrim: string
}

const fieldLabels: Record<EditField, string> = {
  gender: '性别',
  birthday: '出生日期',
  height: '身高',
  weight: '体重',
  diet_goal: '饮食目标',
  daily_life_activity_level: '日常活动',
  execution_mode: '执行模式',
  medical_history: '既往病史',
  diet_preference: '饮食偏好',
  allergies: '过敏源',
  routine_type: '作息习惯',
  health_notes: '特殊情况和补充',
  report_extract: '体检/病例识别结果',
}

const fieldChoiceOptions = {
  gender: [
    { value: 'male', label: '男' },
    { value: 'female', label: '女' },
  ],
  diet_goal: [
    { value: 'fat_loss', label: '减重' },
    { value: 'maintain', label: '保持' },
    { value: 'muscle_gain', label: '增重' },
  ],
  daily_life_activity_level: [
    { value: 'sedentary', label: '久坐办公' },
    { value: 'light', label: '日常走动较多' },
    { value: 'moderate', label: '经常站立走动' },
    { value: 'active', label: '体力劳动' },
  ],
  execution_mode: [
    { value: 'fast', label: '快速模式' },
    { value: 'standard', label: '普通模式' },
    { value: 'strict', label: '精准模式' },
  ],
} as const

const fieldMultiOptions = {
  medical_history: [
    { value: 'diabetes', label: '糖尿病' },
    { value: 'hypertension', label: '高血压' },
    { value: 'gout', label: '痛风' },
    { value: 'hyperlipidemia', label: '高血脂' },
    { value: 'thyroid', label: '甲状腺疾病' },
    { value: 'none', label: '无' },
  ],
  diet_preference: [
    { value: 'keto', label: '生酮' },
    { value: 'vegetarian', label: '素食' },
    { value: 'vegan', label: '纯素' },
    { value: 'low_salt', label: '低盐' },
    { value: 'gluten_free', label: '无麸质' },
    { value: 'none', label: '无' },
  ],
  allergies: [
    { value: 'seafood', label: '海鲜' },
    { value: 'peanut', label: '花生' },
    { value: 'milk', label: '牛奶' },
    { value: 'egg', label: '鸡蛋' },
    { value: 'mango', label: '芒果' },
    { value: 'alcohol', label: '酒精' },
    { value: 'spicy', label: '辣' },
    { value: 'none', label: '无' },
  ],
} as const

const medicalPresetValues = new Set(fieldMultiOptions.medical_history.map((option) => option.value))
const allergyPresetValues = new Set(fieldMultiOptions.allergies.map((option) => option.value))

const REPORT_TASK_POLL_INTERVAL_MS = 1500
const REPORT_TASK_POLL_TIMEOUT_MS = 45000

export function HealthProfileViewScreen() {
  const dialog = useAppDialog()
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList, 'HealthProfileView'>>()
  const insets = useSafeAreaInsets()
  const { isDark } = useColorScheme()
  const palette = useMemo(() => createHealthProfileViewPalette(isDark), [isDark])
  const [profile, setProfile] = useState<HealthProfile | null>(null)
  const [membership, setMembership] = useState<MembershipStatus | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [saving, setSaving] = useState(false)
  const [editingField, setEditingField] = useState<EditField | null>(null)
  const [editValue, setEditValue] = useState('')
  const [editYear, setEditYear] = useState('')
  const [editMonth, setEditMonth] = useState('')
  const [editDay, setEditDay] = useState('')
  const [editSleepHour, setEditSleepHour] = useState('23')
  const [editWakeHour, setEditWakeHour] = useState('7')
  const [customMedicalOptions, setCustomMedicalOptions] = useState<string[]>([])
  const [selectedCustomMedical, setSelectedCustomMedical] = useState<string[]>([])
  const [customMedicalInput, setCustomMedicalInput] = useState('')
  const [editingMedical, setEditingMedical] = useState('')
  const [customAllergyOptions, setCustomAllergyOptions] = useState<string[]>([])
  const [selectedCustomAllergy, setSelectedCustomAllergy] = useState<string[]>([])
  const [customAllergyInput, setCustomAllergyInput] = useState('')
  const [editingAllergy, setEditingAllergy] = useState('')
  const [reportImageUrls, setReportImageUrls] = useState<string[]>([])
  const [reportPolling, setReportPolling] = useState(false)
  const [reportNotice, setReportNotice] = useState('')
  const [reportSourceVisible, setReportSourceVisible] = useState(false)

  const showError = useCallback((title: string, error: unknown) => {
    return dialog.alert(title, userFacingErrorMessage(error), 'danger')
  }, [dialog])

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError('')
    try {
      const [data, membershipData] = await Promise.all([
        apiClient.getHealthProfile(),
        apiClient.getMyMembership().catch(() => null),
      ])
      setProfile(data)
      setMembership(membershipData)
      const urls = data.health_condition?.report_extract?._image_urls || []
      setReportImageUrls(urls)
    } catch (error) {
      const message = userFacingErrorMessage(error)
      setLoadError(message)
    } finally {
      setLoading(false)
    }
  }, [])

  useFocusEffect(
    useCallback(() => {
      void load()
    }, [load]),
  )

  const openEditor = (field: EditField, value: unknown) => {
    setEditingField(field)
    setEditValue(field === 'daily_life_activity_level' && value === 'very_active' ? 'active' : formatEditValue(value))
    if (field === 'birthday') {
      const date = parseDateParts(String(value || ''))
      setEditYear(date.year)
      setEditMonth(date.month)
      setEditDay(date.day)
    }
    if (field === 'routine_type') {
      const routine = parseRoutineHours(profile?.health_condition?.routine_type)
      setEditSleepHour(String(profile?.health_condition?.routine_sleep_hour ?? routine.sleepHour))
      setEditWakeHour(String(profile?.health_condition?.routine_wake_hour ?? routine.wakeHour))
    }
    if (field === 'medical_history') {
      const list = Array.isArray(value) ? value.map(String) : []
      const custom = list.filter((item) => item !== 'none' && !medicalPresetValues.has(item as never))
      const preset = list.filter((item) => medicalPresetValues.has(item as never))
      setEditValue((preset.length ? preset : custom.length ? [] : ['none']).join('、'))
      setCustomMedicalOptions(custom)
      setSelectedCustomMedical(custom)
      setCustomMedicalInput('')
      setEditingMedical('')
    }
    if (field === 'allergies') {
      const list = Array.isArray(value) ? value.map(String) : []
      const custom = list.filter((item) => item !== 'none' && !allergyPresetValues.has(item as never))
      const preset = list.filter((item) => allergyPresetValues.has(item as never))
      setEditValue((preset.length ? preset : custom.length ? [] : ['none']).join('、'))
      setCustomAllergyOptions(custom)
      setSelectedCustomAllergy(custom)
      setCustomAllergyInput('')
      setEditingAllergy('')
    }
  }

  const closeEditor = () => {
    setEditingField(null)
    setEditValue('')
    setCustomMedicalInput('')
    setEditingMedical('')
    setCustomAllergyInput('')
    setEditingAllergy('')
  }

  const saveField = async () => {
    if (!editingField) return
    const field = editingField
    if (field === 'report_extract') {
      closeEditor()
      return
    }
    let input: Parameters<typeof apiClient.updateHealthProfile>[0]
    if (field === 'birthday') {
      const birthday = validDateFromParts(editYear, editMonth, editDay)
      if (!birthday) {
        await dialog.alert('日期不正确', '请输入有效且不晚于今天的出生日期。', 'warning')
        return
      }
      input = { birthday }
    } else if (field === 'height' || field === 'weight') {
      const number = Number(editValue)
      const minimum = field === 'height' ? 100 : 30
      const maximum = field === 'height' ? 250 : 200
      if (!Number.isFinite(number) || number < minimum || number > maximum) {
        await dialog.alert(`${fieldLabels[field]}不正确`, `请输入 ${minimum}-${maximum} 之间的数值。`, 'warning')
        return
      }
      input = field === 'height' ? { height: number } : { weight: number }
    } else if (field === 'routine_type') {
      const sleepHour = Number(editSleepHour)
      const wakeHour = Number(editWakeHour)
      if (!isValidRoutineHour(sleepHour) || !isValidRoutineHour(wakeHour)) {
        await dialog.alert('作息时间不正确', '睡觉和起床时间都需要填写 0-23 的整点数字。', 'warning')
        return
      }
      input = {
        routine_type: formatRoutineHours(sleepHour, wakeHour),
        routine_sleep_hour: sleepHour,
        routine_wake_hour: wakeHour,
      }
    } else if (field === 'medical_history') {
      input = { medical_history: healthListForSubmit([...splitList(editValue), ...selectedCustomMedical]) }
    } else if (field === 'allergies') {
      input = { allergies: healthListForSubmit([...splitList(editValue), ...selectedCustomAllergy]) }
    } else {
      input = buildHealthProfileFieldInput(field, editValue)
    }
    setSaving(true)
    try {
      const data = await apiClient.updateHealthProfile(input)
      setProfile(data)
      closeEditor()
      await dialog.alert('已保存', `${fieldLabels[field]}已更新`, 'success')
    } catch (error) {
      await showError('保存健康档案失败', error)
    } finally {
      setSaving(false)
    }
  }

  const handleChoiceChange = async (value: string) => {
    if (editingField === 'execution_mode' && value === 'strict' && !canUseStrictModeForMembership(membership)) {
      const confirmed = await dialog.confirm({
        title: '解锁精准模式',
        message: '精准模式需要标准版或进阶版会员。当前选择不会改变，是否前往会员中心查看？',
        confirmText: '查看会员',
        cancelText: '取消',
        kind: 'info',
      })
      if (confirmed) {
        closeEditor()
        navigation.navigate('MembershipCenter')
      }
      return
    }
    setEditValue(value)
  }

  const handlePresetMultiChange = (next: string[]) => {
    setEditValue(next.join('、'))
    if (next.includes('none')) {
      if (editingField === 'medical_history') setSelectedCustomMedical([])
      if (editingField === 'allergies') setSelectedCustomAllergy([])
    }
  }

  const saveCustomMedical = async () => {
    const nextValue = customMedicalInput.trim()
    if (!nextValue) {
      await dialog.alert('请输入病史名称', undefined, 'warning')
      return
    }
    if ((customMedicalOptions.includes(nextValue) && nextValue !== editingMedical) || medicalPresetValues.has(nextValue as never)) {
      await dialog.alert('该病史已存在', undefined, 'warning')
      return
    }
    setCustomMedicalOptions((current) => editingMedical ? current.map((item) => item === editingMedical ? nextValue : item) : [...current, nextValue])
    setSelectedCustomMedical((current) => {
      const withoutOld = current.filter((item) => item !== editingMedical)
      return withoutOld.includes(nextValue) ? withoutOld : [...withoutOld, nextValue]
    })
    setEditValue((current) => splitList(current).filter((item) => item !== 'none').join('、'))
    setCustomMedicalInput('')
    setEditingMedical('')
  }

  const removeCustomMedical = async (value: string) => {
    const confirmed = await dialog.confirm({
      title: '删除确认',
      message: `确定要删除「${value}」吗？`,
      confirmText: '删除',
      cancelText: '取消',
      kind: 'danger',
    })
    if (!confirmed) return
    setCustomMedicalOptions((current) => current.filter((item) => item !== value))
    setSelectedCustomMedical((current) => current.filter((item) => item !== value))
    if (editingMedical === value) {
      setEditingMedical('')
      setCustomMedicalInput('')
    }
  }

  const saveCustomAllergy = async () => {
    const nextValue = customAllergyInput.trim()
    if (!nextValue) {
      await dialog.alert('请输入过敏源名称', undefined, 'warning')
      return
    }
    if ((customAllergyOptions.includes(nextValue) && nextValue !== editingAllergy) || allergyPresetValues.has(nextValue as never)) {
      await dialog.alert('该过敏源已存在', undefined, 'warning')
      return
    }
    setCustomAllergyOptions((current) => editingAllergy ? current.map((item) => item === editingAllergy ? nextValue : item) : [...current, nextValue])
    setSelectedCustomAllergy((current) => {
      const withoutOld = current.filter((item) => item !== editingAllergy)
      return withoutOld.includes(nextValue) ? withoutOld : [...withoutOld, nextValue]
    })
    setEditValue((current) => splitList(current).filter((item) => item !== 'none').join('、'))
    setCustomAllergyInput('')
    setEditingAllergy('')
  }

  const removeCustomAllergy = async (value: string) => {
    const confirmed = await dialog.confirm({
      title: '删除确认',
      message: `确定要删除「${value}」吗？`,
      confirmText: '删除',
      cancelText: '取消',
      kind: 'danger',
    })
    if (!confirmed) return
    setCustomAllergyOptions((current) => current.filter((item) => item !== value))
    setSelectedCustomAllergy((current) => current.filter((item) => item !== value))
    if (editingAllergy === value) {
      setEditingAllergy('')
      setCustomAllergyInput('')
    }
  }
  const handleRefill = async () => {
    const confirmed = await dialog.confirm({
      title: '重新填写',
      message: '将前往答题页面重新填写健康档案。确定继续吗？',
      confirmText: '继续',
      cancelText: '取消',
      kind: 'info',
    })
    if (confirmed) navigation.navigate('HealthProfile')
  }

  const submitReportImages = async (assets: ImagePicker.ImagePickerAsset[]) => {
    if (assets.length === 0) return
    setSaving(true)
    try {
      const urls: string[] = []
      for (const asset of assets.slice(0, 9)) {
        const base64Image = await readImageAsBase64DataUrl(asset.uri, asset.mimeType || 'image/jpeg')
        const uploaded = await apiClient.uploadHealthReportImage({ base64Image })
        urls.push(uploaded.imageUrl)
      }
      const task = await apiClient.submitReportExtractionTask({ imageUrl: urls[0], imageUrls: urls })
      applyReportProcessing(urls)
      setReportNotice(`已上传 ${urls.length} 张报告，识别完成后会自动刷新。`)
      await dialog.alert('已提交识别', '报告正在后台识别，完成后会自动刷新到健康档案。', 'success')
      void pollReportTaskUntilSettled(task.taskId)
    } catch (error) {
      await showError('上传报告失败', error)
    } finally {
      setSaving(false)
    }
  }

  const pickReportFromAlbum = async () => {
    setReportSourceVisible(false)
    // Android 13+ 的系统 Photo Picker 无需申请整个相册权限。提前申请会
    // 把选择器限制为“仅允许访问已选照片”，导致新保存的报告不可见。
    const picked = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      selectionLimit: 9,
      quality: 0.86,
    })
    if (picked.canceled || picked.assets.length === 0) return
    await submitReportImages(picked.assets)
  }

  const takeReportPhoto = async () => {
    setReportSourceVisible(false)
    const permission = await ImagePicker.requestCameraPermissionsAsync()
    if (!permission.granted) {
      await dialog.alert('需要相机权限', '请允许使用相机拍摄体检报告或病例。', 'warning')
      return
    }
    const picked = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images'],
      quality: 0.86,
    })
    if (picked.canceled || picked.assets.length === 0) return
    await submitReportImages(picked.assets)
  }

  const chooseReportSource = () => {
    setReportSourceVisible(true)
  }

  const retryReportExtraction = async () => {
    const urls = reportImageUrls.length ? reportImageUrls : profile?.health_condition?.report_extract?._image_urls || []
    if (!urls.length) {
      await dialog.alert('请先上传报告图片', undefined, 'warning')
      return
    }
    setSaving(true)
    try {
      const task = await apiClient.submitReportExtractionTask({ imageUrl: urls[0], imageUrls: urls })
      applyReportProcessing(urls)
      setReportNotice('已重新提交报告识别，完成后会自动刷新。')
      await dialog.alert('已重新提交', '报告正在后台识别，完成后会自动刷新到健康档案。', 'success')
      void pollReportTaskUntilSettled(task.taskId)
    } catch (error) {
      await showError('重新识别失败', error)
    } finally {
      setSaving(false)
    }
  }

  const applyReportProcessing = (urls: string[]) => {
    const nextReport: HealthReportExtract = {
      indicators: [],
      conclusions: [],
      suggestions: [],
      medical_notes: '',
      _image_urls: urls,
      _status: 'processing',
      _error: '',
    }
    setReportImageUrls(urls)
    setProfile((current) => {
      if (!current) return current
      return {
        ...current,
        health_condition: {
          ...(current.health_condition || {}),
          report_extract: nextReport,
        },
      }
    })
  }

  const pollReportTaskUntilSettled = async (taskId: string) => {
    const id = taskId.trim()
    if (!id) return
    setReportPolling(true)
    const startedAt = Date.now()
    try {
      while (Date.now() - startedAt < REPORT_TASK_POLL_TIMEOUT_MS) {
        await sleep(REPORT_TASK_POLL_INTERVAL_MS)
        try {
          const task = await apiClient.getAnalyzeTask(id)
          if (isTerminalTaskStatus(task.status)) {
            await load().catch(() => undefined)
            if (task.status === 'done') {
              setReportNotice('报告识别完成，结果已刷新。')
            } else {
              setReportNotice(userFacingMessage(task.error_message, '报告识别没有成功，可以重新上传或重试。'))
            }
            return
          }
        } catch {
          // Network glitches should not abort the background polling loop.
        }
      }
      await load().catch(() => undefined)
      setReportNotice('报告识别尚未完成，可稍后下拉刷新查看结果。')
    } finally {
      setReportPolling(false)
    }
  }

  const report = profile?.health_condition?.report_extract
  const medicalHistory = profile?.health_condition?.medical_history || []
  const dietPreference = profile?.health_condition?.diet_preference || []
  const allergies = profile?.health_condition?.allergies || []
  const routineRaw = profile?.health_condition?.routine_type
  const parsedRoutine = parseRoutineHours(routineRaw)
  const routineDisplay = routineRaw ? formatRoutineHours(parsedRoutine.sleepHour, parsedRoutine.wakeHour) : '--'
  const reportSummaryValue = reportStatusValue(report)

  const renderEditorBody = () => {
    if (!editingField) return null
    if (editingField === 'report_extract') {
      return (
        <View style={styles.editorReportBody}>
          <ReportSummary report={report} palette={palette} />
          {reportImageUrls.length ? <ReportImageGrid urls={reportImageUrls} /> : null}
          <ActionButton label={reportImageUrls.length ? '上传新报告' : '上传报告'} loading={saving} onPress={chooseReportSource} palette={palette} />
          {reportImageUrls.length ? <ActionButton label="重新识别当前报告" variant="secondary" loading={saving} onPress={retryReportExtraction} palette={palette} /> : null}
        </View>
      )
    }
    if (editingField === 'birthday') {
      return <DatePartsEditor year={editYear} month={editMonth} day={editDay} onYearChange={setEditYear} onMonthChange={setEditMonth} onDayChange={setEditDay} palette={palette} />
    }
    if (editingField === 'routine_type') {
      return <RoutineEditor sleepHour={editSleepHour} wakeHour={editWakeHour} onSleepChange={setEditSleepHour} onWakeChange={setEditWakeHour} palette={palette} />
    }
    const choices = choiceOptionsFor(editingField)
    if (choices) {
      return (
        <ChoiceList
          value={editValue}
          options={choices}
          onChange={(value) => void handleChoiceChange(value)}
          lockedValue={editingField === 'execution_mode' && !canUseStrictModeForMembership(membership) ? 'strict' : undefined}
          palette={palette}
        />
      )
    }
    const multiChoices = multiOptionsFor(editingField)
    if (multiChoices) {
      const isMedical = editingField === 'medical_history'
      const isAllergy = editingField === 'allergies'
      return (
        <View>
          <MultiChoiceGrid value={splitList(editValue)} options={multiChoices} onChange={handlePresetMultiChange} palette={palette} />
          {isMedical ? (
            <CustomChoiceEditor
              noun="病史"
              options={customMedicalOptions}
              selected={selectedCustomMedical}
              inputValue={customMedicalInput}
              editingValue={editingMedical}
              onToggle={(item) => {
                setSelectedCustomMedical((current) => current.includes(item) ? current.filter((value) => value !== item) : [...current, item])
                setEditValue((current) => splitList(current).filter((value) => value !== 'none').join('、'))
              }}
              onInputChange={setCustomMedicalInput}
              onEdit={(item) => { setEditingMedical(item); setCustomMedicalInput(item) }}
              onCancelEdit={() => { setEditingMedical(''); setCustomMedicalInput('') }}
              onSave={() => void saveCustomMedical()}
              onRemove={(item) => void removeCustomMedical(item)}
              palette={palette}
            />
          ) : null}
          {isAllergy ? (
            <CustomChoiceEditor
              noun="过敏源"
              options={customAllergyOptions}
              selected={selectedCustomAllergy}
              inputValue={customAllergyInput}
              editingValue={editingAllergy}
              onToggle={(item) => {
                setSelectedCustomAllergy((current) => current.includes(item) ? current.filter((value) => value !== item) : [...current, item])
                setEditValue((current) => splitList(current).filter((value) => value !== 'none').join('、'))
              }}
              onInputChange={setCustomAllergyInput}
              onEdit={(item) => { setEditingAllergy(item); setCustomAllergyInput(item) }}
              onCancelEdit={() => { setEditingAllergy(''); setCustomAllergyInput('') }}
              onSave={() => void saveCustomAllergy()}
              onRemove={(item) => void removeCustomAllergy(item)}
              palette={palette}
            />
          ) : null}
        </View>
      )
    }
    return (
      <Field
        label={fieldHint(editingField)}
        value={editValue}
        onChangeText={setEditValue}
        multiline={editingField === 'health_notes'}
        keyboardType={editingField === 'height' || editingField === 'weight' ? 'decimal-pad' : 'default'}
        placeholder={fieldHint(editingField)}
        maxLength={editingField === 'health_notes' ? 500 : 200}
        palette={palette}
      />
    )
  }

  return (
    <>
      <View style={[styles.page, { backgroundColor: palette.page }]}>
        {loading && !profile ? (
          <View style={styles.centerState} accessibilityLabel="正在读取健康档案">
            <ActivityIndicator color={palette.brand} />
          </View>
        ) : !profile ? (
          <View style={styles.centerState}>
            <Text style={[styles.errorText, { color: palette.textSecondary }]}>{loadError || '暂无健康档案'}</Text>
            <ActionButton
              label={loadError ? '重新加载' : '去填写'}
              onPress={loadError ? () => void load() : () => navigation.navigate('HealthProfile')}
              palette={palette}
            />
          </View>
        ) : (
          <ScrollView
            style={styles.scroll}
            contentContainerStyle={[styles.scrollContent, { paddingBottom: Math.max(insets.bottom, 16) + 28 }]}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {loadError ? (
              <Pressable
                style={({ pressed }) => [styles.refreshErrorBanner, { backgroundColor: palette.dangerSoft, borderColor: palette.danger }, pressed && styles.pressed]}
                onPress={() => void load()}
                accessibilityRole="button"
                accessibilityLabel={`刷新失败，${loadError}，点击重试`}
              >
                <Text style={[styles.refreshErrorText, { color: palette.danger }]}>刷新失败：{loadError}</Text>
                <Text style={[styles.refreshErrorAction, { color: palette.danger }]}>重试</Text>
              </Pressable>
            ) : null}
            <InfoBlock title="基础信息" palette={palette}>
              <EditableRow label="性别" value={labelValue(profile.gender, genderLabel)} onPress={() => openEditor('gender', profile.gender)} palette={palette} />
              <EditableRow label="出生日期" value={formatDateOnly(profile.birthday)} onPress={() => openEditor('birthday', profile.birthday)} palette={palette} />
              <EditableRow label="身高" value={profile.height != null ? `${profile.height} cm` : '--'} onPress={() => openEditor('height', profile.height)} palette={palette} />
              <EditableRow label="体重" value={profile.weight != null ? `${profile.weight} kg` : '--'} onPress={() => openEditor('weight', profile.weight)} palette={palette} />
              <EditableRow label="饮食目标" value={labelValue(profile.diet_goal, goalLabel)} highlight onPress={() => openEditor('diet_goal', profile.diet_goal)} palette={palette} />
              <EditableRow
                label="日常活动"
                value={labelValue(profile.health_condition?.daily_life_activity_level || profile.activity_level, activityLabel)}
                onPress={() => openEditor('daily_life_activity_level', profile.health_condition?.daily_life_activity_level || profile.activity_level)}
                palette={palette}
              />
              <EditableRow label="作息习惯" value={routineDisplay} onPress={() => openEditor('routine_type', routineDisplay)} palette={palette} />
              <EditableRow label="执行模式" value={executionModeLabel(profile.execution_mode)} onPress={() => openEditor('execution_mode', normalizeExecutionMode(profile.execution_mode))} palette={palette} />
            </InfoBlock>

            {profile.bmr != null || profile.tdee != null ? (
              <InfoBlock title="代谢数据" palette={palette}>
                {profile.bmr != null ? <InfoRow label="BMR（基础代谢率）" value={`${Math.round(profile.bmr)} kcal/天`} palette={palette} /> : null}
                {profile.tdee != null ? <InfoRow label="日常消耗估算" value={`${Math.round(profile.tdee)} kcal/天`} palette={palette} /> : null}
              </InfoBlock>
            ) : null}

            <InfoBlock title="病史与饮食" palette={palette}>
              <EditableRow label="既往病史" value={listLabel(medicalHistory, medicalLabel)} onPress={() => openEditor('medical_history', medicalHistory)} palette={palette} />
              <EditableRow label="饮食偏好" value={listLabel(dietPreference, dietPreferenceLabel)} onPress={() => openEditor('diet_preference', dietPreference)} palette={palette} />
              <EditableRow label="过敏源" value={listLabel(allergies, allergyLabel)} onPress={() => openEditor('allergies', allergies)} palette={palette} />
              <EditableRow label="特殊情况和补充" value={String(profile.health_condition?.health_notes || '无')} onPress={() => openEditor('health_notes', profile.health_condition?.health_notes)} column palette={palette} />
            </InfoBlock>

            <InfoBlock title="体检/病例识别结果" palette={palette}>
              {reportNotice ? (
                <View style={[styles.reportStatusCard, { backgroundColor: palette.brandSoft }]} accessibilityRole="alert">
                  {reportPolling ? <ActivityIndicator size="small" color={palette.brand} /> : null}
                  <Text style={[styles.reportStatusText, { color: palette.brandOnSoft }]}>{reportNotice}</Text>
                </View>
              ) : null}
              {reportSummaryValue ? (
                <EditableRow label="报告结果" value={reportSummaryValue} highlight={reportSummaryValue === '查看结果'} onPress={() => openEditor('report_extract', report)} palette={palette} />
              ) : (
                <Pressable
                  style={({ pressed }) => [styles.reportUploadTrigger, { borderColor: palette.border, backgroundColor: palette.surfaceMuted }, pressed && styles.pressed]}
                  onPress={chooseReportSource}
                  disabled={saving}
                  accessibilityRole="button"
                  accessibilityLabel="上传体检报告，支持 JPG 或 PNG，最多 9 张"
                  accessibilityState={{ disabled: saving, busy: saving }}
                >
                  <View style={[styles.reportUploadIcon, { backgroundColor: palette.brandSoft }]}>
                    <Upload size={22} color={palette.brandStrong} strokeWidth={2.2} />
                  </View>
                  <Text style={[styles.reportUploadTitle, { color: palette.text }]}>点击上传体检报告</Text>
                  <Text style={[styles.reportUploadDesc, { color: palette.textMuted }]}>支持 JPG / PNG 格式，最多 9 张</Text>
                </Pressable>
              )}
            </InfoBlock>

            <View style={styles.footerActions}>
              <ActionButton label="重新填写" variant="secondary" onPress={handleRefill} palette={palette} />
            </View>
          </ScrollView>
        )}

        <Modal visible={!!editingField} transparent animationType="fade" onRequestClose={closeEditor} statusBarTranslucent>
          <KeyboardAvoidingView style={styles.editorModal} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <Pressable style={[styles.editorMask, { backgroundColor: palette.scrim }]} onPress={closeEditor} accessibilityRole="button" accessibilityLabel="关闭编辑器" />
            <View style={[styles.editorContent, { backgroundColor: palette.surfaceRaised, borderColor: palette.border, paddingBottom: Math.max(insets.bottom, 12) + 8 }]}>
              <View style={[styles.editorHeader, { borderBottomColor: palette.divider }]}>
                <Pressable onPress={closeEditor} style={({ pressed }) => [styles.editorHeaderButton, pressed && styles.pressed]} accessibilityRole="button" accessibilityLabel="取消编辑">
                  <Text style={[styles.editorCancel, { color: palette.textSecondary }]}>取消</Text>
                </Pressable>
                <Text style={[styles.editorTitle, { color: palette.text }]} numberOfLines={2}>{editingField ? fieldLabels[editingField] : ''}</Text>
                <Pressable onPress={() => void saveField()} disabled={saving} style={({ pressed }) => [styles.editorHeaderButton, pressed && !saving && styles.pressed]} accessibilityRole="button" accessibilityLabel={editingField === 'report_extract' ? '完成' : '保存修改'} accessibilityState={{ disabled: saving, busy: saving }}>
                  {saving ? <ActivityIndicator size="small" color={palette.brand} /> : <Text style={[styles.editorConfirm, { color: palette.brandStrong }]}>{editingField === 'report_extract' ? '完成' : '确定'}</Text>}
                </Pressable>
              </View>
              <ScrollView style={styles.editorBody} contentContainerStyle={styles.editorBodyContent} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
                {renderEditorBody()}
              </ScrollView>
            </View>
          </KeyboardAvoidingView>
        </Modal>
      </View>

      <Modal visible={reportSourceVisible} transparent animationType="fade" onRequestClose={() => setReportSourceVisible(false)} statusBarTranslucent>
        <Pressable style={[styles.sourceBackdrop, { backgroundColor: palette.scrim }]} onPress={() => setReportSourceVisible(false)} accessibilityRole="button" accessibilityLabel="关闭图片来源选择">
          <Pressable style={[styles.sourceSheet, { backgroundColor: palette.surfaceRaised, paddingBottom: Math.max(insets.bottom, 16) + 14 }]} onPress={(event) => event.stopPropagation?.()}>
            <View style={[styles.sourceHandle, { backgroundColor: palette.handle }]} />
            <Text style={[styles.sourceTitle, { color: palette.text }]}>上传体检/病例报告</Text>
            <Text style={[styles.sourceSubtitle, { color: palette.textSecondary }]}>请选择图片来源，拍摄时才会申请相机权限。</Text>
            <Pressable style={({ pressed }) => [styles.sourcePrimary, { backgroundColor: palette.brand }, pressed && styles.pressed]} onPress={() => void takeReportPhoto()} accessibilityRole="button" accessibilityLabel="拍摄体检报告">
              <Camera size={20} color="#ffffff" />
              <Text style={styles.sourcePrimaryText}>拍摄</Text>
            </Pressable>
            <Pressable style={({ pressed }) => [styles.sourceSecondary, { backgroundColor: palette.secondaryButton, borderColor: palette.border }, pressed && styles.pressed]} onPress={() => void pickReportFromAlbum()} accessibilityRole="button" accessibilityLabel="从手机相册选择体检报告">
              <ImageIcon size={20} color={palette.secondaryButtonText} />
              <Text style={[styles.sourceSecondaryText, { color: palette.secondaryButtonText }]}>从手机相册选择</Text>
            </Pressable>
            <Pressable style={({ pressed }) => [styles.sourceCancel, pressed && styles.pressed]} onPress={() => setReportSourceVisible(false)} accessibilityRole="button" accessibilityLabel="取消上传体检报告">
              <Text style={[styles.sourceCancelText, { color: palette.textSecondary }]}>取消</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  )
}

function InfoBlock({ title, children, palette }: { title: string; children: React.ReactNode; palette: HealthProfileViewPalette }) {
  return (
    <View style={[styles.block, { backgroundColor: palette.surface, borderColor: palette.border }]}>
      <Text style={[styles.blockTitle, { color: palette.text }]} accessibilityRole="header">{title}</Text>
      {children}
    </View>
  )
}

function EditableRow({
  label,
  value,
  onPress,
  palette,
  column,
  highlight,
}: {
  label: string
  value: string
  onPress: () => void
  palette: HealthProfileViewPalette
  column?: boolean
  highlight?: boolean
}) {
  return (
    <Pressable
      style={({ pressed }) => [styles.row, { borderBottomColor: palette.divider }, column && styles.rowColumn, pressed && { backgroundColor: palette.surfacePressed }]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${label}，${value}`}
      accessibilityHint="双击编辑"
    >
      <Text style={[styles.rowLabel, { color: palette.textSecondary }]}>{label}</Text>
      <View style={[styles.rowValueWrap, column && styles.rowValueWrapColumn]}>
        <Text style={[styles.rowValue, { color: highlight ? palette.brandStrong : palette.text }, column && styles.rowValueColumn, highlight && styles.rowValueHighlight]} numberOfLines={column ? 5 : 3}>{value}</Text>
        <ChevronRight size={18} color={palette.textMuted} strokeWidth={2.2} accessibilityElementsHidden />
      </View>
    </Pressable>
  )
}

function InfoRow({ label, value, palette }: { label: string; value: string; palette: HealthProfileViewPalette }) {
  return (
    <View style={[styles.row, { borderBottomColor: palette.divider }]} accessibilityLabel={`${label}，${value}`}>
      <Text style={[styles.rowLabel, { color: palette.textSecondary }]}>{label}</Text>
      <View style={styles.rowValueWrap}>
        <Text style={[styles.rowValue, { color: palette.text }]}>{value}</Text>
      </View>
    </View>
  )
}

function ChoiceList({
  value,
  options,
  onChange,
  lockedValue,
  palette,
}: {
  value: string
  options: ReadonlyArray<ChoiceOption>
  onChange: (value: string) => void
  lockedValue?: string
  palette: HealthProfileViewPalette
}) {
  return (
    <View style={styles.choiceList} accessibilityRole="radiogroup">
      {options.map((option) => {
        const active = value === option.value
        const locked = lockedValue === option.value
        return (
          <Pressable
            key={option.value || 'empty'}
            style={({ pressed }) => [styles.choiceItem, { borderBottomColor: palette.divider }, active && { backgroundColor: palette.brandSoft }, pressed && { backgroundColor: palette.surfacePressed }]}
            onPress={() => onChange(option.value)}
            accessibilityRole="radio"
            accessibilityState={{ checked: active }}
            accessibilityLabel={locked ? `${option.label}，会员功能` : option.label}
            accessibilityHint={locked ? '双击查看会员方案' : undefined}
          >
            <View style={styles.choiceCopy}>
              <Text style={[styles.choiceText, { color: active ? palette.brandStrong : palette.text }, active && styles.choiceTextActive]}>{option.label}</Text>
              {locked ? (
                <View style={[styles.lockBadge, { backgroundColor: palette.surfaceMuted }]}>
                  <LockKeyhole size={13} color={palette.textSecondary} />
                  <Text style={[styles.lockBadgeText, { color: palette.textSecondary }]}>会员</Text>
                </View>
              ) : null}
            </View>
            <View style={[styles.radioRing, { borderColor: active ? palette.brand : palette.border }, active && { backgroundColor: palette.brand }]}>
              {active ? <View style={styles.radioCenter} /> : null}
            </View>
          </Pressable>
        )
      })}
    </View>
  )
}

function MultiChoiceGrid({
  value,
  options,
  onChange,
  palette,
}: {
  value: string[]
  options: ReadonlyArray<ChoiceOption>
  onChange: (value: string[]) => void
  palette: HealthProfileViewPalette
}) {
  const selected = value
  const toggle = (option: ChoiceOption) => {
    if (option.value === 'none') {
      onChange(['none'])
      return
    }
    const withoutNone = selected.filter((item) => item !== 'none')
    const next = withoutNone.includes(option.value)
      ? withoutNone.filter((item) => item !== option.value)
      : [...withoutNone, option.value]
    onChange(next)
  }
  return (
    <View style={styles.multiGrid}>
      {options.map((option) => {
        const active = selected.includes(option.value)
        return (
          <Pressable
            key={option.value}
            style={({ pressed }) => [styles.multiItem, { borderColor: active ? palette.brand : palette.border, backgroundColor: active ? palette.brandSoft : palette.surfaceMuted }, pressed && styles.pressed]}
            onPress={() => toggle(option)}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: active }}
            accessibilityLabel={option.label}
          >
            <View style={[styles.multiDot, { borderColor: active ? palette.brand : palette.textMuted }, active && { backgroundColor: palette.brand }]}>
              {active ? <Check size={13} color="#ffffff" strokeWidth={3} /> : null}
            </View>
            <Text style={[styles.multiText, { color: active ? palette.text : palette.textSecondary }, active && styles.multiTextActive]}>{option.label}</Text>
          </Pressable>
        )
      })}
    </View>
  )
}

function CustomChoiceEditor({
  noun,
  options,
  selected,
  inputValue,
  editingValue,
  onToggle,
  onInputChange,
  onEdit,
  onCancelEdit,
  onSave,
  onRemove,
  palette,
}: {
  noun: string
  options: string[]
  selected: string[]
  inputValue: string
  editingValue: string
  onToggle: (item: string) => void
  onInputChange: (value: string) => void
  onEdit: (item: string) => void
  onCancelEdit: () => void
  onSave: () => void
  onRemove: (item: string) => void
  palette: HealthProfileViewPalette
}) {
  return (
    <View style={styles.customSection}>
      {options.length ? <Text style={[styles.customSectionLabel, { color: palette.textSecondary }]}>自定义{noun}</Text> : null}
      {options.map((item) => {
        const active = selected.includes(item)
        return (
          <View key={item} style={styles.customOptionRow}>
            <Pressable
              style={({ pressed }) => [styles.customOptionChoice, { borderColor: active ? palette.brand : palette.border, backgroundColor: active ? palette.brandSoft : palette.surfaceMuted }, pressed && styles.pressed]}
              onPress={() => onToggle(item)}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: active }}
              accessibilityLabel={item}
            >
              <View style={[styles.multiDot, { borderColor: active ? palette.brand : palette.textMuted }, active && { backgroundColor: palette.brand }]}>
                {active ? <Check size={13} color="#ffffff" strokeWidth={3} /> : null}
              </View>
              <Text style={[styles.customOptionText, { color: palette.text }]} numberOfLines={2}>{item}</Text>
            </Pressable>
            <Pressable style={({ pressed }) => [styles.customIconButton, { backgroundColor: palette.secondaryButton, borderColor: palette.border }, pressed && styles.pressed]} onPress={() => onEdit(item)} accessibilityRole="button" accessibilityLabel={`编辑${noun}${item}`}>
              <Edit3 size={18} color={palette.secondaryButtonText} />
            </Pressable>
            <Pressable style={({ pressed }) => [styles.customIconButton, { backgroundColor: palette.dangerSoft, borderColor: palette.dangerSoft }, pressed && styles.pressed]} onPress={() => onRemove(item)} accessibilityRole="button" accessibilityLabel={`删除${noun}${item}`}>
              <Trash2 size={18} color={palette.danger} />
            </Pressable>
          </View>
        )
      })}
      <Text style={[styles.customSectionLabel, { color: palette.textSecondary }]}>{editingValue ? `修改${noun}` : `添加其他${noun}`}</Text>
      <View style={[styles.customInputRow, { backgroundColor: palette.input, borderColor: palette.border }]}>
        <TextInput
          value={inputValue}
          onChangeText={onInputChange}
          placeholder={`输入${noun}名称`}
          placeholderTextColor={palette.textMuted}
          style={[styles.customInput, { color: palette.text }]}
          maxLength={40}
          returnKeyType="done"
          onSubmitEditing={onSave}
          accessibilityLabel={`自定义${noun}名称`}
        />
        {editingValue ? (
          <Pressable style={styles.customInlineButton} onPress={onCancelEdit} accessibilityRole="button" accessibilityLabel={`取消编辑${noun}`}>
            <X size={18} color={palette.textSecondary} />
          </Pressable>
        ) : null}
        <Pressable style={({ pressed }) => [styles.customSaveButton, { backgroundColor: palette.brand }, pressed && styles.pressed]} onPress={onSave} accessibilityRole="button" accessibilityLabel={editingValue ? `保存${noun}修改` : `添加${noun}`}>
          {editingValue ? <Check size={19} color="#ffffff" /> : <Plus size={19} color="#ffffff" />}
        </Pressable>
      </View>
    </View>
  )
}

function DatePartsEditor({ year, month, day, onYearChange, onMonthChange, onDayChange, palette }: {
  year: string
  month: string
  day: string
  onYearChange: (value: string) => void
  onMonthChange: (value: string) => void
  onDayChange: (value: string) => void
  palette: HealthProfileViewPalette
}) {
  return (
    <View>
      <Text style={[styles.fieldLabel, { color: palette.textSecondary }]}>出生日期</Text>
      <View style={styles.datePartsRow}>
        <CompactNumberField label="年" value={year} onChange={onYearChange} maxLength={4} palette={palette} />
        <CompactNumberField label="月" value={month} onChange={onMonthChange} maxLength={2} palette={palette} />
        <CompactNumberField label="日" value={day} onChange={onDayChange} maxLength={2} palette={palette} />
      </View>
      <Text style={[styles.helperText, { color: palette.textMuted }]}>用于计算年龄和营养建议，不会公开展示。</Text>
    </View>
  )
}

function RoutineEditor({ sleepHour, wakeHour, onSleepChange, onWakeChange, palette }: {
  sleepHour: string
  wakeHour: string
  onSleepChange: (value: string) => void
  onWakeChange: (value: string) => void
  palette: HealthProfileViewPalette
}) {
  return (
    <View>
      <Text style={[styles.fieldLabel, { color: palette.textSecondary }]}>日常作息</Text>
      <View style={styles.routineFieldsRow}>
        <CompactNumberField label="睡觉" value={sleepHour} onChange={onSleepChange} maxLength={2} palette={palette} />
        <CompactNumberField label="起床" value={wakeHour} onChange={onWakeChange} maxLength={2} palette={palette} />
      </View>
      <View style={[styles.routinePreview, { backgroundColor: palette.brandSoft }]}>
        <Text style={[styles.routinePreviewText, { color: palette.brandOnSoft }]}>{formatRoutinePreview(sleepHour, wakeHour)}</Text>
      </View>
      <Text style={[styles.helperText, { color: palette.textMuted }]}>请填写 0-23 的整点数字，例如 23 点睡、7 点起。</Text>
    </View>
  )
}

function CompactNumberField({ label, value, onChange, maxLength, palette }: {
  label: string
  value: string
  onChange: (value: string) => void
  maxLength: number
  palette: HealthProfileViewPalette
}) {
  return (
    <View style={styles.compactField}>
      <TextInput
        value={value}
        onChangeText={(next) => onChange(next.replace(/\D/g, '').slice(0, maxLength))}
        keyboardType="number-pad"
        maxLength={maxLength}
        selectTextOnFocus
        style={[styles.compactInput, { color: palette.text, backgroundColor: palette.input, borderColor: palette.border }]}
        accessibilityLabel={label}
      />
      <Text style={[styles.compactUnit, { color: palette.textSecondary }]}>{label}</Text>
    </View>
  )
}

function Field({
  label,
  value,
  onChangeText,
  keyboardType,
  multiline,
  placeholder,
  maxLength,
  palette,
}: {
  label: string
  value: string
  onChangeText: (value: string) => void
  keyboardType?: 'default' | 'decimal-pad' | 'number-pad'
  multiline?: boolean
  placeholder?: string
  maxLength?: number
  palette: HealthProfileViewPalette
}) {
  return (
    <View style={styles.field}>
      <Text style={[styles.fieldLabel, { color: palette.textSecondary }]}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        keyboardType={keyboardType}
        multiline={multiline}
        maxLength={maxLength}
        textAlignVertical={multiline ? 'top' : 'center'}
        placeholder={placeholder}
        placeholderTextColor={palette.textMuted}
        style={[styles.input, { color: palette.text, backgroundColor: palette.input, borderColor: palette.border }, multiline && styles.textarea]}
        accessibilityLabel={label}
      />
      {maxLength && multiline ? <Text style={[styles.characterCount, { color: palette.textMuted }]}>{value.length} / {maxLength}</Text> : null}
    </View>
  )
}

function ActionButton({
  label,
  onPress,
  palette,
  loading,
  variant = 'primary',
}: {
  label: string
  onPress: () => void
  palette: HealthProfileViewPalette
  loading?: boolean
  variant?: 'primary' | 'secondary'
}) {
  const secondary = variant === 'secondary'
  return (
    <Pressable
      style={({ pressed }) => [styles.actionButton, { backgroundColor: secondary ? palette.secondaryButton : palette.brand, borderColor: secondary ? palette.border : palette.brand }, loading && styles.actionButtonDisabled, pressed && !loading && styles.pressed]}
      onPress={onPress}
      disabled={loading}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: loading, busy: loading }}
    >
      {loading ? <ActivityIndicator size="small" color={secondary ? palette.brand : '#ffffff'} /> : <Text style={[styles.actionButtonText, { color: secondary ? palette.secondaryButtonText : '#ffffff' }]}>{label}</Text>}
    </Pressable>
  )
}

function ReportSummary({ report, palette }: { report?: HealthReportExtract; palette: HealthProfileViewPalette }) {
  const status = report?._status || ''
  const indicators = report?.indicators || []
  const conclusions = report?.conclusions || []
  const suggestions = report?.suggestions || []
  if (!report) {
    return <Text style={[styles.reportEmptyText, { color: palette.textSecondary }]}>上传体检报告后，AI 会提取指标、结论和建议。</Text>
  }
  if (status === 'processing') {
    return (
      <View style={[styles.editorReportStatus, { backgroundColor: palette.brandSoft }]} accessibilityRole="alert">
        <ActivityIndicator size="small" color={palette.brand} />
        <View style={styles.editorReportStatusCopy}>
          <Text style={[styles.editorReportStatusTitle, { color: palette.brandOnSoft }]}>新报告识别中</Text>
          <Text style={[styles.editorReportStatusDesc, { color: palette.textSecondary }]}>系统已收到报告，识别完成后会自动刷新当前结果。</Text>
        </View>
      </View>
    )
  }
  if (status === 'failed') {
    return (
      <View style={[styles.editorReportStatus, styles.editorReportStatusFailed, { backgroundColor: palette.dangerSoft }]} accessibilityRole="alert">
        <Text style={[styles.editorReportStatusTitleFailed, { color: palette.danger }]}>识别失败</Text>
        <Text style={[styles.editorReportStatusDescFailed, { color: palette.danger }]}>{report._error || '这次报告识别没有成功，可以重新上传后再试。'}</Text>
      </View>
    )
  }
  return (
    <View>
      {conclusions.length ? <ReportBlock title="诊断结论" lines={conclusions} palette={palette} /> : null}
      {indicators.length ? (
        <View style={styles.reportBlock}>
          <Text style={[styles.reportTitle, { color: palette.text }]}>提取指标</Text>
          {indicators.slice(0, 12).map((indicator, index) => (
            <View key={`${indicator.name || index}`} style={[styles.indicatorRow, { backgroundColor: palette.surfaceMuted }]}>
              <Text style={[styles.indicatorName, { color: palette.text }]}>{String(indicator.name || `指标 ${index + 1}`)}</Text>
              <Text style={[styles.indicatorValue, { color: indicator.flag ? palette.danger : palette.textSecondary }, indicator.flag ? styles.indicatorValueAbnormal : null]}>
                {`${indicator.value ?? '--'} ${indicator.unit || ''} ${indicator.flag || ''}`.trim()}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
      {suggestions.length ? <ReportBlock title="医学建议" lines={suggestions} palette={palette} /> : null}
      {report.medical_notes ? <ReportBlock title="其他记录" lines={[report.medical_notes]} palette={palette} /> : null}
      {!conclusions.length && !suggestions.length && !indicators.length && !report.medical_notes ? (
        <Text style={[styles.reportEmptyText, { color: palette.textSecondary }]}>暂无识别结果。</Text>
      ) : null}
    </View>
  )
}

function ReportBlock({ title, lines, palette }: { title: string; lines: string[]; palette: HealthProfileViewPalette }) {
  return (
    <View style={styles.reportBlock}>
      <Text style={[styles.reportTitle, { color: palette.text }]}>{title}</Text>
      {lines.map((line, index) => (
        <Text key={`${line}-${index}`} style={[styles.reportLine, { color: palette.textSecondary }]}>• {line}</Text>
      ))}
    </View>
  )
}

function ReportImageGrid({ urls }: { urls: string[] }) {
  return (
    <View style={styles.reportGrid}>
      {urls.slice(0, 9).map((url, index) => (
        <Image key={`${url}-${index}`} source={{ uri: url }} style={styles.reportImage} accessibilityLabel={`第 ${index + 1} 张体检报告`} />
      ))}
    </View>
  )
}

function buildHealthProfileFieldInput(field: Exclude<EditField, 'report_extract'>, value: string) {
  const trimmed = value.trim()
  switch (field) {
    case 'height':
    case 'weight':
      return { [field]: Number(trimmed) || undefined }
    case 'medical_history':
    case 'diet_preference':
    case 'allergies':
      return { [field]: healthListForSubmit(splitList(trimmed)) }
    case 'daily_life_activity_level':
      return { daily_life_activity_level: trimmed, activity_level: trimmed }
    case 'execution_mode':
      return { execution_mode: normalizeExecutionMode(trimmed) }
    default:
      return { [field]: trimmed }
  }
}

function splitList(value: string): string[] {
  return value.split(/[,\s，、]+/).map((item) => item.trim()).filter(Boolean)
}

function healthListForSubmit(value: string[]): string[] {
  const list = value.filter((item) => item && item !== 'none')
  return list.length ? list : ['none']
}

function formatEditValue(value: unknown): string {
  if (Array.isArray(value)) return value.length ? value.join('、') : 'none'
  return value == null ? '' : String(value)
}

function fieldHint(field: EditField): string {
  if (field === 'birthday') return 'YYYY-MM-DD'
  if (field === 'routine_type') return '例如：23:00-07:00'
  if (field === 'health_notes') return '例如：孕期、哺乳期、手术恢复期等'
  return fieldLabels[field]
}

function choiceOptionsFor(field: EditField): ReadonlyArray<ChoiceOption> | undefined {
  if (field === 'gender') return fieldChoiceOptions.gender
  if (field === 'diet_goal') return fieldChoiceOptions.diet_goal
  if (field === 'daily_life_activity_level') return fieldChoiceOptions.daily_life_activity_level
  if (field === 'execution_mode') return fieldChoiceOptions.execution_mode
  return undefined
}

function multiOptionsFor(field: EditField): ReadonlyArray<ChoiceOption> | undefined {
  if (field === 'medical_history') return fieldMultiOptions.medical_history
  if (field === 'diet_preference') return fieldMultiOptions.diet_preference
  if (field === 'allergies') return fieldMultiOptions.allergies
  return undefined
}

function reportStatusValue(report?: HealthReportExtract): string {
  if (!report) return ''
  const status = report._status || ''
  const hasData = Boolean(report.indicators?.length || report.conclusions?.length || report.suggestions?.length || report.medical_notes)
  if (status === 'failed') return '识别失败，请重试'
  if (status === 'processing' || (Boolean(report._image_urls?.length) && !hasData && status !== 'failed')) return '后台识别中…'
  return hasData ? '查看结果' : ''
}

function formatDateOnly(value?: string | null): string {
  const raw = String(value || '').trim()
  if (!raw) return '--'
  const match = raw.match(/^(\d{4}-\d{2}-\d{2})/)
  return match ? match[1] : raw
}

function listLabel(value: string[], formatter: (value: string) => string): string {
  const list = value.filter((item) => item && item !== 'none')
  return list.length ? list.map(formatter).join('、') : '无'
}

function labelValue(value: unknown, formatter: (value: string) => string): string {
  const raw = String(value || '').trim()
  return raw ? formatter(raw) : '--'
}

function genderLabel(value: string): string {
  return ({ male: '男', female: '女', other: '其他' } as Record<string, string>)[value] || value
}

function goalLabel(value: string): string {
  return ({ fat_loss: '减重', maintain: '保持', muscle_gain: '增重' } as Record<string, string>)[value] || value
}

function activityLabel(value: string): string {
  return ({
    sedentary: '久坐办公',
    light: '日常走动较多',
    moderate: '经常站立走动',
    active: '体力劳动',
    very_active: '高强度',
  } as Record<string, string>)[value] || value
}

function medicalLabel(value: string): string {
  return ({
    diabetes: '糖尿病',
    hypertension: '高血压',
    gout: '痛风',
    hyperlipidemia: '高血脂',
    thyroid: '甲状腺疾病',
  } as Record<string, string>)[value] || value
}

function dietPreferenceLabel(value: string): string {
  return ({
    keto: '生酮',
    vegetarian: '素食',
    vegan: '纯素',
    low_salt: '低盐',
    gluten_free: '无麸质',
  } as Record<string, string>)[value] || value
}

function allergyLabel(value: string): string {
  return ({
    seafood: '海鲜',
    peanut: '花生',
    milk: '牛奶',
    egg: '鸡蛋',
    mango: '芒果',
    alcohol: '酒精',
    spicy: '辣',
  } as Record<string, string>)[value] || value
}

function executionModeLabel(value?: string | null): string {
  const raw = normalizeExecutionMode(value)
  return ({ fast: '快速模式', standard: '普通模式', strict: '精准模式' } as Record<string, string>)[raw] || '普通模式'
}

function normalizeExecutionMode(value?: string | null): ExecutionMode {
  const raw = String(value || 'standard')
  if (raw.includes('fast') || raw === 'lite') return 'fast'
  if (raw.includes('strict') || raw.includes('gemini35')) return 'strict'
  return 'standard'
}

function isTerminalTaskStatus(status?: string): boolean {
  return status === 'done' || status === 'failed' || status === 'timed_out' || status === 'cancelled' || status === 'violated'
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function createHealthProfileViewPalette(isDark: boolean): HealthProfileViewPalette {
  return isDark
    ? {
        page: '#0d1312',
        surface: '#181f1d',
        surfaceRaised: '#1b2421',
        surfaceMuted: '#202b27',
        surfacePressed: 'rgba(110,231,183,0.10)',
        text: '#f2f7f4',
        textSecondary: '#b7c5bf',
        textMuted: '#83938c',
        border: '#2d3a35',
        divider: 'rgba(255,255,255,0.08)',
        brand: '#5fc59c',
        brandStrong: '#7dd3b0',
        brandSoft: '#203a31',
        brandOnSoft: '#9fe4c6',
        input: '#202a27',
        secondaryButton: '#252f2c',
        secondaryButtonText: '#d6e0db',
        handle: '#45554f',
        danger: '#fda4af',
        dangerSoft: '#43272c',
        scrim: 'rgba(0,0,0,0.62)',
      }
    : {
        page: '#f5f6f8',
        surface: '#ffffff',
        surfaceRaised: '#ffffff',
        surfaceMuted: '#f8fafc',
        surfacePressed: '#f1f5f9',
        text: '#1a1a1a',
        textSecondary: '#64748b',
        textMuted: '#94a3b8',
        border: '#e2e8f0',
        divider: '#eef2f7',
        brand: '#00bc7d',
        brandStrong: '#008d60',
        brandSoft: '#eaf8f2',
        brandOnSoft: '#047857',
        input: '#f8fafc',
        secondaryButton: '#f5f7fa',
        secondaryButtonText: '#475569',
        handle: '#cbd5e1',
        danger: '#dc2626',
        dangerSoft: '#fff1f2',
        scrim: 'rgba(0,0,0,0.52)',
      }
}

function parseDateParts(raw: string): { year: string; month: string; day: string } {
  const match = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)
  if (!match) return { year: '2000', month: '1', day: '1' }
  return { year: match[1], month: String(Number(match[2])), day: String(Number(match[3])) }
}

function validDateFromParts(yearText: string, monthText: string, dayText: string): string | null {
  const year = Number(yearText)
  const month = Number(monthText)
  const day = Number(dayText)
  const currentYear = new Date().getFullYear()
  if (!Number.isInteger(year) || year < 1900 || year > currentYear || !Number.isInteger(month) || month < 1 || month > 12 || !Number.isInteger(day) || day < 1 || day > 31) return null
  const date = new Date(year, month - 1, day)
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day || date.getTime() > Date.now()) return null
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function parseRoutineHours(raw: unknown): { sleepHour: number; wakeHour: number } {
  const matches = String(raw || '').match(/\d{1,2}/g)?.map(Number).filter(isValidRoutineHour) || []
  return { sleepHour: matches[0] ?? 23, wakeHour: matches[1] ?? 7 }
}

function isValidRoutineHour(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= 23
}

function formatRoutineHours(sleepHour: number, wakeHour: number): string {
  return `${String(sleepHour).padStart(2, '0')}:00 睡，${String(wakeHour).padStart(2, '0')}:00 起`
}

function formatRoutinePreview(sleepText: string, wakeText: string): string {
  const sleepHour = Number(sleepText)
  const wakeHour = Number(wakeText)
  return isValidRoutineHour(sleepHour) && isValidRoutineHour(wakeHour)
    ? formatRoutineHours(sleepHour, wakeHour)
    : '请填写 0-23 的整点时间'
}

function canUseStrictModeForMembership(status: MembershipStatus | null): boolean {
  if (!status?.is_pro) return false
  const planCode = String(status.current_plan_code || '').trim()
  return planCode.startsWith('standard_') || planCode.startsWith('advanced_')
}
const styles = StyleSheet.create({
  page: {
    flex: 1,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 12,
    paddingTop: 12,
  },
  centerState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  errorText: {
    maxWidth: 320,
    fontSize: 15,
    lineHeight: 23,
    marginBottom: 18,
    textAlign: 'center',
  },
  refreshErrorBanner: {
    minHeight: 48,
    marginBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 14,
    borderWidth: 1,
  },
  refreshErrorText: {
    flex: 1,
    minWidth: 0,
    fontSize: 13,
    lineHeight: 19,
  },
  refreshErrorAction: {
    fontSize: 13,
    fontWeight: '800',
  },  block: {
    marginBottom: 12,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 4,
    borderRadius: 16,
    borderWidth: 1,
    shadowColor: '#000000',
    shadowOpacity: 0.05,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  blockTitle: {
    fontSize: 17,
    lineHeight: 24,
    fontWeight: '800',
    marginBottom: 8,
  },
  row: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
  },
  rowColumn: {
    alignItems: 'flex-start',
    flexDirection: 'column',
    gap: 8,
  },
  rowLabel: {
    flexBasis: 100,
    maxWidth: '42%',
    flexShrink: 1,
    marginRight: 14,
    fontSize: 14,
    lineHeight: 21,
  },
  rowValueWrap: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  rowValueWrapColumn: {
    width: '100%',
  },
  rowValue: {
    flex: 1,
    minWidth: 0,
    fontSize: 14,
    lineHeight: 21,
    textAlign: 'left',
  },
  rowValueColumn: {
    textAlign: 'left',
  },
  rowValueHighlight: {
    fontWeight: '800',
  },
  footerActions: {
    paddingVertical: 12,
  },
  actionButton: {
    minHeight: 50,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
  },
  actionButtonDisabled: {
    opacity: 0.5,
  },
  actionButtonText: {
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '800',
  },
  pressed: {
    opacity: 0.72,
  },
  reportStatusCard: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 12,
  },
  reportStatusText: {
    flex: 1,
    lineHeight: 20,
    fontWeight: '700',
  },
  reportUploadTrigger: {
    minHeight: 154,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    paddingHorizontal: 16,
    paddingVertical: 22,
    marginBottom: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderStyle: 'dashed',
  },
  reportUploadIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  reportUploadTitle: {
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '800',
  },
  reportUploadDesc: {
    fontSize: 12,
    lineHeight: 18,
  },
  editorModal: {
    flex: 1,
    justifyContent: 'flex-end',
    paddingHorizontal: 12,
    paddingTop: 24,
  },
  editorMask: {
    ...StyleSheet.absoluteFill,
  },
  editorContent: {
    maxHeight: '88%',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    borderBottomWidth: 0,
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  editorHeader: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  editorHeaderButton: {
    width: 68,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
  },
  editorCancel: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '600',
  },
  editorTitle: {
    flex: 1,
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '800',
    textAlign: 'center',
  },
  editorConfirm: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '800',
  },
  editorBody: {
    flexGrow: 0,
  },
  editorBodyContent: {
    paddingTop: 12,
    paddingBottom: 12,
  },
  choiceList: {
    gap: 4,
  },
  choiceItem: {
    minHeight: 54,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
  },
  choiceCopy: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  choiceText: {
    fontSize: 15,
    lineHeight: 22,
  },
  choiceTextActive: {
    fontWeight: '800',
  },
  lockBadge: {
    minHeight: 24,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    borderRadius: 12,
  },
  lockBadgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  radioRing: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioCenter: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#ffffff',
  },
  multiGrid: {
    gap: 8,
    marginBottom: 16,
  },
  multiItem: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1,
  },
  multiDot: {
    width: 20,
    height: 20,
    borderRadius: 6,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  multiText: {
    flex: 1,
    fontSize: 14,
    lineHeight: 21,
    fontWeight: '600',
  },
  multiTextActive: {
    fontWeight: '800',
  },
  customSection: {
    gap: 8,
    paddingTop: 4,
  },
  customSectionLabel: {
    marginTop: 4,
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '700',
  },
  customOptionRow: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 8,
  },
  customOptionChoice: {
    flex: 1,
    minWidth: 0,
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  customOptionText: {
    flex: 1,
    minWidth: 0,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '700',
  },
  customIconButton: {
    width: 48,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    borderWidth: 1,
  },
  customInputRow: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1,
    paddingLeft: 12,
    overflow: 'hidden',
  },
  customInput: {
    flex: 1,
    minWidth: 0,
    minHeight: 50,
    fontSize: 15,
  },
  customInlineButton: {
    width: 48,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  customSaveButton: {
    width: 52,
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
  },
  field: {
    marginBottom: 12,
  },
  fieldLabel: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '800',
    marginBottom: 8,
  },
  input: {
    minHeight: 50,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    fontSize: 16,
  },
  textarea: {
    minHeight: 128,
    paddingTop: 12,
    paddingBottom: 12,
    lineHeight: 23,
  },
  characterCount: {
    marginTop: 6,
    textAlign: 'right',
    fontSize: 12,
  },
  datePartsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  routineFieldsRow: {
    flexDirection: 'row',
    gap: 12,
  },
  compactField: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  compactInput: {
    flex: 1,
    minWidth: 0,
    minHeight: 52,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 8,
    fontSize: 17,
    fontWeight: '700',
    textAlign: 'center',
  },
  compactUnit: {
    fontSize: 13,
    fontWeight: '700',
  },
  helperText: {
    marginTop: 10,
    fontSize: 13,
    lineHeight: 20,
  },
  routinePreview: {
    minHeight: 48,
    marginTop: 14,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
    borderRadius: 12,
  },
  routinePreviewText: {
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '800',
    textAlign: 'center',
  },
  editorReportBody: {
    gap: 12,
  },
  editorReportStatus: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
  },
  editorReportStatusFailed: {
    alignItems: 'flex-start',
    flexDirection: 'column',
  },
  editorReportStatusCopy: {
    flex: 1,
    gap: 3,
  },
  editorReportStatusTitle: {
    fontWeight: '800',
  },
  editorReportStatusDesc: {
    lineHeight: 20,
  },
  editorReportStatusTitleFailed: {
    fontWeight: '800',
  },
  editorReportStatusDescFailed: {
    lineHeight: 20,
  },
  reportBlock: {
    marginBottom: 12,
  },
  reportTitle: {
    fontWeight: '800',
    marginBottom: 6,
  },
  reportLine: {
    lineHeight: 21,
  },
  reportEmptyText: {
    lineHeight: 21,
  },
  indicatorRow: {
    minHeight: 42,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
    marginBottom: 6,
  },
  indicatorName: {
    flex: 1,
    fontSize: 13,
    lineHeight: 19,
  },
  indicatorValue: {
    maxWidth: '48%',
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'right',
  },
  indicatorValueAbnormal: {
    fontWeight: '800',
  },
  reportGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  reportImage: {
    width: 88,
    height: 110,
    borderRadius: 10,
  },
  sourceBackdrop: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  sourceSheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 12,
  },
  sourceHandle: {
    width: 42,
    height: 4,
    marginBottom: 18,
    borderRadius: 2,
    alignSelf: 'center',
  },
  sourceTitle: {
    fontSize: 20,
    lineHeight: 27,
    fontWeight: '800',
  },
  sourceSubtitle: {
    marginTop: 5,
    marginBottom: 18,
    fontSize: 13,
    lineHeight: 19,
  },
  sourcePrimary: {
    minHeight: 52,
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
  },
  sourcePrimaryText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '800',
  },
  sourceSecondary: {
    minHeight: 52,
    marginTop: 10,
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
  },
  sourceSecondaryText: {
    fontSize: 15,
    fontWeight: '800',
  },
  sourceCancel: {
    minHeight: 48,
    marginTop: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sourceCancelText: {
    fontSize: 14,
    fontWeight: '700',
  },
})