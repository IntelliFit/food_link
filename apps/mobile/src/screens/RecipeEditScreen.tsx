import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  AccessibilityInfo,
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native'
import { useNavigation, useRoute, type NavigationAction, type RouteProp } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Check, CircleAlert, FilePenLine, RefreshCw, Save, Trash2, UtensilsCrossed, X } from 'lucide-react-native'
import { getMealTypeLabel, type MealType, type RecipeItem } from '@food-link/core'
import { apiClient, getStoredUserId } from '../api'
import type { RootStackParamList } from '../navigation/types'
import { useColorScheme } from '../providers/ColorSchemeProvider'
import { userFacingErrorMessage } from '../utils/errors'

const mealOptions: MealType[] = [
  'breakfast',
  'morning_snack',
  'lunch',
  'afternoon_snack',
  'dinner',
  'evening_snack',
]

type ConfirmKind = 'discard' | 'delete' | null

type EditorSnapshot = {
  name: string
  description: string
  mealType: MealType
}

type EditorPalette = {
  background: string
  wash: string
  surface: string
  surfaceMuted: string
  border: string
  text: string
  textSecondary: string
  textMuted: string
  accent: string
  accentStrong: string
  accentSoft: string
  danger: string
  dangerSoft: string
  dangerBorder: string
  input: string
  inputDisabled: string
  scrim: string
  shadow: string
}

const lightPalette: EditorPalette = {
  background: '#f7faf8',
  wash: '#ecfdf5',
  surface: '#ffffff',
  surfaceMuted: '#f5f8f6',
  border: '#dfe8e2',
  text: '#14211b',
  textSecondary: '#55665d',
  textMuted: '#7d8b83',
  accent: '#00bc7d',
  accentStrong: '#009f69',
  accentSoft: '#e8faf2',
  danger: '#c92828',
  dangerSoft: '#fff1f1',
  dangerBorder: '#f3c1c1',
  input: '#f9fbfa',
  inputDisabled: '#eef2ef',
  scrim: 'rgba(8, 18, 14, 0.52)',
  shadow: '#12251b',
}

const darkPalette: EditorPalette = {
  background: '#0d1312',
  wash: '#12201b',
  surface: '#18211f',
  surfaceMuted: '#1d2a26',
  border: 'rgba(136, 196, 165, 0.20)',
  text: '#f2f7f4',
  textSecondary: '#c4d1ca',
  textMuted: '#8fa198',
  accent: '#6ee7b7',
  accentStrong: '#38c994',
  accentSoft: 'rgba(56, 201, 148, 0.13)',
  danger: '#ff9a9a',
  dangerSoft: 'rgba(239, 68, 68, 0.13)',
  dangerBorder: 'rgba(255, 154, 154, 0.28)',
  input: '#121b18',
  inputDisabled: '#17201d',
  scrim: 'rgba(0, 0, 0, 0.70)',
  shadow: '#000000',
}

