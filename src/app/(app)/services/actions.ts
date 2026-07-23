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
  serviceCreateSchema,
  serviceUpdateSchema,
  slotCreateSchema,
  type ServiceCreateInput,
  type ServiceUpdateInput,
} from "@/lib/validation/service";

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

function revalidateServiceRoutes(serviceId?: string) {
  revalidatePath("/services");
  revalidatePath("/me/services");
  revalidatePath("/me/bookings");
  if (serviceId) revalidatePath(`/services/${serviceId}`);
}

// ───────────────────────── 服务生命周期 ─────────────────────────

/**
 * 发布服务(providerId = 当前用户,status ACTIVE)。
 */
export async function createService(
  input: ServiceCreateInput
): Promise<ActionResult<{ serviceId: string }>> {
  const actor = await resolveActor();
  if ("error" in actor) return { ok: false, error: actor.error };

  const parsed = serviceCreateSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "参数校验失败" };
  }
  const d = parsed.data;

  const service = await prisma.service.create({
    data: {
      providerId: actor.id,
      title: d.title,
      description: d.description,
      qualification: d.qualification,
      proofImageKeys: d.proofImageKeys,
      categories: d.categories,
      formats: d.formats,
      durationTier: d.durationTier ?? null,
      price: d.price,
      contactInfo: d.contactInfo,
      contactVisibility: d.contactVisibility,
      status: "ACTIVE",
    },
    select: { id: true },
  });

  // AI：异步入队生成向量（best-effort）。
  await enqueueEmbedResource("SERVICE", service.id);

  revalidateServiceRoutes(service.id);
  return { ok: true, serviceId: service.id };
}

/**
 * 更新服务(仅提供者,且状态须为 ACTIVE 或 PAUSED)。
 */
export async function updateService(
  serviceId: string,
  input: ServiceUpdateInput
): Promise<ActionResult> {
  const actor = await resolveActor();
  if ("error" in actor) return { ok: false, error: actor.error };

  const parsed = serviceUpdateSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "参数校验失败" };
  }
  const d = parsed.data;

  const service = await prisma.service.findUnique({
    where: { id: serviceId },
    select: { providerId: true, status: true },
  });
  if (!service) return { ok: false, error: "服务不存在" };
  if (service.providerId !== actor.id) return { ok: false, error: "无权操作他人服务" };
  if (service.status !== "ACTIVE" && service.status !== "PAUSED") {
    return { ok: false, error: "当前状态不可编辑" };
  }

  const data: Prisma.ServiceUpdateInput = {};
  if (d.title !== undefined) data.title = d.title;
  if (d.description !== undefined) data.description = d.description;
  if (d.qualification !== undefined) data.qualification = d.qualification;
  if (d.proofImageKeys !== undefined) data.proofImageKeys = d.proofImageKeys;
  if (d.categories !== undefined) data.categories = d.categories;
  if (d.formats !== undefined) data.formats = d.formats;
  if (d.durationTier !== undefined) data.durationTier = d.durationTier ?? null;
  if (d.price !== undefined) data.price = d.price;
  if (d.contactInfo !== undefined) data.contactInfo = d.contactInfo;
  if (d.contactVisibility !== undefined) data.contactVisibility = d.contactVisibility;

  await prisma.service.update({ where: { id: serviceId }, data });
  await enqueueEmbedResource("SERVICE", serviceId);
  revalidateServiceRoutes(serviceId);
  return { ok: true };
}

/** 暂停服务(仅提供者,ACTIVE→PAUSED)。 */
export async function pauseService(serviceId: string): Promise<ActionResult> {
  const actor = await resolveActor();
  if ("error" in actor) return { ok: false, error: actor.error };

  const service = await prisma.service.findUnique({
    where: { id: serviceId },
    select: { providerId: true, status: true },
  });
  if (!service) return { ok: false, error: "服务不存在" };
  if (service.providerId !== actor.id) return { ok: false, error: "无权操作他人服务" };
  if (service.status !== "ACTIVE") return { ok: false, error: "仅上架中的服务可暂停" };

  await prisma.service.update({
    where: { id: serviceId },
    data: { status: "PAUSED" },
  });
  revalidateServiceRoutes(serviceId);
  return { ok: true };
}

