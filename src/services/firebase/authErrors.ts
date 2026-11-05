/** Pure helpers for account flows (no Firebase imports, unit-tested). */

/** Turns Firebase error codes into sentences a person can act on. */
export function authErrorMessage(e: unknown): string {
  const code = typeof e === 'object' && e && 'code' in e ? String((e as { code: unknown }).code) : '';
  const map: Record<string, string> = {
    'auth/invalid-email': 'That email address doesn’t look right.',
    'auth/missing-password': 'Enter your password.',
    'auth/weak-password': 'Use at least 8 characters for your password.',
    'auth/email-already-in-use': 'An account already uses this email. Try signing in instead.',
    'auth/invalid-credential': 'Email or password is incorrect.',
    'auth/wrong-password': 'Email or password is incorrect.',
    'auth/user-not-found': 'Email or password is incorrect.',
    'auth/user-disabled': 'This account has been disabled.',
    'auth/too-many-requests': 'Too many attempts. Wait a few minutes and try again.',
    'auth/network-request-failed': 'You appear to be offline. Check your connection and try again.',
    'auth/requires-recent-login': 'For your security, please confirm your password first.',
    'auth/operation-not-allowed': 'This sign-in method isn’t enabled yet.',
  };
  if (map[code]) return map[code];
  if (e instanceof Error && e.message) return e.message;
  return 'Something went wrong. Please try again.';
}

export function validateSignUp(name: string, email: string, password: string): string | null {
  if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return 'Enter a valid email address.';
  if (password.length < 8) return 'Use at least 8 characters for your password.';
  if (name.trim().length > 40) return 'Keep your name under 40 characters.';
  return null;
}

export function isCancelled(e: unknown): boolean {
  const code = typeof e === 'object' && e && 'code' in e ? String((e as { code: unknown }).code) : '';
  return code === 'cancelled' || code === 'ERR_REQUEST_CANCELED' || code === 'SIGN_IN_CANCELLED' || code === '-5';
}
