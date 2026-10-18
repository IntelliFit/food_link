import { View, Text, Image, Input, Textarea, PageMeta, Button } from '@tarojs/components'
import { useEffect, useRef, useState } from 'react'
import Taro, { useRouter } from '@tarojs/taro'
import { withAuth } from '../../../utils/withAuth'
import { useAppColorScheme } from '../../../components/AppColorSchemeContext'
import SchoolPicker from '../../../components/SchoolPicker'
import CampusPicker from '../../../components/CampusPicker'
import CanteenPicker from '../../../components/CanteenPicker'
import FloorPicker from '../../../components/FloorPicker'
import { applyThemeNavigationBar } from '../../../utils/theme-navigation-bar'
import {
  createCanteenFood, correctCampusFood, getPublicFoodLibraryItem, showUnifiedApiError,
  uploadCampusFoodImageFile, type SchoolItem, type SchoolCampusItem, type SchoolCanteenItem,
  type CanteenSingleInput,
} from '../../../utils/api'
import { extraPkgUrl } from '../../../utils/subpackage-extra'
import { chooseImageWithPrivacy, isPrivacyAuthorizeError, showPrivacyAuthorizeFailure } from '../../../utils/weapp-privacy'
import './index.scss'

const MAX_IMAGES = 5
const PRICE_TYPES = ['fixed', 'by_weight', 'range', 'combo', 'unknown']
const PRICE_LABELS: Record<string, string> = { fixed: '按份', by_weight: '称重', range: '价格区间', combo: '套餐', unknown: '不确定' }
const PRICE_UNITS: Record<string, string> = { fixed: '元/份', by_weight: '元/斤', range: '元/份', combo: '元/套', unknown: '元' }
const today = () => {
  const date = new Date()
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function CampusFoodSharePage() {
  const { scheme } = useAppColorScheme()
  const params = useRouter().params || {}
  const param = (key: string) => { try { return decodeURIComponent(params[key] || '') } catch { return params[key] || '' } }
  const targetId = param('correct_id') || param('edit_id')
  const isEdit = !!targetId
  const [venueType, setVenueType] = useState<CanteenSingleInput['venue_type']>(param('scope') === 'community' ? 'community' : 'university')
  const isCampus = venueType === 'university'
  const [school, setSchool] = useState<SchoolItem | null>(() => param('school_id') ? { id: param('school_id'), name: param('school_name') } : null)
  const [campus, setCampus] = useState<SchoolCampusItem | null>(() => param('campus_id') ? { id: param('campus_id'), school_id: param('school_id'), name: param('campus_name') } : null)
  const [canteen, setCanteen] = useState<SchoolCanteenItem | null>(() => param('canteen_id') ? { id: param('canteen_id'), school_id: param('school_id'), campus_id: param('campus_id'), name: param('canteen_name') } : null)
  const [organizationName, setOrganizationName] = useState(param('organization_name'))
  const [areaName, setAreaName] = useState(param('area_name'))
  const [canteenName, setCanteenName] = useState(param('canteen_name'))
  const [foodName, setFoodName] = useState('')
  const [images, setImages] = useState<string[]>([])
  const [floor, setFloor] = useState(param('floor'))
  const [windowName, setWindowName] = useState(param('window_name'))
  const [priceType, setPriceType] = useState('fixed')
  const [price, setPrice] = useState('')
  const [priceMax, setPriceMax] = useState('')
  const [priceUnit, setPriceUnit] = useState('元/份')
  const [priceDate, setPriceDate] = useState(today)
  const [portion, setPortion] = useState('')
  const [notes, setNotes] = useState('')
  const [availability, setAvailability] = useState<'available' | 'temporarily_unavailable' | 'discontinued' | 'unknown'>('available')
  const [baseVersion, setBaseVersion] = useState(0)
  const [optionalOpen, setOptionalOpen] = useState(isEdit)
  const [picker, setPicker] = useState<'school' | 'campus' | 'canteen' | 'floor' | null>(null)
  const [uploading, setUploading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(isEdit)
  const busy = useRef(false)
  const imageBusy = useRef(false)
  const clientKey = useRef(`${Date.now()}-${Math.random().toString(16).slice(2)}`)

  useEffect(() => {
    applyThemeNavigationBar(scheme, { lightBackground: '#f9fafb', darkBackground: '#07110f' })
  }, [scheme, isEdit])

  useEffect(() => {
    if (!targetId) return
    let cancelled = false
    getPublicFoodLibraryItem(targetId).then(data => {
      if (cancelled) return
      if (data.type !== 'campus' && !data.is_campus_food && !data.catalog_item_id) throw new Error('该条目不是食堂共建菜品')
      setBaseVersion(data.content_version || 1)
      setVenueType(data.venue_type || 'university')
      setFoodName(data.food_name || '')
      setImages(data.image_paths?.length ? data.image_paths : data.image_path ? [data.image_path] : [])
      setSchool(data.school_id ? { id: data.school_id, name: data.school_name || '' } : null)
      setCampus(data.campus_id ? { id: data.campus_id, school_id: data.school_id || '', name: data.campus_name || '' } : null)
      setCanteen(data.canteen_id ? { id: data.canteen_id, school_id: data.school_id || '', campus_id: data.campus_id || '', name: data.canteen_name || '' } : null)
      setOrganizationName(data.venue_organization_name || '')
      setAreaName(data.venue_area_name || '')
      setCanteenName(data.venue_canteen_name || data.canteen_name || '')
      setFloor(data.floor || '')
      setWindowName(data.window_name || '')
      const type = data.price_type === 'weight' ? 'by_weight' : data.price_type || 'unknown'
      setPriceType(type)
      setPrice(String((type === 'range' ? data.price_min : data.price) || ''))
      setPriceMax(String(data.price_max || ''))
      setPriceUnit(data.price_unit || PRICE_UNITS[type])
      setPriceDate(data.price_collected_at?.slice(0, 10) || today())
      setPortion(data.portion_description || '')
      setNotes(data.user_notes || '')
      setAvailability(data.availability_status || 'available')
    }).catch(error => { if (!cancelled) void showUnifiedApiError(error, '读取菜品失败，请返回重试') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [targetId])

  const choosePhotos = async () => {
    if (imageBusy.current || images.length >= MAX_IMAGES) return
    imageBusy.current = true
    try {
      const result = await chooseImageWithPrivacy({ count: MAX_IMAGES - images.length, sizeType: ['compressed'], sourceType: ['camera', 'album'] })
      setUploading(true)
      let failed = false
      for (const path of result.tempFilePaths || []) {
        try {
          const uploaded = await uploadCampusFoodImageFile(path)
          setImages(previous => [...previous, uploaded.imageUrl])
        } catch { failed = true }
      }
      if (failed) Taro.showToast({ title: '部分照片未上传，请重试', icon: 'none' })
    } catch (error: any) {
      if (isPrivacyAuthorizeError(error)) showPrivacyAuthorizeFailure(error)
      else if (!error?.errMsg?.includes('cancel')) await showUnifiedApiError(error, '选择照片失败')
    } finally { imageBusy.current = false; setUploading(false) }
  }

  const choosePriceType = async () => {
    try {
      const { tapIndex } = await Taro.showActionSheet({ itemList: PRICE_TYPES.map(type => PRICE_LABELS[type]) })
      const type = PRICE_TYPES[tapIndex]
      if (type) { setPriceType(type); setPriceUnit(PRICE_UNITS[type]); setPrice(''); setPriceMax('') }
    } catch { /* cancelled */ }
  }

  const submit = async () => {
    if (busy.current || imageBusy.current || loading) return
    const invalid = !foodName.trim() ? '请填写菜品名称'
      : !isEdit && !images.length ? '请上传至少一张菜品照片'
      : isCampus && (!school?.id || !campus?.id || !canteen?.id) ? '请选择学校、校区和食堂'
      : !isCampus && (!organizationName.trim() || !canteenName.trim()) ? '请填写社区或园区、食堂名称'
      : isEdit && !baseVersion ? '菜品尚未读取成功，请返回重试' : ''
    if (invalid) { Taro.showToast({ title: invalid, icon: 'none' }); return }
    const hasPrice = price.trim() !== ''
    if ((hasPrice && (!Number.isFinite(Number(price)) || Number(price) <= 0)) ||
      (priceType === 'range' && (hasPrice || priceMax.trim()) && (!hasPrice || !Number.isFinite(Number(priceMax)) || Number(priceMax) < Number(price)))) {
      Taro.showToast({ title: '请填写正确的价格或区间', icon: 'none' }); return
    }
    if (hasPrice && (!/^\d{4}-\d{2}-\d{2}$/.test(priceDate) || Number.isNaN(Date.parse(priceDate)))) {
      Taro.showToast({ title: '日期格式应为 YYYY-MM-DD', icon: 'none' }); return
    }
    busy.current = true
    setSaving(true)
    const shared = {
      name: foodName.trim(), image_paths: images, floor: floor.trim(), window_name: windowName.trim(),
      price_type: hasPrice ? priceType : 'unknown', price: hasPrice && priceType !== 'range' ? Number(price) : undefined,
      price_min: hasPrice && priceType === 'range' ? Number(price) : undefined,
      price_max: hasPrice && priceType === 'range' ? Number(priceMax) : undefined,
      price_unit: priceUnit.trim(), portion_description: portion.trim(), notes: notes.trim(),
    }
    try {
      if (isEdit) {
        await correctCampusFood(targetId, {
          base_version: baseVersion,
          patch: {
            ...shared, price: shared.price ?? null, price_min: shared.price_min ?? null, price_max: shared.price_max ?? null,
            ...(isCampus ? { school_id: school!.id, campus_id: campus!.id, canteen_id: canteen!.id }
              : { school_name: organizationName.trim(), campus_name: areaName.trim(), canteen_name: canteenName.trim() }),
            price_collected_at: hasPrice ? `${priceDate}T00:00:00+08:00` : null, availability_status: availability,
          },
          reason: '用户修正食堂菜品信息', evidence_image_paths: images,
        })
        Taro.setStorageSync('food_library_need_refresh', '1')
        Taro.showToast({ title: '菜品信息已更新', icon: 'success' })
        Taro.navigateBack()
      } else {
        const result = await createCanteenFood({
          client_batch_key: clientKey.current, venue_type: venueType,
          school_id: isCampus ? school!.id : undefined, campus_id: isCampus ? campus!.id : undefined,
          canteen_id: isCampus ? canteen!.id : undefined,
          organization_name: isCampus ? school!.name : organizationName.trim(),
          area_name: isCampus ? campus!.name : areaName.trim(), canteen_name: isCampus ? canteen!.name : canteenName.trim(),
          captured_at: hasPrice ? `${priceDate}T00:00:00+08:00` : undefined, entries: [{ ...shared, entry_type: 'dish' }],
        })
        const id = result.items?.[0]?.id
        if (!id) throw new Error('未收到菜品编号，请重试')
        Taro.setStorageSync('food_library_need_refresh', '1')
        await Taro.redirectTo({ url: `${extraPkgUrl('/pages/food-library-detail/index')}?id=${encodeURIComponent(id)}${isCampus ? '&scene=campus' : ''}` })
      }
    } catch (error) { await showUnifiedApiError(error, '保存失败，填写内容已保留') }
    finally { busy.current = false; setSaving(false) }
  }

  const openDirectory = (next: 'campus' | 'canteen') => {
    if (!school) { setPicker('school'); return }
    setPicker(next)
  }

  return <>
    <PageMeta backgroundColor={scheme === 'dark' ? '#07110f' : '#f9fafb'} />
    <View className={`campus-share-page ${scheme === 'dark' ? 'campus-share-page--dark' : ''}`}>
      <View className='campus-share-hero'>
        <Text className='campus-share-hero__title'>{isEdit ? '修正这道菜' : '上传食堂菜品'}</Text>
        <Text className='campus-share-hero__subtitle'>{isEdit ? '修改立即生效，并保留更新记录。' : '照片、菜名、地点填好即可发布。营养在保存后分析，不用等待。'}</Text>
      </View>
      {loading ? <View className='campus-share-section'><View className='btn-spinner' /></View> : <>
        <View className='campus-share-section'>
          <Text className='section-title'>菜品照片{!isEdit && <Text className='required'>*</Text>}<Text className='image-count'>{images.length}/{MAX_IMAGES}</Text></Text>
          <View className='share-image-grid'>
            {images.map((url, index) => <View className='share-grid-item' key={`${url}-${index}`}>
              <Image className='share-grid-image' src={url} mode='aspectFill' onClick={() => Taro.previewImage({ urls: images, current: url })} />
              {!uploading && <Button className='share-grid-remove' ariaLabel={`移除第${index + 1}张照片`} onClick={() => setImages(previous => previous.filter((_, i) => i !== index))}>×</Button>}
            </View>)}
            {images.length < MAX_IMAGES && <Button id='canteen-choose-photos' className='share-grid-add' disabled={uploading} onClick={choosePhotos}>{uploading ? <View className='btn-spinner' /> : <><Text className='upload-icon'>＋</Text><Text>添加照片</Text></>}</Button>}
          </View>
          <Text className='field-help'>同一道菜可上传多张照片；上传照片时也能继续填写。</Text>
          <View className='form-item'><Text className='form-label'>菜品名称 <Text className='required'>*</Text></Text><Input id='canteen-food-name' className='form-input' placeholder='如：麻辣牛肉粉＋卤蛋' value={foodName} maxlength={100} onInput={e => setFoodName(e.detail.value)} /></View>
        </View>
        <View className='campus-share-section'>
          <Text className='section-title'>在哪个食堂 <Text className='required'>*</Text></Text>
          {!isEdit && (!params.scope || params.scope === 'all') && <View className='quick-tags'>
            <Button className={`quick-tag ${isCampus ? 'selected' : ''}`} onClick={() => setVenueType('university')}>校园食堂</Button>
            <Button className={`quick-tag ${!isCampus ? 'selected' : ''}`} onClick={() => setVenueType('community')}>社区 / 园区食堂</Button>
          </View>}
          {isCampus ? <>
            <View className='directory-form-row directory-form-row--two'>
              <View className='form-item'><Text className='form-label'>学校</Text><Button className='form-input picker-display' onClick={() => setPicker('school')}>{school?.name || '选择学校'}<Text>⌄</Text></Button></View>
              <View className='form-item'><Text className='form-label'>校区</Text><Button className='form-input picker-display' onClick={() => openDirectory('campus')}>{campus?.name || '选择校区'}<Text>⌄</Text></Button></View>
            </View>
            <View className='form-item'><Text className='form-label'>食堂</Text><Button className='form-input picker-display' onClick={() => openDirectory('canteen')}>{canteen?.name || '选择食堂'}<Text>⌄</Text></Button></View>
          </> : <>
            <View className='form-item'><Text className='form-label'>社区 / 园区名称</Text><Input className='form-input' placeholder='填写社区或园区名称' value={organizationName} maxlength={100} onInput={e => setOrganizationName(e.detail.value)} /></View>
            <View className='form-item'><Text className='form-label'>食堂名称</Text><Input className='form-input' placeholder='填写食堂名称' value={canteenName} maxlength={100} onInput={e => setCanteenName(e.detail.value)} /></View>
            <View className='form-item'><Text className='form-label'>所在位置（选填）</Text><Input className='form-input' placeholder='如：朝阳区青年路，社区东门' value={areaName} maxlength={200} onInput={e => setAreaName(e.detail.value)} /></View>
          </>}
        </View>
        <View className='campus-share-section'>
          <Button id='canteen-optional-toggle' className='optional-toggle' onClick={() => setOptionalOpen(!optionalOpen)}><Text>补充信息（选填）</Text><Text>{optionalOpen ? '收起 ⌃' : '展开 ⌄'}</Text></Button>
          {!optionalOpen && <Text className='field-help'>楼层、窗口、价格、份量；现在不填，之后也能补充。</Text>}
          {optionalOpen && <>
            <View className='directory-form-row directory-form-row--two'>
              <View className='form-item'><Text className='form-label'>楼层</Text>{isCampus ? <Button className='form-input picker-display' onClick={() => canteen ? setPicker('floor') : openDirectory('canteen')}>{floor || '选择楼层'}<Text>⌄</Text></Button> : <Input className='form-input' placeholder='如：一层' value={floor} onInput={e => setFloor(e.detail.value)} />}</View>
              <View className='form-item'><Text className='form-label'>窗口</Text><Input className='form-input' placeholder='如：12号窗口' value={windowName} maxlength={100} onInput={e => setWindowName(e.detail.value)} /></View>
            </View>
            <View className='directory-form-row directory-form-row--two'>
              <View className='form-item'><Text className='form-label'>计价方式</Text><Button className='form-input picker-display' onClick={choosePriceType}>{PRICE_LABELS[priceType]}<Text>⌄</Text></Button></View>
              <View className='form-item'><Text className='form-label'>{priceType === 'range' ? '最低价' : '价格'}</Text><Input className='form-input' type='digit' placeholder='不知道可不填' value={price} onInput={e => setPrice(e.detail.value)} /></View>
            </View>
            {priceType === 'range' && <View className='form-item'><Text className='form-label'>最高价</Text><Input className='form-input' type='digit' placeholder='最高价' value={priceMax} onInput={e => setPriceMax(e.detail.value)} /></View>}
            {!!price && <View className='directory-form-row directory-form-row--two'>
              <View className='form-item'><Text className='form-label'>价格单位</Text><Input className='form-input' value={priceUnit} onInput={e => setPriceUnit(e.detail.value)} /></View>
              <View className='form-item'><Text className='form-label'>价格日期</Text><Input className='form-input' placeholder='YYYY-MM-DD' value={priceDate} onInput={e => setPriceDate(e.detail.value)} /></View>
            </View>}
            <View className='form-item'><Text className='form-label'>份量说明</Text><Input className='form-input' placeholder='如：小碗、约一人份' value={portion} maxlength={200} onInput={e => setPortion(e.detail.value)} /></View>
            <View className='form-item'><Text className='form-label'>补充说明</Text><Textarea className='form-textarea' placeholder='口味、搭配、售卖时间等' value={notes} maxlength={500} onInput={e => setNotes(e.detail.value)} /></View>
            {isEdit && <View className='form-item'><Text className='form-label'>供应状态</Text><View className='quick-tags'>{([['available', '正常供应'], ['temporarily_unavailable', '暂时无售'], ['discontinued', '已停售'], ['unknown', '不确定']] as const).map(([value, label]) => <Button key={value} className={`quick-tag ${availability === value ? 'selected' : ''}`} onClick={() => setAvailability(value)}>{label}</Button>)}</View></View>}
          </>}
        </View>
      </>}
      <View className='submit-bar'><Button id='canteen-submit' className='submit-btn' disabled={saving || uploading || loading || (isEdit && !baseVersion)} onClick={submit}>{saving ? <View className='btn-spinner' /> : isEdit ? '保存修改' : '发布菜品'}</Button></View>
      <SchoolPicker visible={picker === 'school'} onCancel={() => setPicker(null)} onSelect={value => { setSchool(value); setCampus(null); setCanteen(null); setFloor(''); setWindowName(''); setPicker(null) }} />
      <CampusPicker visible={picker === 'campus'} school={school} value={campus?.id} onCancel={() => setPicker(null)} onSelect={value => { setCampus(value); setCanteen(null); setFloor(''); setWindowName(''); setPicker(null) }} />
      <CanteenPicker visible={picker === 'canteen'} school={school} campus={campus} value={canteen?.id} onCancel={() => setPicker(null)} onSelect={value => { setCampus(value.campus); setCanteen(value.canteen); setFloor(''); setWindowName(''); setPicker(null) }} />
      <FloorPicker visible={picker === 'floor'} canteen={canteen} value={floor} onCancel={() => setPicker(null)} onSelect={value => { setFloor(value); setPicker(null) }} />
    </View>
  </>
}

export default withAuth(CampusFoodSharePage)
