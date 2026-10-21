/**
 * Synopsis tab of the Book: synopsis field with
 * save, "Genera scaletta capitoli" → corkboard-style card preview
 * (title + summary + beats), editable and deletable BEFORE
 * confirmation; confirmation = additive merge via repository (chapters
 * with text are NEVER touched, cards fill empty slots first).
 * The preview is a draft saved per book (OutlineDraftRepository): leaving the
 * tab or the app does not lose it. "Crea N capitoli" lives in a bar under the
 * scrolling cards, so it is always reachable.
 * Progress and errors always visible, never mute spinners.
 */
import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';

import {
  ArchesFill,
  Card,
  Chip,
  OrnamentDivider,
  PrimaryButton,
  useBottomClearance,
} from '../../components';
import { callableErrorMessage, logCallableFailure } from '../../lib/callableErrors';
import { makeRequestId } from '../../lib/requestId';
import { t, tn } from '../../i18n';
import { useTheme } from '../../theme';
import type { Book, BookRepository } from '../books';
import { resolveStyleId } from '../books/styles';
import type { ChapterRepository, ChapterSummary } from '../chapters';
import { LocalOutlineDraftRepository, type OutlineDraftRepository } from './drafts';
import { applyOutlineMerge, planOutlineMerge } from './merge';
import type { OutlineCard, OutlineService } from './types';

// Development-key warning: constant shared with the other
// AI surfaces (editor) in lib/freeTier, re-exported from here for existing
// uses. Off with the default provider (see lib/freeTier).
import { SHOW_FREE_TIER_WARNING } from '../../lib/freeTier';

export { SHOW_FREE_TIER_WARNING };

export interface SynopsisTabProps {
  book: Book;
  bookRepository: BookRepository;
  chapterRepository: ChapterRepository;
  outlineService: OutlineService;
  /** Where the unconfirmed preview is kept; default on the device (AsyncStorage). */
  outlineDrafts?: OutlineDraftRepository;
}

type Progress =
  | { phase: 'idle' }
  | { phase: 'working'; message: string }
  | { phase: 'done'; message: string }
  | { phase: 'error'; message: string; retry?: () => void };

interface CardDraft {
  index: number;
  title: string;
  summary: string;
  beatsText: string;
}

const toErrorName = (error: unknown) => (error instanceof Error ? error.name : typeof error);

/** Below this many words a one-line synopsis gives the model too little to build on. */
const THIN_SYNOPSIS_WORDS = 25;

/** A single short line: enough to generate, too little for a good outline. */
export function isThinSynopsis(synopsis: string): boolean {
  const text = synopsis.trim();
  if (text === '' || text.includes('\n')) return false;
  return text.split(/\s+/).length < THIN_SYNOPSIS_WORDS;
}

function mergeMessage(result: { updated: number; created: number; skipped: number }): string {
  const parts: string[] = [];
  if (result.updated > 0) parts.push(tn('outline.mergeUpdated', result.updated));
  if (result.created > 0) parts.push(tn('outline.mergeCreated', result.created));
  if (result.skipped > 0) parts.push(tn('outline.mergeSkipped', result.skipped));
  return parts.length === 0
    ? t('outline.mergeNone')
    : t('outline.mergeSaved', { parts: parts.join(', ') });
}

