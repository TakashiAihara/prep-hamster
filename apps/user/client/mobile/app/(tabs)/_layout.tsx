import { Ionicons } from "@expo/vector-icons"
import { router, Tabs } from "expo-router"
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from "react-native"
import { signOut } from "@/auth"
import { AuthGate } from "@/auth-status"
import { CreateGroupForm } from "@/create-group-form"
import { useCurrentGroup } from "@/current-group"
import { JoinInviteForm } from "@/join-invite-form"

function confirmSignOut() {
  // ヘッダー右は Expo Go の開発メニューのボタンと重なり、それを押したつもりでサインアウトしていた。
  // 戻すには Google のサインインをやり直すことになるので、確認を挟む
  Alert.alert("サインアウトしますか？", undefined, [
    { text: "キャンセル", style: "cancel" },
    {
      text: "サインアウト",
      style: "destructive",
      onPress: () => {
        signOut().catch((err: unknown) => {
          Alert.alert(
            "サインアウトできませんでした",
            err instanceof Error ? err.message : String(err),
          )
        })
      },
    },
  ])
}

function SignOutButton() {
  return (
    <Pressable onPress={confirmSignOut} style={{ paddingHorizontal: 16 }}>
      <Text style={{ color: "#2c7be5", fontSize: 14 }}>サインアウト</Text>
    </Pressable>
  )
}

function GroupPill({ name }: { name: string }) {
  return (
    // .expo/types の型付きルートは expo start が作り直すまで古いので、auth-status.tsx と同じく as never で通す
    <Pressable onPress={() => router.push("/groups" as never)} style={styles.pill}>
      <Text style={styles.pillLabel} numberOfLines={1}>
        {name}
      </Text>
      <Ionicons name="chevron-down" size={14} color="#2c7be5" />
    </Pressable>
  )
}

// グループが決まるまでタブを出さない (一覧・追加が group id を要るため)。
function GroupGate() {
  const { status, message, group, reload } = useCurrentGroup()

  if (status === "loading") {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    )
  }
  if (status === "error") {
    return (
      <View style={styles.center}>
        <Text style={styles.error}>取得失敗: {message}</Text>
        <Pressable style={styles.retry} onPress={reload}>
          <Text style={styles.retryLabel}>再試行</Text>
        </Pressable>
      </View>
    )
  }
  if (!group) {
    return (
      <View style={styles.center}>
        <Text style={styles.title}>グループを作る</Text>
        <Text style={styles.hint}>
          まだグループに入っていません。新しく作るか、届いた招待コードで参加してください。
        </Text>
        <View style={styles.form}>
          <CreateGroupForm />
        </View>
        <Text style={styles.title}>招待コードで参加</Text>
        <View style={styles.form}>
          <JoinInviteForm />
        </View>
      </View>
    )
  }

  return (
    <Tabs
      screenOptions={{
        headerShown: true,
        headerLeft: () => <GroupPill name={group.name} />,
        headerRight: () => <SignOutButton />,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "在庫",
          // HACK: SDK 58 の tabBarIcon の color は string | number | NativeColorValue | null の型だが、
          // Ionicons は string しか受けない。タブバーは実際には文字列を渡すので型だけ合わせている。
          // @expo/vector-icons を @react-native-vector-icons/* に移すときに外す
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="list" color={color as string} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="add"
        options={{
          title: "追加",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="add-circle" color={color as string} size={size} />
          ),
        }}
      />
    </Tabs>
  )
}

export default function TabsLayout() {
  return (
    <AuthGate area="app">
      <GroupGate />
    </AuthGate>
  )
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 16, gap: 12 },
  title: { fontSize: 18, fontWeight: "600" },
  hint: { color: "#666", fontSize: 13, textAlign: "center" },
  form: { alignSelf: "stretch" },
  error: { color: "#c0392b" },
  retry: { paddingHorizontal: 16, paddingVertical: 10 },
  retryLabel: { color: "#2c7be5", fontSize: 15 },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginLeft: 16,
    maxWidth: 180,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#2c7be5",
  },
  pillLabel: { color: "#2c7be5", fontSize: 14, flexShrink: 1 },
})
