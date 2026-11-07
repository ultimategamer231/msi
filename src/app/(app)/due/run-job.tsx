"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";

import { FormMessage } from "@/components/forms/fields";
import { Button } from "@/components/ui/button";

import { runDailyJob, type RunResult } from "./actions";

/* Manual run of the daily job (manager, admin). Safe to press again: nothing is charged twice. */
export function RunJobButton() {
  const t = useTranslations("due.job");
  const tErrors = useTranslations("errors");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<RunResult | null>(null);
  return (
    <div className="grid gap-2">
      <div>
        <Button
          type="button"
          variant="secondary"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const outcome = await runDailyJob();
              setResult(outcome);
              if (outcome.ok) router.refresh();
            })
          }
        >
          {pending ? t("running") : t("run")}
        </Button>
      </div>
      {result?.ok === true ? (
        <FormMessage tone="success">
          {t("done", {
            overdue: result.overdueMarked,
            penalties: result.penaltiesPosted,
            recovery: result.recoveryFlagged,
          })}
        </FormMessage>
      ) : null}
      {result?.ok === false ? <FormMessage tone="error">{tErrors(result.code)}</FormMessage> : null}
    </div>
  );
}

/* Print the list (mock-up 11 "Print list"). */
export function PrintListButton({ label }: { label: string }) {
  return (
    <Button type="button" variant="secondary" onClick={() => window.print()}>
      {label}
    </Button>
  );
}
