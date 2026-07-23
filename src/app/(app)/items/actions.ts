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
  itemCreateSchema,
  itemUpdateSchema,
  type ItemCreateInput,
  type ItemUpdateInput,
} from "@/lib/validation/item";

/**
 * 写入通知。直接落到 notifications 表(而非 createNotification helper)以支持 `data` 字段
 * (helper 当前不接收 data;此处不修改共享 helper)。
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

/** 重新校验受影响的缓存路由。 */
function revalidateItemRoutes(itemId?: string) {
  revalidatePath("/items");
  revalidatePath("/me/items");
  if (itemId) revalidatePath(`/items/${itemId}`);
}

/**
 * 发布物品(sellerId = 当前用户,status AVAILABLE)。
 */
export async function createItem(
  input: ItemCreateInput
): Promise<ActionResult<{ itemId: string }>> {
  const actor = await resolveActor();
  if ("error" in actor) return { ok: false, error: actor.error };

  const parsed = itemCreateSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "参数校验失败" };
  }
  const d = parsed.data;

  const item = await prisma.item.create({
    data: {
      sellerId: actor.id,
      title: d.title,
      description: d.description,
      category: d.category,
      condition: d.condition,
      priceMode: d.priceMode,
      price: d.priceMode === "SPECIFIC" ? d.price ?? null : null,
      originalPrice: d.originalPrice ?? null,
      imageKeys: d.imageKeys,
      tags: d.tags ?? [],
      tradeMethods: d.tradeMethods,
      pickupLocation: d.pickupLocation ?? null,
      contactInfo: d.contactInfo,
      contactVisibility: d.contactVisibility,
      status: "AVAILABLE",
    },
    select: { id: true },
  });

  // AI：异步入队生成向量（best-effort，绝不阻断发布；worker 去重/重试）。
  await enqueueEmbedResource("ITEM", item.id);

  revalidateItemRoutes(item.id);
  return { ok: true, itemId: item.id };
}

/**
 * 更新物品(仅卖家,且状态须为 AVAILABLE 或 PENDING)。
 */
export async function updateItem(
  itemId: string,
  input: ItemUpdateInput
): Promise<ActionResult> {
  const actor = await resolveActor();
  if ("error" in actor) return { ok: false, error: actor.error };

  const parsed = itemUpdateSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "参数校验失败" };
  }
  const d = parsed.data;

  const item = await prisma.item.findUnique({
    where: { id: itemId },
    select: { sellerId: true, status: true },
  });
  if (!item) return { ok: false, error: "物品不存在" };
  if (item.sellerId !== actor.id) return { ok: false, error: "无权操作他人物品" };
  // Pending 为内容锁定状态,不可编辑(PRD §3.2)。
  if (item.status !== "AVAILABLE") {
    return { ok: false, error: "当前状态不可编辑" };
  }

  const data: Prisma.ItemUpdateInput = {};
  if (d.title !== undefined) data.title = d.title;
  if (d.description !== undefined) data.description = d.description;
  if (d.category !== undefined) data.category = d.category;
  if (d.condition !== undefined) data.condition = d.condition;
  if (d.priceMode !== undefined) {
    data.priceMode = d.priceMode;
    data.price = d.priceMode === "SPECIFIC" ? d.price ?? null : null;
  } else if (d.price !== undefined) {
    data.price = d.price;
  }
  if (d.originalPrice !== undefined) data.originalPrice = d.originalPrice ?? null;
  if (d.imageKeys !== undefined) data.imageKeys = d.imageKeys;
  if (d.tags !== undefined) data.tags = d.tags;
  if (d.tradeMethods !== undefined) {
    data.tradeMethods = d.tradeMethods;
    if (!d.tradeMethods.includes("自提")) data.pickupLocation = null;
  }
  if (d.pickupLocation !== undefined) data.pickupLocation = d.pickupLocation ?? null;
  if (d.contactInfo !== undefined) data.contactInfo = d.contactInfo;
  if (d.contactVisibility !== undefined) data.contactVisibility = d.contactVisibility;

  await prisma.item.update({ where: { id: itemId }, data });
  await enqueueEmbedResource("ITEM", itemId);
  revalidateItemRoutes(itemId);
  return { ok: true };
}

/**
 * 关闭物品(仅卖家,仅当 AVAILABLE 时可关闭)。
 */
