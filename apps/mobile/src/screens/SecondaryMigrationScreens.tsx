import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, Image, Modal, Pressable, Share, StyleSheet, Text, TextInput, View } from 'react-native'
import * as Clipboard from 'expo-clipboard'
import * as ImagePicker from 'expo-image-picker'
import qrcode from 'qrcode-generator'
import { useFocusEffect, useNavigation, useRoute, type RouteProp } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import {
  getMealTypeLabel,
  type CheckinLeaderboardItem,
  type FollowUserItem,
  type MealType,
  type MembershipPlan,
  type MembershipStatus,
  type PetAppearanceCandidate,
  type PetSummary,
  type PublicFoodItem,
  type RecipeItem,
} from '@food-link/core'
import { apiClient } from '../api'
import { AppButton } from '../components/AppButton'
import { Card } from '../components/Card'
import { Page } from '../components/Page'
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
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  const [items, setItems] = useState<CheckinLeaderboardItem[]>([])
  const [range, setRange] = useState('')
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await apiClient.communityGetCheckinLeaderboard()
      setItems(data.list || [])
      setRange(data.week_start && data.week_end ? `${data.week_start} - ${data.week_end}` : '')
    } catch (error) {
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
    <Page title="打卡排行榜" subtitle={range || '本周饮食、运动记录排行'} refreshing={loading} onRefresh={load}>
      {items.length === 0 ? <EmptyState text="暂无排行榜数据" /> : null}
      {items.map((item, index) => {
        const rank = item.rank || index + 1
        const checkinCount = item.checkin_count ?? item.record_count ?? 0
        const nickname = item.nickname || '食友'
        return (
          <Pressable key={item.user_id} onPress={() => navigation.navigate('ProfileSettings', { userId: item.user_id })}>
            <Card style={[styles.leaderboardCard, item.is_me ? styles.leaderboardCardMine : null]}>
              <View style={styles.rowBetween}>
                <View style={[styles.rankNo, rank <= 3 ? styles.rankNoTop : null]}>
                  <Text style={[styles.rankNoText, rank <= 3 ? styles.rankNoTextTop : null]}>{rank}</Text>
                </View>
                {item.avatar ? (
                  <Image source={{ uri: item.avatar }} style={styles.leaderboardAvatar} />
                ) : (
                  <View style={styles.leaderboardAvatarFallback}>
                    <Text style={styles.leaderboardAvatarText}>{nickname.slice(0, 1)}</Text>
                  </View>
                )}
                <View style={styles.flex}>
                  <View style={styles.inlineRow}>
                    <Text style={[styles.itemName, styles.leaderboardName]} numberOfLines={1}>{nickname}</Text>
                    {item.is_me ? <Pill text="我" /> : null}
                  </View>
                  <Text style={styles.subtitle}>本周好友圈打卡排行</Text>
                </View>
                <View style={styles.leaderboardCount}>
                  <Text style={styles.leaderboardCountValue}>{checkinCount}</Text>
                  <Text style={styles.itemMeta}>次打卡</Text>
                </View>
                <Text style={styles.chevron}>›</Text>
              </View>
            </Card>
          </Pressable>
        )
      })}
    </Page>
  )
}

