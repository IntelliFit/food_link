import { useCallback, useEffect, useMemo, useState } from 'react'
import { Alert, Image, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import * as ImagePicker from 'expo-image-picker'
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import {
  getMealTypeLabel,
  inferDefaultMealTypeFromLocalTime,
  type CommunityFeedContext,
  type CommunityFeedTargetType,
  type ConversationSummary,
  type FeedCommentItem,
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

const mealOptions: MealType[] = ['breakfast', 'morning_snack', 'lunch', 'afternoon_snack', 'dinner', 'evening_snack']
const SYSTEM_MESSAGE_USER_ID = '00000000-0000-0000-0000-000000000000'

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
            <Text style={styles.subtitle}>{membershipStatusText(membership)}</Text>
          </View>
          <Pill text={membership?.trial_active ? '试用中' : membership?.is_pro ? 'Pro' : '基础账号'} />
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
      Alert.alert('已记录', '食谱已写入今日饮食记录')
      if (result.record_id) navigation.navigate('RecordDetail', { recordId: result.record_id })
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

export function PublicFoodScreen() {
  const route = useRoute<RouteProp<RootStackParamList, 'PublicFood'>>()
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  const initialMode = route.params?.mode || 'all'
  const [mode, setMode] = useState<'all' | 'campus' | 'mine' | 'collections'>(initialMode)
  const [items, setItems] = useState<PublicFoodItem[]>([])
  const [loading, setLoading] = useState(false)

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
          limit: 30,
          sortBy: 'latest',
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
  }, [mode])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <Page title="公共食物库" subtitle="外食、校园餐和用户分享" refreshing={loading} onRefresh={load}>
      <View style={styles.segment}>
        <SegmentButton label="全部" active={mode === 'all'} onPress={() => setMode('all')} />
        <SegmentButton label="校园" active={mode === 'campus'} onPress={() => setMode('campus')} />
        <SegmentButton label="我的" active={mode === 'mine'} onPress={() => setMode('mine')} />
        <SegmentButton label="收藏" active={mode === 'collections'} onPress={() => setMode('collections')} />
      </View>
      {items.length === 0 ? <EmptyState text="暂无公共食物" /> : null}
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
  const [comments, setComments] = useState<PublicFoodComment[]>([])
  const [comment, setComment] = useState('')
  const [feedback, setFeedback] = useState('')
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [itemData, commentData] = await Promise.all([
        route.params.isCampus
          ? apiClient.getCampusFoodDetail(route.params.itemId).then((data) => data.item)
          : apiClient.getPublicFood(route.params.itemId),
        apiClient.listPublicFoodComments(route.params.itemId).catch(() => ({ list: [] as PublicFoodComment[] })),
      ])
      setItem(itemData)
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
      await apiClient.addPublicFoodComment(item.id, comment)
      setComment('')
      await load()
    } catch (error) {
      showError('评论失败', error)
    } finally {
      setLoading(false)
    }
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
          <SmallButton label={`${item?.liked ? '已赞' : '点赞'} ${item?.like_count || 0}`} onPress={toggleLike} />
          <SmallButton label={item?.collected ? '已收藏' : '收藏'} onPress={toggleCollect} />
          {item ? <SmallButton label="编辑" onPress={() => navigation.navigate('PublicFoodShare', { editId: item.id, mode: item.is_campus_food ? 'campus' : 'public' })} /> : null}
          {item ? <SmallButton label="删除" danger onPress={remove} /> : null}
        </View>
      </Card>

      <Card>
        <Text style={styles.sectionTitle}>评论</Text>
        <Field label="写评论" value={comment} onChangeText={setComment} multiline />
        <AppButton label="发布评论" variant="secondary" loading={loading} onPress={addComment} />
        {comments.map((entry) => (
          <View key={entry.id} style={styles.commentRow}>
            <Text style={styles.itemName}>{entry.nickname || '用户'}</Text>
            <Text style={styles.subtitle}>{entry.content}</Text>
          </View>
        ))}
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
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [conversationData, unreadData] = await Promise.all([
        apiClient.listConversations(),
        apiClient.getUnreadPrivateMessageCount().catch(() => ({ count: 0 })),
      ])
      setConversations(conversationData.list || [])
      setUnread(unreadData.count || 0)
    } catch (error) {
      showError('获取私信失败', error)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <Page title="私信" subtitle={`${unread} 条未读`} refreshing={loading} onRefresh={load}>
      {conversations.length === 0 ? <EmptyState text="暂无私信会话" /> : null}
      {conversations.map((conversation) => {
        const userId = conversation.UserID || conversation.user_id || ''
        const nickname = conversation.Nickname || conversation.nickname || '用户'
        const last = conversation.LastMessage || conversation.last_message
        const count = conversation.UnreadCount ?? conversation.unread_count ?? 0
        return (
          <Pressable key={userId} onPress={() => navigation.navigate('PrivateChat', { userId, nickname })}>
            <Card>
              <View style={styles.rowBetween}>
                <View style={styles.flex}>
                  <Text style={styles.itemName}>{nickname}</Text>
                  <Text style={styles.subtitle}>{messageContent(last) || '打开会话'}</Text>
                </View>
                {count > 0 ? <Pill text={`${count} 未读`} /> : null}
              </View>
            </Card>
          </Pressable>
        )
      })}
    </Page>
  )
}

