import { useState, type FormEvent } from 'react'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { BrandMark } from '@/components/brand-mark'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

type LoginPageProps = {
  apiBase: string
  onLogin: (username: string, password: string) => Promise<void>
}

/** 管理员登录页 */
export function LoginPage({ apiBase, onLogin }: LoginPageProps) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!username.trim() || !password.trim()) {
      toast.error('请输入管理员账号和密码')
      return
    }
    setSubmitting(true)
    try {
      await onLogin(username, password)
      toast.success('登录成功')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '登录失败')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="relative z-10 flex min-h-svh items-center justify-center p-6">
      <Card className="w-full max-w-md border bg-card/95 shadow-xl backdrop-blur-md">
        <CardHeader className="space-y-4">
          <BrandMark />
          <div className="space-y-2">
            <CardTitle className="text-2xl">管理员登录</CardTitle>
            <CardDescription className="leading-relaxed">
              登录后进入后台管理系统。管理员账号只能通过后端命令行创建，不支持网页或 API 注册。
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={submit}>
            <div className="space-y-2">
              <Label htmlFor="username">管理员账号</Label>
              <Input
                id="username"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                autoFocus
                autoComplete="username"
                placeholder="请输入管理员账号"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">密码</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
                placeholder="请输入密码"
              />
            </div>
            <Button className="w-full" type="submit" disabled={submitting}>
              {submitting ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  登录中
                </>
              ) : (
                '登录'
              )}
            </Button>
          </form>
          <p className="mt-4 break-all text-xs text-muted-foreground">API: {apiBase}</p>
        </CardContent>
      </Card>
    </main>
  )
}
