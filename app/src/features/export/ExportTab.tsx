/**
 * Tab Export del Libro (mockup "Export/Condividi"): metadati KDP
 * modificabili (titolo, autore, lingua, descrizione), scelta formato
 * EPUB/DOCX, avviso se ci sono suggerimenti pending e "Genera"
 * che chiama la callable, salva in locale e apre lo share sheet.
 * Stato di avanzamento e errori sempre visibili, mai spinner muti.
 */
import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, TextInput, View } from 'react-native';

import { Card, Chip, OrnamentDivider, PrimaryButton } from '../../components';
import { t, tn } from '../../i18n';
import { useTheme } from '../../theme';
import type { Book, BookRepository } from '../books';
import { preflightNote } from './kdpMessages';
import { makeRequestId } from './requestId';
import {
  EXPORT_FORMATS,
  FORMAT_LABELS,
  type BookExportService,
  type ExportFileSink,
  type ExportFormat,
  type PendingSuggestionsRepository,
} from './types';

export interface ExportTabProps {
  book: Book;
  bookRepository: BookRepository;
  exportService: BookExportService;
  pendingSuggestions: PendingSuggestionsRepository;
  fileSink: ExportFileSink;
}

type Progress =
  | { phase: 'idle' }
  | { phase: 'working'; message: string }
  | { phase: 'done'; message: string }
  | { phase: 'error'; message: string };

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim() !== '') return error.message;
  return t('export.error.unexpected');
}