export function RecipeEditScreen() {
  const route = useRoute<RouteProp<RootStackParamList, 'RecipeEdit'>>()
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  const insets = useSafeAreaInsets()
  const { width } = useWindowDimensions()
  const { isDark } = useColorScheme()
  const palette = isDark ? darkPalette : lightPalette
  const recipeId = route.params?.recipeId

  const [recipe, setRecipe] = useState<RecipeItem | null>(null)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [mealType, setMealType] = useState<MealType>('lunch')
  const [initialLoading, setInitialLoading] = useState(Boolean(recipeId))
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [actionError, setActionError] = useState('')
  const [nameError, setNameError] = useState('')
  const [confirmKind, setConfirmKind] = useState<ConfirmKind>(null)
  const [saved, setSaved] = useState(false)
  const [reduceMotion, setReduceMotion] = useState(false)

  const initialSnapshotRef = useRef<EditorSnapshot | null>(null)
  const requestGenerationRef = useRef(0)
  const pendingNavigationActionRef = useRef<NavigationAction | null>(null)
  const allowNextNavigationRef = useRef(false)
  const successTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const compact = width <= 390
  const busy = saving || deleting
  const currentSnapshot = useMemo<EditorSnapshot>(() => ({ name, description, mealType }), [description, mealType, name])
  const dirty = Boolean(recipe && initialSnapshotRef.current && !sameSnapshot(currentSnapshot, initialSnapshotRef.current))

  useEffect(() => {
    let mounted = true
    void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (mounted) setReduceMotion(enabled)
    })
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion)
    return () => {
      mounted = false
      subscription.remove()
    }
  }, [])

  useEffect(() => () => {
    if (successTimerRef.current) clearTimeout(successTimerRef.current)
  }, [])

  const applyRecipe = useCallback((nextRecipe: RecipeItem) => {
    const normalizedMeal = normalizeMealType(nextRecipe.meal_type) || 'lunch'
    const snapshot: EditorSnapshot = {
      name: nextRecipe.recipe_name || '',
      description: nextRecipe.description || '',
      mealType: normalizedMeal,
    }
    setRecipe(nextRecipe)
    setName(snapshot.name)
    setDescription(snapshot.description)
    setMealType(snapshot.mealType)
    initialSnapshotRef.current = snapshot
    setNameError('')
    setActionError('')
    setSaved(false)
  }, [])

  const load = useCallback(async () => {
    if (!recipeId) {
      setInitialLoading(false)
      return
    }
    const generation = ++requestGenerationRef.current
    setInitialLoading(true)
    setLoadError('')
    setActionError('')
    try {
      const [nextRecipe, currentUserId] = await Promise.all([apiClient.getRecipe(recipeId), getStoredUserId()])
      if (generation !== requestGenerationRef.current) return
      if (nextRecipe.user_id && currentUserId && nextRecipe.user_id !== currentUserId) {
        throw new Error('你没有权限编辑这个食谱')
      }
      applyRecipe(nextRecipe)
    } catch (error) {
      if (generation !== requestGenerationRef.current) return
      setLoadError(userFacingErrorMessage(error, '获取食谱失败'))
    } finally {
      if (generation === requestGenerationRef.current) setInitialLoading(false)
    }
  }, [applyRecipe, recipeId])

  useEffect(() => {
    void load()
    return () => {
      requestGenerationRef.current += 1
    }
  }, [load])

  useEffect(() => navigation.addListener('beforeRemove', (event) => {
    if (allowNextNavigationRef.current) {
      allowNextNavigationRef.current = false
      return
    }
    if (busy) {
      event.preventDefault()
      return
    }
    if (!dirty) return
    event.preventDefault()
    pendingNavigationActionRef.current = event.data.action
    setConfirmKind('discard')
  }), [busy, dirty, navigation])

  const validateName = useCallback((value = name) => {
    const message = value.trim() ? '' : '请输入食谱名称'
    setNameError(message)
    return !message
  }, [name])

  const save = useCallback(async () => {
    if (!recipeId || !recipe || busy || !validateName()) return
    setSaving(true)
    setActionError('')
    setSaved(false)
    try {
      const nextSnapshot: EditorSnapshot = { name: name.trim(), description: description.trim(), mealType }
      const result = await apiClient.updateRecipe(recipeId, {
        recipeName: nextSnapshot.name,
        description: nextSnapshot.description,
        mealType: nextSnapshot.mealType,
      })
      setRecipe(result.recipe)
      setName(nextSnapshot.name)
      setDescription(nextSnapshot.description)
      initialSnapshotRef.current = nextSnapshot
      setSaved(true)
      allowNextNavigationRef.current = true
      successTimerRef.current = setTimeout(() => navigation.goBack(), reduceMotion ? 350 : 850)
    } catch (error) {
      setActionError(userFacingErrorMessage(error, '保存食谱失败'))
    } finally {
      setSaving(false)
    }
  }, [busy, description, mealType, name, navigation, recipe, recipeId, reduceMotion, validateName])

  const confirmDelete = useCallback(async () => {
    if (!recipeId || deleting) return
    setConfirmKind(null)
    setDeleting(true)
    setActionError('')
    try {
      await apiClient.deleteRecipe(recipeId)
      allowNextNavigationRef.current = true
      navigation.replace('Recipes')
    } catch (error) {
      setActionError(userFacingErrorMessage(error, '删除食谱失败'))
    } finally {
      setDeleting(false)
    }
  }, [deleting, navigation, recipeId])

  const confirmDiscard = useCallback(() => {
    const action = pendingNavigationActionRef.current
    pendingNavigationActionRef.current = null
    setConfirmKind(null)
    if (!action) return
    allowNextNavigationRef.current = true
    navigation.dispatch(action)
  }, [navigation])

  if (!recipeId) {
    return (
      <StatePage palette={palette} insetsBottom={insets.bottom}>
        <FilePenLine size={42} color={palette.accent} strokeWidth={2.1} />
        <Text style={[styles.stateTitle, { color: palette.text }]}>无法编辑食谱</Text>
        <Text style={[styles.stateMessage, { color: palette.textSecondary }]}>请先从分析结果页收藏餐食，再进入食谱详情编辑。</Text>
        <Pressable style={({ pressed }) => [styles.statePrimary, { backgroundColor: palette.accentStrong }, pressed && styles.pressed]} onPress={() => navigation.replace('Recipes')} accessibilityRole="button" accessibilityLabel="返回收藏食谱">
          <Text style={styles.statePrimaryText}>返回收藏食谱</Text>
        </Pressable>
      </StatePage>
    )
  }

  if (initialLoading && !recipe) {
    return (
      <View style={[styles.centerPage, { backgroundColor: palette.background }]} accessibilityRole="progressbar" accessibilityLabel="正在加载食谱编辑信息">
        <ActivityIndicator size="large" color={palette.accent} />
      </View>
    )
  }

  if (!recipe) {
    return (
      <StatePage palette={palette} insetsBottom={insets.bottom}>
        <CircleAlert size={42} color={palette.danger} strokeWidth={2.1} />
        <Text style={[styles.stateTitle, { color: palette.text }]}>食谱加载失败</Text>
        <Text style={[styles.stateMessage, { color: palette.textSecondary }]}>{loadError || '暂时无法获取这个食谱，请稍后重试。'}</Text>
        <Pressable style={({ pressed }) => [styles.statePrimary, { backgroundColor: palette.accentStrong }, pressed && styles.pressed]} onPress={() => void load()} accessibilityRole="button" accessibilityLabel="重新加载食谱">
          <RefreshCw size={18} color="#ffffff" />
          <Text style={styles.statePrimaryText}>重新加载</Text>
        </Pressable>
        <Pressable style={({ pressed }) => [styles.stateSecondary, { borderColor: palette.border, backgroundColor: palette.surfaceMuted }, pressed && styles.pressed]} onPress={() => navigation.replace('Recipes')} accessibilityRole="button" accessibilityLabel="返回收藏食谱">
          <Text style={[styles.stateSecondaryText, { color: palette.textSecondary }]}>返回收藏食谱</Text>
        </Pressable>
      </StatePage>
    )
  }

  const summary = [
    { key: 'calories', value: formatNutrient(recipe.total_calories), label: '热量', unit: 'kcal', accent: true },
    { key: 'protein', value: formatNutrient(recipe.total_protein), label: '蛋白质', unit: 'g' },
    { key: 'carbs', value: formatNutrient(recipe.total_carbs), label: '碳水', unit: 'g' },
    { key: 'fat', value: formatNutrient(recipe.total_fat), label: '脂肪', unit: 'g' },
  ]

  return (
    <KeyboardAvoidingView style={[styles.page, { backgroundColor: palette.background }]} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={Platform.OS === 'ios' ? 88 : 0}>
      <View pointerEvents="none" style={[styles.wash, { backgroundColor: palette.wash }]} />
      <ScrollView style={styles.scroll} contentContainerStyle={[styles.content, { paddingBottom: Math.max(insets.bottom, 12) + 112 }]} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" showsVerticalScrollIndicator={false}>
        <View style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.border, shadowColor: palette.shadow }]} accessibilityLabel="食谱基本信息">
          <View style={styles.sectionHeader}>
            <View style={[styles.sectionIcon, { backgroundColor: palette.accentSoft }]}><FilePenLine size={19} color={palette.accent} /></View>
            <Text style={[styles.sectionTitle, { color: palette.text }]}>基本信息</Text>
            {dirty ? <View style={[styles.changedBadge, { backgroundColor: palette.accentSoft }]}><Text style={[styles.changedBadgeText, { color: palette.accent }]}>已修改</Text></View> : null}
          </View>

          <Field
            label="食谱名称"
            required
            value={name}
            onChangeText={(value) => {
              setName(value)
              if (nameError && value.trim()) setNameError('')
              setSaved(false)
            }}
            onBlur={() => validateName()}
            placeholder="请输入食谱名称"
            editable={!busy}
            error={nameError}
            palette={palette}
            returnKeyType="next"
          />

          <Field
            label="描述"
            value={description}
            onChangeText={(value) => {
              setDescription(value)
              setSaved(false)
            }}
            placeholder="请输入食谱描述（可选）"
            editable={!busy}
            multiline
            palette={palette}
          />

          <View style={styles.formItem}>
            <Text style={[styles.label, { color: palette.textSecondary }]}>适合餐次</Text>
            <View style={styles.mealGrid} accessibilityRole="radiogroup">
              {mealOptions.map((meal) => {
                const selected = mealType === meal
                return (
                  <Pressable
                    key={meal}
                    style={({ pressed }) => [styles.mealOption, { backgroundColor: selected ? palette.accentSoft : palette.surfaceMuted, borderColor: selected ? palette.accent : palette.border }, pressed && !busy && styles.pressed]}
                    onPress={() => {
                      setMealType(meal)
                      setSaved(false)
                    }}
                    disabled={busy}
                    accessibilityRole="radio"
                    accessibilityLabel={getMealTypeLabel(meal)}
                    accessibilityState={{ checked: selected, disabled: busy }}
                  >
                    <View style={[styles.radioOuter, { borderColor: selected ? palette.accent : palette.textMuted }]}>{selected ? <View style={[styles.radioInner, { backgroundColor: palette.accent }]} /> : null}</View>
                    <Text style={[styles.mealText, { color: selected ? palette.accent : palette.textSecondary }]}>{getMealTypeLabel(meal)}</Text>
                  </Pressable>
                )
              })}
            </View>
          </View>
        </View>

        <View style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.border, shadowColor: palette.shadow }]} accessibilityLabel={summary.map((item) => item.label + item.value + item.unit).join('，')}>
          <View style={styles.sectionHeader}>
            <View style={[styles.sectionIcon, { backgroundColor: palette.accentSoft }]}><UtensilsCrossed size={19} color={palette.accent} /></View>
            <Text style={[styles.sectionTitle, { color: palette.text }]}>营养摘要</Text>
          </View>
          <View style={[styles.summaryGrid, compact && styles.summaryGridCompact]}>
            {summary.map((item) => (
              <View key={item.key} style={[styles.summaryItem, compact && styles.summaryItemCompact, { backgroundColor: palette.surfaceMuted, borderColor: palette.border }]}>
                <Text style={[styles.summaryValue, { color: item.accent ? palette.accent : palette.text }]}>{item.value}</Text>
                <Text style={[styles.summaryUnit, { color: palette.textMuted }]}>{item.unit}</Text>
                <Text style={[styles.summaryLabel, { color: palette.textSecondary }]}>{item.label}</Text>
              </View>
            ))}
          </View>
          <Text style={[styles.summaryHint, { color: palette.textMuted }]}>营养数据来自已收藏的食材明细；本页只修改名称、描述和适合餐次，不会覆盖原食材数据。</Text>
        </View>

        {actionError ? (
          <View style={[styles.inlineError, { backgroundColor: palette.dangerSoft, borderColor: palette.dangerBorder }]} accessibilityLiveRegion="assertive">
            <CircleAlert size={18} color={palette.danger} />
            <Text style={[styles.inlineErrorText, { color: palette.danger }]}>{actionError}</Text>
            <Pressable style={styles.inlineErrorClose} onPress={() => setActionError('')} accessibilityRole="button" accessibilityLabel="关闭错误提示"><X size={18} color={palette.danger} /></Pressable>
          </View>
        ) : null}

        {saved ? (
          <View style={[styles.savedBanner, { backgroundColor: palette.accentSoft, borderColor: palette.border }]} accessibilityLiveRegion="polite">
            <Check size={18} color={palette.accent} />
            <Text style={[styles.savedText, { color: palette.accent }]}>已保存，正在返回</Text>
          </View>
        ) : null}
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 12), backgroundColor: palette.surface, borderColor: palette.border }]}>
        <Pressable style={({ pressed }) => [styles.deleteButton, { backgroundColor: palette.dangerSoft, borderColor: palette.dangerBorder }, busy && styles.disabled, pressed && !busy && styles.pressed]} onPress={() => setConfirmKind('delete')} disabled={busy} accessibilityRole="button" accessibilityLabel="删除食谱" accessibilityState={{ disabled: busy, busy: deleting }}>
          {deleting ? <ActivityIndicator size="small" color={palette.danger} /> : <Trash2 size={19} color={palette.danger} />}
          {!compact ? <Text style={[styles.deleteText, { color: palette.danger }]}>删除食谱</Text> : null}
        </Pressable>
        <Pressable style={({ pressed }) => [styles.saveButton, { backgroundColor: palette.accentStrong }, (!dirty || busy || Boolean(nameError)) && styles.disabled, pressed && dirty && !busy && !nameError && styles.pressed]} onPress={() => void save()} disabled={!dirty || busy || Boolean(nameError)} accessibilityRole="button" accessibilityLabel={saving ? '正在保存食谱' : dirty ? '保存食谱修改' : '食谱没有修改'} accessibilityState={{ disabled: !dirty || busy || Boolean(nameError), busy: saving }}>
          {saving ? <ActivityIndicator size="small" color="#ffffff" /> : <Save size={19} color="#ffffff" />}
          <Text style={styles.saveText}>保存修改</Text>
        </Pressable>
      </View>

      <ConfirmSheet
        kind={confirmKind}
        palette={palette}
        insetsBottom={insets.bottom}
        reduceMotion={reduceMotion}
        busy={busy}
        recipeName={name.trim() || '这个食谱'}
        onClose={() => {
          pendingNavigationActionRef.current = null
          setConfirmKind(null)
        }}
        onConfirm={confirmKind === 'delete' ? () => void confirmDelete() : confirmDiscard}
      />
    </KeyboardAvoidingView>
  )
}

