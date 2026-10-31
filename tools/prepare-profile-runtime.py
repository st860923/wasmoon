"""Fetch the profiling runtime matching the pinned SDK's LLVM, without changing the SDK."""

import hashlib
import json
from pathlib import Path
from urllib.request import urlopen

root = Path(__file__).resolve().parent.parent
manifest = json.loads((root / "tools/profile-runtime-sources.json").read_text())
for local, source in manifest["files"].items():
    target = root / "build/profile-runtime" / local
    data = target.read_bytes() if target.is_file() else b""
    if hashlib.sha256(data).hexdigest() != source["sha256"]:
        url = f'https://raw.githubusercontent.com/llvm/llvm-project/{manifest["revision"]}/{source["path"]}'
        with urlopen(url, timeout=60) as response:
            data = response.read()
        if hashlib.sha256(data).hexdigest() != source["sha256"]:
            raise RuntimeError(f"Profile runtime hash mismatch: {local}")
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
