# 中文新闻文本自动分类系统

输入一条新闻标题或一段新闻文本，系统自动判断它属于哪一类新闻（财经、体育、娱乐、科技……）。

本项目是一套**前后端一体**的中文新闻文本分类系统：前端是 11 个可视化页面（课程设计已设计好），后端用 **Python + Flask + scikit-learn** 实现完整的「读取数据 → 中文预处理 → TF-IDF 特征 → 训练朴素贝叶斯/逻辑回归 → 评价可视化 → 预测」流水线，并在此基础上做了若干增强（参数可调、深度学习自动调参、相似新闻推荐、智能结论、报告导出）。

---

## 目录

- [一、系统亮点](#一系统亮点)
- [二、技术栈](#二技术栈)
- [三、目录结构](#三目录结构)
- [四、快速开始（如何把前后端连起来）](#四快速开始如何把前后端连起来)
- [五、前后端是怎么连通的](#五前后端是怎么连通的)
- [六、数据格式说明（重要：不会把文本和标签读反）](#六数据格式说明重要不会把文本和标签读反)
- [七、API Key 配置（DeepSeek 与网页搜索，用户自备）](#七api-key-配置deepseek-与网页搜索用户自备)
- [八、推荐使用流程](#八推荐使用流程)
- [九、11 个模块逐一说明](#九11-个模块逐一说明)
- [十、关键概念澄清](#十关键概念澄清)
- [十一、常见问题与排错](#十一常见问题与排错)

---

## 一、系统亮点

- **严格双模型**：预测模型只有两个——多项式朴素贝叶斯（NB）与逻辑回归（LR）。系统会自动按验证集表现选出最优模型。
- **中文预处理不过度清洗**：只去除多余空白与异常控制字符，保留中文、英文、数字与必要标点，不破坏语义；默认用字符 n-gram（单字/双字/三字）做特征，也支持 jieba 分词模式。
- **参数全可调**：n-gram 范围、`min_df`（过滤太少出现的词）、`max_df`（过滤太常见的词）、`max_features`（限制特征数量）、LR 的正则强度 `C`、NB 的平滑系数 `alpha`，前端都能调。
- **深度学习只用于「调参」**：用神经网络代理模型（DNGO 风格的贝叶斯优化）为 NB/LR 自动搜索最优超参数，**不参与预测**。
- **智能结论**：凡是页面上「结论 / 建议」类文字，都调用 **DeepSeek 大模型**生成（用户自备 Key）；未配置 Key 时回退到基于真实指标的规则化结论。
- **相似新闻推荐**：调用**网页搜索 API** 全网检索相似新闻并给出真实链接与相似度，而不是从本地数据集里找。
- **持久化**：数据集、训练记录、预测、优化结果、设置、事件都存入 SQLite，支持「较上次 +x.xx%」这种对比展示（首次没有上一次时不显示增量）。

---

## 二、技术栈

| 层 | 选型 |
|---|---|
| 后端框架 | Flask 3 + flask-cors |
| 机器学习 | scikit-learn（TfidfVectorizer / MultinomialNB / LogisticRegression / MLPRegressor） |
| 数据处理 | pandas、numpy、scipy、jieba（可选分词） |
| 可视化 | matplotlib（Agg 后端，生成 PNG 图表） |
| 存储 | SQLite（系统数据）、joblib（模型/向量器） |
| 大模型/搜索 | DeepSeek API、可插拔网页搜索（Serper / Bing / SerpAPI）；均为用户自备 Key |
| 前端 | 静态 HTML + 单文件 `assets/app.js` 数据绑定（不改变原视觉设计） |

> 建议 Python 版本 **3.10+**。

---

## 三、目录结构

```
课设/
├─ start.ps1                    # 一键启动（PowerShell）
├─ start.bat                    # 双击启动（调用 start.ps1）
├─ README.md                    # 本文档
├─ 前端主界面.html 等 11 个静态页面   # 你设计的原始页面（源文件，请勿手改生成物）
│
├─ frontend/                    # 由源页面生成（注入接线脚本，视觉不变）
│  ├─ index.html / datasets.html / ... / reports.html
│  └─ assets/app.js             # 所有数据绑定、菜单跳转、图表嵌入逻辑
│
└─ backend/
   ├─ app.py                    # Flask 入口（同源托管前端 + /api/*）
   ├─ config.py                 # 路径、默认参数、标签映射
   ├─ requirements.txt          # 后端依赖
   ├─ api/                      # 各模块 REST 蓝图
   │  ├─ overview / datasets / preview / features_api / training
   │  ├─ optimization / evaluation / errors_api / experiments
   │  └─ prediction / reports
   ├─ core/                     # 业务核心
   │  ├─ data_loader / preprocess / features / models / evaluate
   │  ├─ optimizer（DNGO 调参）/ error_analysis / similar_news
   │  ├─ web_search（相似新闻搜索适配器）/ llm（DeepSeek 客户端）/ services
   ├─ db/database.py            # SQLite 读写
   ├─ scripts/build_frontend.py # 由源页面生成 frontend/
   └─ storage/                  # 运行期产物（自动创建）
      ├─ app.db                 # SQLite 数据库
      ├─ datasets/thucnews/     # 内置 THUCNews 训练/测试集
      ├─ models/                # 训练出的模型/向量器（joblib）
      ├─ charts/                # 生成的 PNG 图表与导出的报告
      └─ uploads/               # 用户上传的数据集
```

---

## 四、快速开始（如何把前后端连起来）

### 方式 A：一键启动（推荐，Windows）

在项目根目录 `课设/` 下：

```powershell
powershell -ExecutionPolicy Bypass -File .\start.ps1
```

或直接**双击 `start.bat`**。脚本会自动完成：创建虚拟环境 `.venv` → 安装依赖 → 由你的 11 个页面生成 `frontend/` → 启动后端。

启动成功后打开浏览器访问：

```
http://127.0.0.1:5000
```

常用参数：

```powershell
.\start.ps1 -Reinstall      # 强制重新安装依赖
.\start.ps1 -NoBuild        # 跳过前端生成（没改源页面时更快）
.\start.ps1 -Port 8080      # 换端口
```

### 方式 B：手动启动（任何系统）

```bash
# 1) 进入后端目录，创建并激活虚拟环境
cd backend
python -m venv .venv
# Windows:  .venv\Scripts\activate
# macOS/Linux:  source .venv/bin/activate

# 2) 安装依赖
pip install -r requirements.txt

# 3) 生成前端（把 11 个源页面拷到 ../frontend/ 并注入接线脚本）
python scripts/build_frontend.py

# 4) 启动后端（同源托管前端）
python app.py
```

然后访问 `http://127.0.0.1:5000`。

> 首次启动会自动把 `backend/storage/datasets/thucnews/` 里的内置 THUCNews 数据集登记到库中，**开箱即用**。

---

## 五、前后端是怎么连通的

- **同源托管，零跨域**：后端 `app.py` 既提供 `/api/*` 接口，又用 `send_from_directory` 直接托管 `frontend/` 目录。所以访问 `http://127.0.0.1:5000/index.html` 时，页面里的 `fetch("/api/...")` 和页面同源，不需要配置跨域。
- **不改你的视觉设计**：`scripts/build_frontend.py` 只在每个页面 `</body>` 前注入两行脚本：

  ```html
  <script>window.API_BASE="";window.PAGE="<页面标识>";</script>
  <script src="/assets/app.js"></script>
  ```

  所有动态逻辑都集中在 `frontend/assets/app.js`，按 `window.PAGE` 分发到对应页面的初始化函数。**因此请不要手改 `frontend/*.html`**（它们是生成物）；要改样式就改根目录的中文源页面，然后重新运行 `build_frontend.py`。
- **菜单跳转**：左侧 11 个菜单项、顶部搜索框、各页面的「查看详情 / 快捷操作」按钮都会跳到对应页面（`app.js` 内置了菜单名 → 页面映射）。

---

## 六、数据格式说明（重要：不会把文本和标签读反）

- 每行格式：`新闻文本<分隔符>标签数字`，默认分隔符为制表符 `\t`，标签为 `0~9` 的整数（THUCNews 子集为十分类）。
- 系统**自动防止把文本和标签读反**：
  1. 按「最后一个分隔符」切分（文本里就算含分隔符也不会出错）；
  2. 抽样自动探测标签在行首还是行尾；
  3. 标签必须是小范围非负整数，否则该行计入「跳过」，不污染训练。
- 标签数字 → 中文类名的映射可在数据集导入时被覆盖；默认映射见 `backend/config.py` 的 `DEFAULT_LABEL_NAMES`。

示例（`train.txt`）：

```
中国男足公布最新一期集训名单	7
央行宣布下调存款准备金率0.5个百分点	0
新款旗舰手机搭载自研芯片正式发布	4
```

---

## 七、API Key 配置（DeepSeek 与网页搜索，用户自备）

系统**不内置任何 Key**。在「报告导出」页右侧「API 配置」面板点击即可填写：

- **DeepSeek API Key**：用于所有「结论 / 建议」类文字与报告智能摘要、相似新闻兜底标题。填写后可点「测试连接」验证。
- **网页搜索 API**：用于「新闻文本预测」页的相似新闻**真实链接**。支持 Serper / Bing / SerpAPI，选择服务商并填 Key 即可。

未配置时的回退策略：

- 没配 DeepSeek → 结论用基于真实指标的**规则化文本**（系统照常可用）。
- 没配搜索 API → 相似新闻用 DeepSeek 生成候选标题作为兜底；若两者都没配，则给出基于关键词的占位结果。

> Key 保存在本地 SQLite（`backend/storage/app.db`）的 settings 表，仅本机使用。

---

## 八、推荐使用流程

1. **数据集管理**：使用内置 THUCNews，或上传自己的 `train.txt` / `test.txt`（可设分隔符、编码、是否入库、自动校验标签）。
2. **数据预览与清洗**：查看字段结构与原始/清洗对比，确认预处理规则。
3. **TF-IDF 特征提取**：调 n-gram、`min_df`、`max_df`、`max_features` 等，查看特征概览。
4. **（可选）深度学习参数优化**：用神经网络代理模型为 NB/LR 自动搜最优超参，可一键应用到训练。
5. **模型训练**：用训练集学习，自动切验证集做模型选择，产出 NB + LR 两个模型与验证指标。
6. **模型评价与可视化**：在测试集上看 Accuracy/Precision/Recall/F1/Macro-F1、对比图、各类 F1、混淆矩阵、分类报告与智能结论。
7. **错误样本与关键词解释**：看错分样本、易混淆类别对、错误原因分布与各类关键词。
8. **新闻文本预测**：单条「输入文本预测」，或右下「批量预测」对测试集/上传文件整体推理；查看相似新闻与真实链接。
9. **实验记录与模型管理**：登记/查看实验、模型版本。
10. **报告导出**：勾选内容、选格式，生成包含图表与智能摘要的分析报告。

> 预测的前置条件：**必须先完成一次训练**，系统会用「最优模型」进行预测。

---

## 九、11 个模块逐一说明

| # | 页面（菜单） | 作用 | 主要后端接口 |
|---|---|---|---|
| 1 | 首页总览 `index` | 训练/测试样本数、类别数、最优模型、Accuracy/F1 及「较上次」增量、类型分布条形图、最优参数、运行状态时间线、快速预测 | `/api/overview` |
| 2 | 数据集管理 `datasets` | 上传数据集（实时显示数量与列表）、导入配置（分隔符/编码/入库/校验标签）、当前数据集摘要与字段结构、分布环形图、快捷操作 | `/api/datasets`、`/api/datasets/distribution` |
| 3 | 数据预览与清洗 `preview` | 原始/清洗数据对比、清洗规则开关、清洗前后对比与统计、质量分析 | `/api/preview` |
| 4 | TF-IDF 特征提取 `features` | 特征参数配置（每项有 ⓘ 解释）、特征概览、DF 分布、IDF 直方图、Top 特征、稀疏度分析 | `/api/features` |
| 5 | 模型训练 `training` | **用训练集学习**，切验证集选模型；训练配置、参数详情、结果表、智能结论、训练日志 | `/api/training` |
| 6 | 深度学习参数优化 `optimization` | **只为 NB/LR 调超参**：DNGO 风格代理模型 + UCB 采集，输出最佳参数、候选排行榜（仅 NB/LR）、参数重要性、收敛曲线 | `/api/optimization/config`、`/result`、`/run` |
| 7 | 模型评价与可视化 `evaluation` | 测试集指标卡、模型对比图、各类 F1、混淆矩阵热力、分类报告、智能结论；顶部标签可切换查看后端生成的 PNG 图 | `/api/evaluation`、`/api/evaluation/charts/*.png` |
| 8 | 错误样本与关键词解释 `errors` | 错分样本列表（可搜索/筛选/导出）、易混淆类别对、错误原因分布、各类关键词 | `/api/errors` |
| 9 | 实验记录与模型管理 `experiments` | 实验列表与详情、模型版本、最近任务、新建实验（模型类型仅限 NB/LR） | `/api/experiments` |
| 10 | 新闻文本预测 `prediction` | **选择模型只有 NB/LR**；单条「输入文本预测」、右下「批量预测」；关键词解释、相似新闻（真实链接+相似度）、历史、类别分布 | `/api/prediction/*` |
| 11 | 报告导出 `reports` | 选模板/内容/格式生成报告（含图表与 DeepSeek 摘要）、API Key 配置与连接测试 | `/api/reports/config`、`/generate`、`/api-key*` |

---

## 十、关键概念澄清

### 「模型训练」和「批量预测」是不是重复了？——不是。

- **模型训练**（模型训练页的「训练模型」按钮）= **学习**。用 `train.txt` 拟合 TF-IDF 向量器并训练 NB、LR，切出验证集做模型选择，把模型与最优选择保存下来。它会**改变/产生模型**。
- **批量预测**（新闻文本预测页右下角「批量预测」）= **推理**。用**已经训练好**的最优模型，对一批文本（默认测试集，或你上传的批量文件）逐条预测类别与置信度，并据此给出整体分布。它**不学习、不更新模型**。
- **输入文本预测** = 对**单独一条**新闻做推理。

一句话：训练是「教模型」，批量预测是「让训练好的模型一次性判一批」，二者不重复。

### 深度学习到底干嘛？

深度学习在本系统里**只用于给 NB/LR 调超参数**，不是预测模型。做法参考顶刊 Snoek et al., ICML 2015《Scalable Bayesian Optimization Using Deep Neural Networks》(DNGO)：用神经网络当「代理模型」拟合「超参 → 验证指标」的映射，配合 UCB 采集函数迭代搜索，比传统高斯过程更可扩展（论文里正是拿逻辑回归调参做的实验）。搜索只在训练集内部切出的验证集上评估，**绝不触碰测试集**。优化得到的最优参数可一键应用到训练。

---

## 十一、常见问题与排错

- **页面能打开但数据是「—」/默认值**：多数页面需要先「训练」一次。请先到「模型训练」点训练，再回来查看。
- **预测/评价提示「尚未训练模型」**：同上，先完成一次训练。
- **结论显示的是规则化文字而非大模型生成**：说明未配置 DeepSeek Key，或网络/Key 无效。到「报告导出 → API 配置」填写并「测试连接」。
- **相似新闻没有真实链接**：未配置网页搜索 API。到「API 配置」填写搜索服务商与 Key；未配置时会用大模型生成候选标题兜底。
- **中文乱码（命令行里）**：脚本已设置 `PYTHONUTF8=1`。若手动运行，请先 `set PYTHONUTF8=1`（CMD）或 `$env:PYTHONUTF8=1`（PowerShell）。
- **端口被占用**：用 `.\start.ps1 -Port 8080` 换端口。
- **改了页面样式不生效**：请改根目录的中文源页面（如 `模型训练界面.html`），再运行 `python backend/scripts/build_frontend.py` 重新生成；不要直接改 `frontend/*.html`（会被覆盖）。
- **想重置系统**：停止服务后删除 `backend/storage/app.db`（清空数据库）与 `backend/storage/models/`、`backend/storage/charts/` 下的产物即可；下次启动会重新登记内置数据集。

---

如对某个模块的接口字段或交互细节有疑问，可直接查看 `backend/api/` 下对应蓝图与 `frontend/assets/app.js` 中对应的 `init<页面>` 函数。
