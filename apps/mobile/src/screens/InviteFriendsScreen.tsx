import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, Image, Modal, Pressable, RefreshControl, ScrollView, Share, StyleSheet, Text, View, useWindowDimensions } from 'react-native'
import * as Clipboard from 'expo-clipboard'
import qrcode from 'qrcode-generator'
import { useFocusEffect } from '@react-navigation/native'
import type { NativeStackScreenProps } from '@react-navigation/native-stack'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { ArrowRight, CheckCircle2, Clock3, Copy, Gift, QrCode, RefreshCw, Share2, UserPlus, Users, X } from 'lucide-react-native'
import type { FriendInviteProfile, FriendInviteResolveResult, InviteRewardCenterSummary, InviteRewardRecord, VoucherItem } from '@food-link/core'
import { apiClient } from '../api'
import type { RootStackParamList } from '../navigation/types'
import { useAuth } from '../providers/AuthProvider'
import { useColorScheme } from '../providers/ColorSchemeProvider'
import { useAppDialog } from '../providers/DialogProvider'
import { userFacingErrorMessage } from '../utils/errors'
import { writePendingFriendInviteCode } from '../utils/pendingFriendInvite'

type Props = NativeStackScreenProps<RootStackParamList, 'InviteFriends'>
type Palette = ReturnType<typeof createPalette>

function createPalette(isDark: boolean) {
  return {
    page: isDark ? '#0d1412' : '#f3f8f5', card: isDark ? '#18221e' : '#ffffff', cardStrong: isDark ? '#1e2b26' : '#f8fffb',
    text: isDark ? '#f2f7f4' : '#183028', secondary: isDark ? '#b5c3bc' : '#5f7169', muted: isDark ? '#8fa198' : '#819188',
    border: isDark ? '#304139' : '#dfece6', brand: isDark ? '#52d3a0' : '#087f5b', brandButton: '#079669', brandSoft: isDark ? '#173b2f' : '#e8f8f1',
    ownerBg: isDark ? '#17352c' : '#e8f8f1', friendBg: isDark ? '#3a2f1d' : '#fff6dd', friendText: isDark ? '#f4d082' : '#9a6612',
    statBg: isDark ? '#202e28' : '#f2f8f5', pendingBg: isDark ? '#3b301d' : '#fff4d6', pendingText: isDark ? '#f4d082' : '#94620d',
    activeBg: isDark ? '#183c31' : '#dff7ed', activeText: isDark ? '#7ee4ba' : '#087856', completedBg: isDark ? '#1d3547' : '#e5f2ff',
    completedText: isDark ? '#8ec9f8' : '#286897', blockedBg: isDark ? '#45282c' : '#fde9e9', blockedText: isDark ? '#ffaaa9' : '#ad3b3b', scrim: 'rgba(3, 9, 7, 0.62)',
  }
}

