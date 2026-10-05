import { Decoration } from '../decoration'
import Global from '../global'
import Thread from '../thread'
import TypeExtension from '../type-extension'
import { LuaType } from '../types'
import { LuaVector } from '../vector'

class VectorTypeExtension extends TypeExtension<LuaVector> {
    public constructor(thread: Global) {
        super(thread, 'cfx_vector')
    }

    public close(): void {
        // Values are copies, with no registry references or native allocations to retain.
    }

    public isType(_thread: Thread, _index: number, type: LuaType): boolean {
        return type === LuaType.Vector
    }

    public pushValue(thread: Thread, { target }: Decoration<LuaVector>): boolean {
        if (!(target instanceof LuaVector)) {
            return false
        }
        const kind = { vector2: 2, vector3: 3, vector4: 4, quat: 5 }[target.type]
        const result = thread.lua.module.ccall(
            'wasmoon_pushvector',
            'number',
            ['number', 'number', 'number', 'number', 'number', 'number'],
            [thread.address, kind, target.x, target.y, target.z, target.w],
        )
        if (result !== 1) {
            throw new TypeError('Invalid CfxLua vector type')
        }
        return true
    }

    public getValue(thread: Thread, index: number): LuaVector {
        const module = thread.lua.module
        const pointer = module._malloc(4 * 8)
        if (!pointer) {
            throw new Error('Could not allocate vector transfer buffer')
        }
        try {
            const kind = module.ccall('wasmoon_getvector', 'number', ['number', 'number', 'number'], [thread.address, index, pointer])
            const x = module.getValue(pointer, 'double')
            const y = module.getValue(pointer + 8, 'double')
            const z = module.getValue(pointer + 16, 'double')
            const w = module.getValue(pointer + 24, 'double')
            switch (kind) {
                case 2:
                    return LuaVector.vector2(x, y)
                case 3:
                    return LuaVector.vector3(x, y, z)
                case 4:
                    return LuaVector.vector4(x, y, z, w)
                case 5:
                    return LuaVector.quat(w, x, y, z)
                default:
                    throw new TypeError('Unsupported CfxLua vector variant')
            }
        } finally {
            module._free(pointer)
        }
    }
}

export default function createTypeExtension(thread: Global): TypeExtension<LuaVector> {
    return new VectorTypeExtension(thread)
}
