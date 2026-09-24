import { createHash } from "node:crypto";
import { readFile, readFileSync, readdirSync } from "node:fs";
import https from "node:https";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { FontLoader } from "next/font";
import ts from "typescript";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import sources from "../../app/fonts/sources.json";

const app = fileURLToPath(new URL("../../app/", import.meta.url));
const licenses = fileURLToPath(new URL("../../../public/fonts/", import.meta.url));
const require = createRequire(import.meta.url);
const localLoader: FontLoader = require("next/dist/compiled/@next/font/dist/local/loader").default;
const googleLoader: FontLoader = require("next/dist/compiled/@next/font/dist/google/loader").default;
const parseFont: (buffer: Buffer) => unknown = require("next/dist/compiled/@next/font/dist/fontkit").default;
const fontMetadata = z.object({
  familyName: z.string(), subfamilyName: z.string(), version: z.string(),
  characterSet: z.array(z.number().int()),
  variationAxes: z.record(z.object({ min: z.number(), default: z.number(), max: z.number() })),
});
const axes: Record<string, Record<string, { min: number; default: number; max: number }>> = {
  Geist: { wght: { min: 100, default: 400, max: 900 } },
  "JetBrains Mono": { wght: { min: 100, default: 400, max: 800 } },
  Oswald: { wght: { min: 200, default: 400, max: 700 } },
  "Saira Stencil One": {},
  "Archivo SemiBold": { wght: { min: 100, default: 600, max: 900 }, wdth: { min: 62, default: 100, max: 125 } },
};

function literal(node: ts.Node): unknown {
  if (ts.isStringLiteral(node)) return node.text;
  if (ts.isArrayLiteralExpression(node)) return node.elements.map(literal);
  if (ts.isObjectLiteralExpression(node)) return Object.fromEntries(node.properties.map((property) => {
    if (!ts.isPropertyAssignment(property) || !ts.isIdentifier(property.name)) throw new Error("Nonliteral font option");
    return [property.name.text, literal(property.initializer)];
  }));
  throw new Error("Nonliteral font option");
}
const configuration = z.object({
  src: z.union([z.string(), z.array(z.object({ path: z.string(), weight: z.string(), style: z.literal("normal") }))]),
  weight: z.string().optional(), style: z.literal("normal").optional(),
  display: z.literal("swap"), variable: z.string(),
});
function declarations(directory: string, file: string) {
  const source = readFileSync(resolve(directory, file), "utf8");
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  return ast.statements.filter(ts.isVariableStatement)
    .flatMap((statement) => statement.declarationList.declarations)
    .flatMap(({ initializer }) => initializer && ts.isCallExpression(initializer) &&
      initializer.expression.getText(ast) === "localFont"
      ? [configuration.parse(literal(initializer.arguments[0]!))] : []);
}
const fonts = declarations(app, "layout.tsx");
const wizard = resolve(app, "app", "program");
const wizardFonts = declarations(wizard, "page.tsx");

afterEach(() => vi.restoreAllMocks());

