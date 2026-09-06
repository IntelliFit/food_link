import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AccessibilityInfo,
  ActivityIndicator,
  FlatList,
  Image,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native'
import { CommonActions, useFocusEffect, useNavigation, useRoute } from '@react-navigation/native'
import type { RouteProp } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import {
  Ban,
  Check,
  ChevronRight,
  CircleAlert,
  Inbox,
  MessageCircle,
  MoreHorizontal,
  RefreshCw,
  Search,
  Send,
  ShieldOff,
  Trash2,
  UserPlus,
  UsersRound,
  X,
} from 'lucide-react-native'
import type { FriendBlockItem, FriendRequestItem, FriendUserItem } from '@food-link/core'
import { apiClient } from '../api'
import type { RootStackParamList } from '../navigation/types'
import { useColorScheme } from '../providers/ColorSchemeProvider'
import { userFacingErrorMessage } from '../utils/errors'
import { markFriendRequestsBadgeSeen } from '../utils/profileTabBadge'

type FriendTab = 'friends' | 'received' | 'sent' | 'blocks'

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
  backdrop: string
}

const lightPalette: Palette = {
  page: '#f6f9f7',
  topWash: '#e7f8f0',
  surface: '#ffffff',
  surfaceMuted: '#f1f6f3',
  surfacePressed: '#eaf3ee',
  text: '#17211d',
  textSecondary: '#56645e',
  textMuted: '#7b8b83',
  border: '#e0eae4',
  brand: '#00a76f',
  brandStrong: '#087f58',
  brandSoft: '#e3f7ef',
  danger: '#d94747',
  dangerSoft: '#fff0f0',
  warning: '#956711',
  warningSoft: '#fff6df',
  shadow: '#102019',
  backdrop: 'rgba(7, 15, 11, 0.56)',
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
  backdrop: 'rgba(0, 0, 0, 0.72)',
}

type RowItem =
  | { kind: 'friend'; value: FriendUserItem }
  | { kind: 'received'; value: FriendRequestItem }
  | { kind: 'sent'; value: FriendRequestItem }
  | { kind: 'block'; value: FriendBlockItem }

type ConfirmState =
  | { kind: 'delete'; friend: FriendUserItem; title: string; message: string; confirmLabel: string }
  | { kind: 'block'; friend: FriendUserItem; title: string; message: string; confirmLabel: string }
  | { kind: 'unblock'; block: FriendBlockItem; title: string; message: string; confirmLabel: string }
  | { kind: 'cancel'; request: FriendRequestItem; title: string; message: string; confirmLabel: string }
  | { kind: 'reject'; request: FriendRequestItem; title: string; message: string; confirmLabel: string }

type FriendsStyles = ReturnType<typeof createStyles>

const TAB_LABELS: Record<FriendTab, string> = {
  friends: '好友列表',
  received: '收到请求',
  sent: '我发起的',
  blocks: '黑名单',
}

