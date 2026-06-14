import { View, Text, Button } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { useEffect, useState } from 'react'
import { FlPageThemeRoot } from '../../../components/FlPageThemeRoot'
import './index.scss'

const plans = [
  ['轻度版', '8 积分/日', '9.90', '27.90', '99.00', '轻量记录，不含精准模式'],
  ['标准版', '20 积分/日', '19.90', '56.90', '199.00', '含精准模式，适合日常使用'],
  ['进阶版', '40 积分/日', '29.90', '84.90', '299.00', '含精准模式，适合高频记录'],
]

const previewModalCopy = {
  sign: {
    title: '确认开通自动续费',
    lines: [
      '开通服务：食探会员 · 标准版年卡',
      '扣费周期：年卡',
      '每期金额：¥199.00/年',
      '开通后，会员到期前将按所选周期自动续费；扣费前会按微信支付规则通知。',
    ],
    confirmText: '确认',
  },
  cancel: {
    title: '关闭自动续费路径',
    lines: [
      '产品内路径：我的 → 食探会员 → 自动续费管理 → 关闭自动续费。',
      '也可在微信支付 → 扣费服务中关闭。',
      '关闭自动续费后，不影响已付费周期内会员权益。',
    ],
    confirmText: '知道了',
  },
}

type PreviewModalType = keyof typeof previewModalCopy

export default function AutoRenewAuditPage() {
  const [previewModal, setPreviewModal] = useState<PreviewModalType | null>(null)

  useEffect(() => {
    const modal = Taro.getCurrentInstance().router?.params?.modal
    if (modal === 'sign' || modal === 'cancel') {
      setPreviewModal(modal)
      return
    }

    const storedModal = Taro.getStorageSync('auto_renew_audit_modal')
    if (storedModal === 'sign' || storedModal === 'cancel') {
      Taro.removeStorageSync('auto_renew_audit_modal')
      setPreviewModal(storedModal)
    }
  }, [])

  const showSignPreview = () => {
    setPreviewModal('sign')
  }

  const showCancelPreview = () => {
    setPreviewModal('cancel')
  }

  const modalCopy = previewModal ? previewModalCopy[previewModal] : null

  return (
    <FlPageThemeRoot>
      <View className='audit-page'>
        <View className='audit-banner'>
          <Text className='audit-kicker'>食探会员服务</Text>
          <Text className='audit-title'>食探会员自动续费</Text>
          <Text className='audit-desc'>开通后可持续享受会员权益；到期前按所选周期自动续费，扣费前将按微信支付规则通知。</Text>
        </View>

        <View className='section'>
          <Text className='section-title'>服务内容介绍</Text>
          <View className='service-grid'>
            <Text className='service-item'>饮食记录</Text>
            <Text className='service-item'>AI 营养分析</Text>
            <Text className='service-item'>健康档案</Text>
            <Text className='service-item'>运动记录</Text>
            <Text className='service-item'>社区互动</Text>
            <Text className='service-item'>公共食物库</Text>
          </View>
        </View>

        <View className='section'>
          <Text className='section-title'>会员权益与价目表</Text>
          <View className='price-head'>
            <Text className='price-cell price-name'>档位</Text>
            <Text className='price-cell'>月卡</Text>
            <Text className='price-cell'>季卡</Text>
            <Text className='price-cell'>年卡</Text>
          </View>
          {plans.map((plan) => (
            <View className='price-row' key={plan[0]}>
              <View className='price-name-col'>
                <Text className='tier-name'>{plan[0]}</Text>
                <Text className='tier-credits'>{plan[1]}</Text>
              </View>
              <Text className='price-cell'>¥{plan[2]}</Text>
              <Text className='price-cell'>¥{plan[3]}</Text>
              <Text className='price-cell'>¥{plan[4]}</Text>
            </View>
          ))}
          <Text className='price-note'>标准版及进阶版支持精准模式；系统积分每日发放，次日刷新；奖励积分可累计。</Text>
        </View>

        <View className='section auto-card'>
          <Text className='section-title'>自动续费签约前说明</Text>
          <View className='info-row'>
            <Text className='info-label'>服务名称</Text>
            <Text className='info-value'>食探会员 · 标准版年卡</Text>
          </View>
          <View className='info-row'>
            <Text className='info-label'>扣费周期</Text>
            <Text className='info-value'>年卡</Text>
          </View>
          <View className='info-row'>
            <Text className='info-label'>每期金额</Text>
            <Text className='info-value price-strong'>¥199.00/年</Text>
          </View>
          <View className='info-row'>
            <Text className='info-label'>预计续费</Text>
            <Text className='info-value'>当前周期到期前按微信支付规则续费</Text>
          </View>
          <Text className='plain-text'>开通后，会员到期前将按所选周期自动续费；扣费前会按微信支付规则通知。用户可随时关闭自动续费，关闭后不影响已付费周期内权益。</Text>
          <View className='check-row'>
            <View className='checkbox'>✓</View>
            <Text className='check-text'>我已阅读并同意会员服务协议及自动续费规则</Text>
          </View>
          <Button className='primary-btn' onTap={showSignPreview}>确认开通自动续费</Button>
        </View>

        <View className='section cancel-card'>
          <Text className='section-title'>产品内取消续费路径</Text>
          <Text className='path-text'>我的 → 食探会员 → 自动续费管理 → 关闭自动续费</Text>
          <Text className='plain-text'>用户也可在微信支付 → 扣费服务中关闭。关闭自动续费后，不影响已付费周期内会员权益。</Text>
          <Button className='secondary-btn' onTap={showCancelPreview}>关闭自动续费</Button>
        </View>

        {modalCopy && (
          <View className='audit-modal-mask' onTap={() => setPreviewModal(null)}>
            <View className='audit-modal' onTap={(event) => event.stopPropagation()}>
              <Text className='audit-modal-title'>{modalCopy.title}</Text>
              <View className='audit-modal-body'>
                {modalCopy.lines.map((line) => (
                  <Text className='audit-modal-line' key={line}>{line}</Text>
                ))}
              </View>
              <Button className='audit-modal-btn' onTap={() => setPreviewModal(null)}>{modalCopy.confirmText}</Button>
            </View>
          </View>
        )}
      </View>
    </FlPageThemeRoot>
  )
}
