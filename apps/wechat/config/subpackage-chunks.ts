import { posix } from 'path'
import type { Plugin } from 'vite'

/**
 * Taro's vite runner puts every node_modules file into the main `vendors.js` and every source file
 * with two or more importers into the main `common.js`, even when only one subpackage uses it.
 * These two plugins keep such modules in the subpackage that uses them (what webpack Taro calls
 * `optimizeMainPackage`) and load the styles of those subpackage chunks.
 */

type ModuleInfoLike = {
  importers: readonly string[]
  dynamicImporters: readonly string[]
}
type ManualChunkMeta = { getModuleInfo: (id: string) => ModuleInfoLike | null }
type ManualChunksFn = (id: string, meta: ManualChunkMeta) => string | null | void

const MAIN = 'main'
const SHARED_CHUNK_SUFFIX = '-subpackage-shared'

/**
 * `<root>/<root>-shared.js`. The basename must be unique per root: vite drops a style-only chunk and
 * blanks every `require("…/<its basename>");` in the bundle, so a shared basename would also blank
 * another root's real require (`const x=/* empty css *\/`, a syntax error that leaves the page blank).
 * It must also not be common/vendors/taro/runtime, whose wxss taro:vite-style links into app.wxss.
 */
export function sharedChunkFileName(root: string): string {
  return `${root}/${root}-shared.js`
}

function normalizeId(id: string): string {
  return id.replace(/^\0/, '').replace(/\\/g, '/').replace(/\?.*$/, '')
}

function createPackageResolver(roots: readonly string[]) {
  return (id: string): string => {
    const path = normalizeId(id)
    const root = roots.find((candidate) => path.includes(`/src/${candidate}/`))
    return root || MAIN
  }
}

/**
 * Returns the only subpackage whose pages reach `id`, or null when the main package (or more than one
 * package) reaches it. Walks importers up to the entries; stops early once a second package shows up.
 */
function createSingleSubpackageFinder(roots: readonly string[]) {
  const packageOf = createPackageResolver(roots)
  const cache = new Map<string, string | null>()

  const find = (id: string, getModuleInfo: ManualChunkMeta['getModuleInfo']): string | null => {
    if (cache.has(id)) return cache.get(id) ?? null
    const seen = new Set<string>([id])
    const queue = [id]
    let found: string | null = null
    let shared = false
    while (queue.length > 0 && !shared) {
      const current = queue.shift() as string
      const info = getModuleInfo(current)
      const parents = info ? [...info.importers, ...info.dynamicImporters] : []
      if (parents.length === 0) {
        // An entry: app.ts, a page, or a Taro template. Unknown modules count as main.
        const pkg = info ? packageOf(current) : MAIN
        if (pkg === MAIN || (found !== null && found !== pkg)) shared = true
        else found = pkg
        continue
      }
      for (const parent of parents) {
        if (!seen.has(parent)) {
          seen.add(parent)
          queue.push(parent)
        }
      }
    }
    const result = shared ? null : found
    cache.set(id, result)
    return result
  }

  return { find, reset: () => cache.clear() }
}

function forEachOutput(
  config: { build: { rollupOptions: { output?: unknown } } },
  apply: (output: Record<string, unknown>) => void,
) {
  const ro = config.build.rollupOptions
  const outs = ro.output
  const list = (Array.isArray(outs) ? outs : outs ? [outs] : []) as Record<string, unknown>[]
  if (list.length === 0) {
    const output: Record<string, unknown> = {}
    ro.output = output
    apply(output)
  } else {
    list.forEach((output) => output && typeof output === 'object' && apply(output))
  }
}

/**
 * Moves a module that Taro would put in the main `common`/`vendors` chunk into
 * `<root>/<root>-shared.js` when only pages of that one subpackage use it.
 *
 * Register it before the other manualChunks plugins: each plugin wraps the previous function, so the
 * explicit rules (echarts, lifespan, ...) still run first and this one only sees Taro's decision.
 */
