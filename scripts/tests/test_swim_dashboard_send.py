import contextlib
import importlib.util
import io
import json
import os
import pathlib
import sqlite3
import ssl
import subprocess
import sys
import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock, patch


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


ROOT = pathlib.Path(__file__).resolve().parents[1]
sender = load("swim_dashboard_send", ROOT / "swim_dashboard_send.py")
fixtures = load("cache_fixtures", ROOT / "tests" / "test_swim_dashboard_cache.py")
KEY = "swim_" + "a" * 43
ENDPOINT = "https://getsxc.app/api/swim/import"
ID = "11111111-1111-4111-8111-111111111111"


def response(status=201, value=None, headers=None, raw=None):
    result = MagicMock()
    result.status = status
    values = {"Content-Type": "application/json", **(headers or {})}
    result.getheader.side_effect = lambda name, default=None: values.get(name, default)
    result.read.return_value = raw if raw is not None else json.dumps(
        value if value is not None else {"id": ID, "revision": 1, "replayed": status == 200},
    ).encode()
    return result


class SwimmingSenderTests(unittest.TestCase):
    def setUp(self):
        self.fixture = fixtures.SwimmingCacheTests()
        self.fixture.setUp()
        self.addCleanup(self.fixture.doCleanups)
        self.args = SimpleNamespace(
            database=str(self.fixture.database), details=str(self.fixture.details),
            since="2026-09-01", until="2026-09-30", endpoint=ENDPOINT,
        )
        transport = patch.object(sender.http.client, "HTTPSConnection")
        self.factory = transport.start()
        self.addCleanup(transport.stop)
        self.connection = self.factory.return_value
        self.connection.getresponse.return_value = response()

    def argv(self):
        return [
            "--database", self.args.database, "--details", self.args.details,
            "--since", self.args.since, "--until", self.args.until,
        ]

    def test_preview_does_not_read_a_key_or_start_a_sender_and_prints_only_counts(self):
        stdout, stderr = io.StringIO(), io.StringIO()
        with (
            patch.object(sender, "input_key") as key,
            patch.object(sender.subprocess, "run") as run,
            contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr),
        ):
            self.assertEqual(sender.main(self.argv()), 0)
        self.assertEqual(json.loads(stdout.getvalue()), sender.report("preview", 1))
        self.assertEqual(stderr.getvalue(), "")
        self.assertNotIn(self.args.database, stdout.getvalue())
        key.assert_not_called()
        run.assert_not_called()
        self.factory.assert_not_called()

    def test_dc_sw8_transmits_only_the_projection_to_the_exact_https_route(self):
        self.fixture.write_detail({
            "splits": [{"distance_m": 50, "duration_s": 60, "active_s": 50, "avg_hr": 160}],
            "credentials": "SYNTHETIC_PRIVATE_CREDENTIAL", "gps": "SYNTHETIC_PRIVATE_ROUTE",
        })
        self.assertEqual(sender.send(self.args, KEY), sender.report("complete", 1, 1))
        method, path = self.connection.request.call_args.args
        request = self.connection.request.call_args.kwargs
        self.assertEqual((method, path), ("POST", "/api/swim/import"))
        self.assertEqual(request["headers"]["Authorization"], "Bearer " + KEY)
        body = json.loads(request["body"])
        self.assertEqual(set(body), {"version", "activity", "detail"})
        self.assertEqual(body["version"], 1)
        self.assertNotIn("SYNTHETIC_PRIVATE", request["body"].decode())
        self.assertNotIn("avg_hr", request["body"].decode())
        self.assertNotIn(KEY, request["body"].decode())
        self.assertEqual(self.factory.call_args.args, ("getsxc.app",))
        options = self.factory.call_args.kwargs
        self.assertEqual(options["timeout"], sender.SOCKET_TIMEOUT_SECONDS)
        self.assertTrue(options["context"].check_hostname)
        self.assertEqual(options["context"].verify_mode, ssl.CERT_REQUIRED)
        self.connection.close.assert_called_once()

    def test_reports_server_replays_and_corrections_without_local_deduplication(self):
        self.connection.getresponse.side_effect = [
            response(200, {"id": ID, "revision": 1, "replayed": True}),
            response(201, {"id": ID, "revision": 2, "replayed": False}),
        ]
        self.assertEqual(sender.send(self.args, KEY), sender.report("complete", 1, 0, 1))
        self.fixture.write_detail({"splits": [], "fetch_status": {"splits": "ok"}})
        self.assertEqual(sender.send(self.args, KEY), sender.report("complete", 1, 1))
        self.assertEqual(self.connection.request.call_count, 2)

    def test_a_later_invalid_observation_prevents_all_network_requests(self):
        self.fixture.add_activity("2")
        for detail in [
            {"splits": [{"distance_m": -1}]},
            {"splits": [], "fetched_at": "2026-09-12T12:00:00+22:60"},
        ]:
            with self.subTest(detail=detail):
                self.fixture.write_detail(detail, "2")
                with self.assertRaises(sender.cache.CacheReadError):
                    sender.send(self.args, KEY)
        self.factory.assert_not_called()

    def test_checks_each_body_and_the_whole_batch_before_network_access(self):
        body = sender.prepare(self.args)[0]
        with patch.object(sender, "MAX_REQUEST_BYTES", len(body)):
            self.assertEqual(sender.prepare(self.args), [body])
        with patch.object(sender, "MAX_REQUEST_BYTES", len(body) - 1):
            with self.assertRaisesRegex(sender.SendError, "^observation_too_large$"):
                sender.send(self.args, KEY)
        with (
            patch.object(sender.cache, "read_swim_cache", return_value=[{"activity": {}, "detail": None}]),
            patch.object(sender.cache, "MAX_OUTPUT_BYTES", 1),
        ):
            with self.assertRaisesRegex(sender.SendError, "^batch_too_large$"):
                sender.send(self.args, KEY)
        self.factory.assert_not_called()

    def test_stops_on_the_first_unconfirmed_send_without_retrying_or_claiming_the_rest(self):
        self.fixture.add_activity("2")
        self.fixture.add_activity("3")
        self.connection.getresponse.side_effect = [response(), TimeoutError("SYNTHETIC_PRIVATE_ERROR")]
        self.assertEqual(sender.send(self.args, KEY), sender.report("request_timeout", 3, 1, unconfirmed=True))
        self.assertEqual(self.connection.request.call_count, 2)

    def test_refuses_unapproved_destinations_before_cache_reads_or_connection(self):
        for endpoint in [
            "http://getsxc.app/api/swim/import", ENDPOINT + "?key=secret", ENDPOINT + "#fragment",
            "https://getsxc.app.evil.test/api/swim/import", "https://user:pass@getsxc.app/api/swim/import",
            "https://127.0.0.1/api/swim/import", "https://getsxc.app:443/api/swim/import",
            "https://getsxc.app/api/swim/import/../other", "https://getsxc.app/api/swim/import\n",
        ]:
            with self.subTest(endpoint=endpoint), patch.object(sender.cache, "read_swim_cache") as read:
                self.args.endpoint = endpoint
                with self.assertRaisesRegex(sender.SendError, "^unsupported_endpoint$"):
                    sender.send(self.args, KEY)
                read.assert_not_called()
        self.factory.assert_not_called()

    def test_refuses_redirects_and_non_success_statuses_without_reading_error_bodies(self):
        cases = [
            (301, "redirect_refused"), (302, "redirect_refused"), (307, "redirect_refused"),
            (308, "redirect_refused"), (401, "import_key_rejected"), (403, "access_denied"),
            (404, "receiver_unavailable"), (500, "unexpected_response"),
            (413, "observation_too_large"), (422, "observation_rejected"),
            (429, "rate_limited"), (503, "receiver_unavailable"),
        ]
        for status, code in cases:
            with self.subTest(status=status):
                result = response(status, raw=b"SYNTHETIC_PRIVATE_ERROR")
                self.connection.getresponse.return_value = result
                self.assertEqual(sender.send(self.args, KEY), sender.report(code, 1, unconfirmed=True))
                result.read.assert_not_called()
                result.close.assert_called_once()
        self.assertEqual(self.factory.call_count, len(cases))

    def test_rejects_malformed_or_extra_receipt_fields(self):
        for value in [
            {"id": ID, "revision": True, "replayed": False},
            {"id": ID, "revision": 0, "replayed": False},
            {"id": "invalid", "revision": 1, "replayed": False},
            {"id": ID, "revision": 1, "replayed": True},
            {"id": ID, "revision": 1, "replayed": False, "userId": ID},
            [], None,
        ]:
            with self.subTest(value=value):
                self.connection.getresponse.return_value = response(raw=json.dumps(value).encode())
                self.assertEqual(sender.send(self.args, KEY), sender.report("invalid_receipt", 1, unconfirmed=True))
        for raw in [
            b"\xff", b"not JSON", b"x" * (sender.MAX_RECEIPT_BYTES + 1),
            ('{"id":"' + ID + '","revision":1,"revision":2,"replayed":false}').encode(),
        ]:
            self.connection.getresponse.return_value = response(raw=raw)
            self.assertFalse(sender.send(self.args, KEY)["ok"])

    def test_rejects_oversized_or_non_json_receipts_before_reading_them(self):
        for headers in [
            {"Content-Type": "text/html"}, {"Content-Encoding": "gzip"},
            {"Content-Length": "4097"}, {"Content-Length": "9" * 5000},
            {"Content-Length": "invalid"},
        ]:
            with self.subTest(headers=headers):
                result = response(headers=headers)
                self.connection.getresponse.return_value = result
                self.assertFalse(sender.send(self.args, KEY)["ok"])
                result.read.assert_not_called()

    def test_cleanup_failure_does_not_hide_the_original_failure_or_a_confirmed_receipt(self):
        self.connection.close.side_effect = OSError("SYNTHETIC_PRIVATE_CLOSE_ERROR")
        self.connection.getresponse.return_value = response(401)
        self.assertEqual(
            sender.send(self.args, KEY),
            sender.report("import_key_rejected", 1, unconfirmed=True, cleanup_failed=True),
        )
        self.connection.getresponse.return_value = response()
        self.assertEqual(
            sender.send(self.args, KEY),
            sender.report("connection_cleanup_failed", 1, 1, cleanup_failed=True),
        )

    def test_key_input_cannot_fall_back_to_echoed_input(self):
        with (
            patch.dict(os.environ, {}, clear=True),
            patch.object(sys.stdin, "isatty", return_value=True),
            patch.object(sys.stderr, "isatty", return_value=True),
            patch.object(sender.getpass, "getpass", side_effect=sender.getpass.GetPassWarning),
        ):
            with self.assertRaisesRegex(sender.SendError, "^key_input_unavailable$"):
                sender.input_key()
        with patch.dict(os.environ, {}, clear=True), patch.object(sys.stdin, "isatty", return_value=False):
            with self.assertRaisesRegex(sender.SendError, "^import_key_required$"):
                sender.input_key()

    def test_rejects_bad_keys_before_any_cache_access(self):
        for key in ["", "x" * 48, KEY + "\r\nInjected: value", KEY + "a"]:
            with self.subTest(key=key), patch.object(sender.cache, "read_swim_cache") as read:
                with self.assertRaisesRegex(sender.SendError, "^invalid_import_key$"):
                    sender.send(self.args, key)
                read.assert_not_called()
        self.factory.assert_not_called()

    def test_child_receives_key_only_on_stdin_and_does_not_inherit_private_configuration(self):
        completed = SimpleNamespace(returncode=0, stdout=json.dumps(sender.report("complete", 1, 1)).encode())
        with (
            patch.dict(os.environ, {
                "SWIM_IMPORT_KEY": KEY, "SUPABASE_SERVICE_ROLE_KEY": "SYNTHETIC_PRIVATE",
                "HTTPS_PROXY": "https://proxy.invalid", "PYTHONPATH": "SYNTHETIC_PRIVATE_PATH",
            }),
            patch.object(sender.subprocess, "run", return_value=completed) as run,
        ):
            self.assertEqual(sender.run_sender(self.args, KEY), sender.report("complete", 1, 1))
        self.assertNotIn(KEY, " ".join(run.call_args.args[0]))
        self.assertEqual(run.call_args.kwargs["input"], KEY.encode())
        self.assertEqual(run.call_args.kwargs["timeout"], sender.BATCH_TIMEOUT_SECONDS)
        for name in ["SWIM_IMPORT_KEY", "SUPABASE_SERVICE_ROLE_KEY", "HTTPS_PROXY", "PYTHONPATH"]:
            self.assertNotIn(name, run.call_args.kwargs["env"])

    def test_child_errors_and_invalid_reports_are_not_forwarded(self):
        for output in [
            b"SYNTHETIC_PRIVATE_TRACEBACK",
            json.dumps({**sender.report("complete", 1, 1), "raw": "SYNTHETIC_PRIVATE"}).encode(),
            json.dumps(sender.report("complete", 2, 1)).encode(),
            json.dumps(sender.report("secret_user_text")).encode(),
        ]:
            completed = SimpleNamespace(returncode=0, stdout=output)
            self.assertEqual(sender.worker_result(completed), sender.unknown_result("sender_failed"))
        self.assertEqual(
            sender.worker_result(SimpleNamespace(returncode=1, stdout=json.dumps(sender.report("complete", 1, 1)).encode())),
            sender.unknown_result("sender_failed"),
        )

    def test_real_isolated_worker_can_finish_an_empty_batch_without_network_or_cache_writes(self):
        with contextlib.closing(sqlite3.connect(self.fixture.database)) as connection, connection:
            connection.execute("DELETE FROM activities")
        self.assertEqual(sender.run_sender(self.args, KEY), sender.report("complete", 0))

    def test_hard_deadline_terminates_only_the_owned_worker_and_keeps_outcome_unknown(self):
        script = self.fixture.root / "synthetic_slow_sender.py"
        script.write_text("import time\ntime.sleep(60)\n", encoding="utf-8")
        native_popen = subprocess.Popen
        children = []

        def start(*args, **kwargs):
            process = native_popen(*args, **kwargs)
            children.append(process)
            return process

        with (
            patch.object(sender, "__file__", str(script)),
            patch.object(sender, "BATCH_TIMEOUT_SECONDS", 0.2),
            patch.object(subprocess, "Popen", side_effect=start),
        ):
            self.assertEqual(sender.run_sender(self.args, KEY), sender.unknown_result("batch_timeout"))
        self.assertEqual(len(children), 1)
        self.assertIsNotNone(children[0].poll())

    def test_cli_failures_do_not_echo_arguments_or_read_keys_without_an_approved_endpoint(self):
        for args in [
            ["--invalid", "SYNTHETIC_PRIVATE_ARGUMENT"],
            [*self.argv(), "--send", "--endpoint", "https://SYNTHETIC_PRIVATE.invalid"],
        ]:
            stdout, stderr = io.StringIO(), io.StringIO()
            with (
                contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr),
                patch.object(sender, "input_key") as key,
            ):
                self.assertEqual(sender.main(args), 1)
            key.assert_not_called()
            self.assertEqual(stdout.getvalue(), "")
            self.assertNotIn("SYNTHETIC_PRIVATE", stderr.getvalue())
            self.assertFalse(json.loads(stderr.getvalue())["ok"])


def synthetic_requests():
    case = SwimmingSenderTests()
    case.setUp()
    try:
        case.fixture.write_detail({
            "splits": [{"distance_m": 50, "duration_s": 60, "active_s": 55, "stroke": "FREESTYLE"}],
            "credentials": "SYNTHETIC_PRIVATE_CREDENTIAL",
        })
        result = sender.send(case.args, KEY)
        if not result["ok"]:
            raise RuntimeError("synthetic_send_failed")
        return [json.loads(call.kwargs["body"]) for call in case.connection.request.call_args_list]
    finally:
        case.doCleanups()


if __name__ == "__main__":
    if sys.argv[1:] == ["--synthetic-requests"]:
        print(json.dumps(synthetic_requests()))
    else:
        unittest.main()
