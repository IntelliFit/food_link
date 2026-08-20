import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ActivityIndicator, Image, Modal, Pressable, RefreshControl, ScrollView, Share, StyleSheet, Text, TextInput, View } from 'react-native'
import * as Clipboard from 'expo-clipboard'
import * as ImagePicker from 'expo-image-picker'
import qrcode from 'qrcode-generator'
import { useFocusEffect, useNavigation, useRoute, type RouteProp } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import Svg, { Circle as SvgCircle, Defs, LinearGradient as SvgLinearGradient, Rect as SvgRect, Stop } from 'react-native-svg'
import {
  getMealTypeLabel,
  type CheckinLeaderboardItem,
  type FollowUserItem,
  type MealType,
  type MembershipPlan,
  type MembershipStatus,
  PET_ACCESSORIES,
  PET_ANIMALS,
  PET_COLORS,
  PET_PATTERNS,
  PET_SHAPES,
  derivePetAppearance,
  stableHash,
  type PetAppearanceCandidate,
  type PetAnimal,
  type PetSummary,
  type RecipeItem,
} from '@food-link/core'
import { apiClient } from '../api'
import { AppButton } from '../components/AppButton'
import { AppAlert as Alert } from '../providers/DialogProvider'
import {
  PetAvatar,
  petAccessoryLabel,
  petMoodLabel,
  petPatternLabel,
  petPersonalityLabel,
  petShapeLabel,
  petStateLabel,
} from '../components/PetAvatar'
import type { RecipeInput as ApiRecipeInput } from '@food-link/api-client'
import type { PublicFoodShareDraft, RootStackParamList } from '../navigation/types'
import { colors } from '../theme'
import { todayKey } from '../utils/date'
import { userFacingErrorMessage } from '../utils/errors'
import { getHomePetHidden, setHomePetHidden } from '../utils/petPreferences'

const mealOptions: MealType[] = ['breakfast', 'morning_snack', 'lunch', 'afternoon_snack', 'dinner', 'evening_snack']
const PUBLIC_FOOD_MAX_IMAGES = 3
const PUBLIC_FOOD_QUICK_TAGS = ['少油', '少盐', '高蛋白', '低碳水', '清淡', '外卖', '健身餐']
const CAMPUS_FOOD_QUICK_TAGS = ['招牌菜', '性价比高', '大份量', '清淡', '少油', '高蛋白', '排队少']
type PublicFoodSourceKind = 'restaurant' | 'homemade' | 'campus'
type PublicFoodPriceType = 'fixed' | 'weight' | 'range' | 'combo' | 'unknown'

const publicFoodPriceTypeOptions: Array<{ value: PublicFoodPriceType; label: string; helper: string }> = [
  { value: 'fixed', label: '固定价', helper: '适合一份一价，例如 15 元/份。' },
  { value: 'weight', label: '称重', helper: '适合按斤或按克称重的窗口。' },
  { value: 'range', label: '区间价', helper: '适合配菜组合或价格浮动较大的菜品。' },
  { value: 'combo', label: '套餐', helper: '适合套餐、双拼或固定组合。' },
  { value: 'unknown', label: '暂不确定', helper: '不知道价格时也可以先补充食堂信息。' },
]

interface RecipeFormRow {
  id: string
  name: string
  weight: string
  calories: string
  protein: string
  carbs: string
  fat: string
}

interface RecipeTotals {
  weight: number
  calories: number
  protein: number
  carbs: number
  fat: number
}

export function CheckinLeaderboardScreen() {
  const insets = useSafeAreaInsets()
  const [items, setItems] = useState<CheckinLeaderboardItem[]>([])
  const [range, setRange] = useState('')
  const [loading, setLoading] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setErrorMessage(null)
    try {
      const data = await apiClient.communityGetCheckinLeaderboard()
      setItems(data.list || [])
      setRange(data.week_start && data.week_end ? `${data.week_start} ~ ${data.week_end}` : '')
    } catch (error) {
      setErrorMessage('加载失败，请稍后重试')
      setItems([])
      showError('获取排行榜失败', error)
    } finally {
      setLoading(false)
    }
  }, [])

  useFocusEffect(
    useCallback(() => {
      void load()
    }, [load]),
  )

  return (
    <View style={styles.checkinLeaderboardPage}>
      <Svg width="100%" height="100%" preserveAspectRatio="none" style={StyleSheet.absoluteFill} pointerEvents="none">
        <Defs>
          <SvgLinearGradient id="checkinLeaderboardBg" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#f0fdf4" />
            <Stop offset="0.35" stopColor="#f8fafc" />
            <Stop offset="1" stopColor="#ffffff" />
          </SvgLinearGradient>
        </Defs>
        <SvgRect x="0" y="0" width="100%" height="100%" fill="url(#checkinLeaderboardBg)" />
      </Svg>
      <View style={styles.checkinLeaderboardHeader}>
        <Text style={styles.checkinLeaderboardTitle}>好友本周打卡</Text>
        {range ? (
          <Text style={styles.checkinLeaderboardRange}>统计周期 {range}（北京时间）</Text>
        ) : null}
      </View>

      {loading ? (
        <View style={styles.checkinLeaderboardState}>
          <ActivityIndicator color={colors.brand} />
        </View>
      ) : errorMessage ? (
        <View style={styles.checkinLeaderboardState}>
          <Text style={styles.checkinLeaderboardStateText}>{errorMessage}</Text>
          <Pressable style={styles.checkinLeaderboardRetry} onPress={load}>
            <Text style={styles.checkinLeaderboardRetryText}>重试</Text>
          </Pressable>
        </View>
      ) : items.length === 0 ? (
        <View style={styles.checkinLeaderboardState}>
          <Text style={styles.checkinLeaderboardStateText}>暂无数据</Text>
        </View>
      ) : (
        <ScrollView
          style={styles.checkinLeaderboardScroll}
          contentContainerStyle={[styles.checkinLeaderboardList, { paddingBottom: 24 + insets.bottom }]}
          refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.brand} colors={[colors.brand]} />}
          showsVerticalScrollIndicator={false}
        >
            {items.map((item, index) => {
              const rank = item.rank || index + 1
              const checkinCount = item.checkin_count ?? item.record_count ?? 0
              const nickname = item.nickname || '食友'
              return (
                <View
                  key={item.user_id}
                  style={[styles.checkinLeaderboardRow, item.is_me ? styles.checkinLeaderboardRowMine : null]}
                >
                  <Text
                    style={[
                      styles.checkinLeaderboardRank,
                      rank === 1 ? styles.checkinLeaderboardRankTop1 : null,
                      rank === 2 ? styles.checkinLeaderboardRankTop2 : null,
                      rank === 3 ? styles.checkinLeaderboardRankTop3 : null,
                    ]}
                  >
                    {rank}
                  </Text>
                  <View style={styles.checkinLeaderboardAvatarWrap}>
                    {item.avatar ? (
                      <Image source={{ uri: item.avatar }} style={styles.checkinLeaderboardAvatar} />
                    ) : (
                      <Text style={styles.checkinLeaderboardAvatarText}>👤</Text>
                    )}
                  </View>
                  <View style={styles.checkinLeaderboardMiddle}>
                    <View style={styles.checkinLeaderboardNameRow}>
                      <Text style={styles.checkinLeaderboardName} numberOfLines={1}>{nickname}</Text>
                      {item.is_me ? <Text style={styles.checkinLeaderboardMeTag}>我</Text> : null}
                    </View>
                  </View>
                  <View style={styles.checkinLeaderboardCount}>
                    <Text style={styles.checkinLeaderboardCountNum}>{checkinCount}</Text>
                    <Text style={styles.checkinLeaderboardCountUnit}>次打卡</Text>
                  </View>
                </View>
              )
            })}
        </ScrollView>
      )}
    </View>
  )
}

export function InviteFriendsScreen() {
  const route = useRoute<RouteProp<RootStackParamList, 'InviteFriends'>>()
  const routeInviteCode = useMemo(
    () => normalizeInviteCode(route.params?.inviteCode || route.params?.invite_code || route.params?.fi),
    [route.params?.fi, route.params?.inviteCode, route.params?.invite_code],
  )
  const [profile, setProfile] = useState<Record<string, unknown> | null>(null)
  const [currentUserId, setCurrentUserId] = useState('')
  const [inviteCode, setInviteCode] = useState(routeInviteCode)
  const [resolvedProfile, setResolvedProfile] = useState<Record<string, unknown> | null>(null)
  const [inviteNotice, setInviteNotice] = useState('')
  const [loading, setLoading] = useState(false)
  const [qrPreviewOpen, setQrPreviewOpen] = useState(false)
  const inviteLink = useMemo(() => buildInviteDeepLink(inviteCode), [inviteCode])
  const inviteMessage = useMemo(() => buildInviteMessage(profile, inviteCode, inviteLink), [inviteCode, inviteLink, profile])
  const inviterUserId = profileUserId(profile)
  const isInviteOwner = Boolean(currentUserId && inviterUserId && currentUserId === inviterUserId)
  const relationProfile = resolvedProfile || profile
  const relationText = inviteRelationText(relationProfile)
  const inviteActionDone = inviteRelationHandled(relationProfile)
  const inviteActionLabel = inviteActionText(relationProfile)
  const inviteTitle = String(profile?.nickname || (isInviteOwner ? '我的邀请页' : '邀请你加入食探'))
  const inviteDesc = isInviteOwner
    ? '通过小程序卡片或二维码邀请新朋友，不必先分享打卡海报'
    : '完成注册后继续记录饮食或运动，满足规则即可到账'

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setInviteNotice('')
      const me = await apiClient.getUserProfile()
      const meRecord = me as unknown as Record<string, unknown>
      const meId = String(me.id || meRecord.user_id || '').trim()
      setCurrentUserId(meId)

      let inviteProfile: Record<string, unknown> | null = null
      if (routeInviteCode) {
        try {
          inviteProfile = await apiClient.getInviteProfileByCode(routeInviteCode) as unknown as Record<string, unknown>
        } catch (error) {
          setInviteNotice(userFacingErrorMessage(error, '这个邀请码没有匹配到用户，可检查后重新输入。'))
        }
      }

      if (!inviteProfile && meId) {
        inviteProfile = await apiClient.getInviteProfile(meId) as unknown as Record<string, unknown>
      }

      if (inviteProfile) {
        setProfile(inviteProfile)
        setInviteCode(String(inviteProfile.invite_code || routeInviteCode || ''))
      }

      if (routeInviteCode) {
        try {
          const data = await apiClient.resolveInvite(routeInviteCode)
          setResolvedProfile(data as unknown as Record<string, unknown>)
        } catch {
          setResolvedProfile(null)
        }
      } else {
        setResolvedProfile(null)
      }
    } catch (error) {
      showError('获取邀请页失败', error)
    } finally {
      setLoading(false)
    }
  }, [routeInviteCode])

  useEffect(() => {
    void load()
  }, [load])

  const accept = async () => {
    const code = normalizeInviteCode(routeInviteCode || inviteCode)
    setLoading(true)
    try {
      setInviteNotice('')
      const data = await apiClient.acceptInvite(code)
      setResolvedProfile(data as Record<string, unknown>)
      setProfile((current) => (data.nickname || data.user_id || data.id) ? data as Record<string, unknown> : current)
      Alert.alert('已处理', inviteRelationText(data as Record<string, unknown>))
    } catch (error) {
      showError('接受邀请失败', error)
    } finally {
      setLoading(false)
    }
  }

  const copyInviteCode = async () => {
    if (!inviteCode) {
      Alert.alert('邀请信息生成中', '请下拉刷新邀请页后再复制。')
      return
    }
    await Clipboard.setStringAsync(inviteCode)
    Alert.alert('已复制', '邀请码已复制，可以发送给朋友。')
  }

  const shareInvite = async () => {
    if (!inviteCode) {
      Alert.alert('邀请信息生成中', '请下拉刷新邀请页后再分享。')
      return
    }
    try {
      await Share.share({
        title: '邀请加入食探',
        message: inviteMessage,
      })
    } catch (error) {
      showError('分享邀请失败', error)
    }
  }

  return (
    <View style={styles.invitePage}>
      <Svg width="100%" height="100%" preserveAspectRatio="none" style={StyleSheet.absoluteFill} pointerEvents="none">
        <Defs>
          <SvgLinearGradient id="inviteBg" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#f7faf8" />
            <Stop offset="1" stopColor="#f3f7f4" />
          </SvgLinearGradient>
        </Defs>
        <SvgRect x="0" y="0" width="100%" height="100%" fill="url(#inviteBg)" />
        <SvgCircle cx="350" cy="18" r="128" fill="#10b981" opacity="0.14" />
      </Svg>
      <ScrollView
        style={styles.inviteScroll}
        contentContainerStyle={styles.inviteContent}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor="#10b981" colors={['#10b981']} />}
      >
        <View style={styles.inviteHero}>
          <Text style={styles.inviteEyebrow}>邀请有礼</Text>
          <Text style={styles.inviteTitle}>
            {String(profile?.nickname || '').trim()
              ? `${String(profile?.nickname || '').trim()} 邀你加入食探`
              : isInviteOwner
                ? '把食探分享给新朋友'
                : '加入食探并开始健康打卡'}
          </Text>
          <Text style={styles.inviteSubtitle}>新用户 7 天内完成 2 个自然日有效记录，双方各得 15 积分，每月最多 10 人</Text>
        </View>

        <View style={[styles.inviteCard, styles.inviterCard]}>
          <View style={styles.inviteProfileRow}>
            {String(profile?.avatar || '') ? (
              <Image source={{ uri: String(profile?.avatar || '') }} style={styles.inviteAvatar} />
            ) : (
              <View style={styles.inviteAvatarFallback}>
                <Text style={styles.inviteAvatarText}>食</Text>
              </View>
            )}
            <View style={styles.inviterCopy}>
              <Text style={styles.inviterName}>{inviteTitle}</Text>
              <Text style={styles.inviterDesc}>{inviteDesc}</Text>
            </View>
          </View>
          <Pressable style={styles.inviteCodeChip} onPress={copyInviteCode}>
            <View style={styles.inviteCodeLabelRow}>
              <Text style={styles.inviteCodeLabel}>邀请码</Text>
            </View>
            <Text style={styles.inviteCodeValue} selectable>{inviteCode || '--'}</Text>
          </Pressable>
          {inviteNotice ? <Text style={styles.noticeText}>{inviteNotice}</Text> : null}
          {!isInviteOwner ? <Text style={styles.inviteRelationText}>{relationText}</Text> : null}
        </View>

        <View style={[styles.inviteCard, styles.rulesCard]}>
          <InviteRuleItem index="01" text="必须是从未注册过食探的新用户" />
          <InviteRuleItem index="02" text="注册后 7 天内完成 2 个自然日饮食或运动记录" />
          <InviteRuleItem index="03" text="达标后双方各得 15 积分，邀请人每月上限 10 人" />
        </View>

        {isInviteOwner && inviteLink ? (
          <View style={[styles.inviteCard, styles.inviteQrCard]}>
            <View style={styles.inviteQrHeader}>
              <Text style={styles.inviteQrTitle}>扫码也能加入</Text>
              <Text style={styles.inviteQrDesc}>把这个二维码展示给朋友，或保存后发到群里</Text>
            </View>
            <Pressable
              accessibilityRole="imagebutton"
              accessibilityLabel="打开邀请二维码"
              style={styles.inviteQrBox}
              onPress={() => setQrPreviewOpen(true)}
            >
              <InviteQrCode value={inviteLink} />
            </Pressable>
          </View>
        ) : null}

        <View style={styles.inviteActions}>
          {isInviteOwner ? (
            <>
              <InviteActionButton label="立即转发邀请" onPress={shareInvite} disabled={!inviteCode} />
              <InviteActionButton label="复制邀请码" variant="ghost" onPress={copyInviteCode} disabled={!inviteCode} />
            </>
          ) : (
            <InviteActionButton
              label={inviteActionDone ? inviteActionLabel : '直接加好友并开始打卡'}
              onPress={accept}
              disabled={!inviteCode || loading || inviteActionDone}
              loading={loading && !inviteActionDone}
            />
          )}
        </View>

        {!loading && !inviterUserId && !inviteCode ? (
          <View style={styles.inviteEmpty}>
            <Text style={styles.inviteEmptyText}>当前还没有可用的邀请码</Text>
          </View>
        ) : null}
      </ScrollView>

      <Modal visible={qrPreviewOpen} transparent animationType="fade" onRequestClose={() => setQrPreviewOpen(false)}>
        <View style={styles.inviteQrModalBackdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setQrPreviewOpen(false)} />
          <View style={styles.inviteQrModalCard}>
            <Text style={styles.auditModalTitle}>邀请二维码</Text>
            <Text style={styles.auditModalLine}>朋友扫码打开后会自动带入邀请码。</Text>
            <InviteQrCode value={inviteLink} large />
            <AppButton label="关闭" onPress={() => setQrPreviewOpen(false)} />
          </View>
        </View>
      </Modal>
    </View>
  )
}

