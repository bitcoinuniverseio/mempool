/**
 * The bounded read-only query language of Query Studio.
 *
 * A caller's SQL never reaches the engine as text. It is tokenised, parsed
 * into a small tree, checked against an explicit allowlist of tables and
 * columns, and rendered again with quoted identifiers and parameter
 * placeholders for every literal. What the engine receives is therefore a
 * statement this file composed, and the keywords it understands are the
 * complete list below. Everything else (a second statement, a comment, a
 * subquery, a join, a function that is not an aggregate, a write, DDL, a
 * variable, an identifier outside the allowlist) is a parse error before any
 * connection is touched. A keyword inside a string literal is data.
 */

export class QueryGrammarError extends Error {
  constructor(message: string, public readonly position: number | null = null) {
    super(message);
  }
}

export const QUERY_GRAMMAR_LIMITS = {
  sqlLength: 4096,
  tokens: 512,
  selectItems: 64,
  inListValues: 128,
  stringLength: 512,
  identifierLength: 64,
  predicateDepth: 8,
} as const;

/** Columns of the explorer tables Query Studio may read. Names are the migration's. */
export interface AllowedTable {
  description: string;
  columns: readonly string[];
}

export const QUERY_STUDIO_TABLES: Readonly<Record<string, AllowedTable>> = Object.freeze({
  blocks: {
    description: 'One row per indexed block: header fields, size, weight, fee totals and pool attribution.',
    columns: [
      'height', 'hash', 'blockTimestamp', 'size', 'weight', 'tx_count', 'difficulty', 'pool_id', 'fees', 'median_fee',
      'reward', 'version', 'bits', 'nonce', 'merkle_root', 'previous_block_hash', 'median_timestamp', 'coinbase_address',
      'avg_tx_size', 'total_inputs', 'total_outputs', 'total_output_amt', 'median_fee_amt', 'segwit_total_txs',
      'segwit_total_size', 'segwit_total_weight', 'utxoset_change', 'utxoset_size', 'total_input_amt',
    ],
  },
  pools: {
    description: 'Mining pool definitions the block attribution uses.',
    columns: ['id', 'name', 'link', 'unique_id'],
  },
  hashrates: {
    description: 'Indexed hashrate samples, network-wide (pool_id NULL) and per pool.',
    columns: ['id', 'hashrate_timestamp', 'avg_hashrate', 'pool_id', 'share', 'type'],
  },
  difficulty_adjustments: {
    description: 'Every difficulty retarget with the height it took effect at.',
    columns: ['time', 'height', 'difficulty', 'adjustment'],
  },
  prices: {
    description: 'Fiat price samples recorded by the owned price updater.',
    columns: ['id', 'time', 'USD', 'EUR', 'GBP', 'CAD', 'CHF', 'AUD', 'JPY'],
  },
  statistics: {
    description: 'Mempool statistics samples: transaction counts, throughput and the fee-band vsize histogram.',
    columns: [
      'id', 'added', 'unconfirmed_transactions', 'tx_per_second', 'vbytes_per_second', 'mempool_byte_weight', 'total_fee',
      'vsize_0', 'vsize_1', 'vsize_2', 'vsize_3', 'vsize_4', 'vsize_5', 'vsize_6', 'vsize_8', 'vsize_10', 'vsize_12',
      'vsize_15', 'vsize_20', 'vsize_30', 'vsize_40', 'vsize_50', 'vsize_60', 'vsize_70', 'vsize_80', 'vsize_90',
      'vsize_100', 'vsize_125', 'vsize_150', 'vsize_175', 'vsize_200', 'vsize_250', 'vsize_300', 'vsize_350',
      'vsize_400', 'vsize_500', 'vsize_600', 'vsize_700', 'vsize_800', 'vsize_900', 'vsize_1000', 'vsize_1200',
      'vsize_1400', 'vsize_1600', 'vsize_1800', 'vsize_2000',
    ],
  },
  blocks_audits: {
    description: 'Block audit summaries: how closely each mined block matched the projected template.',
    columns: ['time', 'hash', 'height', 'match_rate', 'expected_fees', 'expected_weight', 'version'],
  },
});

