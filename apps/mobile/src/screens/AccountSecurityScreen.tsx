import { useCallback, useState } from 'react'
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { useFocusEffect } from '@react-navigation/native'
import { CheckCircle2, KeyRound, LockKeyhole, Save, ShieldCheck, Smartphone, type LucideIcon } from 'lucide-react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import type { UserInfo } from '@food-link/core'
import { apiClient } from '../api'
import { useAppDialog } from '../providers/DialogProvider'
import { colors } from '../theme'
import { userFacingErrorMessage } from '../utils/errors'

export function AccountSecurityScreen() {
  const dialog = useAppDialog()
  const insets = useSafeAreaInsets()
  const [profile, setProfile] = useState<UserInfo | null>(null)
  const [phone, setPhone] = useState('')
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const normalizedPhone = normalizeMainlandPhone(phone)
  const trimmedPassword = newPassword.trim()
  const trimmedConfirmPassword = confirmPassword.trim()
  const phoneValid = /^1[3-9]\d{9}$/.test(normalizedPhone)
  const passwordLongEnough = trimmedPassword.length >= 8
  const passwordMatched = Boolean(trimmedConfirmPassword) && trimmedPassword === trimmedConfirmPassword
  const requiresCurrentPassword = Boolean(profile?.has_password)
  const currentPasswordReady = !requiresCurrentPassword || currentPassword.trim().length > 0
  const canSave = phoneValid && passwordLongEnough && passwordMatched && currentPasswordReady && !saving

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await apiClient.getUserProfile()
      setProfile(data)
      setPhone(data.telephone || '')
    } catch (error) {
      await dialog.alert('获取账号信息失败', userFacingErrorMessage(error), 'danger')
    } finally {
      setLoading(false)
    }
  }, [dialog])

  useFocusEffect(
    useCallback(() => {
      void load()
    }, [load]),
  )

  const save = async () => {
    if (!normalizedPhone) {
      await dialog.alert('请输入手机号', '手机号将用于 App 手机号密码登录。', 'warning')
      return
    }
    if (!phoneValid) {
      await dialog.alert('手机号格式不正确', '请填写 11 位大陆手机号。', 'warning')
      return
    }
    if (trimmedPassword.length < 8) {
      await dialog.alert('密码太短', '密码至少需要 8 位。', 'warning')
      return
    }
    if (trimmedPassword !== trimmedConfirmPassword) {
      await dialog.alert('两次密码不一致', '请重新输入确认密码。', 'warning')
      return
    }
    if (profile?.has_password && !currentPassword.trim()) {
      await dialog.alert('请输入当前密码', '修改已设置的密码登录方式需要先验证当前密码。', 'warning')
      return
    }
    setSaving(true)
    try {
      await apiClient.setAccountPassword({
        phone: normalizedPhone,
        password: trimmedPassword,
        currentPassword: currentPassword.trim(),
      })
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      await dialog.alert('已保存', '之后可以使用手机号和密码登录 App。', 'success')
      await load()
    } catch (error) {
      await dialog.alert('保存失败', userFacingErrorMessage(error), 'danger')
    } finally {
      setSaving(false)
    }
  }

  return (
    <View style={styles.page}>
      <ScrollView
        style={styles.scroll}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[styles.content, { paddingBottom: 104 + Math.max(insets.bottom, 10) }]}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.brand} colors={[colors.brand]} />}
      >
        <View style={styles.hero}>
          <Text style={styles.heroTitle}>手机号与密码</Text>
          <Text style={styles.heroDesc}>作为微信登录之外的备用方式，只在 App 登录时使用。</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>登录方式</Text>
          <InfoRow icon={ShieldCheck} label="微信登录" value={profile?.openid ? '已连接' : '可用'} />
          <InfoRow icon={Smartphone} label="手机号" value={maskPhone(profile?.telephone) || '未绑定'} />
          <InfoRow icon={LockKeyhole} label="密码登录" value={profile?.has_password ? '已设置' : '未设置'} />
          {profile?.password_set_at ? <InfoRow icon={KeyRound} label="设置时间" value={formatDate(profile.password_set_at)} /> : null}
        </View>

        <View style={styles.card}>
          <View style={styles.titleRow}>
            <Text style={styles.sectionTitle}>{profile?.has_password ? '修改手机号密码' : '设置手机号密码'}</Text>
            <Text style={styles.sectionBadge}>{profile?.has_password ? '已启用' : '未启用'}</Text>
          </View>
          <Field label="手机号" value={phone} onChangeText={setPhone} placeholder="请输入 11 位手机号" keyboardType="phone-pad" />
          <Text style={[styles.formHint, phone && !phoneValid && styles.formHintWarning]}>用于 App 手机号密码登录，保存后会同步到账号资料。</Text>
          {profile?.has_password ? (
            <>
              <Field
                label="当前密码"
                value={currentPassword}
                onChangeText={setCurrentPassword}
                placeholder="修改密码需验证当前密码"
                secureTextEntry
              />
              <Text style={[styles.formHint, !currentPasswordReady && styles.formHintWarning]}>已设置密码的账号，修改时需要填写当前密码。</Text>
            </>
          ) : null}
          <Field label="新密码" value={newPassword} onChangeText={setNewPassword} placeholder="至少 8 位" secureTextEntry />
          <Field label="确认新密码" value={confirmPassword} onChangeText={setConfirmPassword} placeholder="再次输入新密码" secureTextEntry />
          <View style={styles.passwordStatusRow}>
            <StatusPill label="至少 8 位" active={passwordLongEnough} />
            <StatusPill label="两次一致" active={passwordMatched} />
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>说明</Text>
          <Text style={styles.bodyText}>设置后，手机号和密码可以作为微信登录之外的备用方式。为了账号安全，修改已设置的密码时需要先验证当前密码。</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>账号注销</Text>
          <Text style={styles.bodyText}>注销账号入口保留在个人主页编辑页底部，操作前会二次确认。注销后账号数据会按协议处理，本机登录状态也会清空。</Text>
        </View>
      </ScrollView>

      <View style={[styles.submitBar, { paddingBottom: Math.max(insets.bottom, 10) }]}>
        <Pressable style={[styles.submitButton, !canSave && styles.submitButtonDisabled]} disabled={!canSave} onPress={save}>
          {saving ? (
            <ActivityIndicator color="#ffffff" size="small" />
          ) : (
            <>
              <Save size={16} color="#ffffff" strokeWidth={2.4} />
              <Text style={styles.submitButtonText}>保存手机号和密码</Text>
            </>
          )}
        </Pressable>
      </View>
    </View>
  )
}

