import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { DeveloperDocsPage } from './DeveloperDocsPage'

describe('developer docs page', () => {
  it('documents the full image, text, polling, search, billing and MCP surface', () => {
    const html = renderToStaticMarkup(<MemoryRouter><DeveloperDocsPage /></MemoryRouter>)
    for (const expected of [
      '/open/v1/uploads',
      '/open/v1/food-analyses',
      'image_urls',
      'additional_context',
      'meal_type',
      'precision',
      '/open/v1/foods/search',
      'foodlink_analyze_images',
      'Idempotency-Key',
      'HTTP 402',
      '第一个应用赠送 100 点',
      '不懂代码？直接把接入任务交给 AI',
      'https://healthymax.cn/developer/ai-guide.md',
      '复制给 AI',
      '查看接口定义（OpenAPI YAML）',
    ]) expect(html).toContain(expected)
    expect(html).not.toContain('查看机器可读 OpenAPI')
  })
})
