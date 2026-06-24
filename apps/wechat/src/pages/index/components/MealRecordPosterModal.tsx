import { View, Canvas } from '@tarojs/components'
import React, { useCallback, useEffect, useState } from 'react'
import Taro from '@tarojs/taro'
import { extraPkgUrl } from '../../../utils/subpackage-extra'
import {
  getShareQrEnvVersion,
  getUnlimitedQRCode,
  getFriendInviteProfile,
  getPosterCalorieCompare,
  getMyMembership,
  showUnifiedApiError,
  type FoodRecord
} from '../../../utils/api'
import { drawRecordPoster, POSTER_WIDTH, POSTER_HEIGHT, computePosterHeight } from '../../../utils/poster'
import { isShowShareImageMenuCancel } from '../../../utils/weapp-share-image'
import { resolveCanvasImageSrc } from '../../../utils/weapp-canvas-image'
import { getCurrentPosterUserProfile, getLocalPosterUserProfile, mergePosterUserProfile } from '../../../utils/poster-profile'
import { claimSharePosterRewardQuietly } from '../../../utils/share-reward'

import './MealRecordPosterModal.scss'

function getInviteCodeFromUserId(userId: string): string {
  const raw = (userId || '').replace(/-/g, '').toLowerCase()
  return raw.length >= 8 ? raw.slice(0, 8) : ''
}

/** 供首页 useShareAppMessage 在餐次海报打开时带上卡片图与详情 path */
export interface MealPosterSharePayload {
  imageUrl: string
  path: string
  title: string
}

interface MealRecordPosterModalProps {
  visible: boolean
  record: FoodRecord | null
  onClose: () => void
  /** 海报可分享时同步上下文；关闭或无图时传 null */
  onShareContextChange?: (ctx: MealPosterSharePayload | null) => void
}