export function PrivateChatScreen() {
  const route = useRoute<RouteProp<RootStackParamList, 'PrivateChat'>>()
  const [messages, setMessages] = useState<PrivateMessageItem[]>([])
  const [content, setContent] = useState('')
  const [currentUserId, setCurrentUserId] = useState('')
  const [loading, setLoading] = useState(false)
  const [sendingImage, setSendingImage] = useState(false)
  const isSystemChat = route.params.userId === SYSTEM_MESSAGE_USER_ID

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await apiClient.getConversation(route.params.userId, 0, 60)
      setMessages((data.list || []).slice().reverse())
      await apiClient.markConversationRead(route.params.userId).catch(() => null)
    } catch (error) {
      showError('获取会话失败', error)
    } finally {
      setLoading(false)
    }
  }, [route.params.userId])

  useEffect(() => {
    void getStoredUserId().then((id) => setCurrentUserId(id || ''))
    void load()
  }, [load])

  const send = async () => {
    const text = content.trim()
    if (!text) {
      Alert.alert('请输入消息内容')
      return
    }
    setLoading(true)
    try {
      await apiClient.sendPrivateMessage(route.params.userId, text)
      setContent('')
      await load()
    } catch (error) {
      showError('发送失败', error)
    } finally {
      setLoading(false)
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
      await load()
    } catch (error) {
      showError('发送图片失败', error)
    } finally {
      setSendingImage(false)
    }
  }

  return (
    <Page title={isSystemChat ? '系统消息' : route.params.nickname || '私信'} subtitle={isSystemChat ? '平台通知和处理结果' : '好友和关注用户的点对点消息'} refreshing={loading} onRefresh={load}>
      {messages.length === 0 ? <EmptyState text="暂无消息" /> : null}
      {messages.map((msg, index) => (
        <MessageBubble key={messageId(msg, index)} message={msg} currentUserId={currentUserId} counterpartName={route.params.nickname || '用户'} />
      ))}
      {isSystemChat ? null : (
        <Card>
          <Field label="消息" value={content} onChangeText={setContent} multiline />
          <View style={styles.buttonRow}>
            <SmallButton label="发图片" onPress={sendImage} />
            <SmallButton label="发送" onPress={send} />
          </View>
          {sendingImage ? <Text style={styles.subtitle}>图片发送中</Text> : null}
        </Card>
      )}
    </Page>
  )
}

