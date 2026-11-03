---
name: squad-review
description: |
  Stress-test a piece of code with a squad of cheap tester subagents, have an
  Opus interpreter triage their findings, then a panel of Opus reviewers with
  different lenses argue about them; fix, and loop until a round comes back
  clean. Use when the user asks to "deploy a squad", "stress test this",
  "test every combination", "find one-offs and anomalies", "panel review", or
  "loop until clean" on code they're about to ship, especially plugins or
  integrations that run inside a host you can't run locally.
  Does NOT trigger on: a quick review of a small diff (use code-review), or
  work where the real system can simply be run and tested directly.
---

# Squad review

Cheap agents find the anomalies, Opus agents decide what they mean, and the
chair (you) verifies and fixes. First used on the DeepSeek Harness plugins
(`dsh-plugins/`, PR #4). Round 1 found a blocker that every earlier test
missed, plus data loss under load and unbounded context output.

## When it pays off, and what it costs

- **Worth it** when the code runs inside a host you can't run here, when
  behaviour depends on combinations (one plugin vs several vs all), or when
  races, limits and context size matter.
- **Not worth it** for small or local changes: a single code-review pass is
  cheaper.
- **Cost of one round** was about 1.2M subagent tokens: five Haiku testers
  (130-190k each), one Opus interpreter (150k) and three Opus panelists
  (130-140k each). Tell the user before starting a round if they haven't
  asked for one.

## Step 0: build a faithful fake host (most important)

Testers are only as good as the stand-in they test against. In the first run
the stand-in let a plugin change the model inside a request hook. The real
host throws on that, so every test passed while the feature could never work.
The panel caught it only by reading the real source.

- Read the real host's source for every rule the code relies on: hook order
  and veto rules, duplicate registration, what each hook's payload really
  contains, message kinds, when state is fixed, and validation the host does
  before your code runs.
- Write one shared `kit/harness.mjs` that enforces those rules. It must throw
  where the real host throws. Put a header comment listing each rule and the
  source file it came from.
- Add one example test that passes, so testers copy a working pattern.
- If installing the host's dependencies is blocked, stub only the helpers the
  code imports, in a temp copy, never next to the real packages.

## Step 1: squad (cheap testers, run in parallel)

Spawn 4-5 testers (`model: haiku`), each with a disjoint slice and its own
output folder:

| Tester | Slice |
|---|---|
| A | each setting or role enabled alone |
| B | a few copies together in one scope |
| C | the other component alone, and everything enabled at once |
| D | stress, races, large inputs, filesystem failures, timings |
| E | context footprint: fixed tokens per request, output size, growth over many tasks |

Every tester prompt includes:
- exact paths, the Node binary, and how to run tests (explicit file paths);
- "no installs, no network, do not edit source";
- "write only in `<your folder>/`";
- "final message is ONLY a JSON array of reproduced findings: id, severity,
  config, repro, expected, actual", plus a summary object.

Save each squad's findings to `results/<X>.md` as they arrive, in a few lines
each.

## Step 2: chair verification

Before handing findings on, check the ones that depend on real-host behaviour
against the real source, and mark them `VERIFIED FALSE` or confirmed in the
results file. Expect wrong calls in both directions. In the first run, two
squad findings were false, and one "false" ruling of the chair's was wrong too,
caught later by a panelist.

## Step 3: Opus interpreter

One agent (`model: opus`) reads all results, the source and the real host. It:
- groups findings by root cause, one issue per cause;
- re-runs cheap repros;
- classes each MUST, SHOULD or WONT-FIX with a reason;
- gives a 1-4 sentence fix design and a regression test for each;
- lists open questions about the real host.

Save its output as `results/interpretation.md`.

## Step 4: the panel (the "stochastic meeting")

Spawn three Opus reviewers in parallel. Each gets a different lens and can't
see the others:

1. **Performance and efficiency:** cost per call, billed requests, numbers
   for caps and limits.
2. **Correctness and outliers:** bugs the fixes would introduce, conflicts
   between fixes, missed data loss.
3. **Context engineering and agent behaviour:** output shapes, tool
   descriptions, error and reminder wording, and how cheap models react to
   them.

Rules for every panelist:
- disagree with at least one triage decision and argue it;
- settle one assigned open question from the real source, with file:line;
- end with a top 5;
- stay under 700-800 words.

Independent lenses plus forced dissent is what produces signal: in the first
run each panelist overturned something different.

## Step 5: chair synthesis and fixes

- Verify every panel claim that changes the design before acting on it.
  "The host rejects X" is a one-grep check.
- Decide each disagreement in one line and record the decision.
- Upgrade the fake host with anything new learned about the real one, and
  copy it into the repo's tests so those rules stay enforced.
- Rewrite the code, update unit tests and integration tests, then build and
  run everything.
- Commit and push before the next round (the stop hook requires it anyway).

## Step 6: loop

Run the squad again on the new code with the upgraded kit. Use 2-3 testers:
1. verify each fix;
2. try to break the new behaviour;
3. re-measure context size and stress.

Then one Opus reviewer judges the round. Stop when a round has no MUST
findings and no regressions, or after three rounds; tell the user what
remains.

## Reporting to the user

Short updates as each group reports: what it found, worst first, in plain
words. At the end, give:
- the outcome;
- the few findings that mattered;
- what changed;
- test counts;
- caveats, above all that the stand-in host is not the real one, so a live
  run is still the final test.

## Lessons from the first run

- The stand-in host's fidelity matters more than the number of testers.
- Haiku testers are good at exhaustive repros and poor at judging severity.
  Leave severity to the interpreter and panel.
- "Record and say what wasn't saved" beats "reject and make the model redo
  it": a rejection makes the model regenerate the whole output, so you pay
  twice.
- Measure context cost in billed requests, not just tokens. A reminder that
  makes an agent take another step costs a whole model call.
