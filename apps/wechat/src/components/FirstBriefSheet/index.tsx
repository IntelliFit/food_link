import { View, Text, Image, Button } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { useEffect, useState } from 'react'
import { experiments } from '../../utils/experiments'
import { BRIEF_PENDING_KEY } from '../../utils/onboarding-v2'
import { DEFAULT_PET_NAME } from '../../utils/pet-name'
import './index.scss'

const XIAOMAI = '/assets/pets/xiaomai-01.png'
const HINT_MS = 6000

/**
 * 新流程建档完成后回到首页弹一次「第一份简报」，关掉后在拍照按钮上方提示一句。
 * 数字直接用首页已有的今日摄入，不另外请求。
 */
export function FirstBriefSheet({ eaten, target, ready }: { eaten: number; target: number; ready: boolean }) {
  const [open, setOpen] = useState(false)
  const [hint, setHint] = useState(false)

  useEffect(() => {
    if (!ready || open) return
    let pending = false
    try { pending = Taro.getStorageSync(BRIEF_PENDING_KEY) === '1' } catch { pending = false }
    if (!pending || target <= 0) return
    try { Taro.removeStorageSync(BRIEF_PENDING_KEY) } catch { /* 最多再弹一次 */ }
    setOpen(true)
    experiments.track('onboarding_brief_view')
  }, [ready, target])

  useEffect(() => {
    if (!hint) return undefined
    const timer = setTimeout(() => setHint(false), HINT_MS)
    return () => clearTimeout(timer)
  }, [hint])

  const close = () => {
    setOpen(false)
    setHint(true)
    experiments.track('onboarding_brief_close')
  }

  const left = Math.max(0, Math.round(target - eaten))
  return (
    <>
      {open && (
        <View className='first-brief'>
          <View className='first-brief__card'>
            <View className='first-brief__head'>
              <Image className='first-brief__avatar' src={XIAOMAI} mode='aspectFit' />
              <View>
                <Text className='first-brief__title'>你的第一份简报</Text>
                <Text className='first-brief__sub'>{DEFAULT_PET_NAME}按你刚才说的算的</Text>
              </View>
            </View>
            <View className='first-brief__grid'>
              <View className='first-brief__cell'><Text className='first-brief__k'>已吃</Text><Text className='first-brief__v'>{Math.round(eaten).toLocaleString('en-US')}</Text></View>
              <View className='first-brief__cell'><Text className='first-brief__k'>每日目标</Text><Text className='first-brief__v'>{Math.round(target).toLocaleString('en-US')}</Text></View>
              <View className='first-brief__cell first-brief__cell--dark'><Text className='first-brief__k'>还能吃</Text><Text className='first-brief__v'>{left.toLocaleString('en-US')}</Text></View>
            </View>
            <Text className='first-brief__next'>下一顿吃什么，看首页「吃这个」，{DEFAULT_PET_NAME}会按你剩下的额度挑。</Text>
            <Button className='first-brief__ok' onClick={close}>知道了</Button>
          </View>
        </View>
      )}
      {hint && (
        <View className='first-brief__hint' onClick={() => setHint(false)}>
          <Text>下次想记，直接点这里拍</Text>
          <View className='first-brief__arrow' />
        </View>
      )}
    </>
  )
}
