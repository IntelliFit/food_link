import { Image, Input, Text, View } from '@tarojs/components'
import { useState } from 'react'
import Taro from '@tarojs/taro'
import type { Nutrients } from '../../../utils/api'
import { FOOD_MEASURE_UNITS, foodMeasureUnitLabel, type FoodMeasurement, type FoodMeasureUnit } from '../../../utils/food-measure'
import { calculateCustomPortion } from './custom-food-portion'
import './custom-food-editor.scss'

export interface CustomFoodEditorDraft {
  name: string
  weight: string
  nutritionBasis: string
  energyUnit: 'kj' | 'kcal'
  calories: string
  protein: string
  carbs: string
  fat: string
  category: 'custom' | 'snack'
  images: string[]
  microValues: Record<string, string>
  basisUnit?: FoodMeasureUnit
  portionUnit?: FoodMeasureUnit
  conversion?: string
  unitConversions?: FoodMeasurement['unit_conversions']
}

export interface CustomFoodEditorProps {
  value: CustomFoodEditorDraft
  microFields: Array<{ key: keyof Nutrients; label: string; unit: string }>
  editing?: boolean
  saving?: boolean
  importing?: boolean
  imageUploading?: boolean
  importNote?: string
  onChange: (patch: Partial<CustomFoodEditorDraft>) => void
  onMicroChange: (key: keyof Nutrients, value: string) => void
  onChooseImages: () => void
  onImportPackage: () => void
  onPreviewImage: (url: string) => void
  onSave: () => void
  onCancel: () => void
  onCollapse: () => void
}

const MACRO_FIELDS = [
  { key: 'protein', label: '蛋白质' },
  { key: 'carbs', label: '碳水' },
  { key: 'fat', label: '脂肪' },
] as const

