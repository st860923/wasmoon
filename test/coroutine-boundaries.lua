-- A yield must destroy C++ locals before returning to resume, and invoke the
-- registered continuation later instead of returning into the original frame.
local function counts(d, r, c)
    local actualD, actualR, actualC = test_guard_counters()
    assert(actualD == d and actualR == r and actualC == c)
end

local co = coroutine.create(function()
    local status = test_call_guard(function()
        assert(coroutine.yield('first') == 'resume')
        coroutine.yield('second')
        return 42
    end)
    assert(status == 1)
    return 'done'
end)
local ok, value = coroutine.resume(co)
assert(ok and value == 'first')
counts(1, 0, 0)
ok, value = coroutine.resume(co, 'resume')
assert(ok and value == 'second')
counts(1, 0, 0)
ok, value = coroutine.resume(co)
assert(ok and value == 'done')
counts(1, 0, 1)

co = coroutine.create(test_yield_guard)
assert(coroutine.resume(co))
counts(2, 0, 1)
ok, value = coroutine.resume(co)
assert(ok and value == 1)
counts(2, 0, 2)

assert(test_call_guard(function() return 42 end) == 42)
counts(3, 1, 2)
ok, value = pcall(test_call_guard, function() error('guard error', 0) end)
assert(not ok and value == 'guard error')
counts(4, 1, 2)

co = coroutine.create(function()
    test_call_guard(function() coroutine.yield('cancel') end)
end)
assert(coroutine.resume(co))
counts(5, 1, 2)
assert(coroutine.close(co))
counts(5, 1, 2)
print('C++ coroutine unwind boundaries OK')
