// Generated from src/index.ts by build.mjs. Do not edit.
/**
 * Verdent report plugin for DeepSeek Harness.
 *
 * Tools, by role (mount once per preset):
 * - worker:   submit_worker_report_v1, read_playbook_v1
 * - verifier: submit_verdict_v1
 * - manager:  read_task_report_v1, find_playbooks_v1, recent_lessons_v1
 * - all:      every tool (single-agent testing only)
 *
 * Behaviour:
 * - Reports are trimmed and recorded rather than refused, and the reply says
 *   what was trimmed or not saved. Each submission gets a unique report id,
 *   so task ids reused across sessions do not overwrite each other.
 * - A new worker report archives the task's older verdict; a verdict records
 *   which report it graded. A PASS saves a playbook only when it graded every
 *   worker criterion. A FAIL retires the playbook made from that report.
 * - Stop check: one shared state per agent across all mounts. It is armed when
 *   a user or agent message names a task id (`task_id: x`), and reminds at most
 *   once per turn, up to maxReminders per task.
 * - Files are written by the host, not the model's sandboxed tools, so memory
 *   saving works in every sandbox mode. Nothing goes into the session log.
 */

                                                  
                                                                    
import { createUserMessage } from '@deepseek-ai/dsh-llm'
                                                         
import { defineTool } from '@deepseek-ai/dsh-tools'
import { randomUUID } from 'node:crypto'
import { appendFile, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  NotSaved, VERDICTS, WORKER_STATUSES, buildVerdict, buildWorkerReport, clip, lessonsEntry, missingReportReminder,
  normalizeTaskId, parsePlaybook, playbookMarkdown, rankPlaybooks, renderLessons, renderPlaybookList, renderTaskView,
  renderVerdictSaved, renderWorkerSaved, taskIdInText, ungradedCriteria, words,
} from './core.js'
                                                                                        

                                       
                              
                                                                
   
 

export const name = 'verdent-report'
export const inject = ['tools']

                                                            

                         
                                                                                          
                   
                                          
            
                                                                                        
                                 
                                                                                             
                       
 

const ROLES         = ['worker', 'verifier', 'manager', 'all']

function checkConfig(config        )                   {
  const prefix = 'verdent-report config'
  if (typeof config?.memoryDir !== 'string' || config.memoryDir.trim() === '') throw new Error(`${prefix}: memoryDir is required`)
  if (!ROLES.includes(config.role)) throw new Error(`${prefix}: role must be one of ${ROLES.join(', ')} (got ${JSON.stringify(config.role)})`)
  const presets = config.requireReportPresets ?? []
  if (!Array.isArray(presets) || presets.some(p => typeof p !== 'string' || p.trim() === '')) {
    throw new Error(`${prefix}: requireReportPresets must be a list of preset ids, e.g. [worker-verdent]`)
  }
  const maxReminders = config.maxReminders ?? 1
  if (!Number.isInteger(maxReminders) || maxReminders < 0) throw new Error(`${prefix}: maxReminders must be a whole number >= 0`)
  return { memoryDir: config.memoryDir.trim(), role: config.role, requireReportPresets: presets.map(p => p.trim()), maxReminders }
}

// ---- files ------------------------------------------------------------------

const RETRY_CODES = new Set(['EPERM', 'EBUSY', 'EACCES'])
const sleep = (ms        ) => new Promise(r => setTimeout(r, ms))

/** Rename with short retries: on Windows, antivirus, indexers and OneDrive briefly lock files. */
async function renameWithRetry(from        , to        )                {
  for (let attempt = 0; ; attempt++) {
    try {
      await rename(from, to)
      return
    } catch (error) {
      const code = (error                         ).code ?? ''
      if (!RETRY_CODES.has(code) || attempt >= 4) throw error
      await sleep(25 * 2 ** attempt)
    }
  }
}

async function atomicWrite(path        , text        )                {
  const tmp = `${path}.${randomUUID()}.tmp`
  try {
    await writeFile(tmp, text, 'utf8')
    await renameWithRetry(tmp, path)
  } catch (error) {
    await rm(tmp, { force: true }).catch(() => {})
    throw error
  }
}

