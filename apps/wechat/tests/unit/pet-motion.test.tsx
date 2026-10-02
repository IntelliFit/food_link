import { readFileSync } from 'fs'
import { resolve } from 'path'
import * as sharp from 'sharp'
import { fireEvent, render } from '@testing-library/react'
import Taro from '@tarojs/taro'
import { PetActor, petActionCapabilities } from '../../src/components/PetActor'
import { PET_MOTION_ACTIONS, petMotionAtlas } from '../../src/utils/pet-motion'
import { completePetCatalog } from '../../src/utils/pet-catalog'
import { ORIGINAL_COMPANION_SRC } from '../../src/utils/pet-companion-preference'

beforeEach(() => { jest.clearAllMocks(); (Taro.getStorageSync as jest.Mock).mockReturnValue('') })

test('each public character and the original companion has its own complete packaged action sheet', async () => {
  const catalog = completePetCatalog()
  expect(catalog.map(item => item.builtin_avatar_id)).toContain('jianwen-01')
  const sheets = [...catalog.map(item => petMotionAtlas(item)), petMotionAtlas(null, ORIGINAL_COMPANION_SRC)]
  expect(new Set(sheets).size).toBe(6)
  for (const src of sheets) {
    const file = resolve(__dirname, '../../src', src!.slice(1))
    const data = readFileSync(file)
    expect(data.readUInt32BE(16)).toBe(512)
    expect(data.readUInt32BE(20)).toBe(512)
    expect(data.length).toBeLessThan(230000)
    const decoded = await sharp(data).toColourspace('srgb').ensureAlpha().raw().toBuffer()
    for (let frame = 0; frame < 16; frame++) {
      const left = (frame % 4) * 128, top = Math.floor(frame / 4) * 128
      let foreground = 0
      let dirtyGutter = 0
      for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
        const alpha = decoded[((top + y) * 512 + left + x) * 4 + 3]
        if ((x < 12 || x >= 116 || y < 12 || y >= 116) && alpha !== 0) dirtyGutter++
        if (alpha >= 128) foreground++
      }
      expect(foreground).toBeGreaterThan(400)
      expect(dirtyGutter).toBe(0)
    }
  }
  for (const pet of catalog) expect(petActionCapabilities(pet)).toEqual(PET_MOTION_ACTIONS)
})

test('repairing a catalog keeps existing names/order and does not duplicate templates', () => {
  const supplied = [{ ...completePetCatalog()[0], name: '用户自己的模板名' }]
  const repaired = completePetCatalog(supplied)
  expect(repaired).toHaveLength(5)
  expect(repaired[0]).toBe(supplied[0])
  expect(supplied).toHaveLength(1)
  expect(completePetCatalog(repaired)).toEqual(repaired)
})

test('photo actions use only that photo atlas; changing characters replaces all active frames', () => {
  const pet = { id: 'photo-one', name: '一号', avatar_type: 'pixel_self' as const, pixel_avatar_url: 'one-idle.png', pixel_motion_version: 1, pixel_motion_atlas_url: 'one-motions.png' }
  const { container, rerender } = render(<PetActor pet={pet} followAppearance={false} action='ride' />)
  expect(container.querySelector('.pet-motion-atlas__sheet')).toHaveAttribute('src', 'one-motions.png')
  expect(container.querySelector('.pet-motion-atlas')).toHaveClass('pet-motion-atlas--ride')
  for (const action of PET_MOTION_ACTIONS.filter(action => action !== 'idle')) {
    rerender(<PetActor pet={pet} followAppearance={false} action={action} />)
    expect(container.querySelector('.pet-motion-atlas__sheet')).toHaveAttribute('src', 'one-motions.png')
  }
  rerender(<PetActor pet={{ ...pet, id: 'photo-two', pixel_motion_atlas_url: 'two-motions.png' }} followAppearance={false} action='walk' />)
  expect(container.querySelector('.pet-motion-atlas__sheet')).toHaveAttribute('src', 'two-motions.png')
  rerender(<PetActor pet={pet} followAppearance={false} action='ride' active={false} />)
  expect(container.querySelector('.pet-motion-atlas')).not.toBeInTheDocument()
  expect(container.querySelector('.pet-avatar__image')).toHaveAttribute('src', 'one-idle.png')
})

test('legacy photos and unknown overrides never borrow a template motion set', () => {
  expect(petMotionAtlas({ pixel_motion_atlas_url: 'unversioned.png' })).toBeUndefined()
  expect(petMotionAtlas({ builtin_avatar_id: 'huatuo-01' }, '/my-other-character.png')).toBeUndefined()
  const { container } = render(<PetActor pet={{ builtin_avatar_id: 'huatuo-01' }} spriteOverride='/my-other-character.png' action='walk' />)
  expect(container.querySelector('.pet-motion-atlas')).not.toBeInTheDocument()
  expect(container.querySelector('.pet-actor__sheet')).toHaveAttribute('src', '/my-other-character.png')
})

test('an unavailable photo atlas retains the same idle character and a replacement atlas can play', () => {
  const pet = { id: 'photo', avatar_type: 'pixel_self' as const, pixel_avatar_url: 'idle.png', pixel_motion_atlas_url: 'failed.png', pixel_motion_version: 1 }
  const { container, rerender } = render(<PetActor pet={pet} followAppearance={false} action='wave' />)
  fireEvent.error(container.querySelector('.pet-motion-atlas__sheet')!)
  expect(container.querySelector('.pet-motion-atlas')).not.toBeInTheDocument()
  expect(container.querySelector('.pet-avatar__image')).toHaveAttribute('src', 'idle.png')
  rerender(<PetActor pet={{ ...pet, pixel_motion_atlas_url: 'new-atlas.png' }} followAppearance={false} action='wave' />)
  expect(container.querySelector('.pet-motion-atlas__sheet')).toHaveAttribute('src', 'new-atlas.png')
})
