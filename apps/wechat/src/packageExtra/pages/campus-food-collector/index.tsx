import { Image, Input, ScrollView, Text, Textarea, View } from '@tarojs/components'
import Taro, { useDidShow, useRouter } from '@tarojs/taro'
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
const VENUE_OPTIONS = [
  { value: 'university', label: '校园食堂', organization: '学校' },
  { value: 'community', label: '社区食堂', organization: '社区' },
  { value: 'office_park', label: '园区食堂', organization: '园区' },
  { value: 'corporate', label: '公司食堂', organization: '公司' },
] as const
type VenueType = typeof VENUE_OPTIONS[number]['value']
const placeKey = (value?: string) => {
  const name = (value || '').trim().toLowerCase()
  return name === '北京ai原点社区' ? 'ai原点社区' : name
}

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
  const params = useRouter().params || {}
  const [venueType, setVenueType] = useState<VenueType>(() => VENUE_OPTIONS.find(item => item.value === params.venue_type)?.value || 'university')
  const isCampus = venueType === 'university'
  const [organizationName, setOrganizationName] = useState(params.organization_name || '')
  const [areaName, setAreaName] = useState('')
  const [venueCanteenName, setVenueCanteenName] = useState(params.canteen_name || '')
  const initializedScope = useRef(false)
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
    } catch (error) {
      console.error('读取食堂采集员资料失败', error)
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

  useEffect(() => {
    if (initializedScope.current) return
    const scope = profile?.active_scopes?.find(item => (item.venue_type || 'university') === venueType
      && (venueType === 'university' || !organizationName || placeKey(item.organization_name) === placeKey(organizationName)))
    if (!scope) return
    initializedScope.current = true
    if (venueType !== 'university') {
      setOrganizationName(scope.organization_name || '')
      setVenueCanteenName(scope.scope_canteen_name || scope.canteen_name || '')
    } else {
      if (!scope.school_id) return
      setSelectedSchool({ id: scope.school_id, name: scope.school_name || '已授权学校' })
      setSelectedCampus(scope.campus_id ? { id: scope.campus_id, school_id: scope.school_id, name: scope.campus_name || '已授权校区' } : null)
      setSelectedCanteen(scope.canteen_id ? { id: scope.canteen_id, school_id: scope.school_id, campus_id: scope.campus_id, name: scope.canteen_name || '已授权食堂' } : null)
    }
  }, [profile, venueType, organizationName])

  const chooseSchool = (school: SchoolItem) => {
    setSelectedSchool(school)
    setSelectedCampus(null)
    setSelectedCanteen(null)
    setFloor('')
    setWindowName('')
    setShowSchoolPicker(false)
  }

  const chooseCampus = (campus: SchoolCampusItem) => {
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
    if ((isCampus ? !selectedSchool?.id : !organizationName.trim()) || applying) {
      if (!applying) Taro.showToast({ title: isCampus ? '请先选择学校' : '请填写社区、园区或公司名称', icon: 'none' })
      return
    }
    setApplying(true)
    try {
      await applyCampusCollector({
        venue_type: venueType,
        school_id: isCampus ? selectedSchool?.id : undefined,
        campus_id: isCampus ? selectedCampus?.id : undefined,
        canteen_id: isCampus ? selectedCanteen?.id : undefined,
        organization_name: !isCampus ? organizationName.trim() : undefined,
        canteen_name: !isCampus ? venueCanteenName.trim() || undefined : undefined,
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
    if (isCampus ? !selectedSchool?.id || !selectedCampus?.id || !selectedCanteen?.id : !organizationName.trim() || !venueCanteenName.trim()) {
      Taro.showToast({ title: isCampus ? '请选择学校、校区和食堂' : '请填写机构和食堂名称', icon: 'none' })
      return
    }
    if (!canBatchHere) { Taro.showToast({ title: '请先申请当前食堂范围的批量权限', icon: 'none' }); return }
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
      content: '地点信息只提交一次；每道菜会立即建立版本并在后台分析营养。',
      confirmText: '立即发布',
    })
    if (!confirm) return
    setSubmitting(true)
    try {
      const now = new Date()
      await createCampusCollectorBatch({
        client_batch_key: clientBatchKey,
        batch_name: `${isCampus ? selectedSchool?.name : organizationName}-${isCampus ? selectedCanteen?.name : venueCanteenName}-${now.toISOString().slice(0, 10)}`,
        venue_type: venueType,
        school_id: isCampus ? selectedSchool?.id : undefined, campus_id: isCampus ? selectedCampus?.id : undefined, canteen_id: isCampus ? selectedCanteen?.id : undefined,
        organization_name: isCampus ? selectedSchool!.name : organizationName.trim(), area_name: isCampus ? selectedCampus!.name : areaName.trim(), canteen_name: isCampus ? selectedCanteen!.name : venueCanteenName.trim(),
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

  const matchingScope = (scope: NonNullable<CampusCollectorProfile['active_scopes']>[number]) => (
    (scope.venue_type || 'university') === venueType && (isCampus
      ? (!selectedSchool || scope.school_id === selectedSchool.id)
        && (!selectedCampus || !scope.campus_id || scope.campus_id === selectedCampus.id)
        && (!selectedCanteen || !scope.canteen_id || scope.canteen_id === selectedCanteen.id)
      : placeKey(scope.organization_name) === placeKey(organizationName)
        && (!scope.scope_canteen_name || placeKey(scope.scope_canteen_name) === placeKey(venueCanteenName)))
  )
  const canBatchHere = !!profile?.active_scopes?.some(matchingScope)
  const pendingApplication = profile?.applications?.find(item => item.status === 'pending' && (item.venue_type || 'university') === venueType
    && (isCampus ? !selectedSchool || item.school_id === selectedSchool.id : placeKey(item.organization_name) === placeKey(organizationName)))
  const genericFields = (application = false) => <>
    <View className='collector-field'><Text className='collector-label'>{VENUE_OPTIONS.find(item => item.value === venueType)?.organization}名称 *</Text><Input className='collector-input' maxlength={200} placeholder='填写名称' value={organizationName} onInput={event => setOrganizationName(event.detail.value)} /></View>
    <View className='collector-field'><Text className='collector-label'>食堂{application ? '（可选范围）' : ' *'}</Text><Input className='collector-input' maxlength={200} placeholder={application ? '留空为该机构全部食堂' : '填写食堂名称'} value={venueCanteenName} onInput={event => setVenueCanteenName(event.detail.value)} /></View>
    {!application && <View className='collector-field'><Text className='collector-label'>楼宇 / 区域</Text><Input className='collector-input' maxlength={200} placeholder='可不填' value={areaName} onInput={event => setAreaName(event.detail.value)} /></View>}
  </>

  return (
      <View className={`collector-page ${isDark ? 'collector-page--dark' : ''}`}>
        <View className='collector-hero'>
          <Text className='collector-title'>食堂批量上传</Text>
          <Text className='collector-subtitle'>地点只填一次，连续拍照或多选上传。菜名和照片必填，价格与份量可以后补。</Text>
        </View>
        <View className='collector-venue-types'>
          {VENUE_OPTIONS.map(option => (
            <View
              key={option.value}
              className={`collector-venue-type ${venueType === option.value ? 'active' : ''}`}
              onClick={() => {
                if (entries.length || submitting || uploading) { Taro.showToast({ title: '请先提交或移除本批次菜品', icon: 'none' }); return }
                setVenueType(option.value); setOrganizationName(''); setVenueCanteenName(''); initializedScope.current = false
              }}
            ><Text>{option.label}</Text></View>
          ))}
        </View>

        {profileLoading ? (
          <View className='collector-loading'><View className='collector-spinner' /></View>
        ) : !canBatchHere ? (
          <View className='collector-card'>
            <Text className='collector-card-title'>{pendingApplication ? '申请审核中' : '申请批量采集通道'}</Text>
            <Text className='collector-card-desc'>批量通道按所在学校、社区、园区或公司授权。</Text>
            {pendingApplication ? (
              <View className='collector-status-row'>
                <Text className='collector-status-dot' />
                <Text>申请已收到，管理员授权后本页会自动开放批量采集。</Text>
              </View>
            ) : (
              <>
                {isCampus ? <>
                <View className='collector-field' onClick={() => setShowSchoolPicker(true)}>
                  <Text className='collector-label'>学校 *</Text><Text className='collector-value'>{selectedSchool?.name || '请选择'}</Text>
                </View>
                <View className='collector-field' onClick={() => selectedSchool ? setShowCampusPicker(true) : setShowSchoolPicker(true)}>
                  <Text className='collector-label'>校区（可选范围）</Text><Text className='collector-value'>{selectedCampus?.name || '全校'}</Text>
                </View>
                <View className='collector-field' onClick={() => selectedSchool ? setShowCanteenPicker(true) : setShowSchoolPicker(true)}>
                  <Text className='collector-label'>食堂（可选范围）</Text><Text className='collector-value'>{selectedCanteen?.name || '所选范围全部食堂'}</Text>
                </View>
                </> : genericFields(true)}
                <Textarea className='collector-textarea' maxlength={500} placeholder='说明你负责的食堂和采集安排（可选）' value={applicationNote} onInput={event => setApplicationNote(event.detail.value)} />
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
              {isCampus ? <><View className='collector-field' onClick={() => setShowSchoolPicker(true)}><Text className='collector-label'>学校 *</Text><Text className='collector-value'>{selectedSchool?.name || '请选择'}</Text></View>
              <View className='collector-field' onClick={() => selectedSchool ? setShowCampusPicker(true) : setShowSchoolPicker(true)}><Text className='collector-label'>校区 *</Text><Text className='collector-value'>{selectedCampus?.name || '请选择'}</Text></View>
              <View className='collector-field' onClick={() => selectedSchool ? setShowCanteenPicker(true) : setShowSchoolPicker(true)}><Text className='collector-label'>食堂 *</Text><Text className='collector-value'>{selectedCanteen?.name || '请选择'}</Text></View>
              </> : genericFields()}
              <View className='collector-inline'>
                <View className='collector-field collector-field--half' onClick={() => isCampus && selectedCanteen ? setShowFloorPicker(true) : undefined}><Text className='collector-label'>楼层</Text>{isCampus ? <Text className='collector-value'>{floor || '可不填'}</Text> : <Input className='collector-input' placeholder='可不填' value={floor} onInput={event => setFloor(event.detail.value)} />}</View>
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
