import { View, Text, Input, Textarea, Image, ScrollView } from '@tarojs/components'
import { Button } from '@taroify/core'
import '@taroify/core/button/style'
import { useState, useEffect } from 'react'
import Taro from '@tarojs/taro'
import {
  getHealthProfile,
  updateHealthProfile,
  uploadReportImage,
  submitReportExtractionTask,
  imageToBase64,
  type HealthProfileUpdateRequest
} from '../../utils/api'

import './index.scss'
import HeightRuler from '../../components/HeightRuler'
import AgePicker from '../../components/AgePicker'
import WeightRuler from '../../components/WeightRuler'

/** 活动水平选项 */
const ACTIVITY_OPTIONS = [
  { label: '久坐', desc: '几乎不运动', value: 'sedentary', icon: '🛋️' },
  { label: '轻度', desc: '每周 1-3 天运动', value: 'light', icon: '🚶' },
  { label: '中度', desc: '每周 3-5 天运动', value: 'moderate', icon: '🏃' },
  { label: '高度', desc: '每周 6-7 天运动', value: 'active', icon: '💪' },
  { label: '极高', desc: '体力劳动/每天训练', value: 'very_active', icon: '🔥' }
]

/** 既往病史选项 */
const MEDICAL_OPTIONS = [
  { label: '糖尿病', value: 'diabetes' },
  { label: '高血压', value: 'hypertension' },
  { label: '痛风', value: 'gout' },
  { label: '高血脂', value: 'hyperlipidemia' },
  { label: '甲状腺疾病', value: 'thyroid' },
  { label: '无', value: 'none' }
]

/** 特殊饮食选项 */
const DIET_OPTIONS = [
  { label: '生酮', value: 'keto', icon: '🥑' },
  { label: '素食', value: 'vegetarian', icon: '🥬' },
  { label: '纯素', value: 'vegan', icon: '🌱' },
  { label: '低盐', value: 'low_salt', icon: '🧂' },
  { label: '无麸质', value: 'gluten_free', icon: '🌾' },
  { label: '无', value: 'none', icon: '' }
]

/** 目标选项 */
const GOAL_OPTIONS = [
  { label: '减重', desc: '健康瘦身', value: 'fat_loss', icon: 'icon-huore' },
  { label: '保持', desc: '维持当前体重', value: 'maintain', icon: 'icon-tianpingzuo' },
  { label: '增重', desc: '增加肌肉/体重', value: 'muscle_gain', icon: 'icon-zengji' }
]

