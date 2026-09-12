import hashlib
import importlib.util
import json
import pathlib
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from contextlib import closing
from unittest.mock import patch

SCRIPT = pathlib.Path(__file__).resolve().parents[1] / "swim_dashboard_cache.py"
spec = importlib.util.spec_from_file_location("swim_dashboard_cache", SCRIPT)
reader = importlib.util.module_from_spec(spec)
spec.loader.exec_module(reader)


class SwimmingCacheTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="synthetic-swim-")
        self.addCleanup(self.temporary.cleanup)
        self.root = pathlib.Path(self.temporary.name)
        self.database = self.root / "activities.db"
        self.details = self.root / "detail"
        self.details.mkdir()
        with closing(sqlite3.connect(self.database)) as connection, connection:
            connection.execute("""CREATE TABLE activities (
                activity_id TEXT PRIMARY KEY, date TEXT, type TEXT, distance_m REAL,
                duration_s REAL, workout_id TEXT, name TEXT, avg_hr REAL)""")
        self.add_activity("1")

    def add_activity(self, identifier, activity_type="lap_swimming", date="2026-09-12"):
        with closing(sqlite3.connect(self.database)) as connection, connection:
            connection.execute(
                "INSERT INTO activities VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (identifier, date, activity_type, 900, 1200.123, None, "SYNTHETIC_PRIVATE_NAME", 160),
            )

    def write_detail(self, data, identifier="1"):
        (self.details / f"{identifier}.json").write_text(json.dumps(data), encoding="utf-8")

    def read(self, since="2026-09-01", until="2026-09-30"):
        return reader.read_swim_cache(self.database, self.details, since, until)

    def test_dc_sw4_projects_only_approved_swim_fields_without_changing_cache(self):
        self.add_activity("2", "running")
        self.add_activity("3", "open_water_swimming")
        self.add_activity("4", date="2026-08-01")
        self.write_detail({
            "splits": [{
                "distance_m": 25, "duration_s": 40, "active_s": 35, "paused_s": 5,
                "stroke": "FREESTYLE", "active_lengths": 1, "step_idx": 2,
                "avg_hr": 160, "route": "SYNTHETIC_PRIVATE_ROUTE",
            }],
            "fetched_at": "2026-09-12T13:00:00",
            "fetch_status": {"splits": "ok", "weather": "failed", "sets": "skipped"},
            "credentials": "SYNTHETIC_PRIVATE_CREDENTIAL",
            "streams": {"heart_rate": [160]}, "sleep": {"hours": 8},
        })
        before = {path.name: hashlib.sha256(path.read_bytes()).hexdigest()
                  for path in [self.database, *self.details.iterdir()]}
        result = self.read()
        after = {path.name: hashlib.sha256(path.read_bytes()).hexdigest()
                 for path in [self.database, *self.details.iterdir()]}
        self.assertEqual(before, after)
        self.assertEqual([item["activity"]["activity_id"] for item in result], ["1", "3"])
        self.assertNotIn("SYNTHETIC_PRIVATE", json.dumps(result))
        self.assertEqual(result[0]["detail"], {
            "splits": [{
                "distance_m": 25, "duration_s": 40, "active_s": 35, "paused_s": 5,
                "stroke": "freestyle", "active_lengths": 1, "step_idx": 2,
            }],
            "fetched_at": "2026-09-12T13:00:00", "fetch_status": {"splits": "ok"},
        })
        self.assertIsNone(result[1]["detail"])

    def test_dc_sw4_distinguishes_missing_failed_and_unverified_detail(self):
        self.assertIsNone(self.read()[0]["detail"])
        self.write_detail({"splits": [], "fetch_status": {"splits": "failed"}})
        self.assertEqual(self.read()[0]["detail"]["fetch_status"], {"splits": "failed"})
        self.write_detail({"splits": []})
        self.assertNotIn("fetch_status", self.read()[0]["detail"])

    def test_uses_only_a_readonly_database_connection(self):
        native_connect = sqlite3.connect
        with patch.object(reader.sqlite3, "connect", wraps=native_connect) as connect:
            self.read()
        self.assertEqual(connect.call_count, 1)
        self.assertTrue(connect.call_args.args[0].endswith("?mode=ro"))
        self.assertTrue(connect.call_args.kwargs["uri"])

    def test_reads_committed_wal_data_without_changing_it(self):
        with closing(sqlite3.connect(self.database)) as writer:
            writer.execute("PRAGMA journal_mode = WAL")
            writer.execute(
                "INSERT INTO activities VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                ("2", "2026-09-12", "lap_swimming", 1000, 1800, None, "SYNTHETIC_PRIVATE_NAME", 160),
            )
            writer.commit()
            files = [self.database, pathlib.Path(f"{self.database}-wal")]
            before = [hashlib.sha256(path.read_bytes()).hexdigest() for path in files]
            self.assertEqual([item["activity"]["activity_id"] for item in self.read()], ["1", "2"])
            self.assertEqual(before, [hashlib.sha256(path.read_bytes()).hexdigest() for path in files])

    def test_older_schema_has_no_invented_workout_reference(self):
        with closing(sqlite3.connect(self.database)) as connection, connection:
            connection.execute("ALTER TABLE activities DROP COLUMN workout_id")
        self.assertIsNone(self.read()[0]["activity"]["workout_id"])

    def test_rejects_bad_dates_ranges_and_oversized_batches_without_truncation(self):
        for first, last in [
            ("2026-02-30", "2026-03-01"), ("20260901", "2026-09-12"),
            ("2026-09-12", "2026-09-01"), ("2026-01-01", "2026-09-12"),
        ]:
            with self.subTest(first=first), self.assertRaises(reader.CacheReadError):
                self.read(first, last)
        for index in range(2, 52):
            self.add_activity(str(index))
        with self.assertRaisesRegex(reader.CacheReadError, "^too_many_activities$"):
            self.read()

    def test_rejects_invalid_measurements_instead_of_exporting_them(self):
        for value in [-1, float("inf"), True, "SYNTHETIC_PRIVATE_VALUE"]:
            with self.subTest(value=value):
                self.write_detail({"splits": [{"distance_m": value}]})
                with self.assertRaisesRegex(reader.CacheReadError, "^invalid_measurement$"):
                    self.read()

    def test_unknown_stroke_text_is_not_transmitted(self):
        self.write_detail({"splits": [{"stroke": "SYNTHETIC_PRIVATE_UNKNOWN"}]})
        self.assertIsNone(self.read()[0]["detail"]["splits"][0]["stroke"])

    def test_rejects_malformed_and_oversized_detail(self):
        path = self.details / "1.json"
        for contents in [b"not JSON", b"[]", b"\xff", b"{" + b"x" * reader.MAX_DETAIL_BYTES]:
            with self.subTest(size=len(contents)):
                path.write_bytes(contents)
                with self.assertRaises(reader.CacheReadError):
                    self.read()
        self.write_detail({"splits": [{}] * (reader.MAX_SPLITS + 1)})
        with self.assertRaisesRegex(reader.CacheReadError, "^invalid_splits$"):
            self.read()

    def test_limits_whole_batch_size(self):
        with patch.object(reader, "MAX_OUTPUT_BYTES", 1):
            with self.assertRaisesRegex(reader.CacheReadError, "^batch_too_large$"):
                self.read()

    def test_byte_limit_includes_envelope_and_final_newline(self):
        encoded = reader.encode_batch([])
        exact_bytes = len(encoded.encode("utf-8")) + 1
        with patch.object(reader, "MAX_OUTPUT_BYTES", exact_bytes):
            self.assertEqual(reader.encode_batch([]), encoded)
        with patch.object(reader, "MAX_OUTPUT_BYTES", exact_bytes - 1):
            with self.assertRaisesRegex(reader.CacheReadError, "^batch_too_large$"):
                reader.encode_batch([])

    def test_expensive_queries_stop_at_the_deadline_without_partial_results(self):
        with closing(sqlite3.connect(self.database)) as writer, writer:
            writer.executemany(
                "INSERT INTO activities VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                [(str(index), "2026-09-12", "lap_swimming", 900, 1200, None, None, None)
                 for index in range(2, 502)],
            )
        with patch.object(reader.time, "monotonic", side_effect=[0, 6]):
            with self.assertRaisesRegex(reader.CacheReadError, "^database_read_failed$"):
                self.read()

    def test_rejects_cache_timestamps_and_statuses_that_could_contain_unapproved_text(self):
        for fields in [
            {"fetched_at": "SYNTHETIC_PRIVATE_TIMESTAMP"},
            {"fetched_at": "2026-02-30T12:00:00"},
            {"fetched_at": "2026-09-12T12:00:00+22:60"},
            {"fetch_status": {"splits": "SYNTHETIC_PRIVATE_STATUS"}},
        ]:
            with self.subTest(fields=fields):
                self.write_detail({"splits": [], **fields})
                with self.assertRaises(reader.CacheReadError):
                    self.read()

    def test_does_not_create_a_missing_database(self):
        missing = self.root / "missing.db"
        with self.assertRaisesRegex(reader.CacheReadError, "^cache_path_unavailable$"):
            reader.read_swim_cache(missing, self.details, "2026-09-01", "2026-09-12")
        self.assertFalse(missing.exists())

    def test_database_errors_do_not_reveal_paths_or_rows(self):
        self.database.write_bytes(b"NOT A DATABASE SYNTHETIC_PRIVATE_CONTENT")
        result = subprocess.run([
            sys.executable, str(SCRIPT), "--database", str(self.database),
            "--details", str(self.details), "--since", "2026-09-01", "--until", "2026-09-12",
        ], capture_output=True, text=True, check=False, timeout=10)
        self.assertEqual(result.returncode, 1)
        self.assertEqual(result.stdout, "")
        self.assertEqual(json.loads(result.stderr), {"ok": False, "code": "database_read_failed"})
        self.assertNotIn(str(self.root), result.stderr)

    def test_cli_emits_only_a_complete_projected_batch(self):
        result = subprocess.run([
            sys.executable, str(SCRIPT), "--database", str(self.database),
            "--details", str(self.details), "--since", "2026-09-01", "--until", "2026-09-12",
        ], capture_output=True, text=True, check=False, timeout=10)
        self.assertEqual(result.returncode, 0)
        self.assertEqual(result.stderr, "")
        self.assertEqual(json.loads(result.stdout), {"version": 1, "observations": self.read()})
        self.assertNotIn("SYNTHETIC_PRIVATE_NAME", result.stdout)

    def test_rejects_symlink_details_before_opening_them(self):
        with patch.object(pathlib.Path, "is_symlink", return_value=True):
            with self.assertRaisesRegex(reader.CacheReadError, "^unsupported_cache_file$"):
                self.read()

    def test_rejects_an_invalid_identifier_before_reading_a_detail_path(self):
        self.add_activity("../SYNTHETIC_PRIVATE_PATH")
        with self.assertRaisesRegex(reader.CacheReadError, "^invalid_activity_id$"):
            self.read()

    def test_rejects_network_paths_before_filesystem_access(self):
        with patch.object(pathlib.Path, "resolve") as resolve:
            with self.assertRaisesRegex(reader.CacheReadError, "^unsupported_cache_path$"):
                reader.read_swim_cache(r"\\server\share\activities.db", self.details, "2026-09-01", "2026-09-12")
        resolve.assert_not_called()

    def test_cli_argument_errors_do_not_echo_arbitrary_values(self):
        result = subprocess.run([
            sys.executable, str(SCRIPT), "--invalid", "SYNTHETIC_PRIVATE_VALUE",
        ], capture_output=True, text=True, check=False, timeout=10)
        self.assertEqual(result.returncode, 1)
        self.assertEqual(result.stdout, "")
        self.assertEqual(json.loads(result.stderr), {"ok": False, "code": "invalid_arguments"})

    def test_cli_never_emits_a_partial_batch_on_a_later_failure(self):
        self.add_activity("2")
        (self.details / "2.json").write_text("SYNTHETIC_INVALID_DETAIL", encoding="utf-8")
        result = subprocess.run([
            sys.executable, str(SCRIPT), "--database", str(self.database),
            "--details", str(self.details), "--since", "2026-09-01", "--until", "2026-09-12",
        ], capture_output=True, text=True, check=False, timeout=10)
        self.assertEqual(result.returncode, 1)
        self.assertEqual(result.stdout, "")
        self.assertEqual(json.loads(result.stderr), {"ok": False, "code": "invalid_detail"})


def synthetic_batch():
    case = SwimmingCacheTests()
    case.setUp()
    try:
        case.write_detail({
            "splits": [{
                "distance_m": 25, "duration_s": 40.125, "active_s": 35.125,
                "paused_s": 5, "stroke": "FREESTYLE", "active_lengths": 1, "step_idx": 2,
                "avg_hr": 160,
            }],
            "fetched_at": "2026-09-12T13:00:00",
            "fetch_status": {"splits": "ok", "weather": "failed"},
            "credentials": "SYNTHETIC_PRIVATE_CREDENTIAL",
        })
        return case.read()
    finally:
        case.doCleanups()


if __name__ == "__main__":
    if sys.argv[1:] == ["--synthetic-batch"]:
        print(json.dumps(synthetic_batch()))
    else:
        unittest.main()