function Field({
  label,
  required = false,
  value,
  onChangeText,
  onBlur,
  placeholder,
  editable,
  error,
  multiline = false,
  palette,
  returnKeyType,
}: {
  label: string
  required?: boolean
  value: string
  onChangeText: (value: string) => void
  onBlur?: () => void
  placeholder: string
  editable: boolean
  error?: string
  multiline?: boolean
  palette: EditorPalette
  returnKeyType?: 'done' | 'next'
}) {
  return (
    <View style={styles.formItem}>
      <View style={styles.labelRow}>
        <Text style={[styles.label, styles.labelWithoutMargin, { color: palette.textSecondary }]}>{label}</Text>
        {required ? <Text style={[styles.required, { color: palette.danger }]}>必填</Text> : null}
      </View>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        onBlur={onBlur}
        placeholder={placeholder}
        placeholderTextColor={palette.textMuted}
        editable={editable}
        multiline={multiline}
        returnKeyType={multiline ? undefined : returnKeyType}
        blurOnSubmit={!multiline}
        accessibilityLabel={required ? label + '，必填' : label}
        accessibilityHint={error || undefined}
        style={[styles.input, multiline && styles.textarea, { color: palette.text, backgroundColor: editable ? palette.input : palette.inputDisabled, borderColor: error ? palette.danger : palette.border }]}
        textAlignVertical={multiline ? 'top' : 'center'}
      />
      {error ? (
        <View style={styles.fieldErrorRow} accessibilityLiveRegion="assertive">
          <CircleAlert size={15} color={palette.danger} />
          <Text style={[styles.fieldErrorText, { color: palette.danger }]}>{error}</Text>
        </View>
      ) : null}
    </View>
  )
}

