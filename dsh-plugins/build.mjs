// Build lib/*.js from src/*.ts with Node's built-in type stripper (Node >= 22.13).
// No dependencies. Run: node build.mjs
import { stripTypeScriptTypes } from 'node:module'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(import.meta.url))
for (const pkg of ['verdent-report', 'model-fallback']) {
  const src = join(root, pkg, 'src')
  const lib = join(root, pkg, 'lib')
  await mkdir(lib, { recursive: true })
  for (const file of (await readdir(src)).filter(f => f.endsWith('.ts'))) {
    const code = stripTypeScriptTypes(await readFile(join(src, file), 'utf8'), { mode: 'strip' })
      .replace(/(from\s+['"]\.\/[^'"]+)\.ts(['"])/g, '$1.js$2')
    await writeFile(join(lib, file.replace(/\.ts$/, '.js')), `// Generated from src/${file} by build.mjs. Do not edit.\n${code}`)
  }
  console.log(`built ${pkg}/lib`)
}
