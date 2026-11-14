# 对话判分不可用提示修复

## Summary

针对截图中的“判分服务暂不可用，本次不计错，可重试”，做最小范围的前端错误处理调整：普通浏览器明确提示改用桌面应用；原生 Tauri 中展示后端返回的具体、非敏感错误原因。保持现有语义判分、答错计数和异常不计错规则不变。

## Current State Analysis

- `src/components/LevelPlay.tsx` 通过 `invoke("grade_dialogue_answer", { request: ... })` 调用 Rust，嵌套参数及 `studentAnswer` 命名与 `src-tauri/src/agent.rs` 的 Serde 配置匹配。
- `src-tauri/src/lib.rs` 已注册 `agent::grade_dialogue_answer`，无需修改命令注册。
- 当前 `catch` 未接收错误对象，所有失败都被折叠成同一条提示，无法区分配置、网络、DashScope HTTP 状态或响应解析错误。
- `@tauri-apps/api/core` 已导出 `isTauri()`；普通浏览器没有 Tauri IPC，直接调用 `invoke` 必然失败。
- 仅凭截图无法确定它来自浏览器还是桌面应用，因此不在缺乏证据时改写 Rust 判分逻辑。

## Proposed Changes

### `src/components/LevelPlay.tsx`

1. 从 `@tauri-apps/api/core` 同时导入 `invoke` 和 `isTauri`。
2. 在学生答案非空校验之后、发起 IPC 之前检查 `isTauri()`：
   - 非 Tauri 环境不调用 `invoke`，不进入判分中状态，不增加错误次数。
   - 显示“浏览器无法调用本地 Agent，请使用 Word Adventure 桌面应用”。
3. 将 `catch` 改为 `catch (error)`，保留挂载状态和请求序号检查。
4. 安全提取错误文本：字符串错误直接使用，`Error` 使用其 `message`，其他类型回退为通用原因。
   - 有具体原因时显示“判分失败：<原因>。本次不计错，可重试”。
   - 无具体原因时保留现有通用提示。
   - 服务异常仍恢复为可输入状态，且不增加 `mistakes`。
5. 复用现有 `serviceError` 与 `.answer-error` UI，不新增组件、状态或样式。

### 不修改的文件

- `src-tauri/src/agent.rs`：现有后端错误均为固定中文原因或 HTTP 状态码，不包含 API Key；请求参数和判分标准保持不变。
- `src-tauri/src/lib.rs`、课程解析、地图、进度和样式文件：与本次问题无关，保持不变。

## Assumptions & Decisions

- 浏览器版本仍可用于界面预览，但对话语义判分只能在 Word Adventure 桌面应用中运行。
- 不向浏览器添加直接请求 DashScope 的回退，避免把 API Key 暴露到前端。
- 不将服务异常计为答错，也不把模型返回 `correct: false` 当作服务异常。
- 若桌面应用仍失败，以页面新显示的具体原因作为下一步修复依据，而不是猜测根因。

## Verification

1. 运行 `pnpm build`，确认 TypeScript 与 Vite 构建通过。
2. 浏览器预览中提交非空对话答案：应显示“请使用 Word Adventure 桌面应用”，不出现长时间“判分中”，不增加答错次数。
3. 使用 `pnpm tauri dev` 启动桌面应用，提交 `yes, I can` 等恰当答案：正常时应由 Agent 判分并进入答对流程。
4. 若桌面应用仍失败：页面应显示 Rust 返回的实际原因，例如未配置环境变量、网络失败、DashScope HTTP 状态或无效响应；仍不计错且可重试。
5. 模型明确返回 `correct: false` 时仍按原逻辑记一次答错，确认两种失败路径没有混淆。
