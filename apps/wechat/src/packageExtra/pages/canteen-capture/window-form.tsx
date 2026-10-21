import { Input, Text, View } from '@tarojs/components'
import type {
  CapturedWindow,
  CaptureServiceMode,
  CaptureVenueType,
} from '../../../utils/canteen-capture-api'
import type { SchoolCampusItem, SchoolCanteenItem, SchoolItem } from '../../../utils/api'
import { SERVICE_MODE_OPTIONS, VENUE_OPTIONS } from './capture-view'

export interface WindowFormValue {
  venueType: CaptureVenueType
  school: SchoolItem | null
  campus: SchoolCampusItem | null
  canteen: SchoolCanteenItem | null
  organizationName: string
  canteenName: string
  floor: string
  windowName: string
  serviceMode: CaptureServiceMode
}

interface WindowFormProps {
  value: WindowFormValue
  capturedWindows: CapturedWindow[]
  onChange: (patch: Partial<WindowFormValue>) => void
  onPickSchool: () => void
  onPickCampus: () => void
  onPickCanteen: () => void
  onPickFloor: () => void
}

/** 第一步：确定是哪一个窗口。一个窗口一组，奖励按窗口计算。 */
export default function WindowForm({
  value, capturedWindows, onChange, onPickSchool, onPickCampus, onPickCanteen, onPickFloor,
}: WindowFormProps) {
  const isCampus = value.venueType === 'university'
  const organizationLabel = VENUE_OPTIONS.find(option => option.value === value.venueType)?.organization || '机构'
  return (
    <View className='capture-card'>
      <Text className='capture-card-title'>选择窗口</Text>
      <View className='capture-chips'>
        {VENUE_OPTIONS.map(option => (
          <View
            key={option.value}
            className={`capture-chip ${value.venueType === option.value ? 'active' : ''}`}
            onClick={() => onChange({ venueType: option.value, school: null, campus: null, canteen: null, organizationName: '', canteenName: '' })}
          ><Text>{option.label}</Text></View>
        ))}
      </View>
      {isCampus ? <>
        <View className='capture-field' onClick={onPickSchool}>
          <Text className='capture-label'>学校 *</Text><Text className='capture-value'>{value.school?.name || '请选择'}</Text>
        </View>
        <View className='capture-field' onClick={value.school ? onPickCampus : onPickSchool}>
          <Text className='capture-label'>校区 *</Text><Text className='capture-value'>{value.campus?.name || '请选择'}</Text>
        </View>
        <View className='capture-field' onClick={value.school ? onPickCanteen : onPickSchool}>
          <Text className='capture-label'>食堂 *</Text><Text className='capture-value'>{value.canteen?.name || '请选择'}</Text>
        </View>
      </> : <>
        <View className='capture-field'>
          <Text className='capture-label'>{organizationLabel}名称 *</Text>
          <Input className='capture-input' maxlength={200} placeholder='填写名称' value={value.organizationName}
            onInput={event => onChange({ organizationName: event.detail.value })}
          />
        </View>
        <View className='capture-field'>
          <Text className='capture-label'>食堂 *</Text>
          <Input className='capture-input' maxlength={200} placeholder='填写食堂名称' value={value.canteenName}
            onInput={event => onChange({ canteenName: event.detail.value })}
          />
        </View>
      </>}
      <View className='capture-field' onClick={isCampus && value.canteen ? onPickFloor : undefined}>
        <Text className='capture-label'>楼层</Text>
        {isCampus
          ? <Text className='capture-value'>{value.floor || '可不填'}</Text>
          : <Input className='capture-input' maxlength={20} placeholder='可不填' value={value.floor} onInput={event => onChange({ floor: event.detail.value })} />}
      </View>
      <View className='capture-field'>
        <Text className='capture-label'>窗口名称 *</Text>
        <Input className='capture-input' maxlength={40} placeholder='招牌名，如“上海风味”' value={value.windowName}
          onInput={event => onChange({ windowName: event.detail.value })}
        />
      </View>
      <Text className='capture-sub-label'>窗口类型（选填）</Text>
      <View className='capture-chips capture-chips--compact'>
        {SERVICE_MODE_OPTIONS.map(option => (
          <View key={option.value} className={`capture-chip ${value.serviceMode === option.value ? 'active' : ''}`}
            onClick={() => onChange({ serviceMode: option.value })}
          ><Text>{option.label}</Text></View>
        ))}
      </View>
      {capturedWindows.length > 0 && (
        <View className='capture-taken'>
          <Text className='capture-sub-label'>这个食堂已采过的窗口</Text>
          <View className='capture-chips capture-chips--compact'>
            {capturedWindows.map(window => (
              <View key={window.window_key} className={`capture-taken-chip ${window.rewarded ? 'rewarded' : ''}`}>
                <Text>{[window.floor, window.window_name].filter(Boolean).join(' · ')}{window.rewarded ? ' · 已领奖' : ''}</Text>
              </View>
            ))}
          </View>
        </View>
      )}
    </View>
  )
}
