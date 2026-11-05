import { View, Text } from '@tarojs/components'
import { useCallback, useRef, useState } from 'react'
import Taro, { useDidShow, usePullDownRefresh } from '@tarojs/taro'
import CustomNavBar from '../../components/CustomNavBar'
import { useAppColorScheme } from '../../components/AppColorSchemeContext'
import { addBodyWaterLog, showUnifiedApiError } from '../../utils/api'
import { experiments } from '../../utils/experiments'
import { requestHomeRecordMenu } from '../../utils/home-record-menu'
import { openPetChat, openPetSettings } from '../../utils/pet-navigation'
import { checkIsLoggedIn, redirectToLogin, withAuth } from '../../utils/withAuth'
import { getPetDaily, type PetDaily, type PetDailyTask, type PetMood } from './pet-daily-api'
import { petFocusSummary } from './pet-focus'
import { askTarget, petActionNeedsLogin, petActionTarget, pickMealTarget, type PetActionId, type PetActionTarget } from './pet-tools'
import { PetAskBar, PetDailySkeleton, PetGapsCard, PetHero, PetLevelRow, PetTaskRow, PetWeekRow } from './PetDailyCards'
import { PetFocusSheet } from './PetFocusSheet'
import './index.scss'

const GUEST_MOOD: PetMood = { key: 'calm', label: '等你来认识', reason: '', icon: 'sun' }
const ASK_FALLBACK = '晚上吃什么好？'

function openTarget(target: PetActionTarget) {
  switch (target.kind) {
    case 'navigateTo':
      Taro.navigateTo({ url: target.url })
      return
    case 'petChat':
      openPetChat(target.starter)
      return
    case 'petChatMeal':
      openPetChat(target.entry)
      return
    case 'petSettings':
      openPetSettings()
  }
}

/**
 * 底栏「小麦」：替换了原来的「分析」格，一屏看完今天——宠物和一句话、今天还差（按关注排）、
 * 今天一个任务（记录后自动完成）、本周分数、问小麦。完整分析是 pages/stats/index 二级页。
 */
