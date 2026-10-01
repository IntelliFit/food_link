import { View, Text, Button } from '@tarojs/components'
import Taro, { useDidShow, useDidHide } from '@tarojs/taro'
import { useEffect, useRef, useState } from 'react'
import { getPetSummary, type PetProfile } from '../../../utils/api'
import { withAuth } from '../../../utils/withAuth'
import { PetKitchenGame } from '../../components/PetKitchenGame'
import './index.scss'

function PetKitchenPage() {
  const [pet, setPet] = useState<PetProfile | null>(null)
  const [active, setActive] = useState(true)
  const [error, setError] = useState(false)
  const [accountId, setAccountId] = useState('')
  const sequence = useRef(0)
  const load = async () => {
    const request = ++sequence.current
    setError(false)
    setPet(null)
    const userId = String(Taro.getStorageSync('user_id') || '')
    setAccountId(userId)
    try {
      const result = await getPetSummary()
      if (sequence.current === request) setPet(result.pet)
    } catch {
      if (sequence.current === request) setError(true)
    }
  }
  useDidShow(() => {
    setActive(true)
    if (!pet || String(Taro.getStorageSync('user_id') || '') !== accountId) void load()
  })
  useDidHide(() => { setActive(false); sequence.current += 1 })
  useEffect(() => () => { sequence.current += 1 }, [])

  return pet ? <PetKitchenGame active={active} pet={pet} accountId={accountId} onExit={() => {
    if (Taro.getCurrentPages().length > 1) void Taro.navigateBack()
    else void Taro.redirectTo({ url: '/packagePetStudio/pages/index/index' })
  }}
  /> : <View className='pet-kitchen-loading'>
    {error ? <><Text>暂时没能读取宠物档案</Text><Button onClick={() => void load()}>重新尝试</Button></> : <View className='pet-kitchen-loading-spinner' aria-label='正在读取宠物档案' />}
  </View>
}

export default withAuth(PetKitchenPage)