export function FriendsScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  const route = useRoute<RouteProp<RootStackParamList, 'Friends'>>()
  const insets = useSafeAreaInsets()
  const { width } = useWindowDimensions()
  const { isDark } = useColorScheme()
  const palette = isDark ? darkPalette : lightPalette
  const styles = useMemo(() => createStyles(palette), [palette])
  const horizontalInset = width >= 760 ? Math.max(24, (width - 680) / 2) : 16

  const [activeTab, setActiveTab] = useState<FriendTab>(route.params?.initialTab || 'friends')
  const [friends, setFriends] = useState<FriendUserItem[]>([])
  const [received, setReceived] = useState<FriendRequestItem[]>([])
  const [sent, setSent] = useState<FriendRequestItem[]>([])
  const [blocks, setBlocks] = useState<FriendBlockItem[]>([])
  const [query, setQuery] = useState('')
  const [initialLoading, setInitialLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [feedback, setFeedback] = useState('')
  const [busyKey, setBusyKey] = useState('')
  const [menuFriend, setMenuFriend] = useState<FriendUserItem | null>(null)
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null)
  const [reduceMotion, setReduceMotion] = useState(false)
  const requestGenerationRef = useRef(0)
  const hasContentRef = useRef(false)

  const receivedPending = useMemo(() => received.filter((item) => requestStatus(item) === 'pending').length, [received])
  const sentPending = useMemo(() => sent.filter((item) => requestStatus(item) === 'pending').length, [sent])
  const filteredFriends = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase()
    if (!normalized) return friends
    return friends.filter((friend) => friendName(friend).toLocaleLowerCase().includes(normalized))
  }, [friends, query])

  hasContentRef.current = friends.length + received.length + sent.length + blocks.length > 0

  const rows = useMemo<RowItem[]>(() => {
    if (activeTab === 'friends') return filteredFriends.map((value) => ({ kind: 'friend', value }))
    if (activeTab === 'received') return received.map((value) => ({ kind: 'received', value }))
    if (activeTab === 'sent') return sent.map((value) => ({ kind: 'sent', value }))
    return blocks.map((value) => ({ kind: 'block', value }))
  }, [activeTab, blocks, filteredFriends, received, sent])

  const announce = useCallback((message: string) => {
    setFeedback(message)
    AccessibilityInfo.announceForAccessibility(message)
  }, [])

  const load = useCallback(async (mode: 'initial' | 'refresh' = 'initial') => {
    const generation = ++requestGenerationRef.current
    if (mode === 'refresh') setRefreshing(true)
    else setInitialLoading(true)
    setLoadError('')
    try {
      const [friendData, requestData, blockData] = await Promise.all([
        apiClient.listFriends(),
        apiClient.getFriendRequestsOverview(),
        apiClient.listBlockedUsers(),
      ])
      if (generation !== requestGenerationRef.current) return
      setFriends(friendData.list || [])
      setReceived(requestData.received || [])
      setSent(requestData.sent || [])
      setBlocks(blockData.list || [])
    } catch (error) {
      if (generation !== requestGenerationRef.current) return
      const message = userFacingErrorMessage(error)
      if (hasContentRef.current) announce(`刷新失败：${message}`)
      else setLoadError(message)
    } finally {
      if (generation === requestGenerationRef.current) {
        setInitialLoading(false)
        setRefreshing(false)
      }
    }
  }, [announce])

  useFocusEffect(useCallback(() => {
    void load(hasContentRef.current ? 'refresh' : 'initial')
    return () => {
      requestGenerationRef.current += 1
      void markFriendRequestsBadgeSeen()
    }
  }, [load]))

  useEffect(() => {
    if (activeTab === 'received') void markFriendRequestsBadgeSeen()
  }, [activeTab])

  useEffect(() => {
    let mounted = true
    void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => mounted && setReduceMotion(enabled))
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion)
    return () => {
      mounted = false
      subscription.remove()
    }
  }, [])

  const selectTab = useCallback((tab: FriendTab) => {
    setActiveTab(tab)
    setFeedback('')
    if (tab !== 'friends') setQuery('')
  }, [])

  const openProfile = useCallback((userId?: string) => {
    const id = String(userId || '').trim()
    if (id) navigation.navigate('ProfileSettings', { userId: id })
  }, [navigation])

  const openChat = useCallback((friend: FriendUserItem) => {
    const id = friendId(friend)
    if (!id) return
    navigation.navigate('PrivateChat', { userId: id, nickname: friendName(friend) })
  }, [navigation])

  const goToCommunity = useCallback(() => {
    navigation.dispatch(CommonActions.navigate({ name: 'MainTabs', params: { screen: 'CommunityTab' } }))
  }, [navigation])

  const acceptRequest = useCallback(async (request: FriendRequestItem) => {
    if (requestStatus(request) !== 'pending') return
    const key = `accept:${request.id}`
    setBusyKey(key)
    try {
      await apiClient.respondFriendRequest(request.id, 'accept')
      setReceived((current) => current.map((item) => item.id === request.id ? { ...item, status: 'accepted' } : item))
      const id = requestUserId(request)
      if (id) {
        setFriends((current) => current.some((item) => friendId(item) === id) ? current : [{
          id,
          nickname: requestName(request),
          avatar: requestAvatar(request),
          is_friend: true,
        }, ...current])
      }
      announce(`已添加${requestName(request)}为好友`)
    } catch (error) {
      announce(`接受失败：${userFacingErrorMessage(error)}`)
    } finally {
      setBusyKey('')
    }
  }, [announce])

  const runConfirmedAction = useCallback(async () => {
    const state = confirmState
    if (!state || busyKey) return
    const key = state.kind === 'delete' || state.kind === 'block'
      ? `${state.kind}:${friendId(state.friend)}`
      : state.kind === 'unblock'
        ? `unblock:${blockUserId(state.block)}`
        : `${state.kind}:${state.request.id}`
    setBusyKey(key)
    try {
      if (state.kind === 'delete') {
        const id = friendId(state.friend)
        await apiClient.deleteFriend(id)
        setFriends((current) => current.filter((item) => friendId(item) !== id))
        announce(`已删除好友${friendName(state.friend)}`)
      } else if (state.kind === 'block') {
        const id = friendId(state.friend)
        await apiClient.blockUser(id)
        setFriends((current) => current.filter((item) => friendId(item) !== id))
        setBlocks((current) => [{
          id: `local-${id}`,
          blocked_user_id: id,
          nickname: friendName(state.friend),
          avatar: state.friend.avatar,
          blocked_at: new Date().toISOString(),
        }, ...current.filter((item) => blockUserId(item) !== id)])
        announce(`已将${friendName(state.friend)}加入黑名单`)
      } else if (state.kind === 'unblock') {
        const id = blockUserId(state.block)
        await apiClient.unblockUser(id)
        setBlocks((current) => current.filter((item) => blockUserId(item) !== id))
        announce(`已解除对${blockName(state.block)}的拉黑`)
      } else if (state.kind === 'cancel') {
        await apiClient.cancelSentFriendRequest(state.request.id)
        setSent((current) => current.filter((item) => item.id !== state.request.id))
        announce(`已撤销对${requestName(state.request)}的好友申请`)
      } else {
        await apiClient.respondFriendRequest(state.request.id, 'reject')
        setReceived((current) => current.map((item) => item.id === state.request.id ? { ...item, status: 'rejected' } : item))
        announce(`已拒绝${requestName(state.request)}的好友申请`)
      }
      setConfirmState(null)
    } catch (error) {
      announce(`操作失败：${userFacingErrorMessage(error)}`)
    } finally {
      setBusyKey('')
    }
  }, [announce, busyKey, confirmState])

  const renderItem = useCallback(({ item }: { item: RowItem }) => {
    if (item.kind === 'friend') {
      const friend = item.value
      const id = friendId(friend)
      return (
        <FriendCard
          friend={friend}
          palette={palette}
          styles={styles}
          onProfile={() => openProfile(id)}
          onChat={() => openChat(friend)}
          onMore={() => setMenuFriend(friend)}
        />
      )
    }
    if (item.kind === 'received') {
      const request = item.value
      const pending = requestStatus(request) === 'pending'
      return (
        <RequestCard
          request={request}
          palette={palette}
          styles={styles}
          onProfile={() => openProfile(requestUserId(request))}
          actions={pending ? (
            <View style={styles.inlineActions}>
              <RoundAction
                label={`拒绝${requestName(request)}的好友申请`}
                icon={X}
                danger
                disabled={Boolean(busyKey)}
                loading={busyKey === `reject:${request.id}`}
                palette={palette}
                styles={styles}
                onPress={() => setConfirmState({
                  kind: 'reject',
                  request,
                  title: '拒绝好友申请',
                  message: `确定拒绝「${requestName(request)}」的好友申请吗？`,
                  confirmLabel: '拒绝',
                })}
              />
              <RoundAction
                label={`接受${requestName(request)}的好友申请`}
                icon={Check}
                disabled={Boolean(busyKey)}
                loading={busyKey === `accept:${request.id}`}
                palette={palette}
                styles={styles}
                onPress={() => void acceptRequest(request)}
              />
            </View>
          ) : <StatusPill status={requestStatus(request)} palette={palette} styles={styles} />}
        />
      )
    }
    if (item.kind === 'sent') {
      const request = item.value
      const pending = requestStatus(request) === 'pending'
      return (
        <RequestCard
          request={request}
          palette={palette}
          styles={styles}
          onProfile={() => openProfile(requestUserId(request))}
          actions={<StatusPill status={requestStatus(request)} palette={palette} styles={styles} />}
          footer={pending ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`撤销对${requestName(request)}的好友申请`}
              disabled={Boolean(busyKey)}
              onPress={() => setConfirmState({
                kind: 'cancel',
                request,
                title: '撤销申请',
                message: `确定撤销对「${requestName(request)}」的好友申请吗？`,
                confirmLabel: '撤销',
              })}
              style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed, Boolean(busyKey) && styles.disabled]}
            >
              {busyKey === `cancel:${request.id}` ? <ActivityIndicator size="small" color={palette.textSecondary} /> : <Text style={styles.secondaryButtonText}>撤销申请</Text>}
            </Pressable>
          ) : undefined}
        />
      )
    }
    const block = item.value
    const id = blockUserId(block)
    return (
      <BlockCard
        block={block}
        palette={palette}
        styles={styles}
        onProfile={() => openProfile(id)}
        onUnblock={() => setConfirmState({
          kind: 'unblock',
          block,
          title: '解除拉黑',
          message: `确定解除对「${blockName(block)}」的拉黑吗？解除后不会自动恢复好友关系。`,
          confirmLabel: '解除',
        })}
        loading={busyKey === `unblock:${id}`}
        disabled={Boolean(busyKey)}
      />
    )
  }, [acceptRequest, busyKey, openChat, openProfile, palette, styles])

  const empty = !initialLoading && !loadError ? (
    <EmptyState
      tab={activeTab}
      searching={activeTab === 'friends' && Boolean(query.trim())}
      palette={palette}
      styles={styles}
      onCommunity={goToCommunity}
    />
  ) : null

  return (
    <View style={styles.page}>
      <View pointerEvents="none" style={styles.topWash} />
      {feedback ? <InlineFeedback text={feedback} palette={palette} styles={styles} onClose={() => setFeedback('')} /> : null}
      {initialLoading && !hasContentRef.current ? (
        <View accessible accessibilityLabel="正在获取好友数据" style={styles.centered}><ActivityIndicator size="large" color={palette.brand} /></View>
      ) : loadError && !hasContentRef.current ? (
        <LoadError message={loadError} palette={palette} styles={styles} onRetry={() => void load('initial')} />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={rowKey}
          renderItem={renderItem}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          contentContainerStyle={{ paddingHorizontal: horizontalInset, paddingBottom: Math.max(32, insets.bottom + 24), flexGrow: rows.length === 0 ? 1 : undefined }}
          ItemSeparatorComponent={ListGap}
          ListHeaderComponent={(
            <View>
              <View style={styles.toolbar}>
                <View style={styles.toolbarCopy}>
                  <Text style={styles.toolbarTitle}>我的食友</Text>
                  <Text style={styles.toolbarSubtitle}>找到同伴，也能随时管理请求与隐私</Text>
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="刷新好友数据"
                  disabled={refreshing}
                  onPress={() => void load('refresh')}
                  style={({ pressed }) => [styles.refreshButton, pressed && styles.pressed, refreshing && styles.disabled]}
                >
                  {refreshing ? <ActivityIndicator size="small" color={palette.brandStrong} /> : <RefreshCw size={19} color={palette.brandStrong} />}
                </Pressable>
              </View>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabs} accessibilityRole="tablist">
                {(['friends', 'received', 'sent', 'blocks'] as FriendTab[]).map((tab) => (
                  <TabButton
                    key={tab}
                    tab={tab}
                    active={activeTab === tab}
                    count={tab === 'friends' ? friends.length : tab === 'received' ? receivedPending : tab === 'sent' ? sentPending : blocks.length}
                    palette={palette}
                    styles={styles}
                    onPress={() => selectTab(tab)}
                  />
                ))}
              </ScrollView>
              {activeTab === 'friends' && friends.length > 0 ? (
                <View style={styles.searchBox}>
                  <Search size={19} color={palette.textMuted} />
                  <TextInput
                    accessibilityLabel="搜索好友昵称"
                    accessibilityHint="输入好友昵称筛选当前列表"
                    value={query}
                    onChangeText={setQuery}
                    placeholder="搜索好友昵称"
                    placeholderTextColor={palette.textMuted}
                    returnKeyType="search"
                    style={styles.searchInput}
                  />
                  {query ? (
                    <Pressable accessibilityRole="button" accessibilityLabel="清除搜索" onPress={() => setQuery('')} style={({ pressed }) => [styles.clearButton, pressed && styles.pressed]}>
                      <X size={17} color={palette.textSecondary} />
                    </Pressable>
                  ) : null}
                </View>
              ) : null}
              <View style={styles.sectionHeading}>
                <Text style={styles.sectionTitle}>{TAB_LABELS[activeTab]}</Text>
                <Text style={styles.sectionCount}>{rows.length} 项</Text>
              </View>
            </View>
          )}
          ListEmptyComponent={empty}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load('refresh')} tintColor={palette.brand} colors={[palette.brand]} progressBackgroundColor={palette.surface} />}
          initialNumToRender={12}
          maxToRenderPerBatch={10}
          windowSize={7}
          removeClippedSubviews
        />
      )}

      <FriendMenu
        friend={menuFriend}
        reduceMotion={reduceMotion}
        palette={palette}
        styles={styles}
        onClose={() => setMenuFriend(null)}
        onBlock={(friend) => {
          setMenuFriend(null)
          setConfirmState({
            kind: 'block',
            friend,
            title: '拉黑用户',
            message: `拉黑「${friendName(friend)}」后会解除好友关系，双方无法私信、加好友，也不会在圈子里互相看到内容。`,
            confirmLabel: '拉黑',
          })
        }}
        onDelete={(friend) => {
          setMenuFriend(null)
          setConfirmState({
            kind: 'delete',
            friend,
            title: '删除好友',
            message: `确定删除好友「${friendName(friend)}」吗？删除后需要重新添加。`,
            confirmLabel: '删除',
          })
        }}
      />
      <ConfirmSheet
        state={confirmState}
        reduceMotion={reduceMotion}
        busy={Boolean(busyKey)}
        palette={palette}
        styles={styles}
        onCancel={() => !busyKey && setConfirmState(null)}
        onConfirm={() => void runConfirmedAction()}
      />
    </View>
  )
}

