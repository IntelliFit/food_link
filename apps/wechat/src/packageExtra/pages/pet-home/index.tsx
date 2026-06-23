import { View, Text } from '@tarojs/components'
import { useCallback, useEffect, useMemo, useState } from 'react'
import Taro, { useDidShow, usePullDownRefresh } from '@tarojs/taro'
import {
  getMyMembership,
  getPetSummary,
  rerollPetAppearance,
  claimPetEvent,
  selectPetAppearance,
  type MembershipStatus,
  type PetAppearanceCandidate,
  type PetOfflineEvent,
  type PetSummary,
  showUnifiedApiError
} from '../../../utils/api'
import { withAuth } from '../../../utils/withAuth'
import { extraPkgUrl } from '../../../utils/subpackage-extra'
import { useAppColorScheme } from '../../../components/AppColorSchemeContext'
import { applyThemeNavigationBar } from '../../../utils/theme-navigation-bar'
import { PetAvatar } from '../../../components/PetAvatar'
import './index.scss'

const HOME_PET_HIDDEN_KEY = 'home_pet_companion_hidden_v1'
const HOME_PET_HIDDEN_CHANGED_EVENT = 'home_pet_companion_hidden_changed'

function getStoredHomePetHidden(): boolean {
  try {
    return Taro.getStorageSync(HOME_PET_HIDDEN_KEY) === '1'
  } catch (_) {
    return false
  }
}

function moodText(mood?: string): string {
  switch (mood) {
    case 'happy':
      return '元气满满'
    case 'sleepy':
      return '慢慢充电'
    case 'surprised':
      return '有点惊喜'
    default:
      return '稳稳陪伴'
  }
}

function petStateText(state?: string, inactivityDays?: number): string {
  switch (state) {
    case 'deep_sleep':
      return '保温箱深睡'
    case 'hibernating':
      return '冬眠中'
    case 'low_power':
      return '低电量'
    case 'dozing':
      return '犯困中'
    case 'warming':
      return '正在唤醒'
    case 'active':
      return '满电'
    case 'steady':
      return '稳定'
    default:
      return inactivityDays && inactivityDays > 0 ? `${inactivityDays}天未记录` : '陪伴中'
  }
}

function personalityText(personality?: string): string {
  switch (personality) {
    case 'energetic':
      return '元气型'
    case 'focused':
      return '认真型'
    case 'snacky':
      return '嘴馋型'
    case 'sporty':
      return '运动型'
    default:
      return '温柔型'
  }
}

function archetypeText(archetype?: string): string {
  switch (archetype) {
    case 'energetic_buddy':
      return '元气伙伴'
    case 'gentle_healer':
      return '温柔守护'
    case 'protein_guardian':
      return '蛋白守卫'
    case 'light_lifestyle':
      return '轻盈陪伴'
    default:
      return '稳定陪伴'
  }
}

function candidateStyleText(style?: string): string {
  switch (style) {
    case 'quirky':
      return '特色丑萌'
    case 'stable':
      return '稳定可用'
    default:
      return '漂亮亲和'
  }
}

