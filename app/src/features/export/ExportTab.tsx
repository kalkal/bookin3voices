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
import { useTheme } from '../../theme';
import type { Book, BookRepository } from '../books';
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
  return 'Errore inatteso durante l’export.';
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
      setProgress({ phase: 'error', message: 'Salvataggio dei metadati non riuscito.' });
    });
  };

  const working = progress.phase === 'working';

  const generate = async () => {
    setProgress({ phase: 'working', message: `Generazione ${FORMAT_LABELS[format]} in corso…` });
    try {
      const file = await exportService.exportBook({
        bookId: book.id,
        format,
        requestId: makeRequestId(),
      });
      setProgress({ phase: 'working', message: 'File pronto, apro la condivisione…' });
      await fileSink.saveAndShare(file);
      setProgress({
        phase: 'done',
        message: `«${file.fileName}» generato (${Math.max(1, Math.round(file.size / 1024))} KB).${preflightNote(file)}`,
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
          Metadati KDP
        </Text>
        <OrnamentDivider style={{ alignSelf: 'stretch' }} />
        <View>
          {fieldLabel('Titolo')}
          <TextInput
            testID="export-title"
            value={title}
            onChangeText={(next) => {
              setTitle(next);
              setMetadataSaved(false);
            }}
            placeholder="Titolo del libro"
            placeholderTextColor={colors.textMuted}
            style={fieldStyle}
          />
        </View>
        <View>
          {fieldLabel('Autore')}
          <TextInput
            testID="export-author"
            value={author}
            onChangeText={(next) => {
              setAuthor(next);
              setMetadataSaved(false);
            }}
            placeholder="Nome dell’autore"
            placeholderTextColor={colors.textMuted}
            style={fieldStyle}
          />
        </View>
        <View>
          {fieldLabel('Lingua')}
          <TextInput
            testID="export-language"
            value={language}
            onChangeText={(next) => {
              setLanguage(next);
              setMetadataSaved(false);
            }}
            placeholder="it"
            placeholderTextColor={colors.textMuted}
            autoCapitalize="none"
            style={fieldStyle}
          />
        </View>
        <View>
          {fieldLabel('Descrizione')}
          <TextInput
            testID="export-description"
            value={description}
            onChangeText={(next) => {
              setDescription(next);
              setMetadataSaved(false);
            }}
            placeholder="Descrizione per la scheda del libro"
            placeholderTextColor={colors.textMuted}
            multiline
            numberOfLines={4}
            style={[fieldStyle, { minHeight: 96, textAlignVertical: 'top' }]}
          />
        </View>
        <PrimaryButton
          label="Salva metadati"
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
            Metadati salvati ✓
          </Text>
        )}
      </Card>

      <Card style={{ gap: spacing.md }}>
        <Text
          style={{ fontFamily: fonts.display, fontSize: typeScale.heading, color: colors.text }}
        >
          Formato
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
          {format === 'epub'
            ? 'EPUB: il formato consigliato per l’ebook su Amazon KDP.'
            : 'DOCX: si apre in Word, utile per la revisione umana.'}
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
            {pendingCount === 1
              ? 'C’è 1 suggerimento in sospeso'
              : `Ci sono ${pendingCount} suggerimenti in sospeso`}
          </Text>
          <Text
            style={{
              fontFamily: fonts.body,
              fontSize: typeScale.bodySmall,
              color: colors.textMuted,
            }}
          >
            L’export usa il testo attuale e li ignora: decidili prima, se vuoi che entrino nel
            libro.
          </Text>
        </Card>
      )}

      <PrimaryButton
        label={working ? 'Generazione in corso…' : `Genera ${FORMAT_LABELS[format]}`}
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

/** One-line summary of the KDP preflight (empty when there is nothing to say). */
export function preflightNote(file: {
  preflight?: { errors: { message: string }[]; warnings: { message: string }[] };
}): string {
  const report = file.preflight;
  if (report === undefined) return '';
  const issues = [...report.errors, ...report.warnings];
  if (issues.length === 0) return ' KDP check: all good.';
  return ` KDP check: ${report.errors.length} error(s), ${report.warnings.length} warning(s). ${issues[0]?.message ?? ''}`;
}
