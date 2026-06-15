import { useCallback, useEffect, useMemo, useState } from 'react'
import { Alert, Image, Pressable, Share, StyleSheet, Text, TextInput, View } from 'react-native'
import * as Clipboard from 'expo-clipboard'
import * as ImagePicker from 'expo-image-picker'
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native'
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
import type { RootStackParamList } from '../navigation/types'
import { colors } from '../theme'
import { todayKey } from '../utils/date'

const mealOptions: MealType[] = ['breakfast', 'morning_snack', 'lunch', 'afternoon_snack', 'dinner', 'evening_snack']
const PUBLIC_FOOD_MAX_IMAGES = 3

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

  useEffect(() => {
    void load()
  }, [load])

  return (
    <Page title="打卡排行榜" subtitle={range || '本周饮食、运动记录排行'} refreshing={loading} onRefresh={load}>
      {items.length === 0 ? <EmptyState text="暂无排行榜数据" /> : null}
      {items.map((item, index) => (
        <Pressable key={item.user_id} onPress={() => navigation.navigate('ProfileSettings', { userId: item.user_id })}>
          <Card>
            <View style={styles.rowBetween}>
              <View style={styles.rankNo}>
                <Text style={styles.rankNoText}>#{item.rank || index + 1}</Text>
              </View>
              <View style={styles.flex}>
                <Text style={styles.itemName}>{item.nickname || '食友'}</Text>
                <Text style={styles.subtitle}>本周打卡 {item.record_count || 0} 次</Text>
              </View>
              <Text style={styles.chevron}>›</Text>
            </View>
          </Card>
        </Pressable>
      ))}
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
          setInviteNotice(error instanceof Error ? error.message : '这个邀请码没有匹配到用户，可检查后重新输入。')
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
      setInviteNotice(error instanceof Error ? error.message : '没有找到对应邀请人，请检查邀请码。')
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
    </Page>
  )
}

