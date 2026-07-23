import Link from "next/link";
import {
  ArrowRight,
  Bike,
  BookOpen,
  GraduationCap,
  HandHeart,
  Laptop,
  Lightbulb,
  Music,
  Package,
  Search,
  ShieldCheck,
  Sparkles,
  Wrench,
} from "lucide-react";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { SiteHeader } from "@/components/layout/site-header";
import { PageContainer } from "@/components/layout/page-container";
import { SectionHeading } from "@/components/site/section-heading";
import { ItemCard } from "@/components/site/item-card";
import { AiMatchCard } from "@/components/ai/ai-match-card";
import { isAiRecommendationEnabled } from "@/lib/ai/config";
import { ServiceCard } from "@/components/site/service-card";
import { NeedCard } from "@/components/site/need-card";

export const dynamic = "force-dynamic";

/** 平台亮点:可信、可追踪、有温度。 */
const FEATURES = [
  {
    icon: ShieldCheck,
    title: "真实身份认证",
    body: "学籍核验 + 实名背书，让每一次交易都有据可依、安心可靠。",
  },
  {
    icon: Sparkles,
    title: "安全撮合",
    body: "物品、服务、需求分类聚合，消息留痕，撮合过程清晰可追踪。",
  },
  {
    icon: HandHeart,
    title: "校内互助",
    body: "连接同学，让闲置流转，让技能变现，共建温暖的校园社区。",
  },
] as const;

const ANIM = "animate-in fade-in slide-in-from-bottom-4 duration-500";

/** 使用场景:帮用户对号入座,每张链到对应产品线。 */
const SCENARIOS = [
  {
    icon: BookOpen,
    title: "课本教材",
    desc: "学长学姐的旧书、笔记与复习资料。",
    href: "/items",
  },
  {
    icon: Laptop,
    title: "数码外设",
    desc: "二手平板、配件、外设好物流转。",
    href: "/items",
  },
  {
    icon: GraduationCap,
    title: "学业辅导",
    desc: "课程答疑、论文润色、考试冲刺。",
    href: "/services",
  },
  {
    icon: Music,
    title: "技能教学",
    desc: "乐器、绘画、编程、摄影入门。",
    href: "/services",
  },
  {
    icon: Bike,
    title: "跑腿代取",
    desc: "代取、跑腿、拼车、代购互助。",
    href: "/needs",
  },
  {
    icon: Lightbulb,
    title: "发布需求",
    desc: "找不到？发个需求，等同学来找你。",
    href: "/needs",
  },
] as const;

