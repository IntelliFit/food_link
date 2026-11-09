import {
  failOnBlankedRequires,
  linkSubpackageChunkStyles,
  sharedChunkFileName,
  subpackageSharedChunks,
} from '../../config/subpackage-chunks'

const ROOTS = ['packageA', 'packageB', 'packageExtra']
const SRC = 'D:/app/src'
const page = (path: string) => `\0${SRC}/${path}?page-loader=true`

type Graph = Record<string, string[]>

function manualChunksFor(graph: Graph, prevDecision: (id: string) => string | undefined) {
  const output: Record<string, unknown> = {
    manualChunks: (id: string) => prevDecision(id),
    chunkFileNames: '[name].js',
  }
  const plugin = subpackageSharedChunks({ roots: ROOTS, exclude: ['packageExtra'] }) as any
  plugin.configResolved({ build: { rollupOptions: { output } } })
  const meta = {
    getModuleInfo: (id: string) => (id in graph ? { importers: graph[id], dynamicImporters: [] } : null),
  }
  return {
    chunkOf: (id: string) => (output.manualChunks as (id: string, meta: unknown) => unknown)(id, meta),
    fileNameOf: (name: string) => (output.chunkFileNames as (info: { name: string }) => string)({ name }),
  }
}

describe('subpackageSharedChunks', () => {
  const graph: Graph = {
    [page('packageA/pages/x/index.tsx')]: [],
    [page('packageA/pages/y/index.tsx')]: [],
    [page('packageB/pages/z/index.tsx')]: [],
    [page('packageExtra/pages/e/index.tsx')]: [],
    [page('packageExtra/pages/f/index.tsx')]: [],
    [page('pages/index/index.tsx')]: [],
    [`${SRC}/packageA/pages/x/index.tsx`]: [page('packageA/pages/x/index.tsx')],
    [`${SRC}/packageA/pages/y/index.tsx`]: [page('packageA/pages/y/index.tsx')],
    [`${SRC}/components/OnlyA.tsx`]: [`${SRC}/packageA/pages/x/index.tsx`, `${SRC}/packageA/pages/y/index.tsx`],
    [`${SRC}/components/OnlyA.scss`]: [`${SRC}/components/OnlyA.tsx`],
    [`${SRC}/components/AAndMain.tsx`]: [`${SRC}/packageA/pages/x/index.tsx`, page('pages/index/index.tsx')],
    [`${SRC}/components/AAndB.tsx`]: [`${SRC}/packageA/pages/y/index.tsx`, page('packageB/pages/z/index.tsx')],
    [`${SRC}/components/OnlyExtra.tsx`]: [page('packageExtra/pages/e/index.tsx'), page('packageExtra/pages/f/index.tsx')],
    ['D:/app/node_modules/lib/index.js']: [page('packageB/pages/z/index.tsx')],
    ['D:/app/node_modules/react/index.js']: [page('packageB/pages/z/index.tsx')],
  }
  const taroDecision = (id: string) => {
    if (id.includes('/react/')) return 'taro'
    if (id.includes('node_modules')) return 'vendors'
    return (graph[id] || []).length > 1 ? 'common' : undefined
  }

  it('moves modules that only one subpackage reaches into that subpackage', () => {
    const { chunkOf, fileNameOf } = manualChunksFor(graph, taroDecision)
    expect(chunkOf(`${SRC}/components/OnlyA.tsx`)).toBe('packageA-subpackage-shared')
    expect(chunkOf('D:/app/node_modules/lib/index.js')).toBe('packageB-subpackage-shared')
    expect(fileNameOf('packageA-subpackage-shared')).toBe('packageA/packageA-shared.js')
    expect(fileNameOf('packageB-subpackage-shared')).toBe('packageB/packageB-shared.js')
    expect(fileNameOf('common')).toBe('[name].js')
  })

  it('keeps modules shared with the main package or another subpackage where Taro put them', () => {
    const { chunkOf } = manualChunksFor(graph, taroDecision)
    expect(chunkOf(`${SRC}/components/AAndMain.tsx`)).toBe('common')
    expect(chunkOf(`${SRC}/components/AAndB.tsx`)).toBe('common')
    expect(chunkOf('D:/app/node_modules/react/index.js')).toBe('taro')
    expect(chunkOf(`${SRC}/components/OnlyA.scss`)).toBeUndefined()
  })

  it('leaves excluded subpackages alone and treats unknown modules as main', () => {
    const { chunkOf } = manualChunksFor(graph, taroDecision)
    expect(chunkOf(`${SRC}/components/OnlyExtra.tsx`)).toBe('common')
    const unknown = manualChunksFor({ [`${SRC}/x.ts`]: ['missing'] }, () => 'common')
    expect(unknown.chunkOf(`${SRC}/x.ts`)).toBe('common')
  })
})

