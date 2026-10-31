import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as report from './verdent-report/lib/index.js'
import * as fallback from './model-fallback/lib/index.js'

function fakeCtx(presets: Record<string, string> = {}) {
  const tools = new Map<string, any>(); const handlers: Record<string, any[]> = {}
  const ctx: any = {
    tools: { register: (t: any) => tools.set(t.name, t) },
    on: (ev: string, fn: any) => { (handlers[ev] ??= []).push(fn); return () => {} },
    get: (n: string) => n === 'agentPresets' ? { composedPreset: (c: any) => presets[c?.id] } : undefined,
    logger: { info() {}, warn() {} },
  }
  return { ctx, tools, handlers }
}
const agentObj = (id: string) => { const steered: any[] = []; return { ctx: { id }, steered, steer: (m: any) => steered.push(m) } }
const crit = (criterion: string, met = true) => ({ criterion, met, evidence: met ? 'ran tests: 12 passed' : '' })

test('report flow: worker, verdict PASS, playbook, find, read', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'vr-'))
  const { ctx, tools } = fakeCtx()
  await report.apply(ctx, { memoryDir: dir, role: 'all', maxReminders: 2 })
  assert.deepEqual([...tools.keys()].sort(), ['find_playbooks_v1', 'read_task_report_v1', 'submit_verdict_v1', 'submit_worker_report_v1'])
  const w = agentObj('w')
  const out = await tools.get('submit_worker_report_v1').execute({ task_id: 'Shot-12', status: 'done', summary: 'Render shot 12 in Unreal', criteria: [crit('frame exists')], lessons: ['close Storyteller first to free RAM'], playbook_steps: ['open level', 'render'] }, { agent: w })
  assert.match(out, /shot-12: done, 1\/1/)
  await assert.rejects(tools.get('submit_worker_report_v1').execute({ task_id: 'x', status: 'done', summary: 's', criteria: [crit('a', false)] }, { agent: w }), /not met/)
  const v = await tools.get('submit_verdict_v1').execute({ task_id: 'shot-12', verdict: 'PASS', criteria: [crit('frame exists')] }, { agent: agentObj('v') })
  assert.match(v, /PASS.*Playbook saved/)
  assert.deepEqual(await readdir(join(dir, 'playbooks')), ['render-shot-12-in-unreal.md'])
  assert.match(await readFile(join(dir, 'lessons', 'inbox.md'), 'utf8'), /close Storyteller first/)
  assert.match(await tools.get('find_playbooks_v1').execute({ query: 'render unreal shot' }), /render-shot-12-in-unreal\.md/)
  const both = JSON.parse(await tools.get('read_task_report_v1').execute({ task_id: 'shot-12' }))
  assert.equal(both.verdict.verdict, 'PASS')
  await tools.get('submit_verdict_v1').execute({ task_id: 'shot-13', verdict: 'FAIL', criteria: [crit('frame exists', false)], notes: 'black frame' }, { agent: agentObj('v2') })
  assert.match(await readFile(join(dir, 'lessons', 'inbox.md'), 'utf8'), /FAIL frame exists[\s\S]*black frame/)
})

test('stop check reminds twice then lets go; report clears it; new task resets', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'vr-'))
  const { ctx, tools, handlers } = fakeCtx({ w: 'worker-verdent', m: 'manager-verdent' })
  await report.apply(ctx, { memoryDir: dir, role: 'worker', requireReportPresets: ['worker-verdent'] })
  const stop = (a: any) => handlers['agent/turn-stopping']![0]({ agent: a })
  const pre = (a: any, kind: string) => handlers['agent/pre-step']![0]({ agent: a, messages: [{ source: { kind } }] }, async () => undefined)
  const w = agentObj('w'); const m = agentObj('m')
  stop(m); assert.equal(m.steered.length, 0, 'manager preset is not checked')
  stop(w); stop(w); stop(w)
  assert.equal(w.steered.length, 2)
  assert.match(w.steered[0].content[0].text, /submit_worker_report_v1/)
  assert.equal(w.steered[0].source.kind, 'verdent-report')
  await pre(w, 'user')
  await tools.get('submit_worker_report_v1').execute({ task_id: 't', status: 'partial', summary: 's', criteria: [] }, { agent: w })
  stop(w); assert.equal(w.steered.length, 2, 'no reminder after reporting')
  await pre(w, 'verdent-report'); stop(w); assert.equal(w.steered.length, 2, 'own reminder does not reset')
  await pre(w, 'user'); stop(w); assert.equal(w.steered.length, 3, 'new task resets')
})

test('config errors fail loud', async () => {
  const { ctx } = fakeCtx()
  await assert.rejects(report.apply(ctx, { memoryDir: '', role: 'worker' } as any), /memoryDir/)
  await assert.rejects(report.apply(ctx, { memoryDir: '/tmp', role: 'boss' } as any), /role/)
  assert.throws(() => fallback.apply(ctx, {} as any), /chains/)
})

test('model fallback: switch after retry gives up, walk chain, reset on new task', async () => {
  const { ctx, handlers } = fakeCtx()
  fallback.apply(ctx, { chains: { 'deepseek-v4-pro': ['deepseek-flash', 'openrouter/qwen3'] } })
  const a: any = { id: 'a' }
  const req = () => handlers['agent/request']![0]({ agent: a }, async () => ({ provider: 'deepseek', model: 'deepseek-v4-pro', maxTokens: 10 }))
  const err = (code: string, downstream: any = undefined) => handlers['agent/request-error']![0]({ agent: a, failure: { code }, signal: new AbortController().signal }, async () => downstream)
  assert.equal((await req()).model, 'deepseek-v4-pro')
  assert.deepEqual(await err('RATE_LIMIT', { kind: 'retry' }), { kind: 'retry' }, 'llm-retry still retrying: pass through')
  assert.equal(await err('AUTH'), undefined, 'non-listed code: no switch')
  assert.deepEqual(await err('SERVER'), { kind: 'retry' })
  const r1 = await req(); assert.equal(r1.model, 'deepseek-flash'); assert.equal(r1.maxTokens, 10)
  assert.deepEqual(await err('SERVER'), { kind: 'retry' })
  const r2 = await req(); assert.deepEqual([r2.provider, r2.model], ['openrouter', 'qwen3'])
  assert.equal(await err('SERVER'), undefined, 'chain used up')
  await handlers['agent/pre-step']![0]({ agent: a, messages: [{ source: { kind: 'user' } }] }, async () => undefined)
  assert.equal((await req()).model, 'deepseek-v4-pro')
})
