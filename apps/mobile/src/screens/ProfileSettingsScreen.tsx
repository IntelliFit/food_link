import { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, Image, KeyboardAvoidingView, Modal, Platform, Pressable, RefreshControl, ScrollView, Share, StyleSheet, Text, TextInput, View } from 'react-native'
import * as Clipboard from 'expo-clipboard'
import * as ImagePicker from 'expo-image-picker'
import { Beef, Droplets, Flame, Heart, Image as ImageIcon, MoreHorizontal, Moon, Pencil, RotateCcw, Share2, Sun, Wheat, X } from 'lucide-react-native'
import { useFocusEffect, useNavigation, useRoute, type RouteProp } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import type { CommunityFeedItem, CommunityFeedTargetType, FriendBlockStatus, PublicProfile, RecipeItem, UserInfo } from '@food-link/core'
import { apiClient, getStoredUserId } from '../api'
import { AppButton } from '../components/AppButton'
import type { RootStackParamList } from '../navigation/types'
import { colors } from '../theme'
import { formatDateTime } from '../utils/date'
import { readImageAsBase64DataUrl } from '../utils/image'
import { useAuth } from '../providers/AuthProvider'
import { useColorScheme } from '../providers/ColorSchemeProvider'
import { useAppDialog } from '../providers/DialogProvider'
import { userFacingErrorMessage } from '../utils/errors'

type ProfileTab = 'feed' | 'collections'
type ReportReason = 'spam' | 'inappropriate' | 'false_information' | 'harassment' | 'other'
type ReportTarget = { targetId: string; targetType: CommunityFeedTargetType; title: string }
type NutritionEntry = { kind: 'calories' | 'protein' | 'carbs' | 'fat'; text: string; color: string }

const PROFILE_FEED_PAGE_SIZE = 15
const REPORT_REASON_OPTIONS: Array<{ value: ReportReason; label: string }> = [
  { value: 'spam', label: '广告或垃圾信息' },
  { value: 'inappropriate', label: '不友善或不当内容' },
  { value: 'false_information', label: '虚假信息' },
  { value: 'harassment', label: '骚扰或人身攻击' },
  { value: 'other', label: '其他' },
]

type ProfileVisualTheme = {
  page: string
  drawer: string
  card: string
  primaryText: string
  secondaryText: string
  mutedText: string
  border: string
  input: string
  surfaceMuted: string
  accent: string
  accentSurface: string
  accentBorder: string
  topEditSurface: string
  topIconSurface: string
  topActionBorder: string
  topEditText: string
  topIconText: string
  scrim: string
  shadowOpacity: number
  danger: string
  cancelSurface: string
}

const PROFILE_LIGHT_THEME: ProfileVisualTheme = {
  page: colors.background,
  drawer: colors.surface,
  card: '#f9fafb',
  primaryText: colors.text,
  secondaryText: colors.textSecondary,
  mutedText: colors.textMuted,
  border: colors.border,
  input: '#fff',
  surfaceMuted: colors.surfaceMuted,
  accent: colors.brandDark,
  accentSurface: colors.brandSoft,
  accentBorder: '#bbf7d0',
  topEditSurface: 'rgba(255, 255, 255, 0.92)',
  topIconSurface: 'rgba(255, 255, 255, 0.16)',
  topActionBorder: 'rgba(255, 255, 255, 0.22)',
  topEditText: '#374151',
  topIconText: '#fff',
  scrim: 'rgba(15, 23, 42, 0.48)',
  shadowOpacity: 0.06,
  danger: colors.danger,
  cancelSurface: colors.surfaceMuted,
}

const PROFILE_DARK_THEME: ProfileVisualTheme = {
  page: '#0d1312',
  drawer: '#181f1d',
  card: '#1e2624',
  primaryText: '#f2f7f4',
  secondaryText: 'rgba(214, 226, 220, 0.76)',
  mutedText: '#64748b',
  border: 'rgba(255, 255, 255, 0.08)',
  input: '#1e2624',
  surfaceMuted: '#2a3330',
  accent: '#6ee7b7',
  accentSurface: 'rgba(0, 188, 125, 0.14)',
  accentBorder: 'rgba(0, 188, 125, 0.24)',
  topEditSurface: 'rgba(24, 31, 29, 0.9)',
  topIconSurface: 'rgba(24, 31, 29, 0.9)',
  topActionBorder: 'rgba(255, 255, 255, 0.08)',
  topEditText: '#f2f7f4',
  topIconText: '#f2f7f4',
  scrim: 'rgba(0, 0, 0, 0.6)',
  shadowOpacity: 0.2,
  danger: '#f87171',
  cancelSurface: '#2a3330',
}

