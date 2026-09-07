import { Image, Input, ScrollView, Text, Textarea, View } from '@tarojs/components'
import Taro, { useDidShow } from '@tarojs/taro'
import { useEffect, useRef, useState } from 'react'
import { withAuth } from '../../../utils/withAuth'
import { useAppColorScheme } from '../../../components/AppColorSchemeContext'
import { applyThemeNavigationBar } from '../../../utils/theme-navigation-bar'
import SchoolPicker from '../../../components/SchoolPicker'
import CampusPicker from '../../../components/CampusPicker'
import CanteenPicker from '../../../components/CanteenPicker'
import FloorPicker from '../../../components/FloorPicker'
import {
  applyCampusCollector,
  createCampusCollectorBatch,
  getCampusCollectorProfile,
  getCanteenFloors,
  showUnifiedApiError,
  uploadCampusFoodImageFile,
  type CampusCollectorProfile,
  type SchoolCampusItem,
  type SchoolCanteenItem,
  type SchoolItem,
} from '../../../utils/api'
import { chooseImageWithPrivacy, isPrivacyAuthorizeError, showPrivacyAuthorizeFailure } from '../../../utils/weapp-privacy'
import './index.scss'

const MAX_BATCH_ENTRIES = 30

interface DraftEntry {
  id: string
  localPath: string
  imageUrl: string
  name: string
  price: string
  portion: string
}