const AGGREGATES = ['COUNT', 'SUM', 'AVG', 'MIN', 'MAX'] as const;
type Aggregate = (typeof AGGREGATES)[number];

const KEYWORDS = new Set([
  'SELECT', 'DISTINCT', 'FROM', 'WHERE', 'GROUP', 'BY', 'ORDER', 'ASC', 'DESC', 'LIMIT', 'OFFSET', 'AS', 'AND', 'OR',
  'NOT', 'IS', 'NULL', 'IN', 'BETWEEN', 'LIKE', 'TRUE', 'FALSE', ...AGGREGATES,
]);

type Token =
  | { kind: 'keyword'; value: string; at: number }
  | { kind: 'identifier'; value: string; at: number }
  | { kind: 'number'; value: string; at: number }
  | { kind: 'string'; value: string; at: number }
  | { kind: 'symbol'; value: string; at: number }
  | { kind: 'end'; value: ''; at: number };

const SYMBOLS = ['<=', '>=', '<>', '!=', '=', '<', '>', '(', ')', ',', '*', '.'];

function tokenize(sql: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i];
    if (/\s/.test(ch)) { i++; continue; }
    if (tokens.length >= QUERY_GRAMMAR_LIMITS.tokens) {
      throw new QueryGrammarError(`The query has more than ${QUERY_GRAMMAR_LIMITS.tokens} tokens.`, i);
    }
    if (ch === '-' && sql[i + 1] === '-' || ch === '#' || ch === '/' && sql[i + 1] === '*') {
      throw new QueryGrammarError('Comments are not part of the query language.', i);
    }
    if (ch === ';') {
      // Only a single trailing semicolon is tolerated.
      if (sql.slice(i + 1).trim().length > 0) {
        throw new QueryGrammarError('Only one statement is accepted.', i);
      }
      i++;
      continue;
    }
    if (ch === '\'') {
      let j = i + 1;
      let value = '';
      let closed = false;
      while (j < sql.length) {
        if (sql[j] === '\'') {
          if (sql[j + 1] === '\'') { value += '\''; j += 2; continue; }
          closed = true;
          j++;
          break;
        }
        if (sql[j] === '\\') {
          throw new QueryGrammarError('Backslash escapes are not accepted in string literals; double the quote instead.', j);
        }
        value += sql[j];
        j++;
      }
      if (!closed) { throw new QueryGrammarError('Unterminated string literal.', i); }
      if (value.length > QUERY_GRAMMAR_LIMITS.stringLength) {
        throw new QueryGrammarError(`String literals are limited to ${QUERY_GRAMMAR_LIMITS.stringLength} characters.`, i);
      }
      tokens.push({ kind: 'string', value, at: i });
      i = j;
      continue;
    }
    if (ch === '`') {
      const end = sql.indexOf('`', i + 1);
      if (end < 0) { throw new QueryGrammarError('Unterminated quoted identifier.', i); }
      const value = sql.slice(i + 1, end);
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value) || value.length > QUERY_GRAMMAR_LIMITS.identifierLength) {
        throw new QueryGrammarError('Quoted identifiers may only contain letters, digits and underscores.', i);
      }
      tokens.push({ kind: 'identifier', value, at: i });
      i = end + 1;
      continue;
    }
    const number = /^\d+(\.\d+)?/.exec(sql.slice(i));
    if (number) {
      if (/[A-Za-z_]/.test(sql[i + number[0].length] ?? '')) {
        throw new QueryGrammarError('Unexpected character after a number.', i);
      }
      tokens.push({ kind: 'number', value: number[0], at: i });
      i += number[0].length;
      continue;
    }
    const word = /^[A-Za-z_][A-Za-z0-9_]*/.exec(sql.slice(i));
    if (word) {
      if (word[0].length > QUERY_GRAMMAR_LIMITS.identifierLength) {
        throw new QueryGrammarError('Identifier too long.', i);
      }
      const upper = word[0].toUpperCase();
      tokens.push(KEYWORDS.has(upper) ? { kind: 'keyword', value: upper, at: i } : { kind: 'identifier', value: word[0], at: i });
      i += word[0].length;
      continue;
    }
    const symbol = SYMBOLS.find(candidate => sql.startsWith(candidate, i));
    if (symbol) {
      tokens.push({ kind: 'symbol', value: symbol, at: i });
      i += symbol.length;
      continue;
    }
    throw new QueryGrammarError(`Unexpected character ${JSON.stringify(ch)}.`, i);
  }
  tokens.push({ kind: 'end', value: '', at: sql.length });
  return tokens;
}

