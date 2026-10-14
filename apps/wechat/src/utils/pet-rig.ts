import type { PetProfile } from './api'
import { petMotionAtlas, type PetMotionAction } from './pet-motion'
import { JIANWEN_COMPANION_SRC, ORIGINAL_COMPANION_SRC } from './pet-companion-preference'
import type { PetTransportId } from './pet-transport'

export type Point = { x: number; y: number }
type Bone = [Point, Point, Point]
type HandBinding = { wrist: Point; axis: Point; scale?: number; mask?: Point[]; skinMask?: Point[] }
export interface PetRig {
  key: string; src: string; frame: [number, number, number, number]
  head: [number, number, number, number]; torso: [number, number, number, number]
  hip: Point; legs: [Bone, Bone]; arms: [Bone, Bone]
  shoulders?: [Point, Point]
  hands?: [[number, number, number, number], [number, number, number, number]]
  handBindings?: [HandBinding | undefined, HandBinding | undefined]
  gripHand?: [number, number, number, number]
  gripBinding?: { wrist: Point; contact: Point }
  // An existing clean sleeve/paw is a static texture, never an alternate pose.
  armSource?: {
    src: string; bone: Bone; width: number; hipX: number
    hand: [number, number, number, number]; mask: Point[]
    handBinding?: HandBinding
    grip?: { hand: [number, number, number, number]; wrist: Point; contact: Point }
  }
  legWidth: number; armWidth: number; top: number; floor: number
}
const p = (x: number, y: number): Point => ({ x, y })
const bone = (a: number[], b: number[], c: number[]): Bone => [p(a[0], a[1]), p(b[0], b[1]), p(c[0], c[1])]

