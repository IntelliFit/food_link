import { normalizeInsightText, parseInsightInline, parseInsightMarkdown } from '../src'

describe('insight markdown helpers', () => {
  it('parses headings, lists, and inline emphasis', () => {
    const blocks = parseInsightMarkdown('## 总体结论\n\n- <u>热量缺口偏大</u>\n- **蛋白质不足**')

    expect(blocks).toEqual([
      { type: 'heading', text: '总体结论' },
      { type: 'list', items: ['<u>热量缺口偏大</u>', '**蛋白质不足**'] },
    ])

    expect(parseInsightInline('关注 <u>热量</u> 和 **蛋白质**')).toEqual([
      { text: '关注 ' },
      { text: '热量', underline: true },
      { text: ' 和 ' },
      { text: '蛋白质', strong: true },
    ])
  })

  it('parses markdown tables into structured cells', () => {
    const blocks = parseInsightMarkdown(`
| 指标 | 本期 | 判断 |
| --- | ---: | --- |
| 热量 | 1800 kcal | 稳定 |
| 蛋白质 | 60g | 偏低 |

下一步先补早餐蛋白。
`)

    expect(blocks[0]).toEqual({
      type: 'table',
      headers: ['指标', '本期', '判断'],
      rows: [
        ['热量', '1800 kcal', '稳定'],
        ['蛋白质', '60g', '偏低'],
      ],
    })
    expect(blocks[1]).toEqual({ type: 'paragraph', text: '下一步先补早餐蛋白。' })
  })

  it('does not leak underline markup when model output wraps or escapes tags', () => {
    expect(parseInsightInline('本期呈现 <u>饮食记录\n严重不足</u>，请补充记录。')).toEqual([
      { text: '本期呈现 ' },
      { text: '饮食记录\n严重不足', underline: true },
      { text: '，请补充记录。' },
    ])

    expect(parseInsightInline('关注 &lt;u&gt;日均热量缺口&lt;/u&gt;。')).toEqual([
      { text: '关注 ' },
      { text: '日均热量缺口', underline: true },
      { text: '。' },
    ])

    expect(parseInsightInline('异常 <u>未闭合标签')).toEqual([
      { text: '异常 未闭合标签' },
    ])
  })

  it('removes fenced markdown without dropping inline analysis values', () => {
    expect(normalizeInsightText('热量 ```1508``` kcal')).toBe('热量 1508 kcal')
    expect(normalizeInsightText('```markdown\n总体结论\n```')).toBe('总体结论')
  })
})
