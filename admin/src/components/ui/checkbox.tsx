import * as React from 'react'
import { Check } from 'lucide-react'
import { cn } from '@/lib/utils'

export type CheckboxProps = React.ComponentProps<'input'>

const Checkbox = React.forwardRef<HTMLInputElement, CheckboxProps>(
  ({ className, checked, onChange, ...props }, ref) => {
    return (
      <div className={cn('relative inline-flex h-4 w-4 shrink-0 items-center justify-center rounded border border-primary', className)}>
        <input
          type='checkbox'
          ref={ref}
          checked={checked}
          onChange={onChange}
          className='absolute inset-0 h-full w-full cursor-pointer opacity-0'
          {...props}
        />
        {checked && <Check className='pointer-events-none h-3 w-3 text-primary' />}
      </div>
    )
  }
)
Checkbox.displayName = 'Checkbox'

export { Checkbox }
