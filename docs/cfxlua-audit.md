# CfxLua runtime audit — 2026-10-06

This fork embeds the CfxLua language runtime in WebAssembly. It is **not** an FXServer host: Citizen APIs, game natives, resource loading, exports, events, and the FiveM scheduler are not implemented here.

## Native dependency baseline

These pins were checked against `citizenfx/fivem` on 2026-10-06. Compatibility means the commits selected by FiveM, not independently selecting unrelated upstream releases.

| Component | Commit | Action |
| --- | --- | --- |
| citizenfx/lua (LuaGLM 5.4.8) | `4ee6aab505bca3346aa9dfafd8bc91bd14c85f1a` | Updated |
| citizenfx/lua-cmsgpack | `f46b4a3a7f5fb9d9a05f994ae717a5bb9a3f7122` | Updated |
| citizenfx/lua-rapidjson | `60f4dd4e3f04c64e04d74b69c1ff41397fc01e53` | Updated |
| msgpack/msgpack-c | `551308ae1068be1d122ec20e319fc9ead7900747` | Already matches FiveM |
| RapidJSON | `bfdcf4911047688fec49014d575433e2e5eb05be` | Already matches FiveM |
| Recursive GLM | `c1b4c6b60135d5c286052b4affaf5b330a057c8c` | Matches FiveM through Lua |

Emscripten is pinned to **6.0.10** in `.emscripten-version`; Docker, testing, and publishing consume the same file. Rebuild JS glue and Wasm together after native dependency or SDK changes. Do not combine an old `glue.wasm` with new generated glue or TypeScript bindings.

