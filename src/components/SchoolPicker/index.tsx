import { useState, useCallback, useEffect, useRef } from 'react'
import { View, Text, Input, ScrollView } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { searchSchools, getSchoolProvinces, getUserLocation, type SchoolItem } from '../../utils/api'
import './index.scss'

interface SchoolPickerProps {
  visible: boolean
  value?: string
  onSelect: (school: SchoolItem) => void
  onCancel: () => void
}

export default function SchoolPicker({ visible, value, onSelect, onCancel }: SchoolPickerProps) {
  const [keyword, setKeyword] = useState('')
  const [results, setResults] = useState<SchoolItem[]>([])
  const [loading, setLoading] = useState(false)
  const [selectedId, setSelectedId] = useState<string>('')
  const [provinces, setProvinces] = useState<string[]>([])
  const [selectedProvince, setSelectedProvince] = useState<string>('')
  const [locatedProvince, setLocatedProvince] = useState<string>('')
  const debounceRef = useRef<NodeJS.Timeout | null>(null)

  // 打开选择器时：按请求 IP 定位省份，再加载该省大学；用户也可以手动切换省份/直辖市。
  useEffect(() => {
    if (!visible) return
    setKeyword('')

    getSchoolProvinces()
      .then(list => {
        setProvinces(list)
      })
      .catch(e => {
        console.error('获取省份列表失败', e)
      })

    getUserLocation()
      .then(loc => {
        if (loc.province) {
          setLocatedProvince(loc.province)
          setSelectedProvince(loc.province)
          doSearch('', loc.province)
        } else {
          setLocatedProvince('')
          setSelectedProvince('')
          doSearch('')
        }
      })
      .catch(e => {
        console.error('获取定位失败', e)
        setLocatedProvince('')
        setSelectedProvince('')
        doSearch('')
      })
  }, [visible])

  const doSearch = useCallback(async (q: string, province?: string) => {
    setLoading(true)
    try {
      const items = await searchSchools(q, province, 50)
      setResults(items)
    } catch (e) {
      console.error('搜索学校失败', e)
      setResults([])
    } finally {
      setLoading(false)
    }
  }, [])

  const handleInput = useCallback((val: string) => {
    setKeyword(val)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      if (val.trim()) {
        // 搜索模式：跨省份搜索
        doSearch(val.trim())
      } else {
        // 清空搜索词：回到当前选中省份
        doSearch('', selectedProvince)
      }
    }, 300)
  }, [doSearch, selectedProvince])

  const handleSelectProvince = useCallback((province: string) => {
    setKeyword('')
    setSelectedProvince(province)
    doSearch('', province)
  }, [doSearch])

  const handleSelect = useCallback((item: SchoolItem) => {
    setSelectedId(item.id)
    onSelect(item)
  }, [onSelect])

  const isSearchMode = keyword.trim().length > 0

  return (
    <View className={`school-picker-overlay ${visible ? 'visible' : ''}`} onClick={onCancel}>
      <View className='school-picker-card' onClick={(e) => e.stopPropagation()}>
        <View className='school-picker-header'>
          <Text className='school-picker-title'>选择大学</Text>
          <Text className='school-picker-close' onClick={onCancel}>关闭</Text>
        </View>

        {/* 搜索框 */}
        <View className='school-picker-search'>
          <Text className='school-picker-search-icon iconfont icon-sousuo' />
          <Input
            className='school-picker-input'
            placeholder='搜索大学名称'
            value={keyword}
            onInput={(e) => handleInput(e.detail.value)}
          />
        </View>

        {/* 定位提示 */}
        {locatedProvince && !isSearchMode && (
          <View className='school-picker-locate-tip'>
            <Text className='school-picker-locate-icon iconfont icon-dingwei' />
            <Text className='school-picker-locate-text'>
              已根据请求 IP 定位到：{locatedProvince}
            </Text>
          </View>
        )}
        {!locatedProvince && !isSearchMode && (
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
              <Text className='school-picker-empty-text'>暂无大学，可切换省份或搜索大学名称</Text>
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