export function SynopsisTab({
  book,
  bookRepository,
  chapterRepository,
  outlineService,
  outlineDrafts,
}: SynopsisTabProps) {
  const { colors, fonts, spacing, radius, typeScale } = useTheme();
  const bottom = useBottomClearance(spacing.xl);
  const barBottom = useBottomClearance(spacing.md);
  const [drafts] = useState<OutlineDraftRepository>(
    () => outlineDrafts ?? new LocalOutlineDraftRepository(),
  );

  // The synopsis starts from the book and stays the user's until they save: remote
  // updates (observeBook) do not overwrite what they are typing.
  const [synopsis, setSynopsis] = useState(book.synopsis);
  const [synopsisSaved, setSynopsisSaved] = useState(false);

  const [chapters, setChapters] = useState<ChapterSummary[]>([]);
  const [cards, setCards] = useState<OutlineCard[] | null>(null);
  const [draft, setDraft] = useState<CardDraft | null>(null);
  const [progress, setProgress] = useState<Progress>({ phase: 'idle' });
  // the saved draft is read once on opening; until then nothing is written over it
  const [draftLoaded, setDraftLoaded] = useState(false);

  useEffect(() => {
    return chapterRepository.observeChapters(book.id, setChapters, () => {});
  }, [chapterRepository, book.id]);

  useEffect(() => {
    let cancelled = false;
    drafts
      .load(book.id)
      .catch(() => null)
      .then((saved) => {
        if (cancelled) return;
        // a proposal generated meanwhile wins over the saved one
        if (saved !== null) setCards((current) => current ?? saved);
        setDraftLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [drafts, book.id]);

  // every change of the preview is kept; confirming or discarding it clears the draft
  useEffect(() => {
    if (!draftLoaded) return;
    const write = cards === null ? drafts.clear(book.id) : drafts.save(book.id, cards);
    write.catch(() => {});
  }, [drafts, book.id, cards, draftLoaded]);

  const working = progress.phase === 'working';
  const synopsisDirty = synopsis !== book.synopsis;
  const writtenCount = chapters.filter((chapter) => chapter.wordCount > 0).length;
  const emptyCount = chapters.length - writtenCount;

  const saveSynopsis = () => {
    setSynopsisSaved(true);
    bookRepository.updateBook(book.id, { synopsis }).catch(() => {
      setSynopsisSaved(false);
      setProgress({ phase: 'error', message: t('outline.saveFailed') });
    });
  };

  const generate = async () => {
    setProgress({ phase: 'working', message: t('outline.generating') });
    const requestId = makeRequestId('out');
    try {
      const proposal = await outlineService.generateOutline({
        bookId: book.id,
        synopsis: synopsis.trim(),
        requestId,
        styleId: resolveStyleId(book.styleProfileId),
      });
      setCards(proposal.chapters);
      setProgress({ phase: 'idle' });
    } catch (error) {
      logCallableFailure('outline', requestId, error);
      setProgress({
        phase: 'error',
        message: callableErrorMessage('outline', error),
        retry: () => void generate(),
      });
    }
  };

  const confirm = async () => {
    if (cards === null || cards.length === 0) return;
    setProgress({ phase: 'working', message: t('outline.creating') });
    try {
      const plan = planOutlineMerge(chapters, cards);
      const result = await applyOutlineMerge(chapterRepository, book.id, plan);
      setCards(null);
      setProgress({ phase: 'done', message: mergeMessage(result) });
    } catch (error) {
      console.warn('outline-merge-failed', { bookId: book.id, error: toErrorName(error) });
      setProgress({
        phase: 'error',
        message: t('outline.mergeFailed'),
        retry: () => void confirm(),
      });
    }
  };

  const removeCard = (index: number) => {
    setCards((current) => (current === null ? null : current.filter((_, i) => i !== index)));
  };

  const openDraft = (index: number, card: OutlineCard) => {
    setDraft({ index, title: card.title, summary: card.summary, beatsText: card.beats.join('\n') });
  };

  const saveDraft = () => {
    if (draft === null) return;
    const beats = draft.beatsText
      .split('\n')
      .map((beat) => beat.trim())
      .filter((beat) => beat !== '');
    setCards((current) =>
      current === null
        ? null
        : current.map((card, i) =>
            i === draft.index
              ? { title: draft.title.trim(), summary: draft.summary.trim(), beats }
              : card,
          ),
    );
    setDraft(null);
  };

  const draftValid =
    draft !== null &&
    draft.title.trim() !== '' &&
    draft.summary.trim() !== '' &&
    draft.beatsText.split('\n').some((beat) => beat.trim() !== '');

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

  const sectionTitle = (label: string) => (
    <Text style={{ fontFamily: fonts.display, fontSize: typeScale.heading, color: colors.text }}>
      {label}
    </Text>
  );

  const mutedNote = (text: string, testID?: string) => (
    <Text
      testID={testID}
      style={{ fontFamily: fonts.bodyItalic, fontSize: typeScale.caption, color: colors.textMuted }}
    >
      {text}
    </Text>
  );

  return (
    <View style={{ flex: 1 }}>
      <ScrollView
        testID="synopsis-tab"
        contentContainerStyle={{
          flexGrow: 1,
          padding: spacing.xl,
          // with the bar the inset is the bar's job
          paddingBottom: cards === null ? bottom : spacing.xl,
          gap: spacing.lg,
        }}
        keyboardShouldPersistTaps="handled"
      >
        {SHOW_FREE_TIER_WARNING && (
          <Card
            testID="synopsis-freekey-warning"
            style={{ gap: spacing.xs, borderColor: colors.accent }}
          >
            <Text
              style={{
                fontFamily: fonts.bodySemiBold,
                fontSize: typeScale.body,
                color: colors.accentText,
              }}
            >
              {t('outline.devKeyTitle')}
            </Text>
            <Text
              style={{
                fontFamily: fonts.body,
                fontSize: typeScale.bodySmall,
                color: colors.textMuted,
              }}
            >
              {t('outline.devKeyBody')}
            </Text>
          </Card>
        )}

        <Card style={{ gap: spacing.md }}>
          {sectionTitle(t('outline.synopsisTitle'))}
          <OrnamentDivider style={{ alignSelf: 'stretch' }} />
          <TextInput
            testID="synopsis-input"
            value={synopsis}
            onChangeText={(next) => {
              setSynopsis(next);
              setSynopsisSaved(false);
            }}
            placeholder={t('outline.synopsisPlaceholder')}
            placeholderTextColor={colors.textMuted}
            multiline
            numberOfLines={7}
            style={[fieldStyle, { minHeight: 150, textAlignVertical: 'top' }]}
          />
          <PrimaryButton
            label={t('outline.saveSynopsis')}
            testID="synopsis-save"
            disabled={!synopsisDirty}
            onPress={saveSynopsis}
          />
          {isThinSynopsis(synopsis) && mutedNote(t('outline.thinSynopsis'), 'synopsis-thin-hint')}
          {synopsisSaved && (
            <Text
              testID="synopsis-saved"
              style={{
                textAlign: 'center',
                fontFamily: fonts.bodyItalic,
                fontSize: typeScale.caption,
                color: colors.primary,
              }}
            >
              {t('outline.synopsisSaved')}
            </Text>
          )}
        </Card>

        {cards === null && (
          <Card style={{ gap: spacing.md }}>
            {sectionTitle(t('outline.outlineTitle'))}
            <OrnamentDivider style={{ alignSelf: 'stretch' }} />
            {mutedNote(
              writtenCount > 0
                ? t('outline.mergeNote', {
                    written: tn('outline.writtenKept', writtenCount),
                    empty: tn('outline.emptyFirst', emptyCount),
                  })
                : t('outline.reviewNote'),
              'synopsis-merge-note',
            )}
            <PrimaryButton
              label={working ? t('outline.generatingShort') : t('outline.generate')}
              testID="synopsis-generate"
              disabled={working || synopsis.trim() === ''}
              onPress={() => {
                void generate();
              }}
            />
          </Card>
        )}

        {cards !== null && (
          <Card style={{ gap: spacing.md }}>
            {sectionTitle(t('outline.previewTitle'))}
            <OrnamentDivider style={{ alignSelf: 'stretch' }} />
            {mutedNote(t('outline.previewNote'))}
            {cards.map((card, index) => (
              <View
                key={`${index}-${card.title}`}
                testID={`outline-card-${index}`}
                style={{
                  borderWidth: 1,
                  borderColor: colors.hairlineGold,
                  borderRadius: radius.sharp,
                  backgroundColor: colors.background,
                  padding: spacing.md,
                  gap: spacing.xs,
                }}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                  <Text
                    style={{
                      fontFamily: fonts.display,
                      fontSize: typeScale.body + 2,
                      color: colors.accentText,
                    }}
                  >
                    {index + 1}.
                  </Text>
                  <Text
                    numberOfLines={2}
                    style={{
                      flex: 1,
                      fontFamily: fonts.bodySemiBold,
                      fontSize: typeScale.body,
                      color: colors.text,
                    }}
                  >
                    {card.title}
                  </Text>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t('outline.edit', { title: card.title })}
                    testID={`outline-card-edit-${index}`}
                    onPress={() => openDraft(index, card)}
                    style={{ padding: spacing.xs }}
                  >
                    <Ionicons name="create-outline" size={19} color={colors.textMutedStrong} />
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t('outline.delete', { title: card.title })}
                    testID={`outline-card-delete-${index}`}
                    onPress={() => removeCard(index)}
                    style={{ padding: spacing.xs }}
                  >
                    <Ionicons name="trash-outline" size={19} color={colors.textMutedStrong} />
                  </Pressable>
                </View>
                <Text
                  style={{
                    fontFamily: fonts.body,
                    fontSize: typeScale.bodySmall,
                    color: colors.text,
                  }}
                >
                  {card.summary}
                </Text>
                {card.beats.map((beat, beatIndex) => (
                  <Text
                    key={beatIndex}
                    style={{
                      fontFamily: fonts.body,
                      fontSize: typeScale.bodySmall,
                      color: colors.textMuted,
                    }}
                  >
                    {`◆ ${beat}`}
                  </Text>
                ))}
              </View>
            ))}
            <Pressable
              accessibilityRole="button"
              testID="outline-cancel"
              onPress={() => {
                setCards(null);
                setProgress({ phase: 'idle' });
              }}
              style={{ alignSelf: 'center', padding: spacing.xs }}
            >
              <Text
                style={{
                  fontFamily: fonts.bodyItalic,
                  fontSize: typeScale.bodySmall,
                  color: colors.textMutedStrong,
                }}
              >
                {t('outline.discard')}
              </Text>
            </Pressable>
          </Card>
        )}

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
              testID="synopsis-status"
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
                testID="synopsis-retry"
                onPress={progress.retry}
              />
            )}
          </View>
        )}

        <ArchesFill />
      </ScrollView>

      {cards !== null && (
        <View
          testID="outline-confirm-bar"
          style={{
            borderTopWidth: 1,
            borderTopColor: colors.hairline,
            backgroundColor: colors.background,
            paddingHorizontal: spacing.xl,
            paddingTop: spacing.md,
            paddingBottom: barBottom,
          }}
        >
          <PrimaryButton
            label={working ? t('outline.creatingShort') : tn('outline.confirm', cards.length)}
            testID="outline-confirm"
            disabled={working || cards.length === 0}
            onPress={() => {
              void confirm();
            }}
          />
        </View>
      )}

      <Modal
        visible={draft !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setDraft(null)}
      >
        <View
          style={{
            flex: 1,
            alignItems: 'center',
            justifyContent: 'center',
            padding: spacing.xl,
            backgroundColor: colors.shadow,
          }}
        >
          <Card style={{ width: '100%', maxWidth: 380, gap: spacing.md }}>
            <Text
              style={{
                fontFamily: fonts.display,
                fontSize: typeScale.title,
                color: colors.text,
                textAlign: 'center',
              }}
            >
              {t('outline.editCard')}
            </Text>
            <OrnamentDivider />
            <TextInput
              testID="outline-edit-title"
              value={draft?.title ?? ''}
              onChangeText={(next) =>
                setDraft((current) => (current === null ? null : { ...current, title: next }))
              }
              placeholder={t('outline.chapterTitlePlaceholder')}
              placeholderTextColor={colors.textMuted}
              style={fieldStyle}
            />
            <TextInput
              testID="outline-edit-summary"
              value={draft?.summary ?? ''}
              onChangeText={(next) =>
                setDraft((current) => (current === null ? null : { ...current, summary: next }))
              }
              placeholder={t('outline.summaryPlaceholder')}
              placeholderTextColor={colors.textMuted}
              multiline
              numberOfLines={3}
              style={[fieldStyle, { minHeight: 72, textAlignVertical: 'top' }]}
            />
            <TextInput
              testID="outline-edit-beats"
              value={draft?.beatsText ?? ''}
              onChangeText={(next) =>
                setDraft((current) => (current === null ? null : { ...current, beatsText: next }))
              }
              placeholder={t('outline.beatsPlaceholder')}
              placeholderTextColor={colors.textMuted}
              multiline
              numberOfLines={4}
              style={[fieldStyle, { minHeight: 96, textAlignVertical: 'top' }]}
            />
            <PrimaryButton
              label={t('outline.saveCard')}
              testID="outline-edit-save"
              disabled={!draftValid}
              onPress={saveDraft}
            />
            <Pressable
              accessibilityRole="button"
              testID="outline-edit-cancel"
              onPress={() => setDraft(null)}
              style={{ alignSelf: 'center', padding: spacing.xs }}
            >
              <Text
                style={{
                  fontFamily: fonts.bodyItalic,
                  fontSize: typeScale.bodySmall,
                  color: colors.textMutedStrong,
                }}
              >
                {t('outline.cancel')}
              </Text>
            </Pressable>
          </Card>
        </View>
      </Modal>
    </View>
  );
}
