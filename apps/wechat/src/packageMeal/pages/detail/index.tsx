import { View, Text, Input, Button, Canvas } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { useRef, useState } from 'react'
import { showUnifiedApiError } from '../../../utils/api'
import { MEAL_REPORT_REASONS, mealBudgetLabel, mealPath, mealRequest, mealRequestKey, mealStatus, mealWhen } from '../../../utils/meal-meetup'
import { useMealDetail } from '../../use-detail'
import { useMealInvitation } from '../../use-invitation'
import '../../common.scss'

export default function MealDetail() {
  const { id, row, loading, error, reload } = useMealDetail()
  const invitation = useMealInvitation(row, loading || Boolean(error))
  const justCreated = Taro.getCurrentInstance().router?.params.created === '1'
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const applying = useRef(false)
  const applyKey = useRef(mealRequestKey())
  const act = async (path: string, data: Record<string, unknown> = {}, confirm?: string) => {
    if (applying.current) return
    applying.current = true; setBusy(true)
    try {
      if (confirm) { const answer = await Taro.showModal({ title: '确认操作', content: confirm }); if (!answer.confirm) return }
      await mealRequest(`/${id}${path}`, 'POST', data)
      if (path === '/applications') applyKey.current = mealRequestKey()
      if (path === '/reports') void Taro.showToast({ title: '已提交举报', icon: 'none' })
      await reload()
    } catch (e) { void showUnifiedApiError(e) }
    finally { applying.current = false; setBusy(false) }
  }
  const report = async () => {
    const choice = await Taro.showActionSheet({ itemList: MEAL_REPORT_REASONS.map((r) => r.label) }).catch(() => undefined)
    if (choice) await act('/reports', { reason: MEAL_REPORT_REASONS[choice.tapIndex].value })
  }
  return <View className='meal-page'>
    {loading && !row && <View className='meal-spinner' />}
    {error && <View className='meal-error'><Text>{error}</Text><Button onClick={() => { void reload() }}>重试</Button><Button onClick={() => { void Taro.navigateTo({ url: mealPath('mine') }) }}>我的约饭</Button>{/^[0-9a-f-]{36}$/i.test(id) && <Button disabled={busy} onClick={() => { void report() }}>举报这场约饭</Button>}</View>}
    {row && <>
      <Text className='meal-page-title'>{row.title}</Text>
      <View className='meal-panel meal-invite-card'>
        <Text className='meal-invite-eyebrow'>{invitation ? (justCreated && row.is_host ? '约饭已发布 · 喊朋友一起吃' : '约饭邀请单') : '约饭信息'}</Text>
        <Text className='meal-title'>{mealWhen(row.starts_at)} · 北京时间</Text><Text className='meal-copy'>{row.venue_name}</Text><Text className='meal-muted'>{row.address}</Text><Text className='meal-copy'>{mealBudgetLabel(row)}</Text><Text className='meal-muted'>共{row.capacity}人，含发起人 · 预计至 {mealWhen(row.ends_at).slice(-5)}</Text><Text className='meal-state'>{mealStatus[row.status]} · {row.member_count}/{row.capacity}人</Text>
        {row.latitude != null && row.longitude != null && <Button className='meal-secondary' onClick={() => { void Taro.openLocation({ latitude: row.latitude!, longitude: row.longitude!, name: row.venue_name, address: row.address }).catch((e) => showUnifiedApiError(e)) }}>查看地点</Button>}
        {invitation && <View className='meal-invite-actions'>
          <Text className='meal-invite-places'>{invitation.places}</Text>
          <Button className='meal-primary meal-invite-share' openType='share'>邀请好友 / 群聊</Button>
          <Button className='meal-invite-copy' onClick={() => { void Taro.setClipboardData({ data: invitation.text }).catch((e) => showUnifiedApiError(e)) }}>复制邀请文案</Button>
          <Text className='meal-muted'>转发约饭卡片，对方点开申请，同意后一起吃。</Text>
        </View>}
        {!loading && !error && !invitation && <Text className='meal-muted'>这场约饭暂不接受新邀请。</Text>}
      </View>
      <View className='meal-panel'><Text className='meal-title'>{row.host.nickname} 发起</Text><Text className='meal-copy'>{row.description || '一起吃一顿饭，轻松聊聊。'}</Text><Text className='meal-muted'>请在公共餐厅或食堂见面，校内地点请提前确认通行要求。</Text></View>
      {row.members.length > 0 && <View className='meal-panel'><Text className='meal-title'>这顿饭的搭子</Text><View className='meal-members'>{row.members.map((p) => <Text key={p.user_id}>{p.nickname}{p.user_id === row.host.user_id ? ' · 发起人' : ''}</Text>)}</View></View>}
      {row.is_host && ['active', 'full'].includes(row.status) && (row.managed_members || []).map((p) => <View className='meal-panel' key={p.user_id}><View className='meal-row'><Text>{p.nickname} · 已加入</Text><Button className='meal-secondary' disabled={busy} onClick={() => { void act(`/applications/${p.user_id}/respond`, { action: 'remove', revision: p.revision }, `将${p.nickname}移出约饭？名额将释放，对方的房间访问将关闭。`) }}>移出成员</Button></View></View>)}
      {row.own_status === 'pending' && <Text className='meal-state'>申请已提交，等待发起人确认。待确认不占名额。</Text>}
      {['rejected', 'withdrawn', 'left', 'removed'].includes(row.own_status) && <Text className='meal-state'>{mealStatus[row.own_status]}</Text>}
      {!row.is_host && ['none', 'left', 'withdrawn'].includes(row.own_status) && row.status === 'active' && <View className='meal-panel'><Text className='meal-label'>给发起人留句话（可选）</Text><Input className='meal-field meal-input' value={note} maxlength={240} placeholder='如：同校同学，午休想一起吃' onInput={(e) => { if (note !== e.detail.value) applyKey.current = mealRequestKey(); setNote(e.detail.value) }} /><Button className='meal-primary' disabled={busy} onClick={() => { void act('/applications', { request_id: applyKey.current, note }) }}>申请一起吃</Button><Text className='meal-muted'>{row.payment === 'host_treat' ? '本场发起人请客，请准时赴约，临时有事请提前退出。' : '发起人同意后才能进入房间。'}你的私人饮食和健康数据不会公开。</Text></View>}
      {row.is_host && (row.applications || []).filter((p) => p.status === 'pending').map((p) => <View className='meal-panel' key={p.user_id}><Text className='meal-title'>{p.nickname} 想一起吃</Text><Text className='meal-copy'>{p.note || '没有留言'}</Text><View className='meal-row'><Button className='meal-secondary' disabled={busy || !['active', 'full'].includes(row.status)} onClick={() => { void act(`/applications/${p.user_id}/respond`, { action: 'reject', revision: p.revision }) }}>婉拒</Button><Button className='meal-primary' disabled={busy || row.status !== 'active'} onClick={() => { void act(`/applications/${p.user_id}/respond`, { action: 'accept', revision: p.revision }) }}>同意加入</Button></View></View>)}
      {row.can_enter_room && <Button className='meal-primary' onClick={() => { void Taro.navigateTo({ url: mealPath('room', id) }) }}>进入约饭房间</Button>}
      {['pending', 'accepted'].includes(row.own_status) && !['ended'].includes(row.status) && <Button className='meal-secondary' disabled={busy} onClick={() => { void act('/leave', { revision: row.own_revision }, row.own_status === 'pending' ? '撤回这条申请？' : '退出后将释放名额，并关闭房间访问。') }}>{row.own_status === 'pending' ? '撤回申请' : '退出约饭'}</Button>}
      {row.is_host && ['active', 'full', 'started'].includes(row.status) && <Button className='meal-danger' disabled={busy} onClick={() => { void act('/cancel', {}, '取消后会通知申请者和已加入成员，房间停止新留言。') }}>取消约饭</Button>}
      <Button className='meal-secondary' disabled={busy} onClick={() => { void report() }}>举报这场约饭</Button>
    </>}
    <Canvas type='2d' id='mealInvitationCanvas' className='meal-invite-canvas' />
  </View>
}
