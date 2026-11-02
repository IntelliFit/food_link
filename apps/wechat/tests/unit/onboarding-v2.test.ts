/** @jest-environment node */

import {
  birthdayFromAge,
  formatTrustCount,
  localDateKey,
  missingBodyFields,
  parseBodySentence,
  shouldOfferWelcome,
} from '../../src/utils/onboarding-v2'

describe('parseBodySentence', () => {
  it.each([
    ['女，22 岁，163，52 公斤', { gender: 'female', age: 22, heightCm: 163, weightKg: 52 }],
    ['女 22 163 52kg', { gender: 'female', age: 22, heightCm: 163, weightKg: 52 }],
    ['男 25 178 70', { gender: 'male', age: 25, heightCm: 178, weightKg: 70 }],
    ['男 178 70 25', { gender: 'male', age: 25, heightCm: 178, weightKg: 70 }],
    ['女生，1.63米，104斤，22岁', { gender: 'female', age: 22, heightCm: 163, weightKg: 52 }],
    ['male 30y 180cm 75.5kg', { gender: 'male', age: 30, heightCm: 180, weightKg: 75.5 }],
    ['女 40 163 52', { gender: 'female', age: 40, heightCm: 163, weightKg: 52 }],
    ['男 45岁 172 68', { gender: 'male', age: 45, heightCm: 172, weightKg: 68 }],
    ['男 172 68', { gender: 'male', heightCm: 172, weightKg: 68 }],
  ])('reads %s', (input, expected) => {
    expect(parseBodySentence(input)).toEqual(expected)
  })

  it('leaves out what it cannot read and reports it', () => {
    const facts = parseBodySentence('163cm 52kg')
    expect(facts).toEqual({ heightCm: 163, weightKg: 52 })
    expect(missingBodyFields(facts)).toEqual(['性别', '年龄'])
  })

  it('ignores impossible values', () => {
    expect(parseBodySentence('男 300cm 5kg 150岁')).toEqual({ gender: 'male' })
  })

  it('does not mistake a metre unit for a gender', () => {
    expect(parseBodySentence('1.70 m 60kg 28岁').gender).toBeUndefined()
  })
})

describe('formatTrustCount', () => {
  it.each([
    [12255, '1.2 万+'],
    [12815, '1.2 万+'],
    [19999, '1.9 万+'],
    [3559, '3,500+'],
    [2564, '2,500+'],
    [452, '450+'],
    [38, '38'],
    [-3, '0'],
  ])('%d -> %s', (n, text) => {
    expect(formatTrustCount(n)).toBe(text)
  })
})

describe('small helpers', () => {
  it('builds a mid-year birthday from an age', () => {
    expect(birthdayFromAge(22, new Date(2026, 9, 26))).toBe('2004-07-01')
  })

  it('formats a local date key', () => {
    expect(localDateKey(new Date(2026, 0, 5))).toBe('2026-01-05')
  })

  it('offers the welcome only to fresh guests', () => {
    expect(shouldOfferWelcome({ loggedIn: false, welcomeDone: false, hasPendingInvite: false })).toBe(true)
    expect(shouldOfferWelcome({ loggedIn: true, welcomeDone: false, hasPendingInvite: false })).toBe(false)
    expect(shouldOfferWelcome({ loggedIn: false, welcomeDone: true, hasPendingInvite: false })).toBe(false)
    expect(shouldOfferWelcome({ loggedIn: false, welcomeDone: false, hasPendingInvite: true })).toBe(false)
  })
})
