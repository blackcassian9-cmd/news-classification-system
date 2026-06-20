"""把用户设计好的 11 个静态页面（中文名）复制到 frontend/<slug>.html，并注入接线脚本。

设计原则（务必遵守）：
  - 不改动用户的视觉结构/样式；只在 </body> 前注入两个 <script>：
        <script>window.API_BASE="";window.PAGE="<slug>";</script>
        <script src="/assets/app.js"></script>
    所有数据绑定、菜单跳转、下拉修正、图表嵌入都写在 assets/app.js 里，按 PAGE 分发。
  - 幂等：可重复运行，总是从源文件重新拷贝并重新注入（因此不要手改 frontend/*.html）。

运行： python backend/scripts/build_frontend.py
"""
from __future__ import annotations

import os
import shutil

HERE = os.path.dirname(os.path.abspath(__file__))
BACKEND = os.path.dirname(HERE)
ROOT = os.path.dirname(BACKEND)                 # e:\课设
FRONTEND = os.path.join(ROOT, "frontend")
ASSETS = os.path.join(FRONTEND, "assets")

# 源中文文件名 -> 目标 slug
PAGES = {
    "前端主界面.html": "index",
    "数据集管理界面.html": "datasets",
    "数据预览与清洗界面.html": "preview",
    "TF-IDF 特征提取界面.html": "features",
    "模型训练界面.html": "training",
    "深度学习参数优化界面.html": "optimization",
    "模型评价与可视化界面.html": "evaluation",
    "错误样本与关键词解释界面.html": "errors",
    "实验记录与模型管理界面.html": "experiments",
    "新闻文本预测界面.html": "prediction",
    "报告导出界面.html": "reports",
}


def inject(html: str, slug: str) -> str:
    snippet = (
        '\n  <script>window.API_BASE="";window.PAGE="%s";</script>\n'
        '  <script src="/assets/app.js"></script>\n' % slug
    )
    if "</body>" in html:
        return html.replace("</body>", snippet + "</body>", 1)
    return html + snippet


def main() -> None:
    os.makedirs(ASSETS, exist_ok=True)
    built = []
    for src_name, slug in PAGES.items():
        src = os.path.join(ROOT, src_name)
        if not os.path.exists(src):
            print(f"[跳过] 找不到源文件：{src_name}")
            continue
        with open(src, "r", encoding="utf-8") as f:
            html = f.read()
        out = os.path.join(FRONTEND, f"{slug}.html")
        with open(out, "w", encoding="utf-8") as f:
            f.write(inject(html, slug))
        built.append(slug)
        print(f"[完成] {src_name}  ->  frontend/{slug}.html")
    print(f"\n共生成 {len(built)} 个页面：{', '.join(built)}")
    print("提示：assets/app.js 单独维护，本脚本不覆盖它。")


if __name__ == "__main__":
    main()