// Each pose samples the approved character, never an independently drawn face/wardrobe.
export const PET_RIGS: Record<string, PetRig> = {
  guigui: { key: 'guigui', src: ORIGINAL_COMPANION_SRC, frame: [0, 0, 160, 208], head: [38, 6, 83, 85], torso: [65, 89, 39, 41], hip: p(83, 128), legs: [bone([74, 128], [72, 159], [71, 190]), bone([94, 128], [94, 159], [95, 190])], arms: [bone([64, 96], [59, 118], [56, 132]), bone([102, 96], [107, 118], [108, 132])], hands: [[49, 130, 14, 19], [103, 130, 14, 19]], gripHand: [268, 124, 14, 17], gripBinding: { wrist: p(269, 127.5), contact: p(273, 132) }, legWidth: 20, armWidth: 11, top: 8, floor: 197 },
  jianwen: { key: 'jianwen', src: JIANWEN_COMPANION_SRC, frame: [0, 0, 160, 208], head: [30, 9, 99, 96], torso: [52, 103, 59, 55], hip: p(80, 157), legs: [bone([65, 157], [62, 175], [56, 192]), bone([94, 157], [98, 175], [105, 192])], arms: [bone([375, 110], [362, 129], [357, 139]), bone([423, 110], [432, 125], [431, 134])], hands: [[349, 137, 21, 17], [431, 127, 23, 18]], gripHand: [431, 128, 21, 18], gripBinding: { wrist: p(431.5, 135.5), contact: p(440, 137) }, legWidth: 24, armWidth: 18, top: 10, floor: 198 },
  huatuo: { key: 'huatuo', src: '/assets/pets/huatuo-01.png', frame: [0, 0, 256, 256], head: [73, 29, 91, 153], torso: [87, 145, 70, 81], hip: p(120, 204), legs: [bone([105, 204], [99, 217], [92, 230]), bone([137, 204], [139, 218], [143, 230])], arms: [bone([93, 150], [80, 162], [70, 169]), bone([146, 151], [158, 165], [173, 160])], legWidth: 23, armWidth: 23, top: 32, floor: 238 },
  taiji: { key: 'taiji', src: '/assets/pets/taiji-xiaozi-01.png', frame: [0, 0, 256, 256], head: [77, 28, 92, 115], torso: [95, 139, 53, 52], hip: p(120, 188), legs: [bone([109, 188], [87, 205], [75, 227]), bone([134, 188], [154, 208], [169, 230])], arms: [bone([97, 147], [79, 151], [69, 146]), bone([144, 149], [156, 162], [167, 165])], hands: [[53, 132, 19, 18], [165, 157, 17, 15]], legWidth: 25, armWidth: 18, top: 31, floor: 238 },
  xiaomai: { key: 'xiaomai', src: '/assets/pets/xiaomai-01.png', frame: [0, 0, 256, 256], head: [39, 9, 171, 156], torso: [86, 135, 55, 78], hip: p(115, 209), legs: [bone([96, 209], [95, 220], [93, 232]), bone([134, 209], [138, 220], [141, 231])], arms: [bone([92, 149], [74, 169], [79, 175]), bone([92, 149], [74, 169], [79, 175])], hands: [[63, 174, 33, 21], [63, 174, 33, 21]], shoulders: [p(92, 149), p(137, 149)], legWidth: 27, armWidth: 20, top: 13, floor: 242 },
  doudou: { key: 'doudou', src: '/assets/pets/doudou-01.png', frame: [0, 0, 256, 256], head: [60, 10, 130, 137], torso: [97, 144, 58, 67], hip: p(129, 207), legs: [bone([111, 207], [107, 219], [106, 231]), bone([146, 207], [146, 219], [147, 230])], arms: [bone([100, 157], [99, 170], [102, 184]), bone([100, 157], [99, 170], [102, 184])], shoulders: [p(96, 157), p(153, 157)], legWidth: 27, armWidth: 17, top: 13, floor: 240 },
}
// The right palm was drawn sideways in this source frame. Bind its actual
// wrist/fingers instead of treating the sleeve's downward axis as the hand axis.
PET_RIGS.jianwen.handBindings = [undefined, { wrist: p(431.5, 135.5), axis: p(440, 137), skinMask: [p(418, 104), p(424, 104), p(427, 111), p(433, 119), p(437, 124), p(438, 128), p(435, 130), p(432, 134), p(431, 137), p(427, 136), p(424, 133), p(421, 127), p(418, 119), p(416, 112)], mask: [p(438, 128), p(454, 128), p(454, 145), p(435, 145), p(433, 142), p(432, 139), p(432, 137), p(431, 137), p(432, 134), p(435, 130)] }]
// The tiny sleeve's UV elbow follows the physical upper/forearm ratio; placing
// it at the sleeve outline's corner folded the forearm when the grip was fixed.
PET_RIGS.xiaomai.armSource = { src: '/assets/pets/motions/xiaomai-motion-v1.png', bone: bone([78, 75], [81, 80.5], [82, 82]), width: 7, hipX: 67, hand: [78, 81, 10, 8], handBinding: { wrist: p(82, 82), axis: p(83, 86) }, mask: [p(76, 73), p(80, 74), p(83, 77), p(85, 80), p(85, 83), p(87, 85), p(85, 88), p(81, 89), p(78, 87), p(78, 83), p(76, 80), p(74, 78)], grip: { hand: [79, 448, 11, 10], wrist: p(79, 452), contact: p(85, 453) } }
PET_RIGS.huatuo.armSource = { src: '/assets/pets/motions/huatuo-motion-v1.png', bone: bone([206, 199], [215, 197], [211, 190]), width: 9, hipX: 192, hand: [332, 307, 11, 11], handBinding: { wrist: p(335, 316), axis: p(338, 309), scale: .85, mask: [p(335, 308), p(339, 308), p(341, 310), p(341, 313), p(339, 315), p(336, 316), p(334, 316), p(333, 314), p(333, 311), p(335, 309)] }, mask: [p(202, 196), p(210, 194), p(209, 182), p(219, 180), p(223, 187), p(218, 199), p(212, 204), p(204, 204)], grip: { hand: [79, 444, 11, 10], wrist: p(80, 448), contact: p(85, 449) } }
PET_RIGS.doudou.armSource = { src: '/assets/pets/motions/doudou-motion-v1.png', bone: bone([436, 329], [431, 327], [427, 324]), width: 8, hipX: 448, hand: [418, 317, 13, 12], mask: [p(436, 326), p(438, 330), p(432, 333), p(426, 330), p(421, 329), p(417, 324), p(419, 318), p(425, 317), p(431, 324)], grip: { hand: [79, 447, 11, 9], wrist: p(80, 451), contact: p(85, 452) } }
PET_RIGS.taiji.armSource = { src: '/assets/pets/motions/taiji-motion-v1.png', bone: bone([58, 72], [54, 77], [54, 83]), width: 8, hipX: 67, hand: [50, 83, 9, 8], mask: [p(57, 70), p(60, 71), p(59, 74), p(58, 78), p(57, 82), p(57, 87), p(55, 91), p(50, 91), p(49, 87), p(50, 84), p(49, 80), p(51, 76), p(54, 73)], grip: { hand: [81, 441, 11, 8], wrist: p(81, 445), contact: p(86, 445.5) } }
export function petRig(pet?: Partial<PetProfile> | null, sprite?: string): PetRig | undefined {
  const key = petMotionAtlas(pet, sprite)?.match(/^\/assets\/pets\/motions\/(\w+)-motion-v1\.png$/)?.[1]
  return key ? PET_RIGS[key] : undefined
}
export const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y)
export const lerp = (a: Point, b: Point, t: number): Point => p(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t)
/** Horizontal foot heading is independent of heel/toe roll. */
export function shoeProjection(rig: PetRig, scale: number, bodyWidth: number, heading: number) {
  const camera = Math.sqrt(Math.max(0, 1 - bodyWidth * bodyWidth))
  return {
    width: (rig.legWidth + 4) * scale * Math.max(.3, Math.abs(bodyWidth * Math.cos(heading) - camera * Math.sin(heading))),
    toe: (rig.legWidth + 4) * scale * .3 * (camera * Math.cos(heading) + bodyWidth * Math.sin(heading)),
  }
}
const ease = (t: number) => t * t * (3 - 2 * t)
const walkingShoulder = (phase: number) => phase < .6 ? -.34 * Math.cos(Math.PI * phase / .6) : .34 * Math.cos(Math.PI * (phase - .6) / .4)

