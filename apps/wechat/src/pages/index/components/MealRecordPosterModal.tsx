import { View, Text, Image, Canvas, Button, ScrollView } from '@tarojs/components'
import React, { useCallback, useEffect, useRef, useState } from 'react'
import Taro from '@tarojs/taro'
import { extraPkgUrl } from '../../../utils/subpackage-extra'
import {
  getShareQrEnvVersion, getUnlimitedQRCode, getFriendInviteProfile, getPosterCalorieCompare,
  getMyMembership, showUnifiedApiError, type FoodRecord,
} from '../../../utils/api'
import { drawRecordPoster, POSTER_WIDTH, POSTER_HEIGHT, computePosterHeight } from '../../../utils/poster'
import { computePhotoPosterHeight, drawPhotoRecordPoster, type PhotoPosterLabels } from '../../../utils/photo-record-poster'
import { isShowShareImageMenuCancel } from '../../../utils/weapp-share-image'
import { resolveCanvasImageSrc } from '../../../utils/weapp-canvas-image'
import { getCurrentPosterUserProfile, getLocalPosterUserProfile, mergePosterUserProfile, type PosterUserProfile } from '../../../utils/poster-profile'
import { claimSharePosterRewardQuietly } from '../../../utils/share-reward'
import './MealRecordPosterModal.scss'

export interface MealPosterSharePayload {
  imageUrl: string
  path: string
  title: string
}

interface MealRecordPosterModalProps {
  visible: boolean
  record: FoodRecord | null
  onClose: () => void
  onShareContextChange?: (ctx: MealPosterSharePayload | null) => void
  afterSave?: boolean
  /** 只有记录本人可领取分享奖励。 */
  allowReward?: boolean
}

type CanvasImage = { width: number; height: number }
type PosterCanvas = HTMLCanvasElement & {
  createImage: () => CanvasImage & { src: string; onload: () => void; onerror: () => void }
}

function inviteCodeFor(userId: string) {
  return userId.replace(/-/g, '').toLowerCase().slice(0, 8)
}

