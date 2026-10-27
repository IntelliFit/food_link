import assert from 'node:assert/strict'
import { chmod, copyFile, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import test from 'node:test'

const helper = path.resolve('scripts/export-staged-snapshot.sh')
const isolatedGitEnv = { ...process.env }
for (const name of execFileSync('git', ['rev-parse', '--local-env-vars'], { encoding: 'utf8' }).trim().split(/\r?\n/)) {
  delete isolatedGitEnv[name]
}

test('runs the staged exporter and ignores unstaged helper and file content', async () => {
  const repo = await mkdtemp(path.join(tmpdir(), 'foodlink-staged-repo-'))
  const snapshot = await mkdtemp(path.join(tmpdir(), 'foodlink-staged-snapshot-'))
  const gitOptions = { cwd: repo, env: isolatedGitEnv }
  execFileSync('git', ['init', '-q'], gitOptions)
  await mkdir(path.join(repo, 'scripts'))
  await copyFile(helper, path.join(repo, 'scripts/export-staged-snapshot.sh'))
  await chmod(path.join(repo, 'scripts/export-staged-snapshot.sh'), 0o755)
  await writeFile(path.join(repo, 'example.txt'), 'staged\n')
  execFileSync('git', ['add', 'example.txt', 'scripts/export-staged-snapshot.sh'], gitOptions)
  await writeFile(path.join(repo, 'example.txt'), 'unstaged\n')
  await writeFile(path.join(repo, 'scripts/export-staged-snapshot.sh'), '#!/bin/sh\ncp example.txt "$1/example.txt"\n')

  const stagedExporter = execFileSync('git', ['show', ':scripts/export-staged-snapshot.sh'], gitOptions)
  execFileSync('sh', ['-s', '--', snapshot], { ...gitOptions, input: stagedExporter })

  assert.match(await readFile(path.join(snapshot, 'example.txt'), 'utf8'), /^staged\r?\n$/)
})
