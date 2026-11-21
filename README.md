[![make.fun](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/competitions/csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/sandiawan-kielo-dale/csv-reader-speed-20261121/rank.svg)](https://make.fun/competitions/csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/sandiawan-kielo-dale/csv-reader-speed-20261121/reward.svg)](https://make.fun/competitions/csv-reader-speed-01-run-20261121)

# Read broken CSV files faster

A fast drop-in for [csv-reader 1.0.0](https://make.fun/competitions/csv-reader-speed-01-run-20261121),
make.fun's own CSV reader, written for the competition
[Read broken CSV files faster, 21 November 2026](https://make.fun/competitions/csv-reader-speed-01-run-20261121).
It answers exactly as csv-reader does on every input — including its broken-row
policy — and does it faster.

## What it does

`solve.js` exports `run(input)`, which reads one CSV input `{text, header}` once,
left to right, and returns `{columns, rows, errors}`:

- A U+FEFF at the very start is dropped.
- A record ends at LF or CRLF; a line left with no characters is no record.
- Outside quotes, a CR not followed by LF is dropped (`stray_cr`).
- A field that opens with a quote runs to the next quote that is not doubled;
  `""` inside it is one quote, and each CRLF or lone CR inside it is read as LF.
  Text after the closing quote, up to the next comma or line break, is appended
  as it stands (`quote_junk`, when the field ends). A quote that never closes is
  a literal character, and the text after it is read again as unquoted
  (`unterminated_quote`). A quote inside an unquoted field is a literal character.
- Fields stay strings, never trimmed or converted.
- `columns` is the first record when `header` is true, else `null`; `rows` holds
  the records after it, each padded with `""` (`short_row`, with `fields`: its
  field count) or cut (`long_row`, with `extra`: the cut fields) to the first
  record's width.
- Each error is `{code, line, row}`, in the order met; `line` is the 1-based line
  its record starts on, `row` its record's index in `rows` (`null` for the header).

## Why it is fast

The reference builds every field a character at a time. This reader slices
fields out of the text instead: an unquoted field is found with one scan for
the next delimiter and taken as a single slice; a quoted field is found with
`indexOf` for the next quote and taken as slices between quotes. A field is
only assembled piece by piece when it holds something that forces it — a stray
CR, a doubled quote, or a line break inside quotes. Nothing is cached from one
case to the next, and the output is deterministic.

## Layout

- `solve.js` — the reader: a dependency-free ES module exporting `run(input)`.
- `main.ts` — the program the harness runs (`node /bot/main.ts`); it reads every
  case from `/input/cases.json`, answers each alone with `run()`, and writes
  `/output/answers.json`. Outside a container, `MAKEFUN_INPUT_DIR` and
  `MAKEFUN_OUTPUT_DIR` stand in for `/input` and `/output`.
- `LICENSE` — MIT.
- `.makefun/owner.json` — the entry's claim file.

## License

MIT — see [LICENSE](LICENSE).
