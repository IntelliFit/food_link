import {
  buildPayload,
  draftProblem,
  emptyDraft,
  itemIncrements,
  parseGrams,
  netGrams,
  newItem,
  nextDraftAfterSubmit,
  type ResearchDraft,
} from '../../src/packageExtra/pages/research-weight/model'

const shot = (name: string) => ({ url: `https://cdn.test/${name}`, capturedAt: '2026-10-28T04:00:00.000Z' })

function wholeDraft(): ResearchDraft {
  return {
    ...emptyDraft(1),
    dishName: '红烧牛肉面',
    tare: '312.4',
    gross: '905.3',
    photos: { tare_scale: shot('t.jpg'), gross_scale: shot('g.jpg'), eval_top: shot('top.jpg'), eval_angle: shot('angle.jpg') },
  }
}

function itemizedDraft(): ResearchDraft {
  const draft = wholeDraft()
  const names = [['面条', '562.4'], ['牛肉', '640'], ['汤', '905.3']]
  return {
    ...draft,
    mode: 'itemized',
    gross: '',
    photos: { tare_scale: draft.photos.tare_scale, eval_top: draft.photos.eval_top, eval_angle: draft.photos.eval_angle, gross_scale: shot('stale.jpg') },
    items: names.map(([name, reading], index) => ({ ...newItem(index), name, reading, photo: shot(`i${index}.jpg`) })),
  }
}

describe('research weight draft', () => {
  it('computes the net weight from the scale readings', () => {
    expect(netGrams(wholeDraft())).toBe(592.9)
    expect(draftProblem(wholeDraft())).toBe('')
  })

  it('computes itemized increments from cumulative readings', () => {
    const draft = itemizedDraft()
    expect(itemIncrements(draft)).toEqual([250, 77.6, 265.3])
    expect(netGrams(draft)).toBe(592.9)
    expect(draftProblem(draft)).toBe('')
  })

  it('treats a zeroed scale as a zero tare', () => {
    const draft = { ...itemizedDraft(), tareMode: 'zeroed' as const, tare: '' }
    expect(itemIncrements(draft)[0]).toBe(562.4)
    expect(netGrams(draft)).toBe(905.3)
  })

  it('reports the first missing step', () => {
    expect(draftProblem({ ...wholeDraft(), dishName: '' })).toBe('请填写菜名')
    expect(draftProblem({ ...wholeDraft(), gross: '300' })).toBe('总读数必须大于空容器读数')
    const decreasing = itemizedDraft()
    decreasing.items[1] = { ...decreasing.items[1], reading: '500' }
    expect(draftProblem(decreasing)).toBe('第2项的秤上读数必须大于上一次读数')
    expect(draftProblem({ ...wholeDraft(), reference: 'chopsticks' })).toBe('选择了参照物，请补拍参照物照片')
  })

  it('submits only photos that belong to the chosen mode', () => {
    const payload = buildPayload(itemizedDraft(), { model: 'iPhone 15' })
    expect(payload.photos.map((photo) => photo.role)).toEqual(['tare_scale', 'eval_top', 'eval_angle', 'item_scale', 'item_scale', 'item_scale'])
    expect(payload.photos[4].item_index).toBe(1)
    expect(payload.items[2]).toEqual({ name: '汤', cumulative_reading_grams: 905.3, contains_bone: false, contains_soup: false })
    expect(payload.gross_reading_grams).toBeUndefined()

    const whole = buildPayload(wholeDraft(), {})
    expect(whole.gross_reading_grams).toBe(905.3)
    expect(whole.items).toEqual([])
    expect(whole.consent_version).toBe('2026-10-28')
  })

  it('starts the next dish with the same setup and tare photo but a new key', () => {
    const draft = wholeDraft()
    const next = nextDraftAfterSubmit(draft, 2)
    expect(next.clientKey).not.toBe(draft.clientKey)
    expect(next.tare).toBe('312.4')
    expect(next.photos).toEqual({ tare_scale: draft.photos.tare_scale })
    expect(next.dishName).toBe('')
    expect(next.gross).toBe('')
  })

  it('rounds readings to 0.1 g like the server before comparing', () => {
    expect(parseGrams('100.14')).toBe(100.1)
    const draft = { ...wholeDraft(), tare: '100.05', gross: '100.14' }
    expect(draftProblem(draft)).toBe('总读数必须大于空容器读数')
  })
})
