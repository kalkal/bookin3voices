/**
 * «Inserisci il codice d'accesso» prompt (judges build only). It is never
 * shown at startup: it opens when an AI call is refused for a missing code
 * (AccessCodeGate) and closes when the server accepts the code or on Cancel.
 */
import { useState, useSyncExternalStore } from 'react';
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { Card, OrnamentDivider, PrimaryButton } from '../../components';
import { t } from '../../i18n';
import { useTheme } from '../../theme';
import { ACCESS_CODE_MAX_LENGTH, type AccessCodeGate } from './accessCodeGate';

export interface AccessCodeModalHostProps {
  gate: AccessCodeGate;
}

export function AccessCodeModalHost({ gate }: AccessCodeModalHostProps) {
  const state = useSyncExternalStore(gate.subscribe, gate.getState, gate.getState);
  const { colors, fonts, spacing, radius, typeScale } = useTheme();
  const [code, setCode] = useState('');

  const close = () => {
    setCode('');
    gate.cancel();
  };
  const confirm = () => {
    // the field is cleared only when the prompt closes: a typo stays editable
    void gate.submit(code).then(() => {
      if (!gate.getState().open) setCode('');
    });
  };
  const canConfirm = code.trim() !== '' && !state.submitting;

  return (
    <Modal visible={state.open} transparent animationType="fade" onRequestClose={close}>
      <View style={[styles.backdrop, { backgroundColor: colors.shadow }]}>
        <Card testID="access-code-modal" style={{ width: '100%', maxWidth: 380, gap: spacing.md }}>
          <Text
            accessibilityRole="header"
            style={{
              fontFamily: fonts.display,
              fontSize: typeScale.title,
              color: colors.text,
              textAlign: 'center',
            }}
          >
            {t('accessCode.title')}
          </Text>
          <OrnamentDivider />
          <Text
            testID="access-code-hint"
            style={{
              fontFamily: fonts.bodyItalic,
              fontSize: typeScale.bodySmall,
              color: colors.textMutedStrong,
              textAlign: 'center',
            }}
          >
            {t('accessCode.hint')}
          </Text>
          <TextInput
            testID="access-code-input"
            value={code}
            onChangeText={setCode}
            placeholder={t('accessCode.placeholder')}
            placeholderTextColor={colors.textMuted}
            autoCapitalize="characters"
            maxLength={ACCESS_CODE_MAX_LENGTH}
            autoCorrect={false}
            autoComplete="off"
            editable={!state.submitting}
            returnKeyType="done"
            onSubmitEditing={() => {
              if (canConfirm) confirm();
            }}
            style={{
              borderWidth: 1,
              borderColor: colors.hairline,
              borderRadius: radius.sharp,
              paddingHorizontal: spacing.md,
              paddingVertical: spacing.sm + 2,
              fontFamily: fonts.body,
              fontSize: typeScale.body,
              color: colors.text,
              backgroundColor: colors.background,
            }}
          />
          {state.failure !== null ? (
            <Text
              testID="access-code-error"
              accessibilityLiveRegion="polite"
              style={{
                fontFamily: fonts.body,
                fontSize: typeScale.bodySmall,
                color: colors.danger,
                textAlign: 'center',
              }}
            >
              {t(`accessCode.error.${state.failure}`)}
            </Text>
          ) : null}
          <PrimaryButton
            label={state.submitting ? t('accessCode.checking') : t('accessCode.confirm')}
            testID="access-code-confirm"
            disabled={!canConfirm}
            onPress={confirm}
          />
          <Pressable
            accessibilityRole="button"
            testID="access-code-cancel"
            disabled={state.submitting}
            onPress={close}
            style={{ alignSelf: 'center', padding: spacing.xs }}
          >
            <Text
              style={{
                fontFamily: fonts.bodyItalic,
                fontSize: typeScale.bodySmall,
                color: colors.textMutedStrong,
              }}
            >
              {t('accessCode.cancel')}
            </Text>
          </Pressable>
        </Card>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
});
