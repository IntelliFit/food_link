import AsyncStorage from '@react-native-async-storage/async-storage'
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { ActivityIndicator, Image, Linking, Pressable, Share, StyleSheet, Switch, Text, TextInput, View } from 'react-native'
import * as Clipboard from 'expo-clipboard'
import * as ImagePicker from 'expo-image-picker'
import { CommonActions, useFocusEffect, useNavigation, useRoute, type RouteProp } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import {
  getMealTypeLabel,
  inferDefaultMealTypeFromLocalTime,
  type AnalysisTask,
  type BodyMetricWeightEntry,
  type BodyMetricsSummary,
  type CommunityFeedTargetType,
  type CommunityNotificationItem,
  type ExerciseLogItem,
  type FoodExpiryDashboard,
  type FoodExpiryItem,
  type FoodRecord,
  type FoodRecordItemPayload,
  type FriendRequestItem,
  type FriendUserItem,
  type HealthProfile,
  type ManualFoodBrowseResult,
  type ManualFoodItem,
  type MealType,
  type Nutrients,
  type RewardCenterResponse,
} from '@food-link/core'
import { apiClient, clearRecentRequestTraces, getRecentRequestTraces, RECENT_REQUEST_TRACE_LIMIT } from '../api'
import { AppButton } from '../components/AppButton'
import { Card } from '../components/Card'
import { Page } from '../components/Page'
import { APP_VERSION } from '../config'
import { clearRecentConsoleLogs, CONSOLE_LOG_BUFFER_LIMIT, getRecentConsoleLogs } from '../diagnostics/consoleLogBuffer'
import type { RootStackParamList } from '../navigation/types'
import { useAppDialog } from '../providers/DialogProvider'
import { colors } from '../theme'
import { formatDateTime, todayKey } from '../utils/date'
import { userFacingErrorMessage, userFacingMessage } from '../utils/errors'

const userGroupQr = require('../../assets/community/foodlink-user-group-permanent-20260602.jpg')

const mealOptions: MealType[] = ['breakfast', 'morning_snack', 'lunch', 'afternoon_snack', 'dinner', 'evening_snack']
type NotificationTab = 'all' | 'like' | 'comment'
type FriendTab = 'friends' | 'received' | 'sent'
const notificationPageSize = 20
const commonTextFoods = ['米饭', '面条', '鸡蛋', '鸡胸肉', '苹果', '香蕉', '牛奶', '面包']
const healthGenderOptions = [
  { value: '', label: '暂不填写' },
  { value: 'female', label: '女' },
  { value: 'male', label: '男' },
  { value: 'other', label: '其他' },
] as const
const healthActivityOptions = [
  { value: '', label: '暂不填写' },
  { value: 'sedentary', label: '久坐办公' },
  { value: 'light', label: '日常走动' },
  { value: 'moderate', label: '经常运动' },
  { value: 'active', label: '体力劳动' },
  { value: 'very_active', label: '高强度' },
] as const
const healthDietGoalOptions = [
  { value: '', label: '暂不填写' },
  { value: 'fat_loss', label: '减脂' },
  { value: 'maintain', label: '保持' },
  { value: 'muscle_gain', label: '增肌' },
] as const
const expiryStorageOptions = [
  { value: 'refrigerated', label: '冷藏' },
  { value: 'room_temp', label: '常温' },
  { value: 'frozen', label: '冷冻' },
] as const
const waterPresets = [150, 250, 350, 500]
const exercisePresets = ['跑步30分钟', '游泳45分钟', '瑜伽1小时', '骑车20分钟', '健身40分钟', '跳绳15分钟', '散步45分钟', 'HIIT20分钟']
const CIRCLE_POST_MAX_IMAGES = 3
const FEEDBACK_MAX_IMAGES = 4
const OFFICIAL_EMAIL = 'jianwen_ma@stu.pku.edu.cn'
const SHOW_LEGACY_ABOUT_ON_FEEDBACK_PAGE = false
type FeedbackCategoryKey = 'bug' | 'suggestion' | 'experience' | 'other'

const feedbackCategoryOptions: Array<{ value: FeedbackCategoryKey; label: string; desc: string }> = [
  { value: 'bug', label: '问题反馈', desc: '页面异常、识别失败、数据不对' },
  { value: 'suggestion', label: '功能建议', desc: '想要的新功能或体验优化' },
  { value: 'experience', label: '使用体验', desc: '流程、文案、交互上的感受' },
  { value: 'other', label: '其他', desc: '其他想告诉我们的内容' },
]

type EditableRecordItem = {
  name: string
  weight: string
  ratio: string
  calories: string
  protein: string
  carbs: string
  fat: string
  fiber: string
  sugar: string
  waterMl: string
  sodiumMg: string
  source: FoodRecord['items'][number]
}
type AppDialog = ReturnType<typeof useAppDialog>

type SelectedManualFood = {
  key: string
  item: ManualFoodItem
  weight: string
}

const manualFoodSourceChannels = [
  { key: 'recommended', label: '推荐' },
  { key: 'campus', label: '校园食堂' },
  { key: 'favorites', label: '收藏' },
  { key: 'custom', label: '自定义' },
] as const

type ManualFoodSourceChannel = (typeof manualFoodSourceChannels)[number]['key']

const defaultExpireDate = () => {
  const nextWeek = new Date()
  nextWeek.setDate(nextWeek.getDate() + 7)
  return todayKey(nextWeek)
}

export function DayRecordScreen() {
  const route = useRoute<RouteProp<RootStackParamList, 'DayRecord'>>()
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  const dialog = useAppDialog()
  const date = route.params?.date || todayKey()
  const [records, setRecords] = useState<FoodRecord[]>([])
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await apiClient.getFoodRecordList(date)
      setRecords(data.records || [])
    } catch (error) {
      await showError(dialog, '获取记录失败', error)
    } finally {
      setLoading(false)
    }
  }, [date, dialog])

  useFocusEffect(
    useCallback(() => {
      void load()
    }, [load]),
  )

  const totalKcal = records.reduce((sum, record) => sum + Number(record.total_calories || 0), 0)
  const totalProtein = records.reduce((sum, record) => sum + Number(record.total_protein || 0), 0)
  const totalCarbs = records.reduce((sum, record) => sum + Number(record.total_carbs || 0), 0)
  const totalFat = records.reduce((sum, record) => sum + Number(record.total_fat || 0), 0)

  const shareDay = async () => {
    if (records.length === 0) {
      await dialog.alert('暂无可分享记录', '这一天还没有饮食记录。', 'warning')
      return
    }
    try {
      const result = await Share.share({
        title: `${date} 饮食记录`,
        message: buildDayShareMessage(date, records),
      })
      if (result.action === Share.dismissedAction) return
      const reward = await apiClient.claimSharePosterReward({ shareScope: 'daily_food', shareDate: date })
      await showShareRewardAlert(dialog, reward)
    } catch (error) {
      await showError(dialog, '分享失败', error)
    }
  }

  return (
    <Page title="单日记录" subtitle={date} refreshing={loading} onRefresh={load}>
      <Card>
        <Text style={styles.bigNumber}>{Math.round(totalKcal)} kcal</Text>
        <Text style={styles.subtitle}>共 {records.length} 条饮食记录</Text>
        <View style={styles.summaryGrid}>
          <SummaryCell title="蛋白质" value={round1(totalProtein)} unit="g" />
          <SummaryCell title="碳水" value={round1(totalCarbs)} unit="g" />
          <SummaryCell title="脂肪" value={round1(totalFat)} unit="g" />
          <SummaryCell title="记录数" value={records.length} unit="条" />
        </View>
        <View style={styles.buttonRow}>
          <SmallButton label="分享今日饮食" onPress={() => void shareDay()} disabled={records.length === 0} />
        </View>
      </Card>
      {records.length === 0 ? <EmptyState text="这天还没有饮食记录" /> : null}
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
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  const dialog = useAppDialog()
  const [record, setRecord] = useState<FoodRecord | null>(null)
  const [loading, setLoading] = useState(false)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [editMealType, setEditMealType] = useState<MealType>('lunch')
  const [editDescription, setEditDescription] = useState('')
  const [editItems, setEditItems] = useState<EditableRecordItem[]>([])

  const syncEditor = useCallback((next: FoodRecord) => {
    setEditMealType(next.meal_type)
    setEditDescription(next.description || '')
    setEditItems((next.items || []).map(editableRecordItemFromRow))
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await apiClient.getFoodRecordById(route.params.recordId)
      setRecord(data.record)
      if (!editing) syncEditor(data.record)
    } catch (error) {
      await showError(dialog, '获取详情失败', error)
    } finally {
      setLoading(false)
    }
  }, [dialog, editing, route.params.recordId, syncEditor])

  useFocusEffect(
    useCallback(() => {
      void load()
    }, [load]),
  )

  const imageUrls = recordImageUrls(record)
  const editTotals = useMemo(() => summarizeEditableRecordItems(editItems), [editItems])

  const shareRecord = async () => {
    if (!record) return
    try {
      const result = await Share.share({
        title: `${getMealTypeLabel(record.meal_type)}饮食记录`,
        message: buildRecordShareMessage(record),
      })
      if (result.action === Share.dismissedAction) return
      const reward = await apiClient.claimSharePosterReward({ recordId: record.id })
      await showShareRewardAlert(dialog, reward)
    } catch (error) {
      await showError(dialog, '分享失败', error)
    }
  }

  const openCommunityDetail = () => {
    if (!record) return
    navigation.navigate('CommunityFeedDetail', { targetId: record.id, targetType: 'food_record' })
  }

  const openEdit = () => {
    if (!record) return
    syncEditor(record)
    setEditing(true)
  }

  const updateEditItem = (index: number, patch: Partial<Omit<EditableRecordItem, 'source'>>) => {
    setEditItems((current) => current.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item)))
  }

  const removeEditItem = (index: number) => {
    if (editItems.length <= 1) {
      void dialog.alert('至少保留一个食物', '饮食记录需要保留一项食物明细。', 'warning')
      return
    }
    setEditItems((current) => current.filter((_, itemIndex) => itemIndex !== index))
  }

  const saveEdit = async () => {
    if (!record) return
    const items = editItems.map(editableRecordItemPayload)
    if (items.length === 0) {
      void dialog.alert('无法保存', '请至少保留一项食物明细。', 'warning')
      return
    }
    setSaving(true)
    try {
      const totals = summarizeEditableRecordItems(editItems)
      const data = await apiClient.updateFoodRecord(record.id, {
        meal_type: editMealType,
        description: editDescription.trim(),
        items,
        total_calories: totals.total_calories,
        total_protein: totals.total_protein,
        total_carbs: totals.total_carbs,
        total_fat: totals.total_fat,
        total_weight_grams: totals.total_weight_grams,
        image_path: record.image_path || undefined,
        image_paths: record.image_paths || undefined,
      })
      setRecord(data.record)
      syncEditor(data.record)
      setEditing(false)
      void dialog.alert('已保存', '记录已更新', 'success')
    } catch (error) {
      void dialog.alert('保存失败', userFacingErrorMessage(error), 'danger')
    } finally {
      setSaving(false)
    }
  }

  const remove = async () => {
    const confirmed = await dialog.confirm({
      title: '删除记录',
      message: '确定删除这条饮食记录吗？',
      kind: 'danger',
      cancelText: '取消',
      confirmText: '删除',
    })
    if (!confirmed) return

    try {
      await apiClient.deleteFoodRecord(route.params.recordId)
      await dialog.alert('已删除', '记录已删除', 'success')
      navigation.goBack()
    } catch (error) {
      void dialog.alert('删除失败', userFacingErrorMessage(error), 'danger')
    }
  }

  return (
    <Page
      title="记录详情"
      subtitle={record ? `${getMealTypeLabel(record.meal_type)} · ${formatDateTime(record.record_time)}` : undefined}
      refreshing={loading}
      onRefresh={load}
    >
      {!record ? <EmptyState text="暂无记录详情" /> : null}
      {record && !editing ? (
        <Card>
          <Text style={styles.bigNumber}>{Math.round(record.total_calories || 0)} kcal</Text>
          <Text style={styles.subtitle}>{record.description || '饮食记录详情'}</Text>
          {imageUrls.length ? (
            <View style={styles.recordImageGrid}>
              {imageUrls.map((url, index) => (
                <Image key={`${url}-${index}`} source={{ uri: url }} style={styles.recordImageThumb} resizeMode="cover" />
              ))}
            </View>
          ) : null}
          <View style={styles.summaryGrid}>
            <SummaryCell title="蛋白质" value={round1(record.total_protein || 0)} unit="g" />
            <SummaryCell title="碳水" value={round1(record.total_carbs || 0)} unit="g" />
            <SummaryCell title="脂肪" value={round1(record.total_fat || 0)} unit="g" />
            <SummaryCell title="摄入重量" value={round1(record.total_weight_grams || 0)} unit="g" />
          </View>
          {(record.items || []).map((item, index) => (
            <View key={`${item.name}-${index}`} style={styles.itemRow}>
              <View style={styles.rowBetween}>
                <Text style={styles.itemName}>{item.name}</Text>
                <Text style={styles.kcal}>{Math.round(recordItemKcal(item))} kcal</Text>
              </View>
              <Text style={styles.itemMeta}>
                {Math.round(recordItemIntake(item))}g · {Math.round(recordItemRatio(item))}% · 基准 {Math.round(item.weight || 0)}g
              </Text>
              <Text style={styles.notes}>
                蛋白 {round1(recordItemMacro(item, 'protein'))}g · 碳水 {round1(recordItemMacro(item, 'carbs'))}g · 脂肪 {round1(recordItemMacro(item, 'fat'))}g
              </Text>
            </View>
          ))}
          <View style={styles.buttonRow}>
            <SmallButton label="分享记录" onPress={() => void shareRecord()} />
            <SmallButton label="圈子详情" onPress={openCommunityDetail} />
            <SmallButton label="修改记录" onPress={openEdit} />
            <SmallButton label="删除记录" danger onPress={remove} />
          </View>
        </Card>
      ) : null}
      {record && editing ? (
        <Card>
          <Text style={styles.sectionTitle}>编辑记录</Text>
          <MealPicker value={editMealType} onChange={setEditMealType} />
          <Field label="记录描述" value={editDescription} onChangeText={setEditDescription} multiline placeholder="这餐吃了什么" />
          <View style={styles.summaryGrid}>
            <SummaryCell title="热量" value={round1(editTotals.total_calories)} unit="kcal" />
            <SummaryCell title="蛋白质" value={round1(editTotals.total_protein)} unit="g" />
            <SummaryCell title="碳水" value={round1(editTotals.total_carbs)} unit="g" />
            <SummaryCell title="脂肪" value={round1(editTotals.total_fat)} unit="g" />
          </View>
          {editItems.map((item, index) => (
            <View key={`${item.source.name}-${index}`} style={styles.editItemBox}>
              <View style={styles.rowBetween}>
                <Text style={styles.itemName}>食物 {index + 1}</Text>
                <SmallButton label="移除" danger onPress={() => removeEditItem(index)} />
              </View>
              <Field label="名称" value={item.name} onChangeText={(value) => updateEditItem(index, { name: value })} />
              <Field label="估算重量 g" value={item.weight} onChangeText={(value) => updateEditItem(index, { weight: value })} keyboardType="decimal-pad" />
              <Field label="摄入比例 %" value={item.ratio} onChangeText={(value) => updateEditItem(index, { ratio: value })} keyboardType="decimal-pad" />
              <View style={styles.ratioGrid}>
                {[25, 50, 75, 100].map((ratio) => (
                  <Pressable
                    key={ratio}
                    style={[styles.ratioButton, Math.round(editableItemRatio(item)) === ratio && styles.ratioButtonActive]}
                    onPress={() => updateEditItem(index, { ratio: String(ratio) })}
                  >
                    <Text style={[styles.ratioButtonText, Math.round(editableItemRatio(item)) === ratio && styles.ratioButtonTextActive]}>
                      {ratio}%
                    </Text>
                  </Pressable>
                ))}
              </View>
              <Text style={styles.itemMeta}>
                实际摄入 {round1(editableItemIntake(item))}g · 热量 {round1(editableItemScaledNutrient(item, 'calories'))} kcal
              </Text>
              <View style={styles.nutritionGrid}>
                <Field label="热量 kcal" value={item.calories} onChangeText={(value) => updateEditItem(index, { calories: value })} keyboardType="decimal-pad" />
                <Field label="蛋白质 g" value={item.protein} onChangeText={(value) => updateEditItem(index, { protein: value })} keyboardType="decimal-pad" />
                <Field label="碳水 g" value={item.carbs} onChangeText={(value) => updateEditItem(index, { carbs: value })} keyboardType="decimal-pad" />
                <Field label="脂肪 g" value={item.fat} onChangeText={(value) => updateEditItem(index, { fat: value })} keyboardType="decimal-pad" />
                <Field label="膳食纤维 g" value={item.fiber} onChangeText={(value) => updateEditItem(index, { fiber: value })} keyboardType="decimal-pad" />
                <Field label="糖 g" value={item.sugar} onChangeText={(value) => updateEditItem(index, { sugar: value })} keyboardType="decimal-pad" />
                <Field label="饮水 ml" value={item.waterMl} onChangeText={(value) => updateEditItem(index, { waterMl: value })} keyboardType="decimal-pad" />
                <Field label="钠 mg" value={item.sodiumMg} onChangeText={(value) => updateEditItem(index, { sodiumMg: value })} keyboardType="decimal-pad" />
              </View>
            </View>
          ))}
          <View style={styles.buttonRow}>
            <AppButton label="保存修改" loading={saving} onPress={saveEdit} />
            <AppButton label="取消" variant="secondary" onPress={() => setEditing(false)} />
          </View>
        </Card>
      ) : null}
    </Page>
  )
}

