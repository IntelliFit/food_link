import { View, Text, Image, Input, Button, ScrollView } from '@tarojs/components'
import Taro, { useDidShow, useRouter } from '@tarojs/taro'
import { useEffect, useRef, useState } from 'react'
import {
  imageToBase64,
  saveFoodRecord,
  uploadAnalyzeImage,
} from '../../../utils/api'
import { buildFoodRecordItemPayloadFromAnalyzeItem } from '../../../utils/food-record-item-payload'
import { inferDefaultMealTypeFromLocalTime } from '../../../utils/infer-default-meal-type'
import { chooseImageWithPrivacy } from '../../../utils/weapp-privacy'
import { extraPkgUrl } from '../../../utils/subpackage-extra'
import { experiments } from '../../../utils/experiments'
import {
  getOnboardingStats,
  getOnboardingTrustConfig,
  onboardingPhoneLogin,
  tryAnalyzeMeal,
  type OnboardingStats,
  type OnboardingTrustConfig,
  type OnboardingTryResult,
} from '../../../utils/onboarding-api'
import { formatTrustCount, localDateKey, WELCOME_DONE_KEY } from '../../../utils/onboarding-v2'
import { TrustBadges } from '../../../components/TrustBadges'
import { HOME_BOTANICAL_BG_URL } from '../../../utils/static-asset-cdn-url'
import './index.scss'

const XIAOMAI = '/assets/pets/xiaomai-01.png'
const CORRECTION_HINTS = ['份量只吃了一半', '还有一样没认出来：', '名字认错了，其实是']
const STAGGER_MS = 420

type Phase = 'intro' | 'analyzing' | 'result' | 'failed'

const kcalOf = (item: { nutrients?: { calories?: number } }) => Math.round(Number(item.nutrients?.calories) || 0)
const gramsOf = (item: { estimatedWeightGrams?: number; originalWeightGrams?: number }) =>
  Math.round(Number(item.estimatedWeightGrams || item.originalWeightGrams) || 0)