export function FollowListScreen() {
  const route = useRoute<RouteProp<RootStackParamList, 'FollowList'>>()
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  const [items, setItems] = useState<FollowUserItem[]>([])
  const [followStates, setFollowStates] = useState<Record<string, boolean>>({})
  const [hasMore, setHasMore] = useState(false)
  const [offset, setOffset] = useState(0)
  const [loading, setLoading] = useState(false)
  const [mutatingId, setMutatingId] = useState<string | null>(null)
  const type = route.params.type || 'followers'
  const title = type === 'followers' ? '被关注' : '关注'

  useEffect(() => {
    navigation.setOptions({ title })
  }, [navigation, title])

  const load = useCallback(async (reset = true) => {
    setLoading(true)
    try {
      const currentOffset = reset ? 0 : offset
      const data = type === 'followers'
        ? await apiClient.getFollowers(route.params.userId, currentOffset, 20)
        : await apiClient.getFollowing(route.params.userId, currentOffset, 20)
      const next = data.list || []
      setItems((prev) => reset ? next : [...prev, ...next])
      setFollowStates((prev) => {
        const states = reset ? {} : { ...prev }
        next.forEach((user) => {
          const id = followUserId(user)
          if (!id) return
          states[id] = type === 'following' ? true : Boolean(user.is_following)
        })
        return states
      })
      setOffset(currentOffset + next.length)
      setHasMore(Boolean(data.has_more))
    } catch (error) {
      showError(`获取${title}失败`, error)
    } finally {
      setLoading(false)
    }
  }, [offset, route.params.userId, title, type])

  useEffect(() => {
    void load(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.params.userId, type])

  const openProfile = (userId: string) => {
    if (userId) navigation.navigate('ProfileSettings', { userId })
  }

  const toggleFollow = async (user: FollowUserItem) => {
    const id = followUserId(user)
    if (!id) return
    const isFollowing = followStates[id] ?? Boolean(user.is_following)
    setMutatingId(id)
    try {
      await apiClient.followUser(id, isFollowing)
      setFollowStates((prev) => ({ ...prev, [id]: !isFollowing }))
      setItems((prev) => prev.map((item) => followUserId(item) === id ? { ...item, is_following: !isFollowing } : item))
    } catch (error) {
      showError(isFollowing ? '取消关注失败' : '关注失败', error)
    } finally {
      setMutatingId(null)
    }
  }

  const handleListScroll = ({ nativeEvent }: {
    nativeEvent: { layoutMeasurement: { height: number }; contentOffset: { y: number }; contentSize: { height: number } }
  }) => {
    const nearBottom = nativeEvent.layoutMeasurement.height + nativeEvent.contentOffset.y >= nativeEvent.contentSize.height - 80
    if (nearBottom && hasMore && !loading) void load(false)
  }

  return (
    <View style={styles.followListPage}>
      <View pointerEvents="none" style={styles.followListWash} />
      <ScrollView
        style={styles.followListScroll}
        contentContainerStyle={items.length ? styles.followListContent : styles.followListEmptyContent}
        refreshControl={<RefreshControl refreshing={loading && items.length > 0} tintColor={colors.brand} onRefresh={() => load(true)} />}
        scrollEventThrottle={16}
        onScroll={handleListScroll}
      >
        {loading && items.length === 0 ? (
          <View style={styles.followListState}>
            <ActivityIndicator color={colors.brand} />
          </View>
        ) : null}

        {!loading && items.length === 0 ? (
          <View style={styles.followListEmpty}>
            <Text style={styles.followListEmptyText}>暂无{title}</Text>
          </View>
        ) : null}

        {items.map((user, index) => {
          const userId = followUserId(user)
          const isFollowing = followStates[userId] ?? Boolean(user.is_following)
          return (
            <View key={userId || index} style={styles.followListItem}>
              <Pressable style={styles.followItemLeft} onPress={() => openProfile(userId)}>
                <FollowAvatar user={user} />
                <Text style={styles.followItemName} numberOfLines={1}>{followDisplayName(user)}</Text>
              </Pressable>
              <Pressable
                style={[styles.followItemButton, isFollowing && styles.followItemButtonActive]}
                onPress={() => void toggleFollow(user)}
                disabled={mutatingId === userId}
              >
                {mutatingId === userId ? (
                  <ActivityIndicator size="small" color={isFollowing ? colors.textMuted : colors.surface} />
                ) : (
                  <Text style={[styles.followItemButtonText, isFollowing && styles.followItemButtonTextActive]}>
                    {isFollowing ? '已关注' : '+ 关注'}
                  </Text>
                )}
              </Pressable>
            </View>
          )
        })}

        {loading && items.length > 0 ? (
          <View style={styles.followListMoreSpinner}>
            <ActivityIndicator color={colors.brand} />
          </View>
        ) : null}
      </ScrollView>
    </View>
  )
}
export function PublicFoodShareScreen() {
  const route = useRoute<RouteProp<RootStackParamList, 'PublicFoodShare'>>()
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  const insets = useSafeAreaInsets()
  const editId = route.params?.editId
  const campusDefault = route.params?.mode === 'campus'
  const [foodName, setFoodName] = useState('')
  const [description, setDescription] = useState('')
  const [imageUrls, setImageUrls] = useState('')
  const [merchantName, setMerchantName] = useState('')
  const [merchantAddress, setMerchantAddress] = useState('')
  const [calories, setCalories] = useState('')
  const [protein, setProtein] = useState('')
  const [carbs, setCarbs] = useState('')
  const [fat, setFat] = useState('')
  const [sourceKind, setSourceKind] = useState<PublicFoodSourceKind>(campusDefault ? 'campus' : 'restaurant')
  const [schoolName, setSchoolName] = useState('')
  const [campusName, setCampusName] = useState('')
  const [canteenName, setCanteenName] = useState('')
  const [floor, setFloor] = useState('')
  const [windowName, setWindowName] = useState('')
  const [price, setPrice] = useState('')
  const [priceType, setPriceType] = useState<PublicFoodPriceType>('fixed')
  const [priceMin, setPriceMin] = useState('')
  const [priceMax, setPriceMax] = useState('')
  const [priceUnit, setPriceUnit] = useState('份')
  const [priceCollectedAt, setPriceCollectedAt] = useState(todayKey())
  const [portionDescription, setPortionDescription] = useState('')
  const [tasteRating, setTasteRating] = useState('')
  const [suitableForFatLoss, setSuitableForFatLoss] = useState(true)
  const [tags, setTags] = useState('')
  const [notes, setNotes] = useState('')
  const [campusLocationText, setCampusLocationText] = useState('')
  const [province, setProvince] = useState('')
  const [city, setCity] = useState('')
  const [district, setDistrict] = useState('')
  const [detailAddress, setDetailAddress] = useState('')
  const [latitude, setLatitude] = useState('')
  const [longitude, setLongitude] = useState('')
  const [loading, setLoading] = useState(false)
  const [membershipStatus, setMembershipStatus] = useState<MembershipStatus | null>(null)
  const [membershipLoading, setMembershipLoading] = useState(true)
  const isCampus = sourceKind === 'campus'
  const isHomemade = sourceKind === 'homemade'
  const incomingDraft = route.params?.draft
  const selectedLocation = route.params?.selectedLocation
  const restoredDraftRef = useRef<string | null>(null)
  const appliedLocationRef = useRef<string | null>(null)

  const loadMembership = useCallback(async () => {
    setMembershipLoading(true)
    try {
      setMembershipStatus(await apiClient.getMyMembership())
    } catch (error) {
      setMembershipStatus(null)
      showError('获取会员状态失败', error)
    } finally {
      setMembershipLoading(false)
    }
  }, [])

  useFocusEffect(useCallback(() => {
    void loadMembership()
  }, [loadMembership]))

  const load = useCallback(async () => {
    if (!editId) return
    setLoading(true)
    try {
      const item = await apiClient.getPublicFood(editId)
      setFoodName(item.food_name || '')
      setDescription(item.description || '')
      setImageUrls((item.image_paths?.length ? item.image_paths : item.image_path ? [item.image_path] : []).join('\n'))
      setMerchantName(item.merchant_name || '')
      setMerchantAddress(item.merchant_address || item.detail_address || '')
      setCalories(String(Math.round(item.total_calories || 0)))
      setProtein(String(Math.round(item.total_protein || 0)))
      setCarbs(String(Math.round(item.total_carbs || 0)))
      setFat(String(Math.round(item.total_fat || 0)))
      setSourceKind(Boolean(item.is_campus_food) ? 'campus' : item.user_tags?.includes('自制') ? 'homemade' : 'restaurant')
      setSchoolName(item.school_name || '')
      setCampusName(item.campus_name || '')
      setCanteenName(item.canteen_name || '')
      setFloor(item.floor || '')
      setWindowName(item.window_name || '')
      setPrice(item.price != null ? String(item.price) : '')
      setPriceType(normalizePublicFoodPriceType(item.price_type))
      setPriceMin(item.price_min != null ? String(item.price_min) : '')
      setPriceMax(item.price_max != null ? String(item.price_max) : '')
      setPriceUnit(item.price_unit || '份')
      setPriceCollectedAt(item.price_collected_at ? item.price_collected_at.slice(0, 10) : todayKey())
      setPortionDescription(item.portion_description || '')
      setTasteRating(item.taste_rating != null ? String(item.taste_rating) : '')
      setSuitableForFatLoss(item.suitable_for_fat_loss ?? true)
      setTags((item.user_tags || []).join('、'))
      setNotes(item.user_notes || '')
      setCampusLocationText(item.campus_location_text || '')
      setProvince(item.province || '')
      setCity(item.city || '')
      setDistrict(item.district || '')
      setDetailAddress(item.detail_address || item.merchant_address || '')
      setLatitude(item.latitude != null ? String(item.latitude) : '')
      setLongitude(item.longitude != null ? String(item.longitude) : '')
    } catch (error) {
      showError(editId ? '加载公共食物失败' : '加载最近分享失败', error)
    } finally {
      setLoading(false)
    }
  }, [editId])

  useEffect(() => {
    if (incomingDraft) return
    void load()
  }, [incomingDraft, load])

  useEffect(() => {
    if (!incomingDraft) return
    const signature = JSON.stringify(incomingDraft)
    if (restoredDraftRef.current === signature) return
    restoredDraftRef.current = signature
    setFoodName(incomingDraft.foodName || '')
    setDescription(incomingDraft.description || '')
    setImageUrls(incomingDraft.imageUrls || '')
    setMerchantName(incomingDraft.merchantName || '')
    setMerchantAddress(incomingDraft.merchantAddress || '')
    setCalories(incomingDraft.calories || '')
    setProtein(incomingDraft.protein || '')
    setCarbs(incomingDraft.carbs || '')
    setFat(incomingDraft.fat || '')
    if (incomingDraft.sourceKind) setSourceKind(incomingDraft.sourceKind)
    setSchoolName(incomingDraft.schoolName || '')
    setCampusName(incomingDraft.campusName || '')
    setCanteenName(incomingDraft.canteenName || '')
    setFloor(incomingDraft.floor || '')
    setWindowName(incomingDraft.windowName || '')
    setPrice(incomingDraft.price || '')
    setPriceType(normalizePublicFoodPriceType(incomingDraft.priceType))
    setPriceMin(incomingDraft.priceMin || '')
    setPriceMax(incomingDraft.priceMax || '')
    setPriceUnit(incomingDraft.priceUnit || '份')
    setPriceCollectedAt(incomingDraft.priceCollectedAt || todayKey())
    setPortionDescription(incomingDraft.portionDescription || '')
    setTasteRating(incomingDraft.tasteRating || '')
    setSuitableForFatLoss(incomingDraft.suitableForFatLoss ?? true)
    setTags(incomingDraft.tags || '')
    setNotes(incomingDraft.notes || '')
    setCampusLocationText(incomingDraft.campusLocationText || '')
    setProvince(incomingDraft.province || '')
    setCity(incomingDraft.city || '')
    setDistrict(incomingDraft.district || '')
    setDetailAddress(incomingDraft.detailAddress || '')
    setLatitude(incomingDraft.latitude || '')
    setLongitude(incomingDraft.longitude || '')
  }, [incomingDraft])

  useEffect(() => {
    if (!selectedLocation) return
    const signature = JSON.stringify(selectedLocation)
    if (appliedLocationRef.current === signature) return
    appliedLocationRef.current = signature
    setSourceKind('restaurant')
    if (selectedLocation.name) setMerchantName(selectedLocation.name)
    if (selectedLocation.address) {
      setMerchantAddress(selectedLocation.address)
      setDetailAddress(selectedLocation.address)
    }
    if (selectedLocation.province) setProvince(selectedLocation.province)
    if (selectedLocation.city || selectedLocation.promptCity) setCity(selectedLocation.city || selectedLocation.promptCity || '')
    if (selectedLocation.district) setDistrict(selectedLocation.district)
    if (selectedLocation.latitude != null) setLatitude(String(selectedLocation.latitude))
    if (selectedLocation.longitude != null) setLongitude(String(selectedLocation.longitude))
  }, [selectedLocation])

  const buildLocationDraft = (): PublicFoodShareDraft => ({
    foodName,
    description,
    imageUrls,
    merchantName,
    merchantAddress,
    calories,
    protein,
    carbs,
    fat,
    sourceKind,
    schoolName,
    campusName,
    canteenName,
    floor,
    windowName,
    price,
    priceType,
    priceMin,
    priceMax,
    priceUnit,
    priceCollectedAt,
    portionDescription,
    tasteRating,
    suitableForFatLoss,
    tags,
    notes,
    campusLocationText,
    province,
    city,
    district,
    detailAddress,
    latitude,
    longitude,
  })

  const openLocationSearch = () => {
    navigation.navigate('LocationSearch', {
      returnTo: 'PublicFoodShare',
      editId,
      mode: isCampus ? 'campus' : 'public',
      draft: buildLocationDraft(),
    })
  }

  const pickImages = async () => {
    const currentUrls = splitTextList(imageUrls)
    const remaining = PUBLIC_FOOD_MAX_IMAGES - currentUrls.length
    if (remaining <= 0) {
      Alert.alert('图片已满', `最多上传 ${PUBLIC_FOOD_MAX_IMAGES} 张图片。`)
      return
    }
    const picked = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      selectionLimit: remaining,
      allowsEditing: false,
      quality: 0.86,
    })
    if (picked.canceled || !picked.assets.length) return
    setLoading(true)
    try {
      const uploaded: string[] = []
      for (const asset of picked.assets.slice(0, remaining)) {
        const data = await apiClient.uploadAnalyzeImageFile({
          fileUri: asset.uri,
          fileName: asset.fileName || 'public-food.jpg',
          mimeType: asset.mimeType || 'image/jpeg',
        })
        uploaded.push(data.imageUrl)
      }
      setImageUrls([...currentUrls, ...uploaded].slice(0, PUBLIC_FOOD_MAX_IMAGES).join('\n'))
    } catch (error) {
      showError('上传图片失败', error)
    } finally {
      setLoading(false)
    }
  }

  const removeImage = (index: number) => {
    setImageUrls((current) => splitTextList(current).filter((_, itemIndex) => itemIndex !== index).join('\n'))
  }

  const submit = async () => {
    const imagePaths = splitTextList(imageUrls).slice(0, PUBLIC_FOOD_MAX_IMAGES)
    const finalFoodName = foodName.trim()
    const finalTasteRating = optionalNumber(tasteRating)
    const finalPriceType = priceType
    const finalPrice = optionalNumber(price)
    const finalPriceMin = optionalNumber(priceMin)
    const finalPriceMax = optionalNumber(priceMax)
    const finalLatitude = optionalNumber(latitude)
    const finalLongitude = optionalNumber(longitude)

    if (isCampus) {
      try {
        const latestMembership = await apiClient.getMyMembership()
        setMembershipStatus(latestMembership)
        if (!latestMembership?.is_pro) {
          Alert.alert('校园食堂为会员专属', '开通食探会员后，可以分享或编辑校园食堂菜品。')
          return
        }
      } catch (error) {
        showError('验证会员状态失败', error)
        return
      }
    }

    if (!imagePaths.length) {
      Alert.alert('请先上传图片', isCampus ? '请上传校园菜品图片。' : '请上传这份食物的图片。')
      return
    }
    if (!finalFoodName) {
      Alert.alert(isCampus ? '请填写菜品名称' : '请填写食物名称')
      return
    }
    if (finalTasteRating != null && (finalTasteRating < 1 || finalTasteRating > 5)) {
      Alert.alert('口味评分需为 1-5')
      return
    }
    if (isCampus) {
      if (!schoolName.trim()) {
        Alert.alert('请选择学校')
        return
      }
      if (!canteenName.trim()) {
        Alert.alert('请填写食堂名称')
        return
      }
      if (finalPriceType === 'range' && (finalPriceMin == null || finalPriceMax == null || finalPriceMin <= 0 || finalPriceMax <= 0 || finalPriceMin > finalPriceMax)) {
        Alert.alert('请填写正确价格区间')
        return
      }
      if (finalPriceType !== 'range' && price.trim() && (finalPrice == null || finalPrice <= 0)) {
        Alert.alert('请填写正确价格')
        return
      }
    } else if (!isHomemade) {
      if (!province.trim() || !city.trim() || !district.trim() || finalLatitude == null || finalLongitude == null) {
        Alert.alert('请补充外食位置', '外食/堂食需要省、市、区和经纬度；自制餐食可切换为「自制」。')
        return
      }
    }

    const confirmed = await confirmPublicFoodSubmit({
      editId: Boolean(editId),
      isCampus,
      isHomemade,
    })
    if (!confirmed) return

    const finalTags = buildPublicFoodTags(splitTextList(tags), isHomemade)
    setLoading(true)
    try {
      const input = {
        foodName: finalFoodName,
        description: description.trim(),
        imagePath: imagePaths[0],
        imagePaths,
        merchantName: isHomemade ? undefined : merchantName,
        merchantAddress: isCampus ? campusLocationText || merchantAddress : merchantAddress,
        totalCalories: Number(calories) || 0,
        totalProtein: Number(protein) || 0,
        totalCarbs: Number(carbs) || 0,
        totalFat: Number(fat) || 0,
        isCampusFood: isCampus,
        type: isCampus ? 'campus' : 'common',
        province: isCampus || isHomemade ? undefined : province,
        city: isCampus || isHomemade ? undefined : city,
        district: isCampus || isHomemade ? undefined : district,
        detailAddress: isCampus || isHomemade ? undefined : detailAddress,
        latitude: isCampus || isHomemade ? undefined : finalLatitude,
        longitude: isCampus || isHomemade ? undefined : finalLongitude,
        schoolName,
        campusName,
        canteenName,
        floor,
        windowName,
        price: isCampus && finalPriceType !== 'range' ? finalPrice : undefined,
        priceType: isCampus ? finalPriceType : undefined,
        priceMin: isCampus && finalPriceType === 'range' ? finalPriceMin : undefined,
        priceMax: isCampus && finalPriceType === 'range' ? finalPriceMax : undefined,
        priceUnit,
        priceCollectedAt: isCampus && priceCollectedAt.trim() ? `${priceCollectedAt.trim()}T00:00:00+08:00` : undefined,
        portionDescription,
        tasteRating: finalTasteRating,
        suitableForFatLoss,
        userTags: finalTags,
        userNotes: notes,
        campusLocationText,
      }
      const itemId = editId
        ? (await apiClient.updatePublicFood(editId, input), editId)
        : (await apiClient.createPublicFood(input)).id
      if (itemId) navigation.replace('PublicFoodDetail', { itemId, isCampus })
      else navigation.goBack()
    } catch (error) {
      showError(editId ? '保存失败' : '分享到公共食物库失败', error)
    } finally {
      setLoading(false)
    }
  }

  const imageList = splitTextList(imageUrls)
  const selectedPriceOption = publicFoodPriceTypeOptions.find((option) => option.value === priceType)
  const submitLabel = editId ? '保存修改' : isCampus ? '提交并后台分析' : '发布到公共库'
  const tagList = splitTextList(tags)
  const quickTags = isCampus ? CAMPUS_FOOD_QUICK_TAGS : PUBLIC_FOOD_QUICK_TAGS
  const showCampusSwitch = !campusDefault
  const nutritionStats = [
    { value: Math.round(Number(calories) || 0), label: '热量 kcal' },
    { value: round1(Number(protein) || 0), label: '蛋白质 g' },
    { value: round1(Number(carbs) || 0), label: '碳水 g' },
    { value: round1(Number(fat) || 0), label: '脂肪 g' },
  ]

  const toggleTag = (tag: string) => {
    setTags((current) => {
      const currentTags = splitTextList(current)
      const nextTags = currentTags.includes(tag)
        ? currentTags.filter((item) => item !== tag)
        : [...currentTags, tag]
      return nextTags.join('、')
    })
  }

  const selectCampusSource = () => {
    if (membershipStatus?.is_pro) {
      setSourceKind('campus')
      return
    }
    Alert.alert('校园食堂为会员专属', '开通食探会员后，可以分享校园食堂菜品。', [
      { text: '暂不开通', style: 'cancel' },
      { text: '查看会员方案', onPress: () => navigation.navigate('MembershipCenter') },
    ])
  }

  if (isCampus && membershipLoading) {
    return (
      <View style={styles.publicFoodShareGatePage}>
        <ActivityIndicator color={colors.brand} />
      </View>
    )
  }

  if (isCampus && !membershipStatus?.is_pro) {
    return (
      <View style={styles.publicFoodShareGatePage}>
        <View style={styles.publicFoodShareGateCard}>
          <Text style={styles.publicFoodShareGateTitle}>校园食堂为会员专属</Text>
          <Text style={styles.publicFoodShareGateText}>开通食探会员后，可以分享校园食堂菜品并绑定已审核食堂。普通公共食物库分享仍可继续使用。</Text>
          <AppButton label="查看会员方案" onPress={() => navigation.navigate('MembershipCenter')} />
          {!campusDefault ? <AppButton label="返回普通分享" variant="secondary" onPress={() => setSourceKind('restaurant')} /> : null}
        </View>
      </View>
    )
  }

  return (
    <View style={styles.publicFoodShareRoot}>
      <ScrollView
        style={styles.publicFoodShareScroll}
        contentContainerStyle={[styles.publicFoodShareScrollContent, { paddingBottom: Math.max(insets.bottom, 10) + 100 }]}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor="#00bc7d" colors={['#00bc7d']} />}
      >
        <View style={styles.publicFoodShareBody}>
          {isCampus ? (
            <View style={[styles.publicFoodShareHero, styles.publicFoodShareHeroCampus]}>
              <Text style={styles.publicFoodShareHeroTitle}>{editId ? '编辑校园食堂菜品' : '分享校园食堂菜品'}</Text>
              <Text style={styles.publicFoodShareHeroSubtitle}>补充学校、食堂和窗口信息，帮助同学更快找到好吃的一餐。</Text>
            </View>
          ) : null}

          <PublicFoodShareSection title={isCampus ? '菜品图片' : '食物图片'} required meta={`${imageList.length}/${PUBLIC_FOOD_MAX_IMAGES}`}>
            <ImagePickerGrid urls={imageList} onAdd={pickImages} onRemove={removeImage} loading={loading} max={PUBLIC_FOOD_MAX_IMAGES} />
          </PublicFoodShareSection>

          {!isCampus ? (
            <PublicFoodShareSection title="营养信息">
              <PublicFoodNutritionSummary items={nutritionStats} />
              <Text style={styles.publicFoodShareNutritionTip}>营养数据会随识别结果带入；如为空，可手动补充。</Text>
              <View style={styles.publicFoodShareMacroGrid}>
                <View style={styles.flex}>
                  <Field label="热量 kcal" value={calories} onChangeText={setCalories} keyboardType="decimal-pad" />
                </View>
                <View style={styles.flex}>
                  <Field label="蛋白质 g" value={protein} onChangeText={setProtein} keyboardType="decimal-pad" />
                </View>
              </View>
              <View style={styles.publicFoodShareMacroGrid}>
                <View style={styles.flex}>
                  <Field label="碳水 g" value={carbs} onChangeText={setCarbs} keyboardType="decimal-pad" />
                </View>
                <View style={styles.flex}>
                  <Field label="脂肪 g" value={fat} onChangeText={setFat} keyboardType="decimal-pad" />
                </View>
              </View>
            </PublicFoodShareSection>
          ) : null}

          <PublicFoodShareSection title={isCampus ? '菜品信息' : '基础信息'} required>
            <Field label={isCampus ? '菜品名称' : '食物名称'} value={foodName} onChangeText={setFoodName} />
            {!isCampus ? <Field label="说明" value={description} onChangeText={setDescription} multiline /> : null}
            {!isCampus ? (
              <>
                <Text style={styles.fieldLabel}>餐食来源</Text>
                <View style={styles.publicFoodSourceTagRow}>
                  <PublicFoodSourceChip label="自制" active={isHomemade} onPress={() => setSourceKind('homemade')} />
                  <PublicFoodSourceChip label="外卖/堂食" active={sourceKind === 'restaurant'} onPress={() => setSourceKind('restaurant')} />
                </View>
                {!isHomemade ? <Field label="商家名称（可选）" value={merchantName} onChangeText={setMerchantName} placeholder="如：沙县小吃、肯德基等" /> : null}
                <Text style={styles.fieldLabel}>口味评分（可选）</Text>
                <PublicFoodRatingStars value={optionalNumber(tasteRating) || 0} onChange={(nextValue) => setTasteRating(nextValue ? String(nextValue) : '')} />
              </>
            ) : null}
            {showCampusSwitch ? (
                <PublicFoodSwitchRow label="校园食堂菜品" value={isCampus} onPress={() => isCampus ? setSourceKind('restaurant') : selectCampusSource()} />
            ) : null}
            {isCampus ? (
              <>
                <Field label="学校" value={schoolName} onChangeText={setSchoolName} placeholder="请选择学校" />
                <Field label="食堂" value={canteenName} onChangeText={setCanteenName} placeholder="请输入食堂名称" />
                <View style={styles.publicFoodShareMacroGrid}>
                  <View style={styles.flex}>
                    <Field label="楼层（可选）" value={floor} onChangeText={setFloor} placeholder="如：一层" />
                  </View>
                  <View style={styles.flex}>
                    <Field label="窗口（可选）" value={windowName} onChangeText={setWindowName} placeholder="如：12号窗口" />
                  </View>
                </View>
              </>
            ) : null}
          </PublicFoodShareSection>

          {isCampus ? (
            <PublicFoodShareSection title="价格信息（可选）">
              <Text style={styles.fieldLabel}>计价方式</Text>
              <View style={styles.segment}>
                {publicFoodPriceTypeOptions.map((option) => (
                  <SegmentButton key={option.value} label={option.label} active={priceType === option.value} onPress={() => setPriceType(option.value)} />
                ))}
              </View>
              <Text style={styles.publicFoodShareHint}>{selectedPriceOption?.helper}</Text>
              {priceType === 'range' ? (
                <View style={styles.publicFoodShareMacroGrid}>
                  <View style={styles.flex}>
                    <Field label="最低价" value={priceMin} onChangeText={setPriceMin} keyboardType="decimal-pad" placeholder="如：8" />
                  </View>
                  <View style={styles.flex}>
                    <Field label="最高价" value={priceMax} onChangeText={setPriceMax} keyboardType="decimal-pad" placeholder="如：15" />
                  </View>
                </View>
              ) : (
                <Field label="价格" value={price} onChangeText={setPrice} keyboardType="decimal-pad" placeholder={priceType === 'unknown' ? '可留空' : '如：12'} />
              )}
              <View style={styles.publicFoodShareMacroGrid}>
                <View style={styles.flex}>
                  <Field label="价格单位" value={priceUnit} onChangeText={setPriceUnit} placeholder="如：元/份" />
                </View>
                <View style={styles.flex}>
                  <Field label="采集日期" value={priceCollectedAt} onChangeText={setPriceCollectedAt} placeholder="YYYY-MM-DD" />
                </View>
              </View>
              <Field label="份量说明（可选）" value={portionDescription} onChangeText={setPortionDescription} placeholder="如：大份、小份、约一人份" />
            </PublicFoodShareSection>
          ) : null}

          <PublicFoodShareSection title="标签">
            <PublicFoodSwitchRow label="适合减脂" value={suitableForFatLoss} onPress={() => setSuitableForFatLoss(!suitableForFatLoss)} />
            <View style={styles.publicFoodQuickTags}>
              {quickTags.map((tag) => (
                <Pressable key={tag} style={[styles.publicFoodQuickTag, tagList.includes(tag) && styles.publicFoodQuickTagActive]} onPress={() => toggleTag(tag)}>
                  <Text style={[styles.publicFoodQuickTagText, tagList.includes(tag) && styles.publicFoodQuickTagTextActive]}>{tag}</Text>
                </Pressable>
              ))}
            </View>
            <Field label="自定义标签" value={tags} onChangeText={setTags} placeholder="低脂、饱腹、清淡，用逗号或顿号分隔" />
          </PublicFoodShareSection>

          {!isCampus ? (
            <PublicFoodShareSection title={isHomemade ? '所在地区（可选）' : '商家地址'} required={!isHomemade}>
              <View style={styles.publicFoodShareLocationHeader}>
                <Text style={styles.publicFoodShareHint}>
                  {isHomemade ? '自制餐食不需要填写商家信息；所在地区可按需补充。' : '搜索商家后会回填名称、地址和经纬度。'}
                </Text>
                {!isHomemade ? <SmallButton label="搜索地址" onPress={openLocationSearch} /> : null}
              </View>
              <View style={styles.publicFoodShareMacroGrid}>
                <View style={styles.flex}>
                  <Field label="省份" value={province} onChangeText={setProvince} placeholder="如：北京市" />
                </View>
                <View style={styles.flex}>
                  <Field label="城市" value={city} onChangeText={setCity} placeholder="如：北京市" />
                </View>
              </View>
              {!isHomemade ? <Field label="区县" value={district} onChangeText={setDistrict} placeholder="如：海淀区" /> : null}
              {!isHomemade ? <Field label="详细地址（可选）" value={detailAddress} onChangeText={setDetailAddress} placeholder="如：XX路XX号" /> : null}
            </PublicFoodShareSection>
          ) : null}

          <PublicFoodShareSection title="补充说明（可选）">
            <Field label={isCampus ? '例如口味、排队情况、推荐搭配等' : '分享你对这份餐食的评价或建议'} value={notes} onChangeText={setNotes} multiline />
          </PublicFoodShareSection>
        </View>
      </ScrollView>
      <View style={[styles.publicFoodShareSubmitBar, { paddingBottom: Math.max(insets.bottom, 10) }]}>
        <AppButton label={submitLabel} loading={loading} onPress={submit} />
      </View>
    </View>
  )
}

function PublicFoodShareSection({
  title,
  required,
  meta,
  children,
}: {
  title: string
  required?: boolean
  meta?: string
  children: ReactNode
}) {
  return (
    <View style={styles.publicFoodShareSection}>
      <View style={styles.publicFoodShareSectionHeader}>
        <View style={styles.inlineRow}>
          <Text style={styles.publicFoodShareSectionTitle}>{title}</Text>
          {required ? <Text style={styles.publicFoodShareRequired}>*</Text> : null}
        </View>
        {meta ? <Text style={styles.publicFoodShareMeta}>{meta}</Text> : null}
      </View>
      {children}
    </View>
  )
}

function PublicFoodNutritionSummary({ items }: { items: Array<{ value: number | string; label: string }> }) {
  return (
    <View style={styles.publicFoodNutritionSummary}>
      {items.map((item) => (
        <View key={item.label} style={styles.publicFoodNutritionItem}>
          <Text style={styles.publicFoodNutritionValue}>{item.value}</Text>
          <Text style={styles.publicFoodNutritionLabel}>{item.label}</Text>
        </View>
      ))}
    </View>
  )
}

function PublicFoodSourceChip({
  label,
  active,
  onPress,
}: {
  label: string
  active: boolean
  onPress: () => void
}) {
  return (
    <Pressable style={[styles.publicFoodSourceChip, active && styles.publicFoodSourceChipActive]} onPress={onPress}>
      <Text style={[styles.publicFoodSourceChipText, active && styles.publicFoodSourceChipTextActive]}>{label}</Text>
    </Pressable>
  )
}

