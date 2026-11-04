import { getTranslations } from "next-intl/server";
import { Suspense } from "react";

import { createSupabaseServerClient } from "@/lib/supabase/server";

import { LoginForm } from "./login-form";

type Notice = "signed-out" | "inactive" | "expired";
const NOTICES: ReadonlySet<string> = new Set<Notice>(["signed-out", "inactive", "expired"]);

export default function LoginPage({ searchParams }: PageProps<"/login">) {
  return (
    <main className="flex min-h-dvh items-start justify-center px-4 py-12 sm:items-center">
      <div className="w-full max-w-sm">
        <Suspense fallback={<LoginSkeleton />}>
          <LoginContent searchParams={searchParams} />
        </Suspense>
      </div>
    </main>
  );
}

async function companyName(): Promise<string | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("public_branding");
  if (error !== null || data === null || typeof data !== "object" || Array.isArray(data)) return null;
  const name = (data as Record<string, unknown>).name;
  return typeof name === "string" && name.trim() !== "" ? name : null;
}

async function LoginContent({ searchParams }: { searchParams: PageProps<"/login">["searchParams"] }) {
  const [t, params, name] = await Promise.all([getTranslations("login"), searchParams, companyName()]);
  const notice =
    typeof params.notice === "string" && NOTICES.has(params.notice) ? (params.notice as Notice) : null;
  const next = typeof params.next === "string" ? params.next : "";

  return (
    <section className="rounded-card border border-line bg-surface p-6 sm:p-8">
      {name !== null ? <p className="text-sm font-semibold text-primary">{name}</p> : null}
      <h1 className="mt-1 text-2xl font-bold text-ink">{t("title")}</h1>
      <p className="mt-2 text-sm leading-6 text-ink-muted">{t("intro")}</p>
      {notice !== null ? (
        <p
          role="status"
          className="mt-5 rounded-control bg-primary-tint px-3 py-2.5 text-sm font-medium text-primary-dark"
        >
          {t(`notices.${notice}`)}
        </p>
      ) : null}
      <LoginForm next={next} />
    </section>
  );
}

function LoginSkeleton() {
  return (
    <div aria-hidden="true" className="rounded-card border border-line bg-surface p-6 sm:p-8">
      <div className="h-4 w-40 animate-pulse rounded bg-page" />
      <div className="mt-3 h-7 w-24 animate-pulse rounded bg-page" />
      <div className="mt-6 h-11 animate-pulse rounded-[10px] bg-page" />
      <div className="mt-4 h-11 animate-pulse rounded-[10px] bg-page" />
      <div className="mt-6 h-11 animate-pulse rounded-[10px] bg-page" />
    </div>
  );
}
