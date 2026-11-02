import { act, renderHook } from '@testing-library/react'

const mockState = {
  snapshot: { variant: 'control', tracked: false, ready: false },
  listeners: new Set<() => void>(),
  exposed: [] as string[],
}

jest.mock('../../src/utils/experiments', () => ({
  experiments: {
    get: (_key: string, fallback: string) => (
      mockState.snapshot.ready ? mockState.snapshot : { ...mockState.snapshot, variant: fallback }
    ),
    subscribe: (listener: () => void) => {
      mockState.listeners.add(listener)
      return () => mockState.listeners.delete(listener)
    },
    expose: (key: string) => { mockState.exposed.push(key) },
  },
}))

import { useExperiment } from '../../src/hooks/useExperiment'

function publish(snapshot: typeof mockState.snapshot) {
  mockState.snapshot = snapshot
  act(() => mockState.listeners.forEach((listener) => listener()))
}

describe('useExperiment', () => {
  beforeEach(() => {
    mockState.snapshot = { variant: 'control', tracked: false, ready: false }
    mockState.listeners.clear()
    mockState.exposed = []
  })

  it('renders the control first, then the assigned variant, and exposes once ready', () => {
    const { result } = renderHook(() => useExperiment('onboarding_v2', 'control'))
    expect(result.current).toEqual({ variant: 'control', tracked: false, ready: false })
    expect(mockState.exposed).toEqual([])

    publish({ variant: 'pet_flow', tracked: true, ready: true })
    expect(result.current.variant).toBe('pet_flow')
    expect(mockState.exposed).toEqual(['onboarding_v2'])
  })

  it('does not expose untracked users or when exposure is turned off', () => {
    renderHook(() => useExperiment('onboarding_v2', 'control'))
    publish({ variant: 'control', tracked: false, ready: true })
    renderHook(() => useExperiment('onboarding_v2', 'control', { expose: false }))
    publish({ variant: 'pet_flow', tracked: true, ready: true })
    expect(mockState.exposed).toEqual(['onboarding_v2'])
  })
})
