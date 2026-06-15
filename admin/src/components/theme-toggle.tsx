import { Moon, Sun, Monitor } from 'lucide-react'
import { useTheme } from 'next-themes'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

export function ThemeToggle() {
  const { theme, setTheme, resolvedTheme } = useTheme()

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant='outline' size='icon' className='shrink-0' aria-label='切换主题'>
          {resolvedTheme === 'dark' ? (
            <Moon className='size-[18px]' />
          ) : (
            <Sun className='size-[18px]' />
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align='end'>
        <DropdownMenuItem onClick={() => setTheme('light')} className='gap-2'>
          <Sun className='size-4' />
          浅色
          {theme === 'light' && <span className='ml-auto text-xs text-muted-foreground'>✓</span>}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTheme('dark')} className='gap-2'>
          <Moon className='size-4' />
          深色
          {theme === 'dark' && <span className='ml-auto text-xs text-muted-foreground'>✓</span>}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTheme('system')} className='gap-2'>
          <Monitor className='size-4' />
          跟随系统
          {theme === 'system' && <span className='ml-auto text-xs text-muted-foreground'>✓</span>}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
