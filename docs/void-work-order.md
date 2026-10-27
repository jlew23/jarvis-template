# Work order: Stranger Things E01, the Void sequence

**For:** the Claude Code agents on Luda's PC (Remote Control sessions, herdr panes).
**Project:** `D:\Users\Luda\Marvin\project-storyteller\` (state lives in `STATE.md` there, shots in `SHOT_LEDGER.csv`).
**Coordination:** the local Agent Hub (`agent-hub/`, open http://127.0.0.1:8765). Read `agent-hub/AGENT_PROTOCOL.md` before you start.

## Definition of done (the user's words)

> Done is not done until Mike falls into the Void, makes a splash, and continues the scene the way it happens in the show. The whole Void sequence, about 2 minutes of the first 7 minutes. Shot-for-shot accurate, animations, the whole nine yards.

So the project is complete only when **all** of these hold:

1. Every Void shot in `SHOT_LEDGER.csv` (scene = `VOID`) is rendered, timed to the reference, and cut in order.
2. Mike's fall into the Void, the water splash, and the continuation after it play as in the reference cut.
3. No character is in T-pose or frozen in any Void shot; El and Mike both animate.
4. Each shot has passed the hub's review gate: at least 2 "pass" verdicts from agents who did not do the work, and no open "fail".

Only the hub's gate marks a task done. Nobody announces "done" in chat by hand.

## What we already know (from earlier sessions)

| Shot | Time (s) | Frames | Framing | Action |
|------|----------|--------|---------|--------|
| RV051 | 92.13 to 93.93 | 2211 to 2254 | WS static | Wide two-shot, holding each other's arms |
| RV085 | 172.59 to 174.51 | 4142 to 4188 | OTS pull | Over Mike's shoulder; El moves in, he lifts her into an embrace |
| RV086 | 174.51 to 178.68 | 4188 to 4288 | MS static | Embrace, wider angle |
| RV087 | 178.68 to 182.60 | 4288 to 4382 | OTS static | Hug close: El's back to camera, Mike's face over her shoulder |
| RV088 | 182.60 to 185.89 | 4382 to 4461 | OTS static | El's face over Mike's shoulder, crying. "I will always be with you." |
| RV089 | 185.89 to 198.16 | 4461 to 4756 | CU push | Foreheads together, then the kiss; slow push in (longest frozen shot) |
| RV090 | 198.16 to 200.49 | 4756 to 4812 | CU static | The kiss, reverse angle |
| RV091 | 200.49 to 206.50 | 4812 to 4956 | OTS static | El after the kiss, through tears. "Goodbye, Mike." |

Known problems, as of the last notes:

- RV085 to RV091 render near-black (luma 3 to 20). **Fix the Void light rig first.** Nothing else in these shots can be judged until it's fixed.
- El has no working animation (T-pose everywhere).
- Flow mocap (Actor 1 and 2, 24 fps, 10 s, 22 bones, Mixamo names, no fingers or face, last 2 frames junk) is in `unreal-package/E01/mocap/incoming/flow_hug_2026-10-12/`. It's meant for RV085 to RV091.
- A sequencer blend bug once rendered every camera, actor and light at half its keyed transform. Check for duplicate sections before you trust a render.
- **Missing here:** the RV numbers for Mike walking in, falling through the surface, the splash, and the continuation. Get them from `SHOT_LEDGER.csv` (scene `VOID`) and enter them in the hub as notes on tasks V03, V04 and V05.

## How to work

- **Executor/advisor:** run the hands-on work (Unreal Python, iClone scripts, renders) as an executor on a cheaper model (Sonnet). An Opus advisor reviews each step against the reference before it's submitted for review.
- **One driver in Unreal at a time.** Respect `EDITOR.lock`. If another agent holds it, claim a task that doesn't need the editor (reference breakdown, mocap cleanup in iClone, Boris FX or Photoshop plates, review verdicts).
- **Tools:** use whatever gets the shot right: Unreal (Sequencer, Niagara or fluid sim for the splash, MRQ), Reallusion iClone/Character Creator (retargeting, facial, AccuLips), Boris FX (Silhouette, Continuum, Sapphire) and Photoshop for comp and cleanup.
- **Proof, not claims:** every submission for review attaches a side-by-side still or contact sheet (reference vs ours) and the frame range. Reviewers compare framing, lens, timing, action and light, and fail anything that doesn't match.

## Order of attack

1. V00 reference breakdown, with the missing RV numbers filled in. (No editor needed.)
2. V01 Void environment and light rig: mirror floor, water plane, fog, rim light.
3. V02 camera match for every Void shot.
4. V06 El un-T-posed, and V07 embrace retarget onto RV085 to RV091.
5. V03 Mike's walk and fall, V04 the splash sim, V05 the continuation.
6. V08 faces, V09 grade, V10 render and edit, V11 comp, V12 final side-by-side signoff.

Run independent tasks in parallel across agents. Only the Unreal-editor tasks are serialized by the lock.
