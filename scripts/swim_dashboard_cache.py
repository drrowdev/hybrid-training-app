"""Read a bounded, swimming-only projection from explicitly selected local caches.

No Garmin imports, environment discovery, authentication, networking or database
initialization. The application validates these observations before accepting them.
"""

import argparse
import datetime
import json
import math
import pathlib
import re
import sqlite3
import sys
import time

MAX_ACTIVITIES = 50
MAX_DETAIL_BYTES = 2 * 1024 * 1024
MAX_OUTPUT_BYTES = 2 * 1024 * 1024
MAX_SPLITS = 2000
ID = re.compile(r"[0-9]{1,24}\Z")
STROKES = frozenset(
    ["freestyle", "backstroke", "breaststroke", "butterfly", "mixed", "drill"]
)


class CacheReadError(Exception):
    """Only a fixed code may cross the CLI boundary, never source data or paths."""


class CacheArgumentParser(argparse.ArgumentParser):
    def error(self, message):
        raise CacheReadError("invalid_arguments")


def _date(value):
    if not isinstance(value, str):
        raise CacheReadError("invalid_date")
    try:
        parsed = datetime.date.fromisoformat(value)
    except ValueError:
        raise CacheReadError("invalid_date") from None
    if parsed.isoformat() != value:
        raise CacheReadError("invalid_date")
    return parsed


def _id(value, nullable=False):
    if nullable and value is None:
        return None
    if not isinstance(value, str) or not ID.fullmatch(value):
        raise CacheReadError("invalid_activity_id")
    return value


def _number(value, maximum, nullable=False, integer=False):
    if nullable and value is None:
        return None
    if (
        isinstance(value, bool)
        or not isinstance(value, (int, float))
        or not math.isfinite(value)
        or not 0 <= value <= maximum
        or (integer and int(value) != value)
    ):
        raise CacheReadError("invalid_measurement")
    return value


def _detail(directory, activity_id):
    path = directory / f"{activity_id}.json"
    try:
        if path.is_symlink():
            raise CacheReadError("unsupported_cache_file")
        resolved = path.resolve(strict=True)
        if resolved.parent != directory or not resolved.is_file():
            raise CacheReadError("unsupported_cache_file")
        with resolved.open("rb") as stream:
            contents = stream.read(MAX_DETAIL_BYTES + 1)
    except FileNotFoundError:
        return None
    except OSError:
        raise CacheReadError("cache_read_failed") from None
    if len(contents) > MAX_DETAIL_BYTES:
        raise CacheReadError("detail_too_large")
    try:
        detail = json.loads(contents)
    except (ValueError, UnicodeError, RecursionError):
        raise CacheReadError("invalid_detail") from None
    if not isinstance(detail, dict):
        raise CacheReadError("invalid_detail")
    splits = detail.get("splits")
    if not isinstance(splits, list) or len(splits) > MAX_SPLITS:
        raise CacheReadError("invalid_splits")
    projected = []
    for split in splits:
        if not isinstance(split, dict):
            raise CacheReadError("invalid_split")
        raw_stroke = split.get("stroke")
        stroke = raw_stroke.lower() if isinstance(raw_stroke, str) else None
        projected.append({
            "distance_m": _number(split.get("distance_m"), 1_000_000, nullable=True),
            "duration_s": _number(split.get("duration_s"), 86_400, nullable=True),
            "active_s": _number(split.get("active_s"), 86_400, nullable=True),
            "paused_s": _number(split.get("paused_s"), 86_400, nullable=True),
            "stroke": stroke if stroke in STROKES else None,
            "active_lengths": _number(split.get("active_lengths"), 2000, nullable=True, integer=True),
            "step_idx": _number(split.get("step_idx"), 10000, nullable=True, integer=True),
        })
    result = {"splits": projected}
    fetched_at = detail.get("fetched_at")
    if fetched_at is not None:
        if (
            not isinstance(fetched_at, str)
            or len(fetched_at) > 40
            or not re.fullmatch(
                r"\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d"
                r"(?:\.\d{1,6})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)?",
                fetched_at,
            )
        ):
            raise CacheReadError("invalid_cache_timestamp")
        try:
            datetime.datetime.fromisoformat(fetched_at.replace("Z", "+00:00"))
        except ValueError:
            raise CacheReadError("invalid_cache_timestamp") from None
        result["fetched_at"] = fetched_at
    statuses = detail.get("fetch_status")
    if statuses is not None:
        if not isinstance(statuses, dict):
            raise CacheReadError("invalid_cache_status")
        status = statuses.get("splits")
        if status is not None and status not in ("ok", "empty", "failed"):
            raise CacheReadError("invalid_cache_status")
        result["fetch_status"] = {} if status is None else {"splits": status}
    return result


