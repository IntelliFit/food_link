import { useCallback, useEffect, useState } from 'react'
import { Alert, StyleSheet, Text, TextInput, View } from 'react-native'
import type { UserInfo } from '@food-link/core'
import { apiClient } from '../api'
import { AppButton } from '../components/AppButton'
import { Card } from '../components/Card'
import { Page } from '../components/Page'
import { colors } from '../theme'
import { userFacingErrorMessage } from '../utils/errors'

export function AccountSecurityScreen() {
  const [profile, setProfile] = useState<UserInfo | null>(null)
  const [username, setUsername] = useState('')
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await apiClient.getUserProfile()
      setProfile(data)
      setUsername(data.username || '')
    } catch (error) {
      Alert.alert('获取账号信息失败', userFacingErrorMessage(error))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const save = async () => {
    const trimmedUsername = username.trim()
    const trimmedPassword = newPassword.trim()
    if (!trimmedUsername) {
      Alert.alert('请输入用户名', '用户名将用于账号密码登录。')
      return
    }
    if (trimmedPassword.length < 8) {
      Alert.alert('密码太短', '密码至少需要 8 位。')
      return
    }
    if (trimmedPassword !== confirmPassword.trim()) {
      Alert.alert('两次密码不一致', '请重新输入确认密码。')
      return
    }
    if (profile?.has_password && !currentPassword.trim()) {
      Alert.alert('请输入当前密码', '修改已设置的账号密码需要先验证当前密码。')
      return
    }
    setSaving(true)
    try {
      await apiClient.setAccountPassword({
        username: trimmedUsername,
        password: trimmedPassword,
        currentPassword: currentPassword.trim(),
      })
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      Alert.alert('已保存', '之后可以使用用户名和密码登录 App。')
      await load()
    } catch (error) {
      Alert.alert('保存失败', userFacingErrorMessage(error))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Page title="账号安全" subtitle="设置 App 用户名和密码，作为微信登录之外的备用登录方式。" refreshing={loading} onRefresh={load}>
      <Card>
        <Text style={styles.sectionTitle}>登录方式</Text>
        <InfoRow label="微信登录" value={profile?.openid ? '已连接' : '可用'} />
        <InfoRow label="账号密码" value={profile?.has_password ? '已设置' : '未设置'} />
        {profile?.password_set_at ? <InfoRow label="设置时间" value={formatDate(profile.password_set_at)} /> : null}
      </Card>

      <Card>
        <Text style={styles.sectionTitle}>{profile?.has_password ? '修改账号密码' : '设置账号密码'}</Text>
        <Field label="用户名" value={username} onChangeText={setUsername} placeholder="请输入 3-32 位字母、数字或下划线" />
        {profile?.has_password ? (
          <Field
            label="当前密码"
            value={currentPassword}
            onChangeText={setCurrentPassword}
            placeholder="修改密码需验证当前密码"
            secureTextEntry
          />
        ) : null}
        <Field label="新密码" value={newPassword} onChangeText={setNewPassword} placeholder="至少 8 位" secureTextEntry />
        <Field label="确认新密码" value={confirmPassword} onChangeText={setConfirmPassword} placeholder="再次输入新密码" secureTextEntry />
        <AppButton label="保存账号密码" loading={saving} onPress={save} />
      </Card>

      <Card>
        <Text style={styles.sectionTitle}>说明</Text>
        <Text style={styles.bodyText}>用户名会统一转为小写。设置后，登录页的“账号登录”可以作为微信登录之外的兜底方式。</Text>
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

function Field({
  label,
  value,
  onChangeText,
  placeholder,
  secureTextEntry,
}: {
  label: string
  value: string
  onChangeText: (value: string) => void
  placeholder?: string
  secureTextEntry?: boolean
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        secureTextEntry={secureTextEntry}
        autoCapitalize="none"
        autoCorrect={false}
        style={styles.input}
      />
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
})
