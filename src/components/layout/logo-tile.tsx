import Image from "next/image";

import { cn } from "@/lib/utils";

/*
 * The company logo always sits on a white tile, never directly on purple (SPEC 11 Branding).
 * Without a logo URL the tile shows the company short name instead.
 */
export function LogoTile({
  logoUrl,
  alt,
  shortName,
  size = "md",
  className,
}: {
  logoUrl: string | null;
  alt: string;
  shortName: string;
  size?: "sm" | "md";
  className?: string;
}) {
  const box = size === "sm" ? "size-10 rounded-control p-[3px]" : "h-10 w-11";
  return (
    <span className={cn("inline-flex shrink-0 items-center justify-center bg-surface", box, className)}>
      {logoUrl !== null ? (
        <Image
          src={logoUrl}
          alt={alt}
          width={44}
          height={40}
          unoptimized
          className="size-full object-contain"
        />
      ) : (
        <span className="text-xs font-extrabold text-primary">{shortName}</span>
      )}
    </span>
  );
}
