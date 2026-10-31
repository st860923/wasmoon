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
    yields: () => {
        assert.equal(
            run(`
            local co = coroutine.create(function()
                for i = 1, 100000 do assert(coroutine.yield(i) == i + 1) end
                return 100001
            end)
            for i = 1, 100001 do
                local ok, value = coroutine.resume(co, i)
                assert(ok and value == i)
            end
            return coroutine.status(co)
        `),
            'dead',
        )
    },
    protectedYields: () => {
        assert.equal(
            run(`
            local co = coroutine.create(function()
                local ok = pcall(function()
                    for i = 1, 100000 do coroutine.yield(i) end
                end)
                assert(ok)
            end)
            for i = 1, 100000 do
                local ok, value = coroutine.resume(co)
                assert(ok and value == i)
            end
            assert(coroutine.resume(co))
            return coroutine.status(co)
        `),
            'dead',
        )
    },
    errors: () => {
        assert.equal(
            run(`
            local count = 0
            for i = 1, 100000 do
                local ok, err = pcall(error, i)
                if not ok and err == i then count = count + 1 end
            end
            return count
        `),
            100000,
        )
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
    vectors: () => {
        assert.equal(
            run('local b = vector3(3, 4, 5); local n = 0; for i = 1, 100000 do n = n + glm.dot(vector3(i % 11, 2, 3), b) end; return n'),
            3800015,
        )
    },
    matrices: () => {
        assert.equal(
            run('local a, b = glm.mat4(1), glm.mat4(2); local n = 0; for i = 1, 200000 do n = n + (a * b)[1].x end; return n'),
            400000,
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
