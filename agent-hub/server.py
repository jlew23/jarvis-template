#!/usr/bin/env python3
"""Agent War Room (Agent Hub): a local chat room, agent status board and review-gated project tracker.

Python 3.9+ standard library only. Binds to 127.0.0.1 by default.
"""
import argparse
import json
import queue
import re
import shutil
import subprocess
import sys
import threading
import time
from datetime import datetime, timezone
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse
import mimetypes
import os
import random
import uuid
import urllib.error
import urllib.request

HERE = Path(__file__).resolve().parent
STATIC_DIR = HERE / "static"
MENTION_RE = re.compile(r"@([A-Za-z0-9_.-]+)")
NAME_RE = re.compile(r"^[A-Za-z0-9_.-]{1,64}$")
ANSI_RE = re.compile(r"\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-Z\\-_]")
STATUSES = ("todo", "doing", "review", "done", "blocked")
OFFLINE_AFTER_S = 600
MAX_TEXT = 8000
MAX_BODY = 1024 * 1024
ROSTER_SEED = HERE / "roster.default.json"
APP_TITLE = "Agent War Room"
DISCORD_PREFIXES = ("https://discord.com/api/webhooks/", "https://discordapp.com/api/webhooks/")
DEFAULT_TOPIC = "What is done and what is not done on the current mission, against its done definition?"
DELIBERATE_SUFFIX = (" Each agent: reply independently with your position BEFORE reading others; "
                     "then one rebuttal; end with VERDICT: done|not-done and why.")


def now_utc():
    return datetime.now(timezone.utc)


def iso(dt=None):
    return (dt or now_utc()).isoformat(timespec="seconds")


def parse_iso(s):
    try:
        dt = datetime.fromisoformat(s)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except Exception:
        return None


def parse_mentions(text):
    out = []
    for m in MENTION_RE.findall(text or ""):
        m = m.rstrip(".-")
        if not m:
            continue
        if m.lower() in ("all", "everyone"):
            m = "all"
        if m not in out:
            out.append(m)
    return out or ["all"]


def valid_discord_url(url):
    url = str(url or "").strip()
    return url.startswith(DISCORD_PREFIXES) and len(url) > len(DISCORD_PREFIXES[0]) and " " not in url


def discord_payload(frm, role, text):
    """Build the outbound Discord webhook body. Mentions are always neutralised."""
    name = "%s | %s" % (frm, role) if role else str(frm)
    return {"username": name[:80], "content": str(text)[:1900], "allowed_mentions": {"parse": []}}


