/**
 * Export tab of the Book ("Export/Share" mockup): editable KDP metadata
 * (title, author, language, description), EPUB/DOCX format choice,
 * warning if there are pending suggestions and "Genera"
 * which calls the callable, saves locally and opens the share sheet.
 * Progress and errors always visible, never mute spinners.
 */
import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, TextInput, View } from 'react-native';

import {
  ArchesFill,
  Card,
  Chip,
  OrnamentDivider,
  PrimaryButton,
  useBottomClearance,
} from '../../components';
import { t, tn } from '../../i18n';
import { useTheme } from '../../theme';
import type { Book, BookRepository } from '../books';
import { preflightNote } from './kdpMessages';
import { callableErrorMessage, logCallableFailure } from '../../lib/callableErrors';
import { makeRequestId } from './requestId';
import {
  EXPORT_FORMATS,
  FORMAT_LABELS,
  type BookExportService,
  type ExportFile,
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
  /** Resolves true when local writes reached the server, false on timeout. */
  waitForSync?: () => Promise<boolean>;
  /** The author name from Settings: offered for a book that has none. */
  defaultAuthor?: string;
}

type Progress =
  | { phase: 'idle' }
  | { phase: 'working'; message: string }
  | { phase: 'done'; message: string }
  | { phase: 'error'; message: string; retry?: () => void };

export function ExportTab({
  book,
  bookRepository,
  exportService,
  pendingSuggestions,
  fileSink,
  waitForSync,
  defaultAuthor,
}: ExportTabProps) {
  const { colors, fonts, spacing, radius, typeScale } = useTheme();
  const bottom = useBottomClearance(spacing.xl);

  // The fields start from the book and stay the user's until they save: remote
  // updates (observeBook) do not overwrite what they are typing.
  const [title, setTitle] = useState(book.title);
  // a book without an author starts from the name in Settings (still editable),
  // also when that name arrives after the tab opened: until the user types,
  // the field shows the book's author or, failing that, the Settings name
  const [typedAuthor, setAuthor] = useState<string | null>(null);
  const author =
    typedAuthor ?? (book.author.trim() === '' ? (defaultAuthor?.trim() ?? '') : book.author);
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
        // without a count, no warning: export remains possible anyway
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

  // sharing is the phone's job, not the server's: its own message, and Retry
  // shares the same file again instead of exporting a new one
  const share = async (file: ExportFile, synced: boolean) => {
    setProgress({ phase: 'working', message: t('export.progress.opening') });
    try {
      await fileSink.saveAndShare(file);
    } catch (error) {
      console.warn('export-share-failed', {
        code: error instanceof Error ? error.name : typeof error,
      });
      setProgress({
        phase: 'error',
        // the sink throws localized text (export.share.unavailable)
        message:
          error instanceof Error && error.message.trim() !== ''
            ? error.message
            : t('export.share.failed'),
        retry: () => void share(file, synced),
      });
      return;
    }
    setProgress({
      phase: 'done',
      message: t('export.progress.done', {
        fileName: file.fileName,
        size: Math.max(1, Math.round(file.size / 1024)),
        note: preflightNote(file) + (synced ? '' : t('export.note.notSynced')),
      }),
    });
  };

  const generate = async () => {
    setProgress({
      phase: 'working',
      message: t('export.progress.generating', { format: FORMAT_LABELS[format] }),
    });
    const requestId = makeRequestId();
    try {
      // what is on screen is what gets exported: unsaved metadata (a name
      // offered from Settings, too) is saved on the book first
      if (metadataDirty) {
        await bookRepository.updateBook(book.id, { title, author, language, description });
        setMetadataSaved(true);
      }
      // the callable reads from the server: let the local saves reach it first
      const synced = waitForSync ? await waitForSync().catch(() => false) : true;
      const file = await exportService.exportBook({ bookId: book.id, format, requestId });
      await share(file, synced);
    } catch (error) {
      logCallableFailure('export', requestId, error);
      setProgress({
        phase: 'error',
        message: callableErrorMessage('export', error),
        retry: () => void generate(),
      });
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
      contentContainerStyle={{
        flexGrow: 1,
        padding: spacing.xl,
        paddingBottom: bottom,
        gap: spacing.lg,
      }}
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
          {author.trim() === '' && (
            <Text
              testID="export-author-missing"
              style={{
                marginTop: spacing.xs,
                fontFamily: fonts.bodyItalic,
                fontSize: typeScale.caption,
                color: colors.textMutedStrong,
              }}
            >
              {t('export.field.authorMissing')}
            </Text>
          )}
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
            accessibilityLiveRegion="polite"
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
          {progress.phase === 'error' && progress.retry !== undefined && (
            <Chip
              label={t('common.retry')}
              tone="green"
              testID="export-retry"
              onPress={progress.retry}
            />
          )}
        </View>
      )}
      <ArchesFill />
    </ScrollView>
  );
}
