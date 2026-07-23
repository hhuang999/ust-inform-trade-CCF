"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { enqueueEmbedResource } from "@/lib/ai/jobs";
import {
  requireVerifiedUser,
  NotAuthenticatedError,
  NotVerifiedError,
  type SessionUser,
} from "@/lib/permissions";
import {
  needCreateSchema,
  needUpdateSchema,
  type NeedCreateInput,
  type NeedUpdateInput,
} from "@/lib/validation/need";

/**
 * 写入通知。直接落到 notifications 表以支持 `data` 字段。
 */
function notify(params: {
  userId: string;
  type: string;
  title: string;
  body: string;
  link?: string | null;
  data?: Prisma.InputJsonValue;
}) {
  return prisma.notification.create({ data: params });
}

type ActionResult<T = object> =
  | ({ ok: true } & T)
  | { ok: false; error: string };

/** 统一鉴权:将 requireVerifiedUser 的异常映射为可返回给客户端的错误对象。 */
async function resolveActor(): Promise<SessionUser | { error: string }> {
  const session = await auth();
  const user: SessionUser | null = session?.user
    ? {
        id: session.user.id,
        role: session.user.role,
        verificationStatus: session.user.verificationStatus,
      }
    : null;
  try {
    return requireVerifiedUser(user);
  } catch (e) {
    if (e instanceof NotAuthenticatedError) return { error: "请先登录" };
    if (e instanceof NotVerifiedError) return { error: "请先完成身份认证" };
    return { error: "请先登录" };
  }
}

function revalidateNeedRoutes(needId?: string) {
  revalidatePath("/needs");
  revalidatePath("/me/needs");
  revalidatePath("/me/matches");
  if (needId) revalidatePath(`/needs/${needId}`);
}

// ───────────────────────── 需求生命周期 ─────────────────────────

/**
 * 发布需求(requesterId = 当前用户,status OPEN)。
 */
export async function createNeed(
  input: NeedCreateInput
): Promise<ActionResult<{ needId: string }>> {
  const actor = await resolveActor();
  if ("error" in actor) return { ok: false, error: actor.error };

  const parsed = needCreateSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "参数校验失败" };
  }
  const d = parsed.data;

  const need = await prisma.need.create({
    data: {
      requesterId: actor.id,
      title: d.title,
      description: d.description,
      expectedProfile: d.expectedProfile ?? null,
      reward: d.reward,
      expectedTime: d.expectedTime,
      formatPreference: d.formatPreference,
      category: d.category,
      contactInfo: d.contactInfo,
      contactVisibility: d.contactVisibility,
      status: "OPEN",
    },
    select: { id: true },
  });

  // AI：异步入队生成向量（best-effort）。
  await enqueueEmbedResource("NEED", need.id);

  revalidateNeedRoutes(need.id);
  return { ok: true, needId: need.id };
}

/**
 * 更新需求(仅发布者,且状态须为 OPEN 或 PAUSED)。
 */
export async function updateNeed(
  needId: string,
  input: NeedUpdateInput
): Promise<ActionResult> {
  const actor = await resolveActor();
  if ("error" in actor) return { ok: false, error: actor.error };

  const parsed = needUpdateSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "参数校验失败" };
  }
  const d = parsed.data;

  const need = await prisma.need.findUnique({
    where: { id: needId },
    select: { requesterId: true, status: true },
  });
  if (!need) return { ok: false, error: "需求不存在" };
  if (need.requesterId !== actor.id) return { ok: false, error: "无权操作他人需求" };
  if (need.status !== "OPEN" && need.status !== "PAUSED") {
    return { ok: false, error: "当前状态不可编辑" };
  }

  const data: Prisma.NeedUpdateInput = {};
  if (d.title !== undefined) data.title = d.title;
  if (d.description !== undefined) data.description = d.description;
  if (d.expectedProfile !== undefined) data.expectedProfile = d.expectedProfile ?? null;
  if (d.reward !== undefined) data.reward = d.reward;
  if (d.expectedTime !== undefined) data.expectedTime = d.expectedTime;
  if (d.formatPreference !== undefined) data.formatPreference = d.formatPreference;
  if (d.category !== undefined) data.category = d.category;
  if (d.contactInfo !== undefined) data.contactInfo = d.contactInfo;
  if (d.contactVisibility !== undefined) data.contactVisibility = d.contactVisibility;

  await prisma.need.update({ where: { id: needId }, data });
  await enqueueEmbedResource("NEED", needId);
  revalidateNeedRoutes(needId);
  return { ok: true };
}