export function MealRecordPosterModal({ visible, record, onClose, onShareContextChange, afterSave = false, allowReward = true }: MealRecordPosterModalProps) {
  const [style, setStyle] = useState<'classic' | 'photo'>('photo')
  const [labels, setLabels] = useState<PhotoPosterLabels>('nutrients')
  const [imageIndex, setImageIndex] = useState(0)
  const [generating, setGenerating] = useState(false)
  const [poster, setPoster] = useState<MealPosterSharePayload | null>(null)
  const [posterKey, setPosterKey] = useState('')
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  const cache = useRef(new Map<string, MealPosterSharePayload>())
  const loadedImages = useRef(new Map<string, Promise<CanvasImage | null>>())
  const ownerAssets = useRef<Promise<{ profile: PosterUserProfile & { inviteCode: string }; qrImg: CanvasImage | null }> | null>(null)
  const classicDetails = useRef<Promise<{
    membership: Awaited<ReturnType<typeof getMyMembership>> | null
    compare: Awaited<ReturnType<typeof getPosterCalorieCompare>> | null
  }> | null>(null)
  const rewardClaiming = useRef(false)
  const images = record?.image_paths?.length ? record.image_paths : record?.image_path ? [record.image_path] : []
  const photoSrc = images[imageIndex] || images[0] || ''
  const effectiveStyle = photoSrc ? style : 'classic'
  const key = effectiveStyle === 'classic' ? 'classic' : `photo:${labels}:${photoSrc}`
  const currentPoster = posterKey === key ? poster : null

  useEffect(() => {
    cache.current.clear()
    loadedImages.current.clear()
    ownerAssets.current = null
    classicDetails.current = null
    setPoster(null)
    setPosterKey('')
    setError('')
    setStyle('photo')
    setLabels('nutrients')
    setImageIndex(0)
  }, [visible, record])

  useEffect(() => {
    onShareContextChange?.(visible ? currentPoster : null)
    return () => onShareContextChange?.(null)
  }, [visible, currentPoster, onShareContextChange])

  useEffect(() => {
    if (!visible || !record) return
    let active = true
    setError('')
    setPoster(null)
    const cached = cache.current.get(key)
    if (cached) {
      setPoster(cached)
      setPosterKey(key)
      setGenerating(false)
      return
    }
    setGenerating(true)

    const generate = async () => {
      const canvas = await new Promise<PosterCanvas>((resolve, reject) => {
        Taro.createSelectorQuery().select('#homeMealRecordPosterCanvas').fields({ node: true, size: true }).exec(res => {
          if (res?.[0]?.node) resolve(res[0].node)
          else reject(new Error('画布未就绪，请重试'))
        })
      })
      const loadImageOnce = async (src: string): Promise<CanvasImage | null> => {
        if (!src) return null
        try {
          const local = await resolveCanvasImageSrc(src)
          return await new Promise<CanvasImage | null>(resolve => {
            const img = canvas.createImage()
            const timer = setTimeout(() => resolve(null), 10000)
            img.onload = () => { clearTimeout(timer); resolve(img) }
            img.onerror = () => { clearTimeout(timer); resolve(null) }
            img.src = local
          })
        } catch { return null }
      }
      const loadImage = (src: string) => {
        const existing = loadedImages.current.get(src)
        if (existing) return existing
        const pending = loadImageOnce(src)
        loadedImages.current.set(src, pending)
        return pending
      }
      const isDebug = record.id.startsWith('debug-')
      const ownerId = String(record.user_id || Taro.getStorageSync('user_id') || '')
      const localProfile = getLocalPosterUserProfile(ownerId)
      const resolveProfile = async () => {
        if (isDebug) return { ...localProfile, inviteCode: '' }
        const [current, remote] = await Promise.all([
          getCurrentPosterUserProfile(ownerId), getFriendInviteProfile(ownerId).catch(() => null),
        ])
        return { ...mergePosterUserProfile(remote, current), inviteCode: remote?.invite_code || inviteCodeFor(ownerId) }
      }
      if (!ownerAssets.current) {
        ownerAssets.current = resolveProfile().then(async profile => {
          const qrImg = isDebug ? null : await getUnlimitedQRCode(profile.inviteCode ? `fi=${profile.inviteCode}` : 'share=1', 'pages/index/index', getShareQrEnvVersion())
            .then(qr => loadImage(qr.base64)).catch(() => null)
          return { profile, qrImg }
        })
      }
      if (effectiveStyle === 'classic' && !classicDetails.current) {
        classicDetails.current = Promise.all([
          isDebug ? Promise.resolve(null) : getMyMembership().catch(() => null),
          isDebug ? Promise.resolve(null) : getPosterCalorieCompare(record.id).catch(() => null),
        ]).then(([membership, compare]) => ({ membership, compare }))
      }
      const [mainImg, { profile, qrImg }, details] = await Promise.all([
        loadImage(effectiveStyle === 'photo' ? photoSrc : (record.image_path || images[0] || '')),
        ownerAssets.current,
        effectiveStyle === 'classic' ? classicDetails.current : Promise.resolve(null),
      ])
      if (!active) return
      if (effectiveStyle === 'photo' && (!mainImg || mainImg.width <= 0 || mainImg.height <= 0)) {
        throw new Error('原图读取失败，请重试或选择经典海报')
      }
      const avatarImg = effectiveStyle === 'classic' ? await loadImage(profile.avatar) : null
      if (!active) return
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('画布不可用，请重试')
      const { membership, compare } = details || { membership: null, compare: null }
      const calorieCompare = compare ? {
        mealPlanKcal: compare.meal_plan_kcal, hasBaseline: compare.has_baseline,
        deltaKcal: compare.delta_kcal, baselineKcal: compare.baseline_kcal,
      } : undefined
      const height = effectiveStyle === 'photo' && mainImg
        ? computePhotoPosterHeight(mainImg, POSTER_WIDTH)
        : computePosterHeight(ctx, record, POSTER_WIDTH, membership?.is_pro, calorieCompare)
      canvas.width = POSTER_WIDTH * 2
      canvas.height = height * 2
      ctx.scale(2, 2)
      if (effectiveStyle === 'photo' && mainImg) {
        drawPhotoRecordPoster(ctx, { width: POSTER_WIDTH, height, image: mainImg, record, labels, nickname: profile.nickname, qrCodeImage: qrImg })
      } else {
        drawRecordPoster(ctx, {
          width: POSTER_WIDTH, height, record, image: mainImg, qrCodeImage: qrImg,
          sharerNickname: profile.nickname, sharerAvatarImage: avatarImg, isPro: membership?.is_pro, calorieCompare,
        })
      }
      const exported = await Taro.canvasToTempFilePath({
        canvas: canvas as any, destWidth: POSTER_WIDTH * 2, destHeight: height * 2, fileType: 'jpg', quality: 0.95,
      })
      if (!active) return
      const payload = {
        imageUrl: exported.tempFilePath,
        path: `${extraPkgUrl('/pages/record-detail/index')}?id=${encodeURIComponent(record.id)}&from_user_id=${encodeURIComponent(ownerId)}${profile.inviteCode ? `&invite_code=${encodeURIComponent(profile.inviteCode)}` : ''}`,
        title: `${profile.nickname || '我'}的${Math.round(record.total_calories || 0)} kcal 美食打卡`,
      }
      cache.current.set(key, payload)
      setPoster(payload)
      setPosterKey(key)
    }
    const timer = setTimeout(() => {
      void generate().catch(e => {
        if (active) setError(e instanceof Error ? e.message : '生成失败，请重试')
      }).finally(() => { if (active) setGenerating(false) })
    }, 100)
    return () => { active = false; clearTimeout(timer) }
    // images 内容由 record 决定，避免新数组触发重复导出。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, record, effectiveStyle, labels, photoSrc, key, retry])

  const shareImage = useCallback(() => {
    if (!currentPoster || generating || !record) return
    Taro.showShareImageMenu({
      path: currentPoster.imageUrl,
      success: () => {
        const currentId = String(Taro.getStorageSync('user_id') || '')
        if (!allowReward || currentId !== record.user_id || record.id.startsWith('debug-') || rewardClaiming.current) return
        rewardClaiming.current = true
        void claimSharePosterRewardQuietly(record.id).finally(() => { rewardClaiming.current = false })
      },
      fail: err => {
        if (!isShowShareImageMenuCancel(err)) void showUnifiedApiError(new Error('打开微信图片菜单失败，请重试'), '打开微信图片菜单失败，请重试')
      },
    })
  }, [currentPoster, generating, record, allowReward])

  if (!visible || !record) return null
  return (
    <View className='record-share-panel'>
      <View className='record-share-header'>
        <View>
          <Text className='record-share-title'>{afterSave ? '已记录，分享这份美味' : '分享美食打卡'}</Text>
          <Text className='record-share-subtitle'>选一张喜欢的打卡图</Text>
        </View>
        <View className='record-share-close' onClick={onClose}>×</View>
      </View>
      <View className='record-share-styles'>
        <View className={`record-share-style record-share-style-classic ${effectiveStyle === 'classic' ? 'active' : ''}`} onClick={() => setStyle('classic')}>
          <Text>经典海报</Text><Text className='record-share-style-desc'>保留原来的营养卡片</Text>
        </View>
        {photoSrc && <View className={`record-share-style record-share-style-photo ${effectiveStyle === 'photo' ? 'active' : ''}`} onClick={() => setStyle('photo')}>
          <Text>原图贴纸</Text><Text className='record-share-style-desc'>完整照片 + 可爱标注</Text>
        </View>}
      </View>
      {effectiveStyle === 'photo' && (
        <View className='record-share-labels'>
          <View className={`record-share-label-calories ${labels === 'calories' ? 'active' : ''}`} onClick={() => setLabels('calories')}>只标热量</View>
          <View className={`record-share-label-nutrients ${labels === 'nutrients' ? 'active' : ''}`} onClick={() => setLabels('nutrients')}>热量 + 营养</View>
        </View>
      )}
      {effectiveStyle === 'photo' && images.length > 1 && (
        <ScrollView scrollX className='record-share-photos'>
          {images.map((src, index) => <Image key={`${src}-${index}`} className={`record-share-photo ${imageIndex === index ? 'active' : ''}`} src={src} mode='aspectFill' onClick={() => setImageIndex(index)} />)}
        </ScrollView>
      )}
      <ScrollView scrollY className='record-share-preview'>
        {generating ? <View className='record-share-placeholder'><View className='record-share-spinner' /></View> : currentPoster ? (
          <Image className='record-share-image' src={currentPoster.imageUrl} mode='widthFix' onClick={() => Taro.previewImage({ current: currentPoster.imageUrl, urls: [currentPoster.imageUrl] })} />
        ) : <View className='record-share-placeholder'><Text>{error}</Text><Button className='record-share-retry' onClick={() => { loadedImages.current.clear(); setRetry(n => n + 1) }}>重试</Button></View>}
      </ScrollView>
      <View className='record-share-footer'>
        <Button className='record-share-submit' disabled={!currentPoster || generating} onClick={shareImage}>分享 / 保存图片</Button>
        <View className='record-share-skip' onClick={onClose}>{afterSave ? '先不分享，回首页' : '完成'}</View>
      </View>
      <View className='poster-canvas-wrap'><Canvas type='2d' id='homeMealRecordPosterCanvas' style={{ width: `${POSTER_WIDTH}px`, height: `${POSTER_HEIGHT}px` }} /></View>
    </View>
  )
}
