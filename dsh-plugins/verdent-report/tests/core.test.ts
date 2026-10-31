import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  lessonsEntry, missingReportReminder, normalizeTaskId, playbookMarkdown, rankPlaybooks, slugify,
  validateVerdict, validateWorkerReport,
} from '../src/core.ts'

const crit = (criterion: string, met: boolean, evidence = met ? 'ran it' : '') => ({ criterion, met, evidence })

test('task ids are normalised and checked', () => {
  assert.equal(normalizeTaskId('  Fix-Shot_12 '), 'fix-shot_12')
  assert.throws(() => normalizeTaskId('../etc'), /invalid task_id/)
  assert.throws(() => normalizeTaskId(''), /invalid task_id/)
  assert.throws(() => normalizeTaskId('a'.repeat(65)), /invalid task_id/)
})

test('done needs every criterion met with evidence', () => {
  const ok = validateWorkerReport({ task_id: 't1', status: 'done', summary: 'Fixed it', criteria: [crit('tests pass', true)] })
  assert.equal(ok.status, 'done')
  assert.deepEqual(ok.lessons, [])
  assert.throws(() => validateWorkerReport({ task_id: 't1', status: 'done', summary: 'x', criteria: [] }), /at least one criterion/)
  assert.throws(() => validateWorkerReport({ task_id: 't1', status: 'done', summary: 'x', criteria: [crit('a', false)] }), /not met: a/)
  assert.throws(() => validateWorkerReport({ task_id: 't1', status: 'done', summary: 'x', criteria: [{ criterion: 'a', met: true, evidence: ' ' }] }), /no evidence/)
})

test('partial may leave criteria unmet; blocked needs a question', () => {
  const partial = validateWorkerReport({ task_id: 't2', status: 'partial', summary: 'Half', criteria: [crit('a', true), crit('b', false)] })
  assert.equal(partial.criteria[1]!.met, false)
  assert.throws(() => validateWorkerReport({ task_id: 't2', status: 'blocked', summary: 'stuck', criteria: [] }), /open_questions/)
  const blocked = validateWorkerReport({ task_id: 't2', status: 'blocked', summary: 'stuck', criteria: [], open_questions: ['Need the API key'] })
  assert.deepEqual(blocked.open_questions, ['Need the API key'])
})

test('duplicate criteria and empty list entries are rejected', () => {
  assert.throws(() => validateWorkerReport({ task_id: 't', status: 'partial', summary: 's', criteria: [crit('a', true), crit('a', true)] }), /duplicate/)
  assert.throws(() => validateWorkerReport({ task_id: 't', status: 'partial', summary: 's', criteria: [], lessons: [' '] }), /lessons/)
})

test('verdict rules', () => {
  assert.equal(validateVerdict({ task_id: 't', verdict: 'PASS', criteria: [crit('a', true)] }).verdict, 'PASS')
  assert.throws(() => validateVerdict({ task_id: 't', verdict: 'PASS', criteria: [crit('a', false)] }), /PASS is not allowed/)
  assert.throws(() => validateVerdict({ task_id: 't', verdict: 'PASS', criteria: [] }), /at least one/)
  assert.throws(() => validateVerdict({ task_id: 't', verdict: 'FAIL', criteria: [crit('a', true)] }), /needs notes/)
  assert.equal(validateVerdict({ task_id: 't', verdict: 'FAIL', criteria: [crit('a', false)] }).verdict, 'FAIL')
})

test('slugify', () => {
  assert.equal(slugify('Fix RV036 occlusion!! (shot 12)'), 'fix-rv036-occlusion-shot-12')
  assert.equal(slugify('***'), 'untitled')
  assert.ok(slugify('a'.repeat(100)).length <= 48)
})

test('lessons entry and playbook markdown', () => {
  assert.equal(lessonsEntry('2026-10-31', 't', 'worker', []), '')
  assert.match(lessonsEntry('2026-10-31', 't', 'worker', ['x']), /## 2026-10-31 t \(worker\)\n- x/)
  const report = validateWorkerReport({ task_id: 't', status: 'done', summary: 'Render shot 12', criteria: [crit('frame exists', true)], playbook_steps: ['open level', 'render'] })
  const verdict = validateVerdict({ task_id: 't', verdict: 'PASS', criteria: [crit('frame exists', true)] })
  const md = playbookMarkdown(report, verdict, '2026-10-31')
  assert.match(md, /^# Render shot 12/)
  assert.match(md, /1\. open level\n2\. render/)
})

test('playbook ranking prefers title matches', () => {
  const files = [
    { name: 'render-shot.md', text: '# Render a shot in Unreal\nsteps about lighting' },
    { name: 'fix-tests.md', text: '# Fix failing tests\nrender is mentioned here' },
    { name: 'other.md', text: '# Unrelated\nnothing' },
  ]
  const hits = rankPlaybooks('render the unreal shot', files)
  assert.equal(hits[0]!.name, 'render-shot.md')
  assert.equal(hits.length, 2)
  assert.deepEqual(rankPlaybooks('a', files), [])
})

test('reminder names the right tool', () => {
  assert.match(missingReportReminder('worker', 1, 2), /submit_worker_report_v1.*1 of 2/)
  assert.match(missingReportReminder('verifier', 2, 2), /submit_verdict_v1/)
})