export function ProfileSettingsScreen() {
  const route = useRoute<RouteProp<RootStackParamList, 'ProfileSettings'>>()
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  const { logout } = useAuth()
  const { isDark, toggleScheme } = useColorScheme()
  const profileTheme = isDark ? PROFILE_DARK_THEME : PROFILE_LIGHT_THEME
  const dialog = useAppDialog()
  const insets = useSafeAreaInsets()
  const targetUserId = route.params?.userId
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)
  const isOwner = !targetUserId || (!!currentUserId && targetUserId === currentUserId)
  const [profile, setProfile] = useState<(UserInfo & PublicProfile) | null>(null)
  const [feed, setFeed] = useState<CommunityFeedItem[]>([])
  const [recipes, setRecipes] = useState<RecipeItem[]>([])
  const [publicFavoriteRecipes, setPublicFavoriteRecipes] = useState(true)
  const [activeTab, setActiveTab] = useState<ProfileTab>('feed')
  const [editing, setEditing] = useState(false)
  const [nickname, setNickname] = useState('')
  const [motto, setMotto] = useState('')
  const [avatar, setAvatar] = useState('')
  const [coverImage, setCoverImage] = useState('')
  const [blockStatus, setBlockStatus] = useState<FriendBlockStatus | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMoreFeed, setHasMoreFeed] = useState(false)
  const [profileLoadError, setProfileLoadError] = useState('')
  const [isDeletedUser, setIsDeletedUser] = useState(false)
  const [followBusy, setFollowBusy] = useState(false)
  const [reportTarget, setReportTarget] = useState<ReportTarget | null>(null)
  const [reportReason, setReportReason] = useState<ReportReason | null>(null)
  const [reportExtra, setReportExtra] = useState('')
  const [reporting, setReporting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [deleteConfirmVisible, setDeleteConfirmVisible] = useState(false)
  const [deleteConfirmation, setDeleteConfirmation] = useState('')
  const showError = useCallback((title: string, error: unknown) => {
    return dialog.alert(title, userFacingErrorMessage(error), 'danger')
  }, [dialog])

  useEffect(() => {
    getStoredUserId().then(setCurrentUserId).catch(() => setCurrentUserId(null))
  }, [])

  useEffect(() => {
    if (route.params?.action !== 'delete-account' || !isOwner) return
    setDeleteConfirmation('')
    setDeleteConfirmVisible(true)
    navigation.setParams({ action: undefined })
  }, [isOwner, navigation, route.params?.action])

  const load = useCallback(async () => {
    setLoading(true)
    setProfileLoadError('')
    setIsDeletedUser(false)
    try {
      if (isOwner) {
        setBlockStatus(null)
        const profileData = await apiClient.getUserProfile()
        const ownerUserId = String(profileData.id || currentUserId || '').trim()
        const [feedData, recipeData, followStats] = await Promise.all([
          apiClient.communityGetFeed({
            offset: 0,
            limit: PROFILE_FEED_PAGE_SIZE,
            includeComments: false,
            params: ownerUserId ? { author_id: ownerUserId, sort_by: 'latest' } : undefined,
          }).catch(() => ({ list: [], has_more: false })),
          apiClient.listRecipes({ isFavorite: true }).catch(() => ({ recipes: [] })),
          ownerUserId ? apiClient.getFollowStats(ownerUserId).catch(() => null) : Promise.resolve(null),
        ])
        applyProfile({ ...profileData, ...(followStats || {}) } as UserInfo & PublicProfile)
        setPublicFavoriteRecipes(true)
        setFeed(feedData.list || [])
        setHasMoreFeed(feedData.has_more ?? (feedData.list || []).length >= PROFILE_FEED_PAGE_SIZE)
        setRecipes(recipeData.recipes || [])
      } else {
        const userId = targetUserId || ''
        const status = await apiClient.getFriendBlockStatus(userId).catch(() => null)
        setBlockStatus(status)
        if (status?.blocked_either) {
          applyProfile({
            id: userId,
            nickname: status.is_blocked_by_me ? '已拉黑用户' : '用户',
            avatar: '',
            cover_image: '',
            record_days: 0,
            followers_count: 0,
            following_count: 0,
            is_following: false,
          } as UserInfo & PublicProfile)
          setFeed([])
          setRecipes([])
          setHasMoreFeed(false)
          return
        }

        const profileData = await apiClient.getPublicProfile(userId)
        const canSeeFavorites = (profileData as PublicProfile & { public_favorite_recipes?: boolean }).public_favorite_recipes === true
        const [feedData, recipeData, followStats] = await Promise.all([
          apiClient.communityGetPublicFeed({
            offset: 0,
            limit: PROFILE_FEED_PAGE_SIZE,
            includeComments: false,
            params: { author_id: userId, sort_by: 'latest' },
          }).catch(() => ({ list: [], has_more: false })),
          canSeeFavorites
            ? apiClient.getUserFavoriteRecipes(userId).catch(() => ({ recipes: [] }))
            : Promise.resolve({ recipes: [] }),
          apiClient.getFollowStats(userId).catch(() => null),
        ])
        applyProfile({ ...profileData, ...(followStats || {}) } as UserInfo & PublicProfile)
        setPublicFavoriteRecipes(canSeeFavorites)
        setActiveTab((previous) => canSeeFavorites || previous === 'feed' ? previous : 'feed')
        setFeed(feedData.list || [])
        setHasMoreFeed(feedData.has_more ?? (feedData.list || []).length >= PROFILE_FEED_PAGE_SIZE)
        setRecipes(recipeData.recipes || [])
      }
    } catch (error) {
      const missingUser = !isOwner && [404, 410].includes(apiErrorStatus(error))
      if (missingUser) {
        const userId = targetUserId || ''
        setIsDeletedUser(true)
        applyProfile({
          id: userId,
          nickname: '用户已注销',
          avatar: '',
          cover_image: '',
          record_days: 0,
          followers_count: 0,
          following_count: 0,
          is_following: false,
        } as UserInfo & PublicProfile)
        setFeed([])
        setRecipes([])
        setHasMoreFeed(false)
      } else {
        setProfileLoadError(userFacingErrorMessage(error))
      }
    } finally {
      setLoading(false)
    }
  }, [currentUserId, isOwner, targetUserId])

  useFocusEffect(
    useCallback(() => {
      void load()
    }, [load]),
  )

  const applyProfile = (next: UserInfo & PublicProfile) => {
    setProfile(next)
    setNickname(next.nickname || '')
    setMotto(next.motto || '')
    setAvatar(next.avatar || '')
    setCoverImage(next.cover_image || '')
  }

  const pickProfileImage = async (kind: 'avatar' | 'cover') => {
    const picked = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: kind === 'avatar',
      aspect: kind === 'avatar' ? [1, 1] : [16, 9],
      quality: 0.84,
    })
    if (picked.canceled || !picked.assets[0]) return

    setSaving(true)
    try {
      const asset = picked.assets[0]
      const base64Image = await readImageAsBase64DataUrl(asset.uri, asset.mimeType || 'image/jpeg')
      if (kind === 'avatar') {
        const data = await apiClient.uploadUserAvatar({ base64Image })
        setAvatar(data.imageUrl)
      } else {
        const data = await apiClient.uploadUserCoverImage({ base64Image })
        setCoverImage(data.imageUrl)
      }
    } catch (error) {
      await showError(kind === 'avatar' ? '上传头像失败' : '上传背景失败', error)
    } finally {
      setSaving(false)
    }
  }

  const saveProfile = async () => {
    if (!nickname.trim()) {
      await dialog.alert('请输入昵称', undefined, 'warning')
      return
    }
    setSaving(true)
    try {
      const data = await apiClient.updateUserProfile({
        nickname: nickname.trim(),
        avatar,
        cover_image: coverImage,
        motto: motto.trim(),
      })
      applyProfile(data as UserInfo & PublicProfile)
      setEditing(false)
      await dialog.alert('已保存', '个人资料已更新', 'success')
    } catch (error) {
      await showError('保存资料失败', error)
    } finally {
      setSaving(false)
    }
  }

  const toggleFollow = async () => {
    if (!targetUserId || !profile || followBusy) return
    const previous = profile
    const nextFollowing = !profile.is_following
    setFollowBusy(true)
    setProfile({
      ...profile,
      is_following: nextFollowing,
      followers_count: Math.max(0, (profile.followers_count || 0) + (nextFollowing ? 1 : -1)),
    })
    try {
      await apiClient.followUser(targetUserId, Boolean(profile.is_following))
    } catch (error) {
      setProfile(previous)
      await showError('关注失败', error)
    } finally {
      setFollowBusy(false)
    }
  }

  const blockUser = async () => {
    if (!targetUserId || !profile) return
    const confirmed = await dialog.confirm({
      title: '拉黑用户',
      message: `拉黑后，你和「${profile.nickname || '用户'}」将无法互发私信，也不能重新添加好友。`,
      kind: 'danger',
      confirmText: '拉黑',
      cancelText: '取消',
    })
    if (!confirmed) return
    setSaving(true)
    try {
      await apiClient.blockUser(targetUserId)
      setBlockStatus({ is_blocked_by_me: true, has_blocked_me: false, blocked_either: true })
      setFeed([])
      setRecipes([])
      await dialog.alert('已加入黑名单', undefined, 'success')
    } catch (error) {
      await showError('无法操作', error)
    } finally {
      setSaving(false)
    }
  }

  const unblockUser = async () => {
    if (!targetUserId) return
    const confirmed = await dialog.confirm({
      title: '解除拉黑',
      message: '解除后，你们可以重新搜索、申请好友或发送私信。',
      kind: 'warning',
      confirmText: '解除',
      cancelText: '取消',
    })
    if (!confirmed) return
    setSaving(true)
    try {
      await apiClient.unblockUser(targetUserId)
      setBlockStatus({ is_blocked_by_me: false, has_blocked_me: false, blocked_either: false })
      await load()
      await dialog.alert('已解除拉黑', undefined, 'success')
    } catch (error) {
      await showError('无法操作', error)
    } finally {
      setSaving(false)
    }
  }

  const confirmDeleteAccount = async () => {
    setDeleteConfirmation('')
    setDeleteConfirmVisible(true)
  }

  const deleteAccount = async () => {
    setSaving(true)
    try {
      await apiClient.deleteAccount()
      setDeleteConfirmVisible(false)
      await logout()
      await dialog.alert('已注销', '账号已注销，请重新登录。', 'success')
    } catch (error) {
      await showError('注销失败', error)
    } finally {
      setSaving(false)
    }
  }

  const copyUserId = async () => {
    const value = String(profile?.id || targetUserId || '').trim()
    if (!value) {
      await dialog.alert('暂无用户 ID', undefined, 'warning')
      return
    }
    await Clipboard.setStringAsync(value)
    await dialog.alert('已复制', '用户 ID 已复制到剪贴板', 'success')
  }

  const shareProfile = async () => {
    const userId = String(profile?.id || targetUserId || '').trim()
    if (!userId) {
      await dialog.alert('暂无主页信息', '请稍后重试。', 'warning')
      return
    }
    const nicknameText = profile?.nickname || 'Food Link 用户'
    const mottoText = profile?.motto ? `\n${profile.motto}` : ''
    const link = buildProfileShareLink(userId)
    try {
      await Share.share({
        title: `${nicknameText} 的 Food Link 主页`,
        message: `${nicknameText} 的 Food Link 主页${mottoText}\n${link}`,
      })
    } catch (error) {
      await showError('分享失败', error)
    }
  }

  const openFeed = (item: CommunityFeedItem) => {
    const targetId = item.target_id || item.record?.id
    const targetType = normalizeTargetType(item.target_type || item.record?.feed_type)
    if (!targetId) return
    navigation.navigate('CommunityFeedDetail', { targetId, targetType })
  }

  const loadMoreFeed = async () => {
    const userId = String(profile?.id || targetUserId || currentUserId || '').trim()
    if (!userId || loading || loadingMore || !hasMoreFeed || isDeletedUser || blockStatus?.blocked_either) return
    setLoadingMore(true)
    try {
      const options = {
        offset: feed.length,
        limit: PROFILE_FEED_PAGE_SIZE,
        includeComments: false,
        params: { author_id: userId, sort_by: 'latest' as const },
      }
      const data = isOwner
        ? await apiClient.communityGetFeed(options)
        : await apiClient.communityGetPublicFeed(options)
      const nextItems = data.list || []
      setFeed((previous) => mergeFeedItems(previous, nextItems))
      setHasMoreFeed(data.has_more ?? nextItems.length >= PROFILE_FEED_PAGE_SIZE)
    } catch (error) {
      await showError('加载动态失败', error)
    } finally {
      setLoadingMore(false)
    }
  }

  const openReport = (item: CommunityFeedItem) => {
    const targetId = String(item.target_id || item.record?.id || '').trim()
    if (!targetId) return
    setReportReason(null)
    setReportExtra('')
    setReportTarget({
      targetId,
      targetType: normalizeTargetType(item.target_type || item.record?.feed_type),
      title: feedTitle(item),
    })
  }

  const closeReport = () => {
    if (reporting) return
    setReportTarget(null)
    setReportReason(null)
    setReportExtra('')
  }

  const submitReport = async () => {
    if (!reportTarget || !reportReason || reporting) return
    setReporting(true)
    try {
      await apiClient.communityReport({
        targetId: reportTarget.targetId,
        targetType: reportTarget.targetType,
        reason: reportReason,
        extraContent: reportExtra,
      })
      setReportTarget(null)
      setReportReason(null)
      setReportExtra('')
      await dialog.alert('举报已提交', '感谢你的反馈，我们会尽快处理。', 'success')
    } catch (error) {
      await showError('举报失败', error)
    } finally {
      setReporting(false)
    }
  }

  const resolvedProfileId = String(profile?.id || targetUserId || '').trim()
  const shortProfileId = formatShortUserId(resolvedProfileId)
  const canOpenFollowList = Boolean(profile?.id)

  if (loading && !profile) {
    return (
      <View style={[styles.fullState, { backgroundColor: profileTheme.page }]} accessibilityLabel="正在加载个人主页">
        <ActivityIndicator color={profileTheme.accent} size="small" />
      </View>
    )
  }

  if (profileLoadError && !profile) {
    return (
      <View style={[styles.fullState, { backgroundColor: profileTheme.page }]}>
        <View style={[styles.errorIcon, { backgroundColor: profileTheme.accentSurface }]}>
          <RotateCcw size={22} color={profileTheme.accent} />
        </View>
        <Text style={[styles.fullStateTitle, { color: profileTheme.primaryText }]}>个人主页加载失败</Text>
        <Text style={[styles.fullStateDescription, { color: profileTheme.secondaryText }]}>{profileLoadError}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="重试加载个人主页" onPress={() => void load()} style={({ pressed }) => [styles.retryButton, { backgroundColor: profileTheme.accent }, pressed && styles.topActionPressed]}>
          <RotateCcw size={16} color={isDark ? '#0d1312' : '#fff'} />
          <Text style={[styles.retryButtonText, { color: isDark ? '#0d1312' : '#fff' }]}>重新加载</Text>
        </Pressable>
      </View>
    )
  }
  return (
    <ScrollView
      style={[styles.profileScroll, { backgroundColor: profileTheme.page }]}
      contentContainerStyle={[
        styles.profileContent,
        { backgroundColor: profileTheme.page },
        { paddingTop: 0, paddingBottom: insets.bottom + 104 },
      ]}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={profileTheme.accent} />}
    >
      <View style={styles.profileTopSection}>
        <View style={styles.coverBackground}>
          {coverImage ? (
            <>
              <Image source={{ uri: coverImage }} style={styles.coverBackgroundImage} />
              <View style={styles.coverBackgroundMask} />
            </>
          ) : null}
        </View>

        <View style={styles.topActions}>
          {isOwner ? (
            <Pressable accessibilityRole="button" accessibilityLabel="编辑个人资料" onPress={() => setEditing(true)} style={({ pressed }) => [styles.topEditButton, { backgroundColor: profileTheme.topEditSurface, borderColor: profileTheme.topActionBorder }, pressed && styles.topActionPressed]}>
              <Pencil size={13} strokeWidth={2.4} color={profileTheme.topEditText} />
              <Text style={[styles.topEditButtonText, { color: profileTheme.topEditText }]}>编辑资料</Text>
            </Pressable>
          ) : null}
          {isOwner ? (
            <Pressable accessibilityRole="button" accessibilityLabel={isDark ? '切换到浅色模式' : '切换到深色模式'} onPress={toggleScheme} style={({ pressed }) => [styles.topIconButton, { backgroundColor: profileTheme.topIconSurface, borderColor: profileTheme.topActionBorder }, pressed && styles.topActionPressed]}>
              {isDark ? <Sun size={16} color={profileTheme.topIconText} /> : <Moon size={16} color={profileTheme.topIconText} />}
            </Pressable>
          ) : null}
          <Pressable accessibilityRole="button" accessibilityLabel="分享个人主页" onPress={() => void shareProfile()} style={({ pressed }) => [styles.topIconButton, { backgroundColor: profileTheme.topIconSurface, borderColor: profileTheme.topActionBorder }, pressed && styles.topActionPressed]}>
            <Share2 size={16} color={profileTheme.topIconText} />
          </Pressable>
        </View>

        <View style={styles.profileRow}>
          {avatar ? <Image source={{ uri: avatar }} style={[styles.avatar, { backgroundColor: profileTheme.surfaceMuted }]} /> : <View style={[styles.avatarFallback, { backgroundColor: profileTheme.surfaceMuted }]} />}
          <View style={styles.flex}>
            <Text style={styles.topName} numberOfLines={1}>{profile?.nickname || 'Food Link 用户'}</Text>
            <View style={styles.profileIdRow}>
              <Text style={styles.topIdText} selectable>ID: {shortProfileId || '-'}</Text>
              <Pressable accessibilityRole="button" accessibilityLabel="复制用户 ID" hitSlop={12} onPress={() => void copyUserId()} style={styles.inlineCopyButton}>
                <Text style={styles.inlineCopyButtonText}>复制ID</Text>
              </Pressable>
            </View>
          </View>
        </View>

        <View style={styles.profileStatsRow}>
          <View style={styles.profileStatItem}>
            <Text style={styles.profileStatNumber}>{profile?.record_days || 0}</Text>
            <Text style={styles.profileStatLabel}>记录天数</Text>
          </View>
          <Text style={styles.profileStatDivider}>|</Text>
          <Pressable
            accessibilityRole="button"
            hitSlop={12}
            style={styles.profileStatItem}
            onPress={() => canOpenFollowList && profile?.id ? navigation.navigate('FollowList', { userId: profile.id, type: 'followers' }) : undefined}
          >
            <Text style={styles.profileStatNumber}>{profile?.followers_count || 0}</Text>
            <Text style={styles.profileStatLabel}>被关注</Text>
          </Pressable>
          <Text style={styles.profileStatDivider}>|</Text>
          <Pressable
            accessibilityRole="button"
            hitSlop={12}
            style={styles.profileStatItem}
            onPress={() => canOpenFollowList && profile?.id ? navigation.navigate('FollowList', { userId: profile.id, type: 'following' }) : undefined}
          >
            <Text style={styles.profileStatNumber}>{profile?.following_count || 0}</Text>
            <Text style={styles.profileStatLabel}>关注</Text>
          </Pressable>
        </View>

        {profile?.motto || isOwner ? (
          <Pressable accessibilityRole={isOwner ? "button" : undefined} accessibilityLabel={isOwner ? "编辑座右铭" : undefined} style={({ pressed }) => [styles.mottoRow, pressed && isOwner && styles.topActionPressed]} onPress={isOwner ? () => setEditing(true) : undefined}>
            <Text style={[styles.mottoText, !profile?.motto && styles.mottoTextEmpty]} numberOfLines={2}>
              {profile?.motto || '点击编辑资料添加座右铭'}
            </Text>
          </Pressable>
        ) : null}

        {!isOwner && !isDeletedUser ? (
          <View style={styles.profileActionRow}>
            {blockStatus?.is_blocked_by_me ? (
              <Pressable accessibilityRole="button" accessibilityLabel="解除拉黑" style={({ pressed }) => [styles.profileActionButtonLight, pressed && styles.topActionPressed]} onPress={() => void unblockUser()}>
                <Text style={styles.profileActionButtonLightText}>解除拉黑</Text>
              </Pressable>
            ) : blockStatus?.blocked_either ? (
              <View style={styles.profileBlockedPill}>
                <Text style={styles.profileBlockedPillText}>内容不可见</Text>
              </View>
            ) : (
              <>
                <Pressable accessibilityRole="button" accessibilityLabel={profile?.is_following ? "取消关注" : "关注用户"} accessibilityState={{ busy: followBusy, disabled: followBusy }} disabled={followBusy} style={({ pressed }) => [styles.profileActionButton, profile?.is_following && styles.profileActionButtonGhost, followBusy && styles.actionDisabled, pressed && styles.topActionPressed]} onPress={() => void toggleFollow()}>
                  {followBusy ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.profileActionButtonText}>{profile?.is_following ? '已关注' : '+ 关注'}</Text>}
                </Pressable>
                {targetUserId ? (
                  <Pressable accessibilityRole="button" accessibilityLabel="发送私信" style={({ pressed }) => [styles.profileActionButtonLight, pressed && styles.topActionPressed]} onPress={() => navigation.navigate('PrivateChat', { userId: targetUserId, nickname: profile?.nickname })}>
                    <Text style={styles.profileActionButtonLightText}>私信</Text>
                  </Pressable>
                ) : null}
                <Pressable accessibilityRole="button" accessibilityLabel="拉黑用户" style={({ pressed }) => [styles.profileBlockButton, pressed && styles.topActionPressed]} onPress={() => void blockUser()}>
                  <Text style={styles.profileBlockButtonText}>拉黑</Text>
                </Pressable>
              </>
            )}
          </View>
        ) : null}
      </View>

      <View style={[styles.bottomDrawer, { backgroundColor: profileTheme.drawer, shadowOpacity: profileTheme.shadowOpacity }]}>
        <View style={[styles.drawerHandle, { backgroundColor: profileTheme.border }]} />

        <View style={[styles.segment, { borderBottomColor: profileTheme.border }]}>
          <SegmentButton theme={profileTheme} label="最新动态" active={activeTab === 'feed'} onPress={() => setActiveTab('feed')} />
          {(isOwner || publicFavoriteRecipes) ? (
            <SegmentButton theme={profileTheme} label="食物收藏" active={activeTab === 'collections'} onPress={() => setActiveTab('collections')} />
          ) : null}
        </View>

        <View style={styles.contentBody}>
          {profileLoadError ? (
            <View style={[styles.inlineError, { backgroundColor: profileTheme.accentSurface, borderColor: profileTheme.accentBorder }]}>
              <Text style={[styles.inlineErrorText, { color: profileTheme.secondaryText }]} numberOfLines={2}>{profileLoadError}</Text>
              <Pressable accessibilityRole="button" accessibilityLabel="重试加载个人主页" onPress={() => void load()} style={({ pressed }) => [styles.inlineRetry, pressed && styles.topActionPressed]}>
                <RotateCcw size={15} color={profileTheme.accent} />
                <Text style={[styles.inlineRetryText, { color: profileTheme.accent }]}>重试</Text>
              </Pressable>
            </View>
          ) : null}
          {isDeletedUser ? (
            <EmptyState theme={profileTheme} text={activeTab === 'feed' ? '该用户已注销，动态不可见' : '该用户已注销，食物收藏不可见'} />
          ) : loading && !profile ? (
            <View style={styles.contentEmpty} accessibilityLabel="正在加载个人主页">
              <ActivityIndicator color={profileTheme.accent} size="small" />
            </View>
          ) : blockStatus?.blocked_either ? (
            <EmptyState theme={profileTheme} text="内容不可见" />
          ) : activeTab === 'feed' ? (
            <>
              {feed.length === 0 ? <EmptyState theme={profileTheme} text="暂无动态" /> : null}
              {feed.map((item, index) => (
                <View key={`${item.target_type || item.record?.feed_type}-${item.target_id || item.record?.id || index}`}>
                  <View style={[styles.feedCard, { backgroundColor: profileTheme.card }]}>
                    <View style={styles.feedCardHeader}>
                      <Text style={[styles.profileFeedTime, styles.flex, { color: profileTheme.secondaryText }]}>{feedSubtitle(item)}</Text>
                      {!isOwner ? (
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel="更多动态操作"
                          hitSlop={8}
                          onPress={(event) => {
                            event.stopPropagation()
                            openReport(item)
                          }}
                          style={({ pressed }) => [styles.feedMoreButton, pressed && styles.topActionPressed]}
                        >
                          <MoreHorizontal size={18} color={profileTheme.mutedText} />
                        </Pressable>
                      ) : null}
                    </View>
                    <Pressable accessibilityRole="button" accessibilityLabel={'查看动态：' + feedTitle(item)} onPress={() => openFeed(item)} style={({ pressed }) => [styles.feedCardBody, pressed && styles.cardPressed]}>
                      <Text style={[styles.profileFeedTitle, { color: profileTheme.primaryText }]} numberOfLines={2}>{feedTitle(item)}</Text>
                    {shouldShowCompactFoodCard(item) ? (
                      <CompactFoodCard theme={profileTheme} item={item} />
                    ) : feedImages(item).length ? (
                      <View style={styles.feedImageGrid}>
                        {feedImages(item).slice(0, 3).map((url, imageIndex) => (
                          <Image key={`${url}-${imageIndex}`} source={{ uri: url }} style={[styles.feedImage, { backgroundColor: profileTheme.surfaceMuted }]} />
                        ))}
                      </View>
                    ) : null}
                    <View style={styles.feedFooter}>
                      <View style={styles.nutritionRow}>
                        {feedNutrition(item).map((entry) => (
                          <NutritionMetric key={entry.kind} entry={entry} />
                        ))}
                      </View>
                      <View style={styles.likeMetric}>
                        <Heart size={14} color={profileTheme.mutedText} />
                        <Text style={[styles.likeText, { color: profileTheme.mutedText }]}>{item.like_count || 0}</Text>
                      </View>
                    </View>
                    </Pressable>
                  </View>
                </View>
              ))}
              {feed.length > 0 ? (
                <View style={styles.feedPagination}>
                  {hasMoreFeed ? (
                    <Pressable accessibilityRole="button" accessibilityLabel="加载更多动态" accessibilityState={{ busy: loadingMore }} disabled={loadingMore} onPress={() => void loadMoreFeed()} style={({ pressed }) => [styles.loadMoreButton, { borderColor: profileTheme.border, backgroundColor: profileTheme.input }, pressed && styles.topActionPressed]}>
                      {loadingMore ? <ActivityIndicator size="small" color={profileTheme.accent} /> : <Text style={[styles.loadMoreText, { color: profileTheme.secondaryText }]}>加载更多</Text>}
                    </Pressable>
                  ) : (
                    <Text style={[styles.feedEndText, { color: profileTheme.mutedText }]}>没有更多了</Text>
                  )}
                </View>
              ) : null}
            </>
          ) : (
            <>
              {recipes.length === 0 ? <EmptyState theme={profileTheme} text="暂无食物收藏" /> : null}
              {recipes.map((recipe) => (
                <Pressable accessibilityRole="button" accessibilityLabel={`查看收藏食谱：${recipe.recipe_name || '未命名食谱'}`} key={recipe.id} onPress={() => navigation.navigate('RecipeDetail', { recipeId: recipe.id })} style={({ pressed }) => pressed && styles.cardPressed}>
                  <View style={[styles.collectionCard, { backgroundColor: profileTheme.card }]}>
                    <View style={styles.collectionMain}>
                      <Text style={[styles.itemName, { color: profileTheme.primaryText }]}>{recipe.recipe_name || '未命名食谱'}</Text>
                      <View style={styles.collectionNutrition}>
                        {recipe.total_calories > 0 ? <NutritionMetric entry={{ kind: 'calories', text: String(Math.round(recipe.total_calories)), color: '#00a873' }} /> : null}
                        {recipe.total_protein > 0 ? <NutritionMetric entry={{ kind: 'protein', text: String(Math.round(recipe.total_protein)) + 'g', color: '#5c9ed4' }} /> : null}
                        {(recipe.total_carbs || 0) > 0 ? <NutritionMetric entry={{ kind: 'carbs', text: String(Math.round(recipe.total_carbs || 0)) + 'g', color: '#b88930' }} /> : null}
                        {(recipe.total_fat || 0) > 0 ? <NutritionMetric entry={{ kind: 'fat', text: String(Math.round(recipe.total_fat || 0)) + 'g', color: '#e17e41' }} /> : null}
                      </View>
                    </View>
                    {recipe.image_path ? <Image source={{ uri: recipe.image_path }} style={[styles.collectionImage, { backgroundColor: profileTheme.surfaceMuted }]} /> : null}
                  </View>
                </Pressable>
              ))}
            </>
          )}
        </View>
      </View>

      <Modal visible={editing && isOwner} transparent animationType="slide" onRequestClose={() => setEditing(false)}>
        <Pressable style={[styles.editSheetMask, { backgroundColor: profileTheme.scrim }]} onPress={() => setEditing(false)}>
          <Pressable style={[styles.editSheet, { paddingBottom: insets.bottom + 20, backgroundColor: profileTheme.drawer }]} onPress={(event) => event.stopPropagation()}>
            <ScrollView showsVerticalScrollIndicator={false}>
              <View style={[styles.drawerHandle, { backgroundColor: profileTheme.border }]} />
              <View style={styles.editSheetHeader}>
                <Text style={[styles.sectionTitle, { color: profileTheme.primaryText }]}>编辑资料</Text>
                <Pressable accessibilityRole="button" accessibilityLabel="关闭编辑资料" onPress={() => setEditing(false)} style={({ pressed }) => [styles.editSheetClose, { backgroundColor: profileTheme.border }, pressed && styles.topActionPressed]}>
                  <X size={20} color={profileTheme.primaryText} />
                </Pressable>
              </View>
              <Pressable accessibilityRole="button" accessibilityLabel="更换头像" style={({ pressed }) => [styles.editAvatarWrap, pressed && styles.topActionPressed]} onPress={() => void pickProfileImage('avatar')}>
                {avatar ? <Image source={{ uri: avatar }} style={[styles.editAvatar, { backgroundColor: profileTheme.surfaceMuted }]} /> : <View style={[styles.editAvatar, { backgroundColor: profileTheme.surfaceMuted }]} />}
              </Pressable>
              <Text style={[styles.fieldLabel, { color: profileTheme.secondaryText }]}>主页背景图</Text>
              <Pressable accessibilityRole="button" accessibilityLabel="更换主页背景图" style={({ pressed }) => [styles.editCover, { backgroundColor: profileTheme.card, borderColor: profileTheme.border }, pressed && styles.topActionPressed]} onPress={() => void pickProfileImage('cover')}>
                {coverImage ? <Image source={{ uri: coverImage }} style={styles.editCoverImage} /> : (
                  <View style={styles.editCoverPlaceholder}>
                    <ImageIcon size={24} color={profileTheme.mutedText} />
                    <Text style={[styles.editCoverPlaceholderText, { color: profileTheme.mutedText }]}>点击选择背景图</Text>
                  </View>
                )}
              </Pressable>
              <Field theme={profileTheme} label="昵称" value={nickname} onChangeText={setNickname} placeholder="请输入昵称" />
              <Field theme={profileTheme} label="座右铭" value={motto} onChangeText={setMotto} placeholder="写一句你的座右铭（最多30字）" maxLength={30} />
              {resolvedProfileId ? (
                <View style={styles.field}>
                  <Text style={[styles.fieldLabel, { color: profileTheme.secondaryText }]}>用户ID</Text>
                  <View style={[styles.editIdRow, { backgroundColor: profileTheme.card, borderColor: profileTheme.border }]}>
                    <Text style={[styles.editIdValue, styles.flex, { color: profileTheme.secondaryText }]} selectable>{resolvedProfileId}</Text>
                    <SmallButton theme={profileTheme} label="复制" onPress={() => void copyUserId()} />
                  </View>
                </View>
              ) : null}
              <AppButton label="保存" loading={saving} onPress={saveProfile} />
              <Pressable accessibilityRole="button" accessibilityLabel="注销账号" onPress={() => void confirmDeleteAccount()} style={({ pressed }) => [styles.deleteAccount, pressed && styles.topActionPressed]}>
                <Text style={[styles.deleteText, { color: profileTheme.danger }]}>注销账号</Text>
              </Pressable>
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
      <Modal visible={Boolean(reportTarget)} transparent animationType="slide" onRequestClose={closeReport}>
        <KeyboardAvoidingView style={styles.modalKeyboardAvoider} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <Pressable style={[styles.editSheetMask, { backgroundColor: profileTheme.scrim }]} onPress={closeReport}>
          <Pressable style={[styles.reportSheet, { paddingBottom: insets.bottom + 20, backgroundColor: profileTheme.drawer }]} onPress={(event) => event.stopPropagation()}>
            <View style={[styles.drawerHandle, { backgroundColor: profileTheme.border }]} />
            <View style={styles.editSheetHeader}>
              <View style={styles.flex}>
                <Text style={[styles.sectionTitle, { color: profileTheme.primaryText }]}>举报动态</Text>
                <Text style={[styles.reportTargetTitle, { color: profileTheme.secondaryText }]} numberOfLines={1}>{reportTarget?.title}</Text>
              </View>
              <Pressable accessibilityRole="button" accessibilityLabel="关闭举报" disabled={reporting} onPress={closeReport} style={({ pressed }) => [styles.editSheetClose, { backgroundColor: profileTheme.border }, pressed && styles.topActionPressed]}>
                <X size={20} color={profileTheme.primaryText} />
              </Pressable>
            </View>
            <ScrollView
              style={styles.reportContentScroll}
              contentContainerStyle={styles.reportContentContainer}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              <View accessibilityRole="radiogroup" style={styles.reportReasonList}>
              {REPORT_REASON_OPTIONS.map((option) => {
                const selected = reportReason === option.value
                return (
                  <Pressable
                    key={option.value}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: selected }}
                    accessibilityLabel={option.label}
                    disabled={reporting}
                    onPress={() => setReportReason(option.value)}
                    style={({ pressed }) => [styles.reportReason, { borderColor: selected ? profileTheme.accent : profileTheme.border, backgroundColor: selected ? profileTheme.accentSurface : profileTheme.card }, pressed && styles.topActionPressed]}
                  >
                    <View style={[styles.reportRadio, { borderColor: selected ? profileTheme.accent : profileTheme.mutedText }]}>
                      {selected ? <View style={[styles.reportRadioDot, { backgroundColor: profileTheme.accent }]} /> : null}
                    </View>
                    <Text style={[styles.reportReasonText, { color: profileTheme.primaryText }]}>{option.label}</Text>
                  </Pressable>
                )
              })}
            </View>
            {reportReason === 'other' ? (
              <TextInput
                value={reportExtra}
                onChangeText={setReportExtra}
                accessibilityLabel="补充举报说明"
                placeholder="补充说明（选填，最多 120 字）"
                placeholderTextColor={profileTheme.mutedText}
                maxLength={120}
                multiline
                textAlignVertical="top"
                style={[styles.input, styles.reportInput, { color: profileTheme.primaryText, backgroundColor: profileTheme.input, borderColor: profileTheme.border }]}
              />
            ) : null}
            </ScrollView>
            <View style={styles.reportActions}>
              <Pressable accessibilityRole="button" accessibilityLabel="取消举报" disabled={reporting} onPress={closeReport} style={({ pressed }) => [styles.reportCancel, { backgroundColor: profileTheme.cancelSurface }, pressed && styles.topActionPressed]}>
                <Text style={[styles.reportCancelText, { color: profileTheme.secondaryText }]}>取消</Text>
              </Pressable>
              <Pressable accessibilityRole="button" accessibilityLabel="提交举报" accessibilityState={{ disabled: !reportReason, busy: reporting }} disabled={!reportReason || reporting} onPress={() => void submitReport()} style={({ pressed }) => [styles.reportSubmit, (!reportReason || reporting) && styles.actionDisabled, pressed && styles.topActionPressed]}>
                {reporting ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.reportSubmitText}>提交举报</Text>}
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
        </KeyboardAvoidingView>
      </Modal>
      <Modal visible={deleteConfirmVisible} transparent animationType="fade" onRequestClose={() => setDeleteConfirmVisible(false)}>
        <Pressable style={[styles.deleteDialogMask, { backgroundColor: profileTheme.scrim }]} onPress={() => setDeleteConfirmVisible(false)}>
          <Pressable style={[styles.deleteDialog, { backgroundColor: profileTheme.drawer }]} onPress={(event) => event.stopPropagation()}>
            <Text style={[styles.deleteDialogTitle, { color: profileTheme.primaryText }]}>确认注销账号</Text>
            <Text style={[styles.deleteDialogDescription, { color: profileTheme.secondaryText }]}>这是不可恢复的操作。请输入“注销账号”后继续。</Text>
            <Text style={[styles.fieldLabel, { color: profileTheme.secondaryText }]}>确认文案</Text>
            <TextInput
              value={deleteConfirmation}
              onChangeText={setDeleteConfirmation}
              placeholder="注销账号"
              placeholderTextColor={profileTheme.mutedText}
              accessibilityLabel="输入注销账号确认文案"
              maxLength={8}
              style={[styles.input, { color: profileTheme.primaryText, backgroundColor: profileTheme.input, borderColor: profileTheme.border }]}
            />
            <View style={styles.deleteDialogActions}>
              <Pressable accessibilityRole="button" accessibilityLabel="取消注销" style={[styles.deleteDialogCancel, { backgroundColor: profileTheme.cancelSurface }]} disabled={saving} onPress={() => setDeleteConfirmVisible(false)}>
                <Text style={[styles.deleteDialogCancelText, { color: profileTheme.secondaryText }]}>取消</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="确认注销账号"
                style={[styles.deleteDialogConfirm, deleteConfirmation.trim() !== '注销账号' && styles.deleteDialogConfirmDisabled]}
                disabled={saving || deleteConfirmation.trim() !== '注销账号'}
                onPress={() => void deleteAccount()}
              >
                <Text style={styles.deleteDialogConfirmText}>{saving ? '处理中…' : '确认注销'}</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </ScrollView>
  )
}

