// scripts/migrate-custom-skills.ts
//
// Moves legacy custom skills from <WORKSPACE_BASE_PATH>/skills/custom/{userId}/...
// into <WORKSPACE_BASE_PATH>/users/{userId}/workspace/skills/...
//
// Idempotent: re-running is a no-op if there is nothing to move.
// Collisions: if the target skill directory already exists, the source is left
// in place and a warning is logged.

import * as fs from 'fs/promises';
import * as path from 'path';

async function main() {
  const base = process.env['WORKSPACE_BASE_PATH'] ?? './data';
  const legacyRoot = path.resolve(base, 'skills/custom');

  let userDirs: string[];
  try {
    userDirs = await fs.readdir(legacyRoot);
  } catch {
    console.log(`[migrate] No legacy directory at ${legacyRoot} — nothing to do.`);
    return;
  }

  let moved = 0;
  let skipped = 0;

  for (const userId of userDirs) {
    const sourceUserDir = path.join(legacyRoot, userId);
    const sourceStat = await fs.stat(sourceUserDir).catch(() => null);
    if (!sourceStat || !sourceStat.isDirectory()) continue;

    const skillEntries = await fs.readdir(sourceUserDir, { withFileTypes: true });
    const realSkills = skillEntries.filter((e) => e.isDirectory());
    if (realSkills.length === 0) {
      // Nothing to migrate for this user; let the cleanup block below handle the empty source dir.
      continue;
    }

    const targetSkillsDir = path.resolve(base, 'users', userId, 'workspace', 'skills');
    await fs.mkdir(targetSkillsDir, { recursive: true });

    for (const entry of realSkills) {
      const source = path.join(sourceUserDir, entry.name);
      const target = path.join(targetSkillsDir, entry.name);

      const targetExists = await fs
        .stat(target)
        .then(() => true)
        .catch(() => false);
      if (targetExists) {
        console.warn(
          `[migrate] SKIP collision: ${target} already exists; leaving ${source} in place.`,
        );
        skipped++;
        continue;
      }
      await fs.rename(source, target);
      console.log(`[migrate] Moved ${source} -> ${target}`);
      moved++;
    }

    // Try to clean up empty source dir
    const remaining = await fs.readdir(sourceUserDir).catch(() => []);
    if (remaining.length === 0) await fs.rmdir(sourceUserDir).catch(() => undefined);
  }

  // Try to clean up empty legacy root
  const remainingRoot = await fs.readdir(legacyRoot).catch(() => []);
  if (remainingRoot.length === 0) await fs.rmdir(legacyRoot).catch(() => undefined);

  console.log(`[migrate] Done. Moved ${moved} skill(s), skipped ${skipped} collision(s).`);
}

main().catch((err) => {
  console.error('[migrate] Fatal error:', err);
  process.exit(1);
});
