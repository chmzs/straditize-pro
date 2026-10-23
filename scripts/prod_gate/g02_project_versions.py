# -*- coding: utf-8 -*-
"""G-02：工程包版本号语义 + v2.x 载入兼容实测。

任务书怀疑点：project_save 里出现两套版本号
  - manifest  : version="2.0.0" / schema_version="2.0"   （tar 内 manifest.json）
  - project_json: version="3.0.0" / schema_version="3.0" （工程主体）
同一份保存里两套，可疑。

本探针分四段（全部实测，不读代码推断）：
  V1  真实保存一次 tar / json，逐层拆开看**每层各自的**版本号来源与取值。
  V2  用 pypdf 无关，用 tar 抽取：tar 里到底有几个 manifest / 几套版本号。
  V3  v2.x 工程包能否被当前 project_load 读入 —— 用真实产物降级构造 v2 包来测。
  V4  若不能读入，缺哪条迁移路径 / 丢哪些字段（用字段级 diff 给出）。
"""
from __future__ import annotations

import json
import os
import sys
import tarfile

import _util as U  # noqa: E402

U.ensure_import_path()

OUT_DIR = "output/prod_gate"
SAMPLE_PROJ = "output/han2026_ngamring/Han2026_Fig3_pollen.project.json"
SAMPLE_TAR = "output/han2026_ngamring/Han2026_Fig3_pollen.project.tar"


def v1_save_and_inspect() -> None:
    print("\n" + "#" * 78)
    print("# V1  真实保存一次，逐层看版本号")
    print("#" * 78)
    from straditize_core.session import StraditizeSession

    s = StraditizeSession()
    s._init_cleanup()
    s.load_image(sample_key="hoya")
    s.detect_columns([315, 1946], [511, 1311], roi_id=s.rois[0]["id"])
    c = s.columns[0]
    s.calibrate_column_xticks(
        0, ticks=[{"px": c["start"], "value": 0.0}, {"px": c["tickEndX"], "value": 40.0}], unit="%"
    )
    s.calibrate_axes(
        y_marks=[{"pixel": 511.0, "val": 0.0}, {"pixel": 1311.0, "val": 1300.0}], unit="cm"
    )
    s.samples_set([{"depth": float(d), "label": f"{d}cm"} for d in (10, 50, 100, 200, 400, 800, 1200)])

    os.makedirs(os.path.join(U.ROOT, OUT_DIR), exist_ok=True)
    tar_path = os.path.join(U.ROOT, OUT_DIR, "g02_roundtrip.tar")
    json_path = os.path.join(U.ROOT, OUT_DIR, "g02_roundtrip.json")
    s.project_save(output_path=tar_path, format="tar")
    s.project_save(output_path=json_path, format="json")

    print(f"\n保存 tar  -> {tar_path} ({os.path.getsize(tar_path)} B)")
    print(f"保存 json -> {json_path} ({os.path.getsize(json_path)} B)")

    print("\n--- tar 内文件清单 ---")
    with tarfile.open(tar_path) as tf:
        for m in tf.getmembers():
            print(f"    {m.name:28s} {m.size:>9d} B")
        # 找所有 json 成员，逐个看版本号
        for m in tf.getmembers():
            if not m.name.endswith(".json"):
                continue
            data = json.loads(tf.extractfile(m).read().decode("utf-8"))
            print(f"\n    [{m.name}] 顶层键 = {sorted(data.keys())[:10]}")
            for k in ("version", "schema_version", "tool", "timestamp"):
                if k in data:
                    print(f"        {k} = {data[k]!r}")

    print("\n--- json 工程包顶层 ---")
    pj = json.loads(open(json_path, encoding="utf-8").read())
    print(f"    顶层键 = {sorted(pj.keys())}")
    for k in ("version", "schema_version", "tool", "timestamp"):
        if k in pj:
            print(f"    {k} = {pj[k]!r}")
    print(f"    manifest 字段存在? {'manifest' in pj}")
    if "manifest" in pj:
        print(f"    manifest = {pj['manifest']}")