type Literal = { kind: 'literal'; value: string | number | boolean | null };
type ColumnRef = { kind: 'column'; name: string };
type AggregateCall = { kind: 'aggregate'; fn: Aggregate; column: string | '*' };
type Operand = Literal | ColumnRef | AggregateCall;

type Predicate =
  | { kind: 'compare'; left: Operand; op: string; right: Operand }
  | { kind: 'null'; operand: Operand; negated: boolean }
  | { kind: 'in'; operand: Operand; values: Literal[]; negated: boolean }
  | { kind: 'between'; operand: Operand; low: Literal; high: Literal }
  | { kind: 'like'; operand: Operand; pattern: Literal; negated: boolean }
  | { kind: 'not'; inner: Predicate }
  | { kind: 'and'; parts: Predicate[] }
  | { kind: 'or'; parts: Predicate[] };

export interface ParsedSelect {
  table: string;
  distinct: boolean;
  items: Array<{ expr: ColumnRef | AggregateCall; alias: string | null }> | '*';
  where: Predicate | null;
  groupBy: string[];
  orderBy: Array<{ column: string; direction: 'ASC' | 'DESC' }>;
  limit: number | null;
  offset: number | null;
}

/** A statement the engine can run: placeholders for every literal, quoted identifiers for every name. */
export interface RenderedQuery {
  sql: string;
  params: Array<string | number | boolean | null>;
  table: string;
  columns: string[];
}

class Parser {
  private index = 0;
  private depth = 0;
  private table = '';

  constructor(private readonly tokens: Token[]) {}

  private peek(offset = 0): Token { return this.tokens[Math.min(this.index + offset, this.tokens.length - 1)]; }
  private next(): Token { return this.tokens[this.index++]; }

  private isKeyword(value: string, offset = 0): boolean {
    const token = this.peek(offset);
    return token.kind === 'keyword' && token.value === value;
  }

  private isSymbol(value: string, offset = 0): boolean {
    const token = this.peek(offset);
    return token.kind === 'symbol' && token.value === value;
  }

  private expectKeyword(value: string): void {
    const token = this.next();
    if (token.kind !== 'keyword' || token.value !== value) {
      throw new QueryGrammarError(`Expected ${value}.`, token.at);
    }
  }

  private expectSymbol(value: string): void {
    const token = this.next();
    if (token.kind !== 'symbol' || token.value !== value) {
      throw new QueryGrammarError(`Expected ${JSON.stringify(value)}.`, token.at);
    }
  }

  private identifier(): { value: string; at: number } {
    const token = this.next();
    if (token.kind !== 'identifier') {
      throw new QueryGrammarError('Expected an identifier.', token.at);
    }
    return { value: token.value, at: token.at };
  }

  private column(): ColumnRef {
    const first = this.identifier();
    let name = first.value;
    if (this.isSymbol('.')) {
      // table.column is accepted only for the one table in the query.
      if (first.value !== this.table) {
        throw new QueryGrammarError(`Unknown table qualifier ${first.value}.`, first.at);
      }
      this.next();
      name = this.identifier().value;
    }
    if (!QUERY_STUDIO_TABLES[this.table].columns.includes(name)) {
      throw new QueryGrammarError(`Column ${name} is not readable on ${this.table}.`, first.at);
    }
    return { kind: 'column', name };
  }

  private literal(): Literal {
    const token = this.next();
    if (token.kind === 'string') { return { kind: 'literal', value: token.value }; }
    if (token.kind === 'number') { return { kind: 'literal', value: token.value.includes('.') ? Number(token.value) : safeInteger(token.value, token.at) }; }
    if (token.kind === 'symbol' && token.value === '-' ) { throw new QueryGrammarError('Negative literals are written as 0 - n.', token.at); }
    if (token.kind === 'keyword') {
      if (token.value === 'NULL') { return { kind: 'literal', value: null }; }
      if (token.value === 'TRUE') { return { kind: 'literal', value: true }; }
      if (token.value === 'FALSE') { return { kind: 'literal', value: false }; }
    }
    throw new QueryGrammarError('Expected a literal value.', token.at);
  }