/** 暂停需求(仅发布者,OPEN→PAUSED)。 */
export async function pauseNeed(needId: string): Promise<ActionResult> {
  const actor = await resolveActor();
  if ("error" in actor) return { ok: false, error: actor.error };

  const need = await prisma.need.findUnique({
    where: { id: needId },
    select: { requesterId: true, status: true },
  });
  if (!need) return { ok: false, error: "需求不存在" };
  if (need.requesterId !== actor.id) return { ok: false, error: "无权操作他人需求" };
  if (need.status !== "OPEN") return { ok: false, error: "仅开放中的需求可暂停" };

  await prisma.need.update({ where: { id: needId }, data: { status: "PAUSED" } });
  revalidateNeedRoutes(needId);
  return { ok: true };
}

/** 恢复需求(仅发布者,PAUSED→OPEN)。 */
export async function resumeNeed(needId: string): Promise<ActionResult> {
  const actor = await resolveActor();
  if ("error" in actor) return { ok: false, error: actor.error };

  const need = await prisma.need.findUnique({
    where: { id: needId },
    select: { requesterId: true, status: true },
  });
  if (!need) return { ok: false, error: "需求不存在" };
  if (need.requesterId !== actor.id) return { ok: false, error: "无权操作他人需求" };
  if (need.status !== "PAUSED") return { ok: false, error: "仅已暂停的需求可恢复" };

  await prisma.need.update({ where: { id: needId }, data: { status: "OPEN" } });
  revalidateNeedRoutes(needId);
  return { ok: true };
}

/** 关闭需求(仅发布者,→CLOSED;剩余 APPLIED 应征置为 NOT_SELECTED 并通知)。 */
export async function closeNeed(needId: string): Promise<ActionResult> {
  const actor = await resolveActor();
  if ("error" in actor) return { ok: false, error: actor.error };

  const need = await prisma.need.findUnique({
    where: { id: needId },
    select: { requesterId: true, status: true, title: true },
  });
  if (!need) return { ok: false, error: "需求不存在" };
  if (need.requesterId !== actor.id) return { ok: false, error: "无权操作他人需求" };
  if (need.status === "CLOSED") return { ok: false, error: "需求已关闭" };

  const leftover = await prisma.needMatch.findMany({
    where: { needId, status: "APPLIED" },
    select: { providerId: true },
  });

  await prisma.$transaction([
    prisma.need.update({ where: { id: needId }, data: { status: "CLOSED" } }),
    prisma.needMatch.updateMany({
      where: { needId, status: "APPLIED" },
      data: { status: "NOT_SELECTED" },
    }),
  ]);

  await Promise.all(
    leftover.map((m) =>
      notify({
        userId: m.providerId,
        type: "need_not_selected",
        title: "该需求已关闭(未选中)",
        body: `「${need.title}」需求已关闭,你本次未被选中。`,
        link: `/needs/${needId}`,
      })
    )
  );

  revalidateNeedRoutes(needId);
  return { ok: true };
}

// ───────────────────────── 应征 / 撮合 ─────────────────────────

/**
 * 应征需求(提供者,已认证 ≠ 发布者;唯一 [needId, providerId],已存在则返回)。
 */
