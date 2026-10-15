import { distance, lerp, shoeProjection, travelHeadRect, type PetRig, type Point, type RigPose } from './pet-rig'
import type { PetTransportId } from './pet-transport'
import { armSkin, drawArmJoint, drawArmSkin } from './pet-arm-skin'

function line(ctx: CanvasRenderingContext2D, a: Point, b: Point, color: string, width: number) {
  ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineCap = 'round'
  ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke()
}
function disc(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string) {
  ctx.fillStyle = color; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill()
}
/** End the sleeve at its wrist plane so the source palm is not skinned twice. */
function sleeveMask(texture: NonNullable<PetRig['armSource']>): Point[] {
  if (!texture.handBinding) return texture.mask
  const wrist = texture.bone[2], elbow = texture.bone[1]
  const length = distance(elbow, wrist), ux = (wrist.x - elbow.x) / length, uy = (wrist.y - elbow.y) / length
  const plane = (point: Point) => (point.x - wrist.x) * ux + (point.y - wrist.y) * uy - .35
  return texture.mask.flatMap((point, index) => {
    const previous = texture.mask[(index + texture.mask.length - 1) % texture.mask.length]
    const a = plane(previous), b = plane(point)
    const crossing = a * b < 0 ? [lerp(previous, point, a / (a - b))] : []
    return b <= 0 ? [...crossing, point] : crossing
  })
}
function wheel(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, phase: number, perspective = 1) {
  ctx.save(); ctx.translate(x, y); ctx.scale(perspective, 1); ctx.translate(-x, -y)
  ctx.strokeStyle = '#273a36'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke()
  ctx.strokeStyle = '#b8c5b5'; ctx.lineWidth = 1
  for (let i = 0; i < 6; i++) { const angle = phase * Math.PI * 4 + i * Math.PI / 3; line(ctx, { x, y }, { x: x + Math.cos(angle) * (r - 2), y: y + Math.sin(angle) * (r - 2) }, '#b8c5b5', .8) }
  disc(ctx, x, y, 2.5, '#607b69')
  ctx.restore()
}

