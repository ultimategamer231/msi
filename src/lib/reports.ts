import "server-only";

import { getTranslations } from "next-intl/server";

import { customerName } from "@/lib/customers";
import { formatDate, formatMoney, formatShare } from "@/lib/format";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/*
 * Reports (SPEC 10.2; FR-24). Each report reads one SQL function or view and becomes the same
 * shape: summary cards, a reconciliation check and tables. The page renders the shape; the CSV
 * route writes it. No figure is computed here, only shares for display.
 */
export const REPORT_KEYS = [
  "collections",
  "money-out",
  "due",
  "overdue",
  "profit-loss",
  "balance-sheet",
  "trial-balance",
  "cash-position",
  "collateral",
] as const;
export type ReportKey = (typeof REPORT_KEYS)[number];

/** Which filters a report takes. */
export const REPORT_FILTERS: Record<ReportKey, { range: boolean; asOf: boolean; branch: boolean }> = {
  collections: { range: true, asOf: false, branch: true },
  "money-out": { range: true, asOf: false, branch: true },
  due: { range: false, asOf: false, branch: true },
  overdue: { range: false, asOf: false, branch: true },
  "profit-loss": { range: true, asOf: false, branch: true },
  "balance-sheet": { range: false, asOf: true, branch: false },
  "trial-balance": { range: false, asOf: true, branch: false },
  "cash-position": { range: false, asOf: true, branch: false },
  collateral: { range: false, asOf: false, branch: true },
};

export type ColumnKind = "text" | "money" | "date" | "int" | "share";
export type Cell = string | number | null;
export interface Column {
  key: string;
  label: string;
  kind: ColumnKind;
}
export interface Section {
  id: string;
  heading: string;
  columns: Column[];
  rows: Array<Record<string, Cell>>;
  total?: Record<string, Cell>;
  empty: string;
}
export interface ReportModel {
  key: ReportKey;
  title: string;
  subtitle: string;
  cards: Array<{ label: string; value: string; note?: string }>;
  check?: { ok: boolean; text: string };
  sections: Section[];
}
export interface ReportParams {
  from: string;
  to: string;
  asOf: string;
  branchId: string;
}

const isDate = (value: unknown) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);

/** Filters from the query string, with defaults: today, or this month for profit and loss. */
export function reportParams(
  key: ReportKey,
  query: Record<string, string | string[] | undefined>,
  today: string,
): ReportParams {
  const pick = (name: string) => (typeof query[name] === "string" ? (query[name] as string) : "");
  const monthStart = `${today.slice(0, 8)}01`;
  const to = isDate(pick("to")) && pick("to") <= today ? pick("to") : today;
  const fallbackFrom = key === "profit-loss" ? monthStart : to;
  const from = isDate(pick("from")) && pick("from") <= to ? pick("from") : fallbackFrom;
  const asOf = isDate(pick("asOf")) && pick("asOf") <= today ? pick("asOf") : today;
  const branchId = /^[0-9a-f-]{36}$/.test(pick("branch")) ? pick("branch") : "";
  return { from, to, asOf, branchId };
}

/** Money in a cell is integer cents; CSV writes it as plain dollars ("1234.56"). */
export function formatCell(kind: ColumnKind, value: Cell): string {
  if (value === null || value === "") return "";
  if (kind === "money") return formatMoney(String(value));
  if (kind === "date") return isDate(value) ? formatDate(String(value)) : String(value);
  return String(value);
}

type Json = Record<string, unknown>;
const num = (value: unknown): number => (typeof value === "number" ? value : Number(value ?? 0));
const text = (value: unknown): string => (value === null || value === undefined ? "" : String(value));
const rowsOf = (data: unknown, key = "rows"): Json[] =>
  Array.isArray((data as Json | null)?.[key]) ? ((data as Json)[key] as Json[]) : [];