export async function applyToNeed(
  needId: string,
  message?: string
): Promise<ActionResult<{ matchId: string }>> {
  const actor = await resolveActor();
  if ("error" in actor) return { ok: false, error: actor.error };

  const need = await prisma.need.findUnique({
    where: { id: needId },
    select: { requesterId: true, status: true, title: true },
  });
  if (!need) return { ok: false, error: "需求不存在" };
  if (need.status !== "OPEN") return { ok: false, error: "该需求当前不可应征" };
  if (need.requesterId === actor.id) {
    return { ok: false, error: "不能应征自己的需求" };
  }

  // 必填简述经验/资质与可用时间(服务端校验,防绕过前端)。
  const msg = (message ?? "").trim();
  if (!msg) return { ok: false, error: "请简述相关经验/资质与可用时间" };

  // 应征去重 + 重新激活:[needId, providerId] 唯一。
  // - 已有「进行中」应征(APPLIED/MATCHED/CANCELLING)→ 幂等返回,不重复通知。
  // - 仅有「已结束」记录(NOT_SELECTED/CANCELLED)→ 重新激活为 APPLIED 并通知(修复"落选后无法再应征"的静默空操作)。
  // - 无记录 → 新建并通知。
  let match: { id: string };
  let isNew = false;

  const active = await prisma.needMatch.findFirst({
    where: {
      needId,
      providerId: actor.id,
      status: { in: ["APPLIED", "MATCHED", "CANCELLING"] },
    },
    select: { id: true },
  });
  if (active) {
    match = active;
  } else {
    const inactive = await prisma.needMatch.findFirst({
      where: { needId, providerId: actor.id, status: { in: ["NOT_SELECTED", "CANCELLED"] } },
      select: { id: true },
    });
    try {
      if (inactive) {
        await prisma.needMatch.update({
          where: { id: inactive.id },
          data: {
            status: "APPLIED",
            message: msg,
            firstConfirmerId: null,
            firstConfirmedAt: null,
            matchedAt: null,
            completedAt: null,
            cancelledById: null,
            cancelledAt: null,
            liabilityAgreed: null,
            liabilityDecidedAt: null,
          },
        });
        match = inactive;
      } else {
        match = await prisma.needMatch.create({
          data: { needId, providerId: actor.id, message: msg, status: "APPLIED" },
          select: { id: true },
        });
      }
      isNew = true;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        // 并发:另一请求刚建了同一记录,取回它。
        const existing = await prisma.needMatch.findFirst({
          where: { needId, providerId: actor.id },
          select: { id: true },
        });
        if (!existing) throw e;
        match = existing;
      } else {
        throw e;
      }
    }
  }

  if (isNew) {
    await notify({
      userId: need.requesterId,
      type: "need_new_application",
      title: "你的需求有新应征",
      body: `「${need.title}」收到一条新的应征申请`,
      link: `/needs/${needId}`,
      data: { matchId: match.id, needId },
    });
  }

  revalidateNeedRoutes(needId);
  revalidatePath("/me/matches");
  return { ok: true, matchId: match.id };
}

/**
 * 提供者撤回应征(APPLIED→NOT_SELECTED),通知需求方(PRD §4.7「应征者可撤回」)。
 */
export async function withdrawNeedMatch(matchId: string): Promise<ActionResult> {
  const actor = await resolveActor();
  if ("error" in actor) return { ok: false, error: actor.error };

  const match = await prisma.needMatch.findUnique({
    where: { id: matchId },
    select: { needId: true, providerId: true, status: true },
  });
  if (!match) return { ok: false, error: "应征记录不存在" };
  if (match.providerId !== actor.id) return { ok: false, error: "只有应征者可撤回" };
  if (match.status !== "APPLIED") return { ok: false, error: "该应征当前不可撤回" };

  const need = await prisma.need.findUnique({
    where: { id: match.needId },
    select: { requesterId: true, title: true },
  });
  if (!need) return { ok: false, error: "需求不存在" };

  await prisma.needMatch.update({
    where: { id: matchId },
    data: { status: "NOT_SELECTED" },
  });

  await notify({
    userId: need.requesterId,
    type: "need_withdrawn",
    title: "一条应征已被撤回",
    body: `「${need.title}」的一条应征已被提供者撤回。`,
    link: `/needs/${match.needId}`,
    data: { matchId },
  });

  revalidateNeedRoutes(match.needId);
  revalidatePath("/me/matches");
  return { ok: true };
}

