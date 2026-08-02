export interface ICsvTable {
  headers: string[]
  rows: Array<Record<string, string>>
}

const parseRows = (input: string, delimiter: string): string[][] => {
  if (delimiter.length !== 1 || delimiter === '"' || delimiter === '\r' || delimiter === '\n') {
    throw new Error('CSV delimiter must be one character other than a quote or line break.')
  }

  const rows: string[][] = []
  let field = ''
  let quoted = false
  let row: string[] = []

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index]
    if (quoted) {
      if (character === '"') {
        if (input[index + 1] === '"') {
          field += '"'
          index += 1
        } else {
          quoted = false
        }
      } else {
        field += character
      }

      continue
    }

    switch (character) {
    case '\r':
    case '\n': {
      row.push(field)
      rows.push(row)
      field = ''
      row = []
      if (character === '\r' && input[index + 1] === '\n') index += 1
    
    break;
    }

    case '"': {
      if (field.length > 0) throw new Error(`Unexpected quote in CSV row ${rows.length + 1}.`)
      quoted = true
    
    break;
    }
 
    case delimiter: {
      row.push(field)
      field = ''
    
    break;
    }

    default: {
      field += character
    }
    }
  }

  if (quoted) throw new Error('CSV contains an unterminated quoted field.')
  if (field.length > 0 || row.length > 0) {
    row.push(field)
    rows.push(row)
  }

  return rows
}

export function parseCsv(input: string, delimiter = ','): ICsvTable {
  const normalized = input.startsWith('\uFEFF') ? input.slice(1) : input
  const parsed = parseRows(normalized, delimiter)
  if (parsed.length === 0) throw new Error('CSV file is empty.')

  const headers = parsed[0]
  if (headers.some(header => header.length === 0)) throw new Error('CSV headers must not be empty.')
  const duplicates = headers.filter((header, index) => headers.indexOf(header) !== index)
  if (duplicates.length > 0) {
    throw new Error(`CSV contains duplicate headers: ${[...new Set(duplicates)].join(', ')}.`)
  }

  const rows = parsed.slice(1)
  if (rows.at(-1)?.every(value => value === '')) rows.pop()
  return {
    headers,
    rows: rows.map((values, index) => {
      if (values.length !== headers.length) {
        throw new Error(`CSV row ${index + 2} has ${values.length} columns; expected ${headers.length}.`)
      }

      return Object.fromEntries(headers.map((header, column) => [header, values[column]]))
    }),
  }
}
