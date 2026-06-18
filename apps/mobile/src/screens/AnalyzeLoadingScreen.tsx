import { useEffect, useState } from 'react'
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from 'react-native'
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { apiClient } from '../api'
import { Card } from '../components/Card'
import { Page } from '../components/Page'
import type { RootStackParamList } from '../navigation/types'
import { useAppDialog } from '../providers/DialogProvider'
import { colors } from '../theme'
import { userFacingErrorMessage, userFacingMessage } from '../utils/errors'

type AnalyzeLoadingRoute = RouteProp<RootStackParamList, 'AnalyzeLoading'>

export function AnalyzeLoadingScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  const route = useRoute<AnalyzeLoadingRoute>()
  const dialog = useAppDialog()
  const [statusText, setStatusText] = useState('正在准备分析...')
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const [taskStatusText, setTaskStatusText] = useState('已提交')
  const isTextAnalysis = isTextFoodTask(route.params?.task || {}, route.params?.taskType)

  useEffect(() => {
    const startedAt = Date.now()
    const timer = setInterval(() => {
      setElapsedSeconds(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)))
    }, 1000)
    return () => clearInterval(timer)
  }, [route.params?.taskId])

  useEffect(() => {
    let cancelled = false

    const pollTask = async () => {
      if (route.params?.task) {
        if (isTextFoodTask(route.params.task, route.params.taskType)) {
          navigation.replace('TextResult', {
            task: route.params.task,
            mealType: route.params.mealType,
            date: route.params.date,
          })
        } else {
          navigation.replace('Result', {
            task: route.params.task,
            imageUri: route.params.imageUri,
            mealType: route.params.mealType,
            date: route.params.date,
          })
        }
        return
      }
      if (!route.params?.taskId) {
        void dialog.alert('缺少识别进度信息', '请重新提交识别内容。', 'warning')
        navigation.goBack()
        return
      }
      try {
        let consecutivePollFailures = 0
        while (!cancelled) {
          setStatusText(isTextAnalysis ? '正在理解食物描述' : '正在识别食物')
          let task
          try {
            task = await apiClient.getAnalyzeTask(route.params.taskId)
            consecutivePollFailures = 0
          } catch (pollError) {
            consecutivePollFailures += 1
            setTaskStatusText('网络波动，继续等待')
            if (consecutivePollFailures >= 3) {
              throw pollError
            }
            await new Promise((resolve) => setTimeout(resolve, 2500))
            continue
          }
          setTaskStatusText(task.status === 'processing' ? '处理中' : task.status === 'pending' ? '排队中' : '收尾中')
          if (task.status === 'done') {
            if (isTextFoodTask(task, route.params.taskType)) {
              navigation.replace('TextResult', {
                task,
                mealType: route.params.mealType,
                date: route.params.date,
              })
            } else {
              navigation.replace('Result', {
                task,
                imageUri: route.params.imageUri,
                mealType: route.params.mealType,
                date: route.params.date,
              })
            }
            return
          }
          if (task.status === 'failed' || task.status === 'violated' || task.status === 'timed_out' || task.status === 'cancelled') {
            throw new Error(userFacingMessage(task.error_message, '识别没有成功，可以调整图片或文字后重新提交。'))
          }
          await new Promise((resolve) => setTimeout(resolve, 2500))
        }
      } catch (error) {
        if (!cancelled) {
          void dialog.alert('分析失败', userFacingErrorMessage(error, '识别没有成功，可以稍后在识别记录中查看，或重新提交。'), 'danger')
          navigation.navigate('MainTabs')
        }
      }
    }

    void pollTask()
    return () => {
      cancelled = true
    }
  }, [dialog, isTextAnalysis, navigation, route.params])

  return (
    <Page title="正在分析" subtitle={isTextAnalysis ? '文字内容已提交，分析会在后台继续。' : '图片已提交，分析会在后台继续。'}>
      <Card style={styles.card}>
        {route.params?.imageUri ? <Image source={{ uri: route.params.imageUri }} style={styles.preview} /> : null}
        <ActivityIndicator size="large" color={colors.brand} />
        <Text style={styles.status}>{statusText}</Text>
        <View style={styles.waitCard}>
          <Text style={styles.waitTime}>已等待 {formatElapsed(elapsedSeconds)}</Text>
          <Text style={styles.waitStatus}>任务{taskStatusText}</Text>
        </View>
        <Text style={styles.hint}>不用一直停在这里。你可以先离开当前页面，后台会继续识别，完成后可在识别记录里查看。</Text>
        <View style={styles.actionRow}>
          <Pressable style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]} onPress={() => navigation.navigate('MainTabs')}>
            <Text style={styles.secondaryButtonText}>先离开</Text>
          </Pressable>
          <Pressable style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]} onPress={() => navigation.navigate('AnalyzeHistory')}>
            <Text style={styles.primaryButtonText}>识别记录</Text>
          </Pressable>
        </View>
      </Card>
    </Page>
  )
}

function isTextFoodTask(task: { task_type?: string; payload?: Record<string, unknown> }, routeTaskType?: string): boolean {
  if (routeTaskType === 'food_text') return true
  if (task.task_type === 'food_text') return true
  return task.payload?.source_type === 'text'
}

function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds} 秒`
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  return rest > 0 ? `${minutes} 分 ${rest} 秒` : `${minutes} 分`
}

const styles = StyleSheet.create({
  card: {
    alignItems: 'center',
  },
  preview: {
    width: '100%',
    height: 240,
    borderRadius: 18,
    marginBottom: 22,
    backgroundColor: colors.surfaceMuted,
  },
  status: {
    marginTop: 14,
    color: colors.text,
    fontSize: 17,
    fontWeight: '900',
    textAlign: 'center',
  },
  waitCard: {
    width: '100%',
    borderRadius: 16,
    padding: 14,
    marginTop: 14,
    backgroundColor: colors.brandSoft,
    alignItems: 'center',
  },
  waitTime: {
    color: colors.brandDark,
    fontSize: 20,
    fontWeight: '900',
  },
  waitStatus: {
    marginTop: 5,
    color: colors.textSecondary,
    fontSize: 13,
    textAlign: 'center',
  },
  hint: {
    marginTop: 14,
    color: colors.textSecondary,
    lineHeight: 20,
    textAlign: 'center',
  },
  actionRow: {
    width: '100%',
    flexDirection: 'row',
    gap: 10,
    marginTop: 18,
  },
  primaryButton: {
    flex: 1,
    minHeight: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.brand,
  },
  primaryButtonText: {
    color: '#fff',
    fontWeight: '800',
  },
  secondaryButton: {
    flex: 1,
    minHeight: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.brandSoft,
  },
  secondaryButtonText: {
    color: colors.brandDark,
    fontWeight: '800',
  },
  pressed: {
    opacity: 0.76,
  },
})
