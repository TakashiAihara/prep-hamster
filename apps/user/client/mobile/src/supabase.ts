// oxlint-disable-next-line import/no-unassigned-import
import "react-native-get-random-values"
import AsyncStorage from "@react-native-async-storage/async-storage"
import { createClient } from "@supabase/supabase-js"
import * as aesjs from "aes-js"
import * as SecureStore from "expo-secure-store"
import { AppState, type AppStateStatus } from "react-native"

// SecureStore は 1 値 2048 バイトまでしか入らないので、セッション本体は AsyncStorage に
// AES で暗号化して置き、鍵だけを SecureStore に置く。
class LargeSecureStore {
  private async encrypt(key: string, value: string): Promise<string> {
    const keyBytes = new Uint8Array(32)
    crypto.getRandomValues(keyBytes)
    await SecureStore.setItemAsync(key, aesjs.utils.hex.fromBytes(keyBytes))
    const cipher = new aesjs.ModeOfOperation.ctr(keyBytes, new aesjs.Counter(1))
    return aesjs.utils.hex.fromBytes(cipher.encrypt(aesjs.utils.utf8.toBytes(value)))
  }

  private async decrypt(key: string, value: string): Promise<string | null> {
    const keyHex = await SecureStore.getItemAsync(key)
    // 鍵が消えていれば暗号文は復号できないので、未サインインとして扱う
    if (!keyHex) return null
    const cipher = new aesjs.ModeOfOperation.ctr(
      aesjs.utils.hex.toBytes(keyHex),
      new aesjs.Counter(1),
    )
    return aesjs.utils.utf8.fromBytes(cipher.decrypt(aesjs.utils.hex.toBytes(value)))
  }

  async getItem(key: string): Promise<string | null> {
    const encrypted = await AsyncStorage.getItem(key)
    if (!encrypted) return null
    return this.decrypt(key, encrypted)
  }

  async setItem(key: string, value: string): Promise<void> {
    await AsyncStorage.setItem(key, await this.encrypt(key, value))
  }

  async removeItem(key: string): Promise<void> {
    await AsyncStorage.removeItem(key)
    await SecureStore.deleteItemAsync(key)
  }
}

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL
const supabasePublishableKey = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY
if (!supabaseUrl || !supabasePublishableKey) {
  throw new Error("EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY is not set")
}

export const supabase = createClient(supabaseUrl, supabasePublishableKey, {
  auth: {
    storage: new LargeSecureStore(),
    flowType: "pkce",
    autoRefreshToken: true,
    persistSession: true,
    // コールバック URL は auth/callback 画面で受けて exchangeCodeForSession するので、SDK 側の URL 解析は要らない
    detectSessionInUrl: false,
  },
})

// バックグラウンドではトークン更新を止め、前面に戻ったら再開する
AppState.addEventListener("change", (state: AppStateStatus) => {
  if (state === "active") {
    supabase.auth.startAutoRefresh()
  } else {
    supabase.auth.stopAutoRefresh()
  }
})