def v2_tar_layer() -> None:
    print("\n" + "#" * 78)
    print("# V2  仓内已存工程包（Han2026_Fig3_pollen）的版本号分层")
    print("#" * 78)
    if not os.path.exists(os.path.join(U.ROOT, SAMPLE_TAR)):
        print(f"    {SAMPLE_TAR} 不存在 -> 跳过")
        return
    with tarfile.open(os.path.join(U.ROOT, SAMPLE_TAR)) as tf:
        names = [m.name for m in tf.getmembers()]
        print(f"    成员数 = {len(names)}")
        print(f"    成员 = {names[:12]}")
        for m in tf.getmembers():
            if m.name.endswith(".json"):
                d = json.loads(tf.extractfile(m).read().decode("utf-8"))
                print(f"\n    [{m.name}] keys={sorted(d.keys())[:12]}")
                for k in ("version", "schema_version"):
                    if k in d:
                        print(f"        {k} = {d[k]!r}")

    pj_path = os.path.join(U.ROOT, SAMPLE_PROJ)
    if os.path.exists(pj_path):
        d = json.loads(open(pj_path, encoding="utf-8").read())
        print(f"\n    [{os.path.basename(SAMPLE_PROJ)}] keys={sorted(d.keys())[:12]}")
        for k in ("version", "schema_version"):
            if k in d:
                print(f"        {k} = {d[k]!r}")
        print(f"        columns = {len(d.get('columns') or [])}")
        print(f"        samples = {len(d.get('samples') or [])}")
        print(f"        rois = {len(d.get('rois') or [])}")


def v3_v2_compat() -> None:
    print("\n" + "#" * 78)
    print("# V3  v2.x 工程包能否被当前 project_load 读入")
    print("#" * 78)
    from straditize_core.session import StraditizeSession

    base = os.path.join(U.ROOT, OUT_DIR, "g02_roundtrip.json")
    if not os.path.exists(base):
        print("    V1 未产出 -> 跳过")
        return
    orig = json.loads(open(base, encoding="utf-8").read())
    print(f"    基准 v3 包: version={orig.get('version')} schema_version={orig.get('schema_version')}")

    variants = {
        "v2.0.0/2.0 (原样只是降版本号)": dict(version="2.0.0", schema_version="2.0"),
        "v1.0.0/1.0": dict(version="1.0.0", schema_version="1.0"),
        "version 缺失": dict(version=None, schema_version=None),
        "version 乱码": dict(version="banana", schema_version="??"),
        "v4.0.0/4.0 (未来版本)": dict(version="4.0.0", schema_version="4.0"),
    }

    for label, repl in variants.items():
        data = json.loads(json.dumps(orig))  # deep copy
        for k, v in repl.items():
            if v is None:
                data.pop(k, None)
            else:
                data[k] = v
        path = os.path.join(U.ROOT, OUT_DIR, "g02_variant.json")
        with open(path, "w", encoding="utf-8") as fh:
            json.dump(data, fh, ensure_ascii=False)
        s = StraditizeSession()
        s._init_cleanup()
        try:
            r = s.project_load(path)
            print(f"\n    [{label}] -> OK")
            print(f"        columns={r.get('columns_count')} is_calibrated={r.get('is_calibrated')}")
            print(f"        载回后 columns={len(s.columns)} samples={len(getattr(s,'samples',[]))} "
                  f"y_scale={getattr(s,'y_scale',None)}")
            if s.columns:
                print(f"        col0.x_ticks={s.columns[0].get('x_ticks')}")
        except Exception as exc:
            print(f"\n    [{label}] -> {type(exc).__name__}: {exc}")

    # 真的去掉 v3 才有的字段，模拟真正的老包
    print("\n    --- 模拟真正的 v2 老包：删掉 v3 新增字段 ---")
    V3_ONLY = ["rois", "primary_roi_id", "active_roi_id", "age_depth", "line_candidates",
               "selected_candidate_ids", "paper_metadata"]
    present = [k for k in V3_ONLY if k in orig]
    print(f"    本包里存在的 v3 新增字段: {present}")
    data = json.loads(json.dumps(orig))
    data["version"] = "2.0.0"
    data["schema_version"] = "2.0"
    for k in present:
        data.pop(k, None)
    path = os.path.join(U.ROOT, OUT_DIR, "g02_real_v2.json")
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False)
    print(f"    写出 {path}，删除字段={present}")
    s = StraditizeSession()
    s._init_cleanup()
    try:
        r = s.project_load(path)
        print(f"    load -> OK  columns={r.get('columns_count')} "
              f"is_calibrated={r.get('is_calibrated')}")
        print(f"    载回后: rois={len(getattr(s,'rois',[]) or [])} "
              f"columns={len(s.columns)} samples={len(getattr(s,'samples',[]))} "
              f"y_scale={getattr(s,'y_scale',None)}")
        print(f"    默认 ROI = {[(x['id'], x['xlim'], x['ylim']) for x in (getattr(s,'rois',[]) or [])]}")
        if s.columns:
            print(f"    col0 = start={s.columns[0].get('start')} end={s.columns[0].get('end')} "
                  f"x_ticks={s.columns[0].get('x_ticks')}")
            print(f"    col0 属于哪个 roi = {s.columns[0].get('roi_id')}")
    except Exception as exc:
        print(f"    load -> {type(exc).__name__}: {exc}")


