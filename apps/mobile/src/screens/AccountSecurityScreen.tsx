import { useCallback, useState } from 'react'
import { StyleSheet, Text, TextInput, View } from 'react-native'
import { useFocusEffect } from '@react-navigation/native'
import type { UserInfo } from '@food-link/core'
import { apiClient } from '../api'
import { AppButton } from '../components/AppButton'
import { Card } from '../components/Card'
import { Page } from '../components/Page'
import { useAppDialog } from '../providers/DialogProvider'
import { colors } from '../theme'
import { userFacingErrorMessage } from '../utils/errors'

export function AccountSecurityScreen() {
  const dialog = useAppDialog()
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
    <Page title="账号安全" subtitle="设置 App 手机号和密码，作为微信登录之外的备用登录方式。" refreshing={loading} onRefresh={load}>
      <Card>
        <Text style={styles.sectionTitle}>登录方式</Text>
        <InfoRow label="微信登录" value={profile?.openid ? '已连接' : '可用'} />
        <InfoRow label="手机号" value={maskPhone(profile?.telephone) || '未绑定'} />
        <InfoRow label="密码登录" value={profile?.has_password ? '已设置' : '未设置'} />
        {profile?.password_set_at ? <InfoRow label="设置时间" value={formatDate(profile.password_set_at)} /> : null}
      </Card>

      <Card>
        <Text style={styles.sectionTitle}>{profile?.has_password ? '修改手机号密码' : '设置手机号密码'}</Text>
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
        <AppButton label="保存手机号和密码" loading={saving} disabled={!canSave} onPress={save} />
      </Card>

      <Card>
        <Text style={styles.sectionTitle}>说明</Text>
        <Text style={styles.bodyText}>设置后，手机号和密码可以作为微信登录之外的备用方式。为了账号安全，修改已设置的密码时需要先验证当前密码。</Text>
      </Card>

      <Card>
        <Text style={styles.sectionTitle}>账号注销</Text>
        <Text style={styles.bodyText}>注销账号入口保留在个人主页编辑页底部，操作前会二次确认。注销后账号数据会按协议处理，本机登录状态也会清空。</Text>
      </Card>
    </Page>
  )
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
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
        style={styles.input}
      />
    </View>
  )
}

function StatusPill({ label, active }: { label: string; active: boolean }) {
  return (
    <View style={[styles.statusPill, active && styles.statusPillActive]}>
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
  sectionTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '800',
    marginBottom: 12,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: '#eef2f7',
  },
  infoLabel: {
    color: colors.textSecondary,
    fontWeight: '700',
  },
  infoValue: {
    color: colors.text,
    fontWeight: '800',
  },
  field: {
    marginBottom: 14,
  },
  fieldLabel: {
    marginBottom: 7,
    color: colors.textSecondary,
    fontWeight: '700',
  },
  formHint: {
    color: colors.textSecondary,
    fontSize: 12,
    lineHeight: 18,
    marginTop: -8,
    marginBottom: 14,
  },
  formHintWarning: {
    color: colors.warning,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: colors.text,
    backgroundColor: '#fff',
  },
  bodyText: {
    color: colors.textSecondary,
    lineHeight: 22,
  },
  passwordStatusRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: -2,
    marginBottom: 14,
  },
  statusPill: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: colors.surfaceMuted,
  },
  statusPillActive: {
    backgroundColor: colors.brandSoft,
  },
  statusPillText: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '800',
  },
  statusPillTextActive: {
    color: colors.brandDark,
  },
})
