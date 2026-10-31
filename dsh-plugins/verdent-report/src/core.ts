/**
 * Pure logic for the Verdent report plugin: validation, file naming, markdown
 * formatting and playbook search. No harness or Node imports, so it can be
 * tested with plain `node --test`.
 */

export const WORKER_STATUSES = ['done', 'blocked', 'partial'] as const
export const VERDICTS = ['PASS', 'FAIL'] as const

export type WorkerStatus = typeof WORKER_STATUSES[number]
export type Verdict = typeof VERDICTS[number]

export interface CriterionResult {
  criterion: string
  met: boolean
  evidence: string
}

export interface WorkerReport {
  task_id: string
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
  verdict: Verdict
  criteria: CriterionResult[]
  notes: string
}

/** Raw tool arguments: optional arrays may be missing. */
export type WorkerReportArgs = Omit<WorkerReport, 'files_changed' | 'open_questions' | 'lessons' | 'playbook_steps'>
  & Partial<Pick<WorkerReport, 'files_changed' | 'open_questions' | 'lessons' | 'playbook_steps'>>
export type VerdictArgs = Omit<VerdictReport, 'notes'> & { notes?: string }

const TASK_ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/

/**
 * Normalise and check a task id. Ids become file names, so only lowercase
 * letters, digits, `-` and `_` are allowed.
 */
export function normalizeTaskId(raw: string): string {
  const id = raw.trim().toLowerCase()
  if (!TASK_ID_RE.test(id)) {
    throw new Error(
      `invalid task_id ${JSON.stringify(raw)}: use 1 to 64 lowercase letters, digits, "-" or "_", starting with a letter or digit`,
    )
  }
  return id
}

function cleanList(values: string[] | undefined, field: string): string[] {
  const out: string[] = []
  for (const value of values ?? []) {
    const text = value.trim()
    if (text.length === 0) throw new Error(`${field}: entries must not be empty`)
    out.push(text)
  }
  return out
}

function cleanCriteria(values: CriterionResult[], field: string): CriterionResult[] {
  const seen = new Set<string>()
  return values.map((item, index) => {
    const criterion = item.criterion.trim()
    const evidence = item.evidence.trim()
    if (criterion.length === 0) throw new Error(`${field}[${index}].criterion must not be empty`)
    if (seen.has(criterion)) throw new Error(`${field}: duplicate criterion ${JSON.stringify(criterion)}`)
    seen.add(criterion)
    if (item.met && evidence.length === 0) {
      throw new Error(`${field}[${index}] is marked met but has no evidence; say what you ran or read that proves it`)
    }
    return { criterion, met: item.met, evidence }
  })
}

/** Validate a Worker report beyond what the JSON schema can express. */
export function validateWorkerReport(args: WorkerReportArgs): WorkerReport {
  const summary = args.summary.trim()
  if (summary.length === 0) throw new Error('summary must not be empty')
  const criteria = cleanCriteria(args.criteria, 'criteria')
  const report: WorkerReport = {
    task_id: normalizeTaskId(args.task_id),
    status: args.status,
    summary,
    criteria,
    files_changed: cleanList(args.files_changed, 'files_changed'),
    open_questions: cleanList(args.open_questions, 'open_questions'),
    lessons: cleanList(args.lessons, 'lessons'),
    playbook_steps: cleanList(args.playbook_steps, 'playbook_steps'),
  }
  if (report.status === 'done') {
    if (criteria.length === 0) {
      throw new Error('status "done" needs at least one criterion; list the definition-of-done items you were given')
    }
    const unmet = criteria.filter(c => !c.met).map(c => c.criterion)
    if (unmet.length > 0) {
      throw new Error(`status "done" but these criteria are not met: ${unmet.join('; ')}. Use "partial" or finish them`)
    }
  }
  if (report.status === 'blocked' && report.open_questions.length === 0) {
    throw new Error('status "blocked" needs at least one open_questions entry saying what you need to continue')
  }
  return report
}

