import http.client
import json
import socket
import tempfile
import threading
import unittest
from pathlib import Path

import importlib.util

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("hub_server", HERE / "server.py")
server = importlib.util.module_from_spec(spec)
spec.loader.exec_module(server)

SEED = {
    "title": "T", "required_passes": 2, "done_definition": "x",
    "tasks": [
        {"id": "A", "title": "a", "weight": 1, "goal_critical": True, "status": "todo", "owner": None, "notes": "", "rounds": []},
        {"id": "B", "title": "b", "weight": 3, "goal_critical": True, "status": "todo", "owner": None, "notes": "", "rounds": []},
        {"id": "C", "title": "c", "weight": 1, "goal_critical": False, "status": "todo", "owner": None, "notes": "", "rounds": []},
    ],
}


class HubCase(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        seed = Path(self.tmp.name) / "seed.json"
        seed.write_text(json.dumps(SEED))
        self.hub = server.Hub(Path(self.tmp.name) / "data", seed)
        self.srv = server.make_server("127.0.0.1", 0, self.hub, ping_interval=1)
        self.port = self.srv.server_address[1]
        self.thread = threading.Thread(target=self.srv.serve_forever, kwargs={"poll_interval": 0.02}, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.srv.shutdown()
        self.srv.server_close()
        self.tmp.cleanup()

    def req(self, method, path, body=None, headers=None):
        c = http.client.HTTPConnection("127.0.0.1", self.port, timeout=5)
        h = {"Content-Type": "application/json"} if body is not None else {}
        h.update(headers or {})
        c.request(method, path, json.dumps(body) if body is not None else None, h)
        r = c.getresponse()
        raw = r.read()
        c.close()
        try:
            return r.status, json.loads(raw)
        except ValueError:
            return r.status, raw

    def task(self, tid):
        return next(t for t in self.req("GET", "/api/project")[1]["tasks"] if t["id"] == tid)

    def submit(self, tid, owner="alice"):
        self.req("POST", "/api/project/task", {"id": tid, "by": owner, "status": "review",
                                                "proof": "proof/%s_side_by_side.jpg" % tid})


class TestMessages(HubCase):
    def test_post_get_mentions(self):
        s, m = self.req("POST", "/api/messages", {"from": "user", "text": "hi @bob and @Carol.x"})
        self.assertEqual(s, 201)
        self.assertEqual(m["id"], 1)
        self.assertEqual(m["to"], ["bob", "Carol.x"])
        s, m2 = self.req("POST", "/api/messages", {"from": "bob", "text": "hello"})
        self.assertEqual(m2["to"], ["all"])
        s, m3 = self.req("POST", "/api/messages", {"from": "user", "text": "@everyone go"})
        self.assertEqual(m3["to"], ["all"])
        self.assertEqual(len(self.req("GET", "/api/messages?since=0")[1]), 3)
        self.assertEqual(len(self.req("GET", "/api/messages?since=1")[1]), 2)
        ids = [x["id"] for x in self.req("GET", "/api/messages?for=bob")[1]]
        self.assertEqual(ids, [1, 3])  # own message excluded
        ids = [x["id"] for x in self.req("GET", "/api/messages?for=zed")[1]]
        self.assertEqual(ids, [2, 3])  # "all" messages only

    def test_validation_and_content_type(self):
        self.assertEqual(self.req("POST", "/api/messages", {"from": "bad name!", "text": "x"})[0], 400)
        self.assertEqual(self.req("POST", "/api/messages", {"from": "a", "text": " "})[0], 400)
        c = http.client.HTTPConnection("127.0.0.1", self.port)
        c.request("POST", "/api/messages", '{"from":"a","text":"x"}', {"Content-Type": "text/plain"})
        r = c.getresponse()
        r.read()
        self.assertEqual(r.status, 415)
        c.close()

    def test_bad_host_rejected(self):
        s, _ = self.req("GET", "/api/agents", headers={"Host": "evil.example.com"})
        self.assertEqual(s, 403)

    def test_persistence(self):
        self.req("POST", "/api/messages", {"from": "a", "text": "one"})
        hub2 = server.Hub(self.hub.data_dir)
        self.assertEqual(hub2.next_id, 2)

    def test_inbox_cursor(self):
        self.req("POST", "/api/messages", {"from": "user", "text": "@bob one"})
        self.req("POST", "/api/messages", {"from": "user", "text": "@carl two"})
        s, ib = self.req("GET", "/api/inbox?for=bob&ack=1")
        self.assertEqual([m["id"] for m in ib], [1])
        self.assertEqual(self.req("GET", "/api/inbox?for=bob&ack=1")[1], [])
        self.req("POST", "/api/messages", {"from": "user", "text": "@bob three"})
        self.assertEqual([m["id"] for m in self.req("GET", "/api/inbox?for=bob&ack=1")[1]], [3])
        # carl's cursor is independent
        self.assertEqual([m["id"] for m in self.req("GET", "/api/inbox?for=carl&ack=0")[1]], [2])
        self.assertEqual([m["id"] for m in self.req("GET", "/api/inbox?for=carl&ack=0")[1]], [2])


class TestAgents(HubCase):
    def test_heartbeat_and_offline(self):
        s, a = self.req("POST", "/api/agents/heartbeat",
                        {"name": "bob", "kind": "claude", "state": "working", "task": "t", "progress": 150})
        self.assertEqual(s, 200)
        self.assertEqual(a["progress"], 100)
        self.assertEqual(self.req("GET", "/api/agents")[1][0]["state"], "working")
        real = server.now_utc
        try:
            from datetime import timedelta
            server.now_utc = lambda: real() + timedelta(minutes=11)
            self.assertEqual(self.req("GET", "/api/agents")[1][0]["state"], "offline")
        finally:
            server.now_utc = real
        # stored state is untouched
        self.assertEqual(self.hub.agents["bob"]["state"], "working")


class TestGate(HubCase):
    def test_direct_done_409(self):
        s, r = self.req("POST", "/api/project/task", {"id": "A", "by": "alice", "status": "done"})
        self.assertEqual(s, 409)
        self.assertEqual(self.task("A")["status"], "todo")

    def test_owner_cannot_pass_own(self):
        self.req("POST", "/api/project/task", {"id": "A", "by": "alice", "owner": "alice", "status": "doing"})
        self.submit("A")
        s, _ = self.req("POST", "/api/project/verdict", {"id": "A", "by": "alice", "verdict": "pass", "reason": "me"})
        self.assertEqual(s, 403)
        self.assertEqual(self.task("A")["passes"], 0)

    def test_owner_cannot_hand_off_then_self_pass(self):
        self.req("POST", "/api/project/task", {"id": "A", "by": "alice", "owner": "alice", "status": "doing"})
        self.submit("A")
        s, _ = self.req("POST", "/api/project/task", {"id": "A", "by": "alice", "owner": "bob"})
        self.assertEqual(s, 409)
        # even if ownership moves via 'doing', the next round's submitter is still excluded
        self.req("POST", "/api/project/task", {"id": "A", "by": "alice", "status": "doing", "owner": "bob"})
        self.req("POST", "/api/project/task", {"id": "A", "by": "alice", "status": "review", "proof": "p.jpg"})
        s, _ = self.req("POST", "/api/project/verdict", {"id": "A", "by": "alice", "verdict": "pass", "reason": "me"})
        self.assertEqual(s, 403)

    def test_review_requires_proof(self):
        s, _ = self.req("POST", "/api/project/task", {"id": "A", "by": "alice", "status": "review"})
        self.assertEqual(s, 400)
        self.assertEqual(self.task("A")["status"], "todo")

    def test_random_reviewers_assigned_and_pinged(self):
        for n in ("bob", "carol", "dave", "erin"):
            self.req("POST", "/api/agents/heartbeat", {"name": n, "state": "idle"})
        self.req("POST", "/api/agents/heartbeat", {"name": "alice", "state": "working"})
        self.submit("A")
        rnd = self.task("A")["rounds"][-1]
        self.assertEqual(len(rnd["assigned"]), 3)
        self.assertNotIn("alice", rnd["assigned"])
        msgs = self.req("GET", "/api/messages?since=0")[1]
        ping = [m for m in msgs if m["from"] == "hub" and "please review A" in m["text"]]
        self.assertEqual(len(ping), 1)
        self.assertEqual(set(ping[0]["to"]), set(rnd["assigned"]))

    def test_verdict_requires_review(self):
        s, _ = self.req("POST", "/api/project/verdict", {"id": "A", "by": "bob", "verdict": "pass", "reason": ""})
        self.assertEqual(s, 409)

    def test_two_distinct_passes_done(self):
        self.submit("A")
        v = lambda by: self.req("POST", "/api/project/verdict", {"id": "A", "by": by, "verdict": "pass", "reason": "ok"})
        v("bob")
        v("bob")  # same reviewer twice does not count twice
        self.assertEqual(self.task("A")["status"], "review")
        self.assertEqual(self.task("A")["passes"], 1)
        v("carol")
        t = self.task("A")
        self.assertEqual(t["status"], "done")
        self.assertEqual(len(t["rounds"]), 1)
        self.assertEqual(t["rounds"][0]["result"], "passed")

    def test_fail_resets(self):
        self.submit("A")
        p = lambda by, verdict, r="": self.req("POST", "/api/project/verdict", {"id": "A", "by": by, "verdict": verdict, "reason": r})
        p("bob", "pass")
        s, _ = p("carol", "fail", "broken")
        self.assertEqual(s, 200)
        self.assertEqual(self.task("A")["status"], "doing")
        self.assertEqual(self.task("A")["passes"], 0)
        self.assertEqual(p("dave", "pass")[0], 409)  # not in review any more
        self.submit("A")
        t = self.task("A")
        self.assertEqual(len(t["rounds"]), 2)
        self.assertEqual(t["passes"], 0)  # fresh round, earlier pass does not carry over
        p("bob", "pass")
        self.assertEqual(self.task("A")["status"], "review")
        p("dave", "pass")
        self.assertEqual(self.task("A")["status"], "done")
        self.assertEqual(self.task("A")["rounds"][0]["result"], "failed")

    def test_progress_math(self):
        def finish(tid):
            self.submit(tid)
            for by in ("bob", "carol"):
                self.req("POST", "/api/project/verdict", {"id": tid, "by": by, "verdict": "pass", "reason": "ok"})
        p = self.req("GET", "/api/project")[1]
        self.assertEqual(p["progress"]["done_pct"], 0)
        finish("A")  # weight 1 of 5
        p = self.req("GET", "/api/project")[1]
        self.assertEqual(p["progress"]["done_pct"], 20.0)
        self.submit("B")  # weight 3 in review
        p = self.req("GET", "/api/project")[1]
        self.assertEqual(p["progress"]["done_pct"], 20.0)
        self.assertEqual(p["progress"]["partial_pct"], 50.0)  # (1 + 1.5) / 5
        self.assertFalse(p["complete"])
        for by in ("bob", "carol"):
            self.req("POST", "/api/project/verdict", {"id": "B", "by": by, "verdict": "pass", "reason": "ok"})
        p = self.req("GET", "/api/project")[1]
        self.assertEqual(p["progress"]["done_pct"], 80.0)
        self.assertFalse(p["complete"])  # C is not critical but overall < 100
        finish("C")
        p = self.req("GET", "/api/project")[1]
        self.assertEqual(p["progress"]["done_pct"], 100.0)
        self.assertTrue(p["complete"])


class TestStatic(HubCase):
    def test_index_and_traversal(self):
        s, body = self.req("GET", "/")
        self.assertEqual(s, 200)
        self.assertIn(b"Agent Hub", body)
        for path in ("/static/../server.py", "/static/%2e%2e/server.py", "/static/..%2fserver.py"):
            c = http.client.HTTPConnection("127.0.0.1", self.port)
            c.putrequest("GET", path, skip_accept_encoding=True)
            c.endheaders()
            r = c.getresponse()
            data = r.read()
            self.assertIn(r.status, (403, 404), path)
            self.assertNotIn(b"ThreadingHTTPServer", data)
            c.close()


class TestSSE(HubCase):
    def test_stream_emits_message(self):
        sock = socket.create_connection(("127.0.0.1", self.port), timeout=5)
        sock.sendall(b"GET /api/stream HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n")
        buf = b""
        while b"event: project" not in buf:  # initial snapshot
            buf += sock.recv(65536)
        self.req("POST", "/api/messages", {"from": "bob", "text": "ping sse"})
        while b"event: message" not in buf:
            buf += sock.recv(65536)
        self.assertIn(b"ping sse", buf)
        sock.close()
        # a dropped client must not break the server
        self.req("POST", "/api/messages", {"from": "bob", "text": "after drop"})
        self.assertEqual(self.req("GET", "/api/health")[0], 200)


class TestHerdr(unittest.TestCase):
    AGENTS = [{"name": "alpha", "state": "working", "kind": "claude"},
              {"agent_name": "beta", "status": "idle", "agent": "codex"},
              {"id": "gamma", "status": "blocked", "type": "pi"}]

    def test_shapes(self):
        for shape in (self.AGENTS, {"agents": self.AGENTS}, {"result": {"agents": self.AGENTS}}):
            out = server.parse_herdr_agents(shape)
            self.assertEqual([a["name"] for a in out], ["alpha", "beta", "gamma"])
            self.assertEqual([a["state"] for a in out], ["working", "idle", "blocked"])
            self.assertEqual([a["kind"] for a in out], ["claude", "codex", "pi"])
        self.assertEqual(server.parse_herdr_agents("junk"), [])

    def test_poll_with_fake_runner_and_fallbacks(self):
        with tempfile.TemporaryDirectory() as d:
            hub = server.Hub(d, herdr_path="herdr", herdr_enabled=True)
            calls = []

            def fake(args, timeout=30):
                calls.append(args)
                if args[-1] == "--json":
                    return 2, "", "unknown flag"
                return 0, json.dumps({"result": {"agents": TestHerdr.AGENTS}}), ""
            hub.herdr_poll_once(fake)
            self.assertEqual(len(calls), 2)
            self.assertEqual({a["name"] for a in hub.agents_view()}, {"alpha", "beta", "gamma"})
            self.assertEqual(hub.agents["alpha"]["source"], "herdr")
            self.assertIsNotNone(hub.herdr["last_ok_ts"])
            # non-JSON output: skipped, error recorded, no crash
            hub.herdr_poll_once(lambda a, timeout=30: (0, "not json", ""))
            self.assertIn("not JSON", hub.herdr["last_error"])

    def test_targets(self):
        with tempfile.TemporaryDirectory() as d:
            hub = server.Hub(d, herdr_path="herdr", herdr_enabled=True)
            hub.upsert_agent("alpha", state="working", source="herdr")
            hub.upsert_agent("beta", state="idle", source="herdr")
            hub.upsert_agent("hubonly", state="idle")
            m = lambda frm, text: {"from": frm, "text": text, "to": server.parse_mentions(text)}
            self.assertEqual(hub.herdr_targets(m("user", "@alpha hi")), ["alpha"])
            self.assertEqual(hub.herdr_targets(m("user", "@all hi")), ["beta"])
            self.assertEqual(hub.herdr_targets(m("user", "@hubonly hi")), [])
            self.assertEqual(hub.herdr_targets(m("alpha", "@beta hi")), [])  # only user messages forward


if __name__ == "__main__":
    unittest.main()
