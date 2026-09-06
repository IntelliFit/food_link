import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ActivityIndicator, Image, Modal, Pressable, RefreshControl, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native'
import * as ImagePicker from 'expo-image-picker'
import { useFocusEffect, useNavigation, useRoute, type RouteProp } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Check, ChevronRight, CirclePlus, Clock3, ImagePlus, Pill, Search, Trash2, X } from 'lucide-react-native'
import type {
  SupplementCatalogItem,
  SupplementComponent,
  SupplementComponentCategory,
  SupplementDashboard,
  SupplementDashboardSummary,
  UpsertSupplementPayload,
  UserSupplement,
} from '@food-link/core'
import { apiClient } from '../api'
import type { RootStackParamList } from '../navigation/types'
import { AppAlert as Alert } from '../providers/DialogProvider'
import { useColorScheme } from '../providers/ColorSchemeProvider'
import { colors } from '../theme'
import { todayKey } from '../utils/date'
import { userFacingErrorMessage } from '../utils/errors'
import { emitHomeDashboardRefreshEvent } from '../utils/home-events'

const MAX_LABEL_IMAGES = 3
type CabinetTab = 'cabinet' | 'history'
type LabelImage = { uri: string; remoteUrl?: string; fileName?: string; mimeType?: string }

const NUTRIENT_OPTIONS = [
  { key: 'fiber', label: '膳食纤维', unit: 'g' },
  { key: 'sugar', label: '糖', unit: 'g' },
  { key: 'saturatedFat', label: '饱和脂肪', unit: 'g' },
  { key: 'cholesterolMg', label: '胆固醇', unit: 'mg' },
  { key: 'sodiumMg', label: '钠', unit: 'mg' },
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
] as const

const CATALOG_CATEGORY: Record<string, string> = {
  vitamin: '维生素', mineral: '矿物质', sports: '运动营养', wellness: '日常健康',
}
let pendingCatalogSelection: SupplementCatalogItem | null = null

function normalizeCode(value: string): string {
  return value.trim().toLowerCase().replace(/[\s\-/]+/g, '_')
}
function emptyComponent(category: SupplementComponentCategory = 'nutrient'): SupplementComponent {
  return { code: '', name: '', category, amount: 0, unit: 'mg' }
}
function updateComponent(items: SupplementComponent[], index: number, patch: Partial<SupplementComponent>) {
  return items.map((item, current) => current === index ? { ...item, ...patch } : item)
}
function scheduleText(item: UserSupplement): string {
  if (!item.schedule_enabled) return '按需记录'
  return item.schedule_time ? `计划 ${item.schedule_time}` : '今日计划'
}
function formatAmount(value: number): string {
  if (!Number.isFinite(value)) return '0'
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(3)))
}
function catalogSummary(item: SupplementCatalogItem): string {
  return (item.components || []).slice(0, 3)
    .map((component) => `${component.name} ${formatAmount(component.amount)}${component.unit}`).join(' · ')
}
function useSupplementPalette() {
  const { isDark } = useColorScheme()
  return {
    page: isDark ? '#0f1513' : '#f5f8f6',
    card: isDark ? '#18211e' : '#ffffff',
    cardSoft: isDark ? '#202b27' : '#f0f7f3',
    text: isDark ? '#f2f7f4' : '#17211d',
    textSecondary: isDark ? '#b4c1bb' : '#66736d',
    textMuted: isDark ? '#87958e' : '#94a39b',
    border: isDark ? '#2e3b36' : '#dfe9e3',
    brand: '#00a976',
    brandSoft: isDark ? '#153c30' : '#e7f8f1',
    danger: '#dc4c57',
    dangerSoft: isDark ? '#422329' : '#fff0f1',
    input: isDark ? '#111916' : '#f8faf9',
    mask: 'rgba(4, 10, 8, 0.58)',
  }
}

export function TodaySupplementsCard({ summary, embedded = false }: { summary?: SupplementDashboardSummary | null; embedded?: boolean }) {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  const palette = useSupplementPalette()
  const [localSummary, setLocalSummary] = useState(summary)
  const [busy, setBusy] = useState(false)
  useEffect(() => setLocalSummary(summary), [summary])
  const completed = localSummary?.completed_count || 0
  const planned = localSummary?.planned_count || 0
  const pending = localSummary?.pending_supplement
  const openCabinet = () => navigation.navigate('Supplements')
  const record = async () => {
    if (!pending || busy) return
    setBusy(true)
    try {
      await apiClient.recordSupplementIntake(pending.id, {
        servings: pending.default_servings,
        source: 'home_quick_log',
        idempotency_key: `home:${pending.id}:${Date.now()}`,
      })
      setLocalSummary((current) => current ? {
        ...current,
        completed_count: Math.min(current.planned_count, current.completed_count + 1),
        pending_supplement: null,
      } : current)
      emitHomeDashboardRefreshEvent({ date: todayKey(), force: true })
    } catch (error) {
      Alert.alert('记录补剂失败', userFacingErrorMessage(error))
    } finally {
      setBusy(false)
    }
  }
  return (
    <View style={[styles.todayCard, embedded && styles.todayCardEmbedded, { backgroundColor: palette.card, borderColor: palette.border }]}>
      <View style={styles.todayHead}>
        <View style={styles.todayTitleWrap}>
          <View style={[styles.todayIcon, { backgroundColor: palette.brandSoft }]}><Pill size={20} color={palette.brand} /></View>
          <Text style={[styles.todayTitle, { color: palette.text }]}>今日补剂</Text>
          <Text style={[styles.todayCount, { color: palette.brand }]}>{completed}<Text style={{ color: palette.textMuted }}>/{planned} 已记录</Text></Text>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="打开补剂柜" onPress={openCabinet} style={styles.todayLink}>
          <Text style={[styles.todayLinkText, { color: palette.textSecondary }]}>补剂柜</Text>
          <ChevronRight size={18} color={palette.textSecondary} />
        </Pressable>
      </View>
      {pending ? (
        <View style={[styles.todayPending, { backgroundColor: palette.cardSoft }]}>
          <View style={[styles.todayPill, { backgroundColor: palette.card }]}><Pill size={20} color={palette.brand} /></View>
          <View style={styles.todayCopy}>
            <Text style={[styles.todayName, { color: palette.text }]} numberOfLines={1}>{pending.name} · {pending.serving_label}</Text>
            <Text style={[styles.todayMeta, { color: palette.textSecondary }]}>{scheduleText(pending)}</Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`记录一次${pending.name}`}
            disabled={busy}
            onPress={() => void record()}
            style={({ pressed }) => [styles.todayRecord, (pressed || busy) && styles.pressed]}
          >
            {busy ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.todayRecordText}>记录一次</Text>}
          </Pressable>
        </View>
      ) : (
        <Pressable
          accessibilityRole="button"
          onPress={openCabinet}
          style={({ pressed }) => [styles.todayEmpty, { backgroundColor: palette.cardSoft }, pressed && styles.pressed]}
        >
          <Text style={[styles.todayEmptyText, { color: palette.textSecondary }]}>
            {planned > 0 && completed >= planned ? '今日计划已完成' : '还没有补剂计划，去补剂柜添加'}
          </Text>
          <ChevronRight size={18} color={palette.textMuted} />
        </Pressable>
      )}
    </View>
  )
}