export function InviteFriendsScreen({ navigation, route }: Props) {
  const dialog = useAppDialog()
  const insets = useSafeAreaInsets()
  const { width } = useWindowDimensions()
  const { isDark } = useColorScheme()
  const { isAuthenticated } = useAuth()
  const palette = useMemo(() => createPalette(isDark), [isDark])
  const scrollRef = useRef<ScrollView>(null)
  const rewardsYRef = useRef(0)
  const requestRef = useRef(0)
  const routeInviteCode = normalizeInviteCode(route.params?.inviteCode || route.params?.invite_code || route.params?.fi)
  const routeFromUserId = String(route.params?.fromUserId || route.params?.from_user_id || '').trim()
  const [profile, setProfile] = useState<FriendInviteProfile | null>(null)
  const [resolvedProfile, setResolvedProfile] = useState<FriendInviteResolveResult | null>(null)
  const [currentUserId, setCurrentUserId] = useState('')
  const [inviteCode, setInviteCode] = useState(routeInviteCode)
  const [notice, setNotice] = useState('')
  const [profileLoading, setProfileLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [rewardLoading, setRewardLoading] = useState(false)
  const [progressError, setProgressError] = useState('')
  const [voucherError, setVoucherError] = useState('')
  const [rewardSummary, setRewardSummary] = useState<InviteRewardCenterSummary | null>(null)
  const [membershipRewards, setMembershipRewards] = useState<VoucherItem[]>([])
  const [activatingRewardId, setActivatingRewardId] = useState('')
  const [accepting, setAccepting] = useState(false)
  const [qrPreviewOpen, setQrPreviewOpen] = useState(false)
  const inviterUserId = profileUserId(profile)
  const isInviteOwner = Boolean(currentUserId && inviterUserId && currentUserId === inviterUserId)
  const relationProfile = resolvedProfile || profile
  const inviteActionDone = inviteRelationHandled(relationProfile)
  const inviteLink = useMemo(() => buildInviteDeepLink(inviteCode), [inviteCode])
  const inviteMessage = useMemo(() => buildInviteMessage(profile, inviteCode, inviteLink), [inviteCode, inviteLink, profile])
  const compact = width < 360

  useEffect(() => {
    if (inviteCode) void writePendingFriendInviteCode(inviteCode, 'invite_page')
  }, [inviteCode])

  const loadRewards = useCallback(async (request = requestRef.current) => {
    setRewardLoading(true); setProgressError(''); setVoucherError('')
    const [centerResult, voucherResult] = await Promise.allSettled([apiClient.getRewardCenter(), apiClient.listMyVouchers('pending', 0, 100)])
    if (request !== requestRef.current) return
    if (centerResult.status === 'fulfilled') setRewardSummary(centerResult.value.invite_reward || null)
    else { setRewardSummary(null); setProgressError(userFacingErrorMessage(centerResult.reason, '邀请进度暂时无法读取，请稍后重试。')) }
    if (voucherResult.status === 'fulfilled') setMembershipRewards((voucherResult.value.items || []).filter((item) => item.voucher_type === 'invite_light_week'))
    else { setMembershipRewards([]); setVoucherError(userFacingErrorMessage(voucherResult.reason, '会员奖励暂时无法读取，请稍后重试。')) }
    setRewardLoading(false)
  }, [])

  const loadPage = useCallback(async (refresh = false) => {
    const request = ++requestRef.current
    refresh ? setRefreshing(true) : setProfileLoading(true)
    setNotice('')
    try {
      let meId = ''
      if (isAuthenticated) {
        const me = await apiClient.getUserProfile()
        if (request !== requestRef.current) return
        meId = String(me.id || (me as typeof me & { user_id?: string }).user_id || '').trim()
      }
      setCurrentUserId(meId)
      let nextProfile: FriendInviteProfile | null = null
      try {
        if (routeFromUserId) nextProfile = await apiClient.getInviteProfile(routeFromUserId)
        else if (routeInviteCode) nextProfile = await apiClient.getInviteProfileByCode(routeInviteCode)
        else if (meId) nextProfile = await apiClient.getInviteProfile(meId)
      } catch (error) { setNotice(userFacingErrorMessage(error, '邀请资料暂时无法读取，请检查后重试。')) }
      if (request !== requestRef.current) return
      setProfile(nextProfile)
      setInviteCode(String(nextProfile?.invite_code || routeInviteCode || '').trim())
      if (routeInviteCode && isAuthenticated) {
        try { const resolved = await apiClient.resolveInvite(routeInviteCode); if (request === requestRef.current) setResolvedProfile(resolved) }
        catch { if (request === requestRef.current) setResolvedProfile(null) }
      } else setResolvedProfile(null)
      const owner = Boolean(meId && profileUserId(nextProfile) === meId)
      if (owner) await loadRewards(request)
      else if (request === requestRef.current) {
        setRewardSummary(null); setMembershipRewards([]); setProgressError(''); setVoucherError(''); setRewardLoading(false)
      }
    } catch (error) {
      if (request === requestRef.current) setNotice(userFacingErrorMessage(error, '邀请页暂时无法读取，请稍后重试。'))
    } finally {
      if (request === requestRef.current) { setProfileLoading(false); setRefreshing(false) }
    }
  }, [isAuthenticated, loadRewards, routeFromUserId, routeInviteCode])

  useFocusEffect(useCallback(() => { void loadPage(); return () => { requestRef.current += 1 } }, [loadPage]))
  useEffect(() => {
    if (route.params?.section !== 'rewards' || profileLoading || rewardLoading || !isInviteOwner) return
    const timer = setTimeout(() => scrollRef.current?.scrollTo({ y: Math.max(0, rewardsYRef.current - 12), animated: true }), 180)
    return () => clearTimeout(timer)
  }, [isInviteOwner, profileLoading, rewardLoading, route.params?.section])

  const copyInviteCode = useCallback(async () => {
    if (!inviteCode) { await dialog.alert('邀请码暂不可用', '请下拉刷新邀请页后再试。', 'warning'); return }
    await Clipboard.setStringAsync(inviteCode)
    await dialog.alert('邀请码已复制', '可以直接发送给新朋友。', 'success')
  }, [dialog, inviteCode])

  const shareInvite = useCallback(async () => {
    if (!inviteCode) { await dialog.alert('邀请信息生成中', '请下拉刷新邀请页后再试。', 'warning'); return }
    try { await Share.share({ title: '邀请加入食探', message: inviteMessage }) }
    catch (error) { await dialog.alert('分享邀请失败', userFacingErrorMessage(error), 'danger') }
  }, [dialog, inviteCode, inviteMessage])

  const acceptInvite = useCallback(async () => {
    const code = normalizeInviteCode(routeInviteCode || inviteCode)
    if (!code || accepting || (isAuthenticated && inviteActionDone)) return
    if (!isAuthenticated) {
      await writePendingFriendInviteCode(code, 'invite_login_handoff')
      navigation.navigate('Login', { inviteCode: code, redirectTo: 'InviteFriends' })
      return
    }
    setAccepting(true)
    try {
      const next = await apiClient.acceptInvite(code) as FriendInviteResolveResult
      setResolvedProfile(next)
      if (next.nickname || next.user_id || next.id) setProfile(next)
      await dialog.alert('邀请已处理', inviteRelationText(next), 'success')
    } catch (error) { await dialog.alert('接受邀请失败', userFacingErrorMessage(error), 'danger') }
    finally { setAccepting(false) }
  }, [accepting, dialog, inviteActionDone, inviteCode, isAuthenticated, navigation, routeInviteCode])

  const activateReward = useCallback(async (reward: VoucherItem) => {
    if (reward.status !== 'pending' || activatingRewardId) return
    const days = membershipRewardDays(reward)
    const confirmed = await dialog.confirm({ title: `现在启用 ${days} 天会员？`, message: `确认后会立即开始 ${days} 天轻度版会员。也可以先留着，等需要时再启用。`, confirmText: '现在启用', cancelText: '以后再用', kind: 'warning' })
    if (!confirmed) return
    setActivatingRewardId(reward.id)
    try {
      await apiClient.useVoucher(reward.id)
      await dialog.alert('会员奖励已启用', `${days} 天轻度版会员已开始计时。`, 'success')
      await loadRewards()
    } catch (error) { await dialog.alert('启用会员奖励失败', userFacingErrorMessage(error), 'danger') }
    finally { setActivatingRewardId('') }
  }, [activatingRewardId, dialog, loadRewards])

  if (profileLoading && !profile) {
    return <View style={[styles.centered, { backgroundColor: palette.page }]}><ActivityIndicator accessibilityLabel="正在加载邀请页" size="large" color={palette.brandButton} /></View>
  }
  const inviterNickname = String(profile?.nickname || '').trim()
  const title = inviterNickname ? `${inviterNickname} 邀你加入食探` : isInviteOwner ? '邀请好友，一起得会员' : '加入食探并开始健康打卡'

  return (
    <View style={[styles.page, { backgroundColor: palette.page }]}>
      <ScrollView ref={scrollRef} showsVerticalScrollIndicator={false} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void loadPage(true)} tintColor={palette.brandButton} colors={[palette.brandButton]} />} contentContainerStyle={[styles.content, { paddingBottom: Math.max(insets.bottom, 12) + 28 }]}>
        <View style={[styles.hero, { backgroundColor: isDark ? '#16382e' : '#0a8f66' }]}>
          <View style={styles.heroGlow} />
          <View style={styles.eyebrowRow}><Gift size={16} color="#d9fff0" strokeWidth={2.4} /><Text style={styles.eyebrow}>邀请好友得会员</Text></View>
          <Text style={styles.heroTitle}>{title}</Text>
          <Text style={styles.heroSubtitle}>新朋友注册后 7 天内完成 2 个不同自然日有效记录：邀请人得 7 天会员，新朋友得 3 天会员。</Text>
        </View>

        <View style={styles.benefitRow} accessibilityLabel="邀请人获得7天轻度版会员，新朋友获得3天轻度版会员">
          <BenefitCard compact={compact} eyebrow="邀请人" days="7 天" palette={palette} owner />
          <View style={[styles.benefitArrow, { backgroundColor: palette.card, borderColor: palette.border }]}><ArrowRight size={18} color={palette.brand} strokeWidth={2.4} /></View>
          <BenefitCard compact={compact} eyebrow="新朋友" days="3 天" palette={palette} />
        </View>

        <View style={[styles.card, { backgroundColor: palette.card, borderColor: palette.border }]}>
          <View style={styles.profileRow}>
            {String(profile?.avatar || '').trim() ? <Image accessible accessibilityLabel={`${inviterNickname || '邀请人'}的头像`} source={{ uri: String(profile?.avatar) }} style={[styles.avatar, { backgroundColor: palette.brandSoft }]} /> : <View style={[styles.avatar, styles.avatarFallback, { backgroundColor: palette.brandSoft }]}><Text style={[styles.avatarText, { color: palette.brand }]}>食</Text></View>}
            <View style={styles.profileCopy}>
              <Text style={[styles.profileName, { color: palette.text }]}>{inviterNickname || (isInviteOwner ? '我的邀请页' : '邀请你加入食探')}</Text>
              <Text style={[styles.profileDesc, { color: palette.secondary }]}>{isInviteOwner ? '邀请码和分享链接都能绑定邀请关系' : '完成注册并继续记录，满足规则即可领取会员奖励'}</Text>
            </View>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel={inviteCode ? `复制邀请码 ${inviteCode}` : '邀请码暂不可用'} accessibilityState={{ disabled: !inviteCode }} disabled={!inviteCode} onPress={() => void copyInviteCode()} style={({ pressed }) => [styles.codeChip, { backgroundColor: palette.brandSoft, borderColor: palette.border }, pressed && styles.pressed]}>
            <View><Text style={[styles.codeLabel, { color: palette.secondary }]}>邀请码</Text><Text selectable style={[styles.codeValue, { color: palette.text }]}>{inviteCode || '--'}</Text></View><Copy size={20} color={palette.brand} strokeWidth={2.2} />
          </Pressable>
          {notice ? <InlineNotice text={notice} palette={palette} onRetry={() => void loadPage()} /> : null}
          {!isInviteOwner && profile ? <Text style={[styles.relationText, { color: palette.secondary, backgroundColor: palette.statBg }]}>{inviteRelationText(relationProfile)}</Text> : null}
        </View>

        {isInviteOwner ? <View onLayout={(event) => { rewardsYRef.current = event.nativeEvent.layout.y }}>
          <SectionCard palette={palette} title="可启用的会员奖励" subtitle="奖励不会自动计时，等需要时再启用" icon={<Gift size={20} color={palette.brand} strokeWidth={2.2} />}>
            {rewardLoading ? <SectionSpinner color={palette.brandButton} /> : voucherError ? <InlineNotice text={voucherError} palette={palette} onRetry={() => void loadRewards()} /> : membershipRewards.length === 0 ? <EmptyState title="暂时没有待启用奖励" description="达标后的 3 天或 7 天会员奖励会保存在这里" palette={palette} /> : <View style={styles.rewardList}>{membershipRewards.map((reward) => {
              const activating = activatingRewardId === reward.id; const days = membershipRewardDays(reward)
              return <View key={reward.id} style={[styles.rewardRow, { borderColor: palette.border, backgroundColor: palette.cardStrong }]}><View style={styles.rewardMain}><Text style={[styles.rewardTitle, { color: palette.text }]}>{reward.title || `${days} 天轻度版会员`}</Text><Text style={[styles.rewardDesc, { color: palette.secondary }]}>{reward.description || '邀请达标会员奖励'}</Text></View><Pressable accessibilityRole="button" accessibilityLabel={`现在启用${days}天会员`} accessibilityState={{ disabled: Boolean(activatingRewardId), busy: activating }} disabled={Boolean(activatingRewardId)} onPress={() => void activateReward(reward)} style={({ pressed }) => [styles.activateButton, { backgroundColor: palette.brandButton }, pressed && styles.pressed, activatingRewardId && !activating && styles.disabled]}>{activating ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.activateText}>现在启用</Text>}</Pressable></View>
            })}</View>}
          </SectionCard>
          <SectionCard palette={palette} title="邀请进度" subtitle="好友必须在注册后 7 天内完成 2 个不同自然日有效记录" icon={<Users size={20} color={palette.brand} strokeWidth={2.2} />}>
            {rewardLoading ? <SectionSpinner color={palette.brandButton} /> : progressError ? <InlineNotice text={progressError} palette={palette} onRetry={() => void loadRewards()} /> : <InviteProgress summary={rewardSummary} palette={palette} />}
          </SectionCard>
        </View> : null}

        <SectionCard palette={palette} title="活动规则" icon={<CheckCircle2 size={20} color={palette.brand} strokeWidth={2.2} />}>
          <RuleItem index="01" text="必须是从未注册过食探的新用户" palette={palette} />
          <RuleItem index="02" text="注册后 7 天内完成 2 个自然日任意功能使用" palette={palette} />
          <RuleItem index="03" text="达标后邀请人得 7 天、新朋友得 3 天；奖励可留到以后手动启用，邀请人每月最多奖励 10 位好友" palette={palette} last />
        </SectionCard>
        {isInviteOwner && inviteLink ? <Pressable accessibilityRole="button" accessibilityLabel="打开邀请二维码" onPress={() => setQrPreviewOpen(true)} style={({ pressed }) => [styles.qrCard, { backgroundColor: palette.card, borderColor: palette.border }, pressed && styles.pressed]}>
          <View style={[styles.qrIcon, { backgroundColor: palette.brandSoft }]}><QrCode size={22} color={palette.brand} strokeWidth={2.2} /></View><View style={styles.qrCopy}><Text style={[styles.sectionTitle, { color: palette.text }]}>扫码也能加入</Text><Text style={[styles.sectionSubtitle, { color: palette.secondary }]}>点开二维码，面对面展示给朋友</Text></View><ArrowRight size={20} color={palette.muted} strokeWidth={2.2} />
        </Pressable> : null}
        <View style={styles.actions}>{isInviteOwner ? <>
          <PrimaryAction label="立即转发邀请" icon={<Share2 size={19} color="#fff" strokeWidth={2.4} />} onPress={() => void shareInvite()} disabled={!inviteCode} palette={palette} />
          <SecondaryAction label="复制邀请码" icon={<Copy size={19} color={palette.brand} strokeWidth={2.4} />} onPress={() => void copyInviteCode()} disabled={!inviteCode} palette={palette} />
        </> : <PrimaryAction label={!isAuthenticated ? '登录注册并领取邀请' : inviteActionDone ? inviteActionText(relationProfile) : '直接加好友并开始使用'} icon={inviteActionDone && isAuthenticated ? <CheckCircle2 size={19} color="#fff" strokeWidth={2.4} /> : <UserPlus size={19} color="#fff" strokeWidth={2.4} />} onPress={() => void acceptInvite()} disabled={!inviteCode || accepting || (isAuthenticated && inviteActionDone)} loading={accepting} palette={palette} />}</View>
      </ScrollView>

      <Modal visible={qrPreviewOpen} transparent animationType="fade" onRequestClose={() => setQrPreviewOpen(false)}>
        <View style={[styles.modalScrim, { backgroundColor: palette.scrim }]}><View style={[styles.qrModal, { backgroundColor: palette.card, paddingBottom: Math.max(insets.bottom, 20) }]}>
          <Pressable accessibilityRole="button" accessibilityLabel="关闭邀请二维码" hitSlop={10} onPress={() => setQrPreviewOpen(false)} style={({ pressed }) => [styles.modalClose, { backgroundColor: palette.statBg }, pressed && styles.pressed]}><X size={22} color={palette.text} strokeWidth={2.3} /></Pressable>
          <Text style={[styles.qrModalTitle, { color: palette.text }]}>扫码加入食探</Text><Text style={[styles.qrModalDesc, { color: palette.secondary }]}>完成 2 天记录，新朋友得 3 天会员</Text><InviteQrCode value={inviteLink} size={Math.min(width - 96, 260)} /><Text selectable style={[styles.qrModalCode, { color: palette.brand }]}>邀请码 {inviteCode}</Text>
        </View></View>
      </Modal>
    </View>
  )
}

