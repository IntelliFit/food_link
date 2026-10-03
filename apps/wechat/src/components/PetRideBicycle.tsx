import { View } from '@tarojs/components'
import './PetRideBicycle.scss'

type Point = { x: number; y: number }
export interface PetRideAnchors { hand: Point; seat: Point; foot: Point }
// Measured from each packed seated pose, in the floating companion's rpx coordinates.
const anchors: Record<string, PetRideAnchors> = {
  guigui: { hand: { x: 104.3, y: 90 }, seat: { x: 60.2, y: 117.4 }, foot: { x: 84.2, y: 152.4 } },
  jianwen: { hand: { x: 108.5, y: 96.5 }, seat: { x: 52.4, y: 119.3 }, foot: { x: 74.8, y: 148.6 } },
  huatuo: { hand: { x: 108, y: 90.2 }, seat: { x: 52.4, y: 125.1 }, foot: { x: 68.4, y: 152.4 } },
  taiji: { hand: { x: 109.3, y: 88 }, seat: { x: 54.3, y: 115.4 }, foot: { x: 75.7, y: 152.4 } },
  xiaomai: { hand: { x: 112, y: 99.8 }, seat: { x: 58.3, y: 125.1 }, foot: { x: 79.9, y: 158.3 } },
  doudou: { hand: { x: 107.7, y: 98.8 }, seat: { x: 54.3, y: 119.3 }, foot: { x: 81.2, y: 140.8 } },
}
export function petRideAnchors(atlas?: string): PetRideAnchors | undefined {
  const key = atlas?.match(/^\/assets\/pets\/motions\/(\w+)-motion-v1\.png$/)?.[1]
  return key ? anchors[key] : undefined
}
const rpx = (value: number) => `${Math.round(value * 100) / 100}rpx`
const position = (x: number, y: number) => ({ left: rpx(x), top: rpx(y) })
function Tube({ from, to, name }: { from: Point; to: Point; name: string }) {
  const dx = to.x - from.x, dy = to.y - from.y
  return <View className={`pet-assistant-ride__frame is-${name}`} style={{ ...position(from.x, from.y - 2.5), width: rpx(Math.hypot(dx, dy)), transform: `rotate(${Math.atan2(dy, dx) * 180 / Math.PI}deg)` }} />
}

/** Coasting: one stable seated pose, a closed frame and continuously rolling wheels. */
export function PetRideBicycle({ fit }: { fit: PetRideAnchors }) {
  const rear = { x: fit.seat.x - 30, y: fit.foot.y + 4 }
  const front = { x: fit.hand.x + 24, y: rear.y }
  const head = { x: fit.hand.x + 2, y: fit.seat.y + 2 }
  const crank = { x: fit.foot.x - 9, y: fit.foot.y - 7 }
  return <View className='pet-assistant-ride pet-assistant-ride--fitted' aria-hidden>
    {[rear, front].map((point, index) => <View key={index} className='pet-assistant-ride__wheel' style={position(point.x - 21, point.y - 21)}><View className='pet-assistant-ride__hub' /></View>)}
    <Tube name='chain' from={rear} to={crank} /><Tube name='seat-stay' from={rear} to={fit.seat} />
    <Tube name='seat-tube' from={fit.seat} to={crank} /><Tube name='top' from={fit.seat} to={head} />
    <Tube name='down' from={head} to={crank} /><Tube name='fork' from={head} to={front} />
    <Tube name='stem' from={head} to={fit.hand} />
    <View className='pet-assistant-ride__seat' style={position(fit.seat.x - 13.5, fit.seat.y - 4)} />
    <View className='pet-assistant-ride__grip' style={position(fit.hand.x - 8, fit.hand.y - 2)} />
    <View className='pet-assistant-ride__pedal' style={position(crank.x - 7.5, crank.y - 7.5)} />
    <Tube name='crank-arm' from={crank} to={{ x: fit.foot.x, y: fit.foot.y - 2 }} />
    <View className='pet-assistant-ride__footrest' style={position(fit.foot.x - 6, fit.foot.y - 2)} />
  </View>
}
