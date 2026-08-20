import { readFileSync } from 'fs'
import { resolve } from 'path'

function source(relativePath: string): string {
  return readFileSync(resolve(__dirname, '../../src', relativePath), 'utf8')
}

describe('silent tab refresh', () => {
  it('does not render a persistent fixed spinner for cached background refreshes', () => {
    expect(source('pages/index/index.tsx')).not.toContain('home-page__data-sync')
    expect(source('pages/stats/index.tsx')).not.toContain('stats-page__data-sync')
    expect(source('pages/index/index.scss')).not.toContain('.home-page__data-sync')
    expect(source('pages/stats/index.scss')).not.toContain('.stats-page__data-sync')
  })

  it('deduplicates an in-flight stats refresh for the same range', () => {
    const statsSource = source('pages/stats/index.tsx')
    expect(statsSource).toContain("if (refreshPendingRef.current[r] !== undefined) return")
    expect(statsSource).toContain('refreshPendingRef.current[r] = reqId')
    expect(statsSource).toContain('delete refreshPendingRef.current[r]')
  })
})