export default function OnboardingTryPage() {
  const router = useRouter()
  const [phase, setPhase] = useState<Phase>('intro')
  const [imagePath, setImagePath] = useState('')
  const [result, setResult] = useState<OnboardingTryResult | null>(null)
  const [shown, setShown] = useState(0)
  const [note, setNote] = useState('')
  const [correcting, setCorrecting] = useState(false)
  const [corrected, setCorrected] = useState(false)
  const [failure, setFailure] = useState({ message: '', needsLogin: false })
  const [sheet, setSheet] = useState<'closed' | 'save' | 'login'>('closed')
  const [agreed, setAgreed] = useState(false)
  const [nudge, setNudge] = useState(0)
  const [busy, setBusy] = useState(false)
  const [config, setConfig] = useState<OnboardingTrustConfig>({ badges: [], source_lines: [], result_line: '' })
  const [stats, setStats] = useState<OnboardingStats | null>(null)
  const base64Ref = useRef('')
  const correctingRef = useRef(false)
  const loggingInRef = useRef(false)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    experiments.track('onboarding_try_view', { from: router.params?.sheet || 'photo' })
    if (router.params?.sheet === 'login') setSheet('login')
    void getOnboardingTrustConfig().then(setConfig)
    void getOnboardingStats().then(setStats)
    return () => { if (timerRef.current) clearInterval(timerRef.current) }
  }, [])

  useDidShow(() => {
    try { Taro.setStorageSync(WELCOME_DONE_KEY, '1') } catch { /* 只影响首屏是否再弹 */ }
  })

  const items = result?.items || []
  const total = items.reduce((sum, it) => sum + kcalOf(it), 0)
  const done = phase === 'result' && shown >= items.length

  const reveal = (next: OnboardingTryResult) => {
    if (timerRef.current) clearInterval(timerRef.current)
    setResult(next)
    setShown(0)
    setPhase('result')
    timerRef.current = setInterval(() => {
      setShown((n) => {
        if (n + 1 >= next.items.length && timerRef.current) clearInterval(timerRef.current)
        return n + 1
      })
    }, STAGGER_MS)
  }

  const fail = (error: unknown) => {
    const code = Number((error as { statusCode?: number })?.statusCode)
    const message = error instanceof Error ? error.message : ''
    experiments.track('onboarding_try_error', { status: Number.isFinite(code) ? code : 0 })
    setFailure({
      message: code === 429 ? (message || '今天的免费体验次数用完了') : '这张没认出来，换个角度再拍一张试试',
      needsLogin: code === 429,
    })
    setPhase('failed')
  }

  const pick = async (sourceType: 'camera' | 'album') => {
    try {
      const picked = await chooseImageWithPrivacy({ count: 1, sizeType: ['compressed'], sourceType: [sourceType] })
      const path = picked.tempFilePaths?.[0]
      if (!path) return
      experiments.track('onboarding_try_photo', { source: sourceType })
      setImagePath(path)
      setPhase('analyzing')
      setCorrected(false)
      const compressed = await Taro.compressImage({ src: path, quality: 60 }).catch(() => ({ tempFilePath: path }))
      base64Ref.current = await imageToBase64(compressed.tempFilePath)
      const next = await tryAnalyzeMeal({ base64Image: base64Ref.current })
      if (!next.items.length) {
        fail(new Error('empty'))
        return
      }
      experiments.track('onboarding_try_result', { items: next.items.length })
      reveal(next)
    } catch (error) {
      const msg = String((error as { errMsg?: string })?.errMsg || '')
      if (msg.includes('cancel')) {
        setPhase(result ? 'result' : 'intro')
        return
      }
      fail(error)
    }
  }

  const correct = async () => {
    const text = note.trim()
    if (!text || !result || correctingRef.current) return
    correctingRef.current = true
    setCorrecting(true)
    try {
      const next = await tryAnalyzeMeal({ base64Image: base64Ref.current, note: text, previous: result })
      experiments.track('onboarding_try_correction', { length: text.length })
      setNote('')
      setCorrected(true)
      setResult({ ...next, items: next.items.length ? next.items : result.items })
      setShown(Math.max(next.items.length, result.items.length))
    } catch (error) {
      Taro.showToast({ title: error instanceof Error && error.message ? error.message : '没改成功，再说一次试试', icon: 'none' })
    } finally {
      correctingRef.current = false
      setCorrecting(false)
    }
  }

  const openSheet = (mode: 'save' | 'login') => {
    experiments.track('onboarding_save_open', { mode })
    setSheet(mode)
  }

  /** 返回新记录的 id，建档页用它取「这一顿让今天变了什么」 */
  const saveRecord = async (): Promise<string> => {
    if (!result) return ''
    const { imageUrl } = await uploadAnalyzeImage(base64Ref.current)
    const sum = (key: 'calories' | 'protein' | 'carbs' | 'fat') =>
      Math.round(result.items.reduce((s, it) => s + (Number(it.nutrients?.[key]) || 0), 0) * 10) / 10
    const saved = await saveFoodRecord({
      date: localDateKey(),
      meal_type: inferDefaultMealTypeFromLocalTime(),
      image_path: imageUrl,
      description: result.description || undefined,
      insight: result.insight || undefined,
      items: result.items.map(buildFoodRecordItemPayloadFromAnalyzeItem),
      total_calories: sum('calories'),
      total_protein: sum('protein'),
      total_carbs: sum('carbs'),
      total_fat: sum('fat'),
      total_weight_grams: result.items.reduce((s, it) => s + gramsOf(it), 0),
      entry_type: 'food_image',
    })
    return String(saved?.id || '')
  }

  const onPhone = async (e: { detail?: { code?: string } }) => {
    const phoneCode = String(e.detail?.code || '').trim()
    if (!phoneCode || loggingInRef.current) {
      if (!phoneCode) Taro.showToast({ title: '授权手机号后才能保存', icon: 'none' })
      return
    }
    loggingInRef.current = true
    setBusy(true)
    try {
      const { onboardingCompleted } = await onboardingPhoneLogin(phoneCode)
      experiments.track('onboarding_login_success', { returning: onboardingCompleted })
      let saved = false
      let recordId = ''
      if (sheet === 'save' && result) {
        try {
          recordId = await saveRecord()
          saved = true
          experiments.track('onboarding_record_saved')
        } catch (error) {
          console.error('[onboarding] save record failed', error)
          Taro.showToast({ title: '这一顿没存上，进去后可以重新拍', icon: 'none' })
        }
      }
      if (onboardingCompleted) {
        Taro.switchTab({ url: '/pages/index/index' })
        return
      }
      const recordQuery = recordId ? `&record=${encodeURIComponent(recordId)}` : ''
      Taro.redirectTo({ url: `/packageOnboarding/pages/profile/index?kcal=${saved ? total : 0}${recordQuery}` })
    } catch (error) {
      console.error('[onboarding] login failed', error)
      Taro.showToast({ title: error instanceof Error && error.message ? error.message : '登录失败，请重试', icon: 'none' })
    } finally {
      loggingInRef.current = false
      setBusy(false)
    }
  }

  const estimated = items.filter((it) => it.nutrition_source_label === 'AI 估算').length
  const status = phase === 'analyzing'
    ? '我在看这一顿…'
    : corrected
      ? `按你说的改好了，这一顿一共 ${total} kcal。`
      : done
        ? estimated === 0
          ? `认出 ${items.length} 样，营养都对照了食物库里的数据。份量是我估的，不对直接说～`
          : `认出 ${items.length} 样。标「AI 估算」的是我估的，其余对照了食物库。不对直接说～`
        : '我在看这一顿…'

  return (
    <View className='ob-try'>
      <Image className='ob-try__bg' src={HOME_BOTANICAL_BG_URL} mode='aspectFill' />

      {phase === 'intro' && (
        <View className='ob-try__intro'>
          <Image className='ob-try__mascot ob-pop' src={XIAOMAI} mode='aspectFit' />
          <View className='ob-bubble'><Text>对准你眼前这一顿拍一张，{'\n'}我马上告诉你吃了多少。</Text></View>
          <Button className='ob-btn ob-btn--primary' onClick={() => void pick('camera')}>拍一下这顿</Button>
          <Button className='ob-btn ob-btn--ghost' onClick={() => void pick('album')}>从相册选一张</Button>
          <Text className='ob-try__fine'>不用注册就能试，存下来时才需要登录</Text>
        </View>
      )}

      {phase !== 'intro' && (
        <ScrollView className='ob-try__scroll' scrollY>
          <View className='ob-try__photo'>
            {imagePath && <Image className='ob-try__img' src={imagePath} mode='aspectFill' />}
            {phase === 'analyzing' && <View className='ob-try__scan' />}
          </View>

          <View className='ob-try__say'>
            <Image className='ob-try__avatar' src={XIAOMAI} mode='aspectFit' />
            <View className='ob-bubble ob-bubble--left'><Text>{phase === 'failed' ? failure.message : status}</Text></View>
          </View>

          {phase === 'failed' && (
            <View className='ob-try__actions'>
              {failure.needsLogin
                ? <Button className='ob-btn ob-btn--primary' onClick={() => openSheet('login')}>登录后继续识别</Button>
                : <Button className='ob-btn ob-btn--primary' onClick={() => void pick('camera')}>再拍一张</Button>}
            </View>
          )}

          {phase === 'result' && items.slice(0, shown).map((it, i) => (
            <View className='ob-item ob-fade' key={`${it.name}-${i}`}>
              <View className='ob-item__row'>
                <Text className='ob-item__name'>{it.name} <Text className='ob-item__weight'>约 {gramsOf(it)}g</Text></Text>
                <Text className='ob-item__kcal'>{kcalOf(it)} <Text className='ob-item__unit'>kcal</Text></Text>
              </View>
              <Text className='ob-item__source'>营养：{it.nutrition_source_label || '食探标准食物库'}{it.matched_food_name ? ` · ${it.matched_food_name}` : ''}</Text>
            </View>
          ))}

          {done && (
            <View className='ob-total ob-fade'>
              <Text>这一顿合计</Text>
              <Text className='ob-total__kcal'>{total} kcal</Text>
            </View>
          )}
          {done && config.result_line && <Text className='ob-try__claim'>{config.result_line}</Text>}
          <View className='ob-try__spacer' />
        </ScrollView>
      )}

      {phase === 'result' && done && (
        <View className='ob-try__dock'>
          {!corrected && (
            <ScrollView className='ob-try__chips' scrollX>
              {CORRECTION_HINTS.map((hint) => (
                <View key={hint} className='ob-chip' onClick={() => setNote(hint)}><Text>{hint}</Text></View>
              ))}
            </ScrollView>
          )}
          <View className='ob-try__input'>
            <Input className='ob-try__field' value={note} placeholder='哪里不对，直接说' maxlength={60}
              onInput={(e) => setNote(e.detail.value)} onConfirm={() => void correct()} confirmType='send'
            />
            <Button className='ob-try__send' disabled={!note.trim() || correcting} loading={correcting} onClick={() => void correct()}>改一下</Button>
          </View>
          <Button className='ob-btn ob-btn--primary' onClick={() => openSheet('save')}>存进我的饮食档案</Button>
        </View>
      )}

      {sheet !== 'closed' && (
        <View className='ob-sheet-mask' onClick={() => !busy && setSheet('closed')}>
          <View className='ob-sheet' onClick={(e) => e.stopPropagation()}>
            <Image className='ob-sheet__mascot ob-pop' src={XIAOMAI} mode='aspectFit' />
            <Text className='ob-sheet__title'>{sheet === 'save' ? '存下来，以后我帮你记着' : '登录一下，接着帮你认'}</Text>
            <Text className='ob-sheet__desc'>登录后这一顿就进了你的饮食档案，我也能按你的情况算每天该吃多少。</Text>
            <View className='ob-sheet__list'>
              <Text>✓ 每一顿自动算热量和营养</Text>
              <Text>✓ 按你身边买得到的，推荐下一顿</Text>
              <Text>✓ 换手机也不丢</Text>
            </View>
            <TrustBadges badges={config.badges} />
            {stats && stats.users >= 100 && (
              <Text className='ob-sheet__proof'>已有 {formatTrustCount(stats.users)} 人用食探记了 {formatTrustCount(stats.food_records)} 顿饭</Text>
            )}
            <View className={`ob-agree ${nudge ? 'ob-shake' : ''}`} key={nudge} onClick={() => setAgreed(!agreed)}>
              <View className={`ob-agree__box ${agreed ? 'ob-agree__box--on' : ''}`}>{agreed && <Text>✓</Text>}</View>
              <Text className='ob-agree__text'>
                我已阅读并同意
                <Text className='ob-link' onClick={(e) => { e.stopPropagation(); Taro.navigateTo({ url: extraPkgUrl('/pages/agreement/index') }) }}>《用户服务协议》</Text>、
                <Text className='ob-link' onClick={(e) => { e.stopPropagation(); Taro.navigateTo({ url: extraPkgUrl('/pages/membership-agreement/index') }) }}>《会员服务协议》</Text>和
                <Text className='ob-link' onClick={(e) => { e.stopPropagation(); Taro.navigateTo({ url: extraPkgUrl('/pages/privacy/index') }) }}>《隐私政策》</Text>
              </Text>
            </View>
            {nudge > 0 && !agreed && <Text className='ob-agree__warn'>先勾选同意，才能登录保存哦</Text>}
            {agreed
              ? <Button className='ob-btn ob-btn--primary' openType='getPhoneNumber' onGetPhoneNumber={onPhone} loading={busy} disabled={busy}>微信手机号一键登录</Button>
              : <Button className='ob-btn ob-btn--primary' onClick={() => setNudge(nudge + 1)}>微信手机号一键登录</Button>}
            <Button className='ob-btn ob-btn--text' disabled={busy} onClick={() => setSheet('closed')}>先不存，回去看看</Button>
          </View>
        </View>
      )}
    </View>
  )
}
