import { describe, expect, it } from 'vitest';

import { parseCsvRecipients, parseManualRecipients, pickEmailFromCsvRow } from './compose.ts';

describe('compose helpers', () => {
  it('extracts valid email addresses from CSV rows and drops duplicate entries', () => {
    const csv = [
      'name,email',
      'Alice,alice@example.com',
      'Bob,bob@example.com',
      'Alice Duplicate,alice@example.com',
      'Bad Row,not-an-email',
      'charlie@example.com',
    ].join('\n');

    const result = parseCsvRecipients(csv);

    expect(result.valid).toEqual(['alice@example.com', 'bob@example.com', 'charlie@example.com']);
    expect(result.invalid).toEqual(['Bad Row']);
  });

  it('reads an email from a CSV row even when the first column is an email address', () => {
    expect(pickEmailFromCsvRow(['hello@example.com'])).toBe('hello@example.com');
    expect(pickEmailFromCsvRow(['Name', 'team@example.com'])).toBe('team@example.com');
    expect(pickEmailFromCsvRow(['Name', 'not-an-email'])).toBeNull();
  });

  it('rejects invalid manually entered recipients and keeps valid unique entries', () => {
    const result = parseManualRecipients('alice@example.com, bad-email, bob@example.com\nalice@example.com, charlie@example.com');

    expect(result.valid).toEqual(['alice@example.com', 'bob@example.com', 'charlie@example.com']);
    expect(result.invalid).toEqual(['bad-email']);
  });
});