function CampusFoodCollectorPage() {
  const { scheme } = useAppColorScheme()
  const isDark = scheme === 'dark'
  const [profile, setProfile] = useState<CampusCollectorProfile | null>(null)
  const [profileLoading, setProfileLoading] = useState(true)
  const [selectedSchool, setSelectedSchool] = useState<SchoolItem | null>(null)
  const [selectedCampus, setSelectedCampus] = useState<SchoolCampusItem | null>(null)
  const [selectedCanteen, setSelectedCanteen] = useState<SchoolCanteenItem | null>(null)
  const [floor, setFloor] = useState('')
  const [windowName, setWindowName] = useState('')
  const [applicationNote, setApplicationNote] = useState('')
  const [batchNote, setBatchNote] = useState('')
  const [entries, setEntries] = useState<DraftEntry[]>([])
  const [showSchoolPicker, setShowSchoolPicker] = useState(false)
  const [showCampusPicker, setShowCampusPicker] = useState(false)
  const [showCanteenPicker, setShowCanteenPicker] = useState(false)
  const [showFloorPicker, setShowFloorPicker] = useState(false)
  const [applying, setApplying] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [clientBatchKey, setClientBatchKey] = useState(newCollectorBatchKey)
  const lastProfileLoadAtRef = useRef(0)

  const loadProfile = async (force = false) => {
    const now = Date.now()
    if (!force && now - lastProfileLoadAtRef.current < 500) return
    lastProfileLoadAtRef.current = now
    setProfileLoading(true)
    try {
      const nextProfile = await getCampusCollectorProfile()
      setProfile(nextProfile)
      const preferredScope = nextProfile.active_scopes?.[0]
      if (preferredScope) {
        setSelectedSchool({ id: preferredScope.school_id, name: preferredScope.school_name || '已授权学校' })
        setSelectedCampus(preferredScope.campus_id ? {
          id: preferredScope.campus_id, school_id: preferredScope.school_id, name: preferredScope.campus_name || '已授权校区',
        } : null)
        setSelectedCanteen(preferredScope.canteen_id ? {
          id: preferredScope.canteen_id, school_id: preferredScope.school_id, campus_id: preferredScope.campus_id,
          campus_name: preferredScope.campus_name, name: preferredScope.canteen_name || '已授权食堂',
        } : null)
      }
    } catch (error) {
      console.error('读取校园采集员资料失败', error)
    } finally {
      setProfileLoading(false)
    }
  }

  useDidShow(() => {
    applyThemeNavigationBar(scheme, { lightBackground: '#f7faf8', darkBackground: '#0d1512' })
    void loadProfile()
  })

  useEffect(() => {
    applyThemeNavigationBar(scheme, { lightBackground: '#f7faf8', darkBackground: '#0d1512' })
  }, [scheme])

  const chooseSchool = (school: SchoolItem) => {
    if (profile?.can_batch && !profile.active_scopes.some(scope => scope.school_id === school.id)) {
      Taro.showToast({ title: '该学校不在授权范围', icon: 'none' })
      return
    }
    setSelectedSchool(school)
    setSelectedCampus(null)
    setSelectedCanteen(null)
    setFloor('')
    setWindowName('')
    setShowSchoolPicker(false)
  }

  const chooseCampus = (campus: SchoolCampusItem) => {
    if (profile?.can_batch && !profile.active_scopes.some(scope => (
      scope.school_id === campus.school_id && (!scope.campus_id || scope.campus_id === campus.id)
    ))) {
      Taro.showToast({ title: '该校区不在授权范围', icon: 'none' })
      return
    }
    setSelectedCampus(campus)
    setSelectedCanteen(null)
    setFloor('')
    setWindowName('')
    setShowCampusPicker(false)
  }

  const chooseCanteen = (campus: SchoolCampusItem | null, canteen: SchoolCanteenItem) => {
    const resolvedCampus = campus || selectedCampus
    if (!resolvedCampus) {
      Taro.showToast({ title: '请先选择校区', icon: 'none' })
      return
    }
    if (profile?.can_batch && !profile.active_scopes.some(scope => (
      scope.school_id === canteen.school_id
      && (!scope.campus_id || scope.campus_id === resolvedCampus.id)
      && (!scope.canteen_id || scope.canteen_id === canteen.id)
    ))) {
      Taro.showToast({ title: '该食堂不在授权范围', icon: 'none' })
      return
    }
    setSelectedCampus(resolvedCampus)
    setSelectedCanteen(canteen)
    setFloor('')
    setWindowName('')
    setShowCanteenPicker(false)
    void getCanteenFloors(canteen.id).then(items => {
      const first = items.find(item => item.is_default)
      if (first) setFloor(first.name)
    }).catch(() => undefined)
  }

  const submitApplication = async () => {
    if (!selectedSchool?.id || applying) {
      if (!selectedSchool?.id) Taro.showToast({ title: '请先选择学校', icon: 'none' })
      return
    }
    setApplying(true)
    try {
      await applyCampusCollector({
        school_id: selectedSchool.id,
        campus_id: selectedCampus?.id,
        canteen_id: selectedCanteen?.id,
        applicant_note: applicationNote.trim() || undefined,
      })
      Taro.showToast({ title: '申请已提交', icon: 'success' })
      await loadProfile(true)
    } catch (error) {
      await showUnifiedApiError(error, '提交申请失败')
    } finally {
      setApplying(false)
    }
  }

  const chooseBatchImages = async () => {
    const remain = MAX_BATCH_ENTRIES - entries.length
    if (remain <= 0 || uploading) return
    try {
      const result = await chooseImageWithPrivacy({ count: Math.min(remain, 9), sizeType: ['compressed'], sourceType: ['camera', 'album'] })
      const paths = result.tempFilePaths || []
      if (!paths.length) return
      setUploading(true)
      let firstUploadError: unknown
      for (const [index, path] of paths.entries()) {
        try {
          const response = await uploadCampusFoodImageFile(path)
          const uploaded = { id: `${Date.now()}-${index}-${Math.random().toString(16).slice(2)}`, localPath: path, imageUrl: response.imageUrl, name: '', price: '', portion: '' }
          setEntries(current => [...current, uploaded])
        } catch (error) {
          firstUploadError ||= error
        }
      }
      if (firstUploadError) await showUnifiedApiError(firstUploadError, '部分照片上传失败，已保留成功项')
    } catch (error: any) {
      if (String(error?.errMsg || error?.message || '').includes('cancel')) return
      if (isPrivacyAuthorizeError(error)) {
        showPrivacyAuthorizeFailure(error)
        return
      }
      await showUnifiedApiError(error, '上传菜品照片失败')
    } finally {
      setUploading(false)
    }
  }

  const updateEntry = (id: string, patch: Partial<DraftEntry>) => {
    setEntries(current => current.map(entry => entry.id === id ? { ...entry, ...patch } : entry))
  }

  const removeEntry = (id: string) => {
    setEntries(current => current.filter(entry => entry.id !== id))
  }

  const submitBatch = async () => {
    if (submitting) return
    if (!selectedSchool?.id || !selectedCampus?.id || !selectedCanteen?.id) {
      Taro.showToast({ title: '请选择学校、校区和食堂', icon: 'none' })
      return
    }
    if (!entries.length) {
      Taro.showToast({ title: '请先连续拍照或多选图片', icon: 'none' })
      return
    }
    const missingIndex = entries.findIndex(entry => !entry.name.trim() || !entry.imageUrl)
    if (missingIndex >= 0) {
      Taro.showToast({ title: `请补全第 ${missingIndex + 1} 道菜的名称`, icon: 'none' })
      return
    }
    const { confirm } = await Taro.showModal({
      title: `发布 ${entries.length} 道菜`,
      content: '学校、校区、食堂等公共信息只提交一次；每道菜会立即建立版本并在后台分析营养。',
      confirmText: '立即发布',
    })
    if (!confirm) return
    setSubmitting(true)
    try {
      const now = new Date()
      await createCampusCollectorBatch({
        client_batch_key: clientBatchKey,
        batch_name: `${selectedSchool.name}-${selectedCanteen.name}-${now.toISOString().slice(0, 10)}`,
        venue_type: 'university',
        school_id: selectedSchool.id, campus_id: selectedCampus.id, canteen_id: selectedCanteen.id,
        organization_name: selectedSchool.name, area_name: selectedCampus.name, canteen_name: selectedCanteen.name,
        default_floor: floor || undefined, default_window_name: windowName.trim() || undefined,
        default_window_layout: 'unknown', default_service_mode: 'unknown', captured_at: now.toISOString(),
        source_note: batchNote.trim() || undefined,
        entries: entries.map(entry => ({
          entry_type: 'dish', name: entry.name.trim(), image_paths: [entry.imageUrl],
          floor: floor || undefined, window_name: windowName.trim() || undefined,
          price_type: entry.price ? 'fixed' : 'unknown', price: entry.price ? Number(entry.price) : undefined,
          price_unit: entry.price ? '元/份' : undefined, portion_description: entry.portion.trim() || undefined,
        })),
      })
      Taro.setStorageSync('food_library_need_refresh', '1')
      setEntries([])
      setBatchNote('')
      setClientBatchKey(newCollectorBatchKey())
      Taro.showToast({ title: `已发布 ${entries.length} 道菜`, icon: 'success' })
    } catch (error) {
      await showUnifiedApiError(error, '批量发布失败')
    } finally {
      setSubmitting(false)
    }
  }

  const pendingApplication = profile?.applications?.find(item => item.status === 'pending')

  return (
      <View className={`collector-page ${isDark ? 'collector-page--dark' : ''}`}>
        <View className='collector-hero'>
          <Text className='collector-title'>校园代理批量采集</Text>
          <Text className='collector-subtitle'>一次选择学校、食堂、楼层和窗口，再连续拍照录入多道菜。菜名和清晰照片必填，价格与份量可以后补。</Text>
        </View>

        {profileLoading ? (
          <View className='collector-loading'><View className='collector-spinner' /></View>
        ) : !profile?.can_batch ? (
          <View className='collector-card'>
            <Text className='collector-card-title'>{pendingApplication ? '申请审核中' : '申请批量采集通道'}</Text>
            <Text className='collector-card-desc'>普通用户已经可以单菜上传；批量通道需按学校授权，不能访问后台其他数据。</Text>
            {pendingApplication ? (
              <View className='collector-status-row'>
                <Text className='collector-status-dot' />
                <Text>申请已收到，管理员授权后本页会自动开放批量采集。</Text>
              </View>
            ) : (
              <>
                <View className='collector-field' onClick={() => setShowSchoolPicker(true)}>
                  <Text className='collector-label'>学校 *</Text><Text className='collector-value'>{selectedSchool?.name || '请选择'}</Text>
                </View>
                <View className='collector-field' onClick={() => selectedSchool ? setShowCampusPicker(true) : setShowSchoolPicker(true)}>
                  <Text className='collector-label'>校区（可选范围）</Text><Text className='collector-value'>{selectedCampus?.name || '全校'}</Text>
                </View>
                <View className='collector-field' onClick={() => selectedSchool ? setShowCanteenPicker(true) : setShowSchoolPicker(true)}>
                  <Text className='collector-label'>食堂（可选范围）</Text><Text className='collector-value'>{selectedCanteen?.name || '所选范围全部食堂'}</Text>
                </View>
                <Textarea className='collector-textarea' maxlength={500} placeholder='说明你负责的学校、预计采集食堂等（可选）' value={applicationNote} onInput={event => setApplicationNote(event.detail.value)} />
                <View className={`collector-primary ${applying ? 'disabled' : ''}`} onClick={() => void submitApplication()}>
                  {applying ? <View className='collector-spinner collector-spinner--light' /> : <Text>提交申请</Text>}
                </View>
              </>
            )}
          </View>
        ) : (
          <ScrollView scrollY className='collector-scroll' enhanced showScrollbar={false}>
            <View className='collector-card'>
              <View className='collector-card-heading'>
                <Text className='collector-card-title'>本次公共信息</Text>
                <Text className='collector-scope-badge'>已授权批量通道</Text>
              </View>
              <View className='collector-field' onClick={() => setShowSchoolPicker(true)}><Text className='collector-label'>学校 *</Text><Text className='collector-value'>{selectedSchool?.name || '请选择'}</Text></View>
              <View className='collector-field' onClick={() => selectedSchool ? setShowCampusPicker(true) : setShowSchoolPicker(true)}><Text className='collector-label'>校区 *</Text><Text className='collector-value'>{selectedCampus?.name || '请选择'}</Text></View>
              <View className='collector-field' onClick={() => selectedSchool ? setShowCanteenPicker(true) : setShowSchoolPicker(true)}><Text className='collector-label'>食堂 *</Text><Text className='collector-value'>{selectedCanteen?.name || '请选择'}</Text></View>
              <View className='collector-inline'>
                <View className='collector-field collector-field--half' onClick={() => selectedCanteen ? setShowFloorPicker(true) : undefined}><Text className='collector-label'>楼层</Text><Text className='collector-value'>{floor || '可不填'}</Text></View>
                <View className='collector-field collector-field--half'><Text className='collector-label'>窗口</Text><Input className='collector-input' placeholder='可不填' value={windowName} onInput={event => setWindowName(event.detail.value)} /></View>
              </View>
              <Textarea className='collector-textarea' maxlength={500} placeholder='本批次备注（可选）' value={batchNote} onInput={event => setBatchNote(event.detail.value)} />
            </View>

            <View className='collector-card'>
              <View className='collector-card-heading'>
                <Text className='collector-card-title'>菜品照片 · {entries.length}/{MAX_BATCH_ENTRIES}</Text>
                <View className={`collector-add ${uploading || entries.length >= MAX_BATCH_ENTRIES ? 'disabled' : ''}`} onClick={() => void chooseBatchImages()}>
                  {uploading ? <View className='collector-spinner' /> : <Text>连续拍照 / 多选</Text>}
                </View>
              </View>
              {!entries.length ? <Text className='collector-empty'>选择多张图片后，会自动生成多条待填写菜品。</Text> : entries.map((entry, index) => (
                <View key={entry.id} className='collector-entry'>
                  <Image className='collector-entry-image' src={entry.localPath || entry.imageUrl} mode='aspectFill' />
                  <View className='collector-entry-fields'>
                    <Input className='collector-entry-name' maxlength={100} placeholder={`第 ${index + 1} 道菜名称 *`} value={entry.name} onInput={event => updateEntry(entry.id, { name: event.detail.value })} />
                    <View className='collector-entry-inline'>
                      <Input className='collector-entry-input' type='digit' placeholder='价格（可后补）' value={entry.price} onInput={event => updateEntry(entry.id, { price: event.detail.value })} />
                      <Input className='collector-entry-input' maxlength={100} placeholder='份量（可后补）' value={entry.portion} onInput={event => updateEntry(entry.id, { portion: event.detail.value })} />
                    </View>
                  </View>
                  <Text className='collector-entry-remove' onClick={() => removeEntry(entry.id)}>×</Text>
                </View>
              ))}
            </View>
            <View className={`collector-primary collector-submit ${submitting || !entries.length ? 'disabled' : ''}`} onClick={() => void submitBatch()}>
              {submitting ? <View className='collector-spinner collector-spinner--light' /> : <Text>批量立即发布</Text>}
            </View>
            <View className='collector-safe-area' />
          </ScrollView>
        )}

        <SchoolPicker visible={showSchoolPicker} onSelect={chooseSchool} onCancel={() => setShowSchoolPicker(false)} />
        <CampusPicker visible={showCampusPicker} school={selectedSchool} value={selectedCampus?.id} onSelect={chooseCampus} onCancel={() => setShowCampusPicker(false)} />
        <CanteenPicker visible={showCanteenPicker} school={selectedSchool} campus={selectedCampus} value={selectedCanteen?.id} onSelect={({ campus, canteen }) => chooseCanteen(campus, canteen)} onCancel={() => setShowCanteenPicker(false)} />
        <FloorPicker visible={showFloorPicker} canteen={selectedCanteen} value={floor} onSelect={value => { setFloor(value); setShowFloorPicker(false) }} onCancel={() => setShowFloorPicker(false)} />
      </View>
  )
}

export default withAuth(CampusFoodCollectorPage)

function newCollectorBatchKey(): string {
  const cryptoObject = globalThis.crypto as (Crypto & { randomUUID?: () => string }) | undefined
  return `collector-${cryptoObject?.randomUUID?.call(cryptoObject) || `${Date.now()}-${Math.random().toString(16).slice(2)}`}`
}