function FriendCard({ friend, palette, styles, onProfile, onChat, onMore }: {
  friend: FriendUserItem
  palette: Palette
  styles: FriendsStyles
  onProfile: () => void
  onChat: () => void
  onMore: () => void
}) {
  const name = friendName(friend)
  return (
    <View style={styles.card}>
      <Pressable accessibilityRole="button" accessibilityLabel={`查看${name}的主页`} onPress={onProfile} style={({ pressed }) => [styles.personArea, pressed && styles.personPressed]}>
        <Avatar uri={friend.avatar} name={name} palette={palette} styles={styles} />
        <View style={styles.personMeta}>
          <Text style={styles.personName} numberOfLines={2}>{name}</Text>
          <View style={styles.relationshipRow}><View style={styles.onlineDot} /><Text style={styles.personSubtitle}>好友</Text></View>
        </View>
        <ChevronRight size={18} color={palette.textMuted} />
      </Pressable>
      <View style={styles.cardActions}>
        <Pressable accessibilityRole="button" accessibilityLabel={`给${name}发私信`} onPress={onChat} style={({ pressed }) => [styles.messageButton, pressed && styles.pressed]}>
          <MessageCircle size={19} color={palette.brandStrong} />
          <Text style={styles.messageButtonText}>私信</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={`管理好友${name}`} onPress={onMore} style={({ pressed }) => [styles.moreButton, pressed && styles.pressed]}>
          <MoreHorizontal size={21} color={palette.textSecondary} />
        </Pressable>
      </View>
    </View>
  )
}

