import base64, json, pathlib, urllib.request
P="http://127.0.0.1:22913/rpc"
def call(m,p=None):
    body=json.dumps({"jsonrpc":"2.0","id":1,"method":m,"params":p or {}}).encode()
    r=urllib.request.urlopen(urllib.request.Request(P,data=body,headers={"Content-Type":"application/json","Host":"127.0.0.1:22913"}),timeout=60)
    return json.loads(r.read())

# 并发结束后，静态观察持久状态（不再有任何并发）
d=call("straditize.getDiagramData").get("result") or {}
print("=== 并发结束后（无并发）持久状态 ===")
print("imageWidth:", d.get("imageWidth"), "imageHeight:", d.get("imageHeight"))
print("rois:", len(d.get("rois") or []), [r.get("name") for r in (d.get("rois") or [])])
print("primaryRoiId:", d.get("primaryRoiId"), "activeRoiId:", d.get("activeRoiId"))
print("roi:", d.get("roi"))
s=call("core.getStatus").get("result") or {}
print("core.getStatus has_image:", s.get("has_image"), "width:", s.get("width"), "columns:", s.get("columns_count"))

# 用户此刻若推进到步骤 5（分列）会怎样？
r=call("core.detectColumns", {"data_xlim":[315,1946],"data_ylim":[511,1311]})
print("=== detectColumns 在持久撕裂态下的返回 ===")
if r.get("error"): print("  ERROR:", r["error"]["code"], r["error"]["message"][:300])
else:
    res=r.get("result") or {}
    print("  columns:", len(res.get("columns") or []))
