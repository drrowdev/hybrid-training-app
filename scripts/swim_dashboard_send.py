"""Preview or send selected swimming observations to getsxc."""

import argparse
import getpass
import http.client
import importlib.util
import json
import os
import pathlib
import re
import ssl
import subprocess
import sys
import uuid
import warnings
from urllib.parse import urlsplit

READER_PATH = pathlib.Path(__file__).with_name("swim_dashboard_cache.py")
SPEC = importlib.util.spec_from_file_location("swim_dashboard_cache", READER_PATH)
cache = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(cache)

ENDPOINTS = frozenset([
    "https://getsxc.app/api/swim/import",
    "https://hybrid-training-app-swim-review-drrowdevs-projects.vercel.app/api/swim/import",
])
MAX_REQUEST_BYTES = 1024 * 1024
MAX_RECEIPT_BYTES = 4096
SOCKET_TIMEOUT_SECONDS = 30
BATCH_TIMEOUT_SECONDS = 180
KEY = re.compile(r"swim_[A-Za-z0-9_-]{43}\Z")
ERROR_CODES = frozenset("""
invalid_arguments invalid_date invalid_date_range unsupported_cache_path
cache_path_unavailable unsupported_activity_schema database_read_failed
too_many_activities invalid_activity_id invalid_measurement unsupported_cache_file
cache_read_failed detail_too_large invalid_detail invalid_splits invalid_split
invalid_cache_timestamp invalid_cache_status batch_too_large unsupported_endpoint
invalid_import_key import_key_required key_input_unavailable observation_too_large
invalid_receipt import_key_rejected access_denied receiver_unavailable
observation_rejected rate_limited unexpected_response redirect_refused request_timeout
request_failed connection_cleanup_failed sender_failed batch_timeout sender_start_failed
invalid_input cancelled
""".split())


class SendError(Exception):
    def __init__(self, code, confirmed_replay=None):
        super().__init__(code)
        self.confirmed_replay = confirmed_replay
        self.cleanup_failed = False


class ArgumentParser(argparse.ArgumentParser):
    def error(self, message):
        raise SendError("invalid_arguments")


def report(code, selected=None, imported=0, replayed=0, unconfirmed=False, cleanup_failed=False):
    return {
        "ok": code in ("preview", "complete"),
        "code": code,
        "selected": selected,
        "confirmed": imported + replayed,
        "imported": imported,
        "replayed": replayed,
        "unconfirmed": unconfirmed,
        "cleanup_failed": cleanup_failed,
    }


def unknown_result(code):
    result = report(code, unconfirmed=True)
    for field in ("confirmed", "imported", "replayed"):
        result[field] = None
    return result


def validate_key(key):
    if not isinstance(key, str) or not KEY.fullmatch(key):
        raise SendError("invalid_import_key")
    return key


def input_key():
    key = os.environ.get("SWIM_IMPORT_KEY")
    if key is None:
        if not sys.stdin.isatty() or not sys.stderr.isatty():
            raise SendError("import_key_required")
        try:
            with warnings.catch_warnings():
                warnings.simplefilter("error", getpass.GetPassWarning)
                key = getpass.getpass("Import key: ")
        except (EOFError, OSError, getpass.GetPassWarning):
            raise SendError("key_input_unavailable") from None
    return validate_key(key.strip())


def prepare(args):
    observations = cache.read_swim_cache(args.database, args.details, args.since, args.until)
    bodies = [
        json.dumps({"version": 1, **item}, allow_nan=False, separators=(",", ":")).encode("utf-8")
        for item in observations
    ]
    if any(len(body) > MAX_REQUEST_BYTES for body in bodies):
        raise SendError("observation_too_large")
    if sum(map(len, bodies)) > cache.MAX_OUTPUT_BYTES:
        raise SendError("batch_too_large")
    return bodies


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("duplicate_field")
        result[key] = value
    return result


def receipt(response):
    if response.status not in (200, 201):
        code = {
            401: "import_key_rejected", 403: "access_denied", 404: "receiver_unavailable",
            413: "observation_too_large", 422: "observation_rejected",
            429: "rate_limited", 503: "receiver_unavailable",
        }.get(response.status, "unexpected_response")
        if 300 <= response.status < 400:
            code = "redirect_refused"
        raise SendError(code)
    if response.getheader("Content-Type", "").split(";")[0].strip().lower() != "application/json":
        raise SendError("invalid_receipt")
    if response.getheader("Content-Encoding", "identity").lower() != "identity":
        raise SendError("invalid_receipt")
    length = response.getheader("Content-Length")
    if length is not None and (
        len(length) > 10 or not re.fullmatch(r"[0-9]+", length) or int(length) > MAX_RECEIPT_BYTES
    ):
        raise SendError("invalid_receipt")
    raw = response.read(MAX_RECEIPT_BYTES + 1)
    if len(raw) > MAX_RECEIPT_BYTES:
        raise SendError("invalid_receipt")
    try:
        value = json.loads(raw.decode("utf-8"), object_pairs_hook=unique_object)
        if (
            not isinstance(value, dict)
            or set(value) != {"id", "revision", "replayed"}
            or not isinstance(value["id"], str)
            or str(uuid.UUID(value["id"])) != value["id"]
            or type(value["revision"]) is not int
            or not 1 <= value["revision"] <= 2**53 - 1
            or type(value["replayed"]) is not bool
            or value["replayed"] != (response.status == 200)
        ):
            raise ValueError("invalid_receipt")
    except (ValueError, UnicodeError, RecursionError):
        raise SendError("invalid_receipt") from None
    return value["replayed"]


