import { View, Text, ScrollView, Image, Input, Textarea } from '@tarojs/components'
import { useState, useEffect } from 'react'
import Taro from '@tarojs/taro'
import { Popup, AreaPicker } from '@taroify/core'
import '@taroify/core/popup/style'
import '@taroify/core/picker/style'
import { areaList } from '@vant/area-data'
import {
  getFoodRecordList,
  createPublicFoodLibraryItem,
  uploadAnalyzeImage,
  analyzeFoodImage,
  imageToBase64,
  type FoodRecord,
  type Nutrients
} from '../../utils/api'
import './index.scss'

const QUICK_TAGS = ['少油', '少盐', '高蛋白', '低碳水', '清淡', '外卖', '自制', '健身餐']

// 城市区域数据（示例）


// 后端 API 基础地址（编译时替换）
const API_BASE_URL = process.env.TARO_APP_API_BASE_URL || 'https://healthymax.cn'

export default function FoodLibrarySharePage() {
  // 选择来源：record（从记录分享）或 upload（直接上传）
  const [sourceType, setSourceType] = useState<'record' | 'upload'>('upload')
  const [showRecordModal, setShowRecordModal] = useState(false)
  const [records, setRecords] = useState<FoodRecord[]>([])
  const [selectedRecord, setSelectedRecord] = useState<FoodRecord | null>(null)

  // 图片：最多 3 张，每张单独 AI 识别后叠加营养数据
  const [imagePaths, setImagePaths] = useState<string[]>([])
  const [imageUrls, setImageUrls] = useState<string[]>([])
  const [imageUrl, setImageUrl] = useState('') // 首图 URL，用于识别与提交
  const [totalCalories, setTotalCalories] = useState(0)
  const [totalProtein, setTotalProtein] = useState(0)
  const [totalCarbs, setTotalCarbs] = useState(0)
  const [totalFat, setTotalFat] = useState(0)
  const [items, setItems] = useState<Array<{ name: string; weight?: number; nutrients?: Nutrients }>>([])
  const [description, setDescription] = useState('')
  const [insight, setInsight] = useState('')
  // 缓存每张图片的识别结果，避免重复识别
  const [analyzeResultsMap, setAnalyzeResultsMap] = useState<Record<string, Awaited<ReturnType<typeof analyzeFoodImage>>>>({})

  // 商家信息
  const [foodName, setFoodName] = useState('')
  const [merchantName, setMerchantName] = useState('')
  const [tasteRating, setTasteRating] = useState(0)

  // 标签
  const [suitableForFatLoss, setSuitableForFatLoss] = useState(false)
  const [userTags, setUserTags] = useState<string[]>([])
  const [customTag, setCustomTag] = useState('')

  // 备注
  const [userNotes, setUserNotes] = useState('')

  // 位置
  const [province, setProvince] = useState('')
  const [city, setCity] = useState('')
  const [district, setDistrict] = useState('')
  const [detailAddress, setDetailAddress] = useState('')
  const [latitude, setLatitude] = useState<number | undefined>(undefined)
  const [longitude, setLongitude] = useState<number | undefined>(undefined)

  // 城市选择器
  const [showCityPicker, setShowCityPicker] = useState(false)

  // 位置搜索
  const [showLocationSearch, setShowLocationSearch] = useState(false)
  const [searchKeyword, setSearchKeyword] = useState('')
  const [searchResults, setSearchResults] = useState<Array<{ name: string; address: string; lonlat: string; promptCity: string }>>([])
  const [searching, setSearching] = useState(false)

  // 提交状态
  const [submitting, setSubmitting] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)

  // 加载最近记录
  useEffect(() => {
    loadRecords()
  }, [])

  const loadRecords = async () => {
    try {
      const res = await getFoodRecordList()
      setRecords(res.records || [])
    } catch (e) {
      console.error('加载记录失败:', e)
    }
  }

  // 选择记录：优先使用多图 image_paths，否则用 image_path；后端会根据 source_record_id 从分析任务拉取多图
  const handleSelectRecord = (record: FoodRecord) => {
    setSelectedRecord(record)
    setImagePaths([])
    const urls = (record.image_paths && record.image_paths.length > 0)
      ? record.image_paths.slice(0, MAX_IMAGES)
      : (record.image_path ? [record.image_path] : [])
    setImageUrls(urls)
    setImageUrl(urls[0] || record.image_path || '')
    setTotalCalories(record.total_calories)
    setTotalProtein(record.total_protein)
    setTotalCarbs(record.total_carbs)
    setTotalFat(record.total_fat)
    setItems(record.items || [])
    setDescription(record.description || '')
    setInsight(record.insight || '')
    setAnalyzeResultsMap({}) // 清空识别缓存
    setShowRecordModal(false)
  }

  const MAX_IMAGES = 3

  /** 根据缓存的识别结果聚合计算营养数据 */
  const aggregateFromMap = (urls: string[], resultsMap: Record<string, Awaited<ReturnType<typeof analyzeFoodImage>>>) => {
    if (urls.length === 0) {
      setDescription('')
      setInsight('')
      setItems([])
      setTotalCalories(0)
      setTotalProtein(0)
      setTotalCarbs(0)
      setTotalFat(0)
      return
    }
    const results = urls.map(url => resultsMap[url]).filter(Boolean)
    const descriptions = results.map(r => r.description).filter(Boolean)
    const insights = results.map(r => r.insight).filter(Boolean)
    setDescription(descriptions.join('；'))
    setInsight(insights.join('；'))
    const allItems = results.flatMap(r =>
      (r.items || []).map(it => ({
        name: it.name,
        weight: it.estimatedWeightGrams,
        nutrients: it.nutrients
      }))
    )
    setItems(allItems)
    let cal = 0
    let pro = 0
    let carb = 0
    let fat = 0
    results.forEach(r => {
      (r.items || []).forEach(it => {
        cal += it.nutrients?.calories || 0
        pro += it.nutrients?.protein || 0
        carb += it.nutrients?.carbs || 0
        fat += it.nutrients?.fat || 0
      })
    })
    setTotalCalories(cal)
    setTotalProtein(pro)
    setTotalCarbs(carb)
    setTotalFat(fat)
  }

  // 选择图片：最多 3 张，逐张上传后只识别新图片并叠加已有结果
  const handleChooseImage = async () => {
    const remain = MAX_IMAGES - imagePaths.length
    if (remain <= 0) return
    try {
      const res = await Taro.chooseImage({
        count: remain,
        sizeType: ['compressed'],
        sourceType: ['album', 'camera']
      })
      const tempPaths = res.tempFilePaths || []
      if (tempPaths.length === 0) return
      setSelectedRecord(null)
      const prevPaths = imagePaths
      const prevUrls = imageUrls
      const prevResultsMap = analyzeResultsMap
      setImagePaths(p => [...p, ...tempPaths])

      setAnalyzing(true)
      Taro.showLoading({ title: '上传中...', mask: true })
      try {
        const newUrls: string[] = []
        for (let i = 0; i < tempPaths.length; i++) {
          const base64 = await imageToBase64(tempPaths[i])
          const uploadRes = await uploadAnalyzeImage(base64)
          newUrls.push(uploadRes.imageUrl)
        }
        const allUrls = [...prevUrls, ...newUrls]
        setImageUrls(allUrls)
        setImageUrl(allUrls[0] || '')
        Taro.hideLoading()

        // 只识别新上传的图片
        const newResultsMap = { ...prevResultsMap }
        for (let i = 0; i < newUrls.length; i++) {
          Taro.showLoading({ title: `识别中 (${i + 1}/${newUrls.length})...`, mask: true })
          const analyzeRes = await analyzeFoodImage({ image_url: newUrls[i] })
          newResultsMap[newUrls[i]] = analyzeRes
        }
        setAnalyzeResultsMap(newResultsMap)
        aggregateFromMap(allUrls, newResultsMap)
        Taro.showToast({
          title: newUrls.length > 1 ? `已识别 ${newUrls.length} 张并叠加` : '识别成功',
          icon: 'success'
        })
      } catch (e: any) {
        setImagePaths(prevPaths)
        setImageUrls(prevUrls)
        setImageUrl(prevUrls[0] || '')
        setAnalyzeResultsMap(prevResultsMap)
        Taro.showToast({ title: e.message || '上传或识别失败', icon: 'none' })
      } finally {
        Taro.hideLoading()
        setAnalyzing(false)
      }
    } catch (e) {
      console.error('选择图片失败', e)
    }
  }

  /** 全屏预览已上传的图片 */
  const handlePreviewImage = (index: number) => {
    const len = Math.max(imagePaths.length, imageUrls.length)
    const urls = Array.from({ length: len })
      .map((_, i) => imageUrls[i] || imagePaths[i])
      .filter(Boolean) as string[]
    const current = urls[index]
    if (urls.length > 0 && current) {
      Taro.previewImage({ urls, current })
    }
  }

  const handleRemoveImage = (index: number) => {
    const removedUrl = imageUrls[index]
    const nextPaths = imagePaths.filter((_, i) => i !== index)
    const nextUrls = imageUrls.filter((_, i) => i !== index)
    setImagePaths(nextPaths)
    setImageUrls(nextUrls)
    setImageUrl(nextUrls[0] || '')
    setSelectedRecord(null)
    // 从缓存中移除对应结果
    const newResultsMap = { ...analyzeResultsMap }
    delete newResultsMap[removedUrl]
    setAnalyzeResultsMap(newResultsMap)
    aggregateFromMap(nextUrls, newResultsMap)
  }

  // 天地图地名搜索（通过后端代理）
  const handleLocationSearch = async () => {
    const kw = searchKeyword.trim()
    if (!kw) {
      Taro.showToast({ title: '请输入搜索关键字', icon: 'none' })
      return
    }
    setSearching(true)
    try {
      const res = await Taro.request({
        url: `${API_BASE_URL}/api/location/search`,
        method: 'POST',
        header: { 'Content-Type': 'application/json' },
        data: { keyWord: kw, count: 10 }
      })
      const data = res.data as any
      if (data?.pois && Array.isArray(data.pois)) {
        // 从 prompt.admins 提取搜索结果对应城市
        const promptCity = data.prompt?.[0]?.admins?.[0]?.adminName || ''
        setSearchResults(data.pois.map((poi: any) => ({
          name: poi.name || '',
          address: poi.address || '',
          lonlat: poi.lonlat || '',
          promptCity
        })))
      } else {
        setSearchResults([])
        Taro.showToast({ title: '未找到相关位置', icon: 'none' })
      }
    } catch (e: any) {
      console.error('位置搜索失败:', e)
      Taro.showToast({ title: '搜索失败', icon: 'none' })
    } finally {
      setSearching(false)
    }
  }

  // 选择搜索结果中的位置
  const handleSelectLocation = (poi: { name: string; address: string; lonlat: string; promptCity: string }) => {
    const addr = poi.address || ''
    // 尝试从地址解析省、市、区
    const provinceMatch = addr.match(/^(.+?[省市])/)
    const cityMatch = addr.match(/^.+?[省](.+?市)/)
    const districtMatch = addr.match(/[市省](.+?[区县市])/)

    // 设置省份
    setProvince(provinceMatch ? provinceMatch[1] : poi.promptCity)

    // 设置城市（如果是直辖市则不设置城市）
    const prov = provinceMatch ? provinceMatch[1] : ''
    if (prov.includes('北京') || prov.includes('上海') || prov.includes('天津') || prov.includes('重庆')) {
      setCity('')
    } else {
      setCity(cityMatch ? cityMatch[1] : '')
    }

    // 解析区域
    if (districtMatch) {
      setDistrict(districtMatch[1])
    } else {
      // 地址没有城市前缀时，尝试从开头匹配区域（如 "长宁区xxx"）
      const districtOnly = addr.match(/^(.+?[区县市])/)
      setDistrict(districtOnly ? districtOnly[1] : '')
    }

    // 详细地址 = address + name
    setDetailAddress(addr + (poi.name ? ' ' + poi.name : ''))
    // 解析经纬度
    if (poi.lonlat) {
      const parts = poi.lonlat.split(',')
      if (parts.length === 2) {
        setLongitude(parseFloat(parts[0]))
        setLatitude(parseFloat(parts[1]))
      }
    }
    setShowLocationSearch(false)
    setSearchKeyword('')
    setSearchResults([])
  }

  // 添加标签
  const handleAddTag = () => {
    const tag = customTag.trim()
    if (!tag) return
    if (userTags.includes(tag)) {
      Taro.showToast({ title: '标签已存在', icon: 'none' })
      return
    }
    setUserTags([...userTags, tag])
    setCustomTag('')
  }

  // 切换快捷标签
  const toggleQuickTag = (tag: string) => {
    if (userTags.includes(tag)) {
      setUserTags(userTags.filter(t => t !== tag))
    } else {
      setUserTags([...userTags, tag])
    }
  }

  // 移除标签
  const removeTag = (tag: string) => {
    setUserTags(userTags.filter(t => t !== tag))
  }

  /** 点击提交：校验后弹窗确认，用户确认后再提交 */
  const handleSubmit = async () => {
    const hasImages = imageUrls.length > 0 || imageUrl || selectedRecord?.image_path
    if (!hasImages) {
      Taro.showToast({ title: '请先选择或上传图片', icon: 'none' })
      return
    }
    if (!foodName.trim()) {
      Taro.showToast({ title: '请填写食物名称', icon: 'none' })
      return
    }

    const { confirm } = await Taro.showModal({
      title: '确认提交',
      content: '确定要将该食物分享到公共食物库吗？提交后其他用户可查看。',
      confirmText: '确定提交',
      cancelText: '取消'
    })
    if (!confirm) return

    await doSubmit()
  }

  /** 实际执行提交到公共库 */
  const doSubmit = async () => {
    setSubmitting(true)
    try {
      // 构建完整的商家地址
      const fullAddress = [
        province,
        city,
        district,
        detailAddress
      ].filter(Boolean).join(' ').trim()

      await createPublicFoodLibraryItem({
        image_path: imageUrl || selectedRecord?.image_path || undefined,
        image_paths: imageUrls.length > 0 ? imageUrls : undefined,
        source_record_id: selectedRecord?.id,
        total_calories: totalCalories,
        total_protein: totalProtein,
        total_carbs: totalCarbs,
        total_fat: totalFat,
        items,
        description,
        insight,
        food_name: foodName.trim(),
        merchant_name: merchantName.trim() || undefined,
        merchant_address: fullAddress || undefined,
        taste_rating: tasteRating > 0 ? tasteRating : undefined,
        suitable_for_fat_loss: suitableForFatLoss,
        user_tags: userTags,
        user_notes: userNotes.trim() || undefined,
        latitude,
        longitude,
        province: province.trim() || undefined,
        city: city.trim() || undefined,
        district: district.trim() || undefined,
        detail_address: detailAddress.trim() || undefined
      })
      Taro.showToast({ title: '分享成功', icon: 'success' })
      Taro.setStorageSync('food_library_need_refresh', '1')
      setTimeout(() => {
        Taro.navigateBack()
      }, 1500)
    } catch (e: any) {
      Taro.showToast({ title: e.message || '分享失败', icon: 'none' })
    } finally {
      setSubmitting(false)
    }
  }

  const hasImages = imageUrls.length > 0 || imageUrl || selectedRecord?.image_path
  const canSubmit = hasImages && foodName.trim() && !submitting && !analyzing
  const displayLength = Math.max(imagePaths.length, imageUrls.length)

  return (
    <View className="share-page">
      {/* 选择来源 */}
      <View className="source-section">
        <Text className="section-title">选择来源</Text>
        <View className="source-options">
          <View
            className={`source-option ${sourceType === 'upload' ? 'active' : ''}`}
            onClick={() => setSourceType('upload')}
          >
            <Text className="source-icon iconfont icon-paizhao-xianxing" />
            <Text className="source-text">拍照上传</Text>
          </View>
          <View
            className={`source-option ${sourceType === 'record' ? 'active' : ''}`}
            onClick={() => { setSourceType('record'); setShowRecordModal(true) }}
          >
            <Text className="source-icon iconfont icon-ic_detail" />
            <Text className="source-text">从记录选择</Text>
          </View>
        </View>
      </View>

      {/* 图片区域：最多 3 张，每张识别后叠加计算 */}
      <View className="image-section">
        <Text className="section-title">
          食物图片 <Text className="required">*</Text>
          {displayLength > 0 && <Text className="image-count">（{displayLength}/3）</Text>}
        </Text>
        {displayLength > 0 ? (
          <View className="share-image-grid">
            {Array.from({ length: displayLength }).map((_, index) => (
              <View key={index} className="share-grid-item">
                <Image
                  src={imageUrls[index] || imagePaths[index]}
                  mode="aspectFill"
                  className="share-grid-image"
                  onClick={() => handlePreviewImage(index)}
                />
                <View
                  className="share-remove-btn"
                  onClick={(e) => { e.stopPropagation(); handleRemoveImage(index) }}
                >
                  <Text className="share-close-icon">×</Text>
                </View>
              </View>
            ))}
            {displayLength < MAX_IMAGES && (
              <View className="share-grid-item share-add-btn" onClick={handleChooseImage}>
                <Text className="share-add-icon">+</Text>
                <Text className="share-add-text">添加</Text>
              </View>
            )}
          </View>
        ) : (
          <View className="image-upload-area" onClick={handleChooseImage}>
            <Text className="upload-icon iconfont icon-paizhao-xianxing" />
            <Text className="upload-text">点击上传食物图片（最多 3 张，每张识别后叠加计算）</Text>
          </View>
        )}
      </View>

      {/* 营养信息 */}
      <View className="nutrition-section">
        <Text className="section-title">营养信息</Text>
        <View className="nutrition-summary">
          <View className="nutrition-item">
            <Text className="nutrition-value">{totalCalories.toFixed(0)}</Text>
            <Text className="nutrition-label">热量 kcal</Text>
          </View>
          <View className="nutrition-item">
            <Text className="nutrition-value">{totalProtein.toFixed(1)}</Text>
            <Text className="nutrition-label">蛋白质 g</Text>
          </View>
          <View className="nutrition-item">
            <Text className="nutrition-value">{totalCarbs.toFixed(1)}</Text>
            <Text className="nutrition-label">碳水 g</Text>
          </View>
          <View className="nutrition-item">
            <Text className="nutrition-value">{totalFat.toFixed(1)}</Text>
            <Text className="nutrition-label">脂肪 g</Text>
          </View>
        </View>
        <Text className="nutrition-tip">营养数据由 AI 自动识别</Text>
      </View>

      {/* 商家信息 */}
      <View className="merchant-section">
        <Text className="section-title">商家信息</Text>
        <View className="form-item">
          <Text className="form-label">
            食物名称 <Text className="required">*</Text>
          </Text>
          <Input
            className="form-input"
            placeholder="如：麻辣香锅、烤鸡腿饭等"
            value={foodName}
            onInput={e => setFoodName(e.detail.value)}
          />
        </View>
        <View className="form-item">
          <Text className="form-label">商家名称（可选）</Text>
          <Input
            className="form-input"
            placeholder="如：沙县小吃、肯德基等"
            value={merchantName}
            onInput={e => setMerchantName(e.detail.value)}
          />
        </View>
        <View className="form-item">
          <Text className="form-label">口味评分（可选）</Text>
          <View className="rating-row">
            <View className="rating-stars">
              {[1, 2, 3, 4, 5].map(n => (
                <Text
                  key={n}
                  className={`rating-star ${n <= tasteRating ? 'active' : ''}`}
                  onClick={() => setTasteRating(n === tasteRating ? 0 : n)}
                >
                  ★
                </Text>
              ))}
            </View>
          </View>
        </View>
      </View>

      {/* 标签 */}
      <View className="tags-section">
        <Text className="section-title">标签</Text>
        <View className="switch-row">
          <Text className="switch-label">适合减脂</Text>
          <View
            className={`switch-btn ${suitableForFatLoss ? 'active' : ''}`}
            onClick={() => setSuitableForFatLoss(!suitableForFatLoss)}
          >
            <View className="switch-dot" />
          </View>
        </View>
        <View className="quick-tags">
          {QUICK_TAGS.map(tag => (
            <View
              key={tag}
              className={`quick-tag ${userTags.includes(tag) ? 'selected' : ''}`}
              onClick={() => toggleQuickTag(tag)}
            >
              {tag}
            </View>
          ))}
        </View>
        <View className="custom-tag-row">
          <Input
            className="tag-input"
            placeholder="自定义标签"
            value={customTag}
            onInput={e => setCustomTag(e.detail.value)}
            onConfirm={handleAddTag}
          />
          <View className="add-tag-btn" onClick={handleAddTag}>添加</View>
        </View>
        {userTags.length > 0 && (
          <View className="selected-tags">
            {userTags.map(tag => (
              <View key={tag} className="selected-tag">
                <Text>{tag}</Text>
                <Text className="remove-tag" onClick={() => removeTag(tag)}>×</Text>
              </View>
            ))}
          </View>
        )}
      </View>

      {/* 商家地址 */}
      <View className="location-section">
        <View className="location-title-row">
          <Text className="section-title">商家地址（可选）</Text>
          <View className="search-location-btn" onClick={() => setShowLocationSearch(true)}>
            <Text className="iconfont icon-dizhi" />
            <Text>搜索地址</Text>
          </View>
        </View>
        <View className="form-item" onClick={() => setShowCityPicker(true)}>
          <Text className="form-label">城市/区域</Text>
          <View className="form-input city-display">
            <Text className={province ? 'city-value' : 'city-placeholder'}>
              {province
                ? `${province}${city ? ' ' + city : ''} ${district}`.trim()
                : '点击选择城市/区域'}
            </Text>
          </View>
        </View>
        <View className="form-item">
          <Text className="form-label">详细地址</Text>
          <Input
            className="form-input"
            placeholder="如：XX路XX号"
            value={detailAddress}
            onInput={e => setDetailAddress(e.detail.value)}
          />
        </View>
      </View>

      {/* 备注 */}
      <View className="merchant-section">
        <Text className="section-title">补充说明（可选）</Text>
        <Textarea
          className="form-textarea"
          placeholder="分享你对这份餐食的评价或建议..."
          value={userNotes}
          onInput={e => setUserNotes(e.detail.value)}
          maxlength={500}
        />
      </View>

      {/* 提交栏 */}
      <View className="submit-bar">
        <View
          className={`submit-btn ${canSubmit ? '' : 'disabled'}`}
          onClick={canSubmit ? handleSubmit : undefined}
        >
          {submitting ? '提交中...' : analyzing ? '识别中...' : '分享到公共库'}
        </View>
      </View>

      {/* 城市选择弹窗 */}
      <Popup open={showCityPicker} placement="bottom" onClose={() => setShowCityPicker(false)}>
        <AreaPicker
          title="选择城市/区域"
          areaList={areaList}
          onConfirm={(values: any[]) => {
            // values 是 code 数组，如 ["110000", "110100", "110101"]
            // 需要从 areaList 中查找对应的名称
            const provinceCode = values[0] || ''
            const cityCode = values[1] || ''
            const districtCode = values[2] || ''

            const p = areaList.province_list?.[provinceCode] || ''
            const c = areaList.city_list?.[cityCode] || ''
            const d = areaList.county_list?.[districtCode] || ''

            // 直辖市处理：省名=市名=直辖市名，区名在第三级
            if (p.includes('北京') || p.includes('上海') || p.includes('天津') || p.includes('重庆')) {
              setProvince(p)
              setCity('')
              setDistrict(d || c)
            } else {
              setProvince(p)
              setCity(c)
              setDistrict(d)
            }
            setShowCityPicker(false)
          }}
          onCancel={() => setShowCityPicker(false)}
        />
      </Popup>

      {/* 从记录选择弹窗 */}
      {showRecordModal && (
        <View className="record-modal" onClick={() => setShowRecordModal(false)}>
          <View className="record-modal-content" onClick={e => e.stopPropagation()}>
            <View className="modal-header">
              <Text className="modal-title">选择饮食记录</Text>
              <Text className="modal-close" onClick={() => setShowRecordModal(false)}>✕</Text>
            </View>
            {records.length === 0 ? (
              <View className="record-empty">暂无记录</View>
            ) : (
              <ScrollView className="record-list" scrollY enhanced showScrollbar={false}>
                {records.map(r => (
                  <View key={r.id} className="record-item" onClick={() => handleSelectRecord(r)}>
                    {r.image_path ? (
                      <Image className="record-image" src={r.image_path} mode="aspectFill" />
                    ) : (
                      <View className="record-image-placeholder"><Text className="iconfont icon-shiwu" /></View>
                    )}
                    <View className="record-info">
                      <Text className="record-desc">{r.description || '饮食记录'}</Text>
                      <Text className="record-meta">{r.total_calories.toFixed(0)} kcal · {r.record_time?.slice(0, 10)}</Text>
                    </View>
                  </View>
                ))}
              </ScrollView>
            )}
          </View>
        </View>
      )}

      {/* 位置搜索弹窗 */}
      {showLocationSearch && (
        <View className="location-search-modal" onClick={() => setShowLocationSearch(false)}>
          <View className="location-search-content" onClick={e => e.stopPropagation()}>
            <View className="modal-header">
              <Text className="modal-title">搜索位置</Text>
              <Text className="modal-close" onClick={() => setShowLocationSearch(false)}>✕</Text>
            </View>
            <View className="search-input-row">
              <Input
                className="search-input"
                placeholder="输入地名、商家名等关键字"
                value={searchKeyword}
                onInput={e => setSearchKeyword(e.detail.value)}
                onConfirm={handleLocationSearch}
              />
              <View className="search-do-btn" onClick={handleLocationSearch}>
                {searching ? '搜索中...' : '搜索'}
              </View>
            </View>
            {searchResults.length > 0 ? (
              <ScrollView className="search-result-list" scrollY enhanced showScrollbar={false}>
                {searchResults.map((poi, idx) => (
                  <View key={idx} className="search-result-item" onClick={() => handleSelectLocation(poi)}>
                    <Text className="result-name">{poi.name}</Text>
                    <Text className="result-address">{poi.address}</Text>
                  </View>
                ))}
              </ScrollView>
            ) : (
              <View className="search-empty">
                {searching ? '正在搜索...' : '输入关键字搜索位置'}
              </View>
            )}
          </View>
        </View>
      )}
    </View>
  )
}
