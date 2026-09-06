import { useCallback, useMemo, useRef, useState } from 'react'
import {
  AccessibilityInfo,
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native'
import { useFocusEffect } from '@react-navigation/native'
import type { NativeStackScreenProps } from '@react-navigation/native-stack'
import { CircleAlert, RefreshCw, UserRound, UsersRound, X } from 'lucide-react-native'
import type { FollowUserItem } from '@food-link/core'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { apiClient, getStoredUserId } from '../api'
import type { RootStackParamList } from '../navigation/types'
import { useColorScheme } from '../providers/ColorSchemeProvider'
import { userFacingErrorMessage } from '../utils/errors'

type Props = NativeStackScreenProps<RootStackParamList, 'FollowList'>

type Palette = {
  page: string
  topWash: string
  surface: string
  surfaceMuted: string
  surfacePressed: string
  text: string
  textSecondary: string
  textMuted: string
  border: string
  brand: string
  brandStrong: string
  brandSoft: string
  danger: string
  dangerSoft: string
  warning: string
  warningSoft: string
  shadow: string
}

const lightPalette: Palette = {
  page: '#f6f9f7',
  topWash: '#e7f8f0',
  surface: '#ffffff',
  surfaceMuted: '#f1f6f3',
  surfacePressed: '#eaf3ee',
  text: '#17211d',
  textSecondary: '#56645e',
  textMuted: '#74847c',
  border: '#e0eae4',
  brand: '#00a76f',
  brandStrong: '#087f58',
  brandSoft: '#e3f7ef',
  danger: '#c83d3d',
  dangerSoft: '#fff0f0',
  warning: '#8b6417',
  warningSoft: '#fff6df',
  shadow: '#102019',
}

const darkPalette: Palette = {
  page: '#0d1312',
  topWash: '#12221c',
  surface: '#18211e',
  surfaceMuted: '#1f2a26',
  surfacePressed: '#293631',
  text: '#f2f7f4',
  textSecondary: '#b4c1bb',
  textMuted: '#8fa098',
  border: '#2a3832',
  brand: '#69d6ad',
  brandStrong: '#83e1bc',
  brandSoft: '#183b2e',
  danger: '#ff8b8b',
  dangerSoft: '#402326',
  warning: '#efc66f',
  warningSoft: '#3b321d',
  shadow: '#000000',
}

export function FollowListScreen({ navigation, route }: Props) {
  const { isDark } = useColorScheme()
  const palette = isDark ? darkPalette : lightPalette
  const styles = useMemo(() => createStyles(palette), [palette])
  const insets = useSafeAreaInsets()
  const { width } = useWindowDimensions()
  const horizontalInset = width >= 760 ? Math.max(24, (width - 680) / 2) : 16
  const listType = route.params.type || 'followers'
  const targetUserId = String(route.params.userId || '').trim()
  const title = listType === 'followers' ? '被关注' : '关注'

  const [items, setItems] = useState<FollowUserItem[]>([])
  const [followStates, setFollowStates] = useState<Record<string, boolean>>({})
  const [initialLoading, setInitialLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [feedback, setFeedback] = useState('')
  const [busyIds, setBusyIds] = useState<Record<string, boolean>>({})
  const offsetRef = useRef(0)
  const requestGenerationRef = useRef(0)
  const loadedRef = useRef(false)
  const loadingMoreRef = useRef(false)
  const currentUserIdRef = useRef('')
  const hasItemsRef = useRef(false)
  hasItemsRef.current = items.length > 0

  const announce = useCallback((message: string) => {
    setFeedback(message)
    AccessibilityInfo.announceForAccessibility(message)
  }, [])

  const hydrateFollowStates = useCallback(async (users: FollowUserItem[], generation: number, seed: Record<string, boolean>) => {
    const viewerId = currentUserIdRef.current
    const unresolved = users.filter((user) => {
      const id = followUserId(user)
      return Boolean(id && id !== viewerId && typeof seed[id] !== 'boolean')
    })
    for (let index = 0; index < unresolved.length; index += 4) {
      const batch = unresolved.slice(index, index + 4)
      const results = await Promise.allSettled(batch.map((user) => apiClient.getFollowStats(followUserId(user))))
      if (generation !== requestGenerationRef.current) return
      const resolved: Record<string, boolean> = {}
      results.forEach((result, resultIndex) => {
        const id = followUserId(batch[resultIndex])
        if (!id) return
        resolved[id] = result.status === 'fulfilled' ? Boolean(result.value.is_following) : false
      })
      if (Object.keys(resolved).length > 0) setFollowStates((current) => ({ ...current, ...resolved }))
    }
  }, [])

  const load = useCallback(async (mode: 'initial' | 'refresh' = 'initial') => {
    const generation = ++requestGenerationRef.current
    if (mode === 'refresh') setRefreshing(true)
    else setInitialLoading(true)
    setLoadError('')
    setFeedback('')
    try {
      if (!targetUserId) throw new Error('缺少用户信息')
      const viewerId = currentUserIdRef.current || String(await getStoredUserId() || '').trim()
      currentUserIdRef.current = viewerId
      const data = listType === 'followers'
        ? await apiClient.getFollowers(targetUserId, 0, 20)
        : await apiClient.getFollowing(targetUserId, 0, 20)
      if (generation !== requestGenerationRef.current) return
      const next = dedupeUsers(data.list || [])
      setItems(next)
      const seed = buildFollowStates(next, listType, targetUserId, viewerId)
      setFollowStates(seed)
      void hydrateFollowStates(next, generation, seed)
      offsetRef.current = next.length
      setHasMore(Boolean(data.has_more ?? next.length >= 20))
      loadedRef.current = true
    } catch (error) {
      if (generation !== requestGenerationRef.current) return
      const message = userFacingErrorMessage(error)
      if (hasItemsRef.current) announce(`刷新失败：${message}`)
      else setLoadError(message)
    } finally {
      if (generation === requestGenerationRef.current) {
        setInitialLoading(false)
        setRefreshing(false)
      }
    }
  }, [announce, hydrateFollowStates, listType, targetUserId])

  const loadMore = useCallback(async () => {
    if (!hasMore || loadingMoreRef.current || initialLoading || refreshing) return
    loadingMoreRef.current = true
    setLoadingMore(true)
    setFeedback('')
    const generation = requestGenerationRef.current
    const requestedOffset = offsetRef.current
    try {
      const data = listType === 'followers'
        ? await apiClient.getFollowers(targetUserId, requestedOffset, 20)
        : await apiClient.getFollowing(targetUserId, requestedOffset, 20)
      if (generation !== requestGenerationRef.current) return
      const page = dedupeUsers(data.list || [])
      const next = dedupeUsers([...items, ...page])
      const seed = buildFollowStates(page, listType, targetUserId, currentUserIdRef.current)
      setItems(next)
      setFollowStates((current) => ({ ...current, ...seed }))
      void hydrateFollowStates(page, generation, seed)
      offsetRef.current = next.length
      setHasMore(Boolean(data.has_more ?? (data.list || []).length >= 20))
    } catch (error) {
      if (generation === requestGenerationRef.current) announce(`加载更多失败：${userFacingErrorMessage(error)}`)
    } finally {
      loadingMoreRef.current = false
      setLoadingMore(false)
    }
  }, [announce, hasMore, hydrateFollowStates, initialLoading, items, listType, refreshing, targetUserId])

  useFocusEffect(useCallback(() => {
    navigation.setOptions({ title })
    void load(loadedRef.current ? 'refresh' : 'initial')
    return () => {
      requestGenerationRef.current += 1
    }
  }, [load, navigation, title]))

  const toggleFollow = useCallback(async (user: FollowUserItem) => {
    const id = followUserId(user)
    if (!id || id === currentUserIdRef.current || busyIds[id]) return
    const previous = followStates[id]
    if (typeof previous !== 'boolean') return
    const next = !previous
    setBusyIds((current) => ({ ...current, [id]: true }))
    setFollowStates((current) => ({ ...current, [id]: next }))
    setItems((current) => current.map((item) => followUserId(item) === id ? { ...item, is_following: next } : item))
    setFeedback('')
    try {
      await apiClient.followUser(id, previous)
      announce(next ? `已关注${followDisplayName(user)}` : `已取消关注${followDisplayName(user)}`)
    } catch (error) {
      setFollowStates((current) => ({ ...current, [id]: previous }))
      setItems((current) => current.map((item) => followUserId(item) === id ? { ...item, is_following: previous } : item))
      announce(`${previous ? '取消关注' : '关注'}失败：${userFacingErrorMessage(error)}`)
    } finally {
      setBusyIds((current) => {
        const nextBusy = { ...current }
        delete nextBusy[id]
        return nextBusy
      })
    }
  }, [announce, busyIds, followStates])

  const renderItem = useCallback(({ item }: { item: FollowUserItem }) => {
    const id = followUserId(item)
    const name = followDisplayName(item)
    const isSelf = Boolean(id && id === currentUserIdRef.current)
    const following = followStates[id]
    const resolving = !isSelf && typeof following !== 'boolean'
    const busy = Boolean(busyIds[id]) || resolving
    return (
      <View style={styles.card}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`查看${name}的个人主页`}
          disabled={!id}
          onPress={() => id && navigation.navigate('ProfileSettings', { userId: id })}
          style={({ pressed }) => [styles.personArea, pressed && styles.personPressed]}
        >
          <Avatar user={item} name={name} palette={palette} styles={styles} />
          <View style={styles.personMeta}>
            <Text style={styles.personName} numberOfLines={2}>{name}</Text>
            <Text style={styles.personHint}>{listType === 'followers' ? '关注者' : '已关注的用户'}</Text>
          </View>
        </Pressable>
        {!isSelf ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={resolving ? `正在确认与${name}的关注状态` : following ? `取消关注${name}` : `关注${name}`}
            accessibilityState={{ busy, disabled: busy }}
            accessibilityValue={{ text: resolving ? '正在确认' : following ? '已关注' : '未关注' }}
            disabled={busy}
            onPress={() => void toggleFollow(item)}
            style={({ pressed }) => [styles.followButton, following && styles.followButtonActive, pressed && !busy && styles.pressed, busy && styles.disabled]}
          >
            {busy ? <ActivityIndicator size="small" color={following ? palette.brandStrong : palette.textMuted} /> : <Text style={[styles.followButtonText, following && styles.followButtonTextActive]}>{following ? '已关注' : '关注'}</Text>}
          </Pressable>
        ) : <View style={styles.selfPill}><Text style={styles.selfPillText}>自己</Text></View>}
      </View>
    )
  }, [busyIds, followStates, listType, navigation, palette, styles, toggleFollow])

  if (initialLoading && items.length === 0) {
    return <View style={styles.page}><View style={styles.topWash} pointerEvents="none" /><View style={styles.centered}><ActivityIndicator accessibilityLabel={`正在获取${title}`} color={palette.brand} size="large" /></View></View>
  }

  if (loadError && items.length === 0) {
    return (
      <View style={styles.page}>
        <View style={styles.topWash} pointerEvents="none" />
        <View style={styles.centered}>
          <View style={styles.errorIcon}><CircleAlert size={30} color={palette.danger} /></View>
          <Text style={styles.emptyTitle}>暂时无法获取{title}</Text>
          <Text style={styles.emptySubtitle}>{loadError}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel={`重新获取${title}`} onPress={() => void load('initial')} style={({ pressed }) => [styles.retryButton, pressed && styles.pressed]}><RefreshCw size={18} color="#ffffff" /><Text style={styles.retryButtonText}>重试</Text></Pressable>
        </View>
      </View>
    )
  }

  return (
    <View style={styles.page}>
      <View style={styles.topWash} pointerEvents="none" />
      {feedback ? <View accessibilityRole="alert" style={[styles.feedback, { marginHorizontal: horizontalInset }]}><Text style={styles.feedbackText}>{feedback}</Text><Pressable accessibilityRole="button" accessibilityLabel="关闭提示" onPress={() => setFeedback('')} style={styles.feedbackClose}><X size={18} color={palette.textSecondary} /></Pressable></View> : null}
      <FlatList
        data={items}
        keyExtractor={(item) => followUserId(item)}
        renderItem={renderItem}
        ItemSeparatorComponent={ListGap}
        contentContainerStyle={[styles.listContent, { paddingHorizontal: horizontalInset, paddingBottom: insets.bottom + 28 }, items.length === 0 && styles.emptyListContent]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load('refresh')} tintColor={palette.brand} colors={[palette.brand]} />}
        onEndReached={() => void loadMore()}
        onEndReachedThreshold={0.35}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={<View style={styles.empty}><View style={styles.emptyIcon}><UsersRound size={32} color={palette.brandStrong} /></View><Text style={styles.emptyTitle}>暂无{title}</Text><Text style={styles.emptySubtitle}>{listType === 'followers' ? '有人关注后会显示在这里' : '关注感兴趣的食友后会显示在这里'}</Text></View>}
        ListFooterComponent={loadingMore ? <View style={styles.footer}><ActivityIndicator accessibilityLabel="正在获取更多用户" color={palette.brand} /></View> : null}
        removeClippedSubviews
      />
    </View>
  )
}

