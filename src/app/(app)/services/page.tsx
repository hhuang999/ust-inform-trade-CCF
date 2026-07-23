import Link from "next/link";
import { Sparkles } from "lucide-react";

import { prisma } from "@/lib/db";
import { cn } from "@/lib/utils";
import { PageContainer } from "@/components/layout/page-container";
import { SectionHeading } from "@/components/site/section-heading";
import { ServiceCard } from "@/components/site/service-card";
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
import { SERVICE_CATEGORIES, SERVICE_FORMATS } from "@/lib/constants/service";
import { expandSearchTerms } from "@/lib/search";
import { aggregateRatings, ratingNumber } from "@/lib/reputation";
import { isAiSearchEnabled } from "@/lib/ai/config";
import { hybridSearchServices, type HybridServiceResult } from "@/lib/ai/hybrid-search";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 12;
const SORT_OPTIONS = [
  { value: "latest", label: "最新发布" },
] as const;
type SortValue = (typeof SORT_OPTIONS)[number]["value"];

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
  return qs ? `/services?${qs}` : "/services";
}

export default async function ServicesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const search = typeof sp.search === "string" ? sp.search.trim() : "";
  const category =
    typeof sp.category === "string" &&
    (SERVICE_CATEGORIES as readonly string[]).includes(sp.category)
      ? (sp.category as string)
      : undefined;
  const format =
    typeof sp.format === "string" &&
    (SERVICE_FORMATS as readonly string[]).includes(sp.format)
      ? (sp.format as string)
      : undefined;
  const sortRaw = typeof sp.sort === "string" ? sp.sort : "latest";
  const sort: SortValue =
    (SORT_OPTIONS.find((o) => o.value === sortRaw)?.value ?? "latest") as SortValue;
  let page = parsePage(sp.page);
  // 搜索词展开(同义词 + 分词):让 "ipad" 也能命中 "平板电脑" 等。
  const searchTerms = expandSearchTerms(search);

  // ── 查询条件:仅 ACTIVE 服务 ──
  const where = {
    status: "ACTIVE" as const,
    ...(category ? { categories: { has: category } } : {}),
    ...(format ? { formats: { has: format } } : {}),
    ...(searchTerms.length
      ? {
          OR: searchTerms.flatMap((t) => [
            { title: { contains: t, mode: "insensitive" as const } },
            { description: { contains: t, mode: "insensitive" as const } },
            { categories: { has: t } },
          ]),
        }
      : {}),
  };

  // 排序:最新发布(按 createdAt desc)。
  const orderBy = [{ createdAt: "desc" as const }];

  const smartActive = isAiSearchEnabled() && search !== "";
  let services: HybridServiceResult["items"] = [];
  let total = 0;
  let usedSmart = false;
  if (smartActive) {
    try {
      const r = await hybridSearchServices({
        status: ["ACTIVE"],
        category,
        search,
        page,
        pageSize: PAGE_SIZE,
      });
      services = r.items;
      total = r.total;
      page = r.page;
      usedSmart = true;
    } catch {
      usedSmart = false;
    }
  }
  if (!usedSmart) {
    [total, services] = await Promise.all([
      prisma.service.count({ where }),
      prisma.service.findMany({
        where,
        orderBy,
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
        include: {
          provider: { select: { nickname: true } },
        },
      }),
    ]);
  }

  const providerRatings = await aggregateRatings(
    services.map((s) => s.providerId),
    "BOOKING",
  );

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const currentCategory = category ?? "";

  // 保留除 page 外的筛选条件,用于分页链接。
  const baseParams = {
    search: search || undefined,
    category: category,
    format: format,
    sort: sort !== "latest" ? sort : undefined,
  };

  return (
    <PageContainer className="space-y-6">
      <SectionHeading
        title="服务广场"
        description="校内学长学姐的专业服务,放心预约"
        action={
          <Button asChild>
            <Link href="/services/new">发布服务</Link>
          </Button>
        }
      />

      {/* ── 广场切换(服务 ↔ 需求)── */}
      <div className="flex flex-wrap items-center gap-2">
        <Link href="/services">
          <Badge
            variant="default"
            className="cursor-pointer px-4 py-1.5 text-sm bg-primary text-primary-foreground"
          >
            服务广场
          </Badge>
        </Link>
        <Link href="/needs">
          <Badge
            variant="outline"
            className="cursor-pointer px-4 py-1.5 text-sm text-muted-foreground"
          >
            需求广场
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
        {SERVICE_CATEGORIES.map((c) => (
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

      {/* ── 搜索 + 形式 ── */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <form
          action="/services"
          method="get"
          className="flex w-full max-w-sm items-center gap-2"
        >
          <Input
            name="search"
            type="search"
            defaultValue={search}
            placeholder="搜索关键词或描述你想要的服务"
            className="flex-1"
          />
          {category ? (
            <input type="hidden" name="category" value={category} />
          ) : null}
          {format ? <input type="hidden" name="format" value={format} /> : null}
          {sort !== "latest" ? (
            <input type="hidden" name="sort" value={sort} />
          ) : null}
          <Button type="submit" variant="outline">
            搜索
          </Button>
        </form>

        <div className="flex items-center gap-2">
          <label htmlFor="format" className="text-sm text-muted-foreground">
            形式
          </label>
          {/* 用一组 GET Link 胶囊替代 select,保持无客户端 JS 的筛选体验。 */}
          <div className="flex items-center gap-1.5">
            <Link
              href={buildHref({ ...baseParams, format: undefined })}
              aria-label="全部形式"
            >
              <Badge
                variant={!format ? "default" : "outline"}
                className={cn(
                  "cursor-pointer px-2.5 py-1 text-xs",
                  !format && "bg-primary text-primary-foreground"
                )}
              >
                全部
              </Badge>
            </Link>
            {SERVICE_FORMATS.map((f) => (
              <Link key={f} href={buildHref({ ...baseParams, format: f })}>
                <Badge
                  variant={format === f ? "default" : "outline"}
                  className={cn(
                    "cursor-pointer px-2.5 py-1 text-xs",
                    format === f && "bg-primary text-primary-foreground"
                  )}
                >
                  {f}
                </Badge>
              </Link>
            ))}
          </div>

          <form action="/services" method="get" className="flex items-center gap-2">
            <label htmlFor="sort" className="text-sm text-muted-foreground">
              排序
            </label>
            <select
              id="sort"
              name="sort"
              defaultValue={sort}
              className={cn(
                "h-9 rounded-lg border border-input bg-card px-3 text-sm shadow-sm outline-none",
                "focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
              )}
            >
              {SORT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            {search ? (
              <input type="hidden" name="search" value={search} />
            ) : null}
            {category ? (
              <input type="hidden" name="category" value={category} />
            ) : null}
            {format ? <input type="hidden" name="format" value={format} /> : null}
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

      {/* ── 服务网格 ── */}
      {services.length === 0 ? (
        <Empty className="min-h-[320px] border bg-card/40">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Sparkles />
            </EmptyMedia>
            <EmptyTitle>
              {search || category || format ? "没有匹配的服务" : "暂无服务"}
            </EmptyTitle>
            <EmptyDescription>
              {search || category || format
                ? "换个筛选条件试试,或发布你的服务"
                : "还没有人发布服务,成为第一个服务提供者吧"}
            </EmptyDescription>
          </EmptyHeader>
          {search || category || format ? (
            <EmptyContent>
              <Button asChild variant="outline" size="sm">
                <Link href="/services">清除筛选</Link>
              </Button>
            </EmptyContent>
          ) : null}
        </Empty>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {services.map((s) => (
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
              rating={ratingNumber(providerRatings, s.providerId)}
              status={s.status}
              createdAt={s.createdAt}
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
