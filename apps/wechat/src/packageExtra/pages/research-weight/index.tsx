import { Text, Textarea, View } from '@tarojs/components'
import { useCallback, useEffect, useRef, useState } from 'react'
import Taro, { useDidShow } from '@tarojs/taro'
import { useAppColorScheme } from '../../../components/AppColorSchemeContext'
import { applyThemeNavigationBar } from '../../../utils/theme-navigation-bar'
import { extraPkgUrl } from '../../../utils/subpackage-extra'
import { getAccessToken, showUnifiedApiError } from '../../../utils/api'
import {
  getMyResearchSamples,
  submitResearchSample,
  uploadResearchImage,
  uploadResearchVideo,
  type ResearchMineResult,
  type ResearchPhotoRole,
} from '../../../utils/research-weight-api'
import {
  RESEARCH_CONSENT_VERSION,
  STATUS_LABELS,
  buildPayload,
  draftProblem,
  emptyDraft,
  newItem,
  nextDraftAfterSubmit,
  type DraftItem,
  type DraftPhoto,
  type ResearchDraft,
} from './model'
import { EvalSection, SetupSection, WeighSection } from './sections'
import './index.scss'

const DRAFT_KEY = 'research_weight_draft_v1'
const CONSENT_KEY = 'research_weight_consent'
const MAX_VIDEO_BYTES = 8 * 1024 * 1024

type DraftRole = Exclude<ResearchPhotoRole, 'item_scale'>

function loadDraft(): ResearchDraft {
  try {
    const stored = Taro.getStorageSync(DRAFT_KEY)
    if (stored && typeof stored === 'object' && stored.clientKey) return { ...emptyDraft(), ...stored }
  } catch {
    // 草稿损坏时从空白开始。
  }
  return emptyDraft()
}

function readConsent(): boolean {
  try {
    return Taro.getStorageSync(CONSENT_KEY) === RESEARCH_CONSENT_VERSION
  } catch {
    return false
  }
}

function deviceInfo(): Record<string, string> {
  try {
    const info = Taro.getSystemInfoSync()
    return { brand: info.brand || '', model: info.model || '', system: info.system || '', platform: info.platform || '' }
  } catch {
    return {}
  }
}

const isCancel = (error: any) => String(error?.errMsg || error?.message || '').includes('cancel')

