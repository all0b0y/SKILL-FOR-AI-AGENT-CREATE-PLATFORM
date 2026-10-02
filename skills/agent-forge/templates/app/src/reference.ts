/** Operator-selected, persisted reference identity. No request can invent a tool allowlist. */
export type Reference = 'support' | 'researcher' | 'background';
/** Validate an explicit or operator-default reference identity. Reject unknown profiles instead of silently assigning support permissions. */
export function referenceOf(value: string = process.env.AF_REFERENCE ?? 'support'): Reference {
  if (value === 'support' || value === 'researcher' || value === 'background') return value;
  throw new Error('AF_REFERENCE must be support, researcher or background');
}
