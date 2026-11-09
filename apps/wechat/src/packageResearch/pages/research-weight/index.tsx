import { Text, View } from '@tarojs/components'
import { useCallback, useState } from 'react'
import Taro, { useDidShow } from '@tarojs/taro'
import { useAppColorScheme } from '../../../components/AppColorSchemeContext'
import { applyThemeNavigationBar } from '../../../utils/theme-navigation-bar'
import { extraPkgUrl } from '../../../utils/subpackage-extra'
import { getAccessToken } from '../../../utils/api'
import {
  getMyResearchSamples,
  listResearchContainers,
  type ResearchMineResult,
} from '../../../utils/research-weight-api'
import { STATUS_LABELS, checkDraft, draftHasContent, emptyDraft, libraryIndex, type Library, type ResearchDraft } from './model'
import { acceptConsent, clearDraft, loadDraft, readConsent } from './storage'
import { ensureLoggedIn } from './media'
import { ConsentCard } from './controls'
import { mineRow } from './mine'
import './index.scss'

const STEPS = [
  { title: '拍', desc: '打开盒盖拍一张整顿饭' },
  { title: '称', desc: '每盒连盒放秤上拍读数' },
  { title: '吃完称空盒', desc: '存过常用容器就不用称' },
]

/** 称重科研计划首页：说明、进行中的一顿、常用容器和我的提交。游客也能看。 */
export default function ResearchWeightPlanPage() {
  const { scheme } = useAppColorScheme()
  const [consented, setConsented] = useState(readConsent)
  const [draft, setDraft] = useState<ResearchDraft>(loadDraft)
  const [mine, setMine] = useState<ResearchMineResult | null>(null)
  const [containerCount, setContainerCount] = useState(0)
  const [library, setLibrary] = useState<Library>({})

  const load = useCallback(async () => {
    if (!getAccessToken()) return
    try {
      const [samples, containers] = await Promise.all([getMyResearchSamples(), listResearchContainers()])
      setMine(samples)
      setContainerCount(containers.length)
      setLibrary(libraryIndex(containers))
    } catch (error) {
      console.warn('[research-weight] load plan page failed', error)
    }
  }, [])

  useDidShow(() => {
    applyThemeNavigationBar(scheme)
    setDraft(loadDraft())
    void load()
  })

  const inProgress = draftHasContent(draft)
  const waitingForMeal = inProgress && checkDraft(draft, library).waitingForMeal

  const startRecord = () => {
    if (!ensureLoggedIn()) return
    if (!consented) {
      Taro.showToast({ title: '请先同意研究数据授权', icon: 'none' })
      return
    }
    Taro.navigateTo({ url: extraPkgUrl('/pages/research-weight-record/index') })
  }

  const dropDraft = async () => {
    const { confirm } = await Taro.showModal({ title: '放弃这一顿', content: '这一顿已填的读数和照片会清空。' })
    if (!confirm) return
    clearDraft()
    setDraft(emptyDraft())
  }

  const openContainers = () => {
    if (ensureLoggedIn()) Taro.navigateTo({ url: extraPkgUrl('/pages/research-weight-containers/index') })
  }

  const summary = mine?.summary
  return (
    <View className={`research-weight-page ${scheme === 'dark' ? 'research-weight-page--dark' : ''}`}>
      <View className='rw-hero'>
        <Text className='rw-hero__eyebrow'>中餐称重 Benchmark 共建</Text>
        <Text className='rw-hero__title'>用食物秤，帮 AI 估得更准</Text>
        <Text className='rw-hero__desc'>称一顿饭、拍一张照片。审核通过的数据会进入公开评测集，用来检验各家 AI 估重到底准不准。</Text>
        <Text className='rw-hero__reward'>审核通过奖励积分：一盒 2 分，每多一盒 +1（最多 6 分）；分项累加 4 分</Text>
        <View className='rw-steps'>
          {STEPS.map((step, index) => (
            <View key={step.title} className='rw-step'>
              <Text className='rw-step__index'>{index + 1}</Text>
              <Text className='rw-step__title'>{step.title}</Text>
              <Text className='rw-step__desc'>{step.desc}</Text>
            </View>
          ))}
        </View>
        {summary ? (
          <View className='rw-stats'>
            <View className='rw-stat'><Text className='rw-stat__value'>{summary.total}</Text><Text className='rw-stat__label'>已提交</Text></View>
            <View className='rw-stat'><Text className='rw-stat__value'>{summary.approved}</Text><Text className='rw-stat__label'>已通过</Text></View>
            <View className='rw-stat'><Text className='rw-stat__value'>{summary.pending}</Text><Text className='rw-stat__label'>待审核</Text></View>
          </View>
        ) : null}
      </View>

      {!consented ? <ConsentCard onAccept={() => { acceptConsent(); setConsented(true) }} /> : null}

      {inProgress ? (
        <View className='rw-card'>
          <View className='rw-progress'>
            <View className='rw-progress__copy'>
              <Text className='rw-progress__title'>进行中：{draft.dishName.trim() || '还没写吃的什么'}</Text>
              <Text className='rw-progress__meta'>
                {draft.mode === 'multi' ? `${draft.containers.length} 盒` : `${draft.items.length} 项`} · {waitingForMeal ? '吃完回来称空盒' : '还没填完'}
              </Text>
            </View>
            <View className='rw-progress__button' onClick={startRecord}><Text>继续</Text></View>
          </View>
          <Text className='rw-progress__drop' onClick={() => void dropDraft()}>放弃这一顿</Text>
        </View>
      ) : (
        <View className='rw-submit rw-primary' onClick={startRecord}><Text>记一顿</Text></View>
      )}

      <View className='rw-card'>
        <View className='rw-link-row' onClick={openContainers}>
          <Text>我的常用容器</Text>
          <Text className='rw-link-row__meta'>{containerCount ? `${containerCount} 个 ›` : '称一次，以后不用再称 ›'}</Text>
        </View>
      </View>

      {mine?.items?.length ? (
        <View className='rw-card'>
          <Text className='rw-card__title'>我的提交</Text>
          {mine.items.slice(0, 20).map((item) => {
            const row = mineRow(item)
            return (
              <View key={item.id} className='rw-mine'>
                <View className='rw-mine__copy'>
                  <Text className='rw-mine__name'>{item.dish_name}</Text>
                  <Text className='rw-mine__meta'>{row.meta}{row.reward ? <Text className='rw-mine__reward'> · {row.reward}</Text> : null}</Text>
                  {row.note ? <Text className={`rw-mine__note rw-mine__note--${item.status}`}>{row.note}</Text> : null}
                </View>
                <Text className={`rw-status rw-status--${item.status}`}>{STATUS_LABELS[item.status] || item.status}</Text>
              </View>
            )
          })}
        </View>
      ) : null}
    </View>
  )
}