export default async function Home() {
  const session = await auth();
  const headerUser = session?.user
    ? {
        id: session.user.id,
        name: session.user.name ?? null,
        email: session.user.email ?? null,
        role: session.user.role,
      }
    : null;

  // 个人化问候:JWT 不带 nickname,已登录时从 DB 取昵称。
  let nickname: string | null = null;
  if (session?.user?.id) {
    const me = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { nickname: true },
    });
    nickname = me?.nickname ?? null;
  }

  // 最新物品/服务/需求 + 各产品线发布数:廉价 count / limit 查询。
  // 用 allSettled 让每个查询独立结算 —— 远端 DB(Neon)冷启动/高延迟时单个查询
  // 可能超时,失败的那个降级为空,其余照常渲染,首页永不因 DB 抖动而 500。
  const discovery = await Promise.allSettled([
    prisma.item.count({ where: { deletedAt: null } }),
    prisma.service.count({ where: { deletedAt: null } }),
    prisma.need.count({ where: { deletedAt: null } }),
    prisma.item.findMany({
      where: { status: "AVAILABLE", deletedAt: null },
      orderBy: { createdAt: "desc" },
      take: 8,
      include: { seller: { select: { nickname: true } } },
    }),
    prisma.service.findMany({
      where: { status: "ACTIVE", deletedAt: null },
      orderBy: { createdAt: "desc" },
      take: 4,
      include: { provider: { select: { nickname: true } } },
    }),
    prisma.need.findMany({
      where: { status: "OPEN", deletedAt: null },
      orderBy: { createdAt: "desc" },
      take: 4,
      include: {
        requester: { select: { nickname: true } },
        matches: { where: { status: "APPLIED" }, select: { id: true } },
      },
    }),
  ]);
  const ok = <T,>(r: PromiseSettledResult<T>, fallback: T): T =>
    r.status === "fulfilled" ? r.value : fallback;
  const itemCount = ok(discovery[0], 0);
  const serviceCount = ok(discovery[1], 0);
  const needCount = ok(discovery[2], 0);
  const latestItems = ok(discovery[3], []);
  const latestServices = ok(discovery[4], []);
  const latestNeeds = ok(discovery[5], []);

  // 个性化推荐：登录用户最新一条 OPEN 需求 → 由 AiMatchCard 取其跨业务推荐。
  let myNeedId: string | null = null;
  if (session?.user?.id && isAiRecommendationEnabled()) {
    const myNeed = await prisma.need.findFirst({
      where: { requesterId: session.user.id, status: "OPEN", deletedAt: null },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
    myNeedId = myNeed?.id ?? null;
  }

  const productLines = [
    {
      icon: Package,
      title: "物品交易",
      desc: "教材、数码、生活好物——让闲置流转起来。",
      href: "/items",
      count: itemCount,
      unit: "件",
    },
    {
      icon: Wrench,
      title: "技能服务",
      desc: "学业辅导、技能教学、生活帮忙，按需预约。",
      href: "/services",
      count: serviceCount,
      unit: "项",
    },
    {
      icon: Search,
      title: "互助需求",
      desc: "发布你的需求，让有能力的同学主动找你。",
      href: "/needs",
      count: needCount,
      unit: "条",
    },
  ] as const;

  const fmt = (n: number) => n.toLocaleString("zh-CN");

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader user={headerUser} />
      <main className="flex-1">
        {/* ── Hero ── */}
        <section className="bg-gradient-to-b from-primary-container/50 via-primary-container/15 to-transparent">
          <PageContainer className="flex flex-col items-center gap-6 pt-20 pb-8 text-center md:pt-28 md:pb-12">
            <span className="inline-flex items-center gap-2 rounded-full border border-primary/25 bg-primary/5 px-5 py-2 text-sm font-medium text-foreground shadow-sm backdrop-blur">
              <span className="size-2 rounded-full bg-primary" />
              港科大（广州）· 校园互助市场
            </span>

            <h1 className="font-serif text-4xl font-bold tracking-tight sm:text-5xl md:text-6xl">
              {nickname ? `欢迎回来，${nickname}` : "校园枢纽 UniSwap"}
            </h1>

            <p className="max-w-xl text-base leading-7 text-muted-foreground md:text-lg">
              二手物品、生活服务、互助需求，一站撮合。
              <br className="hidden sm:block" />
              让闲置流转，让技能变现，让校园里的每一次连接都安心可靠。
            </p>

            <div className="mt-2 flex w-full flex-col items-center gap-3 sm:w-auto sm:flex-row sm:justify-center">
              <Button asChild size="lg" className={ANIM}>
                <Link href="/items">
                  浏览物品
                  <ArrowRight />
                </Link>
              </Button>
              {session?.user ? (
                <Button asChild size="lg" variant="outline" className={ANIM}>
                  <Link href={`/profile/${session.user.id}`}>我的主页</Link>
                </Button>
              ) : (
                <Button asChild size="lg" variant="outline" className={ANIM}>
                  <Link href="/register">注册并登录</Link>
                </Button>
              )}
            </div>

            {/* 信任关键词:补足 Hero 密度,亮出平台底气。 */}
            <div className="mt-3 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-xs text-muted-foreground/80">
              <span className="inline-flex items-center gap-1">
                <ShieldCheck className="size-3.5 text-primary/70" />
                学籍实名认证
              </span>
              <span className="text-outline-variant">·</span>
              <span>信誉评价体系</span>
              <span className="text-outline-variant">·</span>
              <span>站内消息留痕</span>
              <span className="text-outline-variant">·</span>
              <span>超时自动收尾</span>
            </div>
          </PageContainer>
        </section>

        {/* ── 三条产品线:平台特色的入口 ── */}
        <PageContainer className="space-y-5 py-10">
          <SectionHeading
            title="一站式校园市场"
            description="三种方式，连接同学与校园生活"
          />
          <div className="grid gap-4 sm:grid-cols-3">
            {productLines.map((p) => {
              const Icon = p.icon;
              return (
                <Link
                  key={p.title}
                  href={p.href}
                  className="group rounded-2xl border border-outline-variant/40 bg-card p-5 shadow-card transition-all duration-200 hover:-translate-y-1 hover:border-primary/40 hover:shadow-float"
                >
                  <div className="flex items-center justify-between">
                    <span className="flex size-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
                      <Icon className="size-6" />
                    </span>
                    <span className="rounded-full bg-surface-container px-2.5 py-1 text-xs font-medium tabular-nums text-on-surface-variant">
                      已发布 {fmt(p.count)} {p.unit}
                    </span>
                  </div>
                  <h3 className="mt-4 font-serif text-lg font-bold tracking-tight">
                    {p.title}
                  </h3>
                  <p className="mt-1.5 text-sm leading-6 text-muted-foreground">
                    {p.desc}
                  </p>
                  <span className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-primary">
                    去逛逛
                    <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
                  </span>
                </Link>
              );
            })}
          </div>
        </PageContainer>

        {/* ── 你可以在这里:使用场景卡 ── */}
        <PageContainer className="space-y-5 py-10">
          <SectionHeading
            title="你可以在这里"
            description="校园生活的每一种连接"
          />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {SCENARIOS.map((s) => {
              const Icon = s.icon;
              return (
                <Link
                  key={s.title}
                  href={s.href}
                  className="group flex items-start gap-3 rounded-xl border border-outline-variant/40 bg-card p-4 transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-card"
                >
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <Icon className="size-5" />
                  </span>
                  <div className="min-w-0">
                    <div className="font-medium tracking-tight">{s.title}</div>
                    <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
                      {s.desc}
                    </p>
                  </div>
                </Link>
              );
            })}
          </div>
        </PageContainer>

        {/* ── 最新物品 ── */}
        <PageContainer className="space-y-5 py-10">
          <SectionHeading
            title="最新物品"
            description="校园里刚刚上架的闲置好物"
            action={
              <Button asChild variant="outline" size="sm">
                <Link href="/items">
                  查看全部
                  <ArrowRight />
                </Link>
              </Button>
            }
          />

          {latestItems.length === 0 ? (
            <Empty className="min-h-[240px] border bg-card/40">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Package />
                </EmptyMedia>
                <EmptyTitle>暂无在售物品</EmptyTitle>
                <EmptyDescription>
                  校园里还没有物品上架。
                  <Link href="/items/new" className="ml-1">
                    成为第一个发布者
                  </Link>
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <div
              className={`grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4 ${ANIM}`}
            >
              {latestItems.map((item) => (
                <ItemCard
                  key={item.id}
                  id={item.id}
                  title={item.title}
                  priceMode={item.priceMode}
                  price={item.price}
                  firstImageKey={item.imageKeys[0] ?? null}
                  category={item.category}
                  condition={item.condition}
                  sellerNickname={item.seller.nickname}
                  sellerRating={undefined}
                  status={item.status}
                  createdAt={item.createdAt}
                />
              ))}
            </div>
          )}
        </PageContainer>

        {/* ── 热门服务 ── */}
        {latestServices.length > 0 ? (
          <PageContainer className="space-y-5 py-10">
            <SectionHeading
              title="热门服务"
              description="学长学姐的专业咨询与技能教学"
              action={
                <Button asChild variant="outline" size="sm">
                  <Link href="/services">
                    查看全部
                    <ArrowRight />
                  </Link>
                </Button>
              }
            />
            <div
              className={`grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 ${ANIM}`}
            >
              {latestServices.map((s) => (
                <ServiceCard
                  key={s.id}
                  id={s.id}
                  title={s.title}
                  providerNickname={s.provider.nickname}
                  categories={s.categories}
                  formats={s.formats}
                  price={s.price}
                  durationTier={s.durationTier}
                  proofFirstImageKey={s.proofImageKeys[0] ?? null}
                  status={s.status}
                  createdAt={s.createdAt}
                />
              ))}
            </div>
          </PageContainer>
        ) : null}

        {/* ── 最新需求 ── */}
        {latestNeeds.length > 0 ? (
          <PageContainer className="space-y-5 py-10">
            <SectionHeading
              title="最新需求"
              description="同学们正在寻找的帮助"
              action={
                <Button asChild variant="outline" size="sm">
                  <Link href="/needs">
                    查看全部
                    <ArrowRight />
                  </Link>
                </Button>
              }
            />
            <div
              className={`grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 ${ANIM}`}
            >
              {latestNeeds.map((n) => (
                <NeedCard
                  key={n.id}
                  id={n.id}
                  title={n.title}
                  category={n.category}
                  expectedTime={n.expectedTime}
                  formatPreference={n.formatPreference}
                  reward={n.reward}
                  requesterNickname={n.requester.nickname}
                  applicantCount={n.matches.length}
                  status={n.status}
                  createdAt={n.createdAt}
                />
              ))}
            </div>
          </PageContainer>
        ) : null}

        {/* ── 可能适合你的资源（AI 个性化推荐）── */}
        {myNeedId ? (
          <PageContainer className="space-y-5 py-10">
            <SectionHeading
              title="可能适合你的资源"
              description="根据你的需求，AI 找到的相关物品与服务"
            />
            <AiMatchCard sourceType="NEED" sourceId={myNeedId} />
          </PageContainer>
        ) : null}

        {/* ── 平台亮点 ── */}
        <section className="bg-surface-container-lowest/60">
          <PageContainer className="space-y-5 py-12">
            <SectionHeading
              title="为什么信任校园枢纽 UniSwap"
              description="一套围绕校园场景设计的信任与运营闭环"
            />
            <div className="grid gap-5 sm:grid-cols-3">
              {FEATURES.map((f, i) => {
                const Icon = f.icon;
                return (
                  <Card
                    key={f.title}
                    className={`items-start ${ANIM}`}
                    // 错峰入场
                    style={{ animationDelay: `${i * 75}ms` }}
                  >
                    <CardHeader>
                      <span className="flex size-11 items-center justify-center rounded-lg bg-primary/10 text-primary">
                        <Icon className="size-5" />
                      </span>
                      <CardTitle className="font-serif text-lg">
                        {f.title}
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <p className="text-sm leading-6 text-muted-foreground">
                        {f.body}
                      </p>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </PageContainer>
        </section>

        {/* ── 收尾 CTA ── */}
        <section className="bg-gradient-to-b from-transparent to-primary-container/40">
          <PageContainer className="flex flex-col items-center gap-4 py-14 text-center md:py-16">
            <h2 className="font-serif text-2xl font-bold tracking-tight md:text-3xl">
              {session?.user
                ? "把闲置变成机会"
                : "准备好加入校园枢纽 UniSwap了吗？"}
            </h2>
            <p className="max-w-md text-sm leading-6 text-muted-foreground">
              {session?.user
                ? "发布一件闲置、上架一项技能，或说出你的需求——让校园里的连接从这里开始。"
                : "注册账号、完成学籍认证，即可发布闲置、预约服务、发布需求。"}
            </p>
            <Button asChild size="lg" className="mt-1">
              <Link href={session?.user ? "/items/new" : "/register"}>
                {session?.user ? "立即发布" : "免费注册"}
                <ArrowRight />
              </Link>
            </Button>
          </PageContainer>
        </section>

        {/* Footer line */}
        <PageContainer className="py-10">
          <p className="text-center text-xs text-muted-foreground">
            © {new Date().getFullYear()} 校园枢纽 UniSwap · 港科大（广州）· 校内互助，让信息流转
          </p>
        </PageContainer>
      </main>
    </div>
  );
}
