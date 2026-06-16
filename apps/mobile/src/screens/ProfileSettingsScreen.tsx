import { useCallback, useEffect, useState } from 'react'
import { Alert, Image, Pressable, Share, StyleSheet, Text, TextInput, View } from 'react-native'
import * as Clipboard from 'expo-clipboard'
import * as ImagePicker from 'expo-image-picker'
import { useFocusEffect, useNavigation, useRoute, type RouteProp } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import type { CommunityFeedItem, CommunityFeedTargetType, PublicFoodItem, PublicProfile, RecipeItem, UserInfo } from '@food-link/core'
import { apiClient, getStoredUserId } from '../api'
import { AppButton } from '../components/AppButton'
import { Card } from '../components/Card'
import { Page } from '../components/Page'
import type { RootStackParamList } from '../navigation/types'
import { colors } from '../theme'
import { formatDateTime } from '../utils/date'
import { readImageAsBase64DataUrl } from '../utils/image'
import { useAuth } from '../providers/AuthProvider'

type ProfileTab = 'feed' | 'collections'

export function ProfileSettingsScreen() {
  const route = useRoute<RouteProp<RootStackParamList, 'ProfileSettings'>>()
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  const { logout } = useAuth()
  const targetUserId = route.params?.userId
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)
  const isOwner = !targetUserId || (!!currentUserId && targetUserId === currentUserId)
  const [profile, setProfile] = useState<(UserInfo & PublicProfile) | null>(null)
  const [feed, setFeed] = useState<CommunityFeedItem[]>([])
  const [recipes, setRecipes] = useState<RecipeItem[]>([])
  const [foods, setFoods] = useState<PublicFoodItem[]>([])
  const [activeTab, setActiveTab] = useState<ProfileTab>('feed')
  const [editing, setEditing] = useState(false)
  const [nickname, setNickname] = useState('')
  const [motto, setMotto] = useState('')
  const [avatar, setAvatar] = useState('')
  const [coverImage, setCoverImage] = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    getStoredUserId().then(setCurrentUserId).catch(() => setCurrentUserId(null))
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      if (isOwner) {
        const [profileData, feedData, recipeData, foodData] = await Promise.all([
          apiClient.getUserProfile(),
          apiClient.communityGetFeed({ limit: 20, includeComments: false }).catch(() => ({ list: [] })),
          apiClient.listRecipes({ isFavorite: true }).catch(() => ({ recipes: [] })),
          apiClient.listCollectedPublicFoods().catch(() => ({ list: [] })),
        ])
        applyProfile(profileData)
        setFeed(feedData.list || [])
        setRecipes(recipeData.recipes || [])
        setFoods(foodData.list || [])
      } else {
        const userId = targetUserId || ''
        const [profileData, feedData, recipeData, foodData, followStats] = await Promise.all([
          apiClient.getPublicProfile(userId),
          apiClient.communityGetPublicFeed({
            limit: 20,
            includeComments: false,
            params: { author_id: userId, sort_by: 'latest' },
          }).catch(() => ({ list: [] })),
          apiClient.getUserFavoriteRecipes(userId).catch(() => ({ recipes: [] })),
          apiClient.getUserPublicFoodCollections(userId).catch(() => ({ list: [] })),
          apiClient.getFollowStats(userId).catch(() => null),
        ])
        applyProfile({ ...profileData, ...(followStats || {}) } as UserInfo & PublicProfile)
        setFeed(feedData.list || [])
        setRecipes(recipeData.recipes || [])
        setFoods(foodData.list || [])
      }
    } catch (error) {
      showError('获取主页失败', error)
    } finally {
      setLoading(false)
    }
  }, [isOwner, targetUserId])

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
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (!permission.granted) {
      Alert.alert('需要相册权限', kind === 'avatar' ? '请选择头像图片。' : '请选择主页背景图片。')
      return
    }
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
      showError(kind === 'avatar' ? '上传头像失败' : '上传背景失败', error)
    } finally {
      setSaving(false)
    }
  }

  const saveProfile = async () => {
    if (!nickname.trim()) {
      Alert.alert('请输入昵称')
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
      Alert.alert('已保存', '个人资料已更新')
    } catch (error) {
      showError('保存资料失败', error)
    } finally {
      setSaving(false)
    }
  }

  const toggleFollow = async () => {
    if (!targetUserId || !profile) return
    const previous = profile
    const nextFollowing = !profile.is_following
    setProfile({
      ...profile,
      is_following: nextFollowing,
      followers_count: Math.max(0, (profile.followers_count || 0) + (nextFollowing ? 1 : -1)),
    })
    try {
      await apiClient.followUser(targetUserId, Boolean(profile.is_following))
    } catch (error) {
      setProfile(previous)
      showError('关注失败', error)
    }
  }

  const confirmDeleteAccount = () => {
    Alert.alert(
      '注销账号',
      '注销后账号及健康记录、饮食分析历史、好友关系等数据会被删除。确定继续吗？',
      [
        { text: '取消', style: 'cancel' },
        {
          text: '确认注销',
          style: 'destructive',
          onPress: () => {
            void deleteAccount()
          },
        },
      ],
    )
  }

  const deleteAccount = async () => {
    setSaving(true)
    try {
      await apiClient.deleteAccount()
      await logout()
      Alert.alert('已注销', '账号已注销，请重新登录。')
    } catch (error) {
      showError('注销失败', error)
    } finally {
      setSaving(false)
    }
  }

  const copyUserId = async () => {
    const value = String(profile?.id || targetUserId || '').trim()
    if (!value) {
      Alert.alert('暂无用户 ID')
      return
    }
    await Clipboard.setStringAsync(value)
    Alert.alert('已复制', '用户 ID 已复制到剪贴板')
  }

  const shareProfile = async () => {
    const userId = String(profile?.id || targetUserId || '').trim()
    if (!userId) {
      Alert.alert('暂无主页信息', '请稍后重试。')
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
      showError('分享失败', error)
    }
  }

  const openFeed = (item: CommunityFeedItem) => {
    const targetId = item.target_id || item.record?.id
    const targetType = normalizeTargetType(item.target_type || item.record?.feed_type)
    if (!targetId) return
    navigation.navigate('CommunityFeedDetail', { targetId, targetType })
  }

  return (
    <Page title={isOwner ? '个人主页' : '用户主页'} subtitle={profile?.motto || '动态、收藏和公开资料'} refreshing={loading} onRefresh={load}>
      <Card style={styles.heroCard}>
        {coverImage ? <Image source={{ uri: coverImage }} style={styles.coverImage} /> : <View style={styles.coverFallback} />}
        <View style={styles.profileRow}>
          {avatar ? <Image source={{ uri: avatar }} style={styles.avatar} /> : <View style={styles.avatarFallback} />}
          <View style={styles.flex}>
            <Text style={styles.bigTitle}>{profile?.nickname || 'Food Link 用户'}</Text>
            <Text style={styles.subtitle}>记录 {profile?.record_days || 0} 天 · 被关注 {profile?.followers_count || 0} · 关注 {profile?.following_count || 0}</Text>
            <Text style={styles.idText} selectable>ID: {profile?.id || targetUserId || ''}</Text>
          </View>
        </View>
        <View style={styles.buttonRow}>
          {isOwner ? <SmallButton label={editing ? '收起编辑' : '编辑资料'} onPress={() => setEditing((value) => !value)} /> : null}
          {!isOwner ? <SmallButton label={profile?.is_following ? '取消关注' : '+ 关注'} onPress={toggleFollow} /> : null}
          {!isOwner && targetUserId ? <SmallButton label="私信" onPress={() => navigation.navigate('PrivateChat', { userId: targetUserId, nickname: profile?.nickname })} /> : null}
          <SmallButton label="分享主页" onPress={() => void shareProfile()} />
          <SmallButton label="复制ID" onPress={() => void copyUserId()} />
          <SmallButton label="被关注" onPress={() => profile?.id ? navigation.navigate('FollowList', { userId: profile.id, type: 'followers' }) : undefined} />
          <SmallButton label="关注" onPress={() => profile?.id ? navigation.navigate('FollowList', { userId: profile.id, type: 'following' }) : undefined} />
        </View>
      </Card>

      {editing && isOwner ? (
        <Card>
          <Text style={styles.sectionTitle}>编辑资料</Text>
          <Field label="昵称" value={nickname} onChangeText={setNickname} />
          <Field label="座右铭" value={motto} onChangeText={setMotto} placeholder="写一句你的座右铭" />
          <View style={styles.buttonRow}>
            <SmallButton label="选择头像" onPress={() => void pickProfileImage('avatar')} />
            <SmallButton label="选择背景图" onPress={() => void pickProfileImage('cover')} />
          </View>
          <AppButton label="保存资料" loading={saving} onPress={saveProfile} />
          <Pressable onPress={confirmDeleteAccount} style={styles.deleteAccount}>
            <Text style={styles.deleteText}>注销账号</Text>
          </Pressable>
        </Card>
      ) : null}

      <View style={styles.segment}>
        <SegmentButton label="最新动态" active={activeTab === 'feed'} onPress={() => setActiveTab('feed')} />
        <SegmentButton label="食物收藏" active={activeTab === 'collections'} onPress={() => setActiveTab('collections')} />
      </View>

      {activeTab === 'feed' ? (
        <>
          {feed.length === 0 ? <EmptyState text="暂无动态" /> : null}
          {feed.map((item, index) => (
            <Pressable key={`${item.target_type || item.record?.feed_type}-${item.target_id || item.record?.id || index}`} onPress={() => openFeed(item)}>
              <Card>
                <View style={styles.rowBetween}>
                  <View style={styles.flex}>
                    <Text style={styles.itemName}>{feedTitle(item)}</Text>
                    <Text style={styles.subtitle}>{feedSubtitle(item)}</Text>
                  </View>
                  {feedPrimaryMetric(item) ? <Text style={styles.kcal}>{feedPrimaryMetric(item)}</Text> : null}
                </View>
                {feedImages(item).length ? (
                  <View style={styles.feedImageGrid}>
                    {feedImages(item).slice(0, 3).map((url, imageIndex) => (
                      <Image key={`${url}-${imageIndex}`} source={{ uri: url }} style={styles.feedImage} />
                    ))}
                  </View>
                ) : null}
                <View style={styles.pillRow}>
                  {feedPills(item).map((text) => <Pill key={text} text={text} />)}
                </View>
              </Card>
            </Pressable>
          ))}
        </>
      ) : (
        <>
          {recipes.length === 0 && foods.length === 0 ? <EmptyState text="暂无收藏" /> : null}
          {recipes.map((recipe) => (
            <Pressable key={recipe.id} onPress={() => navigation.navigate('RecipeEdit', { recipeId: recipe.id })}>
              <Card>
                <Text style={styles.itemName}>{recipe.recipe_name || '收藏食谱'}</Text>
                <Text style={styles.subtitle}>{recipeSubtitle(recipe)}</Text>
              </Card>
            </Pressable>
          ))}
          {foods.map((food) => (
            <Pressable key={food.id} onPress={() => navigation.navigate('PublicFoodDetail', { itemId: food.id, isCampus: Boolean(food.is_campus_food) })}>
              <Card>
                <Text style={styles.itemName}>{food.food_name || '公共食物'}</Text>
                <Text style={styles.subtitle}>{food.merchant_name || food.canteen_name || food.city || '用户分享'} · {Math.round(food.total_calories || 0)} kcal</Text>
              </Card>
            </Pressable>
          ))}
        </>
      )}
    </Page>
  )
}

