import { Capacitor } from '@capacitor/core';

// true only inside the native iOS/Android app; false on the website (wavo.lol)
export const isNativeApp = Capacitor.isNativePlatform();
