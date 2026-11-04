import { Image, Input, Text, View } from '@tarojs/components'
import { useCallback, useState } from 'react'
import Taro, { useDidShow } from '@tarojs/taro'
import { useAppColorScheme } from '../../../components/AppColorSchemeContext'
import { applyThemeNavigationBar } from '../../../utils/theme-navigation-bar'
import { getAccessToken, showUnifiedApiError } from '../../../utils/api'
import {
  archiveResearchContainer,
  createResearchContainer,
  listResearchContainers,
  type ResearchContainer,
  type SavedResearchContainer,
} from '../../../utils/research-weight-api'
import { CONTAINERS, parseGrams, type DraftPhoto } from '../research-weight/model'
import { ensureLoggedIn, takeResearchPhoto } from '../research-weight/media'
import { Chips, Field } from '../research-weight/controls'
import { PhotoSlot } from '../research-weight/photo-slot'
import './index.scss'

const TYPE_LABELS = CONTAINERS.reduce<Record<string, string>>((labels, item) => ({ ...labels, [item.key]: item.label }), {})

/** 我的常用容器：空盒、空碗称一次存下来，以后记一顿时直接选。 */
export default function ResearchWeightContainersPage() {
  const { scheme } = useAppColorScheme()
  const [items, setItems] = useState<SavedResearchContainer[]>([])
  const [name, setName] = useState('')
  const [containerType, setContainerType] = useState<ResearchContainer>('box')
  const [grams, setGrams] = useState('')
  const [photo, setPhoto] = useState<DraftPhoto | undefined>()
  const [uploading, setUploading] = useState(false)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    if (!getAccessToken()) return
    try {
      setItems(await listResearchContainers())
    } catch (error) {
      await showUnifiedApiError(error, '常用容器加载失败')
    }
  }, [])

  useDidShow(() => {
    applyThemeNavigationBar(scheme)
    void load()
  })

  const pickPhoto = async () => {
    if (!ensureLoggedIn()) return
    const next = await takeResearchPhoto(() => setUploading(true))
    setUploading(false)
    if (next) setPhoto(next)
  }

  const weight = parseGrams(grams)
  const problem = !name.trim() ? '给容器起个名字' : weight === null || weight <= 0 ? '填空容器的读数' : !photo ? '拍空容器放在秤上的读数' : ''

  const save = async () => {
    if (saving || uploading) return
    if (problem || !photo || weight === null) {
      Taro.showToast({ title: problem, icon: 'none' })
      return
    }
    setSaving(true)
    try {
      const created = await createResearchContainer({ name: name.trim(), container_type: containerType, grams: weight, photo_url: photo.url })
      setItems((current) => [created, ...current])
      setName('')
      setGrams('')
      setPhoto(undefined)
      Taro.showToast({ title: '已保存', icon: 'success' })
    } catch (error) {
      await showUnifiedApiError(error, '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const archive = async (item: SavedResearchContainer) => {
    const { confirm } = await Taro.showModal({ title: '停用这个容器', content: `「${item.name}」以后不再出现在选择里，已提交的记录不受影响。` })
    if (!confirm) return
    try {
      await archiveResearchContainer(item.id)
      setItems((current) => current.filter((saved) => saved.id !== item.id))
    } catch (error) {
      await showUnifiedApiError(error, '停用失败')
    }
  }

  return (
    <View className={`research-weight-page ${scheme === 'dark' ? 'research-weight-page--dark' : ''}`}>
      <View className='rw-card'>
        <Text className='rw-card__title'>存一个新容器</Text>
        <Text className='rw-tip rw-tip--warn'>洗干净擦干、去掉盖子，空着放上秤，拍下读数。同款外卖盒存一个就够了。</Text>
        <Field label='名字'>
          <Input className='rw-input' value={name} maxlength={20} placeholder='如 750ml 圆盒、家里的白瓷碗' onInput={(e) => setName(e.detail.value)} />
        </Field>
        <Field label='类型'><Chips<ResearchContainer> small options={CONTAINERS} value={containerType} onChange={(key) => setContainerType(key)} /></Field>
        <View className='rw-reading'>
          <PhotoSlot label='空容器读数' required photo={photo} uploading={uploading} onPick={() => void pickPhoto()} onClear={() => setPhoto(undefined)} />
          <View className='rw-reading__value'>
            <Input className='rw-input' type='digit' value={grams} placeholder='空容器 g' onInput={(e) => setGrams(e.detail.value)} />
          </View>
        </View>
        <View className={`rw-submit rw-primary ${problem || saving ? 'rw-submit--disabled' : ''}`} onClick={() => void save()}>
          {saving ? <View className='loading-spinner' /> : <Text>保存</Text>}
        </View>
      </View>

      <View className='rw-card'>
        <Text className='rw-card__title'>已保存（{items.length}）</Text>
        {items.length === 0 ? <Text className='rw-library__empty'>还没有。也可以在记一顿称空盒时勾选「存为常用容器」。</Text> : null}
        {items.map((item) => (
          <View key={item.id} className='rw-saved'>
            <Image className='rw-saved__photo' src={item.photo_url} mode='aspectFill' onClick={() => Taro.previewImage({ urls: [item.photo_url] })} />
            <View className='rw-saved__copy'>
              <Text className='rw-saved__name'>{item.name}</Text>
              <Text className='rw-saved__meta'>{TYPE_LABELS[item.container_type] || '容器'} · {item.grams}g</Text>
            </View>
            <Text className='rw-saved__action' onClick={() => void archive(item)}>停用</Text>
          </View>
        ))}
      </View>
    </View>
  )
}