function PetTabPage() {
  const { scheme } = useAppColorScheme()
  const [loggedIn, setLoggedIn] = useState(checkIsLoggedIn)
  const [daily, setDaily] = useState<PetDaily | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadFailed, setLoadFailed] = useState(false)
  const [addingWater, setAddingWater] = useState(false)
  const [focusOpen, setFocusOpen] = useState(false)
  const loadingRef = useRef(false)

  const loadDaily = useCallback(async () => {
    if (!checkIsLoggedIn()) {
      setLoggedIn(false)
      setDaily(null)
      return
    }
    setLoggedIn(true)
    if (loadingRef.current) return
    loadingRef.current = true
    setLoading(true)
    try {
      const data = await getPetDaily()
      setDaily(data)
      setLoadFailed(false)
      if (data.task?.just_done) {
        experiments.track('pet_task_done', { key: data.task.key })
        Taro.showToast({ title: `任务完成 +${data.task.exp_reward} 经验`, icon: 'none' })
      } else if (data.report.reward?.claimed_now) {
        Taro.showToast({ title: `${data.pet.name}带回 +${data.report.reward.exp} 经验`, icon: 'none' })
      }
    } catch (error) {
      setLoadFailed(true)
      console.error('[pet-tab] 获取小麦日报失败', error)
    } finally {
      loadingRef.current = false
      setLoading(false)
    }
  }, [])

  useDidShow(() => {
    experiments.track('pet_tab_view', { logged_in: checkIsLoggedIn() })
    void loadDaily()
  })

  usePullDownRefresh(() => {
    void loadDaily().finally(() => Taro.stopPullDownRefresh())
  })

  /** 埋点 + 游客拦截；通过了才返回 true */
  const allow = useCallback((id: PetActionId) => {
    experiments.track('pet_tool_click', { tool: id })
    if (petActionNeedsLogin(id) && !checkIsLoggedIn()) {
      redirectToLogin()
      return false
    }
    return true
  }, [])

  const handlePickMeal = useCallback(() => {
    if (allow('pick_meal')) openTarget(pickMealTarget(daily?.next_meal, daily?.date || ''))
  }, [allow, daily?.date, daily?.next_meal])

  const handleAsk = useCallback((question: string) => {
    if (allow('ask')) openTarget(askTarget(question, ASK_FALLBACK))
  }, [allow])

  const handleOpenStats = useCallback(() => {
    if (allow('stats')) openTarget(petActionTarget('stats'))
  }, [allow])

  const handleOpenPet = useCallback(() => {
    if (allow('dress')) openTarget(petActionTarget('dress'))
  }, [allow])

  const handleOpenFocus = useCallback(() => {
    experiments.track('pet_note_open')
    if (!checkIsLoggedIn()) {
      redirectToLogin()
      return
    }
    setFocusOpen(true)
  }, [])

  const handleFocusSaved = useCallback(() => {
    setFocusOpen(false)
    void loadDaily()
  }, [loadDaily])

  const handleAddWater = useCallback(async () => {
    experiments.track('pet_tool_click', { tool: 'water_cup' })
    if (addingWater) return
    setAddingWater(true)
    try {
      await addBodyWaterLog(daily?.water?.cup_ml || 250)
      Taro.showToast({ title: '记了一杯水', icon: 'none' })
      await loadDaily()
    } catch (error) {
      await showUnifiedApiError(error, '记录喝水失败')
    } finally {
      setAddingWater(false)
    }
  }, [addingWater, daily?.water?.cup_ml, loadDaily])

  const handleTaskAction = useCallback((task: PetDailyTask) => {
    experiments.track('pet_tool_click', { tool: `task_${task.key}` })
    requestHomeRecordMenu()
  }, [])

  const isDark = scheme === 'dark'
  const petName = daily?.pet?.name || '小麦'
  const meal = daily?.next_meal
  const mealLine = meal?.advice ? `${meal.label}：${meal.advice}` : `${meal?.label || '下一餐'}吃什么，让小麦看看`

  return (
    <View className={`pet-tab-page ${isDark ? 'pet-tab-page--dark' : ''}`}>
      <CustomNavBar
        title={petName}
        color={isDark ? '#e5efe9' : '#1f4d3a'}
        background={isDark ? '#101716' : '#f7f4ec'}
      />
      <View className='pet-tab-body'>
        {!loggedIn ? (
          <GuestView onLogin={() => redirectToLogin()} onOpenStats={handleOpenStats} onAsk={handleAsk} />
        ) : daily ? (
          <>
            <PetLevelRow pet={daily.pet} focusText={petFocusSummary(daily.focus || [])} onOpenFocus={handleOpenFocus} />
            <PetHero
              pet={daily.pet}
              status={daily.status}
              mood={daily.mood}
              line={daily.headline || daily.mood.reason || '记一餐，我来看看你今天吃得怎么样。'}
              onOpenPet={handleOpenPet}
            />
            <PetGapsCard gaps={daily.gaps || []} mealsToday={daily.meals_today} mealLine={mealLine} onPickMeal={handlePickMeal} />
            {daily.task ? (
              <PetTaskRow task={daily.task} addingWater={addingWater} onAction={handleTaskAction} onAddWater={handleAddWater} />
            ) : null}
            <PetWeekRow week={daily.week} onOpen={handleOpenStats} />
            <PetAskBar placeholder={`问问${petName}：${ASK_FALLBACK}`} onAsk={handleAsk} />
          </>
        ) : loadFailed && !loading ? (
          <View className='pet-tab-card pet-tab-retry'>
            <Text className='pet-tab-muted'>今天的情况没拿到，网络好一点再试试。</Text>
            <View className='pet-tab-meal-btn' onClick={() => void loadDaily()}>
              <Text className='pet-tab-meal-btn-text'>再试一次</Text>
            </View>
          </View>
        ) : (
          <PetDailySkeleton />
        )}
      </View>
      <PetFocusSheet
        visible={focusOpen}
        current={daily?.focus || []}
        onClose={() => setFocusOpen(false)}
        onSaved={handleFocusSaved}
      />
    </View>
  )
}

/** 游客先看：小麦是谁、每天会给什么、完整分析都能浏览，点操作才去登录（微信审核要求）。 */
function GuestView({ onLogin, onOpenStats, onAsk }: {
  onLogin: () => void
  onOpenStats: () => void
  onAsk: (question: string) => void
}) {
  return (
    <>
      <PetHero mood={GUEST_MOOD} line='我是小麦。登录后我每天帮你看吃得怎么样、今天还差什么，再给你一个记了就自动完成的小任务。' />
      <View className='pet-tab-card'>
        <View className='pet-tab-card-head'>
          <Text className='pet-tab-card-title'>今天还差</Text>
        </View>
        <Text className='pet-tab-muted'>按你在意的排在前面，比如控血压就先看盐，控血糖就先看糖。</Text>
        <View className='pet-tab-meal'>
          <Text className='pet-tab-meal-line'>记下一餐，我就能告诉你下一顿怎么补。</Text>
          <View className='pet-tab-meal-btn' onClick={onLogin}>
            <Text className='pet-tab-meal-btn-text'>登录领养小麦</Text>
          </View>
        </View>
      </View>
      <PetWeekRow week={{ score: null, last_week: null, delta: null, enough_data: false, habits: [] }} onOpen={onOpenStats} />
      <PetAskBar placeholder={`问问小麦：${ASK_FALLBACK}`} onAsk={onAsk} />
    </>
  )
}

export default withAuth(PetTabPage, { public: true })
