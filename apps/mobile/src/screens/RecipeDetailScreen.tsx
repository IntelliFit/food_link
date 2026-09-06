import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  AccessibilityInfo,
  ActivityIndicator,
  Image,
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
  useWindowDimensions,
} from 'react-native'
import { CommonActions, useFocusEffect, useNavigation, useRoute, type RouteProp } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import {
  BookOpen,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Clock3,
  Edit3,
  Image as ImageIcon,
  NotebookPen,
  RefreshCw,
  Star,
  Trash2,
  Utensils,
  X,
} from 'lucide-react-native'
import { getMealTypeLabel, inferDefaultMealTypeFromLocalTime, type MealType, type RecipeItem } from '@food-link/core'
import { apiClient, getStoredUserId } from '../api'
import type { RootStackParamList } from '../navigation/types'
import { AppAlert as Alert, useAppDialog } from '../providers/DialogProvider'
import { useColorScheme } from '../providers/ColorSchemeProvider'
import { colors } from '../theme'
import { todayKey } from '../utils/date'
import { emitHomeIntakeDataChangedEvent } from '../utils/home-events'
import { refreshHomeDashboardLocalSnapshotFromCloud } from '../utils/home-dashboard-local-cache'
import { userFacingErrorMessage } from '../utils/errors'

const mealOptions: MealType[] = ['breakfast', 'morning_snack', 'lunch', 'afternoon_snack', 'dinner', 'evening_snack']

type BusyAction = { recipeId: string; kind: 'record' | 'delete' | 'nutrition' } | null

type NutritionDraft = {
  calories: string
  protein: string
  carbs: string
  fat: string
}

type RecipePalette = {
  background: string
  surface: string
  surfaceMuted: string
  surfaceRaised: string
  text: string
  textSecondary: string
  textMuted: string
  border: string
  divider: string
  accent: string
  accentStrong: string
  accentSoft: string
  accentBorder: string
  danger: string
  dangerSoft: string
  warning: string
  scrim: string
  imageFallback: string
  input: string
  placeholder: string
  shadow: string
}

type MicroMeta = {
  key: string
  label: string
  unit: string
  aliases?: string[]
}

type MicroRow = MicroMeta & { value: number }

const microMeta: MicroMeta[] = [
  { key: 'fiber', label: '膳食纤维', unit: 'g' },
  { key: 'sugar', label: '糖', unit: 'g' },
  { key: 'sodium_mg', label: '钠', unit: 'mg', aliases: ['sodiumMg'] },
  { key: 'potassiumMg', label: '钾', unit: 'mg' },
  { key: 'calciumMg', label: '钙', unit: 'mg' },
  { key: 'ironMg', label: '铁', unit: 'mg' },
  { key: 'magnesiumMg', label: '镁', unit: 'mg' },
  { key: 'zincMg', label: '锌', unit: 'mg' },
  { key: 'vitaminARaeMcg', label: '维生素A', unit: 'mcg' },
  { key: 'vitaminCMg', label: '维生素C', unit: 'mg' },
  { key: 'vitaminDMcg', label: '维生素D', unit: 'mcg' },
  { key: 'vitaminEMg', label: '维生素E', unit: 'mg' },
  { key: 'vitaminKMcg', label: '维生素K', unit: 'mcg' },
  { key: 'thiaminMg', label: '维生素B1', unit: 'mg' },
  { key: 'riboflavinMg', label: '维生素B2', unit: 'mg' },
  { key: 'niacinMg', label: '烟酸', unit: 'mg' },
  { key: 'vitaminB6Mg', label: '维生素B6', unit: 'mg' },
  { key: 'folateMcg', label: '叶酸', unit: 'mcg' },
  { key: 'vitaminB12Mcg', label: '维生素B12', unit: 'mcg' },
]

function createRecipePalette(isDark: boolean): RecipePalette {
  return isDark
    ? {
        background: '#0d1312', surface: '#161e1b', surfaceMuted: '#1c2622', surfaceRaised: '#202c27',
        text: '#f2f7f4', textSecondary: '#b7c5bf', textMuted: '#8fa098', border: '#2d3a35', divider: '#29352f',
        accent: '#6ee7b7', accentStrong: '#35c990', accentSoft: '#183b30', accentBorder: '#285e4b',
        danger: '#fda4af', dangerSoft: '#40252a', warning: '#fcd34d', scrim: 'rgba(0,0,0,0.62)',
        imageFallback: '#202a26', input: '#111815', placeholder: '#718078', shadow: '#000000',
      }
    : {
        background: '#f5f7fa', surface: '#ffffff', surfaceMuted: '#f8fafc', surfaceRaised: '#ffffff',
        text: '#0f172a', textSecondary: '#526177', textMuted: '#7d8ba0', border: '#dde5ec', divider: '#edf1f5',
        accent: '#00a96f', accentStrong: colors.brand, accentSoft: '#eafaf4', accentBorder: '#b9ead7',
        danger: '#dc2626', dangerSoft: '#fff1f2', warning: '#b45309', scrim: 'rgba(15,23,42,0.52)',
        imageFallback: '#eef2f6', input: '#f8fafc', placeholder: '#94a3b8', shadow: '#0f172a',
      }
}

