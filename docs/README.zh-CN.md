# PromptScope 使用说明

[中文项目首页](../README.zh-CN.md) | [English](../README.md)

PromptScope 是一个运行在本机的二维视觉检测实验台。使用现成的 Grounding DINO 权重推理，通过不同提示词对比检测结果；不训练、不微调。

## 本机启动

已经安装好依赖时，双击项目中的 `Start-PromptScope.cmd`，然后打开 **http://127.0.0.1:8765**。启动窗口需要保持运行；关闭窗口后服务停止。

第一次从 GitHub 下载项目，需要 Python 3.11 或 3.12。在项目目录打开 PowerShell：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\Setup.ps1 -WithModel
.\.venv\Scripts\python.exe scripts\download_model.py --model tiny
.\.venv\Scripts\python.exe -m promptscope
```

只想先看界面和真实样例结果，可以省略 `-WithModel` 以及下载模型的那一行。此时仍然可以查看样例、对比、导入和导出；新图片推理需要模型依赖和权重。

Tiny 权重从 IDEA-Research 官方 Hugging Face 仓库下载到 `models/`。不需要手动去网页找权重文件。版本固定，之后优先读本地缓存。Base 也可选择，首次使用另外下载，当前本机验证使用的是 Tiny CPU。

## 工作台

1. 左侧上传图片，或加载 NASA 样例。
2. 在右侧「手动实验」中，每行填写一组提示词。类别用英文句号分隔，例如 `person. helmet.`。
3. 点击「运行检测」。第一次加载模型稍慢，执行记录会显示当前阶段。
4. 在当前实验组内，为 A / B 选择两条检测结果，用「并排」或「叠加」查看差异。A 为青色，B 为琥珀色；叠加时 B 使用虚线。
5. 拖动显示阈值、点击检测框或表格中的标签检查坐标和分数。
6. 「导出实验」提供 JSON、CSV、Markdown；图像下方可保存带框 PNG。

每次点击运行都会新增一个实验组，换图片也会新建。左侧「手动 / Agent」分开管理，点击卡片恢复该组图片、提示词和结果；A/B 与导出仅使用当前组。实验自动保存，星标「保留」可置顶，删除后可在回收站恢复。

同一图片、提示词、模型版本和参数会复用缓存，但仍会新增实验组。显示阈值只筛选已有候选框，不触发推理；高级参数中的文本阈值影响标签生成，需要重新运行。

## Agent 助手

默认「本地模板」无需密钥，会生成三组预定义提示词变化。先检查计划，再点击执行；检测完成后保存对比结果和轨迹。模板模式不调用大模型。

如需大模型根据研究问题生成计划和分析，点击顶部「API 接入」：

1. 选择 DeepSeek、OpenAI 或「自定义兼容服务」；自定义服务可填写名称和基础地址。
2. 填写 API Key。「已配置」时留空会保留当前接口的密钥；切换运营商或地址后需重新填写。
3. 点击「获取模型列表」后选择模型，也可直接输入模型 ID。获取列表不会运行实验。
4. 选择思考模式：跟随模型默认、关闭、开启；开启后可选思考强度。支持范围取决于所选模型。
5. 点击「保存并应用」，新请求立即使用新配置，无需重启。随后在 Agent 面板选择「LLM Agent」。

配置保存在当前数据目录的 `llm-settings.json`，不进入 Git；页面不会回填已存密钥，报告也不会包含密钥。保存的页面配置优先于环境变量。也可通过启动服务的 PowerShell 设置初始值：

```powershell
$env:PROMPTSCOPE_LLM_API_KEY = '<你的密钥>'
$env:PROMPTSCOPE_LLM_MODEL = '<服务商的模型 ID>'
$env:PROMPTSCOPE_LLM_BASE_URL = 'https://api.openai.com/v1'
.\.venv\Scripts\python.exe -m promptscope
```

环境变量需要重启才能读取；页面设置无需重启。兼容服务需要支持 Chat Completions 和 JSON mode；DeepSeek 自动使用 `max_tokens`，其他服务使用 `max_completion_tokens`。密钥只由服务端读取，不放进前端或 GitHub。已在本机完成一次 DeepSeek 规划、真实检测和分析流程；其他服务仍需按所选模型验证兼容性。

LLM 接收研究问题、目标概念和结构化检测结果，图片不会发送给 LLM。每次最多四组实验，不会无限循环、训练模型或执行任意代码。当前模型调用结束后才能取消后续实验。

## DeepSeek 快速测试

1. 打开项目根目录的 `deepseek.local.json`（新下载项目若没有此文件，复制 `deepseek.example.json` 并改名）。只填写空白的 `api_key`，保存文件。
2. 双击 `Start-DeepSeek.cmd`，保持窗口打开。
3. 访问 **http://127.0.0.1:8766**。页面自动加载同一张宇航员图片和真实样例结果。
4. 在「Agent 助手」选择「LLM Agent」，目标概念保留 `astronaut`，点击「生成实验计划」。
5. 检查计划，点击「执行这组实验」。成功后应有本地检测结果，以及标为 LLM 的分析报告。若分析请求失败，会保留检测结果并显示失败原因。

接口地址 `https://api.deepseek.com`、模型 `deepseek-flash`、端口 `8766` 已预设，依据 [DeepSeek 官方文档](https://api-docs.deepseek.com/)。初始请求采用 JSON 输出，关闭思考模式，可在「API 接入」中调整。密钥留空时，启动器会提示填写并退出，不会调用 API。

这个启动器的记录单独存入 `data/api-test/`，已有 Tiny 权重继续复用。`deepseek.local.json` 已加入 Git 忽略规则。页面保存的设置优先于启动文件；日常修改请使用「API 接入」。不要同时启动两个 DeepSeek 测试服务。

## 不要把检测数量当成准确率

「空间匹配」表示两组框的 IoU 对应关系，不判断是否正确。模型分数也不是准确率，跨提示词直接比较分数不能证明某组更好。

需要评价时，给实验 A 导入人工标注 JSON：

```json
{
  "ground_truth": [
    {"label": "person", "box": [0.1, 0.1, 0.8, 0.9]}
  ],
  "label_map": {"astronaut": "person"}
}
```

坐标是归一化的 `[左, 上, 右, 下]`，范围 0–1。自由文本标签需显式映射。计算的是单张图片、指定 IoU 的 all-points AP，不是 COCO mAP。样例标注 `examples/annotations.json` 只用于演示流程，不是正式测试集。

## 数据和常见问题

- 图片、实验和计划保存在 `data/`；模型保存在 `models/`。这些目录不会上传 GitHub。
- 上传支持 JPEG / PNG / WebP，最大 8 MiB、2400 万像素。
- 缺少模型依赖：重新运行带 `-WithModel` 的安装命令。
- 网络不通：已完整下载模型时可设置 `$env:PROMPTSCOPE_OFFLINE = '1'`；首次下载仍需能够访问官方仓库。
- 端口被占用：使用 `python -m promptscope --port 8766`，然后打开对应地址。
- 只用于本机：服务监听 `127.0.0.1`，当前没有多用户登录或公网部署配置。

[返回中文项目首页](../README.zh-CN.md) · [English](../README.md) · [验证记录](validation.md)
