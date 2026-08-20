import { Image, Input, Picker, ScrollView, Switch, Text, View } from '@tarojs/components'
import Taro, { useDidShow, useRouter } from '@tarojs/taro'
import { useEffect, useMemo, useState } from 'react'
import {
  createSupplement,
  listSupplements,
  recognizePackagedNutritionLabel,
  showUnifiedApiError,
  updateSupplement,
  uploadAnalyzeImageFile,
  type SupplementComponent,
  type SupplementComponentCategory,
} from '../../../utils/api'
import {
  SUPPLEMENT_NUTRIENT_OPTIONS,
  SUPPLEMENT_CATALOG_SELECTION_KEY,
  cloneCatalogComponents,
  componentsFromNutritionLabel,
  createEmptySupplementComponent,
  normalizeSupplementCode,
  supplementOcrBasisText,
} from '../../../utils/supplements'
import { extraPkgUrl } from '../../../utils/subpackage-extra'
import { chooseImageWithPrivacy, isPrivacyAuthorizeError, showPrivacyAuthorizeFailure } from '../../../utils/weapp-privacy'
import { HOME_DASHBOARD_REFRESH_EVENT } from '../../../utils/home-events'
import { FlPageThemeRoot } from '../../../components/FlPageThemeRoot'

import './index.scss'

function updateComponent(items: SupplementComponent[], index: number, patch: Partial<SupplementComponent>): SupplementComponent[] {
  return items.map((item, current) => current === index ? { ...item, ...patch } : item)
}

