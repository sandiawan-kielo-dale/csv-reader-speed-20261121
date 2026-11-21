// A fast drop-in for csv-reader 1.0.0.
//
// run(input) returns exactly what csv-reader 1.0.0 returns for the same input:
// {columns, rows, errors}. The text is read once, left to right, under the
// reference's broken-row policy:
//
//   - a U+FEFF at the very start is dropped;
//   - a record ends at LF or CRLF, and a line left with no characters is no record;
//   - outside quotes a CR not followed by LF is dropped (stray_cr);
//   - a field that opens with a quote runs to the next quote that is not doubled,
//     "" inside it one quote, each CRLF or lone CR inside it read as LF; what
//     follows its closing quote, up to the next comma or line break, is appended
//     as it stands (quote_junk, when the field ends); a quote that never closes
//     is a literal character, and the text after it is read again as unquoted
//     (unterminated_quote);
//   - a quote inside an unquoted field is a literal character; fields stay
//     strings, never trimmed or converted;
//   - columns is the first record when header is true, else null; rows holds the
//     records after it, each padded with "" (short_row, with fields: its count)
//     or cut (long_row, with extra: the cut fields) to the first record's width;
//   - each error is {code, line, row}, in the order met, a record's short_row or
//     long_row when it ends: line the 1-based line its record starts on, row its
//     record's index in rows, null for the header.
//
// The speed comes from slicing fields out of the text instead of building them
// a character at a time. An unquoted field is found with one scan for the next
// delimiter and taken as a single slice; a quoted field is found with indexOf
// for the next quote and taken as slices between quotes. A field is only ever
// assembled piece by piece when it holds something that forces it: a stray CR,
// a doubled quote, or a line break inside quotes. Nothing is kept from one
// case to the next, and the output is deterministic.

// Reads unquoted characters from `start`, starting from `init`, up to the next
// comma or line break. A CR not followed by LF is dropped (stray_cr). Returns
// [value, ended, pos, line, added]: ended 0 at a comma, 1 at a line break, 2 at
// the end of the text; added counts the characters this scan kept, the initial
// `init` not counted. Used only where a field is re-read after a quote: the
// junk after a closing quote, and the text after a quote that never closes.
function readUnquoted(text, start, init, errors, recordLine, recordRow, line) {
  const n = text.length;
  let segStart = start;
  let parts = null;
  let added = 0;
  let p = start;
  for (;;) {
    while (p < n) {
      const c = text.charCodeAt(p);
      if (c === 44 || c === 10 || c === 13) break;
      p += 1;
    }
    // The character the scan stopped at, or -1 at the end of the text.
    const d = p < n ? text.charCodeAt(p) : -1;
    if (d === 13 && (p + 1 >= n || text.charCodeAt(p + 1) !== 10)) {
      // A lone CR: dropped, and the scan goes on after it.
      errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
      added += p - segStart;
      if (parts === null) parts = [text.slice(segStart, p)];
      else parts.push(text.slice(segStart, p));
      p += 1;
      segStart = p;
      continue;
    }
    added += p - segStart;
    const seg = text.slice(segStart, p);
    const value = parts === null ? init + seg : init + parts.join('') + seg;
    if (d === -1) return [value, 2, n, line, added];
    if (d === 44) return [value, 0, p + 1, line, added];
    if (d === 10) return [value, 1, p + 1, line + 1, added];
    return [value, 1, p + 2, line + 1, added];
  }
}

