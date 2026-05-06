/// <reference types="expo/types" />
/// <reference types="expo-router/types" />

// EXPO_PUBLIC_* は process.env 経由で参照可能。型情報を補強しておく。
declare namespace NodeJS {
  interface ProcessEnv {
    EXPO_PUBLIC_API_BASE_URL?: string
    EXPO_PUBLIC_STUB_USER_ID?: string
  }
}
