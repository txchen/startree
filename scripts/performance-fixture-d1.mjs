import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { buildPerformanceFixture } from './performance-fixture.mjs';
import { d1Query } from './cloudflare.mjs';

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
  const options = { profile, locationArgs };
  // Only synthetic local/preview fixtures may be reset; never target Owner data.
  if (!['local', 'preview'].includes(environment))
    throw new Error('Fixture imports cannot target production.');
  for (let index = 0; index < fixture.statements.length; index += 20) {
    d1Query(fixture.statements.slice(index, index + 20), environment, options);
  }
  const counts = d1Query(COUNT_SQL, environment, options)[0]?.results?.[0];
  if (
    counts?.folders !== fixture.manifest.folders ||
    counts?.bookmarks !== fixture.manifest.bookmarks
  ) {
    throw new Error(`${fixtureCase} fixture did not load with the expected counts.`);
  }
  return fixture.manifest;
};
