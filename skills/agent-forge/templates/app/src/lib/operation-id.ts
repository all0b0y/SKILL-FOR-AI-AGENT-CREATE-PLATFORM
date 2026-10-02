import { createHash } from 'node:crypto';

/** A stable UUID per operation key, enforcing idempotency at the side-effect table itself. */
export function operationId(...key: string[]): string {
  const bytes = createHash('sha256').update(JSON.stringify(key)).digest().subarray(0, 16);
  bytes.writeUInt8((bytes.readUInt8(6) & 0x0f) | 0x50, 6);
  bytes.writeUInt8((bytes.readUInt8(8) & 0x3f) | 0x80, 8);
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
