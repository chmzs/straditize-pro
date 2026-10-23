import base64, json, pathlib, threading, urllib.request
P="http://127.0.0.1:22913/rpc"
def call(m, p=None):
    body=json.dumps({"jsonrpc":"2.0","id":1,"method":m,"params":p or {}}).encode()
    r=urllib.request.urlopen(urllib.request.Request(P,data=body,headers={"Content-Type":"application/json","Host":"127.0.0.1:22913"}),timeout=60)
    return json.loads(r.read())
img=pathlib.Path("straditize_core/assets/tutorials/hoya-del-castillo.png")
data="data:image/png;base64,"+base64.b64encode(img.read_bytes()).decode()

# 先复位到干净零状态
call("project.new", {"clear_image": True})
print("baseline rois:", len((call("straditize.getDiagramData").get("result") or {}).get("rois") or []))

# 并发：一个线程发 loadImage，另一个线程几乎同时连续读 getDiagramData
results=[]
def reader():
    for _ in range(25):
        d=call("straditize.getDiagramData").get("result") or {}
        results.append((d.get("imageWidth"), len(d.get("rois") or []), d.get("primaryRoiId")))
def loader():
    call("core.loadImage", {"image_data":data,"width":2339,"height":1654,"file_name":"hoya.png"})

t1=threading.Thread(target=loader); t2=threading.Thread(target=reader)
t1.start(); t2.start(); t1.join(); t2.join()

torn=[r for r in results if r[0]>0 and r[1]==0]
print("总读取次数:", len(results))
print("撕裂态样本 (有图但 rois=0):", len(torn))
for r in torn[:8]: print("   ", r)
print("最终态:", results[-1] if results else None)