function StatePage({ palette, insetsBottom, children }: { palette: EditorPalette; insetsBottom: number; children: ReactNode }) {
  return (
    <View style={[styles.statePage, { backgroundColor: palette.background, paddingBottom: Math.max(insetsBottom, 16) + 24 }]}>
      <View style={[styles.stateCard, { backgroundColor: palette.surface, borderColor: palette.border, shadowColor: palette.shadow }]}>{children}</View>
    </View>
  )
}

function ConfirmSheet({
  kind,
  palette,
  insetsBottom,
  reduceMotion,
  busy,
  recipeName,
  onClose,
  onConfirm,
}: {
  kind: ConfirmKind
  palette: EditorPalette
  insetsBottom: number
  reduceMotion: boolean
  busy: boolean
  recipeName: string
  onClose: () => void
  onConfirm: () => void
}) {
  const deleting = kind === 'delete'
  return (
    <Modal visible={kind != null} transparent statusBarTranslucent animationType={reduceMotion ? 'none' : 'fade'} onRequestClose={onClose}>
      <Pressable style={[styles.backdrop, { backgroundColor: palette.scrim }]} onPress={onClose} accessibilityLabel={deleting ? '关闭删除确认' : '关闭放弃修改确认'}>
        <Pressable style={[styles.confirmSheet, { backgroundColor: palette.surface, paddingBottom: Math.max(insetsBottom, 16) + 12 }]} onPress={(event) => event.stopPropagation()} accessibilityViewIsModal>
          <View style={[styles.confirmIcon, { backgroundColor: deleting ? palette.dangerSoft : palette.accentSoft }]}>
            {deleting ? <Trash2 size={23} color={palette.danger} /> : <CircleAlert size={23} color={palette.accent} />}
          </View>
          <Text style={[styles.confirmTitle, { color: palette.text }]}>{deleting ? '删除这个食谱？' : '放弃未保存的修改？'}</Text>
          <Text style={[styles.confirmMessage, { color: palette.textSecondary }]}>{deleting ? '“' + recipeName + '”删除后无法恢复。' : '名称、描述或餐次的修改还没有保存。'}</Text>
          <View style={styles.confirmActions}>
            <Pressable style={({ pressed }) => [styles.confirmSecondary, { backgroundColor: palette.surfaceMuted, borderColor: palette.border }, busy && styles.disabled, pressed && !busy && styles.pressed]} onPress={onClose} disabled={busy} accessibilityRole="button" accessibilityLabel="继续编辑">
              <Text style={[styles.confirmSecondaryText, { color: palette.textSecondary }]}>继续编辑</Text>
            </Pressable>
            <Pressable style={({ pressed }) => [styles.confirmPrimary, { backgroundColor: deleting ? palette.danger : palette.accentStrong }, busy && styles.disabled, pressed && !busy && styles.pressed]} onPress={onConfirm} disabled={busy} accessibilityRole="button" accessibilityLabel={deleting ? '确认删除食谱' : '确认放弃修改'} accessibilityState={{ disabled: busy }}>
              <Text style={styles.confirmPrimaryText}>{deleting ? '确认删除' : '放弃修改'}</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  )
}

