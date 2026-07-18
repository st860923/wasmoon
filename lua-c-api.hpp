#pragma once

#define LUA_CORE
#define LUA_LIB

#include "lua/luaconf.h"

#undef LUA_API
#define LUA_API extern "C"
