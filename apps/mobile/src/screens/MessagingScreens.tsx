import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AccessibilityInfo,
  ActivityIndicator,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native'
import * as Clipboard from 'expo-clipboard'
import * as ImagePicker from 'expo-image-picker'
import { useFocusEffect, useNavigation, useRoute, type RouteProp } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import {
  Ban,
  ChevronRight,
  CircleAlert,
  Copy,
  Flag,
  Gift,
  Image as ImageIcon,
  Inbox,
  MessageCircle,
  RefreshCw,
  Send,
  Trash2,
  UserRound,
  X,
} from 'lucide-react-native'
import type { ConversationSummary, FriendBlockStatus, PrivateMessageItem } from '@food-link/core'
import { apiClient, getStoredUserId } from '../api'
import type { RootStackParamList } from '../navigation/types'
import { useColorScheme } from '../providers/ColorSchemeProvider'
import { userFacingErrorMessage } from '../utils/errors'

const SYSTEM_MESSAGE_USER_ID = '00000000-0000-0000-0000-000000000000'
const PAGE_SIZE = 20
const POLL_INTERVAL_MS = 3000
const LOGIN_LOGO_URL = 'https://cdn-food-images.coachlink.fit/wechat/source-login-logo.png'

type Palette = {
  page: string
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
  selfBubble: string
  otherBubble: string
  input: string
  shadow: string
  backdrop: string
}

const lightPalette: Palette = {
  page: '#f6f9f7',
  surface: '#ffffff',
  surfaceMuted: '#f1f6f3',
  surfacePressed: '#eaf3ee',
  text: '#17211d',
  textSecondary: '#56645e',
  textMuted: '#8a9992',
  border: '#e2ebe6',
  brand: '#00a76f',
  brandStrong: '#087f58',
  brandSoft: '#e3f7ef',
  danger: '#d94747',
  dangerSoft: '#fff0f0',
  warning: '#9a6b16',
  warningSoft: '#fff7e5',
  selfBubble: '#00a76f',
  otherBubble: '#ffffff',
  input: '#f2f6f4',
  shadow: '#102019',
  backdrop: 'rgba(7, 15, 11, 0.54)',
}

const darkPalette: Palette = {
  page: '#0d1312',
  surface: '#18211e',
  surfaceMuted: '#1f2a26',
  surfacePressed: '#293631',
  text: '#f2f7f4',
  textSecondary: '#b4c1bb',
  textMuted: '#7d8e86',
  border: '#2a3832',
  brand: '#69d6ad',
  brandStrong: '#83e1bc',
  brandSoft: '#183b2e',
  danger: '#ff8b8b',
  dangerSoft: '#402326',
  warning: '#efc66f',
  warningSoft: '#3b321d',
  selfBubble: '#087f58',
  otherBubble: '#1d2824',
  input: '#202b27',
  shadow: '#000000',
  backdrop: 'rgba(0, 0, 0, 0.72)',
}

type MessagingStyles = ReturnType<typeof createStyles>

export function ConversationsScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  const insets = useSafeAreaInsets()
  const { isDark } = useColorScheme()
  const palette = isDark ? darkPalette : lightPalette
  const styles = useMemo(() => createStyles(palette), [palette])
  const [items, setItems] = useState<ConversationSummary[]>([])
  const itemsRef = useRef<ConversationSummary[]>([])
  itemsRef.current = items
  const [currentUserId, setCurrentUserId] = useState('')
  const [initialLoading, setInitialLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [actionError, setActionError] = useState('')
  const offsetRef = useRef(0)
  const loadMoreLockRef = useRef(false)
  const requestGenerationRef = useRef(0)

  useEffect(() => {
    void getStoredUserId().then((id) => setCurrentUserId(id || ''))
  }, [])

  const loadLatest = useCallback(async (mode: 'initial' | 'refresh' = 'initial') => {
    const generation = ++requestGenerationRef.current
    if (mode === 'refresh') setRefreshing(true)
    else setInitialLoading(true)
    setLoadError('')
    try {
      const response = await apiClient.listConversations({ limit: PAGE_SIZE, offset: 0 })
      if (generation !== requestGenerationRef.current) return
      const next = response.list || []
      setItems(next)
      offsetRef.current = next.length
      setHasMore(response.has_more ?? next.length >= PAGE_SIZE)
    } catch (error) {
      if (generation !== requestGenerationRef.current) return
      const message = userFacingErrorMessage(error)
      if (itemsRef.current.length === 0) setLoadError(message)
      else setActionError(`刷新失败：${message}`)
    } finally {
      if (generation === requestGenerationRef.current) {
        setInitialLoading(false)
        setRefreshing(false)
      }
    }
  }, [])

  useFocusEffect(useCallback(() => {
    void loadLatest(itemsRef.current.length > 0 ? 'refresh' : 'initial')
    return () => {
      requestGenerationRef.current += 1
    }
  }, [loadLatest]))

  const loadMore = useCallback(async () => {
    if (!hasMore || loadMoreLockRef.current || initialLoading || refreshing) return
    loadMoreLockRef.current = true
    setLoadingMore(true)
    setActionError('')
    try {
      const response = await apiClient.listConversations({ limit: PAGE_SIZE, offset: offsetRef.current })
      const next = response.list || []
      setItems((current) => mergeConversations(current, next))
      offsetRef.current += next.length
      setHasMore(response.has_more ?? next.length >= PAGE_SIZE)
    } catch (error) {
      setActionError(`加载更多失败：${userFacingErrorMessage(error)}`)
    } finally {
      setLoadingMore(false)
      loadMoreLockRef.current = false
    }
  }, [hasMore, initialLoading, refreshing])

  const renderItem = useCallback(({ item }: { item: ConversationSummary }) => {
    const userId = conversationUserId(item)
    const nickname = conversationNickname(item)
    const unread = conversationUnreadCount(item)
    const isSystem = userId === SYSTEM_MESSAGE_USER_ID
    const preview = conversationPreview(item, currentUserId)
    return (
      <Pressable
        accessible
        accessibilityRole="button"
        accessibilityLabel={`${nickname}，${preview || '暂无消息'}${unread ? `，${unread}条未读` : ''}`}
        onPress={() => {
          if (!userId) {
            setActionError('这条会话缺少用户信息，请刷新后重试。')
            return
          }
          navigation.navigate('PrivateChat', { userId, nickname })
        }}
        style={({ pressed }) => [styles.conversationCard, unread > 0 && styles.conversationCardUnread, pressed && styles.pressed]}
      >
        <Avatar nickname={nickname} avatar={isSystem ? LOGIN_LOGO_URL : conversationAvatar(item)} system={isSystem} palette={palette} styles={styles} />
        <View style={styles.conversationMain}>
          <View style={styles.conversationNameRow}>
            <Text numberOfLines={1} style={styles.conversationName}>{nickname}</Text>
            {isSystem ? <View style={styles.systemPill}><Text style={styles.systemPillText}>系统</Text></View> : null}
          </View>
          <Text numberOfLines={1} style={[styles.conversationPreview, unread > 0 && styles.conversationPreviewUnread]}>{preview || '暂无消息'}</Text>
        </View>
        <View style={styles.conversationMeta}>
          <Text style={styles.conversationTime}>{formatConversationTime(messageCreatedAt(conversationLastMessage(item)))}</Text>
          {unread > 0 ? <View style={styles.unreadBadge}><Text style={styles.unreadBadgeText}>{unread > 99 ? '99+' : unread}</Text></View> : <ChevronRight size={18} color={palette.textMuted} />}
        </View>
      </Pressable>
    )
  }, [currentUserId, navigation, palette, styles])

  if (initialLoading && items.length === 0) {
    return <View style={styles.page}><CenteredLoading palette={palette} label="正在获取私信" /></View>
  }

  if (loadError && items.length === 0) {
    return (
      <View style={styles.page}>
        <StateView icon="error" title="私信暂时没有加载出来" subtitle={loadError} action="重新加载" onAction={() => void loadLatest()} palette={palette} styles={styles} />
      </View>
    )
  }

  return (
    <View style={styles.page}>
      <View style={styles.topWash} />
      {actionError ? <InlineFeedback text={actionError} onClose={() => setActionError('')} palette={palette} styles={styles} /> : null}
      <FlatList
        data={items}
        keyExtractor={(item, index) => conversationUserId(item) || `conversation-${index}`}
        renderItem={renderItem}
        contentContainerStyle={[styles.conversationList, items.length === 0 && styles.listEmpty, { paddingBottom: Math.max(24, insets.bottom + 16) }]}
        ItemSeparatorComponent={() => <View style={styles.cardSpacer} />}
        ListEmptyComponent={<StateView icon="empty" title="暂无私信" subtitle="有人给你发消息时会出现在这里" palette={palette} styles={styles} />}
        ListFooterComponent={loadingMore ? <View style={styles.footerSpinner}><ActivityIndicator color={palette.brand} /></View> : items.length > 0 && !hasMore ? <Text style={styles.listEnd}>— 已显示全部会话 —</Text> : null}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void loadLatest('refresh')} tintColor={palette.brand} colors={[palette.brand]} progressBackgroundColor={palette.surface} />}
        onEndReached={() => void loadMore()}
        onEndReachedThreshold={0.35}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      />
    </View>
  )
}

