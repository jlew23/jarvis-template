# Review findings: Verdent plugins for DeepSeek Harness

This document records how the two plugins in this folder (`verdent-report` and `model-fallback`) were tested, everything that was found, what was fixed, and what is still unknown. It includes the mistakes made along the way, because users of these plugins should know how much to trust them and why.

**Short version:** the plugins went through two rounds of automated review and a final judge, with about 400 tests across those rounds. The review found a design flaw that made `model-fallback` unable to work at all, data loss under parallel load, and tool output large enough to degrade the Manager's accuracy. All of these are fixed. **The plugins have not yet run inside a real DeepSeek Harness, and they were written against a newer DeepSeek version (0.2.2-alpha.2) than the one installed (0.2.1-rc.3); see section 5.** Every test ran against a stand-in host built from DeepSeek's source code. The first live run is the real test.

Dates: October 30 to 31, 2026. DeepSeek Harness source read: `deepseek-ai/deepseek-harness`, commit of October 30, 2026.

---

## 1. How the review worked

The method is saved as the `squad-review` skill (`.claude/skills/squad-review/SKILL.md`).

1. **Stand-in host.** DeepSeek Harness's dependencies could not be installed in the review sandbox. That was blocked, because it runs downloaded code. So a small fake host was written from DeepSeek's source to copy the rules these plugins depend on:
   - hook order and veto rules;
   - duplicate tool names are an error;
   - how model selection works;
   - which message kinds Managers and helpers send.

   It is in `tests/fake-host.mjs`.
2. **Squad.** Five low-cost tester agents ran in parallel, each on one slice:
   - each setting alone;
   - several copies of the plugin together;
   - the fallback plugin and every plugin at once;
   - stress, races and edge cases;
   - how much each tool adds to the model's context.
3. **Interpreter.** A stronger model grouped the findings by root cause, re-ran the evidence, and classed each one must-fix, should-fix or won't-fix.
4. **Panel.** Three more reviewers worked independently, each with one lens:
   - performance and cost;
   - correctness and outliers;
   - context engineering, meaning how models react to tool text and output size.

   Each had to challenge at least one decision.
5. **Fix, then loop.** The findings were fixed and a second, smaller squad checked the fixes. A final judge then re-ran the second-round tests against the final code and decided whether to stop.

**Cost of the review:** about 2.6 million model tokens across all review agents. This is worth it for code about to ship, not for small changes.

---

## 2. The most important findings

| # | Finding | Severity | Status |
|---|---|---|---|
| 1 | `model-fallback` could never work. It changed the model inside a request hook, and the real host rejects that with an error, so every switch would have crashed the turn. Our own first tests passed only because the first stand-in host did not copy that rule. | Blocker | Fixed: redesigned to switch models between steps |
| 2 | Parallel reports for one task used the same temporary file name. 457 of 500 writes failed, and 184 of 200 lessons were lost. | High | Fixed: 0 of 500 fail, 0 lessons lost |
| 3 | Two tasks with the same summary overwrote each other's playbook, and summaries in Chinese all became `untitled.md`. | High | Fixed: playbooks are named by a unique report id |
| 4 | Task ids reused in a later session overwrote old reports and verdicts. | High | Fixed: every submission gets a unique id, and old verdicts are archived, never deleted |
| 5 | `read_task_report_v1` could put about 32,000 tokens in front of the Manager in one call, and about 316,000 for very large reports. `find_playbooks_v1` could put about 13,000. Long context degrades model accuracy ("context rot"). | High | Fixed: about 500 and 150 tokens, capped |
| 6 | With two copies of the report check in one scope, an agent got two reminders per stop, one naming the wrong tool. Each reminder costs a whole extra model request. | High (cost) | Fixed: one shared reminder state per agent, at most one per turn |
| 7 | Follow-up tasks from a Manager arrive as a different message kind than the first task. Reused Workers were never reminded, and the Manager never returned to its main model. | High | Fixed: both kinds handled |
| 8 | A criterion listed twice, once passing and once failing, could hide the failure, so a PASS saved a playbook for failed work. | Medium | Fixed: a failure always wins |
| 9 | A PASS could skip some of the Worker's criteria and still save a playbook. | Medium | Fixed: no playbook unless every criterion is graded, and the reply names the ungraded ones |
| 10 | A failure was blamed on the model selected for the next step instead of the one that failed, which could leave an agent stuck on a failing backup. | Medium | Fixed |
| 11 | One agent's bad prompt could count as an outage and move every other agent off a model. | Medium | Fixed: only provider-side errors count |