function PublicFoodSwitchRow({ label, value, onPress }: { label: string; value: boolean; onPress: () => void }) {
  return (
    <View style={styles.publicFoodSwitchRow}>
      <Text style={styles.publicFoodSwitchLabel}>{label}</Text>
      <Pressable style={[styles.publicFoodSwitch, value && styles.publicFoodSwitchActive]} onPress={onPress}>
        <View style={[styles.publicFoodSwitchDot, value && styles.publicFoodSwitchDotActive]} />
      </Pressable>
    </View>
  )
}

function PublicFoodRatingStars({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  return (
    <View style={styles.publicFoodRatingStars}>
      {[1, 2, 3, 4, 5].map((item) => {
        const active = item <= value
        return (
          <Pressable key={item} onPress={() => onChange(item === value ? 0 : item)} hitSlop={8}>
            <Text style={[styles.publicFoodRatingStar, active && styles.publicFoodRatingStarActive]}>★</Text>
          </Pressable>
        )
      })}
    </View>
  )
}

export function RecipeEditScreen() {
  const route = useRoute<RouteProp<RootStackParamList, 'RecipeEdit'>>()
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  const insets = useSafeAreaInsets()
  const recipeId = route.params?.recipeId
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [imagePath, setImagePath] = useState('')
  const [tags, setTags] = useState('')
  const [mealType, setMealType] = useState<MealType>('lunch')
  const [isFavorite, setIsFavorite] = useState(true)
  const [items, setItems] = useState<RecipeFormRow[]>(() => [createBlankRecipeRow()])
  const [loading, setLoading] = useState(false)
  const totals = useMemo(() => calculateRecipeTotals(items), [items])
  const summaryStats = [
    { value: Math.round(totals.calories), label: '热量 (kcal)' },
    { value: round1(totals.protein), label: '蛋白质 (g)' },
    { value: round1(totals.carbs), label: '碳水 (g)' },
    { value: round1(totals.fat), label: '脂肪 (g)' },
  ]

  const load = useCallback(async () => {
    if (!recipeId) return
    setLoading(true)
    try {
      const recipe = await apiClient.getRecipe(recipeId)
      setName(recipe.recipe_name || '')
      setDescription(recipe.description || '')
      setImagePath(recipe.image_path || '')
      setTags((recipe.tags || []).join('、'))
      setIsFavorite(Boolean(recipe.is_favorite))
      setItems(recipeItemsToRows(recipe.items, recipe))
      const normalizedMeal = normalizeMealType(recipe.meal_type)
      if (normalizedMeal) setMealType(normalizedMeal)
    } catch (error) {
      showError('获取食谱失败', error)
    } finally {
      setLoading(false)
    }
  }, [recipeId])

  useEffect(() => {
    void load()
  }, [load])

  const save = async () => {
    if (!name.trim()) {
      Alert.alert('请输入食谱名')
      return
    }
    const payloadItems = recipeRowsToPayload(items, name)
    const payloadTotals = calculateRecipeTotalsFromPayload(payloadItems)
    setLoading(true)
    try {
      const input: ApiRecipeInput = {
        recipeName: name,
        description,
        imagePath,
        totalCalories: payloadTotals.calories,
        totalProtein: payloadTotals.protein,
        totalCarbs: payloadTotals.carbs,
        totalFat: payloadTotals.fat,
        totalWeightGrams: payloadTotals.weight || 100,
        tags: splitTextList(tags),
        mealType,
        isFavorite,
        items: payloadItems,
      }
      if (recipeId) await apiClient.updateRecipe(recipeId, input)
      else await apiClient.createRecipe(input)
      navigation.replace('Recipes')
    } catch (error) {
      showError('保存食谱失败', error)
    } finally {
      setLoading(false)
    }
  }

  const remove = async () => {
    if (!recipeId) return
    Alert.alert('删除食谱', '删除后无法恢复，确定要删除这个食谱吗？', [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: async () => {
          setLoading(true)
          try {
            await apiClient.deleteRecipe(recipeId)
            navigation.replace('Recipes')
          } catch (error) {
            showError('删除食谱失败', error)
          } finally {
            setLoading(false)
          }
        },
      },
    ])
  }

  if (!recipeId) {
    return (
      <View style={styles.recipeEditPage}>
        <View style={styles.recipeEditWash} />
        <ScrollView
          style={styles.recipeEditScroll}
          contentContainerStyle={[styles.recipeEditContent, { paddingBottom: Math.max(insets.bottom, 12) + 28 }]}
        >
          <View style={styles.recipeEditEmptyCard}>
            <Text style={styles.recipeEditEmptyIcon}>📝</Text>
            <Text style={styles.recipeEditEmptyTitle}>无法编辑食谱</Text>
            <Text style={styles.recipeEditEmptyDesc}>请从识别结果页保存食谱后再编辑</Text>
          </View>
        </ScrollView>
      </View>
    )
  }

  return (
    <View style={styles.recipeEditPage}>
      <View style={styles.recipeEditWash} />
      <ScrollView
        style={styles.recipeEditScroll}
        contentContainerStyle={[styles.recipeEditContent, { paddingBottom: Math.max(insets.bottom, 12) + 28 }]}
        keyboardShouldPersistTaps="handled"
        refreshControl={recipeId ? (
          <RefreshControl refreshing={loading} onRefresh={load} tintColor="#00bc7d" colors={['#00bc7d']} />
        ) : undefined}
      >
        <View style={styles.recipeEditCard}>
          <Text style={styles.recipeEditSectionTitle}>基本信息</Text>
          <RecipeEditField label="食谱名称" value={name} onChangeText={setName} placeholder="请输入食谱名称" editable={!loading} />
          <RecipeEditField
            label="描述"
            value={description}
            onChangeText={setDescription}
            placeholder="请输入食谱描述（可选）"
            multiline
            editable={!loading}
          />
          <View style={styles.recipeEditFormItem}>
            <Text style={styles.recipeEditLabel}>适合餐次</Text>
            <View style={styles.recipeMealOptions}>
              {mealOptions.map((meal) => {
                const active = mealType === meal
                return (
                  <Pressable
                    key={meal}
                    style={[styles.recipeMealOption, active && styles.recipeMealOptionActive]}
                    onPress={() => setMealType(meal)}
                    disabled={loading}
                  >
                    <Text style={[styles.recipeMealOptionText, active && styles.recipeMealOptionTextActive]}>{getMealTypeLabel(meal)}</Text>
                  </Pressable>
                )
              })}
            </View>
          </View>
        </View>

        <View style={styles.recipeEditCard}>
          <Text style={styles.recipeEditSectionTitle}>营养摘要</Text>
          <View style={styles.recipeSummaryGrid}>
            {summaryStats.map((stat) => (
              <View key={stat.label} style={styles.recipeSummaryItem}>
                <Text style={styles.recipeSummaryValue}>{stat.value}</Text>
                <Text style={styles.recipeSummaryLabel}>{stat.label}</Text>
              </View>
            ))}
          </View>
        </View>

        <View style={styles.recipeEditActionBar}>
          {recipeId ? (
            <Pressable style={styles.recipeDeleteButton} onPress={remove} disabled={loading}>
              <Text style={styles.recipeDeleteButtonText}>删除食谱</Text>
            </Pressable>
          ) : null}
          <Pressable style={[styles.recipeSaveButton, loading && styles.recipeSaveButtonDisabled]} onPress={save} disabled={loading}>
            {loading ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.recipeSaveButtonText}>保存</Text>}
          </Pressable>
        </View>
      </ScrollView>
      {loading && recipeId ? (
        <View style={styles.recipeEditLoadingOverlay} pointerEvents="none">
          <ActivityIndicator size="small" color="#00bc7d" />
        </View>
      ) : null}
    </View>
  )
}

function RecipeEditField({
  label,
  value,
  onChangeText,
  placeholder,
  multiline,
  keyboardType,
  editable = true,
}: {
  label: string
  value: string
  onChangeText: (value: string) => void
  placeholder?: string
  multiline?: boolean
  keyboardType?: 'default' | 'decimal-pad'
  editable?: boolean
}) {
  return (
    <View style={styles.recipeEditFormItem}>
      <Text style={styles.recipeEditLabel}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor="#9ca3af"
        multiline={multiline}
        keyboardType={keyboardType}
        editable={editable}
        style={[styles.recipeEditInput, multiline && styles.recipeEditTextarea]}
        textAlignVertical={multiline ? 'top' : 'center'}
      />
    </View>
  )
}

export function PetHomeScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  const [summary, setSummary] = useState<PetSummary | null>(null)
  const [membership, setMembership] = useState<MembershipStatus | null>(null)
  const [homePetHidden, setHomePetHiddenState] = useState(false)
  const [loading, setLoading] = useState(false)
  const [claiming, setClaiming] = useState(false)
  const [rerolling, setRerolling] = useState(false)
  const [selectingCandidateId, setSelectingCandidateId] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [petData, memberData, hidden] = await Promise.all([
        apiClient.getPetSummary(todayKey()),
        apiClient.getMyMembership().catch(() => null),
        getHomePetHidden(),
      ])
      setSummary(petData)
      setMembership(memberData)
      setHomePetHiddenState(hidden)
    } catch (error) {
      showError('获取成长伙伴失败', error)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const claim = async () => {
    if (!summary?.event?.id) return
    setClaiming(true)
    try {
      const result = await apiClient.claimPetEvent(summary.event.id)
      // 与小程序保持一致：领取接口成功后立即把当前事件标记为已领取，
      // 不等待二次 GET 才隐藏按钮/奖励图标。
      setSummary((current) => current ? {
        ...current,
        pet: result.pet,
        event: {
          ...result.event,
          can_claim: false,
          is_claimed: true,
        },
      } : current)
      const earnedCreditsBalance = result.earned_credits_balance
      if (typeof earnedCreditsBalance === 'number') {
        setMembership((current) => current ? {
          ...current,
          earned_credits_balance: earnedCreditsBalance,
          total_credits_available: (current.system_credits_remaining ?? 0) + earnedCreditsBalance,
          daily_credits_remaining: (current.system_credits_remaining ?? 0) + earnedCreditsBalance,
        } : current)
      }
      Alert.alert('已领取', `经验 +${result.exp_awarded || 0}，积分 +${result.credits_awarded || 0}`)
      await load()
    } catch (error) {
      showError('领取失败', error)
    } finally {
      setClaiming(false)
    }
  }

  const selectCandidate = async (candidate: PetAppearanceCandidate) => {
    if (!candidate?.id || selectingCandidateId) return
    setSelectingCandidateId(candidate.id)
    try {
      await apiClient.selectPetAppearance(candidate.id)
      await load()
      Alert.alert('已选择', '成长伙伴外观已更新。')
    } catch (error) {
      showError('选择外观失败', error)
    } finally {
      setSelectingCandidateId('')
    }
  }

  const runReroll = async () => {
    setRerolling(true)
    try {
      await apiClient.rerollPetAppearance()
      await load()
      Alert.alert('外观已更新', '伙伴的颜色、体型、花纹和配饰已刷新。')
    } catch (error) {
      showError('随机换外观失败', error)
    } finally {
      setRerolling(false)
    }
  }

  const confirmReroll = () => {
    if (!summary?.pet || rerolling) return
    if (petEarnedCredits(membership) < 5) {
      Alert.alert('奖励积分不足', '随机刷新外观需要 5 奖励积分。')
      return
    }
    Alert.alert(
      '随机换外观',
      '会消耗 5 奖励积分，伙伴名字和等级不变，只随机刷新颜色、体型、花纹和配饰。',
      [
        { text: '先看看', style: 'cancel' },
        { text: '立即更换', onPress: () => void runReroll() },
      ],
    )
  }

  const toggleHomePet = async () => {
    const next = !homePetHidden
    setHomePetHiddenState(next)
    await setHomePetHidden(next)
    Alert.alert(
      next ? '首页悬浮伙伴已隐藏' : '首页悬浮伙伴已显示',
      next ? '首页不再显示可拖动的成长伙伴，成长数据仍会继续更新。' : '首页会重新显示可拖动的成长伙伴。',
    )
  }

  const pet = summary?.pet
  const petMood = petMoodLabel(summary?.status.mood)
  const petState = petStateLabel(summary?.status.state)
  const petMoodStateText = petMood.endsWith(petState) ? petMood : `${petMood} · ${petState}`
  const nextLevelGap = Math.max((pet?.next_level_exp ?? 0) - (pet?.level_exp ?? 0), 0)
  const petEvent = summary?.event && !summary.event.is_claimed ? summary.event : null
  const candidates = pet?.selection_candidates || []
  const showCandidates = candidates.length > 0 && Boolean(pet?.needs_selection || pet?.free_profile_rematch_available)
  return (
    <View style={styles.petHomePage}>
      <ScrollView
        style={styles.petHomeScroll}
        contentContainerStyle={styles.petHomeContent}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.brand} colors={[colors.brand]} />}
      >
        <View style={styles.petHomeHero}>
          <PetAvatar pet={pet} size="large" mood={summary?.status.mood} state={summary?.status.state} />
          <View style={styles.petHomeHeroCopy}>
            <Text style={styles.petHomeName}>{pet?.name || '健康伙伴'}</Text>
            <View style={styles.petHomeMetaRow}>
              <Text style={styles.petHomeChip}>Lv.{pet?.level || 1}</Text>
              <Text style={styles.petHomeChipMuted}>{petPersonalityLabel(pet?.personality)}</Text>
              <Text style={styles.petHomeChipMuted}>{petArchetypeLabel(pet?.archetype)}</Text>
              <Text style={styles.petHomeChipMuted}>{petMoodStateText}</Text>
            </View>
            <Text style={styles.petHomeMessage}>{summary?.status.message || '它正在安静陪你记录每一天。'}</Text>
          </View>
        </View>

        <View style={[styles.petHomeCard, styles.petHomeChatCard]}>
          <View style={styles.petHomeCardHead}>
            <Text style={styles.petHomeCardTitle}>问问{pet?.name || '伙伴'}</Text>
            <Text style={styles.petHomeCardSide}>文本分析 demo</Text>
          </View>
          <Text style={styles.petHomeBodyText}>让它读取你已保存的饮食文字和营养数据，聊聊训练状态、减脂卡住、碳水和蛋白质分布。不读取图片。</Text>
          <Pressable style={[styles.petHomeInlineAction, styles.petHomeInlineActionPrimary]} onPress={() => navigation.navigate('PetChat')}>
            <Text style={styles.petHomeInlineActionText}>去问问它</Text>
          </Pressable>
        </View>

        <View style={styles.petHomeCard}>
          <View style={styles.petHomeCardHead}>
            <Text style={styles.petHomeCardTitle}>为什么是它</Text>
            <Text style={styles.petHomeCardSide}>{petArchetypeLabel(pet?.archetype)}</Text>
          </View>
          {(pet?.match_reasons?.length ? pet.match_reasons : ['它会根据你的健康目标、活动水平和记录习惯生成，不按性别粗暴分配。']).map((reason) => (
            <View key={reason} style={styles.petHomeReasonItem}>
              <Text style={styles.petHomeReasonDot}>•</Text>
              <Text style={styles.petHomeReasonText}>{reason}</Text>
            </View>
          ))}
          {(pet?.growth_unlocks || []).length ? (
            <View style={styles.petHomeUnlockRow}>
              {(pet?.growth_unlocks || []).map((unlock) => <Text key={unlock} style={styles.petHomeUnlockChip}>{growthUnlockLabel(unlock)}</Text>)}
            </View>
          ) : null}
        </View>

        {showCandidates ? (
          <View style={styles.petHomeCard}>
            <View style={styles.petHomeCardHead}>
              <Text style={styles.petHomeCardTitle}>{pet?.needs_selection ? '三选一伙伴' : '免费重新匹配'}</Text>
              <Text style={styles.petHomeCardSide}>不消耗积分</Text>
            </View>
            <Text style={styles.petHomeBodyText}>系统先默认使用候选，你可以在这里挑一个真正顺眼的伙伴。</Text>
            <View style={styles.petHomeCandidateGrid}>
              {candidates.map((candidate) => {
                const isCurrent = candidate.pet_seed === pet?.pet_seed
                const disabled = isCurrent || Boolean(selectingCandidateId)
                return (
                  <Pressable key={candidate.id} disabled={disabled} style={[styles.petHomeCandidateCard, isCurrent && styles.petHomeCandidateCardActive]} onPress={() => selectCandidate(candidate)}>
                    <PetAvatar pet={candidate} size="small" />
                    <Text style={styles.petHomeCandidateName} numberOfLines={1}>{candidate.name}</Text>
                    <Text style={styles.petHomeCandidateMeta} numberOfLines={2}>
                      {candidateStyleLabel(candidate.style)}{typeof candidate.score === 'number' ? ` · ${candidate.score}` : ''}
                    </Text>
                    {selectingCandidateId === candidate.id ? (
                      <ActivityIndicator color="#2f7f62" size="small" />
                    ) : (
                      <Text style={styles.petHomeCandidateAction}>{isCurrent ? '当前' : '选择'}</Text>
                    )}
                  </Pressable>
                )
              })}
            </View>
          </View>
        ) : null}

        <View style={styles.petHomeCard}>
          <View style={styles.petHomeCardHead}>
            <Text style={styles.petHomeCardTitle}>成长进度</Text>
            <Text style={styles.petHomeCardSide}>{pet ? `${pet.level_exp || 0}/${pet.next_level_exp || 100}` : '--'}</Text>
          </View>
          <View style={styles.petHomeProgressTrack}>
            <View style={[styles.petHomeProgressFill, { width: `${Math.max(0, Math.min(100, pet?.level_progress || 0))}%` }]} />
          </View>
          <View style={styles.petHomeMetricGrid}>
            <PetHomeMetric label="总经验" value={`${pet?.experience || 0}`} />
            <PetHomeMetric label="距升级" value={`${nextLevelGap}`} />
            <PetHomeMetric label="陪伴天数" value={`${pet?.total_events || 0}`} />
          </View>
        </View>

        <View style={styles.petHomeCard}>
          <View style={styles.petHomeCardHead}>
            <Text style={styles.petHomeCardTitle}>今日状态</Text>
            <Text style={styles.petHomeCardSide}>习惯分 {summary?.today.habit_score || 0}</Text>
          </View>
          <View style={styles.petHomeScoreGrid}>
            <PetHomeMetric label="今日经验" value={`+${summary?.today.exp_gained || 0}`} />
            <PetHomeMetric label="奖励积分" value={`${petEarnedCredits(membership)}`} />
            <PetHomeMetric label="总可用积分" value={`${petTotalCredits(membership)}`} />
          </View>
          <Text style={styles.petHomeTask}>{summary?.status.task_text || '继续保持记录，它会慢慢长大。'}</Text>
        </View>

        <View style={styles.petHomeCard}>
          <View style={styles.petHomeCardHead}>
            <Text style={styles.petHomeCardTitle}>离线小惊喜</Text>
            <Text style={styles.petHomeCardSide}>{petEvent ? '未领取' : '已查看'}</Text>
          </View>
          <Text style={styles.petHomeEventTitle}>{petEvent?.title || '今天还没有新的离线惊喜'}</Text>
          <Text style={styles.petHomeBodyText}>{petEvent?.message || '等你下一次回来时，它会带着整理好的复盘和一点小奖励出现。'}</Text>
          {petEvent?.can_claim ? (
            <Pressable style={[styles.petHomeInlineAction, styles.petHomeInlineActionPrimary]} disabled={claiming} onPress={claim}>
              {claiming ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.petHomeInlineActionText}>领取奖励</Text>}
            </Pressable>
          ) : null}
        </View>

        <View style={styles.petHomeCard}>
          <View style={styles.petHomeCardHead}>
            <Text style={styles.petHomeCardTitle}>外观换装</Text>
            <Text style={styles.petHomeCardSide}>统一角色体系</Text>
          </View>
          <View style={styles.petHomeActionList}>
            <Pressable style={styles.petHomeActionItem} onPress={toggleHomePet}>
              <View style={styles.flex}>
                <Text style={styles.petHomeActionTitle}>首页悬浮宠物</Text>
                <Text style={styles.petHomeActionDesc}>{homePetHidden ? '当前首页不显示宠物，数据和成长仍会保留。' : '当前首页会显示可拖动的小宠物。'}</Text>
              </View>
              <View style={styles.petHomeActionSide}>
                <Text style={[styles.petHomeActionStatus, homePetHidden && styles.petHomeActionStatusMuted]}>{homePetHidden ? '已隐藏' : '显示中'}</Text>
                <View style={[styles.petHomeToggle, !homePetHidden && styles.petHomeToggleActive]}>
                  <View style={[styles.petHomeToggleKnob, !homePetHidden && styles.petHomeToggleKnobActive]} />
                </View>
              </View>
            </Pressable>
            <Pressable style={styles.petHomeActionItem} disabled={rerolling} onPress={confirmReroll}>
              <View style={styles.flex}>
                <Text style={styles.petHomeActionTitle}>随机换外观</Text>
                <Text style={styles.petHomeActionDesc}>保留名字和等级，随机刷新体型、花纹与配饰。</Text>
              </View>
              <View style={styles.petHomeActionSide}>
                {rerolling ? <ActivityIndicator color={colors.brand} size="small" /> : <Text style={styles.petHomeActionCost}>5 积分</Text>}
              </View>
            </Pressable>
            <View style={styles.petHomeActionItem}>
              <View style={styles.flex}>
                <Text style={styles.petHomeActionTitle}>外观试验箱</Text>
                <Text style={styles.petHomeActionDesc}>批量查看颜色、体型、动物特征、花纹与配饰组合。</Text>
              </View>
              <Text style={[styles.petHomeActionCost, styles.petHomeActionStatusMuted]}>即将开放</Text>
            </View>
          </View>
        </View>
      </ScrollView>
    </View>
  )
}

type PetLabVariant = PetAppearanceCandidate & {
  displayStyle: 'pretty' | 'quirky' | 'risky'
  sourceLabel: string
  strengths: string[]
  riskReasons: string[]
  animal: PetAnimal
  mood: string
}

const PET_LAB_COLOR_LABELS: Record<string, string> = {
  mint: '薄荷',
  berry: '莓果',
  sunny: '暖阳',
  aqua: '湖蓝',
  grape: '葡萄',
  peach: '蜜桃',
  cream: '奶油',
  matcha: '抹茶',
}

const PET_LAB_ANIMAL_LABELS: Record<PetAnimal, string> = {
  cat: '猫感',
  bunny: '兔感',
  bear: '熊感',
  fox: '狐感',
  hamster: '仓鼠感',
}

const PET_LAB_MOOD_LABELS: Record<string, string> = {
  calm: '平静',
  happy: '开心',
  sleepy: '困困',
  surprised: '惊喜',
}

const PET_LAB_MOODS = ['calm', 'happy', 'sleepy', 'surprised'] as const

const PET_LAB_ARCHETYPE_KEYS = ['steady_caregiver', 'energetic_buddy', 'gentle_healer', 'protein_guardian', 'light_lifestyle'] as const

const PET_LAB_STYLE_OPTIONS = [
  { value: 'all', label: '全部' },
  { value: 'pretty', label: '高亲和' },
  { value: 'quirky', label: '有特色' },
  { value: 'risky', label: '需收敛' },
]

const PET_LAB_ARCHETYPE_OPTIONS = [
  { value: 'all', label: '全部' },
  { value: 'steady_caregiver', label: '稳定陪伴' },
  { value: 'energetic_buddy', label: '元气伙伴' },
  { value: 'gentle_healer', label: '温柔守护' },
  { value: 'protein_guardian', label: '蛋白守卫' },
  { value: 'light_lifestyle', label: '轻盈陪伴' },
]

const PET_LAB_ARCHETYPE_NOTES: Record<string, string> = {
  steady_caregiver: '偏好薄荷、湖蓝、奶油色，圆团或蓬松体型，自然配饰和温柔性格。',
  energetic_buddy: '偏好暖阳、水蓝、薄荷色，蓬松或豆豆体型，嫩芽、星星和元气文案。',
  gentle_healer: '偏好奶油、蜜桃、薄荷色，圆润体型，叶片、光环和温柔守护感。',
  protein_guardian: '偏好抹茶、水蓝、暖阳色，蓬松或圆团体型，围巾、嫩芽和认真气质。',
  light_lifestyle: '偏好薄荷、奶油、蜜桃色，豆豆或圆团体型，叶片、嫩芽和轻盈文案。',
}

function petColorLabel(color?: string) {
  return PET_LAB_COLOR_LABELS[color || ''] || color || '默认'
}

function petAnimalLabel(animal?: string) {
  return PET_LAB_ANIMAL_LABELS[animal as PetAnimal] || animal || '动物特征'
}

