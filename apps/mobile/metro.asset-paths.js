/** Keep dependency asset resource names stable when a cache is on another drive. */
module.exports = function normalizeDependencyAssetPath(asset) {
  const location = asset.httpServerLocation || ''
  const dependency = location.indexOf('/node_modules/')
  if (/^\/assets\/[A-Za-z]:\//.test(location) && dependency >= 0) {
    return { ...asset, httpServerLocation: `/assets/../../node_modules/${location.slice(dependency + '/node_modules/'.length)}` }
  }
  return asset
}