function useReduceMotionFlag() {
  const [reduceMotion, setReduceMotion] = useState(false)
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
  return reduceMotion
}
export function RecipesScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  const insets = useSafeAreaInsets()
  const { width } = useWindowDimensions()
  const { isDark } = useColorScheme()
  const palette = useMemo(() => createRecipePalette(isDark), [isDark])
  const reduceMotion = useReduceMotionFlag()
  const { confirm } = useAppDialog()
  const requestGeneration = useRef(0)
  const [recipes, setRecipes] = useState<RecipeItem[]>([])
  const [initialLoading, setInitialLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  const [busyAction, setBusyAction] = useState<BusyAction>(null)
  const [mealSheetRecipe, setMealSheetRecipe] = useState<RecipeItem | null>(null)
  const [mealSheetValue, setMealSheetValue] = useState<MealType>(inferDefaultMealTypeFromLocalTime())
  const [nutritionRecipe, setNutritionRecipe] = useState<RecipeItem | null>(null)
  const [nutritionDraft, setNutritionDraft] = useState<NutritionDraft>({ calories: '0', protein: '0', carbs: '0', fat: '0' })
  const compact = width < 390

  const load = useCallback(async (kind: 'initial' | 'refresh' | 'focus' = 'initial') => {
    const generation = ++requestGeneration.current
    if (kind === 'refresh') setRefreshing(true)
    else if (recipes.length === 0) setInitialLoading(true)
    try {
      const data = await apiClient.listRecipes({ isFavorite: true })
      if (generation !== requestGeneration.current) return
      setRecipes((data.recipes || []).filter((recipe) => recipe.is_favorite !== false))
      setError('')
    } catch (loadError) {
      if (generation !== requestGeneration.current) return
      setError(userFacingErrorMessage(loadError))
    } finally {
      if (generation === requestGeneration.current) {
        setInitialLoading(false)
        setRefreshing(false)
      }
    }
  }, [recipes.length])

  useFocusEffect(useCallback(() => {
    void load(recipes.length === 0 ? 'initial' : 'focus')
    return () => {
      requestGeneration.current += 1
    }
  }, [load, recipes.length]))

  const updateNutritionDraft = (key: keyof NutritionDraft, value: string) => {
    setNutritionDraft((current) => {
      if (key === 'calories') {
        const nextCalories = parseDraftNumber(value)
        if (nextCalories == null) return { ...current, calories: value }
        const protein = parseDraftNumber(current.protein) ?? 0
        const carbs = parseDraftNumber(current.carbs) ?? 0
        const fat = parseDraftNumber(current.fat) ?? 0
        const macroCalories = calculateCalories(protein, carbs, fat)
        if (macroCalories <= 0) return { ...current, calories: formatNumber(nextCalories) }
        const scale = nextCalories / macroCalories
        return {
          calories: formatNumber(nextCalories),
          protein: formatNumber(protein * scale),
          carbs: formatNumber(carbs * scale),
          fat: formatNumber(fat * scale),
        }
      }
      const next = { ...current, [key]: value }
      const protein = parseDraftNumber(next.protein)
      const carbs = parseDraftNumber(next.carbs)
      const fat = parseDraftNumber(next.fat)
      if (protein == null || carbs == null || fat == null) return next
      return { ...next, calories: formatNumber(calculateCalories(protein, carbs, fat)) }
    })
  }

  const openNutritionEditor = (recipe: RecipeItem) => {
    setNutritionRecipe(recipe)
    setNutritionDraft({
      calories: formatNumber(recipe.total_calories),
      protein: formatNumber(recipe.total_protein),
      carbs: formatNumber(recipe.total_carbs),
      fat: formatNumber(recipe.total_fat),
    })
  }

  const saveNutrition = async () => {
    if (!nutritionRecipe || busyAction) return
    const caloriesValue = parseDraftNumber(nutritionDraft.calories)
    const proteinValue = parseDraftNumber(nutritionDraft.protein)
    const carbsValue = parseDraftNumber(nutritionDraft.carbs)
    const fatValue = parseDraftNumber(nutritionDraft.fat)
    if ([caloriesValue, proteinValue, carbsValue, fatValue].some((value) => value == null)) {
      Alert.alert('数值有误', '营养数值需为不小于 0 的数字。')
      return
    }
    const recipe = nutritionRecipe
    setBusyAction({ recipeId: recipe.id, kind: 'nutrition' })
    try {
      const nextCalories = caloriesValue as number
      const nextProtein = proteinValue as number
      const nextCarbs = carbsValue as number
      const nextFat = fatValue as number
      const scales = {
        calories: ratioOrOne(nextCalories, recipe.total_calories),
        protein: ratioOrOne(nextProtein, recipe.total_protein),
        carbs: ratioOrOne(nextCarbs, recipe.total_carbs),
        fat: ratioOrOne(nextFat, recipe.total_fat),
        micro: ratioOrOne(nextCalories, recipe.total_calories),
      }
      const result = await apiClient.updateRecipe(recipe.id, {
        totalCalories: nextCalories,
        totalProtein: nextProtein,
        totalCarbs: nextCarbs,
        totalFat: nextFat,
        items: scaleRecipeItems(recipe.items, scales),
      })
      setRecipes((current) => current.map((item) => item.id === recipe.id ? result.recipe : item))
      setNutritionRecipe(null)
      AccessibilityInfo.announceForAccessibility('食谱营养已保存')
    } catch (saveError) {
      Alert.alert('保存失败', userFacingErrorMessage(saveError))
    } finally {
      setBusyAction(null)
    }
  }

  const openMealSheet = (recipe: RecipeItem) => {
    setMealSheetValue(normalizeMealType(recipe.meal_type) || inferDefaultMealTypeFromLocalTime())
    setMealSheetRecipe(recipe)
  }

  const recordRecipe = async () => {
    if (!mealSheetRecipe || busyAction) return
    const recipe = mealSheetRecipe
    setBusyAction({ recipeId: recipe.id, kind: 'record' })
    try {
      const result = await apiClient.useRecipe(recipe.id, mealSheetValue)
      const date = todayKey()
      await refreshHomeDashboardLocalSnapshotFromCloud(date)
      emitHomeIntakeDataChangedEvent({ date, force: true })
      setRecipes((current) => current.map((item) => item.id === recipe.id
        ? { ...item, use_count: (item.use_count || 0) + 1, last_used_at: new Date().toISOString() }
        : item))
      setMealSheetRecipe(null)
      Alert.alert('已记录', '食谱已写入今日饮食记录', result.record_id
        ? [
            { text: '回到首页', onPress: () => navigation.dispatch(CommonActions.navigate('MainTabs')) },
            { text: '查看记录', onPress: () => navigation.navigate('RecordDetail', { recordId: result.record_id }) },
          ]
        : [{ text: '回到首页', onPress: () => navigation.dispatch(CommonActions.navigate('MainTabs')) }])
    } catch (recordError) {
      Alert.alert('记录失败', userFacingErrorMessage(recordError))
    } finally {
      setBusyAction(null)
    }
  }

  const deleteRecipe = async (recipe: RecipeItem) => {
    if (busyAction) return
    const accepted = await confirm({
      title: '确认删除',
      message: `确定要删除食谱“${formatRecipeDisplayText(recipe.recipe_name) || '未命名食谱'}”吗？删除后无法恢复。`,
      kind: 'danger',
      confirmText: '删除',
    })
    if (!accepted) return
    setBusyAction({ recipeId: recipe.id, kind: 'delete' })
    try {
      await apiClient.deleteRecipe(recipe.id)
      setRecipes((current) => current.filter((item) => item.id !== recipe.id))
      AccessibilityInfo.announceForAccessibility('食谱已删除')
    } catch (deleteError) {
      Alert.alert('删除失败', userFacingErrorMessage(deleteError))
    } finally {
      setBusyAction(null)
    }
  }

  const busy = busyAction != null

  return (
    <View style={[styles.page, { backgroundColor: palette.background }]}>
      <View style={[styles.listHeader, { backgroundColor: palette.surface, borderBottomColor: palette.border }]}>
        <Text style={[styles.listTitle, { color: palette.text }]}>我的收藏</Text>
        <Text style={[styles.listSubtitle, { color: palette.textSecondary }]}>收藏过的餐食集中在这里，之后可以快速调整营养并记录。</Text>
      </View>

      <ScrollView
        style={styles.flex}
        contentContainerStyle={[styles.listContent, { paddingBottom: Math.max(insets.bottom, 16) + 28 }]}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load('refresh')} colors={[palette.accentStrong]} tintColor={palette.accent} />}
      >
        {error && recipes.length > 0 ? <InlineError message={`刷新失败：${error}`} palette={palette} onRetry={() => void load('refresh')} /> : null}
        {initialLoading && recipes.length === 0 ? (
          <View style={styles.centerState} accessibilityLabel="正在加载收藏食谱" accessibilityRole="progressbar">
            <ActivityIndicator color={palette.accent} size="small" />
          </View>
        ) : error && recipes.length === 0 ? (
          <ErrorState message={error} palette={palette} onRetry={() => void load('initial')} />
        ) : recipes.length === 0 ? (
          <View style={styles.centerState}>
            <View style={[styles.emptyIcon, { backgroundColor: palette.surfaceMuted, borderColor: palette.border }]}>
              <Star size={34} color={palette.textMuted} strokeWidth={1.8} />
            </View>
            <Text style={[styles.emptyTitle, { color: palette.text }]}>还没有收藏餐食</Text>
            <Text style={[styles.emptyText, { color: palette.textSecondary }]}>在分析结果页点击“收藏餐食”后，会显示在这里。</Text>
          </View>
        ) : (
          <View style={styles.cardList}>
            {recipes.map((recipe) => (
              <RecipeCard
                key={recipe.id}
                recipe={recipe}
                palette={palette}
                compact={compact}
                busyAction={busyAction}
                onOpen={() => navigation.navigate('RecipeDetail', { recipeId: recipe.id })}
                onNutrition={() => openNutritionEditor(recipe)}
                onDelete={() => void deleteRecipe(recipe)}
                onRecord={() => openMealSheet(recipe)}
              />
            ))}
          </View>
        )}
      </ScrollView>

      <MealSheet
        visible={mealSheetRecipe != null}
        recipe={mealSheetRecipe}
        value={mealSheetValue}
        palette={palette}
        insetsBottom={insets.bottom}
        busy={busyAction?.kind === 'record'}
        reduceMotion={reduceMotion}
        onChange={setMealSheetValue}
        onClose={() => { if (!busy) setMealSheetRecipe(null) }}
        onConfirm={() => void recordRecipe()}
      />
      <NutritionSheet
        recipe={nutritionRecipe}
        draft={nutritionDraft}
        palette={palette}
        insetsBottom={insets.bottom}
        busy={busyAction?.kind === 'nutrition'}
        reduceMotion={reduceMotion}
        compact={compact}
        onChange={updateNutritionDraft}
        onClose={() => { if (!busy) setNutritionRecipe(null) }}
        onSave={() => void saveNutrition()}
      />
    </View>
  )
}
function RecipeCard({ recipe, palette, compact, busyAction, onOpen, onNutrition, onDelete, onRecord }: {
  recipe: RecipeItem
  palette: RecipePalette
  compact: boolean
  busyAction: BusyAction
  onOpen: () => void
  onNutrition: () => void
  onDelete: () => void
  onRecord: () => void
}) {
  const rows = getRecipeMicroRows(recipe).slice(0, compact ? 3 : 4)
  const itemBusy = busyAction?.recipeId === recipe.id
  const name = formatRecipeDisplayText(recipe.recipe_name) || '未命名食谱'
  const meal = normalizeMealType(recipe.meal_type)
  return (
    <View style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.border, shadowColor: palette.shadow }]}>
      <Pressable
        onPress={onOpen}
        accessibilityRole="button"
        accessibilityLabel={`${name}，${formatNumber(recipe.total_calories)}千卡，查看详情`}
        accessibilityHint="打开食谱详情"
        style={({ pressed }) => [pressed && styles.pressed]}
      >
        <View style={[styles.cardImageWrap, { backgroundColor: palette.imageFallback }]}>
          {recipe.image_path ? (
            <Image source={{ uri: recipe.image_path }} style={styles.cardImage} resizeMode="cover" accessibilityLabel={`${name}食物图片`} />
          ) : (
            <View style={styles.imageFallback}>
              <ImageIcon size={34} color={palette.textMuted} strokeWidth={1.7} />
              <Text style={[styles.imageFallbackText, { color: palette.textMuted }]}>暂无图片</Text>
            </View>
          )}
          {recipe.is_favorite ? (
            <View style={[styles.favoriteBadge, { backgroundColor: palette.surfaceRaised, borderColor: palette.border }]}>
              <Star size={17} color={palette.warning} fill={palette.warning} strokeWidth={2} />
            </View>
          ) : null}
          {meal ? (
            <View style={styles.mealBadge}>
              <Text style={styles.mealBadgeText}>{getMealTypeLabel(meal)}</Text>
            </View>
          ) : null}
        </View>

        <View style={styles.cardBody}>
          <View style={styles.cardTitleRow}>
            <Text style={[styles.cardTitle, { color: palette.text }]} numberOfLines={2}>{name}</Text>
            <ChevronRight size={20} color={palette.textMuted} strokeWidth={2.1} />
          </View>
          {recipe.description ? <Text style={[styles.cardDescription, { color: palette.textSecondary }]} numberOfLines={2}>{formatRecipeDisplayText(recipe.description)}</Text> : null}
          <MacroSummary recipe={recipe} palette={palette} compact={compact} />
          {recipe.tags?.length ? (
            <View accessibilityLabel="食谱标签">
              <View style={styles.tagRow}>
                {recipe.tags.map((tag) => {
                  const label = formatRecipeTag(tag)
                  return label ? <Text key={tag} style={[styles.tag, { color: palette.textSecondary, backgroundColor: palette.surfaceMuted, borderColor: palette.border }]}>#{label}</Text> : null
                })}
              </View>
            </View>
          ) : null}
          {rows.length ? (
            <View style={[styles.microPreview, { backgroundColor: palette.accentSoft, borderColor: palette.accentBorder }]}>
              {rows.map((row) => (
                <View key={row.key} style={styles.microPreviewItem}>
                  <Text style={[styles.microLabel, { color: palette.textMuted }]} numberOfLines={1}>{row.label}</Text>
                  <Text style={[styles.microValue, { color: palette.text }]} numberOfLines={1}>{formatMicro(row.value)}{row.unit}</Text>
                </View>
              ))}
            </View>
          ) : null}
        </View>
      </Pressable>

      <View style={[styles.cardFooter, { borderTopColor: palette.divider }]}>
        <View style={styles.usageMeta} accessibilityLabel={`${formatLastUsed(recipe.last_used_at)}，用过${recipe.use_count || 0}次`}>
          <Clock3 size={14} color={palette.textMuted} strokeWidth={2.1} />
          <Text style={[styles.usageText, { color: palette.textMuted }]} numberOfLines={1}>{formatLastUsed(recipe.last_used_at)} · {recipe.use_count || 0}次</Text>
        </View>
        <View style={styles.cardActions}>
          <IconAction label="删除食谱" icon={<Trash2 size={19} color={palette.danger} strokeWidth={2.2} />} palette={palette} danger disabled={itemBusy} onPress={onDelete} />
          <IconAction label="编辑营养" icon={<Edit3 size={19} color={palette.textSecondary} strokeWidth={2.2} />} palette={palette} disabled={itemBusy} onPress={onNutrition} />
          <Pressable
            style={({ pressed }) => [styles.recordButton, { backgroundColor: palette.accentStrong }, itemBusy && styles.disabled, pressed && !itemBusy && styles.pressed]}
            onPress={onRecord}
            disabled={itemBusy}
            accessibilityRole="button"
            accessibilityLabel={`记录${name}`}
            accessibilityState={{ disabled: itemBusy, busy: itemBusy && busyAction?.kind === 'record' }}
          >
            {itemBusy && busyAction?.kind === 'record' ? <ActivityIndicator size="small" color="#fff" /> : <NotebookPen size={18} color="#fff" strokeWidth={2.3} />}
            <Text style={styles.recordButtonText}>记录</Text>
          </Pressable>
        </View>
      </View>
    </View>
  )
}