class StoreError extends Error {}

function describe(error         , path        )         {
  const e = error                         
  return `${e.code ?? e.name ?? 'error'} at ${path}`
}

async function readJson   (path        )                                           {
  let text        
  try {
    text = await readFile(path, 'utf8')
  } catch (error) {
    if ((error                         ).code === 'ENOENT') return {}
    return { problem: `could not read ${describe(error, path)}` }
  }
  try {
    return { value: JSON.parse(text)      }
  } catch {
    return { problem: `${path} is not valid JSON (ignored; resubmitting replaces it)` }
  }
}

/** Move a file aside instead of deleting it. */
async function retire(path        , dir        , suffix        )                   {
  try {
    await mkdir(dir, { recursive: true })
    await renameWithRetry(path, join(dir, `${suffix}-${randomUUID().slice(0, 8)}-${path.split(/[\\/]/).pop()}`))
    return true
  } catch (error) {
    if ((error                         ).code === 'ENOENT') return false
    throw error
  }
}

// ---- shared stop-check state (one per agent, across every mount) -------------

                     
                 
                
               
                   
                          
 

const stopStates = new WeakMap                  ()

function stateOf(agent       )            {
  let s = stopStates.get(agent)
  if (!s) {
    s = { armed: false, done: false, reminders: 0, lastRemindedTurn: -1 }
    stopStates.set(agent, s)
  }
  return s
}

function markReported(agent                   , taskId        )       {
  if (!agent) return
  const s = stateOf(agent)
  s.done = true
  s.taskId ??= taskId
}

function messageText(message                       )         {
  const content = Array.isArray(message.content) ? message.content : []
  return content.map(b => (b && typeof b === 'object' && (b                     ).type === 'text') ? String((b                      ).text ?? '') : '').join(' ')
}

/** Inbound task messages: the first task arrives as `user`, follow-ups as `agent-message`. */
const TASK_MESSAGE_KINDS = new Set(['user', 'agent-message'])

// ---- tool definitions -------------------------------------------------------

const criterionItems = {
  type: 'object',
  additionalProperties: false,
  properties: {
    criterion: { type: 'string', required: true },
    met: { type: 'boolean', required: true },
    evidence: { type: 'string', required: true, description: 'Proof. Empty only if met is false.' },
  },
}         

const stringList = (description        ) => ({ type: 'array', items: { type: 'string' }, description })         
const textOutput = { schema: { type: 'string' }, render: (_args         , value        ) => [{ type: 'text'         , text: value }] }         

/** Turn a NotSaved into a normal reply the model can act on; rethrow anything else. */
async function guard(run                       )                  {
  try {
    return await run()
  } catch (error) {
    if (error instanceof NotSaved) throw error
    if (error instanceof StoreError) throw error
    throw new StoreError(`Not saved: storage error (${(error         ).message}). Tell the Manager; do not retry more than once.`)
  }
}

