/** Audit a parsed public API inventory against source text and selected specification documents. */
export function checkApiContract(
  sources: ReadonlyMap<string, string>,
  input: unknown,
  documents: { spec: string; architecture: string },
  hasProductSpec: boolean,
): string[];