function InfoRow({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: string }) {
  return (
    <View style={styles.infoRow}>
      <View style={styles.infoMain}>
        <View style={styles.infoIcon}>
          <Icon size={16} color="#00a86b" strokeWidth={2.2} />
        </View>
        <Text style={styles.infoLabel}>{label}</Text>
      </View>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  )
}

function normalizeMainlandPhone(value?: string | null): string {
  let phone = String(value || '').trim().replace(/[\s-()]/g, '')
  if (phone.startsWith('+')) phone = phone.slice(1)
  if (phone.startsWith('86') && phone.length === 13) phone = phone.slice(2)
  return phone
}

function maskPhone(value?: string | null): string {
  const phone = normalizeMainlandPhone(value)
  if (!/^1[3-9]\d{9}$/.test(phone)) return ''
  return `${phone.slice(0, 3)}****${phone.slice(-4)}`
}

function Field({
  label,
  value,
  onChangeText,
  placeholder,
  secureTextEntry,
  keyboardType,
}: {
  label: string
  value: string
  onChangeText: (value: string) => void
  placeholder?: string
  secureTextEntry?: boolean
  keyboardType?: 'default' | 'phone-pad'
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        secureTextEntry={secureTextEntry}
        keyboardType={keyboardType}
        autoCapitalize="none"
        autoCorrect={false}
        placeholderTextColor="#98a2b3"
        style={styles.input}
      />
    </View>
  )
}

