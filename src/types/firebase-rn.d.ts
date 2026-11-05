// @firebase/auth lists its generic `types` entry before the `react-native` condition, so TypeScript
// never sees the React Native typings. Metro does load the RN build at runtime, which exports this.
import type { Persistence } from 'firebase/auth';

declare module 'firebase/auth' {
  export function getReactNativePersistence(storage: {
    getItem(key: string): Promise<string | null>;
    setItem(key: string, value: string): Promise<void>;
    removeItem(key: string): Promise<void>;
  }): Persistence;
}
