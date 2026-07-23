import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ChevronRight,
  ImageOff,
  MapPin,
  ShieldCheck,
  Tag,
  Truck,
} from "lucide-react";

import { prisma } from "@/lib/db";
import { aggregateRatings, ratingNumber } from "@/lib/reputation";
import { auth } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { resolveContactInfo } from "@/lib/verification/contact-visibility";
import { PageContainer } from "@/components/layout/page-container";
import {
  Card,
  CardContent,
} from "@/components/ui/card";
import { Badge, type VerificationStatus } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselPrevious,
  CarouselNext,
} from "@/components/ui/carousel";
import { AspectRatio } from "@/components/ui/aspect-ratio";

import {
  ItemDetailActions,
  type CurrentDeal,
  type InterestSummary,
} from "./item-detail-actions";
import { ReportDialog } from "@/components/site/report-dialog";
import { FavoriteButton } from "@/components/site/favorite-button";
import { MessageThread } from "@/components/site/message-thread";
import { ReviewsSection, type ReviewDisplayItem } from "@/components/site/reviews-section";
import { AiMatchCard } from "@/components/ai/ai-match-card";
import { loadMessageThread, type MessageThreadData } from "@/lib/messages";
import { formatDate } from "@/lib/time";

export const dynamic = "force-dynamic";

const ANIM = "animate-in fade-in slide-in-from-bottom-4 duration-500";

/** 把 imageKey 解析为 R2 公开 URL;缺失时返回 null(走占位)。 */
function publicUrl(imageKey?: string | null): string | null {
  const base = process.env.NEXT_PUBLIC_R2_PUBLIC_BASE_URL;
  if (!imageKey || !base) return null;
  return `${base.replace(/\/$/, "")}/${imageKey}`;
}

/** 渲染价格:免费 / 面议 / ¥金额。 */
function renderPrice(
  priceMode: "SPECIFIC" | "FREE" | "NEGOTIABLE",
  price?: number | null
): string {
  if (priceMode === "FREE") return "免费";
  if (priceMode === "NEGOTIABLE") return "面议";
  if (typeof price === "number") return `¥${price.toLocaleString("zh-CN")}`;
  return "面议";
}

/** 交易方式 → 图标。 */
function TradeMethodIcon({ method }: { method: string }) {
  if (method === "自提") return <MapPin className="size-3.5 text-primary" />;
  if (method === "送货") return <Truck className="size-3.5 text-primary" />;
  return <Tag className="size-3.5 text-primary" />;
}