type ConfirmState = {
  title: string
  message: string
  confirmLabel: string
  danger?: boolean
  action: () => Promise<void>
}

export function PrivateChatScreen() {
  const route = useRoute<RouteProp<RootStackParamList, 'PrivateChat'>>()
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  const insets = useSafeAreaInsets()
  const { width } = useWindowDimensions()
  const { isDark } = useColorScheme()
  const palette = isDark ? darkPalette : lightPalette
  const styles = useMemo(() => createStyles(palette), [palette])
  const listRef = useRef<FlatList<PrivateMessageItem>>(null)
  const requestGenerationRef = useRef(0)
  const pollingRef = useRef(false)
  const loadMoreLockRef = useRef(false)
  const sendingRef = useRef(false)
  const didInitialScrollRef = useRef(false)
  const offsetRef = useRef(0)
  const [messages, setMessages] = useState<PrivateMessageItem[]>([])
  const [content, setContent] = useState('')
  const [currentUserId, setCurrentUserId] = useState('')
  const [currentUserAvatar, setCurrentUserAvatar] = useState('')
  const [counterpartName, setCounterpartName] = useState(route.params.nickname || '用户')
  const [counterpartAvatar, setCounterpartAvatar] = useState('')
  const [blockStatus, setBlockStatus] = useState<FriendBlockStatus | null>(null)
  const [initialLoading, setInitialLoading] = useState(true)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [actionError, setActionError] = useState('')
  const [successText, setSuccessText] = useState('')
  const [sendingText, setSendingText] = useState(false)
  const [sendingImage, setSendingImage] = useState(false)
  const [actionTarget, setActionTarget] = useState<PrivateMessageItem | null>(null)
  const [previewUrl, setPreviewUrl] = useState('')
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null)
  const [confirmBusy, setConfirmBusy] = useState(false)
  const [reduceMotion, setReduceMotion] = useState(false)
  const isSystemChat = route.params.userId === SYSTEM_MESSAGE_USER_ID
  const chatBlocked = !isSystemChat && Boolean(blockStatus?.blocked_either)

  const announce = useCallback((text: string) => {
    setSuccessText(text)
    AccessibilityInfo.announceForAccessibility(text)
    setTimeout(() => setSuccessText((current) => current === text ? '' : current), 2200)
  }, [])

  useEffect(() => {
    let mounted = true
    void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => mounted && setReduceMotion(enabled))
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion)
    return () => {
      mounted = false
      subscription.remove()
    }
  }, [])

  useEffect(() => {
    void getStoredUserId().then((id) => setCurrentUserId(id || ''))
    void apiClient.getUserProfile().then((profile) => setCurrentUserAvatar(profile.avatar || '')).catch(() => undefined)
  }, [])

  const refreshBlockStatus = useCallback(async () => {
    if (isSystemChat) {
      setBlockStatus(null)
      return
    }
    try {
      setBlockStatus(await apiClient.getFriendBlockStatus(route.params.userId))
    } catch {
      setBlockStatus(null)
    }
  }, [isSystemChat, route.params.userId])

  useEffect(() => {
    const fallbackName = route.params.nickname || (isSystemChat ? '系统消息' : '用户')
    setCounterpartName(fallbackName)
    navigation.setOptions({ title: fallbackName })
    if (isSystemChat) {
      setCounterpartAvatar(LOGIN_LOGO_URL)
      return
    }
    void refreshBlockStatus()
    void apiClient.getPublicProfile(route.params.userId).then((profile) => {
      const nextName = profile.nickname || fallbackName
      setCounterpartName(nextName)
      setCounterpartAvatar(profile.avatar || '')
      navigation.setOptions({ title: nextName })
    }).catch(() => undefined)
  }, [isSystemChat, navigation, refreshBlockStatus, route.params.nickname, route.params.userId])

  const loadLatest = useCallback(async (quiet = false) => {
    const generation = quiet ? requestGenerationRef.current : ++requestGenerationRef.current
    if (!quiet) {
      setInitialLoading(true)
      setLoadError('')
      didInitialScrollRef.current = false
    }
    try {
      const response = await apiClient.getConversation(route.params.userId, 0, PAGE_SIZE)
      if (generation !== requestGenerationRef.current) return
      if (typeof response.blocked === 'boolean') {
        setBlockStatus((current) => response.blocked ? {
          is_blocked_by_me: current?.is_blocked_by_me || false,
          has_blocked_me: current?.has_blocked_me || false,
          blocked_either: true,
        } : { is_blocked_by_me: false, has_blocked_me: false, blocked_either: false })
      }
      const next = normalizePrivateMessages(response.list || [])
      setMessages((current) => quiet ? mergePrivateMessages(current, next) : next)
      if (!quiet) {
        offsetRef.current = (response.list || []).length
        setHasMore(response.has_more ?? (response.list || []).length >= PAGE_SIZE)
      }
      void apiClient.markConversationRead(route.params.userId).catch(() => undefined)
    } catch (error) {
      if (!quiet && generation === requestGenerationRef.current) setLoadError(userFacingErrorMessage(error))
    } finally {
      if (!quiet && generation === requestGenerationRef.current) setInitialLoading(false)
    }
  }, [route.params.userId])

  useFocusEffect(useCallback(() => {
    void loadLatest(false)
    const timer = setInterval(() => {
      if (pollingRef.current) return
      pollingRef.current = true
      void loadLatest(true).finally(() => { pollingRef.current = false })
    }, POLL_INTERVAL_MS)
    return () => {
      clearInterval(timer)
      requestGenerationRef.current += 1
    }
  }, [loadLatest]))

  const loadOlder = useCallback(async () => {
    if (!hasMore || loadMoreLockRef.current) return
    loadMoreLockRef.current = true
    setLoadingOlder(true)
    setActionError('')
    try {
      const response = await apiClient.getConversation(route.params.userId, offsetRef.current, PAGE_SIZE)
      const older = normalizePrivateMessages(response.list || [])
      setMessages((current) => mergePrivateMessages(older, current))
      offsetRef.current += (response.list || []).length
      setHasMore(response.has_more ?? (response.list || []).length >= PAGE_SIZE)
    } catch (error) {
      setActionError(`历史消息加载失败：${userFacingErrorMessage(error)}`)
    } finally {
      setLoadingOlder(false)
      loadMoreLockRef.current = false
    }
  }, [hasMore, route.params.userId])

  const scrollToBottom = useCallback((animated = true) => {
    requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated }))
  }, [])

  const sendText = useCallback(async () => {
    const value = content.trim()
    if (!value || chatBlocked || sendingRef.current) return
    sendingRef.current = true
    setSendingText(true)
    setActionError('')
    try {
      const sent = await apiClient.sendPrivateMessage(route.params.userId, value)
      setContent('')
      setMessages((current) => mergePrivateMessages(current, [sent]))
      scrollToBottom(!reduceMotion)
      void loadLatest(true)
    } catch (error) {
      setActionError(`发送失败：${userFacingErrorMessage(error)}`)
    } finally {
      sendingRef.current = false
      setSendingText(false)
    }
  }, [chatBlocked, content, loadLatest, reduceMotion, route.params.userId, scrollToBottom])

  const sendImage = useCallback(async () => {
    if (chatBlocked || sendingRef.current) return
    sendingRef.current = true
    setSendingImage(true)
    setActionError('')
    try {
      const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.85 })
      if (picked.canceled || !picked.assets[0]) return
      const asset = picked.assets[0]
      const uploaded = await apiClient.uploadAnalyzeImageFile({
        fileUri: asset.uri,
        fileName: asset.fileName || 'private-message.jpg',
        mimeType: asset.mimeType || 'image/jpeg',
      })
      const sent = await apiClient.sendPrivateMessage(route.params.userId, { contentType: 'image', imageUrl: uploaded.imageUrl })
      setMessages((current) => mergePrivateMessages(current, [sent]))
      scrollToBottom(!reduceMotion)
      void loadLatest(true)
    } catch (error) {
      setActionError(`图片发送失败：${userFacingErrorMessage(error)}`)
    } finally {
      sendingRef.current = false
      setSendingImage(false)
    }
  }, [chatBlocked, loadLatest, reduceMotion, route.params.userId, scrollToBottom])

  const runConfirm = useCallback(async () => {
    if (!confirmState || confirmBusy) return
    setConfirmBusy(true)
    try {
      await confirmState.action()
      setConfirmState(null)
    } finally {
      setConfirmBusy(false)
    }
  }, [confirmBusy, confirmState])

  const handleBlock = useCallback(() => {
    if (isSystemChat) return
    setConfirmState({
      title: '拉黑用户',
      message: `拉黑后，你和「${counterpartName || '用户'}」将无法继续互发私信，也不能重新添加好友。`,
      confirmLabel: '确认拉黑',
      danger: true,
      action: async () => {
        try {
          await apiClient.blockUser(route.params.userId)
          setContent('')
          setBlockStatus({ is_blocked_by_me: true, has_blocked_me: false, blocked_either: true })
          announce('已加入黑名单')
          void loadLatest(true)
        } catch (error) {
          setActionError(`拉黑失败：${userFacingErrorMessage(error)}`)
        }
      },
    })
  }, [announce, counterpartName, isSystemChat, loadLatest, route.params.userId])

  const handleUnblock = useCallback(() => {
    if (isSystemChat) return
    setConfirmState({
      title: '解除拉黑',
      message: '解除后，你们可以重新搜索、申请好友或发送私信。',
      confirmLabel: '确认解除',
      action: async () => {
        try {
          await apiClient.unblockUser(route.params.userId)
          await refreshBlockStatus()
          announce('已解除拉黑')
        } catch (error) {
          setActionError(`解除失败：${userFacingErrorMessage(error)}`)
        }
      },
    })
  }, [announce, isSystemChat, refreshBlockStatus, route.params.userId])

  const copyMessage = useCallback(async (message: PrivateMessageItem) => {
    const value = messageType(message) === 'image' ? messageImageUrl(message) : messageContent(message)
    if (!value.trim()) {
      setActionError('这条消息没有可复制的内容。')
      setActionTarget(null)
      return
    }
    await Clipboard.setStringAsync(value)
    setActionTarget(null)
    announce(messageType(message) === 'image' ? '图片链接已复制' : '消息已复制')
  }, [announce])

  const requestRecall = useCallback((message: PrivateMessageItem) => {
    const id = messageRecordId(message)
    setActionTarget(null)
    if (!id) {
      setActionError('这条消息缺少可撤回的 ID，请刷新后重试。')
      return
    }
    if (!isWithinRecallWindow(messageCreatedAt(message))) {
      setActionError('消息已超过 15 分钟，无法撤回。')
      return
    }
    setConfirmState({
      title: '撤回这条消息？',
      message: '撤回后，对方将无法再看到这条消息。',
      confirmLabel: '撤回',
      danger: true,
      action: async () => {
        try {
          await apiClient.deletePrivateMessage(id)
          setMessages((current) => current.filter((item) => messageRecordId(item) !== id))
          announce('消息已撤回')
          void loadLatest(true)
        } catch (error) {
          setActionError(`撤回失败：${userFacingErrorMessage(error)}`)
        }
      },
    })
  }, [announce, loadLatest])

  const requestReport = useCallback((message: PrivateMessageItem) => {
    const id = messageRecordId(message)
    setActionTarget(null)
    if (!id) {
      setActionError('这条消息缺少可举报的 ID，请刷新后重试。')
      return
    }
    setConfirmState({
      title: '举报这条消息？',
      message: '举报内容会提交给管理员审核。',
      confirmLabel: '提交举报',
      danger: true,
      action: async () => {
        try {
          await apiClient.reportPrivateMessage(id, { reason: 'other', extraContent: '来自 APP 私信长按举报' })
          announce('举报已提交')
        } catch (error) {
          setActionError(`举报失败：${userFacingErrorMessage(error)}`)
        }
      },
    })
  }, [announce])

  const openSystemAction = useCallback((message: PrivateMessageItem) => {
    const target = systemMessageTarget(message)
    if (target === 'invite') navigation.navigate('InviteFriends', { section: 'rewards' })
    else if (target === 'reward') navigation.navigate('RewardCenter')
    else setActionError('这个系统入口暂未适配 APP，请稍后再试。')
  }, [navigation])

  const renderMessage = useCallback(({ item, index }: { item: PrivateMessageItem; index: number }) => (
    <MessageRow
      message={item}
      previous={index > 0 ? messages[index - 1] : null}
      currentUserId={currentUserId}
      currentUserAvatar={currentUserAvatar}
      counterpartName={counterpartName}
      counterpartAvatar={counterpartAvatar}
      palette={palette}
      styles={styles}
      onAvatarPress={messageSenderId(item) !== currentUserId && !isSystemChat ? () => navigation.navigate('PublicProfile', { userId: route.params.userId }) : undefined}
      onLongPress={setActionTarget}
      onPreviewImage={setPreviewUrl}
      onSystemAction={openSystemAction}
    />
  ), [counterpartAvatar, counterpartName, currentUserAvatar, currentUserId, isSystemChat, messages, navigation, openSystemAction, palette, route.params.userId, styles])

  const listHeader = hasMore || loadingOlder ? (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={loadingOlder ? '正在加载更早消息' : '加载更早消息'}
      disabled={loadingOlder}
      onPress={() => void loadOlder()}
      style={({ pressed }) => [styles.loadOlderButton, pressed && styles.pressed]}
    >
      {loadingOlder ? <ActivityIndicator size="small" color={palette.brand} /> : <RefreshCw size={16} color={palette.brandStrong} />}
      <Text style={styles.loadOlderText}>{loadingOlder ? '正在加载' : '加载更早消息'}</Text>
    </Pressable>
  ) : messages.length > 0 ? <Text style={styles.historyStart}>— 已到最早消息 —</Text> : null

  return (
    <KeyboardAvoidingView style={styles.page} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={Platform.OS === 'ios' ? 88 : 0}>
      <View style={styles.topWash} />
      {!isSystemChat ? (
        <View style={styles.userActionBar}>
          <View style={styles.userActionSummary}>
            <Avatar nickname={counterpartName} avatar={counterpartAvatar} palette={palette} styles={styles} small />
            <View style={styles.userActionCopy}>
              <Text numberOfLines={1} style={styles.userActionName}>{counterpartName}</Text>
              <Text style={styles.userActionStatus}>{chatBlocked ? '当前无法互发消息' : '私信对话'}</Text>
            </View>
          </View>
          {blockStatus?.is_blocked_by_me ? (
            <Pressable accessibilityRole="button" accessibilityLabel="解除拉黑" onPress={handleUnblock} style={({ pressed }) => [styles.blockButton, pressed && styles.pressed]}><Text style={styles.blockButtonText}>解除拉黑</Text></Pressable>
          ) : blockStatus?.has_blocked_me || blockStatus?.blocked_either ? (
            <View style={styles.blockedPill}><Ban size={15} color={palette.textMuted} /><Text style={styles.blockedPillText}>无法发送</Text></View>
          ) : (
            <Pressable accessibilityRole="button" accessibilityLabel={`拉黑${counterpartName}`} onPress={handleBlock} style={({ pressed }) => [styles.blockDangerButton, pressed && styles.pressed]}><Ban size={16} color={palette.danger} /><Text style={styles.blockDangerText}>拉黑</Text></Pressable>
          )}
        </View>
      ) : null}

      {actionError ? <InlineFeedback text={actionError} onClose={() => setActionError('')} palette={palette} styles={styles} /> : null}
      {successText ? <View accessibilityLiveRegion="polite" style={styles.successBanner}><Text style={styles.successBannerText}>{successText}</Text></View> : null}

      {initialLoading && messages.length === 0 ? <CenteredLoading palette={palette} label="正在获取消息" /> : loadError && messages.length === 0 ? (
        <StateView icon="error" title="会话暂时没有加载出来" subtitle={loadError} action="重新加载" onAction={() => void loadLatest(false)} palette={palette} styles={styles} />
      ) : (
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(item, index) => privateMessageKey(item) || `message-${index}`}
          renderItem={renderMessage}
          contentContainerStyle={[styles.messageList, messages.length === 0 && styles.listEmpty]}
          ListHeaderComponent={listHeader}
          ListEmptyComponent={<StateView icon="empty" title={isSystemChat ? '暂无系统消息' : '开始聊天吧'} subtitle={isSystemChat ? '奖励和重要提醒会显示在这里' : '发一条消息，开启你们的对话'} palette={palette} styles={styles} />}
          maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
          onContentSizeChange={() => {
            if (!didInitialScrollRef.current && messages.length > 0 && !loadingOlder) {
              didInitialScrollRef.current = true
              scrollToBottom(false)
            }
          }}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        />
      )}

      {!isSystemChat ? chatBlocked ? (
        <View style={[styles.disabledComposer, { paddingBottom: Math.max(10, insets.bottom) }]}><Ban size={18} color={palette.textMuted} /><Text style={styles.disabledComposerText}>已无法继续发送消息</Text></View>
      ) : (
        <View style={[styles.composer, { paddingBottom: Math.max(10, insets.bottom) }]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={sendingImage ? '正在发送图片' : '选择图片'}
            disabled={sendingImage || sendingText}
            onPress={() => void sendImage()}
            style={({ pressed }) => [styles.imageButton, pressed && styles.pressed, (sendingImage || sendingText) && styles.disabled]}
          >
            {sendingImage ? <ActivityIndicator size="small" color={palette.brand} /> : <ImageIcon size={22} color={palette.brandStrong} />}
          </Pressable>
          <TextInput
            accessibilityLabel="私信内容"
            value={content}
            onChangeText={setContent}
            placeholder="说点什么…"
            placeholderTextColor={palette.textMuted}
            style={styles.input}
            multiline
            maxLength={1000}
            returnKeyType="send"
            blurOnSubmit={false}
            onSubmitEditing={() => void sendText()}
            onFocus={() => scrollToBottom(!reduceMotion)}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={sendingText ? '正在发送消息' : '发送消息'}
            accessibilityState={{ disabled: !content.trim() || sendingText || sendingImage }}
            disabled={!content.trim() || sendingText || sendingImage}
            onPress={() => void sendText()}
            style={({ pressed }) => [styles.sendButton, content.trim() && !sendingText && !sendingImage && styles.sendButtonActive, pressed && styles.pressed, (!content.trim() || sendingText || sendingImage) && styles.disabled]}
          >
            {sendingText ? <ActivityIndicator size="small" color="#ffffff" /> : <Send size={20} color={content.trim() ? '#ffffff' : palette.textMuted} />}
          </Pressable>
        </View>
      ) : null}

      <MessageActionSheet
        visible={Boolean(actionTarget)}
        message={actionTarget}
        isSelf={Boolean(actionTarget && isSelfMessage(actionTarget, currentUserId))}
        reduceMotion={reduceMotion}
        palette={palette}
        styles={styles}
        onCopy={copyMessage}
        onRecall={requestRecall}
        onReport={requestReport}
        onClose={() => setActionTarget(null)}
      />
      <ImagePreview visible={Boolean(previewUrl)} uri={previewUrl} width={width} reduceMotion={reduceMotion} palette={palette} styles={styles} onClose={() => setPreviewUrl('')} />
      <ConfirmSheet state={confirmState} busy={confirmBusy} reduceMotion={reduceMotion} palette={palette} styles={styles} onCancel={() => !confirmBusy && setConfirmState(null)} onConfirm={() => void runConfirm()} />
    </KeyboardAvoidingView>
  )
}