/** 恢复服务(仅提供者,PAUSED→ACTIVE)。 */
export async function resumeService(serviceId: string): Promise<ActionResult> {
  const actor = await resolveActor();
  if ("error" in actor) return { ok: false, error: actor.error };

  const service = await prisma.service.findUnique({
    where: { id: serviceId },
    select: { providerId: true, status: true },
  });
  if (!service) return { ok: false, error: "服务不存在" };
  if (service.providerId !== actor.id) return { ok: false, error: "无权操作他人服务" };
  if (service.status !== "PAUSED") return { ok: false, error: "仅已暂停的服务可恢复" };

  await prisma.service.update({
    where: { id: serviceId },
    data: { status: "ACTIVE" },
  });
  revalidateServiceRoutes(serviceId);
  return { ok: true };
}

/** 关闭服务(仅提供者,→CLOSED)。 */
export async function closeService(serviceId: string): Promise<ActionResult> {
  const actor = await resolveActor();
  if ("error" in actor) return { ok: false, error: actor.error };

  const service = await prisma.service.findUnique({
    where: { id: serviceId },
    select: { providerId: true, status: true },
  });
  if (!service) return { ok: false, error: "服务不存在" };
  if (service.providerId !== actor.id) return { ok: false, error: "无权操作他人服务" };
  if (service.status === "CLOSED") return { ok: false, error: "服务已关闭" };

  await prisma.service.update({
    where: { id: serviceId },
    data: { status: "CLOSED" },
  });
  revalidateServiceRoutes(serviceId);
  return { ok: true };
}

// ───────────────────────── 时段 ─────────────────────────

/** 新增可预约时段(仅提供者,唯一 [serviceId,startAt,endAt])。 */
export async function addServiceSlot(
  serviceId: string,
  startAt: string,
  endAt: string
): Promise<ActionResult> {
  const actor = await resolveActor();
  if ("error" in actor) return { ok: false, error: actor.error };

  const parsed = slotCreateSchema.safeParse({ startAt, endAt });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "参数校验失败" };
  }

  const service = await prisma.service.findUnique({
    where: { id: serviceId },
    select: { providerId: true, status: true },
  });
  if (!service) return { ok: false, error: "服务不存在" };
  if (service.providerId !== actor.id) return { ok: false, error: "无权操作他人服务" };
  if (service.status === "CLOSED") {
    return { ok: false, error: "已关闭的服务不可修改时段" };
  }

  // 时段重叠检查:与现有时段时间区间相交则拒绝(防重复/嵌套时段)。
  const newStart = new Date(parsed.data.startAt);
  const newEnd = new Date(parsed.data.endAt);
  const overlap = await prisma.serviceSlot.findFirst({
    where: { serviceId, startAt: { lt: newEnd }, endAt: { gt: newStart } },
    select: { id: true },
  });
  if (overlap) return { ok: false, error: "时段与现有时段重叠" };

  try {
    await prisma.serviceSlot.create({
      data: {
        serviceId,
        startAt: new Date(parsed.data.startAt),
        endAt: new Date(parsed.data.endAt),
      },
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return { ok: false, error: "该时段已存在" };
    }
    throw e;
  }

  revalidateServiceRoutes(serviceId);
  return { ok: true };
}

/** 移除可预约时段(仅提供者;仅当无 PENDING/CONFIRMED 预约占用时)。 */
export async function removeServiceSlot(
  serviceId: string,
  slotId: string
): Promise<ActionResult> {
  const actor = await resolveActor();
  if ("error" in actor) return { ok: false, error: actor.error };

  const service = await prisma.service.findUnique({
    where: { id: serviceId },
    select: { providerId: true, status: true },
  });
  if (!service) return { ok: false, error: "服务不存在" };
  if (service.providerId !== actor.id) return { ok: false, error: "无权操作他人服务" };
  if (service.status === "CLOSED") {
    return { ok: false, error: "已关闭的服务不可修改时段" };
  }

  const inUse = await prisma.booking.findFirst({
    where: { slotId, status: { in: ["PENDING", "CONFIRMED", "CANCELLING"] } },
    select: { id: true },
  });
  if (inUse) return { ok: false, error: "该时段已有预约占用,无法移除" };

  await prisma.serviceSlot.delete({ where: { id: slotId } });
  revalidateServiceRoutes(serviceId);
  return { ok: true };
}

