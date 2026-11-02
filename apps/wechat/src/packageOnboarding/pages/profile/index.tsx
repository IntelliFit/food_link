import { View, Text, Image, Input, Button, ScrollView } from '@tarojs/components'
import Taro, { useRouter } from '@tarojs/taro'
import { useEffect, useState } from 'react'
import { getHomeDashboard, updateHealthProfile } from '../../../utils/api'
import { experiments } from '../../../utils/experiments'
import {
  BODY_LIMITS,
  BRIEF_PENDING_KEY,
  FIRST_DAY_KEY,
  MOVE_TO_ACTIVITY,
  birthdayFromAge,
  localDateKey,
  missingBodyFields,
  parseBodySentence,
  type BodyFacts,
  type EatPlace,
  type MoveLevel,
  type OnboardingGoal,
} from '../../../utils/onboarding-v2'
import { HOME_BOTANICAL_BG_URL } from '../../../utils/static-asset-cdn-url'
import './index.scss'

const XIAOMAI = '/assets/pets/xiaomai-01.png'

const GOALS: Array<{ id: OnboardingGoal; label: string; reply: string }> = [
  { id: 'fat_loss', label: '减脂', reply: '好，按减脂来，不会让你饿着。' },
  { id: 'maintain', label: '保持体重', reply: '好，按保持体重来。' },
  { id: 'muscle_gain', label: '增肌', reply: '好，按增肌来，蛋白质我会盯着。' },
]
const EATS: Array<{ id: EatPlace; label: string }> = [
  { id: 'campus', label: '学校食堂' },
  { id: 'office', label: '公司附近' },
  { id: 'home', label: '自己做' },
  { id: 'takeout', label: '外卖为主' },
]
const MOVES: Array<{ id: MoveLevel; label: string }> = [
  { id: 'sedentary', label: '久坐为主' },
  { id: 'light', label: '走动较多' },
  { id: 'moderate', label: '经常站立' },
]

type Payoff = { target: number; eaten: number }

