import { View, Text } from '@tarojs/components'
import { useCallback, useEffect, useRef, useState } from 'react'
import Taro, { useDidShow, usePullDownRefresh } from '@tarojs/taro'
import {
  getPetSummary,
  customizePetPixelAvatar,
  claimPetEvent,
  selectPetAppearance,
  type PetAppearanceCandidate,
  type PetOfflineEvent,
  type PetProfile,
  type PetSummary,
  showUnifiedApiError
} from '../../../utils/api'
import { withAuth } from '../../../utils/withAuth'
import { useAppColorScheme } from '../../../components/AppColorSchemeContext'
import { applyThemeNavigationBar } from '../../../utils/theme-navigation-bar'
import { PetAvatar } from '../../../components/PetAvatar'
import {
  chooseImageWithPrivacy,
  isPrivacyAuthorizeError,
  showPrivacyAuthorizeFailure,
} from '../../../utils/weapp-privacy'
import { HOME_PET_PROFILE_CHANGED_EVENT } from '../../../utils/pet-events'
import {
  getStoredPetSummary,
  loadPetSummaryWithRetry,
  saveStoredPetSummary,
} from '../../../utils/pet-summary-cache'
import { openPetChat } from '../../../utils/pet-navigation'
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
  const [pixelAvatarCustomizing, setPixelAvatarCustomizing] = useState(false)
  const [pixelAvatarPreview, setPixelAvatarPreview] = useState<PetProfile | null>(null)
  const [selectingCandidateId, setSelectingCandidateId] = useState('')
  const [petSummary, setPetSummary] = useState<PetSummary | null>(getStoredPetSummary)
  const [homePetHidden, setHomePetHidden] = useState(getStoredHomePetHidden)
  const pixelAvatarCustomizingRef = useRef(false)

  const syncPetProfile = useCallback((pet: PetProfile) => {
    setPetSummary((previous) => {
      if (!previous) return previous
      const next = { ...previous, pet }
      saveStoredPetSummary(next)
      return next
    })
    Taro.eventCenter.trigger(HOME_PET_PROFILE_CHANGED_EVENT, pet)
  }, [])

  const loadData = useCallback(async () => {
    try {
      setPetSummary(await loadPetSummaryWithRetry(() => getPetSummary()))
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
  const selectionCandidates = petSummary?.pet?.selection_candidates || []
  const commonCandidates = selectionCandidates.filter((candidate) => Boolean(candidate.builtin_avatar_id))
  const matchedCandidates = selectionCandidates.filter((candidate) => !candidate.builtin_avatar_id)
  const shouldShowSelection = matchedCandidates.length > 0
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

  const handleCustomizePixelAvatar = useCallback(async () => {
    if (pixelAvatarCustomizingRef.current) return
    pixelAvatarCustomizingRef.current = true
    setPixelAvatarCustomizing(true)
    try {
      const naming = await Taro.showModal({
        title: '给像素伙伴取名',
        content: petSummary?.pet?.name || '',
        confirmText: '下一步',
        cancelText: '暂不生成',
        // @ts-ignore 微信小程序支持可编辑 Modal，输入结果通过 content 返回。
        editable: true,
        // @ts-ignore
        placeholderText: '请输入宠物名字（最多 12 个字）',
      })
      if (!naming.confirm) return
      const petName = String((naming as any).content || '').trim()
      if (!petName) {
        Taro.showToast({ title: '请输入宠物名字', icon: 'none' })
        return
      }
      if (Array.from(petName).length > 12) {
        Taro.showToast({ title: '宠物名字最多 12 个字', icon: 'none' })
        return
      }

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
      const customized = await customizePetPixelAvatar(filePath, petName)
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
  }, [petSummary?.pet?.name, syncPetProfile])

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

  return (
    <View className={`pet-home-page ${scheme === 'dark' ? 'pet-home-page--dark' : ''}`}>
      <View className='pet-home-shell'>
        <View className='pet-home-hero'>
          <View className='pet-home-hero-main'>
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
              <View className='pet-home-stage-stat pet-home-stage-stat--experience'>
                <Text className='pet-home-stage-stat-label'>经验</Text>
                <Text className='pet-home-stage-stat-value'>{petSummary?.pet?.experience ?? 0}</Text>
              </View>
              <View className='pet-home-stage-stat pet-home-stage-stat--days'>
                <Text className='pet-home-stage-stat-label'>陪伴</Text>
                <Text className='pet-home-stage-stat-value'>{petSummary?.pet?.total_events ?? 0}天</Text>
              </View>
            </View>

            <View className='pet-home-hero-copy'>
              <View className='pet-home-name-link' onClick={openPetChat}>
                <Text className='pet-home-name'>{petSummary?.pet?.name || '健康伙伴'}</Text>
                <Text className='iconfont icon-right pet-home-name-arrow' />
              </View>
              {petEvent?.can_claim ? (
                <View className='pet-home-hero-reward' onClick={handleClaim}>
                  {claiming ? (
                    <View className='pet-home-hero-reward-spinner' />
                  ) : (
                    <Text className='pet-home-hero-reward-text'>领取 +{petEvent.exp_reward} 经验</Text>
                  )}
                </View>
              ) : null}
            </View>
          </View>

          <View className='pet-home-upgrade'>
            <View className='pet-home-upgrade-head'>
              <Text className='pet-home-upgrade-label'>升级到 Lv.{(petSummary?.pet?.level || 1) + 1}</Text>
              <Text className='pet-home-upgrade-value'>
                {petSummary?.pet?.level_exp ?? 0} / {petSummary?.pet?.next_level_exp ?? 0}
              </Text>
            </View>
            <View className='pet-home-upgrade-progress'>
              <View
                className='pet-home-upgrade-progress-fill'
                style={{ width: `${petSummary?.pet?.level_progress ?? 0}%` }}
              />
            </View>
          </View>
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
                <Text className='pet-home-action-title'>首页成长伙伴</Text>
                <Text className='pet-home-action-desc'>{homePetHidden ? '当前首页不显示伙伴卡片，数据和成长仍会保留' : '当前首页会在“伙伴”页展示状态、任务和聊天入口'}</Text>
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
          </View>
        </View>

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
