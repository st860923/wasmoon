// Linked ONLY by `build.sh lua-tests`, into build/lua-tests/glue.wasm.
// Production and diagnostic builds retain CfxLua's default-deny bytecode policy.
#include <lundump.h>

namespace {
template <typename Result, typename... Args>
Result allowTrustedSuiteBytecode(Args...)
{
    return static_cast<Result>(true);
}

struct TrustedSuitePolicy {
    TrustedSuitePolicy()
    {
        pUndumpHook = &allowTrustedSuiteBytecode;
    }
} trustedSuitePolicy;
}
