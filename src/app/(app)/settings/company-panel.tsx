"use client";

import Image from "next/image";
import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";

import { Field, Panel, describedBy, inputClass } from "@/components/forms/fields";
import { Button } from "@/components/ui/button";
import { zodResolver } from "@/lib/zod-resolver";

import { saveCompany, saveTemplates, uploadLogo } from "./actions";
import { StatusMessage, useStatus, useValidationText } from "./form-status";
import { companySchema, templatesSchema, type CompanyValues, type TemplatesValues } from "./schemas";

export function CompanyPanel({
  company,
  logoUrl,
  templates,
}: {
  company: CompanyValues;
  logoUrl: string | null;
  templates: TemplatesValues;
}) {
  return (
    <div className="grid grid-cols-1 gap-4 lg:gap-5">
      <CompanyForm company={company} />
      <LogoForm logoUrl={logoUrl} companyName={company.name} />
      <TemplatesForm templates={templates} />
    </div>
  );
}

function CompanyForm({ company }: { company: CompanyValues }) {
  const t = useTranslations("settings");
  const { status, setStatus, pending, startTransition } = useStatus();
  const form = useForm<CompanyValues>({ resolver: zodResolver(companySchema), defaultValues: company });
  const validation = useValidationText();
  const error = (name: keyof CompanyValues) => validation(form.formState.errors[name]?.message);

  const onSubmit = form.handleSubmit((values) => {
    setStatus(null);
    startTransition(async () => {
      const result = await saveCompany(values);
      setStatus(result.ok ? { tone: "success" } : { tone: "error", code: result.code });
      if (result.ok) form.reset(values);
    });
  });

  const text = (
    name: keyof CompanyValues,
    label: string,
    options: { help?: string; type?: string; className?: string } = {},
  ) => (
    <Field
      id={`company-${name}`}
      label={label}
      help={options.help}
      error={error(name)}
      className={options.className}
    >
      <input
        id={`company-${name}`}
        type={options.type ?? "text"}
        className={inputClass}
        {...describedBy(`company-${name}`, options.help, error(name))}
        {...form.register(name)}
      />
    </Field>
  );

  return (
    <Panel id="company-heading" title={t("company.heading")} intro={t("company.intro")}>
      <form onSubmit={onSubmit} noValidate className="grid gap-4">
        <div className="grid gap-4 sm:grid-cols-[2fr_1fr]">
          {text("name", t("company.name"))}
          {text("shortName", t("company.shortName"))}
        </div>
        {text("address", t("company.address"), { help: t("pendingHint") })}
        <div className="grid gap-4 sm:grid-cols-2">
          {text("phone", t("company.phone"), { type: "tel" })}
          {text("email", t("company.email"), { type: "email" })}
        </div>
        {text("receiptFooter", t("company.receiptFooter"))}
        <StatusMessage status={status} />
        <div>
          <Button type="submit" disabled={pending}>
            {pending ? t("saving") : t("save")}
          </Button>
        </div>
      </form>
    </Panel>
  );
}

function LogoForm({ logoUrl, companyName }: { logoUrl: string | null; companyName: string }) {
  const t = useTranslations("settings");
  const tShell = useTranslations("shell");
  const { status, setStatus, pending, startTransition } = useStatus();

  return (
    <Panel id="logo-heading" title={t("company.logoHeading")} intro={t("company.logoIntro")}>
      <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
        <figure className="shrink-0">
          <figcaption className="mb-1.5 text-xs font-semibold text-ink-muted">
            {t("company.logoCurrent")}
          </figcaption>
          <div className="flex h-24 w-28 items-center justify-center rounded-tile border border-line bg-surface p-2">
            {logoUrl !== null ? (
              <Image
                src={logoUrl}
                alt={tShell("logoAlt", { company: companyName })}
                width={96}
                height={80}
                unoptimized
                className="size-full object-contain"
              />
            ) : (
              <span className="text-center text-xs text-ink-soft">{t("company.logoNone")}</span>
            )}
          </div>
        </figure>
        <form
          className="grid flex-1 gap-4"
          action={(formData) => {
            setStatus(null);
            startTransition(async () => {
              const result = await uploadLogo(formData);
              setStatus(result.ok ? { tone: "success" } : { tone: "error", code: result.code });
            });
          }}
        >
          <Field id="logo-file" label={t("company.logoFile")}>
            <input
              id="logo-file"
              name="logo"
              type="file"
              required
              accept="image/png,image/jpeg,image/webp"
              className="text-sm text-ink file:mr-3 file:min-h-10 file:rounded-control file:border file:border-line-input file:bg-surface file:px-3 file:font-semibold file:text-ink"
            />
          </Field>
          <StatusMessage status={status} />
          <div>
            <Button type="submit" variant="secondary" disabled={pending}>
              {pending ? t("company.logoUploading") : t("company.logoUpload")}
            </Button>
          </div>
        </form>
      </div>
    </Panel>
  );
}

function TemplatesForm({ templates }: { templates: TemplatesValues }) {
  const t = useTranslations("settings");
  const { status, setStatus, pending, startTransition } = useStatus();
  const form = useForm<TemplatesValues>({ resolver: zodResolver(templatesSchema), defaultValues: templates });
  const placeholders =
    "{name}, {loan_no}, {amount}, {due_date}, {outstanding}, {days_overdue}, {penalties}, {branch}, {branch_phone}, {company}";

  const validation = useValidationText();
  const area = (name: keyof TemplatesValues, label: string) => {
    const error = validation(form.formState.errors[name]?.message);
    return (
      <Field id={`template-${name}`} label={label} error={error}>
        <textarea
          id={`template-${name}`}
          rows={4}
          className={`${inputClass} py-2 leading-6`}
          {...describedBy(`template-${name}`, undefined, error)}
          {...form.register(name)}
        />
      </Field>
    );
  };

  return (
    <Panel
      id="templates-heading"
      title={t("company.templatesHeading")}
      intro={t("company.templatesIntro", { placeholders })}
    >
      <form
        noValidate
        className="grid gap-4"
        onSubmit={form.handleSubmit((values) => {
          setStatus(null);
          startTransition(async () => {
            const result = await saveTemplates(values);
            setStatus(result.ok ? { tone: "success" } : { tone: "error", code: result.code });
            if (result.ok) form.reset(values);
          });
        })}
      >
        {area("reminder", t("company.reminder"))}
        {area("reminderOverdue", t("company.reminderOverdue"))}
        <StatusMessage status={status} />
        <div>
          <Button type="submit" disabled={pending}>
            {pending ? t("saving") : t("save")}
          </Button>
        </div>
      </form>
    </Panel>
  );
}
