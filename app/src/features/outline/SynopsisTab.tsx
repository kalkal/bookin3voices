/**
 * Tab Sinossi del Libro: campo sinossi con
 * salvataggio, "Genera scaletta capitoli" → anteprima a schede tipo corkboard
 * (titolo + riassunto + beat), modificabili ed eliminabili PRIMA della
 * conferma; conferma = merge additivo via repository (i capitoli
 * con testo non si toccano MAI, le schede riempiono prima gli slot vuoti).
 * Stato di avanzamento ed errori sempre visibili, mai spinner muti.
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

import { Card, OrnamentDivider, PrimaryButton } from '../../components';
import { makeRequestId } from '../../lib/requestId';
import { useTheme } from '../../theme';
import type { Book, BookRepository } from '../books';
import type { ChapterRepository, ChapterSummary } from '../chapters';
import { applyOutlineMerge, planOutlineMerge } from './merge';
import type { OutlineCard, OutlineService } from './types';

// Avviso chiave di sviluppo: costante condivisa con le altre
// superfici AI (editor) in lib/freeTier, riesportata da qui per gli usi
// esistenti. Spenta con il provider predefinito (vedi lib/freeTier).
import { SHOW_FREE_TIER_WARNING } from '../../lib/freeTier';

export { SHOW_FREE_TIER_WARNING };

export interface SynopsisTabProps {
  book: Book;
  bookRepository: BookRepository;
  chapterRepository: ChapterRepository;
  outlineService: OutlineService;
}

type Progress =
  | { phase: 'idle' }
  | { phase: 'working'; message: string }
  | { phase: 'done'; message: string }
  | { phase: 'error'; message: string };

interface CardDraft {
  index: number;
  title: string;
  summary: string;
  beatsText: string;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim() !== '') return error.message;
  return 'Errore inatteso durante la generazione della scaletta.';
}

function mergeMessage(result: { updated: number; created: number; skipped: number }): string {
  const parts: string[] = [];
  if (result.updated > 0)
    parts.push(
      `${result.updated} ${result.updated === 1 ? 'capitolo vuoto riempito' : 'capitoli vuoti riempiti'}`,
    );
  if (result.created > 0)
    parts.push(`${result.created} ${result.created === 1 ? 'capitolo nuovo' : 'capitoli nuovi'}`);
  if (result.skipped > 0)
    parts.push(
      `${result.skipped} ${result.skipped === 1 ? 'saltato perché ha già testo' : 'saltati perché hanno già testo'}`,
    );
  return parts.length === 0
    ? 'Nessun capitolo da creare.'
    : `Scaletta salvata: ${parts.join(', ')}.`;
}

export function SynopsisTab({
  book,
  bookRepository,
  chapterRepository,
  outlineService,
}: SynopsisTabProps) {
  const { colors, fonts, spacing, radius, typeScale } = useTheme();

  // La sinossi parte dal libro e resta dell'utente finché non salva: gli
  // aggiornamenti remoti (observeBook) non sovrascrivono ciò che sta digitando.
  const [synopsis, setSynopsis] = useState(book.synopsis);
  const [synopsisSaved, setSynopsisSaved] = useState(false);

  const [chapters, setChapters] = useState<ChapterSummary[]>([]);
  const [cards, setCards] = useState<OutlineCard[] | null>(null);
  const [draft, setDraft] = useState<CardDraft | null>(null);
  const [progress, setProgress] = useState<Progress>({ phase: 'idle' });

  useEffect(() => {
    return chapterRepository.observeChapters(book.id, setChapters, () => {});
  }, [chapterRepository, book.id]);

  const working = progress.phase === 'working';
  const synopsisDirty = synopsis !== book.synopsis;
  const writtenCount = chapters.filter((chapter) => chapter.wordCount > 0).length;
  const emptyCount = chapters.length - writtenCount;

  const saveSynopsis = () => {
    setSynopsisSaved(true);
    bookRepository.updateBook(book.id, { synopsis }).catch(() => {
      setSynopsisSaved(false);
      setProgress({ phase: 'error', message: 'Salvataggio della sinossi non riuscito.' });
    });
  };

  const generate = async () => {
    setProgress({ phase: 'working', message: 'Generazione della scaletta in corso…' });
    try {
      const proposal = await outlineService.generateOutline({
        bookId: book.id,
        synopsis: synopsis.trim(),
        requestId: makeRequestId('out'),
      });
      setCards(proposal.chapters);
      setProgress({ phase: 'idle' });
    } catch (error) {
      setProgress({ phase: 'error', message: errorMessage(error) });
    }
  };

  const confirm = async () => {
    if (cards === null || cards.length === 0) return;
    setProgress({ phase: 'working', message: 'Creazione dei capitoli…' });
    try {
      const plan = planOutlineMerge(chapters, cards);
      const result = await applyOutlineMerge(chapterRepository, book.id, plan);
      setCards(null);
      setProgress({ phase: 'done', message: mergeMessage(result) });
    } catch (error) {
      setProgress({ phase: 'error', message: errorMessage(error) });
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
    <ScrollView
      testID="synopsis-tab"
      contentContainerStyle={{ padding: spacing.xl, gap: spacing.lg }}
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
            Chiave AI di sviluppo attiva
          </Text>
          <Text
            style={{
              fontFamily: fonts.body,
              fontSize: typeScale.bodySmall,
              color: colors.textMuted,
            }}
          >
            Non inserire la sinossi reale del libro: con la chiave gratuita i testi inviati possono
            essere usati per addestrare i modelli. Usa solo trame di prova finché l’app non passa
            alla chiave definitiva.
          </Text>
        </Card>
      )}

      <Card style={{ gap: spacing.md }}>
        {sectionTitle('Sinossi')}
        <OrnamentDivider style={{ alignSelf: 'stretch' }} />
        <TextInput
          testID="synopsis-input"
          value={synopsis}
          onChangeText={(next) => {
            setSynopsis(next);
            setSynopsisSaved(false);
          }}
          placeholder="La trama del libro, in poche righe: da qui nasce la scaletta."
          placeholderTextColor={colors.textMuted}
          multiline
          numberOfLines={7}
          style={[fieldStyle, { minHeight: 150, textAlignVertical: 'top' }]}
        />
        <PrimaryButton
          label="Salva sinossi"
          testID="synopsis-save"
          disabled={!synopsisDirty}
          onPress={saveSynopsis}
        />
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
            Sinossi salvata ✓
          </Text>
        )}
      </Card>

      {cards === null && (
        <Card style={{ gap: spacing.md }}>
          {sectionTitle('Scaletta capitoli')}
          <OrnamentDivider style={{ alignSelf: 'stretch' }} />
          {mutedNote(
            writtenCount > 0
              ? `I ${writtenCount === 1 ? 'capitolo già scritto resta intoccato' : `${writtenCount} capitoli già scritti restano intoccati`}: le nuove schede riempiono prima ${emptyCount === 1 ? 'il capitolo vuoto' : 'i capitoli vuoti'} e il resto va in coda.`
              : 'La scaletta proposta si rivede scheda per scheda prima di creare i capitoli.',
            'synopsis-merge-note',
          )}
          <PrimaryButton
            label={working ? 'Generazione in corso…' : 'Genera scaletta capitoli'}
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
          {sectionTitle('Anteprima scaletta')}
          <OrnamentDivider style={{ alignSelf: 'stretch' }} />
          {mutedNote(
            'Schede modificabili: niente viene creato finché non confermi. I capitoli con testo non vengono toccati.',
          )}
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
                  accessibilityLabel={`Modifica ${card.title}`}
                  testID={`outline-card-edit-${index}`}
                  onPress={() => openDraft(index, card)}
                  style={{ padding: spacing.xs }}
                >
                  <Ionicons name="create-outline" size={19} color={colors.textMutedStrong} />
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Elimina ${card.title}`}
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
          <PrimaryButton
            label={
              working
                ? 'Creazione in corso…'
                : cards.length === 1
                  ? 'Crea 1 capitolo'
                  : `Crea ${cards.length} capitoli`
            }
            testID="outline-confirm"
            disabled={working || cards.length === 0}
            onPress={() => {
              void confirm();
            }}
          />
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
              Scarta la proposta
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
              Modifica scheda
            </Text>
            <OrnamentDivider />
            <TextInput
              testID="outline-edit-title"
              value={draft?.title ?? ''}
              onChangeText={(next) =>
                setDraft((current) => (current === null ? null : { ...current, title: next }))
              }
              placeholder="Titolo del capitolo"
              placeholderTextColor={colors.textMuted}
              style={fieldStyle}
            />
            <TextInput
              testID="outline-edit-summary"
              value={draft?.summary ?? ''}
              onChangeText={(next) =>
                setDraft((current) => (current === null ? null : { ...current, summary: next }))
              }
              placeholder="Riassunto del capitolo"
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
              placeholder={'Un beat per riga'}
              placeholderTextColor={colors.textMuted}
              multiline
              numberOfLines={4}
              style={[fieldStyle, { minHeight: 96, textAlignVertical: 'top' }]}
            />
            <PrimaryButton
              label="Salva scheda"
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
                Annulla
              </Text>
            </Pressable>
          </Card>
        </View>
      </Modal>
    </ScrollView>
  );
}