export function CustomFoodEditor({
  value, microFields, editing = false, saving = false, importing = false,
  imageUploading = false, importNote, onChange, onMicroChange, onChooseImages,
  onImportPackage, onPreviewImage, onSave, onCancel, onCollapse,
}: CustomFoodEditorProps) {
  const [showNutrition, setShowNutrition] = useState(false)
  const [showMicro, setShowMicro] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [showPortion, setShowPortion] = useState(false)
  const [showPackageCalculator, setShowPackageCalculator] = useState(false)
  const [packageQuantity, setPackageQuantity] = useState('')
  const [portionCount, setPortionCount] = useState('')
  const busy = saving || importing || imageUploading
  const macroSummary = MACRO_FIELDS
    .filter(({ key }) => value[key].trim() !== '')
    .map(({ key, label }) => `${label} ${value[key]}g`)
    .join(' · ')
  const microCount = microFields.filter(({ key }) => String(value.microValues[key] || '').trim() !== '').length
  const hasNutrition = Boolean(macroSummary || microCount)
  const basisUnit = value.basisUnit || 'g'
  const portionUnit = value.portionUnit || basisUnit
  const basisLabel = foodMeasureUnitLabel(basisUnit)
  const portionLabel = foodMeasureUnitLabel(portionUnit)
  const calculatedPortion = calculateCustomPortion(packageQuantity, portionCount)
  const canCalculatePortion = portionUnit !== basisUnit && (portionUnit === 'piece' || portionUnit === 'serving')
  const changeBasisUnit = async (next: FoodMeasureUnit) => {
    if (next === basisUnit) return
    if (value.calories.trim() !== '' || hasNutrition) {
      const result = await Taro.showModal({ title: '更换营养标示单位', content: '热量和营养数值将清空，请按新单位重新填写，避免误算。', confirmText: '更换' })
      if (!result?.confirm) return
    }
    const initial = next === 'piece' || next === 'serving' ? '1' : '100'
    setShowPackageCalculator(false)
    setPackageQuantity('')
    setPortionCount('')
    onChange({ basisUnit: next, portionUnit: next, nutritionBasis: initial, weight: initial, conversion: '', unitConversions: {}, calories: '', protein: '', carbs: '', fat: '', microValues: {} })
  }
  const changeConversion = (text: string) => {
    const conversions = { ...value.unitConversions }
    const ratio = Number(text)
    if (Number.isFinite(ratio) && ratio > 0) conversions[portionUnit] = ratio
    else delete conversions[portionUnit]
    onChange({ conversion: text, unitConversions: conversions })
  }

  return (
    <View className='custom-food-panel custom-food-editor' id='custom-food-editor'>
      <View className='custom-food-header'>
        <Text className='custom-food-title'>{editing ? '编辑自定义食物' : '新建自定义食物'}</Text>
        <Text className='custom-food-close' onClick={onCollapse}>收起</Text>
      </View>

      <View className='custom-food-grid'>
        <View className='custom-field custom-field-full'>
          <Text className='custom-field-label'>食物名称</Text>
          <Input
            className='custom-field-input'
            value={value.name}
            placeholder='例如 家里卤牛肉'
            onInput={(event) => onChange({ name: event.detail.value })}
          />
        </View>
        <View className='custom-field custom-field-full custom-editor-basis'>
          <Text className='custom-field-label'>以下营养对应</Text>
          <Input
            className='custom-field-input custom-editor-basis-input'
            type='digit'
            value={value.nutritionBasis}
            onInput={(event) => onChange({ nutritionBasis: event.detail.value })}
          />
          <Text className='custom-editor-unit'>{basisLabel}</Text>
        </View>
        <View className='custom-basis-presets custom-field-full custom-editor-unit-options'>
          {FOOD_MEASURE_UNITS.map((unit) => (
            <View key={unit} className={`custom-basis-chip ${basisUnit === unit ? 'active' : ''}`} onClick={() => void changeBasisUnit(unit)}>
              <Text>{foodMeasureUnitLabel(unit)}</Text>
            </View>
          ))}
        </View>
        <View className='custom-field custom-field-full'>
          <View className='custom-energy-label-row'>
            <Text className='custom-field-label'>热量</Text>
            <View className='custom-energy-unit-switch'>
              {(['kj', 'kcal'] as const).map((unit) => (
                <View
                  key={unit}
                  className={`custom-energy-unit ${value.energyUnit === unit ? 'active' : ''}`}
                  onClick={() => onChange({ energyUnit: unit })}
                >
                  <Text>{unit === 'kj' ? 'kJ' : 'kcal'}</Text>
                </View>
              ))}
            </View>
          </View>
          <Input
            className='custom-field-input'
            type='digit'
            value={value.calories}
            placeholder='填写已知热量'
            onInput={(event) => onChange({ calories: event.detail.value })}
          />
          {value.energyUnit === 'kj' && <Text className='custom-energy-hint'>保存时自动换算为 kcal</Text>}
        </View>
      </View>

      <View className='custom-editor-portion' onClick={() => setShowPortion((shown) => !shown)}>
        <View className='custom-editor-toggle-copy'>
          <Text className='custom-editor-portion-title'>每份大小（可自定）</Text>
          <Text className='custom-editor-summary'>保存后默认一份：{value.weight || '—'}{portionLabel}{portionUnit !== basisUnit && value.conversion ? `（1${portionLabel}=${value.conversion}${basisLabel}）` : ''}</Text>
        </View>
        <Text className='custom-editor-portion-action'>{showPortion ? '收起' : '调整'}</Text>
      </View>
      {showPortion && (
        <View className='custom-editor-portion-settings'>
          <View className='custom-food-grid'>
            <View className='custom-field custom-field-full'>
              <Text className='custom-field-label'>默认一份数量 {portionLabel}</Text>
              <Input className='custom-field-input' type='digit' value={value.weight} onInput={(event) => onChange({ weight: event.detail.value })} />
            </View>
            <View className='custom-basis-presets custom-field-full custom-editor-unit-options'>
              {FOOD_MEASURE_UNITS.map((unit) => (
                <View key={unit} className={`custom-basis-chip ${portionUnit === unit ? 'active' : ''}`} onClick={() => { setShowPackageCalculator(false); onChange({ portionUnit: unit, weight: unit === basisUnit ? value.nutritionBasis : unit === 'piece' || unit === 'serving' ? '1' : '100', conversion: String(value.unitConversions?.[unit] || '') }) }}>
                  <Text>{foodMeasureUnitLabel(unit)}</Text>
                </View>
              ))}
            </View>
            {portionUnit !== basisUnit && (
              <View className='custom-field custom-field-full'>
                <Text className='custom-field-label'>1{portionLabel}相当于多少{basisLabel}</Text>
                <Input className='custom-field-input' type='digit' value={value.conversion || ''} placeholder='填写已知换算关系' onInput={(event) => changeConversion(event.detail.value)} />
              </View>
            )}
          </View>
          {canCalculatePortion && (
            <View className='custom-editor-package-calculator'>
              <Text className='custom-editor-portion-action' onClick={() => setShowPackageCalculator((shown) => !shown)}>{showPackageCalculator ? '收起整包计算' : '按整包计算每份大小'}</Text>
              {showPackageCalculator && (
                <View className='custom-food-grid'>
                  <View className='custom-field'>
                    <Text className='custom-field-label'>整包总量 {basisLabel}</Text>
                    <Input className='custom-field-input' type='digit' aria-label={`整包总量${basisLabel}`} value={packageQuantity} placeholder='例如 90' onInput={(event) => setPackageQuantity(event.detail.value)} />
                  </View>
                  <View className='custom-field'>
                    <Text className='custom-field-label'>一包有多少{portionLabel}</Text>
                    <Input className='custom-field-input' type='digit' aria-label={`一包有多少${portionLabel}`} value={portionCount} placeholder='例如 15' onInput={(event) => setPortionCount(event.detail.value)} />
                  </View>
                  <View className='custom-editor-package-result custom-field-full'>
                    <Text>{calculatedPortion === null ? '填写总量和数量，计算每份大小' : `1${portionLabel} = ${calculatedPortion}${basisLabel}`}</Text>
                    <View className={`custom-editor-package-apply ${calculatedPortion === null ? 'disabled' : ''}`} onClick={() => {
                      if (calculatedPortion === null) return
                      onChange({ weight: '1', conversion: String(calculatedPortion), unitConversions: { ...value.unitConversions, [portionUnit]: calculatedPortion } })
                      setShowPackageCalculator(false)
                    }}
                    ><Text>设为默认一份</Text></View>
                  </View>
                </View>
              )}
            </View>
          )}
        </View>
      )}

      <View className='custom-more-toggle custom-editor-toggle' onClick={() => setShowNutrition((shown) => !shown)}>
        <View className='custom-editor-toggle-copy'>
          <Text>补充营养（选填）</Text>
          {hasNutrition && <Text className='custom-editor-summary'>{[macroSummary, microCount ? `${microCount}项其他营养` : ''].filter(Boolean).join(' · ')}</Text>}
        </View>
        <Text className='custom-more-arrow'>{showNutrition ? '收起' : '展开'}</Text>
      </View>
      {showNutrition && (
        <View>
          <View className='custom-food-grid'>
            {MACRO_FIELDS.map(({ key, label }) => (
              <View className='custom-field' key={key}>
                <Text className='custom-field-label'>{label} g / 每{value.nutritionBasis || '—'}{basisLabel}</Text>
                <Input
                  className='custom-field-input'
                  type='digit'
                  value={value[key]}
                  placeholder='可不填'
                  onInput={(event) => onChange({ [key]: event.detail.value })}
                />
              </View>
            ))}
          </View>
          <View className='custom-editor-micro-toggle' onClick={() => setShowMicro((shown) => !shown)}>
            <Text>维生素 / 矿物质（选填）</Text>
            <Text>{showMicro ? '收起' : '展开'}</Text>
          </View>
          {showMicro && (
            <View className='custom-food-grid custom-micro-grid'>
              {microFields.map((field) => (
                <View className='custom-field' key={field.key}>
                  <Text className='custom-field-label'>{field.label} {field.unit} / 每{value.nutritionBasis || '—'}{basisLabel}</Text>
                  <Input
                    className='custom-field-input'
                    type='digit'
                    value={value.microValues[field.key] || ''}
                    placeholder='可不填'
                    onInput={(event) => onMicroChange(field.key, event.detail.value)}
                  />
                </View>
              ))}
            </View>
          )}
        </View>
      )}

      <View className='custom-more-toggle custom-editor-toggle' onClick={() => setShowSettings((shown) => !shown)}>
        <View className='custom-editor-toggle-copy'>
          <Text>照片与更多设置</Text>
          {(value.images.length > 0 || value.category === 'snack') && (
            <Text className='custom-editor-summary'>{[value.images.length ? `${value.images.length}张照片` : '', value.category === 'snack' ? '归入零食' : ''].filter(Boolean).join(' · ')}</Text>
          )}
        </View>
        <Text className='custom-more-arrow'>{showSettings ? '收起' : '展开'}</Text>
      </View>
      {showSettings && (
        <View>
          <View className='custom-image-row'>
            <View className='custom-image-preview' onClick={onChooseImages}>
              {value.images[0] ? (
                <Image className='custom-image' src={value.images[0]} mode='aspectFill' />
              ) : (
                <View className='custom-image-empty'>
                  {imageUploading ? <View className='custom-image-spinner' /> : <Text className='iconfont icon-xiangji' />}
                </View>
              )}
            </View>
            <View className='custom-image-actions'>
              <Text className='custom-image-title'>食物照片 · {value.images.length}/4</Text>
              <View className='custom-image-buttons'>
                <View className={`custom-image-btn ${imageUploading ? 'disabled' : ''}`} onClick={() => !imageUploading && onChooseImages()}>
                  {imageUploading ? <View className='custom-image-btn-spinner' /> : <Text>添加照片</Text>}
                </View>
                {!editing && (
                  <View className={`custom-image-import ${importing ? 'disabled' : ''}`} onClick={() => !importing && onImportPackage()}>
                    <Text>{value.images.length ? '识别这些照片' : '拍包装导入'}</Text>
                  </View>
                )}
                {value.images.length > 0 && <View className='custom-image-remove' onClick={() => onChange({ images: [] })}><Text>移除</Text></View>}
              </View>
            </View>
          </View>
          <View className='custom-photo-list'>
            {value.images.map((url, index) => (
              <View className='custom-photo-thumb' key={url}>
                <Image src={url} mode='aspectFill' onClick={() => onPreviewImage(url)} />
                <Text className='custom-photo-delete' onClick={() => onChange({ images: value.images.filter((_, position) => position !== index) })}>×</Text>
              </View>
            ))}
          </View>
          <View className='custom-food-grid'>
            <View className='custom-basis-presets custom-editor-category custom-field-full'>
              <Text className='custom-field-label'>归类</Text>
              {([{ key: 'custom', label: '自定义' }, { key: 'snack', label: '零食' }] as const).map(({ key, label }) => (
                <View key={key} className={`custom-basis-chip ${value.category === key ? 'active' : ''}`} onClick={() => onChange({ category: key })}>
                  <Text>{label}</Text>
                </View>
              ))}
            </View>
          </View>
        </View>
      )}

      {importing ? <View className='custom-import-status'><View className='custom-import-spinner' /></View> : importNote ? <View className='custom-import-status'><Text>{importNote}</Text></View> : null}

      <View className='custom-food-actions'>
        <View className='custom-food-secondary' onClick={() => !saving && onCancel()}><Text>取消</Text></View>
        <View className={`custom-food-primary ${busy ? 'custom-editor-save-disabled' : ''}`} onClick={() => !busy && onSave()}>
          {saving ? <View className='custom-image-btn-spinner' /> : <Text>{editing ? '保存修改' : '保存食物'}</Text>}
        </View>
      </View>
    </View>
  )
}
