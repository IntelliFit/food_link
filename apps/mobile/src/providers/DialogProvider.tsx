import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native'
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

  const kind = dialog?.kind || 'info'
  const iconText = kindMeta[kind].icon

  return (
    <DialogContext.Provider value={value}>
      {children}
      <Modal visible={Boolean(dialog)} transparent animationType="fade" onRequestClose={() => close('dismiss')}>
        <View style={styles.backdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => close('dismiss')} />
          {dialog ? (
            <View style={styles.card}>
              <View style={[styles.iconBubble, styles[`${kind}Icon`]]}>
                <Text style={[styles.iconText, styles[`${kind}IconText`]]}>{iconText}</Text>
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

const kindMeta: Record<AppDialogKind, { icon: string }> = {
  info: { icon: 'i' },
  success: { icon: '✓' },
  warning: { icon: '!' },
  danger: { icon: '!' },
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
  iconText: {
    fontSize: 22,
    fontWeight: '900',
  },
  infoIconText: {
    color: colors.brandDark,
  },
  successIconText: {
    color: colors.brandDark,
  },
  warningIconText: {
    color: colors.orange,
  },
  dangerIconText: {
    color: colors.danger,
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
