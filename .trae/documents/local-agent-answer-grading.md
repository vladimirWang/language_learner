# 本地 Agent 对话判分

## Context

当前对话题通过字符串比较，要求学生答案与 `courses/*.md` 完全一致。本次改为由运行在本地 Tauri Rust 进程中的判分 Agent 调用 DashScope：允许同义表达、自然缩写及大小写/标点差异，但答案必须英文语法正确，并能恰当回应题目。短语题逻辑不变。模型推理需要联网。

技术选型采用 Rust 而非 Python sidecar：当前 Agent 只需构造 Prompt、请求 DashScope 并解析 JSON，直接复用 Tauri Rust 后端可避免额外 Python 运行时、独立进程、本地端口和进程通信，同时简化打包并隔离密钥。未来若需要复杂 LangGraph 工作流，可在保持前端判分接口不变的前提下迁移为 Python sidecar。

## 实现步骤

1. **新增本地判分 Agent**
   - 新建 `src-tauri/src/agent.rs`，提供 `grade_dialogue_answer` Tauri command。
   - 接收题目展示句、MD 参考答案、练习方向（写问句/写答句）和学生答案；校验空值、长度和练习方向。
   - 使用 DashScope OpenAI-compatible `/chat/completions` 接口，默认模型 `qwen-plus`，允许通过 `DASHSCOPE_MODEL` 覆盖；设置低温度、请求超时和 JSON object 输出。
   - Prompt 将学生文本仅作为待评数据，明确允许同义表达，但要求语法正确、语境恰当且符合问句/答句方向；只接受 `{ "correct": boolean }`，无法解析时视为服务异常而不是答错。

2. **接入 Tauri 后端与安全配置**
   - 在 `src-tauri/src/lib.rs` 注册 Agent 模块和 command。
   - 在 `src-tauri/Cargo.toml` 增加 `reqwest`（JSON + rustls）和 `dotenvy`，复用现有 Serde；更新 Cargo.lock，不增加前端依赖。
   - `DASHSCOPE_API_KEY` 只存在 Rust 进程，不进入 Vite、前端返回值、日志或应用资源。
   - 配置优先级：真实进程环境变量；开发及 debug 应用读取项目根 `.env`；本地 release 应用读取 Tauri app config 目录下 `.env`。缺少配置只让判分功能提示不可用，不影响游戏启动。
   - 在 `.gitignore` 添加 `.env`，避免密钥被提交。

3. **改造答题交互**
   - 修改 `src/components/LevelPlay.tsx`：删除精确匹配逻辑，通过 `invoke` 异步调用本地 Agent。
   - 增加“判分中”状态，判分期间禁用输入和提交，按钮显示进度，防止重复请求。
   - 只有 Agent 明确返回 `correct: false` 才增加错误次数、播放错误音效；网络、配置、超时和协议异常显示“判分服务暂不可用，本次不计错，可重试”。
   - 使用挂载标记和请求序号忽略退出关卡或切换题目后的过期响应，避免旧请求推进关卡。
   - 将提示改为“可使用同义表达，需语法正确并恰当回应”；保留现有答对推进、星级和通关规则。
   - 在 `src/styles.css` 补充判分中与服务错误所需的少量样式。

## 验证

- 运行 `cargo test`、`cargo check` 和 `pnpm build`，覆盖严格 JSON 解析、非法结果和配置缺失。
- 在原生 Tauri 应用中分别验证：MD 原答案、合理同义表达判对；语法错误、语法正确但离题、问句/答句方向错误判错。
- 验证断网或缺少配置时不计错且可重试；判分中不能重复提交，返回地图后旧响应不会修改进度。
- 验证短语题、随机题序、全部答对通关和下一关点亮均保持正常。
