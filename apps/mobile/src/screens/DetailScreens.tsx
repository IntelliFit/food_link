import { useCallback, useEffect, useState } from 'react'
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native'
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { getMealTypeLabel, type AnalysisTask, type FoodRecord } from '@food-link/core'
import { apiClient } from '../api'
import { AppButton } from '../components/AppButton'
import { Card } from '../components/Card'
import { Page } from '../components/Page'
import type { RootStackParamList } from '../navigation/types'
import { colors } from '../theme'
import { formatDateTime, todayKey } from '../utils/date'

export function DayRecordScreen() {
  const route = useRoute<RouteProp<RootStackParamList, 'DayRecord'>>()
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  const date = route.params?.date || todayKey()
  const [records, setRecords] = useState<FoodRecord[]>([])
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await apiClient.getFoodRecordList(date)
      setRecords(data.records || [])
    } catch (error) {
      Alert.alert('获取记录失败', error instanceof Error ? error.message : '请稍后重试')
    } finally {
      setLoading(false)
    }
  }, [date])

  useEffect(() => {
    void load()
  }, [load])

  const totalKcal = records.reduce((sum, record) => sum + Number(record.total_calories || 0), 0)

  return (
    <Page title="单日记录" subtitle={date} refreshing={loading} onRefresh={load}>
      <Card>
        <Text style={styles.bigNumber}>{Math.round(totalKcal)} kcal</Text>
        <Text style={styles.subtitle}>共 {records.length} 条饮食记录</Text>
      </Card>
      {records.map((record) => (
        <Pressable key={record.id} onPress={() => navigation.navigate('RecordDetail', { recordId: record.id })}>
          <Card>
            <View style={styles.rowBetween}>
              <Text style={styles.sectionTitle}>{getMealTypeLabel(record.meal_type)}</Text>
              <Text style={styles.kcal}>{Math.round(record.total_calories || 0)} kcal</Text>
            </View>
            <Text style={styles.subtitle}>{record.description || record.items?.map((item) => item.name).join('、') || '饮食记录'}</Text>
          </Card>
        </Pressable>
      ))}
    </Page>
  )
}

export function RecordDetailScreen() {
  const route = useRoute<RouteProp<RootStackParamList, 'RecordDetail'>>()
  const [record, setRecord] = useState<FoodRecord | null>(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await apiClient.getFoodRecordById(route.params.recordId)
      setRecord(data.record)
    } catch (error) {
      Alert.alert('获取详情失败', error instanceof Error ? error.message : '请稍后重试')
    } finally {
      setLoading(false)
    }
  }, [route.params.recordId])

  useEffect(() => {
    void load()
  }, [load])

  const remove = async () => {
    try {
      await apiClient.deleteFoodRecord(route.params.recordId)
      Alert.alert('已删除', '记录已删除，返回后下拉刷新首页。')
    } catch (error) {
      Alert.alert('删除失败', error instanceof Error ? error.message : '请稍后重试')
    }
  }

  return (
    <Page title="记录详情" subtitle={record ? `${getMealTypeLabel(record.meal_type)} · ${formatDateTime(record.record_time)}` : '加载中'} refreshing={loading} onRefresh={load}>
      <Card>
        <Text style={styles.bigNumber}>{Math.round(record?.total_calories || 0)} kcal</Text>
        <Text style={styles.subtitle}>{record?.description || '饮食记录详情'}</Text>
        {(record?.items || []).map((item, index) => (
          <View key={`${item.name}-${index}`} style={styles.itemRow}>
            <Text style={styles.itemName}>{item.name}</Text>
            <Text style={styles.itemMeta}>{Math.round(item.weight || 0)}g · {Math.round(item.nutrients?.calories || 0)} kcal</Text>
          </View>
        ))}
        <AppButton label="删除记录" variant="secondary" onPress={remove} />
      </Card>
    </Page>
  )
}