function Avatar({ nickname, avatar, system, small, palette, styles }: { nickname: string; avatar: string; system?: boolean; small?: boolean; palette: Palette; styles: MessagingStyles }) {
  const sizeStyle = small ? styles.avatarSmall : styles.avatar
  if (avatar) return <View style={sizeStyle}><Image source={{ uri: avatar }} style={small ? styles.avatarImageSmall : styles.avatarImage} resizeMode="cover" /></View>
  return (
    <View style={[sizeStyle, styles.avatarFallback]}>
      {system ? <MessageCircle size={small ? 18 : 23} color={palette.brandStrong} /> : <Text style={[styles.avatarFallbackText, small && styles.avatarFallbackTextSmall]}>{nickname.trim().slice(0, 1) || '友'}</Text>}
    </View>
  )
}

function MessageRow({ message, previous, currentUserId, currentUserAvatar, counterpartName, counterpartAvatar, palette, styles, onAvatarPress, onLongPress, onPreviewImage, onSystemAction }: {
  message: PrivateMessageItem
  previous: PrivateMessageItem | null
  currentUserId: string
  currentUserAvatar: string
  counterpartName: string
  counterpartAvatar: string
  palette: Palette
  styles: MessagingStyles
  onAvatarPress?: () => void
  onLongPress: (message: PrivateMessageItem) => void
  onPreviewImage: (uri: string) => void
  onSystemAction: (message: PrivateMessageItem) => void
}) {
  const type = messageType(message)
  const isSelf = isSelfMessage(message, currentUserId)
  const showTime = shouldShowTime(previous, message)
  const content = messageContent(message)
  const imageUrl = messageImageUrl(message)
  const systemTarget = type === 'system' ? systemMessageTarget(message) : ''
  const actionText = messageActionText(message) || (systemTarget ? '查看奖励' : '')
  return (
    <View>
      {showTime ? <View style={styles.timeDivider}><Text style={styles.timeDividerText}>{formatMessageTime(messageCreatedAt(message))}</Text></View> : null}
      {type === 'system' ? (
        <View style={styles.systemMessageWrap}>
          <View style={styles.systemMessageCard}>
            <View style={styles.systemMessageIcon}><Gift size={19} color={palette.warning} /></View>
            <Text style={styles.systemMessageText}>{content || '系统通知'}</Text>
            {systemTarget ? (
              <Pressable accessibilityRole="button" accessibilityLabel={actionText} onPress={() => onSystemAction(message)} style={({ pressed }) => [styles.systemAction, pressed && styles.pressed]}>
                <Text style={styles.systemActionText}>{actionText}</Text><ChevronRight size={16} color={palette.brandStrong} />
              </Pressable>
            ) : null}
          </View>
        </View>
      ) : (
        <View style={[styles.messageRow, isSelf && styles.messageRowSelf]}>
          <Pressable accessibilityRole={onAvatarPress ? 'button' : undefined} accessibilityLabel={onAvatarPress ? `查看${counterpartName}的主页` : undefined} disabled={!onAvatarPress} onPress={onAvatarPress} style={styles.avatarPressable}>
            <Avatar nickname={isSelf ? '我' : counterpartName} avatar={isSelf ? currentUserAvatar : counterpartAvatar} palette={palette} styles={styles} small />
          </Pressable>
          <Pressable
            accessible
            accessibilityRole={type === 'image' ? 'imagebutton' : undefined}
            accessibilityLabel={type === 'image' ? '图片消息，点按预览，长按查看更多操作' : `${isSelf ? '我发送' : `${counterpartName}发送`}：${content}，长按查看更多操作`}
            delayLongPress={350}
            onLongPress={() => onLongPress(message)}
            onPress={type === 'image' && imageUrl ? () => onPreviewImage(imageUrl) : undefined}
            style={({ pressed }) => [styles.messageBubble, isSelf && styles.messageBubbleSelf, type === 'image' && styles.messageBubbleImage, pressed && type === 'image' && styles.pressed]}
          >
            {type === 'image' && imageUrl ? <Image source={{ uri: imageUrl }} style={styles.messageImage} resizeMode="cover" /> : <Text style={[styles.messageText, isSelf && styles.messageTextSelf]}>{content || '消息'}</Text>}
          </Pressable>
        </View>
      )}
    </View>
  )
}