function RequestCard({ request, actions, footer, palette, styles, onProfile }: {
  request: FriendRequestItem
  actions?: React.ReactNode
  footer?: React.ReactNode
  palette: Palette
  styles: FriendsStyles
  onProfile: () => void
}) {
  const name = requestName(request)
  return (
    <View style={[styles.card, footer ? styles.cardWithFooter : undefined]}>
      <View style={styles.requestRow}>
        <Pressable accessibilityRole="button" accessibilityLabel={`查看${name}的主页`} onPress={onProfile} style={({ pressed }) => [styles.requestPerson, pressed && styles.personPressed]}>
          <Avatar uri={requestAvatar(request)} name={name} palette={palette} styles={styles} />
          <View style={styles.personMeta}>
            <Text style={styles.personName} numberOfLines={2}>{name}</Text>
            <Text style={styles.personSubtitle} numberOfLines={1}>{formatRelativeTime(request.created_at)}</Text>
          </View>
        </Pressable>
        {actions}
      </View>
      {footer ? <View style={styles.cardFooter}>{footer}</View> : null}
    </View>
  )
}

function BlockCard({ block, palette, styles, loading, disabled, onProfile, onUnblock }: {
  block: FriendBlockItem
  palette: Palette
  styles: FriendsStyles
  loading: boolean
  disabled: boolean
  onProfile: () => void
  onUnblock: () => void
}) {
  const name = blockName(block)
  return (
    <View style={styles.card}>
      <Pressable accessibilityRole="button" accessibilityLabel={`查看${name}的主页`} onPress={onProfile} style={({ pressed }) => [styles.personArea, pressed && styles.personPressed]}>
        <Avatar uri={block.avatar} name={name} palette={palette} styles={styles} />
        <View style={styles.personMeta}>
          <Text style={styles.personName} numberOfLines={2}>{name}</Text>
          <Text style={styles.personSubtitle} numberOfLines={1}>{block.blocked_at || block.created_at ? `拉黑于 ${formatShortDate(block.blocked_at || block.created_at)}` : '已加入黑名单'}</Text>
        </View>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={`解除对${name}的拉黑`} disabled={disabled} onPress={onUnblock} style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed, disabled && styles.disabled]}>
        {loading ? <ActivityIndicator size="small" color={palette.textSecondary} /> : <Text style={styles.secondaryButtonText}>解除</Text>}
      </Pressable>
    </View>
  )
}