def read_swim_cache(database_path, detail_directory, since, until):
    """Return all selected observations, or fail without emitting a partial batch."""
    first, last = _date(since), _date(until)
    if first > last or (last - first).days > 30:
        raise CacheReadError("invalid_date_range")
    if any(str(path).startswith(("\\\\", "//")) for path in (database_path, detail_directory)):
        raise CacheReadError("unsupported_cache_path")
    try:
        database = pathlib.Path(database_path).resolve(strict=True)
        details = pathlib.Path(detail_directory).resolve(strict=True)
    except OSError:
        raise CacheReadError("cache_path_unavailable") from None
    if not database.is_file() or not details.is_dir():
        raise CacheReadError("cache_path_unavailable")
    connection = None
    try:
        connection = sqlite3.connect(f"{database.as_uri()}?mode=ro", uri=True, timeout=1)
        connection.row_factory = sqlite3.Row
        deadline = time.monotonic() + 5
        connection.set_progress_handler(lambda: int(time.monotonic() >= deadline), 1000)
        connection.execute("PRAGMA query_only = ON")
        columns = {row["name"] for row in connection.execute("PRAGMA table_info(activities)")}
        required = {"activity_id", "date", "type", "distance_m", "duration_s"}
        if not required.issubset(columns):
            raise CacheReadError("unsupported_activity_schema")
        workout = "workout_id" if "workout_id" in columns else "NULL AS workout_id"
        rows = connection.execute(
            f"""SELECT activity_id, date, type, distance_m, duration_s, {workout}
                FROM activities
                WHERE type IN ('lap_swimming', 'open_water_swimming')
                  AND date >= ? AND date <= ?
                ORDER BY date, activity_id LIMIT ?""",
            (since, until, MAX_ACTIVITIES + 1),
        ).fetchall()
    except sqlite3.Error:
        raise CacheReadError("database_read_failed") from None
    finally:
        if connection is not None:
            connection.close()
    if len(rows) > MAX_ACTIVITIES:
        raise CacheReadError("too_many_activities")
    observations = []
    for row in rows:
        activity_id = _id(row["activity_id"])
        activity = {
            "activity_id": activity_id,
            "date": _date(row["date"]).isoformat(),
            "type": row["type"],
            "distance_m": _number(row["distance_m"], 1_000_000),
            "duration_s": _number(row["duration_s"], 86_400),
            "workout_id": _id(row["workout_id"], nullable=True),
        }
        observations.append({"activity": activity, "detail": _detail(details, activity_id)})
        encode_batch(observations)
    encode_batch(observations)
    return observations


def encode_batch(observations):
    output = json.dumps({"version": 1, "observations": observations}, allow_nan=False)
    if len(output.encode("utf-8")) + 1 > MAX_OUTPUT_BYTES:
        raise CacheReadError("batch_too_large")
    return output


def main():
    parser = CacheArgumentParser(description=__doc__)
    parser.add_argument("--database", required=True)
    parser.add_argument("--details", required=True)
    parser.add_argument("--since", required=True)
    parser.add_argument("--until", required=True)
    try:
        args = parser.parse_args()
        observations = read_swim_cache(args.database, args.details, args.since, args.until)
        output = encode_batch(observations)
    except CacheReadError as error:
        print(json.dumps({"ok": False, "code": str(error)}), file=sys.stderr)
        return 1
    sys.stdout.buffer.write(output.encode("utf-8") + b"\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
