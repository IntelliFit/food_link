import { Text, Textarea, View } from '@tarojs/components'
import { useCallback, useEffect, useRef, useState } from 'react'
import Taro, { useDidShow } from '@tarojs/taro'
import { useAppColorScheme } from '../../../components/AppColorSchemeContext'
import { applyThemeNavigationBar } from '../../../utils/theme-navigation-bar'
import { extraPkgUrl } from '../../../utils/subpackage-extra'
import { getAccessToken, showUnifiedApiError } from '../../../utils/api'
import {
  createResearchContainer,
  listResearchContainers,
  readScalePhoto,
  submitResearchSample,
  type ResearchScene,
} from '../../../utils/research-weight-api'
import {
  MAX_CONTAINERS,
  buildPayload,
  checkDraft,
  containersToSave,
  defaultTareSource,
  libraryIndex,
  netGrams,
  newContainer,
  nextDraftAfterSubmit,
  type DraftContainer,
  type DraftPhoto,
  type EvalRole,
  type Library,
  type ResearchDraft,
} from '../research-weight/model'
import { acceptConsent, loadDraft, readConsent, saveDraft } from '../research-weight/storage'
import { ensureLoggedIn, takeResearchPhoto, takeResearchVideo } from '../research-weight/media'
import { ConsentCard, formatGrams } from '../research-weight/controls'
import { autofillValue, toPhotoReading } from '../research-weight/reading'
import { ContainerCard } from './container-card'
import { ItemizedSection, PhotoSection, SetupSection } from './sections'
import './index.scss'

function deviceInfo(): Record<string, string> {
  try {
    const info = Taro.getSystemInfoSync()
    return { brand: info.brand || '', model: info.model || '', system: info.system || '', platform: info.platform || '' }
  } catch {
    return {}
  }
}

const leavePage = () => {
  Taro.navigateBack().catch(() => Taro.redirectTo({ url: extraPkgUrl('/pages/research-weight/index') }))
}

