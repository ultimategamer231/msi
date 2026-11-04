"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { useForm } from "react-hook-form";

import { CheckboxRow, Field, Panel, describedBy, inputClass } from "@/components/forms/fields";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { zodResolver } from "@/lib/zod-resolver";

import { saveBranch } from "./actions";
import { StatusMessage, useStatus, useValidationText } from "./form-status";
import { branchSchema, type BranchValues } from "./schemas";

export interface BranchRow {
  id: string;
  code: string;
  name: string;
  address: string;
  phone: string;
  active: boolean;
}

const EMPTY: BranchValues = { code: "", name: "", address: "", phone: "", active: true };

export function BranchesPanel({ branches }: { branches: BranchRow[] }) {
  const t = useTranslations("settings");
  const [editing, setEditing] = useState<BranchRow | "new" | null>(null);

  return (
    <Panel id="branches-heading" title={t("branches.heading")} intro={t("branches.intro")}>
      {branches.length === 0 ? (
        <p className="text-sm text-ink-muted">{t("branches.empty")}</p>
      ) : (
        <div className="relative -mx-4 overflow-x-auto border-y border-line sm:mx-0 sm:rounded-control sm:border">
          <table className="w-full min-w-[520px] border-collapse text-sm">
            <thead className="bg-subtle text-left text-xs font-semibold text-ink-muted">
              <tr>
                <th scope="col" className="px-3 py-2.5">
                  {t("branches.code")}
                </th>
                <th scope="col" className="px-3 py-2.5">
                  {t("branches.name")}
                </th>
                <th scope="col" className="px-3 py-2.5">
                  {t("branches.phone")}
                </th>
                <th scope="col" className="px-3 py-2.5">
                  {t("branches.status")}
                </th>
                <th scope="col" className="px-3 py-2.5">
                  <span className="sr-only">{t("edit")}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {branches.map((branch) => (
                <tr key={branch.id} className="border-t border-page">
                  <td className="px-3 py-3 font-semibold">{branch.code}</td>
                  <td className="px-3 py-3">{branch.name}</td>
                  <td className="px-3 py-3 text-ink-muted">{branch.phone}</td>
                  <td className="px-3 py-3">
                    <span
                      className={cn(
                        "inline-block rounded-badge px-2.5 py-0.5 text-xs font-semibold",
                        branch.active
                          ? "bg-status-active-bg text-status-active-fg"
                          : "bg-status-pending-bg text-status-pending-fg",
                      )}
                    >
                      {branch.active ? t("branches.active") : t("branches.inactive")}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(branch)}>
                      {t("edit")}
                      <span className="sr-only"> {branch.code}</span>
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="mt-4">
        {editing === null ? (
          <Button type="button" variant="secondary" onClick={() => setEditing("new")}>
            {t("branches.add")}
          </Button>
        ) : (
          <BranchForm
            key={editing === "new" ? "new" : editing.id}
            branch={editing === "new" ? null : editing}
            onDone={() => setEditing(null)}
          />
        )}
      </div>
    </Panel>
  );
}

function BranchForm({ branch, onDone }: { branch: BranchRow | null; onDone: () => void }) {
  const t = useTranslations("settings");
  const validation = useValidationText();
  const { status, setStatus, pending, startTransition } = useStatus();
  const form = useForm<BranchValues>({
    resolver: zodResolver(branchSchema),
    defaultValues: branch ?? EMPTY,
  });
  const error = (name: keyof BranchValues) => validation(form.formState.errors[name]?.message);

  const text = (name: "code" | "name" | "address" | "phone", label: string, disabled = false) => (
    <Field id={`branch-${name}`} label={label} error={error(name)}>
      <input
        id={`branch-${name}`}
        className={inputClass}
        disabled={disabled}
        {...describedBy(`branch-${name}`, undefined, error(name))}
        {...form.register(name)}
      />
    </Field>
  );

  return (
    <form
      noValidate
      className="grid gap-4 rounded-control border border-line p-4"
      onSubmit={form.handleSubmit((values) => {
        setStatus(null);
        startTransition(async () => {
          const result = await saveBranch(
            branch === null ? values : { ...values, id: branch.id, code: branch.code },
          );
          if (result.ok) onDone();
          else setStatus({ tone: "error", code: result.code });
        });
      })}
    >
      <h3 className="text-sm font-bold text-ink">
        {branch === null ? t("branches.addHeading") : t("branches.editHeading", { code: branch.code })}
      </h3>
      <div className="grid gap-4 sm:grid-cols-[1fr_2fr]">
        {text("code", t("branches.code"), branch !== null)}
        {text("name", t("branches.name"))}
      </div>
      <div className="grid gap-4 sm:grid-cols-[2fr_1fr]">
        {text("address", t("branches.address"))}
        {text("phone", t("branches.phone"))}
      </div>
      <CheckboxRow id="branch-active" label={t("branches.activeLabel")} {...form.register("active")} />
      <StatusMessage status={status} />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? t("saving") : t("save")}
        </Button>
        <Button type="button" variant="ghost" onClick={onDone}>
          {t("cancel")}
        </Button>
      </div>
    </form>
  );
}
