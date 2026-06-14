import { useState } from 'react'
import { Alert, StyleSheet, Text, TextInput, View } from 'react-native'
import { AppButton } from '../components/AppButton'
import { Card } from '../components/Card'
import { Page } from '../components/Page'
import { API_BASE_URL } from '../config'
import { useAuth } from '../providers/AuthProvider'
import { colors } from '../theme'

export function LoginScreen() {
  const { loginWithDebugAccount, loginWithUserId } = useAuth()
  const [loading, setLoading] = useState(false)
  const [userId, setUserId] = useState('')
  const [password, setPassword] = useState('')

  const run = async (fn: () => Promise<void>, fallback: string) => {
    setLoading(true)
    try {
      console.log('[mobile] login action started')
      await fn()
      console.log('[mobile] login action succeeded')
    } catch (error) {
      console.log('[mobile] login action failed', error instanceof Error ? error.message : error)
      Alert.alert('登录失败', error instanceof Error ? error.message : fallback)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Page title="Food Link" subtitle="先用开发账号进入 App 框架，后续再接正式 App 登录。">
      <Card>
        <Text style={styles.sectionTitle}>开发登录</Text>
        <Text style={styles.subtitle}>默认会自动创建或复用一个 App 测试用户。</Text>
        <AppButton
          label="一键登录测试账号"
          loading={loading}
          onPress={() => run(loginWithDebugAccount, '请确认后端运行在 development 环境')}
        />
        <Text style={styles.debugTitle}>按用户 ID 代登录（备用）</Text>
        <TextInput value={userId} onChangeText={setUserId} placeholder="用户 ID" autoCapitalize="none" style={styles.input} />
        <TextInput value={password} onChangeText={setPassword} placeholder="调试密码" secureTextEntry style={styles.input} />
        <AppButton
          label="用指定用户 ID 登录"
          variant="secondary"
          loading={loading}
          onPress={() => run(() => loginWithUserId(userId, password), '请检查用户 ID 和调试密码')}
        />
      </Card>
      <Text style={styles.apiText}>API: {API_BASE_URL}</Text>
    </Page>
  )
}

const styles = StyleSheet.create({
  sectionTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: colors.text,
    marginBottom: 8,
  },
  subtitle: {
    color: colors.textSecondary,
    marginBottom: 16,
  },
  debugTitle: {
    marginTop: 22,
    marginBottom: 10,
    color: colors.textSecondary,
    fontWeight: '700',
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 12,
    fontSize: 16,
    backgroundColor: '#fff',
  },
  apiText: {
    color: colors.textMuted,
    fontSize: 12,
  },
})
