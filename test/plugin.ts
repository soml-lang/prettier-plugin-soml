import {test, suite} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import * as prettier from 'prettier';
import {format, ParseError} from 'soml-lang';
import * as plugin from '../source/index.ts';

/*
The Node.js test runner sets `FORCE_COLOR` when the terminal supports color. Prettier then colors the code frame of an error, which the tests match as plain text.
*/
delete process.env['FORCE_COLOR'];

const fixtures = path.join(import.meta.dirname, 'fixtures');
const fixtureNames = fs.readdirSync(fixtures).filter(file => file.endsWith('.soml')).toSorted();

const formatSoml = async (text: string, options: prettier.Options = {}): Promise<string> => prettier.format(text, {parser: 'soml', plugins: [plugin], ...options});

suite('fixtures', () => {
	for (const name of fixtureNames) {
		test(name, async () => {
			const input = fs.readFileSync(path.join(fixtures, name), 'utf8');
			const expected = fs.readFileSync(path.join(fixtures, name.replace(/\.soml$/v, '.formatted')), 'utf8');
			const output = await formatSoml(input);
			assert.equal(output, expected);
			assert.equal(output, format(input));
			assert.equal(await formatSoml(output), output);
		});
	}
});

suite('commas', () => {
	test('commas in a multi-line object and array are removed', async () => {
		assert.equal(await formatSoml('a: {\n\tb: 1,\n\tc: [\n\t\t2,\n\t\t3,\n\t],\n}\n'), 'a: {\n\tb: 1\n\tc: [\n\t\t2\n\t\t3\n\t]\n}\n');
	});

	test('a multi-line object and array without commas stay the same', async () => {
		const input = 'a: {\n\tb: 1\n\tc: [\n\t\t2\n\t\t3\n\t]\n}\n';
		assert.equal(await formatSoml(input), input);
	});
});

suite('options', () => {
	const input = 'a: {b: [\'first\', \'second\'],\nc: \'a long string that goes past a short print width\'}\n';
	const expected = format(input);

	test('layout options are ignored', async () => {
		assert.equal(await formatSoml(input, {useTabs: false, tabWidth: 4, printWidth: 20}), expected);
		assert.equal(await formatSoml(input, {
			bracketSpacing: false, trailingComma: 'none', singleQuote: true, quoteProps: 'consistent',
		}), expected);
	});

	test('the output uses LF whatever endOfLine says', async () => {
		assert.equal(await formatSoml(input, {endOfLine: 'crlf'}), expected);
		assert.equal(await formatSoml(input, {endOfLine: 'cr'}), expected);
		assert.equal(await formatSoml(input.replaceAll('\n', '\r\n'), {endOfLine: 'auto'}), expected);
	});
});

