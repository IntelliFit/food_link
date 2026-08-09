import { readFileSync } from 'fs'
import { join } from 'path'

describe('home date selector layout', () => {
  const pageScss = readFileSync(
    join(process.cwd(), 'src/pages/index/index.scss'),
    'utf8',
  )
  const dateSelectorSource = readFileSync(
    join(process.cwd(), 'src/pages/index/components/DateSelector.tsx'),
    'utf8',
  )
  const wellnessStart = pageScss.indexOf('.home-page--mode-wellness {')
  const wellnessEnd = pageScss.indexOf('.home-page--dark.home-page--mode-wellness')
  const wellnessStyles = pageScss.slice(wellnessStart, wellnessEnd)
  const dateSelectorStart = wellnessStyles.indexOf('  .date-selector-section {')
  const dateSelectorEnd = wellnessStyles.indexOf('\n  }', dateSelectorStart)
  const wellnessDateSelectorStyles = wellnessStyles.slice(dateSelectorStart, dateSelectorEnd)
  const dateItemStart = wellnessStyles.indexOf('  .date-item {')
  const dateItemDirectEnd = wellnessStyles.indexOf('\n    .date-day-name', dateItemStart)
  const wellnessDateItemDirectStyles = wellnessStyles.slice(dateItemStart, dateItemDirectEnd)
  const calendarTitleStart = pageScss.indexOf('.date-calendar-title {')
  const calendarTitleEnd = pageScss.indexOf('\n}', calendarTitleStart)
  const calendarTitleStyles = pageScss.slice(calendarTitleStart, calendarTitleEnd)
  const calendarToolbarStart = pageScss.indexOf('.date-calendar-toolbar {')
  const calendarToolbarEnd = pageScss.indexOf('\n}', calendarToolbarStart)
  const calendarToolbarStyles = pageScss.slice(calendarToolbarStart, calendarToolbarEnd)
  const collapsedToolbarStart = pageScss.indexOf(
    '.date-selector-section:not(.is-calendar-expanded) .date-calendar-toolbar {',
  )
  const collapsedToolbarEnd = pageScss.indexOf('\n}', collapsedToolbarStart)
  const collapsedToolbarStyles = pageScss.slice(collapsedToolbarStart, collapsedToolbarEnd)

  it('keeps date selector geometry shared between balanced and wellness modes', () => {
    expect(wellnessDateSelectorStyles).not.toMatch(
      /^\s*(?:border|padding|width|height|min-height|max-height|margin)\s*:/m,
    )
    expect(wellnessDateItemDirectStyles).not.toMatch(
      /^\s*(?:padding|width|height|min-height|max-height|margin)\s*:/m,
    )
  })

  it('uses a left-aligned month title with an expand indicator', () => {
    expect(dateSelectorSource).not.toContain("className='date-calendar-toggle'")
    expect(dateSelectorSource).toContain('<IconExpand')
    expect(dateSelectorSource).toContain('<IconCollapse')
    expect(calendarTitleStyles).not.toMatch(/^\s*(?:position|left|right|transform)\s*:/m)
    expect(calendarTitleStyles).not.toMatch(/^\s*margin\s*:\s*auto/m)
    expect(calendarToolbarStyles).toMatch(/^\s*justify-content\s*:\s*space-between/m)
    expect(dateSelectorSource.indexOf("className='date-calendar-title'"))
      .toBeLessThan(dateSelectorSource.indexOf("className='date-calendar-nav-group'"))
  })

  it('keeps the collapsed month title aligned with the expanded inset', () => {
    expect(pageScss).toMatch(
      /\.date-selector-section\s*\{[\s\S]*?&\.is-calendar-expanded\s*\{[\s\S]*?padding:\s*12rpx 18rpx 18rpx/,
    )
    expect(collapsedToolbarStyles).toMatch(/^\s*padding\s*:\s*0 18rpx/m)
    expect(collapsedToolbarStyles).toMatch(/^\s*box-sizing\s*:\s*border-box/m)
  })
})
