import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chainFor, onFailure, onSafePoint, parseConfig, parseRef, shouldSwitch } from '../src/core.ts'

const pro = { provider: 'deepseek', model: 'deepseek-v4-pro' }
const flash = { provider: 'deepseek', model: 'deepseek-flash' }

test('parseRef', () => {
  assert.deepEqual(parseRef('deepseek-flash', 'x'), { model: 'deepseek-flash' })
  assert.deepEqual(parseRef('openrouter/qwen/qwen3', 'x'), { provider: 'openrouter', model: 'qwen/qwen3' })
  assert.throws(() => parseRef(5, 'chains.a[0]'), /chains\.a\[0\] must be a text model id/)
  assert.throws(() => parseRef('  ', 'x'), /empty/)
})

test('config validation', () => {
  assert.throws(() => parseConfig({} as never), /chains is required/)
  assert.throws(() => parseConfig({ chains: { a: [] } }), /at least one/)
  assert.throws(() => parseConfig({ chains: { a: ['b', 'b'] } }), /twice/)
  assert.throws(() => parseConfig({ chains: { a: ['a'] } }), /itself/)
  assert.throws(() => parseConfig({ chains: { 'deepseek/deepseek-v4-pro': ['deepseek-v4-pro'] } }), /itself/)
  assert.throws(() => parseConfig({ chains: { a: ['deepseek/b', 'b'] } }), /twice/)
  assert.throws(() => parseConfig({ chains: { a: ['b'] }, codes: 'SERVER' as never }), /codes must be a list/)
  assert.throws(() => parseConfig({ chains: { a: ['b'] }, cooldownMs: -1 }), /cooldownMs/)
  const p = parseConfig({ chains: { 'deepseek-v4-pro': ['deepseek-flash'] } })
  assert.ok(shouldSwitch(p, 'RATE_LIMIT'))
  assert.ok(!shouldSwitch(p, 'AUTH'))
  assert.equal(p.cooldownMs, 300_000)
  assert.ok(shouldSwitch(parseConfig({ chains: { a: ['b'] }, codes: [] }), 'ANYTHING'))
})

test('chain lookup prefers provider/model', () => {
  const p = parseConfig({ chains: { 'deepseek/deepseek-v4-pro': ['x'], 'deepseek-v4-pro': ['y'] } })
  assert.equal(chainFor(p, pro)![0]!.model, 'x')
  assert.equal(chainFor(p, { provider: 'other', model: 'deepseek-v4-pro' })![0]!.model, 'y')
})

test('onFailure walks the chain, then stops; ignores non-listed codes', () => {
  const p = parseConfig({ chains: { 'deepseek-v4-pro': ['deepseek-flash', 'openrouter/qwen3'] } })
  assert.equal(onFailure(p, undefined, pro, 'AUTH', 0).kind, 'none')
  const d1 = onFailure(p, undefined, pro, 'SERVER', 0)
  assert.equal(d1.kind, 'select')
  if (d1.kind !== 'select') return
  assert.deepEqual(d1.selection, flash)
  const d2 = onFailure(p, d1.state, flash, 'SERVER', 1)
  assert.equal(d2.kind, 'select')
  if (d2.kind !== 'select') return
  assert.deepEqual(d2.selection, { provider: 'openrouter', model: 'qwen3' })
  const d3 = onFailure(p, d2.state, d2.selection, 'SERVER', 2)
  assert.equal(d3.kind, 'exhausted')
  if (d3.kind !== 'exhausted') return
  assert.equal(onFailure(p, d3.state, d2.selection, 'SERVER', 3).kind, 'none', 'no switching after exhaustion')
})

test('a user model change resets the chain', () => {
  const p = parseConfig({ chains: { 'deepseek-v4-pro': ['deepseek-flash'], 'deepseek-flash': ['deepseek-v4-pro'] } })
  const d1 = onFailure(p, undefined, pro, 'SERVER', 0)
  if (d1.kind !== 'select') throw new Error('expected select')
  const other = { provider: 'deepseek', model: 'other' }
  assert.equal(onFailure(p, d1.state, other, 'SERVER', 1).kind, 'none', 'model not in any chain')
  assert.equal(onSafePoint(p, d1.state, other, 1).kind, 'forget')
})

test('onSafePoint restores after the cooldown only', () => {
  const p = parseConfig({ chains: { 'deepseek-v4-pro': ['deepseek-flash'] }, cooldownMs: 1000 })
  const d = onFailure(p, undefined, pro, 'SERVER', 0)
  if (d.kind !== 'select') throw new Error('expected select')
  assert.equal(onSafePoint(p, d.state, flash, 5000).kind, 'keep', 'never used yet: no restore')
  const used = { ...d.state, used: true, since: 0 }
  assert.equal(onSafePoint(p, used, flash, 999).kind, 'keep')
  assert.deepEqual(onSafePoint(p, used, flash, 1000), { kind: 'restore', selection: pro })
  assert.equal(onSafePoint(p, used, undefined, 5000).kind, 'keep', 'unknown current selection keeps state')
})
