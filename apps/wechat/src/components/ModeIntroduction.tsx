import { Button, PageMeta, ScrollView, Swiper, SwiperItem, Text, View } from '@tarojs/components'
import { useEffect, useRef, useState } from 'react'
import Taro from '@tarojs/taro'
import type { HomeExperienceMode } from '../utils/home-experience'
import { applyThemeNavigationBar } from '../utils/theme-navigation-bar'
import { getStoredAppColorScheme } from '../utils/app-color-scheme'
import './ModeIntroduction.scss'

const INTRODUCTIONS = [
  {
    mode: 'balanced', title: '均衡模式', lead: '用清晰的数据，照顾每一餐。', audience: '喜欢明确数字与目标，希望快速记录、直观看到日常变化的你。',
    features: [
      ['饮食与营养，一目了然', '拍照或手动记录饮食，查看热量余量、蛋白质、碳水和脂肪。'],
      ['把一天连成自己的趋势', '结合饮食、饮水、体重与运动记录，回顾自己的日常节奏。'],
      ['八种主题，同一份记录', '澄明、自然、东方、艺廊、微缩、绘本、关怀与水之道，可在“我的”更换。'],
    ],
  },
  {
    mode: 'wellness', title: '养生模式', lead: '一餐一饮，皆有平衡。', audience: '喜欢东方审美与舒缓阅读，希望通过持续记录了解生活习惯的你。',
    features: [
      ['纸墨之间，记录一餐一饮', '以水墨和留白呈现饮食日常，用更舒缓的视觉节奏开始记录。'],
      ['看见习惯，也看见变化', '结合健康指数、热量分布与阶段回顾，观察饮食与生活的节律。'],
      ['熟悉的功能，另一种表达', '继续使用饮食、饮水、体重与运动记录；切换模式不会清空已有内容。'],
    ],
  },
] as const

