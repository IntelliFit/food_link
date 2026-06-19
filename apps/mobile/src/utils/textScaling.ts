import { Text, TextInput } from 'react-native'

const TEXT_MAX_FONT_SIZE_MULTIPLIER = 1

type ScalableComponent = {
  defaultProps?: Record<string, unknown>
}

export function configureTextScaling() {
  const text = Text as unknown as ScalableComponent
  text.defaultProps = {
    ...text.defaultProps,
    allowFontScaling: false,
    maxFontSizeMultiplier: TEXT_MAX_FONT_SIZE_MULTIPLIER,
  }

  const textInput = TextInput as unknown as ScalableComponent
  textInput.defaultProps = {
    ...textInput.defaultProps,
    allowFontScaling: false,
    maxFontSizeMultiplier: TEXT_MAX_FONT_SIZE_MULTIPLIER,
  }
}