/** csv-reader 1.0.0's answer for one case's input, {text, header}. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const n = text.length;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  let pos = 0; // the next character to read
  let line = 1; // the line that character is on
  if (n > 0 && text.charCodeAt(0) === 0xFEFF) pos = 1;

  while (true) {
    // Lines with no characters are no records.
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === 10) {
        pos += 1;
        line += 1;
      } else if (c === 13 && pos + 1 < n && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= n) break;

    // The record being read: the line it starts on and the index in rows it
    // takes (null: the header).
    const recordLine = line;
    const recordRow = header && columns === null ? null : rows.length;
    const fields = [];
    let lastQuoted = false;
    let ended = 2;

    for (;;) {
      let value;
      if (text.charCodeAt(pos) === 34) {
        // A field that opens with a quote.
        lastQuoted = true;
        const open = pos;
        const openLine = line;
        let p = pos + 1;
        let val = '';
        let closed = false;
        while (true) {
          const q = text.indexOf('"', p);
          if (q === -1) break;
          let seg = text.slice(p, q);
          if (seg.indexOf('\r') !== -1 || seg.indexOf('\n') !== -1) {
            // CRLF and a lone CR inside quotes are each one LF, and each
            // counts one line.
            let breaks = 0;
            for (let i = 0; i < seg.length; i++) {
              const cc = seg.charCodeAt(i);
              if (cc === 13) {
                breaks += 1;
                if (seg.charCodeAt(i + 1) === 10) i += 1;
              } else if (cc === 10) {
                breaks += 1;
              }
            }
            line += breaks;
            seg = seg.replace(/\r\n?/g, '\n');
          }
          if (q + 1 < n && text.charCodeAt(q + 1) === 34) {
            // A doubled quote is one quote, and the field goes on.
            val += seg + '"';
            p = q + 2;
            continue;
          }
          val += seg;
          pos = q + 1;
          closed = true;
          break;
        }
        if (!closed) {
          // The quote never closes: it is a literal character, and the text
          // after it is read again as unquoted.
          pos = open + 1;
          line = openLine;
          errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
          const r = readUnquoted(text, pos, '"', errors, recordLine, recordRow, line);
          value = r[0];
          ended = r[1];
          pos = r[2];
          line = r[3];
        } else if (pos >= n) {
          value = val;
          ended = 2;
        } else {
          const c = text.charCodeAt(pos);
          if (c === 44) {
            value = val;
            pos += 1;
            ended = 0;
          } else if (c === 10) {
            value = val;
            pos += 1;
            line += 1;
            ended = 1;
          } else if (c === 13 && pos + 1 < n && text.charCodeAt(pos + 1) === 10) {
            value = val;
            pos += 2;
            line += 1;
            ended = 1;
          } else {
            // What follows the closing quote is appended as it stands, up to
            // the next comma or line break.
            const r = readUnquoted(text, pos, val, errors, recordLine, recordRow, line);
            value = r[0];
            ended = r[1];
            pos = r[2];
            line = r[3];
            if (r[4] > 0) errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
          }
        }
      } else {
        // An unquoted field: one scan to the next delimiter, taken as a slice.
        // A quote inside it is a literal character.
        lastQuoted = false;
        let segStart = pos;
        let parts = null;
        let p = pos;
        for (;;) {
          while (p < n) {
            const c = text.charCodeAt(p);
            if (c === 44 || c === 10 || c === 13) break;
            p += 1;
          }
          // The character the scan stopped at, or -1 at the end of the text.
          const d = p < n ? text.charCodeAt(p) : -1;
          if (d === 13 && (p + 1 >= n || text.charCodeAt(p + 1) !== 10)) {
            // A lone CR: dropped, and the scan goes on after it.
            errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
            if (parts === null) parts = [text.slice(segStart, p)];
            else parts.push(text.slice(segStart, p));
            p += 1;
            segStart = p;
            continue;
          }
          const seg = text.slice(segStart, p);
          value = parts === null ? seg : parts.join('') + seg;
          if (d === -1) {
            pos = n;
            ended = 2;
          } else if (d === 44) {
            pos = p + 1;
            ended = 0;
          } else if (d === 10) {
            pos = p + 1;
            line += 1;
            ended = 1;
          } else {
            pos = p + 2;
            line += 1;
            ended = 1;
          }
          break;
        }
      }
      fields.push(value);
      if (ended !== 0) break;
    }

    // A line that held only stray CRs is left with no characters: no record
    // (its stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !lastQuoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
