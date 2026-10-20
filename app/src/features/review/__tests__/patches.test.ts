import { applyPatch, diffAsPatch, invertPatch, remapSpan } from '../patches';
import type { TextPatch } from '../patches';

const TEXT = 'Posò lentamente il telefono sul davanzale.';

function patchOf(before: string, after: string, from: number): TextPatch {
  return { span: { from, to: from + before.length }, before, after };
}

describe('applyPatch (never blind application)', () => {
  it('applies the patch when original matches', () => {
    const patch = patchOf('Posò lentamente', 'Posò', 0);
    const result = applyPatch(TEXT, patch);
    expect(result).toEqual({ ok: true, text: 'Posò il telefono sul davanzale.' });
  });

  it('cleanly rejects if the text at the span no longer matches', () => {
    const patch = patchOf('Posò lentissimo', 'Posò', 0);
    expect(applyPatch(TEXT, patch)).toEqual({ ok: false, reason: 'original-mismatch' });
  });

  it('cleanly rejects if the span falls outside the text', () => {
    const patch = patchOf('coda', 'x', TEXT.length - 2);
    expect(applyPatch(TEXT, patch)).toEqual({ ok: false, reason: 'span-out-of-range' });
  });
});

describe('invertPatch (undo of the Command pattern)', () => {
  it('applying the patch and then its inverse restores the text', () => {
    const patch = patchOf('lentamente', 'piano piano', 5);
    const applied = applyPatch(TEXT, patch);
    if (!applied.ok) throw new Error('patch not applied');
    const undone = applyPatch(applied.text, invertPatch(patch));
    expect(undone).toEqual({ ok: true, text: TEXT });
  });
});

describe('remapSpan (re-mapping of pending spans)', () => {
  const applied = patchOf('lentamente', 'piano', 5); // delta -5

  it('span entirely before the patch: unchanged', () => {
    expect(remapSpan({ from: 0, to: 4 }, applied)).toEqual({ from: 0, to: 4 });
  });

  it('span ending exactly where the patch starts: unchanged', () => {
    expect(remapSpan({ from: 0, to: 5 }, applied)).toEqual({ from: 0, to: 5 });
  });

  it('span entirely after the patch: shifted by the delta', () => {
    expect(remapSpan({ from: 19, to: 28 }, applied)).toEqual({ from: 14, to: 23 });
  });

  it('span starting exactly where the patch ends: shifted', () => {
    expect(remapSpan({ from: 15, to: 18 }, applied)).toEqual({ from: 10, to: 13 });
  });

  it('span overlapping the patched zone: overlap (will become stale)', () => {
    expect(remapSpan({ from: 10, to: 20 }, applied)).toBe('overlap');
    expect(remapSpan({ from: 0, to: 6 }, applied)).toBe('overlap');
    expect(remapSpan({ from: 7, to: 9 }, applied)).toBe('overlap');
  });
});

describe('diffAsPatch (manual edit → one minimal patch)', () => {
  it('no difference → null', () => {
    expect(diffAsPatch(TEXT, TEXT)).toBeNull();
  });

  it('replacement in the middle', () => {
    const patch = diffAsPatch('una casa rossa', 'una casa verde');
    expect(patch).toEqual({ span: { from: 9, to: 14 }, before: 'rossa', after: 'verde' });
  });

  it('pure insertion (empty span)', () => {
    const patch = diffAsPatch('una casa', 'una bella casa');
    expect(patch).toEqual({ span: { from: 4, to: 4 }, before: '', after: 'bella ' });
    expect(applyPatch('una casa', patch as NonNullable<typeof patch>)).toEqual({
      ok: true,
      text: 'una bella casa',
    });
  });

  it('deletion at the end', () => {
    const patch = diffAsPatch('una casa rossa', 'una casa');
    expect(patch).toEqual({ span: { from: 8, to: 14 }, before: ' rossa', after: '' });
  });

  it('repeated characters at the junction: prefix and suffix do not overlap', () => {
    const patch = diffAsPatch('aaa', 'aa');
    expect(patch).not.toBeNull();
    const applied = applyPatch('aaa', patch as NonNullable<typeof patch>);
    expect(applied).toEqual({ ok: true, text: 'aa' });
  });
});
