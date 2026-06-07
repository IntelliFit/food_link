import { View, Text, Image, Input, Textarea, PageMeta } from '@tarojs/components'
import { useEffect, useState } from 'react'
import Taro, { useDidShow } from '@tarojs/taro'
import { withAuth } from '../../../utils/withAuth'
import { useAppColorScheme } from '../../../components/AppColorSchemeContext'
import SchoolPicker from '../../../components/SchoolPicker'
import { applyThemeNavigationBar } from '../../../utils/theme-navigation-bar'
import {
  analyzeFoodImage,
  createPublicFoodLibraryItem,
  imageToBase64,
  showUnifiedApiError,
  uploadAnalyzeImage,
  type Nutrients,
} from '../../../utils/api'
import { extraPkgUrl } from '../../../utils/subpackage-extra'
import { chooseImageWithPrivacy, isPrivacyAuthorizeError, showPrivacyAuthorizeFailure } from '../../../utils/weapp-privacy'
import './index.scss'

const MAX_IMAGES = 3
const CAMPUS_QUICK_TAGS = ['招牌菜', '性价比高', '大份量', '清淡', '少油', '高蛋白', '排队少']
const PRICE_TYPE_OPTIONS = ['fixed', 'weight', 'range', 'combo', 'unknown']
const PRICE_TYPE_LABELS: Record<string, string> = {
  fixed: '固定价格',
  weight: '称重计价',
  range: '价格区间',
  combo: '套餐价格',
  unknown: '未知',
}
const PRICE_TYPE_UNITS: Record<string, string> = {
  fixed: '元/份',
  weight: '元/斤',
  range: '元/份',
  combo: '元/套',
  unknown: '元',
}
const PRICE_TYPE_HELPERS: Record<string, string> = {
  fixed: '适合单份菜品，如 12 元/份',
  weight: '适合称重窗口，如 18 元/斤',
  range: '适合价格浮动菜品，如 8-15 元/份',
  combo: '适合套餐，如 20 元/套',
  unknown: '暂不确定计价方式时使用',
}

type CampusFoodItem = {
  name: string
  weight?: number
  nutrients?: Nutrients
}