function BenefitCard({ compact, eyebrow, days, owner, palette }: { compact: boolean; eyebrow: string; days: string; owner?: boolean; palette: Palette }) {
  return <View style={[styles.benefitCard, { backgroundColor: owner ? palette.ownerBg : palette.friendBg, borderColor: palette.border }]}><Text style={[styles.benefitEyebrow, { color: owner ? palette.brand : palette.friendText }]}>{eyebrow}</Text><Text style={[styles.benefitDays, compact && styles.benefitDaysCompact, { color: owner ? palette.brand : palette.friendText }]}>{days}</Text><Text style={[styles.benefitLabel, compact && styles.benefitLabelCompact, { color: palette.secondary }]}>轻度版会员</Text></View>
}
function SectionCard({ palette, title, subtitle, icon, children }: { palette: Palette; title: string; subtitle?: string; icon: React.ReactNode; children: React.ReactNode }) {
  return <View style={[styles.card, { backgroundColor: palette.card, borderColor: palette.border }]}><View style={styles.sectionHeader}><View style={[styles.sectionIcon, { backgroundColor: palette.brandSoft }]}>{icon}</View><View style={styles.sectionCopy}><Text style={[styles.sectionTitle, { color: palette.text }]}>{title}</Text>{subtitle ? <Text style={[styles.sectionSubtitle, { color: palette.secondary }]}>{subtitle}</Text> : null}</View></View>{children}</View>
}
function InviteProgress({ summary, palette }: { summary: InviteRewardCenterSummary | null; palette: Palette }) {
  const inviter = summary?.as_inviter_summary; const invitee = summary?.as_invitee_summary
  if (!inviter && !invitee) return <EmptyState title="还没有邀请记录" description="把邀请码或邀请链接发给新朋友，注册后会自动出现在这里。" palette={palette} />
  return <View style={styles.progressBlocks}>
    {inviter ? <View><Text style={[styles.progressTitle, { color: palette.text }]}>我邀请的好友</Text><View style={styles.statRow}><Stat value={inviter.invited_count} label="已邀请" palette={palette} /><Stat value={inviter.completed_count} label="已达标" palette={palette} /><Stat value={inviter.pending_count} label="待达标" palette={palette} /></View>{Array.isArray(inviter.records) && inviter.records.length ? <View style={styles.friendList}>{inviter.records.map((record) => <FriendProgressRow key={record.referral_id} record={record} palette={palette} />)}</View> : null}</View> : null}
    {invitee ? <View style={[styles.inviteeBlock, inviter && { borderTopColor: palette.border, borderTopWidth: StyleSheet.hairlineWidth }]}><View style={styles.inviteeHead}><View><Text style={[styles.progressTitle, { color: palette.text }]}>我的受邀任务</Text><Text style={[styles.progressNote, { color: palette.secondary }]}>完成不同自然日的有效记录</Text></View><Text style={[styles.progressCount, { color: palette.brand }]}>{invitee.completed_days}/{invitee.required_days} 天</Text></View><View style={[styles.progressTrack, { backgroundColor: palette.statBg }]} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: invitee.required_days || 1, now: invitee.completed_days }}><View style={[styles.progressBar, { backgroundColor: palette.brandButton, width: `${inviteProgressPercent(invitee.completed_days, invitee.required_days)}%` }]} /></View><Text style={[styles.progressNote, { color: palette.secondary }]}>{invitee.deadline_text || invitee.next_action_text || '继续记录即可'}</Text></View> : null}
  </View>
}
function Stat({ value, label, palette }: { value: number; label: string; palette: Palette }) {
  return <View style={[styles.stat, { backgroundColor: palette.statBg }]} accessibilityLabel={`${label}${value}`}><Text style={[styles.statValue, { color: palette.text }]}>{value}</Text><Text style={[styles.statLabel, { color: palette.secondary }]}>{label}</Text></View>
}
function FriendProgressRow({ record, palette }: { record: InviteRewardRecord; palette: Palette }) {
  const tone = inviteStatusTone(record, palette)
  return <View style={[styles.friendRow, { borderTopColor: palette.border }]}><View style={styles.friendMain}><Text style={[styles.friendName, { color: palette.text }]}>{record.other_nickname || shortInviteId(record.other_user_id) || '好友'}</Text><Text style={[styles.friendDesc, { color: palette.secondary }]}>{record.requirement_text || record.next_action_text || '邀请进度待更新'}</Text></View><View style={[styles.statusTag, { backgroundColor: tone.background }]}><Text style={[styles.statusText, { color: tone.text }]}>{record.status_label || record.status || '未知'}</Text></View></View>
}
function RuleItem({ index, text, palette, last }: { index: string; text: string; palette: Palette; last?: boolean }) {
  return <View style={[styles.ruleRow, !last && { borderBottomColor: palette.border, borderBottomWidth: StyleSheet.hairlineWidth }]}><View style={[styles.ruleIndex, { backgroundColor: palette.brandSoft }]}><Text style={[styles.ruleIndexText, { color: palette.brand }]}>{index}</Text></View><Text style={[styles.ruleText, { color: palette.secondary }]}>{text}</Text></View>
}
function EmptyState({ title, description, palette }: { title: string; description: string; palette: Palette }) {
  return <View style={[styles.empty, { backgroundColor: palette.statBg }]}><Clock3 size={22} color={palette.muted} strokeWidth={2} /><Text style={[styles.emptyTitle, { color: palette.text }]}>{title}</Text><Text style={[styles.emptyDesc, { color: palette.secondary }]}>{description}</Text></View>
}
function InlineNotice({ text, palette, onRetry }: { text: string; palette: Palette; onRetry: () => void }) {
  return <View style={[styles.notice, { backgroundColor: palette.pendingBg }]}><Text style={[styles.noticeText, { color: palette.pendingText }]}>{text}</Text><Pressable accessibilityRole="button" accessibilityLabel="重新加载" hitSlop={8} onPress={onRetry} style={({ pressed }) => [styles.retryButton, pressed && styles.pressed]}><RefreshCw size={16} color={palette.pendingText} strokeWidth={2.3} /><Text style={[styles.retryText, { color: palette.pendingText }]}>重试</Text></Pressable></View>
}
function SectionSpinner({ color }: { color: string }) { return <View style={styles.sectionSpinner} accessibilityLabel="正在加载"><ActivityIndicator color={color} /></View> }
function PrimaryAction({ label, icon, onPress, disabled, loading, palette }: { label: string; icon: React.ReactNode; onPress: () => void; disabled?: boolean; loading?: boolean; palette: Palette }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: Boolean(disabled), busy: Boolean(loading) }} disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.primaryAction, { backgroundColor: palette.brandButton }, pressed && styles.pressed, disabled && styles.disabled]}>{loading ? <ActivityIndicator color="#fff" size="small" /> : icon}<Text style={styles.primaryActionText}>{label}</Text></Pressable>
}
function SecondaryAction({ label, icon, onPress, disabled, palette }: { label: string; icon: React.ReactNode; onPress: () => void; disabled?: boolean; palette: Palette }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: Boolean(disabled) }} disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.secondaryAction, { backgroundColor: palette.card, borderColor: palette.border }, pressed && styles.pressed, disabled && styles.disabled]}>{icon}<Text style={[styles.secondaryActionText, { color: palette.brand }]}>{label}</Text></Pressable>
}
function InviteQrCode({ value, size }: { value: string; size: number }) {
  const matrix = useMemo(() => { const link = value.trim(); if (!link) return []; const qr = qrcode(0, 'M'); qr.addData(link); qr.make(); const count = qr.getModuleCount(); return Array.from({ length: count }, (_, row) => Array.from({ length: count }, (_, col) => qr.isDark(row, col))) }, [value])
  if (!matrix.length) return <ActivityIndicator color="#079669" />
  return <View style={[styles.qrOuter, { width: size, height: size }]} accessibilityRole="image" accessibilityLabel="食探邀请二维码">{matrix.map((row, rowIndex) => <View key={`qr-row-${rowIndex}`} style={styles.qrRow}>{row.map((dark, colIndex) => <View key={`qr-${rowIndex}-${colIndex}`} style={[styles.qrCell, { backgroundColor: dark ? '#10251d' : '#ffffff' }]} />)}</View>)}</View>
}
function normalizeInviteCode(value?: string) { return String(value || '').trim() }
function profileUserId(profile: FriendInviteProfile | null) { return String(profile?.user_id || profile?.id || '').trim() }
function membershipRewardDays(reward: VoucherItem) { const value = Number(reward.reward_payload?.grant_days); return Number.isFinite(value) && value > 0 ? value : 7 }
function inviteProgressPercent(completed: number, required: number) { if (!required || required <= 0) return 0; return Math.max(0, Math.min(100, Math.round((completed / required) * 100))) }
function shortInviteId(value?: string | null) { if (!value) return ''; return value.length <= 8 ? value : `${value.slice(0, 4)}...${value.slice(-4)}` }
function inviteRelationHandled(profile: FriendInviteResolveResult | FriendInviteProfile | null) {
  const resolved = profile as FriendInviteResolveResult | null
  const status = String(profile?.status || resolved?.request_status || resolved?.relation || '')
  return Boolean(profile?.is_self || profile?.is_friend || status === 'already_friend' || status === 'request_sent')
}
function inviteActionText(profile: FriendInviteResolveResult | FriendInviteProfile | null) {
  if (profile?.is_self) return '这是我的邀请'; if (profile?.is_friend || profile?.status === 'already_friend') return '已是好友'; if ((profile as FriendInviteResolveResult | null)?.request_status === 'request_sent' || profile?.status === 'request_sent') return '已发送申请'; return '加为好友'
}
function inviteRelationText(profile: FriendInviteResolveResult | FriendInviteProfile | null) {
  if (profile?.is_self) return '这是你的邀请页，把邀请码或链接分享给新朋友即可。'; if (profile?.is_friend || profile?.status === 'already_friend') return '你们已经是好友，可以直接开始互相关注打卡。'; if ((profile as FriendInviteResolveResult | null)?.request_status === 'request_sent' || profile?.status === 'request_sent') return '好友申请已发送，等待对方处理。'; return '确认后会发送好友申请；完成 2 天有效记录后，会员奖励会按规则发放。'
}
function buildInviteDeepLink(inviteCode: string) { const code = inviteCode.trim(); return code ? `foodlink://invite?fi=${encodeURIComponent(code)}` : '' }
function buildInviteMessage(profile: FriendInviteProfile | null, inviteCode: string, inviteLink: string) {
  const nickname = String(profile?.nickname || '').trim()
  return [nickname ? `${nickname} 邀请你加入食探` : '邀请你加入食探', '注册后 7 天内完成 2 个不同自然日有效记录，你得 3 天轻度版会员，邀请人得 7 天。', inviteCode ? `邀请码：${inviteCode}` : '', inviteLink ? `打开链接自动带入：${inviteLink}` : ''].filter(Boolean).join('\n')
}
function inviteStatusTone(record: InviteRewardRecord, palette: Palette) {
  if (record.status_label === '已过期') return { background: palette.blockedBg, text: palette.blockedText }
  if (record.status === 'reward_completed') return { background: palette.completedBg, text: palette.completedText }
  if (record.status === 'reward_active') return { background: palette.activeBg, text: palette.activeText }
  if (record.status === 'reward_blocked' || record.status === 'cancelled') return { background: palette.blockedBg, text: palette.blockedText }
  return { background: palette.pendingBg, text: palette.pendingText }
}

