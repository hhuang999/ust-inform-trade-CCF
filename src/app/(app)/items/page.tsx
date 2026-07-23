import Link from "next/link";
import { Prisma, PriceMode, type ItemStatus } from "@prisma/client";

import { prisma } from "@/lib/db";
import { cn } from "@/lib/utils";
import { PageContainer } from "@/components/layout/page-container";
import { SectionHeading } from "@/components/site/section-heading";
import { ItemCard } from "@/components/site/item-card";
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
import { ITEM_CATEGORIES } from "@/lib/constants/item";
import { expandSearchTerms } from "@/lib/search";
import { aggregateRatings, ratingNumber } from "@/lib/reputation";
import { isAiSearchEnabled } from "@/lib/ai/config";
import { hybridSearchItems } from "@/lib/ai/hybrid-search";
import { PackageOpen } from "lucide-react";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 12;
const SORT_OPTIONS = [
  { value: "latest", label: "最新发布" },
  { value: "oldest", label: "最早发布" },
  { value: "price_asc", label: "价格从低到高" },
  { value: "price_desc", label: "价格从高到低" },
] as const;
type SortValue = (typeof SORT_OPTIONS)[number]["value"];

function parsePage(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.floor(n);
}

/** 解析价格筛选值(非负整数);非法返回 undefined。 */
function parsePrice(v: unknown): number | undefined {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return undefined;
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
  return qs ? `/items?${qs}` : "/items";
}