export function SupplementsScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  const insets = useSafeAreaInsets()
  const palette = useSupplementPalette()
  const [tab, setTab] = useState<CabinetTab>('cabinet')
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [recordingId, setRecordingId] = useState('')
  const [dashboard, setDashboard] = useState<SupplementDashboard | null>(null)
  const load = useCallback(async (refresh = false) => {
    if (refresh) setRefreshing(true)
    else setLoading(true)
    try {
      setDashboard(await apiClient.getSupplementDashboard(todayKey()))
    } catch (error) {
      setDashboard(null)
      Alert.alert('加载补剂柜失败', userFacingErrorMessage(error))
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])
  useFocusEffect(useCallback(() => {
    void load()
    return () => undefined
  }, [load]))
  const completedIds = useMemo(
    () => new Set((dashboard?.intakes || []).map((item) => item.supplement_id)),
    [dashboard?.intakes],
  )
  const progress = dashboard?.planned_count
    ? Math.min(100, Math.round((dashboard.completed_count / dashboard.planned_count) * 100))
    : 0
  const record = async (item: UserSupplement) => {
    if (recordingId || completedIds.has(item.id)) return
    setRecordingId(item.id)
    try {
      await apiClient.recordSupplementIntake(item.id, {
        servings: item.default_servings,
        source: 'quick_log',
        idempotency_key: `${item.id}:${todayKey()}:${Date.now()}`,
      })
      emitHomeDashboardRefreshEvent({ date: todayKey(), force: true })
      await load(true)
    } catch (error) {
      Alert.alert('记录失败', userFacingErrorMessage(error))
    } finally {
      setRecordingId('')
    }
  }
  const removeIntake = (intakeId: string) => {
    Alert.alert('删除记录', '删除后，今日营养统计会同步扣除。', [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: async () => {
          try {
            await apiClient.deleteSupplementIntake(intakeId)
            emitHomeDashboardRefreshEvent({ date: todayKey(), force: true })
            await load(true)
          } catch (error) {
            Alert.alert('删除失败', userFacingErrorMessage(error))
          }
        },
      },
    ])
  }
  return (
    <View style={[styles.page, { backgroundColor: palette.page }]}>
      <View style={[styles.cabinetHero, { backgroundColor: palette.card }]}>
        <View style={styles.cabinetHeroCopy}>
          <Text style={[styles.kicker, { color: palette.brand }]}>记录优先 · 结果回到营养面板</Text>
          <Text style={[styles.heroTitle, { color: palette.text }]}>我的补剂柜</Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="添加补剂"
          onPress={() => navigation.navigate('SupplementEdit')}
          style={({ pressed }) => [styles.addButton, pressed && styles.pressed]}
        >
          <CirclePlus size={20} color="#fff" />
          <Text style={styles.addButtonText}>添加</Text>
        </Pressable>
      </View>
      <View style={[styles.summaryCard, { backgroundColor: palette.card, borderColor: palette.border }]}>
        <View>
          <Text style={[styles.summaryLabel, { color: palette.textSecondary }]}>今日计划</Text>
          <Text style={[styles.summaryValue, { color: palette.text }]}>{dashboard?.completed_count || 0}<Text style={{ color: palette.textMuted }}> / {dashboard?.planned_count || 0}</Text></Text>
        </View>
        <View style={styles.summaryProgress}>
          <View style={[styles.progressTrack, { backgroundColor: palette.cardSoft }]}>
            <View style={[styles.progressFill, { width: `${progress}%`, backgroundColor: palette.brand }]} />
          </View>
          <Text style={[styles.progressText, { color: palette.textSecondary }]}>{progress}%</Text>
        </View>
      </View>
      <View style={[styles.tabs, { backgroundColor: palette.cardSoft }]}>
        {(['cabinet', 'history'] as CabinetTab[]).map((value) => (
          <Pressable
            key={value}
            accessibilityRole="tab"
            accessibilityState={{ selected: tab === value }}
            onPress={() => setTab(value)}
            style={[styles.tab, tab === value && { backgroundColor: palette.card }]}
          >
            <Text style={[styles.tabText, { color: tab === value ? palette.brand : palette.textSecondary }]}>
              {value === 'cabinet' ? '补剂柜' : '今日记录'}
            </Text>
          </Pressable>
        ))}
      </View>
      <ScrollView
        contentContainerStyle={[styles.cabinetContent, { paddingBottom: Math.max(24, insets.bottom + 18) }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} tintColor={palette.brand} />}
        showsVerticalScrollIndicator={false}
      >
        {loading ? (
          <View style={styles.loadingArea}><ActivityIndicator size="large" color={palette.brand} /></View>
        ) : tab === 'cabinet' ? (
          dashboard?.supplements?.length ? dashboard.supplements.map((item) => {
            const completed = completedIds.has(item.id)
            const recording = recordingId === item.id
            return (
              <View key={item.id} style={[styles.supplementCard, { backgroundColor: palette.card, borderColor: palette.border }]}>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => navigation.navigate('SupplementEdit', { itemId: item.id })}
                  style={({ pressed }) => [styles.supplementMain, pressed && styles.pressed]}
                >
                  <View style={[styles.bottleIcon, { backgroundColor: palette.brandSoft }]}><Pill size={24} color={palette.brand} /></View>
                  <View style={styles.supplementCopy}>
                    <Text style={[styles.supplementName, { color: palette.text }]}>{item.name}</Text>
                    <Text style={[styles.supplementMeta, { color: palette.textSecondary }]}>{item.serving_label} · {scheduleText(item)}</Text>
                    <Text style={[styles.supplementComponents, { color: palette.textMuted }]} numberOfLines={1}>
                      {item.components.slice(0, 3).map((component) => component.name).join(' · ') || '待补充成分'}
                    </Text>
                  </View>
                  <ChevronRight size={20} color={palette.textMuted} />
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  disabled={completed || recording}
                  onPress={() => void record(item)}
                  style={({ pressed }) => [
                    styles.logButton,
                    { backgroundColor: completed ? palette.brandSoft : palette.brand },
                    (pressed || recording) && styles.pressed,
                  ]}
                >
                  {recording
                    ? <ActivityIndicator size="small" color="#fff" />
                    : <Text style={[styles.logButtonText, completed && { color: palette.brand }]}>{completed ? '今日已记' : '记录一次'}</Text>}
                </Pressable>
              </View>
            )
          }) : (
            <EmptyState title="补剂柜还是空的" description="从公共补剂库选择，或拍摄瓶身标签添加，确认后即可快速记录。" action="添加第一件补剂" onPress={() => navigation.navigate('SupplementEdit')} palette={palette} />
          )
        ) : dashboard?.intakes?.length ? (
          dashboard.intakes.map((item) => (
            <View key={item.id} style={[styles.historyCard, { backgroundColor: palette.card, borderColor: palette.border }]}>
              <View style={styles.historyCopy}>
                <Text style={[styles.supplementName, { color: palette.text }]}>{item.supplement_name}</Text>
                <Text style={[styles.supplementMeta, { color: palette.textSecondary }]}>
                  {formatAmount(item.servings)} × {item.serving_label} · {new Date(item.taken_at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                </Text>
              </View>
              <Pressable accessibilityRole="button" accessibilityLabel={`删除${item.supplement_name}记录`} onPress={() => removeIntake(item.id)} style={({ pressed }) => [styles.deleteButton, { backgroundColor: palette.dangerSoft }, pressed && styles.pressed]}>
                <Trash2 size={18} color={palette.danger} />
                <Text style={[styles.deleteButtonText, { color: palette.danger }]}>删除</Text>
              </Pressable>
            </View>
          ))
        ) : (
          <EmptyState title="今天还没有记录" description="回到补剂柜点击“记录一次”。" palette={palette} />
        )}
        <Text style={[styles.safeNote, { color: palette.textMuted }]}>仅用于记录标签信息与摄入数据，不替代医生或药师建议。</Text>
      </ScrollView>
    </View>
  )
}

