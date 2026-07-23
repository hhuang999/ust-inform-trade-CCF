import Link from "next/link";
import { Megaphone } from "lucide-react";
import { Prisma, type ExpectedTime } from "@prisma/client";

import { prisma } from "@/lib/db";
import { cn } from "@/lib/utils";
import { aggregateRatings, ratingNumber } from "@/lib/reputation";
import { PageContainer } from "@/components/layout/page-container";
import { SectionHeading } from "@/components/site/section-heading";
import { NeedCard } from "@/components/site/need-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationPrevious,
  PaginationNext,
} from "@/components/ui/pagination";
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
  EmptyContent,
} from "@/components/ui/empty";
import {
  NEED_CATEGORIES,
  NEED_FORMAT_PREFERENCES,
  EXPECTED_TIMES,
} from "@/lib/constants/need";
import { expandSearchTerms } from "@/lib/search";
import { isAiSearchEnabled } from "@/lib/ai/config";
import { hybridSearchNeeds, type HybridNeedResult } from "@/lib/ai/hybrid-search";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 12;
const EXPECTED_TIME_VALUES = EXPECTED_TIMES.map((o) => o.value) as readonly string[];

function parsePage(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.floor(n);
}

/**
 * 把当前筛选参数序列化为查询串(用于分页/筛选链接)。
 */
function buildHref(overrides: Record<string, string | undefined>): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(overrides)) {
    if (v !== undefined && v !== "") params.set(k, v);
  }
  const qs = params.toString();
  return qs ? `/needs?${qs}` : "/needs";
}

