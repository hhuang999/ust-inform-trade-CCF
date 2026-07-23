"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import {
  ImagePlus,
  Loader2,
  Plus,
  Tag,
  Upload,
  X,
} from "lucide-react";

import { cn } from "@/lib/utils";
import {
  ITEM_CATEGORIES,
  ITEM_CONDITIONS,
  TRADE_METHODS,
  PRICE_MODES,
  CONTACT_VISIBILITIES,
} from "@/lib/constants/item";
import {
  itemCreateSchema,
  itemUpdateSchema,
  type ItemCreateInput,
  type ItemUpdateInput,
} from "@/lib/validation/item";
import { createItem, updateItem } from "@/app/(app)/items/actions";
import { AiDraftPanel, applyDraftToForm } from "@/components/ai/ai-draft-panel";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input, Textarea, Field } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Checkbox } from "@/components/ui/checkbox";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

// ───────────────────────── 类型与常量 ─────────────────────────

const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5MB,与后端 MAX_IMAGE_BYTES 一致
const MAX_IMAGES = 9;
const MAX_TAGS = 8;
const DRAFT_KEY = "item-draft";

/** 已上传/已选中的图片(本地预览 URL + R2 key)。 */
interface ImageEntry {
  key: string;
  url: string;
  /** 是否为本地 blob 预览(用于决定上传成功后是否替换为公开 URL)。 */
  uploading?: boolean;
  progress?: number;
}

/** 编辑模式回填的初始值。 */
export interface ItemFormInitial {
  title: string;
  description: string;
  category: string;
  condition: string;
  priceMode: "SPECIFIC" | "FREE" | "NEGOTIABLE";
  price?: number | null;
  originalPrice?: number | null;
  imageKeys: string[];
  tags: string[];
  tradeMethods: string[];
  pickupLocation: string;
  contactInfo: string;
  contactVisibility: "VERIFIED_ONLY" | "ALL";
}

interface ItemFormProps {
  mode: "create" | "edit";
  itemId?: string;
  initial?: ItemFormInitial;
  /** 当前用户 id:create 模式下用于按用户隔离草稿,避免共享设备跨账号泄露。 */
  userId?: string;
  /** AI 草稿入口是否开启（服务端页面据 AI_DRAFT_ENABLED 传入）。 */
  aiDraftEnabled?: boolean;
}

interface FormValues {
  title: string;
  description: string;
  category: string;
  condition: string;
  priceMode: "SPECIFIC" | "FREE" | "NEGOTIABLE";
  price?: number | null;
  originalPrice?: number | null;
  imageKeys: string[];
  tags: string[];
  tradeMethods: string[];
  pickupLocation?: string;
  contactInfo: string;
  contactVisibility: "VERIFIED_ONLY" | "ALL";
}

const R2_PUBLIC_BASE = process.env.NEXT_PUBLIC_R2_PUBLIC_BASE_URL ?? "";

function keyToUrl(key: string): string {
  return R2_PUBLIC_BASE ? `${R2_PUBLIC_BASE}/${key}` : key;
}

// ───────────────────────── 组件 ─────────────────────────

