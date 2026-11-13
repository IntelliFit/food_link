import { View, Text, Image } from '@tarojs/components'
import { useCallback, useRef, useState } from 'react'
import Taro, { useDidShow, usePullDownRefresh } from '@tarojs/taro'
import CustomNavBar from '../../components/CustomNavBar'
import { useAppColorScheme } from '../../components/AppColorSchemeContext'
import { FocusSheet } from '../../components/FocusSheet'
import { addBodyWaterLog, getNutritionState, showUnifiedApiError } from '../../utils/api'
import { experiments } from '../../utils/experiments'
import { requestHomeRecordMenu } from '../../utils/home-record-menu'
import { normalizeNutritionState, planLineText, todayRowView, type TodayRowView } from '../../utils/nutrition-state-view'
import { continuePetChat, openPetChat, openPetSettings, takePetFocusSheetRequest } from '../../utils/pet-navigation'
import { DEFAULT_PET_NAME, petDisplayName } from '../../utils/pet-name'
import { HOME_BOTANICAL_BG_URL } from '../../utils/static-asset-cdn-url'
import { checkIsLoggedIn, redirectToLogin, withAuth } from '../../utils/withAuth'
import { getPetDaily, type PetDaily, type PetDailyTask } from './pet-daily-api'
import { petFocusLabels } from './pet-focus'
import {
  askTarget,
  petActionNeedsLogin,
  petActionTarget,
  petDayLabel,
  petMealLines,
  petMealReward,
  petTodayLine,
  petWeekChip,
  pickMealTarget,
  type PetActionId,
  type PetActionTarget,
} from './pet-tools'
import { PetAskBar, PetBrief, PetDailySkeleton, PetMealCard, PetTaskRow } from './PetDailyCards'
import './index.scss'

function openTarget(target: PetActionTarget) {
  switch (target.kind) {
    case 'navigateTo':
      Taro.navigateTo({ url: target.url })
      return
    case 'petChat':
      openPetChat(target.starter)
      return
    case 'petContinue':
      continuePetChat()
      return
    case 'petChatMeal':
      openPetChat(target.entry)
      return
    case 'petSettings':
      openPetSettings()
  }
}

/**
 * 底栏「伙伴」只做一件事：今天还差什么，下一顿怎么补。
 * 第一眼是深绿简报卡（宠物、今天一句话、今天还差、我在意的），第二眼是下一顿怎么补，
 * 再往下是今天的任务和问一句。回头看的分析在完整分析页，从简报卡右上角的本周分数进去。
 */
