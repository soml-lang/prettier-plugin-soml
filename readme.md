# prettier-plugin-soml

> [Prettier](https://prettier.io) plugin for [SOML](https://soml.sh), a config format for humans

> [!NOTE]
> The format is a draft. See the [specification](https://soml.sh).

It formats by the formatting rules of the specification.

```soml
# Before
server: {host: 'localhost',
  port: 8080} # Local only
limits: [2,   16,]
```

```soml
# After
server: {
	host: 'localhost'
	port: 8080
} # Local only
limits: [2, 16]
```

## Install

```sh
npm install --save-dev prettier prettier-plugin-soml
```

Requires Node.js 22 or later and Prettier 3.6 or later.

## Usage

Add the plugin to your [Prettier config](https://prettier.io/docs/configuration), for example `.prettierrc`:

```json
{
	"plugins": [
		"prettier-plugin-soml"
	]
}
```

Then format your files:

```sh
npx prettier --write '**/*.soml'
```

It also formats ` ```soml ` code blocks in Markdown files, and `lang="soml"` blocks in Vue files.

With the [Prettier API](https://prettier.io/docs/api), pass the module:

```js
import * as prettier from 'prettier';
import * as somlPlugin from 'prettier-plugin-soml';

await prettier.format('a: {b: 1,\nc: 2}', {parser: 'soml', plugins: [somlPlugin]});
//=> 'a: {\n\tb: 1\n\tc: 2\n}\n'
```

## What it changes

Only the layout:

- Indentation, to one tab per level
- Line breaks, so that every member and every array item of an object or array that spans lines is on its own line
- Commas, which are all removed from an object or array that spans lines, because every member and item is on its own line, while one on one line loses only its trailing comma
- Spaces, so that there is one space after `:` and after a comma, and none directly inside the brackets of an object or array on one line
- Trailing whitespace, which is removed, and runs of blank lines, which become one, except inside a block string, where they are content

An object or array whose brackets are on one line stays on one line, as in `ports: [80, 443]`, whatever `printWidth` is. To give it one member or item per line, put a line break anywhere inside it.

It keeps comments, member order, block strings, a top level without braces, and the spelling of every number, duration, and string. `0xFF` stays `0xFF`, and `'text'` stays `'text'`.

> [!NOTE]
> The output always uses tabs and LF. The layout of a SOML file is set by the specification, so that "already formatted" means the same in every tool. The plugin ignores `useTabs`, `tabWidth`, `printWidth`, `bracketSpacing`, `trailingComma`, `singleQuote`, `quoteProps`, `endOfLine`, and the matching `.editorconfig` settings. It has no options of its own.

## Pragmas

With [`--require-pragma`](https://prettier.io/docs/options#require-pragma), only files that start with `# @format` or `# @prettier` are formatted. [`--insert-pragma`](https://prettier.io/docs/options#insert-pragma) adds `# @format` at the top. With [`--check-ignore-pragma`](https://prettier.io/docs/options#check-ignore-pragma), files that start with `# @noformat` or `# @noprettier` are left as they are.

The pragma must be on the first line that is not blank, and alone on that line.

There is no `prettier-ignore` comment for one member or item, because the specification does not have one yet.

## VS Code

The [Prettier extension](https://marketplace.visualstudio.com/items?itemName=esbenp.prettier-vscode) formats `.soml` files when this plugin is in your Prettier config. VS Code itself must also know the SOML language, for syntax highlighting and `"[soml]"` settings. That needs a VS Code extension for SOML, which is not part of this package.

## Limitations

Prettier core does these before or after the plugin runs. The first four let a file through that `parse()` in `soml-lang` refuses:

- A byte order mark is removed before formatting and added back after it, so a file with a BOM is formatted and still has the BOM, which is not valid SOML.
- A carriage return is changed to LF before formatting, also inside strings and comments. So a file with CRLF line endings is formatted and gets LF line endings, while `parse()` refuses it.
- Invalid UTF-8 is replaced with U+FFFD when Prettier reads the file, so it is not reported, and the formatted file contains U+FFFD.
- An empty file, or one with only whitespace, is not reported as invalid. A file with only whitespace becomes empty. This includes whitespace that SOML refuses, such as U+00A0 and U+2028. With `--insert-pragma`, such a file is reported, because Prettier adds the pragma first, and a pragma alone is not a document.
- Range formatting (`--range-start` and `--range-end`) does not format the file. It only changes CRLF to LF. Prettier supports range formatting only for its built-in languages.
- An invalid ` ```soml ` code block in Markdown is left unchanged and is not reported.
- A ` ```soml ` code block in a Markdown file with CRLF line endings keeps CRLF, like the rest of that file.
- For an invalid file, Prettier shows the lines around the error as they are, so control characters in those lines, such as an escape, reach the terminal.
