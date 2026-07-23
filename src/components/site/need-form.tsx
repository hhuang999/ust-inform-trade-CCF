"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Loader2, Upload } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  NEED_CATEGORIES,
  NEED_FORMAT_PREFERENCES,
  EXPECTED_TIMES,
  CONTACT_VISIBILITIES,
} from "@/lib/constants/need";
import {
  needCreateSchema,
  needUpdateSchema,
  type NeedCreateInput,
  type NeedUpdateInput,
} from "@/lib/validation/need";
import { createNeed, updateNeed } from "@/app/(app)/needs/actions";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
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

const DRAFT_KEY = "need-draft";

type ContactVisibility = (typeof CONTACT_VISIBILITIES)[number];
type ExpectedTime = (typeof EXPECTED_TIMES)[number]["value"];
type FormatPreference = (typeof NEED_FORMAT_PREFERENCES)[number];

/** 编辑模式回填的初始值。 */
export interface NeedFormInitial {
  title: string;
  description: string;
  expectedProfile?: string | null;
  reward: string;
  expectedTime: ExpectedTime;
  formatPreference: FormatPreference;
  category: string;
  contactInfo: string;
  contactVisibility: ContactVisibility;
}

interface NeedFormProps {
  mode: "create" | "edit";
  needId?: string;
  initial?: NeedFormInitial;
  /** 当前用户 id:create 模式下用于按用户隔离草稿,避免共享设备跨账号泄露。 */
  userId?: string;
  /** AI 草稿入口是否开启（服务端页面据 AI_DRAFT_ENABLED 传入）。 */
  aiDraftEnabled?: boolean;
}

interface FormValues {
  title: string;
  description: string;
  expectedProfile?: string | null;
  reward: string;
  expectedTime: ExpectedTime;
  formatPreference: FormatPreference;
  category: string;
  contactInfo: string;
  contactVisibility: ContactVisibility;
}

// ───────────────────────── 组件 ─────────────────────────