export function SupplementCatalogScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  const insets = useSafeAreaInsets()
  const palette = useSupplementPalette()
  const [query, setQuery] = useState('')
  const [items, setItems] = useState<SupplementCatalogItem[]>([])
  const [loading, setLoading] = useState(true)
  const generation = useRef(0)
  useEffect(() => {
    const current = ++generation.current
    const timer = setTimeout(() => {
      setLoading(true)
      void apiClient.listSupplementCatalog(query)
        .then((result) => {
          if (generation.current === current) setItems(result)
        })
        .catch((error) => {
          if (generation.current !== current) return
          setItems([])
          Alert.alert('加载公共补剂库失败', userFacingErrorMessage(error))
        })
        .finally(() => {
          if (generation.current === current) setLoading(false)
        })
    }, 250)
    return () => clearTimeout(timer)
  }, [query])
  const choose = (item: SupplementCatalogItem) => {
    pendingCatalogSelection = item
    navigation.goBack()
  }
  return (
    <View style={[styles.page, { backgroundColor: palette.page }]}>
      <View style={[styles.catalogHero, { backgroundColor: palette.card }]}>
        <Text style={[styles.catalogTitle, { color: palette.text }]}>从补剂库选择</Text>
        <Text style={[styles.catalogSub, { color: palette.textSecondary }]}>选择模板后会自动填写成分，保存前请按照自己的瓶身标签核对。</Text>
        <View style={[styles.searchBox, { backgroundColor: palette.input, borderColor: palette.border }]}>
          <Search size={20} color={palette.textMuted} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="搜索维生素、矿物质或功能成分"
            placeholderTextColor={palette.textMuted}
            style={[styles.searchInput, { color: palette.text }]}
            returnKeyType="search"
          />
          {query ? (
            <Pressable accessibilityRole="button" accessibilityLabel="清空搜索" onPress={() => setQuery('')} style={styles.iconHit}>
              <X size={18} color={palette.textMuted} />
            </Pressable>
          ) : null}
        </View>
      </View>
      <ScrollView contentContainerStyle={[styles.catalogContent, { paddingBottom: Math.max(24, insets.bottom + 18) }]} showsVerticalScrollIndicator={false}>
        {loading ? (
          <View style={styles.loadingArea}><ActivityIndicator size="large" color={palette.brand} /></View>
        ) : items.length ? items.map((item) => (
          <Pressable
            key={item.id}
            accessibilityRole="button"
            accessibilityLabel={`选用${item.name}`}
            onPress={() => choose(item)}
            style={({ pressed }) => [styles.catalogCard, { backgroundColor: palette.card, borderColor: palette.border }, pressed && styles.pressed]}
          >
            <View style={[styles.catalogIcon, { backgroundColor: palette.brandSoft }]}><Pill size={24} color={palette.brand} /></View>
            <View style={styles.catalogCopy}>
              <View style={styles.catalogNameRow}>
                <Text style={[styles.catalogName, { color: palette.text }]}>{item.name}</Text>
                <Text style={[styles.catalogCategory, { color: palette.brand, backgroundColor: palette.brandSoft }]}>{CATALOG_CATEGORY[item.category] || '补剂'}</Text>
              </View>
              <Text style={[styles.catalogComponents, { color: palette.textSecondary }]} numberOfLines={2}>{catalogSummary(item) || '待核对成分'}</Text>
              <Text style={[styles.catalogDescription, { color: palette.textMuted }]} numberOfLines={2}>{item.description}</Text>
            </View>
            <Text style={[styles.catalogPick, { color: palette.brand }]}>选用</Text>
          </Pressable>
        )) : (
          <EmptyState title="暂时没有匹配模板" description="返回后可以拍摄瓶身标签添加。" palette={palette} />
        )}
        <Text style={[styles.safeNote, { color: palette.textMuted }]}>模板仅用于快速记录，不代表推荐剂量。</Text>
      </ScrollView>
    </View>
  )
}

