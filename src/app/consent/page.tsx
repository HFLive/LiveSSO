import type { Metadata } from "next";
import { Suspense } from "react";
import { ConsentForm } from "@/components/consent-form";
import { prisma } from "@/lib/prisma";
import { getApprovedClientDisplayName } from "@/lib/security/client-service";

export const metadata: Metadata = {
  title: "授权确认",
};

export default async function ConsentPage({ searchParams }: { searchParams: Promise<{ client_id?: string }> }) {
  const { client_id: clientId } = await searchParams;
  const clientName = await getApprovedClientDisplayName(prisma, clientId);

  return (
    <main className="auth-main">
      <section className="panel auth-card">
        <p className="eyebrow">HFLive 授权</p>
        <h1 className="auth-title">{clientName ?? "未知应用"} 想要使用你的 HFLive 账号</h1>
        <p className="auth-copy">继续后，此应用将可以：</p>
        <Suspense fallback={<p className="auth-copy">正在读取授权请求…</p>}>
          <ConsentForm />
        </Suspense>
        <p className="fine-print consent-note">只向你认识且正在使用的应用授权。</p>
      </section>
    </main>
  );
}
