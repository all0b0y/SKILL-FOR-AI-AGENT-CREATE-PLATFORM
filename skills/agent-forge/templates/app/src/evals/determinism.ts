import { createHash } from 'node:crypto';

/** Stable eval-only inputs; production keeps its clock and database-generated IDs. */
export function evalRunOptions(caseId: string, repetition: number) {
  let sequence = 0;
  return {
    today: '2026-01-01',
    ticketId: (): string => {
      const bytes = createHash('sha256')
        .update(JSON.stringify([caseId, repetition, sequence++]))
        .digest();
      bytes[6] = (bytes.readUInt8(6) & 0x0f) | 0x40;
      bytes[8] = (bytes.readUInt8(8) & 0x3f) | 0x80;
      const hex = bytes.subarray(0, 16).toString('hex');
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    },
  };
}
