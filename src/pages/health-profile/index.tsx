import { View, Text, Input, Picker, Button } from '@tarojs/components'
import { useState, useEffect } from 'react'
import Taro from '@tarojs/taro'
import {
  getHealthProfile,
  updateHealthProfile,
  uploadReportImage,
  extractHealthReportOcr,
  imageToBase64,
  type HealthProfileUpdateRequest
} from '../../utils/api'

import './index.scss'

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
  { label: '糖尿病', value: 'diabetes', icon: '🩸' },
  { label: '高血压', value: 'hypertension', icon: '❤️' },
  { label: '痛风', value: 'gout', icon: '🦴' },
  { label: '高血脂', value: 'hyperlipidemia', icon: '📊' },
  { label: '甲状腺疾病', value: 'thyroid', icon: '🦋' },
  { label: '无', value: 'none', icon: '✅' }
]

/** 特殊饮食选项 */
const DIET_OPTIONS = [
  { label: '生酮', value: 'keto', icon: '🥑' },
  { label: '素食', value: 'vegetarian', icon: '🥬' },
  { label: '纯素', value: 'vegan', icon: '🌱' },
  { label: '低盐', value: 'low_salt', icon: '🧂' },
  { label: '无麸质', value: 'gluten_free', icon: '🌾' },
  { label: '无', value: 'none', icon: '✨' }
]

const TOTAL_STEPS = 10 // 性别、生日、身高、体重、活动、病史、饮食、过敏、上传体检报告、最后一步保存

