import { useEffect, useState } from 'react'
import { ActivityIndicator, Linking, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { useNavigation } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { AppButton } from '../components/AppButton'
import { apiClient } from '../api'
import { API_BASE_URL, SHOW_DEBUG_LOGIN } from '../config'
import type { RootStackParamList } from '../navigation/types'
import { useAuth } from '../providers/AuthProvider'
import { useAppDialog } from '../providers/DialogProvider'
import { colors } from '../theme'
import { userFacingErrorMessage } from '../utils/errors'

export function LoginScreen() {
  const insets = useSafeAreaInsets()
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  const dialog = useAppDialog()
  const {
    loginWithWechat,
    loginWithSMSCode,
    loginWithDebugAccount,
    loginWithUserId,
  } = useAuth()
  const [loading, setLoading] = useState(false)
  const [accountPhone, setAccountPhone] = useState('')
  const [smsCode, setSmsCode] = useState('')
  const [smsSending, setSmsSending] = useState(false)
  const [agreementAccepted, setAgreementAccepted] = useState(false)
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
      dialog.alert('登录失败', userFacingErrorMessage(error, fallback), 'warning')
    } finally {
      setLoading(false)
    }
  }

  const ensureAgreementAccepted = () => {
    if (agreementAccepted) return true
    dialog.alert('请先同意协议', '请阅读并同意用户协议和隐私政策后继续。', 'warning')
    return false
  }

  const sendSMSCode = async () => {
    const phone = accountPhone.trim()
    if (!isValidMainlandPhone(phone)) {
      dialog.alert('手机号有误', '请输入 11 位大陆手机号。', 'warning')
      return
    }
    setSmsSending(true)
    try {
      await apiClient.sendSMSCode({ phone })
      dialog.alert('验证码已发送', '请查看手机短信，验证码 15 分钟内有效。', 'success')
    } catch (error) {
      dialog.alert('发送失败', userFacingErrorMessage(error, '请稍后再试'), 'warning')
    } finally {
      setSmsSending(false)
    }
  }

  const loginWithCode = () => {
    const phone = accountPhone.trim()
    const code = smsCode.trim()
    if (!isValidMainlandPhone(phone)) {
      dialog.alert('手机号有误', '请输入 11 位大陆手机号。', 'warning')
      return
    }
    if (!/^\d{6}$/.test(code)) {
      dialog.alert('验证码有误', '请输入 6 位短信验证码。', 'warning')
      return
    }
    if (!ensureAgreementAccepted()) return
    run(() => loginWithSMSCode(phone, code, inviteCode), '请检查手机号和验证码')
  }

  const loginWithWechatAccount = () => {
    if (!ensureAgreementAccepted()) return
    run(() => loginWithWechat(inviteCode), '请稍后重试，或使用手机验证码登录')
  }

  const smsLoginReady = isValidMainlandPhone(accountPhone) && /^\d{6}$/.test(smsCode.trim())
  const sendCodeReady = isValidMainlandPhone(accountPhone)

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[
        styles.content,
        { paddingTop: Math.max(insets.top + 42, 76), paddingBottom: insets.bottom + 40 },
      ]}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.hero}>
        <Text style={styles.brand}>食探</Text>
        <Text style={styles.tagline}>手机号验证后自动登录</Text>
      </View>

      <View style={styles.form}>
        <View style={styles.phoneRow}>
          <Text style={styles.countryCode}>+86</Text>
          <View style={styles.inputDivider} />
          <TextInput
            value={accountPhone}
            onChangeText={(value) => setAccountPhone(value.replace(/\D/g, '').slice(0, 11))}
            placeholder="手机号"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="phone-pad"
            style={styles.lineInput}
            placeholderTextColor={colors.textMuted}
          />
        </View>

        <View style={styles.codeRow}>
          <TextInput
            value={smsCode}
            onChangeText={(value) => setSmsCode(value.replace(/\D/g, '').slice(0, 6))}
            placeholder="验证码"
            keyboardType="number-pad"
            maxLength={6}
            style={styles.lineInput}
            placeholderTextColor={colors.textMuted}
          />
          <Pressable
            disabled={smsSending || !sendCodeReady}
            onPress={sendSMSCode}
            style={({ pressed }) => [
              styles.codeTextButton,
              pressed && !smsSending && sendCodeReady && styles.pressed,
              (smsSending || !sendCodeReady) && styles.disabled,
            ]}
          >
            {smsSending ? (
              <ActivityIndicator color={colors.brandDark} />
            ) : (
              <Text style={[styles.codeText, !sendCodeReady && styles.codeTextDisabled]}>发送验证码</Text>
            )}
          </Pressable>
        </View>

        <Pressable
          disabled={loading || !smsLoginReady}
          onPress={loginWithCode}
          style={({ pressed }) => [
            styles.primaryButton,
            pressed && smsLoginReady && !loading && styles.pressed,
            (loading || !smsLoginReady) && styles.disabled,
          ]}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.primaryButtonText}>登录 / 注册</Text>
          )}
        </Pressable>

        <Pressable
          disabled={loading}
          onPress={loginWithWechatAccount}
          style={({ pressed }) => [
            styles.wechatButton,
            pressed && !loading && styles.pressed,
            loading && styles.disabled,
          ]}
        >
          <Text style={styles.wechatMark}>微信</Text>
          <Text style={styles.wechatButtonText}>微信一键登录</Text>
        </Pressable>

        <View style={styles.agreementRow}>
          <Pressable
            onPress={() => setAgreementAccepted((value) => !value)}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: agreementAccepted }}
            accessibilityLabel="同意用户协议和隐私政策"
            style={[styles.checkbox, agreementAccepted && styles.checkboxActive]}
          >
            <Text style={styles.checkboxText}>{agreementAccepted ? '✓' : ''}</Text>
          </Pressable>
          <Text style={styles.agreementText}>
            我已阅读并同意
            <Text style={styles.linkText} onPress={() => navigation.navigate('Agreements')}>《用户协议》</Text>
            <Text style={styles.linkText} onPress={() => navigation.navigate('PrivacyPolicy')}>《隐私政策》</Text>
          </Text>
        </View>
      </View>

      {SHOW_DEBUG_LOGIN ? (
        <View style={styles.debugSection}>
          <Text style={styles.debugSectionTitle}>开发登录</Text>
          <Text style={styles.debugSubtitle}>本地调试入口，正式包不会展示。</Text>
          <AppButton
            label="一键登录测试账号"
            loading={loading}
            onPress={() => run(loginWithDebugAccount, '请确认开发后端可用')}
          />
          <Text style={styles.debugTitle}>按用户 ID 代登录（备用）</Text>
          <TextInput value={userId} onChangeText={setUserId} placeholder="用户 ID" autoCapitalize="none" style={styles.debugInput} />
          <TextInput value={password} onChangeText={setPassword} placeholder="调试密码" secureTextEntry style={styles.debugInput} />
          <AppButton
            label="用指定用户 ID 登录"
            variant="secondary"
            loading={loading}
            onPress={() => run(() => loginWithUserId(userId, password), '请检查用户 ID 和调试密码')}
          />
          <Text style={styles.apiText}>API: {API_BASE_URL}</Text>
        </View>
      ) : null}
    </ScrollView>
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