export default function SupplementEditPage() {
  const router = useRouter()
  const itemId = String(router.params.id || '').trim()
  const [name, setName] = useState('')
  const [brand, setBrand] = useState('')
  const [imageUrl, setImageUrl] = useState('')
  const [servingLabel, setServingLabel] = useState('1粒')
  const [scheduleEnabled, setScheduleEnabled] = useState(true)
  const [scheduleTime, setScheduleTime] = useState('08:00')
  const [components, setComponents] = useState<SupplementComponent[]>([createEmptySupplementComponent()])
  const [confirmed, setConfirmed] = useState(false)
  const [ocrHint, setOcrHint] = useState('')
  const [recognizing, setRecognizing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [initializing, setInitializing] = useState(Boolean(itemId))

  useEffect(() => {
    if (!itemId) return
    void listSupplements('active').then((items) => {
      const item = items.find((entry) => entry.id === itemId)
      if (!item) throw new Error('补剂不存在或已归档')
      setName(item.name)
      setBrand(item.brand || '')
      setImageUrl(item.image_url || '')
      setServingLabel(item.serving_label || '1份')
      setScheduleEnabled(item.schedule_enabled)
      setScheduleTime(item.schedule_time || '08:00')
      setComponents(item.components?.length ? item.components : [createEmptySupplementComponent()])
      setConfirmed(Boolean(item.label_confirmed_at))
      Taro.setNavigationBarTitle({ title: '编辑补剂' })
    }).catch((error) => {
      void showUnifiedApiError(error, '加载补剂失败')
    }).finally(() => setInitializing(false))
  }, [itemId])

  useDidShow(() => {
    if (itemId) return
    const selected = Taro.getStorageSync(SUPPLEMENT_CATALOG_SELECTION_KEY)
    if (!selected?.id || !selected?.name) return
    Taro.removeStorageSync(SUPPLEMENT_CATALOG_SELECTION_KEY)
    setName(selected.name)
    setBrand(selected.brand || '')
    setImageUrl(selected.image_url || '')
    setServingLabel(selected.serving_label || '1份')
    setComponents(cloneCatalogComponents(selected))
    setOcrHint('已从公共补剂库预填，请按照自己的瓶身标签核对含量。')
    setConfirmed(false)
  })

  const validComponentCount = useMemo(
    () => components.filter((item) => item.name.trim() && Number(item.amount) > 0 && item.unit.trim()).length,
    [components],
  )

  const openCatalog = () => {
    Taro.navigateTo({ url: extraPkgUrl('/pages/supplement-catalog/index') })
  }

  const recognizeLabel = async () => {
    if (recognizing) return
    try {
      const chosen = await chooseImageWithPrivacy({ count: 1, sizeType: ['compressed'], sourceType: ['camera', 'album'] })
      const localPath = chosen.tempFilePaths?.[0]
      if (!localPath) return
      setRecognizing(true)
      const uploaded = await uploadAnalyzeImageFile(localPath)
      const recognized = await recognizePackagedNutritionLabel(uploaded.imageUrl)
      const nextComponents = componentsFromNutritionLabel(recognized)
      setImageUrl(uploaded.imageUrl)
      if (recognized.product_name) setName(recognized.product_name)
      if (recognized.brand) setBrand(recognized.brand)
      if (nextComponents.length) setComponents(nextComponents)
      setOcrHint(supplementOcrBasisText(recognized))
      setConfirmed(false)
      Taro.showToast({ title: nextComponents.length ? '已预填，请核对' : '请按标签补充成分', icon: 'none' })
    } catch (error: any) {
      if (isPrivacyAuthorizeError(error)) {
        showPrivacyAuthorizeFailure(error)
      } else if (!String(error?.errMsg || '').includes('cancel')) {
        await showUnifiedApiError(error, '标签识别失败')
      }
    } finally {
      setRecognizing(false)
    }
  }

  const changeCategory = (index: number, category: SupplementComponentCategory) => {
    const current = components[index]
    setComponents(updateComponent(components, index, {
      category,
      nutrient_key: category === 'nutrient' ? current.nutrient_key : undefined,
    }))
    setConfirmed(false)
  }

  const selectNutrient = (index: number, optionIndex: number) => {
    const option = SUPPLEMENT_NUTRIENT_OPTIONS[optionIndex]
    if (!option) return
    setComponents(updateComponent(components, index, {
      code: normalizeSupplementCode(option.key),
      name: option.label,
      category: 'nutrient',
      unit: option.unit,
      nutrient_key: option.key,
    }))
    setConfirmed(false)
  }

  const save = async () => {
    if (saving) return
    if (!name.trim()) {
      Taro.showToast({ title: '请填写补剂名称', icon: 'none' })
      return
    }
    const normalized = components
      .filter((item) => item.name.trim() && Number(item.amount) > 0 && item.unit.trim())
      .map((item) => ({ ...item, code: normalizeSupplementCode(item.code || item.name), amount: Number(item.amount) }))
    if (!normalized.length) {
      Taro.showToast({ title: '请至少填写一项成分', icon: 'none' })
      return
    }
    if (!confirmed) {
      Taro.showToast({ title: '请先确认标签成分', icon: 'none' })
      return
    }
    setSaving(true)
    try {
      const payload = {
        name: name.trim(), brand: brand.trim(), image_url: imageUrl || null,
        default_servings: 1, serving_label: servingLabel.trim() || '1份',
        schedule_enabled: scheduleEnabled, schedule_time: scheduleEnabled ? scheduleTime : null, schedule_days: [],
        components: normalized, label_confirmed: true, status: 'active',
      }
      if (itemId) await updateSupplement(itemId, payload)
      else await createSupplement(payload)
      Taro.eventCenter.trigger(HOME_DASHBOARD_REFRESH_EVENT)
      Taro.showToast({ title: '已保存', icon: 'success' })
      setTimeout(() => Taro.navigateBack(), 450)
    } catch (error) {
      await showUnifiedApiError(error, '保存失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <FlPageThemeRoot>
      <View className='supplement-edit-page'>
        <ScrollView scrollY className='supplement-edit-scroll'>
          {initializing ? (
            <View className='supplement-edit-loading'><View className='supplement-edit-spinner' /></View>
          ) : (
            <>
              <View className='supplement-capture-card'>
                <View className='supplement-capture-copy'>
                  <Text className='supplement-capture-title'>{itemId ? '重新识别标签' : '选择添加方式'}</Text>
                  <Text className='supplement-capture-sub'>{itemId ? '重新拍摄瓶身标签后，请再次核对全部内容。' : '可以从公共补剂库选择，也可以拍摄瓶身标签自动预填。'}</Text>
                </View>
                <View className='supplement-capture-actions'>
                  {!itemId && <View className='supplement-capture-action primary' onClick={openCatalog}><Text>从补剂库选择</Text></View>}
                  <View className={`supplement-capture-action${itemId ? ' primary' : ''}${recognizing ? ' is-busy' : ''}`} onClick={() => void recognizeLabel()}><Text>{recognizing ? '识别中' : '拍标签添加'}</Text></View>
                </View>
                {imageUrl && <Image className='supplement-label-thumb' src={imageUrl} mode='aspectFill' />}
                {ocrHint && <Text className='supplement-ocr-hint'>{ocrHint}</Text>}
              </View>

              <View className='supplement-form-card'>
                <Text className='supplement-form-title'>基本信息</Text>
                <View className='supplement-field'><Text className='supplement-field-label'>名称</Text><Input value={name} placeholder='如：甘氨酸镁' onInput={(e) => setName(e.detail.value)} /></View>
                <View className='supplement-field'><Text className='supplement-field-label'>品牌</Text><Input value={brand} placeholder='选填' onInput={(e) => setBrand(e.detail.value)} /></View>
                <View className='supplement-field'><Text className='supplement-field-label'>一次用量</Text><Input value={servingLabel} placeholder='如：2粒 / 1勺' onInput={(e) => setServingLabel(e.detail.value)} /></View>
              </View>

              <View className='supplement-form-card'>
                <View className='supplement-section-head'><Text className='supplement-form-title'>标签成分</Text><Text className='supplement-count'>{validComponentCount} 项</Text></View>
                {components.map((item, index) => (
                  <View key={`${index}-${item.code}`} className='supplement-component-card'>
                    <View className='supplement-category-row'>
                      {(['nutrient', 'functional', 'blend'] as SupplementComponentCategory[]).map((category) => (
                        <View key={category} className={`supplement-category${item.category === category ? ' is-active' : ''}`} onClick={() => changeCategory(index, category)}>
                          <Text>{category === 'nutrient' ? '营养素' : category === 'functional' ? '功能成分' : '复合配方'}</Text>
                        </View>
                      ))}
                    </View>
                    {item.category === 'nutrient' ? (
                      <Picker mode='selector' range={SUPPLEMENT_NUTRIENT_OPTIONS.map((option) => option.label)} onChange={(e) => selectNutrient(index, Number(e.detail.value))}>
                        <View className='supplement-picker'><Text>{item.nutrient_key ? item.name : '选择要汇入营养面板的营养素'}</Text><Text>›</Text></View>
                      </Picker>
                    ) : (
                      <View className='supplement-inline-field'><Input value={item.name} placeholder={item.category === 'blend' ? '如：专利草本复合物' : '如：肌酸、甘氨酸'} onInput={(e) => { setComponents(updateComponent(components, index, { name: e.detail.value, code: normalizeSupplementCode(e.detail.value) })); setConfirmed(false) }} /></View>
                    )}
                    <View className='supplement-amount-row'>
                      <Input type='digit' value={item.amount ? String(item.amount) : ''} placeholder='含量' onInput={(e) => { setComponents(updateComponent(components, index, { amount: Number(e.detail.value) || 0 })); setConfirmed(false) }} />
                      <Input value={item.unit} placeholder='单位' onInput={(e) => { setComponents(updateComponent(components, index, { unit: e.detail.value })); setConfirmed(false) }} />
                      <View className='supplement-remove' onClick={() => { setComponents(components.filter((_, current) => current !== index)); setConfirmed(false) }}><Text>删除</Text></View>
                    </View>
                  </View>
                ))}
                <View className='supplement-add-component' onClick={() => { setComponents([...components, createEmptySupplementComponent('functional')]); setConfirmed(false) }}><Text>＋ 添加成分</Text></View>
              </View>

              <View className='supplement-form-card'>
                <View className='supplement-switch-row'><View><Text className='supplement-form-title'>每日计划</Text><Text className='supplement-field-note'>开启后出现在首页“今日补剂”</Text></View><Switch checked={scheduleEnabled} color='#00a976' onChange={(e) => setScheduleEnabled(e.detail.value)} /></View>
                {scheduleEnabled && <View className='supplement-field'><Text className='supplement-field-label'>计划时间</Text><Input value={scheduleTime} placeholder='08:00' onInput={(e) => setScheduleTime(e.detail.value)} /></View>}
              </View>

              <View className={`supplement-confirm${confirmed ? ' is-confirmed' : ''}`} onClick={() => setConfirmed(!confirmed)}>
                <View className='supplement-confirm-box'><Text>{confirmed ? '✓' : ''}</Text></View>
                <Text>我已核对名称、每次用量和全部标签成分</Text>
              </View>
              <View className={`supplement-save${saving ? ' is-busy' : ''}`} onClick={() => void save()}><Text>{saving ? '保存中' : '保存到补剂柜'}</Text></View>
              <Text className='supplement-disclaimer'>本功能仅用于营养与成分记录，不提供诊断、处方或停药建议。</Text>
            </>
          )}
        </ScrollView>
      </View>
    </FlPageThemeRoot>
  )
}