export function ExportTab({
  book,
  bookRepository,
  exportService,
  pendingSuggestions,
  fileSink,
}: ExportTabProps) {
  const { colors, fonts, spacing, radius, typeScale } = useTheme();

  // I campi partono dal libro e restano dell'utente finché non salva: gli
  // aggiornamenti remoti (observeBook) non sovrascrivono ciò che sta digitando.
  const [title, setTitle] = useState(book.title);
  const [author, setAuthor] = useState(book.author);
  const [language, setLanguage] = useState(book.language);
  const [description, setDescription] = useState(book.description);
  const [metadataSaved, setMetadataSaved] = useState(false);

  const [format, setFormat] = useState<ExportFormat>('epub');
  const [pendingCount, setPendingCount] = useState<number | null>(null);
  const [progress, setProgress] = useState<Progress>({ phase: 'idle' });

  useEffect(() => {
    let cancelled = false;
    pendingSuggestions
      .countPending(book.id)
      .then((count) => {
        if (!cancelled) setPendingCount(count);
      })
      .catch(() => {
        // senza conteggio niente avviso: l'export resta comunque possibile
        if (!cancelled) setPendingCount(null);
      });
    return () => {
      cancelled = true;
    };
  }, [pendingSuggestions, book.id]);

  const metadataDirty =
    title !== book.title ||
    author !== book.author ||
    language !== book.language ||
    description !== book.description;

  const saveMetadata = () => {
    setMetadataSaved(true);
    bookRepository.updateBook(book.id, { title, author, language, description }).catch(() => {
      setMetadataSaved(false);
      setProgress({ phase: 'error', message: t('export.error.saveMetadata') });
    });
  };

  const working = progress.phase === 'working';

  const generate = async () => {
    setProgress({
      phase: 'working',
      message: t('export.progress.generating', { format: FORMAT_LABELS[format] }),
    });
    try {
      const file = await exportService.exportBook({
        bookId: book.id,
        format,
        requestId: makeRequestId(),
      });
      setProgress({ phase: 'working', message: t('export.progress.opening') });
      await fileSink.saveAndShare(file);
      setProgress({
        phase: 'done',
        message: t('export.progress.done', {
          fileName: file.fileName,
          size: Math.max(1, Math.round(file.size / 1024)),
          note: preflightNote(file),
        }),
      });
    } catch (error) {
      setProgress({ phase: 'error', message: errorMessage(error) });
    }
  };

  const fieldStyle = {
    borderWidth: 1,
    borderColor: colors.hairline,
    borderRadius: radius.sharp,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    fontFamily: fonts.body,
    fontSize: typeScale.body,
    color: colors.text,
    backgroundColor: colors.background,
  } as const;

  const fieldLabel = (label: string) => (
    <Text
      style={{
        fontFamily: fonts.body,
        fontSize: typeScale.label,
        color: colors.textMuted,
        marginBottom: spacing.xs,
      }}
    >
      {label}
    </Text>
  );

  return (
    <ScrollView
      testID="export-tab"
      contentContainerStyle={{ padding: spacing.xl, gap: spacing.lg }}
      keyboardShouldPersistTaps="handled"
    >
      <Card style={{ gap: spacing.md }}>
        <Text
          style={{ fontFamily: fonts.display, fontSize: typeScale.heading, color: colors.text }}
        >
          {t('export.metadata.title')}
        </Text>
        <OrnamentDivider style={{ alignSelf: 'stretch' }} />
        <View>
          {fieldLabel(t('export.field.title'))}
          <TextInput
            testID="export-title"
            value={title}
            onChangeText={(next) => {
              setTitle(next);
              setMetadataSaved(false);
            }}
            placeholder={t('export.field.titlePlaceholder')}
            placeholderTextColor={colors.textMuted}
            style={fieldStyle}
          />
        </View>
        <View>
          {fieldLabel(t('export.field.author'))}
          <TextInput
            testID="export-author"
            value={author}
            onChangeText={(next) => {
              setAuthor(next);
              setMetadataSaved(false);
            }}
            placeholder={t('export.field.authorPlaceholder')}
            placeholderTextColor={colors.textMuted}
            style={fieldStyle}
          />
        </View>
        <View>
          {fieldLabel(t('export.field.language'))}
          <TextInput
            testID="export-language"
            value={language}
            onChangeText={(next) => {
              setLanguage(next);
              setMetadataSaved(false);
            }}
            placeholder={t('export.field.languagePlaceholder')}
            placeholderTextColor={colors.textMuted}
            autoCapitalize="none"
            style={fieldStyle}
          />
        </View>
        <View>
          {fieldLabel(t('export.field.description'))}
          <TextInput
            testID="export-description"
            value={description}
            onChangeText={(next) => {
              setDescription(next);
              setMetadataSaved(false);
            }}
            placeholder={t('export.field.descriptionPlaceholder')}
            placeholderTextColor={colors.textMuted}
            multiline
            numberOfLines={4}
            style={[fieldStyle, { minHeight: 96, textAlignVertical: 'top' }]}
          />
        </View>
        <PrimaryButton
          label={t('export.metadata.save')}
          testID="export-save-metadata"
          disabled={!metadataDirty || title.trim() === ''}
          onPress={saveMetadata}
        />
        {metadataSaved && (
          <Text
            testID="export-metadata-saved"
            style={{
              textAlign: 'center',
              fontFamily: fonts.bodyItalic,
              fontSize: typeScale.caption,
              color: colors.primary,
            }}
          >
            {t('export.metadata.saved')}
          </Text>
        )}
      </Card>

      <Card style={{ gap: spacing.md }}>
        <Text
          style={{ fontFamily: fonts.display, fontSize: typeScale.heading, color: colors.text }}
        >
          {t('export.format.title')}
        </Text>
        <OrnamentDivider style={{ alignSelf: 'stretch' }} />
        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          {EXPORT_FORMATS.map((value) => (
            <Chip
              key={value}
              label={FORMAT_LABELS[value]}
              testID={`export-format-${value}`}
              selected={format === value}
              onPress={() => setFormat(value)}
            />
          ))}
        </View>
        <Text
          style={{
            fontFamily: fonts.bodyItalic,
            fontSize: typeScale.caption,
            color: colors.textMuted,
          }}
        >
          {format === 'epub' ? t('export.format.epubHint') : t('export.format.docxHint')}
        </Text>
      </Card>

      {pendingCount !== null && pendingCount > 0 && (
        <Card
          testID="export-pending-warning"
          style={{ gap: spacing.xs, borderColor: colors.accent }}
        >
          <Text
            style={{
              fontFamily: fonts.bodySemiBold,
              fontSize: typeScale.body,
              color: colors.accentText,
            }}
          >
            {tn('export.pending.title', pendingCount)}
          </Text>
          <Text
            style={{
              fontFamily: fonts.body,
              fontSize: typeScale.bodySmall,
              color: colors.textMuted,
            }}
          >
            {t('export.pending.body')}
          </Text>
        </Card>
      )}

      <PrimaryButton
        label={
          working
            ? t('export.generate.working')
            : t('export.generate.idle', { format: FORMAT_LABELS[format] })
        }
        testID="export-generate"
        disabled={working}
        onPress={() => {
          void generate();
        }}
      />

      {progress.phase !== 'idle' && (
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: spacing.sm,
            justifyContent: 'center',
          }}
        >
          {working && <ActivityIndicator size="small" color={colors.primary} />}
          <Text
            testID="export-status"
            style={{
              fontFamily: fonts.bodyItalic,
              fontSize: typeScale.bodySmall,
              color:
                progress.phase === 'error'
                  ? colors.accentText
                  : progress.phase === 'done'
                    ? colors.primary
                    : colors.textMuted,
              textAlign: 'center',
              flexShrink: 1,
            }}
          >
            {progress.message}
          </Text>
        </View>
      )}
    </ScrollView>
  );
}