// ───────────────────────── 预约 ─────────────────────────

/** 预约者的预约请求(任意已认证用户 ≠ 提供者)。 */
export async function createBooking(
  serviceId: string,
  input: { slotId?: string | null; slotStart: string; slotEnd: string; note?: string }
): Promise<ActionResult<{ bookingId: string }>> {
  const actor = await resolveActor();
  if ("error" in actor) return { ok: false, error: actor.error };

  const startMs = Date.parse(input.slotStart);
  const endMs = Date.parse(input.slotEnd);
  if (Number.isNaN(startMs) || Number.isNaN(endMs)) {
    return { ok: false, error: "时间格式不正确" };
  }
  if (endMs <= startMs) return { ok: false, error: "结束时间须晚于开始时间" };
  // 不可预约过去的时间。
  if (startMs <= Date.now()) return { ok: false, error: "不能预约过去的时间" };

  const service = await prisma.service.findUnique({
    where: { id: serviceId },
    select: { providerId: true, status: true, title: true },
  });
  if (!service) return { ok: false, error: "服务不存在" };
  if (service.status !== "ACTIVE") return { ok: false, error: "该服务当前不可预约" };
  if (service.providerId === actor.id) {
    return { ok: false, error: "不能预约自己的服务" };
  }

  // 占用检查:同一 slot 的进行中预约,或时间窗口重叠的进行中预约,均视为冲突。
  const start = new Date(startMs);
  const end = new Date(endMs);
  const overlapWhere: Prisma.BookingWhereInput = {
    serviceId,
    status: { in: ["PENDING", "CONFIRMED", "CANCELLING"] },
    OR: [
      ...(input.slotId ? [{ slotId: input.slotId }] : []),
      { slotStart: { lt: end }, slotEnd: { gt: start } },
    ],
  };
  const conflict = await prisma.booking.findFirst({
    where: overlapWhere,
    select: { id: true },
  });
  if (conflict) return { ok: false, error: "该时段已被预约" };

  // 必填简述需求(服务端校验,防绕过前端)。
  const note = (input.note ?? "").trim();
  if (!note) return { ok: false, error: "请填写简述需求" };

  const booking = await prisma.booking.create({
    data: {
      serviceId,
      slotId: input.slotId ?? null,
      slotStart: start,
      slotEnd: end,
      clientId: actor.id,
      note,
      status: "PENDING",
    },
    select: { id: true },
  });

  await notify({
    userId: service.providerId,
    type: "service_new_booking",
    title: "你的服务有新预约",
    body: `「${service.title}」收到一条新的预约请求`,
    link: `/services/${serviceId}`,
    data: { bookingId: booking.id, serviceId },
  });

  revalidateServiceRoutes(serviceId);
  revalidatePath("/me/bookings");
  return { ok: true, bookingId: booking.id };
}

/** 提供者确认预约(PENDING→CONFIRMED)。 */
export async function confirmBooking(bookingId: string): Promise<ActionResult> {
  const actor = await resolveActor();
  if ("error" in actor) return { ok: false, error: actor.error };

  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: { serviceId: true, status: true, clientId: true },
  });
  if (!booking) return { ok: false, error: "预约不存在" };

  const service = await prisma.service.findUnique({
    where: { id: booking.serviceId },
    select: { providerId: true, title: true },
  });
  if (!service) return { ok: false, error: "服务不存在" };
  if (service.providerId !== actor.id) return { ok: false, error: "只有服务提供者可确认预约" };
  if (booking.status !== "PENDING") return { ok: false, error: "该预约当前不可确认" };

  await prisma.booking.update({
    where: { id: bookingId },
    data: { status: "CONFIRMED" },
  });

  await notify({
    userId: booking.clientId,
    type: "service_booking_confirmed",
    title: "预约已确认",
    body: `「${service.title}」服务提供者已确认你的预约`,
    link: "/me/bookings",
    data: { bookingId },
  });

  revalidateServiceRoutes(booking.serviceId);
  revalidatePath("/me/bookings");
  return { ok: true };
}

