# 设计文档 — AI 智能发布 Step 1：AI 辅助发布草稿

- **日期**：2026-07-23
- **分支**：`cff`（conda 环境 `vb`）
- **范围**：FEATURE_DEV_AI_MATCHING.md 的 **Step 1（AI 草稿生成）**，外加所有 5 个 Step 共用的 `src/lib/ai/` 基础设施
- **状态**：Draft — 等待用户评审（brainstorming 评审门）
- **上层规格**：`docs/FEATURE_DEV_AI_MATCHING.md` §1、§5、§10、§11、§14

> 本文档是 Step 1 的增量设计，并已与**当前源码逐行核对**（2026-07-23）。文档里凡是"现实与 FEATURE_DEV 假设不符"之处都显式标注。

---

## 1. 目标与非目标

### 目标（Step 1）
1. 物品 / 服务 / 需求 三类发布表单都能用一句自然语言（物品还可带图片）生成**表单草稿**，回填后用户照常走现有提交。
2. 新建统一的 AI Provider 抽象 + 配置 + 开关 + Zod 输出 schema，作为后续 Step 2–5（向量化 / 混合搜索 / 撮合 / Ray）的共用底座。
3. AI 不可用（无 key、模型报错、超时、输出非法）时，**原有人工发布功能完全不受影响**。
4. 不发送联系方式 / 学生证 / 真实姓名等敏感信息给模型。

### 非目标（显式排除，留待后续 Step）
- ❌ 不改数据库、不改 Prisma schema、不动 `AiJob/ResourceEmbedding/AiRecommendation`（那是 Step 2/4）。
- ❌ 不碰交易状态机、不改现有 Server Action 的写入逻辑（Step 1 只在**客户端表单**和**一个新的只读 API** 上工作）。
- ❌ 不做语义搜索 / 撮合 / Ray（Step 3/4/5）。
- ❌ AI 不自动提交、不自动选买家、不自动发布。

---

## 2. 关键现实核对（已验证，纠正 FEATURE_DEV 的几处假设）

| FEATURE_DEV 假设 | 现实（已核对源码） | 对设计的影响 |
|---|---|---|
| category/condition/tradeMethod 等是英文枚举码 | **多数是中文字符串**：`自提/送货/邮寄`、`全新/几乎全新/…`、`数码电子/…`、`线上/线下`、`30分钟/…`。仅 `priceMode`(SPECIFIC/FREE/NEGOTIABLE)、`expectedTime`(ASAP/…)、`contactVisibility`(VERIFIED_ONLY/ALL) 是英文 | AI prompt 与输出 schema **必须直接复用** `src/lib/constants/{item,service,need}.ts` 常量，绝不硬编码 |
| Service.price 是数字 | **`Service.price` 是自由字符串**（如 `"50元/小时"`，`z.string().min(1).max(100)`）；`Item.price` 才是 `Int?` | 每类一套输出 schema，物品价格=整数、服务价格=字符串 |
| 读取物品图需要"短期签名 URL" | 物品图在**公开桶**，`${NEXT_PUBLIC_R2_PUBLIC_BASE_URL}/${key}` 直接可读；**无需新增 presigned GET** | 服务端 fetch 公开 URL → base64 内联给模型即可 |
| 物品表单有可复用图片上传组件 | 没有共享组件，上传逻辑在 item-form / service-form 各自内联；AI **不接管图片上传**，只用已上传的 `imageKeys` | AI 面板只读 `imageKeys` 传给后端，不复制上传逻辑 |
| 三表单结构一致，可统一填表 | Item/Service 解构了 `setValue/getValues`；**Need 表单没有**（need-form.tsx:138-150） | 给 Need 的 `useForm` 解构补 `setValue/getValues`（一处小改），三表单即可用同一 `onApply` |

### 两个必须满足的 superRefine 耦合（itemCreateSchema，item.ts:97-106）
- `priceMode === "SPECIFIC"` ⇔ `price` 必须是非负整数；非 SPECIFIC ⇔ `price` 必须为空。
- `tradeMethods` 含 `"自提"` ⇔ `pickupLocation` 非空。

→ **AI 输出必须经 `itemCreateSchema.safeParse` 二次校验**，并由 `draft.ts` 做强制矫正（见 §5.3），否则表单 resolver 会静默拒绝（参考历史 bug：item-edit "保存没反应"）。

---

## 3. 锁定的决策（含理由）

> 用户暂离，按推荐的保守默认推进；均可在你评审时调整。

