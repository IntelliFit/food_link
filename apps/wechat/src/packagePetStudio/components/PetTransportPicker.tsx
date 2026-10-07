import { Button, Text, View } from '@tarojs/components'
import { useState } from 'react'
import type { PetProfile } from '../../utils/api'
import { PetTransportActor } from '../../components/PetTransportActor'
import { PET_TRANSPORTS, defaultPetTransport, petTransportAppearance, petTransportCapabilities, type PetTransportId } from '../../utils/pet-transport'
import { readPetTransport, savePetTransport } from '../../utils/pet-transport-storage'
import { PetEntryIcon } from './PetEntryIcon'
import './PetTransportPicker.scss'

export function PetTransportPicker({ pet, sprite, account, active, canSave }: {
  pet: PetProfile; sprite?: string; account: string; active: boolean; canSave: () => boolean
}) {
  const capabilities = petTransportCapabilities(pet, sprite)
  const initial = () => {
    const choice = readPetTransport(pet.id, petTransportAppearance(pet, sprite), defaultPetTransport(pet, sprite))?.vehicle
    return choice && capabilities.includes(choice) ? choice : defaultPetTransport(pet, sprite)
  }
  const [saved, setSaved] = useState<PetTransportId>(initial)
  const [preview, setPreview] = useState<PetTransportId>(initial)
  const [notice, setNotice] = useState('')
  const [unavailable, setUnavailable] = useState(false)
  const [trial, setTrial] = useState(0)
  const selected = PET_TRANSPORTS.find(item => item.id === preview)!
  const confirm = () => {
    if (unavailable) { setNotice('这套动作暂不可用，请换个工具再试'); return }
    if (!active || !canSave() || !savePetTransport(pet, sprite, preview, account)) { setNotice('没有保存成功，请确认账号后重试'); return }
    setSaved(preview); setNotice(`已选择${selected.name}，下次首页出行时使用`)
  }
  return <View className='journey-transport' id='journey-transport'>
    <View className='journey-section-heading'><Text>出行工具</Text><Text className='journey-muted'>免费试骑 · 随时切换</Text></View>
    <View className='journey-transport__stage'>
      <View className='journey-transport__sun' />
      <View className='journey-transport__actor'><PetTransportActor key={`${pet.id}:${sprite}:${preview}:${trial}`} pet={pet} sprite={sprite} vehicle={preview} size={144} active={active} showGround onUnavailable={() => { setUnavailable(true); setNotice('这套动作暂不可用，已保留原形象。点工具重试，或先选散步。') }} /></View>
      <View className='journey-transport__caption'><Text>{pet.name} · {selected.name}</Text><Text>{selected.description}</Text></View>
    </View>
    <View className='journey-transport__choices'>{PET_TRANSPORTS.map(item => {
      const available = capabilities.includes(item.id)
      return <Button hoverClass='journey-button--pressed' hoverStartTime={20} hoverStayTime={80} id={`journey-transport-${item.id}`} key={item.id} className={`journey-button journey-transport__choice${preview === item.id ? ' is-selected' : ''}`} disabled={!available || !active} onClick={() => { setPreview(item.id); setUnavailable(false); setTrial(value => value + 1); setNotice('') }}>
        <PetEntryIcon name={item.id} /><Text>{item.name}</Text><Text>{!available ? '当前形象待适配' : saved === item.id ? '正在使用' : '试一试'}</Text>
      </Button>
    })}</View>
    <Button hoverClass='journey-button--pressed' hoverStartTime={20} hoverStayTime={80} id='journey-save-transport' className='journey-button journey-primary' disabled={!active || unavailable} onClick={confirm}>确认出行工具</Button>
    <Text className='journey-transport__note'>用于均衡模式首页的出发与返回。试骑不会扣星光，原来的衣装和成长都会保留。</Text>
    {preview !== 'walk' && <Text className='journey-transport__note'>骑行姿态暂不显示围巾，回到小屋后仍保留原穿搭。</Text>}
    {capabilities.length === 1 && <Text className='journey-transport__note'>照片伙伴先使用自己的散步动作，专属骑行姿态准备好后再开放工具。</Text>}
    {notice && <View id='journey-transport-notice' className='journey-transport__notice' role='status'><Text>{notice}</Text></View>}
  </View>
}
