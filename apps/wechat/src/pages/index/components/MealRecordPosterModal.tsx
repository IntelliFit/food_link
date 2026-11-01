import { View, Text, Image, Canvas, Button, ScrollView } from '@tarojs/components'
import React, { useCallback, useEffect, useRef, useState } from 'react'
import Taro from '@tarojs/taro'
import { extraPkgUrl } from '../../../utils/subpackage-extra'
import {
  getShareQrEnvVersion, getUnlimitedQRCode, getFriendInviteProfile, getPosterCalorieCompare,
  getMyMembership, showUnifiedApiError, type FoodRecord,
} from '../../../utils/api'
import { drawRecordPoster, POSTER_WIDTH, POSTER_HEIGHT, computePosterHeight } from '../../../utils/poster'
import { computeWatermarkPosterHeight, drawWatermarkRecordPoster, WATERMARK_STYLES, type PosterLabels, type WatermarkStyle } from '../../../utils/watermark-record-poster'
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

/** 水印打卡图按 3 倍导出，照片分享出去不发糊；无照片的营养卡片维持 2 倍。 */
const WATERMARK_EXPORT_SCALE = 3
const CLASSIC_EXPORT_SCALE = 2

type CanvasImage = { width: number; height: number }
type PosterCanvas = HTMLCanvasElement & {
  createImage: () => CanvasImage & { src: string; onload: () => void; onerror: () => void }
}

function inviteCodeFor(userId: string) {
  return userId.replace(/-/g, '').toLowerCase().slice(0, 8)
}

