import { describe, expect, it } from 'vitest';
import { createVault, decryptNotes, encryptNotes, unlockVault } from './notes-crypto';
const password = 'a long test password';
const notes = [
  {
    id: crypto.randomUUID(),
    title: 'Private title',
    body: 'Private body\nUnicode: \u4e2d\u6587 \u{1F510}',
    updatedAt: '2026-09-21',
  },
];

describe('encrypted notes', () => {
  it('encrypts titles and bodies and unlocks independently with password or recovery key', async () => {
    const created = await createVault(password, notes);
    expect(created.key.extractable).toBe(false);
    expect(JSON.stringify(created.vault)).not.toContain('Private');
    expect(JSON.stringify(created.vault)).not.toContain(password);
    expect((await unlockVault(created.vault, password)).notes).toEqual(notes);
    expect((await unlockVault(created.vault, created.recovery, true)).notes).toEqual(notes);
    await expect(unlockVault(created.vault, 'incorrect password')).rejects.toThrow();
    await expect(unlockVault(created.vault, '0'.repeat(64), true)).rejects.toThrow();
  });
  it('authenticates metadata and content and generates fresh nonces for each save', async () => {
    const created = await createVault(password, notes);
    const first = await encryptNotes(created.key, created.vault, notes);
    const second = await encryptNotes(created.key, created.vault, notes);
    expect(first.payload.iv).not.toEqual(second.payload.iv);
    expect(first.payload.ciphertext).not.toEqual(second.payload.ciphertext);
    await expect(
      decryptNotes(created.key, { ...first, id: crypto.randomUUID() }),
    ).rejects.toThrow();
    const tampered = structuredClone(first);
    tampered.payload.ciphertext =
      (tampered.payload.ciphertext[0] === 'A' ? 'B' : 'A') + tampered.payload.ciphertext.slice(1);
    await expect(decryptNotes(created.key, tampered)).rejects.toThrow();
    await expect(unlockVault({ ...first, iterations: 1 } as never, password)).rejects.toThrow();
  });
  it('rotates all encryption keys when changing the password and rejects excessive content', async () => {
    const original = await createVault(password, notes);
    const rotated = await createVault('a different password', notes);
    await expect(unlockVault(rotated.vault, password)).rejects.toThrow();
    await expect(unlockVault(rotated.vault, original.recovery, true)).rejects.toThrow();
    expect((await unlockVault(rotated.vault, rotated.recovery, true)).notes).toEqual(notes);
    await expect(
      encryptNotes(rotated.key, rotated.vault, [{ ...notes[0]!, body: 'x'.repeat(100001) }]),
    ).rejects.toThrow();
  });
});
