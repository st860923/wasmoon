#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.."

scratch=$(mktemp -d)
trap 'rm -rf -- "$scratch"' EXIT
package_spec=$(node --input-type=module -e '
    import { readFileSync } from "node:fs";
    const pkg = JSON.parse(readFileSync("package.json", "utf8"));
    process.stdout.write(`${pkg.name}@${pkg.version}`);
')
count=0

check() {
    local name=$1 expected_status=$2 expected_output=$3 status=0
    shift 3
    : > "$scratch/output"
    env -u NODE_AUTH_TOKEN -u EXPECTED_PACKAGE -u DRY_RUN -u GITHUB_EVENT_NAME -u GITHUB_REF \
        GITHUB_OUTPUT="$scratch/output" "$@" \
        bash scripts/npm-release-preflight.sh > "$scratch/log" 2>&1 || status=$?
    if [[ "$status" != "$expected_status" || "$(cat "$scratch/output")" != "$expected_output" ]]; then
        printf 'FAIL: %s (exit %s)\n' "$name" "$status" >&2
        cat "$scratch/log" "$scratch/output" >&2
        exit 1
    fi
    if grep -q 'test-token-never-publish' "$scratch/log" "$scratch/output"; then
        echo 'FAIL: preflight leaked a token' >&2
        exit 1
    fi
    count=$((count + 1))
    printf 'PASS: %s\n' "$name"
}

check 'PR without token' 0 'publish=false' GITHUB_EVENT_NAME=pull_request
check 'Push without token' 0 'publish=false' GITHUB_EVENT_NAME=push GITHUB_REF=refs/heads/main
check 'Push cannot publish even with a token and false dry_run' 0 'publish=false' \
    GITHUB_EVENT_NAME=push GITHUB_REF=refs/heads/main DRY_RUN=false \
    EXPECTED_PACKAGE="$package_spec" NODE_AUTH_TOKEN=test-token-never-publish
check 'PR cannot publish even with release inputs' 0 'publish=false' \
    GITHUB_EVENT_NAME=pull_request GITHUB_REF=refs/heads/main DRY_RUN=false \
    EXPECTED_PACKAGE="$package_spec" NODE_AUTH_TOKEN=test-token-never-publish
check 'Other events cannot publish' 0 'publish=false' GITHUB_EVENT_NAME=release DRY_RUN=false
check 'Dispatch defaults to dry run' 0 'publish=false' GITHUB_EVENT_NAME=workflow_dispatch
check 'Explicit dry run needs no token' 0 'publish=false' GITHUB_EVENT_NAME=workflow_dispatch DRY_RUN=true
check 'Invalid dry_run fails closed' 1 '' GITHUB_EVENT_NAME=workflow_dispatch DRY_RUN=invalid
check 'Non-main release is rejected' 1 '' GITHUB_EVENT_NAME=workflow_dispatch DRY_RUN=false GITHUB_REF=refs/heads/feature
check 'Unconfirmed package is rejected' 1 '' GITHUB_EVENT_NAME=workflow_dispatch DRY_RUN=false GITHUB_REF=refs/heads/main
check 'Wrong package is rejected' 1 '' \
    GITHUB_EVENT_NAME=workflow_dispatch DRY_RUN=false GITHUB_REF=refs/heads/main EXPECTED_PACKAGE=wrong-package@0.0.0
check 'Explicit release without token fails early' 1 '' \
    GITHUB_EVENT_NAME=workflow_dispatch DRY_RUN=false GITHUB_REF=refs/heads/main EXPECTED_PACKAGE="$package_spec"
# This only tests authorization logic. The script never invokes npm or publishes.
check 'Confirmed main release with token passes preflight' 0 'publish=true' \
    GITHUB_EVENT_NAME=workflow_dispatch DRY_RUN=false GITHUB_REF=refs/heads/main \
    EXPECTED_PACKAGE="$package_spec" NODE_AUTH_TOKEN=test-token-never-publish
printf '%s release-preflight tests passed; no network or publication performed.\n' "$count"
