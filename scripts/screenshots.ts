/*
 * Screenshots at 390 px and 1280 px (deviceScaleFactor 2), and side-by-side
 * comparisons with the approved mock-ups (master prompt section 5).
 *
 * Usage:
 *   pnpm screenshots --out docs/screenshots/m0 /login /dashboard
 *   pnpm screenshots --out docs/screenshots/m3 --auth .auth/manager.json /loans
 *   pnpm screenshots --out docs/screenshots/m3 --compare 06=/loans --compare 07=/loans/<id>
 *
 * --base     app URL (default http://localhost:3000)
 * --auth     Playwright storage-state file for a signed-in user
 * --compare  <mock-up number>=<route>: writes compare-<nn>.png with the mock-up on
 *            the left and the app on the right, at the mock-up's width.
 */
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";

import { chromium, type Browser, type BrowserContextOptions } from "@playwright/test";

const WIDTHS = [390, 1280] as const;
const MOCKUP_DIR = path.join(process.cwd(), "docs", "mockups", "screens");

function fileNameFor(route: string): string {
  const cleaned = route.replace(/^\/+|\/+$/g, "").replace(/[^a-zA-Z0-9]+/g, "-");
  return cleaned === "" ? "root" : cleaned;
}

async function contextOptions(width: number, auth: string | undefined): Promise<BrowserContextOptions> {
  return {
    viewport: { width, height: width === 390 ? 844 : 800 },
    deviceScaleFactor: 2,
    locale: "en-GB",
    timezoneId: "Africa/Monrovia",
    ...(width === 390 ? { isMobile: true, hasTouch: true } : {}),
    ...(auth === undefined ? {} : { storageState: auth }),
  };
}

async function capture(
  browser: Browser,
  base: string,
  route: string,
  width: number,
  auth: string | undefined,
): Promise<Buffer> {
  const context = await browser.newContext(await contextOptions(width, auth));
  const page = await context.newPage();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(new URL(route, base).toString(), { waitUntil: "networkidle" });
  const image = await page.screenshot({ fullPage: true, animations: "disabled" });
  await context.close();
  return image;
}

async function mockupFile(number: string): Promise<string> {
  const files = await readdir(MOCKUP_DIR);
  const match = files.find((file) => file.startsWith(`${number.padStart(2, "0")}-`));
  if (match === undefined) throw new Error(`No mock-up numbered ${number} in ${MOCKUP_DIR}`);
  return path.join(MOCKUP_DIR, match);
}

async function compose(browser: Browser, left: Buffer, right: Buffer, width: number): Promise<Buffer> {
  const page = await browser.newPage({
    viewport: { width: width * 2 + 48, height: 800 },
    deviceScaleFactor: 1,
  });
  const toSrc = (image: Buffer) => `data:image/png;base64,${image.toString("base64")}`;
  await page.setContent(`<!doctype html><html><body style="margin:0;background:#fff;font:600 14px system-ui">
    <div style="display:flex;gap:16px;padding:16px;align-items:flex-start">
      <figure style="margin:0;width:${width}px"><figcaption style="margin-bottom:8px">Mock-up</figcaption>
        <img style="width:${width}px;border:1px solid #CBD5E1" src="${toSrc(left)}"></figure>
      <figure style="margin:0;width:${width}px"><figcaption style="margin-bottom:8px">Built</figcaption>
        <img style="width:${width}px;border:1px solid #CBD5E1" src="${toSrc(right)}"></figure>
    </div></body></html>`);
  await page.waitForLoadState("load");
  const image = await page.screenshot({ fullPage: true });
  await page.close();
  return image;
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      out: { type: "string" },
      base: { type: "string", default: "http://localhost:3000" },
      auth: { type: "string" },
      compare: { type: "string", multiple: true, default: [] },
    },
  });
  if (values.out === undefined) throw new Error("--out <directory> is required");
  const outDir = path.resolve(values.out);
  await mkdir(outDir, { recursive: true });

  const browser = await chromium.launch();
  try {
    for (const route of positionals) {
      for (const width of WIDTHS) {
        const image = await capture(browser, values.base, route, width, values.auth);
        const target = path.join(outDir, `${fileNameFor(route)}-${width}.png`);
        await writeFile(target, image);
        console.log(`saved ${path.relative(process.cwd(), target)}`);
      }
    }
    for (const pair of values.compare) {
      const split = pair.indexOf("=");
      const number = split > 0 ? pair.slice(0, split) : undefined;
      const route = split > 0 ? pair.slice(split + 1) : undefined;
      if (number === undefined || route === undefined)
        throw new Error(`--compare expects nn=/route, got ${pair}`);
      const mockupPath = await mockupFile(number);
      const mockup = await readFile(mockupPath);
      const width = mockup.readUInt32BE(16) / 2; // PNG IHDR width; mock-ups are 2x
      const built = await capture(browser, values.base, route, width, values.auth);
      const combined = await compose(browser, mockup, built, width);
      const target = path.join(outDir, `compare-${number.padStart(2, "0")}.png`);
      await writeFile(target, combined);
      console.log(`saved ${path.relative(process.cwd(), target)}`);
    }
  } finally {
    await browser.close();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