/** 提供者拒绝预约(PENDING→REJECTED + rejectReason)。 */
export async function rejectBooking(
  bookingId: string,
  reason: string
): Promise<ActionResult> {
  const actor = await resolveActor();
  if ("error" in actor) return { ok: false, error: actor.error };

  const trimmed = (reason ?? "").trim();
  if (!trimmed) return { ok: false, error: "请填写拒绝原因" };

  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: { serviceId: true, status: true, clientId: true },
  });
  if (!booking) return { ok: false, error: "预约不存在" };

  const service = await prisma.service.findUnique({
    where: { id: booking.serviceId },
    select: { providerId: true, title: true },
  });
  if (!service) return { ok: false, error: "服务不存在" };
  if (service.providerId !== actor.id) return { ok: false, error: "只有服务提供者可拒绝预约" };
  if (booking.status !== "PENDING") return { ok: false, error: "该预约当前不可拒绝" };

  await prisma.booking.update({
    where: { id: bookingId },
    data: { status: "REJECTED", rejectReason: trimmed },
  });

  await notify({
    userId: booking.clientId,
    type: "service_booking_rejected",
    title: "预约已被拒绝",
    body: `「${service.title}」服务提供者拒绝了你的预约:${trimmed}`,
    link: "/me/bookings",
    data: { bookingId },
  });

  revalidateServiceRoutes(booking.serviceId);
  revalidatePath("/me/bookings");
  return { ok: true };
}

/**
 * 任一参与方申请取消。
 * - PENDING → CANCELLED(免责);
 * - CONFIRMED → CANCELLING,等待对方决定免责。
 */
export async function requestCancelBooking(bookingId: string): Promise<ActionResult> {
  const actor = await resolveActor();
  if ("error" in actor) return { ok: false, error: actor.error };

  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: { serviceId: true, status: true, clientId: true, cancelledById: true },
  });
  if (!booking) return { ok: false, error: "预约不存在" };

  const service = await prisma.service.findUnique({
    where: { id: booking.serviceId },
    select: { providerId: true },
  });
  if (!service) return { ok: false, error: "服务不存在" };

  const isClient = booking.clientId === actor.id;
  const isProvider = service.providerId === actor.id;
  if (!isClient && !isProvider) return { ok: false, error: "无权操作此预约" };
  if (booking.status === "CANCELLED" || booking.status === "COMPLETED" || booking.status === "REJECTED") {
    return { ok: false, error: "该预约当前不可取消" };
  }
  // 已在免责协商中:仅原取消方可重复进入(视为等待),其他方应改用「同意/不同意免责」。
  if (booking.status === "CANCELLING") {
    if (booking.cancelledById && booking.cancelledById !== actor.id) {
      return { ok: false, error: "对方已申请取消,请选择同意或不同意免责" };
    }
    return { ok: false, error: "你已申请取消,请等待对方决定" };
  }

  const otherId = isClient ? service.providerId : booking.clientId;

  // PENDING 直接免责取消。
  if (booking.status === "PENDING") {
    await prisma.booking.update({
      where: { id: bookingId },
      data: {
        status: "CANCELLED",
        cancelledById: actor.id,
        cancelledAt: new Date(),
        liabilityAgreed: true,
        liabilityDecidedAt: new Date(),
      },
    });
    await notify({
      userId: otherId,
      type: "service_cancelled",
      title: "预约已取消",
      body: "对方取消了本次预约(尚未确认,免责取消)",
      link: "/me/bookings",
      data: { bookingId },
    });
    revalidateServiceRoutes(booking.serviceId);
    revalidatePath("/me/bookings");
    return { ok: true };
  }

  // CONFIRMED / CANCELLING → 进入免责协商。
  await prisma.booking.update({
    where: { id: bookingId },
    data: {
      status: "CANCELLING",
      cancelledById: actor.id,
      cancelledAt: new Date(),
    },
  });
  await notify({
    userId: otherId,
    type: "service_cancel_request",
    title: "对方申请取消,请决定是否同意免责",
    body: "对方申请取消已确认的预约,请决定是否同意免责。不同意将记对方违规。",
    link: "/me/bookings",
    data: { bookingId },
  });

  revalidateServiceRoutes(booking.serviceId);
  revalidatePath("/me/bookings");
  return { ok: true };
}

