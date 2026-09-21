import * as v from 'valibot';

export const NOTES_KDF_ITERATIONS = 600_000;
export const NOTES_PLAINTEXT_LIMIT = 512 * 1024;
const base64 = (min: number, max: number) =>
  v.pipe(v.string(), v.minLength(min), v.maxLength(max), v.regex(/^[A-Za-z0-9+/]+={0,2}$/));
const boxSchema = v.strictObject({ iv: base64(16, 16), ciphertext: base64(24, 720_000) });
const wrappedKeySchema = v.strictObject({ iv: base64(16, 16), ciphertext: base64(64, 64) });
export const encryptedVaultSchema = v.strictObject({
  format: v.literal(1),
  id: v.pipe(v.string(), v.uuid()),
  salt: base64(24, 24),
  iterations: v.literal(NOTES_KDF_ITERATIONS),
  passwordKey: wrappedKeySchema,
  recoveryKey: wrappedKeySchema,
  payload: boxSchema,
});
export type EncryptedVault = v.InferOutput<typeof encryptedVaultSchema>;
export type CipherBox = EncryptedVault['payload'];
export const vaultRecordSchema = v.strictObject({
  revision: v.pipe(v.number(), v.integer(), v.minValue(1)),
  updatedAt: v.string(),
  vault: encryptedVaultSchema,
  operationId: v.pipe(v.string(), v.uuid()),
});
export type VaultRecord = v.InferOutput<typeof vaultRecordSchema>;
export const vaultWriteSchema = v.strictObject({
  expectedRevision: v.pipe(v.number(), v.integer(), v.minValue(0)),
  operationId: v.pipe(v.string(), v.uuid()),
  vault: encryptedVaultSchema,
});
export type VaultWrite = v.InferOutput<typeof vaultWriteSchema>;
