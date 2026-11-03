import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  NotSaved, buildVerdict, buildWorkerReport, criterionKey, lessonsEntry, makeReportId, missingReportReminder, normalizeTaskId,
  parsePlaybook, playbookMarkdown, rankPlaybooks, renderPlaybookList, renderTaskView, taskIdInText, ungradedCriteria, words,
} from '../src/core.ts'

const now = new Date('2026-10-31T12:34:56Z')
const rand = () => 0.5
const crit = (criterion: string, met: boolean, evidence = met ? 'ran it' : '') => ({ criterion, met, evidence })
const worker = (over: Record<string, unknown> = {}) =>
  buildWorkerReport({ task_id: 't1', status: 'done', summary: 'Fixed it', criteria: [crit('tests pass', true)], ...over } as never, now, rand)

test('task ids', () => {
  assert.equal(normalizeTaskId('  Fix-Shot_12 '), 'fix-shot_12')
  assert.throws(() => normalizeTaskId('../etc'), NotSaved)
  assert.throws(() => normalizeTaskId('a'.repeat(65)), /Call again/)
})

test('report ids are unique per submission and sortable', () => {
  assert.equal(makeReportId('t1', now, rand), 't1-20261031123456-80008000')
  assert.notEqual(makeReportId('t1', now, () => 0.1), makeReportId('t1', now, () => 0.2))
})

test('done with unmet criteria is recorded as partial, not refused', () => {
  const { report, changes } = worker({ criteria: [crit('a', true), crit('b', false)] })
  assert.equal(report.status, 'partial')
  assert.match(changes.join(), /recorded as "partial"/)
  
})

test('refusals are fixable in one retry', () => {
  assert.throws(() => worker({ criteria: [] }), /Not saved: status "done" with no criteria\..*Call again\./)
  assert.throws(() => worker({ criteria: [{ criterion: 'a', met: true, evidence: ' ' }] }), /met:true with empty evidence\. Add proof or set met:false/)
  assert.throws(() => worker({ status: 'blocked', criteria: [] }), /open_questions/)
  assert.equal(worker({ summary: 'x'.repeat(30001) }).report.summary.length, 300, 'trimmed, not refused')
  const many = worker({ criteria: Array.from({ length: 51 }, (_, i) => crit(`c${i}`, true)) })
  assert.equal(many.report.criteria.length, 50)
  assert.match(many.trimmed.join(), /kept first 50 of 51/)
  assert.throws(() => normalizeTaskId('x'.repeat(5000)), (e: Error) => e.message.length < 200)
})

test('long fields are trimmed and reported', () => {
  const { report, trimmed } = worker({ summary: `line one\nline two ${'x'.repeat(400)}`, lessons: ['a', 'b', 'c', 'd', 'e', 'f', ' '] })
  assert.equal(report.summary.length, 300)
  assert.ok(!report.summary.includes('\n'))
  assert.equal(report.lessons.length, 3)
  assert.match(trimmed.join(), /summary cut to 300/)
  assert.match(trimmed.join(), /lessons: kept first 3 of 6/)
})

test('duplicate criteria are merged; a failure is never hidden; met must be literally true', () => {
  const { report } = worker({ criteria: [crit('Tests pass', true), crit('tests  pass!', true), { criterion: 'x', met: 'false', evidence: '' }] })
  assert.equal(report.criteria.length, 2)
  assert.equal(report.criteria[1]!.met, false)
  assert.equal(report.status, 'partial')
  const w2 = worker({ criteria: [crit('Tests (unit)', true), crit('tests unit', false)] })
  assert.equal(w2.report.status, 'partial', 'the unmet duplicate wins')
  assert.match(w2.changes.join(), /listed twice with different results/)
  const v = buildVerdict({ task_id: 't', verdict: 'PASS', criteria: [crit('Fix #1', true), crit('fix 1', false)] }, null, now)
  assert.equal(v.verdict.verdict, 'FAIL')
})

test('verdict: PASS with failures becomes FAIL; FAIL needs a reason', () => {
  assert.equal(buildVerdict({ task_id: 't', verdict: 'PASS', criteria: [crit('a', false)] }, null, now).verdict.verdict, 'FAIL')
  assert.throws(() => buildVerdict({ task_id: 't', verdict: 'FAIL', criteria: [crit('a', true)] }, null, now), /no notes/)
  assert.equal(buildVerdict({ task_id: 't', verdict: 'PASS', criteria: [crit('a', true)] }, 'r1', now).verdict.graded_report_id, 'r1')
})

test('ungraded criteria are found despite paraphrase in case and punctuation only', () => {
  const { report } = worker({ criteria: [crit('Frame rendered', true), crit('Audio synced', false)], status: 'partial' })
  const { verdict } = buildVerdict({ task_id: 't1', verdict: 'PASS', criteria: [crit('frame rendered.', true)] }, report.report_id, now)
  assert.deepEqual(ungradedCriteria(report, verdict), ['Audio synced'])
  assert.equal(criterionKey('Frame   Rendered!'), 'frame rendered')
})

