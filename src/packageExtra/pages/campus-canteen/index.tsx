import { View, Text, ScrollView, Image, Input, Button } from '@tarojs/components'
import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import Taro, { useDidShow } from '@tarojs/taro'
import { withAuth } from '../../../utils/withAuth'
import {
  getAccessToken,
  getPublicFoodLibraryList,
  showUnifiedApiError,
  type PublicFoodLibraryItem,
  type SchoolItem
} from '../../../utils/api'
import { UserOutlined, LocationOutlined } from '@taroify/icons'
import '@taroify/icons/style'
import './index.scss'
import { extraPkgUrl } from '../../../utils/subpackage-extra'
import { useAppColorScheme } from '../../../components/AppColorSchemeContext'
import { applyThemeNavigationBar } from '../../../utils/theme-navigation-bar'
import { FlPageThemeRoot } from '../../../components/FlPageThemeRoot'
import SchoolPicker from '../../../components/SchoolPicker'

type SortBy = 'hot' | 'high_protein' | 'low_calorie' | 'value'

function normalizeText(value?: string | null): string {
  return String(value || '').trim().toLowerCase()
}

function getLocationText(item: PublicFoodLibraryItem): string {
  if (item.campus_location_text) return item.campus_location_text
  return [item.school_name, item.campus_name, item.canteen_name, item.floor, item.window_name]
    .filter(Boolean)
    .join(' · ')
}

function getPriceText(item: PublicFoodLibraryItem): string {
  const type = item.price_type || 'fixed'
  if (type === 'unknown') return '价格待补充'
  if (type === 'range' && item.price_min != null && item.price_max != null) {
    return `${item.price_min}-${item.price_max}元`
  }
  if (item.price == null || item.price <= 0) return '价格待补充'
  const unit = item.price_unit || (type === 'weight' ? '元/kg' : type === 'combo' ? '元/套餐' : '元/份')
  return `${item.price}${unit.replace(/^\d+/, '')}`
}

function getCampusTags(item: PublicFoodLibraryItem): string[] {
  if (isAnalyzingItem(item)) return ['正在分析中']
  if (isAnalysisFailedItem(item)) return ['分析失败']
  const tags: string[] = []
  if (item.total_protein >= 25) tags.push('高蛋白')
  if (item.total_calories > 0 && item.total_calories <= 450) tags.push('低热量')
  if (item.suitable_for_fat_loss) tags.push('减脂友好')
  if (!item.price || item.price <= 0) tags.push('价格待补充')
  return tags.slice(0, 3)
}

function isAnalyzingItem(item: PublicFoodLibraryItem): boolean {
  const status = normalizeText(item.analysis_status)
  return status === 'pending' || status === 'processing'
}

function isAnalysisFailedItem(item: PublicFoodLibraryItem): boolean {
  const status = normalizeText(item.analysis_status)
  return status === 'failed' || status === 'timed_out'
}

function hasNutrition(item: PublicFoodLibraryItem): boolean {
  return !isAnalyzingItem(item) && !isAnalysisFailedItem(item) && ((item.total_calories || 0) > 0 || (item.total_protein || 0) > 0)
}