export default async function NeedsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const search = typeof sp.search === "string" ? sp.search.trim() : "";
  const category =
    typeof sp.category === "string" &&
    (NEED_CATEGORIES as readonly string[]).includes(sp.category)
      ? (sp.category as string)
      : undefined;
  const expectedTime =
    typeof sp.expectedTime === "string" &&
    EXPECTED_TIME_VALUES.includes(sp.expectedTime)
      ? (sp.expectedTime as ExpectedTime)
      : undefined;
  const formatPref =
    typeof sp.formatPref === "string" &&
    (NEED_FORMAT_PREFERENCES as readonly string[]).includes(sp.formatPref)
      ? (sp.formatPref as string)
      : undefined;
  let page = parsePage(sp.page);
  // 搜索词展开(同义词 + 分词):让 "ipad" 也能命中 "平板电脑" 等。
  const searchTerms = expandSearchTerms(search);

  // ── 查询条件:仅 OPEN 需求 ──
  const where = {
    status: "OPEN" as const,
    ...(category ? { category } : {}),
    ...(expectedTime ? { expectedTime } : {}),
    ...(formatPref ? { formatPreference: formatPref } : {}),
    ...(searchTerms.length
      ? {
          OR: searchTerms.flatMap((t) => [
            { title: { contains: t, mode: "insensitive" as const } },
            { description: { contains: t, mode: "insensitive" as const } },
            { category: { contains: t, mode: "insensitive" as const } },
          ]),
        }
      : {}),
  };

  const orderBy: Prisma.NeedOrderByWithRelationInput[] = [
    { createdAt: "desc" },
  ];

  const smartActive = isAiSearchEnabled() && search !== "";
  let needs: HybridNeedResult["items"] = [];
  let total = 0;
  let usedSmart = false;
  if (smartActive) {
    try {
      const r = await hybridSearchNeeds({
        status: ["OPEN"],
        category,
        expectedTime,
        formatPreference: formatPref,
        search,
        page,
        pageSize: PAGE_SIZE,
      });
      needs = r.items;
      total = r.total;
      page = r.page;
      usedSmart = true;
    } catch {
      usedSmart = false;
    }
  }
  if (!usedSmart) {
    [total, needs] = await Promise.all([
      prisma.need.count({ where }),
      prisma.need.findMany({
        where,
        orderBy,
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
        include: {
          requester: { select: { nickname: true } },
          _count: {
            select: {
              matches: {
                where: { status: { in: ["APPLIED", "MATCHED"] } },
              },
            },
          },
        },
      }),
    ]);
  }

  const requesterRatings = await aggregateRatings(
    needs.map((n) => n.requesterId),
    "NEED_MATCH",
  );

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const currentCategory = category ?? "";
  const currentExpectedTime = expectedTime ?? "";
  const currentFormatPref = formatPref ?? "";

  // 保留除 page 外的筛选条件,用于分页链接。
  const baseParams = {
    search: search || undefined,
    category: category,
    expectedTime: expectedTime,
    formatPref: formatPref,
  };

  return (
    <PageContainer className="space-y-6">
      <SectionHeading
        title="需求广场"
        description="发布你的需求,匹配合适的提供者"
        action={
          <Button asChild>
            <Link href="/needs/new">发布需求</Link>
          </Button>
        }
      />

      {/* ── 广场切换(需求 ↔ 服务)── */}
      <div className="flex flex-wrap items-center gap-2">
        <Link href="/needs">
          <Badge
            variant="default"
            className="cursor-pointer px-4 py-1.5 text-sm bg-primary text-primary-foreground"
          >
            需求广场
          </Badge>
        </Link>
        <Link href="/services">
          <Badge
            variant="outline"
            className="cursor-pointer px-4 py-1.5 text-sm text-muted-foreground"
          >
            服务广场
          </Badge>
        </Link>
      </div>

      {/* ── 分类筛选(胶囊按钮)── */}
      <div className="flex flex-wrap items-center gap-2">
        <Link href={buildHref({ ...baseParams, category: undefined })}>
          <Badge
            variant={currentCategory === "" ? "default" : "outline"}
            className={cn(
              "cursor-pointer px-3 py-1 text-sm",
              currentCategory === "" && "bg-primary text-primary-foreground"
            )}
          >
            全部
          </Badge>
        </Link>
        {NEED_CATEGORIES.map((c) => (
          <Link key={c} href={buildHref({ ...baseParams, category: c })}>
            <Badge
              variant={currentCategory === c ? "default" : "outline"}
              className={cn(
                "cursor-pointer px-3 py-1 text-sm",
                currentCategory === c && "bg-primary text-primary-foreground"
              )}
            >
              {c}
            </Badge>
          </Link>
        ))}
      </div>

      {/* ── 搜索 + 期望时间 / 形式偏好 ── */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <form action="/needs" method="get" className="flex w-full max-w-sm items-center gap-2">
          <Input
            name="search"
            type="search"
            defaultValue={search}
            placeholder="搜索关键词或描述你的需求"
            className="flex-1"
          />
          {category ? <input type="hidden" name="category" value={category} /> : null}
          {expectedTime ? (
            <input type="hidden" name="expectedTime" value={expectedTime} />
          ) : null}
          {formatPref ? (
            <input type="hidden" name="formatPref" value={formatPref} />
          ) : null}
          <Button type="submit" variant="outline">
            搜索
          </Button>
        </form>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2">
            <label htmlFor="expectedTime" className="text-sm text-muted-foreground">
              期望时间
            </label>
            <select
              id="expectedTime"
              name="expectedTime"
              defaultValue={expectedTime ?? ""}
              form="needs-filter-form"
              className={cn(
                "h-9 rounded-lg border border-input bg-card px-3 text-sm shadow-sm outline-none",
                "focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
              )}
            >
              <option value="">全部</option>
              {EXPECTED_TIMES.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-2">
            <label htmlFor="formatPref" className="text-sm text-muted-foreground">
              形式
            </label>
            <select
              id="formatPref"
              name="formatPref"
              defaultValue={formatPref ?? ""}
              form="needs-filter-form"
              className={cn(
                "h-9 rounded-lg border border-input bg-card px-3 text-sm shadow-sm outline-none",
                "focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
              )}
            >
              <option value="">全部</option>
              {NEED_FORMAT_PREFERENCES.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </div>

          {/* 隐式筛选表单:两个 select 挂在此表单上,任意 select 变更时提交。
              注:原生 select 无 onchange,实际提交由下方按钮触发;此处通过隐藏表单
              复用 GET 提交语义,避免客户端 JS。 */}
          <form id="needs-filter-form" action="/needs" method="get" className="contents">
            {search ? <input type="hidden" name="search" value={search} /> : null}
            {category ? <input type="hidden" name="category" value={category} /> : null}
            <Button type="submit" variant="outline" size="sm">
              应用
            </Button>
          </form>
        </div>
      </div>

      {usedSmart ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Badge variant="secondary">智能搜索</Badge>
          <span>按语义相关度排序（融合关键词 / 新鲜度 / 信誉）</span>
        </div>
      ) : null}

      {/* ── 需求网格 ── */}
      {needs.length === 0 ? (
        <Empty className="min-h-[320px] border bg-card/40">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Megaphone />
            </EmptyMedia>
            <EmptyTitle>
              {search || category || expectedTime || formatPref
                ? "没有匹配的需求"
                : "暂无需求"}
            </EmptyTitle>
            <EmptyDescription>
              {search || category || expectedTime || formatPref
                ? "换个筛选条件试试,或发布你的需求"
                : "还没有人发布需求,成为第一个发布者吧"}
            </EmptyDescription>
          </EmptyHeader>
          {search || category || expectedTime || formatPref ? (
            <EmptyContent>
              <Button asChild variant="outline" size="sm">
                <Link href="/needs">清除筛选</Link>
              </Button>
            </EmptyContent>
          ) : null}
        </Empty>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {needs.map((n) => (
            <NeedCard
              key={n.id}
              id={n.id}
              title={n.title}
              category={n.category}
              expectedTime={n.expectedTime}
              formatPreference={n.formatPreference}
              reward={n.reward}
              requesterNickname={n.requester.nickname}
              requesterRating={ratingNumber(requesterRatings, n.requesterId)}
              applicantCount={n._count.matches}
              status={n.status}
              createdAt={n.createdAt}
            />
          ))}
        </div>
      )}

      {/* ── 分页 ── */}
      {totalPages > 1 ? (
        <Pagination className="mt-4">
          <PaginationContent>
            <PaginationItem>
              <PaginationPrevious
                href={buildHref({
                  ...baseParams,
                  page: page > 1 ? String(page - 1) : undefined,
                })}
                aria-disabled={page <= 1}
                className={page <= 1 ? "pointer-events-none opacity-50" : ""}
              />
            </PaginationItem>
            {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
              <PaginationItem key={p}>
                <PaginationLink
                  href={buildHref({
                    ...baseParams,
                    page: p > 1 ? String(p) : undefined,
                  })}
                  isActive={p === page}
                >
                  {p}
                </PaginationLink>
              </PaginationItem>
            ))}
            <PaginationItem>
              <PaginationNext
                href={buildHref({
                  ...baseParams,
                  page: page < totalPages ? String(page + 1) : undefined,
                })}
                aria-disabled={page >= totalPages}
                className={page >= totalPages ? "pointer-events-none opacity-50" : ""}
              />
            </PaginationItem>
          </PaginationContent>
        </Pagination>
      ) : null}
    </PageContainer>
  );
}