1. **Provider：SiliconFlow 真机（已实测），保留离线桩作降级/测试路径。** 已验证 `Qwen/Qwen3-VL-30B-A3B-Instruct` 同时支持 `response_format:json_object` 与视觉（读图准确）。有 `AI_API_KEY` 走真机；无 key 走确定性离线桩（供单测与降级）。满足 FEATURE_DEV §5.4「AI 不可用时人工发布正常」。**真实 key 仅放 `.env.local`（已被 gitignore），绝不入库或写进 `.env.example`。**
2. **图片：模型支持视觉时用图，否则退化纯文本。** 物品草稿把前 1–3 张已上传图（公开 URL → 服务端 base64 内联）连同文字发给视觉模型；模型无视觉能力 / 暂无图 / 桩模式 → 纯文本草稿。服务/需求不涉及图片。
3. **范围：只做 Step 1 + 共用底座**，跑通 `typecheck/lint/test/build` 后停下评审，再进 Step 2。
4. **校验真相源 = 各表单 create schema**：AI 输出先经 `schemas.ts` 的输出 schema（字段子集）粗校，再在 `draft.ts` 里合并默认值后交 `itemCreateSchema/serviceCreateSchema/needCreateSchema.safeParse` 终检，失败字段丢弃并记入 `warnings`。
5. **Need 表单补 `setValue/getValues`**（need-form.tsx:138-150 解构内加两项；`useForm` 默认就返回它们，零行为变化），让三表单共用一个 `onApply(partial)`。
6. **Feature flag + 配置**：新增 `AI_DRAFT_ENABLED`（及为后续 Step 预留 `AI_SEARCH_ENABLED/AI_RECOMMENDATION_ENABLED`）开关；沿用仓库现有 `process.env` 风格（与 `db.ts`/`r2.ts` 一致），**不引入** `@t3-oss/env` 之类新依赖，只加一个小的 `src/lib/ai/config.ts`。新增 `AI_*` 变量写进 `.env.example`。
7. **"AI 建议"标记 UX（待你拍板的子决策）**：见 §7，默认采用"面板内汇总已填字段 + 清除按钮"的轻量方案，逐字段内联标签作为可选打磨。

---

## 4. 架构与模块布局

```
src/lib/ai/                       # 共用底座（Step 2-5 复用）
  config.ts                       # 读 AI_* env + 开关；缺配置 → disabled（fail-soft）
  provider.ts                     # OpenAI 兼容 chat 客户端 + 离线桩；generateJson(messages, {images?})
  prompts.ts                      # buildDraftMessages(type, text, images, enums) 注入精确枚举+隐私+JSON-only
  schemas.ts                      # ITEM/SERVICE/NEED 输出 Zod schema（表单字段子集，排除敏感/图片字段）
  draft.ts                        # 编排：type+text+imageKeys → provider → schema 校验 → 矫正 → {draft,warnings,model}
  draft.test.ts                   # 纯函数测试（矫正/降级/隐私/schema）
  normalize-enums.test.ts         # 枚举注入不漂移（可选，并入 draft.test.ts）
src/app/api/ai/draft/route.ts     # POST，session 守卫，开关检查，调 draft.ts
src/components/ai/
  ai-draft-panel.tsx              # 客户端：一句话输入 + "AI 帮我填写" + loading/error/汇总
  ai-draft-panel.test.ts          # （若做组件测试需先放宽 vitest include 到 *.test.tsx；默认不做组件测试）
```

**改动现有文件（最小化）**：
- `src/components/site/{item,service,need}-form.tsx`：① 在 `<form className="space-y-6">` 首子 Card 前插入 `<AiDraftPanel …/>`；② 各自实现 `onApply(partial)`（用 `setValue` 逐字段写入 + 记录 `aiFields` 用于标记）；③ need-form 解构补 `setValue,getValues`。
- `.env.example`：追加 `AI_*` 变量段（见 §8）。
- `src/lib/ai/draft.ts` 内复用 `@/lib/validation/{item,service,need}` 与 `@/lib/constants/{item,service,need}`，**不复制**枚举值。

边界纪律：`provider.ts` 只管"发消息拿 JSON"，不碰业务字段；`draft.ts` 只管"编排 + 校验 + 矫控"；`prompts.ts` 只管"构造消息"；`schemas.ts` 只管"输出形状"。任一模块可独立单测。

---

## 5. 组件设计

### 5.1 `config.ts`
```ts
export type AiDraftType = "ITEM" | "SERVICE" | "NEED";
export function isAiDraftEnabled(): boolean;        // AI_DRAFT_ENABLED === "true"
export function getChatConfig(): { baseUrl: string; apiKey: string; model: string } | null;
                                                     // 三者齐全才返回，否则 null（→ 桩模式）
export function hasVision(): boolean;                // AI_CHAT_VISION === "true"（默认 false）
```
缺任意 chat 配置 → `getChatConfig()` 返回 `null` → 走桩。所有读取集中在这一处，便于 Step 2 复用并加 embedding 配置。

