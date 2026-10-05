#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.."

output() {
    if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
        printf 'publish=%s\n' "$1" >> "$GITHUB_OUTPUT"
    fi
}

fail() {
    printf '::error::%s\n' "$1" >&2
    exit 1
}

# A push, PR, or other event can never authorize publication, even with a token.
if [[ "${GITHUB_EVENT_NAME:-}" != workflow_dispatch ]]; then
    output false
    echo 'Package validation only: this event cannot publish to npm.'
    exit 0
fi

case "${DRY_RUN:-true}" in
    true)
        output false
        echo 'Dry run selected: no npm token is required and nothing will be published.'
        exit 0
        ;;
    false) ;;
    *) fail 'dry_run must be true or false.' ;;
esac

[[ "${GITHUB_REF:-}" == refs/heads/main ]] || fail 'Real npm releases must be dispatched from main.'

package_spec=$(node --input-type=module -e '
    import { readFileSync } from "node:fs";
    const pkg = JSON.parse(readFileSync("package.json", "utf8"));
    if (pkg.private === true || !pkg.name || !pkg.version) {
        throw new Error("A release requires a non-private package with a name and version");
    }
    process.stdout.write(`${pkg.name}@${pkg.version}`);
')

[[ -n "${EXPECTED_PACKAGE:-}" && "$EXPECTED_PACKAGE" == "$package_spec" ]] || \
    fail 'Confirm the exact name@version from package.json in the package_spec input before publishing.'
[[ -n "${NODE_AUTH_TOKEN:-}" ]] || \
    fail 'NPM_TOKEN is unavailable. Configure a repository Actions secret with publish access, or select dry_run. Do not paste tokens into logs or workflow inputs.'

output true
echo 'Release preflight passed. Publication is allowed only after build, tests, audit, and package dry-run succeed.'
