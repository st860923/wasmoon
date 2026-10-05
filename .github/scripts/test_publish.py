"""Publication policy tests use dummy values and never call npm or the network."""

import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from check_publish import validate_request


class PublishPolicyTests(unittest.TestCase):
    def request(self, **changes):
        options = dict(
            event_name="workflow_dispatch",
            ref="refs/heads/main",
            dry_run="true",
            has_token=False,
            repository="st860923/wasmoon",
            package={"name": "wasmoon", "version": "1.16.0"},
        )
        options.update(changes)
        return validate_request(**options)

    def test_manual_dry_run_needs_no_token(self):
        self.assertIn("no package will be published", self.request())

    def test_pull_request_dry_run_needs_no_token(self):
        self.assertIn("Dry run only", self.request(event_name="pull_request", ref="refs/pull/4/merge"))

    def test_push_cannot_publish_even_with_token(self):
        with self.assertRaisesRegex(ValueError, "not allowed on push"):
            self.request(event_name="push", dry_run="false", has_token=True)

    def test_pull_request_cannot_publish_even_with_token(self):
        with self.assertRaisesRegex(ValueError, "only run a credential-free dry run"):
            self.request(event_name="pull_request", dry_run="false", has_token=True)

    def test_unknown_event_is_rejected(self):
        with self.assertRaises(ValueError):
            self.request(event_name="pull_request_target")

    def test_missing_or_invalid_dry_run_fails_closed(self):
        for value in ("", "False", "0", None):
            with self.subTest(value=value), self.assertRaises(ValueError):
                self.request(dry_run=value)

    def test_missing_token_has_actionable_error(self):
        with self.assertRaisesRegex(ValueError, "NPM_TOKEN is unavailable"):
            self.request(dry_run="false")

    def test_real_publication_requires_main(self):
        with self.assertRaisesRegex(ValueError, "dispatched from main"):
            self.request(ref="refs/heads/fix", dry_run="false", has_token=True)

    def test_fork_cannot_publish_upstream_identity(self):
        with self.assertRaisesRegex(ValueError, "upstream npm name"):
            self.request(dry_run="false", has_token=True)

    def test_distinct_identity_can_pass_preflight(self):
        message = self.request(
            dry_run="false", has_token=True,
            package={"name": "@example/wasmoon-cfx", "version": "1.0.0"},
        )
        self.assertIn("preflight passed", message)

    def test_upstream_identity_is_only_allowed_in_upstream_repository(self):
        self.assertIn("preflight passed", self.request(
            dry_run="false", has_token=True, repository="ceifa/wasmoon",
        ))

    def test_private_packages_cannot_publish(self):
        with self.assertRaisesRegex(ValueError, "marked private"):
            self.request(dry_run="false", has_token=True, package={
                "name": "@example/wasmoon-cfx", "version": "1.0.0", "private": True,
            })

    def test_missing_package_identity_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "name and version"):
            self.request(package={})

    def test_missing_repository_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "GITHUB_REPOSITORY"):
            self.request(dry_run="false", has_token=True, repository="")

    def test_cli_errors_do_not_disclose_token(self):
        script = Path(__file__).with_name("check_publish.py").resolve()
        with tempfile.TemporaryDirectory() as directory:
            Path(directory, "package.json").write_text(json.dumps({
                "name": "wasmoon", "version": "1.16.0",
            }), encoding="utf-8")
            result = subprocess.run(
                [sys.executable, str(script)], cwd=directory,
                env={**os.environ, "GITHUB_EVENT_NAME": "workflow_dispatch",
                     "GITHUB_REF": "refs/heads/main", "DRY_RUN": "false",
                     "GITHUB_REPOSITORY": "st860923/wasmoon",
                     "NPM_TOKEN": "dummy-token-never-log-this"},
                capture_output=True, text=True, check=False,
            )
        self.assertEqual(result.returncode, 1)
        self.assertIn("upstream npm name", result.stderr)
        self.assertNotIn("dummy-token-never-log-this", result.stdout + result.stderr)


if __name__ == "__main__":
    unittest.main()
