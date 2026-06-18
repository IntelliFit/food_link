import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, Alert, Image, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import * as Clipboard from 'expo-clipboard'
import * as ImagePicker from 'expo-image-picker'
import { CommonActions, useFocusEffect, useNavigation, useRoute, type RouteProp } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import {
  getMealTypeLabel,
  inferDefaultMealTypeFromLocalTime,
  type CampusRelatedFeedItem,
  type CommunityFeedContext,
  type CommunityFeedTargetType,
  type ConversationSummary,
  type FeedCommentItem,
  type ManualFoodItem,
  type MealType,
  type MembershipPaymentOrder,
  type MembershipPlan,
  type MembershipStatus,
  type PrivateMessageItem,
  type PublicFoodComment,
  type PublicFoodItem,
  type PublicProfile,
  type RecipeItem,
  type StatsSummary,
} from '@food-link/core'
import { apiClient, getStoredUserId } from '../api'
import { AppButton } from '../components/AppButton'
import { Card } from '../components/Card'
import { MacroRow } from '../components/MacroRow'
import { Page } from '../components/Page'
import type { RootStackParamList } from '../navigation/types'
import { colors } from '../theme'
import { formatDateTime, todayKey } from '../utils/date'
import { userFacingErrorMessage } from '../utils/errors'

const mealOptions: MealType[] = ['breakfast', 'morning_snack', 'lunch', 'afternoon_snack', 'dinner', 'evening_snack']
const SYSTEM_MESSAGE_USER_ID = '00000000-0000-0000-0000-000000000000'
const privateConversationPageSize = 20
const privateMessagePageSize = 20
const privateMessagePollMs = 3000

type PublicFoodReplyTarget = {
  parentCommentId: string
  replyToUserId: string
  nickname: string
}

