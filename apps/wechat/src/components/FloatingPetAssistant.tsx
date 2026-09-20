import { View, Text } from '@tarojs/components'
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
import Taro, { useDidHide, useDidShow } from '@tarojs/taro'
import type { PetProfile } from '../utils/api'
import { getAccessToken } from '../utils/api'
import { redirectToLogin } from '../utils/withAuth'
import { PetAvatar } from './PetAvatar'
import { getCompanionSprite, PetCompanionSprite } from './PetCompanionSprite'
import { PetChatContent } from './PetChatContent'
import {
  completePetPlayReward,
  petDailyPlayStorageKey,
  PET_DAILY_PLAY_GOAL,
  readPetPlayRewardSummary,
} from '../utils/pet-play-reward'
import './FloatingPetAssistant.scss'

type Phase = 'playing' | 'running' | 'docked' | 'returning'
const DOCK_WITH_RIDE_MS = 980
const RETURN_TO_DESK_MS = 1800

function readDailyPlayCount(): number {
  try {
    const value = Number(Taro.getStorageSync(petDailyPlayStorageKey()))
    return Number.isFinite(value) ? Math.max(0, Math.min(PET_DAILY_PLAY_GOAL, Math.floor(value))) : 0
  } catch {
    return 0
  }
}
export interface FloatingPetAssistantHandle {
  onPageScroll: (scrollTop: number) => void
  onTouchStart: (clientY: number) => void
  onTouchMove: (clientY: number) => void
  openChat: (starter?: string) => void
}

interface Props {
  pet?: PetProfile
  mood?: string
  state?: string
  suppressed?: boolean
  dark?: boolean
  companionSpriteOverride?: string
  reminder?: { text: string; tone: string; count?: number }
  onReminderPress?: () => void
  onReminderShown?: () => void
  onChatOpenChange: (open: boolean) => void
}