function MessageActionSheet({ visible, message, isSelf, reduceMotion, palette, styles, onCopy, onRecall, onReport, onClose }: {
  visible: boolean
  message: PrivateMessageItem | null
  isSelf: boolean
  reduceMotion: boolean
  palette: Palette
  styles: MessagingStyles
  onCopy: (message: PrivateMessageItem) => void
  onRecall: (message: PrivateMessageItem) => void
  onReport: (message: PrivateMessageItem) => void
  onClose: () => void
}) {
  if (!message) return null
  return (
    <Modal visible={visible} transparent statusBarTranslucent animationType={reduceMotion ? 'none' : 'slide'} onRequestClose={onClose}>
      <View style={[styles.modalBackdrop, styles.modalBottom]}>
        <Pressable accessibilityLabel="关闭消息操作" style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={styles.actionSheet}>
          <View style={styles.sheetHandle} />
          <Text style={styles.sheetTitle}>消息操作</Text>
          <ActionRow icon={isSelf ? Trash2 : Flag} label={isSelf ? '撤回消息' : '举报消息'} danger palette={palette} styles={styles} onPress={() => isSelf ? onRecall(message) : onReport(message)} />
          <View style={styles.sheetDivider} />
          <ActionRow icon={Copy} label={messageType(message) === 'image' ? '复制图片链接' : '复制文字'} palette={palette} styles={styles} onPress={() => onCopy(message)} />
          <Pressable accessibilityRole="button" accessibilityLabel="取消" onPress={onClose} style={({ pressed }) => [styles.sheetCancel, pressed && styles.pressed]}><X size={18} color={palette.textSecondary} /><Text style={styles.sheetCancelText}>取消</Text></Pressable>
        </View>
      </View>
    </Modal>
  )
}

