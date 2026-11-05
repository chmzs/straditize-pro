"""子进程探针：在**无锁**对照下跑并发压测，把结果打成一行 JSON。

## 为什么必须单独进程

无锁时三个线程并发操作同一个 session：writer 在 load_image 里重建图像数组，
两个 reader 同时读。Python 层不会死锁，但 numpy/PIL 的**原生内存**会被并发打坏
（Windows 上实测 access violation：faulthandler 抓到线程分别停在 protocol.py:337 /
protocol.py:299 / session_parts/core.py:485），而且 reader 无限速读、两轮
thread.join(timeout=90) 会走满。

实测一次完整结果（2026-11-05）：reads 17,214,888 / torn 17,142,991 / stuck 0，
耗时 3~5 分钟。耗时全部来自 join 等待，不是挂死——但把它放进常规套件仍不合理
（全量 pytest 会为单条用例多花数分钟并打满 CPU），所以自动测试改用纯 Python 的
_SlowFakeSession，本脚本留给需要复核原生损坏时的手动运行。
"""

import json
import sys

from test_dispatcher_serialisation import (
    _race_reads_during_image_switch,
    _unlocked_control,
)

from straditize_core.rpc_server import create_rpc_dispatcher
from straditize_core.session import StraditizeSession


def main() -> int:
    session = StraditizeSession()
    session._init_cleanup()
    dispatcher = create_rpc_dispatcher(session)
    with _unlocked_control(dispatcher):
        outcome = _race_reads_during_image_switch(dispatcher, session)
    print(json.dumps(outcome))
    return 0


if __name__ == "__main__":
    sys.exit(main())
