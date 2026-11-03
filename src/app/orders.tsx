import React, { useEffect, useState } from "react";
import { FlatList, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Btn, Icon } from "../components/ui";
import { naira } from "../lib/catalogue";
import { loadOrders, SavedOrder } from "../lib/storage";
import { font, useTheme } from "../lib/theme";

const when = (at: number) =>
  new Date(at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export default function Orders() {
  const t = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [orders, setOrders] = useState<SavedOrder[] | null>(null);
  useEffect(() => { loadOrders().then(setOrders); }, []);

  return (
    <View style={{ flex: 1, backgroundColor: t.bg, paddingTop: insets.top + 12 }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, marginBottom: 12 }}>
        <Text accessibilityRole="header" style={{ fontFamily: font.displayXB, fontSize: 28, color: t.text, letterSpacing: -0.5 }}>Recent orders</Text>
        <Pressable onPress={() => router.back()} accessibilityRole="button" style={{ height: 44, paddingHorizontal: 14, justifyContent: "center" }}>
          <Text style={{ fontFamily: font.semi, color: t.accent, fontSize: 16 }}>Close</Text>
        </Pressable>
      </View>
      <FlatList
        data={orders ?? []} keyExtractor={(o) => o.id}
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 24, flexGrow: 1 }}
        ListEmptyComponent={orders === null ? undefined : (
          <View style={{ paddingVertical: 48, alignItems: "center" }}>
            <Text style={{ fontFamily: font.display, fontSize: 20, color: t.text }}>No orders yet</Text>
            <Text style={{ fontFamily: font.body, color: t.haze, marginTop: 6, textAlign: "center" }}>Orders you make on this phone show up here, with their tokens.</Text>
            <Btn style={{ marginTop: 20, alignSelf: "stretch" }} label="Pay a bill" onPress={() => router.replace("/")} />
          </View>
        )}
        renderItem={({ item }) => (
          <Pressable onPress={() => (item.kind === "bulk" ? router.push({ pathname: "/bulk/[id]", params: { id: item.id } }) : router.push({ pathname: "/order/[id]", params: { id: item.id } }))} accessibilityRole="button"
            style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: t.line, opacity: pressed ? 0.7 : 1 })}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontFamily: font.semi, fontSize: 16.5, color: t.text }}>{item.biller}</Text>
              <Text style={{ fontFamily: font.body, fontSize: 14, color: t.haze, marginTop: 2 }}>{item.identifier} · {when(item.at)}</Text>
            </View>
            <Text style={{ fontFamily: font.display, fontSize: 17, color: t.text }}>{naira(item.amount)}</Text>
            <Icon name="chevron" color={t.haze} size={16} />
          </Pressable>
        )}
      />
    </View>
  );
}
