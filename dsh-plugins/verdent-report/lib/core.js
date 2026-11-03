// Generated from src/core.ts by build.mjs. Do not edit.
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

export const WORKER_STATUSES = ['done', 'blocked', 'partial']         
export const VERDICTS = ['PASS', 'FAIL']         

                                                         
                                             

export const LIMITS = {
  summary: 300,
  evidence: 1000,
  notes: 2000,
  listItem: 400,
  listItems: 30,
  lessons: 3,
  criteria: 50,
}         

                                  
                   
              
                  
 

                               
                 
                                                                     
                   
                     
                      
                 
                             
                         
                          
                   
                          
 

                                
                 
                                                                          
                                 
                  
                             
               
                     
 

                                   
                 
                      
                 
                             
                          
                           
                    
                           
 

                              
                 
                  
                             
                
 

/** A refusal the model can fix in one retry. */
export class NotSaved extends Error {
  constructor(problem        , fix        ) {
    super(`Not saved: ${problem}. ${fix}. Call again.`)
    this.name = 'NotSaved'
  }
}

const TASK_ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/

export function normalizeTaskId(raw        )         {
  const id = String(raw).trim().toLowerCase()
  if (!TASK_ID_RE.test(id)) {
    throw new NotSaved(`task_id ${describeInput(String(raw))} is not valid`, 'Use the id from the Manager: 1 to 64 letters, digits, "-" or "_"')
  }
  return id
}

/** Describe model input in an error without echoing it in full. */
export function describeInput(text        )         {
  return text.length <= 40 ? JSON.stringify(text) : `${JSON.stringify(text.slice(0, 40))}... (${text.length} chars)`
}

/** Collapse whitespace (including newlines) to single spaces. */
export function oneLine(text        )         {
  return text.replace(/\s+/g, ' ').trim()
}

/** Records what was trimmed so the reply can say so. */
export class Trimmer {
  /** Fields that were cut or dropped. */
           notes           = []
  /** Changes to the meaning of the report (status or verdict changed, criteria merged). */
           changes           = []

  text(value        , limit        , field        , collapse = false)         {
    const clean = collapse ? oneLine(value) : value.trim()
    if (clean.length <= limit) return clean
    this.notes.push(`${field} cut to ${limit} chars`)
    return `${clean.slice(0, limit - 1)}…`
  }

  list(values                      , max        , field        )           {
    const items = (values ?? []).map(v => oneLine(String(v))).filter(v => v.length > 0)
    if (items.length > max) this.notes.push(`${field}: kept first ${max} of ${items.length}`)
    return items.slice(0, max).map((v, i) => this.text(v, LIMITS.listItem, `${field}[${i}]`, true))
  }
}

function cleanCriteria(values                               , t         )                    {
  let list = values ?? []
  if (list.length > LIMITS.criteria) {
    t.notes.push(`criteria: kept first ${LIMITS.criteria} of ${list.length}`)
    list = list.slice(0, LIMITS.criteria)
  }
  const byKey = new Map                ()
  const out                    = []
  list.forEach((item, i) => {
    const criterion = t.text(String(item?.criterion ?? ''), LIMITS.listItem, `criteria[${i}].criterion`, true)
    if (criterion.length === 0) throw new NotSaved(`criteria[${i}] has no criterion text`, 'Copy the criterion as given')
    const met = item.met === true
    const evidence = t.text(String(item?.evidence ?? ''), LIMITS.evidence, `criteria[${i}].evidence`)
    if (met && evidence.length === 0) {
      throw new NotSaved(`criteria[${i}] is met:true with empty evidence`, 'Add proof or set met:false')
    }
    const key = criterionKey(criterion)
    const prev = byKey.get(key)
    if (prev !== undefined) {
      // Same criterion twice. Never let a pass hide a failure: keep the not-met one.
      const first = out[prev] 
      if (first.met !== met) {
        if (first.met) out[prev] = { criterion: first.criterion, met: false, evidence }
        t.changes.push(`"${clip(criterion, 60)}" was listed twice with different results; kept as not met`)
      } else {
        t.notes.push(`criteria[${i}] duplicates "${clip(first.criterion, 60)}"`)
      }
      return
    }
    byKey.set(key, out.length)
    out.push({ criterion, met, evidence })
  })
  return out
}

