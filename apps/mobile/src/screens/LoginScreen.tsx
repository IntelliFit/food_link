import { useCallback, useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Image, Keyboard, KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
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

const DEFAULT_SMS_COOLDOWN_SECONDS = 30
const appIcon = require('../../assets/icon.png')

export function LoginScreen() {
  const insets = useSafeAreaInsets()
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  const dialog = useAppDialog()
  const {
    loginWithWechat,
    loginWithPassword,
    loginWithSMSCode,
    resetPasswordWithSMS,
    loginWithDebugAccount,
    loginWithUserId,
  } = useAuth()
  const [loading, setLoading] = useState(false)
  const [loginMethod, setLoginMethod] = useState<'sms' | 'password'>('sms')
  const [passwordResetMode, setPasswordResetMode] = useState(false)
  const [accountPhone, setAccountPhone] = useState('')
  const [smsCode, setSmsCode] = useState('')
  const [accountPassword, setAccountPassword] = useState('')
  const [resetPassword, setResetPassword] = useState('')
  const [resetPasswordConfirm, setResetPasswordConfirm] = useState('')
  const [smsSending, setSmsSending] = useState(false)
  const [smsCooldownSeconds, setSmsCooldownSeconds] = useState(0)
  const [agreementAccepted, setAgreementAccepted] = useState(false)
  const [inviteCode, setInviteCode] = useState('')
  const [userId, setUserId] = useState('')
  const [debugPassword, setDebugPassword] = useState('')
  const [keyboardHeight, setKeyboardHeight] = useState(0)
  const scrollRef = useRef<ScrollView>(null)

  useEffect(() => {
    const applyInviteCodeFromUrl = (url?: string | null) => {
      const code = extractInviteCode(url)
      if (code) setInviteCode(code)
    }

    Linking.getInitialURL().then(applyInviteCodeFromUrl).catch(() => undefined)
    const subscription = Linking.addEventListener('url', ({ url }) => applyInviteCodeFromUrl(url))
    return () => subscription.remove()
  }, [])

  useEffect(() => {
    if (smsCooldownSeconds <= 0) return undefined
    const timer = setTimeout(() => {
      setSmsCooldownSeconds((value) => Math.max(0, value - 1))
    }, 1000)
    return () => clearTimeout(timer)
  }, [smsCooldownSeconds])

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow'
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide'
    const showSubscription = Keyboard.addListener(showEvent, (event) => {
      setKeyboardHeight(event.endCoordinates?.height ?? 0)
    })
    const hideSubscription = Keyboard.addListener(hideEvent, () => {
      setKeyboardHeight(0)
    })
    return () => {
      showSubscription.remove()
      hideSubscription.remove()
    }
  }, [])

  const scrollLoginFieldIntoView = useCallback((field: 'phone' | 'code') => {
    const y = field === 'code' ? 270 : 210
    const scroll = () => scrollRef.current?.scrollTo({ y, animated: true })
    setTimeout(scroll, 80)
    setTimeout(scroll, 260)
  }, [])

  const run = async (fn: () => Promise<void>, fallback: string, title = '登录失败') => {
    setLoading(true)
    try {
      console.log('[mobile] login action started')
      await fn()
      console.log('[mobile] login action succeeded')
    } catch (error) {
      console.log('[mobile] login action failed', error instanceof Error ? error.message : error)
      dialog.alert(title, userFacingErrorMessage(error, fallback), 'warning')
    } finally {
      setLoading(false)
    }
  }

  const ensureAgreementAccepted = () => {
    if (agreementAccepted) return true
    dialog.alert('请先同意协议', '请阅读并同意用户协议、隐私政策和会员服务协议后继续。', 'warning')
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
      const result = await apiClient.sendSMSCode({ phone })
      const cooldownSeconds = normalizePositiveSeconds(result.cooldown_seconds ?? result.retry_after_seconds) || DEFAULT_SMS_COOLDOWN_SECONDS
      setSmsCooldownSeconds(cooldownSeconds)
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

  const loginWithAccountPassword = () => {
    const phone = accountPhone.trim()
    const password = accountPassword.trim()
    if (!isValidMainlandPhone(phone)) {
      dialog.alert('手机号有误', '请输入 11 位大陆手机号。', 'warning')
      return
    }
    if (!password) {
      dialog.alert('请输入密码', '请输入已设置的 App 登录密码。', 'warning')
      return
    }
    if (!ensureAgreementAccepted()) return
    run(() => loginWithPassword(phone, password), '请检查手机号和密码')
  }

  const submitPasswordReset = () => {
    const phone = accountPhone.trim()
    const code = smsCode.trim()
    const password = resetPassword.trim()
    if (!isValidMainlandPhone(phone)) {
      dialog.alert('手机号有误', '请输入 11 位大陆手机号。', 'warning')
      return
    }
    if (!/^\d{6}$/.test(code)) {
      dialog.alert('验证码有误', '请输入 6 位短信验证码。', 'warning')
      return
    }
    if (password.length < 8) {
      dialog.alert('密码太短', '新密码至少需要 8 位。', 'warning')
      return
    }
    if (password !== resetPasswordConfirm.trim()) {
      dialog.alert('两次密码不一致', '请重新输入确认密码。', 'warning')
      return
    }
    if (!ensureAgreementAccepted()) return
    run(
      () => resetPasswordWithSMS(phone, code, password),
      '请确认手机号、验证码和新密码后重试',
      '重置失败',
    )
  }

  const openPasswordReset = () => {
    setPasswordResetMode(true)
    setSmsCode('')
    setResetPassword('')
    setResetPasswordConfirm('')
  }

  const closePasswordReset = () => {
    setPasswordResetMode(false)
    setLoginMethod('password')
    setSmsCode('')
    setResetPassword('')
    setResetPasswordConfirm('')
  }

  const loginWithWechatAccount = () => {
    if (!ensureAgreementAccepted()) return
    run(() => loginWithWechat(inviteCode), '请稍后重试，或使用手机验证码登录')
  }

  const smsLoginReady = isValidMainlandPhone(accountPhone) && /^\d{6}$/.test(smsCode.trim())
  const passwordLoginReady = isValidMainlandPhone(accountPhone) && accountPassword.trim().length > 0
  const passwordResetReady = isValidMainlandPhone(accountPhone)
    && /^\d{6}$/.test(smsCode.trim())
    && resetPassword.trim().length >= 8
    && resetPassword.trim() === resetPasswordConfirm.trim()
  const sendCodeReady = isValidMainlandPhone(accountPhone)
  const sendCodeDisabled = smsSending || smsCooldownSeconds > 0 || !sendCodeReady
  const sendCodeLabel = smsCooldownSeconds > 0 ? `${smsCooldownSeconds}s 后重发` : '发送验证码'

  const keyboardBottomPadding = keyboardHeight > 0 ? keyboardHeight + insets.bottom + 32 : insets.bottom + 40

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={0}
    >
      <ScrollView
        ref={scrollRef}
        style={styles.scroller}
        contentContainerStyle={[
          styles.content,
          { paddingTop: Math.max(insets.top + 96, 132), paddingBottom: keyboardBottomPadding },
        ]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
      >
      <View style={styles.hero}>
        <View style={styles.logoWrapper}>
          <Image source={appIcon} style={styles.logoImage} resizeMode="contain" />
        </View>
        <Text style={styles.brand}>智健食探</Text>
        <Text style={styles.tagline}>记录饮食，连接健康</Text>
      </View>

      <View style={styles.form}>
        {passwordResetMode ? (
          <View style={styles.resetHeader}>
            <Text style={styles.formTitle}>短信重置密码</Text>
            <Text style={styles.formHint}>验证账号绑定手机号后，将直接设置新密码并登录。</Text>
          </View>
        ) : (
          <View style={styles.loginMethodTabs}>
            <Pressable
              accessibilityRole="tab"
              accessibilityState={{ selected: loginMethod === 'sms' }}
              onPress={() => setLoginMethod('sms')}
              style={[styles.loginMethodTab, loginMethod === 'sms' && styles.loginMethodTabActive]}
            >
              <Text style={[styles.loginMethodText, loginMethod === 'sms' && styles.loginMethodTextActive]}>验证码登录</Text>
            </Pressable>
            <Pressable
              accessibilityRole="tab"
              accessibilityState={{ selected: loginMethod === 'password' }}
              onPress={() => setLoginMethod('password')}
              style={[styles.loginMethodTab, loginMethod === 'password' && styles.loginMethodTabActive]}
            >
              <Text style={[styles.loginMethodText, loginMethod === 'password' && styles.loginMethodTextActive]}>密码登录</Text>
            </Pressable>
          </View>
        )}
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
            onFocus={() => scrollLoginFieldIntoView('phone')}
          />
        </View>

        {loginMethod === 'sms' || passwordResetMode ? <View style={styles.codeRow}>
          <TextInput
            value={smsCode}
            onChangeText={(value) => setSmsCode(value.replace(/\D/g, '').slice(0, 6))}
            placeholder="验证码"
            keyboardType="number-pad"
            maxLength={6}
            style={styles.lineInput}
            placeholderTextColor={colors.textMuted}
            onFocus={() => scrollLoginFieldIntoView('code')}
          />
          <Pressable
            disabled={sendCodeDisabled}
            onPress={sendSMSCode}
            style={({ pressed }) => [
              styles.codeTextButton,
              pressed && !sendCodeDisabled && styles.pressed,
              sendCodeDisabled && styles.disabled,
            ]}
          >
            {smsSending ? (
              <ActivityIndicator color={colors.brandDark} />
            ) : (
              <Text style={[styles.codeText, (!sendCodeReady || smsCooldownSeconds > 0) && styles.codeTextDisabled]}>
                {sendCodeLabel}
              </Text>
            )}
          </Pressable>
        </View> : null}

        {loginMethod === 'password' && !passwordResetMode ? (
          <>
            <View style={styles.passwordRow}>
              <TextInput
                value={accountPassword}
                onChangeText={setAccountPassword}
                placeholder="密码"
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
                style={styles.lineInput}
                placeholderTextColor={colors.textMuted}
                onFocus={() => scrollLoginFieldIntoView('code')}
              />
            </View>
            <View style={styles.authSecondaryRow}>
              <Text style={styles.authSecondaryHint}>使用账号安全中设置的手机号和密码</Text>
              <Pressable accessibilityRole="button" onPress={openPasswordReset} hitSlop={8}>
                <Text style={styles.authLinkText}>忘记密码</Text>
              </Pressable>
            </View>
          </>
        ) : null}

        {passwordResetMode ? (
          <>
            <View style={styles.passwordRow}>
              <TextInput
                value={resetPassword}
                onChangeText={setResetPassword}
                placeholder="新密码（至少 8 位）"
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
                style={styles.lineInput}
                placeholderTextColor={colors.textMuted}
              />
            </View>
            <View style={styles.passwordRow}>
              <TextInput
                value={resetPasswordConfirm}
                onChangeText={setResetPasswordConfirm}
                placeholder="再次输入新密码"
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
                style={styles.lineInput}
                placeholderTextColor={colors.textMuted}
              />
            </View>
            <Pressable accessibilityRole="button" onPress={closePasswordReset} style={styles.resetBackButton}>
              <Text style={styles.authLinkText}>返回密码登录</Text>
            </Pressable>
          </>
        ) : null}

        <Pressable
          disabled={loading || (passwordResetMode ? !passwordResetReady : loginMethod === 'sms' ? !smsLoginReady : !passwordLoginReady)}
          onPress={passwordResetMode ? submitPasswordReset : loginMethod === 'sms' ? loginWithCode : loginWithAccountPassword}
          style={({ pressed }) => [
            styles.primaryButton,
            pressed && !loading && styles.pressed,
            (loading || (passwordResetMode ? !passwordResetReady : loginMethod === 'sms' ? !smsLoginReady : !passwordLoginReady)) && styles.disabled,
          ]}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.primaryButtonText}>
              {passwordResetMode ? '验证并重置密码' : loginMethod === 'sms' ? '登录 / 注册' : '手机号密码登录'}
            </Text>
          )}
        </Pressable>

        <Pressable
          disabled={loading}
          onPress={loginWithWechatAccount}
          style={({ pressed }) => [
            styles.skipLoginButton,
            pressed && !loading && styles.pressed,
            loading && styles.disabled,
          ]}
        >
          <Text style={styles.skipLoginText}>微信一键登录</Text>
        </Pressable>

        <View style={styles.agreementRow}>
          <Pressable
            onPress={() => setAgreementAccepted((value) => !value)}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: agreementAccepted }}
            accessibilityLabel="同意用户协议、隐私政策和会员服务协议"
            style={[styles.checkbox, agreementAccepted && styles.checkboxActive]}
          >
            <Text style={styles.checkboxText}>{agreementAccepted ? '✓' : ''}</Text>
          </Pressable>
          <Text style={styles.agreementText}>
            我已阅读并同意
            <Text style={styles.linkText} onPress={() => navigation.navigate('Agreements')}>《用户协议》</Text>
            <Text style={styles.linkText} onPress={() => navigation.navigate('PrivacyPolicy')}>《隐私政策》</Text>
            <Text style={styles.linkText} onPress={() => navigation.navigate('MembershipAgreement')}>《会员服务协议》</Text>
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
          <TextInput value={debugPassword} onChangeText={setDebugPassword} placeholder="调试密码" secureTextEntry style={styles.debugInput} />
          <AppButton
            label="用指定用户 ID 登录"
            variant="secondary"
            loading={loading}
            onPress={() => run(() => loginWithUserId(userId, debugPassword), '请检查用户 ID 和调试密码')}
          />
          <Text style={styles.apiText}>API: {API_BASE_URL}</Text>
        </View>
      ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
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
  return /^1[3-9]\d{9}$/.test(phone.trim())
}