function petLabMoodLabel(mood?: string) {
  return PET_LAB_MOOD_LABELS[mood || ''] || mood || '平静'
}

function petLabStyleLabel(style?: string) {
  if (style === 'pretty') return '高亲和'
  if (style === 'quirky') return '有特色'
  if (style === 'risky') return '需收敛'
  return '稳定可用'
}

function petLabStyleForScore(score?: number): PetLabVariant['displayStyle'] {
  if ((score || 0) >= 88) return 'pretty'
  if ((score || 0) >= 68) return 'quirky'
  return 'risky'
}

function makePetLabVariant(
  source: Partial<PetAppearanceCandidate> & { id: string; name: string; pet_seed: string },
  fallbackIndex: number,
): PetLabVariant {
  const score = typeof source.score === 'number' ? source.score : 72 + ((fallbackIndex * 7) % 24)
  const displayStyle = petLabStyleForScore(score)
  const shape = source.shape || PET_SHAPES[fallbackIndex % PET_SHAPES.length]
  const pattern = source.pattern || PET_PATTERNS[fallbackIndex % PET_PATTERNS.length]
  const accessory = source.accessory || PET_ACCESSORIES[fallbackIndex % PET_ACCESSORIES.length]
  const visual = derivePetAppearance({
    pet_seed: source.pet_seed,
    name: source.name,
    color: source.color,
    shape,
    pattern,
    accessory,
  })
  const mood = PET_LAB_MOODS[stableHash(`${source.pet_seed}:${source.name}:mood`) % PET_LAB_MOODS.length]
  const strengths = source.match_reasons?.slice(0, 2) || [
    `${petColorLabel(source.color)}色更贴近当前伙伴气质`,
    `${petShapeLabel(shape)}和${petAnimalLabel(visual.animal)}组合稳定`,
  ]
  const riskReasons = displayStyle === 'risky'
    ? ['颜色或配饰需要收敛，避免太刺眼']
    : []

  return {
    id: source.id,
    pet_seed: source.pet_seed,
    name: source.name,
    color: source.color || PET_COLORS[fallbackIndex % PET_COLORS.length],
    shape,
    pattern,
    accessory,
    personality: source.personality || 'gentle',
    archetype: source.archetype,
    style: source.style,
    score,
    match_reasons: source.match_reasons,
    displayStyle,
    sourceLabel: petLabStyleLabel(displayStyle),
    strengths,
    riskReasons,
    animal: visual.animal,
    mood,
  }
}

