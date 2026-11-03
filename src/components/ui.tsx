import React, { useMemo, useState } from "react";
import {
  ActivityIndicator, FlatList, Modal, Pressable, StyleSheet, Text, TextInput, TextInputProps, View, ViewStyle,
} from "react-native";
import Svg, { Circle, Path, Rect } from "react-native-svg";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { font, useTheme } from "../lib/theme";

export function Logo({ size = 26 }: { size?: number }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
      <Svg width={size} height={size} viewBox="0 0 64 64" fill="none">
        <Circle cx="32" cy="32" r="15" stroke={t.cta} strokeWidth="7.5" />
        <Path d="M25 32 q3.5 -5 7 0 t7 0" stroke={t.cta} strokeWidth="3" strokeLinecap="round" />
      </Svg>
      <Text style={{ fontFamily: font.displayXB, fontSize: size * 0.95, color: t.text, letterSpacing: -0.5 }}>nolgic</Text>
    </View>
  );
}

export function Icon({ name, color, size = 22 }: { name: string; color: string; size?: number }) {
  const p = { stroke: color, strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, fill: "none" };
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {name === "bolt" && <Path d="M13 2L5 13.5h6L10 22l9-12h-6.2L13 2z" {...p} />}
      {name === "tv" && (<><Rect x="3" y="5" width="18" height="12" rx="2" {...p} /><Path d="M8 21h8M12 17v4" {...p} /></>)}
      {name === "phone" && (<><Rect x="7" y="2.5" width="10" height="19" rx="2.5" {...p} /><Path d="M11 18.5h2" {...p} /></>)}
      {name === "wifi" && (<><Path d="M3 9.5a14 14 0 0118 0M6 13a9.5 9.5 0 0112 0M9.3 16.4a5 5 0 015.4 0" {...p} /><Circle cx="12" cy="19.5" r="1.2" fill={color} /></>)}
      {name === "check" && <Path d="M5 12.5l4.5 4.5L19 7.5" {...p} strokeWidth={3} />}
      {name === "chevron" && <Path d="M6 9l6 6 6-6" {...p} strokeWidth={2.5} />}
      {name === "clock" && (<><Circle cx="12" cy="12" r="9" {...p} /><Path d="M12 7v5l3 2" {...p} /></>)}
      {name === "alert" && (<><Circle cx="12" cy="12" r="9" {...p} /><Path d="M12 7v6M12 17.2v.1" {...p} strokeWidth={3} /></>)}
      {name === "search" && (<><Circle cx="11" cy="11" r="6.5" {...p} /><Path d="M16 16l5 5" {...p} /></>)}
      {name === "sun" && (<><Circle cx="12" cy="12" r="4" {...p} /><Path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" {...p} /></>)}
      {name === "moon" && <Path d="M20 14.5A8 8 0 019.5 4a8 8 0 1010.5 10.5z" {...p} />}
      {name === "auto" && (<><Circle cx="12" cy="12" r="8.5" {...p} /><Path d="M12 3.5v17a8.5 8.5 0 000-17z" fill={color} stroke={color} strokeWidth={1} /></>)}
      {name === "list" && <Path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01" {...p} strokeWidth={2.6} />}
    </Svg>
  );
}

export function Card({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  const t = useTheme();
  return <View style={[{ backgroundColor: t.panel, borderColor: t.line, borderWidth: 1, borderRadius: 24, padding: 20 }, style]}>{children}</View>;
}

export function Btn({ label, onPress, disabled, busy, variant = "cta", style, color }: {
  label: string; onPress: () => void; disabled?: boolean; busy?: boolean; variant?: "cta" | "ghost"; style?: ViewStyle; color?: string;
}) {
  const t = useTheme();
  const cta = variant === "cta";
  const off = disabled || busy;
  return (
    <Pressable
      accessibilityRole="button" accessibilityState={{ disabled: !!off, busy: !!busy }}
      disabled={off} onPress={onPress}
      style={({ pressed }) => [{
        minHeight: cta ? 56 : 48, borderRadius: cta ? 16 : 14, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 10,
        backgroundColor: cta ? t.cta : "transparent", borderWidth: cta ? 0 : 1, borderColor: (color ?? t.text) + "66",
        opacity: off ? 0.45 : pressed ? 0.85 : 1,
      }, style]}
    >
      {busy && <ActivityIndicator color={cta ? t.onCta : color ?? t.text} />}
      <Text style={{ fontFamily: cta ? font.display : font.semi, fontSize: cta ? 18 : 16, color: cta ? t.onCta : color ?? t.text }}>{label}</Text>
    </Pressable>
  );
}

export function Field({ label, hint, ...rest }: { label: string; hint?: string } & TextInputProps) {
  const t = useTheme();
  const [focus, setFocus] = useState(false);
  return (
    <View style={{ marginTop: 14 }}>
      <Text style={{ fontFamily: font.medium, fontSize: 14, color: t.text, marginBottom: 6 }}>{label}</Text>
      <TextInput
        {...rest}
        onFocus={(e) => { setFocus(true); rest.onFocus?.(e); }}
        onBlur={(e) => { setFocus(false); rest.onBlur?.(e); }}
        placeholderTextColor={t.haze + "99"}
        style={{
          height: 52, borderRadius: 14, borderWidth: focus ? 2 : 1, borderColor: focus ? t.accent : t.line,
          backgroundColor: t.panel, paddingHorizontal: 14, fontSize: 17, color: t.text, fontFamily: font.body,
        }}
      />
      {hint ? <Text style={{ fontFamily: font.body, fontSize: 12.5, color: t.haze, marginTop: 6 }}>{hint}</Text> : null}
    </View>
  );
}

export function Chip({ label, on, onPress }: { label: string; on?: boolean; onPress: () => void }) {
  const t = useTheme();
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityState={{ selected: !!on }}
      style={{ height: 36, paddingHorizontal: 14, borderRadius: 18, borderWidth: 1, justifyContent: "center",
        borderColor: on ? t.accent : t.line, backgroundColor: on ? t.cta + "26" : "transparent" }}>
      <Text style={{ fontFamily: on ? font.semi : font.body, fontSize: 14, color: on ? t.text : t.haze }}>{label}</Text>
    </Pressable>
  );
}

export type Option = { value: string; label: string; sub?: string };

/** A select that opens a full-height sheet with search — much easier than a dropdown for 200+ plans. */
export function Picker({ label, placeholder, value, options, onChange, disabled }: {
  label: string; placeholder: string; value: string; options: Option[]; onChange: (v: string) => void; disabled?: boolean;
}) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const current = options.find((o) => o.value === value);
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? options.filter((o) => (o.label + " " + (o.sub ?? "")).toLowerCase().includes(s)) : options;
  }, [options, q]);
  const searchable = options.length > 10;

  return (
    <View style={{ marginTop: 14 }}>
      <Text style={{ fontFamily: font.medium, fontSize: 14, color: t.text, marginBottom: 6 }}>{label}</Text>
      <Pressable
        accessibilityRole="button" accessibilityLabel={`${label}: ${current?.label ?? placeholder}`}
        disabled={disabled} onPress={() => { setQ(""); setOpen(true); }}
        style={{ height: 52, borderRadius: 14, borderWidth: 1, borderColor: t.line, backgroundColor: t.panel, paddingHorizontal: 14,
          flexDirection: "row", alignItems: "center", justifyContent: "space-between", opacity: disabled ? 0.5 : 1 }}>
        <Text numberOfLines={1} style={{ flex: 1, fontFamily: font.body, fontSize: 17, color: current ? t.text : t.haze + "99" }}>
          {current?.label ?? placeholder}
        </Text>
        <Icon name="chevron" color={t.haze} size={18} />
      </Pressable>

      <Modal visible={open} animationType="slide" transparent onRequestClose={() => setOpen(false)}>
        <Pressable style={{ flex: 1, backgroundColor: "#0008" }} onPress={() => setOpen(false)} accessibilityLabel="Close" />
        <View style={{ backgroundColor: t.panel, borderTopLeftRadius: 28, borderTopRightRadius: 28, maxHeight: "78%", paddingBottom: insets.bottom + 8 }}>
          <View style={{ padding: 20, paddingBottom: 8 }}>
            <Text style={{ fontFamily: font.display, fontSize: 20, color: t.text }}>{label}</Text>
            {searchable && (
              <TextInput value={q} onChangeText={setQ} placeholder="Search" placeholderTextColor={t.haze + "99"} autoCorrect={false}
                style={{ marginTop: 12, height: 46, borderRadius: 12, backgroundColor: t.sunk, paddingHorizontal: 14, fontSize: 16, color: t.text, fontFamily: font.body }} />
            )}
          </View>
          <FlatList
            data={shown} keyExtractor={(o) => o.value} keyboardShouldPersistTaps="handled"
            ListEmptyComponent={<Text style={{ padding: 20, color: t.haze, fontFamily: font.body }}>Nothing matches that search.</Text>}
            renderItem={({ item }) => {
              const on = item.value === value;
              return (
                <Pressable onPress={() => { onChange(item.value); setOpen(false); }} accessibilityRole="button" accessibilityState={{ selected: on }}
                  style={({ pressed }) => ({ paddingVertical: 14, paddingHorizontal: 20, flexDirection: "row", alignItems: "center", gap: 12,
                    backgroundColor: pressed ? t.sunk : "transparent" })}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontFamily: on ? font.semi : font.body, fontSize: 16.5, color: t.text }}>{item.label}</Text>
                    {item.sub ? <Text style={{ fontFamily: font.body, fontSize: 13.5, color: t.haze, marginTop: 2 }}>{item.sub}</Text> : null}
                  </View>
                  {on && <Icon name="check" color={t.ok} size={20} />}
                </Pressable>
              );
            }}
          />
        </View>
      </Modal>
    </View>
  );
}

export const s = StyleSheet.create({ row: { flexDirection: "row", justifyContent: "space-between", gap: 16 } });
