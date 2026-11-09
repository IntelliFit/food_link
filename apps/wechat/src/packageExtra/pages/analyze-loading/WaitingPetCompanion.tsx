import { Text, View } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { useEffect, useRef, useState } from 'react'
import { PetAvatar } from '../../../components/PetAvatar'
import { getPetSummary, type PetProfile } from '../../../utils/api'
import {
  PET_MAX_SNACKS,
  PET_SNACKS,
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
const FALLBACK_PET: Partial<PetProfile> = { builtin_avatar_id: 'jianwen-01', name: '小伙伴' }
const STAGE_LINE_MS = 5000
const REACTION_MS = 3500
const HOP_MS = 520
const FLOATER_MS = 900

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
  const tapCountRef = useRef(0)
  const nextFloaterRef = useRef(0)
  const reactionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const floaterTimersRef = useRef<Array<ReturnType<typeof setTimeout>>>([])

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
    setFloaters(prev => [...prev, { id, glyph }])
    floaterTimersRef.current = [
      ...floaterTimersRef.current,
      setTimeout(() => setFloaters(prev => prev.filter(item => item.id !== id)), FLOATER_MS),
    ]
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
    say(petSnackLine(snack, snacksEaten))
    if (snacksEaten >= PET_MAX_SNACKS) return
    setSnacksEaten(prev => prev + 1)
    addFloater(snack.emoji)
  }

  if (hidden) {
    return (
      <View className='game-tip-container'>
        <View className='game-tip-box'>
          <Text className='game-tip-label'>小贴士</Text>
          <Text className='game-tip-text'>{tip}</Text>
        </View>
      </View>
    )
  }

  const showingTip = !activeReaction && !stageFresh

  return (
    <View className='waiting-pet'>
      <View className='waiting-pet__row'>
        <View
          className={`waiting-pet__avatar${pet ? ' is-in' : ''}${hopping ? ' is-hopping' : ''}`}
          role='button'
          aria-label={`摸摸${pet?.name || '小伙伴'}`}
          onClick={handleTap}
        >
          {floaters.map(item => (
            <Text key={item.id} className='waiting-pet__floater'>{item.glyph}</Text>
          ))}
          <PetAvatar pet={pet} size={76} mood={mood} motion='companion' />
        </View>
        <View className='waiting-pet__bubble'>
          <Text className='waiting-pet__name'>{showingTip ? '小贴士' : (pet?.name || '小伙伴')}</Text>
          <Text className='waiting-pet__text'>{activeReaction || (stageFresh ? stage.text : tip)}</Text>
        </View>
      </View>
      <View className='waiting-pet__snacks'>
        <Text className='waiting-pet__snacks-label'>喂它一口</Text>
        {PET_SNACKS.map(snack => (
          <View
            key={snack.id}
            className='waiting-pet__snack'
            role='button'
            aria-label={`喂${snack.label}`}
            onClick={() => handleFeed(snack)}
          >
            <Text className='waiting-pet__snack-emoji'>{snack.emoji}</Text>
          </View>
        ))}
      </View>
    </View>
  )
}