function ActionRow({ icon: Icon, label, danger, palette, styles, onPress }: { icon: typeof Copy; label: string; danger?: boolean; palette: Palette; styles: MessagingStyles; onPress: () => void }) {
  const color = danger ? palette.danger : palette.brandStrong
  return <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={({ pressed }) => [styles.actionRow, pressed && styles.pressed]}><View style={[styles.actionIcon, danger && styles.actionIconDanger]}><Icon size={20} color={color} /></View><Text style={[styles.actionRowText, danger && styles.actionRowDanger]}>{label}</Text><ChevronRight size={18} color={palette.textMuted} /></Pressable>
}

function ConfirmSheet({ state, busy, reduceMotion, palette, styles, onCancel, onConfirm }: { state: ConfirmState | null; busy: boolean; reduceMotion: boolean; palette: Palette; styles: MessagingStyles; onCancel: () => void; onConfirm: () => void }) {
  return (
    <Modal visible={Boolean(state)} transparent statusBarTranslucent animationType={reduceMotion ? 'none' : 'fade'} onRequestClose={onCancel}>
      <View style={styles.modalBackdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onCancel} />
        {state ? <View style={styles.confirmCard}><View style={[styles.confirmIcon, state.danger && styles.confirmIconDanger]}>{state.danger ? <CircleAlert size={24} color={palette.danger} /> : <MessageCircle size={24} color={palette.brandStrong} />}</View><Text style={styles.confirmTitle}>{state.title}</Text><Text style={styles.confirmMessage}>{state.message}</Text><View style={styles.confirmActions}><Pressable accessibilityRole="button" accessibilityLabel="取消" disabled={busy} onPress={onCancel} style={({ pressed }) => [styles.confirmCancel, pressed && styles.pressed]}><Text style={styles.confirmCancelText}>取消</Text></Pressable><Pressable accessibilityRole="button" accessibilityLabel={state.confirmLabel} disabled={busy} onPress={onConfirm} style={({ pressed }) => [styles.confirmPrimary, state.danger && styles.confirmDanger, pressed && styles.pressed]}>{busy ? <ActivityIndicator color="#ffffff" /> : <Text style={styles.confirmPrimaryText}>{state.confirmLabel}</Text>}</Pressable></View></View> : null}
      </View>
    </Modal>
  )
}

