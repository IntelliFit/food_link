import { View } from '@tarojs/components'
import NutritionPlans from '../../../components/NutritionPlans'
import { useAppColorScheme } from '../../../components/AppColorSchemeContext'
import { withAuth } from '../../../utils/withAuth'

function NutritionPlansPage() {
  const { scheme } = useAppColorScheme()
  return <View className={scheme === 'dark' ? 'fl-d' : ''}><NutritionPlans manager /></View>
}
export default withAuth(NutritionPlansPage)