/** A user-paced introduction: animations explain the modes; only the final confirmation saves. */
export function ModeIntroduction({ onConfirm }: { onConfirm: (mode: HomeExperienceMode) => boolean | Promise<boolean> }) {
  const [step, setStep] = useState(0)
  const [selected, setSelected] = useState<HomeExperienceMode | null>(null)
  const [error, setError] = useState('')
  const [headerInset] = useState(() => {
    try {
      const info = Taro.getSystemInfoSync()
      const capsule = Taro.getMenuButtonBoundingClientRect?.()
      return Math.max(Number(info.statusBarHeight || 0) + 48, Number(capsule?.bottom || 0) + 12)
    } catch { return 88 }
  })
  const confirming = useRef(false)
  useEffect(() => {
    Taro.setNavigationBarColor?.({ frontColor: '#000000', backgroundColor: '#f7f7f3' })?.catch(() => undefined)
    return () => { applyThemeNavigationBar(getStoredAppColorScheme()) }
  }, [])
  const confirm = async () => {
    if (!selected || confirming.current) return
    confirming.current = true
    let saved = false
    try {
      saved = await onConfirm(selected)
      if (!saved) setError('默认模式未能保存，请检查登录状态后重试。')
    } catch (reason) { setError(reason instanceof Error ? reason.message : '默认模式未能保存，请稍后重试。') }
    finally { confirming.current = saved }
  }
  return <View id='mode-introduction' className={`mode-introduction mode-introduction--${step === 1 ? 'wellness' : 'balanced'}`}>
    <PageMeta pageStyle='overflow: hidden;' />
    <View className='mode-introduction__header' style={{ paddingTop: `${headerInset}px` }}><Text>食探 · 初次见面</Text><Text>{step + 1} / 3</Text></View>
    <Swiper className='mode-introduction__pages' current={step} duration={320} onChange={event => setStep(event.detail.current)}>
      {INTRODUCTIONS.map((intro, index) => <SwiperItem key={intro.mode}>
        <ScrollView scrollY className='mode-introduction__scroll'>
          <View className={`mode-introduction__page mode-introduction__page--${intro.mode}${step === index ? ' is-active' : ''}`}>
            <Text className='mode-introduction__eyebrow'>先了解，再选择</Text>
            <Text className='mode-introduction__title'>{intro.title}</Text>
            <Text className='mode-introduction__lead'>{intro.lead}</Text>
            <View className={`mode-introduction__art mode-introduction__art--${intro.mode}`} aria-hidden>
              {intro.mode === 'balanced' ? <><View className='mode-introduction__plate'><View /><View /><View /></View><View className='mode-introduction__bars'><View /><View /><View /></View><Text>营养 · 目标 · 趋势</Text></> : <><View className='mode-introduction__taiji'><View /><View /></View><View className='mode-introduction__ripple' /><Text>饮食有节，动静相宜</Text></>}
            </View>
            <View className='mode-introduction__features'>{intro.features.map(([title, description], featureIndex) => <View className='mode-introduction__feature' key={title}>
              <Text className='mode-introduction__feature-index'>0{featureIndex + 1}</Text>
              <View><Text className='mode-introduction__feature-title'>{title}</Text><Text className='mode-introduction__description'>{description}</Text></View>
            </View>)}</View>
            <View className='mode-introduction__audience'><Text>适合这样的你</Text><Text className='mode-introduction__description'>{intro.audience}</Text></View>
          </View>
        </ScrollView>
      </SwiperItem>)}
      <SwiperItem>
        <ScrollView scrollY className='mode-introduction__scroll'>
          <View className={`mode-introduction__page${step === 2 ? ' is-active' : ''}`}>
            <Text className='mode-introduction__eyebrow'>选择你的日常节奏</Text>
            <Text className='mode-introduction__title'>从哪种方式开始？</Text>
            <Text className='mode-introduction__lead'>两种模式，共用你的记录与核心功能。</Text>
            <View className='mode-introduction__choices'>{INTRODUCTIONS.map(intro => <View
              id={`mode-introduction-${intro.mode}`} key={intro.mode}
              className={`mode-introduction__choice mode-introduction__choice--${intro.mode}${selected === intro.mode ? ' is-selected' : ''}`}
              role='button' aria-pressed={selected === intro.mode} aria-label={`选择${intro.title}`}
              onClick={() => { setSelected(intro.mode); setError('') }}
            >
              <View className='mode-introduction__choice-heading'><Text>{intro.title}</Text><Text>{selected === intro.mode ? '已选择 ✓' : '选择'}</Text></View>
              <Text className='mode-introduction__description'>{intro.mode === 'balanced' ? '清晰的数据与目标 · 八种视觉主题' : '纸墨与留白 · 舒缓地观察日常'}</Text>
            </View>)}</View>
            <View className='mode-introduction__after'><Text>确认后记为默认，下次登录直接沿用。</Text><Text>之后可在“我的 → 默认模式”滑动切换。</Text><Text>切换不会重置记录，也不会改变已选的均衡主题。</Text></View>
            {error && <View className='mode-introduction__error' role='alert'><Text>{error}</Text></View>}
          </View>
        </ScrollView>
      </SwiperItem>
    </Swiper>
    <View className='mode-introduction__footer'>
      <View className='mode-introduction__progress' aria-label={`介绍进度，第${step + 1}页，共3页`}>{[0, 1, 2].map(index => <View key={index} className={step === index ? 'is-current' : ''} />)}</View>
      <View className='mode-introduction__actions'>
        {step > 0 && <Button id='mode-introduction-back' className='mode-introduction__back' onClick={() => setStep(step - 1)}>上一步</Button>}
        <Button id='mode-introduction-next' className='mode-introduction__next' disabled={step === 2 && !selected} onClick={() => step < 2 ? setStep(step + 1) : confirm()}>{step < 2 ? (step === 0 ? '了解养生模式 →' : '选择我的模式 →') : '设为默认，开始记录'}</Button>
      </View>
      <Text className='mode-introduction__hint'>{step < 2 ? '左右滑动了解模式，内容可上下阅读' : '选适合当下的方式，之后仍可更换'}</Text>
    </View>
  </View>
}