function Field({
  theme,
  label,
  value,
  onChangeText,
  placeholder,
  multiline,
  maxLength,
}: {
  theme: ProfileVisualTheme
  label: string
  value: string
  onChangeText: (value: string) => void
  placeholder?: string
  multiline?: boolean
  maxLength?: number
}) {
  return (
    <View style={styles.field}>
      <Text style={[styles.fieldLabel, { color: theme.secondaryText }]}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        accessibilityLabel={label}
        placeholderTextColor={theme.mutedText}
        multiline={multiline}
        maxLength={maxLength}
        textAlignVertical={multiline ? 'top' : 'center'}
        style={[styles.input, { color: theme.primaryText, backgroundColor: theme.input, borderColor: theme.border }, multiline && styles.textarea]}
      />
    </View>
  )
}

function SegmentButton({ theme, label, active, onPress }: { theme: ProfileVisualTheme; label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="tab" accessibilityState={{ selected: active }} style={({ pressed }) => [styles.segmentItem, active && styles.segmentItemActive, pressed && styles.topActionPressed]} onPress={onPress}>
      <Text style={[styles.segmentText, { color: active ? theme.primaryText : theme.secondaryText }, active && styles.segmentTextActive]}>{label}</Text>
      {active ? <View style={[styles.segmentIndicator, { backgroundColor: theme.accent }]} /> : null}
    </Pressable>
  )
}