export default function NeedForm({ mode, needId, initial, userId, aiDraftEnabled }: NeedFormProps) {
  const router = useRouter();
  const isEdit = mode === "edit";
  // 草稿按用户隔离:共享设备切换账号时不会读到他人草稿。
  const draftKey = userId ? `${DRAFT_KEY}:${userId}` : DRAFT_KEY;

  // 草稿恢复提示
  const [draftOpen, setDraftOpen] = React.useState(false);
  const [draftData, setDraftData] = React.useState<Partial<FormValues> | null>(null);

  const resolver = isEdit
    ? zodResolver(needUpdateSchema)
    : zodResolver(needCreateSchema);

  const defaultValues: FormValues = React.useMemo(
    () =>
      initial
        ? {
            title: initial.title,
            description: initial.description,
            expectedProfile: initial.expectedProfile ?? "",
            reward: initial.reward,
            expectedTime: initial.expectedTime,
            formatPreference: initial.formatPreference,
            category: initial.category,
            contactInfo: initial.contactInfo,
            contactVisibility: initial.contactVisibility,
          }
        : {
            title: "",
            description: "",
            expectedProfile: "",
            reward: "",
            expectedTime: "ASAP",
            formatPreference: "都可以",
            category: NEED_CATEGORIES[0] as string,
            contactInfo: "",
            contactVisibility: "VERIFIED_ONLY",
          },
    [initial]
  );

  const {
    register,
    handleSubmit,
    control,
    watch,
    setValue,
    reset,
    setError,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<FormValues>({
    resolver: resolver as never,
    defaultValues,
    mode: "onSubmit",
  });

  const titleValue = watch("title");
  const descValue = watch("description");
  const profileValue = watch("expectedProfile");

  // ── 草稿恢复(create 模式) ──
  React.useEffect(() => {
    if (isEdit) return;
    try {
      const raw = window.localStorage.getItem(draftKey);
      if (!raw) return;
      const parsed = JSON.parse(raw) as { values: Partial<FormValues> };
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
          window.localStorage.setItem(
            draftKey,
            JSON.stringify({ values: value })
          );
        } catch {
          /* localStorage 不可用时静默 */
        }
      }, 800);
      return () => clearTimeout(t);
    });
    return () => subscription.unsubscribe();
  }, [watch, isEdit, isDirty, draftKey]);

  // ── 提交 ──
  const onSubmit = handleSubmit(async (values) => {
    if (isEdit) {
      const res = await updateNeed(needId!, values as NeedUpdateInput);
      if (res.ok) {
        toast.success("保存成功");
        clearDraft();
        router.push(`/needs/${needId}`);
      } else {
        toast.error(res.error);
        if (res.error.includes("报酬")) setError("reward", { message: res.error });
        if (res.error.includes("联系")) setError("contactInfo", { message: res.error });
      }
    } else {
      const res = await createNeed(values as NeedCreateInput);
      if (res.ok && res.needId) {
        toast.success("发布成功");
        clearDraft();
        router.push(`/needs/${res.needId}`);
      } else {
        toast.error((res as { error: string }).error);
      }
    }
  });

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
            type="NEED"
            onApply={(partial) => applyDraftToForm(setValue as never, partial)}
          />
        ) : null}
        {/* 基本信息 */}
        <Card>
          <CardHeader>
            <CardTitle className="font-serif text-lg">基本信息</CardTitle>
            <CardDescription>需求的核心描述信息</CardDescription>
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
                placeholder="例如:求一位能教 Python 入门的同学"
                aria-invalid={!!errors.title}
                {...register("title")}
              />
            </Field>

            <Field
              label="需求描述"
              htmlFor="description"
              hint={`${(descValue ?? "").length}/2000`}
              error={errors.description?.message}
            >
              <Textarea
                id="description"
                rows={5}
                maxLength={2000}
                placeholder="描述你需要什么帮助、当前情况、希望达到的目标等"
                aria-invalid={!!errors.description}
                {...register("description")}
              />
            </Field>

            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="需求分类" error={errors.category?.message}>
                <Controller
                  control={control}
                  name="category"
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger>
                        <SelectValue placeholder="选择分类" />
                      </SelectTrigger>
                      <SelectContent>
                        {NEED_CATEGORIES.map((c) => (
                          <SelectItem key={c} value={c}>
                            {c}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
              </Field>

              <Field
                label="报酬说明"
                htmlFor="reward"
                hint="1-200 字,如:50元/小时 或 面议"
                error={errors.reward?.message}
              >
                <Input
                  id="reward"
                  maxLength={200}
                  placeholder="例如:50元/小时 或 请喝奶茶"
                  aria-invalid={!!errors.reward}
                  {...register("reward")}
                />
              </Field>
            </div>
          </CardContent>
        </Card>

        {/* 期望 */}
        <Card>
          <CardHeader>
            <CardTitle className="font-serif text-lg">期望</CardTitle>
            <CardDescription>对接对象的画像、时间与形式</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <Field
              label="期望画像(选填)"
              htmlFor="expectedProfile"
              hint={`${(profileValue ?? "").length}/500`}
              error={errors.expectedProfile?.message}
            >
              <Textarea
                id="expectedProfile"
                rows={3}
                maxLength={500}
                placeholder="例如:希望有家教经验、有耐心,能讲清基础概念"
                aria-invalid={!!errors.expectedProfile}
                {...register("expectedProfile")}
              />
            </Field>

            <Field
              label="期望完成时间"
              error={errors.expectedTime?.message}
            >
              <Controller
                control={control}
                name="expectedTime"
                render={({ field }) => (
                  <RadioGroup
                    value={field.value}
                    onValueChange={field.onChange}
                    className="grid grid-cols-1 gap-2 sm:grid-cols-4"
                  >
                    {EXPECTED_TIMES.map((t) => (
                      <label
                        key={t.value}
                        htmlFor={`et-${t.value}`}
                        className={cn(
                          "flex cursor-pointer items-center gap-2.5 rounded-lg border border-input bg-card px-3.5 py-2.5 text-sm transition-colors hover:bg-accent/50",
                          field.value === t.value &&
                            "border-primary/60 ring-1 ring-inset ring-primary/30"
                        )}
                      >
                        <RadioGroupItem id={`et-${t.value}`} value={t.value} />
                        <span className="font-medium">{t.label}</span>
                      </label>
                    ))}
                  </RadioGroup>
                )}
              />
            </Field>

            <Field
              label="形式偏好"
              error={errors.formatPreference?.message}
            >
              <Controller
                control={control}
                name="formatPreference"
                render={({ field }) => (
                  <RadioGroup
                    value={field.value}
                    onValueChange={field.onChange}
                    className="grid grid-cols-1 gap-2 sm:grid-cols-3"
                  >
                    {NEED_FORMAT_PREFERENCES.map((f) => (
                      <label
                        key={f}
                        htmlFor={`fp-${f}`}
                        className={cn(
                          "flex cursor-pointer items-center gap-2.5 rounded-lg border border-input bg-card px-3.5 py-2.5 text-sm transition-colors hover:bg-accent/50",
                          field.value === f &&
                            "border-primary/60 ring-1 ring-inset ring-primary/30"
                        )}
                      >
                        <RadioGroupItem id={`fp-${f}`} value={f} />
                        <span className="font-medium">{f}</span>
                      </label>
                    ))}
                  </RadioGroup>
                )}
              />
            </Field>
          </CardContent>
        </Card>

        {/* 联系方式 */}
        <Card>
          <CardHeader>
            <CardTitle className="font-serif text-lg">联系方式</CardTitle>
            <CardDescription>应征者与你取得联系的方式</CardDescription>
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
                      htmlFor="nd-vis-VERIFIED_ONLY"
                      className={cn(
                        "flex cursor-pointer items-center gap-2.5 rounded-lg border border-input bg-card px-3.5 py-2.5 text-sm transition-colors hover:bg-accent/50",
                        field.value === "VERIFIED_ONLY" &&
                          "border-primary/60 ring-1 ring-inset ring-primary/30"
                      )}
                    >
                      <RadioGroupItem
                        id="nd-vis-VERIFIED_ONLY"
                        value="VERIFIED_ONLY"
                      />
                      <span className="font-medium">仅认证用户可见</span>
                    </label>
                    <label
                      htmlFor="nd-vis-ALL"
                      className={cn(
                        "flex cursor-pointer items-center gap-2.5 rounded-lg border border-input bg-card px-3.5 py-2.5 text-sm transition-colors hover:bg-accent/50",
                        field.value === "ALL" &&
                          "border-primary/60 ring-1 ring-inset ring-primary/30"
                      )}
                    >
                      <RadioGroupItem id="nd-vis-ALL" value="ALL" />
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
            disabled={isSubmitting}
          >
            取消
          </Button>
          <Button type="submit" disabled={isSubmitting} className="active:scale-[0.98]">
            {isSubmitting ? (
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
