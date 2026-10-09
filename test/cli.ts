import {test, suite, after} from 'node:test';
import assert from 'node:assert/strict';
import {Buffer} from 'node:buffer';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

/*
The Node.js test runner sets `FORCE_COLOR` when the terminal supports color. Prettier then colors the code frame of an error, which the tests match as plain text.
*/
delete process.env['FORCE_COLOR'];

/*
Each project loads the plugin by name, as in the readme, through a link to this package. That uses `exports` in `package.json` and the built plugin, so `npm test` builds it first.
*/
const packagePath = path.join(import.meta.dirname, '..');
const prettierPath = path.join(import.meta.dirname, '../node_modules/prettier/bin/prettier.cjs');
const fixtures = path.join(import.meta.dirname, 'fixtures');
const directories: string[] = [];

after(() => {
	for (const directory of directories) {
		fs.rmSync(directory, {recursive: true, force: true});
	}
});

function createProject(files: Record<string, string | Uint8Array>): string {
	const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'prettier-plugin-soml-'));
	directories.push(directory);
	fs.mkdirSync(path.join(directory, 'node_modules'));
	fs.symlinkSync(packagePath, path.join(directory, 'node_modules/prettier-plugin-soml'), 'junction');
	fs.writeFileSync(path.join(directory, '.prettierrc'), JSON.stringify({plugins: ['prettier-plugin-soml']}));

	for (const [name, content] of Object.entries(files)) {
		fs.writeFileSync(path.join(directory, name), content);
	}

	return directory;
}

function runPrettier(directory: string, arguments_: string[]) {
	return spawnSync(process.execPath, [prettierPath, ...arguments_], {cwd: directory, encoding: 'utf8'});
}

suite('cli', () => {
	test('.editorconfig cannot make the output use CRLF or spaces, and other files in the same run still follow it', () => {
		const directory = createProject({
			'.editorconfig': 'root = true\n\n[*]\nend_of_line = crlf\nindent_style = space\nindent_size = 4\n',
			'config.soml': 'a: {b: 1\r\n}\r\n',
			'readme.md': '# Title\n\nText\n',
		});

		const write = runPrettier(directory, ['--write', 'config.soml', 'readme.md']);
		assert.equal(write.status, 0, write.stderr);
		assert.equal(fs.readFileSync(path.join(directory, 'config.soml'), 'utf8'), 'a: {\n\tb: 1\n}\n');
		assert.equal(fs.readFileSync(path.join(directory, 'readme.md'), 'utf8'), '# Title\r\n\r\nText\r\n');

		const check = runPrettier(directory, ['--check', 'config.soml']);
		assert.equal(check.status, 0, check.stdout + check.stderr);
	});

	test('an invalid file exits with 2 and shows one code frame', () => {
		const directory = createProject({'bad.soml': 'a: 1\nb: [1 2]\n'});
		const result = runPrettier(directory, ['bad.soml']);
		assert.equal(result.status, 2);
		assert.match(result.stderr, /bad\.soml: SyntaxError: Expected “,”, a line break, or “\]” after an array item, but found “2” \(2:7\)/v);
		assert.equal(result.stderr.split('> 2 |').length - 1, 1, result.stderr);
	});

	// A limitation in the readme: Prettier replaces invalid UTF-8 when it reads the file, before the plugin sees the text.
	test('invalid UTF-8 is replaced with U+FFFD and not reported', () => {
		const directory = createProject({'config.soml': Buffer.from('a: \'\u{FF}\'\n', 'latin1')});
		const result = runPrettier(directory, ['--write', 'config.soml']);
		assert.equal(result.status, 0, result.stderr);
		assert.equal(fs.readFileSync(path.join(directory, 'config.soml'), 'utf8'), 'a: \'\u{FFFD}\'\n');
	});

	test('--debug-check passes for every fixture', () => {
		const names = fs.readdirSync(fixtures).filter(file => file.endsWith('.soml'));
		const directory = createProject(Object.fromEntries(names.map(name => [name, fs.readFileSync(path.join(fixtures, name), 'utf8')])));
		const result = runPrettier(directory, ['--debug-check', ...names]);
		assert.equal(result.status, 0, result.stdout + result.stderr);
	});
});
