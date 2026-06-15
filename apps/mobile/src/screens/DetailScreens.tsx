import AsyncStorage from '@react-native-async-storage/async-storage'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Alert, Image, Pressable, Share, StyleSheet, Switch, Text, TextInput, View } from 'react-native'
import * as ImagePicker from 'expo-image-picker'
import { useFocusEffect, useNavigation, useRoute, type RouteProp } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import {
  getMealTypeLabel,
  inferDefaultMealTypeFromLocalTime,
  type AnalysisTask,
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
import { apiClient } from '../api'
import { AppButton } from '../components/AppButton'
import { Card } from '../components/Card'
import { Page } from '../components/Page'
import type { RootStackParamList } from '../navigation/types'
import { colors } from '../theme'
import { formatDateTime, todayKey } from '../utils/date'

const userGroupQr = require('../../assets/community/foodlink-user-group-permanent-20260602.jpg')

const mealOptions: MealType[] = ['breakfast', 'morning_snack', 'lunch', 'afternoon_snack', 'dinner', 'evening_snack']
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

const defaultExpireDate = () => {
  const nextWeek = new Date()
  nextWeek.setDate(nextWeek.getDate() + 7)
  return todayKey(nextWeek)
}

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
      showError('获取记录失败', error)
    } finally {
      setLoading(false)
    }
  }, [date])

  useEffect(() => {
    void load()
  }, [load])

  const totalKcal = records.reduce((sum, record) => sum + Number(record.total_calories || 0), 0)
  const totalProtein = records.reduce((sum, record) => sum + Number(record.total_protein || 0), 0)
  const totalCarbs = records.reduce((sum, record) => sum + Number(record.total_carbs || 0), 0)
  const totalFat = records.reduce((sum, record) => sum + Number(record.total_fat || 0), 0)

  const shareDay = async () => {
    if (records.length === 0) {
      Alert.alert('暂无可分享记录', '这一天还没有饮食记录。')
      return
    }
    try {
      const result = await Share.share({
        title: `${date} 饮食记录`,
        message: buildDayShareMessage(date, records),
      })
      if (result.action === Share.dismissedAction) return
      const reward = await apiClient.claimSharePosterReward({ shareScope: 'daily_food', shareDate: date })
      showShareRewardAlert(reward)
    } catch (error) {
      showError('分享失败', error)
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
      showError('获取详情失败', error)
    } finally {
      setLoading(false)
    }
  }, [editing, route.params.recordId, syncEditor])

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
      showShareRewardAlert(reward)
    } catch (error) {
      showError('分享失败', error)
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
      Alert.alert('至少保留一个食物', '饮食记录需要保留一项食物明细。')
      return
    }
    setEditItems((current) => current.filter((_, itemIndex) => itemIndex !== index))
  }

  const saveEdit = async () => {
    if (!record) return
    const items = editItems.map(editableRecordItemPayload)
    if (items.length === 0) {
      Alert.alert('无法保存', '请至少保留一项食物明细。')
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
      Alert.alert('已保存', '记录已更新')
    } catch (error) {
      showError('保存失败', error)
    } finally {
      setSaving(false)
    }
  }

  const remove = () => {
    Alert.alert('删除记录', '确定删除这条饮食记录吗？', [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: async () => {
          try {
            await apiClient.deleteFoodRecord(route.params.recordId)
            Alert.alert('已删除', '记录已删除')
            navigation.goBack()
          } catch (error) {
            showError('删除失败', error)
          }
        },
      },
    ])
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
  const [tasks, setTasks] = useState<AnalysisTask[]>([])
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await apiClient.listAnalyzeTasks({ limit: 50 })
      setTasks(data.tasks || [])
    } catch (error) {
      showError('获取识别历史失败', error)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <Page title="识别历史" subtitle="最近的图片和文字分析任务" refreshing={loading} onRefresh={load}>
      {tasks.length === 0 ? <EmptyState text="暂无识别任务" /> : null}
      {tasks.map((task) => (
        <Pressable
          key={task.id}
          onPress={() => {
            const taskType = isTextAnalysisTask(task) ? 'food_text' : 'food'
            if (task.status === 'done' && taskType === 'food_text') {
              navigation.navigate('TextResult', {
                task,
                mealType: 'lunch',
                date: todayKey(),
              })
              return
            }
            if (task.status === 'done') {
              navigation.navigate('Result', {
                task,
                mealType: 'lunch',
                date: todayKey(),
              })
              return
            }
            navigation.navigate('AnalyzeLoading', {
              taskId: task.id,
              mealType: 'lunch',
              date: todayKey(),
              taskType,
            })
          }}
        >
          <Card>
            <View style={styles.rowBetween}>
              <Text style={styles.sectionTitle}>{task.result?.items?.[0]?.name || task.text_input || '食物识别'}</Text>
              <Text style={styles.status}>{taskStatusLabel(task.status)}</Text>
            </View>
            <Text style={styles.subtitle}>{formatDateTime(task.created_at)} · {Math.round(task.result?.total_calories || 0)} kcal</Text>
          </Card>
        </Pressable>
      ))}
    </Page>
  )
}

