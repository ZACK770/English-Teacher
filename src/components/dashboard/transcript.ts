type Segment = { role?: string; text?: string };

export function mergeTranscriptSegments(segments: Segment[]) {
  const turns: { role: 'learner' | 'tutor'; text: string }[] = [];
  for (const segment of segments) {
    const role = ['learner', 'user'].includes(segment.role || '') ? 'learner' : 'tutor';
    const text = segment.text?.trim() || '';
    const previous = turns.at(-1);
    if (previous?.role === role) {
      previous.text = [previous.text, text].filter(Boolean).join(' ');
    } else {
      turns.push({ role, text });
    }
  }
  return turns;
}
