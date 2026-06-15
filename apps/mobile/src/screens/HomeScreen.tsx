import { useCallback } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useNavigation } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { getMealTypeLabel, inferDefaultMealTypeFromLocalTime } from '@food-link/core'
import { AppButton } from '../components/AppButton'
import { Card } from '../components/Card'
import { MacroRow } from '../components/MacroRow'
import { Page } from '../components/Page'
import { PetAvatar, petMoodLabel, petStateLabel } from '../components/PetAvatar'
import { SHOW_DEBUG_LOGIN } from '../config'
import { useHomeDashboard } from '../hooks/useHomeDashboard'
import type { RootStackParamList } from '../navigation/types'
import { colors } from '../theme'
import { formatShortDate } from '../utils/date'
import { createDemoAnalysisTask, demoFoodImageUrl } from '../utils/demoAnalysisTask'

export function HomeScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  const { recordDate, dashboard, petSummary, loading, error, loadHome } = useHomeDashboard()
  const mealType = inferDefaultMealTypeFromLocalTime()
  const pet = petSummary?.pet
  const petEvent = petSummary?.event?.can_claim ? petSummary.event : null
  const petMood = petMoodLabel(petSummary?.status?.mood)
  const petState = petStateLabel(petSummary?.status?.state)
  const showPetState = petState && !petMood.endsWith(petState)

  const startAnalyze = useCallback(() => {
    navigation.navigate('Analyze', { source: 'library', mealType, date: recordDate })
  }, [navigation, mealType, recordDate])

  const openDemoResult = useCallback(() => {
    navigation.navigate('Result', {
      task: createDemoAnalysisTask(),
      imageUri: demoFoodImageUrl,
      mealType,
      date: recordDate,
    })
  }, [navigation, mealType, recordDate])

  return (
    <Page
      title="首页"
      subtitle={`${formatShortDate(recordDate)} · 默认餐次 ${getMealTypeLabel(mealType)}`}
      refreshing={loading}
      onRefresh={loadHome}
    >
      {error ? <Text style={styles.error}>{error}</Text> : null}

      {petSummary ? (
        <Pressable style={({ pressed }) => pressed && styles.pressed} onPress={() => navigation.navigate('PetHome')}>
          <Card>
            <View style={styles.petCardRow}>
              <PetAvatar pet={pet} mood={petSummary.status?.mood} state={petSummary.status?.state} />
              <View style={styles.petMain}>
                <View style={styles.rowBetween}>
                  <Text style={styles.sectionTitle}>{pet?.name || '成长伙伴'}</Text>
                  {petEvent ? <Text style={styles.rewardBadge}>可领奖</Text> : null}
                </View>
                <Text style={styles.petLevel}>Lv.{pet?.level || 1} · 成长 {Math.round(pet?.level_progress || 0)}%</Text>
                <Text style={styles.subtitle}>{petSummary.status?.message || '记录一餐，开启今日成长。'}</Text>
                <View style={styles.petMetaRow}>
                  <Text style={styles.petMeta}>{petMood}</Text>
                  {showPetState ? <Text style={styles.petMeta}>{petState}</Text> : null}
                  <Text style={styles.petMeta}>习惯分 {petSummary.today?.habit_score || 0}</Text>
                </View>
              </View>
            </View>
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${Math.max(0, Math.min(100, pet?.level_progress || 0))}%` }]} />
            </View>
            <Text style={styles.petTask}>{petEvent?.message || petSummary.status?.task_text || '今天先记录一餐'}</Text>
          </Card>
        </Pressable>
      ) : null}

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
          <Text style={styles.sectionTitle}>记录餐食</Text>
          <Text style={styles.badge}>AI 分析</Text>
        </View>
        <View style={styles.actionGrid}>
          <ActionCard title="图片识别" onPress={startAnalyze} />
          <ActionCard title="文字记录" onPress={() => navigation.navigate('TextRecord')} />
          <ActionCard title="手动记录" onPress={() => navigation.navigate('ManualRecord')} />
        </View>
        {SHOW_DEBUG_LOGIN ? (
          <View style={styles.demoAction}>
            <AppButton label="示例识别结果" variant="secondary" onPress={openDemoResult} />
          </View>
        ) : null}
      </Card>

      <Card>
        <View style={styles.rowBetween}>
          <Text style={styles.sectionTitle}>今日餐食</Text>
          <Pressable onPress={() => navigation.navigate('AnalyzeHistory')}>
            <Text style={styles.link}>识别历史</Text>
          </Pressable>
        </View>
        {(dashboard?.meals || []).length === 0 ? (
          <Text style={styles.empty}>今天还没有记录餐食</Text>
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
            : '当前没有临期食物'}
        </Text>
      </Card>

      <AppButton label="刷新首页" variant="secondary" loading={loading} onPress={loadHome} />
      <AppButton label="健康档案与目标" variant="ghost" onPress={() => navigation.navigate('HealthProfile')} />
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

function ActionCard({ title, onPress }: { title: string; onPress: () => void }) {
  return (
    <Pressable style={({ pressed }) => [styles.actionCard, pressed && styles.pressed]} onPress={onPress}>
      <Text style={styles.actionTitle}>{title}</Text>
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
  petCardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  petMain: {
    flex: 1,
  },
  petLevel: {
    color: colors.brandDark,
    fontWeight: '800',
    marginBottom: 5,
  },
  rewardBadge: {
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 4,
    backgroundColor: '#fff7ed',
    color: colors.orange,
    fontSize: 12,
    fontWeight: '900',
  },
  petMetaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 7,
    marginTop: 10,
  },
  petMeta: {
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 4,
    backgroundColor: colors.surfaceMuted,
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '800',
  },
  progressTrack: {
    height: 9,
    borderRadius: 999,
    backgroundColor: colors.surfaceMuted,
    marginTop: 14,
    overflow: 'hidden',
  },
  progressFill: {
    height: 9,
    borderRadius: 999,
    backgroundColor: colors.brand,
  },
  petTask: {
    marginTop: 10,
    color: colors.textSecondary,
    lineHeight: 20,
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
  actionGrid: {
    flexDirection: 'row',
    gap: 10,
  },
  actionCard: {
    flex: 1,
    minHeight: 58,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.brandSoft,
    paddingHorizontal: 8,
  },
  actionTitle: {
    color: colors.brandDark,
    fontWeight: '900',
    textAlign: 'center',
  },
  demoAction: {
    marginTop: 12,
  },
  mealRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 13,
    borderTopWidth: 1,
    borderTopColor: colors.border,
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
