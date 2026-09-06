import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AccessibilityInfo, ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Switch, Text, View } from 'react-native'
import { useFocusEffect, useNavigation } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { BookHeart, CircleAlert, RotateCcw, Search, ShieldCheck, Users } from 'lucide-react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { apiClient } from '../api'
import type { RootStackParamList } from '../navigation/types'
import { useAppDialog } from '../providers/DialogProvider'
import { useColorScheme } from '../providers/ColorSchemeProvider'
import { userFacingErrorMessage } from '../utils/errors'

type PrivacyKey = 'searchable' | 'public_records' | 'public_favorite_recipes'

type PrivacyState = Record<PrivacyKey, boolean>

const defaultPrivacy: PrivacyState = {
  searchable: true,
  public_records: true,
  public_favorite_recipes: true,
}

const privacyItems = [
  {
    key: 'searchable',
    title: '允许在圈子中被搜索',
    description: '开启后，其他用户可以通过用户名或手机号搜索到你。',
    icon: Search,
  },
  {
    key: 'public_records',
    title: '公开我的饮食记录',
    description: '开启后，其他用户在圈子里可以看到你的动态和饮食记录。',
    icon: Users,
  },
  {
    key: 'public_favorite_recipes',
    title: '公开我的食物收藏',
    description: '关闭后，其他用户进入你的个人主页时将无法查看拍照分析后收藏的食物。',
    icon: BookHeart,
  },
] as const

export function PrivacySettingsScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  const dialog = useAppDialog()
  const { isDark } = useColorScheme()
  const insets = useSafeAreaInsets()
  const palette = isDark ? darkPalette : lightPalette
  const styles = useMemo(() => createStyles(palette), [palette])
  const [privacy, setPrivacy] = useState<PrivacyState>(defaultPrivacy)
  const [loaded, setLoaded] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [savingKey, setSavingKey] = useState<PrivacyKey | null>(null)
  const [successKey, setSuccessKey] = useState<PrivacyKey | null>(null)
  const successTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const loadedRef = useRef(false)

  useEffect(() => {
    navigation.setOptions({
      title: '隐私设置',
      headerStyle: { backgroundColor: palette.surface },
      headerTintColor: palette.text,
      headerShadowVisible: false,
    })
  }, [navigation, palette.surface, palette.text])

  useEffect(() => () => {
    if (successTimerRef.current) clearTimeout(successTimerRef.current)
  }, [])

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true)
    setLoadError('')
    try {
      const profile = await apiClient.getUserProfile()
      setPrivacy({
        searchable: profile.searchable ?? true,
        public_records: profile.public_records ?? true,
        public_favorite_recipes: profile.public_favorite_recipes ?? true,
      })
      loadedRef.current = true
      setLoaded(true)
    } catch (error) {
      const message = userFacingErrorMessage(error, '隐私设置加载失败')
      if (!loadedRef.current) setLoadError(message)
      else await dialog.alert('刷新失败', message, 'danger')
    } finally {
      setRefreshing(false)
    }
  }, [dialog])

  useFocusEffect(useCallback(() => {
    void load(false)
  }, [load]))

  const updateSetting = useCallback(async (key: PrivacyKey, value: boolean) => {
    if (savingKey) return
    const previous = privacy[key]
    setPrivacy((current) => ({ ...current, [key]: value }))
    setSavingKey(key)
    setSuccessKey(null)
    try {
      const profile = await apiClient.updateUserProfile({ [key]: value })
      const serverValue = profile[key]
      setPrivacy((current) => ({ ...current, [key]: typeof serverValue === 'boolean' ? serverValue : value }))
      setSuccessKey(key)
      AccessibilityInfo.announceForAccessibility(`${privacyItems.find((item) => item.key === key)?.title || '隐私设置'}已更新`)
      if (successTimerRef.current) clearTimeout(successTimerRef.current)
      successTimerRef.current = setTimeout(() => setSuccessKey(null), 1800)
    } catch (error) {
      setPrivacy((current) => ({ ...current, [key]: previous }))
      await dialog.alert('保存隐私设置失败', userFacingErrorMessage(error), 'danger')
    } finally {
      setSavingKey(null)
    }
  }, [dialog, privacy, savingKey])

  if (!loaded && !loadError) {
    return (
      <View style={styles.centerState}>
        <ActivityIndicator size="large" color={palette.brand} accessibilityLabel="正在读取隐私设置" />
      </View>
    )
  }

  if (!loaded && loadError) {
    return (
      <View style={styles.centerState} accessibilityRole="alert">
        <View style={styles.errorIcon}><CircleAlert size={27} color={palette.danger} /></View>
        <Text style={styles.errorTitle}>隐私设置加载失败</Text>
        <Text style={styles.errorMessage}>{loadError}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="重新加载隐私设置"
          style={({ pressed }) => [styles.retryButton, pressed && styles.pressed]}
          onPress={() => void load(false)}
        >
          <RotateCcw size={18} color="#ffffff" />
          <Text style={styles.retryText}>重新加载</Text>
        </Pressable>
      </View>
    )
  }

  return (
    <ScrollView
      style={styles.page}
      contentContainerStyle={[styles.content, { paddingBottom: Math.max(insets.bottom, 16) + 28 }]}
      showsVerticalScrollIndicator={false}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} tintColor={palette.brand} colors={[palette.brand]} />}
    >
      <View style={styles.intro}>
        <View style={styles.introIcon}><ShieldCheck size={23} color={palette.brandStrong} strokeWidth={2.3} /></View>
        <View style={styles.introCopy}>
          <Text style={styles.introTitle}>由你决定公开范围</Text>
          <Text style={styles.introText}>设置会同步到圈子搜索、动态和个人主页。</Text>
        </View>
      </View>

      <Text style={styles.groupTitle}>基础隐私</Text>
      <View style={styles.group}>
        {privacyItems.map((item, index) => {
          const Icon = item.icon
          const saving = savingKey === item.key
          const success = successKey === item.key
          return (
            <View key={item.key} style={[styles.row, index < privacyItems.length - 1 && styles.rowBorder]}>
              <View style={styles.rowIcon}><Icon size={19} color={palette.brandStrong} strokeWidth={2.2} /></View>
              <View style={styles.rowCopy}>
                <Text style={styles.rowTitle}>{item.title}</Text>
                <Text style={styles.rowDescription}>{item.description}</Text>
                {success ? <Text style={styles.successText} accessibilityLiveRegion="polite">设置已更新</Text> : null}
              </View>
              <View style={styles.switchArea}>
                {saving ? <ActivityIndicator size="small" color={palette.brand} style={styles.savingSpinner} accessibilityLabel={`${item.title}正在保存`} /> : null}
                <Switch
                  accessibilityLabel={item.title}
                  accessibilityHint={item.description}
                  accessibilityState={{ checked: privacy[item.key], disabled: Boolean(savingKey), busy: saving }}
                  value={privacy[item.key]}
                  disabled={Boolean(savingKey)}
                  onValueChange={(value) => void updateSetting(item.key, value)}
                  trackColor={{ false: palette.switchOff, true: palette.brand }}
                  thumbColor={palette.switchThumb}
                />
              </View>
            </View>
          )
        })}
      </View>

      <View style={styles.noteCard}>
        <Text style={styles.noteTitle}>这些设置不会影响什么？</Text>
        <Text style={styles.noteText}>健康档案、账号信息和未主动公开的数据不会因为开启以上选项而显示。关闭公开选项后，新访问会立即按最新设置处理。</Text>
      </View>
    </ScrollView>
  )
}

