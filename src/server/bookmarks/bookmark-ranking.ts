import type { BookmarkDatabase } from './bookmark-database';

declare const rankBrand: unique symbol;
export type Rank = string & { readonly [rankBrand]: true };
export type RankedRow = { id: string; rank: Rank };

export const toRank = (value: string): Rank => value as Rank;
export const compareText = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

export const nextRank = async (
  database: BookmarkDatabase,
  table: 'bookmark_folders' | 'bookmarks',
  parentColumn: 'parent_id' | 'folder_id',
  parentId: string,
): Promise<Rank> => {
  const row = await database
    .prepare(
      `SELECT MAX(rank) AS rank FROM ${table}
        WHERE ${parentColumn} = ? AND trashed_at IS NULL AND trash_root_id IS NULL`,
    )
    .bind(parentId)
    .first<{ rank: string | null }>();
  return row?.rank ? rankAfter(row.rank) : rebalancedRank(0);
};

const RANK_ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

const rankBetween = (lower: Rank | null, upper: Rank | null): Rank | null => {
  let result = '';
  let upperOpen = upper === null;
  for (let index = 0; index < 64; index += 1) {
    const lowerDigit = lower === null ? 0 : (RANK_ALPHABET.indexOf(lower[index] ?? '0') ?? 0);
    const upperDigit = upperOpen
      ? RANK_ALPHABET.length - 1
      : RANK_ALPHABET.indexOf(upper?.[index] ?? '0');
    if (lowerDigit < 0 || upperDigit < 0 || lowerDigit > upperDigit) return null;
    if (upperDigit - lowerDigit > 1) {
      return toRank(`${result}${RANK_ALPHABET[Math.floor((lowerDigit + upperDigit) / 2)]}`);
    }
    result += RANK_ALPHABET[lowerDigit];
    if (lowerDigit < upperDigit) upperOpen = true;
  }
  return null;
};

const RANK_WIDTH = 12;
const RANK_STEP = 1_000_000;

const rebalancedRank = (index: number): Rank =>
  toRank(((index + 1) * RANK_STEP).toString(36).padStart(RANK_WIDTH, '0'));

const rankAfter = (rank: string): Rank => {
  let start = rank.length;
  while (start > 0 && RANK_ALPHABET.includes(rank[start - 1]!)) start -= 1;
  for (let offset = start; offset < rank.length; offset += RANK_WIDTH) {
    const block = rank.slice(offset, offset + RANK_WIDTH).padEnd(RANK_WIDTH, '0');
    const high = BigInt(parseInt(block.slice(0, 6), 36));
    const low = BigInt(parseInt(block.slice(6), 36));
    const advanced = (high * 36n ** 6n + low + BigInt(RANK_STEP)).toString(36);
    if (advanced.length <= RANK_WIDTH) {
      return toRank(rank.slice(0, offset) + advanced.padStart(RANK_WIDTH, '0'));
    }
  }
  return toRank(rank + rebalancedRank(0));
};

export const positionedRanks = (
  siblings: RankedRow[],
  movingId: string,
  beforeId?: string,
): { ranks: Map<string, Rank>; rebalanced: boolean } | null => {
  const remaining = siblings.filter((item) => item.id !== movingId);
  const insertionIndex = beforeId
    ? remaining.findIndex((item) => item.id === beforeId)
    : remaining.length;
  if (beforeId && insertionIndex < 0) return null;
  const previous = remaining[insertionIndex - 1]?.rank ?? null;
  const following = remaining[insertionIndex]?.rank ?? null;
  const rank = rankBetween(previous, following);
  if (rank) return { ranks: new Map([[movingId, rank]]), rebalanced: false };
  const ordered = [...remaining];
  ordered.splice(insertionIndex, 0, { id: movingId, rank: toRank('') });
  return {
    ranks: new Map(ordered.map((item, index) => [item.id, rebalancedRank(index)])),
    rebalanced: true,
  };
};

export const organizationPositions = async (
  database: BookmarkDatabase,
  table: 'bookmark_folders' | 'bookmarks',
  parentColumn: 'parent_id' | 'folder_id',
  destinationId: string,
  movingId: string,
  beforeId?: string,
) => {
  const siblings = await database
    .prepare(
      `SELECT id, rank FROM ${table}
        WHERE ${parentColumn} = ? AND trashed_at IS NULL AND trash_root_id IS NULL
        ORDER BY rank, id`,
    )
    .bind(destinationId)
    .all<RankedRow>();
  return positionedRanks(siblings.results, movingId, beforeId);
};

export const updatedOrganizationItems = <
  Item extends { id: string; rank: string; version: number },
>(
  siblings: Item[],
  ranks: Map<string, Rank>,
  moving: Item,
  timestamp: string,
  relocate: (item: Item) => Item,
): Item[] | null => {
  const byId = new Map(siblings.map((item) => [item.id, item]));
  byId.set(moving.id, moving);
  const updated: Item[] = [];
  for (const [id, rank] of ranks) {
    const item = byId.get(id);
    if (!item) return null;
    updated.push(
      id === moving.id
        ? { ...relocate(item), rank, modifiedAt: timestamp, version: item.version + 1 }
        : { ...item, rank },
    );
  }
  return updated;
};
