import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ChevronRight,
  Clock,
  ImageOff,
  ShieldCheck,
} from "lucide-react";

import { prisma } from "@/lib/db";
import { auth } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { formatDateTime as formatLocal } from "@/lib/time";
import { resolveContactInfo } from "@/lib/verification/contact-visibility";
import { PageContainer } from "@/components/layout/page-container";
import { Card, CardContent } from "@/components/ui/card";
import { Badge, type VerificationStatus } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";
import { AspectRatio } from "@/components/ui/aspect-ratio";

import {
  ServiceDetailActions,
  type PendingBooking,
  type ActiveBooking,
  type SlotSummary,
} from "./service-detail-actions";
import { ReportDialog } from "@/components/site/report-dialog";
import { FavoriteButton } from "@/components/site/favorite-button";
import { MessageThread } from "@/components/site/message-thread";
import { loadMessageThread, type MessageThreadData } from "@/lib/messages";
import { AiMatchCard } from "@/components/ai/ai-match-card";

export const dynamic = "force-dynamic";

const ANIM = "animate-in fade-in slide-in-from-bottom-4 duration-500";

/** 把 imageKey 解析为 R2 公开 URL;缺失时返回 null。 */
function publicUrl(imageKey?: string | null): string | null {
  const base = process.env.NEXT_PUBLIC_R2_PUBLIC_BASE_URL;
  if (!imageKey || !base) return null;
  return `${base.replace(/\/$/, "")}/${imageKey}`;
}

// formatLocal 统一来自 @/lib/time(formatDateTime),显式 Asia/Shanghai。

