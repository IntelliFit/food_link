import { Text, View } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { useEffect, useRef, useState } from 'react'
import { PetAvatar } from '../../../components/PetAvatar'
import { getPetSummary, type PetProfile } from '../../../utils/api'
import { DEFAULT_PET_NAME, petDisplayName } from '../../../utils/pet-name'
import {
  PET_MAX_SNACKS,
  createPetSnackTray,
  replacePetSnack,
  petSnackLine,
  petTapLine,
  pickWaitingStageLine,
  type PetSnack,
  type WaitingStageInput,
} from './waiting-pet'
import './WaitingPetCompanion.scss'

// Only this module imports waiting-pet, which keeps its copy out of the main package's shared chunk.
export { petQuizLine } from './waiting-pet'

// Same switch the home page uses when someone hides the companion.
const HOME_PET_HIDDEN_KEY = 'home_pet_companion_hidden_v1'
const FALLBACK_PET: Partial<PetProfile> = { builtin_avatar_id: 'jianwen-01', name: DEFAULT_PET_NAME }
const STAGE_LINE_MS = 5000
const REACTION_MS = 3500
const HOP_MS = 520
const FLOATER_MS = 900
const MAX_FLOATERS = 6

export interface PetReaction {
  id: number
  text: string
}

interface Floater {
  id: number
  glyph: string
}

interface WaitingPetCompanionProps extends WaitingStageInput {
  tip: string
  reaction?: PetReaction | null
}

function isPetHidden(): boolean {
  try {
    return Taro.getStorageSync(HOME_PET_HIDDEN_KEY) === '1'
  } catch {
    return false
  }
}

export function WaitingPetCompanion({ tip, reaction, ...stageInput }: WaitingPetCompanionProps) {
  const [hidden] = useState(isPetHidden)
  const [pet, setPet] = useState<Partial<PetProfile> | null>(null)
  const [mood, setMood] = useState<string | undefined>()
  const [activeReaction, setActiveReaction] = useState<string | null>(null)
  const [stageFresh, setStageFresh] = useState(true)
  const [hopping, setHopping] = useState(false)
  const [floaters, setFloaters] = useState<Floater[]>([])
  const [snacksEaten, setSnacksEaten] = useState(0)
  const [snackTray, setSnackTray] = useState(createPetSnackTray)
  const snackTrayRef = useRef(snackTray)
  const snacksEatenRef = useRef(0)
  const tapCountRef = useRef(0)
  const nextFloaterRef = useRef(0)
  const reactionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const floaterTimersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set())

  const stage = pickWaitingStageLine(stageInput)

  useEffect(() => {
    if (hidden) return undefined
    let cancelled = false
    getPetSummary()
      .then((summary) => {
        if (cancelled) return
        setPet(summary.pet)
        setMood(summary.status?.mood)
      })
      .catch(() => {
        // The wait page must keep working when the pet service does not answer.
        if (!cancelled) setPet(FALLBACK_PET)
      })
    return () => { cancelled = true }
  }, [hidden])

  useEffect(() => {
    setStageFresh(true)
    const timer = setTimeout(() => setStageFresh(false), STAGE_LINE_MS)
    return () => clearTimeout(timer)
  }, [stage.key])

  useEffect(() => () => {
    if (reactionTimerRef.current) clearTimeout(reactionTimerRef.current)
    if (hopTimerRef.current) clearTimeout(hopTimerRef.current)
    floaterTimersRef.current.forEach(clearTimeout)
    floaterTimersRef.current.clear()
  }, [])

  const hop = () => {
    setHopping(true)
    if (hopTimerRef.current) clearTimeout(hopTimerRef.current)
    hopTimerRef.current = setTimeout(() => setHopping(false), HOP_MS)
  }

  const say = (text: string) => {
    setActiveReaction(text)
    hop()
    if (reactionTimerRef.current) clearTimeout(reactionTimerRef.current)
    reactionTimerRef.current = setTimeout(() => setActiveReaction(null), REACTION_MS)
  }

  const addFloater = (glyph: string) => {
    nextFloaterRef.current += 1
    const id = nextFloaterRef.current
    setFloaters(prev => [...prev.slice(-(MAX_FLOATERS - 1)), { id, glyph }])
    if (floaterTimersRef.current.size >= MAX_FLOATERS) {
      const oldest = floaterTimersRef.current.values().next().value
      if (oldest) {
        clearTimeout(oldest)
        floaterTimersRef.current.delete(oldest)
      }
    }
    const timer = setTimeout(() => {
      setFloaters(prev => prev.filter(item => item.id !== id))
      floaterTimersRef.current.delete(timer)
    }, FLOATER_MS)
    floaterTimersRef.current.add(timer)
  }

  const reactionId = reaction?.id
  useEffect(() => {
    if (reaction) say(reaction.text)
    // Each reaction id fires once; the text belongs to that id.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reactionId])

  const handleTap = () => {
    tapCountRef.current += 1
    say(petTapLine(tapCountRef.current))
    addFloater('❤️')
  }

  const handleFeed = (snack: PetSnack) => {
    const eaten = snacksEatenRef.current
    say(petSnackLine(snack, eaten))
    if (eaten >= PET_MAX_SNACKS || !snackTrayRef.current.some(item => item.id === snack.id)) return
    snacksEatenRef.current = eaten + 1
    setSnacksEaten(eaten + 1)
    const nextTray = replacePetSnack(snackTrayRef.current, snack.id)
    snackTrayRef.current = nextTray
    setSnackTray(nextTray)
    addFloater(snack.emoji)
  }

  // 首页把伙伴藏起来的人，等待页也只看小贴士
  if (hidden) {
    return (
      <View className='analyze-wait__card analyze-wait__tip'>
        <Text className='analyze-wait__eyebrow'>小贴士</Text>
        <Text className='analyze-wait__tip-text'>{tip}</Text>
      </View>
    )
  }

  const showingTip = !activeReaction && !stageFresh
  const petName = petDisplayName(pet?.name)

  return (
    <View className='analyze-wait__card waiting-pet'>
      <View className='waiting-pet__row'>
        <View
          className={`waiting-pet__avatar${pet ? ' is-in' : ''}${hopping ? ' is-hopping' : ''}`}
          role='button'
          aria-label={`摸摸${petName}`}
          onClick={handleTap}
        >
          {floaters.map(item => (
            <Text key={item.id} className='waiting-pet__floater'>{item.glyph}</Text>
          ))}
          <PetAvatar pet={pet} size={76} mood={mood} motion='companion' />
        </View>
        <View className='waiting-pet__bubble'>
          <Text className='waiting-pet__name'>{showingTip ? '小贴士' : petName}</Text>
          <Text className='waiting-pet__text'>{activeReaction || (stageFresh ? stage.text : tip)}</Text>
        </View>
      </View>
      <View className='waiting-pet__snacks'>
        <Text className='waiting-pet__snacks-label'>{snacksEaten >= PET_MAX_SNACKS ? '吃饱啦' : '喂它一口'}</Text>
        {snackTray.map(snack => (
          <View
            key={snack.id}
            className={`waiting-pet__snack${snacksEaten >= PET_MAX_SNACKS ? ' is-full' : ''}`}
            role='button'
            aria-label={`喂${snack.label}`}
            aria-disabled={snacksEaten >= PET_MAX_SNACKS}
            onClick={() => handleFeed(snack)}
          >
            <Text className='waiting-pet__snack-emoji'>{snack.emoji}</Text>
          </View>
        ))}
      </View>
    </View>
  )
}
