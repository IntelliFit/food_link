import { useEffect, useState } from 'react'
import { ActivityIndicator, Alert, Image, StyleSheet, Text } from 'react-native'
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { apiClient } from '../api'
import { Card } from '../components/Card'
import { Page } from '../components/Page'
import type { RootStackParamList } from '../navigation/types'
import { colors } from '../theme'

type AnalyzeLoadingRoute = RouteProp<RootStackParamList, 'AnalyzeLoading'>

export function AnalyzeLoadingScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  const route = useRoute<AnalyzeLoadingRoute>()
  const [statusText, setStatusText] = useState('正在准备分析...')

  useEffect(() => {
    let cancelled = false

    const pollTask = async () => {
      if (route.params?.task) {
        navigation.replace('Result', {
          task: route.params.task,
          imageUri: route.params.imageUri,
          mealType: route.params.mealType,
          date: route.params.date,
        })
        return
      }
      if (!route.params?.taskId) {
        Alert.alert('缺少任务编号', '请重新提交识别任务。')
        navigation.goBack()
        return
      }
      try {
        const maxAttempts = 60
        for (let attempt = 0; attempt < maxAttempts && !cancelled; attempt += 1) {
          setStatusText(`正在识别食物... ${attempt + 1}/${maxAttempts}`)
          const task = await apiClient.getAnalyzeTask(route.params.taskId)
          if (task.status === 'done') {
            navigation.replace('Result', {
              task,
              imageUri: route.params.imageUri,
              mealType: route.params.mealType,
              date: route.params.date,
            })
            return
          }
          if (task.status === 'failed' || task.status === 'violated' || task.status === 'timed_out' || task.status === 'cancelled') {
            throw new Error(task.error_message || '分析任务未完成')
          }
          await new Promise((resolve) => setTimeout(resolve, 2000))
        }
        throw new Error('分析等待超时，请稍后在识别记录中查看')
      } catch (error) {
        if (!cancelled) {
          Alert.alert('分析失败', error instanceof Error ? error.message : '请稍后重试')
          navigation.navigate('MainTabs')
        }
      }
    }

    void pollTask()
    return () => {
      cancelled = true
    }
  }, [navigation, route.params])

  return (
    <Page title="正在分析" subtitle="图片已提交，结果生成后会自动跳转。">
      <Card style={styles.card}>
        {route.params?.imageUri ? <Image source={{ uri: route.params.imageUri }} style={styles.preview} /> : null}
        <ActivityIndicator size="large" color={colors.brand} />
        <Text style={styles.status}>{statusText}</Text>
      </Card>
    </Page>
  )
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
