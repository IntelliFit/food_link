import { fireEvent, render, screen } from '@testing-library/react'
import { MicrosSection } from '../../src/pages/index/components/MicrosSection'
import { TargetEditor } from '../../src/pages/index/components/TargetEditor'
import { DEFAULT_INTAKE } from '../../src/pages/index/utils/constants'
import {
  ALL_HOME_MICRONUTRIENT_KEYS,
  getMicronutrientPreferenceStorageKey,
  getVisibleMicronutrientKeys,
  normalizeHiddenMicronutrientKeys,
} from '../../src/pages/index/utils/micronutrientPreferences'
import { type TargetFormState } from '../../src/pages/index/types'

const TARGET_FORM: TargetFormState = {
  calorieTarget: '2000',
  proteinTarget: '100',
  carbsTarget: '250',
  fatTarget: '67',
  fiberTarget: '25',
  sugarTarget: '50',
  saturatedFatTarget: '20',
  cholesterolMgTarget: '300',
  sodiumMgTarget: '2000',
  potassiumMgTarget: '2000',
  calciumMgTarget: '800',
  ironMgTarget: '12',
  magnesiumMgTarget: '330',
  zincMgTarget: '10',
  vitaminARaeMcgTarget: '700',
  vitaminCMgTarget: '100',
  vitaminDMcgTarget: '10',
  vitaminEMgTarget: '14',
  vitaminKMcgTarget: '80',
  thiaminMgTarget: '1.2',
  riboflavinMgTarget: '1.2',
  niacinMgTarget: '15',
  vitaminB6MgTarget: '1.4',
  folateMcgTarget: '400',
  vitaminB12McgTarget: '2.4',
}

describe('micronutrient display preferences', () => {
  it('normalizes stored keys, removes unknown values, and preserves canonical order', () => {
    expect(normalizeHiddenMicronutrientKeys(['ironMg', 'unknown', 'fiber', 'ironMg'])).toEqual([
      'fiber',
      'ironMg',
    ])
    expect(normalizeHiddenMicronutrientKeys('["zincMg","calciumMg"]')).toEqual([
      'calciumMg',
      'zincMg',
    ])
    expect(normalizeHiddenMicronutrientKeys('not-json')).toEqual([])
  })

  it('keeps preferences isolated per user and defaults new nutrients to visible', () => {
    expect(getMicronutrientPreferenceStorageKey(' user-1 ')).toBe('home_hidden_micronutrients_v1:user-1')
    expect(getMicronutrientPreferenceStorageKey('')).toBe('home_hidden_micronutrients_v1:guest')
    expect(getVisibleMicronutrientKeys(['fiber'])).toEqual(
      ALL_HOME_MICRONUTRIENT_KEYS.filter((key) => key !== 'fiber')
    )
  })

  it('filters the dashboard cards and exposes the shared manage entry', () => {
    const onManage = jest.fn()
    const hiddenKeys = ALL_HOME_MICRONUTRIENT_KEYS.filter((key) => key !== 'calciumMg')
    const { container } = render(
      <MicrosSection
        intakeData={DEFAULT_INTAKE}
        dashboardBusy={false}
        isGuest={false}
        hiddenMicronutrientKeys={hiddenKeys}
        onManageMicronutrients={onManage}
      />
    )

    expect(container.querySelectorAll('.micros-preview-card')).toHaveLength(1)
    expect(screen.getByText('钙')).toBeInTheDocument()
    fireEvent.click(screen.getByText('管理'))
    expect(onManage).toHaveBeenCalledTimes(1)
  })

  it('removes hidden targets from the editor and lets users add them back', () => {
    const onToggle = jest.fn()
    const { container } = render(
      <TargetEditor
        visible
        targetForm={TARGET_FORM}
        saving={false}
        hiddenMicronutrientKeys={['ironMg']}
        onToggleMicronutrientVisibility={onToggle}
        onTargetFieldChange={jest.fn()}
        onSave={jest.fn()}
        onClose={jest.fn()}
      />
    )

    const visibleLabels = Array.from(container.querySelectorAll('.target-form-item--micro .target-form-label'))
      .map((node) => node.textContent)
    expect(visibleLabels).not.toContain('铁')
    expect(screen.getByText('20/21')).toBeInTheDocument()

    const ironChip = Array.from(container.querySelectorAll('.target-hidden-micro-chip'))
      .find((node) => node.textContent?.includes('铁'))
    expect(ironChip).toBeTruthy()
    fireEvent.click(ironChip as Element)
    expect(onToggle).toHaveBeenCalledWith('ironMg')
  })
})
