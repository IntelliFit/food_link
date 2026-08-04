import { View, Text } from '@tarojs/components'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Taro, { useDidShow, usePullDownRefresh } from '@tarojs/taro'
import {
  getMyMembership,
  getPetSummary,
  customizePetPixelAvatar,
  rerollPetAppearance,
  claimPetEvent,
  selectPetAppearance,
  type MembershipStatus,
  type PetAppearanceCandidate,
  type PetOfflineEvent,
  type PetProfile,
  type PetSummary,
  showUnifiedApiError
} from '../../../utils/api'
import { withAuth } from '../../../utils/withAuth'
import { extraPkgUrl } from '../../../utils/subpackage-extra'
import { useAppColorScheme } from '../../../components/AppColorSchemeContext'
import { applyThemeNavigationBar } from '../../../utils/theme-navigation-bar'
import { PetAvatar } from '../../../components/PetAvatar'
import {
  chooseImageWithPrivacy,
  isPrivacyAuthorizeError,
  showPrivacyAuthorizeFailure,
} from '../../../utils/weapp-privacy'
import { HOME_PET_PROFILE_CHANGED_EVENT } from '../../../utils/pet-events'
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

export function sanitizePetReason(reason: unknown): string {
  return String(reason ?? '')
    .replace(/是\s*(?:<\s*nil\s*>|\(nil\)|\bnil\b|\bnull\b|\bundefined\b)/gi, '暂未记录')
    .replace(/(?:<\s*nil\s*>|\(nil\)|\bnil\b|\bnull\b|\bundefined\b)/gi, '暂未记录')
    .replace(/\s+([，。；：])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

function candidateStyleText(style?: string): string {
  switch (style) {
    case 'classic':
      return '经典像素'
    case 'quirky':
      return '特色丑萌'
    case 'stable':
      return '稳定可用'
    default:
      return '漂亮亲和'
  }
}

function isCandidateActive(candidate: PetAppearanceCandidate, pet?: PetProfile): boolean {
  if (!pet || pet.avatar_type === 'pixel_self') return false
  if (candidate.builtin_avatar_id) {
    return pet.avatar_type === 'builtin_person'
      && candidate.builtin_avatar_id === pet.builtin_avatar_id
  }
  return !pet.builtin_avatar_id && candidate.pet_seed === pet.pet_seed
}

function PetHomePage() {
  const { scheme } = useAppColorScheme()
  const [claiming, setClaiming] = useState(false)
  const [rerolling, setRerolling] = useState(false)
  const [pixelAvatarCustomizing, setPixelAvatarCustomizing] = useState(false)
  const [pixelAvatarPreview, setPixelAvatarPreview] = useState<PetProfile | null>(null)
  const [selectingCandidateId, setSelectingCandidateId] = useState('')
  const [petSummary, setPetSummary] = useState<PetSummary | null>(null)
  const [membership, setMembership] = useState<MembershipStatus | null>(null)
  const [homePetHidden, setHomePetHidden] = useState(getStoredHomePetHidden)
  const pixelAvatarCustomizingRef = useRef(false)

  const syncPetProfile = useCallback((pet: PetProfile) => {
    setPetSummary((previous) => previous ? { ...previous, pet } : previous)
    Taro.eventCenter.trigger(HOME_PET_PROFILE_CHANGED_EVENT, pet)
  }, [])

  const loadData = useCallback(async () => {
    try {
      const [pet, member] = await Promise.all([
        getPetSummary(),
        getMyMembership().catch(() => null),
      ])
      setPetSummary(pet)
      setMembership(member)
    } catch (error) {
      await showUnifiedApiError(error, '加载宠物档案失败')
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

  const petEvent: PetOfflineEvent | null = petSummary?.event && !petSummary.event.is_claimed ? petSummary.event : null
  const earnedCredits = membership?.earned_credits_balance ?? 0
  const totalCredits = membership?.total_credits_available ?? membership?.daily_credits_remaining ?? 0
  const nextLevelGap = Math.max((petSummary?.pet?.next_level_exp ?? 0) - (petSummary?.pet?.level_exp ?? 0), 0)
  const selectionCandidates = petSummary?.pet?.selection_candidates || []
  const commonCandidates = selectionCandidates.filter((candidate) => Boolean(candidate.builtin_avatar_id))
  const matchedCandidates = selectionCandidates.filter((candidate) => !candidate.builtin_avatar_id)
  const shouldShowSelection = matchedCandidates.length > 0
    && Boolean(petSummary?.pet?.needs_selection || petSummary?.pet?.free_profile_rematch_available)
  const matchReasons = useMemo(() => {
    const reasons = (petSummary?.pet?.match_reasons || [])
      .map(sanitizePetReason)
      .filter(Boolean)
    return reasons.length > 0
      ? reasons
      : ['它会根据你的健康目标、活动水平和记录习惯生成，不按性别粗暴分配。']
  }, [petSummary?.pet?.match_reasons])

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
      syncPetProfile(result.pet)
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
  }, [earnedCredits, petSummary?.pet, rerolling, syncPetProfile, totalCredits])

  const handleSelectCandidate = useCallback(async (candidate: PetAppearanceCandidate) => {
    if (!candidate?.id || selectingCandidateId) return
    try {
      setSelectingCandidateId(candidate.id)
      const result = await selectPetAppearance(candidate.id)
      syncPetProfile(result.pet)
      Taro.showToast({ title: '宠物已选择', icon: 'success' })
    } catch (error) {
      await showUnifiedApiError(error, '选择宠物失败')
    } finally {
      setSelectingCandidateId('')
    }
  }, [selectingCandidateId, syncPetProfile])

  const handlePickComingSoon = useCallback(() => {
    Taro.showToast({ title: '挑选外观即将开放', icon: 'none' })
  }, [])

  const handleCustomizePixelAvatar = useCallback(async () => {
    if (pixelAvatarCustomizingRef.current) return
    pixelAvatarCustomizingRef.current = true
    setPixelAvatarCustomizing(true)
    try {
      const consent = await Taro.showModal({
        title: '生成像素分身',
        content: '请选择一张清晰的单人人像照片。照片会发送给 AI 图像服务处理；如果使用朋友的照片，请先获得对方授权。',
        confirmText: '继续选择',
        cancelText: '暂不生成',
      })
      if (!consent.confirm) return
      const result = await chooseImageWithPrivacy({
        count: 1,
        sizeType: ['original'],
        sourceType: ['album', 'camera'],
      })
      const filePath = result.tempFilePaths?.[0]
      if (!filePath) return
      const customized = await customizePetPixelAvatar(filePath)
      syncPetProfile(customized.pet)
      setPixelAvatarPreview(customized.pet)
    } catch (error) {
      const message = String((error as any)?.errMsg || (error as any)?.message || '')
      if (message.toLowerCase().includes('cancel')) return
      if (isPrivacyAuthorizeError(error)) {
        showPrivacyAuthorizeFailure(error, '需要相册或相机权限才能生成分身')
        return
      }
      await showUnifiedApiError(error, '生成像素分身失败，请稍后重试')
    } finally {
      pixelAvatarCustomizingRef.current = false
      setPixelAvatarCustomizing(false)
    }
  }, [syncPetProfile])

  const closePixelAvatarPreview = useCallback(() => {
    setPixelAvatarPreview(null)
  }, [])

  const viewPixelAvatarOnHome = useCallback(() => {
    setPixelAvatarPreview(null)
    Taro.switchTab({ url: '/pages/index/index' })
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
          <View className='pet-home-hero-stage'>
            <PetAvatar
              pet={petSummary?.pet}
              size='large'
              mood={petSummary?.status?.mood}
              state={petSummary?.status?.state}
              mealState={petSummary?.status?.meal_state}
            />
            <View className='pet-home-stage-stat pet-home-stage-stat--level'>
              <Text className='pet-home-stage-stat-label'>等级</Text>
              <Text className='pet-home-stage-stat-value'>Lv.{petSummary?.pet?.level || 1}</Text>
            </View>
            <View className='pet-home-stage-stat pet-home-stage-stat--credits'>
              <Text className='pet-home-stage-stat-label'>积分</Text>
              <Text className='pet-home-stage-stat-value'>{totalCredits}</Text>
            </View>
            <View className='pet-home-stage-stat pet-home-stage-stat--exp'>
              <Text className='pet-home-stage-stat-label'>今日经验</Text>
              <Text className='pet-home-stage-stat-value'>+{petSummary?.today?.exp_gained ?? 0}</Text>
            </View>
          </View>

          <View className='pet-home-hero-copy'>
            <Text className='pet-home-name'>{petSummary?.pet?.name || '健康伙伴'}</Text>
            <View className='pet-home-chat-entry' onClick={openPetChat}>
              <Text className='iconfont icon-comment pet-home-chat-entry-icon' />
              <View className='pet-home-chat-entry-copy'>
                <Text className='pet-home-chat-entry-title'>和它聊聊</Text>
                <Text className='pet-home-chat-entry-subtitle'>饮食与训练分析</Text>
              </View>
              <Text className='iconfont icon-right pet-home-chat-entry-arrow' />
            </View>
          </View>
        </View>

        <View className='pet-home-card'>
          <View className='pet-home-card-head'>
            <Text className='pet-home-card-title'>为什么是它</Text>
          </View>
          <View className='pet-home-reason-list'>
            {matchReasons.map((reason) => (
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
              {matchedCandidates.map((candidate) => (
                <View
                  key={candidate.id}
                  className={`pet-home-candidate-card ${isCandidateActive(candidate, petSummary?.pet) ? 'active' : ''}`}
                  onClick={() => handleSelectCandidate(candidate)}
                >
                  <PetAvatar pet={candidate} size='small' />
                  <Text className='pet-home-candidate-name'>{candidate.name}</Text>
                  <Text className='pet-home-candidate-style'>{candidateStyleText(candidate.style)} · {candidate.score || '--'}</Text>
                  <Text className='pet-home-candidate-action'>
                    {selectingCandidateId === candidate.id ? '' : isCandidateActive(candidate, petSummary?.pet) ? '当前' : '选择'}
                  </Text>
                  {selectingCandidateId === candidate.id ? <View className='pet-home-candidate-spinner' /> : null}
                </View>
              ))}
            </View>
          </View>
        ) : null}

        {commonCandidates.length ? (
          <View className='pet-home-card'>
            <View className='pet-home-card-head'>
              <Text className='pet-home-card-title'>常用形象</Text>
              <Text className='pet-home-card-side'>内置 · 免费</Text>
            </View>
            <View className='pet-home-candidate-grid pet-home-candidate-grid--common'>
              {commonCandidates.map((candidate) => (
                <View
                  key={candidate.id}
                  className={`pet-home-candidate-card ${isCandidateActive(candidate, petSummary?.pet) ? 'active' : ''}`}
                  onClick={() => handleSelectCandidate(candidate)}
                >
                  <PetAvatar pet={candidate} size='small' motion='companion' />
                  <Text className='pet-home-candidate-name'>{candidate.name}</Text>
                  <Text className='pet-home-candidate-action'>
                    {selectingCandidateId === candidate.id ? '' : isCandidateActive(candidate, petSummary?.pet) ? '当前' : '选择'}
                  </Text>
                  {selectingCandidateId === candidate.id ? <View className='pet-home-candidate-spinner' /> : null}
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
            <View className='pet-home-action-item' onClick={handleCustomizePixelAvatar}>
              <View>
                <Text className='pet-home-action-title'>专属像素分身</Text>
                <Text className='pet-home-action-desc'>用一张清晰人像生成你的像素伙伴</Text>
              </View>
              <View className='pet-home-action-side'>
                <Text className='pet-home-action-cost'>
                  {pixelAvatarCustomizing ? '' : petSummary?.pet?.pixel_avatar_url ? '重新生成' : '生成'}
                </Text>
                {pixelAvatarCustomizing ? <View className='pet-home-action-spinner' /> : null}
                <Text className='iconfont icon-right pet-home-action-arrow' />
              </View>
            </View>
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

      {pixelAvatarPreview ? (
        <View className='pet-pixel-preview-modal'>
          <View className='pet-pixel-preview-mask' onClick={closePixelAvatarPreview} />
          <View className='pet-pixel-preview-sheet'>
            <Text className='pet-pixel-preview-title'>专属像素分身已生成</Text>
            <Text className='pet-pixel-preview-desc'>已经保存并同步到首页，这是你的新伙伴。</Text>
            <View className='pet-pixel-preview-stage'>
              <View className='pet-pixel-preview-glow' />
              <PetAvatar pet={pixelAvatarPreview} size='large' motion='companion' />
              <View className='pet-pixel-preview-shadow' />
            </View>
            <View className='pet-pixel-preview-actions'>
              <View className='pet-pixel-preview-btn secondary' onClick={closePixelAvatarPreview}>
                <Text className='pet-pixel-preview-btn-text secondary'>留在这里</Text>
              </View>
              <View className='pet-pixel-preview-btn primary' onClick={viewPixelAvatarOnHome}>
                <Text className='pet-pixel-preview-btn-text primary'>回首页看看</Text>
              </View>
            </View>
          </View>
        </View>
      ) : null}
    </View>
  )
}

export default withAuth(PetHomePage)
