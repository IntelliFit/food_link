import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import * as ImagePicker from 'expo-image-picker'
import { StatusBar } from 'expo-status-bar'
import {
  buildSaveFoodRecordRequestFromTask,
  getMealTypeLabel,
  inferDefaultMealTypeFromLocalTime,
  type AnalysisTask,
  type HomeDashboard,
  type MealType,
} from '@food-link/core'
import { apiClient, hasStoredToken } from './src/api'
import { API_BASE_URL } from './src/config'

type Screen = 'login' | 'home' | 'analyzing' | 'result'

const DEFAULT_DEBUG_OPENID = 'mobile-poc-debug-openid'

function todayKey(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

export default function App() {
  const [screen, setScreen] = useState<Screen>('login')
  const [loading, setLoading] = useState(false)
  const [userId, setUserId] = useState('')
  const [password, setPassword] = useState('')
  const [dashboard, setDashboard] = useState<HomeDashboard | null>(null)
  const [selectedImageUri, setSelectedImageUri] = useState<string | null>(null)
  const [currentTask, setCurrentTask] = useState<AnalysisTask | null>(null)
  const [statusText, setStatusText] = useState('')
  const [mealType] = useState<MealType>(() => inferDefaultMealTypeFromLocalTime())
  const recordDate = useMemo(todayKey, [])

  const loadHome = useCallback(async () => {
    setLoading(true)
    try {
      const data = await apiClient.getHomeDashboard(recordDate)
      setDashboard(data)
      setScreen('home')
    } catch (error) {
      Alert.alert('获取首页失败', error instanceof Error ? error.message : '请稍后重试')
    } finally {
      setLoading(false)
    }
  }, [recordDate])

  useEffect(() => {
    hasStoredToken().then((hasToken) => {
      if (hasToken) {
        void loadHome()
      }
    })
  }, [loadHome])

  const handleDebugLogin = async () => {
    setLoading(true)
    try {
      await apiClient.debugLoginWithTestOpenID(DEFAULT_DEBUG_OPENID)
      await loadHome()
    } catch (error) {
      Alert.alert('登录失败', error instanceof Error ? error.message : '请确认后端运行在 development 环境')
    } finally {
      setLoading(false)
    }
  }

  const handleImpersonateLogin = async () => {
    setLoading(true)
    try {
      await apiClient.debugImpersonateUser(userId, password)
      await loadHome()
    } catch (error) {
      Alert.alert('登录失败', error instanceof Error ? error.message : '请检查用户 ID 和调试密码')
    } finally {
      setLoading(false)
    }
  }

  const pickAndAnalyze = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (!permission.granted) {
      Alert.alert('需要相册权限', '请选择一张食物图片用于分析。')
      return
    }

    const picked = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: false,
      quality: 0.85,
    })
    if (picked.canceled || !picked.assets[0]) return

    const asset = picked.assets[0]
    setSelectedImageUri(asset.uri)
    setScreen('analyzing')
    setStatusText('正在上传图片...')
    setLoading(true)
    try {
      const uploaded = await apiClient.uploadAnalyzeImageFile({
        fileUri: asset.uri,
        fileName: asset.fileName || 'food.jpg',
        mimeType: asset.mimeType || 'image/jpeg',
      })
      setStatusText('正在提交分析任务...')
      const submitted = await apiClient.submitAnalyzeTask({
        image_url: uploaded.imageUrl,
        meal_type: mealType,
        date: recordDate,
        timezone_offset_minutes: new Date().getTimezoneOffset(),
        execution_mode: 'standard',
      })
      await pollTask(submitted.task_id)
    } catch (error) {
      Alert.alert('分析失败', error instanceof Error ? error.message : '请稍后重试')
      setScreen('home')
    } finally {
      setLoading(false)
    }
  }

  const pollTask = async (taskId: string) => {
    const maxAttempts = 60
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      setStatusText(`正在识别食物... ${attempt + 1}/${maxAttempts}`)
      const task = await apiClient.getAnalyzeTask(taskId)
      if (task.status === 'done') {
        setCurrentTask(task)
        setScreen('result')
        return
      }
      if (task.status === 'failed' || task.status === 'violated' || task.status === 'timed_out' || task.status === 'cancelled') {
        throw new Error(task.error_message || '分析任务未完成')
      }
      await new Promise((resolve) => setTimeout(resolve, 2000))
    }
    throw new Error('分析等待超时，请稍后在识别记录中查看')
  }

  const saveRecord = async () => {
    if (!currentTask) return
    setLoading(true)
    try {
      const payload = buildSaveFoodRecordRequestFromTask(currentTask, { mealType, date: recordDate })
      await apiClient.saveFoodRecord(payload)
      Alert.alert('保存成功', '已记录到今日饮食。')
      await loadHome()
    } catch (error) {
      Alert.alert('保存失败', error instanceof Error ? error.message : '请稍后重试')
    } finally {
      setLoading(false)
    }
  }

  const logout = async () => {
    await apiClient.clearTokens()
    setDashboard(null)
    setCurrentTask(null)
    setSelectedImageUri(null)
    setScreen('login')
  }

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="dark" />
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.title}>Food Link App POC</Text>
        <Text style={styles.subtitle}>API: {API_BASE_URL}</Text>

        {screen === 'login' ? (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>开发登录</Text>
            <Text style={styles.subtitle}>默认会自动创建或复用一个 App POC 测试用户。</Text>
            <PrimaryButton label="一键登录测试账号" loading={loading} onPress={handleDebugLogin} />
            <Text style={styles.debugTitle}>按用户 ID 代登录（备用）</Text>
            <TextInput
              value={userId}
              onChangeText={setUserId}
              placeholder="用户 ID"
              autoCapitalize="none"
              style={styles.input}
            />
            <TextInput
              value={password}
              onChangeText={setPassword}
              placeholder="调试密码"
              secureTextEntry
              style={styles.input}
            />
            <SecondaryButton label="用指定用户 ID 登录" onPress={handleImpersonateLogin} />
          </View>
        ) : null}

        {screen === 'home' ? (
          <View>
            <View style={styles.card}>
              <View style={styles.rowBetween}>
                <Text style={styles.sectionTitle}>今日概览</Text>
                <Pressable onPress={logout}><Text style={styles.link}>退出</Text></Pressable>
              </View>
              <Text style={styles.bigNumber}>
                {Math.round(dashboard?.intakeData.current || 0)} / {Math.round(dashboard?.intakeData.target || 0)} kcal
              </Text>
              <Text style={styles.subtitle}>默认餐次：{getMealTypeLabel(mealType)}</Text>
              <Macro label="蛋白质" value={dashboard?.intakeData.macros.protein.current} target={dashboard?.intakeData.macros.protein.target} />
              <Macro label="碳水" value={dashboard?.intakeData.macros.carbs.current} target={dashboard?.intakeData.macros.carbs.target} />
              <Macro label="脂肪" value={dashboard?.intakeData.macros.fat.current} target={dashboard?.intakeData.macros.fat.target} />
            </View>

            <View style={styles.card}>
              <Text style={styles.sectionTitle}>今日餐食</Text>
              {(dashboard?.meals || []).length === 0 ? (
                <Text style={styles.empty}>今天还没有记录餐食</Text>
              ) : (
                dashboard?.meals.map((meal) => (
                  <View key={`${meal.type}-${meal.time}`} style={styles.mealRow}>
                    <Text style={styles.mealName}>{meal.name}</Text>
                    <Text style={styles.mealMeta}>{Math.round(meal.calorie || 0)} kcal</Text>
                  </View>
                ))
              )}
            </View>

            <PrimaryButton label="选择食物图片并分析" loading={loading} onPress={pickAndAnalyze} />
            <SecondaryButton label="刷新首页" onPress={loadHome} />
          </View>
        ) : null}

        {screen === 'analyzing' ? (
          <View style={styles.card}>
            {selectedImageUri ? <Image source={{ uri: selectedImageUri }} style={styles.previewImage} /> : null}
            <ActivityIndicator size="large" color="#00bc7d" />
            <Text style={styles.status}>{statusText}</Text>
          </View>
        ) : null}

        {screen === 'result' && currentTask ? (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>识别结果</Text>
            {selectedImageUri ? <Image source={{ uri: selectedImageUri }} style={styles.previewImage} /> : null}
            <Text style={styles.subtitle}>{String(currentTask.result?.description || '食物分析完成')}</Text>
            {(currentTask.result?.items || []).map((item, index) => (
              <View key={`${item.name}-${index}`} style={styles.mealRow}>
                <Text style={styles.mealName}>{item.name}</Text>
                <Text style={styles.mealMeta}>{Math.round(item.nutrients?.calories || 0)} kcal · {Math.round(item.estimatedWeightGrams || 0)}g</Text>
              </View>
            ))}
            <PrimaryButton label="保存到今日饮食" loading={loading} onPress={saveRecord} />
            <SecondaryButton label="返回首页" onPress={loadHome} />
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  )
}