export function subpackageSharedChunks(options: {
  roots: readonly string[]
  /** Subpackages that must not take more code, e.g. because they are close to the size budget. */
  exclude?: readonly string[]
}): Plugin {
  const exclude = new Set(options.exclude || [])
  const finder = createSingleSubpackageFinder(options.roots)
  const chunkRoot = new Map(options.roots.map((root) => [`${root}${SHARED_CHUNK_SUFFIX}`, root]))

  return {
    name: 'subpackage-shared-chunks',
    renderStart() {
      // Watch builds change the import graph between runs.
      finder.reset()
    },
    configResolved(config) {
      forEachOutput(config, (output) => {
        const prevManual = output.manualChunks as ManualChunksFn | undefined
        output.manualChunks = (id: string, meta: ManualChunkMeta) => {
          const decided = typeof prevManual === 'function' ? prevManual.call(output, id, meta) : undefined
          if (decided !== 'common' && decided !== 'vendors') return decided
          const root = finder.find(id, meta.getModuleInfo)
          if (!root || exclude.has(root)) return decided
          return `${root}${SHARED_CHUNK_SUFFIX}`
        }
        const prevNames = output.chunkFileNames
        output.chunkFileNames = (chunkInfo: { name: string }) => {
          const root = chunkRoot.get(chunkInfo.name)
          if (root) return sharedChunkFileName(root)
          if (typeof prevNames === 'function') return prevNames(chunkInfo)
          if (typeof prevNames === 'string') return prevNames
          return '[name]-[hash].js'
        }
      })
    },
  }
}

type BundleChunk = {
  type: 'chunk'
  fileName: string
  isEntry: boolean
  isImplicitEntry?: boolean
  imports: string[]
  viteMetadata?: { importedCss?: Set<string> }
}
type BundleAsset = { type: 'asset'; fileName: string; source: string | Uint8Array }

// Taro emits every page as an implicit entry (`implicitlyLoadedAfterOneOf` the app), not a plain entry.
const isPageChunk = (chunk: BundleChunk) => chunk.isEntry || Boolean(chunk.isImplicitEntry)

function rootOfFile(fileName: string, roots: readonly string[]): string | null {
  return roots.find((root) => fileName.startsWith(`${root}/`)) || null
}

function withImports(source: string, imports: string): string {
  // @import must come first; keep a leading @charset in front of it.
  const charset = source.match(/^@charset[^;]*;/)
  if (!charset) return `${imports}\n${source}`
  return `${charset[0]}${imports}\n${source.slice(charset[0].length)}`
}

/**
 * Taro only links the styles of its own common chunks (in app.wxss). A subpackage chunk's wxss is
 * written next to it and nothing loads it, so components in such a chunk would render unstyled.
 * This adds `@import` of that wxss to every page of the same subpackage that loads the chunk.
 *
 * `pageImports` adds runtime imports of main-package wxss to subpackage pages (keys and values are dist
 * paths without extension, e.g. `packageExtra/pages/x/index` -> `pages/community/index`). A subpackage
 * page may load main-package files, so it can reuse a main page's styles instead of compiling a copy.
 */