function ImagePreview({ visible, uri, width, reduceMotion, palette, styles, onClose }: { visible: boolean; uri: string; width: number; reduceMotion: boolean; palette: Palette; styles: MessagingStyles; onClose: () => void }) {
  return (
    <Modal visible={visible} transparent statusBarTranslucent animationType={reduceMotion ? 'none' : 'fade'} onRequestClose={onClose}>
      <View style={styles.previewPage}>
        <Pressable accessibilityRole="button" accessibilityLabel="关闭图片预览" onPress={onClose} style={({ pressed }) => [styles.previewClose, pressed && styles.previewPressed]}><X size={26} color="#ffffff" /></Pressable>
        {uri ? <Image accessibilityLabel="私信图片预览" source={{ uri }} resizeMode="contain" style={{ width, height: '82%' }} /> : null}
        <Text style={styles.previewHint}>轻触左上角关闭</Text>
      </View>
    </Modal>
  )
}

function InlineFeedback({ text, onClose, palette, styles }: { text: string; onClose: () => void; palette: Palette; styles: MessagingStyles }) {
  return <View accessibilityLiveRegion="assertive" style={styles.inlineError}><CircleAlert size={17} color={palette.danger} /><Text style={styles.inlineErrorText}>{text}</Text><Pressable accessibilityRole="button" accessibilityLabel="关闭提示" hitSlop={8} onPress={onClose} style={styles.inlineClose}><X size={17} color={palette.danger} /></Pressable></View>
}

function CenteredLoading({ palette, label }: { palette: Palette; label: string }) {
  return <View accessible accessibilityLabel={label} style={baseStyles.centered}><ActivityIndicator color={palette.brand} size="large" /></View>
}

function StateView({ icon, title, subtitle, action, onAction, palette, styles }: { icon: 'empty' | 'error'; title: string; subtitle: string; action?: string; onAction?: () => void; palette: Palette; styles: MessagingStyles }) {
  return <View style={styles.state}><View style={[styles.stateIcon, icon === 'error' && styles.stateIconDanger]}>{icon === 'error' ? <CircleAlert size={26} color={palette.danger} /> : <Inbox size={27} color={palette.brandStrong} />}</View><Text style={styles.stateTitle}>{title}</Text><Text style={styles.stateSubtitle}>{subtitle}</Text>{action && onAction ? <Pressable accessibilityRole="button" accessibilityLabel={action} onPress={onAction} style={({ pressed }) => [styles.retryButton, pressed && styles.pressed]}><RefreshCw size={18} color="#ffffff" /><Text style={styles.retryText}>{action}</Text></Pressable> : null}</View>
}

function messageRecordId(message?: PrivateMessageItem): string { return String(message?.ID || message?.id || '').trim() }
function messageSenderId(message?: PrivateMessageItem): string { return String(message?.SenderID || message?.sender_id || '').trim() }
function messageContent(message?: PrivateMessageItem): string { return messageType(message) === 'image' && messageImageUrl(message) ? '[图片]' : String(message?.Content || message?.content || '') }
function messageImageUrl(message?: PrivateMessageItem): string { return String(message?.ImageURL || message?.image_url || '').trim() }
function messageType(message?: PrivateMessageItem): string { return String(message?.ContentType || message?.content_type || 'text').trim() }
function messageCreatedAt(message?: PrivateMessageItem): string | undefined { return message?.CreatedAt || message?.created_at }
function messageActionText(message?: PrivateMessageItem): string { return String(message?.ActionText || message?.action_text || '').trim() }
function messageExtra(message?: PrivateMessageItem): Record<string, unknown> { return (message?.ExtraData || message?.extra_data || {}) as Record<string, unknown> }
function isSelfMessage(message: PrivateMessageItem, currentUserId: string): boolean { return messageType(message) !== 'system' && Boolean(currentUserId) && messageSenderId(message) === currentUserId }

function privateMessageKey(message?: PrivateMessageItem): string {
  return messageRecordId(message) || [messageSenderId(message), messageCreatedAt(message) || '', messageType(message), messageImageUrl(message) || messageContent(message)].join('|')
}

function normalizePrivateMessages(items: PrivateMessageItem[]): PrivateMessageItem[] { return items.slice().reverse() }
function mergePrivateMessages(...groups: PrivateMessageItem[][]): PrivateMessageItem[] {
  const map = new Map<string, PrivateMessageItem>()
  groups.flat().forEach((message, index) => map.set(privateMessageKey(message) || String(index), message))
  return Array.from(map.values()).sort((a, b) => new Date(messageCreatedAt(a) || '').getTime() - new Date(messageCreatedAt(b) || '').getTime())
}
function isWithinRecallWindow(value?: string): boolean { const time = value ? new Date(value).getTime() : NaN; return Number.isFinite(time) && Date.now() - time <= 15 * 60 * 1000 }
function shouldShowTime(previous: PrivateMessageItem | null, current: PrivateMessageItem): boolean {
  if (!previous) return true
  const before = new Date(messageCreatedAt(previous) || '').getTime()
  const now = new Date(messageCreatedAt(current) || '').getTime()
  return Number.isFinite(before) && Number.isFinite(now) && Math.abs(now - before) > 10 * 60 * 1000
}
function pad2(value: number): string { return value < 10 ? `0${value}` : String(value) }
function formatMessageTime(value?: string): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const now = new Date()
  const time = `${pad2(date.getHours())}:${pad2(date.getMinutes())}`
  if (date.toDateString() === now.toDateString()) return time
  const yesterday = new Date(now.getTime() - 86400000)
  if (date.toDateString() === yesterday.toDateString()) return `昨天 ${time}`
  return `${date.getMonth() + 1}月${date.getDate()}日 ${time}`
}
function formatConversationTime(value?: string): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const diff = Date.now() - date.getTime()
  if (diff < 60000) return '刚刚'
  if (diff < 3600000) return `${Math.max(1, Math.floor(diff / 60000))}分钟前`
  if (diff < 86400000) return `${Math.max(1, Math.floor(diff / 3600000))}小时前`
  return `${date.getMonth() + 1}月${date.getDate()}日`
}
function conversationUserId(item: ConversationSummary): string { return String(item.UserID || item.user_id || '').trim() }
function conversationNickname(item: ConversationSummary): string { return String(item.Nickname || item.nickname || '用户').trim() || '用户' }
function conversationAvatar(item: ConversationSummary): string { return String(item.Avatar || item.avatar || '').trim() }
function conversationLastMessage(item: ConversationSummary): PrivateMessageItem | undefined { return item.LastMessage || item.last_message }
function conversationUnreadCount(item: ConversationSummary): number { return Math.max(0, Math.floor(Number(item.UnreadCount ?? item.unread_count ?? 0) || 0)) }
function conversationPreview(item: ConversationSummary, currentUserId: string): string {
  const message = conversationLastMessage(item)
  if (!message) return ''
  const content = messageType(message) === 'image' ? '[图片]' : messageContent(message)
  if (conversationUserId(item) === SYSTEM_MESSAGE_USER_ID) return content
  return currentUserId && messageSenderId(message) === currentUserId ? `我：${content}` : content
}
function mergeConversations(current: ConversationSummary[], next: ConversationSummary[]): ConversationSummary[] {
  const map = new Map<string, ConversationSummary>()
  current.forEach((item, index) => map.set(conversationUserId(item) || `current-${index}`, item))
  next.forEach((item, index) => map.set(conversationUserId(item) || `next-${index}`, item))
  return Array.from(map.values())
}
function systemMessageTarget(message: PrivateMessageItem): 'invite' | 'reward' | '' {
  const extra = messageExtra(message)
  const target = String(extra.target || '').trim()
  const path = String(extra.path || '').trim()
  const content = messageContent(message)
  const invite = target === 'invite-rewards' || path.includes('invite-friends') || content.includes('邀请好友达标') || content.includes('完成受邀任务') || content.includes('一周轻度版会员') || content.includes('7 天轻度版会员')
  if (invite) return 'invite'
  if (target === 'my-vouchers' || target === 'reward-center' || path.includes('my-vouchers') || path.includes('reward-center') || content.includes('我的礼券') || content.includes('新用户试用卡')) return 'reward'
  return ''
}

