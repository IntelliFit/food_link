import { Image, ScrollView, Text, View } from '@tarojs/components'
import Taro, { useDidShow, useRouter, useUnload } from '@tarojs/taro'
import { useEffect, useRef, useState } from 'react'
import { withAuth } from '../../../utils/withAuth'
import { useAppColorScheme } from '../../../components/AppColorSchemeContext'
import { applyThemeNavigationBar } from '../../../utils/theme-navigation-bar'
import SchoolPicker from '../../../components/SchoolPicker'
import CampusPicker from '../../../components/CampusPicker'
import CanteenPicker from '../../../components/CanteenPicker'
import FloorPicker from '../../../components/FloorPicker'
import { extraPkgUrl } from '../../../utils/subpackage-extra'
import { getCanteenFloors, showUnifiedApiError, type SchoolCampusItem, type SchoolCanteenItem, type SchoolItem } from '../../../utils/api'
import {
  createCaptureSession,
  getCaptureSession,
  listCapturedWindows,
  newCaptureKey,
  startCaptureExtraction,
  submitCaptureSession,
  updateCaptureAsset,
  uploadCaptureAsset,
  type CapturedWindow,
  type CaptureItem,
  type CaptureSessionView,
} from '../../../utils/canteen-capture-api'
import { chooseImageWithPrivacy, isPrivacyAuthorizeError, showPrivacyAuthorizeFailure } from '../../../utils/weapp-privacy'
import WindowForm, { type WindowFormValue } from './window-form'
import CaptureItems from './capture-items'
import {
  CAPTURE_POLL_INTERVAL_MS,
  CAPTURE_POLL_MAX_ATTEMPTS,
  SUBMIT_BLOCKER_TEXT,
  photoProgress,
  rewardHeadline,
  submitBlocker,
  VENUE_OPTIONS,
} from './capture-view'
import './index.scss'

const ACTIVE_SESSION_KEY = 'canteen_capture_active_session'

function initialForm(params: Record<string, string | undefined>): WindowFormValue {
  const venueType = VENUE_OPTIONS.find(option => option.value === params.venue_type)?.value || 'university'
  const school = params.school_id ? { id: params.school_id, name: decodeURIComponent(params.school_name || '') } as SchoolItem : null
  const campus = school && params.campus_id ? { id: params.campus_id, school_id: school.id, name: decodeURIComponent(params.campus_name || '') } as SchoolCampusItem : null
  const canteen = school && params.canteen_id
    ? { id: params.canteen_id, school_id: school.id, campus_id: campus?.id, name: decodeURIComponent(params.canteen_name || '') } as SchoolCanteenItem
    : null
  return {
    venueType, school, campus, canteen,
    organizationName: decodeURIComponent(params.organization_name || ''),
    canteenName: venueType === 'university' ? '' : decodeURIComponent(params.canteen_name || ''),
    floor: '', windowName: '', serviceMode: 'unknown',
  }
}

function isCancel(error: any): boolean {
  return String(error?.errMsg || error?.message || '').includes('cancel')
}