export default function HealthProfileEditPage() {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const [gender, setGender] = useState<string>('')
  const [birthday, setBirthday] = useState<string>('')
  const [age, setAge] = useState<number>(25)
  const [height, setHeight] = useState<string>('')
  const [weight, setWeight] = useState<string>('')
  const [dietGoal, setDietGoal] = useState<string>('')
  const [activityLevel, setActivityLevel] = useState<string>('')
  const [medicalHistory, setMedicalHistory] = useState<string[]>(['none'])
  const [dietPreference, setDietPreference] = useState<string[]>([])
  const [allergies, setAllergies] = useState<string>('')
  const [reportImageUrl, setReportImageUrl] = useState<string | null>(null)

  const [customMedical, setCustomMedical] = useState<string>('')
  const [customMedicalList, setCustomMedicalList] = useState<string[]>([])
  const [selectedCustomMedical, setSelectedCustomMedical] = useState<string[]>([])

  const [healthNotes, setHealthNotes] = useState<string>('')

  const loadProfile = async () => {
    try {
      const profile = await getHealthProfile()
      if (profile.gender) setGender(profile.gender)
      if (profile.birthday) {
        setBirthday(profile.birthday)
        const birthYear = new Date(profile.birthday).getFullYear()
        const currentYear = new Date().getFullYear()
        setAge(currentYear - birthYear)
      } else {
        const year = new Date().getFullYear() - 25
        setBirthday(`${year}-01-01`)
        setAge(25)
      }
      if (profile.height != null) setHeight(String(profile.height))
      if (profile.weight != null) setWeight(String(profile.weight))
      if (profile.diet_goal) setDietGoal(profile.diet_goal)
      if (profile.activity_level) setActivityLevel(profile.activity_level)
      const hc = profile.health_condition
      if (hc?.medical_history?.length) {
        const predefinedValues = MEDICAL_OPTIONS.map(opt => opt.value)
        const presetMedical: string[] = []
        const customMedical: string[] = []

        hc.medical_history.forEach((item: string) => {
          if (predefinedValues.includes(item)) {
            presetMedical.push(item)
          } else {
            customMedical.push(item)
          }
        })

        setMedicalHistory(presetMedical)
        setCustomMedicalList(customMedical)
        setSelectedCustomMedical(customMedical)
      } else {
        setMedicalHistory(['none'])
      }
      if (hc?.diet_preference?.length) setDietPreference(hc.diet_preference)
      if (hc?.allergies?.length) setAllergies((hc.allergies as string[]).join('、'))
      if (hc?.health_notes) setHealthNotes(hc.health_notes)
    } catch {
      Taro.showToast({ title: '获取档案失败', icon: 'none' })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadProfile()
  }, [])

  const toggleMedical = (value: string) => {
    if (value === 'none') {
      setMedicalHistory(['none'])
      setSelectedCustomMedical([])
      return
    }
    setMedicalHistory((prev) => {
      const next = prev.filter((v) => v !== 'none')
      if (next.includes(value)) return next.filter((v) => v !== value)
      return [...next, value]
    })
  }

  const handleAddCustomMedical = () => {
    const trimmed = customMedical.trim()
    if (!trimmed) {
      Taro.showToast({ title: '请输入病史名称', icon: 'none' })
      return
    }
    if (customMedicalList.includes(trimmed)) {
      Taro.showToast({ title: '该病史已添加', icon: 'none' })
      return
    }
    setCustomMedicalList((prev) => [...prev, trimmed])
    setSelectedCustomMedical((prev) => [...prev, trimmed])
    setMedicalHistory((prev) => prev.filter((v) => v !== 'none'))
    setCustomMedical('')
  }

  const toggleCustomMedical = (item: string) => {
    setSelectedCustomMedical((prev) => {
      if (prev.includes(item)) {
        return prev.filter((v) => v !== item)
      }
      return [...prev, item]
    })
    setMedicalHistory((prev) => prev.filter((v) => v !== 'none'))
  }

  const handleRemoveCustomMedical = (item: string) => {
    Taro.showModal({
      title: '删除确认',
      content: `确定要删除「${item}」吗？`,
      success: (res) => {
        if (res.confirm) {
          setCustomMedicalList((prev) => prev.filter((v) => v !== item))
          setSelectedCustomMedical((prev) => prev.filter((v) => v !== item))
        }
      }
    })
  }

  const toggleDiet = (value: string) => {
    if (value === 'none') {
      setDietPreference(['none'])
      return
    }
    setDietPreference((prev) => {
      const next = prev.filter((v) => v !== 'none')
      if (next.includes(value)) return next.filter((v) => v !== value)
      return [...next, value]
    })
  }

  const handleSubmit = async () => {
    // 合并预设病史和选中的自定义病史
    const allMedicalHistory = [...medicalHistory.filter(v => v !== 'none'), ...selectedCustomMedical]
    const req: HealthProfileUpdateRequest = {
      gender: gender || undefined,
      birthday: birthday || undefined,
      height: height ? Number(height) : undefined,
      weight: weight ? Number(weight) : undefined,
      diet_goal: dietGoal || undefined,
      activity_level: activityLevel || undefined,
      medical_history: allMedicalHistory,
      diet_preference: dietPreference.filter(v => v !== 'none'),
      allergies: allergies ? allergies.split(/[、,，\s]+/).filter(Boolean) : [],
      health_notes: healthNotes,
      report_image_url: reportImageUrl || undefined
    }

    if (!req.gender || !req.birthday || !req.height || !req.weight || !req.diet_goal || !req.activity_level) {
      Taro.showToast({ title: '请完成必填项（前 6 项）', icon: 'none' })
      return
    }

    // 验证身高和体重范围
    if (req.height && (req.height < 100 || req.height > 250)) {
      Taro.showToast({ title: '请输入 100～250 之间的身高 (cm)', icon: 'none' })
      return
    }
    if (req.weight && (req.weight < 30 || req.weight > 200)) {
      Taro.showToast({ title: '请输入 30～200 之间的体重 (kg)', icon: 'none' })
      return
    }

    const { confirm } = await Taro.showModal({
      title: '确认保存',
      content: reportImageUrl
        ? '确定保存健康档案吗？体检报告将在后台自动识别，完成后会更新到档案中。'
        : '确定将修改后的健康信息保存到个人档案吗？'
    })
    if (!confirm) return

    setSaving(true)
    try {
      await updateHealthProfile(req)
      // 若有上传的体检报告图片，提交后台病历提取任务
      if (reportImageUrl) {
        submitReportExtractionTask(reportImageUrl).catch(() => {
          // 静默失败
        })
      }
      Taro.showToast({ title: '保存成功', icon: 'success' })
      setTimeout(() => {
        Taro.redirectTo({ url: '/pages/health-profile-view/index' })
      }, 1500)
    } catch (e: any) {
      Taro.showToast({ title: e.message || '保存失败', icon: 'none' })
    } finally {
      setSaving(false)
    }
  }

  const handleReportUpload = async () => {
    try {
      const res = await Taro.chooseImage({ count: 1, sizeType: ['compressed'] })
      const base64 = await imageToBase64(res.tempFilePaths[0])
      Taro.showLoading({ title: '上传中...', mask: true })
      const { imageUrl } = await uploadReportImage(base64)
      Taro.hideLoading()
      setReportImageUrl(imageUrl)
      Taro.showToast({ title: '上传成功，保存时将自动识别', icon: 'success' })
    } catch (e: any) {
      Taro.hideLoading()
      Taro.showToast({ title: e.message || '上传失败', icon: 'none' })
    }
  }

  const handleRefillQuestionnaire = () => {
    Taro.showModal({
      title: '重新填写',
      content: '将前往答题页面重新填写健康档案，当前编辑内容将不会保存。确定继续吗？',
      success: (res) => {
        if (res.confirm) {
          Taro.redirectTo({ url: '/pages/health-profile/index' })
        }
      }
    })
  }

  if (loading) {
    return (
      <View className="health-profile-edit-page">
        <View className="loading-wrap">
          <Text className="loading-text">加载中...</Text>
        </View>
      </View>
    )
  }

  return (
    <View className="health-profile-edit-page">
      <ScrollView className="scroll-wrap" scrollY enhanced showScrollbar={false}>
        {/* 基础信息 */}
        <View className="section">
          <Text className="section-title">基础信息</Text>

          <View className="form-item">
            <Text className="form-label">
              性别 <Text className="required">*</Text>
            </Text>
            <View className="choice-row">
              <View
                className={`choice-btn ${gender === 'male' ? 'active' : ''}`}
                onClick={() => setGender('male')}
              >
                <Text className="choice-icon iconfont icon-nannv-nan" />
                <Text className="choice-text">男</Text>
              </View>
              <View
                className={`choice-btn ${gender === 'female' ? 'active' : ''}`}
                onClick={() => setGender('female')}
              >
                <Text className="choice-icon iconfont icon-nannv-nv" />
                <Text className="choice-text">女</Text>
              </View>
            </View>
          </View>

          <View className="form-item">
            <Text className="form-label">
              年龄 <Text className="required">*</Text>
            </Text>
            <AgePicker
              value={age}
              onChange={(val) => {
                setAge(val)
                const year = new Date().getFullYear() - val
                setBirthday(`${year}-01-01`)
              }}
              min={1}
              max={100}
            />
          </View>

          <View className="form-item">
            <Text className="form-label">
              身高 <Text className="required">*</Text>
            </Text>
            <View className="ruler-container">
              <HeightRuler
                value={height ? Number(height) : 170}
                onChange={(val) => setHeight(String(val))}
                min={100}
                max={250}
              />
            </View>
          </View>

          <View className="form-item">
            <Text className="form-label">
              体重 <Text className="required">*</Text>
            </Text>
            <View className="ruler-container">
              <WeightRuler
                value={weight ? Number(weight) : 60}
                onChange={(val) => setWeight(String(val))}
                min={30}
                max={200}
                height={height ? Number(height) : 170}
              />
            </View>
          </View>

          <View className="form-item">
            <Text className="form-label">
              饮食目标 <Text className="required">*</Text>
            </Text>
            <View className="option-list">
              {GOAL_OPTIONS.map((opt) => (
                <View
                  key={opt.value}
                  className={`option-card ${dietGoal === opt.value ? 'active' : ''}`}
                  onClick={() => setDietGoal(opt.value)}
                >
                  <Text className={`option-icon iconfont ${opt.icon}`}></Text>
                  <View className="option-info">
                    <Text className="option-label">{opt.label}</Text>
                    <Text className="option-desc">{opt.desc}</Text>
                  </View>
                </View>
              ))}
            </View>
          </View>

          <View className="form-item">
            <Text className="form-label">
              活动水平 <Text className="required">*</Text>
            </Text>
            <View className="option-list">
              {ACTIVITY_OPTIONS.map((o) => (
                <View
                  key={o.value}
                  className={`option-card ${activityLevel === o.value ? 'active' : ''}`}
                  onClick={() => setActivityLevel(o.value)}
                >
                  <Text className="option-icon">{o.icon}</Text>
                  <Text className="option-label">{o.label}</Text>
                  <Text className="option-desc">{o.desc}</Text>
                </View>
              ))}
            </View>
          </View>
        </View>

        {/* 健康状况 */}
        <View className="section">
          <Text className="section-title">健康状况</Text>

          <View className="form-item">
            <Text className="form-label">既往病史（可多选）</Text>
            <View className="option-grid">
              {MEDICAL_OPTIONS.map((o) => (
                <View
                  key={o.value}
                  className={`tag-btn ${medicalHistory.includes(o.value) ? 'active' : ''}`}
                  onClick={() => toggleMedical(o.value)}
                >
                  <Text className="tag-text">{o.label}</Text>
                </View>
              ))}
              {customMedicalList.map((item) => (
                <View
                  key={item}
                  className={`tag-btn custom ${selectedCustomMedical.includes(item) ? 'active' : ''}`}
                  onClick={() => toggleCustomMedical(item)}
                  onLongPress={() => handleRemoveCustomMedical(item)}
                >
                  <Text className="tag-text">{item}</Text>
                </View>
              ))}
            </View>
            <View className="custom-input-wrap">
              <Input
                className="custom-input"
                placeholder="其他病史，输入后点击添加"
                value={customMedical}
                onInput={(e) => setCustomMedical(e.detail.value)}
                onConfirm={handleAddCustomMedical}
              />
              <View className="custom-input-btn" onClick={handleAddCustomMedical}>
                <Text>添加</Text>
              </View>
            </View>
          </View>

          <View className="form-item">
            <Text className="form-label">特殊饮食习惯（可多选）</Text>
            <View className="option-grid">
              {DIET_OPTIONS.map((o) => (
                <View
                  key={o.value}
                  className={`tag-btn ${dietPreference.includes(o.value) ? 'active' : ''}`}
                  onClick={() => toggleDiet(o.value)}
                >
                  <Text className="tag-icon">{o.icon}</Text>
                  <Text className="tag-text">{o.label}</Text>
                </View>
              ))}
            </View>
          </View>

          <View className="form-item">
            <Text className="form-label">过敏源</Text>
            <Textarea
              className="text-input textarea-input"
              placeholder="如：海鲜、花生，多个用顿号分隔"
              value={allergies}
              onInput={(e) => setAllergies(e.detail.value)}
              maxlength={200}
            />
          </View>

          <View className="form-item">
            <Text className="form-label">特殊情况和补充</Text>
            <Textarea
              className="text-input textarea-input"
              placeholder="例如：孕期、哺乳期、手术恢复期等"
              value={healthNotes}
              onInput={(e) => setHealthNotes(e.detail.value)}
              maxlength={500}
            />
          </View>
        </View>

        {/* 体检报告 */}
        <View className="section">
          <Text className="section-title">体检报告（选填）</Text>
          <View
            className={`upload-area ${reportImageUrl ? 'has-image' : ''}`}
            onClick={handleReportUpload}
          >
            {reportImageUrl ? (
              <>
                <Image src={reportImageUrl} mode="aspectFit" className="preview-image" />
                <View className="reupload-mask">
                  <Text className="iconfont icon-xiangji" style={{ fontSize: '48rpx', color: '#fff' }}></Text>
                  <Text className="reupload-text">点击更换图片</Text>
                </View>
              </>
            ) : (
              <View className="upload-placeholder">
                <Text className="upload-icon iconfont icon-paizhao-xianxing"></Text>
                <Text className="upload-title">点击上传报告</Text>
                <Text className="upload-desc">支持 JPG / PNG 格式图片</Text>
              </View>
            )}
          </View>
          <Text className="upload-hint">AI 将自动识别血糖、血脂等关键指标</Text>
        </View>

        {/* 底部操作按钮 */}
        <View className="footer-actions">
          <View className="refill-link" onClick={handleRefillQuestionnaire}>
            <Text className="refill-text">或前往答题页面重新填写</Text>
          </View>
          <Button
            block
            color="primary"
            shape="round"
            className="save-btn"
            onClick={handleSubmit}
            loading={saving}
          >
            保存修改
          </Button>
        </View>
      </ScrollView>
    </View>
  )
}
