import { View, Text, Input, Button } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { useState } from 'react'
import {
  CUSTOM_FOCUS_MAX,
  FOCUS_LIMIT,
  FOCUS_OPTIONS,
  focusReply,
  focusSaid,
  normalizeCustomFocus,
  saveOnboardingFocus,
  toggleFocus,
  type FocusKey,
} from '../../focus'

/** 选完（或跳过）后交给页面的东西：页面只显示这两句话、记埋点、在建档保存前等 saved */
export interface FocusChoice {
  skipped: boolean
  count: number
  custom: boolean
  /** 用户那条气泡 */
  said: string
  /** 小麦回的一句 */
  reply: string
  /** 后台保存，永不 reject；跳过时直接是 false */
  saved: Promise<boolean>
}

/**
 * 「② 你最想改善哪方面？」：多选最多 3 项，含一项「自己写」，选完就在后台保存。
 * 样式在 profile/index.scss（obp-focus），这里不单独引 scss。
 */
export function FocusPicker({ onDone }: { onDone: (choice: FocusChoice) => void }) {
  const [keys, setKeys] = useState<FocusKey[]>([])
  const [customLabel, setCustomLabel] = useState('')
  const [customOpen, setCustomOpen] = useState(false)
  const [customText, setCustomText] = useState('')

  const room = FOCUS_LIMIT - (customLabel ? 1 : 0)
  const typed = customOpen && !customLabel ? normalizeCustomFocus(customText) : ''
  const pendingCustom = typed && keys.length < FOCUS_LIMIT ? typed : ''
  const count = keys.length + (customLabel || pendingCustom ? 1 : 0)
  const full = () => Taro.showToast({ title: `最多选 ${FOCUS_LIMIT} 项`, icon: 'none' })

  const pick = (key: FocusKey) => {
    const { next, blocked } = toggleFocus(keys, key, room)
    if (blocked) full()
    else setKeys(next)
  }

  const openCustom = () => {
    if (customLabel) {
      setCustomLabel('')
      return
    }
    if (keys.length >= FOCUS_LIMIT) {
      full()
      return
    }
    setCustomOpen(!customOpen)
  }

  const addCustom = () => {
    const label = normalizeCustomFocus(customText)
    if (!label) {
      Taro.showToast({ title: `写 2–${CUSTOM_FOCUS_MAX} 个字就行`, icon: 'none' })
      return
    }
    setCustomLabel(label)
    setCustomText('')
    setCustomOpen(false)
  }

  const done = () => {
    if (count === 0) return
    const label = customLabel || pendingCustom
    onDone({
      skipped: false,
      count,
      custom: Boolean(label),
      said: focusSaid(keys, label),
      reply: focusReply(keys, label),
      saved: saveOnboardingFocus(keys, label),
    })
  }

  const skip = () => onDone({
    skipped: true,
    count: 0,
    custom: false,
    said: focusSaid([]),
    reply: focusReply([]),
    saved: Promise.resolve(false),
  })

  return (
    <View className='obp-pad ob-fade'>
      <View className='obp-grid obp-grid--2 obp-focus'>
        {FOCUS_OPTIONS.map((o) => (
          <View key={o.key} className={`ob-chip obp-grid__chip ${keys.includes(o.key) ? 'ob-chip--on' : ''}`} onClick={() => pick(o.key)}>
            <Text>{o.label}</Text>
          </View>
        ))}
        <View className={`ob-chip obp-grid__chip obp-focus__custom ${customLabel ? 'ob-chip--on' : ''}`} onClick={openCustom}>
          <Text className='obp-focus__custom-text'>{customLabel ? `${customLabel} ×` : '自己写'}</Text>
        </View>
      </View>
      {customOpen && !customLabel && (
        <View className='obp-input obp-focus__input'>
          <Input className='obp-input__field' value={customText} placeholder='你关心的，比如控尿酸' maxlength={CUSTOM_FOCUS_MAX} focus confirmType='done'
            onInput={(e) => setCustomText(e.detail.value)} onConfirm={addCustom}
          />
          <Button className='obp-input__send' disabled={!normalizeCustomFocus(customText)} onClick={addCustom}>加上</Button>
        </View>
      )}
      <Button className='obp-confirm obp-focus__done' disabled={count === 0} onClick={done}>
        {count > 0 ? `就这些（${count}/${FOCUS_LIMIT}）` : `最多选 ${FOCUS_LIMIT} 项`}
      </Button>
      <Text className='obp-skip' onClick={skip}>跳过，以后再说</Text>
    </View>
  )
}