### 5.2 `provider.ts`
```ts
export interface ChatImage { dataUrl: string }       // base64 data URL（data:image/jpeg;base64,...）
export interface GenerateJsonOptions { images?: ChatImage[]; maxTokens?: number }
export async function generateJson(
  systemPrompt: string,
  userText: string,
  opts: GenerateJsonOptions
): Promise<{ json: unknown; model: string }>;
```
- 真机：`POST ${baseUrl}/chat/completions`，`model`、`messages`（system + user[text + image_url parts]）、`response_format: { type: "json_object" }`（OpenAI 兼容）。解析 `choices[0].message.content` 为 JSON。
- 桩（无 key）：不联网，返回基于 `userText` 的规则化 JSON（标题取前 N 字、按关键词命中映射 `category`、`priceMode` 默认 `NEGOTIABLE`、`tradeMethods: ["自提"]` 等），`model: "stub"`。
- 失败：抛 `AiProviderError`，由 `draft.ts` 捕获 → 返回 `{ draft: null, warnings: […] }`，**绝不向上冒泡到发布流程**。

### 5.3 `draft.ts`（核心编排）
```ts
export interface DraftRequest { type: AiDraftType; text: string; imageKeys?: string[] }
export interface DraftResponse {
  draft: Record<string, unknown> | null;  // 该类型的字段子集（见 §5.4）；null 表示 AI 完全失败
  warnings: string[];                      // 被丢弃的非法字段、降级原因
  model: string;                           // "stub" 或真实模型名
}
export async function generateDraft(req: DraftRequest, opts?: { fetchImage?: (key: string) => Promise<ChatImage | null> }): Promise<DraftResponse>;
```
流程：
1. `getChatConfig()` → 决定真机/桩。
2. 物品 + 有图 + `hasVision()` → 经 `fetchImage`（默认实现：拼公开 URL → `fetch` → base64）取前 3 张；失败/无视觉 → 仅文本。
3. `buildDraftMessages()` 注入该类型**精确合法枚举值**（从 constants 读）+ 字段规则 + 「只输出 JSON、不得包含联系方式/姓名」。
4. `generateJson()` → **逐字段 `pickValid`**：每个字段独立用 `DRAFT_FIELD_SCHEMAS[type]` 校验，合法则留、非法则弃并记 warning；接受任意字段子集（模型可省略字段）。
5. **矫正**（仅 ITEM，使子集自洽）：`priceMode==="SPECIFIC"` 但缺 `price` → 改 `NEGOTIABLE`；`priceMode!=="SPECIFIC"` 却带 `price` → 删 `price/originalPrice`；`tradeMethods` 含"自提"但缺 `pickupLocation` → 填占位「（请补充自提地点）」并记 warning；含 `pickupLocation` 但不含"自提" → 删 `pickupLocation`。
6. 返回合法子集作为 `draft`（**不再**跑完整 `createSchema` 终检——草稿是部分字段，完整性校验在用户提交时由表单 resolver 负责）。
7. 返回 `DraftResponse`。

`fetchImage` 可注入 → 测试时传桩，不联网、不依赖 R2。

### 5.4 `schemas.ts`（输出 schema = 表单字段子集，排除敏感/图片）
- **ITEM**：`title, description, category, condition, priceMode, price?, originalPrice?, tags?, tradeMethods, pickupLocation?`（**不含** `imageKeys/contactInfo/contactVisibility` —— 图片由用户上传，联系方式/可见性是隐私）。
- **SERVICE**：`title, description, qualification, categories, formats, durationTier?, price`（price 是 string；**不含** `proofImageKeys/contactInfo/contactVisibility`）。
- **NEED**：`title, description, expectedProfile?, reward, expectedTime, formatPreference, category`（**不含** `contactInfo/contactVisibility`）。

枚举字段直接 `z.enum(ITEM_CATEGORIES)` 等，复用 constants → 与表单永远一致。

### 5.5 `prompts.ts`
`buildDraftMessages(type, text, images, enums)` 返回 `{ system, user }`：
- system：角色 + 「只返回 JSON，键如下…」+ 该类型合法枚举的**中文值清单**（动态从 constants 拼接，不硬编码）+ 价格规则（物品 SPECIFIC 才填整数；服务价格是带单位的字符串）+ 隐私红线（禁止编造联系方式/姓名/学号）+ 「不确定的字段宁可省略」。
- user：`text` + （视觉时）image parts。

