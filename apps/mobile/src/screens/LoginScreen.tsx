import { useEffect, useState } from 'react'
import { Alert, Linking, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { AppButton } from '../components/AppButton'
import { Card } from '../components/Card'
import { Page } from '../components/Page'
import { API_BASE_URL, SHOW_DEBUG_LOGIN } from '../config'
import { useAuth } from '../providers/AuthProvider'
import { colors } from '../theme'

export function LoginScreen() {
  const { loginWithWechat, loginWithPassword, registerWithPassword, loginWithDebugAccount, loginWithUserId } = useAuth()
  const [loading, setLoading] = useState(false)
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [nickname, setNickname] = useState('')
  const [accountUsername, setAccountUsername] = useState('')
  const [accountPassword, setAccountPassword] = useState('')
  const [inviteCode, setInviteCode] = useState('')
  const [userId, setUserId] = useState('')
  const [password, setPassword] = useState('')

  useEffect(() => {
    const applyInviteCodeFromUrl = (url?: string | null) => {
      const code = extractInviteCode(url)
      if (code) setInviteCode(code)
    }

    Linking.getInitialURL().then(applyInviteCodeFromUrl).catch(() => undefined)
    const subscription = Linking.addEventListener('url', ({ url }) => applyInviteCodeFromUrl(url))
    return () => subscription.remove()
  }, [])

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
    <Page title="Food Link" subtitle="使用微信或账号密码登录，继续同步小程序中的饮食、分析、圈子和会员数据。">
      <Card>
        <Text style={styles.sectionTitle}>登录</Text>
        <Text style={styles.subtitle}>使用微信授权快速登录，饮食、分析、圈子和会员数据会同步到当前账号。</Text>
        <AppButton
          label="微信一键登录"
          loading={loading}
          onPress={() => run(() => loginWithWechat(inviteCode), '请稍后重试，或使用账号密码登录')}
        />
        <TextInput
          value={inviteCode}
          onChangeText={(value) => setInviteCode(value.trim())}
          placeholder="邀请码（可选）"
          autoCapitalize="characters"
          autoCorrect={false}
          style={styles.input}
        />
        <Text style={styles.hint}>微信登录或注册账号时填写邀请码，可继承小程序邀请奖励关系。</Text>
        <View style={styles.segment}>
          <Pressable
            style={[styles.segmentItem, mode === 'login' && styles.segmentItemActive]}
            onPress={() => setMode('login')}
          >
            <Text style={[styles.segmentText, mode === 'login' && styles.segmentTextActive]}>账号登录</Text>
          </Pressable>
          <Pressable
            style={[styles.segmentItem, mode === 'register' && styles.segmentItemActive]}
            onPress={() => setMode('register')}
          >
            <Text style={[styles.segmentText, mode === 'register' && styles.segmentTextActive]}>注册账号</Text>
          </Pressable>
        </View>
        {mode === 'register' && (
          <TextInput
            value={nickname}
            onChangeText={setNickname}
            placeholder="昵称（可选）"
            autoCapitalize="none"
            style={styles.input}
          />
        )}
        <TextInput
          value={accountUsername}
          onChangeText={setAccountUsername}
          placeholder="用户名"
          autoCapitalize="none"
          autoCorrect={false}
          style={styles.input}
        />
        <TextInput
          value={accountPassword}
          onChangeText={setAccountPassword}
          placeholder="密码"
          secureTextEntry
          style={styles.input}
        />
        <AppButton
          label={mode === 'login' ? '登录' : '注册并登录'}
          variant="secondary"
          loading={loading}
          onPress={() => run(
            () => mode === 'login'
              ? loginWithPassword(accountUsername, accountPassword)
              : registerWithPassword(accountUsername, accountPassword, nickname, inviteCode),
            mode === 'login' ? '请检查用户名和密码' : '请检查用户名是否可用，密码至少 8 位',
          )}
        />
      </Card>
      {SHOW_DEBUG_LOGIN ? (
        <>
          <Card>
            <Text style={styles.sectionTitle}>开发登录</Text>
            <Text style={styles.subtitle}>仅用于本地调试，正式包不会展示给普通用户。</Text>
            <AppButton
              label="一键登录测试账号"
              loading={loading}
              onPress={() => run(loginWithDebugAccount, '请确认开发后端可用')}
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
        </>
      ) : null}
    </Page>
  )
}

function extractInviteCode(url?: string | null): string {
  if (!url) return ''
  const query = url.includes('?') ? url.slice(url.indexOf('?') + 1) : url
  const params = query.split(/[&#]/)
  for (const param of params) {
    const [rawKey, rawValue = ''] = param.split('=')
    const key = decodeURIComponent(rawKey || '').trim()
    if (!['fi', 'invite_code', 'inviteCode'].includes(key)) continue
    try {
      return decodeURIComponent(rawValue.replace(/\+/g, ' ')).trim()
    } catch {
      return rawValue.trim()
    }
  }
  return ''
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
    lineHeight: 21,
  },
  hint: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 18,
    marginTop: -4,
    marginBottom: 12,
  },
  segment: {
    flexDirection: 'row',
    backgroundColor: '#f1f5f9',
    borderRadius: 12,
    padding: 4,
    marginTop: 18,
    marginBottom: 14,
  },
  segmentItem: {
    flex: 1,
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 9,
  },
  segmentItemActive: {
    backgroundColor: '#fff',
    shadowColor: '#0f172a',
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 1,
  },
  segmentText: {
    color: colors.textSecondary,
    fontWeight: '800',
  },
  segmentTextActive: {
    color: colors.brandDark,
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
