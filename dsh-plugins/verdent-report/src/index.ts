/**
 * Verdent report plugin for DeepSeek Harness.
 *
 * - `submit_worker_report_v1` (Worker) and `submit_verdict_v1` (Verifier): strict JSON
 *   reports, checked before they are accepted ("done" needs every criterion met with
 *   evidence, "PASS" needs every criterion passing).
 * - Stop check: a Worker or Verifier that tries to end its turn without reporting is
 *   reminded, up to `maxReminders` times per task.
 * - Lessons loop: lessons from reports and every FAIL are appended to
 *   `<memoryDir>/lessons/inbox.md`.
 * - Playbook library: on PASS, the Worker's `playbook_steps` are saved to
 *   `<memoryDir>/playbooks/`; `find_playbooks_v1` searches them for the Manager.
 * - `read_task_report_v1`: the Manager reads a task's saved report and verdict.
 *
 * Files are written by the host (not the model), so memory saving works in every
 * sandbox mode. Nothing is written to the session log.
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { ContextFormed } from '@deepseek-ai/dsh-llm'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { appendFile, mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  VERDICTS, WORKER_STATUSES, lessonsEntry, missingReportReminder, playbookMarkdown, rankPlaybooks,
  renderVerdict, renderWorkerReport, slugify, validateVerdict, validateWorkerReport,
} from './core.ts'
import type { VerdictReport, WorkerReport } from './core.ts'

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'verdent-report': { kind: 'verdent-report' } & ContextFormed
  }
}

export const name = 'verdent-report'
export const inject = ['tools']

export type Role = 'worker' | 'verifier' | 'manager' | 'all'

export interface Config {
  /** Folder for reports, lessons and playbooks, e.g. C:\Users\Luda\.dsh\manager-memory */
  memoryDir: string
  /** Which tools this mount registers: worker, verifier, manager (read + find), or all. */
  role: Role
  /** Preset ids whose agents must report before stopping. Empty: every agent in this mount's scope. */
  requireReportPresets?: string[]
  /** Reminders before the agent is allowed to stop without a report (0 turns the stop check off). */
  maxReminders?: number
}

const ROLES: Role[] = ['worker', 'verifier', 'manager', 'all']

function checkConfig(config: Config): Required<Config> {
  if (typeof config?.memoryDir !== 'string' || config.memoryDir.trim() === '') {
    throw new Error('verdent-report: `memoryDir` is required')
  }
  if (!ROLES.includes(config.role)) throw new Error(`verdent-report: \`role\` must be one of ${ROLES.join(', ')}`)
  const maxReminders = config.maxReminders ?? 2
  if (!Number.isInteger(maxReminders) || maxReminders < 0) throw new Error('verdent-report: `maxReminders` must be an integer >= 0')
  return { memoryDir: config.memoryDir, role: config.role, requireReportPresets: config.requireReportPresets ?? [], maxReminders }
}

const today = (): string => new Date().toISOString().slice(0, 10)

