import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native'
import { useNavigation } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { BellRing, CheckCheck, CircleAlert, Inbox, RefreshCw } from 'lucide-react-native'
import type { CommunityFeedTargetType, CommunityNotificationItem } from '@food-link/core'
import { apiClient } from '../api'
import type { RootStackParamList } from '../navigation/types'
import { useColorScheme } from '../providers/ColorSchemeProvider'
import { userFacingErrorMessage } from '../utils/errors'

type NotificationTab = 'all' | 'like' | 'comment'

type NotificationPalette = {
  page: string
  wash: string
  surface: string
  surfacePressed: string
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
  shadow: string
}

const PAGE_SIZE = 20

const lightPalette: NotificationPalette = {
  page: '#f7faf8',
  wash: '#ecfdf5',
  surface: '#ffffff',
  surfacePressed: '#f4f8f5',
  surfaceMuted: '#f2f6f3',
  border: '#dfe8e2',
  text: '#14211b',
  textSecondary: '#53635a',
  textMuted: '#7f8d85',
  accent: '#00bc7d',
  accentStrong: '#009f69',
  accentSoft: '#e6faf1',
  danger: '#c83232',
  dangerSoft: '#fff0f0',
  shadow: '#173126',
}

const darkPalette: NotificationPalette = {
  page: '#0d1312',
  wash: '#102019',
  surface: '#18211f',
  surfacePressed: '#1d2a26',
  surfaceMuted: '#1d2925',
  border: 'rgba(135, 194, 164, 0.20)',
  text: '#f3f8f5',
  textSecondary: '#c3d0c9',
  textMuted: '#90a198',
  accent: '#6ee7b7',
  accentStrong: '#38c994',
  accentSoft: 'rgba(56, 201, 148, 0.14)',
  danger: '#ff9b9b',
  dangerSoft: 'rgba(239, 68, 68, 0.13)',
  shadow: '#000000',
}

