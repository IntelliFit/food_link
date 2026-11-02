import {
  PET_FULL_LINE,
  PET_MAX_SNACKS,
  PET_SNACKS,
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

  it('reacts to quiz answers', () => {
    expect(petQuizLine(true)).not.toBe(petQuizLine(false))
  })
})
