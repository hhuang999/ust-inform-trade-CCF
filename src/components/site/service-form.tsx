"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import {
  ImagePlus,
  Loader2,
  Info,
  Upload,
  X,
} from "lucide-react";

import { cn } from "@/lib/utils";
import {
  SERVICE_CATEGORIES,
  SERVICE_FORMATS,
  DURATION_TIERS,
  CONTACT_VISIBILITIES,
} from "@/lib/constants/service";
import {
  serviceCreateSchema,
  serviceUpdateSchema,
  type ServiceCreateInput,
  type ServiceUpdateInput,
} from "@/lib/validation/service";
import { createService, updateService } from "@/app/(app)/services/actions";
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

const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5MB
const MAX_IMAGES = 9;
const DRAFT_KEY = "service-draft";

/** 已上传/已选中的资质证明图片(本地预览 URL + R2 key)。 */
interface ImageEntry {
  key: string;
  url: string;
  uploading?: boolean;
  progress?: number;
}

type ContactVisibility = (typeof CONTACT_VISIBILITIES)[number];

/** 编辑模式回填的初始值。 */
export interface ServiceFormInitial {
  title: string;
  description: string;
  qualification: string;
  proofImageKeys: string[];
  categories: string[];
  formats: string[];
  durationTier?: string | null;
  price: string;
  contactInfo: string;
  contactVisibility: ContactVisibility;
}

interface ServiceFormProps {
  mode: "create" | "edit";
  serviceId?: string;
  initial?: ServiceFormInitial;
  /** 当前用户 id:create 模式下用于按用户隔离草稿,避免共享设备跨账号泄露。 */
  userId?: string;
  /** AI 草稿入口是否开启（服务端页面据 AI_DRAFT_ENABLED 传入）。 */
  aiDraftEnabled?: boolean;
}

interface FormValues {
  title: string;
  description: string;
  qualification: string;
  proofImageKeys: string[];
  categories: string[];
  formats: string[];
  durationTier?: string | null;
  price: string;
  contactInfo: string;
  contactVisibility: ContactVisibility;
}

const R2_PUBLIC_BASE = process.env.NEXT_PUBLIC_R2_PUBLIC_BASE_URL ?? "";

function keyToUrl(key: string): string {
  return R2_PUBLIC_BASE ? `${R2_PUBLIC_BASE}/${key}` : key;
}

// ───────────────────────── 组件 ─────────────────────────

