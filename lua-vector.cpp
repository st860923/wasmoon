#include <lglm.hpp>

static_assert(LUA_VERSION_NUM == 504, "CfxLua 5.4 is required");
static_assert(LUA_TVECTOR == 4 && LUA_TSTRING == 5 && LUA_TTABLE == 6 &&
              LUA_TFUNCTION == 7 && LUA_TUSERDATA == 8 && LUA_TTHREAD == 9 &&
              LUA_TMATRIX == 10, "CfxLua type tags changed");
static_assert(sizeof(void*) == 4 && sizeof(size_t) == 4, "The JS bridge requires wasm32");
static_assert(sizeof(lua_Integer) == 8 && sizeof(lua_Unsigned) == 8, "The JS bridge requires i64 integers");
static_assert(sizeof(lua_Number) == 8 && sizeof(glm_Float) == 4, "Unexpected scalar precision");

extern "C" int wasmoon_runtime_abi()
{
    return 1;
}

// Only scalars and an explicitly sized double buffer cross the Wasm ABI.
// Do not expose GLM structs, vector storage layout, or temporary Lua pointers.
extern "C" int wasmoon_getvector(lua_State* L, int index, double* out)
{
    if (!out) return 0;
    out[0] = out[1] = out[2] = out[3] = 0;
    if (glm_isquat(L, index)) {
        const auto q = glm_toquat(L, index);
        out[0] = q.x; out[1] = q.y; out[2] = q.z; out[3] = q.w;
        return 5;
    }
    glm::length_t size = 0;
    if (!glm_isvector(L, index, size)) return 0;
    switch (size) {
        case 2: {
            const auto v = glm_tovec2(L, index);
            out[0] = v.x; out[1] = v.y;
            return 2;
        }
        case 3: {
            const auto v = glm_tovec3(L, index);
            out[0] = v.x; out[1] = v.y; out[2] = v.z;
            return 3;
        }
        case 4: {
            const auto v = glm_tovec4(L, index);
            out[0] = v.x; out[1] = v.y; out[2] = v.z; out[3] = v.w;
            return 4;
        }
        default: return 0;
    }
}

extern "C" int wasmoon_pushvector(lua_State* L, int kind, double x, double y, double z, double w)
{
    switch (kind) {
        case 2: return glm_pushvec2(L, glm::vec<2, glm_Float>(x, y));
        case 3: return glm_pushvec3(L, glm::vec<3, glm_Float>(x, y, z));
        case 4: return glm_pushvec4(L, glm::vec<4, glm_Float>(x, y, z, w));
        // GLM's quaternion constructor takes w first, not x first.
        case 5: return glm_pushquat(L, glm::qua<glm_Float>(w, x, y, z));
        default: return 0;
    }
}