function buildMobilePetLabVariants(summary: PetSummary | null): PetLabVariant[] {
  const pet = summary?.pet
  const candidates = pet?.selection_candidates || []
  const current = pet ? makePetLabVariant({
    id: 'current',
    pet_seed: pet.pet_seed,
    name: pet.name || '当前伙伴',
    color: pet.color,
    shape: pet.shape,
    pattern: pet.pattern,
    accessory: pet.accessory,
    personality: pet.personality,
    archetype: pet.archetype,
    score: 90,
    match_reasons: pet.match_reasons,
  }, 0) : null

  const generated = PET_COLORS.flatMap((color, colorIndex) => PET_SHAPES.map((shape, shapeIndex) => {
    const index = colorIndex * PET_SHAPES.length + shapeIndex
    const pattern = PET_PATTERNS[(index + 1) % PET_PATTERNS.length]
    const accessory = PET_ACCESSORIES[(index + 2) % PET_ACCESSORIES.length]
    return makePetLabVariant({
      id: `sample-${color}-${shape}-${index}`,
      pet_seed: `${pet?.pet_seed || 'guest'}-${color}-${shape}-${index}`,
      name: `${petColorLabel(color)}${petShapeLabel(shape)}`,
      color,
      shape,
      pattern,
      accessory,
      personality: ['gentle', 'energetic', 'focused', 'snacky', 'sporty'][index % 5],
      archetype: PET_LAB_ARCHETYPE_KEYS[index % PET_LAB_ARCHETYPE_KEYS.length],
      score: 62 + ((index * 7) % 35),
      match_reasons: [
        `${petColorLabel(color)}色让外观更有辨识度`,
        `${petPatternLabel(pattern)}适合做样本对照`,
      ],
    }, index + 1)
  }))

  const backend = candidates.map((candidate, index) => makePetLabVariant(candidate, index + 10))
  const merged = [current, ...backend, ...generated].filter(Boolean) as PetLabVariant[]
  const seen = new Set<string>()
  return merged.filter((item) => {
    const key = `${item.color}-${item.shape}-${item.animal}-${item.pattern}-${item.accessory}-${item.name}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function petLabSeedIndex(seed: string | undefined, suffix: string, size: number) {
  return stableHash(`${seed || 'guest'}:${suffix}`) % size
}

function petLabArchetypeScore(variant: PetLabVariant, archetype: string) {
  if (archetype === 'all') return 0
  if (variant.archetype === archetype) return 8
  return stableHash(`${variant.id}:${archetype}`) % 7
}

function petLabSampleCardToneStyle(style: PetLabVariant['displayStyle']) {
  if (style === 'pretty') return styles.petLabSampleCard_pretty
  if (style === 'quirky') return styles.petLabSampleCard_quirky
  return styles.petLabSampleCard_risky
}

function petLabCardToneStyle(style: PetLabVariant['displayStyle']) {
  if (style === 'pretty') return styles.petLabCard_pretty
  if (style === 'quirky') return styles.petLabCard_quirky
  return styles.petLabCard_risky
}

export function PetLabScreen() {
  const [summary, setSummary] = useState<PetSummary | null>(null)
  const [membership, setMembership] = useState<MembershipStatus | null>(null)
  const [loading, setLoading] = useState(false)
  const [rerolling, setRerolling] = useState(false)
  const [selectingCandidateId, setSelectingCandidateId] = useState('')
  const [styleFilter, setStyleFilter] = useState('all')
  const [archetypeFilter, setArchetypeFilter] = useState('all')
  const [colorFilter, setColorFilter] = useState('all')
  const [shapeFilter, setShapeFilter] = useState('all')
  const [animalFilter, setAnimalFilter] = useState('all')
  const [patternFilter, setPatternFilter] = useState('all')
  const [accessoryFilter, setAccessoryFilter] = useState('all')
  const [visibleCount, setVisibleCount] = useState(80)
  const [selected, setSelected] = useState<PetLabVariant | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [petData, memberData] = await Promise.all([
        apiClient.getPetSummary(todayKey()),
        apiClient.getMyMembership().catch(() => null),
      ])
      setSummary(petData)
      setMembership(memberData)
    } catch (error) {
      showError('获取外观候选失败', error)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const select = async (candidate: PetAppearanceCandidate) => {
    if (!candidate?.id || selectingCandidateId) return
    setSelectingCandidateId(candidate.id)
    try {
      await apiClient.selectPetAppearance(candidate.id)
      await load()
      Alert.alert('已选择', '外观已更新')
    } catch (error) {
      showError('选择失败', error)
    } finally {
      setSelectingCandidateId('')
    }
  }

  const runReroll = async () => {
    setRerolling(true)
    try {
      await apiClient.rerollPetAppearance()
      await load()
      Alert.alert('已刷新', '新的外观已生成')
    } catch (error) {
      showError('刷新外观失败', error)
    } finally {
      setRerolling(false)
    }
  }

  const confirmReroll = () => {
    if (petEarnedCredits(membership) < 5) {
      Alert.alert('奖励积分不足', '刷新外观需要 5 奖励积分。')
      return
    }
    Alert.alert(
      '刷新外观',
      '会消耗 5 奖励积分，伙伴名字和等级不变，只重新生成外观。',
      [
        { text: '先看看', style: 'cancel' },
        { text: '立即刷新', onPress: () => void runReroll() },
      ],
    )
  }

  const candidates = summary?.pet.selection_candidates || []
  const labVariants = useMemo(() => buildMobilePetLabVariants(summary), [summary])
  const filteredVariants = useMemo(() => labVariants.filter((variant) => {
    if (styleFilter !== 'all' && variant.displayStyle !== styleFilter) return false
    if (archetypeFilter !== 'all' && petLabArchetypeScore(variant, archetypeFilter) < 6) return false
    if (colorFilter !== 'all' && variant.color !== colorFilter) return false
    if (shapeFilter !== 'all' && variant.shape !== shapeFilter) return false
    if (animalFilter !== 'all' && variant.animal !== animalFilter) return false
    if (patternFilter !== 'all' && variant.pattern !== patternFilter) return false
    if (accessoryFilter !== 'all' && variant.accessory !== accessoryFilter) return false
    return true
  }), [accessoryFilter, animalFilter, archetypeFilter, colorFilter, labVariants, patternFilter, shapeFilter, styleFilter])
  const shownVariants = filteredVariants.slice(0, visibleCount)
  const topSamples = labVariants.filter((variant) => variant.displayStyle === 'pretty').slice(0, 8)
  const quirkySamples = labVariants.filter((variant) => variant.displayStyle === 'quirky' && (variant.score || 0) >= 72).slice(0, 8)
  const riskySamples = labVariants.filter((variant) => variant.displayStyle === 'risky').slice(0, 8)
  const currentPet = summary?.pet
  const currentAnimal = currentPet ? derivePetAppearance(currentPet).animal : undefined
  const availableCredits = petEarnedCredits(membership)
  const totalCount = PET_COLORS.length * PET_SHAPES.length * PET_ANIMALS.length * PET_PATTERNS.length * PET_ACCESSORIES.length
  const seed = currentPet?.pet_seed || 'guest'
  const resetFilter = (setter: (value: string) => void) => (value: string) => {
    setter(value)
    setVisibleCount(80)
  }

  return (
    <View style={styles.petLabPage}>
      <ScrollView
        style={styles.petLabScroll}
        contentContainerStyle={styles.petLabContent}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.brand} />}
      >
        <View style={styles.petLabHero}>
          <Text style={styles.petLabTitle}>宠物外观试验箱</Text>
          <Text style={styles.petLabSubtitle}>当前基础组合 {totalCount} 种。这里把生成规则、参数和风险组合摊开，方便我们把“有特色”和“真丑”分开。</Text>
          <View style={styles.petLabStatRow}>
            <PetLabStat value={String(PET_COLORS.length)} label="颜色" />
            <PetLabStat value={String(PET_SHAPES.length)} label="体型" />
            <PetLabStat value={String(PET_ANIMALS.length)} label="动物特征" />
            <PetLabStat value={String(PET_PATTERNS.length * PET_ACCESSORIES.length)} label="纹样配饰" />
          </View>
        </View>

        <View style={styles.petLabPanel}>
          <View style={styles.petLabCurrentRow}>
            <PetAvatar pet={currentPet} size="large" mood={summary?.status.mood} state={summary?.status.state} />
            <View style={styles.petLabCurrentCopy}>
              <Text style={styles.petLabPanelTitle}>当前形象</Text>
              <Text style={styles.petLabCurrentName}>{currentPet?.name || '--'}</Text>
              <Text style={styles.petLabCopy}>{petColorLabel(currentPet?.color)} / {petShapeLabel(currentPet?.shape)} / {petAnimalLabel(currentAnimal)}</Text>
              <Text style={styles.petLabCopy}>{petPatternLabel(currentPet?.pattern)} / {petAccessoryLabel(currentPet?.accessory)} / {petArchetypeLabel(currentPet?.archetype)}</Text>
              <View style={styles.petLabTagRow}>
                <Text style={styles.petLabTag}>{summary?.pet.free_profile_rematch_available ? '档案重配可用' : '已使用档案重配'}</Text>
                <Text style={styles.petLabTag}>奖励积分 {availableCredits}</Text>
                <Text style={styles.petLabTag}>总可用 {petTotalCredits(membership)}</Text>
              </View>
            </View>
          </View>
          <Text style={styles.petLabCopy}>{currentPet?.match_reasons?.join('、') || '完善健康档案后会生成更明确的匹配原因。'}</Text>
          <Pressable style={styles.petLabRerollButton} disabled={rerolling} onPress={confirmReroll}>
            {rerolling ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.petLabRerollText}>消耗 5 积分刷新</Text>}
          </Pressable>
        </View>

        <View style={styles.petLabPanel}>
          <Text style={styles.petLabPanelTitle}>生成原理</Text>
          <Text style={styles.petLabCopy}>新规则先用健康档案生成画像倾向，再用权重和审美护栏生成候选。后端仍用 FNV-1a hash 保持稳定，首页和详情页再用同一个 seed 派生动物特征。</Text>
          <View style={styles.petLabFormula}>
            <Text style={styles.petLabCode}>FNV(seed + color) % {PET_COLORS.length} = {String(petLabSeedIndex(seed, 'color', PET_COLORS.length))}</Text>
            <Text style={styles.petLabCode}>FNV(seed + shape) % {PET_SHAPES.length} = {String(petLabSeedIndex(seed, 'shape', PET_SHAPES.length))}</Text>
            <Text style={styles.petLabCode}>FNV(seed + pattern) % {PET_PATTERNS.length} = {String(petLabSeedIndex(seed, 'pattern', PET_PATTERNS.length))}</Text>
            <Text style={styles.petLabCode}>FNV(seed + accessory) % {PET_ACCESSORIES.length} = {String(petLabSeedIndex(seed, 'accessory', PET_ACCESSORIES.length))}</Text>
            <Text style={styles.petLabCode}>前端 hash(seed + animal) % {PET_ANIMALS.length} = {String(petLabSeedIndex(seed, 'animal', PET_ANIMALS.length))}</Text>
          </View>
        </View>

        <View style={styles.petLabPanel}>
          <Text style={styles.petLabPanelTitle}>画像倾向</Text>
          <Text style={styles.petLabCopy}>画像只改变外观权重和文案倾向，不按性别直接分颜色或动物。选择下面任意一种，可以看到它更容易推高哪些组合。</Text>
          <PetLabFilterRow title="画像" value={archetypeFilter} options={PET_LAB_ARCHETYPE_OPTIONS} onChange={resetFilter(setArchetypeFilter)} />
          {archetypeFilter !== 'all' ? (
            <View style={styles.petLabArchetypeNote}>
              <Text style={styles.petLabArchetypeNoteText}>{PET_LAB_ARCHETYPE_NOTES[archetypeFilter]}</Text>
            </View>
          ) : null}
        </View>

        <View style={styles.petLabPanel}>
          <Text style={styles.petLabPanelTitle}>推荐样本</Text>
          <Text style={styles.petLabCopy}>这里不再只取最高分，而是强制拉开颜色和动物特征，避免最后上线全长一个样。</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.petLabSampleScroll} contentContainerStyle={styles.petLabSampleRow}>
            {(topSamples.length ? topSamples : labVariants.slice(0, 8)).map((variant) => (
              <Pressable key={variant.id} style={[styles.petLabSampleCard, petLabSampleCardToneStyle(variant.displayStyle)]} onPress={() => setSelected(variant)}>
                <PetAvatar pet={variant} size="small" mood={variant.mood} />
                <Text style={styles.petLabSampleTitle} numberOfLines={1}>{variant.sourceLabel}</Text>
                <Text style={styles.petLabSampleSub} numberOfLines={1}>{variant.score} · {petAnimalLabel(variant.animal)}</Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>

        <View style={styles.petLabPanel}>
          <Text style={styles.petLabPanelTitle}>特色样本</Text>
          <Text style={styles.petLabCopy}>这些可以保留“丑萌/抽象”的个性，但分数必须过审美护栏，不能像脏、伤、病。</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.petLabSampleScroll} contentContainerStyle={styles.petLabSampleRow}>
            {(quirkySamples.length ? quirkySamples : labVariants.slice(4, 12)).map((variant) => (
              <Pressable key={`quirky-${variant.id}`} style={[styles.petLabSampleCard, petLabSampleCardToneStyle(variant.displayStyle)]} onPress={() => setSelected(variant)}>
                <PetAvatar pet={variant} size="small" mood={variant.mood} />
                <Text style={styles.petLabSampleTitle} numberOfLines={1}>{variant.sourceLabel}</Text>
                <Text style={styles.petLabSampleSub} numberOfLines={1}>{variant.score} · {petAnimalLabel(variant.animal)}</Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>

        <View style={styles.petLabPanel}>
          <Text style={styles.petLabPanelTitle}>风险样本</Text>
          <Text style={styles.petLabCopy}>这些不是要删除多样性，而是提醒哪些组合容易显脏、显乱或太尖锐。</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.petLabSampleScroll} contentContainerStyle={styles.petLabSampleRow}>
            {(riskySamples.length ? riskySamples : labVariants.slice(-4)).map((variant) => (
              <Pressable key={`risk-${variant.id}`} style={[styles.petLabSampleCard, styles.petLabSampleCard_risky]} onPress={() => setSelected(variant)}>
                <PetAvatar pet={variant} size="small" mood={variant.mood} />
                <Text style={styles.petLabSampleTitle} numberOfLines={1}>{variant.sourceLabel}</Text>
                <Text style={styles.petLabSampleSub} numberOfLines={1}>{variant.riskReasons[0] || variant.sourceLabel}</Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>

        <View style={styles.petLabPanel}>
          <Text style={styles.petLabPanelTitle}>筛选组合</Text>
          <PetLabFilterRow title="质量" value={styleFilter} options={PET_LAB_STYLE_OPTIONS} onChange={resetFilter(setStyleFilter)} />
          <PetLabFilterRow title="画像" value={archetypeFilter} options={PET_LAB_ARCHETYPE_OPTIONS} onChange={resetFilter(setArchetypeFilter)} />
          <PetLabFilterRow title="颜色" value={colorFilter} options={[{ value: 'all', label: '全部' }, ...PET_COLORS.map((value) => ({ value, label: petColorLabel(value) }))]} onChange={resetFilter(setColorFilter)} />
          <PetLabFilterRow title="体型" value={shapeFilter} options={[{ value: 'all', label: '全部' }, ...PET_SHAPES.map((value) => ({ value, label: petShapeLabel(value) }))]} onChange={resetFilter(setShapeFilter)} />
          <PetLabFilterRow title="动物" value={animalFilter} options={[{ value: 'all', label: '全部' }, ...PET_ANIMALS.map((value) => ({ value, label: petAnimalLabel(value) }))]} onChange={resetFilter(setAnimalFilter)} />
          <PetLabFilterRow title="花纹" value={patternFilter} options={[{ value: 'all', label: '全部' }, ...PET_PATTERNS.map((value) => ({ value, label: petPatternLabel(value) }))]} onChange={resetFilter(setPatternFilter)} />
          <PetLabFilterRow title="配饰" value={accessoryFilter} options={[{ value: 'all', label: '全部' }, ...PET_ACCESSORIES.map((value) => ({ value, label: petAccessoryLabel(value) }))]} onChange={resetFilter(setAccessoryFilter)} />
        </View>

        <View style={styles.petLabGridHead}>
          <Text style={styles.petLabGridTitle}>当前筛选 {filteredVariants.length} 种</Text>
          <Text style={styles.petLabGridSide}>已展示 {shownVariants.length}</Text>
        </View>
        <View style={styles.petLabGrid}>
          {shownVariants.map((variant) => (
            <Pressable key={variant.id} style={[styles.petLabCard, petLabCardToneStyle(variant.displayStyle)]} onPress={() => setSelected(variant)}>
              <PetAvatar pet={variant} size="medium" mood={variant.mood} />
              <Text style={styles.petLabCardTitle} numberOfLines={1}>{variant.sourceLabel} · {variant.score}</Text>
              <Text style={styles.petLabCardBadge}>{variant.sourceLabel}</Text>
              <Text style={styles.petLabCardDesc} numberOfLines={1}>{petColorLabel(variant.color)} / {petShapeLabel(variant.shape)} / {petAnimalLabel(variant.animal)}</Text>
              <Text style={styles.petLabCardDesc} numberOfLines={1}>{petPatternLabel(variant.pattern)} / {petAccessoryLabel(variant.accessory)} / {petLabMoodLabel(variant.mood)}</Text>
              <Text style={[styles.petLabCardReason, variant.displayStyle === 'risky' && styles.petLabCardReasonWarn]} numberOfLines={2}>
                {archetypeFilter !== 'all' ? `${petArchetypeLabel(archetypeFilter)}匹配 ${petLabArchetypeScore(variant, archetypeFilter)}` : variant.riskReasons[0] || variant.strengths[0] || '组合稳定'}
              </Text>
              {candidates.some((candidate) => candidate.id === variant.id) ? (
                <Pressable style={styles.petLabSelectButton} disabled={Boolean(selectingCandidateId)} onPress={() => select(variant)}>
                  {selectingCandidateId === variant.id ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.petLabSelectText}>选择这个</Text>}
                </Pressable>
              ) : null}
            </Pressable>
          ))}
        </View>
        {shownVariants.length < filteredVariants.length ? (
          <Pressable style={styles.petLabLoadMore} onPress={() => setVisibleCount((prev) => prev + 80)}>
            <Text style={styles.petLabLoadMoreText}>继续加载 80 个</Text>
          </Pressable>
        ) : null}
      </ScrollView>

      <Modal visible={Boolean(selected)} transparent animationType="fade" onRequestClose={() => setSelected(null)}>
        <Pressable style={styles.petLabDetailMask} onPress={() => setSelected(null)}>
          <Pressable style={styles.petLabDetail} onPress={(event) => event.stopPropagation()}>
            {selected ? (
              <>
                <PetAvatar pet={selected} size="large" mood={selected.mood} />
                <Text style={styles.petLabDetailTitle}>{selected.name} · {selected.score}</Text>
                <Text style={styles.petLabDetailCopy}>组合 ID：{selected.id}</Text>
                <Text style={styles.petLabDetailCopy}>风格判断：{selected.sourceLabel}</Text>
                {archetypeFilter !== 'all' ? (
                  <Text style={styles.petLabDetailCopy}>当前画像匹配：{petArchetypeLabel(archetypeFilter)} · {petLabArchetypeScore(selected, archetypeFilter)}</Text>
                ) : null}
                <View style={styles.petLabDetailTags}>
                  <Text style={styles.petLabDetailTag}>{petColorLabel(selected.color)}</Text>
                  <Text style={styles.petLabDetailTag}>{petShapeLabel(selected.shape)}</Text>
                  <Text style={styles.petLabDetailTag}>{petAnimalLabel(selected.animal)}</Text>
                  <Text style={styles.petLabDetailTag}>{petPatternLabel(selected.pattern)}</Text>
                  <Text style={styles.petLabDetailTag}>{petAccessoryLabel(selected.accessory)}</Text>
                  <Text style={styles.petLabDetailTag}>{petLabMoodLabel(selected.mood)}</Text>
                </View>
                {[...selected.strengths, ...selected.riskReasons].map((item) => (
                  <Text key={item} style={[styles.petLabDetailReason, selected.riskReasons.includes(item) && styles.petLabDetailReasonWarn]}>{item}</Text>
                ))}
                <Text style={styles.petLabDetailClose}>点空白处关闭</Text>
              </>
            ) : null}
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  )
}

const AGREEMENT_SECTIONS = [
  {
    title: '一、协议的范围',
    paragraphs: [
      '欢迎使用 Food Link（食探）服务。本协议是你与服务运营方之间关于使用 Food Link App、小程序及相关健康管理服务所订立的协议。',
      '使用本服务前，请审慎阅读并充分理解各项条款；继续使用即表示你已理解并接受本协议。',
    ],
  },
  {
    title: '二、服务内容',
    paragraphs: [
      'Food Link 通过 AI 视觉识别、大语言模型、营养数据库和健康档案能力，提供饮食记录、营养估算、身体指标记录、运动记录、校园餐与公共食物库、圈子互动、会员积分等服务。',
      '识别结果、营养建议、PFC 分析、运动估算和健康提示仅用于日常记录和健康管理参考，不替代专业医学诊断、治疗建议或营养师的一对一处方。',
    ],
  },
  {
    title: '三、用户行为规范',
    paragraphs: [
      '你应保证上传的图片、文字、评论、公开食物、校园餐信息、私信等内容不违反法律法规，不侵犯第三方合法权益。',
      'Food Link 倡导健康、真实、友好的社区交流。禁止发布色情、暴力、欺诈、虚假营销、恶意攻击、诱导减肥或其他不适内容。发现违规后，我们可依法依规采取删除内容、限制功能、封禁账号等处理。',
    ],
  },
  {
    title: '四、知识产权',
    paragraphs: [
      'Food Link 中的文字、图片、界面设计、软件代码、商标、模型提示词、数据结构和服务标识等知识产权，归服务运营方或相关权利人所有。',
      '未经授权，你不得以复制、传播、改编、反向工程、商业抓取等方式使用 Food Link 的内容和服务能力。',
    ],
  },
  {
    title: '五、免责声明',
    paragraphs: [
      '由于图片质量、食物遮挡、描述不完整、网络状况、第三方服务、模型稳定性等因素，AI 识别和估算可能存在误差。',
      '因不可抗力、系统维护、网络故障、第三方服务中断、支付渠道限制等原因导致服务暂时不可用的，我们将在合理范围内修复和通知。',
    ],
  },
  {
    title: '六、会员与积分服务',
    paragraphs: [
      'Food Link 可能提供轻度版、标准版、进阶版等会员套餐，不同套餐对应不同每日系统积分额度、识别额度和高级能力，具体以会员中心展示为准。',
      '标准版及以上套餐可能包含精准模式等高级分析能力。系统积分通常按日发放并按规则刷新；邀请好友、分享等行为获得的奖励积分按活动规则计入累计余额。',
      '创始用户或早期付费用户礼遇、积分翻倍等权益，以账号内展示和活动规则为准。',
    ],
  },
  {
    title: '七、支付与订阅',
    paragraphs: [
      '会员套餐可按月卡、季卡、年卡或页面展示的其他周期购买。价格、优惠、补差、升级和续费规则以购买页和订单页实时展示为准。',
      '支付成功后，会员权益会写入账号；跨设备登录同一账号可继续使用。支付异常、重复扣款或订单未生效时，可通过关于与反馈入口提交问题。',
      '如提供自动续费服务，用户需主动选择并确认开通；服务名称、扣费周期、每期金额、预计续费时间和取消方式会在签约前说明中展示。',
    ],
  },
  {
    title: '八、奖励积分规则',
    paragraphs: [
      '邀请好友、每日分享、完成任务等奖励积分按当前活动规则发放；不同活动可能要求有效记录天数、注册时间或使用行为。',
      '运动记录、基础饮食记录、精准模式分析、AI 建议等功能可能消耗积分，具体消耗以页面提示和后端结算规则为准。',
      '我们保留根据业务发展调整积分获取、消耗和活动规则的权利，重大变化会在产品内公示。',
    ],
  },
  {
    title: '九、账号注销',
    paragraphs: [
      '你有权按产品提供的路径注销账号。注销后，本地缓存和登录状态会被清除，你将无法继续使用与该账号绑定的个性化服务。',
      '账号注销后，健康记录、饮食分析历史、社交关系、会员订阅和积分等数据将依据法律法规、隐私政策和必要的结算要求处理。',
      '如存在未完成订单、会员周期、积分兑换或争议处理，建议先处理完毕后再进行注销。',
    ],
  },
  {
    title: '十、协议变更',
    paragraphs: [
      '我们可能根据业务发展、法律法规或产品能力变化修订本协议。修订后的协议会在产品内以适当方式展示。',
      '如你不同意修订内容，可以停止使用服务并按规则注销账号；继续使用视为接受修订后的协议。',
    ],
  },
]

const PRIVACY_POLICY_SECTIONS = [
  {
    title: '引言与适用范围',
    paragraphs: [
      '智健启能（北京）科技有限公司（以下简称“我们”）是“智健食探（Food Link）”的运营者。我们重视个人信息和健康数据安全，将遵循合法、正当、必要、诚信和最小够用原则处理并保护你的个人信息。',
      '本政策适用于智健食探 Android App、微信小程序、网页及与其相关的服务。使用服务前，请你认真阅读并理解本政策；我们不会以默认勾选方式替你同意本政策。',
    ],
  },
  {
    title: '一、我们如何收集和使用个人信息',
    paragraphs: [
      '账号与认证信息：当你使用手机号验证码登录或注册、手机号密码登录时，我们会处理手机号、验证码发送与校验记录，并以不可逆散列方式保存密码凭证；当你选择微信登录时，我们会处理微信授权返回的标识、昵称和头像等信息。上述信息用于创建账号、验证身份、同步数据、保障账号安全和提供社交功能。',
      '个人资料与健康档案：你主动填写的昵称、头像、性别、生日、身高、体重、饮食目标、运动情况、病史、过敏或忌口等信息，用于生成个性化营养分析、PFC 建议、趋势记录和健康提示。',
      '饮食、运动和图片信息：你主动记录的饮食、饮水、运动、体重，以及拍摄或选择的食物照片、包装图片、体检报告或病例图片，会用于完成识别、保存记录、生成分析结果和向你展示历史数据。',
      '社区与互动信息：你发布的动态、图片、评论、点赞、收藏、私信、好友与关注关系、举报内容及相关操作记录，用于提供圈子互动、消息通知、内容治理和安全保障。你主动公开的昵称、头像和内容可能被其他用户看到。',
      '会员、订单与积分信息：订单号、套餐、支付状态、会员权益、积分余额及变动记录，用于完成支付、权益发放、对账、售后与争议处理。支付密码和完整银行卡信息由支付渠道处理，我们不会保存。',
      '运行与安全信息：为保障服务稳定和账号安全，我们可能处理 IP 地址、App 版本、操作系统版本、设备型号、网络状态、访问时间、功能操作与异常日志。我们不会将这些信息用于与服务无关的个性化广告。',
    ],
  },
  {
    title: '二、设备权限与本地能力',
    paragraphs: [
      '相机权限：仅在你主动选择拍照识别、拍摄食物或上传健康资料时申请，用于拍摄你选择提交的图片。拒绝后仍可使用不依赖相机的功能。',
      '照片与媒体权限：仅在你主动从相册选择图片、保存海报或群二维码时申请，用于读取你选择的图片或将你确认保存的图片写入相册。Android 12 及以下版本可能显示为存储权限。',
      '振动能力：用于必要的交互反馈。剪贴板仅在你主动点击复制邀请码、分享链接等操作时写入相应内容，我们不会在后台读取剪贴板。',
      '你可以在系统设置中关闭已授权的权限。关闭后，对应功能可能无法使用，但不会影响其他不依赖该权限的功能。智健食探不申请通讯录、通话记录、短信读取、麦克风或精确定位权限。',
    ],
  },
  {
    title: '三、图片、健康资料与 AI 分析',
    paragraphs: [
      '为完成食物识别、营养估算、健康报告识别和个性化建议，你主动提交的图片、文字描述及完成分析所必要的健康档案摘要可能被发送给 AI 模型技术服务提供方进行处理。我们仅提供完成本次服务所必需的信息，并要求合作方采取保密和安全措施。',
      '我们不会将你主动上传的健康图片和健康资料用于本服务之外的商业营销，也不会允许 AI 技术服务提供方将其用于与本次服务无关的目的。AI 识别和健康建议仅供日常记录参考，不替代医疗诊断或专业营养处方。',
    ],
  },
  {
    title: '四、第三方服务与信息共享',
    paragraphs: [
      '微信开放平台：当你主动使用微信登录、微信分享或微信支付时，我们会按照你的操作向微信开放平台提供完成授权、分享或支付所必要的应用信息、授权请求、分享内容或订单信息。',
      '腾讯云短信：当你主动获取短信验证码时，我们会向短信服务提供方提供手机号、验证码内容和发送状态，用于完成身份验证。',
      '腾讯云对象存储与内容分发：你主动上传的头像、食物图片、健康资料和公开内容可能存储于境内云存储，并通过内容分发服务向你或你授权的用户展示。',
      '支付、AI 分析及其他必要技术服务：在你主动使用相关功能时，我们会向相应服务提供方提供完成该项功能所必需的最少信息。除法律法规另有规定、保护用户安全所必需或取得你的单独同意外，我们不会出售、出租或非法共享你的个人信息。',
    ],
  },
  {
    title: '五、公开展示与对外分享',
    paragraphs: [
      '当你主动在圈子、个人主页、公共食物库、校园餐、评论或分享页面发布内容时，你的昵称、头像及公开内容可能被其他用户或分享链接访问者看到。请不要在公开内容中上传身份证件、联系方式、病历等不希望公开的信息。',
      '你可以通过删除内容、调整隐私设置或停止分享来控制后续展示；已被他人依法保存或再次分享的内容，可能无法由我们单方面完全删除。',
    ],
  },
  {
    title: '六、个人信息的存储与安全',
    paragraphs: [
      '我们在中华人民共和国境内收集和产生的个人信息将存储在中国境内。除法律法规另有规定或获得你的单独同意外，我们不会向境外提供个人信息。',
      '我们仅在实现服务目的所必需的期限内，或法律法规要求的期限内保存个人信息。超过保存期限后，我们将依法删除、匿名化或进行必要的最小化留存。',
      '我们通过访问控制、传输加密、凭证散列、日志审计、备份和最小权限等措施保护个人信息。互联网服务不存在绝对安全，如发生可能影响你权益的安全事件，我们将依法采取补救措施并进行通知。',
    ],
  },
  {
    title: '七、你的个人信息权利',
    paragraphs: [
      '你可以在产品内查看和修改个人资料、健康档案及部分记录；可以通过“我的—隐私设置”控制搜索可见性和饮食记录公开状态，通过系统设置管理相机、照片等权限。',
      '你可以删除自己发布的部分内容、清除本地缓存或退出登录。清除缓存不会自动注销账号；退出登录会移除本机登录状态。',
      '你可以在个人资料编辑页底部使用“注销账号”入口。注销前会进行二次确认；注销完成后，我们将依法处理账号资料、健康记录、社交关系和其他个人信息，依法需要保留的订单与安全记录将在期限届满后删除或匿名化。',
      '如你需要访问、更正、复制、删除个人信息，撤回同意，或对个人信息处理规则作出解释，可通过本政策公布的联系方式提交请求。我们会在核验身份后依法处理。',
    ],
  },
  {
    title: '八、未成年人保护',
    paragraphs: [
      '智健食探主要面向成年人提供健康记录服务。未满十四周岁的未成年人应在监护人阅读并同意本政策后使用服务；如我们发现未经监护人同意处理了儿童个人信息，将依法尽快删除或采取其他保护措施。',
    ],
  },
  {
    title: '九、本政策的更新',
    paragraphs: [
      '我们可能因业务功能、法律法规或个人信息处理方式变化而更新本政策。对涉及处理目的、信息类型或权利行使方式的重大变化，我们会通过产品内提示、弹窗或其他适当方式告知，并在依法需要时重新取得你的同意。',
    ],
  },
  {
    title: '十、运营主体与联系我们',
    paragraphs: [
      '运营主体：智健启能（北京）科技有限公司。',
      '联系邮箱：jianwen_ma@stu.pku.edu.cn。你也可以通过智健食探 App 或微信小程序内的“关于我们”“意见反馈”或客服入口联系我们。',
      '如你对本政策、个人信息处理或账号数据有疑问、意见、投诉或请求，我们会在收到并核验身份后，在法律法规规定的期限内答复。',
    ],
  },
]

export function AgreementsScreen() {
  return (
    <LegalDocumentScreen title="用户服务协议" updatedAt="最后更新日期：2026年2月" sections={AGREEMENT_SECTIONS} />
  )
}

export function PrivacyPolicyScreen() {
  return <LegalDocumentScreen title="隐私政策" updatedAt="最后更新日期：2026年8月15日" sections={PRIVACY_POLICY_SECTIONS} />
}

export function AutoRenewAuditScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  const insets = useSafeAreaInsets()
  const [membership, setMembership] = useState<MembershipStatus | null>(null)
  const [plans, setPlans] = useState<MembershipPlan[]>([])
  const [selectedPlanCode, setSelectedPlanCode] = useState('')
  const [agreed, setAgreed] = useState(false)
  const [loading, setLoading] = useState(false)
  const [previewModal, setPreviewModal] = useState<'sign' | 'cancel' | null>(null)

  const selectedPlan = useMemo(
    () => plans.find((plan) => plan.code === selectedPlanCode) || findAuditPlan(plans, 'standard', 'yearly') || plans[0],
    [plans, selectedPlanCode],
  )

  const currentPlan = useMemo(
    () => plans.find((plan) => plan.code === membership?.current_plan_code) || null,
    [membership?.current_plan_code, plans],
  )

  const priceTableTiers = useMemo(() => {
    const available = auditTierKeys.filter((tier) => plans.some((plan) => auditPlanTierKey(plan) === tier))
    return available.length > 0 ? available : auditTierKeys
  }, [plans])

  const autoRenewPreview = useMemo(() => {
    if (!selectedPlan) {
      return {
        planName: '食探会员',
        periodLabel: '所选周期',
        amountText: '--',
        renewDateText: '--',
      }
    }
    const isCurrentSelectedPlan = Boolean(membership?.is_pro && membership.current_plan_code === selectedPlan.code)
    const baseDate = isCurrentSelectedPlan
      ? parseAutoRenewDate(membership?.expires_at) || new Date()
      : new Date()
    const renewDate = addAutoRenewMonths(baseDate, Number(selectedPlan.duration_months || 1))
    return {
      planName: `食探会员 · ${selectedPlan.name}`,
      periodLabel: planPeriodLabel(selectedPlan),
      amountText: `¥${moneyText(selectedPlan.amount)}${planPeriodSuffix(selectedPlan)}`,
      renewDateText: formatAutoRenewDate(renewDate),
    }
  }, [membership, selectedPlan])

  const signPreviewLines = useMemo(() => {
    if (!selectedPlan) return []
    return [
      `开通服务：${autoRenewPreview.planName}`,
      `扣费周期：${autoRenewPreview.periodLabel}`,
      `每期金额：${autoRenewPreview.amountText}`,
      '开通后，会员到期前将按所选周期自动续费；扣费前会按支付渠道规则通知。',
      `预计续费：${autoRenewPreview.renewDateText}。当前仅为审核预览，不会创建订单或发起真实扣款。`,
    ]
  }, [autoRenewPreview, selectedPlan])

  const cancelPreviewLines = [
    '产品内路径：我的 → 食探会员 → 自动续费管理 → 关闭自动续费。',
    '也可在微信支付、应用商店或对应支付渠道的扣费服务中关闭。',
    '当前为审核预览，不会执行真实解约；关闭后也不影响已付费周期内会员权益。',
  ]

  const previewTitle = previewModal === 'sign' ? '确认开通自动续费' : '关闭自动续费路径'
  const previewLines = previewModal === 'sign' ? signPreviewLines : cancelPreviewLines
  const previewButtonText = previewModal === 'sign' ? '确认' : '知道了'

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [membershipData, planData] = await Promise.all([
        apiClient.getMyMembership().catch(() => null),
        apiClient.listMembershipPlans().catch(() => ({ list: [] as MembershipPlan[] })),
      ])
      const nextPlans = (planData.list || []).slice().sort((a, b) => {
        const orderDiff = (a.sort_order || 0) - (b.sort_order || 0)
        return orderDiff || (a.amount || 0) - (b.amount || 0)
      })
      setMembership(membershipData)
      setPlans(nextPlans)
      setSelectedPlanCode((current) => {
        if (current && nextPlans.some((plan) => plan.code === current)) return current
        if (membershipData?.current_plan_code && nextPlans.some((plan) => plan.code === membershipData.current_plan_code)) {
          return membershipData.current_plan_code
        }
        return findAuditPlan(nextPlans, 'standard', 'yearly')?.code || nextPlans[0]?.code || ''
      })
    } catch (error) {
      showError('获取自动续费状态失败', error)
    } finally {
      setLoading(false)
    }
  }, [])

  useFocusEffect(
    useCallback(() => {
      void load()
    }, [load]),
  )

  const showSignPreview = () => {
    if (!selectedPlan) {
      Alert.alert('暂无可选套餐', '请稍后刷新会员套餐。')
      return
    }
    if (!agreed) {
      Alert.alert('请先阅读并同意规则', '勾选会员服务协议及自动续费规则后再继续。该页面仅用于自动续费能力审核预览，不会发起真实代扣。')
      return
    }
    setPreviewModal('sign')
  }

  const showCancelPreview = () => {
    setPreviewModal('cancel')
  }

  return (
    <View style={styles.autoRenewPage}>
      <ScrollView
        style={styles.autoRenewScroll}
        contentContainerStyle={[styles.autoRenewContent, { paddingBottom: 34 + insets.bottom }]}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.brand} colors={[colors.brand]} />}
      >
        <View style={styles.autoRenewBanner}>
          <Text style={styles.autoRenewKicker}>食探会员服务</Text>
          <Text style={styles.autoRenewTitle}>食探会员自动续费</Text>
          <Text style={styles.autoRenewDesc}>开通后可持续享受会员权益；到期前按所选周期自动续费，扣费前将按支付渠道规则通知。</Text>
        </View>

        <View style={styles.autoRenewStatusPanel}>
          <View>
            <Text style={styles.autoRenewStatusLabel}>当前状态</Text>
            <Text style={styles.autoRenewStatusValue}>{membership?.is_pro ? 'Pro 会员' : '基础账号'}</Text>
          </View>
          <View style={styles.autoRenewStatusGrid}>
            <View style={styles.autoRenewStatusItem}>
              <Text style={styles.autoRenewStatusItemLabel}>会员状态</Text>
              <Text style={styles.autoRenewStatusItemValue} numberOfLines={1}>{membershipStatusLabel(membership)}</Text>
            </View>
            <View style={styles.autoRenewStatusItem}>
              <Text style={styles.autoRenewStatusItemLabel}>当前套餐</Text>
              <Text style={styles.autoRenewStatusItemValue} numberOfLines={1}>{currentPlan?.name || membership?.current_plan_code || '未开通套餐'}</Text>
            </View>
            <View style={styles.autoRenewStatusItem}>
              <Text style={styles.autoRenewStatusItemLabel}>今日可用</Text>
              <Text style={styles.autoRenewStatusItemValue} numberOfLines={1}>{membership?.total_credits_available ?? membership?.daily_credits_remaining ?? 0}</Text>
            </View>
            <View style={styles.autoRenewStatusItem}>
              <Text style={styles.autoRenewStatusItemLabel}>奖励积分</Text>
              <Text style={styles.autoRenewStatusItemValue} numberOfLines={1}>{membership?.earned_credits_balance ?? membership?.points_balance ?? 0}</Text>
            </View>
          </View>
        </View>

        <View style={styles.autoRenewSection}>
          <Text style={styles.autoRenewSectionTitle}>服务内容介绍</Text>
          <View style={styles.autoRenewServiceGrid}>
            {autoRenewServiceItems.map((item) => (
              <View key={item} style={styles.autoRenewServiceItem}>
                <Text style={styles.autoRenewServiceText}>{item}</Text>
              </View>
            ))}
          </View>
        </View>

        <View style={styles.autoRenewSection}>
          <Text style={styles.autoRenewSectionTitle}>会员权益与价目表</Text>
          <AutoRenewPriceTable
            plans={plans}
            selectedPlanCode={selectedPlanCode}
            tiers={priceTableTiers}
            onSelect={setSelectedPlanCode}
          />
          <Text style={styles.autoRenewPriceNote}>标准版及进阶版支持精准模式；系统积分每日发放，次日刷新；奖励积分可累计。</Text>
        </View>

        <View style={[styles.autoRenewSection, styles.autoRenewAutoCard]}>
          <Text style={styles.autoRenewSectionTitle}>自动续费签约前说明</Text>
          <AutoRenewInfoRow label="服务名称" value={autoRenewPreview.planName} />
          <AutoRenewInfoRow label="扣费周期" value={autoRenewPreview.periodLabel} />
          <AutoRenewInfoRow label="每期金额" value={autoRenewPreview.amountText} strong />
          <AutoRenewInfoRow label="预计续费" value={autoRenewPreview.renewDateText} />
          <Text style={styles.autoRenewPlainText}>开通后，会员到期前将按所选周期自动续费；扣费前会按支付渠道规则通知。用户可随时关闭自动续费，关闭后不影响已付费周期内权益。</Text>
          <Pressable style={styles.autoRenewCheckRow} onPress={() => setAgreed((value) => !value)}>
            <View style={[styles.autoRenewCheckbox, agreed && styles.autoRenewCheckboxActive]}>
              <Text style={styles.autoRenewCheckboxText}>{agreed ? '✓' : ''}</Text>
            </View>
            <Text style={styles.autoRenewCheckText}>我已阅读并同意会员服务协议及自动续费规则</Text>
          </Pressable>
          <Pressable onPress={() => navigation.navigate('MembershipAgreement')}>
            <Text style={styles.autoRenewLink}>查看《会员服务协议》</Text>
          </Pressable>
          <Pressable
            disabled={loading}
            style={[styles.autoRenewPrimaryButton, loading && styles.autoRenewButtonDisabled]}
            onPress={showSignPreview}
          >
            <Text style={styles.autoRenewPrimaryButtonText}>确认开通自动续费</Text>
          </Pressable>
          <Text style={styles.autoRenewSubscribeHint}>自动续费审核预览 · 不发起真实代扣</Text>
        </View>

        <View style={[styles.autoRenewSection, styles.autoRenewCancelCard]}>
          <Text style={styles.autoRenewSectionTitle}>产品内取消续费路径</Text>
          <View style={[styles.autoRenewPathBox, styles.autoRenewPathBoxBlue]}>
            <Text style={styles.autoRenewPathText}>我的 → 食探会员 → 自动续费管理 → 关闭自动续费</Text>
          </View>
          <Text style={styles.autoRenewManageText}>用户也可在微信支付、应用商店或对应支付渠道的扣费服务中关闭。关闭后不影响已付费周期内会员权益。</Text>
          <Pressable
            style={styles.autoRenewSecondaryButton}
            onPress={showCancelPreview}
          >
            <Text style={styles.autoRenewSecondaryButtonText}>关闭自动续费</Text>
          </Pressable>
        </View>
      </ScrollView>

      <Modal
        visible={Boolean(previewModal)}
        transparent
        animationType="fade"
        onRequestClose={() => setPreviewModal(null)}
      >
        <View style={styles.auditModalBackdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setPreviewModal(null)} />
          <View style={styles.auditModal}>
            <Text style={styles.auditModalTitle}>{previewTitle}</Text>
            <View style={styles.auditModalBody}>
              {previewLines.map((line) => (
                <Text key={line} style={styles.auditModalLine}>{line}</Text>
              ))}
            </View>
            <Pressable style={styles.autoRenewModalButton} onPress={() => setPreviewModal(null)}>
              <Text style={styles.autoRenewModalButtonText}>{previewButtonText}</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  )
}

function AutoRenewPriceTable({
  plans,
  selectedPlanCode,
  tiers,
  onSelect,
}: {
  plans: MembershipPlan[]
  selectedPlanCode: string
  tiers: AuditMembershipTierKey[]
  onSelect: (code: string) => void
}) {
  if (plans.length === 0) {
    return <EmptyState text="暂无可选套餐" />
  }

  return (
    <View style={styles.autoRenewPriceTable}>
      <View style={styles.autoRenewPriceHead}>
        <Text style={[styles.autoRenewPriceHeadText, styles.autoRenewPriceNameHead]}>档位</Text>
        {auditPeriodKeys.map((period) => (
          <Text key={period} style={styles.autoRenewPriceHeadText}>{auditPeriodLabels[period]}</Text>
        ))}
      </View>
      {tiers.map((tier) => {
        const tierPlans = plans.filter((plan) => auditPlanTierKey(plan) === tier)
        const referencePlan = tierPlans[0]
        return (
          <View key={tier} style={styles.autoRenewPriceRow}>
            <View style={styles.autoRenewPriceNameCol}>
              <Text style={styles.autoRenewTierName} numberOfLines={1}>{auditTierLabels[tier]}</Text>
              <Text style={styles.autoRenewTierCredits} numberOfLines={1}>{referencePlan?.daily_credits || 0} 积分/日</Text>
            </View>
            {auditPeriodKeys.map((period) => {
              const plan = findAuditPlan(plans, tier, period)
              const active = Boolean(plan && plan.code === selectedPlanCode)
              return (
                <Pressable
                  key={`${tier}-${period}`}
                  disabled={!plan}
                  style={[styles.autoRenewPriceCell, active && styles.autoRenewPriceCellActive]}
                  onPress={() => {
                    if (plan) onSelect(plan.code)
                  }}
                >
                  <Text style={[styles.autoRenewPriceText, active && styles.autoRenewPriceTextActive]}>
                    {plan ? `¥${moneyText(plan.amount)}` : '—'}
                  </Text>
                </Pressable>
              )
            })}
          </View>
        )
      })}
    </View>
  )
}

function AutoRenewInfoRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <View style={styles.autoRenewInfoRow}>
      <Text style={styles.autoRenewInfoLabel}>{label}</Text>
      <Text style={[styles.autoRenewInfoValue, strong && styles.autoRenewInfoValueStrong]}>{value}</Text>
    </View>
  )
}

function LegalDocumentScreen({
  title,
  updatedAt,
  sections,
}: {
  title: string
  updatedAt: string
  sections: Array<{ title: string; paragraphs: string[] }>
}) {
  return (
    <View style={styles.legalDocumentPage}>
      <ScrollView style={styles.legalDocumentScroll} contentContainerStyle={styles.legalDocumentContentWrap} showsVerticalScrollIndicator={false}>
        <View style={styles.legalDocumentContent}>
          <Text style={styles.legalDocumentTitle}>{title}</Text>
          <Text style={styles.legalDocumentUpdatedAt}>{updatedAt}</Text>
          {sections.map((section) => (
            <View key={section.title} style={styles.legalDocumentSection}>
              <Text style={styles.legalDocumentSectionTitle}>{section.title}</Text>
              {section.paragraphs.map((paragraph, index) => (
                <Text key={`${section.title}-${index}`} style={styles.legalDocumentParagraph}>
                  {paragraph}
                </Text>
              ))}
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  )
}

function InfoLine({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.infoLine}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  )
}

function PetStat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.petStat}>
      <Text style={styles.petStatValue}>{value}</Text>
      <Text style={styles.petStatLabel}>{label}</Text>
    </View>
  )
}

function PetHomeMetric({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.petHomeMetric}>
      <Text style={styles.petHomeMetricLabel}>{label}</Text>
      <Text style={styles.petHomeMetricValue}>{value}</Text>
    </View>
  )
}

function PetLabStat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.petLabStat}>
      <Text style={styles.petLabStatValue}>{value}</Text>
      <Text style={styles.petLabStatLabel}>{label}</Text>
    </View>
  )
}

function PetLabFilterRow({
  title,
  value,
  options,
  onChange,
}: {
  title: string
  value: string
  options: Array<{ value: string; label: string }>
  onChange: (value: string) => void
}) {
  return (
    <View style={styles.petLabFilter}>
      <Text style={styles.petLabFilterTitle}>{title}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.petLabFilterRow}>
        {options.map((option) => {
          const active = value === option.value
          return (
            <Pressable key={option.value} style={[styles.petLabPill, active && styles.petLabPillActive]} onPress={() => onChange(option.value)}>
              <Text style={[styles.petLabPillText, active && styles.petLabPillTextActive]}>{option.label}</Text>
            </Pressable>
          )
        })}
      </ScrollView>
    </View>
  )
}

function ImagePickerGrid({
  urls,
  max,
  loading,
  onAdd,
  onRemove,
}: {
  urls: string[]
  max: number
  loading: boolean
  onAdd: () => void
  onRemove: (index: number) => void
}) {
  return (
    <View style={styles.imageBlock}>
      <View style={styles.imageGrid}>
        {urls.map((url, index) => (
          <View key={`${url}-${index}`} style={styles.imageTile}>
            <Image source={{ uri: url }} style={styles.imageThumb} />
            <Pressable style={styles.imageRemove} onPress={() => onRemove(index)}>
              <Text style={styles.imageRemoveText}>×</Text>
            </Pressable>
          </View>
        ))}
        {urls.length < max ? (
          <Pressable style={styles.imageAdd} onPress={onAdd} disabled={loading}>
            {loading ? <ActivityIndicator color={colors.brand} /> : <Text style={styles.imageAddIcon}>+</Text>}
            <Text style={styles.imageAddText}>添加</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  )
}

function MealPicker({ value, onChange }: { value: MealType; onChange: (value: MealType) => void }) {
  return (
    <View style={styles.segment}>
      {mealOptions.map((meal) => (
        <SegmentButton key={meal} label={getMealTypeLabel(meal)} active={value === meal} onPress={() => onChange(meal)} />
      ))}
    </View>
  )
}

function SegmentButton({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable style={[styles.segmentItem, active && styles.segmentItemActive]} onPress={onPress}>
      <Text style={[styles.segmentText, active && styles.segmentTextActive]}>{label}</Text>
    </Pressable>
  )
}

function Field({
  label,
  value,
  onChangeText,
  placeholder,
  keyboardType,
  multiline,
  autoCapitalize,
}: {
  label: string
  value: string
  onChangeText: (value: string) => void
  placeholder?: string
  keyboardType?: 'default' | 'decimal-pad' | 'number-pad'
  multiline?: boolean
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters'
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textMuted}
        keyboardType={keyboardType}
        multiline={multiline}
        autoCapitalize={autoCapitalize}
        textAlignVertical={multiline ? 'top' : 'center'}
        style={[styles.input, multiline && styles.textarea]}
      />
    </View>
  )
}

function SmallButton({ label, danger, disabled, onPress }: { label: string; danger?: boolean; disabled?: boolean; onPress: () => void }) {
  return (
    <Pressable disabled={disabled} onPress={onPress} style={[styles.smallButton, danger && styles.smallButtonDanger, disabled && styles.smallButtonDisabled]}>
      <Text style={[styles.smallButtonText, danger && styles.smallButtonDangerText, disabled && styles.smallButtonTextDisabled]}>{label}</Text>
    </Pressable>
  )
}

function InviteActionButton({
  label,
  variant = 'primary',
  disabled,
  loading,
  onPress,
}: {
  label: string
  variant?: 'primary' | 'ghost'
  disabled?: boolean
  loading?: boolean
  onPress: () => void
}) {
  const isGhost = variant === 'ghost'
  return (
    <Pressable
      style={[styles.inviteActionButton, isGhost && styles.inviteActionButtonGhost, disabled && styles.smallButtonDisabled]}
      disabled={disabled}
      onPress={onPress}
    >
      {loading ? (
        <ActivityIndicator color={isGhost ? '#0f766e' : '#fff'} size="small" />
      ) : null}
      <Text style={[styles.inviteActionButtonText, isGhost && styles.inviteActionButtonTextGhost]}>{label}</Text>
    </Pressable>
  )
}

function InviteRuleItem({ index, text }: { index: string; text: string }) {
  return (
    <View style={styles.inviteRuleItem}>
      <Text style={styles.inviteRuleIndex}>{index}</Text>
      <Text style={styles.inviteRuleText}>{text}</Text>
    </View>
  )
}

function Pill({ text }: { text: string }) {
  return (
    <View style={styles.pill}>
      <Text style={styles.pillText}>{text}</Text>
    </View>
  )
}

function EmptyState({ text }: { text: string }) {
  return (
    <View style={styles.autoRenewEmptyState}>
      <Text style={styles.autoRenewEmptyText}>{text}</Text>
    </View>
  )
}

function FollowAvatar({ user }: { user: FollowUserItem }) {
  const avatar = String(user.avatar || '').trim()
  const label = followDisplayName(user)
  if (avatar) return <Image source={{ uri: avatar }} style={styles.followAvatarImage} />
  return (
    <View style={styles.followAvatarFallback}>
      <Text style={styles.followAvatarText}>{label.slice(0, 1)}</Text>
    </View>
  )
}

function followUserId(user: FollowUserItem): string {
  return String(user.id || user.user_id || '').trim()
}

function followDisplayName(user: FollowUserItem): string {
  return String(user.nickname || '').trim() || '用户'
}

function showError(title: string, error: unknown) {
  Alert.alert(title, userFacingErrorMessage(error))
}

function buildInviteDeepLink(inviteCode: string): string {
  const code = inviteCode.trim()
  return code ? `foodlink://invite?fi=${encodeURIComponent(code)}` : ''
}

function normalizeInviteCode(value?: string): string {
  return String(value || '').trim()
}

function profileUserId(profile: Record<string, unknown> | null): string {
  return String(profile?.user_id || profile?.id || '').trim()
}

function inviteRelationHandled(profile: Record<string, unknown> | null): boolean {
  const status = String(profile?.status || profile?.request_status || profile?.relation || '')
  return Boolean(profile?.is_self || profile?.is_friend || profile?.already_friend || status === 'already_friend' || status === 'request_sent')
}

function inviteActionText(profile: Record<string, unknown> | null): string {
  if (profile?.is_self) return '这是我的邀请'
  if (profile?.is_friend || profile?.already_friend || profile?.status === 'already_friend') return '已是好友'
  if (profile?.status === 'request_sent' || profile?.request_status === 'request_sent') return '已发送申请'
  return '加为好友'
}

function inviteRelationText(profile: Record<string, unknown> | null): string {
  if (profile?.is_self) return '这是你的邀请页，把邀请码或链接分享给新朋友即可。'
  if (profile?.is_friend || profile?.already_friend || profile?.status === 'already_friend') return '你们已经是好友，可以直接开始互相关注打卡。'
  if (profile?.status === 'request_sent' || profile?.request_status === 'request_sent') return '好友申请已发送，等待对方处理。'
  const relation = String(profile?.relation || profile?.request_status || profile?.status || '').trim()
  return relation || '确认后会发送好友申请，邀请奖励按后端规则结算。'
}

function buildInviteMessage(profile: Record<string, unknown> | null, inviteCode: string, inviteLink: string): string {
  const code = inviteCode.trim()
  const nickname = String(profile?.nickname || '').trim()
  const title = nickname ? `${nickname} 邀请你加入食探` : '邀请你加入食探'
  return [
    title,
    '注册后 7 天内完成 2 个自然日有效记录，双方各得 15 积分。',
    code ? `邀请码：${code}` : '',
    inviteLink ? `打开链接自动带入：${inviteLink}` : '',
  ].filter(Boolean).join('\n')
}

function InviteQrCode({ value, large = false }: { value: string; large?: boolean }) {
  const matrix = useMemo(() => {
    const link = value.trim()
    if (!link) return []
    const qr = qrcode(0, 'M')
    qr.addData(link)
    qr.make()
    const size = qr.getModuleCount()
    return Array.from({ length: size }, (_, row) =>
      Array.from({ length: size }, (_, col) => qr.isDark(row, col)),
    )
  }, [value])

  if (!matrix.length) {
    return (
      <View style={[styles.inviteQrOuter, large && styles.inviteQrOuterLarge]}>
        <Text style={styles.subtitle}>二维码生成中</Text>
      </View>
    )
  }

  return (
    <View style={[styles.inviteQrOuter, large && styles.inviteQrOuterLarge]}>
      <View style={[styles.inviteQrMatrix, large && styles.inviteQrMatrixLarge]}>
        {matrix.map((row, rowIndex) => (
          <View key={`qr-row-${rowIndex}`} style={styles.inviteQrRow}>
            {row.map((dark, colIndex) => (
              <View
                key={`qr-cell-${rowIndex}-${colIndex}`}
                style={[styles.inviteQrCell, dark ? styles.inviteQrCellDark : styles.inviteQrCellLight]}
              />
            ))}
          </View>
        ))}
      </View>
    </View>
  )
}

function createBlankRecipeRow(): RecipeFormRow {
  return { id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, name: '', weight: '100', calories: '', protein: '', carbs: '', fat: '' }
}

function recipeItemsToRows(items: RecipeItem['items'], recipe: RecipeItem): RecipeFormRow[] {
  const source = Array.isArray(items) && items.length ? items : [{
    name: recipe.recipe_name,
    weight: recipe.total_weight_grams || 100,
    nutrients: {
      calories: recipe.total_calories,
      protein: recipe.total_protein,
      carbs: recipe.total_carbs,
      fat: recipe.total_fat,
    },
  }]
  return source.map((item, index) => {
    const nutrients = asRecord(item.nutrients)
    return {
      id: String(item.id || `${index}-${Date.now()}`),
      name: String(item.name || item.food_name || recipe.recipe_name || ''),
      weight: numberText(firstNumber(item.weight, item.estimatedWeightGrams, item.estimated_weight_grams, item.intake, index === 0 ? recipe.total_weight_grams : undefined)),
      calories: numberText(firstNumber(nutrients?.calories, item.calories, item.total_calories, source.length === 1 ? recipe.total_calories : undefined)),
      protein: numberText(firstNumber(nutrients?.protein, item.protein, item.total_protein, source.length === 1 ? recipe.total_protein : undefined)),
      carbs: numberText(firstNumber(nutrients?.carbs, item.carbs, item.total_carbs, source.length === 1 ? recipe.total_carbs : undefined)),
      fat: numberText(firstNumber(nutrients?.fat, item.fat, item.total_fat, source.length === 1 ? recipe.total_fat : undefined)),
    }
  })
}

function recipeRowsToPayload(rows: RecipeFormRow[], fallbackName: string): Array<Record<string, unknown>> {
  const fallback = fallbackName.trim() || '自定义食谱'
  const validRows = rows.filter((row) => row.name.trim() || Number(row.calories) || Number(row.weight))
  return (validRows.length ? validRows : [createBlankRecipeRow()]).map((row, index) => {
    const weight = numeric(row.weight) || 100
    return {
      name: row.name.trim() || (index === 0 ? fallback : `食物 ${index + 1}`),
      weight,
      intake: weight,
      ratio: 100,
      nutrients: {
        calories: numeric(row.calories),
        protein: numeric(row.protein),
        carbs: numeric(row.carbs),
        fat: numeric(row.fat),
      },
    }
  })
}

function calculateRecipeTotals(rows: RecipeFormRow[]): RecipeTotals {
  return {
    weight: rows.reduce((sum, item) => sum + numeric(item.weight), 0),
    calories: rows.reduce((sum, item) => sum + numeric(item.calories), 0),
    protein: rows.reduce((sum, item) => sum + numeric(item.protein), 0),
    carbs: rows.reduce((sum, item) => sum + numeric(item.carbs), 0),
    fat: rows.reduce((sum, item) => sum + numeric(item.fat), 0),
  }
}

function calculateRecipeTotalsFromPayload(items: Array<Record<string, unknown>>): RecipeTotals {
  return items.reduce<RecipeTotals>((sum, item) => {
    const nutrients = asRecord(item.nutrients)
    return {
      weight: sum.weight + firstNumber(item.weight, item.intake),
      calories: sum.calories + firstNumber(nutrients?.calories, item.calories),
      protein: sum.protein + firstNumber(nutrients?.protein, item.protein),
      carbs: sum.carbs + firstNumber(nutrients?.carbs, item.carbs),
      fat: sum.fat + firstNumber(nutrients?.fat, item.fat),
    }
  }, { weight: 0, calories: 0, protein: 0, carbs: 0, fat: 0 })
}

function normalizeMealType(value?: string | null): MealType | undefined {
  if (mealOptions.includes(value as MealType)) return value as MealType
  if (value === 'snack') return 'afternoon_snack'
  return undefined
}

function splitTextList(value: string): string[] {
  return value
    .split(/[\n,，、]/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function optionalNumber(value: string): number | undefined {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function normalizePublicFoodPriceType(value?: string | null): PublicFoodPriceType {
  if (publicFoodPriceTypeOptions.some((option) => option.value === value)) return value as PublicFoodPriceType
  return 'fixed'
}

function buildPublicFoodTags(tags: string[], isHomemade: boolean): string[] {
  const next = tags.map((tag) => tag.trim()).filter(Boolean)
  if (isHomemade && !next.includes('自制')) next.unshift('自制')
  return Array.from(new Set(next))
}

function confirmPublicFoodSubmit({
  editId,
  isCampus,
  isHomemade,
}: {
  editId: boolean
  isCampus: boolean
  isHomemade: boolean
}): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert(
      editId ? '确认保存' : '确认提交',
      editId
        ? `确定保存对这份${isCampus ? '校园食堂菜品' : '食物'}的修改吗？`
        : isCampus
          ? '确定发布这份校园食堂菜品吗？提交后会显示在校园食堂分区。'
          : isHomemade
            ? '确定将这份自制餐食提交到公共食物库吗？审核通过后其他用户即可查看。'
            : '确定要将该食物分享到公共食物库吗？提交后需经系统审核，通过后其他用户可查看。',
      [
        { text: '取消', style: 'cancel', onPress: () => resolve(false) },
        { text: editId ? '保存' : '确定提交', onPress: () => resolve(true) },
      ],
    )
  })
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

function firstNumber(...values: unknown[]): number {
  for (const value of values) {
    const parsed = Number(value)
    if (Number.isFinite(parsed) && parsed !== 0) return parsed
  }
  return 0
}

function numeric(value: unknown): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function numberText(value: unknown): string {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed === 0) return ''
  return String(Math.round(parsed * 10) / 10)
}

function round1(value: unknown): string {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? String(Math.round(parsed * 10) / 10) : '0'
}

function membershipStatusLabel(status: MembershipStatus | null): string {
  if (!status) return '--'
  if (status.trial_active) return '试用中'
  const labels: Record<string, string> = {
    inactive: '未开通',
    active: '生效中',
    expired: '已到期',
    cancelled: '已取消',
  }
  return labels[status.status || ''] || status.status || '--'
}

function petEarnedCredits(status: MembershipStatus | null): number {
  return Math.max(0, Math.floor(numeric(status?.earned_credits_balance ?? status?.points_balance)))
}

function petTotalCredits(status: MembershipStatus | null): number {
  return Math.max(0, Math.floor(numeric(status?.total_credits_available ?? status?.daily_credits_remaining ?? status?.daily_remaining)))
}

function petArchetypeLabel(archetype?: string): string {
  const labels: Record<string, string> = {
    steady_caregiver: '稳定陪伴',
    energetic_buddy: '元气伙伴',
    gentle_healer: '温柔守护',
    protein_guardian: '蛋白守卫',
    light_lifestyle: '轻盈陪伴',
  }
  return labels[archetype || ''] || '稳定陪伴'
}

function candidateStyleLabel(style?: string): string {
  const labels: Record<string, string> = {
    pretty: '漂亮亲和',
    quirky: '有特色',
    stable: '稳定可用',
    risky: '需要斟酌',
  }
  return labels[style || ''] || '候选外观'
}

type AuditMembershipTierKey = 'light' | 'standard' | 'advanced'
type AuditMembershipPeriodKey = 'monthly' | 'quarterly' | 'yearly'

const autoRenewServiceItems = ['饮食记录', 'AI 营养分析', '健康档案', '运动记录', '社区互动', '公共食物库']
const auditTierKeys: AuditMembershipTierKey[] = ['light', 'standard', 'advanced']
const auditPeriodKeys: AuditMembershipPeriodKey[] = ['monthly', 'quarterly', 'yearly']
const auditTierLabels: Record<AuditMembershipTierKey, string> = {
  light: '轻度版',
  standard: '标准版',
  advanced: '进阶版',
}
const auditPeriodLabels: Record<AuditMembershipPeriodKey, string> = {
  monthly: '月卡',
  quarterly: '季卡',
  yearly: '年卡',
}

function auditPlanTierKey(plan?: MembershipPlan): AuditMembershipTierKey {
  const raw = `${plan?.tier || ''} ${plan?.code || ''} ${plan?.name || ''}`.toLowerCase()
  if (raw.includes('advanced') || raw.includes('进阶')) return 'advanced'
  if (raw.includes('light') || raw.includes('轻度')) return 'light'
  return 'standard'
}

function auditPlanPeriodKey(plan?: MembershipPlan): AuditMembershipPeriodKey {
  const raw = `${plan?.period || ''} ${plan?.code || ''} ${plan?.name || ''}`.toLowerCase()
  const months = Number(plan?.duration_months || 0)
  if (raw.includes('year') || raw.includes('年') || months >= 12) return 'yearly'
  if (raw.includes('quarter') || raw.includes('季') || months >= 3) return 'quarterly'
  return 'monthly'
}

function findAuditPlan(
  plans: MembershipPlan[],
  tier: AuditMembershipTierKey,
  period: AuditMembershipPeriodKey,
): MembershipPlan | undefined {
  return plans.find((plan) => auditPlanTierKey(plan) === tier && auditPlanPeriodKey(plan) === period)
}

function planPeriodLabel(plan: MembershipPlan): string {
  if (plan.period) {
    const labels: Record<string, string> = {
      month: '月卡',
      quarter: '季卡',
      year: '年卡',
      monthly: '月卡',
      quarterly: '季卡',
      yearly: '年卡',
    }
    return labels[plan.period] || plan.period
  }
  if (plan.duration_months >= 12) return '年卡'
  if (plan.duration_months >= 3) return '季卡'
  return '月卡'
}

function planPeriodSuffix(plan: MembershipPlan): string {
  if (plan.duration_months >= 12 || plan.period === 'year' || plan.period === 'yearly') return '/年'
  if (plan.duration_months >= 3 || plan.period === 'quarter' || plan.period === 'quarterly') return '/季'
  return '/月'
}

function parseAutoRenewDate(value: unknown): Date | null {
  if (!value) return null
  const date = new Date(String(value))
  return Number.isNaN(date.getTime()) ? null : date
}

function addAutoRenewMonths(value: Date, months: number): Date {
  const next = new Date(value.getTime())
  next.setMonth(next.getMonth() + Math.max(1, Math.floor(months || 1)))
  return next
}

function formatAutoRenewDate(value: Date): string {
  if (Number.isNaN(value.getTime())) return '--'
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`
}

function moneyText(value: unknown): string {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return '0'
  return parsed.toFixed(2).replace(/\.00$/, '')
}

function growthUnlockLabel(unlock: string): string {
  const labels: Record<string, string> = {
    accessory: '配饰',
    pattern: '纹理',
    color: '颜色',
    mood: '情绪反馈',
    lab: '外观实验室',
  }
  return labels[unlock] || unlock
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  rowBetween: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  followListPage: {
    flex: 1,
    backgroundColor: '#f0f3f6',
  },
  followListWash: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 220,
    backgroundColor: '#ecfdf5',
    opacity: 0.66,
  },
  followListScroll: {
    flex: 1,
  },
  followListContent: {
    minHeight: '100%',
    paddingHorizontal: 16,
    paddingTop: 2,
    paddingBottom: 32,
    backgroundColor: '#f0f3f6',
  },
  followListEmptyContent: {
    flexGrow: 1,
    paddingHorizontal: 16,
    backgroundColor: '#f0f3f6',
  },
  followListState: {
    minHeight: 160,
    alignItems: 'center',
    justifyContent: 'center',
  },
  followListEmpty: {
    minHeight: 180,
    alignItems: 'center',
    justifyContent: 'center',
  },
  followListEmptyText: {
    color: '#9ca3af',
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '600',
  },
  followListItem: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#f3f4f6',
    paddingVertical: 12,
  },
  followItemLeft: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingRight: 10,
  },
  followItemName: {
    flex: 1,
    minWidth: 0,
    color: '#111827',
    fontSize: 15,
    lineHeight: 21,
    fontWeight: '700',
  },
  followItemButton: {
    width: 65,
    minHeight: 26,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#00bc7d',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#00bc7d',
    paddingHorizontal: 8,
  },
  followItemButtonActive: {
    backgroundColor: 'transparent',
    borderColor: '#d1d5db',
  },
  followItemButtonText: {
    color: colors.surface,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '800',
  },
  followItemButtonTextActive: {
    color: '#6b7280',
  },
  followAvatarImage: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surfaceMuted,
  },
  followAvatarFallback: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f3f4f6',
  },
  followAvatarText: {
    color: colors.textSecondary,
    fontSize: 15,
    fontWeight: '900',
  },
  followListMoreSpinner: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 20,
  },
  inlineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minWidth: 0,
  },
  twoColumn: {
    flexDirection: 'row',
    gap: 10,
  },
  threeColumn: {
    flexDirection: 'row',
    gap: 8,
  },
  buttonRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 14,
  },
  recipeEditPage: {
    flex: 1,
    backgroundColor: '#f4fbf6',
  },
  recipeEditWash: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 210,
    backgroundColor: '#ecfdf5',
  },
  recipeEditScroll: {
    flex: 1,
  },
  recipeEditContent: {
    minHeight: '100%',
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  recipeEditHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
    paddingHorizontal: 2,
    paddingBottom: 12,
  },
  recipeEditHeaderCopy: {
    flex: 1,
    minWidth: 0,
  },
  recipeEditTitle: {
    color: '#111827',
    fontSize: 22,
    lineHeight: 29,
    fontWeight: '900',
  },
  recipeEditSubtitle: {
    marginTop: 6,
    color: '#6b7280',
    fontSize: 13,
    lineHeight: 20,
  },
  recipeFavoriteToggle: {
    minHeight: 32,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    borderRadius: 999,
    backgroundColor: '#fff',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e5e7eb',
  },
  recipeFavoriteToggleActive: {
    backgroundColor: '#ecfdf5',
    borderColor: '#bbf7d0',
  },
  recipeFavoriteToggleText: {
    color: '#6b7280',
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '800',
  },
  recipeFavoriteToggleTextActive: {
    color: '#00a26d',
  },
  recipeEditCard: {
    marginBottom: 12,
    padding: 16,
    borderRadius: 14,
    backgroundColor: '#fff',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(0, 0, 0, 0.04)',
    shadowColor: '#0f172a',
    shadowOpacity: 0.06,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  recipeEditCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 12,
  },
  recipeEditSectionTitle: {
    color: '#111827',
    fontSize: 15,
    lineHeight: 21,
    fontWeight: '800',
    marginBottom: 12,
  },
  recipeEditFormItem: {
    marginBottom: 12,
  },
  recipeEditLabel: {
    color: '#6b7280',
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
    marginBottom: 6,
  },
  recipeEditInput: {
    minHeight: 42,
    borderRadius: 9,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e5e7eb',
    backgroundColor: '#f9fafb',
    paddingHorizontal: 12,
    paddingVertical: 0,
    color: '#111827',
    fontSize: 14,
    lineHeight: 20,
  },
  recipeEditTextarea: {
    minHeight: 78,
    paddingTop: 10,
    paddingBottom: 10,
  },
  recipeImagePreview: {
    height: 88,
    marginTop: 2,
    marginBottom: 12,
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: '#f9fafb',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e5e7eb',
  },
  recipeImagePreviewPhoto: {
    width: '100%',
    height: '100%',
  },
  recipeImagePreviewEmpty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  recipeImagePreviewText: {
    color: '#9ca3af',
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '600',
  },
  recipeMealOptions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  recipeMealOption: {
    minHeight: 34,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
    borderRadius: 10,
    backgroundColor: '#f3f4f6',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'transparent',
  },
  recipeMealOptionActive: {
    backgroundColor: '#ecfdf5',
    borderColor: '#00bc7d',
  },
  recipeMealOptionText: {
    color: '#374151',
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
  },
  recipeMealOptionTextActive: {
    color: '#047857',
  },
  recipeSummaryGrid: {
    flexDirection: 'row',
    gap: 8,
  },
  recipeSummaryItem: {
    flex: 1,
    minHeight: 66,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: '#f9fafb',
  },
  recipeSummaryValue: {
    color: '#00bc7d',
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '900',
  },
  recipeSummaryLabel: {
    marginTop: 3,
    color: '#9ca3af',
    fontSize: 11,
    lineHeight: 15,
    textAlign: 'center',
  },
  recipeWeightLine: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#eef2f7',
  },
  recipeWeightText: {
    color: '#6b7280',
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '700',
  },
  recipeWeightValue: {
    color: '#111827',
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '800',
  },
  recipeAddItemButton: {
    minHeight: 30,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    borderRadius: 999,
    backgroundColor: '#ecfdf5',
  },
  recipeAddItemText: {
    color: '#00a26d',
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '800',
  },
  recipeItemEditor: {
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#eef2f7',
  },
  recipeItemHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    marginBottom: 8,
  },
  recipeItemTitle: {
    color: '#111827',
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '800',
  },
  recipeItemRemove: {
    minHeight: 28,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    borderRadius: 999,
    backgroundColor: '#fef2f2',
  },
  recipeItemRemoveText: {
    color: '#dc2626',
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '800',
  },
  recipeTwoColumn: {
    flexDirection: 'row',
    gap: 10,
  },
  recipeThreeColumn: {
    flexDirection: 'row',
    gap: 8,
  },
  recipeEditActionBar: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 2,
  },
  recipeSaveButton: {
    flex: 1,
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    borderRadius: 12,
    backgroundColor: '#00bc7d',
    shadowColor: '#00bc7d',
    shadowOpacity: 0.2,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  recipeSaveButtonDisabled: {
    opacity: 0.68,
  },
  recipeSaveButtonText: {
    color: '#fff',
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '900',
  },
  recipeDeleteButton: {
    flex: 1,
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    borderRadius: 12,
    backgroundColor: '#fef2f2',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#fecaca',
  },
  recipeDeleteButtonText: {
    color: '#dc2626',
    fontSize: 15,
    lineHeight: 21,
    fontWeight: '900',
  },
  recipeEditEmptyCard: {
    marginTop: 60,
    paddingHorizontal: 16,
    paddingVertical: 24,
    borderRadius: 14,
    backgroundColor: '#fff',
    alignItems: 'center',
    shadowColor: '#0f172a',
    shadowOpacity: 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  recipeEditEmptyIcon: {
    fontSize: 40,
    lineHeight: 48,
  },
  recipeEditEmptyTitle: {
    marginTop: 8,
    color: '#111827',
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '800',
  },
  recipeEditEmptyDesc: {
    marginTop: 6,
    color: '#6b7280',
    fontSize: 13,
    lineHeight: 20,
    textAlign: 'center',
  },
  recipeEditLoadingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.72)',
  },
  invitePage: {
    flex: 1,
    backgroundColor: '#f3f7f4',
  },
  inviteScroll: {
    flex: 1,
  },
  inviteContent: {
    paddingHorizontal: 12,
    paddingTop: 16,
    paddingBottom: 24,
  },
  inviteHero: {
    paddingHorizontal: 4,
    paddingTop: 8,
    paddingBottom: 8,
    marginBottom: 12,
  },
  inviteEyebrow: {
    alignSelf: 'flex-start',
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 999,
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '800',
    color: '#047857',
    backgroundColor: 'rgba(16, 185, 129, 0.12)',
  },
  inviteTitle: {
    marginTop: 10,
    fontSize: 24,
    lineHeight: 30,
    fontWeight: '900',
    color: '#0f172a',
  },
  inviteSubtitle: {
    marginTop: 8,
    fontSize: 13,
    lineHeight: 22,
    color: '#475569',
  },
  inviteCard: {
    marginBottom: 12,
    padding: 14,
    borderRadius: 14,
    backgroundColor: 'rgba(255, 255, 255, 0.94)',
    shadowColor: '#0f172a',
    shadowOpacity: 0.06,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
    elevation: 2,
  },
  inviterCard: {
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.10)',
  },
  inviteProfileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  inviteAvatar: {
    width: 52,
    height: 52,
    borderRadius: 14,
    backgroundColor: '#ecfdf5',
  },
  inviteAvatarFallback: {
    width: 52,
    height: 52,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ecfdf5',
  },
  inviteAvatarText: {
    color: '#10b981',
    fontSize: 20,
    fontWeight: '900',
  },
  inviterCopy: {
    flex: 1,
    minWidth: 0,
  },
  inviterName: {
    fontSize: 17,
    lineHeight: 23,
    fontWeight: '900',
    color: '#0f172a',
  },
  inviterDesc: {
    marginTop: 5,
    fontSize: 12,
    lineHeight: 19,
    color: '#64748b',
  },
  inviteCodeChip: {
    marginTop: 12,
    paddingHorizontal: 11,
    paddingVertical: 10,
    borderRadius: 11,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    backgroundColor: '#ecfdf5',
  },
  inviteCodeLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  inviteCodeLabel: {
    fontSize: 12,
    fontWeight: '800',
    color: '#047857',
  },
  inviteCodeValue: {
    flexShrink: 1,
    fontSize: 15,
    fontWeight: '900',
    color: '#065f46',
    letterSpacing: 1,
    textAlign: 'right',
  },
  inviteRelationText: {
    marginTop: 10,
    fontSize: 12,
    lineHeight: 18,
    color: '#64748b',
  },
  rulesCard: {
    gap: 9,
  },
  inviteRuleItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 9,
  },
  inviteRuleIndex: {
    width: 28,
    height: 28,
    borderRadius: 9,
    overflow: 'hidden',
    backgroundColor: '#0f172a',
    color: '#fff',
    fontSize: 11,
    lineHeight: 28,
    fontWeight: '900',
    textAlign: 'center',
  },
  inviteRuleText: {
    flex: 1,
    minWidth: 0,
    fontSize: 13,
    lineHeight: 22,
    color: '#1f2937',
  },
  inviteQrCard: {
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.10)',
  },
  inviteQrHeader: {
    marginBottom: 10,
  },
  inviteQrTitle: {
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '900',
    color: '#0f172a',
  },
  inviteQrDesc: {
    marginTop: 4,
    fontSize: 12,
    lineHeight: 19,
    color: '#64748b',
  },
  inviteQrBox: {
    minHeight: 210,
    borderRadius: 14,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: 'rgba(16, 185, 129, 0.22)',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f8fffb',
  },
  inviteQrOuter: {
    alignSelf: 'center',
    padding: 12,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: '#FFFFFF',
  },
  inviteQrOuterLarge: {
    marginVertical: 18,
  },
  inviteQrMatrix: {
    width: 204,
    height: 204,
    backgroundColor: '#FFFFFF',
  },
  inviteQrMatrixLarge: {
    width: 282,
    height: 282,
  },
  inviteQrRow: {
    flex: 1,
    flexDirection: 'row',
  },
  inviteQrCell: {
    flex: 1,
  },
  inviteQrCellDark: {
    backgroundColor: '#111827',
  },
  inviteQrCellLight: {
    backgroundColor: '#FFFFFF',
  },
  inviteQrModalBackdrop: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 18,
    backgroundColor: 'rgba(17, 24, 39, 0.62)',
  },
  inviteQrModalCard: {
    width: '100%',
    maxWidth: 360,
    borderRadius: 16,
    padding: 16,
    backgroundColor: colors.surface,
    gap: 10,
  },
  noticeText: {
    marginTop: 10,
    color: colors.warning,
    fontSize: 12,
    lineHeight: 18,
  },
  inviteActions: {
    gap: 9,
    marginTop: -4,
    marginBottom: 12,
  },
  inviteActionButton: {
    height: 48,
    borderRadius: 24,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#10b981',
    shadowColor: '#10b981',
    shadowOpacity: 0.24,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 2,
  },
  inviteActionButtonGhost: {
    backgroundColor: 'rgba(255, 255, 255, 0.94)',
    borderWidth: 1,
    borderColor: 'rgba(15, 118, 110, 0.14)',
    shadowOpacity: 0,
    elevation: 0,
  },
  inviteActionButtonText: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '800',
    color: '#fff',
  },
  inviteActionButtonTextGhost: {
    color: '#0f766e',
  },
  inviteEmpty: {
    paddingVertical: 20,
    alignItems: 'center',
  },
  inviteEmptyText: {
    color: '#94a3b8',
    fontSize: 12,
    lineHeight: 18,
  },
  autoRenewPage: {
    flex: 1,
    backgroundColor: '#f0fdf4',
  },
  autoRenewScroll: {
    flex: 1,
  },
  autoRenewContent: {
    paddingHorizontal: 14,
    paddingTop: 14,
  },
  autoRenewBanner: {
    borderRadius: 12,
    backgroundColor: '#12372f',
    paddingHorizontal: 16,
    paddingVertical: 17,
    shadowColor: '#00643c',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 10,
    elevation: 2,
  },
  autoRenewKicker: {
    color: '#b7f7d6',
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '700',
  },
  autoRenewTitle: {
    marginTop: 6,
    color: '#f7fff9',
    fontSize: 22,
    lineHeight: 28,
    fontWeight: '900',
  },
  autoRenewDesc: {
    marginTop: 9,
    color: 'rgba(240, 253, 244, 0.82)',
    fontSize: 12,
    lineHeight: 20,
    fontWeight: '600',
  },
  autoRenewStatusPanel: {
    marginTop: 12,
    borderRadius: 12,
    backgroundColor: colors.surface,
    padding: 14,
    shadowColor: '#00643c',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 10,
    elevation: 2,
  },
  autoRenewStatusLabel: {
    color: colors.textSecondary,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '800',
  },
  autoRenewStatusValue: {
    marginTop: 3,
    color: '#064e3b',
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '900',
  },
  autoRenewStatusGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 12,
  },
  autoRenewStatusItem: {
    width: '48.5%',
    borderRadius: 9,
    backgroundColor: '#f6fdf9',
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  autoRenewStatusItemLabel: {
    color: colors.textMuted,
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '700',
  },
  autoRenewStatusItemValue: {
    marginTop: 2,
    color: colors.text,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '900',
  },
  autoRenewSection: {
    marginTop: 12,
    borderRadius: 12,
    backgroundColor: colors.surface,
    padding: 14,
    shadowColor: '#00643c',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 10,
    elevation: 2,
  },
  autoRenewSectionTitle: {
    marginBottom: 10,
    color: '#064e3b',
    fontSize: 15,
    lineHeight: 21,
    fontWeight: '900',
  },
  autoRenewServiceGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 7,
  },
  autoRenewServiceItem: {
    width: '31.6%',
    minHeight: 29,
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ecfdf5',
    paddingHorizontal: 6,
  },
  autoRenewServiceText: {
    color: '#047857',
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '800',
    textAlign: 'center',
  },
  autoRenewPriceTable: {
    overflow: 'hidden',
    borderRadius: 7,
    borderWidth: 1,
    borderColor: '#edf5f0',
  },
  autoRenewEmptyState: {
    minHeight: 54,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 9,
    backgroundColor: '#f6fdf9',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  autoRenewEmptyText: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '700',
    textAlign: 'center',
  },
  autoRenewPriceHead: {
    minHeight: 29,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f6fdf9',
  },
  autoRenewPriceHeadText: {
    flex: 1,
    color: colors.textSecondary,
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '900',
    textAlign: 'center',
  },
  autoRenewPriceNameHead: {
    flex: 1.28,
    textAlign: 'left',
    paddingLeft: 10,
  },
  autoRenewPriceRow: {
    minHeight: 46,
    flexDirection: 'row',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: '#edf5f0',
  },
  autoRenewPriceNameCol: {
    flex: 1.28,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  autoRenewTierName: {
    color: colors.text,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '900',
  },
  autoRenewTierCredits: {
    marginTop: 2,
    color: colors.textSecondary,
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '700',
  },
  autoRenewPriceCell: {
    flex: 1,
    minHeight: 46,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 2,
  },
  autoRenewPriceCellActive: {
    backgroundColor: '#ecfdf5',
  },
  autoRenewPriceText: {
    color: colors.text,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '900',
    textAlign: 'center',
  },
  autoRenewPriceTextActive: {
    color: '#00a86b',
  },
  autoRenewPriceNote: {
    marginTop: 8,
    color: '#4b5563',
    fontSize: 11,
    lineHeight: 18,
    fontWeight: '600',
  },
  autoRenewAutoCard: {
    borderWidth: 1,
    borderColor: '#bbf7d0',
  },
  autoRenewCancelCard: {
    borderWidth: 1,
    borderColor: '#bfdbfe',
  },
  autoRenewInfoRow: {
    minHeight: 31,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#edf5f0',
    paddingVertical: 7,
  },
  autoRenewInfoLabel: {
    color: colors.textSecondary,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '700',
  },
  autoRenewInfoValue: {
    flex: 1,
    color: colors.text,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '900',
    textAlign: 'right',
  },
  autoRenewInfoValueStrong: {
    color: '#00a86b',
  },
  autoRenewPlainText: {
    marginTop: 9,
    color: '#4b5563',
    fontSize: 11,
    lineHeight: 18,
    fontWeight: '600',
  },
  autoRenewPathBox: {
    marginTop: 9,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    backgroundColor: '#f8fafc',
    paddingHorizontal: 10,
    paddingVertical: 9,
    gap: 4,
  },
  autoRenewPathBoxBlue: {
    borderColor: '#dbeafe',
    backgroundColor: '#eff6ff',
  },
  autoRenewCheckRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 10,
  },
  autoRenewCheckbox: {
    width: 17,
    height: 17,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  autoRenewCheckboxActive: {
    borderColor: '#00bc7d',
    backgroundColor: '#00bc7d',
  },
  autoRenewCheckboxText: {
    color: colors.surface,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '900',
  },
  autoRenewCheckText: {
    flex: 1,
    color: '#374151',
    fontSize: 11,
    lineHeight: 17,
    fontWeight: '700',
  },
  autoRenewLink: {
    marginTop: 4,
    color: '#047857',
    fontSize: 11,
    lineHeight: 17,
    fontWeight: '900',
  },
  autoRenewPrimaryButton: {
    height: 41,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#00bc7d',
    marginTop: 12,
  },
  autoRenewButtonDisabled: {
    opacity: 0.64,
  },
  autoRenewPrimaryButtonText: {
    color: colors.surface,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '900',
  },
  autoRenewSubscribeHint: {
    marginTop: 8,
    color: '#047857',
    fontSize: 11,
    lineHeight: 17,
    fontWeight: '800',
    textAlign: 'center',
  },
  autoRenewManageText: {
    marginTop: 9,
    color: '#4b5563',
    fontSize: 11,
    lineHeight: 18,
    fontWeight: '700',
  },
  autoRenewPathText: {
    color: '#1d4ed8',
    fontSize: 11,
    lineHeight: 18,
    fontWeight: '800',
  },
  autoRenewSecondaryButton: {
    height: 41,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#eff6ff',
    borderWidth: 1,
    borderColor: '#bfdbfe',
    marginTop: 12,
  },
  autoRenewSecondaryButtonText: {
    color: '#1d4ed8',
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '900',
  },
  autoRenewModalButton: {
    height: 38,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#00bc7d',
    marginTop: 13,
  },
  autoRenewModalButtonText: {
    color: colors.surface,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '900',
  },
  auditHeroRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  auditKicker: {
    color: colors.brandDark,
    fontSize: 12,
    fontWeight: '900',
  },
  auditTitle: {
    marginTop: 4,
    color: colors.text,
    fontSize: 22,
    lineHeight: 28,
    fontWeight: '900',
  },
  auditBadge: {
    borderRadius: 999,
    backgroundColor: colors.brandSoft,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  auditBadgeText: {
    color: colors.brandDark,
    fontSize: 12,
    fontWeight: '900',
  },
  auditMiniBadge: {
    borderRadius: 999,
    backgroundColor: '#eff6ff',
    paddingHorizontal: 9,
    paddingVertical: 5,
  },
  auditMiniBadgeText: {
    color: '#1d4ed8',
    fontSize: 11,
    fontWeight: '900',
  },
  auditPreviewNote: {
    marginTop: 10,
    color: colors.brandDark,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '800',
    borderRadius: 12,
    backgroundColor: colors.brandSoft,
    padding: 10,
  },
  auditModalBackdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(15, 23, 42, 0.48)',
    padding: 18,
  },
  auditModal: {
    width: '100%',
    maxWidth: 310,
    borderRadius: 12,
    backgroundColor: colors.surface,
    paddingHorizontal: 15,
    paddingTop: 17,
    paddingBottom: 15,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.2,
    shadowRadius: 24,
    elevation: 8,
  },
  auditModalTitle: {
    color: colors.text,
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '900',
    textAlign: 'center',
  },
  auditModalBody: {
    marginTop: 11,
    borderRadius: 8,
    backgroundColor: '#f8fafc',
    padding: 11,
    gap: 4,
  },
  auditModalLine: {
    color: '#334155',
    fontSize: 12,
    lineHeight: 20,
    fontWeight: '700',
  },
  featureGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  featurePill: {
    minHeight: 38,
    minWidth: '30%',
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.brandSoft,
    paddingHorizontal: 10,
  },
  featurePillText: {
    color: colors.brandDark,
    fontWeight: '800',
  },
  planRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    padding: 12,
    marginTop: 10,
    backgroundColor: colors.surface,
  },
  planRowActive: {
    borderColor: colors.brand,
    backgroundColor: '#f0fdf4',
  },
  priceBlock: {
    alignItems: 'flex-end',
  },
  priceText: {
    color: colors.brandDark,
    fontSize: 18,
    fontWeight: '900',
  },
  originalPrice: {
    color: colors.textMuted,
    fontSize: 12,
    textDecorationLine: 'line-through',
    marginTop: 4,
  },
  infoLine: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingVertical: 10,
  },
  infoLabel: {
    color: colors.textSecondary,
  },
  infoValue: {
    flex: 1,
    color: colors.text,
    fontWeight: '800',
    textAlign: 'right',
  },
  checkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 16,
    marginBottom: 12,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 7,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  checkboxActive: {
    borderColor: colors.brand,
    backgroundColor: colors.brand,
  },
  checkboxText: {
    color: '#fff',
    fontWeight: '900',
    lineHeight: 18,
  },
  checkText: {
    flex: 1,
    color: colors.textSecondary,
    lineHeight: 20,
    fontWeight: '700',
  },
  pathText: {
    color: '#1d4ed8',
    fontWeight: '900',
    lineHeight: 22,
    borderRadius: 12,
    backgroundColor: '#eff6ff',
    padding: 12,
    marginBottom: 12,
  },
  publicFoodShareRoot: {
    flex: 1,
    backgroundColor: '#f9fafb',
  },
  publicFoodShareGatePage: {
    flex: 1,
    justifyContent: 'center',
    padding: 24,
    backgroundColor: '#f6f8fa',
  },
  publicFoodShareGateCard: {
    gap: 14,
    borderRadius: 18,
    padding: 20,
    backgroundColor: '#ffffff',
  },
  publicFoodShareGateTitle: {
    color: '#16332a',
    fontSize: 21,
    fontWeight: '900',
  },
  publicFoodShareGateText: {
    color: '#64748b',
    fontSize: 14,
    lineHeight: 21,
  },
  publicFoodShareScroll: {
    flex: 1,
  },
  publicFoodShareScrollContent: {
    paddingTop: 0,
  },
  publicFoodShareBody: {
    paddingBottom: 0,
  },
  publicFoodShareHero: {
    marginHorizontal: 12,
    marginTop: 12,
    marginBottom: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(92, 184, 150, 0.12)',
    backgroundColor: '#f4faf8',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  publicFoodShareHeroCampus: {
    backgroundColor: '#f0fdf9',
  },
  publicFoodShareHeroTitle: {
    color: '#047857',
    fontSize: 17,
    lineHeight: 23,
    fontWeight: '900',
  },
  publicFoodShareHeroSubtitle: {
    marginTop: 4,
    color: '#065f46',
    fontSize: 13,
    lineHeight: 21,
    fontWeight: '700',
  },
  publicFoodShareSection: {
    marginBottom: 12,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 2,
    backgroundColor: '#fff',
  },
  publicFoodShareSectionHeader: {
    minHeight: 24,
    marginBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  publicFoodShareSectionTitle: {
    color: '#1e2939',
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '900',
  },
  publicFoodShareRequired: {
    color: colors.danger,
    fontSize: 16,
    fontWeight: '900',
  },
  publicFoodShareMeta: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '800',
  },
  publicFoodNutritionSummary: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingVertical: 12,
    borderRadius: 8,
    backgroundColor: '#f9fafb',
    marginBottom: 8,
  },
  publicFoodNutritionItem: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: 3,
  },
  publicFoodNutritionValue: {
    color: '#4a9e7d',
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '700',
  },
  publicFoodNutritionLabel: {
    marginTop: 4,
    color: '#6a7282',
    fontSize: 12,
    lineHeight: 16,
    textAlign: 'center',
  },
  publicFoodShareNutritionTip: {
    color: '#9ca3af',
    fontSize: 12,
    lineHeight: 17,
    textAlign: 'center',
    marginBottom: 12,
  },
  publicFoodSourceTagRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 14,
  },
  publicFoodSourceChip: {
    flex: 1,
    minHeight: 40,
    borderRadius: 7,
    borderWidth: 1,
    borderColor: 'transparent',
    backgroundColor: '#f3f4f6',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  publicFoodSourceChipActive: {
    borderColor: '#5cb896',
    backgroundColor: '#f4faf8',
  },
  publicFoodSourceChipText: {
    color: '#4b5563',
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '700',
  },
  publicFoodSourceChipTextActive: {
    color: '#059669',
    fontWeight: '800',
  },
  publicFoodRatingStars: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 14,
  },
  publicFoodRatingStar: {
    color: '#e5e7eb',
    fontSize: 20,
    lineHeight: 24,
  },
  publicFoodRatingStarActive: {
    color: '#f59e0b',
  },
  publicFoodSwitchRow: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#f3f4f6',
    marginBottom: 14,
    paddingVertical: 8,
  },
  publicFoodSwitchLabel: {
    color: '#364153',
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '700',
  },
  publicFoodSwitch: {
    width: 50,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#e5e7eb',
    padding: 2,
    justifyContent: 'center',
  },
  publicFoodSwitchActive: {
    backgroundColor: '#5cb896',
  },
  publicFoodSwitchDot: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#fff',
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  publicFoodSwitchDotActive: {
    transform: [{ translateX: 22 }],
  },
  publicFoodQuickTags: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 14,
  },
  publicFoodQuickTag: {
    borderRadius: 10,
    backgroundColor: '#f3f4f6',
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  publicFoodQuickTagActive: {
    backgroundColor: '#f4faf8',
  },
  publicFoodQuickTagText: {
    color: '#364153',
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '700',
  },
  publicFoodQuickTagTextActive: {
    color: '#4a9e7d',
  },
  publicFoodShareSourceGrid: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  publicFoodSourceOption: {
    flex: 1,
    minHeight: 76,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceMuted,
    paddingHorizontal: 10,
    paddingVertical: 10,
  },
  publicFoodSourceOptionActive: {
    borderColor: colors.brand,
    backgroundColor: colors.brandSoft,
  },
  publicFoodSourceOptionTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '900',
  },
  publicFoodSourceOptionTitleActive: {
    color: colors.brandDark,
  },
  publicFoodSourceOptionText: {
    marginTop: 4,
    color: colors.textSecondary,
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '700',
  },
  publicFoodSourceOptionTextActive: {
    color: '#047857',
  },
  publicFoodShareHint: {
    color: colors.textSecondary,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '700',
    marginBottom: 12,
  },
  publicFoodShareMacroGrid: {
    flexDirection: 'row',
    gap: 10,
  },
  publicFoodShareLocationHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 8,
  },
  publicFoodShareReferences: {
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  publicFoodShareReferenceTitle: {
    color: colors.text,
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '900',
    marginBottom: 10,
  },
  publicFoodShareReferenceCard: {
    padding: 12,
    borderRadius: 12,
    backgroundColor: '#fff',
    marginBottom: 10,
  },
  publicFoodShareSubmitBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingTop: 10,
    paddingHorizontal: 16,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: '#fff',
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: -2 },
    elevation: 4,
  },
  imageBlock: {
    marginBottom: 14,
  },
  imageGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  imageTile: {
    position: 'relative',
    width: '31.3%',
    aspectRatio: 1,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: colors.surfaceMuted,
  },
  imageThumb: {
    width: '100%',
    height: '100%',
    borderRadius: 12,
    backgroundColor: colors.surfaceMuted,
  },
  imageRemove: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.62)',
  },
  imageRemoveText: {
    color: '#fff',
    fontSize: 18,
    lineHeight: 19,
    fontWeight: '400',
    marginTop: -2,
  },
  imageAdd: {
    width: '31.3%',
    aspectRatio: 1,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceMuted,
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderStyle: 'dashed',
  },
  imageAddIcon: {
    color: '#9ca3af',
    fontSize: 32,
    lineHeight: 34,
    fontWeight: '300',
  },
  imageAddText: {
    color: '#9ca3af',
    fontSize: 12,
    fontWeight: '700',
    marginTop: 5,
  },
  nutritionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 12,
  },
  itemEditor: {
    paddingTop: 14,
    marginTop: 10,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  legalDocumentPage: {
    flex: 1,
    backgroundColor: '#f9fafb',
  },
  legalDocumentScroll: {
    flex: 1,
  },
  legalDocumentContentWrap: {
    padding: 16,
    paddingBottom: 28,
  },
  legalDocumentContent: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 20,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  legalDocumentTitle: {
    color: '#1e293b',
    fontSize: 20,
    fontWeight: '800',
    textAlign: 'center',
    marginBottom: 8,
  },
  legalDocumentUpdatedAt: {
    color: '#94a3b8',
    fontSize: 12,
    textAlign: 'center',
    marginBottom: 24,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
    borderStyle: 'dashed',
  },
  legalDocumentSection: {
    marginBottom: 20,
  },
  legalDocumentSectionTitle: {
    color: '#334155',
    fontSize: 15,
    fontWeight: '800',
    marginBottom: 8,
  },
  legalDocumentParagraph: {
    color: '#475569',
    fontSize: 14,
    lineHeight: 25,
    marginBottom: 6,
    textAlign: 'justify',
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '800',
    marginBottom: 8,
  },
  groupTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '900',
    marginBottom: 12,
    marginTop: 4,
  },
  bigTitle: {
    color: colors.text,
    fontSize: 20,
    fontWeight: '900',
    marginTop: 8,
  },
  bigNumber: {
    color: colors.brandDark,
    fontSize: 28,
    fontWeight: '900',
  },
  subtitle: {
    color: colors.textSecondary,
    lineHeight: 21,
  },
  helperText: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 18,
    marginTop: 6,
    marginBottom: 8,
  },
  itemName: {
    color: colors.text,
    fontWeight: '800',
  },
  itemMeta: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 18,
    marginTop: 4,
  },
  kcal: {
    color: colors.brandDark,
    fontWeight: '900',
  },
  chevron: {
    color: colors.textMuted,
    fontSize: 22,
  },
  checkinLeaderboardPage: {
    flex: 1,
    backgroundColor: '#fff',
  },
  checkinLeaderboardScroll: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  checkinLeaderboardHeader: {
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 12,
  },
  checkinLeaderboardTitle: {
    color: '#0f172a',
    fontSize: 20,
    lineHeight: 28,
    fontWeight: '900',
  },
  checkinLeaderboardRange: {
    marginTop: 6,
    color: '#64748b',
    fontSize: 13,
    lineHeight: 19,
  },
  checkinLeaderboardList: {
    paddingHorizontal: 16,
  },
  checkinLeaderboardRow: {
    minHeight: 72,
    marginBottom: 10,
    paddingHorizontal: 12,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e2e8f0',
    backgroundColor: '#fff',
    flexDirection: 'row',
    alignItems: 'center',
    shadowColor: '#0f172a',
    shadowOpacity: 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  checkinLeaderboardRowMine: {
    borderColor: 'rgba(0, 188, 125, 0.36)',
    shadowColor: colors.brand,
    shadowOpacity: 0.12,
  },
  checkinLeaderboardRank: {
    width: 28,
    color: '#94a3b8',
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '900',
    textAlign: 'center',
  },
  checkinLeaderboardRankTop1: {
    color: '#d97706',
  },
  checkinLeaderboardRankTop2: {
    color: '#64748b',
  },
  checkinLeaderboardRankTop3: {
    color: '#b45309',
  },
  checkinLeaderboardAvatarWrap: {
    width: 44,
    height: 44,
    marginLeft: 8,
    marginRight: 12,
    borderRadius: 22,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#e2e8f0',
  },
  checkinLeaderboardAvatar: {
    width: '100%',
    height: '100%',
  },
  checkinLeaderboardAvatarText: {
    color: '#64748b',
    fontSize: 19,
    lineHeight: 24,
  },
  checkinLeaderboardMiddle: {
    flex: 1,
    minWidth: 0,
  },
  checkinLeaderboardNameRow: {
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
  },
  checkinLeaderboardName: {
    flexShrink: 1,
    minWidth: 0,
    color: '#0f172a',
    fontSize: 15,
    lineHeight: 21,
    fontWeight: '700',
  },
  checkinLeaderboardMeTag: {
    marginLeft: 6,
    color: colors.brand,
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '800',
  },
  checkinLeaderboardCount: {
    minWidth: 60,
    alignItems: 'flex-end',
  },
  checkinLeaderboardCountNum: {
    color: colors.brand,
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '900',
  },
  checkinLeaderboardCountUnit: {
    marginTop: 2,
    color: '#94a3b8',
    fontSize: 11,
    lineHeight: 15,
  },
  checkinLeaderboardState: {
    minHeight: 220,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  checkinLeaderboardStateText: {
    color: '#64748b',
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },
  checkinLeaderboardRetry: {
    marginTop: 16,
    paddingHorizontal: 24,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: colors.brand,
  },
  checkinLeaderboardRetryText: {
    color: '#fff',
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '800',
  },
  avatarFallback: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: colors.brandSoft,
  },
  field: {
    marginBottom: 14,
  },
  fieldLabel: {
    color: colors.textSecondary,
    fontWeight: '700',
    marginBottom: 6,
  },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    color: colors.text,
    backgroundColor: colors.surfaceMuted,
  },
  textarea: {
    minHeight: 88,
    paddingTop: 12,
    paddingBottom: 12,
  },
  segment: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 16,
  },
  segmentItem: {
    flexGrow: 1,
    flexBasis: '30%',
    minHeight: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceMuted,
    paddingHorizontal: 6,
  },
  segmentItemActive: {
    backgroundColor: colors.brand,
  },
  segmentText: {
    color: colors.textSecondary,
    fontWeight: '800',
    fontSize: 13,
    textAlign: 'center',
  },
  segmentTextActive: {
    color: '#fff',
  },
  smallButton: {
    minHeight: 38,
    borderRadius: 12,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.brandSoft,
  },
  smallButtonDanger: {
    backgroundColor: '#fee2e2',
  },
  smallButtonDisabled: {
    backgroundColor: colors.surfaceMuted,
  },
  smallButtonText: {
    color: colors.brandDark,
    fontWeight: '800',
  },
  smallButtonDangerText: {
    color: colors.danger,
  },
  smallButtonTextDisabled: {
    color: colors.textMuted,
  },
  pill: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    backgroundColor: colors.brandSoft,
  },
  pillText: {
    color: colors.brandDark,
    fontSize: 12,
    fontWeight: '800',
  },
  petHomePage: {
    flex: 1,
    backgroundColor: '#f4fbf6',
  },
  petHomeScroll: {
    flex: 1,
  },
  petHomeContent: {
    paddingHorizontal: 12,
    paddingTop: 14,
    paddingBottom: 26,
  },
  petHomeHero: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    borderRadius: 18,
    padding: 14,
    marginBottom: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.86)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(92, 184, 150, 0.12)',
    shadowColor: '#0f172a',
    shadowOpacity: 0.05,
    shadowRadius: 13,
    shadowOffset: { width: 0, height: 4 },
    elevation: 1,
  },
  petHomeHeroCopy: {
    flex: 1,
    minWidth: 0,
  },
  petHomeName: {
    color: '#15212c',
    fontSize: 21,
    lineHeight: 29,
    fontWeight: '900',
  },
  petHomeMetaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 7,
  },
  petHomeChip: {
    overflow: 'hidden',
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 4,
    color: '#2f7f62',
    backgroundColor: 'rgba(92, 184, 150, 0.12)',
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '900',
  },
  petHomeChipMuted: {
    overflow: 'hidden',
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 4,
    color: '#64748b',
    backgroundColor: 'rgba(148, 163, 184, 0.1)',
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '800',
  },
  petHomeMessage: {
    color: '#5f6b7a',
    fontSize: 13,
    lineHeight: 20,
    marginTop: 7,
  },
  petHomeCard: {
    borderRadius: 16,
    padding: 13,
    marginBottom: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.86)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(92, 184, 150, 0.1)',
    shadowColor: '#0f172a',
    shadowOpacity: 0.045,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 3 },
    elevation: 1,
  },
  petHomeChatCard: {
    backgroundColor: 'rgba(241, 250, 245, 0.94)',
    borderColor: 'rgba(92, 184, 150, 0.18)',
  },
  petHomeCardHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    marginBottom: 9,
  },
  petHomeCardTitle: {
    flexShrink: 1,
    color: '#18222d',
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '900',
  },
  petHomeCardSide: {
    color: '#8a94a3',
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '800',
  },
  petHomeBodyText: {
    color: '#657180',
    fontSize: 13,
    lineHeight: 20,
  },
  petHomeInlineAction: {
    alignSelf: 'flex-start',
    minHeight: 34,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
    marginTop: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  petHomeInlineActionPrimary: {
    backgroundColor: colors.brand,
    shadowColor: colors.brand,
    shadowOpacity: 0.18,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 1,
  },
  petHomeInlineActionText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '900',
  },
  petHomeReasonItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 9,
    marginTop: 7,
    backgroundColor: 'rgba(92, 184, 150, 0.07)',
  },
  petHomeReasonDot: {
    color: colors.brand,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '900',
  },
  petHomeReasonText: {
    flex: 1,
    minWidth: 0,
    color: '#566273',
    fontSize: 13,
    lineHeight: 20,
  },
  petHomeUnlockRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 10,
  },
  petHomeUnlockChip: {
    overflow: 'hidden',
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 5,
    color: '#64748b',
    backgroundColor: '#f1f5f9',
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '800',
  },
  petHomeCandidateGrid: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 10,
  },
  petHomeCandidateCard: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'transparent',
    borderRadius: 14,
    paddingHorizontal: 8,
    paddingVertical: 10,
    backgroundColor: '#f7fafc',
  },
  petHomeCandidateCardActive: {
    borderColor: 'rgba(92, 184, 150, 0.34)',
    backgroundColor: 'rgba(92, 184, 150, 0.09)',
  },
  petHomeCandidateName: {
    color: '#17212b',
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '900',
    marginTop: 6,
    textAlign: 'center',
  },
  petHomeCandidateMeta: {
    minHeight: 32,
    color: '#7a8696',
    fontSize: 11,
    lineHeight: 16,
    textAlign: 'center',
  },
  petHomeCandidateAction: {
    overflow: 'hidden',
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 4,
    marginTop: 4,
    color: '#fff',
    backgroundColor: '#17212b',
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '900',
  },
  petHomeProgressTrack: {
    height: 8,
    borderRadius: 999,
    overflow: 'hidden',
    backgroundColor: '#e8edf3',
    marginBottom: 10,
  },
  petHomeProgressFill: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: colors.brand,
  },
  petHomeMetricGrid: {
    flexDirection: 'row',
    gap: 8,
  },
  petHomeScoreGrid: {
    flexDirection: 'row',
    gap: 8,
  },
  petHomeMetric: {
    flex: 1,
    minWidth: 0,
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 10,
    backgroundColor: 'rgba(92, 184, 150, 0.08)',
  },
  petHomeMetricLabel: {
    color: '#7a8696',
    fontSize: 12,
    lineHeight: 16,
    marginBottom: 4,
  },
  petHomeMetricValue: {
    color: '#17212b',
    fontSize: 17,
    lineHeight: 22,
    fontWeight: '900',
  },
  petHomeTask: {
    color: '#3a8b6b',
    fontSize: 13,
    lineHeight: 20,
    fontWeight: '800',
    marginTop: 10,
  },
  petHomeEventTitle: {
    color: '#17212b',
    fontSize: 15,
    lineHeight: 21,
    fontWeight: '900',
    marginBottom: 4,
  },
  petHomeActionList: {
    gap: 8,
  },
  petHomeActionItem: {
    minHeight: 62,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    borderRadius: 14,
    paddingHorizontal: 11,
    paddingVertical: 10,
    backgroundColor: 'rgba(92, 184, 150, 0.08)',
  },
  petHomeActionTitle: {
    color: '#17212b',
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '900',
  },
  petHomeActionDesc: {
    color: '#7a8696',
    fontSize: 12,
    lineHeight: 18,
    marginTop: 2,
  },
  petHomeActionSide: {
    flexShrink: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  petHomeActionStatus: {
    color: '#2f7f62',
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '900',
  },
  petHomeActionStatusMuted: {
    color: '#94a3b8',
  },
  petHomeToggle: {
    width: 38,
    height: 22,
    borderRadius: 999,
    padding: 2,
    backgroundColor: '#d9e2ea',
  },
  petHomeToggleActive: {
    backgroundColor: colors.brand,
  },
  petHomeToggleKnob: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#fff',
    shadowColor: '#0f172a',
    shadowOpacity: 0.12,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  petHomeToggleKnobActive: {
    transform: [{ translateX: 16 }],
  },
  petHomeActionCost: {
    color: '#2f7f62',
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '900',
  },
  petLabPage: {
    flex: 1,
    backgroundColor: '#f4fbf6',
  },
  petLabScroll: {
    flex: 1,
  },
  petLabContent: {
    paddingHorizontal: 12,
    paddingTop: 14,
    paddingBottom: 28,
  },
  petLabHero: {
    borderRadius: 18,
    padding: 14,
    marginBottom: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.88)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(92, 184, 150, 0.12)',
    shadowColor: '#0f172a',
    shadowOpacity: 0.05,
    shadowRadius: 13,
    shadowOffset: { width: 0, height: 4 },
    elevation: 1,
  },
  petLabTitle: {
    color: '#13202b',
    fontSize: 22,
    lineHeight: 30,
    fontWeight: '900',
  },
  petLabSubtitle: {
    color: '#64748b',
    fontSize: 13,
    lineHeight: 20,
    marginTop: 5,
  },
  petLabStatRow: {
    flexDirection: 'row',
    gap: 7,
    marginTop: 12,
  },
  petLabStat: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 6,
    backgroundColor: 'rgba(92, 184, 150, 0.09)',
  },
  petLabStatValue: {
    color: '#1f8a68',
    fontSize: 18,
    lineHeight: 22,
    fontWeight: '900',
  },
  petLabStatLabel: {
    color: '#6b7280',
    fontSize: 10,
    lineHeight: 14,
    fontWeight: '800',
    marginTop: 3,
  },
  petLabPanel: {
    borderRadius: 16,
    padding: 13,
    marginBottom: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.88)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(92, 184, 150, 0.1)',
    shadowColor: '#0f172a',
    shadowOpacity: 0.045,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 3 },
    elevation: 1,
  },
  petLabCurrentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 10,
  },
  petLabCurrentCopy: {
    flex: 1,
    minWidth: 0,
  },
  petLabPanelTitle: {
    color: '#17212b',
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '900',
    marginBottom: 7,
  },
  petLabCurrentName: {
    color: '#17212b',
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '900',
  },
  petLabCopy: {
    color: '#64748b',
    fontSize: 12,
    lineHeight: 19,
  },
  petLabTagRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 8,
  },
  petLabTag: {
    overflow: 'hidden',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
    color: '#2f7f62',
    backgroundColor: 'rgba(92, 184, 150, 0.1)',
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '800',
  },
  petLabRerollButton: {
    alignSelf: 'flex-start',
    minHeight: 34,
    minWidth: 126,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
    paddingVertical: 8,
    marginTop: 10,
    backgroundColor: '#17212b',
  },
  petLabRerollText: {
    color: '#fff',
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '900',
  },
  petLabFormula: {
    borderRadius: 12,
    padding: 10,
    marginTop: 10,
    backgroundColor: '#101827',
  },
  petLabArchetypeNote: {
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 9,
    marginTop: 10,
    backgroundColor: 'rgba(92, 184, 150, 0.08)',
  },
  petLabArchetypeNoteText: {
    color: '#2f7f62',
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '800',
  },
  petLabCode: {
    color: '#dbeafe',
    fontSize: 11,
    lineHeight: 17,
  },
  petLabSampleScroll: {
    marginTop: 10,
  },
  petLabSampleRow: {
    gap: 8,
    paddingRight: 4,
  },
  petLabSampleCard: {
    width: 92,
    alignItems: 'center',
    borderRadius: 14,
    paddingHorizontal: 8,
    paddingVertical: 10,
    backgroundColor: 'rgba(92, 184, 150, 0.08)',
  },
  petLabSampleCard_pretty: {
    backgroundColor: 'rgba(92, 184, 150, 0.1)',
  },
  petLabSampleCard_quirky: {
    backgroundColor: 'rgba(139, 92, 246, 0.08)',
  },
  petLabSampleCard_risky: {
    backgroundColor: 'rgba(244, 114, 182, 0.08)',
  },
  petLabSampleTitle: {
    color: '#17212b',
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '900',
    marginTop: 6,
  },
  petLabSampleSub: {
    color: '#94a3b8',
    fontSize: 10,
    lineHeight: 14,
    fontWeight: '700',
  },
  petLabFilter: {
    marginTop: 11,
  },
  petLabFilterTitle: {
    color: '#64748b',
    fontSize: 12,
    lineHeight: 16,
    marginBottom: 7,
    fontWeight: '800',
  },
  petLabFilterRow: {
    gap: 7,
    paddingRight: 4,
  },
  petLabPill: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: 'transparent',
    backgroundColor: '#f1f5f9',
  },
  petLabPillActive: {
    borderColor: 'rgba(92, 184, 150, 0.35)',
    backgroundColor: 'rgba(92, 184, 150, 0.12)',
  },
  petLabPillText: {
    color: '#475569',
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '800',
  },
  petLabPillTextActive: {
    color: '#2f7f62',
  },
  petLabGridHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    marginHorizontal: 2,
    marginTop: 6,
    marginBottom: 10,
  },
  petLabGridTitle: {
    color: '#17212b',
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '900',
  },
  petLabGridSide: {
    color: '#94a3b8',
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '800',
  },
  petLabGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: 9,
  },
  petLabCard: {
    width: '48.6%',
    minHeight: 212,
    alignItems: 'center',
    borderRadius: 15,
    paddingHorizontal: 8,
    paddingVertical: 11,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(148, 163, 184, 0.12)',
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
  },
  petLabCard_pretty: {
    borderColor: 'rgba(92, 184, 150, 0.18)',
    backgroundColor: 'rgba(248, 255, 252, 0.94)',
  },
  petLabCard_quirky: {
    borderColor: 'rgba(139, 92, 246, 0.14)',
    backgroundColor: 'rgba(250, 248, 255, 0.94)',
  },
  petLabCard_risky: {
    borderColor: 'rgba(244, 114, 182, 0.18)',
    backgroundColor: 'rgba(255, 247, 250, 0.94)',
  },
  petLabCardTitle: {
    color: '#17212b',
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '900',
    marginTop: 7,
    textAlign: 'center',
  },
  petLabCardBadge: {
    overflow: 'hidden',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
    marginTop: 3,
    marginBottom: 5,
    color: '#2f7f62',
    backgroundColor: 'rgba(92, 184, 150, 0.1)',
    fontSize: 10,
    lineHeight: 14,
    fontWeight: '800',
  },
  petLabCardDesc: {
    color: '#64748b',
    fontSize: 10,
    lineHeight: 15,
    textAlign: 'center',
  },
  petLabCardReason: {
    minHeight: 35,
    overflow: 'hidden',
    borderRadius: 10,
    paddingHorizontal: 7,
    paddingVertical: 6,
    marginTop: 6,
    color: '#64748b',
    backgroundColor: 'rgba(92, 184, 150, 0.07)',
    fontSize: 10,
    lineHeight: 15,
    textAlign: 'center',
  },
  petLabCardReasonWarn: {
    color: '#9f426d',
    backgroundColor: 'rgba(244, 114, 182, 0.08)',
  },
  petLabSelectButton: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    marginTop: 7,
    backgroundColor: '#17212b',
  },
  petLabSelectText: {
    color: '#fff',
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '900',
  },
  petLabLoadMore: {
    minHeight: 38,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 14,
    marginBottom: 4,
    backgroundColor: '#17212b',
  },
  petLabLoadMoreText: {
    color: '#fff',
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '900',
  },
  petLabDetailMask: {
    flex: 1,
    justifyContent: 'flex-end',
    padding: 12,
    backgroundColor: 'rgba(15, 23, 42, 0.42)',
  },
  petLabDetail: {
    alignItems: 'center',
    borderRadius: 22,
    paddingHorizontal: 16,
    paddingTop: 18,
    paddingBottom: 24,
    backgroundColor: '#fff',
  },
  petLabDetailTitle: {
    color: '#17212b',
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '900',
    marginTop: 8,
  },
  petLabDetailCopy: {
    color: '#64748b',
    fontSize: 12,
    lineHeight: 18,
    marginTop: 4,
    textAlign: 'center',
  },
  petLabDetailTags: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 6,
    marginTop: 12,
  },
  petLabDetailTag: {
    overflow: 'hidden',
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 5,
    color: '#2f7f62',
    backgroundColor: 'rgba(92, 184, 150, 0.1)',
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '800',
  },
  petLabDetailReason: {
    alignSelf: 'stretch',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginTop: 8,
    color: '#2f7f62',
    backgroundColor: 'rgba(92, 184, 150, 0.08)',
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
  },
  petLabDetailReasonWarn: {
    color: '#9f426d',
    backgroundColor: 'rgba(244, 114, 182, 0.08)',
  },
  petLabDetailClose: {
    color: '#94a3b8',
    fontSize: 12,
    lineHeight: 16,
    marginTop: 12,
  },
  petHero: {
    borderRadius: 18,
    alignItems: 'center',
    marginBottom: 12,
  },
  petMoodText: {
    color: colors.textSecondary,
    fontWeight: '800',
    marginTop: 6,
  },
  petStatsGrid: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 14,
  },
  petCandidateCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    padding: 12,
    marginTop: 12,
    backgroundColor: colors.surface,
  },
  petCandidateCardActive: {
    borderColor: colors.brand,
    backgroundColor: colors.brandSoft,
  },
  petActionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: 12,
    marginTop: 12,
  },
  petStat: {
    flex: 1,
    borderRadius: 14,
    paddingVertical: 11,
    paddingHorizontal: 8,
    alignItems: 'center',
    backgroundColor: colors.surfaceMuted,
  },
  petStatValue: {
    color: colors.brandDark,
    fontSize: 18,
    fontWeight: '900',
  },
  petStatLabel: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '800',
    marginTop: 3,
    textAlign: 'center',
  },
  appearanceGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 12,
  },
  progressTrack: {
    height: 10,
    borderRadius: 999,
    backgroundColor: colors.surfaceMuted,
    marginTop: 14,
    overflow: 'hidden',
  },
  progressFill: {
    height: 10,
    borderRadius: 999,
    backgroundColor: colors.brand,
  },
})
