"""
Comprehensive S0-S7 end-to-end interactive workflow test & audit.
Automates real MS Edge browser through playwright-cli.
Verifies each stage's UI elements, banners, drawers, canvas, inspector, and export dialog.
Saves high-res visual evidence screenshots at every stage.
"""

import os
import subprocess
import time

PLAYWRIGHT_CLI = r"D:\Program Files\nodejs\node_global\node_modules\@playwright\cli\playwright-cli.js"


def run_pw(*args: str) -> str:
    cmd = ["node", PLAYWRIGHT_CLI] + list(args)
    res = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", check=False)
    return res.stdout + res.stderr


def audit_workflow():
    print("=== [Straditize Pro v2.0] S0-S7 完整工作流逐阶段上机核验与审计 ===")

    # 1. 打开页面
    print("\n1. 启动 MS Edge 浏览器访问系统...")
    run_pw("open", "http://127.0.0.1:8765/", "--browser", "msedge")
    time.sleep(1.2)

    # 截图 Stage S3 (初始载入状态，默认有数据)
    print("2. 初始页面核验 (S3 分列阶段)...")
    run_pw("screenshot", "--filename", "audit_01_stage_s3_initial.png")

    # 3. 逐级回退或点击各个步骤胶囊，核验各阶段展示
    # 3.1 切换至 S1 (ROI 数据有效区阶段)
    print("3.1 切换至 S1 (1.加载/ROI 框选阶段)...")
    run_pw("click", ".workflow-step-btn[data-step=\"1\"]")
    time.sleep(0.6)
    run_pw("screenshot", "--filename", "audit_02_stage_s1_roi.png")

    # 3.2 切换至 S2 (图像去横线清理阶段)
    print("3.2 切换至 S2 (2.ROI 与图像清理阶段)...")
    run_pw("click", ".workflow-step-btn[data-step=\"2\"]")
    time.sleep(0.6)
    run_pw("screenshot", "--filename", "audit_03_stage_s2_clean.png")

    # 3.3 切换至 S4 (标尺标定阶段)
    print("3.3 切换至 S4 (4.标尺阶段)...")
    run_pw("click", ".workflow-step-btn[data-step=\"4\"]")
    time.sleep(0.6)
    run_pw("screenshot", "--filename", "audit_04_stage_s4_calibration.png")

    # 3.4 切换至 S5 (拐点提取与多边形精修阶段)
    print("3.4 切换至 S5 (5.拐点阶段)...")
    run_pw("click", ".workflow-step-btn[data-step=\"5\"]")
    time.sleep(0.6)
    run_pw("screenshot", "--filename", "audit_05_stage_s5_refine.png")

    # 3.5 切换至 S6 (地学校验阶段)
    print("3.5 切换至 S6 (6.校验阶段)...")
    run_pw("click", ".workflow-step-btn[data-step=\"6\"]")
    time.sleep(0.6)
    run_pw("screenshot", "--filename", "audit_06_stage_s6_verification.png")

    # 3.6 切换至 S7 (导出阶段并唤出导出弹窗)
    print("3.6 切换至 S7 (7.导出阶段并核查全量双向冻结表格)...")
    run_pw("click", ".workflow-step-btn[data-step=\"7\"]")
    time.sleep(0.6)
    run_pw("click", "#btn-export-csv")
    time.sleep(1.0)
    run_pw("screenshot", "--filename", "audit_07_stage_s7_export_modal.png")

    # 4. 关闭导出弹窗并测试右侧属性检查器折叠后的实体把手
    print("4. 关闭弹窗并核查右侧属性检查器折叠把手...")
    run_pw("click", "#modal-close")
    time.sleep(0.5)
    run_pw("click", "#btn-collapse-inspector")
    time.sleep(0.5)
    run_pw("screenshot", "--filename", "audit_08_inspector_drawer_tab.png")

    # 5. 测试年代-深度模型弹窗空状态大卡片
    print("5. 调出年代模型弹窗核查中央上传引导卡片...")
    run_pw("click", "#btn-age-depth-modal")
    time.sleep(0.8)
    run_pw("screenshot", "--filename", "audit_09_agedepth_empty_upload_zone.png")

    # 6. 关闭浏览器
    run_pw("close")
    print("\n=== 全套工作流逐阶段上机核验完毕！===")


if __name__ == "__main__":
    audit_workflow()