function IconAction({ label, icon, palette, danger = false, disabled = false, onPress }: { label: string; icon: ReactNode; palette: RecipePalette; danger?: boolean; disabled?: boolean; onPress: () => void }) {
  return (
    <Pressable
      style={({ pressed }) => [styles.iconAction, { backgroundColor: danger ? palette.dangerSoft : palette.surfaceMuted, borderColor: palette.border }, disabled && styles.disabled, pressed && !disabled && styles.pressed]}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
    >
      {icon}
    </Pressable>
  )
}

function MacroSummary({ recipe, palette, compact }: { recipe: RecipeItem; palette: RecipePalette; compact: boolean }) {
  const metrics = [
    { key: 'calories', label: '热量', value: formatNumber(recipe.total_calories), unit: 'kcal', accent: true },
    { key: 'protein', label: '蛋白质', value: formatNumber(recipe.total_protein), unit: 'g' },
    { key: 'carbs', label: '碳水', value: formatNumber(recipe.total_carbs), unit: 'g' },
    { key: 'fat', label: '脂肪', value: formatNumber(recipe.total_fat), unit: 'g' },
  ]
  return (
    <View style={[styles.macroSummary, compact && styles.macroSummaryCompact, { backgroundColor: palette.surfaceMuted, borderColor: palette.border }]} accessibilityLabel={metrics.map((item) => `${item.label}${item.value}${item.unit}`).join('，')}>
      {metrics.map((item) => (
        <View key={item.key} style={[styles.macroItem, compact && styles.macroItemCompact]}>
          <Text style={[styles.macroValue, { color: item.accent ? palette.accent : palette.text }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.72}>{item.value}<Text style={styles.macroUnit}> {item.unit}</Text></Text>
          <Text style={[styles.macroLabel, { color: palette.textMuted }]}>{item.label}</Text>
        </View>
      ))}
    </View>
  )
}

function MealSheet({ visible, recipe, value, palette, insetsBottom, busy, reduceMotion, onChange, onClose, onConfirm }: {
  visible: boolean
  recipe: RecipeItem | null
  value: MealType
  palette: RecipePalette
  insetsBottom: number
  busy: boolean
  reduceMotion: boolean
  onChange: (meal: MealType) => void
  onClose: () => void
  onConfirm: () => void
}) {
  return (
    <Modal visible={visible} transparent animationType={reduceMotion ? 'none' : 'fade'} statusBarTranslucent onRequestClose={onClose}>
      <Pressable style={[styles.modalBackdrop, { backgroundColor: palette.scrim }]} onPress={onClose} accessibilityLabel="关闭餐次选择">
        <Pressable style={[styles.sheet, { backgroundColor: palette.surfaceRaised, paddingBottom: Math.max(insetsBottom, 16) + 14 }]} onPress={(event) => event.stopPropagation()} accessibilityViewIsModal>
          <View style={[styles.sheetHandle, { backgroundColor: palette.border }]} />
          <Text style={[styles.sheetTitle, { color: palette.text }]}>选择餐次</Text>
          <Text style={[styles.sheetSubtitle, { color: palette.textSecondary }]} numberOfLines={2}>将“{formatRecipeDisplayText(recipe?.recipe_name) || '收藏食谱'}”记录为</Text>
          <View style={styles.mealGrid} accessibilityRole="radiogroup">
            {mealOptions.map((meal) => {
              const selected = value === meal
              return (
                <Pressable
                  key={meal}
                  style={({ pressed }) => [styles.mealOption, { backgroundColor: selected ? palette.accentStrong : palette.surfaceMuted, borderColor: selected ? palette.accentStrong : palette.border }, pressed && !busy && styles.pressed]}
                  onPress={() => onChange(meal)}
                  disabled={busy}
                  accessibilityRole="radio"
                  accessibilityLabel={getMealTypeLabel(meal)}
                  accessibilityState={{ selected, disabled: busy }}
                >
                  <Text style={[styles.mealOptionText, { color: selected ? '#fff' : palette.textSecondary }]}>{getMealTypeLabel(meal)}</Text>
                </Pressable>
              )
            })}
          </View>
          <View style={styles.sheetActions}>
            <Pressable style={({ pressed }) => [styles.sheetSecondary, { backgroundColor: palette.surfaceMuted, borderColor: palette.border }, busy && styles.disabled, pressed && !busy && styles.pressed]} onPress={onClose} disabled={busy} accessibilityRole="button" accessibilityLabel="取消记录">
              <Text style={[styles.sheetSecondaryText, { color: palette.textSecondary }]}>取消</Text>
            </Pressable>
            <Pressable style={({ pressed }) => [styles.sheetPrimary, { backgroundColor: palette.accentStrong }, busy && styles.disabled, pressed && !busy && styles.pressed]} onPress={onConfirm} disabled={busy} accessibilityRole="button" accessibilityLabel="确认记录" accessibilityState={{ disabled: busy, busy }}>
              {busy ? <ActivityIndicator size="small" color="#fff" /> : <NotebookPen size={19} color="#fff" strokeWidth={2.3} />}
              <Text style={styles.sheetPrimaryText}>{busy ? '正在记录' : '确认记录'}</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  )
}
function NutritionSheet({ recipe, draft, palette, insetsBottom, busy, reduceMotion, compact, onChange, onClose, onSave }: {
  recipe: RecipeItem | null
  draft: NutritionDraft
  palette: RecipePalette
  insetsBottom: number
  busy: boolean
  reduceMotion: boolean
  compact: boolean
  onChange: (key: keyof NutritionDraft, value: string) => void
  onClose: () => void
  onSave: () => void
}) {
  const originalCalories = Math.max(0, Number(recipe?.total_calories || 0))
  const currentCalories = parseDraftNumber(draft.calories) ?? originalCalories
  const microScale = originalCalories > 0 ? currentCalories / originalCalories : 1
  const rows = recipe ? getRecipeMicroRows(recipe).map((row) => ({ ...row, value: row.value * microScale })) : []
  const invalid = Object.values(draft).some((value) => parseDraftNumber(value) == null)
  return (
    <Modal visible={recipe != null} transparent animationType={reduceMotion ? 'none' : 'fade'} statusBarTranslucent onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Pressable style={[styles.modalBackdrop, { backgroundColor: palette.scrim }]} onPress={onClose} accessibilityLabel="关闭营养编辑">
          <Pressable style={[styles.sheet, styles.nutritionSheet, { backgroundColor: palette.surfaceRaised, paddingBottom: Math.max(insetsBottom, 16) + 12 }]} onPress={(event) => event.stopPropagation()} accessibilityViewIsModal>
            <View style={[styles.sheetHandle, { backgroundColor: palette.border }]} />
            <View style={styles.nutritionHeader}>
              <View style={styles.flexShrink}>
                <Text style={[styles.sheetTitle, styles.leftText, { color: palette.text }]} numberOfLines={2}>{formatRecipeDisplayText(recipe?.recipe_name) || '收藏食谱'}</Text>
                <Text style={[styles.sheetSubtitle, styles.leftText, { color: palette.textSecondary }]}>修改宏量营养；食材中的微量营养会按热量比例同步。</Text>
              </View>
              <Pressable style={({ pressed }) => [styles.closeButton, { backgroundColor: palette.surfaceMuted, borderColor: palette.border }, pressed && !busy && styles.pressed]} onPress={onClose} disabled={busy} accessibilityRole="button" accessibilityLabel="关闭">
                <X size={21} color={palette.textSecondary} strokeWidth={2.2} />
              </Pressable>
            </View>
            <ScrollView style={styles.nutritionScroll} contentContainerStyle={styles.nutritionScrollContent} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              <Text style={[styles.sectionEyebrow, { color: palette.textSecondary }]}>宏量营养素</Text>
              <View style={styles.inputGrid}>
                {([
                  ['calories', '热量', 'kcal'],
                  ['protein', '蛋白质', 'g'],
                  ['carbs', '碳水', 'g'],
                  ['fat', '脂肪', 'g'],
                ] as Array<[keyof NutritionDraft, string, string]>).map(([key, label, unit]) => (
                  <View key={key} style={[styles.inputCell, compact && styles.inputCellCompact]}>
                    <Text style={[styles.inputLabel, { color: palette.textSecondary }]}>{label}</Text>
                    <View style={[styles.inputWrap, { backgroundColor: palette.input, borderColor: invalid && parseDraftNumber(draft[key]) == null ? palette.danger : palette.border }]}>
                      <TextInput
                        value={draft[key]}
                        onChangeText={(value) => onChange(key, value)}
                        keyboardType="decimal-pad"
                        editable={!busy}
                        selectTextOnFocus
                        placeholder="0"
                        placeholderTextColor={palette.placeholder}
                        style={[styles.input, { color: palette.text }]}
                        accessibilityLabel={`${label}，单位${unit}`}
                      />
                      <Text style={[styles.inputUnit, { color: palette.textMuted }]}>{unit}</Text>
                    </View>
                    {parseDraftNumber(draft[key]) == null ? <Text style={[styles.inputError, { color: palette.danger }]}>请输入不小于 0 的数字</Text> : null}
                  </View>
                ))}
              </View>
              {rows.length ? (
                <>
                  <Text style={[styles.sectionEyebrow, styles.microHeading, { color: palette.textSecondary }]}>微量营养素</Text>
                  <View style={[styles.microGrid, { backgroundColor: palette.surfaceMuted, borderColor: palette.border }]}>
                    {rows.map((row) => (
                      <View key={row.key} style={styles.microGridItem}>
                        <Text style={[styles.microGridLabel, { color: palette.textMuted }]} numberOfLines={1}>{row.label}</Text>
                        <Text style={[styles.microGridValue, { color: palette.text }]} numberOfLines={1}>{formatMicro(row.value)} {row.unit}</Text>
                      </View>
                    ))}
                  </View>
                </>
              ) : null}
            </ScrollView>
            <View style={styles.sheetActions}>
              <Pressable style={({ pressed }) => [styles.sheetSecondary, { backgroundColor: palette.surfaceMuted, borderColor: palette.border }, busy && styles.disabled, pressed && !busy && styles.pressed]} onPress={onClose} disabled={busy} accessibilityRole="button" accessibilityLabel="取消营养修改">
                <Text style={[styles.sheetSecondaryText, { color: palette.textSecondary }]}>取消</Text>
              </Pressable>
              <Pressable style={({ pressed }) => [styles.sheetPrimary, { backgroundColor: palette.accentStrong }, (busy || invalid) && styles.disabled, pressed && !busy && !invalid && styles.pressed]} onPress={onSave} disabled={busy || invalid} accessibilityRole="button" accessibilityLabel="保存营养修改" accessibilityState={{ disabled: busy || invalid, busy }}>
                {busy ? <ActivityIndicator size="small" color="#fff" /> : <Edit3 size={19} color="#fff" strokeWidth={2.3} />}
                <Text style={styles.sheetPrimaryText}>{busy ? '正在保存' : '保存修改'}</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  )
}

export function RecipeDetailScreen() {
  const route = useRoute<RouteProp<RootStackParamList, 'RecipeDetail'>>()
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  const insets = useSafeAreaInsets()
  const { width } = useWindowDimensions()
  const { isDark } = useColorScheme()
  const palette = useMemo(() => createRecipePalette(isDark), [isDark])
  const reduceMotion = useReduceMotionFlag()
  const { confirm } = useAppDialog()
  const [recipe, setRecipe] = useState<RecipeItem | null>(null)
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  const [action, setAction] = useState<'record' | 'delete' | null>(null)
  const [previewVisible, setPreviewVisible] = useState(false)
  const [microsExpanded, setMicrosExpanded] = useState(false)
  const compact = width < 390

  const load = useCallback(async (refresh = false) => {
    if (refresh) setRefreshing(true)
    else if (!recipe) setLoading(true)
    try {
      const next = await apiClient.getRecipe(route.params.recipeId)
      setRecipe(next)
      setError('')
    } catch (loadError) {
      setError(userFacingErrorMessage(loadError))
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [recipe, route.params.recipeId])

  useEffect(() => {
    void load()
    void getStoredUserId().then(setCurrentUserId)
  }, [route.params.recipeId])

  useFocusEffect(useCallback(() => {
    if (recipe) void load(true)
  }, [recipe?.id]))

  const recordRecipe = async () => {
    if (!recipe || action) return
    setAction('record')
    try {
      const mealType = normalizeMealType(recipe.meal_type) || 'afternoon_snack'
      const result = await apiClient.useRecipe(recipe.id, mealType)
      const date = todayKey()
      await refreshHomeDashboardLocalSnapshotFromCloud(date)
      emitHomeIntakeDataChangedEvent({ date, force: true })
      setRecipe((current) => current ? { ...current, use_count: (current.use_count || 0) + 1, last_used_at: new Date().toISOString() } : current)
      Alert.alert('已记录', '食谱已写入今日饮食记录', result.record_id
        ? [{ text: '完成' }, { text: '查看记录', onPress: () => navigation.navigate('RecordDetail', { recordId: result.record_id }) }]
        : [{ text: '完成' }])
    } catch (recordError) {
      Alert.alert('记录失败', userFacingErrorMessage(recordError))
    } finally {
      setAction(null)
    }
  }

  const deleteRecipe = async () => {
    if (!recipe || action) return
    const accepted = await confirm({ title: '确认删除', message: '删除后无法恢复，确定要删除这个收藏吗？', kind: 'danger', confirmText: '删除' })
    if (!accepted) return
    setAction('delete')
    try {
      await apiClient.deleteRecipe(recipe.id)
      navigation.goBack()
    } catch (deleteError) {
      Alert.alert('删除失败', userFacingErrorMessage(deleteError))
    } finally {
      setAction(null)
    }
  }

  if (loading && !recipe) {
    return (
      <View style={[styles.page, styles.centerState, { backgroundColor: palette.background }]} accessibilityRole="progressbar" accessibilityLabel="正在加载食谱详情">
        <ActivityIndicator color={palette.accent} size="small" />
      </View>
    )
  }

  if (!recipe) {
    return (
      <View style={[styles.page, { backgroundColor: palette.background }]}>
        {error ? <ErrorState message={error} palette={palette} onRetry={() => void load()} /> : (
          <View style={styles.centerState}>
            <BookOpen size={38} color={palette.textMuted} strokeWidth={1.8} />
            <Text style={[styles.emptyTitle, { color: palette.text }]}>食谱不存在或已删除</Text>
          </View>
        )}
      </View>
    )
  }
  const isOwner = Boolean(currentUserId && recipe.user_id === currentUserId)
  const name = formatRecipeDisplayText(recipe.recipe_name) || '未命名食谱'
  const meal = normalizeMealType(recipe.meal_type)
  const microRows = getRecipeMicroRows(recipe)
  const visibleMicros = microsExpanded ? microRows : microRows.slice(0, 8)
  const bottomBarHeight = isOwner ? Math.max(insets.bottom, 12) + 84 : 20

  return (
    <View style={[styles.page, { backgroundColor: palette.background }]}>
      <ScrollView
        style={styles.flex}
        contentContainerStyle={{ paddingBottom: bottomBarHeight + 22 }}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} colors={[palette.accentStrong]} tintColor={palette.accent} />}
      >
        {error ? <InlineError message={`刷新失败：${error}`} palette={palette} onRetry={() => void load(true)} /> : null}
        <View style={[styles.detailHeader, { backgroundColor: palette.surface, borderBottomColor: palette.border }]}>
          <View style={styles.detailTitleRow}>
            <Text style={[styles.detailTitle, { color: palette.text }]}>{name}</Text>
            {recipe.is_favorite !== false ? (
              <View style={[styles.detailFavoriteBadge, { backgroundColor: palette.accentSoft, borderColor: palette.accentBorder }]}>
                <Star size={14} color={palette.accent} fill={palette.accent} strokeWidth={2} />
                <Text style={[styles.detailFavoriteText, { color: palette.accent }]}>收藏</Text>
              </View>
            ) : null}
          </View>
          <View style={styles.detailMetaRow}>
            <View style={[styles.metaPill, { backgroundColor: palette.surfaceMuted, borderColor: palette.border }]}>
              <Utensils size={15} color={palette.textSecondary} strokeWidth={2} />
              <Text style={[styles.metaPillText, { color: palette.textSecondary }]}>{meal ? getMealTypeLabel(meal) : recipe.meal_type || '未指定餐次'}</Text>
            </View>
            <View style={[styles.metaPill, { backgroundColor: palette.surfaceMuted, borderColor: palette.border }]}>
              <Clock3 size={15} color={palette.textSecondary} strokeWidth={2} />
              <Text style={[styles.metaPillText, { color: palette.textSecondary }]}>用过 {recipe.use_count || 0} 次</Text>
            </View>
          </View>
          {recipe.tags?.length ? (
            <View style={styles.tagRow}>
              {recipe.tags.map((tag) => {
                const label = formatRecipeTag(tag)
                return label ? <Text key={tag} style={[styles.tag, { color: palette.textSecondary, backgroundColor: palette.surfaceMuted, borderColor: palette.border }]}>#{label}</Text> : null
              })}
            </View>
          ) : null}
        </View>

        {recipe.image_path ? (
          <Pressable onPress={() => setPreviewVisible(true)} accessibilityRole="imagebutton" accessibilityLabel={`${name}图片，点按全屏查看`} style={({ pressed }) => [styles.detailImageWrap, { backgroundColor: palette.imageFallback }, pressed && styles.pressed]}>
            <Image source={{ uri: recipe.image_path }} style={styles.detailImage} resizeMode="cover" accessibilityLabel={`${name}食物图片`} />
            <View style={styles.imagePreviewHint}><ImageIcon size={17} color="#fff" strokeWidth={2.2} /><Text style={styles.imagePreviewHintText}>查看大图</Text></View>
          </Pressable>
        ) : null}

        <DetailSection title="营养摘要" palette={palette}>
          <MacroSummary recipe={recipe} palette={palette} compact={compact} />
        </DetailSection>

        {microRows.length ? (
          <DetailSection title="微量营养" palette={palette}>
            <View style={[styles.detailMicroGrid, { backgroundColor: palette.surfaceMuted, borderColor: palette.border }]}>
              {visibleMicros.map((row) => (
                <View key={row.key} style={styles.detailMicroItem}>
                  <Text style={[styles.detailMicroLabel, { color: palette.textMuted }]}>{row.label}</Text>
                  <Text style={[styles.detailMicroValue, { color: palette.text }]}>{formatMicro(row.value)} {row.unit}</Text>
                </View>
              ))}
            </View>
            {microRows.length > 8 ? (
              <Pressable style={({ pressed }) => [styles.expandButton, { backgroundColor: palette.surfaceMuted, borderColor: palette.border }, pressed && styles.pressed]} onPress={() => setMicrosExpanded((current) => !current)} accessibilityRole="button" accessibilityLabel={microsExpanded ? '收起微量营养' : `展开全部${microRows.length}项微量营养`} accessibilityState={{ expanded: microsExpanded }}>
                <Text style={[styles.expandButtonText, { color: palette.textSecondary }]}>{microsExpanded ? '收起' : `查看全部 ${microRows.length} 项`}</Text>
                {microsExpanded ? <ChevronUp size={18} color={palette.textSecondary} /> : <ChevronDown size={18} color={palette.textSecondary} />}
              </Pressable>
            ) : null}
          </DetailSection>
        ) : null}

        {recipe.items?.length ? (
          <DetailSection title={`食材 / 分量（${recipe.items.length}）`} palette={palette}>
            <View style={styles.ingredientList}>
              {recipe.items.map((item, index) => {
                const info = readRecipeItem(item)
                return (
                  <View key={`${info.name}-${index}`} style={[styles.ingredientRow, { backgroundColor: palette.surfaceMuted, borderColor: palette.border }]}>
                    <View style={styles.flexShrink}>
                      <Text style={[styles.ingredientName, { color: palette.text }]}>{info.name}</Text>
                      <Text style={[styles.ingredientWeight, { color: palette.textSecondary }]}>{formatNumber(info.weight)} g</Text>
                    </View>
                    <Text style={[styles.ingredientCalories, { color: palette.warning }]}>{formatNumber(info.calories)} kcal</Text>
                  </View>
                )
              })}
            </View>
          </DetailSection>
        ) : null}

        {recipe.description ? (
          <DetailSection title="备注" palette={palette}>
            <Text style={[styles.detailDescription, { color: palette.textSecondary }]}>{formatRecipeDisplayText(recipe.description)}</Text>
          </DetailSection>
        ) : null}
      </ScrollView>

      {isOwner ? (
        <View style={[styles.detailActions, { backgroundColor: palette.surfaceRaised, borderTopColor: palette.border, paddingBottom: Math.max(insets.bottom, 12) }]}>
          <Pressable style={({ pressed }) => [styles.detailSecondaryButton, { backgroundColor: palette.surfaceMuted, borderColor: palette.border }, action && styles.disabled, pressed && !action && styles.pressed]} onPress={() => navigation.navigate('RecipeEdit', { recipeId: recipe.id })} disabled={action != null} accessibilityRole="button" accessibilityLabel="编辑食谱">
            <Edit3 size={19} color={palette.textSecondary} strokeWidth={2.2} />
            <Text style={[styles.detailSecondaryText, { color: palette.textSecondary }]}>编辑</Text>
          </Pressable>
          <Pressable style={({ pressed }) => [styles.detailDangerButton, { backgroundColor: palette.dangerSoft, borderColor: palette.border }, action && styles.disabled, pressed && !action && styles.pressed]} onPress={() => void deleteRecipe()} disabled={action != null} accessibilityRole="button" accessibilityLabel="删除食谱" accessibilityState={{ disabled: action != null, busy: action === 'delete' }}>
            {action === 'delete' ? <ActivityIndicator size="small" color={palette.danger} /> : <Trash2 size={19} color={palette.danger} strokeWidth={2.2} />}
          </Pressable>
          <Pressable style={({ pressed }) => [styles.detailPrimaryButton, { backgroundColor: palette.accentStrong }, action && styles.disabled, pressed && !action && styles.pressed]} onPress={() => void recordRecipe()} disabled={action != null} accessibilityRole="button" accessibilityLabel={`一键记录${name}`} accessibilityState={{ disabled: action != null, busy: action === 'record' }}>
            {action === 'record' ? <ActivityIndicator size="small" color="#fff" /> : <NotebookPen size={20} color="#fff" strokeWidth={2.3} />}
            <Text style={styles.detailPrimaryText}>{action === 'record' ? '记录中' : '一键记录'}</Text>
          </Pressable>
        </View>
      ) : null}

      <Modal visible={previewVisible} transparent animationType={reduceMotion ? 'none' : 'fade'} statusBarTranslucent onRequestClose={() => setPreviewVisible(false)}>
        <View style={styles.previewPage} accessibilityViewIsModal>
          <Image source={{ uri: recipe.image_path || '' }} style={styles.previewImage} resizeMode="contain" accessibilityLabel={`${name}全屏图片`} />
          <Pressable style={({ pressed }) => [styles.previewClose, pressed && styles.pressed]} onPress={() => setPreviewVisible(false)} accessibilityRole="button" accessibilityLabel="关闭图片预览">
            <X size={24} color="#fff" strokeWidth={2.2} />
          </Pressable>
        </View>
      </Modal>
    </View>
  )
}

function DetailSection({ title, palette, children }: { title: string; palette: RecipePalette; children: ReactNode }) {
  return (
    <View style={[styles.detailSection, { backgroundColor: palette.surface, borderColor: palette.border }]}>
      <Text style={[styles.detailSectionTitle, { color: palette.text }]}>{title}</Text>
      {children}
    </View>
  )
}

function InlineError({ message, palette, onRetry }: { message: string; palette: RecipePalette; onRetry: () => void }) {
  return (
    <View style={[styles.inlineError, { backgroundColor: palette.dangerSoft, borderColor: palette.danger }]} accessibilityRole="alert">
      <Text style={[styles.inlineErrorText, { color: palette.danger }]} numberOfLines={3}>{message}</Text>
      <Pressable style={({ pressed }) => [styles.inlineRetry, pressed && styles.pressed]} onPress={onRetry} accessibilityRole="button" accessibilityLabel="重试加载">
        <RefreshCw size={17} color={palette.danger} strokeWidth={2.2} />
        <Text style={[styles.inlineRetryText, { color: palette.danger }]}>重试</Text>
      </Pressable>
    </View>
  )
}

function ErrorState({ message, palette, onRetry }: { message: string; palette: RecipePalette; onRetry: () => void }) {
  return (
    <View style={styles.centerState} accessibilityRole="alert">
      <View style={[styles.emptyIcon, { backgroundColor: palette.dangerSoft, borderColor: palette.danger }]}>
        <BookOpen size={31} color={palette.danger} strokeWidth={1.9} />
      </View>
      <Text style={[styles.emptyTitle, { color: palette.text }]}>收藏食谱加载失败</Text>
      <Text style={[styles.emptyText, { color: palette.textSecondary }]}>{message}</Text>
      <Pressable style={({ pressed }) => [styles.retryButton, { backgroundColor: palette.accentStrong }, pressed && styles.pressed]} onPress={onRetry} accessibilityRole="button" accessibilityLabel="重新加载收藏食谱">
        <RefreshCw size={19} color="#fff" strokeWidth={2.2} />
        <Text style={styles.retryButtonText}>重新加载</Text>
      </Pressable>
    </View>
  )
}
function getRecipeMicroRows(recipe: RecipeItem): MicroRow[] {
  const totals = (recipe.items || []).reduce<Record<string, number>>((result, rawItem) => {
    const item = rawItem || {}
    const nutrients = item.nutrients && typeof item.nutrients === 'object' ? item.nutrients as Record<string, unknown> : {}
    const rawRatio = Number(item.ratio)
    const ratio = Number.isFinite(rawRatio) ? Math.max(0, rawRatio) / 100 : 1
    for (const meta of microMeta) {
      const keys = [meta.key, ...(meta.aliases || [])]
      const value = keys.map((key) => Number(nutrients[key])).find((candidate) => Number.isFinite(candidate) && candidate > 0) || 0
      if (value > 0) result[meta.key] = (result[meta.key] || 0) + value * ratio
    }
    return result
  }, {})
  return microMeta.map((meta) => ({ ...meta, value: resultNumber(totals[meta.key]) })).filter((row) => row.value > 0)
}

function scaleRecipeItems(items: RecipeItem['items'], scales: { calories: number; protein: number; carbs: number; fat: number; micro: number }) {
  return (items || []).map((rawItem) => {
    const item = rawItem || {}
    const nutrients = item.nutrients && typeof item.nutrients === 'object' ? { ...(item.nutrients as Record<string, unknown>) } : {}
    Object.keys(nutrients).forEach((key) => {
      const value = Number(nutrients[key])
      if (!Number.isFinite(value)) return
      const scale = key === 'calories' ? scales.calories : key === 'protein' ? scales.protein : key === 'carbs' ? scales.carbs : key === 'fat' ? scales.fat : scales.micro
      nutrients[key] = Math.round(value * scale * 100) / 100
    })
    if (nutrients.sodium_mg == null && nutrients.sodiumMg != null) nutrients.sodium_mg = nutrients.sodiumMg
    if (nutrients.sodiumMg == null && nutrients.sodium_mg != null) nutrients.sodiumMg = nutrients.sodium_mg
    return { ...item, nutrients }
  })
}

function readRecipeItem(item: Record<string, unknown>) {
  const nutrients = item.nutrients && typeof item.nutrients === 'object' ? item.nutrients as Record<string, unknown> : {}
  return {
    name: formatRecipeDisplayText(String(item.name || item.food_name || '食物')) || '食物',
    weight: resultNumber(item.weight || item.weight_grams || item.amount),
    calories: resultNumber(nutrients.calories || item.calories),
  }
}

function normalizeMealType(value?: string | null): MealType | null {
  return mealOptions.includes(value as MealType) ? value as MealType : value === 'snack' ? 'afternoon_snack' : null
}

function calculateCalories(protein: number, carbs: number, fat: number) {
  return Math.round((protein * 4 + carbs * 4 + fat * 9) * 10) / 10
}

function parseDraftNumber(value: string): number | null {
  if (String(value).trim() === '') return null
  const numeric = Number(value)
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : null
}

function ratioOrOne(next: number, original?: number | null) {
  const base = Number(original || 0)
  return base > 0 ? next / base : 1
}

function resultNumber(value: unknown) {
  const numeric = Number(value || 0)
  return Number.isFinite(numeric) && numeric > 0 ? numeric : 0
}

function formatNumber(value?: number | null): string {
  const numeric = Math.max(0, Number(value || 0))
  const rounded = Math.round(numeric * 10) / 10
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)
}

