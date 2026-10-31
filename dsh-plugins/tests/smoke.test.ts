// Integration smoke tests: the built lib/ files on a fake host that mirrors the
// real DeepSeek Harness rules (see fake-host.mjs). Run via `node test.mjs`.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createAgent, createHost, loop, msg, mountLlmRetry, step } from './tests/fake-host.mjs'
import * as report from './verdent-report/lib/index.js'
import * as fallback from './model-fallback/lib/index.js'

const crit = (criterion: string, met = true) => ({ criterion, met, evidence: met ? 'ran tests: 12 passed' : '' })
const tmp = () => mkdtemp(join(tmpdir(), 'vr-'))

test('report flow: report, PASS saves a playbook named by report id, Manager sees names not text', async () => {
  const dir = await tmp()
  const host = createHost()
  await report.apply(host.ctx, { memoryDir: dir, role: 'all' })
  const w = createAgent('w')
  const saved = await loop.tool(host, 'submit_worker_report_v1', { task_id: 'Shot-12', status: 'done', summary: 'Render shot 12 in Unreal', criteria: [crit('frame exists')], lessons: ['close Storyteller first to free RAM'], playbook_steps: ['open level', 'render'] }, w)
  assert.match(saved, /^Saved: shot-12 done, 1\/1 met\. You are done/)
  const v = await loop.tool(host, 'submit_verdict_v1', { task_id: 'shot-12', verdict: 'PASS', criteria: [crit('Frame exists.')] }, createAgent('v'))
  assert.match(v, /PASS, 1\/1 pass\. Playbook saved: shot-12-\d{14}-[0-9a-f]{4}\./)
  const [pbName] = await readdir(join(dir, 'playbooks')).then(n => n.filter(x => x.endsWith('.md')))
  const found = await loop.tool(host, 'find_playbooks_v1', { query: 'render unreal shot' })
  assert.match(found, new RegExp(`1\\. ${pbName!.replace('.md', '')} \\(score \\d+\\) "Render shot 12 in Unreal", 2 steps`))
  assert.ok(!found.includes('open level'), 'no playbook text in the Manager context')
  assert.match(await loop.tool(host, 'read_playbook_v1', { name: pbName!.replace('.md', '') }, w), /1\. open level/)
  await assert.rejects(loop.tool(host, 'read_playbook_v1', { name: '../reports/shot-12.worker' }, w), /no playbook named/)
  assert.match(await loop.tool(host, 'read_task_report_v1', { task_id: 'shot-12' }), /State: PASS\./)
  assert.match(await loop.tool(host, 'recent_lessons_v1', { query: 'storyteller' }), /close Storyteller first/)
})

test('same summary on two tasks keeps two playbooks', async () => {
  const dir = await tmp()
  const host = createHost()
  await report.apply(host.ctx, { memoryDir: dir, role: 'all' })
  for (const id of ['a', 'b']) {
    await loop.tool(host, 'submit_worker_report_v1', { task_id: id, status: 'done', summary: 'Fix login bug', criteria: [crit('works')], playbook_steps: [`step ${id}`] }, createAgent(id))
    await loop.tool(host, 'submit_verdict_v1', { task_id: id, verdict: 'PASS', criteria: [crit('works')] }, createAgent(`v${id}`))
  }
  assert.equal((await readdir(join(dir, 'playbooks'))).filter(n => n.endsWith('.md')).length, 2)
})

test('PASS that skips a worker criterion is recorded but saves no playbook; FAIL retires; resubmit archives the verdict', async () => {
  const dir = await tmp()
  const host = createHost()
  await report.apply(host.ctx, { memoryDir: dir, role: 'all' })
  await loop.tool(host, 'submit_worker_report_v1', { task_id: 't', status: 'partial', summary: 'Render', criteria: [crit('frame'), crit('audio', false)], playbook_steps: ['x'] }, createAgent('w'))
  const v1 = await loop.tool(host, 'submit_verdict_v1', { task_id: 't', verdict: 'PASS', criteria: [crit('frame')] }, createAgent('v'))
  assert.match(v1, /Playbook not saved: "audio" not graded\. Call again including it to save\./)
  const v2 = await loop.tool(host, 'submit_verdict_v1', { task_id: 't', verdict: 'PASS', criteria: [crit('frame'), crit('audio')] }, createAgent('v'))
  assert.match(v2, /Playbook saved/)
  const v3 = await loop.tool(host, 'submit_verdict_v1', { task_id: 't', verdict: 'FAIL', criteria: [crit('frame'), crit('audio', false)], notes: 'no sound' }, createAgent('v'))
  assert.match(v3, /Its playbook was retired\./)
  assert.equal((await readdir(join(dir, 'playbooks'))).filter(n => n.endsWith('.md')).length, 0)
  assert.equal((await readdir(join(dir, 'playbooks', '.retired'))).length, 1)
  await loop.tool(host, 'submit_worker_report_v1', { task_id: 't', status: 'done', summary: 'Render again', criteria: [crit('frame'), crit('audio')] }, createAgent('w'))
  assert.match(await loop.tool(host, 'read_task_report_v1', { task_id: 't' }), /State: not verified yet\./)
  assert.equal((await readdir(join(dir, 'reports', 'archive'))).length, 1, 'old verdict archived, not deleted')
  assert.match(await readFile(join(dir, 'lessons', 'inbox.md'), 'utf8'), /FAIL audio/)
})