export function AnalyzeHistoryScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  const dialog = useAppDialog()
  const [tasks, setTasks] = useState<AnalysisTask[]>([])
  const [searchKeyword, setSearchKeyword] = useState('')
  const [loading, setLoading] = useState(false)
  const [retryingTaskId, setRetryingTaskId] = useState<string | null>(null)

  const load = useCallback(async (keyword = '') => {
    setLoading(true)
    try {
      const data = await apiClient.listAnalyzeTasks({ limit: 80, search: keyword })
      const visibleTasks = (data.tasks || [])
        .filter(isVisibleAnalyzeHistoryTask)
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      setTasks(visibleTasks)
    } catch (error) {
      await showError(dialog, '获取识别历史失败', error)
    } finally {
      setLoading(false)
    }
  }, [dialog])

  const refresh = useCallback(() => load(searchKeyword), [load, searchKeyword])

  const retryTask = useCallback(async (task: AnalysisTask) => {
    setRetryingTaskId(task.id)
    try {
      const result = await apiClient.retryAnalyzeTask(task.id)
      const nextTaskId = String(result.task_id || '').trim()
      if (!nextTaskId) {
        throw new Error('服务端未返回识别进度信息')
      }
      await load(searchKeyword)
      navigation.navigate('AnalyzeLoading', {
        taskId: nextTaskId,
        mealType: analyzeHistoryMealType(task),
        date: analyzeHistoryDate(task),
        taskType: isTextAnalysisTask(task) ? 'food_text' : 'food',
      })
    } catch (error) {
      await showError(dialog, '重新识别失败', error)
    } finally {
      setRetryingTaskId(null)
    }
  }, [dialog, load, navigation, searchKeyword])

  const confirmRetryTask = useCallback(async (task: AnalysisTask) => {
    const confirmed = await dialog.confirm({
      title: '重新识别',
      message: isTextAnalysisTask(task) ? '将使用这条记录的原文字内容重新识别。' : '将使用这条记录已上传的图片重新识别，不需要重新上传照片。',
      confirmText: '重新识别',
      cancelText: '取消',
    })
    if (confirmed) void retryTask(task)
  }, [dialog, retryTask])

  const openTask = useCallback((task: AnalysisTask) => {
    if (isPackagedAnalyzeHistoryTask(task)) {
      navigation.navigate('PackagedFoodTaskDetail', { taskId: task.id })
      return
    }
    const taskType = isTextAnalysisTask(task) ? 'food_text' : 'food'
    const mealType = analyzeHistoryMealType(task)
    const date = analyzeHistoryDate(task)
    if (task.status === 'done' && taskType === 'food_text') {
      navigation.navigate('TextResult', { task, mealType, date })
      return
    }
    if (task.status === 'done') {
      navigation.navigate('Result', { task, mealType, date })
      return
    }
    if (isAnalyzeRetryable(task)) {
      void confirmRetryTask(task)
      return
    }
    navigation.navigate('AnalyzeLoading', {
      taskId: task.id,
      mealType,
      date,
      taskType,
    })
  }, [confirmRetryTask, navigation])

  const submitSearch = () => {
    void load(searchKeyword)
  }

  const clearSearch = () => {
    setSearchKeyword('')
    void load('')
  }

  useEffect(() => {
    void load('')
  }, [load])

  return (
    <Page title="识别历史" subtitle="最近的图片和文字分析任务" refreshing={loading} onRefresh={refresh}>
      <Card>
        <Text style={styles.sectionTitle}>搜索识别记录</Text>
        <Text style={styles.subtitle}>可按食物名、文字描述或识别内容查找。</Text>
        <Field label="关键词" value={searchKeyword} onChangeText={setSearchKeyword} placeholder="例如：咖啡、米饭、晚餐" returnKeyType="search" onSubmitEditing={submitSearch} />
        <View style={styles.buttonRow}>
          <SmallButton label={loading ? '搜索中' : '搜索'} disabled={loading} onPress={submitSearch} />
          {searchKeyword.trim() ? <SmallButton label="清除" disabled={loading} onPress={clearSearch} /> : null}
        </View>
      </Card>
      {tasks.length === 0 ? <EmptyState text="暂无识别任务" /> : null}
      {tasks.map((task) => (
        <Pressable key={task.id} onPress={() => openTask(task)}>
          <Card>
            <View style={styles.historyTaskRow}>
              {analyzeHistoryImageUrl(task) ? (
                <Image source={{ uri: analyzeHistoryImageUrl(task) }} style={styles.historyTaskThumb} />
              ) : (
                <View style={styles.historyTaskThumbFallback}>
                  <Text style={styles.historyTaskThumbText}>{analyzeHistoryAvatarText(task)}</Text>
                </View>
              )}
              <View style={styles.flex}>
                <View style={styles.rowBetween}>
                  <Text style={styles.historyTaskTitle} numberOfLines={2}>{analyzeHistoryTitle(task)}</Text>
                  <Text style={styles.status}>{analyzeHistoryStatusLabel(task)}</Text>
                </View>
                <Text style={styles.subtitle}>{analyzeHistoryMeta(task)}</Text>
                <View style={styles.historyTaskTags}>
                  <Pill text={isTextAnalysisTask(task) ? '文字记录' : '图片识别'} />
                  <Pill text={getMealTypeLabel(analyzeHistoryMealType(task))} />
                  {task.is_recorded ? <Pill text="已记录" /> : null}
                </View>
              </View>
            </View>
            <View style={styles.buttonRow}>
              <SmallButton label={task.status === 'done' ? '查看结果' : isAnalyzeRetryable(task) ? '重新识别' : '查看进度'} disabled={retryingTaskId === task.id} onPress={() => openTask(task)} />
              {isAnalyzeRetryable(task) ? (
                <SmallButton label={retryingTaskId === task.id ? '提交中' : '用原内容重试'} disabled={retryingTaskId === task.id} onPress={() => void confirmRetryTask(task)} />
              ) : null}
            </View>
          </Card>
        </Pressable>
      ))}
    </Page>
  )
}

export function TextRecordScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  const dialog = useAppDialog()
  const [text, setText] = useState('')
  const [additionalContext, setAdditionalContext] = useState('')
  const [date, setDate] = useState(todayKey())
  const [mealType, setMealType] = useState<MealType>(inferDefaultMealTypeFromLocalTime())
  const [loading, setLoading] = useState(false)

  const submit = async () => {
    if (!text.trim()) {
      void dialog.alert('请输入食物描述', '可以先写下这餐吃了什么，例如“一碗米饭、番茄炒蛋”。', 'warning')
      return
    }
    setLoading(true)
    try {
      const data = await apiClient.submitTextTask({ text, additionalContext, mealType, date })
      navigation.navigate('AnalyzeLoading', { taskId: data.task_id, mealType, date, taskType: 'food_text' })
    } catch (error) {
      void dialog.alert('提交失败', userFacingErrorMessage(error), 'danger')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Page title="文字记录" subtitle="输入这餐吃了什么">
      <Card>
        <MealPicker value={mealType} onChange={setMealType} />
        <Field label="日期" value={date} onChangeText={setDate} />
        <Field
          label="食物描述"
          value={text}
          onChangeText={setText}
          multiline
          placeholder="例：一碗米饭、番茄炒蛋、半杯酸奶"
        />
        <View style={styles.textQuickTags}>
          <Text style={styles.textQuickTagsLabel}>常用</Text>
          <View style={styles.textQuickTagsRow}>
            {commonTextFoods.map((food) => (
              <Pressable
                key={food}
                style={styles.textQuickTag}
                onPress={() => setText((current) => (current.trim() ? `${current.trim()}、${food}` : food))}
              >
                <Text style={styles.textQuickTagText}>{food}</Text>
              </Pressable>
            ))}
          </View>
        </View>
        <Field
          label="份量/补充说明"
          value={additionalContext}
          onChangeText={setAdditionalContext}
          multiline
          placeholder="例：米饭约 200g，炒蛋用了一个鸡蛋，饮料少糖"
        />
        <AppButton label="提交分析" loading={loading} onPress={submit} />
      </Card>
    </Page>
  )
}

export function ManualRecordScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  const route = useRoute<RouteProp<RootStackParamList, 'ManualRecord'>>()
  const dialog = useAppDialog()
  const [browse, setBrowse] = useState<ManualFoodBrowseResult | null>(null)
  const [sourceChannel, setSourceChannel] = useState<ManualFoodSourceChannel>(route.params?.sourceChannel || 'recommended')
  const [catalogItems, setCatalogItems] = useState<ManualFoodItem[]>([])
  const [results, setResults] = useState<ManualFoodItem[]>([])
  const [selectedItems, setSelectedItems] = useState<SelectedManualFood[]>([])
  const [query, setQuery] = useState('')
  const [date, setDate] = useState(route.params?.date || todayKey())
  const [mealType, setMealType] = useState<MealType>(route.params?.mealType || inferDefaultMealTypeFromLocalTime())
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await apiClient.getManualFoodBrowse(20)
      setBrowse(data)
    } catch (error) {
      await showError(dialog, '获取食物库失败', error)
    } finally {
      setLoading(false)
    }
  }, [dialog])

  const loadCatalog = useCallback(async (category: ManualFoodSourceChannel) => {
    if (category === 'recommended') {
      setCatalogItems([])
      return
    }
    setLoading(true)
    try {
      const data = await apiClient.getManualFoodCatalog(category, { page: 1, pageSize: 30 })
      setCatalogItems(data.items || [])
    } catch (error) {
      await showError(dialog, '获取食物来源失败', error)
    } finally {
      setLoading(false)
    }
  }, [dialog])

  useFocusEffect(
    useCallback(() => {
      void load()
    }, [load]),
  )

  useEffect(() => {
    const quickItem = route.params?.quickItem
    if (!quickItem) return
    const key = manualFoodKey(quickItem)
    setSourceChannel(route.params?.sourceChannel || 'recommended')
    setResults([])
    setSelectedItems((current) => {
      if (current.some((entry) => entry.key === key)) return current
      return [
        ...current,
        {
          key,
          item: quickItem,
          weight: manualFoodQuantityInputValue(quickItem, numberFrom(quickItem.default_weight_grams, 100)),
        },
      ]
    })
  }, [route.params?.quickItem, route.params?.sourceChannel])

  useEffect(() => {
    setResults([])
    void loadCatalog(sourceChannel)
  }, [loadCatalog, sourceChannel])

  const refreshManualFoods = useCallback(async () => {
    await load()
    await loadCatalog(sourceChannel)
  }, [load, loadCatalog, sourceChannel])

  const search = async () => {
    const keyword = query.trim()
    if (!keyword) {
      setResults([])
      await loadCatalog(sourceChannel)
      return
    }
    setLoading(true)
    try {
      const data = await apiClient.searchManualFood(keyword, 30)
      setResults(data.results || [])
    } catch (error) {
      await showError(dialog, '搜索失败', error)
    } finally {
      setLoading(false)
    }
  }

  const addFood = (item: ManualFoodItem) => {
    const key = manualFoodKey(item)
    setSelectedItems((current) => {
      if (current.some((entry) => entry.key === key)) return current
      return [
        ...current,
        {
          key,
          item,
          weight: manualFoodQuantityInputValue(item, numberFrom(item.default_weight_grams, 100)),
        },
      ]
    })
  }

  const updateSelectedWeight = (key: string, nextWeight: string) => {
    setSelectedItems((current) => current.map((entry) => entry.key === key ? { ...entry, weight: nextWeight } : entry))
  }

  const adjustSelectedWeight = (key: string, delta: number) => {
    setSelectedItems((current) => current.map((entry) => {
      if (entry.key !== key) return entry
      const fallback = numberFrom(entry.item.default_weight_grams, 100)
      const next = Math.max(manualFoodMinQuantity(entry.item), numberFrom(entry.weight, fallback) + delta)
      return { ...entry, weight: manualFoodQuantityInputValue(entry.item, next) }
    }))
  }

  const applySelectedPreset = (key: string, ratio: number) => {
    setSelectedItems((current) => current.map((entry) => {
      if (entry.key !== key) return entry
      const baseWeight = numberFrom(entry.item.default_weight_grams, 100)
      const next = Math.max(manualFoodMinQuantity(entry.item), baseWeight * ratio)
      return { ...entry, weight: manualFoodQuantityInputValue(entry.item, next) }
    }))
  }

  const removeSelectedFood = (key: string) => {
    setSelectedItems((current) => current.filter((entry) => entry.key !== key))
  }

  const save = async () => {
    if (!selectedItems.length) {
      void dialog.alert('请选择食物', '先从下方搜索结果或推荐食物中添加到已选清单。', 'warning')
      return
    }
    const invalid = selectedItems.find((entry) => numberFrom(entry.weight) <= 0)
    if (invalid) {
      void dialog.alert('请检查份量', `请为「${manualFoodTitle(invalid.item)}」填写有效份量。`, 'warning')
      return
    }
    setLoading(true)
    try {
      const saved = await apiClient.saveManualFoodRecords({
        items: selectedItems.map((entry) => ({
          item: entry.item,
          weight: numberFrom(entry.weight, numberFrom(entry.item.default_weight_grams, 100)),
        })),
        mealType,
        date,
      })
      const message = `已将 ${selectedItems.length} 项食物写入${getMealTypeLabel(mealType)}。`
      if (!saved.id) {
        const result = await dialog.showDialog({
          title: '已保存',
          message,
          kind: 'success',
          confirmText: '回到首页',
        })
        if (result === 'confirm') {
          setSelectedItems([])
          navigation.dispatch(CommonActions.navigate('MainTabs'))
        }
        return
      }
      const result = await dialog.showDialog({
        title: '已保存',
        message,
        kind: 'success',
        cancelText: '回到首页',
        confirmText: '查看记录',
      })
      if (result === 'confirm') {
        setSelectedItems([])
        navigation.navigate('RecordDetail', { recordId: saved.id })
      } else if (result === 'cancel') {
        setSelectedItems([])
        navigation.dispatch(CommonActions.navigate('MainTabs'))
      }
    } catch (error) {
      void dialog.alert('保存失败', userFacingErrorMessage(error), 'danger')
    } finally {
      setLoading(false)
    }
  }

  const recommended = useMemo(() => flattenManualFoodBrowse(browse), [browse])
  const channelItems = sourceChannel === 'recommended' ? recommended : catalogItems
  const list = results.length ? results : channelItems
  const listTitle = results.length
    ? '搜索结果'
    : manualFoodSourceChannels.find((channel) => channel.key === sourceChannel)?.label || '推荐'
  const emptyText = sourceChannel === 'campus' ? '暂无校园食堂菜品' : '没有可选食物'
  const selectedKeys = useMemo(() => new Set(selectedItems.map((entry) => entry.key)), [selectedItems])
  const totals = useMemo(() => {
    return selectedItems.reduce((sum, entry) => {
      const quantity = numberFrom(entry.weight, numberFrom(entry.item.default_weight_grams, 100))
      const nutrients = scaledManualFoodNutrition(entry.item, quantity)
      const isPortionUnit = manualFoodUsesPortionUnit(entry.item)
      return {
        calories: sum.calories + nutrients.calories,
        protein: sum.protein + nutrients.protein,
        carbs: sum.carbs + nutrients.carbs,
        fat: sum.fat + nutrients.fat,
        weight: sum.weight + (isPortionUnit ? 0 : nutrients.weight),
        portions: sum.portions + (isPortionUnit ? quantity : 0),
      }
    }, { calories: 0, protein: 0, carbs: 0, fat: 0, weight: 0, portions: 0 })
  }, [selectedItems])
  const totalQuantityText = formatManualFoodTotalQuantity(totals)

  return (
    <Page title="手动记录" subtitle="从食物库多选后保存为一餐" refreshing={loading} onRefresh={refreshManualFoods}>
      <Card style={styles.manualHeroCard}>
        <View style={styles.rowBetween}>
          <View style={styles.flex}>
            <Text style={styles.sectionTitle}>单餐工作台</Text>
            <Text style={styles.subtitle}>{selectedItems.length ? `已选 ${selectedItems.length} 项 · ${totalQuantityText}` : '先选食物，再调整份量'}</Text>
          </View>
          <View style={styles.manualHeroKcal}>
            <Text style={styles.manualHeroKcalValue}>{Math.round(totals.calories)}</Text>
            <Text style={styles.manualHeroKcalUnit}>kcal</Text>
          </View>
        </View>
        <View style={styles.summaryGrid}>
          <SummaryCell title="蛋白质" value={round1(totals.protein)} unit="g" />
          <SummaryCell title="碳水" value={round1(totals.carbs)} unit="g" />
          <SummaryCell title="脂肪" value={round1(totals.fat)} unit="g" />
          <SummaryCell title="份量" value={totalQuantityText} unit="" />
        </View>
        <MealPicker value={mealType} onChange={setMealType} />
        <Field label="日期" value={date} onChangeText={setDate} />
      </Card>

      <Card>
        <Text style={styles.sectionTitle}>食物来源</Text>
        <View style={styles.segment}>
          {manualFoodSourceChannels.map((channel) => (
            <SegmentButton
              key={channel.key}
              label={channel.label}
              active={sourceChannel === channel.key}
              onPress={() => setSourceChannel(channel.key)}
            />
          ))}
        </View>
      </Card>

      <Card>
        <Field label="搜索食物" value={query} onChangeText={setQuery} placeholder="米饭、鸡蛋、牛奶" />
        <AppButton label="搜索" variant="secondary" loading={loading} onPress={search} />
      </Card>

      <Card>
        <View style={styles.rowBetween}>
          <Text style={styles.sectionTitle}>已选清单</Text>
          <Text style={styles.subtitle}>{selectedItems.length} 项</Text>
        </View>
        {selectedItems.length === 0 ? (
          <Text style={styles.empty}>点击下方食物卡片添加到这餐，选好后再保存为饮食记录。</Text>
        ) : (
          <>
            {selectedItems.map((entry) => (
              <SelectedManualFoodCard
                key={entry.key}
                entry={entry}
                onWeightChange={(value) => updateSelectedWeight(entry.key, value)}
                onAdjust={(delta) => adjustSelectedWeight(entry.key, delta)}
                onPreset={(ratio) => applySelectedPreset(entry.key, ratio)}
                onRemove={() => removeSelectedFood(entry.key)}
              />
            ))}
            <AppButton label="保存为饮食记录" loading={loading} onPress={save} />
          </>
        )}
      </Card>

      {list.length ? <Text style={styles.groupTitle}>{listTitle}</Text> : null}
      {list.length === 0 ? <EmptyState text={emptyText} /> : null}
      {list.map((item, index) => (
        <FoodChoice
          key={`${manualFoodTitle(item)}-${item.id || index}`}
          item={item}
          selected={selectedKeys.has(manualFoodKey(item))}
          onPress={() => addFood(item)}
        />
      ))}
    </Page>
  )
}