export function NotificationsScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  const insets = useSafeAreaInsets()
  const { width } = useWindowDimensions()
  const { isDark } = useColorScheme()
  const palette = isDark ? darkPalette : lightPalette
  const styles = useMemo(() => createStyles(palette), [palette])
  const compact = width <= 390

  const [notifications, setNotifications] = useState<CommunityNotificationItem[]>([])
  const [unread, setUnread] = useState(0)
  const [likeCount, setLikeCount] = useState(0)
  const [commentCount, setCommentCount] = useState(0)
  const [activeTab, setActiveTab] = useState<NotificationTab>('all')
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [markingRead, setMarkingRead] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [actionError, setActionError] = useState('')

  const requestGenerationRef = useRef(0)
  const offsetRef = useRef(0)

  const load = useCallback(async (
    tab: NotificationTab,
    options: { append?: boolean; refresh?: boolean } = {},
  ) => {
    const append = Boolean(options.append)
    const refresh = Boolean(options.refresh)
    if (append && (!hasMore || loadingMore)) return

    const generation = ++requestGenerationRef.current
    if (append) setLoadingMore(true)
    else if (refresh) setRefreshing(true)
    else setLoading(true)
    if (!append) {
      setLoadError('')
      setActionError('')
    }

    try {
      const offset = append ? offsetRef.current : 0
      const data = await apiClient.listCommunityNotifications({
        limit: PAGE_SIZE,
        offset,
        type: notificationTabApiType(tab),
      })
      if (generation !== requestGenerationRef.current) return

      const nextPage = data.list || []
      const nextList = append ? mergeUniqueNotifications(notifications, nextPage) : nextPage
      setNotifications(nextList)
      setUnread(data.unread_count || 0)
      setHasMore(Boolean(data.has_more) && nextPage.length > 0)
      offsetRef.current = offset + nextPage.length

      if (typeof data.like_count === 'number') setLikeCount(data.like_count)
      else if (tab === 'all' && !append) setLikeCount(nextPage.filter((item) => notificationMatchesTab(item, 'like')).length)
      if (typeof data.comment_count === 'number') setCommentCount(data.comment_count)
      else if (tab === 'all' && !append) setCommentCount(nextPage.filter((item) => notificationMatchesTab(item, 'comment')).length)

      // 与小程序一致：首屏内容先提交，已读请求在后台执行，不阻塞消息展示。
      if (!append && data.unread_count > 0) {
        void apiClient.markCommunityNotificationsRead()
          .then((result) => {
            if (generation !== requestGenerationRef.current) return
            setUnread(result.unread_count || 0)
            setNotifications((current) => current.map((item) => ({ ...item, is_read: true })))
          })
          .catch(() => {
            // 已读状态失败不应覆盖已经成功加载的消息列表。
          })
      }
    } catch (error) {
      if (generation !== requestGenerationRef.current) return
      const message = userFacingErrorMessage(error, '互动消息加载失败')
      if (append) setActionError(message)
      else setLoadError(message)
    } finally {
      if (generation === requestGenerationRef.current) {
        setLoading(false)
        setRefreshing(false)
        setLoadingMore(false)
      }
    }
  }, [hasMore, loadingMore, notifications])

  useEffect(() => {
    void load('all')
    return () => {
      requestGenerationRef.current += 1
    }
    // Initial request is intentionally run once. Tab changes call load directly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const switchTab = useCallback((tab: NotificationTab) => {
    if (tab === activeTab || loading) return
    setActiveTab(tab)
    setNotifications([])
    setHasMore(false)
    offsetRef.current = 0
    void load(tab)
  }, [activeTab, load, loading])

  const markRead = useCallback(async () => {
    if (unread <= 0 || markingRead) return
    setMarkingRead(true)
    setActionError('')
    try {
      const result = await apiClient.markCommunityNotificationsRead()
      setUnread(result.unread_count || 0)
      setNotifications((current) => current.map((item) => ({ ...item, is_read: true })))
    } catch (error) {
      setActionError(userFacingErrorMessage(error, '标记已读失败'))
    } finally {
      setMarkingRead(false)
    }
  }, [markingRead, unread])

  const openNotification = useCallback(async (item: CommunityNotificationItem) => {
    const targetId = notificationTargetId(item)
    if (!targetId) {
      setActionError('这条互动消息缺少可跳转的动态信息')
      return
    }
    setActionError('')
    if (!item.is_read) {
      void apiClient.markCommunityNotificationsRead([item.id])
        .then(() => {
          setNotifications((current) => current.map((entry) => entry.id === item.id ? { ...entry, is_read: true } : entry))
          setUnread((current) => Math.max(0, current - 1))
        })
        .catch(() => undefined)
    }
    navigation.navigate('CommunityFeedDetail', {
      targetId,
      targetType: notificationTargetType(item),
    })
  }, [navigation])

  const renderItem = useCallback(({ item }: { item: CommunityNotificationItem }) => (
    <NotificationCard
      item={item}
      palette={palette}
      styles={styles}
      onOpen={() => void openNotification(item)}
      onOpenActor={() => {
        const actorId = item.actor?.id
        if (actorId) navigation.navigate('ProfileSettings', { userId: actorId })
      }}
    />
  ), [navigation, openNotification, palette, styles])

  const emptyState = loading ? (
    <View style={styles.statePanel} accessibilityLiveRegion="polite">
      <ActivityIndicator color={palette.accent} size="large" />
    </View>
  ) : loadError ? (
    <View style={styles.statePanel} accessibilityLiveRegion="assertive">
      <View style={styles.stateIconDanger}><CircleAlert size={24} color={palette.danger} /></View>
      <Text style={styles.stateTitle}>互动消息加载失败</Text>
      <Text style={styles.stateSubtitle}>{loadError}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="重新加载互动消息"
        onPress={() => void load(activeTab)}
        style={({ pressed }) => [styles.retryButton, pressed && styles.primaryPressed]}
      >
        <RefreshCw size={16} color="#ffffff" />
        <Text style={styles.retryButtonText}>重新加载</Text>
      </Pressable>
    </View>
  ) : (
    <View style={styles.statePanel}>
      <View style={styles.stateIcon}><Inbox size={25} color={palette.accent} /></View>
      <Text style={styles.stateTitle}>{notificationEmptyText(activeTab)}</Text>
      <Text style={styles.stateSubtitle}>
        {activeTab === 'all' ? '有人点赞、评论或回复你时，会出现在这里' : '切换到“全部”查看所有互动'}
      </Text>
    </View>
  )

  return (
    <View style={styles.page}>
      <View pointerEvents="none" style={styles.topWash} />
      <View style={[styles.content, compact && styles.contentCompact]}>
        <View style={styles.heroCard}>
          <View style={styles.heroIcon}><BellRing size={20} color={palette.accentStrong} /></View>
          <View style={styles.heroCopy}>
            <View style={styles.heroTitleRow}>
              <Text style={styles.heroTitle}>互动消息</Text>
              {unread > 0 ? <View style={styles.unreadBadge}><Text style={styles.unreadBadgeText}>{formatBadgeCount(unread)}</Text></View> : null}
            </View>
            <Text style={styles.heroSubtitle} numberOfLines={compact ? 2 : 1}>点赞、评论、回复和审核结果都会显示在这里</Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={unread > 0 ? `全部标记已读，当前 ${unread} 条未读` : '没有未读消息'}
            accessibilityState={{ disabled: markingRead || unread <= 0, busy: markingRead }}
            disabled={markingRead || unread <= 0}
            onPress={() => void markRead()}
            style={({ pressed }) => [
              styles.markReadButton,
              (markingRead || unread <= 0) && styles.buttonDisabled,
              pressed && styles.primaryPressed,
            ]}
          >
            {markingRead ? <ActivityIndicator color="#ffffff" size="small" /> : <CheckCheck size={16} color="#ffffff" />}
            {!compact ? <Text style={styles.markReadText}>全部已读</Text> : null}
          </Pressable>
        </View>

        <View style={styles.tabs} accessibilityRole="tablist">
          <NotificationTabButton label="全部" active={activeTab === 'all'} disabled={loading} onPress={() => switchTab('all')} styles={styles} />
          <NotificationTabButton label="点赞" badge={likeCount} active={activeTab === 'like'} disabled={loading} onPress={() => switchTab('like')} styles={styles} />
          <NotificationTabButton label="评论" badge={commentCount} active={activeTab === 'comment'} disabled={loading} onPress={() => switchTab('comment')} styles={styles} />
        </View>

        {actionError ? (
          <View style={styles.inlineError} accessibilityLiveRegion="assertive">
            <CircleAlert size={16} color={palette.danger} />
            <Text style={styles.inlineErrorText}>{actionError}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="关闭错误提示" hitSlop={10} onPress={() => setActionError('')}>
              <Text style={styles.inlineErrorClose}>关闭</Text>
            </Pressable>
          </View>
        ) : null}

        <FlatList
          data={notifications}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          style={styles.list}
          contentContainerStyle={[
            styles.listContent,
            notifications.length === 0 && styles.listContentEmpty,
            { paddingBottom: Math.max(insets.bottom, 16) + 16 },
          ]}
          ListEmptyComponent={emptyState}
          ListFooterComponent={loadingMore ? <View style={styles.footerSpinner}><ActivityIndicator color={palette.accent} /></View> : notifications.length > 0 && !hasMore ? <Text style={styles.listEnd}>— 没有更多了 —</Text> : null}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load(activeTab, { refresh: true })} tintColor={palette.accent} colors={[palette.accent]} progressBackgroundColor={palette.surface} />}
          onEndReached={() => void load(activeTab, { append: true })}
          onEndReachedThreshold={0.35}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        />
      </View>
    </View>
  )
}

