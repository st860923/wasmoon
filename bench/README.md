# Native optimization experiments

Use the SDK in `.emscripten-version`, `npm ci`, and matching JS/Wasm builds.
Do not compare an instrumented training build with a release build for speed.

## Train and apply PGO

The frontend instrumentation records branch/function counts (LLVM's
instrumentation-based PGO/FDO). It does not use CPU samples or value profiling.
Run a representative workload, then validate on different workloads. For example,
in a shell with the pinned Emscripten environment loaded:

```sh
set -euo pipefail
WASMOON_PGO=generate bash build.sh
npm run build
profile_dir=$(mktemp -d ./build/profiles.XXXXXX)
WASMOON_PROFILE_DIR="$profile_dir" node --import ./bench/collect-profile.js \
    ./node_modules/mocha/bin/mocha.js --require ./test/boot.js 'test/*.test.js'
# Run application workloads with the same preload and output directory here.
"$EMSDK/upstream/bin/llvm-profdata" merge "$profile_dir" -o build/runtime.profdata
"$EMSDK/upstream/bin/llvm-profdata" show build/runtime.profdata
WASMOON_PGO=use WASMOON_PROFILE=build/runtime.profdata bash build.sh
npm run build
npm test
```

The collector observes the same `LuaFactory` module the workload imports. Set
`WASMOON_PROFILE_ENTRY` to an absolute path or file URL when training another
matching bundle. Each process/module writes a separate `.profraw` file after
its workload. Only merge outputs of successful training commands; start each
training run in a fresh directory. Keep the source revision, SDK version,
training commands and merged profile with any release that uses PGO. Profiles
must be regenerated when the native source changes; mismatched function hashes
fail the build. Do not use sparse profile merging for optimization.

Emscripten 6.0.10 bundles a version-10 profiling runtime with a version-11
compiler. The training build fetches the profiling runtime from the SDK's exact
LLVM revision using `tools/profile-runtime-sources.json`, verifies every SHA-256,
and builds its supported buffer-only configuration. It does not modify the SDK.
`bench/collect-profile.js` exports buffers through Node instead of relying on
process-exit filesystem support in Wasm. These helpers and counters are absent
from a PGO-use or ordinary release build. Never publish a PGO-generate bundle.

## SIMD and LTO

`WASMOON_SIMD=1 bash build.sh` enables `-msimd128` and LLVM auto-vectorization.
It can be combined with `WASMOON_PGO=use`. No fast-math or relaxed SIMD flags are
used. SIMD binaries require a Wasm SIMD-capable host; test each supported Node
and browser version before distributing them.

`WASMOON_LTO=1` additionally enables full LTO and passes
`-Wl,-mllvm,-wasm-enable-eh`. That forwarding is required by the pinned SDK to
retain C++ exception handlers during link-time code generation. Test Lua errors,
coroutine yields, Promise rejection and cleanup with any LTO build.

Ordinary builds leave these options off. An optimization flag being supported
does not establish that it improves an application's end-to-end execution time.
Run `node bench/runtime.js /absolute/path/to/dist/index.js` for the assertion-backed
microbenchmarks, and alternate fresh processes for actual application workloads.
Do not compile or run other benchmarks concurrently with measurements.

## Coroutine and interpreter changes

Ordinary Wasm builds use Lua's switch dispatcher. The C computed-goto dispatcher
has to be lowered to structured Wasm control flow; it is not a native threaded
interpreter in this target. Keep actual application benchmarks alongside the
arithmetic loop when evaluating either implementation.

`patches/lua-coroutine-yield.patch` applies to disposable copies of the pinned Lua
sources. Only the built-in `coroutine.yield` may suspend by returning through the
VM. Its current protected handler must be `resume` or `unroll`, the C call depth
must match that boundary, the thread must be yieldable, and hooks must be off.
The suspended C CallInfo and return values are preserved for normal resume.
Nested C calls, hooks and other protected handlers use the existing exceptions.
The public `lua_yieldk` API is unchanged, including its C++ unwinding and
continuation behavior. See [Lua's C yield contract](https://www.lua.org/manual/5.4/manual.html#4.5).

The JS regressions cover normal and tail calls, nil/varargs, callable objects,
protected errors, nested coroutines, hooks, non-yieldable boundaries and closing
suspended variables. `npm run luatests` additionally links test-only C++ callbacks
that check destructor execution, continuations, errors and cancellation before
running the portable upstream Lua suite. These test callbacks are never linked
into release or diagnostic packages.
