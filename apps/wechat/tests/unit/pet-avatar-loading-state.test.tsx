import { render, screen } from '@testing-library/react'
import { PetAvatar } from '../../src/components/PetAvatar'

describe('pet avatar loading state', () => {
  it('does not render a deleted fallback appearance before the current pet loads', () => {
    const { rerender } = render(<PetAvatar size={67} />)

    expect(screen.queryByRole('img')).not.toBeInTheDocument()

    rerender(
      <PetAvatar
        pet={{
          name: '华佗',
          avatar_type: 'builtin_person',
          builtin_avatar_id: 'huatuo-01',
        } as any}
        size={67}
      />,
    )

    expect(screen.getByLabelText(/华佗/)).toBeInTheDocument()
  })

  it.each([
    [{ name: '旧伙伴', pet_seed: 'old-seed' }, 'jianwen-01-idle.png'],
    [{ name: '旧伙伴', pet_seed: 'builtin:huatuo-01' }, 'huatuo-01.png'],
    [{ name: '旧伙伴', builtin_avatar_id: 'retired-id' }, 'jianwen-01-idle.png'],
    [{ name: '小麦', builtin_avatar_id: 'xiaomai-01' }, 'xiaomai-01.png'],
  ])('automatically displays a current image for %j', (pet, filename) => {
    const { container } = render(<PetAvatar pet={pet} />)
    const idle = container.querySelector('.pet-avatar__frame--idle')
    expect(idle).toHaveAttribute('src', `/assets/pets/${filename}`)
    expect(container.innerHTML).not.toContain('data:image/svg')
  })

  it('preserves the photo avatar and its animation frames', () => {
    const { container } = render(
      <PetAvatar
        pet={{
          name: '牛来', avatar_type: 'pixel_self', builtin_avatar_id: 'jianwen-01',
          pixel_avatar_url: 'https://example.test/custom.png',
          pixel_avatar_jump_url: 'https://example.test/jump.png',
          pixel_avatar_squash_url: 'https://example.test/squash.png',
        }}
      />,
    )
    expect(container.querySelector('.pet-avatar__frame--idle')).toHaveAttribute('src', 'https://example.test/custom.png')
    expect(container.querySelector('.pet-avatar__frame--jump')).toHaveAttribute('src', 'https://example.test/jump.png')
    expect(container.querySelector('.pet-avatar__frame--squash')).toHaveAttribute('src', 'https://example.test/squash.png')
  })
})