export async function apply(ctx         , rawConfig        )                {
  const config = checkConfig(rawConfig)
  const dirs = {
    reports: join(config.memoryDir, 'reports'),
    archive: join(config.memoryDir, 'reports', 'archive'),
    lessons: join(config.memoryDir, 'lessons'),
    playbooks: join(config.memoryDir, 'playbooks'),
    retired: join(config.memoryDir, 'playbooks', '.retired'),
  }
  try {
    for (const d of [dirs.reports, dirs.lessons, dirs.playbooks]) await mkdir(d, { recursive: true })
  } catch (error) {
    throw new Error(`verdent-report config: memoryDir ${config.memoryDir} is not usable (${describe(error, config.memoryDir)})`)
  }
  const lessonsFile = join(dirs.lessons, 'inbox.md')
  const reportPath = (taskId        , kind                      ) => join(dirs.reports, `${taskId}.${kind}.json`)
  const playbookPath = (reportId        ) => join(dirs.playbooks, `${reportId}.md`)
  const today = () => new Date().toISOString().slice(0, 10)

  async function appendLessons(entry        )                              {
    if (!entry) return undefined
    try {
      await mkdir(dirs.lessons, { recursive: true })
      await appendFile(lessonsFile, entry, 'utf8')
      return undefined
    } catch (error) {
      return `Lessons not saved (${describe(error, lessonsFile)}).`
    }
  }

  async function listPlaybooks()                                            {
    let names          
    try {
      names = (await readdir(dirs.playbooks)).filter(n => n.endsWith('.md'))
    } catch (error) {
      if ((error                         ).code === 'ENOENT') return []
      throw error
    }
    const files = await Promise.all(names.map(async n => {
      try {
        return { name: n, text: (await readFile(join(dirs.playbooks, n), 'utf8')).slice(0, 64 * 1024) }
      } catch {
        return undefined
      }
    }))
    return files.filter((f)                                      => f !== undefined)
  }

  const has = (role      ) => config.role === role || config.role === 'all'
  const register = (tool                                          ) => {
    try {
      ctx.tools.register(tool)
    } catch (error) {
      throw new Error(`verdent-report (role ${config.role}): ${(error         ).message}. Mount each role once per scope.`)
    }
  }

  if (has('worker')) {
    register(defineTool({
      name: 'submit_worker_report_v1',
      description:
        'Submit your final report for a task. Call once, as your last action, then stop. '
        + 'status: "done" = every criterion met; "partial" = some not met; "blocked" = you need help (fill open_questions). '
        + 'Copy each criterion exactly as given. met:true needs evidence (command and result, or file:line).',
      parameters: {
        task_id: { type: 'string', required: true, description: 'Task id from the Manager, exactly.' },
        status: { type: 'string', required: true, enum: [...WORKER_STATUSES] },
        summary: { type: 'string', required: true, description: 'One sentence: what you did.' },
        criteria: { type: 'array', required: true, items: criterionItems, description: 'One entry per definition-of-done item.' },
        files_changed: stringList('Paths you created or edited.'),
        open_questions: stringList('Needed to continue. Required if blocked.'),
        lessons: stringList('Up to 3 short lessons.'),
        playbook_steps: stringList('Steps that worked, in order, reusable.'),
      },
      output: textOutput,
      execute: (args, exec) => guard(async () => {
        const { report, trimmed } = buildWorkerReport(args                                           , new Date(), Math.random)
        const warnings           = []
        // Lessons first, so a later failure cannot lose them.
        const lessonProblem = await appendLessons(lessonsEntry(today(), report.report_id, `worker, ${report.status}`, report.lessons))
        if (lessonProblem) warnings.push(lessonProblem)
        // A new report makes any older verdict for this task stale: archive it.
        const old = await readJson               (reportPath(report.task_id, 'verdict'))
        if (old.value || old.problem) {
          try {
            await retire(reportPath(report.task_id, 'verdict'), dirs.archive, 'verdict')
          } catch (error) {
            warnings.push(`Old verdict not archived (${describe(error, reportPath(report.task_id, 'verdict'))}).`)
          }
        }
        await mkdir(dirs.reports, { recursive: true })
        try {
          await atomicWrite(reportPath(report.task_id, 'worker'), JSON.stringify(report))
        } catch (error) {
          throw new StoreError(`Not saved: could not write ${describe(error, reportPath(report.task_id, 'worker'))}. Tell the Manager; do not retry more than once.`)
        }
        markReported(exec.agent, report.task_id)
        return renderWorkerSaved(report, trimmed, warnings)
      }),
      presentCall: args => ({ card: 'generic', title: `Report: ${String(args.task_id)} (${String(args.status)})`, kind: 'other', rawInput: args }),
    }))
    register(defineTool({
      name: 'read_playbook_v1',
      description: 'Read a saved playbook (steps that passed verification before) by the name the Manager gave you. Follow it only where it fits your task.',
      parameters: { name: { type: 'string', required: true, description: 'Playbook name from the Manager.' } },
      output: textOutput,
      execute: args => guard(async () => {
        const wanted = String(args.name).trim().replace(/\.md$/, '')
        const names = (await listPlaybooks()).map(f => f.name)
        const match = names.find(n => n === `${wanted}.md`)
        if (!match) throw new NotSaved(`no playbook named ${JSON.stringify(wanted)}`, 'Use the exact name from the Manager, or plan without it')
        return clip(await readFile(join(dirs.playbooks, match), 'utf8'), 4000)
      }),
    }))
  }

  if (has('verifier')) {
    register(defineTool({
      name: 'submit_verdict_v1',
      description:
        'Record your verdict after checking a Worker\'s task yourself. Call once, as your last action, then stop. '
        + 'Grade every definition-of-done criterion, copied exactly, with your own evidence. '
        + 'PASS only if every criterion passes; otherwise FAIL and say what is wrong in notes.',
      parameters: {
        task_id: { type: 'string', required: true, description: 'The task id you were asked to verify.' },
        verdict: { type: 'string', required: true, enum: [...VERDICTS] },
        criteria: { type: 'array', required: true, items: criterionItems, description: 'One entry per criterion; met means it passes.' },
        notes: { type: 'string', description: 'What is wrong. Required for a FAIL where every criterion passes.' },
      },
      output: textOutput,
      execute: (args, exec) => guard(async () => {
        const taskId = normalizeTaskId(String(args.task_id))
        const worker = await readJson              (reportPath(taskId, 'worker'))
        const report = worker.value
        const { verdict, trimmed } = buildVerdict(args                                      , report?.report_id ?? null, new Date())
        await mkdir(dirs.reports, { recursive: true })
        try {
          await atomicWrite(reportPath(taskId, 'verdict'), JSON.stringify(verdict))
        } catch (error) {
          throw new StoreError(`Not saved: could not write ${describe(error, reportPath(taskId, 'verdict'))}. Tell the Manager; do not retry more than once.`)
        }
        markReported(exec.agent, taskId)
        // Everything below is best effort: the verdict itself is saved.
        const notes           = []
        if (worker.problem) notes.push(`Worker report unreadable: ${worker.problem}.`)
        if (verdict.verdict === 'FAIL') {
          const failed = verdict.criteria.filter(c => !c.met).map(c => `FAIL ${c.criterion}: ${c.evidence || 'no evidence given'}`)
          const problem = await appendLessons(lessonsEntry(today(), report?.report_id ?? taskId, 'verifier, FAIL', [...failed, ...verdict.notes ? [`Verifier notes: ${verdict.notes}`] : []]))
          if (problem) notes.push(problem)
          if (report) {
            try {
              if (await retire(playbookPath(report.report_id), dirs.retired, 'failed')) notes.push('Its playbook was retired.')
            } catch (error) {
              notes.push(`Playbook not retired (${describe(error, playbookPath(report.report_id))}).`)
            }
          }
        } else if (!report) {
          notes.push(`No worker report for ${taskId}, so no playbook was saved.`)
        } else {
          const missing = ungradedCriteria(report, verdict)
          if (missing.length > 0) {
            notes.push(`Playbook not saved: ${missing.map(m => `"${clip(m, 80)}"`).join(', ')} not graded. Call again including ${missing.length === 1 ? 'it' : 'them'} to save.`)
          } else if (report.playbook_steps.length === 0) {
            notes.push('No playbook steps in the report, so no playbook was saved.')
          } else {
            try {
              await mkdir(dirs.playbooks, { recursive: true })
              await atomicWrite(playbookPath(report.report_id), playbookMarkdown(report, verdict))
              notes.push(`Playbook saved: ${report.report_id}.`)
            } catch (error) {
              notes.push(`Playbook not saved (${describe(error, playbookPath(report.report_id))}).`)
            }
          }
        }
        return renderVerdictSaved(verdict, trimmed, notes.join(' '))
      }),
      presentCall: args => ({ card: 'generic', title: `Verdict: ${String(args.task_id)} ${String(args.verdict)}`, kind: 'other', rawInput: args }),
    }))
  }

  if (has('manager')) {
    register(defineTool({
      name: 'read_task_report_v1',
      description: 'Check a task after its Worker or Verifier finishes: state, the criteria that need attention, open questions. Use instead of trusting a chat summary.',
      parameters: { task_id: { type: 'string', required: true, description: 'The task id.' } },
      output: textOutput,
      execute: args => guard(async () => {
        const taskId = normalizeTaskId(String(args.task_id))
        const w = await readJson              (reportPath(taskId, 'worker'))
        const v = await readJson               (reportPath(taskId, 'verdict'))
        const problems = [w.problem, v.problem].filter(Boolean).join(' ')
        const view = renderTaskView(taskId, w.value, v.value, { worker: reportPath(taskId, 'worker'), verdict: reportPath(taskId, 'verdict') })
        return problems ? `${view}\n${problems}` : view
      }),
    }))
    register(defineTool({
      name: 'find_playbooks_v1',
      description: 'Before planning a task that resembles earlier work, search playbooks that passed verification. Returns names only; pass the best name to the Worker. Skip for one-off questions.',
      parameters: { query: { type: 'string', required: true, description: 'A few keywords describing the task.' } },
      output: textOutput,
      execute: args => guard(async () => {
        const files = await listPlaybooks()
        const hits = rankPlaybooks(String(args.query), files)
        const metas = new Map                      (files.filter(f => hits.some(h => h.name === f.name)).map(f => [f.name, parsePlaybook(f.name, f.text)]))
        return renderPlaybookList(hits, metas)
      }),
    }))
    register(defineTool({
      name: 'recent_lessons_v1',
      description: 'Recent lessons from earlier tasks, including failures. Use before planning a task like earlier ones. Returns at most a few short lines.',
      parameters: { query: { type: 'string', description: 'Keywords to filter by; empty for the latest.' } },
      output: textOutput,
      execute: args => guard(async () => {
        let text = ''
        try {
          text = await readFile(lessonsFile, 'utf8')
        } catch (error) {
          if ((error                         ).code !== 'ENOENT') throw error
        }
        // Read only the newest part of the file: it can grow for years.
        const lines = text.slice(-200_000).split('\n').filter(l => l.startsWith('- '))
        const wanted = new Set(words(String(args.query ?? '')))
        const picked = (wanted.size === 0 ? lines : lines.filter(l => words(l).some(w => wanted.has(w)))).slice(-10).reverse()
        return renderLessons(picked.map(l => clip(l, 300)))
      }),
    }))
  }

  // ---- stop check -------------------------------------------------------------
  const reminderKind                           =
    config.role === 'worker' ? 'worker' : config.role === 'verifier' ? 'verifier' : config.role === 'all' ? 'either' : undefined
  if (reminderKind && config.maxReminders > 0) {
    let warnedNoPresets = false
    const appliesTo = (agent       )          => {
      if (config.requireReportPresets.length === 0) return true
      const presets = ctx.get('agentPresets')
      if (!presets) {
        if (!warnedNoPresets) ctx.logger.warn('verdent-report: requireReportPresets is set but no preset service is mounted; stop check is off')
        warnedNoPresets = true
        return false
      }
      const preset = presets.composedPreset((agent                               ).ctx)
      return preset !== undefined && config.requireReportPresets.includes(preset)
    }

    ctx.on('agent/pre-step', ({ agent, messages }, next)                           => {
      for (const m of messages) {
        if (!TASK_MESSAGE_KINDS.has(m.source.kind)) continue
        const taskId = taskIdInText(messageText(m))
        if (!taskId) continue
        // A new task: arm the check. A plain question (no task id) does not.
        stopStates.set(agent, { taskId, armed: true, done: false, reminders: 0, lastRemindedTurn: -1 })
      }
      return next()
    })

    ctx.on('agent/turn-stopping', ({ agent, turn }) => {
      const s = stopStates.get(agent)
      if (!s?.armed || s.done) return
      if (s.lastRemindedTurn === turn) return // another mount already reminded this turn
      if (s.reminders >= config.maxReminders) return
      if (!appliesTo(agent)) return
      s.reminders++
      s.lastRemindedTurn = turn
      agent.steer(createUserMessage({
        content: [{ type: 'text', text: missingReportReminder(reminderKind, s.reminders, config.maxReminders, s.taskId) }],
        source: { kind: 'verdent-report', form: 'notice', summary: `report reminder ${s.reminders}` },
      }))
    })
  }
}
