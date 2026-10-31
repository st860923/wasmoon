// Preload alongside a real workload; each process/module writes its own profile.
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const output = process.env.WASMOON_PROFILE_DIR
assert.ok(output, 'Set WASMOON_PROFILE_DIR to the raw-profile output directory')
const entry = process.env.WASMOON_PROFILE_ENTRY || new URL('../dist/index.js', import.meta.url).href
const { LuaFactory } = await import(entry.startsWith('file:') ? entry : pathToFileURL(resolve(entry)).href)
const modules = new Set()
const createEngine = LuaFactory.prototype.createEngine
LuaFactory.prototype.createEngine = async function (...args) {
    const engine = await createEngine.apply(this, args)
    const module = engine.global.lua.module
    assert.equal(typeof module.___llvm_profile_write_buffer, 'function', 'Build with WASMOON_PGO=generate first')
    modules.add(module)
    return engine
}
process.once('exit', (code) => {
    if (code !== 0) return
    assert.ok(modules.size, 'No instrumented Wasmoon workload ran')
    mkdirSync(output, { recursive: true })
    let index = 0
    for (const module of modules) {
        const size = Number(module.___llvm_profile_get_size_for_buffer())
        assert.ok(Number.isSafeInteger(size) && size > 0, 'Invalid LLVM profile size')
        const pointer = module._malloc(size)
        assert.ok(pointer, 'Cannot allocate LLVM profile buffer')
        try {
            assert.equal(module.___llvm_profile_write_buffer(pointer), 0, 'Cannot write LLVM profile')
            writeFileSync(resolve(output, `${process.pid}-${index++}.profraw`), module.HEAPU8.subarray(pointer, pointer + size))
        } finally {
            module._free(pointer)
        }
    }
})
