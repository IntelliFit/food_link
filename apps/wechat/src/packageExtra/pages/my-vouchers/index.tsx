import { View, Text } from '@tarojs/components'
import Taro, { useDidShow, usePullDownRefresh } from '@tarojs/taro'
import { useState } from 'react'
import { getMyVouchers, useVoucher, type VoucherItem } from '../../../utils/api'
import { useAppColorScheme } from '../../../components/AppColorSchemeContext'

import './index.scss'

const TABS = [
  { key: '', label: '全部' },
  { key: 'pending', label: '可使用' },
  { key: 'used', label: '已使用' },
  { key: 'expired', label: '已过期' },
]

function MyVouchersPage() {
  const { scheme } = useAppColorScheme()
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('pending')
  const [items, setItems] = useState<VoucherItem[]>([])

  useDidShow(() => {
    loadData(activeTab)
  })

  usePullDownRefresh(() => {
    loadData(activeTab).finally(() => {
      Taro.stopPullDownRefresh()
    })
  })

  const loadData = async (status: string) => {
    setLoading(true)
    try {
      const res = await getMyVouchers(status || undefined)
      setItems(res.items || [])
    } catch (error: any) {
      console.error('[my-vouchers] load failed:', error)
      Taro.showToast({ title: error?.message || '加载失败', icon: 'none' })
    } finally {
      setLoading(false)
    }
  }

  const handleTabChange = (key: string) => {
    setActiveTab(key)
    loadData(key)
  }

  const handleUse = async (voucher: VoucherItem) => {
    if (voucher.status !== 'pending') return
    try {
      await useVoucher(voucher.id)
      Taro.showToast({ title: '领取成功', icon: 'success' })
      loadData(activeTab)
    } catch (error: any) {
      console.error('[my-vouchers] use failed:', error)
      Taro.showToast({ title: error?.message || '领取失败', icon: 'none' })
    }
  }

  return (
    <View className={`my-vouchers-page ${scheme === 'dark' ? 'my-vouchers-page--dark' : ''}`}>
      <View className='voucher-tabs'>
        {TABS.map(tab => (
          <View
            key={tab.key}
            className={`voucher-tab ${activeTab === tab.key ? 'voucher-tab--active' : ''}`}
            onClick={() => handleTabChange(tab.key)}
          >
            <Text className='voucher-tab__text'>{tab.label}</Text>
          </View>
        ))}
      </View>

      {loading ? (
        <View className='voucher-loading'>
          <View className='voucher-loading__spinner' />
        </View>
      ) : items.length === 0 ? (
        <View className='voucher-empty'>
          <Text className='voucher-empty__icon'>🎫</Text>
          <Text className='voucher-empty__text'>暂无礼券</Text>
        </View>
      ) : (
        <View className='voucher-list'>
          {items.map(voucher => (
            <View key={voucher.id} className={`voucher-card voucher-card--${voucher.status} voucher-card--${voucher.voucher_type}`}>
              <View className='voucher-card__main'>
                <Text className='voucher-card__title'>{voucher.title}</Text>
                {voucher.description ? (
                  <Text className='voucher-card__desc'>{voucher.description}</Text>
                ) : null}
                <Text className='voucher-card__validity'>{formatValidity(voucher)}</Text>
              </View>
              <View className='voucher-card__action'>
                {voucher.status === 'pending' ? (
                  <View className='voucher-card__button' onClick={() => handleUse(voucher)}>
                    <Text className='voucher-card__button-text'>去使用</Text>
                  </View>
                ) : (
                  <Text className='voucher-card__status'>{statusLabel(voucher.status)}</Text>
                )}
              </View>
            </View>
          ))}
        </View>
      )}
    </View>
  )
}

function formatValidity(voucher: VoucherItem): string {
  if (voucher.status === 'used' && voucher.used_at) {
    return `使用时间 ${formatDate(voucher.used_at)}`
  }
  if (voucher.valid_end_at) {
    return `有效期至 ${formatDate(voucher.valid_end_at)}`
  }
  return ''
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function statusLabel(status: string): string {
  switch (status) {
    case 'used':
      return '已使用'
    case 'expired':
      return '已过期'
    case 'cancelled':
      return '已取消'
    default:
      return status
  }
}

export default MyVouchersPage
