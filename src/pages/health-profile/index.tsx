import { View, Text, Input, Textarea, Image } from '@tarojs/components'
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
  getMyMembership,
  type HealthProfileUpdateRequest,
  type ExecutionMode,
  type MembershipStatus,
} from '../../utils/api'
import { normalizeAvailableExecutionMode, notifyStrictModeUnavailable } from '../../utils/execution-mode'
import { withAuth } from '../../utils/withAuth'

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

/** 既往病史选项（无图标） */
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
  { label: '无', value: 'none', icon: '✨' }
]

/** 目标选项 */
const GOAL_OPTIONS = [
  { label: '减重', desc: '健康瘦身', value: 'fat_loss', icon: 'icon-huore' },
  { label: '保持', desc: '维持当前体重', value: 'maintain', icon: 'icon-tianpingzuo' },
  { label: '增重', desc: '增加肌肉/体重', value: 'muscle_gain', icon: 'icon-zengji' }
]

const EXECUTION_MODE_OPTIONS: Array<{ value: ExecutionMode; title: string; desc: string }> = [
  { value: 'strict', title: '精准模式', desc: '更准确的分项估算，适合减脂/增肌。需开通食探会员。' },
  { value: 'standard', title: '标准模式', desc: '记录更快，但估算波动更大，适合先建立习惯。' }
]

const TOTAL_STEPS = 12 // 性别、生日、身高、体重、目标、活动、执行模式、病史、饮食、过敏、特殊情况、体检报告

