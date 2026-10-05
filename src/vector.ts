export type LuaVectorType = 'vector2' | 'vector3' | 'vector4' | 'quat'

/** An immutable copy of a CfxLua vector. Components use CfxLua's float32 precision. */
export class LuaVector {
    public static vector2(x: number, y: number): LuaVector {
        return new LuaVector('vector2', x, y)
    }

    public static vector3(x: number, y: number, z: number): LuaVector {
        return new LuaVector('vector3', x, y, z)
    }

    public static vector4(x: number, y: number, z: number, w: number): LuaVector {
        return new LuaVector('vector4', x, y, z, w)
    }

    /** Matches the Lua quat(w, x, y, z) constructor; fields remain named x/y/z/w. */
    public static quat(w: number, x: number, y: number, z: number): LuaVector {
        return new LuaVector('quat', x, y, z, w)
    }

    public readonly x: number
    public readonly y: number
    public readonly z: number
    public readonly w: number

    private constructor(
        public readonly type: LuaVectorType,
        x: number,
        y: number,
        z = 0,
        w = 0,
    ) {
        if (![x, y, z, w].every((value) => typeof value === 'number')) {
            throw new TypeError('Vector components must be numbers')
        }
        this.x = Math.fround(x)
        this.y = Math.fround(y)
        this.z = Math.fround(z)
        this.w = Math.fround(w)
        Object.freeze(this)
    }
}