function SmallButton({ theme, label, onPress }: { theme: ProfileVisualTheme; label: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={({ pressed }) => [styles.smallButton, { backgroundColor: theme.accentSurface, borderColor: theme.accentBorder }, pressed && styles.topActionPressed]}>
      <Text style={[styles.smallButtonText, { color: theme.accent }]}>{label}</Text>
    </Pressable>
  )
}

function EmptyState({ theme, text }: { theme: ProfileVisualTheme; text: string }) {
  return (
    <View style={styles.contentEmpty}>
      <Text style={[styles.empty, { color: theme.mutedText }]}>{text}</Text>
    </View>
  )
}

function NutritionMetric({ entry }: { entry: NutritionEntry }) {
  const Icon = entry.kind === 'calories'
    ? Flame
    : entry.kind === 'protein'
      ? Beef
      : entry.kind === 'carbs'
        ? Wheat
        : Droplets
  return (
    <View style={styles.nutritionMetric}>
      <Icon size={13} strokeWidth={2.2} color={entry.color} />
      <Text style={[styles.nutritionText, { color: entry.color }]}>{entry.text}</Text>
    </View>
  )
}

function CompactFoodCard({ theme, item }: { theme: ProfileVisualTheme; item: CommunityFeedItem }) {
  const record = item.record
  const recipeId = (record as typeof record & { recipe_id?: string }).recipe_id
  const firstFood = record.items?.[0]
  const imageUrl = String(firstFood?.image_path || record.image_path || '').trim()
  const calories = numberFrom(firstFood?.nutrients?.calories) || numberFrom(record.total_calories)
  return (
    <View style={[styles.compactFoodCard, { backgroundColor: theme.input, borderColor: theme.border }]}>
      {imageUrl ? <Image source={{ uri: imageUrl }} style={[styles.compactFoodImage, { backgroundColor: theme.surfaceMuted }]} /> : <View style={[styles.compactFoodImage, { backgroundColor: theme.surfaceMuted }]} />}
      <View style={styles.compactFoodMain}>
        <Text style={[styles.compactFoodName, { color: theme.primaryText }]} numberOfLines={1}>{firstFood?.name || record.description || '食物记录'}</Text>
        {calories > 0 ? <Text style={styles.compactFoodKcal}>{Math.round(calories)} kcal</Text> : null}
      </View>
      <View style={[styles.compactFoodBadge, { backgroundColor: theme.accentSurface, borderColor: theme.accentBorder }]}>
        <Text style={[styles.compactFoodBadgeText, { color: theme.accent }]}>{recipeId ? '收藏' : '常用食物'}</Text>
      </View>
    </View>
  )
}

