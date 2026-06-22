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
- optional extractor executable
- optional extractor arguments like `{request}`

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

Custom languages can also support runnable partial source extraction. Each custom language chooses its own strategy:

- extractor command
- transpile to C

Use an extractor command when the language has its own parser, compiler API, or LSP. Use transpile to C when the language already lowers to C and can provide a symbol map.

loom writes a JSON request file and passes it to the configured command through the configured arguments. The command should print JSON to stdout.

Request shape:

```json
{
  "language": "toy",
  "filePath": "src/example.toy",
  "symbolName": "main",
  "lineStart": null,
  "lineEnd": null,
  "traceDependencies": true,
  "sourceFile": "/tmp/loom-extract/source.txt",
  "harnessFile": "/tmp/loom-extract/harness.txt"
}
```

Supported argument placeholders:

- `{request}`
- `{source}` or `{file}`
- `{harness}`
- `{symbol}`
- `{lineStart}`
- `{lineEnd}`
- `{deps}`
- `{language}`

The extractor can return a complete runnable source:

```json
{
  "description": "src/example.toy#main",
  "content": "..."
}
```

Or it can return structured parts:

```json
{
  "imports": ["..."],
  "dependencies": ["..."],
  "selected": "..."
}
```

The transpile to C strategy returns generated C or C++ and a symbol map:

```json
{
  "language": "c",
  "generatedSource": "int toy_score_impl(int x) { return x + 1; }",
  "symbols": {
    "score": "toy_score_impl"
  },
  "harness": "int main(void) { return toy_score_impl(1); }"
}
```

`language` can be `c` or `cpp`. `symbols` maps source language names to generated C or C++ names. `harness` is optional, but useful when the note harness is written in the source language instead of generated C.

If no extractor is configured for a custom language, loom falls back to generic line extraction and simple symbol slicing.

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

## Partial source extraction

loom can run part of another file while keeping the call site in your note. Add source attributes to the fence info string:

````markdown
```python loom-file="lib/calculus.py" loom-symbol=derivative
print(derivative(lambda x: x * x, 3))
```
````

Paths that start with `/` are read from the vault root. Other paths are read relative to the note.

Use `loom-lines=L10-L30` for a line range, or `loom-symbol=name` for a function, class, or similar definition. Add `loom-deps=false` when you only want the selected slice.

By default, loom also pulls in imports, includes, and referenced definitions that it can identify. The code in the note is appended after the extracted source, so it can call the function or run a small harness.

Python uses the standard library AST parser for symbol ranges, import analysis, alias handling, local module resolution, and recursive dependency tracing. C and C++ trace top level includes, macros, functions, types, and globals. LLVM IR traces `@symbol` definitions and declarations. Haskell and OCaml trace top level imports and bindings. Other languages use the generic extractor unless a custom extractor command is configured.

## Container execution

Notes can opt into container or VM execution with frontmatter:

```yaml
loom-container: py-sandbox
```

Alternatively, you can configure a **Default containerization group** in the Loom settings tab. If configured, any note that does not explicitly specify a `loom-container` frontmatter will fall back to running code blocks inside this default group.

### Container Group Directory
Container groups live inside the plugin folder:

```text
.obsidian/plugins/loom/containers/<group-name>/
```

Each group needs a `config.json`:

```json
{
  "runtime": "docker",
  "image": "python:3.12-slim",
  "languages": {
    "python": {
      "command": "python3 {file}",
      "extension": ".py"
    }
  }
}
```

### Supported Runtimes

Loom supports the following runtimes under `"runtime"` in `config.json`:
- `"docker"` / `"podman"`: Standard OCI container execution (mounts the group folder and runs your block command). If a `Dockerfile` exists inside the group folder, Loom builds and uses that image.
- `"wsl"`: Runs commands inside Windows Subsystem for Linux (WSL). You can specify a WSL distribution name in the `"image"` field (e.g., `"Ubuntu"`, `"Debian"`), or omit it to run in your default WSL distro.
- `"qemu"`: Runs commands on a remote VM using SSH, with optional automated QEMU local process management.
- `"custom"`: Delegates container building, running, and teardown to a custom local executable wrapper.

### Visual Settings & Environment Manager
Loom provides a visual, tabbed dashboard directly within the plugin's settings tab for managing container environments. Click **Edit** next to any group to access:
- **General**: Configure the runtime type, fallback image or WSL distro name, QEMU SSH settings, or Custom script configurations.
- **Languages**: Visually add, remove, and update execution commands and source file extensions for individual languages.
- **Dockerfile**: Create and edit a `Dockerfile` for Docker/Podman environments directly inside Obsidian.
- **Raw JSON**: View and edit the group's raw `config.json` configuration file, with automatic syntax validation.

Optional health checks can be added at the group level or under `qemu` / `custom`:

```json
{
  "healthCheck": {
    "command": "docker info",
    "positiveResponse": "Server Version",
    "negativeResponse": "Cannot connect"
  }
}
```

QEMU ex:

```json
{
  "runtime": "qemu",
  "qemu": {
    "sshTarget": "loom-vm",
    "remoteWorkspace": "/workspace",
    "sshArgs": "-o BatchMode=yes",
    "startCommand": "./start-vm.sh",
    "buildCommand": "./build-image.sh",
    "teardownCommand": "./stop-vm.sh",
    "healthCheck": {
      "command": "ssh loom-vm true"
    }
  },
  "languages": {
    "c": {
      "command": "gcc {file} -o /tmp/loom-c && /tmp/loom-c",
      "extension": ".c"
    }
  }
}
```

Managed QEMU:

```json
{
  "runtime": "qemu",
  "qemu": {
    "sshTarget": "loom-vm",
    "remoteWorkspace": "/workspace",
    "sshArgs": "-o BatchMode=yes -p 2222",
    "manager": {
      "enabled": true,
      "executable": "qemu-system-x86_64",
      "args": "-m 2048 -smp 2 -nographic -netdev user,id=net0,hostfwd=tcp::2222-:22 -device virtio-net-pci,netdev=net0",
      "image": "vm.qcow2",
      "imageFormat": "qcow2",
      "pidFile": ".loom-qemu.pid",
      "logFile": "qemu.log",
      "readinessTimeoutMs": 60000,
      "shutdownCommand": "ssh -p 2222 loom-vm sudo poweroff",
      "persist": true
    },
    "healthCheck": {
      "command": "ssh -p 2222 loom-vm true"
    }
  },
  "languages": {
    "python": {
      "command": "python3 {file}",
      "extension": ".py"
    }
  }
}
```

When `qemu.manager.enabled` is true loom starts QEMU as a detached local process, writes a PID file, polls the QEMU health check until the guest is ready, executes through SSH, and optionally shuts the VM down when `"persist": false`.

Custom wrapper:

```json
{
  "runtime": "custom",
  "custom": {
    "executable": "./loom-runtime.sh",
    "args": "{request}",
    "build": "./build.sh",
    "commandStructure": "{command}",
    "teardown": "./teardown.sh",
    "healthCheck": {
      "command": "./loom-runtime.sh --health",
      "positiveResponse": "ok"
    }
  },
  "languages": {
    "python": {
      "command": "python3 {file}",
      "extension": ".py"
    }
  }
}
```

For custom runtimes loom writes a request JSON file and passes its path through `{request}` and the relevant runtime config.

`{group}` and `{groupPath}` are also available in wrapper args


## Toolchain(s)

Some languages are only usable when their toolchain is installed/visible to Obsidian

## Build

```bash
npm install --legacy-peer-deps
```

```bash
npm run build
```