export default function ItemForm({ mode, itemId, initial, userId, aiDraftEnabled }: ItemFormProps) {
  const router = useRouter();
  const isEdit = mode === "edit";
  // 草稿按用户隔离:共享设备切换账号时不会读到他人草稿(含联系方式等隐私)。
  const draftKey = userId ? `${DRAFT_KEY}:${userId}` : DRAFT_KEY;

  // 图片状态独立于 RHF,便于逐张管理上传进度。
  const [images, setImages] = React.useState<ImageEntry[]>(() => {
    if (initial?.imageKeys?.length) {
      return initial.imageKeys.map((k) => ({ key: k, url: keyToUrl(k) }));
    }
    return [];
  });
  const [imageUploading, setImageUploading] = React.useState(false);
  const imageInputRef = React.useRef<HTMLInputElement>(null);

  // 标签输入
  const [tagInput, setTagInput] = React.useState("");

  // 草稿恢复提示
  const [draftOpen, setDraftOpen] = React.useState(false);
  const [draftData, setDraftData] = React.useState<Partial<FormValues> | null>(null);

  const resolver = isEdit ? zodResolver(itemUpdateSchema) : zodResolver(itemCreateSchema);

  const defaultValues: FormValues = React.useMemo(
    () =>
      initial
        ? {
            title: initial.title,
            description: initial.description,
            category: initial.category,
            condition: initial.condition,
            priceMode: initial.priceMode,
            price: initial.price ?? null,
            originalPrice: initial.originalPrice ?? null,
            imageKeys: initial.imageKeys,
            tags: initial.tags,
            tradeMethods: initial.tradeMethods,
            pickupLocation: initial.pickupLocation || "",
            contactInfo: initial.contactInfo,
            contactVisibility: initial.contactVisibility,
          }
        : {
            title: "",
            description: "",
            category: ITEM_CATEGORIES[0] as string,
            condition: ITEM_CONDITIONS[0] as string,
            priceMode: "SPECIFIC",
            price: null,
            originalPrice: null,
            imageKeys: [],
            tags: [],
            tradeMethods: [],
            pickupLocation: "",
            contactInfo: "",
            contactVisibility: "VERIFIED_ONLY",
          },
    [initial]
  );

  const {
    register,
    handleSubmit,
    control,
    setValue,
    getValues,
    watch,
    reset,
    setError,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<FormValues>({
    resolver: resolver as never,
    defaultValues,
    mode: "onSubmit",
  });

  const priceMode = watch("priceMode");
  const tradeMethods = watch("tradeMethods");
  const tags = watch("tags");
  const titleValue = watch("title");
  const descValue = watch("description");

  // ── 草稿恢复(create 模式) ──
  React.useEffect(() => {
    if (isEdit) return;
    try {
      const raw = window.localStorage.getItem(draftKey);
      if (!raw) return;
      const parsed = JSON.parse(raw) as {
        values: Partial<FormValues>;
        imageKeys?: string[];
      };
      if (parsed?.values && Object.keys(parsed.values).length > 0) {
        setDraftData(parsed.values);
        setDraftOpen(true);
      }
    } catch {
      // 损坏的草稿直接忽略
    }
    // 仅在挂载时执行一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function applyDraft() {
    if (!draftData) return;
    // 草稿里保留的 imageKeys 也一并恢复为图片项。
    const restoredImages =
      (draftData as FormValues & { imageKeys?: string[] }).imageKeys ?? [];
    if (restoredImages.length > 0) {
      const entries = restoredImages.map((k) => ({ key: k, url: keyToUrl(k) }));
      setImages(entries);
      setValue("imageKeys", restoredImages);
    }
    reset({ ...defaultValues, ...draftData } as FormValues);
    setDraftOpen(false);
    setDraftData(null);
    toast.info("已恢复上次未完成的内容");
  }

  function discardDraft() {
    clearDraft();
    setDraftOpen(false);
    setDraftData(null);
  }

  function clearDraft() {
    try {
      window.localStorage.removeItem(draftKey);
    } catch {
      /* ignore */
    }
  }

  // ── 草稿自动保存(debounce,仅 create) ──
  React.useEffect(() => {
    if (isEdit) return;
    const subscription = watch((value) => {
      // 仅在表单真正变脏后才写草稿,避免一进页面就以默认值写入、下次进入误弹"恢复"。
      if (!isDirty) return;
      const t = setTimeout(() => {
        try {
          const snapshot = {
            values: { ...value, imageKeys: images.map((i) => i.key) },
          };
          window.localStorage.setItem(draftKey, JSON.stringify(snapshot));
        } catch {
          /* localStorage 不可用时静默 */
        }
      }, 800);
      return () => clearTimeout(t);
    });
    return () => subscription.unsubscribe();
  }, [watch, images, isEdit, isDirty, draftKey]);

  // ── 图片上传 ──
  function validateImage(file: File): boolean {
    if (!file.type.startsWith("image/")) {
      toast.error("仅支持图片格式");
      return false;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      toast.error("图片过大，请压缩到 5MB 以内");
      return false;
    }
    return true;
  }

  async function getPresign(
    file: File
  ): Promise<{ url: string; key: string } | null> {
    try {
      const res = await fetch("/api/upload-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ purpose: "item", contentType: file.type }),
      });
      if (!res.ok) throw new Error("presign failed");
      return (await res.json()) as { url: string; key: string };
    } catch {
      toast.error("无法获取上传凭证，请稍后再试");
      return null;
    }
  }

  /** R2 不支持 presigned POST,改用预签名 PUT 直传(带签名 Content-Type)。 */
  async function uploadToR2(url: string, file: File): Promise<boolean> {
    try {
      const res = await fetch(url, {
        method: "PUT",
        body: file,
        headers: { "Content-Type": file.type },
      });
      if (!res.ok) throw new Error("upload failed");
      return true;
    } catch {
      return false;
    }
  }

  async function handleImages(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files.length === 0) return;

    const currentCount = images.length;
    const room = MAX_IMAGES - currentCount;
    if (room <= 0) {
      toast.error(`最多 ${MAX_IMAGES} 张图片`);
      return;
    }
    const valid = files.filter(validateImage).slice(0, room);
    if (valid.length === 0) return;
    if (files.length > room) {
      toast.error(`最多 ${MAX_IMAGES} 张图片，已截断`);
    }

    setImageUploading(true);

    // 先放入「上传中」占位项,提升纸感即时反馈。
    const placeholders: ImageEntry[] = valid.map((f) => ({
      key: `pending-${crypto.randomUUID()}`,
      url: URL.createObjectURL(f),
      uploading: true,
      progress: 10,
    }));
    setImages((prev) => [...prev, ...placeholders]);

    // 逐张上传(顺序,避免 R2 限流)。
    for (let i = 0; i < valid.length; i++) {
      const file = valid[i];
      const idx = currentCount + i;
      const presigned = await getPresign(file);
      if (!presigned) {
        // 移除该占位项
        setImages((prev) => prev.filter((img) => img.key !== placeholders[i].key));
        toast.error("图片上传失败，请重试");
        continue;
      }
      const ok = await uploadToR2(presigned.url, file);
      if (ok) {
        setImages((prev) => {
          const next = [...prev];
          const target = next.findIndex((img) => img.key === placeholders[i].key);
          if (target >= 0) {
            // 释放 blob,改用公开 URL
            URL.revokeObjectURL(placeholders[i].url);
            next[target] = {
              key: presigned.key,
              url: keyToUrl(presigned.key),
              uploading: false,
              progress: 100,
            };
          }
          return next;
        });
      } else {
        setImages((prev) => {
          const target = prev.findIndex((img) => img.key === placeholders[i].key);
          if (target >= 0) URL.revokeObjectURL(prev[target].url);
          return prev.filter((img) => img.key !== placeholders[i].key);
        });
        toast.error(`「${file.name}」上传失败，请重试`);
      }
    }

    setImageUploading(false);
  }

  function removeImage(idx: number) {
    setImages((prev) => {
      const next = [...prev];
      const [removed] = next.splice(idx, 1);
      if (removed?.url?.startsWith("blob:")) URL.revokeObjectURL(removed.url);
      return next;
    });
  }

  // imageKeys 同步进 RHF(用于校验与提交)。
  React.useEffect(() => {
    const keys = images.map((i) => i.key).filter((k) => !k.startsWith("pending-"));
    setValue("imageKeys", keys, { shouldDirty: true });
  }, [images, setValue]);

  // ── 标签 ──
  function addTag(raw: string) {
    const v = raw.trim();
    if (!v) return;
    const current = getValues("tags") ?? [];
    if (current.includes(v)) {
      setTagInput("");
      return;
    }
    if (current.length >= MAX_TAGS) {
      toast.error(`标签最多 ${MAX_TAGS} 个`);
      return;
    }
    setValue("tags", [...current, v], { shouldDirty: true });
    setTagInput("");
  }

  function removeTag(t: string) {
    const current = getValues("tags") ?? [];
    setValue(
      "tags",
      current.filter((x) => x !== t),
      { shouldDirty: true }
    );
  }

  function handleTagKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addTag(tagInput);
    } else if (e.key === "Backspace" && tagInput === "") {
      const current = getValues("tags") ?? [];
      if (current.length > 0) removeTag(current[current.length - 1]);
    }
  }

  // ── 交易方式 ──
  function toggleTradeMethod(method: string) {
    const current = getValues("tradeMethods") ?? [];
    const next = current.includes(method)
      ? current.filter((m) => m !== method)
      : [...current, method];
    setValue("tradeMethods", next, { shouldDirty: true });
  }

  // ── 提交 ──
  const onSubmit = handleSubmit(async (values) => {
    // 再次确认无上传中的图片
    if (images.some((i) => i.uploading)) {
      toast.error("请等待图片上传完成");
      return;
    }

    // 价格模式联动:非 SPECIFIC 时清空 price。
    const payload: FormValues = {
      ...values,
      price: values.priceMode === "SPECIFIC" ? values.price : undefined,
      pickupLocation:
        (values.tradeMethods ?? []).includes("自提") ? values.pickupLocation : undefined,
    };

    if (isEdit) {
      const res = await updateItem(itemId!, payload as ItemUpdateInput);
      if (res.ok) {
        toast.success("保存成功");
        clearDraft();
        router.push(`/items/${itemId}`);
      } else {
        toast.error(res.error);
        if (res.error.includes("价格")) setError("price", { message: res.error });
        if (res.error.includes("自提"))
          setError("pickupLocation", { message: res.error });
      }
    } else {
      const res = await createItem(payload as ItemCreateInput);
      if (res.ok && res.itemId) {
        toast.success("发布成功");
        clearDraft();
        router.push(`/items/${res.itemId}`);
      } else {
        toast.error((res as { error: string }).error);
      }
    }
  });

  const submitting = isSubmitting || imageUploading;

  // ───────────────────────── 渲染 ─────────────────────────
  return (
    <>
      {/* 草稿恢复弹窗 */}
      <AlertDialog open={draftOpen} onOpenChange={setDraftOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>恢复上次未完成的内容？</AlertDialogTitle>
            <AlertDialogDescription>
              检测到一份未完成的草稿。恢复后将填充到表单,你也可以丢弃后重新开始。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={discardDraft}>丢弃</AlertDialogCancel>
            <AlertDialogAction onClick={applyDraft}>恢复</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <form onSubmit={onSubmit} className="space-y-6">
        {aiDraftEnabled ? (
          <AiDraftPanel
            type="ITEM"
            imageKeys={images
              .filter((i) => !i.key.startsWith("pending-"))
              .map((i) => i.key)}
            onApply={(partial) => applyDraftToForm(setValue as never, partial)}
          />
        ) : null}
        {/* 基本信息 */}
        <Card>
          <CardHeader>
            <CardTitle className="font-serif text-lg">基本信息</CardTitle>
            <CardDescription>物品的核心描述信息</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <Field
              label="标题"
              htmlFor="title"
              hint={`${(titleValue ?? "").length}/50`}
              error={errors.title?.message}
            >
              <Input
                id="title"
                maxLength={50}
                placeholder="例如:九成新 iPad Air"
                aria-invalid={!!errors.title}
                {...register("title")}
              />
            </Field>

            <Field
              label="描述"
              htmlFor="description"
              hint={`${(descValue ?? "").length}/2000`}
              error={errors.description?.message}
            >
              <Textarea
                id="description"
                rows={5}
                maxLength={2000}
                placeholder="描述成色、配件、使用时长等"
                aria-invalid={!!errors.description}
                {...register("description")}
              />
            </Field>

            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="分类" error={errors.category?.message}>
                <Controller
                  control={control}
                  name="category"
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger>
                        <SelectValue placeholder="选择分类" />
                      </SelectTrigger>
                      <SelectContent>
                        {ITEM_CATEGORIES.map((c) => (
                          <SelectItem key={c} value={c}>
                            {c}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
              </Field>

              <Field label="成色" error={errors.condition?.message}>
                <Controller
                  control={control}
                  name="condition"
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger>
                        <SelectValue placeholder="选择成色" />
                      </SelectTrigger>
                      <SelectContent>
                        {ITEM_CONDITIONS.map((c) => (
                          <SelectItem key={c} value={c}>
                            {c}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
              </Field>
            </div>
          </CardContent>
        </Card>

        {/* 价格 */}
        <Card>
          <CardHeader>
            <CardTitle className="font-serif text-lg">价格</CardTitle>
            <CardDescription>设置出售价格或交易方式</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <Field label="价格模式" error={errors.priceMode?.message}>
              <Controller
                control={control}
                name="priceMode"
                render={({ field }) => (
                  <RadioGroup
                    value={field.value}
                    onValueChange={field.onChange}
                    className="grid grid-cols-1 gap-2 sm:grid-cols-3"
                  >
                    {PRICE_MODES.map((m) => (
                      <label
                        key={m.value}
                        htmlFor={`priceMode-${m.value}`}
                        className={cn(
                          "flex cursor-pointer items-center gap-2.5 rounded-lg border border-input bg-card px-3.5 py-2.5 text-sm transition-colors hover:bg-accent/50",
                          field.value === m.value &&
                            "border-primary/60 ring-1 ring-inset ring-primary/30"
                        )}
                      >
                        <RadioGroupItem id={`priceMode-${m.value}`} value={m.value} />
                        <span className="font-medium">{m.label}</span>
                      </label>
                    ))}
                  </RadioGroup>
                )}
              />
            </Field>

            {priceMode === "SPECIFIC" ? (
              <div className="grid gap-5 sm:grid-cols-2">
                <Field
                  label="售价(元)"
                  htmlFor="price"
                  hint="整数,单位元"
                  error={errors.price?.message}
                >
                  <Input
                    id="price"
                    type="number"
                    inputMode="numeric"
                    min={0}
                    step={1}
                    placeholder="例如:1200"
                    aria-invalid={!!errors.price}
                    {...register("price", {
                      setValueAs: (v) => {
                        if (v === "" || v === null || v === undefined) return undefined;
                        const n = typeof v === "number" ? v : Number(v);
                        return Number.isFinite(n) ? n : undefined;
                      },
                    })}
                  />
                </Field>
                <Field
                  label="原价(选填)"
                  htmlFor="originalPrice"
                  hint="用于展示折扣"
                  error={errors.originalPrice?.message}
                >
                  <Input
                    id="originalPrice"
                    type="number"
                    inputMode="numeric"
                    min={0}
                    step={1}
                    placeholder="例如:3500"
                    {...register("originalPrice", {
                      setValueAs: (v) => {
                        if (v === "" || v === null || v === undefined) return undefined;
                        const n = typeof v === "number" ? v : Number(v);
                        return Number.isFinite(n) ? n : undefined;
                      },
                    })}
                  />
                </Field>
              </div>
            ) : null}
          </CardContent>
        </Card>

        {/* 图片 */}
        <Card>
          <CardHeader>
            <CardTitle className="font-serif text-lg">图片</CardTitle>
            <CardDescription>至少 1 张,最多 9 张,单张 ≤ 5MB</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <input
              ref={imageInputRef}
              type="file"
              accept="image/*"
              multiple
              onChange={handleImages}
              className="hidden"
            />
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
              {images.map((img, i) => (
                <div
                  key={img.key}
                  className="group relative aspect-square overflow-hidden rounded-lg border border-outline-variant/40 bg-accent shadow-sm"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={img.url}
                    alt={`图片 ${i + 1}`}
                    className="size-full object-cover"
                  />
                  {img.uploading ? (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 bg-background/70">
                      <Loader2 className="size-5 animate-spin text-primary" />
                      {typeof img.progress === "number" ? (
                        <Progress value={img.progress} className="h-1 max-w-[70%]" />
                      ) : null}
                    </div>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => removeImage(i)}
                    className="absolute right-1 top-1 flex size-6 items-center justify-center rounded-full bg-background/90 text-foreground/70 shadow-sm ring-1 ring-outline-variant/40 transition-colors hover:bg-background hover:text-destructive active:scale-95"
                    aria-label="移除图片"
                  >
                    <X className="size-3.5" />
                  </button>
                </div>
              ))}

              {images.length < MAX_IMAGES ? (
                <button
                  type="button"
                  onClick={() => imageInputRef.current?.click()}
                  disabled={imageUploading}
                  className={cn(
                    "flex aspect-square cursor-pointer flex-col items-center justify-center gap-1.5 rounded-lg border-2 border-dashed border-outline-variant bg-card text-muted-foreground transition-colors",
                    "hover:border-primary/50 hover:bg-accent/40 active:scale-[0.99]",
                    imageUploading && "pointer-events-none opacity-60"
                  )}
                >
                  {imageUploading ? (
                    <Loader2 className="size-5 animate-spin text-primary" />
                  ) : (
                    <ImagePlus className="size-5" />
                  )}
                  <span className="text-xs font-medium">
                    {imageUploading ? "上传中" : "添加图片"}
                  </span>
                </button>
              ) : null}
            </div>

            {errors.imageKeys?.message ? (
              <p className="text-xs font-medium text-destructive">
                {errors.imageKeys.message}
              </p>
            ) : null}
          </CardContent>
        </Card>

        {/* 交易 */}
        <Card>
          <CardHeader>
            <CardTitle className="font-serif text-lg">交易</CardTitle>
            <CardDescription>选择支持的交易方式与地点</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <Field label="交易方式" hint="至少选择一种" error={errors.tradeMethods?.message}>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                {TRADE_METHODS.map((m) => {
                  const checked = tradeMethods?.includes(m);
                  return (
                    <label
                      key={m}
                      className={cn(
                        "flex cursor-pointer items-center gap-2.5 rounded-lg border border-input bg-card px-3.5 py-2.5 text-sm transition-colors hover:bg-accent/50",
                        checked &&
                          "border-primary/60 ring-1 ring-inset ring-primary/30"
                      )}
                    >
                      <Checkbox
                        checked={checked}
                        onCheckedChange={() => toggleTradeMethod(m)}
                      />
                      <span className="font-medium">{m}</span>
                    </label>
                  );
                })}
              </div>
            </Field>

            {tradeMethods?.includes("自提") ? (
              <Field
                label="自提地点"
                htmlFor="pickupLocation"
                hint="例如:图书馆一楼大厅"
                error={errors.pickupLocation?.message}
              >
                <Input
                  id="pickupLocation"
                  maxLength={200}
                  placeholder="填写自提地点"
                  aria-invalid={!!errors.pickupLocation}
                  {...register("pickupLocation")}
                />
              </Field>
            ) : null}
          </CardContent>
        </Card>

        {/* 联系方式 */}
        <Card>
          <CardHeader>
            <CardTitle className="font-serif text-lg">联系方式</CardTitle>
            <CardDescription>买家与你取得联系的方式</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <Field
              label="联系方式"
              htmlFor="contactInfo"
              hint="例如:微信 / 手机号"
              error={errors.contactInfo?.message}
            >
              <Textarea
                id="contactInfo"
                rows={2}
                maxLength={200}
                placeholder="填写联系方式"
                aria-invalid={!!errors.contactInfo}
                {...register("contactInfo")}
              />
            </Field>

            <Field
              label="可见性"
              hint="控制谁能看到你的联系方式"
              error={errors.contactVisibility?.message}
            >
              <Controller
                control={control}
                name="contactVisibility"
                render={({ field }) => (
                  <RadioGroup
                    value={field.value}
                    onValueChange={field.onChange}
                    className="grid grid-cols-1 gap-2 sm:grid-cols-2"
                  >
                    <label
                      htmlFor="vis-VERIFIED_ONLY"
                      className={cn(
                        "flex cursor-pointer items-center gap-2.5 rounded-lg border border-input bg-card px-3.5 py-2.5 text-sm transition-colors hover:bg-accent/50",
                        field.value === "VERIFIED_ONLY" &&
                          "border-primary/60 ring-1 ring-inset ring-primary/30"
                      )}
                    >
                      <RadioGroupItem id="vis-VERIFIED_ONLY" value="VERIFIED_ONLY" />
                      <span className="font-medium">仅认证用户可见</span>
                    </label>
                    <label
                      htmlFor="vis-ALL"
                      className={cn(
                        "flex cursor-pointer items-center gap-2.5 rounded-lg border border-input bg-card px-3.5 py-2.5 text-sm transition-colors hover:bg-accent/50",
                        field.value === "ALL" &&
                          "border-primary/60 ring-1 ring-inset ring-primary/30"
                      )}
                    >
                      <RadioGroupItem id="vis-ALL" value="ALL" />
                      <span className="font-medium">所有人可见</span>
                    </label>
                  </RadioGroup>
                )}
              />
            </Field>
          </CardContent>
        </Card>

        {/* 标签 */}
        <Card>
          <CardHeader>
            <CardTitle className="font-serif text-lg">标签</CardTitle>
            <CardDescription>最多 {MAX_TAGS} 个,输入后回车添加</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Tag className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  onKeyDown={handleTagKeyDown}
                  placeholder="输入标签后回车"
                  className="pl-9"
                />
              </div>
              <Button
                type="button"
                variant="outline"
                onClick={() => addTag(tagInput)}
                disabled={!tagInput.trim() || (tags?.length ?? 0) >= MAX_TAGS}
              >
                <Plus />
                添加
              </Button>
            </div>
            {tags && tags.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {tags.map((t) => (
                  <span
                    key={t}
                    className="inline-flex items-center gap-1.5 rounded-full bg-accent px-3 py-1 text-xs font-medium text-foreground ring-1 ring-inset ring-outline-variant/40"
                  >
                    {t}
                    <button
                      type="button"
                      onClick={() => removeTag(t)}
                      className="text-muted-foreground transition-colors hover:text-destructive"
                      aria-label={`移除标签 ${t}`}
                    >
                      <X className="size-3" />
                    </button>
                  </span>
                ))}
              </div>
            ) : null}
          </CardContent>
        </Card>

        {/* 操作栏 */}
        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <Button
            type="button"
            variant="outline"
            onClick={() => router.back()}
            disabled={submitting}
          >
            取消
          </Button>
          <Button type="submit" disabled={submitting} className="active:scale-[0.98]">
            {submitting ? (
              <>
                <Loader2 className="animate-spin" />
                {isEdit ? "保存中…" : "发布中…"}
              </>
            ) : (
              <>
                <Upload />
                {isEdit ? "保存修改" : "发布"}
              </>
            )}
          </Button>
        </div>
      </form>
    </>
  );
}
