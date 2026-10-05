# CfxLua runtime audit — 2026-10-06

This fork embeds the CfxLua language runtime in WebAssembly. It is **not** an FXServer host: Citizen APIs, game natives, resource loading, exports, events, and the FiveM scheduler are not implemented here.

## Native dependency baseline

The following pins were checked against `citizenfx/fivem` on 2026-10-06. Compatibility means the commits selected by FiveM, not blindly selecting a different upstream release.

| Component                    | Commit                                     | Action                |
| ---------------------------- | ------------------------------------------ | --------------------- |
| citizenfx/lua (LuaGLM 5.4.8) | `4ee6aab505bca3346aa9dfafd8bc91bd14c85f1a` | Updated               |
| citizenfx/lua-cmsgpack       | `f46b4a3a7f5fb9d9a05f994ae717a5bb9a3f7122` | Updated               |
| citizenfx/lua-rapidjson      | `60f4dd4e3f04c64e04d74b69c1ff41397fc01e53` | Updated               |
| msgpack/msgpack-c            | `551308ae1068be1d122ec20e319fc9ead7900747` | Already matches FiveM |
| RapidJSON                    | `bfdcf4911047688fec49014d575433e2e5eb05be` | Already matches FiveM |

The recursive GLM pin, `c1b4c6b60135d5c286052b4affaf5b330a057c8c`, comes from the Lua submodule and also matches FiveM. Emscripten is pinned to **6.0.10** in `.emscripten-version`; Docker and CI consume the same file. Rebuild JS glue and Wasm together after any native dependency or SDK change. Do not combine old `glue.wasm` with new TypeScript bindings.

Sources: [FiveM submodules](https://github.com/citizenfx/fivem/blob/master/.gitmodules), [FiveM Lua build flags](https://github.com/citizenfx/fivem/blob/master/code/vendor/lua.lua), [Emscripten 6.0.10](https://github.com/emscripten-core/emscripten/releases/tag/6.0.10).

## Corrected integration defects

- `LUA_MSGPACK_COMPAT` did not select the intended compatibility mode. The build now uses FiveM's `LUACMSGPACK_COMPAT` flag. JSON uses FiveM's native RapidJSON binding, not a replacement JavaScript serializer.
- Lua vectors previously fell back to opaque JS pointers. `LuaVector` now copies vector2/vector3/vector4/quaternion values through scalar C ABI wrappers. Quaternions retain the `quat(w, x, y, z)` constructor order. No GLM struct layout or freed Lua allocation is exposed to JavaScript.
- Browser/worker factories no longer silently download upstream Wasmoon's incompatible CDN binary. The default resolves the Wasm beside the generated glue; explicit custom URIs remain supported. Native compile-time assertions and a runtime ABI marker reject incompatible type layouts/binaries.
- Function extension cleanup no longer calls `luaL_unref` on a state already destroyed by `lua_close`. A regression test checks the registry access order.
- NUL-terminated C string conversions truncated Lua strings. The high-level bridge now uses explicit byte lengths; `pushBytes` and `getBytes` preserve arbitrary binary data.
- Lua integers outside JavaScript's safe integer range previously lost precision. They now return as `bigint`; safe integers still return as `number`. BigInt inputs must fit signed 64 bits. Oversized JS numbers remain floating-point values rather than overflowing `lua_Integer`.
- The low-level `lua_rawlen`, `luaL_len`, `luaL_checkinteger`, and `luaL_optinteger` declarations now reflect their real i64/BigInt ABI. Thread reset uses the supported `lua_closethread` API; the legacy binding remains exported.

For browser deployment, copy `dist/glue.wasm` beside the emitted JavaScript, or pass the matching asset URL to `new LuaFactory(customWasmUri)`. The URL-selection regression runs in a mocked browser-like environment; it is not a real-browser execution test.

## Usage

```js
import { LuaFactory, LuaVector, decorateFunction, LuaRawResult } from 'wasmoon'

const lua = await new LuaFactory().createEngine()
try {
    lua.global.set('position', LuaVector.vector3(1, 2, 3))
    const position = await lua.doString('return position * 2')
    console.log(position.type, position.x, position.y, position.z)

    // MessagePack is bytes, not UTF-8 text. Read the callback argument directly
    // from the Lua stack instead of asking getValue() to decode it as text.
    lua.global.set(
        'binaryEcho',
        decorateFunction(
            (thread) => {
                const bytes = thread.getBytes(1)
                thread.pushBytes(bytes)
                return new LuaRawResult(1)
            },
            { receiveThread: true, receiveArgsQuantity: true },
        ),
    )
    await lua.doString('assert(msgpack.unpack(binaryEcho(msgpack.pack(42))) == 42)')
} finally {
    lua.global.close()
}
```

`Uint8Array` (including Node.js Buffer) is pushed as a binary Lua string. Ordinary Lua strings still decode to JavaScript text through `getValue`; do not use that path for arbitrary MessagePack bytes. Returned byte arrays and vectors are independent copies and do not retain Wasm memory views. Vector components have CfxLua's float32 precision. Matrices remain Lua-side values; a JavaScript matrix bridge is outside this change.

## Validation and compatibility boundaries

`test/cfxlua.test.js` covers type tags, Cfx syntax/hash literals, module caching, vector and quaternion callbacks, operation without standard libraries, stack balance, binary wire bytes, malformed serialization input, embedded NUL/BOM/Unicode, and signed 64-bit integer boundaries. CI builds release mode on Node.js 22/24 and a diagnostic development build on Node.js 22, then runs the existing suite and Lua suite.

JavaScript dependencies and `package-lock.json` are refreshed. ESLint moves to supported 10.x and Mocha to 12.x to remove vulnerable test-tool dependencies; other updates stay within the selected compatible release lines. The historical Rolldown commit build is replaced with the 1.x release line. The copy plugin is replaced with Node's filesystem API, removing its obsolete dependency chain. This is not a claim that every dependency uses its newest major version. Check the PR's actual CI conclusions before merging; adding a test is not evidence that it passed.

The Lua standard libraries remain available by default, unlike FiveM's restricted host environment. Treat untrusted Lua and injected JS capabilities according to your application's threat model. No FXServer/game integration or browser end-to-end execution is claimed by the Node.js tests. No release or npm publication is performed by this PR.