export function InviteFriendsScreen() {
  const route = useRoute<RouteProp<RootStackParamList, 'InviteFriends'>>()
  const [profile, setProfile] = useState<Record<string, unknown> | null>(null)
  const [currentUserId, setCurrentUserId] = useState('')
  const [inviteCode, setInviteCode] = useState('')
  const [resolveCode, setResolveCode] = useState('')
  const [resolvedName, setResolvedName] = useState('')
  const [resolvedProfile, setResolvedProfile] = useState<Record<string, unknown> | null>(null)
  const [inviteNotice, setInviteNotice] = useState('')
  const [loading, setLoading] = useState(false)
  const [qrPreviewOpen, setQrPreviewOpen] = useState(false)
  const routeInviteCode = useMemo(
    () => normalizeInviteCode(route.params?.inviteCode || route.params?.invite_code || route.params?.fi),
    [route.params?.fi, route.params?.inviteCode, route.params?.invite_code],
  )
  const inviteLink = useMemo(() => buildInviteDeepLink(inviteCode), [inviteCode])
  const inviteMessage = useMemo(() => buildInviteMessage(profile, inviteCode, inviteLink), [inviteCode, inviteLink, profile])
  const inviterUserId = profileUserId(profile)
  const isInviteOwner = Boolean(currentUserId && inviterUserId && currentUserId === inviterUserId)
  const relationProfile = resolvedProfile || profile
  const relationText = inviteRelationText(relationProfile)
  const inviteActionDone = inviteRelationHandled(relationProfile)
  const inviteActionLabel = inviteActionText(relationProfile)
  const inviteTitle = String(profile?.nickname || (isInviteOwner ? '我的邀请' : '邀请你加入 Food Link'))
  const inviteDesc = isInviteOwner
    ? '复制邀请码或分享邀请链接给朋友，对方首次登录或注册时会自动带入邀请关系。'
    : '接受邀请后会发送好友申请，完成打卡后按规则结算双方积分。'

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
        setResolveCode(routeInviteCode)
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
          setResolvedName(String(data.nickname || data.user_id || data.id || '邀请用户'))
          setResolvedProfile(data as unknown as Record<string, unknown>)
        } catch {
          setResolvedName('')
          setResolvedProfile(null)
        }
      } else {
        setResolvedName('')
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

  const resolve = async () => {
    const code = normalizeInviteCode(resolveCode)
    setResolveCode(code)
    setLoading(true)
    try {
      setInviteNotice('')
      const data = await apiClient.resolveInvite(code)
      setResolvedName(String(data.nickname || data.user_id || data.id || '邀请用户'))
      setResolvedProfile(data as unknown as Record<string, unknown>)
      setProfile(data as unknown as Record<string, unknown>)
      setInviteCode(String(data.invite_code || code))
    } catch (error) {
      setResolvedProfile(null)
      setInviteNotice(userFacingErrorMessage(error, '没有找到对应邀请人，请检查邀请码。'))
      showError('解析邀请码失败', error)
    } finally {
      setLoading(false)
    }
  }

  const accept = async () => {
    const code = normalizeInviteCode(resolveCode || inviteCode)
    setResolveCode(code)
    setLoading(true)
    try {
      setInviteNotice('')
      const data = await apiClient.acceptInvite(code)
      setResolvedName(String(data.nickname || data.user_id || data.id || resolvedName || '邀请用户'))
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

  const copyInviteLink = async () => {
    if (!inviteLink) {
      Alert.alert('邀请信息生成中', '请下拉刷新邀请页后再复制。')
      return
    }
    await Clipboard.setStringAsync(inviteLink)
    Alert.alert('已复制', '邀请链接已复制，朋友打开后会自动带入邀请码。')
  }

  const shareInvite = async () => {
    if (!inviteCode) {
      Alert.alert('邀请信息生成中', '请下拉刷新邀请页后再分享。')
      return
    }
    try {
      await Share.share({
        title: '邀请加入 Food Link',
        message: inviteMessage,
      })
    } catch (error) {
      showError('分享邀请失败', error)
    }
  }

  return (
    <Page title="邀请好友" subtitle="邀请新用户注册并完成打卡，双方获得积分。" refreshing={loading} onRefresh={load}>
      <Card>
        <View style={styles.inviteProfileRow}>
          {String(profile?.avatar || '') ? (
            <Image source={{ uri: String(profile?.avatar || '') }} style={styles.inviteAvatar} />
          ) : (
            <View style={styles.inviteAvatarFallback}>
              <Text style={styles.inviteAvatarText}>食</Text>
            </View>
          )}
          <View style={styles.flex}>
            <Text style={styles.sectionTitle}>{inviteTitle}</Text>
            <Text style={styles.subtitle}>新用户 7 天内完成 2 个自然日有效记录，双方各得 15 积分。</Text>
          </View>
        </View>
        <Text style={styles.bigNumber} selectable>{inviteCode || '--'}</Text>
        <Text style={styles.subtitle}>{inviteDesc}</Text>
        {inviteNotice ? <Text style={styles.noticeText}>{inviteNotice}</Text> : null}
        {isInviteOwner && inviteLink ? <Text style={styles.linkText} selectable>{inviteLink}</Text> : null}
        {isInviteOwner ? (
          <View style={styles.buttonRow}>
            <SmallButton label="分享邀请" onPress={shareInvite} />
            <SmallButton label="复制邀请码" onPress={copyInviteCode} />
            <SmallButton label="复制链接" onPress={copyInviteLink} />
          </View>
        ) : (
          <View style={styles.buttonRow}>
            <SmallButton label={inviteActionLabel} onPress={inviteActionDone ? resolve : accept} />
          </View>
        )}
        {!isInviteOwner ? <Text style={styles.subtitle}>{relationText}</Text> : null}
      </Card>

      {isInviteOwner && inviteLink ? (
        <Card>
          <View style={styles.inviteQrHeader}>
            <View>
              <Text style={styles.sectionTitle}>扫码也能加入</Text>
              <Text style={styles.subtitle}>把二维码展示给朋友，或截图后发到微信、短信和其他聊天应用。</Text>
            </View>
          </View>
          <Pressable
            accessibilityRole="imagebutton"
            accessibilityLabel="打开邀请二维码"
            style={styles.inviteQrPressable}
            onPress={() => setQrPreviewOpen(true)}
          >
            <InviteQrCode value={inviteLink} />
          </Pressable>
          <Text style={styles.subtitle}>二维码内容为当前邀请链接，朋友打开后会自动带入邀请码。</Text>
          <View style={styles.buttonRow}>
            <SmallButton label="打开二维码" onPress={() => setQrPreviewOpen(true)} />
            <SmallButton label="复制链接" onPress={copyInviteLink} />
          </View>
        </Card>
      ) : null}

      <Card>
        <Text style={styles.sectionTitle}>手动填写邀请码</Text>
        <Field
          label="邀请码"
          value={resolveCode}
          onChangeText={(value) => {
            setResolveCode(normalizeInviteCode(value))
            setResolvedName('')
            setResolvedProfile(null)
            setInviteNotice('')
          }}
          autoCapitalize="none"
        />
        {resolvedName ? (
          <View style={styles.inviteResolvedBox}>
            <Text style={styles.itemName}>将添加：{resolvedName}</Text>
            <Text style={styles.subtitle}>{inviteRelationText(resolvedProfile)}</Text>
          </View>
        ) : null}
        <View style={styles.buttonRow}>
          <SmallButton label="解析邀请码" onPress={resolve} />
          <SmallButton label="加为好友" onPress={accept} />
        </View>
      </Card>

      <Card>
        <Text style={styles.sectionTitle}>规则</Text>
        <RuleLine text="新用户 7 天内完成 2 个自然日有效记录后触发奖励。" />
        <RuleLine text="邀请人与被邀请人各得 15 积分，按后端奖励规则结算。" />
        <RuleLine text="App 侧可通过系统分享面板发到微信、短信或其他聊天应用。" />
        <RuleLine text="朋友也可以在登录页手动填写邀请码，或通过 foodlink://invite?fi=邀请码 自动带入。" />
      </Card>

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
    </Page>
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

  const openChat = (user: FollowUserItem) => {
    const id = followUserId(user)
    if (id) navigation.navigate('PrivateChat', { userId: id, nickname: followDisplayName(user) })
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

  return (
    <Page title={title} subtitle={`${items.length} 人 · 关注关系和用户主页`} refreshing={loading} onRefresh={() => load(true)}>
      <Card>
        <Text style={styles.sectionTitle}>{title}列表</Text>
        <Text style={styles.subtitle}>查看用户主页，或直接发起私信和关注操作。</Text>
      </Card>
      {loading && items.length === 0 ? (
        <Card>
          <ActivityIndicator color={colors.brand} />
        </Card>
      ) : null}
      {!loading && items.length === 0 ? <EmptyState text={`暂无${title}`} /> : null}
      {items.map((user, index) => {
        const userId = followUserId(user)
        const isFollowing = followStates[userId] ?? Boolean(user.is_following)
        return (
          <Card key={userId || index}>
            <View style={styles.followRow}>
              <Pressable style={styles.followInfo} onPress={() => openProfile(userId)}>
                <FollowAvatar user={user} />
                <View style={styles.flex}>
                  <Text style={styles.itemName}>{followDisplayName(user)}</Text>
                  <Text style={styles.subtitle}>{followRelationText(type, isFollowing)}</Text>
                </View>
              </Pressable>
              <View style={styles.followActions}>
                <SmallButton label="主页" onPress={() => openProfile(userId)} />
                <SmallButton label="私信" onPress={() => openChat(user)} />
                <SmallButton label={isFollowing ? '已关注' : '+ 关注'} disabled={mutatingId === userId} onPress={() => void toggleFollow(user)} />
              </View>
            </View>
          </Card>
        )
      })}
      {hasMore ? <AppButton label="查看更多" variant="secondary" loading={loading} onPress={() => load(false)} /> : null}
    </Page>
  )
}
export function PublicFoodShareScreen() {
  const route = useRoute<RouteProp<RootStackParamList, 'PublicFoodShare'>>()
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  const editId = route.params?.editId
  const campusDefault = route.params?.mode === 'campus'
  const [sourceRecords, setSourceRecords] = useState<PublicFoodItem[]>([])
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
  const isCampus = sourceKind === 'campus'
  const isHomemade = sourceKind === 'homemade'
  const incomingDraft = route.params?.draft
  const selectedLocation = route.params?.selectedLocation
  const restoredDraftRef = useRef<string | null>(null)
  const appliedLocationRef = useRef<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      if (editId) {
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
      } else {
        const data = await apiClient.listPublicFoods({ limit: 6, sortBy: 'latest' })
        setSourceRecords(data.list || [])
      }
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
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (!permission.granted) {
      Alert.alert('需要相册权限', '请选择食物图片用于分享。')
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

  return (
    <Page title={editId ? '编辑公共食物' : '分享到公共食物库'} subtitle="补充外食、校园餐和自制餐食信息" refreshing={loading} onRefresh={load}>
      <Card>
        <Text style={styles.sectionTitle}>基础信息</Text>
        <Field label="食物名称" value={foodName} onChangeText={setFoodName} />
        <Field label="说明" value={description} onChangeText={setDescription} multiline />
        <ImagePickerGrid urls={splitTextList(imageUrls)} onAdd={pickImages} onRemove={removeImage} loading={loading} max={PUBLIC_FOOD_MAX_IMAGES} />
        <Field label="图片 URL" value={imageUrls} onChangeText={setImageUrls} placeholder="每行一个图片地址，可留空" multiline />
        <Text style={styles.fieldLabel}>餐食来源</Text>
        <View style={styles.segment}>
          <SegmentButton label="外食/堂食" active={sourceKind === 'restaurant'} onPress={() => setSourceKind('restaurant')} />
          <SegmentButton label="自制" active={isHomemade} onPress={() => setSourceKind('homemade')} />
          <SegmentButton label="校园餐" active={isCampus} onPress={() => setSourceKind('campus')} />
        </View>
        {isHomemade ? <Text style={styles.helperText}>自制餐食会自动带上「自制」标签，不要求商家位置。</Text> : null}
        {!isHomemade ? <Field label={isCampus ? '窗口/商户' : '商家名称'} value={merchantName} onChangeText={setMerchantName} /> : null}
        {!isHomemade ? <Field label="地址/位置" value={merchantAddress} onChangeText={setMerchantAddress} placeholder={isCampus ? '校区或楼栋位置' : '商家地址、商场或楼栋位置'} /> : null}
        {sourceKind === 'restaurant' ? (
          <>
            <View style={styles.buttonRow}>
              <SmallButton label="搜索商家位置" onPress={openLocationSearch} />
            </View>
            <Text style={styles.helperText}>可以先搜索商家或商场位置，选中后会回填名称、地址和经纬度；省份或区县缺失时再手动补齐。</Text>
            <Field label="省份" value={province} onChangeText={setProvince} placeholder="如：北京市" />
            <Field label="城市" value={city} onChangeText={setCity} placeholder="如：北京市" />
            <Field label="区县" value={district} onChangeText={setDistrict} placeholder="如：海淀区" />
            <Field label="详细地址" value={detailAddress} onChangeText={setDetailAddress} placeholder="门店地址、商场楼层或附近地标" />
            <View style={styles.twoColumn}>
              <View style={styles.flex}>
                <Field label="纬度" value={latitude} onChangeText={setLatitude} keyboardType="decimal-pad" placeholder="如：39.990" />
              </View>
              <View style={styles.flex}>
                <Field label="经度" value={longitude} onChangeText={setLongitude} keyboardType="decimal-pad" placeholder="如：116.310" />
              </View>
            </View>
            <Text style={styles.helperText}>外食/堂食需要完整位置；如果是家里做的餐食，请切换为「自制」。</Text>
          </>
        ) : null}
        {isCampus ? (
          <>
            <Field label="学校" value={schoolName} onChangeText={setSchoolName} />
            <Field label="校区" value={campusName} onChangeText={setCampusName} placeholder="可选，如：燕园校区" />
            <Field label="食堂" value={canteenName} onChangeText={setCanteenName} />
            <Field label="楼层" value={floor} onChangeText={setFloor} />
            <Field label="窗口" value={windowName} onChangeText={setWindowName} />
            <Field label="校园位置描述" value={campusLocationText} onChangeText={setCampusLocationText} placeholder="如：东区一食堂二楼麻辣烫窗口" />
            <Text style={styles.fieldLabel}>计价方式</Text>
            <View style={styles.segment}>
              {publicFoodPriceTypeOptions.map((option) => (
                <SegmentButton key={option.value} label={option.label} active={priceType === option.value} onPress={() => setPriceType(option.value)} />
              ))}
            </View>
            <Text style={styles.helperText}>{publicFoodPriceTypeOptions.find((option) => option.value === priceType)?.helper}</Text>
            {priceType === 'range' ? (
              <View style={styles.twoColumn}>
                <View style={styles.flex}>
                  <Field label="最低价" value={priceMin} onChangeText={setPriceMin} keyboardType="decimal-pad" placeholder="如：8" />
                </View>
                <View style={styles.flex}>
                  <Field label="最高价" value={priceMax} onChangeText={setPriceMax} keyboardType="decimal-pad" placeholder="如：15" />
                </View>
              </View>
            ) : (
              <Field label="价格" value={price} onChangeText={setPrice} keyboardType="decimal-pad" placeholder={priceType === 'unknown' ? '可留空' : '如：15'} />
            )}
            <Field label="价格单位" value={priceUnit} onChangeText={setPriceUnit} placeholder="份、碗、杯" />
            <Field label="价格采集日期" value={priceCollectedAt} onChangeText={setPriceCollectedAt} placeholder="YYYY-MM-DD" />
          </>
        ) : null}
      </Card>

      <Card>
        <Text style={styles.sectionTitle}>营养信息</Text>
        <Field label="热量 kcal" value={calories} onChangeText={setCalories} keyboardType="decimal-pad" />
        <Field label="蛋白 g" value={protein} onChangeText={setProtein} keyboardType="decimal-pad" />
        <Field label="碳水 g" value={carbs} onChangeText={setCarbs} keyboardType="decimal-pad" />
        <Field label="脂肪 g" value={fat} onChangeText={setFat} keyboardType="decimal-pad" />
        <Field label="份量描述" value={portionDescription} onChangeText={setPortionDescription} placeholder="如：一份约 350g，含米饭半碗" />
        <Field label="口味评分" value={tasteRating} onChangeText={setTasteRating} keyboardType="decimal-pad" placeholder="1-5，可留空" />
        <View style={styles.segment}>
          <SegmentButton label="适合减脂" active={suitableForFatLoss} onPress={() => setSuitableForFatLoss(true)} />
          <SegmentButton label="普通选择" active={!suitableForFatLoss} onPress={() => setSuitableForFatLoss(false)} />
        </View>
        <Field label="标签" value={tags} onChangeText={setTags} placeholder="低脂、饱腹、清淡，用逗号或顿号分隔" />
        <Field label="个人备注" value={notes} onChangeText={setNotes} multiline />
        <AppButton label={editId ? '保存修改' : '发布到公共库'} loading={loading} onPress={submit} />
      </Card>

      {!editId && sourceRecords.length ? <Text style={styles.groupTitle}>最近公共食物参考</Text> : null}
      {sourceRecords.map((item) => (
        <Card key={item.id}>
          <Text style={styles.itemName}>{item.food_name}</Text>
          <Text style={styles.subtitle}>{Math.round(item.total_calories || 0)} kcal · {item.merchant_name || item.canteen_name || '用户分享'}</Text>
        </Card>
      ))}
    </Page>
  )
}

export function RecipeEditScreen() {
  const route = useRoute<RouteProp<RootStackParamList, 'RecipeEdit'>>()
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
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

  const updateItem = (id: string, patch: Partial<RecipeFormRow>) => {
    setItems((current) => current.map((item) => item.id === id ? { ...item, ...patch } : item))
  }

  const addItem = () => setItems((current) => [...current, createBlankRecipeRow()])
  const removeItem = (id: string) => setItems((current) => current.length > 1 ? current.filter((item) => item.id !== id) : current)

  return (
    <Page title={recipeId ? '编辑食谱' : '新建食谱'} subtitle="常吃组合可一键写入饮食记录" refreshing={loading} onRefresh={load}>
      <Card>
        <MealPicker value={mealType} onChange={setMealType} />
        <Field label="食谱名" value={name} onChangeText={setName} />
        <Field label="说明" value={description} onChangeText={setDescription} multiline />
        <Field label="图片 URL" value={imagePath} onChangeText={setImagePath} placeholder="可选，粘贴餐食图片地址" />
        <Field label="标签" value={tags} onChangeText={setTags} placeholder="低脂、常吃、训练后，用逗号或顿号分隔" />
        <View style={styles.segment}>
          <SegmentButton label="收藏" active={isFavorite} onPress={() => setIsFavorite(true)} />
          <SegmentButton label="普通" active={!isFavorite} onPress={() => setIsFavorite(false)} />
        </View>
      </Card>

      <Card>
        <Text style={styles.sectionTitle}>营养摘要</Text>
        <View style={styles.nutritionRow}>
          <Pill text={`${Math.round(totals.calories)} kcal`} />
          <Pill text={`蛋白 ${round1(totals.protein)}g`} />
          <Pill text={`碳水 ${round1(totals.carbs)}g`} />
          <Pill text={`脂肪 ${round1(totals.fat)}g`} />
          <Pill text={`${Math.round(totals.weight)}g`} />
        </View>
      </Card>

      <Card>
        <Text style={styles.sectionTitle}>食物明细</Text>
        {items.map((item, index) => (
          <View key={item.id} style={styles.itemEditor}>
            <View style={styles.rowBetween}>
              <Text style={styles.itemName}>食物 {index + 1}</Text>
              {items.length > 1 ? <SmallButton label="移除" danger onPress={() => removeItem(item.id)} /> : null}
            </View>
            <Field label="名称" value={item.name} onChangeText={(value) => updateItem(item.id, { name: value })} />
            <View style={styles.twoColumn}>
              <View style={styles.flex}><Field label="重量 g" value={item.weight} onChangeText={(value) => updateItem(item.id, { weight: value })} keyboardType="decimal-pad" /></View>
              <View style={styles.flex}><Field label="热量 kcal" value={item.calories} onChangeText={(value) => updateItem(item.id, { calories: value })} keyboardType="decimal-pad" /></View>
            </View>
            <View style={styles.threeColumn}>
              <View style={styles.flex}><Field label="蛋白 g" value={item.protein} onChangeText={(value) => updateItem(item.id, { protein: value })} keyboardType="decimal-pad" /></View>
              <View style={styles.flex}><Field label="碳水 g" value={item.carbs} onChangeText={(value) => updateItem(item.id, { carbs: value })} keyboardType="decimal-pad" /></View>
              <View style={styles.flex}><Field label="脂肪 g" value={item.fat} onChangeText={(value) => updateItem(item.id, { fat: value })} keyboardType="decimal-pad" /></View>
            </View>
          </View>
        ))}
        <View style={styles.buttonRow}>
          <SmallButton label="添加食物" onPress={addItem} />
        </View>
      </Card>
      <AppButton label="保存食谱" loading={loading} onPress={save} />
      {recipeId ? <AppButton label="删除食谱" variant="secondary" loading={loading} onPress={remove} /> : null}
    </Page>
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
    Alert.alert(next ? '首页卡片已隐藏' : '首页卡片已显示', next ? '首页不再展示成长伙伴卡片，成长数据仍会继续更新。' : '首页会重新展示成长伙伴卡片。')
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
    <Page title="成长伙伴" subtitle="跟随饮食、运动和健康记录一起成长" refreshing={loading} onRefresh={load}>
      <Card>
        <View style={styles.petHero}>
          <PetAvatar pet={pet} size="large" mood={summary?.status.mood} state={summary?.status.state} />
          <Text style={styles.bigTitle}>{pet?.name || '成长伙伴'}</Text>
          <Text style={styles.subtitle}>Lv.{pet?.level || 1} · {pet?.level_exp || 0}/{pet?.next_level_exp || 100} EXP</Text>
          <Text style={styles.petMoodText}>{petMoodStateText}</Text>
        </View>
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${Math.max(0, Math.min(100, pet?.level_progress || 0))}%` }]} />
        </View>
        <View style={styles.petStatsGrid}>
          <PetStat label="总经验" value={`${pet?.experience || 0}`} />
          <PetStat label="距升级" value={`${nextLevelGap}`} />
          <PetStat label="陪伴天数" value={`${pet?.total_events || 0}`} />
        </View>
      </Card>

      <Card>
        <View style={styles.rowBetween}>
          <Text style={styles.sectionTitle}>为什么是它</Text>
          <Pill text={petArchetypeLabel(pet?.archetype)} />
        </View>
        {(pet?.match_reasons?.length ? pet.match_reasons : ['它会根据你的健康目标、活动水平和记录习惯生成，不按性别粗暴分配。']).map((reason) => (
          <RuleLine key={reason} text={reason} />
        ))}
      </Card>

      {showCandidates ? (
        <Card>
          <View style={styles.rowBetween}>
            <Text style={styles.sectionTitle}>{pet?.needs_selection ? '三选一伙伴' : '免费重新匹配'}</Text>
            <Pill text="不消耗积分" />
          </View>
          <Text style={styles.subtitle}>系统会先使用默认候选，选择后会同步更新首页与成长伙伴页的形象。</Text>
          {candidates.map((candidate) => {
            const isCurrent = candidate.pet_seed === pet?.pet_seed
            return (
              <View key={candidate.id} style={[styles.petCandidateCard, isCurrent && styles.petCandidateCardActive]}>
                <PetAvatar pet={candidate} size="small" />
                <View style={styles.flex}>
                  <Text style={styles.itemName}>{candidate.name}</Text>
                  <Text style={styles.subtitle}>{candidate.match_reasons?.join('、') || petArchetypeLabel(candidate.archetype)}</Text>
                  <Text style={styles.itemMeta}>{candidateStyleLabel(candidate.style)}{typeof candidate.score === 'number' ? ` · ${candidate.score}` : ''}</Text>
                </View>
                <SmallButton
                  label={isCurrent ? '当前' : selectingCandidateId === candidate.id ? '选择中' : '选择'}
                  disabled={isCurrent || Boolean(selectingCandidateId)}
                  onPress={() => selectCandidate(candidate)}
                />
              </View>
            )
          })}
        </Card>
      ) : null}

      <Card>
        <Text style={styles.sectionTitle}>今日状态</Text>
        <Text style={styles.itemName}>{summary?.status.message || '记录一餐，开启今日成长。'}</Text>
        <Text style={styles.subtitle}>{summary?.status.task_text || '今天先记录一餐'}</Text>
        <View style={styles.nutritionRow}>
          <Pill text={`习惯分 ${summary?.today.habit_score || 0}`} />
          <Pill text={`今日经验 ${summary?.today.exp_gained || 0}`} />
          <Pill text={`奖励积分 ${petEarnedCredits(membership)}`} />
          <Pill text={`总可用积分 ${petTotalCredits(membership)}`} />
        </View>
      </Card>

      <Card>
        <Text style={styles.sectionTitle}>外观档案</Text>
        <View style={styles.appearanceGrid}>
          <Pill text={petShapeLabel(pet?.shape)} />
          <Pill text={petPatternLabel(pet?.pattern)} />
          <Pill text={petAccessoryLabel(pet?.accessory)} />
          <Pill text={petPersonalityLabel(pet?.personality)} />
        </View>
        <Text style={styles.subtitle}>{pet?.match_reasons?.join('、') || '完善健康档案后，会根据目标、作息和偏好生成更明确的匹配原因。'}</Text>
      </Card>

      <Card>
        <View style={styles.rowBetween}>
          <Text style={styles.sectionTitle}>离线小惊喜</Text>
          <Pill text={petEvent ? '未领取' : '已查看'} />
        </View>
        <Text style={styles.itemName}>{petEvent?.title || '今天还没有新的离线惊喜'}</Text>
        <Text style={styles.subtitle}>{petEvent?.message || '等你下一次回来时，它会带着整理好的复盘和一点小奖励出现。'}</Text>
        <View style={styles.nutritionRow}>
          <Pill text={`经验 +${petEvent?.exp_reward || 0}`} />
          <Pill text={`积分 +${petEvent?.credit_reward || 0}`} />
          <Pill text={`离线 ${summary?.status.inactivity_days || 0} 天`} />
        </View>
        {petEvent?.can_claim ? <AppButton label="领取奖励" loading={claiming} onPress={claim} /> : null}
      </Card>

      {(pet?.growth_unlocks || []).length ? (
        <Card>
          <Text style={styles.sectionTitle}>成长解锁</Text>
          <View style={styles.appearanceGrid}>
            {(pet?.growth_unlocks || []).map((unlock) => <Pill key={unlock} text={growthUnlockLabel(unlock)} />)}
          </View>
        </Card>
      ) : null}

      <Card>
        <Text style={styles.sectionTitle}>外观换装</Text>
        <View style={styles.petActionCard}>
          <View style={styles.flex}>
            <Text style={styles.itemName}>首页成长伙伴卡片</Text>
            <Text style={styles.subtitle}>{homePetHidden ? '当前首页不展示伙伴卡片，数据和成长仍会保留。' : '当前首页会展示成长伙伴卡片，方便快速查看状态。'}</Text>
          </View>
          <SmallButton label={homePetHidden ? '显示到首页' : '从首页隐藏'} onPress={toggleHomePet} />
        </View>
        <View style={styles.petActionCard}>
          <View style={styles.flex}>
            <Text style={styles.itemName}>随机换外观</Text>
            <Text style={styles.subtitle}>保留名字和等级，随机刷新体型、花纹与配饰。当前奖励积分 {petEarnedCredits(membership)}。</Text>
          </View>
          <SmallButton label={rerolling ? '处理中' : '5 积分'} disabled={rerolling} onPress={confirmReroll} />
        </View>
      </Card>

      <AppButton label="外观实验室" variant="secondary" onPress={() => navigation.navigate('PetLab')} />
    </Page>
  )
}

export function PetLabScreen() {
  const [summary, setSummary] = useState<PetSummary | null>(null)
  const [membership, setMembership] = useState<MembershipStatus | null>(null)
  const [loading, setLoading] = useState(false)
  const [rerolling, setRerolling] = useState(false)
  const [selectingCandidateId, setSelectingCandidateId] = useState('')

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
  return (
    <Page title="外观实验室" subtitle="根据健康档案匹配形象，也可消耗奖励积分重置。" refreshing={loading} onRefresh={load}>
      <Card>
        <Text style={styles.sectionTitle}>当前形象</Text>
        <View style={styles.rowBetween}>
          <PetAvatar pet={summary?.pet} size="medium" mood={summary?.status.mood} state={summary?.status.state} />
          <View style={styles.flex}>
            <Text style={styles.itemName}>{summary?.pet.name || '--'}</Text>
            <Text style={styles.subtitle}>{petShapeLabel(summary?.pet.shape)} · {petPatternLabel(summary?.pet.pattern)} · {petAccessoryLabel(summary?.pet.accessory)}</Text>
          </View>
        </View>
        <Text style={styles.subtitle}>{summary?.pet.match_reasons?.join('、') || '完善健康档案后会生成更明确的匹配原因'}</Text>
        <View style={styles.nutritionRow}>
          <Pill text={summary?.pet.free_profile_rematch_available ? '档案重配可用' : '已使用档案重配'} />
          <Pill text={`奖励积分 ${petEarnedCredits(membership)}`} />
          <Pill text={`总可用积分 ${petTotalCredits(membership)}`} />
        </View>
        <AppButton label="消耗 5 积分刷新" variant="secondary" loading={rerolling} onPress={confirmReroll} />
      </Card>
      {candidates.length === 0 ? <EmptyState text="暂无候选形象" /> : null}
      {candidates.map((candidate) => (
        <Card key={candidate.id}>
          <View style={styles.rowBetween}>
            <PetAvatar pet={candidate} size="small" />
            <View style={styles.flex}>
              <Text style={styles.itemName}>{candidate.name}</Text>
              <Text style={styles.subtitle}>{candidate.match_reasons?.join('、') || candidate.archetype || '候选外观'}</Text>
              <Text style={styles.itemMeta}>{petShapeLabel(candidate.shape)} · {petPatternLabel(candidate.pattern)} · {petAccessoryLabel(candidate.accessory)} · {petPersonalityLabel(candidate.personality)}</Text>
            </View>
            {typeof candidate.score === 'number' ? <Text style={styles.kcal}>{candidate.score}</Text> : null}
          </View>
          <View style={styles.buttonRow}>
            <SmallButton label={selectingCandidateId === candidate.id ? '选择中' : '选择这个'} disabled={Boolean(selectingCandidateId)} onPress={() => select(candidate)} />
          </View>
        </Card>
      ))}
    </Page>
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
    title: '引言',
    paragraphs: [
      'Food Link 深知个人信息和健康数据的重要性，会遵循合法、正当、必要和最小够用原则，采取安全保护措施保护你的个人信息。',
      '本政策适用于你使用 Food Link App、小程序及相关服务时产生的信息处理活动。',
    ],
  },
  {
    title: '一、我们如何收集和使用信息',
    paragraphs: [
      '账号信息：用于登录、找回账号、同步饮食记录、圈子互动和会员状态。你可以使用微信能力或手机号密码登录，具体方式以当前客户端展示为准。',
      '饮食和图片数据：当你使用拍照识别、相册识别、文字记录、包装食品识别、公共食物分享或健康报告识别时，你主动上传的图片、文字和相关描述会用于完成识别、记录和分析。',
      '身体与健康数据：身高、体重、喝水、运动、病史、过敏、目标、代谢数据等用于生成更贴合你的饮食建议、PFC 分析、趋势图和健康档案。',
      '社区和互动数据：公开动态、评论、点赞、收藏、私信、好友关系、关注关系和举报信息用于提供圈子互动、通知和内容治理。',
      '会员与积分数据：订单号、套餐、积分余额、消耗记录和权益状态用于会员服务生效、同步、结算和问题排查。',
    ],
  },
  {
    title: '二、图片、报告和 AI 分析',
    paragraphs: [
      '食物照片、包装图片、体检报告或病例图片会上传到服务器，用于调用 AI 模型和相关服务完成识别、抽取或分析。',
      '我们不会将你主动上传的敏感健康图片用于本服务之外的商业用途。分析结果可能受图片质量、模型稳定性和描述完整度影响，仅供参考。',
    ],
  },
  {
    title: '三、我们如何存储个人信息',
    paragraphs: [
      '在中国境内收集和产生的个人信息将存储在中国境内，除法律法规另有规定或获得你的明确同意外，不会跨境传输。',
      '我们仅在实现服务目的所必需的合理期限内，或法律法规要求的期限内保存你的个人信息。超过期限后会按规则删除、匿名化或最小化保留。',
    ],
  },
  {
    title: '四、共享、转让和公开披露',
    paragraphs: [
      '除法律法规要求、获得你的单独同意、完成你主动请求的服务或保护用户安全所必需外，我们不会向第三方出售或非法共享你的个人信息。',
      '当你主动在圈子、个人主页、公共食物库、校园餐或评论中公开内容时，你的昵称、头像和公开内容可能被其他用户看到。',
    ],
  },
  {
    title: '五、你的控制权',
    paragraphs: [
      '你可以在隐私设置中控制是否允许在圈子中被搜索、是否公开饮食记录，也可以清除本地缓存或退出登录。',
      '你可以通过产品内入口查看、修改部分账号资料和健康档案；如需删除账号或处理个人信息相关请求，可通过关于与反馈入口联系我们。',
    ],
  },
  {
    title: '六、本地缓存与设备权限',
    paragraphs: [
      'App 会在本地保存登录状态、草稿、搜索历史、缓存数据等，以减少重复输入和请求。清除缓存会保留登录 token，退出登录才会移除登录状态。',
      '相册、相机、通知、剪贴板、定位等权限仅在对应功能需要时使用；不同系统的权限弹窗和管理路径以设备系统为准。',
    ],
  },
  {
    title: '七、如何联系我们',
    paragraphs: [
      '如果你对本隐私政策、个人信息处理或账号数据有任何疑问、意见或建议，可以通过关于与反馈、用户群或产品内客服入口联系我们。',
    ],
  },
]

export function AgreementsScreen() {
  return (
    <Page title="用户服务协议" subtitle="最后更新：2026年2月">
      {AGREEMENT_SECTIONS.map((section) => (
        <LegalCard key={section.title} title={section.title} text={section.paragraphs} />
      ))}
    </Page>
  )
}

export function PrivacyPolicyScreen() {
  return (
    <Page title="隐私政策" subtitle="最后更新：2026年2月">
      {PRIVACY_POLICY_SECTIONS.map((section) => (
        <LegalCard key={section.title} title={section.title} text={section.paragraphs} />
      ))}
    </Page>
  )
}

export function AutoRenewAuditScreen() {
  const [membership, setMembership] = useState<MembershipStatus | null>(null)
  const [plans, setPlans] = useState<MembershipPlan[]>([])
  const [selectedPlanCode, setSelectedPlanCode] = useState('')
  const [agreed, setAgreed] = useState(false)
  const [loading, setLoading] = useState(false)
  const [previewModal, setPreviewModal] = useState<'sign' | 'cancel' | null>(null)

  const selectedPlan = useMemo(
    () => plans.find((plan) => plan.code === selectedPlanCode) || plans[0],
    [plans, selectedPlanCode],
  )

  const signPreviewLines = useMemo(() => {
    if (!selectedPlan) return []
    return [
      `拟开通：Food Link 会员 · ${selectedPlan.name}`,
      `扣费周期：${planPeriodLabel(selectedPlan)}`,
      `每期金额：¥${moneyText(selectedPlan.amount)}${planPeriodSuffix(selectedPlan)}`,
      '说明：当前仅为自动续费审核预览，不会创建订单、不会调用支付渠道委托代扣接口、不会真实扣款。',
    ]
  }, [selectedPlan])

  const cancelPreviewLines = [
    '产品内路径：我的 → 会员中心 → 自动续费审核 → 关闭自动续费。',
    '也可在微信支付、应用商店或对应支付渠道的扣费服务中关闭。',
    '当前为审核预览，不会执行真实解约；关闭后也不影响已付费周期内会员权益。',
  ]

  const previewTitle = previewModal === 'sign' ? '自动续费签约预览' : '关闭自动续费路径'
  const previewLines = previewModal === 'sign' ? signPreviewLines : cancelPreviewLines

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
      setSelectedPlanCode((current) => current || membershipData?.current_plan_code || nextPlans[0]?.code || '')
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
    <Page title="自动续费审核" subtitle="会员续费状态和支付渠道" refreshing={loading} onRefresh={load}>
      <Card>
        <View style={styles.auditHeroRow}>
          <View style={styles.flex}>
            <Text style={styles.auditKicker}>Food Link 会员服务</Text>
            <Text style={styles.auditTitle}>自动续费申请交互预览</Text>
            <Text style={styles.subtitle}>展示签约前说明、扣费周期、每期金额和关闭路径，便于审核人员核对完整链路。</Text>
          </View>
          <View style={styles.auditBadge}>
            <Text style={styles.auditBadgeText}>审核预览</Text>
          </View>
        </View>
        <Text style={styles.noticeText}>当前页面不会创建订单、不会调用支付渠道委托代扣接口、不会真实扣款或解约。</Text>
      </Card>

      <Card>
        <Text style={styles.sectionTitle}>当前状态</Text>
        <Text style={styles.bigNumber}>{membership?.is_pro ? 'Pro' : '基础账号'}</Text>
        <InfoLine label="会员状态" value={membershipStatusLabel(membership)} />
        <InfoLine label="当前套餐" value={membership?.current_plan_code || '--'} />
        <InfoLine label="今日可用积分" value={`${membership?.total_credits_available ?? membership?.daily_credits_remaining ?? 0}`} />
        <InfoLine label="奖励积分" value={`${membership?.earned_credits_balance ?? membership?.points_balance ?? 0}`} />
      </Card>

      <Card>
        <Text style={styles.sectionTitle}>服务内容</Text>
        <View style={styles.featureGrid}>
          {['饮食记录', 'AI 营养分析', '健康档案', '运动记录', '社区互动', '公共食物库'].map((item) => (
            <View key={item} style={styles.featurePill}>
              <Text style={styles.featurePillText}>{item}</Text>
            </View>
          ))}
        </View>
      </Card>

      <Card>
        <Text style={styles.sectionTitle}>会员套餐</Text>
        {plans.length === 0 ? <EmptyState text="暂无可选套餐" /> : null}
        {plans.map((plan) => (
          <Pressable
            key={plan.code}
            style={[styles.planRow, selectedPlanCode === plan.code && styles.planRowActive]}
            onPress={() => setSelectedPlanCode(plan.code)}
          >
            <View style={styles.flex}>
              <Text style={styles.itemName}>{plan.name}</Text>
              <Text style={styles.subtitle}>
                {plan.daily_credits || 0} 积分/日 · {planPeriodLabel(plan)}
                {plan.description ? ` · ${plan.description}` : ''}
              </Text>
            </View>
            <View style={styles.priceBlock}>
              <Text style={styles.priceText}>¥{moneyText(plan.amount)}</Text>
              {plan.original_amount ? <Text style={styles.originalPrice}>¥{moneyText(plan.original_amount)}</Text> : null}
            </View>
          </Pressable>
        ))}
      </Card>

      <Card>
        <View style={styles.rowBetween}>
          <Text style={styles.sectionTitle}>自动续费签约前说明</Text>
          <View style={styles.auditMiniBadge}>
            <Text style={styles.auditMiniBadgeText}>审核预览</Text>
          </View>
        </View>
        <InfoLine label="服务名称" value={`Food Link 会员${selectedPlan ? ` · ${selectedPlan.name}` : ''}`} />
        <InfoLine label="扣费周期" value={selectedPlan ? planPeriodLabel(selectedPlan) : '--'} />
        <InfoLine label="每期金额" value={selectedPlan ? `¥${moneyText(selectedPlan.amount)}${planPeriodSuffix(selectedPlan)}` : '--'} />
        <InfoLine label="预计续费" value="当前周期到期前按支付渠道规则续费" />
        <Text style={styles.subtitle}>开通后，会员到期前将按所选周期自动续费；扣费前会按支付渠道规则通知。用户可随时关闭自动续费，关闭后不影响已付费周期内权益。</Text>
        <Text style={styles.auditPreviewNote}>该按钮只展示签约预览，不会进入真实支付或委托代扣。</Text>
        <Pressable style={styles.checkRow} onPress={() => setAgreed((value) => !value)}>
          <View style={[styles.checkbox, agreed && styles.checkboxActive]}>
            <Text style={styles.checkboxText}>{agreed ? '✓' : ''}</Text>
          </View>
          <Text style={styles.checkText}>我已阅读并同意会员服务协议及自动续费规则</Text>
        </Pressable>
        <AppButton label="确认开通自动续费（审核预览）" loading={loading} onPress={showSignPreview} />
      </Card>

      <Card>
        <Text style={styles.sectionTitle}>关闭自动续费</Text>
        <Text style={styles.pathText}>我的 → 会员中心 → 自动续费审核 → 关闭自动续费</Text>
        <Text style={styles.subtitle}>也可在微信支付、应用商店或对应支付渠道的扣费服务中关闭。关闭后不影响已付费周期内会员权益。</Text>
        <Text style={styles.auditPreviewNote}>关闭入口同样只展示路径预览，不会执行真实解约。</Text>
        <View style={styles.buttonRow}>
          <SmallButton label="关闭自动续费（审核预览）" onPress={showCancelPreview} />
        </View>
      </Card>

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
            <AppButton label="知道了" onPress={() => setPreviewModal(null)} />
          </View>
        </View>
      </Modal>
    </Page>
  )
}

function LegalCard({ title, text }: { title: string; text: string | string[] }) {
  const paragraphs = Array.isArray(text) ? text : [text]
  return (
    <Card>
      <Text style={styles.sectionTitle}>{title}</Text>
      {paragraphs.map((paragraph, index) => (
        <Text key={`${title}-${index}`} style={[styles.subtitle, index > 0 && styles.legalParagraph]}>
          {paragraph}
        </Text>
      ))}
    </Card>
  )
}

function RuleLine({ text }: { text: string }) {
  return (
    <View style={styles.ruleLine}>
      <View style={styles.ruleDot} />
      <Text style={styles.subtitle}>{text}</Text>
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
      <View style={styles.rowBetween}>
        <Text style={styles.fieldLabel}>图片</Text>
        <Text style={styles.subtitle}>{urls.length}/{max}</Text>
      </View>
      <View style={styles.imageGrid}>
        {urls.map((url, index) => (
          <View key={`${url}-${index}`} style={styles.imageTile}>
            <Image source={{ uri: url }} style={styles.imageThumb} />
            <Pressable style={styles.imageRemove} onPress={() => onRemove(index)}>
              <Text style={styles.imageRemoveText}>移除</Text>
            </Pressable>
          </View>
        ))}
        {urls.length < max ? (
          <Pressable style={styles.imageAdd} onPress={onAdd} disabled={loading}>
            <Text style={styles.imageAddIcon}>+</Text>
            <Text style={styles.imageAddText}>{loading ? '上传中' : '添加图片'}</Text>
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

function Pill({ text }: { text: string }) {
  return (
    <View style={styles.pill}>
      <Text style={styles.pillText}>{text}</Text>
    </View>
  )
}

function EmptyState({ text }: { text: string }) {
  return (
    <Card>
      <Text style={styles.empty}>{text}</Text>
    </Card>
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

function followRelationText(type: 'followers' | 'following', isFollowing: boolean): string {
  if (type === 'following') return isFollowing ? '正在关注' : '已取消关注'
  return isFollowing ? '已关注对方' : '关注你的人'
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
  const title = nickname ? `${nickname} 邀请你加入 Food Link` : '邀请你加入 Food Link'
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
  followRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  followInfo: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  followActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    gap: 8,
    maxWidth: 220,
  },
  followAvatarImage: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: colors.surfaceMuted,
  },
  followAvatarFallback: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.brandSoft,
  },
  followAvatarText: {
    color: colors.brandDark,
    fontSize: 17,
    fontWeight: '900',
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
  inviteProfileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 14,
  },
  inviteAvatar: {
    width: 58,
    height: 58,
    borderRadius: 16,
    backgroundColor: colors.surfaceMuted,
  },
  inviteAvatarFallback: {
    width: 58,
    height: 58,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.brandSoft,
  },
  inviteAvatarText: {
    color: colors.brandDark,
    fontSize: 24,
    fontWeight: '900',
  },
  inviteResolvedBox: {
    marginTop: 2,
    padding: 12,
    borderRadius: 12,
    backgroundColor: colors.surfaceMuted,
  },
  inviteQrHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  inviteQrPressable: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 16,
    marginBottom: 12,
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
    padding: 24,
    backgroundColor: 'rgba(17, 24, 39, 0.62)',
  },
  inviteQrModalCard: {
    width: '100%',
    maxWidth: 360,
    borderRadius: 22,
    padding: 20,
    backgroundColor: colors.surface,
    gap: 10,
  },
  linkText: {
    marginTop: 10,
    color: colors.brandDark,
    fontSize: 12,
    lineHeight: 18,
  },
  noticeText: {
    marginTop: 10,
    color: colors.warning,
    fontSize: 12,
    lineHeight: 18,
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
    padding: 24,
  },
  auditModal: {
    width: '100%',
    maxWidth: 420,
    borderRadius: 24,
    backgroundColor: colors.surface,
    padding: 20,
  },
  auditModalTitle: {
    color: colors.text,
    fontSize: 20,
    lineHeight: 26,
    fontWeight: '900',
  },
  auditModalBody: {
    marginTop: 12,
    marginBottom: 18,
    gap: 10,
  },
  auditModalLine: {
    color: colors.textSecondary,
    fontSize: 14,
    lineHeight: 21,
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
  imageBlock: {
    marginBottom: 14,
  },
  imageGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 8,
  },
  imageTile: {
    width: 96,
    height: 112,
  },
  imageThumb: {
    width: 96,
    height: 96,
    borderRadius: 14,
    backgroundColor: colors.surfaceMuted,
  },
  imageRemove: {
    alignItems: 'center',
    marginTop: 3,
  },
  imageRemoveText: {
    color: colors.danger,
    fontSize: 12,
    fontWeight: '800',
  },
  imageAdd: {
    width: 96,
    height: 96,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceMuted,
    borderWidth: 1,
    borderColor: colors.border,
  },
  imageAddIcon: {
    color: colors.brandDark,
    fontSize: 30,
    fontWeight: '900',
  },
  imageAddText: {
    color: colors.textSecondary,
    fontWeight: '800',
    marginTop: 4,
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
    fontSize: 22,
    fontWeight: '900',
    marginTop: 8,
  },
  bigNumber: {
    color: colors.brandDark,
    fontSize: 34,
    fontWeight: '900',
  },
  subtitle: {
    color: colors.textSecondary,
    lineHeight: 21,
  },
  legalParagraph: {
    marginTop: 8,
  },
  helperText: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 18,
    marginTop: 6,
    marginBottom: 8,
  },
  empty: {
    color: colors.textMuted,
    textAlign: 'center',
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
    fontSize: 28,
  },
  leaderboardCard: {
    padding: 14,
  },
  leaderboardCardMine: {
    borderWidth: 1,
    borderColor: colors.brand,
    backgroundColor: colors.brandSoft,
  },
  rankNo: {
    width: 54,
    height: 54,
    borderRadius: 27,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.brandSoft,
  },
  rankNoTop: {
    backgroundColor: colors.orange,
  },
  rankNoText: {
    color: colors.brandDark,
    fontWeight: '900',
  },
  rankNoTextTop: {
    color: '#fff',
  },
  leaderboardAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.surfaceMuted,
  },
  leaderboardAvatarFallback: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceMuted,
  },
  leaderboardAvatarText: {
    color: colors.textSecondary,
    fontWeight: '900',
  },
  leaderboardName: {
    flexShrink: 1,
    minWidth: 0,
  },
  leaderboardCount: {
    minWidth: 58,
    alignItems: 'flex-end',
  },
  leaderboardCountValue: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '900',
  },
  avatarFallback: {
    width: 46,
    height: 46,
    borderRadius: 23,
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
    minHeight: 104,
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
  ruleLine: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 10,
  },
  ruleDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: colors.brand,
    marginTop: 7,
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