suite('errors', () => {
	type PrettierError = SyntaxError & {loc: {start: {line: number; column: number}}};

	async function formatError(text: string): Promise<PrettierError> {
		try {
			await formatSoml(text);
		} catch (error) {
			return error as PrettierError;
		}

		throw new Error('Expected an error');
	}

	test('an invalid document throws a SyntaxError with the reason and a location', async () => {
		const error = await formatError('a: 1\nb: [1 2]\n');
		assert.equal(error.name, 'SyntaxError');
		assert.ok(error.message.startsWith('Expected “,”, a line break, or “]” after an array item, but found “2” (2:7)'), error.message);
		assert.deepEqual(error.loc, {start: {line: 2, column: 7}});
		assert.ok(error.cause instanceof ParseError);
	});

	test('a comma at the start of a line is an error', async () => {
		const error = await formatError('a: [\n  1\n  , 2\n]\n');
		assert.ok(error.message.startsWith('A comma must be on the same line as the item before it. The line break already separates the items, so remove the comma (3:3)'), error.message);
		assert.deepEqual(error.loc, {start: {line: 3, column: 3}});
	});

	test('a `.` after a key is an error at the `.`', async () => {
		const error = await formatError('a: 1\nexample.com: 1\n');
		assert.ok(error.message.startsWith('A bare key cannot contain “.”. Quote it, as in \'example.com\', or use braces to nest, as in example: {com: …} (2:8)'), error.message);
		assert.deepEqual(error.loc, {start: {line: 2, column: 8}});
	});

	test('the column counts UTF-16 code units', async () => {
		const error = await formatError('a: \'😀\' x\n');
		assert.deepEqual(error.loc, {start: {line: 1, column: 9}});
		assert.match(error.message, /\n> 1 \| a: '😀' x\n {4}\| {9}\^/v);
	});

	for (const [name, separator] of [['line separator', '\u{2028}'], ['paragraph separator', '\u{2029}']]) {
		test(`a ${name} in a string or a comment ends a line, as in the code frame`, async () => {
			const error = await formatError(`a: 'x${separator}y' # z${separator}w\nb: [1 2]\n`);
			assert.deepEqual(error.loc, {start: {line: 4, column: 7}});
			assert.ok(error.message.startsWith('Expected “,”, a line break, or “]” after an array item, but found “2” (4:7)'), error.message);
			assert.match(error.message, /\n> 4 \| b: \[1 2\]\n/v);
		});
	}

	test('a line separator between tokens is the error, at the end of its line', async () => {
		const error = await formatError('a: \'x\u{2028}y\'\u{2028}b: 2\n');
		assert.deepEqual(error.loc, {start: {line: 2, column: 3}});
		assert.match(error.message, /\n> 2 \| y'\n {4}\| {3}\^/v);
	});

	test('an error at the start of the document', async () => {
		const error = await formatError(']');
		assert.deepEqual(error.loc, {start: {line: 1, column: 1}});
	});

	test('an error at the end of the document, also after its last line feed', async () => {
		const error = await formatError('a: 1\nb:');
		assert.deepEqual(error.loc, {start: {line: 2, column: 3}});
		const errorAfterLineFeed = await formatError('a: 1\nb:\n');
		assert.deepEqual(errorAfterLineFeed.loc, {start: {line: 3, column: 1}});
	});
});

suite('pragmas', () => {
	test('requirePragma skips a file without the pragma, and formats a file with it', async () => {
		assert.equal(await formatSoml('a:   1', {requirePragma: true}), 'a:   1');
		assert.equal(await formatSoml('# @format\n\na:   1', {requirePragma: true}), '# @format\n\na: 1\n');
		assert.equal(await formatSoml('\n# @prettier\na:   1', {requirePragma: true}), '# @prettier\na: 1\n');
	});

	test('a pragma after another comment does not count', async () => {
		assert.equal(await formatSoml('# Config\n# @format\na:   1', {requirePragma: true}), '# Config\n# @format\na:   1');
		assert.equal(await formatSoml('# Config\n# @noformat\na:   1', {checkIgnorePragma: true}), '# Config\n# @noformat\na: 1\n');
	});

	test('a pragma must be alone on its line', async () => {
		assert.equal(await formatSoml('# @format x\na:   1', {requirePragma: true}), '# @format x\na:   1');
		assert.equal(await formatSoml('# @formatting\na:   1', {requirePragma: true}), '# @formatting\na:   1');
		assert.equal(await formatSoml('# @noformat x\na:   1', {checkIgnorePragma: true}), '# @noformat x\na: 1\n');
	});

	test('insertPragma adds the pragma once', async () => {
		const output = await formatSoml('a:   1', {insertPragma: true});
		assert.equal(output, '# @format\n\na: 1\n');
		assert.equal(await formatSoml(output, {insertPragma: true}), output);
	});

	test('checkIgnorePragma leaves a file with @noformat unchanged', async () => {
		assert.equal(await formatSoml('# @noformat\na:   1', {checkIgnorePragma: true}), '# @noformat\na:   1');
		assert.equal(await formatSoml('# @noprettier\na:   1', {checkIgnorePragma: true}), '# @noprettier\na:   1');
		assert.equal(await formatSoml('\n\n# @noformat\na:   1', {checkIgnorePragma: true}), '\n\n# @noformat\na:   1');
		assert.equal(await formatSoml('# @noformat\na:   1'), '# @noformat\na: 1\n');
	});
});

suite('markdown', () => {
	const formatMarkdown = async (text: string, options: prettier.Options = {}): Promise<string> => prettier.format(text, {parser: 'markdown', plugins: [plugin], ...options});

	test('a soml code block is formatted', async () => {
		assert.equal(await formatMarkdown('# Config\n\n```soml\na:   {b: 1\n}\n```\n'), '# Config\n\n```soml\na: {\n\tb: 1\n}\n```\n');
	});

	test('a soml code block inside a list item is formatted and indented', async () => {
		const input = '- Item\n\n  ```soml\n  a: {b: \'\'\'\n    x\n    \'\'\'}\n  ```\n';
		const expected = '- Item\n\n  ```soml\n  a: {\n  \tb:\n  \t\t\'\'\'\n  \t\tx\n  \t\t\'\'\'\n  }\n  ```\n';
		assert.equal(await formatMarkdown(input), expected);
	});

	test('a blank line in an indented code block gets no trailing whitespace, while trailing spaces in a block string are kept', async () => {
		assert.equal(await formatMarkdown('- Item\n\n  ```soml\n  a: 1\n\n  b: \'\'\'\n    x  \n    \'\'\'\n  ```\n'), '- Item\n\n  ```soml\n  a: 1\n\n  b:\n  \t\'\'\'\n  \tx  \n  \t\'\'\'\n  ```\n');
		assert.equal(await formatMarkdown('> ```soml\n> a: 1\n>\n> b: 2\n> ```\n'), '> ```soml\n> a: 1\n>\n> b: 2\n> ```\n');
	});

	test('an invalid code block is left unchanged', async () => {
		const input = '```soml\na: [1 2]\n```\n';
		assert.equal(await formatMarkdown(input), input);
	});

	test('a CRLF Markdown file keeps CRLF, also in a soml code block', async () => {
		assert.equal(await formatMarkdown('# Config\r\n\r\n```soml\r\na: {b: 1\r\n}\r\n```\r\n', {endOfLine: 'auto'}), '# Config\r\n\r\n```soml\r\na: {\r\n\tb: 1\r\n}\r\n```\r\n');
	});
});

suite('vue', () => {
	test('a lang="soml" block is formatted', async () => {
		const output = await prettier.format('<docs lang="soml">\na:   {b: 1\n}\n</docs>\n', {parser: 'vue', plugins: [plugin]});
		assert.equal(output, '<docs lang="soml">\na: {\n\tb: 1\n}\n</docs>\n');
	});
});

/*
What the readme says under "Limitations", so that it stays true.
*/
suite('limitations', () => {
	test('a BOM is kept', async () => {
		assert.equal(await formatSoml('\u{FEFF}a:   1\n'), '\u{FEFF}a: 1\n');
	});

	test('a carriage return becomes LF, also inside a block string', async () => {
		assert.equal(await formatSoml('a: \'\'\'\r\n  x\r\n  \'\'\'\r\n'), 'a:\n\t\'\'\'\n\tx\n\t\'\'\'\n');
	});

	test('a file with only whitespace becomes empty', async () => {
		assert.equal(await formatSoml(''), '');
		assert.equal(await formatSoml(' \n\t\n'), '');
		assert.equal(await formatSoml('\u{A0}\u{2028}\n'), '');
	});

	test('with insertPragma, an empty file is reported, because a pragma alone is not a document', async () => {
		await assert.rejects(formatSoml('', {insertPragma: true}), {name: 'SyntaxError', message: /^A document must contain an object or an array/v});
	});

	test('the code frame of an error shows control characters as they are', async () => {
		await assert.rejects(formatSoml('a: 1 # \u{1B}[2J\n'), (error: Error) => error.message.includes('\n> 1 | a: 1 # \u{1B}[2J\n'));
	});

	test('range formatting only changes CRLF to LF', async () => {
		assert.equal(await formatSoml('a:   1\nb:   2\n', {rangeStart: 0, rangeEnd: 5}), 'a:   1\nb:   2\n');
		assert.equal(await formatSoml('a:   1\r\nb:   2\r\n', {rangeStart: 0, rangeEnd: 5, endOfLine: 'auto'}), 'a:   1\nb:   2\n');
	});
});

suite('detection', () => {
	test('a .soml file uses the soml parser', async () => {
		const {inferredParser} = await prettier.getFileInfo('config.soml', {plugins: [plugin]});
		assert.equal(inferredParser, 'soml');
	});

	test('the language is listed', async () => {
		const {languages} = await prettier.getSupportInfo({plugins: [plugin]});
		const language = languages.find(language => language.name === 'SOML');
		assert.deepEqual(language?.extensions, ['.soml']);
		// The Prettier extension for VS Code formats the languages with these IDs.
		assert.deepEqual(language?.vscodeLanguageIds, ['soml']);
	});
});

suite('cursor', () => {
	/*
	Prettier maps the cursor with a text diff of the part that holds it, so a cursor before a token that gets whitespace in front of it goes to the start of that whitespace.
	*/
	suite('the cursor stays at its token, or in the whitespace just before it', () => {
		const input = 'a:   1\nb: {x:1, y: [2,3\n]}\n';
		const output = 'a: 1\nb: {\n\tx: 1\n\ty: [\n\t\t2\n\t\t3\n\t]\n}\n';

		for (const token of ['a', '1', 'b', '{', 'x', 'y', '[', '2', '3', ']', '}']) {
			test(`a cursor at “${token}”`, async () => {
				const result = await prettier.formatWithCursor(input, {parser: 'soml', plugins: [plugin], cursorOffset: input.indexOf(token)});
				assert.equal(result.formatted, output);
				const tokenOffset = output.indexOf(token);
				assert.ok(result.cursorOffset <= tokenOffset);
				assert.equal(output.slice(result.cursorOffset, tokenOffset).trim(), '');
			});
		}
	});

	suite('a cursor in whitespace that is removed at the start or the end of the document', () => {
		const input = '\n\na:   1\n\n\n';
		const output = 'a: 1\n';

		for (const [cursorOffset, expected] of [[0, 0], [1, 0], [2, 0], [input.length - 1, output.length], [input.length, output.length]] as const) {
			test(`a cursor at offset ${cursorOffset}`, async () => {
				const result = await prettier.formatWithCursor(input, {parser: 'soml', plugins: [plugin], cursorOffset});
				assert.equal(result.formatted, output);
				assert.equal(result.cursorOffset, expected);
			});
		}
	});

	test('a document with many changes maps the cursor quickly', async () => {
		const input = Array.from({length: 500}, (_, index) => `k${index}: {x:1, y:[1,2,3]}`).join('\n') + '\n';
		const start = performance.now();
		const result = await prettier.formatWithCursor(input, {parser: 'soml', plugins: [plugin], cursorOffset: input.indexOf('y')});
		const duration = performance.now() - start;
		assert.equal(result.formatted, format(input));
		const tokenOffset = result.formatted.indexOf('y');
		assert.ok(result.cursorOffset <= tokenOffset);
		assert.equal(result.formatted.slice(result.cursorOffset, tokenOffset).trim(), '');
		assert.ok(duration < 1000, `${Math.round(duration)} ms`);
	});
});
