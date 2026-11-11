import {
  PET_FULL_LINE,
  PET_MAX_SNACKS,
  PET_SNACKS,
  PET_SNACK_TRAY_SIZE,
  createPetSnackTray,
  replacePetSnack,
  petQuizLine,
  petSnackLine,
  petTapLine,
  pickWaitingStageLine,
  type WaitingStageInput,
} from '../../src/packageExtra/pages/analyze-loading/waiting-pet'

const photo: WaitingStageInput = {
  elapsedSeconds: 0,
  taskType: 'food',
  isCorrection: false,
  isPrecision: false,
  recognitionReady: false,
}

describe('waiting pet copy', () => {
  it('moves through photo stages as time passes and keeps one key per stage', () => {
    const first = pickWaitingStageLine(photo)
    expect(pickWaitingStageLine({ ...photo, elapsedSeconds: 4 }).key).toBe(first.key)
    const second = pickWaitingStageLine({ ...photo, elapsedSeconds: 5 })
    expect(second.key).not.toBe(first.key)
    expect(pickWaitingStageLine({ ...photo, elapsedSeconds: 600 }).text).toContain('好了我叫你')
  })

  it('uses wording that matches the task', () => {
    expect(pickWaitingStageLine({ ...photo, taskType: 'food_text' }).text).toContain('记下')
    expect(pickWaitingStageLine({ ...photo, taskType: 'exercise' }).text).toContain('动起来')
    expect(pickWaitingStageLine({ ...photo, isCorrection: true }).text).toContain('纠正')
    expect(pickWaitingStageLine({ ...photo, isPrecision: true }).text).toContain('精准')
  })

  it('announces a finished recognition over any stage', () => {
    const line = pickWaitingStageLine({ ...photo, elapsedSeconds: 40, recognitionReady: true })
    expect(line.key).toBe('ready')
  })

  it('survives a negative clock', () => {
    expect(pickWaitingStageLine({ ...photo, elapsedSeconds: -3 }).text).toBe(pickWaitingStageLine(photo).text)
  })

  it('cycles tap lines and rewards every sixth tap', () => {
    expect(petTapLine(1)).not.toBe(petTapLine(2))
    expect(petTapLine(6)).toContain('喜欢')
    expect(petTapLine(12)).toBe(petTapLine(6))
  })

  it('gives snack facts until the pet is full', () => {
    expect(petSnackLine(PET_SNACKS[0], 0)).toBe(PET_SNACKS[0].fact)
    expect(petSnackLine(PET_SNACKS[0], PET_MAX_SNACKS - 1)).toBe(PET_SNACKS[0].fact)
    expect(petSnackLine(PET_SNACKS[0], PET_MAX_SNACKS)).toBe(PET_FULL_LINE)
  })

  it('draws four unique snacks from a larger pool and changes the opening tray', () => {
    const first = createPetSnackTray(() => 0)
    const another = createPetSnackTray(() => 0.999)
    expect(PET_SNACKS.length).toBeGreaterThan(PET_SNACK_TRAY_SIZE * 2)
    expect(first).toHaveLength(PET_SNACK_TRAY_SIZE)
    expect(new Set(first.map(snack => snack.id)).size).toBe(PET_SNACK_TRAY_SIZE)
    expect(first.map(snack => snack.id)).not.toEqual(another.map(snack => snack.id))
  })

  it('replaces the eaten snack without repeating any visible snack', () => {
    const original = createPetSnackTray(() => 0)
    let tray = original
    for (let i = 0; i < PET_MAX_SNACKS; i += 1) {
      const previousIds = tray.map(snack => snack.id)
      tray = replacePetSnack(tray, tray[0].id, () => 0)
      expect(tray).toHaveLength(PET_SNACK_TRAY_SIZE)
      expect(previousIds).not.toContain(tray[0].id)
      expect(tray.slice(1)).toEqual(original.slice(1))
      expect(new Set(tray.map(snack => snack.id)).size).toBe(PET_SNACK_TRAY_SIZE)
    }
    expect(original.map(snack => snack.id)).toEqual(createPetSnackTray(() => 0).map(snack => snack.id))
  })

  it('keeps the tray valid when a random source returns an edge value', () => {
    for (const value of [NaN, -1, 1]) {
      const tray = createPetSnackTray(() => value)
      expect(tray).toHaveLength(PET_SNACK_TRAY_SIZE)
      expect(new Set(tray.map(snack => snack.id)).size).toBe(PET_SNACK_TRAY_SIZE)
    }
  })

  it('varies the reply before the existing full limit', () => {
    expect(petSnackLine(PET_SNACKS[0], 1)).not.toBe(petSnackLine(PET_SNACKS[0], 0))
    expect(petSnackLine(PET_SNACKS[0], 1)).toContain(PET_SNACKS[0].label)
  })

  it('reacts to quiz answers', () => {
    expect(petQuizLine(true)).not.toBe(petQuizLine(false))
  })
})
