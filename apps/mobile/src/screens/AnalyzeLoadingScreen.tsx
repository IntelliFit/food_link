import { useEffect, useState } from 'react'
import { ActivityIndicator, Image, StyleSheet, Text } from 'react-native'
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
  const isTextAnalysis = isTextFoodTask(route.params?.task || {}, route.params?.taskType)

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
        const maxAttempts = 60
        for (let attempt = 0; attempt < maxAttempts && !cancelled; attempt += 1) {
          setStatusText(`${isTextAnalysis ? '正在理解食物描述' : '正在识别食物'}... ${attempt + 1}/${maxAttempts}`)
          const task = await apiClient.getAnalyzeTask(route.params.taskId)
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
          await new Promise((resolve) => setTimeout(resolve, 2000))
        }
        throw new Error('分析等待超时，请稍后在识别记录中查看')
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
    <Page title="正在分析" subtitle={isTextAnalysis ? '文字内容已提交，结果生成后会自动跳转。' : '图片已提交，结果生成后会自动跳转。'}>
      <Card style={styles.card}>
        {route.params?.imageUri ? <Image source={{ uri: route.params.imageUri }} style={styles.preview} /> : null}
        <ActivityIndicator size="large" color={colors.brand} />
        <Text style={styles.status}>{statusText}</Text>
      </Card>
    </Page>
  )
}

function isTextFoodTask(task: { task_type?: string; payload?: Record<string, unknown> }, routeTaskType?: string): boolean {
  if (routeTaskType === 'food_text') return true
  if (task.task_type === 'food_text') return true
  return task.payload?.source_type === 'text'
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
    color: colors.textSecondary,
    textAlign: 'center',
  },
})