function Avatar({ uri, name, palette, styles }: { uri?: string; name: string; palette: Palette; styles: FriendsStyles }) {
  if (uri) return <Image accessibilityLabel={`${name}的头像`} source={{ uri }} style={styles.avatar} />
  return <View accessibilityLabel={`${name}的头像`} style={styles.avatarFallback}><Text style={styles.avatarText}>{name.trim().slice(0, 1) || '友'}</Text></View>
}

function TabButton({ tab, active, count, styles, onPress }: { tab: FriendTab; active: boolean; count: number; palette: Palette; styles: FriendsStyles; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="tab" accessibilityLabel={`${TAB_LABELS[tab]}${count > 0 ? `，${count}项` : ''}`} accessibilityState={{ selected: active }} onPress={onPress} style={({ pressed }) => [styles.tab, active && styles.tabActive, pressed && styles.pressed]}>
      <Text style={[styles.tabText, active && styles.tabTextActive]}>{TAB_LABELS[tab]}</Text>
      {count > 0 ? <View style={[styles.badge, active && styles.badgeActive]}><Text style={[styles.badgeText, active && styles.badgeTextActive]}>{count > 99 ? '99+' : count}</Text></View> : null}
    </Pressable>
  )
}

function RoundAction({ label, icon: Icon, danger, disabled, loading, palette, styles, onPress }: {
  label: string
  icon: typeof Check
  danger?: boolean
  disabled: boolean
  loading: boolean
  palette: Palette
  styles: FriendsStyles
  onPress: () => void
}) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.roundAction, danger && styles.roundActionDanger, pressed && styles.pressed, disabled && styles.disabled]}>
      {loading ? <ActivityIndicator size="small" color={danger ? palette.danger : palette.brandStrong} /> : <Icon size={20} color={danger ? palette.danger : palette.brandStrong} strokeWidth={2.2} />}
    </Pressable>
  )
}

function StatusPill({ status, palette, styles }: { status: string; palette: Palette; styles: FriendsStyles }) {
  const accepted = status === 'accepted'
  const rejected = status === 'rejected'
  const label = accepted ? '已同意' : rejected ? '已拒绝' : '等待中'
  return <View accessibilityLabel={`状态：${label}`} style={[styles.statusPill, accepted && styles.statusAccepted, rejected && styles.statusRejected]}><Text style={[styles.statusText, accepted && { color: palette.brandStrong }, rejected && { color: palette.danger }]}>{label}</Text></View>
}

function EmptyState({ tab, searching, palette, styles, onCommunity }: { tab: FriendTab; searching: boolean; palette: Palette; styles: FriendsStyles; onCommunity: () => void }) {
  const config = searching
    ? { icon: Search, title: '未找到好友', subtitle: '换个昵称关键词再试试' }
    : tab === 'friends'
      ? { icon: UsersRound, title: '还没有好友', subtitle: '去圈子里发现志同道合的食友，一起记录健康饮食' }
      : tab === 'received'
        ? { icon: Inbox, title: '暂无好友请求', subtitle: '有人向你发送好友申请时，会显示在这里' }
        : tab === 'sent'
          ? { icon: Send, title: '没有待处理的申请', subtitle: '你发起的好友申请会显示在这里，可随时撤销' }
          : { icon: ShieldOff, title: '黑名单为空', subtitle: '被你拉黑的用户会显示在这里，可随时解除' }
  const Icon = config.icon
  return (
    <View style={styles.empty}>
      <View style={styles.emptyIcon}><Icon size={32} color={palette.brandStrong} strokeWidth={1.7} /></View>
      <Text style={styles.emptyTitle}>{config.title}</Text>
      <Text style={styles.emptySubtitle}>{config.subtitle}</Text>
      {!searching && tab === 'friends' ? (
        <Pressable accessibilityRole="button" accessibilityLabel="去圈子添加好友" onPress={onCommunity} style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}>
          <UserPlus size={19} color="#ffffff" /><Text style={styles.primaryButtonText}>去添加好友</Text>
        </Pressable>
      ) : null}
    </View>
  )
}