export async function buildReport(key: ReportKey, params: ReportParams): Promise<ReportModel> {
  const t = await getTranslations("reports");
  const supabase = await createSupabaseServerClient();
  const branch = params.branchId === "" ? null : params.branchId;
  const { data: branches } = await supabase.from("branches").select("id, name");
  const branchName =
    branch === null
      ? t("allBranches")
      : ((branches ?? []).find((row) => row.id === branch)?.name ?? t("allBranches"));
  const range = t("range", { from: formatDate(params.from), to: formatDate(params.to) });
  const asOf = t("asAt", { date: formatDate(params.asOf) });
  const col = (keyName: string, kind: ColumnKind = "text"): Column => ({
    key: keyName,
    label: t(`columns.${keyName}` as "columns.loan"),
    kind,
  });
  const title = t(`titles.${key}` as "titles.overdue");
  const failed = (): never => {
    throw new Error(`Could not read the ${key} report`);
  };

  switch (key) {
    case "collections": {
      const { data, error } = await supabase.rpc("report_collections", {
        p_from: params.from,
        p_to: params.to,
        p_branch_id: branch as string,
      });
      if (error !== null) failed();
      const rows = rowsOf(data);
      const byMethod = new Map<string, { count: number; cents: bigint }>();
      for (const row of rows) {
        const method = text(row.method);
        const current = byMethod.get(method) ?? { count: 0, cents: 0n };
        byMethod.set(method, {
          count: current.count + 1,
          cents: current.cents + BigInt(num(row.amount_cents)),
        });
      }
      return {
        key,
        title,
        subtitle: `${range} · ${branchName}`,
        cards: [
          {
            label: t("cards.collected"),
            value: formatMoney(num((data as Json).total_cents)),
            note: t("cards.receipts", { count: rows.length }),
          },
          {
            label: t("cards.fieldPending"),
            value: formatMoney(num((data as Json).field_pending_cents)),
            note: t("cards.fieldPendingNote"),
          },
        ],
        sections: [
          {
            id: "by-method",
            heading: t("sections.byMethod"),
            columns: [col("method"), col("receipts", "int"), col("amount", "money")],
            rows: [...byMethod.entries()].map(([method, value]) => ({
              method: t(`methods.${method}` as "methods.cash"),
              receipts: value.count,
              amount: value.cents.toString(),
            })),
            empty: t("empty"),
          },
          {
            id: "receipts",
            heading: t("sections.receipts"),
            columns: [
              col("date", "date"),
              col("receipt"),
              col("branch"),
              col("takenBy"),
              col("method"),
              col("borrower"),
              col("loan"),
              col("handover"),
              col("amount", "money"),
            ],
            rows: rows.map((row) => ({
              date: text(row.received_on),
              receipt: text(row.receipt_no),
              branch: text(row.branch),
              takenBy: text(row.officer),
              method: t(`methods.${text(row.method)}` as "methods.cash"),
              borrower: text(row.customer),
              loan: text(row.loan_no),
              handover:
                row.field === true ? t(`handover.${text(row.remittance_status)}` as "handover.pending") : "",
              amount: num(row.amount_cents),
            })),
            total: { date: t("total"), amount: num((data as Json).total_cents) },
            empty: t("empty"),
          },
        ],
      };
    }
    case "money-out": {
      const { data, error } = await supabase.rpc("report_money_out", {
        p_from: params.from,
        p_to: params.to,
        p_branch_id: branch as string,
      });
      if (error !== null) failed();
      const rows = rowsOf(data);
      return {
        key,
        title,
        subtitle: `${range} · ${branchName}`,
        cards: [
          {
            label: t("cards.paidOut"),
            value: formatMoney(num((data as Json).total_cents)),
            note: t("cards.entries", { count: rows.length }),
          },
        ],
        sections: [
          {
            id: "money-out",
            heading: t("sections.moneyOut"),
            columns: [
              col("date", "date"),
              col("type"),
              col("reference"),
              col("description"),
              col("branch"),
              col("account"),
              col("amount", "money"),
            ],
            rows: rows.map((row) => ({
              date: text(row.date),
              type: t(`outTypes.${text(row.type)}` as "outTypes.expense"),
              reference: text(row.reference),
              description: text(row.description),
              branch: text(row.branch),
              account: text(row.account),
              amount: num(row.amount_cents),
            })),
            total: { date: t("total"), amount: num((data as Json).total_cents) },
            empty: t("empty"),
          },
        ],
      };
    }
    case "due": {
      const [{ data: due, error }, { data: loans }] = await Promise.all([
        supabase.from("due_list").select("*").in("bucket", ["due_today", "due_7d"]).order("due_date"),
        supabase
          .from("loans")
          .select(
            "id, loan_no, branch_id, customers!inner(type, first_name, last_name, business_name, phone), branches!inner(name)",
          ),
      ]);
      if (error !== null) failed();
      const byId = new Map((loans ?? []).map((loan) => [loan.id, loan]));
      const rows = (due ?? [])
        .map((row) => ({ row, loan: byId.get(row.loan_id ?? "") }))
        .filter(({ loan }) => loan !== undefined && (branch === null || loan.branch_id === branch));
      const section = (bucket: "due_today" | "due_7d"): Section => {
        const list = rows.filter(({ row }) => row.bucket === bucket);
        return {
          id: bucket,
          heading: t(`sections.${bucket === "due_today" ? "dueToday" : "dueSoon"}`),
          columns: [
            col("dueDate", "date"),
            col("loan"),
            col("borrower"),
            col("phone"),
            col("branch"),
            col("owes", "money"),
          ],
          rows: list.map(({ row, loan }) => ({
            dueDate: text(row.due_date),
            loan: text(loan?.loan_no),
            borrower: loan === undefined ? "" : customerName(loan.customers),
            phone: text(loan?.customers.phone),
            branch: text(loan?.branches.name),
            owes: num(row.total_out),
          })),
          total: {
            dueDate: t("total"),
            owes: list.reduce((sum, { row }) => sum + BigInt(num(row.total_out)), 0n).toString(),
          },
          empty: t("empty"),
        };
      };
      return {
        key,
        title,
        subtitle: `${t("asAt", { date: formatDate(params.to) })} · ${branchName}`,
        cards: [],
        sections: [section("due_today"), section("due_7d")],
      };
    }
    case "overdue": {
      const { data, error } = await supabase.rpc("report_overdue", { p_branch_id: branch as string });
      if (error !== null) failed();
      const report = data as Json;
      const rows = rowsOf(data);
      const total = num(report.total_cents);
      const portfolio = num(report.portfolio_cents);
      const buckets = (report.buckets ?? {}) as Record<string, Json>;
      const inRecovery = rows.filter((row) => row.status === "recovery");
      const penalties = rows.reduce((sum, row) => sum + BigInt(num(row.penalty_cents)), 0n);
      const share = (part: number) => (total > 0 ? formatShare(part, total) : "–");
      return {
        key,
        title,
        subtitle: `${t("asAt", { date: formatDate(text(report.as_of)) })} · ${branchName}`,
        cards: [
          {
            label: t("cards.totalOverdue"),
            value: formatMoney(total),
            note: t("cards.loans", { count: rows.length }),
          },
          {
            label: t("cards.shareOfOutstanding"),
            value: portfolio > 0 ? formatShare(total, portfolio) : "–",
            note: t("cards.ofPortfolio", { amount: formatMoney(portfolio) }),
          },
          { label: t("cards.penaltiesIncluded"), value: formatMoney(penalties), note: t("cards.ofOverdue") },
          {
            label: t("cards.inRecovery"),
            value: formatMoney(inRecovery.reduce((sum, row) => sum + BigInt(num(row.total_cents)), 0n)),
            note: t("cards.loans", { count: inRecovery.length }),
          },
        ],
        sections: [
          {
            id: "by-age",
            heading: t("sections.byAge"),
            columns: [
              col("age"),
              col("loans", "int"),
              col("principal", "money"),
              col("interest", "money"),
              col("penalties", "money"),
              col("totalOwed", "money"),
              col("share", "share"),
            ],
            rows: (["1_7", "8_30", "31_plus"] as const).map((bucket) => {
              const value = buckets[bucket] ?? {};
              return {
                age: t(`ages.${bucket}`),
                loans: num(value.loans),
                principal: num(value.principal_cents),
                interest: num(value.interest_cents),
                penalties: num(value.penalty_cents),
                totalOwed: num(value.total_cents),
                share: share(num(value.total_cents)),
              };
            }),
            total: {
              age: t("total"),
              loans: rows.length,
              principal: rows.reduce((sum, row) => sum + BigInt(num(row.principal_cents)), 0n).toString(),
              interest: rows.reduce((sum, row) => sum + BigInt(num(row.interest_cents)), 0n).toString(),
              penalties: penalties.toString(),
              totalOwed: total,
              share: total > 0 ? "100%" : "–",
            },
            empty: t("empty"),
          },
          {
            id: "detail",
            heading: t("sections.detail"),
            columns: [
              col("loan"),
              col("borrower"),
              col("branch"),
              col("days", "int"),
              col("owes", "money"),
              col("nextPenalty", "date"),
              col("collateral"),
              col("value", "money"),
            ],
            rows: rows.map((row) => ({
              loan: text(row.loan_no),
              borrower: text(row.borrower),
              branch: text(row.branch),
              days: num(row.days),
              owes: num(row.total_cents),
              nextPenalty: row.next_penalty_on === null ? null : text(row.next_penalty_on),
              collateral: text(row.collateral) || "–",
              value: num(row.collateral_value_cents),
            })),
            empty: t("emptyOverdue"),
          },
        ],
      };
    }
    case "profit-loss": {
      const { data, error } = await supabase.rpc("report_profit_loss", {
        p_from: params.from,
        p_to: params.to,
        p_branch_id: branch as string,
      });
      if (error !== null) failed();
      const report = data as Json;
      const lines = (key2: string) =>
        rowsOf(data, key2).map((row) => ({
          account: `${text(row.code)} · ${text(row.name)}`,
          amount: num(row.amount_cents),
        }));
      return {
        key,
        title,
        subtitle: `${range} · ${branchName}`,
        cards: [
          { label: t("cards.income"), value: formatMoney(num(report.income_cents)) },
          { label: t("cards.expenses"), value: formatMoney(num(report.expense_cents)) },
          { label: t("cards.net"), value: formatMoney(num(report.net_cents)) },
        ],
        sections: [
          {
            id: "income",
            heading: t("sections.income"),
            columns: [col("account"), col("amount", "money")],
            rows: lines("income"),
            total: { account: t("totalIncome"), amount: num(report.income_cents) },
            empty: t("empty"),
          },
          {
            id: "expenses",
            heading: t("sections.expenses"),
            columns: [col("account"), col("amount", "money")],
            rows: lines("expenses"),
            total: { account: t("totalExpenses"), amount: num(report.expense_cents) },
            empty: t("empty"),
          },
          {
            id: "net",
            heading: t("sections.net"),
            columns: [col("account"), col("amount", "money")],
            rows: [{ account: t("netProfit"), amount: num(report.net_cents) }],
            empty: t("empty"),
          },
        ],
      };
    }
    case "balance-sheet": {
      const { data, error } = await supabase.rpc("report_balance_sheet", { p_as_of: params.asOf });
      if (error !== null) failed();
      const report = data as Json;
      const lines = (key2: string) =>
        rowsOf(data, key2).map((row) => ({
          account: `${text(row.code)} · ${text(row.name)}`,
          amount: num(row.amount_cents),
        }));
      const ok = report.balanced === true;
      const liabilitiesAndEquity = BigInt(num(report.liability_cents)) + BigInt(num(report.equity_cents));
      return {
        key,
        title,
        subtitle: asOf,
        cards: [],
        check: {
          ok,
          text: ok
            ? t("checks.balanceOk", { amount: formatMoney(num(report.asset_cents)) })
            : t("checks.balanceOff", {
                assets: formatMoney(num(report.asset_cents)),
                other: formatMoney(liabilitiesAndEquity),
              }),
        },
        sections: [
          {
            id: "assets",
            heading: t("sections.assets"),
            columns: [col("account"), col("amount", "money")],
            rows: lines("assets"),
            total: { account: t("totalAssets"), amount: num(report.asset_cents) },
            empty: t("empty"),
          },
          {
            id: "liabilities",
            heading: t("sections.liabilities"),
            columns: [col("account"), col("amount", "money")],
            rows: lines("liabilities"),
            total: { account: t("totalLiabilities"), amount: num(report.liability_cents) },
            empty: t("empty"),
          },
          {
            id: "equity",
            heading: t("sections.equity"),
            columns: [col("account"), col("amount", "money")],
            rows: [...lines("equity"), { account: t("retained"), amount: num(report.retained_cents) }],
            total: { account: t("totalEquity"), amount: num(report.equity_cents) },
            empty: t("empty"),
          },
        ],
      };
    }
    case "trial-balance": {
      const { data, error } = await supabase.rpc("report_trial_balance", { p_as_of: params.asOf });
      if (error !== null) failed();
      const report = data as Json;
      const ok = report.balanced === true;
      return {
        key,
        title,
        subtitle: asOf,
        cards: [],
        check: {
          ok,
          text: ok
            ? t("checks.trialOk", { amount: formatMoney(num(report.debit_cents)) })
            : t("checks.trialOff", {
                debit: formatMoney(num(report.debit_cents)),
                credit: formatMoney(num(report.credit_cents)),
              }),
        },
        sections: [
          {
            id: "accounts",
            heading: t("sections.accounts"),
            columns: [col("account"), col("debit", "money"), col("credit", "money")],
            rows: rowsOf(data).map((row) => ({
              account: `${text(row.code)} · ${text(row.name)}`,
              debit: num(row.debit_cents),
              credit: num(row.credit_cents),
            })),
            total: { account: t("total"), debit: num(report.debit_cents), credit: num(report.credit_cents) },
            empty: t("empty"),
          },
        ],
      };
    }
    case "cash-position": {
      const { data, error } = await supabase.rpc("report_cash_position", { p_as_of: params.asOf });
      if (error !== null) failed();
      const report = data as Json;
      return {
        key,
        title,
        subtitle: asOf,
        cards: [{ label: t("cards.cashTotal"), value: formatMoney(num(report.total_cents)) }],
        sections: [
          {
            id: "accounts",
            heading: t("sections.cashAccounts"),
            columns: [col("account"), col("branch"), col("balance", "money")],
            rows: rowsOf(data, "accounts").map((row) => ({
              account: `${text(row.code)} · ${text(row.name)}`,
              branch: text(row.branch) || "–",
              balance: num(row.balance_cents),
            })),
            total: { account: t("total"), balance: num(report.total_cents) },
            empty: t("empty"),
          },
          {
            id: "field",
            heading: t("sections.fieldCash"),
            columns: [col("officer"), col("balance", "money")],
            rows: rowsOf(data, "field").map((row) => ({
              officer: text(row.officer),
              balance: num(row.balance_cents),
            })),
            empty: t("emptyField"),
          },
        ],
      };
    }
    case "collateral": {
      let query = supabase
        .from("collaterals")
        .select(
          "id, code, description, status, location_note, estimated_value_cents, branch_id, customers!inner(type, first_name, last_name, business_name), loan_collaterals(status, loans(loan_no, status))",
        )
        .order("code");
      if (branch !== null) query = query.eq("branch_id", branch);
      const { data, error } = await query;
      if (error !== null) failed();
      const tStatus = await getTranslations("collateral.status");
      const items = data ?? [];
      const held = items.filter((item) => ["held", "in_recovery"].includes(item.status));
      return {
        key,
        title,
        subtitle: branchName,
        cards: [
          { label: t("cards.itemsHeld"), value: String(held.length) },
          {
            label: t("cards.valueHeld"),
            value: formatMoney(held.reduce((sum, item) => sum + BigInt(item.estimated_value_cents), 0n)),
          },
        ],
        sections: [
          {
            id: "items",
            heading: t("sections.items"),
            columns: [
              col("item"),
              col("description"),
              col("owner"),
              col("loan"),
              col("status"),
              col("location"),
              col("value", "money"),
            ],
            rows: items.map((item) => {
              const pledge =
                item.loan_collaterals.find((link) => ["pledged", "seized"].includes(link.status)) ??
                item.loan_collaterals[0];
              return {
                item: item.code,
                description: item.description,
                owner: customerName(item.customers),
                loan: pledge?.loans?.loan_no ?? "–",
                status: tStatus(item.status as "held"),
                location: item.location_note ?? "–",
                value: item.estimated_value_cents,
              };
            }),
            empty: t("empty"),
          },
        ],
      };
    }
  }
}
