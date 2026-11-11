import { useState } from 'react'
import Taro, { useDidShow } from '@tarojs/taro'
import { Button, Input, Text, View } from '@tarojs/components'
import { ACCOUNT_DELETION_COPY as copy, formatDeletionTime, type AccountDeletionStatus } from '@food-link/core'
import { cancelAccountDeletion, clearAllStorage, deleteAccount, getAccountDeletionStatus, showUnifiedApiError } from '../../../utils/api'
import { extraPkgUrl } from '../../../utils/subpackage-extra'
import { withAuth } from '../../../utils/withAuth'
import { FlPageThemeRoot } from '../../../components/FlPageThemeRoot'
import './index.scss'

function AccountDeletionPage() {
  const [status, setStatus] = useState<AccountDeletionStatus | null>(null)
  const [failed, setFailed] = useState(false)
  const [days, setDays] = useState<0 | 7>(7)
  const [confirmation, setConfirmation] = useState('')
  const [busy, setBusy] = useState(false)
  const load = async () => {
    try { setFailed(false); setStatus(await getAccountDeletionStatus()) }
    catch { setFailed(true) }
  }
  useDidShow(() => { void load() })
  const request = async () => {
    if (busy || confirmation.trim() !== '注销账号') return
    if (days === 0) {
      const result = await Taro.showModal({ title: '跳过冷静期？', content: '确认后即进入永久清理，无法撤销。', confirmText: '立即注销', confirmColor: '#dc2626' })
      if (!result.confirm) return
    }
    setBusy(true)
    try {
      const result = await deleteAccount(confirmation.trim(), days)
      setStatus(result.status)
      await Taro.reLaunch({ url: extraPkgUrl('/pages/account-deletion/index') })
    } catch (error) { await showUnifiedApiError(error, '申请失败，请重试') }
    finally { setBusy(false) }
  }
  const cancel = async () => {
    const result = await Taro.showModal({ title: '撤销注销并恢复账号？', content: '原有记录将保留，恢复后请重新登录。', confirmText: '撤销注销' })
    if (!result.confirm || busy) return
    setBusy(true)
    try {
      await cancelAccountDeletion()
      await Taro.reLaunch({ url: extraPkgUrl('/pages/login/index') })
    } catch (error) { await showUnifiedApiError(error, '撤销失败'); await load() }
    finally { setBusy(false) }
  }
  const close = () => { clearAllStorage(); void Taro.reLaunch({ url: '/pages/index/index' }) }
  const active = status?.state === 'active' || status?.state === 'cancelled'
  return <FlPageThemeRoot><View className='account-deletion-page'>
    <Text className='account-deletion-title'>{!status || active ? copy.title : status.state === 'completed' ? copy.completed : status.state === 'cleaning' ? copy.cleaning : copy.pending}</Text>
    {failed ? <View className='account-deletion-card'><Text>暂时无法读取注销状态</Text><Button onClick={load}>重试</Button></View> : !status ? <View className='account-deletion-spinner' /> : active ? <>
      <View className='account-deletion-card'><Text>{copy.warning}</Text><Text>{copy.rights}</Text></View>
      <Button className={`account-deletion-choice ${days === 7 ? 'selected' : ''}`} onClick={() => setDays(7)}>{days === 7 ? '● ' : '○ '}{copy.cooling}</Button>
      <Button className={`account-deletion-choice ${days === 0 ? 'selected' : ''}`} onClick={() => setDays(0)}>{days === 0 ? '● ' : '○ '}{copy.immediate}</Button>
      <Text className='account-deletion-note'>{days === 7 ? copy.note : '确认后无法撤销，请先保存需要的记录。'}</Text>
      <Input className='account-deletion-input' value={confirmation} placeholder='输入“注销账号”确认' onInput={e => setConfirmation(e.detail.value)} />
      <Button className='account-deletion-danger' disabled={busy || confirmation.trim() !== '注销账号'} onClick={request}>{busy ? <View className='account-deletion-spinner' /> : days === 7 ? '申请注销，保留 7 天撤销机会' : '确认立即注销'}</Button>
    </> : <>
      <View className='account-deletion-card'>
        {status.state === 'pending' && <><Text>永久清理时间：{formatDeletionTime(status.execute_at)}</Text><Text>{copy.note}</Text></>}
        {status.state === 'cleaning' && <Text>账号已停用，数据清理完成前将保持此状态。此时无法撤销。</Text>}
        {status.state === 'completed' && <Text>个人记录已清理，原账号无法恢复。必要凭证与共享资料按规则单独处理。</Text>}
      </View>
      {status.can_cancel && <Button className='account-deletion-restore' disabled={busy} onClick={cancel}>{busy ? <View className='account-deletion-spinner' /> : '撤销注销并恢复账号'}</Button>}
      <Button onClick={load}>刷新状态</Button><Button onClick={close}>退出登录</Button>
    </>}
  </View></FlPageThemeRoot>
}
export default withAuth(AccountDeletionPage)
