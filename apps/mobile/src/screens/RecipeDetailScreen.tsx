import { useCallback, useEffect, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { getMealTypeLabel, type MealType, type RecipeItem } from '@food-link/core'
import { apiClient, getStoredUserId } from '../api'
import type { RootStackParamList } from '../navigation/types'
import { colors } from '../theme'
import { todayKey } from '../utils/date'
import { userFacingErrorMessage } from '../utils/errors'
import { emitHomeIntakeDataChangedEvent } from '../utils/home-events'
import { refreshHomeDashboardLocalSnapshotFromCloud } from '../utils/home-dashboard-local-cache'

export function RecipeDetailScreen() {
  const route = useRoute<RouteProp<RootStackParamList, 'RecipeDetail'>>()
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  const insets = useSafeAreaInsets()
  const [recipe, setRecipe] = useState<RecipeItem | null>(null)
  const [loading, setLoading] = useState(true)
  const [action, setAction] = useState<'use' | 'delete' | null>(null)
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setRecipe(await apiClient.getRecipe(route.params.recipeId))
    } catch (error) {
      Alert.alert('加载失败', userFacingErrorMessage(error))
      navigation.goBack()
    } finally {
      setLoading(false)
    }
  }, [navigation, route.params.recipeId])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    void getStoredUserId().then(setCurrentUserId)
  }, [])

  const useRecipe = async () => {
    if (!recipe) return
    setAction('use')
    try {
      const mealType = normalizeMealType(recipe.meal_type) || 'afternoon_snack'
      const result = await apiClient.useRecipe(recipe.id, mealType)
      const date = todayKey()
      await refreshHomeDashboardLocalSnapshotFromCloud(date)
      emitHomeIntakeDataChangedEvent({ date, force: true })
      if (result.record_id) {
        Alert.alert('已记录', '食谱已写入今日饮食记录', [
          { text: '完成' },
          { text: '查看记录', onPress: () => navigation.navigate('RecordDetail', { recordId: result.record_id }) },
        ])
      } else {
        Alert.alert('已记录', '食谱已写入今日饮食记录')
      }
      setRecipe((current) => current ? { ...current, use_count: (current.use_count || 0) + 1 } : current)
    } catch (error) {
      Alert.alert('记录失败', userFacingErrorMessage(error))
    } finally {
      setAction(null)
    }
  }

  const deleteRecipe = () => {
    if (!recipe) return
    Alert.alert('确认删除', '删除后无法恢复，确定要删除这个收藏吗？', [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: async () => {
          setAction('delete')
          try {
            await apiClient.deleteRecipe(recipe.id)
            navigation.goBack()
          } catch (error) {
            Alert.alert('删除失败', userFacingErrorMessage(error))
          } finally {
            setAction(null)
          }
        },
      },
    ])
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.brand} />
      </View>
    )
  }

  if (!recipe) {
    return (
      <View style={styles.center}>
        <Text style={styles.emptyTitle}>食谱不存在或已删除</Text>
      </View>
    )
  }

  const isOwner = Boolean(currentUserId && recipe.user_id === currentUserId)
  const mealName = normalizeMealType(recipe.meal_type)
    ? getMealTypeLabel(normalizeMealType(recipe.meal_type)!)
    : recipe.meal_type || '未指定餐次'

  return (
    <View style={styles.page}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: Math.max(insets.bottom, 16) + (isOwner ? 110 : 28) }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <View style={styles.titleRow}>
            <Text style={styles.title}>{recipe.recipe_name || '未命名食谱'}</Text>
            {recipe.is_favorite ? <Text style={styles.favoriteBadge}>收藏</Text> : null}
          </View>
          <View style={styles.metaRow}>
            <Text style={styles.meta}>{mealName}</Text>
            <Text style={styles.meta}>已使用 {recipe.use_count || 0} 次</Text>
          </View>
          {recipe.tags?.length ? (
            <View style={styles.tags}>
              {recipe.tags.map((tag) => <Text key={tag} style={styles.tag}>#{tag}</Text>)}
            </View>
          ) : null}
        </View>

        {recipe.image_path ? <Image source={{ uri: recipe.image_path }} style={styles.heroImage} resizeMode="cover" /> : null}

        <Section title="营养摘要">
          <View style={styles.nutritionGrid}>
            <NutritionMetric value={recipe.total_calories} label="热量" unit="kcal" />
            <NutritionMetric value={recipe.total_protein} label="蛋白质" unit="g" />
            <NutritionMetric value={recipe.total_carbs} label="碳水" unit="g" />
            <NutritionMetric value={recipe.total_fat} label="脂肪" unit="g" />
          </View>
        </Section>

        {recipe.items?.length ? (
          <Section title="食材 / 分量">
            <View style={styles.items}>
              {recipe.items.map((item, index) => (
                <View key={`${itemName(item)}-${index}`} style={styles.itemRow}>
                  <View style={styles.itemMain}>
                    <Text style={styles.itemName}>{itemName(item)}</Text>
                    <Text style={styles.itemWeight}>{formatNumber(itemWeight(item))}g</Text>
                  </View>
                  <Text style={styles.itemCalories}>{formatNumber(itemCalories(item))} kcal</Text>
                </View>
              ))}
            </View>
          </Section>
        ) : null}

        {recipe.description ? (
          <Section title="备注">
            <Text style={styles.description}>{recipe.description}</Text>
          </Section>
        ) : null}
      </ScrollView>

      {isOwner ? (
        <View style={[styles.actions, { paddingBottom: Math.max(insets.bottom, 12) }]}>
          <Pressable style={styles.secondaryButton} onPress={() => navigation.navigate('RecipeEdit', { recipeId: recipe.id })}>
            <Text style={styles.secondaryButtonText}>编辑</Text>
          </Pressable>
          <Pressable style={styles.deleteButton} onPress={deleteRecipe} disabled={action != null}>
            <Text style={styles.deleteButtonText}>{action === 'delete' ? '删除中…' : '删除'}</Text>
          </Pressable>
          <Pressable style={[styles.primaryButton, action != null && styles.buttonDisabled]} onPress={() => void useRecipe()} disabled={action != null}>
            {action === 'use' ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryButtonText}>一键记录</Text>}
          </Pressable>
        </View>
      ) : null}
    </View>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  )
}

