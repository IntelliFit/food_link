import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native'
import { CircleAlert, CircleCheck, Info, TriangleAlert, type LucideIcon } from 'lucide-react-native'
import { AppButton } from '../components/AppButton'
import { colors, radius, shadow } from '../theme'

export type AppDialogKind = 'info' | 'success' | 'warning' | 'danger'
export type AppDialogResult = 'confirm' | 'cancel' | 'dismiss'

export interface AppDialogOptions {
  title: string
  message?: string
  kind?: AppDialogKind
  confirmText?: string
  cancelText?: string
  onConfirm?: () => void | Promise<void>
  onCancel?: () => void | Promise<void>
}

interface PendingDialog extends AppDialogOptions {
  resolve: (result: AppDialogResult) => void
}

interface DialogContextValue {
  showDialog: (options: AppDialogOptions) => Promise<AppDialogResult>
  alert: (title: string, message?: string, kind?: AppDialogKind) => Promise<AppDialogResult>
  confirm: (options: AppDialogOptions) => Promise<boolean>
}

const DialogContext = createContext<DialogContextValue | null>(null)
type CompatibleAlertButton = {
  text?: string
  style?: 'default' | 'cancel' | 'destructive'
  onPress?: () => void | Promise<void>
}

type CompatibleAlertHandler = (title: string, message?: string, buttons?: CompatibleAlertButton[]) => Promise<void>

let compatibleAlertHandler: CompatibleAlertHandler | null = null
const pendingCompatibleAlerts: Array<{ title: string; message?: string; buttons?: CompatibleAlertButton[] }> = []

export const AppAlert = {
  alert(title: string, message?: string, buttons?: CompatibleAlertButton[]) {
    if (!compatibleAlertHandler) {
      pendingCompatibleAlerts.push({ title, message, buttons })
      return
    }
    void compatibleAlertHandler(title, message, buttons)
  },
}

export function DialogProvider({ children }: { children: ReactNode }) {
  const [dialog, setDialog] = useState<PendingDialog | null>(null)

  const close = useCallback(async (result: AppDialogResult) => {
    const current = dialog
    if (!current) return
    setDialog(null)
    try {
      if (result === 'confirm') await current.onConfirm?.()
      if (result === 'cancel') await current.onCancel?.()
    } finally {
      current.resolve(result)
    }
  }, [dialog])

  const showDialog = useCallback((options: AppDialogOptions) => {
    return new Promise<AppDialogResult>((resolve) => {
      setDialog({ ...options, resolve })
    })
  }, [])

  const value = useMemo<DialogContextValue>(() => ({
    showDialog,
    alert: (title, message, kind = 'info') => showDialog({ title, message, kind, confirmText: '知道了' }),
    confirm: async (options) => {
      const result = await showDialog({
        kind: 'warning',
        confirmText: '确认',
        cancelText: '取消',
        ...options,
      })
      return result === 'confirm'
    },
  }), [showDialog])

  const compatibleAlert = useCallback<CompatibleAlertHandler>(async (title, message, buttons) => {
    const actions = buttons && buttons.length > 0 ? buttons : [{ text: '知道了' }]
    if (actions.length === 1) {
      const action = actions[0]
      const result = await showDialog({
        title,
        message,
        kind: action.style === 'destructive' ? 'danger' : 'info',
        confirmText: action.text || '知道了',
      })
      if (result === 'confirm') await action.onPress?.()
      return
    }

    const cancelAction = actions.find((action) => action.style === 'cancel') || actions[0]
    const confirmAction = [...actions].reverse().find((action) => action.style !== 'cancel') || actions[actions.length - 1]
    const result = await showDialog({
      title,
      message,
      kind: confirmAction.style === 'destructive' ? 'danger' : 'warning',
      confirmText: confirmAction.text || '确认',
      cancelText: cancelAction.text || '取消',
    })
    if (result === 'confirm') await confirmAction.onPress?.()
    if (result === 'cancel') await cancelAction.onPress?.()
  }, [showDialog])

  useEffect(() => {
    compatibleAlertHandler = compatibleAlert
    const queuedAlerts = pendingCompatibleAlerts.splice(0)
    queuedAlerts.forEach((alert) => {
      void compatibleAlert(alert.title, alert.message, alert.buttons)
    })
    return () => {
      if (compatibleAlertHandler === compatibleAlert) compatibleAlertHandler = null
    }
  }, [compatibleAlert])

  const kind = dialog?.kind || 'info'
  const Icon = kindMeta[kind].icon

  return (
    <DialogContext.Provider value={value}>
      {children}
      <Modal visible={Boolean(dialog)} transparent animationType="fade" onRequestClose={() => close('dismiss')}>
        <View style={styles.backdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => close('dismiss')} />
          {dialog ? (
            <View style={styles.card}>
              <View style={[styles.iconBubble, styles[`${kind}Icon`]]}>
                <Icon size={24} color={kindMeta[kind].color} strokeWidth={2.6} />
              </View>
              <Text style={styles.title}>{dialog.title}</Text>
              {dialog.message ? <Text style={styles.message}>{dialog.message}</Text> : null}
              <View style={[styles.footer, dialog.cancelText ? styles.twoActions : null]}>
                {dialog.cancelText ? (
                  <View style={[styles.actionItem, styles.twoActionItem]}>
                    <AppButton label={dialog.cancelText} variant="secondary" onPress={() => close('cancel')} />
                  </View>
                ) : null}
                <View style={[styles.actionItem, dialog.cancelText ? styles.twoActionItem : null]}>
                  <AppButton
                    label={dialog.confirmText || '知道了'}
                    variant={kind === 'danger' ? 'danger' : 'primary'}
                    onPress={() => close('confirm')}
                  />
                </View>
              </View>
            </View>
          ) : null}
        </View>
      </Modal>
    </DialogContext.Provider>
  )
}

export function useAppDialog() {
  const context = useContext(DialogContext)
  if (!context) throw new Error('useAppDialog must be used inside DialogProvider')
  return context
}

const kindMeta: Record<AppDialogKind, { icon: LucideIcon; color: string }> = {
  info: { icon: Info, color: colors.brandDark },
  success: { icon: CircleCheck, color: colors.brandDark },
  warning: { icon: TriangleAlert, color: colors.orange },
  danger: { icon: CircleAlert, color: colors.danger },
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
    backgroundColor: 'rgba(15, 23, 42, 0.46)',
  },
  card: {
    width: '100%',
    maxWidth: 380,
    alignItems: 'stretch',
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    paddingHorizontal: 24,
    paddingTop: 26,
    paddingBottom: 24,
    ...shadow,
  },
  iconBubble: {
    width: 42,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 21,
    marginBottom: 16,
  },
  infoIcon: {
    backgroundColor: colors.brandSoft,
  },
  successIcon: {
    backgroundColor: colors.brandSoft,
  },
  warningIcon: {
    backgroundColor: '#fff7ed',
  },
  dangerIcon: {
    backgroundColor: '#fee2e2',
  },
  title: {
    color: colors.text,
    fontSize: 20,
    fontWeight: '800',
    lineHeight: 26,
  },
  message: {
    color: colors.textSecondary,
    fontSize: 15,
    lineHeight: 22,
    marginTop: 10,
  },
  footer: {
    marginTop: 24,
    paddingTop: 2,
  },
  twoActions: {
    flexDirection: 'row',
    gap: 10,
  },
  actionItem: {
    width: '100%',
    minHeight: 48,
  },
  twoActionItem: {
    flex: 1,
    minHeight: 48,
  },
})
