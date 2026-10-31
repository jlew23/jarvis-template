/**
 * Pure logic for the Verdent report plugin: normalising and trimming reports,
 * checking verdicts against the report they grade, naming files, rendering
 * short model-facing text, and ranking playbooks. No harness or Node imports,
 * so it can be tested with plain `node --test`.
 *
 * Design rules (from the squad review):
 * - Never make the model regenerate a long report: trim and record, then say
 *   what was not saved. Reject only what cannot be stored at all.
 * - Model-facing output stays small: the Manager sees counts and the lines
 *   that need a decision, not whole documents.
 */

export const WORKER_STATUSES = ['done', 'blocked', 'partial'] as const
export const VERDICTS = ['PASS', 'FAIL'] as const

export type WorkerStatus = typeof WORKER_STATUSES[number]
export type Verdict = typeof VERDICTS[number]

export const LIMITS = {
  summary: 300,
  evidence: 1000,
  notes: 2000,
  listItem: 400,
  listItems: 30,
  lessons: 5,
  criteria: 50,
  /** Fields longer than this many times their limit are refused outright. */
  refuseFactor: 10,
} as const

export interface CriterionResult {
  criterion: string
  met: boolean
  evidence: string
}

export interface WorkerReport {
  task_id: string
  /** Unique per submission: `<task_id>-<yyyymmddhhmmss>-<4 hex>`. */
  report_id: string
  reported_at: string
  status: WorkerStatus
  summary: string
  criteria: CriterionResult[]
  files_changed: string[]
  open_questions: string[]
  lessons: string[]
  playbook_steps: string[]
}

export interface VerdictReport {
  task_id: string
  /** The worker report this verdict graded, or null if there was none. */
  graded_report_id: string | null
  verdict: Verdict
  criteria: CriterionResult[]
  notes: string
  recorded_at: string
}

export interface WorkerReportArgs {
  task_id: string
  status: WorkerStatus
  summary: string
  criteria: CriterionResult[]
  files_changed?: string[]
  open_questions?: string[]
  lessons?: string[]
  playbook_steps?: string[]
}

export interface VerdictArgs {
  task_id: string
  verdict: Verdict
  criteria: CriterionResult[]
  notes?: string
}

/** A refusal the model can fix in one retry. */
export class NotSaved extends Error {
  constructor(problem: string, fix: string) {
    super(`Not saved: ${problem}. ${fix}. Call again.`)
    this.name = 'NotSaved'
  }
}

const TASK_ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/

export function normalizeTaskId(raw: string): string {
  const id = String(raw).trim().toLowerCase()
  if (!TASK_ID_RE.test(id)) {
    throw new NotSaved(`task_id ${JSON.stringify(raw)} is not valid`, 'Use the id from the Manager: 1 to 64 letters, digits, "-" or "_"')
  }
  return id
}

/** Collapse whitespace (including newlines) to single spaces. */
export function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/** Records what was trimmed so the reply can say so. */
export class Trimmer {
  readonly notes: string[] = []

  text(value: string, limit: number, field: string, collapse = false): string {
    const clean = collapse ? oneLine(value) : value.trim()
    if (clean.length > limit * LIMITS.refuseFactor) {
      throw new NotSaved(`${field} is ${clean.length} characters`, `Keep it under ${limit}`)
    }
    if (clean.length <= limit) return clean
    this.notes.push(`${field} cut to ${limit} chars`)
    return `${clean.slice(0, limit - 1)}…`
  }

  list(values: string[] | undefined, max: number, field: string): string[] {
    const items = (values ?? []).map(v => oneLine(String(v))).filter(v => v.length > 0)
    if (items.length > max) this.notes.push(`${field}: kept first ${max} of ${items.length}`)
    return items.slice(0, max).map((v, i) => this.text(v, LIMITS.listItem, `${field}[${i}]`, true))
  }
}