function shouldShowCompactFoodCard(item: CommunityFeedItem): boolean {
  const type = normalizeTargetType(item.target_type || item.record?.feed_type)
  const recipeId = (item.record as typeof item.record & { recipe_id?: string }).recipe_id
  return type === 'food_record' && Boolean(item.record.items?.length || recipeId)
}

function feedNutrition(item: CommunityFeedItem): NutritionEntry[] {
  const record = item.record
  const type = normalizeTargetType(item.target_type || record.feed_type)
  const entries: NutritionEntry[] = []
  const calories = type === 'exercise_log' ? numberFrom(record.calories_burned) : numberFrom(record.total_calories)
  if (calories > 0) entries.push({ kind: 'calories', text: type === 'exercise_log' ? '消耗 ' + Math.round(calories) : String(Math.round(calories)), color: '#00a873' })
  if (numberFrom(record.total_protein) > 0) entries.push({ kind: 'protein', text: String(Math.round(numberFrom(record.total_protein))) + 'g', color: '#5c9ed4' })
  if (numberFrom(record.total_carbs) > 0) entries.push({ kind: 'carbs', text: String(Math.round(numberFrom(record.total_carbs))) + 'g', color: '#b88930' })
  if (numberFrom(record.total_fat) > 0) entries.push({ kind: 'fat', text: String(Math.round(numberFrom(record.total_fat))) + 'g', color: '#e17e41' })
  return entries
}
function feedTitle(item: CommunityFeedItem): string {
  const record = item.record
  const type = normalizeTargetType(item.target_type || record?.feed_type)
  if (type === 'exercise_log') {
    return compactRepeatedText(String(record?.exercise_desc || record?.description || record?.exercise_type || '运动打卡'))
  }
  return String(record?.title || record?.body || record?.description || record?.items?.[0]?.name || '分享动态')
}

