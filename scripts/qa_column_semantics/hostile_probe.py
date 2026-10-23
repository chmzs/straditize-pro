# -*- coding: utf-8 -*-
"""更狠的对抗探测：专找实现的理论边界。"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
import numpy as np
from straditize_core.image import split_by_colour_and_luminance

H=60
def make(width, bands):
    c=np.zeros((H,width,3),dtype=np.uint8); c[...]=255
    for x0,x1,layers in bands:
        for colour,lx0,lx1 in layers:
            c[5:55,max(x0,lx0):min(x1,lx1)]=colour
    return c,[b[0] for b in bands]+[bands[-1][1]]

def cov(m,y0,y1,x0,x1): return float(m[y0:y1,x0:x1].mean())

print("=== 攻击1：实心比包络更宽的'反向'图（物理上不该存在）===")
c,e=make(120,[(5,100,[((182,182,182),5,80),((229,229,229),80,100)])])
s,sh=split_by_colour_and_luminance(c,column_edges=e)
print(f"  实心区(5-80) solid={cov(s,5,55,5,80):.2f}  包络区(80-100) 漏入={cov(s,5,55,80,100):.2f}")
print(f"  → 两者同列但左右排列（非嵌套），判定：{'合理' if cov(s,5,55,5,80)>0.9 else '异常'}")

print()
print("=== 攻击2：单层列内只有 1 个像素宽的墨（极细线）===")
c=np.zeros((H,120,3),dtype=np.uint8); c[...]=255
c[5:55, 40:41]=0   # 1px 宽黑线
s,sh=split_by_colour_and_luminance(c,column_edges=[10,110])
print(f"  1px 黑线 solid 覆盖={cov(s,5,55,40,41):.2f}")
print(f"  → {'检出' if cov(s,5,55,40,41)>0.9 else '漏检（细线丢失）'}")

print()
print("=== 攻击3：列带内完全没有墨（空列）===")
c=np.zeros((H,120,3),dtype=np.uint8); c[...]=255
c[5:55, 10:40]=182
s,sh=split_by_colour_and_luminance(c,column_edges=[5,45,115])
print(f"  空列 solid 像素={int(s[5:55,45:115].sum())}  shadow 像素={int(sh[5:55,45:115].sum())}")
print(f"  → {'干净（无幽灵像素）' if s[5:55,45:115].sum()==0 else '幽灵像素!'}")

print()
print("=== 攻击4：两层明度极接近（差 3 级，接近不可分）===")
c,e=make(120,[(5,100,[((182,182,182),5,60),((185,185,185),60,100)])])
s,sh=split_by_colour_and_luminance(c,column_edges=e)
print(f"  182区 solid={cov(s,5,55,5,60):.2f}  185区 漏入={cov(s,5,55,60,100):.2f}")
print(f"  → 差3级：{'仍分开（超预期）' if cov(s,5,55,60,100)<0.1 else '混同（可接受，物理不可分）'}")

print()
print("=== 攻击5：彩色单层列（无包络）===")
c,e=make(120,[(5,100,[((0,62,137),5,100)])])
s,sh=split_by_colour_and_luminance(c,column_edges=e)
print(f"  深蓝单层 solid={cov(s,5,55,5,100):.2f}")
print(f"  → {'正确提取' if cov(s,5,55,5,100)>0.9 else '误判为阴影!'}")

print()
print("=== 攻击6：纯黑单层（bin 0 回归）===")
c,e=make(120,[(5,100,[((0,0,0),5,100)])])
s,sh=split_by_colour_and_luminance(c,column_edges=e)
print(f"  纯黑单层 solid={cov(s,5,55,5,100):.2f}")