  private aggregate(): AggregateCall {
    const fn = this.next().value as Aggregate;
    this.expectSymbol('(');
    let column: string | '*';
    if (this.isSymbol('*')) {
      if (fn !== 'COUNT') { throw new QueryGrammarError(`${fn}(*) is not accepted; name a column.`, this.peek().at); }
      this.next();
      column = '*';
    } else {
      column = this.column().name;
    }
    this.expectSymbol(')');
    return { kind: 'aggregate', fn, column };
  }

  private operand(): Operand {
    const token = this.peek();
    if (token.kind === 'keyword' && (AGGREGATES as readonly string[]).includes(token.value)) { return this.aggregate(); }
    if (token.kind === 'identifier') { return this.column(); }
    return this.literal();
  }

  private predicateOr(): Predicate {
    if (++this.depth > QUERY_GRAMMAR_LIMITS.predicateDepth) {
      throw new QueryGrammarError('The WHERE clause nests too deeply.', this.peek().at);
    }
    try {
      const parts = [this.predicateAnd()];
      while (this.isKeyword('OR')) { this.next(); parts.push(this.predicateAnd()); }
      return parts.length === 1 ? parts[0] : { kind: 'or', parts };
    } finally {
      this.depth--;
    }
  }

  private predicateAnd(): Predicate {
    const parts = [this.predicateNot()];
    while (this.isKeyword('AND')) { this.next(); parts.push(this.predicateNot()); }
    return parts.length === 1 ? parts[0] : { kind: 'and', parts };
  }

  private predicateNot(): Predicate {
    if (this.isKeyword('NOT')) { this.next(); return { kind: 'not', inner: this.predicateNot() }; }
    if (this.isSymbol('(')) {
      this.next();
      const inner = this.predicateOr();
      this.expectSymbol(')');
      return inner;
    }
    return this.comparison();
  }

  private comparison(): Predicate {
    const left = this.operand();
    const token = this.peek();
    if (token.kind === 'symbol' && ['=', '!=', '<>', '<', '<=', '>', '>='].includes(token.value)) {
      this.next();
      return { kind: 'compare', left, op: token.value === '!=' ? '<>' : token.value, right: this.operand() };
    }
    if (this.isKeyword('IS')) {
      this.next();
      let negated = false;
      if (this.isKeyword('NOT')) { this.next(); negated = true; }
      this.expectKeyword('NULL');
      return { kind: 'null', operand: left, negated };
    }
    let negated = false;
    if (this.isKeyword('NOT')) { this.next(); negated = true; }
    if (this.isKeyword('IN')) {
      this.next();
      this.expectSymbol('(');
      const values: Literal[] = [this.literal()];
      while (this.isSymbol(',')) {
        this.next();
        if (values.length >= QUERY_GRAMMAR_LIMITS.inListValues) {
          throw new QueryGrammarError(`IN lists are limited to ${QUERY_GRAMMAR_LIMITS.inListValues} values.`, this.peek().at);
        }
        values.push(this.literal());
      }
      this.expectSymbol(')');
      return { kind: 'in', operand: left, values, negated };
    }
    if (this.isKeyword('LIKE')) {
      this.next();
      const pattern = this.literal();
      if (typeof pattern.value !== 'string') { throw new QueryGrammarError('LIKE needs a string pattern.', token.at); }
      return { kind: 'like', operand: left, pattern, negated };
    }
    if (this.isKeyword('BETWEEN')) {
      if (negated) { throw new QueryGrammarError('NOT BETWEEN is not accepted; use two comparisons.', token.at); }
      this.next();
      const low = this.literal();
      this.expectKeyword('AND');
      const high = this.literal();
      return { kind: 'between', operand: left, low, high };
    }
    throw new QueryGrammarError('Expected a comparison.', token.at);
  }

  private bound(keyword: 'LIMIT' | 'OFFSET'): number {
    const token = this.next();
    if (token.kind !== 'number' || token.value.includes('.')) {
      throw new QueryGrammarError(`${keyword} needs a non-negative integer.`, token.at);
    }
    return safeInteger(token.value, token.at);
  }