function feedSubtitle(item: CommunityFeedItem): string {
  const record = item.record
  const type = feedTypeLabel(item)
  const time = formatDateTime(record?.record_time || record?.created_at)
  const place = record?.school || record?.canteen
  return [type, place, time].filter(Boolean).join(' · ')
}

function feedTypeLabel(item: CommunityFeedItem): string {
  const type = normalizeTargetType(item.target_type || item.record?.feed_type)
  if (type === 'circle_post') return '自定义动态'
  if (type === 'exercise_log') return '运动打卡'
  if (type === 'campus_food') return '校园食堂'
  return mealLabel(item.record?.meal_type)
}

function feedImages(item: CommunityFeedItem): string[] {
  const record = item.record
  const urls = Array.isArray(record?.image_paths) ? record.image_paths : []
  const all = [...urls, record?.image_path || '']
  return Array.from(new Set(all.map((url) => String(url || '').trim()).filter(Boolean)))
}

function mealLabel(value: unknown): string {
  switch (value) {
    case 'breakfast':
      return '早餐'
    case 'morning_snack':
      return '早加餐'
    case 'lunch':
      return '午餐'
    case 'afternoon_snack':
    case 'snack':
      return '午加餐'
    case 'dinner':
      return '晚餐'
    case 'evening_snack':
      return '晚加餐'
    default:
      return value ? String(value) : '动态'
  }
}

