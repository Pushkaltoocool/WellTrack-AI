/**
 * Account actions. Email/password works everywhere (including Expo Go). Google and Apple
 * sign-in need native modules, so they are only offered in development / store builds.
 */
import { isRunningInExpoGo } from 'expo';
import * as AppleAuthentication from 'expo-apple-authentication';
import * as Crypto from 'expo-crypto';
import {
  createUserWithEmailAndPassword,
  deleteUser,
  EmailAuthProvider,
  GoogleAuthProvider,
  OAuthProvider,
  reauthenticateWithCredential,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithCredential,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
  type User,
} from 'firebase/auth';
import { Platform } from 'react-native';

import { firebaseAuth } from './app';

export { authErrorMessage, isCancelled, validateSignUp } from './authErrors';

const GOOGLE_WEB_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;

export async function signUpWithEmail(name: string, email: string, password: string): Promise<User> {
  const cred = await createUserWithEmailAndPassword(firebaseAuth(), email.trim(), password);
  if (name.trim()) await updateProfile(cred.user, { displayName: name.trim() });
  await sendEmailVerification(cred.user).catch(() => undefined);
  return cred.user;
}

export async function signInWithEmail(email: string, password: string): Promise<User> {
  return (await signInWithEmailAndPassword(firebaseAuth(), email.trim(), password)).user;
}

export const sendPasswordReset = (email: string) => sendPasswordResetEmail(firebaseAuth(), email.trim());

export async function resendVerification(): Promise<void> {
  const u = firebaseAuth().currentUser;
  if (u && !u.emailVerified) await sendEmailVerification(u);
}

export async function refreshUser(): Promise<User | null> {
  const u = firebaseAuth().currentUser;
  if (u) await u.reload();
  return firebaseAuth().currentUser;
}

export const signOutUser = () => signOut(firebaseAuth());

export function providerIds(user: User | null): string[] {
  return user?.providerData.map((p) => p.providerId) ?? [];
}

/** Re-authenticates (required by Firebase before deleting an account that signed in a while ago). */
export async function reauthenticate(password: string | null): Promise<void> {
  const user = firebaseAuth().currentUser;
  if (!user) throw new Error('You are not signed in.');
  const providers = providerIds(user);
  if (providers.includes('password')) {
    if (!password) throw Object.assign(new Error('Enter your password.'), { code: 'auth/missing-password' });
    await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email ?? '', password));
  } else if (providers.includes('google.com')) {
    const idToken = await nativeGoogleIdToken();
    await reauthenticateWithCredential(user, GoogleAuthProvider.credential(idToken));
  } else if (providers.includes('apple.com')) {
    await reauthenticateWithCredential(user, await appleCredential());
  }
}

export async function deleteCurrentUser(): Promise<void> {
  const user = firebaseAuth().currentUser;
  if (user) await deleteUser(user);
}

// ---------- Google (native module: development / store builds only) ----------

type GoogleSigninModule = typeof import('@react-native-google-signin/google-signin');
let google: GoogleSigninModule | null | undefined;

function googleModule(): GoogleSigninModule | null {
  if (google !== undefined) return google;
  google = null;
  if (isRunningInExpoGo() || !GOOGLE_WEB_CLIENT_ID) return null;
  try {
    // Lazy so Expo Go never evaluates the native module.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    google = require('@react-native-google-signin/google-signin') as GoogleSigninModule;
    google.GoogleSignin.configure({ webClientId: GOOGLE_WEB_CLIENT_ID });
  } catch {
    google = null;
  }
  return google;
}

export const googleSignInAvailable = () => googleModule() !== null;

async function nativeGoogleIdToken(): Promise<string> {
  const m = googleModule();
  if (!m) throw new Error('Google sign-in is available in the App Store and Play Store builds.');
  await m.GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
  const res = await m.GoogleSignin.signIn();
  if (res.type !== 'success' || !res.data.idToken) throw Object.assign(new Error('Sign-in cancelled.'), { code: 'cancelled' });
  return res.data.idToken;
}

export async function signInWithGoogle(): Promise<User> {
  const idToken = await nativeGoogleIdToken();
  return (await signInWithCredential(firebaseAuth(), GoogleAuthProvider.credential(idToken))).user;
}

// ---------- Sign in with Apple (iOS builds; Expo Go tokens are issued to Expo Go, not WellTrack) ----------

export async function appleSignInAvailable(): Promise<boolean> {
  if (Platform.OS !== 'ios' || isRunningInExpoGo()) return false;
  return AppleAuthentication.isAvailableAsync().catch(() => false);
}

async function appleCredential() {
  const rawNonce = Crypto.randomUUID();
  const hashedNonce = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, rawNonce);
  const res = await AppleAuthentication.signInAsync({
    requestedScopes: [AppleAuthentication.AppleAuthenticationScope.FULL_NAME, AppleAuthentication.AppleAuthenticationScope.EMAIL],
    nonce: hashedNonce,
  });
  if (!res.identityToken) throw new Error('Apple did not return an identity token.');
  return new OAuthProvider('apple.com').credential({ idToken: res.identityToken, rawNonce });
}

export async function signInWithApple(): Promise<User> {
  const cred = await signInWithCredential(firebaseAuth(), await appleCredential());
  return cred.user;
}
