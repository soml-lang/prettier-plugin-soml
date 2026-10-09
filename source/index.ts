import {
	doc,
	type Doc,
	type Parser,
	type Printer,
	type SupportLanguage,
} from 'prettier';
import {formatEdits, ParseError} from 'soml-lang';

const {literalline, trim} = doc.builders;

/**
A change that the formatter makes, if any, and the text after it that stays the same. `start` and `end` are its range in the input, and `text` is the formatted text.
*/
type PartNode = {
	readonly type: 'Part';
	readonly start: number;
	readonly end: number;
	readonly text: string;
};

/**
The root. Its parts hold the formatted document, so the document is parsed once.
*/
type DocumentNode = {
	readonly type: 'Document';
	readonly start: number;
	readonly end: number;
	readonly children: PartNode[];
};

type Node = DocumentNode | PartNode;

/*
The same pragmas as Prettier's YAML, because SOML also uses `#` comments: alone on the first line that is not blank.
*/
const PRAGMA = /^\s*#[^\S\n]*@(?:format|prettier)\s*?(?:\n|$)/v;
const IGNORE_PRAGMA = /^\s*#[^\S\n]*@(?:noformat|noprettier)\s*?(?:\n|$)/v;

/*
A `ParseError` as the error Prettier expects from a parser, so that Prettier shows its own code frame. The line and column come from the offset, in the terms of that code frame: a line also ends at U+2028 and U+2029, which SOML allows in strings and comments, and the column counts UTF-16 code units, while `ParseError` counts code points.
*/
function toPrettierError(error: ParseError, text: string): SyntaxError {
	const lines = text.slice(0, error.offset).split(/[\n\u{2028}\u{2029}]/v);
	const line = lines.length;
	const column = lines.at(-1)!.length + 1;
	const prettierError = new SyntaxError(`${error.reason} (${line}:${column})`, {cause: error});
	return Object.assign(prettierError, {loc: {start: {line, column}}});
}

/*
Splits the document at each change that the formatter makes. Prettier then maps the cursor with a text diff of only the part that holds it. With the whole document as one node, it diffs the whole document, which takes seconds on a document of a few hundred lines. A part is never empty, so there is no part before a change at the start of the document, and a change at the end that only removes text is part of the part before it.
*/
function parseParts(text: string): PartNode[] {
	const parts: PartNode[] = [];
	let start = 0;
	let partText = '';
	let index = 0;

	for (const {range, text: replacement} of formatEdits(text)) {
		const [editStart, editEnd] = range;
		partText += text.slice(index, editStart);

		if (partText !== '' && (replacement !== '' || editEnd < text.length)) {
			parts.push({
				type: 'Part', start, end: editStart, text: partText,
			});
			start = editStart;
			partText = '';
		}

		partText += replacement;
		index = editEnd;
	}

	parts.push({
		type: 'Part', start, end: text.length, text: partText + text.slice(index),
	});
	return parts;
}

/**
The SOML language, for `.soml` files, `soml` code blocks in Markdown, and `lang="soml"` blocks in Vue.

Usually Prettier loads the plugin by name from the `plugins` config. To use it with the API, pass the module:

@example
```
import * as prettier from 'prettier';
import * as somlPlugin from 'prettier-plugin-soml';

await prettier.format('a: {b: 1,\nc: 2}', {parser: 'soml', plugins: [somlPlugin]});
//=> 'a: {\n\tb: 1\n\tc: 2\n}\n'
```
*/
export const languages: SupportLanguage[] = [
	{
		name: 'SOML',
		parsers: ['soml'],
		extensions: ['.soml'],
		vscodeLanguageIds: ['soml'],
	},
];

/**
The `soml` parser, which formats the document with `formatEdits()` from `soml-lang`.

Usually Prettier loads the plugin by name from the `plugins` config. To use it with the API, pass the module:

@example
```
import * as prettier from 'prettier';
import * as somlPlugin from 'prettier-plugin-soml';

await prettier.format('a: {b: 1,\nc: 2}', {parser: 'soml', plugins: [somlPlugin]});
//=> 'a: {\n\tb: 1\n\tc: 2\n}\n'
```
*/
export const parsers: {soml: Parser<Node>} = {
	soml: {
		parse(text, options) {
			/*
			A carriage return is never valid SOML, so the output always uses LF, whatever `endOfLine` and `.editorconfig` say. This works because Prettier gives the parser and the printer the same options object, which is observed and not documented, so a test checks it. An embedded document, such as a code block in Markdown, gets its own copy of the options, so it keeps the line endings of the file around it.
			*/
			options.endOfLine = 'lf';

			try {
				return {
					type: 'Document', start: 0, end: text.length, children: parseParts(text),
				};
			} catch (error) {
				throw error instanceof ParseError ? toPrettierError(error, text) : error;
			}
		},
		astFormat: 'soml',
		locStart: node => node.start,
		locEnd: node => node.end,
		hasPragma: text => PRAGMA.test(text),
		hasIgnorePragma: text => IGNORE_PRAGMA.test(text),
	},
};

/**
The `soml` printer, which prints the document that the parser formatted.

Usually Prettier loads the plugin by name from the `plugins` config. To use it with the API, pass the module:

@example
```
import * as prettier from 'prettier';
import * as somlPlugin from 'prettier-plugin-soml';

await prettier.format('a: {b: 1,\nc: 2}', {parser: 'soml', plugins: [somlPlugin]});
//=> 'a: {\n\tb: 1\n\tc: 2\n}\n'
```
*/
export const printers: {soml: Printer<Node>} = {
	soml: {
		/*
		Line by line, because an embedded document, such as a code block in a Markdown list item, is indented after each line break. A `trim` before the line break that ends an empty line removes that indentation from it. Trailing whitespace on a line with content is kept, because only a block string has it, and there it is content. The document ends with a `literalline`, so that Prettier can remove it from an embedded document.
		*/
		print(path, _options, print) {
			const {node} = path;

			if (node.type === 'Document') {
				return path.map(print, 'children');
			}

			const isLineStart = path.isFirst || (path.previous as PartNode).text.endsWith('\n');
			const lines = node.text.split('\n');
			const parts: Doc[] = [];

			for (const [index, line] of lines.entries()) {
				if (index > 0) {
					const isLineEmpty = lines[index - 1] === '' && (index > 1 || isLineStart);
					parts.push(isLineEmpty ? [trim, literalline] : literalline);
				}

				if (line !== '') {
					parts.push(line);
				}
			}

			return parts;
		},
		// The parts are the child nodes, so Prettier maps the cursor with a text diff of only the part that holds it.
		getVisitorKeys: node => node.type === 'Document' ? ['children'] : [],
		// For `--debug-check`, which then compares the formatted text of the input and of the output, however the parts split it.
		massageAstNode(original: Node, cloned: unknown) {
			return original.type === 'Document' ? {formatted: original.children.map(part => part.text).join('')} : cloned;
		},
		insertPragma: text => `# @format\n\n${text}`,
	},
};
