import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronRight, ShieldCheck } from "lucide-react";

import { prisma } from "@/lib/db";
import { auth } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { resolveContactInfo } from "@/lib/verification/contact-visibility";
import { PageContainer } from "@/components/layout/page-container";
import { Card, CardContent } from "@/components/ui/card";
import { Badge, type VerificationStatus } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";

import {
  NeedDetailActions,
  type ApplicantSummary,
  type MatchedSummary,
} from "./need-detail-actions";
import { ReportDialog } from "@/components/site/report-dialog";
import { FavoriteButton } from "@/components/site/favorite-button";
import { MessageThread } from "@/components/site/message-thread";
import { loadMessageThread, type MessageThreadData } from "@/lib/messages";
import { AiMatchCard } from "@/components/ai/ai-match-card";

export const dynamic = "force-dynamic";

const ANIM = "animate-in fade-in slide-in-from-bottom-4 duration-500";

const EXPECTED_TIME_LABEL: Record<string, string> = {
  ASAP: "尽快",
  THIS_WEEK: "本周内",
  TWO_WEEKS: "两周内",
  FLEXIBLE: "时间灵活",
};

export default async function NeedDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;

  const need = await prisma.need.findUnique({
    where: { id },
    include: {
      requester: {
        select: {
          id: true,
          nickname: true,
          department: true,
          enrollmentYear: true,
          verificationStatus: true,
          avatarKey: true,
        },
      },
      matches: {
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
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });

  if (!need) notFound();

  const session = await auth();
  const viewerId = session?.user?.id ?? null;
  const viewerVerified: boolean | null = session?.user
    ? session.user.verificationStatus === "VERIFIED"
    : null;
  const isRequester = viewerId === need.requester.id;

  // CLOSED 需求对非发布者隐藏。
  if (need.status === "CLOSED" && !isRequester) {
    notFound();
  }

  const contact = resolveContactInfo({
    visibility: need.contactVisibility,
    contactInfo: need.contactInfo,
    viewerVerified,
  });

  // 应征者摘要(发布者可见;另:若当前用户是该应征者,可在动作卡看到自己的撮合状态)。
  const applicantSummaryList: ApplicantSummary[] = need.matches
    .filter((m) => m.status === "APPLIED")
    .map((m) => ({
      matchId: m.id,
      providerId: m.provider.id,
      nickname: m.provider.nickname,
      department: m.provider.department,
      enrollmentYear: m.provider.enrollmentYear,
      verificationStatus: m.provider.verificationStatus as VerificationStatus,
      message: m.message,
    }));

  // 涉及当前用户的撮合(CONFIRMED 阶段:MATCHED/CANCELLING/COMPLETED)。
  // 发布者看到所有;被选中的提供者看到自己的。
  const matchedSummaryList: MatchedSummary[] = need.matches
    .filter(
      (m) =>
        m.status === "MATCHED" ||
        m.status === "CANCELLING" ||
        m.status === "COMPLETED"
    )
    .filter((m) => isRequester || m.provider.id === viewerId)
    .map((m) => ({
      matchId: m.id,
      providerId: m.provider.id,
      nickname: m.provider.nickname,
      status: m.status,
      isViewerFirstConfirmer:
        !!m.firstConfirmerId && m.firstConfirmerId === viewerId,
      isCanceller: !!m.cancelledById && m.cancelledById === viewerId,
    }));

  // 当前用户是否已应征(用于隐藏“我可以帮忙”按钮 / 给出提示)。
  const viewerApplied = need.matches.some(
    (m) =>
      m.provider.id === viewerId &&
      (m.status === "APPLIED" ||
        m.status === "MATCHED" ||
        m.status === "CANCELLING")
  );

  // 当前用户是否曾应征但未被选中(可重新应征,给明确反馈)。
  const viewerNotSelected = need.matches.some(
    (m) => m.provider.id === viewerId && m.status === "NOT_SELECTED"
  );

  // 当前用户仍是候选应征者(APPLIED),且需求已选定他人(MATCHED)→ 详情页给出"已选定他人"反馈,
  // 而非仅靠通知(原页面无任何提示,候选者反复刷新困惑)。
  const viewerIsCandidateOthersSelected =
    !!viewerId &&
    need.matches.some(
      (m) => m.provider.id === viewerId && m.status === "APPLIED"
    ) &&
    need.matches.some(
      (m) => m.status === "MATCHED" && m.provider.id !== viewerId
    );

  // 当前用户是否已收藏(用于标题栏心形)。
  let isNeedFavorited = false;
  if (viewerId) {
    const fav = await prisma.favorite.findUnique({
      where: {
        userId_targetType_targetId: {
          userId: viewerId,
          targetType: "NEED",
          targetId: id,
        },
      },
      select: { id: true },
    });
    isNeedFavorited = !!fav;
  }

  // 站内私信(沟通留言):仅交易关系方(发布者 ↔ 应征/撮合提供者)可见。
  // 发布者 → 按 ?with=<providerId> 选择某位提供者;提供者(已应征)→ 与发布者。
  let messageThread: MessageThreadData | null = null;
  if (viewerId) {
    const withId = typeof sp.with === "string" ? sp.with : null;
    const viewerHasMatch = need.matches.some((m) => m.provider.id === viewerId);
    const otherUserId = isRequester
      ? withId
      : viewerHasMatch
        ? need.requester.id
        : null;
    if (otherUserId) {
      messageThread = await loadMessageThread("NEED", id, viewerId, otherUserId);
    }
  }

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
        <Link href="/needs" className="transition-colors hover:text-primary">
          需求
        </Link>
        <ChevronRight className="size-3.5" />
        <Link
          href={`/needs?category=${encodeURIComponent(need.category)}`}
          className="transition-colors hover:text-primary"
        >
          {need.category}
        </Link>
        <ChevronRight className="size-3.5" />
        <span className="truncate text-foreground">{need.title}</span>
      </nav>

      <div className="grid gap-8 lg:grid-cols-[1fr_320px]">
        {/* ── 左主区 ── */}
        <div className={cn("space-y-6", ANIM)}>
          {/* 标题 + 酬谢 + 徽章 */}
          <div className="space-y-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex items-center gap-1.5">
                <h1 className="font-serif text-2xl font-bold tracking-tight">
                  {need.title}
                </h1>
                {viewerId && !isRequester ? (
                  <FavoriteButton
                    targetType="NEED"
                    targetId={need.id}
                    favorited={isNeedFavorited}
                  />
                ) : null}
              </div>
              <span className="font-serif text-2xl font-bold tabular-nums text-primary">
                {need.reward}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge variant="outline" className="font-normal">
                {need.category}
              </Badge>
              <Badge variant="secondary" className="font-normal">
                {EXPECTED_TIME_LABEL[need.expectedTime] ?? need.expectedTime}
              </Badge>
              <Badge variant="outline" className="font-normal">
                {need.formatPreference}
              </Badge>
              {need.status === "PAUSED" ? (
                <Badge variant="secondary" className="bg-warning/90 text-white">
                  已暂停
                </Badge>
              ) : null}
            </div>
          </div>

          <Separator />

          {/* 发布者卡 */}
          <Card>
            <CardContent className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="font-medium">{need.requester.nickname}</span>
                  <Badge
                    status={need.requester.verificationStatus as VerificationStatus}
                  />
                </div>
                <p className="truncate text-xs text-muted-foreground">
                  {need.requester.department} · {need.requester.enrollmentYear} 级
                </p>
              </div>
              <Button asChild variant="outline" size="sm">
                <Link href={`/profile/${need.requester.id}`}>查看主页</Link>
              </Button>
            </CardContent>
          </Card>

          {/* 需求描述 */}
          {need.description ? (
            <div className="space-y-2">
              <h2 className="font-serif text-lg font-semibold">需求说明</h2>
              <p className="whitespace-pre-line leading-relaxed text-foreground/90">
                {need.description}
              </p>
            </div>
          ) : null}

          {/* 期望画像 */}
          {need.expectedProfile ? (
            <div className="space-y-2">
              <h2 className="font-serif text-lg font-semibold">期望提供者</h2>
              <p className="whitespace-pre-line leading-relaxed text-foreground/90">
                {need.expectedProfile}
              </p>
            </div>
          ) : null}

          {/* 关键信息 */}
          <div className="space-y-2">
            <h2 className="font-serif text-lg font-semibold">需求信息</h2>
            <dl className="grid grid-cols-1 gap-x-6 gap-y-0 rounded-xl border border-outline-variant/40 bg-card p-2 sm:grid-cols-2">
              <InfoItem label="分类" value={need.category} />
              <InfoItem label="形式偏好" value={need.formatPreference} />
              <InfoItem
                label="期望时间"
                value={
                  EXPECTED_TIME_LABEL[need.expectedTime] ?? need.expectedTime
                }
              />
              <InfoItem label="酬谢" value={need.reward} />
            </dl>
          </div>
        </div>

        {/* ── 右侧栏 ── */}
        <aside className="space-y-4 lg:sticky lg:top-20 lg:self-start">
          <AiMatchCard sourceType="NEED" sourceId={id} />
          <NeedDetailActions
            needId={need.id}
            status={need.status}
            isRequester={isRequester}
            viewerVerified={viewerVerified}
            viewerId={viewerId}
            contact={contact}
            applicants={applicantSummaryList}
            matches={matchedSummaryList}
            viewerApplied={viewerApplied}
            viewerNotSelected={viewerNotSelected}
            viewerIsCandidateOthersSelected={viewerIsCandidateOthersSelected}
          />

          {/* 安全提示 */}
          <Card>
            <CardContent className="flex items-start gap-2.5">
              <ShieldCheck className="mt-0.5 size-4 shrink-0 text-verified" />
              <div className="text-sm">
                <p className="font-medium text-foreground">安全交易提示</p>
                <p className="mt-0.5 text-muted-foreground">
                  登录后即可查看联系方式;线下沟通注意人身与信息安全。
                </p>
              </div>
            </CardContent>
          </Card>

          {/* 举报 */}
          <div className="flex justify-end">
            <ReportDialog targetType="NEED" targetId={need.id} />
          </div>
        </aside>
      </div>

      {/* 沟通留言:仅交易关系方可见(发布者↔提供者) */}
      {messageThread && viewerId ? (
        <MessageThread
          contextType="NEED"
          contextId={need.id}
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
