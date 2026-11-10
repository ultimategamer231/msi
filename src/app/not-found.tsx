import Link from "next/link";
import { getTranslations } from "next-intl/server";

export default async function NotFound() {
  const t = await getTranslations("notFound");
  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-12">
      <section className="w-full max-w-md rounded-card border border-line bg-surface p-6 sm:p-8">
        <p className="text-sm font-semibold text-ink-muted">{t("code")}</p>
        <h1 className="mt-2 text-xl font-bold text-ink">{t("title")}</h1>
        <p className="mt-2 text-sm leading-6 text-ink-muted">{t("body")}</p>
        <Link
          href="/"
          className="mt-6 inline-flex min-h-11 items-center rounded-control bg-primary px-4 text-sm font-semibold text-white transition-colors duration-150 ease-out hover:bg-primary-dark hover:text-white"
        >
          {t("home")}
        </Link>
      </section>
    </main>
  );
}