export default function OnboardingProfilePage() {
  const router = useRouter()
  const savedKcal = Math.max(0, Math.round(Number(router.params?.kcal) || 0))
  const [goal, setGoal] = useState<OnboardingGoal | 'skip' | null>(null)
  const [facts, setFacts] = useState<BodyFacts>({})
  const [bodyText, setBodyText] = useState('')
  const [bodyState, setBodyState] = useState<'asking' | 'confirming' | 'done' | 'skipped'>('asking')
  const [said, setSaid] = useState<string[]>([])
  const [eat, setEat] = useState<EatPlace | null>(null)
  const [move, setMove] = useState<MoveLevel | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveFailed, setSaveFailed] = useState(false)
  const [payoff, setPayoff] = useState<Payoff | null>(null)

  useEffect(() => { experiments.track('onboarding_profile_view', { saved_meal: savedKcal > 0 }) }, [savedKcal])

  const goalInfo = GOALS.find((g) => g.id === goal)
  const missing = missingBodyFields(facts)
  const step = !goal ? 1 : bodyState === 'asking' || bodyState === 'confirming' ? 2 : 3
  const lifeDone = Boolean(eat && move)

  const pickGoal = (id: OnboardingGoal | 'skip') => {
    setGoal(id)
    experiments.track('onboarding_profile_goal', { skipped: id === 'skip' })
  }

  const sendBody = () => {
    const text = bodyText.trim()
    if (!text) return
    const next = { ...facts, ...parseBodySentence(text) }
    setFacts(next)
    setSaid([...said, text])
    setBodyText('')
    if (missingBodyFields(next).length === 0) setBodyState('confirming')
  }

  const editFact = async (field: keyof BodyFacts) => {
    if (field === 'gender') {
      setFacts({ ...facts, gender: facts.gender === 'male' ? 'female' : 'male' })
      return
    }
    const labels = { age: '年龄（岁）', heightCm: '身高（cm）', weightKg: '体重（kg）' } as const
    const res = await Taro.showModal({
      title: `改一下${labels[field]}`,
      editable: true,
      placeholderText: String(facts[field] ?? ''),
    } as Taro.showModal.Option)
    const raw = String((res as { content?: string }).content || '').trim()
    const value = Number(raw)
    if (!res.confirm || !raw || !Number.isFinite(value)) return
    const [min, max] = BODY_LIMITS[field]
    if (value < min || value > max) {
      Taro.showToast({ title: `请填 ${min}–${max} 之间的数`, icon: 'none' })
      return
    }
    setFacts({ ...facts, [field]: value })
  }

  const finish = async () => {
    if (!eat || !move || saving) return
    setSaving(true)
    setSaveFailed(false)
    const bodyOk = bodyState === 'done' && missingBodyFields(facts).length === 0
    const activity = MOVE_TO_ACTIVITY[move]
    try {
      await updateHealthProfile({
        ...(bodyOk ? {
          gender: facts.gender,
          birthday: birthdayFromAge(facts.age as number),
          height: facts.heightCm,
          weight: facts.weightKg,
        } : { onboarding_status: 'skipped' as const }),
        diet_goal: goal === 'skip' || !goal ? 'maintain' : goal,
        activity_level: activity,
        daily_life_activity_level: activity,
        execution_mode: 'standard',
        is_student: eat === 'campus' ? true : undefined,
      })
      experiments.track('onboarding_profile_saved', { body: bodyOk })
      const dashboard = await getHomeDashboard().catch(() => null)
      const target = Math.round(Number(dashboard?.intakeData?.target) || 0)
      const eaten = Math.round(Number(dashboard?.intakeData?.current) || savedKcal)
      setPayoff(target > 0 ? { target, eaten } : null)
      try {
        Taro.setStorageSync(FIRST_DAY_KEY, localDateKey())
        Taro.setStorageSync(BRIEF_PENDING_KEY, '1')
      } catch { /* 只影响首页首日提示 */ }
    } catch (error) {
      console.error('[onboarding] save profile failed', error)
      setSaveFailed(true)
    } finally {
      setSaving(false)
    }
  }

  useEffect(() => { if (lifeDone && !payoff && !saveFailed) void finish() }, [lifeDone])

  const goHome = () => {
    experiments.track('onboarding_profile_done')
    Taro.switchTab({ url: '/pages/index/index' })
  }

  const bubble = (text: string, strong = false) => (
    <View className='obp-row'>
      <Image className='obp-avatar' src={XIAOMAI} mode='aspectFit' />
      <View className={`obp-bubble ${strong ? 'obp-bubble--strong' : ''}`}><Text>{text}</Text></View>
    </View>
  )
  const mine = (text: string) => <View className='obp-mine ob-fade'><Text>{text}</Text></View>

  return (
    <View className='obp'>
      <Image className='obp__bg' src={HOME_BOTANICAL_BG_URL} mode='aspectFill' />
      <View className='obp__head'>
        <Text className='obp__title'>认识一下你</Text>
        <Text className='obp__step'>3 句话，第 {step} 句</Text>
        <View className='obp__dots'>
          {[1, 2, 3].map((n) => <View key={n} className={`obp__dot ${n < step || (n === 3 && payoff) ? 'obp__dot--done' : n === step ? 'obp__dot--now' : ''}`} />)}
        </View>
      </View>

      <ScrollView className='obp__scroll' scrollY scrollIntoView={`obp-end-${step}-${bodyState}-${said.length}-${lifeDone}-${saving}-${Boolean(payoff)}`} scrollWithAnimation>
        <View className='obp__intro'>
          <Image className='obp__mascot ob-pop' src={XIAOMAI} mode='aspectFit' />
          <Text className='obp__big'>3 句话，30 秒</Text>
          <Text className='obp__sub'>答完我就知道你每天该吃多少</Text>
        </View>

        {bubble(savedKcal > 0 ? `存好啦！这一顿 ${savedKcal} kcal 已经在你的档案里。再回答我 3 句，我就能算出你每天该吃多少。` : '登录好啦！回答我 3 句，我就能算出你每天该吃多少。')}
        {bubble('① 你现在最想要哪个？', true)}
        {!goal && (
          <View className='obp-pad ob-fade'>
            <View className='obp-chips'>
              {GOALS.map((g) => <View key={g.id} className='ob-chip obp-chip--wide' onClick={() => pickGoal(g.id)}><Text>{g.label}</Text></View>)}
            </View>
            <Text className='obp-skip' onClick={() => pickGoal('skip')}>跳过，以后再说</Text>
          </View>
        )}

        {goal && (
          <>
            {mine(goalInfo ? goalInfo.label : '先跳过')}
            {bubble(`${goalInfo ? goalInfo.reply : '没关系，先按保持体重算。'}\n② 说一句你的身体情况就行，比如「女，22 岁，163，52 公斤」。`)}
            {said.map((s, i) => <View key={i}>{mine(s)}</View>)}
            {bodyState === 'asking' && said.length > 0 && missing.length > 0 && bubble(`还差${missing.join('、')}，补一句就行。`)}
            {bodyState === 'asking' && (
              <View className='obp-pad ob-fade'>
                <View className='obp-input'>
                  <Input className='obp-input__field' value={bodyText} placeholder='性别、年龄、身高、体重' maxlength={40} confirmType='send'
                    onInput={(e) => setBodyText(e.detail.value)} onConfirm={sendBody}
                  />
                  <Button className='obp-input__send' disabled={!bodyText.trim()} onClick={sendBody}>发送</Button>
                </View>
                <Text className='obp-skip' onClick={() => { setBodyState('skipped'); experiments.track('onboarding_profile_body_skip') }}>跳过，以后再说</Text>
              </View>
            )}
            {(bodyState === 'confirming' || bodyState === 'done') && (
              <View className='obp-row ob-fade'>
                <Image className='obp-avatar' src={XIAOMAI} mode='aspectFit' />
                <View className='obp-bubble obp-card'>
                  <Text className='obp-card__hint'>我听到的是（点一下能改）</Text>
                  <View className='obp-facts'>
                    <View className='obp-fact' onClick={() => void editFact('gender')}><Text>{facts.gender === 'male' ? '男' : '女'}</Text></View>
                    <View className='obp-fact' onClick={() => void editFact('age')}><Text>{facts.age} 岁</Text></View>
                    <View className='obp-fact' onClick={() => void editFact('heightCm')}><Text>{facts.heightCm} cm</Text></View>
                    <View className='obp-fact' onClick={() => void editFact('weightKg')}><Text>{facts.weightKg} kg</Text></View>
                  </View>
                  {bodyState === 'confirming' && (
                    <Button className='obp-confirm' onClick={() => { setBodyState('done'); experiments.track('onboarding_profile_body') }}>对，就这样</Button>
                  )}
                </View>
              </View>
            )}
            {bodyState === 'skipped' && bubble('没关系，我先按一般成年人的量算，之后随时告诉我就行。')}
          </>
        )}

        {(bodyState === 'done' || bodyState === 'skipped') && (
          <>
            {bubble('③ 最后一句：平时在哪吃饭？平时动得多吗？', true)}
            {!lifeDone && (
              <View className='obp-pad ob-fade'>
                <View className='obp-grid obp-grid--2'>
                  {EATS.map((e) => <View key={e.id} className={`ob-chip obp-grid__chip ${eat === e.id ? 'ob-chip--on' : ''}`} onClick={() => setEat(e.id)}><Text>{e.label}</Text></View>)}
                </View>
                <View className='obp-grid obp-grid--3'>
                  {MOVES.map((m) => <View key={m.id} className={`ob-chip obp-grid__chip ${move === m.id ? 'ob-chip--on' : ''}`} onClick={() => setMove(m.id)}><Text>{m.label}</Text></View>)}
                </View>
              </View>
            )}
            {lifeDone && mine(`${EATS.find((e) => e.id === eat)?.label} · ${MOVES.find((m) => m.id === move)?.label}`)}
            {lifeDone && saving && bubble('我在算…')}
            {lifeDone && saveFailed && (
              <View className='obp-pad'>
                {bubble('没存上，网络可能不太好。')}
                <Button className='ob-btn ob-btn--primary' onClick={() => void finish()}>再试一次</Button>
              </View>
            )}
            {payoff && (
              <View className='obp-row ob-fade'>
                <Image className='obp-avatar' src={XIAOMAI} mode='aspectFit' />
                <View className='obp-bubble obp-card'>
                  <Text>记住了。{eat === 'campus' ? '以后推荐只挑你学校食堂里能买到的，进首页选一下学校就行。' : '以后推荐只挑你身边买得到的。'}</Text>
                  <View className='obp-pay'>
                    <Text className='obp-pay__line'>你每天大约 <Text className='obp-pay__big'>{payoff.target.toLocaleString('en-US')}</Text> kcal</Text>
                    <View className='obp-pay__bar'><View className='obp-pay__fill' style={{ width: `${Math.min(100, Math.round((payoff.eaten / payoff.target) * 100))}%` }} /></View>
                    <Text className='obp-pay__note'>今天已吃 {payoff.eaten} kcal，还能吃 {Math.max(0, payoff.target - payoff.eaten).toLocaleString('en-US')} kcal</Text>
                  </View>
                  <Text className='obp-card__hint'>作息、过敏这些，用得上的时候我再问你。</Text>
                </View>
              </View>
            )}
            {lifeDone && !saving && !saveFailed && (
              <View className='obp-pad ob-fade'>
                <Button className='ob-btn ob-btn--primary' onClick={goHome}>去看我的今天</Button>
              </View>
            )}
          </>
        )}
        <View id={`obp-end-${step}-${bodyState}-${said.length}-${lifeDone}-${saving}-${Boolean(payoff)}`} className='obp__end' />
      </ScrollView>
    </View>
  )
}
