import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as ImagePicker from 'expo-image-picker'
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import {
  AccessibilityInfo,
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native'
import { CalendarDays, CircleAlert, Dumbbell, Flame, ImagePlus, Save, X } from 'lucide-react-native'
import type { ExerciseLogItem } from '@food-link/core'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { apiClient } from '../api'
import type { RootStackParamList } from '../navigation/types'
import { useAppDialog } from '../providers/DialogProvider'
import { useColorScheme } from '../providers/ColorSchemeProvider'
import { emitHomeDashboardRefreshEvent } from '../utils/home-events'
import { userFacingErrorMessage } from '../utils/errors'

const dateKeyPattern = /^\d{4}-\d{2}-\d{2}$/

type EditorSnapshot = {
  description: string
  date: string
  calories: string
  imageUrl: string
}

export function ExerciseLogEditScreen() {
  const route = useRoute<RouteProp<RootStackParamList, 'ExerciseLogEdit'>>()
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  const dialog = useAppDialog()
  const { isDark } = useColorScheme()
  const insets = useSafeAreaInsets()
  const { width } = useWindowDimensions()
  const palette = isDark ? darkPalette : lightPalette
  const styles = useMemo(() => createStyles(palette), [palette])
  const [record, setRecord] = useState<ExerciseLogItem | null>(null)
  const [description, setDescription] = useState('')
  const [date, setDate] = useState(route.params.date || '')
  const [calories, setCalories] = useState('')
  const [imageUri, setImageUri] = useState('')
  const [imageUrl, setImageUrl] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [descriptionTouched, setDescriptionTouched] = useState(false)
  const [dateTouched, setDateTouched] = useState(false)
  const [caloriesTouched, setCaloriesTouched] = useState(false)
  const initialSnapshotRef = useRef('')
  const allowLeaveRef = useRef(false)

  const currentSnapshot = useMemo(() => JSON.stringify({
    description: description.trim(),
    date: date.trim(),
    calories: calories.trim(),
    imageUrl: imageUrl.trim(),
  } satisfies EditorSnapshot), [calories, date, description, imageUrl])
  const dirty = Boolean(initialSnapshotRef.current) && currentSnapshot !== initialSnapshotRef.current

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError('')
    try {
      const response = await apiClient.getExerciseLogs({ date: route.params.date })
      const nextRecord = (response.logs || []).find((item) => String(item.id) === route.params.logId) || null
      if (!nextRecord) throw new Error('没有找到这条运动记录，可能已被删除')
      const nextDate = String(nextRecord.recorded_on || nextRecord.date || route.params.date || '').slice(0, 10)
      const nextDescription = String(nextRecord.exercise_desc || nextRecord.exercise_type || '').trim()
      const nextCalories = String(Math.round(Number(nextRecord.calories_burned || 0)))
      const nextImageUrl = String(nextRecord.image_url || '').trim()
      setRecord(nextRecord)
      setDescription(nextDescription)
      setDate(nextDate)
      setCalories(nextCalories)
      setImageUri(nextImageUrl)
      setImageUrl(nextImageUrl)
      initialSnapshotRef.current = JSON.stringify({
        description: nextDescription,
        date: nextDate,
        calories: nextCalories,
        imageUrl: nextImageUrl,
      } satisfies EditorSnapshot)
    } catch (error) {
      setRecord(null)
      setLoadError(userFacingErrorMessage(error, '运动记录加载失败'))
    } finally {
      setLoading(false)
    }
  }, [route.params.date, route.params.logId])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => navigation.addListener('beforeRemove', (event) => {
    if (allowLeaveRef.current) return
    if (saving) {
      event.preventDefault()
      return
    }
    if (!dirty) return
    event.preventDefault()
    void dialog.confirm({
      title: '放弃本次修改？',
      message: '尚未保存的运动记录修改会丢失。',
      kind: 'warning',
      confirmText: '放弃修改',
      cancelText: '继续编辑',
    }).then((confirmed) => {
      if (!confirmed) return
      allowLeaveRef.current = true
      navigation.dispatch(event.data.action)
    })
  }), [dialog, dirty, navigation, saving])

  const descriptionError = descriptionTouched && !description.trim() && !imageUrl ? '请填写运动描述或保留一张图片' : ''
  const dateError = dateTouched && !isValidDateKey(date) ? '请输入有效日期，格式为 YYYY-MM-DD' : ''
  const caloriesNumber = Number(calories)
  const caloriesError = caloriesTouched && (!calories.trim() || !Number.isFinite(caloriesNumber) || caloriesNumber < 0 || caloriesNumber > 5000)
    ? '运动消耗应在 0 到 5000 千卡之间'
    : ''
  const canSave = Boolean(record)
    && dirty
    && !saving
    && !uploading
    && Boolean(description.trim() || imageUrl)
    && isValidDateKey(date)
    && Boolean(calories.trim())
    && Number.isFinite(caloriesNumber)
    && caloriesNumber >= 0
    && caloriesNumber <= 5000

  const pickImage = useCallback(async () => {
    try {
      const picked = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 0.86,
      })
      if (picked.canceled || !picked.assets[0]) return
      const asset = picked.assets[0]
      setImageUri(asset.uri)
      setUploading(true)
      const uploaded = await apiClient.uploadAnalyzeImageFile({
        fileUri: asset.uri,
        fileName: asset.fileName || 'exercise.jpg',
        mimeType: asset.mimeType || 'image/jpeg',
      })
      setImageUrl(uploaded.imageUrl)
      AccessibilityInfo.announceForAccessibility('运动图片已更新')
    } catch (error) {
      setImageUri(imageUrl)
      await dialog.alert('图片上传失败', userFacingErrorMessage(error), 'danger')
    } finally {
      setUploading(false)
    }
  }, [dialog, imageUrl])

  const save = useCallback(async () => {
    setDescriptionTouched(true)
    setDateTouched(true)
    setCaloriesTouched(true)
    if (!canSave) return
    setSaving(true)
    try {
      await apiClient.updateExerciseLog({
        logId: route.params.logId,
        exerciseDesc: description,
        date,
        imageUrl,
        caloriesBurned: Math.round(caloriesNumber * 10) / 10,
      })
      emitHomeDashboardRefreshEvent({ date, force: true })
      initialSnapshotRef.current = currentSnapshot
      allowLeaveRef.current = true
      AccessibilityInfo.announceForAccessibility('运动记录已更新')
      await dialog.alert('已更新', '这条运动记录已同步到首页和圈子。', 'success')
      navigation.goBack()
    } catch (error) {
      await dialog.alert('保存失败', userFacingErrorMessage(error), 'danger')
    } finally {
      setSaving(false)
    }
  }, [caloriesNumber, canSave, currentSnapshot, date, description, dialog, imageUrl, navigation, route.params.logId])

  if (loading && !record) {
    return <View style={styles.centerState}><ActivityIndicator size="large" color={palette.brand} accessibilityLabel="正在读取运动记录" /></View>
  }

  if (loadError && !record) {
    return (
      <View style={styles.centerState} accessibilityRole="alert">
        <View style={styles.errorIcon}><CircleAlert size={28} color={palette.danger} /></View>
        <Text style={styles.errorTitle}>运动记录加载失败</Text>
        <Text style={styles.errorMessage}>{loadError}</Text>
        <Pressable accessibilityRole="button" style={({ pressed }) => [styles.retryButton, pressed && styles.pressed]} onPress={() => void load()}>
          <Text style={styles.retryText}>重新加载</Text>
        </Pressable>
      </View>
    )
  }

  return (
    <KeyboardAvoidingView style={styles.page} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 18, paddingBottom: insets.bottom + 116 }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.hero}>
          <View style={styles.heroIcon}><Dumbbell size={24} color="#ffffff" strokeWidth={2.4} /></View>
          <View style={styles.heroCopy}>
            <Text style={styles.heroKicker}>指定记录</Text>
            <Text style={styles.heroTitle}>编辑运动记录</Text>
            <Text style={styles.heroHint}>直接修改原记录，不会重新扣除分析积分</Text>
          </View>
        </View>

        <View style={styles.card}>
          <View style={styles.sectionHead}>
            <Text style={styles.sectionTitle}>运动内容</Text>
            <Text style={styles.characterCount}>{description.length}/2000</Text>
          </View>
          <TextInput
            accessibilityLabel="运动描述"
            value={description}
            onChangeText={setDescription}
            onBlur={() => setDescriptionTouched(true)}
            multiline
            maxLength={2000}
            textAlignVertical="top"
            placeholder="例如：慢跑 30 分钟"
            placeholderTextColor={palette.textMuted}
            style={[styles.descriptionInput, descriptionError && styles.inputError]}
          />
          {descriptionError ? <Text style={styles.errorText} accessibilityLiveRegion="polite">{descriptionError}</Text> : null}
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>记录数据</Text>
          <View style={[styles.fieldRow, width < 390 && styles.fieldRowStack]}>
            <View style={styles.fieldColumn}>
              <Text style={styles.fieldLabel}>记录日期</Text>
              <View style={[styles.fieldInputWrap, dateError && styles.inputError]}>
                <CalendarDays size={18} color={palette.brandStrong} />
                <TextInput
                  accessibilityLabel="记录日期，格式为年月日"
                  value={date}
                  onChangeText={setDate}
                  onBlur={() => setDateTouched(true)}
                  autoCapitalize="none"
                  keyboardType="numbers-and-punctuation"
                  maxLength={10}
                  placeholder="YYYY-MM-DD"
                  placeholderTextColor={palette.textMuted}
                  style={styles.fieldInput}
                />
              </View>
              {dateError ? <Text style={styles.errorText} accessibilityLiveRegion="polite">{dateError}</Text> : null}
            </View>
            <View style={styles.fieldColumn}>
              <Text style={styles.fieldLabel}>运动消耗</Text>
              <View style={[styles.fieldInputWrap, caloriesError && styles.inputError]}>
                <Flame size={18} color={palette.orange} />
                <TextInput
                  accessibilityLabel="运动消耗，单位千卡"
                  value={calories}
                  onChangeText={setCalories}
                  onBlur={() => setCaloriesTouched(true)}
                  keyboardType="decimal-pad"
                  maxLength={6}
                  placeholder="0"
                  placeholderTextColor={palette.textMuted}
                  style={styles.fieldInput}
                />
                <Text style={styles.fieldUnit}>kcal</Text>
              </View>
              {caloriesError ? <Text style={styles.errorText} accessibilityLiveRegion="polite">{caloriesError}</Text> : null}
            </View>
          </View>
        </View>

        <View style={styles.card}>
          <View style={styles.sectionHead}>
            <Text style={styles.sectionTitle}>运动图片</Text>
            <Text style={styles.optional}>选填</Text>
          </View>
          {imageUri ? (
            <View style={styles.imageStage}>
              <Image source={{ uri: imageUri }} style={styles.image} resizeMode="cover" accessibilityLabel="当前运动图片" />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="移除运动图片"
                hitSlop={10}
                style={({ pressed }) => [styles.removeImage, pressed && styles.pressed]}
                onPress={() => { setImageUri(''); setImageUrl(''); setDescriptionTouched(true) }}
              >
                <X size={18} color="#ffffff" strokeWidth={2.5} />
              </Pressable>
            </View>
          ) : null}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={imageUri ? '更换运动图片' : '添加运动图片'}
            accessibilityState={{ busy: uploading, disabled: uploading || saving }}
            disabled={uploading || saving}
            style={({ pressed }) => [styles.imageButton, pressed && !uploading && styles.pressed]}
            onPress={() => void pickImage()}
          >
            {uploading ? <ActivityIndicator size="small" color={palette.brandStrong} /> : <ImagePlus size={20} color={palette.brandStrong} />}
            <Text style={styles.imageButtonText}>{uploading ? '正在上传' : imageUri ? '更换图片' : '从相册添加'}</Text>
          </Pressable>
        </View>
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 12) }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="保存运动记录修改"
          accessibilityState={{ disabled: !canSave, busy: saving }}
          disabled={!canSave}
          style={({ pressed }) => [styles.saveButton, !canSave && styles.saveButtonDisabled, pressed && canSave && styles.saveButtonPressed]}
          onPress={() => void save()}
        >
          {saving ? <ActivityIndicator size="small" color="#ffffff" /> : <Save size={19} color="#ffffff" strokeWidth={2.4} />}
          <Text style={styles.saveButtonText}>{saving ? '正在保存' : dirty ? '保存修改' : '尚未修改'}</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  )
}