export async function closeItem(itemId: string): Promise<ActionResult> {
  const actor = await resolveActor();
  if ("error" in actor) return { ok: false, error: actor.error };

  const item = await prisma.item.findUnique({
    where: { id: itemId },
    select: { sellerId: true, status: true, title: true },
  });
  if (!item) return { ok: false, error: "物品不存在" };
  if (item.sellerId !== actor.id) return { ok: false, error: "无权操作他人物品" };
  if (item.status !== "AVAILABLE" && item.status !== "PENDING") {
    return { ok: false, error: "该物品当前不可下架" };
  }

  // PENDING 下架视为卖方取消交易:取消进行中的交易并通知买家,再下架(PRD §3.3)。
  if (item.status === "PENDING") {
    const deal = await prisma.itemDeal.findUnique({
      where: { itemId },
      select: { id: true, buyerId: true, status: true },
    });
    if (deal && deal.status === "PENDING") {
      await prisma.itemDeal.update({
        where: { id: deal.id },
        data: { status: "CANCELLED", cancelledById: actor.id, cancelledAt: new Date() },
      });
      await notify({
        userId: deal.buyerId,
        type: "item_cancelled",
        title: "交易已取消",
        body: `卖家已下架「${item.title}」,本次交易已取消`,
        link: "/me/items",
        data: { dealId: deal.id },
      });
    }
  }

  await prisma.item.update({
    where: { id: itemId },
    data: { status: "CLOSED" },
  });
  revalidateItemRoutes(itemId);
  return { ok: true };
}

/**
 * 卖家重新上架已关闭的物品(CLOSED→AVAILABLE)。
 */
export async function relistItem(itemId: string): Promise<ActionResult> {
  const actor = await resolveActor();
  if ("error" in actor) return { ok: false, error: actor.error };

  const item = await prisma.item.findUnique({
    where: { id: itemId },
    select: { sellerId: true, status: true },
  });
  if (!item) return { ok: false, error: "物品不存在" };
  if (item.sellerId !== actor.id) return { ok: false, error: "无权操作他人物品" };
  if (item.status !== "CLOSED") {
    return { ok: false, error: "仅已关闭的物品可重新上架" };
  }

  await prisma.item.update({
    where: { id: itemId },
    data: { status: "AVAILABLE" },
  });
  revalidateItemRoutes(itemId);
  return { ok: true };
}

/**
 * 卖家删除物品(软删除:置 deletedAt,从所有列表隐藏;PRD §10)。
 * 交易中(PENDING)的物品不可删除,需先取消交易。
 */
export async function deleteItem(itemId: string): Promise<ActionResult> {
  const actor = await resolveActor();
  if ("error" in actor) return { ok: false, error: actor.error };

  const item = await prisma.item.findUnique({
    where: { id: itemId },
    select: { sellerId: true, status: true, deletedAt: true },
  });
  if (!item) return { ok: false, error: "物品不存在" };
  if (item.sellerId !== actor.id) return { ok: false, error: "无权操作他人物品" };
  if (item.status === "PENDING") {
    return { ok: false, error: "交易中的物品不可删除,请先取消交易" };
  }
  if (item.deletedAt) return { ok: false, error: "该物品已删除" };

  await prisma.item.update({
    where: { id: itemId },
    data: { deletedAt: new Date() },
  });
  revalidateItemRoutes(itemId);
  revalidatePath("/me/items");
  return { ok: true };
}

/**
 * 表达购买意向(状态须为 AVAILABLE 或 PENDING)。通知卖家。
 */
export async function expressInterest(
  itemId: string,
  message?: string
): Promise<ActionResult> {
  const actor = await resolveActor();
  if ("error" in actor) return { ok: false, error: actor.error };

  const item = await prisma.item.findUnique({
    where: { id: itemId },
    select: { sellerId: true, status: true, title: true },
  });
  if (!item) return { ok: false, error: "物品不存在" };
  if (item.status !== "AVAILABLE" && item.status !== "PENDING") {
    return { ok: false, error: "该物品当前不可表达意向" };
  }
  if (item.sellerId === actor.id) {
    return { ok: false, error: "不能对自己的物品表达意向" };
  }

  // 仅首次表达意向时通知卖家;重复提交(改留言)不再刷"新意向人"通知,
  // 对齐 needs/actions 的 isNew 守卫,避免反复点按给卖家刷屏。
  const existing = await prisma.itemInterest.findUnique({
    where: { itemId_userId: { itemId, userId: actor.id } },
    select: { id: true },
  });

  await prisma.itemInterest.upsert({
    where: { itemId_userId: { itemId, userId: actor.id } },
    create: { itemId, userId: actor.id, message: message ?? null },
    update: { message: message ?? null },
  });

  if (!existing) {
    await notify({
      userId: item.sellerId,
      type: "item_interest",
      title: "你的物品有新意向人",
      body: `「${item.title}」收到一条新的购买意向`,
      link: `/items/${itemId}`,
    });
  }

  revalidateItemRoutes(itemId);
  return { ok: true };
}

