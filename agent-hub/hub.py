#!/usr/bin/env python3
"""Tiny Agent Hub client for agents. Python 3.9+ stdlib only.

Server URL: env AGENT_HUB_URL (default http://127.0.0.1:8765).
"""
import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

BASE = os.environ.get("AGENT_HUB_URL", "http://127.0.0.1:8765").rstrip("/")


def die(msg, code=1):
    print("hub: " + msg, file=sys.stderr)
    sys.exit(code)


def call(method, path, body=None, params=None, timeout=15):
    url = BASE + path
    if params:
        url += "?" + urllib.parse.urlencode(params)
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(url, data=data, method=method,
                                 headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        try:
            msg = json.loads(e.read().decode("utf-8")).get("error", "")
        except Exception:
            msg = ""
        die("server said %d: %s" % (e.code, msg or e.reason))
    except (urllib.error.URLError, ConnectionError, OSError) as e:
        if isinstance(e, TimeoutError) or "timed out" in str(e):
            raise
        die("cannot reach the Agent Hub at %s (%s). Is server.py running? "
            "Set AGENT_HUB_URL if it lives elsewhere (e.g. WSL to Windows host)." % (BASE, getattr(e, "reason", e)))


def fmt(m):
    hhmm = m["ts"][11:16] if len(m.get("ts", "")) >= 16 else "--:--"
    return "[#%d %s] %s: %s" % (m["id"], hhmm, m["from"], m["text"])


def cmd_say(a):
    m = call("POST", "/api/messages", {"from": a.as_name, "text": " ".join(a.text)})
    print("sent #%d" % m["id"])


def cmd_inbox(a):
    msgs = call("GET", "/api/inbox", params={"for": a.as_name, "ack": "1", "all": "1" if a.all else "0"})
    for m in msgs:
        print(fmt(m))


def cmd_status(a):
    body = {"name": a.as_name}
    for k in ("kind", "state", "task", "progress"):
        v = getattr(a, k)
        if v is not None:
            body[k] = v
    call("POST", "/api/agents/heartbeat", body)
    print("ok")


def cmd_task(a):
    body = {"id": a.id, "by": a.as_name}
    if a.status is not None:
        body["status"] = a.status
    if a.owner is not None:
        body["owner"] = a.owner
    if a.note is not None:
        body["note"] = a.note
    if a.proof is not None:
        body["proof"] = a.proof
    call("POST", "/api/project/task", body)
    print("ok")


def cmd_verdict(a):
    p = call("POST", "/api/project/verdict",
             {"id": a.id, "by": a.as_name, "verdict": a.verdict, "reason": a.reason})
    t = next((t for t in p["tasks"] if t["id"] == a.id), {})
    print("recorded; %s is now %s (%s/%s passes)" % (a.id, t.get("status"), t.get("passes"), t.get("required_passes")))


def bar(pct, width=30):
    n = int(round(width * pct / 100.0))
    return "[" + "#" * n + "-" * (width - n) + "]"


def cmd_project(a):
    p = call("GET", "/api/project")
    pr = p["progress"]
    print(p["title"] + ("   ** COMPLETE **" if p["complete"] else ""))
    print("%s %5.1f%% done  (%.1f%% incl. review)" % (bar(pr["done_pct"]), pr["done_pct"], pr["partial_pct"]))
    print()
    for t in p["tasks"]:
        mark = {"done": "[x]", "review": "[?]", "doing": "[~]", "blocked": "[!]"}.get(t["status"], "[ ]")
        extra = " passes %s/%s" % (t["passes"], t["required_passes"]) if t["status"] == "review" else ""
        crit = "" if t.get("goal_critical", True) else " (optional)"
        print("%s %-4s %-7s %-12s %s%s%s" % (mark, t["id"], t["status"], t.get("owner") or "-", t["title"], extra, crit))


def cmd_deliberate(a):
    r = call("POST", "/api/deliberate", {"topic": " ".join(a.topic), "by": a.as_name})
    print("deliberation posted as #%d; participants: %s" % (r["message"]["id"], ", ".join(r["participants"]) or "none live"))


def cmd_roster(a):
    for r in call("GET", "/api/roster"):
        print("%s %-12s %-22s %s%s" % (r.get("emoji", ""), r["name"], r.get("role", ""), r.get("description", ""),
                                       "  [herdr: %s]" % r["herdr"] if r.get("herdr") else ""))


def cmd_watch(a):
    since = 0
    existing = call("GET", "/api/messages", params={"since": 0})
    if existing:
        since = existing[-1]["id"]
    print("watching as %s (Ctrl+C to quit)" % a.as_name, file=sys.stderr)
    try:
        while True:
            try:
                msgs = call("GET", "/api/messages", params={"since": since, "for": a.as_name, "wait": 25}, timeout=40)
            except (TimeoutError, OSError):
                continue
            for m in msgs:
                print(fmt(m), flush=True)
            if msgs:
                since = msgs[-1]["id"]
            else:
                time.sleep(0.2)
    except KeyboardInterrupt:
        pass


def main(argv=None):
    # inbox acks before printing, so never let a console codec (cp1252/cp437) drop messages
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, ValueError):
            pass
    ap = argparse.ArgumentParser(description="Agent Hub client")
    sub = ap.add_subparsers(dest="cmd", required=True)

    def add(name, fn, help_):
        sp = sub.add_parser(name, help=help_)
        sp.set_defaults(fn=fn)
        return sp

    sp = add("say", cmd_say, "post a message")
    sp.add_argument("--as", dest="as_name", required=True)
    sp.add_argument("text", nargs="+")

    sp = add("inbox", cmd_inbox, "print unread messages for you")
    sp.add_argument("--as", dest="as_name", required=True)
    sp.add_argument("--all", action="store_true", help="include messages not addressed to you")

    sp = add("status", cmd_status, "heartbeat / status update")
    sp.add_argument("--as", dest="as_name", required=True)
    sp.add_argument("--kind")
    sp.add_argument("--state")
    sp.add_argument("--task")
    sp.add_argument("--progress", type=int)

    sp = add("task", cmd_task, "claim/update a project task")
    sp.add_argument("id")
    sp.add_argument("--as", dest="as_name", required=True)
    sp.add_argument("--status", choices=["todo", "doing", "review", "done", "blocked"])
    sp.add_argument("--owner")
    sp.add_argument("--note")
    sp.add_argument("--proof", help="path/link to side-by-side proof (required with --status review)")

    sp = add("verdict", cmd_verdict, "review another agent's task")
    sp.add_argument("id")
    sp.add_argument("--as", dest="as_name", required=True)
    sp.add_argument("verdict", choices=["pass", "fail"])
    sp.add_argument("--reason", default="")

    sp = add("deliberate", cmd_deliberate, "ask all live agents for independent positions on a topic")
    sp.add_argument("--as", dest="as_name", default="user")
    sp.add_argument("topic", nargs="*", help="topic (default: what is done against the done definition)")

    add("roster", cmd_roster, "list the team roster")

    add("project", cmd_project, "show project checklist")

    sp = add("watch", cmd_watch, "print new messages as they arrive")
    sp.add_argument("--as", dest="as_name", required=True)

    a = ap.parse_args(argv)
    a.fn(a)


if __name__ == "__main__":
    main()
