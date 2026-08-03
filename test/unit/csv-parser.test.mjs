import assert from 'node:assert/strict'
import {test} from 'node:test'

import {parseCsv} from '../../dist/shared/csv-parser.js'

test('parseCsv handles BOM, CRLF, quotes, embedded newlines, and trailing newline', () => {
  assert.deepEqual(
    parseCsv('\uFEFFlabel,text\r\na,"line 1\nline 2"\r\nb,"Say ""Hi"""\r\n'),
    {
      headers: ['label', 'text'],
      rows: [
        {label: 'a', text: 'line 1\nline 2'},
        {label: 'b', text: 'Say "Hi"'},
      ],
    },
  )
})

test('parseCsv supports a custom delimiter', () => {
  assert.deepEqual(parseCsv('label;text\nkey;Value\n', ';'), {
    headers: ['label', 'text'],
    rows: [{label: 'key', text: 'Value'}],
  })
})

test('parseCsv rejects invalid delimiters', () => {
  for (const delimiter of ['', '::', '"', '\r', '\n']) {
    assert.throws(
      () => parseCsv('label,text\nkey,Value\n', delimiter),
      /CSV delimiter must be one character other than a quote or line break/,
    )
  }
})

test('parseCsv rejects empty files and invalid headers', () => {
  assert.throws(() => parseCsv(''), /CSV file is empty/)
  assert.throws(() => parseCsv('label,\nkey,value\n'), /CSV headers must not be empty/)
  assert.throws(() => parseCsv('label,label\nkey,value\n'), /duplicate headers: label/)
})

test('parseCsv rejects malformed quoted fields', () => {
  assert.throws(() => parseCsv('label,text\nkey,unexpected"quote\n'), /Unexpected quote in CSV row 2/)
  assert.throws(() => parseCsv('label,text\nkey,"unterminated\n'), /unterminated quoted field/)
})

test('parseCsv rejects rows with the wrong number of columns', () => {
  assert.throws(
    () => parseCsv('label,text\nkey,value,extra\n'),
    /CSV row 2 has 3 columns; expected 2/,
  )
})