def v4_field_diff() -> None:
    print("\n" + "#" * 78)
    print("# V4  往返保真：v3 包 load -> save 后字段级 diff")
    print("#" * 78)
    from straditize_core.session import StraditizeSession

    src = os.path.join(U.ROOT, OUT_DIR, "g02_roundtrip.json")
    if not os.path.exists(src):
        print("    缺基准包 -> 跳过")
        return
    s = StraditizeSession()
    s._init_cleanup()
    s.project_load(src)
    out = os.path.join(U.ROOT, OUT_DIR, "g02_resaved.json")
    s.project_save(output_path=out, format="json")
    a = json.loads(open(src, encoding="utf-8").read())
    b = json.loads(open(out, encoding="utf-8").read())

    def flat(o, p="", acc=None):
        acc = {} if acc is None else acc
        if isinstance(o, dict):
            for k, v in o.items():
                flat(v, f"{p}.{k}" if p else k, acc)
        elif isinstance(o, list):
            acc[p] = f"<list {len(o)}>"
        else:
            acc[p] = o
        return acc

    fa, fb = flat(a), flat(b)
    only_a = sorted(set(fa) - set(fb))
    only_b = sorted(set(fb) - set(fa))
    changed = sorted(k for k in set(fa) & set(fb) if fa[k] != fb[k])
    print(f"    原包字段数={len(fa)}  重存后字段数={len(fb)}")
    print(f"    仅原包有 ({len(only_a)}): {only_a[:15]}")
    print(f"    仅重存有 ({len(only_b)}): {only_b[:15]}")
    print(f"    值改变 ({len(changed)}): {changed[:15]}")
    for k in changed[:10]:
        print(f"      {k}: {fa[k]!r} -> {fb[k]!r}")
    print(f"\n    版本号：原 {a.get('version')}/{a.get('schema_version')} "
          f"-> 重存 {b.get('version')}/{b.get('schema_version')}")


def main() -> int:
    U.hash_banner("G-02 project package versions & v2 compatibility")
    which = sys.argv[1] if len(sys.argv) > 1 else "all"
    if which in ("all", "v1"):
        v1_save_and_inspect()
    if which in ("all", "v2"):
        v2_tar_layer()
    if which in ("all", "v3"):
        v3_v2_compat()
    if which in ("all", "v4"):
        v4_field_diff()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
