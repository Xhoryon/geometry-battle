# Runtime Manifest

本文件描述**正式 Sandbox 内部**（也就是你的 `solver.py` 实际运行的地方）可用的运行环境。

本 Manifest 由真实沙箱探针生成，并由永久回归测试 `tests/runtime-manifest.ts` 持续核对：
**Manifest 声称可 import 的模块，正式沙箱内必须可以 import；声称不可用的包，任何公开资料都不得再声称可用。**

> 注意：宿主机器上可能装有更多库（例如开发机上 `import numpy` 可以成功），
> 但那些库**不在**正式沙箱内。请只依赖本 Manifest 列出的内容。

---

## 1. 机器可读清单

测试直接读取下面这个 JSON 块，请不要改动它的结构。

```json
{
  "manifest_version": "1.1",
  "python": "3.9.6",
  "implementation": "CPython",
  "third_party_packages": [],
  "verified_importable": [
    "abc", "argparse", "array", "bisect", "cmath", "collections", "contextlib",
    "copy", "csv", "dataclasses", "datetime", "decimal", "doctest", "enum",
    "fractions", "functools", "hashlib", "heapq", "io", "itertools", "json",
    "logging", "math", "numbers", "operator", "os", "pathlib", "pickle",
    "random", "re", "statistics", "string", "struct", "sys", "tempfile",
    "textwrap", "time", "traceback", "typing", "unittest", "uuid", "warnings"
  ],
  "importable_but_blocked": [
    { "module": "subprocess", "reason": "沙箱拒绝 process-fork" },
    { "module": "multiprocessing", "reason": "沙箱拒绝 process-fork" },
    { "module": "socket", "reason": "沙箱拒绝网络访问" }
  ],
  "unavailable": [
    "cvxpy", "jax", "matplotlib", "networkx", "numba", "numpy", "pandas",
    "scipy", "sklearn", "statsmodels", "sympy", "tensorflow", "torch", "z3"
  ]
}
```

---

## 2. 解释器

| 项目 | 值 |
|---|---|
| 实现 | CPython |
| 版本 | 3.9.6 |
| 启动方式 | 由平台用固定 argv 启动（见 [ALGORITHM_REQUIREMENTS.md](ALGORITHM_REQUIREMENTS.md)） |

不要硬编码解释器路径。用 `sys.executable` 或 `sys.version` 获取运行时信息。

---

## 3. 第三方包：无

```text
Third-party packages: NONE
```

正式沙箱内**没有任何第三方 Python 包**。以下包实测均不可用：

```text
numpy  scipy  sympy  torch  pandas  matplotlib  sklearn  numba
cvxpy  z3  networkx  jax  tensorflow  statsmodels
```

因此：

- 不要 `import numpy` / `import scipy`（会以 `ModuleNotFoundError` 失败，Preflight 不通过）；
- 不要执行 `pip install` / `conda install`（沙箱拒绝进程创建，且无网络）；
- 数学计算请使用标准库：`math`、`cmath`、`decimal`、`fractions`、`statistics`、
  `random`、`itertools`、`functools` 等。

> 历史提示：早期版本的公开文档曾把 `numpy 2.0.2` / `scipy 1.13.1` 列为冻结依赖，
> 那是**宿主观测**结果，不是沙箱内的事实。本 Manifest 与永久测试已取代它。

---

## 4. 可 import 但功能受限

这些模块 `import` 本身会成功，但**用起来会被沙箱拒绝**：

| 模块 | 受限原因 | 实测结果 |
|---|---|---|
| `subprocess` | 沙箱 `(deny process-fork)` | `PermissionError: [Errno 1] Operation not permitted` |
| `multiprocessing` | 同上（需要 fork） | `PermissionError: [Errno 1] Operation not permitted` |
| `socket` | 沙箱 `(deny network*)` | `PermissionError: [Errno 1] Operation not permitted` |

不要依赖它们：需要并行计算时请用单进程算法（线程上限也是 1）。

以下能力实测**可用**：

| 能力 | 实测结果 |
|---|---|
| `ctypes` 调用 libc | OK |
| `mmap` 匿名映射 | OK |
| `signal.alarm` | OK |
| `/dev/urandom` 读取 | OK（每进程随机源） |
| `tempfile.NamedTemporaryFile` | OK，落在当前工作目录内 |

---

## 5. 资源配额

| 项目 | 值 | 说明 |
|---|---|---|
| CPU | 1 核 | 不要依赖并行 |
| 线程上限 | 1 | `OMP_NUM_THREADS` / `OPENBLAS_NUM_THREADS` / `MKL_NUM_THREADS` / `NUMEXPR_NUM_THREADS` / `VECLIB_MAXIMUM_THREADS` 均被钉为 `1` |
| 内存 | 512 MB | 超限进程被终止 |
| 单轮计算超时 | 2000 ms | 从你收到 `GO` 的时刻起算 |
| stdout 上限 | 256 KB | 超限判失败；stdout **不是**结果通道 |
| stderr 上限 | 64 KB | 可用于有限调试输出 |

---

## 6. 环境变量

宿主环境变量**不继承**：平台显式构造一份最小环境，下表是**平台自己设置**的全部变量。
实测沙箱内还会看到少量由 macOS 与进程启动器注入的良性变量
（`CPATH`、`LIBRARY_PATH`、`MANPATH`、`PWD`、`SDKROOT`、`SHLVL`、`__CF_USER_TEXT_ENCODING`），
它们不含任何宿主敏感信息，也不要依赖它们。

平台显式设置的变量：

```text
PATH          /usr/bin:/bin:/usr/sbin:/sbin
HOME          <沙箱内目录>
TMPDIR        <当前工作目录>          ← 可写
LANG / LC_ALL C.UTF-8
PYTHONDONTWRITEBYTECODE 1
PYTHONUNBUFFERED        1
PYTHONHASHSEED          0
PYTHONNOUSERSITE        1
GB_TEAM                  A | B
OMP_NUM_THREADS 等线程变量  1
```

临时文件请用 `tempfile` 或当前工作目录，见 [ALGORITHM_REQUIREMENTS.md](ALGORITHM_REQUIREMENTS.md) §8「工作区与临时文件」。

---

## 7. Runtime 变更规则

Runtime 不是比赛中的变量，而是**冻结项**：双方在完全相同的 Runtime 中运行。

如果将来 Runtime 发生变化（新增或移除任何模块）：

1. 必须同步更新本 Manifest 的机器可读块；
2. 必须让 `tests/runtime-manifest.ts` 通过；
3. 不得在其它公开资料中写出与本 Manifest 冲突的清单。

未列入 `verified_importable` 的模块一律视为**不可用**。
