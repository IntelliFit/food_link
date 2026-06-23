import { View, Text, Input, Textarea, Image, Button as NativeButton } from '@tarojs/components'
import { Button } from '@taroify/core'
import '@taroify/core/button/style'
import { useState, useEffect } from 'react'
import Taro from '@tarojs/taro'
import {
  getHealthProfile,
  getUserProfile,
  updateHealthProfile,
  updateUserInfo,
  uploadReportImage,
  submitReportExtractionTask,
  imageToBase64,
  showUnifiedApiError,
  type HealthProfileUpdateRequest,
} from '../../../utils/api'
import { processChooseAvatarSelection, ensureAvatarUploadedForSave } from '../../../utils/new-user-profile-form'
import { withAuth } from '../../../utils/withAuth'
import { useAppColorScheme } from '../../../components/AppColorSchemeContext'
import { applyThemeNavigationBar } from '../../../utils/theme-navigation-bar'
import { chooseImageWithPrivacy, isPrivacyAuthorizeError, showPrivacyAuthorizeFailure } from '../../../utils/weapp-privacy'
import { defaultAvatarImage } from '../../../utils/default-user-profile'

import './index.scss'
import HeightRuler from '../../../components/HeightRuler'
import AgePicker from '../../../components/AgePicker'
import WeightRuler from '../../../components/WeightRuler'
import RoutineHourPicker, {
  COMMON_ROUTINE_PRESETS,
  DEFAULT_ROUTINE_HOURS,
  formatRoutineHours,
  parseRoutineHours,
  type RoutineHours,
} from '../../../components/RoutineHourPicker'