function LoadError({ message, palette, styles, onRetry }: { message: string; palette: Palette; styles: FriendsStyles; onRetry: () => void }) {
  return (
    <View style={styles.centered}>
      <View style={[styles.emptyIcon, styles.errorIcon]}><CircleAlert size={30} color={palette.danger} /></View>
      <Text style={styles.emptyTitle}>好友数据暂时没有加载出来</Text>
      <Text style={styles.emptySubtitle}>{message}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="重新加载好友数据" onPress={onRetry} style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}>
        <RefreshCw size={19} color="#ffffff" /><Text style={styles.primaryButtonText}>重新加载</Text>
      </Pressable>
    </View>
  )
}

function InlineFeedback({ text, palette, styles, onClose }: { text: string; palette: Palette; styles: FriendsStyles; onClose: () => void }) {
  return (
    <View accessibilityLiveRegion="assertive" style={styles.feedback}>
      <CircleAlert size={18} color={palette.warning} />
      <Text style={styles.feedbackText}>{text}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="关闭提示" hitSlop={10} onPress={onClose} style={styles.feedbackClose}><X size={18} color={palette.textSecondary} /></Pressable>
    </View>
  )
}

function FriendMenu({ friend, reduceMotion, palette, styles, onClose, onBlock, onDelete }: {
  friend: FriendUserItem | null
  reduceMotion: boolean
  palette: Palette
  styles: FriendsStyles
  onClose: () => void
  onBlock: (friend: FriendUserItem) => void
  onDelete: (friend: FriendUserItem) => void
}) {
  return (
    <Modal visible={Boolean(friend)} transparent animationType={reduceMotion ? 'none' : 'fade'} statusBarTranslucent onRequestClose={onClose}>
      <View style={styles.modalRoot}>
        <Pressable accessibilityRole="button" accessibilityLabel="关闭好友操作" style={styles.backdrop} onPress={onClose} />
        {friend ? (
          <View style={styles.sheet}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetEyebrow}>管理好友</Text>
            <Text style={styles.sheetTitle}>{friendName(friend)}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel={`拉黑${friendName(friend)}`} onPress={() => onBlock(friend)} style={({ pressed }) => [styles.sheetAction, pressed && styles.pressed]}>
              <View style={styles.sheetDangerIcon}><Ban size={20} color={palette.danger} /></View><View style={styles.sheetActionCopy}><Text style={styles.sheetDangerText}>拉黑用户</Text><Text style={styles.sheetActionHint}>解除好友关系并停止互动</Text></View><ChevronRight size={18} color={palette.textMuted} />
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel={`删除好友${friendName(friend)}`} onPress={() => onDelete(friend)} style={({ pressed }) => [styles.sheetAction, pressed && styles.pressed]}>
              <View style={styles.sheetDangerIcon}><Trash2 size={20} color={palette.danger} /></View><View style={styles.sheetActionCopy}><Text style={styles.sheetDangerText}>删除好友</Text><Text style={styles.sheetActionHint}>之后仍可重新申请添加</Text></View><ChevronRight size={18} color={palette.textMuted} />
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="取消" onPress={onClose} style={({ pressed }) => [styles.sheetCancel, pressed && styles.pressed]}><Text style={styles.sheetCancelText}>取消</Text></Pressable>
          </View>
        ) : null}
      </View>
    </Modal>
  )
}

function ConfirmSheet({ state, busy, reduceMotion, palette, styles, onCancel, onConfirm }: {
  state: ConfirmState | null
  reduceMotion: boolean
  busy: boolean
  palette: Palette
  styles: FriendsStyles
  onCancel: () => void
  onConfirm: () => void
}) {
  const danger = state?.kind !== 'unblock'
  return (
    <Modal visible={Boolean(state)} transparent animationType={reduceMotion ? 'none' : 'fade'} statusBarTranslucent onRequestClose={onCancel}>
      <View style={styles.confirmRoot}>
        <Pressable accessibilityRole="button" accessibilityLabel="关闭确认对话框" style={styles.backdrop} onPress={onCancel} />
        {state ? (
          <View accessibilityViewIsModal style={styles.confirmCard}>
            <View style={[styles.confirmIcon, danger && styles.confirmIconDanger]}>{danger ? <CircleAlert size={25} color={palette.danger} /> : <ShieldOff size={25} color={palette.brandStrong} />}</View>
            <Text style={styles.confirmTitle}>{state.title}</Text>
            <Text style={styles.confirmMessage}>{state.message}</Text>
            <View style={styles.confirmActions}>
              <Pressable accessibilityRole="button" accessibilityLabel="取消" disabled={busy} onPress={onCancel} style={({ pressed }) => [styles.confirmCancel, pressed && styles.pressed, busy && styles.disabled]}><Text style={styles.confirmCancelText}>取消</Text></Pressable>
              <Pressable accessibilityRole="button" accessibilityLabel={state.confirmLabel} disabled={busy} onPress={onConfirm} style={({ pressed }) => [styles.confirmPrimary, danger && styles.confirmDanger, pressed && styles.pressed, busy && styles.disabled]}>{busy ? <ActivityIndicator color="#ffffff" /> : <Text style={styles.confirmPrimaryText}>{state.confirmLabel}</Text>}</Pressable>
            </View>
          </View>
        ) : null}
      </View>
    </Modal>
  )
}

function ListGap() { return <View style={{ height: 10 }} /> }

function rowKey(item: RowItem): string {
  if (item.kind === 'friend') return `friend:${friendId(item.value)}`
  if (item.kind === 'block') return `block:${blockUserId(item.value)}`
  return `${item.kind}:${item.value.id}`
}

