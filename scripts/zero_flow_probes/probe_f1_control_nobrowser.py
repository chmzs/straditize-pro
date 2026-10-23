import sys
sys.path.insert(0,'scripts/zero_flow_probes')
from rpc import Rpc
r=Rpc(22940)
r.call('e2e.reset'); r.call('core.loadImage',{'sample_key':'hoya'})
r.call('core.detectColumns',{'data_xlim':[315,1946],'data_ylim':[511,1311]})
print('初始 xlim =', r.call('straditize.getDiagramData')['rois'][0]['xlim'])
r.call('roi.update', {'roi_id':'roi_1','x0':355,'x1':1906})
print('roi.update 后 xlim =', r.call('straditize.getDiagramData')['rois'][0]['xlim'])
r.call('core.detectColumns',{'data_xlim':[355,1906],'data_ylim':[511,1311]})
d=r.call('straditize.getDiagramData')
print('detectColumns(新bounds) 后 roi xlim =', d['rois'][0]['xlim'], '| data_xlim =', d.get('roi'))
