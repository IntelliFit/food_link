import * as React from 'react'

let sequence = 0
/** A hidden tab's artwork must never change another page's recovery state. */
export const ThemeSceneScope = React.createContext<string | undefined>(undefined)
export function useThemeSceneScope(): string {
  const pageScope = React.useContext(ThemeSceneScope)
  const [fallback] = React.useState(() => `scene-owner-${++sequence}`)
  return pageScope || fallback
}