function PetHomePage() {
  const { scheme } = useAppColorScheme()
  const [loading, setLoading] = useState(true)
  const [claiming, setClaiming] = useState(false)
  const [rerolling, setRerolling] = useState(false)
  const [selectingCandidateId, setSelectingCandidateId] = useState('')
  const [petSummary, setPetSummary] = useState<PetSummary | null>(null)
  const [membership, setMembership] = useState<MembershipStatus | null>(null)
  const [homePetHidden, setHomePetHidden] = useState(getStoredHomePetHidden)

  const loadData = useCallback(async () => {
    try {
      setLoading(true)
      const [pet, member] = await Promise.all([
        getPetSummary(),
        getMyMembership().catch(() => null),
      ])
      setPetSummary(pet)
      setMembership(member)
    } catch (error) {
      await showUnifiedApiError(error, '加载宠物档案失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useDidShow(() => {
    applyThemeNavigationBar(scheme)
    setHomePetHidden(getStoredHomePetHidden())
    void loadData()
  })

  useEffect(() => {
    applyThemeNavigationBar(scheme)
  }, [scheme])

  usePullDownRefresh(() => {
    void loadData().finally(() => Taro.stopPullDownRefresh())
  })

  const petMood = petSummary?.status?.mood || 'calm'
  const petState = petSummary?.status?.state || petMood
  const petInactivityDays = petSummary?.status?.inactivity_days || 0
  const petEvent: PetOfflineEvent | null = petSummary?.event && !petSummary.event.is_claimed ? petSummary.event : null
  const earnedCredits = membership?.earned_credits_balance ?? 0
  const totalCredits = membership?.total_credits_available ?? membership?.daily_credits_remaining ?? 0
  const nextLevelGap = Math.max((petSummary?.pet?.next_level_exp ?? 0) - (petSummary?.pet?.level_exp ?? 0), 0)
  const selectionCandidates = petSummary?.pet?.selection_candidates || []
  const shouldShowSelection = selectionCandidates.length > 0
    && Boolean(petSummary?.pet?.needs_selection || petSummary?.pet?.free_profile_rematch_available)

  const handleClaim = useCallback(async () => {
    if (!petEvent?.id || claiming) return
    try {
      setClaiming(true)
      const result = await claimPetEvent(petEvent.id)
      setPetSummary((prev) => prev ? {
        ...prev,
        pet: result.pet,
        event: {
          ...result.event,
          can_claim: false,
          is_claimed: true,
        },
      } : prev)
      const earnedBalance = result.earned_credits_balance
      if (typeof earnedBalance === 'number') {
        setMembership((prev) => prev ? {
          ...prev,
          earned_credits_balance: earnedBalance,
          total_credits_available: (prev.system_credits_remaining ?? 0) + earnedBalance,
          daily_credits_remaining: (prev.system_credits_remaining ?? 0) + earnedBalance,
        } : prev)
      }
      Taro.showToast({
        title: result.credits_awarded > 0 ? `已领取 +${result.credits_awarded} 积分` : `已领取 +${result.exp_awarded} 经验`,
        icon: 'success'
      })
    } catch (error) {
      await showUnifiedApiError(error, '领取奖励失败')
    } finally {
      setClaiming(false)
    }
  }, [claiming, petEvent?.id])

  const handleReroll = useCallback(async () => {
    if (!petSummary?.pet || rerolling) return
    if (earnedCredits < 5) {
      Taro.showToast({ title: '奖励积分不足 5 分', icon: 'none' })
      return
    }
    const modal = await Taro.showModal({
      title: '随机换外观',
      content: '会消耗 5 奖励积分，宠物名字和等级不变，只随机刷新颜色、体型、花纹和配饰。',
      confirmText: '立即更换',
      confirmColor: '#5cb896',
      cancelText: '先看看'
    })
    if (!modal.confirm) return

    try {
      setRerolling(true)
      const result = await rerollPetAppearance()
      setPetSummary((prev) => prev ? {
        ...prev,
        pet: result.pet,
      } : prev)
      const earnedBalance = result.earned_credits_balance
      if (typeof earnedBalance === 'number') {
        setMembership((prev) => prev ? {
          ...prev,
          earned_credits_balance: earnedBalance,
          total_credits_available: Math.max((prev.total_credits_available ?? totalCredits) - result.credits_cost, 0),
          daily_credits_remaining: Math.max((prev.daily_credits_remaining ?? totalCredits) - result.credits_cost, 0),
        } : prev)
      }
      Taro.showToast({ title: '外观已更新', icon: 'success' })
    } catch (error) {
      await showUnifiedApiError(error, '随机换外观失败')
    } finally {
      setRerolling(false)
    }
  }, [earnedCredits, petSummary?.pet, rerolling, totalCredits])

  const handleSelectCandidate = useCallback(async (candidate: PetAppearanceCandidate) => {
    if (!candidate?.id || selectingCandidateId) return
    try {
      setSelectingCandidateId(candidate.id)
      const result = await selectPetAppearance(candidate.id)
      setPetSummary((prev) => prev ? {
        ...prev,
        pet: result.pet,
      } : prev)
      Taro.showToast({ title: '宠物已选择', icon: 'success' })
    } catch (error) {
      await showUnifiedApiError(error, '选择宠物失败')
    } finally {
      setSelectingCandidateId('')
    }
  }, [selectingCandidateId])

  const handlePickComingSoon = useCallback(() => {
    Taro.showToast({ title: '挑选外观即将开放', icon: 'none' })
  }, [])

  const handleToggleHomePetHidden = useCallback(() => {
    setHomePetHidden((prev) => {
      const next = !prev
      try {
        Taro.setStorageSync(HOME_PET_HIDDEN_KEY, next ? '1' : '0')
      } catch (_) {}
      Taro.eventCenter.trigger(HOME_PET_HIDDEN_CHANGED_EVENT, next)
      Taro.showToast({ title: next ? '首页宠物已隐藏' : '首页宠物已显示', icon: 'none' })
      return next
    })
  }, [])

  const openPetLab = useCallback(() => {
    Taro.navigateTo({ url: extraPkgUrl('/pages/pet-lab/index') })
  }, [])

  const openPetChat = useCallback(() => {
    Taro.navigateTo({ url: extraPkgUrl('/pages/pet-chat/index') })
  }, [])

  return (
    <View className={`pet-home-page ${scheme === 'dark' ? 'pet-home-page--dark' : ''}`}>
      <View className='pet-home-shell'>
        <View className='pet-home-hero'>
          <PetAvatar pet={petSummary?.pet} size='large' mood={petSummary?.status?.mood} state={petSummary?.status?.state} />

          <View className='pet-home-hero-copy'>
            <Text className='pet-home-name'>{petSummary?.pet?.name || '健康伙伴'}</Text>
            <View className='pet-home-meta-row'>
              <Text className='pet-home-chip'>Lv.{petSummary?.pet?.level || 1}</Text>
              <Text className='pet-home-chip secondary'>{personalityText(petSummary?.pet?.personality)}</Text>
              <Text className='pet-home-chip secondary'>{archetypeText(petSummary?.pet?.archetype)}</Text>
              <Text className='pet-home-chip secondary'>{petStateText(petState, petInactivityDays)}</Text>
              <Text className='pet-home-chip secondary'>{moodText(petMood)}</Text>
            </View>
            <Text className='pet-home-message'>
              {loading ? '正在整理今天的状态' : (petSummary?.status?.message || '它正在安静陪你记录每一天。')}
            </Text>
          </View>
        </View>

        <View className='pet-home-card pet-home-chat-card'>
          <View className='pet-home-card-head'>
            <Text className='pet-home-card-title'>问问{petSummary?.pet?.name || '宠物'}</Text>
            <Text className='pet-home-card-side'>文本分析 demo</Text>
          </View>
          <Text className='pet-home-event-message'>
            让它读取你已保存的饮食文字和营养数据，聊聊训练状态、减脂卡住、碳水和蛋白质分布。不读取图片。
          </Text>
          <View className='pet-home-inline-action primary pet-home-chat-action' onClick={openPetChat}>
            <Text className='pet-home-inline-action-text'>去问问它</Text>
          </View>
        </View>

        <View className='pet-home-card'>
          <View className='pet-home-card-head'>
            <Text className='pet-home-card-title'>为什么是它</Text>
            <Text className='pet-home-card-side'>{archetypeText(petSummary?.pet?.archetype)}</Text>
          </View>
          <View className='pet-home-reason-list'>
            {(petSummary?.pet?.match_reasons?.length ? petSummary.pet.match_reasons : ['它会根据你的健康目标、活动水平和记录习惯生成，不按性别粗暴分配。']).map((reason) => (
              <View key={reason} className='pet-home-reason-item'>
                <Text className='pet-home-reason-dot'>•</Text>
                <Text className='pet-home-reason-text'>{reason}</Text>
              </View>
            ))}
          </View>
          {petSummary?.pet?.growth_unlocks?.length ? (
            <View className='pet-home-unlock-row'>
              {petSummary.pet.growth_unlocks.map((item) => (
                <Text key={item} className='pet-home-unlock-chip'>{item}</Text>
              ))}
            </View>
          ) : null}
        </View>

        {shouldShowSelection ? (
          <View className='pet-home-card'>
            <View className='pet-home-card-head'>
              <Text className='pet-home-card-title'>{petSummary?.pet?.needs_selection ? '三选一伙伴' : '免费重新匹配'}</Text>
              <Text className='pet-home-card-side'>不消耗积分</Text>
            </View>
            <Text className='pet-home-event-message'>
              系统先默认使用第一个候选，首页不会被打断。你可以在这里挑一个真正顺眼的伙伴。
            </Text>
            <View className='pet-home-candidate-grid'>
              {selectionCandidates.map((candidate) => (
                <View
                  key={candidate.id}
                  className={`pet-home-candidate-card ${candidate.pet_seed === petSummary?.pet?.pet_seed ? 'active' : ''}`}
                  onClick={() => handleSelectCandidate(candidate)}
                >
                  <PetAvatar pet={candidate} size='small' />
                  <Text className='pet-home-candidate-name'>{candidate.name}</Text>
                  <Text className='pet-home-candidate-style'>{candidateStyleText(candidate.style)} · {candidate.score || '--'}</Text>
                  <Text className='pet-home-candidate-action'>
                    {selectingCandidateId === candidate.id ? '选择中' : candidate.pet_seed === petSummary?.pet?.pet_seed ? '当前' : '选择'}
                  </Text>
                </View>
              ))}
            </View>
          </View>
        ) : null}

        <View className='pet-home-card'>
          <View className='pet-home-card-head'>
            <Text className='pet-home-card-title'>成长进度</Text>
            <Text className='pet-home-card-side'>
              {petSummary ? `${petSummary.pet.level_exp}/${petSummary.pet.next_level_exp}` : '--'}
            </Text>
          </View>
          <View className='pet-home-progress'>
            <View className='pet-home-progress-fill' style={{ width: `${petSummary?.pet?.level_progress ?? 0}%` }} />
          </View>
          <View className='pet-home-metrics'>
            <View className='pet-home-metric'>
              <Text className='pet-home-metric-label'>总经验</Text>
              <Text className='pet-home-metric-value'>{petSummary?.pet?.experience ?? 0}</Text>
            </View>
            <View className='pet-home-metric'>
              <Text className='pet-home-metric-label'>距升级</Text>
              <Text className='pet-home-metric-value'>{nextLevelGap}</Text>
            </View>
            <View className='pet-home-metric'>
              <Text className='pet-home-metric-label'>陪伴天数</Text>
              <Text className='pet-home-metric-value'>{petSummary?.pet?.total_events ?? 0}</Text>
            </View>
          </View>
        </View>

        <View className='pet-home-card'>
          <View className='pet-home-card-head'>
            <Text className='pet-home-card-title'>今日状态</Text>
            <Text className='pet-home-card-side'>习惯分 {petSummary?.today?.habit_score ?? 0}</Text>
          </View>
          <View className='pet-home-score-grid'>
            <View className='pet-home-score-item'>
              <Text className='pet-home-score-label'>今日经验</Text>
              <Text className='pet-home-score-value'>+{petSummary?.today?.exp_gained ?? 0}</Text>
            </View>
            <View className='pet-home-score-item'>
              <Text className='pet-home-score-label'>奖励积分</Text>
              <Text className='pet-home-score-value'>{earnedCredits}</Text>
            </View>
            <View className='pet-home-score-item'>
              <Text className='pet-home-score-label'>总可用积分</Text>
              <Text className='pet-home-score-value'>{totalCredits}</Text>
            </View>
          </View>
          <Text className='pet-home-task'>{petSummary?.status?.task_text || '继续保持记录，它会慢慢长大。'}</Text>
        </View>

        <View className='pet-home-card'>
          <View className='pet-home-card-head'>
            <Text className='pet-home-card-title'>离线小惊喜</Text>
            <Text className='pet-home-card-side'>{petEvent ? '未领取' : '已查看'}</Text>
          </View>
          <Text className='pet-home-event-title'>{petEvent?.title || '今天还没有新的离线惊喜'}</Text>
          <Text className='pet-home-event-message'>
            {petEvent?.message || '等你下一次回来时，它会带着整理好的复盘和一点小奖励出现。'}
          </Text>
          {petEvent?.can_claim ? (
            <View className='pet-home-inline-action primary' onClick={handleClaim}>
              <Text className='pet-home-inline-action-text'>
                {claiming ? '领取中' : petEvent.credit_reward > 0 ? `领取 +${petEvent.credit_reward} 积分` : `领取 +${petEvent.exp_reward} 经验`}
              </Text>
            </View>
          ) : null}
        </View>

        <View className='pet-home-card'>
          <View className='pet-home-card-head'>
            <Text className='pet-home-card-title'>外观换装</Text>
            <Text className='pet-home-card-side'>统一角色体系</Text>
          </View>
          <View className='pet-home-action-list'>
            <View className='pet-home-action-item visibility' onClick={handleToggleHomePetHidden}>
              <View>
                <Text className='pet-home-action-title'>首页悬浮宠物</Text>
                <Text className='pet-home-action-desc'>{homePetHidden ? '当前首页不显示宠物，数据和成长仍会保留' : '当前首页会显示可拖动的小宠物'}</Text>
              </View>
              <View className='pet-home-action-side'>
                <Text className={`pet-home-visibility-status ${homePetHidden ? 'hidden' : ''}`}>
                  {homePetHidden ? '已隐藏' : '显示中'}
                </Text>
                <View className={`pet-home-toggle ${homePetHidden ? '' : 'active'}`}>
                  <View className='pet-home-toggle-knob' />
                </View>
              </View>
            </View>
            <View className='pet-home-action-item' onClick={handleReroll}>
              <View>
                <Text className='pet-home-action-title'>随机换外观</Text>
                <Text className='pet-home-action-desc'>保留名字和等级，随机刷新体型、花纹与配饰</Text>
              </View>
              <View className='pet-home-action-side'>
                <Text className='pet-home-action-cost'>{rerolling ? '处理中' : '5 积分'}</Text>
                <Text className='iconfont icon-right pet-home-action-arrow' />
              </View>
            </View>
            <View className='pet-home-action-item muted' onClick={handlePickComingSoon}>
              <View>
                <Text className='pet-home-action-title'>挑选外观</Text>
                <Text className='pet-home-action-desc'>按喜好指定耳朵、颜色、配饰组合</Text>
              </View>
              <View className='pet-home-action-side'>
                <Text className='pet-home-action-coming'>即将开放</Text>
                <Text className='iconfont icon-right pet-home-action-arrow muted' />
              </View>
            </View>
          </View>
        </View>

        {process.env.NODE_ENV === 'development' ? (
          <View className='pet-home-card'>
            <View className='pet-home-card-head'>
              <Text className='pet-home-card-title'>外观试验箱</Text>
              <Text className='pet-home-card-side'>开发调试</Text>
            </View>
            <Text className='pet-home-event-message'>
              批量查看颜色、体型、动物特征、花纹与配饰组合，定位哪些组合好看，哪些组合需要收敛。
            </Text>
            <View className='pet-home-inline-action lab' onClick={openPetLab}>
              <Text className='pet-home-inline-action-text lab'>打开试验箱</Text>
            </View>
          </View>
        ) : null}
      </View>
    </View>
  )
}

export default withAuth(PetHomePage)

