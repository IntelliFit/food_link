import {
  buildPayload,
  checkDraft,
  emptyDraft,
  libraryIndex,
  newContainer,
  type DraftPhoto,
  type ResearchDraft,
} from '../../src/packageExtra/pages/research-weight/model'
import { autofillValue, filledFrom, readingNote, readingProblem, toPhotoReading } from '../../src/packageExtra/pages/research-weight/reading'
import { chinaDay, freshCampus } from '../../src/packageExtra/pages/research-weight/model'

const read = (grams: number, agreement: 'agree' | 'single' | 'disagree' = 'agree', resolution?: number) =>
  toPhotoReading({ readable: true, grams, agreement, message: `已读出 ${grams} g，请核对`, ...(resolution ? { resolution_grams: resolution } : {}) })
const unreadable = toPhotoReading({ readable: false, agreement: 'unreadable', message: '没读清秤上的数字（反光），请重拍' })
const shot = (name: string, reading?: ReturnType<typeof read>): DraftPhoto => ({
  url: `https://cdn.test/${name}`, capturedAt: '2026-11-06T04:00:00.000Z', ...(reading ? { reading } : {}),
})

describe('readingProblem', () => {
  it('passes within the scale precision and the display step', () => {
    expect(readingProblem('连盒读数', '452', shot('a', read(452.4)), 1)).toBe('')
    expect(readingProblem('连盒读数', '452', shot('a', read(450, 'agree', 10)), 1)).toBe('')
  })

  it('flags a reading both models agree on that differs from the typed value', () => {
    expect(readingProblem('第1盒连盒读数', '542', shot('a', read(452)), 1)).toBe('第1盒连盒读数填的是 542g，照片里是 452g，请改正或重拍')
  })

  it('only warns when a single model read the display, as the server only grades it lower', () => {
    expect(readingProblem('读数', '542', shot('a', read(452, 'single')), 1)).toBe('')
    expect(readingNote(shot('a', read(452, 'single')))).toEqual({ text: '只读到一次：452g，请自己核对一下', warn: true })
  })

  it('never blocks on readings it cannot trust', () => {
    expect(readingProblem('读数', '542', shot('a', read(452, 'disagree')), 1)).toBe('')
    expect(readingProblem('读数', '542', shot('a', unreadable), 1)).toBe('')
    expect(readingProblem('读数', '542', shot('a'), 1)).toBe('')
    expect(readingProblem('读数', '', shot('a', read(452)), 1)).toBe('')
  })
})

describe('readingNote and autofillValue', () => {
  it('tells the contributor what was read or what to do', () => {
    expect(readingNote(shot('a', read(452)))).toEqual({ text: '已读出 452 g，请核对', warn: false })
    expect(readingNote(shot('a', unreadable))?.text).toContain('不计分')
    expect(readingNote(shot('a', unreadable))?.warn).toBe(true)
    expect(readingNote(shot('a'))).toBeNull()
  })

  it('fills only empty fields and never a value the contributor typed', () => {
    expect(autofillValue('', read(452))).toBe('452')
    expect(autofillValue('', read(452, 'single'))).toBe('452')
    expect(autofillValue('460', read(455))).toBeNull()
    expect(autofillValue('', unreadable)).toBeNull()
  })

  it('knows when a value came from the photo being replaced', () => {
    expect(filledFrom('452', shot('a', read(452)))).toBe(true)
    expect(filledFrom('460', shot('a', read(452)))).toBe(false)
    expect(filledFrom('452', shot('a'))).toBe(false)
  })

  it('keeps a campus weighing day only on the day it was opened', () => {
    const now = Date.UTC(2026, 10, 6, 4, 0)
    const campus = { stationSessionId: 's1', label: '周三称重日', day: chinaDay(now) }
    expect(freshCampus(campus, now)).toBe(campus)
    expect(freshCampus(campus, now + 24 * 3600 * 1000)).toBeUndefined()
    expect(freshCampus({ ...campus, day: undefined }, now)).toBeUndefined()
  })
})

function boxDraft(gross: string, grossReading?: ReturnType<typeof read>): ResearchDraft {
  return {
    ...emptyDraft(1),
    dishName: '宫保鸡丁',
    photos: { eval_top: { ...shot('meal'), source: 'camera' } },
    containers: [{ ...newContainer('zeroed', 1), name: '宫保鸡丁', gross, grossPhoto: shot('g0', grossReading), tarePhoto: shot('z0', read(0)) }],
  }
}

describe('draft checks and payload', () => {
  const library = libraryIndex([])

  it('blocks submission while a confirmed reading disagrees', () => {
    expect(checkDraft(boxDraft('412', read(412)), library).problem).toBe('')
    expect(checkDraft(boxDraft('512', read(412)), library).problem).toContain('第1盒连盒读数填的是 512g')
  })

  it('checks that a zeroed tare photo shows 0', () => {
    const draft = boxDraft('412', read(412))
    draft.containers[0].tarePhoto = shot('z0', read(35))
    expect(checkDraft(draft, library).problem).toContain('空盒读数')
  })

  it('sends the photo source and the campus context', () => {
    const draft = { ...boxDraft('412', read(412)), campus: { stationSessionId: 'station-1', label: '周三称重日' } }
    const payload = buildPayload(draft, library, {})
    expect(payload.station_session_id).toBe('station-1')
    expect(payload.catalog_item_id).toBeUndefined()
    expect(payload.photos.find((photo) => photo.role === 'eval_top')?.source).toBe('camera')
    expect(payload.photos.find((photo) => photo.role === 'container_gross')?.source).toBeUndefined()
  })
})
