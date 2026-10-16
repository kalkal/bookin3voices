import { applyPatch, diffAsPatch, invertPatch, remapSpan } from '../patches';
import type { TextPatch } from '../patches';

const TEXT = 'Posò lentamente il bicchiere nel lavello.';

function patchOf(before: string, after: string, from: number): TextPatch {
  return { span: { from, to: from + before.length }, before, after };
}

describe('applyPatch (mai applicazione cieca)', () => {
  it('applica la patch quando original combacia', () => {
    const patch = patchOf('Posò lentamente', 'Posò', 0);
    const result = applyPatch(TEXT, patch);
    expect(result).toEqual({ ok: true, text: 'Posò il bicchiere nel lavello.' });
  });

  it('rifiuta pulito se il testo allo span non combacia più', () => {
    const patch = patchOf('Posò lentissimo', 'Posò', 0);
    expect(applyPatch(TEXT, patch)).toEqual({ ok: false, reason: 'original-mismatch' });
  });

  it('rifiuta pulito se lo span esce dal testo', () => {
    const patch = patchOf('coda', 'x', TEXT.length - 2);
    expect(applyPatch(TEXT, patch)).toEqual({ ok: false, reason: 'span-out-of-range' });
  });
});

describe('invertPatch (undo del Command pattern)', () => {
  it('applicare la patch e poi la sua inversa ripristina il testo', () => {
    const patch = patchOf('lentamente', 'piano piano', 5);
    const applied = applyPatch(TEXT, patch);
    if (!applied.ok) throw new Error('patch non applicata');
    const undone = applyPatch(applied.text, invertPatch(patch));
    expect(undone).toEqual({ ok: true, text: TEXT });
  });
});

describe('remapSpan (ri-mappatura degli span pending)', () => {
  const applied = patchOf('lentamente', 'piano', 5); // delta -5

  it('span interamente prima della patch: invariato', () => {
    expect(remapSpan({ from: 0, to: 4 }, applied)).toEqual({ from: 0, to: 4 });
  });

  it('span che finisce esattamente dove inizia la patch: invariato', () => {
    expect(remapSpan({ from: 0, to: 5 }, applied)).toEqual({ from: 0, to: 5 });
  });

  it('span interamente dopo la patch: shift del delta', () => {
    expect(remapSpan({ from: 19, to: 28 }, applied)).toEqual({ from: 14, to: 23 });
  });

  it('span che inizia esattamente dove finisce la patch: shift', () => {
    expect(remapSpan({ from: 15, to: 18 }, applied)).toEqual({ from: 10, to: 13 });
  });

  it('span sovrapposto alla zona patchata: overlap (diventerà stale)', () => {
    expect(remapSpan({ from: 10, to: 20 }, applied)).toBe('overlap');
    expect(remapSpan({ from: 0, to: 6 }, applied)).toBe('overlap');
    expect(remapSpan({ from: 7, to: 9 }, applied)).toBe('overlap');
  });
});

describe('diffAsPatch (edit manuale → una patch minima)', () => {
  it('nessuna differenza → null', () => {
    expect(diffAsPatch(TEXT, TEXT)).toBeNull();
  });

  it('sostituzione in mezzo', () => {
    const patch = diffAsPatch('una casa rossa', 'una casa verde');
    expect(patch).toEqual({ span: { from: 9, to: 14 }, before: 'rossa', after: 'verde' });
  });

  it('inserimento puro (span vuoto)', () => {
    const patch = diffAsPatch('una casa', 'una bella casa');
    expect(patch).toEqual({ span: { from: 4, to: 4 }, before: '', after: 'bella ' });
    expect(applyPatch('una casa', patch as NonNullable<typeof patch>)).toEqual({
      ok: true,
      text: 'una bella casa',
    });
  });

  it('cancellazione in coda', () => {
    const patch = diffAsPatch('una casa rossa', 'una casa');
    expect(patch).toEqual({ span: { from: 8, to: 14 }, before: ' rossa', after: '' });
  });

  it('caratteri ripetuti alla giunzione: prefisso e suffisso non si sovrappongono', () => {
    const patch = diffAsPatch('aaa', 'aa');
    expect(patch).not.toBeNull();
    const applied = applyPatch('aaa', patch as NonNullable<typeof patch>);
    expect(applied).toEqual({ ok: true, text: 'aa' });
  });
});
