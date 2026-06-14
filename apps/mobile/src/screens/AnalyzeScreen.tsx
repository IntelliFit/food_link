import { useEffect, useState } from 'react'
import { Alert, Image, StyleSheet, Text } from 'react-native'
import * as ImagePicker from 'expo-image-picker'
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { getMealTypeLabel, inferDefaultMealTypeFromLocalTime, type MealType } from '@food-link/core'
import { apiClient } from '../api'
import { AppButton } from '../components/AppButton'
import { Card } from '../components/Card'
import { Page } from '../components/Page'
import type { RootStackParamList } from '../navigation/types'
import { colors } from '../theme'
import { todayKey } from '../utils/date'

type AnalyzeRoute = RouteProp<RootStackParamList, 'Analyze'>

export function AnalyzeScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  const route = useRoute<AnalyzeRoute>()
  const [loading, setLoading] = useState(false)
  const [selectedImageUri, setSelectedImageUri] = useState<string | null>(null)
  const mealType = route.params?.mealType || inferDefaultMealTypeFromLocalTime()
  const date = route.params?.date || todayKey()

  useEffect(() => {
    if (route.params?.source) {
      void pickAndSubmit(route.params.source, mealType, date)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const pickAndSubmit = async (source: 'camera' | 'library', selectedMealType: MealType, selectedDate: string) => {
    const permission = source === 'camera'
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (!permission.granted) {
      Alert.alert(source === 'camera' ? '需要相机权限' : '需要相册权限', '请选择一张食物图片用于分析。')
      return
    }

    const picked = source === 'camera'
      ? await ImagePicker.launchCameraAsync({ allowsEditing: false, quality: 0.85 })
      : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, allowsEditing: false, quality: 0.85 })
    if (picked.canceled || !picked.assets[0]) return

    const asset = picked.assets[0]
    setSelectedImageUri(asset.uri)
    setLoading(true)
    try {
      const uploaded = await apiClient.uploadAnalyzeImageFile({
        fileUri: asset.uri,
        fileName: asset.fileName || 'food.jpg',
        mimeType: asset.mimeType || 'image/jpeg',
      })
      const submitted = await apiClient.submitAnalyzeTask({
        image_url: uploaded.imageUrl,
        meal_type: selectedMealType,
        date: selectedDate,
        timezone_offset_minutes: new Date().getTimezoneOffset(),
        execution_mode: 'standard',
      })
      navigation.replace('AnalyzeLoading', {
        taskId: submitted.task_id,
        imageUri: asset.uri,
        mealType: selectedMealType,
        date: selectedDate,
      })
    } catch (error) {
      Alert.alert('分析失败', error instanceof Error ? error.message : '请稍后重试')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Page title="记录" subtitle={`${date} · ${getMealTypeLabel(mealType)}`}>
      <Card>
        <Text style={styles.sectionTitle}>拍照或选择图片</Text>
        <Text style={styles.subtitle}>App 端已接入和小程序一致的图片上传、任务提交与轮询流程。</Text>
        {selectedImageUri ? <Image source={{ uri: selectedImageUri }} style={styles.preview} /> : null}
        <AppButton label="拍照识别" loading={loading} onPress={() => pickAndSubmit('camera', mealType, date)} />
        <AppButton label="从相册选择" variant="secondary" loading={loading} onPress={() => pickAndSubmit('library', mealType, date)} />
      </Card>
    </Page>
  )
}

const styles = StyleSheet.create({
  sectionTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: colors.text,
  },
  subtitle: {
    marginTop: 8,
    marginBottom: 18,
    color: colors.textSecondary,
    lineHeight: 20,
  },
  preview: {
    width: '100%',
    height: 220,
    borderRadius: 18,
    marginBottom: 14,
    backgroundColor: colors.surfaceMuted,
  },
})
