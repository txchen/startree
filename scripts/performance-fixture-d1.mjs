import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { buildPerformanceFixture } from './performance-fixture.mjs';
import { run } from './process.mjs';

const COUNT_SQL =
  "SELECT (SELECT COUNT(*) FROM bookmark_folders WHERE id != '00000000-0000-4000-8000-000000000000') AS folders, (SELECT COUNT(*) FROM bookmarks) AS bookmarks";

export const loadAndVerifyPerformanceFixture = ({
  fixtureCase,
  directory,
  environment,
  locationArgs,
  profile,
}) => {
  const fixture = buildPerformanceFixture(fixtureCase);
  const file = join(directory, `${fixtureCase}.sql`);
  writeFileSync(file, fixture.sql);
  const profileArgs = profile ? ['--profile', profile] : [];
  const d1Args = (operation) => [
    'wrangler',
    'd1',
    operation,
    'DB',
    ...locationArgs,
    '--env',
    environment,
  ];
  run('npx', [...d1Args('execute'), '--file', file, ...profileArgs], { capture: true });
  const output = run(
    'npx',
    [...d1Args('execute'), '--command', COUNT_SQL, '--json', ...profileArgs],
    { capture: true },
  );
  const counts = JSON.parse(output)[0]?.results?.[0];
  if (
    counts?.folders !== fixture.manifest.folders ||
    counts?.bookmarks !== fixture.manifest.bookmarks
  ) {
    throw new Error(`${fixtureCase} fixture did not load with the expected counts.`);
  }
  return fixture.manifest;
};
