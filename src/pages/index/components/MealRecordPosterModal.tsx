import { View, Text, Image, Canvas, Button } from '@tarojs/components'
import React, { useCallback, useEffect, useState } from 'react'
import Taro from '@tarojs/taro'
import { extraPkgUrl } from '../../../utils/subpackage-extra'
import {
  getUnlimitedQRCode,
  getFriendInviteProfile,
  getPosterCalorieCompare,
  getMyMembership,
  type FoodRecord
} from '../../../utils/api'
import { drawRecordPoster, POSTER_WIDTH, POSTER_HEIGHT, computePosterHeight } from '../../../utils/poster'
import { resolveCanvasImageSrc } from '../../../utils/weapp-canvas-image'
import { savePosterToPhotosAlbum } from '../../../utils/weapp-save-image-album'

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

  useEffect(() => {
    if (visible && record) {
      getMyMembership().then(ms => setIsProUser(ms.is_pro)).catch(() => {})
      getFriendInviteProfile(record.user_id)
        .then(profile => {
          setOwnerNickname(profile.nickname || '')
          setOwnerAvatar(profile.avatar || '')
          setOwnerInviteCode(profile.invite_code || getInviteCodeFromUserId(record.user_id))
        })
        .catch(() => {
          setOwnerInviteCode(getInviteCodeFromUserId(record.user_id))
        })
      getPosterCalorieCompare(record.id)
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
  }, [visible, record])

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
    if (visible && posterImageUrl && record) {
      const oid = record.user_id || ''
      const ic = ownerInviteCode || getInviteCodeFromUserId(oid)
      const path = `${extraPkgUrl('/pages/record-detail/index')}?id=${encodeURIComponent(record.id)}${oid ? `&from_user_id=${encodeURIComponent(oid)}` : ''}${ic ? `&invite_code=${encodeURIComponent(ic)}` : ''}`
      const title = ownerNickname ? `${ownerNickname}的饮食记录，邀你一起健康打卡` : '来看看我的健康饮食记录吧！'
      onShareContextChange({ imageUrl: posterImageUrl, path, title })
    } else {
      onShareContextChange(null)
    }
  }, [visible, posterImageUrl, record, ownerInviteCode, ownerNickname, onShareContextChange])

  const handleGeneratePoster = useCallback(() => {
    if (!record || posterGenerating) return
    setPosterGenerating(true)
    Taro.showLoading({ title: '生成海报中...' })

    const query = Taro.createSelectorQuery()
    query
      .select('#homeMealRecordPosterCanvas')
      .fields({ node: true, size: true })
      .exec((res) => {
        if (!res?.[0]?.node) {
          Taro.hideLoading()
          setPosterGenerating(false)
          Taro.showToast({ title: '画布未就绪，请重试', icon: 'none' })
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

        const loadQRImage = async () => {
          const scene = ownerInviteCode ? `fi=${ownerInviteCode}` : 'share=1'
          const isDevelopmentEnv = typeof process !== 'undefined' && process?.env?.NODE_ENV === 'development'
          const envCandidates: Array<'develop' | 'trial' | 'release'> = isDevelopmentEnv
            ? ['develop', 'trial', 'release']
            : ['release', 'trial', 'develop']

          for (const envVersion of envCandidates) {
            try {
              const { base64 } = await getUnlimitedQRCode(scene, 'pages/index/index', envVersion)
              const img = await loadImage(base64)
              if (img) return img
            } catch (e) {
              console.warn(`QR code load failed for env=${envVersion}`, e)
            }
          }
          return null
        }

        Promise.all([
          loadImage(record.image_path || ''),
          loadQRImage(),
          loadImage(ownerAvatar || '')
        ]).then(([mainImg, qrImg, avatarImg]) => {
          try {
            const ctx = canvas.getContext('2d')
            if (!ctx) {
              Taro.hideLoading()
              setPosterGenerating(false)
              Taro.showToast({ title: '画布不可用', icon: 'none' })
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
              sharerNickname: ownerNickname,
              sharerAvatarImage: avatarImg,
              isPro: isProUser,
            })

            Taro.canvasToTempFilePath({
              canvas: canvas as any,
              destWidth: POSTER_WIDTH * 2,
              destHeight: dynamicHeight * 2,
              fileType: 'png',
              transparent: true,
              success: (resp) => {
                Taro.hideLoading()
                setPosterGenerating(false)
                setPosterImageUrl(resp.tempFilePath)
              },
              fail: (err) => {
                Taro.hideLoading()
                setPosterGenerating(false)
                Taro.showToast({ title: '生成失败', icon: 'none' })
                console.error('canvasToTempFilePath fail', err)
              }
            })
          } catch (e) {
            Taro.hideLoading()
            setPosterGenerating(false)
            Taro.showToast({ title: '绘制失败', icon: 'none' })
            console.error('drawSmartPoster error', e)
          }
        })
      })
  }, [record, posterGenerating, isProUser, ownerNickname, ownerAvatar, ownerInviteCode, calorieCompare])

  const handleSharePosterToMoments = useCallback(() => {
    if (!posterImageUrl) return
    // @ts-ignore needShowEntrance
    Taro.showShareImageMenu({
      path: posterImageUrl,
      needShowEntrance: false,
      fail: (err: { errMsg?: string }) => {
        console.error('showShareImageMenu fail', err)
        Taro.showToast({ title: '分享失败，请保存图片后手动发送', icon: 'none' })
      }
    })
  }, [posterImageUrl])

  const handleSavePoster = useCallback(() => {
    if (!posterImageUrl) return
    void savePosterToPhotosAlbum(posterImageUrl, {
      onSuccess: () => {
        Taro.showToast({ title: '已保存到相册', icon: 'success' })
        onClose()
      },
      onToast: (message) => {
        Taro.showToast({ title: message, icon: 'none' })
      }
    })
  }, [posterImageUrl, onClose])

  return (
    <>
      <View className='poster-canvas-wrap'>
        <Canvas
          type='2d'
          id='homeMealRecordPosterCanvas'
          className='poster-canvas'
          style={{ width: `${POSTER_WIDTH}px`, height: `${POSTER_HEIGHT}px` }}
        />
      </View>

      {visible && posterImageUrl && (
        <View className='poster-modal poster-modal--sheet' catchMove>
          <View className='poster-modal-shell' catchMove>
            <View className='poster-modal-topbar poster-modal-topbar--light poster-modal-topbar--title-only'>
              <Text className='poster-modal-title poster-modal-title--light'>分享今日卡片</Text>
            </View>
            <View className='poster-modal-dark-body'>
              <View className='poster-modal-inline-back' onClick={onClose}>
                <View className='poster-modal-close poster-modal-inline-close-hit'>
                  <Text className='poster-modal-close-x'>×</Text>
                </View>
              </View>
              <View className='poster-scroll-area'>
                <View className='poster-modal-scroll-inner'>
                  <View className='poster-modal-card-wrap'>
                    <Image src={posterImageUrl} mode='widthFix' className='poster-modal-image' />
                  </View>
                </View>
              </View>
            </View>
            <View className='poster-modal-bottom-bar'>
              <Button
                className='poster-share-channel poster-share-channel--btn'
                openType='share'
                plain
                hoverClass='poster-share-channel--hover'
                disabled={!posterImageUrl}
              >
                <View className='poster-share-channel-icon poster-share-channel-icon-wechat'>
                  <Text className='iconfont icon-wechat poster-share-channel-glyph' />
                </View>
                <Text className='poster-share-channel-label'>微信好友</Text>
              </Button>
              <View className='poster-share-channel' onClick={handleSharePosterToMoments}>
                <View className='poster-share-channel-icon poster-share-channel-icon-moments'>
                  <Text className='iconfont icon-fenxiang poster-share-channel-glyph' />
                </View>
                <Text className='poster-share-channel-label'>朋友圈</Text>
              </View>
              <View className='poster-share-channel' onClick={handleSavePoster}>
                <View className='poster-share-channel-icon poster-share-channel-icon-save'>
                  <Text className='iconfont icon-download poster-share-channel-glyph' />
                </View>
                <Text className='poster-share-channel-label'>保存图片</Text>
              </View>
            </View>
          </View>
        </View>
      )}
    </>
  )
}
