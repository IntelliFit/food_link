import { useCallback, useRef, useState } from 'react'
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from 'react-native'
import { useFocusEffect, useNavigation } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { getMealTypeLabel, type DietRecommendationOption, type DietRecommendationResult, type ReminderMealType } from '@food-link/core'
import { apiClient, getStoredUserId } from '../api'
import { useColorScheme } from '../providers/ColorSchemeProvider'
import type { RootStackParamList } from '../navigation/types'
import { colors } from '../theme'

export function nextMealType(now = new Date()): ReminderMealType {
  const hour = now.getHours()
  return hour < 10 ? 'breakfast' : hour < 15 ? 'lunch' : 'dinner'
}

function sourceLabel(option: DietRecommendationOption): string {
  if (option.source === 'food_record') return typeof option.history_date === 'string' ? `${option.history_date.slice(5)} 记录过的餐食` : '你记录过的餐食'
  const place = option.is_campus_food
    ? [option.school_name, option.canteen_name, option.window_name].filter(Boolean).join(' · ')
    : typeof option.merchant_name === 'string' ? option.merchant_name : option.canteen_name || '已收录餐食'
  return `${place}${option.requires_campus_access_confirmation ? ' · 校内就餐待确认' : ''}`
}

/** Same free preview endpoint as WeChat. No automatic GPS permission or AI request. */
export function NextMealCard({ mealType, compact = false, refreshKey = '' }: { mealType: ReminderMealType; compact?: boolean; refreshKey?: string }) {
  const { isDark } = useColorScheme()
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  const [result, setResult] = useState<DietRecommendationResult | null>(null)
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState('')
  const [failedImages, setFailedImages] = useState<Record<string, boolean>>({})
  const sequence = useRef(0)
  const palette = { card: isDark ? '#181f1d' : '#fff', text: isDark ? '#f2f7f4' : '#17201d', muted: isDark ? '#a8b6b0' : '#64748b', inset: isDark ? '#223029' : '#f3f8f5' }
  const load = useCallback(async () => {
    const seq = ++sequence.current
    setBusy(true)
    setError('')
    setResult(null)
    try {
      const owner = await getStoredUserId()
      if (!owner) return
      const data = await apiClient.previewMeals({ meal_type: mealType })
      if (seq !== sequence.current || owner !== await getStoredUserId()) return
      setResult(data)
      setFailedImages({})
    } catch {
      if (seq === sequence.current) setError('餐食读取失败，请重试')
    } finally {
      if (seq === sequence.current) setBusy(false)
    }
  }, [mealType])
  useFocusEffect(useCallback(() => {
    void load()
    return () => { sequence.current += 1 }
  }, [load, refreshKey]))

  const options = (result?.recommendations || []).slice(0, compact ? 1 : 3)
  const notes = Array.isArray(result?.data_notes) ? result.data_notes.filter((note): note is string => typeof note === 'string') : []
  const chat = (option?: DietRecommendationOption) => navigation.navigate('PetChat', {
    starterQuestion: option ? `我想${getMealTypeLabel(mealType)}吃${option.title}，怎么搭配更合适？` : `帮我想想${getMealTypeLabel(mealType)}吃什么。`,
  })

  return <View style={[styles.card, { backgroundColor: palette.card }]}>
    <View style={styles.heading}><Text style={[styles.title, { color: palette.text }]}>{getMealTypeLabel(mealType)}吃什么</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="刷新餐食建议" disabled={busy} onPress={() => void load()} style={styles.link}><Text style={{ color: colors.brand }}>刷新</Text></Pressable>
    </View>
    {busy ? <View style={styles.spinner}><ActivityIndicator color={colors.brand} /></View> : options.length ? options.map((option, index) => {
      const key = `${option.source}:${option.source_id || index}`
      const image = option.image_path && /^https?:\/\//i.test(option.image_path) && !failedImages[key] ? option.image_path : ''
      return <View key={key} style={[styles.option, { backgroundColor: palette.inset }]}>
        {image ? <Image source={{ uri: image }} style={styles.image} onError={() => setFailedImages((previous) => ({ ...previous, [key]: true }))} /> : null}
        <Text style={[styles.optionTitle, { color: palette.text }]}>{option.title || option.items?.map((item) => item.name).join(' + ') || '餐食建议'}</Text>
        <Text style={[styles.note, { color: palette.muted }]}>{sourceLabel(option)}</Text>
        {!!option.reason && <Text style={[styles.note, { color: palette.muted }]}>{option.reason}</Text>}
        {Number.isFinite(option.calories) && option.calories > 0 ? <Text style={[styles.note, { color: palette.muted }]}>参考热量 {Math.round(option.calories)} kcal · 营养数据以库内来源为准</Text> : null}
        <View style={styles.actions}>
          {option.source_id && ['food_record', 'public_food_library'].includes(option.source || '') ? <Pressable style={styles.link} accessibilityRole="button" onPress={() => option.source === 'food_record' ? navigation.navigate('RecordDetail', { recordId: option.source_id! }) : navigation.navigate('PublicFoodDetail', { itemId: option.source_id!, isCampus: option.is_campus_food })}><Text style={{ color: colors.brand }}>查看来源</Text></Pressable> : null}
          <Pressable style={styles.link} accessibilityRole="button" onPress={() => chat(option)}><Text style={{ color: colors.brand }}>聊聊这餐</Text></Pressable>
        </View>
      </View>
    }) : <View style={styles.empty}><Text style={[styles.note, { color: palette.muted }]}>{error || '暂时没找到合适的餐食。可以先记录几餐，或完善校园档案。'}</Text>
      <Pressable style={styles.link} accessibilityRole="button" onPress={() => void load()}><Text style={{ color: colors.brand }}>重试</Text></Pressable>
    </View>}
    {!busy && notes.map((note, index) => <Text key={index} style={[styles.note, { color: palette.muted }]}>{note}</Text>)}
    <Text style={[styles.note, { color: palette.muted }]}>免费检索真实历史／校园餐食，不自动扣积分。当前未使用实时位置，历史记录不表示商家今天有售。</Text>
    {compact ? <Pressable style={styles.link} accessibilityRole="button" onPress={() => navigation.navigate('MealSuggestions', { mealType })}><Text style={{ color: colors.brand }}>查看餐食建议</Text></Pressable> : <Pressable style={styles.link} accessibilityRole="button" onPress={() => navigation.navigate('ManualRecord', { mealType })}><Text style={{ color: colors.brand }}>记下这餐实际吃的食物</Text></Pressable>}
  </View>
}

const styles = StyleSheet.create({
  card: { borderRadius: 18, padding: 16, marginVertical: 8 }, heading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontSize: 18, fontWeight: '800' }, spinner: { minHeight: 96, alignItems: 'center', justifyContent: 'center' },
  option: { padding: 14, borderRadius: 14, marginBottom: 12 }, optionTitle: { fontSize: 17, fontWeight: '700', lineHeight: 24 },
  image: { height: 140, borderRadius: 12, marginBottom: 12 }, note: { fontSize: 12, lineHeight: 19, marginTop: 6 },
  link: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 4 }, actions: { flexDirection: 'row', gap: 20 }, empty: { paddingVertical: 12 },
})
