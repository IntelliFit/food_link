import { Button, Text, View } from '@tarojs/components'
import type { ITouchEvent } from '@tarojs/components'
import type { ReactNode } from 'react'
import './AppButton.scss'

interface AppButtonProps {
  className?: string
  /** Same names and defaults as the @taroify/core Button it replaces, so page styles keep working. */
  color?: 'default' | 'primary'
  variant?: 'contained' | 'text'
  shape?: 'square' | 'round'
  block?: boolean
  disabled?: boolean
  loading?: boolean
  /** Submits or resets the enclosing Form through a transparent native button, as @taroify/core did. */
  formType?: 'submit' | 'reset'
  onClick?: (event: ITouchEvent) => void
  children?: ReactNode
}

/**
 * A plain button for pages that used @taroify/core's Button without openType.
 * Dropping the library keeps it (and the lodash it pulls in) out of the main package.
 */
export function AppButton({
  className, color = 'default', variant = 'contained', shape = 'square', block = false, disabled = false, loading = false, formType, onClick, children,
}: AppButtonProps) {
  const classes = [
    'app-btn',
    variant === 'text' ? 'app-btn--text' : 'app-btn--contained',
    `app-btn--${color}`,
    shape === 'round' ? 'app-btn--round' : '',
    block ? 'app-btn--block' : '',
    disabled ? 'app-btn--disabled' : '',
    loading ? 'app-btn--loading' : '',
    className ?? '',
  ].filter(Boolean).join(' ')
  return (
    <View
      className={classes}
      hoverClass={disabled || loading ? 'none' : 'app-btn--active'}
      role='button'
      aria-disabled={disabled || loading}
      onClick={(event) => { if (!disabled && !loading) onClick?.(event) }}
    >
      {loading && <Text className='app-btn__spinner' />}
      {children}
      {formType && <Button className='app-btn__native' formType={formType} disabled={disabled || loading} />}
    </View>
  )
}
