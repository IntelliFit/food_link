import { useEffect, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { getMealTypeLabel, type ReminderMealType } from '@food-link/core'
import { NextMealCard, nextMealType } from '../components/NextMealCard'
import { useColorScheme } from '../providers/ColorSchemeProvider'
import type { RootStackParamList } from '../navigation/types'
import { colors } from '../theme'

export function MealSuggestionsScreen() {
  const route = useRoute<RouteProp<RootStackParamList, 'MealSuggestions'>>()
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  const [meal, setMeal] = useState<ReminderMealType>(route.params?.mealType || nextMealType())
  useEffect(() => { if (route.params?.mealType) setMeal(route.params.mealType) }, [route.params?.mealType])
  const { isDark } = useColorScheme()
  const insets = useSafeAreaInsets()
  return <ScrollView style={{ backgroundColor: isDark ? '#0d1312' : '#f8faf9' }} contentContainerStyle={{ padding: 18, paddingBottom: insets.bottom + 24 }}>
    <View style={styles.tabs}>{(['breakfast', 'lunch', 'dinner'] as const).map((value) => <Pressable key={value} accessibilityRole="button" accessibilityState={{ selected: meal === value }} style={[styles.tab, { backgroundColor: meal === value ? colors.brand : isDark ? '#223029' : '#eaf3ee' }]} onPress={() => setMeal(value)}><Text style={{ color: meal === value ? '#fff' : isDark ? '#c3d3ca' : '#365246' }}>{getMealTypeLabel(value)}</Text></Pressable>)}</View>
    <NextMealCard mealType={meal} />
    <Pressable accessibilityRole="button" style={styles.tab} onPress={() => navigation.navigate('CampusDiningSettings')}><Text style={{ color: colors.brand }}>设置学生身份与校园就餐偏好</Text></Pressable>
    <Text style={[styles.note, { color: isDark ? '#a8b6b0' : '#64748b' }]}>餐食建议是一般饮食参考，请自行确认过敏原、份量与保存情况。“聊聊这餐”只填入问题，是否发送及付费提示沿用现有聊天流程。</Text>
  </ScrollView>
}
const styles = StyleSheet.create({ tabs: { flexDirection: 'row', gap: 12 }, tab: { flex: 1, minHeight: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' }, note: { fontSize: 12, lineHeight: 20, marginTop: 12 } })
