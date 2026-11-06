const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;

export function isValidEmail(value: string): boolean {
  return EMAIL_PATTERN.test(value.trim());
}

export function parseManualRecipients(value: string): { valid: string[]; invalid: string[] } {
  const valid: string[] = [];
  const invalid: string[] = [];
  const seen = new Set<string>();

  for (const item of value.split(/[\n,;]+/)) {
    const trimmed = item.trim();
    if (!trimmed) {
      continue;
    }

    const normalized = trimmed.toLowerCase();
    if (!isValidEmail(normalized)) {
      invalid.push(trimmed);
      continue;
    }

    if (seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    valid.push(normalized);
  }

  return { valid, invalid };
}

export function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];

    if (character === '"') {
      if (inQuotes && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (character === ',' && !inQuotes) {
      cells.push(current.trim());
      current = '';
      continue;
    }

    current += character;
  }

  cells.push(current.trim());
  return cells;
}

export function pickEmailFromCsvRow(row: string[]): string | null {
  const list = row.map((value) => value.trim()).filter(Boolean);

  if (list.length === 0) {
    return null;
  }

  const emailColumnIndex = list.findIndex((value) => /email|recipient/i.test(value));
  if (emailColumnIndex >= 0) {
    const candidate = list[emailColumnIndex + 1] ?? list[emailColumnIndex];
    if (candidate && EMAIL_PATTERN.test(candidate)) {
      return candidate.toLowerCase();
    }
  }

  for (const value of list) {
    if (EMAIL_PATTERN.test(value)) {
      return value.toLowerCase();
    }
  }

  return null;
}

export function parseCsvRecipients(csvContent: string): { valid: string[]; invalid: string[] } {
  const valid: string[] = [];
  const invalid: string[] = [];
  const seen = new Set<string>();

  const rows = csvContent
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (const row of rows) {
    const cells = parseCsvLine(row).map((cell) => cell.trim()).filter(Boolean);
    const isHeaderRow = cells.length > 0 && cells.every((cell) => /^(name|email|recipient|to|cc|bcc)$/i.test(cell));

    if (isHeaderRow) {
      continue;
    }

    const email = pickEmailFromCsvRow(cells);

    if (!email) {
      const label = cells[0] || 'Unnamed row';
      invalid.push(label);
      continue;
    }

    if (seen.has(email)) {
      continue;
    }

    seen.add(email);
    valid.push(email);
  }

  return { valid, invalid };
}
