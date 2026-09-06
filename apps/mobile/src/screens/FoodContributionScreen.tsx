import { useEffect, useRef, useState } from 'react'
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { ChevronRight, Package, UtensilsCrossed, Wheat, X } from 'lucide-react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import type { RootStackParamList } from '../navigation/types'
import { useColorScheme } from '../providers/ColorSchemeProvider'
import { colors } from '../theme'

type FoodContributionRoute = RouteProp<RootStackParamList, 'FoodContribution'>

const contributionItems = [
  {
    key: 'standard' as const,
    title: '标准食物',
    description: '米饭、鸡蛋、土豆等每100g营养数据',
    Icon: Wheat,
    tint: '#f59e0b',
    tintSoft: '#fff7e6',
  },
  {
    key: 'packaged' as const,
    title: '包装食品',
    description: '拍包装正面、营养成分表和配料表',
    Icon: Package,
    tint: '#3b82f6',
    tintSoft: '#eff6ff',
  },
  {
    key: 'public' as const,
    title: '公共餐食',
    description: '普通餐食或校园食堂真实菜品',
    Icon: UtensilsCrossed,
    tint: colors.brandDark,
    tintSoft: '#ecfdf5',
  },
]

export function FoodContributionScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  const route = useRoute<FoodContributionRoute>()
  const insets = useSafeAreaInsets()
  const { isDark } = useColorScheme()
  const [publicChoiceOpen, setPublicChoiceOpen] = useState(false)
  const initialFocusHandled = useRef(false)
  const palette = {
    page: isDark ? '#0d1312' : '#f8faf9',
    card: isDark ? '#181f1d' : '#ffffff',
    text: isDark ? '#f2f7f4' : '#17201d',
    muted: isDark ? '#a8b6b0' : '#64748b',
    border: isDark ? 'rgba(255,255,255,0.08)' : '#e6ece9',
    note: isDark ? '#15231e' : '#effaf5',
    sheet: isDark ? '#181f1d' : '#ffffff',
  }

  const openContribution = (key: 'standard' | 'packaged' | 'public') => {
    if (key === 'standard') {
      navigation.navigate('StandardFoodContribution')
      return
    }
    if (key === 'packaged') {
      navigation.navigate('PackagedFoodEdit')
      return
    }
    setPublicChoiceOpen(true)
  }

  useEffect(() => {
    if (initialFocusHandled.current || !route.params?.focus) return
    initialFocusHandled.current = true
    const timer = setTimeout(() => openContribution(route.params!.focus!), 0)
    return () => clearTimeout(timer)
  }, [route.params?.focus])

  return (
    <View style={[styles.page, { backgroundColor: palette.page }]}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: Math.max(insets.bottom + 32, 48) }]}
        showsVerticalScrollIndicator={false}
      >
        <Text style={[styles.heroTitle, { color: palette.text }]}>选择要补充的食物类型</Text>
        <Text style={[styles.heroDescription, { color: palette.muted }]}>提交真实、清晰的信息，审核后会补充到食探的数据服务中。</Text>

        <View style={styles.itemStack}>
          {contributionItems.map(({ key, title, description, Icon, tint, tintSoft }) => (
            <Pressable
              key={key}
              accessibilityRole="button"
              accessibilityLabel={`${title}，${description}`}
              style={({ pressed }) => [
                styles.itemCard,
                { backgroundColor: palette.card, borderColor: palette.border },
                pressed && styles.pressed,
              ]}
              onPress={() => openContribution(key)}
            >
              <View style={[styles.iconWrap, { backgroundColor: isDark ? `${tint}24` : tintSoft }]}>
                <Icon size={24} color={tint} strokeWidth={2.1} />
              </View>
              <View style={styles.itemCopy}>
                <Text style={[styles.itemTitle, { color: palette.text }]}>{title}</Text>
                <Text style={[styles.itemDescription, { color: palette.muted }]}>{description}</Text>
              </View>
              <ChevronRight size={20} color={isDark ? '#7c8d86' : '#9aa8a2'} strokeWidth={2.2} />
            </Pressable>
          ))}
        </View>

        <View style={[styles.noteCard, { backgroundColor: palette.note, borderColor: isDark ? 'rgba(110,231,183,0.16)' : '#d6f2e5' }]}>
          <Text style={[styles.noteTitle, { color: isDark ? '#7ee2b4' : '#17734d' }]}>审核与奖励</Text>
          <Text style={[styles.noteText, { color: palette.muted }]}>标准食物与包装食品审核通过后奖励1积分；公共餐食按现有奖励规则执行。</Text>
        </View>
      </ScrollView>

      <Modal visible={publicChoiceOpen} transparent animationType="slide" onRequestClose={() => setPublicChoiceOpen(false)}>
        <Pressable accessibilityRole="button" accessibilityLabel="关闭餐食类型选择" style={styles.scrim} onPress={() => setPublicChoiceOpen(false)}>
          <Pressable
            accessibilityRole="none"
            style={[styles.sheet, { backgroundColor: palette.sheet, paddingBottom: Math.max(insets.bottom + 16, 28) }]}
            onPress={(event) => event.stopPropagation()}
          >
            <View style={styles.sheetHead}>
              <View>
                <Text style={[styles.sheetTitle, { color: palette.text }]}>选择公共餐食类型</Text>
                <Text style={[styles.sheetSubtitle, { color: palette.muted }]}>根据餐食来源进入对应的补充流程</Text>
              </View>
              <Pressable accessibilityRole="button" accessibilityLabel="关闭" hitSlop={8} style={({ pressed }) => [styles.closeButton, pressed && styles.pressed]} onPress={() => setPublicChoiceOpen(false)}>
                <X size={21} color={palette.muted} strokeWidth={2.2} />
              </Pressable>
            </View>
            <SheetChoice
              title="普通公共餐食"
              description="餐馆、外卖或自制餐食"
              palette={palette}
              onPress={() => {
                setPublicChoiceOpen(false)
                navigation.navigate('PublicFoodShare', { mode: 'public' })
              }}
            />
            <SheetChoice
              title="校园餐食"
              description="学校、校区、食堂和档口菜品"
              palette={palette}
              onPress={() => {
                setPublicChoiceOpen(false)
                navigation.navigate('PublicFoodShare', { mode: 'campus' })
              }}
            />
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  )
}

