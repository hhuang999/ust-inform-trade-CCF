# 校园枢纽 UniSwap · HKUST(GZ)

> 面向港科大(广州)校园社区的二手交易 / 服务 / 需求撮合市场。一个 App,三条产品线,一套信任闭环。

🌐 **在线体验(直接点击访问)👉 <https://ust.hhuang999.top>**

[![Deploy](https://img.shields.io/badge/Deploy-Vercel-000?logo=vercel)](https://ust.hhuang999.top)
[![Next.js](https://img.shields.io/badge/Next.js-16-000?logo=next.js)](https://nextjs.org)
[![License](https://img.shields.io/badge/License-MIT-blue)](#-license)

<p align="center">
  <img src="ust-qrcode.png" alt="扫码访问校园枢纽 UniSwap" width="200" />
  <br />
  <sub>📱 手机扫码 · 直达 <a href="https://ust.hhuang999.top">ust.hhuang999.top</a></sub>
</p>

---

## 目录

- [✨ 功能特性](#-功能特性)
- [👤 用户使用指南](#-用户使用指南)
- [🛠 技术栈](#-技术栈)
- [🚀 快速部署(一键 Vercel)](#-快速部署一键-vercel)
- [💻 本地开发](#-本地开发)
- [🏗 项目结构](#-项目结构)
- [📦 配置项(环境变量)](#-配置项环境变量)
- [🌿 分支说明(main / boxset)](#-分支说明main--boxset)
- [📄 License](#-license)

---

## ✨ 功能特性

围绕校园场景的三条产品线,加上完整的信任与运营闭环:

**三条产品线**

- **🛒 物品(items)**:多图发布、列表搜索/排序/筛选/分页、详情页、卖家选定买家、买卖双方确认完成、订单中心、软删除/重新上架。
- **🧰 服务(services)**:按时长档位发布、撮合、预约、状态机流转(发布 → 预约 → 进行 → 完成)。
- **📌 需求(needs)**:发布需求、撤回、意向人评分、撮合。

**信任与运营闭环**

- 🪪 **实名学生证审核**:用户上传学生证,管理员后台审核(通过 / 驳回 + 站内通知)。
- ⭐ **信誉体系**:交易评价、信誉标签(列表卡片 + 意向人评分 / 点击时间)。
- 🚩 **举报与违规**:用户举报、管理员违规处理后台。
- 🔔 **通知中心**:带未读角标的消息中心。
- ⏰ **Cron 超时自动完成**:7 天未操作的订单自动收尾。
- 👤 **公开个人主页**:展示发布历史与信誉。

**工程与体验**

- 🎨 「纸感」视觉设计系统(Tailwind 4 + shadcn 风格组件)。
- 🌱 数据存于远端 Neon Postgres + Cloudflare R2,沙箱重建不丢数据。
- 🔁 Prisma 查询瞬时错误自动重试,消除冷启动首屏 500。
- 🧪 Vitest 单测覆盖核心逻辑。

---

## 👤 用户使用指南

> 直接打开 <https://ust.hhuang999.top> 即可使用,无需安装。以下为各角色操作指引。

### 注册与登录

1. 进入 [登录页](https://ust.hhuang999.top/login),点击注册。
2. 填写 **邮箱或手机号** + 密码完成注册。
3. 登录后可在「设置」页**上传学生证实名**(通过审核后才能发布 / 撮合)。

### 物品交易流程

1. **卖家**:进入「发布物品」,填写标题、价格、分类、成色、多张图片,提交上架。
2. **买家**:在「物品」列表搜索/筛选,进入详情页,联系卖家、加入收藏。
3. **卖家**:在「我发布的」里**选定买家**(chooseBuyer)。
4. **双方**:线下完成交易后,各自在订单中心**确认完成**。
5. **评价**:交易完成后互相评价,沉淀信誉。

### 服务流程

1. **服务方**:发布服务(选择时长档位、分类、形式)。
2. **需求方**:浏览服务、发起预约。
3. 状态流转至完成后,双方评价。

### 需求流程

1. **需求方**:发布需求(描述 + 期望时间 / 形式)。
2. **服务方**:表达意向、对需求方评分。
3. 撮合成功后进入对接。

### 管理员

- 由首位管理员(`ADMIN_EMAIL`)通过 seed 脚本创建。
- 在「管理后台」审核学生证、处理举报与违规。

---

## 🛠 技术栈

| 层 | 技术 |
|---|---|
| 框架 | **Next.js 16**(App Router)+ **React 19** + **TypeScript** |
| 数据库 | **Prisma 7** + **PostgreSQL**(生产 [Neon](https://neon.tech),`PrismaPg` 适配器) |
| 认证 | **Auth.js v5**(Credentials + JWT)+ **bcryptjs** |
| 对象存储 | **Cloudflare R2**(头像 / 学生证 / 物品图,浏览器预签名 PUT 直传) |
| 样式 | **Tailwind CSS 4** / shadcn 风格组件 + 纸感设计令牌 |
| 测试 | **Vitest** |
| 部署 | **Vercel**(Cron 见 `vercel.json`)/ 自托管 |

---

## 🚀 快速部署(一键 Vercel)

最简单的上线方式——把本仓库导入 Vercel:

1. Fork 本仓库到你的 GitHub。
2. 打开 [vercel.com/new](https://vercel.com/new),导入该仓库(Vercel 自动识别 Next.js)。
3. 在 **Environment Variables** 里填入[下方](#-配置项环境变量)的全部变量。
4. 点击 Deploy。构建会自动 `prisma generate`(见 `package.json` 的 `postinstall`)。
5. 部署完成后,绑定自定义域名即可访问。

> ⚠️ Vercel **Hobby(免费)档**的 Cron Jobs 每天最多触发一次,因此 `vercel.json` 里超时扫描已设为每日一次。如需更频繁,请升级 Pro。

---

## 💻 本地开发

```bash
# 1) 克隆
git clone https://github.com/hhuang999/ust-inform-trade-cff.git
cd ust-inform-trade-cff

# 2) 安装依赖(pnpm,会自动跑 prisma generate)
pnpm install

# 3) 配置环境变量
cp .env.example .env.local
#   编辑 .env.local,至少填 DATABASE_URL / AUTH_SECRET / R2_* / ADMIN_EMAIL

# 4) 数据库迁移 + 种子首位管理员
pnpm db:migrate          # 或对生产库用 prisma migrate deploy
pnpm seed:admin

# 5) 启动开发服务器
pnpm dev                 # http://localhost:3000
```

常用脚本:`pnpm build` · `pnpm start` · `pnpm typecheck` · `pnpm test` · `pnpm lint` · `pnpm db:studio`。

---

## 🏗 项目结构

```
src/
├── app/                     # Next.js App Router
│   ├── (app)/               # 业务页面:items / services / needs / me / admin ...
│   ├── (auth)/              # 登录 / 注册
│   ├── api/                 # 上传预签名 / 通知 / cron / 学生证读取
│   └── layout.tsx
├── components/              # UI 组件(shadcn 风格 + 业务组件)
├── lib/                     # db(prisma)/ auth / validation / reputation ...
├── auth.config.ts           # Auth.js 配置(trustHost、路由保护)
└── middleware.ts            # 鉴权 + 管理端守卫
prisma/
├── schema.prisma            # 数据模型(物品/服务/需求/撮合/预约/评价/举报/违规)
└── migrations/              # 迁移文件
vercel.json                  # Cron 配置
```

---

## 📦 配置项(环境变量)

复制 `.env.example` 为 `.env.local`,按需填写:

| 变量 | 说明 |
|---|---|
| `DATABASE_URL` | PostgreSQL 连接串(Neon 建议带 `&connect_timeout=30&pool_timeout=30`) |
| `AUTH_SECRET` | Auth.js JWT 签名密钥(`openssl rand -base64 32`) |
| `AUTH_TRUST_HOST` | 反向代理 / 自托管部署设 `true` |
| `R2_ACCOUNT_ID` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` | Cloudflare R2 凭证 |
| `R2_BUCKET_PUBLIC` / `R2_BUCKET_PRIVATE` | 公开桶(图片)/ 私有桶(学生证) |
| `NEXT_PUBLIC_R2_PUBLIC_BASE_URL` | 公开桶的访问域名 |
| `ADMIN_EMAIL` | 首位管理员邮箱(配合 `seed:admin`) |
| `CRON_SECRET` | 保护 `/api/cron/timeout` 的共享密钥 |
| `BASE_PATH` | 子路径部署前缀(仅 `boxset` 沙箱用,根路径部署留空) |

---

## 🌿 分支说明(main / boxset)

- **`main`**:公开部署分支(Vercel + GitHub Release),根路径部署。**本 README 即针对此分支。**
- **`boxset`**:校园 Coze 沙箱(`gpunion.hkust-gz.edu.cn/apps/<app>`)专用,在 `main` 基础上加了动态 `basePath` 适配、沙箱委托脚本与离线字体。两者功能与数据库完全同步。

---

## 📄 License

本项目以 **MIT** 协议开源(见根目录 [`LICENSE`](./LICENSE)),欢迎学习、二次开发与贡献。