/** 发布者选定提供者(match APPLIED→MATCHED)。通知提供者。 */
export async function chooseProvider(matchId: string): Promise<ActionResult> {
  const actor = await resolveActor();
  if ("error" in actor) return { ok: false, error: actor.error };

  const match = await prisma.needMatch.findUnique({
    where: { id: matchId },
    select: { needId: true, providerId: true, status: true },
  });
  if (!match) return { ok: false, error: "应征记录不存在" };

  const need = await prisma.need.findUnique({
    where: { id: match.needId },
    select: { requesterId: true, title: true },
  });
  if (!need) return { ok: false, error: "需求不存在" };
  if (need.requesterId !== actor.id) return { ok: false, error: "只有发布者可选定提供者" };
  if (match.status !== "APPLIED") return { ok: false, error: "该应征当前不可选定" };

  // 撮合为 1:1:同一需求已有进行中撮合(MATCHED/CANCELLING)时拒绝再次选定,
  // 防止发布者并发选定多名提供者,破坏双方确认完成/违规归责语义。
  const existingActive = await prisma.needMatch.findFirst({
    where: {
      needId: match.needId,
      status: { in: ["MATCHED", "CANCELLING"] },
      NOT: { id: matchId },
    },
    select: { id: true },
  });
  if (existingActive) {
    return { ok: false, error: "已选定一位提供者,请先结束当前对接再更换" };
  }

  await prisma.needMatch.update({
    where: { id: matchId },
    // 写 matchedAt:cron「双方均未确认 7 天自动完成」分支以 matchedAt 为锚点,
    // 不写则该分支永不命中,撮合永久卡死、无法互评。
    data: { status: "MATCHED", matchedAt: new Date() },
  });

  await notify({
    userId: match.providerId,
    type: "need_chosen",
    title: "你已被选中",
    body: `「${need.title}」需求方已选中你,请尽快联系对接。`,
    link: "/me/matches",
    data: { matchId, needId: match.needId },
  });

  // 通知其余候选应征者:需求已选定一位提供者,你仍在候选列表中(给他们闭环,而非无声等待)。
  const otherApplicants = await prisma.needMatch.findMany({
    where: {
      needId: match.needId,
      status: "APPLIED",
      providerId: { not: match.providerId },
    },
    select: { providerId: true },
  });
  await Promise.all(
    otherApplicants.map((m) =>
      notify({
        userId: m.providerId,
        type: "need_candidate_update",
        title: "该需求已选定一位提供者",
        body: `「${need.title}」已选定一位提供者,你仍在候选列表中;若对方退出,需求方可能再联系你。`,
        link: `/needs/${match.needId}`,
      })
    )
  );

  revalidateNeedRoutes(match.needId);
  revalidatePath("/me/matches");
  return { ok: true };
}

/**
 * 发布者拒绝单个应征者(match APPLIED→NOT_SELECTED),通知提供者「未选中」。
 * 与 closeNeed 的批量拒绝不同:这里精准针对单个 match,且不关闭整个需求。
 */
export async function rejectApplicant(matchId: string): Promise<ActionResult> {
  const actor = await resolveActor();
  if ("error" in actor) return { ok: false, error: actor.error };

  const match = await prisma.needMatch.findUnique({
    where: { id: matchId },
    select: { needId: true, providerId: true, status: true },
  });
  if (!match) return { ok: false, error: "应征记录不存在" };

  const need = await prisma.need.findUnique({
    where: { id: match.needId },
    select: { requesterId: true, title: true },
  });
  if (!need) return { ok: false, error: "需求不存在" };
  if (need.requesterId !== actor.id) {
    return { ok: false, error: "只有发布者可拒绝应征者" };
  }
  if (match.status !== "APPLIED") {
    return { ok: false, error: "该应征当前不可拒绝" };
  }

  await prisma.needMatch.update({
    where: { id: matchId },
    data: { status: "NOT_SELECTED" },
  });

  await notify({
    userId: match.providerId,
    type: "need_not_selected",
    title: "你的应征未被选中",
    body: `「${need.title}」需求方未选择你本次的应征。`,
    link: `/needs/${match.needId}`,
    data: { matchId, needId: match.needId },
  });

  revalidateNeedRoutes(match.needId);
  revalidatePath("/me/matches");
  return { ok: true };
}

/**
 * 取消方撤回取消(CANCELLING→MATCHED,清空 cancelledBy*)。
 * 用于误点「申请取消」后回退,使对接恢复进行(非硬终止)。仅取消发起方可撤回。
 */
export async function resumeNeedMatch(matchId: string): Promise<ActionResult> {
  const actor = await resolveActor();
  if ("error" in actor) return { ok: false, error: actor.error };

  const match = await prisma.needMatch.findUnique({
    where: { id: matchId },
    select: { needId: true, status: true, providerId: true, cancelledById: true },
  });
  if (!match) return { ok: false, error: "应征记录不存在" };
  if (match.status !== "CANCELLING") {
    return { ok: false, error: "该应征当前不在取消协商中" };
  }
  if (match.cancelledById !== actor.id) {
    return { ok: false, error: "只有取消发起方可撤回取消" };
  }

  const need = await prisma.need.findUnique({
    where: { id: match.needId },
    select: { requesterId: true },
  });
  if (!need) return { ok: false, error: "需求不存在" };

  await prisma.needMatch.update({
    where: { id: matchId },
    data: {
      status: "MATCHED",
      cancelledById: null,
      cancelledAt: null,
      liabilityAgreed: null,
      liabilityDecidedAt: null,
    },
  });

  const otherId = actor.id === match.providerId ? need.requesterId : match.providerId;
  await notify({
    userId: otherId,
    type: "need_cancel_withdrawn",
    title: "对方已撤回取消",
    body: "对方撤回了本次取消申请,对接继续进行。",
    link: "/me/matches",
    data: { matchId },
  });

  revalidateNeedRoutes(match.needId);
  revalidatePath("/me/matches");
  return { ok: true };
}

