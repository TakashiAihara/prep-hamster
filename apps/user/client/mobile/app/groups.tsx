import { router } from "expo-router"
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native"
import { CreateGroupForm } from "@/create-group-form"
import { useCurrentGroup } from "@/current-group"

// グループ切替 (M-10)。root の Stack の modal として開く。
export default function GroupsScreen() {
  const { group, groups, select } = useCurrentGroup()

  return (
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      <View style={styles.list}>
        {groups.map((g) => (
          <Pressable
            key={g.id}
            style={styles.row}
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

      <Text style={styles.heading}>新しいグループを作る</Text>
      <CreateGroupForm onCreated={() => router.back()} />
    </ScrollView>
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
  heading: { fontSize: 14, fontWeight: "600", color: "#333" },
})