  public statement(): ParsedSelect {
    this.expectKeyword('SELECT');
    let distinct = false;
    if (this.isKeyword('DISTINCT')) { this.next(); distinct = true; }

    // The table is needed before the select list can be checked, so find FROM first.
    let fromIndex = -1;
    for (let i = this.index; i < this.tokens.length; i++) {
      const token = this.tokens[i];
      if (token.kind === 'keyword' && token.value === 'FROM') { fromIndex = i; break; }
    }
    if (fromIndex < 0) { throw new QueryGrammarError('A query needs FROM and one of the readable tables.', this.peek().at); }
    const tableToken = this.tokens[fromIndex + 1];
    if (!tableToken || tableToken.kind !== 'identifier' || !Object.prototype.hasOwnProperty.call(QUERY_STUDIO_TABLES, tableToken.value)) {
      throw new QueryGrammarError(
        `FROM must name one readable table: ${Object.keys(QUERY_STUDIO_TABLES).join(', ')}.`,
        tableToken ? tableToken.at : this.peek().at,
      );
    }
    this.table = tableToken.value;

    let items: ParsedSelect['items'];
    if (this.isSymbol('*')) {
      this.next();
      items = '*';
    } else {
      items = [];
      for (;;) {
        if (items.length >= QUERY_GRAMMAR_LIMITS.selectItems) {
          throw new QueryGrammarError(`Select lists are limited to ${QUERY_GRAMMAR_LIMITS.selectItems} items.`, this.peek().at);
        }
        const expr = this.operand();
        if (expr.kind === 'literal') { throw new QueryGrammarError('Select items must be columns or aggregates.', this.peek(-1).at); }
        let alias: string | null = null;
        if (this.isKeyword('AS')) { this.next(); alias = this.identifier().value; }
        items.push({ expr, alias });
        if (this.isSymbol(',')) { this.next(); continue; }
        break;
      }
    }
    this.expectKeyword('FROM');
    this.next(); // the table, checked above
    if (this.isSymbol('.') || this.isKeyword('AS') || this.peek().kind === 'identifier') {
      throw new QueryGrammarError('Table aliases, joins and schema qualifiers are not accepted.', this.peek().at);
    }

    let where: Predicate | null = null;
    if (this.isKeyword('WHERE')) { this.next(); where = this.predicateOr(); }

    const groupBy: string[] = [];
    if (this.isKeyword('GROUP')) {
      this.next();
      this.expectKeyword('BY');
      groupBy.push(this.column().name);
      while (this.isSymbol(',')) { this.next(); groupBy.push(this.column().name); }
    }

    const orderBy: ParsedSelect['orderBy'] = [];
    if (this.isKeyword('ORDER')) {
      this.next();
      this.expectKeyword('BY');
      for (;;) {
        const column = this.column().name;
        let direction: 'ASC' | 'DESC' = 'ASC';
        if (this.isKeyword('ASC') || this.isKeyword('DESC')) { direction = this.next().value as 'ASC' | 'DESC'; }
        orderBy.push({ column, direction });
        if (this.isSymbol(',')) { this.next(); continue; }
        break;
      }
    }

    let limit: number | null = null;
    let offset: number | null = null;
    if (this.isKeyword('LIMIT')) { this.next(); limit = this.bound('LIMIT'); }
    if (this.isKeyword('OFFSET')) { this.next(); offset = this.bound('OFFSET'); }

    const end = this.next();
    if (end.kind !== 'end') { throw new QueryGrammarError('Unexpected input after the end of the query.', end.at); }

    if (groupBy.length && items !== '*') {
      for (const item of items) {
        if (item.expr.kind === 'column' && !groupBy.includes(item.expr.name)) {
          throw new QueryGrammarError(`Column ${item.expr.name} must be aggregated or listed in GROUP BY.`, 0);
        }
      }
    }
    if (groupBy.length && items === '*') {
      throw new QueryGrammarError('SELECT * cannot be combined with GROUP BY.', 0);
    }
    return { table: this.table, distinct, items, where, groupBy, orderBy, limit, offset };
  }
}