### 5.6 `route.ts`（`POST /api/ai/draft`）
- `const session = await auth(); if (!session?.user?.id) return NextResponse.json({error:"unauthorized"},{status:401})`（照搬 upload-url 范式）。
- `if (!isAiDraftEnabled()) return NextResponse.json({ enabled:false },{status:503})`（前端据此隐藏入口）。
- 解析 `{ type, text, imageKeys? }`（zod 入参校验：type 枚举、text 非空 ≤500、imageKeys ≤3 且 key 以 `public/items/` 开头——防止越权读别的对象）。
- `await generateDraft(…)`（内部捕获所有 provider 错误，绝不抛出）→ `NextResponse.json({ draft, warnings, model })`，始终 200（即便 `draft:null`，前端据此降级提示手填）。
- 仅三类非 200：未登录 401、未启用 503、入参非法 400。

### 5.7 `ai-draft-panel.tsx`（客户端）
- props：`{ type: AiDraftType; imageKeys?: string[]; onApply: (partial: Record<string, unknown>, filledFields: string[]) => void; }`。
- UI：`<Textarea>`（一句话描述）+ 「AI 帮我填写」按钮（loading 态用 `<Skeleton>`/spinner）+ 结果区（成功：列出已填字段 chip + "应用"/"重新生成"；失败/未启用：友好提示，引导手填）。
- 调 `fetch("/api/ai/draft",{method:POST,body:JSON})`，调 `onApply(draft, filledFields)`。
- **不自动提交**；与现有 localStorage 草稿共存（AI 填写后表单 `isDirty` 变 true，草稿自动保存会把 AI 内容一起存——符合预期）。

### 5.8 三表单接入（每处 ~10 行）
- item-form.tsx：`<form …>`(518) 首子前插 `<AiDraftPanel type="ITEM" imageKeys={watchedImageKeys} onApply={onApply} />`；`watchedImageKeys = watch("imageKeys")`。
- service-form.tsx：同上(464)，`type="SERVICE"`，不带图。
- need-form.tsx：同上(260)，`type="NEED"`，不带图；解构补 `setValue,getValues`。
- 各表单 `onApply`：`Object.entries(partial).forEach(([k,v]) => setValue(k, v))` + `setAiFields(new Set(filledFields))`。

---

## 6. 数据流

```
用户在发布页输入一句话(+物品已传图)
 └─ AiDraftPanel → POST /api/ai/draft {type,text,imageKeys}
     └─ route: auth 校验 + 开关 + 入参 zod 校验
         └─ draft.generateDraft:
             ├─ config.getChatConfig() → 真机 or 桩
             ├─ (物品+视觉) fetchImage(publicUrl) → base64
             ├─ prompts.buildDraftMessages(注入精确枚举)
             ├─ provider.generateJson() → JSON
             ├─ schemas[type].safeParse (粗校)
             ├─ 矫正 superRefine (物品)
             └─ createSchema[type].safeParse (终检) → 合法子集
     └─ { draft, warnings, model }
 └─ AiDraftPanel.onApply(draft) → setValue 逐字段 → 表单显示"AI 建议"标记
 └─ 用户检视/修改 → 现有提交按钮 → 现有 Server Action（不变）
```

---

## 7. "AI 建议"标记 UX（待确认子决策）

FEATURE_DEV §5.1.6 要求"AI 填写的字段显示'AI 建议'标记"。两种实现：

- **A（默认推荐，轻量）**：面板应用后，在面板内用 chip 汇总"AI 已填入：标题、分类、成色、价格、交易方式"，并提供"清除 AI 填写"（把 `aiFields` 内字段恢复为应用前快照）。不触碰每个字段的 Label。改动最小、可逆。
- **B（逐字段内联标签，spec 字面满足）**：新增 `<AiSuggestionBadge/>`，在三表单每个被填字段的 `<Label>` 旁渲染。更贴文档，但需改 ~20 处 Label。

→ 默认按 A 实现；若你要 B，我在 Step 1 内一并做（额外 ~20 处小改，纯展示）。

---

## 8. 环境变量（追加到 `.env.example`）