export function MealRecordPosterModal({ visible, record, onClose, onShareContextChange }: MealRecordPosterModalProps) {
  const [posterGenerating, setPosterGenerating] = useState(false)
  const [posterImageUrl, setPosterImageUrl] = useState<string | null>(null)
  const [isProUser, setIsProUser] = useState(false)
  const [ownerNickname, setOwnerNickname] = useState('')
  const [ownerAvatar, setOwnerAvatar] = useState('')
  const [ownerInviteCode, setOwnerInviteCode] = useState('')
  const [calorieCompare, setCalorieCompare] = useState<any>(null)

  const safeRecordId = String(record?.id || '').trim()
  const safeUserId = String(record?.user_id || '').trim()

  const resolvePosterOwnerProfile = useCallback(async () => {
    const ownerUserId = safeUserId || String(Taro.getStorageSync('user_id') || '').trim()
    const fallbackInviteCode = ownerUserId ? getInviteCodeFromUserId(ownerUserId) : ''
    const currentProfile = await getCurrentPosterUserProfile(ownerUserId)
    if (!ownerUserId) {
      return { nickname: currentProfile.nickname, avatar: currentProfile.avatar, inviteCode: '' }
    }

    try {
      const remoteProfile = await getFriendInviteProfile(ownerUserId)
      const mergedProfile = mergePosterUserProfile(remoteProfile, currentProfile)
      return {
        nickname: mergedProfile.nickname,
        avatar: mergedProfile.avatar,
        inviteCode: remoteProfile.invite_code || fallbackInviteCode,
      }
    } catch {
      return {
        nickname: currentProfile.nickname,
        avatar: currentProfile.avatar,
        inviteCode: fallbackInviteCode,
      }
    }
  }, [safeUserId])

  const openOfficialImageMenu = useCallback(async (path: string) => {
    if (!path) return
    Taro.showShareImageMenu({
      path,
      success: () => {
        if (safeRecordId) {
          void claimSharePosterRewardQuietly(safeRecordId)
        }
        onClose()
      },
      fail: (err: { errMsg?: string }) => {
        if (isShowShareImageMenuCancel(err)) {
          onClose()
          return
        }
        console.error('showShareImageMenu fail', err)
        onClose()
        void showUnifiedApiError(new Error('打开微信图片菜单失败，请重试'), '打开微信图片菜单失败，请重试')
      }
    })
  }, [onClose, safeRecordId])

  useEffect(() => {
    setOwnerNickname('')
    setOwnerAvatar('')
    setOwnerInviteCode('')
    setCalorieCompare(null)
    if (visible && record) {
      const ownerUserId = safeUserId || String(Taro.getStorageSync('user_id') || '').trim()
      const localProfile = getLocalPosterUserProfile(ownerUserId)
      if (localProfile.nickname) setOwnerNickname(localProfile.nickname)
      if (localProfile.avatar) setOwnerAvatar(localProfile.avatar)
      getCurrentPosterUserProfile(ownerUserId).then(profile => {
        if (profile.nickname) setOwnerNickname(profile.nickname)
        if (profile.avatar) setOwnerAvatar(profile.avatar)
      }).catch(() => {})
      getMyMembership().then(ms => setIsProUser(ms.is_pro)).catch(() => {})
      if (ownerUserId) {
        getFriendInviteProfile(ownerUserId)
        .then(profile => {
          const mergedProfile = mergePosterUserProfile(profile, getLocalPosterUserProfile(ownerUserId))
          setOwnerNickname(mergedProfile.nickname)
          setOwnerAvatar(mergedProfile.avatar)
          setOwnerInviteCode(profile.invite_code || getInviteCodeFromUserId(ownerUserId))
        })
        .catch(() => {
          setOwnerInviteCode(getInviteCodeFromUserId(ownerUserId))
        })
      }
      if (safeRecordId) {
        getPosterCalorieCompare(safeRecordId)
        .then(data => {
          if (!data) return
          setCalorieCompare({
            mealPlanKcal: Number.isFinite(data.meal_plan_kcal) ? data.meal_plan_kcal : 0,
            hasBaseline: !!data.has_baseline,
            deltaKcal: Number.isFinite(data.delta_kcal) ? data.delta_kcal : 0,
            baselineKcal: Number.isFinite(data.baseline_kcal) ? data.baseline_kcal : 0,
          })
        })
        .catch(() => {})
      }
    }
  }, [visible, record, safeRecordId, safeUserId])

  useEffect(() => {
    if (visible && record && !posterGenerating && !posterImageUrl) {
      const timer = setTimeout(() => {
        handleGeneratePoster()
      }, 100)
      return () => clearTimeout(timer)
    }
  }, [visible, record])

  useEffect(() => {
    if (!visible) {
      setPosterImageUrl(null)
      setPosterGenerating(false)
      // 自定义 tabBar 下不调用 showTabBar/hideTabBar，避免原生 tabBar 叠加
    } else {
      // 自定义 tabBar 下不调用 showTabBar/hideTabBar，避免原生 tabBar 叠加
    }
    return () => {
      // 自定义 tabBar 下不调用 showTabBar/hideTabBar，避免原生 tabBar 叠加
    }
  }, [visible])

  useEffect(() => {
    if (!onShareContextChange) return
    if (visible && posterImageUrl && record && safeRecordId) {
      const oid = safeUserId
      const ic = ownerInviteCode || getInviteCodeFromUserId(oid)
      const path = `${extraPkgUrl('/pages/record-detail/index')}?id=${encodeURIComponent(safeRecordId)}${oid ? `&from_user_id=${encodeURIComponent(oid)}` : ''}${ic ? `&invite_code=${encodeURIComponent(ic)}` : ''}`
      const title = ownerNickname ? `${ownerNickname}邀你来食探，达标后各得15积分` : '加入食探并完成2天打卡，双方各得15积分'
      onShareContextChange({ imageUrl: posterImageUrl, path, title })
    } else {
      onShareContextChange(null)
    }
  }, [visible, posterImageUrl, record, safeRecordId, safeUserId, ownerInviteCode, ownerNickname, onShareContextChange])

  const handleGeneratePoster = useCallback(() => {
    if (!record || posterGenerating) return
    setPosterGenerating(true)
    Taro.showLoading({ title: '生成海报中...' })

    const query = Taro.createSelectorQuery()
    query
      .select('#homeMealRecordPosterCanvas')
      .fields({ node: true, size: true })
      .exec(async (res) => {
        if (!res?.[0]?.node) {
          Taro.hideLoading()
          setPosterGenerating(false)
          void showUnifiedApiError(new Error('画布未就绪，请重试'), '画布未就绪，请重试')
          return
        }
        const canvas = res[0].node as HTMLCanvasElement & { createImage?: () => { src: string; onload: () => void; onerror: (err?: any) => void; width: number; height: number } }
        const dpr = 2
        canvas.width = POSTER_WIDTH * dpr
        canvas.height = POSTER_HEIGHT * dpr

        const loadImage = async (src: string): Promise<{ width: number; height: number } | null> => {
          if (!src || !canvas.createImage) return null
          let localSrc: string
          try {
            localSrc = await resolveCanvasImageSrc(src)
          } catch (e) {
            console.error('resolveCanvasImageSrc fail', src, e)
            return null
          }
          return new Promise<{ width: number; height: number } | null>((resolve) => {
            const img = canvas.createImage!()
            img.onload = () => resolve(img)
            img.onerror = (e) => {
              console.error('Load image fail', localSrc, e)
              resolve(null)
            }
            img.src = localSrc
          })
        }

        const resolvedProfile = await resolvePosterOwnerProfile()
        const posterNickname = resolvedProfile.nickname
        const posterAvatar = resolvedProfile.avatar
        const posterInviteCode = resolvedProfile.inviteCode || ownerInviteCode
        if (posterNickname) setOwnerNickname(posterNickname)
        if (posterAvatar) setOwnerAvatar(posterAvatar)
        if (posterInviteCode) setOwnerInviteCode(posterInviteCode)

        const loadQRImage = async () => {
          const scene = posterInviteCode ? `fi=${posterInviteCode}` : 'share=1'
          try {
            const { base64 } = await getUnlimitedQRCode(scene, 'pages/index/index', getShareQrEnvVersion())
            const img = await loadImage(base64)
            if (img) return img
          } catch (e) {
            console.warn('QR code load failed for env=release', e)
          }
          return null
        }

        Promise.all([
          loadImage(record.image_path || ''),
          loadQRImage(),
          loadImage(posterAvatar)
        ]).then(([mainImg, qrImg, avatarImg]) => {
          try {
            const ctx = canvas.getContext('2d')
            if (!ctx) {
              Taro.hideLoading()
              setPosterGenerating(false)
              void showUnifiedApiError(new Error('画布不可用'), '画布不可用')
              return
            }

            const dynamicHeight = computePosterHeight(
              ctx,
              record,
              POSTER_WIDTH,
              isProUser,
              calorieCompare || undefined
            )
            canvas.width = POSTER_WIDTH * dpr
            canvas.height = dynamicHeight * dpr
            ctx.scale(dpr, dpr)

            drawRecordPoster(ctx, {
              width: POSTER_WIDTH,
              height: dynamicHeight,
              record,
              calorieCompare: calorieCompare || undefined,
              image: mainImg,
              qrCodeImage: qrImg,
              sharerNickname: posterNickname,
              sharerAvatarImage: avatarImg,
              isPro: isProUser,
            })

            // JPG + 不透明：海报本身有底色，交给微信官方图片菜单处理分享/保存。
            Taro.canvasToTempFilePath({
              canvas: canvas as any,
              destWidth: POSTER_WIDTH * 2,
              destHeight: dynamicHeight * 2,
              fileType: 'jpg',
              quality: 0.95,
              success: (resp) => {
                Taro.hideLoading()
                setPosterGenerating(false)
                setPosterImageUrl(resp.tempFilePath)
                void openOfficialImageMenu(resp.tempFilePath)
              },
              fail: (err) => {
                Taro.hideLoading()
                setPosterGenerating(false)
                void showUnifiedApiError(new Error('生成失败'), '生成失败')
                console.error('canvasToTempFilePath fail', err)
              }
            })
          } catch (e) {
            Taro.hideLoading()
            setPosterGenerating(false)
            void showUnifiedApiError(e, '绘制失败')
            console.error('drawSmartPoster error', e)
          }
        })
      })
  }, [record, posterGenerating, isProUser, ownerInviteCode, calorieCompare, openOfficialImageMenu, resolvePosterOwnerProfile])

  return (
    <View className='poster-canvas-wrap'>
      <Canvas
        type='2d'
        id='homeMealRecordPosterCanvas'
        className='poster-canvas'
        style={{ width: `${POSTER_WIDTH}px`, height: `${POSTER_HEIGHT}px` }}
      />
    </View>
  )
}