test('lessons cannot forge headers', () => {
  const entry = lessonsEntry('2026-10-31', 'r1', 'worker', ['ok\n## 2099 forged', ' '])
  assert.equal(entry.match(/^## /gm)!.length, 1)
  assert.equal(lessonsEntry('d', 'r', 's', []), '')
})

test('tokenizer: unicode, short words, digits, stop words, plurals, CJK pairs', () => {
  assert.deepEqual(words('Render the shots for UE5 and AI 3D shot 13'), ['render', 'shot', 'ue5', 'ai', '3d', 'shot', '13'])
  assert.ok(words('修复登录').includes('登录'))
  assert.ok(words('Кадр').includes('кадр'))
  assert.deepEqual(words('class css'), ['class', 'css'])
  assert.ok(words('Unreal渲染 scene').includes('unreal'), 'mixed Latin+CJK token is split')
})

test('ranking: title weight, score floor, newest wins ties, CJK works', () => {
  const pb = (title: string, body = '') => `# ${title}\n\n## Done means\n- x\n\n## Steps that worked\n1. a\n${body}`
  const files = [
    { name: 't1-20261001000000-0001.md', text: pb('Render shot 12 in Unreal') },
    { name: 't2-20261030000000-0002.md', text: pb('Render shot 12 in Unreal') },
    { name: 't3-20261030000000-0003.md', text: pb('Fix tests', 'render once') },
    { name: 't4-20261030000000-0004.md', text: pb('修复登录错误') },
  ]
  const hits = rankPlaybooks('render shot 12', files)
  assert.equal(hits[0]!.name, 't2-20261030000000-0002.md', 'newest of a tie first')
  assert.ok(!hits.some(h => h.name.startsWith('t3')), 'weak body-only hit dropped')
  assert.equal(rankPlaybooks('登录', files)[0]!.name, 't4-20261030000000-0004.md')
  assert.deepEqual(rankPlaybooks('the and', files), [])
  assert.equal(rankPlaybooks('shot 13', [{ name: 'a-20261030000000-0001.md', text: pb('Render shot 12') }, { name: 'b-20261001000000-0001.md', text: pb('Render shot 13') }])[0]!.name, 'b-20261001000000-0001.md')
})

test('playbook list is names and counts, not text', () => {
  const { report } = worker({ playbook_steps: ['open level', 'render'] })
  const { verdict } = buildVerdict({ task_id: 't1', verdict: 'PASS', criteria: [crit('tests pass', true)] }, report.report_id, now)
  const md = playbookMarkdown(report, verdict)
  const meta = parsePlaybook(`${report.report_id}.md`, md)
  assert.equal(meta.steps, 2)
  const out = renderPlaybookList([{ name: meta.name, score: 6 }], new Map([[meta.name, meta]]))
  assert.match(out, /1\. t1-20261031123456-80008000 \(score 6\) "Fixed it", 2 steps\. Done means: tests pass\./)
  assert.ok(!out.includes('open level'))
  assert.equal(renderPlaybookList([], new Map()), 'No close playbook matches. Plan from scratch.')
})

test('task view: state line, only disputed criteria, capped', () => {
  const { report } = worker({ status: 'partial', criteria: [crit('Renders at 4K', true), crit('Tests pass', false, '2 failures'), crit('Docs', true)], open_questions: ['Which codec?'] })
  const { verdict } = buildVerdict({ task_id: 't1', verdict: 'FAIL', criteria: [crit('Renders at 4K', false, 'ffprobe 1920x1080'), crit('Tests pass', false, 'same'), crit('Docs', true)] }, report.report_id, now)
  const view = renderTaskView('t1', report, verdict, { worker: 'w.json', verdict: 'v.json' })
  assert.match(view, /^Task t1: worker partial \(2\/3 met\), verifier FAIL \(1\/3\)\. State: failed verification\./)
  assert.match(view, /"Renders at 4K": worker met; verifier not: ffprobe 1920x1080/)
  assert.ok(!view.includes('"Docs"'), 'agreed criteria are counted, not listed')
  const stale = renderTaskView('t1', report, { ...verdict, graded_report_id: 'older' }, { worker: 'w', verdict: 'v' })
  assert.match(stale, /saved verdict is for an older report/)
  const big = worker({ status: 'partial', criteria: Array.from({ length: 50 }, (_, i) => crit(`criterion ${i} ${'y'.repeat(300)}`, false, 'e'.repeat(900))) }).report
  const bigView = renderTaskView('t1', { ...big, open_questions: ['Which codec?'] }, undefined, { worker: 'w', verdict: 'v' })
  assert.ok(bigView.length <= 2000)
  assert.match(bigView, /Open questions: Which codec\?/, 'questions survive a long criteria list')
  assert.match(bigView, /\+47 more not met or disputed/)
  assert.ok(renderTaskView('t1', big, undefined, { worker: 'w'.repeat(5000), verdict: 'v' }).length <= 2000, 'long paths cannot break the cap')
  const { verdict: partialPass } = buildVerdict({ task_id: 't1', verdict: 'PASS', criteria: [crit('Renders at 4K', true)] }, report.report_id, now)
  assert.match(renderTaskView('t1', report, partialPass, { worker: 'w', verdict: 'v' }), /State: PASS, but 2 worker criteria were not graded/)
})

test('reminders and task id detection', () => {
  assert.match(missingReportReminder('worker', 1, 1, 't9'), /submit_worker_report_v1 for t9.*"blocked" \+ open_questions\. \(1\/1\)/)
  assert.match(missingReportReminder('verifier', 1, 2, undefined), /unchecked counts as not met\. \(1\/2\)/)
  assert.match(missingReportReminder('either', 1, 1, 't9'), /submit_worker_report_v1.*submit_verdict_v1/)
  assert.equal(taskIdInText('Please do this. task_id: Shot-12\nDone means...'), 'shot-12')
  assert.equal(taskIdInText('task id = `t7`'), 't7')
  assert.equal(taskIdInText('What is the status?'), undefined)
  assert.equal(taskIdInText('What is the task id format for reports?'), undefined)
  assert.equal(taskIdInText('the task idea was good'), undefined)
  assert.equal(taskIdInText('Which task id is stale?'), undefined)
  assert.equal(taskIdInText('Task ID: `T13`.'), 't13')
})