```env
# AI（Step 1：草稿生成；OpenAI 兼容 —— 已实测 SiliconFlow + Qwen3-VL）
AI_DRAFT_ENABLED=true
AI_BASE_URL=https://api.siliconflow.cn/v1
AI_API_KEY=                  # 真实 key 仅放 .env.local（gitignored），此处留空
AI_CHAT_MODEL=Qwen/Qwen3-VL-30B-A3B-Instruct
AI_CHAT_VISION=true          # Qwen3-VL 支持视觉，物品草稿读图

# 预留给 Step 2-5（本 Step 不读取，仅占位以免遗忘）
AI_SEARCH_ENABLED=false
AI_RECOMMENDATION_ENABLED=false
AI_EMBEDDING_BASE_URL=
AI_EMBEDDING_API_KEY=
AI_EMBEDDING_MODEL=
AI_EMBEDDING_DIM=1024
AI_WORKER_SECRET=
```
未配置 chat 三件套 → 桩模式；`AI_DRAFT_ENABLED=false` → 入口隐藏。`.gitignore` 已忽略所有真实 env（`.env*` 除 `.env.example`），无需改。

---

## 9. 错误处理与降级矩阵

| 场景 | 行为 |
|---|---|
| 未登录 | route 401（与 upload-url 一致） |
| `AI_DRAFT_ENABLED≠true` | route 503 `{enabled:false}`；前端隐藏面板/仅提示 |
| 无 chat key | 桩模式，正常返回草稿（`model:"stub"`） |
| 模型超时/5xx/网络错 | provider 抛错 → `draft:null` + warnings；前端提示"AI 暂不可用，请手填"，**发布不受影响** |
| 模型返回非 JSON / 缺字段 | 粗校 safeParse 失败字段丢弃 → 部分草稿 + warnings |
| 违反 superRefine（如 FREE 却带 price） | draft.ts 矫正 → 合法草稿 |
| 终检仍不通过的字段 | 逐字段剔除 + warning |
| 入参 imageKeys 非 `public/items/` 前缀 | route 直接 400（防越权读对象） |

任何路径都不会让用户的发布流程失败或卡死。

---

## 10. 测试计划（Vitest，纯函数 `.test.ts`）

vitest 当前只收 `src/**/*.test.ts`（不收 `.tsx`/`.spec`），且无 DB mock —— Step 1 测试**全部做成不联网、不碰 DB 的纯函数 `.test.ts`**，与现有 `state-machine.test.ts` 风格一致：

- `src/lib/ai/draft.test.ts`：
  - ITEM：`priceMode=FREE` 带 price → 矫正后无 price；`tradeMethods=[自提]` 缺 pickupLocation → 填占位+warning；`tradeMethods=[邮寄]` 带 pickupLocation → 删除。
  - ITEM：终检后非法字段（category 不在枚举）被剔除并 warning。
  - SERVICE：price 为字符串、durationTier 可缺省。
  - NEED：expectedTime 非法值被剔除。
  - 桩模式：无 key 时 `generateDraft` 返回合法草稿、`model:"stub"`。
  - 降级：provider 抛错 → `draft:null` + 非空 warnings，不抛出。
  - 隐私：输出 schema 不含 contactInfo/contactVisibility；prompt 文本不含联系方式字样。
- 注入 `fetchImage` 桩，避免联网/依赖 R2。
- `schemas.ts` 复用 constants → 加一条"枚举与 constants 一致"的断言防漂移。

`pnpm test` 直接跑（`vitest run`）。组件交互（AiDraftPanel）默认不写自动化测试；若需要，先在 `vitest.config.ts` 的 `include` 追加 `src/**/*.test.tsx` 并装 jsdom（本 Step 不做）。

---

## 11. 验收标准（对应 FEATURE_DEV §5.4）

- [ ] 三类发布表单都能从自然语言生成草稿并回填。
- [ ] 物品支持"图片 + 一句话"（视觉可用时）；无视觉/无图时退化纯文本。
- [ ] 生成结果可任意修改，**不自动提交**。
- [ ] 无效枚举、超长文本、非法价格不会进入表单（schema + 矫正 + 终检三道关）。
- [ ] AI 不可用时原有人工发布完全正常（开关/桩/降级）。
- [ ] 不向模型发送联系方式/姓名/学号。

---

## 12. 完成定义（Definition of Done）

- 新增/改动文件如 §4。
- `pnpm typecheck` `pnpm lint` `pnpm test` `pnpm build` 全绿。
- 至少手测一次（桩模式）三类表单的生成→回填→修改→提交。
- 输出：修改文件清单、（无）数据库变化、测试结果、下一步（Step 2）。

---

## 13. 待用户确认

1. 三个保守默认（Provider 桩先真后 / 图片视觉+退化 / 范围 Step 1+底座）是否认可？
2. "AI 建议"标记走 A（面板汇总）还是 B（逐字段内联）？默认 A。
3. 你是否现在就有 `AI_BASE_URL/AI_API_KEY/AI_CHAT_MODEL`？若有并希望直接接真机，贴给我即按"真机优先"实现并实测。