export default function ServiceForm({
  mode,
  serviceId,
  initial,
  userId,
  aiDraftEnabled,
}: ServiceFormProps) {
  const router = useRouter();
  const isEdit = mode === "edit";
  // 草稿按用户隔离:共享设备切换账号时不会读到他人草稿。
  const draftKey = userId ? `${DRAFT_KEY}:${userId}` : DRAFT_KEY;

  // 资质图片状态独立于 RHF,便于逐张管理上传进度。
  const [images, setImages] = React.useState<ImageEntry[]>(() => {
    if (initial?.proofImageKeys?.length) {
      return initial.proofImageKeys.map((k) => ({ key: k, url: keyToUrl(k) }));
    }
    return [];
  });
  const [imageUploading, setImageUploading] = React.useState(false);
  const imageInputRef = React.useRef<HTMLInputElement>(null);

  // 草稿恢复提示
  const [draftOpen, setDraftOpen] = React.useState(false);
  const [draftData, setDraftData] = React.useState<Partial<FormValues> | null>(null);

  const resolver = isEdit
    ? zodResolver(serviceUpdateSchema)
    : zodResolver(serviceCreateSchema);

  const defaultValues: FormValues = React.useMemo(
    () =>
      initial
        ? {
            title: initial.title,
            description: initial.description,
            qualification: initial.qualification,
            proofImageKeys: initial.proofImageKeys,
            categories: initial.categories,
            formats: initial.formats,
            durationTier: initial.durationTier ?? null,
            price: initial.price,
            contactInfo: initial.contactInfo,
            contactVisibility: initial.contactVisibility,
          }
        : {
            title: "",
            description: "",
            qualification: "",
            proofImageKeys: [],
            categories: [],
            formats: [],
            durationTier: null,
            price: "",
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

  const categories = watch("categories");
  const formats = watch("formats");
  const titleValue = watch("title");
  const descValue = watch("description");
  const qualValue = watch("qualification");

  // ── 草稿恢复(create 模式) ──
  React.useEffect(() => {
    if (isEdit) return;
    try {
      const raw = window.localStorage.getItem(draftKey);
      if (!raw) return;
      const parsed = JSON.parse(raw) as {
        values: Partial<FormValues>;
      };
      if (parsed?.values && Object.keys(parsed.values).length > 0) {
        setDraftData(parsed.values);
        setDraftOpen(true);
      }
    } catch {
      // 损坏的草稿直接忽略
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function applyDraft() {
    if (!draftData) return;
    const restoredImages =
      (draftData as FormValues & { proofImageKeys?: string[] }).proofImageKeys ??
      [];
    if (restoredImages.length > 0) {
      const entries = restoredImages.map((k) => ({ key: k, url: keyToUrl(k) }));
      setImages(entries);
      setValue("proofImageKeys", restoredImages);
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
            values: { ...value, proofImageKeys: images.map((i) => i.key) },
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

  // ── 资质图片上传 ──
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

    const placeholders: ImageEntry[] = valid.map((f) => ({
      key: `pending-${crypto.randomUUID()}`,
      url: URL.createObjectURL(f),
      uploading: true,
      progress: 10,
    }));
    setImages((prev) => [...prev, ...placeholders]);

    for (let i = 0; i < valid.length; i++) {
      const file = valid[i];
      const presigned = await getPresign(file);
      if (!presigned) {
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

  // proofImageKeys 同步进 RHF。
  React.useEffect(() => {
    const keys = images.map((i) => i.key).filter((k) => !k.startsWith("pending-"));
    setValue("proofImageKeys", keys, { shouldDirty: true });
  }, [images, setValue]);

  // ── 分类/形式(多选) ──
  function toggleCategory(value: string) {
    const current = getValues("categories") ?? [];
    const next = current.includes(value)
      ? current.filter((m) => m !== value)
      : [...current, value];
    setValue("categories", next, { shouldDirty: true });
  }

  function toggleFormat(value: string) {
    const current = getValues("formats") ?? [];
    const next = current.includes(value)
      ? current.filter((m) => m !== value)
      : [...current, value];
    setValue("formats", next, { shouldDirty: true });
  }

  // ── 提交 ──
  const onSubmit = handleSubmit(async (values) => {
    if (images.some((i) => i.uploading)) {
      toast.error("请等待图片上传完成");
      return;
    }

    if (isEdit) {
      const res = await updateService(serviceId!, values as ServiceUpdateInput);
      if (res.ok) {
        toast.success("保存成功");
        clearDraft();
        router.push(`/services/${serviceId}`);
      } else {
        toast.error(res.error);
        if (res.error.includes("资质")) setError("qualification", { message: res.error });
        if (res.error.includes("价格")) setError("price", { message: res.error });
        if (res.error.includes("联系")) setError("contactInfo", { message: res.error });
      }
    } else {
      const res = await createService(values as ServiceCreateInput);
      if (res.ok && res.serviceId) {
        toast.success("发布成功");
        clearDraft();
        router.push(`/services/${res.serviceId}`);
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
            type="SERVICE"
            onApply={(partial) => applyDraftToForm(setValue as never, partial)}
          />
        ) : null}
        {/* 基本信息 */}
        <Card>
          <CardHeader>
            <CardTitle className="font-serif text-lg">基本信息</CardTitle>
            <CardDescription>服务的核心描述信息</CardDescription>
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
                placeholder="例如:高数期末冲刺一对一辅导"
                aria-invalid={!!errors.title}
                {...register("title")}
              />
            </Field>

            <Field
              label="服务描述"
              htmlFor="description"
              hint={`${(descValue ?? "").length}/2000`}
              error={errors.description?.message}
            >
              <Textarea
                id="description"
                rows={5}
                maxLength={2000}
                placeholder="描述你能提供什么服务、面向人群、可帮到的程度等"
                aria-invalid={!!errors.description}
                {...register("description")}
              />
            </Field>

            <div className="flex items-start gap-2 rounded-lg bg-accent/50 px-3.5 py-3 text-xs text-muted-foreground ring-1 ring-inset ring-outline-variant/30">
              <Info className="mt-0.5 size-4 shrink-0 text-primary" />
              <span>发布后可在详情页添加可预约时段。</span>
            </div>
          </CardContent>
        </Card>

        {/* 资质与证明 */}
        <Card>
          <CardHeader>
            <CardTitle className="font-serif text-lg">资质与证明</CardTitle>
            <CardDescription>说明你的能力,并上传佐证图片</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <Field
              label="资质说明"
              htmlFor="qualification"
              hint={`${(qualValue ?? "").length}/1000`}
              error={errors.qualification?.message}
            >
              <Textarea
                id="qualification"
                rows={4}
                maxLength={1000}
                placeholder="例如:曾获校高数竞赛一等奖 / 执有日语 N1 证书 / 3 年家教经验"
                aria-invalid={!!errors.qualification}
                {...register("qualification")}
              />
            </Field>

            <input
              ref={imageInputRef}
              type="file"
              accept="image/*"
              multiple
              onChange={handleImages}
              className="hidden"
            />
            <div>
              <Field
                label="证明图片(选填)"
                hint={`最多 ${MAX_IMAGES} 张,单张 ≤ 5MB`}
                error={errors.proofImageKeys?.message}
              >
                <></>
              </Field>
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                {images.map((img, i) => (
                  <div
                    key={img.key}
                    className="group relative aspect-square overflow-hidden rounded-lg border border-outline-variant/40 bg-accent shadow-sm"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={img.url}
                      alt={`证明图 ${i + 1}`}
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
            </div>
          </CardContent>
        </Card>

        {/* 服务形式 */}
        <Card>
          <CardHeader>
            <CardTitle className="font-serif text-lg">服务形式</CardTitle>
            <CardDescription>分类、形式、时长与定价</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <Field
              label="服务分类"
              hint="至少选择一个"
              error={errors.categories?.message}
            >
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {SERVICE_CATEGORIES.map((c) => {
                  const checked = categories?.includes(c);
                  return (
                    <label
                      key={c}
                      className={cn(
                        "flex cursor-pointer items-center gap-2.5 rounded-lg border border-input bg-card px-3.5 py-2.5 text-sm transition-colors hover:bg-accent/50",
                        checked && "border-primary/60 ring-1 ring-inset ring-primary/30"
                      )}
                    >
                      <Checkbox
                        checked={checked}
                        onCheckedChange={() => toggleCategory(c)}
                      />
                      <span className="font-medium">{c}</span>
                    </label>
                  );
                })}
              </div>
            </Field>

            <Field
              label="服务形式"
              hint="至少选择一种"
              error={errors.formats?.message}
            >
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {SERVICE_FORMATS.map((f) => {
                  const checked = formats?.includes(f);
                  return (
                    <label
                      key={f}
                      className={cn(
                        "flex cursor-pointer items-center gap-2.5 rounded-lg border border-input bg-card px-3.5 py-2.5 text-sm transition-colors hover:bg-accent/50",
                        checked && "border-primary/60 ring-1 ring-inset ring-primary/30"
                      )}
                    >
                      <Checkbox
                        checked={checked}
                        onCheckedChange={() => toggleFormat(f)}
                      />
                      <span className="font-medium">{f}</span>
                    </label>
                  );
                })}
              </div>
            </Field>

            <div className="grid gap-5 sm:grid-cols-2">
              <Field
                label="服务时长(选填)"
                error={errors.durationTier?.message}
              >
                <Controller
                  control={control}
                  name="durationTier"
                  render={({ field }) => (
                    <Select
                      value={field.value ?? undefined}
                      onValueChange={(v) => field.onChange(v)}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="选择单次时长" />
                      </SelectTrigger>
                      <SelectContent>
                        {DURATION_TIERS.map((t) => (
                          <SelectItem key={t} value={t}>
                            {t}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
              </Field>

              <Field
                label="价格说明"
                htmlFor="price"
                hint="1-100 字,如:50元/小时"
                error={errors.price?.message}
              >
                <Input
                  id="price"
                  maxLength={100}
                  placeholder="例如:50元/小时 或 面议"
                  aria-invalid={!!errors.price}
                  {...register("price")}
                />
              </Field>
            </div>
          </CardContent>
        </Card>

        {/* 联系方式 */}
        <Card>
          <CardHeader>
            <CardTitle className="font-serif text-lg">联系方式</CardTitle>
            <CardDescription>有需求的人与你取得联系的方式</CardDescription>
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
                      htmlFor="svc-vis-VERIFIED_ONLY"
                      className={cn(
                        "flex cursor-pointer items-center gap-2.5 rounded-lg border border-input bg-card px-3.5 py-2.5 text-sm transition-colors hover:bg-accent/50",
                        field.value === "VERIFIED_ONLY" &&
                          "border-primary/60 ring-1 ring-inset ring-primary/30"
                      )}
                    >
                      <RadioGroupItem
                        id="svc-vis-VERIFIED_ONLY"
                        value="VERIFIED_ONLY"
                      />
                      <span className="font-medium">仅认证用户可见</span>
                    </label>
                    <label
                      htmlFor="svc-vis-ALL"
                      className={cn(
                        "flex cursor-pointer items-center gap-2.5 rounded-lg border border-input bg-card px-3.5 py-2.5 text-sm transition-colors hover:bg-accent/50",
                        field.value === "ALL" &&
                          "border-primary/60 ring-1 ring-inset ring-primary/30"
                      )}
                    >
                      <RadioGroupItem id="svc-vis-ALL" value="ALL" />
                      <span className="font-medium">所有人可见</span>
                    </label>
                  </RadioGroup>
                )}
              />
            </Field>
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
