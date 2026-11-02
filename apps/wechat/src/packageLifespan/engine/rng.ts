// SplitMix64 on 32-bit pairs, without BigInt: older WeChat runtimes cannot parse BigInt literals.

type U64 = readonly [number, number]

const GAMMA: U64 = [0x9e3779b9, 0x7f4a7c15]
const EVENT_STREAM_STEP: U64 = [0x2545f491, 0x4f6cdd1d]

const add64 = ([ah, al]: U64, [bh, bl]: U64): U64 => {
  const lo = al + bl
  return [(ah + bh + Math.floor(lo / 0x100000000)) >>> 0, lo >>> 0]
}

const mul64 = ([ah, al]: U64, [bh, bl]: U64): U64 => {
  const a0 = al & 0xffff
  const a1 = al >>> 16
  const b0 = bl & 0xffff
  const b1 = bl >>> 16
  const low = a0 * b0
  const mid1 = a1 * b0 + (low >>> 16)
  const mid2 = a0 * b1 + (mid1 & 0xffff)
  const lo = ((mid2 & 0xffff) * 0x10000 + (low & 0xffff)) >>> 0
  const carry = a1 * b1 + Math.floor(mid1 / 0x10000) + Math.floor(mid2 / 0x10000)
  return [(carry + Math.imul(ah, bl) + Math.imul(al, bh)) >>> 0, lo]
}

const xorShr64 = ([h, l]: U64, n: number): U64 => {
  const shiftedLo = ((l >>> n) | (h << (32 - n))) >>> 0
  return [(h ^ (h >>> n)) >>> 0, (l ^ shiftedLo) >>> 0]
}

const toU64 = (value: number): U64 => [Math.floor(value / 0x100000000) >>> 0, value >>> 0]

function splitmix64(state: U64): U64 {
  let z = add64(state, GAMMA)
  z = mul64(xorShr64(z, 30), [0xbf58476d, 0x1ce4e5b9])
  z = mul64(xorShr64(z, 27), [0x94d049bb, 0x133111eb])
  return xorShr64(z, 31)
}

/**
 * U(0,1) for one life. Stream 0 decides the death age, 1 the first disease, 2 its type.
 * Branches are not part of the derivation, so every branch of a life sees the same numbers.
 */
export function lifeUniform(seed: number, lifeIndex: number, stream = 0): number {
  const state = add64(add64(mul64(toU64(seed), GAMMA), toU64(lifeIndex)), mul64(toU64(stream), EVENT_STREAM_STEP))
  const [hi, lo] = splitmix64(state)
  return ((hi * 0x200000 + (lo >>> 11)) + 0.5) * Math.pow(2, -53)
}
