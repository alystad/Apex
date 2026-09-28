import FontAwesome from "@expo/vector-icons/FontAwesome";
import { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import Card from "@/components/ui/Card";
import type { LocalProfile } from "@/src/profile/profileTypes";
import { useAppTheme } from "@/src/theme/useAppTheme";

type ProfileHeaderCardProps = {
  profile: LocalProfile;
  onChangeDisplayName: (value: string) => void;
};

export default function ProfileHeaderCard({
  profile,
  onChangeDisplayName,
}: ProfileHeaderCardProps) {
  const { tokens: theme } = useAppTheme();
  const styles = useMemo(
    () =>
      StyleSheet.create({
        headerRow: {
          flexDirection: "row",
          alignItems: "center",
          gap: theme.spacing[12],
        },
        avatar: {
          width: 68,
          height: 68,
          borderRadius: theme.radius.pill,
          backgroundColor: theme.colors.chip,
          borderWidth: theme.borderWidth.normal,
          borderColor: theme.colors.border,
          alignItems: "center",
          justifyContent: "center",
        },
        avatarText: {
          fontSize: 24,
          lineHeight: 28,
          fontWeight: "800",
          color: theme.colors.textPrimary,
        },
        copyWrap: {
          flex: 1,
          gap: theme.spacing[4],
        },
        eyebrow: {
          fontSize: 11,
          lineHeight: 14,
          fontWeight: "800",
          letterSpacing: 0.3,
          textTransform: "uppercase",
          color: theme.colors.accent,
        },
        name: {
          fontSize: 24,
          lineHeight: 28,
          fontWeight: "800",
          color: theme.colors.textPrimary,
        },
        subtitle: {
          fontSize: 13,
          lineHeight: 18,
          fontWeight: "600",
          color: theme.colors.textSecondary,
        },
        editorWrap: {
          marginTop: theme.spacing[14],
          gap: theme.spacing[6],
        },
        editorLabel: {
          fontSize: 11,
          lineHeight: 14,
          fontWeight: "800",
          letterSpacing: 0.3,
          textTransform: "uppercase",
          color: theme.colors.textMuted,
        },
        editorRow: {
          flexDirection: "row",
          alignItems: "center",
          gap: theme.spacing[8],
        },
        input: {
          flex: 1,
          minHeight: 46,
          borderRadius: theme.radius.md,
          borderWidth: theme.borderWidth.normal,
          borderColor: theme.colors.border,
          backgroundColor: theme.colors.surfaceAlt,
          paddingHorizontal: theme.spacing[12],
          color: theme.colors.textPrimary,
          fontSize: 15,
          lineHeight: 20,
          fontWeight: "700",
        },
        saveButton: {
          minHeight: 46,
          minWidth: 82,
          borderRadius: theme.radius.md,
          borderWidth: theme.borderWidth.normal,
          borderColor: theme.colors.border,
          backgroundColor: theme.colors.surface,
          alignItems: "center",
          justifyContent: "center",
          paddingHorizontal: theme.spacing[12],
        },
        saveButtonActive: {
          backgroundColor: theme.colors.accentStrong,
          borderColor: theme.colors.accentStrong,
        },
        saveText: {
          fontSize: 13,
          lineHeight: 18,
          fontWeight: "800",
          color: theme.colors.textPrimary,
        },
        saveTextActive: {
          color: "#09111d",
        },
      }),
    [theme],
  );
  const [draftName, setDraftName] = useState(profile.displayName);

  useEffect(() => {
    setDraftName(profile.displayName);
  }, [profile.displayName]);

  const trimmedDraft = draftName.trim();
  const canSave =
    trimmedDraft.length > 0 && trimmedDraft !== profile.displayName;
  const avatarLetter = (profile.displayName || "G").trim().charAt(0).toUpperCase();

  const commitName = () => {
    if (!trimmedDraft) {
      setDraftName(profile.displayName);
      return;
    }
    onChangeDisplayName(trimmedDraft);
  };

  return (
    <Card elevated>
      <View style={styles.headerRow}>
        <View style={styles.avatar}>
          {profile.avatarUri ? (
            <FontAwesome name="user" size={28} color={theme.colors.textPrimary} />
          ) : (
            <Text style={styles.avatarText}>{avatarLetter}</Text>
          )}
        </View>
        <View style={styles.copyWrap}>
          <Text style={styles.eyebrow}>Local Profile</Text>
          <Text style={styles.name} numberOfLines={1}>
            {profile.displayName}
          </Text>
          <Text style={styles.subtitle}>
            Basketball fan profile for picks, records, and game-day predictions.
          </Text>
        </View>
      </View>

      <View style={styles.editorWrap}>
        <Text style={styles.editorLabel}>Display Name</Text>
        <View style={styles.editorRow}>
          <TextInput
            value={draftName}
            onChangeText={(value) => setDraftName(value.slice(0, 32))}
            onSubmitEditing={commitName}
            onBlur={commitName}
            placeholder="Enter a display name"
            placeholderTextColor={theme.colors.textMuted}
            style={styles.input}
            returnKeyType="done"
          />
          <Pressable
            onPress={commitName}
            style={[
              styles.saveButton,
              canSave ? styles.saveButtonActive : null,
            ]}
          >
            <Text
              style={[styles.saveText, canSave ? styles.saveTextActive : null]}
            >
              Save
            </Text>
          </Pressable>
        </View>
      </View>
    </Card>
  );
}
