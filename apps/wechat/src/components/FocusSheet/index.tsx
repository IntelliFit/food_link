import { View, Text, Input } from '@tarojs/components'
import { useEffect, useState } from 'react'
import Taro from '@tarojs/taro'
import {
  addHealthFocus,
  getHealthFocuses,
  removeHealthFocus,
  saveHealthFocusKeys,
  showUnifiedApiError,
  type CustomHealthFocus,
} from '../../utils/api'
import { experiments } from '../../utils/experiments'
import { customFocusKey, FOCUS_LIMIT, focusOptions, keepKnownFocus, toggleFocus } from './focus-options'
import './index.scss'

/** 打开时让自定义底栏让位（custom-tab-bar 轮询这个标记），和圈子评论栏一个做法 */
const TAB_BAR_HIDDEN_KEY = 'pet_focus_sheet_visible'
const CUSTOM_LABEL_MAX = 12

function setTabBarHidden(hidden: boolean) {
  try {
    if (hidden) Taro.setStorageSync(TAB_BAR_HIDDEN_KEY, '1')
    else Taro.removeStorageSync(TAB_BAR_HIDDEN_KEY)
  } catch (_) {}
}

/**
 * 「我在意的」唯一的编辑弹窗：伙伴页、完整分析页都打开它。内置 7 项 + 自己加的关注，最多选 3 项，
 * 保存写 PUT /api/health/focus。自定义关注的 AI 分数卡在分析页生成，这里只加名字（不扣积分）。
 */
export function FocusSheet({ visible, current, dark, source, onClose, onSaved }: {
  visible: boolean
  current: readonly string[]
  dark?: boolean
  source: 'pet' | 'stats'
  onClose: () => void
  onSaved: (keys: string[]) => void
}) {
  const [keys, setKeys] = useState<string[]>([])
  const [custom, setCustom] = useState<CustomHealthFocus[]>([])
  const [maxCustom, setMaxCustom] = useState(0)
  const [draft, setDraft] = useState('')
  const [adding, setAdding] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setTabBarHidden(visible)
    if (!visible) return () => setTabBarHidden(false)
    setKeys(current.slice(0, FOCUS_LIMIT))
    setDraft('')
    let alive = true
    getHealthFocuses()
      .then((res) => {
        if (!alive) return
        setCustom(res.focuses || [])
        setMaxCustom(res.max_focuses || 0)
      })
      .catch((error) => console.warn('[focus-sheet] 读取自定义关注失败', error))
    return () => {
      alive = false
      setTabBarHidden(false)
    }
  }, [visible, current])

  if (!visible) return null

  const options = focusOptions(custom)
  const busy = saving || adding
  const canAddCustom = maxCustom <= 0 || custom.length < maxCustom

  const toggle = (key: string) => {
    const result = toggleFocus(keys, key)
    if (result.blocked) {
      Taro.showToast({ title: `最多选 ${FOCUS_LIMIT} 项，先取消一项`, icon: 'none' })
      return
    }
    setKeys(result.keys)
  }

  const addCustom = async () => {
    const label = draft.trim()
    if (!label || busy) return
    setAdding(true)
    try {
      const res = await addHealthFocus(label)
      const focuses = res.focuses || []
      setCustom(focuses)
      const id = res.focus_id || focuses.find((item) => item.label === label)?.id || ''
      setDraft('')
      experiments.track('focus_custom_add', { source })
      if (id) {
        const key = customFocusKey(id)
        setKeys((prev) => (prev.includes(key) || prev.length >= FOCUS_LIMIT ? prev : [...prev, key]))
      }
      if (res.already_exists) Taro.showToast({ title: '已经有这一项了', icon: 'none' })
    } catch (error) {
      await showUnifiedApiError(error, '添加关注失败')
    } finally {
      setAdding(false)
    }
  }

  const removeCustom = (id: string, label: string) => {
    if (busy) return
    Taro.showModal({
      title: '删掉这项关注',
      content: `删掉「${label}」后，它的分数卡也会一起删掉。`,
      confirmText: '删掉',
      success: (res) => {
        if (!res.confirm) return
        void removeHealthFocus(id)
          .then((result) => {
            setCustom(result.focuses || [])
            setKeys((prev) => prev.filter((key) => key !== customFocusKey(id)))
          })
          .catch((error) => showUnifiedApiError(error, '删除关注失败'))
      },
    })
  }

  const save = async () => {
    if (busy) return
    setSaving(true)
    const next = keepKnownFocus(keys, options)
    try {
      await saveHealthFocusKeys(next)
      experiments.track('focus_save', { source, count: next.length })
      Taro.showToast({ title: '记下了，推荐和任务按这个排', icon: 'none' })
      onSaved(next)
    } catch (error) {
      await showUnifiedApiError(error, '保存关注失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <View className={`focus-sheet ${dark ? 'focus-sheet--dark' : ''}`} catchMove>
      <View className='focus-sheet__mask' onClick={busy ? undefined : onClose} />
      <View className='focus-sheet__panel'>
        <View className='focus-sheet__head'>
          <Text className='focus-sheet__title'>我在意的</Text>
          <Text className='focus-sheet__count'>已选 {keys.length}/{FOCUS_LIMIT}</Text>
        </View>
        <Text className='focus-sheet__desc'>最多选 {FOCUS_LIMIT} 项。今天还差什么、推荐和任务都先看这几项。</Text>
        <View className='focus-sheet__options'>
          {options.map((option) => {
            const order = keys.indexOf(option.key)
            return (
              <View key={option.key} className={`focus-sheet__option ${order >= 0 ? 'is-on' : ''}`} onClick={() => toggle(option.key)}>
                {order >= 0 ? <Text className='focus-sheet__order'>{order + 1}</Text> : null}
                <Text className='focus-sheet__label'>{option.label}</Text>
                {option.customId ? (
                  <View
                    className='focus-sheet__remove'
                    aria-role='button'
                    aria-label={`删掉${option.label}`}
                    onClick={(event) => {
                      event.stopPropagation()
                      removeCustom(option.customId, option.label)
                    }}
                  >
                    <Text className='focus-sheet__remove-text'>×</Text>
                  </View>
                ) : null}
              </View>
            )
          })}
        </View>
        {canAddCustom ? (
          <View className='focus-sheet__add'>
            <Input
              className='focus-sheet__input'
              value={draft}
              placeholder='自己写一项，比如：少吃外卖'
              placeholderClass='focus-sheet__placeholder'
              maxlength={CUSTOM_LABEL_MAX}
              confirmType='done'
              onInput={(event) => setDraft(event.detail.value)}
              onConfirm={() => void addCustom()}
            />
            <View className={`focus-sheet__add-btn ${draft.trim() ? '' : 'is-disabled'}`} onClick={() => void addCustom()}>
              {adding ? <View className='focus-sheet__spinner' /> : <Text className='focus-sheet__add-text'>添加</Text>}
            </View>
          </View>
        ) : (
          <Text className='focus-sheet__hint'>自己加的关注最多 {maxCustom} 项，删掉一项才能再加。</Text>
        )}
        <View className='focus-sheet__actions'>
          <View className='focus-sheet__btn' onClick={busy ? undefined : onClose}>
            <Text className='focus-sheet__btn-text'>取消</Text>
          </View>
          <View className='focus-sheet__btn focus-sheet__btn--primary' onClick={() => void save()}>
            {saving ? <View className='focus-sheet__spinner focus-sheet__spinner--light' /> : <Text className='focus-sheet__btn-text'>保存</Text>}
          </View>
        </View>
      </View>
    </View>
  )
}