function safeInteger(text: string, at: number): number {
  const value = Number(text);
  if (!Number.isSafeInteger(value)) { throw new QueryGrammarError('Integer literal is outside the safe range.', at); }
  return value;
}

export function parseSelect(sql: string): ParsedSelect {
  if (typeof sql !== 'string' || sql.trim().length === 0) { throw new QueryGrammarError('sql is required.', 0); }
  if (sql.length > QUERY_GRAMMAR_LIMITS.sqlLength) {
    throw new QueryGrammarError(`Queries are limited to ${QUERY_GRAMMAR_LIMITS.sqlLength} characters.`, QUERY_GRAMMAR_LIMITS.sqlLength);
  }
  for (let i = 0; i < sql.length; i++) {
    const code = sql.charCodeAt(i);
    if ((code < 32 && code !== 9 && code !== 10 && code !== 13) || code === 127) { throw new QueryGrammarError('Control characters are not accepted.', i); }
  }
  return new Parser(tokenize(sql)).statement();
}

const quote = (identifier: string): string => '`' + identifier + '`';

/**
 * Renders the tree back to SQL. `maxRows` replaces or caps the caller's LIMIT
 * (one extra row is requested so truncation is detected) and `offset` is the
 * cursor position.
 */
export function renderSelect(parsed: ParsedSelect, maxRows: number, offset: number): RenderedQuery {
  const params: RenderedQuery['params'] = [];
  const operand = (value: Operand): string => {
    if (value.kind === 'column') { return quote(value.name); }
    if (value.kind === 'aggregate') { return `${value.fn}(${value.column === '*' ? '*' : quote(value.column)})`; }
    params.push(value.value);
    return '?';
  };
  const predicate = (node: Predicate): string => {
    switch (node.kind) {
      case 'compare': return `${operand(node.left)} ${node.op} ${operand(node.right)}`;
      case 'null': return `${operand(node.operand)} IS ${node.negated ? 'NOT ' : ''}NULL`;
      case 'in': return `${operand(node.operand)} ${node.negated ? 'NOT ' : ''}IN (${node.values.map(operand).join(', ')})`;
      case 'between': return `${operand(node.operand)} BETWEEN ${operand(node.low)} AND ${operand(node.high)}`;
      case 'like': return `${operand(node.operand)} ${node.negated ? 'NOT ' : ''}LIKE ${operand(node.pattern)}`;
      case 'not': return `NOT (${predicate(node.inner)})`;
      case 'and': return '(' + node.parts.map(predicate).join(' AND ') + ')';
      case 'or': return '(' + node.parts.map(predicate).join(' OR ') + ')';
    }
  };
  const columns: string[] = [];
  let selectList: string;
  if (parsed.items === '*') {
    columns.push(...QUERY_STUDIO_TABLES[parsed.table].columns);
    selectList = columns.map(quote).join(', ');
  } else {
    selectList = parsed.items.map(item => {
      const label = item.alias ?? (item.expr.kind === 'column' ? item.expr.name : `${item.expr.fn.toLowerCase()}_${item.expr.column === '*' ? 'all' : item.expr.column}`);
      columns.push(label);
      return `${operand(item.expr)} AS ${quote(label)}`;
    }).join(', ');
  }
  let sql = `SELECT ${parsed.distinct ? 'DISTINCT ' : ''}${selectList} FROM ${quote(parsed.table)}`;
  if (parsed.where) { sql += ` WHERE ${predicate(parsed.where)}`; }
  if (parsed.groupBy.length) { sql += ` GROUP BY ${parsed.groupBy.map(quote).join(', ')}`; }
  if (parsed.orderBy.length) { sql += ` ORDER BY ${parsed.orderBy.map(entry => `${quote(entry.column)} ${entry.direction}`).join(', ')}`; }
  const effectiveLimit = parsed.limit === null ? maxRows : Math.min(parsed.limit, maxRows);
  sql += ` LIMIT ${effectiveLimit + 1}`;
  const effectiveOffset = (parsed.offset ?? 0) + offset;
  if (effectiveOffset > 0) { sql += ` OFFSET ${effectiveOffset}`; }
  return { sql, params, table: parsed.table, columns };
}
