# FiveM CfxLua × Wasmoon 遷移 Handoff

## 目的與範圍

這份文件供原本透過 Wasmoon 在 JavaScript/TypeScript 內執行 FiveM Lua 的專案使用。目標是把 Wasmoon 的 Lua VM 從標準 Lua 5.4 換成 CitizenFX 的 CfxLua（LuaGLM 5.4），同時保留既有 Wasmoon 的 JS/Lua bridge。

這不是把 resource 搬進 FXServer 的指南。CfxLua 語言核心與 FiveM host 是兩層不同能力：本次 Wasmoon 變更只提供語言核心以及 `json`、`msgpack`，不會自動提供 `exports`、`Citizen`、native、事件系統、resource lifecycle 或 scheduler。

## 遷移結論

- 既有的 `LuaFactory`、`createEngine()`、`doString()` 與 global bridge 用法不變。
- 升級 Wasmoon artifact 後，Lua runtime 會回報 `LuaGLM 5.4`，並可使用 CfxLua hash、向量與四元數語法。
- 使用預設的 `openStandardLibs: true` 時，會一併載入 `json` 與 `msgpack`。
- 專案原本注入的 FiveM host bridge 必須保留；若以前是靠測試 mock 提供，也必須明確移植。
- 有硬編碼 Lua type number、序列化結果比對或向量跨 JS 邊界的程式，需要人工調整。

## 能力邊界

| 能力                                      | 此 Wasmoon 分支 | 遷移注意事項                                                             |
| ----------------------------------------- | --------------- | ------------------------------------------------------------------------ |
| Lua 5.4 / CfxLua 語法                     | 有              | `_VERSION` 為 `LuaGLM 5.4`                                               |
| 相對路徑 literal、compile-time JOAAT hash | 有              | 可使用 `` `adder` ``，不需執行期 `GetHashKey`                            |
| `vector2`、`vector3`、`vector4`、`quat`   | Lua 內可用      | 直接回傳到 JS 時目前會得到 `Pointer` 並輸出 warning；先轉成一般 table    |
| `json`                                    | 有              | 實作是 `lua-rapidjson`，不是 FXServer 文件中的 `dkjson`                  |
| `msgpack`                                 | 有              | 實作是 `lua-cmsgpack`，不是 FXServer 文件中的 `lua-MessagePack`          |
| FiveM 全域 `promise`                      | 沒有            | Wasmoon 仍可對 JS Promise 使用既有的 `:await()` bridge，但不是同一套 API |
| `exports` / `export` / `server_export`    | 沒有            | 屬於 FiveM resource host，需由應用層注入或改接既有 registry              |
| `Citizen`、native、event、scheduler、NUI  | 沒有            | 保留或實作既有 host adapter                                              |

## 遷移步驟

### 1. 盤點下游專案

先找出 Wasmoon 建立點、host globals、序列化與 Lua type number：

```sh
rg -n "LuaFactory|createEngine|LuaType|lua_type|json\.|msgpack\.|promise|exports|Citizen|TriggerEvent|RegisterNetEvent|vector[234]|quat" src resources test
```

遷移前記錄目前的 Wasmoon 版本與 lockfile，作為 rollback 基準。

### 2. 升級 Wasmoon

正式 release 後，將 `<target-version>` 換成包含 CfxLua runtime 的版本：

```sh
npm install wasmoon@<target-version>
```

若 release 尚未發布，先從本分支建立內部 package：

```sh
git submodule sync --recursive
git submodule update --init --recursive
npm ci
npm run build:wasm:docker:dev
npm run build
npm pack
```

再讓下游專案安裝產生的 `.tgz`，不要長期依賴未固定 commit 的 branch。

### 3. 保留 engine 建立方式

一般專案不需要改初始化程式：

```js
const { LuaFactory } = require('wasmoon')

const factory = new LuaFactory()
const lua = await factory.createEngine()
```

`openStandardLibs` 預設為 `true`。若專案曾關閉它，`json` 和 `msgpack` 也不會被載入；需要這兩個 global 時改為：

```js
const lua = await factory.createEngine({ openStandardLibs: true })
```

### 4. 保留 FiveM host adapter

把 Lua script 依賴分成兩類：

1. CfxLua 語言能力：hash、vector、quat、Lua 5.4 語法，可直接由新 VM 執行。
2. FiveM host 能力：`exports`、`Citizen.CreateThread`、`Wait`、native、事件與 resource lifecycle，仍由現有 JS adapter 提供。

不要因為 VM 已換成 CitizenFX Lua，就刪掉既有的 host globals。若下游還沒有一致的 adapter，優先沿用目前的注入方式，不需為這次遷移另外設計 framework。

### 5. 修正 Lua type number

CfxLua 在 number 與 string 之間加入 `Vector = 4`，並加入 `Matrix = 10`，所以後續 type number 會位移：

| Type     | 舊值 | 新值 |
| -------- | ---: | ---: |
| Vector   |   無 |    4 |
| String   |    4 |    5 |
| Table    |    5 |    6 |
| Function |    6 |    7 |
| Userdata |    7 |    8 |
| Thread   |    8 |    9 |
| Matrix   |   無 |   10 |