def post(endpoint, key, body):
    if endpoint not in ENDPOINTS:
        raise SendError("unsupported_endpoint")
    validate_key(key)
    target = urlsplit(endpoint)
    connection = None
    response = None
    confirmed_replay = None
    failure = None
    try:
        connection = http.client.HTTPSConnection(
            target.hostname, timeout=SOCKET_TIMEOUT_SECONDS, context=ssl.create_default_context(),
        )
        connection.request("POST", target.path, body=body, headers={
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        })
        response = connection.getresponse()
        confirmed_replay = receipt(response)
    except SendError as error:
        failure = error
    except TimeoutError:
        failure = SendError("request_timeout")
    except (OSError, http.client.HTTPException):
        failure = SendError("request_failed")
    finally:
        for resource in (response, connection):
            if resource is not None:
                try:
                    resource.close()
                except OSError:
                    if failure is None:
                        failure = SendError("connection_cleanup_failed", confirmed_replay)
                    failure.cleanup_failed = True
    if failure is not None:
        raise failure
    return confirmed_replay


def send(args, key):
    if args.endpoint not in ENDPOINTS:
        raise SendError("unsupported_endpoint")
    validate_key(key)
    bodies = prepare(args)
    imported = replayed = 0
    for body in bodies:
        try:
            duplicate = post(args.endpoint, key, body)
        except SendError as error:
            if error.confirmed_replay is not None:
                replayed += int(error.confirmed_replay)
                imported += int(not error.confirmed_replay)
            return report(
                str(error), len(bodies), imported, replayed,
                unconfirmed=error.confirmed_replay is None,
                cleanup_failed=error.cleanup_failed,
            )
        replayed += int(duplicate)
        imported += int(not duplicate)
    return report("complete", len(bodies), imported, replayed)


def worker_result(completed):
    # Never forward child stderr, paths, exception text or an unvalidated response.
    if completed.returncode not in (0, 1) or len(completed.stdout) > MAX_RECEIPT_BYTES:
        return unknown_result("sender_failed")
    try:
        result = json.loads(completed.stdout, object_pairs_hook=unique_object)
        if not isinstance(result, dict) or set(result) != set(report("complete")):
            raise ValueError("invalid_result")
        if (
            type(result["ok"]) is not bool
            or result["ok"] != (completed.returncode == 0)
            or type(result["unconfirmed"]) is not bool
            or type(result["cleanup_failed"]) is not bool
            or not isinstance(result["code"], str)
            or result["code"] not in ERROR_CODES | {"complete"}
        ):
            raise ValueError("invalid_result")
        for field in ("confirmed", "imported", "replayed"):
            if type(result[field]) is not int or not 0 <= result[field] <= cache.MAX_ACTIVITIES:
                raise ValueError("invalid_result")
        selected = result["selected"]
        if selected is not None and (
            type(selected) is not int or not result["confirmed"] <= selected <= cache.MAX_ACTIVITIES
        ):
            raise ValueError("invalid_result")
        if result["confirmed"] != result["imported"] + result["replayed"]:
            raise ValueError("invalid_result")
        if selected is None and result["confirmed"] != 0:
            raise ValueError("invalid_result")
        if result["ok"] and (
            result["code"] != "complete" or result["unconfirmed"] or result["cleanup_failed"]
            or selected != result["confirmed"]
        ):
            raise ValueError("invalid_result")
        if not result["ok"] and result["code"] == "complete":
            raise ValueError("invalid_result")
    except (ValueError, UnicodeError, RecursionError):
        return unknown_result("sender_failed")
    return result


def run_sender(args, key):
    command = [
        sys.executable, "-I", "-B", str(pathlib.Path(__file__).resolve()),
        "--database", args.database, "--details", args.details,
        "--since", args.since, "--until", args.until,
        "--endpoint", args.endpoint, "--send", "--worker",
    ]
    environment = {
        name: value for name, value in os.environ.items()
        if name.upper() in {"PATH", "SYSTEMROOT", "WINDIR", "TEMP", "TMP"}
    }
    try:
        # The process deadline also bounds DNS, TLS and slow HTTP headers/body reads.
        completed = subprocess.run(
            command, input=key.encode("ascii"), capture_output=True, timeout=BATCH_TIMEOUT_SECONDS,
            env=environment, check=False,
        )
    except subprocess.TimeoutExpired:
        return unknown_result("batch_timeout")
    except (OSError, ValueError):
        return report("sender_start_failed")
    return worker_result(completed)


def main(argv=None):
    parser = ArgumentParser(description=__doc__)
    parser.add_argument("--database", required=True)
    parser.add_argument("--details", required=True)
    parser.add_argument("--since", required=True)
    parser.add_argument("--until", required=True)
    parser.add_argument("--endpoint")
    parser.add_argument("--send", action="store_true", help="Send the selected swims.")
    parser.add_argument("--worker", action="store_true", help=argparse.SUPPRESS)
    worker = False
    try:
        args = parser.parse_args(argv)
        worker = args.worker
        if args.worker and not args.send:
            raise SendError("invalid_arguments")
        if not args.send:
            result = report("preview", len(prepare(args)))
        elif args.endpoint not in ENDPOINTS:
            raise SendError("unsupported_endpoint")
        elif worker:
            key = sys.stdin.buffer.read(49).decode("ascii")
            result = send(args, key)
        else:
            result = run_sender(args, input_key())
    except (cache.CacheReadError, SendError) as error:
        result = report(str(error))
    except (ValueError, UnicodeError, RecursionError):
        result = report("invalid_input")
    except KeyboardInterrupt:
        result = unknown_result("cancelled")
    print(json.dumps(result), file=sys.stdout if worker or result["ok"] else sys.stderr)
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
