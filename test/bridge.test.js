import assert from 'node:assert/strict'
import { LuaFactory, LuaType } from '../dist/index.js'

describe('Bridge conversion contract', () => {
    let engine
    beforeEach(async () => {
        engine = await new LuaFactory().createEngine()
    })
    afterEach(() => engine.global.close())

    it('converts each asynchronous result once and keeps the first converted object', async () => {
        const converted = []
        engine.global.registerTypeExtension(10, {
            isType: (_thread, _index, type) => type === LuaType.Table,
            getValue: () => {
                const value = { conversion: converted.length }
                converted.push(value)
                return value
            },
            pushValue: () => false,
            close: () => {},
        })
        engine.global.set('ready', () => Promise.resolve())
        const top = engine.global.getTop()
        const result = await engine.doString('ready():await(); return {}, {}')
        assert.equal(converted.length, 2)
        assert.strictEqual(result, converted[0])
        assert.equal(engine.global.getTop(), top)
        assert.equal(await engine.doString('return'), undefined)
        assert.equal(await engine.doString('return nil, 42'), null)
        await assert.rejects(engine.doString('error("bridge failure")'), /bridge failure/)
        assert.equal(engine.global.getTop(), top)
    })

    it('preserves numeric, i64, pointer and string conversions across memory growth', () => {
        const lua = engine.global.lua
        const address = engine.global.address
        const initialTop = engine.global.getTop()
        lua.lua_pushinteger(address, 9223372036854775807n)
        assert.equal(lua.lua_tointegerx(address, -1, null), 9223372036854775807n)
        engine.global.pop()
        lua.lua_pushnumber(address, -0.25)
        assert.equal(lua.lua_tonumberx(address, -1, null), -0.25)
        engine.global.pop()
        const unicode = '測試🧸'.repeat(2000)
        engine.global.set('large', unicode)
        assert.equal(engine.global.get('large'), unicode)
        const before = lua.module.HEAPU8.byteLength
        const pointer = lua.module._malloc(before + 65536)
        assert.notEqual(pointer, 0)
        try {
            assert.ok(lua.module.HEAPU8.byteLength > before)
            lua.lua_pushlightuserdata(address, pointer)
            assert.equal(lua.lua_touserdata(address, -1), pointer)
            engine.global.pop()
            assert.equal(engine.global.get('large'), unicode)
            assert.equal(engine.doStringSync('return 40 + 2'), 42)
            engine.global.pop()
        } finally {
            lua.module._free(pointer)
        }
        assert.equal(engine.global.getTop(), initialTop)
    })
})