export default function ResearchWeightRecordPage() {
  const { scheme } = useAppColorScheme()
  const [draft, setDraft] = useState<ResearchDraft>(loadDraft)
  const [library, setLibrary] = useState<Library>({})
  const [consented, setConsented] = useState(readConsent)
  const [uploading, setUploading] = useState<Record<string, boolean>>({})
  const [submitting, setSubmitting] = useState(false)
  const draftRef = useRef(draft)
  draftRef.current = draft
  const submittingRef = useRef(false)

  useEffect(() => saveDraft(draft), [draft])

  // 从高校共建活动页进入：带上称重日或菜品，提交时由服务端按本人参加的活动校验。
  useEffect(() => {
    const params = Taro.getCurrentInstance().router?.params || {}
    const stationSessionId = String(params.station || '').trim()
    const catalogItemId = String(params.dish || '').trim()
    if (!stationSessionId && !catalogItemId) return
    const label = decodeURIComponent(String(params.label || '')).slice(0, 40) || '高校共建活动'
    setDraft((current) => ({ ...current, scene: 'canteen', campus: { stationSessionId, catalogItemId, label } }))
  }, [])

  const loadLibrary = useCallback(async () => {
    if (!getAccessToken()) return
    try {
      setLibrary(libraryIndex(await listResearchContainers()))
    } catch (error) {
      console.warn('[research-weight] load containers failed', error)
    }
  }, [])

  useDidShow(() => {
    applyThemeNavigationBar(scheme)
    void loadLibrary()
  })

  const update = (patch: Partial<ResearchDraft>) => setDraft((current) => ({ ...current, ...patch }))
  const updateContainer = (id: string, patch: Partial<DraftContainer>) =>
    setDraft((current) => ({ ...current, containers: current.containers.map((c) => (c.id === id ? { ...c, ...patch } : c)) }))

  const ready = () => {
    if (!ensureLoggedIn()) return false
    if (!consented) {
      Taro.showToast({ title: '请先同意研究数据授权', icon: 'none' })
      return false
    }
    return true
  }

  /** 上传期间用 key 标记对应的照片位，上传完再写回草稿。 */
  const withUpload = async (key: string, apply: (photo: DraftPhoto) => void, options: { cameraOnly?: boolean } = {}) => {
    if (!ready()) return
    const photo = await takeResearchPhoto(() => setUploading((current) => ({ ...current, [key]: true })), options)
    setUploading((current) => ({ ...current, [key]: false }))
    if (photo) apply(photo)
  }

  /**
   * 秤的照片：先显示照片，再让服务端读出秤上的数字，读出来就填进对应的输入框。
   * 服务端没开自动读数时照常手填。
   */
  const withScaleUpload = async (
    key: string,
    current: () => { value: string; photo?: DraftPhoto },
    apply: (photo: DraftPhoto, value: string | null) => void,
  ) => {
    if (!ready()) return
    const previous = current()
    const photo = await takeResearchPhoto(() => setUploading((state) => ({ ...state, [key]: true })))
    setUploading((state) => ({ ...state, [key]: false }))
    if (!photo) return
    apply(photo, null)
    setUploading((state) => ({ ...state, [`${key}:reading`]: true }))
    try {
      const reading = toPhotoReading(await readScalePhoto(photo.url, draftRef.current.precision))
      if (current().photo?.url !== photo.url) return
      apply({ ...photo, reading }, autofillValue(current().value, previous.photo?.reading, reading))
    } catch (error) {
      console.warn('[research-weight] scale reading unavailable', error)
    } finally {
      setUploading((state) => ({ ...state, [`${key}:reading`]: false }))
    }
  }
  const containerOf = (id: string) => draftRef.current.containers.find((c) => c.id === id)

  const pickEval = (role: EvalRole) => withUpload(role, (photo) => setDraft((c) => ({ ...c, photos: { ...c.photos, [role]: photo } })), { cameraOnly: true })
  const clearEval = (role: EvalRole) => setDraft((c) => {
    const photos = { ...c.photos }
    delete photos[role]
    return { ...c, photos }
  })
  const pickContainer = (id: string, kind: 'gross' | 'tare') => withScaleUpload(
    `${id}:${kind}`,
    () => {
      const box = containerOf(id)
      return kind === 'gross' ? { value: box?.gross ?? '', photo: box?.grossPhoto } : { value: box?.tare ?? '', photo: box?.tarePhoto }
    },
    (photo, value) => updateContainer(id, kind === 'gross'
      ? { grossPhoto: photo, ...(value === null ? {} : { gross: value }) }
      : { tarePhoto: photo, ...(value === null ? {} : { tare: value }) }),
  )
  const pickItemPhoto = (index: number) => {
    const itemId = draftRef.current.items[index]?.id
    if (!itemId) return
    const itemOf = () => draftRef.current.items.find((item) => item.id === itemId)
    void withScaleUpload(
      `item_${itemId}`,
      () => ({ value: itemOf()?.reading ?? '', photo: itemOf()?.photo }),
      (photo, value) => setDraft((c) => ({
        ...c,
        items: c.items.map((item) => (item.id === itemId ? { ...item, photo, ...(value === null ? {} : { reading: value }) } : item)),
      })),
    )
  }
  const pickTarePhoto = () => withScaleUpload(
    'tare',
    () => ({ value: draftRef.current.tare, photo: draftRef.current.tarePhoto }),
    (photo, value) => update({ tarePhoto: photo, ...(value === null ? {} : { tare: value }) }),
  )

  /** 换场景时，还没称过空盒的盒子跟着换默认的皮重来源。 */
  const changeScene = (scene: ResearchScene) => setDraft((current) => ({
    ...current,
    scene,
    containers: current.containers.map((c) => (c.tare || c.tarePhoto || c.tareSource === 'library' ? c : { ...c, tareSource: defaultTareSource(scene) })),
  }))

  const pickVideo = async () => {
    if (!ready()) return
    const url = await takeResearchVideo(() => setUploading((current) => ({ ...current, video: true })))
    setUploading((current) => ({ ...current, video: false }))
    if (url) update({ videoUrl: url })
  }

  const check = checkDraft(draft, library)
  const busy = submitting || Object.values(uploading).some(Boolean)
  const total = netGrams(draft, library)

  const submit = async () => {
    if (busy || submittingRef.current || !ready()) return
    if (check.problem) {
      Taro.showToast({ title: check.problem, icon: 'none' })
      return
    }
    submittingRef.current = true
    setSubmitting(true)
    try {
      await submitResearchSample(buildPayload(draft, library, deviceInfo()))
      const toSave = containersToSave(draft)
      const results = await Promise.allSettled(toSave.map((input) => createResearchContainer(input)))
      const failedSaves = results.filter((result) => result.status === 'rejected').length
      setDraft(nextDraftAfterSubmit(draft))
      Taro.showToast({ title: failedSaves ? '已提交，常用容器没存上' : '已提交，谢谢', icon: failedSaves ? 'none' : 'success' })
      setTimeout(leavePage, 900)
    } catch (error) {
      await showUnifiedApiError(error, '提交失败')
    } finally {
      submittingRef.current = false
      setSubmitting(false)
    }
  }

  const saveForLater = () => {
    Taro.showToast({ title: '已保存，吃完回来点「继续」', icon: 'none' })
    setTimeout(leavePage, 900)
  }

  const resetDraft = async () => {
    const { confirm } = await Taro.showModal({ title: '清空这一顿', content: '已填的读数和照片会清空，场景等设置保留。' })
    if (confirm) setDraft(nextDraftAfterSubmit({ ...draft, tarePhoto: undefined }))
  }

  const sectionProps = { draft, library, update, uploading }

  return (
    <View className={`research-weight-page ${scheme === 'dark' ? 'research-weight-page--dark' : ''}`}>
      {!consented ? <ConsentCard onAccept={() => { acceptConsent(); setConsented(true) }} /> : null}
      {draft.campus ? (
        <View className='rw-campus'>
          <Text className='rw-campus__text'>计入：{draft.campus.label}</Text>
          <Text className='rw-campus__clear' onClick={() => update({ campus: undefined })}>不计入</Text>
        </View>
      ) : null}
      <SetupSection {...sectionProps} onSceneChange={changeScene} />
      <PhotoSection {...sectionProps} pickPhoto={(role) => void pickEval(role)} clearPhoto={clearEval} />
      {draft.mode === 'multi' ? (
        <View className='rw-card'>
          <Text className='rw-card__title'>2 · 每盒称一下</Text>
          {draft.containers.map((container, index) => (
            <ContainerCard
              key={container.id}
              index={index}
              container={container}
              library={library}
              removable={draft.containers.length > 1}
              uploading={uploading}
              onChange={(patch) => updateContainer(container.id, patch)}
              onPickGross={() => void pickContainer(container.id, 'gross')}
              onPickTare={() => void pickContainer(container.id, 'tare')}
              onRemove={() => update({ containers: draft.containers.filter((c) => c.id !== container.id) })}
            />
          ))}
          {draft.containers.length < MAX_CONTAINERS ? (
            <View className='rw-add' onClick={() => update({ containers: [...draft.containers, newContainer(defaultTareSource(draft.scene))] })}>
              <Text>+ 再加一盒</Text>
            </View>
          ) : null}
        </View>
      ) : (
        <ItemizedSection {...sectionProps} pickTarePhoto={() => void pickTarePhoto()} pickItemPhoto={pickItemPhoto} />
      )}
      <View className='rw-net'>
        <Text className='rw-net__label'>这一顿净重</Text>
        <Text className='rw-net__value'>{formatGrams(total)}</Text>
      </View>

      <View className='rw-card'>
        <Text className='rw-card__title'>补充（可选）</Text>
        <View className={`rw-video ${draft.videoUrl ? 'rw-video--done' : ''}`} onClick={() => void pickVideo()}>
          {uploading.video ? <View className='loading-spinner-dark' /> : <Text>{draft.videoUrl ? '已上传环绕视频，点击重录' : '录一段 3–5 秒环绕视频'}</Text>}
        </View>
        <Textarea className='rw-textarea' value={draft.notes} maxlength={300} placeholder='备注：比如汤只喝了一半、酱料包没倒等' onInput={(e) => update({ notes: e.detail.value })} />
      </View>

      <View className='rw-submit-bar'>
        <Text className='rw-submit-bar__hint'>{check.problem || '可以提交了'}</Text>
        <View className={`rw-submit ${check.problem || busy ? 'rw-submit--disabled' : ''}`} onClick={() => void submit()}>
          {submitting ? <View className='loading-spinner' /> : <Text>提交这一顿</Text>}
        </View>
        {check.waitingForMeal ? <View className='rw-later' onClick={saveForLater}><Text>先保存，吃完再来</Text></View> : null}
        <Text className='rw-reset' onClick={() => void resetDraft()}>清空这一顿</Text>
      </View>
    </View>
  )
}