export function linkSubpackageChunkStyles(options: {
  roots: readonly string[]
  pageImports?: Readonly<Record<string, readonly string[]>>
  styleExt?: string
}): Plugin {
  const styleExt = options.styleExt || '.wxss'
  return {
    name: 'link-subpackage-chunk-styles',
    generateBundle: {
      // After taro:vite-style has given every css asset its final .wxss file name.
      order: 'post',
      handler(_opts, bundle) {
        const items = Object.values(bundle) as Array<BundleChunk | BundleAsset>
        const chunks = items.filter((item): item is BundleChunk => item.type === 'chunk')
        const assets = new Map(
          items.filter((item): item is BundleAsset => item.type === 'asset').map((asset) => [asset.fileName, asset]),
        )
        const chunkByFile = new Map(chunks.map((chunk) => [chunk.fileName, chunk]))
        const linksByPageStyle = new Map<string, string[]>()
        const addLinks = (pageStyle: string, styles: string[]) => {
          linksByPageStyle.set(pageStyle, [...(linksByPageStyle.get(pageStyle) || []), ...styles])
        }

        for (const [page, targets] of Object.entries(options.pageImports || {})) {
          const styles = targets.map((target) => `${target}${styleExt}`)
          const missing = [`${page}.js`, ...styles].filter((file) => !chunkByFile.has(file) && !assets.has(file))
          if (missing.length > 0) this.error(`link-subpackage-chunk-styles: ${missing.join(', ')} not in the bundle`)
          addLinks(`${page}${styleExt}`, styles)
        }

        const stylesOfChunk = new Map<string, string[]>()
        for (const chunk of chunks) {
          if (isPageChunk(chunk) || !rootOfFile(chunk.fileName, options.roots)) continue
          const styles = [...(chunk.viteMetadata?.importedCss || [])]
            .map((key) => (bundle[key] as BundleAsset | undefined)?.fileName)
            .filter((fileName): fileName is string => Boolean(fileName && fileName.endsWith(styleExt)))
          if (styles.length > 0) stylesOfChunk.set(chunk.fileName, styles)
        }

        for (const page of chunks) {
          const root = isPageChunk(page) ? rootOfFile(page.fileName, options.roots) : null
          if (!root) continue
          const pageStyle = page.fileName.replace(/\.js$/, styleExt)
          // A chunk with only styles has no code: vite deletes it and hands its css to the importing
          // pages' importedCss, where taro:vite-style already named it after that chunk.
          const links = [...(page.viteMetadata?.importedCss || [])]
            .map((key) => (bundle[key] as BundleAsset | undefined)?.fileName)
            .filter((fileName): fileName is string =>
              Boolean(fileName && fileName !== pageStyle && fileName.endsWith(styleExt) && rootOfFile(fileName, options.roots) === root),
            )
          const seen = new Set<string>()
          const queue = [...page.imports]
          while (queue.length > 0) {
            const fileName = queue.shift() as string
            if (seen.has(fileName)) continue
            seen.add(fileName)
            if (rootOfFile(fileName, options.roots) === root) links.push(...(stylesOfChunk.get(fileName) || []))
            queue.push(...(chunkByFile.get(fileName)?.imports || []))
          }
          if (links.length > 0) addLinks(pageStyle, [...new Set(links)])
        }

        for (const [pageStyle, links] of linksByPageStyle) {
          const imports = links
            .map((style) => `@import "${posix.relative(posix.dirname(pageStyle), style)}";`)
            .join('\n')
          const asset = assets.get(pageStyle)
          if (asset) {
            const source = typeof asset.source === 'string' ? asset.source : new TextDecoder().decode(asset.source)
            asset.source = withImports(source, imports)
          } else {
            this.emitFile({ type: 'asset', fileName: pageStyle, source: `${imports}\n` })
          }
        }
      },
    },
  }
}

// vite blanks the require of a dropped style-only chunk as `/* empty css … */`. That is only safe as a
// statement of its own; after `=`, `,`, `(`, `:`, `?` or `[` it broke a real expression.
const BLANKED_REQUIRE_IN_EXPRESSION = /[=,(:?[]\s*\/\* empty css/

/**
 * Fails the build when vite's style-only-chunk cleanup blanked a require that a chunk uses, which ships as
 * a syntax error and a blank page (2026-11-06: two roots' shared chunks had the same basename).
 */
export function failOnBlankedRequires(): Plugin {
  return {
    name: 'fail-on-blanked-requires',
    generateBundle: {
      // After vite:css-post has removed style-only chunks and blanked their requires.
      order: 'post',
      handler(_opts, bundle) {
        const broken = (Object.values(bundle) as Array<OutputChunkLike | BundleAsset>)
          .filter((item): item is OutputChunkLike => item.type === 'chunk')
          .filter((chunk) => BLANKED_REQUIRE_IN_EXPRESSION.test(chunk.code))
          .map((chunk) => chunk.fileName)
        if (broken.length > 0) {
          this.error(`fail-on-blanked-requires: a used require was blanked as "empty css" in ${broken.join(', ')}`)
        }
      },
    },
  }
}

type OutputChunkLike = { type: 'chunk'; fileName: string; code: string }