function formatMicro(value: number): string {
  if (value >= 10) return String(Math.round(value))
  if (value >= 1) return String(Math.round(value * 10) / 10)
  return String(Math.round(value * 100) / 100)
}

function formatRecipeDisplayText(value?: string | null) {
  return String(value || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/<\/?[^>]+>/g, ' ')
    .replace(/^\s{0,3}#{1,6}\s*/gm, '')
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/([*_~`])([^]*?)\1/g, '$2')
    .replace(/\s+/g, ' ')
    .trim()
}

function formatRecipeTag(value: string) {
  return formatRecipeDisplayText(value).replace(/^#+\s*/, '').trim()
}

function formatLastUsed(value?: string | null) {
  if (!value) return '未使用'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '未使用'
  return `${date.getMonth() + 1}月${date.getDate()}日`
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  flexShrink: { flex: 1, minWidth: 0 },
  page: { flex: 1 },
  pressed: { opacity: 0.72 },
  disabled: { opacity: 0.5 },
  leftText: { textAlign: 'left' },
  listHeader: { paddingHorizontal: 18, paddingTop: 18, paddingBottom: 16, borderBottomWidth: StyleSheet.hairlineWidth },
  listTitle: { fontSize: 22, lineHeight: 29, fontWeight: '800' },
  listSubtitle: { marginTop: 6, fontSize: 14, lineHeight: 21 },
  listContent: { paddingTop: 14 },
  cardList: { paddingHorizontal: 16, gap: 16 },
  centerState: { minHeight: 430, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28, gap: 12 },
  emptyIcon: { width: 68, height: 68, borderRadius: 34, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  emptyTitle: { marginTop: 4, fontSize: 18, lineHeight: 25, fontWeight: '800', textAlign: 'center' },
  emptyText: { maxWidth: 320, fontSize: 14, lineHeight: 22, textAlign: 'center' },
  retryButton: { minHeight: 48, marginTop: 8, borderRadius: 14, paddingHorizontal: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  retryButtonText: { color: '#fff', fontSize: 15, lineHeight: 21, fontWeight: '800' },
  inlineError: { minHeight: 52, marginHorizontal: 16, marginBottom: 12, borderRadius: 14, borderWidth: 1, paddingLeft: 14, paddingRight: 6, paddingVertical: 6, flexDirection: 'row', alignItems: 'center', gap: 8 },
  inlineErrorText: { flex: 1, minWidth: 0, fontSize: 13, lineHeight: 19, fontWeight: '600' },
  inlineRetry: { minWidth: 72, minHeight: 44, borderRadius: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5 },
  inlineRetryText: { fontSize: 13, fontWeight: '800' },
  card: { overflow: 'hidden', borderRadius: 18, borderWidth: 1, shadowOpacity: 0.07, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 2 },
  cardImageWrap: { width: '100%', height: 176, position: 'relative', overflow: 'hidden' },
  cardImage: { width: '100%', height: '100%' },
  imageFallback: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
  imageFallbackText: { fontSize: 13, lineHeight: 18, fontWeight: '600' },
  favoriteBadge: { position: 'absolute', top: 12, right: 12, width: 36, height: 36, borderRadius: 18, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  mealBadge: { position: 'absolute', top: 12, left: 12, minHeight: 30, borderRadius: 15, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(15,23,42,0.74)' },
  mealBadgeText: { color: '#fff', fontSize: 12, lineHeight: 17, fontWeight: '700' },
  cardBody: { padding: 16, gap: 12 },
  cardTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cardTitle: { flex: 1, fontSize: 19, lineHeight: 27, fontWeight: '800' },
  cardDescription: { fontSize: 14, lineHeight: 21 },
  macroSummary: { minHeight: 82, borderRadius: 14, borderWidth: 1, padding: 10, flexDirection: 'row', alignItems: 'stretch', gap: 6 },
  macroSummaryCompact: { flexWrap: 'wrap' },
  macroItem: { flex: 1, minWidth: 0, alignItems: 'center', justifyContent: 'center', gap: 4 },
  macroItemCompact: { flexBasis: '47%', minHeight: 54 },
  macroValue: { fontSize: 17, lineHeight: 22, fontWeight: '800', fontVariant: ['tabular-nums'] },
  macroUnit: { fontSize: 10, fontWeight: '700' },
  macroLabel: { fontSize: 11, lineHeight: 15 },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  tag: { overflow: 'hidden', borderRadius: 999, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 5, fontSize: 12, lineHeight: 17 },
  microPreview: { minHeight: 60, borderWidth: 1, borderRadius: 14, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 8 },
  microPreviewItem: { flex: 1, minWidth: 0, alignItems: 'center', gap: 3 },
  microLabel: { maxWidth: '100%', fontSize: 10, lineHeight: 14 },
  microValue: { maxWidth: '100%', fontSize: 12, lineHeight: 17, fontWeight: '800', fontVariant: ['tabular-nums'] },
  cardFooter: { minHeight: 72, borderTopWidth: 1, paddingHorizontal: 12, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 8 },
  usageMeta: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 5 },
  usageText: { flex: 1, fontSize: 11, lineHeight: 16 },
  cardActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  iconAction: { width: 48, height: 48, borderRadius: 14, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  recordButton: { minWidth: 82, height: 48, borderRadius: 14, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
  recordButtonText: { color: '#fff', fontSize: 14, lineHeight: 19, fontWeight: '800' },  modalBackdrop: { flex: 1, justifyContent: 'flex-end' },
  sheet: { width: '100%', maxHeight: '90%', borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 18, paddingTop: 10 },
  sheetHandle: { alignSelf: 'center', width: 40, height: 5, borderRadius: 999, marginBottom: 14 },
  sheetTitle: { fontSize: 20, lineHeight: 27, fontWeight: '800', textAlign: 'center' },
  sheetSubtitle: { marginTop: 6, fontSize: 13, lineHeight: 20, textAlign: 'center' },
  mealGrid: { marginTop: 18, flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  mealOption: { flexBasis: '31%', flexGrow: 1, minHeight: 48, borderRadius: 14, borderWidth: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 },
  mealOptionText: { fontSize: 14, lineHeight: 19, fontWeight: '700' },
  sheetActions: { marginTop: 18, flexDirection: 'row', gap: 10 },
  sheetSecondary: { flex: 1, minHeight: 50, borderRadius: 14, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  sheetSecondaryText: { fontSize: 15, lineHeight: 21, fontWeight: '800' },
  sheetPrimary: { flex: 1, minHeight: 50, borderRadius: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  sheetPrimaryText: { color: '#fff', fontSize: 15, lineHeight: 21, fontWeight: '800' },
  nutritionSheet: { height: '86%', paddingBottom: 0 },
  nutritionHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  closeButton: { width: 48, height: 48, borderRadius: 24, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  nutritionScroll: { flex: 1, marginTop: 8 },
  nutritionScrollContent: { paddingTop: 12, paddingBottom: 8 },
  sectionEyebrow: { fontSize: 15, lineHeight: 21, fontWeight: '800', marginBottom: 12 },
  inputGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  inputCell: { flexBasis: '47%', flexGrow: 1, gap: 7 },
  inputCellCompact: { flexBasis: '100%' },
  inputLabel: { fontSize: 13, lineHeight: 18, fontWeight: '700' },
  inputWrap: { minHeight: 52, borderWidth: 1, borderRadius: 14, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 8 },
  input: { flex: 1, minWidth: 0, minHeight: 50, paddingVertical: 0, fontSize: 17, fontWeight: '700', textAlign: 'right', fontVariant: ['tabular-nums'] },
  inputUnit: { minWidth: 36, fontSize: 12, lineHeight: 17, textAlign: 'right' },
  inputError: { fontSize: 11, lineHeight: 16 },
  microHeading: { marginTop: 24 },
  microGrid: { borderWidth: 1, borderRadius: 16, padding: 12, flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  microGridItem: { flexBasis: '47%', flexGrow: 1, minHeight: 54, justifyContent: 'center', gap: 4 },
  microGridLabel: { fontSize: 12, lineHeight: 17 },
  microGridValue: { fontSize: 14, lineHeight: 19, fontWeight: '800', fontVariant: ['tabular-nums'] },
  detailHeader: { paddingHorizontal: 18, paddingTop: 20, paddingBottom: 18, borderBottomWidth: StyleSheet.hairlineWidth, gap: 14 },
  detailTitleRow: { flexDirection: 'row', alignItems: 'flex-start', flexWrap: 'wrap', gap: 10 },
  detailTitle: { flexShrink: 1, fontSize: 25, lineHeight: 34, fontWeight: '800' },
  detailFavoriteBadge: { minHeight: 30, borderRadius: 15, borderWidth: 1, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 5 },
  detailFavoriteText: { fontSize: 12, lineHeight: 17, fontWeight: '800' },
  detailMetaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  metaPill: { minHeight: 36, borderRadius: 18, borderWidth: 1, paddingHorizontal: 11, flexDirection: 'row', alignItems: 'center', gap: 6 },
  metaPillText: { fontSize: 13, lineHeight: 18, fontWeight: '600' },
  detailImageWrap: { width: '100%', height: 232, position: 'relative', overflow: 'hidden', marginTop: 12 },
  detailImage: { width: '100%', height: '100%' },
  imagePreviewHint: { position: 'absolute', right: 14, bottom: 14, minHeight: 38, borderRadius: 19, paddingHorizontal: 12, backgroundColor: 'rgba(15,23,42,0.72)', flexDirection: 'row', alignItems: 'center', gap: 6 },
  imagePreviewHintText: { color: '#fff', fontSize: 12, lineHeight: 17, fontWeight: '700' },
  detailSection: { marginTop: 12, borderTopWidth: 1, borderBottomWidth: 1, paddingHorizontal: 18, paddingVertical: 18, gap: 14 },
  detailSectionTitle: { fontSize: 18, lineHeight: 24, fontWeight: '800' },
  detailMicroGrid: { borderWidth: 1, borderRadius: 16, padding: 12, flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  detailMicroItem: { flexBasis: '22%', flexGrow: 1, minWidth: 74, minHeight: 55, justifyContent: 'center', gap: 4 },
  detailMicroLabel: { fontSize: 11, lineHeight: 15 },
  detailMicroValue: { fontSize: 13, lineHeight: 18, fontWeight: '800', fontVariant: ['tabular-nums'] },
  expandButton: { minHeight: 48, borderRadius: 14, borderWidth: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
  expandButtonText: { fontSize: 14, lineHeight: 19, fontWeight: '700' },
  ingredientList: { gap: 10 },
  ingredientRow: { minHeight: 72, borderRadius: 14, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 11, flexDirection: 'row', alignItems: 'center', gap: 14 },
  ingredientName: { fontSize: 15, lineHeight: 21, fontWeight: '700' },
  ingredientWeight: { marginTop: 3, fontSize: 13, lineHeight: 18 },
  ingredientCalories: { flexShrink: 0, fontSize: 14, lineHeight: 19, fontWeight: '800', fontVariant: ['tabular-nums'] },
  detailDescription: { fontSize: 15, lineHeight: 24 },
  detailActions: { position: 'absolute', left: 0, right: 0, bottom: 0, minHeight: 72, borderTopWidth: 1, paddingHorizontal: 12, paddingTop: 10, flexDirection: 'row', alignItems: 'flex-start', gap: 9 },
  detailSecondaryButton: { minWidth: 90, height: 50, borderRadius: 14, borderWidth: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  detailSecondaryText: { fontSize: 14, lineHeight: 19, fontWeight: '800' },
  detailDangerButton: { width: 50, height: 50, borderRadius: 14, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  detailPrimaryButton: { flex: 1, height: 50, borderRadius: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  detailPrimaryText: { color: '#fff', fontSize: 15, lineHeight: 21, fontWeight: '800' },
  previewPage: { flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' },
  previewImage: { width: '100%', height: '100%' },
  previewClose: { position: 'absolute', top: 48, right: 18, width: 48, height: 48, borderRadius: 24, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' },
})