export function AnalyzeHistoryScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  const [tasks, setTasks] = useState<AnalysisTask[]>([])
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await apiClient.listAnalyzeTasks({ limit: 50 })
      setTasks(data.tasks || [])
    } catch (error) {
      Alert.alert('获取识别历史失败', error instanceof Error ? error.message : '请稍后重试')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <Page title="识别历史" subtitle="查看近期分析任务。" refreshing={loading} onRefresh={load}>
      {tasks.map((task) => (
        <Pressable
          key={task.id}
          onPress={() => task.status === 'done' ? navigation.navigate('Result', {
            task,
            mealType: 'lunch',
            date: todayKey(),
          }) : navigation.navigate('AnalyzeLoading', {
            taskId: task.id,
            mealType: 'lunch',
            date: todayKey(),
          })}
        >
          <Card>
            <View style={styles.rowBetween}>
              <Text style={styles.sectionTitle}>{task.result?.items?.[0]?.name || '食物识别'}</Text>
              <Text style={styles.status}>{task.status}</Text>
            </View>
            <Text style={styles.subtitle}>{formatDateTime(task.created_at)} · {Math.round(task.result?.total_calories || 0)} kcal</Text>
          </Card>
        </Pressable>
      ))}
    </Page>
  )
}

export function NativePlaceholderScreen() {
  const route = useRoute<RouteProp<RootStackParamList, 'NativePlaceholder'>>()
  return (
    <Page title={route.params.title} subtitle="App 端页面骨架">
      <Card>
        <Text style={styles.sectionTitle}>{route.params.title}</Text>
        <Text style={styles.subtitle}>{route.params.description}</Text>
      </Card>
    </Page>
  )
}

export function TextRecordScreen() {
  return <NativePlaceholderScreenAdapter title="文字记录" description="小程序文字识别页入口已迁入 App。下一批会接入 /api/analyze-text/submit 的完整结果页。" />
}

export function ManualRecordScreen() {
  return <NativePlaceholderScreenAdapter title="手动记录" description="手动录入和公共食物库选择入口已保留，后续迁移食物搜索、重量和营养编辑表单。" />
}

export function FoodLibraryScreen() {
  return <NativePlaceholderScreenAdapter title="食物库" description="食物库列表、详情、收藏和分享页会作为独立 App 页面继续迁移。" />
}

export function HealthProfileScreen() {
  return <NativePlaceholderScreenAdapter title="健康档案" description="健康档案问卷、查看页和目标设置入口已预留，后续替换微信授权相关逻辑。" />
}

export function BodyMetricRecordScreen() {
  const route = useRoute<RouteProp<RootStackParamList, 'BodyMetricRecord'>>()
  const label = route.params.type === 'water' ? '喝水记录' : route.params.type === 'exercise' ? '运动记录' : '体重记录'
  return <NativePlaceholderScreenAdapter title={label} description="体重、喝水、运动的记录与趋势页已纳入 App 路由，后续补录入表单和趋势图。" />
}

export function ExpiryScreen() {
  return <NativePlaceholderScreenAdapter title="食物保质期" description="保质期列表、临期提醒和拍照识别入口已预留，App 推送通知需单独设计。" />
}

export function RewardCenterScreen() {
  return <NativePlaceholderScreenAdapter title="赚积分" description="积分任务和会员权益展示已预留。支付与订阅需要 App Store / Google Play 方案。" />
}

export function CirclePostEditScreen() {
  return <NativePlaceholderScreenAdapter title="发布动态" description="自定义图文动态入口已保留，后续迁移图片上传、草稿和营养信息表单。" />
}

export function FriendsScreen() {
  return <NativePlaceholderScreenAdapter title="好友" description="好友列表、搜索、邀请与私聊入口已纳入 App 路由，微信分享能力需替换为 App 链接。" />
}

export function NotificationsScreen() {
  return <NativePlaceholderScreenAdapter title="互动消息" description="点赞、评论、回复通知列表入口已保留，后续接入已读和跳转上下文。" />
}

function NativePlaceholderScreenAdapter({ title, description }: { title: string; description: string }) {
  return (
    <Page title={title} subtitle="App 端迁移中">
      <Card>
        <Text style={styles.sectionTitle}>{title}</Text>
        <Text style={styles.subtitle}>{description}</Text>
      </Card>
    </Page>
  )
}

const styles = StyleSheet.create({
  rowBetween: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '800',
    marginBottom: 8,
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
  kcal: {
    color: colors.brandDark,
    fontWeight: '900',
  },
  itemRow: {
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: '#eef2f7',
  },
  itemName: {
    color: colors.text,
    fontWeight: '800',
  },
  itemMeta: {
    marginTop: 3,
    color: colors.textSecondary,
  },
  status: {
    color: colors.warning,
    fontWeight: '800',
  },
})
