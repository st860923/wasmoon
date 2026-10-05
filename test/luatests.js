import { spawnSync } from 'node:child_process'
import { readFile, readdir } from 'node:fs/promises'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { LuaEngine, LuaWasm } from '../dist/index.js'

async function* walk(dir) {
    const dirents = await readdir(dir, { withFileTypes: true })
    for (const dirent of dirents) {
        const res = resolve(dir, dirent.name)
        if (dirent.isDirectory()) {
            yield* walk(res)
        } else {
            yield res
        }
    }
}

// CfxLua rejects bytecode by default. The upstream suite deliberately dumps
// and reloads trusted functions, so it needs an isolated, non-publishable build.
const build = spawnSync('bash', [fileURLToPath(new URL('../build.sh', import.meta.url)), 'lua-tests'], { stdio: 'inherit' })
if (build.error) throw build.error
if (build.status !== 0) throw new Error(`Lua test-runtime build failed: ${build.status}`)
const { default: initialize } = await import('../build/lua-tests/glue.js')
const module = await initialize()
if (module.ccall('wasmoon_runtime_abi', 'number', [], []) !== 1) throw new Error('Unexpected test runtime ABI')
const luamodule = new LuaWasm(module)
const filePath = fileURLToPath(new URL('../lua/testes/', import.meta.url))

for await (const file of walk(filePath)) {
    const path = relative(filePath, file).replaceAll('\\', '/')
    const directory = dirname(path)
    if (directory !== '.') module.FS.mkdirTree(directory)
    module.FS.writeFile(path, await readFile(file))
}

const lua = new LuaEngine(luamodule)
try {
    luamodule.lua_warning(lua.global.address, '@on', 0)
    lua.global.set('arg', ['lua', 'all.lua'])
    lua.global.set('_port', true)
    lua.global.getTable('os', (i) => {
        lua.global.setField(i, 'setlocale', (locale) => {
            return locale && locale !== 'C' ? false : 'C'
        })
    })
    lua.doFileSync('all.lua')
} catch (error) {
    console.error(error.message)
    process.exitCode = 1
} finally {
    lua.global.close()
}
