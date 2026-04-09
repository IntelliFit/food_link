import { View, Text, Input, ScrollView, Map } from '@tarojs/components'
import { useState, useEffect } from 'react'
import Taro, { getCurrentInstance } from '@tarojs/taro'
import { API_BASE_URL } from '../../utils/api'
import './index.scss'
import { withAuth } from '../../utils/withAuth'

type PoiItem = {
  name: string
  address: string
  lonlat: string
}

type SearchResponse = {
  pois?: Array<{ name?: string; address?: string; lonlat?: string }>
  prompt?: Array<{ admins?: Array<{ adminName?: string }> }>
}

/** 默认中心（北京） */
const DEFAULT_LAT = 39.89945
const DEFAULT_LNG = 116.40769

function LocationSearchPage() {
  const [keyword, setKeyword] = useState('')
  const [searching, setSearching] = useState(false)
  const [locating, setLocating] = useState(false)
  const [centerLat, setCenterLat] = useState(DEFAULT_LAT)
  const [centerLng, setCenterLng] = useState(DEFAULT_LNG)
  const [selectedLat, setSelectedLat] = useState<number | null>(null)
  const [selectedLng, setSelectedLng] = useState<number | null>(null)
  const [selectedName, setSelectedName] = useState('')
  const [selectedAddress, setSelectedAddress] = useState('')
  const [selectedPromptCity, setSelectedPromptCity] = useState('')
  const [results, setResults] = useState<PoiItem[]>([])
  const [promptCity, setPromptCity] = useState('')

  // 进入页面时定位
  useEffect(() => {
    let cancelled = false
    setLocating(true)
    Taro.getLocation({ type: 'wgs84' })
      .then((res) => {
        if (!cancelled) {
          setCenterLat(res.latitude)
          setCenterLng(res.longitude)
        }
      })
      .catch(() => {
        if (!cancelled) {
          Taro.showToast({ title: '定位失败，使用默认位置', icon: 'none' })
        }
      })
      .finally(() => {
        if (!cancelled) setLocating(false)
      })
    return () => { cancelled = true }
  }, [])

  // 地图点击：取该点坐标并逆地理
  const handleMapTap = (e: { detail: { latitude: number; longitude: number } }) => {
    const lat = e.detail.latitude
    const lng = e.detail.longitude
    setCenterLat(lat)
    setCenterLng(lng)
    setSelectedLat(lat)
    setSelectedLng(lng)
    setSelectedName('地图选点')
    setSelectedAddress('')
    setSelectedPromptCity('')
    Taro.request({
      url: `${API_BASE_URL}/api/location/reverse`,
      method: 'POST',
      header: { 'Content-Type': 'application/json' },
      data: { lat, lon: lng },
      timeout: 8000
    }).then((res) => {
      if (res.statusCode !== 200 || !res.data) return
      const d = res.data as Record<string, unknown>
      // 天地图逆地理可能返回 address/result 为对象，需安全取字符串避免显示 [object Object]
      const raw = d.address ?? d.formatted_address ?? d.result
      let addr = ''
      if (typeof raw === 'string') addr = raw
      else if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        const o = raw as Record<string, unknown>
        addr = typeof o.formatted_address === 'string' ? o.formatted_address
          : typeof o.address === 'string' ? o.address
          : ''
      }
      if (addr) setSelectedAddress(addr)
    }).catch(() => {})
  }

  const doSearch = async () => {
    const kw = keyword.trim()
    if (!kw) {
      Taro.showToast({ title: '请输入关键字', icon: 'none' })
      return
    }
    setSearching(true)
    try {
      const res = await Taro.request({
        url: `${API_BASE_URL}/api/location/search`,
        method: 'POST',
        header: { 'Content-Type': 'application/json' },
        data: {
          keyWord: kw,
          count: 20,
          lon: centerLng,
          lat: centerLat,
          radius_km: 5
        },
        timeout: 12000
      })
      const data = res.data as SearchResponse
      const pc = data?.prompt?.[0]?.admins?.[0]?.adminName ?? ''
      setPromptCity(pc)
      const pois = Array.isArray(data?.pois) ? data.pois : []
      setResults(pois.map((p) => ({
        name: p.name ?? '',
        address: p.address ?? '',
        lonlat: p.lonlat ?? ''
      })))
      if (pois.length === 0) {
        Taro.showToast({ title: '未找到相关位置', icon: 'none' })
      }
    } catch {
      Taro.showToast({ title: '搜索失败', icon: 'none' })
    } finally {
      setSearching(false)
    }
  }

  const handleSelectResult = (poi: PoiItem) => {
    const lonlat = poi.lonlat.split(',')
    if (lonlat.length >= 2) {
      const lng = Number(lonlat[0])
      const lat = Number(lonlat[1])
      if (Number.isFinite(lng) && Number.isFinite(lat)) {
        setCenterLat(lat)
        setCenterLng(lng)
        setSelectedLat(lat)
        setSelectedLng(lng)
      }
    }
    setSelectedName(poi.name)
    setSelectedAddress(poi.address)
    setSelectedPromptCity(promptCity)
  }

  const handleConfirm = () => {
    const lat = selectedLat ?? centerLat
    const lng = selectedLng ?? centerLng
    const channel = getCurrentInstance().page?.getOpenerEventChannel?.()
    channel?.emit('locationSelected', {
      name: selectedName || '地图选点',
      address: selectedAddress || '',
      lonlat: `${lng},${lat}`,
      longitude: lng,
      latitude: lat,
      promptCity: selectedPromptCity || promptCity || ''
    })
    Taro.navigateBack()
  }

  const hasSelection = selectedLat != null && selectedLng != null
  // 不传 markers，避免腾讯地图在 fitBounds / pointsChanged 时因单点或内部状态报错（Cannot read property 'lat' of undefined）
  // 选点位置已通过 latitude/longitude 中心点展示

  return (
    <View className='location-search-page'>
      <View className='map-wrap'>
        <Map
          className='map'
          latitude={centerLat}
          longitude={centerLng}
          scale={15}
          markers={[]}
          onTap={handleMapTap}
          onError={() => {}}
        />
        {/* 中心指示点：选点始终以地图中心为准 */}
        <View className='map-center-pin'>
          <View className='map-center-pin-inner' />
        </View>
        {locating && (
          <View className='map-mask'>
            <Text>定位中...</Text>
          </View>
        )}
      </View>

      <View className='panel'>
        <View className='search-row'>
          <Input
            className='search-input'
            placeholder='输入商家名/地名搜索'
            value={keyword}
            onInput={(e) => setKeyword(e.detail.value)}
            onConfirm={doSearch}
            confirmType='search'
          />
          <View className='search-btn' onClick={doSearch}>
            {searching ? '搜索中' : '搜索'}
          </View>
        </View>
        <View className={`selected-address-card ${hasSelection ? 'selected-address-card--filled' : ''}`}>
          <Text className='selected-address-label'>当前选中</Text>
          <Text className='selected-address-text'>
            {selectedAddress || selectedName
              ? [typeof selectedName === 'string' && selectedName !== '地图选点' ? selectedName : '', typeof selectedAddress === 'string' ? selectedAddress : ''].filter(Boolean).join(' ').trim() || '已选位置'
              : '点击地图选点，或从搜索结果选择'}
          </Text>
        </View>

        {results.length > 0 && (
          <View className='result-section'>
            <Text className='result-section-title'>搜索结果（共 {results.length} 个，点击选择）</Text>
            <ScrollView className='result-list' scrollY enhanced showScrollbar={false}>
              {results.map((poi, idx) => (
                <View
                  key={idx}
                  className='result-item'
                  onClick={() => handleSelectResult(poi)}
                >
                  <View className='result-item-main'>
                    <Text className='result-item-index'>{idx + 1}</Text>
                    <View className='result-item-content'>
                      <Text className='result-name'>{poi.name || '未命名位置'}</Text>
                      {poi.address ? (
                        <Text className='result-address' numberOfLines={3}>{poi.address}</Text>
                      ) : null}
                    </View>
                  </View>
                  <Text className='result-item-action'>选这里</Text>
                </View>
              ))}
            </ScrollView>
            {results.length >= 4 && (
              <View className='result-list-more'>
                <Text className='result-list-more-text'>下滑查看更多</Text>
              </View>
            )}
          </View>
        )}

        <View
          className={`btn-use ${hasSelection ? '' : 'disabled'}`}
          onClick={hasSelection ? handleConfirm : undefined}
        >
          使用该位置
        </View>
      </View>
    </View>
  )
}

export default withAuth(LocationSearchPage)