export default function HealthProfilePage() {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [currentStep, setCurrentStep] = useState(0)
  const [direction, setDirection] = useState<'next' | 'prev'>('next')

  const [gender, setGender] = useState<string>('')
  const [birthday, setBirthday] = useState<string>('')
  const [height, setHeight] = useState<string>('')
  const [weight, setWeight] = useState<string>('')
  const [activityLevel, setActivityLevel] = useState<string>('')
  const [medicalHistory, setMedicalHistory] = useState<string[]>([])
  const [dietPreference, setDietPreference] = useState<string[]>([])
  const [allergies, setAllergies] = useState<string>('')
  const [reportImageUrl, setReportImageUrl] = useState<string | null>(null)
  const [reportExtract, setReportExtract] = useState<Record<string, unknown> | null>(null)
  const [bmr, setBmr] = useState<number | null>(null)
  const [tdee, setTdee] = useState<number | null>(null)
  const [touchStartX, setTouchStartX] = useState(0)

  const loadProfile = async () => {
    try {
      const profile = await getHealthProfile()
      if (profile.gender) setGender(profile.gender)
      if (profile.birthday) setBirthday(profile.birthday)
      if (profile.height != null) setHeight(String(profile.height))
      if (profile.weight != null) setWeight(String(profile.weight))
      if (profile.activity_level) setActivityLevel(profile.activity_level)
      const hc = profile.health_condition
      if (hc?.medical_history?.length) setMedicalHistory(hc.medical_history)
      if (hc?.diet_preference?.length) setDietPreference(hc.diet_preference)
      if (hc?.allergies?.length) setAllergies((hc.allergies as string[]).join('、'))
      if (profile.bmr != null) setBmr(profile.bmr)
      if (profile.tdee != null) setTdee(profile.tdee)
    } catch {
      Taro.showToast({ title: '获取档案失败', icon: 'none' })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadProfile()
  }, [])

  const goNext = () => {
    if (currentStep >= TOTAL_STEPS - 1) return
    if (!canProceed()) {
      if (currentStep === 2 && height) {
        Taro.showToast({ title: '请输入 100～250 之间的身高 (cm)', icon: 'none' })
      } else if (currentStep === 3 && weight) {
        Taro.showToast({ title: '请输入 30～200 之间的体重 (kg)', icon: 'none' })
      } else {
        Taro.showToast({ title: '请先完成当前题目', icon: 'none' })
      }
      return
    }
    setDirection('next')
    setCurrentStep((s) => s + 1)
  }

  const goPrev = () => {
    if (currentStep <= 0) return
    setDirection('prev')
    setCurrentStep((s) => s - 1)
  }

  /** 左滑下一题 / 右滑上一题（方案 D 手势） */
  const handleTouchStart = (e: any) => {
    setTouchStartX(e.touches?.[0]?.clientX ?? e.detail?.touches?.[0]?.clientX ?? 0)
  }
  const handleTouchEnd = (e: any) => {
    const endX = e.changedTouches?.[0]?.clientX ?? e.detail?.changedTouches?.[0]?.clientX ?? 0
    const delta = endX - touchStartX
    if (delta < -50 && currentStep < TOTAL_STEPS - 1) goNext()
    else if (delta > 50 && currentStep > 0) goPrev()
  }

  const toggleMedical = (value: string) => {
    if (value === 'none') {
      setMedicalHistory(['none'])
      return
    }
    setMedicalHistory((prev) => {
      const next = prev.filter((v) => v !== 'none')
      if (next.includes(value)) return next.filter((v) => v !== value)
      return [...next, value]
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

  const handleSelectGender = (value: string) => {
    setGender(value)
  }

  const handleSelectActivity = (value: string) => {
    setActivityLevel(value)
  }

  const canProceed = () => {
    switch (currentStep) {
      case 0:
        return !!gender
      case 1:
        return !!birthday
      case 2:
        return !!height && Number(height) >= 100 && Number(height) <= 250
      case 3:
        return !!weight && Number(weight) >= 30 && Number(weight) <= 200
      case 4:
        return !!activityLevel
      case 5:
      case 6:
      case 7:
        return true
      default:
        return true
    }
  }

  const handleSubmit = async () => {
    const req: HealthProfileUpdateRequest = {
      gender: gender || undefined,
      birthday: birthday || undefined,
      height: height ? Number(height) : undefined,
      weight: weight ? Number(weight) : undefined,
      activity_level: activityLevel || undefined,
      medical_history: medicalHistory.length ? medicalHistory : undefined,
      diet_preference: dietPreference.length ? dietPreference : undefined,
      allergies: allergies ? allergies.split(/[、,，\s]+/).filter(Boolean) : undefined,
      report_extract: reportExtract || undefined,
      report_image_url: reportImageUrl || undefined
    }
    if (!req.gender || !req.birthday || !req.height || !req.weight || !req.activity_level) {
      Taro.showToast({ title: '请完成前几项必填', icon: 'none' })
      return
    }
    const { confirm } = await Taro.showModal({
      title: '确认保存',
      content: '确定将当前填写的健康信息及体检报告识别结果保存到个人档案吗？'
    })
    if (!confirm) return
    setSaving(true)
    try {
      const res = await updateHealthProfile(req)
      setBmr(res.bmr ?? null)
      setTdee(res.tdee ?? null)
      Taro.showToast({ title: '保存成功', icon: 'success' })
      setTimeout(() => {
        Taro.switchTab({ url: '/pages/profile/index' })
      }, 1500)
    } catch (e: any) {
      Taro.showToast({ title: e.message || '保存失败', icon: 'none' })
    } finally {
      setSaving(false)
    }
  }

  /** 上传体检报告：先上传到 Supabase 拿 URL，再传 URL 给多模态模型识别，不保存；点击「保存健康档案」时再一并写入 user_health_documents */
  const handleReportUpload = async () => {
    try {
      const res = await Taro.chooseImage({ count: 1, sizeType: ['compressed'] })
      const base64 = await imageToBase64(res.tempFilePaths[0])
      Taro.showLoading({ title: '上传中...', mask: true })
      const { imageUrl } = await uploadReportImage(base64)
      setReportImageUrl(imageUrl)
      Taro.showLoading({ title: '识别中...', mask: true })
      const { extracted } = await extractHealthReportOcr({ imageUrl })
      Taro.hideLoading()
      setReportExtract(extracted)
      Taro.showToast({ title: '已识别，保存时将一并提交', icon: 'success' })
    } catch (e: any) {
      Taro.hideLoading()
      Taro.showToast({ title: e.message || '上传或识别失败', icon: 'none' })
    }
  }

  if (loading) {
    return (
      <View className="health-profile-page">
        <View className="card step-card">
          <Text className="step-card-title">加载中...</Text>
        </View>
      </View>
    )
  }

  const isLastStep = currentStep === TOTAL_STEPS - 1

  return (
    <View className="health-profile-page">
      {/* 进度条 */}
      <View className="progress-wrap">
        <View className="progress-dots">
          {Array.from({ length: TOTAL_STEPS }).map((_, i) => (
            <View
              key={i}
              className={`progress-dot ${i <= currentStep ? 'active' : ''} ${i === currentStep ? 'current' : ''}`}
            />
          ))}
        </View>
        <Text className="progress-text">
          {currentStep + 1} / {TOTAL_STEPS}
          {!isLastStep && (
            <Text className="progress-swipe-hint"> · 左滑下一题</Text>
          )}
        </Text>
      </View>

      {/* 卡片滑动容器：支持左滑下一题 / 右滑上一题 */}
      <View
        className="cards-wrap"
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        <View
          className="cards-track"
          style={{
            transform: `translateX(-${currentStep * 686}rpx)`,
            transition: 'transform 0.3s ease-out'
          }}
        >
          {/* Step 0: 性别 */}
          <View className="card step-card">
            <Text className="step-card-step">第 1 题</Text>
            <Text className="step-card-title">你的性别是？</Text>
            <View className="choice-row choice-row-vertical">
              <View
                className={`option-card big ${gender === 'male' ? 'active' : ''}`}
                onClick={() => handleSelectGender('male')}
              >
                <Text className="option-icon">👨</Text>
                <Text className="option-label">男</Text>
              </View>
              <View
                className={`option-card big ${gender === 'female' ? 'active' : ''}`}
                onClick={() => handleSelectGender('female')}
              >
                <Text className="option-icon">👩</Text>
                <Text className="option-label">女</Text>
              </View>
            </View>
            <View className="card-footer card-footer-single">
              <Button className={`card-next-btn ${gender ? 'ready' : ''}`} onClick={goNext} disabled={!gender}>
                确认
              </Button>
            </View>
          </View>

          {/* Step 1: 出生日期 */}
          <View className="card step-card">
            <Text className="step-card-step">第 2 题</Text>
            <Text className="step-card-title">你的出生日期？</Text>
            <Picker
              mode="date"
              end={new Date().toISOString().slice(0, 10)}
              value={birthday || '1990-01-01'}
              onChange={(e) => setBirthday(e.detail.value)}
            >
              <View className="picker-card">
                <Text className="picker-card-value">{birthday || '点击选择日期'}</Text>
                <Text className="picker-card-hint">用于计算年龄与代谢</Text>
              </View>
            </Picker>
            <View className="card-footer">
              <View className="card-prev-link" onClick={goPrev}>上一题</View>
              <Button className={`card-next-btn ${birthday ? 'ready' : ''}`} onClick={goNext} disabled={!birthday}>
                确认
              </Button>
            </View>
          </View>

          {/* Step 2: 身高 */}
          <View className="card step-card">
            <Text className="step-card-step">第 3 题</Text>
            <Text className="step-card-title">你的身高是？</Text>
            <View className="quick-numbers">
              {[160, 165, 170, 175, 180].map((n) => (
                <View
                  key={n}
                  className={`quick-num ${height === String(n) ? 'active' : ''}`}
                  onClick={() => setHeight(String(n))}
                >
                  <Text>{n}</Text>
                  <Text className="quick-num-unit">cm</Text>
                </View>
              ))}
            </View>
            <View className="input-card">
              <Input
                className="card-input"
                type="number"
                placeholder="或输入其他身高 (cm)"
                value={height}
                onInput={(e) => setHeight(e.detail.value)}
              />
            </View>
            <View className="card-footer">
              <View className="card-prev-link" onClick={goPrev}>上一题</View>
              <Button className={`card-next-btn ${height ? 'ready' : ''}`} onClick={goNext} disabled={!height}>
                确认
              </Button>
            </View>
          </View>

          {/* Step 3: 体重 */}
          <View className="card step-card">
            <Text className="step-card-step">第 4 题</Text>
            <Text className="step-card-title">你的体重是？</Text>
            <View className="quick-numbers">
              {[50, 55, 60, 65, 70].map((n) => (
                <View
                  key={n}
                  className={`quick-num ${weight === String(n) ? 'active' : ''}`}
                  onClick={() => setWeight(String(n))}
                >
                  <Text>{n}</Text>
                  <Text className="quick-num-unit">kg</Text>
                </View>
              ))}
            </View>
            <View className="input-card">
              <Input
                className="card-input"
                type="digit"
                placeholder="或输入其他体重 (kg)"
                value={weight}
                onInput={(e) => setWeight(e.detail.value)}
              />
            </View>
            <View className="card-footer">
              <View className="card-prev-link" onClick={goPrev}>上一题</View>
              <Button className={`card-next-btn ${weight ? 'ready' : ''}`} onClick={goNext} disabled={!weight}>
                确认
              </Button>
            </View>
          </View>

          {/* Step 4: 活动水平 */}
          <View className="card step-card">
            <Text className="step-card-step">第 5 题</Text>
            <Text className="step-card-title">日常活动水平？</Text>
            <View className="option-list">
              {ACTIVITY_OPTIONS.map((o) => (
                <View
                  key={o.value}
                  className={`option-card with-desc ${activityLevel === o.value ? 'active' : ''}`}
                  onClick={() => handleSelectActivity(o.value)}
                >
                  <Text className="option-icon">{o.icon}</Text>
                  <Text className="option-label">{o.label}</Text>
                  <Text className="option-desc">{o.desc}</Text>
                </View>
              ))}
            </View>
            <View className="card-footer">
              <View className="card-prev-link" onClick={goPrev}>上一题</View>
              <Button className={`card-next-btn ${activityLevel ? 'ready' : ''}`} onClick={goNext} disabled={!activityLevel}>
                确认
              </Button>
            </View>
          </View>

          {/* Step 5: 既往病史（多选） */}
          <View className="card step-card">
            <Text className="step-card-step">第 6 题</Text>
            <Text className="step-card-title">是否有以下病史？（可多选）</Text>
            <View className="option-grid">
              {MEDICAL_OPTIONS.map((o) => (
                <View
                  key={o.value}
                  className={`option-card small ${medicalHistory.includes(o.value) ? 'active' : ''}`}
                  onClick={() => toggleMedical(o.value)}
                >
                  <Text className="option-icon">{o.icon}</Text>
                  <Text className="option-label">{o.label}</Text>
                </View>
              ))}
            </View>
            <View className="card-footer">
              <View className="card-prev-link" onClick={goPrev}>上一题</View>
              <Button className="card-next-btn ready" onClick={goNext}>
                确认
              </Button>
            </View>
          </View>

          {/* Step 6: 特殊饮食（多选） */}
          <View className="card step-card">
            <Text className="step-card-step">第 7 题</Text>
            <Text className="step-card-title">特殊饮食习惯？（可多选）</Text>
            <View className="option-grid">
              {DIET_OPTIONS.map((o) => (
                <View
                  key={o.value}
                  className={`option-card small ${dietPreference.includes(o.value) ? 'active' : ''}`}
                  onClick={() => toggleDiet(o.value)}
                >
                  <Text className="option-icon">{o.icon}</Text>
                  <Text className="option-label">{o.label}</Text>
                </View>
              ))}
            </View>
            <View className="card-footer">
              <View className="card-prev-link" onClick={goPrev}>上一题</View>
              <Button className="card-next-btn ready" onClick={goNext}>
                确认
              </Button>
            </View>
          </View>

          {/* Step 7: 过敏源 */}
          <View className="card step-card">
            <Text className="step-card-step">第 8 题（选填）</Text>
            <Text className="step-card-title">有过敏源吗？</Text>
            <View className="input-card">
              <Input
                className="card-input"
                placeholder="如：海鲜、花生，多个用顿号分隔"
                value={allergies}
                onInput={(e) => setAllergies(e.detail.value)}
              />
            </View>
            <Text className="skip-hint">没有可留空</Text>
            <View className="card-footer">
              <View className="card-prev-link" onClick={goPrev}>上一题</View>
              <Button className="card-next-btn ready" onClick={goNext}>
                确认
              </Button>
            </View>
          </View>

          {/* Step 8: 上传体检报告（单独卡片，仅识别并展示结果，不保存；点击「保存健康档案」时再一并保存） */}
          <View className="card step-card">
            <Text className="step-card-step">第 9 题（选填）</Text>
            <Text className="step-card-title">上传体检报告/病例截图</Text>
            <Text className="report-card-desc">AI 仅识别并展示结果，不会保存。请到下一步点击「保存健康档案」时，再与个人身体情况一并保存。</Text>
            <Button className="report-upload-btn" onClick={handleReportUpload}>
              {reportExtract ? '✓ 已识别，可重新上传' : '选择报告截图'}
            </Button>
            {reportExtract && (
              <View className="report-result">
                <Text className="report-result-title">识别结果（仅供参考，尚未保存）</Text>
                {Array.isArray(reportExtract.indicators) && (reportExtract.indicators as Array<{ name?: string; value?: string; unit?: string }>).length > 0 && (
                  <View className="report-result-block">
                    <Text className="report-result-label">指标</Text>
                    {(reportExtract.indicators as Array<{ name?: string; value?: string; unit?: string }>).map((item, i) => (
                      <Text key={i} className="report-result-item">
                        {item.name || '—'}: {item.value ?? '—'} {item.unit ?? ''}
                      </Text>
                    ))}
                  </View>
                )}
                {Array.isArray(reportExtract.conclusions) && (reportExtract.conclusions as string[]).length > 0 && (
                  <View className="report-result-block">
                    <Text className="report-result-label">结论</Text>
                    {(reportExtract.conclusions as string[]).map((s, i) => (
                      <Text key={i} className="report-result-item">• {s}</Text>
                    ))}
                  </View>
                )}
                {Array.isArray(reportExtract.suggestions) && (reportExtract.suggestions as string[]).length > 0 && (
                  <View className="report-result-block">
                    <Text className="report-result-label">建议</Text>
                    {(reportExtract.suggestions as string[]).map((s, i) => (
                      <Text key={i} className="report-result-item">• {s}</Text>
                    ))}
                  </View>
                )}
                {reportExtract.medical_notes && (
                  <View className="report-result-block">
                    <Text className="report-result-label">其他说明</Text>
                    <Text className="report-result-text">{String(reportExtract.medical_notes)}</Text>
                  </View>
                )}
              </View>
            )}
            <View className="card-footer">
              <View className="card-prev-link" onClick={goPrev}>上一题</View>
              <Button className="card-next-btn ready" onClick={goNext}>
                确认
              </Button>
            </View>
          </View>

          {/* Step 9（最后一步）: 保存健康信息 */}
          <View className="card step-card last">
            <Text className="step-card-step">最后一步</Text>
            <Text className="step-card-title">保存健康信息</Text>
            <Text className="save-hint">将保存：个人身体情况 + 病史与饮食偏好{reportExtract ? ' + 体检报告识别结果' : ''}</Text>
            <Button className="card-next-btn primary" onClick={handleSubmit} disabled={saving}>
              {saving ? '保存中...' : '保存健康信息'}
            </Button>
            {bmr != null && tdee != null && (
              <View className="result-mini">
                <Text>BMR {bmr.toFixed(0)} · TDEE {tdee.toFixed(0)} kcal/天</Text>
              </View>
            )}
          </View>
        </View>
      </View>
    </View>
  )
}
