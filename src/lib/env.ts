import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const envPath = path.join(process.cwd(), ".env");

type EnvFile = {
  lines: string[];
  values: Map<string, string>;
};

function parseEnvLine(line: string) {
  const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
  if (!match) {
    return null;
  }

  const [, key, rawValue] = match;
  const trimmedValue = rawValue.trim();

  if (
    (trimmedValue.startsWith('"') && trimmedValue.endsWith('"')) ||
    (trimmedValue.startsWith("'") && trimmedValue.endsWith("'"))
  ) {
    return {
      key,
      value: trimmedValue.slice(1, -1),
    };
  }

  return {
    key,
    value: trimmedValue,
  };
}

async function readEnvFile(): Promise<EnvFile> {
  const raw = await readFile(envPath, "utf8").catch(() => "");
  const lines = raw ? raw.split(/\r?\n/) : [];
  const values = new Map<string, string>();

  for (const line of lines) {
    const parsed = parseEnvLine(line);
    if (!parsed) continue;
    values.set(parsed.key, parsed.value);
  }

  return { lines, values };
}

function normalizeEnvValue(value: string) {
  if (value === "") {
    return "";
  }

  if (/[\s#"'\\]/.test(value)) {
    return JSON.stringify(value);
  }

  return value;
}

export async function getEnvValue(key: string) {
  const envFile = await readEnvFile();
  return envFile.values.get(key) ?? "";
}

export async function setEnvValue(key: string, value: string) {
  const envFile = await readEnvFile();
  const serializedLine = `${key}=${normalizeEnvValue(value)}`;
  const nextLines = [...envFile.lines];
  let replaced = false;

  for (let index = 0; index < nextLines.length; index += 1) {
    const parsed = parseEnvLine(nextLines[index] ?? "");
    if (!parsed || parsed.key !== key) continue;
    nextLines[index] = serializedLine;
    replaced = true;
  }

  if (!replaced) {
    if (nextLines.length && nextLines.at(-1) !== "") {
      nextLines.push("");
    }
    nextLines.push(serializedLine);
  }

  const content = `${nextLines.filter((line, index, lines) => !(line === "" && index === lines.length - 1)).join("\n")}\n`;
  await writeFile(envPath, content, "utf8");
}

export async function hasAlphaVantageApiKey() {
  return Boolean((await getEnvValue("ALPHA_VANTAGE_API_KEY")).trim());
}
