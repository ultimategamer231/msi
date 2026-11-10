"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";

import { signIn, type SignInState } from "./actions";

const INITIAL: SignInState = {};

export function LoginForm({ next }: { next: string }) {
  const t = useTranslations("login");
  const [state, formAction, pending] = useActionState(signIn, INITIAL);
  const errorId = "login-error";

  return (
    <form
      action={formAction}
      className="mt-6 grid gap-4"
      noValidate
      aria-describedby={state.error ? errorId : undefined}
    >
      <input type="hidden" name="next" value={next} />
      <div className="grid gap-2">
        <label htmlFor="email" className="text-xs font-semibold text-ink-muted">
          {t("email")}
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          inputMode="email"
          required
          defaultValue={state.email}
          aria-invalid={state.error !== undefined}
          className="min-h-11 rounded-control border border-line-input bg-surface px-3 text-base text-ink focus-visible:outline-primary sm:text-sm"
        />
      </div>
      <div className="grid gap-2">
        <label htmlFor="password" className="text-xs font-semibold text-ink-muted">
          {t("password")}
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          aria-invalid={state.error !== undefined}
          className="min-h-11 rounded-control border border-line-input bg-surface px-3 text-base text-ink sm:text-sm"
        />
      </div>
      {state.error !== undefined ? (
        <p
          id={errorId}
          role="alert"
          className="rounded-control border border-warning-border bg-warning-bg px-3 py-2.5 text-sm text-status-overdue-fg"
        >
          {t(`errors.${state.error}`)}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={pending}
        className="mt-2 min-h-11 rounded-control bg-primary px-4 text-sm font-semibold text-white transition-[background-color,transform] duration-150 ease-out hover:bg-primary-dark active:scale-[0.99] disabled:cursor-wait disabled:opacity-70"
      >
        {pending ? t("submitting") : t("submit")}
      </button>
    </form>
  );
}
