const ED_SEED = /\bsEd[^\s'"]{16,}/g;
const FAMILY_SEED = /\bs[1-9A-HJ-NP-Za-km-z]{28,}\b/g;
const SECRET_ASSIGNMENT = /\b(seed|secret|private[_ ]?key)\b\s*[:=]\s*\S+/gi;

export function redactSecrets(text: string): string {
  return text.replace(ED_SEED, '[redacted]').replace(FAMILY_SEED, '[redacted]').replace(SECRET_ASSIGNMENT, '[redacted]');
}

export function redactError(error: unknown): string {
  const message = error instanceof Error ? error.message : 'Unexpected failure';
  const cleaned = redactSecrets(message).replace(/\s+/g, ' ').trim();
  if (!cleaned) {
    return 'Unexpected failure';
  }
  return cleaned.length > 400 ? `${cleaned.slice(0, 400)}…` : cleaned;
}
