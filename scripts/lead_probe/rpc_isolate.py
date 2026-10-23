import base64, json, urllib.request, pathlib
P="http://127.0.0.1:22912/rpc"
def call(m, p=None, i=1):
    body=json.dumps({"jsonrpc":"2.0","id":i,"method":m,"params":p or {}}).encode()
    r=urllib.request.urlopen(urllib.request.Request(P, data=body, headers={"Content-Type":"application/json","Host":"127.0.0.1:22912"}), timeout=60)
    return json.loads(r.read())
img=pathlib.Path("straditize_core/assets/tutorials/hoya-del-castillo.png")
data="data:image/png;base64,"+base64.b64encode(img.read_bytes()).decode()

print("--- 1) upload #1 (from true zero) ---")
r=call("core.loadImage", {"image_data":data,"width":2339,"height":1654,"file_name":"hoya.png"}, 1)
res=r.get("result") or {}
print("  loadImage -> success:", res.get("success"), "rois:", len(res.get("rois") or []), [x["name"] for x in (res.get("rois") or [])], "primary:", res.get("primary_roi_id"))
d=call("straditize.getDiagramData", {}, 2).get("result") or {}
print("  getDiagramData -> rois:", len(d.get("rois") or []), "primaryRoiId:", d.get("primaryRoiId"), "cols:", len(d.get("columns") or []))

print("--- 2) upload #2 (re-upload onto existing project) ---")
r=call("core.loadImage", {"image_data":data,"width":2339,"height":1654,"file_name":"hoya.png"}, 3)
res=r.get("result") or {}
print("  loadImage -> success:", res.get("success"), "rois:", len(res.get("rois") or []), [x["name"] for x in (res.get("rois") or [])], "primary:", res.get("primary_roi_id"))
d=call("straditize.getDiagramData", {}, 4).get("result") or {}
print("  getDiagramData -> rois:", len(d.get("rois") or []), "primaryRoiId:", d.get("primaryRoiId"), "cols:", len(d.get("columns") or []))

print("--- 3) project_new(clear_image=True) then getDiagramData ---")
r=call("project.new", {"clear_image":True}, 5)
print("  project_new ->", r.get("result"))
d=call("straditize.getDiagramData", {}, 6).get("result") or {}
print("  getDiagramData -> imageWidth:", d.get("imageWidth"), "rois:", len(d.get("rois") or []), "primaryRoiId:", d.get("primaryRoiId"))