/**
 * 任一参与方确认完成(双方各确认一次)。
 * - 第一方 → 设置 firstConfirmer,通知对方;
 * - 第二方 → COMPLETED,通知双方评价。
 */
export async function confirmNeedMatchComplete(
  matchId: string
): Promise<ActionResult<{ completed?: boolean }>> {
  const actor = await resolveActor();
  if ("error" in actor) return { ok: false, error: actor.error };

  const match = await prisma.needMatch.findUnique({
    where: { id: matchId },
    select: {
      needId: true,
      providerId: true,
      status: true,
      firstConfirmerId: true,
    },
  });
  if (!match) return { ok: false, error: "应征记录不存在" };

  const need = await prisma.need.findUnique({
    where: { id: match.needId },
    select: { requesterId: true },
  });
  if (!need) return { ok: false, error: "需求不存在" };
  const isParticipant = match.providerId === actor.id || need.requesterId === actor.id;
  if (!isParticipant) return { ok: false, error: "无权操作此应征" };
  if (match.status !== "MATCHED") {
    return { ok: false, error: "该应征当前不可确认完成" };
  }

  const otherId = actor.id === match.providerId ? need.requesterId : match.providerId;

  // 原子抢"第一确认人":仅当仍为 MATCHED 且 firstConfirmerId 为 null 时成功(防并发双首确认竞态)。
  const claimed = await prisma.needMatch.updateMany({
    where: { id: matchId, status: "MATCHED", firstConfirmerId: null },
    data: { firstConfirmerId: actor.id, firstConfirmedAt: new Date() },
  });
  if (claimed.count > 0) {
    await notify({
      userId: otherId,
      type: "need_confirm_request",
      title: "对方已确认完成,请你确认",
      body: "对方已确认本次对接完成,请尽快确认。",
      link: "/me/matches",
      data: { matchId },
    });
    revalidateNeedRoutes(match.needId);
    revalidatePath("/me/matches");
    return { ok: true, completed: false };
  }

  // 未抢到 → 重读判定:我已确认 / 我是第二方 / 状态已变。
  const fresh = await prisma.needMatch.findUnique({
    where: { id: matchId },
    select: { status: true, firstConfirmerId: true },
  });
  if (!fresh) return { ok: false, error: "应征记录不存在" };
  if (fresh.status !== "MATCHED") {
    return { ok: false, error: "该应征当前不可确认完成" };
  }
  if (fresh.firstConfirmerId === actor.id) {
    return { ok: false, error: "你已确认,请等待对方确认" };
  }
  if (!fresh.firstConfirmerId) {
    return { ok: false, error: "请稍后重试" };
  }

  // 第二方确认 → 完成。
  await prisma.needMatch.update({
    where: { id: matchId },
    data: { status: "COMPLETED", completedAt: new Date() },
  });

  const both = [match.providerId, need.requesterId];
  await Promise.all(
    both.map((uid) =>
      notify({
        userId: uid,
        type: "need_completed",
        title: "对接已完成",
        body: "本次需求对接已完成,请对本次交易进行评价。",
        link: "/me/matches",
        data: { matchId, needId: match.needId },
      })
    )
  );

  revalidateNeedRoutes(match.needId);
  revalidatePath("/me/matches");
  return { ok: true, completed: true };
}

/**
 * 任一参与方申请取消(MATCHED→CANCELLING + cancelledById),通知对方决定免责。
 */