function Avatar({ user, name, palette, styles }: { user: FollowUserItem; name: string; palette: Palette; styles: ReturnType<typeof createStyles> }) {
  return user.avatar
    ? <Image accessibilityLabel={`${name}的头像`} source={{ uri: user.avatar }} style={styles.avatar} />
    : <View accessibilityLabel={`${name}的默认头像`} style={styles.avatarFallback}><UserRound size={22} color={palette.brandStrong} /></View>
}

function followUserId(user: FollowUserItem): string { return String(user.id || user.user_id || '').trim() }
function followDisplayName(user: FollowUserItem): string { return String(user.nickname || '用户').trim() || '用户' }

function dedupeUsers(input: FollowUserItem[]): FollowUserItem[] {
  const seen = new Set<string>()
  return input.filter((item) => {
    const id = followUserId(item)
    if (!id || seen.has(id)) return false
    seen.add(id)
    return true
  })
}

function buildFollowStates(input: FollowUserItem[], type: 'followers' | 'following', targetUserId: string, viewerId: string): Record<string, boolean> {
  return input.reduce<Record<string, boolean>>((states, user) => {
    const id = followUserId(user)
    if (!id || id === viewerId) return states
    if (type === 'following' && targetUserId === viewerId) states[id] = true
    else if (typeof user.is_following === 'boolean') states[id] = user.is_following
    return states
  }, {})
}
function ListGap() { return <View style={{ height: 10 }} /> }