function buildProfileShareLink(userId: string): string {
  return `foodlink://profile?pf=${encodeURIComponent(userId)}`
}

function formatShortUserId(userId: string): string {
  const trimmed = String(userId || '').trim()
  if (!trimmed) return ''
  return trimmed.length > 10 ? `${trimmed.slice(0, 8)}...${trimmed.slice(-4)}` : trimmed
}

function numberFrom(value: unknown, fallback = 0): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

function formatCompactNumber(value: unknown): string {
  const n = numberFrom(value)
  return n >= 10 ? String(Math.round(n)) : n.toFixed(1).replace(/\.0$/, '')
}

function compactRepeatedText(value: string): string {
  const text = value.trim()
  if (!text) return ''
  const mid = Math.floor(text.length / 2)
  if (text.length % 2 === 0 && text.slice(0, mid) === text.slice(mid)) return text.slice(0, mid).trim()
  return text.replace(/(.{2,80})\1+/g, '$1').trim()
}

function feedItemKey(item: CommunityFeedItem): string {
  return [item.target_type || item.record?.feed_type, item.target_id || item.record?.id].filter(Boolean).join(':')
}

function mergeFeedItems(previous: CommunityFeedItem[], nextItems: CommunityFeedItem[]): CommunityFeedItem[] {
  const seen = new Set(previous.map(feedItemKey).filter(Boolean))
  return [...previous, ...nextItems.filter((item) => {
    const key = feedItemKey(item)
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })]
}

function apiErrorStatus(error: unknown): number {
  if (!error || typeof error !== 'object') return 0
  const value = Number((error as { status?: unknown }).status)
  return Number.isFinite(value) ? value : 0
}

