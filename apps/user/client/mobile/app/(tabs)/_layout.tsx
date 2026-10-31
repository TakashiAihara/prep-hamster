import { Ionicons } from "@expo/vector-icons"
import { Tabs } from "expo-router"
import { Pressable, Text } from "react-native"
import { signOut } from "@/auth"

function SignOutButton() {
  return (
    <Pressable onPress={() => void signOut()} style={{ paddingHorizontal: 16 }}>
      <Text style={{ color: "#2c7be5", fontSize: 14 }}>サインアウト</Text>
    </Pressable>
  )
}

export default function TabsLayout() {
  return (
    <Tabs screenOptions={{ headerShown: true, headerRight: () => <SignOutButton /> }}>
      <Tabs.Screen
        name="index"
        options={{
          title: "在庫",
          tabBarIcon: ({ color, size }) => <Ionicons name="list" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="add"
        options={{
          title: "追加",
          tabBarIcon: ({ color, size }) => <Ionicons name="add-circle" color={color} size={size} />,
        }}
      />
    </Tabs>
  )
}