export function FollowListScreen() {
  const route = useRoute<RouteProp<RootStackParamList, 'FollowList'>>()
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  const [items, setItems] = useState<FollowUserItem[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [offset, setOffset] = useState(0)
  const [loading, setLoading] = useState(false)
  const type = route.params.type || 'followers'
  const title = type === 'followers' ? '被关注' : '关注'

  const load = useCallback(async (reset = true) => {
    setLoading(true)
    try {
      const currentOffset = reset ? 0 : offset
      const data = type === 'followers'
        ? await apiClient.getFollowers(route.params.userId, currentOffset, 30)
        : await apiClient.getFollowing(route.params.userId, currentOffset, 30)
      const next = data.list || []
      setItems((prev) => reset ? next : [...prev, ...next])
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

  return (
    <Page title={title} subtitle="关注关系和用户主页" refreshing={loading} onRefresh={() => load(true)}>
      {items.length === 0 ? <EmptyState text={`暂无${title}`} /> : null}
      {items.map((user, index) => {
        const userId = String(user.id || user.user_id || '')
        return (
          <Pressable key={userId || index} onPress={() => userId ? navigation.navigate('ProfileSettings', { userId }) : undefined}>
            <Card>
              <View style={styles.rowBetween}>
                <View style={styles.avatarFallback} />
                <View style={styles.flex}>
                  <Text style={styles.itemName}>{user.nickname || '用户'}</Text>
                  <Text style={styles.subtitle}>{userId}</Text>
                </View>
                <Text style={styles.chevron}>›</Text>
              </View>
            </Card>
          </Pressable>
        )
      })}
      {hasMore ? <AppButton label="加载更多" variant="secondary" loading={loading} onPress={() => load(false)} /> : null}
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
  const [isCampus, setIsCampus] = useState(campusDefault)
  const [schoolName, setSchoolName] = useState('')
  const [canteenName, setCanteenName] = useState('')
  const [floor, setFloor] = useState('')
  const [windowName, setWindowName] = useState('')
  const [price, setPrice] = useState('')
  const [priceUnit, setPriceUnit] = useState('份')
  const [portionDescription, setPortionDescription] = useState('')
  const [tasteRating, setTasteRating] = useState('')
  const [suitableForFatLoss, setSuitableForFatLoss] = useState(true)
  const [tags, setTags] = useState('')
  const [notes, setNotes] = useState('')
  const [campusLocationText, setCampusLocationText] = useState('')
  const [loading, setLoading] = useState(false)

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
        setIsCampus(Boolean(item.is_campus_food))
        setSchoolName(item.school_name || '')
        setCanteenName(item.canteen_name || '')
        setFloor(item.floor || '')
        setWindowName(item.window_name || '')
        setPrice(item.price != null ? String(item.price) : '')
        setPriceUnit(item.price_unit || '份')
        setPortionDescription(item.portion_description || '')
        setTasteRating(item.taste_rating != null ? String(item.taste_rating) : '')
        setSuitableForFatLoss(item.suitable_for_fat_loss ?? true)
        setTags((item.user_tags || []).join('、'))
        setNotes(item.user_notes || '')
        setCampusLocationText(item.campus_location_text || '')
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
    void load()
  }, [load])

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
    setLoading(true)
    try {
      const input = {
        foodName,
        description,
        imagePaths: splitTextList(imageUrls),
        merchantName,
        merchantAddress,
        totalCalories: Number(calories) || 0,
        totalProtein: Number(protein) || 0,
        totalCarbs: Number(carbs) || 0,
        totalFat: Number(fat) || 0,
        isCampusFood: isCampus,
        type: isCampus ? 'campus' : 'restaurant',
        schoolName,
        canteenName,
        floor,
        windowName,
        price: price ? Number(price) : undefined,
        priceUnit,
        portionDescription,
        tasteRating: tasteRating ? Number(tasteRating) : undefined,
        suitableForFatLoss,
        userTags: splitTextList(tags),
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
        <Field label={isCampus ? '窗口/商户' : '商家名称'} value={merchantName} onChangeText={setMerchantName} />
        <Field label="地址/位置" value={merchantAddress} onChangeText={setMerchantAddress} placeholder="商家地址、校区或楼栋位置" />
        <View style={styles.segment}>
          <SegmentButton label="外食/自制" active={!isCampus} onPress={() => setIsCampus(false)} />
          <SegmentButton label="校园餐" active={isCampus} onPress={() => setIsCampus(true)} />
        </View>
        {isCampus ? (
          <>
            <Field label="学校" value={schoolName} onChangeText={setSchoolName} />
            <Field label="食堂" value={canteenName} onChangeText={setCanteenName} />
            <Field label="楼层" value={floor} onChangeText={setFloor} />
            <Field label="窗口" value={windowName} onChangeText={setWindowName} />
            <Field label="校园位置描述" value={campusLocationText} onChangeText={setCampusLocationText} placeholder="如：东区一食堂二楼麻辣烫窗口" />
            <Field label="价格" value={price} onChangeText={setPrice} keyboardType="decimal-pad" />
            <Field label="价格单位" value={priceUnit} onChangeText={setPriceUnit} placeholder="份、碗、杯" />
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
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setSummary(await apiClient.getPetSummary(todayKey()))
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
    setLoading(true)
    try {
      const result = await apiClient.claimPetEvent(summary.event.id)
      Alert.alert('已领取', `经验 +${result.exp_awarded || 0}，积分 +${result.credits_awarded || 0}`)
      await load()
    } catch (error) {
      showError('领取失败', error)
    } finally {
      setLoading(false)
    }
  }

  const pet = summary?.pet
  const petMood = petMoodLabel(summary?.status.mood)
  const petState = petStateLabel(summary?.status.state)
  const petMoodStateText = petMood.endsWith(petState) ? petMood : `${petMood} · ${petState}`
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
          <PetStat label="累计事件" value={`${pet?.total_events || 0}`} />
          <PetStat label="今日经验" value={`+${summary?.today.exp_gained || 0}`} />
          <PetStat label="每日积分上限" value={`${summary?.rewards.daily_credit_cap || 0}`} />
        </View>
      </Card>

      <Card>
        <Text style={styles.sectionTitle}>今日状态</Text>
        <Text style={styles.itemName}>{summary?.status.message || '记录一餐，开启今日成长。'}</Text>
        <Text style={styles.subtitle}>{summary?.status.task_text || '今天先记录一餐'}</Text>
        <View style={styles.nutritionRow}>
          <Pill text={`习惯分 ${summary?.today.habit_score || 0}`} />
          <Pill text={`今日经验 ${summary?.today.exp_gained || 0}`} />
          <Pill text={`离线 ${summary?.status.inactivity_days || 0} 天`} />
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

      {summary?.event ? (
        <Card>
          <Text style={styles.sectionTitle}>{summary.event.title}</Text>
          <Text style={styles.subtitle}>{summary.event.message}</Text>
          <View style={styles.nutritionRow}>
            <Pill text={`经验 +${summary.event.exp_reward || 0}`} />
            <Pill text={`积分 +${summary.event.credit_reward || 0}`} />
          </View>
          {summary.event.can_claim ? <AppButton label="领取奖励" loading={loading} onPress={claim} /> : null}
        </Card>
      ) : null}

      {(pet?.growth_unlocks || []).length ? (
        <Card>
          <Text style={styles.sectionTitle}>成长解锁</Text>
          <View style={styles.appearanceGrid}>
            {(pet?.growth_unlocks || []).map((unlock) => <Pill key={unlock} text={growthUnlockLabel(unlock)} />)}
          </View>
        </Card>
      ) : null}

      <AppButton label="外观实验室" variant="secondary" onPress={() => navigation.navigate('PetLab')} />
    </Page>
  )
}

export function PetLabScreen() {
  const [summary, setSummary] = useState<PetSummary | null>(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setSummary(await apiClient.getPetSummary(todayKey()))
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
    setLoading(true)
    try {
      await apiClient.selectPetAppearance(candidate.id)
      await load()
      Alert.alert('已选择', '外观已更新')
    } catch (error) {
      showError('选择失败', error)
    } finally {
      setLoading(false)
    }
  }

  const reroll = async () => {
    setLoading(true)
    try {
      await apiClient.rerollPetAppearance()
      await load()
      Alert.alert('已刷新', '新的外观已生成')
    } catch (error) {
      showError('刷新外观失败', error)
    } finally {
      setLoading(false)
    }
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
          <Pill text={`奖励积分消耗 5`} />
        </View>
        <AppButton label="消耗 5 积分刷新" variant="secondary" loading={loading} onPress={reroll} />
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
            <SmallButton label="选择这个" onPress={() => select(candidate)} />
          </View>
        </Card>
      ))}
    </Page>
  )
}

export function AgreementsScreen() {
  return (
    <Page title="用户服务协议" subtitle="Food Link 服务条款摘要">
      <LegalCard title="账号与数据" text="你可以使用微信登录或用户名密码登录。饮食记录、身体指标、社区互动和会员积分会随账号同步。" />
      <LegalCard title="AI 分析" text="食物识别、文字记录和运动估算会使用 AI 模型生成结果。结果用于健康记录参考，不替代医学诊断或治疗建议。" />
      <LegalCard title="社区内容" text="公开动态、公共食物库、评论和私信需要遵守社区规范；举报后管理员可处理违规内容。" />
      <LegalCard title="会员服务" text="会员套餐、积分额度和订单状态以账号内展示为准；异常订单或积分问题可在关于与反馈页提交。" />
    </Page>
  )
}

export function PrivacyPolicyScreen() {
  return (
    <Page title="隐私政策" subtitle="Food Link 隐私说明摘要">
      <LegalCard title="收集范围" text="仅收集完成登录、饮食分析、身体记录、社区互动、会员支付和问题反馈所需的信息。" />
      <LegalCard title="图片与位置" text="食物图片用于上传、识别和记录。公共食物库位置只在你主动填写或分享时保存。" />
      <LegalCard title="隐私开关" text="你可以在关于与反馈页控制是否允许被搜索、是否公开饮食记录，并可清除本地缓存。" />
      <LegalCard title="本地缓存" text="本地缓存用于保持登录状态和减少重复请求；清除缓存会保留登录状态，退出登录会移除登录状态。" />
    </Page>
  )
}

export function AutoRenewAuditScreen() {
  const [membership, setMembership] = useState<MembershipStatus | null>(null)
  const [plans, setPlans] = useState<MembershipPlan[]>([])
  const [selectedPlanCode, setSelectedPlanCode] = useState('')
  const [agreed, setAgreed] = useState(false)
  const [loading, setLoading] = useState(false)

  const selectedPlan = useMemo(
    () => plans.find((plan) => plan.code === selectedPlanCode) || plans[0],
    [plans, selectedPlanCode],
  )

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

  useEffect(() => {
    void load()
  }, [load])

  const showSignPreview = () => {
    if (!selectedPlan) {
      Alert.alert('暂无可选套餐', '请稍后刷新会员套餐。')
      return
    }
    if (!agreed) {
      Alert.alert('请先阅读并同意规则', '勾选会员服务协议及自动续费规则后再继续。')
      return
    }
    Alert.alert(
      '确认开通自动续费',
      [
        `开通服务：Food Link 会员 · ${selectedPlan.name}`,
        `扣费周期：${planPeriodLabel(selectedPlan)}`,
        `每期金额：¥${moneyText(selectedPlan.amount)}${planPeriodSuffix(selectedPlan)}`,
        '开通后，会员到期前将按所选周期自动续费；扣费前会按支付渠道规则通知。',
      ].join('\n'),
      [{ text: '知道了' }],
    )
  }

  const showCancelPreview = () => {
    Alert.alert(
      '关闭自动续费路径',
      [
        '产品内路径：我的 → 会员中心 → 自动续费审核 → 关闭自动续费。',
        '也可在微信支付或对应应用商店的扣费服务中关闭。',
        '关闭自动续费后，不影响已付费周期内会员权益。',
      ].join('\n'),
      [{ text: '知道了' }],
    )
  }

  return (
    <Page title="自动续费审核" subtitle="会员续费状态和支付渠道" refreshing={loading} onRefresh={load}>
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
        <Text style={styles.sectionTitle}>自动续费签约前说明</Text>
        <InfoLine label="服务名称" value={`Food Link 会员${selectedPlan ? ` · ${selectedPlan.name}` : ''}`} />
        <InfoLine label="扣费周期" value={selectedPlan ? planPeriodLabel(selectedPlan) : '--'} />
        <InfoLine label="每期金额" value={selectedPlan ? `¥${moneyText(selectedPlan.amount)}${planPeriodSuffix(selectedPlan)}` : '--'} />
        <InfoLine label="预计续费" value="当前周期到期前按支付渠道规则续费" />
        <Text style={styles.subtitle}>开通后，会员到期前将按所选周期自动续费；扣费前会按支付渠道规则通知。用户可随时关闭自动续费，关闭后不影响已付费周期内权益。</Text>
        <Pressable style={styles.checkRow} onPress={() => setAgreed((value) => !value)}>
          <View style={[styles.checkbox, agreed && styles.checkboxActive]}>
            <Text style={styles.checkboxText}>{agreed ? '✓' : ''}</Text>
          </View>
          <Text style={styles.checkText}>我已阅读并同意会员服务协议及自动续费规则</Text>
        </Pressable>
        <AppButton label="确认开通自动续费" loading={loading} onPress={showSignPreview} />
      </Card>

      <Card>
        <Text style={styles.sectionTitle}>关闭自动续费</Text>
        <Text style={styles.pathText}>我的 → 会员中心 → 自动续费审核 → 关闭自动续费</Text>
        <Text style={styles.subtitle}>也可在微信支付或对应应用商店的扣费服务中关闭。关闭后不影响已付费周期内会员权益。</Text>
        <View style={styles.buttonRow}>
          <SmallButton label="关闭路径说明" onPress={showCancelPreview} />
        </View>
      </Card>
    </Page>
  )
}

function LegalCard({ title, text }: { title: string; text: string }) {
  return (
    <Card>
      <Text style={styles.sectionTitle}>{title}</Text>
      <Text style={styles.subtitle}>{text}</Text>
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

function SmallButton({ label, danger, onPress }: { label: string; danger?: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.smallButton, danger && styles.smallButtonDanger]}>
      <Text style={[styles.smallButtonText, danger && styles.smallButtonDangerText]}>{label}</Text>
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

function showError(title: string, error: unknown) {
  Alert.alert(title, error instanceof Error ? error.message : '请稍后重试')
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
  rankNo: {
    width: 54,
    height: 54,
    borderRadius: 27,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.brandSoft,
  },
  rankNoText: {
    color: colors.brandDark,
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
  smallButtonText: {
    color: colors.brandDark,
    fontWeight: '800',
  },
  smallButtonDangerText: {
    color: colors.danger,
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
