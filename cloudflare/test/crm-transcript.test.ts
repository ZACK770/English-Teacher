import { describe, expect, it } from 'vitest';
import { mergeTranscriptSegments } from '../../src/components/dashboard/transcript';

describe('CRM transcript display', () => {
  it('joins adjacent speaker fragments without merging across replies or mutating input', () => {
    const segments = [
      { role: 'tutor', text: ' נעים להכיר, ' }, { role: 'assistant', text: 'אלי.' },
      { role: 'learner', text: 'Hello' }, { role: 'user', text: 'teacher' },
      { role: 'tutor', text: 'Welcome!' },
    ];
    const original = structuredClone(segments);
    expect(mergeTranscriptSegments(segments)).toEqual([
      { role: 'tutor', text: 'נעים להכיר, אלי.' },
      { role: 'learner', text: 'Hello teacher' },
      { role: 'tutor', text: 'Welcome!' },
    ]);
    expect(segments).toEqual(original);
  });

  it('handles empty transcripts and missing text without adding spaces', () => {
    expect(mergeTranscriptSegments([])).toEqual([]);
    expect(mergeTranscriptSegments([{}, { text: 'Hello' }, { text: '  ' }])).toEqual([
      { role: 'tutor', text: 'Hello' },
    ]);
  });

  it('preserves a speaker change even when its text is missing', () => {
    expect(mergeTranscriptSegments([
      { role: 'tutor', text: 'One' }, { role: 'learner' }, { role: 'tutor', text: 'Two' },
    ])).toEqual([
      { role: 'tutor', text: 'One' }, { role: 'learner', text: '' }, { role: 'tutor', text: 'Two' },
    ]);
  });
});