/** Texture a rigid limb with pixels from the same approved source, without repainting its outfit. */
function segment(ctx: CanvasRenderingContext2D, image: CanvasImageSource, from: Point, to: Point, a: Point, b: Point, width: number, scale: number, tipWidth = width / 2, flatTip = false, projected = false) {
  ctx.save(); ctx.translate(a.x, a.y)
  const length = distance(from, to), angle = Math.atan2(to.y - from.y, to.x - from.x)
  ctx.rotate(Math.atan2(b.y - a.y, b.x - a.x))
  ctx.scale(projected ? distance(a, b) / Math.max(.001, length) : scale, scale)
  ctx.beginPath(); ctx.moveTo(0, -width / 2); ctx.lineTo(length, -tipWidth)
  if (flatTip) ctx.lineTo(length, tipWidth)
  else ctx.arc(length, 0, tipWidth, -Math.PI / 2, Math.PI / 2)
  ctx.lineTo(0, width / 2); ctx.arc(0, 0, width / 2, Math.PI / 2, Math.PI * 1.5); ctx.closePath(); ctx.clip()
  ctx.rotate(-angle); ctx.translate(-from.x, -from.y); ctx.drawImage(image, 0, 0); ctx.restore()
}
function bodyPart(ctx: CanvasRenderingContext2D, image: CanvasImageSource, rect: number[], rig: PetRig, pose: RigPose, head = false, headBox?: number[]) {
  ctx.save(); ctx.translate(pose.hip.x, pose.hip.y); ctx.rotate(pose.angle)
  ctx.scale(pose.scale, pose.scale)
  // A torso has front-to-back thickness: a side view must not flatten it into
  // a zero-depth sheet even though its shoulder separation is foreshortened.
  const torsoWidth = pose.travelFacing > 0 ? Math.sqrt(pose.bodyWidth ** 2 + .25 * (1 - pose.bodyWidth ** 2)) : pose.bodyWidth
  if (headBox) {
    ctx.translate(headBox[0] - rig.hip.x, headBox[1] - rig.hip.y)
    ctx.scale(headBox[2] / rect[2], headBox[3] / rect[3]); ctx.translate(-rect[0], -rect[1])
  } else {
    ctx.transform(head ? .96 + pose.bodyWidth * .04 : torsoWidth, head ? pose.bodySkew * .35 : pose.bodySkew, 0, 1, 0, 0)
    ctx.translate(-rig.hip.x, -rig.hip.y)
  }
  const [x, y, w, h] = rect
  if (head && rig.key === 'huatuo') {
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w, 138); ctx.lineTo(139, 145); ctx.lineTo(134, y + h); ctx.lineTo(93, y + h); ctx.lineTo(93, 145); ctx.lineTo(x, 138); ctx.closePath(); ctx.clip()
  }
  if (head && rig.key === 'xiaomai') {
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w, 107); ctx.lineTo(174, 111); ctx.lineTo(163, 121); ctx.lineTo(153, 126); ctx.lineTo(143, 132); ctx.lineTo(133, 137); ctx.lineTo(124, 140); ctx.lineTo(91, 143); ctx.lineTo(74, 142); ctx.lineTo(74, 154); ctx.lineTo(65, 165); ctx.lineTo(45, 158); ctx.lineTo(43, 140); ctx.lineTo(57, 129); ctx.lineTo(x, 111); ctx.closePath(); ctx.clip()
  }
  if (head && rig.key === 'doudou') {
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w, 130); ctx.lineTo(159, 145); ctx.lineTo(100, 147); ctx.lineTo(75, 129); ctx.lineTo(x, 118); ctx.closePath(); ctx.clip()
  }
  if (head && rig.key === 'taiji') {
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + w, y); ctx.lineTo(169, 127); ctx.lineTo(151, 134); ctx.lineTo(138, 140); ctx.lineTo(130, 143); ctx.lineTo(110, 143); ctx.lineTo(101, 138); ctx.lineTo(92, 132); ctx.lineTo(77, 127); ctx.closePath(); ctx.clip()
  }
  if (!head) {
    // A tapered torso keeps the original sleeves/props outside the animated body.
    ctx.beginPath()
    if (pose.bodyWidth < 1 && pose.travelFacing > 0) {
      ctx.moveTo(x + w * .3, y); ctx.lineTo(x + w * .7, y)
      ctx.quadraticCurveTo(x + w * .96, y, x + w * .96, y + h * .16)
      ctx.lineTo(x + w * .84, y + h * .36); ctx.lineTo(x + w, y + h)
      ctx.lineTo(x, y + h); ctx.lineTo(x + w * .16, y + h * .36); ctx.lineTo(x + w * .04, y + h * .16)
      ctx.quadraticCurveTo(x + w * .04, y, x + w * .3, y)
    } else if (pose.bodyWidth < 1) {
      ctx.moveTo(x + w * .04, y); ctx.lineTo(x + w * .96, y)
      ctx.lineTo(x + w * .84, y + h * .36); ctx.lineTo(x + w, y + h)
      ctx.lineTo(x, y + h); ctx.lineTo(x + w * .16, y + h * .36)
    } else {
      ctx.moveTo(x + w * .16, y); ctx.lineTo(x + w * .84, y); ctx.lineTo(x + w, y + h); ctx.lineTo(x, y + h)
    }
    ctx.closePath(); ctx.clip()
  }
  ctx.drawImage(image, x, y, w, h, x, y, w, h); ctx.restore()
}

