"""
Real-user full-flow interactive simulation on Straditize Pro v2.0
Runs via playwright-cli against http://127.0.0.1:8765/
"""

import os
import subprocess
import time

PLAYWRIGHT_CLI = r"D:\Program Files\nodejs\node_global\node_modules\@playwright\cli\playwright-cli.js"


def run_pw(*args: str) -> str:
    cmd = ["node", PLAYWRIGHT_CLI] + list(args)
    res = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", check=False)
    return res.stdout + res.stderr


def capture_all():
    print("=== [Straditize Pro] 上机实机工作流体验与操作录制 ===")
    
    # 0. 清理旧文件
    for f in ["experience_step1_roi.png", "experience_step2_columns.png", "experience_step3_ghosting.png", "experience_step4_export_qa.png"]:
        if os.path.exists(f):
            os.remove(f)

    # 1. 打开页面
    print("\n1. 启动 MS Edge 浏览器访问当前系统 (http://127.0.0.1:8765/)...")
    run_pw("open", "http://127.0.0.1:8765/", "--browser", "msedge")
    time.sleep(1.0)

    # 2. 体验 Step 1: 有效区 (ROI)
    print("2. 体验 Step 1：切换到 ROI 模式并保存截图...")
    run_pw("click", "#step-btn-roi")
    time.sleep(0.5)
    run_pw("screenshot", "--filename", "experience_step1_roi.png")

    # 3. 体验 Step 2: 切分各列与形态确认
    print("3. 体验 Step 2：点击当前属种卡片并保存截图...")
    run_pw("click", "#step-btn-columns")
    time.sleep(0.6)
    run_pw("click", ".taxa-card[data-taxa-id=\"taxa_1\"]")
    time.sleep(0.4)
    run_pw("screenshot", "--filename", "experience_step2_columns.png")

    # 4. 体验 Step 3: 查看绿色原位半透明逆向重叠层 (Ghosting)
    print("4. 体验 Step 3：查看绿色原位半透明逆向重叠层 (Ghosting)...")
    run_pw("click", ".taxa-card[data-taxa-id=\"taxa_0\"]")
    time.sleep(0.5)
    run_pw("screenshot", "--filename", "experience_step3_ghosting.png")

    # 5. 体验 Step 4: 打开科学数据导出弹窗与 100% 丰度总和自检门禁
    print("5. 体验 Step 4：打开科学数据导出面板...")
    run_pw("click", "#btn-export-csv")
    time.sleep(0.8)
    run_pw("screenshot", "--filename", "experience_step4_export_qa.png")

    # 关闭浏览器
    run_pw("close")
    print("\n=== 上机实操体验完成，全套实机运行截图已保存！===")


if __name__ == "__main__":
    capture_all()