function cleanCriteria(values: CriterionResult[] | undefined, t: Trimmer): CriterionResult[] {
  const list = values ?? []
  if (list.length > LIMITS.criteria) {
    throw new NotSaved(`${list.length} criteria`, `Keep it to ${LIMITS.criteria} or fewer`)
  }
  const seen = new Set<string>()
  const out: CriterionResult[] = []
  list.forEach((item, i) => {
    const criterion = t.text(String(item?.criterion ?? ''), LIMITS.listItem, `criteria[${i}].criterion`, true)
    if (criterion.length === 0) throw new NotSaved(`criteria[${i}] has no criterion text`, 'Copy the criterion as given')
    const key = criterionKey(criterion)
    if (seen.has(key)) return // duplicate: keep the first
    seen.add(key)
    const met = item.met === true
    const evidence = t.text(String(item?.evidence ?? ''), LIMITS.evidence, `criteria[${i}].evidence`)
    if (met && evidence.length === 0) {
      throw new NotSaved(`criteria[${i}] is met:true with empty evidence`, 'Add proof or set met:false')
    }
    out.push({ criterion, met, evidence })
  })
  return out
}

/** Comparison key for criteria: case, spacing and punctuation do not matter. */
export function criterionKey(text: string): string {
  return text.toLowerCase().normalize('NFKC').replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
}

/** `<task_id>-<yyyymmddhhmmss>-<4 hex>` from a date and a random source. */
export function makeReportId(taskId: string, now: Date, rand: () => number): string {
  const stamp = now.toISOString().replace(/[-:T]/g, '').slice(0, 14)
  const hex = Math.floor(rand() * 0x10000).toString(16).padStart(4, '0')
  return `${taskId}-${stamp}-${hex}`
}

export function buildWorkerReport(args: WorkerReportArgs, now: Date, rand: () => number): { report: WorkerReport; trimmed: string[] } {
  const t = new Trimmer()
  const task_id = normalizeTaskId(args.task_id)
  const summary = t.text(String(args.summary ?? ''), LIMITS.summary, 'summary', true)
  if (summary.length === 0) throw new NotSaved('summary is empty', 'Add one sentence saying what you did')
  const criteria = cleanCriteria(args.criteria, t)
  let status = args.status
  const report: WorkerReport = {
    task_id,
    report_id: makeReportId(task_id, now, rand),
    reported_at: now.toISOString(),
    status,
    summary,
    criteria,
    files_changed: t.list(args.files_changed, LIMITS.listItems, 'files_changed'),
    open_questions: t.list(args.open_questions, LIMITS.listItems, 'open_questions'),
    lessons: t.list(args.lessons, LIMITS.lessons, 'lessons'),
    playbook_steps: t.list(args.playbook_steps, LIMITS.listItems, 'playbook_steps'),
  }
  if (status === 'done') {
    if (criteria.length === 0) throw new NotSaved('status "done" with no criteria', 'List each definition-of-done item with met and evidence')
    const unmet = criteria.filter(c => !c.met).length
    if (unmet > 0) {
      // Record it as partial instead of making the model redo the report.
      status = 'partial'
      report.status = 'partial'
      t.notes.push(`status changed to "partial": ${unmet} criteria not met`)
    }
  }
  if (status === 'blocked' && report.open_questions.length === 0) {
    throw new NotSaved('status "blocked" with no open_questions', 'Add what you need to continue')
  }
  return { report, trimmed: t.notes }
}

export function buildVerdict(args: VerdictArgs, gradedReportId: string | null, now: Date): { verdict: VerdictReport; trimmed: string[] } {
  const t = new Trimmer()
  const criteria = cleanCriteria(args.criteria, t)
  if (criteria.length === 0) throw new NotSaved('no criteria graded', 'Grade each definition-of-done item')
  const verdict: VerdictReport = {
    task_id: normalizeTaskId(args.task_id),
    graded_report_id: gradedReportId,
    verdict: args.verdict,
    criteria,
    notes: t.text(String(args.notes ?? ''), LIMITS.notes, 'notes'),
    recorded_at: now.toISOString(),
  }
  if (verdict.verdict === 'PASS') {
    const failed = criteria.filter(c => !c.met).length
    if (failed > 0) {
      verdict.verdict = 'FAIL'
      t.notes.push(`verdict changed to FAIL: ${failed} criteria do not pass`)
    }
  }
  if (verdict.verdict === 'FAIL' && verdict.notes.length === 0 && criteria.every(c => c.met)) {
    throw new NotSaved('FAIL with every criterion passing and no notes', 'Say in notes what is wrong, or use PASS')
  }
  return { verdict, trimmed: t.notes }
}