function createStyles(palette: Palette) {
  return StyleSheet.create({
    page: { flex: 1, backgroundColor: palette.page },
    topWash: { position: 'absolute', top: 0, left: 0, right: 0, height: 230, backgroundColor: palette.topWash },
    centered: { flex: 1, minHeight: 320, paddingHorizontal: 28, alignItems: 'center', justifyContent: 'center' },
    listContent: { flexGrow: 1, paddingTop: 14 },
    emptyListContent: { justifyContent: 'center' },
    card: { minHeight: 82, padding: 12, borderRadius: 18, flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border, shadowColor: palette.shadow, shadowOpacity: 0.05, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 1 },
    personArea: { flex: 1, minWidth: 0, minHeight: 56, paddingHorizontal: 2, borderRadius: 14, flexDirection: 'row', alignItems: 'center', gap: 11 },
    personPressed: { backgroundColor: palette.surfacePressed, opacity: 0.86 },
    personMeta: { flex: 1, minWidth: 0 },
    personName: { color: palette.text, fontSize: 16, lineHeight: 22, fontWeight: '800' },
    personHint: { marginTop: 2, color: palette.textMuted, fontSize: 12, lineHeight: 17 },
    avatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: palette.surfaceMuted },
    avatarFallback: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.brandSoft, borderWidth: 1, borderColor: palette.border },
    followButton: { minWidth: 82, minHeight: 48, paddingHorizontal: 15, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.brand, borderWidth: 1, borderColor: palette.brand },
    followButtonActive: { backgroundColor: palette.surfaceMuted, borderColor: palette.border },
    followButtonText: { color: '#ffffff', fontSize: 13, lineHeight: 18, fontWeight: '900' },
    followButtonTextActive: { color: palette.brandStrong },
    selfPill: { minWidth: 58, minHeight: 36, paddingHorizontal: 12, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.surfaceMuted },
    selfPillText: { color: palette.textMuted, fontSize: 12, fontWeight: '800' },
    empty: { minHeight: 330, paddingHorizontal: 28, paddingVertical: 52, alignItems: 'center', justifyContent: 'center' },
    emptyIcon: { width: 72, height: 72, marginBottom: 16, borderRadius: 36, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.brandSoft },
    errorIcon: { width: 72, height: 72, marginBottom: 16, borderRadius: 36, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.dangerSoft },
    emptyTitle: { color: palette.text, fontSize: 18, lineHeight: 25, fontWeight: '900', textAlign: 'center' },
    emptySubtitle: { maxWidth: 320, marginTop: 7, color: palette.textSecondary, fontSize: 14, lineHeight: 21, textAlign: 'center' },
    retryButton: { minHeight: 48, marginTop: 20, paddingHorizontal: 22, borderRadius: 24, flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.brand },
    retryButtonText: { color: '#ffffff', fontSize: 14, fontWeight: '900' },
    feedback: { zIndex: 10, marginTop: 10, minHeight: 48, paddingHorizontal: 14, paddingVertical: 9, borderRadius: 14, flexDirection: 'row', alignItems: 'center', gap: 9, backgroundColor: palette.warningSoft, borderWidth: 1, borderColor: palette.warning },
    feedbackText: { flex: 1, color: palette.text, fontSize: 13, lineHeight: 19 },
    feedbackClose: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
    footer: { minHeight: 72, alignItems: 'center', justifyContent: 'center' },
    pressed: { opacity: 0.72 },
    disabled: { opacity: 0.58 },
  })
}