export function BodyTrendsScreen() {
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

  useEffect(() => {
    void load()
  }, [load])

  const body = summary?.body_metrics
  const latestWeight = body?.latest_weight?.value
  const weightChange = body?.weight_change

  return (
    <Page title="身体趋势" subtitle="体重、饮水、运动和月度摄入趋势" refreshing={loading} onRefresh={load}>
      <Card>
        <Text style={styles.sectionTitle}>体重</Text>
        <Text style={styles.bigNumber}>{latestWeight ? `${latestWeight} kg` : '--'}</Text>
        <Text style={styles.subtitle}>月变化 {weightChange == null ? '--' : `${weightChange > 0 ? '+' : ''}${weightChange.toFixed(1)} kg`}</Text>
      </Card>
      <Card>
        <Text style={styles.sectionTitle}>饮水</Text>
        <Text style={styles.bigNumber}>{Math.round(body?.avg_daily_water_ml || 0)} ml</Text>
        <Text style={styles.subtitle}>日均饮水 · 记录 {body?.water_recorded_days || 0} 天</Text>
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
          <Pill text={`赞 ${item.like_count || 0}`} />
          <Pill text={`藏 ${item.collection_count || 0}`} />
        </View>
      </Card>
    </Pressable>
  )
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
}: {
  message: PrivateMessageItem
  currentUserId: string
  counterpartName: string
}) {
  const type = messageType(message)
  const isSystem = type === 'system' || messageSenderId(message) === SYSTEM_MESSAGE_USER_ID
  const isSelf = !isSystem && Boolean(currentUserId) && messageSenderId(message) === currentUserId
  const imageUrl = messageImageUrl(message)
  const content = messageContent(message)

  if (isSystem) {
    return (
      <View style={styles.systemMessageWrap}>
        <Text style={styles.messageTime}>{formatDateTime(messageCreatedAt(message))}</Text>
        <View style={styles.systemMessageBubble}>
          <Text style={styles.systemMessageText}>{content || '系统通知'}</Text>
        </View>
      </View>
    )
  }

  return (
    <View style={[styles.messageRow, isSelf && styles.messageRowSelf]}>
      {!isSelf ? <AvatarDot label={counterpartName} /> : null}
      <View style={[styles.messageBubble, isSelf && styles.messageBubbleSelf]}>
        <Text style={[styles.messageSender, isSelf && styles.messageSenderSelf]}>{isSelf ? '我' : counterpartName}</Text>
        {type === 'image' && imageUrl ? (
          <Image source={{ uri: imageUrl }} style={styles.messageImage} resizeMode="cover" />
        ) : (
          <Text style={[styles.messageText, isSelf && styles.messageTextSelf]}>{content || '消息'}</Text>
        )}
        <Text style={[styles.messageTime, isSelf && styles.messageTimeSelf]}>{formatDateTime(messageCreatedAt(message))}</Text>
      </View>
    </View>
  )
}

function AvatarDot({ label }: { label: string }) {
  const initial = label.trim().slice(0, 1) || '友'
  return (
    <View style={styles.messageAvatar}>
      <Text style={styles.messageAvatarText}>{initial}</Text>
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

function SegmentButton({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable style={[styles.segmentItem, active && styles.segmentItemActive]} onPress={onPress}>
      <Text style={[styles.segmentText, active && styles.segmentTextActive]}>{label}</Text>
    </Pressable>
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

function primaryImage(item: PublicFoodItem | null): string | undefined {
  return item?.image_paths?.[0] || item?.image_path || undefined
}

function publicFoodLocationText(item: PublicFoodItem | null): string {
  if (!item) return '--'
  const campusParts = [item.school_name || item.campus_name, item.canteen_name, item.floor, item.window_name]
    .map((part) => String(part || '').trim())
    .filter(Boolean)
  if (campusParts.length) return campusParts.join(' · ')
  return item.campus_location_text || item.merchant_address || item.detail_address || item.merchant_name || item.city || '--'
}

function normalizeMealType(value?: string | null): MealType | undefined {
  if (mealOptions.includes(value as MealType)) return value as MealType
  if (value === 'snack') return 'afternoon_snack'
  return undefined
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
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

function membershipStatusText(status: MembershipStatus | null): string {
  if (!status) return '会员状态加载中'
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
  return String(message.ID || message.id || fallback)
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

function messageCreatedAt(message?: PrivateMessageItem): string | undefined {
  return message?.CreatedAt || message?.created_at
}

function showError(title: string, error: unknown) {
  Alert.alert(title, error instanceof Error ? error.message : '请稍后重试')
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
  messageTime: {
    color: colors.textMuted,
    fontSize: 11,
    marginTop: 8,
  },
  messageTimeSelf: {
    color: 'rgba(255,255,255,0.72)',
    textAlign: 'right',
  },
  messageImage: {
    width: 180,
    height: 180,
    borderRadius: 12,
    backgroundColor: colors.surfaceMuted,
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
})
