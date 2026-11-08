import { useState } from 'react'
import { toast } from 'sonner'

import { adminRequest } from '@/lib/api'
import type { UserSearchResult } from '@/types/user-reward'

export type PickedUser = { user_id: string; nickname: string; telephone: string }

type LeaderPickerProps = {
  picked: PickedUser[]
  onChange: (users: PickedUser[]) => void
  compact?: boolean
}

const maskPhone = (phone: string) => (phone && phone.length >= 7 ? `${phone.slice(0, 3)}****${phone.slice(-4)}` : phone)

/** 按昵称或手机号找到社团负责人的小程序账号；对方需要先在小程序里登录过。 */
export function LeaderPicker({ picked, onChange, compact }: LeaderPickerProps) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<UserSearchResult[]>([])
  const [searching, setSearching] = useState(false)

  async function search() {
    const text = query.trim()
    if (!text) return
    setSearching(true)
    try {
      const params = new URLSearchParams({ q: text, limit: '10' })
      const data = await adminRequest<{ items: UserSearchResult[] }>(`/api/admin/users/search?${params}`)
      setResults(data.items || [])
      if (!data.items?.length) toast.info('没找到：让负责人先在小程序里登录一次，再用昵称或手机号搜')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '搜索用户失败')
    } finally {
      setSearching(false)
    }
  }

  const add = (user: UserSearchResult) => {
    if (!picked.some((item) => item.user_id === user.user_id)) {
      onChange([...picked, { user_id: user.user_id, nickname: user.nickname || '未设置昵称', telephone: user.telephone || '' }])
    }
    setResults([])
    setQuery('')
  }

  return (
    <div className='space-y-2'>
      {picked.length ? (
        <div className='flex flex-wrap gap-2'>
          {picked.map((user) => (
            <span key={user.user_id} className='inline-flex items-center gap-2 rounded-full border border-primary bg-primary/10 px-3 py-1 text-xs'>
              ✓ {user.nickname}{user.telephone ? ` · ${maskPhone(user.telephone)}` : ''}
              <button type='button' className='text-muted-foreground hover:text-foreground' onClick={() => onChange(picked.filter((item) => item.user_id !== user.user_id))}>×</button>
            </span>
          ))}
        </div>
      ) : null}
      <div className='flex gap-2'>
        <input
          className={`${compact ? 'h-8 text-xs' : 'h-10 text-sm'} w-full rounded-xl border bg-background px-3`}
          value={query}
          placeholder='搜负责人的昵称或手机号'
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Enter') void search() }}
        />
        <button type='button' className={`${compact ? 'h-8 text-xs' : 'h-10 text-sm'} shrink-0 rounded-xl border px-3 disabled:opacity-50`} disabled={searching} onClick={() => void search()}>
          {searching ? '搜索中' : '搜索'}
        </button>
      </div>
      {results.length ? (
        <div className='divide-y rounded-xl border'>
          {results.map((user) => (
            <button key={user.user_id} type='button' className='flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-accent/50' onClick={() => add(user)}>
              <span>{user.nickname || '未设置昵称'}<span className='ml-2 text-xs text-muted-foreground'>{maskPhone(user.telephone || '')}</span></span>
              <span className='text-xs text-primary'>选这个人</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
