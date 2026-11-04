"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { useForm } from "react-hook-form";

import { CheckboxRow, Field, Panel, describedBy, inputClass } from "@/components/forms/fields";
import { Button } from "@/components/ui/button";
import { ROLES, type Role } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import { zodResolver } from "@/lib/zod-resolver";

import { createUser, resetPassword, updateUser } from "./actions";
import { StatusMessage, useStatus, useValidationText } from "./form-status";
import { newUserSchema, userSchema, type NewUserValues, type UserValues } from "./schemas";

export interface UserRow {
  id: string;
  fullName: string;
  email: string;
  phone: string;
  role: Role;
  branchId: string;
  branchName: string;
  active: boolean;
}

export interface BranchOption {
  id: string;
  label: string;
}

type Editing = { mode: "new" } | { mode: "edit"; user: UserRow } | null;

export function UsersPanel({
  users,
  branches,
  selfId,
}: {
  users: UserRow[];
  branches: BranchOption[];
  selfId: string;
}) {
  const t = useTranslations("settings");
  const tRoles = useTranslations("roles");
  const [editing, setEditing] = useState<Editing>(null);
  const [revealed, setRevealed] = useState<{ name: string; password: string } | null>(null);
  const { status, setStatus, pending, startTransition } = useStatus();

  const reset = (user: UserRow) => {
    if (!window.confirm(t("users.resetConfirm", { name: user.fullName }))) return;
    setStatus(null);
    startTransition(async () => {
      const result = await resetPassword(user.id);
      if (result.ok) setRevealed({ name: user.fullName, password: result.data.password });
      else setStatus({ tone: "error", code: result.code });
    });
  };

  return (
    <Panel id="users-heading" title={t("users.heading")} intro={t("users.intro")}>
      {revealed !== null ? (
        <PasswordReveal name={revealed.name} password={revealed.password} onDone={() => setRevealed(null)} />
      ) : null}
      {users.length === 0 ? (
        <p className="text-sm text-ink-muted">{t("users.empty")}</p>
      ) : (
        <ul className="-mx-4 divide-y divide-page border-y border-line sm:mx-0 sm:rounded-control sm:border">
          {users.map((user) => (
            <li
              key={user.id}
              className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <p className="text-sm font-semibold text-ink">
                  {user.fullName}
                  {user.id === selfId ? (
                    <span className="font-normal text-ink-soft"> · {t("users.you")}</span>
                  ) : null}
                </p>
                <p className="truncate text-xs text-ink-muted">
                  {user.email} · {tRoles(user.role)} ·{" "}
                  {user.branchName === "" ? t("users.noBranch") : user.branchName}
                </p>
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                <span
                  className={cn(
                    "inline-block rounded-badge px-2.5 py-0.5 text-xs font-semibold",
                    user.active
                      ? "bg-status-active-bg text-status-active-fg"
                      : "bg-status-pending-bg text-status-pending-fg",
                  )}
                >
                  {user.active ? t("users.active") : t("users.inactive")}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setEditing({ mode: "edit", user })}
                >
                  {t("edit")}
                  <span className="sr-only"> {user.fullName}</span>
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={pending}
                  onClick={() => reset(user)}
                >
                  {t("users.resetPassword")}
                  <span className="sr-only"> {user.fullName}</span>
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-4 grid gap-4">
        <StatusMessage status={status} />
        {editing === null ? (
          <div>
            <Button type="button" variant="secondary" onClick={() => setEditing({ mode: "new" })}>
              {t("users.add")}
            </Button>
          </div>
        ) : editing.mode === "new" ? (
          <NewUserForm
            branches={branches}
            onCancel={() => setEditing(null)}
            onCreated={(name, password) => {
              setEditing(null);
              setRevealed({ name, password });
            }}
          />
        ) : (
          <EditUserForm
            key={editing.user.id}
            user={editing.user}
            branches={branches}
            isSelf={editing.user.id === selfId}
            onDone={() => setEditing(null)}
          />
        )}
      </div>
    </Panel>
  );
}

function PasswordReveal({ name, password, onDone }: { name: string; password: string; onDone: () => void }) {
  const t = useTranslations("settings");
  return (
    <div
      role="status"
      className="mb-4 grid gap-2 rounded-control border border-warning-border bg-warning-bg p-4"
    >
      <p className="text-sm font-bold text-status-overdue-fg">{t("users.passwordHeading")}</p>
      <p className="text-sm text-status-overdue-fg">{t("users.passwordIntro", { name })}</p>
      <p
        className="rounded-control bg-surface px-3 py-2 font-mono text-lg tracking-wider text-ink select-all"
        data-testid="one-time-password"
      >
        {password}
      </p>
      <div>
        <Button type="button" variant="secondary" size="sm" onClick={onDone}>
          {t("users.passwordDone")}
        </Button>
      </div>
    </div>
  );
}

function UserFields({
  form,
  branches,
  isSelf = false,
  withEmail = false,
}: {
  form: ReturnType<typeof useForm<NewUserValues>> | ReturnType<typeof useForm<UserValues>>;
  branches: BranchOption[];
  isSelf?: boolean;
  withEmail?: boolean;
}) {
  const t = useTranslations("settings");
  const tRoles = useTranslations("roles");
  const validation = useValidationText();
  // Both forms share these field names; the union of form types is narrowed to them here.
  const shared = form as unknown as ReturnType<typeof useForm<NewUserValues>>;
  const errors = shared.formState.errors;
  const error = (name: keyof NewUserValues) => validation(errors[name]?.message);

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="user-fullName" label={t("users.name")} error={error("fullName")}>
          <input
            id="user-fullName"
            className={inputClass}
            autoComplete="off"
            {...describedBy("user-fullName", undefined, error("fullName"))}
            {...shared.register("fullName")}
          />
        </Field>
        {withEmail ? (
          <Field id="user-email" label={t("users.email")} error={error("email")}>
            <input
              id="user-email"
              type="email"
              autoComplete="off"
              className={inputClass}
              {...describedBy("user-email", undefined, error("email"))}
              {...shared.register("email")}
            />
          </Field>
        ) : null}
        <Field id="user-phone" label={t("users.phone")} error={error("phone")}>
          <input
            id="user-phone"
            type="tel"
            className={inputClass}
            {...describedBy("user-phone", undefined, error("phone"))}
            {...shared.register("phone")}
          />
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="user-role" label={t("users.role")} error={error("role")}>
          <select id="user-role" className={inputClass} disabled={isSelf} {...shared.register("role")}>
            {ROLES.map((role) => (
              <option key={role} value={role}>
                {tRoles(role)}
              </option>
            ))}
          </select>
        </Field>
        <Field id="user-branchId" label={t("users.branch")} error={error("branchId")}>
          <select
            id="user-branchId"
            className={inputClass}
            {...describedBy("user-branchId", undefined, error("branchId"))}
            {...shared.register("branchId")}
          >
            <option value="">{t("users.noBranch")}</option>
            {branches.map((branch) => (
              <option key={branch.id} value={branch.id}>
                {branch.label}
              </option>
            ))}
          </select>
        </Field>
      </div>
      {isSelf ? <p className="text-xs text-ink-muted">{t("users.selfNote")}</p> : null}
    </>
  );
}

function NewUserForm({
  branches,
  onCancel,
  onCreated,
}: {
  branches: BranchOption[];
  onCancel: () => void;
  onCreated: (name: string, password: string) => void;
}) {
  const t = useTranslations("settings");
  const { status, setStatus, pending, startTransition } = useStatus();
  const form = useForm<NewUserValues>({
    resolver: zodResolver(newUserSchema),
    defaultValues: { fullName: "", email: "", phone: "", role: "loan_officer", branchId: "" },
  });

  return (
    <form
      noValidate
      className="grid gap-4 rounded-control border border-line p-4"
      onSubmit={form.handleSubmit((values) => {
        setStatus(null);
        startTransition(async () => {
          const result = await createUser(values);
          if (result.ok) onCreated(values.fullName, result.data.password);
          else setStatus({ tone: "error", code: result.code });
        });
      })}
    >
      <h3 className="text-sm font-bold text-ink">{t("users.addHeading")}</h3>
      <UserFields form={form} branches={branches} withEmail />
      <StatusMessage status={status} />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? t("saving") : t("users.create")}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          {t("cancel")}
        </Button>
      </div>
    </form>
  );
}

function EditUserForm({
  user,
  branches,
  isSelf,
  onDone,
}: {
  user: UserRow;
  branches: BranchOption[];
  isSelf: boolean;
  onDone: () => void;
}) {
  const t = useTranslations("settings");
  const { status, setStatus, pending, startTransition } = useStatus();
  const form = useForm<UserValues>({
    resolver: zodResolver(userSchema),
    defaultValues: {
      id: user.id,
      fullName: user.fullName,
      phone: user.phone,
      role: user.role,
      branchId: user.branchId,
      active: user.active,
    },
  });

  return (
    <form
      noValidate
      className="grid gap-4 rounded-control border border-line p-4"
      onSubmit={form.handleSubmit((values) => {
        setStatus(null);
        startTransition(async () => {
          // A disabled select is not submitted by the browser; keep the admin's own role.
          const result = await updateUser(isSelf ? { ...values, role: user.role, active: true } : values);
          if (result.ok) onDone();
          else setStatus({ tone: "error", code: result.code });
        });
      })}
    >
      <h3 className="text-sm font-bold text-ink">{t("users.editHeading", { name: user.fullName })}</h3>
      <UserFields form={form} branches={branches} isSelf={isSelf} />
      <CheckboxRow
        id="user-active"
        label={t("users.activeLabel")}
        disabled={isSelf}
        {...form.register("active")}
      />
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
