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
import { createDemoAnalysisTask, createDemoTextAnalysisTask, demoFoodImageUrl } from '../utils/demoAnalysisTask'
import { userFacingErrorMessage } from '../utils/errors'

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
      Alert.alert('分析失败', userFacingErrorMessage(error))
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

  const openDemoTextResult = () => {
    navigation.navigate('TextResult', {
      task: createDemoTextAnalysisTask(),
      mealType,
      date,
    })
  }

  return (
    <Page title="记录" subtitle={`${date} · ${getMealTypeLabel(mealType)}`}>
      <Card>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>记录餐食</Text>
          <Text style={styles.badge}>AI 分析</Text>
        </View>
        <Text style={styles.subtitle}>选择一种方式开始记录，图片识别会自动分析营养并生成保存前结果。</Text>
        {selectedImageUri ? <Image source={{ uri: selectedImageUri }} style={styles.preview} /> : null}
        <View style={styles.recordGrid}>
          <RecordGridAction
            title="拍照识别"
            desc="拍摄餐食，自动估算热量"
            icon="CAM"
            tone="green"
            disabled={loading}
            onPress={() => pickAndSubmit('camera', mealType, date)}
          />
          <RecordGridAction
            title="相册上传"
            desc="选择已有食物图片"
            icon="IMG"
            tone="blue"
            disabled={loading}
            onPress={() => pickAndSubmit('library', mealType, date)}
          />
          <RecordGridAction
            title="文本输入"
            desc="一句话描述吃了什么"
            icon="TXT"
            tone="gold"
            onPress={() => navigation.navigate('TextRecord')}
          />
          <RecordGridAction
            title="食物库输入"
            desc="按食物和重量精确录入"
            icon="LIB"
            tone="purple"
            onPress={() => navigation.navigate('ManualRecord')}
          />
        </View>
        <View style={styles.recordQuickList}>
          <RecordQuickAction title="我的收藏" desc="快速记录常吃餐食" onPress={() => navigation.navigate('Recipes')} />
          <RecordQuickAction title="识别记录" desc="查看以往识别结果" onPress={() => navigation.navigate('AnalyzeHistory')} />
          <RecordQuickAction title="包装食品" desc="上传营养成分表或商品包装" onPress={() => navigation.navigate('PackagedFoodEdit')} />
          <RecordQuickAction title="食物库" desc="浏览营养库与自定义食物" onPress={() => navigation.navigate('FoodLibrary')} />
        </View>
      </Card>

      {SHOW_DEBUG_LOGIN ? (
        <Card>
          <Text style={styles.sectionTitle}>开发验证</Text>
          <Text style={styles.subtitle}>打开一份本地示例识别结果，用于验证比例、人数分摊和保存前调整。</Text>
          <AppButton label="打开示例识别结果" variant="secondary" onPress={openDemoResult} />
          <View style={styles.demoButtonGap}>
            <AppButton label="打开示例文字结果" variant="secondary" onPress={openDemoTextResult} />
          </View>
        </Card>
      ) : null}
    </Page>
  )
}

function RecordGridAction({
  title,
  desc,
  icon,
  tone,
  disabled,
  onPress,
}: {
  title: string
  desc: string
  icon: string
  tone: 'green' | 'blue' | 'gold' | 'purple'
  disabled?: boolean
  onPress: () => void
}) {
  return (
    <Pressable
      disabled={disabled}
      style={({ pressed }) => [
        styles.recordActionCard,
        tone === 'green' && styles.recordActionGreen,
        tone === 'blue' && styles.recordActionBlue,
        tone === 'gold' && styles.recordActionGold,
        tone === 'purple' && styles.recordActionPurple,
        disabled && styles.disabled,
        pressed && styles.pressed,
      ]}
      onPress={onPress}
    >
      <View
        style={[
          styles.recordActionIcon,
          tone === 'green' && styles.recordIconGreen,
          tone === 'blue' && styles.recordIconBlue,
          tone === 'gold' && styles.recordIconGold,
          tone === 'purple' && styles.recordIconPurple,
        ]}
      >
        <Text
          style={[
            styles.recordActionIconText,
            tone === 'green' && styles.recordTextGreen,
            tone === 'blue' && styles.recordTextBlue,
            tone === 'gold' && styles.recordTextGold,
            tone === 'purple' && styles.recordTextPurple,
          ]}
        >
          {icon}
        </Text>
      </View>
      <Text style={styles.recordActionTitle}>{title}</Text>
      <Text style={styles.recordActionDesc}>{desc}</Text>
    </Pressable>
  )
}

function RecordQuickAction({ title, desc, onPress }: { title: string; desc: string; onPress: () => void }) {
  return (
    <Pressable style={({ pressed }) => [styles.recordQuickAction, pressed && styles.pressed]} onPress={onPress}>
      <View style={styles.recordQuickText}>
        <Text style={styles.recordQuickTitle}>{title}</Text>
        <Text style={styles.recordQuickDesc}>{desc}</Text>
      </View>
      <Text style={styles.recordQuickChevron}>›</Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: colors.text,
  },
  badge: {
    color: colors.brandDark,
    fontWeight: '800',
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
  recordGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  recordActionCard: {
    width: '48.5%',
    minHeight: 122,
    borderRadius: 18,
    borderWidth: 1,
    padding: 14,
  },
  recordActionGreen: {
    backgroundColor: '#f9fefc',
    borderColor: '#d9faeb',
  },
  recordActionBlue: {
    backgroundColor: '#f9fdfe',
    borderColor: '#d9f2fa',
  },
  recordActionGold: {
    backgroundColor: '#fefcf7',
    borderColor: '#f7e9ce',
  },
  recordActionPurple: {
    backgroundColor: '#fefcfe',
    borderColor: '#e6defa',
  },
  recordActionIcon: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  recordIconGreen: {
    backgroundColor: '#ebfcf4',
  },
  recordIconBlue: {
    backgroundColor: '#ebf7fc',
  },
  recordIconGold: {
    backgroundColor: '#fbf5e6',
  },
  recordIconPurple: {
    backgroundColor: '#f3effc',
  },
  recordActionIconText: {
    fontSize: 11,
    fontWeight: '900',
  },
  recordTextGreen: {
    color: '#38a97b',
  },
  recordTextBlue: {
    color: '#4295bc',
  },
  recordTextGold: {
    color: '#9f823a',
  },
  recordTextPurple: {
    color: '#6951bd',
  },
  recordActionTitle: {
    color: colors.text,
    fontWeight: '900',
    fontSize: 16,
  },
  recordActionDesc: {
    color: colors.textSecondary,
    fontSize: 12,
    lineHeight: 17,
    marginTop: 5,
  },
  recordQuickList: {
    marginTop: 12,
  },
  recordQuickAction: {
    minHeight: 66,
    flexDirection: 'row',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  recordQuickText: {
    flex: 1,
    paddingRight: 12,
  },
  recordQuickTitle: {
    color: colors.text,
    fontWeight: '900',
  },
  recordQuickDesc: {
    marginTop: 3,
    color: colors.textSecondary,
    lineHeight: 18,
  },
  recordQuickChevron: {
    color: colors.textMuted,
    fontSize: 28,
  },
  demoButtonGap: {
    marginTop: 10,
  },
  pressed: {
    opacity: 0.72,
  },
  disabled: {
    opacity: 0.52,
  },
})