/** Clip only the part of each bone that has moved in front of the torso plane. */
function armLayerClip(ctx: CanvasRenderingContext2D, rig: PetRig, pose: RigPose, side: number, front: boolean): boolean {
  const arm = pose.arms[side], depth = pose.armDepth[side].map(z => front ? z : -z)
  if (depth.every(z => z <= 0)) return false
  if (depth.every(z => z >= 0)) return true
  let visible = false
  ctx.beginPath()
  for (const part of [0, 1]) {
    const da = depth[part], db = depth[part + 1]
    if (da <= 0 && db <= 0) continue
    visible = true
    const from = da < 0 ? lerp(arm[part], arm[part + 1], -da / (db - da)) : arm[part]
    const to = db < 0 ? lerp(arm[part], arm[part + 1], -da / (db - da)) : arm[part + 1]
    const length = distance(from, to)
    if (length < .001) continue
    const ux = (to.x - from.x) / length, uy = (to.y - from.y) / length
    const width = (rig.armWidth / 2 + 5) * pose.scale
    const start = da >= 0 ? { x: from.x - ux * width, y: from.y - uy * width } : from
    const end = db >= 0 ? { x: to.x + ux * width, y: to.y + uy * width } : to
    ctx.moveTo(start.x - uy * width, start.y + ux * width); ctx.lineTo(end.x - uy * width, end.y + ux * width)
    ctx.lineTo(end.x + uy * width, end.y - ux * width); ctx.lineTo(start.x + uy * width, start.y - ux * width); ctx.closePath()
  }
  if (visible) ctx.clip()
  return visible
}
export function drawPetRig(ctx: CanvasRenderingContext2D, image: CanvasImageSource, rig: PetRig, pose: RigPose, vehicle?: PetTransportId, ground = false, armImage?: CanvasImageSource, vehicleAlpha = 1, profileImage?: CanvasImageSource) {
  const cycling = vehicle === 'bicycle' || !vehicle && pose.action === 'ride'
  ctx.clearRect(0, 0, 200, 220)
  if (ground) line(ctx, { x: 5, y: pose.floor + 2 }, { x: 195, y: pose.floor + 2 }, '#b8ba9a', .8)
  ctx.save(); ctx.translate(100, pose.floor + 1); ctx.scale(1, .15); disc(ctx, 0, 0, 39, 'rgba(51,62,43,.12)'); ctx.restore()
  const vehicleLayer = (wheels: boolean) => {
    ctx.save(); ctx.globalAlpha *= vehicleAlpha
    if (vehicle === 'bicycle') {
      const rear = { x: pose.crank.x + (49 - pose.crank.x) * pose.vehicleProjection, y: 167 }
      const front = { x: pose.crank.x + (153 - pose.crank.x) * pose.vehicleProjection, y: 167 }
      if (wheels) { wheel(ctx, rear.x, rear.y, 24, pose.phase, pose.vehicleProjection); wheel(ctx, front.x, front.y, 24, pose.phase, pose.vehicleProjection) }
      else {
        const head = { x: pose.grip.x + 6, y: pose.seat.y + 8 }
        for (const [a, b] of [[rear, pose.seat], [pose.seat, pose.crank], [pose.crank, rear], [pose.seat, head], [head, pose.crank], [head, front], [head, pose.grip]]) line(ctx, a, b, '#709078', 3.4)
        line(ctx, { x: pose.farGrip.x - 3, y: pose.farGrip.y }, { x: pose.grip.x + 3, y: pose.grip.y }, '#334b40', 3.4)
        line(ctx, { x: pose.seat.x - 9, y: pose.seat.y }, { x: pose.seat.x + 8, y: pose.seat.y }, '#514737', 4)
        disc(ctx, pose.crank.x, pose.crank.y, 5, '#354b40')
        line(ctx, pose.crank, pose.pedals[0], '#394c44', 2); line(ctx, pose.crank, pose.pedals[1], '#394c44', 2)
        for (const pedal of pose.pedals) line(ctx, { x: pedal.x - 5, y: pedal.y + 3 }, { x: pedal.x + 5, y: pedal.y + 3 }, '#28352f', 2)
      }
    } else if (wheels && (vehicle === 'scooter' || vehicle === 'skateboard')) {
      const rear = vehicle === 'scooter' ? 78 : 80, front = vehicle === 'scooter' ? 146 : 127
      wheel(ctx, rear, 186, 5, pose.phase, pose.vehicleProjection); wheel(ctx, front, 186, 5, pose.phase, pose.vehicleProjection)
      ctx.fillStyle = '#b8c8a9'; ctx.beginPath(); ctx.moveTo(rear - 4, pose.deck + 3); ctx.lineTo(front + 6, pose.deck + 3)
      ctx.lineTo(front, pose.deck); ctx.lineTo(rear - 10, pose.deck); ctx.closePath(); ctx.fill()
      line(ctx, { x: rear - 4, y: pose.deck + 3 }, { x: front + 6, y: pose.deck + 3 }, '#496b59', 4)
      line(ctx, { x: rear, y: pose.deck + 1 }, { x: front, y: pose.deck + 1 }, '#afc0a0', 1.5)
      if (vehicle === 'scooter') {
        const stem = { x: (pose.farGrip.x + pose.grip.x) / 2, y: (pose.farGrip.y + pose.grip.y) / 2 }
        line(ctx, { x: front - 3, y: 185 }, stem, '#819586', 3)
        line(ctx, { x: pose.farGrip.x - 4, y: pose.farGrip.y - 1 }, { x: pose.grip.x + 4, y: pose.grip.y + 1 }, '#334b40', 3.4)
      }
    }
    ctx.restore()
  }
  vehicleLayer(true)
  const limbs = (kind: 'legs' | 'arms', side: number, layer?: 'front' | 'back') => {
    ctx.save()
    const holding = kind === 'arms' && (vehicle === 'scooter' || vehicle === 'bicycle' || !vehicle && pose.action === 'ride') && Boolean(rig.gripHand || armImage && rig.armSource?.grip)
    if (layer && !holding && !armLayerClip(ctx, rig, pose, side, layer === 'front')) { ctx.restore(); return }
    const src = rig[kind][side], dest = pose[kind][side], width = kind === 'legs' ? rig.legWidth : rig.armWidth
    if (kind === 'legs') {
      // Front-view trouser widths hid the alternating knees in a side view.
      // Project their thickness too, keeping the source pixels and bone lengths.
      const thickness = cycling ? Math.min(Math.sqrt(pose.bodyWidth ** 2 + .45 * (1 - pose.bodyWidth ** 2)), (distance(src[0], src[1]) + distance(src[1], src[2])) / width * .5) : 1
      const legScale = pose.scale * (1 + (thickness - 1) * pose.travelFacing)
      segment(ctx, image, src[0], src[1], dest[0], dest[1], width, legScale, width / 2, false, pose.projectedLegs)
      const length = distance(src[1], src[2]), factor = Math.max(.5, 1 - 4 / length)
      const cut = { x: src[1].x + (src[2].x - src[1].x) * factor, y: src[1].y + (src[2].y - src[1].y) * factor }
      const end = { x: dest[1].x + (dest[2].x - dest[1].x) * factor, y: dest[1].y + (dest[2].y - dest[1].y) * factor }
      segment(ctx, image, src[1], cut, dest[1], end, width, legScale, width / 2, true, pose.projectedLegs)
      // Shoe roll is independent of the shin, with heel/toe ground contact.
      const bottom = ({ huatuo: 236, taiji: 236, xiaomai: 239, doudou: 236 } as Record<string, number>)[rig.key] || rig.floor
      const h = Math.max(8, bottom - src[2].y + 4), w = width + 4
      const shoe = shoeProjection(rig, pose.scale, pose.bodyWidth, pose.footHeading[side])
      ctx.save(); ctx.translate(dest[2].x, dest[2].y + 3); ctx.rotate(pose.footAngles[side])
      // Project the original shoe material onto its changing footprint. The
      // ankle stays fixed while the toe turns towards/away from the board nose.
      ctx.transform(shoe.width / (w * pose.scale), 0, shoe.toe / (h * pose.scale), 1, shoe.toe, 0)
      ctx.drawImage(image, src[2].x - w / 2, bottom - h, w, h, -w * pose.scale / 2, -h * pose.scale, w * pose.scale, h * pose.scale)
      ctx.restore()
    } else {
      const texture = rig.armSource && armImage ? rig.armSource : undefined
      const arm = texture?.bone || src, material = texture ? armImage! : image
      const textureWidth = texture?.width || width, textureScale = pose.scale * width / textureWidth
      const sourceHipX = texture?.hipX || rig.hip.x + Math.floor(src[0].x / rig.frame[2]) * rig.frame[2]
      const binding = texture?.handBinding || rig.handBindings?.[side]
      const skinMask = binding?.skinMask || (texture ? sleeveMask(texture) : undefined)
      ctx.save()
      if (!holding || !layer || armLayerClip(ctx, rig, pose, side, layer === 'front')) {
        drawArmJoint(ctx, material, arm, dest, textureWidth, textureScale, skinMask)
        drawArmSkin(ctx, material, armSkin(arm, dest, textureWidth, textureScale, sourceHipX), skinMask)
      }
      ctx.restore()
      const gripHand = texture?.grip?.hand || rig.gripHand
      if (holding && gripHand) {
        // The palm rests on the bar, with fingers down. Do not rotate a dangling
        // hand with the forearm, which made the grip look broken at the wrist.
        // Its horizontal fingers extend beyond the sleeve strip. Paint the whole
        // grip once on its wrist's side of the torso; retain split clips for free arms.
        if (layer && (pose.armDepth[side][2] >= 0) !== (layer === 'front')) { ctx.restore(); return }
        const [handX, handY, handWidth, handHeight] = gripHand
        const anchor = texture?.grip?.wrist || rig.gripBinding?.wrist || { x: handX + handWidth / 2, y: handY + 3 }
        const handScale = texture?.grip ? textureScale : pose.scale
        ctx.drawImage(texture?.grip ? material : image, handX, handY, handWidth, handHeight,
          dest[2].x + (handX - anchor.x) * handScale, dest[2].y + (handY - anchor.y) * handScale, handWidth * handScale, handHeight * handScale)
      } else if (texture || rig.hands) {
        const [x, y, w, h] = texture?.hand || rig.hands![side]
        const handRoot = binding?.wrist || arm[2]
        const handAxis = binding?.axis
        const sourceAngle = handAxis ? Math.atan2(handAxis.y - handRoot.y, handAxis.x - handRoot.x) : Math.atan2(arm[2].y - arm[1].y, arm[2].x - arm[1].x)
        const targetAngle = Math.atan2(dest[2].y - dest[1].y, dest[2].x - dest[1].x)
        // A hand is an attachment, not another piece of the sleeve UV mesh.
        // Preserve its palm shape, applying only the physical camera projection.
        const palmScale = textureScale * (binding?.scale ?? 1)
        const projection = distance(dest[1], dest[2]) / (distance(src[1], src[2]) * pose.scale)
        ctx.save(); ctx.translate(dest[2].x, dest[2].y); ctx.rotate(targetAngle)
        ctx.scale(palmScale * projection, palmScale)
        ctx.rotate(-sourceAngle); ctx.translate(-handRoot.x, -handRoot.y)
        const mask = binding?.mask || texture?.mask
        if (mask) {
          ctx.beginPath(); ctx.moveTo(mask[0].x, mask[0].y)
          mask.slice(1).forEach(point => ctx.lineTo(point.x, point.y)); ctx.closePath(); ctx.clip()
        }
        ctx.drawImage(material, x, y, w, h, x, y, w, h); ctx.restore()
      }
    }
    ctx.restore()
  }
  // Paint all back portions, cover them with the torso, then paint only those
  // portions whose depth is in front. This is shared by every rig/proportion.
  limbs('arms', 0, pose.bodyWidth < 1 ? 'back' : undefined)
  if (pose.bodyWidth < 1) limbs('arms', 1, 'back')
  // The far leg passes behind the frame; the near outer leg covers it.
  if (pose.bodyWidth < 1) { limbs('legs', 1); vehicleLayer(false); if (!cycling) limbs('legs', 0) }
  else { vehicleLayer(false); limbs('legs', 0); limbs('legs', 1) }
  bodyPart(ctx, image, rig.torso, rig, pose)
  // The outer bent thigh passes in front of a seated coat/robe. Painting the
  // whole upright garment last previously covered even the animated knee.
  if (cycling && pose.bodyWidth < 1) limbs('legs', 0)
  if (pose.bodyWidth < 1) { limbs('arms', 1, 'front'); limbs('arms', 0, 'front') }
  else limbs('arms', 1)
  const profile = rig.profileHead
  const headBox = travelHeadRect(rig, pose.travelFacing)
  if (profile && profileImage && pose.travelFacing > .5) {
    // Reuse the character's existing forward-looking art. Squashing the front
    // face cannot turn it into a side view, and must not expose both faces.
    const [x, y, w, h] = profile.rect
    ctx.save(); ctx.translate(pose.hip.x, pose.hip.y); ctx.rotate(pose.angle); ctx.scale(pose.scale, pose.scale)
    ctx.translate(headBox[0] - rig.hip.x, headBox[1] - rig.hip.y)
    ctx.scale(headBox[2] / w, headBox[3] / h); ctx.translate(-x, -y)
    if (profile.mask) {
      ctx.beginPath(); ctx.moveTo(profile.mask[0].x, profile.mask[0].y)
      profile.mask.slice(1).forEach(point => ctx.lineTo(point.x, point.y)); ctx.closePath(); ctx.clip()
    }
    ctx.drawImage(profileImage, x, y, w, h, x, y, w, h); ctx.restore()
  } else bodyPart(ctx, image, rig.head, rig, pose, true, pose.travelFacing > 0 ? headBox : undefined)
  if (!vehicle && pose.action === 'blink' && pose.phase > .12 && pose.phase < .19) {
    const eyes: Record<string, [number, number, number, number, string]> = {
      guigui: [69, 64, 96, 64, '#eebb98'], jianwen: [62, 76, 95, 76, '#ffc183'],
      huatuo: [95, 107, 136, 107, '#ebcba0'], taiji: [101, 108, 141, 106, '#eec9a1'],
      xiaomai: [95, 104, 137, 104, '#ffe3bc'], doudou: [106, 113, 151, 113, '#f5eee0'],
    }
    const [x1, y1, x2, y2, skin] = eyes[rig.key]
    ctx.save(); ctx.translate(pose.hip.x, pose.hip.y); ctx.rotate(pose.angle); ctx.scale(pose.scale, pose.scale); ctx.translate(-rig.hip.x, -rig.hip.y)
    for (const [x, y] of [[x1, y1], [x2, y2]]) {
      ctx.fillStyle = skin; ctx.beginPath(); ctx.ellipse(x, y, rig.key === 'guigui' ? 3.6 : 5, 4, 0, 0, Math.PI * 2); ctx.fill()
      line(ctx, { x: x - 3, y: y + 1 }, { x: x + 3, y: y + 1 }, '#614735', 1.3)
    }
    ctx.restore()
  }
}