export default async function ItemsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const search = typeof sp.search === "string" ? sp.search.trim() : "";
  const category =
    typeof sp.category === "string" && ITEM_CATEGORIES.includes(sp.category as never)
      ? (sp.category as string)
      : undefined;
  const sortRaw = typeof sp.sort === "string" ? sp.sort : "latest";
  const sort: SortValue = (SORT_OPTIONS.find((o) => o.value === sortRaw)?.value ??
    "latest") as SortValue;
  const includePending = sp.includePending === "true";
  let minPrice = parsePrice(sp.minPrice);
  let maxPrice = parsePrice(sp.maxPrice);
  // 价格填反时宽松交换,避免 min>max 直接得到空结果且无提示。
  if (minPrice != null && maxPrice != null && minPrice > maxPrice) {
    [minPrice, maxPrice] = [maxPrice, minPrice];
  }
  let page = parsePage(sp.page);
  // 搜索词展开(同义词 + 分词):让 "ipad" 也能命中 "平板电脑" 等。
  const searchTerms = expandSearchTerms(search);

  // ── 查询条件 ──
  const status: ItemStatus[] = includePending
    ? ["AVAILABLE", "PENDING"]
    : ["AVAILABLE"];
  const where: Prisma.ItemWhereInput = {
    status: { in: status },
    deletedAt: null,
    ...(category ? { category } : {}),
  };
  const andClauses: Prisma.ItemWhereInput[] = [];
  // 价格筛选:定价物品落在区间;免费/面议物品(price=null)在下限≤0 时保留
  // (否则 gte/lte 会把 NULL 行排除,导致一设价格就过滤光所有免费/面议品)。
  if (minPrice != null || maxPrice != null) {
    andClauses.push({
      OR: [
        {
          priceMode: "SPECIFIC",
          price: {
            ...(minPrice != null ? { gte: minPrice } : {}),
            ...(maxPrice != null ? { lte: maxPrice } : {}),
          },
        },
        ...((minPrice == null || minPrice <= 0)
          ? [{ priceMode: { in: ["FREE", "NEGOTIABLE"] as PriceMode[] } }]
          : []),
      ],
    });
  }
  // 关键词:标题/描述/分类 contains(同义词展开)。
  if (searchTerms.length) {
    andClauses.push({
      OR: searchTerms.flatMap((t) => [
        { title: { contains: t, mode: "insensitive" as const } },
        { description: { contains: t, mode: "insensitive" as const } },
        { category: { contains: t, mode: "insensitive" as const } },
      ]),
    });
  }
  if (andClauses.length) where.AND = andClauses;

  // 价格排序时,null 价格(免费/面议)统一排到末尾,避免错位出现在"最贵"。
  const orderBy: Prisma.ItemOrderByWithRelationInput[] =
    sort === "price_asc"
      ? [{ price: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }]
      : sort === "price_desc"
        ? [{ price: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }]
        : sort === "oldest"
          ? [{ createdAt: "asc" }]
          : [{ createdAt: "desc" }];

  // 智能搜索（语义+关键词混合）：开关开且有搜索词时启用；失败自动回退关键词。
  const smartActive = isAiSearchEnabled() && search !== "";
  let items: Array<
    Prisma.ItemGetPayload<{ include: { seller: { select: { nickname: true } } } }>
  > = [];
  let total = 0;
  let usedSmart = false;
  if (smartActive) {
    try {
      const r = await hybridSearchItems({
        status,
        category,
        minPrice,
        maxPrice,
        search,
        page,
        pageSize: PAGE_SIZE,
      });
      items = r.items;
      total = r.total;
      page = r.page;
      usedSmart = true;
    } catch {
      usedSmart = false;
    }
  }
  if (!usedSmart) {
    total = await prisma.item.count({ where });
    // 分页越界保护:page 超过总页数时收敛到最后一页,避免空结果死胡同。
    const tp = Math.max(1, Math.ceil(total / PAGE_SIZE));
    page = Math.min(page, tp);
    items = await prisma.item.findMany({
      where,
      orderBy,
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: {
        seller: { select: { nickname: true } },
      },
    });
  }
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const sellerRatings = await aggregateRatings(
    items.map((i) => i.sellerId),
    "ITEM",
  );

  const currentCategory = category ?? "";

  // 保留除 page 外的筛选条件,用于分页链接。
  const baseParams = {
    search: search || undefined,
    category: category,
    sort: sort !== "latest" ? sort : undefined,
    includePending: includePending ? "true" : undefined,
    minPrice: minPrice != null ? String(minPrice) : undefined,
    maxPrice: maxPrice != null ? String(maxPrice) : undefined,
  };

  return (
    <PageContainer className="space-y-6">
      <SectionHeading
        title="二手物品"
        description="校内闲置好物,安心流转"
        action={
          <Button asChild>
            <Link href="/items/new">发布物品</Link>
          </Button>
        }
      />

      {/* ── 分类筛选(胶囊按钮,GET 表单) ── */}
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
        {ITEM_CATEGORIES.map((c) => (
          <Link
            key={c}
            href={buildHref({ ...baseParams, category: c })}
          >
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

      {/* ── 搜索 + 排序(GET 表单,无客户端 JS) ── */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <form action="/items" method="get" className="flex w-full max-w-xl flex-wrap items-center gap-2">
          <Input
            name="search"
            type="search"
            defaultValue={search}
            placeholder="搜索关键词或描述你想要的物品"
            className="min-w-[12rem] flex-1"
          />
          <Input
            name="minPrice"
            type="number"
            min={0}
            defaultValue={minPrice ?? ""}
            placeholder="最低价"
            className="w-24"
          />
          <span className="text-muted-foreground">—</span>
          <Input
            name="maxPrice"
            type="number"
            min={0}
            defaultValue={maxPrice ?? ""}
            placeholder="最高价"
            className="w-24"
          />
          {/* 保留当前筛选态 */}
          {category ? <input type="hidden" name="category" value={category} /> : null}
          {sort !== "latest" ? <input type="hidden" name="sort" value={sort} /> : null}
          {includePending ? (
            <input type="hidden" name="includePending" value="true" />
          ) : null}
          <Button type="submit" variant="outline">
            筛选
          </Button>
        </form>

        <form action="/items" method="get" className="flex items-center gap-2">
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
          {/* 保留当前筛选态 */}
          {minPrice != null ? <input type="hidden" name="minPrice" value={minPrice} /> : null}
          {maxPrice != null ? <input type="hidden" name="maxPrice" value={maxPrice} /> : null}
          {search ? <input type="hidden" name="search" value={search} /> : null}
          {category ? <input type="hidden" name="category" value={category} /> : null}
          {includePending ? (
            <input type="hidden" name="includePending" value="true" />
          ) : null}
          <Button type="submit" variant="outline" size="sm">
            应用
          </Button>
        </form>
      </div>

      {usedSmart ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Badge variant="secondary">智能搜索</Badge>
          <span>按语义相关度排序（融合关键词 / 新鲜度 / 信誉）</span>
        </div>
      ) : null}

      {/* ── 物品网格 ── */}
      {items.length === 0 ? (
        <Empty className="min-h-[320px] border bg-card/40">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <PackageOpen />
            </EmptyMedia>
            <EmptyTitle>{search || category ? "没有匹配的物品" : "暂无物品"}</EmptyTitle>
            <EmptyDescription>
              {search || category
                ? "换个筛选条件试试,或发布你的闲置好物"
                : "还没有人发布物品,成为第一个发布者吧"}
            </EmptyDescription>
          </EmptyHeader>
          {search || category ? (
            <EmptyContent>
              <Button asChild variant="outline" size="sm">
                <Link href="/items">清除筛选</Link>
              </Button>
            </EmptyContent>
          ) : null}
        </Empty>
      ) : (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
          {items.map((item) => (
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
              sellerRating={ratingNumber(sellerRatings, item.sellerId)}
              status={item.status}
              createdAt={item.createdAt}
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
                href={buildHref({ ...baseParams, page: page > 1 ? String(page - 1) : undefined })}
                aria-disabled={page <= 1}
                className={page <= 1 ? "pointer-events-none opacity-50" : ""}
              />
            </PaginationItem>
            {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
              <PaginationItem key={p}>
                <PaginationLink
                  href={buildHref({ ...baseParams, page: p > 1 ? String(p) : undefined })}
                  isActive={p === page}
                >
                  {p}
                </PaginationLink>
              </PaginationItem>
            ))}
            <PaginationItem>
              <PaginationNext
                href={buildHref({ ...baseParams, page: page < totalPages ? String(page + 1) : undefined })}
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