function StatusPill({ label, active }: { label: string; active: boolean }) {
  return (
    <View style={[styles.statusPill, active && styles.statusPillActive]}>
      {active ? <CheckCircle2 size={12} color="#00a86b" strokeWidth={2.4} /> : null}
      <Text style={[styles.statusPillText, active && styles.statusPillTextActive]}>{label}</Text>
    </View>
  )
}

function formatDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString()
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: '#f6f8fb',
  },
  scroll: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 12,
    paddingTop: 14,
  },
  hero: {
    gap: 6,
    paddingHorizontal: 4,
    paddingTop: 10,
    paddingBottom: 14,
  },
  heroTitle: {
    color: '#111827',
    fontSize: 21,
    lineHeight: 28,
    fontWeight: '900',
  },
  heroDesc: {
    color: '#667085',
    fontSize: 13,
    lineHeight: 19,
  },
  card: {
    marginBottom: 11,
    padding: 14,
    borderWidth: 1,
    borderColor: 'rgba(15, 23, 42, 0.05)',
    borderRadius: 14,
    backgroundColor: '#ffffff',
    shadowColor: '#0f172a',
    shadowOpacity: 0.05,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 6 },
    elevation: 2,
  },
  sectionTitle: {
    color: '#111827',
    fontSize: 15,
    lineHeight: 21,
    fontWeight: '900',
    marginBottom: 10,
  },
  titleRow: {
    minHeight: 24,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    marginBottom: 10,
  },
  sectionBadge: {
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 4,
    overflow: 'hidden',
    backgroundColor: '#ecfdf3',
    color: '#00a86b',
    fontSize: 11,
    fontWeight: '900',
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    minHeight: 48,
    paddingVertical: 7,
    borderTopWidth: 1,
    borderTopColor: '#eef2f7',
  },
  infoMain: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flexShrink: 1,
    minWidth: 0,
  },
  infoIcon: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ecfdf3',
  },
  infoLabel: {
    color: '#334155',
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '800',
  },
  infoValue: {
    color: '#111827',
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '900',
    textAlign: 'right',
    flexShrink: 1,
  },
  field: {
    marginBottom: 12,
  },
  fieldLabel: {
    marginBottom: 7,
    color: '#667085',
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '800',
  },
  formHint: {
    color: '#667085',
    fontSize: 12,
    lineHeight: 18,
    marginTop: -5,
    marginBottom: 12,
  },
  formHintWarning: {
    color: colors.warning,
  },
  input: {
    minHeight: 44,
    borderRadius: 10,
    paddingHorizontal: 11,
    paddingVertical: 9,
    fontSize: 14,
    lineHeight: 20,
    color: '#111827',
    backgroundColor: '#f8fafc',
  },
  bodyText: {
    color: '#667085',
    fontSize: 13,
    lineHeight: 20,
  },
  passwordStatusRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 7,
    marginTop: -1,
  },
  statusPill: {
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 5,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#f1f5f9',
  },
  statusPillActive: {
    backgroundColor: '#ecfdf3',
  },
  statusPillText: {
    color: '#667085',
    fontSize: 11,
    fontWeight: '800',
  },
  statusPillTextActive: {
    color: '#00a86b',
  },
  submitBar: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 20,
    paddingHorizontal: 12,
    paddingTop: 10,
    backgroundColor: 'rgba(246, 248, 251, 0.94)',
  },
  submitButton: {
    height: 44,
    borderRadius: 999,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    backgroundColor: '#00bc7d',
  },
  submitButtonDisabled: {
    backgroundColor: '#a7e8cf',
  },
  submitButtonText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '900',
  },
})
