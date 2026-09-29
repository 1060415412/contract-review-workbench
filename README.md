# 合同审查工作台 v2.0.0（本地编排版）

按上传的扣子工作流 `law_check` 的节点逻辑，在本地复刻完整编排；**不调用扣子**，三个 LLM 节点改为可替换的大模型接口，由你自行接入。

## 零、从零部署（新机器，3 分钟）

### 1. 安装 Node.js 18+

- 官网下载 LTS 版：https://nodejs.org/ （Windows 选 .msi，一路下一步）
- 装完验证（要能打印版本号）：

```bash
node -v   # v18.x / v20.x / v22.x 均可，本项目零第三方依赖
npm -v
```

> 只在需要解析 PDF / 旧版 DOC 时才装可选依赖，见「六、文件格式支持」。

### 2. 拿到代码

```bash
git clone <你的仓库地址> contract-review
cd contract-review
```

或直接下载 ZIP 解压后进入目录。

### 3. 配置大模型

```bash
cp .env.example .env      # Windows 没有 cp 就手动复制一份改名 .env
```

编辑 `.env`，至少填这三项：

```ini
LLM_BASE_URL=https://api.deepseek.com/v1
LLM_API_KEY=sk-你的密钥
LLM_MODEL=deepseek-chat
```

> 不填也能跑：页面会进入「演示模式」，用模拟数据走完整流程。

### 4. 启动

```bash
node server.js
```

Windows 也可双击 `start.bat`。窗口出现「合同审查工作台已启动」后，浏览器打开 **http://127.0.0.1:5173**。

### 5. 验证部署是否成功

```bash
curl http://127.0.0.1:5173/api/status
```

返回 `"configured":true` 表示大模型已接入；`false` 表示当前是演示模式。

### 6. 常用启动参数

| 场景 | 命令 |
| --- | --- |
| 换端口 | `PORT=5174 node server.js`（Windows 用 `set PORT=5174 && node server.js`） |
| 只允许本机访问 | `HOST=127.0.0.1 node server.js`（默认 `0.0.0.0`，局域网/手机可访问） |

## 一、启动

方式一：双击 `start.bat`（自动检测 Node 并启动）。

方式二：命令行

```bash
cd contract-review
node server.js
```

浏览器打开 **http://127.0.0.1:5173**；同一 WiFi 下的手机/其他电脑用启动日志里打印的局域网地址（默认监听所有网卡，可用 `HOST=127.0.0.1 node server.js` 改回仅本机）。

### 页面空白 / 打不开时先查这三条

1. **服务没起来**：窗口里应看到「合同审查工作台已启动」。若提示 `端口 5173 已被占用`，说明已有实例在跑，直接访问 http://127.0.0.1:5173 即可，或 `PORT=5174 node server.js` 换端口。
2. **地址不对**：必须是 `http://127.0.0.1:5173`，不要直接双击 `index.html`（file:// 打开无法调用接口）。手机要用局域网 IP，不能用 127.0.0.1。
3. **能打开但没反应**：确认窗口里没有报错；页面右上角状态应为「未配置大模型 · 演示模式」或「大模型已连接（模型名）」，显示「无法连接本地服务」说明接口请求失败。

## 二、本次改了什么 / 为什么改

| v1.0.0 | v2.0.0 |
| --- | --- |
| 服务端调用扣子 `/v1/workflow/run` | 改为本地编排，四步全部在本地执行 |
| 密钥 = 扣子 PAT | 改为大模型 `LLM_API_KEY` + `LLM_BASE_URL` + `LLM_MODEL` |
| 文件读取由扣子插件完成 | 新增 `src/extract.js` 本地提取（TXT/MD/DOCX 零依赖；PDF、旧 DOC 走可选依赖） |
| 三个 LLM 节点在扣子平台内 | 提示词原文搬到 `src/prompts.js`，由 `src/llm.js` 调用你的模型 |
| 企业查询用扣子插件 | 改为 `src/enterprise.js`，留 `ENTERPRISE_API_URL` 数据源接口，未配置则跳过并提示人工复核 |
| 报告上传飞书插件 | 改为 `src/report.js`：生成本地 Markdown 报告（页面按钮可直接打开），可选 `REPORT_WEBHOOK_URL` 推送到你的系统 |

页面交互（上传/进度/结果/筛选/复制/历史）保持不变。

## 三、后台编排链路（对应工作流节点）

```
开始
 ├─ 1 提取合同内容        src/extract.js      文件读取节点
 ├─ 1 解析标题/合作方     LLM 调用①           流程4：解析合同标题和合作方公司
 ├─ 2 查询企业信息        src/enterprise.js   企业信息查询分支（可插拔数据源）
 │   └─ 企业风险总结      LLM 调用②（仅当有数据时）  流程4.3：企业风险总结
 ├─ 3 审查合同条款        LLM 调用③④（并行）  流程2 常规审查 + 流程3 旧法引用初筛
 └─ 4 生成审查报告        src/report.js       数据汇总 + 报告输出
结束
```

