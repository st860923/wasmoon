# CI and npm publication

## Why the post-merge job failed

[PR #3](https://github.com/st860923/wasmoon/pull/3) merged successfully as
`b839f1f022b0cda735f856ad2487140bd48ac998`. The subsequent
[workflow run](https://github.com/st860923/wasmoon/actions/runs/37388216159/job/112026768437)
passed compilation, 107 JavaScript tests, the portable upstream Lua suite, and
`npm audit`. Only the last `JS-DevTools/npm-publish@v3` step failed:

```text
Input required and not supplied: token
```

The action received no usable `NPM_TOKEN`. This is a publication-configuration
failure, not a failed merge or a CfxLua regression. Re-running the unchanged job
without resolving its configuration would fail again.

## Normal merges do not publish packages

`test.yml` now runs on both pull requests and pushes to `main`. It keeps the
Node.js 22/24 release matrix and Node.js 22 SAFE_HEAP build, and adds publication
policy tests. It never reads npm credentials or publishes to a registry. Missing
npm credentials cannot fail these checks; build and test failures still can.

`publish.yml` is separate. It runs manually, with `dry_run` defaulting to `true`.
Pull requests that change this workflow or its policy scripts also run it, but
only in credential-free dry-run mode. The workflow builds and tests production
artifacts, packs them into a tarball, and validates that exact tarball with
`npm publish --dry-run --ignore-scripts`. A successful dry run is **not** proof of
npm authentication, package ownership, or an actual publication. The job summary
explicitly says that nothing was published.

The obsolete third-party publish action is replaced by the npm CLI provided by
the pinned setup-node action. The npm token is supplied only to real-publication
preflight and publication steps, never to dependency installation or tests.

## Deliberate publication

Before a real publication, choose a distinct package name or npm scope that you
are authorized to publish, update package metadata and its lockfile, and select
an unused version. This fork still carries the upstream `wasmoon` package name;
the preflight intentionally refuses to publish that identity from a fork. This
change does not rename the package or assume ownership of any npm scope.

Configure the repository Actions secret `NPM_TOKEN` using an npm credential
allowed to publish the chosen package. Never place credentials in source, PRs,
or logs. This workflow uses token-based authentication; configuring npm trusted
publishing/OIDC would be a separate change.

In **Actions → npm publication → Run workflow**, select **main** and clear
**dry_run** only when an actual public npm release is intended. Real publication
is restricted to explicit manual runs on `main`; missing credentials fail early
with instructions, not a silently skipped release. npm still enforces credential
validity, package permissions, and version uniqueness. This workflow publishes
with `--access public`.

No npm publication or merge is performed by this repair. Existing failed runs
remain in history; the new workflow behavior takes effect after the repair is
merged. The isolated bytecode-enabled Lua test build remains outside the packed
production artifact.

## Policy regression tests

Run without npm credentials or network access:

```sh
python3 -m unittest discover -s .github/scripts -p 'test_*.py' -v
```

The tests cover missing credentials, manual and PR dry runs, forbidden push/PR
publication, main-only publication, upstream identity protection, invalid inputs,
private packages, and token redaction. They never invoke npm publication.

References: [GitHub Actions secrets](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets),
[npm publish](https://docs.npmjs.com/cli/commands/npm-publish/).
