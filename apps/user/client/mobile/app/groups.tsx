import { Redirect, router } from "expo-router"
import { useState } from "react"
import { Pressable, Share, StyleSheet, Text, View } from "react-native"
import { getApiClient } from "@/api"
import { apiErrorMessage } from "@/api-error"
import { CreateGroupForm } from "@/create-group-form"
import { useCurrentGroup } from "@/current-group"
import { inviteMessage } from "@/invite-code"
import { JoinInviteForm } from "@/join-invite-form"
import { KeyboardScrollView } from "@/keyboard-scroll-view"

// OWNER 以外は API が 403 を返すので、その message をそのまま出す。成功なら null
async function shareInvitation(groupId: string, groupName: string): Promise<string | null> {
  const res = await getApiClient().v1.groups[":groupId"].invitations.$post({
    param: { groupId },
    json: { role: "EDITOR" },
  })
  if (!res.ok) return apiErrorMessage(res, `招待できませんでした (HTTP ${res.status})`)
  const { invitation } = await res.json()
  await Share.share({ message: inviteMessage(groupName, invitation.token, invitation.expiresAt) })
  return null
}

// グループ切替 (M-10)。root の Stack の modal として開く。
export default function GroupsScreen() {
  const { status, group, groups, select, busy } = useCurrentGroup()
  const [inviting, setInviting] = useState(false)
  const [inviteError, setInviteError] = useState<string | null>(null)

  // 未サインインや読み込み前に deep link で開かれたら、作れない作成フォームを出さずに入口へ戻す
  if (status !== "ok") return <Redirect href="/" />

  return (
    <KeyboardScrollView contentContainerStyle={styles.container}>
      <View style={styles.list}>
        {groups.map((g) => (
          <Pressable
            key={g.id}
            style={[styles.row, busy && styles.disabled]}
            // 作成・参加の応答待ちの間に選ぶと、応答でもう一度閉じたり選択を奪い合ったりするので押させない
            disabled={busy}
            onPress={() => {
              select(g.id)
              router.back()
            }}
          >
            <Text style={styles.name}>{g.name}</Text>
            {g.id === group?.id ? <Text style={styles.current}>選択中</Text> : null}
          </Pressable>
        ))}
      </View>

      {group ? (
        <View style={styles.section}>
          <Pressable
            style={[styles.secondary, inviting && styles.disabled]}
            disabled={inviting}
            onPress={async () => {
              setInviting(true)
              setInviteError(null)
              try {
                setInviteError(await shareInvitation(group.id, group.name))
              } catch (err) {
                setInviteError(err instanceof Error ? err.message : "unknown")
              } finally {
                setInviting(false)
              }
            }}
          >
            <Text style={styles.secondaryLabel}>このグループに招待する</Text>
          </Pressable>
          {inviteError ? <Text style={styles.error}>{inviteError}</Text> : null}
        </View>
      ) : null}

      <Text style={styles.heading}>招待コードで参加</Text>
      <JoinInviteForm onJoined={() => router.back()} />

      <Text style={styles.heading}>新しいグループを作る</Text>
      <CreateGroupForm onCreated={() => router.back()} />
    </KeyboardScrollView>
  )
}

const styles = StyleSheet.create({
  container: { padding: 16, gap: 20 },
  list: { gap: 8 },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  // 幅を指定しないと Android は見積もった文字幅で描き、末尾の文字が欠けることがある
  name: { flex: 1, fontSize: 15, marginRight: 8 },
  current: { color: "#2c7be5", fontSize: 13, fontWeight: "600" },
  section: { gap: 8 },
  secondary: {
    borderWidth: 1,
    borderColor: "#2c7be5",
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
  },
  disabled: { opacity: 0.5 },
  secondaryLabel: { color: "#2c7be5", fontSize: 16, fontWeight: "600" },
  error: { color: "#c0392b" },
  heading: { fontSize: 14, fontWeight: "600", color: "#333" },
})