export default function ResearchWeightPage() {
  const { scheme } = useAppColorScheme()
  const [draft, setDraft] = useState<ResearchDraft>(loadDraft)
  const [consented, setConsented] = useState(readConsent)
  const [uploading, setUploading] = useState<Record<string, boolean>>({})
  const [submitting, setSubmitting] = useState(false)
  const [mine, setMine] = useState<ResearchMineResult | null>(null)
  const draftRef = useRef(draft)
  draftRef.current = draft

  useEffect(() => {
    try {
      Taro.setStorageSync(DRAFT_KEY, draft)
    } catch {
      // 本机存储不可用时只是不能续填。
    }
  }, [draft])

  const loadMine = useCallback(async () => {
    if (!getAccessToken()) return
    try {
      setMine(await getMyResearchSamples())
    } catch (error) {
      console.warn('[research-weight] load mine failed', error)
    }
  }, [])

  useDidShow(() => {
    applyThemeNavigationBar(scheme)
    void loadMine()
  })

  const update = (patch: Partial<ResearchDraft>) => setDraft((current) => ({ ...current, ...patch }))
  const updateItem = (index: number, patch: Partial<DraftItem>) =>
    setDraft((current) => ({ ...current, items: current.items.map((item, i) => (i === index ? { ...item, ...patch } : item)) }))

  const requireReady = () => {
    if (!getAccessToken()) {
      Taro.navigateTo({ url: extraPkgUrl('/pages/login/index') })
      return false
    }
    if (!consented) {
      Taro.showToast({ title: '请先同意研究数据授权', icon: 'none' })
      return false
    }
    return true
  }

  const takePhoto = async (slotKey: string): Promise<DraftPhoto | null> => {
    if (!requireReady()) return null
    try {
      const result = await Taro.chooseMedia({ count: 1, mediaType: ['image'], sourceType: ['camera', 'album'], sizeType: ['original'], camera: 'back' })
      const path = String(result.tempFiles?.[0]?.tempFilePath || '').trim()
      if (!path) return null
      setUploading((current) => ({ ...current, [slotKey]: true }))
      const url = await uploadResearchImage(path)
      return { url, capturedAt: new Date().toISOString() }
    } catch (error) {
      if (!isCancel(error)) await showUnifiedApiError(error, '照片上传失败')
      return null
    } finally {
      setUploading((current) => ({ ...current, [slotKey]: false }))
    }
  }

  const pickPhoto = async (role: DraftRole) => {
    const photo = await takePhoto(role)
    if (photo) setDraft((current) => ({ ...current, photos: { ...current.photos, [role]: photo } }))
  }

  const clearPhoto = (role: DraftRole) =>
    setDraft((current) => {
      const photos = { ...current.photos }
      delete photos[role]
      return { ...current, photos }
    })

  const pickItemPhoto = async (index: number) => {
    const itemId = draftRef.current.items[index]?.id
    if (!itemId) return
    const photo = await takePhoto(`item_${itemId}`)
    if (photo) setDraft((current) => ({ ...current, items: current.items.map((item) => (item.id === itemId ? { ...item, photo } : item)) }))
  }

  const pickVideo = async () => {
    if (!requireReady()) return
    try {
      const result = await Taro.chooseMedia({ count: 1, mediaType: ['video'], sourceType: ['camera', 'album'], maxDuration: 10, camera: 'back' })
      const file = result.tempFiles?.[0]
      if (!file?.tempFilePath) return
      if (Number(file.size || 0) > MAX_VIDEO_BYTES) {
        Taro.showToast({ title: '视频超过8MB，请录短一点', icon: 'none' })
        return
      }
      setUploading((current) => ({ ...current, video: true }))
      update({ videoUrl: await uploadResearchVideo(file.tempFilePath) })
    } catch (error) {
      if (!isCancel(error)) await showUnifiedApiError(error, '视频上传失败')
    } finally {
      setUploading((current) => ({ ...current, video: false }))
    }
  }

  const acceptConsent = () => {
    try {
      Taro.setStorageSync(CONSENT_KEY, RESEARCH_CONSENT_VERSION)
    } catch {
      // 存不下时本次会话内仍视为已同意。
    }
    setConsented(true)
  }

  const problem = draftProblem(draft)
  const busy = submitting || Object.values(uploading).some(Boolean)

  const submit = async () => {
    if (busy || !requireReady()) return
    if (problem) {
      Taro.showToast({ title: problem, icon: 'none' })
      return
    }
    setSubmitting(true)
    try {
      await submitResearchSample(buildPayload(draft, deviceInfo()))
      Taro.showToast({ title: '已提交，谢谢', icon: 'success' })
      setDraft(nextDraftAfterSubmit(draft))
      Taro.pageScrollTo({ scrollTop: 0, duration: 200 })
      void loadMine()
    } catch (error) {
      await showUnifiedApiError(error, '提交失败')
    } finally {
      setSubmitting(false)
    }
  }

  const resetDraft = async () => {
    const { confirm } = await Taro.showModal({ title: '清空本份', content: '已填的读数和照片会清空，场景等设置保留。' })
    if (confirm) setDraft(nextDraftAfterSubmit({ ...draft, photos: {} }))
  }

  const summary = mine?.summary
  const sectionProps = { draft, update, uploading, pickPhoto: (role: DraftRole) => void pickPhoto(role), clearPhoto }

  return (
    <View className={`research-weight-page ${scheme === 'dark' ? 'research-weight-page--dark' : ''}`}>
      <View className='rw-hero'>
        <Text className='rw-hero__eyebrow'>中餐称重 Benchmark 共建</Text>
        <Text className='rw-hero__title'>用食物秤，帮 AI 估得更准</Text>
        <Text className='rw-hero__desc'>称一份饭菜、拍几张照片。审核通过的数据会进入公开评测集，用来检验各家 AI 估重到底准不准。</Text>
        <Text className='rw-hero__reward'>审核通过奖励积分：整份 2 分，分项 4 分</Text>
        {summary ? (
          <View className='rw-stats'>
            <View className='rw-stat'><Text className='rw-stat__value'>{summary.total}</Text><Text className='rw-stat__label'>已提交</Text></View>
            <View className='rw-stat'><Text className='rw-stat__value'>{summary.approved}</Text><Text className='rw-stat__label'>已通过</Text></View>
            <View className='rw-stat'><Text className='rw-stat__value'>{summary.pending}</Text><Text className='rw-stat__label'>待审核</Text></View>
          </View>
        ) : null}
      </View>

      {!consented ? (
        <View className='rw-card rw-consent'>
          <Text className='rw-card__title'>研究数据授权</Text>
          <Text className='rw-consent__text'>
            你上传的照片、称重读数和手机型号将用于食探的中餐克重评测与算法改进，并可能以去除个人身份信息的形式公开发布于数据集或学术论文。照片中请不要出现人脸、证件或其他个人信息。你可以随时联系我们删除未公开的数据。
          </Text>
          <View className='rw-consent__button' onClick={acceptConsent}><Text>我已阅读并同意</Text></View>
        </View>
      ) : null}

      <SetupSection {...sectionProps} />
      <WeighSection
        {...sectionProps}
        pickItemPhoto={(index) => void pickItemPhoto(index)}
        updateItem={updateItem}
        addItem={() => update({ items: [...draft.items, newItem()] })}
        removeItem={(index) => update({ items: draft.items.filter((_, i) => i !== index) })}
      />
      <EvalSection {...sectionProps} />

      <View className='rw-card'>
        <Text className='rw-card__title'>4 · 补充（可选）</Text>
        <View className={`rw-video ${draft.videoUrl ? 'rw-video--done' : ''}`} onClick={() => void pickVideo()}>
          {uploading.video ? <View className='loading-spinner-dark' /> : <Text>{draft.videoUrl ? '已上传环绕视频，点击重录' : '录一段 3–5 秒环绕视频'}</Text>}
        </View>
        <Textarea className='rw-textarea' value={draft.notes} maxlength={300} placeholder='备注：比如汤只盛了一半、含骨头等' onInput={(e) => update({ notes: e.detail.value })} />
      </View>

      <View className='rw-submit-bar'>
        <Text className='rw-submit-bar__hint'>{problem || '可以提交了'}</Text>
        <View className={`rw-submit ${problem || busy ? 'rw-submit--disabled' : ''}`} onClick={() => void submit()}>
          {submitting ? <View className='loading-spinner' /> : <Text>提交这一份</Text>}
        </View>
        <Text className='rw-reset' onClick={() => void resetDraft()}>清空本份</Text>
      </View>

      {mine?.items?.length ? (
        <View className='rw-card'>
          <Text className='rw-card__title'>我的提交</Text>
          {mine.items.slice(0, 20).map((item) => (
            <View key={item.id} className='rw-mine'>
              <View className='rw-mine__copy'>
                <Text className='rw-mine__name'>{item.dish_name}</Text>
                <Text className='rw-mine__meta'>{item.weighing_mode === 'itemized' ? `分项 ${item.items.length} 项` : '整份'} · {item.total_net_grams}g{item.review_note ? ` · ${item.review_note}` : ''}</Text>
              </View>
              <Text className={`rw-status rw-status--${item.status}`}>{STATUS_LABELS[item.status] || item.status}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  )
}