export function MealRecordPosterModal({ visible, record, onClose, onShareContextChange, afterSave = false, allowReward = true }: MealRecordPosterModalProps) {
  const [style, setStyle] = useState<WatermarkStyle>('strip')
  const [labels, setLabels] = useState<PosterLabels>('nutrients')
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
  // 没有照片的记录（如文字记录）没法做水印，仍生成营养卡片。
  const usesPhoto = Boolean(photoSrc)
  const key = usesPhoto ? `${style}:${labels}:${photoSrc}` : 'classic'
  const currentPoster = posterKey === key ? poster : null

  useEffect(() => {
    cache.current.clear()
    loadedImages.current.clear()
    ownerAssets.current = null
    classicDetails.current = null
    setPoster(null)
    setPosterKey('')
    setError('')
    setStyle('strip')
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
      if (!usesPhoto && !classicDetails.current) {
        classicDetails.current = Promise.all([
          isDebug ? Promise.resolve(null) : getMyMembership().catch(() => null),
          isDebug ? Promise.resolve(null) : getPosterCalorieCompare(record.id).catch(() => null),
        ]).then(([membership, compare]) => ({ membership, compare }))
      }
      const [mainImg, { profile, qrImg }, details] = await Promise.all([
        loadImage(photoSrc),
        ownerAssets.current,
        usesPhoto ? Promise.resolve(null) : classicDetails.current,
      ])
      if (!active) return
      if (usesPhoto && (!mainImg || mainImg.width <= 0 || mainImg.height <= 0)) {
        throw new Error('原图读取失败，请重试')
      }
      const avatarImg = usesPhoto ? null : await loadImage(profile.avatar)
      if (!active) return
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('画布不可用，请重试')
      const { membership, compare } = details || { membership: null, compare: null }
      const calorieCompare = compare ? {
        mealPlanKcal: compare.meal_plan_kcal, hasBaseline: compare.has_baseline,
        deltaKcal: compare.delta_kcal, baselineKcal: compare.baseline_kcal,
      } : undefined
      const height = usesPhoto && mainImg
        ? computeWatermarkPosterHeight(style, mainImg, POSTER_WIDTH)
        : computePosterHeight(ctx, record, POSTER_WIDTH, membership?.is_pro, calorieCompare)
      const exportScale = usesPhoto ? WATERMARK_EXPORT_SCALE : CLASSIC_EXPORT_SCALE
      canvas.width = POSTER_WIDTH * exportScale
      canvas.height = height * exportScale
      ctx.scale(exportScale, exportScale)
      if (usesPhoto && mainImg) {
        drawWatermarkRecordPoster(ctx, { style, width: POSTER_WIDTH, height, image: mainImg, record, labels, nickname: profile.nickname, qrCodeImage: qrImg })
      } else {
        drawRecordPoster(ctx, {
          width: POSTER_WIDTH, height, record, image: mainImg, qrCodeImage: qrImg,
          sharerNickname: profile.nickname, sharerAvatarImage: avatarImg, isPro: membership?.is_pro, calorieCompare,
        })
      }
      const exported = await Taro.canvasToTempFilePath({
        canvas: canvas as any, destWidth: POSTER_WIDTH * exportScale, destHeight: height * exportScale, fileType: 'jpg', quality: 0.95,
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
  }, [visible, record, style, labels, photoSrc, key, retry])

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
  const previewBody = generating ? <View className='record-share-placeholder'><View className='record-share-spinner' /></View> : currentPoster ? (
    <Image
      className={usesPhoto ? 'record-share-fit' : 'record-share-image'}
      src={currentPoster.imageUrl}
      mode={usesPhoto ? 'aspectFit' : 'widthFix'}
      onClick={() => Taro.previewImage({ current: currentPoster.imageUrl, urls: [currentPoster.imageUrl] })}
    />
  ) : <View className='record-share-placeholder'><Text>{error}</Text><Button className='record-share-retry' onClick={() => { loadedImages.current.clear(); setRetry(n => n + 1) }}>重试</Button></View>
  return (
    <View className='record-share-panel'>
      <View className='record-share-header'>
        <View>
          <Text className='record-share-title'>{afterSave ? '已记录，分享这份美味' : '分享美食打卡'}</Text>
          <Text className='record-share-subtitle'>{usesPhoto ? '选一款相机水印' : '这餐没有照片，生成营养卡片'}</Text>
        </View>
        <View className='record-share-close' onClick={onClose}>×</View>
      </View>
      {usesPhoto
        ? <View className='record-share-stage'>{previewBody}</View>
        : <ScrollView scrollY className='record-share-preview'>{previewBody}</ScrollView>}
      {usesPhoto && images.length > 1 && (
        <ScrollView scrollX className='record-share-photos'>
          {images.map((src, index) => <Image key={`${src}-${index}`} className={`record-share-photo ${imageIndex === index ? 'active' : ''}`} src={src} mode='aspectFill' onClick={() => setImageIndex(index)} />)}
        </ScrollView>
      )}
      {usesPhoto && (
        <ScrollView scrollX className='record-share-styles'>
          {WATERMARK_STYLES.map(option => (
            <View key={option.id} className={`record-share-style record-share-style-${option.id} ${style === option.id ? 'active' : ''}`} onClick={() => setStyle(option.id)}>
              <View className={`wm-thumb wm-thumb-${option.id}`}>
                <Image className='wm-thumb-photo' src={photoSrc} mode='aspectFill' />
                <View className='wm-thumb-info'>
                  <View className='wm-thumb-bar wm-thumb-bar-main' />
                  <View className='wm-thumb-bar' />
                </View>
              </View>
              <Text className='record-share-style-name'>{option.name}</Text>
            </View>
          ))}
        </ScrollView>
      )}
      {usesPhoto && (
        <View className='record-share-labels'>
          <View className={`record-share-label-calories ${labels === 'calories' ? 'active' : ''}`} onClick={() => setLabels('calories')}>只标热量</View>
          <View className={`record-share-label-nutrients ${labels === 'nutrients' ? 'active' : ''}`} onClick={() => setLabels('nutrients')}>热量 + 营养</View>
        </View>
      )}
      <View className='record-share-footer'>
        <Button className='record-share-submit' disabled={!currentPoster || generating} onClick={shareImage}>分享 / 保存图片</Button>
        <View className='record-share-skip' onClick={onClose}>{afterSave ? '先不分享，回首页' : '完成'}</View>
      </View>
      <View className='poster-canvas-wrap'><Canvas type='2d' id='homeMealRecordPosterCanvas' style={{ width: `${POSTER_WIDTH}px`, height: `${POSTER_HEIGHT}px` }} /></View>
    </View>
  )
}