function CampusCanteenPage() {
  const { scheme } = useAppColorScheme()
  const [loggedIn, setLoggedIn] = useState(!!getAccessToken())
  const [loading, setLoading] = useState(false)
  const [list, setList] = useState<PublicFoodLibraryItem[]>([])
  const [sortBy, setSortBy] = useState<SortBy>('hot')
  const [searchKeyword, setSearchKeyword] = useState('')
  const [selectedSchool, setSelectedSchool] = useState<SchoolItem | null>(null)
  const [canteenName, setCanteenName] = useState('')
  const [floorName, setFloorName] = useState('')
  const [windowName, setWindowName] = useState('')
  const [showSchoolPicker, setShowSchoolPicker] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const lastRefreshTime = useRef<number>(0)

  const loadList = useCallback(async (silent = false, force = false) => {
    if (!getAccessToken()) return
    const now = Date.now()
    if (!force && now - lastRefreshTime.current < 30000) return
    if (!silent) setLoading(true)
    try {
      const res = await getPublicFoodLibraryList({
        type: 'campus',
        school_name: selectedSchool?.name,
        canteen_name: canteenName || undefined,
        sort_by: sortBy,
        limit: 80
      })
      const newList = res.list || []
      setList(newList)
      lastRefreshTime.current = Date.now()
    } catch (e: any) {
      console.error('加载校园食堂失败:', e)
      if (!silent) {
        await showUnifiedApiError(e, '获取列表失败')
      }
    } finally {
      if (!silent) setLoading(false)
      setRefreshing(false)
    }
  }, [sortBy, selectedSchool, canteenName])

  useDidShow(() => {
    applyThemeNavigationBar(scheme)
    setLoggedIn(!!getAccessToken())
    if (!getAccessToken()) return
    loadList(false, true)
  })

  useEffect(() => {
    applyThemeNavigationBar(scheme)
  }, [scheme])

  useEffect(() => {
    if (loggedIn) {
      loadList(false, true)
    }
  }, [loggedIn, sortBy, selectedSchool, canteenName])

  const handleRefresherRefresh = useCallback(() => {
    if (!getAccessToken()) {
      setRefreshing(false)
      return
    }
    setRefreshing(true)
    loadList(false, true)
  }, [loadList])

  const handleSearch = () => {
    // 校园食堂列表中搜索：复用 merchant_name 参数做食物名搜索
    const kw = searchKeyword.trim()
    if (!kw) {
      loadList(false, true)
      return
    }
    setLoading(true)
    getPublicFoodLibraryList({
      type: 'campus',
      school_name: selectedSchool?.name,
      merchant_name: kw,
      sort_by: sortBy,
      limit: 80
    }).then(res => {
      setList(res.list || [])
    }).catch(async (e: any) => {
      await showUnifiedApiError(e, '搜索失败')
    }).finally(() => {
      setLoading(false)
    })
  }

  const goDetail = (itemId: string) => {
    Taro.navigateTo({ url: `${extraPkgUrl('/pages/food-library-detail/index')}?id=${itemId}&scene=campus` })
  }

  const goUpload = () => {
    Taro.navigateTo({ url: extraPkgUrl('/pages/campus-food-share/index') })
  }

  const quickRecord = (e: any, item: PublicFoodLibraryItem) => {
    e.stopPropagation()
    if (isAnalyzingItem(item)) {
      Taro.showToast({ title: '营养信息分析中', icon: 'none' })
      return
    }
    if (isAnalysisFailedItem(item)) {
      Taro.showToast({ title: '分析失败，暂不能记录', icon: 'none' })
      return
    }
    Taro.setStorageSync('campus_quick_record_item', JSON.stringify(item))
    Taro.navigateTo({ url: `${extraPkgUrl('/pages/record-manual/index')}?campus_quick=1` })
  }

  const selectedSchoolName = selectedSchool?.name || '选择大学'
  const visibleList = useMemo(() => {
    const floorKeyword = normalizeText(floorName)
    const windowKeyword = normalizeText(windowName)
    return list.filter(item => {
      if (floorKeyword && !normalizeText(item.floor).includes(floorKeyword) && !normalizeText(getLocationText(item)).includes(floorKeyword)) {
        return false
      }
      if (windowKeyword && !normalizeText(item.window_name).includes(windowKeyword) && !normalizeText(getLocationText(item)).includes(windowKeyword)) {
        return false
      }
      return true
    })
  }, [floorName, list, windowName])

  const analyzedList = useMemo(() => visibleList.filter(hasNutrition), [visibleList])
  const hotItems = useMemo(() => analyzedList.slice(0, 6), [analyzedList])
  const highProteinItems = useMemo(
    () => [...analyzedList].sort((a, b) => (b.total_protein || 0) - (a.total_protein || 0)).slice(0, 6),
    [analyzedList]
  )
  const lowCalorieItems = useMemo(
    () => [...analyzedList].filter(item => item.total_calories > 0).sort((a, b) => a.total_calories - b.total_calories).slice(0, 6),
    [analyzedList]
  )
  const valueItems = useMemo(
    () => [...analyzedList]
      .filter(item => item.price && item.price > 0 && item.total_protein > 0)
      .sort((a, b) => ((b.total_protein || 0) / (b.price || 1)) - ((a.total_protein || 0) / (a.price || 1)))
      .slice(0, 6),
    [analyzedList]
  )

  const renderMiniCard = (item: PublicFoodLibraryItem) => (
    <View key={item.id} className='recommend-card' onClick={() => goDetail(item.id)}>
      {item.image_path ? (
        <Image className='recommend-card-image' src={item.image_path} mode='aspectFill' />
      ) : (
        <View className='recommend-card-image placeholder'>暂无图片</View>
      )}
      <Text className='recommend-card-title'>{item.food_name || '未命名菜品'}</Text>
      <Text className='recommend-card-meta'>{getPriceText(item)} · 蛋白 {item.total_protein.toFixed(0)}g</Text>
    </View>
  )

  const renderCampusCard = (item: PublicFoodLibraryItem) => {
    const analyzing = isAnalyzingItem(item)
    const failed = isAnalysisFailedItem(item)
    return (
    <View key={item.id} className={`campus-card ${analyzing ? 'campus-card--analyzing' : ''} ${failed ? 'campus-card--failed' : ''}`} onClick={() => goDetail(item.id)}>
      <View className='campus-card-main'>
        <View className='campus-image-wrap'>
          {item.image_path ? (
            <Image className='campus-image' src={item.image_path} mode='aspectFill' />
          ) : (
            <View className='campus-image-placeholder'>暂无图片</View>
          )}
        </View>
        <View className='campus-info'>
          <Text className='campus-title'>{item.food_name || '未命名菜品'}</Text>
          <View className='campus-location-row'>
            <LocationOutlined size='18' className='campus-location-icon' />
            <Text className='campus-location'>{getLocationText(item) || selectedSchoolName}</Text>
          </View>
          <View className='campus-nutrition-row'>
            <Text className='campus-price'>{getPriceText(item)}</Text>
            {analyzing ? (
              <Text className='campus-analysis-text'>正在分析中</Text>
            ) : failed ? (
              <Text className='campus-analysis-failed'>分析失败，稍后重试</Text>
            ) : (
              <View className='campus-calorie-badge'>
                <Text className='campus-calorie-num'>{item.total_calories.toFixed(0)}</Text>
                <Text className='campus-calorie-unit'>kcal</Text>
              </View>
            )}
          </View>
          <View className='campus-tags'>
            {getCampusTags(item).map(tag => (
              <Text key={tag} className={`campus-tag ${tag === '减脂友好' ? 'fat-loss' : ''}`}>{tag}</Text>
            ))}
          </View>
        </View>
      </View>
      <View className='campus-card-footer'>
        <View className='campus-author-row'>
          {item.author?.avatar ? (
            <View className='campus-author-avatar'>
              <Image className='campus-author-avatar-img' src={item.author.avatar} mode='aspectFill' />
            </View>
          ) : (
            <View className='campus-author-avatar'>
              <UserOutlined size='14' color='#9ca3af' />
            </View>
          )}
          <Text className='campus-author-name'>{item.author?.nickname || '用户'}</Text>
        </View>
        <View className='campus-actions'>
          <View className='campus-stat'>
            <Text className={`iconfont ${item.liked ? 'icon-like_fill' : 'icon-like'} campus-like-btn ${item.liked ? 'liked' : ''}`} />
            <Text className='stat-count'>{item.like_count}</Text>
          </View>
          <View className='campus-stat'>
            <View className='campus-comment-btn'>
              <Text className='stat-icon iconfont icon-comment' />
            </View>
            {(item.comment_count || 0) > 0 && (
              <Text className='stat-count'>{item.comment_count}</Text>
            )}
          </View>
          <View className='campus-record-btn' onClick={(e) => quickRecord(e, item)}>
            <Text className='campus-record-btn-text'>{analyzing ? '分析中' : '一键记录'}</Text>
          </View>
        </View>
      </View>
    </View>
    )
  }

  if (!loggedIn) {
    return (
      <FlPageThemeRoot>
      <View className='campus-canteen-page'>
        <View className='login-tip'>
          <Text className='login-tip-text'>登录后查看校园食堂</Text>
          <Button className='login-tip-btn' onClick={() => Taro.switchTab({ url: '/pages/profile/index' })}>去登录</Button>
        </View>
      </View>
      </FlPageThemeRoot>
    )
  }

  return (
    <FlPageThemeRoot>
    <View className='campus-canteen-page'>
      <View className='campus-hero'>
        <Image
          className='campus-hero-bg'
          src='/assets/bg/cafeteria.png'
          mode='aspectFill'
        />
        <View>
          <Text className='campus-hero-eyebrow'>食探校园活动</Text>
          <Text className='campus-hero-title'>食探校园食堂计划</Text>
          <Text className='campus-hero-subtitle'>按你所在省份选择大学，一起补全食堂菜品价格、位置和营养信息</Text>
        </View>
        <View className='campus-hero-upload' onClick={goUpload}>
          <Text className='campus-hero-upload-text'>补充菜品</Text>
        </View>
      </View>

      {/* 头部筛选区 */}
      <View className='campus-header'>
        <View className='filter-row'>
          <View className='filter-chip' onClick={() => setShowSchoolPicker(true)}>
            <Text className='filter-chip-text'>{selectedSchool?.name || '选择大学'}</Text>
            <Text className='iconfont icon-xiajiantou filter-chip-arrow' />
          </View>
          <View className='filter-chip filter-chip-input'>
            <Input
              className='filter-chip-input-inner'
              placeholder='食堂名称'
              value={canteenName}
              onInput={e => setCanteenName(e.detail.value)}
            />
          </View>
          <View className='filter-chip filter-chip-input'>
            <Input
              className='filter-chip-input-inner'
              placeholder='楼层'
              value={floorName}
              onInput={e => setFloorName(e.detail.value)}
            />
          </View>
          <View className='filter-chip filter-chip-input'>
            <Input
              className='filter-chip-input-inner'
              placeholder='窗口'
              value={windowName}
              onInput={e => setWindowName(e.detail.value)}
            />
          </View>
        </View>
        <View className='search-row'>
          <View className='search-input-wrap'>
            <Text className='search-input-icon iconfont icon-sousuo' />
            <Input
              className='search-input'
              placeholder='搜索菜名'
              value={searchKeyword}
              onInput={e => setSearchKeyword(e.detail.value)}
              onConfirm={handleSearch}
            />
          </View>
          <Button className='search-btn' onClick={handleSearch}>搜索</Button>
        </View>
      </View>

      {/* 排序区 */}
      <View className='sort-section'>
        <View className={`sort-item ${sortBy === 'hot' ? 'active' : ''}`} onClick={() => setSortBy('hot')}>热门</View>
        <View className={`sort-item ${sortBy === 'high_protein' ? 'active' : ''}`} onClick={() => setSortBy('high_protein')}>高蛋白</View>
        <View className={`sort-item ${sortBy === 'low_calorie' ? 'active' : ''}`} onClick={() => setSortBy('low_calorie')}>低热量</View>
        <View className={`sort-item ${sortBy === 'value' ? 'active' : ''}`} onClick={() => setSortBy('value')}>性价比</View>
      </View>

      {/* 列表 */}
      <ScrollView
        className='list-scroll'
        scrollY
        enhanced
        showScrollbar={false}
        refresherEnabled
        refresherTriggered={refreshing}
        onRefresherRefresh={handleRefresherRefresh}
        refresherDefaultStyle='black'
      >
        <View className='list-content'>
          {analyzedList.length > 0 && (
            <>
              <View className='section-block'>
                <View className='section-head'>
                  <Text className='section-title'>热门菜品</Text>
                  <Text className='section-subtitle'>按收藏、点赞和发布时间排序</Text>
                </View>
                <ScrollView scrollX enhanced showScrollbar={false} className='recommend-scroll'>
                  <View className='recommend-list'>{hotItems.map(renderMiniCard)}</View>
                </ScrollView>
              </View>
              <View className='section-block'>
                <View className='section-head'>
                  <Text className='section-title'>高蛋白推荐</Text>
                  <Text className='section-subtitle'>适合训练后或想吃扎实一点</Text>
                </View>
                <ScrollView scrollX enhanced showScrollbar={false} className='recommend-scroll'>
                  <View className='recommend-list'>{highProteinItems.map(renderMiniCard)}</View>
                </ScrollView>
              </View>
              <View className='recommend-grid'>
                <View className='recommend-panel'>
                  <Text className='recommend-panel-title'>低热量推荐</Text>
                  {lowCalorieItems.slice(0, 3).map(item => (
                    <Text key={item.id} className='recommend-panel-line' onClick={() => goDetail(item.id)}>
                      {item.food_name} · {item.total_calories.toFixed(0)} kcal
                    </Text>
                  ))}
                </View>
                <View className='recommend-panel'>
                  <Text className='recommend-panel-title'>性价比推荐</Text>
                  {valueItems.slice(0, 3).map(item => (
                    <Text key={item.id} className='recommend-panel-line' onClick={() => goDetail(item.id)}>
                      {item.food_name} · {(item.total_protein / (item.price || 1)).toFixed(1)}g/元
                    </Text>
                  ))}
                </View>
              </View>
            </>
          )}

          <View className='section-head all-list-head'>
            <Text className='section-title'>全部校园菜品</Text>
            <Text className='section-subtitle'>{selectedSchool?.name || '全部大学'}{canteenName ? ` · ${canteenName}` : ''}</Text>
          </View>
          {loading && visibleList.length === 0 ? (
            <View className='loading-state'>
              <View className='loading-spinner-md' />
            </View>
          ) : visibleList.length === 0 ? (
            <View className='empty-state'>
              <Text className='empty-icon iconfont icon-shiwu' />
              <Text className='empty-text'>暂无校园食堂数据</Text>
              <Text className='empty-subtext'>快来上传第一份食堂菜品吧</Text>
              <View className='empty-btn' onClick={goUpload}>去上传</View>
            </View>
          ) : (
            visibleList.map(renderCampusCard)
          )}
        </View>
      </ScrollView>

      {/* 浮动上传按钮 */}
      <View className='fab-button' onClick={goUpload}>
        <Text className='fab-icon'>+</Text>
      </View>

      <SchoolPicker
        visible={showSchoolPicker}
        onSelect={(school) => { setSelectedSchool(school); setShowSchoolPicker(false); setCanteenName(''); setFloorName(''); setWindowName('') }}
        onCancel={() => setShowSchoolPicker(false)}
      />
    </View>
    </FlPageThemeRoot>
  )
}

export default withAuth(CampusCanteenPage)
