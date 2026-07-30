import { useState, useCallback, useEffect, useRef } from 'react'
import { View, Text, Input, ScrollView, Picker } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { searchSchools, getSchoolProvinces, getUserLocation, type SchoolItem } from '../../utils/api'
import { useAppColorScheme } from '../AppColorSchemeContext'
import './index.scss'

interface SchoolPickerProps {
  visible: boolean
  locationType?: 'university' | 'company' | 'community'
  value?: string
  onSelect: (school: SchoolItem) => void
  onCancel: () => void
}

type LocationType = 'university' | 'company' | 'community'

const LOCATION_TYPES: Array<{ value: LocationType; label: string }> = [
  { value: 'university', label: '学校' },
  { value: 'company', label: '公司' },
  { value: 'community', label: '社区' },
]

export default function SchoolPicker({ visible, locationType, value, onSelect, onCancel }: SchoolPickerProps) {
  const { scheme } = useAppColorScheme()
  const [activeLocationType, setActiveLocationType] = useState<LocationType | ''>(locationType || '')
  const [keyword, setKeyword] = useState('')
  const [results, setResults] = useState<SchoolItem[]>([])
  const [loading, setLoading] = useState(false)
  const [selectedId, setSelectedId] = useState<string>('')
  const [provinces, setProvinces] = useState<string[]>([])
  const [selectedProvince, setSelectedProvince] = useState<string>('')
  const [locatedProvince, setLocatedProvince] = useState<string>('')
  const debounceRef = useRef<NodeJS.Timeout | null>(null)

  const doSearch = useCallback(async (q: string, province: string | undefined, type: LocationType) => {
    setLoading(true)
    try {
      const items = await searchSchools(q, province, 50, type)
      setResults(items)
    } catch (e) {
      console.error('搜索学校失败', e)
      setResults([])
    } finally {
      setLoading(false)
    }
  }, [])

  const loadLocationType = useCallback((type: LocationType) => {
    setKeyword('')
    setResults([])
    setProvinces([])
    setSelectedProvince('')
    setLocatedProvince('')

    getSchoolProvinces(type)
      .then(setProvinces)
      .catch(e => {
        console.error('获取省份列表失败', e)
      })

    getUserLocation()
      .then(loc => {
        if (loc.province) {
          setLocatedProvince(loc.province)
          setSelectedProvince(loc.province)
          doSearch('', loc.province, type)
        } else {
          doSearch('', undefined, type)
        }
      })
      .catch(e => {
        console.error('获取定位失败', e)
        doSearch('', undefined, type)
      })
  }, [doSearch])

  // 未选择过主体时不默认进入高校搜索；先让用户明确选择学校、公司或社区。
  useEffect(() => {
    if (!visible) return
    const initialType = locationType || ''
    setActiveLocationType(initialType)
    setKeyword('')
    setResults([])
    setProvinces([])
    setSelectedProvince('')
    setLocatedProvince('')
    if (initialType) loadLocationType(initialType)
  }, [visible, locationType, loadLocationType])

  const handleInput = useCallback((val: string) => {
    setKeyword(val)
    if (!activeLocationType) return
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      if (val.trim()) {
        // 搜索模式：跨省份搜索
        doSearch(val.trim(), undefined, activeLocationType)
      } else {
        // 清空搜索词：回到当前选中省份
        doSearch('', selectedProvince, activeLocationType)
      }
    }, 300)
  }, [activeLocationType, doSearch, selectedProvince])

  const handleSelectProvince = useCallback((province: string) => {
    if (!activeLocationType) return
    setKeyword('')
    setSelectedProvince(province)
    doSearch('', province, activeLocationType)
  }, [activeLocationType, doSearch])

  const handleSelectLocationType = useCallback((index: number) => {
    const nextType = LOCATION_TYPES[index]?.value
    if (!nextType) return
    setActiveLocationType(nextType)
    loadLocationType(nextType)
  }, [loadLocationType])

  const handleSelect = useCallback((item: SchoolItem) => {
    setSelectedId(item.id)
    onSelect(item)
  }, [onSelect])

  const isSearchMode = keyword.trim().length > 0
  const isDark = scheme === 'dark'
  const activeTypeIndex = LOCATION_TYPES.findIndex(item => item.value === activeLocationType)
  const activeTypeLabel = LOCATION_TYPES.find(item => item.value === activeLocationType)?.label || ''

  return (
    <View className={`school-picker-overlay ${visible ? 'visible' : ''} ${isDark ? 'school-picker-overlay--dark' : ''}`} onClick={onCancel}>
      <View className='school-picker-card' onClick={(e) => e.stopPropagation()}>
        <View className='school-picker-header'>
          <Text className='school-picker-title'>选择主体</Text>
          <Text className='school-picker-close' onClick={onCancel}>关闭</Text>
        </View>

        <View className='school-picker-subject-row'>
          <Picker
            className='school-picker-type-picker'
            mode='selector'
            range={LOCATION_TYPES.map(item => item.label)}
            value={activeTypeIndex >= 0 ? activeTypeIndex : 0}
            onChange={(event) => handleSelectLocationType(Number(event.detail.value))}
          >
            <View className={`school-picker-type-select ${activeLocationType ? 'selected' : ''}`}>
              <Text>{activeTypeLabel || '学校/公司/社区'}</Text>
              <Text className='school-picker-type-arrow'>⌄</Text>
            </View>
          </Picker>
          <View className={`school-picker-search ${activeLocationType ? '' : 'disabled'}`}>
            <Text className='school-picker-search-icon iconfont icon-sousuo' />
            <Input
              className='school-picker-input'
              disabled={!activeLocationType}
              placeholder={activeLocationType ? `搜索${activeTypeLabel}名称` : '选择学校/公司/社区'}
              value={keyword}
              onInput={(e) => handleInput(e.detail.value)}
            />
          </View>
        </View>

        {/* 定位提示 */}
        {!activeLocationType && (
          <View className='school-picker-locate-tip'>
            <Text className='school-picker-locate-text'>
              请先选择学校、公司或社区，再选择对应名称
            </Text>
          </View>
        )}
        {activeLocationType && locatedProvince && !isSearchMode && (
          <View className='school-picker-locate-tip'>
            <Text className='school-picker-locate-icon iconfont icon-dingwei' />
            <Text className='school-picker-locate-text'>
              已根据请求 IP 定位到：{locatedProvince}
            </Text>
          </View>
        )}
        {activeLocationType && !locatedProvince && !isSearchMode && (
          <View className='school-picker-locate-tip'>
            <Text className='school-picker-locate-icon iconfont icon-dingwei' />
            <Text className='school-picker-locate-text'>
              未识别到当前省份，可手动选择省份或直辖市
            </Text>
          </View>
        )}

        {/* 省份/直辖市标签，可手动切换 */}
        {!isSearchMode && provinces.length > 0 && (
          <ScrollView
            className='school-picker-provinces'
            scrollX
            enhanced
            showScrollbar={false}
          >
            <View className='school-picker-province-list'>
              {provinces.map(p => (
                <View
                  key={p}
                  className={`school-picker-province-tag ${selectedProvince === p ? 'active' : ''}`}
                  onClick={() => handleSelectProvince(p)}
                >
                  <Text className='school-picker-province-text'>
                    {p}{locatedProvince === p ? ' · 当前' : ''}
                  </Text>
                </View>
              ))}
            </View>
          </ScrollView>
        )}

        {/* 学校列表 */}
        <ScrollView className='school-picker-list' scrollY enhanced showScrollbar={false}>
          {loading ? (
            <View className='school-picker-loading'>
              <View className='school-picker-spinner' />
            </View>
          ) : results.length === 0 ? (
            <View className='school-picker-empty'>
              <Text className='school-picker-empty-text'>暂无收录地点，可在后台地点目录中新增</Text>
            </View>
          ) : (
            results.map(item => (
              <View
                key={item.id}
                className={`school-picker-item ${selectedId === item.id || value === item.id ? 'selected' : ''}`}
                onClick={() => handleSelect(item)}
              >
                <Text className='school-picker-item-name'>{item.name}</Text>
                {(item.province || item.city) && (
                  <Text className='school-picker-item-meta'>
                    {[item.province, item.city].filter(Boolean).join(' · ')}
                  </Text>
                )}
              </View>
            ))
          )}
        </ScrollView>
      </View>
    </View>
  )
}
