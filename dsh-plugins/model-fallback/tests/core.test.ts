import { test } from 'node:test'
import assert from 'node:assert/strict'
import { advance, chainFor, parseConfig, parseRef, resolve, shouldSwitch } from '../src/core.ts'

test('parseRef', () => {
  assert.deepEqual(parseRef('deepseek-flash'), { model: 'deepseek-flash' })
  assert.deepEqual(parseRef('openrouter/qwen/qwen3'), { provider: 'openrouter', model: 'qwen/qwen3' })
  assert.deepEqual(parseRef('/x'), { model: '/x' })
  assert.throws(() => parseRef('  '), /empty/)
})

test('config validation', () => {
  assert.throws(() => parseConfig({} as never), /chains/)
  assert.throws(() => parseConfig({ chains: { a: [] } }), /at least one/)
  assert.throws(() => parseConfig({ chains: { a: ['b', 'b'] } }), /duplicates/)
  assert.throws(() => parseConfig({ chains: { a: ['a'] } }), /itself/)
  const p = parseConfig({ chains: { 'deepseek-v4-pro': ['deepseek-flash'] } })
  assert.ok(shouldSwitch(p, 'RATE_LIMIT'))
  assert.ok(!shouldSwitch(p, 'AUTH'))
  assert.ok(shouldSwitch(parseConfig({ chains: { a: ['b'] }, codes: [] }), 'ANYTHING'))
})

test('chain lookup prefers provider/model', () => {
  const p = parseConfig({ chains: { 'deepseek/deepseek-v4-pro': ['x'], 'deepseek-v4-pro': ['y'] } })
  assert.equal(chainFor(p, 'deepseek', 'deepseek-v4-pro')![0]!.model, 'x')
  assert.equal(chainFor(p, 'other', 'deepseek-v4-pro')![0]!.model, 'y')
  assert.equal(chainFor(p, 'deepseek', 'nope'), undefined)
})

test('advance walks the chain then stops', () => {
  const chain = [parseRef('b'), parseRef('openrouter/c')]
  const s1 = advance(undefined, chain, 'deepseek', 'a')!
  assert.deepEqual(resolve(s1, chain, 'deepseek', 'a'), { provider: 'deepseek', model: 'b' })
  const s2 = advance(s1, chain, 'deepseek', 'b')!
  assert.deepEqual(resolve(s2, chain, 'deepseek', 'b'), { provider: 'openrouter', model: 'c' })
  assert.equal(advance(s2, chain, 'openrouter', 'c'), undefined)
  assert.deepEqual(resolve(undefined, chain, 'deepseek', 'a'), { provider: 'deepseek', model: 'a' })
})