function friendId(friend: FriendUserItem): string { return String(friend.id || '').trim() }
function friendName(friend: FriendUserItem): string { return String(friend.nickname || '用户').trim() || '用户' }
function blockUserId(block: FriendBlockItem): string { return String(block.blocked_user_id || block.id || '').trim() }
function blockName(block: FriendBlockItem): string { return String(block.nickname || '用户').trim() || '用户' }
function requestStatus(request: FriendRequestItem): string { return String(request.status || 'pending').trim().toLowerCase() }
function requestUserId(request: FriendRequestItem): string { return String(request.counterpart_user_id || request.from_user_id || request.to_user_id || '').trim() }
function requestName(request: FriendRequestItem): string { return String(request.counterpart_nickname || request.from_nickname || '用户').trim() || '用户' }
function requestAvatar(request: FriendRequestItem): string | undefined { return request.counterpart_avatar || request.from_avatar || undefined }

function formatRelativeTime(value?: string): string {
  const timestamp = value ? new Date(value).getTime() : Number.NaN
  if (!Number.isFinite(timestamp)) return '好友申请'
  const diff = Date.now() - timestamp
  if (diff < 60_000) return '刚刚'
  if (diff < 3_600_000) return `${Math.max(1, Math.floor(diff / 60_000))}分钟前`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}小时前`
  if (diff < 172_800_000) return '昨天'
  return formatShortDate(value)
}

function formatShortDate(value?: string): string {
  const date = value ? new Date(value) : null
  if (!date || Number.isNaN(date.getTime())) return '近期'
  const now = new Date()
  if (date.getFullYear() === now.getFullYear()) return `${date.getMonth() + 1}月${date.getDate()}日`
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`
}

