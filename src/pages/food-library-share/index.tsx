import { View, Text, ScrollView, Image, Input, Textarea } from '@tarojs/components'
import { useState, useEffect } from 'react'
import Taro from '@tarojs/taro'
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

export default function FoodLibrarySharePage() {
  // 选择来源：record（从记录分享）或 upload（直接上传）
  const [sourceType, setSourceType] = useState<'record' | 'upload'>('upload')
  const [showRecordModal, setShowRecordModal] = useState(false)
  const [records, setRecords] = useState<FoodRecord[]>([])
  const [selectedRecord, setSelectedRecord] = useState<FoodRecord | null>(null)

  // 图片与营养数据
  const [imagePath, setImagePath] = useState('')
  const [imageUrl, setImageUrl] = useState('')
  const [totalCalories, setTotalCalories] = useState(0)
  const [totalProtein, setTotalProtein] = useState(0)
  const [totalCarbs, setTotalCarbs] = useState(0)
  const [totalFat, setTotalFat] = useState(0)
  const [items, setItems] = useState<Array<{ name: string; weight?: number; nutrients?: Nutrients }>>([])
  const [description, setDescription] = useState('')
  const [insight, setInsight] = useState('')

  // 商家信息
  const [merchantName, setMerchantName] = useState('')
  const [merchantAddress, setMerchantAddress] = useState('')
  const [tasteRating, setTasteRating] = useState(0)

  // 标签
  const [suitableForFatLoss, setSuitableForFatLoss] = useState(false)
  const [userTags, setUserTags] = useState<string[]>([])
  const [customTag, setCustomTag] = useState('')

  // 备注
  const [userNotes, setUserNotes] = useState('')

  // 位置
  const [city, setCity] = useState('')
  const [district, setDistrict] = useState('')
  const [latitude, setLatitude] = useState<number | undefined>(undefined)
  const [longitude, setLongitude] = useState<number | undefined>(undefined)

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

  // 选择记录
  const handleSelectRecord = (record: FoodRecord) => {
    setSelectedRecord(record)
    setImagePath('')
    setImageUrl(record.image_path || '')
    setTotalCalories(record.total_calories)
    setTotalProtein(record.total_protein)
    setTotalCarbs(record.total_carbs)
    setTotalFat(record.total_fat)
    setItems(record.items || [])
    setDescription(record.description || '')
    setInsight(record.insight || '')
    setShowRecordModal(false)
  }

  // 选择图片并识别
  const handleChooseImage = async () => {
    try {
      const res = await Taro.chooseImage({
        count: 1,
        sizeType: ['compressed'],
        sourceType: ['album', 'camera']
      })
      const tempPath = res.tempFilePaths[0]
      setImagePath(tempPath)
      setSelectedRecord(null)

      // 上传并识别
      setAnalyzing(true)
      Taro.showLoading({ title: '识别中...' })
      try {
        const base64 = await imageToBase64(tempPath)
        const uploadRes = await uploadAnalyzeImage(base64)
        setImageUrl(uploadRes.imageUrl)

        const analyzeRes = await analyzeFoodImage({ image_url: uploadRes.imageUrl })
        setDescription(analyzeRes.description || '')
        setInsight(analyzeRes.insight || '')
        setItems(analyzeRes.items.map(it => ({
          name: it.name,
          weight: it.estimatedWeightGrams,
          nutrients: it.nutrients
        })))
        const cal = analyzeRes.items.reduce((s, it) => s + (it.nutrients?.calories || 0), 0)
        const pro = analyzeRes.items.reduce((s, it) => s + (it.nutrients?.protein || 0), 0)
        const carb = analyzeRes.items.reduce((s, it) => s + (it.nutrients?.carbs || 0), 0)
        const fat = analyzeRes.items.reduce((s, it) => s + (it.nutrients?.fat || 0), 0)
        setTotalCalories(cal)
        setTotalProtein(pro)
        setTotalCarbs(carb)
        setTotalFat(fat)
        Taro.showToast({ title: '识别成功', icon: 'success' })
      } catch (e: any) {
        Taro.showToast({ title: e.message || '识别失败', icon: 'none' })
      } finally {
        Taro.hideLoading()
        setAnalyzing(false)
      }
    } catch (e) {
      console.error('选择图片失败:', e)
    }
  }

  // 获取位置
  const handleGetLocation = async () => {
    try {
      const setting = await Taro.getSetting()
      if (!setting.authSetting['scope.userLocation']) {
        await Taro.authorize({ scope: 'scope.userLocation' })
      }
      Taro.showLoading({ title: '获取位置...' })
      const loc = await Taro.getLocation({ type: 'gcj02' })
      setLatitude(loc.latitude)
      setLongitude(loc.longitude)
      // 逆地理编码（简化处理，只存经纬度，城市由用户填写）
      Taro.hideLoading()
      Taro.showToast({ title: '位置已获取', icon: 'success' })
    } catch (e: any) {
      Taro.hideLoading()
      Taro.showToast({ title: '获取位置失败', icon: 'none' })
    }
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

  // 提交
  const handleSubmit = async () => {
    if (!imageUrl && !selectedRecord?.image_path) {
      Taro.showToast({ title: '请先选择或上传图片', icon: 'none' })
      return
    }
    if (!merchantName.trim()) {
      Taro.showToast({ title: '请填写商家名称', icon: 'none' })
      return
    }

    setSubmitting(true)
    try {
      await createPublicFoodLibraryItem({
        image_path: imageUrl || selectedRecord?.image_path,
        source_record_id: selectedRecord?.id,
        total_calories: totalCalories,
        total_protein: totalProtein,
        total_carbs: totalCarbs,
        total_fat: totalFat,
        items,
        description,
        insight,
        merchant_name: merchantName.trim(),
        merchant_address: merchantAddress.trim() || undefined,
        taste_rating: tasteRating > 0 ? tasteRating : undefined,
        suitable_for_fat_loss: suitableForFatLoss,
        user_tags: userTags,
        user_notes: userNotes.trim() || undefined,
        latitude,
        longitude,
        city: city.trim() || undefined,
        district: district.trim() || undefined
      })
      Taro.showToast({ title: '分享成功', icon: 'success' })
      setTimeout(() => {
        Taro.navigateBack()
      }, 1500)
    } catch (e: any) {
      Taro.showToast({ title: e.message || '分享失败', icon: 'none' })
    } finally {
      setSubmitting(false)
    }
  }

  const canSubmit = (imageUrl || selectedRecord?.image_path) && merchantName.trim() && !submitting && !analyzing

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
            <Text className="source-icon">📷</Text>
            <Text className="source-text">拍照上传</Text>
          </View>
          <View
            className={`source-option ${sourceType === 'record' ? 'active' : ''}`}
            onClick={() => { setSourceType('record'); setShowRecordModal(true) }}
          >
            <Text className="source-icon">📋</Text>
            <Text className="source-text">从记录选择</Text>
          </View>
        </View>
      </View>

      {/* 图片区域 */}
      <View className="image-section">
        <Text className="section-title">
          食物图片 <Text className="required">*</Text>
        </Text>
        {imageUrl || imagePath ? (
          <Image
            className="preview-image"
            src={imageUrl || imagePath}
            mode="aspectFill"
            onClick={handleChooseImage}
          />
        ) : (
          <View className="image-upload-area" onClick={handleChooseImage}>
            <Text className="upload-icon">📷</Text>
            <Text className="upload-text">点击上传食物图片</Text>
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
            商家名称 <Text className="required">*</Text>
          </Text>
          <Input
            className="form-input"
            placeholder="如：沙县小吃、肯德基等"
            value={merchantName}
            onInput={e => setMerchantName(e.detail.value)}
          />
        </View>
        <View className="form-item">
          <Text className="form-label">商家地址（可选）</Text>
          <Input
            className="form-input"
            placeholder="详细地址"
            value={merchantAddress}
            onInput={e => setMerchantAddress(e.detail.value)}
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

      {/* 位置 */}
      <View className="location-section">
        <Text className="section-title">位置信息（可选）</Text>
        <View className="form-item">
          <Text className="form-label">城市</Text>
          <Input
            className="form-input"
            placeholder="如：北京"
            value={city}
            onInput={e => setCity(e.detail.value)}
          />
        </View>
        <View className="form-item">
          <Text className="form-label">区域</Text>
          <Input
            className="form-input"
            placeholder="如：朝阳区"
            value={district}
            onInput={e => setDistrict(e.detail.value)}
          />
        </View>
        <View className="form-item">
          {latitude && longitude ? (
            <View className="location-info">
              <Text className="location-text">📍 已获取位置 ({latitude.toFixed(4)}, {longitude.toFixed(4)})</Text>
            </View>
          ) : (
            <View className="location-btn" onClick={handleGetLocation}>
              <Text className="location-icon">📍</Text>
              <Text>获取当前位置</Text>
            </View>
          )}
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
                      <View className="record-image-placeholder">🍽️</View>
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
    </View>
  )
}
