"""Fail closed before an explicitly requested npm publication; never print secrets."""

import json
import os
import sys
from pathlib import Path


def validate_request(event_name, ref, dry_run, has_token, repository, package):
    if event_name not in ("workflow_dispatch", "pull_request"):
        raise ValueError("npm publication is not allowed on push; use the manual workflow.")
    if dry_run not in ("true", "false"):
        raise ValueError("DRY_RUN must be explicitly set to true or false.")
    if event_name == "pull_request" and dry_run != "true":
        raise ValueError("Pull requests may only run a credential-free dry run.")
    if not package.get("name") or not package.get("version"):
        raise ValueError("package.json must declare a name and version.")
    if dry_run == "true":
        return "Dry run only: no package will be published and no npm token is required."
    if ref != "refs/heads/main":
        raise ValueError("Real npm publication must be manually dispatched from main.")
    if not has_token:
        raise ValueError(
            "NPM_TOKEN is unavailable. Configure the repository Actions secret before "
            "publishing, or select dry_run=true. Never paste the token into logs or a PR."
        )
    if package.get("private"):
        raise ValueError("Refusing to publish a package marked private.")
    if not repository:
        raise ValueError("GITHUB_REPOSITORY is required for real publication.")
    if package["name"] == "wasmoon" and repository.lower() != "ceifa/wasmoon":
        raise ValueError(
            "This fork still uses the upstream npm name 'wasmoon'. Choose an authorized "
            "distinct package name and update package.json/package-lock.json before publishing."
        )
    return "Publication preflight passed; npm will still verify credentials and package permissions."


def main():
    try:
        package = json.loads(Path("package.json").read_text(encoding="utf-8"))
        message = validate_request(
            os.environ.get("GITHUB_EVENT_NAME", ""),
            os.environ.get("GITHUB_REF", ""),
            os.environ.get("DRY_RUN", ""),
            bool(os.environ.get("NPM_TOKEN", "").strip()),
            os.environ.get("GITHUB_REPOSITORY", ""),
            package,
        )
    except (ValueError, OSError) as error:
        print(f"::error::{error}", file=sys.stderr)
        return 1
    print(message)
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as output:
            output.write(f"## npm publication\n\n{message}\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
