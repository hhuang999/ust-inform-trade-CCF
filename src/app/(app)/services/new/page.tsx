import Link from "next/link";
import { redirect } from "next/navigation";
import { ShieldAlert } from "lucide-react";

import { auth } from "@/lib/auth";
import {
  requireVerifiedUser,
  NotAuthenticatedError,
} from "@/lib/permissions";
import { PageContainer } from "@/components/layout/page-container";
import { SectionHeading } from "@/components/site/section-heading";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import ServiceForm from "@/components/site/service-form";
import { isAiDraftEnabled } from "@/lib/ai/config";

export const dynamic = "force-dynamic";

export default async function NewServicePage() {
  const session = await auth();
  const user = session?.user
    ? {
        id: session.user.id,
        role: session.user.role,
        verificationStatus: session.user.verificationStatus,
      }
    : null;

  try {
    requireVerifiedUser(user);
  } catch (e) {
    if (e instanceof NotAuthenticatedError) {
      redirect("/login?callbackUrl=/services/new");
    }
    // 已登录但未通过认证:渲染提示,不渲染表单。
    return (
      <PageContainer className="max-w-3xl">
        <div className="space-y-6">
          <SectionHeading title="发布服务" description="用你的能力帮助同学" />
          <Card className="ring-1 ring-inset ring-rejected/20">
            <CardContent className="flex flex-col items-start gap-4 p-6">
              <span className="flex size-11 items-center justify-center rounded-full bg-rejected-soft text-rejected ring-1 ring-inset ring-rejected/20">
                <ShieldAlert className="size-5" />
              </span>
              <div className="space-y-1">
                <h3 className="font-serif text-lg font-semibold">请先完成身份认证后再发布</h3>
                <p className="text-sm text-muted-foreground">
                  为维护校园交易安全,发布服务需先通过学生身份认证。
                </p>
              </div>
              <Button asChild>
                <Link href="/settings">前往身份认证</Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      </PageContainer>
    );
  }

  return (
    <PageContainer className="max-w-3xl">
      <div className="space-y-6">
        <SectionHeading title="发布服务" description="填写信息,让有需要的同学找到你" />
        <ServiceForm mode="create" userId={user?.id} aiDraftEnabled={isAiDraftEnabled()} />
      </div>
    </PageContainer>
  );
}