/** Worker criteria the verdict did not grade (matched by criterionKey). */
export function ungradedCriteria(report: WorkerReport, verdict: VerdictReport): string[] {
  const graded = new Set(verdict.criteria.map(c => criterionKey(c.criterion)))
  return report.criteria.filter(c => !graded.has(criterionKey(c.criterion))).map(c => c.criterion)
}

/** Lessons inbox entry. Lessons are one line each, so they cannot forge headers. */
export function lessonsEntry(date: string, reportId: string, source: string, lines: string[]): string {
  const items = lines.map(oneLine).filter(l => l.length > 0)
  if (items.length === 0) return ''
  return `\n## ${date} ${reportId} (${oneLine(source)})\n${items.map(l => `- ${l}`).join('\n')}\n`
}

export function playbookMarkdown(report: WorkerReport, verdict: VerdictReport): string {
  const criteria = verdict.criteria.map(c => `- ${c.criterion}`).join('\n')
  const steps = report.playbook_steps.map((s, i) => `${i + 1}. ${s}`).join('\n')
  const lessons = report.lessons.length > 0 ? `\n## Lessons\n${report.lessons.map(l => `- ${l}`).join('\n')}\n` : ''
  return `# ${report.summary}\n\nReport ${report.report_id}, verified PASS ${verdict.recorded_at.slice(0, 10)}.\n\n## Done means\n${criteria}\n\n## Steps that worked\n${steps}\n${lessons}`
}

/** What find_playbooks needs from a playbook file. */
export interface PlaybookMeta {
  name: string
  title: string
  steps: number
  doneMeans: string[]
  text: string
}

export function parsePlaybook(name: string, text: string): PlaybookMeta {
  const lines = text.split('\n')
  const title = (lines.find(l => l.startsWith('# ')) ?? `# ${name}`).slice(2).trim()
  let section = ''
  let steps = 0
  const doneMeans: string[] = []
  for (const line of lines) {
    if (line.startsWith('## ')) section = line.slice(3).trim().toLowerCase()
    else if (section === 'steps that worked' && /^\d+\.\s/.test(line)) steps++
    else if (section === 'done means' && line.startsWith('- ')) doneMeans.push(line.slice(2).trim())
  }
  return { name, title, steps, doneMeans, text }
}

const STOP_WORDS = new Set(['the', 'and', 'for', 'with', 'that', 'this', 'from', 'into', 'are', 'was', 'not', 'but', 'you', 'all', 'any', 'can', 'its', 'our', 'out', 'has', 'have', 'then', 'than', 'of', 'to', 'in', 'on', 'at', 'by', 'or', 'an', 'is', 'it', 'be', 'as', 'do', 'if', 'so', 'we'])

const HAN_KANA = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u

/**
 * Keyword tokens: Unicode letters and digits; 2+ chars (digits of any length);
 * a small English stop list; trailing "s" folded (shots -> shot); Chinese and
 * Japanese runs split into overlapping pairs, since they have no spaces.
 */
export function words(text: string): string[] {
  const out: string[] = []
  for (const raw of text.toLowerCase().normalize('NFKC').match(/[\p{L}\p{N}]+/gu) ?? []) {
    if (HAN_KANA.test(raw)) {
      const chars = [...raw]
      if (chars.length === 1) out.push(raw)
      for (let i = 0; i + 1 < chars.length; i++) out.push(chars[i]! + chars[i + 1]!)
      continue
    }
    if (STOP_WORDS.has(raw)) continue
    if (raw.length < 2 && !/^\d+$/.test(raw)) continue
    out.push(raw.length > 3 && raw.endsWith('s') && !raw.endsWith('ss') ? raw.slice(0, -1) : raw)
  }
  return out
}

