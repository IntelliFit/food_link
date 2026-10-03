const path = require('path')
const { getDefaultConfig } = require('expo/metro-config')

const projectRoot = __dirname

const config = getDefaultConfig(projectRoot)

// Resolve workspace code from this checkout even when dependency caches are shared.
// Otherwise a node_modules workspace symlink can bundle a different checkout's code.
const sharedEntries = {
  '@food-link/core': path.resolve(projectRoot, '../../packages/core/src/index.ts'),
  '@food-link/api-client': path.resolve(projectRoot, '../../packages/api-client/src/index.ts'),
}
config.resolver.resolveRequest = (context, moduleName, platform) => (
  context.resolveRequest(context, sharedEntries[moduleName] || moduleName, platform)
)
config.transformer.assetPlugins = [...(config.transformer.assetPlugins || []), require.resolve('./metro.asset-paths')]

module.exports = config