/** Comparison key for criteria: case, spacing and punctuation do not matter. */
export function criterionKey(text        )         {
  return text.toLowerCase().normalize('NFKC').replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
}

/** `<task_id>-<yyyymmddhhmmss>-<8 hex>` from a date and a random source. */
export function makeReportId(taskId        , now      , rand              )         {
  const stamp = now.toISOString().replace(/[-:T]/g, '').slice(0, 14)
  const hex = Math.floor(rand() * 0x10000).toString(16).padStart(4, '0') + Math.floor(rand() * 0x10000).toString(16).padStart(4, '0')
  return `${taskId}-${stamp}-${hex}`
}

export function buildWorkerReport(args                  , now      , rand              )                                                                 {
  const t = new Trimmer()
  const task_id = normalizeTaskId(args.task_id)
  const summary = t.text(String(args.summary ?? ''), LIMITS.summary, 'summary', true)
  if (summary.length === 0) throw new NotSaved('summary is empty', 'Add one sentence saying what you did')
  const criteria = cleanCriteria(args.criteria, t)
  let status = args.status
  const report               = {
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
      t.changes.push(`recorded as "partial": ${unmet} criteria not met`)
    }
  }
  if (status === 'blocked' && report.open_questions.length === 0) {
    throw new NotSaved('status "blocked" with no open_questions', 'Add what you need to continue')
  }
  return { report, trimmed: t.notes, changes: t.changes }
}

export function buildVerdict(args             , gradedReportId               , now      )                                                                   {
  const t = new Trimmer()
  const criteria = cleanCriteria(args.criteria, t)
  if (criteria.length === 0) throw new NotSaved('no criteria graded', 'Grade each definition-of-done item')
  const verdict                = {
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
      t.changes.push(`recorded as FAIL: ${failed} criteria do not pass`)
    }
  }
  if (verdict.verdict === 'FAIL' && verdict.notes.length === 0 && criteria.every(c => c.met)) {
    throw new NotSaved('FAIL with every criterion passing and no notes', 'Say in notes what is wrong, or use PASS')
  }
  return { verdict, trimmed: t.notes, changes: t.changes }
}

/** Worker criteria the verdict did not grade (matched by criterionKey). */
export function ungradedCriteria(report              , verdict               )           {
  const graded = new Set(verdict.criteria.map(c => criterionKey(c.criterion)))
  return report.criteria.filter(c => !graded.has(criterionKey(c.criterion))).map(c => c.criterion)
}

/** Lessons inbox entry. Lessons are one line each, so they cannot forge headers. */
export function lessonsEntry(date        , reportId        , source        , lines          )         {
  const items = lines.map(oneLine).filter(l => l.length > 0)
  if (items.length === 0) return ''
  return `\n## ${date} ${reportId} (${oneLine(source)})\n${items.map(l => `- ${l}`).join('\n')}\n`
}

export function playbookMarkdown(report              , verdict               )         {
  const criteria = verdict.criteria.map(c => `- ${c.criterion}`).join('\n')
  const steps = report.playbook_steps.map((s, i) => `${i + 1}. ${s}`).join('\n')
  const lessons = report.lessons.length > 0 ? `\n## Lessons\n${report.lessons.map(l => `- ${l}`).join('\n')}\n` : ''
  return `# ${report.summary}\n\nReport ${report.report_id}, verified PASS ${verdict.recorded_at.slice(0, 10)}.\n\n## Done means\n${criteria}\n\n## Steps that worked\n${steps}\n${lessons}`
}

/** What find_playbooks needs from a playbook file. */
                               
              
               
               
                     
              
 