export function MembershipCenterScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  const [membership, setMembership] = useState<MembershipStatus | null>(null)
  const [plans, setPlans] = useState<MembershipPlan[]>([])
  const [lastOrder, setLastOrder] = useState<MembershipPaymentOrder | null>(null)
  const [selectedPlanCode, setSelectedPlanCode] = useState('')
  const [loading, setLoading] = useState(false)

  const sortedPlans = useMemo(() => plans.slice().sort((a, b) => {
    const orderDiff = (a.sort_order || 0) - (b.sort_order || 0)
    return orderDiff || (a.amount || 0) - (b.amount || 0)
  }), [plans])

  const selectedPlan = useMemo(
    () => sortedPlans.find((plan) => plan.code === selectedPlanCode) || sortedPlans[0],
    [selectedPlanCode, sortedPlans],
  )

  const currentPlan = useMemo(
    () => sortedPlans.find((plan) => plan.code === membership?.current_plan_code),
    [membership?.current_plan_code, sortedPlans],
  )

  const creditsMax = numericValue(membership?.daily_credits_max ?? membership?.daily_limit)
  const creditsUsed = numericValue(membership?.daily_credits_used ?? membership?.daily_used)
  const systemRemaining = numericValue(membership?.system_credits_remaining ?? membership?.daily_credits_remaining ?? membership?.daily_remaining)
  const earnedBalance = numericValue(membership?.earned_credits_balance ?? membership?.points_balance)
  const totalAvailable = numericValue(membership?.total_credits_available ?? membership?.daily_credits_remaining ?? membership?.daily_remaining)
  const usagePercent = creditsMax > 0 ? Math.min(100, Math.max(0, (creditsUsed / creditsMax) * 100)) : 0

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
        return nextPlans[0]?.code || ''
      })
    } catch (error) {
      showError('获取会员中心失败', error)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const createPayment = async (plan: MembershipPlan) => {
    setLoading(true)
    try {
      const order = await apiClient.createMembershipPayment(plan.code)
      setLastOrder(order)
      Alert.alert('订单已创建', '请在支付渠道完成付款；支付完成后可返回会员中心同步订单状态。')
    } catch (error) {
      showError('创建订单失败', error)
    } finally {
      setLoading(false)
    }
  }

  const previewPayment = () => {
    if (!selectedPlan) {
      Alert.alert('请选择套餐', '当前暂无可购买套餐，请刷新后重试。')
      return
    }
    Alert.alert(
      membership?.is_pro ? '确认续费或升级' : '确认开通会员',
      [
        `套餐：${selectedPlan.name}`,
        `权益：${planPeriodText(selectedPlan)} · 每日 ${selectedPlan.daily_credits || 0} 系统积分`,
        `金额：¥${money(selectedPlan.amount)}`,
        paymentModePreview(membership, selectedPlan),
      ].filter(Boolean).join('\n'),
      [
        { text: '再看看', style: 'cancel' },
        { text: '创建订单', onPress: () => void createPayment(selectedPlan) },
      ],
    )
  }

  const syncOrder = async () => {
    if (!lastOrder?.order_no) return
    setLoading(true)
    try {
      await apiClient.syncMembershipPayment(lastOrder.order_no)
      await load()
      Alert.alert('已同步', '订单状态已刷新')
    } catch (error) {
      showError('同步订单失败', error)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Page title="会员中心" subtitle="套餐、积分额度和支付订单" refreshing={loading} onRefresh={load}>
      <Card>
        <View style={styles.rowBetween}>
          <View style={styles.flex}>
            <Text style={styles.sectionTitle}>当前会员</Text>
            {membership ? (
              <Text style={styles.subtitle}>{membershipStatusText(membership)}</Text>
            ) : (
              <View style={styles.membershipStatusSpinner}>
                <ActivityIndicator size="small" color={colors.brand} />
              </View>
            )}
          </View>
          {membership ? (
            <Pill text={membership.trial_active ? '试用中' : membership.is_pro ? 'Pro' : '基础账号'} />
          ) : null}
        </View>
        <Text style={styles.bigNumber}>{totalAvailable}</Text>
        <Text style={styles.subtitle}>当前可用积分</Text>
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${usagePercent}%` }]} />
        </View>
        <View style={styles.creditGrid}>
          <InfoTile label="系统剩余" value={`${systemRemaining}`} />
          <InfoTile label="奖励积分" value={`${earnedBalance}`} />
          <InfoTile label="今日已用" value={`${creditsUsed}`} />
          <InfoTile label="每日额度" value={`${creditsMax}`} />
        </View>
        <View style={styles.metaBlock}>
          <InfoRow label="当前套餐" value={currentPlan?.name || membership?.current_plan_code || '未开通'} />
          <InfoRow label="有效期至" value={dateText(membership?.expires_at)} />
          <InfoRow label="积分重置" value={dateText(membership?.credits_reset_at, true)} />
          <InfoRow label="创始礼遇" value={founderBonusText(membership)} />
        </View>
        <View style={styles.buttonRow}>
          <SmallButton label="自动续费审核" onPress={() => navigation.navigate('AutoRenewAudit')} />
          <SmallButton label="会员协议" onPress={() => navigation.navigate('MembershipAgreement')} />
        </View>
      </Card>

      {lastOrder ? (
        <Card>
          <Text style={styles.sectionTitle}>最近订单</Text>
          <InfoRow label="订单号" value={lastOrder.order_no} />
          <InfoRow label="订单状态" value={paymentStatusText(lastOrder.status)} />
          <InfoRow label="订单类型" value={orderModeText(lastOrder.order_mode)} />
          <InfoRow label="套餐" value={planName(lastOrder.plan_code, sortedPlans)} />
          <InfoRow label="应付金额" value={`¥${money(lastOrder.amount)}`} />
          {lastOrder.original_amount != null && Number(lastOrder.original_amount) !== Number(lastOrder.amount) ? (
            <InfoRow label="套餐原价" value={`¥${money(lastOrder.original_amount)}`} />
          ) : null}
          <InfoRow label="支付参数" value={lastOrder.pay_params ? '已生成' : '未生成'} />
          <UpgradeTermsBlock order={lastOrder} />
          <View style={styles.buttonRow}>
            <SmallButton label="同步状态" onPress={syncOrder} />
          </View>
        </Card>
      ) : null}

      <Card>
        <Text style={styles.sectionTitle}>选择套餐</Text>
        {sortedPlans.length === 0 ? <Text style={styles.empty}>暂无可购买套餐</Text> : null}
        {sortedPlans.map((plan) => {
          const active = selectedPlan?.code === plan.code
          const isCurrent = membership?.is_pro && membership.current_plan_code === plan.code
          return (
            <Pressable
              key={plan.code}
              onPress={() => setSelectedPlanCode(plan.code)}
              style={[styles.membershipPlanRow, active && styles.membershipPlanRowActive]}
            >
              <View style={styles.flex}>
                <View style={styles.rowBetween}>
                  <Text style={styles.itemName}>{plan.name}</Text>
                  {isCurrent ? <Pill text="当前套餐" /> : null}
                </View>
                <Text style={styles.subtitle}>
                  {planPeriodText(plan)} · 每日 {plan.daily_credits || 0} 系统积分
                </Text>
                {plan.description ? <Text style={styles.notes}>{plan.description}</Text> : null}
                <View style={styles.nutritionRow}>
                  {plan.tier ? <Pill text={planTierText(plan.tier)} /> : null}
                  {plan.savings ? <Pill text={`省 ¥${money(plan.savings)}`} /> : null}
                </View>
              </View>
              <View style={styles.priceBlock}>
                <Text style={styles.price}>¥{money(plan.amount)}</Text>
                {plan.original_amount ? <Text style={styles.originalPrice}>¥{money(plan.original_amount)}</Text> : null}
              </View>
            </Pressable>
          )
        })}
      </Card>

      {selectedPlan ? (
        <Card>
          <Text style={styles.sectionTitle}>支付确认</Text>
          <InfoRow label="选择套餐" value={selectedPlan.name} />
          <InfoRow label="套餐周期" value={planPeriodText(selectedPlan)} />
          <InfoRow label="每日积分" value={`${selectedPlan.daily_credits || 0} 系统积分`} />
          <InfoRow label="预计付款" value={`¥${money(selectedPlan.amount)}`} />
          <InfoRow label="生效方式" value={paymentModePreview(membership, selectedPlan)} />
          <Text style={styles.payGuideText}>支付成功后会员权益会自动刷新；若返回后状态未更新，可在最近订单中同步状态。</Text>
          <AppButton
            label={membership?.is_pro ? '创建续费/升级订单' : '创建支付订单'}
            variant="secondary"
            loading={loading}
            onPress={previewPayment}
          />
        </Card>
      ) : null}

      <Card>
        <Text style={styles.sectionTitle}>积分规则</Text>
        <RuleRow text="系统积分每天按账号会员状态发放，用于 AI 分析、纠错、运动记录和饮食建议。" />
        <RuleRow text="奖励积分来自分享、邀请、公共食物和包装食品贡献；会和系统剩余额度合并为当前可用积分。" />
        <RuleRow text="套餐到期后自动回到基础额度，奖励积分余额不受影响。" />
      </Card>
    </Page>
  )
}

export function RecipesScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  const [recipes, setRecipes] = useState<RecipeItem[]>([])
  const [mealType, setMealType] = useState<MealType>(inferDefaultMealTypeFromLocalTime())
  const [favoriteOnly, setFavoriteOnly] = useState(false)
  const [loading, setLoading] = useState(false)
  const [mealPickerRecipeId, setMealPickerRecipeId] = useState<string | null>(null)
  const [selectedMeals, setSelectedMeals] = useState<Record<string, MealType>>({})

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await apiClient.listRecipes({ isFavorite: favoriteOnly || undefined })
      setRecipes(data.recipes || [])
    } catch (error) {
      showError('获取食谱失败', error)
    } finally {
      setLoading(false)
    }
  }, [favoriteOnly])

  useEffect(() => {
    void load()
  }, [load])

  const useRecipe = async (recipe: RecipeItem, selectedMealType: MealType) => {
    setLoading(true)
    try {
      const result = await apiClient.useRecipe(recipe.id, selectedMealType)
      setMealPickerRecipeId(null)
      if (!result.record_id) {
        Alert.alert('已记录', '食谱已写入今日饮食记录', [
          { text: '回到首页', onPress: () => navigation.dispatch(CommonActions.navigate('MainTabs')) },
        ])
        return
      }
      Alert.alert('已记录', '食谱已写入今日饮食记录', [
        { text: '回到首页', onPress: () => navigation.dispatch(CommonActions.navigate('MainTabs')) },
        { text: '查看记录', onPress: () => navigation.navigate('RecordDetail', { recordId: result.record_id }) },
      ])
    } catch (error) {
      showError('使用食谱失败', error)
    } finally {
      setLoading(false)
    }
  }

  const toggleFavorite = async (recipe: RecipeItem) => {
    try {
      await apiClient.updateRecipe(recipe.id, { isFavorite: !recipe.is_favorite })
      await load()
    } catch (error) {
      showError('更新食谱失败', error)
    }
  }

  const openUseRecipe = (recipe: RecipeItem) => {
    const fallbackMeal = normalizeMealType(recipe.meal_type) || mealType
    setSelectedMeals((current) => ({ ...current, [recipe.id]: current[recipe.id] || fallbackMeal }))
    setMealPickerRecipeId((current) => current === recipe.id ? null : recipe.id)
  }

  return (
    <Page title="收藏食谱" subtitle="保存常吃组合，一键写入饮食记录" refreshing={loading} onRefresh={load}>
      <View style={styles.segment}>
        <SegmentButton label="全部" active={!favoriteOnly} onPress={() => setFavoriteOnly(false)} />
        <SegmentButton label="收藏" active={favoriteOnly} onPress={() => setFavoriteOnly(true)} />
      </View>
      <AppButton label="新建食谱" variant="secondary" onPress={() => navigation.navigate('RecipeEdit')} />

      {recipes.length === 0 ? <EmptyState text="暂无食谱" /> : null}
      {recipes.map((recipe) => (
        <Card key={recipe.id}>
          <View style={styles.recipeHeader}>
            {recipe.image_path ? <Image source={{ uri: recipe.image_path }} style={styles.recipeImage} /> : <View style={styles.recipeImageFallback}><Text style={styles.recipeImageFallbackText}>餐</Text></View>}
            <View style={styles.flex}>
              <View style={styles.rowBetween}>
                <Text style={styles.itemName}>{recipe.recipe_name}</Text>
                <Pill text={recipe.is_favorite ? '收藏' : '普通'} />
              </View>
              <Text style={styles.subtitle}>
                {getMealTypeLabel(recipe.meal_type)} · 使用 {recipe.use_count || 0} 次{recipe.last_used_at ? ` · ${formatDateTime(recipe.last_used_at)}` : ''}
              </Text>
              {recipe.description ? <Text style={styles.notes} numberOfLines={2}>{recipe.description}</Text> : null}
            </View>
          </View>
          <View style={styles.nutritionRow}>
            <Pill text={`${Math.round(recipe.total_calories || 0)} kcal`} />
            <Pill text={`蛋白 ${round1(recipe.total_protein)}g`} />
            <Pill text={`碳水 ${round1(recipe.total_carbs)}g`} />
            <Pill text={`脂肪 ${round1(recipe.total_fat)}g`} />
            {recipe.total_weight_grams ? <Pill text={`${Math.round(recipe.total_weight_grams)}g`} /> : null}
          </View>
          {recipe.tags?.length ? (
            <View style={styles.tagRow}>
              {recipe.tags.slice(0, 6).map((tag) => <Text key={tag} style={styles.tagText}>#{tag}</Text>)}
            </View>
          ) : null}
          <RecipeItemPreview items={recipe.items} />
          {mealPickerRecipeId === recipe.id ? (
            <View style={styles.inlinePicker}>
              <Text style={styles.fieldLabel}>记录为</Text>
              <MealPicker
                value={selectedMeals[recipe.id] || normalizeMealType(recipe.meal_type) || mealType}
                onChange={(value) => setSelectedMeals((current) => ({ ...current, [recipe.id]: value }))}
              />
              <View style={styles.buttonRow}>
                <SmallButton label="确认记录" onPress={() => useRecipe(recipe, selectedMeals[recipe.id] || normalizeMealType(recipe.meal_type) || mealType)} />
                <SmallButton label="取消" onPress={() => setMealPickerRecipeId(null)} />
              </View>
            </View>
          ) : null}
          <View style={styles.buttonRow}>
            <SmallButton label="记录这餐" onPress={() => openUseRecipe(recipe)} />
            <SmallButton label="编辑" onPress={() => navigation.navigate('RecipeEdit', { recipeId: recipe.id })} />
            <SmallButton label={recipe.is_favorite ? '取消收藏' : '收藏'} onPress={() => toggleFavorite(recipe)} />
          </View>
        </Card>
      ))}
    </Page>
  )
}

type PublicFoodMode = 'all' | 'campus' | 'mine' | 'collections'
type PublicFoodSort = 'latest' | 'hot' | 'rating'

export function PublicFoodScreen() {
  const route = useRoute<RouteProp<RootStackParamList, 'PublicFood'>>()
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  const initialMode: PublicFoodMode = route.params?.mode || 'all'
  const [mode, setMode] = useState<PublicFoodMode>(initialMode)
  const [items, setItems] = useState<PublicFoodItem[]>([])
  const [loading, setLoading] = useState(false)
  const [sortBy, setSortBy] = useState<PublicFoodSort>('latest')
  const [filterFatLoss, setFilterFatLoss] = useState<boolean | undefined>(undefined)
  const [searchKeyword, setSearchKeyword] = useState('')
  const [appliedMerchant, setAppliedMerchant] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      if (mode === 'mine') {
        const data = await apiClient.listMyPublicFoods()
        setItems(data.list || [])
      } else if (mode === 'collections') {
        const data = await apiClient.listCollectedPublicFoods()
        setItems(data.list || [])
      } else {
        const data = await apiClient.listPublicFoods({
          limit: 50,
          sortBy,
          merchantName: appliedMerchant || undefined,
          suitableForFatLoss: filterFatLoss,
          isCampusFood: mode === 'campus' ? true : undefined,
          type: mode === 'campus' ? 'campus' : undefined,
        })
        setItems(data.list || [])
      }
    } catch (error) {
      showError('获取公共食物失败', error)
    } finally {
      setLoading(false)
    }
  }, [appliedMerchant, filterFatLoss, mode, sortBy])

  useEffect(() => {
    void load()
  }, [load])

  const browseMode = mode === 'all' || mode === 'campus'
  const applySearch = () => {
    setAppliedMerchant(searchKeyword.trim())
  }
  const clearSearch = () => {
    setSearchKeyword('')
    setAppliedMerchant('')
  }

  return (
    <Page title="公共食物库" subtitle="外食、校园餐和用户分享" refreshing={loading} onRefresh={load}>
      <View style={styles.segment}>
        <SegmentButton compact label="全部" active={mode === 'all'} onPress={() => setMode('all')} />
        <SegmentButton compact label="校园" active={mode === 'campus'} onPress={() => setMode('campus')} />
        <SegmentButton compact label="我的" active={mode === 'mine'} onPress={() => setMode('mine')} />
        <SegmentButton compact label="收藏" active={mode === 'collections'} onPress={() => setMode('collections')} />
      </View>
      {browseMode ? (
        <Card>
          <Text style={styles.groupTitle}>筛选公共食物</Text>
          <Field
            label="搜索商家或地点"
            value={searchKeyword}
            onChangeText={setSearchKeyword}
            placeholder="输入商家、食堂或位置"
          />
          <View style={styles.buttonRow}>
            <SmallButton label="搜索" onPress={applySearch} />
            {searchKeyword || appliedMerchant ? <SmallButton label="清除" onPress={clearSearch} /> : null}
          </View>
          <Text style={styles.fieldLabel}>排序</Text>
          <View style={styles.segment}>
            <SegmentButton label="最新" active={sortBy === 'latest'} onPress={() => setSortBy('latest')} />
            <SegmentButton label="热度" active={sortBy === 'hot'} onPress={() => setSortBy('hot')} />
            <SegmentButton label="评分" active={sortBy === 'rating'} onPress={() => setSortBy('rating')} />
          </View>
          <Text style={styles.fieldLabel}>减脂筛选</Text>
          <View style={styles.segment}>
            <SegmentButton label="全部" active={filterFatLoss == null} onPress={() => setFilterFatLoss(undefined)} />
            <SegmentButton label="适合减脂" active={filterFatLoss === true} onPress={() => setFilterFatLoss(true)} />
          </View>
          {appliedMerchant || filterFatLoss ? (
            <View style={styles.nutritionRow}>
              {appliedMerchant ? <Pill text={`搜索：${appliedMerchant}`} /> : null}
              {filterFatLoss ? <Pill text="只看适合减脂" /> : null}
            </View>
          ) : null}
        </Card>
      ) : null}
      {items.length === 0 ? <EmptyState text={publicFoodEmptyText(mode, appliedMerchant, filterFatLoss)} /> : null}
      {items.map((item) => (
        <PublicFoodCard
          key={item.id}
          item={item}
          onPress={() => navigation.navigate('PublicFoodDetail', { itemId: item.id, isCampus: Boolean(item.is_campus_food) })}
        />
      ))}
    </Page>
  )
}

export function PublicFoodDetailScreen() {
  const route = useRoute<RouteProp<RootStackParamList, 'PublicFoodDetail'>>()
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  const [item, setItem] = useState<PublicFoodItem | null>(null)
  const [campusMetrics, setCampusMetrics] = useState<{ protein_per_yuan?: number; price_per_100_kcal?: number } | null>(null)
  const [similarItems, setSimilarItems] = useState<PublicFoodItem[]>([])
  const [relatedFeeds, setRelatedFeeds] = useState<CampusRelatedFeedItem[]>([])
  const [comments, setComments] = useState<PublicFoodComment[]>([])
  const [comment, setComment] = useState('')
  const [replyTarget, setReplyTarget] = useState<PublicFoodReplyTarget | null>(null)
  const [feedback, setFeedback] = useState('')
  const [loading, setLoading] = useState(false)
  const [currentUserId, setCurrentUserId] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [detailData, commentData] = await Promise.all([
        route.params.isCampus
          ? apiClient.getCampusFoodDetail(route.params.itemId)
          : apiClient.getPublicFood(route.params.itemId).then((publicItem) => ({
            item: publicItem,
            metrics: undefined,
            similar_items: [] as PublicFoodItem[],
            related_feeds: [] as CampusRelatedFeedItem[],
          })),
        apiClient.listPublicFoodComments(route.params.itemId).catch(() => ({ list: [] as PublicFoodComment[] })),
      ])
      setItem(detailData.item)
      setCampusMetrics(detailData.metrics || null)
      setSimilarItems(detailData.similar_items || [])
      setRelatedFeeds(detailData.related_feeds || [])
      setComments(commentData.list || [])
    } catch (error) {
      showError('获取食物详情失败', error)
    } finally {
      setLoading(false)
    }
  }, [route.params.itemId, route.params.isCampus])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    let mounted = true
    void getStoredUserId().then((id) => {
      if (mounted) setCurrentUserId((id || '').trim())
    })
    return () => {
      mounted = false
    }
  }, [])

  const toggleLike = async () => {
    if (!item) return
    const previous = item
    setItem({ ...item, liked: !item.liked, like_count: Math.max(0, (item.like_count || 0) + (item.liked ? -1 : 1)) })
    try {
      await apiClient.publicFoodLike(item.id, Boolean(item.liked))
    } catch (error) {
      setItem(previous)
      showError('点赞失败', error)
    }
  }

  const toggleCollect = async () => {
    if (!item) return
    const previous = item
    setItem({ ...item, collected: !item.collected, collection_count: Math.max(0, (item.collection_count || 0) + (item.collected ? -1 : 1)) })
    try {
      await apiClient.publicFoodCollect(item.id, Boolean(item.collected))
    } catch (error) {
      setItem(previous)
      showError('收藏失败', error)
    }
  }

  const addComment = async () => {
    if (!item) return
    setLoading(true)
    try {
      await apiClient.addPublicFoodComment(item.id, comment, undefined, replyTarget ? {
        parentCommentId: replyTarget.parentCommentId,
        replyToUserId: replyTarget.replyToUserId,
      } : undefined)
      setComment('')
      setReplyTarget(null)
      await load()
    } catch (error) {
      showError('评论失败', error)
    } finally {
      setLoading(false)
    }
  }

  const startReply = (parent: PublicFoodComment, target: PublicFoodComment = parent) => {
    setReplyTarget({
      parentCommentId: parent.parent_comment_id || parent.id,
      replyToUserId: target.user_id,
      nickname: target.nickname || '用户',
    })
  }

  const removeComment = async (entry: PublicFoodComment) => {
    if (!item) return
    setLoading(true)
    try {
      await apiClient.deletePublicFoodComment(item.id, entry.id)
      if (replyTarget?.parentCommentId === entry.id || replyTarget?.replyToUserId === entry.user_id) {
        setReplyTarget(null)
      }
      await load()
    } catch (error) {
      showError('删除评论失败', error)
    } finally {
      setLoading(false)
    }
  }

  const confirmRemoveComment = (entry: PublicFoodComment) => {
    Alert.alert('删除评论', '确定删除这条评论吗？', [
      { text: '取消', style: 'cancel' },
      { text: '删除', style: 'destructive', onPress: () => void removeComment(entry) },
    ])
  }

  const submitFeedback = async () => {
    if (!item) return
    setLoading(true)
    try {
      await apiClient.submitPublicFoodFeedback(item.id, feedback)
      setFeedback('')
      Alert.alert('已提交', '反馈已发送')
    } catch (error) {
      showError('反馈失败', error)
    } finally {
      setLoading(false)
    }
  }

  const remove = async () => {
    if (!item) return
    setLoading(true)
    try {
      await apiClient.deletePublicFood(item.id)
      Alert.alert('已删除', '公共食物已删除')
      navigation.goBack()
    } catch (error) {
      showError('删除失败', error)
    } finally {
      setLoading(false)
    }
  }

  const confirmRemove = () => {
    Alert.alert('删除上传', '删除后这条食物会从公共库下架，其他用户将无法继续查看。', [
      { text: '取消', style: 'cancel' },
      { text: '删除', style: 'destructive', onPress: () => void remove() },
    ])
  }

  const quickRecord = () => {
    if (!item) return
    if (isPublicFoodAnalyzing(item)) {
      Alert.alert('营养信息还在分析', '等热量和营养信息补齐后，再记录到今天这一餐。')
      return
    }
    if (isPublicFoodAnalysisFailed(item)) {
      Alert.alert('暂不能记录', '这份食物的营养分析失败了，可以先提交纠错反馈。')
      return
    }
    if (needsPublicFoodNutritionUpdate(item)) {
      Alert.alert('营养信息待补充', '这份食物还没有可记录的营养数据，可以先提交纠错反馈。')
      return
    }
    navigation.navigate('ManualRecord', {
      quickItem: manualFoodItemFromPublicFood(item),
      sourceChannel: item.is_campus_food ? 'campus' : 'recommended',
    })
  }

  const isOwner = Boolean(item && currentUserId && publicFoodOwnerId(item) === currentUserId)
  const isCampusDetail = Boolean(item?.is_campus_food || route.params.isCampus)
  const commentTotal = countPublicFoodComments(comments)
  const openPublicFood = (nextItem: PublicFoodItem) => {
    navigation.push('PublicFoodDetail', { itemId: nextItem.id, isCampus: Boolean(nextItem.is_campus_food) })
  }
  const openRelatedFeed = (feed: CampusRelatedFeedItem) => {
    navigation.navigate('CommunityFeedDetail', { targetId: feed.id, targetType: 'campus_food' })
  }
  const renderSimilarItem = (entry: PublicFoodItem) => {
    const image = primaryImage(entry)
    return (
      <Pressable key={entry.id} style={styles.relatedFoodItem} onPress={() => openPublicFood(entry)}>
        {image ? (
          <Image source={{ uri: image }} style={styles.relatedFoodImage} />
        ) : (
          <View style={styles.relatedFoodImageFallback}>
            <Text style={styles.relatedFoodImageText}>餐</Text>
          </View>
        )}
        <Text style={styles.itemName} numberOfLines={1}>{entry.food_name || '校园餐'}</Text>
        <Text style={styles.subtitle} numberOfLines={1}>{publicFoodLocationText(entry)}</Text>
        <View style={styles.nutritionRow}>
          <Pill text={`${Math.round(entry.total_calories || 0)} kcal`} />
          <Pill text={`P ${Math.round(entry.total_protein || 0)}g`} />
        </View>
      </Pressable>
    )
  }
  const renderRelatedFeed = (feed: CampusRelatedFeedItem) => {
    const image = primaryImage(feed)
    return (
      <Pressable key={feed.id} style={styles.relatedFeedRow} onPress={() => openRelatedFeed(feed)}>
        {image ? (
          <Image source={{ uri: image }} style={styles.relatedFeedImage} />
        ) : (
          <View style={styles.relatedFeedImageFallback}>
            <Text style={styles.relatedFoodImageText}>食堂</Text>
          </View>
        )}
        <View style={styles.flex}>
          <View style={styles.rowBetween}>
            <Text style={[styles.itemName, styles.relatedFeedTitle]} numberOfLines={1}>{feed.food_name || '校园餐动态'}</Text>
            <Text style={styles.kcal}>{Math.round(feed.total_calories || 0)} kcal</Text>
          </View>
          <Text style={styles.subtitle} numberOfLines={1}>{campusRelatedFeedLocationText(feed)}</Text>
          <View style={styles.nutritionRow}>
            <Pill text={`蛋白 ${Math.round(feed.total_protein || 0)}g`} />
            <Pill text={`赞 ${feed.like_count || 0}`} />
            <Pill text={`评 ${feed.comment_count || 0}`} />
          </View>
        </View>
      </Pressable>
    )
  }
  const renderComment = (entry: PublicFoodComment, parent?: PublicFoodComment) => {
    const isReply = Boolean(parent)
    const canDelete = Boolean(currentUserId && entry.user_id === currentUserId)
    const replyPrefix = parent && entry.reply_to_nickname && entry.reply_to_nickname !== parent.nickname
      ? `回复 ${entry.reply_to_nickname} · `
      : ''
    return (
      <View key={entry.id} style={[styles.commentRow, isReply && styles.commentReplyRow]}>
        <View style={styles.rowBetween}>
          <View style={styles.flex}>
            <Text style={styles.itemName}>{entry.nickname || '用户'}</Text>
            <Text style={styles.subtitle}>{replyPrefix}{formatDateTime(entry.created_at)}</Text>
          </View>
          {entry.rating ? <Pill text={`${entry.rating} 分`} /> : null}
        </View>
        <Text style={styles.notes}>{entry.content}</Text>
        <View style={styles.commentActions}>
          <SmallButton label="回复" onPress={() => startReply(parent || entry, entry)} />
          {canDelete ? <SmallButton label="删除" danger onPress={() => confirmRemoveComment(entry)} /> : null}
        </View>
        {!isReply && entry.replies?.length ? (
          <View style={styles.commentReplies}>
            {entry.replies.map((reply) => renderComment(reply, entry))}
          </View>
        ) : null}
      </View>
    )
  }

  return (
    <Page title="食物详情" subtitle={item?.merchant_name || item?.canteen_name} refreshing={loading} onRefresh={load}>
      <Card>
        {primaryImage(item) ? <Image source={{ uri: primaryImage(item) }} style={styles.heroImage} /> : null}
        <Text style={styles.bigTitle}>{item?.food_name || '公共食物'}</Text>
        <Text style={styles.subtitle}>{item?.description || item?.campus_location_text || '暂无描述'}</Text>
        <View style={styles.nutritionRow}>
          <Pill text={`${Math.round(item?.total_calories || 0)} kcal`} />
          <Pill text={`P ${Math.round(item?.total_protein || 0)}g`} />
          <Pill text={`C ${Math.round(item?.total_carbs || 0)}g`} />
          <Pill text={`F ${Math.round(item?.total_fat || 0)}g`} />
        </View>
        <View style={styles.metaBlock}>
          <InfoRow label="类型" value={item?.is_campus_food ? '校园餐' : item?.type || '公共食物'} />
          <InfoRow label="地点" value={publicFoodLocationText(item)} />
          <InfoRow label="份量" value={item?.portion_description || '--'} />
          <InfoRow label="价格" value={item?.price != null ? `${money(item.price)} / ${item.price_unit || '份'}` : '--'} />
          {isCampusDetail && campusMetrics?.protein_per_yuan ? <InfoRow label="蛋白性价比" value={`${round1(campusMetrics.protein_per_yuan)}g/元`} /> : null}
          {isCampusDetail && campusMetrics?.price_per_100_kcal ? <InfoRow label="热量价格" value={`${round1(campusMetrics.price_per_100_kcal)}元/100kcal`} /> : null}
          <InfoRow label="口味评分" value={item?.taste_rating != null ? `${item.taste_rating}/5` : '--'} />
          <InfoRow label="减脂选择" value={item?.suitable_for_fat_loss ? '适合' : '普通'} />
        </View>
        {item?.user_tags?.length ? (
          <View style={styles.nutritionRow}>
            {item.user_tags.map((tag) => <Pill key={tag} text={tag} />)}
          </View>
        ) : null}
        {item?.user_notes ? <Text style={styles.notes}>{item.user_notes}</Text> : null}
        <View style={styles.buttonRow}>
          <SmallButton label={item?.is_campus_food ? '记录这份校园餐' : '记录这份食物'} onPress={quickRecord} />
          <SmallButton label={`${item?.liked ? '已赞' : '点赞'} ${item?.like_count || 0}`} onPress={toggleLike} />
          <SmallButton label={item?.collected ? '已收藏' : '收藏'} onPress={toggleCollect} />
          {item && isOwner ? <SmallButton label="编辑" onPress={() => navigation.navigate('PublicFoodShare', { editId: item.id, mode: item.is_campus_food ? 'campus' : 'public' })} /> : null}
          {item && isOwner ? <SmallButton label="删除" danger onPress={confirmRemove} /> : null}
        </View>
      </Card>

      {isCampusDetail && similarItems.length > 0 ? (
        <Card>
          <Text style={styles.sectionTitle}>同食堂相似菜品</Text>
          <Text style={styles.subtitle}>同学校同食堂优先推荐</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.relatedFoodScroll}
          >
            {similarItems.map(renderSimilarItem)}
          </ScrollView>
        </Card>
      ) : null}

      {isCampusDetail && relatedFeeds.length > 0 ? (
        <Card>
          <Text style={styles.sectionTitle}>圈子相关动态</Text>
          <Text style={styles.subtitle}>来自同食堂精选动态</Text>
          <View style={styles.relatedFeedList}>
            {relatedFeeds.map(renderRelatedFeed)}
          </View>
        </Card>
      ) : null}

      <Card>
        <Text style={styles.sectionTitle}>评论{commentTotal ? ` ${commentTotal}` : ''}</Text>
        {replyTarget ? (
          <View style={styles.replyTargetBar}>
            <Text style={styles.subtitle}>正在回复 {replyTarget.nickname}</Text>
            <SmallButton label="取消回复" onPress={() => setReplyTarget(null)} />
          </View>
        ) : null}
        <Field label={replyTarget ? `回复 ${replyTarget.nickname}` : '写评论'} value={comment} onChangeText={setComment} multiline />
        <AppButton label={replyTarget ? '发布回复' : '发布评论'} variant="secondary" loading={loading} onPress={addComment} />
        {comments.length === 0 ? <Text style={styles.subtitle}>暂无评论</Text> : null}
        {comments.map((entry) => renderComment(entry))}
      </Card>

      <Card>
        <Text style={styles.sectionTitle}>纠错反馈</Text>
        <Field label="反馈内容" value={feedback} onChangeText={setFeedback} multiline />
        <AppButton label="提交纠错" variant="ghost" loading={loading} onPress={submitFeedback} />
      </Card>
    </Page>
  )
}

export function CommunityFeedDetailScreen() {
  const route = useRoute<RouteProp<RootStackParamList, 'CommunityFeedDetail'>>()
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  const [context, setContext] = useState<CommunityFeedContext | null>(null)
  const [comment, setComment] = useState('')
  const [reportText, setReportText] = useState('')
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await apiClient.communityGetContext(route.params.targetId, route.params.targetType)
      setContext(data.item)
    } catch (error) {
      showError('获取动态详情失败', error)
    } finally {
      setLoading(false)
    }
  }, [route.params.targetId, route.params.targetType])

  useEffect(() => {
    void load()
  }, [load])

  const record = context?.record
  const author = context?.author
  const isCirclePost = route.params.targetType === 'circle_post'
  const isMine = Boolean(isCirclePost && context?.is_mine)
  const recordTitle = String(record?.title || record?.description || record?.items?.[0]?.name || '分享动态')
  const recordBody = String(record?.body || '').trim()

  const addComment = async () => {
    setLoading(true)
    try {
      await apiClient.communityAddComment({
        targetId: route.params.targetId,
        targetType: route.params.targetType,
        content: comment,
      })
      setComment('')
      await load()
    } catch (error) {
      showError('评论失败', error)
    } finally {
      setLoading(false)
    }
  }

  const editPost = () => {
    navigation.navigate('CirclePostEdit', { postId: route.params.targetId })
  }

  const deletePost = () => {
    Alert.alert('删除动态', '删除后这条动态和相关互动将不再显示。', [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: async () => {
          setLoading(true)
          try {
            await apiClient.deleteCirclePost(route.params.targetId)
            Alert.alert('已删除', '动态已删除')
            navigation.goBack()
          } catch (error) {
            showError('删除失败', error)
          } finally {
            setLoading(false)
          }
        },
      },
    ])
  }

  const report = async () => {
    setLoading(true)
    try {
      await apiClient.communityReport({
        targetId: route.params.targetId,
        targetType: route.params.targetType,
        reason: 'other',
        extraContent: reportText,
      })
      setReportText('')
      Alert.alert('已举报', '举报已提交给管理员。')
    } catch (error) {
      showError('举报失败', error)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Page title="动态详情" subtitle={author?.nickname || ''} refreshing={loading} onRefresh={load}>
      <Card>
        <Pressable onPress={() => author?.id ? navigation.navigate('ProfileSettings', { userId: author.id }) : undefined}>
          <Text style={styles.itemName}>{author?.nickname || '用户'}</Text>
          <Text style={styles.subtitle}>{formatDateTime(record?.record_time || record?.created_at)}</Text>
        </Pressable>
        <Text style={styles.bigTitle}>{recordTitle}</Text>
        {recordBody && recordBody !== recordTitle ? <Text style={styles.notes}>{recordBody}</Text> : null}
        <View style={styles.nutritionRow}>
          <Pill text={`${Math.round(record?.total_calories || 0)} kcal`} />
          <Pill text={`P ${round1(record?.total_protein)}g`} />
          <Pill text={`C ${round1(record?.total_carbs)}g`} />
          <Pill text={`F ${round1(record?.total_fat)}g`} />
          {record?.fiber ? <Pill text={`纤维 ${round1(record.fiber)}g`} /> : null}
          {record?.sugar ? <Pill text={`糖 ${round1(record.sugar)}g`} /> : null}
          {record?.sodium_mg ? <Pill text={`钠 ${Math.round(record.sodium_mg)}mg`} /> : null}
          <Pill text={`赞 ${context?.like_count || 0}`} />
          <Pill text={`评 ${context?.comment_count || 0}`} />
        </View>
        {isMine ? (
          <View style={styles.buttonRow}>
            <SmallButton label="编辑动态" onPress={editPost} />
            <SmallButton label="删除" danger onPress={deletePost} />
          </View>
        ) : null}
      </Card>

      <Card>
        <Text style={styles.sectionTitle}>评论</Text>
        <Field label="写评论" value={comment} onChangeText={setComment} multiline />
        <AppButton label="发布评论" variant="secondary" loading={loading} onPress={addComment} />
        {(context?.comments || []).map((entry) => (
          <CommentLine key={entry.id} entry={entry} />
        ))}
      </Card>

      {!isMine ? (
        <Card>
          <Text style={styles.sectionTitle}>举报</Text>
          <Field label="说明" value={reportText} onChangeText={setReportText} multiline placeholder="说明违规或不适内容" />
          <AppButton label="提交举报" variant="ghost" loading={loading} onPress={report} />
        </Card>
      ) : null}
    </Page>
  )
}

export function PublicProfileScreen() {
  const route = useRoute<RouteProp<RootStackParamList, 'PublicProfile'>>()
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  const [profile, setProfile] = useState<PublicProfile | null>(null)
  const [recipes, setRecipes] = useState<RecipeItem[]>([])
  const [collections, setCollections] = useState<PublicFoodItem[]>([])
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [profileData, recipeData, collectionData] = await Promise.all([
        apiClient.getPublicProfile(route.params.userId),
        apiClient.getUserFavoriteRecipes(route.params.userId).catch(() => ({ recipes: [] as RecipeItem[] })),
        apiClient.getUserPublicFoodCollections(route.params.userId).catch(() => ({ list: [] as PublicFoodItem[] })),
      ])
      setProfile(profileData)
      setRecipes(recipeData.recipes || [])
      setCollections(collectionData.list || [])
    } catch (error) {
      showError('获取主页失败', error)
    } finally {
      setLoading(false)
    }
  }, [route.params.userId])

  useEffect(() => {
    void load()
  }, [load])

  const follow = async () => {
    if (!profile) return
    const previous = profile
    setProfile({ ...profile, is_following: !profile.is_following })
    try {
      await apiClient.followUser(profile.id, Boolean(profile.is_following))
      await load()
    } catch (error) {
      setProfile(previous)
      showError('关注失败', error)
    }
  }

  return (
    <Page title="用户主页" subtitle={profile?.motto || ''} refreshing={loading} onRefresh={load}>
      <Card>
        <View style={styles.profileRow}>
          {profile?.avatar ? <Image source={{ uri: profile.avatar }} style={styles.avatar} /> : <View style={styles.avatarFallback} />}
          <View style={styles.flex}>
            <Text style={styles.bigTitle}>{profile?.nickname || '用户'}</Text>
            <Text style={styles.subtitle}>记录 {profile?.record_days || 0} 天 · 关注者 {profile?.followers_count || 0}</Text>
          </View>
        </View>
        <View style={styles.buttonRow}>
          <SmallButton label={profile?.is_following ? '取消关注' : '关注'} onPress={follow} />
          <SmallButton label="资料页" onPress={() => navigation.navigate('ProfileSettings', { userId: route.params.userId })} />
          <SmallButton label="私信" onPress={() => navigation.navigate('PrivateChat', { userId: route.params.userId, nickname: profile?.nickname })} />
        </View>
      </Card>

      {recipes.length ? <Text style={styles.groupTitle}>收藏食谱</Text> : null}
      {recipes.slice(0, 5).map((recipe) => (
        <Card key={recipe.id}>
          <Text style={styles.itemName}>{recipe.recipe_name}</Text>
          <Text style={styles.subtitle}>{Math.round(recipe.total_calories || 0)} kcal</Text>
        </Card>
      ))}

      {collections.length ? <Text style={styles.groupTitle}>收藏食物</Text> : null}
      {collections.slice(0, 5).map((item) => (
        <PublicFoodCard key={item.id} item={item} onPress={() => navigation.navigate('PublicFoodDetail', { itemId: item.id, isCampus: Boolean(item.is_campus_food) })} />
      ))}
    </Page>
  )
}

export function ConversationsScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  const [conversations, setConversations] = useState<ConversationSummary[]>([])
  const [unread, setUnread] = useState(0)
  const [currentUserId, setCurrentUserId] = useState('')
  const [offset, setOffset] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)

  const loadLatest = useCallback(async () => {
    setLoading(true)
    try {
      const [conversationData, unreadData] = await Promise.all([
        apiClient.listConversations({ limit: privateConversationPageSize, offset: 0 }),
        apiClient.getUnreadPrivateMessageCount().catch(() => ({ count: 0 })),
      ])
      const next = conversationData.list || []
      setConversations(next)
      setOffset(next.length)
      setHasMore(Boolean(conversationData.has_more))
      setUnread(unreadData.count || 0)
    } catch (error) {
      showError('获取私信失败', error)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void getStoredUserId().then((id) => setCurrentUserId(id || ''))
  }, [])

  useFocusEffect(
    useCallback(() => {
      void loadLatest()
    }, [loadLatest]),
  )

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore) return
    setLoadingMore(true)
    try {
      const data = await apiClient.listConversations({ limit: privateConversationPageSize, offset })
      const next = data.list || []
      setConversations((prev) => mergeConversations(prev, next))
      setOffset((prev) => prev + next.length)
      setHasMore(Boolean(data.has_more))
    } catch (error) {
      showError('加载更多私信失败', error)
    } finally {
      setLoadingMore(false)
    }
  }, [hasMore, loadingMore, offset])

  return (
    <Page title="私信" subtitle={unread ? `${unread} 条未读` : `${conversations.length} 个会话`} refreshing={loading} onRefresh={loadLatest}>
      {conversations.length === 0 ? <EmptyState text="暂无私信会话" /> : null}
      {conversations.map((conversation, index) => (
        <ConversationRow
          key={conversationUserId(conversation) || index}
          conversation={conversation}
          currentUserId={currentUserId}
          onPress={() => {
            const userId = conversationUserId(conversation)
            if (!userId) return
            navigation.navigate('PrivateChat', {
              userId,
              nickname: conversationNickname(conversation),
            })
          }}
        />
      ))}
      {hasMore ? <AppButton label="查看更多会话" variant="secondary" loading={loadingMore} onPress={loadMore} /> : null}
    </Page>
  )
}

export function PrivateChatScreen() {
  const route = useRoute<RouteProp<RootStackParamList, 'PrivateChat'>>()
  const [messages, setMessages] = useState<PrivateMessageItem[]>([])
  const [content, setContent] = useState('')
  const [currentUserId, setCurrentUserId] = useState('')
  const [counterpartName, setCounterpartName] = useState(route.params.nickname || '用户')
  const [counterpartAvatar, setCounterpartAvatar] = useState('')
  const [offset, setOffset] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [sendingText, setSendingText] = useState(false)
  const [sendingImage, setSendingImage] = useState(false)
  const [actionTarget, setActionTarget] = useState<PrivateMessageItem | null>(null)
  const pollingRef = useRef(false)
  const isSystemChat = route.params.userId === SYSTEM_MESSAGE_USER_ID

  const loadLatest = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true)
    try {
      const data = await apiClient.getConversation(route.params.userId, 0, privateMessagePageSize)
      const next = normalizePrivateMessages(data.list || [])
      setMessages((prev) => quiet ? mergePrivateMessages(prev, next) : next)
      if (!quiet) {
        setOffset((data.list || []).length)
        setHasMore(Boolean(data.has_more))
      }
      await apiClient.markConversationRead(route.params.userId).catch(() => null)
    } catch (error) {
      if (!quiet) showError('获取会话失败', error)
    } finally {
      if (!quiet) setLoading(false)
    }
  }, [route.params.userId])

  useEffect(() => {
    void getStoredUserId().then((id) => setCurrentUserId(id || ''))
  }, [])

  useEffect(() => {
    setCounterpartName(route.params.nickname || (isSystemChat ? '系统消息' : '用户'))
    setCounterpartAvatar('')
    if (isSystemChat) return
    void apiClient.getPublicProfile(route.params.userId)
      .then((profile) => {
        setCounterpartName(profile.nickname || route.params.nickname || '用户')
        setCounterpartAvatar(profile.avatar || '')
      })
      .catch(() => null)
  }, [isSystemChat, route.params.nickname, route.params.userId])

  useFocusEffect(
    useCallback(() => {
      void loadLatest(false)
      const timer = setInterval(() => {
        if (pollingRef.current) return
        pollingRef.current = true
        void loadLatest(true).finally(() => {
          pollingRef.current = false
        })
      }, privateMessagePollMs)
      return () => clearInterval(timer)
    }, [loadLatest]),
  )

  const loadOlder = useCallback(async () => {
    if (loadingMore || !hasMore) return
    setLoadingMore(true)
    try {
      const data = await apiClient.getConversation(route.params.userId, offset, privateMessagePageSize)
      const older = normalizePrivateMessages(data.list || [])
      setMessages((prev) => mergePrivateMessages(older, prev))
      setOffset((prev) => prev + (data.list || []).length)
      setHasMore(Boolean(data.has_more))
    } catch (error) {
      showError('加载历史消息失败', error)
    } finally {
      setLoadingMore(false)
    }
  }, [hasMore, loadingMore, offset, route.params.userId])

  const send = async () => {
    const text = content.trim()
    if (!text) {
      Alert.alert('请输入消息内容')
      return
    }
    setSendingText(true)
    try {
      const sent = await apiClient.sendPrivateMessage(route.params.userId, text)
      setContent('')
      setMessages((prev) => mergePrivateMessages(prev, [sent]))
      await loadLatest(true)
    } catch (error) {
      showError('发送失败', error)
    } finally {
      setSendingText(false)
    }
  }

  const sendImage = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (!permission.granted) {
      Alert.alert('需要相册权限', '请选择图片后发送给对方。')
      return
    }
    setSendingImage(true)
    try {
      const picked = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: false,
        quality: 0.85,
      })
      if (picked.canceled || !picked.assets[0]) return
      const asset = picked.assets[0]
      const uploaded = await apiClient.uploadAnalyzeImageFile({
        fileUri: asset.uri,
        fileName: asset.fileName || 'private-message.jpg',
        mimeType: asset.mimeType || 'image/jpeg',
      })
      await apiClient.sendPrivateMessage(route.params.userId, {
        contentType: 'image',
        imageUrl: uploaded.imageUrl,
      })
      await loadLatest(true)
    } catch (error) {
      showError('发送图片失败', error)
    } finally {
      setSendingImage(false)
    }
  }

  const closeMessageActions = useCallback(() => {
    setActionTarget(null)
  }, [])

  const copyMessage = useCallback(async (message: PrivateMessageItem) => {
    const type = messageType(message)
    const value = type === 'image' ? messageImageUrl(message) : messageContent(message)
    if (!value.trim()) {
      Alert.alert('无法复制', type === 'image' ? '这张图片没有可复制的链接。' : '这条消息没有可复制的内容。')
      return
    }
    await Clipboard.setStringAsync(value)
    closeMessageActions()
    Alert.alert(type === 'image' ? '图片链接已复制' : '消息已复制')
  }, [closeMessageActions])

  const deleteMessage = useCallback((message: PrivateMessageItem) => {
    const id = messageRecordId(message)
    if (!id) {
      Alert.alert('暂不能删除', '这条消息缺少可删除的 ID，请刷新后重试。')
      return
    }
    closeMessageActions()
    Alert.alert('删除消息', '删除后双方都不会再看到这条消息。', [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: () => {
          void apiClient.deletePrivateMessage(id)
            .then(() => {
              setMessages((prev) => prev.filter((item) => messageRecordId(item) !== id))
              return loadLatest(true)
            })
            .catch((error) => showError('删除消息失败', error))
        },
      },
    ])
  }, [closeMessageActions, loadLatest])

  const reportMessage = useCallback((message: PrivateMessageItem) => {
    const id = messageRecordId(message)
    if (!id) {
      Alert.alert('暂不能举报', '这条消息缺少可举报的 ID，请刷新后重试。')
      return
    }
    closeMessageActions()
    Alert.alert('举报消息', '举报会提交给管理员处理。', [
      { text: '取消', style: 'cancel' },
      {
        text: '举报',
        style: 'destructive',
        onPress: () => {
          void apiClient.reportPrivateMessage(id, {
            reason: 'other',
            extraContent: '来自私信长按举报',
          })
            .then(() => Alert.alert('举报已提交'))
            .catch((error) => showError('举报失败', error))
        },
      },
    ])
  }, [closeMessageActions])

  const actionTargetIsSelf = actionTarget ? isSelfPrivateMessage(actionTarget, currentUserId) : false

  return (
    <Page title={isSystemChat ? '系统消息' : counterpartName || '私信'} subtitle={isSystemChat ? '平台通知和处理结果' : '好友和关注用户的点对点消息'} refreshing={loading} onRefresh={() => loadLatest(false)}>
      {messages.length === 0 ? <EmptyState text='暂无消息' /> : null}
      {hasMore ? <AppButton label='查看更早消息' variant='secondary' loading={loadingMore} onPress={loadOlder} /> : null}
      {messages.map((msg, index) => {
        const previous = index > 0 ? messages[index - 1] : null
        return (
          <MessageBubble
            key={messageId(msg, index)}
            message={msg}
            currentUserId={currentUserId}
            counterpartName={counterpartName || '用户'}
            counterpartAvatar={counterpartAvatar}
            showTime={shouldShowMessageTime(previous, msg)}
            onLongPress={(message) => setActionTarget(message)}
          />
        )
      })}
      {isSystemChat ? null : (
        <Card style={styles.chatComposerCard}>
          <TextInput
            value={content}
            onChangeText={setContent}
            placeholder='说点什么...'
            placeholderTextColor={colors.textMuted}
            multiline
            textAlignVertical='top'
            style={styles.chatInput}
          />
          <View style={styles.buttonRow}>
            <SmallButton label='发图片' disabled={sendingImage || sendingText} onPress={sendImage} />
            <SmallButton label='发送' disabled={sendingImage || sendingText || !content.trim()} onPress={send} />
            {sendingImage || sendingText ? <ActivityIndicator color={colors.brand} /> : null}
          </View>
        </Card>
      )}
      <PrivateMessageActionSheet
        visible={Boolean(actionTarget)}
        message={actionTarget}
        isSelf={actionTargetIsSelf}
        onCopy={copyMessage}
        onDelete={deleteMessage}
        onReport={reportMessage}
        onClose={closeMessageActions}
      />
    </Page>
  )
}
export function BodyTrendsScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  const [summary, setSummary] = useState<StatsSummary | null>(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setSummary(await apiClient.getStatsSummary('month'))
    } catch (error) {
      showError('获取身体趋势失败', error)
    } finally {
      setLoading(false)
    }
  }, [])

  useFocusEffect(useCallback(() => {
    void load()
  }, [load]))

  const body = summary?.body_metrics
  const latestWeight = body?.latest_weight?.value
  const weightChange = body?.weight_change

  return (
    <Page title="身体趋势" subtitle="体重、饮水、运动和月度摄入趋势" refreshing={loading} onRefresh={load}>
      <Card>
        <Text style={styles.sectionTitle}>体重</Text>
        <Text style={styles.bigNumber}>{latestWeight ? `${latestWeight} kg` : '--'}</Text>
        <Text style={styles.subtitle}>月变化 {weightChange == null ? '--' : `${weightChange > 0 ? '+' : ''}${weightChange.toFixed(1)} kg`}</Text>
        <View style={styles.buttonRow}>
          <SmallButton label="查看体重趋势" onPress={() => navigation.navigate('TrendDetail', { kind: 'weight' })} />
        </View>
      </Card>
      <Card>
        <Text style={styles.sectionTitle}>饮水</Text>
        <Text style={styles.bigNumber}>{Math.round(body?.avg_daily_water_ml || 0)} ml</Text>
        <Text style={styles.subtitle}>日均饮水 · 记录 {body?.water_recorded_days || 0} 天</Text>
        <View style={styles.buttonRow}>
          <SmallButton label="查看喝水趋势" onPress={() => navigation.navigate('TrendDetail', { kind: 'water' })} />
        </View>
      </Card>
      <Card>
        <Text style={styles.sectionTitle}>运动</Text>
        <Text style={styles.bigNumber}>30 天</Text>
        <Text style={styles.subtitle}>查看运动消耗热力和最近记录</Text>
        <View style={styles.buttonRow}>
          <SmallButton label="查看运动趋势" onPress={() => navigation.navigate('TrendDetail', { kind: 'exercise' })} />
        </View>
      </Card>
      <Card>
        <Text style={styles.sectionTitle}>摄入趋势</Text>
        <Text style={styles.bigNumber}>{Math.round(summary?.avg_calories_per_day || 0)} kcal</Text>
        <Text style={styles.subtitle}>日均摄入 · 连续记录 {summary?.streak_days || 0} 天</Text>
        <MacroRow label="蛋白质" value={summary?.total_protein} target={summary?.total_calories ? summary.total_calories * 0.18 / 4 : 0} />
        <MacroRow label="碳水" value={summary?.total_carbs} target={summary?.total_calories ? summary.total_calories * 0.5 / 4 : 0} />
        <MacroRow label="脂肪" value={summary?.total_fat} target={summary?.total_calories ? summary.total_calories * 0.3 / 9 : 0} />
      </Card>
    </Page>
  )
}

function PublicFoodCard({ item, onPress }: { item: PublicFoodItem; onPress: () => void }) {
  return (
    <Pressable onPress={onPress}>
      <Card>
        <View style={styles.rowBetween}>
          <View style={styles.flex}>
            <Text style={styles.itemName}>{item.food_name || '公共食物'}</Text>
            <Text style={styles.subtitle}>{item.canteen_name || item.merchant_name || item.campus_location_text || item.city || '用户分享'}</Text>
          </View>
          <Text style={styles.kcal}>{Math.round(item.total_calories || 0)} kcal</Text>
        </View>
        <View style={styles.nutritionRow}>
          {item.is_campus_food ? <Pill text="校园餐" /> : null}
          {item.suitable_for_fat_loss ? <Pill text="适合减脂" /> : null}
          <Pill text={`评 ${item.comment_count || 0}`} />
          <Pill text={`赞 ${item.like_count || 0}`} />
          <Pill text={`藏 ${item.collection_count || 0}`} />
        </View>
      </Card>
    </Pressable>
  )
}

function ConversationRow({
  conversation,
  currentUserId,
  onPress,
}: {
  conversation: ConversationSummary
  currentUserId: string
  onPress: () => void
}) {
  const userId = conversationUserId(conversation)
  const nickname = conversationNickname(conversation)
  const avatar = conversationAvatar(conversation)
  const unreadCount = conversationUnreadCount(conversation)
  const last = conversationLastMessage(conversation)
  const isSystem = userId === SYSTEM_MESSAGE_USER_ID
  return (
    <Pressable onPress={onPress}>
      <Card style={[styles.conversationCard, unreadCount > 0 && styles.conversationCardUnread]}>
        <View style={styles.conversationRow}>
          <ConversationAvatar nickname={isSystem ? '系' : nickname} avatar={avatar} system={isSystem} />
          <View style={styles.flex}>
            <View style={styles.rowBetween}>
              <Text style={styles.conversationName} numberOfLines={1}>{isSystem ? '系统消息' : nickname}</Text>
              <Text style={styles.conversationTime}>{formatPrivateMessageTime(messageCreatedAt(last))}</Text>
            </View>
            <Text style={[styles.conversationPreview, unreadCount > 0 && styles.conversationPreviewUnread]} numberOfLines={1}>
              {conversationPreview(conversation, currentUserId) || '打开会话'}
            </Text>
          </View>
          {unreadCount > 0 ? (
            <View style={styles.conversationBadge}>
              <Text style={styles.conversationBadgeText}>{unreadCount > 99 ? '99+' : unreadCount}</Text>
            </View>
          ) : null}
        </View>
      </Card>
    </Pressable>
  )
}

function ConversationAvatar({ nickname, avatar, system }: { nickname: string; avatar?: string; system?: boolean }) {
  if (avatar) return <Image source={{ uri: avatar }} style={styles.conversationAvatarImage} />
  const initial = system ? '系' : nickname.trim().slice(0, 1) || '友'
  return (
    <View style={[styles.conversationAvatarFallback, system && styles.conversationAvatarSystem]}>
      <Text style={styles.conversationAvatarText}>{initial}</Text>
    </View>
  )
}

function publicFoodEmptyText(mode: PublicFoodMode, merchantName: string, fatLoss?: boolean): string {
  if (mode === 'mine') return '还没有上传过公共食物'
  if (mode === 'collections') return '还没有收藏公共食物'
  if (merchantName || fatLoss) return mode === 'campus' ? '没有找到匹配的校园餐' : '没有找到匹配的公共食物'
  return mode === 'campus' ? '暂无校园餐' : '暂无公共食物'
}

function CommentLine({ entry }: { entry: FeedCommentItem }) {
  return (
    <View style={styles.commentRow}>
      <Text style={styles.itemName}>{entry.nickname || '用户'}</Text>
      <Text style={styles.subtitle}>{entry.content}</Text>
    </View>
  )
}

function MessageBubble({
  message,
  currentUserId,
  counterpartName,
  counterpartAvatar,
  showTime,
  onLongPress,
}: {
  message: PrivateMessageItem
  currentUserId: string
  counterpartName: string
  counterpartAvatar?: string
  showTime?: boolean
  onLongPress?: (message: PrivateMessageItem) => void
}) {
  const type = messageType(message)
  const isSystem = type === 'system' || messageSenderId(message) === SYSTEM_MESSAGE_USER_ID
  const isSelf = isSelfPrivateMessage(message, currentUserId)
  const imageUrl = messageImageUrl(message)
  const content = messageContent(message)

  if (isSystem) {
    return (
      <View style={styles.systemMessageWrap}>
        {showTime ? <MessageTimeDivider value={messageCreatedAt(message)} /> : null}
        <View style={styles.systemMessageBubble}>
          <Text style={styles.systemMessageText}>{content || '系统通知'}</Text>
        </View>
      </View>
    )
  }

  return (
    <>
      {showTime ? <MessageTimeDivider value={messageCreatedAt(message)} /> : null}
      <View style={[styles.messageRow, isSelf && styles.messageRowSelf]}>
        {!isSelf ? <ConversationAvatar nickname={counterpartName} avatar={counterpartAvatar} /> : null}
        <Pressable
          delayLongPress={260}
          onLongPress={() => onLongPress?.(message)}
          style={({ pressed }) => [
            styles.messageBubble,
            isSelf && styles.messageBubbleSelf,
            type === 'image' && styles.messageBubbleImage,
            pressed && styles.messageBubblePressed,
          ]}
        >
          <Text style={[styles.messageSender, isSelf && styles.messageSenderSelf]}>{isSelf ? '我' : counterpartName}</Text>
          {type === 'image' && imageUrl ? (
            <Image source={{ uri: imageUrl }} style={styles.messageImage} resizeMode='cover' />
          ) : (
            <Text style={[styles.messageText, isSelf && styles.messageTextSelf]}>{content || '消息'}</Text>
          )}
        </Pressable>
      </View>
    </>
  )
}

function PrivateMessageActionSheet({
  visible,
  message,
  isSelf,
  onCopy,
  onDelete,
  onReport,
  onClose,
}: {
  visible: boolean
  message: PrivateMessageItem | null
  isSelf: boolean
  onCopy: (message: PrivateMessageItem) => void
  onDelete: (message: PrivateMessageItem) => void
  onReport: (message: PrivateMessageItem) => void
  onClose: () => void
}) {
  if (!message) return null
  return (
    <Modal visible={visible} transparent animationType='fade' onRequestClose={onClose}>
      <Pressable style={styles.messageActionBackdrop} onPress={onClose}>
        <Pressable style={styles.messageActionSheet} onPress={() => undefined}>
          <View style={styles.messageActionHandle} />
          <PrivateMessageAction label='复制' onPress={() => onCopy(message)} />
          {isSelf ? (
            <PrivateMessageAction label='删除' danger onPress={() => onDelete(message)} />
          ) : (
            <PrivateMessageAction label='举报' danger onPress={() => onReport(message)} />
          )}
          <View style={styles.messageActionSeparator} />
          <PrivateMessageAction label='取消' onPress={onClose} />
        </Pressable>
      </Pressable>
    </Modal>
  )
}

function PrivateMessageAction({ label, danger, onPress }: { label: string; danger?: boolean; onPress: () => void }) {
  return (
    <Pressable style={({ pressed }) => [styles.messageActionItem, pressed && styles.messageActionPressed]} onPress={onPress}>
      <Text style={[styles.messageActionText, danger && styles.messageActionDangerText]}>{label}</Text>
    </Pressable>
  )
}

function MessageTimeDivider({ value }: { value?: string }) {
  const label = formatPrivateMessageTime(value)
  if (!label) return null
  return (
    <View style={styles.messageTimeDivider}>
      <Text style={styles.messageTimeDividerText}>{label}</Text>
    </View>
  )
}

function Field({
  label,
  value,
  onChangeText,
  placeholder,
  keyboardType,
  multiline,
}: {
  label: string
  value: string
  onChangeText: (value: string) => void
  placeholder?: string
  keyboardType?: 'default' | 'decimal-pad' | 'number-pad'
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
        keyboardType={keyboardType}
        multiline={multiline}
        textAlignVertical={multiline ? 'top' : 'center'}
        style={[styles.input, multiline && styles.textarea]}
      />
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

function SegmentButton({
  label,
  active,
  onPress,
  compact,
}: {
  label: string
  active: boolean
  onPress: () => void
  compact?: boolean
}) {
  return (
    <Pressable style={[styles.segmentItem, compact && styles.segmentItemCompact, active && styles.segmentItemActive]} onPress={onPress}>
      <Text style={[styles.segmentText, active && styles.segmentTextActive]}>{label}</Text>
    </Pressable>
  )
}

function SmallButton({ label, danger, disabled, onPress }: { label: string; danger?: boolean; disabled?: boolean; onPress: () => void }) {
  return (
    <Pressable disabled={disabled} onPress={onPress} style={[styles.smallButton, danger && styles.smallButtonDanger, disabled && styles.smallButtonDisabled]}>
      <Text style={[styles.smallButtonText, danger && styles.smallButtonDangerText, disabled && styles.smallButtonDisabledText]}>{label}</Text>
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

function RecipeItemPreview({ items }: { items?: Array<Record<string, unknown>> }) {
  const normalized = (items || []).slice(0, 4).map((item, index) => {
    const nutrients = asRecord(item.nutrients)
    return {
      key: String(item.id || item.name || item.food_name || index),
      name: String(item.name || item.food_name || `食物 ${index + 1}`),
      weight: firstNumber(item.weight, item.estimatedWeightGrams, item.estimated_weight_grams, item.intake),
      calories: firstNumber(nutrients?.calories, item.calories, item.total_calories),
      protein: firstNumber(nutrients?.protein, item.protein, item.total_protein),
      carbs: firstNumber(nutrients?.carbs, item.carbs, item.total_carbs),
      fat: firstNumber(nutrients?.fat, item.fat, item.total_fat),
    }
  })
  if (!normalized.length) return null
  return (
    <View style={styles.recipeItems}>
      {normalized.map((item) => (
        <View key={item.key} style={styles.recipeItemRow}>
          <View style={styles.flex}>
            <Text style={styles.recipeItemName}>{item.name}</Text>
            <Text style={styles.subtitle}>
              {item.weight ? `${Math.round(item.weight)}g · ` : ''}{Math.round(item.calories || 0)} kcal
            </Text>
          </View>
          <Text style={styles.recipeItemMacro}>P {round1(item.protein)} · C {round1(item.carbs)} · F {round1(item.fat)}</Text>
        </View>
      ))}
    </View>
  )
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  )
}

function InfoTile({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.infoTile}>
      <Text style={styles.infoTileValue}>{value}</Text>
      <Text style={styles.infoTileLabel}>{label}</Text>
    </View>
  )
}

function UpgradeTermsBlock({ order }: { order: MembershipPaymentOrder }) {
  const terms = asRecord(order.upgrade_terms)
  if (!terms) return null
  const rows = [
    { label: '当前套餐抵扣', value: terms.unused_current_credit_applied != null ? `¥${money(terms.unused_current_credit_applied)}` : '' },
    { label: '目标周期开始', value: dateText(terms.target_period_start, true) },
    { label: '目标周期结束', value: dateText(terms.target_expires_at) },
  ].filter((row) => row.value)
  if (!rows.length) return null
  return (
    <View style={styles.metaBlock}>
      {rows.map((row) => <InfoRow key={row.label} label={row.label} value={row.value} />)}
    </View>
  )
}

function RuleRow({ text }: { text: string }) {
  return (
    <View style={styles.ruleRow}>
      <View style={styles.ruleDot} />
      <Text style={styles.subtitle}>{text}</Text>
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

function primaryImage(item: { image_paths?: string[] | null; image_path?: string | null } | null): string | undefined {
  return item?.image_paths?.[0] || item?.image_path || undefined
}

function countPublicFoodComments(comments: PublicFoodComment[]): number {
  return comments.reduce((total, entry) => total + 1 + (entry.replies?.length || 0), 0)
}

function publicFoodOwnerId(item: PublicFoodItem | null): string {
  return String(item?.user_id || item?.author?.id || '').trim()
}

function publicFoodLocationText(item: PublicFoodItem | null): string {
  if (!item) return '--'
  const campusParts = [item.school_name || item.campus_name, item.canteen_name, item.floor, item.window_name]
    .map((part) => String(part || '').trim())
    .filter(Boolean)
  if (campusParts.length) return campusParts.join(' · ')
  return item.campus_location_text || item.merchant_address || item.detail_address || item.merchant_name || item.city || '--'
}

function campusRelatedFeedLocationText(item: CampusRelatedFeedItem): string {
  return item.campus_location || [item.school_name, item.canteen_name].map((part) => String(part || '').trim()).filter(Boolean).join(' · ') || '--'
}

function publicFoodAnalysisStatus(item: PublicFoodItem | null): string {
  return String(item?.analysis_status || '').trim().toLowerCase()
}

function isPublicFoodAnalyzing(item: PublicFoodItem | null): boolean {
  const status = publicFoodAnalysisStatus(item)
  return status === 'pending' || status === 'processing'
}

function isPublicFoodAnalysisFailed(item: PublicFoodItem | null): boolean {
  const status = publicFoodAnalysisStatus(item)
  return status === 'failed' || status === 'timed_out'
}

function hasPublicFoodNutrition(item: PublicFoodItem | null): boolean {
  if (!item) return false
  if (hasPositiveNumber(item.total_calories, item.total_protein, item.total_carbs, item.total_fat)) return true
  return (item.items || []).some((row) => {
    const nutrients = asRecord(row.nutrients)
    return hasPositiveNumber(nutrients?.calories, nutrients?.protein, row.calories, row.total_calories)
  })
}

function needsPublicFoodNutritionUpdate(item: PublicFoodItem | null): boolean {
  return Boolean(item && !isPublicFoodAnalyzing(item) && !isPublicFoodAnalysisFailed(item) && !hasPublicFoodNutrition(item))
}

function manualFoodItemFromPublicFood(item: PublicFoodItem): ManualFoodItem {
  const firstItem = asRecord(item.items?.[0])
  const defaultWeight = firstNumber(firstItem?.intake, firstItem?.weight, item.total_calories > 0 ? 1 : 100) || 100
  const title = String(item.food_name || item.description || (item.is_campus_food ? '校园菜品' : '公共食物')).trim()
  const portionLabel = String(firstItem?.manual_portion_label || item.portion_description || '1份').trim()
  return {
    id: item.id,
    title,
    name: title,
    source: 'public_library',
    source_id: item.id,
    source_label: item.is_campus_food ? '校园食堂' : '真实餐食',
    default_weight_grams: defaultWeight,
    total_calories: Number(item.total_calories || 0),
    total_protein: Number(item.total_protein || 0),
    total_carbs: Number(item.total_carbs || 0),
    total_fat: Number(item.total_fat || 0),
    portion_label: portionLabel || '1份',
    recommend_reason: item.is_campus_food ? '校园真实菜品，热量价格一目了然' : '整份复用更快，适合商家餐和外卖',
    image_path: item.image_path,
    image_paths: item.image_paths,
    is_campus_food: item.is_campus_food,
    type: item.type,
    campus_location_text: item.campus_location_text,
    school_name: item.school_name,
    campus_name: item.campus_name,
    canteen_name: item.canteen_name,
    floor: item.floor,
    window_name: item.window_name,
  }
}

function normalizeMealType(value?: string | null): MealType | undefined {
  if (mealOptions.includes(value as MealType)) return value as MealType
  if (value === 'snack') return 'afternoon_snack'
  return undefined
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

function hasPositiveNumber(...values: unknown[]): boolean {
  return values.some((value) => {
    const parsed = Number(value)
    return Number.isFinite(parsed) && parsed > 0
  })
}

function firstNumber(...values: unknown[]): number {
  for (const value of values) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return 0
}

function round1(value: unknown): string {
  const n = Number(value)
  return Number.isFinite(n) ? (Math.round(n * 10) / 10).toString() : '0'
}

function numericValue(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

function money(value: unknown): string {
  const n = Number(value)
  return Number.isFinite(n) ? n.toFixed(2).replace(/\.00$/, '') : '0'
}

function membershipStatusText(status: MembershipStatus): string {
  if (status.is_pro) return '会员有效'
  if (status.trial_active) return '试用中'
  switch (String(status.status || '').toLowerCase()) {
    case 'active':
      return '会员有效'
    case 'expired':
      return '已到期'
    case 'cancelled':
      return '已取消'
    case 'trialing':
      return '试用中'
    default:
      return '基础账号'
  }
}

function paymentStatusText(status?: string): string {
  switch (String(status || 'pending').toLowerCase()) {
    case 'paid':
    case 'success':
      return '已支付'
    case 'closed':
    case 'cancelled':
    case 'canceled':
      return '已关闭'
    case 'expired':
      return '已过期'
    case 'failed':
      return '支付失败'
    default:
      return '待支付'
  }
}

function orderModeText(mode?: string): string {
  switch (String(mode || '').toLowerCase()) {
    case 'renewal':
      return '续费'
    case 'prorated_current_period_upgrade':
      return '补差升级'
    case 'new_purchase':
    default:
      return '开通会员'
  }
}

function planPeriodText(plan: MembershipPlan): string {
  const period = String(plan.period || '').toLowerCase()
  if (period.includes('year')) return '年卡'
  if (period.includes('quarter')) return '季卡'
  if (period.includes('month')) return '月卡'
  const months = Number(plan.duration_months || 0)
  if (months >= 12) return '年卡'
  if (months >= 3) return `${months} 个月`
  if (months >= 1) return months === 1 ? '月卡' : `${months} 个月`
  return '会员周期'
}

function planTierText(tier?: string | null): string {
  switch (String(tier || '').toLowerCase()) {
    case 'light':
      return '轻度版'
    case 'standard':
      return '标准版'
    case 'advanced':
      return '进阶版'
    default:
      return '会员'
  }
}

function planName(code: string, plans: MembershipPlan[]): string {
  return plans.find((plan) => plan.code === code)?.name || code || '--'
}

function paymentModePreview(membership: MembershipStatus | null, plan: MembershipPlan): string {
  if (!membership?.is_pro) return '支付成功后即时生效'
  if (membership.current_plan_code === plan.code) return '当前套餐续费，到期后顺延'
  return '按当前会员剩余价值折抵后补差'
}

function founderBonusText(membership: MembershipStatus | null): string {
  if (!membership) return '--'
  const multiplier = numericValue(membership.early_user_paid_bonus_multiplier)
  if (membership.early_user_paid_bonus_active && multiplier > 1) return `已生效 · 积分 x${multiplier}`
  if (membership.early_user_paid_bonus_eligible && multiplier > 1) return `开通后积分 x${multiplier}`
  const rank = membership.early_user_rank ?? membership.early_paid_user_rank
  if (rank != null) return `排名 ${rank}`
  return '暂无'
}

function dateText(value: unknown, withTime = false): string {
  const raw = String(value || '').trim()
  if (!raw || raw === 'null' || raw === '<nil>') return '--'
  const dt = new Date(raw)
  if (Number.isNaN(dt.getTime())) return raw
  const date = `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}`
  if (!withTime) return date
  return `${date} ${pad2(dt.getHours())}:${pad2(dt.getMinutes())}`
}

function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value)
}

function messageId(message: PrivateMessageItem, fallback: number): string {
  return privateMessageKey(message) || String(fallback)
}

function messageRecordId(message?: PrivateMessageItem): string {
  return String(message?.ID || message?.id || '').trim()
}

function messageContent(message?: PrivateMessageItem): string {
  if (messageType(message) === 'image' && messageImageUrl(message)) return '图片'
  return String(message?.Content || message?.content || '')
}

function messageImageUrl(message?: PrivateMessageItem): string {
  return String(message?.ImageURL || message?.image_url || '')
}

function messageType(message?: PrivateMessageItem): string {
  return String(message?.ContentType || message?.content_type || 'text')
}

function messageSenderId(message?: PrivateMessageItem): string {
  return String(message?.SenderID || message?.sender_id || '')
}

function isSelfPrivateMessage(message: PrivateMessageItem, currentUserId: string): boolean {
  const type = messageType(message)
  return type !== 'system' && messageSenderId(message) !== SYSTEM_MESSAGE_USER_ID && Boolean(currentUserId) && messageSenderId(message) === currentUserId
}

function messageCreatedAt(message?: PrivateMessageItem): string | undefined {
  return message?.CreatedAt || message?.created_at
}

function privateMessageKey(message?: PrivateMessageItem): string {
  const id = messageRecordId(message)
  if (id) return id
  return [
    messageSenderId(message),
    message?.ReceiverID || message?.receiver_id || '',
    messageCreatedAt(message) || '',
    messageType(message),
    messageImageUrl(message) || messageContent(message),
  ].join('|')
}

function normalizePrivateMessages(list: PrivateMessageItem[]): PrivateMessageItem[] {
  return list.slice().reverse()
}

function mergePrivateMessages(...groups: PrivateMessageItem[][]): PrivateMessageItem[] {
  const map = new Map<string, PrivateMessageItem>()
  groups.flat().forEach((message, index) => {
    const key = privateMessageKey(message) || String(index)
    map.set(key, message)
  })
  return Array.from(map.values()).sort((a, b) => {
    const aTime = new Date(messageCreatedAt(a) || '').getTime()
    const bTime = new Date(messageCreatedAt(b) || '').getTime()
    if (Number.isNaN(aTime) || Number.isNaN(bTime)) return 0
    return aTime - bTime
  })
}

function shouldShowMessageTime(previous: PrivateMessageItem | null, current: PrivateMessageItem): boolean {
  if (!previous) return true
  const prevTime = new Date(messageCreatedAt(previous) || '').getTime()
  const currTime = new Date(messageCreatedAt(current) || '').getTime()
  if (Number.isNaN(prevTime) || Number.isNaN(currTime)) return false
  return Math.abs(currTime - prevTime) > 10 * 60 * 1000
}

function formatPrivateMessageTime(value?: string): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const now = new Date()
  const sameDay = date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate()
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000)
  const sameYesterday = date.getFullYear() === yesterday.getFullYear() && date.getMonth() === yesterday.getMonth() && date.getDate() === yesterday.getDate()
  const time = `${pad2(date.getHours())}:${pad2(date.getMinutes())}`
  if (sameDay) return time
  if (sameYesterday) return `昨天 ${time}`
  return `${date.getMonth() + 1}月${date.getDate()}日 ${time}`
}

function conversationUserId(conversation: ConversationSummary): string {
  return String(conversation.UserID || conversation.user_id || '').trim()
}

function conversationNickname(conversation: ConversationSummary): string {
  return String(conversation.Nickname || conversation.nickname || '用户').trim() || '用户'
}

function conversationAvatar(conversation: ConversationSummary): string {
  return String(conversation.Avatar || conversation.avatar || '').trim()
}

function conversationLastMessage(conversation: ConversationSummary): PrivateMessageItem | undefined {
  return conversation.LastMessage || conversation.last_message
}

function conversationUnreadCount(conversation: ConversationSummary): number {
  const value = conversation.UnreadCount ?? conversation.unread_count ?? 0
  return Math.max(0, Math.floor(Number(value) || 0))
}

function conversationPreview(conversation: ConversationSummary, currentUserId: string): string {
  const last = conversationLastMessage(conversation)
  if (!last) return ''
  const userId = conversationUserId(conversation)
  const content = messageContent(last)
  if (userId === SYSTEM_MESSAGE_USER_ID) return content
  const senderId = messageSenderId(last)
  const sentByMe = Boolean(senderId) && (senderId === currentUserId || senderId !== userId)
  return sentByMe ? `我：${content}` : content
}

function mergeConversations(prev: ConversationSummary[], next: ConversationSummary[]): ConversationSummary[] {
  const map = new Map<string, ConversationSummary>()
  prev.forEach((item, index) => map.set(conversationUserId(item) || `prev-${index}`, item))
  next.forEach((item, index) => map.set(conversationUserId(item) || `next-${index}`, item))
  return Array.from(map.values())
}

function showError(title: string, error: unknown) {
  Alert.alert(title, userFacingErrorMessage(error))
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  rowBetween: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
  },
  profileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  buttonRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 14,
  },
  nutritionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 12,
  },
  metaBlock: {
    marginTop: 14,
  },
  creditGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 14,
  },
  membershipStatusSpinner: {
    minHeight: 21,
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  infoTile: {
    flexGrow: 1,
    flexBasis: '45%',
    minHeight: 68,
    borderRadius: 14,
    padding: 12,
    justifyContent: 'center',
    backgroundColor: colors.surfaceMuted,
  },
  infoTileValue: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '900',
  },
  infoTileLabel: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '700',
    marginTop: 4,
  },
  progressTrack: {
    height: 8,
    borderRadius: 999,
    backgroundColor: colors.surfaceMuted,
    overflow: 'hidden',
    marginTop: 14,
  },
  progressFill: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: colors.brand,
  },
  membershipPlanRow: {
    flexDirection: 'row',
    gap: 12,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    padding: 14,
    marginTop: 10,
    backgroundColor: colors.surface,
  },
  membershipPlanRowActive: {
    borderColor: colors.brand,
    backgroundColor: colors.brandSoft,
  },
  priceBlock: {
    alignItems: 'flex-end',
    minWidth: 76,
  },
  originalPrice: {
    color: colors.textMuted,
    fontSize: 12,
    textDecorationLine: 'line-through',
    marginTop: 2,
  },
  payGuideText: {
    color: colors.textSecondary,
    lineHeight: 21,
    marginTop: 12,
    marginBottom: 14,
  },
  ruleRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 10,
  },
  ruleDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: colors.brand,
    marginTop: 8,
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
  notes: {
    marginTop: 12,
    color: colors.textSecondary,
    lineHeight: 21,
  },
  recipeHeader: {
    flexDirection: 'row',
    gap: 12,
  },
  recipeImage: {
    width: 74,
    height: 74,
    borderRadius: 14,
    backgroundColor: colors.surfaceMuted,
  },
  recipeImageFallback: {
    width: 74,
    height: 74,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.brandSoft,
  },
  recipeImageFallbackText: {
    color: colors.brandDark,
    fontSize: 22,
    fontWeight: '900',
  },
  tagRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 10,
  },
  tagText: {
    color: colors.brandDark,
    fontWeight: '800',
  },
  inlinePicker: {
    marginTop: 14,
    padding: 12,
    borderRadius: 14,
    backgroundColor: colors.surfaceMuted,
  },
  recipeItems: {
    marginTop: 12,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  recipeItemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingTop: 10,
  },
  recipeItemName: {
    color: colors.text,
    fontWeight: '800',
  },
  recipeItemMacro: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '800',
  },
  empty: {
    color: colors.textMuted,
    textAlign: 'center',
  },
  itemName: {
    color: colors.text,
    fontWeight: '800',
  },
  kcal: {
    color: colors.brandDark,
    fontWeight: '900',
  },
  price: {
    color: colors.brandDark,
    fontSize: 20,
    fontWeight: '900',
  },
  heroImage: {
    width: '100%',
    height: 190,
    borderRadius: 16,
    marginBottom: 12,
    backgroundColor: colors.surfaceMuted,
  },
  relatedFoodScroll: {
    gap: 12,
    paddingTop: 12,
    paddingRight: 4,
  },
  relatedFoodItem: {
    width: 210,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    padding: 12,
    backgroundColor: colors.surface,
  },
  relatedFoodImage: {
    width: '100%',
    height: 108,
    borderRadius: 12,
    marginBottom: 10,
    backgroundColor: colors.surfaceMuted,
  },
  relatedFoodImageFallback: {
    width: '100%',
    height: 108,
    borderRadius: 12,
    marginBottom: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.brandSoft,
  },
  relatedFoodImageText: {
    color: colors.brandDark,
    fontWeight: '900',
  },
  relatedFeedList: {
    marginTop: 12,
  },
  relatedFeedRow: {
    flexDirection: 'row',
    gap: 12,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  relatedFeedTitle: {
    flex: 1,
  },
  relatedFeedImage: {
    width: 72,
    height: 72,
    borderRadius: 12,
    backgroundColor: colors.surfaceMuted,
  },
  relatedFeedImageFallback: {
    width: 72,
    height: 72,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.brandSoft,
  },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
  },
  avatarFallback: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.brandSoft,
  },
  commentRow: {
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  commentReplyRow: {
    paddingLeft: 12,
    borderLeftWidth: 2,
    borderLeftColor: colors.brandSoft,
  },
  commentReplies: {
    marginTop: 8,
  },
  commentActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 8,
  },
  replyTargetBar: {
    marginBottom: 10,
    padding: 10,
    borderRadius: 12,
    backgroundColor: colors.surfaceMuted,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
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
    backgroundColor: colors.surface,
    paddingHorizontal: 6,
  },
  segmentItemCompact: {
    flexBasis: '22%',
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
    opacity: 0.52,
  },
  smallButtonText: {
    color: colors.brandDark,
    fontWeight: '800',
  },
  smallButtonDangerText: {
    color: colors.danger,
  },
  smallButtonDisabledText: {
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
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    gap: 12,
  },
  infoLabel: {
    color: colors.textSecondary,
  },
  infoValue: {
    color: colors.text,
    fontWeight: '800',
    flex: 1,
    textAlign: 'right',
  },
  messageCard: {
    marginBottom: 10,
  },
  conversationCard: {
    padding: 14,
  },
  conversationCardUnread: {
    borderWidth: 1,
    borderColor: colors.brand,
  },
  conversationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  conversationAvatarImage: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.surfaceMuted,
  },
  conversationAvatarFallback: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.brandSoft,
  },
  conversationAvatarSystem: {
    backgroundColor: colors.surfaceMuted,
  },
  conversationAvatarText: {
    color: colors.brandDark,
    fontSize: 17,
    fontWeight: '900',
  },
  conversationName: {
    flex: 1,
    color: colors.text,
    fontSize: 16,
    fontWeight: '900',
  },
  conversationTime: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '700',
  },
  conversationPreview: {
    marginTop: 5,
    color: colors.textSecondary,
    lineHeight: 20,
  },
  conversationPreviewUnread: {
    color: colors.text,
    fontWeight: '800',
  },
  conversationBadge: {
    minWidth: 24,
    height: 24,
    borderRadius: 12,
    paddingHorizontal: 7,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.danger,
  },
  conversationBadgeText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '900',
  },
  chatComposerCard: {
    padding: 14,
  },
  chatInput: {
    minHeight: 76,
    maxHeight: 128,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 12,
    color: colors.text,
    backgroundColor: colors.surfaceMuted,
  },
  messageRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 10,
    marginBottom: 12,
  },
  messageRowSelf: {
    justifyContent: 'flex-end',
  },
  messageAvatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.brandSoft,
  },
  messageAvatarText: {
    color: colors.brandDark,
    fontWeight: '900',
  },
  messageBubble: {
    maxWidth: '78%',
    borderRadius: 16,
    borderBottomLeftRadius: 6,
    padding: 12,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  messageBubbleSelf: {
    borderBottomLeftRadius: 16,
    borderBottomRightRadius: 6,
    backgroundColor: colors.brand,
    borderColor: colors.brand,
  },
  messageBubbleImage: {
    padding: 8,
  },
  messageBubblePressed: {
    opacity: 0.76,
  },
  messageSender: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '800',
    marginBottom: 6,
  },
  messageSenderSelf: {
    color: 'rgba(255,255,255,0.82)',
    textAlign: 'right',
  },
  messageText: {
    color: colors.text,
    lineHeight: 22,
  },
  messageTextSelf: {
    color: '#fff',
  },
  messageImage: {
    width: 180,
    height: 180,
    borderRadius: 12,
    backgroundColor: colors.surfaceMuted,
  },
  messageTimeDivider: {
    alignSelf: 'center',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginBottom: 12,
    backgroundColor: colors.surfaceMuted,
  },
  messageTimeDividerText: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '800',
  },
  systemMessageWrap: {
    alignItems: 'center',
    marginBottom: 14,
  },
  systemMessageBubble: {
    maxWidth: '86%',
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 9,
    backgroundColor: colors.surfaceMuted,
  },
  systemMessageText: {
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'center',
  },
  messageActionBackdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(15, 23, 42, 0.36)',
  },
  messageActionSheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingHorizontal: 18,
    paddingTop: 10,
    paddingBottom: 32,
  },
  messageActionHandle: {
    alignSelf: 'center',
    width: 42,
    height: 5,
    borderRadius: 999,
    backgroundColor: colors.border,
    marginBottom: 8,
  },
  messageActionItem: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 52,
    borderRadius: 12,
  },
  messageActionPressed: {
    backgroundColor: colors.surfaceMuted,
  },
  messageActionText: {
    color: colors.text,
    fontSize: 17,
    fontWeight: '800',
  },
  messageActionDangerText: {
    color: colors.danger,
  },
  messageActionSeparator: {
    height: 8,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    marginTop: 4,
  },
})