/**
 * 卖家选定买家:取消既有 PENDING 交易 -> 新建 PENDING 交易 -> 物品置 PENDING。通知新买家(若取消旧买家则另行通知)。
 */
export async function chooseBuyer(
  itemId: string,
  buyerUserId: string
): Promise<ActionResult<{ dealId: string }>> {
  const actor = await resolveActor();
  if ("error" in actor) return { ok: false, error: actor.error };

  const item = await prisma.item.findUnique({
    where: { id: itemId },
    select: { sellerId: true, status: true, title: true },
  });
  if (!item) return { ok: false, error: "物品不存在" };
  if (item.sellerId !== actor.id) return { ok: false, error: "只有卖家可选定买家" };
  if (item.status !== "AVAILABLE" && item.status !== "PENDING") {
    return { ok: false, error: "该物品当前不可选定买家" };
  }
  if (buyerUserId === actor.id) {
    return { ok: false, error: "不能选定自己为买家" };
  }

  // 校验该用户确实表达过意向,防止对任意 userId 调用并给无关用户发"被选定"通知。
  const interest = await prisma.itemInterest.findUnique({
    where: { itemId_userId: { itemId, userId: buyerUserId } },
    select: { id: true },
  });
  if (!interest) {
    return { ok: false, error: "该用户未对你的物品表达意向" };
  }

  const deal = await prisma.$transaction(async (tx) => {
    // ItemDeal.itemId 是 @unique(1:1)。复用唯一行:存在则原地重置为新买家 + PENDING,
    // 否则新建。避免「再次选定 / 取消后重新选定」时 create 撞唯一约束(P2002)。
    const prev = await tx.itemDeal.findUnique({
      where: { itemId },
      select: { id: true, buyerId: true, status: true },
    });

    let dealId: string;
    let prevBuyerId: string | null = null;

    if (prev) {
      // 换买家且旧交易仍在进行中 → 记下旧买家用于通知。
      if (prev.status === "PENDING" && prev.buyerId !== buyerUserId) {
        prevBuyerId = prev.buyerId;
      }
      await tx.itemDeal.update({
        where: { id: prev.id },
        data: {
          buyerId: buyerUserId,
          status: "PENDING",
          firstConfirmerId: null,
          firstConfirmedAt: null,
          completedAt: null,
          cancelledById: null,
          cancelledAt: null,
        },
      });
      dealId = prev.id;
    } else {
      const created = await tx.itemDeal.create({
        data: {
          itemId,
          sellerId: actor.id,
          buyerId: buyerUserId,
          status: "PENDING",
        },
        select: { id: true },
      });
      dealId = created.id;
    }

    await tx.item.update({
      where: { id: itemId },
      data: { status: "PENDING" },
    });

    return { dealId, prevBuyerId };
  });

  // 通知旧买家(若被换下)。
  if (deal.prevBuyerId && deal.prevBuyerId !== buyerUserId) {
    await notify({
      userId: deal.prevBuyerId,
      type: "item_cancelled",
      title: "交易已取消",
      body: `卖家已选择其他买家,「${item.title}」的交易已取消`,
      link: "/me/items",
    });
  }
  // 通知新买家。
  await notify({
    userId: buyerUserId,
    type: "item_chosen",
    title: "你被选为交易对象",
    body: `卖家已选你为「${item.title}」的交易对象`,
    link: "/me/items",
    data: { itemId, dealId: deal.dealId },
  });

  revalidateItemRoutes(itemId);
  return { ok: true, dealId: deal.dealId };
}

/**
 * 确认交易完成(双方各确认一次)。第二方确认即完成,物品置 SOLD。
 */
