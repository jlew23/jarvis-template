# DeepSeek Harness plugins for the Verdent layer

Two plugins for the shortlist in the harness bake-off report. Both are opt-in and change no DeepSeek program files.

| Plugin | Shortlist items | What it does |
|---|---|---|
| `verdent-report` | 2b, 2, 3, 3b, 10 | Strict JSON Worker reports and Verifier verdicts, a stop check, a lessons log and a playbook library |
| `model-fallback` | 4 | Switches an agent to a backup model when its model keeps failing |

Not built, because DeepSeek already ships them in its base bundle:
- **Loop detection (item 9):** `@deepseek-ai/dsh-repeat-tool-reminder` nudges at 3, 5 and 8 identical repeats.
- **Stale-edit protection (item 6):** `@deepseek-ai/dsh-fs-observation-policy` rejects edits to a file that changed since it was read.

## verdent-report

Mount it once per preset with a `role`:

| Role | Tools | Mount in |
|---|---|---|
| `worker` | `submit_worker_report_v1` | Worker preset |
| `verifier` | `submit_verdict_v1` | Verifier preset |
| `manager` | `read_task_report_v1`, `find_playbooks_v1` | Manager preset |

What it enforces:
- **Worker report:** `status` is `done`, `partial` or `blocked`. `done` is rejected unless every criterion is met and has evidence. `blocked` needs at least one open question. Task ids become file names, so only lowercase letters, digits, `-` and `_` are accepted.
- **Verdict:** `PASS` is rejected while any criterion fails. A `FAIL` with every criterion met needs notes.
- **Stop check:** a Worker or Verifier that ends its turn without reporting gets a reminder, at most `maxReminders` times (default 2) per task. The count resets when a new task message arrives.
- **Lessons:** lessons from Worker reports, and every failed criterion from a `FAIL`, are appended to `<memoryDir>/lessons/inbox.md`.
- **Playbooks:** on `PASS`, the Worker's `playbook_steps` are saved to `<memoryDir>/playbooks/<summary>.md`. `find_playbooks_v1` ranks them by keyword match.
- **Reports on disk:** `<memoryDir>/reports/<task_id>.worker.json` and `.verdict.json`.

The plugin writes these files itself, not through the model's sandboxed tools, so memory saving now works in every sandbox mode (the old limit of Full access only no longer applies). Nothing is written to the session log.

Config:

```yaml
config:
  memoryDir: 'C:\Users\Luda\.dsh\manager-memory'   # required
  role: worker                                     # worker | verifier | manager | all
  requireReportPresets: [worker-verdent]           # preset ids the stop check applies to; empty = every agent in this mount's scope
  maxReminders: 2                                  # 0 turns the stop check off
```

## model-fallback

Mount it once, globally. When a request fails and `llm-retry` has given up, the agent moves to the next model in its chain and the step is retried. It returns to its normal model at the next user or Manager message. Every switch is another billed request, and when the last backup fails the agent stops as usual.

```yaml
config:
  chains:
    deepseek-v4-pro: [deepseek-flash]
    deepseek-flash: [deepseek-v4-pro]
  # codes: failure codes that trigger a switch.
  # Default: RATE_LIMIT, SERVER, TIMEOUT, TRANSPORT, EMPTY_RESPONSE, OVERLOADED. [] = any failure.
```

Backups can name another provider as `provider/model`. If the provider's `retryPolicy` is `mode: always`, llm-retry never gives up, so the fallback never fires.

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
   - **Manager:** give every task a `task_id` and 3 to 7 checkable criteria. Run `find_playbooks_v1` before planning a task that resembles earlier work. After a Worker or Verifier finishes, read `read_task_report_v1` instead of trusting the chat summary.
   - **Worker:** keep the criteria in a todo list and update it each step. Finish with `submit_worker_report_v1`, including `lessons` and `playbook_steps`.
   - **Verifier:** check every criterion yourself and finish with `submit_verdict_v1`. Also run when a Worker reports `blocked`.
5. Live test: one throwaway task through Manager, then Worker, then Verifier. Check `reports/`, `lessons/inbox.md` and `playbooks/` in the memory folder.

## How this was tested

- 13 unit tests for the logic (`*/tests/core.test.ts`).
- 4 smoke tests that load the built `lib/` files against small stand-ins for DeepSeek's `defineTool`, `createUserMessage` and its hook calls (`tests/smoke.test.ts`). They cover the full report flow, the stop check and the fallback chain.
- **Not yet run inside DeepSeek Harness itself.** The hook and tool shapes were read from DeepSeek's source (`deepseek-ai/deepseek-harness`, October 30 2026), but the first live run on the PC is the real test.

## Files

- `*/src/*.ts` are the source; `*/lib/*.js` are generated by `build.mjs`, so don't edit them.
- `core.ts` holds the logic and has no imports; `index.ts` wires it into DeepSeek.