---

## 3. All findings, by area

Severity is as classed by the review. "Won't fix" items list the reason.

### verdent-report: correctness

| Finding | Status |
|---|---|
| Playbook name collisions: same summary, the same first 48 characters, non-Latin summaries | Fixed |
| Task ids reused across sessions overwrote reports, verdicts and playbooks | Fixed |
| A new worker report left a stale verdict in place | Fixed: archived to `reports/archive/` |
| PASS did not check the Worker's criteria | Fixed |
| A later FAIL left the PASS playbook findable | Fixed: moved to `playbooks/.retired/` |
| PASS without a worker report said nothing | Fixed: the reply says no playbook was saved |
| A near-duplicate criterion could hide a failure | Fixed |
| `role: all` reminded Verifiers to file a worker report | Fixed: names both tools |
| A Verifier using `role: all` could be marked done by filing a worker report | Won't fix: `all` is for single-agent testing only |
| Reminder counts multiplied by the number of copies of the plugin | Fixed |
| Ordinary prose such as "what is the task id format" turned on the reminder | Fixed: needs `task_id:` with a colon or `=` |
| Task ids differing only in case write to the same file | Won't fix: ids are lower-cased on purpose |
| A lesson containing a line break could forge a header in the lessons file | Fixed |
| Uppercase playbook names were not found | Fixed |

### verdent-report: robustness and files

| Finding | Status |
|---|---|
| Same-millisecond temp files collided (data loss) | Fixed: random temp names |
| On Windows, antivirus or OneDrive can briefly lock files | Fixed: short retries |
| A report was saved, then the lessons append failed and the lesson was lost | Fixed: lessons are written first |
| A verdict was saved, then the playbook write failed and an error was returned anyway | Fixed: the verdict counts as saved, and the reply says what wasn't |
| Folders deleted while running caused raw errors | Fixed: they are recreated |
| A corrupt report file gave a raw parse error | Fixed: a clear message naming the file |
| Config mistakes were accepted or gave raw errors | Fixed: clear messages for each setting |
| Appends larger than 512 KB could interleave | Fixed indirectly: inputs are now trimmed far below that |

### verdent-report: context and cost

| Finding | Before | After |
|---|---|---|
| Task report output | up to ~316,000 tokens | ≤ 2,000 chars (~500 tokens), with questions and notes shown first |
| Playbook search output | full text of 3 playbooks (~13,000 tokens) | names, titles and step counts (~150 tokens) |
| Reading a playbook | unbounded | 6,000 chars, saying where the rest is |
| Tool replies echoing long or invalid input | up to 1,000,000 chars | ≤ ~250 chars |
| Fixed cost of tool definitions per request | Worker 480, Verifier 281, Manager 142 tokens | Worker 381, Verifier 230, Manager 141 |
| Rejected reports made the model write the whole report again | always | Long fields are trimmed and recorded instead. Only reports that can't be stored at all are refused, with a one-line fix. |
| Reminders | could be 4 or more extra full model requests per task | 1 by default |

### verdent-report: search quality

| Finding | Status |
|---|---|
| Short words ("AI", "UE", "3D", "13") were ignored | Fixed |
| Chinese, Japanese and Cyrillic text never matched | Fixed |
| A word mixing Latin and Chinese ("Unreal渲染") never matched | Fixed |
| Common words ("the", "for") counted as matches | Fixed |
| Weak matches were returned; a cheap model follows a wrong playbook faithfully | Fixed: weak matches are dropped |
| Search re-read every file on every call | Fixed: cached index. 1,000 playbooks: 24 ms warm, 237 ms cold |

### model-fallback