/** Only this small component updates while the page scrolls; the dashboard stays still. */
export const FloatingPetAssistant = forwardRef<FloatingPetAssistantHandle, Props>(function FloatingPetAssistant({
  pet, mood, state, suppressed = false, dark = false, companionSpriteOverride, reminder, onReminderPress, onReminderShown, onChatOpenChange,
}, ref) {
  const [phase, setPhase] = useState<Phase>('playing')
  const [roamFar, setRoamFar] = useState(true)
  const [walking, setWalking] = useState(false)
  const [idleAction, setIdleAction] = useState<'blink' | 'wave' | 'kick'>('wave')
  const [active, setActive] = useState(true)
  const [chatOpen, setChatOpen] = useState(false)
  const [chatMounted, setChatMounted] = useState(false)
  const [starter, setStarter] = useState('')
  const [starterRequest, setStarterRequest] = useState(0)
  const [keyboardHeight, setKeyboardHeight] = useState(0)
  const [dailyPlayCount, setDailyPlayCount] = useState(readDailyPlayCount)
  const [playReward, setPlayReward] = useState(readPetPlayRewardSummary)
  const [playBurst, setPlayBurst] = useState(0)
  const [rewardBurst, setRewardBurst] = useState(0)
  const [welcoming, setWelcoming] = useState(true)
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const returnTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastScrollTop = useRef(0)
  const touchStartY = useRef<number | null>(null)
  const phaseRef = useRef<Phase>('playing')
  const manualDockedRef = useRef(false)
  const windowHeightRef = useRef(0)
  const visible = active && !suppressed
  const companionSprite = companionSpriteOverride || getCompanionSprite(pet)

  const clearTimers = useCallback(() => {
    if (settleTimer.current) clearTimeout(settleTimer.current)
    if (returnTimer.current) clearTimeout(returnTimer.current)
    settleTimer.current = null
    returnTimer.current = null
  }, [])

  const changePhase = useCallback((next: Phase) => {
    phaseRef.current = next
    setPhase(next)
  }, [])

  const startReturnToDesk = useCallback(() => {
    clearTimers()
    setWelcoming(false)
    setWalking(false)
    changePhase('returning')
    settleTimer.current = setTimeout(() => {
      changePhase('playing')
    }, RETURN_TO_DESK_MS)
  }, [changePhase, clearTimers])

  const minimize = useCallback(() => {
    setChatOpen(false)
    setKeyboardHeight(0)
    onChatOpenChange(false)
    void Taro.hideKeyboard()
    changePhase('playing')
  }, [changePhase, onChatOpenChange])

  const openChat = useCallback((question?: string) => {
    if (!getAccessToken()) {
      redirectToLogin()
      return
    }
    clearTimers()
    manualDockedRef.current = false
    changePhase('playing')
    if (question) {
      setStarter(question)
      setStarterRequest((previous) => previous + 1)
    }
    setChatMounted(true)
    setChatOpen(true)
    onChatOpenChange(true)
  }, [changePhase, clearTimers, onChatOpenChange])

  const dock = useCallback((returnAutomatically: boolean) => {
    // Let a return finish before scroll events can request another departure.
    if (phaseRef.current === 'returning') return
    // Continuous scrolling extends the peek, without restarting the run-in.
    if (returnTimer.current) clearTimeout(returnTimer.current)
    returnTimer.current = null
    if (!returnAutomatically) manualDockedRef.current = true
    if (phaseRef.current !== 'docked' && phaseRef.current !== 'running') {
      if (settleTimer.current) clearTimeout(settleTimer.current)
      changePhase('running')
      settleTimer.current = setTimeout(() => changePhase('docked'), DOCK_WITH_RIDE_MS)
    }
    if (returnAutomatically && !manualDockedRef.current) {
      returnTimer.current = setTimeout(() => {
        startReturnToDesk()
      }, 2800)
    }
  }, [changePhase, startReturnToDesk])

  const restoreToDesk = useCallback(() => {
    clearTimers()
    manualDockedRef.current = false
    startReturnToDesk()
  }, [clearTimers, startReturnToDesk])

  const handleDailyPlay = useCallback((event?: { stopPropagation?: () => void }) => {
    event?.stopPropagation?.()
    if (dailyPlayCount >= PET_DAILY_PLAY_GOAL) {
      const rewardContext = playReward.totalStars > 0
        ? `我已获得“${playReward.badge}”徽章，连续完成 ${playReward.streak} 天。`
        : ''
      openChat(`${rewardContext}根据我今天的健康记录，给我一个三分钟内能完成的趣味健康探索任务。`)
      return
    }
    const next = Math.min(PET_DAILY_PLAY_GOAL, dailyPlayCount + 1)
    setDailyPlayCount(next)
    setIdleAction('kick')
    setPlayBurst((previous) => previous + 1)
    try { Taro.setStorageSync(petDailyPlayStorageKey(), next) } catch { /* 本地娱乐进度失败不影响宠物主功能。 */ }
    const reward = next >= PET_DAILY_PLAY_GOAL ? completePetPlayReward() : playReward
    if (next >= PET_DAILY_PLAY_GOAL) {
      setPlayReward(reward)
      setRewardBurst((previous) => previous + 1)
    }
    Taro.showToast({
      title: next >= PET_DAILY_PLAY_GOAL ? `${reward.badge} · 连续${reward.streak}天` : `陪伴活力 ${next}/${PET_DAILY_PLAY_GOAL}`,
      icon: 'none',
    })
  }, [dailyPlayCount, openChat, playReward])

  useEffect(() => {
    const timer = setTimeout(() => setWelcoming(false), 520)
    return () => clearTimeout(timer)
  }, [])

  useEffect(() => {
    if (!visible || chatOpen || phase !== 'playing') {
      setWalking(false)
      return
    }
    let timer: ReturnType<typeof setTimeout>
    let actionIndex = 0
    const idleActions = ['blink', 'kick', 'wave'] as const
    const stroll = () => {
      setRoamFar((previous) => !previous)
      setWalking(true)
      timer = setTimeout(() => {
        setWalking(false)
        setIdleAction(idleActions[actionIndex++ % idleActions.length])
        timer = setTimeout(stroll, 1600)
      }, 5000)
    }
    timer = setTimeout(stroll, 1200)
    return () => clearTimeout(timer)
  }, [chatOpen, phase, visible])

  useImperativeHandle(ref, () => ({
    openChat,
    onTouchStart: (clientY) => { touchStartY.current = clientY },
    onTouchMove: (clientY) => {
      if (touchStartY.current !== null && Math.abs(clientY - touchStartY.current) >= 8 && visible && !chatOpen) dock(true)
    },
    onPageScroll: (scrollTop) => {
      const moved = Math.abs(scrollTop - lastScrollTop.current) >= 2
      lastScrollTop.current = scrollTop
      if (moved && visible && !chatOpen) dock(true)
    },
  }), [chatOpen, dock, openChat, visible])

  useEffect(() => {
    if (!visible) {
      clearTimers()
      changePhase(manualDockedRef.current ? 'docked' : 'playing')
      if (chatOpen) minimize()
    }
  }, [changePhase, chatOpen, clearTimers, minimize, visible])

  useEffect(() => {
    if (visible && !chatOpen && phase === 'playing' && reminder) onReminderShown?.()
  }, [chatOpen, onReminderShown, phase, reminder, visible])

  useEffect(() => {
    if (!chatOpen || !visible) return
    windowHeightRef.current = Taro.getWindowInfo().windowHeight
    const handleKeyboard = ({ height }: { height: number }) => setKeyboardHeight(Math.max(0, height))
    Taro.onKeyboardHeightChange(handleKeyboard)
    return () => Taro.offKeyboardHeightChange(handleKeyboard)
  }, [chatOpen, visible])

  useDidShow(() => setActive(true))
  useDidHide(() => {
    setActive(false)
    clearTimers()
    minimize()
  })
  useEffect(() => () => {
    clearTimers()
    onChatOpenChange(false)
  }, [clearTimers, onChatOpenChange])

  const keyboardStyle = keyboardHeight > 0 ? {
    bottom: `${keyboardHeight + 8}px`,
    height: `${Math.max(0, windowHeightRef.current - keyboardHeight - 24)}px`,
    maxHeight: `${Math.max(0, windowHeightRef.current - keyboardHeight - 24)}px`,
  } : undefined
  return (
    <View className={`pet-assistant ${dark ? 'pet-assistant--dark' : ''}`}>
      {visible && !chatOpen ? (
        <View id='home-floating-pet' className={`pet-assistant-float pet-assistant-float--${phase} ${welcoming ? 'is-welcoming' : ''} ${roamFar ? 'is-roaming-far' : 'is-roaming-near'} ${walking ? 'is-walking' : `is-${idleAction}`} ${companionSprite ? 'has-full-body' : ''}`}>
          {phase === 'playing' && reminder ? (
            <View id={reminder.tone === 'messages' ? 'home-pet-message-reminder' : 'home-pet-analyze-reminder'} className='pet-assistant-reminder' role='button' onClick={onReminderPress}>
              <Text>{reminder.text}</Text>
              {reminder.count && reminder.count > 1 ? <Text className='pet-assistant-reminder__count'>{reminder.count}</Text> : null}
            </View>
          ) : phase === 'playing' ? (
            <View id='pet-assistant-chat-bubble' className='pet-assistant-invitation' role='button' aria-label='打开宠物聊天气泡' onClick={() => openChat()}>
              <Text>聊一聊</Text>
              <View className='pet-assistant-bubble-tail' />
            </View>
          ) : null}
          {phase === 'docked' || phase === 'returning' ? (
            <View
              id='pet-assistant-edge-indicator'
              className={`pet-assistant-edge-call${reminder ? ' has-reminder' : ''}${phase === 'returning' ? ' is-leaving' : ''}`}
              role='button'
              aria-label={reminder ? `叫回宠物，有待查看提醒：${reminder.text}` : '叫回宠物'}
              aria-hidden={phase === 'returning'}
              onClick={(event) => {
                event?.stopPropagation?.()
                if (phase === 'docked') restoreToDesk()
              }}
            >
              <Text className='pet-assistant-edge-call__line'>有事</Text>
              <Text className='pet-assistant-edge-call__line'>叫我</Text>
              {reminder ? (
                <Text className='pet-assistant-edge-call__badge'>
                  {reminder.count && reminder.count > 1 ? reminder.count : '!'}
                </Text>
              ) : null}
            </View>
          ) : null}
          {phase === 'playing' ? <View className='pet-assistant-tuck' role='button' aria-label='暂时收起宠物' onClick={() => dock(false)}><Text>›</Text></View> : null}
          <View id='pet-assistant-open' className='pet-assistant-companion' role='button' aria-label={`和${pet?.name || '宠物'}聊聊`} onClick={() => openChat()}>
            <View className='pet-assistant-traveler'>
              <View className='pet-assistant-facing'>
                <View className='pet-assistant-look'>
                  {companionSprite ? (
                    <PetCompanionSprite src={companionSprite} name={pet?.name} pose={phase === 'playing' && !walking ? idleAction : 'idle'} />
                  ) : (
                    <PetAvatar pet={pet} animal={pet ? undefined : 'cat'} size={68} mood={mood} state={state} motion={phase === 'playing' && !walking ? 'companion' : 'static'} />
                  )}
                </View>
              </View>
              <View className={`pet-assistant-rider-limbs${companionSprite?.includes('jianwen') ? ' is-jianwen' : ''}`} aria-hidden>
                <View className='pet-assistant-rider-leg is-far'><View /></View>
                <View className='pet-assistant-rider-leg is-near'><View /></View>
              </View>
              <View key={playBurst} className='pet-assistant-toy' />
            </View>
            <View className={`pet-assistant-rider-arms${companionSprite?.includes('jianwen') ? ' is-jianwen' : ''}`} aria-hidden>
              <View className='pet-assistant-rider-arm is-far'>
                <View className='pet-assistant-rider-arm__upper' /><View className='pet-assistant-rider-arm__forearm' /><View className='pet-assistant-rider-arm__hand' />
              </View>
              <View className='pet-assistant-rider-arm is-near'>
                <View className='pet-assistant-rider-arm__upper' /><View className='pet-assistant-rider-arm__forearm' /><View className='pet-assistant-rider-arm__hand' />
              </View>
            </View>
            <View className='pet-assistant-ride' aria-hidden>
              <View className='pet-assistant-ride__shadow' />
              <View className='pet-assistant-ride__wheel pet-assistant-ride__wheel--rear'>
                <View className='pet-assistant-ride__hub' />
              </View>
              <View className='pet-assistant-ride__wheel pet-assistant-ride__wheel--front'>
                <View className='pet-assistant-ride__hub' />
              </View>
              <View className='pet-assistant-ride__frame pet-assistant-ride__frame--chain' />
              <View className='pet-assistant-ride__frame pet-assistant-ride__frame--down' />
              <View className='pet-assistant-ride__frame pet-assistant-ride__frame--seat-stay' />
              <View className='pet-assistant-ride__frame pet-assistant-ride__frame--seat-tube' />
              <View className='pet-assistant-ride__frame pet-assistant-ride__frame--top' />
              <View className='pet-assistant-ride__fork' />
              <View className='pet-assistant-ride__seat' />
              <View className='pet-assistant-ride__handle' />
              <View className='pet-assistant-ride__pedal'>
                <View className='pet-assistant-ride__pedal-arm' />
              </View>
              <View className='pet-assistant-ride__trail' />
            </View>
            <View className='pet-assistant-ground' />
          </View>
          {phase === 'playing' ? (
            <View id='pet-assistant-daily-play' className={`pet-assistant-daily-play${dailyPlayCount >= PET_DAILY_PLAY_GOAL ? ' is-ready' : ''}`} role='button' aria-label={dailyPlayCount >= PET_DAILY_PLAY_GOAL ? `开始今日健康探索，${playReward.badge}，连续${playReward.streak}天` : '陪宠物玩球'} onClick={handleDailyPlay}>
              <View className='pet-assistant-daily-play__ball' />
              <Text>{dailyPlayCount >= PET_DAILY_PLAY_GOAL ? '探索' : `${dailyPlayCount}/${PET_DAILY_PLAY_GOAL}`}</Text>
            </View>
          ) : null}
          {phase === 'playing' && dailyPlayCount >= PET_DAILY_PLAY_GOAL ? (
            <View id='pet-assistant-reward-badge' className='pet-assistant-reward-badge'>
              <Text className='pet-assistant-reward-badge__star'>★</Text>
              <Text>{playReward.badge}</Text>
              <Text className='pet-assistant-reward-badge__streak'>{playReward.streak}天</Text>
            </View>
          ) : null}
          {phase === 'playing' && rewardBurst > 0 ? (
            <View key={rewardBurst} className='pet-assistant-reward-burst' aria-hidden>
              <Text>★</Text><Text>✦</Text><Text>★</Text>
            </View>
          ) : null}
        </View>
      ) : null}
      {chatMounted ? (
        <View className={`pet-assistant-chat-layer ${chatOpen && visible ? 'is-open' : ''}`}>
          <View id='pet-assistant-chat-mask' className='pet-assistant-chat-mask' catchMove onClick={minimize} />
          <View id='pet-assistant-chat-window' className={`pet-assistant-chat-window ${keyboardHeight ? 'has-keyboard' : ''}`} style={keyboardStyle} catchMove>
            <PetChatContent embedded active={chatOpen && visible} starterQuestion={starter} starterRequest={starterRequest} onMinimize={minimize} />
          </View>
        </View>
      ) : null}
    </View>
  )
})