function isValidMainlandPhone(phone: string): boolean {
  return /^1\d{10}$/.test(phone.trim())
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#fff',
  },
  content: {
    flexGrow: 1,
    paddingHorizontal: 32,
  },
  hero: {
    marginTop: 96,
    marginBottom: 118,
  },
  brand: {
    color: colors.brand,
    fontSize: 56,
    fontWeight: '900',
    textAlign: 'center',
  },
  tagline: {
    marginTop: 22,
    color: colors.text,
    fontSize: 24,
    textAlign: 'center',
  },
  form: {
    gap: 0,
  },
  phoneRow: {
    minHeight: 60,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  countryCode: {
    color: colors.text,
    fontSize: 22,
  },
  inputDivider: {
    width: 1,
    height: 24,
    marginHorizontal: 14,
    backgroundColor: '#d1d5db',
  },
  codeRow: {
    minHeight: 60,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
    marginTop: 12,
  },
  lineInput: {
    flex: 1,
    color: colors.text,
    fontSize: 22,
    paddingVertical: 10,
  },
  codeTextButton: {
    minWidth: 106,
    minHeight: 44,
    alignItems: 'flex-end',
    justifyContent: 'center',
    paddingLeft: 12,
  },
  codeText: {
    color: colors.brandDark,
    fontSize: 16,
    fontWeight: '800',
  },
  codeTextDisabled: {
    color: colors.textMuted,
  },
  primaryButton: {
    minHeight: 58,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
    backgroundColor: colors.brand,
    marginTop: 34,
  },
  primaryButtonText: {
    color: '#fff',
    fontSize: 19,
    fontWeight: '800',
  },
  wechatButton: {
    minHeight: 58,
    flexDirection: 'row',
    gap: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
    backgroundColor: '#f3f4f6',
    marginTop: 16,
  },
  wechatMark: {
    color: colors.brandDark,
    fontSize: 14,
    fontWeight: '900',
  },
  wechatButtonText: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '700',
  },
  agreementRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    marginTop: 28,
  },
  checkbox: {
    width: 22,
    height: 22,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 11,
    borderWidth: 1.5,
    borderColor: '#d1d5db',
    marginTop: 2,
  },
  checkboxActive: {
    borderColor: colors.brand,
    backgroundColor: colors.brand,
  },
  checkboxText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '900',
    lineHeight: 18,
  },
  agreementText: {
    flex: 1,
    color: colors.textSecondary,
    fontSize: 14,
    lineHeight: 21,
  },
  linkText: {
    color: colors.blue,
    fontWeight: '800',
  },
  pressed: {
    opacity: 0.86,
  },
  disabled: {
    opacity: 0.48,
  },
  debugSection: {
    borderTopWidth: 1,
    borderTopColor: '#eef2f7',
    marginTop: 360,
    paddingTop: 20,
  },
  debugSectionTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: colors.text,
  },
  debugSubtitle: {
    color: colors.textSecondary,
    marginTop: 6,
    marginBottom: 14,
    lineHeight: 20,
  },
  debugTitle: {
    marginTop: 20,
    marginBottom: 10,
    color: colors.textSecondary,
    fontWeight: '700',
  },
  debugInput: {
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
    marginTop: 14,
  },
})