function HealthProfilePage() {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [currentStep, setCurrentStep] = useState(0)

  const [gender, setGender] = useState<string>('')
  const [birthday, setBirthday] = useState<string>('')
  const [age, setAge] = useState<number>(25) // Default age
  const [height, setHeight] = useState<string>('')
  const [weight, setWeight] = useState<string>('')
  const [dietGoal, setDietGoal] = useState<string>('')
  const [activityLevel, setActivityLevel] = useState<string>('')
  const [executionMode, setExecutionMode] = useState<ExecutionMode>('standard')
  const [executionModeTouched, setExecutionModeTouched] = useState(false)
  const [medicalHistory, setMedicalHistory] = useState<string[]>([])
  const [dietPreference, setDietPreference] = useState<string[]>([])
  const [allergies, setAllergies] = useState<string>('')
  const [reportImageUrl, setReportImageUrl] = useState<string | null>(null)
  const [reportStorageKey, setReportStorageKey] = useState<string | null>(null)
  const [membershipStatus, setMembershipStatus] = useState<MembershipStatus | null>(null)

  const [customMedical, setCustomMedical] = useState<string>('') // 自定义病史输入
  const [customMedicalList, setCustomMedicalList] = useState<string[]>([]) // 用户添加的自定义病史列表
  const [selectedCustomMedical, setSelectedCustomMedical] = useState<string[]>([]) // 被选中的自定义病史

  const [healthNotes, setHealthNotes] = useState<string>('') // 用户自己文字补充自己身体的特殊情况和问题

  const loadProfile = async () => {
    try {
      const profile = await getHealthProfile()
      if (profile.gender) setGender(profile.gender)
      if (profile.birthday) {
        setBirthday(profile.birthday)
        // Calculate age
        const birthYear = new Date(profile.birthday).getFullYear()
        const currentYear = new Date().getFullYear()
        setAge(currentYear - birthYear)
      } else {
        // Default birthday to 25 years ago if not set
        const year = new Date().getFullYear() - 25
        setBirthday(`${year}-01-01`)
        setAge(25)
      }
      if (profile.height != null) setHeight(String(profile.height))
      if (profile.weight != null) setWeight(String(profile.weight))
      if (profile.diet_goal) setDietGoal(profile.diet_goal)
      if (profile.activity_level) setActivityLevel(profile.activity_level)
      if (profile.execution_mode) {
        setExecutionMode(profile.execution_mode)
        setExecutionModeTouched(true)
      }
      const hc = profile.health_condition
      if (hc?.medical_history?.length) setMedicalHistory(hc.medical_history)
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
    getMyMembership().then(ms => setMembershipStatus(ms)).catch(() => {})
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
    setCurrentStep((s) => s + 1)
  }

  const goPrev = () => {
    if (currentStep <= 0) return
    setCurrentStep((s) => s - 1)
  }

  const toggleMedical = (value: string) => {
    if (value === 'none') {
      setMedicalHistory(['none'])
      setSelectedCustomMedical([]) // 选择"无"时取消所有自定义病史的选中
      return
    }
    setMedicalHistory((prev) => {
      const next = prev.filter((v) => v !== 'none')
      if (next.includes(value)) return next.filter((v) => v !== value)
      return [...next, value]
    })
  }

  // 添加自定义病史
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
    setSelectedCustomMedical((prev) => [...prev, trimmed]) // 添加时默认选中
    setMedicalHistory((prev) => prev.filter((v) => v !== 'none')) // 添加自定义时移除"无"
    setCustomMedical('')
  }

  // 切换自定义病史的选中状态
  const toggleCustomMedical = (item: string) => {
    setSelectedCustomMedical((prev) => {
      if (prev.includes(item)) {
        return prev.filter((v) => v !== item)
      }
      return [...prev, item]
    })
    // 选中自定义病史时移除"无"
    setMedicalHistory((prev) => prev.filter((v) => v !== 'none'))
  }

  // 删除自定义病史（长按）
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

  const handleSelectGender = (value: string) => {
    setGender(value)
  }

  const handleSelectActivity = (value: string) => {
    setActivityLevel(value)
  }

  const recommendExecutionMode = (goal: string): ExecutionMode => {
    if (goal === 'fat_loss' || goal === 'muscle_gain') return 'strict'
    return 'standard'
  }

  const handleSelectDietGoal = (value: string) => {
    setDietGoal(value)
    if (!executionModeTouched) {
      setExecutionMode(recommendExecutionMode(value))
    }
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
      case 4: // New step for dietGoal
        return !!dietGoal
      case 5:
        return !!activityLevel
      case 6:
        return !!executionMode
      case 7:
      case 8:
      case 9:
      case 10:
        return true
      default:
        return true
    }
  }

  const handleSubmit = async () => {
    // 合并预设病史和选中的自定义病史
    const allMedicalHistory = [...medicalHistory.filter(v => v !== 'none'), ...selectedCustomMedical]
    let effectiveMode = executionMode
    const req: HealthProfileUpdateRequest = {
      gender: gender || undefined,
      birthday: birthday || undefined,
      height: height ? Number(height) : undefined,
      weight: weight ? Number(weight) : undefined,
      diet_goal: dietGoal || undefined,
      activity_level: activityLevel || undefined,
      execution_mode: effectiveMode,
      medical_history: allMedicalHistory.length ? allMedicalHistory : undefined,
      diet_preference: dietPreference.length ? dietPreference : undefined,
      allergies: allergies ? allergies.split(/[、,，\s]+/).filter(Boolean) : undefined,
      health_notes: healthNotes || undefined,
      report_image_url: reportStorageKey || reportImageUrl || undefined
    }
    if (!req.gender || !req.birthday || !req.height || !req.weight || !req.diet_goal || !req.activity_level || !req.execution_mode) {
      Taro.showToast({ title: '请完成前几项必填', icon: 'none' })
      return
    }

    const canStrict =
      typeof membershipStatus?.points_balance === 'number'
        ? (membershipStatus.points_balance as number) >= 2
        : Boolean(membershipStatus?.is_pro)
    if (effectiveMode === 'strict' && !canStrict) {
      const { confirm } = await Taro.showModal({
        title: '积分不足',
        content: '精准模式每次消耗 2 积分，当前积分不足。是否前往充值？\n若取消则自动以标准模式保存。',
        confirmText: '去充值',
        cancelText: '标准模式保存',
      })
      if (confirm) {
        Taro.navigateTo({ url: '/pages/pro-membership/index' })
        return
      }
      effectiveMode = 'standard'
      setExecutionMode('standard')
      req.execution_mode = 'standard'
    }

    const { confirm } = await Taro.showModal({
      title: '确认保存',
      content: reportImageUrl
        ? '确定保存健康档案吗？体检报告将在后台自动识别，完成后会更新到档案中。'
        : '确定将当前填写的健康信息保存到个人档案吗？'
    })
    if (!confirm) return
    setSaving(true)
    try {
      await updateHealthProfile(req)
      // 若有上传的体检报告图片，提交后台病历提取任务（用户无感知）
      if (reportStorageKey || reportImageUrl) {
        submitReportExtractionTask({ storageKey: reportStorageKey || undefined, imageUrl: reportImageUrl || undefined }).catch(() => {
          // 静默失败，不影响保存成功
        })
      }
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

  /** 上传体检报告：仅上传到对象存储并展示，不解析；点击「保存健康档案」时在后台提交病历提取任务 */
  const handleReportUpload = async () => {
    try {
      const res = await Taro.chooseImage({ count: 1, sizeType: ['compressed'] })
      const base64 = await imageToBase64(res.tempFilePaths[0])
      Taro.showLoading({ title: '上传中...', mask: true })
      const { imageUrl, storageKey } = await uploadReportImage(base64)
      Taro.hideLoading()
      setReportImageUrl(imageUrl)
      setReportStorageKey(storageKey || null)
      Taro.showToast({ title: '上传成功，保存时将自动识别', icon: 'success' })
    } catch (e: any) {
      Taro.hideLoading()
      Taro.showToast({ title: e.message || '上传失败', icon: 'none' })
    }
  }

  if (loading) {
    return (
      <View className='health-profile-page'>
        <View className='card step-card'>
          <View className='loading-spinner-md' />
        </View>
      </View>
    )
  }

  return (
    <View className='health-profile-page'>
      {/* 进度条 */}
      <View className='progress-wrap'>
        <View className='progress-dots'>
          {Array.from({ length: TOTAL_STEPS }).map((_, i) => (
            <View
              key={i}
              className={`progress-dot ${i <= currentStep ? 'active' : ''} ${i === currentStep ? 'current' : ''}`}
            />
          ))}
        </View>
        <Text className='progress-text'>
          {currentStep + 1} / {TOTAL_STEPS}
        </Text>
      </View>

      {/* 卡片容器：通过上一题/确认切换 */}
      <View className='cards-wrap'>
        <View
          className='cards-track'
          style={{
            transform: `translateX(-${currentStep * 750}rpx)`,
            transition: 'transform 0.3s ease-out'
          }}
        >
          {/* Step 0: 性别 */}
          <View className='card step-card'>
            <Text className='step-card-step'>第 1 题</Text>
            <Text className='step-card-title'>你的性别是？</Text>
            <View className='choice-row choice-row-vertical'>
              <View
                className={`option-card big ${gender === 'male' ? 'active' : ''}`}
                onClick={() => handleSelectGender('male')}
              >
                <Text className='option-icon iconfont icon-nannv-nan' />
                <Text className='option-label'>男</Text>
              </View>
              <View
                className={`option-card big ${gender === 'female' ? 'active' : ''}`}
                onClick={() => handleSelectGender('female')}
              >
                <Text className='option-icon iconfont icon-nannv-nv' />
                <Text className='option-label'>女</Text>
              </View>
            </View>
            <View className='card-footer card-footer-single'>
              <Button block color='primary' shape='round' className={`card-next-btn ${gender ? 'ready' : ''}`} onClick={goNext} disabled={!gender}>
                确认
              </Button>
            </View>
          </View>

          {/* Step 1: 出生日期 (Changed to Age Selection) */}
          <View className='card step-card'>
            <Text className='step-card-step'>第 2 题</Text>
            <Text className='step-card-title'>您的年龄是？</Text>
            <View style={{ width: '100%', marginBottom: '24px' }}>
              <AgePicker
                value={age}
                onChange={(val) => {
                  setAge(val)
                  // Update birthday state automatically
                  const year = new Date().getFullYear() - val
                  setBirthday(`${year}-01-01`)
                }}
                min={1}
                max={100}
              />
            </View>
            <View className='card-footer'>
              <View className='card-prev-link' onClick={goPrev}>上一题</View>
              <Button block color='primary' shape='round' className={`card-next-btn ${birthday ? 'ready' : ''}`} onClick={goNext} disabled={!birthday}>
                确认
              </Button>
            </View>
          </View>

          {/* Step 2: 身高 */}
          <View className='card step-card'>
            <Text className='step-card-step'>第 3 题</Text>
            <Text className='step-card-title'>你的身高是？</Text>
            {/* 使用 HeightRuler 替换原有的输入 */}
            <View style={{ width: '100%', marginBottom: '24px' }}>
              <HeightRuler
                value={height ? Number(height) : 170}
                onChange={(val) => setHeight(String(val))}
                min={100}
                max={250}
              />
            </View>
            <View className='card-footer'>
              <View className='card-prev-link' onClick={goPrev}>上一题</View>
              <Button block color='primary' shape='round' className={`card-next-btn ${height ? 'ready' : ''}`} onClick={goNext} disabled={!height}>
                确认
              </Button>
            </View>
          </View>

          {/* Step 3: 体重 */}
          <View className='card step-card'>
            <Text className='step-card-step'>第 4 题</Text>
            {/* Title is handled inside WeightRuler for better layout */}
            <WeightRuler
              value={weight ? Number(weight) : 60}
              onChange={(val) => setWeight(String(val))}
              min={30}
              max={200}
              height={height ? Number(height) : 170}
            />
            <View className='card-footer'>
              <View className='card-prev-link' onClick={goPrev}>上一题</View>
              <Button block color='primary' shape='round' className={`card-next-btn ${weight ? 'ready' : ''}`} onClick={goNext} disabled={!weight}>
                确认
              </Button>
            </View>
          </View>

          {/* Step 4: 目标选择 */}
          <View className='card step-card'>
            <Text className='step-card-step'>第 5 题</Text>
            <Text className='step-card-title'>您的目标？</Text>
            <View className='option-list'>
              {GOAL_OPTIONS.map((opt) => (
                <View
                  key={opt.value}
                  className={`option-card with-desc ${dietGoal === opt.value ? 'active' : ''}`}
                  onClick={() => handleSelectDietGoal(opt.value)}
                >
                  <Text className={`option-icon iconfont ${opt.icon}`}></Text>
                  <View className='option-info'>
                    <Text className='option-label'>{opt.label}</Text>
                    <Text className='option-desc'>{opt.desc}</Text>
                  </View>
                </View>
              ))}
            </View>
            <View className='card-footer'>
              <View className='card-prev-link' onClick={goPrev}>上一题</View>
              <Button block color='primary' shape='round' className={`card-next-btn ${dietGoal ? 'ready' : ''}`} onClick={goNext} disabled={!dietGoal}>
                确认
              </Button>
            </View>
          </View>

          {/* Step 5: 活动水平 */}
          <View className='card step-card'>
            <Text className='step-card-step'>第 6 题</Text>
            <Text className='step-card-title'>日常活动水平？</Text>
            <View className='option-list'>
              {ACTIVITY_OPTIONS.map((o) => (
                <View
                  key={o.value}
                  className={`option-card with-desc ${activityLevel === o.value ? 'active' : ''}`}
                  onClick={() => handleSelectActivity(o.value)}
                >
                  <Text className='option-icon'>{o.icon}</Text>
                  <Text className='option-label'>{o.label}</Text>
                  <Text className='option-desc'>{o.desc}</Text>
                </View>
              ))}
            </View>
            <View className='card-footer'>
              <View className='card-prev-link' onClick={goPrev}>上一题</View>
              <Button block color='primary' shape='round' className={`card-next-btn ${activityLevel ? 'ready' : ''}`} onClick={goNext} disabled={!activityLevel}>
                确认
              </Button>
            </View>
          </View>

          {/* Step 6: 执行模式 */}
          <View className='card step-card'>
            <Text className='step-card-step'>第 7 题</Text>
            <Text className='step-card-title'>选择你的执行模式</Text>
            <View className='option-list'>
              {EXECUTION_MODE_OPTIONS.map((mode) => (
                <View
                  key={mode.value}
                  className={`option-card with-desc ${executionMode === mode.value ? 'active' : ''}`}
                  onClick={() => {
                    if (mode.value === 'strict') {
                      setExecutionMode('strict')
                      setExecutionModeTouched(true)
                      return
                    }
                    setExecutionMode(mode.value)
                    setExecutionModeTouched(true)
                  }}
                >
                  <View className='option-info'>
                    <Text className='option-label'>{mode.title}</Text>
                    <Text className='option-desc'>{mode.desc}</Text>
                  </View>
                </View>
              ))}
            </View>
            <Text className='skip-hint'>
              当前推荐：{recommendExecutionMode(dietGoal || 'maintain') === 'strict' ? '精准模式' : '标准模式'}
            </Text>
            <View className='card-footer'>
              <View className='card-prev-link' onClick={goPrev}>上一题</View>
              <Button block color='primary' shape='round' className={`card-next-btn ${executionMode ? 'ready' : ''}`} onClick={goNext} disabled={!executionMode}>
                确认
              </Button>
            </View>
          </View>

          {/* Step 7: 既往病史（多选） */}
          <View className='card step-card'>
            <Text className='step-card-step'>第 8 题</Text>
            <Text className='step-card-title'>是否有以下病史？（可多选）</Text>
            <View className='option-grid'>
              {MEDICAL_OPTIONS.map((o) => (
                <View
                  key={o.value}
                  className={`option-card small ${medicalHistory.includes(o.value) ? 'active' : ''}`}
                  onClick={() => toggleMedical(o.value)}
                >
                  <Text className='option-label'>{o.label}</Text>
                </View>
              ))}
              {/* 显示用户添加的自定义病史 */}
              {customMedicalList.map((item) => (
                <View
                  key={item}
                  className={`option-card small custom-tag ${selectedCustomMedical.includes(item) ? 'active' : ''}`}
                  onClick={() => toggleCustomMedical(item)}
                  onLongPress={() => handleRemoveCustomMedical(item)}
                >
                  <Text className='option-label'>{item}</Text>
                </View>
              ))}
            </View>
            {/* 自定义病史输入 */}
            <View className='custom-input-wrap'>
              <Input
                className='custom-input'
                placeholder='其他病史，输入后点击添加'
                value={customMedical}
                onInput={(e) => setCustomMedical(e.detail.value)}
                onConfirm={handleAddCustomMedical}
              />
              <View className='custom-input-btn' onClick={handleAddCustomMedical}>
                <Text>添加</Text>
              </View>
            </View>
            <View className='card-footer'>
              <View className='card-prev-link' onClick={goPrev}>上一题</View>
              <Button block color='primary' shape='round' className='card-next-btn ready' onClick={goNext}>
                确认
              </Button>
            </View>
          </View>

          {/* Step 8: 特殊饮食（多选） */}
          <View className='card step-card'>
            <Text className='step-card-step'>第 9 题</Text>
            <Text className='step-card-title'>特殊饮食习惯？（可多选）</Text>
            <View className='option-grid'>
              {DIET_OPTIONS.map((o) => (
                <View
                  key={o.value}
                  className={`option-card small ${dietPreference.includes(o.value) ? 'active' : ''}`}
                  onClick={() => toggleDiet(o.value)}
                >
                  <Text className='option-icon'>{o.icon}</Text>
                  <Text className='option-label'>{o.label}</Text>
                </View>
              ))}
            </View>
            <View className='card-footer'>
              <View className='card-prev-link' onClick={goPrev}>上一题</View>
              <Button block color='primary' shape='round' className='card-next-btn ready' onClick={goNext}>
                确认
              </Button>
            </View>
          </View>

          {/* Step 9: 过敏源 */}
          <View className='card step-card'>
            <Text className='step-card-step'>第 10 题（选填）</Text>
            <Text className='step-card-title'>有过敏源吗？</Text>
            <View className='input-card'>
              <Textarea
                className='card-textarea'
                placeholder='如：海鲜、花生，多个用顿号分隔'
                value={allergies}
                onInput={(e) => setAllergies(e.detail.value)}
                maxlength={200}
              />
            </View>
            <Text className='skip-hint'>没有可留空</Text>
            <View className='card-footer'>
              <View className='card-prev-link' onClick={goPrev}>上一题</View>
              <Button block color='primary' shape='round' className='card-next-btn ready' onClick={goNext}>
                确认
              </Button>
            </View>
          </View>

          {/* Step 10: 特殊情况和问题补充 */}
          <View className='card step-card'>
            <Text className='step-card-step'>第 11 题（选填）</Text>
            <Text className='step-card-title'>特殊情况和补充？</Text>
            <View className='input-card'>
              {/* 这里使用 textarea 或者普通的 Input 都行。原项目设计风格用 Input 为主 */}
              <Textarea
                className='card-textarea'
                placeholder='例如：孕期、哺乳期、手术恢复期等'
                value={healthNotes}
                onInput={(e) => setHealthNotes(e.detail.value)}
                maxlength={500}
              />
            </View>
            <Text className='skip-hint'>记录身体的特殊情况，让分析更准确（没有可留空）</Text>
            <View className='card-footer'>
              <View className='card-prev-link' onClick={goPrev}>上一题</View>
              <Button block color='primary' shape='round' className='card-next-btn ready' onClick={goNext}>
                确认
              </Button>
            </View>
          </View>

          {/* Step 11: 体检报告上传 */}
          <View className='card step-card upload-step'>
            <View className='upload-hero'>
              <View className='hero-icon-wrapper'>
                <Text className='hero-icon iconfont icon-yiliaohangyedeICON-'></Text>
              </View>
              <Text className='step-card-step'>第 12 题（选填）</Text>
              <Text className='step-card-title' style={{ marginBottom: '16rpx' }}>上传体检报告</Text>
              <Text className='step-card-subtitle' style={{ textAlign: 'center', marginBottom: '0' }}>AI 深度分析关键指标，定制专属方案</Text>
            </View>

            <View
              className={`upload-area ${reportImageUrl ? 'has-image' : ''}`}
              onClick={handleReportUpload}
            >
              {reportImageUrl ? (
                <>
                  <Image src={reportImageUrl} mode='aspectFit' className='preview-image' />
                  <View className='reupload-mask'>
                    <Text className='iconfont icon-xiangji' style={{ fontSize: '48rpx', color: '#fff' }}></Text>
                    <Text className='reupload-text'>点击更换图片</Text>
                  </View>
                </>
              ) : (
                <View className='upload-placeholder'>
                  <Text className='upload-icon-font iconfont icon-paizhao-xianxing'></Text>
                  <Text className='upload-title'>点击上传报告</Text>
                  <Text className='upload-desc'>支持 JPG / PNG 格式图片</Text>
                </View>
              )}
            </View>

            <View className='benefit-list'>
              <View className='benefit-item'>
                <View className='benefit-icon-wrap'>
                  <Text className='benefit-icon iconfont icon-jiesuo'></Text>
                </View>
                <View className='benefit-content'>
                  <Text className='benefit-title'>精准提取</Text>
                  <Text className='benefit-text'>自动识别血糖、血脂等关键指标</Text>
                </View>
              </View>
              <View className='benefit-item'>
                <View className='benefit-icon-wrap'>
                  <Text className='benefit-icon iconfont icon-shentinianling'></Text>
                </View>
                <View className='benefit-content'>
                  <Text className='benefit-title'>风险评估</Text>
                  <Text className='benefit-text'>结合个人情况评估潜在健康风险</Text>
                </View>
              </View>
              <View className='benefit-item'>
                <View className='benefit-icon-wrap'>
                  <Text className='benefit-icon iconfont icon-shuben'></Text>
                </View>
                <View className='benefit-content'>
                  <Text className='benefit-title'>饮食建议</Text>
                  <Text className='benefit-text'>根据指标生成针对性饮食指导</Text>
                </View>
              </View>
            </View>

            <View className='card-footer'>
              <View className='card-prev-link' onClick={goPrev}>上一题</View>
              <Button
                block
                color='primary'
                shape='round'
                className='card-next-btn ready primary'
                onClick={handleSubmit}
                loading={saving}
              >
                {reportImageUrl ? '确认并开启分析' : '以后再说，直接完成'}
              </Button>
            </View>
          </View>
        </View>
      </View>
    </View>
  )
}

export default withAuth(HealthProfilePage)