function normalizeTargetType(value: unknown): CommunityFeedTargetType {
  if (value === 'circle_post' || value === 'exercise_log' || value === 'campus_food') {
    return value
  }
  return value === 'exercise_checkin' ? 'exercise_log' : 'food_record'
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
    minWidth: 0,
  },
  profileScroll: {
    flex: 1,
    backgroundColor: colors.background,
  },
  profileContent: {
    minHeight: '100%',
    backgroundColor: colors.background,
  },
  profileTopSection: {
    position: 'relative',
    overflow: 'hidden',
    minHeight: 246,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 22,
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
    backgroundColor: '#10251d',
  },
  coverBackground: {
    ...StyleSheet.absoluteFill,
    bottom: -60,
    backgroundColor: '#10251d',
  },
  coverBackgroundImage: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  coverBackgroundMask: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0, 0, 0, 0.52)',
  },
  topActions: {
    position: 'absolute',
    top: 14,
    right: 16,
    zIndex: 2,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  topEditButton: {
    minHeight: 44,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 12,
    alignItems: 'center',
    flexDirection: 'row',
    gap: 5,
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.92)',
  },
  topEditButtonText: {
    color: '#374151',
    fontSize: 12,
    fontWeight: '700',
  },
  topIconButton: {
    width: 44,
    height: 44,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.16)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.22)',
  },
  topActionPressed: {
    opacity: 0.72,
  },
  cardPressed: {
    opacity: 0.78,
  },
  profileRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 12,
    marginTop: 82,
    marginBottom: 14,
    paddingLeft: 8,
    paddingRight: 104,
  },
  avatar: {
    width: 70,
    height: 70,
    borderRadius: 35,
    borderWidth: 3,
    borderColor: '#fff',
    backgroundColor: colors.surfaceMuted,
  },
  avatarFallback: {
    width: 70,
    height: 70,
    borderRadius: 35,
    borderWidth: 3,
    borderColor: '#fff',
    backgroundColor: '#f3f4f6',
  },
  topName: {
    color: '#fff',
    fontSize: 20,
    lineHeight: 28,
    fontWeight: '800',
  },
  profileIdRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 6,
  },
  topIdText: {
    color: 'rgba(255, 255, 255, 0.78)',
    fontSize: 12,
    lineHeight: 17,
    fontFamily: 'monospace',
  },
  inlineCopyButton: {
    minHeight: 24,
    borderRadius: 999,
    paddingHorizontal: 9,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.18)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.28)',
  },
  inlineCopyButtonText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
  },
  profileStatsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 10,
    paddingLeft: 4,
    marginBottom: 10,
  },
  profileStatItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    minHeight: 22,
  },
  profileStatNumber: {
    color: '#fff',
    fontSize: 15,
    lineHeight: 21,
    fontWeight: '800',
  },
  profileStatLabel: {
    color: '#fff',
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '500',
  },
  profileStatDivider: {
    color: '#fff',
    fontSize: 11,
    lineHeight: 17,
    paddingHorizontal: 2,
  },
  mottoRow: {
    paddingLeft: 4,
    paddingRight: 12,
  },
  mottoText: {
    color: 'rgba(255, 255, 255, 0.92)',
    fontSize: 13,
    lineHeight: 20,
  },
  mottoTextEmpty: {
    color: 'rgba(255, 255, 255, 0.55)',
  },
  profileActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 12,
  },
  profileActionButton: {
    flex: 1,
    minHeight: 44,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.brand,
    borderWidth: 1,
    borderColor: colors.brand,
  },
  profileActionButtonGhost: {
    backgroundColor: 'transparent',
    borderColor: 'rgba(255, 255, 255, 0.4)',
  },
  profileActionButtonText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
  },
  profileActionButtonLight: {
    flex: 1,
    minHeight: 44,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.92)',
  },
  profileActionButtonLightText: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '700',
  },
  profileBlockButton: {
    flex: 1,
    minHeight: 44,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(239, 68, 68, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(254, 202, 202, 0.72)',
  },
  profileBlockButtonText: {
    color: '#fecaca',
    fontSize: 13,
    fontWeight: '800',
  },
  profileBlockedPill: {
    flex: 1,
    minHeight: 44,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.16)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.24)',
  },
  profileBlockedPillText: {
    color: 'rgba(255, 255, 255, 0.82)',
    fontSize: 13,
    fontWeight: '800',
  },
  bottomDrawer: {
    flex: 1,
    minHeight: 420,
    marginTop: 8,
    paddingTop: 7,
    paddingBottom: 16,
    borderTopLeftRadius: 15,
    borderTopRightRadius: 15,
    backgroundColor: '#fff',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.06,
    shadowRadius: 16,
    elevation: 2,
  },
  drawerHandle: {
    width: 36,
    height: 4,
    borderRadius: 999,
    alignSelf: 'center',
    marginBottom: 7,
    backgroundColor: 'rgba(100, 116, 139, 0.2)',
  },
  rowBetween: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '800',
  },
  field: {
    marginBottom: 12,
  },
  fieldLabel: {
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 6,
  },
  input: {
    minHeight: 44,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    color: colors.text,
    backgroundColor: '#fff',
  },
  textarea: {
    minHeight: 88,
    paddingTop: 12,
    paddingBottom: 12,
  },
  editIdRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 10,
    backgroundColor: '#f9fafb',
  },
  editIdValue: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 18,
  },
  deleteAccount: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 6,
  },
  deleteText: {
    color: colors.danger,
    fontWeight: '800',
  },
  segment: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#f3f4f6',
  },
  segmentItem: {
    position: 'relative',
    minHeight: 50,
    marginRight: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentItemActive: {},
  segmentText: {
    color: colors.textSecondary,
    fontSize: 15,
    lineHeight: 21,
    fontWeight: '600',
  },
  segmentTextActive: {
    color: colors.text,
    fontWeight: '800',
  },
  segmentIndicator: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 3,
    borderRadius: 2,
    backgroundColor: colors.brand,
  },
  contentBody: {
    paddingHorizontal: 12,
    paddingTop: 8,
  },
  contentEmpty: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 50,
  },
  empty: {
    color: colors.textMuted,
    fontSize: 14,
    textAlign: 'center',
  },
  feedCard: {
    marginBottom: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: '#f9fafb',
  },
  profileFeedTime: {
    color: colors.textSecondary,
    fontSize: 12,
    lineHeight: 17,
    marginBottom: 6,
  },
  profileFeedTitle: {
    color: colors.text,
    fontSize: 14,
    lineHeight: 22,
    fontWeight: '600',
    marginBottom: 8,
  },
  feedImageGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 8,
    marginBottom: 8,
  },
  feedImage: {
    width: 96,
    height: 96,
    borderRadius: 8,
    backgroundColor: colors.surfaceMuted,
  },
  feedFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  nutritionRow: {
    flex: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  nutritionText: {
    fontSize: 11,
    lineHeight: 16,
  },
  likeText: {
    flexShrink: 0,
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 17,
  },
  collectionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: '#f9fafb',
  },
  itemName: {
    color: colors.text,
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '800',
  },
  compactFoodCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 8,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 8,
    backgroundColor: '#fff',
  },
  compactFoodImage: {
    width: 44,
    height: 44,
    borderRadius: 6,
    backgroundColor: colors.surfaceMuted,
  },
  compactFoodMain: {
    flex: 1,
    minWidth: 0,
  },
  compactFoodName: {
    color: colors.text,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '700',
  },
  compactFoodKcal: {
    color: '#00a873',
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '700',
  },
  compactFoodBadge: {
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#bbf7d0',
    backgroundColor: '#f0fdf4',
  },
  compactFoodBadgeText: {
    color: '#16a34a',
    fontSize: 10,
  },
  collectionMain: {
    flex: 1,
    minWidth: 0,
  },
  collectionNutrition: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 6,
  },
  nutritionKcal: { color: '#00a873', fontSize: 11 },
  nutritionProtein: { color: '#5c9ed4', fontSize: 11 },
  nutritionCarbs: { color: '#b88930', fontSize: 11 },
  nutritionFat: { color: '#e17e41', fontSize: 11 },
  collectionImage: {
    width: 56,
    height: 56,
    borderRadius: 8,
    backgroundColor: colors.surfaceMuted,
  },
  subtitle: {
    color: colors.textSecondary,
    fontSize: 13,
    lineHeight: 20,
    marginTop: 3,
  },
  smallButton: {
    minHeight: 44,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.brandSoft,
  },
  smallButtonText: {
    color: colors.brandDark,
    fontSize: 13,
    fontWeight: '800',
  },
  editSheetMask: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(15, 23, 42, 0.4)',
  },
  editSheet: {
    maxHeight: '85%',
    paddingTop: 7,
    paddingHorizontal: 16,
    borderTopLeftRadius: 15,
    borderTopRightRadius: 15,
    backgroundColor: '#fff',
  },
  editSheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  editSheetClose: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(15, 23, 42, 0.06)',
  },
  editAvatarWrap: {
    alignSelf: 'center',
    marginBottom: 16,
  },
  editAvatar: {
    width: 70,
    height: 70,
    borderRadius: 35,
    backgroundColor: colors.surfaceMuted,
  },
  editCover: {
    height: 104,
    overflow: 'hidden',
    marginTop: 8,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    backgroundColor: '#f9fafb',
  },
  editCoverImage: {
    width: '100%',
    height: '100%',
  },
  editCoverPlaceholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },
  editCoverPlaceholderText: {
    color: colors.textMuted,
    fontSize: 13,
  },
  deleteDialogMask: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    backgroundColor: 'rgba(15, 23, 42, 0.48)',
  },
  deleteDialog: {
    width: '100%',
    padding: 20,
    borderRadius: 16,
    backgroundColor: '#fff',
  },
  deleteDialogTitle: {
    color: colors.text,
    fontSize: 18,
    lineHeight: 26,
    fontWeight: '800',
  },
  deleteDialogDescription: {
    color: colors.textSecondary,
    fontSize: 14,
    lineHeight: 21,
    marginTop: 8,
    marginBottom: 16,
  },
  deleteDialogActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 18,
  },
  deleteDialogCancel: {
    flex: 1,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    backgroundColor: colors.surfaceMuted,
  },
  deleteDialogCancelText: {
    color: colors.textSecondary,
    fontWeight: '700',
  },
  deleteDialogConfirm: {
    flex: 1,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    backgroundColor: colors.danger,
  },
  deleteDialogConfirmDisabled: {
    opacity: 0.35,
  },
  deleteDialogConfirmText: {
    color: '#fff',
    fontWeight: '800',
  },
  fullState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
    gap: 12,
  },
  errorIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fullStateTitle: {
    fontSize: 18,
    lineHeight: 26,
    fontWeight: '800',
    textAlign: 'center',
  },
  fullStateDescription: {
    maxWidth: 320,
    fontSize: 14,
    lineHeight: 21,
    textAlign: 'center',
  },
  retryButton: {
    minHeight: 48,
    marginTop: 4,
    paddingHorizontal: 20,
    borderRadius: 24,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  retryButtonText: {
    fontSize: 14,
    fontWeight: '800',
  },
  actionDisabled: {
    opacity: 0.48,
  },
  inlineError: {
    minHeight: 52,
    marginBottom: 8,
    paddingLeft: 14,
    paddingRight: 6,
    borderWidth: 1,
    borderRadius: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  inlineErrorText: {
    flex: 1,
    minWidth: 0,
    fontSize: 12,
    lineHeight: 18,
  },
  inlineRetry: {
    minWidth: 64,
    minHeight: 44,
    paddingHorizontal: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
  },
  inlineRetryText: {
    fontSize: 12,
    fontWeight: '800',
  },
  feedCardBody: {
    minHeight: 48,
  },
  feedCardHeader: {
    minHeight: 32,
    marginBottom: 2,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  feedMoreButton: {
    width: 44,
    height: 44,
    marginTop: -6,
    marginRight: -8,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 22,
  },
  nutritionMetric: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  likeMetric: {
    flexShrink: 0,
    minHeight: 28,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  feedPagination: {
    minHeight: 56,
    paddingVertical: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadMoreButton: {
    minWidth: 128,
    minHeight: 44,
    paddingHorizontal: 18,
    borderWidth: 1,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadMoreText: {
    fontSize: 13,
    fontWeight: '700',
  },
  feedEndText: {
    fontSize: 12,
    lineHeight: 18,
  },
  modalKeyboardAvoider: {
    flex: 1,
  },
  reportSheet: {
    width: '100%',
    maxHeight: '92%',
    overflow: 'hidden',
    paddingTop: 7,
    paddingHorizontal: 16,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
  },
  reportContentScroll: {
    flexShrink: 1,
    minHeight: 0,
  },
  reportContentContainer: {
    paddingBottom: 2,
  },  reportTargetTitle: {
    marginTop: 3,
    paddingRight: 12,
    fontSize: 12,
    lineHeight: 18,
  },
  reportReasonList: {
    gap: 8,
  },
  reportReason: {
    minHeight: 48,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  reportRadio: {
    width: 20,
    height: 20,
    borderWidth: 1.5,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  reportRadioDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  reportReasonText: {
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '600',
  },
  reportInput: {
    minHeight: 88,
    marginTop: 10,
    paddingTop: 12,
    paddingBottom: 12,
  },
  reportActions: {
    marginTop: 16,
    flexDirection: 'row',
    gap: 10,
  },
  reportCancel: {
    flex: 1,
    minHeight: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  reportCancelText: {
    fontSize: 14,
    fontWeight: '700',
  },
  reportSubmit: {
    flex: 1,
    minHeight: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.danger,
  },
  reportSubmitText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '800',
  },
})
