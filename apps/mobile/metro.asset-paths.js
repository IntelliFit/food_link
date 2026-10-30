/** Keep dependency asset resource names stable when a cache is on another drive. */
module.exports = function normalizeDependencyAssetPath(asset) {
  const location = asset.httpServerLocation || ''
  const url = new URL(location, 'http://metro.local')
  const unstablePath = url.searchParams.get('unstable_path')
  const assetPath = unstablePath ?? location.slice('/assets/'.length)
  const dependency = assetPath.indexOf('/node_modules/')
  if (!/^\.\/?[A-Za-z]:\//.test(assetPath) && !/^[A-Za-z]:\//.test(assetPath)) return asset
  if (dependency < 0 || !location.startsWith('/assets/')) return asset
  const relativePath = `../../node_modules/${assetPath.slice(dependency + '/node_modules/'.length)}`
  // Newer Expo uses an encoded unstable_path; older Metro uses the URL path.
  // Both must resolve through this checkout's node_modules link, not a drive
  // prefix treated as a relative filename on Windows.
  if (unstablePath !== null) {
    // Expo's asset transformer encodes this value after plugins run.
    // URLSearchParams serialization here would encode it twice.
    return { ...asset, httpServerLocation: location.replace(/([?&]unstable_path=)[^&]*/, (_, prefix) => prefix + relativePath) }
  }
  return { ...asset, httpServerLocation: `/assets/${relativePath}` }
}
