import { Tabs } from "expo-router"

export default function TabsLayout() {
  return (
    <Tabs screenOptions={{ headerShown: true }}>
      <Tabs.Screen name="index" options={{ title: "在庫" }} />
      <Tabs.Screen name="add" options={{ title: "追加" }} />
    </Tabs>
  )
}