export function FoodLibraryScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  const dialog = useAppDialog()
  const [browse, setBrowse] = useState<ManualFoodBrowseResult | null>(null)
  const [customFoods, setCustomFoods] = useState<ManualFoodItem[]>([])
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<ManualFoodItem[]>([])
  const [name, setName] = useState('')
  const [calories, setCalories] = useState('')
  const [protein, setProtein] = useState('')
  const [carbs, setCarbs] = useState('')
  const [fat, setFat] = useState('')
  const [defaultWeight, setDefaultWeight] = useState('100')
  const [portionLabel, setPortionLabel] = useState('')
  const [imageUrls, setImageUrls] = useState('')
  const [fiber, setFiber] = useState('')
  const [sugar, setSugar] = useState('')
  const [sodiumMg, setSodiumMg] = useState('')
  const [shareToPublic, setShareToPublic] = useState(false)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [browseData, customData] = await Promise.all([
        apiClient.getManualFoodBrowse(24),
        apiClient.getCustomFoods(50).catch(() => ({ items: [] })),
      ])
      setBrowse(browseData)
      setCustomFoods(customData.items || [])
    } catch (error) {
      await dialog.alert('获取食物库失败', userFacingErrorMessage(error), 'danger')
    } finally {
      setLoading(false)
    }
  }, [dialog])

  useEffect(() => {
    void load()
  }, [load])

  const search = async () => {
    setLoading(true)
    try {
      const data = await apiClient.searchManualFood(query, 40)
      setResults(data.results || [])
    } catch (error) {
      await dialog.alert('搜索失败', userFacingErrorMessage(error), 'danger')
    } finally {
      setLoading(false)
    }
  }

  const saveCustom = async () => {
    const title = name.trim()
    const defaultWeightGrams = numberOrUndefined(defaultWeight) || 100
    const per100g = {
      calories: numberOrUndefined(calories) || 0,
      protein: numberOrUndefined(protein) || 0,
      carbs: numberOrUndefined(carbs) || 0,
      fat: numberOrUndefined(fat) || 0,
      fiber: numberOrUndefined(fiber) || 0,
      sugar: numberOrUndefined(sugar) || 0,
      sodium_mg: numberOrUndefined(sodiumMg) || 0,
    }
    const validationError = validateCustomFoodDraft(title, defaultWeightGrams, per100g)
    if (validationError) {
      await dialog.alert('请检查食物信息', validationError, 'warning')
      return
    }
    const imageList = splitImageUrls(imageUrls)
    const scale = defaultWeightGrams / 100
    setLoading(true)
    try {
      await apiClient.saveCustomFood({
        title,
        defaultWeightGrams,
        totalCalories: round1(per100g.calories * scale),
        totalProtein: round1(per100g.protein * scale),
        totalCarbs: round1(per100g.carbs * scale),
        totalFat: round1(per100g.fat * scale),
        nutrientsPer100g: per100g,
        extraNutrients: per100g,
        imagePath: imageList[0],
        imagePaths: imageList,
        portionLabel: portionLabel.trim() || `${Math.round(defaultWeightGrams)}g`,
        recommendReason: `自定义录入 / 每 100g`,
        shareToPublic,
      })
      setName('')
      setCalories('')
      setProtein('')
      setCarbs('')
      setFat('')
      setDefaultWeight('100')
      setPortionLabel('')
      setImageUrls('')
      setFiber('')
      setSugar('')
      setSodiumMg('')
      setShareToPublic(false)
      await load()
      await dialog.alert('已保存', shareToPublic ? '自定义食物已保存，并同步提交到公共库审核。' : '自定义食物已加入食物库。', 'success')
    } catch (error) {
      await dialog.alert('保存失败', userFacingErrorMessage(error), 'danger')
    } finally {
      setLoading(false)
    }
  }

  const openDetail = (item: ManualFoodItem) => {
    navigation.navigate('FoodLibraryDetail', {
      itemId: item.id ? String(item.id) : undefined,
      item,
    })
  }

  return (
    <Page title="食物库" subtitle="公共库、营养库和自定义食物" refreshing={loading} onRefresh={load}>
      <Card>
        <Field label="搜索" value={query} onChangeText={setQuery} placeholder="输入食物名称" />
        <AppButton label="搜索食物" variant="secondary" loading={loading} onPress={search} />
      </Card>

      <Card>
        <Text style={styles.sectionTitle}>添加自定义食物</Text>
        <Field label="名称" value={name} onChangeText={setName} />
        <Field label="默认份量 g" value={defaultWeight} onChangeText={setDefaultWeight} keyboardType="decimal-pad" />
        <Field label="份量说明" value={portionLabel} onChangeText={setPortionLabel} placeholder="例：一碗 180g，可留空" />
        <Field label="热量 kcal/100g" value={calories} onChangeText={setCalories} keyboardType="decimal-pad" />
        <Field label="蛋白质 g/100g" value={protein} onChangeText={setProtein} keyboardType="decimal-pad" />
        <Field label="碳水 g/100g" value={carbs} onChangeText={setCarbs} keyboardType="decimal-pad" />
        <Field label="脂肪 g/100g" value={fat} onChangeText={setFat} keyboardType="decimal-pad" />
        <Field label="膳食纤维 g/100g" value={fiber} onChangeText={setFiber} keyboardType="decimal-pad" />
        <Field label="糖 g/100g" value={sugar} onChangeText={setSugar} keyboardType="decimal-pad" />
        <Field label="钠 mg/100g" value={sodiumMg} onChangeText={setSodiumMg} keyboardType="decimal-pad" />
        <Field label="图片 URL" value={imageUrls} onChangeText={setImageUrls} multiline placeholder="每行一个图片地址，可留空" />
        <ToggleRow
          title="同步申请公开到公共库"
          subtitle="保存个人食物的同时提交审核，通过后其他用户可搜索使用。"
          value={shareToPublic}
          onValueChange={setShareToPublic}
        />
        <AppButton label="保存食物" loading={loading} onPress={saveCustom} />
      </Card>

      <SectionList title="搜索结果" items={results} onItemPress={openDetail} />
      <SectionList title="我的食物" items={customFoods} onItemPress={openDetail} />
      <SectionList title="推荐食物" items={flattenManualFoodBrowse(browse)} onItemPress={openDetail} />
    </Page>
  )
}

export function HealthProfileScreen() {
  const dialog = useAppDialog()
  const [profile, setProfile] = useState<HealthProfile | null>(null)
  const [height, setHeight] = useState('')
  const [weight, setWeight] = useState('')
  const [birthday, setBirthday] = useState('')
  const [gender, setGender] = useState('')
  const [activityLevel, setActivityLevel] = useState('')
  const [dietGoal, setDietGoal] = useState('')
  const [healthNotes, setHealthNotes] = useState('')
  const [calorieTarget, setCalorieTarget] = useState('')
  const [proteinTarget, setProteinTarget] = useState('')
  const [carbsTarget, setCarbsTarget] = useState('')
  const [fatTarget, setFatTarget] = useState('')
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [profileData, targets] = await Promise.all([
        apiClient.getHealthProfile(),
        apiClient.getDashboardTargets().catch((): Record<string, number> => ({})),
      ])
      setProfile(profileData)
      setHeight(stringFrom(profileData.height))
      setWeight(stringFrom(profileData.weight))
      setBirthday(stringFrom(profileData.birthday))
      setGender(stringFrom(profileData.gender))
      setActivityLevel(stringFrom(profileData.activity_level))
      setDietGoal(stringFrom(profileData.diet_goal))
      setHealthNotes(stringFrom(profileData.health_condition?.health_notes))
      setCalorieTarget(stringFrom(targets.calorie_target))
      setProteinTarget(stringFrom(targets.protein_target))
      setCarbsTarget(stringFrom(targets.carbs_target))
      setFatTarget(stringFrom(targets.fat_target))
    } catch (error) {
      await dialog.alert('获取健康档案失败', userFacingErrorMessage(error), 'danger')
    } finally {
      setLoading(false)
    }
  }, [dialog])

  useEffect(() => {
    void load()
  }, [load])

  const save = async () => {
    setLoading(true)
    try {
      await apiClient.updateHealthProfile({
        height: numberOrUndefined(height),
        weight: numberOrUndefined(weight),
        birthday: birthday.trim(),
        gender: gender.trim(),
        activity_level: activityLevel.trim(),
        diet_goal: dietGoal.trim(),
        health_notes: healthNotes.trim(),
      })
      if (calorieTarget || proteinTarget || carbsTarget || fatTarget) {
        await apiClient.updateDashboardTargets({
          calorie_target: Number(calorieTarget) || 0,
          protein_target: Number(proteinTarget) || 0,
          carbs_target: Number(carbsTarget) || 0,
          fat_target: Number(fatTarget) || 0,
          target_date: todayKey(),
        })
      }
      await load()
      await dialog.alert('已保存', '健康档案已更新', 'success')
    } catch (error) {
      await dialog.alert('保存失败', userFacingErrorMessage(error), 'danger')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Page title="健康档案" subtitle={profile ? '用于个性化分析和首页目标' : undefined} refreshing={loading} onRefresh={load}>
      <Card>
        <Text style={styles.sectionTitle}>基础信息</Text>
        <Field label="身高 cm" value={height} onChangeText={setHeight} keyboardType="decimal-pad" />
        <Field label="体重 kg" value={weight} onChangeText={setWeight} keyboardType="decimal-pad" />
        <Field label="生日 YYYY-MM-DD" value={birthday} onChangeText={setBirthday} />
        <OptionSegment title="性别" value={gender} options={healthGenderOptions} onChange={setGender} />
        <OptionSegment title="活动水平" value={activityLevel} options={healthActivityOptions} onChange={setActivityLevel} />
        <OptionSegment title="饮食目标" value={dietGoal} options={healthDietGoalOptions} onChange={setDietGoal} />
        <Field label="健康备注" value={healthNotes} onChangeText={setHealthNotes} multiline />
      </Card>
      <Card>
        <Text style={styles.sectionTitle}>首页目标</Text>
        <Field label="热量 kcal" value={calorieTarget} onChangeText={setCalorieTarget} keyboardType="decimal-pad" />
        <Field label="蛋白质 g" value={proteinTarget} onChangeText={setProteinTarget} keyboardType="decimal-pad" />
        <Field label="碳水 g" value={carbsTarget} onChangeText={setCarbsTarget} keyboardType="decimal-pad" />
        <Field label="脂肪 g" value={fatTarget} onChangeText={setFatTarget} keyboardType="decimal-pad" />
        <AppButton label="保存档案" loading={loading} onPress={save} />
      </Card>
    </Page>
  )
}