describe('linkSubpackageChunkStyles', () => {
  function run(bundle: Record<string, any>, pageImports?: Record<string, string[]>) {
    const plugin = linkSubpackageChunkStyles({ roots: ROOTS, pageImports }) as any
    const emitted: Array<{ fileName: string; source: string }> = []
    const context = {
      emitFile: (file: { fileName: string; source: string }) => emitted.push(file),
      error: (message: string) => {
        throw new Error(message)
      },
    }
    plugin.generateBundle.handler.call(context, {}, bundle)
    return emitted
  }
  // Taro pages are implicit entries (emitted with implicitlyLoadedAfterOneOf the app)
  const chunk = (fileName: string, isPage: boolean, imports: string[], css: string[]) => ({
    type: 'chunk',
    fileName,
    isEntry: false,
    isImplicitEntry: isPage,
    imports,
    viteMetadata: { importedCss: new Set(css) },
  })
  const asset = (fileName: string, source: string) => ({ type: 'asset', fileName, source })

  function sampleBundle() {
    return {
      'packageA/pages/x/index.js': chunk('packageA/pages/x/index.js', true, ['packageA/packageA-shared.js', 'common.js'], ['x.css']),
      'packageA/pages/y/index.js': chunk('packageA/pages/y/index.js', true, ['common.js'], ['pure.css']),
      'packageB/pages/z/index.js': chunk('packageB/pages/z/index.js', true, ['common.js'], ['z.css']),
      'packageA/packageA-shared.js': chunk('packageA/packageA-shared.js', false, ['common.js'], ['shared.css']),
      'common.js': chunk('common.js', false, [], ['common.css']),
      'x.css': asset('packageA/pages/x/index.wxss', '@charset "UTF-8";.x{color:red}'),
      'pure.css': asset('packageA/pure.wxss', '.pure{}'),
      'shared.css': asset('packageA/packageA-shared.wxss', '.shared{}'),
      'z.css': asset('packageB/pages/z/index.wxss', '.z{}'),
      'common.css': asset('common.wxss', '.common{}'),
      'main.css': asset('pages/community/index.wxss', '.feed{}'),
    }
  }

  it('imports subpackage chunk styles into the pages that load them', () => {
    const bundle = sampleBundle()
    const emitted = run(bundle)
    expect(bundle['x.css'].source).toBe('@charset "UTF-8";@import "../../packageA-shared.wxss";\n.x{color:red}')
    expect(emitted).toEqual([{ type: 'asset', fileName: 'packageA/pages/y/index.wxss', source: '@import "../../pure.wxss";\n' }])
    expect(bundle['z.css'].source).toBe('.z{}')
    expect(bundle['common.css'].source).toBe('.common{}')
  })

  it('adds configured main-package style imports and fails on unknown files', () => {
    const bundle = sampleBundle()
    run(bundle, { 'packageB/pages/z/index': ['pages/community/index'] })
    expect(bundle['z.css'].source).toBe('@import "../../../pages/community/index.wxss";\n.z{}')
    expect(() => run(sampleBundle(), { 'packageB/pages/z/index': ['pages/missing/index'] })).toThrow('pages/missing/index.wxss')
  })
})

describe('shared chunk file names', () => {
  it('gives every root its own basename, none that Taro links into app.wxss', () => {
    const names = ['packageMeal', 'packageStats', 'packageFoodLibraryShare'].map((root) => sharedChunkFileName(root))
    const basenames = names.map((name) => name.split('/').pop())
    expect(new Set(basenames).size).toBe(names.length)
    for (const base of basenames) expect(['common.js', 'vendors.js', 'taro.js', 'runtime.js']).not.toContain(base)
  })
})

describe('failOnBlankedRequires', () => {
  const run = (code: string) => {
    const plugin = failOnBlankedRequires() as any
    const context = { error: (message: string) => { throw new Error(message) } }
    plugin.generateBundle.handler.call(context, {}, { 'packageStats/pages/stats/index.js': { type: 'chunk', fileName: 'packageStats/pages/stats/index.js', code } })
  }

  it('fails when vite blanked a require whose value is used', () => {
    // 2026-11-06: packageMeal's style-only chunk shared the basename and took packageStats' require with it
    expect(() => run('"use strict";const a=require("../../../taro.js"),s=/* empty css                 */const K=1;')).toThrow('packageStats/pages/stats/index.js')
  })

  it('accepts a blanked require that was a statement of its own', () => {
    expect(() => run('"use strict";const a=require("../../../taro.js");/* empty css                 */const K=1;')).not.toThrow()
  })
})
