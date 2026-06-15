import { useEffect, useState } from 'react'
import { Alert, Image, Pressable, StyleSheet, Text, View } from 'react-native'
import * as ImagePicker from 'expo-image-picker'
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { getMealTypeLabel, inferDefaultMealTypeFromLocalTime, type MealType } from '@food-link/core'
import { apiClient } from '../api'
import { AppButton } from '../components/AppButton'
import { Card } from '../components/Card'
import { Page } from '../components/Page'
import { SHOW_DEBUG_LOGIN } from '../config'
import type { RootStackParamList } from '../navigation/types'
import { colors } from '../theme'
import { todayKey } from '../utils/date'
import { createDemoAnalysisTask, demoFoodImageUrl } from '../utils/demoAnalysisTask'

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
      : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: false, quality: 0.85 })
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

  const openDemoResult = () => {
    navigation.navigate('Result', {
      task: createDemoAnalysisTask(),
      imageUri: demoFoodImageUrl,
      mealType,
      date,
    })
  }

  return (
    <Page title="记录" subtitle={`${date} · ${getMealTypeLabel(mealType)}`}>
      <Card>
        <Text style={styles.sectionTitle}>拍照或选择图片</Text>
        <Text style={styles.subtitle}>上传食物图片后自动分析营养并生成饮食记录。</Text>
        {selectedImageUri ? <Image source={{ uri: selectedImageUri }} style={styles.preview} /> : null}
        <AppButton label="拍照识别" loading={loading} onPress={() => pickAndSubmit('camera', mealType, date)} />
        <AppButton label="从相册选择" variant="secondary" loading={loading} onPress={() => pickAndSubmit('library', mealType, date)} />
      </Card>

      <View style={styles.quickRow}>
        <QuickEntry label="文字记录" onPress={() => navigation.navigate('TextRecord')} />
        <QuickEntry label="手动记录" onPress={() => navigation.navigate('ManualRecord')} />
      </View>
      <View style={styles.quickRow}>
        <QuickEntry label="包装食品" onPress={() => navigation.navigate('PackagedFoodEdit')} />
        <QuickEntry label="食物库" onPress={() => navigation.navigate('FoodLibrary')} />
      </View>

      {SHOW_DEBUG_LOGIN ? (
        <Card>
          <Text style={styles.sectionTitle}>开发验证</Text>
          <Text style={styles.subtitle}>打开一份本地示例识别结果，用于验证比例、人数分摊和保存前调整。</Text>
          <AppButton label="打开示例识别结果" variant="secondary" onPress={openDemoResult} />
        </Card>
      ) : null}
    </Page>
  )
}

function QuickEntry({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable style={styles.quickEntry} onPress={onPress}>
      <Text style={styles.quickEntryText}>{label}</Text>
    </Pressable>
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
  quickRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 16,
  },
  quickEntry: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 46,
    borderRadius: 16,
    backgroundColor: colors.brandSoft,
  },
  quickEntryText: {
    color: colors.brandDark,
    fontWeight: '800',
  },
})