test('20 parallel reports for one task: none fail, every lesson kept', async () => {
  const dir = await tmp()
  const host = createHost()
  await report.apply(host.ctx, { memoryDir: dir, role: 'worker' })
  const results = await Promise.allSettled(Array.from({ length: 20 }, (_, i) =>
    loop.tool(host, 'submit_worker_report_v1', { task_id: 'same', status: 'partial', summary: 's', criteria: [], lessons: [`lesson ${i}`] }, createAgent(`w${i}`))))
  assert.equal(results.filter(r => r.status === 'rejected').length, 0)
  const inbox = await readFile(join(dir, 'lessons', 'inbox.md'), 'utf8')
  for (let i = 0; i < 20; i++) assert.ok(inbox.includes(`- lesson ${i}\n`))
  assert.deepEqual((await readdir(join(dir, 'reports'))).filter(n => n.endsWith('.tmp')), [])
})

test('stop check: armed by a task id in user or agent-message; one reminder per turn across mounts', async () => {
  const dir = await tmp()
  const host = createHost({ presets: { w: 'worker-verdent', v: 'verifier-verdent' } })
  await report.apply(host.ctx, { memoryDir: dir, role: 'worker', maxReminders: 2 })
  await report.apply(host.ctx, { memoryDir: dir, role: 'verifier', maxReminders: 2 })
  const w = createAgent('w')
  await loop.stop(host, w, 1)
  assert.equal(w.steered.length, 0, 'not armed without a task id')
  await loop.preStep(host, w, [msg.user('Do it. task_id: t1')], 1)
  await loop.stop(host, w, 1)
  assert.equal(w.steered.length, 1, 'two mounts, one reminder this turn')
  await loop.stop(host, w, 1)
  assert.equal(w.steered.length, 1, 'still one this turn')
  await loop.preStep(host, w, [msg.agent('What is the status?')], 2)
  await loop.stop(host, w, 2)
  assert.equal(w.steered.length, 2, 'a plain question does not re-arm; second reminder in turn 2')
  await loop.stop(host, w, 3)
  assert.equal(w.steered.length, 2, 'maxReminders reached')
  await loop.tool(host, 'submit_worker_report_v1', { task_id: 't1', status: 'partial', summary: 's', criteria: [] }, w)
  await loop.preStep(host, w, [msg.agent('Next one. task_id: t2')], 4)
  await loop.stop(host, w, 4)
  assert.equal(w.steered.length, 3, 'follow-up task via agent-message re-arms')
  assert.match(w.steered[2].content[0].text, /for t2/)
})

test('stop check respects presets and default maxReminders 1', async () => {
  const host = createHost({ presets: { w: 'worker-verdent', m: 'manager-verdent' } })
  await report.apply(host.ctx, { memoryDir: await tmp(), role: 'worker', requireReportPresets: ['worker-verdent'] })
  const w = createAgent('w'); const m = createAgent('m')
  for (const a of [w, m]) await loop.preStep(host, a, [msg.user('task_id: t1')], 1)
  await loop.stop(host, m, 1); await loop.stop(host, w, 1); await loop.stop(host, w, 2)
  assert.equal(m.steered.length, 0)
  assert.equal(w.steered.length, 1)
})

test('config errors are clear', async () => {
  const host = createHost()
  await assert.rejects(report.apply(host.ctx, { memoryDir: '', role: 'worker' } as never), /memoryDir is required/)
  await assert.rejects(report.apply(host.ctx, { memoryDir: '/tmp', role: 'boss' } as never), /role must be one of/)
  await assert.rejects(report.apply(host.ctx, { memoryDir: '/tmp', role: 'worker', requireReportPresets: 'worker-verdent' } as never), /must be a list/)
  await report.apply(host.ctx, { memoryDir: await tmp(), role: 'worker' })
  await assert.rejects(report.apply(host.ctx, { memoryDir: await tmp(), role: 'worker' }), /verdent-report \(role worker\).*Mount each role once/)
})

test('fallback: no host error, switches from the next step, restores after cooldown', async () => {
  const host = createHost()
  mountLlmRetry(host, { maxRetries: 1 })
  fallback.apply(host.ctx, { chains: { 'deepseek-v4-pro': ['deepseek-flash'] }, cooldownMs: 50 })
  const a = createAgent('a')
  const s1 = await step(host, a, { turn: 1, outcomes: ['SERVER', 'SERVER'] })
  assert.equal(s1.result, 'error:SERVER', 'the failing step still fails')
  assert.equal(s1.selection.model, 'deepseek-v4-pro')
  const s2 = await step(host, a, { turn: 2, messages: [msg.agent('retry it')] })
  assert.equal(s2.selection.model, 'deepseek-flash', 'next turn runs on the backup')
  await new Promise(r => setTimeout(r, 60))
  await loop.stop(host, a, 2)
  const s3 = await step(host, a, { turn: 3 })
  assert.equal(s3.selection.model, 'deepseek-v4-pro', 'back to primary after the cooldown')
})

test('fallback: outage memory moves other agents; a user model change is left alone', async () => {
  const host = createHost()
  fallback.apply(host.ctx, { chains: { 'deepseek-v4-pro': ['deepseek-flash'] }, cooldownMs: 60_000 })
  const a = createAgent('a'); const b = createAgent('b'); const c = createAgent('c')
  await step(host, a, { outcomes: ['SERVER'] })
  await step(host, b, { turn: 1 })
  const sb = await step(host, b, { turn: 1, step: 2 })
  assert.equal(sb.selection.model, 'deepseek-flash', 'b follows the known outage from its next step')
  await step(host, c, { outcomes: ['AUTH'] })
  assert.equal((await step(host, c, { turn: 2 })).selection.model, 'deepseek-flash', 'c also follows the outage')
  a.model.select({ provider: 'deepseek', model: 'my-choice' })
  await loop.stop(host, a, 1)
  assert.equal((await step(host, a, { turn: 2 })).selection.model, 'my-choice')
})