const baseStyles = StyleSheet.create({ centered: { flex: 1, alignItems: 'center', justifyContent: 'center', minHeight: 240 } })

function createStyles(p: Palette) {
  return StyleSheet.create({
    page: { flex: 1, backgroundColor: p.page },
    topWash: { position: 'absolute', top: 0, left: 0, right: 0, height: 150, backgroundColor: p.brandSoft, opacity: 0.34 },
    conversationList: { paddingHorizontal: 14, paddingTop: 14 },
    listEmpty: { flexGrow: 1 },
    cardSpacer: { height: 12 },
    conversationCard: { minHeight: 82, padding: 14, borderRadius: 20, borderWidth: 1, borderColor: p.border, flexDirection: 'row', alignItems: 'center', backgroundColor: p.surface, shadowColor: p.shadow, shadowOpacity: 0.06, shadowRadius: 12, shadowOffset: { width: 0, height: 5 }, elevation: 2 },
    conversationCardUnread: { borderColor: p.brand, backgroundColor: p.brandSoft },
    pressed: { opacity: 0.78, transform: [{ scale: 0.992 }] },
    disabled: { opacity: 0.45 },
    avatar: { width: 50, height: 50, borderRadius: 25, overflow: 'hidden' },
    avatarSmall: { width: 38, height: 38, borderRadius: 19, overflow: 'hidden' },
    avatarImage: { width: 50, height: 50, borderRadius: 25, backgroundColor: p.surfaceMuted },
    avatarImageSmall: { width: 38, height: 38, borderRadius: 19, backgroundColor: p.surfaceMuted },
    avatarFallback: { alignItems: 'center', justifyContent: 'center', backgroundColor: p.brandSoft },
    avatarFallbackText: { color: p.brandStrong, fontSize: 18, lineHeight: 23, fontWeight: '900' },
    avatarFallbackTextSmall: { fontSize: 14, lineHeight: 18 },
    conversationMain: { flex: 1, minWidth: 0, marginLeft: 12 },
    conversationNameRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
    conversationName: { flexShrink: 1, color: p.text, fontSize: 15, lineHeight: 21, fontWeight: '800' },
    systemPill: { borderRadius: 999, paddingHorizontal: 7, paddingVertical: 2, backgroundColor: p.warningSoft },
    systemPillText: { color: p.warning, fontSize: 9, lineHeight: 13, fontWeight: '900' },
    conversationPreview: { marginTop: 5, color: p.textSecondary, fontSize: 13, lineHeight: 19 },
    conversationPreviewUnread: { color: p.text, fontWeight: '700' },
    conversationMeta: { width: 72, minHeight: 48, alignItems: 'flex-end', justifyContent: 'space-between', marginLeft: 8 },
    conversationTime: { color: p.textMuted, fontSize: 10, lineHeight: 15 },
    unreadBadge: { minWidth: 22, height: 22, borderRadius: 11, paddingHorizontal: 6, alignItems: 'center', justifyContent: 'center', backgroundColor: p.danger },
    unreadBadgeText: { color: '#ffffff', fontSize: 10, lineHeight: 13, fontWeight: '900' },
    footerSpinner: { minHeight: 52, alignItems: 'center', justifyContent: 'center' },
    listEnd: { paddingVertical: 18, color: p.textMuted, fontSize: 11, lineHeight: 16, textAlign: 'center' },
    inlineError: { minHeight: 48, marginHorizontal: 14, marginTop: 10, borderRadius: 15, borderWidth: 1, borderColor: p.danger, paddingLeft: 12, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: p.dangerSoft, zIndex: 2 },
    inlineErrorText: { flex: 1, color: p.danger, fontSize: 12, lineHeight: 18, fontWeight: '600' },
    inlineClose: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
    successBanner: { minHeight: 42, marginHorizontal: 14, marginTop: 8, borderRadius: 14, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14, backgroundColor: p.brandSoft },
    successBannerText: { color: p.brandStrong, fontSize: 12, lineHeight: 18, fontWeight: '800' },
    state: { flex: 1, minHeight: 260, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 34, paddingVertical: 30 },
    stateIcon: { width: 58, height: 58, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: p.brandSoft },
    stateIconDanger: { backgroundColor: p.dangerSoft },
    stateTitle: { marginTop: 16, color: p.text, fontSize: 17, lineHeight: 24, fontWeight: '900', textAlign: 'center' },
    stateSubtitle: { marginTop: 7, color: p.textSecondary, fontSize: 13, lineHeight: 20, textAlign: 'center' },
    retryButton: { minHeight: 48, marginTop: 18, borderRadius: 15, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: p.brandStrong },
    retryText: { color: '#ffffff', fontSize: 14, lineHeight: 20, fontWeight: '900' },
    userActionBar: { minHeight: 68, borderBottomWidth: 1, borderBottomColor: p.border, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: p.surface },
    userActionSummary: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center' },
    userActionCopy: { flex: 1, minWidth: 0, marginLeft: 10 },
    userActionName: { color: p.text, fontSize: 14, lineHeight: 19, fontWeight: '800' },
    userActionStatus: { marginTop: 2, color: p.textMuted, fontSize: 10, lineHeight: 14 },
    blockButton: { minWidth: 88, minHeight: 48, borderRadius: 15, borderWidth: 1, borderColor: p.border, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12, backgroundColor: p.surfaceMuted },
    blockButtonText: { color: p.textSecondary, fontSize: 12, fontWeight: '800' },
    blockDangerButton: { minWidth: 76, minHeight: 48, borderRadius: 15, borderWidth: 1, borderColor: p.danger, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: 10, backgroundColor: p.dangerSoft },
    blockDangerText: { color: p.danger, fontSize: 12, fontWeight: '800' },
    blockedPill: { minHeight: 38, borderRadius: 14, flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, backgroundColor: p.surfaceMuted },
    blockedPillText: { color: p.textMuted, fontSize: 11, fontWeight: '700' },
    messageList: { flexGrow: 1, paddingHorizontal: 14, paddingTop: 8, paddingBottom: 14 },
    loadOlderButton: { alignSelf: 'center', minHeight: 48, borderRadius: 15, marginVertical: 6, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, backgroundColor: p.surface },
    loadOlderText: { color: p.brandStrong, fontSize: 12, lineHeight: 18, fontWeight: '800' },
    historyStart: { paddingVertical: 12, color: p.textMuted, fontSize: 10, lineHeight: 15, textAlign: 'center' },
    timeDivider: { alignItems: 'center', paddingVertical: 12 },
    timeDividerText: { borderRadius: 999, paddingHorizontal: 9, paddingVertical: 3, overflow: 'hidden', color: p.textMuted, backgroundColor: p.surfaceMuted, fontSize: 10, lineHeight: 14 },
    messageRow: { marginBottom: 10, flexDirection: 'row', alignItems: 'flex-end', paddingRight: 54 },
    messageRowSelf: { flexDirection: 'row-reverse', paddingRight: 0, paddingLeft: 54 },
    avatarPressable: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
    messageBubble: { maxWidth: '82%', minHeight: 42, borderRadius: 18, borderBottomLeftRadius: 6, borderWidth: 1, borderColor: p.border, justifyContent: 'center', marginLeft: 6, paddingHorizontal: 13, paddingVertical: 10, backgroundColor: p.otherBubble, shadowColor: p.shadow, shadowOpacity: 0.04, shadowRadius: 5, shadowOffset: { width: 0, height: 2 }, elevation: 1 },
    messageBubbleSelf: { borderBottomLeftRadius: 18, borderBottomRightRadius: 6, borderColor: p.selfBubble, marginLeft: 0, marginRight: 6, backgroundColor: p.selfBubble },
    messageBubbleImage: { padding: 3, overflow: 'hidden', backgroundColor: p.surface },
    messageText: { color: p.text, fontSize: 15, lineHeight: 22 },
    messageTextSelf: { color: '#ffffff' },
    messageImage: { width: 190, height: 150, borderRadius: 14, backgroundColor: p.surfaceMuted },
    systemMessageWrap: { alignItems: 'center', paddingHorizontal: 28, marginBottom: 12 },
    systemMessageCard: { width: '100%', maxWidth: 380, borderRadius: 18, borderWidth: 1, borderColor: p.border, alignItems: 'center', padding: 14, backgroundColor: p.surface },
    systemMessageIcon: { width: 38, height: 38, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: p.warningSoft },
    systemMessageText: { marginTop: 10, color: p.textSecondary, fontSize: 13, lineHeight: 20, textAlign: 'center' },
    systemAction: { minHeight: 48, marginTop: 10, borderRadius: 15, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, backgroundColor: p.brandSoft },
    systemActionText: { color: p.brandStrong, fontSize: 13, lineHeight: 19, fontWeight: '900' },
    composer: { minHeight: 70, borderTopWidth: 1, borderTopColor: p.border, paddingTop: 9, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'flex-end', gap: 8, backgroundColor: p.surface },
    imageButton: { width: 48, height: 48, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: p.brandSoft },
    input: { flex: 1, minHeight: 48, maxHeight: 108, borderRadius: 17, borderWidth: 1, borderColor: p.border, paddingHorizontal: 14, paddingTop: Platform.OS === 'ios' ? 13 : 10, paddingBottom: Platform.OS === 'ios' ? 13 : 10, color: p.text, backgroundColor: p.input, fontSize: 15, lineHeight: 21 },
    sendButton: { width: 48, height: 48, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: p.surfaceMuted },
    sendButtonActive: { backgroundColor: p.brandStrong },
    disabledComposer: { minHeight: 68, borderTopWidth: 1, borderTopColor: p.border, paddingTop: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, backgroundColor: p.surface },
    disabledComposerText: { color: p.textMuted, fontSize: 13, lineHeight: 19, fontWeight: '700' },
    modalBackdrop: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 22, backgroundColor: p.backdrop },
    modalBottom: { justifyContent: 'flex-end', paddingHorizontal: 10, paddingBottom: 12 },
    actionSheet: { width: '100%', maxWidth: 520, borderRadius: 24, padding: 12, backgroundColor: p.surface },
    sheetHandle: { width: 38, height: 4, borderRadius: 2, alignSelf: 'center', backgroundColor: p.border },
    sheetTitle: { paddingVertical: 13, color: p.textMuted, fontSize: 11, lineHeight: 16, fontWeight: '800', textAlign: 'center' },
    actionRow: { minHeight: 56, borderRadius: 16, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center' },
    actionIcon: { width: 38, height: 38, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: p.brandSoft },
    actionIconDanger: { backgroundColor: p.dangerSoft },
    actionRowText: { flex: 1, marginLeft: 11, color: p.text, fontSize: 14, lineHeight: 20, fontWeight: '800' },
    actionRowDanger: { color: p.danger },
    sheetDivider: { height: 1, marginLeft: 58, backgroundColor: p.border },
    sheetCancel: { minHeight: 50, borderRadius: 16, marginTop: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, backgroundColor: p.surfaceMuted },
    sheetCancelText: { color: p.textSecondary, fontSize: 14, lineHeight: 20, fontWeight: '800' },
    confirmCard: { width: '100%', maxWidth: 380, borderRadius: 24, padding: 22, backgroundColor: p.surface },
    confirmIcon: { width: 46, height: 46, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: p.brandSoft },
    confirmIconDanger: { backgroundColor: p.dangerSoft },
    confirmTitle: { marginTop: 16, color: p.text, fontSize: 19, lineHeight: 25, fontWeight: '900' },
    confirmMessage: { marginTop: 8, color: p.textSecondary, fontSize: 14, lineHeight: 21 },
    confirmActions: { marginTop: 22, flexDirection: 'row', gap: 10 },
    confirmCancel: { flex: 1, minHeight: 48, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: p.surfaceMuted },
    confirmCancelText: { color: p.textSecondary, fontSize: 14, fontWeight: '800' },
    confirmPrimary: { flex: 1, minHeight: 48, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: p.brandStrong },
    confirmDanger: { backgroundColor: p.danger },
    confirmPrimaryText: { color: '#ffffff', fontSize: 14, fontWeight: '900' },
    previewPage: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#050706' },
    previewClose: { position: 'absolute', top: 42, left: 14, width: 48, height: 48, zIndex: 3, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.14)' },
    previewPressed: { backgroundColor: 'rgba(255,255,255,0.25)' },
    previewHint: { position: 'absolute', bottom: 30, color: 'rgba(255,255,255,0.7)', fontSize: 12, lineHeight: 18 },
  })
}