export default async function ServiceDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;

  const service = await prisma.service.findUnique({
    where: { id },
    include: {
      provider: {
        select: {
          id: true,
          nickname: true,
          department: true,
          enrollmentYear: true,
          verificationStatus: true,
          avatarKey: true,
        },
      },
      slots: {
        orderBy: { startAt: "asc" },
      },
      bookings: {
        where: {
          status: { in: ["PENDING", "CONFIRMED", "CANCELLING", "COMPLETED"] },
        },
        include: {
          client: {
            select: {
              id: true,
              nickname: true,
            },
          },
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });

  if (!service) notFound();

  const session = await auth();
  const viewerId = session?.user?.id ?? null;
  const viewerVerified: boolean | null = session?.user
    ? session.user.verificationStatus === "VERIFIED"
    : null;
  const isProvider = viewerId === service.providerId;

  // CLOSED 服务对非提供者隐藏。
  if (service.status === "CLOSED" && !isProvider) {
    notFound();
  }

  // 服务端解析联系方式。
  const contact = resolveContactInfo({
    visibility: service.contactVisibility,
    contactInfo: service.contactInfo,
    viewerVerified,
  });

  // 待确认预约(仅提供者会在动作卡中看到)。
  const pendingBookings: PendingBooking[] = service.bookings
    .filter((b) => b.status === "PENDING")
    .map((b) => ({
      id: b.id,
      clientId: b.client.id,
      clientNickname: b.client.nickname,
      note: b.note,
      slotId: b.slotId,
      slotStart: b.slotStart.toISOString(),
      slotEnd: b.slotEnd.toISOString(),
    }));

  // 涉及当前用户的进行中/已完成预约(CONFIRMED/CANCELLING/COMPLETED 且涉及我)。
  // 提供者看到所有此类预约;预约者看到自己的。
  const activeBookings: ActiveBooking[] = service.bookings
    .filter(
      (b) =>
        (b.status === "CONFIRMED" ||
          b.status === "CANCELLING" ||
          b.status === "COMPLETED") &&
        (isProvider || b.client.id === viewerId)
    )
    .map((b) => ({
      id: b.id,
      clientId: b.client.id,
      clientNickname: b.client.nickname,
      status: b.status,
      isViewerFirstConfirmer:
        !!b.firstConfirmerId && b.firstConfirmerId === viewerId,
      isCanceller:
        !!b.cancelledById && b.cancelledById === viewerId,
      slotStart: b.slotStart.toISOString(),
      slotEnd: b.slotEnd.toISOString(),
    }));

  // 当前用户(客户)已提交、待确认的预约(预约后回显,避免误以为没约上)。
  const myPendingBookings: PendingBooking[] = service.bookings
    .filter((b) => b.status === "PENDING" && b.client.id === viewerId)
    .map((b) => ({
      id: b.id,
      clientId: b.client.id,
      clientNickname: b.client.nickname,
      note: b.note,
      slotId: b.slotId,
      slotStart: b.slotStart.toISOString(),
      slotEnd: b.slotEnd.toISOString(),
    }));

  // 时段摘要(传给客户端;注意 ISO 字符串可序列化)。
  const allSlots: SlotSummary[] = service.slots.map((s) => ({
    id: s.id,
    startAt: s.startAt.toISOString(),
    endAt: s.endAt.toISOString(),
  }));

  // 客户端预约侧:已被占用的 slotId(PENDING/CONFIRMED/CANCELLING 占用)。
  const occupiedSlotIds = new Set(
    service.bookings
      .filter(
        (b) =>
          b.slotId &&
          (b.status === "PENDING" ||
            b.status === "CONFIRMED" ||
            b.status === "CANCELLING")
      )
      .map((b) => b.slotId!)
  );
  // 客户仅看到「未来且未被占用」的时段;提供者保留全部时段作预览。
  const now = new Date();
  const availableSlots: SlotSummary[] = allSlots.filter(
    (s) => !occupiedSlotIds.has(s.id) && (isProvider || new Date(s.startAt) > now)
  );

  // 当前用户是否已收藏(用于标题栏心形)。
  let isServiceFavorited = false;
  if (viewerId) {
    const fav = await prisma.favorite.findUnique({
      where: {
        userId_targetType_targetId: {
          userId: viewerId,
          targetType: "SERVICE",
          targetId: id,
        },
      },
      select: { id: true },
    });
    isServiceFavorited = !!fav;
  }

  // 站内私信(沟通留言):仅交易关系方(提供者 ↔ 已预约客户)可见。
  // 提供者 → 按 ?with=<clientId> 选择某位客户;客户(已预约)→ 与提供者。
  const viewerHasBooking =
    !!viewerId && service.bookings.some((b) => b.client.id === viewerId);
  let messageThread: MessageThreadData | null = null;
  if (viewerId) {
    const withId = typeof sp.with === "string" ? sp.with : null;
    const otherUserId = isProvider
      ? withId
      : viewerHasBooking
        ? service.providerId
        : null;
    if (otherUserId) {
      messageThread = await loadMessageThread(
        "SERVICE",
        id,
        viewerId,
        otherUserId
      );
    }
  }

  const proofImages = service.proofImageKeys
    .map((k) => publicUrl(k))
    .filter((u): u is string => !!u);
  const providerAvatar = publicUrl(service.provider.avatarKey);
  const providerInitial = (service.provider.nickname ?? "?")
    .charAt(0)
    .toUpperCase();

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
        <Link href="/services" className="transition-colors hover:text-primary">
          服务
        </Link>
        {service.categories[0] ? (
          <>
            <ChevronRight className="size-3.5" />
            <Link
              href={`/services?category=${encodeURIComponent(service.categories[0])}`}
              className="transition-colors hover:text-primary"
            >
              {service.categories[0]}
            </Link>
          </>
        ) : null}
        <ChevronRight className="size-3.5" />
        <span className="truncate text-foreground">{service.title}</span>
      </nav>

      <div className="grid gap-8 lg:grid-cols-[1fr_320px]">
        {/* ── 左主区 ── */}
        <div className={cn("space-y-6", ANIM)}>
          {/* 凭证图 */}
          {proofImages.length > 0 ? (
            <Card className="overflow-hidden p-0">
              <div className="grid grid-cols-2 gap-2 p-2 sm:grid-cols-3">
                {proofImages.map((src, i) => (
                  <AspectRatio key={i} ratio={4 / 3}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={src}
                      alt={`${service.title} - 凭证 ${i + 1}`}
                      className="size-full rounded-lg object-cover"
                    />
                  </AspectRatio>
                ))}
              </div>
            </Card>
          ) : (
            <Card className="overflow-hidden p-0">
              <AspectRatio ratio={16 / 5}>
                <div className="flex size-full items-center justify-center bg-accent text-muted-foreground">
                  <ImageOff className="size-10 opacity-60" />
                </div>
              </AspectRatio>
            </Card>
          )}

          {/* 标题 + 价格 + 徽章 */}
          <div className="space-y-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex items-center gap-1.5">
                <h1 className="font-serif text-2xl font-bold tracking-tight">
                  {service.title}
                </h1>
                {viewerId && !isProvider ? (
                  <FavoriteButton
                    targetType="SERVICE"
                    targetId={service.id}
                    favorited={isServiceFavorited}
                  />
                ) : null}
              </div>
              <span className="font-serif text-2xl font-bold tabular-nums text-primary">
                {service.price}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {service.categories.map((c) => (
                <Badge key={c} variant="outline" className="font-normal">
                  {c}
                </Badge>
              ))}
              {service.formats.map((f) => (
                <Badge key={f} variant="secondary" className="font-normal">
                  {f}
                </Badge>
              ))}
              {service.durationTier ? (
                <Badge variant="outline" className="font-normal">
                  {service.durationTier}
                </Badge>
              ) : null}
              {service.status === "PAUSED" ? (
                <Badge variant="secondary" className="bg-warning/90 text-white">
                  已暂停
                </Badge>
              ) : null}
            </div>
          </div>

          <Separator />

          {/* 提供者卡 */}
          <Card>
            <CardContent className="flex items-center gap-3">
              <Avatar className="size-12 ring-2 ring-primary/20">
                {providerAvatar ? (
                  <AvatarImage
                    src={providerAvatar}
                    alt={service.provider.nickname}
                  />
                ) : null}
                <AvatarFallback className="bg-primary-container font-serif font-semibold text-primary">
                  {providerInitial}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="font-medium">{service.provider.nickname}</span>
                  <Badge
                    status={service.provider.verificationStatus as VerificationStatus}
                  />
                </div>
                <p className="truncate text-xs text-muted-foreground">
                  {service.provider.department} · {service.provider.enrollmentYear} 级
                </p>
              </div>
              <Button asChild variant="outline" size="sm">
                <Link href={`/profile/${service.provider.id}`}>查看主页</Link>
              </Button>
            </CardContent>
          </Card>

          {/* 服务描述 */}
          {service.description ? (
            <div className="space-y-2">
              <h2 className="font-serif text-lg font-semibold">服务说明</h2>
              <p className="whitespace-pre-line leading-relaxed text-foreground/90">
                {service.description}
              </p>
            </div>
          ) : null}

          {/* 资质说明 */}
          {service.qualification ? (
            <div className="space-y-2">
              <h2 className="font-serif text-lg font-semibold">资质说明</h2>
              <p className="whitespace-pre-line leading-relaxed text-foreground/90">
                {service.qualification}
              </p>
            </div>
          ) : null}

          {/* 形式 / 时长 */}
          <div className="space-y-2">
            <h2 className="font-serif text-lg font-semibold">服务形式</h2>
            <div className="flex flex-wrap gap-2">
              {service.formats.map((f) => (
                <span
                  key={f}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-outline-variant/40 bg-card px-3 py-1.5 text-sm shadow-sm"
                >
                  <Clock className="size-3.5 text-primary" />
                  {f}
                </span>
              ))}
              {service.formats.length === 0 ? (
                <span className="text-sm text-muted-foreground">未指定</span>
              ) : null}
            </div>
          </div>

          {/* 可预约时段(只读预览) */}
          {allSlots.length > 0 ? (
            <div className="space-y-2">
              <h2 className="font-serif text-lg font-semibold">可预约时段</h2>
              <div className="flex flex-wrap gap-2">
                {allSlots.map((s) => {
                  const taken = occupiedSlotIds.has(s.id);
                  return (
                    <span
                      key={s.id}
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm shadow-sm",
                        taken
                          ? "border-outline-variant/40 bg-accent text-muted-foreground line-through"
                          : "border-outline-variant/40 bg-card text-foreground"
                      )}
                    >
                      {formatLocal(s.startAt)} – {formatLocal(s.endAt)}
                    </span>
                  );
                })}
              </div>
            </div>
          ) : null}
        </div>

        {/* ── 右侧栏 ── */}
        <aside className="space-y-4 lg:sticky lg:top-20 lg:self-start">
          <AiMatchCard sourceType="SERVICE" sourceId={id} />
          <ServiceDetailActions
            serviceId={service.id}
            status={service.status}
            isProvider={isProvider}
            viewerVerified={viewerVerified}
            viewerId={viewerId}
            contact={contact}
            pendingBookings={pendingBookings}
            activeBookings={activeBookings}
            slots={allSlots}
            availableSlots={availableSlots}
            myPendingBookings={myPendingBookings}
            providerId={service.providerId}
            clientCanMessage={viewerHasBooking}
          />

          {/* 安全提示 */}
          <Card>
            <CardContent className="flex items-start gap-2.5">
              <ShieldCheck className="mt-0.5 size-4 shrink-0 text-verified" />
              <div className="text-sm">
                <p className="font-medium text-foreground">安全交易提示</p>
                <p className="mt-0.5 text-muted-foreground">
                  请通过平台预约时段并保留记录;线下沟通注意人身与信息安全。
                </p>
              </div>
            </CardContent>
          </Card>

          {/* 举报 */}
          <div className="flex justify-end">
            <ReportDialog targetType="SERVICE" targetId={service.id} />
          </div>
        </aside>
      </div>

      {/* 沟通留言:仅交易关系方可见(提供者↔客户) */}
      {messageThread && viewerId ? (
        <MessageThread
          contextType="SERVICE"
          contextId={service.id}
          viewerId={viewerId}
          otherUserId={messageThread.otherUserId}
          otherNickname={messageThread.otherNickname}
          initialMessages={messageThread.messages}
        />
      ) : null}
    </PageContainer>
  );
}
