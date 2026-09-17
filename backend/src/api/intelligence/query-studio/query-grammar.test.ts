import { parseSelect, QUERY_GRAMMAR_LIMITS, QueryGrammarError, renderSelect } from './query-grammar';

const render = (sql: string, maxRows = 100, offset = 0) => renderSelect(parseSelect(sql), maxRows, offset);

describe('Query Studio grammar', () => {
  it('renders a bounded SELECT with quoted identifiers and parameterised literals', () => {
    const rendered = render('SELECT height, hash, fees FROM blocks WHERE height > 800000 AND pool_id IN (1, 2) ORDER BY height DESC LIMIT 5');
    expect(rendered.sql).toBe('SELECT `height` AS `height`, `hash` AS `hash`, `fees` AS `fees` FROM `blocks` WHERE (`height` > ? AND `pool_id` IN (?, ?)) ORDER BY `height` DESC LIMIT 6');
    expect(rendered.params).toEqual([800000, 1, 2]);
    expect(rendered.columns).toEqual(['height', 'hash', 'fees']);
  });

  it('caps the LIMIT at the row budget, applies the cursor offset and expands *', () => {
    const rendered = render('SELECT * FROM pools LIMIT 5000', 100, 300);
    expect(rendered.sql).toBe('SELECT `id`, `name`, `link`, `unique_id` FROM `pools` LIMIT 101 OFFSET 300');
    expect(render('SELECT id FROM pools OFFSET 10', 10, 5).sql).toContain('LIMIT 11 OFFSET 15');
  });

  it('accepts aggregates with GROUP BY and rejects an unaggregated column', () => {
    const rendered = render('SELECT pool_id, COUNT(*) AS mined, SUM(fees) FROM blocks GROUP BY pool_id ORDER BY pool_id');
    expect(rendered.sql).toBe('SELECT `pool_id` AS `pool_id`, COUNT(*) AS `mined`, SUM(`fees`) AS `sum_fees` FROM `blocks` GROUP BY `pool_id` ORDER BY `pool_id` ASC LIMIT 101');
    expect(() => parseSelect('SELECT height, COUNT(*) FROM blocks GROUP BY pool_id')).toThrow(/must be aggregated/);
  });

  it('treats keywords inside string literals as data', () => {
    const rendered = render("SELECT name FROM pools WHERE name = 'DROP TABLE blocks; -- ''quoted'' /* comment */'");
    expect(rendered.sql).toBe('SELECT `name` AS `name` FROM `pools` WHERE `name` = ? LIMIT 101');
    expect(rendered.params).toEqual(["DROP TABLE blocks; -- 'quoted' /* comment */"]);
  });

  it.each([
    ['DROP TABLE blocks', /Expected SELECT/],
    ['DELETE FROM blocks WHERE 1=1', /Expected SELECT/],
    ['UPDATE blocks SET fees = 0', /Expected SELECT/],
    ['INSERT INTO pools (name) VALUES (\'x\')', /Expected SELECT/],
    ['SELECT * FROM blocks; DROP TABLE blocks', /Only one statement/],
    ['SELECT * FROM blocks -- comment', /Comments/],
    ['SELECT /* hint */ * FROM blocks', /Comments/],
    ['SELECT * FROM blocks # comment', /Comments/],
    ['SELECT * FROM intelligence_api_keys', /FROM must name one readable table/],
    ['SELECT key_hash FROM blocks', /not readable/],
    ['SELECT coinbase_raw FROM blocks', /not readable/],
    ['SELECT b.height FROM blocks b', /Unknown table qualifier/],
    ['SELECT height FROM blocks JOIN pools ON pools.id = blocks.pool_id', /aliases, joins/],
    ['SELECT height FROM blocks WHERE pool_id IN (SELECT id FROM pools)', /Expected a literal/],
    ['SELECT SLEEP(10) FROM blocks', /not readable/],
    ['SELECT LOAD_FILE(\'/etc/passwd\') FROM blocks', /not readable/],
    ['SELECT height FROM blocks WHERE hash = @@version', /Unexpected character/],
    ['SELECT height FROM blocks INTO OUTFILE \'/tmp/x\'', /aliases, joins/],
    ['SELECT height FROM blocks UNION SELECT id FROM pools', /aliases, joins/],
    ['SELECT height FROM blocks WHERE hash = \'unterminated', /Unterminated string/],
    ['SELECT height FROM blocks WHERE hash = \'a\\\'b\'', /Backslash/],
    ['SELECT height FROM blocks LIMIT -1', /Unexpected character/],
    ['SELECT height FROM blocks LIMIT 1.5', /LIMIT needs/],
    ['SELECT height FROM blocks WHERE height = 99999999999999999999', /safe range/],
    ['', /sql is required/],
    ['SELECT height FROM blocks WHERE hash = \'x\u0000\'', /Control characters/],
  ])('rejects %s', (sql, expected) => {
    expect(() => parseSelect(sql)).toThrow(expected);
    expect(() => parseSelect(sql)).toThrow(QueryGrammarError);
  });

  it('bounds the size of a query', () => {
    expect(() => parseSelect('SELECT height FROM blocks WHERE ' + 'height = 1 OR '.repeat(600) + 'height = 2')).toThrow(/limited to 4096 characters/);
    const many = 'SELECT height FROM blocks WHERE pool_id IN (' + Array.from({ length: QUERY_GRAMMAR_LIMITS.inListValues + 1 }, (_, i) => i).join(',') + ')';
    expect(() => parseSelect(many)).toThrow(/IN lists are limited/);
    expect(() => parseSelect("SELECT height FROM blocks WHERE hash = '" + 'x'.repeat(QUERY_GRAMMAR_LIMITS.stringLength + 1) + "'")).toThrow(/String literals are limited/);
    expect(() => parseSelect('SELECT height FROM blocks WHERE ' + '('.repeat(9) + 'height = 1' + ')'.repeat(9))).toThrow(/nests too deeply/);
  });

  it('reports the position of the offending token', () => {
    try {
      parseSelect('SELECT height FROM blocks WHERE hash = \'a\'; DELETE FROM blocks');
      throw new Error('accepted');
    } catch (e) {
      expect(e).toBeInstanceOf(QueryGrammarError);
      expect((e as QueryGrammarError).position).toBe(42);
    }
  });

  it('accepts NULL tests, BETWEEN, LIKE, NOT and a trailing semicolon', () => {
    const rendered = render("SELECT DISTINCT pool_id FROM blocks WHERE NOT (pool_id IS NULL) AND height BETWEEN 1 AND 10 AND hash NOT LIKE '00%' AND `hash` <> 'x';");
    expect(rendered.sql).toBe('SELECT DISTINCT `pool_id` AS `pool_id` FROM `blocks` WHERE (NOT (`pool_id` IS NULL) AND `height` BETWEEN ? AND ? AND `hash` NOT LIKE ? AND `hash` <> ?) LIMIT 101');
    expect(rendered.params).toEqual([1, 10, '00%', 'x']);
  });
});
