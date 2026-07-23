import { useCallback, useEffect, useState } from 'react'
import { Image, Modal, Pressable, RefreshControl, ScrollView, Share, StyleSheet, Text, TextInput, View } from 'react-native'
import * as Clipboard from 'expo-clipboard'
import * as ImagePicker from 'expo-image-picker'
import { Image as ImageIcon, Moon, Pencil, Share2, Sun, X } from 'lucide-react-native'
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

export function ProfileSettingsScreen() {
  const route = useRoute<RouteProp<RootStackParamList, 'ProfileSettings'>>()
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  const { logout } = useAuth()
  const { isDark, toggleScheme } = useColorScheme()
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
  const [saving, setSaving] = useState(false)
  const [deleteConfirmVisible, setDeleteConfirmVisible] = useState(false)
  const [deleteConfirmation, setDeleteConfirmation] = useState('')
  const showError = useCallback((title: string, error: unknown) => {
    return dialog.alert(title, userFacingErrorMessage(error), 'danger')
  }, [dialog])

  useEffect(() => {
    getStoredUserId().then(setCurrentUserId).catch(() => setCurrentUserId(null))
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      if (isOwner) {
        setBlockStatus(null)
        const [profileData, feedData, recipeData] = await Promise.all([
          apiClient.getUserProfile(),
          apiClient.communityGetFeed({ limit: 20, includeComments: false }).catch(() => ({ list: [] })),
          apiClient.listRecipes({ isFavorite: true }).catch(() => ({ recipes: [] })),
        ])
        applyProfile(profileData)
        setPublicFavoriteRecipes(true)
        setFeed(feedData.list || [])
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
          return
        }
        const [profileData, feedData, recipeData, followStats] = await Promise.all([
          apiClient.getPublicProfile(userId),
          apiClient.communityGetPublicFeed({
            limit: 20,
            includeComments: false,
            params: { author_id: userId, sort_by: 'latest' },
          }).catch(() => ({ list: [] })),
          apiClient.getUserFavoriteRecipes(userId).catch(() => ({ recipes: [] })),
          apiClient.getFollowStats(userId).catch(() => null),
        ])
        applyProfile({ ...profileData, ...(followStats || {}) } as UserInfo & PublicProfile)
        setPublicFavoriteRecipes((profileData as PublicProfile & { public_favorite_recipes?: boolean }).public_favorite_recipes !== false)
        setFeed(feedData.list || [])
        setRecipes(recipeData.recipes || [])
      }
    } catch (error) {
      showError('获取主页失败', error)
    } finally {
      setLoading(false)
    }
  }, [isOwner, showError, targetUserId])

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
      await showError('关注失败', error)
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

  const resolvedProfileId = String(profile?.id || targetUserId || '').trim()
  const shortProfileId = formatShortUserId(resolvedProfileId)
  const canOpenFollowList = Boolean(profile?.id)

  return (
    <ScrollView
      style={styles.profileScroll}
      contentContainerStyle={[
        styles.profileContent,
        { paddingTop: 0, paddingBottom: insets.bottom + 104 },
      ]}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.brand} />}
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
            <Pressable onPress={() => setEditing(true)} style={styles.topEditButton}>
              <Pencil size={13} strokeWidth={2.4} color="#374151" />
              <Text style={styles.topEditButtonText}>编辑资料</Text>
            </Pressable>
          ) : null}
          {isOwner ? (
            <Pressable onPress={toggleScheme} style={styles.topIconButton}>
              {isDark ? <Sun size={16} color="#fff" /> : <Moon size={16} color="#fff" />}
            </Pressable>
          ) : null}
          <Pressable onPress={() => void shareProfile()} style={styles.topIconButton}>
            <Share2 size={16} color="#fff" />
          </Pressable>
        </View>

        <View style={styles.profileRow}>
          {avatar ? <Image source={{ uri: avatar }} style={styles.avatar} /> : <View style={styles.avatarFallback} />}
          <View style={styles.flex}>
            <Text style={styles.topName} numberOfLines={1}>{profile?.nickname || 'Food Link 用户'}</Text>
            <View style={styles.profileIdRow}>
              <Text style={styles.topIdText} selectable>ID: {shortProfileId || '-'}</Text>
              <Pressable onPress={() => void copyUserId()} style={styles.inlineCopyButton}>
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
            style={styles.profileStatItem}
            onPress={() => canOpenFollowList && profile?.id ? navigation.navigate('FollowList', { userId: profile.id, type: 'followers' }) : undefined}
          >
            <Text style={styles.profileStatNumber}>{profile?.followers_count || 0}</Text>
            <Text style={styles.profileStatLabel}>被关注</Text>
          </Pressable>
          <Text style={styles.profileStatDivider}>|</Text>
          <Pressable
            style={styles.profileStatItem}
            onPress={() => canOpenFollowList && profile?.id ? navigation.navigate('FollowList', { userId: profile.id, type: 'following' }) : undefined}
          >
            <Text style={styles.profileStatNumber}>{profile?.following_count || 0}</Text>
            <Text style={styles.profileStatLabel}>关注</Text>
          </Pressable>
        </View>

        {profile?.motto || isOwner ? (
          <Pressable style={styles.mottoRow} onPress={isOwner ? () => setEditing(true) : undefined}>
            <Text style={[styles.mottoText, !profile?.motto && styles.mottoTextEmpty]} numberOfLines={2}>
              {profile?.motto || '点击编辑资料添加座右铭'}
            </Text>
          </Pressable>
        ) : null}

        {!isOwner ? (
          <View style={styles.profileActionRow}>
            {blockStatus?.is_blocked_by_me ? (
              <Pressable style={styles.profileActionButtonLight} onPress={() => void unblockUser()}>
                <Text style={styles.profileActionButtonLightText}>解除拉黑</Text>
              </Pressable>
            ) : blockStatus?.blocked_either ? (
              <View style={styles.profileBlockedPill}>
                <Text style={styles.profileBlockedPillText}>内容不可见</Text>
              </View>
            ) : (
              <>
                <Pressable style={[styles.profileActionButton, profile?.is_following && styles.profileActionButtonGhost]} onPress={toggleFollow}>
                  <Text style={styles.profileActionButtonText}>{profile?.is_following ? '已关注' : '+ 关注'}</Text>
                </Pressable>
                {targetUserId ? (
                  <Pressable style={styles.profileActionButtonLight} onPress={() => navigation.navigate('PrivateChat', { userId: targetUserId, nickname: profile?.nickname })}>
                    <Text style={styles.profileActionButtonLightText}>私信</Text>
                  </Pressable>
                ) : null}
                <Pressable style={styles.profileBlockButton} onPress={() => void blockUser()}>
                  <Text style={styles.profileBlockButtonText}>拉黑</Text>
                </Pressable>
              </>
            )}
          </View>
        ) : null}
      </View>

      <View style={styles.bottomDrawer}>
        <View style={styles.drawerHandle} />

        <View style={styles.segment}>
          <SegmentButton label="最新动态" active={activeTab === 'feed'} onPress={() => setActiveTab('feed')} />
          {(isOwner || publicFavoriteRecipes) ? (
            <SegmentButton label="食物收藏" active={activeTab === 'collections'} onPress={() => setActiveTab('collections')} />
          ) : null}
        </View>

        <View style={styles.contentBody}>
          {blockStatus?.blocked_either ? (
            <EmptyState text="内容不可见" />
          ) : activeTab === 'feed' ? (
            <>
              {feed.length === 0 ? <EmptyState text="暂无动态" /> : null}
              {feed.map((item, index) => (
                <Pressable key={`${item.target_type || item.record?.feed_type}-${item.target_id || item.record?.id || index}`} onPress={() => openFeed(item)}>
                  <View style={styles.feedCard}>
                    <Text style={styles.profileFeedTime}>{feedSubtitle(item)}</Text>
                    <Text style={styles.profileFeedTitle} numberOfLines={2}>{feedTitle(item)}</Text>
                    {shouldShowCompactFoodCard(item) ? (
                      <CompactFoodCard item={item} />
                    ) : feedImages(item).length ? (
                      <View style={styles.feedImageGrid}>
                        {feedImages(item).slice(0, 3).map((url, imageIndex) => (
                          <Image key={`${url}-${imageIndex}`} source={{ uri: url }} style={styles.feedImage} />
                        ))}
                      </View>
                    ) : null}
                    <View style={styles.feedFooter}>
                      <View style={styles.nutritionRow}>
                        {feedNutrition(item).map((entry) => (
                          <Text key={entry.text} style={[styles.nutritionText, { color: entry.color }]}>{entry.text}</Text>
                        ))}
                      </View>
                      <Text style={styles.likeText}>❤ {item.like_count || 0}</Text>
                    </View>
                  </View>
                </Pressable>
              ))}
            </>
          ) : (
            <>
              {recipes.length === 0 ? <EmptyState text="暂无食物收藏" /> : null}
              {recipes.map((recipe) => (
                <Pressable key={recipe.id} onPress={() => navigation.navigate('RecipeDetail', { recipeId: recipe.id })}>
                  <View style={styles.collectionCard}>
                    <View style={styles.collectionMain}>
                      <Text style={styles.itemName}>{recipe.recipe_name || '未命名食谱'}</Text>
                      <View style={styles.collectionNutrition}>
                        {recipe.total_calories > 0 ? <Text style={styles.nutritionKcal}>◉ {Math.round(recipe.total_calories)}</Text> : null}
                        {recipe.total_protein > 0 ? <Text style={styles.nutritionProtein}>● {Math.round(recipe.total_protein)}g</Text> : null}
                        {(recipe.total_carbs || 0) > 0 ? <Text style={styles.nutritionCarbs}>● {Math.round(recipe.total_carbs || 0)}g</Text> : null}
                        {(recipe.total_fat || 0) > 0 ? <Text style={styles.nutritionFat}>● {Math.round(recipe.total_fat || 0)}g</Text> : null}
                      </View>
                    </View>
                    {recipe.image_path ? <Image source={{ uri: recipe.image_path }} style={styles.collectionImage} /> : null}
                  </View>
                </Pressable>
              ))}
            </>
          )}
        </View>
      </View>

      <Modal visible={editing && isOwner} transparent animationType="slide" onRequestClose={() => setEditing(false)}>
        <Pressable style={styles.editSheetMask} onPress={() => setEditing(false)}>
          <Pressable style={[styles.editSheet, { paddingBottom: insets.bottom + 20 }]} onPress={(event) => event.stopPropagation()}>
            <ScrollView showsVerticalScrollIndicator={false}>
              <View style={styles.drawerHandle} />
              <View style={styles.editSheetHeader}>
                <Text style={styles.sectionTitle}>编辑资料</Text>
                <Pressable onPress={() => setEditing(false)} style={styles.editSheetClose}>
                  <X size={20} color={colors.text} />
                </Pressable>
              </View>
              <Pressable style={styles.editAvatarWrap} onPress={() => void pickProfileImage('avatar')}>
                {avatar ? <Image source={{ uri: avatar }} style={styles.editAvatar} /> : <View style={styles.editAvatar} />}
              </Pressable>
              <Text style={styles.fieldLabel}>主页背景图</Text>
              <Pressable style={styles.editCover} onPress={() => void pickProfileImage('cover')}>
                {coverImage ? <Image source={{ uri: coverImage }} style={styles.editCoverImage} /> : (
                  <View style={styles.editCoverPlaceholder}>
                    <ImageIcon size={24} color={colors.textMuted} />
                    <Text style={styles.editCoverPlaceholderText}>点击选择背景图</Text>
                  </View>
                )}
              </Pressable>
              <Field label="昵称" value={nickname} onChangeText={setNickname} placeholder="请输入昵称" />
              <Field label="座右铭" value={motto} onChangeText={setMotto} placeholder="写一句你的座右铭（最多30字）" maxLength={30} />
              {resolvedProfileId ? (
                <View style={styles.field}>
                  <Text style={styles.fieldLabel}>用户ID</Text>
                  <View style={styles.editIdRow}>
                    <Text style={[styles.editIdValue, styles.flex]} selectable>{resolvedProfileId}</Text>
                    <SmallButton label="复制" onPress={() => void copyUserId()} />
                  </View>
                </View>
              ) : null}
              <AppButton label="保存" loading={saving} onPress={saveProfile} />
              <Pressable onPress={() => void confirmDeleteAccount()} style={styles.deleteAccount}>
                <Text style={styles.deleteText}>注销账号</Text>
              </Pressable>
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
      <Modal visible={deleteConfirmVisible} transparent animationType="fade" onRequestClose={() => setDeleteConfirmVisible(false)}>
        <Pressable style={styles.deleteDialogMask} onPress={() => setDeleteConfirmVisible(false)}>
          <Pressable style={styles.deleteDialog} onPress={(event) => event.stopPropagation()}>
            <Text style={styles.deleteDialogTitle}>确认注销账号</Text>
            <Text style={styles.deleteDialogDescription}>这是不可恢复的操作。请输入“注销账号”后继续。</Text>
            <Text style={styles.fieldLabel}>确认文案</Text>
            <TextInput
              value={deleteConfirmation}
              onChangeText={setDeleteConfirmation}
              placeholder="注销账号"
              placeholderTextColor={colors.textMuted}
              maxLength={8}
              style={styles.input}
            />
            <View style={styles.deleteDialogActions}>
              <Pressable style={styles.deleteDialogCancel} disabled={saving} onPress={() => setDeleteConfirmVisible(false)}>
                <Text style={styles.deleteDialogCancelText}>取消</Text>
              </Pressable>
              <Pressable
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
  label,
  value,
  onChangeText,
  placeholder,
  multiline,
  maxLength,
}: {
  label: string
  value: string
  onChangeText: (value: string) => void
  placeholder?: string
  multiline?: boolean
  maxLength?: number
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
        maxLength={maxLength}
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
      {active ? <View style={styles.segmentIndicator} /> : null}
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

function EmptyState({ text }: { text: string }) {
  return (
    <View style={styles.contentEmpty}>
      <Text style={styles.empty}>{text}</Text>
    </View>
  )
}

function CompactFoodCard({ item }: { item: CommunityFeedItem }) {
  const record = item.record
  const recipeId = (record as typeof record & { recipe_id?: string }).recipe_id
  const firstFood = record.items?.[0]
  const imageUrl = String(firstFood?.image_path || record.image_path || '').trim()
  const calories = numberFrom(firstFood?.nutrients?.calories) || numberFrom(record.total_calories)
  return (
    <View style={styles.compactFoodCard}>
      {imageUrl ? <Image source={{ uri: imageUrl }} style={styles.compactFoodImage} /> : <View style={styles.compactFoodImage} />}
      <View style={styles.compactFoodMain}>
        <Text style={styles.compactFoodName} numberOfLines={1}>{firstFood?.name || record.description || '食物记录'}</Text>
        {calories > 0 ? <Text style={styles.compactFoodKcal}>{Math.round(calories)} kcal</Text> : null}
      </View>
      <View style={styles.compactFoodBadge}>
        <Text style={styles.compactFoodBadgeText}>{recipeId ? '收藏' : '常用食物'}</Text>
      </View>
    </View>
  )
}

function shouldShowCompactFoodCard(item: CommunityFeedItem): boolean {
  const type = normalizeTargetType(item.target_type || item.record?.feed_type)
  const recipeId = (item.record as typeof item.record & { recipe_id?: string }).recipe_id
  return type === 'food_record' && Boolean(item.record.items?.length || recipeId)
}

function feedNutrition(item: CommunityFeedItem): Array<{ text: string; color: string }> {
  const record = item.record
  const type = normalizeTargetType(item.target_type || record.feed_type)
  const entries: Array<{ text: string; color: string }> = []
  const calories = type === 'exercise_log' ? numberFrom(record.calories_burned) : numberFrom(record.total_calories)
  if (calories > 0) entries.push({ text: type === 'exercise_log' ? `● 消耗 ${Math.round(calories)}` : `● ${Math.round(calories)}`, color: '#00a873' })
  if (numberFrom(record.total_protein) > 0) entries.push({ text: `● ${Math.round(numberFrom(record.total_protein))}g`, color: '#5c9ed4' })
  if (numberFrom(record.total_carbs) > 0) entries.push({ text: `● ${Math.round(numberFrom(record.total_carbs))}g`, color: '#b88930' })
  if (numberFrom(record.total_fat) > 0) entries.push({ text: `● ${Math.round(numberFrom(record.total_fat))}g`, color: '#e17e41' })
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
    minHeight: 30,
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
    width: 30,
    height: 30,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.16)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.22)',
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
    minHeight: 32,
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
    minHeight: 32,
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
    minHeight: 32,
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
    minHeight: 32,
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
    alignItems: 'center',
    paddingTop: 10,
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
    minHeight: 34,
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
    width: 32,
    height: 32,
    borderRadius: 16,
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
})