export function BodyMetricRecordScreen() {
  const route = useRoute<RouteProp<RootStackParamList, 'BodyMetricRecord'>>()
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  const dialog = useAppDialog()
  const type = route.params.type
  const [summary, setSummary] = useState<BodyMetricsSummary | null>(null)
  const [logs, setLogs] = useState<ExerciseLogItem[]>([])
  const [date, setDate] = useState(todayKey())
  const [value, setValue] = useState(type === 'water' ? '250' : '')
  const [exerciseDesc, setExerciseDesc] = useState('')
  const [exerciseImageUri, setExerciseImageUri] = useState('')
  const [exerciseImageUrl, setExerciseImageUrl] = useState('')
  const [exerciseTask, setExerciseTask] = useState<{ taskId: string; desc: string; status: string; errorMessage?: string } | null>(null)
  const [exercisePolling, setExercisePolling] = useState(false)
  const [loading, setLoading] = useState(false)
  const [mutatingId, setMutatingId] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const summaryData = await apiClient.getBodyMetricsSummary('month')
      setSummary(summaryData)
      if (type === 'exercise') {
        const logData = await apiClient.getExerciseLogs({ date })
        setLogs(logData.logs || [])
      }
    } catch (error) {
      await dialog.alert('获取身体记录失败', userFacingErrorMessage(error), 'danger')
    } finally {
      setLoading(false)
    }
  }, [date, dialog, type])

  useEffect(() => {
    void load()
  }, [load])

  const waterDay = useMemo(() => {
    const normalizedDate = date.slice(0, 10)
    const matched = summary?.water_daily?.find((item) => item.date === normalizedDate)
    if (matched) return matched
    if (summary?.today_water?.date === normalizedDate) return summary.today_water
    return null
  }, [date, summary])

  const waterLogs = useMemo(() => getWaterLogItems(waterDay), [waterDay])
  const weightEntries = useMemo(
    () => [...(summary?.weight_entries || [])]
      .filter((item) => item.date === date.slice(0, 10))
      .sort((a, b) => String(b.recorded_at || b.date).localeCompare(String(a.recorded_at || a.date))),
    [date, summary],
  )
  const currentWaterTotal = Math.round(waterDay?.total || 0)
  const waterGoal = summary?.water_goal_ml || 2000
  const waterRemaining = Math.max(0, waterGoal - currentWaterTotal)

  const save = async (overrideValue?: number) => {
    setLoading(true)
    try {
      if (type === 'weight') {
        const nextValue = Number(value)
        if (!Number.isFinite(nextValue) || nextValue < 20 || nextValue > 300) {
          await dialog.alert('体重范围不正确', '请输入 20-300kg 的体重', 'warning')
          return
        }
        await apiClient.saveBodyWeightRecord(nextValue, date, `weight-${date}-${Date.now()}`)
      } else if (type === 'water') {
        const amount = overrideValue ?? Number(value)
        if (!Number.isFinite(amount) || amount <= 0 || amount > 5000) {
          await dialog.alert('水量范围不正确', '请输入 1-5000ml', 'warning')
          return
        }
        await apiClient.addBodyWaterLog(Math.round(amount), date)
      } else {
        const result = await apiClient.createExerciseLog({ exerciseDesc, date, imageUrl: exerciseImageUrl })
        const taskId = String(result.task_id || result.taskId || '').trim()
        if (taskId) {
          const desc = exerciseDesc || '运动图片识别'
          setExerciseTask({ taskId, desc, status: 'pending' })
          void pollExerciseTask(taskId, desc)
        }
        setExerciseDesc('')
        setExerciseImageUri('')
        setExerciseImageUrl('')
      }
      await load()
      await dialog.alert(type === 'exercise' ? '已提交' : '已保存', type === 'exercise' ? '后台运动分析已提交，完成后会写入当天记录。' : '记录已更新', 'success')
    } catch (error) {
      await dialog.alert('保存失败', userFacingErrorMessage(error), 'danger')
    } finally {
      setLoading(false)
    }
  }

  const pollExerciseTask = async (taskId: string, desc: string) => {
    setExercisePolling(true)
    try {
      const started = Date.now()
      while (Date.now() - started < 90000) {
        await new Promise((resolve) => setTimeout(resolve, 2200))
        try {
          const task = await apiClient.getAnalyzeTask(taskId)
          if (task.status === 'done') {
            setExerciseTask({ taskId, desc, status: 'done' })
            await load()
            return
          }
          if (['failed', 'violated', 'timed_out', 'cancelled'].includes(task.status)) {
            setExerciseTask({ taskId, desc, status: 'failed', errorMessage: exerciseTaskError(task) })
            return
          }
          setExerciseTask({ taskId, desc, status: task.status || 'pending' })
        } catch (error) {
          setExerciseTask({ taskId, desc, status: 'failed', errorMessage: userFacingErrorMessage(error, '刷新结果失败') })
          return
        }
      }
      setExerciseTask({ taskId, desc, status: 'failed', errorMessage: '分析时间较长，请稍后手动刷新。' })
    } finally {
      setExercisePolling(false)
    }
  }

  const refreshExerciseTask = async () => {
    if (!exerciseTask?.taskId || exercisePolling) return
    await pollExerciseTask(exerciseTask.taskId, exerciseTask.desc)
  }

  const pickExerciseImage = async () => {
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync()
      if (!permission.granted) {
        await dialog.alert('无法访问相册', '请在系统设置中允许访问相册后再添加运动截图。', 'warning')
        return
      }
      const picked = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 0.86,
      })
      if (picked.canceled || !picked.assets[0]) return
      const asset = picked.assets[0]
      setExerciseImageUri(asset.uri)
      setLoading(true)
      const uploaded = await apiClient.uploadAnalyzeImageFile({
        fileUri: asset.uri,
        fileName: asset.fileName || 'exercise.jpg',
        mimeType: asset.mimeType || 'image/jpeg',
      })
      setExerciseImageUrl(uploaded.imageUrl)
    } catch (error) {
      await dialog.alert('上传运动截图失败', userFacingErrorMessage(error), 'danger')
    } finally {
      setLoading(false)
    }
  }

  const deleteWeight = async (recordId?: string) => {
    if (!recordId) {
      await dialog.alert('无法删除', '这条体重记录信息不完整，请刷新后重试。', 'warning')
      return
    }
    setMutatingId(recordId)
    try {
      await apiClient.deleteBodyWeightRecord(recordId)
      await load()
    } catch (error) {
      await dialog.alert('删除体重记录失败', userFacingErrorMessage(error), 'danger')
    } finally {
      setMutatingId('')
    }
  }

  const confirmDeleteWeight = async (entry: BodyMetricWeightEntry) => {
    const recordId = String(entry.id || '').trim()
    if (!recordId) {
      await dialog.alert('无法删除', '这条体重记录信息不完整，请刷新后重试。', 'warning')
      return
    }
    const confirmed = await dialog.confirm({
      title: '删除体重记录',
      message: `确定删除 ${entry.date} 的 ${entry.value}kg 吗？`,
      kind: 'danger',
      confirmText: '删除',
      cancelText: '取消',
    })
    if (confirmed) await deleteWeight(recordId)
  }

  const deleteWater = async (logId?: string) => {
    if (!logId) {
      await dialog.alert('无法删除', '这条喝水记录信息不完整，可刷新后重试，或使用清空当天。', 'warning')
      return
    }
    setMutatingId(logId)
    try {
      await apiClient.deleteBodyWaterLog(logId)
      await load()
    } catch (error) {
      await dialog.alert('删除喝水记录失败', userFacingErrorMessage(error), 'danger')
    } finally {
      setMutatingId('')
    }
  }

  const confirmDeleteWater = async (log: { id?: string; amount_ml: number }) => {
    const amount = Math.round(log.amount_ml || 0)
    const logId = String(log.id || '').trim()
    if (!logId) {
      await confirmResetWater('这条旧记录没有单次编号，只能清空当天喝水记录。')
      return
    }
    const confirmed = await dialog.confirm({
      title: '删除这次喝水',
      message: `确定删除 ${amount}ml 这次记录吗？`,
      kind: 'danger',
      confirmText: '删除',
      cancelText: '取消',
    })
    if (confirmed) await deleteWater(logId)
  }

  const resetWater = async () => {
    if (currentWaterTotal <= 0) return
    setMutatingId('water-reset')
    try {
      await apiClient.resetBodyWaterLogs(date)
      await load()
    } catch (error) {
      await dialog.alert('清空喝水记录失败', userFacingErrorMessage(error), 'danger')
    } finally {
      setMutatingId('')
    }
  }

  const confirmResetWater = async (prefix?: string) => {
    if (currentWaterTotal <= 0) return
    const confirmed = await dialog.confirm({
      title: '清空喝水记录',
      message: `${prefix ? `${prefix}\n\n` : ''}确定清空 ${date} 的 ${currentWaterTotal}ml 喝水记录吗？`,
      kind: 'danger',
      confirmText: '清空',
      cancelText: '取消',
    })
    if (confirmed) await resetWater()
  }

  const deleteExercise = async (logId: string) => {
    setMutatingId(logId)
    try {
      await apiClient.deleteExerciseLog(logId)
      await load()
    } catch (error) {
      await dialog.alert('删除运动记录失败', userFacingErrorMessage(error), 'danger')
    } finally {
      setMutatingId('')
    }
  }

  const confirmDeleteExercise = async (log: ExerciseLogItem) => {
    const logId = String(log.id || '').trim()
    if (!logId) {
      await dialog.alert('无法删除', '这条运动记录信息不完整，请刷新后重试。', 'warning')
      return
    }
    const desc = log.exercise_desc || log.exercise_type || '这条运动'
    const confirmed = await dialog.confirm({
      title: '删除运动记录',
      message: `确定删除「${desc}」吗？`,
      kind: 'danger',
      confirmText: '删除',
      cancelText: '取消',
    })
    if (confirmed) await deleteExercise(logId)
  }

  const title = type === 'water' ? '喝水记录' : type === 'exercise' ? '运动记录' : '体重记录'
  const trendKind = type === 'weight' ? 'weight' : type === 'water' ? 'water' : 'exercise'

  return (
    <Page title={title} subtitle="体重、喝水和运动同步到统计页" refreshing={loading} onRefresh={load}>
      <Card>
        <View style={styles.rowBetween}>
          <Text style={styles.sectionTitle}>记录日期</Text>
          <SmallButton label="查看趋势" onPress={() => navigation.navigate('TrendDetail', { kind: trendKind })} />
        </View>
        <Field label="日期" value={date} onChangeText={setDate} />
      </Card>

      {type === 'weight' ? (
        <>
          <Card>
            <Text style={styles.sectionTitle}>{date} 的体重</Text>
            <Field label="体重 kg" value={value} onChangeText={setValue} keyboardType="decimal-pad" />
            <AppButton label="保存体重" loading={loading} onPress={() => save()} />
            <Text style={styles.subtitle}>
              {summary?.latest_weight ? `最近一次 ${summary.latest_weight.value}kg` : '保存后会同步更新首页和健康档案体重'}
            </Text>
          </Card>
          <Card>
            <Text style={styles.sectionTitle}>当天记录</Text>
            {weightEntries.length === 0 ? <Text style={styles.empty}>这一天还没有体重记录</Text> : null}
            {weightEntries.map((entry) => (
              <View key={`${entry.id || entry.date}-${entry.recorded_at || entry.value}`} style={styles.logRow}>
                <View style={styles.flex}>
                  <Text style={styles.itemName}>{entry.value} kg</Text>
                  <Text style={styles.subtitle}>{formatDateTime(entry.recorded_at || entry.date)}</Text>
                </View>
                <SmallButton label={mutatingId === entry.id ? '删除中' : '删除'} danger onPress={() => void confirmDeleteWeight(entry)} />
              </View>
            ))}
          </Card>
        </>
      ) : null}

      {type === 'water' ? (
        <>
          <Card>
            <Text style={styles.sectionTitle}>今日进度</Text>
            <Text style={styles.bigNumber}>{currentWaterTotal} ml</Text>
            <Text style={styles.subtitle}>{waterRemaining > 0 ? `距离目标还差 ${waterRemaining}ml` : '这一天已达到喝水目标'}</Text>
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${Math.min(100, Math.round((currentWaterTotal / waterGoal) * 100))}%` }]} />
            </View>
          </Card>
          <Card>
            <Text style={styles.sectionTitle}>快捷加水</Text>
            <View style={styles.quickGrid}>
              {waterPresets.map((amount) => (
                <Pressable key={amount} style={styles.quickButton} onPress={() => void save(amount)}>
                  <Text style={styles.quickButtonText}>+{amount}ml</Text>
                </Pressable>
              ))}
            </View>
            <Field label="自定义水量 ml" value={value} onChangeText={setValue} keyboardType="decimal-pad" />
            <View style={styles.buttonRow}>
              <SmallButton label="添加" onPress={() => void save()} />
              <SmallButton label={mutatingId === 'water-reset' ? '清空中' : '清空当天'} danger onPress={() => void confirmResetWater()} />
            </View>
          </Card>
          <Card>
            <Text style={styles.sectionTitle}>当天明细</Text>
            {waterLogs.length === 0 ? <Text style={styles.empty}>这一天还没有喝水记录</Text> : null}
            <View style={styles.chipWrap}>
              {waterLogs.map((log, index) => {
                const logId = String(log.id || `fallback-${index}`)
                return (
                  <Pressable key={logId} style={styles.waterChip} onPress={() => void confirmDeleteWater(log)}>
                    <Text style={styles.waterChipText}>+{Math.round(log.amount_ml)}ml</Text>
                    <Text style={styles.waterChipDelete}>{log.id ? (mutatingId === log.id ? '删除中' : '删除') : '当天清空'}</Text>
                  </Pressable>
                )
              })}
            </View>
          </Card>
        </>
      ) : null}

      {type === 'exercise' ? (
        <>
          <Card>
            <Text style={styles.sectionTitle}>记录运动</Text>
            <View style={styles.quickGrid}>
              {exercisePresets.map((preset) => (
                <Pressable key={preset} style={styles.quickButton} onPress={() => setExerciseDesc(preset)}>
                  <Text style={styles.quickButtonText}>{preset}</Text>
                </Pressable>
              ))}
            </View>
            <Field label="运动内容" value={exerciseDesc} onChangeText={setExerciseDesc} placeholder="例：慢跑 30 分钟" multiline />
            {exerciseImageUri ? <Image source={{ uri: exerciseImageUri }} style={styles.previewImage} /> : null}
            <View style={styles.buttonRow}>
              <SmallButton label={exerciseImageUrl ? '更换截图' : '上传运动截图'} onPress={() => void pickExerciseImage()} />
              {exerciseImageUrl ? <SmallButton label="移除截图" danger onPress={() => { setExerciseImageUri(''); setExerciseImageUrl('') }} /> : null}
            </View>
            <AppButton label="保存运动" loading={loading} onPress={() => save()} />
          </Card>
          {exerciseTask ? (
            <Card>
              <View style={styles.exerciseTaskHeader}>
                <View style={styles.exerciseTaskTitleWrap}>
                  {isTaskRunningStatus(exerciseTask.status) || exercisePolling ? <ActivityIndicator size="small" color={colors.brand} /> : null}
                  <Text style={styles.sectionTitle}>后台运动分析</Text>
                </View>
                <Pill text={exerciseTaskStatusLabel(exerciseTask.status)} />
              </View>
              <Text style={styles.subtitle}>{exerciseTask.desc}</Text>
              <Text style={styles.notes}>{exerciseTaskMessage(exerciseTask.status)}</Text>
              {exerciseTask.errorMessage ? <Text style={styles.errorText}>{exerciseTask.errorMessage}</Text> : null}
              <View style={styles.buttonRow}>
                <SmallButton label={exercisePolling ? '刷新中' : '刷新结果'} disabled={exercisePolling} onPress={() => void refreshExerciseTask()} />
              </View>
            </Card>
          ) : null}
          {logs.length === 0 ? <EmptyState text="这一天还没有运动记录" /> : null}
          {logs.map((log) => (
            <Card key={log.id}>
              {log.image_url ? <Image source={{ uri: log.image_url }} style={styles.previewImage} /> : null}
              <View style={styles.rowBetween}>
                <View style={styles.flex}>
                  <Text style={styles.itemName}>{log.exercise_desc || log.exercise_type || '运动'}</Text>
                  <Text style={styles.subtitle}>{Math.round(log.calories_burned || 0)} kcal · {log.duration_min || 0} 分钟</Text>
                  {log.ai_reasoning ? <Text style={styles.notes}>{log.ai_reasoning}</Text> : null}
                </View>
                <SmallButton label={mutatingId === log.id ? '删除中' : '删除'} danger onPress={() => void confirmDeleteExercise(log)} />
              </View>
            </Card>
          ))}
        </>
      ) : null}

      <Card>
        <Text style={styles.sectionTitle}>本月概览</Text>
        <InfoRow label="最近体重" value={summary?.latest_weight ? `${summary.latest_weight.value} kg` : '--'} />
        <InfoRow label="今日喝水" value={`${Math.round(summary?.today_water?.total || 0)} ml`} />
        <InfoRow label="月均喝水" value={`${Math.round(summary?.avg_daily_water_ml || 0)} ml`} />
      </Card>
    </Page>
  )
}

export function ExpiryScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  const dialog = useAppDialog()
  const [dashboard, setDashboard] = useState<FoodExpiryDashboard | null>(null)
  const [items, setItems] = useState<FoodExpiryItem[]>([])
  const [foodName, setFoodName] = useState('')
  const [category, setCategory] = useState('')
  const [expireDate, setExpireDate] = useState(defaultExpireDate())
  const [quantityNote, setQuantityNote] = useState('')
  const [storageType, setStorageType] = useState('refrigerated')
  const [note, setNote] = useState('')
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [dashboardData, itemData] = await Promise.all([
        apiClient.getFoodExpiryDashboard(),
        apiClient.listFoodExpiryItems('active'),
      ])
      setDashboard(dashboardData)
      setItems(itemData.items || [])
    } catch (error) {
      await dialog.alert('获取保质期失败', userFacingErrorMessage(error), 'danger')
    } finally {
      setLoading(false)
    }
  }, [dialog])

  useEffect(() => {
    void load()
  }, [load])

  const create = async () => {
    setLoading(true)
    try {
      await apiClient.createFoodExpiryItem({ foodName, category, expireDate, quantityNote, storageType, note })
      setFoodName('')
      setCategory('')
      setQuantityNote('')
      setNote('')
      await load()
      await dialog.alert('已保存', '食物保质期已加入', 'success')
    } catch (error) {
      await dialog.alert('保存失败', userFacingErrorMessage(error), 'danger')
    } finally {
      setLoading(false)
    }
  }

  const updateStatus = async (itemId: string, status: 'consumed' | 'discarded') => {
    setLoading(true)
    try {
      await apiClient.updateFoodExpiryStatus(itemId, status)
      await load()
    } catch (error) {
      await dialog.alert('更新失败', userFacingErrorMessage(error), 'danger')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Page title="食物保质期" subtitle="管理冰箱和库存" refreshing={loading} onRefresh={load}>
      <View style={styles.statGrid}>
        <MiniStat title="进行中" value={dashboard?.active_count ?? 0} />
        <MiniStat title="今日到期" value={dashboard?.today_count ?? 0} />
        <MiniStat title="已过期" value={dashboard?.expired_count ?? 0} />
      </View>

      <Card>
        <Text style={styles.sectionTitle}>新增食物</Text>
        <Field label="食物名称" value={foodName} onChangeText={setFoodName} />
        <Field label="分类" value={category} onChangeText={setCategory} placeholder="乳制品、水果、熟食" />
        <Field label="到期日期" value={expireDate} onChangeText={setExpireDate} />
        <Field label="数量说明" value={quantityNote} onChangeText={setQuantityNote} />
        <OptionSegment title="储存方式" value={storageType} options={expiryStorageOptions} onChange={setStorageType} />
        <Field label="备注" value={note} onChangeText={setNote} multiline />
        <AppButton label="保存保质期" loading={loading} onPress={create} />
      </Card>

      {items.length === 0 ? <EmptyState text="暂无进行中的食物" /> : null}
      {items.map((item) => (
        <Card key={item.id}>
          <View style={styles.rowBetween}>
            <Text style={styles.sectionTitle}>{item.food_name}</Text>
            <Pill text={item.urgency_label || expiryStatusLabel(item.status)} />
          </View>
          <Text style={styles.subtitle}>{item.category || '未分类'} · {item.expire_date?.slice(0, 10)}</Text>
          <View style={styles.buttonRow}>
            <SmallButton label="编辑" onPress={() => navigation.navigate('ExpiryEdit', { itemId: item.id, item })} />
            <SmallButton label="已吃完" onPress={() => updateStatus(item.id, 'consumed')} />
            <SmallButton label="丢弃" danger onPress={() => updateStatus(item.id, 'discarded')} />
          </View>
        </Card>
      ))}
    </Page>
  )
}

export function RewardCenterScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  const dialog = useAppDialog()
  const [reward, setReward] = useState<RewardCenterResponse | null>(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setReward(await apiClient.getRewardCenter())
    } catch (error) {
      await showError(dialog, '获取积分失败', error)
    } finally {
      setLoading(false)
    }
  }, [dialog])

  useFocusEffect(
    useCallback(() => {
      void load()
    }, [load]),
  )

  const tasks = reward?.tasks || []
  const quickTasks = tasks.filter(isRewardTaskAvailable).slice(0, 2)

  return (
    <Page title="赚积分" subtitle="任务和可用积分" refreshing={loading} onRefresh={load}>
      <Card style={styles.rewardHero}>
        <Text style={styles.sectionTitle}>奖励积分</Text>
        <Text style={styles.subtitle}>把今天能拿的积分集中看清楚</Text>
        <View style={styles.summaryGrid}>
          <View style={styles.summaryCell}>
            <Text style={styles.summaryValue}>{reward?.earned_credits_balance ?? 0}</Text>
            <Text style={styles.summaryTitle}>当前余额</Text>
          </View>
          <View style={styles.summaryCell}>
            <Text style={styles.summaryValue}>{reward?.today_earned_credits ?? 0}</Text>
            <Text style={styles.summaryTitle}>今日已获得</Text>
          </View>
        </View>
        <Text style={styles.subtitle}>
          今日进度 {reward?.today_task_overview?.completed_count ?? 0}/{reward?.today_task_overview?.total_count ?? 0}
        </Text>
      </Card>

      {quickTasks.length ? (
        <Card>
          <Text style={styles.sectionTitle}>最快拿分</Text>
          {quickTasks.map((task) => (
            <Pressable key={rewardTaskKey(task)} style={styles.quickRewardRow} onPress={() => navigateRewardTask(navigation, task)}>
              <View style={styles.flex}>
                <Text style={styles.itemName}>{rewardTaskName(task)}</Text>
                <Text style={styles.subtitle}>{formatRewardTaskProgress(task)} · +{task.reward_amount} 积分</Text>
              </View>
              <Text style={styles.rewardActionText}>去完成</Text>
            </Pressable>
          ))}
        </Card>
      ) : null}

      {tasks.length === 0 ? <EmptyState text="暂无奖励任务" /> : null}
      {tasks.map((task) => (
        <Card key={rewardTaskKey(task)}>
          <View style={styles.rowBetween}>
            <View style={styles.flex}>
              <Text style={styles.itemName}>{rewardTaskName(task)}</Text>
              <Text style={styles.subtitle}>完成一次 +{task.reward_amount} 奖励积分</Text>
            </View>
            <Pill text={rewardTaskStatus(task)} />
          </View>
          <View style={styles.rewardProgressTrack}>
            <View style={[styles.rewardProgressFill, { width: `${rewardTaskPercent(task)}%` }]} />
          </View>
          <View style={styles.rowBetween}>
            <Text style={styles.itemMeta}>{formatRewardTaskProgress(task)}</Text>
            <Text style={styles.itemMeta}>{formatRewardTaskLimit(task)}</Text>
          </View>
          <Text style={styles.notes}>{rewardTaskHint(task)}</Text>
          <View style={styles.buttonRow}>
            <SmallButton
              label={isRewardTaskDisabled(task) ? '今日已满' : '去完成'}
              disabled={isRewardTaskDisabled(task) || !task.action_path}
              onPress={() => navigateRewardTask(navigation, task)}
            />
          </View>
        </Card>
      ))}
    </Page>
  )
}

export function CirclePostEditScreen() {
  const route = useRoute<RouteProp<RootStackParamList, 'CirclePostEdit'>>()
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  const dialog = useAppDialog()
  const postId = route.params?.postId
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [imageUrls, setImageUrls] = useState<string[]>([])
  const [calories, setCalories] = useState('')
  const [protein, setProtein] = useState('')
  const [carbs, setCarbs] = useState('')
  const [fat, setFat] = useState('')
  const [fiber, setFiber] = useState('')
  const [sugar, setSugar] = useState('')
  const [sodiumMg, setSodiumMg] = useState('')
  const [totalWeightGrams, setTotalWeightGrams] = useState('')
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    if (!postId) return
    setLoading(true)
    try {
      const data = await apiClient.communityGetContext(postId, 'circle_post')
      const record = (data.item.record || {}) as unknown as Record<string, unknown>
      setTitle(stringFrom(record.title))
      setBody(stringFrom(record.body || record.description))
      const images = Array.isArray(record.image_paths) ? record.image_paths.map(stringFrom).filter(Boolean) : []
      setImageUrls(images.slice(0, CIRCLE_POST_MAX_IMAGES))
      setCalories(numberField(record.total_calories))
      setProtein(numberField(record.total_protein))
      setCarbs(numberField(record.total_carbs))
      setFat(numberField(record.total_fat))
      setFiber(numberField(record.fiber))
      setSugar(numberField(record.sugar))
      setSodiumMg(numberField(record.sodium_mg))
      setTotalWeightGrams(numberField(record.total_weight_grams))
    } catch (error) {
      await dialog.alert('加载动态失败', userFacingErrorMessage(error), 'danger')
    } finally {
      setLoading(false)
    }
  }, [dialog, postId])

  useEffect(() => {
    void load()
  }, [load])

  const pickImages = async () => {
    const remaining = CIRCLE_POST_MAX_IMAGES - imageUrls.length
    if (remaining <= 0) {
      await dialog.alert('图片已满', `最多上传 ${CIRCLE_POST_MAX_IMAGES} 张图片。`, 'warning')
      return
    }
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (!permission.granted) {
      await dialog.alert('需要相册权限', '请选择动态图片。', 'warning')
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
        const data = await apiClient.uploadCirclePostImageFile({
          fileUri: asset.uri,
          fileName: asset.fileName || 'circle-post.jpg',
          mimeType: asset.mimeType || 'image/jpeg',
        })
        uploaded.push(data.imageUrl)
      }
      setImageUrls((current) => [...current, ...uploaded].slice(0, CIRCLE_POST_MAX_IMAGES))
    } catch (error) {
      await dialog.alert('上传动态图片失败', userFacingErrorMessage(error), 'danger')
    } finally {
      setLoading(false)
    }
  }

  const removeImage = (index: number) => {
    setImageUrls((current) => current.filter((_, itemIndex) => itemIndex !== index))
  }

  const submit = async () => {
    setLoading(true)
    try {
      const input = {
        title,
        body,
        imageUrls,
        nutrition: {
          total_calories: numberOrUndefined(calories),
          total_protein: numberOrUndefined(protein),
          total_carbs: numberOrUndefined(carbs),
          total_fat: numberOrUndefined(fat),
          fiber: numberOrUndefined(fiber),
          sugar: numberOrUndefined(sugar),
          sodium_mg: numberOrUndefined(sodiumMg),
          total_weight_grams: numberOrUndefined(totalWeightGrams),
        },
      }
      if (postId) await apiClient.updateCirclePost(postId, input)
      else await apiClient.createCirclePost(input)
      await dialog.alert(postId ? '已保存' : '已发布', postId ? '动态修改已保存' : '动态已发布到圈子', 'success')
      navigation.goBack()
    } catch (error) {
      await dialog.alert(postId ? '保存失败' : '发布失败', userFacingErrorMessage(error), 'danger')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Page title={postId ? '编辑动态' : '发布动态'} subtitle="图文动态和营养信息" refreshing={loading} onRefresh={load}>
      <Card>
        <Field label="标题" value={title} onChangeText={setTitle} />
        <Field label="正文" value={body} onChangeText={setBody} multiline />
        <CircleImagePickerGrid urls={imageUrls} loading={loading} onAdd={pickImages} onRemove={removeImage} />
      </Card>
      <Card>
        <Text style={styles.sectionTitle}>营养信息</Text>
        <Field label="热量 kcal" value={calories} onChangeText={setCalories} keyboardType="decimal-pad" />
        <Field label="蛋白质 g" value={protein} onChangeText={setProtein} keyboardType="decimal-pad" />
        <Field label="碳水 g" value={carbs} onChangeText={setCarbs} keyboardType="decimal-pad" />
        <Field label="脂肪 g" value={fat} onChangeText={setFat} keyboardType="decimal-pad" />
        <Field label="膳食纤维 g" value={fiber} onChangeText={setFiber} keyboardType="decimal-pad" />
        <Field label="糖 g" value={sugar} onChangeText={setSugar} keyboardType="decimal-pad" />
        <Field label="钠 mg" value={sodiumMg} onChangeText={setSodiumMg} keyboardType="decimal-pad" />
        <Field label="总重量 g" value={totalWeightGrams} onChangeText={setTotalWeightGrams} keyboardType="decimal-pad" />
        <AppButton label={postId ? '保存修改' : '发布'} loading={loading} onPress={submit} />
      </Card>
    </Page>
  )
}

export function FriendsScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  const dialog = useAppDialog()
  const [activeTab, setActiveTab] = useState<FriendTab>('friends')
  const [friends, setFriends] = useState<FriendUserItem[]>([])
  const [received, setReceived] = useState<FriendRequestItem[]>([])
  const [sent, setSent] = useState<FriendRequestItem[]>([])
  const [friendQuery, setFriendQuery] = useState('')
  const [userQuery, setUserQuery] = useState('')
  const [results, setResults] = useState<FriendUserItem[]>([])
  const [loading, setLoading] = useState(false)
  const [searching, setSearching] = useState(false)
  const [mutatingId, setMutatingId] = useState<string | null>(null)

  const receivedPendingCount = useMemo(
    () => received.filter((item) => friendRequestStatus(item) === 'pending').length,
    [received],
  )
  const sentPendingCount = useMemo(
    () => sent.filter((item) => friendRequestStatus(item) === 'pending').length,
    [sent],
  )
  const filteredFriends = useMemo(() => {
    const q = friendQuery.trim().toLowerCase()
    if (!q) return friends
    return friends.filter((friend) => friendDisplayName(friend).toLowerCase().includes(q))
  }, [friendQuery, friends])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [friendData, requestData] = await Promise.all([
        apiClient.listFriends(),
        apiClient.getFriendRequestsOverview().catch(() => ({ received: [], sent: [] })),
      ])
      setFriends(friendData.list || [])
      setReceived(requestData.received || [])
      setSent(requestData.sent || [])
    } catch (error) {
      await showError(dialog, '获取好友失败', error)
    } finally {
      setLoading(false)
    }
  }, [dialog])

  useFocusEffect(useCallback(() => {
    void load()
  }, [load]))

  const openProfile = (userId?: string) => {
    const id = String(userId || '').trim()
    if (id) navigation.navigate('ProfileSettings', { userId: id })
  }

  const openChat = (user: FriendUserItem) => {
    const id = friendUserId(user)
    if (id) navigation.navigate('PrivateChat', { userId: id, nickname: friendDisplayName(user) })
  }

  const search = async () => {
    const q = userQuery.trim()
    if (!q) {
      setResults([])
      await dialog.alert('请输入昵称', '可以输入好友昵称或用户 ID 进行搜索。', 'warning')
      return
    }
    setSearching(true)
    try {
      const data = await apiClient.searchFriends(q)
      setResults(data.list || [])
    } catch (error) {
      await showError(dialog, '搜索失败', error)
    } finally {
      setSearching(false)
    }
  }

  const send = async (id: string) => {
    const key = `send:${id}`
    setMutatingId(key)
    try {
      await apiClient.sendFriendRequest(id)
      setResults((prev) => prev.map((user) => friendUserId(user) === id ? { ...user, is_pending: true } : user))
      await load()
      await dialog.alert('已发送', '好友请求已发送', 'success')
    } catch (error) {
      await showError(dialog, '发送失败', error)
    } finally {
      setMutatingId(null)
    }
  }

  const respond = async (request: FriendRequestItem, action: 'accept' | 'reject') => {
    if (friendRequestStatus(request) !== 'pending') return
    const key = `${action}:${request.id}`
    setMutatingId(key)
    try {
      await apiClient.respondFriendRequest(request.id, action)
      await load()
      await dialog.alert(action === 'accept' ? '已添加好友' : '已拒绝', undefined, 'success')
    } catch (error) {
      await showError(dialog, '处理失败', error)
    } finally {
      setMutatingId(null)
    }
  }

  const confirmDeleteFriend = async (friend: FriendUserItem) => {
    const id = friendUserId(friend)
    if (!id) return
    const confirmed = await dialog.confirm({
      title: '删除好友',
      message: `确定删除好友「${friendDisplayName(friend)}」吗？删除后需要重新添加。`,
      kind: 'danger',
      confirmText: '删除',
      cancelText: '取消',
    })
    if (confirmed) void deleteFriend(friend)
  }

  const deleteFriend = async (friend: FriendUserItem) => {
    const id = friendUserId(friend)
    if (!id) return
    setMutatingId(`delete:${id}`)
    try {
      await apiClient.deleteFriend(id)
      await load()
      await dialog.alert('已删除', undefined, 'success')
    } catch (error) {
      await showError(dialog, '删除失败', error)
    } finally {
      setMutatingId(null)
    }
  }

  const confirmCancelSent = async (request: FriendRequestItem) => {
    if (friendRequestStatus(request) !== 'pending') return
    const confirmed = await dialog.confirm({
      title: '撤销申请',
      message: `确定撤销对「${friendRequestDisplayName(request)}」的好友申请吗？`,
      kind: 'danger',
      confirmText: '撤销',
      cancelText: '保留',
    })
    if (confirmed) void cancelSent(request)
  }

  const cancelSent = async (request: FriendRequestItem) => {
    setMutatingId(`cancel:${request.id}`)
    try {
      await apiClient.cancelSentFriendRequest(request.id)
      await load()
      await dialog.alert('已撤销', undefined, 'success')
    } catch (error) {
      await showError(dialog, '撤销失败', error)
    } finally {
      setMutatingId(null)
    }
  }

  const renderFriends = () => (
    <>
      <Card>
        <Field label="搜索好友" value={friendQuery} onChangeText={setFriendQuery} placeholder="输入好友昵称" />
        {friendQuery.trim() ? <SmallButton label="清除" onPress={() => setFriendQuery('')} /> : null}
      </Card>

      {loading && friends.length === 0 ? (
        <Card>
          <ActivityIndicator color={colors.brand} />
        </Card>
      ) : null}
      {!loading && friends.length === 0 ? <EmptyState text="还没有好友" /> : null}
      {!loading && friends.length > 0 && filteredFriends.length === 0 ? <EmptyState text="未找到好友" /> : null}
      {filteredFriends.map((friend) => {
        const id = friendUserId(friend)
        return (
          <FriendUserCard
            key={id || friendDisplayName(friend)}
            user={friend}
            subtitle="已互为好友"
            onPress={() => openProfile(id)}
            actions={(
              <>
                <SmallButton label="私信" onPress={() => openChat(friend)} />
                <SmallButton label="删除" danger disabled={mutatingId === `delete:${id}`} onPress={() => void confirmDeleteFriend(friend)} />
              </>
            )}
          />
        )
      })}

      <Card>
        <Text style={styles.sectionTitle}>查找新朋友</Text>
        <Text style={styles.subtitle}>按昵称搜索用户，发送好友申请后可在「我发起的」查看状态。</Text>
        <Field label="用户昵称" value={userQuery} onChangeText={setUserQuery} placeholder="输入对方昵称" />
        <AppButton label="搜索用户" variant="secondary" loading={searching} onPress={search} />
      </Card>
      {results.map((user) => {
        const id = friendUserId(user)
        const already = Boolean(user.is_friend)
        const pending = Boolean(user.is_pending)
        return (
          <FriendUserCard
            key={id || friendDisplayName(user)}
            user={user}
            subtitle={friendUserSubtitle(user)}
            onPress={() => openProfile(id)}
            actions={(
              <SmallButton
                label={already ? '已是好友' : pending ? '已申请' : '添加'}
                disabled={already || pending || mutatingId === `send:${id}`}
                onPress={() => id ? void send(id) : undefined}
              />
            )}
          />
        )
      })}
      {!searching && userQuery.trim() && results.length === 0 ? <Text style={styles.listEndText}>没有匹配用户</Text> : null}
    </>
  )

  const renderReceived = () => (
    <>
      {loading && received.length === 0 ? (
        <Card>
          <ActivityIndicator color={colors.brand} />
        </Card>
      ) : null}
      {!loading && received.length === 0 ? <EmptyState text="暂无好友请求" /> : null}
      {received.map((request) => {
        const userId = friendRequestUserId(request)
        const pending = friendRequestStatus(request) === 'pending'
        return (
          <FriendRequestCard
            key={request.id}
            request={request}
            onPress={() => openProfile(userId)}
            actions={pending ? (
              <>
                <SmallButton label="接受" disabled={mutatingId === `accept:${request.id}`} onPress={() => void respond(request, 'accept')} />
                <SmallButton label="拒绝" danger disabled={mutatingId === `reject:${request.id}`} onPress={() => void respond(request, 'reject')} />
              </>
            ) : (
              <Pill text={friendRequestStatusLabel(request.status)} />
            )}
          />
        )
      })}
    </>
  )

  const renderSent = () => (
    <>
      {loading && sent.length === 0 ? (
        <Card>
          <ActivityIndicator color={colors.brand} />
        </Card>
      ) : null}
      {!loading && sent.length === 0 ? <EmptyState text="没有待处理的申请" /> : null}
      {sent.map((request) => {
        const userId = friendRequestUserId(request)
        const pending = friendRequestStatus(request) === 'pending'
        return (
          <FriendRequestCard
            key={request.id}
            request={request}
            onPress={() => openProfile(userId)}
            actions={pending ? (
              <SmallButton label="撤销申请" danger disabled={mutatingId === `cancel:${request.id}`} onPress={() => void confirmCancelSent(request)} />
            ) : (
              <Pill text={friendRequestStatusLabel(request.status)} />
            )}
          />
        )
      })}
    </>
  )

  return (
    <Page title="好友" subtitle={`${friends.length} 位好友 · ${receivedPendingCount} 条待处理`} refreshing={loading} onRefresh={load}>
      <Card>
        <View style={styles.rowBetween}>
          <View style={styles.flex}>
            <Text style={styles.sectionTitle}>好友管理</Text>
            <Text style={styles.subtitle}>查看好友、处理申请，并从这里进入主页或私信。</Text>
          </View>
        </View>
        <View style={styles.notificationTabs}>
          <NotificationTabButton label="好友列表" badge={friends.length} active={activeTab === 'friends'} onPress={() => setActiveTab('friends')} />
          <NotificationTabButton label="收到请求" badge={receivedPendingCount} active={activeTab === 'received'} onPress={() => setActiveTab('received')} />
          <NotificationTabButton label="我发起的" badge={sentPendingCount} active={activeTab === 'sent'} onPress={() => setActiveTab('sent')} />
        </View>
      </Card>
      {activeTab === 'friends' ? renderFriends() : null}
      {activeTab === 'received' ? renderReceived() : null}
      {activeTab === 'sent' ? renderSent() : null}
    </Page>
  )
}
export function NotificationsScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  const dialog = useAppDialog()
  const [notifications, setNotifications] = useState<CommunityNotificationItem[]>([])
  const [unread, setUnread] = useState(0)
  const [activeTab, setActiveTab] = useState<NotificationTab>('all')
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)

  const visibleNotifications = useMemo(
    () => notifications.filter((item) => notificationMatchesTab(item, activeTab)),
    [activeTab, notifications],
  )
  const likeCount = useMemo(() => notifications.filter((item) => notificationMatchesTab(item, 'like')).length, [notifications])
  const commentCount = useMemo(() => notifications.filter((item) => notificationMatchesTab(item, 'comment')).length, [notifications])

  const load = useCallback(async (tab: NotificationTab, offset = 0, append = false) => {
    if (append) {
      setLoadingMore(true)
    } else {
      setLoading(true)
    }
    try {
      const data = await apiClient.listCommunityNotifications({
        limit: notificationPageSize,
        offset,
        type: notificationTabApiType(tab),
      })
      let nextList = data.list || []
      let nextUnread = data.unread_count || 0
      if (!append && nextUnread > 0) {
        const readResult = await apiClient.markCommunityNotificationsRead()
        nextUnread = readResult.unread_count || 0
        nextList = nextList.map((item) => ({ ...item, is_read: true }))
      }
      setNotifications((prev) => append ? [...prev, ...nextList] : nextList)
      setUnread(nextUnread)
      setHasMore(Boolean(data.has_more))
    } catch (error) {
      await showError(dialog, '获取互动消息失败', error)
    } finally {
      if (append) {
        setLoadingMore(false)
      } else {
        setLoading(false)
      }
    }
  }, [dialog])

  useEffect(() => {
    void load(activeTab, 0, false)
  }, [activeTab, load])

  const refresh = useCallback(() => {
    void load(activeTab, 0, false)
  }, [activeTab, load])

  const switchTab = (tab: NotificationTab) => {
    if (tab === activeTab) return
    setActiveTab(tab)
    setNotifications([])
    setHasMore(false)
  }

  const markRead = async () => {
    if (unread <= 0) return
    setLoading(true)
    try {
      const data = await apiClient.markCommunityNotificationsRead()
      setUnread(data.unread_count || 0)
      setNotifications((prev) => prev.map((item) => ({ ...item, is_read: true })))
    } catch (error) {
      await showError(dialog, '标记已读失败', error)
    } finally {
      setLoading(false)
    }
  }

  const loadMore = () => {
    if (loading || loadingMore || !hasMore) return
    void load(activeTab, notifications.length, true)
  }

  const openNotification = async (item: CommunityNotificationItem) => {
    const targetId = notificationTargetId(item)
    if (!targetId) {
      await dialog.alert('未找到对应动态', '这条互动消息缺少可跳转的动态信息。', 'warning')
      return
    }
    if (!item.is_read) {
      try {
        await apiClient.markCommunityNotificationsRead([item.id])
        setNotifications((prev) => prev.map((entry) => entry.id === item.id ? { ...entry, is_read: true } : entry))
        setUnread((value) => Math.max(0, value - 1))
      } catch {
        // Navigation is more important than read state here; ignore transient mark-read failures.
      }
    }
    navigation.navigate('CommunityFeedDetail', {
      targetId,
      targetType: notificationTargetType(item),
    })
  }

  return (
    <Page title="互动消息" subtitle={`${unread} 条未读`} refreshing={loading} onRefresh={refresh}>
      <Card>
        <View style={styles.rowBetween}>
          <View style={styles.flex}>
            <Text style={styles.sectionTitle}>互动收件箱</Text>
            <Text style={styles.subtitle}>点赞、评论、回复和审核结果都会显示在这里。</Text>
          </View>
          <SmallButton label="全部已读" disabled={unread <= 0 || loading} onPress={() => void markRead()} />
        </View>
        <View style={styles.notificationTabs}>
          <NotificationTabButton label="全部" active={activeTab === 'all'} onPress={() => switchTab('all')} />
          <NotificationTabButton label="点赞" badge={likeCount} active={activeTab === 'like'} onPress={() => switchTab('like')} />
          <NotificationTabButton label="评论" badge={commentCount} active={activeTab === 'comment'} onPress={() => switchTab('comment')} />
        </View>
      </Card>
      {loading && visibleNotifications.length === 0 ? (
        <Card>
          <ActivityIndicator color={colors.brand} />
        </Card>
      ) : null}
      {!loading && visibleNotifications.length === 0 ? <EmptyState text={notificationEmptyText(activeTab)} /> : null}
      {visibleNotifications.map((item) => (
        <Pressable key={item.id} onPress={() => openNotification(item)}>
          <Card style={!item.is_read ? styles.unreadCard : undefined}>
            <View style={styles.notificationRow}>
              <Pressable
                style={styles.notificationAvatar}
                onPress={(event) => {
                  event.stopPropagation()
                  const actorId = item.actor?.id
                  if (actorId) navigation.navigate('ProfileSettings', { userId: actorId })
                }}
              >
                {item.actor?.avatar ? (
                  <Image source={{ uri: item.actor.avatar }} style={styles.notificationAvatarImage} />
                ) : (
                  <Text style={styles.notificationAvatarText}>{notificationAvatarText(item)}</Text>
                )}
              </Pressable>
              <View style={styles.flex}>
                <View style={styles.rowBetween}>
                  <Text style={styles.itemName}>{notificationTitle(item)}</Text>
                  {!item.is_read ? <Pill text="未读" /> : null}
                </View>
                <Text style={styles.subtitle}>{notificationContent(item)}</Text>
                <Text style={styles.itemMeta}>{formatDateTime(item.created_at || undefined)}</Text>
              </View>
            </View>
          </Card>
        </Pressable>
      ))}
      {visibleNotifications.length > 0 && hasMore ? (
        <AppButton label="查看更多" variant="secondary" loading={loadingMore} onPress={loadMore} />
      ) : null}
      {visibleNotifications.length > 0 && !hasMore ? <Text style={styles.listEndText}>没有更多了</Text> : null}
    </Page>
  )
}

export function AboutFeedbackScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  const dialog = useAppDialog()
  const [category, setCategory] = useState<FeedbackCategoryKey>('bug')
  const [content, setContent] = useState('')
  const [contact, setContact] = useState('')
  const [feedbackImageUrls, setFeedbackImageUrls] = useState<string[]>([])
  const [attachRecentRequests, setAttachRecentRequests] = useState(true)
  const [searchable, setSearchable] = useState(true)
  const [publicRecords, setPublicRecords] = useState(true)
  const [loading, setLoading] = useState(false)
  const [submittingFeedback, setSubmittingFeedback] = useState(false)
  const [uploadingFeedbackImages, setUploadingFeedbackImages] = useState(false)
  const [savingPrivacy, setSavingPrivacy] = useState<'searchable' | 'public_records' | null>(null)
  const [showGroupQr, setShowGroupQr] = useState(false)
  const [diagnosticVersion, setDiagnosticVersion] = useState(0)
  const contentLength = content.length
  const trimmedContentLength = content.trim().length
  const contactLength = contact.length
  const canSubmitFeedback = trimmedContentLength >= 5 && !submittingFeedback && !uploadingFeedbackImages
  const traceCount = useMemo(() => getRecentRequestTraces().length, [diagnosticVersion])
  const consoleLogCount = useMemo(() => getRecentConsoleLogs().length, [diagnosticVersion])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const profile = await apiClient.getUserProfile()
      setSearchable(profile.searchable ?? true)
      setPublicRecords(profile.public_records ?? true)
    } catch {
      // Profile privacy fields are auxiliary on this page; keep defaults if loading fails.
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const submit = async () => {
    if (trimmedContentLength < 5) {
      await dialog.alert('请补充反馈内容', '请至少填写 5 个字，帮助我们定位问题或理解建议。', 'warning')
      return
    }
    if (uploadingFeedbackImages) {
      await dialog.alert('截图还在处理', '请等截图处理完成后再提交反馈。', 'warning')
      return
    }
    try {
      setSubmittingFeedback(true)
      await apiClient.submitFeedback({
        category,
        content,
        contact,
        pagePath: 'app://feedback',
        appVersion: APP_VERSION,
        clientInfo: {
          surface: 'expo',
          recent_request_limit: RECENT_REQUEST_TRACE_LIMIT,
          console_log_limit: CONSOLE_LOG_BUFFER_LIMIT,
          ...(attachRecentRequests ? { console_logs: getRecentConsoleLogs() } : {}),
        },
        recentRequests: attachRecentRequests ? getRecentRequestTraces() : [],
        imageUrls: feedbackImageUrls,
      })
      setContent('')
      setContact('')
      setFeedbackImageUrls([])
      await dialog.alert('已提交', '反馈已经进入处理队列。', 'success')
    } catch (error) {
      await dialog.alert('提交失败', userFacingErrorMessage(error), 'danger')
    } finally {
      setSubmittingFeedback(false)
    }
  }

  const pickFeedbackImages = async () => {
    const remaining = FEEDBACK_MAX_IMAGES - feedbackImageUrls.length
    if (remaining <= 0 || uploadingFeedbackImages) return
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync()
      if (!permission.granted) {
        await dialog.alert('无法访问相册', '请在系统设置中允许访问相册后再添加截图。', 'warning')
        return
      }
      const picked = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsMultipleSelection: true,
        selectionLimit: remaining,
        quality: 0.86,
      })
      if (picked.canceled || !picked.assets.length) return
      setUploadingFeedbackImages(true)
      const uploaded: string[] = []
      for (const asset of picked.assets.slice(0, remaining)) {
        const data = await apiClient.uploadFeedbackImageFile({
          fileUri: asset.uri,
          fileName: asset.fileName || 'feedback.jpg',
          mimeType: asset.mimeType || 'image/jpeg',
        })
        uploaded.push(data.imageUrl)
      }
      setFeedbackImageUrls((current) => [...current, ...uploaded].slice(0, FEEDBACK_MAX_IMAGES))
    } catch (error) {
      await dialog.alert('上传图片失败', userFacingErrorMessage(error), 'danger')
    } finally {
      setUploadingFeedbackImages(false)
    }
  }

  const removeFeedbackImage = (index: number) => {
    setFeedbackImageUrls((current) => current.filter((_, itemIndex) => itemIndex !== index))
  }

  const updatePrivacy = async (key: 'searchable' | 'public_records', value: boolean) => {
    const previous = key === 'searchable' ? searchable : publicRecords
    if (key === 'searchable') setSearchable(value)
    else setPublicRecords(value)
    setSavingPrivacy(key)
    try {
      await apiClient.updateUserProfile({ [key]: value })
    } catch (error) {
      if (key === 'searchable') setSearchable(previous)
      else setPublicRecords(previous)
      await dialog.alert('设置失败', userFacingErrorMessage(error), 'danger')
    } finally {
      setSavingPrivacy(null)
    }
  }

  const clearCache = async () => {
    try {
      const keys = await AsyncStorage.getAllKeys()
      const removable = keys.filter((key) => key.startsWith('food_link_mobile_') && !key.includes('access_token') && !key.includes('refresh_token') && !key.includes('user_id'))
      if (removable.length) await AsyncStorage.multiRemove(removable)
      clearRecentRequestTraces()
      clearRecentConsoleLogs()
      setDiagnosticVersion((current) => current + 1)
      await dialog.alert('已清除', '本地缓存和诊断记录已清理，登录状态已保留。', 'success')
    } catch (error) {
      await dialog.alert('清除失败', userFacingErrorMessage(error), 'danger')
    }
  }

  const copyOfficialEmail = async () => {
    await Clipboard.setStringAsync(OFFICIAL_EMAIL)
    await dialog.alert('已复制邮箱', OFFICIAL_EMAIL, 'success')
  }

  const openOfficialEmail = async () => {
    const url = `mailto:${OFFICIAL_EMAIL}?subject=${encodeURIComponent('Food Link 反馈')}`
    try {
      const supported = await Linking.canOpenURL(url)
      if (!supported) {
        await copyOfficialEmail()
        return
      }
      await Linking.openURL(url)
    } catch {
      await copyOfficialEmail()
    }
  }

  return (
    <Page title="意见反馈" subtitle="问题、建议和体验感受都可以告诉我们。" refreshing={loading} onRefresh={load}>
      {SHOW_LEGACY_ABOUT_ON_FEEDBACK_PAGE ? (
      <Card>
        <View style={styles.aboutHeader}>
          <View style={styles.aboutLogo}>
            <Text style={styles.aboutLogoText}>食</Text>
          </View>
          <View style={styles.flex}>
            <Text style={styles.aboutName}>智健食探</Text>
            <Text style={styles.subtitle}>Food Link · Version {APP_VERSION}</Text>
          </View>
        </View>
        <Text style={styles.aboutText}>
          食探通过 AI 食物识别、饮食与运动记录、健康档案和社区分享，帮助你更轻松地管理每日营养、身体趋势和长期目标。
        </Text>
        <InfoRow label="官方邮箱" value={OFFICIAL_EMAIL} />
        <InfoRow label="核心能力" value="拍照识别、文字记录、食物库、健康分析、成长伙伴、圈子与会员积分" />
        <InfoRow label="版权信息" value="Copyright © 2026 Food Link. All Rights Reserved." />
        <View style={styles.buttonRow}>
          <SmallButton label="复制邮箱" onPress={() => void copyOfficialEmail()} />
          <SmallButton label="写邮件" onPress={() => void openOfficialEmail()} />
        </View>
      </Card>
      ) : null}

      <Card>
        <View style={styles.feedbackHero}>
          <Text style={styles.feedbackHeroTitle}>告诉我们你遇到的问题</Text>
          <Text style={styles.feedbackHeroDesc}>提交后会进入排查列表，我们会结合请求 trace、客户端日志与截图更快定位原因。</Text>
        </View>
        <Text style={styles.sectionTitle}>反馈类型</Text>
        <View style={styles.feedbackCategoryGrid}>
          {feedbackCategoryOptions.map((item) => (
            <Pressable
              key={item.value}
              style={[styles.feedbackCategoryCard, category === item.value && styles.feedbackCategoryCardActive]}
              onPress={() => setCategory(item.value)}
            >
              <Text style={[styles.feedbackCategoryTitle, category === item.value && styles.feedbackCategoryTitleActive]}>{item.label}</Text>
              <Text style={styles.feedbackCategoryDesc}>{item.desc}</Text>
            </Pressable>
          ))}
        </View>
        <Field
          label="反馈内容"
          rightLabel={`${contentLength}/500`}
          value={content}
          onChangeText={setContent}
          placeholder="请描述你遇到的问题、期望的效果，或告诉我们发生的大致时间。"
          maxLength={500}
          multiline
        />
        <Text style={[styles.formHint, trimmedContentLength < 5 && styles.formHintWarning]}>至少 5 个字，页面、时间和期望效果越清楚越好。</Text>
        <FeedbackImagePickerGrid
          urls={feedbackImageUrls}
          loading={uploadingFeedbackImages}
          onAdd={pickFeedbackImages}
          onRemove={removeFeedbackImage}
        />
        <Text style={styles.formHint}>可上传页面报错、识别结果等截图，最多 {FEEDBACK_MAX_IMAGES} 张。</Text>
        <Field
          label="联系方式（选填）"
          rightLabel={`${contactLength}/120`}
          value={contact}
          onChangeText={setContact}
          placeholder="可填写微信号、手机号或邮箱，便于我们需要时联系你。"
          maxLength={120}
          multiline
        />
        <ToggleRow
          title="附带请求诊断"
          subtitle={`将附带最近 ${Math.min(traceCount, RECENT_REQUEST_TRACE_LIMIT)} 条请求的 traceId、状态码和耗时，以及最近 ${Math.min(consoleLogCount, CONSOLE_LOG_BUFFER_LIMIT)} 条客户端日志，不包含 token、请求体或图片。`}
          value={attachRecentRequests}
          onValueChange={setAttachRecentRequests}
        />
        <AppButton label="提交反馈" loading={submittingFeedback} disabled={!canSubmitFeedback} onPress={submit} />
      </Card>

      {SHOW_LEGACY_ABOUT_ON_FEEDBACK_PAGE ? (
      <Card>
        <Text style={styles.sectionTitle}>隐私设置</Text>
        <ToggleRow
          title="允许在圈子中被搜索"
          subtitle="开启后，其他用户可以通过昵称搜索到你。"
          value={searchable}
          disabled={savingPrivacy === 'searchable'}
          onValueChange={(next) => updatePrivacy('searchable', next)}
        />
        <ToggleRow
          title="公开我的饮食记录"
          subtitle="开启后，公开动态和饮食记录会展示在圈子中。"
          value={publicRecords}
          disabled={savingPrivacy === 'public_records'}
          onValueChange={(next) => updatePrivacy('public_records', next)}
        />
      </Card>
      ) : null}

      {SHOW_LEGACY_ABOUT_ON_FEEDBACK_PAGE ? (
      <Card>
        <Text style={styles.sectionTitle}>协议与社群</Text>
        <InfoRow label="用户服务协议" value="登录即表示同意 Food Link 服务条款" />
        <InfoRow label="隐私政策" value="仅收集完成饮食记录、分析和社区互动所需的信息" />
        {showGroupQr ? (
          <View style={styles.qrWrap}>
            <Image source={userGroupQr} style={styles.qrImage} resizeMode="contain" />
            <Text style={styles.subtitle}>长按或截图后可在微信中识别二维码加入用户群。</Text>
          </View>
        ) : null}
        <View style={styles.buttonRow}>
          <SmallButton label="查看协议" onPress={() => navigation.navigate('Agreements')} />
          <SmallButton label="隐私政策" onPress={() => navigation.navigate('PrivacyPolicy')} />
          <SmallButton label="用户群页" onPress={() => navigation.navigate('UserGroup')} />
          <SmallButton label={showGroupQr ? '收起二维码' : '查看用户群二维码'} onPress={() => setShowGroupQr((current) => !current)} />
          <SmallButton label="清除缓存" onPress={() => void clearCache()} />
        </View>
      </Card>
      ) : null}
    </Page>
  )
}

export function AboutScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  const dialog = useAppDialog()
  const [showGroupQr, setShowGroupQr] = useState(false)

  const copyOfficialEmail = async () => {
    await Clipboard.setStringAsync(OFFICIAL_EMAIL)
    await dialog.alert('已复制邮箱', OFFICIAL_EMAIL, 'success')
  }

  const openOfficialEmail = async () => {
    const url = `mailto:${OFFICIAL_EMAIL}?subject=${encodeURIComponent('食探反馈')}`
    try {
      const supported = await Linking.canOpenURL(url)
      if (!supported) {
        await copyOfficialEmail()
        return
      }
      await Linking.openURL(url)
    } catch {
      await copyOfficialEmail()
    }
  }

  return (
    <Page title="关于" subtitle="应用说明、协议和联系方式。">
      <Card>
        <View style={styles.aboutHeader}>
          <View style={styles.aboutLogo}>
            <Text style={styles.aboutLogoText}>食</Text>
          </View>
          <View style={styles.flex}>
            <Text style={styles.aboutName} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.86}>智健食探</Text>
            <Text style={styles.subtitle}>Food Link · Version {APP_VERSION}</Text>
          </View>
        </View>
        <Text style={styles.aboutText}>
          食探通过 AI 食物识别、饮食与运动记录、健康档案和社区分享，帮助你更轻松地管理每日营养、身体趋势和长期目标。
        </Text>
        <InfoRow label="官方邮箱" value={OFFICIAL_EMAIL} />
        <InfoRow label="核心能力" value="拍照识别、文字记录、食物库、健康分析、成长伙伴、圈子与会员积分" />
        <InfoRow label="版权信息" value="Copyright © 2026 Food Link. All Rights Reserved." />
        <View style={styles.buttonRow}>
          <SmallButton label="复制邮箱" onPress={() => void copyOfficialEmail()} />
          <SmallButton label="写邮件" onPress={() => void openOfficialEmail()} />
        </View>
      </Card>

      <Card>
        <Text style={styles.sectionTitle}>协议与社群</Text>
        <InfoRow label="用户服务协议" value="登录即表示同意 Food Link 服务条款" />
        <InfoRow label="隐私政策" value="仅收集完成饮食记录、分析和社区互动所需的信息" />
        {showGroupQr ? (
          <View style={styles.qrWrap}>
            <Image source={userGroupQr} style={styles.qrImage} resizeMode="contain" />
            <Text style={styles.subtitle}>长按或截图后可在微信中识别二维码加入用户群。</Text>
          </View>
        ) : null}
        <View style={styles.buttonRow}>
          <SmallButton label="查看协议" onPress={() => navigation.navigate('Agreements')} />
          <SmallButton label="隐私政策" onPress={() => navigation.navigate('PrivacyPolicy')} />
          <SmallButton label="会员协议" onPress={() => navigation.navigate('MembershipAgreement')} />
          <SmallButton label="用户群页" onPress={() => navigation.navigate('UserGroup')} />
          <SmallButton label={showGroupQr ? '收起二维码' : '查看二维码'} onPress={() => setShowGroupQr((current) => !current)} />
        </View>
      </Card>
    </Page>
  )
}

function Field({
  label,
  rightLabel,
  value,
  onChangeText,
  placeholder,
  keyboardType,
  multiline,
  maxLength,
  returnKeyType,
  onSubmitEditing,
}: {
  label: string
  rightLabel?: string
  value: string
  onChangeText: (value: string) => void
  placeholder?: string
  keyboardType?: 'default' | 'decimal-pad' | 'number-pad'
  multiline?: boolean
  maxLength?: number
  returnKeyType?: 'done' | 'go' | 'next' | 'search' | 'send'
  onSubmitEditing?: () => void
}) {
  return (
    <View style={styles.field}>
      <View style={styles.fieldLabelRow}>
        <Text style={styles.fieldLabel}>{label}</Text>
        {rightLabel ? <Text style={styles.fieldMeta}>{rightLabel}</Text> : null}
      </View>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textMuted}
        keyboardType={keyboardType}
        multiline={multiline}
        maxLength={maxLength}
        returnKeyType={returnKeyType}
        onSubmitEditing={onSubmitEditing}
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
        <Pressable key={meal} style={[styles.segmentItem, value === meal && styles.segmentItemActive]} onPress={() => onChange(meal)}>
          <Text style={[styles.segmentText, value === meal && styles.segmentTextActive]}>{getMealTypeLabel(meal)}</Text>
        </Pressable>
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

function NotificationTabButton({ label, badge, active, onPress }: { label: string; badge?: number; active: boolean; onPress: () => void }) {
  return (
    <Pressable style={[styles.notificationTabItem, active && styles.notificationTabItemActive]} onPress={onPress}>
      <Text style={[styles.notificationTabText, active && styles.notificationTabTextActive]}>{label}</Text>
      {badge && badge > 0 ? (
        <View style={[styles.notificationTabBadge, active && styles.notificationTabBadgeActive]}>
          <Text style={[styles.notificationTabBadgeText, active && styles.notificationTabBadgeTextActive]}>{formatBadgeCount(badge)}</Text>
        </View>
      ) : null}
    </Pressable>
  )
}

function OptionSegment({
  title,
  value,
  options,
  onChange,
}: {
  title: string
  value: string
  options: ReadonlyArray<{ value: string; label: string }>
  onChange: (value: string) => void
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{title}</Text>
      <View style={styles.segment}>
        {options.map((option) => (
          <SegmentButton key={option.value || 'empty'} label={option.label} active={value === option.value} onPress={() => onChange(option.value)} />
        ))}
      </View>
    </View>
  )
}

function ToggleRow({
  title,
  subtitle,
  value,
  disabled,
  onValueChange,
}: {
  title: string
  subtitle: string
  value: boolean
  disabled?: boolean
  onValueChange: (value: boolean) => void
}) {
  return (
    <View style={styles.toggleRow}>
      <View style={styles.flex}>
        <Text style={styles.itemName}>{title}</Text>
        <Text style={styles.subtitle}>{subtitle}</Text>
      </View>
      <Switch value={value} disabled={disabled} onValueChange={onValueChange} trackColor={{ true: colors.brandSoft, false: colors.border }} thumbColor={value ? colors.brand : '#fff'} />
    </View>
  )
}

function SelectedManualFoodCard({
  entry,
  onWeightChange,
  onAdjust,
  onPreset,
  onRemove,
}: {
  entry: SelectedManualFood
  onWeightChange: (value: string) => void
  onAdjust: (delta: number) => void
  onPreset: (ratio: number) => void
  onRemove: () => void
}) {
  const weight = numberFrom(entry.weight, numberFrom(entry.item.default_weight_grams, 100))
  const nutrients = scaledManualFoodNutrition(entry.item, weight)
  const usesPortionUnit = manualFoodUsesPortionUnit(entry.item)
  const quantityUnit = usesPortionUnit ? manualFoodPortionUnitLabel(entry.item) : 'g'
  const adjustOptions = usesPortionUnit
    ? [
      { label: `-0.5${quantityUnit}`, delta: -0.5 },
      { label: `-0.25${quantityUnit}`, delta: -0.25 },
      { label: `+0.25${quantityUnit}`, delta: 0.25 },
      { label: `+0.5${quantityUnit}`, delta: 0.5 },
    ]
    : [
      { label: '-50g', delta: -50 },
      { label: '-10g', delta: -10 },
      { label: '+10g', delta: 10 },
      { label: '+50g', delta: 50 },
    ]
  return (
    <View style={styles.selectedFoodBox}>
      <View style={styles.rowBetween}>
        <View style={styles.flex}>
          <Text style={styles.itemName}>{manualFoodTitle(entry.item)}</Text>
          <Text style={styles.subtitle}>{manualFoodSourceLabel(entry.item)} · {Math.round(nutrients.calories)} kcal</Text>
        </View>
        <Pressable style={[styles.smallButton, styles.smallButtonDanger]} onPress={onRemove}>
          <Text style={[styles.smallButtonText, styles.smallButtonDangerText]}>移除</Text>
        </Pressable>
      </View>
      <Field label={usesPortionUnit ? `数量 ${quantityUnit}` : '份量 g'} value={entry.weight} onChangeText={onWeightChange} keyboardType="decimal-pad" />
      <View style={styles.ratioGrid}>
        {[
          { label: '25%', ratio: 0.25 },
          { label: '50%', ratio: 0.5 },
          { label: '100%', ratio: 1 },
        ].map((preset) => (
          <Pressable key={preset.label} style={styles.ratioButton} onPress={() => onPreset(preset.ratio)}>
            <Text style={styles.ratioButtonText}>{preset.label}</Text>
          </Pressable>
        ))}
      </View>
      <View style={styles.manualAdjustRow}>
        {adjustOptions.map((option) => (
          <Pressable key={option.label} style={styles.manualAdjustButton} onPress={() => onAdjust(option.delta)}>
            <Text style={styles.manualAdjustText}>{option.label}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  )
}

function FoodChoice({ item, selected, onPress }: { item: ManualFoodItem; selected?: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress}>
      <Card>
        <View style={styles.rowBetween}>
          <View style={styles.flex}>
            <Text style={styles.itemName}>{manualFoodTitle(item)}</Text>
            <Text style={styles.subtitle}>{manualFoodSourceLabel(item)} · {manualFoodPortionText(item)}</Text>
          </View>
          <View style={selected ? styles.foodChoiceAdded : styles.foodChoiceAdd}>
            <Text style={selected ? styles.foodChoiceAddedText : styles.foodChoiceAddText}>{selected ? '已选' : '+'}</Text>
          </View>
        </View>
        <Text style={styles.subtitle}>{Math.round(numberFrom(item.total_calories ?? item.calories))} kcal · 蛋白 {Math.round(numberFrom(item.total_protein ?? item.protein))}g</Text>
      </Card>
    </Pressable>
  )
}

function SectionList({
  title,
  items,
  onItemPress,
}: {
  title: string
  items: ManualFoodItem[]
  onItemPress?: (item: ManualFoodItem) => void
}) {
  if (!items.length) return null
  return (
    <>
      <Text style={styles.groupTitle}>{title}</Text>
      {items.slice(0, 12).map((item, index) => (
        <FoodChoice
          key={`${title}-${manualFoodTitle(item)}-${item.id || index}`}
          item={item}
          onPress={() => onItemPress?.(item)}
        />
      ))}
    </>
  )
}

function MiniStat({ title, value }: { title: string; value: number }) {
  return (
    <View style={styles.miniStat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statTitle}>{title}</Text>
    </View>
  )
}

function SummaryCell({ title, value, unit }: { title: string; value: number | string; unit: string }) {
  return (
    <View style={styles.summaryCell}>
      <Text style={styles.summaryValue}>
        {value}
        {unit ? <Text style={styles.summaryUnit}> {unit}</Text> : null}
      </Text>
      <Text style={styles.summaryTitle}>{title}</Text>
    </View>
  )
}

function FriendUserCard({
  user,
  subtitle,
  onPress,
  actions,
}: {
  user: FriendUserItem
  subtitle?: string
  onPress?: () => void
  actions?: ReactNode
}) {
  return (
    <Card>
      <View style={styles.friendCardRow}>
        <Pressable style={styles.friendInfoRow} onPress={onPress}>
          <FriendAvatar uri={user.avatar} label={friendDisplayName(user)} />
          <View style={styles.flex}>
            <Text style={styles.itemName}>{friendDisplayName(user)}</Text>
            <Text style={styles.subtitle}>{subtitle || friendUserSubtitle(user)}</Text>
          </View>
        </Pressable>
        {actions ? <View style={styles.friendActionRow}>{actions}</View> : null}
      </View>
    </Card>
  )
}

function FriendRequestCard({
  request,
  onPress,
  actions,
}: {
  request: FriendRequestItem
  onPress?: () => void
  actions?: ReactNode
}) {
  return (
    <Card>
      <View style={styles.friendCardRow}>
        <Pressable style={styles.friendInfoRow} onPress={onPress}>
          <FriendAvatar uri={friendRequestAvatar(request)} label={friendRequestDisplayName(request)} />
          <View style={styles.flex}>
            <Text style={styles.itemName}>{friendRequestDisplayName(request)}</Text>
            <Text style={styles.subtitle}>{friendRequestTimeLabel(request) || friendRequestStatusLabel(request.status)}</Text>
          </View>
        </Pressable>
        {actions ? <View style={styles.friendActionRow}>{actions}</View> : null}
      </View>
    </Card>
  )
}

function FriendAvatar({ uri, label }: { uri?: string; label: string }) {
  if (uri) return <Image source={{ uri }} style={styles.friendAvatarImage} />
  return (
    <View style={styles.friendAvatarFallback}>
      <Text style={styles.friendAvatarText}>{(label.trim() || '友').slice(0, 1)}</Text>
    </View>
  )
}
function SmallButton({ label, danger, disabled, onPress }: { label: string; danger?: boolean; disabled?: boolean; onPress: () => void }) {
  return (
    <Pressable disabled={disabled} onPress={onPress} style={[styles.smallButton, danger && styles.smallButtonDanger, disabled && styles.smallButtonDisabled]}>
      <Text style={[styles.smallButtonText, danger && styles.smallButtonDangerText, disabled && styles.smallButtonTextDisabled]}>{label}</Text>
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

function expiryStatusLabel(value?: string): string {
  const labels: Record<string, string> = {
    active: '进行中',
    consumed: '已吃完',
    discarded: '已丢弃',
    expired: '已过期',
  }
  return labels[value || ''] || '进行中'
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  )
}

function rewardTaskKey(task: { code?: string; action_type?: string; name?: string }): string {
  return task.action_type || task.code || task.name || 'reward-task'
}

function rewardTaskName(task: { name?: string; action_type?: string }): string {
  if (task.action_type === 'public_food_upload') return '上传公共食物/校园食堂菜品'
  if (task.action_type === 'packaged_food_upload') return '预包装零食/食物上传'
  if (task.action_type === 'share_poster') return '每日分享打卡'
  return task.name || '积分任务'
}

function isRewardTaskDisabled(task: { daily_limit?: number | null; today_count?: number }): boolean {
  return typeof task.daily_limit === 'number' && task.daily_limit > 0 && Number(task.today_count || 0) >= task.daily_limit
}

function isRewardTaskAvailable(task: { action_path?: string | null; daily_limit?: number | null; today_count?: number }): boolean {
  return Boolean(task.action_path) && !isRewardTaskDisabled(task)
}

function rewardTaskStatus(task: { status?: string; daily_limit?: number | null; today_count?: number }): string {
  if (isRewardTaskDisabled(task)) return '今日已满'
  return task.status || '可去完成'
}

function formatRewardTaskProgress(task: { daily_limit?: number | null; today_count?: number }): string {
  const count = Number(task.today_count || 0)
  if (typeof task.daily_limit === 'number' && task.daily_limit > 0) {
    return `今日 ${count}/${task.daily_limit}`
  }
  return `今日已提交 ${count}`
}

function formatRewardTaskLimit(task: { daily_limit?: number | null }): string {
  if (typeof task.daily_limit === 'number' && task.daily_limit > 0) return `每日上限 ${task.daily_limit}`
  return '不限次数，新内容才奖励'
}

function rewardTaskPercent(task: { daily_limit?: number | null; today_count?: number }): number {
  if (typeof task.daily_limit !== 'number' || task.daily_limit <= 0) return 0
  return Math.min(100, Math.max(0, Number(task.today_count || 0) / task.daily_limit * 100))
}

function rewardTaskHint(task: { action_type?: string; description?: string }): string {
  if (task.description) return task.description
  switch (task.action_type) {
    case 'share_poster':
      return '分享今日饮食或单条饮食记录后，可领取每日分享奖励。'
    case 'packaged_food_upload':
      return '上传包装食品营养表并保存新商品后，符合规则会发放奖励积分。'
    case 'public_food_upload':
      return '分享外食、校园餐或自制餐食到公共食物库，审核通过后计入奖励。'
    default:
      return '完成任务后奖励积分会自动进入余额。'
  }
}

function navigateRewardTask(
  navigation: NativeStackNavigationProp<RootStackParamList>,
  task: { action_type?: string; action_path?: string | null; daily_limit?: number | null; today_count?: number },
) {
  if (isRewardTaskDisabled(task) || !task.action_path) return
  switch (task.action_type) {
    case 'share_poster':
      navigation.navigate('DayRecord', { date: todayKey() })
      return
    case 'packaged_food_upload':
      navigation.navigate('PackagedFoodEdit')
      return
    case 'public_food_upload':
      navigation.navigate('PublicFoodShare', { mode: 'campus' })
      return
    default:
      navigation.navigate('RewardCenter')
  }
}

function EmptyState({ text }: { text: string }) {
  return (
    <Card>
      <Text style={styles.empty}>{text}</Text>
    </Card>
  )
}

function CircleImagePickerGrid({
  urls,
  loading,
  onAdd,
  onRemove,
}: {
  urls: string[]
  loading: boolean
  onAdd: () => void
  onRemove: (index: number) => void
}) {
  return (
    <View style={styles.imageBlock}>
      <View style={styles.rowBetween}>
        <Text style={styles.fieldLabel}>图片</Text>
        <Text style={styles.subtitle}>{urls.length}/{CIRCLE_POST_MAX_IMAGES}</Text>
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
        {urls.length < CIRCLE_POST_MAX_IMAGES ? (
          <Pressable style={styles.imageAdd} onPress={onAdd} disabled={loading}>
            {loading ? <ActivityIndicator color={colors.brand} /> : <Text style={styles.imageAddIcon}>+</Text>}
            <Text style={styles.imageAddText}>添加图片</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  )
}

function FeedbackImagePickerGrid({
  urls,
  loading,
  onAdd,
  onRemove,
}: {
  urls: string[]
  loading: boolean
  onAdd: () => void
  onRemove: (index: number) => void
}) {
  return (
    <View style={styles.imageBlock}>
      <View style={styles.rowBetween}>
        <Text style={styles.fieldLabel}>截图</Text>
        <Text style={styles.subtitle}>{urls.length}/{FEEDBACK_MAX_IMAGES}</Text>
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
        {urls.length < FEEDBACK_MAX_IMAGES ? (
          <Pressable style={styles.imageAdd} onPress={onAdd} disabled={loading}>
            {loading ? <ActivityIndicator color={colors.brand} /> : <Text style={styles.imageAddIcon}>+</Text>}
            <Text style={styles.imageAddText}>添加截图</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  )
}

function flattenManualFoodBrowse(data: ManualFoodBrowseResult | null): ManualFoodItem[] {
  if (!data) return []
  return [
    ...(data.recent_items || []),
    ...(data.collected_public_library || []),
    ...(data.public_library || []),
    ...(data.nutrition_library || []),
  ]
}

function manualFoodTitle(item: ManualFoodItem): string {
  return String(item.title || item.name || '食物')
}

function manualFoodKey(item: ManualFoodItem): string {
  const id = String(item.source_id || item.id || '').trim()
  if (id) return `${item.source || 'manual'}:${id}`
  return `${item.source || 'manual'}:${manualFoodTitle(item)}`
}

function manualFoodSourceLabel(item: ManualFoodItem): string {
  const sourceLabel = typeof item.source_label === 'string' ? item.source_label.trim() : ''
  if (sourceLabel) return sourceLabel
  if (item.source === 'public_library' && (item.is_campus_food === true || item.type === 'campus')) {
    return '校园食堂'
  }
  switch (item.source) {
    case 'public_library':
      return '真实餐食'
    case 'packaged_food':
      return '包装食品'
    case 'custom':
      return '自定义'
    case 'recent':
      return '最近记录'
    case 'nutrition_library':
    default:
      return '标准食物'
  }
}

function manualFoodPortionText(item: ManualFoodItem): string {
  const portion = typeof item.portion_label === 'string' ? item.portion_label.trim() : ''
  if (portion) return portion
  return `${Math.round(numberFrom(item.default_weight_grams, 100))}g`
}

function manualFoodUsesPortionUnit(item: ManualFoodItem): boolean {
  const portion = manualFoodPortionText(item)
  const defaultWeight = numberFrom(item.default_weight_grams, 100)
  return defaultWeight <= 1 && Boolean(portion) && !/(g|kg|ml|克|千克|毫升)/i.test(portion)
}

function manualFoodPortionUnitLabel(item: ManualFoodItem): string {
  const portion = manualFoodPortionText(item)
  const match = portion.match(/^[\d.]+\s*(.+)$/)
  const unit = match?.[1]?.trim()
  return unit || '份'
}

function manualFoodMinQuantity(item: ManualFoodItem): number {
  return manualFoodUsesPortionUnit(item) ? 0.25 : 1
}

function manualFoodQuantityInputValue(item: ManualFoodItem, value: number): string {
  if (!manualFoodUsesPortionUnit(item)) {
    return String(Math.max(1, Math.round(value)))
  }
  const rounded = Math.max(0.25, Math.round(value * 100) / 100)
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')
}

function formatManualFoodTotalQuantity(totals: { weight: number; portions: number }): string {
  const parts: string[] = []
  if (totals.portions > 0) parts.push(`${manualFoodQuantityInputValue({ default_weight_grams: 1, portion_label: '1份' }, totals.portions)}份`)
  if (totals.weight > 0) parts.push(`${Math.round(totals.weight)}g`)
  return parts.join(' + ') || '0g'
}

function scaledManualFoodNutrition(item: ManualFoodItem, weight: number): Nutrients & { weight: number } {
  const baseWeight = numberFrom(item.default_weight_grams, 100) || 100
  const safeWeight = Math.max(0, weight)
  const ratio = baseWeight > 0 ? safeWeight / baseWeight : 1
  return {
    calories: numberFrom(item.total_calories ?? item.calories) * ratio,
    protein: numberFrom(item.total_protein ?? item.protein) * ratio,
    carbs: numberFrom(item.total_carbs ?? item.carbs) * ratio,
    fat: numberFrom(item.total_fat ?? item.fat) * ratio,
    fiber: numberFrom(item.nutrients_per_100g?.fiber) * (safeWeight / 100),
    sugar: numberFrom(item.nutrients_per_100g?.sugar) * (safeWeight / 100),
    sodium_mg: numberFrom(item.nutrients_per_100g?.sodium_mg) * (safeWeight / 100),
    weight: safeWeight,
  }
}

function numberFrom(value: unknown, fallback = 0): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

function numberOrUndefined(value: string): number | undefined {
  const n = Number(value)
  return Number.isFinite(n) && value.trim() !== '' ? n : undefined
}

function splitImageUrls(value: string): string[] {
  return value
    .split(/\r?\n|,|，/)
    .map((url) => url.trim())
    .filter(Boolean)
    .slice(0, 4)
}

function validateCustomFoodDraft(
  title: string,
  defaultWeightGrams: number,
  per100g: { calories: number; protein: number; carbs: number; fat: number; fiber: number; sugar: number; sodium_mg: number },
): string | null {
  if (!title) return '请输入食物名称。'
  if (!Number.isFinite(defaultWeightGrams) || defaultWeightGrams <= 0 || defaultWeightGrams > 5000) {
    return '默认份量需要在 1-5000g 之间。'
  }
  if (per100g.calories <= 0 || per100g.calories > 2000) {
    return '每 100g 热量需要在 1-2000 kcal 之间。'
  }
  const ranges: Array<[string, number, number]> = [
    ['蛋白质', per100g.protein, 300],
    ['碳水', per100g.carbs, 500],
    ['脂肪', per100g.fat, 300],
    ['膳食纤维', per100g.fiber, 200],
    ['糖', per100g.sugar, 300],
    ['钠', per100g.sodium_mg, 100000],
  ]
  const invalid = ranges.find(([, value, max]) => value < 0 || value > max)
  if (invalid) return `${invalid[0]}数值超出合理范围。`
  return null
}

function numberField(value: unknown): string {
  const n = Number(value)
  if (!Number.isFinite(n) || n === 0) return ''
  return (Math.round(n * 10) / 10).toString()
}

function round1(value: unknown): number {
  const n = Number(value)
  if (!Number.isFinite(n)) return 0
  return Math.round(n * 10) / 10
}

function clampPercent(value: unknown): number {
  const n = numberFrom(value, 100)
  return Math.max(0, Math.min(100, n))
}

function recordImageUrls(record: FoodRecord | null): string[] {
  if (!record) return []
  const urls = [
    ...(Array.isArray(record.image_paths) ? record.image_paths : []),
    record.image_path,
  ]
  return urls.map((url) => String(url || '').trim()).filter(Boolean)
}

function buildRecordShareMessage(record: FoodRecord): string {
  const lines = [
    `${getMealTypeLabel(record.meal_type)} · ${Math.round(record.total_calories || 0)} kcal`,
    `蛋白质 ${round1(record.total_protein || 0)}g · 碳水 ${round1(record.total_carbs || 0)}g · 脂肪 ${round1(record.total_fat || 0)}g`,
  ]
  const description = String(record.description || '').trim()
  if (description) lines.push(description)
  const foods = (record.items || []).slice(0, 6).map((item) => {
    const intake = Math.round(recordItemIntake(item))
    return `- ${item.name}${intake > 0 ? ` ${intake}g` : ''}`
  })
  if (foods.length) lines.push('食物明细:', ...foods)
  lines.push('来自 Food Link')
  return lines.join('\n')
}

function buildDayShareMessage(date: string, records: FoodRecord[]): string {
  const totalKcal = records.reduce((sum, record) => sum + Number(record.total_calories || 0), 0)
  const totalProtein = records.reduce((sum, record) => sum + Number(record.total_protein || 0), 0)
  const totalCarbs = records.reduce((sum, record) => sum + Number(record.total_carbs || 0), 0)
  const totalFat = records.reduce((sum, record) => sum + Number(record.total_fat || 0), 0)
  const lines = [
    `${date} 饮食记录 · ${Math.round(totalKcal)} kcal`,
    `蛋白质 ${round1(totalProtein)}g · 碳水 ${round1(totalCarbs)}g · 脂肪 ${round1(totalFat)}g`,
    `共 ${records.length} 条记录`,
  ]
  records.slice(0, 8).forEach((record) => {
    const name = String(record.description || record.items?.map((item) => item.name).join('、') || '饮食记录').trim()
    lines.push(`- ${getMealTypeLabel(record.meal_type)} ${Math.round(record.total_calories || 0)} kcal ${name}`)
  })
  lines.push('来自 Food Link')
  return lines.join('\n')
}

async function showShareRewardAlert(dialog: AppDialog, result: Awaited<ReturnType<typeof apiClient.claimSharePosterReward>>) {
  await dialog.alert('分享完成', result.message || (result.claimed ? `分享奖励 +${result.credits || 0} 积分` : '分享已完成'), 'success')
}

function nutrientNumber(nutrients: Nutrients | undefined, key: keyof Nutrients): number {
  return numberFrom(nutrients?.[key], 0)
}

function recordItemRatio(item: FoodRecord['items'][number]): number {
  return clampPercent(item.ratio == null ? 100 : item.ratio)
}

function recordItemIntake(item: FoodRecord['items'][number]): number {
  const intake = numberFrom(item.intake, 0)
  if (intake > 0) return intake
  return numberFrom(item.weight, 0) * recordItemRatio(item) / 100
}

function recordItemMacro(item: FoodRecord['items'][number], key: keyof Nutrients): number {
  return nutrientNumber(item.nutrients, key) * recordItemRatio(item) / 100
}

function recordItemKcal(item: FoodRecord['items'][number]): number {
  return recordItemMacro(item, 'calories')
}

function editableRecordItemFromRow(item: FoodRecord['items'][number]): EditableRecordItem {
  return {
    name: item.name || '',
    weight: numberField(item.weight),
    ratio: numberField(recordItemRatio(item)) || '100',
    calories: numberField(item.nutrients?.calories),
    protein: numberField(item.nutrients?.protein),
    carbs: numberField(item.nutrients?.carbs),
    fat: numberField(item.nutrients?.fat),
    fiber: numberField(item.nutrients?.fiber),
    sugar: numberField(item.nutrients?.sugar),
    waterMl: numberField(item.water_ml ?? item.waterMl ?? item.nutrients?.water_ml ?? item.nutrients?.waterMl),
    sodiumMg: numberField(item.nutrients?.sodium_mg ?? item.nutrients?.sodiumMg),
    source: item,
  }
}

function editableItemRatio(item: EditableRecordItem): number {
  return clampPercent(item.ratio.trim() === '' ? 100 : item.ratio)
}

function editableItemWeight(item: EditableRecordItem): number {
  return Math.max(0, numberFrom(item.weight, 0))
}

function editableItemIntake(item: EditableRecordItem): number {
  return editableItemWeight(item) * editableItemRatio(item) / 100
}

function editableItemScaledNutrient(item: EditableRecordItem, key: keyof Nutrients): number {
  const raw: Partial<Record<keyof Nutrients, string>> = {
    calories: item.calories,
    protein: item.protein,
    carbs: item.carbs,
    fat: item.fat,
    fiber: item.fiber,
    sugar: item.sugar,
  }
  return numberFrom(raw[key], 0) * editableItemRatio(item) / 100
}

function summarizeEditableRecordItems(items: EditableRecordItem[]): {
  total_calories: number
  total_protein: number
  total_carbs: number
  total_fat: number
  total_weight_grams: number
} {
  return {
    total_calories: round1(items.reduce((sum, item) => sum + editableItemScaledNutrient(item, 'calories'), 0)),
    total_protein: round1(items.reduce((sum, item) => sum + editableItemScaledNutrient(item, 'protein'), 0)),
    total_carbs: round1(items.reduce((sum, item) => sum + editableItemScaledNutrient(item, 'carbs'), 0)),
    total_fat: round1(items.reduce((sum, item) => sum + editableItemScaledNutrient(item, 'fat'), 0)),
    total_weight_grams: round1(items.reduce((sum, item) => sum + editableItemIntake(item), 0)),
  }
}

function compactString(value: unknown): string | undefined {
  const text = String(value || '').trim()
  return text || undefined
}

function positiveNumberOrUndefined(value: unknown): number | undefined {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : undefined
}

function boolOrUndefined(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

function editableRecordItemPayload(item: EditableRecordItem): FoodRecordItemPayload {
  const source = item.source
  const waterMl = numberFrom(item.waterMl, 0)
  const sodiumMg = numberFrom(item.sodiumMg, 0)
  const nutrients: Nutrients = {
    ...(source.nutrients || {}),
    calories: numberFrom(item.calories, 0),
    protein: numberFrom(item.protein, 0),
    carbs: numberFrom(item.carbs, 0),
    fat: numberFrom(item.fat, 0),
    fiber: numberFrom(item.fiber, 0),
    sugar: numberFrom(item.sugar, 0),
    waterMl,
    water_ml: waterMl,
    sodiumMg,
    sodium_mg: sodiumMg,
  }

  return {
    name: item.name.trim() || source.name || '未命名食物',
    weight: editableItemWeight(item),
    ratio: editableItemRatio(item),
    intake: editableItemIntake(item),
    image_path: compactString(source.image_path),
    image_paths: Array.isArray(source.image_paths) ? source.image_paths.filter(Boolean) : undefined,
    gross_weight_grams: positiveNumberOrUndefined(source.gross_weight_grams),
    edible_portion_ratio: positiveNumberOrUndefined(source.edible_portion_ratio),
    edible_portion_reason: compactString(source.edible_portion_reason),
    edible_portion_source: compactString(source.edible_portion_source),
    suggested_ratio: positiveNumberOrUndefined(source.suggested_ratio),
    suggested_ratio_reason: compactString(source.suggested_ratio_reason),
    suggested_ratio_source: compactString(source.suggested_ratio_source),
    water_ml: waterMl,
    nutrition_source: source.nutrition_source ?? undefined,
    nutrition_source_category: source.nutrition_source_category ?? undefined,
    matched_food_id: source.matched_food_id ?? undefined,
    packaged_food_id: compactString(source.packaged_food_id),
    package_match_status: compactString(source.package_match_status),
    package_match_confidence: positiveNumberOrUndefined(source.package_match_confidence),
    package_weight_source: compactString(source.package_weight_source),
    package_weight_applied: boolOrUndefined(source.package_weight_applied),
    package_weight_reason: compactString(source.package_weight_reason),
    packaged_candidates: source.packaged_candidates,
    nutrients,
    manual_source: source.manual_source,
    manual_source_id: compactString(source.manual_source_id),
    manual_source_title: compactString(source.manual_source_title),
    manual_portion_label: compactString(source.manual_portion_label),
  }
}

function getWaterLogItems(day: BodyMetricsSummary['today_water'] | null | undefined): Array<{ id?: string; amount_ml: number; recorded_at?: string | null }> {
  if (!day) return []
  if (Array.isArray(day.log_items)) return day.log_items
  if (Array.isArray(day.logs)) {
    return day.logs.map((amount, index) => ({
      id: undefined,
      amount_ml: Number(amount) || 0,
      recorded_at: `${day.date}-${index}`,
    }))
  }
  return []
}

function stringFrom(value: unknown): string {
  return value == null ? '' : String(value)
}

async function showError(dialog: AppDialog, title: string, error: unknown) {
  await dialog.alert(title, userFacingErrorMessage(error), 'danger')
}

function taskStatusLabel(status: AnalysisTask['status']): string {
  const labels: Record<string, string> = {
    pending: '排队中',
    queued: '排队中',
    running: '分析中',
    processing: '分析中',
    done: '完成',
    failed: '失败',
    violated: '未通过',
    timed_out: '超时',
    cancelled: '已取消',
  }
  return labels[status] || status
}

function exerciseTaskStatusLabel(status: string): string {
  return taskStatusLabel(status as AnalysisTask['status'])
}

function isTaskRunningStatus(status?: string): boolean {
  return ['pending', 'queued', 'running', 'processing'].includes(String(status || ''))
}

function exerciseTaskMessage(status: string): string {
  if (isTaskRunningStatus(status)) return '系统正在识别运动内容，完成后会自动刷新当天记录。'
  if (status === 'done') return '分析已完成，页面已刷新当天运动记录。'
  if (['failed', 'violated', 'timed_out', 'cancelled'].includes(status)) return '本次分析没有完成，可以调整内容后重新提交，或稍后刷新结果。'
  return '可手动刷新查看最新结果。'
}

function exerciseTaskError(task: AnalysisTask): string {
  const raw = String(task.error_message || '').trim()
  if (!raw) return '运动分析失败'
  try {
    const parsed = JSON.parse(raw) as { message?: string }
    if (parsed.message) return userFacingMessage(parsed.message, '运动分析失败')
  } catch {
    // Plain text errors are sanitized below.
  }
  return userFacingMessage(raw, '运动分析失败')
}

function isTextAnalysisTask(task: AnalysisTask): boolean {
  if (task.task_type === 'food_text') return true
  return task.payload?.source_type === 'text'
}

function analyzeHistoryPayloadValue(task: AnalysisTask, ...keys: string[]): unknown {
  const payload = task.payload || {}
  for (const key of keys) {
    const value = payload[key]
    if (value != null && value !== '') return value
  }
  return undefined
}

function analyzeHistoryMealType(task: AnalysisTask): MealType {
  const value = String(analyzeHistoryPayloadValue(task, 'meal_type', 'mealType') || '')
  if (value === 'snack') return 'afternoon_snack'
  return mealOptions.includes(value as MealType) ? (value as MealType) : inferDefaultMealTypeFromLocalTime()
}

function analyzeHistoryDate(task: AnalysisTask): string {
  const value = String(analyzeHistoryPayloadValue(task, 'date', 'recorded_on', 'recordedOn') || '').trim()
  return value || todayKey()
}

function isPackagedAnalyzeHistoryTask(task: AnalysisTask): boolean {
  const taskType = String(task.task_type || '')
  return taskType.startsWith('packaged') || taskType.includes('packaged_food') || taskType.includes('nutrition_label')
}

function isVisibleAnalyzeHistoryTask(task: AnalysisTask): boolean {
  const taskType = String(task.task_type || '')
  const payload = task.payload || {}
  if (payload.expiry_recognition || payload.exercise) return false
  if (taskType === 'exercise' || taskType.startsWith('exercise')) return false
  if (taskType === 'health_report' || taskType === 'public_food_library_text') return false
  if (isPackagedAnalyzeHistoryTask(task)) return true
  if (taskType === 'food' || taskType.startsWith('food_')) return true
  if (taskType === 'food_text' || taskType.startsWith('food_text')) return true
  if (taskType.startsWith('precision_')) return true
  return false
}

function isAnalyzeRetryable(task: AnalysisTask): boolean {
  if (isPackagedAnalyzeHistoryTask(task)) return false
  const status = String(task.status || '')
  return status === 'failed' || status === 'timed_out'
}

function analyzeHistoryImageUrl(task: AnalysisTask): string {
  const primary = String(task.image_url || '').trim()
  if (primary) return primary
  const imagePaths = Array.isArray(task.image_paths) ? task.image_paths : []
  return String(imagePaths[0] || '').trim()
}

function analyzeHistoryTitle(task: AnalysisTask): string {
  if (task.status === 'violated') return '内容未通过审核'
  if (isTextAnalysisTask(task)) {
    const text = String(task.text_input || '').replace(/\s+/g, ' ').trim()
    return text || '文字记录'
  }
  const result = (task.result || {}) as Record<string, any>
  const packaged = (result.packaged_product || result.nutrition || {}) as Record<string, any>
  if (isPackagedAnalyzeHistoryTask(task)) {
    return String(packaged.product_name || packaged.name || '包装食品识别').trim()
  }
  const firstItem = task.result?.items?.[0]?.name?.trim()
  if (firstItem) return firstItem
  const description = String(task.result?.description || '').trim()
  if (description) return description.slice(0, 24)
  return task.status === 'done' ? '饮食分析结果' : '图片记录'
}

function analyzeHistoryAvatarText(task: AnalysisTask): string {
  if (isPackagedAnalyzeHistoryTask(task)) return '包'
  if (!isTextAnalysisTask(task)) return '图'
  const text = String(task.text_input || '').replace(/\s+/g, '').trim()
  return text ? text.slice(0, Math.min(2, text.length)) : '文'
}

function analyzeHistoryStatusLabel(task: AnalysisTask): string {
  const status = String(task.status || '')
  if (status === 'pending' || status === 'queued' || status === 'processing' || status === 'running') return '正在识别'
  if (status === 'done') {
    if (task.is_recorded === true) return '已经记录'
    if (task.is_recorded === false) return '等待记录'
    return '已完成'
  }
  if (status === 'failed' || status === 'timed_out') return '点我重试'
  if (status === 'violated') return '未通过'
  if (status === 'cancelled') return '已取消'
  return taskStatusLabel(task.status)
}

function analyzeHistoryCalories(task: AnalysisTask): number {
  const total = numberFrom(task.result?.total_calories, 0)
  if (total > 0) return total
  return (task.result?.items || []).reduce((sum, item) => sum + numberFrom(item.nutrients?.calories, 0), 0)
}

function analyzeHistoryMeta(task: AnalysisTask): string {
  const status = String(task.status || '')
  if (status === 'violated') return userFacingMessage(task.error_message, '该记录因内容问题不可查看')
  if (status === 'failed' || status === 'timed_out') return '识别没有成功 · 可用原内容重新识别'
  const kind = isPackagedAnalyzeHistoryTask(task) ? '包装食品' : isTextAnalysisTask(task) ? '文字记录' : '图片记录'
  const count = task.result?.items?.length || 0
  const calories = analyzeHistoryCalories(task)
  const parts = [formatDateTime(task.created_at), kind]
  if (count > 0) parts.push(`${count} 项食物`)
  if (calories > 0) parts.push(`${Math.round(calories)} kcal`)
  return parts.filter(Boolean).join(' · ')
}

function notificationTabApiType(tab: NotificationTab): string | undefined {
  if (tab === 'like') return 'like_received'
  if (tab === 'comment') return 'comment_received'
  return undefined
}

function notificationMatchesTab(item: CommunityNotificationItem, tab: NotificationTab): boolean {
  if (tab === 'all') return true
  const type = notificationType(item)
  if (tab === 'like') return type === 'like_received' || type.includes('like')
  return type === 'comment_received' || type === 'reply_received' || type === 'comment_rejected'
}

function notificationEmptyText(tab: NotificationTab): string {
  if (tab === 'like') return '暂无点赞'
  if (tab === 'comment') return '暂无评论'
  return '暂无互动消息'
}

function notificationTitle(item: CommunityNotificationItem): string {
  const actor = item.actor?.nickname || '有人'
  const type = notificationType(item)
  if (type === 'like_received' || type.includes('like')) return `${actor}赞了你的动态`
  if (type === 'comment_received') return `${actor}评论了你的动态`
  if (type === 'reply_received') return `${actor}回复了你的评论`
  if (type === 'comment_rejected') return '你的评论未通过审核'
  return '你收到一条互动消息'
}

function notificationContent(item: CommunityNotificationItem): string {
  if (notificationType(item) === 'comment_rejected') {
    return item.content_preview || '系统拦截了一条评论，点击查看详情'
  }
  return item.content_preview || '点击查看详情'
}

function notificationType(item: CommunityNotificationItem): string {
  return String(item.notification_type || '').trim().toLowerCase()
}

function notificationTargetId(item: CommunityNotificationItem): string {
  return String(item.target_id || item.record_id || '').trim()
}

function notificationTargetType(item: CommunityNotificationItem): CommunityFeedTargetType {
  const raw = String(item.target_type || 'food_record').trim()
  return (raw || 'food_record') as CommunityFeedTargetType
}

function notificationAvatarText(item: CommunityNotificationItem): string {
  const actor = item.actor?.nickname?.trim()
  if (actor) return actor.slice(0, 1)
  if (notificationType(item) === 'comment_rejected') return '审'
  return '信'
}

function friendUserSubtitle(user: FriendUserItem): string {
  if (user.is_friend) return '已在好友列表'
  if (user.is_pending) return '好友请求已发送'
  return '可发送好友请求'
}

function friendUserId(user: FriendUserItem): string {
  return String(user.id || '').trim()
}

function friendDisplayName(user: FriendUserItem): string {
  return String(user.nickname || '').trim() || '用户'
}

function friendRequestStatus(input?: string | FriendRequestItem): string {
  const status = typeof input === 'string' ? input : input?.status
  return String(status || 'pending').trim().toLowerCase() || 'pending'
}

function friendRequestStatusLabel(status?: string | FriendRequestItem): string {
  const labels: Record<string, string> = {
    pending: '等待对方处理',
    accepted: '已通过',
    rejected: '已拒绝',
    canceled: '已取消',
    cancelled: '已取消',
    expired: '已过期',
  }
  return labels[friendRequestStatus(status)] || '等待对方处理'
}

function friendRequestUserId(request: FriendRequestItem): string {
  return String(request.counterpart_user_id || request.from_user_id || request.to_user_id || '').trim()
}

function friendRequestDisplayName(request: FriendRequestItem): string {
  return String(request.counterpart_nickname || request.from_nickname || '').trim() || '用户'
}

function friendRequestAvatar(request: FriendRequestItem): string | undefined {
  return String(request.counterpart_avatar || request.from_avatar || '').trim() || undefined
}

function friendRequestTimeLabel(request: FriendRequestItem): string {
  return request.created_at ? formatDateTime(request.created_at) : ''
}

function formatBadgeCount(count: number): string {
  return count > 99 ? '99+' : String(count)
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
  friendCardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  friendInfoRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minWidth: 0,
  },
  friendActionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    gap: 8,
    maxWidth: 172,
  },
  friendAvatarFallback: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.brandSoft,
  },
  friendAvatarImage: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.surfaceMuted,
  },
  friendAvatarText: {
    color: colors.brandDark,
    fontSize: 18,
    fontWeight: '900',
  },
  historyTaskRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  historyTaskThumb: {
    width: 62,
    height: 62,
    borderRadius: 16,
    backgroundColor: colors.surfaceMuted,
  },
  historyTaskThumbFallback: {
    width: 62,
    height: 62,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.brandSoft,
  },
  historyTaskThumbText: {
    color: colors.brandDark,
    fontWeight: '900',
  },
  historyTaskTitle: {
    flex: 1,
    color: colors.text,
    fontSize: 16,
    fontWeight: '900',
  },
  historyTaskTags: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 10,
  },
  manualHeroCard: {
    backgroundColor: colors.brandSoft,
  },
  manualHeroKcal: {
    minWidth: 92,
    alignItems: 'flex-end',
  },
  manualHeroKcalValue: {
    color: colors.brandDark,
    fontSize: 30,
    fontWeight: '900',
  },
  manualHeroKcalUnit: {
    color: colors.brandDark,
    fontSize: 12,
    fontWeight: '800',
  },
  buttonRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 14,
  },
  aboutHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginBottom: 14,
  },
  aboutLogo: {
    width: 56,
    height: 56,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.brandSoft,
  },
  aboutLogoText: {
    color: colors.brandDark,
    fontSize: 25,
    fontWeight: '900',
  },
  aboutName: {
    color: colors.text,
    fontSize: 20,
    fontWeight: '900',
  },
  aboutText: {
    color: colors.textSecondary,
    fontSize: 13,
    lineHeight: 20,
    marginBottom: 12,
  },
  feedbackHero: {
    gap: 6,
    marginBottom: 18,
  },
  feedbackHeroTitle: {
    color: colors.text,
    fontSize: 20,
    fontWeight: '900',
  },
  feedbackHeroDesc: {
    color: colors.textSecondary,
    fontSize: 13,
    lineHeight: 20,
  },
  feedbackCategoryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 12,
    marginBottom: 16,
  },
  feedbackCategoryCard: {
    flexGrow: 1,
    flexBasis: '47%',
    minHeight: 92,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    justifyContent: 'center',
    paddingHorizontal: 12,
    paddingVertical: 14,
    backgroundColor: colors.surfaceMuted,
  },
  feedbackCategoryCardActive: {
    borderColor: colors.brand,
    backgroundColor: colors.brandSoft,
  },
  feedbackCategoryTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '900',
  },
  feedbackCategoryTitleActive: {
    color: colors.brandDark,
  },
  feedbackCategoryDesc: {
    color: colors.textSecondary,
    fontSize: 12,
    lineHeight: 17,
    marginTop: 6,
  },
  formHint: {
    color: colors.textSecondary,
    fontSize: 12,
    lineHeight: 18,
    marginTop: -8,
    marginBottom: 12,
  },
  formHintWarning: {
    color: colors.warning,
  },
  imageBlock: {
    marginTop: 12,
    marginBottom: 6,
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
  previewImage: {
    width: '100%',
    height: 210,
    borderRadius: 16,
    marginTop: 8,
    marginBottom: 8,
    backgroundColor: colors.surfaceMuted,
  },
  recordImageGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 12,
    marginBottom: 4,
  },
  recordImageThumb: {
    width: 92,
    height: 92,
    borderRadius: 14,
    backgroundColor: colors.surfaceMuted,
  },
  notificationRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  notificationAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.brandSoft,
  },
  notificationAvatarImage: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.surfaceMuted,
  },
  notificationAvatarText: {
    color: colors.brandDark,
    fontWeight: '900',
  },
  notificationTabs: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 16,
  },
  notificationTabItem: {
    flex: 1,
    minHeight: 40,
    borderRadius: 12,
    paddingHorizontal: 8,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 6,
    backgroundColor: colors.surfaceMuted,
  },
  notificationTabItemActive: {
    backgroundColor: colors.brand,
  },
  notificationTabText: {
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: '800',
  },
  notificationTabTextActive: {
    color: '#fff',
  },
  notificationTabBadge: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    paddingHorizontal: 6,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.brandSoft,
  },
  notificationTabBadgeActive: {
    backgroundColor: '#fff',
  },
  notificationTabBadgeText: {
    color: colors.brandDark,
    fontSize: 11,
    fontWeight: '900',
  },
  notificationTabBadgeTextActive: {
    color: colors.brand,
  },
  summaryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 14,
    marginBottom: 8,
  },
  summaryCell: {
    flexGrow: 1,
    flexBasis: '46%',
    minHeight: 72,
    borderRadius: 14,
    padding: 12,
    backgroundColor: colors.surfaceMuted,
  },
  summaryValue: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '900',
  },
  summaryUnit: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '700',
  },
  summaryTitle: {
    marginTop: 5,
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '700',
  },
  rewardHero: {
    backgroundColor: colors.brandSoft,
  },
  quickRewardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 13,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  rewardActionText: {
    color: colors.brandDark,
    fontWeight: '900',
  },
  rewardProgressTrack: {
    height: 8,
    borderRadius: 999,
    backgroundColor: colors.surfaceMuted,
    overflow: 'hidden',
    marginTop: 14,
    marginBottom: 10,
  },
  rewardProgressFill: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: colors.brand,
  },
  editItemBox: {
    marginTop: 12,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  selectedFoodBox: {
    paddingTop: 14,
    marginTop: 10,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  ratioGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 10,
  },
  ratioButton: {
    minWidth: 62,
    minHeight: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceMuted,
  },
  ratioButtonActive: {
    backgroundColor: colors.brand,
  },
  ratioButtonText: {
    color: colors.textSecondary,
    fontWeight: '800',
  },
  ratioButtonTextActive: {
    color: '#fff',
  },
  nutritionGrid: {
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
    marginTop: 6,
    color: colors.textSecondary,
    lineHeight: 20,
  },
  errorText: {
    marginTop: 6,
    color: colors.danger,
    lineHeight: 20,
  },
  empty: {
    color: colors.textMuted,
    textAlign: 'center',
  },
  kcal: {
    color: colors.brandDark,
    fontWeight: '900',
  },
  itemRow: {
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  logRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  itemName: {
    color: colors.text,
    fontWeight: '800',
  },
  itemMeta: {
    marginTop: 3,
    color: colors.textSecondary,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  status: {
    color: colors.warning,
    fontWeight: '800',
  },
  exerciseTaskHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  exerciseTaskTitleWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minWidth: 0,
  },
  field: {
    marginBottom: 14,
  },
  fieldLabelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
    marginBottom: 6,
  },
  fieldLabel: {
    color: colors.textSecondary,
    fontWeight: '700',
  },
  fieldMeta: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '700',
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
  textQuickTags: {
    marginTop: -4,
    marginBottom: 14,
  },
  textQuickTagsLabel: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '800',
    marginBottom: 8,
  },
  textQuickTagsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  textQuickTag: {
    minHeight: 34,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
    backgroundColor: colors.brandSoft,
  },
  textQuickTagText: {
    color: colors.brandDark,
    fontSize: 12,
    fontWeight: '900',
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
  statGrid: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 16,
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
  quickGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 14,
  },
  quickButton: {
    minWidth: '47%',
    minHeight: 48,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.brandSoft,
  },
  quickButtonText: {
    color: colors.brandDark,
    fontWeight: '900',
  },
  manualAdjustRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 12,
  },
  manualAdjustButton: {
    minHeight: 36,
    minWidth: 64,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceMuted,
  },
  manualAdjustText: {
    color: colors.text,
    fontWeight: '800',
  },
  foodChoiceAdd: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.brand,
  },
  foodChoiceAddText: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '900',
  },
  foodChoiceAdded: {
    minWidth: 48,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
    backgroundColor: colors.brandSoft,
  },
  foodChoiceAddedText: {
    color: colors.brandDark,
    fontSize: 12,
    fontWeight: '900',
  },
  chipWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  waterChip: {
    borderRadius: 999,
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: colors.surfaceMuted,
  },
  waterChipText: {
    color: colors.text,
    fontWeight: '800',
  },
  waterChipDelete: {
    marginTop: 2,
    color: colors.danger,
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'center',
  },
  miniStat: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: 18,
    padding: 14,
  },
  statValue: {
    color: colors.text,
    fontSize: 22,
    fontWeight: '900',
  },
  statTitle: {
    marginTop: 4,
    color: colors.textSecondary,
    fontSize: 12,
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
    backgroundColor: colors.surfaceMuted,
  },
  smallButtonText: {
    color: colors.brandDark,
    fontWeight: '800',
  },
  smallButtonDangerText: {
    color: colors.danger,
  },
  smallButtonTextDisabled: {
    color: colors.textMuted,
  },
  listEndText: {
    marginTop: 4,
    marginBottom: 10,
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'center',
  },
  qrWrap: {
    alignItems: 'center',
    marginTop: 14,
    padding: 14,
    borderRadius: 16,
    backgroundColor: colors.surfaceMuted,
  },
  qrImage: {
    width: 220,
    height: 220,
    marginBottom: 10,
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
    alignItems: 'flex-start',
    gap: 12,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  infoLabel: {
    color: colors.textSecondary,
    flexShrink: 0,
  },
  infoValue: {
    flex: 1,
    color: colors.text,
    fontWeight: '800',
    lineHeight: 20,
    textAlign: 'right',
    flexShrink: 1,
  },
  unreadCard: {
    borderWidth: 1,
    borderColor: colors.brand,
  },
})