export function parsePlaybook(name        , text        )               {
  const lines = text.split('\n')
  const title = (lines.find(l => l.startsWith('# ')) ?? `# ${name}`).slice(2).trim()
  let section = ''
  let steps = 0
  const doneMeans           = []
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
export function words(text        )           {
  const out           = []
  for (const raw of text.toLowerCase().normalize('NFKC').match(/[\p{L}\p{N}]+/gu) ?? []) {
    // Split mixed tokens such as "Unreal渲染" into their Latin and CJK parts.
    for (const part of raw.match(SCRIPT_RUN) ?? []) {
      if (HAN_KANA.test(part)) {
        const chars = [...part]
        if (chars.length === 1) out.push(part)
        for (let i = 0; i + 1 < chars.length; i++) out.push(chars[i]  + chars[i + 1] )
        continue
      }
      if (STOP_WORDS.has(part)) continue
      if (part.length < 2 && !/^\d+$/.test(part)) continue
      out.push(part.length > 3 && part.endsWith('s') && !part.endsWith('ss') ? part.slice(0, -1) : part)
    }
  }
  return out
}

const SCRIPT_RUN = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]+|[^\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]+/gu

/** A playbook prepared for ranking, so a search needn't re-read or re-tokenize files. */
                                  
                    
                         
                        
 

export function indexPlaybook(name        , text        )                  {
  const meta = parsePlaybook(name, text)
  return { meta: { ...meta, text: '' }, titleWords: new Set(words(meta.title)), bodyWords: new Set(words(text)) }
}

                              
              
               
 

/**
 * Rank playbooks by keyword overlap. Title words count 3, body words 1.
 * Weak hits are dropped (score < 3, or under half the best score) because a
 * wrong playbook is followed faithfully by a cheap model. Ties go to the
 * newest file (names start with the report id, which embeds a timestamp).
 */
export function rankPlaybooks(query        , files                                                      , limit = 3)                {
  const wanted = new Set(words(query))
  if (wanted.size === 0) return []
  const hits                = []
  for (const file of files) {
    const entry = 'meta' in file ? file : indexPlaybook(file.name, file.text)
    let score = 0
    for (const w of wanted) {
      if (entry.titleWords.has(w)) score += 3
      else if (entry.bodyWords.has(w)) score += 1
    }
    if (score > 0) hits.push({ name: entry.meta.name, score })
  }
  hits.sort((a, b) => b.score - a.score || stampOf(b.name).localeCompare(stampOf(a.name)) || a.name.localeCompare(b.name))
  const top = hits[0]?.score ?? 0
  return hits.filter(h => h.score >= 3 && h.score * 2 >= top).slice(0, limit)
}

function stampOf(name        )         {
  return name.match(/-(\d{14})-[0-9a-f]{4,8}\.md$/)?.[1] ?? ''
}

