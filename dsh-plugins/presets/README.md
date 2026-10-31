# Quick configs

Six ready-made setups of the Verdent add-ons, each chosen from what the squad review measured. Pick one, copy its rows, and replace the preset ids with yours from `verdent-presets.patch.yml`. Test in `verdent-test` first.

Assumed memory folder: `C:\Users\Luda\.dsh\manager-memory`.

## Pick one

| Config | Use it for | Add-ons | Extra tokens per request | Extra billed requests | Playbooks saved |
|---|---|---|---|---|---|
| **1. Solo** | One agent, chat or quick coding | fallback | 0 | 0 | No |
| **2. Team** (default) | Day-to-day Manager, Worker and Verifier work | report on all three, fallback | Worker 381, Verifier 230, Manager 141 | at most 1 reminder per task per agent | Yes |
| **3. Team cheap** | Lots of small tasks, tight budget | report on Manager and Worker, fallback one way | Worker 381, Manager 141 | 0 | No |
| **4. Strict** | Work that ships: releases, renders for delivery | Team, plus 2 reminders and Verifier on every result | as Team | at most 2 per task per agent | Yes |
| **5. Overnight** | Long autonomous runs while you're away | Team, plus longer cooldown and lessons first | as Team | at most 1 per task per agent | Yes |
| **6. Test bench** | Testing the add-ons themselves | report `all` in one agent | 752 | at most 1 | Yes |

Token costs are what each role's tools add to every model request (measured; tokens are about chars / 4). They sit in the cached prompt prefix, so after the first request they are cheap but not free.

## Rules behind the choices

| Finding | Rule |
|---|---|
| `role: all` costs 752 tokens per request, against 141 to 381 per single role, and its reminder can't tell a Worker from a Verifier | Use `all` only on the test bench. In real presets, mount each role once in its own preset. |
| Each reminder makes the agent take one more full-context model request, so it costs far more than its 46 tokens | `maxReminders`: 0 when cheap, 1 by default, 2 only when a missing report is worse than the cost. |
| Two stop checks in one shared scope used to double the reminders and name the wrong tool. That is fixed (one per turn, shared), but scoping is still cleaner. | If presets share a scope, set `requireReportPresets` on each mount. |
| Playbooks are saved only on a Verifier PASS that grades every criterion | No Verifier means no playbook library. Configs 1 and 3 still log lessons from Worker reports. |
| Fallback can't switch mid-step: the failing step still fails, and the next turn runs on the backup | Fallback suits teams, where the Manager resends automatically. Solo users will see one error and must resend once. |
| llm-retry `mode: always` never gives up, so fallback never fires | Keep llm-retry in normal mode (the default) wherever fallback is mounted. |
| `codes: []` lets one bad prompt (auth error, bad request) switch models | Keep the default codes. Only provider-side failures (rate limit, server, timeout, transport, overloaded) move other agents. |
| Outage memory lasts for `cooldownMs`. Shorter means more flip-flopping during an outage, longer means more time on the backup. | 5 min by default; 15 min overnight, when nobody is watching and stability matters more. |
| Manager tools add only 141 tokens, and each output is capped (about 500 tokens per report, 150 per playbook search) | Always mount the Manager role in any team config. It replaces reading full reports. |

## 1. Solo

Global rows only, no report plugin:

```yaml
- insert:
    - id: model-fallback
      name: '@jarvis/dsh-model-fallback'
      config:
        chains: { deepseek-v4-pro: [deepseek-flash], deepseek-flash: [deepseek-v4-pro] }
```

## 2. Team (default)

Per-preset rows (one in each preset's plugin list):

```yaml
# Manager preset
- id: verdent-report
  name: '@jarvis/dsh-verdent-report'
  config: { memoryDir: 'C:\Users\Luda\.dsh\manager-memory', role: manager }
# Worker preset
- id: verdent-report
  name: '@jarvis/dsh-verdent-report'
  config: { memoryDir: 'C:\Users\Luda\.dsh\manager-memory', role: worker, requireReportPresets: [worker-verdent], maxReminders: 1 }
# Verifier preset
- id: verdent-report
  name: '@jarvis/dsh-verdent-report'
  config: { memoryDir: 'C:\Users\Luda\.dsh\manager-memory', role: verifier, requireReportPresets: [verifier-verdent], maxReminders: 1 }
```

Global row:

```yaml
- insert:
    - id: model-fallback
      name: '@jarvis/dsh-model-fallback'
      config:
        chains: { deepseek-v4-pro: [deepseek-flash], deepseek-flash: [deepseek-v4-pro] }
        cooldownMs: 300000
```

## 3. Team cheap

As Team, but:
- no Verifier mount;
- `maxReminders: 0` on the Worker, so no extra requests;
- fallback only downward, so a failure never moves you onto the pricier model.

```yaml
# Worker preset
  config: { memoryDir: 'C:\Users\Luda\.dsh\manager-memory', role: worker, maxReminders: 0 }
# Global
      config: { chains: { deepseek-v4-pro: [deepseek-flash] } }
```

**Trade-off:** nobody checks the Worker independently, and no playbooks are saved. The Manager still sees each report with `read_task_report_v1`.

## 4. Strict

As Team, with `maxReminders: 2` on Worker and Verifier and `cooldownMs: 600000`. In the Manager prompt: "send every result to the Verifier, including `blocked` and `partial`; never accept a report without a verdict".

## 5. Overnight

As Team, but:
- `cooldownMs: 900000` (15 min), so an outage doesn't flip agents back and forth while nobody is watching;
- in the Manager prompt, run `recent_lessons_v1` and `find_playbooks_v1` before every task, and end the run with a one-line summary per task from `read_task_report_v1`.

## 6. Test bench

In the throwaway `verdent-test` profile only:
- `role: all`, with `memoryDir` pointing at a scratch folder;
- default `maxReminders`;
- no fallback, unless fallback is what you're testing.
