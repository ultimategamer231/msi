import { z } from "zod";

import { parseDollarsToCents } from "@/lib/money-input";

import { COLLATERAL_TYPES } from "../loans/schemas";

/*
 * Collateral register (SPEC 5.9; FR-15). The database checks everything again (register_collateral,
 * log_collateral_event, release_collateral). Messages are keys under "collateral.validation".
 */
const money = z
  .string()
  .trim()
  .refine(
    (value) => {
      const cents = parseDollarsToCents(value);
      return cents !== null && cents > 0n;
    },
    { message: "amount" },
  );

export const collateralSchema = z.object({
  ownerId: z.uuid({ message: "owner" }),
  type: z.enum(COLLATERAL_TYPES),
  description: z.string().trim().min(1, { message: "required" }).max(200, { message: "tooLong" }),
  serialNo: z.string().trim().max(80, { message: "tooLong" }),
  plateNo: z.string().trim().max(40, { message: "tooLong" }),
  chassisNo: z.string().trim().max(80, { message: "tooLong" }),
  documentNo: z.string().trim().max(80, { message: "tooLong" }),
  value: money,
  location: z.string().trim().max(200, { message: "tooLong" }),
});
export type CollateralValues = z.infer<typeof collateralSchema>;

export const EVENT_TYPES = ["moved", "valued", "note", "lost"] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export const eventSchema = z
  .object({
    type: z.enum(EVENT_TYPES),
    toLocation: z.string().trim().max(200, { message: "tooLong" }),
    value: z.string().trim(),
    note: z.string().trim().max(500, { message: "tooLong" }),
    witness: z.string().trim().max(120, { message: "tooLong" }),
  })
  .refine((event) => event.type !== "moved" || event.toLocation !== "", {
    message: "location",
    path: ["toLocation"],
  })
  .refine(
    (event) => {
      if (event.type !== "valued") return true;
      const cents = parseDollarsToCents(event.value);
      return cents !== null && cents > 0n;
    },
    { message: "amount", path: ["value"] },
  )
  .refine((event) => !["note", "lost"].includes(event.type) || event.note !== "", {
    message: "note",
    path: ["note"],
  });
export type EventValues = z.infer<typeof eventSchema>;
