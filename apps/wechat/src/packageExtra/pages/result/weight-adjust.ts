// 调整重量只改变份量，不改变每克的能量密度：热量按比例缩放。
// 标签或营养库的热量不一定等于三大营养素按 4/4/9 折算的值，
// 若改用 4/4/9 重算，点一下“+ / −”热量就会跳变（与编辑框路径也不一致）。
export function scaleCaloriesForWeight(
  currentCalories: number,
  weightScale: number,
  macroCalories: number,
): number {
  if (Number.isFinite(currentCalories) && currentCalories > 0 && Number.isFinite(weightScale) && weightScale > 0) {
    return currentCalories * weightScale
  }
  // 原热量缺失时才退回三大营养素折算。
  return macroCalories
}
