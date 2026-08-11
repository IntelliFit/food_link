import { readFileSync } from 'fs'
import { join } from 'path'

describe('pet home chat guide', () => {
  const pageSource = readFileSync(
    join(process.cwd(), 'src/packageExtra/pages/pet-home/index.tsx'),
    'utf8',
  )
  const pageScss = readFileSync(
    join(process.cwd(), 'src/packageExtra/pages/pet-home/index.scss'),
    'utf8',
  )
  const apiSource = readFileSync(
    join(process.cwd(), 'src/utils/api.ts'),
    'utf8',
  )

  it('makes the pet name area an explicit chat entry', () => {
    expect(pageSource).toContain("className='pet-home-name-link' onClick={openPetChat}")
    expect(pageSource).toContain("className='pet-home-chat-guide-text'>进入对话</Text>")
    expect(pageSource).toContain("extraPkgUrl('/pages/pet-chat/index')")
  })

  it('visually groups the guide with the pet name', () => {
    expect(pageScss).toMatch(
      /\.pet-home-name-link\s*\{[\s\S]*?flex-direction:\s*column/,
    )
    expect(pageScss).toContain('.pet-home-chat-guide-text')
  })

  it('removes the random appearance action from the mini program', () => {
    expect(pageSource).not.toContain('随机换外观')
    expect(pageSource).not.toContain('rerollPetAppearance')
    expect(apiSource).not.toContain("'/api/pet/reroll-appearance'")
  })
})
