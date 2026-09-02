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
    ]) expect(html).toContain(expected)
  })
})
