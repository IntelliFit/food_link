import { Image, ScrollView, Text, View } from '@tarojs/components'
import Taro, { useRouter, useShareAppMessage } from '@tarojs/taro'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import {
  bindMarketingQRUser,
  getAccessToken,
  getMarketingQRLanding,
  trackMarketingQREvent,
  type MarketingQRLanding,
} from '../../../utils/api'
import { withAuth } from '../../../utils/withAuth'
import { extraPkgUrl } from '../../../utils/subpackage-extra'
import { getOrCreateMarketingVisitorID } from '../../../utils/marketing-qr'
import './index.scss'

function formatPrice(data: MarketingQRLanding): string {
  const min = Number(data.price_min || 0)
  const max = Number(data.price_max || 0)
  if (min <= 0 && max <= 0) return ''
  if (max > min) return `¥${min.toFixed(2).replace(/\.00$/, '')}–${max.toFixed(2).replace(/\.00$/, '')}`
  return `¥${(min || max).toFixed(2).replace(/\.00$/, '')}`
}

function LandingSkeleton() {
  return (
    <View className='marketing-landing marketing-landing--skeleton'>
      <View className='landing-skeleton landing-skeleton--hero' />
      <View className='landing-skeleton landing-skeleton--title' />
      <View className='landing-skeleton landing-skeleton--line' />
      <View className='landing-skeleton landing-skeleton--card' />
    </View>
  )
}

function MarketingLandingPage() {
  const router = useRouter()
  const code = String(router.params?.code || '').trim().toLowerCase()
  const visitorID = useMemo(() => getOrCreateMarketingVisitorID(), [])
  const trackedRef = useRef(false)
  const [data, setData] = useState<MarketingQRLanding | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    if (!code) {
      setError('二维码参数无效，请重新扫码')
      setLoading(false)
      return
    }
    setLoading(true)
    setError('')
    try {
      const landing = await getMarketingQRLanding(code)
      setData(landing)
      if (!trackedRef.current) {
        trackedRef.current = true
        void trackMarketingQREvent(code, visitorID, 'landing_view', {
          page: 'marketing-landing',
          kind: landing.kind,
        }).catch((trackError) => console.error('[marketing-qr] 访问统计失败', trackError))
      }
      if (getAccessToken()) {
        void bindMarketingQRUser(code, visitorID)
          .catch((bindError) => console.error('[marketing-qr] 用户归因绑定失败', bindError))
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '页面加载失败，请稍后重试')
    } finally {
      setLoading(false)
    }
  }, [code, visitorID])

  useEffect(() => {
    void load()
  }, [load])

  useShareAppMessage(() => ({
    title: data?.kind === 'product' ? `${data.title}｜食探营养信息` : '用食探看懂这一餐',
    path: `${extraPkgUrl('/pages/marketing-landing/index')}?code=${encodeURIComponent(code)}`,
    imageUrl: data?.image_url,
  }))

  const handlePrimaryAction = async () => {
    if (!data) return
    if (getAccessToken()) {
      await bindMarketingQRUser(code, visitorID).catch(() => undefined)
      Taro.switchTab({ url: '/pages/index/index' })
      return
    }
    await trackMarketingQREvent(code, visitorID, 'register_click', {
      page: 'marketing-landing',
      kind: data.kind,
    }).catch(() => undefined)
    const redirect = `${extraPkgUrl('/pages/marketing-landing/index')}?code=${encodeURIComponent(code)}`
    Taro.navigateTo({
      url: `${extraPkgUrl('/pages/login/index')}?redirect=${encodeURIComponent(redirect)}`,
    })
  }

  const openLocation = () => {
    if (!data?.latitude || !data?.longitude) return
    Taro.openLocation({
      latitude: Number(data.latitude),
      longitude: Number(data.longitude),
      name: data.branch_name || data.merchant_name || data.title,
      address: data.address || '',
      scale: 18,
    })
  }

  if (loading) return <LandingSkeleton />
  if (error || !data) {
    return (
      <View className='marketing-landing marketing-landing--error'>
        <Text className='landing-error-title'>暂时无法打开</Text>
        <Text className='landing-error-copy'>{error || '二维码信息不存在'}</Text>
        <View className='landing-retry' onClick={() => void load()}>重新加载</View>
      </View>
    )
  }

  const isProduct = data.kind === 'product'
  const price = formatPrice(data)
  return (
    <ScrollView className='marketing-landing-scroll' scrollY>
      <View className={`marketing-landing ${isProduct ? 'marketing-landing--product' : 'marketing-landing--takeout'}`}>
        <View className='landing-brand'>食探 · HealthyMax</View>

        {isProduct ? (
          <>
            <View className='landing-product-visual'>
              {data.image_url ? (
                <Image className='landing-product-image' src={data.image_url} mode='aspectFill' />
              ) : (
                <View className='landing-product-placeholder'>三生晓</View>
              )}
              <View className='landing-estimate-badge'>营养估算</View>
            </View>
            <View className='landing-heading-row'>
              <View className='landing-heading-copy'>
                <Text className='landing-category'>{data.category}</Text>
                <Text className='landing-title'>{data.title}</Text>
                <Text className='landing-subtitle'>{data.subtitle}</Text>
              </View>
              {price ? <Text className='landing-price'>{price}</Text> : null}
            </View>

            {data.nutrition ? (
              <View className='landing-nutrition-card'>
                <View className='landing-calorie'>
                  <Text className='landing-calorie-value'>{Math.round(data.nutrition.calories_kcal)}</Text>
                  <Text className='landing-calorie-unit'>kcal / 杯</Text>
                </View>
                <View className='landing-macros'>
                  <View className='landing-macro'><Text>{data.nutrition.protein_g}</Text><Text>蛋白质 g</Text></View>
                  <View className='landing-macro'><Text>{data.nutrition.carbs_g}</Text><Text>碳水 g</Text></View>
                  <View className='landing-macro'><Text>{data.nutrition.fat_g}</Text><Text>脂肪 g</Text></View>
                </View>
              </View>
            ) : null}

            <View className='landing-notice'>
              <Text className='landing-notice-title'>估算说明</Text>
              <Text className='landing-notice-copy'>{data.nutrition_notice}</Text>
            </View>

            <View className='landing-store-card' onClick={openLocation}>
              <View>
                <Text className='landing-store-name'>{data.merchant_name} · {data.branch_name}</Text>
                <Text className='landing-store-address'>{data.address}</Text>
                {data.location_is_estimated ? <Text className='landing-location-note'>当前位置为校园近似点，后续会校正</Text> : null}
              </View>
              <Text className='landing-store-action'>查看位置</Text>
            </View>
          </>
        ) : (
          <View className='takeout-hero'>
            <View className='takeout-orbit takeout-orbit--one' />
            <View className='takeout-orbit takeout-orbit--two' />
            <Text className='takeout-kicker'>从这一餐开始</Text>
            <Text className='takeout-title'>{data.title}</Text>
            <Text className='takeout-subtitle'>{data.subtitle}</Text>
            <View className='takeout-features'>
              <Text>拍照识别</Text><Text>营养记录</Text><Text>下一餐建议</Text>
            </View>
          </View>
        )}

        <View className='landing-primary-action' onClick={() => void handlePrimaryAction()}>
          {getAccessToken() ? '进入食探' : data.call_to_action}
        </View>
        <Text className='landing-footnote'>本页面仅提供饮食信息参考，不替代医疗建议</Text>
      </View>
    </ScrollView>
  )
}

export default withAuth(MarketingLandingPage, { public: true })