const styles = StyleSheet.create({
  page: { flex: 1 }, centered: { flex: 1, alignItems: 'center', justifyContent: 'center' }, content: { paddingHorizontal: 16, paddingTop: 16, gap: 14 },
  hero: { borderRadius: 24, padding: 22, minHeight: 208, overflow: 'hidden', justifyContent: 'flex-end' }, heroGlow: { position: 'absolute', width: 210, height: 210, borderRadius: 105, backgroundColor: 'rgba(255,255,255,0.10)', right: -60, top: -90 },
  eyebrowRow: { flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 14 }, eyebrow: { color: '#d9fff0', fontSize: 13, fontWeight: '700', letterSpacing: 0.4 }, heroTitle: { color: '#ffffff', fontSize: 27, lineHeight: 35, fontWeight: '800', marginBottom: 10 }, heroSubtitle: { color: 'rgba(255,255,255,0.88)', fontSize: 14, lineHeight: 22 },
  benefitRow: { flexDirection: 'row', alignItems: 'center', gap: 8 }, benefitCard: { flex: 1, minWidth: 0, minHeight: 124, borderRadius: 18, borderWidth: 1, padding: 16, justifyContent: 'center' }, benefitEyebrow: { fontSize: 12, fontWeight: '700', marginBottom: 5 }, benefitDays: { fontSize: 27, lineHeight: 34, fontWeight: '800' }, benefitDaysCompact: { fontSize: 23 }, benefitLabel: { fontSize: 13, lineHeight: 19, fontWeight: '600' }, benefitLabelCompact: { fontSize: 12 }, benefitArrow: { width: 34, height: 34, borderRadius: 17, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  card: { borderRadius: 20, borderWidth: 1, padding: 16 }, profileRow: { flexDirection: 'row', alignItems: 'center', gap: 12 }, avatar: { width: 54, height: 54, borderRadius: 18 }, avatarFallback: { alignItems: 'center', justifyContent: 'center' }, avatarText: { fontSize: 22, fontWeight: '800' }, profileCopy: { flex: 1, minWidth: 0 }, profileName: { fontSize: 17, lineHeight: 23, fontWeight: '700', marginBottom: 3 }, profileDesc: { fontSize: 13, lineHeight: 19 },
  codeChip: { minHeight: 64, marginTop: 14, borderWidth: 1, borderRadius: 16, paddingHorizontal: 15, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, codeLabel: { fontSize: 11, fontWeight: '600', marginBottom: 2 }, codeValue: { fontSize: 20, lineHeight: 25, fontWeight: '800', letterSpacing: 1.2 }, relationText: { marginTop: 12, padding: 12, borderRadius: 12, fontSize: 13, lineHeight: 20 },
  sectionHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 11, marginBottom: 15 }, sectionIcon: { width: 40, height: 40, borderRadius: 13, alignItems: 'center', justifyContent: 'center' }, sectionCopy: { flex: 1, minWidth: 0, paddingTop: 1 }, sectionTitle: { fontSize: 17, lineHeight: 23, fontWeight: '700' }, sectionSubtitle: { fontSize: 12, lineHeight: 18, marginTop: 2 }, sectionSpinner: { height: 88, alignItems: 'center', justifyContent: 'center' },
  rewardList: { gap: 10 }, rewardRow: { borderRadius: 14, borderWidth: 1, padding: 13, flexDirection: 'row', alignItems: 'center', gap: 10 }, rewardMain: { flex: 1, minWidth: 0 }, rewardTitle: { fontSize: 14, lineHeight: 20, fontWeight: '700' }, rewardDesc: { fontSize: 12, lineHeight: 18, marginTop: 2 }, activateButton: { minWidth: 88, minHeight: 48, paddingHorizontal: 12, borderRadius: 13, alignItems: 'center', justifyContent: 'center' }, activateText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  progressBlocks: { gap: 18 }, progressTitle: { fontSize: 14, lineHeight: 20, fontWeight: '700', marginBottom: 10 }, statRow: { flexDirection: 'row', gap: 8 }, stat: { flex: 1, minWidth: 0, borderRadius: 13, paddingVertical: 12, alignItems: 'center' }, statValue: { fontSize: 22, lineHeight: 27, fontWeight: '800', fontVariant: ['tabular-nums'] }, statLabel: { fontSize: 11, lineHeight: 17, marginTop: 2 },
  friendList: { marginTop: 12 }, friendRow: { minHeight: 66, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', gap: 10, borderTopWidth: StyleSheet.hairlineWidth }, friendMain: { flex: 1, minWidth: 0 }, friendName: { fontSize: 14, lineHeight: 20, fontWeight: '700' }, friendDesc: { fontSize: 12, lineHeight: 18, marginTop: 2 }, statusTag: { maxWidth: 92, minHeight: 30, paddingHorizontal: 9, borderRadius: 15, alignItems: 'center', justifyContent: 'center' }, statusText: { fontSize: 11, lineHeight: 16, fontWeight: '700', textAlign: 'center' },
  inviteeBlock: { paddingTop: 18 }, inviteeHead: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }, progressCount: { fontSize: 16, lineHeight: 22, fontWeight: '800', fontVariant: ['tabular-nums'] }, progressTrack: { height: 9, borderRadius: 5, overflow: 'hidden', marginVertical: 10 }, progressBar: { height: '100%', borderRadius: 5 }, progressNote: { fontSize: 12, lineHeight: 18 },
  empty: { borderRadius: 14, padding: 18, alignItems: 'center' }, emptyTitle: { fontSize: 14, fontWeight: '700', marginTop: 8 }, emptyDesc: { fontSize: 12, lineHeight: 19, textAlign: 'center', marginTop: 4 }, notice: { borderRadius: 13, padding: 12, marginTop: 12, flexDirection: 'row', alignItems: 'center', gap: 10 }, noticeText: { flex: 1, fontSize: 12, lineHeight: 18 }, retryButton: { minWidth: 52, minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4 }, retryText: { fontSize: 12, fontWeight: '700' },
  ruleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingVertical: 13 }, ruleIndex: { width: 38, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center' }, ruleIndexText: { fontSize: 12, fontWeight: '800', fontVariant: ['tabular-nums'] }, ruleText: { flex: 1, minWidth: 0, fontSize: 13, lineHeight: 21, paddingTop: 4 },
  qrCard: { minHeight: 78, borderRadius: 20, borderWidth: 1, padding: 15, flexDirection: 'row', alignItems: 'center', gap: 12 }, qrIcon: { width: 46, height: 46, borderRadius: 15, alignItems: 'center', justifyContent: 'center' }, qrCopy: { flex: 1, minWidth: 0 }, actions: { gap: 10, paddingTop: 2 }, primaryAction: { minHeight: 52, borderRadius: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 18 }, primaryActionText: { color: '#fff', fontSize: 15, fontWeight: '800' }, secondaryAction: { minHeight: 52, borderRadius: 16, borderWidth: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 18 }, secondaryActionText: { fontSize: 15, fontWeight: '800' }, pressed: { opacity: 0.82 }, disabled: { opacity: 0.46 },
  modalScrim: { flex: 1, justifyContent: 'center', paddingHorizontal: 24 }, qrModal: { borderRadius: 24, paddingHorizontal: 24, paddingTop: 22, alignItems: 'center' }, modalClose: { alignSelf: 'flex-end', width: 48, height: 48, borderRadius: 16, alignItems: 'center', justifyContent: 'center' }, qrModalTitle: { fontSize: 22, lineHeight: 29, fontWeight: '800', marginTop: 2 }, qrModalDesc: { fontSize: 13, lineHeight: 20, textAlign: 'center', marginTop: 5, marginBottom: 18 }, qrOuter: { backgroundColor: '#fff', borderRadius: 14, padding: 12 }, qrRow: { flex: 1, flexDirection: 'row' }, qrCell: { flex: 1, aspectRatio: 1 }, qrModalCode: { fontSize: 15, fontWeight: '800', letterSpacing: 0.8, marginTop: 16 },
})