function CampusFoodSharePage() {
  const { scheme } = useAppColorScheme()
  const [imagePaths, setImagePaths] = useState<string[]>([])
  const [imageUrls, setImageUrls] = useState<string[]>([])
  const [imageUrl, setImageUrl] = useState('')
  const [analyzeResultsMap, setAnalyzeResultsMap] = useState<Record<string, Awaited<ReturnType<typeof analyzeFoodImage>>>>({})
  const [items, setItems] = useState<CampusFoodItem[]>([])
  const [description, setDescription] = useState('')
  const [insight, setInsight] = useState('')
  const [totalCalories, setTotalCalories] = useState(0)
  const [totalProtein, setTotalProtein] = useState(0)
  const [totalCarbs, setTotalCarbs] = useState(0)
  const [totalFat, setTotalFat] = useState(0)
  const [foodName, setFoodName] = useState('')
  const [schoolName, setSchoolName] = useState('')
  const [canteenName, setCanteenName] = useState('')
  const [floor, setFloor] = useState('')
  const [windowName, setWindowName] = useState('')
  const [price, setPrice] = useState('')
  const [priceType, setPriceType] = useState('fixed')
  const [priceMin, setPriceMin] = useState('')
  const [priceMax, setPriceMax] = useState('')
  const [priceUnit, setPriceUnit] = useState('元/份')
  const [priceCollectedAt, setPriceCollectedAt] = useState(() => new Date().toISOString().slice(0, 10))
  const [portionDescription, setPortionDescription] = useState('')
  const [suitableForFatLoss, setSuitableForFatLoss] = useState(false)
  const [userTags, setUserTags] = useState<string[]>([])
  const [customTag, setCustomTag] = useState('')
  const [userNotes, setUserNotes] = useState('')
  const [showSchoolPicker, setShowSchoolPicker] = useState(false)
  const [showPriceTypeSheet, setShowPriceTypeSheet] = useState(false)
  const [showPriceDateSheet, setShowPriceDateSheet] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)

  const inferFoodName = (nextItems?: CampusFoodItem[], nextDescription?: string) => {
    const itemNames = (nextItems || [])
      .map(item => item.name?.trim())
      .filter(Boolean)
      .slice(0, 3) as string[]
    if (itemNames.length > 0) return itemNames.join('、')

    const desc = (nextDescription || '').trim()
    return desc ? desc.slice(0, 20) : ''
  }

  /** 聚合识别结果，只用于提交给后端，不在上传页展示营养数值。 */
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
    const allItems = results.flatMap(r =>
      (r.items || []).map(it => ({
        name: it.name,
        weight: it.estimatedWeightGrams,
        nutrients: it.nutrients,
      }))
    )

    setDescription(descriptions.join('；'))
    setInsight(insights.join('；'))
    setItems(allItems)
    setTotalCalories(results.reduce((sum, r) => sum + (r.items || []).reduce((subSum, it) => subSum + (it.nutrients?.calories || 0), 0), 0))
    setTotalProtein(results.reduce((sum, r) => sum + (r.items || []).reduce((subSum, it) => subSum + (it.nutrients?.protein || 0), 0), 0))
    setTotalCarbs(results.reduce((sum, r) => sum + (r.items || []).reduce((subSum, it) => subSum + (it.nutrients?.carbs || 0), 0), 0))
    setTotalFat(results.reduce((sum, r) => sum + (r.items || []).reduce((subSum, it) => subSum + (it.nutrients?.fat || 0), 0), 0))

    const inferredName = inferFoodName(allItems, descriptions.join('；'))
    if (inferredName) setFoodName(prev => prev.trim() || inferredName)
  }

  const handleChooseImage = async () => {
    const remain = MAX_IMAGES - imageUrls.length
    if (remain <= 0) return

    try {
      const res = await chooseImageWithPrivacy({
        count: remain,
        sizeType: ['compressed'],
        sourceType: ['album', 'camera'],
      })
      const tempPaths = res.tempFilePaths || []
      if (tempPaths.length === 0) return

      const prevPaths = imagePaths
      const prevUrls = imageUrls
      const prevResultsMap = analyzeResultsMap
      setImagePaths(prev => [...prev, ...tempPaths])
      setAnalyzing(true)
      Taro.showLoading({ title: '上传中...', mask: true })

      try {
        const newUrls: string[] = []
        for (const tempPath of tempPaths) {
          const base64 = await imageToBase64(tempPath)
          const uploadRes = await uploadAnalyzeImage(base64)
          newUrls.push(uploadRes.imageUrl)
        }

        const allUrls = [...prevUrls, ...newUrls]
        setImageUrls(allUrls)
        setImageUrl(allUrls[0] || '')
        Taro.hideLoading()

        const newResultsMap = { ...prevResultsMap }
        for (let i = 0; i < newUrls.length; i++) {
          Taro.showLoading({ title: `识别中 (${i + 1}/${newUrls.length})...`, mask: true })
          newResultsMap[newUrls[i]] = await analyzeFoodImage({ image_url: newUrls[i] })
        }
        setAnalyzeResultsMap(newResultsMap)
        aggregateFromMap(allUrls, newResultsMap)
        Taro.showToast({ title: '图片已上传', icon: 'success' })
      } catch (e: any) {
        setImagePaths(prevPaths)
        setImageUrls(prevUrls)
        setImageUrl(prevUrls[0] || '')
        setAnalyzeResultsMap(prevResultsMap)
        await showUnifiedApiError(e, '上传失败')
      } finally {
        Taro.hideLoading()
        setAnalyzing(false)
      }
    } catch (e) {
      if ((e as any)?.errMsg?.includes('cancel')) return
      if (isPrivacyAuthorizeError(e)) {
        showPrivacyAuthorizeFailure(e)
        return
      }
      console.error('选择图片失败', e)
    }
  }

  const handlePreviewImage = (index: number) => {
    const urls = imageUrls.filter(Boolean)
    const current = urls[index]
    if (urls.length > 0 && current) Taro.previewImage({ urls, current })
  }

  const handleRemoveImage = (index: number) => {
    const removedUrl = imageUrls[index]
    const nextPaths = imagePaths.filter((_, i) => i !== index)
    const nextUrls = imageUrls.filter((_, i) => i !== index)
    const nextResultsMap = { ...analyzeResultsMap }
    delete nextResultsMap[removedUrl]

    setImagePaths(nextPaths)
    setImageUrls(nextUrls)
    setImageUrl(nextUrls[0] || '')
    setAnalyzeResultsMap(nextResultsMap)
    aggregateFromMap(nextUrls, nextResultsMap)
  }

  const toggleQuickTag = (tag: string) => {
    setUserTags(prev => prev.includes(tag) ? prev.filter(item => item !== tag) : [...prev, tag])
  }

  const handleAddTag = () => {
    const tag = customTag.trim()
    if (!tag) return
    if (userTags.includes(tag)) {
      Taro.showToast({ title: '标签已存在', icon: 'none' })
      return
    }
    setUserTags(prev => [...prev, tag])
    setCustomTag('')
  }

  const removeTag = (tag: string) => {
    setUserTags(prev => prev.filter(item => item !== tag))
  }

  const handleSelectPriceType = (nextType: string) => {
    const fallbackUnit = PRICE_TYPE_UNITS[nextType] || '元'
    setPriceType(nextType)
    setPriceUnit(fallbackUnit)
    if (nextType === 'range') {
      setPrice('')
    } else {
      setPriceMin('')
      setPriceMax('')
    }
    setShowPriceTypeSheet(false)
  }

  const buildRecentDateOptions = () => {
    return Array.from({ length: 7 }).map((_, index) => {
      const d = new Date()
      d.setDate(d.getDate() - index)
      const value = d.toISOString().slice(0, 10)
      const label = index === 0 ? '今天' : index === 1 ? '昨天' : `${index} 天前`
      return { value, label }
    })
  }

  const validatePriceRange = () => {
    if (priceType !== 'range') return true
    const min = Number(priceMin)
    const max = Number(priceMax)
    return Number.isFinite(min) && Number.isFinite(max) && min > 0 && max > 0 && min <= max
  }

  const handleSubmit = async () => {
    if (imageUrls.length === 0 && !imageUrl) {
      Taro.showToast({ title: '请先上传菜品图片', icon: 'none' })
      return
    }

    const finalFoodName = foodName.trim() || inferFoodName(items, description)
    if (!finalFoodName) {
      Taro.showToast({ title: '请填写菜品名称', icon: 'none' })
      return
    }
    if (!schoolName.trim()) {
      Taro.showToast({ title: '请选择学校', icon: 'none' })
      return
    }
    if (!canteenName.trim()) {
      Taro.showToast({ title: '请填写食堂名称', icon: 'none' })
      return
    }
    if (!validatePriceRange()) {
      Taro.showToast({ title: '请填写正确价格区间', icon: 'none' })
      return
    }

    if (finalFoodName !== foodName.trim()) setFoodName(finalFoodName)

    const { confirm } = await Taro.showModal({
      title: '确认提交',
      content: '确定发布这份校园食堂菜品吗？提交后会自动出现在校园食堂分区。',
      confirmText: '确定提交',
      cancelText: '取消',
    })
    if (!confirm) return

    await doSubmit(finalFoodName)
  }

  const doSubmit = async (finalFoodName: string) => {
    setSubmitting(true)
    try {
      await createPublicFoodLibraryItem({
        image_path: imageUrl || undefined,
        image_paths: imageUrls.length > 0 ? imageUrls : undefined,
        total_calories: totalCalories,
        total_protein: totalProtein,
        total_carbs: totalCarbs,
        total_fat: totalFat,
        items,
        description,
        insight,
        food_name: finalFoodName,
        suitable_for_fat_loss: suitableForFatLoss,
        user_tags: userTags,
        user_notes: userNotes.trim() || undefined,
        is_campus_food: true,
        school_name: schoolName.trim(),
        canteen_name: canteenName.trim(),
        floor: floor.trim() || undefined,
        window_name: windowName.trim() || undefined,
        price: priceType !== 'range' && price ? Number(price) || undefined : undefined,
        price_type: priceType.trim() || undefined,
        price_min: priceType === 'range' && priceMin ? Number(priceMin) || undefined : undefined,
        price_max: priceType === 'range' && priceMax ? Number(priceMax) || undefined : undefined,
        price_unit: priceUnit.trim() || undefined,
        price_collected_at: priceCollectedAt ? `${priceCollectedAt}T00:00:00+08:00` : undefined,
        portion_description: portionDescription.trim() || undefined,
      })
      Taro.showToast({ title: '已发布到校园食堂', icon: 'none', duration: 2500 })
      Taro.setStorageSync('food_library_need_refresh', '1')
      setTimeout(() => {
        Taro.redirectTo({ url: extraPkgUrl('/pages/campus-canteen/index') })
      }, 2500)
    } catch (e: any) {
      await showUnifiedApiError(e, '发布失败')
    } finally {
      setSubmitting(false)
    }
  }

  const canSubmit = imageUrls.length > 0 && !submitting && !analyzing
  const isDark = scheme === 'dark'

  useDidShow(() => {
    applyThemeNavigationBar(scheme, { lightBackground: '#f9fafb', darkBackground: '#07110f' })
  })

  useEffect(() => {
    applyThemeNavigationBar(scheme, { lightBackground: '#f9fafb', darkBackground: '#07110f' })
  }, [scheme])

  return (
    <>
      <PageMeta
        backgroundColor={isDark ? '#07110f' : '#f9fafb'}
        pageStyle={`background-color: ${isDark ? '#07110f' : '#f9fafb'};`}
      />
    <View className={`campus-share-page ${isDark ? 'campus-share-page--dark' : ''}`}>
      <View className='campus-share-hero'>
        <Text className='campus-share-hero__title'>分享校园食堂菜品</Text>
        <Text className='campus-share-hero__subtitle'>补充学校、食堂和窗口信息，帮助同学更快找到好吃的一餐。</Text>
      </View>

      <View className='campus-share-section'>
        <Text className='section-title'>菜品图片 <Text className='required'>*</Text>{imageUrls.length > 0 && <Text className='image-count'>（{imageUrls.length}/3）</Text>}</Text>
        {imageUrls.length > 0 ? (
          <View className='share-image-grid'>
            {imageUrls.map((url, index) => (
              <View key={url} className='share-grid-item'>
                <Image src={url} mode='aspectFill' className='share-grid-image' onClick={() => handlePreviewImage(index)} />
                <View className='share-remove-btn' onClick={(e) => { e.stopPropagation(); handleRemoveImage(index) }}>
                  <Text className='share-close-icon'>×</Text>
                </View>
              </View>
            ))}
            {imageUrls.length < MAX_IMAGES && (
              <View className='share-grid-item share-add-btn' onClick={handleChooseImage}>
                <Text className='share-add-icon'>+</Text>
                <Text className='share-add-text'>添加</Text>
              </View>
            )}
          </View>
        ) : (
          <View className='image-upload-area' onClick={handleChooseImage}>
            <Text className='upload-icon iconfont icon-paizhao-xianxing' />
            <Text className='upload-text'>点击上传菜品图片（最多 3 张）</Text>
          </View>
        )}
      </View>

      <View className='campus-share-section'>
        <Text className='section-title'>菜品信息</Text>
        <View className='form-item'>
          <Text className='form-label'>菜品名称 <Text className='required'>*</Text></Text>
          <Input className='form-input' placeholder='如：黄焖鸡米饭、番茄牛腩面' value={foodName} onInput={e => setFoodName(e.detail.value)} />
        </View>
        <View className='form-item'>
          <Text className='form-label'>学校 <Text className='required'>*</Text></Text>
          <View className='form-input picker-display' onClick={() => setShowSchoolPicker(true)}>
            <Text className={schoolName ? 'picker-value' : 'picker-placeholder'}>{schoolName || '请选择学校'}</Text>
          </View>
        </View>
        <View className='form-item'>
          <Text className='form-label'>食堂 <Text className='required'>*</Text></Text>
          <Input className='form-input' placeholder='请输入食堂名称' value={canteenName} onInput={e => setCanteenName(e.detail.value)} />
        </View>
        <View className='form-row'>
          <View className='form-item form-item--half'>
            <Text className='form-label'>楼层（可选）</Text>
            <Input className='form-input' placeholder='如：一层' value={floor} onInput={e => setFloor(e.detail.value)} />
          </View>
          <View className='form-item form-item--half'>
            <Text className='form-label'>窗口（可选）</Text>
            <Input className='form-input' placeholder='如：12号窗口' value={windowName} onInput={e => setWindowName(e.detail.value)} />
          </View>
        </View>
      </View>

      <View className='campus-share-section'>
        <Text className='section-title'>价格信息（可选）</Text>
        {priceType === 'range' ? (
          <>
            <View className='form-row price-main-row'>
              <View className='form-item form-item--price-type'>
                <Text className='form-label'>计价方式</Text>
                <View className='form-input picker-display price-type-display' onClick={() => setShowPriceTypeSheet(true)}>
                  <Text className='picker-value'>{PRICE_TYPE_LABELS[priceType] || '请选择计价方式'}</Text>
                  <Text className='picker-arrow'>⌄</Text>
                </View>
              </View>
              <View className='form-item form-item--half'>
                <Text className='form-label'>最低价</Text>
                <Input className='form-input' placeholder='如：8' type='digit' value={priceMin} onInput={e => setPriceMin(e.detail.value)} />
              </View>
              <View className='form-item form-item--half'>
                <Text className='form-label'>最高价</Text>
                <Input className='form-input' placeholder='如：15' type='digit' value={priceMax} onInput={e => setPriceMax(e.detail.value)} />
              </View>
            </View>
            <Text className='price-helper'>{PRICE_TYPE_HELPERS[priceType]}</Text>
          </>
        ) : (
          <View className='form-row price-main-row'>
            <View className='form-item form-item--price-type'>
              <Text className='form-label'>计价方式</Text>
              <View className='form-input picker-display price-type-display' onClick={() => setShowPriceTypeSheet(true)}>
                <Text className='picker-value'>{PRICE_TYPE_LABELS[priceType] || '请选择计价方式'}</Text>
                <Text className='picker-arrow'>⌄</Text>
              </View>
            </View>
            <View className='form-item form-item--price-value'>
              <Text className='form-label'>价格</Text>
              <Input className='form-input' placeholder={priceType === 'unknown' ? '可不填' : '如：12'} type='digit' value={price} onInput={e => setPrice(e.detail.value)} />
            </View>
          </View>
        )}
        {priceType !== 'range' && <Text className='price-helper'>{PRICE_TYPE_HELPERS[priceType]}</Text>}
        <View className='form-row'>
          <View className='form-item form-item--half'>
            <Text className='form-label'>价格单位</Text>
            <Input className='form-input' placeholder={PRICE_TYPE_UNITS[priceType] || '元'} value={priceUnit} onInput={e => setPriceUnit(e.detail.value)} />
          </View>
          <View className='form-item form-item--half'>
            <Text className='form-label'>采集日期</Text>
            <View className='form-input picker-display' onClick={() => setShowPriceDateSheet(true)}>
              <Text className='picker-value'>{priceCollectedAt || '请选择日期'}</Text>
              <Text className='picker-arrow'>⌄</Text>
            </View>
          </View>
        </View>
        <View className='form-item'>
          <Text className='form-label'>份量说明（可选）</Text>
          <Input className='form-input' placeholder='如：大份、小份、约一人份' value={portionDescription} onInput={e => setPortionDescription(e.detail.value)} />
        </View>
      </View>

      <View className='campus-share-section'>
        <Text className='section-title'>标签</Text>
        <View className='switch-row'>
          <Text className='switch-label'>适合减脂</Text>
          <View className={`switch-btn ${suitableForFatLoss ? 'active' : ''}`} onClick={() => setSuitableForFatLoss(prev => !prev)}>
            <View className='switch-dot' />
          </View>
        </View>
        <View className='quick-tags'>
          {CAMPUS_QUICK_TAGS.map(tag => (
            <View key={tag} className={`quick-tag ${userTags.includes(tag) ? 'selected' : ''}`} onClick={() => toggleQuickTag(tag)}>{tag}</View>
          ))}
        </View>
        <View className='custom-tag-row'>
          <Input className='tag-input' placeholder='自定义标签' value={customTag} onInput={e => setCustomTag(e.detail.value)} onConfirm={handleAddTag} />
          <View className='add-tag-btn' onClick={handleAddTag}>添加</View>
        </View>
        {userTags.length > 0 && (
          <View className='selected-tags'>
            {userTags.map(tag => (
              <View key={tag} className='selected-tag'>
                <Text>{tag}</Text>
                <Text className='remove-tag' onClick={() => removeTag(tag)}>×</Text>
              </View>
            ))}
          </View>
        )}
      </View>

      <View className='campus-share-section'>
        <Text className='section-title'>补充说明（可选）</Text>
        <Textarea className='form-textarea' placeholder='例如口味、排队情况、推荐搭配等...' value={userNotes} onInput={e => setUserNotes(e.detail.value)} maxlength={500} />
      </View>

      <View className='submit-bar'>
        <View className={`submit-btn ${canSubmit ? '' : 'disabled'}`} onClick={canSubmit ? handleSubmit : undefined}>
          {submitting || analyzing ? <View className='btn-spinner' /> : '发布到校园食堂'}
        </View>
      </View>

      {showPriceTypeSheet && (
        <View className='campus-modal-overlay' onClick={() => setShowPriceTypeSheet(false)}>
          <View className='campus-modal-card' onClick={e => e.stopPropagation()}>
            <View className='campus-modal-header'>
              <Text className='campus-modal-title'>选择计价方式</Text>
              <Text className='campus-modal-close' onClick={() => setShowPriceTypeSheet(false)}>关闭</Text>
            </View>
            <View className='campus-option-list'>
              {PRICE_TYPE_OPTIONS.map(type => (
                <View
                  key={type}
                  className={`campus-option-item ${priceType === type ? 'active' : ''}`}
                  onClick={() => handleSelectPriceType(type)}
                >
                  <View className='campus-option-copy'>
                    <Text className='campus-option-title'>{PRICE_TYPE_LABELS[type]}</Text>
                    <Text className='campus-option-desc'>{PRICE_TYPE_HELPERS[type]}</Text>
                  </View>
                  <Text className='campus-option-unit'>{PRICE_TYPE_UNITS[type]}</Text>
                </View>
              ))}
            </View>
          </View>
        </View>
      )}

      {showPriceDateSheet && (
        <View className='campus-modal-overlay' onClick={() => setShowPriceDateSheet(false)}>
          <View className='campus-modal-card' onClick={e => e.stopPropagation()}>
            <View className='campus-modal-header'>
              <Text className='campus-modal-title'>选择采集日期</Text>
              <Text className='campus-modal-close' onClick={() => setShowPriceDateSheet(false)}>关闭</Text>
            </View>
            <View className='campus-date-manual'>
              <Text className='campus-date-manual-label'>手动输入日期</Text>
              <Input
                className='form-input'
                placeholder='YYYY-MM-DD'
                value={priceCollectedAt}
                onInput={e => setPriceCollectedAt(e.detail.value)}
                onConfirm={() => setShowPriceDateSheet(false)}
              />
            </View>
            <View className='campus-option-list'>
              {buildRecentDateOptions().map(item => (
                <View
                  key={item.value}
                  className={`campus-option-item ${priceCollectedAt === item.value ? 'active' : ''}`}
                  onClick={() => {
                    setPriceCollectedAt(item.value)
                    setShowPriceDateSheet(false)
                  }}
                >
                  <View className='campus-option-copy'>
                    <Text className='campus-option-title'>{item.label}</Text>
                    <Text className='campus-option-desc'>{item.value}</Text>
                  </View>
                </View>
              ))}
            </View>
          </View>
        </View>
      )}

      <SchoolPicker
        visible={showSchoolPicker}
        onSelect={(school) => {
          setSchoolName(school.name)
          setShowSchoolPicker(false)
        }}
        onCancel={() => setShowSchoolPicker(false)}
      />
    </View>
    </>
  )
}

export default withAuth(CampusFoodSharePage)