export interface PlaybookHit {
  name: string
  score: number
}

/**
 * Rank playbooks by keyword overlap. Title words count 3, body words 1.
 * Weak hits are dropped (score < 3, or under half the best score) because a
 * wrong playbook is followed faithfully by a cheap model. Ties go to the
 * newest file (names start with the report id, which embeds a timestamp).
 */
export function rankPlaybooks(query: string, files: { name: string; text: string }[], limit = 3): PlaybookHit[] {
  const wanted = new Set(words(query))
  if (wanted.size === 0) return []
  const hits: PlaybookHit[] = []
  for (const file of files) {
    const meta = parsePlaybook(file.name, file.text)
    const titleWords = new Set(words(meta.title))
    const bodyWords = new Set(words(file.text))
    let score = 0
    for (const w of wanted) {
      if (titleWords.has(w)) score += 3
      else if (bodyWords.has(w)) score += 1
    }
    if (score > 0) hits.push({ name: file.name, score })
  }
  hits.sort((a, b) => b.score - a.score || stampOf(b.name).localeCompare(stampOf(a.name)) || a.name.localeCompare(b.name))
  const top = hits[0]?.score ?? 0
  return hits.filter(h => h.score >= 3 && h.score * 2 >= top).slice(0, limit)
}

function stampOf(name: string): string {
  return name.match(/-(\d{14})-[0-9a-f]{4}\.md$/)?.[1] ?? ''
}

