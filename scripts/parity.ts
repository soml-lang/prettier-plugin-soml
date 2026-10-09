/*
Formats the conformance corpus of soml-lang through Prettier, and checks that:

- Each valid document gives exactly what `format()` gives, and formatting that again changes nothing.
- Each invalid document is refused, unless the readme lists the reason under limitations: a BOM or a carriage return, which Prettier removes before the parser sees the text, invalid UTF-8, which Prettier replaces with U+FFFD when it reads the file, or an empty document, which Prettier does not give to the parser.

The corpus is in the spec repository, so this runs against a local checkout of it: `npm run parity [path to soml]`.
*/
/* eslint-disable no-await-in-loop -- One document at a time keeps the output in order. */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import * as prettier from 'prettier';
import {format, ParseError} from 'soml-lang';
import * as plugin from '../source/index.ts';

const root = path.resolve(process.argv[2] ?? path.join(import.meta.dirname, '../../soml'), 'conformance');
const failures: string[] = [];
let validCount = 0;
let invalidCount = 0;
let acceptedByLimitation = 0;

function listFiles(directory: string): string[] {
	return fs.readdirSync(path.join(root, directory), {recursive: true, encoding: 'utf8'})
		.filter(file => file.endsWith('.soml'))
		.toSorted()
		.map(file => path.join(directory, file));
}

async function formatWithPrettier(text: string): Promise<string> {
	return prettier.format(text, {parser: 'soml', plugins: [plugin]});
}

/*
Whether a limitation in the readme explains why Prettier accepts an invalid document: the text that Prettier gives the parser, without a BOM, with LF for every carriage return, and with invalid UTF-8 already replaced when the file was read, is blank or valid. A document that is also invalid for another reason is not excused.
*/
function isKnownLimitation(text: string): boolean {
	const parserText = text.replace(/^\u{FEFF}/v, '').replaceAll(/\r\n?/gv, '\n');

	if (parserText.trim() === '') {
		return true;
	}

	try {
		format(parserText);
		return true;
	} catch {
		return false;
	}
}

for (const file of listFiles('valid')) {
	const text = fs.readFileSync(path.join(root, file), 'utf8');
	validCount++;

	try {
		const output = await formatWithPrettier(text);

		if (output !== format(text)) {
			failures.push(`${file}: the output is not the same as format()`);
		} else if (await formatWithPrettier(output) !== output) {
			failures.push(`${file}: formatting again changed the output`);
		}
	} catch (error) {
		failures.push(`${file}: ${(error as Error).message.split('\n', 1)[0]!}`);
	}
}

for (const file of listFiles('invalid')) {
	// The bytes as Prettier reads them, which replaces invalid UTF-8.
	const text = fs.readFileSync(path.join(root, file), 'utf8');
	invalidCount++;

	try {
		await formatWithPrettier(text);

		if (isKnownLimitation(text)) {
			acceptedByLimitation++;
		} else {
			failures.push(`${file}: an invalid document was accepted`);
		}
	} catch (error) {
		if (!(error instanceof SyntaxError && error.cause instanceof ParseError)) {
			failures.push(`${file}: ${(error as Error).message.split('\n', 1)[0]!}`);
		}
	}
}

console.log(`${validCount} valid documents, ${invalidCount} invalid documents, ${acceptedByLimitation} invalid documents accepted because of a known limitation`);

if (failures.length > 0) {
	console.error(failures.join('\n'));
	process.exitCode = 1;
}
