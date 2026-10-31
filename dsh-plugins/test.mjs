// Runs the logic tests, then the smoke tests against the built lib/ with tiny
// stand-ins for the two DeepSeek helpers, in a temp copy (so the stubs never
// shadow the real packages). Run: node build.mjs && node test.mjs
import { spawnSync } from 'node:child_process'
import { cp, mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(import.meta.url))
const run = (args, cwd) => {
  const r = spawnSync(process.execPath, ['--test', ...args], { cwd, stdio: 'inherit' })
  if (r.status !== 0) process.exit(r.status ?? 1)
}
run(['verdent-report/tests/core.test.ts', 'model-fallback/tests/core.test.ts'], root)

const tmp = await mkdtemp(join(tmpdir(), 'dsh-plugins-'))
for (const p of ['verdent-report', 'model-fallback', 'tests']) await cp(join(root, p), join(tmp, p), { recursive: true })
const stubs = {
  'dsh-tools': 'export const defineTool = t => t\n',
  'dsh-llm': 'export const createUserMessage = m => ({ ...m, role: "user" })\n',
}
for (const [name, code] of Object.entries(stubs)) {
  const dir = join(tmp, 'node_modules', '@deepseek-ai', name)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'package.json'), JSON.stringify({ name: `@deepseek-ai/${name}`, type: 'module', main: 'index.js' }))
  await writeFile(join(dir, 'index.js'), code)
}
await cp(join(root, 'tests', 'smoke.test.ts'), join(tmp, 'smoke.test.ts'))
run(['smoke.test.ts'], tmp)
