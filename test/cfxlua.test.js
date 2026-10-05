import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it } from 'mocha'
import { decorateFunction, LuaFactory, LuaRawResult, LuaType, LuaVector, LuaWasm } from '../dist/index.js'

describe('CfxLua runtime contract', () => {
    let engine
    beforeEach(async () => {
        engine = await new LuaFactory().createEngine({ injectObjects: false })
    })
    afterEach(() => engine.global.close())

    it('uses the CfxLua type ABI and caches the serialization modules', async () => {
        assert.equal(await engine.doString('return _VERSION'), 'LuaGLM 5.4')
        assert.equal(await engine.doString('return json == require("json") and msgpack == require("msgpack")'), true)
        const values = [
            [null, LuaType.Nil],
            [true, LuaType.Boolean],
            [123, LuaType.Number],
            ['text', LuaType.String],
            [() => 1, LuaType.Function],
            [LuaVector.vector3(1, 2, 3), LuaType.Vector],
        ]
        for (const [value, type] of values) {
            engine.global.pushValue(value)
            assert.equal(engine.global.lua.lua_type(engine.global.address, -1), type)
            engine.global.pop()
        }
    })

    it('retains Cfx syntax and compile-time hashes', async () => {
        assert.equal(await engine.doString('local n = 1; n += 2; return n'), 3)
        assert.equal(await engine.doString('return (`adder` & 0xffffffff) == 0xb779a091'), true)
    })

    for (const [expression, value] of [
        ['vector2(1, 2)', LuaVector.vector2(1, 2)],
        ['vector3(1, 2, 3)', LuaVector.vector3(1, 2, 3)],
        ['vector4(1, 2, 3, 4)', LuaVector.vector4(1, 2, 3, 4)],
        ['quat(4, 1, 2, 3)', LuaVector.quat(4, 1, 2, 3)],
    ]) {
        it(`round trips ${value.type} through JavaScript callbacks`, async () => {
            engine.global.set('echo', (input) => {
                assert.ok(input instanceof LuaVector)
                assert.deepEqual(input, value)
                return input
            })
            assert.deepEqual(await engine.doString(`return echo(${expression})`), value)
            engine.global.set('v', value)
            assert.equal(await engine.doString(`return v == ${expression}`), true)
        })
    }

    it('keeps vector arithmetic native and preserves float32 components', async () => {
        assert.deepEqual(await engine.doString('return vector3(1, 2, 3) * 2'), LuaVector.vector3(2, 4, 6))
        assert.deepEqual(await engine.doString('return vector2(0.1, -0.2)'), LuaVector.vector2(0.1, -0.2))
    })

    it('does not depend on mutable Lua global constructors or leak stack slots', async () => {
        await engine.doString('vector3 = nil')
        const top = engine.global.getTop()
        for (let i = 0; i < 200; i++) {
            const value = LuaVector.vector3(i, 2, 3)
            engine.global.pushValue(value)
            assert.deepEqual(engine.global.getValue(-1), value)
            engine.global.pop()
        }
        assert.equal(engine.global.getTop(), top)
    })

    it('supports native values without opening standard libraries', async () => {
        const isolated = await new LuaFactory().createEngine({ openStandardLibs: false })
        try {
            assert.equal(isolated.global.get('json'), null)
            assert.equal(isolated.global.get('msgpack'), null)
            const value = LuaVector.quat(4, 1, 2, 3)
            isolated.global.set('v', value)
            assert.deepEqual(await isolated.doString('return v'), value)
        } finally {
            isolated.global.close()
        }
    })

    it('returns immutable copies that survive closing the Lua state', async () => {
        const value = await engine.doString('return vector3(1, 2, 3)')
        engine.global.close()
        assert.deepEqual(value, LuaVector.vector3(1, 2, 3))
        assert.ok(Object.isFrozen(value))
    })

    it('preserves embedded NUL, Unicode, and a leading BOM in text', async () => {
        for (const text of ['', '\ufeffa\0b\ud83c\udf15', 'a\0'.repeat(10000)]) {
            engine.global.set('text', text)
            assert.equal(await engine.doString('return text'), text)
        }
        assert.equal(await engine.doString('return "a" .. string.char(0) .. "b"'), 'a\0b')
    })

    it('copies binary strings without UTF-8 decoding or retaining Wasm views', () => {
        const bytes = Uint8Array.from([0, 255, 128, 195, 40, 0, 1])
        const top = engine.global.getTop()
        engine.global.pushBytes(bytes)
        const result = engine.global.getBytes(-1)
        assert.deepEqual(result, bytes)
        result[0] = 42
        assert.deepEqual(engine.global.getBytes(-1), bytes)
        engine.global.pop()
        engine.global.pushValue(bytes)
        assert.deepEqual(engine.global.getBytes(-1), bytes)
        engine.global.pop()
        assert.equal(engine.global.getTop(), top)
        engine.global.pushValue(123)
        assert.throws(() => engine.global.getBytes(-1), TypeError)
        engine.global.pop()
    })

    it('matches MessagePack wire bytes and passes binary through a JS callback', async () => {
        const expected = Uint8Array.from([0x93, 0x01, 0xc3, 0xa1, 0x78])
        engine.global.set(
            'binaryEcho',
            decorateFunction(
                (thread) => {
                    const bytes = thread.getBytes(1)
                    assert.deepEqual(bytes, expected)
                    thread.pushBytes(bytes)
                    return new LuaRawResult(1)
                },
                { receiveThread: true, receiveArgsQuantity: true },
            ),
        )
        assert.equal(
            await engine.doString(`
            local result = msgpack.unpack(binaryEcho(msgpack.pack({1, true, "x"})))
            return result[1] == 1 and result[2] == true and result[3] == "x"
        `),
            true,
        )
    })

    it('round trips MessagePack vector extensions within Lua', async () => {
        assert.deepEqual(await engine.doString('return msgpack.unpack(msgpack.pack(vector3(1, 2, 3)))'), LuaVector.vector3(1, 2, 3))
    })

    it('preserves the existing MessagePack.lua-compatible unpack signature', async () => {
        assert.equal(await engine.doString('return msgpack.unpack(msgpack.pack(42), "ignored", {})'), 42)
    })

    it('keeps MessagePack objects aligned when the memory pool expands', async () => {
        assert.equal(
            await engine.doString(`
            local values = {}
            for i = 1, 2000 do values[i] = {i, i + 0.5, vector3(i, 2, 3)} end
            local result = msgpack.unpack(msgpack.pack(values))
            for i = 1, 2000 do
                assert(result[i][1] == i and result[i][2] == i + 0.5)
                assert(result[i][3] == vector3(i, 2, 3))
            end
            return #result == 2000
        `),
            true,
        )
    })

    it('preserves NUL bytes in Lua table keys', async () => {
        assert.deepEqual(await engine.doString('return {["a" .. string.char(0) .. "b"] = 42}'), { ['a\0b']: 42 })
    })

    it('never accesses a Lua registry after closing its state', () => {
        const lua = engine.global.lua
        const close = lua.lua_close
        const unref = lua.luaL_unref
        let closed = false
        engine.global.set('callback', () => 42)
        lua.lua_close = (state) => {
            close(state)
            closed = true
        }
        lua.luaL_unref = (...args) => {
            assert.equal(closed, false, 'luaL_unref called after lua_close')
            return unref(...args)
        }
        try {
            engine.global.close()
        } finally {
            lua.lua_close = close
            lua.luaL_unref = unref
        }
    })

    it('does not silently select an upstream CDN binary in browser-like environments', async () => {
        const initialize = LuaWasm.initialize
        const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'window')
        const received = []
        LuaWasm.initialize = async (uri) => {
            received.push(uri)
            return {}
        }
        Object.defineProperty(globalThis, 'window', { configurable: true, value: { document: {} } })
        try {
            await new LuaFactory().getLuaModule()
            await new LuaFactory('/assets/cfx/glue.wasm').getLuaModule()
            assert.deepEqual(received, [undefined, '/assets/cfx/glue.wasm'])
        } finally {
            LuaWasm.initialize = initialize
            if (descriptor) Object.defineProperty(globalThis, 'window', descriptor)
            else delete globalThis.window
        }
    })

    it('exports the expected runtime ABI marker', () => {
        assert.equal(engine.global.lua.module.ccall('wasmoon_runtime_abi', 'number', [], []), 1)
    })

    it('handles malformed JSON and MessagePack without aborting the VM', async () => {
        // lua-rapidjson returns nil, error offset, error message; it does not throw.
        assert.equal(
            await engine.doString(
                'local value, offset, err = json.decode("{"); return value == nil and offset == 1 and type(err) == "string"',
            ),
            true,
        )
        assert.equal(await engine.doString('return pcall(msgpack.unpack, string.char(0xc1))'), false)
        assert.equal(await engine.doString('return 6 * 7'), 42)
    })

    it('retains the default-deny bytecode policy in publishable builds', async () => {
        assert.equal(
            await engine.doString(`
            local fn, err = load(string.dump(function() return 42 end))
            return fn == nil and string.find(err, "forbidden", 1, true) ~= nil
        `),
            true,
        )
    })

    it('preserves signed 64-bit integers instead of silently rounding', async () => {
        for (const integer of [BigInt('9223372036854775807'), BigInt('-9223372036854775808')]) {
            engine.global.set('integer', integer)
            assert.equal(await engine.doString('return integer'), integer)
            assert.equal(await engine.doString('return msgpack.unpack(msgpack.pack(integer))'), integer)
        }
        engine.global.set('safe', BigInt(42))
        assert.equal(await engine.doString('return safe'), 42)
        assert.throws(() => engine.global.pushValue(BigInt('9223372036854775808')), RangeError)
        engine.global.set('largeFloat', 1e30)
        assert.equal(await engine.doString('return math.type(largeFloat)'), 'float')
    })

    it('matches i64 return types in the low-level ABI', () => {
        const { lua, address } = engine.global
        engine.global.pushValue('abc')
        assert.equal(lua.lua_rawlen(address, -1), BigInt(3))
        assert.equal(lua.luaL_len(address, -1), BigInt(3))
        engine.global.pop()
        engine.global.pushValue(42)
        assert.equal(lua.luaL_checkinteger(address, -1), BigInt(42))
        engine.global.pop()
        assert.equal(lua.luaL_optinteger(address, 1, BigInt(7)), BigInt(7))
    })
})