function PetTabPage() {
  const { scheme } = useAppColorScheme()
  const [loggedIn, setLoggedIn] = useState(checkIsLoggedIn)
  const [daily, setDaily] = useState<PetDaily | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadFailed, setLoadFailed] = useState(false)
  const [addingWater, setAddingWater] = useState(false)
  const [focusOpen, setFocusOpen] = useState(false)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [detailsLoading, setDetailsLoading] = useState(false)
  const [details, setDetails] = useState<{ rows: TodayRowView[]; plan: string }>({ rows: [], plan: '' })
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
      setDetailsOpen(false)
      if (data.task?.just_done) {
        experiments.track('pet_task_done', { key: data.task.key })
        Taro.showToast({ title: `任务完成 +${data.task.exp_reward} 经验`, icon: 'none' })
      } else if (data.report.reward?.claimed_now) {
        Taro.showToast({ title: `${petDisplayName(data.pet?.name)}带回 +${data.report.reward.exp} 经验`, icon: 'none' })
      }
    } catch (error) {
      setLoadFailed(true)
      console.error('[pet-tab] 获取伙伴日报失败', error)
    } finally {
      loadingRef.current = false
      setLoading(false)
    }
  }, [])

  useDidShow(() => {
    experiments.track('pet_tab_view', { logged_in: checkIsLoggedIn() })
    void loadDaily()
    // 完整分析页的「在伙伴页改」：切过来后直接打开「我在意的」
    if (takePetFocusSheetRequest()) {
      if (checkIsLoggedIn()) setFocusOpen(true)
      else redirectToLogin()
    }
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

  const handleAsk = useCallback(() => {
    if (allow('ask')) openTarget(askTarget())
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

  const handleFirstMeal = useCallback(() => {
    experiments.track('pet_tool_click', { tool: 'first_meal' })
    requestHomeRecordMenu()
  }, [])

  /** 「看全部」：今天每一项营养素都摊开（数据来自同一份每日营养状态） */
  const handleToggleDetails = useCallback(async () => {
    if (detailsOpen) {
      setDetailsOpen(false)
      return
    }
    experiments.track('pet_tool_click', { tool: 'today_all' })
    if (detailsLoading) return
    setDetailsLoading(true)
    try {
      const state = normalizeNutritionState(await getNutritionState())
      if (!state || state.today.length === 0) {
        Taro.showToast({ title: '今天的明细还没算出来', icon: 'none' })
        return
      }
      setDetails({ rows: state.today.map(todayRowView), plan: planLineText(state.plan) })
      setDetailsOpen(true)
    } catch (error) {
      await showUnifiedApiError(error, '读取今天的明细失败')
    } finally {
      setDetailsLoading(false)
    }
  }, [detailsLoading, detailsOpen])

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
  const petName = petDisplayName(daily?.pet?.name)
  const meal = daily?.next_meal
  const mealLines = petMealLines(meal?.advice || '')
  const mealsToday = daily?.meals_today || 0
  const mealReward = petMealReward(daily?.task)
  const briefLine = daily
    ? (mealsToday > 0
      ? petTodayLine(daily.gaps || [], meal?.label || '')
      : '今天还没记。拍下第一餐，我就知道今天还差什么')
    : ''

  return (
    <View className={`pet-tab-page ${isDark ? 'pet-tab-page--dark' : ''}`}>
      <Image className='pet-tab-bg' src={HOME_BOTANICAL_BG_URL} mode='aspectFill' />
      <View className='pet-tab-bg-fade' />
      <CustomNavBar
        title={loggedIn ? petName : DEFAULT_PET_NAME}
        color={isDark ? '#e5efe9' : '#1b533e'}
        background='transparent'
      />
      <View className='pet-tab-body'>
        {!loggedIn ? (
          <GuestView onLogin={() => redirectToLogin()} onOpenStats={handleOpenStats} onAsk={handleAsk} />
        ) : daily ? (
          <>
            <PetBrief
              pet={daily.pet}
              status={daily.status}
              name={petName}
              dayLabel={petDayLabel(daily.date)}
              weekChip={petWeekChip(daily.week)}
              line={briefLine}
              today={{
                gaps: daily.gaps || [],
                mealsToday,
                focusLabels: petFocusLabels(daily.focus || []),
                details: details.rows,
                detailsOpen,
                detailsLoading,
                planText: details.plan,
              }}
              onOpenWeek={handleOpenStats}
              onOpenPet={handleOpenPet}
              onOpenFocus={handleOpenFocus}
              onToggleDetails={() => void handleToggleDetails()}
              onFirstMeal={handleFirstMeal}
            />
            <PetMealCard
              label={`${meal?.label || '下一餐'}这样${mealsToday > 0 ? '补' : '吃'}`}
              dish={mealLines.dish || `${meal?.label || '下一餐'}吃什么，让${petName}看看`}
              note={mealLines.note}
              buttonText={`让${petName}挑一份`}
              reward={mealReward?.text}
              rewardDone={mealReward?.done}
              onPick={handlePickMeal}
            />
            {daily.task && !mealReward ? (
              <PetTaskRow task={daily.task} addingWater={addingWater} onAction={handleTaskAction} onAddWater={handleAddWater} />
            ) : null}
            <PetAskBar label={`问问${petName}，接着上次聊…`} onOpen={handleAsk} />
          </>
        ) : loadFailed && !loading ? (
          <View className='pet-card pet-retry'>
            <Text className='pet-meal__note'>今天的情况没拿到，网络好一点再试试。</Text>
            <View className='pet-meal__btn' onClick={() => void loadDaily()}>
              <Text className='pet-meal__btn-text'>再试一次</Text>
            </View>
          </View>
        ) : (
          <PetDailySkeleton />
        )}
      </View>
      <FocusSheet
        visible={focusOpen}
        current={(daily?.focus || []).map((item) => item.key)}
        dark={isDark}
        source='pet'
        onClose={() => setFocusOpen(false)}
        onSaved={handleFocusSaved}
      />
    </View>
  )
}

/** 游客先看：伙伴是谁、每天会给什么、完整分析都能浏览，点操作才去登录（微信审核要求）。 */
function GuestView({ onLogin, onOpenStats, onAsk }: {
  onLogin: () => void
  onOpenStats: () => void
  onAsk: () => void
}) {
  return (
    <>
      <PetBrief
        name={DEFAULT_PET_NAME}
        dayLabel='今天'
        weekChip='看看完整分析'
        line={`我是${DEFAULT_PET_NAME}。登录后我每天帮你看今天还差什么，下一顿怎么补。`}
        today={null}
        onOpenWeek={onOpenStats}
        onOpenFocus={onLogin}
        onToggleDetails={onLogin}
        onFirstMeal={onLogin}
      />
      <PetMealCard
        label='下一顿这样吃'
        dish='按你在意的挑：控血压先看盐，控血糖先看糖'
        note='记下一餐，我就能告诉你下一顿怎么补'
        buttonText='登录开始'
        onPick={onLogin}
      />
      <PetAskBar label={`问问${DEFAULT_PET_NAME}…`} onOpen={onAsk} />
    </>
  )
}

export default withAuth(PetTabPage, { public: true })