function isValidDateKey(value: string): boolean {
  const text = value.trim()
  if (!dateKeyPattern.test(text)) return false
  const [year, month, day] = text.split('-').map(Number)
  const parsed = new Date(Date.UTC(year, month - 1, day))
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day
}

type Palette = typeof lightPalette

const lightPalette = {
  page: '#f8fafc',
  surface: '#ffffff',
  surfaceMuted: '#f1f5f9',
  border: '#dbe5e1',
  text: '#13221c',
  textSecondary: '#52645d',
  textMuted: '#7b8b84',
  brand: '#16a875',
  brandStrong: '#087653',
  brandSoft: '#e9f8f2',
  orange: '#ea650c',
  danger: '#dc2626',
  dangerSoft: '#fff1f2',
}

const darkPalette: Palette = {
  page: '#101815',
  surface: '#18211e',
  surfaceMuted: '#202c27',
  border: '#33433c',
  text: '#f2f7f4',
  textSecondary: '#c4d0ca',
  textMuted: '#93a39b',
  brand: '#32c791',
  brandStrong: '#82e5bd',
  brandSoft: '#17382d',
  orange: '#fb923c',
  danger: '#f87171',
  dangerSoft: '#451a1f',
}

function createStyles(palette: Palette) {
  return StyleSheet.create({
    page: { flex: 1, backgroundColor: palette.page },
    scroll: { flex: 1 },
    centerState: { flex: 1, paddingHorizontal: 28, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.page },
    errorIcon: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.dangerSoft },
    errorTitle: { marginTop: 14, color: palette.text, fontSize: 18, lineHeight: 25, fontWeight: '800' },
    errorMessage: { marginTop: 7, color: palette.textSecondary, fontSize: 14, lineHeight: 21, textAlign: 'center' },
    retryButton: { minWidth: 132, minHeight: 48, marginTop: 20, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.brand },
    retryText: { color: '#ffffff', fontSize: 14, fontWeight: '800' },
    hero: { minHeight: 116, padding: 18, borderRadius: 22, flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: palette.brand },
    heroIcon: { width: 48, height: 48, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.18)' },
    heroCopy: { flex: 1, minWidth: 0 },
    heroKicker: { color: 'rgba(255,255,255,0.76)', fontSize: 12, lineHeight: 17, fontWeight: '800', letterSpacing: 0.6 },
    heroTitle: { marginTop: 2, color: '#ffffff', fontSize: 22, lineHeight: 30, fontWeight: '900' },
    heroHint: { marginTop: 5, color: 'rgba(255,255,255,0.88)', fontSize: 13, lineHeight: 19 },
    card: { marginTop: 14, padding: 16, borderRadius: 20, borderWidth: StyleSheet.hairlineWidth, borderColor: palette.border, backgroundColor: palette.surface },
    sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
    sectionTitle: { color: palette.text, fontSize: 16, lineHeight: 23, fontWeight: '800' },
    characterCount: { color: palette.textMuted, fontSize: 12, lineHeight: 17 },
    optional: { color: palette.textMuted, fontSize: 12, lineHeight: 17, fontWeight: '700' },
    descriptionInput: { minHeight: 122, marginTop: 12, paddingHorizontal: 14, paddingVertical: 12, borderRadius: 16, borderWidth: 1, borderColor: palette.border, color: palette.text, backgroundColor: palette.surfaceMuted, fontSize: 15, lineHeight: 22 },
    inputError: { borderColor: palette.danger },
    errorText: { marginTop: 6, color: palette.danger, fontSize: 12, lineHeight: 18 },
    fieldRow: { marginTop: 14, flexDirection: 'row', gap: 12 },
    fieldRowStack: { flexDirection: 'column' },
    fieldColumn: { flex: 1, minWidth: 0 },
    fieldLabel: { marginBottom: 7, color: palette.textSecondary, fontSize: 13, lineHeight: 18, fontWeight: '700' },
    fieldInputWrap: { minHeight: 52, paddingHorizontal: 13, borderRadius: 15, borderWidth: 1, borderColor: palette.border, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: palette.surfaceMuted },
    fieldInput: { flex: 1, minWidth: 0, minHeight: 50, paddingVertical: 0, color: palette.text, fontSize: 14, lineHeight: 20 },
    fieldUnit: { color: palette.textMuted, fontSize: 12, fontWeight: '700' },
    imageStage: { height: 190, marginTop: 12, borderRadius: 16, overflow: 'hidden', backgroundColor: palette.surfaceMuted },
    image: { width: '100%', height: '100%' },
    removeImage: { position: 'absolute', top: 10, right: 10, width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.68)' },
    imageButton: { minHeight: 52, marginTop: 12, paddingHorizontal: 16, borderRadius: 16, borderWidth: 1, borderColor: palette.border, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: palette.brandSoft },
    imageButtonText: { color: palette.brandStrong, fontSize: 14, lineHeight: 20, fontWeight: '800' },
    footer: { paddingHorizontal: 16, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: palette.border, backgroundColor: palette.surface },
    saveButton: { minHeight: 54, borderRadius: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: palette.brand },
    saveButtonDisabled: { backgroundColor: palette.textMuted, opacity: 0.48 },
    saveButtonPressed: { transform: [{ scale: 0.985 }], opacity: 0.9 },
    saveButtonText: { color: '#ffffff', fontSize: 15, lineHeight: 21, fontWeight: '900' },
    pressed: { opacity: 0.72 },
  })
}