| Finding | Status |
|---|---|
| Changing the model inside a request hook is rejected by the real host | Fixed: redesigned around `agent.model.select()` between steps |
| A failure was blamed on a pending model instead of the one that failed | Fixed |
| A cooldown of 0 cancelled the switch before the backup was ever used | Fixed: the cooldown starts when the backup is first used |
| A model picked by the user during an outage was overridden | Fixed |
| Outage memory was shared by every copy of the plugin in the process | Fixed: kept per copy |
| One agent's bad prompt counted as an outage for everyone | Fixed |
| An unknown current model dropped the plugin's state | Fixed |
| Weak config validation (e.g. `codes: "SERVER"` silently never firing) | Fixed |
| The failing step still fails; the backup applies from the next step | **By design.** The host keeps a step's model for all its retries, so no plugin can change it mid-step. |
| A switch decided at the start of a step applies from the step after | **By design**, for the same reason. The end of a turn is the main switch point. |
| After a restart the plugin forgets its switches, so an agent left on a backup stays there | **Known limit**, documented |
| A model id containing `/` without a provider is read as provider/model | **Documented**: write the provider in front |
| With llm-retry in `always` mode, fallback never fires | **Documented** |

---

## 4. Where the review itself was wrong

Reviews make mistakes in both directions. These are recorded so the findings can be weighed.

- **Our first stand-in host missed the most important rule.** It let a plugin change the model mid-request, which the real host forbids. Every early test passed while the feature could never have worked. A reviewer caught it by reading DeepSeek's source. The stand-in now enforces the rule, and building a faithful stand-in is step zero of the method.
- **A ruling of ours was wrong.** We ruled that Manager messages arrive as `user` messages. Only the first task does; follow-ups arrive as `agent-message`. A reviewer caught it, and it is fixed.
- **Some tester findings were false**, and the real host's source settled them:
  - "the stop check re-arms from the conversation history": the host passes only new messages;
  - "a failed plugin load leaves tools behind": the host removes them;
  - "the host might not validate tool arguments": it does, before the plugin code runs.

  Several round-2 test failures came from deliberate changes, such as longer ids and trimming instead of refusing, not from bugs.
- **Severity was often misjudged at first.** One panelist showed that the reminder issue was a cost problem (each reminder is a whole extra model request), not a cosmetic one.

---

## 5. What is not known yet

- **Version mismatch (found after the review).** The plugins were written against DeepSeek Harness source version 0.2.2-alpha.2 (GitHub, October 30, 2026). The app installed on the target PC is 0.2.1-rc.3, two releases older. DeepSeek's upgrade guides for the releases in between (0.2.1-rc.4 and 0.2.2-alpha.2) mention no change to model selection or the hooks used here, but that is not proof. **`model-fallback` is unconfirmed on 0.2.1-rc.3** until the installed app is checked for the strings `use agent.model.select() before step preparation` and `model/selection`. Variable names change when code is bundled, but text in quotes survives, so these two strings show whether the function exists. Don't install `model-fallback` until that check passes. `verdent-report`'s hooks were found in the installed app by the user's own agent.
- **No live run.** The plugins were never loaded into a real DeepSeek Harness. The stand-in copies the rules we read in the source, but it can't copy everything.
- **Loading on the desktop app.** It is not confirmed how the installed app resolves plugin imports, or the exact syntax for adding a plugin inside a preset. The quick configs follow the pattern the existing Verdent layer uses.
- **The stop check depends on the Manager.** It turns on only when a task message contains `task_id: <id>`. If the Manager prompt omits that, the reminder never fires; this fails safe, with no junk reports.
- **Same-provider backups.** After a switch, DeepSeek's retry counter for that provider may already be used up in that step, so a backup on the same provider may get no retries until the next step.
- **Disk growth.** The lessons file, reports and retired playbooks are never pruned. This doesn't affect what the model sees, which stays capped, but the folders grow over time.

---

## 6. Test record

| Stage | Tests | Result |
|---|---|---|
| Round 1 squad | 290 tests, about 117 findings | Grouped into 17 issues: 3 must-fix, 14 should-fix |
| Panel | 3 independent reviews | Overturned or tightened 9 decisions; found the fallback blocker |
| Round 2 squad | 136 tests plus measurement scripts | About 25 new or remaining issues, all fixed |
| Final judge | All round-2 tests re-run, plus a review of the changes | **STOP**: no must-fix issues, no regressions |
| Plugin's own suite | 20 unit tests, 10 integration tests | 30 of 30 pass (`node build.mjs && node test.mjs`) |

Raw tester output and scripts stayed in the review sandbox and are not in this repository. This document is the record.
