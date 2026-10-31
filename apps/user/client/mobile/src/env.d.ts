/// <reference types="expo/types" />
/// <reference types="expo-router/types" />

// expo-env.d.ts は expo start が作り直すので (gitignore 済み)、型の補強はここに置く。
// EXPO_PUBLIC_* は process.env 経由で参照可能。
declare namespace NodeJS {
  interface ProcessEnv {
    EXPO_PUBLIC_API_BASE_URL?: string
    EXPO_PUBLIC_SUPABASE_URL?: string
    EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY?: string
    EXPO_PUBLIC_STUB_GROUP_ID?: string
  }
}