export function clip(text        , max        )         {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`
}

// ---- model-facing text ------------------------------------------------------

/** Short list: the first few items, then a count. */
export function shortList(items          , show = 3)         {
  if (items.length <= show) return items.join('; ')
  return `${items.slice(0, show).join('; ')}; and ${items.length - show} more`
}

function notesText(trimmed          , changes          )         {
  const parts           = []
  if (changes.length > 0) parts.push(` ${shortList(changes)}.`)
  if (trimmed.length > 0) parts.push(` Trimmed ${trimmed.length} field${trimmed.length === 1 ? '' : 's'}: ${shortList(trimmed)}.`)
  return parts.join('')
}

const DONE = ' You are done: end with one line, no repeat summary.'

export function renderWorkerSaved(report              , trimmed          , warnings          , changes           = [])         {
  const met = report.criteria.filter(c => c.met).length
  return `Saved: ${report.task_id} ${report.status}, ${met}/${report.criteria.length} met.${notesText(trimmed, changes)}`
    + (warnings.length > 0 ? ` ${warnings.join(' ')}` : '') + DONE
}

export function renderVerdictSaved(verdict               , trimmed          , outcome        , changes           = [])         {
  const met = verdict.criteria.filter(c => c.met).length
  return `Saved: ${verdict.task_id} ${verdict.verdict}, ${met}/${verdict.criteria.length} pass.${notesText(trimmed, changes)} ${outcome}`.trimEnd() + DONE
}

/**
 * Compact task view for the Manager: one State line that says what to decide,
 * only the criteria that need attention, and where the full record is.
 */
export function renderTaskView(
  taskId        ,
  report                          ,
  verdict                           ,
  paths                                     ,
  max = 2000,
)         {
  if (!report && !verdict) return `No report saved for ${taskId}.`
  const current = verdict !== undefined && (report === undefined || verdict.graded_report_id === report.report_id)
  const v = current ? verdict : undefined
  const wMet = report ? report.criteria.filter(c => c.met).length : 0
  const vMet = v ? v.criteria.filter(c => c.met).length : 0
  const ungraded = report && v ? ungradedCriteria(report, v).length : 0
  const head = [
    report ? `worker ${report.status} (${wMet}/${report.criteria.length} met)` : 'no worker report',
    v ? `verifier ${v.verdict} (${vMet}/${v.criteria.length})` : 'not verified',
  ]
  const state = !report ? 'verdict without a worker report'
    : !v ? (verdict ? 'not verified (the saved verdict is for an older report)' : report.status === 'blocked' ? 'blocked, needs an answer' : 'not verified yet')
      : v.verdict === 'PASS' ? (ungraded > 0 ? `PASS, but ${ungraded} worker criteria were not graded (no playbook saved)` : 'PASS')
        : 'failed verification'
  // Most decision-relevant first: state, questions, notes, then the criteria.
  const lines           = [`Task ${taskId}: ${head.join(', ')}. State: ${state}.`]
  if (report?.open_questions.length) lines.push(`Open questions: ${clip(report.open_questions.join('; '), 400)}`)
  if (v?.notes) lines.push(`Verifier notes: ${clip(oneLine(v.notes), 300)}`)
  if (report?.files_changed.length) lines.push(`Files: ${clip(report.files_changed.join(', '), 200)}`)
  if (report) {
    const vByKey = new Map((v?.criteria ?? []).map(c => [criterionKey(c.criterion), c]))
    const attention           = []
    for (const c of report.criteria) {
      const g = vByKey.get(criterionKey(c.criterion))
      if (c.met && g?.met === true) continue
      const wPart = c.met ? 'worker met' : `worker not met: ${clip(oneLine(c.evidence || 'no evidence'), 100)}`
      const vPart = !v ? '' : !g ? '; verifier did not grade' : g.met ? '; verifier met' : `; verifier not: ${clip(oneLine(g.evidence || 'no evidence'), 100)}`
      attention.push(`- "${clip(c.criterion, 120)}": ${wPart}${vPart}`)
    }
    if (attention.length > 0) {
      lines.push('Not met or disputed:', ...attention.slice(0, 3))
      if (attention.length > 3) lines.push(`+${attention.length - 3} more not met or disputed (see JSON).`)
    }
  }
  const tail = `JSON: ${clip(paths.worker, 300)}${verdict ? `, ${clip(paths.verdict, 300)}` : ''}`
  const body = lines.join('\n')
  const room = Math.max(0, max - tail.length - 1)
  return `${body.length > room ? `${body.slice(0, Math.max(0, room - 8))}… (cut)` : body}\n${tail}`
}

export function renderPlaybookList(hits               , metas                           )         {
  if (hits.length === 0) return 'No close playbook matches. Plan from scratch.'
  const lines = [`${hits.length} close match${hits.length === 1 ? '' : 'es'}:`]
  hits.forEach((h, i) => {
    const m = metas.get(h.name) 
    const done = m.doneMeans.length > 0 ? ` Done means: ${clip(m.doneMeans.join('; '), 160)}.` : ''
    lines.push(`${i + 1}. ${h.name.replace(/\.md$/, '')} (score ${h.score}) "${clip(m.title, 120)}", ${m.steps} steps.${done}`)
  })
  lines.push('Give the Worker the name; it reads it with read_playbook_v1.')
  return lines.join('\n')
}

export function renderLessons(entries          , max = 1500)         {
  if (entries.length === 0) return 'No matching lessons.'
  let out = ''
  for (const e of entries) {
    if (out.length + e.length + 1 > max) break
    out += `${e}\n`
  }
  return out.trimEnd()
}

                                                           

export function missingReportReminder(kind              , attempt        , max        , taskId                    )         {
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

/**
 * Task id named in a message: `task_id: x` or `task id = x` (a ":" or "=" is
 * required, so prose like "what is the task id format" does not count).
 */
export function taskIdInText(text        )                     {
  const m = text.match(/\btask[ _-]?id\s*[:=]\s*[`"']?([A-Za-z0-9][A-Za-z0-9_-]{0,63})(?![A-Za-z0-9_-])/i)
  return m ? m[1] .toLowerCase() : undefined
}
