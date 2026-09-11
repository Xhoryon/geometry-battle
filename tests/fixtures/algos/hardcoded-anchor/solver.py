"""故意**写死锚点**的算法 —— 只用来证明 preflight 会把它拦下来。

它交出的函数恒为 `y = 0`，也就是说它「只经过 (-18, 0)」。

在 V1.1 的常量锚点世界里这是一条完全合法的攻击函数；V1.2 起锚点由各队
开赛前自选，于是它必须被判 `NOT_THROUGH_SHOOTER`。

**preflight 也必须能拦住它** —— decoy 世界若沿用平台常量下发锚点，
这个包会顺利通过赛前校验，然后在正赛第一轮开始每轮 INVALID。
`tests/preflight-decoy.ts` 用这个 fixture 钉死那条性质。

不要把它当成可用的算法示例。
"""

import argparse
import hashlib
import json
import os

ap = argparse.ArgumentParser()
for flag in ("team", "public", "reveal", "output"):
    ap.add_argument(f"--{flag}", required=True)
a = ap.parse_args()

raw = open(a.public, "rb").read()
public = json.loads(raw.decode("utf-8"))
reveal = json.load(open(a.reveal))
assert hashlib.sha256(raw).hexdigest() == reveal["public_state_sha256"]

# 写死：函数恒为 0。只有在锚点恰好是 (-18, 0) 时才「经过」锚点。
dsl = {"type": "number", "value": 0}

tmp = a.output + ".tmp"
with open(tmp, "w", encoding="utf-8") as f:
    json.dump({"schema_version": "1.1", "dsl": dsl}, f)
    f.flush()
    os.fsync(f.fileno())
os.replace(tmp, a.output)