下游應匯入 `LuaType` enum，不要硬編碼數字。

向量可在 Lua 內正常運算；目前 Wasmoon 沒有 vector/matrix 的 JS type extension。需要跨邊界時先回傳普通 table：

```lua
local position = vector3(1, 2, 3)
return { x = position.x, y = position.y, z = position.z }
```

### 6. 驗證序列化相容性

FiveM 文件所列的 `json` 與 `msgpack` 實作，和此 Wasmoon build 使用的實作不同。API 名稱相近不代表輸出 byte-for-byte 相同。

至少用現有 production payload 建立 golden/contract tests，覆蓋：

- `nil` / null、boolean、整數與浮點數
- 空 table、array、sparse array 與非字串 key
- Unicode、binary payload 與整數邊界
- malformed input 的錯誤處理
- 已持久化或跨服務傳輸的 MessagePack bytes

若資料會持久化或送到其他語言的服務，先確認新舊 decoder 都能讀取，再切換 producer。

### 7. 跑 smoke test

在下游專案加入一次性 smoke test：

```js
const { LuaFactory } = require('wasmoon')

const lua = await new LuaFactory().createEngine()

try {
    const actual = await lua.doString(`
        local value = vector3(1, 2, 3)
        assert(type(value) == 'vector3')
        assert(type(\`adder\`) == 'number')

        return _VERSION .. '|' ..
            json.decode(json.encode({ name = 'world' })).name .. '|' ..
            msgpack.unpack(msgpack.pack('ok'))
    `)

    if (actual !== 'LuaGLM 5.4|world|ok') {
        throw new Error(`Unexpected CfxLua result: ${actual}`)
    }
} finally {
    lua.global.close()
}
```

接著執行專案原有的 Lua、host adapter、client/server event 與 serialization tests。

瀏覽器部署還要在實際支援範圍內驗證；此 build 使用 WebAssembly native exception handling，不應只以 Node.js 測試結果代替瀏覽器測試。

## FiveM Lua 特性速查

### CfxLua

FiveM 使用修改版 Lua 5.4，名稱為 CfxLua。除了標準 Lua 5.4，也包含 Grit/LuaGLM 的相對路徑、向量與四元數能力。

### Compile-time hash

反引號會在編譯 Lua chunk 時產生 Jenkins one-at-a-time hash，沒有執行期 hash 呼叫成本：

```lua
RequestModel(`adder`)

if GetEntityModel(vehicle) == `buzzard` then
    print('Buzzard')
end
```

### 向量與四元數

`vector2`、`vector3`、`vector4` 與 `quat` 是 CfxLua 的原生型別，不是 table。它們支援 component access、比較、四則運算、長度、normalize、unpack 與 swizzle：

```lua
local position = vector3(1, 2, 3)
local moved = position + vector3(0, 0, 5)

print(type(moved)) -- vector3
print(moved.x, moved.y, moved.z)
print(#moved)
```

在真正的 FiveM host 中，許多 native 會直接接收或回傳 vector。

### Exports 與 scheduler

真正的 FiveM runtime 可透過全域 `exports` 或 `fxmanifest.lua` 的 `export` / `server_export` 公開函式；manifest export 要等第一個 scheduler tick 後才可用。這些是 resource host 行為，不是 Lua VM 本身的語法，因此 Wasmoon 不會自動提供。

### FiveM globals

官方 FiveM host 會提供 `json`、`promise`、`msgpack` 以及 client/server Lua APIs。移植到 Wasmoon 時應逐一確認來源，不能以「global 同名」推定實作與行為完全一致。

## 驗收清單

- [ ] 下游 dependency/lockfile 已固定到 CfxLua 版 Wasmoon
- [ ] `_VERSION`、hash、vector、`json`、`msgpack` smoke test 通過
- [ ] 沒有硬編碼舊的 Lua type number
- [ ] vector/matrix 沒有未處理地跨到 JS 邊界
- [ ] FiveM host globals 都由明確的 adapter 提供
- [ ] JSON/MessagePack production payload contract tests 通過
- [ ] Node.js 與目標瀏覽器/執行環境測試通過
- [ ] 原有 FiveM resource 與事件流程 regression tests 通過
- [ ] rollback artifact 與舊 lockfile 可立即恢復

## Rollback

本次遷移不需要資料庫 schema migration。發生問題時：

1. 將 Wasmoon dependency 與 lockfile 還原到遷移前版本。
2. 恢復舊的 Wasm artifact。
3. 保留 host adapter，不需跟著回退。
4. 若新版已寫出 JSON/MessagePack 或持久化資料，先確認舊版 decoder 可讀再回切。

## 參考資料

- [FiveM：Scripting in Lua](https://docs.fivem.net/docs/scripting-manual/runtimes/lua/)
- [FiveM：vector3](https://docs.fivem.net/docs/scripting-reference/runtimes/lua/functions/vector3/)
- [Emscripten：C++ Exceptions Support](https://emscripten.org/docs/porting/exceptions.html)