function createStyles(palette: Palette) {
  return StyleSheet.create({
    page: { flex: 1, backgroundColor: palette.page },
    topWash: { position: 'absolute', top: 0, left: 0, right: 0, height: 230, backgroundColor: palette.topWash },
    centered: { flex: 1, minHeight: 320, paddingHorizontal: 28, alignItems: 'center', justifyContent: 'center' },
    toolbar: { minHeight: 82, paddingTop: 16, paddingBottom: 12, flexDirection: 'row', alignItems: 'center', gap: 12 },
    toolbarCopy: { flex: 1, minWidth: 0 },
    toolbarTitle: { color: palette.text, fontSize: 22, lineHeight: 29, fontWeight: '900' },
    toolbarSubtitle: { marginTop: 3, color: palette.textSecondary, fontSize: 13, lineHeight: 19 },
    refreshButton: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.brandSoft, borderWidth: 1, borderColor: palette.border },
    tabs: { gap: 8, paddingVertical: 6, paddingRight: 4 },
    tab: { minWidth: 104, minHeight: 48, paddingHorizontal: 14, borderRadius: 24, flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border },
    tabActive: { backgroundColor: palette.brand, borderColor: palette.brand },
    tabText: { color: palette.textSecondary, fontSize: 13, fontWeight: '800' },
    tabTextActive: { color: '#ffffff' },
    badge: { minWidth: 20, height: 20, paddingHorizontal: 5, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.brandSoft },
    badgeActive: { backgroundColor: '#ffffff' },
    badgeText: { color: palette.brandStrong, fontSize: 10, lineHeight: 13, fontWeight: '900', fontVariant: ['tabular-nums'] },
    badgeTextActive: { color: '#087f58' },
    searchBox: { minHeight: 52, marginTop: 12, paddingLeft: 16, paddingRight: 6, borderRadius: 26, flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border, shadowColor: palette.shadow, shadowOpacity: 0.05, shadowRadius: 9, shadowOffset: { width: 0, height: 3 }, elevation: 1 },
    searchInput: { flex: 1, minWidth: 0, minHeight: 48, paddingVertical: 0, color: palette.text, fontSize: 15 },
    clearButton: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.surfaceMuted },
    sectionHeading: { minHeight: 48, paddingTop: 16, paddingBottom: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    sectionTitle: { color: palette.text, fontSize: 16, lineHeight: 22, fontWeight: '900' },
    sectionCount: { color: palette.textMuted, fontSize: 12, lineHeight: 18, fontWeight: '700', fontVariant: ['tabular-nums'] },
    card: { minHeight: 78, padding: 12, borderRadius: 18, flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border, shadowColor: palette.shadow, shadowOpacity: 0.05, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 1 },
    cardWithFooter: { flexDirection: 'column', alignItems: 'stretch' },
    personArea: { flex: 1, minWidth: 0, minHeight: 54, borderRadius: 14, paddingHorizontal: 2, flexDirection: 'row', alignItems: 'center', gap: 11 },
    personPressed: { backgroundColor: palette.surfacePressed, opacity: 0.86 },
    personMeta: { flex: 1, minWidth: 0 },
    personName: { color: palette.text, fontSize: 16, lineHeight: 21, fontWeight: '800' },
    personSubtitle: { color: palette.textMuted, fontSize: 12, lineHeight: 17 },
    relationshipRow: { marginTop: 3, flexDirection: 'row', alignItems: 'center', gap: 5 },
    onlineDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: palette.brand },
    avatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: palette.surfaceMuted },
    avatarFallback: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.brandSoft, borderWidth: 1, borderColor: palette.border },
    avatarText: { color: palette.brandStrong, fontSize: 18, fontWeight: '900' },
    cardActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    messageButton: { minWidth: 74, minHeight: 48, paddingHorizontal: 13, borderRadius: 24, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: palette.brandSoft },
    messageButtonText: { color: palette.brandStrong, fontSize: 13, fontWeight: '900' },
    moreButton: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.surfaceMuted },
    requestRow: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 10 },
    requestPerson: { flex: 1, minWidth: 0, minHeight: 52, borderRadius: 14, flexDirection: 'row', alignItems: 'center', gap: 11 },
    inlineActions: { flexDirection: 'row', gap: 8 },
    roundAction: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.brandSoft, borderWidth: 1, borderColor: palette.brand },
    roundActionDanger: { backgroundColor: palette.dangerSoft, borderColor: palette.danger },
    statusPill: { minHeight: 32, paddingHorizontal: 11, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.warningSoft },
    statusAccepted: { backgroundColor: palette.brandSoft },
    statusRejected: { backgroundColor: palette.dangerSoft },
    statusText: { color: palette.warning, fontSize: 12, lineHeight: 16, fontWeight: '800' },
    cardFooter: { alignItems: 'flex-end', marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: palette.border },
    secondaryButton: { minWidth: 72, minHeight: 48, paddingHorizontal: 16, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.surfaceMuted, borderWidth: 1, borderColor: palette.border },
    secondaryButtonText: { color: palette.textSecondary, fontSize: 13, fontWeight: '800' },
    empty: { minHeight: 330, paddingHorizontal: 28, paddingVertical: 52, alignItems: 'center', justifyContent: 'center' },
    emptyIcon: { width: 72, height: 72, marginBottom: 16, borderRadius: 36, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.brandSoft },
    errorIcon: { backgroundColor: palette.dangerSoft },
    emptyTitle: { color: palette.text, fontSize: 17, lineHeight: 24, fontWeight: '900', textAlign: 'center' },
    emptySubtitle: { maxWidth: 320, marginTop: 7, color: palette.textSecondary, fontSize: 14, lineHeight: 21, textAlign: 'center' },
    primaryButton: { minHeight: 48, marginTop: 20, paddingHorizontal: 22, borderRadius: 24, flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: '#00a76f' },
    primaryButtonText: { color: '#ffffff', fontSize: 14, fontWeight: '900' },
    feedback: { zIndex: 10, marginHorizontal: 16, marginTop: 10, minHeight: 48, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 14, flexDirection: 'row', alignItems: 'center', gap: 9, backgroundColor: palette.warningSoft, borderWidth: 1, borderColor: palette.warning },
    feedbackText: { flex: 1, color: palette.text, fontSize: 13, lineHeight: 19 },
    feedbackClose: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
    modalRoot: { flex: 1, justifyContent: 'flex-end' },
    confirmRoot: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 },
    backdrop: { ...StyleSheet.absoluteFill, backgroundColor: palette.backdrop },
    sheet: { paddingTop: 10, paddingHorizontal: 16, paddingBottom: 26, borderTopLeftRadius: 26, borderTopRightRadius: 26, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border },
    sheetHandle: { alignSelf: 'center', width: 40, height: 4, marginBottom: 18, borderRadius: 2, backgroundColor: palette.border },
    sheetEyebrow: { color: palette.textMuted, fontSize: 12, lineHeight: 17, fontWeight: '800' },
    sheetTitle: { marginTop: 2, marginBottom: 14, color: palette.text, fontSize: 21, lineHeight: 28, fontWeight: '900' },
    sheetAction: { minHeight: 64, paddingHorizontal: 10, borderRadius: 16, flexDirection: 'row', alignItems: 'center', gap: 11 },
    sheetDangerIcon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.dangerSoft },
    sheetActionCopy: { flex: 1, minWidth: 0 },
    sheetDangerText: { color: palette.danger, fontSize: 15, lineHeight: 20, fontWeight: '800' },
    sheetActionHint: { marginTop: 2, color: palette.textMuted, fontSize: 12, lineHeight: 17 },
    sheetCancel: { minHeight: 50, marginTop: 10, borderRadius: 25, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.surfaceMuted },
    sheetCancelText: { color: palette.textSecondary, fontSize: 15, fontWeight: '800' },
    confirmCard: { width: '100%', maxWidth: 420, padding: 22, borderRadius: 24, alignItems: 'center', backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border, shadowColor: palette.shadow, shadowOpacity: 0.24, shadowRadius: 24, shadowOffset: { width: 0, height: 12 }, elevation: 12 },
    confirmIcon: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.brandSoft },
    confirmIconDanger: { backgroundColor: palette.dangerSoft },
    confirmTitle: { marginTop: 14, color: palette.text, fontSize: 19, lineHeight: 26, fontWeight: '900', textAlign: 'center' },
    confirmMessage: { marginTop: 7, color: palette.textSecondary, fontSize: 14, lineHeight: 21, textAlign: 'center' },
    confirmActions: { width: '100%', marginTop: 20, flexDirection: 'row', gap: 10 },
    confirmCancel: { flex: 1, minHeight: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.surfaceMuted },
    confirmCancelText: { color: palette.textSecondary, fontSize: 14, fontWeight: '800' },
    confirmPrimary: { flex: 1, minHeight: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.brand },
    confirmDanger: { backgroundColor: '#d94747' },
    confirmPrimaryText: { color: '#ffffff', fontSize: 14, fontWeight: '900' },
    pressed: { opacity: 0.72 },
    disabled: { opacity: 0.55 },
  })
}
