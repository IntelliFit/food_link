import { View, Text, ScrollView } from '@tarojs/components'
import { useState, useEffect } from 'react'
import Taro from '@tarojs/taro'
import { getHealthProfile, type HealthProfile } from '../../utils/api'

import './index.scss'

const GENDER_MAP: Record<string, string> = { male: '男', female: '女' }
const ACTIVITY_MAP: Record<string, string> = {
  sedentary: '久坐 (几乎不运动)',
  light: '轻度 (每周 1-3 天)',
  moderate: '中度 (每周 3-5 天)',
  active: '高度 (每周 6-7 天)',
  very_active: '极高 (体力劳动/每天训练)'
}
const GOAL_MAP: Record<string, string> = {
  fat_loss: '减重',
  maintain: '保持',
  muscle_gain: '增重'
}
const MEDICAL_MAP: Record<string, string> = {
  diabetes: '糖尿病',
  hypertension: '高血压',
  gout: '痛风',
  hyperlipidemia: '高血脂',
  thyroid: '甲状腺疾病',
  none: '无'
}
const DIET_PREF_MAP: Record<string, string> = {
  keto: '生酮',
  vegetarian: '素食',
  vegan: '纯素',
  low_salt: '低盐',
  gluten_free: '无麸质',
  none: '无'
}

export default function HealthProfileViewPage() {
  const [loading, setLoading] = useState(true)
  const [profile, setProfile] = useState<HealthProfile | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    getHealthProfile()
      .then(setProfile)
      .catch((e: Error) => setError(e.message || '获取失败'))
      .finally(() => setLoading(false))
  }, [])

  const handleEdit = () => {
    Taro.navigateTo({ url: '/pages/health-profile-edit/index' })
  }

  const handleRefill = () => {
    Taro.showModal({
      title: '重新填写',
      content: '将前往答题页面重新填写健康档案。确定继续吗？',
      success: (res) => {
        if (res.confirm) {
          Taro.navigateTo({ url: '/pages/health-profile/index' })
        }
      }
    })
  }

  const formatList = (list: string[], map: Record<string, string>) => {
    const validItems = list.filter(x => x !== 'none')
    if (validItems.length === 0) return '无'
    return validItems.map(item => map[item] || item).join('、')
  }

  if (loading) {
    return (
      <View className='health-profile-view-page'>
        <View className='loading-wrap'>
          <Text className='loading-text'>加载中...</Text>
        </View>
      </View>
    )
  }

  if (error || !profile) {
    return (
      <View className='health-profile-view-page'>
        <View className='error-wrap'>
          <Text className='error-text'>{error || '暂无健康档案'}</Text>
          <View className='btn-primary' onClick={() => Taro.navigateTo({ url: '/pages/health-profile/index' })}>
            <Text className='btn-text'>去填写</Text>
          </View>
        </View>
      </View>
    )
  }

  const hc = profile.health_condition
  const medicalHistory = (hc?.medical_history as string[] | undefined) || []
  const dietPreference = (hc?.diet_preference as string[] | undefined) || []
  const allergies = (hc?.allergies as string[] | undefined) || []

  return (
    <View className='health-profile-view-page'>
      <ScrollView className='scroll-wrap' scrollY enhanced showScrollbar={false}>
        {/* 基础信息 */}
        <View className='block'>
          <Text className='block-title'>基础信息</Text>
          <View className='row'>
            <Text className='label'>性别</Text>
            <Text className='value'>{profile.gender ? GENDER_MAP[profile.gender] || profile.gender : '—'}</Text>
          </View>
          <View className='row'>
            <Text className='label'>出生日期</Text>
            <Text className='value'>{profile.birthday || '—'}</Text>
          </View>
          <View className='row'>
            <Text className='label'>身高</Text>
            <Text className='value'>{profile.height != null ? `${profile.height} cm` : '—'}</Text>
          </View>
          <View className='row'>
            <Text className='label'>体重</Text>
            <Text className='value'>{profile.weight != null ? `${profile.weight} kg` : '—'}</Text>
          </View>
          <View className='row'>
            <Text className='label'>饮食目标</Text>
            <Text className='value highlight'>
              {profile.diet_goal ? GOAL_MAP[profile.diet_goal] || profile.diet_goal : '—'}
            </Text>
          </View>
          <View className='row'>
            <Text className='label'>活动水平</Text>
            <Text className='value'>
              {profile.activity_level ? ACTIVITY_MAP[profile.activity_level] || profile.activity_level : '—'}
            </Text>
          </View>
        </View>

        {/* 代谢 */}
        {(profile.bmr != null || profile.tdee != null) && (
          <View className='block'>
            <Text className='block-title'>代谢数据</Text>
            {profile.bmr != null && (
              <View className='row'>
                <Text className='label'>BMR（基础代谢率）</Text>
                <Text className='value'>{profile.bmr.toFixed(0)} kcal/天</Text>
              </View>
            )}
            {profile.tdee != null && (
              <View className='row'>
                <Text className='label'>TDEE（每日总消耗）</Text>
                <Text className='value'>{profile.tdee.toFixed(0)} kcal/天</Text>
              </View>
            )}
          </View>
        )}

        {/* 病史与饮食 */}
        <View className='block'>
          <Text className='block-title'>病史与饮食</Text>
          <View className='row column'>
            <Text className='label'>既往病史</Text>
            <Text className='value'>{formatList(medicalHistory, MEDICAL_MAP)}</Text>
          </View>
          <View className='row column'>
            <Text className='label'>饮食偏好</Text>
            <Text className='value'>{formatList(dietPreference, DIET_PREF_MAP)}</Text>
          </View>
          <View className='row column'>
            <Text className='label'>过敏</Text>
            <Text className='value'>
              {allergies.length > 0 ? allergies.join('、') : '无'}
            </Text>
          </View>
        </View>

        <View className='footer-actions'>
          <View className='btn-secondary' onClick={handleRefill}>
            <Text className='btn-text'>重新填写</Text>
          </View>
          <View className='btn-primary' onClick={handleEdit}>
            <Text className='btn-text'>修改档案</Text>
          </View>
        </View>
      </ScrollView>
    </View>
  )
}