/** 日常活动选项，不包含专门运动 */
const ACTIVITY_OPTIONS = [
  { label: '久坐办公', desc: '大部分时间坐着，日常走动少', value: 'sedentary', icon: '🛋️' },
  { label: '日常走动', desc: '通勤、家务或走路较多', value: 'light', icon: '🚶' },
  { label: '经常站立', desc: '工作中站立、来回走动较多', value: 'moderate', icon: '🏃' },
  { label: '体力劳动', desc: '搬运、巡店、户外等体力消耗明显', value: 'active', icon: '💪' }
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

/** 过敏源选项 */
const ALLERGY_OPTIONS = [
  { label: '海鲜', value: 'seafood', icon: '🦐' },
  { label: '花生', value: 'peanut', icon: '🥜' },
  { label: '牛奶', value: 'milk', icon: '🥛' },
  { label: '鸡蛋', value: 'egg', icon: '🥚' },
  { label: '芒果', value: 'mango', icon: '🥭' },
  { label: '酒精', value: 'alcohol', icon: '🍺' },
  { label: '辣', value: 'spicy', icon: '🌶️' },
  { label: '无', value: 'none', icon: '' }
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
  { label: '减重', desc: '健康瘦身', value: 'fat_loss', icon: '🔥' },
  { label: '保持', desc: '维持当前体重', value: 'maintain', icon: '⚖️' },
  { label: '增重', desc: '增加肌肉/体重', value: 'muscle_gain', icon: '💪' }
]

const PROFILE_STEPS = [
  'profile',
  'gender',
  'age',
  'height',
  'weight',
  'goal',
  'activity',
  'routine',
  'medical',
  'diet',
  'allergy',
  'notes',
  'report',
] as const
const PROFILE_STEP_WIDTH_RPX = 750
const TOTAL_STEPS = PROFILE_STEPS.length
const DEFAULT_HEIGHT_CM = 170
const DEFAULT_WEIGHT_KG = 60
const MAX_REPORT_IMAGE_COUNT = 9
const MEDICAL_OPTION_VALUES = new Set(MEDICAL_OPTIONS.map((item) => item.value))
const ALLERGY_OPTION_VALUES = new Set(ALLERGY_OPTIONS.map((item) => item.value))

function HealthProfilePage() {
  const { scheme } = useAppColorScheme()
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
  const [routineHours, setRoutineHours] = useState<RoutineHours>(DEFAULT_ROUTINE_HOURS)
  const [medicalHistory, setMedicalHistory] = useState<string[]>([])
  const [dietPreference, setDietPreference] = useState<string[]>([])
  const [allergyList, setAllergyList] = useState<string[]>([])
  const [reportImageUrls, setReportImageUrls] = useState<string[]>([])
  const [avatarUrl, setAvatarUrl] = useState<string>('')
  const [nickname, setNickname] = useState<string>('')

  const [customMedical, setCustomMedical] = useState<string>('') // 自定义病史输入
  const [customMedicalList, setCustomMedicalList] = useState<string[]>([]) // 用户添加的自定义病史列表
  const [selectedCustomMedical, setSelectedCustomMedical] = useState<string[]>([]) // 被选中的自定义病史
  const [addingMedical, setAddingMedical] = useState(false) // 是否正在添加自定义病史
  const [editingMedical, setEditingMedical] = useState<string>('') // 正在编辑的自定义病史

  const [customAllergy, setCustomAllergy] = useState<string>('') // 自定义过敏源输入
  const [customAllergyList, setCustomAllergyList] = useState<string[]>([]) // 用户添加的自定义过敏源
  const [selectedCustomAllergy, setSelectedCustomAllergy] = useState<string[]>([]) // 被选中的自定义过敏源
  const [addingAllergy, setAddingAllergy] = useState(false) // 是否正在添加自定义过敏源
  const [editingAllergy, setEditingAllergy] = useState<string>('') // 正在编辑的自定义过敏源

  const [healthNotes, setHealthNotes] = useState<string>('') // 用户自己文字补充自己身体的特殊情况和问题

  const loadProfile = async () => {
    try {
      const [profile, userInfo] = await Promise.all([
        getHealthProfile(),
        getUserProfile().catch(() => null),
      ])
      if (userInfo) {
        setAvatarUrl(userInfo.avatar || defaultAvatarImage)
        setNickname(userInfo.nickname || '')
      } else {
        setAvatarUrl(defaultAvatarImage)
      }
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
      const hc = profile.health_condition
      if (profile.diet_goal) setDietGoal(profile.diet_goal)
      if (typeof hc?.daily_life_activity_level === 'string' && hc.daily_life_activity_level.trim()) {
        setActivityLevel(hc.daily_life_activity_level)
      } else if (profile.activity_level) {
        setActivityLevel(profile.activity_level)
      }
      if (hc?.medical_history?.length) {
        const allMedical = hc.medical_history as string[]
        const presetMedical = allMedical.filter((item) => MEDICAL_OPTION_VALUES.has(item))
        const customMedicalItems = allMedical.filter((item) => !MEDICAL_OPTION_VALUES.has(item))
        setMedicalHistory(presetMedical)
        setCustomMedicalList(customMedicalItems)
        setSelectedCustomMedical(customMedicalItems)
      }
      if (hc?.diet_preference?.length) setDietPreference(hc.diet_preference)
      if (hc?.allergies?.length) {
        const allAllergies = hc.allergies as string[]
        const presetAllergies = allAllergies.filter((item) => ALLERGY_OPTION_VALUES.has(item))
        const customAllergyItems = allAllergies.filter((item) => !ALLERGY_OPTION_VALUES.has(item))
        setAllergyList(presetAllergies)
        setCustomAllergyList(customAllergyItems)
        setSelectedCustomAllergy(customAllergyItems)
      }
      if (hc?.health_notes) setHealthNotes(hc.health_notes)
      if (hc?.routine_type) {
        setRoutineHours(parseRoutineHours(hc.routine_type))
      }
    } catch (err: any) {
      await showUnifiedApiError(err, '获取档案失败')
    } finally {
      setCurrentStep(0)
      setLoading(false)
    }
  }

  useEffect(() => {
    applyThemeNavigationBar(scheme)
  }, [scheme])

  useEffect(() => {
    loadProfile()
  }, [])

  const goNext = () => {
    if (currentStep >= TOTAL_STEPS - 1) return
    if (!canProceed()) {
      if (currentStep === 3 && height) {
        Taro.showToast({ title: '请输入 100～250 之间的身高 (cm)', icon: 'none' })
      } else if (currentStep === 4 && weight) {
        Taro.showToast({ title: '请输入 30～200 之间的体重 (kg)', icon: 'none' })
      } else if (currentStep === 0) {
        Taro.showToast({ title: '请上传头像并填写昵称', icon: 'none' })
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
    if (customMedicalList.includes(trimmed) && editingMedical !== trimmed) {
      Taro.showToast({ title: '该病史已添加', icon: 'none' })
      return
    }
    if (editingMedical) {
      setCustomMedicalList((prev) => prev.map((item) => item === editingMedical ? trimmed : item))
      setSelectedCustomMedical((prev) => prev.map((item) => item === editingMedical ? trimmed : item))
      Taro.showToast({ title: '已更新病史', icon: 'success' })
    } else {
      setCustomMedicalList((prev) => [...prev, trimmed])
      setSelectedCustomMedical((prev) => [...prev, trimmed]) // 添加时默认选中
    }
    setMedicalHistory((prev) => prev.filter((v) => v !== 'none')) // 添加自定义时移除"无"
    setCustomMedical('')
    setEditingMedical('')
    setAddingMedical(false)
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

  const handleEditCustomMedical = (item: string) => {
    setAddingMedical(true)
    setEditingMedical(item)
    setCustomMedical(item)
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
          if (editingMedical === item) {
            setEditingMedical('')
            setCustomMedical('')
            setAddingMedical(false)
          }
        }
      }
    })
  }

  // 过敏源操作
  const toggleAllergy = (value: string) => {
    if (value === 'none') {
      setAllergyList(['none'])
      setSelectedCustomAllergy([])
      return
    }
    setAllergyList((prev) => {
      const next = prev.filter((v) => v !== 'none')
      if (next.includes(value)) return next.filter((v) => v !== value)
      return [...next, value]
    })
  }

  const handleAddCustomAllergy = () => {
    const trimmed = customAllergy.trim()
    if (!trimmed) {
      Taro.showToast({ title: '请输入过敏源名称', icon: 'none' })
      return
    }
    if (customAllergyList.includes(trimmed) && editingAllergy !== trimmed) {
      Taro.showToast({ title: '该过敏源已添加', icon: 'none' })
      return
    }
    if (editingAllergy) {
      setCustomAllergyList((prev) => prev.map((item) => item === editingAllergy ? trimmed : item))
      setSelectedCustomAllergy((prev) => prev.map((item) => item === editingAllergy ? trimmed : item))
      Taro.showToast({ title: '已更新过敏源', icon: 'success' })
    } else {
      setCustomAllergyList((prev) => [...prev, trimmed])
      setSelectedCustomAllergy((prev) => [...prev, trimmed])
    }
    setAllergyList((prev) => prev.filter((v) => v !== 'none'))
    setCustomAllergy('')
    setEditingAllergy('')
    setAddingAllergy(false)
  }

  const toggleCustomAllergy = (item: string) => {
    setSelectedCustomAllergy((prev) => {
      if (prev.includes(item)) return prev.filter((v) => v !== item)
      return [...prev, item]
    })
    setAllergyList((prev) => prev.filter((v) => v !== 'none'))
  }

  const handleEditCustomAllergy = (item: string) => {
    setAddingAllergy(true)
    setEditingAllergy(item)
    setCustomAllergy(item)
  }

  const handleRemoveCustomAllergy = (item: string) => {
    Taro.showModal({
      title: '删除确认',
      content: `确定要删除「${item}」吗？`,
      success: (res) => {
        if (res.confirm) {
          setCustomAllergyList((prev) => prev.filter((v) => v !== item))
          setSelectedCustomAllergy((prev) => prev.filter((v) => v !== item))
          if (editingAllergy === item) {
            setEditingAllergy('')
            setCustomAllergy('')
            setAddingAllergy(false)
          }
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

  const handleChooseAvatar = (e: { detail?: { avatarUrl?: string } }) => {
    const url = e.detail?.avatarUrl
    if (!url) return
    processChooseAvatarSelection(url, setAvatarUrl)
  }

  const handleNicknameInput = (value: string) => {
    setNickname(value)
  }

  const handleUseWechatProfile = async () => {
    try {
      const res = await Taro.getUserProfile({ desc: '用于完善个人资料' })
      const info = res.userInfo
      if (info) {
        if (info.avatarUrl) {
          processChooseAvatarSelection(info.avatarUrl, setAvatarUrl)
        }
        if (info.nickName) {
          setNickname(info.nickName)
        }
      }
    } catch (err: any) {
      if (err?.errMsg?.includes('cancel') || err?.errMsg?.includes('deny') || err?.errMsg?.includes('fail auth')) {
        return
      }
      console.error('获取微信资料失败:', err)
      Taro.showToast({ title: '获取微信资料失败', icon: 'none' })
    }
  }

  const handleSelectActivity = (value: string) => {
    setActivityLevel(value)
  }

  const handleSelectDietGoal = (value: string) => {
    setDietGoal(value)
  }

  const effectiveHeight = height ? Number(height) : DEFAULT_HEIGHT_CM
  const effectiveWeight = weight ? Number(weight) : DEFAULT_WEIGHT_KG
  const isHeightValid = Number.isFinite(effectiveHeight) && effectiveHeight >= 100 && effectiveHeight <= 250
  const isWeightValid = Number.isFinite(effectiveWeight) && effectiveWeight >= 30 && effectiveWeight <= 200

  const canProceed = () => {
    switch (currentStep) {
      case 0:
        return !!avatarUrl && !!nickname.trim()
      case 1:
        return !!gender
      case 2:
        return !!birthday
      case 3:
        return isHeightValid
      case 4:
        return isWeightValid
      case 5:
        return !!dietGoal
      case 6:
        return !!activityLevel
      case 7:
        return Number.isFinite(routineHours.sleepHour) && Number.isFinite(routineHours.wakeHour)
      case 8:
      case 9:
      case 10:
      case 11:
        return true
      default:
        return true
    }
  }

  const handleSubmit = async () => {
    // 合并预设病史和选中的自定义病史
    const allMedicalHistory = [...medicalHistory.filter(v => v !== 'none'), ...selectedCustomMedical]
    const allAllergies = [...allergyList.filter(v => v !== 'none'), ...selectedCustomAllergy]
    const finalRoutine = formatRoutineHours(routineHours)
    const reportImageUrl = reportImageUrls.join(',')
    const req: HealthProfileUpdateRequest = {
      gender: gender || undefined,
      birthday: birthday || undefined,
      height: isHeightValid ? effectiveHeight : undefined,
      weight: isWeightValid ? effectiveWeight : undefined,
      diet_goal: dietGoal || undefined,
      activity_level: activityLevel || undefined,
      daily_life_activity_level: activityLevel || undefined,
      execution_mode: 'standard',
      medical_history: allMedicalHistory.length ? allMedicalHistory : undefined,
      diet_preference: dietPreference.length ? dietPreference : undefined,
      allergies: allAllergies.length ? allAllergies : undefined,
      health_notes: healthNotes || undefined,
      routine_type: finalRoutine || undefined,
      routine_sleep_hour: routineHours.sleepHour,
      routine_wake_hour: routineHours.wakeHour,
      report_image_url: reportImageUrls[0] || reportImageUrl || undefined
    }
    if (!req.gender || !req.birthday || !req.height || !req.weight || !req.diet_goal || !req.activity_level) {
      Taro.showToast({ title: '请完成前几项必填', icon: 'none' })
      return
    }

    const { confirm } = await Taro.showModal({
      title: '确认保存',
      content: reportImageUrls.length > 0
        ? '确定保存健康档案吗？体检报告将在后台自动识别，完成后会更新到档案中。'
        : '确定将当前填写的健康信息保存到个人档案吗？'
    })
    if (!confirm) return
    setSaving(true)
    try {
      // 先保存头像昵称到用户资料
      const finalAvatar = await ensureAvatarUploadedForSave(avatarUrl)
      await updateUserInfo({
        nickname: nickname.trim(),
        avatar: finalAvatar || undefined,
      })
      await updateHealthProfile(req)
      // 若有上传的体检报告图片，提交后台病历提取任务（用户无感知）
      if (reportImageUrls.length > 0) {
        submitReportExtractionTask({
          imageUrl: reportImageUrls[0],
          imageUrls: reportImageUrls,
        }).catch(() => {
          // 静默失败，不影响保存成功
        })
      }
      Taro.showToast({ title: '保存成功', icon: 'success' })
      setTimeout(() => {
        Taro.switchTab({ url: '/pages/profile/index' })
      }, 1500)
    } catch (e: any) {
      await showUnifiedApiError(e, '保存失败')
    } finally {
      setSaving(false)
    }
  }

  /** 上传体检报告：仅上传图片并展示，点击「保存健康档案」时提交病历提取任务 */
  const handleReportUpload = async () => {
    try {
      const res = await chooseImageWithPrivacy({ count: MAX_REPORT_IMAGE_COUNT, sizeType: ['compressed'] })
      const tempPaths = (res.tempFilePaths || []).slice(0, MAX_REPORT_IMAGE_COUNT)
      if (tempPaths.length === 0) return
      Taro.showLoading({ title: '上传中...', mask: true })
      const urls: string[] = []
      for (const path of tempPaths) {
        const base64 = await imageToBase64(path)
        const { imageUrl } = await uploadReportImage(base64)
        urls.push(imageUrl)
      }
      Taro.hideLoading()
      setReportImageUrls(urls)
      Taro.showToast({ title: `上传成功 ${urls.length} 张`, icon: 'success' })
    } catch (e: any) {
      Taro.hideLoading()
      if (e?.errMsg?.includes('cancel')) return
      if (isPrivacyAuthorizeError(e)) {
        showPrivacyAuthorizeFailure(e)
        return
      }
      await showUnifiedApiError(e, '上传失败')
    }
  }

  if (loading) {
    return (
      <View className='health-profile-page'>
        <View className='loading-container-center' style={{ flex: 1 }}>
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
            width: `${TOTAL_STEPS * PROFILE_STEP_WIDTH_RPX}rpx`,
            transform: `translateX(-${currentStep * PROFILE_STEP_WIDTH_RPX}rpx)`,
            transition: 'transform 0.3s ease-out'
          }}
        >
          {/* Step 0: 头像昵称 */}
          <View className='card step-card profile-step-card'>
            <Text className='step-card-title'>完善资料</Text>
            <Text className='step-card-subtitle'>设置头像和昵称，让朋友更容易认出你。</Text>
            <View className='profile-form-body'>
              <View className='profile-avatar-choose-wrapper'>
                {avatarUrl ? (
                  <Image src={avatarUrl} className='profile-avatar-image' mode='aspectFill' />
                ) : (
                  <Text className='profile-avatar-placeholder'>📷</Text>
                )}
                <NativeButton
                  className='profile-avatar-choose-btn'
                  openType='chooseAvatar'
                  onChooseAvatar={handleChooseAvatar}
                />
                <Text className='profile-avatar-tip'>点击修改头像</Text>
              </View>

              <View className='profile-nickname-row'>
                <Text className='profile-nickname-label'>昵称</Text>
                <Input
                  className='profile-nickname-input'
                  type='nickname'
                  placeholder='请输入昵称'
                  value={nickname}
                  onInput={(e) => handleNicknameInput(e.detail.value)}
                />
              </View>

              <Button
                className='profile-wechat-fill-btn'
                variant='outlined'
                color='primary'
                shape='round'
                block
                onClick={handleUseWechatProfile}
              >
                一键使用微信头像和昵称
              </Button>
            </View>
            <View className='card-footer card-footer-single'>
              <Button block color='primary' shape='round' className={`card-next-btn ${canProceed() ? 'ready' : ''}`} onClick={goNext} disabled={!canProceed()}>
                下一步 <Text className='iconfont icon-right' />
              </Button>
            </View>
          </View>

          {/* Step 1: 性别 */}
          <View className='card step-card'>
            <Text className='step-card-title'>基础信息</Text>
            <Text className='step-card-subtitle'>选择你的性别，让我们更了解你。</Text>
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
                下一步 <Text className='iconfont icon-right' />
              </Button>
            </View>
          </View>

          {/* Step 1: 出生日期 (Changed to Age Selection) */}
          <View className='card step-card'>
            <Text className='step-card-title'>基础信息</Text>
            <Text className='step-card-subtitle'>选择你的年龄，让我们更了解你。</Text>
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
              <View className='card-prev-btn' onClick={goPrev}><Text className='card-prev-arrow iconfont icon-left' />上一步</View>
              <Button block color='primary' shape='round' className={`card-next-btn ${birthday ? 'ready' : ''}`} onClick={goNext} disabled={!birthday}>
                下一步 <Text className='iconfont icon-right' />
              </Button>
            </View>
          </View>

          {/* Step 2: 身高 */}
          <View className='card step-card'>
            <Text className='step-card-title'>身体数据</Text>
            <Text className='step-card-subtitle'>你的身高是多少？</Text>
            {/* 使用 HeightRuler 替换原有的输入 */}
            <View style={{ width: '100%', marginBottom: '24px' }}>
              <HeightRuler
                value={effectiveHeight}
                onChange={(val) => setHeight(String(val))}
                min={100}
                max={250}
              />
            </View>
            <View className='card-footer'>
              <View className='card-prev-btn' onClick={goPrev}><Text className='card-prev-arrow iconfont icon-left' />上一步</View>
              <Button block color='primary' shape='round' className={`card-next-btn ${canProceed() ? 'ready' : ''}`} onClick={goNext} disabled={!canProceed()}>
                下一步 <Text className='iconfont icon-right' />
              </Button>
            </View>
          </View>

          {/* Step 3: 体重 */}
          <View className='card step-card'>
            <Text className='step-card-title'>身体数据</Text>
            <Text className='step-card-subtitle'>你的体重是多少？</Text>
            {/* Title is handled inside WeightRuler for better layout */}
            <WeightRuler
              value={effectiveWeight}
              onChange={(val) => setWeight(String(val))}
              min={30}
              max={200}
              height={effectiveHeight}
            />
            <View className='card-footer'>
              <View className='card-prev-btn' onClick={goPrev}><Text className='card-prev-arrow iconfont icon-left' />上一步</View>
              <Button block color='primary' shape='round' className={`card-next-btn ${canProceed() ? 'ready' : ''}`} onClick={goNext} disabled={!canProceed()}>
                下一步 <Text className='iconfont icon-right' />
              </Button>
            </View>
          </View>

          {/* Step 4: 目标选择 */}
          <View className='card step-card'>
            <Text className='step-card-title'>健康目标</Text>
            <Text className='step-card-subtitle'>你希望达到什么样的身体状态？</Text>
            <View className='option-list'>
              {GOAL_OPTIONS.map((opt) => (
                <View
                  key={opt.value}
                  className={`option-card with-desc ${dietGoal === opt.value ? 'active' : ''}`}
                  onClick={() => handleSelectDietGoal(opt.value)}
                >
                  <Text className='option-icon'>{opt.icon}</Text>
                  <View className='option-info'>
                    <Text className='option-label'>{opt.label}</Text>
                    <Text className='option-desc'>{opt.desc}</Text>
                  </View>
                </View>
              ))}
            </View>
            <View className='card-footer'>
              <View className='card-prev-btn' onClick={goPrev}><Text className='card-prev-arrow iconfont icon-left' />上一步</View>
              <Button block color='primary' shape='round' className={`card-next-btn ${dietGoal ? 'ready' : ''}`} onClick={goNext} disabled={!dietGoal}>
                下一步 <Text className='iconfont icon-right' />
              </Button>
            </View>
          </View>

          {/* Step 5: 日常活动 */}
          <View className='card step-card'>
            <Text className='step-card-title'>日常活动</Text>
            <Text className='step-card-subtitle'>不算专门健身，你平时的一天更接近哪种状态？</Text>
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
              <View className='card-prev-btn' onClick={goPrev}><Text className='card-prev-arrow iconfont icon-left' />上一步</View>
              <Button block color='primary' shape='round' className={`card-next-btn ${activityLevel ? 'ready' : ''}`} onClick={goNext} disabled={!activityLevel}>
                下一步 <Text className='iconfont icon-right' />
              </Button>
            </View>
          </View>

          {/* Step 6: 作息习惯 */}
          <View className='card step-card'>
            <Text className='step-card-title'>作息习惯</Text>
            <Text className='step-card-subtitle'>了解你的作息，让算法更加懂你</Text>
            <RoutineHourPicker
              value={routineHours}
              onChange={setRoutineHours}
              presets={COMMON_ROUTINE_PRESETS}
            />
            <View className='card-footer'>
              <View className='card-prev-btn' onClick={goPrev}><Text className='card-prev-arrow iconfont icon-left' />上一步</View>
              <Button block color='primary' shape='round' className={`card-next-btn ${canProceed() ? 'ready' : ''}`} onClick={goNext} disabled={!canProceed()}>
                下一步 <Text className='iconfont icon-right' />
              </Button>
            </View>
          </View>

          {/* Step 7: 既往病史（多选） */}
          <View className='card step-card'>
            <Text className='step-card-title'>既往病史</Text>
            <Text className='step-card-subtitle'>是否有以下病史？（可多选）</Text>
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
                >
                  <Text className='option-label option-label--custom'>{item}</Text>
                  <View className='custom-tag-actions'>
                    <Text
                      className='custom-tag-action'
                      onClick={(e) => {
                        e.stopPropagation()
                        handleEditCustomMedical(item)
                      }}
                    >
                      编辑
                    </Text>
                    <Text
                      className='custom-tag-action custom-tag-action--danger'
                      onClick={(e) => {
                        e.stopPropagation()
                        handleRemoveCustomMedical(item)
                      }}
                    >
                      删除
                    </Text>
                  </View>
                </View>
              ))}
            </View>
            {/* 自定义病史添加 */}
            {addingMedical ? (
              <View className='custom-input-wrap'>
                <Input
                  className='custom-input'
                  placeholder='输入病史名称'
                  value={customMedical}
                  onInput={(e) => setCustomMedical(e.detail.value)}
                  onConfirm={handleAddCustomMedical}
                  focus
                />
                <View className='custom-input-btn' onClick={handleAddCustomMedical}>
                  <Text>{editingMedical ? '保存' : '确认'}</Text>
                </View>
                <View className='custom-input-cancel' onClick={() => { setAddingMedical(false); setCustomMedical(''); setEditingMedical('') }}>
                  <Text className='cancel-icon-text'>×</Text>
                </View>
              </View>
            ) : (
              <View className='add-btn-round' onClick={() => setAddingMedical(true)}>
                <Text className='add-btn-icon'>+</Text>
                <Text className='add-btn-label'>添加其他</Text>
              </View>
            )}
            <View className='card-footer'>
              <View className='card-prev-btn' onClick={goPrev}><Text className='card-prev-arrow iconfont icon-left' />上一步</View>
              <Button block color='primary' shape='round' className='card-next-btn ready' onClick={goNext}>
                下一步 <Text className='iconfont icon-right' />
              </Button>
            </View>
          </View>

          {/* Step 8: 特殊饮食（多选） */}
          <View className='card step-card'>
            <Text className='step-card-title'>饮食习惯</Text>
            <Text className='step-card-subtitle'>你有特殊的饮食习惯吗？（可多选）</Text>
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
              <View className='card-prev-btn' onClick={goPrev}><Text className='card-prev-arrow iconfont icon-left' />上一步</View>
              <Button block color='primary' shape='round' className='card-next-btn ready' onClick={goNext}>
                下一步 <Text className='iconfont icon-right' />
              </Button>
            </View>
          </View>

          {/* Step 9: 过敏源 */}
          <View className='card step-card'>
            <Text className='step-card-title'>过敏源</Text>
            <Text className='step-card-subtitle'>有过敏源吗？（可多选）</Text>
            <View className='option-grid'>
              {ALLERGY_OPTIONS.map((o) => (
                <View
                  key={o.value}
                  className={`option-card small ${allergyList.includes(o.value) ? 'active' : ''}`}
                  onClick={() => toggleAllergy(o.value)}
                >
                  <Text className='option-icon'>{o.icon}</Text>
                  <Text className='option-label'>{o.label}</Text>
                </View>
              ))}
              {/* 显示用户添加的自定义过敏源 */}
              {customAllergyList.map((item) => (
                <View
                  key={item}
                  className={`option-card small custom-tag ${selectedCustomAllergy.includes(item) ? 'active' : ''}`}
                  onClick={() => toggleCustomAllergy(item)}
                >
                  <Text className='option-label option-label--custom'>{item}</Text>
                  <View className='custom-tag-actions'>
                    <Text
                      className='custom-tag-action'
                      onClick={(e) => {
                        e.stopPropagation()
                        handleEditCustomAllergy(item)
                      }}
                    >
                      编辑
                    </Text>
                    <Text
                      className='custom-tag-action custom-tag-action--danger'
                      onClick={(e) => {
                        e.stopPropagation()
                        handleRemoveCustomAllergy(item)
                      }}
                    >
                      删除
                    </Text>
                  </View>
                </View>
              ))}
            </View>
            {/* 自定义过敏源添加 */}
            {addingAllergy ? (
              <View className='custom-input-wrap'>
                <Input
                  className='custom-input'
                  placeholder='输入过敏源名称'
                  value={customAllergy}
                  onInput={(e) => setCustomAllergy(e.detail.value)}
                  onConfirm={handleAddCustomAllergy}
                  focus
                />
                <View className='custom-input-btn' onClick={handleAddCustomAllergy}>
                  <Text>{editingAllergy ? '保存' : '确认'}</Text>
                </View>
                <View className='custom-input-cancel' onClick={() => { setAddingAllergy(false); setCustomAllergy(''); setEditingAllergy('') }}>
                  <Text className='cancel-icon-text'>×</Text>
                </View>
              </View>
            ) : (
              <View className='add-btn-round' onClick={() => setAddingAllergy(true)}>
                <Text className='add-btn-icon'>+</Text>
                <Text className='add-btn-label'>添加其他</Text>
              </View>
            )}
            <View className='card-footer'>
              <View className='card-prev-btn' onClick={goPrev}><Text className='card-prev-arrow iconfont icon-left' />上一步</View>
              <Button block color='primary' shape='round' className='card-next-btn ready' onClick={goNext}>
                下一步 <Text className='iconfont icon-right' />
              </Button>
            </View>
          </View>

          {/* Step 10: 特殊情况和问题补充 */}
          <View className='card step-card'>
            <Text className='step-card-title'>补充信息</Text>
            <Text className='step-card-subtitle'>有其他特殊情况需要补充吗？（选填）</Text>
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
              <View className='card-prev-btn' onClick={goPrev}><Text className='card-prev-arrow iconfont icon-left' />上一步</View>
              <Button block color='primary' shape='round' className='card-next-btn ready' onClick={goNext}>
                下一步 <Text className='iconfont icon-right' />
              </Button>
            </View>
          </View>

          {/* Step 11: 体检报告上传 */}
          <View className='card step-card upload-step'>
            <View className='upload-hero'>
              <View className='hero-icon-wrapper'>
                <Text className='hero-icon iconfont icon-yiliaohangyedeICON-'></Text>
              </View>
              <Text className='step-card-title' style={{ marginBottom: '16rpx' }}>体检报告</Text>
              <Text className='step-card-subtitle' style={{ textAlign: 'center', marginBottom: '0' }}>上传体检报告，AI 深度分析关键指标，定制专属方案</Text>
            </View>

            <View
              className={`upload-area ${reportImageUrls.length > 0 ? 'has-image' : ''}`}
              onClick={handleReportUpload}
            >
              {reportImageUrls.length > 0 ? (
                <>
                  <View className={`report-preview-grid count-${reportImageUrls.length}`}>
                    {reportImageUrls.map((url, index) => (
                      <View className='report-preview-item' key={`${url}-${index}`}>
                        <Image src={url} mode='aspectFit' className='preview-image' />
                        <Text className='report-preview-index'>{index + 1}</Text>
                      </View>
                    ))}
                  </View>
                  <View className='reupload-mask'>
                    <Text className='iconfont icon-xiangji' style={{ fontSize: '48rpx', color: '#fff' }}></Text>
                    <Text className='reupload-text'>重新选择报告</Text>
                  </View>
                </>
              ) : (
                <View className='upload-placeholder'>
                  <Text className='upload-icon-font iconfont icon-paizhao-xianxing'></Text>
                  <Text className='upload-title'>点击上传报告</Text>
                  <Text className='upload-desc'>支持 JPG / PNG 格式，最多 {MAX_REPORT_IMAGE_COUNT} 张</Text>
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
              <View className='card-prev-btn' onClick={goPrev}><Text className='card-prev-arrow iconfont icon-left' />上一步</View>
              <Button
                block
                color='primary'
                shape='round'
                className='card-next-btn ready primary'
                onClick={handleSubmit}
                loading={saving}
              >
                {reportImageUrls.length > 0 ? '确认并开启分析' : '以后再说，直接完成'}
              </Button>
            </View>
          </View>
        </View>
      </View>
    </View>
  )
}

export default withAuth(HealthProfilePage)