export function TextRecordScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  const [text, setText] = useState('')
  const [additionalContext, setAdditionalContext] = useState('')
  const [date, setDate] = useState(todayKey())
  const [mealType, setMealType] = useState<MealType>(inferDefaultMealTypeFromLocalTime())
  const [loading, setLoading] = useState(false)

  const submit = async () => {
    setLoading(true)
    try {
      const data = await apiClient.submitTextTask({ text, additionalContext, mealType, date })
      navigation.navigate('AnalyzeLoading', { taskId: data.task_id, mealType, date, taskType: 'food_text' })
    } catch (error) {
      showError('提交失败', error)
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
  const [browse, setBrowse] = useState<ManualFoodBrowseResult | null>(null)
  const [results, setResults] = useState<ManualFoodItem[]>([])
  const [selected, setSelected] = useState<ManualFoodItem | null>(null)
  const [query, setQuery] = useState('')
  const [weight, setWeight] = useState('100')
  const [date, setDate] = useState(todayKey())
  const [mealType, setMealType] = useState<MealType>(inferDefaultMealTypeFromLocalTime())
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await apiClient.getManualFoodBrowse(20)
      setBrowse(data)
    } catch (error) {
      showError('获取食物库失败', error)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const search = async () => {
    setLoading(true)
    try {
      const data = await apiClient.searchManualFood(query, 30)
      setResults(data.results || [])
    } catch (error) {
      showError('搜索失败', error)
    } finally {
      setLoading(false)
    }
  }

  const save = async () => {
    if (!selected) {
      Alert.alert('请选择食物')
      return
    }
    setLoading(true)
    try {
      await apiClient.saveManualFoodRecord({
        item: selected,
        mealType,
        date,
        weight: Number(weight) || undefined,
      })
      Alert.alert('已保存', '饮食记录已写入')
    } catch (error) {
      showError('保存失败', error)
    } finally {
      setLoading(false)
    }
  }

  const recommended = useMemo(() => flattenManualFoodBrowse(browse), [browse])
  const list = results.length ? results : recommended

  return (
    <Page title="手动记录" subtitle="从食物库选择后保存" refreshing={loading} onRefresh={load}>
      <Card>
        <MealPicker value={mealType} onChange={setMealType} />
        <Field label="日期" value={date} onChangeText={setDate} />
        <Field label="搜索食物" value={query} onChangeText={setQuery} placeholder="米饭、鸡蛋、牛奶" />
        <AppButton label="搜索" variant="secondary" loading={loading} onPress={search} />
      </Card>

      {selected ? (
        <Card>
          <Text style={styles.sectionTitle}>{manualFoodTitle(selected)}</Text>
          <Field label="重量 g" value={weight} onChangeText={setWeight} keyboardType="decimal-pad" />
          <AppButton label="保存为饮食记录" loading={loading} onPress={save} />
        </Card>
      ) : null}

      {list.length === 0 ? <EmptyState text="没有可选食物" /> : null}
      {list.map((item, index) => (
        <FoodChoice key={`${manualFoodTitle(item)}-${item.id || index}`} item={item} onPress={() => {
          setSelected(item)
          setWeight(String(Math.round(Number(item.default_weight_grams || 100))))
        }} />
      ))}
    </Page>
  )
}

export function FoodLibraryScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  const [browse, setBrowse] = useState<ManualFoodBrowseResult | null>(null)
  const [customFoods, setCustomFoods] = useState<ManualFoodItem[]>([])
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<ManualFoodItem[]>([])
  const [name, setName] = useState('')
  const [calories, setCalories] = useState('')
  const [protein, setProtein] = useState('')
  const [carbs, setCarbs] = useState('')
  const [fat, setFat] = useState('')
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
      showError('获取食物库失败', error)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const search = async () => {
    setLoading(true)
    try {
      const data = await apiClient.searchManualFood(query, 40)
      setResults(data.results || [])
    } catch (error) {
      showError('搜索失败', error)
    } finally {
      setLoading(false)
    }
  }

  const saveCustom = async () => {
    setLoading(true)
    try {
      await apiClient.saveCustomFood({
        title: name,
        totalCalories: Number(calories) || 0,
        totalProtein: Number(protein) || 0,
        totalCarbs: Number(carbs) || 0,
        totalFat: Number(fat) || 0,
      })
      setName('')
      setCalories('')
      setProtein('')
      setCarbs('')
      setFat('')
      await load()
      Alert.alert('已保存', '自定义食物已加入食物库')
    } catch (error) {
      showError('保存失败', error)
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
        <Field label="热量 kcal/100g" value={calories} onChangeText={setCalories} keyboardType="decimal-pad" />
        <Field label="蛋白质 g/100g" value={protein} onChangeText={setProtein} keyboardType="decimal-pad" />
        <Field label="碳水 g/100g" value={carbs} onChangeText={setCarbs} keyboardType="decimal-pad" />
        <Field label="脂肪 g/100g" value={fat} onChangeText={setFat} keyboardType="decimal-pad" />
        <AppButton label="保存食物" loading={loading} onPress={saveCustom} />
      </Card>

      <SectionList title="搜索结果" items={results} onItemPress={openDetail} />
      <SectionList title="我的食物" items={customFoods} onItemPress={openDetail} />
      <SectionList title="推荐食物" items={flattenManualFoodBrowse(browse)} onItemPress={openDetail} />
    </Page>
  )
}

export function HealthProfileScreen() {
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
      showError('获取健康档案失败', error)
    } finally {
      setLoading(false)
    }
  }, [])

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
      Alert.alert('已保存', '健康档案已更新')
    } catch (error) {
      showError('保存失败', error)
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
  const type = route.params.type
  const [summary, setSummary] = useState<BodyMetricsSummary | null>(null)
  const [logs, setLogs] = useState<ExerciseLogItem[]>([])
  const [date, setDate] = useState(todayKey())
  const [value, setValue] = useState(type === 'water' ? '250' : '')
  const [exerciseDesc, setExerciseDesc] = useState('')
  const [exerciseImageUri, setExerciseImageUri] = useState('')
  const [exerciseImageUrl, setExerciseImageUrl] = useState('')
  const [exerciseTask, setExerciseTask] = useState<{ taskId: string; desc: string; status: string; errorMessage?: string } | null>(null)
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
      showError('获取身体记录失败', error)
    } finally {
      setLoading(false)
    }
  }, [date, type])

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
          Alert.alert('体重范围不正确', '请输入 20-300kg 的体重')
          return
        }
        await apiClient.saveBodyWeightRecord(nextValue, date, `weight-${date}-${Date.now()}`)
      } else if (type === 'water') {
        const amount = overrideValue ?? Number(value)
        if (!Number.isFinite(amount) || amount <= 0 || amount > 5000) {
          Alert.alert('水量范围不正确', '请输入 1-5000ml')
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
      Alert.alert(type === 'exercise' ? '已提交' : '已保存', type === 'exercise' ? '运动分析任务已提交，完成后会写入当天记录。' : '记录已更新')
    } catch (error) {
      showError('保存失败', error)
    } finally {
      setLoading(false)
    }
  }

  const pollExerciseTask = async (taskId: string, desc: string) => {
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
        setExerciseTask({ taskId, desc, status: 'failed', errorMessage: error instanceof Error ? error.message : '刷新任务失败' })
        return
      }
    }
    setExerciseTask({ taskId, desc, status: 'failed', errorMessage: '分析时间较长，请稍后手动刷新。' })
  }

  const refreshExerciseTask = async () => {
    if (!exerciseTask?.taskId) return
    await pollExerciseTask(exerciseTask.taskId, exerciseTask.desc)
  }

  const pickExerciseImage = async () => {
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync()
      if (!permission.granted) {
        Alert.alert('无法访问相册', '请在系统设置中允许访问相册后再添加运动截图。')
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
      showError('上传运动截图失败', error)
    } finally {
      setLoading(false)
    }
  }

  const deleteWeight = async (recordId?: string) => {
    if (!recordId) {
      Alert.alert('无法删除', '这条体重记录缺少 ID')
      return
    }
    setMutatingId(recordId)
    try {
      await apiClient.deleteBodyWeightRecord(recordId)
      await load()
    } catch (error) {
      showError('删除体重记录失败', error)
    } finally {
      setMutatingId('')
    }
  }

  const deleteWater = async (logId?: string) => {
    if (!logId) {
      Alert.alert('无法删除', '这条喝水记录缺少 ID，可使用清空当天')
      return
    }
    setMutatingId(logId)
    try {
      await apiClient.deleteBodyWaterLog(logId)
      await load()
    } catch (error) {
      showError('删除喝水记录失败', error)
    } finally {
      setMutatingId('')
    }
  }

  const resetWater = async () => {
    if (currentWaterTotal <= 0) return
    setMutatingId('water-reset')
    try {
      await apiClient.resetBodyWaterLogs(date)
      await load()
    } catch (error) {
      showError('清空喝水记录失败', error)
    } finally {
      setMutatingId('')
    }
  }

  const deleteExercise = async (logId: string) => {
    setMutatingId(logId)
    try {
      await apiClient.deleteExerciseLog(logId)
      await load()
    } catch (error) {
      showError('删除运动记录失败', error)
    } finally {
      setMutatingId('')
    }
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
                <SmallButton label={mutatingId === entry.id ? '删除中' : '删除'} danger onPress={() => void deleteWeight(entry.id)} />
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
              <SmallButton label={mutatingId === 'water-reset' ? '清空中' : '清空当天'} danger onPress={() => void resetWater()} />
            </View>
          </Card>
          <Card>
            <Text style={styles.sectionTitle}>当天明细</Text>
            {waterLogs.length === 0 ? <Text style={styles.empty}>这一天还没有喝水记录</Text> : null}
            <View style={styles.chipWrap}>
              {waterLogs.map((log, index) => {
                const logId = String(log.id || `fallback-${index}`)
                return (
                  <Pressable key={logId} style={styles.waterChip} onPress={() => log.id ? void deleteWater(log.id) : undefined}>
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
              <View style={styles.rowBetween}>
                <View style={styles.flex}>
                  <Text style={styles.sectionTitle}>运动分析任务</Text>
                  <Text style={styles.subtitle}>{exerciseTask.desc} · {exerciseTaskStatusLabel(exerciseTask.status)}</Text>
                  {exerciseTask.errorMessage ? <Text style={styles.errorText}>{exerciseTask.errorMessage}</Text> : null}
                </View>
                <SmallButton label="刷新" onPress={() => void refreshExerciseTask()} />
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
                <SmallButton label={mutatingId === log.id ? '删除中' : '删除'} danger onPress={() => void deleteExercise(log.id)} />
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
      showError('获取保质期失败', error)
    } finally {
      setLoading(false)
    }
  }, [])

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
      Alert.alert('已保存', '食物保质期已加入')
    } catch (error) {
      showError('保存失败', error)
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
      showError('更新失败', error)
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
            <Pill text={item.urgency_label || item.status || 'active'} />
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
  const [reward, setReward] = useState<RewardCenterResponse | null>(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setReward(await apiClient.getRewardCenter())
    } catch (error) {
      showError('获取积分失败', error)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

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
      showError('加载动态失败', error)
    } finally {
      setLoading(false)
    }
  }, [postId])

  useEffect(() => {
    void load()
  }, [load])

  const pickImages = async () => {
    const remaining = CIRCLE_POST_MAX_IMAGES - imageUrls.length
    if (remaining <= 0) {
      Alert.alert('图片已满', `最多上传 ${CIRCLE_POST_MAX_IMAGES} 张图片。`)
      return
    }
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (!permission.granted) {
      Alert.alert('需要相册权限', '请选择动态图片。')
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
      showError('上传动态图片失败', error)
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
      Alert.alert(postId ? '已保存' : '已发布', postId ? '动态修改已保存' : '动态已发布到圈子')
      navigation.goBack()
    } catch (error) {
      showError(postId ? '保存失败' : '发布失败', error)
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
  const [friends, setFriends] = useState<FriendUserItem[]>([])
  const [received, setReceived] = useState<FriendRequestItem[]>([])
  const [sent, setSent] = useState<FriendRequestItem[]>([])
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<FriendUserItem[]>([])
  const [loading, setLoading] = useState(false)

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
      showError('获取好友失败', error)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const search = async () => {
    setLoading(true)
    try {
      const data = await apiClient.searchFriends(query)
      setResults(data.list || [])
    } catch (error) {
      showError('搜索失败', error)
    } finally {
      setLoading(false)
    }
  }

  const send = async (id: string) => {
    try {
      await apiClient.sendFriendRequest(id)
      await load()
      Alert.alert('已发送', '好友请求已发送')
    } catch (error) {
      showError('发送失败', error)
    }
  }

  const respond = async (id: string, action: 'accept' | 'reject') => {
    try {
      await apiClient.respondFriendRequest(id, action)
      await load()
    } catch (error) {
      showError('处理失败', error)
    }
  }

  return (
    <Page title="好友" subtitle={`${friends.length} 位好友`} refreshing={loading} onRefresh={load}>
      <Card>
        <Field label="搜索昵称" value={query} onChangeText={setQuery} />
        <AppButton label="搜索用户" variant="secondary" loading={loading} onPress={search} />
      </Card>
      {results.map((user) => (
        <UserRow key={user.id} user={user} actionLabel={user.is_friend ? '已是好友' : user.is_pending ? '已申请' : '添加'} onAction={() => !user.is_friend && !user.is_pending ? send(user.id) : undefined} />
      ))}
      {received.length ? <Text style={styles.groupTitle}>收到的请求</Text> : null}
      {received.map((req) => (
        <Card key={req.id}>
          <Text style={styles.itemName}>{req.counterpart_nickname || req.from_nickname || '用户'}</Text>
          <Text style={styles.subtitle}>{req.created_at ? formatDateTime(req.created_at) : ''}</Text>
          <View style={styles.buttonRow}>
            <SmallButton label="接受" onPress={() => respond(req.id, 'accept')} />
            <SmallButton label="拒绝" danger onPress={() => respond(req.id, 'reject')} />
          </View>
        </Card>
      ))}
      {sent.length ? <Text style={styles.groupTitle}>发出的请求</Text> : null}
      {sent.map((req) => (
        <Card key={req.id}>
          <Text style={styles.itemName}>{req.counterpart_nickname || '用户'}</Text>
          <Text style={styles.subtitle}>{req.status || 'pending'}</Text>
        </Card>
      ))}
      {friends.length ? <Text style={styles.groupTitle}>好友列表</Text> : null}
      {friends.map((friend) => (
        <UserRow key={friend.id} user={friend} actionLabel="删除" danger onAction={async () => {
          await apiClient.deleteFriend(friend.id)
          await load()
        }} />
      ))}
    </Page>
  )
}

export function NotificationsScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  const [notifications, setNotifications] = useState<CommunityNotificationItem[]>([])
  const [unread, setUnread] = useState(0)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await apiClient.listCommunityNotifications(80)
      setNotifications(data.list || [])
      setUnread(data.unread_count || 0)
    } catch (error) {
      showError('获取消息失败', error)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const markRead = async () => {
    if (unread <= 0) return
    setLoading(true)
    try {
      const unreadIds = notifications.filter((item) => !item.is_read).map((item) => item.id)
      const data = await apiClient.markCommunityNotificationsRead(unreadIds)
      setUnread(data.unread_count || 0)
      await load()
    } catch (error) {
      showError('标记失败', error)
    } finally {
      setLoading(false)
    }
  }

  const openNotification = async (item: CommunityNotificationItem) => {
    const targetId = notificationTargetId(item)
    if (!targetId) {
      Alert.alert('未找到对应动态')
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
    <Page title="互动消息" subtitle={`${unread} 条未读`} refreshing={loading} onRefresh={load}>
      <Card>
        <Text style={styles.sectionTitle}>互动收件箱</Text>
        <Text style={styles.subtitle}>点赞、评论、回复和审核结果都会显示在这里。</Text>
        <AppButton label={unread > 0 ? '全部标记已读' : '暂无未读'} variant="secondary" loading={loading} onPress={markRead} />
      </Card>
      {notifications.length === 0 ? <EmptyState text="暂无互动消息" /> : null}
      {notifications.map((item) => (
        <Pressable key={item.id} onPress={() => openNotification(item)}>
          <Card style={!item.is_read ? styles.unreadCard : undefined}>
            <View style={styles.notificationRow}>
              <View style={styles.notificationAvatar}>
                {item.actor?.avatar ? (
                  <Image source={{ uri: item.actor.avatar }} style={styles.notificationAvatarImage} />
                ) : (
                  <Text style={styles.notificationAvatarText}>{notificationAvatarText(item)}</Text>
                )}
              </View>
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
    </Page>
  )
}

export function AboutFeedbackScreen() {
  const [category, setCategory] = useState<'bug' | 'suggestion' | 'experience' | 'other'>('bug')
  const [content, setContent] = useState('')
  const [contact, setContact] = useState('')
  const [feedbackImageUrls, setFeedbackImageUrls] = useState<string[]>([])
  const [searchable, setSearchable] = useState(true)
  const [publicRecords, setPublicRecords] = useState(true)
  const [loading, setLoading] = useState(false)
  const [savingPrivacy, setSavingPrivacy] = useState<'searchable' | 'public_records' | null>(null)
  const [showGroupQr, setShowGroupQr] = useState(false)

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
    try {
      setLoading(true)
      await apiClient.submitFeedback({
        category,
        content,
        contact,
        pagePath: 'app://about-feedback',
        clientInfo: { surface: 'expo' },
        imageUrls: feedbackImageUrls,
      })
      setContent('')
      setContact('')
      setFeedbackImageUrls([])
      Alert.alert('已提交', '反馈已经进入处理队列。')
    } catch (error) {
      Alert.alert('提交失败', error instanceof Error ? error.message : '请稍后重试')
    } finally {
      setLoading(false)
    }
  }

  const pickFeedbackImages = async () => {
    const remaining = FEEDBACK_MAX_IMAGES - feedbackImageUrls.length
    if (remaining <= 0) return
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync()
      if (!permission.granted) {
        Alert.alert('无法访问相册', '请在系统设置中允许访问相册后再添加截图。')
        return
      }
      const picked = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsMultipleSelection: true,
        selectionLimit: remaining,
        quality: 0.86,
      })
      if (picked.canceled || !picked.assets.length) return
      setLoading(true)
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
      Alert.alert('上传图片失败', error instanceof Error ? error.message : '请稍后重试')
    } finally {
      setLoading(false)
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
      Alert.alert('设置失败', error instanceof Error ? error.message : '请稍后重试')
    } finally {
      setSavingPrivacy(null)
    }
  }

  const clearCache = async () => {
    try {
      const keys = await AsyncStorage.getAllKeys()
      const removable = keys.filter((key) => key.startsWith('food_link_mobile_') && !key.includes('access_token') && !key.includes('refresh_token') && !key.includes('user_id'))
      if (removable.length) await AsyncStorage.multiRemove(removable)
      Alert.alert('已清除', '本地缓存已清理，登录状态已保留。')
    } catch (error) {
      Alert.alert('清除失败', error instanceof Error ? error.message : '请稍后重试')
    }
  }

  return (
    <Page title="关于与反馈" subtitle="反馈、隐私、协议和用户群。 " refreshing={loading} onRefresh={load}>
      <Card>
        <Text style={styles.sectionTitle}>意见反馈</Text>
        <View style={styles.segment}>
          <SegmentButton label="问题" active={category === 'bug'} onPress={() => setCategory('bug')} />
          <SegmentButton label="建议" active={category === 'suggestion'} onPress={() => setCategory('suggestion')} />
          <SegmentButton label="体验" active={category === 'experience'} onPress={() => setCategory('experience')} />
          <SegmentButton label="其他" active={category === 'other'} onPress={() => setCategory('other')} />
        </View>
        <Field label="反馈内容" value={content} onChangeText={setContent} placeholder="描述问题、期望效果或发生时间" multiline />
        <FeedbackImagePickerGrid
          urls={feedbackImageUrls}
          loading={loading}
          onAdd={pickFeedbackImages}
          onRemove={removeFeedbackImage}
        />
        <Field label="联系方式" value={contact} onChangeText={setContact} placeholder="微信、手机号或邮箱（可选）" />
        <AppButton label="提交反馈" loading={loading} onPress={submit} />
      </Card>

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
          <SmallButton label={showGroupQr ? '收起二维码' : '查看用户群二维码'} onPress={() => setShowGroupQr((current) => !current)} />
          <SmallButton label="清除缓存" onPress={() => void clearCache()} />
        </View>
      </Card>
    </Page>
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

function FoodChoice({ item, onPress }: { item: ManualFoodItem; onPress: () => void }) {
  return (
    <Pressable onPress={onPress}>
      <Card>
        <View style={styles.rowBetween}>
          <Text style={styles.itemName}>{manualFoodTitle(item)}</Text>
          <Text style={styles.kcal}>{Math.round(numberFrom(item.total_calories ?? item.calories))} kcal</Text>
        </View>
        <Text style={styles.subtitle}>{Math.round(numberFrom(item.default_weight_grams, 100))}g · 蛋白 {Math.round(numberFrom(item.total_protein ?? item.protein))}g</Text>
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
        <Text style={styles.summaryUnit}> {unit}</Text>
      </Text>
      <Text style={styles.summaryTitle}>{title}</Text>
    </View>
  )
}

function UserRow({
  user,
  actionLabel,
  danger,
  onAction,
}: {
  user: FriendUserItem
  actionLabel: string
  danger?: boolean
  onAction: () => void | Promise<void>
}) {
  return (
    <Card>
      <View style={styles.rowBetween}>
        <View style={styles.flex}>
          <Text style={styles.itemName}>{user.nickname || '用户'}</Text>
          <Text style={styles.subtitle}>{user.id}</Text>
        </View>
        <SmallButton label={actionLabel} danger={danger} onPress={() => void onAction()} />
      </View>
    </Card>
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
            <Text style={styles.imageAddIcon}>+</Text>
            <Text style={styles.imageAddText}>{loading ? '上传中' : '添加图片'}</Text>
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
            <Text style={styles.imageAddIcon}>+</Text>
            <Text style={styles.imageAddText}>{loading ? '上传中' : '添加截图'}</Text>
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

function numberFrom(value: unknown, fallback = 0): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

function numberOrUndefined(value: string): number | undefined {
  const n = Number(value)
  return Number.isFinite(n) && value.trim() !== '' ? n : undefined
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

function showShareRewardAlert(result: Awaited<ReturnType<typeof apiClient.claimSharePosterReward>>) {
  Alert.alert('分享完成', result.message || (result.claimed ? `分享奖励 +${result.credits || 0} 积分` : '分享已完成'))
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

function showError(title: string, error: unknown) {
  Alert.alert(title, error instanceof Error ? error.message : '请稍后重试')
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

function exerciseTaskError(task: AnalysisTask): string {
  const raw = String(task.error_message || '').trim()
  if (!raw) return '运动分析失败'
  try {
    const parsed = JSON.parse(raw) as { message?: string }
    if (parsed.message) return parsed.message
  } catch {
    // Keep the server-provided plain text message.
  }
  return raw
}

function isTextAnalysisTask(task: AnalysisTask): boolean {
  if (task.task_type === 'food_text') return true
  return task.payload?.source_type === 'text'
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
  buttonRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 14,
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
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  infoLabel: {
    color: colors.textSecondary,
  },
  infoValue: {
    color: colors.text,
    fontWeight: '800',
  },
  unreadCard: {
    borderWidth: 1,
    borderColor: colors.brand,
  },
})
