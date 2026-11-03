# DeepSeek Harness plugins for the Verdent layer

Two plugins for the shortlist in the harness bake-off report. Both are opt-in and change no DeepSeek program files.

| Plugin | Shortlist items | What it does |
|---|---|---|
| `verdent-report` | 2b, 2, 3, 3b, 10 | Strict JSON Worker reports and Verifier verdicts, a stop check, a lessons log and a playbook library |
| `model-fallback` | 4 | Switches an agent to a backup model when its model keeps failing |

Not built, because DeepSeek already ships them in its base bundle:
- **Loop detection (item 9):** `@deepseek-ai/dsh-repeat-tool-reminder` nudges at 3, 5 and 8 identical repeats.
- **Stale-edit protection (item 6):** `@deepseek-ai/dsh-fs-observation-policy` rejects edits to a file that changed since it was read.

## Quick start (preview)

> **Status:** These files exist on [draft, unmerged PR #4](https://github.com/jlew23/jarvis-template/pull/4), not the repository's default branch. The following steps are for a disposable test profile, not production.

**Prerequisites:** Node.js **22.13+**, Git, an existing DeepSeek Harness installation and a disposable Verdent test profile. For `model-fallback`, use **DeepSeek Harness 0.2.2-alpha.2+**. Older 0.2.1-rc builds disable fallback with a warning. The report plugin has partial live loading checks, not complete end-to-end validation.

### 1. Get the proposed plugin source and run the stand-in tests

```bash
git clone https://github.com/jlew23/jarvis-template.git
cd jarvis-template
git fetch origin pull/4/head:verdent-plugins-preview
git switch verdent-plugins-preview
cd dsh-plugins
node --version
node build.mjs
node test.mjs
```

**Verify:** The test command should report **31 passing tests** on the stand-in host. This checks the plugin build and simulated host behavior; it does not prove compatibility with your live installation.

### 2. Configure in a disposable profile

Follow [the install instructions below](#install) to make both plugin packages resolvable by your Harness profile, then copy the appropriate [Team or Test bench preset](presets/README.md). Replace the example Windows `memoryDir`, preset IDs, and model names with your own. **Do not copy the author's `C:\\Users\\Luda` path literally.** The YAML snippets are plugin-list fragments, not a complete standalone patch.

Start with `verdent-report` in a throwaway profile. Mount `role: all` only for single-agent testing, or separate `manager`, `worker`, and `verifier` mounts for a real team. Add `model-fallback` only after confirming your Harness version supports `agent.model.select()`.

### 3. Verify with a harmless task

Send a task labeled `task_id: smoke-001` with one checkable criterion. Submit a Worker report, inspect it with `read_task_report_v1`, then submit a Verifier verdict. Check that files appear under your configured `memoryDir/reports` and `memoryDir/lessons`; a fully passing verdict should create a playbook. For fallback, simulate or observe a qualifying provider failure and verify that **the next step**, not the failed step, uses the backup.

**Current evidence:** 31/31 tests on a stand-in host; live loading of six tools and `read_task_report_v1` reported in a bench profile. Live reminder behavior, saved report files, and fallback warning are still pending independent verification. If a check fails, [open an issue](https://github.com/jlew23/jarvis-template/issues/new) with your Harness version, redacted config, expected behavior, and observed result.

**Demo:** A real end-to-end recording is still needed. No GIF or live fallback video is claimed here until captured.

---

## verdent-report

Mount it once per preset with a `role`:

| Role | Tools | Mount in |
|---|---|---|
| `worker` | `submit_worker_report_v1`, `read_playbook_v1` | Worker preset |
| `verifier` | `submit_verdict_v1` | Verifier preset |
| `manager` | `read_task_report_v1`, `find_playbooks_v1`, `recent_lessons_v1` | Manager preset |
| `all` | every tool | single-agent testing only |

What it does:
- **Record, don't refuse.** Over-long fields are trimmed (summary 300 chars, evidence 1,000, notes 2,000, list items 400, 30 per list, 5 lessons), and the reply says what was cut. A "done" with unmet criteria is saved as "partial"; a "PASS" with failing criteria as "FAIL". Only things that can't be stored are refused (no criteria on "done", empty evidence on a met criterion, more than 50 criteria, a field over 10x its limit), with a one-line fix: `Not saved: <problem>. <fix>. Call again.`
- **One record per submission.** Each worker report gets a unique id (`<task_id>-<timestamp>-<4 hex>`), so a task id reused in a later session can't overwrite an old playbook. A new report for a task moves its old verdict to `reports/archive/`. A verdict records which report it graded.
- **Playbooks** (`playbooks/<report id>.md`) are saved only when a PASS grades every worker criterion; otherwise the reply names the missing ones. A FAIL moves that report's playbook to `playbooks/.retired/`. Nothing is deleted.
- **Short output for the Manager.** `read_task_report_v1` gives one State line (not verified yet, failed verification, PASS, or blocked), only the criteria that need attention, and the JSON paths, capped at 2,000 chars. `find_playbooks_v1` returns names, titles, step counts and "done means", never the text. Weak matches are dropped. The Worker reads the steps itself with `read_playbook_v1`. `recent_lessons_v1` returns at most 10 short lines.
- **Stop check.** It is armed when a message to the agent names a task id (`task_id: x`), whether it's the first task (`user`) or a follow-up from the Manager (`agent-message`). A plain question doesn't arm it. An agent that stops without reporting gets one reminder per turn, up to `maxReminders` per task (default 1), shared across all mounts. Each reminder causes one more model request.
- **Lessons** from reports and from every failed criterion go to `lessons/inbox.md`, one line each, written before the report so they survive a later failure.
- **Files** are written by the host with unique temp names and short retries (Windows antivirus and OneDrive can lock files briefly), so memory saving works in every sandbox mode. Nothing goes into the session log.

Config:

```yaml
config:
  memoryDir: 'C:\Users\Luda\.dsh\manager-memory'   # required
  role: worker                                     # worker | verifier | manager | all
  requireReportPresets: [worker-verdent]           # optional; empty = every agent in this mount's scope
  maxReminders: 1                                  # 0 turns the stop check off
```

## model-fallback

Mount it once, globally. DeepSeek fixes an agent's model when it prepares a step, and keeps it for every retry in that step, so a plugin can't swap models mid-step. This plugin works per turn instead:

1. A request fails and llm-retry gives up. That step still fails, but the agent's model is switched to the next backup, so the next turn (the Manager's resend, or yours) runs on it.
2. **Outage memory:** other agents on the same model move to the backup at their next step, instead of each paying for the same failed retries.
3. After `cooldownMs` (default 5 minutes) the agent goes back to its normal model. If you changed the model yourself in the meantime, your choice is left alone.

```yaml
config:
  chains:
    deepseek-v4-pro: [deepseek-flash]
    deepseek-flash: [deepseek-v4-pro]
  cooldownMs: 300000
  # codes: failure codes that trigger a switch.
  # Default: RATE_LIMIT, SERVER, TIMEOUT, TRANSPORT, EMPTY_RESPONSE, OVERLOADED. [] = any failure.
```

Notes: a model id containing `/` needs its provider written in front (`openrouter/qwen/qwen3`). After a restart the plugin forgets its switches, so an agent left on a backup stays there until you change it. If the provider's `retryPolicy` is `mode: always`, llm-retry never gives up and the fallback never fires.

> **Version support (checked against the published DeepSeek Harness packages):**
>
> | | 0.2.1-rc.3 | 0.2.1-rc.5 | 0.2.2-alpha.2 |
> |---|---|---|---|
> | `verdent-report` | works (hooks present; ran in a throwaway setup) | works (hooks present) | works |
> | `model-fallback` | turns itself off with a warning | turns itself off with a warning | works |
>
> `model-fallback` needs `agent.model.select()`, which first appears in 0.2.2-alpha.2. Earlier builds only have `session.selectModel()`, a session-controller command a plugin can't reach the same way.

## Review findings

Everything the review found, what was fixed, where the review itself was wrong, and what is still untested: [FINDINGS.md](FINDINGS.md). Read it before relying on these plugins.

## Quick configs

Six ready-made setups (Solo, Team, Team cheap, Strict, Overnight, Test bench), with what each costs and why: [presets/README.md](presets/README.md).

## Install

**Back up first:** `C:\Users\Luda\.dsh\profiles\desktop\cordis.patch.yml`. Test in the `verdent-test` profile, never `desktop`.

1. Build (no dependencies, Node 22.13 or newer): `node build.mjs`, then run the tests: `node test.mjs`.
2. Make the plugins loadable. Either way works:
   - **Profile package:** install each folder into the profile with its package manager, so imports of `@deepseek-ai/dsh-tools` and `@deepseek-ai/dsh-llm` resolve to DeepSeek's own copies. Then refer to the plugins by package name (`@jarvis/dsh-verdent-report`).
   - **Path:** refer to the absolute path of `lib/index.js`. This only works where `@deepseek-ai/*` resolves from the plugin's folder, for example in a DeepSeek source checkout run with `pnpm dsh web --patch <file>`.
3. Add the rows. In `verdent-presets.patch.yml`, add one row to each preset's plugin list, the same way `create_worktree` is added to the Worker preset:

```yaml
# Worker preset plugins
- id: verdent-report
  name: '@jarvis/dsh-verdent-report'
  config: { memoryDir: 'C:\Users\Luda\.dsh\manager-memory', role: worker, requireReportPresets: [worker-verdent] }
# Verifier preset plugins: same row with role: verifier and the Verifier preset id
# Manager preset plugins: same row with role: manager
```

   Then add a global row for the fallback:

```yaml
- insert:
    - id: model-fallback
      name: '@jarvis/dsh-model-fallback'
      config: { chains: { deepseek-v4-pro: [deepseek-flash], deepseek-flash: [deepseek-v4-pro] } }
```

   Replace `worker-verdent` with the real preset ids from `verdent-presets.patch.yml`.
4. Update the preset prompts so the agents use the tools:
   - **Manager:** start every task message with `task_id: <id>` and 3 to 7 checkable criteria. Before planning work like earlier tasks, run `find_playbooks_v1` and `recent_lessons_v1`, and pass a playbook name to the Worker. After a Worker or Verifier finishes, read `read_task_report_v1` instead of trusting the chat summary. Never read `lessons/inbox.md` whole.
   - **Worker:** if given a playbook name, read it with `read_playbook_v1`. Keep the criteria in a todo list and update it each step. Finish with `submit_worker_report_v1`, copying each criterion exactly, with `lessons` and `playbook_steps`.
   - **Verifier:** check every criterion yourself and finish with `submit_verdict_v1`, grading every worker criterion. Also run when a Worker reports `blocked`.
5. Live test: one throwaway task through Manager, then Worker, then Verifier. Check `reports/`, `lessons/inbox.md` and `playbooks/` in the memory folder.

## How this was tested

- 20 unit tests for the logic (`*/tests/core.test.ts`).
- 9 integration tests (`tests/smoke.test.ts`) that load the built `lib/` files on `tests/fake-host.mjs`, a stand-in host that copies the real DeepSeek rules this code depends on: hook order, duplicate tool errors, model selection fixed per step (a plugin that changes it mid-step makes the host throw), and the message kinds Managers and helpers send.
- A squad review: five tester agents ran about 290 tests over single, combined and stressed setups, then an Opus review panel triaged about 117 findings into the fixes above. That review caught a blocker the first version had (switching the model mid-step is rejected by the real host).
- **Partial live validation only.** On the target PC, the report hooks were observed on 0.2.1-rc.3, rc.5, and 0.2.2-alpha.2; six tools loaded in a bench profile and `read_task_report_v1` ran. The reminder, saved report files, and fallback warning still require live checks. The 31 passing automated tests use a stand-in host, not a live Harness end-to-end run.

## Files

- `*/src/*.ts` are the source; `*/lib/*.js` are generated by `build.mjs`, so don't edit them.
- `core.ts` holds the logic and has no imports; `index.ts` wires it into DeepSeek.
