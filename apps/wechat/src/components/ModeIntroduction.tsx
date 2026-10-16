import { Button, PageMeta, ScrollView, Swiper, SwiperItem, Text, View } from '@tarojs/components'
import Taro, { useDidHide, useDidShow } from '@tarojs/taro'
import { useCallback, useEffect, useRef, useState } from 'react'
import { BALANCED_THEME_DEFINITIONS } from '../utils/balanced-theme'
import { applyThemeNavigationBar } from '../utils/theme-navigation-bar'
import { getStoredAppColorScheme } from '../utils/app-color-scheme'
import { INTRODUCTION_CHOICE_RECTS, INTRODUCTION_FEATURES, INTRODUCTION_RADIOS, MODE_INTRODUCTION_CHAPTERS, type ModeIntroductionChoice } from '../utils/mode-introduction-chapters'
import { ModeIntroMedia } from './ModeIntroMedia'
import { ModeIntroArtwork } from './ModeIntroArtwork'
import { ModeIntroductionUpdates, MODE_INTRODUCTION_UPDATES } from './ModeIntroductionUpdates'
import { cover } from '../mode-introduction-assets.json'
import './ModeIntroduction.scss'

const choices = MODE_INTRODUCTION_CHAPTERS.slice(0, 9)
const position = ([x, y, width, height]: readonly number[]) => ({ left: `${x / 853 * 100}%`, top: `${y / 1844 * 100}%`, width: `${width / 853 * 100}%`, height: `${height / 1844 * 100}%` })