Sources: [FiveM submodules](https://github.com/citizenfx/fivem/blob/master/.gitmodules), [FiveM Lua build](https://github.com/citizenfx/fivem/blob/master/code/vendor/lua.lua), [FiveM MessagePack build](https://github.com/citizenfx/fivem/blob/master/code/vendor/lua-cmsgpack.lua), [Emscripten 6.0.10](https://github.com/emscripten-core/emscripten/releases/tag/6.0.10).

## Wasm32 portability defects

`patches/msgpack-wasm32.patch` is applied with zero fuzz to disposable copies under `build/native/`. The pinned submodule checkouts are never modified. The build requires the standard `patch` utility, available in the CI and Emscripten Docker environments.

- The MessagePack Lua binding inferred integer width from pointer width. Wasm32 has 32-bit pointers but this runtime has **64-bit Lua integers**. As a result, serializing `9223372036854775807` previously produced `-1`. The patch derives the encoding width from `LUA_MAXINTEGER` instead.
- MessagePack's memory pool defaulted to pointer-sized alignment. Wasm32 needs **8-byte alignment** for its decoded objects. The build sets `MSGPACK_ZONE_ALIGN=8`, and a patch corrects the expansion path to round addresses **up**, not down into the allocation header. Tests cover both a small array and expansion through 2,000 nested records, including doubles and vectors.
- The vector serializer now recognizes Emscripten as little-endian without globally impersonating Windows through `__WINDOWS__`.

The build retains **`LUA_MSGPACK_COMPAT`**, the actual switch used by this library for the existing MessagePack.lua-compatible `unpack` signature. It also defines FiveM's `LUACMSGPACK_COMPAT`; that differently spelled build macro alone does not select the library's compatibility functions. JSON retains native lua-rapidjson behavior: malformed input returns `nil`, an error offset, and an error message, rather than throwing a Lua error.

## JavaScript/native bridge repairs

Browser and worker factories no longer silently download upstream Wasmoon's incompatible CDN binary. The default resolves the matching Wasm beside the generated glue; explicit custom URIs remain supported. Compile-time assertions check CfxLua type tags, wasm32 pointer sizes, i64 integers, and scalar precision. Initialization checks a runtime ABI marker.

Vectors previously fell back to opaque JS pointers. `LuaVector` now copies vector2/vector3/vector4/quaternion values through scalar C ABI wrappers. Quaternion construction retains `quat(w, x, y, z)` order. No GLM struct layout or freed Lua allocation is exposed to JavaScript. Components retain CfxLua's float32 precision.

NUL-terminated string conversion truncated Lua text and table keys. The high-level bridge now uses explicit byte lengths, including leading BOM and Unicode handling. `pushBytes` and `getBytes` preserve arbitrary binary data, including MessagePack. Copies are made before memory allocation can invalidate a Wasm view.

Lua integers outside JavaScript's safe range now return as `bigint`; safe integers still return as `number`. BigInt inputs must fit signed 64 bits. Oversized JS numbers remain floating-point values rather than overflowing `lua_Integer`. Low-level `lua_rawlen`, `luaL_len`, `luaL_checkinteger`, and `luaL_optinteger` declarations now reflect their i64/BigInt ABI.

Thread reset uses `lua_closethread`; the legacy binding remains exported. Function extension cleanup no longer calls `luaL_unref` on a state already destroyed by `lua_close`.

## Usage and migration

```js
import { LuaFactory, LuaVector, decorateFunction, LuaRawResult } from 'wasmoon'

const lua = await new LuaFactory().createEngine()
try {
    lua.global.set('position', LuaVector.vector3(1, 2, 3))
    const position = await lua.doString('return position * 2')
    console.log(position.type, position.x, position.y, position.z)

    lua.global.set('binaryEcho', decorateFunction((thread) => {
        const bytes = thread.getBytes(1)
        thread.pushBytes(bytes)
        return new LuaRawResult(1)
    }, { receiveThread: true, receiveArgsQuantity: true }))
    await lua.doString('assert(msgpack.unpack(binaryEcho(msgpack.pack(42))) == 42)')
} finally {
    lua.global.close()
}
```

`Uint8Array`, including Node.js Buffer, is pushed as a binary Lua string. Ordinary Lua strings still decode to JavaScript text through `getValue`; do not use that path for arbitrary MessagePack bytes. Byte arrays and vectors are independent copies. Matrices remain Lua-side values; a JavaScript matrix bridge is outside this change.

For browser deployments, copy `dist/glue.wasm` beside the emitted JavaScript or pass the matching asset URL to `new LuaFactory(customWasmUri)`. The browser-selection test uses a mocked browser-like environment; it is not a real-browser execution test.

## Tooling and validation

Dependencies and the lockfile are refreshed. ESLint moves to 10.x and Mocha to 12.x to remove vulnerable test-tool dependencies. Rolldown uses the 1.x release line instead of a historical commit build. The obsolete copy plugin is replaced with Node filesystem APIs. This is not a claim that every package uses its newest major version. Mocha runs serially so failed BigInt assertions are reported rather than failing in worker IPC serialization.

CI tests production Wasm on Node.js 22/24 and a diagnostic SAFE_HEAP build on Node.js 22. It runs the existing JS tests, CfxLua regressions, full dependency audit, and package-content checks. Check the PR's actual CI conclusions before merging; adding a test is not evidence it passed.

### Bytecode policy and upstream Lua tests

Publishable release and diagnostic builds retain CfxLua's **default-deny bytecode policy**, verified by a regression test. The upstream `lua/testes/all.lua` suite intentionally dumps and reloads its own trusted functions and cannot run unchanged under that policy.

`npm run luatests` therefore compiles a separate **test-only** runtime using `build.sh lua-tests`. Only this mode links `test/bytecode-policy.cpp`. Its generated glue and Wasm are stored under `build/lua-tests/`, never `build/glue.wasm` or `dist/`, and loaded together directly by the test runner. Publishing and artifact upload still use the unchanged production `dist/`. The test runner uses `_port = true` and the existing C-locale shim; internal C test helpers are not built. This does not claim every platform-specific or internal-C test is executed.

The default standard libraries remain available, unlike FiveM's restricted host. Assess untrusted Lua and injected JavaScript capabilities for the application's threat model. No FXServer/game integration or real-browser end-to-end execution is claimed. No merge, npm publication, or release is performed by this PR.
