import { Text, View } from '@tarojs/components'
import Taro, { useDidShow, useRouter, useShareAppMessage } from '@tarojs/taro'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useAppColorScheme } from '../../../components/AppColorSchemeContext'
import { extraPkgUrl } from '../../../utils/subpackage-extra'
import { DARK_PALETTE, LIGHT_PALETTE } from '../../charts/draw'
import { CanvasHiddenContext } from '../../charts/LifeCanvas'
import { clearPeople, loadPeople, savePeople, type Predictee } from '../../model/people'
import { buildModel, completenessOf, type TopChange } from '../../model/predictor'
import type { PosterContent, ShareOptions } from '../../model/share'
import { FirstRun } from './FirstRun'
import { PersonSheet } from './PersonSheet'
import { PlayTab, type KeptTuning } from './PlayTab'
import { ShareSheet } from './ShareSheet'
import { ThreeYouTab } from './ThreeYouTab'
import { PREDICTOR_PAGE } from './poster'
import './index.scss'

type Tab = 'three' | 'play'
type BuildPoster = (options: ShareOptions) => PosterContent

function LifespanPredictorPage() {
  const { scheme } = useAppColorScheme()
  const dark = scheme === 'dark'
  const router = useRouter()
  const [people, setPeople] = useState<Predictee[]>(() => loadPeople())
  const [activeId, setActiveId] = useState<string | null>(() => people[0]?.id ?? null)
  const [tab, setTab] = useState<Tab>(router.params?.tab === 'three' ? 'three' : 'play')
  const [sheetOpen, setSheetOpen] = useState(false)
  const [poster, setPoster] = useState<BuildPoster | null>(null)
  const kept = useRef<Record<string, KeptTuning>>({})
  const person = people.find(item => item.id === activeId) ?? null
  const model = useMemo(() => (person ? buildModel(person) : null), [person])
  const palette = dark ? DARK_PALETTE : LIGHT_PALETTE

  const applyNavigationBar = () => {
    void Taro.setNavigationBarColor({ frontColor: '#ffffff', backgroundColor: dark ? '#0e3d2e' : '#0d4a37' })
  }
  // The colour scheme hook resets the bar when it mounts, so this has to run after it.
  useEffect(applyNavigationBar, [dark]) // eslint-disable-line react-hooks/exhaustive-deps
  useDidShow(applyNavigationBar)
  useShareAppMessage(() => ({ title: '每天一个苹果能多活多久？寿命预测器（模拟估算，不用于诊断）', path: `/${PREDICTOR_PAGE}` }))

  const updatePeople = (next: Predictee[]) => {
    setPeople(next)
    savePeople(next)
  }
  const savePerson = (saved: Predictee) => {
    const exists = people.some(item => item.id === saved.id)
    updatePeople(exists ? people.map(item => (item.id === saved.id ? saved : item)) : [...people, saved])
    setActiveId(saved.id)
    setSheetOpen(false)
  }
  const confirm = async (title: string, content: string): Promise<boolean> => {
    const { confirm: ok } = await Taro.showModal({ title, content })
    return ok
  }
  const deletePerson = async (id: string) => {
    const target = people.find(item => item.id === id)
    if (!target || !(await confirm(`删除${target.label}？`, '只会删除这台手机上保存的信息。'))) return
    const next = people.filter(item => item.id !== id)
    updatePeople(next)
    setActiveId(next[0]?.id ?? null)
    setSheetOpen(false)
  }
  const deleteAll = async () => {
    if (!(await confirm('清除这台手机上的数据？', '这里保存的所有人都会被删除。'))) return
    clearPeople()
    setPeople([])
    setActiveId(null)
  }
  const runAction = (target: TopChange['action']['target']) => {
    if (target === 'next_meal') void Taro.switchTab({ url: '/pages/index/index' })
    else void Taro.navigateTo({ url: extraPkgUrl('/pages/nutrition-plans/index') })
  }

  const rootClass = `lp${dark ? ' lp--dark' : ''}`
  if (!person || !model) {
    return <View className={rootClass}><FirstRun onDone={savePerson} /></View>
  }

  const completeness = completenessOf(person)
  const header = (
    <View>
      <View className='lp-modes'>
        <View className={`lp-modes__item${tab === 'three' ? ' is-on' : ''}`} role='tab' onClick={() => setTab('three')}>三个你</View>
        <View className={`lp-modes__item${tab === 'play' ? ' is-on' : ''}`} role='tab' onClick={() => setTab('play')}>自己调</View>
      </View>
      <View className='lp-who'>
        <Text className='lp-hero__dim lp-grow'>在算：{person.label} · {person.sex === 'male' ? '男' : '女'} {person.age} 岁 · 只在这台手机上计算</Text>
        <View className='lp-who__change' role='button' onClick={() => setSheetOpen(true)}>换个人</View>
      </View>
      <Text className='lp-hero__dim lp-who__complete'>{completeness < 100 ? `信息完整度 ${completeness}%，答得越多越准` : '这一版问到的题都答了'}</Text>
    </View>
  )
  const openPoster = (build: BuildPoster) => setPoster(() => build)
  // Editing a person restarts their tabs from the new values.
  const personKey = JSON.stringify(person)

  return (
    <View className={rootClass}>
      <CanvasHiddenContext.Provider value={sheetOpen || poster !== null}>
      {tab === 'three' ? (
        <ThreeYouTab
          key={personKey}
          model={model}
          person={person}
          palette={palette}
          header={header}
          onAction={runAction}
          onShare={openPoster}
          onPlay={() => setTab('play')}
          onDeleteData={() => void deleteAll()}
        />
      ) : (
        <PlayTab
          key={personKey}
          model={model}
          person={person}
          palette={palette}
          header={header}
          kept={kept.current[personKey]}
          onKeep={(value) => { kept.current = { ...kept.current, [personKey]: value } }}
          onSetUpPlan={() => runAction('nutrition_plans')}
          onShare={openPoster}
        />
      )}
      </CanvasHiddenContext.Provider>
      {sheetOpen && (
        <PersonSheet
          people={people}
          activeId={person.id}
          onPick={(id) => { setActiveId(id); setSheetOpen(false) }}
          onSave={savePerson}
          onDelete={(id) => void deletePerson(id)}
          onClose={() => setSheetOpen(false)}
        />
      )}
      {poster && <ShareSheet build={poster} onClose={() => setPoster(null)} />}
    </View>
  )
}

export default LifespanPredictorPage
