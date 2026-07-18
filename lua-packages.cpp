#include <lauxlib.h>
#include <lua.h>

#include <lua_cmsgpacklib.h>
#include <lua_rapidjsonlib.h>

extern "C" void luaL_openfxlibs(lua_State* L)
{
    static const luaL_Reg libraries[] = {
        {"msgpack", luaopen_cmsgpack},
        {"json", luaopen_rapidjson},
        {nullptr, nullptr},
    };

    for (const luaL_Reg* library = libraries; library->func; ++library)
    {
        luaL_requiref(L, library->name, library->func, 1);
        lua_pop(L, 1);
    }
}
