// Linked only into the isolated upstream Lua test binary.
#include <emscripten/emscripten.h>
#include <lua.h>

namespace {
int destroyed = 0;
int returned = 0;
int continued = 0;

struct Guard {
    ~Guard() { ++destroyed; }
};

int finish(lua_State* L, int status, lua_KContext)
{
    ++continued;
    lua_pushinteger(L, status);
    return 1;
}

int callWithGuard(lua_State* L)
{
    Guard guard;
    lua_pushvalue(L, 1);
    lua_callk(L, 0, 1, 0, finish);
    ++returned;
    return 1;
}

int yieldWithGuard(lua_State* L)
{
    Guard guard;
    return lua_yieldk(L, 0, 0, finish);
}

int counters(lua_State* L)
{
    lua_pushinteger(L, destroyed);
    lua_pushinteger(L, returned);
    lua_pushinteger(L, continued);
    return 3;
}
}

extern "C" EMSCRIPTEN_KEEPALIVE void wasmoon_test_install_coroutines(lua_State* L)
{
    destroyed = returned = continued = 0;
    lua_pushcfunction(L, callWithGuard);
    lua_setglobal(L, "test_call_guard");
    lua_pushcfunction(L, yieldWithGuard);
    lua_setglobal(L, "test_yield_guard");
    lua_pushcfunction(L, counters);
    lua_setglobal(L, "test_guard_counters");
}
