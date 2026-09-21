import * as v from 'valibot';
import {
  encryptedVaultSchema,
  NOTES_KDF_ITERATIONS,
  NOTES_PLAINTEXT_LIMIT,
  type CipherBox,
  type EncryptedVault,
} from '../../shared/notes/contracts';

export type NoteRevision = { revision: number; title: string; body: string; savedAt: string };
export type Note = {
  id: string;
  title: string;
  body: string;
  updatedAt: string;
  history?: NoteRevision[];
};
const noteSchema = v.strictObject({
  id: v.pipe(v.string(), v.uuid()),
  title: v.pipe(v.string(), v.maxLength(300)),
  body: v.pipe(v.string(), v.maxLength(100_000)),
  updatedAt: v.string(),
  history: v.optional(
    v.array(
      v.strictObject({
        revision: v.pipe(v.number(), v.integer(), v.minValue(1)),
        title: v.pipe(v.string(), v.maxLength(300)),
        body: v.pipe(v.string(), v.maxLength(100_000)),
        savedAt: v.string(),
      }),
    ),
  ),
});
const contentsSchema = v.strictObject({
  format: v.literal(1),
  notes: v.pipe(v.array(noteSchema), v.maxLength(500)),
});
const encoder = new TextEncoder();
const random = (length: number) => crypto.getRandomValues(new Uint8Array(length));
const base64 = (bytes: Uint8Array): string => {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
};
const bytes = (value: string): Uint8Array<ArrayBuffer> =>
  Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
const importKey = (raw: Uint8Array<ArrayBuffer>) =>
  crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
const derive = async (password: string, salt: string) => {
  const material = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, [
    'deriveKey',
  ]);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: bytes(salt), iterations: NOTES_KDF_ITERATIONS },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
};
const aad = (id: string, purpose: string) => encoder.encode(`startree:notes:v1:${id}:${purpose}`);
const seal = async (
  key: CryptoKey,
  plaintext: Uint8Array<ArrayBuffer>,
  id: string,
  purpose: string,
): Promise<CipherBox> => {
  const iv = random(12);
  const cipher = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: aad(id, purpose), tagLength: 128 },
    key,
    plaintext,
  );
  return { iv: base64(iv), ciphertext: base64(new Uint8Array(cipher)) };
};
const open = async (key: CryptoKey, box: CipherBox, id: string, purpose: string) =>
  new Uint8Array(
    await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: bytes(box.iv), additionalData: aad(id, purpose), tagLength: 128 },
      key,
      bytes(box.ciphertext),
    ),
  );
const recoveryBytes = (recovery: string): Uint8Array<ArrayBuffer> => {
  const normalized = recovery.replace(/[\s-]/g, '').toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalized)) throw new Error('Invalid recovery key.');
  return Uint8Array.from(normalized.match(/../g)!, (pair) => parseInt(pair, 16));
};
export const encryptNotes = async (
  key: CryptoKey,
  vault: EncryptedVault,
  notes: Note[],
): Promise<EncryptedVault> => {
  const contents = v.parse(contentsSchema, { format: 1, notes });
  const plaintext = encoder.encode(JSON.stringify(contents));
  if (plaintext.byteLength > NOTES_PLAINTEXT_LIMIT)
    throw new Error(
      'Notes and version history exceed the 512 KB limit. Export a backup and remove unneeded notes. Existing saved versions have not been changed.',
    );
  try {
    return { ...vault, payload: await seal(key, plaintext, vault.id, 'contents') };
  } finally {
    plaintext.fill(0);
  }
};
export const decryptNotes = async (key: CryptoKey, vault: EncryptedVault): Promise<Note[]> => {
  const plaintext = await open(key, vault.payload, vault.id, 'contents');
  try {
    return v.parse(contentsSchema, JSON.parse(new TextDecoder().decode(plaintext))).notes;
  } finally {
    plaintext.fill(0);
  }
};
export const unlockVault = async (input: EncryptedVault, secret: string, recovery = false) => {
  const vault = v.parse(encryptedVaultSchema, input);
  const wrappingKey = recovery
    ? await importKey(recoveryBytes(secret))
    : await derive(secret, vault.salt);
  const raw = await open(
    wrappingKey,
    recovery ? vault.recoveryKey : vault.passwordKey,
    vault.id,
    recovery ? 'recovery-key' : 'password-key',
  );
  try {
    const key = await importKey(raw);
    return { key, notes: await decryptNotes(key, vault) };
  } finally {
    raw.fill(0);
  }
};
export const createVault = async (password: string, notes: Note[] = []) => {
  if (password.length < 12) throw new Error('Use at least 12 characters for your notes password.');
  const id = crypto.randomUUID();
  const salt = base64(random(16));
  const raw = random(32);
  const recoveryRaw = random(32);
  const recovery = Array.from(recoveryRaw, (byte) => byte.toString(16).padStart(2, '0'))
    .join('')
    .match(/.{8}/g)!
    .join('-');
  try {
    const key = await importKey(raw);
    const vault: EncryptedVault = {
      format: 1,
      id,
      salt,
      iterations: NOTES_KDF_ITERATIONS,
      passwordKey: await seal(await derive(password, salt), raw, id, 'password-key'),
      recoveryKey: await seal(await importKey(recoveryRaw), raw, id, 'recovery-key'),
      payload: { iv: '', ciphertext: '' },
    };
    return { key, recovery, vault: await encryptNotes(key, vault, notes) };
  } finally {
    raw.fill(0);
    recoveryRaw.fill(0);
  }
};
