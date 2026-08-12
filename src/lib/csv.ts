/**
 * A CSV reader and writer, because importing one for this would be a
 * dependency on the redirect Worker's neighbour for about forty lines of code.
 *
 * Handles the parts of RFC 4180 that real exports actually use: quoted fields,
 * doubled quotes inside them, embedded newlines, and both line endings.
 */

export function csvEscape(value: unknown): string {
	if (value === null || value === undefined) return '';
	const text = value instanceof Date ? value.toISOString() : String(value);
	return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function csvLine(values: unknown[]): string {
	return `${values.map(csvEscape).join(',')}\r\n`;
}

export function toCsv(headers: string[], rows: unknown[][]): string {
	return csvLine(headers) + rows.map(csvLine).join('');
}

/** Split a CSV document into rows of raw string cells. */
export function parseCsv(input: string): string[][] {
	const rows: string[][] = [];
	let row: string[] = [];
	let field = '';
	let quoted = false;
	let started = false;

	const endField = () => {
		row.push(field);
		field = '';
		started = false;
	};
	const endRow = () => {
		endField();
		// A trailing newline should not produce a phantom empty row.
		if (row.length > 1 || row[0] !== '') rows.push(row);
		row = [];
	};

	for (let i = 0; i < input.length; i++) {
		const char = input[i]!;

		if (quoted) {
			if (char === '"') {
				if (input[i + 1] === '"') {
					field += '"';
					i++;
				} else {
					quoted = false;
				}
			} else {
				field += char;
			}
			continue;
		}

		if (char === '"' && !started) {
			quoted = true;
			started = true;
		} else if (char === ',') {
			endField();
		} else if (char === '\n') {
			endRow();
		} else if (char === '\r') {
			// Swallowed; the \n that follows ends the row.
		} else {
			field += char;
			started = true;
		}
	}

	if (field !== '' || row.length > 0) endRow();
	return rows;
}

/**
 * Parse into objects keyed by the header row.
 *
 * Headers are lowercased and stripped of spaces and underscores, so
 * `Destination URL`, `destination_url` and `destinationurl` all land on the
 * same key — which matters when the file came out of some other shortener.
 */
export function parseCsvObjects(input: string): Record<string, string>[] {
	const rows = parseCsv(input);
	const [header, ...body] = rows;
	if (!header) return [];

	const keys = header.map((cell) => cell.trim().toLowerCase().replace(/[\s_-]+/g, ''));
	return body.map((cells) => {
		const record: Record<string, string> = {};
		keys.forEach((key, index) => {
			if (key) record[key] = (cells[index] ?? '').trim();
		});
		return record;
	});
}
