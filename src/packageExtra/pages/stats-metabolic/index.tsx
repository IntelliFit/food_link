import { View } from '@tarojs/components'
import { useRouter } from '@tarojs/taro'
import { withAuth } from '../../../utils/withAuth'
import { MetabolicDynamicsReport } from './metabolic-dynamics-report'

import './index.scss'

function StatsMetabolicPage() {
  const router = useRouter()
  const reportDate = (router.params?.date || '').trim() || undefined
  return (
    <View className='stats-metabolic-page'>
      <MetabolicDynamicsReport reportDate={reportDate} />
    </View>
  )
}

export default withAuth(StatsMetabolicPage)
