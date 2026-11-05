import { Ionicons } from '@expo/vector-icons';
import { forwardRef, useState, type ComponentRef } from 'react';
import { Pressable, StyleSheet, TextInput, View, type TextInputProps } from 'react-native';

import { useStyles, useTheme } from '@/theme/ThemeProvider';
import { fonts, radii, type Palette } from '@/theme/tokens';

import { AppText } from './AppText';

export interface TextFieldProps extends TextInputProps {
  label?: string;
  error?: string | null;
  hint?: string;
  /** Adds a show/hide toggle for passwords. */
  secure?: boolean;
}

export const TextField = forwardRef<ComponentRef<typeof TextInput>, TextFieldProps>(function TextField(
  { label, error, hint, secure, style, multiline, ...rest },
  ref,
) {
  const { colors } = useTheme();
  const styles = useStyles(makeStyles);
  const [hidden, setHidden] = useState(true);
  return (
    <View style={styles.wrap}>
      {label ? <AppText variant="caption" secondary>{label}</AppText> : null}
      <View style={[styles.box, multiline && styles.multiline, !!error && styles.boxError]}>
        <TextInput
          ref={ref}
          placeholderTextColor={colors.textMuted}
          style={[styles.input, multiline && { textAlignVertical: 'top', minHeight: 88 }, style]}
          secureTextEntry={secure ? hidden : rest.secureTextEntry}
          multiline={multiline}
          accessibilityLabel={rest.accessibilityLabel ?? label}
          {...rest}
        />
        {secure ? (
          <Pressable
            onPress={() => setHidden((h) => !h)}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={hidden ? 'Show password' : 'Hide password'}
            style={styles.eye}>
            <Ionicons name={hidden ? 'eye-outline' : 'eye-off-outline'} size={20} color={colors.textSecondary} />
          </Pressable>
        ) : null}
      </View>
      {error ? <AppText variant="caption" color={colors.rose}>{error}</AppText> : hint ? <AppText variant="caption" muted>{hint}</AppText> : null}
    </View>
  );
});

const makeStyles = (c: Palette) => StyleSheet.create({
  wrap: { gap: 6 },
  box: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 54,
    borderRadius: radii.md,
    backgroundColor: c.surface,
    borderWidth: 1,
    borderColor: c.borderStrong,
    paddingHorizontal: 16,
  },
  multiline: { alignItems: 'flex-start', paddingVertical: 12 },
  boxError: { borderColor: c.rose },
  input: { flex: 1, color: c.text, fontFamily: fonts.body, fontSize: 16, paddingVertical: 12 },
  eye: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', marginRight: -8 },
});