function CanteenCapturePage() {
  const { scheme } = useAppColorScheme()
  const params = useRouter().params || {}
  const [form, setForm] = useState<WindowFormValue>(() => initialForm(params))
  const [capturedWindows, setCapturedWindows] = useState<CapturedWindow[]>([])
  const [view, setView] = useState<CaptureSessionView | null>(null)
  const [picker, setPicker] = useState<'' | 'school' | 'campus' | 'canteen' | 'floor'>('')
  const [starting, setStarting] = useState(false)
  const [uploadingMenu, setUploadingMenu] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [busyKey, setBusyKey] = useState('')
  const [newDishName, setNewDishName] = useState('')
  const [sessionKey, setSessionKey] = useState(() => newCaptureKey('capture'))
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isCampus = form.venueType === 'university'

  const stopPolling = () => {
    if (pollTimer.current) clearTimeout(pollTimer.current)
    pollTimer.current = null
  }

  const pollExtraction = (sessionId: string, attempt = 0) => {
    stopPolling()
    if (attempt >= CAPTURE_POLL_MAX_ATTEMPTS) return
    pollTimer.current = setTimeout(async () => {
      try {
        const next = await getCaptureSession(sessionId)
        setView(next)
        if (next.session.status === 'extracting') {
          pollExtraction(sessionId, attempt + 1)
        } else if (next.session.status === 'extract_failed') {
          Taro.showToast({ title: next.session.extract_error || '识别失败，请重试', icon: 'none' })
        }
      } catch {
        pollExtraction(sessionId, attempt + 1)
      }
    }, CAPTURE_POLL_INTERVAL_MS)
  }

  useDidShow(() => {
    applyThemeNavigationBar(scheme, { lightBackground: '#f7faf8', darkBackground: '#0d1512' })
    const activeId = String(Taro.getStorageSync(ACTIVE_SESSION_KEY) || '')
    if (!activeId || view) return
    getCaptureSession(activeId).then(resumed => {
      if (resumed.session.status === 'submitted') {
        Taro.removeStorageSync(ACTIVE_SESSION_KEY)
        return
      }
      setView(resumed)
      if (resumed.session.status === 'extracting') pollExtraction(resumed.session.id)
    }).catch(() => Taro.removeStorageSync(ACTIVE_SESSION_KEY))
  })

  useUnload(stopPolling)

  useEffect(() => {
    const canteenID = isCampus ? form.canteen?.id : ''
    if (isCampus ? !canteenID : !form.organizationName.trim() || !form.canteenName.trim()) {
      setCapturedWindows([])
      return
    }
    const timer = setTimeout(() => {
      listCapturedWindows({
        venue_type: form.venueType, canteen_id: canteenID || undefined,
        organization_name: isCampus ? undefined : form.organizationName.trim(),
        canteen_name: isCampus ? undefined : form.canteenName.trim(),
      }).then(setCapturedWindows).catch(() => setCapturedWindows([]))
    }, 400)
    return () => clearTimeout(timer)
  }, [form.venueType, form.canteen?.id, form.organizationName, form.canteenName, isCampus])

  const patchForm = (patch: Partial<WindowFormValue>) => setForm(current => ({ ...current, ...patch }))

  const chooseCanteen = (campus: SchoolCampusItem | null, canteen: SchoolCanteenItem) => {
    patchForm({ campus: campus || form.campus, canteen, floor: '' })
    setPicker('')
    void getCanteenFloors(canteen.id).then(items => {
      const first = items.find(item => item.is_default)
      if (first) patchForm({ floor: first.name })
    }).catch(() => undefined)
  }

  const startSession = async () => {
    if (starting) return
    const missingPlace = isCampus ? !form.school || !form.campus || !form.canteen : !form.organizationName.trim() || !form.canteenName.trim()
    if (missingPlace || !form.windowName.trim()) {
      Taro.showToast({ title: missingPlace ? '请先选好食堂' : '请填写窗口名称', icon: 'none' })
      return
    }
    setStarting(true)
    try {
      const created = await createCaptureSession({
        client_session_key: sessionKey, venue_type: form.venueType,
        school_id: isCampus ? form.school?.id : undefined, campus_id: isCampus ? form.campus?.id : undefined,
        canteen_id: isCampus ? form.canteen?.id : undefined,
        organization_name: isCampus ? undefined : form.organizationName.trim(),
        canteen_name: isCampus ? undefined : form.canteenName.trim(),
        floor: form.floor.trim() || undefined, window_name: form.windowName.trim(), service_mode: form.serviceMode,
      })
      Taro.setStorageSync(ACTIVE_SESSION_KEY, created.session.id)
      setView(created)
    } catch (error) {
      await showUnifiedApiError(error, '开始采集失败')
    } finally {
      setStarting(false)
    }
  }

  const choosePhotos = async (count: number) => {
    const result = await chooseImageWithPrivacy({ count, sizeType: ['original'], sourceType: ['camera', 'album'] })
    return result.tempFilePaths || []
  }

  const handlePickError = async (error: unknown, fallback: string) => {
    if (isCancel(error)) return
    if (isPrivacyAuthorizeError(error)) {
      showPrivacyAuthorizeFailure(error)
      return
    }
    await showUnifiedApiError(error, fallback)
  }

  const addMenuPhotos = async () => {
    if (!view || uploadingMenu) return
    try {
      const paths = await choosePhotos(9)
      if (!paths.length) return
      setUploadingMenu(true)
      let firstError: unknown
      for (const path of paths) {
        try {
          await uploadCaptureAsset(view.session.id, path, 'menu')
        } catch (error) {
          firstError ||= error
        }
      }
      setView(await getCaptureSession(view.session.id))
      if (firstError) await showUnifiedApiError(firstError, '部分照片上传失败，已保留成功的')
    } catch (error) {
      await handlePickError(error, '上传菜单照片失败')
    } finally {
      setUploadingMenu(false)
    }
  }

  const removeAsset = async (assetId: string) => {
    if (!view) return
    try {
      setView(await updateCaptureAsset(view.session.id, assetId, { remove: true }))
    } catch (error) {
      await showUnifiedApiError(error, '删除照片失败')
    }
  }

  const recognize = async () => {
    if (!view) return
    try {
      const next = await startCaptureExtraction(view.session.id)
      setView(next)
      if (next.session.status === 'extracting') pollExtraction(next.session.id)
    } catch (error) {
      await showUnifiedApiError(error, '开始识别失败')
    }
  }

  const uploadDishPhoto = async (key: string, binding: { itemKey?: string; dishName?: string }) => {
    if (!view || busyKey) return false
    try {
      const paths = await choosePhotos(1)
      if (!paths.length) return false
      setBusyKey(key)
      await uploadCaptureAsset(view.session.id, paths[0], 'dish', binding)
      setView(await getCaptureSession(view.session.id))
      return true
    } catch (error) {
      await handlePickError(error, '上传实物照片失败')
      return false
    } finally {
      setBusyKey('')
    }
  }

  const photograph = (item: CaptureItem) => {
    void uploadDishPhoto(item.key, item.source === 'collector' ? { dishName: item.name } : { itemKey: item.key })
  }

  const addDish = async () => {
    const name = newDishName.trim()
    if (!name) return
    if (await uploadDishPhoto('__new__', { dishName: name })) setNewDishName('')
  }

  const submit = async () => {
    if (!view || submitting) return
    const blocker = submitBlocker(view)
    if (blocker) {
      Taro.showToast({ title: SUBMIT_BLOCKER_TEXT[blocker], icon: 'none' })
      return
    }
    const progress = photoProgress(view.items)
    const { confirm } = await Taro.showModal({
      title: '提交这个窗口',
      content: `${progress.sellable} 道菜，${progress.photographed} 道有实物图。${rewardHeadline(view.reward)}。提交后系统自动整理上线。`,
      confirmText: '提交',
    })
    if (!confirm) return
    setSubmitting(true)
    try {
      const submitted = await submitCaptureSession(view.session.id)
      setView(submitted)
      Taro.removeStorageSync(ACTIVE_SESSION_KEY)
      Taro.setStorageSync('food_library_need_refresh', '1')
    } catch (error) {
      await showUnifiedApiError(error, '提交失败')
    } finally {
      setSubmitting(false)
    }
  }

  const nextWindow = () => {
    stopPolling()
    setView(null)
    setSessionKey(newCaptureKey('capture'))
    patchForm({ windowName: '', serviceMode: 'unknown' })
  }

  const openEarnings = () => Taro.navigateTo({ url: extraPkgUrl('/pages/canteen-earnings/index') })

  const session = view?.session
  const menuAssets = view?.assets.filter(asset => asset.kind === 'menu') || []
  const submitted = session?.status === 'submitted'
  const extracting = session?.status === 'extracting'
  const blocker = submitBlocker(view)
  const progress = photoProgress(view?.items || [])

  return (
    <View className={`capture-page ${scheme === 'dark' ? 'capture-page--dark' : ''}`}>
      <ScrollView scrollY className='capture-scroll' enhanced showScrollbar={false}>
        <View className='capture-hero'>
          <View className='capture-hero-row'>
            <Text className='capture-title'>窗口采集</Text>
            <Text className='capture-link' onClick={openEarnings}>我的奖励</Text>
          </View>
          <Text className='capture-subtitle'>一个窗口一组：拍清菜单，系统自动识别；再给每道菜拍实物，奖励更高。</Text>
        </View>

        {!view ? (
          <>
            <WindowForm value={form} capturedWindows={capturedWindows} onChange={patchForm}
              onPickSchool={() => setPicker('school')} onPickCampus={() => setPicker('campus')}
              onPickCanteen={() => setPicker('canteen')} onPickFloor={() => setPicker('floor')}
            />
            <View className={`capture-primary ${starting ? 'disabled' : ''}`} onClick={() => void startSession()}>
              {starting ? <View className='capture-spinner capture-spinner--light' /> : <Text>开始采集这个窗口</Text>}
            </View>
          </>
        ) : (
          <>
            <View className='capture-card capture-window'>
              <Text className='capture-card-title'>{session?.window_name}</Text>
              <Text className='capture-hint'>{[session?.organization_name, session?.area_name, session?.canteen_name, session?.floor].filter(Boolean).join(' · ')}</Text>
            </View>

            <View className='capture-card'>
              <View className='capture-card-heading'>
                <Text className='capture-card-title'>菜单照片 · {menuAssets.length}</Text>
                {!submitted && (
                  <View className={`capture-add ${uploadingMenu || extracting ? 'disabled' : ''}`} onClick={() => void addMenuPhotos()}>
                    {uploadingMenu ? <View className='capture-spinner' /> : <Text>拍菜单</Text>}
                  </View>
                )}
              </View>
              <Text className='capture-hint'>正对菜单拍，菜名、价格和小字都要看得清；电子屏有几页拍几页，菜单很长就分段拍。</Text>
              {menuAssets.length > 0 && (
                <View className='capture-thumbs'>
                  {menuAssets.map(asset => (
                    <View key={asset.id} className='capture-thumb'>
                      <Image className='capture-thumb-image' src={asset.url || ''} mode='aspectFill' />
                      {!submitted && !extracting && <Text className='capture-thumb-remove' onClick={() => void removeAsset(asset.id)}>×</Text>}
                    </View>
                  ))}
                </View>
              )}
              {!submitted && menuAssets.length > 0 && (
                <View className={`capture-primary capture-primary--outline ${extracting ? 'disabled' : ''}`} onClick={() => void recognize()}>
                  {extracting ? <View className='capture-spinner' /> : <Text>{session?.status === 'extracted' ? '重新识别菜单' : '识别菜单'}</Text>}
                </View>
              )}
              {session?.status === 'extract_failed' && <Text className='capture-error'>{session.extract_error || '识别失败，请重试'}</Text>}
            </View>

            {(view.items.length > 0 || !menuAssets.length || session?.status === 'extracted') && (
              <CaptureItems items={view.items} busyKey={busyKey} readOnly={!!submitted} newDishName={newDishName}
                onNewDishNameChange={setNewDishName} onPhotograph={photograph} onAddDish={() => void addDish()}
              />
            )}

            <View className='capture-card capture-reward'>
              <Text className='capture-reward-title'>{rewardHeadline(view.reward)}</Text>
              <Text className='capture-hint'>{view.reward.message}</Text>
              {progress.sellable > 0 && <Text className='capture-hint'>实物图 {progress.photographed}/{progress.sellable}</Text>}
            </View>

            {submitted ? (
              <View className='capture-card'>
                <Text className='capture-card-title'>已提交</Text>
                <Text className='capture-hint'>
                  已上线 {session?.published_item_count || 0} 道{session?.exception_item_count ? `，${session.exception_item_count} 道由平台核对后上线` : ''}。
                </Text>
                <View className='capture-primary' onClick={nextWindow}><Text>采下一个窗口</Text></View>
                <View className='capture-primary capture-primary--outline' onClick={openEarnings}><Text>查看我的奖励</Text></View>
              </View>
            ) : (
              <View className={`capture-primary ${submitting || blocker ? 'disabled' : ''}`} onClick={() => void submit()}>
                {submitting ? <View className='capture-spinner capture-spinner--light' /> : <Text>{blocker ? SUBMIT_BLOCKER_TEXT[blocker] : '提交这个窗口'}</Text>}
              </View>
            )}
          </>
        )}
        <View className='capture-safe-area' />
      </ScrollView>

      <SchoolPicker visible={picker === 'school'} onSelect={school => { patchForm({ school, campus: null, canteen: null, floor: '' }); setPicker('') }} onCancel={() => setPicker('')} />
      <CampusPicker visible={picker === 'campus'} school={form.school} value={form.campus?.id}
        onSelect={campus => { patchForm({ campus, canteen: null, floor: '' }); setPicker('') }} onCancel={() => setPicker('')}
      />
      <CanteenPicker visible={picker === 'canteen'} school={form.school} campus={form.campus} value={form.canteen?.id}
        onSelect={({ campus, canteen }) => chooseCanteen(campus, canteen)} onCancel={() => setPicker('')}
      />
      <FloorPicker visible={picker === 'floor'} canteen={form.canteen} value={form.floor}
        onSelect={value => { patchForm({ floor: value }); setPicker('') }} onCancel={() => setPicker('')}
      />
    </View>
  )
}

export default withAuth(CanteenCapturePage)