export function ModeIntroduction({ onConfirm }: { onConfirm: (choice: ModeIntroductionChoice) => boolean | Promise<boolean> }) {
  const [step, setStep] = useState(-1), [selected, setSelected] = useState<number | null>(null), [paused, setPaused] = useState(false), [attempt, setAttempt] = useState(0)
  const [error, setError] = useState(''), [mediaError, setMediaError] = useState(''), [busy, setBusy] = useState(false), [foreground, setForeground] = useState(true)
  const confirming = useRef(false), owner = useRef(''), live = useRef(true), swipeConsumed = useRef(false)
  const chapter = MODE_INTRODUCTION_CHAPTERS[Math.max(0, step)], identity = `${step}:${attempt}`
  const background = step < 0 ? cover.background : chapter.background
  owner.current = identity
  const [layout] = useState(() => {
    try {
      const info = Taro.getSystemInfoSync(), capsule = Taro.getMenuButtonBoundingClientRect?.()
      const inset = Math.max(Number(info.statusBarHeight || 0) + 44, Number(capsule?.bottom || 0) + 8)
      const width = Number(info.windowWidth || 390), height = Number(info.windowHeight || 844), bottom = Math.max(8, height - Number(info.safeArea?.bottom || height))
      const frameWidth = Math.min(width, Math.max(200, height - inset - bottom) * 853 / 1844)
      return { inset, width: frameWidth, height: frameWidth * 1844 / 853 }
    } catch { return { inset: 88, width: 332, height: 718 } }
  })
  useEffect(() => { Taro.setNavigationBarColor?.({ frontColor: chapter.dark ? '#ffffff' : '#000000', backgroundColor: background })?.catch(() => undefined) }, [chapter.dark, background])
  useEffect(() => { live.current = true; return () => { live.current = false; owner.current = ''; applyThemeNavigationBar(getStoredAppColorScheme()) } }, [])
  useDidHide(() => setForeground(false))
  useDidShow(() => setForeground(true))
  const changeStep = (index: number) => {
    if (confirming.current) return
    owner.current = ''; setStep(Math.max(-1, Math.min(9, index))); setAttempt(0); setMediaError(''); setError(''); setPaused(false)
  }
  const fail = useCallback((message: string) => { if (live.current && owner.current === identity) { setMediaError(message); setPaused(true) } }, [identity])
  const choose = (index: number) => { if (!confirming.current && !swipeConsumed.current) { setSelected(index); setError(''); setPaused(true) } }
  const confirm = async () => {
    if (!live.current || owner.current !== identity || step !== 9 || selected === null || confirming.current || swipeConsumed.current) return
    confirming.current = true; setBusy(true); setError('')
    let saved = false
    try { saved = await onConfirm(choices[selected].choice); if (!saved && live.current) setError('默认体验未能保存，请检查登录状态后重试。') }
    catch (reason) { if (live.current) setError(reason instanceof Error ? reason.message : '默认体验未能保存，请稍后重试。') }
    finally { confirming.current = saved; if (live.current) setBusy(false) }
  }
  const details = () => {
    setPaused(true)
    if (step < 0) {
      void Taro.showModal({ title: '食探更新速递', content: MODE_INTRODUCTION_UPDATES.map(item => `${item.title}\n${item.body}`).join('\n\n'), showCancel: false, confirmText: '知道了' })
      return
    }
    const index = step === 9 ? selected : step
    if (index === null) return
    void Taro.showModal({ title: choices[index].title, content: `${INTRODUCTION_FEATURES[index].join(' · ')}\n\n${index < 8 ? BALANCED_THEME_DEFINITIONS[index].audience : '适合偏爱东方审美与舒缓阅读的你。'}\n\n各主题共用饮食、饮水、体重与运动记录。切换不会清空已有内容。`, showCancel: false, confirmText: '知道了' })
  }
  return <View id='mode-introduction' className={`mode-introduction${chapter.dark ? ' is-dark' : ''}`} style={{ backgroundColor: background, color: chapter.dark ? '#f7f1df' : '#172d22', paddingTop: `${layout.inset}px` }}>
    <PageMeta pageStyle='overflow: hidden;' />
    <View className='mode-introduction__toolbar' style={{ top: `${layout.inset - 48}px` }}>
      {step > -1 && <Button className='mode-introduction__toolbar-button' id='mode-introduction-back' onClick={() => changeStep(step - 1)} disabled={busy}>{step === 0 ? '更新' : '上一章'}</Button>}
      <Button className='mode-introduction__toolbar-button' id='mode-introduction-details' onClick={details} disabled={step === 9 && selected === null}>介绍</Button>
      <Button className='mode-introduction__toolbar-button' id='mode-introduction-pause' aria-label={paused ? '继续播放动画' : '暂停动画'} onClick={() => setPaused(!paused)} disabled={busy}>{paused ? '继续' : '暂停'}</Button>
      {step < 9 && <Button className='mode-introduction__toolbar-button' id='mode-introduction-next' aria-label={step < 0 ? '认识九种主题' : step === 8 ? '查看全部主题' : '下一章'} onClick={() => changeStep(step + 1)} disabled={busy}>{step < 0 ? '看主题' : step === 8 ? '选择' : '下一章'}</Button>}
    </View>
    <Swiper id='mode-introduction-swiper' className='mode-introduction__swiper' style={{ width: `${layout.width}px`, height: `${layout.height}px` }} current={step + 1} duration={320} indicatorDots={false} disableTouch={busy}
      onTouchStart={() => { swipeConsumed.current = false }} onTransition={event => { if (Math.abs(event.detail.dx) > 8) swipeConsumed.current = true }}
      onChange={event => { if (event.detail.current !== step + 1 && !confirming.current) changeStep(event.detail.current - 1) }}
    >
      <SwiperItem key='updates'>
        <View id='mode-introduction-updates' className='mode-introduction__frame' style={{ width: `${layout.width}px`, height: `${layout.height}px`, backgroundColor: cover.background }} aria-label='食探更新速递'>
          {step < 1 && <ModeIntroductionUpdates key={identity} active={step < 0} paused={paused || !foreground} attempt={attempt} error={step < 0 ? mediaError : ''} onError={fail} onRetry={() => { setMediaError(''); setAttempt(attempt + 1); setPaused(false) }} />}
        </View>
      </SwiperItem>
      {MODE_INTRODUCTION_CHAPTERS.map((item, index) => <SwiperItem key={item.file}>
        <View id={`mode-introduction-chapter-${index}`} className={`mode-introduction__frame${index < 9 ? ' is-chapter' : ''}`} style={{ width: `${layout.width}px`, height: `${layout.height}px`, backgroundColor: item.background }} aria-label={index < 9 ? `${item.title}。${INTRODUCTION_FEATURES[index].join('，')}` : '选择默认体验：八个均衡主题和阴阳养生主题'}>
          <View className='mode-introduction__media-window' style={{ height: `${layout.height * item.frameHeight / 1384}px` }}>
            <View className='mode-introduction__media-canvas'>
              {index === step ? !mediaError && <ModeIntroMedia key={identity} chapter={item} attempt={attempt} paused={paused || !foreground} onError={fail} /> : Math.abs(step - index) <= 1 && <ModeIntroArtwork chapter={item} attempt={0} motion={false} onPosterLoad={() => undefined} onMediaReady={() => undefined} onError={() => undefined} />}
            </View>
          </View>
          {index < 9 && <View className='mode-introduction__swipe-hint'><Text>‹</Text><Text>左右滑动，切换主题</Text><Text>›</Text></View>}
          {index === step && <>
      {mediaError && <ScrollView scrollY className='mode-introduction__fallback-scroll'><View className='mode-introduction__fallback'>
        <Text className='mode-introduction__fallback-title'>{chapter.title}</Text>
        {step < 9 ? <><Text>{INTRODUCTION_FEATURES[step].join('\n\n')}</Text><Text>{step < 8 ? BALANCED_THEME_DEFINITIONS[step].audience : '适合偏爱东方审美与舒缓阅读的你。'}</Text></> : choices.map((item, i) => <Button className='mode-introduction__fallback-button' key={item.file} onClick={() => choose(i)}>{item.title}{selected === i ? ' · 已选择' : ''}</Button>)}
        <Text>{mediaError}</Text><Button className='mode-introduction__fallback-button' id='mode-introduction-retry' onClick={() => { setMediaError(''); setAttempt(attempt + 1); setPaused(false) }}>重试动画</Button>
      </View></ScrollView>}
      {step === 9 && <>
        {!mediaError && choices.map((item, i) => <Button key={item.file} id={`mode-introduction-${i === 8 ? 'wellness' : item.choice.mode === 'balanced' ? item.choice.theme : i}`} className={`mode-introduction__choice${selected === i ? ' is-selected' : ''}`} style={position(INTRODUCTION_CHOICE_RECTS[i])} aria-label={`选择${item.title}`} aria-pressed={selected === i} disabled={busy} onClick={() => choose(i)}>
          {selected === i && <View className='mode-introduction__selected-dot' style={{ left: `${(INTRODUCTION_RADIOS[i][0] - INTRODUCTION_CHOICE_RECTS[i][0]) / INTRODUCTION_CHOICE_RECTS[i][2] * 100}%`, top: `${(INTRODUCTION_RADIOS[i][1] - INTRODUCTION_CHOICE_RECTS[i][1]) / INTRODUCTION_CHOICE_RECTS[i][3] * 100}%`, width: `${14 / INTRODUCTION_CHOICE_RECTS[i][2] * 100}%`, height: `${14 / INTRODUCTION_CHOICE_RECTS[i][3] * 100}%` }} />}
        </Button>)}
        <Button id='mode-introduction-replay' className='mode-introduction__replay' style={position([628, 21, 185, 68])} aria-label='重新观看全部介绍' onClick={() => { if (!swipeConsumed.current) { setSelected(null); changeStep(-1) } }} disabled={busy} />
        {selected !== null && <View className='mode-introduction__selection-hint' style={position([60, 1587, 735, 42])}><Text>已选择：{choices[selected].title}</Text></View>}
        <Button id='mode-introduction-next' className={`mode-introduction__confirm${selected !== null ? ' is-enabled' : ''}`} style={position([60, 1633, 735, 92])} loading={busy} disabled={selected === null || busy} aria-label='选定主题，开启食探' onClick={confirm}>{selected !== null ? '选定主题，开启食探' : ''}</Button>
      </>}
      {error && <View className='mode-introduction__error' role='alert'><Text>{error}</Text></View>}
          </>}
        </View>
      </SwiperItem>)}
    </Swiper>
  </View>
}