function Macro({ label, value, target }: { label: string; value?: number; target?: number }) {
  return (
    <View style={styles.macroRow}>
      <Text style={styles.macroLabel}>{label}</Text>
      <Text style={styles.macroValue}>{Math.round(value || 0)} / {Math.round(target || 0)} g</Text>
    </View>
  )
}

function PrimaryButton({ label, loading, onPress }: { label: string; loading?: boolean; onPress: () => void }) {
  return (
    <Pressable disabled={loading} onPress={onPress} style={[styles.button, loading && styles.buttonDisabled]}>
      {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>{label}</Text>}
    </Pressable>
  )
}

function SecondaryButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={styles.secondaryButton}>
      <Text style={styles.secondaryButtonText}>{label}</Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#f7faf9',
  },
  container: {
    padding: 20,
    gap: 16,
  },
  title: {
    fontSize: 28,
    fontWeight: '800',
    color: '#0f172a',
  },
  subtitle: {
    color: '#64748b',
    marginTop: 4,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 18,
    marginBottom: 16,
    shadowColor: '#0f172a',
    shadowOpacity: 0.08,
    shadowRadius: 16,
    elevation: 2,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 12,
  },
  debugTitle: {
    color: '#475569',
    fontSize: 14,
    fontWeight: '700',
    marginTop: 18,
    marginBottom: 10,
  },
  input: {
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 12,
    fontSize: 16,
  },
  button: {
    backgroundColor: '#00bc7d',
    borderRadius: 14,
    alignItems: 'center',
    paddingVertical: 14,
    marginTop: 8,
  },
  buttonDisabled: {
    opacity: 0.7,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  secondaryButton: {
    alignItems: 'center',
    paddingVertical: 14,
  },
  secondaryButtonText: {
    color: '#00a36d',
    fontSize: 15,
    fontWeight: '700',
  },
  rowBetween: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  link: {
    color: '#00a36d',
    fontWeight: '700',
  },
  bigNumber: {
    fontSize: 30,
    fontWeight: '800',
    color: '#00a36d',
  },
  macroRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 10,
  },
  macroLabel: {
    color: '#475569',
  },
  macroValue: {
    color: '#111827',
    fontWeight: '700',
  },
  empty: {
    color: '#94a3b8',
  },
  mealRow: {
    borderTopWidth: 1,
    borderTopColor: '#eef2f7',
    paddingVertical: 12,
  },
  mealName: {
    fontWeight: '700',
    color: '#111827',
  },
  mealMeta: {
    color: '#64748b',
    marginTop: 2,
  },
  previewImage: {
    width: '100%',
    height: 220,
    borderRadius: 16,
    marginBottom: 16,
    backgroundColor: '#e5e7eb',
  },
  status: {
    marginTop: 14,
    color: '#475569',
    textAlign: 'center',
  },
})