export async function confirmItemComplete(
  dealId: string
): Promise<ActionResult<{ completed?: boolean }>> {
  const actor = await resolveActor();
  if ("error" in actor) return { ok: false, error: actor.error };

  const deal = await prisma.itemDeal.findUnique({
    where: { id: dealId },
    select: {
      id: true,
      itemId: true,
      sellerId: true,
      buyerId: true,
      status: true,
      firstConfirmerId: true,
    },
  });
  if (!deal) return { ok: false, error: "交易不存在" };
  const isParticipant = deal.sellerId === actor.id || deal.buyerId === actor.id;
  if (!isParticipant) return { ok: false, error: "无权操作此交易" };
  if (deal.status !== "PENDING") {
    return { ok: false, error: "该交易当前不可确认" };
  }

  const otherId = actor.id === deal.sellerId ? deal.buyerId : deal.sellerId;

  // 原子抢"第一确认人":仅当仍为 PENDING 且 firstConfirmerId 为 null 时成功。
  // 防止买卖双方几乎同时点确认时,两请求都读到 null 而双双走第一方分支,
  // 导致交易永久卡 PENDING(只能等 7 天 cron 兜底)。
  const claimed = await prisma.itemDeal.updateMany({
    where: { id: dealId, status: "PENDING", firstConfirmerId: null },
    data: { firstConfirmerId: actor.id, firstConfirmedAt: new Date() },
  });
  if (claimed.count > 0) {
    await notify({
      userId: otherId,
      type: "item_confirm_request",
      title: "对方已确认完成,请你确认",
      body: "对方已确认本次交易完成,请尽快确认",
      link: "/me/items",
      data: { dealId },
    });
    revalidateItemRoutes(deal.itemId);
    return { ok: true, completed: false };
  }

  // 未抢到 → 重读判定:我已确认 / 我是第二方 / 状态已变。
  const fresh = await prisma.itemDeal.findUnique({
    where: { id: dealId },
    select: { status: true, firstConfirmerId: true, itemId: true },
  });
  if (!fresh) return { ok: false, error: "交易不存在" };
  if (fresh.status !== "PENDING") {
    return { ok: false, error: "该交易当前不可确认" };
  }
  if (fresh.firstConfirmerId === actor.id) {
    return { ok: false, error: "你已确认,请等待对方确认" };
  }
  if (!fresh.firstConfirmerId) {
    return { ok: false, error: "请稍后重试" };
  }

  // 第二方确认 → 完成。(事务超时已在 db.ts 全局放宽,适配 Neon 延迟。)
  await prisma.$transaction([
    prisma.itemDeal.update({
      where: { id: dealId },
      data: { status: "COMPLETED", completedAt: new Date() },
    }),
    prisma.item.update({
      where: { id: fresh.itemId },
      data: { status: "SOLD" },
    }),
  ]);

  const both = [deal.sellerId, deal.buyerId];
  await Promise.all(
    both.map((uid) =>
      notify({
        userId: uid,
        type: "item_completed",
        title: "交易已完成",
        body: "交易已完成,请对本次交易进行评价",
        link: "/me/items",
        data: { dealId, itemId: deal.itemId },
      })
    )
  );

  // 通知其余意向人:物品已售出(给他们闭环,而非无声等待)。
  const otherInterestHolders = await prisma.itemInterest.findMany({
    where: { itemId: deal.itemId, userId: { notIn: [deal.sellerId, deal.buyerId] } },
    select: { userId: true },
  });
  await Promise.all(
    otherInterestHolders.map((it) =>
      notify({
        userId: it.userId,
        type: "item_sold_out",
        title: "你想要的物品已售出",
        body: "你之前表达过意向的物品已被他人买下",
        link: "/me/items",
      })
    )
  );

  revalidateItemRoutes(deal.itemId);
  return { ok: true, completed: true };
}

/**
 * 取消交易(任一参与方)。物品置 AVAILABLE,通知对方与所有意向人。
 */
export async function cancelItemDeal(dealId: string): Promise<ActionResult> {
  const actor = await resolveActor();
  if ("error" in actor) return { ok: false, error: actor.error };

  const deal = await prisma.itemDeal.findUnique({
    where: { id: dealId },
    select: {
      id: true,
      itemId: true,
      sellerId: true,
      buyerId: true,
      status: true,
    },
  });
  if (!deal) return { ok: false, error: "交易不存在" };
  const isParticipant = deal.sellerId === actor.id || deal.buyerId === actor.id;
  if (!isParticipant) return { ok: false, error: "无权操作此交易" };
  if (deal.status !== "PENDING") {
    return { ok: false, error: "该交易当前不可取消" };
  }

  const otherId = actor.id === deal.sellerId ? deal.buyerId : deal.sellerId;

  await prisma.$transaction([
    prisma.itemDeal.update({
      where: { id: dealId },
      data: { status: "CANCELLED", cancelledById: actor.id, cancelledAt: new Date() },
    }),
    prisma.item.update({
      where: { id: deal.itemId },
      data: { status: "AVAILABLE" },
    }),
  ]);

  // 通知对方。
  await notify({
    userId: otherId,
    type: "item_cancelled",
    title: "交易已取消",
    body: "本次交易已被对方取消",
    link: "/me/items",
    data: { dealId },
  });

  // 通知所有意向人:物品重新可购买。
  const interests = await prisma.itemInterest.findMany({
    where: { itemId: deal.itemId, userId: { notIn: [actor.id] } },
    select: { userId: true },
  });
  await Promise.all(
    interests.map((it) =>
      notify({
        userId: it.userId,
        type: "item_available_again",
        title: "你关注的物品重新可购买",
        body: "你之前表达过意向的物品已重新上架",
        link: `/items/${deal.itemId}`,
      })
    )
  );

  revalidateItemRoutes(deal.itemId);
  return { ok: true };
}