function NotificationTabButton({
  label,
  badge,
  active,
  disabled,
  onPress,
  styles,
}: {
  label: string
  badge?: number
  active: boolean
  disabled: boolean
  onPress: () => void
  styles: ReturnType<typeof createStyles>
}) {
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityLabel={badge ? `${label}，${badge} 条` : label}
      accessibilityState={{ selected: active, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.tab, pressed && styles.tabPressed]}
    >
      <View style={styles.tabLabelRow}>
        <Text style={[styles.tabText, active && styles.tabTextActive]}>{label}</Text>
        {badge && badge > 0 ? (
          <View style={[styles.tabBadge, active && styles.tabBadgeActive]}>
            <Text style={[styles.tabBadgeText, active && styles.tabBadgeTextActive]}>{formatBadgeCount(badge)}</Text>
          </View>
        ) : null}
      </View>
      {active ? <View style={styles.tabIndicator} /> : null}
    </Pressable>
  )
}

function NotificationCard({
  item,
  palette,
  styles,
  onOpen,
  onOpenActor,
}: {
  item: CommunityNotificationItem
  palette: NotificationPalette
  styles: ReturnType<typeof createStyles>
  onOpen: () => void
  onOpenActor: () => void
}) {
  const canOpenActor = Boolean(item.actor?.id)
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${notificationTitle(item)}，${notificationContent(item)}，${notificationTimeLabel(item.created_at)}${item.is_read ? '' : '，未读'}`}
      onPress={onOpen}
      style={({ pressed }) => [
        styles.card,
        !item.is_read && styles.cardUnread,
        pressed && styles.cardPressed,
      ]}
    >
      <Pressable
        accessibilityRole={canOpenActor ? 'button' : undefined}
        accessibilityLabel={canOpenActor ? `查看${item.actor?.nickname || '用户'}的主页` : undefined}
        disabled={!canOpenActor}
        onPress={(event) => {
          event.stopPropagation()
          onOpenActor()
        }}
        style={({ pressed }) => [styles.avatarHitArea, pressed && canOpenActor && styles.avatarPressed]}
      >
        <View style={styles.avatar}>
          {item.actor?.avatar ? <Image source={{ uri: item.actor.avatar }} style={styles.avatarImage} /> : <Text style={styles.avatarText}>{notificationAvatarText(item)}</Text>}
        </View>
      </Pressable>
      <View style={styles.cardMain}>
        <View style={styles.cardTop}>
          <Text style={styles.cardTitle} numberOfLines={2}>{notificationTitle(item)}</Text>
          {!item.is_read ? <View style={styles.unreadDot} accessibilityLabel="未读" /> : null}
        </View>
        <Text style={styles.cardContent} numberOfLines={2}>{notificationContent(item)}</Text>
        <Text style={styles.cardTime}>{notificationTimeLabel(item.created_at)}</Text>
      </View>
    </Pressable>
  )
}

function notificationTabApiType(tab: NotificationTab): string | undefined {
  if (tab === 'like') return 'like_received'
  if (tab === 'comment') return 'comment'
  return undefined
}

function notificationMatchesTab(item: CommunityNotificationItem, tab: NotificationTab): boolean {
  if (tab === 'all') return true
  const type = notificationType(item)
  if (tab === 'like') return type === 'like_received' || type.includes('like')
  return type === 'comment_received' || type === 'reply_received' || type === 'comment_rejected'
}

function notificationEmptyText(tab: NotificationTab): string {
  if (tab === 'like') return '暂无点赞'
  if (tab === 'comment') return '暂无评论'
  return '暂无互动消息'
}

function notificationTitle(item: CommunityNotificationItem): string {
  const actor = item.actor?.nickname || '有人'
  const type = notificationType(item)
  if (type === 'like_received' || type.includes('like')) return `${actor}赞了你的动态`
  if (type === 'comment_received') return `${actor}评论了你的动态`
  if (type === 'reply_received') return `${actor}回复了你的评论`
  if (type === 'comment_rejected') return '你的评论未通过审核'
  return '你收到一条互动消息'
}

function notificationContent(item: CommunityNotificationItem): string {
  if (notificationType(item) === 'comment_rejected') return item.content_preview || '系统拦截了一条评论，点击查看详情'
  return item.content_preview || '点击查看详情'
}

function notificationTimeLabel(value?: string | null): string {
  if (!value) return ''
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  const diff = Date.now() - parsed.getTime()
  if (diff < 60 * 1000) return '刚刚'
  if (diff < 60 * 60 * 1000) return `${Math.max(1, Math.floor(diff / (60 * 1000)))}分钟前`
  if (diff < 24 * 60 * 60 * 1000) return `${Math.max(1, Math.floor(diff / (60 * 60 * 1000)))}小时前`
  const hours = String(parsed.getHours()).padStart(2, '0')
  const minutes = String(parsed.getMinutes()).padStart(2, '0')
  return `${parsed.getMonth() + 1}月${parsed.getDate()}日 ${hours}:${minutes}`
}

function notificationType(item: CommunityNotificationItem): string {
  return String(item.notification_type || '').trim().toLowerCase()
}

function notificationTargetId(item: CommunityNotificationItem): string {
  return String(item.target_id || item.record_id || '').trim()
}

function notificationTargetType(item: CommunityNotificationItem): CommunityFeedTargetType {
  const raw = String(item.target_type || 'food_record').trim()
  return (raw || 'food_record') as CommunityFeedTargetType
}

function notificationAvatarText(item: CommunityNotificationItem): string {
  const actor = item.actor?.nickname?.trim()
  if (actor) return actor.slice(0, 1)
  if (notificationType(item) === 'comment_rejected') return '审'
  return '信'
}

function formatBadgeCount(value: number): string {
  return value > 99 ? '99+' : String(value)
}

function mergeUniqueNotifications(current: CommunityNotificationItem[], incoming: CommunityNotificationItem[]): CommunityNotificationItem[] {
  const seen = new Set(current.map((item) => item.id))
  return [...current, ...incoming.filter((item) => !seen.has(item.id))]
}

function createStyles(palette: NotificationPalette) {
  return StyleSheet.create({
    page: { flex: 1, backgroundColor: palette.page },
    topWash: { position: 'absolute', top: 0, left: 0, right: 0, height: 180, backgroundColor: palette.wash },
    content: { flex: 1, paddingHorizontal: 14, paddingTop: 14 },
    contentCompact: { paddingHorizontal: 12, paddingTop: 12 },
    heroCard: {
      minHeight: 88,
      borderRadius: 18,
      borderWidth: 1,
      borderColor: palette.border,
      padding: 16,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      backgroundColor: palette.surface,
      shadowColor: palette.shadow,
      shadowOpacity: 0.08,
      shadowRadius: 16,
      shadowOffset: { width: 0, height: 6 },
      elevation: 3,
    },
    heroIcon: { width: 42, height: 42, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.accentSoft },
    heroCopy: { flex: 1, minWidth: 0 },
    heroTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
    heroTitle: { color: palette.text, fontSize: 18, lineHeight: 24, fontWeight: '800' },
    heroSubtitle: { marginTop: 4, color: palette.textSecondary, fontSize: 12, lineHeight: 18 },
    unreadBadge: { minWidth: 22, height: 22, borderRadius: 11, paddingHorizontal: 6, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.accent },
    unreadBadgeText: { color: '#ffffff', fontSize: 11, lineHeight: 14, fontWeight: '800' },
    markReadButton: { minWidth: 48, minHeight: 48, borderRadius: 16, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: palette.accentStrong },
    markReadText: { color: '#ffffff', fontSize: 12, lineHeight: 16, fontWeight: '800' },
    buttonDisabled: { opacity: 0.48 },
    primaryPressed: { opacity: 0.84, transform: [{ scale: 0.98 }] },
    tabs: { minHeight: 60, marginTop: 12, marginBottom: 10, borderRadius: 16, borderWidth: 1, borderColor: palette.border, flexDirection: 'row', overflow: 'hidden', backgroundColor: palette.surface },
    tab: { flex: 1, minHeight: 58, alignItems: 'center', justifyContent: 'center', position: 'relative' },
    tabPressed: { backgroundColor: palette.surfacePressed },
    tabLabelRow: { minHeight: 28, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5 },
    tabText: { color: palette.textSecondary, fontSize: 14, lineHeight: 20, fontWeight: '600' },
    tabTextActive: { color: palette.accentStrong, fontWeight: '800' },
    tabBadge: { minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 5, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.surfaceMuted },
    tabBadgeActive: { backgroundColor: palette.accentSoft },
    tabBadgeText: { color: palette.textSecondary, fontSize: 10, lineHeight: 13, fontWeight: '800' },
    tabBadgeTextActive: { color: palette.accentStrong },
    tabIndicator: { position: 'absolute', bottom: 0, width: 32, height: 3, borderRadius: 2, backgroundColor: palette.accent },
    inlineError: { minHeight: 48, marginBottom: 10, borderRadius: 14, borderWidth: 1, borderColor: palette.danger, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: palette.dangerSoft },
    inlineErrorText: { flex: 1, color: palette.danger, fontSize: 12, lineHeight: 17 },
    inlineErrorClose: { color: palette.danger, fontSize: 12, lineHeight: 18, fontWeight: '800' },
    list: { flex: 1 },
    listContent: { paddingTop: 2 },
    listContentEmpty: { flexGrow: 1 },
    statePanel: { flex: 1, minHeight: 300, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, paddingBottom: 40 },
    stateIcon: { width: 54, height: 54, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.accentSoft },
    stateIconDanger: { width: 54, height: 54, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.dangerSoft },
    stateTitle: { marginTop: 15, color: palette.text, fontSize: 17, lineHeight: 23, fontWeight: '800', textAlign: 'center' },
    stateSubtitle: { marginTop: 6, color: palette.textSecondary, fontSize: 13, lineHeight: 20, textAlign: 'center' },
    retryButton: { minHeight: 48, marginTop: 18, borderRadius: 15, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: palette.accentStrong },
    retryButtonText: { color: '#ffffff', fontSize: 14, lineHeight: 19, fontWeight: '800' },
    card: {
      minHeight: 92,
      marginBottom: 10,
      borderRadius: 18,
      borderWidth: 1,
      borderColor: palette.border,
      padding: 12,
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 8,
      backgroundColor: palette.surface,
      shadowColor: palette.shadow,
      shadowOpacity: 0.06,
      shadowRadius: 13,
      shadowOffset: { width: 0, height: 5 },
      elevation: 2,
    },
    cardUnread: { borderColor: palette.accent, backgroundColor: palette.accentSoft },
    cardPressed: { backgroundColor: palette.surfacePressed, transform: [{ scale: 0.992 }] },
    avatarHitArea: { width: 52, height: 52, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
    avatarPressed: { opacity: 0.72 },
    avatar: { width: 42, height: 42, borderRadius: 21, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', backgroundColor: palette.accentSoft },
    avatarImage: { width: 42, height: 42, borderRadius: 21, backgroundColor: palette.surfaceMuted },
    avatarText: { color: palette.accentStrong, fontSize: 14, lineHeight: 18, fontWeight: '900' },
    cardMain: { flex: 1, minWidth: 0, paddingTop: 4, paddingRight: 2 },
    cardTop: { flexDirection: 'row', alignItems: 'center', gap: 7 },
    cardTitle: { flex: 1, minWidth: 0, color: palette.text, fontSize: 14, lineHeight: 20, fontWeight: '800' },
    unreadDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: palette.accent },
    cardContent: { marginTop: 5, color: palette.textSecondary, fontSize: 13, lineHeight: 20 },
    cardTime: { marginTop: 7, color: palette.textMuted, fontSize: 11, lineHeight: 16 },
    footerSpinner: { minHeight: 56, alignItems: 'center', justifyContent: 'center' },
    listEnd: { paddingVertical: 16, color: palette.textMuted, fontSize: 11, lineHeight: 16, textAlign: 'center' },
  })
}