function NutritionMetric({ value, label, unit }: { value?: number | null; label: string; unit: string }) {
  return (
    <View style={styles.nutritionMetric}>
      <Text style={styles.nutritionValue}>{formatNumber(value)}</Text>
      <Text style={styles.nutritionLabel}>{label} ({unit})</Text>
    </View>
  )
}

function normalizeMealType(value?: string | null): MealType | null {
  return ['breakfast', 'morning_snack', 'lunch', 'afternoon_snack', 'dinner', 'evening_snack'].includes(value || '')
    ? value as MealType
    : null
}

function formatNumber(value?: number | null): string {
  const numeric = Number(value || 0)
  return Number.isInteger(numeric) ? String(numeric) : numeric.toFixed(1)
}

function itemName(item: Record<string, unknown>): string {
  return String(item.name || item.food_name || '食物')
}

function itemWeight(item: Record<string, unknown>): number {
  return Number(item.weight || item.weight_grams || item.amount || 0)
}

function itemCalories(item: Record<string, unknown>): number {
  const nutrients = item.nutrients && typeof item.nutrients === 'object'
    ? item.nutrients as Record<string, unknown>
    : {}
  return Number(nutrients.calories || item.calories || 0)
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#f8faf8' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#f8faf8' },
  emptyTitle: { color: '#64748b', fontSize: 16, fontWeight: '600' },
  content: { padding: 16, gap: 14 },
  header: { backgroundColor: '#fff', borderRadius: 18, padding: 18, gap: 10 },
  titleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  title: { flex: 1, color: '#17211d', fontSize: 24, lineHeight: 32, fontWeight: '800' },
  favoriteBadge: { color: '#a16207', backgroundColor: '#fef3c7', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, fontSize: 12, fontWeight: '700' },
  metaRow: { flexDirection: 'row', gap: 14 },
  meta: { color: '#64748b', fontSize: 13 },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tag: { color: '#278663', backgroundColor: '#ecfdf5', borderRadius: 999, paddingHorizontal: 9, paddingVertical: 4, fontSize: 12 },
  heroImage: { width: '100%', height: 220, borderRadius: 18, backgroundColor: '#e2e8f0' },
  section: { backgroundColor: '#fff', borderRadius: 18, padding: 16, gap: 14 },
  sectionTitle: { color: '#17211d', fontSize: 17, fontWeight: '800' },
  nutritionGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  nutritionMetric: { width: '47%', flexGrow: 1, minHeight: 86, borderRadius: 14, backgroundColor: '#f0fdf7', alignItems: 'center', justifyContent: 'center' },
  nutritionValue: { color: '#137a57', fontSize: 23, fontWeight: '800' },
  nutritionLabel: { color: '#64748b', fontSize: 12, marginTop: 4 },
  items: { gap: 10 },
  itemRow: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#e2e8f0', paddingBottom: 10, gap: 4 },
  itemMain: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  itemName: { flex: 1, color: '#25332d', fontSize: 15, fontWeight: '700' },
  itemWeight: { color: '#475569', fontSize: 14, fontWeight: '600' },
  itemCalories: { color: '#94a3b8', fontSize: 12 },
  description: { color: '#475569', fontSize: 14, lineHeight: 22 },
  actions: { position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', gap: 10, paddingHorizontal: 14, paddingTop: 12, backgroundColor: '#fff', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#dbe5df' },
  secondaryButton: { minWidth: 72, height: 48, borderRadius: 14, backgroundColor: '#f1f5f9', alignItems: 'center', justifyContent: 'center' },
  secondaryButtonText: { color: '#475569', fontSize: 15, fontWeight: '700' },
  deleteButton: { minWidth: 72, height: 48, borderRadius: 14, backgroundColor: '#fff1f2', alignItems: 'center', justifyContent: 'center' },
  deleteButtonText: { color: '#dc2626', fontSize: 15, fontWeight: '700' },
  primaryButton: { flex: 1, height: 48, borderRadius: 14, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  primaryButtonText: { color: '#fff', fontSize: 16, fontWeight: '800' },
  buttonDisabled: { opacity: 0.55 },
})