def default_discord_send(url, payload, timeout=5):
    """POST to the webhook. Returns (status, retry_after_seconds_or_None, error_or_None). Never raises."""
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=data, method="POST", headers={
        "Content-Type": "application/json", "User-Agent": "AgentWarRoom/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, None, None
    except urllib.error.HTTPError as e:
        retry = None
        if e.code == 429:
            try:
                retry = float(json.loads(e.read().decode("utf-8")).get("retry_after", 1))
            except Exception:
                retry = 1.0
        return e.code, retry, "HTTP %d" % e.code
    except Exception as e:  # message deliberately excludes the URL
        return 0, None, type(e).__name__


class ApiError(Exception):
    def __init__(self, code, msg):
        super().__init__(msg)
        self.code = code
        self.msg = msg


# ---------------------------------------------------------------- herdr parsing

def normalize_state(s):
    s = str(s or "").strip().lower()
    if s in ("running", "busy", "active", "working", "thinking", "executing"):
        return "working"
    if s in ("idle", "done", "blocked", "offline"):
        return s
    return s or "idle"


def parse_herdr_agents(obj):
    """Leniently turn herdr output into [{name, kind, state}]."""
    items = None
    if isinstance(obj, list):
        items = obj
    elif isinstance(obj, dict):
        cur = obj
        for _ in range(3):
            if isinstance(cur, list):
                items = cur
                break
            if isinstance(cur, dict):
                if isinstance(cur.get("agents"), list):
                    items = cur["agents"]
                    break
                if "result" in cur:
                    cur = cur["result"]
                    continue
            break
        if items is None and isinstance(cur, list):
            items = cur
    out = []
    for a in items or []:
        if not isinstance(a, dict):
            continue
        name = a.get("name") or a.get("agent_name") or a.get("id")
        if not name:
            continue
        name = str(name)
        if not NAME_RE.match(name):
            continue
        kind = a.get("kind") or a.get("agent") or a.get("type") or "herdr"
        state = a.get("state") or a.get("status") or "idle"
        out.append({"name": name, "kind": str(kind), "state": normalize_state(state)})
    return out


# ---------------------------------------------------------------- hub state

MIME_TYPES = {".html": "text/html", ".css": "text/css", ".js": "application/javascript",
              ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png",
              ".ico": "image/x-icon", ".txt": "text/plain"}


def write_json_atomic(path, obj):
    tmp = path.with_name(path.name + ".%s.tmp" % uuid.uuid4().hex[:8])
    try:
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(obj, f, indent=2, ensure_ascii=False)
        os.replace(tmp, path)
    finally:
        if tmp.exists():
            tmp.unlink()


def read_json(path, default):
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


class Hub:
    def __init__(self, data_dir, project_seed=None, herdr_path=None, herdr_enabled=False,
                 roster_seed=None, discord_url=None, discord_label=None, discord_sender=None):
        self.data_dir = Path(data_dir)
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.lock = threading.RLock()
        self.msg_cond = threading.Condition(self.lock)
        self.clients = []
        self.messages_path = self.data_dir / "messages.jsonl"
        self.agents_path = self.data_dir / "agents.json"
        self.project_path = self.data_dir / "project.json"
        self.cursors_path = self.data_dir / "cursors.json"
        self.messages = []
        if self.messages_path.exists():
            with open(self.messages_path, "r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if line:
                        try:
                            self.messages.append(json.loads(line))
                        except ValueError:
                            pass
        self.meta_path = self.data_dir / "meta.json"
        self.next_id = (max([m["id"] for m in self.messages]) + 1) if self.messages else 1
        try:  # ids stay monotonic across clears and restarts
            self.next_id = max(self.next_id, int(read_json(self.meta_path, {}).get("next_id", 1)))
        except (TypeError, ValueError):
            pass
        self.roster_path = self.data_dir / "roster.json"
        if not self.roster_path.exists():
            try:
                shutil.copyfile(roster_seed or ROSTER_SEED, self.roster_path)
            except OSError as e:
                print("could not seed roster: %s" % e, file=sys.stderr)
        self.roster = [r for r in (self.clean_roster_entry(x) for x in read_json(self.roster_path, [])
                                   if isinstance(x, dict)) if r]
        self.discord = {"enabled": False, "label": (discord_label or "discord").lstrip("#")[:60] or "discord",
                        "last_error": None, "sent": 0}
        self._discord_url = None
        self._discord_send = discord_sender or default_discord_send
        self._discord_q = queue.Queue(maxsize=200)
        if discord_url:
            if valid_discord_url(discord_url):
                self._discord_url = discord_url.strip()
                self.discord["enabled"] = True
                threading.Thread(target=self._discord_loop, daemon=True).start()
            else:
                self.discord["last_error"] = "webhook URL rejected (must start with https://discord.com/api/webhooks/)"
        self.agents = read_json(self.agents_path, {})
        self.cursors = read_json(self.cursors_path, {})
        if not self.project_path.exists() and project_seed:
            try:
                shutil.copyfile(project_seed, self.project_path)
            except OSError as e:
                print("could not copy project seed: %s" % e, file=sys.stderr)
        self.project = read_json(self.project_path, {
            "title": "Untitled project", "required_passes": 2, "done_definition": "", "tasks": []})
        self.herdr = {"enabled": herdr_enabled, "path": herdr_path, "last_error": None, "last_ok_ts": None}
        self.herdr_timeout_ms = "600000"

    # ---- pubsub
    def subscribe(self):
        q = queue.Queue(maxsize=500)
        with self.lock:
            self.clients.append(q)
        return q

    def unsubscribe(self, q):
        with self.lock:
            if q in self.clients:
                self.clients.remove(q)

    def broadcast(self, event, data):
        with self.lock:
            for q in list(self.clients):
                try:
                    q.put_nowait((event, data))
                except queue.Full:
                    pass

    # ---- messages
    def add_message(self, frm, text):
        if not NAME_RE.match(str(frm or "")):
            raise ApiError(400, "invalid 'from' (use letters, digits, _ . -; max 64)")
        text = str(text or "").strip()
        if not text:
            raise ApiError(400, "empty text")
        if len(text) > MAX_TEXT:
            raise ApiError(400, "text too long (max %d)" % MAX_TEXT)
        with self.lock:
            msg = {"id": self.next_id, "ts": iso(), "from": frm, "text": text, "to": parse_mentions(text)}
            self.next_id += 1
            with open(self.messages_path, "a", encoding="utf-8") as f:
                f.write(json.dumps(msg, ensure_ascii=False) + "\n")
            self.messages.append(msg)
            self.msg_cond.notify_all()
        self.broadcast("message", msg)
        self.discord_enqueue(msg)
        return msg

    @staticmethod
    def addressed_to(msg, name):
        n = name.lower()
        if msg["from"].lower() == n:
            return False
        to = [t.lower() for t in msg.get("to", [])]
        return n in to or "all" in to

    def get_messages(self, since=0, for_name=None, wait=0):
        deadline = time.time() + wait
        with self.lock:
            while True:
                out = [m for m in self.messages if m["id"] > since
                       and (not for_name or self.addressed_to(m, for_name))]
                if out or wait <= 0:
                    return out
                remaining = deadline - time.time()
                if remaining <= 0:
                    return out
                self.msg_cond.wait(timeout=remaining)

    def inbox(self, name, ack, include_all=False):
        with self.lock:
            cur = int(self.cursors.get(name.lower(), 0))
            out = [m for m in self.messages if m["id"] > cur and m["from"].lower() != name.lower()
                   and (include_all or self.addressed_to(m, name))]
            if ack and self.messages:
                self.cursors[name.lower()] = self.messages[-1]["id"]
                write_json_atomic(self.cursors_path, self.cursors)
            return out

    # ---- agents
    def upsert_agent(self, name, kind=None, state=None, task=None, progress=None, source="hub"):
        if not NAME_RE.match(str(name or "")):
            raise ApiError(400, "invalid agent name")
        with self.lock:
            key = next((k for k in self.agents if k.lower() == name.lower()), name)
            a = self.agents.get(key) or {"name": key, "kind": "agent", "state": "idle", "task": "",
                                         "progress": 0, "source": source}
            if kind is not None:
                a["kind"] = str(kind)[:64]
            if state is not None:
                a["state"] = normalize_state(str(state)[:32])
            if task is not None:
                a["task"] = str(task)[:300]
            if progress is not None:
                try:
                    a["progress"] = max(0, min(100, int(float(progress))))
                except (TypeError, ValueError, OverflowError):
                    raise ApiError(400, "progress must be a number 0-100")
            a["last_seen"] = iso()
            self.agents[key] = a
            write_json_atomic(self.agents_path, self.agents)
        self.broadcast("agents", self.agents_view())
        return self.view_agent(a)

    @staticmethod
    def view_agent(a):
        a = dict(a)
        ls = parse_iso(a.get("last_seen", ""))
        if ls is None or (now_utc() - ls).total_seconds() > OFFLINE_AFTER_S:
            a["state"] = "offline"
        return a

    # ---- roster
    @staticmethod
    def clean_roster_entry(x):
        name = str(x.get("name") or "").strip()
        if not NAME_RE.match(name):
            return None
        herdr = str(x.get("herdr") or "").strip()
        out = {"name": name, "role": str(x.get("role") or "").strip()[:80],
               "description": str(x.get("description") or "").strip()[:200],
               "emoji": str(x.get("emoji") or "").strip()[:8]}
        if herdr and NAME_RE.match(herdr):
            out["herdr"] = herdr
        return out

    def roster_find(self, name):
        n = str(name or "").lower()
        with self.lock:
            return next((r for r in self.roster if r["name"].lower() == n), None)

    def roster_for_herdr(self, herdr_name):
        n = str(herdr_name or "").lower()
        with self.lock:
            return next((r for r in self.roster if r.get("herdr", "").lower() == n), None)

    def roster_upsert(self, body):
        name = str(body.get("name") or "").strip()
        if not NAME_RE.match(name):
            raise ApiError(400, "invalid name (use letters, digits, _ . -; max 64)")
        for k, cap in (("role", 80), ("description", 200), ("emoji", 8)):
            if k in body and len(str(body.get(k) or "")) > cap:
                raise ApiError(400, "%s too long (max %d)" % (k, cap))
        if body.get("herdr") and not NAME_RE.match(str(body["herdr"]).strip()):
            raise ApiError(400, "invalid herdr name")
        with self.lock:
            cur = self.roster_find(name)
            merged = dict(cur or {"name": name})
            for k in ("role", "description", "emoji", "herdr"):
                if k in body:
                    merged[k] = body[k]
            entry = self.clean_roster_entry(merged)
            if cur:
                self.roster[self.roster.index(cur)] = entry
            else:
                if len(self.roster) >= 100:
                    raise ApiError(400, "roster full (max 100)")
                self.roster.append(entry)
            write_json_atomic(self.roster_path, self.roster)
        self.broadcast("agents", self.agents_view())
        return entry

    def agents_view(self):
        with self.lock:
            out = {}
            for a in self.agents.values():
                v = self.view_agent(a)
                r = self.roster_find(v["name"])
                if not r and v.get("source") == "herdr":
                    r = self.roster_for_herdr(v["name"])
                    if r:
                        v["herdr_name"] = v["name"]
                        v["name"] = r["name"]
                if r:
                    v["name"] = r["name"]
                    v["role"], v["description"], v["emoji"] = r["role"], r["description"], r["emoji"]
                else:
                    v.setdefault("role", "")
                    v.setdefault("description", "")
                    v.setdefault("emoji", "")
                key = v["name"].lower()
                prev = out.get(key)
                if prev is None or (prev["state"] == "offline" and v["state"] != "offline") or (
                        (prev["state"] == "offline") == (v["state"] == "offline")
                        and v.get("last_seen", "") > prev.get("last_seen", "")):
                    out[key] = v
            for r in self.roster:
                if r["name"].lower() not in out:
                    out[r["name"].lower()] = {"name": r["name"], "kind": "roster", "state": "offline", "task": "",
                                              "progress": 0, "source": "roster", "role": r["role"],
                                              "description": r["description"], "emoji": r["emoji"]}
            return sorted(out.values(), key=lambda a: a["name"].lower())

    def live_agents(self):
        return [a["name"] for a in self.agents_view()
                if a["state"] != "offline" and a["name"].lower() not in ("user", "hub")]

    # ---- deliberation / clear
    def deliberate(self, topic, by="user"):
        if not NAME_RE.match(str(by or "")):
            raise ApiError(400, "invalid 'by'")
        topic = str(topic or "").strip()
        if not topic:
            topic = DEFAULT_TOPIC
            dd = str(self.project.get("done_definition") or "").strip()
            if dd:
                topic += " Done definition: " + dd
        topic = topic[:3000]
        if topic[-1] not in ".?!":
            topic += "."
        participants = self.live_agents()
        msg = self.add_message(by, "@all Deliberation: " + topic + DELIBERATE_SUFFIX)
        return msg, participants

    def clear_history(self):
        with self.lock:
            archived = None
            if self.messages_path.exists() and self.messages_path.stat().st_size:
                adir = self.data_dir / "archive"
                adir.mkdir(exist_ok=True)
                archived = adir / ("messages-%s.jsonl" % now_utc().strftime("%Y%m%dT%H%M%S%fZ"))
                shutil.copyfile(self.messages_path, archived)
            write_json_atomic(self.meta_path, {"next_id": self.next_id})
            with open(self.messages_path, "w", encoding="utf-8"):
                pass
            count = len(self.messages)
            self.messages = []
            self.msg_cond.notify_all()
        self.broadcast("cleared", {"count": count, "ts": iso()})
        return {"cleared": count, "archive": archived.name if archived else None}

    # ---- discord mirror (outbound only)
    def discord_enqueue(self, msg):
        if not self.discord["enabled"] or str(msg["from"]).lower().startswith("discord"):
            return
        r = self.roster_find(msg["from"]) or self.roster_for_herdr(msg["from"])
        payload = discord_payload(r["name"] if r else msg["from"], r["role"] if r else "", msg["text"])
        try:
            self._discord_q.put_nowait(payload)
        except queue.Full:
            self.discord["last_error"] = "queue full; message dropped"

    def _discord_loop(self):
        while True:
            payload = self._discord_q.get()
            try:
                for _ in range(3):
                    status, retry, err = self._discord_send(self._discord_url, payload)
                    if status == 429 and retry is not None:
                        time.sleep(min(max(retry, 0.1), 30))
                        continue
                    if 200 <= status < 300:
                        self.discord["sent"] += 1
                        self.discord["last_error"] = None
                    else:
                        self.discord["last_error"] = err or ("HTTP %s" % status)
                    break
            except Exception as e:
                self.discord["last_error"] = type(e).__name__

    def config(self):
        return {"title": APP_TITLE,
                "discord": {"enabled": self.discord["enabled"], "label": self.discord["label"]},
                "herdr": {"enabled": bool(self.herdr.get("enabled"))}}

    # ---- project
    def save_project(self):
        write_json_atomic(self.project_path, self.project)

    def project_view(self):
        with self.lock:
            p = json.loads(json.dumps(self.project))
        req = int(p.get("required_passes", 2))
        total = done = review = 0.0
        crit_done = True
        for t in p.get("tasks", []):
            w = float(t.get("weight", 1))
            total += w
            if t["status"] == "done":
                done += w
            elif t["status"] == "review":
                review += w
            elif t.get("goal_critical", True):
                pass
            if t.get("goal_critical", True) and t["status"] != "done":
                crit_done = False
            rnd = t["rounds"][-1] if t.get("rounds") else None
            t["passes"] = len(self.pass_reviewers(t)) if (rnd and not rnd.get("closed")) else 0
            t["required_passes"] = req
        done_pct = round(100.0 * done / total, 1) if total else 0.0
        partial = round(100.0 * (done + 0.5 * review) / total, 1) if total else 0.0
        p["progress"] = {"done_pct": done_pct, "partial_pct": partial,
                         "done_weight": done, "total_weight": total}
        p["complete"] = bool(total) and crit_done and done_pct >= 100.0
        return p

    @staticmethod
    def pass_reviewers(task):
        rnd = task["rounds"][-1] if task.get("rounds") else None
        if not rnd or rnd.get("closed"):
            return set()
        excluded = {(task.get("owner") or "").lower(), (rnd.get("submitted_by") or "").lower()}
        return {v["by"].lower() for v in rnd["verdicts"]
                if v["verdict"] == "pass" and v["by"].lower() not in excluded}

    def pick_reviewers(self, task, submitter):
        """Randomly assign required_passes + 1 reviewers from live agents (not owner/submitter)."""
        excluded = {(task.get("owner") or "").lower(), (submitter or "").lower(), "user", "hub"}
        live = [a["name"] for a in (self.view_agent(x) for x in self.agents.values())
                if a["state"] != "offline" and a["name"].lower() not in excluded]
        k = min(len(live), int(self.project.get("required_passes", 2)) + 1)
        return sorted(random.sample(live, k)) if k else []

    def find_task(self, tid):
        for t in self.project.get("tasks", []):
            if t["id"] == tid:
                return t
        raise ApiError(404, "no such task: %s" % tid)

    def update_task(self, tid, by, status=None, owner="__unset__", note=None, proof=None):
        if not NAME_RE.match(str(by or "")):
            raise ApiError(400, "'by' is required")
        if owner not in ("__unset__", None) and str(owner).strip() and not NAME_RE.match(str(owner).strip()):
            raise ApiError(400, "invalid owner")
        events = []
        with self.lock:
            t = self.find_task(tid)
            if status is not None:
                if status not in STATUSES:
                    raise ApiError(400, "status must be one of %s" % ", ".join(STATUSES))
                if status == "done":
                    raise ApiError(409, "Tasks cannot be set to 'done' directly. Set status 'review'; "
                                        "the task becomes done only after %d pass verdicts from distinct "
                                        "reviewers other than the owner and no failures."
                                   % int(self.project.get("required_passes", 2)))
                if t["status"] == "done" and status == "review":
                    raise ApiError(409, "task is already done")
                if (status == "review" and t["status"] != "review" and self.project.get("require_proof", True)
                        and not str(proof or "").strip()):
                    raise ApiError(400, "submitting for review needs 'proof': a path or link to the "
                                        "side-by-side still / contact sheet (reference vs ours) and frame range")
            if owner != "__unset__" and t["status"] == "review" and status in (None, "review"):
                raise ApiError(409, "cannot change the owner while a task is in review; "
                                    "move it back to 'doing' first")
            if owner != "__unset__":
                t["owner"] = (str(owner).strip() or None) if owner is not None else None
            if status is not None and status != t["status"]:
                cur = t["rounds"][-1] if t.get("rounds") else None
                if t["status"] == "review" and cur and not cur.get("closed"):
                    cur["closed"] = True
                    cur["result"] = "withdrawn"
                if status in ("doing", "review") and not t.get("owner"):
                    t["owner"] = by
                t["status"] = status
                if status == "review":
                    t.setdefault("rounds", []).append(
                        {"n": len(t.get("rounds", [])) + 1, "started": iso(), "submitted_by": by,
                         "verdicts": [], "closed": False,
                         "proof": str(proof or "").strip()[:1000] or None,
                         "assigned": self.pick_reviewers(t, by)})
                events.append("%s: %s -> %s (by %s)" % (tid, "status", status, by))
            if note:
                t.setdefault("updates", []).append({"ts": iso(), "by": by, "note": str(note)[:1000]})
            self.save_project()
        for e in events:
            self.add_message("hub", "[task] " + e)
        if status == "review" and events:
            with self.lock:
                rnd = dict(self.find_task(tid)["rounds"][-1])
            if rnd.get("assigned"):
                self.add_message("hub", "[review] %s please review %s independently. Proof: %s. "
                                 "Any non-owner may also vote." % (
                                     " ".join("@" + n for n in rnd["assigned"]), tid, rnd.get("proof")))
        self.broadcast("project", self.project_view())
        return self.project_view()

    def add_verdict(self, tid, by, verdict, reason):
        if not NAME_RE.match(str(by or "")):
            raise ApiError(400, "'by' is required")
        if verdict not in ("pass", "fail"):
            raise ApiError(400, "verdict must be 'pass' or 'fail'")
        reason = str(reason or "").strip()
        if verdict == "fail" and not reason:
            raise ApiError(400, "a fail verdict needs a reason")
        note = None
        with self.lock:
            t = self.find_task(tid)
            if t["status"] != "review":
                raise ApiError(409, "task %s is not in review (status: %s)" % (tid, t["status"]))
            rnd = t["rounds"][-1]
            if by.lower() in ((t.get("owner") or "").lower(), (rnd.get("submitted_by") or "").lower()):
                raise ApiError(403, "the task owner or submitter cannot review their own task")
            rnd["verdicts"] = [v for v in rnd["verdicts"] if v["by"].lower() != by.lower()]
            rnd["verdicts"].append({"by": by, "verdict": verdict, "reason": reason[:2000], "ts": iso()})
            req = int(self.project.get("required_passes", 2))
            if verdict == "fail":
                t["status"] = "doing"
                rnd["closed"] = True
                rnd["result"] = "failed"
                note = "[review] %s FAILED by %s: %s. Owner %s must fix and re-submit." % (
                    tid, by, reason, t.get("owner"))
            elif len(self.pass_reviewers(t)) >= req:
                t["status"] = "done"
                t["done_ts"] = iso()
                rnd["closed"] = True
                rnd["result"] = "passed"
                note = "[review] %s is DONE (%d passes)." % (tid, req)
            else:
                note = "[review] %s: pass by %s (%d/%d)." % (tid, by, len(self.pass_reviewers(t)), req)
            self.save_project()
        self.add_message("hub", note)
        self.broadcast("project", self.project_view())
        return self.project_view()

    # ---- health
    def health(self):
        with self.lock:
            return {"ok": True, "herdr": dict(self.herdr),
                    "discord": {k: self.discord[k] for k in ("enabled", "label", "last_error", "sent")},
                    "counts": {"messages": len(self.messages), "agents": len(self.agents),
                               "tasks": len(self.project.get("tasks", []))}}

    # ---- herdr bridge
    def herdr_cmd(self, args, timeout=30):
        """Single choke point for every herdr invocation. argv list only, never a shell."""
        exe = self.herdr.get("path") or "herdr"
        try:
            p = subprocess.run([exe] + list(args), capture_output=True, text=True,
                               timeout=timeout, shell=False, encoding="utf-8", errors="replace")
            if p.returncode != 0 and p.stderr:
                self.herdr["last_error"] = "%s: %s" % (" ".join(args[:3]), p.stderr.strip()[:300])
            return p.returncode, p.stdout, p.stderr
        except Exception as e:  # never crash callers
            self.herdr["last_error"] = "%s: %r" % (" ".join(args[:3]), e)
            return 127, "", str(e)

    def herdr_poll_once(self, runner=None):
        run = runner or self.herdr_cmd
        rc, out, err = run(["agent", "list", "--json"])
        parsed = None
        if rc == 0:
            try:
                parsed = parse_herdr_agents(json.loads(out))
            except ValueError:
                parsed = None
        if parsed is None:
            rc2, out2, err2 = run(["agent", "list"])
            if rc2 == 0:
                try:
                    parsed = parse_herdr_agents(json.loads(out2))
                except ValueError:
                    self.herdr["last_error"] = "herdr agent list: output is not JSON; skipped"
                    return
            else:
                self.herdr["last_error"] = "herdr agent list failed: %s" % (err2 or err or "").strip()[:300]
                return
        for a in parsed:
            try:
                self.upsert_agent(a["name"], kind=a["kind"], state=a["state"], source="herdr")
            except ApiError:
                pass
        self.herdr["last_error"] = None
        self.herdr["last_ok_ts"] = iso()

    def herdr_loop(self):
        while True:
            try:
                self.herdr_poll_once()
            except Exception as e:
                self.herdr["last_error"] = "poll crashed: %r" % e
            time.sleep(5)

    def herdr_targets(self, msg):
        if not self.herdr.get("enabled") or msg["from"] != "user":
            return []
        with self.lock:
            herdr_agents = {k: a for k, a in self.agents.items() if a.get("source") == "herdr"}
        want = set()
        for m in msg["to"]:
            if m == "all":
                for k, a in herdr_agents.items():
                    if self.view_agent(a)["state"] in ("idle", "done", "blocked"):
                        want.add(k)
            else:
                for k in herdr_agents:
                    if k.lower() == m.lower():
                        want.add(k)
                r = self.roster_find(m)
                if r and r.get("herdr"):
                    for k in herdr_agents:
                        if k.lower() == r["herdr"].lower():
                            want.add(k)
        return sorted(k for k in want if not k.startswith("-"))

    def forward_to_herdr(self, msg):
        for name in self.herdr_targets(msg):
            threading.Thread(target=self._forward_one, args=(name, msg["text"]), daemon=True).start()

    def _forward_one(self, name, text):
        prompt = ("[Hub message from user] %s\n(Reply in the hub with: "
                  "python agent-hub/hub.py say --as %s \"...\")" % (text, name))
        rc, _, err = self.herdr_cmd(["agent", "prompt", name, prompt])
        if rc != 0:
            self.add_message("hub", "[herdr] could not deliver to %s: %s" % (name, (err or "").strip()[:300]))
            return
        self.herdr_cmd(["agent", "wait", name, "--timeout", self.herdr_timeout_ms], timeout=620)
        rc, out, _ = self.herdr_cmd(["agent", "read", name, "--source", "recent-unwrapped", "--lines", "40"])
        if rc == 0:
            tail = ANSI_RE.sub("", out).strip()[-1500:]
            if tail:
                try:
                    self.add_message(name, "[herdr transcript tail] " + tail)
                except ApiError:
                    pass


# ---------------------------------------------------------------- HTTP

class Handler(BaseHTTPRequestHandler):
    server_version = "AgentHub/1.0"
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):
        if getattr(self.server, "verbose", False):
            super().log_message(fmt, *args)

    @property
    def hub(self):
        return self.server.hub

    # -- helpers
    def send_json(self, obj, code=200):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def host_ok(self):
        """Block DNS-rebinding: only accept loopback Host headers when bound to loopback."""
        bind = self.server.server_address[0]
        if bind not in ("127.0.0.1", "::1", "localhost"):
            return True
        host = (self.headers.get("Host") or "").lower()
        host = host.rsplit(":", 1)[0] if not host.endswith("]") else host.split("]")[0] + "]"
        return host in ("127.0.0.1", "localhost", "[::1]")

    def read_body(self):
        try:
            n = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            self.close_connection = True
            raise ApiError(400, "bad Content-Length")
        if n < 0:
            self.close_connection = True
            raise ApiError(400, "bad Content-Length")
        if n > MAX_BODY:
            self.close_connection = True
            raise ApiError(413, "body too large")
        raw = self.rfile.read(n) if n else b""  # always drain so keep-alive stays in sync
        ctype = (self.headers.get("Content-Type") or "").split(";")[0].strip().lower()
        if ctype != "application/json":
            raise ApiError(415, "Content-Type must be application/json")
        try:
            obj = json.loads(raw.decode("utf-8") or "{}")
        except ValueError:
            raise ApiError(400, "invalid JSON")
        if not isinstance(obj, dict):
            raise ApiError(400, "JSON body must be an object")
        try:  # reject lone surrogates etc. before they reach state and break every later save
            json.dumps(obj, ensure_ascii=False).encode("utf-8")
        except (UnicodeEncodeError, ValueError):
            raise ApiError(400, "body contains invalid unicode")
        return obj

    def dispatch(self, method):
        try:
            if not self.host_ok():
                raise ApiError(403, "bad Host header")
            u = urlparse(self.path)
            q = {k: v[0] for k, v in parse_qs(u.query).items()}
            path = u.path
            if method == "GET":
                if path in ("/", "/index.html"):
                    return self.serve_static("index.html")
                if path.startswith("/static/"):
                    return self.serve_static(unquote(path[len("/static/"):]))
                if path == "/api/stream":
                    return self.stream()
                return self.get_api(path, q)
            return self.post_api(path)
        except ApiError as e:
            self.send_json({"error": e.msg}, e.code)
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            self.close_connection = True
        except Exception as e:
            try:
                self.send_json({"error": "internal error: %r" % e}, 500)
            except Exception:
                self.close_connection = True

    def do_GET(self):
        self.dispatch("GET")

    def do_POST(self):
        self.dispatch("POST")

    # -- static
    def serve_static(self, rel):
        base = STATIC_DIR.resolve()
        try:
            target = (base / rel).resolve()
            target.relative_to(base)
        except (ValueError, OSError):
            raise ApiError(403, "forbidden")
        if "\x00" in rel or not target.is_file():
            raise ApiError(404, "not found")
        data = target.read_bytes()
        ctype = MIME_TYPES.get(target.suffix.lower(), "application/octet-stream")
        if ctype.startswith("text/") or ctype in ("application/javascript", "application/json"):
            ctype += "; charset=utf-8"
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        self.wfile.write(data)

    # -- GET api
    def get_api(self, path, q):
        hub = self.hub

        def num(key, default=0):
            try:
                return int(q.get(key, default))
            except ValueError:
                raise ApiError(400, "%s must be an integer" % key)

        if path == "/api/messages":
            wait = max(0, min(num("wait"), 55))
            return self.send_json(hub.get_messages(num("since"), q.get("for") or None, wait))
        if path == "/api/inbox":
            name = q.get("for", "")
            if not NAME_RE.match(name):
                raise ApiError(400, "'for' is required")
            return self.send_json(hub.inbox(name, q.get("ack") == "1", q.get("all") == "1"))
        if path == "/api/agents":
            return self.send_json(hub.agents_view())
        if path == "/api/roster":
            return self.send_json(list(hub.roster))
        if path == "/api/config":
            return self.send_json(hub.config())
        if path == "/api/project":
            return self.send_json(hub.project_view())
        if path == "/api/health":
            return self.send_json(hub.health())
        raise ApiError(404, "not found")

    # -- POST api
    def post_api(self, path):
        hub = self.hub
        body = self.read_body()
        if path == "/api/messages":
            msg = hub.add_message(body.get("from"), body.get("text"))
            hub.forward_to_herdr(msg)
            return self.send_json(msg, 201)
        if path == "/api/roster":
            return self.send_json(hub.roster_upsert(body))
        if path == "/api/deliberate":
            msg, parts = hub.deliberate(body.get("topic"), body.get("by") or "user")
            hub.forward_to_herdr(msg)
            return self.send_json({"message": msg, "participants": parts}, 201)
        if path == "/api/clear":
            if body.get("confirm") is not True:
                raise ApiError(400, "clearing history needs {\"confirm\": true}")
            if not NAME_RE.match(str(body.get("by") or "")):
                raise ApiError(400, "'by' is required")
            return self.send_json(hub.clear_history())
        if path == "/api/agents/heartbeat":
            return self.send_json(hub.upsert_agent(body.get("name"), body.get("kind"), body.get("state"),
                                                   body.get("task"), body.get("progress")))
        if path == "/api/project/task":
            owner = body["owner"] if "owner" in body else "__unset__"
            return self.send_json(hub.update_task(str(body.get("id")), body.get("by"), body.get("status"),
                                                  owner, body.get("note"), body.get("proof")))
        if path == "/api/project/verdict":
            return self.send_json(hub.add_verdict(str(body.get("id")), body.get("by"),
                                                  body.get("verdict"), body.get("reason")))
        raise ApiError(404, "not found")

    # -- SSE
    def stream(self):
        hub = self.hub
        q = hub.subscribe()
        try:
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Cache-Control", "no-cache")
            self.send_header("Connection", "close")
            self.end_headers()
            self.close_connection = True

            def emit(event, data):
                self.wfile.write(("event: %s\ndata: %s\n\n" % (event, json.dumps(data, ensure_ascii=False))).encode("utf-8"))
                self.wfile.flush()

            self.wfile.write(b": hello\n\n")
            emit("agents", hub.agents_view())
            emit("project", hub.project_view())
            last_ping = time.time()
            while True:
                try:
                    event, data = q.get(timeout=1.0)
                    emit(event, data)
                except queue.Empty:
                    pass
                if time.time() - last_ping >= self.server.ping_interval:
                    self.wfile.write(b": ping\n\n")
                    self.wfile.flush()
                    last_ping = time.time()
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError, OSError, ValueError):
            pass
        finally:
            hub.unsubscribe(q)


class HubServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True
    ping_interval = 15


def make_server(host, port, hub, ping_interval=15):
    srv = HubServer((host, port), Handler)
    srv.hub = hub
    srv.ping_interval = ping_interval
    return srv


def main(argv=None):
    ap = argparse.ArgumentParser(description="Agent Hub server")
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--data-dir", default=str(HERE / "data"))
    ap.add_argument("--herdr", default=None, help="path to the herdr executable")
    ap.add_argument("--no-herdr", action="store_true")
    ap.add_argument("--project", default=None, help="seed project JSON (used only if data/project.json is absent)")
    ap.add_argument("--discord-webhook", default=None,
                    help="Discord webhook URL for the outbound mirror (or env DISCORD_WEBHOOK_URL)")
    ap.add_argument("--verbose", action="store_true")
    ap.add_argument("--open", action="store_true", help="open the page in a browser once listening")
    args = ap.parse_args(argv)

    herdr_path = None
    if not args.no_herdr:
        herdr_path = args.herdr or shutil.which("herdr")
        if herdr_path and Path(herdr_path).suffix.lower() in (".cmd", ".bat"):
            # cmd.exe re-parses argv for .cmd/.bat, so chat text could inject commands
            print("WARNING: herdr resolves to a .cmd/.bat shim (%s); herdr bridge disabled. "
                  "Pass --herdr with the real herdr.exe path." % herdr_path)
            herdr_path = None
    webhook = args.discord_webhook or os.environ.get("DISCORD_WEBHOOK_URL")
    if webhook and not valid_discord_url(webhook):
        print("WARNING: Discord webhook ignored: it must start with https://discord.com/api/webhooks/")
    hub = Hub(args.data_dir, args.project, herdr_path, bool(herdr_path), discord_url=webhook,
              discord_label=os.environ.get("DISCORD_CHANNEL_LABEL"))
    if herdr_path:
        threading.Thread(target=hub.herdr_loop, daemon=True).start()
    srv = make_server(args.host, args.port, hub)
    srv.verbose = args.verbose
    print("Agent War Room on http://%s:%d  (data: %s, herdr: %s, discord: %s)" % (
        args.host, srv.server_address[1], args.data_dir, herdr_path or "off",
        "on" if hub.discord["enabled"] else "off"))
    if args.open:
        import webbrowser
        host = "127.0.0.1" if args.host in ("0.0.0.0", "::") else args.host
        threading.Timer(0.5, webbrowser.open, ["http://%s:%d/" % (host, srv.server_address[1])]).start()
    if args.host not in ("127.0.0.1", "localhost", "::1"):
        print("WARNING: bound to a non-loopback address; anyone on your network can use this hub.")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        srv.server_close()


if __name__ == "__main__":
    main()
