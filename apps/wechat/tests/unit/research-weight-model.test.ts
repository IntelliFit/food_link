import {
  buildPayload,
  checkDraft,
  containerNet,
  containersToSave,
  draftHasContent,
  emptyDraft,
  itemIncrements,
  libraryIndex,
  netGrams,
  newContainer,
  newItem,
  nextDraftAfterSubmit,
  parseGrams,
  type DraftContainer,
  type ResearchDraft,
} from '../../src/packageExtra/pages/research-weight/model'

const shot = (name: string) => ({ url: `https://cdn.test/${name}`, capturedAt: '2026-11-04T04:00:00.000Z' })
const library = libraryIndex([{ id: 'c1', name: '750ml 圆盒', container_type: 'box', grams: 28.5, photo_url: 'https://cdn.test/lib.jpg' }])

function box(patch: Partial<DraftContainer>): DraftContainer {
  return { ...newContainer('after_meal', 1), ...patch }
}

/** 三盒外卖：米饭吃完称空盒、宫保鸡丁用常用容器、汤碗先归零。 */
function takeoutDraft(): ResearchDraft {
  return {
    ...emptyDraft(1),
    dishName: '宫保鸡丁套餐',
    photos: { eval_top: shot('meal.jpg') },
    containers: [
      box({ id: 'b0', name: '米饭', gross: '265', grossPhoto: shot('g0.jpg'), tare: '18', tarePhoto: shot('t0.jpg') }),
      box({ id: 'b1', name: '宫保鸡丁', gross: '412.3', grossPhoto: shot('g1.jpg'), tareSource: 'library', libraryId: 'c1' }),
      box({ id: 'b2', name: '紫菜汤', gross: '330', grossPhoto: shot('g2.jpg'), tareSource: 'zeroed', tarePhoto: shot('z2.jpg'), containsSoup: true }),
    ],
  }
}

function itemizedDraft(): ResearchDraft {
  const names = [['面条', '562.4'], ['牛肉', '640'], ['汤', '905.3']]
  return {
    ...emptyDraft(1),
    scene: 'canteen',
    mode: 'itemized',
    dishName: '红烧牛肉面',
    photos: { eval_angle: shot('angle.jpg') },
    tareSource: 'measured',
    tare: '312.4',
    tarePhoto: shot('t.jpg'),
    items: names.map(([name, reading], index) => ({ ...newItem(index), name, reading, photo: shot(`i${index}.jpg`) })),
  }
}

