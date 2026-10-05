# CI and npm publication

## Why the post-merge workflow failed

PR #3 merged successfully as `b839f1f022b0cda735f856ad2487140bd48ac998`.
[The post-merge run](https://github.com/st860923/wasmoon/actions/runs/37388216159/job/112026768437)
built Wasm and JavaScript, passed 107 JavaScript tests and the portable Lua suite,
and reported zero npm audit vulnerabilities. Its final `JS-DevTools/npm-publish@v3`
step failed with `Input required and not supplied: token`: the `NPM_TOKEN` secret
was unavailable to that step. This was not a merge conflict or a runtime failure.

## Normal development: no npm credentials required

`Testing` runs on pull requests, pushes to `main`, and manual dispatch. It keeps
the Node.js 22/24 release and Node.js 22 SAFE_HEAP matrix, tests, audit, and `dist/`
artifacts. It never publishes and does not receive `NPM_TOKEN`.

`NPM package` validates changes to its workflow, release guards, or npm manifests
on pull requests. It builds and tests the runtime, packs the production output,
runs `npm publish --dry-run --ignore-scripts` on that exact tarball without
credentials, and retains the `.tgz` as an Actions artifact for seven days.
A successful dry run does **not** verify registry authentication or publish access.

## Deliberate publication

Use **Actions > NPM package > Run workflow**. The default `dry_run: true` performs
validation only and requires no token. For an actual release:

1. Review `package.json` first. This fork still inherits `wasmoon@1.16.0` and
   upstream repository metadata. Choose a package name you have permission to
   publish, correct its repository metadata, choose an unused version, and update
   `package-lock.json` together. This workflow does not rename or bump a package.
2. Configure an Actions repository secret named `NPM_TOKEN` with npm publish
   permission for the intended package. Do not put its value into workflow inputs,
   source code, logs, or a PR. A GitHub token is not an npm registry token.
3. Dispatch from `main`, set `dry_run: false`, and enter the exact `name@version`
   from `package.json` in `package_spec` (including the scope when applicable).

The preflight rejects non-main releases, missing/mismatched confirmation, private
packages, and unavailable tokens before compilation. Only an explicit manual
release can reach the real `npm publish`. PR/push events cannot authorize it even
if release inputs or credentials are supplied. Credentials are limited to the
preflight and actual publication steps; build/test and dry-run steps do not receive
them. Publication uses public npm access and disables lifecycle scripts on the
already built tarball. Registry, permission, duplicate-version, and other real
publication errors remain failures; no `continue-on-error` masks them.

This workflow retains token-based publishing. npm trusted publishing is an
alternative requiring separate configuration on npm; it is not automatically
configured by this repair.

## Validation and historical runs

`bash test/npm-release-preflight.sh` tests the guards without network access or
publication. It uses a dummy token only to exercise the positive preflight path.
The existing runtime tests remain unchanged. Test-only bytecode artifacts remain
outside `dist/` and the release tarball.

Rerunning an old workflow uses its old revision, so rerunning the original failed
job does not apply this fix. After merging this repair, inspect the new `Testing`
run for the new `main` commit. The historical red run remains an accurate record
of the earlier missing-token failure.

References: [GitHub npm publication](https://docs.github.com/en/actions/tutorials/publish-packages/publish-nodejs-packages),
[npm publish](https://docs.npmjs.com/cli/v11/commands/npm-publish),
[npm trusted publishers](https://docs.npmjs.com/trusted-publishers/).