describe("self-hosted application fonts", () => {
  it("retains all four variables, normal styles and existing weight choices", () => {
    expect(fonts.map((font) => ({
      variable: font.variable,
      faces: typeof font.src === "string"
        ? [{ path: font.src, weight: font.weight, style: font.style }] : font.src,
    }))).toEqual([
      { variable: "--font-sans", faces: [{ path: "./fonts/Geist.woff2", weight: "100 900", style: "normal" }] },
      { variable: "--font-mono", faces: [{ path: "./fonts/JetBrainsMono.woff2", weight: "100 800", style: "normal" }] },
      { variable: "--font-display", faces: ["400", "500", "600", "700"].map((weight) => ({
        path: "./fonts/Oswald.woff2", weight, style: "normal",
      })) },
      { variable: "--font-stencil", faces: [{ path: "./fonts/SairaStencilOne.woff2", weight: "400", style: "normal" }] },
    ]);
  });

  it("retains the wizard's scoped typefaces and weights without any remaining Google font import", () => {
    expect(wizardFonts.map((font) => ({
      variable: font.variable,
      faces: typeof font.src === "string"
        ? [{ path: font.src, weight: font.weight, style: font.style }] : font.src,
    }))).toEqual([
      { variable: "--font-archivo", faces: ["400", "500", "600", "700"].map((weight) => ({
        path: "../../fonts/Archivo.woff2", weight, style: "normal",
      })) },
      { variable: "--font-oswald", faces: ["400", "500", "600", "700"].map((weight) => ({
        path: "../../fonts/Oswald.woff2", weight, style: "normal",
      })) },
      { variable: "--font-saira", faces: [{ path: "../../fonts/SairaStencilOne.woff2", weight: "400", style: "normal" }] },
      { variable: "--font-mono-wizard", faces: ["500", "700"].map((weight) => ({
        path: "../../fonts/JetBrainsMono.woff2", weight, style: "normal",
      })) },
    ]);
    const src = resolve(app, "..");
    const remote = readdirSync(src, { recursive: true, encoding: "utf8" })
      .filter((file) => /\.(?:ts|tsx)$/.test(file) && !file.includes("__tests__") && !file.includes(".test."))
      .filter((file) => readFileSync(resolve(src, file), "utf8").includes("next/font/google"));
    expect(remote).toEqual([]);
  });

  it.each(sources.fonts)("retains licensed $family identity and complete source Unicode coverage", (source) => {
    const bytes = readFileSync(resolve(app, "fonts", source.file));
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(source.sha256);
    const font = fontMetadata.parse(parseFont(bytes));
    expect(font.familyName).toBe(source.family);
    expect(font.subfamilyName).toBe("Regular");
    expect(font.version).toBe(source.version);
    expect(font.variationAxes).toEqual(axes[source.family]);
    expect(new Set(font.characterSet).size).toBe(source.characters);
    expect(font.characterSet).toEqual(expect.arrayContaining([0x41, 0xe9, 0xd7]));
    const license = readFileSync(resolve(licenses, source.licenseFile), "utf8");
    expect(license).toContain("Copyright");
    expect(license).toContain("SIL OPEN FONT LICENSE Version 1.1");
    expect(license.split("SIL OPEN FONT LICENSE")[0]).not.toMatch(/reserved font name/i);
    expect(sources.revision).toMatch(/^[a-f0-9]{40}$/);
    expect(source.sourceSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(sources.conversion.subset).toBe(false);
  });

  it("demonstrates Google-loader failure with the provider blocked, while every real local declaration still builds", async () => {
    const network = vi.spyOn(https, "request").mockImplementation(() => {
      throw new Error("Controlled font-provider failure");
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const emitted = new Map<string, Buffer>();
    const common = {
      variableName: "applicationFont", isDev: false, isServer: true,
      resolve: (path: string) => resolve(app, path),
      loaderContext: { fs: { readFile } },
      emitFontFile: (bytes: Buffer, extension: string) => {
        const name = createHash("sha256").update(bytes).digest("hex");
        emitted.set(name, bytes);
        return `/_next/static/media/${name}.${extension}`;
      },
    };
    await expect(googleLoader({ ...common, functionName: "Geist",
      data: [{ subsets: ["latin"], display: "swap" }] })).rejects.toThrow("Failed to fetch `Geist`");
    expect(network).toHaveBeenCalled();
    network.mockClear();
    for (const { font, directory } of [
      ...fonts.map((font) => ({ font, directory: app })),
      ...wizardFonts.map((font) => ({ font, directory: wizard })),
    ]) {
      const result = await localLoader({ ...common, functionName: "", data: [font],
        resolve: (path) => resolve(directory, path) });
      expect(result.variable).toBe(font.variable);
      expect(result.css).toContain("font-display: swap");
      expect(result.css).toContain("font-style: normal");
      expect(result.css).not.toMatch(/https?:|fonts\.gstatic/);
    }
    expect(emitted.size).toBe(5);
    expect(network).not.toHaveBeenCalled();
  });
});