function SheetChoice({ title, description, palette, onPress }: { title: string; description: string; palette: { card: string; text: string; muted: string; border: string }; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}，${description}`}
      style={({ pressed }) => [styles.sheetChoice, { backgroundColor: palette.card, borderColor: palette.border }, pressed && styles.pressed]}
      onPress={onPress}
    >
      <View style={styles.itemCopy}>
        <Text style={[styles.sheetChoiceTitle, { color: palette.text }]}>{title}</Text>
        <Text style={[styles.sheetChoiceDescription, { color: palette.muted }]}>{description}</Text>
      </View>
      <ChevronRight size={20} color={palette.muted} strokeWidth={2.2} />
    </Pressable>
  )
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  content: { paddingHorizontal: 18, paddingTop: 24 },
  heroTitle: { fontSize: 24, lineHeight: 32, fontWeight: '900' },
  heroDescription: { marginTop: 8, maxWidth: 520, fontSize: 14, lineHeight: 22 },
  itemStack: { marginTop: 24, gap: 12 },
  itemCard: { minHeight: 88, borderRadius: 20, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 16, paddingVertical: 14, flexDirection: 'row', alignItems: 'center' },
  iconWrap: { width: 48, height: 48, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  itemCopy: { flex: 1, minWidth: 0, marginHorizontal: 14 },
  itemTitle: { fontSize: 16, lineHeight: 23, fontWeight: '800' },
  itemDescription: { marginTop: 3, fontSize: 13, lineHeight: 19 },
  noteCard: { marginTop: 20, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, padding: 16 },
  noteTitle: { fontSize: 13, lineHeight: 19, fontWeight: '800' },
  noteText: { marginTop: 5, fontSize: 13, lineHeight: 20 },
  scrim: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.52)' },
  sheet: { borderTopLeftRadius: 26, borderTopRightRadius: 26, paddingHorizontal: 18, paddingTop: 18, gap: 10 },
  sheetHead: { minHeight: 58, flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 4 },
  sheetTitle: { fontSize: 19, lineHeight: 26, fontWeight: '900' },
  sheetSubtitle: { marginTop: 3, fontSize: 13, lineHeight: 19 },
  closeButton: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center', marginTop: -8, marginRight: -8 },
  sheetChoice: { minHeight: 76, borderRadius: 18, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center' },
  sheetChoiceTitle: { fontSize: 15, lineHeight: 22, fontWeight: '800' },
  sheetChoiceDescription: { marginTop: 2, fontSize: 13, lineHeight: 19 },
  pressed: { opacity: 0.72 },
})
