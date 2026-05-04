import { View, Text, ScrollView, Input, Textarea, PickerView, PickerViewColumn } from '@tarojs/components'
import { useState } from 'react'
import Taro, { useDidShow } from '@tarojs/taro'
// Popup removed — using custom bottom sheet instead
import {
  getHealthProfile,
  updateHealthProfile,
  getMyMembership,
  showUnifiedApiError,
  type HealthProfile,
  type ExecutionMode,
  type MembershipStatus,
} from '../../../utils/api'
import {
  canUseStrictModeForMembership,
  getStrictModeUpgradeDialog,
} from '../../../utils/execution-mode'
import { withAuth } from '../../../utils/withAuth'
import { extraPkgUrl } from '../../../utils/subpackage-extra'

import './index.scss'

/* ========== 显示映射 ========== */
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
const EXECUTION_MODE_MAP: Record<string, string> = {
  strict: '精准模式',
  standard: '标准模式'
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
const ALLERGY_MAP: Record<string, string> = {
  seafood: '海鲜',
  peanut: '花生',
  milk: '牛奶',
  egg: '鸡蛋',
  mango: '芒果',
  alcohol: '酒精',
  spicy: '辣',
  none: '无'
}

/* ========== 编辑选项常量 ========== */
const GOAL_OPTIONS = [
  { label: '减重', value: 'fat_loss' },
  { label: '保持', value: 'maintain' },
  { label: '增重', value: 'muscle_gain' }
]
const ACTIVITY_OPTIONS = [
  { label: '久坐（几乎不运动）', value: 'sedentary' },
  { label: '轻度（每周 1-3 天）', value: 'light' },
  { label: '中度（每周 3-5 天）', value: 'moderate' },
  { label: '高度（每周 6-7 天）', value: 'active' },
  { label: '极高（体力劳动/每天训练）', value: 'very_active' }
]
const EXECUTION_MODE_OPTIONS: Array<{ label: string; value: ExecutionMode }> = [
  { label: '精准模式', value: 'strict' },
  { label: '标准模式', value: 'standard' }
]
const MEDICAL_OPTIONS = [
  { label: '糖尿病', value: 'diabetes' },
  { label: '高血压', value: 'hypertension' },
  { label: '痛风', value: 'gout' },
  { label: '高血脂', value: 'hyperlipidemia' },
  { label: '甲状腺疾病', value: 'thyroid' },
  { label: '无', value: 'none' }
]
const DIET_OPTIONS = [
  { label: '生酮', value: 'keto' },
  { label: '素食', value: 'vegetarian' },
  { label: '纯素', value: 'vegan' },
  { label: '低盐', value: 'low_salt' },
  { label: '无麸质', value: 'gluten_free' },
  { label: '无', value: 'none' }
]
const ALLERGY_OPTIONS = [
  { label: '海鲜', value: 'seafood' },
  { label: '花生', value: 'peanut' },
  { label: '牛奶', value: 'milk' },
  { label: '鸡蛋', value: 'egg' },
  { label: '芒果', value: 'mango' },
  { label: '酒精', value: 'alcohol' },
  { label: '辣', value: 'spicy' },
  { label: '无', value: 'none' }
]

/* ========== 字段配置 ========== */
interface FieldConfig {
  title: string
  type: 'radio' | 'multi' | 'number' | 'text' | 'date'
  options?: Array<{ label: string; value: string }>
  unit?: string
  min?: number
  max?: number
  placeholder?: string
}

const FIELD_CONFIG: Record<string, FieldConfig> = {
  gender: { title: '性别', type: 'radio', options: [{ label: '男', value: 'male' }, { label: '女', value: 'female' }] },
  birthday: { title: '出生日期', type: 'date' },
  height: { title: '身高', type: 'number', unit: 'cm', min: 100, max: 250, placeholder: '100-250' },
  weight: { title: '体重', type: 'number', unit: 'kg', min: 30, max: 200, placeholder: '30-200' },
  diet_goal: { title: '饮食目标', type: 'radio', options: GOAL_OPTIONS },
  activity_level: { title: '活动水平', type: 'radio', options: ACTIVITY_OPTIONS },
  execution_mode: { title: '执行模式', type: 'radio', options: EXECUTION_MODE_OPTIONS.map(o => ({ label: o.label, value: o.value })) },
  medical_history: { title: '既往病史', type: 'multi', options: MEDICAL_OPTIONS },
  diet_preference: { title: '饮食偏好', type: 'multi', options: DIET_OPTIONS },
  allergies: { title: '过敏源', type: 'multi', options: ALLERGY_OPTIONS },
  health_notes: { title: '特殊情况和补充', type: 'text', placeholder: '例如：孕期、哺乳期、手术恢复期等' },
}

function HealthProfileViewPage() {
  const [loading, setLoading] = useState(true)
  const [profile, setProfile] = useState<HealthProfile | null>(null)
  const [error, setError] = useState<string | null>(null)

  /* 编辑状态 */
  const [showEditor, setShowEditor] = useState(false)
  const [editingField, setEditingField] = useState<string | null>(null)
  const [editValue, setEditValue] = useState<any>(null)
  const [saving, setSaving] = useState(false)
  const [membershipStatus, setMembershipStatus] = useState<MembershipStatus | null>(null)

  /* 日期选择器索引 */
  const [datePickVal, setDatePickVal] = useState<number[]>([0, 0, 0])

  /* 自定义病史编辑状态 */
  const [customMedical, setCustomMedical] = useState<string>('')
  const [customMedicalList, setCustomMedicalList] = useState<string[]>([])
  const [selectedCustomMedical, setSelectedCustomMedical] = useState<string[]>([])
  const [addingMedical, setAddingMedical] = useState(false)

  /* 过敏源编辑状态 */
  const [customAllergyList, setCustomAllergyList] = useState<string[]>([])
  const [selectedCustomAllergy, setSelectedCustomAllergy] = useState<string[]>([])
  const [customAllergyInput, setCustomAllergyInput] = useState<string>('')
  const [addingAllergy, setAddingAllergy] = useState(false)

  const strictModeAvailable = canUseStrictModeForMembership(membershipStatus)

  useDidShow(() => {
    getHealthProfile()
      .then(setProfile)
      .catch(async (e: Error) => {
        setError('获取失败，请稍后重试')
        await showUnifiedApiError(e, '获取失败')
      })
      .finally(() => setLoading(false))

    getMyMembership().then(ms => setMembershipStatus(ms)).catch(() => {})
  })

  const handleEdit = () => {
    Taro.navigateTo({ url: extraPkgUrl('/pages/health-profile-edit/index') })
  }

  const handleRefill = () => {
    Taro.showModal({
      title: '重新填写',
      content: '将前往答题页面重新填写健康档案。确定继续吗？',
      success: (res) => {
        if (res.confirm) {
          Taro.navigateTo({ url: extraPkgUrl('/pages/health-profile/index') })
        }
      }
    })
  }

  const formatList = (list: string[], map: Record<string, string>) => {
    const validItems = list.filter(x => x !== 'none')
    if (validItems.length === 0) return '无'
    return validItems.map(item => map[item] || item).join('、')
  }

  /* ========== 自定义病史辅助函数（仿照引导页） ========== */
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
    setEditValue((prev: string[]) => (prev || []).filter((v: string) => v !== 'none'))
    setCustomMedical('')
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

  /* ========== 过敏源辅助函数（仿照引导页） ========== */
  const handleAddCustomAllergy = () => {
    const trimmed = customAllergyInput.trim()
    if (!trimmed) {
      Taro.showToast({ title: '请输入过敏源名称', icon: 'none' })
      return
    }
    if (customAllergyList.includes(trimmed)) {
      Taro.showToast({ title: '该过敏源已添加', icon: 'none' })
      return
    }
    setCustomAllergyList((prev) => [...prev, trimmed])
    setSelectedCustomAllergy((prev) => [...prev, trimmed])
    setEditValue((prev: string[]) => (prev || []).filter((v: string) => v !== 'none'))
    setCustomAllergyInput('')
  }

  const handleRemoveCustomAllergy = (item: string) => {
    Taro.showModal({
      title: '删除确认',
      content: `确定要删除「${item}」吗？`,
      success: (res) => {
        if (res.confirm) {
          setCustomAllergyList((prev) => prev.filter((v) => v !== item))
          setSelectedCustomAllergy((prev) => prev.filter((v) => v !== item))
        }
      }
    })
  }

  /* ========== 编辑器 ========== */
  const openEditor = (field: string) => {
    const config = FIELD_CONFIG[field]
    if (!config) return
    setEditingField(field)

    let currentValue: any
    switch (field) {
      case 'gender': currentValue = profile?.gender || ''; break
      case 'birthday': {
        currentValue = profile?.birthday || ''
        const parseDate = (val: string) => {
          const parts = val.split('-')
          return {
            year: parseInt(parts[0] || '2000', 10),
            month: parseInt(parts[1] || '1', 10),
            day: parseInt(parts[2] || '1', 10)
          }
        }
        const currentYear = new Date().getFullYear()
        const years = Array.from({ length: currentYear - 1900 + 1 }, (_, i) => 1900 + i)
        const months = Array.from({ length: 12 }, (_, i) => i + 1)
        const days = Array.from({ length: 31 }, (_, i) => i + 1)
        const { year, month, day } = parseDate(currentValue)
        setDatePickVal([
          Math.max(0, years.indexOf(year)),
          Math.max(0, months.indexOf(month)),
          Math.max(0, days.indexOf(day))
        ])
        break
      }
      case 'height': currentValue = profile?.height != null ? String(profile.height) : ''; break
      case 'weight': currentValue = profile?.weight != null ? String(profile.weight) : ''; break
      case 'diet_goal': currentValue = profile?.diet_goal || ''; break
      case 'activity_level': currentValue = profile?.activity_level || ''; break
      case 'execution_mode': currentValue = profile?.execution_mode || 'standard'; break
      case 'medical_history': {
        const list = (profile?.health_condition?.medical_history as string[]) || []
        const predefinedValues = MEDICAL_OPTIONS.map(opt => opt.value)
        const presetMedical: string[] = []
        const customItems: string[] = []
        list.forEach((item: string) => {
          if (predefinedValues.includes(item)) {
            presetMedical.push(item)
          } else {
            customItems.push(item)
          }
        })
        currentValue = presetMedical.length ? presetMedical : ['none']
        setCustomMedicalList(customItems)
        setSelectedCustomMedical(customItems)
        setAddingMedical(false)
        setCustomMedical('')
        break
      }
      case 'diet_preference': {
        const list = (profile?.health_condition?.diet_preference as string[]) || []
        currentValue = list.length ? list : []
        break
      }
      case 'allergies': {
        const list = (profile?.health_condition?.allergies as string[]) || []
        const predefinedValues = ALLERGY_OPTIONS.map(opt => opt.value)
        const presetAllergy: string[] = []
        const customItems: string[] = []
        list.forEach((item: string) => {
          if (predefinedValues.includes(item)) {
            presetAllergy.push(item)
          } else {
            customItems.push(item)
          }
        })
        currentValue = presetAllergy.length ? presetAllergy : ['none']
        setCustomAllergyList(customItems)
        setSelectedCustomAllergy(customItems)
        setAddingAllergy(false)
        setCustomAllergyInput('')
        break
      }
      case 'health_notes': currentValue = profile?.health_condition?.health_notes || ''; break
      default: currentValue = ''
    }
    setEditValue(currentValue)
    setShowEditor(true)
  }

  const closeEditor = () => {
    setShowEditor(false)
    setEditingField(null)
    setEditValue(null)
    setDatePickVal([0, 0, 0])
    setCustomMedical('')
    setCustomMedicalList([])
    setSelectedCustomMedical([])
    setAddingMedical(false)
    setCustomAllergyInput('')
    setCustomAllergyList([])
    setSelectedCustomAllergy([])
    setAddingAllergy(false)
  }

  const handleSaveEdit = async () => {
    if (!editingField || !profile) return
    const field = editingField
    const value = editValue

    const req: any = {
      gender: profile.gender || undefined,
      birthday: profile.birthday || undefined,
      height: profile.height != null ? Number(profile.height) : undefined,
      weight: profile.weight != null ? Number(profile.weight) : undefined,
      diet_goal: profile.diet_goal || undefined,
      activity_level: profile.activity_level || undefined,
      execution_mode: profile.execution_mode || 'standard',
      medical_history: (profile.health_condition?.medical_history as string[]) || [],
      diet_preference: (profile.health_condition?.diet_preference as string[]) || [],
      allergies: ((profile.health_condition?.allergies as string[]) || []).length > 0
        ? (profile.health_condition?.allergies as string[])
        : [],
      health_notes: profile.health_condition?.health_notes || undefined,
    }

    switch (field) {
      case 'gender': req.gender = value || undefined; break
      case 'birthday': req.birthday = value || undefined; break
      case 'height': {
        const h = Number(value)
        if (isNaN(h) || h < 100 || h > 250) {
          Taro.showToast({ title: '请输入 100-250 之间的身高', icon: 'none' })
          return
        }
        req.height = h
        break
      }
      case 'weight': {
        const w = Number(value)
        if (isNaN(w) || w < 30 || w > 200) {
          Taro.showToast({ title: '请输入 30-200 之间的体重', icon: 'none' })
          return
        }
        req.weight = w
        break
      }
      case 'diet_goal': req.diet_goal = value || undefined; break
      case 'activity_level': req.activity_level = value || undefined; break
      case 'execution_mode': req.execution_mode = value; break
      case 'medical_history': {
        const preset = (value as string[]).filter((v: string) => v !== 'none')
        const custom = selectedCustomMedical || []
        req.medical_history = [...preset, ...custom]
        break
      }
      case 'diet_preference': req.diet_preference = (value as string[]).filter((v: string) => v !== 'none'); break
      case 'allergies': {
        const preset = (value as string[]).filter((v: string) => v !== 'none')
        const custom = selectedCustomAllergy || []
        req.allergies = [...preset, ...custom]
        break
      }
      case 'health_notes': req.health_notes = value || undefined; break
    }

    setSaving(true)
    try {
      await updateHealthProfile(req)
      setProfile(prev => {
        if (!prev) return prev
        const next = { ...prev }
        switch (field) {
          case 'gender': next.gender = req.gender; break
          case 'birthday': next.birthday = req.birthday; break
          case 'height': next.height = req.height; break
          case 'weight': next.weight = req.weight; break
          case 'diet_goal': next.diet_goal = req.diet_goal; break
          case 'activity_level': next.activity_level = req.activity_level; break
          case 'execution_mode': next.execution_mode = req.execution_mode; break
          case 'medical_history':
          case 'diet_preference':
          case 'allergies':
          case 'health_notes':
            next.health_condition = { ...(next.health_condition || {}), ...req }
            break
        }
        return next
      })
      Taro.showToast({ title: '保存成功', icon: 'success' })
      closeEditor()
    } catch (e: any) {
      await showUnifiedApiError(e, '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const config = editingField ? FIELD_CONFIG[editingField] : null

  /* ========== 渲染编辑器内容 ========== */
  const renderEditorBody = () => {
    if (!config || !editingField) return null

    switch (config.type) {
      case 'radio':
        return (
          <View className='editor-radio-list'>
            {config.options?.map((opt) => {
              const isActive = editValue === opt.value
              return (
                <View
                  key={opt.value}
                  className={`editor-radio-item ${isActive ? 'active' : ''}`}
                  onClick={() => {
                    if (editingField === 'execution_mode' && opt.value === 'strict') {
                      if (!strictModeAvailable) {
                        const dialog = getStrictModeUpgradeDialog(membershipStatus, 'profile_execution_mode')
                        Taro.showModal({
                          title: '解锁精准模式',
                          content: `${dialog.content}\n若取消则保持当前模式。`,
                          confirmText: dialog.confirmText,
                          cancelText: '取消',
                          success: (res) => {
                            if (res.confirm) {
                              Taro.navigateTo({ url: dialog.url })
                            }
                          }
                        })
                        return
                      }
                    }
                    setEditValue(opt.value)
                  }}
                >
                  <Text className='editor-radio-label'>{opt.label}</Text>
                  {isActive && <Text className='iconfont icon-duihao editor-radio-check' />}
                </View>
              )
            })}
          </View>
        )

      case 'multi': {
        const isMedical = editingField === 'medical_history'
        const isAllergy = editingField === 'allergies'
        return (
          <View>
            <View className='editor-option-grid'>
              {config.options?.map((opt) => {
                const list = (editValue as string[]) || []
                const isActive = list.includes(opt.value)
                return (
                  <View
                    key={opt.value}
                    className={`editor-option-card small ${isActive ? 'active' : ''}`}
                    onClick={() => {
                      if (opt.value === 'none') {
                        setEditValue(['none'])
                        if (isMedical) setSelectedCustomMedical([])
                        if (isAllergy) setSelectedCustomAllergy([])
                        return
                      }
                      const next = (editValue as string[]).filter((v: string) => v !== 'none')
                      if (next.includes(opt.value)) {
                        setEditValue(next.filter((v: string) => v !== opt.value))
                      } else {
                        setEditValue([...next, opt.value])
                      }
                    }}
                  >
                    <Text className='editor-option-label'>{opt.label}</Text>
                  </View>
                )
              })}
              {/* 自定义病史（仅 medical_history） */}
              {isMedical && customMedicalList.map((item) => (
                <View
                  key={item}
                  className={`editor-option-card small custom-tag ${selectedCustomMedical.includes(item) ? 'active' : ''}`}
                  onClick={() => {
                    setSelectedCustomMedical((prev) => {
                      const arr = prev || []
                      if (arr.includes(item)) return arr.filter((v) => v !== item)
                      return [...arr, item]
                    })
                    setEditValue((prev: string[]) => (prev || []).filter((v: string) => v !== 'none'))
                  }}
                  onLongPress={() => handleRemoveCustomMedical(item)}
                >
                  <Text className='editor-option-label'>{item}</Text>
                </View>
              ))}
              {/* 自定义过敏源（仅 allergies） */}
              {isAllergy && customAllergyList.map((item) => (
                <View
                  key={item}
                  className={`editor-option-card small custom-tag ${selectedCustomAllergy.includes(item) ? 'active' : ''}`}
                  onClick={() => {
                    setSelectedCustomAllergy((prev) => {
                      const arr = prev || []
                      if (arr.includes(item)) return arr.filter((v) => v !== item)
                      return [...arr, item]
                    })
                    setEditValue((prev: string[]) => (prev || []).filter((v: string) => v !== 'none'))
                  }}
                  onLongPress={() => handleRemoveCustomAllergy(item)}
                >
                  <Text className='editor-option-label'>{item}</Text>
                </View>
              ))}
            </View>
            {/* 自定义输入区 */}
            {isMedical && (
              addingMedical ? (
                <View className='editor-custom-input-wrap'>
                  <Input
                    className='editor-custom-input'
                    placeholder='输入病史名称'
                    value={customMedical}
                    onInput={(e) => setCustomMedical(e.detail.value)}
                    onConfirm={handleAddCustomMedical}
                    focus
                  />
                  <View className='editor-custom-input-btn' onClick={handleAddCustomMedical}>
                    <Text>确认</Text>
                  </View>
                  <View
                    className='editor-custom-input-cancel'
                    onClick={() => { setAddingMedical(false); setCustomMedical('') }}
                  >
                    <Text className='cancel-icon-text'>×</Text>
                  </View>
                </View>
              ) : (
                <View className='editor-add-btn-round' onClick={() => setAddingMedical(true)}>
                  <Text className='editor-add-btn-icon'>+</Text>
                  <Text className='editor-add-btn-label'>添加其他</Text>
                </View>
              )
            )}
            {isAllergy && (
              addingAllergy ? (
                <View className='editor-custom-input-wrap'>
                  <Input
                    className='editor-custom-input'
                    placeholder='输入过敏源名称'
                    value={customAllergyInput}
                    onInput={(e) => setCustomAllergyInput(e.detail.value)}
                    onConfirm={handleAddCustomAllergy}
                    focus
                  />
                  <View className='editor-custom-input-btn' onClick={handleAddCustomAllergy}>
                    <Text>确认</Text>
                  </View>
                  <View
                    className='editor-custom-input-cancel'
                    onClick={() => { setAddingAllergy(false); setCustomAllergyInput('') }}
                  >
                    <Text className='cancel-icon-text'>×</Text>
                  </View>
                </View>
              ) : (
                <View className='editor-add-btn-round' onClick={() => setAddingAllergy(true)}>
                  <Text className='editor-add-btn-icon'>+</Text>
                  <Text className='editor-add-btn-label'>添加其他</Text>
                </View>
              )
            )}
          </View>
        )
      }

      case 'number':
        return (
          <View className='editor-input-wrap'>
            <Input
              className='editor-number-input'
              type={editingField === 'weight' ? 'digit' : 'number'}
              placeholder={config.placeholder}
              value={editValue}
              onInput={(e) => setEditValue(e.detail.value)}
              focus
            />
            {config.unit && <Text className='editor-input-unit'>{config.unit}</Text>}
          </View>
        )

      case 'text':
        return (
          <Textarea
            className='editor-textarea'
            placeholder={config.placeholder}
            value={editValue}
            onInput={(e) => setEditValue(e.detail.value)}
            maxlength={editingField === 'health_notes' ? 500 : 200}
            focus
          />
        )

      case 'date': {
        const currentYear = new Date().getFullYear()
        const years = Array.from({ length: currentYear - 1900 + 1 }, (_, i) => 1900 + i)
        const months = Array.from({ length: 12 }, (_, i) => i + 1)
        const days = Array.from({ length: 31 }, (_, i) => i + 1)

        const handleDateChange = (e: any) => {
          const [yi, mi, di] = e.detail.value
          const y = years[yi]
          const m = months[mi]
          const d = days[di]
          setEditValue(`${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`)
          setDatePickVal([yi, mi, di])
        }

        return (
          <View className='editor-date-picker'>
            <View className='editor-date-labels'>
              <Text className='editor-date-label'>年</Text>
              <Text className='editor-date-label'>月</Text>
              <Text className='editor-date-label'>日</Text>
            </View>
            <PickerView
              className='editor-picker-view'
              indicatorStyle='height: 80rpx;'
              value={datePickVal}
              onChange={handleDateChange}
            >
              <PickerViewColumn>
                {years.map(y => (
                  <View key={y} className='editor-picker-item'>
                    <Text className='editor-picker-text'>{y}</Text>
                  </View>
                ))}
              </PickerViewColumn>
              <PickerViewColumn>
                {months.map(m => (
                  <View key={m} className='editor-picker-item'>
                    <Text className='editor-picker-text'>{m}</Text>
                  </View>
                ))}
              </PickerViewColumn>
              <PickerViewColumn>
                {days.map(d => (
                  <View key={d} className='editor-picker-item'>
                    <Text className='editor-picker-text'>{d}</Text>
                  </View>
                ))}
              </PickerViewColumn>
            </PickerView>
          </View>
        )
      }

      default:
        return null
    }
  }

  /* ========== 可编辑行组件 ========== */
  const EditableRow = ({
    label,
    value,
    field,
    column = false,
    highlight = false,
  }: {
    label: string
    value: React.ReactNode
    field: string
    column?: boolean
    highlight?: boolean
  }) => (
    <View className={`row editable ${column ? 'column' : ''}`} onClick={() => openEditor(field)}>
      <Text className='label'>{label}</Text>
      <View className='value-wrap'>
        <Text className={`value ${highlight ? 'highlight' : ''}`}>{value}</Text>
        <Text className='iconfont icon-right row-arrow' />
      </View>
    </View>
  )

  /* ========== 只读行组件 ========== */
  const ReadOnlyRow = ({
    label,
    value,
    column = false,
  }: {
    label: string
    value: React.ReactNode
    column?: boolean
  }) => (
    <View className={`row ${column ? 'column' : ''}`}>
      <Text className='label'>{label}</Text>
      <Text className='value'>{value}</Text>
    </View>
  )

  if (loading) {
    return (
      <View className='health-profile-view-page'>
        <View className='loading-wrap'>
          <View className='loading-spinner-md' />
        </View>
      </View>
    )
  }

  if (error || !profile) {
    return (
      <View className='health-profile-view-page'>
        <View className='error-wrap'>
          <Text className='error-text'>{error || '暂无健康档案'}</Text>
          <View className='btn-primary' onClick={() => Taro.navigateTo({ url: extraPkgUrl('/pages/health-profile/index') })}>
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
  const healthNotes = hc?.health_notes as string | undefined
  const reportExtract = hc?.report_extract

  const hasIndicators = reportExtract?.indicators && reportExtract.indicators.length > 0
  const hasConclusions = reportExtract?.conclusions && reportExtract.conclusions.length > 0
  const hasSuggestions = reportExtract?.suggestions && reportExtract.suggestions.length > 0
  const hasMedicalNotes = !!reportExtract?.medical_notes
  const hasReportData = hasIndicators || hasConclusions || hasSuggestions || hasMedicalNotes

  return (
    <View className='health-profile-view-page'>
      <ScrollView className='scroll-wrap' scrollY enhanced showScrollbar={false}>
        {/* 基础信息 */}
        <View className='block'>
          <Text className='block-title'>基础信息</Text>
          <EditableRow
            label='性别'
            field='gender'
            value={profile.gender ? GENDER_MAP[profile.gender] || profile.gender : '—'}
          />
          <EditableRow
            label='出生日期'
            field='birthday'
            value={profile.birthday || '—'}
          />
          <EditableRow
            label='身高'
            field='height'
            value={profile.height != null ? `${profile.height} cm` : '—'}
          />
          <EditableRow
            label='体重'
            field='weight'
            value={profile.weight != null ? `${profile.weight} kg` : '—'}
          />
          <EditableRow
            label='饮食目标'
            field='diet_goal'
            value={profile.diet_goal ? GOAL_MAP[profile.diet_goal] || profile.diet_goal : '—'}
            highlight
          />
          <EditableRow
            label='活动水平'
            field='activity_level'
            value={profile.activity_level ? ACTIVITY_MAP[profile.activity_level] || profile.activity_level : '—'}
          />
          <EditableRow
            label='执行模式'
            field='execution_mode'
            value={profile.execution_mode ? EXECUTION_MODE_MAP[profile.execution_mode] || profile.execution_mode : '标准模式（便捷估算）'}
          />
        </View>

        {/* 代谢 — 只读 */}
        {(profile.bmr != null || profile.tdee != null) && (
          <View className='block'>
            <Text className='block-title'>代谢数据</Text>
            {profile.bmr != null && (
              <ReadOnlyRow
                label='BMR（基础代谢率）'
                value={`${profile.bmr.toFixed(0)} kcal/天`}
              />
            )}
            {profile.tdee != null && (
              <ReadOnlyRow
                label='TDEE（每日总消耗）'
                value={`${profile.tdee.toFixed(0)} kcal/天`}
              />
            )}
          </View>
        )}

        {/* 病史与饮食 */}
        <View className='block'>
          <Text className='block-title'>病史与饮食</Text>
          <EditableRow
            label='既往病史'
            field='medical_history'
            value={formatList(medicalHistory, MEDICAL_MAP)}
            column
          />
          <EditableRow
            label='饮食偏好'
            field='diet_preference'
            value={formatList(dietPreference, DIET_PREF_MAP)}
            column
          />
          <EditableRow
            label='过敏源'
            field='allergies'
            value={formatList(allergies, ALLERGY_MAP)}
            column
          />
          <EditableRow
            label='特殊情况和补充'
            field='health_notes'
            value={healthNotes ? healthNotes : '无'}
            column
          />
        </View>

        {/* 体检/病例识别结果 — 只读 */}
        <View className='block'>
          <Text className='block-title'>体检/病例识别结果</Text>
          {!hasReportData ? (
            <ReadOnlyRow
              label=''
              value='无'
              column
            />
          ) : (
            <>
              {hasConclusions && (
                <ReadOnlyRow
                  label='诊断结论'
                  value={reportExtract!.conclusions!.join('、')}
                  column
                />
              )}
              {hasIndicators && (
                <View className='row column'>
                  <Text className='label'>提取指标</Text>
                  <View className='indicators-list'>
                    {reportExtract!.indicators!.map((ind, idx) => (
                      <View key={idx} className='indicator-item'>
                        <Text className='ind-name'>{ind.name}</Text>
                        <Text className={`ind-val ${ind.flag ? 'abnormal' : ''}`}>
                          {ind.value} {ind.unit} {ind.flag}
                        </Text>
                      </View>
                    ))}
                  </View>
                </View>
              )}
              {hasSuggestions && (
                <ReadOnlyRow
                  label='医学建议'
                  value={reportExtract!.suggestions!.join('、')}
                  column
                />
              )}
              {hasMedicalNotes && (
                <ReadOnlyRow
                  label='其他记录'
                  value={reportExtract!.medical_notes}
                  column
                />
              )}
            </>
          )}
        </View>

        <View className='footer-actions'>
          <View className='btn-secondary' onClick={handleRefill}>
            <Text className='btn-text'>重新填写</Text>
          </View>
          <View className='btn-primary' onClick={handleEdit}>
            <Text className='btn-text'>编辑全部</Text>
          </View>
        </View>
      </ScrollView>

      {/* 底部编辑弹窗 */}
      {showEditor && (
        <View className='editor-modal' catchMove>
          <View className='editor-modal-mask' onClick={closeEditor} />
          <View className='editor-modal-content'>
            <View className='editor-header'>
              <Text className='editor-cancel' onClick={closeEditor}>取消</Text>
              <Text className='editor-title'>{config?.title || ''}</Text>
              {saving ? (
                <View className='editor-confirm-spinner' />
              ) : (
                <Text
                  className='editor-confirm'
                  onClick={handleSaveEdit}
                >
                  确定
                </Text>
              )}
            </View>
            <View className='editor-body'>
              {renderEditorBody()}
            </View>
          </View>
        </View>
      )}
    </View>
  )
}

export default withAuth(HealthProfileViewPage)
