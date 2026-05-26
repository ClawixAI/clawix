import fs from 'node:fs/promises';
import path from 'node:path';
import url from 'node:url';

const TEMPLATE_PATH = path.join(
  path.dirname(url.fileURLToPath(import.meta.url)),
  'schema-template.md',
);

let cached: string | null = null;

export async function loadSchemaTemplate(): Promise<string> {
  if (cached === null) cached = await fs.readFile(TEMPLATE_PATH, 'utf-8');
  return cached;
}
