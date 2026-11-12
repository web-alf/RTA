import type { AuthUser } from './auth';
import { SENSITIVE_ROLES } from './permissions';

export const FAMILY_SENSITIVE = ['waPhone', 'backupPhone', 'address', 'fatherJob', 'motherJob'];
export const STUDENT_SENSITIVE = ['healthNotes', 'subsidyLabel'];
export const MASK = 'Disembunyikan';

export function canSeeSensitive(user: AuthUser) {
  return SENSITIVE_ROLES.includes(user.role);
}

export function mask<T extends Record<string, any>>(user: AuthUser, row: T, fields: string[]): T {
  if (canSeeSensitive(user)) return row;
  const out: any = { ...row };
  for (const f of fields) if (f in out && out[f] != null) out[f] = MASK;
  return out;
}