export function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`
}

// ---- model-facing text ------------------------------------------------------

function trimmedNote(trimmed: string[]): string {
  return trimmed.length > 0 ? ` Trimmed: ${trimmed.join('; ')}.` : ''
}

export function renderWorkerSaved(report: WorkerReport, trimmed: string[], warnings: string[]): string {
  const met = report.criteria.filter(c => c.met).length
  return `Saved: ${report.task_id} ${report.status}, ${met}/${report.criteria.length} met.${trimmedNote(trimmed)}`
    + (warnings.length > 0 ? ` ${warnings.join(' ')}` : '')
    + ' You are done: end with one line, no repeat summary.'
}

export function renderVerdictSaved(verdict: VerdictReport, trimmed: string[], outcome: string): string {
  const met = verdict.criteria.filter(c => c.met).length
  return `Saved: ${verdict.task_id} ${verdict.verdict}, ${met}/${verdict.criteria.length} pass.${trimmedNote(trimmed)} ${outcome}`
    + ' You are done: end with one line, no repeat summary.'
}

/**
 * Compact task view for the Manager: one State line that says what to decide,
 * only the criteria that need attention, and where the full record is.
 */
export function renderTaskView(
  taskId: string,
  report: WorkerReport | undefined,
  verdict: VerdictReport | undefined,
  paths: { worker: string; verdict: string },
  max = 2000,
): string {
  if (!report && !verdict) return `No report saved for ${taskId}.`
  const lines: string[] = []
  const current = verdict !== undefined && (report === undefined || verdict.graded_report_id === report.report_id)
  const v = current ? verdict : undefined
  const wMet = report ? report.criteria.filter(c => c.met).length : 0
  const vMet = v ? v.criteria.filter(c => c.met).length : 0
  const head = [
    report ? `worker ${report.status} (${wMet}/${report.criteria.length} met)` : 'no worker report',
    v ? `verifier ${v.verdict} (${vMet}/${v.criteria.length})` : 'not verified',
  ]
  const state = !report ? 'verdict without a worker report'
    : !v ? (verdict ? 'not verified (the saved verdict is for an older report)' : report.status === 'blocked' ? 'blocked, needs an answer' : 'not verified yet')
      : v.verdict === 'PASS' ? 'PASS' : 'failed verification'
  lines.push(`Task ${taskId}: ${head.join(', ')}. State: ${state}.`)
  if (report) {
    const vByKey = new Map((v?.criteria ?? []).map(c => [criterionKey(c.criterion), c]))
    const attention: string[] = []
    for (const c of report.criteria) {
      const g = vByKey.get(criterionKey(c.criterion))
      if (c.met && g?.met === true) continue
      const wPart = c.met ? 'worker met' : 'worker not met'
      const vPart = !v ? '' : !g ? '; verifier did not grade' : g.met ? '; verifier met' : `; verifier not: ${clip(oneLine(g.evidence || 'no evidence'), 200)}`
      const ev = !c.met ? `: ${clip(oneLine(c.evidence || 'no evidence'), 200)}` : ''
      attention.push(`- "${c.criterion}": ${wPart}${ev}${vPart}`)
    }
    if (attention.length > 0) lines.push('Not met or disputed:', ...attention)
    if (report.open_questions.length > 0) lines.push(`Open questions: ${report.open_questions.join('; ')}`)
    if (report.files_changed.length > 0) lines.push(`Files: ${report.files_changed.join(', ')}`)
  }
  if (v?.notes) lines.push(`Verifier notes: ${clip(oneLine(v.notes), 300)}`)
  const tail = `JSON: ${paths.worker}${verdict ? `, ${paths.verdict}` : ''}`
  let body = lines.join('\n')
  if (body.length + tail.length + 1 > max) body = `${body.slice(0, max - tail.length - 16)}… (cut)`
  return `${body}\n${tail}`
}

export function renderPlaybookList(hits: PlaybookHit[], metas: Map<string, PlaybookMeta>): string {
  if (hits.length === 0) return 'No close playbook matches. Plan from scratch.'
  const lines = [`${hits.length} close match${hits.length === 1 ? '' : 'es'}:`]
  hits.forEach((h, i) => {
    const m = metas.get(h.name)!
    const done = m.doneMeans.length > 0 ? ` Done means: ${clip(m.doneMeans.join('; '), 160)}.` : ''
    lines.push(`${i + 1}. ${h.name.replace(/\.md$/, '')} (score ${h.score}) "${clip(m.title, 120)}", ${m.steps} steps.${done}`)
  })
  lines.push('Give the Worker the name; it reads it with read_playbook_v1.')
  return lines.join('\n')
}

export function renderLessons(entries: string[], max = 1500): string {
  if (entries.length === 0) return 'No matching lessons.'
  let out = ''
  for (const e of entries) {
    if (out.length + e.length + 1 > max) break
    out += `${e}\n`
  }
  return out.trimEnd()
}

export type ReminderKind = 'worker' | 'verifier' | 'either'

export function missingReportReminder(kind: ReminderKind, attempt: number, max: number, taskId: string | undefined): string {
  const task = taskId ? ` for ${taskId}` : ''
  const n = `(${attempt}/${max})`
  if (kind === 'worker') {
    return `You have not called submit_worker_report_v1${task}. Call it now with what you already found; do not redo work. Unfinished: "partial". Need help: "blocked" + open_questions. ${n}`
  }
  if (kind === 'verifier') {
    return `You have not called submit_verdict_v1${task}. Call it now with the checks you already ran; anything unchecked counts as not met. ${n}`
  }
  return `You have not reported${task}. Worker: call submit_worker_report_v1. Verifier: call submit_verdict_v1. Use what you already have; do not redo work. ${n}`
}

/** Task id named in a message, if any: `task_id: x`, `task id = x` or `task-id x`. */
export function taskIdInText(text: string): string | undefined {
  const m = text.match(/\btask[ _-]?id\s*[:=]?\s*[`"']?([A-Za-z0-9][A-Za-z0-9_-]{0,63})/i)
  return m ? m[1]!.toLowerCase() : undefined
}