/** Validate a Verifier verdict beyond what the JSON schema can express. */
export function validateVerdict(args: VerdictArgs): VerdictReport {
  const criteria = cleanCriteria(args.criteria, 'criteria')
  if (criteria.length === 0) throw new Error('a verdict must grade at least one criterion')
  const verdict: VerdictReport = {
    task_id: normalizeTaskId(args.task_id),
    verdict: args.verdict,
    criteria,
    notes: (args.notes ?? '').trim(),
  }
  if (verdict.verdict === 'PASS') {
    const failed = criteria.filter(c => !c.met).map(c => c.criterion)
    if (failed.length > 0) throw new Error(`PASS is not allowed while criteria fail: ${failed.join('; ')}`)
  }
  if (verdict.verdict === 'FAIL' && verdict.notes.length === 0 && criteria.every(c => c.met)) {
    throw new Error('FAIL with every criterion met needs notes explaining what is wrong')
  }
  return verdict
}

/** Short file-name slug from free text. */
export function slugify(text: string, max = 48): string {
  const slug = text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return (slug.slice(0, max).replace(/-+$/g, '')) || 'untitled'
}

/** Markdown block appended to the lessons inbox. */
export function lessonsEntry(date: string, taskId: string, source: string, lines: string[]): string {
  if (lines.length === 0) return ''
  return `\n## ${date} ${taskId} (${source})\n${lines.map(l => `- ${l}`).join('\n')}\n`
}

/** Playbook markdown saved after a PASS. */
export function playbookMarkdown(report: WorkerReport, verdict: VerdictReport, date: string): string {
  const criteria = verdict.criteria.map(c => `- ${c.criterion}`).join('\n')
  const steps = report.playbook_steps.map((s, i) => `${i + 1}. ${s}`).join('\n')
  const lessons = report.lessons.length > 0 ? `\n## Lessons\n${report.lessons.map(l => `- ${l}`).join('\n')}\n` : ''
  return `# ${report.summary}\n\nTask: ${report.task_id}. Verified PASS on ${date}.\n\n## Done means\n${criteria}\n\n## Steps that worked\n${steps}\n${lessons}`
}

function words(text: string): string[] {
  return text.toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 2)
}

export interface PlaybookHit {
  name: string
  score: number
}

/**
 * Rank playbooks by keyword overlap with the query. Title words (first line)
 * count three times. Plain scoring keeps it dependency-free.
 */
export function rankPlaybooks(query: string, files: { name: string; text: string }[], limit = 3): PlaybookHit[] {
  const wanted = new Set(words(query))
  if (wanted.size === 0) return []
  const hits: PlaybookHit[] = []
  for (const file of files) {
    const [title = '', ...rest] = file.text.split('\n')
    const titleWords = new Set(words(title + ' ' + file.name))
    const bodyWords = new Set(words(rest.join('\n')))
    let score = 0
    for (const w of wanted) {
      if (titleWords.has(w)) score += 3
      else if (bodyWords.has(w)) score += 1
    }
    if (score > 0) hits.push({ name: file.name, score })
  }
  return hits.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name)).slice(0, limit)
}

/** One-paragraph text the model sees after a report is accepted. */
export function renderWorkerReport(report: WorkerReport): string {
  const met = report.criteria.filter(c => c.met).length
  return `Report accepted for task ${report.task_id}: ${report.status}, ${met}/${report.criteria.length} criteria met.`
    + (report.open_questions.length > 0 ? ` Open questions: ${report.open_questions.join('; ')}.` : '')
}

export function renderVerdict(verdict: VerdictReport): string {
  const met = verdict.criteria.filter(c => c.met).length
  return `Verdict recorded for task ${verdict.task_id}: ${verdict.verdict}, ${met}/${verdict.criteria.length} criteria pass.`
    + (verdict.notes.length > 0 ? ` Notes: ${verdict.notes}` : '')
}

/** Reminder steered into an agent that tries to stop without its report. */
export function missingReportReminder(kind: 'worker' | 'verifier', attempt: number, max: number): string {
  const tool = kind === 'worker' ? 'submit_worker_report_v1' : 'submit_verdict_v1'
  return `You are about to finish without calling ${tool}. Call it now with your results `
    + `(reminder ${attempt} of ${max}). If you could not finish, report status "${kind === 'worker' ? 'partial' : 'FAIL'}" `
    + 'and say what is left.'
}
