import { Redirect } from "expo-router"

// OAuth の戻り URL (prep-hamster://auth/callback) が 404 にならないための受け皿。
// code の交換は signInWithGoogle() が openAuthSessionAsync の結果から行う。
export default function AuthCallback() {
  return <Redirect href="/" />
}
