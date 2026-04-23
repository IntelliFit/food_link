/**
 * 代谢分析所需档案：完备性校验、本机缓存、底部表单同步云端健康档案
 */
import { View, Text, Input } from '@tarojs/components'
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import Taro from '@tarojs/taro'
import { Popup } from '@taroify/core'
import '@taroify/core/popup/style'
import {
  getUserProfile,
  updateHealthProfile,
  type UserInfo,
} from '../../../utils/api'
import './metabolic-profile-sheet.scss'

const LOCAL_STORAGE_KEY = 'food_link_metabolic_min_profile_v1'

export interface LocalMinMetabolicProfile {
  height: number
  weight: number
  gender: string
  birthday?: string
  bmr?: number
  updatedAt: number
}

export function loadLocalMetabolicProfile(): LocalMinMetabolicProfile | null {
  try {
    const raw = Taro.getStorageSync(LOCAL_STORAGE_KEY)
    if (!raw || typeof raw !== 'object') return null
    const o = raw as Record<string, unknown>
    const height = Number(o.height)
    const weight = Number(o.weight)
    const gender = typeof o.gender === 'string' ? o.gender : ''
    const birthday = typeof o.birthday === 'string' ? o.birthday : undefined
    const bmr = o.bmr != null ? Number(o.bmr) : undefined
    const updatedAt = Number(o.updatedAt)
    if (!Number.isFinite(height) || !Number.isFinite(weight) || !gender.trim()) return null
    return {
      height,
      weight,
      gender,
      birthday,
      bmr: Number.isFinite(bmr) ? bmr : undefined,
      updatedAt: Number.isFinite(updatedAt) ? updatedAt : Date.now(),
    }
  } catch {
    return null
  }
}

export function saveLocalMetabolicProfile(data: Omit<LocalMinMetabolicProfile, 'updatedAt'>): void {
  try {
    const payload: LocalMinMetabolicProfile = {
      ...data,
      updatedAt: Date.now(),
    }
    Taro.setStorageSync(LOCAL_STORAGE_KEY, payload)
  } catch (e) {
    console.error('saveLocalMetabolicProfile', e)
  }
}

/** PRD：身高、体重、性别、BMR 均有效才可做代谢模拟展示 */
export function isMetabolicProfileComplete(u: UserInfo | null | undefined): boolean {
  if (!u) return false
  const h = u.height != null ? Number(u.height) : NaN
  const w = u.weight != null ? Number(u.weight) : NaN
  const bmr = u.bmr != null ? Number(u.bmr) : NaN
  if (!Number.isFinite(h) || h < 50 || h > 250) return false
  if (!Number.isFinite(w) || w < 20 || w > 300) return false
  if (!u.gender || !String(u.gender).trim()) return false
  if (!Number.isFinite(bmr) || bmr < 500 || bmr > 8000) return false
  return true
}

export function mergeUserWithLocalProfile(api: UserInfo, local: LocalMinMetabolicProfile | null): UserInfo {
  if (!local) return api
  const height =
    api.height != null && Number(api.height) > 0 ? Number(api.height) : local.height
  const weight =
    api.weight != null && Number(api.weight) > 0 ? Number(api.weight) : local.weight
  const gender =
    api.gender && String(api.gender).trim() ? api.gender : local.gender
  const birthday =
    api.birthday && String(api.birthday).trim() ? api.birthday : local.birthday ?? null
  const bmr =
    api.bmr != null && Number(api.bmr) > 0 ? Number(api.bmr) : local.bmr != null && local.bmr > 0 ? local.bmr : null
  return {
    ...api,
    height,
    weight,
    gender,
    birthday,
    bmr,
  }
}

function parseAge(birthday: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(birthday.trim())
  if (!m) return 30
  const y = Number(m[1])
  const mo = Number(m[2])
  const da = Number(m[3])
  const born = new Date(y, mo - 1, da)
  const now = new Date()
  let age = now.getFullYear() - born.getFullYear()
  if (now.getMonth() < born.getMonth() || (now.getMonth() === born.getMonth() && now.getDate() < born.getDate())) {
    age -= 1
  }
  return Math.max(18, Math.min(90, age))
}