/**
 * 非取消方决定免责(CANCELLING→CANCELLED)。
 * - agree → liabilityAgreed=true(免责);
 * - !agree → liabilityAgreed=false,取消方违规 +1 并记录。
 */
export async function decideBookingLiability(
  bookingId: string,
  agree: boolean
): Promise<ActionResult> {
  const actor = await resolveActor();
  if ("error" in actor) return { ok: false, error: actor.error };

  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: { serviceId: true, status: true, clientId: true, cancelledById: true },
  });
  if (!booking) return { ok: false, error: "预约不存在" };
  if (booking.status !== "CANCELLING") return { ok: false, error: "该预约当前不在免责协商中" };
  if (!booking.cancelledById) return { ok: false, error: "该预约无需决定免责" };
  if (booking.cancelledById === actor.id) {
    return { ok: false, error: "不能为自己申请的取消决定免责" };
  }

  const service = await prisma.service.findUnique({
    where: { id: booking.serviceId },
    select: { providerId: true },
  });
  if (!service) return { ok: false, error: "服务不存在" };
  const isParticipant = booking.clientId === actor.id || service.providerId === actor.id;
  if (!isParticipant) return { ok: false, error: "无权操作此预约" };

  const cancellerId = booking.cancelledById;

  if (agree) {
    await prisma.booking.update({
      where: { id: bookingId },
      data: {
        status: "CANCELLED",
        liabilityAgreed: true,
        liabilityDecidedAt: new Date(),
      },
    });
    await Promise.all([
      notify({
        userId: cancellerId,
        type: "service_cancel_result",
        title: "取消已免责",
        body: "对方同意免责,本次预约取消完成。",
        link: "/me/bookings",
        data: { bookingId },
      }),
      notify({
        userId: actor.id,
        type: "service_cancel_result",
        title: "取消已免责",
        body: "你已同意免责,本次预约取消完成。",
        link: "/me/bookings",
        data: { bookingId },
      }),
    ]);
  } else {
    await prisma.$transaction([
      prisma.booking.update({
        where: { id: bookingId },
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
          source: "BOOKING_CANCEL",
          reason: "取消已确认的服务预约(不同意免责)",
          reference: bookingId,
        },
      }),
    ]);
    await Promise.all([
      notify({
        userId: cancellerId,
        type: "service_cancel_result",
        title: "取消已记违规",
        body: "对方不同意免责,本次取消已记录一次违规。",
        link: "/me/bookings",
        data: { bookingId },
      }),
      notify({
        userId: actor.id,
        type: "service_cancel_result",
        title: "取消已记对方违规",
        body: "你已不同意免责,对方本次取消已记录违规。",
        link: "/me/bookings",
        data: { bookingId },
      }),
    ]);
  }

  revalidateServiceRoutes(booking.serviceId);
  revalidatePath("/me/bookings");
  return { ok: true };
}

/**
 * 取消方撤回取消(CANCELLING→CONFIRMED,清空 cancelledBy*)。
 * 用于误点「申请取消」后回退,使预约恢复进行(非硬终止)。仅取消发起方可撤回。
 */
