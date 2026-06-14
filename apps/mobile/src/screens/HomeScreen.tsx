import { useCallback } from 'react'
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native'
import { useNavigation } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { getMealTypeLabel, inferDefaultMealTypeFromLocalTime } from '@food-link/core'
import { AppButton } from '../components/AppButton'
import { Card } from '../components/Card'
import { MacroRow } from '../components/MacroRow'
import { Page } from '../components/Page'
import { useHomeDashboard } from '../hooks/useHomeDashboard'
import type { RootStackParamList } from '../navigation/types'
import { colors } from '../theme'
import { formatShortDate } from '../utils/date'

export function HomeScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  const { recordDate, dashboard, loading, error, loadHome } = useHomeDashboard()
  const mealType = inferDefaultMealTypeFromLocalTime()

  const startAnalyze = useCallback(() => {
    navigation.navigate('Analyze', { source: 'library', mealType, date: recordDate })
  }, [navigation, mealType, recordDate])

  const showPending = (title: string) => {
    Alert.alert(title, '这个页面入口已经放进 App 框架，完整交互会在后续批次继续迁移。')
  }

  return (
    <Page
      title="首页"
      subtitle={`${formatShortDate(recordDate)} · 默认餐次 ${getMealTypeLabel(mealType)}`}
      refreshing={loading}
      onRefresh={loadHome}
    >
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Card>
        <View style={styles.rowBetween}>
          <Text style={styles.sectionTitle}>今日概览</Text>
          <Pressable onPress={() => navigation.navigate('DayRecord', { date: recordDate })}>
            <Text style={styles.link}>单日详情</Text>
          </Pressable>
        </View>
        <Text style={styles.bigNumber}>
          {Math.round(dashboard?.intakeData.current || 0)} / {Math.round(dashboard?.intakeData.target || 0)} kcal
        </Text>
        <Text style={styles.subtitle}>运动消耗 {Math.round(dashboard?.exerciseBurnedKcal || 0)} kcal</Text>
        <MacroRow label="蛋白质" value={dashboard?.intakeData.macros.protein.current} target={dashboard?.intakeData.macros.protein.target} />
        <MacroRow label="碳水" value={dashboard?.intakeData.macros.carbs.current} target={dashboard?.intakeData.macros.carbs.target} />
        <MacroRow label="脂肪" value={dashboard?.intakeData.macros.fat.current} target={dashboard?.intakeData.macros.fat.target} />
      </Card>

      <View style={styles.quickGrid}>
        <QuickCard title="体重" value="记录" onPress={() => navigation.navigate('BodyMetricRecord', { type: 'weight' })} />
        <QuickCard title="喝水" value="补水" onPress={() => navigation.navigate('BodyMetricRecord', { type: 'water' })} />
        <QuickCard title="运动" value={`${Math.round(dashboard?.exerciseBurnedKcal || 0)} kcal`} onPress={() => navigation.navigate('BodyMetricRecord', { type: 'exercise' })} />
      </View>

      <Card>
        <View style={styles.rowBetween}>
          <Text style={styles.sectionTitle}>今天吃什么</Text>
          <Text style={styles.badge}>AI 推荐</Text>
        </View>
        <Text style={styles.subtitle}>先按小程序框架保留推荐入口，后续接入完整饮食建议弹层。</Text>
        <AppButton label="选择食物图片并分析" loading={loading} onPress={startAnalyze} />
      </Card>

      <Card>
        <View style={styles.rowBetween}>
          <Text style={styles.sectionTitle}>今日餐食</Text>
          <Pressable onPress={() => navigation.navigate('AnalyzeHistory')}>
            <Text style={styles.link}>识别历史</Text>
          </Pressable>
        </View>
        {(dashboard?.meals || []).length === 0 ? (
          <Text style={styles.empty}>今天还没有记录餐食，点击中间按钮开始记录。</Text>
        ) : (
          dashboard?.meals.map((meal) => (
            <Pressable
              key={`${meal.type}-${meal.time}`}
              style={styles.mealRow}
              onPress={() => meal.primary_record_id ? navigation.navigate('RecordDetail', { recordId: meal.primary_record_id }) : undefined}
            >
              <View>
                <Text style={styles.mealName}>{meal.name || getMealTypeLabel(meal.type)}</Text>
                <Text style={styles.mealMeta}>{getMealTypeLabel(meal.type)} · {meal.time}</Text>
              </View>
              <Text style={styles.mealKcal}>{Math.round(meal.calorie || 0)} kcal</Text>
            </Pressable>
          ))
        )}
      </Card>

      <Card>
        <View style={styles.rowBetween}>
          <Text style={styles.sectionTitle}>食物保质期</Text>
          <Pressable onPress={() => navigation.navigate('Expiry')}>
            <Text style={styles.link}>管理</Text>
          </Pressable>
        </View>
        <Text style={styles.subtitle}>
          {dashboard?.expirySummary
            ? `当前 ${dashboard.expirySummary.active_count ?? 0} 样，今日到期 ${dashboard.expirySummary.today_count ?? 0} 样`
            : '把牛奶、水果、剩菜记进来，快到期时会在这里提醒你。'}
        </Text>
      </Card>

      <AppButton label="刷新首页" variant="secondary" loading={loading} onPress={loadHome} />
      <AppButton label="健康档案与目标" variant="ghost" onPress={() => showPending('健康档案')} />
    </Page>
  )
}

function QuickCard({ title, value, onPress }: { title: string; value: string; onPress: () => void }) {
  return (
    <Pressable style={({ pressed }) => [styles.quickCard, pressed && styles.pressed]} onPress={onPress}>
      <Text style={styles.quickTitle}>{title}</Text>
      <Text style={styles.quickValue}>{value}</Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  error: {
    color: colors.danger,
    marginBottom: 12,
  },
  rowBetween: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: colors.text,
    marginBottom: 10,
  },
  link: {
    color: colors.brandDark,
    fontWeight: '700',
  },
  bigNumber: {
    fontSize: 32,
    fontWeight: '900',
    color: colors.brandDark,
  },
  subtitle: {
    color: colors.textSecondary,
    lineHeight: 20,
  },
  badge: {
    color: colors.warning,
    fontWeight: '800',
  },
  empty: {
    color: colors.textMuted,
  },
  quickGrid: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 16,
  },
  quickCard: {
    flex: 1,
    borderRadius: 18,
    padding: 14,
    backgroundColor: colors.surface,
  },
  pressed: {
    opacity: 0.75,
  },
  quickTitle: {
    color: colors.textSecondary,
    fontSize: 13,
  },
  quickValue: {
    marginTop: 8,
    color: colors.text,
    fontWeight: '800',
  },
  mealRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 13,
    borderTopWidth: 1,
    borderTopColor: '#eef2f7',
  },
  mealName: {
    color: colors.text,
    fontWeight: '800',
  },
  mealMeta: {
    color: colors.textSecondary,
    marginTop: 3,
  },
  mealKcal: {
    color: colors.brandDark,
    fontWeight: '800',
  },
})