提示词与工作流保持一致：合同类型、审查立场、重点审查、补充要求会拼成 `xuqiu` 一并传入；输出解析沿用工作流的固定 Markdown 格式（问题 / 分析 / 修改建议）。

## 四、大模型接口怎么接（你要做的唯一一步）

`.env` 里三项（或页面右上角「接口配置」填写，写入本机 `.env`）：

| 配置项 | 示例 | 说明 |
| --- | --- | --- |
| `LLM_BASE_URL` | `https://api.deepseek.com/v1` | OpenAI 兼容端点，程序自动拼 `/chat/completions`；填完整地址也可 |
| `LLM_API_KEY` | `sk-xxx` | 只在本机 `.env`，服务端读取，不进页面/日志/仓库 |
| `LLM_MODEL` | `deepseek-chat` | 模型名 |

可选：`LLM_TEMPERATURE`、`LLM_MAX_TOKENS`、`LLM_TIMEOUT_MS`。

已验证可用的接入形态（均为 OpenAI 兼容 `/chat/completions`）：DeepSeek、通义千问兼容模式、智谱 GLM、Kimi/Moonshot、豆包 OpenAI 兼容端点、本地 Ollama（`http://127.0.0.1:11434/v1`）、vLLM / One-API 聚合网关。

> 要换成非 OpenAI 协议（如 Anthropic 原生、自研网关），只改 `src/llm.js` 的 `chat()`，其余代码不用动。

未配置时：页面顶部显示「未配置大模型 · 演示模式」，提交后返回演示数据并标注「当前为演示结果」。

## 五、可插拔的另外两个接口

**企业信息数据源**（对应工作流的企业查询插件分支）

- `.env` 配 `ENTERPRISE_API_URL`（可选 `ENTERPRISE_API_TOKEN`）
- 你的接口接收 `POST {company}`，返回 `{ registration:{}, annualReports:[], creditA:[], abnormal:[] }`
- 未配置或返回空：页面输出「未配置数据源 / 数据源未返回有效信息，请人工复核」，流程不中断

**审查报告**（对应工作流的飞书云文档节点）

- 默认生成本地 Markdown 报告 `public/reports/report-*.md`，结果页「查看完整审查报告」按钮直接打开
- 配 `REPORT_WEBHOOK_URL` 后额外把 `{title, content}` 推到你的系统（如飞书机器人），推送失败不影响主流程

## 六、文件格式支持

| 格式 | 支持情况 |
| --- | --- |
| TXT / MD / Markdown / CSV | 内置，开箱可用 |
| DOCX | 内置（零依赖解析 zip+xml） |
| PDF | 需可选依赖：`npm i pdf-parse` |
| 旧版 DOC | 需可选依赖：`npm i word-extractor`（建议另存为 docx） |

## 七、演示流程

1. 先不配大模型 → 顶部「演示模式」→ 选类型/立场/重点项 → 粘贴文本或拖拽上传 → 开始智能审查
2. 看四步进度 → 自动滚动到结果 → 顶部黄色「当前为演示结果」
3. 切高/中/低筛选、复制修改建议、一键复制全部、看历史记录、点报告按钮
4. 右上角「接口配置」填入 `LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL` → 保存 → 重新提交，走真实模型（结果头部会显示模型名与各步骤耗时）
5. 接口报错：页面显示具体原因 + 「重新尝试」+「改用演示数据」

## 八、目录

```
server.js            HTTP 服务、路由、鉴权配置接口
src/config.js        .env 读写（密钥只落本机）
src/prompts.js       三个 LLM 节点提示词原文 + xuqiu 组装
src/llm.js           大模型适配层（OpenAI 兼容，替换模型只改这里）
src/extract.js       合同文本提取
src/parser.js        审查意见 / 旧法引用解析、风险等级初判
src/enterprise.js    企业信息数据源（可插拔）
src/report.js        报告生成与可选推送
src/pipeline.js      四步编排（对应页面四步）
src/demo.js          演示数据
public/              页面（index.html / styles.css / app.js）
eval/                效果评测集（10 份合同 + 人工标注 + 评测脚本）
EVAL-报告-合同审查-20260929.md   评测结论与 badcase 改进方案
start.bat            Windows 双击启动
```

## 九、效果评测（`eval/`）

固化的回归测试：10 份合同样本 + 55 条人工标注风险，用 LLM-as-judge 判定命中与误报。

```bash
node eval/run.js 3            # 跑 10 份（并发 3），输出召回率/误报率，明细写 eval/result.json
node eval/stability.js        # 同一合同跑 3 轮，检查输出是否稳定
```

当前基线（deepseek-chat）：召回率 92.7%、误报率 10.5%、风险等级一致率 43%。
改完提示词或解析器后重跑一次即可对比前后指标，详见 `EVAL-报告-合同审查-20260929.md`。

## 十、说明

- 风险等级由服务端按关键词初判，仅用于归类筛选，签署前需人工复核。
- 审查结果为 AI 初筛，不构成最终法律意见。
- `.env` 与 `public/reports/` 已在 `.gitignore`，不要外传密钥。