export async function resumeBooking(bookingId: string): Promise<ActionResult> {
  const actor = await resolveActor();
  if ("error" in actor) return { ok: false, error: actor.error };

  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: { serviceId: true, status: true, clientId: true, cancelledById: true },
  });
  if (!booking) return { ok: false, error: "预约不存在" };
  if (booking.status !== "CANCELLING") {
    return { ok: false, error: "该预约当前不在取消协商中" };
  }
  if (booking.cancelledById !== actor.id) {
    return { ok: false, error: "只有取消发起方可撤回取消" };
  }

  const service = await prisma.service.findUnique({
    where: { id: booking.serviceId },
    select: { providerId: true },
  });
  if (!service) return { ok: false, error: "服务不存在" };

  await prisma.booking.update({
    where: { id: bookingId },
    data: {
      status: "CONFIRMED",
      cancelledById: null,
      cancelledAt: null,
      liabilityAgreed: null,
      liabilityDecidedAt: null,
    },
  });

  const otherId = actor.id === booking.clientId ? service.providerId : booking.clientId;
  await notify({
    userId: otherId,
    type: "service_cancel_withdrawn",
    title: "对方已撤回取消",
    body: "对方撤回了本次取消申请,预约继续进行。",
    link: "/me/bookings",
    data: { bookingId },
  });

  revalidateServiceRoutes(booking.serviceId);
  revalidatePath("/me/bookings");
  return { ok: true };
}

/**
 * 任一参与方确认完成(双方各确认一次)。
 * - 第一方 → 设置 firstConfirmer,通知对方;
 * - 第二方 → COMPLETED,通知双方评价。
 */
export async function confirmBookingComplete(
  bookingId: string
): Promise<ActionResult<{ completed?: boolean }>> {
  const actor = await resolveActor();
  if ("error" in actor) return { ok: false, error: actor.error };

  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: {
      serviceId: true,
      clientId: true,
      status: true,
      firstConfirmerId: true,
    },
  });
  if (!booking) return { ok: false, error: "预约不存在" };

  const service = await prisma.service.findUnique({
    where: { id: booking.serviceId },
    select: { providerId: true },
  });
  if (!service) return { ok: false, error: "服务不存在" };
  const isParticipant = booking.clientId === actor.id || service.providerId === actor.id;
  if (!isParticipant) return { ok: false, error: "无权操作此预约" };
  if (booking.status !== "CONFIRMED") {
    return { ok: false, error: "该预约当前不可确认完成" };
  }

  const otherId = actor.id === booking.clientId ? service.providerId : booking.clientId;

  // 原子抢"第一确认人":仅当仍为 CONFIRMED 且 firstConfirmerId 为 null 时成功(防并发双首确认竞态)。
  const claimed = await prisma.booking.updateMany({
    where: { id: bookingId, status: "CONFIRMED", firstConfirmerId: null },
    data: { firstConfirmerId: actor.id, firstConfirmedAt: new Date() },
  });
  if (claimed.count > 0) {
    await notify({
      userId: otherId,
      type: "service_confirm_request",
      title: "对方已确认完成,请你确认",
      body: "对方已确认本次服务完成,请尽快确认。",
      link: "/me/bookings",
      data: { bookingId },
    });
    revalidateServiceRoutes(booking.serviceId);
    revalidatePath("/me/bookings");
    return { ok: true, completed: false };
  }

  // 未抢到 → 重读判定:我已确认 / 我是第二方 / 状态已变。
  const fresh = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: { status: true, firstConfirmerId: true },
  });
  if (!fresh) return { ok: false, error: "预约不存在" };
  if (fresh.status !== "CONFIRMED") {
    return { ok: false, error: "该预约当前不可确认完成" };
  }
  if (fresh.firstConfirmerId === actor.id) {
    return { ok: false, error: "你已确认,请等待对方确认" };
  }
  if (!fresh.firstConfirmerId) {
    return { ok: false, error: "请稍后重试" };
  }

  // 第二方确认 → 完成。
  await prisma.booking.update({
    where: { id: bookingId },
    data: { status: "COMPLETED", completedAt: new Date() },
  });

  const both = [booking.clientId, service.providerId];
  await Promise.all(
    both.map((uid) =>
      notify({
        userId: uid,
        type: "service_completed",
        title: "服务已完成",
        body: "本次服务已完成,请对本次交易进行评价",
        link: "/me/bookings",
        data: { bookingId, serviceId: booking.serviceId },
      })
    )
  );

  revalidateServiceRoutes(booking.serviceId);
  revalidatePath("/me/bookings");
  return { ok: true, completed: true };
}
