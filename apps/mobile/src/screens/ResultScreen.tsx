import { useState } from 'react'
import { Alert, Image, Pressable, StyleSheet, Text, View } from 'react-native'
import { CommonActions, useNavigation, useRoute, type RouteProp } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { buildSaveFoodRecordRequestFromTask } from '@food-link/core'
import { apiClient } from '../api'
import { AppButton } from '../components/AppButton'
import { Card } from '../components/Card'
import { Page } from '../components/Page'
import type { RootStackParamList } from '../navigation/types'
import { colors } from '../theme'

type ResultRoute = RouteProp<RootStackParamList, 'Result'>

export function ResultScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  const route = useRoute<ResultRoute>()
  const { task, imageUri, mealType, date } = route.params
  const [saving, setSaving] = useState(false)

  const saveRecord = async () => {
    setSaving(true)
    try {
      const payload = buildSaveFoodRecordRequestFromTask(task, { mealType, date })
      const saved = await apiClient.saveFoodRecord(payload)
      Alert.alert('保存成功', saved.already_saved ? '这条记录之前已保存。' : '已记录到今日饮食。')
      navigation.dispatch(CommonActions.navigate({ name: 'MainTabs' }))
    } catch (error) {
      Alert.alert('保存失败', error instanceof Error ? error.message : '请稍后重试')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Page title="识别结果" subtitle="确认后保存到今日饮食。">
      <Card>
        {imageUri ? <Image source={{ uri: imageUri }} style={styles.preview} /> : null}
        <Text style={styles.description}>{String(task.result?.description || '食物分析完成')}</Text>
        {(task.result?.items || []).map((item, index) => (
          <View key={`${item.name}-${index}`} style={styles.itemRow}>
            <View style={styles.itemMain}>
              <Text style={styles.itemName}>{item.name}</Text>
              <Text style={styles.itemMeta}>{Math.round(item.estimatedWeightGrams || 0)}g</Text>
            </View>
            <Text style={styles.itemKcal}>{Math.round(item.nutrients?.calories || 0)} kcal</Text>
          </View>
        ))}
        <View style={styles.summary}>
          <Text style={styles.summaryLabel}>合计</Text>
          <Text style={styles.summaryValue}>{Math.round(task.result?.total_calories || 0)} kcal</Text>
        </View>
        <AppButton label="保存到今日饮食" loading={saving} onPress={saveRecord} />
        <Pressable onPress={() => navigation.navigate('AnalyzeHistory')}>
          <Text style={styles.historyLink}>查看识别历史</Text>
        </Pressable>
      </Card>
    </Page>
  )
}

const styles = StyleSheet.create({
  preview: {
    width: '100%',
    height: 230,
    borderRadius: 18,
    marginBottom: 16,
    backgroundColor: colors.surfaceMuted,
  },
  description: {
    color: colors.textSecondary,
    marginBottom: 10,
    lineHeight: 20,
  },
  itemRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: '#eef2f7',
  },
  itemMain: {
    flex: 1,
  },
  itemName: {
    color: colors.text,
    fontWeight: '800',
  },
  itemMeta: {
    marginTop: 3,
    color: colors.textSecondary,
  },
  itemKcal: {
    color: colors.brandDark,
    fontWeight: '800',
  },
  summary: {
    marginTop: 8,
    marginBottom: 16,
    padding: 14,
    borderRadius: 16,
    backgroundColor: colors.brandSoft,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  summaryLabel: {
    color: colors.brandDark,
    fontWeight: '700',
  },
  summaryValue: {
    color: colors.brandDark,
    fontWeight: '900',
  },
  historyLink: {
    marginTop: 16,
    textAlign: 'center',
    color: colors.brandDark,
    fontWeight: '700',
  },
})