describe('research weight draft v2', () => {
  it('starts as a takeout meal with one box weighed after eating', () => {
    const draft = emptyDraft(1)
    expect(draft.mode).toBe('multi')
    expect(draft.containers).toHaveLength(1)
    expect(draft.containers[0].tareSource).toBe('after_meal')
    expect(draftHasContent(draft)).toBe(false)
  })

  it('computes each box from its own tare source', () => {
    const draft = takeoutDraft()
    expect(draft.containers.map((c) => containerNet(c, library))).toEqual([247, 383.8, 330])
    expect(netGrams(draft, library)).toBe(960.8)
    expect(checkDraft(draft, library)).toEqual({ problem: '', waitingForMeal: false })
  })

  it('accepts a single evaluation photo but needs at least one', () => {
    const draft = takeoutDraft()
    expect(checkDraft({ ...draft, photos: { eval_angle: shot('a.jpg') } }, library).problem).toBe('')
    expect(checkDraft({ ...draft, photos: {} }, library).problem).toBe('先拍一张整顿饭的照片')
  })

  it('lets the meal wait for the empty boxes after eating', () => {
    const draft = takeoutDraft()
    draft.containers[0] = { ...draft.containers[0], tare: '', tarePhoto: undefined }
    expect(checkDraft(draft, library)).toEqual({ problem: '吃完回来称空盒', waitingForMeal: true })
    expect(netGrams(draft, library)).toBeNull()

    draft.containers[1] = { ...draft.containers[1], name: '' }
    expect(checkDraft(draft, library)).toEqual({ problem: '给第2盒起个名字，如 米饭', waitingForMeal: false })
  })

  it('reports box problems in order', () => {
    const missingGrossPhoto = takeoutDraft()
    missingGrossPhoto.containers[2] = { ...missingGrossPhoto.containers[2], grossPhoto: undefined }
    expect(checkDraft(missingGrossPhoto, library).problem).toBe('拍第3盒连盒的读数')

    const unknownSaved = takeoutDraft()
    unknownSaved.containers[1] = { ...unknownSaved.containers[1], libraryId: 'gone' }
    expect(checkDraft(unknownSaved, library).problem).toBe('第2盒选一个常用容器')

    const lighter = takeoutDraft()
    lighter.containers[0] = { ...lighter.containers[0], gross: '15' }
    expect(checkDraft(lighter, library).problem).toBe('第1盒的连盒读数必须大于空盒重量')

    const measured = takeoutDraft()
    measured.containers[0] = { ...measured.containers[0], tareSource: 'measured', tarePhoto: undefined }
    expect(checkDraft(measured, library).problem).toBe('拍第1盒空容器的读数')
  })

  it('builds a multi payload with box photos and no photo for the saved box', () => {
    const payload = buildPayload(takeoutDraft(), library, { model: 'iPhone 15' })
    expect(payload.weighing_mode).toBe('multi')
    expect(payload.tare_mode).toBe('per_container')
    expect(payload.container_type).toBe('box')
    expect(payload.items[0]).toMatchObject({ name: '米饭', gross_reading_grams: 265, tare_source: 'after_meal', tare_grams: 18 })
    expect(payload.items[1]).toMatchObject({ tare_source: 'library', container_id: 'c1' })
    expect(payload.items[1]).not.toHaveProperty('tare_grams')
    expect(payload.items[2]).toMatchObject({ tare_source: 'zeroed', contains_soup: true })
    expect(payload.photos.map((p) => `${p.role}:${p.item_index ?? '-'}`)).toEqual([
      'eval_top:-', 'container_gross:0', 'container_tare:0', 'container_gross:1', 'container_gross:2', 'container_tare:2',
    ])
  })

  it('keeps itemized weighing with any tare source', () => {
    const draft = itemizedDraft()
    expect(itemIncrements(draft, library)).toEqual([250, 77.6, 265.3])
    expect(checkDraft(draft, library).problem).toBe('')

    const saved = { ...draft, tareSource: 'library' as const, tareLibraryId: 'c1', tarePhoto: undefined }
    expect(itemIncrements(saved, library)[0]).toBe(533.9)
    const payload = buildPayload(saved, library, {})
    expect(payload).toMatchObject({ weighing_mode: 'itemized', tare_mode: 'library', container_id: 'c1', tare_grams: 0 })
    expect(payload.photos.some((p) => p.role === 'tare_scale')).toBe(false)

    const afterMeal = { ...draft, tareSource: 'after_meal' as const, tare: '', tarePhoto: undefined }
    expect(checkDraft(afterMeal, library)).toEqual({ problem: '吃完回来称空容器', waitingForMeal: true })
  })

  it('saves weighed empty boxes the user ticked', () => {
    const draft = takeoutDraft()
    draft.containers[0] = { ...draft.containers[0], saveToLibrary: true, libraryName: '' }
    draft.containers[2] = { ...draft.containers[2], saveToLibrary: true }
    expect(containersToSave(draft)).toEqual([{ name: '米饭的盒子', container_type: 'box', grams: 18, photo_url: 'https://cdn.test/t0.jpg' }])
  })

  it('starts the next meal with the same setup but empty boxes', () => {
    const next = nextDraftAfterSubmit({ ...takeoutDraft(), venueName: '楼下川菜馆' }, 2)
    expect(next.venueName).toBe('楼下川菜馆')
    expect(next.containers).toHaveLength(1)
    expect(next.containers[0].tareSource).toBe('after_meal')
    expect(next.photos).toEqual({})

    const canteen = nextDraftAfterSubmit(itemizedDraft(), 3)
    expect(canteen.tare).toBe('312.4')
    expect(canteen.tarePhoto).toEqual(itemizedDraft().tarePhoto)
  })

  it('rounds readings to 0.1 g like the server', () => {
    expect(parseGrams('100.14')).toBe(100.1)
    expect(parseGrams('abc')).toBeNull()
  })
})