/** 与代谢模块一致的 Mifflin–St Jeor，用于离线预览 BMR */
function previewMifflinBmr(weightKg: number, heightCm: number, age: number, male: boolean): number {
  const base = 10 * weightKg + 6.25 * heightCm - 5 * age
  const v = male ? base + 5 : base - 161
  return Math.round(Math.max(800, v) * 10) / 10
}

export interface MetabolicProfileSheetProps {
  open: boolean
  onClose: () => void
  /** 保存成功（云端已刷新档案）后的用户快照 */
  onSaved: (user: UserInfo) => void
  initialUser: UserInfo | null
}

export function MetabolicProfileSheet({
  open,
  onClose,
  onSaved,
  initialUser,
}: MetabolicProfileSheetProps): ReactNode {
  const [heightStr, setHeightStr] = useState('')
  const [weightStr, setWeightStr] = useState('')
  const [birthdayStr, setBirthdayStr] = useState('')
  const [gender, setGender] = useState<'male' | 'female' | ''>('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!open) return
    const u = initialUser
    const local = loadLocalMetabolicProfile()
    const h = u?.height && u.height > 0 ? u.height : local?.height
    const w = u?.weight && u.weight > 0 ? u.weight : local?.weight
    const g = u?.gender && String(u.gender).trim() ? u.gender : local?.gender
    const b = u?.birthday && String(u.birthday).trim() ? u.birthday : local?.birthday
    setHeightStr(h != null ? String(h) : '')
    setWeightStr(w != null ? String(w) : '')
    setBirthdayStr(b || '1995-01-01')
    setGender(g === 'female' || g === '女' ? 'female' : g === 'male' || g === '男' ? 'male' : '')
  }, [open, initialUser])

  const bmrPreview = useCallback((): number | null => {
    const h = Number(heightStr)
    const w = Number(weightStr)
    const b = birthdayStr.trim()
    if (!Number.isFinite(h) || h <= 0 || !Number.isFinite(w) || w <= 0 || !gender || !b) return null
    const male = gender === 'male'
    const age = parseAge(b)
    return previewMifflinBmr(w, h, age, male)
  }, [heightStr, weightStr, birthdayStr, gender])

  const previewVal = bmrPreview()

  const handleSave = useCallback(async (): Promise<void> => {
    const h = Number(heightStr)
    const w = Number(weightStr)
    const b = birthdayStr.trim()
    if (!gender) {
      Taro.showToast({ title: '请选择性别', icon: 'none' })
      return
    }
    if (!Number.isFinite(h) || h < 50 || h > 250) {
      Taro.showToast({ title: '身高需在 50–250 cm', icon: 'none' })
      return
    }
    if (!Number.isFinite(w) || w < 20 || w > 300) {
      Taro.showToast({ title: '体重需在 20–300 kg', icon: 'none' })
      return
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(b)) {
      Taro.showToast({ title: '生日格式 YYYY-MM-DD', icon: 'none' })
      return
    }

    const activity =
      initialUser?.activity_level && String(initialUser.activity_level).trim()
        ? initialUser.activity_level!
        : 'light'
    const male = gender === 'male'
    const fallbackBmr = previewMifflinBmr(w, h, parseAge(b), male)

    setSubmitting(true)
    try {
      await updateHealthProfile({
        gender,
        height: h,
        weight: w,
        birthday: b,
        activity_level: activity,
      })

      const user = await getUserProfile()
      let merged = user
      if (user.bmr == null || Number(user.bmr) <= 0) {
        merged = { ...user, bmr: fallbackBmr }
        saveLocalMetabolicProfile({
          height: h,
          weight: w,
          gender,
          birthday: b,
          bmr: fallbackBmr,
        })
        Taro.showToast({ title: '已同步云端，BMR 使用本机估算', icon: 'none' })
      } else {
        saveLocalMetabolicProfile({
          height: h,
          weight: w,
          gender,
          birthday: b,
          bmr: Number(user.bmr),
        })
      }
      onSaved(merged)
      onClose()
    } catch (e) {
      saveLocalMetabolicProfile({
        height: h,
        weight: w,
        gender,
        birthday: b,
        bmr: fallbackBmr,
      })
      const base = initialUser ?? (await getUserProfile().catch(() => null))
      const patched: UserInfo = {
        ...(base ?? ({} as UserInfo)),
        id: base?.id ?? '',
        openid: base?.openid ?? '',
        nickname: base?.nickname ?? '',
        avatar: base?.avatar ?? '',
        height: h,
        weight: w,
        gender,
        birthday: b,
        bmr: fallbackBmr,
      }
      onSaved(patched)
      onClose()
      Taro.showToast({ title: '已保存到本机，联网后将同步', icon: 'none' })
      console.error('updateHealthProfile fail', e)
    } finally {
      setSubmitting(false)
    }
  }, [gender, heightStr, weightStr, birthdayStr, initialUser, onClose, onSaved])

  if (!open) return null

  return (
    <Popup open={open} placement='bottom' rounded onClose={onClose}>
      <View className='metabolic-profile-sheet' onClick={(e) => e.stopPropagation()}>
        <Text className='metabolic-profile-sheet__title'>完善代谢档案</Text>
        <Text className='metabolic-profile-sheet__desc'>
          模拟需要身高、体重、性别与基础代谢（BMR）。保存后将写入云端健康档案；网络异常时暂存本机。
        </Text>

        <View className='metabolic-profile-sheet__field'>
          <Text className='metabolic-profile-sheet__label'>性别</Text>
          <View className='metabolic-profile-sheet__gender-row'>
            <View
              className={`metabolic-profile-sheet__gender-btn${gender === 'male' ? ' metabolic-profile-sheet__gender-btn--on' : ''}`}
              onClick={() => setGender('male')}
            >
              <Text className='metabolic-profile-sheet__gender-text'>男</Text>
            </View>
            <View
              className={`metabolic-profile-sheet__gender-btn${gender === 'female' ? ' metabolic-profile-sheet__gender-btn--on' : ''}`}
              onClick={() => setGender('female')}
            >
              <Text className='metabolic-profile-sheet__gender-text'>女</Text>
            </View>
          </View>
        </View>

        <View className='metabolic-profile-sheet__field'>
          <Text className='metabolic-profile-sheet__label'>身高（cm）</Text>
          <Input
            className='metabolic-profile-sheet__input'
            type='digit'
            placeholder='例如 170'
            value={heightStr}
            onInput={(ev) => setHeightStr(ev.detail.value)}
          />
        </View>

        <View className='metabolic-profile-sheet__field'>
          <Text className='metabolic-profile-sheet__label'>体重（kg）</Text>
          <Input
            className='metabolic-profile-sheet__input'
            type='digit'
            placeholder='例如 65'
            value={weightStr}
            onInput={(ev) => setWeightStr(ev.detail.value)}
          />
        </View>

        <View className='metabolic-profile-sheet__field'>
          <Text className='metabolic-profile-sheet__label'>生日（用于 BMR 与档案）</Text>
          <Input
            className='metabolic-profile-sheet__input'
            placeholder='YYYY-MM-DD'
            value={birthdayStr}
            onInput={(ev) => setBirthdayStr(ev.detail.value)}
          />
          <Text className='metabolic-profile-sheet__hint'>服务端会据此计算档案；离线时用 Mifflin 公式估算 BMR 预览。</Text>
        </View>

        {previewVal != null ? (
          <View className='metabolic-profile-sheet__bmr-preview'>
            <Text className='metabolic-profile-sheet__bmr-preview-text'>
              估算 BMR 约 {previewVal} kcal/天（保存后以服务端为准；失败则用此值本机代谢模拟）
            </Text>
          </View>
        ) : null}

        <View className='metabolic-profile-sheet__actions'>
          <View className='metabolic-profile-sheet__btn metabolic-profile-sheet__btn--ghost' onClick={onClose}>
            <Text className='metabolic-profile-sheet__btn--ghost-text'>取消</Text>
          </View>
          <View
            className={`metabolic-profile-sheet__btn metabolic-profile-sheet__btn--primary${submitting ? ' metabolic-profile-sheet__btn--disabled' : ''}`}
            onClick={() => {
              if (!submitting) void handleSave()
            }}
          >
            <Text className='metabolic-profile-sheet__btn--primary-text'>{submitting ? '保存中' : '保存'}</Text>
          </View>
        </View>
      </View>
    </Popup>
  )
}