function Field({
  label,
  value,
  onChangeText,
  placeholder,
  multiline,
}: {
  label: string
  value: string
  onChangeText: (value: string) => void
  placeholder?: string
  multiline?: boolean
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textMuted}
        multiline={multiline}
        textAlignVertical={multiline ? 'top' : 'center'}
        style={[styles.input, multiline && styles.textarea]}
      />
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

function SmallButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={styles.smallButton}>
      <Text style={styles.smallButtonText}>{label}</Text>
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

function feedTitle(item: CommunityFeedItem): string {
  const record = item.record
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

function feedPrimaryMetric(item: CommunityFeedItem): string {
  const record = item.record
  const type = normalizeTargetType(item.target_type || record?.feed_type)
  if (type === 'exercise_log' && numberFrom(record?.calories_burned) > 0) {
    return `${Math.round(numberFrom(record.calories_burned))} kcal`
  }
  if (type === 'campus_food' && record?.price != null) {
    return `¥${Number(record.price).toFixed(1)}`
  }
  if (numberFrom(record?.total_calories) > 0) {
    return `${Math.round(numberFrom(record.total_calories))} kcal`
  }
  return ''
}

function feedImages(item: CommunityFeedItem): string[] {
  const record = item.record
  const urls = Array.isArray(record?.image_paths) ? record.image_paths : []
  const all = [...urls, record?.image_path || '']
  return Array.from(new Set(all.map((url) => String(url || '').trim()).filter(Boolean)))
}

function feedPills(item: CommunityFeedItem): string[] {
  const record = item.record
  const pills = [`赞 ${item.like_count || 0}`, `评 ${item.comment_count || item.comments?.length || 0}`]
  const type = normalizeTargetType(item.target_type || record?.feed_type)
  if (type === 'exercise_log') {
    if (numberFrom(record?.duration_min) > 0) pills.push(`${Math.round(numberFrom(record.duration_min))} 分钟`)
    if (record?.exercise_type) pills.push(String(record.exercise_type))
    return pills
  }
  if (numberFrom(record?.total_protein) > 0) pills.push(`蛋白 ${formatCompactNumber(record.total_protein)}g`)
  if (numberFrom(record?.total_carbs) > 0) pills.push(`碳水 ${formatCompactNumber(record.total_carbs)}g`)
  if (numberFrom(record?.total_fat) > 0) pills.push(`脂肪 ${formatCompactNumber(record.total_fat)}g`)
  if (numberFrom(record?.fiber) > 0) pills.push(`纤维 ${formatCompactNumber(record.fiber)}g`)
  if (numberFrom(record?.sugar) > 0) pills.push(`糖 ${formatCompactNumber(record.sugar)}g`)
  if (numberFrom(record?.sodium_mg) > 0) pills.push(`钠 ${Math.round(numberFrom(record.sodium_mg))}mg`)
  if (numberFrom(record?.total_weight_grams) > 0) pills.push(`${Math.round(numberFrom(record.total_weight_grams))}g`)
  return pills.slice(0, 8)
}

function recipeSubtitle(recipe: RecipeItem): string {
  const parts = [
    `${Math.round(numberFrom(recipe.total_calories))} kcal`,
    mealLabel(recipe.meal_type),
    recipe.use_count ? `使用 ${recipe.use_count} 次` : '',
    recipe.tags?.slice(0, 3).join('、') || '',
  ]
  return parts.filter(Boolean).join(' · ')
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

function numberFrom(value: unknown, fallback = 0): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

function formatCompactNumber(value: unknown): string {
  const n = numberFrom(value)
  return n >= 10 ? String(Math.round(n)) : n.toFixed(1).replace(/\.0$/, '')
}

function normalizeTargetType(value: unknown): CommunityFeedTargetType {
  if (value === 'circle_post' || value === 'exercise_log' || value === 'campus_food') {
    return value
  }
  return value === 'exercise_checkin' ? 'exercise_log' : 'food_record'
}

function showError(title: string, error: unknown) {
  Alert.alert(title, error instanceof Error ? error.message : '请稍后重试')
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  heroCard: {
    overflow: 'hidden',
    padding: 0,
  },
  coverImage: {
    width: '100%',
    height: 142,
    backgroundColor: colors.surfaceMuted,
  },
  coverFallback: {
    width: '100%',
    height: 142,
    backgroundColor: colors.brandSoft,
  },
  profileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 18,
    paddingTop: 14,
  },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 3,
    borderColor: '#fff',
    marginTop: -34,
  },
  avatarFallback: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 3,
    borderColor: '#fff',
    backgroundColor: colors.brandSoft,
    marginTop: -34,
  },
  rowBetween: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  buttonRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    paddingHorizontal: 18,
    paddingBottom: 18,
  },
  pillRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 12,
  },
  feedImageGrid: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
  },
  feedImage: {
    flex: 1,
    minHeight: 96,
    borderRadius: 12,
    backgroundColor: colors.surfaceMuted,
  },
  bigTitle: {
    color: colors.text,
    fontSize: 22,
    fontWeight: '900',
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '800',
    marginBottom: 10,
  },
  subtitle: {
    color: colors.textSecondary,
    lineHeight: 21,
  },
  idText: {
    marginTop: 4,
    color: colors.textMuted,
    fontSize: 12,
  },
  itemName: {
    color: colors.text,
    fontWeight: '800',
  },
  kcal: {
    color: colors.brandDark,
    fontWeight: '900',
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
    gap: 8,
    marginBottom: 16,
  },
  segmentItem: {
    flex: 1,
    minHeight: 42,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  segmentItemActive: {
    backgroundColor: colors.brand,
  },
  segmentText: {
    color: colors.textSecondary,
    fontWeight: '800',
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
  smallButtonText: {
    color: colors.brandDark,
    fontWeight: '800',
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
  deleteAccount: {
    alignItems: 'center',
    paddingTop: 12,
  },
  deleteText: {
    color: colors.danger,
    fontWeight: '800',
  },
  empty: {
    color: colors.textMuted,
    textAlign: 'center',
  },
})