export default async function ItemDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;

  const item = await prisma.item.findUnique({
    where: { id },
    include: {
      seller: {
        select: {
          id: true,
          nickname: true,
          department: true,
          enrollmentYear: true,
          verificationStatus: true,
          avatarKey: true,
          realName: true,
          realNameVisible: true,
        },
      },
      interests: {
        include: {
          user: {
            select: {
              id: true,
              nickname: true,
              department: true,
              enrollmentYear: true,
              verificationStatus: true,
              avatarKey: true,
            },
          },
        },
        orderBy: { createdAt: "asc" },
      },
      deal: true,
    },
  });

  if (!item || item.deletedAt) notFound();

  const session = await auth();
  const viewerId = session?.user?.id ?? null;
  const viewerVerified: boolean | null = session?.user
    ? session.user.verificationStatus === "VERIFIED"
    : null;
  const isSeller = viewerId === item.seller.id;

  // CLOSED 物品对非卖家隐藏。
  if (item.status === "CLOSED" && !isSeller) {
    notFound();
  }

  // 服务端解析联系方式。
  const contact = resolveContactInfo({
    visibility: item.contactVisibility,
    contactInfo: item.contactInfo,
    viewerVerified,
  });

  // 是否已收藏 / 已表达意向(仅对登录用户查询)。
  let isFavorited = false;
  let hasInterest = false;
  if (viewerId) {
    const [fav, interest] = await Promise.all([
      prisma.favorite.findUnique({
        where: {
          userId_targetType_targetId: {
            userId: viewerId,
            targetType: "ITEM",
            targetId: id,
          },
        },
        select: { id: true },
      }),
      prisma.itemInterest.findUnique({
        where: { itemId_userId: { itemId: id, userId: viewerId } },
        select: { id: true },
      }),
    ]);
    isFavorited = !!fav;
    hasInterest = !!interest;
  }

  // 意向人摘要:仅卖家下发完整列表(含他人留言/点击时间),非卖家下发空数组,
  // 避免完整意向队列被序列化到任意访客浏览器(隐私泄露)。
  const interestRatings = await aggregateRatings(
    item.interests.map((it) => it.user.id),
    "ITEM",
  );
  const interests: InterestSummary[] = isSeller
    ? item.interests.map((it) => ({
        userId: it.user.id,
        nickname: it.user.nickname,
        department: it.user.department,
        enrollmentYear: it.user.enrollmentYear,
        verificationStatus: it.user.verificationStatus as VerificationStatus,
        avatarUrl: publicUrl(it.user.avatarKey),
        rating: ratingNumber(interestRatings, it.user.id),
        message: it.message,
        createdAt: it.createdAt.toISOString(),
      }))
    : [];

  // 当前进行中 / 已完成的交易(忽略已取消)。
  let currentDeal: CurrentDeal | null = null;
  if (item.deal && (item.deal.status === "PENDING" || item.deal.status === "COMPLETED")) {
    const buyer = await prisma.user.findUnique({
      where: { id: item.deal.buyerId },
      select: { nickname: true },
    });
    currentDeal = {
      dealId: item.deal.id,
      buyerId: item.deal.buyerId,
      buyerNickname: buyer?.nickname ?? "买家",
      status: item.deal.status,
      firstConfirmerId: item.deal.firstConfirmerId,
    };
  }

  // 当前用户在意向队列中的排位(服务端计算,避免下发完整意向列表给非卖家)。
  const viewerInterestRank = viewerId
    ? (() => {
        const idx = item.interests.findIndex((it) => it.userId === viewerId);
        return idx >= 0 ? idx + 1 : null;
      })()
    : null;
  // 当前用户是否已对该物品交易评价过(详情页 COMPLETED 评价入口用)。
  let hasReviewed = false;
  if (viewerId && currentDeal) {
    const review = await prisma.review.findUnique({
      where: {
        dealType_dealId_reviewerId: {
          dealType: "ITEM",
          dealId: currentDeal.dealId,
          reviewerId: viewerId,
        },
      },
      select: { id: true },
    });
    hasReviewed = !!review;
  }

  // 本物品交易评价(COMPLETED 后产生;revealed 即公开,对所有访客可见)。
  // ItemDeal.itemId 唯一 → 每个物品至多一笔交易,故评价绑定到 item.deal.id。
  let itemReviews: ReviewDisplayItem[] = [];
  let itemReviewAvg: number | null = null;
  let itemReviewCount = 0;
  if (item.deal) {
    const [reviewRows, reviewAgg] = await Promise.all([
      prisma.review.findMany({
        where: { dealType: "ITEM", dealId: item.deal.id, revealed: true },
        orderBy: { revealedAt: "desc" },
        select: {
          id: true,
          rating: true,
          content: true,
          revealedAt: true,
          reviewer: { select: { nickname: true } },
        },
      }),
      prisma.review.aggregate({
        where: { dealType: "ITEM", dealId: item.deal.id, revealed: true },
        _avg: { rating: true },
        _count: { _all: true },
      }),
    ]);
    itemReviews = reviewRows.map((r) => ({
      id: r.id,
      rating: r.rating,
      content: r.content,
      reviewerNickname: r.reviewer?.nickname ?? null,
      footer: r.revealedAt ? formatDate(r.revealedAt) : undefined,
    }));
    itemReviewAvg = reviewAgg._avg.rating;
    itemReviewCount = reviewAgg._count._all;
  }

  // 站内私信(沟通留言):仅交易关系方可见。
  // 非卖家有意向/交易 → 与卖家;卖家 → 按 ?with=<userId> 选择某位意向人/买家。
  let messageThread: MessageThreadData | null = null;
  if (viewerId) {
    const withId = typeof sp.with === "string" ? sp.with : null;
    const otherUserId = isSeller
      ? withId
      : hasInterest || currentDeal
        ? item.seller.id
        : null;
    if (otherUserId) {
      messageThread = await loadMessageThread("ITEM", id, viewerId, otherUserId);
    }
  }

  const images = item.imageKeys
    .map((k) => publicUrl(k))
    .filter((u): u is string => !!u);
  const sellerAvatar = publicUrl(item.seller.avatarKey);
  const sellerInitial = (item.seller.nickname ?? "?").charAt(0).toUpperCase();
  const priceText = renderPrice(item.priceMode, item.price);

  return (
    <PageContainer className="space-y-6">
      {/* ── 面包屑 ── */}
      <nav
        aria-label="面包屑"
        className="flex flex-wrap items-center gap-1 text-sm text-muted-foreground"
      >
        <Link href="/" className="transition-colors hover:text-primary">
          首页
        </Link>
        <ChevronRight className="size-3.5" />
        <Link href="/items" className="transition-colors hover:text-primary">
          物品
        </Link>
        <ChevronRight className="size-3.5" />
        <Link
          href={`/items?category=${encodeURIComponent(item.category)}`}
          className="transition-colors hover:text-primary"
        >
          {item.category}
        </Link>
        <ChevronRight className="size-3.5" />
        <span className="truncate text-foreground">{item.title}</span>
      </nav>

      <div className="grid gap-8 lg:grid-cols-[1fr_320px]">
        {/* ── 左主区 ── */}
        <div className={cn("space-y-6", ANIM)}>
          {/* 图片画廊 */}
          <Card className="overflow-hidden p-0">
            {images.length > 0 ? (
              <div className="p-2">
                {images.length === 1 ? (
                  <AspectRatio ratio={4 / 3}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={images[0]}
                      alt={item.title}
                      className="size-full rounded-lg object-cover"
                    />
                  </AspectRatio>
                ) : (
                  <Carousel className="w-full">
                    <CarouselContent>
                      {images.map((src, i) => (
                        <CarouselItem key={i}>
                          <AspectRatio ratio={4 / 3}>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={src}
                              alt={`${item.title} - 图片 ${i + 1}`}
                              className="size-full rounded-lg object-cover"
                            />
                          </AspectRatio>
                        </CarouselItem>
                      ))}
                    </CarouselContent>
                    <CarouselPrevious />
                    <CarouselNext />
                  </Carousel>
                )}
              </div>
            ) : (
              <AspectRatio ratio={4 / 3}>
                <div className="flex size-full items-center justify-center bg-accent text-muted-foreground">
                  <ImageOff className="size-10 opacity-60" />
                </div>
              </AspectRatio>
            )}
          </Card>

          {/* 标题 + 价格 + 徽章 */}
          <div className="space-y-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex items-center gap-1.5">
                <h1 className="font-serif text-2xl font-bold tracking-tight">
                  {item.title}
                </h1>
                {viewerId && !isSeller ? (
                  <FavoriteButton
                    targetType="ITEM"
                    targetId={item.id}
                    favorited={isFavorited}
                  />
                ) : null}
              </div>
              <span className="font-serif text-3xl font-bold tabular-nums text-primary">
                {priceText}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge variant="outline" className="font-normal">
                {item.category}
              </Badge>
              <Badge variant="secondary" className="font-normal">
                {item.condition}
              </Badge>
              {item.priceMode === "NEGOTIABLE" ? (
                <Badge variant="outline" className="font-normal">
                  可议价
                </Badge>
              ) : null}
              {!isSeller && item.interests.length > 0 ? (
                <Badge variant="secondary" className="font-normal">
                  {item.interests.length} 人想要
                </Badge>
              ) : null}
              {item.status === "PENDING" ? (
                <Badge variant="secondary" className="bg-warning/90 text-white">
                  交易中
                </Badge>
              ) : null}
              {item.status === "SOLD" ? (
                <Badge variant="outline" className="text-muted-foreground">
                  已售出
                </Badge>
              ) : null}
            </div>
          </div>

          <Separator />

          {/* 卖家卡 */}
          <Card>
            <CardContent className="flex items-center gap-3">
              <Avatar className="size-12 ring-2 ring-primary/20">
                {sellerAvatar ? (
                  <AvatarImage src={sellerAvatar} alt={item.seller.nickname} />
                ) : null}
                <AvatarFallback className="bg-primary-container font-serif font-semibold text-primary">
                  {sellerInitial}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="font-medium">{item.seller.nickname}</span>
                  <Badge status={item.seller.verificationStatus as VerificationStatus} />
                </div>
                <p className="truncate text-xs text-muted-foreground">
                  {item.seller.department} · {item.seller.enrollmentYear} 级
                </p>
              </div>
              <Button asChild variant="outline" size="sm">
                <Link href={`/profile/${item.seller.id}`}>查看主页</Link>
              </Button>
            </CardContent>
          </Card>

          {/* 描述 */}
          {item.description ? (
            <div className="space-y-2">
              <h2 className="font-serif text-lg font-semibold">物品描述</h2>
              <p className="leading-relaxed whitespace-pre-line text-foreground/90">
                {item.description}
              </p>
            </div>
          ) : null}

          {/* 关键信息 */}
          <div className="space-y-2">
            <h2 className="font-serif text-lg font-semibold">物品信息</h2>
            <dl className="grid grid-cols-1 gap-x-6 gap-y-0 rounded-xl border border-outline-variant/40 bg-card p-2 sm:grid-cols-2">
              <InfoItem label="分类" value={item.category} />
              <InfoItem label="成色" value={item.condition} />
              {typeof item.originalPrice === "number" ? (
                <InfoItem
                  label="原价"
                  value={`¥${item.originalPrice.toLocaleString("zh-CN")}`}
                />
              ) : null}
              {item.pickupLocation ? (
                <InfoItem label="自提地点" value={item.pickupLocation} />
              ) : null}
            </dl>
          </div>

          {/* 交易方式 */}
          {item.tradeMethods.length > 0 ? (
            <div className="space-y-2">
              <h2 className="font-serif text-lg font-semibold">交易方式</h2>
              <div className="flex flex-wrap gap-2">
                {item.tradeMethods.map((m) => (
                  <span
                    key={m}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-outline-variant/40 bg-card px-3 py-1.5 text-sm shadow-sm"
                  >
                    <TradeMethodIcon method={m} />
                    {m}
                  </span>
                ))}
              </div>
            </div>
          ) : null}
        </div>

        {/* ── 右侧栏 ── */}
        <aside className="space-y-4 lg:sticky lg:top-20 lg:self-start">
          <AiMatchCard sourceType="ITEM" sourceId={id} />
          <ItemDetailActions
            itemId={item.id}
            isSeller={isSeller}
            viewerVerified={viewerVerified}
            viewerId={viewerId}
            hasInterest={hasInterest}
            contact={contact}
            interests={interests}
            currentDeal={currentDeal}
            sellerNickname={item.seller.nickname}
            itemStatus={item.status}
            hasReviewed={hasReviewed}
            viewerInterestRank={viewerInterestRank}
          />

          {/* 安全提示 */}
          <Card>
            <CardContent className="flex items-start gap-2.5">
              <ShieldCheck className="mt-0.5 size-4 shrink-0 text-verified" />
              <div className="text-sm">
                <p className="font-medium text-foreground">安全交易提示</p>
                <p className="mt-0.5 text-muted-foreground">
                  请在校园内公共场所完成交易;平台不介入资金往来,谨防诈骗。
                </p>
              </div>
            </CardContent>
          </Card>

          {/* 举报 */}
          <div className="flex justify-end">
            <ReportDialog targetType="ITEM" targetId={item.id} />
          </div>
        </aside>
      </div>

      {/* 交易评价:COMPLETED 后产生,公开即可见(无评价时不渲染) */}
      <ReviewsSection
        reviews={itemReviews}
        avg={itemReviewAvg}
        count={itemReviewCount}
        title="交易评价"
      />

      {/* 沟通留言:仅交易关系方可见(买家↔卖家) */}
      {messageThread && viewerId ? (
        <MessageThread
          contextType="ITEM"
          contextId={item.id}
          viewerId={viewerId}
          otherUserId={messageThread.otherUserId}
          otherNickname={messageThread.otherNickname}
          initialMessages={messageThread.messages}
        />
      ) : null}
    </PageContainer>
  );
}

/** 关键信息的一行(label / value)。 */
function InfoItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 px-2 py-2 text-sm">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="truncate text-right text-foreground">{value}</dd>
    </div>
  );
}