/** Analytic two-bone IK: no limb stretch; reject unreachable contact targets in tests. */
export function bend(start: Point, end: Point, upper: number, lower: number, side = -1): Point {
  const d = Math.max(.001, distance(start, end))
  const along = (upper * upper - lower * lower + d * d) / (2 * d)
  const perpendicular = Math.sqrt(Math.max(0, upper * upper - along * along)) * side
  return p(start.x + along * (end.x - start.x) / d - perpendicular * (end.y - start.y) / d,
    start.y + along * (end.y - start.y) / d + perpendicular * (end.x - start.x) / d)
}

/** Shoulder-led arm rotation. Elbow flexion stays forwards, never an IK branch flip. */
function swingArm(shoulder: Point, upper: number, lower: number, shoulderAngle: number, flexion: number): Bone {
  const elbow = p(shoulder.x + Math.sin(shoulderAngle) * upper, shoulder.y + Math.cos(shoulderAngle) * upper)
  return [shoulder, elbow, p(elbow.x + Math.sin(shoulderAngle + flexion) * lower, elbow.y + Math.cos(shoulderAngle + flexion) * lower)]
}
export interface RigPose {
  scale: number; hip: Point; angle: number; legs: [Bone, Bone]; arms: [Bone, Bone]
  phase: number; stage: string; crank: Point; pedals: [Point, Point]; radius: number
  seat: Point; grip: Point; floor: number; deck: number; action: PetMotionAction
  bodyWidth: number; bodySkew: number; footAngles: [number, number]; footDepth: [number, number]; farGrip: Point
  footHeading: [number, number]
  armDepth: [[number, number, number], [number, number, number]]
  // Sagittal-space bones keep physical lengths before camera foreshortening.
  armLocal: [Bone, Bone]; projectedArms: boolean; legLocal: [Bone, Bone]; projectedLegs: boolean
  contacts: ['deck' | 'heel' | 'sole' | 'toe' | 'air', 'deck' | 'heel' | 'sole' | 'toe' | 'air']
}

