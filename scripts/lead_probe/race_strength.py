import base64, json, pathlib, threading, urllib.request, collections
P="http://127.0.0.1:22913/rpc"
def call(m,p=None):
    body=json.dumps({"jsonrpc":"2.0","id":1,"method":m,"params":p or {}}).encode()
    r=urllib.request.urlopen(urllib.request.Request(P,data=body,headers={"Content-Type":"application/json","Host":"127.0.0.1:22913"}),timeout=60)
    return json.loads(r.read())
img=pathlib.Path("straditize_core/assets/tutorials/hoya-del-castillo.png")
data="data:image/png;base64,"+base64.b64encode(img.read_bytes()).decode()

def round_trip():
    call("project.new", {"clear_image": True})
    torn=[]
    def reader():
        for _ in range(15):
            d=call("straditize.getDiagramData").get("result") or {}
            if d.get("imageWidth",0)>0 and len(d.get("rois") or [])==0: torn.append(d.get("imageWidth"))
    def loader():
        call("core.loadImage", {"image_data":data,"width":2339,"height":1654,"file_name":"hoya.png"})
    ts=[threading.Thread(target=loader), threading.Thread(target=reader)]
    for t in ts: t.start()
    for t in ts: t.join()
    return len(torn)

N=8
tot=collections.Counter()
for i in range(N):
    n=round_trip()
    tot[n]+=1
    print(f"round {i}: torn reads = {n}/15")
print("\n撕裂轮次分布:", dict(tot))
print("出现撕裂的轮次:", sum(v for k,v in tot.items() if k>0), "/", N)
