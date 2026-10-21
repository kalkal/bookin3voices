// Reference vectors IDENTICAL to functions/src/ai/__tests__/rejections.test.ts.

import type { RevisionRecord } from '../ReviewSession';
import { rejectedKeys, rejectionKey, MAX_REJECTED_KEYS } from '../rejections';

const rev = (over: Partial<RevisionRecord>): RevisionRecord => ({
  id: 'r',
  span: { from: 0, to: 1 },
  before: 'un altra',
  after: "un'altra",
  decision: 'rejected',
  at: 1,
  ...over,
});

describe('rejections', () => {
  it('known values (shared with the server)', () => {
    expect(rejectionKey('un altra', "un'altra")).toBe('v1-84d280b844adf94e');
    expect(rejectionKey('posò lentamente', 'posò')).toBe('v1-e54c17fda7dab3b4');
  });

  it('keys of the rejected pairs only, alternatives included, no duplicates, newest first, bounded', () => {
    const keys = rejectedKeys([
      rev({ id: '1', at: 1 }),
      rev({ id: '2', decision: 'accepted', before: 'x', after: 'y', at: 2 }),
      rev({
        id: '3',
        before: 'posò lentamente',
        after: 'posò',
        alternatives: ['posò piano'],
        at: 3,
      }),
      rev({ id: '4', at: 4 }),
    ]);
    expect(keys).toEqual([
      rejectionKey('un altra', "un'altra"),
      rejectionKey('posò lentamente', 'posò'),
      rejectionKey('posò lentamente', 'posò piano'),
    ]);
    const many = Array.from({ length: MAX_REJECTED_KEYS + 50 }, (_, i) =>
      rev({ id: `${i}`, before: `w${i}`, at: i }),
    );
    expect(rejectedKeys(many)).toHaveLength(MAX_REJECTED_KEYS);
  });
});
