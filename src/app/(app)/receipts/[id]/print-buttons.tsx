"use client";

import { useTranslations } from "next-intl";

import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/*
 * Print the receipt sheet on A5 or an 80 mm thermal roll (SPEC 9; print CSS in globals.css), or
 * open the PDF. The paper choice is a data attribute the print stylesheet reads.
 */
export function PrintButtons({ pdfHref }: { pdfHref: string }) {
  const t = useTranslations("receipts");
  const print = (paper: "a5" | "80mm") => {
    const sheet = document.getElementById("receipt-sheet");
    if (sheet !== null) sheet.dataset.paper = paper;
    window.print();
  };
  return (
    <div className="grid grid-cols-3 gap-2">
      <Button type="button" variant="secondary" onClick={() => print("a5")}>
        {t("printA5")}
      </Button>
      <Button type="button" variant="secondary" onClick={() => print("80mm")}>
        {t("print80")}
      </Button>
      <a
        href={pdfHref}
        target="_blank"
        rel="noopener"
        className={cn(buttonVariants({ variant: "secondary" }), "hover:text-ink")}
      >
        {t("pdf")}
      </a>
    </div>
  );
}