/** Move one skeleton between its original standing pose and the prepared ride. */
export function boardingPose(rig: PetRig, ride: RigPose, weight: number): RigPose {
  const t = ease(Math.max(0, Math.min(1, weight)))
  if (t === 1) return ride
  const project = (point: Point, sourceHipX = rig.hip.x): Point => p(100 + (point.x - sourceHipX) * ride.scale, ride.floor + (point.y - rig.floor) * ride.scale)
  const bones = (from: RigPose['arms'], to: RigPose['arms'], arms = false): RigPose['arms'] => from.map((bone, i) => {
    const cell = arms ? Math.floor(bone[0].x / rig.frame[2]) * rig.frame[2] : 0
    const shiftX = arms && rig.shoulders ? rig.shoulders[i].x - (bone[0].x - cell) : 0
    const shiftY = arms && rig.shoulders ? rig.shoulders[i].y - bone[0].y : 0
    const source = bone.map(point => project(p(point.x + shiftX, point.y + shiftY), rig.hip.x + cell)) as Bone
    if (!arms) return source.map((point, j) => lerp(point, to[i][j], t))
    const angle = (a: Point, b: Point) => Math.atan2(b.y - a.y, b.x - a.x)
    const wrap = (value: number) => Math.atan2(Math.sin(value), Math.cos(value))
    const fromUpper = angle(source[0], source[1]), toUpper = angle(to[i][0], to[i][1])
    const upperAngle = fromUpper + wrap(toUpper - fromUpper) * t
    const fromElbow = wrap(angle(source[1], source[2]) - fromUpper), toElbow = wrap(angle(to[i][1], to[i][2]) - toUpper)
    const elbowAngle = fromElbow + wrap(toElbow - fromElbow) * t
    const chain = [lerp(source[0], to[i][0], t)]
    // Interpolating joint coordinates collapsed short forearms. Rotate the
    // upper arm and its relative elbow flexion while retaining segment lengths.
    for (let part = 0; part < 2; part++) {
      const theta = upperAngle + (part ? elbowAngle : 0)
      const length = distance(source[part], source[part + 1]) * (1 - t) + distance(to[i][part], to[i][part + 1]) * t
      chain.push(p(chain[part].x + Math.cos(theta) * length, chain[part].y + Math.sin(theta) * length))
    }
    return chain
  }) as RigPose['arms']
  const pairs = (from: [number, number], to: [number, number]): [number, number] => from.map((n, i) => n + (to[i] - n) * t) as [number, number]
  return { ...ride, hip: lerp(project(rig.hip), ride.hip, t), angle: ride.angle * t,
    bodyWidth: 1 + (ride.bodyWidth - 1) * t, bodySkew: ride.bodySkew * t,
    legs: bones(rig.legs, ride.legs), arms: bones(rig.arms, ride.arms, true), projectedLegs: true,
    footAngles: pairs([0, 0], ride.footAngles), footHeading: pairs([0, 0], ride.footHeading), footDepth: pairs([0, 0], ride.footDepth),
    armDepth: ride.armDepth.map((bone, i) => bone.map(n => (i ? 1 : -1) * (1 - t) + n * t)) as RigPose['armDepth'],
  }
}
export function rigPose(rig: PetRig, vehicle: PetTransportId | undefined, action: PetMotionAction, elapsed: number): RigPose {
  const cycling = vehicle === 'bicycle' || !vehicle && action === 'ride'
  const walking = action === 'walk' && (!vehicle || vehicle === 'walk')
  const cycle = cycling ? 1600 : vehicle === 'scooter' ? 3200 : vehicle === 'skateboard' ? 3400 : walking ? 1800 : 1400
  const phase = ((elapsed % cycle) + cycle) % cycle / cycle
  const scale = (vehicle ? 163 : 184) / (rig.floor - rig.top)
  const lengths = rig.legs.map(b => [distance(b[0], b[1]) * scale, distance(b[1], b[2]) * scale])
  const total = Math.min(...lengths.map(([a, b]) => a + b))
  // A camera-projected reach ellipse places the pelvis above each contact.
  // Both arms and legs then solve in the same physical sagittal plane.
  const contactHeight = (foot: Point, source: Point, reach: number, hipX: number, width: number, skew: number, lean: number) => {
    const camera = Math.sqrt(1 - width * width), offset = (source.x - rig.hip.x) * scale
    const sx = offset * width, sy = (source.y - rig.hip.y) * scale + offset * skew
    const ax = -Math.sin(lean) / camera, ay = -Math.cos(lean)
    const bx = ((foot.x - hipX) * Math.cos(lean) + foot.y * Math.sin(lean) - sx) / camera
    const by = -(foot.x - hipX) * Math.sin(lean) + foot.y * Math.cos(lean) - sy
    const a = ax * ax + ay * ay, b = 2 * (ax * bx + ay * by)
    return (-b - Math.sqrt(Math.max(0, b * b - 4 * a * (bx * bx + by * by - reach * reach)))) / (2 * a)
  }
  // A low deck lets short-legged characters reach the ground without squatting.
  const deck = 188 - Math.min(4, total * .12)
  const radius = Math.min(10, total * .18)
  const crank = p(103, 155)
  const theta = phase * Math.PI * 2 - Math.PI / 2
  const pedals: [Point, Point] = [p(crank.x + radius * Math.cos(theta), crank.y + radius * Math.sin(theta)), p(crank.x - radius * Math.cos(theta), crank.y - radius * Math.sin(theta))]
  let hip = p(100, 195 - (rig.floor - rig.hip.y) * scale), angle = 0, stage = '步行'
  let bodyWidth = 1
  let bodySkew = 0
  let restingHip: Point | undefined
  const footAngles: [number, number] = [0, 0]
  const footHeading: [number, number] = [0, 0]
  const footDepth: [number, number] = [0, 0]
  const contacts: RigPose['contacts'] = ['sole', 'sole']
  // The rolling shoe contacts the ground at its heel/toe, not its ankle center.
  const grounded = (i: number, x: number, ground: number, roll: number): Point => {
    footAngles[i] = roll
    const shoe = shoeProjection(rig, scale, bodyWidth, footHeading[i])
    return p(x, ground - footDepth[i] - 3 - shoe.width / 2 * Math.abs(Math.sin(roll)) - shoe.toe * Math.sin(roll))
  }
  let feet: [Point, Point]
  if (cycling) {
    // Raise the saddle relative to each character's leg length: the knee opens on
    // the downstroke instead of folding both thighs against the torso.
    hip = p(crank.x - total * .28, crank.y - total * .68)
    feet = pedals; angle = .14 + Math.sin(theta * 2) * .008; stage = '踩踏'
  } else if (vehicle === 'scooter' || vehicle === 'skateboard') {
    const board = vehicle === 'skateboard', spread = Math.min(14, total * .26)
    bodySkew = -.08; footDepth[1] = 3
    const support = p(board ? 100 + spread : 105, deck - footDepth[1])
    const glide = p(board ? 100 - spread : 98, deck - footDepth[0])
    restingHip = p(board ? 100 : 102, -Infinity)
    for (const [i, foot] of [glide, support].entries()) {
      const reach = (lengths[i][0] + lengths[i][1]) * .997
      restingHip.y = Math.max(restingHip.y, contactHeight(foot, rig.legs[i][0], reach, restingHip.x, board ? .82 : .72, bodySkew, .035))
    }
    const pushWeight = phase >= .42 ? Math.sin((phase - .42) / .58 * Math.PI) ** 2 : 0
    bodyWidth = board ? .82 - pushWeight * .10 : .72
    if (board) {
      // Pivot towards the nose before pushing, then return to the transverse
      // cruising stance after the rear foot has recovered onto the deck.
      const pivot = phase < .34 ? 0 : phase < .46 ? ease((phase - .34) / .12)
        : phase < .88 ? 1 : 1 - ease((phase - .88) / .12)
      footHeading[0] = footHeading[1] = -Math.PI / 2 * (1 - pivot)
    }
    // Kick under the pelvis/support heel, then extend back and flex to recover.
    const restingWidth = board ? .82 : .72, camera = Math.sqrt(1 - restingWidth ** 2)
    const contactX = (board ? 100 : 102) + (rig.legs[0][0].x - rig.hip.x) * scale * restingWidth + total * .12 * camera
    const contact = p(contactX, 188 - footDepth[0]), finish = p(contactX - total * .35 * camera, 188 - footDepth[0])
    const lifted = p(finish.x + total * .08, deck - Math.min(16, total * .30))
    contacts[1] = 'deck'
    // Start in a readable cruising pose, then make one deliberate push and coast.
    if (phase < .42) { feet = [glide, support]; contacts[0] = 'deck'; stage = '滑行' }
    else if (phase < .54) {
      const t = (phase - .42) / .12, foot = lerp(glide, contact, ease(t))
      foot.y -= Math.sin(t * Math.PI) ** 2 * Math.min(14, total * .25)
      footAngles[0] = -.18 * Math.sin(t * Math.PI) ** 2
      feet = [foot, support]; contacts[0] = 'air'; stage = '落脚'
    } else if (phase < .74) {
      const t = (phase - .54) / .20
      feet = [grounded(0, lerp(contact, finish, ease(t)).x, 191, .30 * ease(t)), support]
      contacts[0] = t > .45 ? 'toe' : 'sole'; stage = '蹬地'
    } else if (phase < .86) {
      const t = ease((phase - .74) / .12)
      feet = [lerp(grounded(0, finish.x, 191, .30), lifted, t), support]
      footAngles[0] = .30 * (1 - t) - .20 * t
      contacts[0] = 'air'; stage = '提脚'
    } else {
      const t = ease((phase - .86) / .14)
      feet = [lerp(lifted, glide, t), support]; footAngles[0] = -.20 * (1 - t)
      contacts[0] = 'air'; stage = '收脚'
    }
    hip = p((board ? 100 : 102) + pushWeight * (board ? Math.min(2, total * .03) : -Math.min(3, total * .05)), -Infinity)
    const shoulderHeight = rig.arms.reduce((sum, arm, i) => sum + (rig.shoulders?.[i]?.y || arm[0].y), 0) / 2
    const leanScale = Math.min(1, total / Math.max(1, (rig.hip.y - shoulderHeight) * scale))
    angle = .035 + pushWeight * (board ? .065 : .09) * leanScale
    // Lower the pelvis only as much as a grounded push requires. Keep the planted
    // foot exact; clamping an ankle makes it float above the ground/deck.
    for (const [i, foot] of feet.entries()) {
      const reach = (lengths[i][0] + lengths[i][1]) * (.997 - pushWeight * .032)
      hip.y = Math.max(hip.y, contactHeight(foot, rig.legs[i][0], reach, hip.x, bodyWidth, bodySkew, angle))
    }
  } else if (walking) {
    bodyWidth = .88
    bodySkew = -.08; footDepth[1] = 3
    const stride = Math.min(13, total * .20) * Math.sqrt(1 - bodyWidth ** 2)
    hip.y = -Infinity
    feet = rig.legs.map((leg, i) => {
      const t = (phase + i * .5) % 1, base = 100 + (leg[0].x - rig.hip.x) * scale * bodyWidth
      // 60% stance and 40% swing: at least one sole stays planted at all times.
      if (t < .6) {
        const roll = t < .12 ? -.22 * (1 - ease(t / .12)) : t > .42 ? .40 * ease((t - .42) / .18) : 0
        contacts[i] = t < .12 ? 'heel' : t > .42 ? 'toe' : 'sole'
        return grounded(i, base + stride * (1 - 2 * t / .6), 191, roll)
      }
      const swing = (t - .6) / .4
      contacts[i] = 'air'
      footAngles[i] = .40 * (1 - ease(Math.min(1, swing / .35))) - .22 * ease(Math.max(0, (swing - .55) / .45))
      const lift = Math.sin(swing * Math.PI) ** 2 * Math.min(7, total * .13)
      return grounded(i, base - stride + stride * 2 * ease(swing), 191 - lift, footAngles[i])
    }) as [Point, Point]
    for (const [i, foot] of feet.entries()) {
      // One smooth reach envelope crosses heel/sole/toe/swing and the loop seam.
      // Hard stage constants amplified a subpixel pelvis jump into a knee snap.
      const reach = (lengths[i][0] + lengths[i][1]) * (.998 - .013 * ease(Math.min(1, Math.abs(footAngles[i]) / .4)))
      hip.y = Math.max(hip.y, contactHeight(foot, rig.legs[i][0], reach, hip.x, bodyWidth, bodySkew, angle))
    }
    stage = '迈步'
  } else {
    feet = [p(92, 193), p(108, 193)]
    if (action === 'jump' || action === 'celebrate') { const lift = Math.sin(phase * Math.PI) * (action === 'jump' ? 13 : 5); hip.y -= lift; feet.forEach(f => { f.y -= lift }) }
  }
  const map = (point: Point, origin = hip, lean = angle): Point => {
    const offset = (point.x - rig.hip.x) * scale
    const x = offset * bodyWidth, y = (point.y - rig.hip.y) * scale + offset * bodySkew
    return p(origin.x + x * Math.cos(lean) - y * Math.sin(lean), origin.y + x * Math.sin(lean) + y * Math.cos(lean))
  }
  const forwardProjection = Math.sqrt(Math.max(0, 1 - bodyWidth ** 2))
  const scooterTarget = (source: Point, length: number): Point => {
    const anchor = map(source, restingHip, .035)
    const x = Math.cos(.355) * length * .956 * forwardProjection, y = Math.sin(.355) * length * .956
    return p(anchor.x + x * Math.cos(.035) - y * Math.sin(.035), anchor.y + x * Math.sin(.035) + y * Math.cos(.035))
  }
  if (vehicle === 'scooter' && restingHip) {
    // Couple the pelvis to both planted feet and the fixed bar. Solving just
    // the feet let a short forearm collapse when the torso leaned towards it.
    // The same reach interval works for every template's existing proportions.
    for (let iteration = 0; iteration < 32; iteration++) {
      let left = -Infinity, right = Infinity
      for (const [i, arm] of rig.arms.entries()) {
        const source = rig.shoulders?.[i] || p(arm[0].x % (rig.key === 'jianwen' ? 160 : 1000), arm[0].y)
        const upper = distance(arm[0], arm[1]) * scale, lower = distance(arm[1], arm[2]) * scale
        const length = upper + lower
        const target = scooterTarget(source, length)
        const offset = (source.x - rig.hip.x) * scale
        const sx = offset * bodyWidth, sy = (source.y - rig.hip.y) * scale + offset * bodySkew
        // Solve physical reach after undoing the parent transform and camera.
        // A screen-space circle lets the foreshortened arm overextend.
        const ax = -Math.cos(angle) / forwardProjection, ay = Math.sin(angle)
        const bx = (target.x * Math.cos(angle) + (target.y - hip.y) * Math.sin(angle) - sx) / forwardProjection
        const by = -target.x * Math.sin(angle) + (target.y - hip.y) * Math.cos(angle) - sy
        const a = ax * ax + ay * ay, b = 2 * (ax * bx + ay * by)
        const root = (reach: number) => (-b - Math.sqrt(Math.max(0, b * b - 4 * a * (bx * bx + by * by - reach * reach)))) / (2 * a)
        const maxReach = Math.sqrt(upper * upper + lower * lower - 2 * upper * lower * Math.cos(165 * Math.PI / 180))
        const minReach = Math.sqrt(upper * upper + lower * lower - 2 * upper * lower * Math.cos(140 * Math.PI / 180))
        left = Math.max(left, root(maxReach)); right = Math.min(right, root(minReach))
      }
      const previous = { ...hip }
      // Damping couples the foot-height ellipse to the grip ellipse without
      // alternating between a crouch and an overextended arm on short bodies.
      const targetX = left <= right ? Math.max(left, Math.min(right, hip.x)) : (left + right) / 2
      hip.x += (targetX - hip.x) * .35
      hip.y = -Infinity
      const pushWeight = phase < .42 ? 0 : Math.sin((phase - .42) / .58 * Math.PI) ** 2
      for (const [i, foot] of feet.entries()) {
        const reach = (lengths[i][0] + lengths[i][1]) * (.997 - pushWeight * .032)
        hip.y = Math.max(hip.y, contactHeight(foot, rig.legs[i][0], reach, hip.x, bodyWidth, bodySkew, angle))
      }
      if (distance(previous, hip) < 1e-7) break
    }
  }
  const projectedLegs = walking || vehicle === 'scooter' || vehicle === 'skateboard'
  const legLocal: [Bone, Bone] = [bone([0, 0], [0, 0], [0, 0]), bone([0, 0], [0, 0], [0, 0])]
  const legs = rig.legs.map((b, i) => {
    const separation = Math.min(2, total * .04)
    const start = projectedLegs ? map(b[0])
      : vehicle && vehicle !== 'walk' || cycling ? p(hip.x + (i ? separation : -separation), hip.y) : map(b[0])
    const [upper, lower] = lengths[i]
    if (projectedLegs) {
      const dx = feet[i].x - start.x, dy = feet[i].y - start.y
      const end = p((dx * Math.cos(angle) + dy * Math.sin(angle)) / forwardProjection, -dx * Math.sin(angle) + dy * Math.cos(angle))
      legLocal[i] = [p(0, 0), bend(p(0, 0), end, upper, lower, -1), end]
      return legLocal[i].map(point => {
        const x = point.x * forwardProjection, y = point.y
        return p(start.x + x * Math.cos(angle) - y * Math.sin(angle), start.y + x * Math.sin(angle) + y * Math.cos(angle))
      }) as Bone
    }
    // Walking/board contacts are clamped per leg, preserving each model's proportions.
    const target = { ...feet[i] }, reach = distance(start, target), max = upper + lower - .01, min = Math.abs(upper - lower) + .01
    if (reach > max || reach < min) {
      const factor = Math.min(max, Math.max(min, reach)) / Math.max(.001, reach)
      target.x = start.x + (target.x - start.x) * factor; target.y = start.y + (target.y - start.y) * factor
    }
    // Both knees bend forward. Occlusion separates limbs; reversing the IK
    // branch to separate silhouettes gives one leg an impossible backwards knee.
    legLocal[i] = [start, bend(start, target, upper, lower, -1), target]
    return legLocal[i]
  }) as [Bone, Bone]
  const holding = vehicle === 'bicycle' || vehicle === 'scooter' || !vehicle && action === 'ride'
  const shoulders = rig.arms.map((b, i) => map(rig.shoulders?.[i] || p(b[0].x % (rig.key === 'jianwen' ? 160 : 1000), b[0].y)))
  // Scooter shoulders stay attached to their own projected torso edges.
  if (cycling) { shoulders[0] = p(shoulders[1].x - 5, shoulders[1].y + 1) }
  const armLengths = rig.arms.map(b => [distance(b[0], b[1]) * scale, distance(b[1], b[2]) * scale])
  const gripLength = Math.min(...armLengths.map(([upper, lower]) => upper + lower))
  const grip = p(shoulders[1].x + gripLength * .80, shoulders[1].y + gripLength * .40)
  const farGrip = p(grip.x - 3, grip.y)
  const push = phase < .42 ? 0 : Math.sin((phase - .42) / .58 * Math.PI) ** 2
  const projectedArms = walking || vehicle === 'skateboard' || vehicle === 'scooter'
  const armLocal: [Bone, Bone] = [bone([0, 0], [0, 0], [0, 0]), bone([0, 0], [0, 0], [0, 0])]
  const armDepth: RigPose['armDepth'] = [[-1, -1, -1], [1, 1, 1]]
  const projectArm = (i: number, local: Bone): Bone => {
    armLocal[i] = local
    const source = rig.shoulders?.[i] || p(rig.arms[i][0].x % (rig.key === 'jianwen' ? 160 : 1000), rig.arms[i][0].y)
    const shoulderDepth = -(source.x - rig.hip.x) * scale * forwardProjection
    armDepth[i] = local.map(point => shoulderDepth + point.x * bodyWidth) as [number, number, number]
    // One camera yaw projects both forward movement and its actual depth.
    // The entire chain inherits the torso transform, including its direction.
    return local.map(point => {
      const x = point.x * forwardProjection, y = point.y
      return p(shoulders[i].x + x * Math.cos(angle) - y * Math.sin(angle), shoulders[i].y + x * Math.sin(angle) + y * Math.cos(angle))
    }) as Bone
  }
  const arms = rig.arms.map((b, i) => {
    const start = shoulders[i], [upper, lower] = armLengths[i]
    if (walking) {
      const t = (phase + i * .5) % 1
      // The arm travels backwards while its same-side leg travels forwards.
      // The shoulder sets the arc; a softly flexed elbow carries the forearm.
      const swing = walkingShoulder(t)
      // The elbow follows the same shoulder's forward swing with a small lag,
      // rather than flexing on an unrelated sine wave ahead of the whole arm.
      const flex = .16 + .24 * (.5 + .5 * walkingShoulder((t + .96) % 1) / .34)
      return projectArm(i, swingArm(p(0, 0), upper, lower, swing, flex))
    }
    if (vehicle === 'skateboard') {
      // Free arms counterbalance the rear-leg push. They never imitate a grip,
      // and the two shoulders lead in opposite directions during weight transfer.
      const sway = Math.sin(phase * Math.PI * 2) * .035
      const swing = i ? -.08 - push * .34 + sway : .04 + push * .32 - sway
      return projectArm(i, swingArm(p(0, 0), upper, lower, swing, .18 + push * .16))
    }
    if (vehicle === 'scooter') {
      // Keep each arm almost extended, with a little shock-absorbing flexion.
      // Using the shorter arm for both grips folded the longer arm at its elbow.
      // Each template instead has its own reach and a correctly separated grip.
      // The bar belongs to the scooter, not to a bobbing shoulder. Fit it once
      // to the resting proportions, then let the torso/arms move under it.
      const source = rig.shoulders?.[i] || p(b[0].x % (rig.key === 'jianwen' ? 160 : 1000), b[0].y)
      const target = scooterTarget(source, upper + lower)
      const dx = target.x - start.x, dy = target.y - start.y
      const localTarget = p((dx * Math.cos(angle) + dy * Math.sin(angle)) / forwardProjection, -dx * Math.sin(angle) + dy * Math.cos(angle))
      return projectArm(i, [p(0, 0), bend(p(0, 0), localTarget, upper, lower, 1), localTarget])
    }
    const target = holding ? { ...(i ? grip : farGrip) }
      : action === 'wave' && i === 1 ? p(start.x + upper * .5, start.y - lower * (1 + .15 * Math.sin(phase * Math.PI * 4)))
        : action === 'celebrate' ? p(start.x + (i ? 1 : -1) * upper * .4, start.y - lower)
          : action === 'observe' && i === 1 ? p(hip.x + 5, start.y - 8)
            : action === 'cook' ? p(hip.x + (i ? 10 : -8), hip.y - 10 + (i ? Math.sin(phase * Math.PI * 2) * 3 : 0))
        : p(start.x + (i ? 1 : -1) * upper * .45, start.y + (upper + lower) * .84)
    const reach = distance(start, target), limit = upper + lower - .01
    if (reach > limit) { target.x = start.x + (target.x - start.x) * limit / reach; target.y = start.y + (target.y - start.y) * limit / reach }
    return [start, bend(start, target, upper, lower, holding ? 1 : i ? -1 : 1), target] as Bone
  }) as [Bone, Bone]
  if (!projectedArms) {
    for (const [i, arm] of arms.entries()) {
      armLocal[i] = arm
      const source = rig.shoulders?.[i] || p(rig.arms[i][0].x % (rig.key === 'jianwen' ? 160 : 1000), rig.arms[i][0].y)
      const shoulderDepth = -(source.x - rig.hip.x) * scale * forwardProjection
      armDepth[i] = arm.map(point => cycling || bodyWidth === 1 ? i ? 1 : -1 : shoulderDepth + (point.x - arm[0].x) * bodyWidth / Math.max(.1, forwardProjection)) as [number, number, number]
    }
  }
  const gripBinding = rig.armSource?.grip || rig.gripBinding
  const gripScale = scale * (rig.armSource?.grip ? rig.armWidth / rig.armSource.width : 1)
  const handContact = (wrist: Point) => (cycling || vehicle === 'scooter') && gripBinding ? p(wrist.x + (gripBinding.contact.x - gripBinding.wrist.x) * gripScale, wrist.y + (gripBinding.contact.y - gripBinding.wrist.y) * gripScale) : wrist
  return { scale, hip, angle, legs, arms, armLocal, projectedArms, legLocal, projectedLegs, armDepth, phase, stage, crank, pedals, radius, seat: cycling ? p(hip.x - 2, hip.y + 4) : hip, grip: handContact(arms[1][2]), farGrip: handContact(arms[0][2]), floor: 191, deck, action, bodyWidth, bodySkew, footAngles, footHeading, footDepth, contacts }
}
