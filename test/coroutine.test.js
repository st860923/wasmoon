import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it } from 'mocha'
import { LuaFactory } from '../dist/index.js'

describe('coroutine suspension boundaries', () => {
    let engine
    beforeEach(async () => {
        engine = await new LuaFactory().createEngine()
    })
    afterEach(() => engine.global.close())
    const check = (source) => assert.equal(engine.doStringSync(source), true)

    it('preserves values, varargs, tail calls, aliases and callable metamethods', () => {
        check(`
            local yield = coroutine.yield
            local callable = setmetatable({}, { __call = yield })
            local function tail(...) return yield(...) end
            local co = coroutine.create(function(...)
                assert(select('#', ...) == 3)
                local a, b, c = yield(...)
                assert(a == 7 and b == nil and c == 9)
                a, b = callable(11)
                assert(a == 13 and b == 17)
                return tail(19, nil, 23)
            end)
            local ok, a, b, c = coroutine.resume(co, 1, nil, 3)
            assert(ok and a == 1 and b == nil and c == 3)
            ok, a, b = coroutine.resume(co, 7, nil, 9)
            assert(ok and a == callable and b == 11)
            ok, a, b, c = coroutine.resume(co, 13, 17)
            assert(ok and a == 19 and b == nil and c == 23)
            ok, a, b, c = coroutine.resume(co, 29, nil, 31)
            assert(ok and a == 29 and b == nil and c == 31)
            return coroutine.status(co) == 'dead'
        `)
    })

    it('unwinds protected calls on first yield and continues protected errors after resuming', () => {
        check(`
            local marker = {}
            local co = coroutine.create(function()
                local ok, err = xpcall(function()
                    assert(pcall(function()
                        assert(coroutine.yield(1) == 2)
                        assert(coroutine.yield(3) == 4)
                    end))
                    error(marker)
                end, function(err) assert(err == marker); return 'handled' end)
                assert(not ok and err == 'handled')
                return coroutine.yield(5)
            end)
            for i = 1, 5, 2 do
                local ok, value = coroutine.resume(co, i - 1)
                assert(ok and value == i)
            end
            local ok, value = coroutine.resume(co, 6)
            return ok and value == 6 and coroutine.status(co) == 'dead'
        `)
    })

    it('closes suspended resources exactly once on cancellation and on errors', () => {
        check(`
            local closed = {}
            local function body()
                local a <close> = setmetatable({}, {__close = function(_, err) closed[#closed+1] = err or 'cancel' end})
                coroutine.yield('ready')
                error('failed', 0)
            end
            local co = coroutine.create(body)
            assert(coroutine.resume(co))
            assert(#closed == 0)
            assert(coroutine.close(co))
            assert(coroutine.close(co))
            assert(#closed == 1 and closed[1] == 'cancel')
            co = coroutine.create(body)
            assert(coroutine.resume(co))
            local ok, err = coroutine.resume(co)
            assert(not ok and err == 'failed')
            ok, err = coroutine.close(co)
            return not ok and err == 'failed' and #closed == 2 and closed[2] == 'failed'
        `)
    })

    it('resumes a yielding close handler without skipping later cleanup', () => {
        check(`
            local closed = 0
            local co = coroutine.create(function()
                local first <close> = setmetatable({}, {__close = function() closed = closed + 1 end})
                local second <close> = setmetatable({}, {__close = function()
                    assert(coroutine.yield('close1') == 'next')
                    coroutine.yield('close2')
                    closed = closed + 1
                end})
                return 42
            end)
            local ok, value = coroutine.resume(co)
            assert(ok and value == 'close1' and closed == 0)
            ok, value = coroutine.resume(co, 'next')
            assert(ok and value == 'close2' and closed == 0)
            ok, value = coroutine.resume(co)
            return ok and value == 42 and closed == 2
        `)
    })

    it('preserves hook events and rejects non-yieldable C boundaries', () => {
        check(`
            local calls, returns = 0, 0
            local co = coroutine.create(function()
                coroutine.yield(1)
                coroutine.yield(2)
                local ok, err = pcall(table.sort, {2, 1}, function() coroutine.yield() end)
                assert(not ok and err:find('C%-call boundary'))
            end)
            debug.sethook(co, function(event)
                if event == 'call' then calls = calls + 1 end
                if event == 'return' then returns = returns + 1 end
            end, 'cr')
            assert(coroutine.resume(co))
            assert(coroutine.resume(co))
            assert(coroutine.resume(co))
            debug.sethook(co)
            return calls > 0 and returns > 0 and coroutine.status(co) == 'dead'
        `)
    })

    it('keeps nested coroutine resumes and yieldable metamethod continuations separate', () => {
        check(`
            local child = coroutine.create(function()
                for i = 1, 20 do assert(coroutine.yield(i) == i + 1) end
            end)
            local value = setmetatable({}, {__add = function()
                coroutine.yield('meta')
                return 42
            end})
            local outer = coroutine.create(function()
                for i = 1, 20 do
                    local ok, n = coroutine.resume(child, i)
                    assert(ok and n == i)
                    assert(coroutine.yield(n) == i + 1)
                end
                assert(coroutine.resume(child, 21))
                assert(value + value == 42)
                return 99
            end)
            for i = 1, 20 do
                local ok, n = coroutine.resume(outer, i)
                assert(ok and n == i)
            end
            local ok, n = coroutine.resume(outer, 21)
            assert(ok and n == 'meta')
            ok, n = coroutine.resume(outer)
            return ok and n == 99 and coroutine.status(child) == 'dead'
        `)
    })
})
