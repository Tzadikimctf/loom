# loom

Obsidian plugin for executing ordinary fenced Markdown code blocks

The plugin is intended for research and exploratory work whereby proofs/solver queries and similar artefacts should remain readable directly within the document. loom augments existing code blocks with execution controls and renders transient output beneath the block. The source block itself is left unchanged and isn't rewritten into a plugin specific representation


## Model

loom treats a fenced block as an executable unit when the fence info string resolves to a supported language alias. The parser walks the active Markdown buffer and skips managed loom output sections and then normalises the fence language as well as creating a stable block descriptor

Each block receives an ID derived from:

- vault relative file path
- supported block ordinal
- normalised language
- source content hash

That ID is used for output replacement and toolbar state therefore rerunning a block updates the existing output panel instead of appending another panel

## Supported languages

loom includes built in runners for almost every language. The list is too extensive for me to type out because I'm lazy. Additional local languages can be added from the settings tab under **Custom Languages**. A custom language defines:

- name
- comma separated aliases
- executable
- arguments like `{file}`
- source file extension

For example a custom shell alias could use:

```text
name: shell-custom
aliases: shx
executable: /bin/sh
args: {file}
extension: .sh
```

Then a normal fenced block can run as:

````markdown
```shx
echo hello
```
````

## Runner contract

Runners implement this interface:

```ts
interface loomRunner {
  id: string;
  displayName: string;
  languages: readonly loomNormalizedLanguage[];
  canRun(block: loomCodeBlock, settings: loomPluginSettings): boolean;
  run(
    block: loomCodeBlock,
    context: loomRunContext,
    settings: loomPluginSettings
  ): Promise<loomRunResult>;
}
```

 A runner decides whether it can handle a block from the language and settings and then returns a `loomRunResult`


## Managed output

By default loom doesn't write output into the note. If `Write output back to note` is enabled then loom writes managed regions under blocks:

````markdown
<!-- loom:output:start id=<stable-block-id> -->
```text
runner=Python
exit=0
duration=8ms
timestamp=2026-06-20T00:00:00.000Z

stdout:
hello
```
<!-- loom:output:end -->
````

The parser skips these regions and generated output blocks are never executed

## Container execution

Notes can opt into Docker execution with frontmatter:

```yaml
loom-container: py-sandbox
```

Container groups live inside the plugin folder:

```text
.obsidian/plugins/loom/containers/<group-name>/
```

Each group needs a `config.json`:

```json
{
  "image": "python:3.12-slim",
  "languages": {
    "python": {
      "command": "python3 {file}",
      "extension": ".py"
    }
  }
}
```

If the group has a Dockerfile then loom builds it as `loom-container-<group-name>` and uses that image for execution. The group dir is mounted into the container as `/workspace` and temp source files are written there/removed after the run

Make sure Docker is installed and running on the host


## Toolchain(s)

Some languages are only usable when their toolchain is installed/visible to Obsidian

## Build

```bash
npm install --legacy-peer-deps
```

```bash
npm run build
```