async function atomicWrite(path: string, text: string): Promise<void> {
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`
  await writeFile(tmp, text, 'utf8')
  await rename(tmp, path)
}

async function readJson<T>(path: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

const criterionItems = {
  type: 'object',
  additionalProperties: false,
  properties: {
    criterion: { type: 'string', required: true, description: 'One definition-of-done item, worded as given.' },
    met: { type: 'boolean', required: true, description: 'True only if you proved it.' },
    evidence: { type: 'string', required: true, description: 'What you ran or read that proves it (command and result, file and line). Empty only when met is false.' },
  },
} as const

const stringList = (description: string) => ({ type: 'array', items: { type: 'string' }, description }) as const

const textOutput = { schema: { type: 'string' }, render: (_args: unknown, value: string) => [{ type: 'text' as const, text: value }] } as const

export async function apply(ctx: Context, rawConfig: Config): Promise<void> {
  const config = checkConfig(rawConfig)
  const dirs = {
    reports: join(config.memoryDir, 'reports'),
    lessons: join(config.memoryDir, 'lessons'),
    playbooks: join(config.memoryDir, 'playbooks'),
  }
  await Promise.all(Object.values(dirs).map(d => mkdir(d, { recursive: true })))
  const lessonsFile = join(dirs.lessons, 'inbox.md')
  const reportPath = (taskId: string, kind: 'worker' | 'verdict') => join(dirs.reports, `${taskId}.${kind}.json`)

  /** Per-agent stop-check state, cleared by each new task message. */
  const reported = new WeakMap<Agent, { done: boolean; reminders: number }>()
  const markReported = (agent: Agent | undefined) => {
    if (agent) reported.set(agent, { done: true, reminders: 0 })
  }

  const has = (role: Role) => config.role === role || config.role === 'all'

  if (has('worker')) {
    ctx.tools.register(defineTool({
      name: 'submit_worker_report_v1',
      description:
        'Finish a task by submitting your report. Use once, as your last action, for every task the Manager gave you. '
        + 'Use status "done" only when every definition-of-done criterion is met and you have evidence for each; '
        + '"partial" when some are left; "blocked" when you cannot continue without help (say what you need in open_questions). '
        + 'Do not use it for progress updates; do not call it twice for the same task unless the first call was rejected.',
      parameters: {
        task_id: { type: 'string', required: true, description: 'The task id from the Manager (lowercase, digits, - or _).' },
        status: { type: 'string', required: true, enum: [...WORKER_STATUSES], description: 'done | partial | blocked' },
        summary: { type: 'string', required: true, description: 'One or two sentences: what you did.' },
        criteria: { type: 'array', required: true, items: criterionItems, description: 'One entry per definition-of-done criterion.' },
        files_changed: stringList('Paths you created or edited.'),
        open_questions: stringList('What you need from the Manager or the user. Required when blocked.'),
        lessons: stringList('Short lessons worth remembering next time, including what went wrong.'),
        playbook_steps: stringList('The steps that worked, in order, written so another agent can repeat them. Saved as a playbook if the Verifier passes this task.'),
      },
      output: textOutput,
      async execute(args, exec) {
        const report = validateWorkerReport(args as Parameters<typeof validateWorkerReport>[0])
        await atomicWrite(reportPath(report.task_id, 'worker'), JSON.stringify(report, null, 2))
        const entry = lessonsEntry(today(), report.task_id, `worker, ${report.status}`, report.lessons)
        if (entry) await appendFile(lessonsFile, entry, 'utf8')
        markReported(exec.agent)
        return renderWorkerReport(report)
      },
      presentCall: args => ({ card: 'generic', title: `Report: ${String(args.task_id)} (${String(args.status)})`, kind: 'other', rawInput: args }),
    }))
  }

  if (has('verifier')) {
    ctx.tools.register(defineTool({
      name: 'submit_verdict_v1',
      description:
        'Record your verdict after independently checking a Worker\'s task. Use once, as your last action. '
        + 'Grade every definition-of-done criterion with your own evidence (do not copy the Worker\'s). '
        + 'PASS only if every criterion passes; otherwise FAIL with notes on what is wrong.',
      parameters: {
        task_id: { type: 'string', required: true, description: 'The task id you were asked to verify.' },
        verdict: { type: 'string', required: true, enum: [...VERDICTS], description: 'PASS | FAIL' },
        criteria: { type: 'array', required: true, items: criterionItems, description: 'One entry per criterion; met means it passes.' },
        notes: { type: 'string', description: 'What is wrong (required for a FAIL where every criterion looked met).' },
      },
      output: textOutput,
      async execute(args, exec) {
        const verdict = validateVerdict(args as Parameters<typeof validateVerdict>[0])
        await atomicWrite(reportPath(verdict.task_id, 'verdict'), JSON.stringify(verdict, null, 2))
        const worker = await readJson<WorkerReport>(reportPath(verdict.task_id, 'worker'))
        let extra = ''
        if (verdict.verdict === 'FAIL') {
          const failed = verdict.criteria.filter(c => !c.met).map(c => `FAIL ${c.criterion}: ${c.evidence || 'no evidence given'}`)
          const lines = [...failed, ...verdict.notes ? [`Verifier notes: ${verdict.notes}`] : []]
          const entry = lessonsEntry(today(), verdict.task_id, 'verifier, FAIL', lines)
          if (entry) await appendFile(lessonsFile, entry, 'utf8')
        } else if (worker !== undefined && worker.playbook_steps.length > 0) {
          const file = join(dirs.playbooks, `${slugify(worker.summary)}.md`)
          await atomicWrite(file, playbookMarkdown(worker, verdict, today()))
          extra = ` Playbook saved: ${file}`
        }
        markReported(exec.agent)
        return renderVerdict(verdict) + extra
      },
      presentCall: args => ({ card: 'generic', title: `Verdict: ${String(args.task_id)} ${String(args.verdict)}`, kind: 'other', rawInput: args }),
    }))
  }

  if (has('manager')) {
    ctx.tools.register(defineTool({
      name: 'read_task_report_v1',
      description: 'Read the saved Worker report and Verifier verdict for a task id. Use after a Worker or Verifier finishes, instead of relying on their chat summary.',
      parameters: { task_id: { type: 'string', required: true, description: 'The task id.' } },
      output: textOutput,
      async execute(args) {
        const taskId = String(args.task_id).trim().toLowerCase()
        if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(taskId)) throw new Error('invalid task_id')
        const worker = await readJson<WorkerReport>(reportPath(taskId, 'worker'))
        const verdict = await readJson<VerdictReport>(reportPath(taskId, 'verdict'))
        if (!worker && !verdict) return `No report or verdict saved for task ${taskId}.`
        return JSON.stringify({ worker: worker ?? null, verdict: verdict ?? null }, null, 2)
      },
    }))
    ctx.tools.register(defineTool({
      name: 'find_playbooks_v1',
      description: 'Search saved playbooks (steps that passed verification before) for a new task. Use before planning any task that resembles earlier work; pass the closest match to the Planner and Worker. Skip for one-off questions.',
      parameters: { query: { type: 'string', required: true, description: 'A few keywords describing the task.' } },
      output: textOutput,
      async execute(args) {
        const names = (await readdir(dirs.playbooks)).filter(n => n.endsWith('.md'))
        const files = await Promise.all(names.map(async n => ({ name: n, text: await readFile(join(dirs.playbooks, n), 'utf8') })))
        const hits = rankPlaybooks(String(args.query), files)
        if (hits.length === 0) return 'No matching playbooks.'
        return hits.map(h => `--- ${h.name} (score ${h.score}) ---\n${files.find(f => f.name === h.name)!.text}`).join('\n\n')
      },
    }))
  }

  if ((has('worker') || has('verifier')) && config.maxReminders > 0) {
    const kind: 'worker' | 'verifier' = has('worker') && !has('verifier') ? 'worker' : has('verifier') && !has('worker') ? 'verifier' : 'worker'
    const appliesTo = (agent: Agent): boolean => {
      if (config.requireReportPresets.length === 0) return true
      const preset = ctx.get('agentPresets')?.composedPreset((agent as unknown as { ctx: Context }).ctx)
      return preset !== undefined && config.requireReportPresets.includes(preset)
    }

    ctx.on('agent/pre-step', ({ agent, messages }, next): Promise<PreStepDecision> => {
      // A new task message starts a new reporting obligation.
      if (messages.some(m => m.source.kind === 'user')) reported.delete(agent)
      return next()
    })

    ctx.on('agent/turn-stopping', ({ agent }) => {
      if (!appliesTo(agent)) return
      const state = reported.get(agent) ?? { done: false, reminders: 0 }
      if (state.done || state.reminders >= config.maxReminders) return
      state.reminders++
      reported.set(agent, state)
      agent.steer(createUserMessage({
        content: [{ type: 'text', text: missingReportReminder(kind, state.reminders, config.maxReminders) }],
        source: { kind: 'verdent-report', form: 'notice', summary: `report reminder ${state.reminders}` },
      }))
    })
  }
}
