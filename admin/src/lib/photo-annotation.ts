export function recognizedLabelOptions<T extends string>(
  labels: readonly T[],
  options: ReadonlyArray<readonly [T, string]>,
): Array<readonly [T, string]> {
  const recognized = new Set(labels)
  return options.filter(([value]) => recognized.has(value))
}