export function SupplementEditScreen() {
  const route = useRoute<RouteProp<RootStackParamList, 'SupplementEdit'>>()
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  const insets = useSafeAreaInsets()
  const palette = useSupplementPalette()
  const itemId = route.params?.itemId?.trim() || ''
  const [name, setName] = useState('')
  const [brand, setBrand] = useState('')
  const [servingLabel, setServingLabel] = useState('1粒')
  const [scheduleEnabled, setScheduleEnabled] = useState(true)
  const [scheduleTime, setScheduleTime] = useState('08:00')
  const [components, setComponents] = useState<SupplementComponent[]>([emptyComponent()])
  const [images, setImages] = useState<LabelImage[]>([])
  const [confirmed, setConfirmed] = useState(false)
  const [ocrHint, setOcrHint] = useState('')
  const [initializing, setInitializing] = useState(Boolean(itemId))
  const [recognizing, setRecognizing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [sourcePickerVisible, setSourcePickerVisible] = useState(false)
  const [nutrientIndex, setNutrientIndex] = useState<number | null>(null)
  useEffect(() => {
    if (!itemId) return
    setInitializing(true)
    void apiClient.listSupplements('active')
      .then((items) => {
        const item = items.find((entry) => entry.id === itemId)
        if (!item) throw new Error('补剂不存在或已归档')
        setName(item.name)
        setBrand(item.brand || '')
        setServingLabel(item.serving_label || '1份')
        setScheduleEnabled(item.schedule_enabled)
        setScheduleTime(item.schedule_time || '08:00')
        setComponents(item.components?.length ? item.components.map((component) => ({ ...component })) : [emptyComponent()])
        const urls = item.image_urls?.length ? item.image_urls : item.image_url ? [item.image_url] : []
        setImages(urls.map((url) => ({ uri: url, remoteUrl: url })))
        setConfirmed(Boolean(item.label_confirmed_at))
      })
      .catch((error) => {
        Alert.alert('加载补剂失败', userFacingErrorMessage(error))
        navigation.goBack()
      })
      .finally(() => setInitializing(false))
  }, [itemId, navigation])
  useFocusEffect(useCallback(() => {
    if (itemId || !pendingCatalogSelection) return
    const item = pendingCatalogSelection
    pendingCatalogSelection = null
    setName(item.name)
    setBrand(item.brand || '')
    setServingLabel(item.serving_label || '1份')
    setComponents((item.components || []).map((component) => ({ ...component })))
    setImages(item.image_url ? [{ uri: item.image_url, remoteUrl: item.image_url }] : [])
    setOcrHint('已从公共补剂库预填，请按照自己的瓶身标签核对含量。')
    setConfirmed(false)
  }, [itemId]))
  const validComponentCount = useMemo(
    () => components.filter((item) => item.name.trim() && Number(item.amount) > 0 && item.unit.trim()).length,
    [components],
  )
  const remainingImages = MAX_LABEL_IMAGES - images.length
  const pickImages = async (source: 'camera' | 'library') => {
    setSourcePickerVisible(false)
    if (remainingImages <= 0) return
    try {
      if (source === 'camera') {
        const permission = await ImagePicker.requestCameraPermissionsAsync()
        if (!permission.granted) {
          Alert.alert('需要相机权限', '请允许使用相机拍摄补剂瓶身和成分标签。')
          return
        }
      }
      const result = source === 'camera'
        ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.86 })
        : await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ['images'],
            quality: 0.86,
            allowsMultipleSelection: true,
            selectionLimit: remainingImages,
          })
      if (result.canceled) return
      const additions = result.assets.slice(0, remainingImages).map((asset) => ({
        uri: asset.uri,
        fileName: asset.fileName || undefined,
        mimeType: asset.mimeType || undefined,
      }))
      setImages((current) => [...current, ...additions].slice(0, MAX_LABEL_IMAGES))
      setConfirmed(false)
      setOcrHint('图片已加入，建议正面和成分表一起提交，再点击“联合识别标签”。')
    } catch (error) {
      Alert.alert('选择图片失败', userFacingErrorMessage(error))
    }
  }
  const resolveImageUrls = async (): Promise<string[]> => {
    const resolved: string[] = []
    for (const image of images) {
      if (image.remoteUrl) {
        resolved.push(image.remoteUrl)
        continue
      }
      const uploaded = await apiClient.uploadAnalyzeImageFile({
        fileUri: image.uri,
        fileName: image.fileName || 'supplement-label.jpg',
        mimeType: image.mimeType || 'image/jpeg',
      })
      resolved.push(uploaded.imageUrl)
    }
    setImages((current) => current.map((image, index) => ({ ...image, remoteUrl: resolved[index] })))
    return resolved
  }
  const recognize = async () => {
    if (!images.length) {
      setSourcePickerVisible(true)
      return
    }
    if (recognizing) return
    setRecognizing(true)
    try {
      const urls = await resolveImageUrls()
      const result = await apiClient.recognizeSupplementLabel(urls)
      const nextComponents = (result.components || []).map((component) => ({ ...component }))
      if (result.name) setName(result.name)
      if (result.brand) setBrand(result.brand)
      if (result.serving_label) setServingLabel(result.serving_label)
      if (nextComponents.length) setComponents(nextComponents)
      setConfirmed(false)
      setOcrHint(`已综合 ${urls.length} 张标签识别出 ${nextComponents.length} 项成分，请逐项核对每份含量。`)
    } catch (error) {
      Alert.alert('标签识别失败', userFacingErrorMessage(error))
    } finally {
      setRecognizing(false)
    }
  }
  const save = async () => {
    if (saving) return
    if (!name.trim()) {
      Alert.alert('请填写补剂名称')
      return
    }
    if (scheduleEnabled && !/^([01]\d|2[0-3]):[0-5]\d$/.test(scheduleTime.trim())) {
      Alert.alert('计划时间格式不正确', '请使用 24 小时格式，例如 08:00。')
      return
    }
    const normalized = components
      .filter((item) => item.name.trim() && Number(item.amount) > 0 && item.unit.trim())
      .map((item) => ({
        ...item,
        code: normalizeCode(item.code || item.name),
        amount: Number(item.amount),
        name: item.name.trim(),
        unit: item.unit.trim(),
      }))
    if (!normalized.length) {
      Alert.alert('请至少填写一项有效成分')
      return
    }
    if (!confirmed) {
      Alert.alert('请先核对标签成分', '确认名称、一次用量和全部成分无误后，再勾选核对项。')
      return
    }
    setSaving(true)
    try {
      const imageUrls = images.length ? await resolveImageUrls() : []
      const payload: UpsertSupplementPayload = {
        name: name.trim(),
        brand: brand.trim(),
        image_url: imageUrls[0] || null,
        image_urls: imageUrls,
        default_servings: 1,
        serving_label: servingLabel.trim() || '1份',
        schedule_enabled: scheduleEnabled,
        schedule_time: scheduleEnabled ? scheduleTime.trim() : null,
        schedule_days: [],
        components: normalized,
        label_confirmed: true,
        status: 'active',
      }
      if (itemId) await apiClient.updateSupplement(itemId, payload)
      else await apiClient.createSupplement(payload)
      emitHomeDashboardRefreshEvent({ date: todayKey(), force: true })
      navigation.goBack()
    } catch (error) {
      Alert.alert('保存失败', userFacingErrorMessage(error))
    } finally {
      setSaving(false)
    }
  }
  if (initializing) {
    return <View style={[styles.center, { backgroundColor: palette.page }]}><ActivityIndicator size="large" color={palette.brand} /></View>
  }
  return (
    <View style={[styles.page, { backgroundColor: palette.page }]}>
      <ScrollView
        contentContainerStyle={[styles.editContent, { paddingBottom: 116 + Math.max(12, insets.bottom) }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Section palette={palette}>
          <Text style={[styles.sectionTitle, { color: palette.text }]}>{itemId ? '重新识别标签' : '选择添加方式'}</Text>
          <Text style={[styles.sectionDescription, { color: palette.textSecondary }]}>
            {itemId ? '重新拍摄 1–3 张瓶身标签后，请再次核对全部内容。' : '可以从公共补剂库选择；拍标签建议使用正面＋成分表两张，最多 3 张。'}
          </Text>
          {!itemId ? (
            <Pressable onPress={() => navigation.navigate('SupplementCatalog')} style={({ pressed }) => [styles.primaryOutline, { borderColor: palette.brand }, pressed && styles.pressed]}>
              <Search size={20} color={palette.brand} />
              <Text style={[styles.primaryOutlineText, { color: palette.brand }]}>从公共补剂库选择</Text>
            </Pressable>
          ) : null}
          <View style={styles.captureActions}>
            <Pressable
              disabled={remainingImages <= 0}
              onPress={() => setSourcePickerVisible(true)}
              style={({ pressed }) => [styles.captureButton, { backgroundColor: palette.cardSoft }, (pressed || remainingImages <= 0) && styles.pressed]}
            >
              <ImagePlus size={20} color={palette.textSecondary} />
              <Text style={[styles.captureButtonText, { color: palette.textSecondary }]}>
                {remainingImages > 0 ? `添加标签图片（还可 ${remainingImages} 张）` : '已添加 3 张'}
              </Text>
            </Pressable>
            <Pressable disabled={recognizing} onPress={() => void recognize()} style={({ pressed }) => [styles.recognizeButton, (pressed || recognizing) && styles.pressed]}>
              {recognizing ? <ActivityIndicator color="#fff" /> : <Text style={styles.recognizeButtonText}>联合识别标签</Text>}
            </Pressable>
          </View>
          {images.length ? (
            <View style={styles.imageRow}>
              {images.map((image, index) => (
                <View key={`${image.uri}-${index}`} style={styles.imageWrap}>
                  <Image source={{ uri: image.uri }} style={styles.labelImage} />
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`删除第 ${index + 1} 张标签图片`}
                    onPress={() => {
                      setImages((current) => current.filter((_, currentIndex) => currentIndex !== index))
                      setConfirmed(false)
                    }}
                    style={styles.imageRemove}
                  >
                    <X size={16} color="#fff" />
                  </Pressable>
                </View>
              ))}
              <Text style={[styles.imageCount, { color: palette.textMuted }]}>{images.length}/3 张</Text>
            </View>
          ) : null}
          {ocrHint ? <Text style={[styles.ocrHint, { color: palette.brand, backgroundColor: palette.brandSoft }]}>{ocrHint}</Text> : null}
        </Section>

        <Section palette={palette}>
          <Text style={[styles.sectionTitle, { color: palette.text }]}>基本信息</Text>
          <FormField label="名称" palette={palette}>
            <TextInput
              value={name}
              onChangeText={(value) => { setName(value); setConfirmed(false) }}
              placeholder="如：甘氨酸镁"
              placeholderTextColor={palette.textMuted}
              style={[styles.input, { color: palette.text, backgroundColor: palette.input, borderColor: palette.border }]}
            />
          </FormField>
          <FormField label="品牌" palette={palette}>
            <TextInput
              value={brand}
              onChangeText={(value) => { setBrand(value); setConfirmed(false) }}
              placeholder="选填"
              placeholderTextColor={palette.textMuted}
              style={[styles.input, { color: palette.text, backgroundColor: palette.input, borderColor: palette.border }]}
            />
          </FormField>
          <FormField label="一次用量" palette={palette}>
            <TextInput
              value={servingLabel}
              onChangeText={(value) => { setServingLabel(value); setConfirmed(false) }}
              placeholder="如：2粒 / 1勺"
              placeholderTextColor={palette.textMuted}
              style={[styles.input, { color: palette.text, backgroundColor: palette.input, borderColor: palette.border }]}
            />
          </FormField>
        </Section>

        <Section palette={palette}>
          <View style={styles.switchRow}>
            <Pressable
              onPress={() => setScheduleEnabled((current) => !current)}
              style={styles.switchCopy}
              accessibilityRole="switch"
              accessibilityState={{ checked: scheduleEnabled }}
            >
              <Text style={[styles.sectionTitle, { color: palette.text }]}>每日计划</Text>
              <Text style={[styles.sectionDescription, { color: palette.textSecondary }]}>
                {scheduleEnabled ? '已开启，保存后出现在首页“今日补剂”' : '未开启，可按需在补剂柜记录'}
              </Text>
            </Pressable>
            <Switch value={scheduleEnabled} onValueChange={setScheduleEnabled} trackColor={{ false: palette.border, true: palette.brand }} thumbColor="#fff" />
          </View>
          {scheduleEnabled ? (
            <FormField label="计划时间" palette={palette}>
              <View style={[styles.timeInputWrap, { backgroundColor: palette.input, borderColor: palette.border }]}>
                <Clock3 size={20} color={palette.textMuted} />
                <TextInput value={scheduleTime} onChangeText={setScheduleTime} placeholder="08:00" placeholderTextColor={palette.textMuted} keyboardType="numbers-and-punctuation" maxLength={5} style={[styles.timeInput, { color: palette.text }]} />
              </View>
            </FormField>
          ) : null}
        </Section>

        <Section palette={palette}>
          <View style={styles.sectionHead}>
            <Text style={[styles.sectionTitle, { color: palette.text }]}>标签成分</Text>
            <Text style={[styles.componentCount, { color: palette.brand, backgroundColor: palette.brandSoft }]}>{validComponentCount} 项</Text>
          </View>
          {components.map((item, index) => (
            <View key={`${index}-${item.code}`} style={[styles.componentCard, { backgroundColor: palette.cardSoft, borderColor: palette.border }]}>
              <View style={styles.categoryRow}>
                {(['nutrient', 'functional', 'blend'] as SupplementComponentCategory[]).map((category) => (
                  <Pressable
                    key={category}
                    onPress={() => {
                      setComponents(updateComponent(components, index, {
                        category,
                        nutrient_key: category === 'nutrient' ? item.nutrient_key : undefined,
                      }))
                      setConfirmed(false)
                    }}
                    style={[styles.categoryButton, item.category === category && { backgroundColor: palette.card }]}
                  >
                    <Text style={[styles.categoryText, { color: item.category === category ? palette.brand : palette.textSecondary }]}>
                      {category === 'nutrient' ? '营养素' : category === 'functional' ? '功能成分' : '复合配方'}
                    </Text>
                  </Pressable>
                ))}
              </View>
              {item.category === 'nutrient' ? (
                <Pressable onPress={() => setNutrientIndex(index)} style={[styles.nutrientPicker, { backgroundColor: palette.input, borderColor: palette.border }]}>
                  <Text style={[styles.nutrientPickerText, { color: item.nutrient_key ? palette.text : palette.textMuted }]}>
                    {item.nutrient_key ? item.name : '选择要汇入营养面板的营养素'}
                  </Text>
                  <ChevronRight size={18} color={palette.textMuted} />
                </Pressable>
              ) : (
                <TextInput
                  value={item.name}
                  onChangeText={(value) => {
                    setComponents(updateComponent(components, index, { name: value, code: normalizeCode(value) }))
                    setConfirmed(false)
                  }}
                  placeholder={item.category === 'blend' ? '如：专利草本复合物' : '如：肌酸、甘氨酸'}
                  placeholderTextColor={palette.textMuted}
                  style={[styles.input, { color: palette.text, backgroundColor: palette.input, borderColor: palette.border }]}
                />
              )}
              <View style={styles.amountRow}>
                <TextInput
                  value={item.amount ? String(item.amount) : ''}
                  onChangeText={(value) => {
                    setComponents(updateComponent(components, index, { amount: Number(value) || 0 }))
                    setConfirmed(false)
                  }}
                  placeholder="含量"
                  placeholderTextColor={palette.textMuted}
                  keyboardType="decimal-pad"
                  style={[styles.amountInput, { color: palette.text, backgroundColor: palette.input, borderColor: palette.border }]}
                />
                <TextInput
                  value={item.unit}
                  onChangeText={(value) => {
                    setComponents(updateComponent(components, index, { unit: value }))
                    setConfirmed(false)
                  }}
                  placeholder="单位"
                  placeholderTextColor={palette.textMuted}
                  style={[styles.unitInput, { color: palette.text, backgroundColor: palette.input, borderColor: palette.border }]}
                />
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="删除成分"
                  onPress={() => {
                    setComponents((current) => current.filter((_, currentIndex) => currentIndex !== index))
                    setConfirmed(false)
                  }}
                  style={[styles.removeComponent, { backgroundColor: palette.dangerSoft }]}
                >
                  <Trash2 size={19} color={palette.danger} />
                </Pressable>
              </View>
            </View>
          ))}
          <Pressable
            onPress={() => {
              setComponents((current) => [...current, emptyComponent('functional')])
              setConfirmed(false)
            }}
            style={[styles.addComponent, { borderColor: palette.brand }]}
          >
            <CirclePlus size={20} color={palette.brand} />
            <Text style={[styles.addComponentText, { color: palette.brand }]}>添加成分</Text>
          </Pressable>
        </Section>
        <Pressable
          accessibilityRole="checkbox"
          accessibilityState={{ checked: confirmed }}
          onPress={() => setConfirmed((current) => !current)}
          style={[styles.confirmRow, { backgroundColor: confirmed ? palette.brandSoft : palette.card, borderColor: confirmed ? palette.brand : palette.border }]}
        >
          <View style={[styles.confirmBox, { borderColor: confirmed ? palette.brand : palette.textMuted, backgroundColor: confirmed ? palette.brand : 'transparent' }]}>
            {confirmed ? <Check size={17} color="#fff" strokeWidth={3} /> : null}
          </View>
          <Text style={[styles.confirmText, { color: palette.text }]}>我已核对名称、每次用量和全部标签成分</Text>
        </Pressable>
        <Text style={[styles.disclaimer, { color: palette.textMuted }]}>本功能仅用于营养与成分记录，不提供诊断、处方或停药建议。</Text>
      </ScrollView>
      <View style={[styles.saveDock, { backgroundColor: palette.card, borderColor: palette.border, paddingBottom: Math.max(12, insets.bottom) }]}>
        <Pressable disabled={saving} onPress={() => void save()} style={({ pressed }) => [styles.saveButton, (pressed || saving) && styles.pressed]}>
          {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveButtonText}>保存到补剂柜</Text>}
        </Pressable>
      </View>

      <Modal transparent visible={sourcePickerVisible} animationType="fade" onRequestClose={() => setSourcePickerVisible(false)}>
        <Pressable style={[styles.modalMask, { backgroundColor: palette.mask }]} onPress={() => setSourcePickerVisible(false)}>
          <Pressable style={[styles.sourceSheet, { backgroundColor: palette.card }]} onPress={() => undefined}>
            <Text style={[styles.modalTitle, { color: palette.text }]}>添加标签图片</Text>
            <Text style={[styles.modalDescription, { color: palette.textSecondary }]}>建议选择包装正面和 Supplement Facts / 成分表，最多 3 张。</Text>
            <Pressable onPress={() => void pickImages('camera')} style={[styles.sourceAction, { backgroundColor: palette.brandSoft }]}>
              <ImagePlus size={22} color={palette.brand} />
              <View style={styles.sourceActionCopy}>
                <Text style={[styles.sourceActionTitle, { color: palette.text }]}>拍一张标签</Text>
                <Text style={[styles.sourceActionSub, { color: palette.textSecondary }]}>拍完可继续添加下一张</Text>
              </View>
              <ChevronRight size={20} color={palette.textMuted} />
            </Pressable>
            <Pressable onPress={() => void pickImages('library')} style={[styles.sourceAction, { backgroundColor: palette.cardSoft }]}>
              <ImagePlus size={22} color={palette.textSecondary} />
              <View style={styles.sourceActionCopy}>
                <Text style={[styles.sourceActionTitle, { color: palette.text }]}>从相册选择</Text>
                <Text style={[styles.sourceActionSub, { color: palette.textSecondary }]}>可一次选择剩余张数</Text>
              </View>
              <ChevronRight size={20} color={palette.textMuted} />
            </Pressable>
            <Pressable onPress={() => setSourcePickerVisible(false)} style={styles.modalCancel}>
              <Text style={[styles.modalCancelText, { color: palette.textSecondary }]}>取消</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal transparent visible={nutrientIndex != null} animationType="slide" onRequestClose={() => setNutrientIndex(null)}>
        <View style={[styles.modalMask, { backgroundColor: palette.mask }]}>
          <View style={[styles.nutrientSheet, { backgroundColor: palette.card, paddingBottom: Math.max(16, insets.bottom) }]}>
            <View style={styles.nutrientSheetHead}>
              <Text style={[styles.modalTitle, { color: palette.text }]}>选择营养素</Text>
              <Pressable accessibilityRole="button" accessibilityLabel="关闭" onPress={() => setNutrientIndex(null)} style={styles.iconHit}>
                <X size={22} color={palette.textSecondary} />
              </Pressable>
            </View>
            <ScrollView showsVerticalScrollIndicator={false}>
              {NUTRIENT_OPTIONS.map((option) => (
                <Pressable
                  key={option.key}
                  onPress={() => {
                    if (nutrientIndex == null) return
                    setComponents(updateComponent(components, nutrientIndex, {
                      code: normalizeCode(option.key),
                      name: option.label,
                      category: 'nutrient',
                      unit: option.unit,
                      nutrient_key: option.key,
                    }))
                    setConfirmed(false)
                    setNutrientIndex(null)
                  }}
                  style={[styles.nutrientOption, { borderColor: palette.border }]}
                >
                  <Text style={[styles.nutrientOptionText, { color: palette.text }]}>{option.label}</Text>
                  <Text style={[styles.nutrientOptionUnit, { color: palette.textMuted }]}>{option.unit}</Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  )
}

type SupplementPalette = ReturnType<typeof useSupplementPalette>
function Section({ children, palette }: { children: ReactNode; palette: SupplementPalette }) {
  return <View style={[styles.section, { backgroundColor: palette.card, borderColor: palette.border }]}>{children}</View>
}
function FormField({ label, children, palette }: { label: string; children: ReactNode; palette: SupplementPalette }) {
  return (
    <View style={styles.field}>
      <Text style={[styles.fieldLabel, { color: palette.textSecondary }]}>{label}</Text>
      {children}
    </View>
  )
}
function EmptyState({ title, description, action, onPress, palette }: {
  title: string
  description: string
  action?: string
  onPress?: () => void
  palette: SupplementPalette
}) {
  return (
    <View style={[styles.emptyState, { backgroundColor: palette.card, borderColor: palette.border }]}>
      <View style={[styles.emptyIcon, { backgroundColor: palette.brandSoft }]}><Pill size={28} color={palette.brand} /></View>
      <Text style={[styles.emptyTitle, { color: palette.text }]}>{title}</Text>
      <Text style={[styles.emptyDescription, { color: palette.textSecondary }]}>{description}</Text>
      {action && onPress ? (
        <Pressable onPress={onPress} style={({ pressed }) => [styles.emptyAction, pressed && styles.pressed]}>
          <Text style={styles.emptyActionText}>{action}</Text>
        </Pressable>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  pressed: { opacity: 0.62 },
  loadingArea: { minHeight: 260, alignItems: 'center', justifyContent: 'center' },
  todayCard: { marginTop: 14, marginHorizontal: 16, borderRadius: 20, borderWidth: StyleSheet.hairlineWidth, padding: 16, gap: 14 },
  todayCardEmbedded: { marginTop: 12, marginHorizontal: 0, borderRadius: 14, padding: 10, gap: 8 },
  todayHead: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  todayTitleWrap: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 },
  todayIcon: { width: 40, height: 40, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  todayTitle: { fontSize: 17, fontWeight: '800' },
  todayCount: { fontSize: 13, fontWeight: '800' },
  todayLink: { minHeight: 48, paddingLeft: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  todayLinkText: { fontSize: 14, fontWeight: '700' },
  todayPending: { minHeight: 74, borderRadius: 16, padding: 10, flexDirection: 'row', alignItems: 'center', gap: 10 },
  todayPill: { width: 42, height: 42, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  todayCopy: { flex: 1, gap: 4 },
  todayName: { fontSize: 15, fontWeight: '800' },
  todayMeta: { fontSize: 12 },
  todayRecord: { minWidth: 92, minHeight: 48, paddingHorizontal: 13, borderRadius: 14, backgroundColor: '#00a976', alignItems: 'center', justifyContent: 'center' },
  todayRecordText: { color: '#fff', fontSize: 14, fontWeight: '800' },
  todayEmpty: { minHeight: 56, borderRadius: 16, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  todayEmptyText: { flex: 1, fontSize: 14, fontWeight: '600' },
  cabinetHero: { paddingHorizontal: 18, paddingVertical: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 16 },
  cabinetHeroCopy: { flex: 1, gap: 4 },
  kicker: { fontSize: 12, fontWeight: '700' },
  heroTitle: { fontSize: 28, lineHeight: 36, fontWeight: '900' },
  addButton: { minHeight: 48, paddingHorizontal: 16, borderRadius: 15, backgroundColor: colors.brand, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
  addButtonText: { color: '#fff', fontSize: 15, fontWeight: '800' },
  summaryCard: { marginHorizontal: 16, marginTop: 14, padding: 16, borderRadius: 18, borderWidth: StyleSheet.hairlineWidth, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 16 },
  summaryLabel: { fontSize: 12, fontWeight: '700' },
  summaryValue: { marginTop: 3, fontSize: 25, fontWeight: '900' },
  summaryProgress: { flex: 1, maxWidth: 180, flexDirection: 'row', alignItems: 'center', gap: 9 },
  progressTrack: { flex: 1, height: 8, borderRadius: 999, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 999 },
  progressText: { minWidth: 34, fontSize: 13, fontWeight: '700', textAlign: 'right' },
  tabs: { marginHorizontal: 16, marginTop: 14, padding: 4, borderRadius: 15, flexDirection: 'row' },
  tab: { flex: 1, minHeight: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  tabText: { fontSize: 14, fontWeight: '800' },
  cabinetContent: { padding: 16, gap: 12 },
  supplementCard: { borderRadius: 18, borderWidth: StyleSheet.hairlineWidth, padding: 12, gap: 10 },
  supplementMain: { minHeight: 70, flexDirection: 'row', alignItems: 'center', gap: 12 },
  bottleIcon: { width: 50, height: 50, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  supplementCopy: { flex: 1, gap: 4 },
  supplementName: { fontSize: 16, fontWeight: '800' },
  supplementMeta: { fontSize: 13 },
  supplementComponents: { fontSize: 12 },
  logButton: { minHeight: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  logButtonText: { color: '#fff', fontSize: 14, fontWeight: '800' },
  historyCard: { minHeight: 78, borderRadius: 18, borderWidth: StyleSheet.hairlineWidth, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12 },
  historyCopy: { flex: 1, gap: 6 },
  deleteButton: { minHeight: 48, paddingHorizontal: 13, borderRadius: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  deleteButtonText: { fontSize: 13, fontWeight: '800' },
  safeNote: { marginTop: 8, paddingHorizontal: 12, fontSize: 12, lineHeight: 18, textAlign: 'center' },
  emptyState: { minHeight: 250, borderWidth: StyleSheet.hairlineWidth, borderRadius: 20, padding: 24, alignItems: 'center', justifyContent: 'center' },
  emptyIcon: { width: 58, height: 58, borderRadius: 20, alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
  emptyTitle: { fontSize: 18, fontWeight: '800', textAlign: 'center' },
  emptyDescription: { marginTop: 8, fontSize: 14, lineHeight: 21, textAlign: 'center' },
  emptyAction: { minHeight: 48, marginTop: 18, paddingHorizontal: 18, borderRadius: 14, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  emptyActionText: { color: '#fff', fontSize: 14, fontWeight: '800' },
  catalogHero: { padding: 18, gap: 8 },
  catalogTitle: { fontSize: 25, fontWeight: '900' },
  catalogSub: { fontSize: 13, lineHeight: 20 },
  searchBox: { minHeight: 52, marginTop: 8, borderWidth: StyleSheet.hairlineWidth, borderRadius: 16, paddingLeft: 14, flexDirection: 'row', alignItems: 'center', gap: 9 },
  searchInput: { flex: 1, minHeight: 50, fontSize: 15 },
  iconHit: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  catalogContent: { padding: 16, gap: 12 },
  catalogCard: { minHeight: 112, padding: 14, borderRadius: 18, borderWidth: StyleSheet.hairlineWidth, flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  catalogIcon: { width: 48, height: 48, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  catalogCopy: { flex: 1, gap: 6 },
  catalogNameRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 7 },
  catalogName: { fontSize: 16, fontWeight: '800' },
  catalogCategory: { overflow: 'hidden', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3, fontSize: 11, fontWeight: '700' },
  catalogComponents: { fontSize: 13, lineHeight: 19 },
  catalogDescription: { fontSize: 12, lineHeight: 18 },
  catalogPick: { minWidth: 44, minHeight: 48, paddingTop: 13, fontSize: 14, fontWeight: '800', textAlign: 'center' },
  editContent: { padding: 16, gap: 14 },
  section: { borderRadius: 20, borderWidth: StyleSheet.hairlineWidth, padding: 16, gap: 14 },
  sectionTitle: { fontSize: 17, fontWeight: '900' },
  sectionDescription: { fontSize: 13, lineHeight: 20 },
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  primaryOutline: { minHeight: 50, borderWidth: 1.5, borderRadius: 15, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  primaryOutlineText: { fontSize: 15, fontWeight: '800' },
  captureActions: { gap: 10 },
  captureButton: { minHeight: 52, borderRadius: 15, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  captureButtonText: { fontSize: 14, fontWeight: '700' },
  recognizeButton: { minHeight: 52, borderRadius: 15, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  recognizeButtonText: { color: '#fff', fontSize: 15, fontWeight: '800' },
  imageRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 10 },
  imageWrap: { width: 76, height: 76 },
  labelImage: { width: 76, height: 76, borderRadius: 14, backgroundColor: '#dce7e1' },
  imageRemove: { position: 'absolute', top: -7, right: -7, width: 28, height: 28, borderRadius: 14, backgroundColor: '#26362f', alignItems: 'center', justifyContent: 'center' },
  imageCount: { fontSize: 12, fontWeight: '700' },
  ocrHint: { overflow: 'hidden', borderRadius: 12, padding: 11, fontSize: 12, lineHeight: 18 },
  field: { gap: 7 },
  fieldLabel: { fontSize: 13, fontWeight: '700' },
  input: { minHeight: 50, borderWidth: StyleSheet.hairlineWidth, borderRadius: 14, paddingHorizontal: 13, fontSize: 15 },
  switchRow: { minHeight: 58, flexDirection: 'row', alignItems: 'center', gap: 12 },
  switchCopy: { flex: 1, minHeight: 58, justifyContent: 'center', gap: 5 },
  timeInputWrap: { minHeight: 50, borderWidth: StyleSheet.hairlineWidth, borderRadius: 14, paddingHorizontal: 13, flexDirection: 'row', alignItems: 'center', gap: 9 },
  timeInput: { flex: 1, minHeight: 48, fontSize: 15 },
  componentCount: { overflow: 'hidden', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5, fontSize: 12, fontWeight: '800' },
  componentCard: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 17, padding: 12, gap: 11 },
  categoryRow: { padding: 3, borderRadius: 12, flexDirection: 'row' },
  categoryButton: { flex: 1, minHeight: 44, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  categoryText: { fontSize: 12, fontWeight: '800' },
  nutrientPicker: { minHeight: 50, borderWidth: StyleSheet.hairlineWidth, borderRadius: 14, paddingHorizontal: 13, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  nutrientPickerText: { flex: 1, fontSize: 14, fontWeight: '600' },
  amountRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  amountInput: { flex: 1.4, minHeight: 50, borderWidth: StyleSheet.hairlineWidth, borderRadius: 14, paddingHorizontal: 12, fontSize: 14 },
  unitInput: { flex: 1, minHeight: 50, borderWidth: StyleSheet.hairlineWidth, borderRadius: 14, paddingHorizontal: 12, fontSize: 14 },
  removeComponent: { width: 50, height: 50, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  addComponent: { minHeight: 50, borderWidth: 1.5, borderStyle: 'dashed', borderRadius: 15, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  addComponentText: { fontSize: 14, fontWeight: '800' },
  confirmRow: { minHeight: 66, borderWidth: 1.5, borderRadius: 18, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 12 },
  confirmBox: { width: 26, height: 26, borderRadius: 8, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  confirmText: { flex: 1, fontSize: 14, lineHeight: 21, fontWeight: '700' },
  disclaimer: { paddingHorizontal: 12, fontSize: 12, lineHeight: 18, textAlign: 'center' },
  saveDock: { position: 'absolute', left: 0, right: 0, bottom: 0, borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: 16, paddingTop: 12 },
  saveButton: { minHeight: 52, borderRadius: 16, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  saveButtonText: { color: '#fff', fontSize: 16, fontWeight: '900' },
  modalMask: { flex: 1, justifyContent: 'flex-end' },
  sourceSheet: { margin: 16, borderRadius: 22, padding: 18, gap: 12 },
  modalTitle: { fontSize: 20, fontWeight: '900' },
  modalDescription: { fontSize: 13, lineHeight: 20 },
  sourceAction: { minHeight: 72, borderRadius: 17, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 12 },
  sourceActionCopy: { flex: 1, gap: 4 },
  sourceActionTitle: { fontSize: 15, fontWeight: '800' },
  sourceActionSub: { fontSize: 12 },
  modalCancel: { minHeight: 50, alignItems: 'center', justifyContent: 'center' },
  modalCancelText: { fontSize: 15, fontWeight: '700' },
  nutrientSheet: { maxHeight: '78%', borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 18, paddingTop: 18 },
  nutrientSheetHead: { minHeight: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  nutrientOption: { minHeight: 54, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  nutrientOptionText: { fontSize: 15, fontWeight: '700' },
  nutrientOptionUnit: { fontSize: 13, fontWeight: '600' },
})