export async function requestCancelNeedMatch(matchId: string): Promise<ActionResult> {
  const actor = await resolveActor();
  if ("error" in actor) return { ok: false, error: actor.error };

  const match = await prisma.needMatch.findUnique({
    where: { id: matchId },
    select: { needId: true, providerId: true, status: true },
  });
  if (!match) return { ok: false, error: "应征记录不存在" };

  const need = await prisma.need.findUnique({
    where: { id: match.needId },
    select: { requesterId: true },
  });
  if (!need) return { ok: false, error: "需求不存在" };

  const isProvider = match.providerId === actor.id;
  const isRequester = need.requesterId === actor.id;
  if (!isProvider && !isRequester) return { ok: false, error: "无权操作此应征" };
  if (match.status !== "MATCHED") {
    return { ok: false, error: "该应征当前不可取消" };
  }

  const otherId = isProvider ? need.requesterId : match.providerId;

  await prisma.needMatch.update({
    where: { id: matchId },
    data: {
      status: "CANCELLING",
      cancelledById: actor.id,
      cancelledAt: new Date(),
    },
  });
  await notify({
    userId: otherId,
    type: "need_cancel_request",
    title: "对方申请取消,请决定是否同意免责",
    body: "对方申请取消已撮合的对接,请决定是否同意免责。不同意将记对方违规。",
    link: "/me/matches",
    data: { matchId },
  });

  revalidateNeedRoutes(match.needId);
  revalidatePath("/me/matches");
  return { ok: true };
}

/**
 * 非取消方决定免责(CANCELLING→CANCELLED)。
 * - agree → liabilityAgreed=true(免责);
 * - !agree → liabilityAgreed=false,取消方违规 +1 并记录。
 */
export async function decideNeedMatchLiability(
  matchId: string,
  agree: boolean
): Promise<ActionResult> {
  const actor = await resolveActor();
  if ("error" in actor) return { ok: false, error: actor.error };

  const match = await prisma.needMatch.findUnique({
    where: { id: matchId },
    select: { needId: true, providerId: true, status: true, cancelledById: true },
  });
  if (!match) return { ok: false, error: "应征记录不存在" };
  if (match.status !== "CANCELLING") return { ok: false, error: "该应征当前不在免责协商中" };
  if (!match.cancelledById) return { ok: false, error: "该应征无需决定免责" };
  if (match.cancelledById === actor.id) {
    return { ok: false, error: "不能为自己申请的取消决定免责" };
  }

  const need = await prisma.need.findUnique({
    where: { id: match.needId },
    select: { requesterId: true },
  });
  if (!need) return { ok: false, error: "需求不存在" };
  const isParticipant = match.providerId === actor.id || need.requesterId === actor.id;
  if (!isParticipant) return { ok: false, error: "无权操作此应征" };

  const cancellerId = match.cancelledById;

  if (agree) {
    await prisma.needMatch.update({
      where: { id: matchId },
      data: {
        status: "CANCELLED",
        liabilityAgreed: true,
        liabilityDecidedAt: new Date(),
      },
    });
    await Promise.all([
      notify({
        userId: cancellerId,
        type: "need_cancel_result",
        title: "取消已免责",
        body: "对方同意免责,本次对接取消完成。",
        link: "/me/matches",
        data: { matchId },
      }),
      notify({
        userId: actor.id,
        type: "need_cancel_result",
        title: "取消已免责",
        body: "你已同意免责,本次对接取消完成。",
        link: "/me/matches",
        data: { matchId },
      }),
    ]);
  } else {
    await prisma.$transaction([
      prisma.needMatch.update({
        where: { id: matchId },
        data: {
          status: "CANCELLED",
          liabilityAgreed: false,
          liabilityDecidedAt: new Date(),
        },
      }),
      prisma.user.update({
        where: { id: cancellerId },
        data: { violationCount: { increment: 1 } },
      }),
      prisma.violation.create({
        data: {
          userId: cancellerId,
          source: "MATCH_CANCEL",
          reason: "取消已撮合的需求对接(不同意免责)",
          reference: matchId,
        },
      }),
    ]);
    await Promise.all([
      notify({
        userId: cancellerId,
        type: "need_cancel_result",
        title: "取消已记违规",
        body: "对方不同意免责,本次取消已记录一次违规。",
        link: "/me/matches",
        data: { matchId },
      }),
      notify({
        userId: actor.id,
        type: "need_cancel_result",
        title: "取消已记对方违规",
        body: "你已不同意免责,对方本次取消已记录违规。",
        link: "/me/matches",
        data: { matchId },
      }),
    ]);
  }

  revalidateNeedRoutes(match.needId);
  revalidatePath("/me/matches");
  return { ok: true };
}
