export const annotationLabelOptions = [
  ['rankable', '可用'],
  ['snack', '零食'],
  ['fruit', '水果'],
  ['takeout', '外卖'],
  ['home_cooked', '家常菜'],
  ['restaurant', '堂食'],
  ['beverage', '饮品'],
] as const

export type AnnotationLabel = (typeof annotationLabelOptions)[number][0]

export function recognizedLabelOptions<T extends string>(
  labels: readonly T[],
  options: ReadonlyArray<readonly [T, string]>,
): Array<readonly [T, string]> {
  const recognized = new Set(labels)
  return options.filter(([value]) => recognized.has(value))
}