type Palette = typeof lightPalette

const lightPalette = {
  page: '#f8faf9',
  surface: '#ffffff',
  surfaceMuted: '#f2f6f4',
  border: '#dbe6e1',
  text: '#15231d',
  textSecondary: '#52655d',
  textMuted: '#788a82',
  brand: '#00ad73',
  brandStrong: '#087653',
  brandSoft: '#e7f8f1',
  danger: '#dc2626',
  dangerSoft: '#fff1f2',
  switchOff: '#cbd5d1',
  switchThumb: '#ffffff',
}

const darkPalette: Palette = {
  page: '#101716',
  surface: '#1a2220',
  surfaceMuted: '#222c29',
  border: '#354940',
  text: '#eef5f1',
  textSecondary: '#c0cec7',
  textMuted: '#91a29a',
  brand: '#21bd84',
  brandStrong: '#7ce0b7',
  brandSoft: '#17372d',
  danger: '#fb7185',
  dangerSoft: '#431d25',
  switchOff: '#4b5d55',
  switchThumb: '#ffffff',
}

function createStyles(palette: Palette) {
  return StyleSheet.create({
    page: { flex: 1, backgroundColor: palette.page },
    content: { minHeight: '100%', paddingHorizontal: 16, paddingTop: 16 },
    centerState: { flex: 1, paddingHorizontal: 28, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.page },
    errorIcon: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.dangerSoft },
    errorTitle: { marginTop: 14, color: palette.text, fontSize: 18, lineHeight: 25, fontWeight: '800' },
    errorMessage: { marginTop: 7, color: palette.textSecondary, fontSize: 14, lineHeight: 21, textAlign: 'center' },
    retryButton: { minWidth: 144, minHeight: 48, marginTop: 20, paddingHorizontal: 20, borderRadius: 24, flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.brand },
    retryText: { color: '#ffffff', fontSize: 14, lineHeight: 20, fontWeight: '800' },
    intro: { minHeight: 88, padding: 16, borderWidth: 1, borderColor: palette.border, borderRadius: 20, flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: palette.brandSoft },
    introIcon: { width: 46, height: 46, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.surface },
    introCopy: { flex: 1, minWidth: 0 },
    introTitle: { color: palette.text, fontSize: 16, lineHeight: 22, fontWeight: '900' },
    introText: { marginTop: 3, color: palette.textSecondary, fontSize: 13, lineHeight: 19 },
    groupTitle: { marginTop: 22, marginBottom: 8, paddingHorizontal: 4, color: palette.textSecondary, fontSize: 13, lineHeight: 18, fontWeight: '800' },
    group: { overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth, borderColor: palette.border, borderRadius: 20, backgroundColor: palette.surface },
    row: { minHeight: 112, paddingHorizontal: 14, paddingVertical: 15, flexDirection: 'row', alignItems: 'center', gap: 11 },
    rowBorder: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: palette.border },
    rowIcon: { width: 40, height: 40, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.brandSoft },
    rowCopy: { flex: 1, minWidth: 0 },
    rowTitle: { color: palette.text, fontSize: 15, lineHeight: 21, fontWeight: '800' },
    rowDescription: { marginTop: 4, color: palette.textMuted, fontSize: 12, lineHeight: 18 },
    successText: { marginTop: 5, color: palette.brandStrong, fontSize: 12, lineHeight: 17, fontWeight: '800' },
    switchArea: { width: 60, minHeight: 52, alignItems: 'flex-end', justifyContent: 'center' },
    savingSpinner: { position: 'absolute', left: -2 },
    noteCard: { marginTop: 14, padding: 16, borderRadius: 18, backgroundColor: palette.surfaceMuted },
    noteTitle: { color: palette.textSecondary, fontSize: 13, lineHeight: 19, fontWeight: '800' },
    noteText: { marginTop: 5, color: palette.textMuted, fontSize: 12, lineHeight: 19 },
    pressed: { opacity: 0.72 },
  })
}
