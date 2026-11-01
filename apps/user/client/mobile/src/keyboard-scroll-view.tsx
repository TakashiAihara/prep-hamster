import { KeyboardAvoidingView, Platform, ScrollView, type ScrollViewProps } from "react-native"

// 入力欄の下にボタンがある画面用。キーボードの外を触る / ドラッグすると閉じ、入力欄とボタンはキーボードの上に残る。
// iOS は ScrollView が実際のキーボードとの重なりで余白を足すので、ヘッダの有無で値がずれない。
// Android は edge-to-edge でウィンドウが縮まないため、KeyboardAvoidingView の padding で ScrollView を縮める
export function KeyboardScrollView(props: ScrollViewProps) {
  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === "android" ? "padding" : undefined}
    >
      <ScrollView
        automaticallyAdjustKeyboardInsets
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
        {...props}
      />
    </KeyboardAvoidingView>
  )
}