function normalizePositiveSeconds(value: unknown): number {
  const seconds = Number(value)
  if (!Number.isFinite(seconds) || seconds <= 0) return 0
  return Math.max(1, Math.ceil(seconds))
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#fff',
  },
  scroller: {
    flex: 1,
    backgroundColor: '#fff',
  },
  content: {
    flexGrow: 1,
    paddingHorizontal: 20,
  },
  hero: {
    alignItems: 'center',
    marginBottom: 94,
  },
  logoWrapper: {
    width: 80,
    height: 80,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
    borderRadius: 16,
    backgroundColor: '#f0fdf4',
  },
  logoImage: {
    width: 80,
    height: 80,
  },
  brand: {
    color: '#333333',
    fontSize: 20,
    fontWeight: '800',
    textAlign: 'center',
  },
  tagline: {
    marginTop: 6,
    color: '#999999',
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },
  form: {
    gap: 0,
  },
  resetHeader: {
    alignItems: 'center',
    marginBottom: 8,
  },
  formTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '900',
    marginBottom: 6,
  },
  formHint: {
    marginBottom: 8,
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '800',
    textAlign: 'center',
  },
  loginMethodTabs: {
    flexDirection: 'row',
    alignSelf: 'center',
    padding: 3,
    borderRadius: 999,
    backgroundColor: '#f1f5f9',
    marginBottom: 14,
  },
  loginMethodTab: {
    minWidth: 112,
    minHeight: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
    paddingHorizontal: 16,
  },
  loginMethodTabActive: {
    backgroundColor: '#ffffff',
  },
  loginMethodText: {
    color: colors.textMuted,
    fontSize: 14,
    fontWeight: '800',
  },
  loginMethodTextActive: {
    color: colors.brandDark,
  },
  phoneRow: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  countryCode: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '700',
  },
  inputDivider: {
    width: 1,
    height: 24,
    marginHorizontal: 14,
    backgroundColor: '#d1d5db',
  },
  codeRow: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
    marginTop: 12,
  },
  passwordRow: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
    marginTop: 12,
  },
  authSecondaryRow: {
    minHeight: 38,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    marginTop: 4,
  },
  authSecondaryHint: {
    flex: 1,
    color: colors.textMuted,
    fontSize: 11,
    lineHeight: 16,
  },
  authLinkText: {
    color: colors.brandDark,
    fontSize: 13,
    fontWeight: '900',
  },
  resetBackButton: {
    minHeight: 38,
    alignItems: 'flex-end',
    justifyContent: 'center',
    marginTop: 4,
  },
  lineInput: {
    flex: 1,
    color: colors.text,
    fontSize: 16,
    paddingVertical: 8,
  },
  codeTextButton: {
    minWidth: 98,
    minHeight: 38,
    alignItems: 'flex-end',
    justifyContent: 'center',
    paddingLeft: 12,
  },
  codeText: {
    color: colors.brandDark,
    fontSize: 14,
    fontWeight: '800',
  },
  codeTextDisabled: {
    color: colors.textMuted,
  },
  primaryButton: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
    backgroundColor: colors.brand,
    marginTop: 24,
  },
  primaryButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '800',
  },
  skipLoginButton: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
    backgroundColor: colors.brand,
    marginTop: 14,
  },
  skipLoginText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '800',
  },
  agreementRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    marginTop: 24,
  },
  checkbox: {
    width: 16,
    height: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    marginTop: 2,
  },
  checkboxActive: {
    borderColor: colors.brand,
    backgroundColor: colors.brand,
  },
  checkboxText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '900',
    lineHeight: 13,
  },
  agreementText: {
    flex: 1,
    color: '#999999',
    fontSize: 12,
    lineHeight: 19,
  },
  linkText: {
    color: colors.brand,
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
    marginTop: 160,
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
