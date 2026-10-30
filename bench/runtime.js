// Run against matching JS/Wasm dist directories; compare alternating fresh processes.
import assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const entry = resolve(process.argv[2] || 'dist/index.js')
const { LuaFactory } = await import(pathToFileURL(entry).href)
const start = performance.now()
const factory = new LuaFactory()
const engine = await factory.createEngine()
const timings = { cold: performance.now() - start }
const run = (source) => {
    const top = engine.global.getTop()
    try {
        return engine.doStringSync(source)
    } finally {
        engine.global.setTop(top)
    }
}
run('collectgarbage("generational")')
engine.global.set('increment', (value) => value + 1)
run('rows = {}; for i = 1, 1000 do rows[i] = { id = i, name = "item" .. i, amount = i % 17 } end')

const workloads = {
    api: () => {
        const { lua, address } = engine.global
        for (let i = 0; i < 400000; i++) {
            lua.lua_pushnumber(address, i)
            const value = lua.lua_tonumberx(address, -1, null)
            lua.lua_settop(address, 0)
            assert.equal(value, i)
        }
    },
    callbacks: () => {
        assert.equal(run('local n = 0; for i = 1, 100000 do n = increment(n) end; return n'), 100000)
    },
    tables: async () => {
        for (let i = 0; i < 30; i++) {
            const rows = await engine.doString('return rows')
            assert.equal(rows.length, 1000)
            assert.equal(rows[999].id, 1000)
        }
    },
    vm: () => {
        assert.equal(run('local n = 0; for i = 1, 5000000 do n = (n + i) % 1000003 end; return n'), 105)
    },
    allocation: () => {
        assert.equal(
            run(
                'local live = {}; for i = 1, 300000 do live[i % 2048 + 1] = { id = i, name = "v" .. i, pos = { i, i+1, i+2 } } end; return #live',
            ),
            2048,
        )
    },
    serialization: () => {
        assert.equal(
            run(
                'local n = 0; for i = 1, 15000 do local v = { id = i, name = "test", pos = { i, 2, 3 } }; n = n + msgpack.unpack(msgpack.pack(v)).id + json.decode(json.encode(v)).id end; return n',
            ),
            225015000,
        )
    },
    engines: async () => {
        for (let i = 0; i < 30; i++) {
            const isolated = await factory.createEngine()
            assert.equal(isolated.doStringSync('return 6 * 7'), 42)
            isolated.global.close()
        }
    },
}
try {
    for (const [name, workload] of Object.entries(workloads)) {
        await workload()
        const samples = []
        for (let round = 0; round < 5; round++) {
            const before = performance.now()
            await workload()
            samples.push(performance.now() - before)
        }
        timings[name] = samples.sort((a, b) => a - b)[2]
    }
    console.log(JSON.stringify({ entry, node: process.version, timings, wasmBytes: engine.global.lua.module.HEAPU8.byteLength }))
} finally {
    engine.global.close()
}