function normalizeMealType(value?: string | null): MealType | null {
  if (mealOptions.includes(value as MealType)) return value as MealType
  return value === 'snack' ? 'afternoon_snack' : null
}

function sameSnapshot(left: EditorSnapshot, right: EditorSnapshot): boolean {
  return left.name === right.name && left.description === right.description && left.mealType === right.mealType
}

function formatNutrient(value: number): string {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return '0'
  const rounded = Math.round(numeric * 10) / 10
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  wash: { position: 'absolute', top: 0, left: 0, right: 0, height: 208 },
  scroll: { flex: 1 },
  content: { minHeight: '100%', paddingHorizontal: 16, paddingTop: 16 },
  centerPage: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  card: { marginBottom: 14, padding: 16, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, shadowOpacity: 0.08, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 2 },
  sectionHeader: { minHeight: 36, flexDirection: 'row', alignItems: 'center', gap: 9, marginBottom: 14 },
  sectionIcon: { width: 34, height: 34, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  sectionTitle: { flex: 1, fontSize: 17, lineHeight: 23, fontWeight: '800' },
  changedBadge: { minHeight: 28, borderRadius: 14, paddingHorizontal: 10, alignItems: 'center', justifyContent: 'center' },
  changedBadgeText: { fontSize: 12, lineHeight: 17, fontWeight: '800' },
  formItem: { marginBottom: 16 },
  labelRow: { minHeight: 24, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 7 },
  label: { marginBottom: 7, fontSize: 14, lineHeight: 20, fontWeight: '700' },
  labelWithoutMargin: { marginBottom: 0 },
  required: { fontSize: 12, lineHeight: 17, fontWeight: '700' },
  input: { minHeight: 48, borderRadius: 12, borderWidth: 1, paddingHorizontal: 13, paddingVertical: 10, fontSize: 15, lineHeight: 21 },
  textarea: { minHeight: 104, paddingTop: 12, paddingBottom: 12 },
  fieldErrorRow: { minHeight: 28, marginTop: 5, flexDirection: 'row', alignItems: 'center', gap: 6 },
  fieldErrorText: { flex: 1, fontSize: 12, lineHeight: 17, fontWeight: '600' },
  mealGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  mealOption: { flexBasis: '30%', flexGrow: 1, minWidth: 96, minHeight: 48, borderRadius: 13, borderWidth: 1, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
  radioOuter: { width: 18, height: 18, borderRadius: 9, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  radioInner: { width: 9, height: 9, borderRadius: 5 },
  mealText: { fontSize: 13, lineHeight: 18, fontWeight: '800' },
  summaryGrid: { flexDirection: 'row', gap: 8 },
  summaryGridCompact: { flexWrap: 'wrap' },
  summaryItem: { flex: 1, minWidth: 68, minHeight: 88, paddingHorizontal: 6, paddingVertical: 12, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, alignItems: 'center', justifyContent: 'center' },
  summaryItemCompact: { flexBasis: '46%' },
  summaryValue: { fontSize: 21, lineHeight: 27, fontWeight: '900' },
  summaryUnit: { marginTop: 1, fontSize: 11, lineHeight: 15, fontWeight: '600' },
  summaryLabel: { marginTop: 4, fontSize: 12, lineHeight: 17, fontWeight: '700' },
  summaryHint: { marginTop: 12, fontSize: 12, lineHeight: 19 },
  inlineError: { minHeight: 48, marginBottom: 12, borderRadius: 12, borderWidth: 1, paddingLeft: 13, paddingRight: 6, paddingVertical: 9, flexDirection: 'row', alignItems: 'center', gap: 9 },
  inlineErrorText: { flex: 1, fontSize: 13, lineHeight: 19, fontWeight: '600' },
  inlineErrorClose: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  savedBanner: { minHeight: 48, marginBottom: 12, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  savedText: { fontSize: 14, lineHeight: 20, fontWeight: '800' },
  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, minHeight: 80, paddingTop: 10, paddingHorizontal: 16, flexDirection: 'row', gap: 10, borderTopWidth: StyleSheet.hairlineWidth },
  deleteButton: { minWidth: 58, minHeight: 52, borderRadius: 14, borderWidth: 1, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
  deleteText: { fontSize: 14, lineHeight: 20, fontWeight: '800' },
  saveButton: { flex: 1, minHeight: 52, borderRadius: 14, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  saveText: { color: '#ffffff', fontSize: 15, lineHeight: 21, fontWeight: '900' },
  disabled: { opacity: 0.46 },
  pressed: { opacity: 0.72 },
  statePage: { flex: 1, paddingHorizontal: 20, paddingTop: 28, justifyContent: 'center' },
  stateCard: { width: '100%', maxWidth: 420, alignSelf: 'center', alignItems: 'center', borderRadius: 18, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 22, paddingVertical: 28, shadowOpacity: 0.08, shadowRadius: 14, shadowOffset: { width: 0, height: 5 }, elevation: 2 },
  stateTitle: { marginTop: 14, fontSize: 20, lineHeight: 27, fontWeight: '900', textAlign: 'center' },
  stateMessage: { marginTop: 9, fontSize: 14, lineHeight: 22, textAlign: 'center' },
  statePrimary: { minHeight: 50, marginTop: 22, borderRadius: 14, paddingHorizontal: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  statePrimaryText: { color: '#ffffff', fontSize: 15, lineHeight: 21, fontWeight: '900' },
  stateSecondary: { minHeight: 48, marginTop: 10, borderRadius: 14, borderWidth: 1, paddingHorizontal: 20, alignItems: 'center', justifyContent: 'center' },
  stateSecondaryText: { fontSize: 14, lineHeight: 20, fontWeight: '800' },
  backdrop: { flex: 1, justifyContent: 'flex-end' },
  confirmSheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 20, paddingTop: 22 },
  confirmIcon: { width: 44, height: 44, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  confirmTitle: { marginTop: 14, fontSize: 20, lineHeight: 27, fontWeight: '900' },
  confirmMessage: { marginTop: 8, fontSize: 14, lineHeight: 22 },
  confirmActions: { marginTop: 22, flexDirection: 'row', gap: 10 },
  confirmSecondary: { flex: 1, minHeight: 50, borderRadius: 14, borderWidth: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
  confirmSecondaryText: { fontSize: 14, lineHeight: 20, fontWeight: '800' },
  confirmPrimary: { flex: 1, minHeight: 50, borderRadius: 14, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
  confirmPrimaryText: { color: '#ffffff', fontSize: 14, lineHeight: 20, fontWeight: '900' },
})
