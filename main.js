"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/main.ts
var main_exports = {};
__export(main_exports, {
  default: () => loomPlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian5 = require("obsidian");
var import_state = require("@codemirror/state");
var import_view2 = require("@codemirror/view");
var import_path7 = require("path");

// src/execution/containerRunner.ts
var import_obsidian = require("obsidian");
var import_fs = require("fs");
var import_promises2 = require("fs/promises");
var import_path2 = require("path");
var import_child_process2 = require("child_process");

// src/execution/processRunner.ts
var import_promises = require("fs/promises");
var import_os = require("os");
var import_path = require("path");
var import_child_process = require("child_process");
async function withNamedTempSourceFile(fileName, source, callback) {
  const tempDir = await (0, import_promises.mkdtemp)((0, import_path.join)((0, import_os.tmpdir)(), "loom-"));
  const tempFile = (0, import_path.join)(tempDir, fileName);
  try {
    await (0, import_promises.writeFile)(tempFile, normalizeExecutableSource(source), "utf8");
    return await callback({ tempDir, tempFile });
  } finally {
    await (0, import_promises.rm)(tempDir, { recursive: true, force: true });
  }
}
async function withTempSourceFile(fileExtension, source, callback) {
  return withNamedTempSourceFile(`snippet${fileExtension}`, source, callback);
}
function normalizeExecutableSource(source) {
  const lines = source.split("\n");
  const nonEmptyLines = lines.filter((line) => line.trim().length > 0);
  if (!nonEmptyLines.length) {
    return source;
  }
  let sharedIndent = getLeadingWhitespace(nonEmptyLines[0]);
  for (const line of nonEmptyLines.slice(1)) {
    sharedIndent = sharedWhitespacePrefix(sharedIndent, getLeadingWhitespace(line));
    if (!sharedIndent) {
      return source;
    }
  }
  if (!sharedIndent) {
    return source;
  }
  return lines.map((line) => line.trim().length === 0 ? line : line.startsWith(sharedIndent) ? line.slice(sharedIndent.length) : line).join("\n");
}
function getLeadingWhitespace(line) {
  const match = line.match(/^[\t ]*/);
  return match?.[0] ?? "";
}
function sharedWhitespacePrefix(left, right) {
  let index = 0;
  while (index < left.length && index < right.length && left[index] === right[index]) {
    index += 1;
  }
  return left.slice(0, index);
}
async function runProcess(spec) {
  const startedAt = /* @__PURE__ */ new Date();
  let stdout = "";
  let stderr = "";
  let exitCode = null;
  let timedOut = false;
  let cancelled = false;
  let child = null;
  let timeoutHandle = null;
  let abortHandler = null;
  try {
    await new Promise((resolve, reject) => {
      child = (0, import_child_process.spawn)(spec.executable, spec.args, {
        cwd: spec.workingDirectory,
        shell: false,
        env: {
          ...process.env,
          ...spec.env
        }
      });
      const abort = () => {
        cancelled = true;
        child?.kill("SIGTERM");
      };
      abortHandler = abort;
      if (spec.signal.aborted) {
        abort();
      } else {
        spec.signal.addEventListener("abort", abort, { once: true });
      }
      timeoutHandle = setTimeout(() => {
        timedOut = true;
        child?.kill("SIGTERM");
      }, spec.timeoutMs);
      child.stdout?.on("data", (chunk) => {
        stdout += chunk.toString();
      });
      child.stderr?.on("data", (chunk) => {
        stderr += chunk.toString();
      });
      child.on("error", (error) => {
        reject(error);
      });
      child.on("close", (code) => {
        exitCode = code;
        resolve();
      });
    });
  } catch (error) {
    stderr = stderr || formatProcessError(error, spec.executable);
    exitCode = exitCode ?? -1;
  } finally {
    if (abortHandler) {
      spec.signal.removeEventListener("abort", abortHandler);
    }
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
  const finishedAt = /* @__PURE__ */ new Date();
  const durationMs = finishedAt.getTime() - startedAt.getTime();
  const success = !timedOut && !cancelled && exitCode === 0;
  return {
    runnerId: spec.runnerId,
    runnerName: spec.runnerName,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs,
    exitCode,
    stdout,
    stderr,
    success,
    timedOut,
    cancelled
  };
}
function formatProcessError(error, executable) {
  if (error instanceof Error && "code" in error && error.code === "ENOENT") {
    return `Executable not found: ${executable}`;
  }
  return error instanceof Error ? error.message : String(error);
}
async function runTempFileProcess(spec) {
  return withTempSourceFile(
    spec.fileExtension,
    spec.source,
    async ({ tempFile, tempDir }) => runProcess({
      runnerId: spec.runnerId,
      runnerName: spec.runnerName,
      executable: spec.executable,
      args: spec.args.map((value) => value.replaceAll("{file}", tempFile).replaceAll("{tempDir}", tempDir)),
      workingDirectory: spec.workingDirectory,
      timeoutMs: spec.timeoutMs,
      signal: spec.signal,
      env: expandTemplatedEnv(spec.env, tempFile, tempDir)
    })
  );
}
function expandTemplatedEnv(env, tempFile, tempDir) {
  if (!env) {
    return void 0;
  }
  return Object.fromEntries(
    Object.entries(env).map(([key, value]) => [
      key,
      typeof value === "string" ? value.replaceAll("{file}", tempFile).replaceAll("{tempDir}", tempDir) : value
    ])
  );
}

// src/utils/command.ts
function splitCommandLine(input) {
  const parts = [];
  let current = "";
  let quote = null;
  let escaping = false;
  for (const char of input.trim()) {
    if (escaping) {
      current += char;
      escaping = false;
      continue;
    }
    if (char === "\\") {
      escaping = true;
      continue;
    }
    if ((char === "'" || char === '"') && !quote) {
      quote = char;
      continue;
    }
    if (char === quote) {
      quote = null;
      continue;
    }
    if (/\s/.test(char) && !quote) {
      if (current) {
        parts.push(current);
        current = "";
      }
      continue;
    }
    current += char;
  }
  if (current) {
    parts.push(current);
  }
  return parts;
}

// src/execution/containerRunner.ts
var loomContainerRunner = class {
  constructor(app, pluginDir) {
    this.app = app;
    this.pluginDir = pluginDir;
    this.builtImages = /* @__PURE__ */ new Set();
  }
  getContainerGroupName(file) {
    const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
    const value = frontmatter?.["loom-container"];
    return typeof value === "string" && value.trim() ? value.trim() : null;
  }
  async getGroupSummaries() {
    const containersPath = this.getContainersPath();
    if (!(0, import_fs.existsSync)(containersPath)) {
      return [];
    }
    const entries = await (0, import_promises2.readdir)(containersPath, { withFileTypes: true });
    return Promise.all(
      entries.filter((entry) => entry.isDirectory()).map(async (entry) => {
        const groupPath = (0, import_path2.join)(containersPath, entry.name);
        const hasConfig = (0, import_fs.existsSync)((0, import_path2.join)(groupPath, "config.json"));
        const hasDockerfile = (0, import_fs.existsSync)((0, import_path2.join)(groupPath, "Dockerfile"));
        if (!hasConfig) {
          return {
            name: entry.name,
            status: "missing config.json"
          };
        }
        try {
          const config = await this.readConfig(groupPath);
          const pieces = [`runtime: ${config.runtime}`];
          if ((config.runtime === "docker" || config.runtime === "podman") && hasDockerfile) {
            pieces.push("Dockerfile");
          }
          if (config.runtime === "qemu" && config.qemu?.sshTarget) {
            pieces.push(`ssh: ${config.qemu.sshTarget}`);
          }
          if (config.runtime === "qemu" && config.qemu?.manager?.enabled) {
            pieces.push(`manager: ${await this.getManagedQemuStatus(groupPath, config.qemu.manager)}`);
          }
          if (config.runtime === "custom" && config.custom?.executable) {
            pieces.push(`wrapper: ${config.custom.executable}`);
          }
          const languageCount = Object.keys(config.languages).length;
          pieces.push(`${languageCount} language${languageCount === 1 ? "" : "s"}`);
          return {
            name: entry.name,
            status: pieces.join(", ")
          };
        } catch (error) {
          return {
            name: entry.name,
            status: `invalid config.json: ${error instanceof Error ? error.message : String(error)}`
          };
        }
      })
    );
  }
  async run(block, context, settings, groupName) {
    const groupPath = this.resolveGroupPath(groupName);
    const config = await this.readConfig(groupPath);
    const configLang = config.languages[block.language] ?? config.languages[block.languageAlias];
    let isFallback = false;
    let language = null;
    if (configLang) {
      if (configLang.useDefault) {
        language = this.getDefaultLanguageConfig(block.language, settings) ?? this.getDefaultLanguageConfig(block.languageAlias, settings);
      } else {
        language = configLang;
      }
    } else {
      language = this.getDefaultLanguageConfig(block.language, settings) ?? this.getDefaultLanguageConfig(block.languageAlias, settings);
      isFallback = true;
    }
    if (!language || !language.command || !language.extension) {
      throw new Error(`Container group ${groupName} has no command for ${block.language}.`);
    }
    await (0, import_promises2.mkdir)(groupPath, { recursive: true });
    await this.runHealthCheck(config.healthCheck, groupPath, context.timeoutMs, context.signal, `container:${groupName}:health`, `Container ${groupName} health check`);
    const tempFileName = `temp_${Date.now()}_${Math.random().toString(16).slice(2)}${normalizeExtension(language.extension)}`;
    const tempFilePath = (0, import_path2.join)(groupPath, tempFileName);
    try {
      await (0, import_promises2.writeFile)(tempFilePath, block.content, "utf8");
      let result;
      switch (config.runtime) {
        case "docker":
        case "podman":
          result = await this.runOciContainer(groupName, groupPath, config, language, tempFileName, context, settings);
          break;
        case "qemu":
          result = await this.runQemu(groupName, groupPath, config, language, tempFileName, context);
          break;
        case "custom":
          result = await this.runCustom(groupName, groupPath, config, block, language, tempFileName, tempFilePath, context);
          break;
        case "wsl":
          result = await this.runWslContainer(groupName, groupPath, config, language, tempFileName, context);
          break;
        default:
          throw new Error(`Unsupported runtime: ${config.runtime}`);
      }
      if (isFallback) {
        const fallbackMsg = `[Loom] Language '${block.language}' was not declared in container group. Running using default command: ${language.command}`;
        result.warning = result.warning ? `${result.warning}
${fallbackMsg}` : fallbackMsg;
      }
      return result;
    } finally {
      await (0, import_promises2.rm)(tempFilePath, { force: true });
    }
  }
  async buildGroup(groupName, timeoutMs, signal) {
    const groupPath = this.resolveGroupPath(groupName);
    const config = await this.readConfig(groupPath);
    await (0, import_promises2.mkdir)(groupPath, { recursive: true });
    await this.runHealthCheck(config.healthCheck, groupPath, timeoutMs, signal, `container:${groupName}:health`, `Container ${groupName} health check`);
    switch (config.runtime) {
      case "docker":
      case "podman":
        return this.buildImage(groupName, groupPath, config, timeoutMs, signal);
      case "qemu":
        return this.buildQemu(groupName, groupPath, config, timeoutMs, signal);
      case "custom":
        return this.runCustomWrapper(groupName, groupPath, config, this.createCustomRequest("build", groupName, groupPath, config, timeoutMs), timeoutMs, signal);
      case "wsl":
        return this.createSyntheticResult(
          `container:${groupName}:wsl:build`,
          `WSL ${groupName} build`,
          `WSL environment ${config.image || "(default)"} does not require a build step.
`
        );
    }
  }
  async runOciContainer(groupName, groupPath, config, language, tempFileName, context, settings) {
    const image = await this.resolveImage(groupName, groupPath, config, context, settings);
    const command = splitCommandLine(language.command.replaceAll("{file}", tempFileName));
    if (!command.length) {
      throw new Error("Container command is empty.");
    }
    return await runProcess({
      runnerId: `container:${groupName}`,
      runnerName: `${runtimeLabel(config.runtime)} ${groupName}`,
      executable: this.runtimeExecutable(config),
      args: [
        "run",
        "--rm",
        "-v",
        `${groupPath}:/workspace`,
        "-w",
        "/workspace",
        image,
        ...command
      ],
      workingDirectory: groupPath,
      timeoutMs: context.timeoutMs,
      signal: context.signal
    });
  }
  async runQemu(groupName, groupPath, config, language, tempFileName, context) {
    const qemu = this.requireQemuConfig(config);
    await this.runOptionalCommand(qemu.startCommand, groupPath, context.timeoutMs, context.signal, `container:${groupName}:qemu:start`, `QEMU ${groupName} start`);
    await this.ensureManagedQemu(groupName, groupPath, qemu, context.timeoutMs, context.signal);
    await this.runHealthCheck(qemu.healthCheck, groupPath, context.timeoutMs, context.signal, `container:${groupName}:qemu:health`, `QEMU ${groupName} health check`);
    try {
      const remoteFile = import_path2.posix.join(qemu.remoteWorkspace, tempFileName);
      const remoteCommand = language.command.replaceAll("{file}", shellQuote(remoteFile));
      if (!remoteCommand.trim()) {
        throw new Error("QEMU command is empty.");
      }
      return await runProcess({
        runnerId: `container:${groupName}:qemu`,
        runnerName: `QEMU ${groupName}`,
        executable: qemu.sshExecutable || "ssh",
        args: [
          ...splitCommandLine(qemu.sshArgs || ""),
          qemu.sshTarget,
          `cd ${shellQuote(qemu.remoteWorkspace)} && ${remoteCommand}`
        ],
        workingDirectory: groupPath,
        timeoutMs: context.timeoutMs,
        signal: context.signal
      });
    } finally {
      await this.runOptionalCommand(qemu.teardownCommand, groupPath, context.timeoutMs, context.signal, `container:${groupName}:qemu:teardown`, `QEMU ${groupName} teardown`);
      await this.stopManagedQemuIfNeeded(groupName, groupPath, qemu, context.timeoutMs, context.signal);
    }
  }
  async runCustom(groupName, groupPath, config, block, language, tempFileName, tempFilePath, context) {
    const command = language.command.replaceAll("{file}", tempFileName);
    const result = await this.runCustomWrapper(
      groupName,
      groupPath,
      config,
      this.createCustomRequest("run", groupName, groupPath, config, context.timeoutMs, {
        language: block.language,
        languageAlias: block.languageAlias,
        fileName: tempFileName,
        filePath: tempFilePath,
        command
      }),
      context.timeoutMs,
      context.signal
    );
    if (config.custom?.teardown) {
      const teardown = await this.runCustomWrapper(
        groupName,
        groupPath,
        config,
        this.createCustomRequest("teardown", groupName, groupPath, config, context.timeoutMs, {
          language: block.language,
          languageAlias: block.languageAlias,
          fileName: tempFileName,
          filePath: tempFilePath,
          command
        }),
        context.timeoutMs,
        context.signal
      );
      if (!teardown.success) {
        result.warning = `Custom runtime teardown failed: ${teardown.stderr || teardown.stdout || `exit ${teardown.exitCode}`}`;
      }
    }
    return result;
  }
  async runWslContainer(groupName, groupPath, config, language, tempFileName, context) {
    const wslGroupPath = this.translateToWslPath(groupPath);
    const command = language.command.replaceAll("{file}", tempFileName);
    if (!command.trim()) {
      throw new Error("WSL command is empty.");
    }
    const shellFlags = config.wsl?.interactive ? ["-i", "-l", "-c"] : ["-l", "-c"];
    const wslArgs = ["bash", ...shellFlags, `cd "${wslGroupPath.replaceAll('"', '\\"')}" && ${command}`];
    if (config.image?.trim()) {
      wslArgs.unshift("-d", config.image.trim());
    }
    return await runProcess({
      runnerId: `container:${groupName}:wsl`,
      runnerName: `WSL ${groupName}`,
      executable: "wsl",
      args: wslArgs,
      workingDirectory: groupPath,
      timeoutMs: context.timeoutMs,
      signal: context.signal
    });
  }
  translateToWslPath(windowsPath) {
    const match = windowsPath.match(/^([A-Za-z]):\\(.*)/);
    if (match) {
      const drive = match[1].toLowerCase();
      const rest = match[2].replace(/\\/g, "/");
      return `/mnt/${drive}/${rest}`;
    }
    if (windowsPath.includes("\\")) {
      return windowsPath.replace(/\\/g, "/");
    }
    return windowsPath;
  }
  async resolveImage(groupName, groupPath, config, context, settings) {
    const dockerfile = (0, import_path2.join)(groupPath, "Dockerfile");
    if (!(0, import_fs.existsSync)(dockerfile)) {
      return config.image || "ubuntu:latest";
    }
    const image = this.imageNameForGroup(groupName);
    const cacheKey = `${this.runtimeExecutable(config)}:${image}`;
    if (this.builtImages.has(cacheKey)) {
      return image;
    }
    const result = await this.buildImage(groupName, groupPath, config, Math.max(context.timeoutMs, settings.defaultTimeoutMs, 12e4), context.signal);
    if (!result.success) {
      throw new Error(result.stderr || result.stdout || `${runtimeLabel(config.runtime)} build failed for ${groupName}.`);
    }
    this.builtImages.add(cacheKey);
    return image;
  }
  async buildImage(groupName, groupPath, config, timeoutMs, signal) {
    const image = this.imageNameForGroup(groupName);
    if (!(0, import_fs.existsSync)((0, import_path2.join)(groupPath, "Dockerfile"))) {
      return this.createSyntheticResult(
        `container:${groupName}:build`,
        `${runtimeLabel(config.runtime)} ${groupName} build`,
        `No Dockerfile configured. Using image ${config.image || "ubuntu:latest"}.
`
      );
    }
    return runProcess({
      runnerId: `container:${groupName}:build`,
      runnerName: `${runtimeLabel(config.runtime)} ${groupName} build`,
      executable: this.runtimeExecutable(config),
      args: ["build", "-t", image, groupPath],
      workingDirectory: groupPath,
      timeoutMs,
      signal
    });
  }
  async buildQemu(groupName, groupPath, config, timeoutMs, signal) {
    const qemu = this.requireQemuConfig(config);
    if (!qemu.buildCommand?.trim()) {
      return this.createSyntheticResult(`container:${groupName}:qemu:build`, `QEMU ${groupName} build`, "No QEMU build command configured.\n");
    }
    return this.runCommandLine(qemu.buildCommand, groupPath, timeoutMs, signal, `container:${groupName}:qemu:build`, `QEMU ${groupName} build`);
  }
  async readConfig(groupPath) {
    const configPath = (0, import_path2.join)(groupPath, "config.json");
    let raw;
    try {
      raw = JSON.parse(await (0, import_promises2.readFile)(configPath, "utf8"));
    } catch (error) {
      throw new Error(`Unable to read container config ${configPath}: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new Error("Container config must be an object.");
    }
    const data = raw;
    const runtime = this.readRuntime(data.runtime);
    if (data.executable != null && typeof data.executable !== "string") {
      throw new Error("Container config executable must be a string.");
    }
    if (data.image != null && typeof data.image !== "string") {
      throw new Error("Container config image must be a string.");
    }
    if (!data.languages || typeof data.languages !== "object" || Array.isArray(data.languages)) {
      throw new Error("Container config languages must be an object.");
    }
    const languages = {};
    for (const [language, value] of Object.entries(data.languages)) {
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error(`Container language ${language} must be an object.`);
      }
      const languageConfig = value;
      const useDefault = languageConfig.useDefault === true;
      if (!useDefault && (typeof languageConfig.command !== "string" || !languageConfig.command.trim())) {
        throw new Error(`Container language ${language} must define command or useDefault.`);
      }
      languages[language] = {
        command: typeof languageConfig.command === "string" ? languageConfig.command : void 0,
        extension: typeof languageConfig.extension === "string" ? languageConfig.extension : useDefault ? void 0 : `.${language}`,
        useDefault: useDefault || void 0
      };
    }
    return {
      runtime,
      executable: typeof data.executable === "string" && data.executable.trim() ? data.executable.trim() : void 0,
      image: typeof data.image === "string" ? data.image : void 0,
      wsl: this.readWslConfig(data.wsl),
      healthCheck: this.readHealthCheck(data.healthCheck, "Container config healthCheck"),
      qemu: this.readQemuConfig(data.qemu),
      custom: this.readCustomConfig(data.custom),
      languages
    };
  }
  readRuntime(value) {
    if (value == null) {
      return "docker";
    }
    if (value === "docker" || value === "podman" || value === "qemu" || value === "custom" || value === "wsl") {
      return value;
    }
    throw new Error("Container config runtime must be docker, podman, qemu, custom, or wsl.");
  }
  readWslConfig(value) {
    if (value == null) {
      return void 0;
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("Container config wsl must be an object.");
    }
    const data = value;
    return {
      interactive: data.interactive === true
    };
  }
  readQemuConfig(value) {
    if (value == null) {
      return void 0;
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("Container config qemu must be an object.");
    }
    const data = value;
    if (typeof data.sshTarget !== "string" || !data.sshTarget.trim()) {
      throw new Error("Container config qemu.sshTarget must be a string.");
    }
    if (typeof data.remoteWorkspace !== "string" || !data.remoteWorkspace.trim()) {
      throw new Error("Container config qemu.remoteWorkspace must be a string.");
    }
    return {
      sshTarget: data.sshTarget.trim(),
      remoteWorkspace: data.remoteWorkspace.trim(),
      sshExecutable: optionalString(data.sshExecutable),
      sshArgs: optionalString(data.sshArgs),
      startCommand: optionalString(data.startCommand),
      buildCommand: optionalString(data.buildCommand),
      teardownCommand: optionalString(data.teardownCommand),
      healthCheck: this.readHealthCheck(data.healthCheck, "Container config qemu.healthCheck"),
      manager: this.readQemuManagerConfig(data.manager)
    };
  }
  readQemuManagerConfig(value) {
    if (value == null) {
      return void 0;
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("Container config qemu.manager must be an object.");
    }
    const data = value;
    return {
      enabled: data.enabled !== false,
      executable: optionalString(data.executable),
      args: optionalString(data.args),
      image: optionalString(data.image),
      imageFormat: optionalString(data.imageFormat),
      pidFile: optionalString(data.pidFile),
      logFile: optionalString(data.logFile),
      readinessTimeoutMs: optionalPositiveInteger(data.readinessTimeoutMs, "Container config qemu.manager.readinessTimeoutMs"),
      readinessIntervalMs: optionalPositiveInteger(data.readinessIntervalMs, "Container config qemu.manager.readinessIntervalMs"),
      bootDelayMs: optionalNonNegativeInteger(data.bootDelayMs, "Container config qemu.manager.bootDelayMs"),
      shutdownCommand: optionalString(data.shutdownCommand),
      shutdownTimeoutMs: optionalPositiveInteger(data.shutdownTimeoutMs, "Container config qemu.manager.shutdownTimeoutMs"),
      killSignal: optionalSignal(data.killSignal, "Container config qemu.manager.killSignal"),
      persist: typeof data.persist === "boolean" ? data.persist : void 0
    };
  }
  readCustomConfig(value) {
    if (value == null) {
      return void 0;
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("Container config custom must be an object.");
    }
    const data = value;
    if (typeof data.executable !== "string" || !data.executable.trim()) {
      throw new Error("Container config custom.executable must be a string.");
    }
    return {
      executable: data.executable.trim(),
      args: optionalString(data.args),
      build: optionalString(data.build),
      commandStructure: optionalString(data.commandStructure),
      teardown: optionalString(data.teardown),
      healthCheck: this.readHealthCheck(data.healthCheck, "Container config custom.healthCheck")
    };
  }
  readHealthCheck(value, label) {
    if (value == null) {
      return void 0;
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error(`${label} must be an object.`);
    }
    const data = value;
    if (typeof data.command !== "string" || !data.command.trim()) {
      throw new Error(`${label}.command must be a string.`);
    }
    return {
      command: data.command.trim(),
      positiveResponse: optionalString(data.positiveResponse ?? data.positive_response ?? data["positive response"] ?? data.possitiveResponse),
      negativeResponse: optionalString(data.negativeResponse ?? data.negative_response ?? data["negative response"])
    };
  }
  requireQemuConfig(config) {
    if (!config.qemu) {
      throw new Error("QEMU runtime requires a qemu config object.");
    }
    return config.qemu;
  }
  requireCustomConfig(config) {
    if (!config.custom) {
      throw new Error("Custom runtime requires a custom config object.");
    }
    return config.custom;
  }
  runtimeExecutable(config) {
    if (config.executable?.trim()) {
      return config.executable.trim();
    }
    return config.runtime === "podman" ? "podman" : "docker";
  }
  async runHealthCheck(healthCheck, workingDirectory, timeoutMs, signal, runnerId, runnerName) {
    if (!healthCheck) {
      return;
    }
    const result = await this.runCommandLine(healthCheck.command, workingDirectory, timeoutMs, signal, runnerId, runnerName);
    const combinedOutput = `${result.stdout}
${result.stderr}`;
    if (!result.success) {
      throw new Error(`${runnerName} failed: ${result.stderr || result.stdout || `exit ${result.exitCode}`}`);
    }
    if (healthCheck.negativeResponse && combinedOutput.includes(healthCheck.negativeResponse)) {
      throw new Error(`${runnerName} returned negative response: ${healthCheck.negativeResponse}`);
    }
    if (healthCheck.positiveResponse && !combinedOutput.includes(healthCheck.positiveResponse)) {
      throw new Error(`${runnerName} did not return positive response: ${healthCheck.positiveResponse}`);
    }
  }
  async runOptionalCommand(command, workingDirectory, timeoutMs, signal, runnerId, runnerName) {
    if (!command?.trim()) {
      return;
    }
    const result = await this.runCommandLine(command, workingDirectory, timeoutMs, signal, runnerId, runnerName);
    if (!result.success) {
      throw new Error(`${runnerName} failed: ${result.stderr || result.stdout || `exit ${result.exitCode}`}`);
    }
  }
  async runCommandLine(command, workingDirectory, timeoutMs, signal, runnerId, runnerName) {
    const parts = splitCommandLine(command);
    if (!parts.length) {
      throw new Error(`${runnerName} command is empty.`);
    }
    return runProcess({
      runnerId,
      runnerName,
      executable: parts[0],
      args: parts.slice(1),
      workingDirectory,
      timeoutMs,
      signal
    });
  }
  async ensureManagedQemu(groupName, groupPath, qemu, timeoutMs, signal) {
    const manager = qemu.manager;
    if (!manager?.enabled) {
      return;
    }
    const pidPath = this.resolveGroupFilePath(groupPath, manager.pidFile || ".loom-qemu.pid");
    const existingPid = await this.readPidFile(pidPath);
    if (existingPid && this.isProcessRunning(existingPid)) {
      await this.waitForManagedQemuReadiness(groupName, groupPath, qemu, timeoutMs, signal);
      return;
    }
    if (existingPid) {
      await (0, import_promises2.rm)(pidPath, { force: true });
    }
    const executable = manager.executable || "qemu-system-x86_64";
    const args = this.buildManagedQemuArgs(groupPath, manager);
    if (!args.length) {
      throw new Error(`QEMU manager for ${groupName} needs qemu.manager.args or qemu.manager.image.`);
    }
    const logPath = manager.logFile ? this.resolveGroupFilePath(groupPath, manager.logFile) : null;
    const logFd = logPath ? (0, import_fs.openSync)(logPath, "a") : null;
    try {
      const child = (0, import_child_process2.spawn)(executable, args, {
        cwd: groupPath,
        detached: true,
        stdio: ["ignore", logFd ?? "ignore", logFd ?? "ignore"]
      });
      child.on("error", () => void 0);
      child.unref();
      if (!child.pid) {
        throw new Error(`QEMU manager for ${groupName} did not return a process id.`);
      }
      await (0, import_promises2.writeFile)(pidPath, `${child.pid}
`, "utf8");
      await this.waitForManagedQemuReadiness(groupName, groupPath, qemu, timeoutMs, signal);
    } finally {
      if (logFd != null) {
        (0, import_fs.closeSync)(logFd);
      }
    }
  }
  buildManagedQemuArgs(groupPath, manager) {
    const args = splitCommandLine(manager.args || "");
    if (manager.image) {
      const imagePath = this.resolveGroupFilePath(groupPath, manager.image);
      args.push("-drive", `file=${imagePath},if=virtio,format=${manager.imageFormat || "qcow2"}`);
    }
    return args;
  }
  async waitForManagedQemuReadiness(groupName, groupPath, qemu, timeoutMs, signal) {
    const manager = qemu.manager;
    if (!manager?.enabled) {
      return;
    }
    if (!qemu.healthCheck) {
      await sleepWithSignal(manager.bootDelayMs ?? 0, signal);
      return;
    }
    const timeout = Math.min(manager.readinessTimeoutMs ?? 6e4, Math.max(timeoutMs, 1));
    const interval = manager.readinessIntervalMs ?? 1e3;
    const startedAt = Date.now();
    let lastError = "";
    while (Date.now() - startedAt <= timeout) {
      if (signal.aborted) {
        throw new Error(`QEMU ${groupName} readiness wait cancelled.`);
      }
      try {
        await this.runHealthCheck(qemu.healthCheck, groupPath, Math.min(interval, timeout), signal, `container:${groupName}:qemu:ready`, `QEMU ${groupName} readiness check`);
        return;
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      }
      await sleepWithSignal(interval, signal);
    }
    throw new Error(`QEMU ${groupName} did not become ready within ${timeout} ms${lastError ? `: ${lastError}` : "."}`);
  }
  async stopManagedQemuIfNeeded(groupName, groupPath, qemu, timeoutMs, signal) {
    const manager = qemu.manager;
    if (!manager?.enabled || manager.persist !== false) {
      return;
    }
    const pidPath = this.resolveGroupFilePath(groupPath, manager.pidFile || ".loom-qemu.pid");
    const pid = await this.readPidFile(pidPath);
    if (!pid) {
      return;
    }
    if (manager.shutdownCommand) {
      await this.runOptionalCommand(
        manager.shutdownCommand,
        groupPath,
        Math.min(manager.shutdownTimeoutMs ?? timeoutMs, timeoutMs),
        signal,
        `container:${groupName}:qemu:shutdown`,
        `QEMU ${groupName} shutdown`
      );
    } else if (this.isProcessRunning(pid)) {
      process.kill(pid, manager.killSignal || "SIGTERM");
    }
    const stopped = await this.waitForProcessExit(pid, manager.shutdownTimeoutMs ?? 1e4, signal);
    if (!stopped && this.isProcessRunning(pid)) {
      process.kill(pid, "SIGKILL");
      await this.waitForProcessExit(pid, 2e3, signal);
    }
    await (0, import_promises2.rm)(pidPath, { force: true });
  }
  async getManagedQemuStatus(groupPath, manager) {
    const pidPath = this.resolveGroupFilePath(groupPath, manager.pidFile || ".loom-qemu.pid");
    const pid = await this.readPidFile(pidPath);
    if (!pid) {
      return "stopped";
    }
    return this.isProcessRunning(pid) ? `running pid ${pid}` : `stale pid ${pid}`;
  }
  async readPidFile(pidPath) {
    try {
      const value = (await (0, import_promises2.readFile)(pidPath, "utf8")).trim();
      const pid = Number.parseInt(value, 10);
      return Number.isInteger(pid) && pid > 0 ? pid : null;
    } catch {
      return null;
    }
  }
  isProcessRunning(pid) {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }
  async waitForProcessExit(pid, timeoutMs, signal) {
    const startedAt = Date.now();
    while (Date.now() - startedAt <= timeoutMs) {
      if (signal.aborted) {
        return false;
      }
      if (!this.isProcessRunning(pid)) {
        return true;
      }
      await sleepWithSignal(250, signal);
    }
    return !this.isProcessRunning(pid);
  }
  async runCustomWrapper(groupName, groupPath, config, request, timeoutMs, signal) {
    const custom = this.requireCustomConfig(config);
    await this.runHealthCheck(custom.healthCheck, groupPath, timeoutMs, signal, `container:${groupName}:custom:health`, `Custom ${groupName} health check`);
    const requestFileName = `request_${Date.now()}_${Math.random().toString(16).slice(2)}.json`;
    const requestPath = (0, import_path2.join)(groupPath, requestFileName);
    try {
      await (0, import_promises2.writeFile)(requestPath, `${JSON.stringify(request, null, 2)}
`, "utf8");
      const args = splitCommandLine(custom.args || "{request}").map(
        (arg) => arg.replaceAll("{request}", requestPath).replaceAll("{group}", groupName).replaceAll("{groupPath}", groupPath)
      );
      return await runProcess({
        runnerId: `container:${groupName}:custom:${request.action}`,
        runnerName: `Custom ${groupName} ${request.action}`,
        executable: custom.executable,
        args,
        workingDirectory: groupPath,
        timeoutMs,
        signal
      });
    } finally {
      await (0, import_promises2.rm)(requestPath, { force: true });
    }
  }
  createCustomRequest(action, groupName, groupPath, config, timeoutMs, extra = {}) {
    return {
      action,
      groupName,
      groupPath,
      runtime: config.runtime,
      image: config.image,
      build: config.custom?.build,
      commandStructure: config.custom?.commandStructure,
      teardown: config.custom?.teardown,
      timeoutMs,
      config: {
        executable: config.executable,
        custom: config.custom,
        qemu: config.qemu,
        healthCheck: config.healthCheck
      },
      ...extra
    };
  }
  createSyntheticResult(runnerId, runnerName, stdout, success = true) {
    const now = (/* @__PURE__ */ new Date()).toISOString();
    return {
      runnerId,
      runnerName,
      startedAt: now,
      finishedAt: now,
      durationMs: 0,
      exitCode: success ? 0 : -1,
      stdout,
      stderr: "",
      success,
      timedOut: false,
      cancelled: false
    };
  }
  getContainersPath() {
    const adapterBasePath = this.app.vault.adapter.basePath ?? "";
    return (0, import_path2.normalize)((0, import_path2.join)(adapterBasePath, this.pluginDir, "containers"));
  }
  resolveGroupPath(groupName) {
    const safeName = (0, import_path2.basename)(groupName);
    if (!safeName || safeName !== groupName) {
      throw new Error(`Invalid container group name: ${groupName}`);
    }
    return (0, import_path2.normalize)((0, import_path2.join)(this.getContainersPath(), safeName));
  }
  resolveGroupFilePath(groupPath, filePath) {
    const safePath = (0, import_path2.normalize)((0, import_path2.join)(groupPath, filePath));
    const normalizedGroupPath = (0, import_path2.normalize)(groupPath);
    const posixSafePath = safePath.replace(/\\/g, "/");
    const posixGroupPath = normalizedGroupPath.replace(/\\/g, "/");
    if (posixSafePath !== posixGroupPath && !posixSafePath.startsWith(`${posixGroupPath}/`)) {
      throw new Error(`Invalid QEMU manager path outside container group: ${filePath}`);
    }
    return safePath;
  }
  imageNameForGroup(groupName) {
    return `loom-container-${groupName.toLowerCase().replace(/[^a-z0-9_.-]/g, "-")}`;
  }
  getDefaultLanguageConfig(langId, settings) {
    if (!langId) return null;
    const normalized = langId.toLowerCase().trim();
    const custom = settings.customLanguages.find((c) => {
      const names = [c.name, ...c.aliases.split(",").map((s) => s.trim())].map((n) => n.toLowerCase());
      return names.includes(normalized);
    });
    if (custom) {
      return {
        command: `${custom.executable} ${custom.args}`.trim(),
        extension: custom.extension || ".txt"
      };
    }
    switch (normalized) {
      case "python":
      case "py":
        return {
          command: `${settings.pythonExecutable.trim() || "python3"} {file}`,
          extension: ".py"
        };
      case "javascript":
      case "js":
        return {
          command: `${settings.nodeExecutable.trim() || "node"} {file}`,
          extension: ".js"
        };
      case "typescript":
      case "ts":
        return {
          command: `${settings.typescriptTranspilerExecutable.trim() || "ts-node"} {file}`,
          extension: ".ts"
        };
      case "shell":
      case "sh":
      case "bash":
        return {
          command: `${settings.shellExecutable.trim() || "bash"} {file}`,
          extension: ".sh"
        };
      case "ruby":
      case "rb":
        return {
          command: `${settings.rubyExecutable.trim() || "ruby"} {file}`,
          extension: ".rb"
        };
      case "perl":
      case "pl":
        return {
          command: `${settings.perlExecutable.trim() || "perl"} {file}`,
          extension: ".pl"
        };
      case "lua":
        return {
          command: `${settings.luaExecutable.trim() || "lua"} {file}`,
          extension: ".lua"
        };
      case "php":
        return {
          command: `${settings.phpExecutable.trim() || "php"} {file}`,
          extension: ".php"
        };
      case "go":
        return {
          command: `${settings.goExecutable.trim() || "go"} run {file}`,
          extension: ".go"
        };
      case "haskell":
      case "hs":
        return {
          command: `${settings.haskellExecutable.trim() || "runghc"} {file}`,
          extension: ".hs"
        };
      case "ocaml":
      case "ml":
        if (settings.ocamlMode === "dune") {
          return {
            command: `${settings.ocamlExecutable.trim() || "dune"} exec -- ocaml {file}`,
            extension: ".ml"
          };
        }
        if (settings.ocamlMode === "ocamlc") {
          return {
            command: shellCommand(`${settings.ocamlExecutable.trim() || "ocamlc"} -o /tmp/loom-ocaml "$1" && /tmp/loom-ocaml`),
            extension: ".ml"
          };
        }
        return {
          command: `${settings.ocamlExecutable.trim() || "ocaml"} {file}`,
          extension: ".ml"
        };
      case "c":
        return {
          command: shellCommand(`${settings.cExecutable.trim() || "gcc"} "$1" -o /tmp/loom-c && /tmp/loom-c`),
          extension: ".c"
        };
      case "cpp":
      case "c++":
        return {
          command: shellCommand(`${settings.cppExecutable.trim() || "g++"} "$1" -o /tmp/loom-cpp && /tmp/loom-cpp`),
          extension: ".cpp"
        };
      case "rust":
      case "rs":
        return {
          command: shellCommand(`${settings.rustExecutable.trim() || "rustc"} "$1" -o /tmp/loom-rust && /tmp/loom-rust`),
          extension: ".rs"
        };
      case "java": {
        const compiler = settings.javaCompilerExecutable.trim() || "javac";
        return {
          command: shellCommand(`tmp=/tmp/loom-java-$$ && mkdir -p "$tmp" && cp "$1" "$tmp/Main.java" && ${compiler} "$tmp/Main.java" && ${settings.javaExecutable.trim() || "java"} -cp "$tmp" Main`),
          extension: ".java"
        };
      }
      case "llvm-ir":
      case "llvm":
      case "ll":
        return {
          command: `${settings.llvmInterpreterExecutable.trim() || "lli"} {file}`,
          extension: ".ll"
        };
      case "lean":
        return {
          command: `${settings.leanExecutable.trim() || "lean"} {file}`,
          extension: ".lean"
        };
      case "coq":
        return {
          command: `${settings.coqExecutable.trim() || "coqc"} -q {file}`,
          extension: ".v"
        };
      case "smtlib":
      case "smt":
      case "smt-lib":
        return {
          command: `${settings.smtExecutable.trim() || "z3"} {file}`,
          extension: ".smt2"
        };
    }
    return null;
  }
};
function shellCommand(command) {
  return `sh -lc ${quoteCommandArg(command)} sh {file}`;
}
function normalizeExtension(extension) {
  const trimmed = extension.trim();
  return trimmed.startsWith(".") ? trimmed : `.${trimmed}`;
}
function optionalString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : void 0;
}
function optionalPositiveInteger(value, label) {
  if (value == null) {
    return void 0;
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return value;
}
function optionalNonNegativeInteger(value, label) {
  if (value == null) {
    return void 0;
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer.`);
  }
  return value;
}
function optionalSignal(value, label) {
  if (value == null) {
    return void 0;
  }
  if (typeof value !== "string" || !/^SIG[A-Z0-9]+$/.test(value)) {
    throw new Error(`${label} must be a signal name like SIGTERM.`);
  }
  return value;
}
async function sleepWithSignal(durationMs, signal) {
  if (durationMs <= 0 || signal.aborted) {
    return;
  }
  await new Promise((resolve) => {
    const timeout = setTimeout(resolve, durationMs);
    const abort = () => {
      clearTimeout(timeout);
      resolve();
    };
    signal.addEventListener("abort", abort, { once: true });
  });
}
function runtimeLabel(runtime) {
  switch (runtime) {
    case "docker":
      return "Docker";
    case "podman":
      return "Podman";
    case "qemu":
      return "QEMU";
    case "custom":
      return "Custom";
    case "wsl":
      return "WSL";
  }
}
function shellQuote(value) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
function quoteCommandArg(value) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

// src/llvmHighlight.ts
var import_view = require("@codemirror/view");
var LLVM_KEYWORDS = new Map([
  ...mapWords("loom-llvm-keyword-control", [
    "ret",
    "br",
    "switch",
    "indirectbr",
    "invoke",
    "callbr",
    "resume",
    "unreachable",
    "cleanupret",
    "catchret",
    "catchswitch"
  ]),
  ...mapWords("loom-llvm-keyword-declaration", [
    "define",
    "declare",
    "type",
    "global",
    "constant",
    "alias",
    "ifunc",
    "comdat",
    "attributes",
    "section",
    "gc",
    "prefix",
    "prologue",
    "personality",
    "uselistorder",
    "uselistorder_bb",
    "module",
    "asm",
    "source_filename",
    "target"
  ]),
  ...mapWords("loom-llvm-keyword-memory", [
    "alloca",
    "load",
    "store",
    "getelementptr",
    "fence",
    "cmpxchg",
    "atomicrmw",
    "extractvalue",
    "insertvalue",
    "extractelement",
    "insertelement",
    "shufflevector"
  ]),
  ...mapWords("loom-llvm-keyword-arithmetic", [
    "add",
    "sub",
    "mul",
    "udiv",
    "sdiv",
    "urem",
    "srem",
    "shl",
    "lshr",
    "ashr",
    "and",
    "or",
    "xor",
    "fneg",
    "fadd",
    "fsub",
    "fmul",
    "fdiv",
    "frem"
  ]),
  ...mapWords("loom-llvm-keyword-comparison", ["icmp", "fcmp"]),
  ...mapWords("loom-llvm-keyword-cast", [
    "trunc",
    "zext",
    "sext",
    "fptrunc",
    "fpext",
    "fptoui",
    "fptosi",
    "uitofp",
    "sitofp",
    "ptrtoint",
    "inttoptr",
    "bitcast",
    "addrspacecast"
  ]),
  ...mapWords("loom-llvm-keyword-other", ["phi", "select", "freeze", "call", "landingpad", "catchpad", "cleanuppad", "va_arg"]),
  ...mapWords("loom-llvm-keyword-modifier", [
    "private",
    "internal",
    "available_externally",
    "linkonce",
    "weak",
    "common",
    "appending",
    "extern_weak",
    "linkonce_odr",
    "weak_odr",
    "external",
    "default",
    "hidden",
    "protected",
    "dllimport",
    "dllexport",
    "dso_local",
    "dso_preemptable",
    "externally_initialized",
    "thread_local",
    "localdynamic",
    "initialexec",
    "localexec",
    "unnamed_addr",
    "local_unnamed_addr",
    "atomic",
    "unordered",
    "monotonic",
    "acquire",
    "release",
    "acq_rel",
    "seq_cst",
    "syncscope",
    "volatile",
    "singlethread",
    "ccc",
    "fastcc",
    "coldcc",
    "webkit_jscc",
    "anyregcc",
    "preserve_mostcc",
    "preserve_allcc",
    "cxx_fast_tlscc",
    "swiftcc",
    "tailcc",
    "cfguard_checkcc",
    "tail",
    "musttail",
    "notail",
    "fast",
    "nnan",
    "ninf",
    "nsz",
    "arcp",
    "contract",
    "afn",
    "reassoc",
    "nuw",
    "nsw",
    "exact",
    "inbounds",
    "to",
    "x"
  ]),
  ...mapWords("loom-llvm-predicate", [
    "eq",
    "ne",
    "ugt",
    "uge",
    "ult",
    "ule",
    "sgt",
    "sge",
    "slt",
    "sle",
    "oeq",
    "ogt",
    "oge",
    "olt",
    "ole",
    "one",
    "ord",
    "ueq",
    "une",
    "uno"
  ]),
  ...mapWords("loom-llvm-attribute", [
    "alwaysinline",
    "argmemonly",
    "builtin",
    "byref",
    "byval",
    "cold",
    "convergent",
    "dereferenceable",
    "dereferenceable_or_null",
    "distinct",
    "immarg",
    "inalloca",
    "inreg",
    "mustprogress",
    "nest",
    "noalias",
    "nocallback",
    "nocapture",
    "nofree",
    "noinline",
    "nonlazybind",
    "nonnull",
    "norecurse",
    "noredzone",
    "noreturn",
    "nosync",
    "nounwind",
    "null_pointer_is_valid",
    "opaque",
    "optnone",
    "optsize",
    "preallocated",
    "readnone",
    "readonly",
    "returned",
    "returns_twice",
    "sanitize_address",
    "sanitize_hwaddress",
    "sanitize_memory",
    "sanitize_thread",
    "signext",
    "speculatable",
    "sret",
    "ssp",
    "sspreq",
    "sspstrong",
    "swiftasync",
    "swiftself",
    "swifterror",
    "uwtable",
    "willreturn",
    "writeonly",
    "zeroext"
  ]),
  ...mapWords("loom-llvm-constant", ["true", "false", "null", "none", "undef", "poison", "zeroinitializer"])
]);
var LLVM_PRIMITIVE_TYPES = /* @__PURE__ */ new Set([
  "void",
  "label",
  "token",
  "metadata",
  "x86_mmx",
  "x86_amx",
  "half",
  "bfloat",
  "float",
  "double",
  "fp128",
  "x86_fp80",
  "ppc_fp128",
  "ptr"
]);
var PUNCTUATION_CLASS = "loom-llvm-punctuation";
function highlightLlvmElement(codeElement, source) {
  codeElement.empty();
  codeElement.addClass("loom-llvm-code");
  const lines = source.split("\n");
  lines.forEach((line, index) => {
    appendHighlightedLine(codeElement, line);
    if (index < lines.length - 1) {
      codeElement.appendText("\n");
    }
  });
}
function addLlvmDecorations(builder, view, block) {
  const contentLineCount = getContentLineCount(block);
  if (!contentLineCount) {
    return;
  }
  const lines = block.content.split("\n");
  for (let index = 0; index < contentLineCount; index += 1) {
    const line = lines[index] ?? "";
    const tokens = tokenizeLlvmLine(line);
    if (!tokens.length) {
      continue;
    }
    const docLine = view.state.doc.line(block.startLine + 2 + index);
    for (const token of tokens) {
      if (token.from === token.to) {
        continue;
      }
      builder.add(
        docLine.from + token.from,
        docLine.from + token.to,
        import_view.Decoration.mark({ class: token.className })
      );
    }
  }
}
function appendHighlightedLine(container, line) {
  let cursor = 0;
  for (const token of tokenizeLlvmLine(line)) {
    if (token.from > cursor) {
      container.appendText(line.slice(cursor, token.from));
    }
    const span = container.createSpan({ cls: token.className });
    span.setText(line.slice(token.from, token.to));
    cursor = token.to;
  }
  if (cursor < line.length) {
    container.appendText(line.slice(cursor));
  }
}
function tokenizeLlvmLine(line) {
  const tokens = [];
  let index = 0;
  addLabelToken(line, tokens);
  while (index < line.length) {
    const current = line[index];
    if (current === ";") {
      tokens.push({ from: index, to: line.length, className: "loom-llvm-comment" });
      break;
    }
    if (/\s/.test(current)) {
      index += 1;
      continue;
    }
    const stringToken = readStringToken(line, index);
    if (stringToken) {
      if (stringToken.prefixEnd > index) {
        tokens.push({ from: index, to: stringToken.prefixEnd, className: "loom-llvm-string-prefix" });
      }
      tokens.push({ from: stringToken.valueStart, to: stringToken.valueEnd, className: "loom-llvm-string" });
      index = stringToken.valueEnd;
      continue;
    }
    const matched = matchRegexToken(line, index, /@llvm\.[A-Za-z$._0-9]+/y, "loom-llvm-intrinsic", tokens) || matchRegexToken(line, index, /@[A-Za-z$._-][A-Za-z$._0-9-]*|@\d+\b/y, "loom-llvm-global", tokens) || matchRegexToken(line, index, /%[A-Za-z$._-][A-Za-z$._0-9-]*|%\d+\b/y, "loom-llvm-local", tokens) || matchRegexToken(line, index, /![A-Za-z$._-][A-Za-z$._0-9-]*|!\d+\b/y, "loom-llvm-metadata", tokens) || matchRegexToken(line, index, /\$[A-Za-z$._-][A-Za-z$._0-9-]*/y, "loom-llvm-comdat", tokens) || matchRegexToken(line, index, /#\d+\b/y, "loom-llvm-attribute-group", tokens) || matchRegexToken(line, index, /\baddrspace\s*\(\s*\d+\s*\)/y, "loom-llvm-type", tokens) || matchRegexToken(line, index, /[-+]?0x[0-9A-Fa-f]+\b/y, "loom-llvm-number", tokens) || matchRegexToken(line, index, /[-+]?(?:\d+\.\d*|\.\d+|\d+)(?:[eE][-+]?\d+)\b/y, "loom-llvm-number", tokens) || matchRegexToken(line, index, /[-+]?(?:\d+\.\d*|\.\d+)\b/y, "loom-llvm-number", tokens) || matchRegexToken(line, index, /[-+]?\d+\b/y, "loom-llvm-number", tokens) || matchRegexToken(line, index, /\.\.\./y, "loom-llvm-punctuation", tokens);
    if (matched) {
      index = matched;
      continue;
    }
    const word = readWord(line, index);
    if (word) {
      tokens.push({
        from: index,
        to: word.end,
        className: classifyWord(word.value)
      });
      index = word.end;
      continue;
    }
    if ("()[]{}<>,:=*".includes(current)) {
      tokens.push({ from: index, to: index + 1, className: PUNCTUATION_CLASS });
      index += 1;
      continue;
    }
    index += 1;
  }
  return normalizeTokens(tokens);
}
function addLabelToken(line, tokens) {
  const match = line.match(/^(\s*)(?:([A-Za-z$._-][A-Za-z$._0-9-]*|\d+)|(%[A-Za-z$._-][A-Za-z$._0-9-]*|%\d+))(:)/);
  if (!match || match.index == null) {
    return;
  }
  const labelStart = match[1].length;
  const labelText = match[2] ?? match[3];
  if (!labelText) {
    return;
  }
  tokens.push({
    from: labelStart,
    to: labelStart + labelText.length,
    className: "loom-llvm-label"
  });
  tokens.push({
    from: labelStart + labelText.length,
    to: labelStart + labelText.length + 1,
    className: PUNCTUATION_CLASS
  });
}
function classifyWord(word) {
  if (/^i\d+$/.test(word) || LLVM_PRIMITIVE_TYPES.has(word)) {
    return "loom-llvm-type";
  }
  return LLVM_KEYWORDS.get(word) ?? "loom-llvm-plain";
}
function readWord(line, index) {
  const match = /[A-Za-z_][A-Za-z0-9_.-]*/y;
  match.lastIndex = index;
  const result = match.exec(line);
  if (!result) {
    return null;
  }
  return {
    value: result[0],
    end: match.lastIndex
  };
}
function readStringToken(line, index) {
  let cursor = index;
  if (line[cursor] === "c" && line[cursor + 1] === '"') {
    cursor += 1;
  }
  if (line[cursor] !== '"') {
    return null;
  }
  const valueStart = cursor;
  cursor += 1;
  while (cursor < line.length) {
    if (line[cursor] === "\\") {
      cursor += 2;
      continue;
    }
    if (line[cursor] === '"') {
      cursor += 1;
      break;
    }
    cursor += 1;
  }
  return {
    prefixEnd: valueStart,
    valueStart,
    valueEnd: cursor
  };
}
function matchRegexToken(line, index, regex, className, tokens) {
  regex.lastIndex = index;
  const match = regex.exec(line);
  if (!match) {
    return null;
  }
  tokens.push({ from: index, to: regex.lastIndex, className });
  return regex.lastIndex;
}
function normalizeTokens(tokens) {
  tokens.sort((left, right) => left.from - right.from || left.to - right.to);
  const normalized = [];
  let cursor = 0;
  for (const token of tokens) {
    if (token.to <= cursor) {
      continue;
    }
    const from = Math.max(token.from, cursor);
    normalized.push({ ...token, from });
    cursor = token.to;
  }
  return normalized;
}
function getContentLineCount(block) {
  if (block.endLine === block.startLine) {
    return 0;
  }
  if (block.content.length === 0) {
    return block.endLine > block.startLine + 1 ? 1 : 0;
  }
  return block.content.split("\n").length;
}
function mapWords(className, words) {
  return words.map((word) => [word, className]);
}

// src/utils/hash.ts
var import_crypto = require("crypto");
function shortHash(input) {
  return (0, import_crypto.createHash)("sha256").update(input).digest("hex").slice(0, 16);
}

// src/parser.ts
var LANGUAGE_ALIASES = {
  python: "python",
  py: "python",
  javascript: "javascript",
  js: "javascript",
  typescript: "typescript",
  ts: "typescript",
  ocaml: "ocaml",
  ml: "ocaml",
  c: "c",
  h: "c",
  cpp: "cpp",
  cxx: "cpp",
  cc: "cpp",
  "c++": "cpp",
  shell: "shell",
  sh: "shell",
  bash: "shell",
  zsh: "shell",
  ruby: "ruby",
  rb: "ruby",
  perl: "perl",
  pl: "perl",
  lua: "lua",
  php: "php",
  go: "go",
  golang: "go",
  rust: "rust",
  rs: "rust",
  haskell: "haskell",
  hs: "haskell",
  java: "java",
  llvm: "llvm-ir",
  llvmir: "llvm-ir",
  "llvm-ir": "llvm-ir",
  ll: "llvm-ir",
  lean: "lean",
  lean4: "lean",
  coq: "coq",
  v: "coq",
  smt: "smtlib",
  smt2: "smtlib",
  smtlib: "smtlib",
  "smt-lib": "smtlib",
  z3: "smtlib"
};
var OUTPUT_START = /^<!--\s*loom:output:start\s+id=([a-f0-9]+)\s*-->$/i;
var OUTPUT_END = /^<!--\s*loom:output:end\s*-->$/i;
var FENCE_START = /^(```+|~~~+)\s*([^\s`]*)?.*$/;
function normalizeLanguage(rawLanguage, settings) {
  const normalized = rawLanguage.trim().toLowerCase();
  for (const language of settings?.customLanguages ?? []) {
    const name = language.name.trim().toLowerCase();
    const aliases = parseAliasList(language.aliases);
    if (name && (name === normalized || aliases.includes(normalized))) {
      return language.name.trim();
    }
  }
  return LANGUAGE_ALIASES[normalized] ?? null;
}
function getSupportedLanguageAliases(settings) {
  return [
    ...Object.keys(LANGUAGE_ALIASES),
    ...(settings?.customLanguages ?? []).flatMap((language) => [language.name, ...parseAliasList(language.aliases)])
  ].map((alias) => alias.toLowerCase());
}
function parseMarkdownCodeBlocks(filePath, source, settings) {
  const lines = source.split(/\r?\n/);
  const blocks = [];
  let ordinal = 0;
  let insideManagedOutput = false;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (insideManagedOutput) {
      if (OUTPUT_END.test(line.trim())) {
        insideManagedOutput = false;
      }
      continue;
    }
    if (OUTPUT_START.test(line.trim())) {
      insideManagedOutput = true;
      continue;
    }
    const fenceMatch = line.match(FENCE_START);
    if (!fenceMatch) {
      continue;
    }
    const startLine = i;
    const fenceIndent = getLeadingWhitespace2(line);
    const fenceToken = fenceMatch[1];
    const sourceLanguage = (fenceMatch[2] ?? "").trim();
    const language = normalizeLanguage(sourceLanguage, settings);
    let endLine = i;
    const contentLines = [];
    for (let j = i + 1; j < lines.length; j += 1) {
      const innerLine = lines[j];
      const trimmed = innerLine.trim();
      if (trimmed.startsWith(fenceToken) && /^(```+|~~~+)\s*$/.test(trimmed)) {
        endLine = j;
        i = j;
        break;
      }
      contentLines.push(stripFenceIndent(innerLine, fenceIndent));
      endLine = j;
    }
    if (!language) {
      continue;
    }
    ordinal += 1;
    const content = contentLines.join("\n");
    const contentHash = shortHash(content);
    const id = shortHash(`${filePath}:${ordinal}:${language}:${contentHash}`);
    blocks.push({
      id,
      ordinal,
      filePath,
      language,
      languageAlias: sourceLanguage.toLowerCase(),
      sourceLanguage,
      content,
      startLine,
      endLine,
      fenceStart: 0,
      fenceEnd: 0
    });
  }
  return blocks;
}
function parseAliasList(value) {
  return value.split(",").map((alias) => alias.trim().toLowerCase()).filter(Boolean);
}
function findBlockAtLine(blocks, line) {
  return blocks.find((block) => line >= block.startLine && line <= block.endLine) ?? null;
}
function getLeadingWhitespace2(line) {
  const match = line.match(/^[\t ]*/);
  return match?.[0] ?? "";
}
function stripFenceIndent(line, fenceIndent) {
  if (!fenceIndent) {
    return line;
  }
  let index = 0;
  while (index < fenceIndent.length && index < line.length && line[index] === fenceIndent[index]) {
    index += 1;
  }
  return line.slice(index);
}

// src/runners/node.ts
var NodeRunner = class {
  constructor() {
    this.id = "node";
    this.displayName = "Node.js";
    this.languages = ["javascript", "typescript"];
  }
  canRun(block, settings) {
    if (block.language === "javascript") {
      return Boolean(settings.nodeExecutable.trim());
    }
    return Boolean(settings.typescriptTranspilerExecutable.trim());
  }
  async run(block, context, settings) {
    if (block.language === "javascript") {
      return runTempFileProcess({
        runnerId: this.id,
        runnerName: this.displayName,
        executable: settings.nodeExecutable.trim(),
        args: ["{file}"],
        fileExtension: ".js",
        source: block.content,
        workingDirectory: context.workingDirectory,
        timeoutMs: context.timeoutMs,
        signal: context.signal
      });
    }
    const executable = settings.typescriptTranspilerExecutable.trim();
    const runnerName = settings.typescriptMode === "tsx" ? "TypeScript (tsx)" : "TypeScript (ts-node)";
    return runTempFileProcess({
      runnerId: `${this.id}:${settings.typescriptMode}`,
      runnerName,
      executable,
      args: ["{file}"],
      fileExtension: ".ts",
      source: block.content,
      workingDirectory: context.workingDirectory,
      timeoutMs: context.timeoutMs,
      signal: context.signal
    });
  }
};

// src/runners/custom.ts
var CustomLanguageRunner = class {
  constructor() {
    this.id = "custom";
    this.displayName = "Custom language";
    this.languages = [];
  }
  canRun(block, settings) {
    return Boolean(this.getCustomLanguage(block, settings)?.executable.trim());
  }
  run(block, context, settings) {
    const language = this.getCustomLanguage(block, settings);
    if (!language) {
      throw new Error(`Unsupported custom language: ${block.language}`);
    }
    return runTempFileProcess({
      runnerId: `${this.id}:${language.name}`,
      runnerName: language.name,
      executable: language.executable.trim(),
      args: splitCommandLine(language.args || "{file}"),
      fileExtension: normalizeExtension2(language.extension, language.name),
      source: block.content,
      workingDirectory: context.workingDirectory,
      timeoutMs: context.timeoutMs,
      signal: context.signal
    });
  }
  getCustomLanguage(block, settings) {
    const normalized = block.language.trim().toLowerCase();
    return settings.customLanguages.find((language) => {
      const name = language.name.trim().toLowerCase();
      const aliases = language.aliases.split(",").map((alias) => alias.trim().toLowerCase()).filter(Boolean);
      return name === normalized || aliases.includes(normalized);
    });
  }
};
function normalizeExtension2(extension, name) {
  const trimmed = extension.trim();
  if (!trimmed) {
    return `.${name}`;
  }
  return trimmed.startsWith(".") ? trimmed : `.${trimmed}`;
}

// src/runners/interpreted.ts
var INTERPRETED_SPECS = [
  {
    language: "shell",
    displayName: "Shell",
    executable: (settings) => settings.shellExecutable,
    fileExtension: ".sh"
  },
  {
    language: "ruby",
    displayName: "Ruby",
    executable: (settings) => settings.rubyExecutable,
    fileExtension: ".rb"
  },
  {
    language: "perl",
    displayName: "Perl",
    executable: (settings) => settings.perlExecutable,
    fileExtension: ".pl"
  },
  {
    language: "lua",
    displayName: "Lua",
    executable: (settings) => settings.luaExecutable,
    fileExtension: ".lua"
  },
  {
    language: "php",
    displayName: "PHP",
    executable: (settings) => settings.phpExecutable,
    fileExtension: ".php"
  },
  {
    language: "go",
    displayName: "Go",
    executable: (settings) => settings.goExecutable,
    fileExtension: ".go",
    args: ["run", "{file}"],
    env: {
      GOCACHE: "{tempDir}/gocache"
    },
    minimumTimeoutMs: 3e4
  },
  {
    language: "haskell",
    displayName: "Haskell",
    executable: (settings) => settings.haskellExecutable,
    fileExtension: ".hs",
    minimumTimeoutMs: 3e4
  }
];
var InterpretedRunner = class {
  constructor() {
    this.id = "interpreted";
    this.displayName = "Interpreted";
    this.languages = INTERPRETED_SPECS.map((spec) => spec.language);
  }
  canRun(block, settings) {
    const spec = this.getSpec(block.language);
    return Boolean(spec?.executable(settings).trim());
  }
  run(block, context, settings) {
    const spec = this.getSpec(block.language);
    if (!spec) {
      throw new Error(`Unsupported language: ${block.language}`);
    }
    return runTempFileProcess({
      runnerId: `${this.id}:${block.language}`,
      runnerName: spec.displayName,
      executable: spec.executable(settings).trim(),
      args: spec.args ?? ["{file}"],
      fileExtension: spec.fileExtension,
      source: block.content,
      workingDirectory: context.workingDirectory,
      timeoutMs: Math.max(context.timeoutMs, spec.minimumTimeoutMs ?? 0),
      signal: context.signal,
      env: spec.env
    });
  }
  getSpec(language) {
    return INTERPRETED_SPECS.find((spec) => spec.language === language);
  }
};

// src/runners/llvm.ts
var LlvmRunner = class {
  constructor() {
    this.id = "llvm-ir";
    this.displayName = "LLVM IR";
    this.languages = ["llvm-ir"];
  }
  canRun(block, settings) {
    return block.language === "llvm-ir" && Boolean(settings.llvmInterpreterExecutable.trim());
  }
  async run(block, context, settings) {
    const result = await runTempFileProcess({
      runnerId: this.id,
      runnerName: this.displayName,
      executable: settings.llvmInterpreterExecutable.trim(),
      args: ["{file}"],
      fileExtension: ".ll",
      source: block.content,
      workingDirectory: context.workingDirectory,
      timeoutMs: Math.max(context.timeoutMs, 3e4),
      signal: context.signal
    });
    if (!result.timedOut && !result.cancelled && result.exitCode != null && !result.stderr.trim()) {
      if (result.exitCode !== 0) {
        result.success = true;
        result.warning = `Program returned i32 ${result.exitCode}. Under lli, that becomes the process exit status.`;
      }
      if (!result.stdout.trim()) {
        result.stdout = result.exitCode === 0 ? "LLVM program exited with code 0." : `LLVM program returned i32 ${result.exitCode}.
Use stdout in the IR itself if you want printable program output.`;
      }
    }
    return result;
  }
};

// src/runners/managedCompiled.ts
var import_path3 = require("path");
var ManagedCompiledRunner = class {
  constructor() {
    this.id = "managed-compiled";
    this.displayName = "Managed compiler";
    this.languages = ["rust", "java"];
  }
  canRun(block, settings) {
    if (block.language === "rust") {
      return Boolean(settings.rustExecutable.trim());
    }
    if (block.language === "java") {
      return Boolean(settings.javaExecutable.trim());
    }
    return false;
  }
  async run(block, context, settings) {
    if (block.language === "rust") {
      return this.runRust(block, context, settings);
    }
    if (block.language === "java") {
      return this.runJava(block, context, settings);
    }
    throw new Error(`Unsupported language: ${block.language}`);
  }
  async runRust(block, context, settings) {
    return withTempSourceFile(".rs", block.content, async ({ tempDir, tempFile }) => {
      const binaryPath = (0, import_path3.join)(tempDir, "snippet.out");
      const compileResult = await runProcess({
        runnerId: `${this.id}:rust:compile`,
        runnerName: "Rust",
        executable: settings.rustExecutable.trim(),
        args: [tempFile, "-o", binaryPath],
        workingDirectory: context.workingDirectory,
        timeoutMs: Math.max(context.timeoutMs, 3e4),
        signal: context.signal
      });
      if (!compileResult.success) {
        return compileResult;
      }
      return runProcess({
        runnerId: `${this.id}:rust:run`,
        runnerName: "Rust",
        executable: binaryPath,
        args: [],
        workingDirectory: context.workingDirectory,
        timeoutMs: Math.max(context.timeoutMs, 3e4),
        signal: context.signal
      });
    });
  }
  async runJava(block, context, settings) {
    return withNamedTempSourceFile("Main.java", block.content, async ({ tempDir, tempFile }) => {
      if (!settings.javaCompilerExecutable.trim()) {
        return runProcess({
          runnerId: `${this.id}:java:source`,
          runnerName: "Java",
          executable: settings.javaExecutable.trim(),
          args: [tempFile],
          workingDirectory: context.workingDirectory,
          timeoutMs: Math.max(context.timeoutMs, 3e4),
          signal: context.signal
        });
      }
      const compileResult = await runProcess({
        runnerId: `${this.id}:java:compile`,
        runnerName: "Java",
        executable: settings.javaCompilerExecutable.trim(),
        args: [tempFile],
        workingDirectory: tempDir,
        timeoutMs: Math.max(context.timeoutMs, 3e4),
        signal: context.signal
      });
      if (!compileResult.success) {
        return compileResult;
      }
      return runProcess({
        runnerId: `${this.id}:java:run`,
        runnerName: "Java",
        executable: settings.javaExecutable.trim(),
        args: ["-cp", tempDir, "Main"],
        workingDirectory: context.workingDirectory,
        timeoutMs: Math.max(context.timeoutMs, 3e4),
        signal: context.signal
      });
    });
  }
};

// src/runners/nativeCompiled.ts
var import_path4 = require("path");
var NativeCompiledRunner = class {
  constructor() {
    this.id = "native-compiled";
    this.displayName = "Native compiler";
    this.languages = ["c", "cpp"];
  }
  canRun(block, settings) {
    if (block.language === "c") {
      return Boolean(settings.cExecutable.trim());
    }
    if (block.language === "cpp") {
      return Boolean(settings.cppExecutable.trim());
    }
    return false;
  }
  async run(block, context, settings) {
    const executable = block.language === "c" ? settings.cExecutable.trim() : settings.cppExecutable.trim();
    const fileExtension = block.language === "c" ? ".c" : ".cpp";
    const runnerName = block.language === "c" ? "C (GCC)" : "C++ (G++)";
    return withTempSourceFile(fileExtension, block.content, async ({ tempDir, tempFile }) => {
      const binaryPath = (0, import_path4.join)(tempDir, "snippet.out");
      const compileResult = await runProcess({
        runnerId: `${this.id}:${block.language}:compile`,
        runnerName,
        executable,
        args: [tempFile, "-o", binaryPath],
        workingDirectory: context.workingDirectory,
        timeoutMs: Math.max(context.timeoutMs, 3e4),
        signal: context.signal
      });
      if (!compileResult.success) {
        return compileResult;
      }
      return runProcess({
        runnerId: `${this.id}:${block.language}:run`,
        runnerName,
        executable: binaryPath,
        args: [],
        workingDirectory: context.workingDirectory,
        timeoutMs: Math.max(context.timeoutMs, 3e4),
        signal: context.signal
      });
    });
  }
};

// src/runners/ocaml.ts
var import_path5 = require("path");
var OcamlRunner = class {
  constructor() {
    this.id = "ocaml";
    this.displayName = "OCaml";
    this.languages = ["ocaml"];
  }
  canRun(block, settings) {
    return block.language === "ocaml" && Boolean(settings.ocamlExecutable.trim());
  }
  async run(block, context, settings) {
    const mode = settings.ocamlMode;
    const executable = settings.ocamlExecutable.trim();
    if (mode === "ocaml") {
      return runTempFileProcess({
        runnerId: `${this.id}:ocaml`,
        runnerName: "OCaml",
        executable,
        args: ["{file}"],
        fileExtension: ".ml",
        source: block.content,
        workingDirectory: context.workingDirectory,
        timeoutMs: context.timeoutMs,
        signal: context.signal
      });
    }
    if (mode === "dune") {
      return runTempFileProcess({
        runnerId: `${this.id}:dune`,
        runnerName: "Dune / OCaml",
        executable,
        args: ["exec", "--", "ocaml", "{file}"],
        fileExtension: ".ml",
        source: block.content,
        workingDirectory: context.workingDirectory,
        timeoutMs: context.timeoutMs,
        signal: context.signal
      });
    }
    return withTempSourceFile(".ml", block.content, async ({ tempDir, tempFile }) => {
      const binaryPath = (0, import_path5.join)(tempDir, "snippet.out");
      const compileResult = await runProcess({
        runnerId: `${this.id}:ocamlc-compile`,
        runnerName: "OCamlc",
        executable,
        args: ["-o", binaryPath, tempFile],
        workingDirectory: context.workingDirectory,
        timeoutMs: context.timeoutMs,
        signal: context.signal
      });
      if (!compileResult.success) {
        return compileResult;
      }
      return runProcess({
        runnerId: `${this.id}:ocamlc-run`,
        runnerName: "OCamlc",
        executable: binaryPath,
        args: [],
        workingDirectory: context.workingDirectory,
        timeoutMs: context.timeoutMs,
        signal: context.signal
      });
    });
  }
};

// src/runners/python.ts
var PythonRunner = class {
  constructor() {
    this.id = "python";
    this.displayName = "Python";
    this.languages = ["python"];
  }
  canRun(block, settings) {
    return block.language === "python" && Boolean(settings.pythonExecutable.trim());
  }
  run(block, context, settings) {
    return runTempFileProcess({
      runnerId: this.id,
      runnerName: this.displayName,
      executable: settings.pythonExecutable.trim(),
      args: ["{file}"],
      fileExtension: ".py",
      source: block.content,
      workingDirectory: context.workingDirectory,
      timeoutMs: context.timeoutMs,
      signal: context.signal
    });
  }
};

// src/runners/proof.ts
var import_fs2 = require("fs");
var import_path6 = require("path");
var ProofRunner = class {
  constructor() {
    this.id = "proof";
    this.displayName = "Proof checker";
    this.languages = ["lean", "coq", "smtlib"];
  }
  canRun(block, settings) {
    if (block.language === "lean") {
      return Boolean(settings.leanExecutable.trim());
    }
    if (block.language === "coq") {
      return Boolean(resolveCoqExecutable(settings).trim());
    }
    if (block.language === "smtlib") {
      return Boolean(settings.smtExecutable.trim());
    }
    return false;
  }
  run(block, context, settings) {
    if (block.language === "lean") {
      return runTempFileProcess({
        runnerId: `${this.id}:lean`,
        runnerName: "Lean",
        executable: settings.leanExecutable.trim(),
        args: ["{file}"],
        fileExtension: ".lean",
        source: block.content,
        workingDirectory: context.workingDirectory,
        timeoutMs: Math.max(context.timeoutMs, 3e4),
        signal: context.signal
      });
    }
    if (block.language === "coq") {
      return runTempFileProcess({
        runnerId: `${this.id}:coq`,
        runnerName: "Coq",
        executable: resolveCoqExecutable(settings),
        args: ["-q", "{file}"],
        fileExtension: ".v",
        source: block.content,
        workingDirectory: context.workingDirectory,
        timeoutMs: Math.max(context.timeoutMs, 3e4),
        signal: context.signal
      });
    }
    if (block.language === "smtlib") {
      return runTempFileProcess({
        runnerId: `${this.id}:smtlib`,
        runnerName: "SMT-LIB (Z3)",
        executable: settings.smtExecutable.trim(),
        args: ["{file}"],
        fileExtension: ".smt2",
        source: block.content,
        workingDirectory: context.workingDirectory,
        timeoutMs: Math.max(context.timeoutMs, 3e4),
        signal: context.signal
      });
    }
    throw new Error(`Unsupported proof language: ${block.language}`);
  }
};
function resolveCoqExecutable(settings) {
  const configured = settings.coqExecutable.trim();
  if (configured && configured !== "coqc") {
    return configured;
  }
  const opamCoqc = (0, import_path6.join)(process.env.HOME ?? "", ".opam", "default", "bin", "coqc");
  return (0, import_fs2.existsSync)(opamCoqc) ? opamCoqc : configured || "coqc";
}

// src/runners/registry.ts
var loomRunnerRegistry = class {
  constructor(runners) {
    this.runners = runners;
  }
  getRunnerForBlock(block, settings) {
    return this.runners.find((runner) => (!runner.languages.length || runner.languages.includes(block.language)) && runner.canRun(block, settings)) ?? null;
  }
  getSupportedLanguages() {
    return [...new Set(this.runners.flatMap((runner) => runner.languages))];
  }
};

// src/settings.ts
var import_obsidian2 = require("obsidian");
var DEFAULT_SETTINGS = {
  enableLocalExecution: false,
  hasAcknowledgedExecutionRisk: false,
  preserveSourceMode: true,
  defaultTimeoutMs: 8e3,
  workingDirectory: "",
  pythonExecutable: "python3",
  nodeExecutable: "node",
  typescriptMode: "ts-node",
  typescriptTranspilerExecutable: "ts-node",
  ocamlMode: "ocaml",
  ocamlExecutable: "ocaml",
  cExecutable: "gcc",
  cppExecutable: "g++",
  shellExecutable: "bash",
  rubyExecutable: "ruby",
  perlExecutable: "perl",
  luaExecutable: "lua",
  phpExecutable: "php",
  goExecutable: "go",
  rustExecutable: "rustc",
  haskellExecutable: "runghc",
  javaCompilerExecutable: "",
  javaExecutable: "java",
  llvmInterpreterExecutable: "lli",
  leanExecutable: "lean",
  coqExecutable: "coqc",
  smtExecutable: "z3",
  writeOutputToNote: false,
  autoRunOnFileOpen: false,
  customLanguages: [],
  pdfExportMode: "both",
  defaultContainerGroup: ""
};
var loomSettingTab = class extends import_obsidian2.PluginSettingTab {
  constructor(loomPlugin2) {
    super(loomPlugin2.app, loomPlugin2);
    this.loomPlugin = loomPlugin2;
  }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "loom" });
    containerEl.createEl("p", { text: "Run supported code fences directly from notes while preserving native syntax highlighting." });
    this.renderGeneralSettings(this.createSection(containerEl, "General Settings", true));
    this.renderBuiltInRuntimes(this.createSection(containerEl, "Built-in Runtimes"));
    this.renderCustomLanguages(this.createSection(containerEl, "Custom Languages"));
    void this.renderContainerGroups(this.createSection(containerEl, "Containerization Groups"));
  }
  createSection(containerEl, title, open = false) {
    const details = containerEl.createEl("details", { cls: "loom-settings-section" });
    details.open = open;
    details.createEl("summary", { text: title, cls: "loom-settings-summary" });
    return details.createDiv({ cls: "loom-settings-section-body" });
  }
  renderGeneralSettings(containerEl) {
    new import_obsidian2.Setting(containerEl).setName("Enable local execution").setDesc("Disabled by default. loom runs code on your local machine and does not provide sandboxing.").addToggle(
      (toggle) => toggle.setValue(this.loomPlugin.settings.enableLocalExecution).onChange(async (value) => {
        this.loomPlugin.settings.enableLocalExecution = value;
        if (value) {
          this.loomPlugin.settings.hasAcknowledgedExecutionRisk = true;
        }
        await this.loomPlugin.saveSettings();
      })
    );
    new import_obsidian2.Setting(containerEl).setName("Keep loom notes in source mode").setDesc("Preserve raw fenced code in the editor instead of letting live preview collapse research snippets.").addToggle(
      (toggle) => toggle.setValue(this.loomPlugin.settings.preserveSourceMode).onChange(async (value) => {
        this.loomPlugin.settings.preserveSourceMode = value;
        await this.loomPlugin.saveSettings();
        if (value) {
          void this.loomPlugin.enforceSourceModeForActiveView();
        } else {
          void this.loomPlugin.disableSourceModeForActiveView();
        }
      })
    );
    new import_obsidian2.Setting(containerEl).setName("Default timeout").setDesc("Maximum execution time in milliseconds before loom terminates the process.").addText(
      (text) => text.setPlaceholder("8000").setValue(String(this.loomPlugin.settings.defaultTimeoutMs)).onChange(async (value) => {
        const parsed = Number.parseInt(value, 10);
        if (!Number.isNaN(parsed) && parsed > 0) {
          this.loomPlugin.settings.defaultTimeoutMs = parsed;
          await this.loomPlugin.saveSettings();
        }
      })
    );
    new import_obsidian2.Setting(containerEl).setName("Working directory").setDesc("Optional. Empty uses the current note folder when possible, otherwise the vault root.").addText(
      (text) => text.setPlaceholder("Vault root").setValue(this.loomPlugin.settings.workingDirectory).onChange(async (value) => {
        this.loomPlugin.settings.workingDirectory = value.trim() ? (0, import_obsidian2.normalizePath)(value.trim()) : "";
        await this.loomPlugin.saveSettings();
      })
    );
    new import_obsidian2.Setting(containerEl).setName("Write output back to note").setDesc("Insert managed loom output sections beneath code blocks instead of keeping results purely in the UI.").addToggle(
      (toggle) => toggle.setValue(this.loomPlugin.settings.writeOutputToNote).onChange(async (value) => {
        this.loomPlugin.settings.writeOutputToNote = value;
        await this.loomPlugin.saveSettings();
      })
    );
    new import_obsidian2.Setting(containerEl).setName("Auto-run on file open").setDesc("Run all supported blocks in the active note when it opens. Disabled by default.").addToggle(
      (toggle) => toggle.setValue(this.loomPlugin.settings.autoRunOnFileOpen).onChange(async (value) => {
        this.loomPlugin.settings.autoRunOnFileOpen = value;
        await this.loomPlugin.saveSettings();
      })
    );
    new import_obsidian2.Setting(containerEl).setName("PDF export mode").setDesc("Choose what to include when exporting notes containing loom code blocks to PDF.").addDropdown(
      (dropdown) => dropdown.addOption("both", "Both Code and Output").addOption("code", "Code Block Only").addOption("output", "Output Only").setValue(this.loomPlugin.settings.pdfExportMode || "both").onChange(async (value) => {
        this.loomPlugin.settings.pdfExportMode = value;
        await this.loomPlugin.saveSettings();
      })
    );
  }
  renderBuiltInRuntimes(containerEl) {
    this.addTextSetting(containerEl, "Python executable", "Path or command name for Python.", "pythonExecutable");
    this.addTextSetting(containerEl, "Node executable", "Path or command name for JavaScript execution.", "nodeExecutable");
    new import_obsidian2.Setting(containerEl).setName("TypeScript runner mode").setDesc("Use ts-node or tsx for TypeScript blocks.").addDropdown(
      (dropdown) => dropdown.addOption("ts-node", "ts-node").addOption("tsx", "tsx").setValue(this.loomPlugin.settings.typescriptMode).onChange(async (value) => {
        this.loomPlugin.settings.typescriptMode = value;
        await this.loomPlugin.saveSettings();
      })
    );
    this.addTextSetting(containerEl, "TypeScript transpiler executable", "Command or path for ts-node or tsx.", "typescriptTranspilerExecutable");
    new import_obsidian2.Setting(containerEl).setName("OCaml mode").setDesc("Choose between the OCaml toplevel, ocamlc compilation, or dune exec.").addDropdown(
      (dropdown) => dropdown.addOption("ocaml", "ocaml").addOption("ocamlc", "ocamlc").addOption("dune", "dune").setValue(this.loomPlugin.settings.ocamlMode).onChange(async (value) => {
        this.loomPlugin.settings.ocamlMode = value;
        await this.loomPlugin.saveSettings();
      })
    );
    this.addTextSetting(containerEl, "OCaml executable", "Command or path for ocaml, ocamlc, or dune depending on the selected mode.", "ocamlExecutable");
    this.addTextSetting(containerEl, "C compiler", "Command or path for compiling C blocks.", "cExecutable");
    this.addTextSetting(containerEl, "C++ compiler", "Command or path for compiling C++ blocks.", "cppExecutable");
    this.addTextSetting(containerEl, "Shell executable", "Command or path for Shell, Bash, and sh blocks.", "shellExecutable");
    this.addTextSetting(containerEl, "Ruby executable", "Command or path for Ruby blocks.", "rubyExecutable");
    this.addTextSetting(containerEl, "Perl executable", "Command or path for Perl blocks.", "perlExecutable");
    this.addTextSetting(containerEl, "Lua executable", "Command or path for Lua blocks.", "luaExecutable");
    this.addTextSetting(containerEl, "PHP executable", "Command or path for PHP blocks.", "phpExecutable");
    this.addTextSetting(containerEl, "Go executable", "Command or path for Go blocks.", "goExecutable");
    this.addTextSetting(containerEl, "Rust compiler", "Command or path for compiling Rust blocks.", "rustExecutable");
    this.addTextSetting(containerEl, "Haskell executable", "Command or path for Haskell blocks. Defaults to runghc.", "haskellExecutable");
    this.addTextSetting(containerEl, "Java compiler", "Optional command or path for javac. Leave empty to use Java source-file mode.", "javaCompilerExecutable");
    this.addTextSetting(containerEl, "Java executable", "Command or path for running compiled Java blocks.", "javaExecutable");
    this.addTextSetting(containerEl, "LLVM IR interpreter", "Command or path for running LLVM IR blocks with lli.", "llvmInterpreterExecutable");
    this.addTextSetting(containerEl, "Lean executable", "Command or path for checking Lean blocks.", "leanExecutable");
    this.addTextSetting(containerEl, "Coq executable", "Command or path for checking Coq blocks with coqc.", "coqExecutable");
    this.addTextSetting(containerEl, "SMT solver", "Command or path for SMT-LIB blocks. Defaults to z3.", "smtExecutable");
  }
  renderCustomLanguages(containerEl) {
    const listEl = containerEl.createDiv({ cls: "loom-custom-language-list" });
    this.renderCustomLanguageList(listEl);
    new import_obsidian2.Setting(containerEl).setName("Add custom language").setDesc("Create a new local command-backed language.").addButton(
      (button) => button.setButtonText("+").onClick(async () => {
        this.loomPlugin.settings.customLanguages.push({
          name: "custom-language",
          aliases: "",
          executable: "",
          args: "{file}",
          extension: ".txt"
        });
        await this.loomPlugin.saveSettings();
        this.display();
      })
    );
  }
  renderCustomLanguageList(containerEl) {
    containerEl.empty();
    if (!this.loomPlugin.settings.customLanguages.length) {
      containerEl.createEl("p", {
        text: "No custom languages configured.",
        cls: "setting-item-description"
      });
      return;
    }
    this.loomPlugin.settings.customLanguages.forEach((language, index) => {
      const details = containerEl.createEl("details", { cls: "loom-custom-language" });
      details.open = true;
      details.createEl("summary", { text: language.name || `Custom language ${index + 1}` });
      const body = details.createDiv({ cls: "loom-custom-language-body" });
      this.addCustomLanguageTextSetting(body, language, "Name", "Normalized language id used by loom.", "name");
      this.addCustomLanguageTextSetting(body, language, "Aliases", "Comma-separated fence aliases.", "aliases");
      this.addCustomLanguageTextSetting(body, language, "Executable", "Local command or absolute executable path.", "executable");
      this.addCustomLanguageTextSetting(body, language, "Arguments", "Space-separated arguments. Use {file} for the temp source file.", "args");
      this.addCustomLanguageTextSetting(body, language, "Extension", "Temp source file extension, for example .py.", "extension");
      new import_obsidian2.Setting(body).setName("Delete language").setDesc("Remove this custom language.").addButton(
        (button) => button.setButtonText("Delete").setWarning().onClick(async () => {
          this.loomPlugin.settings.customLanguages.splice(index, 1);
          await this.loomPlugin.saveSettings();
          this.display();
        })
      );
    });
  }
  async renderContainerGroups(containerEl) {
    try {
      const groups = await this.loomPlugin.getContainerGroupSummaries();
      new import_obsidian2.Setting(containerEl).setName("Default containerization group").setDesc("The container group to run code blocks in by default if the note does not specify one.").addDropdown((dropdown) => {
        dropdown.addOption("", "None");
        for (const group of groups) {
          dropdown.addOption(group.name, group.name);
        }
        dropdown.setValue(this.loomPlugin.settings.defaultContainerGroup || "");
        dropdown.onChange(async (value) => {
          this.loomPlugin.settings.defaultContainerGroup = value;
          await this.loomPlugin.saveSettings();
        });
      });
      new import_obsidian2.Setting(containerEl).setName("Add new containerization group").setDesc("Create a new containerization group configuration folder.").addButton(
        (button) => button.setButtonText("+").onClick(() => {
          new ContainerGroupNameModal(this.app, async (groupName) => {
            const cleanName = groupName.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "-");
            if (!cleanName) {
              new import_obsidian2.Notice("Invalid group name.");
              return;
            }
            const pluginDir = this.loomPlugin.manifest.dir ?? ".obsidian/plugins/loom";
            const groupRelativePath = `${pluginDir}/containers/${cleanName}`;
            const configPath = `${groupRelativePath}/config.json`;
            const adapter = this.app.vault.adapter;
            if (await adapter.exists(groupRelativePath)) {
              new import_obsidian2.Notice("Container group folder already exists.");
              return;
            }
            await adapter.mkdir(groupRelativePath);
            const defaultConfig = {
              runtime: "docker",
              image: "ubuntu:latest",
              languages: {
                python: {
                  command: "python3 {file}",
                  extension: ".py"
                }
              }
            };
            await adapter.write(configPath, JSON.stringify(defaultConfig, null, 2));
            new import_obsidian2.Notice(`Container group "${cleanName}" created.`);
            this.display();
          }).open();
        })
      );
      const listEl = containerEl.createDiv({ cls: "loom-container-group-list" });
      if (!groups.length) {
        listEl.createEl("p", {
          text: "No container groups found in .obsidian/plugins/loom/containers.",
          cls: "setting-item-description"
        });
        return;
      }
      for (const group of groups) {
        new import_obsidian2.Setting(listEl).setName(group.name).setDesc(group.status).addButton(
          (button) => button.setButtonText("Build / rebuild").onClick(async () => {
            await this.loomPlugin.buildContainerGroup(group.name);
          })
        ).addButton(
          (button) => button.setButtonText("Edit").onClick(() => {
            const pluginDir = this.loomPlugin.manifest.dir ?? ".obsidian/plugins/loom";
            new EditContainerGroupModal(this.loomPlugin, group.name, pluginDir, () => {
              this.display();
            }).open();
          })
        );
      }
    } catch (error) {
      containerEl.empty();
      containerEl.createEl("p", {
        text: `Error loading container groups: ${error instanceof Error ? error.message : String(error)}`,
        cls: "loom-settings-error",
        attr: { style: "color: var(--text-error); font-weight: bold; margin: 1em 0;" }
      });
      console.error("loom: failed to render container groups:", error);
    }
  }
  addTextSetting(containerEl, name, description, key) {
    new import_obsidian2.Setting(containerEl).setName(name).setDesc(description).addText(
      (text) => text.setValue(String(this.loomPlugin.settings[key] ?? "")).onChange(async (value) => {
        this.loomPlugin.settings[key] = value.trim();
        await this.loomPlugin.saveSettings();
      })
    );
  }
  addCustomLanguageTextSetting(containerEl, language, name, description, key) {
    new import_obsidian2.Setting(containerEl).setName(name).setDesc(description).addText(
      (text) => text.setValue(language[key]).onChange(async (value) => {
        language[key] = value.trim();
        await this.loomPlugin.saveSettings();
      })
    );
  }
};
function showExecutionDisabledNotice() {
  new import_obsidian2.Notice("loom local execution is disabled. Enable it in settings or confirm the execution warning first.");
}
var ContainerGroupNameModal = class extends import_obsidian2.Modal {
  constructor(app, onSubmit) {
    super(app);
    this.onSubmit = onSubmit;
    this.name = "";
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: "New Container Group Name" });
    new import_obsidian2.Setting(contentEl).setName("Group Name").setDesc("Use lowercase letters, numbers, hyphens, and underscores.").addText(
      (text) => text.onChange((value) => {
        this.name = value;
      })
    );
    new import_obsidian2.Setting(contentEl).addButton(
      (btn) => btn.setButtonText("Create").setCta().onClick(async () => {
        await this.onSubmit(this.name);
        this.close();
      })
    );
  }
};
var EditContainerGroupModal = class extends import_obsidian2.Modal {
  constructor(loomPlugin2, groupName, pluginDir, onSave) {
    super(loomPlugin2.app);
    this.loomPlugin = loomPlugin2;
    this.groupName = groupName;
    this.pluginDir = pluginDir;
    this.onSave = onSave;
    this.activeTab = "general";
    this.configObj = {};
    this.rawJsonText = "";
    this.dockerfileText = null;
    this.newLanguageName = "";
  }
  async onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: `Edit Config: ${this.groupName}` });
    const configPath = `${this.pluginDir}/containers/${this.groupName}/config.json`;
    const dockerfilePath = `${this.pluginDir}/containers/${this.groupName}/Dockerfile`;
    const adapter = this.app.vault.adapter;
    try {
      const rawConfig = await adapter.read(configPath);
      this.configObj = JSON.parse(rawConfig);
      this.rawJsonText = rawConfig;
    } catch (e) {
      new import_obsidian2.Notice("Could not read configuration file.");
      this.close();
      return;
    }
    try {
      if (await adapter.exists(dockerfilePath)) {
        this.dockerfileText = await adapter.read(dockerfilePath);
      } else {
        this.dockerfileText = null;
      }
    } catch (e) {
      this.dockerfileText = null;
    }
    const container = contentEl.createDiv({ cls: "loom-tab-container" });
    this.tabHeaderEl = container.createDiv({ cls: "loom-tab-header" });
    this.renderTabs();
    this.tabContentEl = container.createDiv({ cls: "loom-tab-content" });
    const actions = contentEl.createDiv({ cls: "loom-modal-actions" });
    actions.createEl("button", { text: "Cancel" }).addEventListener("click", () => this.close());
    const saveBtn = actions.createEl("button", { text: "Save", cls: "mod-cta" });
    saveBtn.addEventListener("click", async () => {
      await this.saveAndClose();
    });
    this.renderActiveTab();
  }
  renderTabs() {
    this.tabHeaderEl.empty();
    const tabs = [
      { id: "general", label: "General" },
      { id: "languages", label: "Languages" },
      { id: "dockerfile", label: "Dockerfile" },
      { id: "raw", label: "Raw JSON" }
    ];
    for (const tab of tabs) {
      const btn = this.tabHeaderEl.createEl("button", {
        text: tab.label,
        cls: "loom-tab-btn" + (this.activeTab === tab.id ? " is-active" : "")
      });
      btn.addEventListener("click", () => {
        void this.switchTab(tab.id);
      });
    }
  }
  async switchTab(tab) {
    if (this.activeTab === "raw") {
      try {
        this.configObj = JSON.parse(this.rawJsonText);
      } catch (e) {
        new import_obsidian2.Notice("Invalid JSON syntax in Raw JSON tab. Please fix it before switching.");
        return;
      }
    }
    this.activeTab = tab;
    this.renderTabs();
    this.renderActiveTab();
  }
  renderActiveTab() {
    this.tabContentEl.empty();
    if (this.activeTab === "general") {
      this.renderGeneralTab(this.tabContentEl);
    } else if (this.activeTab === "languages") {
      this.renderLanguagesTab(this.tabContentEl);
    } else if (this.activeTab === "dockerfile") {
      this.renderDockerfileTab(this.tabContentEl);
    } else if (this.activeTab === "raw") {
      this.renderRawTab(this.tabContentEl);
    }
  }
  renderGeneralTab(containerEl) {
    new import_obsidian2.Setting(containerEl).setName("Runtime").setDesc("Choose the container/environment manager runtime.").addDropdown((dropdown) => {
      dropdown.addOption("docker", "Docker").addOption("podman", "Podman").addOption("wsl", "WSL").addOption("qemu", "QEMU").addOption("custom", "Custom").setValue(this.configObj.runtime || "docker").onChange((value) => {
        this.configObj.runtime = value;
        this.renderActiveTab();
      });
    });
    if (this.configObj.runtime === "docker" || this.configObj.runtime === "podman" || this.configObj.runtime === "wsl") {
      new import_obsidian2.Setting(containerEl).setName(this.configObj.runtime === "wsl" ? "WSL Distro" : "Base Image").setDesc(
        this.configObj.runtime === "wsl" ? "Optional. The target WSL distro name (leave empty for default distro)." : "Fallback Docker/Podman image if no Dockerfile is present."
      ).addText((text) => {
        text.setValue(this.configObj.image || "").onChange((val) => {
          this.configObj.image = val.trim();
        });
      });
    }
    if (this.configObj.runtime === "wsl") {
      if (!this.configObj.wsl) {
        this.configObj.wsl = {};
      }
      new import_obsidian2.Setting(containerEl).setName("Use Interactive Shell").setDesc("Use interactive login shell flags (-i -l) to ensure ~/.bashrc initialization works (e.g., for NVM).").addToggle((toggle) => {
        toggle.setValue(this.configObj.wsl.interactive ?? false).onChange((val) => {
          this.configObj.wsl.interactive = val;
        });
      });
    }
    if (this.configObj.runtime === "qemu") {
      if (!this.configObj.qemu) {
        this.configObj.qemu = { sshTarget: "", remoteWorkspace: "" };
      }
      new import_obsidian2.Setting(containerEl).setName("SSH Target").setDesc("SSH target address (e.g. user@hostname or localhost -p 2222).").addText((text) => {
        text.setValue(this.configObj.qemu.sshTarget || "").onChange((val) => {
          this.configObj.qemu.sshTarget = val.trim();
        });
      });
      new import_obsidian2.Setting(containerEl).setName("Remote Workspace").setDesc("Remote folder path to copy code snippets and run commands (e.g., /home/user/workspace).").addText((text) => {
        text.setValue(this.configObj.qemu.remoteWorkspace || "").onChange((val) => {
          this.configObj.qemu.remoteWorkspace = val.trim();
        });
      });
      new import_obsidian2.Setting(containerEl).setName("SSH Executable").setDesc("Optional. Path to SSH client executable (defaults to ssh).").addText((text) => {
        text.setValue(this.configObj.qemu.sshExecutable || "").onChange((val) => {
          this.configObj.qemu.sshExecutable = val.trim() || void 0;
        });
      });
      new import_obsidian2.Setting(containerEl).setName("SSH Arguments").setDesc("Optional. Additional SSH CLI flags.").addText((text) => {
        text.setValue(this.configObj.qemu.sshArgs || "").onChange((val) => {
          this.configObj.qemu.sshArgs = val.trim() || void 0;
        });
      });
    }
    if (this.configObj.runtime === "custom") {
      if (!this.configObj.custom) {
        this.configObj.custom = { executable: "" };
      }
      new import_obsidian2.Setting(containerEl).setName("Custom Executable").setDesc("Path to custom runtime wrapper executable or script.").addText((text) => {
        text.setValue(this.configObj.custom.executable || "").onChange((val) => {
          this.configObj.custom.executable = val.trim();
        });
      });
      new import_obsidian2.Setting(containerEl).setName("Custom Arguments").setDesc("Optional. Command arguments. Use {request} for JSON config path.").addText((text) => {
        text.setValue(this.configObj.custom.args || "").onChange((val) => {
          this.configObj.custom.args = val.trim() || void 0;
        });
      });
    }
  }
  renderLanguagesTab(containerEl) {
    containerEl.createEl("h3", { text: "Configured Languages" });
    if (!this.configObj.languages) {
      this.configObj.languages = {};
    }
    const langsListEl = containerEl.createDiv({ cls: "loom-languages-list" });
    const languages = Object.entries(this.configObj.languages);
    if (languages.length === 0) {
      langsListEl.createEl("p", { text: "No languages configured for this group.", cls: "setting-item-description" });
    } else {
      for (const [langName, langConfig] of languages) {
        const card = langsListEl.createDiv({ cls: "loom-language-card" });
        card.createEl("strong", { text: langName, attr: { style: "display: block; margin-bottom: 0.5rem; font-size: 1.1em;" } });
        const isDefault = langConfig.useDefault === true;
        new import_obsidian2.Setting(card).setName("Use default configuration").setDesc("If checked, Loom will run this language using its built-in commands/extensions.").addToggle((toggle) => {
          toggle.setValue(isDefault).onChange((val) => {
            if (val) {
              langConfig.useDefault = true;
              delete langConfig.command;
              delete langConfig.extension;
            } else {
              delete langConfig.useDefault;
              const defaults = this.loomPlugin.containerRunner.getDefaultLanguageConfig(langName, this.loomPlugin.settings);
              langConfig.command = defaults?.command || "";
              langConfig.extension = defaults?.extension || "";
            }
            this.renderActiveTab();
          });
        });
        new import_obsidian2.Setting(card).setName("Command").setDesc("Execution command. Use {file} for the code snippet filename.").addText((text) => {
          const defaults = this.loomPlugin.containerRunner.getDefaultLanguageConfig(langName, this.loomPlugin.settings);
          text.setPlaceholder(defaults?.command || "").setValue(langConfig.command || "").setDisabled(isDefault).onChange((val) => {
            langConfig.command = val.trim();
          });
        });
        new import_obsidian2.Setting(card).setName("Extension").setDesc("Source file extension (e.g. .py, .js).").addText((text) => {
          const defaults = this.loomPlugin.containerRunner.getDefaultLanguageConfig(langName, this.loomPlugin.settings);
          text.setPlaceholder(defaults?.extension || "").setValue(langConfig.extension || "").setDisabled(isDefault).onChange((val) => {
            langConfig.extension = val.trim();
          });
        });
        new import_obsidian2.Setting(card).addButton((btn) => {
          btn.setButtonText("Remove Language").setWarning().onClick(() => {
            delete this.configObj.languages[langName];
            this.renderActiveTab();
          });
        });
      }
    }
    containerEl.createEl("h3", { text: "Add Language Mapping", attr: { style: "margin-top: 1.5rem;" } });
    new import_obsidian2.Setting(containerEl).setName("Language ID").setDesc("e.g. python, javascript, node, sh").addText((text) => {
      text.setValue(this.newLanguageName).onChange((val) => {
        this.newLanguageName = val.trim().toLowerCase();
      });
    }).addButton((btn) => {
      btn.setButtonText("+ Add").setCta().onClick(() => {
        if (!this.newLanguageName) {
          new import_obsidian2.Notice("Please enter a language name.");
          return;
        }
        if (this.configObj.languages[this.newLanguageName]) {
          new import_obsidian2.Notice("Language already configured.");
          return;
        }
        this.configObj.languages[this.newLanguageName] = {
          command: `${this.newLanguageName} {file}`,
          extension: `.${this.newLanguageName}`
        };
        this.newLanguageName = "";
        this.renderActiveTab();
      });
    });
  }
  renderDockerfileTab(containerEl) {
    if (this.configObj.runtime !== "docker" && this.configObj.runtime !== "podman") {
      containerEl.createEl("p", {
        text: `Dockerfile editing is only available for Docker and Podman runtimes. Currently using: ${this.configObj.runtime}`,
        cls: "setting-item-description"
      });
      return;
    }
    if (this.dockerfileText === null) {
      containerEl.createEl("p", {
        text: "No Dockerfile exists in this container group directory.",
        cls: "setting-item-description"
      });
      new import_obsidian2.Setting(containerEl).addButton((btn) => {
        btn.setButtonText("Create Dockerfile").setCta().onClick(() => {
          this.dockerfileText = [
            "FROM ubuntu:latest",
            "",
            "# Install packages",
            "RUN apt-get update && apt-get install -y \\",
            "    python3 \\",
            "    nodejs \\",
            "    && rm -rf /var/lib/apt/lists/*",
            ""
          ].join("\n");
          this.renderActiveTab();
        });
      });
    } else {
      new import_obsidian2.Setting(containerEl).setName("Dockerfile Content").setDesc("Define the build steps for your environment container.").addTextArea((text) => {
        text.inputEl.rows = 15;
        text.inputEl.style.fontFamily = "monospace";
        text.inputEl.style.width = "100%";
        text.setValue(this.dockerfileText || "");
        text.onChange((val) => {
          this.dockerfileText = val;
        });
      });
    }
  }
  renderRawTab(containerEl) {
    this.rawJsonText = JSON.stringify(this.configObj, null, 2);
    new import_obsidian2.Setting(containerEl).setName("Configuration JSON").addTextArea((text) => {
      text.inputEl.rows = 15;
      text.inputEl.style.fontFamily = "monospace";
      text.inputEl.style.width = "100%";
      text.setValue(this.rawJsonText);
      text.onChange((val) => {
        this.rawJsonText = val;
      });
    });
  }
  async saveAndClose() {
    if (this.activeTab === "raw") {
      try {
        this.configObj = JSON.parse(this.rawJsonText);
      } catch (e) {
        new import_obsidian2.Notice("Invalid JSON syntax in Raw JSON tab. Please fix it before saving.");
        return;
      }
    }
    if (!this.configObj.runtime) {
      new import_obsidian2.Notice("Runtime is required.");
      return;
    }
    if (this.configObj.runtime === "qemu" && (!this.configObj.qemu?.sshTarget || !this.configObj.qemu?.remoteWorkspace)) {
      new import_obsidian2.Notice("QEMU runtime requires SSH Target and Remote Workspace.");
      return;
    }
    if (this.configObj.runtime === "custom" && !this.configObj.custom?.executable) {
      new import_obsidian2.Notice("Custom runtime requires Custom Executable.");
      return;
    }
    const adapter = this.app.vault.adapter;
    const configPath = `${this.pluginDir}/containers/${this.groupName}/config.json`;
    const dockerfilePath = `${this.pluginDir}/containers/${this.groupName}/Dockerfile`;
    try {
      const configStr = JSON.stringify(this.configObj, null, 2);
      await adapter.write(configPath, configStr);
      if (this.configObj.runtime === "docker" || this.configObj.runtime === "podman") {
        if (this.dockerfileText !== null) {
          await adapter.write(dockerfilePath, this.dockerfileText);
        }
      }
      new import_obsidian2.Notice("Container group configurations saved.");
      this.onSave();
      this.close();
    } catch (error) {
      new import_obsidian2.Notice(`Save failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
};

// src/ui/codeBlockToolbar.ts
var import_obsidian3 = require("obsidian");
function createCodeBlockToolbar(blockId, isRunning, handlers) {
  const toolbar = document.createElement("div");
  toolbar.className = "loom-code-toolbar";
  toolbar.dataset.loomBlockId = blockId;
  toolbar.appendChild(createButton("Run block", isRunning ? "loader-circle" : "play", handlers.onRun, isRunning));
  toolbar.appendChild(createButton("Copy code", "copy", handlers.onCopy, false));
  toolbar.appendChild(createButton("Remove snippet", "trash-2", handlers.onRemove, false));
  toolbar.appendChild(createButton("Toggle output", "panel-bottom-open", handlers.onToggleOutput, false));
  return toolbar;
}
function createButton(label, iconName, onClick, spinning) {
  const button = document.createElement("button");
  button.className = `loom-toolbar-button${spinning ? " is-running" : ""}`;
  button.type = "button";
  button.setAttribute("aria-label", label);
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    onClick();
  });
  (0, import_obsidian3.setIcon)(button, iconName);
  return button;
}

// src/ui/outputPanel.ts
var import_obsidian4 = require("obsidian");
function getStatusKind(output) {
  if (output.result.success) {
    return output.result.stderr.trim() || output.result.warning?.trim() ? "warning" : "success";
  }
  return "failure";
}
function createOutputPanel(output) {
  const panel = document.createElement("div");
  panel.className = `loom-output-panel is-${getStatusKind(output)}${output.visible ? "" : " is-hidden"}`;
  panel.dataset.loomBlockId = output.blockId;
  renderOutputPanel(panel, output);
  return panel;
}
function renderOutputPanel(panel, output) {
  const kind = getStatusKind(output);
  panel.className = `loom-output-panel is-${kind}${output.visible ? "" : " is-hidden"}${output.collapsed ? " is-collapsed" : ""}`;
  panel.empty();
  const header = panel.createDiv({ cls: "loom-output-header" });
  const badge = header.createDiv({ cls: "loom-output-badge" });
  (0, import_obsidian4.setIcon)(badge, kind === "success" ? "check-circle-2" : kind === "warning" ? "alert-triangle" : "x-circle");
  const title = header.createDiv({ cls: "loom-output-title" });
  title.setText(`${output.result.runnerName} \xB7 exit ${output.result.exitCode ?? "?"}`);
  const meta = header.createDiv({ cls: "loom-output-meta" });
  meta.setText(`${output.result.durationMs} ms \xB7 ${new Date(output.result.finishedAt).toLocaleTimeString()}`);
  const body = panel.createDiv({ cls: "loom-output-body" });
  if (output.result.stdout.trim()) {
    createStream(body, "Stdout", output.result.stdout);
  }
  if (output.result.warning?.trim()) {
    createStream(body, "Warning", output.result.warning);
  }
  if (output.result.stderr.trim()) {
    createStream(body, "Stderr", output.result.stderr);
  }
  if (!output.result.stdout.trim() && !output.result.warning?.trim() && !output.result.stderr.trim()) {
    const empty = body.createDiv({ cls: "loom-output-empty" });
    empty.setText("No output");
  }
}
function createStream(container, label, content) {
  const section = container.createDiv({ cls: "loom-output-stream" });
  section.createDiv({ cls: "loom-output-stream-label", text: label });
  section.createEl("pre", { cls: "loom-output-pre", text: content });
}
function createRunningPanel() {
  const panel = document.createElement("div");
  panel.className = "loom-output-panel is-running";
  const header = panel.createDiv({ cls: "loom-output-header" });
  const spinner = header.createDiv({ cls: "loom-spinner" });
  (0, import_obsidian4.setIcon)(spinner, "loader-circle");
  const title = header.createDiv({ cls: "loom-output-title" });
  title.setText("Running");
  const meta = header.createDiv({ cls: "loom-output-meta" });
  meta.setText("Executing...");
  spinner.setAttribute("aria-hidden", "true");
  return panel;
}

// src/main.ts
var loomRefreshEffect = import_state.StateEffect.define();
var ExecutionConsentModal = class extends import_obsidian5.Modal {
  constructor(app, onConfirm) {
    super(app);
    this.onConfirm = onConfirm;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: "Enable loom local execution?" });
    contentEl.createEl("p", {
      text: "loom runs code from your notes on your local machine using the configured executables. It does not sandbox or isolate the process."
    });
    const actions = contentEl.createDiv({ cls: "loom-modal-actions" });
    const cancelButton = actions.createEl("button", { text: "Cancel" });
    const enableButton = actions.createEl("button", { text: "Enable and run", cls: "mod-cta" });
    cancelButton.addEventListener("click", () => this.close());
    enableButton.addEventListener("click", async () => {
      await this.onConfirm();
      this.close();
    });
  }
};
var loomToolbarRenderChild = class extends import_obsidian5.MarkdownRenderChild {
  constructor(containerEl, plugin, block, codeElement) {
    super(containerEl);
    this.plugin = plugin;
    this.block = block;
    this.codeElement = codeElement;
    this.panelContainer = null;
    this.unregisterOutputListener = null;
  }
  onload() {
    this.codeElement.parentElement?.addClass("loom-codeblock-shell");
    this.codeElement.parentElement?.appendChild(this.plugin.createToolbarElement(this.block));
    if (this.plugin.settings.pdfExportMode === "output") {
      this.codeElement.classList.add("loom-print-hide-code");
    }
    const hostClasses = ["loom-inline-output-host"];
    if (this.plugin.settings.pdfExportMode === "code") {
      hostClasses.push("loom-print-hide-output");
    }
    this.panelContainer = this.containerEl.createDiv({ cls: hostClasses.join(" ") });
    this.plugin.renderOutputInto(this.block.id, this.panelContainer);
    this.unregisterOutputListener = this.plugin.registerOutputListener(this.block.id, () => {
      if (this.panelContainer) {
        this.plugin.renderOutputInto(this.block.id, this.panelContainer);
      }
    });
  }
  onunload() {
    this.unregisterOutputListener?.();
  }
};
var loomToolbarWidget = class extends import_view2.WidgetType {
  constructor(plugin, block) {
    super();
    this.plugin = plugin;
    this.block = block;
    this.isRunning = plugin.isBlockRunning(block.id);
  }
  eq(other) {
    return other.block.id === this.block.id && other.isRunning === this.isRunning;
  }
  toDOM() {
    return this.plugin.createToolbarElement(this.block);
  }
};
var loomOutputWidget = class extends import_view2.WidgetType {
  constructor(plugin, blockId) {
    super();
    this.plugin = plugin;
    this.blockId = blockId;
  }
  eq(other) {
    return false;
  }
  toDOM() {
    const wrapper = document.createElement("div");
    wrapper.className = "loom-inline-output-host";
    this.plugin.renderOutputInto(this.blockId, wrapper);
    return wrapper;
  }
};
var loomPlugin = class extends import_obsidian5.Plugin {
  constructor() {
    super(...arguments);
    this.settings = DEFAULT_SETTINGS;
    this.registry = new loomRunnerRegistry([
      new PythonRunner(),
      new NodeRunner(),
      new OcamlRunner(),
      new NativeCompiledRunner(),
      new InterpretedRunner(),
      new ManagedCompiledRunner(),
      new LlvmRunner(),
      new ProofRunner(),
      new CustomLanguageRunner()
    ]);
    // Exposed as public and readonly so the settings panel and modals can access container configurations and default language mapping helpers.
    this.containerRunner = new loomContainerRunner(this.app, this.manifest.dir ?? ".obsidian/plugins/loom");
    this.registeredCodeBlockAliases = /* @__PURE__ */ new Set();
    this.outputs = /* @__PURE__ */ new Map();
    this.running = /* @__PURE__ */ new Map();
    this.outputListeners = /* @__PURE__ */ new Map();
    this.editorViews = /* @__PURE__ */ new Set();
    this.lastMarkdownFilePath = null;
  }
  async onload() {
    await this.loadSettings();
    this.addSettingTab(new loomSettingTab(this));
    this.statusBarItemEl = this.addStatusBarItem();
    this.updateStatusBar();
    this.app.workspace.onLayoutReady(() => {
      this.lastMarkdownFilePath = this.getActiveMarkdownFile()?.path ?? this.lastMarkdownFilePath;
      void this.enforceSourceModeForActiveView();
    });
    this.addCommand({
      id: "loom-run-current-code-block",
      name: "loom: Run Current Code Block",
      editorCallback: async (editor, view) => {
        const file = view.file;
        if (!file) {
          return;
        }
        const blocks = parseMarkdownCodeBlocks(file.path, editor.getValue(), this.settings);
        const block = findBlockAtLine(blocks, editor.getCursor().line);
        if (!block) {
          new import_obsidian5.Notice("No supported loom block at the current cursor.");
          return;
        }
        await this.runBlock(file, block);
      }
    });
    this.addCommand({
      id: "loom-run-all-code-blocks",
      name: "loom: Run All Supported Code Blocks in Current Note",
      checkCallback: (checking) => {
        const file = this.getActiveMarkdownFile();
        if (!file) {
          return false;
        }
        if (!checking) {
          void this.runAllBlocksInFile(file);
        }
        return true;
      }
    });
    this.addCommand({
      id: "loom-clear-note-outputs",
      name: "loom: Clear loom Outputs in Current Note",
      checkCallback: (checking) => {
        const file = this.getActiveMarkdownFile();
        if (!file) {
          return false;
        }
        if (!checking) {
          void this.clearOutputsForFile(file);
        }
        return true;
      }
    });
    this.registerCodeBlockProcessors();
    this.registerEditorExtension(this.createLivePreviewExtension());
    this.registerEvent(
      this.app.workspace.on("file-open", (file) => {
        this.lastMarkdownFilePath = file?.path ?? this.lastMarkdownFilePath;
        this.refreshAllViews();
        void this.enforceSourceModeForActiveView();
        if (file && this.settings.autoRunOnFileOpen) {
          void this.runAllBlocksInFile(file);
        }
      })
    );
    this.addCommand({
      id: "loom-validate-container-groups",
      name: "loom: Validate Container Groups",
      callback: async () => {
        const groups = await this.getContainerGroupSummaries();
        new import_obsidian5.Notice(groups.length ? groups.map((group) => `${group.name}: ${group.status}`).join("\n") : "No loom container groups found.", 8e3);
      }
    });
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", () => {
        this.lastMarkdownFilePath = this.getActiveMarkdownFile()?.path ?? this.lastMarkdownFilePath;
        void this.enforceSourceModeForActiveView();
      })
    );
    this.registerEvent(
      this.app.workspace.on("editor-change", (_editor, ctx) => {
        if (ctx instanceof import_obsidian5.MarkdownView) {
          void this.enforceSourceModeForLeaf(ctx.leaf);
        }
      })
    );
  }
  onunload() {
    for (const controller of this.running.values()) {
      controller.abort();
    }
  }
  async loadSettings() {
    this.settings = {
      ...DEFAULT_SETTINGS,
      ...await this.loadData()
    };
  }
  async saveSettings() {
    await this.saveData(this.settings);
    this.registerCodeBlockProcessors();
    this.refreshAllViews();
  }
  isBlockRunning(blockId) {
    return this.running.has(blockId);
  }
  registerOutputListener(blockId, listener) {
    if (!this.outputListeners.has(blockId)) {
      this.outputListeners.set(blockId, /* @__PURE__ */ new Set());
    }
    this.outputListeners.get(blockId)?.add(listener);
    return () => {
      this.outputListeners.get(blockId)?.delete(listener);
    };
  }
  createToolbarElement(block) {
    return createCodeBlockToolbar(block.id, this.isBlockRunning(block.id), {
      onRun: () => void this.runActiveBlockById(block.id),
      onCopy: async () => {
        try {
          await navigator.clipboard.writeText(block.content);
          new import_obsidian5.Notice("Code copied");
        } catch {
          new import_obsidian5.Notice("Clipboard write failed.");
        }
      },
      onRemove: () => void this.removeSnippetById(block.id),
      onToggleOutput: () => {
        const output = this.outputs.get(block.id);
        if (!output) {
          return;
        }
        output.visible = !output.visible;
        this.notifyOutputChanged(block.id);
      }
    });
  }
  renderOutputInto(blockId, container) {
    container.empty();
    const output = this.outputs.get(blockId);
    if (this.running.has(blockId)) {
      container.appendChild(createRunningPanel());
      return;
    }
    if (!output || !output.visible) {
      return;
    }
    container.appendChild(createOutputPanel(output));
  }
  async runActiveBlockById(blockId) {
    const block = this.findActiveBlockById(blockId);
    const file = this.getActiveMarkdownFile();
    if (!block || !file) {
      return;
    }
    await this.runBlock(file, block);
  }
  async removeSnippetById(blockId) {
    const block = this.findActiveBlockById(blockId);
    if (!block) {
      return;
    }
    const file = this.app.vault.getAbstractFileByPath(block.filePath);
    if (!(file instanceof import_obsidian5.TFile)) {
      return;
    }
    this.running.get(blockId)?.abort();
    this.running.delete(blockId);
    this.outputs.delete(blockId);
    await this.app.vault.process(file, (content) => {
      const lines = content.split(/\r?\n/);
      const blocks = parseMarkdownCodeBlocks(file.path, content, this.settings);
      const currentBlock = blocks.find((candidate) => candidate.id === blockId);
      if (!currentBlock) {
        return content;
      }
      const managedRange = this.findManagedOutputRange(lines, blockId);
      const removalStart = currentBlock.startLine;
      const removalEnd = managedRange ? managedRange.end : currentBlock.endLine;
      lines.splice(removalStart, removalEnd - removalStart + 1);
      while (removalStart < lines.length - 1 && lines[removalStart] === "" && lines[removalStart + 1] === "") {
        lines.splice(removalStart, 1);
      }
      return lines.join("\n");
    });
    this.notifyOutputChanged(blockId);
    this.updateStatusBar();
    new import_obsidian5.Notice("loom snippet removed.");
  }
  async runAllBlocksInFile(file) {
    const source = await this.app.vault.cachedRead(file);
    const blocks = parseMarkdownCodeBlocks(file.path, source, this.settings);
    const containerGroup = this.containerRunner.getContainerGroupName(file) || this.settings.defaultContainerGroup;
    const supportedBlocks = containerGroup ? blocks : blocks.filter((block) => this.registry.getRunnerForBlock(block, this.settings));
    if (!supportedBlocks.length) {
      new import_obsidian5.Notice("No supported loom blocks found in the current note.");
      return;
    }
    for (const block of supportedBlocks) {
      await this.runBlock(file, block);
    }
  }
  async clearOutputsForFile(file) {
    const source = await this.app.vault.cachedRead(file);
    const blocks = parseMarkdownCodeBlocks(file.path, source, this.settings);
    for (const block of blocks) {
      this.outputs.delete(block.id);
      this.notifyOutputChanged(block.id);
      await this.removeManagedOutputBlock(file.path, block.id);
    }
    new import_obsidian5.Notice("loom outputs cleared.");
  }
  async runBlock(file, block) {
    this.lastMarkdownFilePath = file.path;
    if (this.running.has(block.id)) {
      new import_obsidian5.Notice("This loom block is already running.");
      return;
    }
    if (!await this.ensureExecutionEnabled()) {
      showExecutionDisabledNotice();
      return;
    }
    const workingDirectory = this.resolveWorkingDirectory(file);
    const containerGroup = this.containerRunner.getContainerGroupName(file) || this.settings.defaultContainerGroup;
    const runner = containerGroup ? null : this.registry.getRunnerForBlock(block, this.settings);
    if (!runner) {
      if (!containerGroup) {
        new import_obsidian5.Notice(`No configured runner for ${block.language}.`);
        return;
      }
    }
    const controller = new AbortController();
    const runContext = {
      file,
      workingDirectory,
      timeoutMs: this.settings.defaultTimeoutMs,
      signal: controller.signal
    };
    this.running.set(block.id, controller);
    this.notifyOutputChanged(block.id);
    this.updateStatusBar();
    try {
      const result = containerGroup ? await this.containerRunner.run(block, runContext, this.settings, containerGroup) : await runner.run(block, runContext, this.settings);
      if (result.timedOut) {
        result.stderr = result.stderr || `Execution timed out after ${this.settings.defaultTimeoutMs} ms.`;
      } else if (result.cancelled) {
        result.stderr = result.stderr || "Execution cancelled.";
      } else if (!result.success && !result.stderr.trim()) {
        result.stderr = "Process exited unsuccessfully.";
      }
      this.outputs.set(block.id, {
        blockId: block.id,
        block,
        result,
        collapsed: false,
        visible: true
      });
      if (this.settings.writeOutputToNote) {
        await this.writeManagedOutputBlock(file, block, result);
      }
      const runnerName = containerGroup ? `container ${containerGroup}` : runner.displayName;
      new import_obsidian5.Notice(result.success ? `loom ran ${runnerName} block.` : `loom run failed for ${runnerName}.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.outputs.set(block.id, {
        blockId: block.id,
        block,
        collapsed: false,
        visible: true,
        result: {
          runnerId: containerGroup ? `container:${containerGroup}` : runner?.id ?? "unknown",
          runnerName: containerGroup ? `Container ${containerGroup}` : runner?.displayName ?? "Unknown",
          startedAt: (/* @__PURE__ */ new Date()).toISOString(),
          finishedAt: (/* @__PURE__ */ new Date()).toISOString(),
          durationMs: 0,
          exitCode: -1,
          stdout: "",
          stderr: message,
          success: false,
          timedOut: false,
          cancelled: false
        }
      });
      new import_obsidian5.Notice(`loom error: ${message}`);
    } finally {
      this.running.delete(block.id);
      this.notifyOutputChanged(block.id);
      this.updateStatusBar();
    }
  }
  async ensureExecutionEnabled() {
    if (this.settings.enableLocalExecution && this.settings.hasAcknowledgedExecutionRisk) {
      return true;
    }
    return await new Promise((resolve) => {
      let settled = false;
      const settle = (value) => {
        if (!settled) {
          settled = true;
          resolve(value);
        }
      };
      const modal = new ExecutionConsentModal(this.app, async () => {
        this.settings.enableLocalExecution = true;
        this.settings.hasAcknowledgedExecutionRisk = true;
        await this.saveSettings();
        settle(true);
      });
      const originalClose = modal.close.bind(modal);
      modal.close = () => {
        originalClose();
        settle(this.settings.enableLocalExecution && this.settings.hasAcknowledgedExecutionRisk);
      };
      modal.open();
    });
  }
  resolveWorkingDirectory(file) {
    if (this.settings.workingDirectory.trim()) {
      return this.settings.workingDirectory.trim();
    }
    const adapterBasePath = this.app.vault.adapter.basePath ?? "";
    const fileFolder = (0, import_path7.dirname)(file.path);
    const resolved = fileFolder === "." ? adapterBasePath : `${adapterBasePath}/${fileFolder}`;
    return resolved || process.cwd();
  }
  async getContainerGroupSummaries() {
    return this.containerRunner.getGroupSummaries();
  }
  async buildContainerGroup(name) {
    const controller = new AbortController();
    const result = await this.containerRunner.buildGroup(name, Math.max(this.settings.defaultTimeoutMs, 12e4), controller.signal);
    new import_obsidian5.Notice(result.success ? `loom built container group ${name}.` : `loom container build failed for ${name}.`, 8e3);
  }
  registerCodeBlockProcessors() {
    for (const alias of getSupportedLanguageAliases(this.settings)) {
      const normalizedAlias = alias.toLowerCase();
      if (this.registeredCodeBlockAliases.has(normalizedAlias)) {
        continue;
      }
      if (/[^a-zA-Z0-9_-]/.test(normalizedAlias)) {
        continue;
      }
      this.registeredCodeBlockAliases.add(normalizedAlias);
      this.registerMarkdownCodeBlockProcessor(normalizedAlias, async (source, el, ctx) => {
        const filePath = ctx.sourcePath;
        const file = this.app.vault.getAbstractFileByPath(filePath);
        if (!(file instanceof import_obsidian5.TFile)) {
          return;
        }
        const fullText = await this.app.vault.cachedRead(file);
        const blocks = parseMarkdownCodeBlocks(filePath, fullText, this.settings);
        const section = ctx && typeof ctx.getSectionInfo === "function" ? ctx.getSectionInfo(el) : null;
        let block;
        if (section) {
          const lineStart = section.lineStart;
          block = blocks.find((candidate) => candidate.startLine === lineStart && candidate.content === source);
        } else {
          block = blocks.find((candidate) => candidate.content === source);
        }
        if (!block) {
          return;
        }
        let pre = el.querySelector("pre");
        if (!pre) {
          pre = el.createEl("pre");
          pre.addClass(`language-${normalizedAlias}`);
          const code = pre.createEl("code");
          code.addClass(`language-${normalizedAlias}`);
          code.setText(source);
        }
        if (block.language === "llvm-ir") {
          const code = pre.querySelector("code") ?? pre;
          highlightLlvmElement(code, source);
        }
        ctx.addChild(new loomToolbarRenderChild(el, this, block, pre));
      });
    }
  }
  updateStatusBar() {
    const activeRuns = this.running.size;
    this.statusBarItemEl.setText(activeRuns ? `loom: ${activeRuns} Active Run${activeRuns === 1 ? "" : "s"}` : "loom: Idle");
  }
  notifyOutputChanged(blockId) {
    this.outputListeners.get(blockId)?.forEach((listener) => listener());
    this.refreshAllViews();
  }
  refreshAllViews() {
    this.app.workspace.getLeavesOfType("markdown").forEach((leaf) => {
      const view = leaf.view;
      const previewMode = view.previewMode;
      previewMode?.rerender?.(true);
    });
    for (const editorView of this.editorViews) {
      editorView.dispatch({ effects: loomRefreshEffect.of(void 0) });
    }
  }
  getActiveMarkdownFile() {
    const view = this.app.workspace.getActiveViewOfType(import_obsidian5.MarkdownView);
    return view?.file ?? null;
  }
  getCurrentEditorFilePath() {
    return this.getActiveMarkdownFile()?.path ?? this.lastMarkdownFilePath;
  }
  async enforceSourceModeForActiveView() {
    const view = this.app.workspace.getActiveViewOfType(import_obsidian5.MarkdownView);
    if (!view) {
      return;
    }
    await this.enforceSourceModeForLeaf(view.leaf);
  }
  async disableSourceModeForActiveView() {
    const view = this.app.workspace.getActiveViewOfType(import_obsidian5.MarkdownView);
    if (!view) {
      return;
    }
    const leaf = view.leaf;
    const viewState = leaf.getViewState();
    const state = { ...viewState.state ?? {} };
    if (state.mode === "source" && state.source === true) {
      state.source = false;
      await leaf.setViewState({
        ...viewState,
        state
      });
    }
  }
  async enforceSourceModeForLeaf(leaf) {
    if (!this.settings.preserveSourceMode) {
      return;
    }
    if (leaf.isDeferred) {
      await leaf.loadIfDeferred();
    }
    const view = leaf.view;
    if (!(view instanceof import_obsidian5.MarkdownView) || !view.file) {
      return;
    }
    const source = view.editor?.getValue?.() ?? await this.app.vault.cachedRead(view.file);
    const blocks = parseMarkdownCodeBlocks(view.file.path, source, this.settings);
    if (!blocks.length) {
      return;
    }
    const viewState = leaf.getViewState();
    const state = { ...viewState.state ?? {} };
    if (state.mode === "source" && state.source === true) {
      return;
    }
    state.mode = "source";
    state.source = true;
    await leaf.setViewState({
      ...viewState,
      state
    });
  }
  findActiveBlockById(blockId) {
    const view = this.app.workspace.getActiveViewOfType(import_obsidian5.MarkdownView);
    const file = view?.file;
    const editor = view?.editor;
    if (!file || !editor) {
      return this.outputs.get(blockId)?.block ?? null;
    }
    const blocks = parseMarkdownCodeBlocks(file.path, editor.getValue(), this.settings);
    return blocks.find((block) => block.id === blockId) ?? this.outputs.get(blockId)?.block ?? null;
  }
  createLivePreviewExtension() {
    const plugin = this;
    return import_view2.ViewPlugin.fromClass(
      class {
        constructor(view) {
          this.view = view;
          plugin.editorViews.add(view);
          this.decorations = this.buildDecorations();
        }
        update(update) {
          if (update.docChanged || update.viewportChanged || update.transactions.some((tr) => tr.effects.some((effect) => effect.is(loomRefreshEffect)))) {
            this.decorations = this.buildDecorations();
          }
        }
        destroy() {
          plugin.editorViews.delete(this.view);
        }
        buildDecorations() {
          const filePath = plugin.getCurrentEditorFilePath();
          if (!filePath) {
            return import_view2.Decoration.none;
          }
          const source = this.view.state.doc.toString();
          const blocks = parseMarkdownCodeBlocks(filePath, source, plugin.settings);
          const builder = new import_state.RangeSetBuilder();
          for (const block of blocks) {
            const startLine = this.view.state.doc.line(block.startLine + 1);
            builder.add(
              startLine.from,
              startLine.from,
              import_view2.Decoration.widget({
                widget: new loomToolbarWidget(plugin, block),
                side: -1
              })
            );
            if (plugin.outputs.has(block.id) || plugin.running.has(block.id)) {
              const endLine = this.view.state.doc.line(block.endLine + 1);
              builder.add(
                endLine.to,
                endLine.to,
                import_view2.Decoration.widget({
                  widget: new loomOutputWidget(plugin, block.id),
                  side: 1
                })
              );
            }
            if (block.language === "llvm-ir") {
              addLlvmDecorations(builder, this.view, block);
            }
          }
          return builder.finish();
        }
      },
      {
        decorations: (value) => value.decorations
      }
    );
  }
  async writeManagedOutputBlock(file, block, result) {
    await this.app.vault.process(file, (content) => {
      const lines = content.split(/\r?\n/);
      const blocks = parseMarkdownCodeBlocks(file.path, content, this.settings);
      const currentBlock = blocks.find((candidate) => candidate.id === block.id);
      const rendered = this.renderManagedOutputMarkdown(block.id, result);
      const existingRange = this.findManagedOutputRange(lines, block.id);
      if (existingRange) {
        lines.splice(existingRange.start, existingRange.end - existingRange.start + 1, ...rendered);
        return lines.join("\n");
      }
      if (!currentBlock) {
        return content;
      }
      lines.splice(currentBlock.endLine + 1, 0, ...rendered);
      return lines.join("\n");
    });
  }
  async removeManagedOutputBlock(filePath, blockId) {
    const file = this.app.vault.getAbstractFileByPath(filePath);
    if (!(file instanceof import_obsidian5.TFile)) {
      return;
    }
    await this.app.vault.process(file, (content) => {
      const lines = content.split(/\r?\n/);
      const range = this.findManagedOutputRange(lines, blockId);
      if (!range) {
        return content;
      }
      lines.splice(range.start, range.end - range.start + 1);
      return lines.join("\n");
    });
  }
  renderManagedOutputMarkdown(blockId, result) {
    const body = [
      `runner=${result.runnerName}`,
      `exit=${result.exitCode ?? "?"}`,
      `duration=${result.durationMs}ms`,
      `timestamp=${result.finishedAt}`,
      result.stdout ? `stdout:
${result.stdout}` : "",
      result.warning ? `warning:
${result.warning}` : "",
      result.stderr ? `stderr:
${result.stderr}` : ""
    ].filter(Boolean).join("\n\n");
    return [
      `<!-- loom:output:start id=${blockId} -->`,
      "```text",
      body,
      "```",
      "<!-- loom:output:end -->"
    ];
  }
  findManagedOutputRange(lines, blockId) {
    const startMarker = `<!-- loom:output:start id=${blockId} -->`;
    for (let i = 0; i < lines.length; i += 1) {
      if (lines[i].trim() !== startMarker) {
        continue;
      }
      for (let j = i + 1; j < lines.length; j += 1) {
        if (lines[j].trim() === "<!-- loom:output:end -->") {
          return { start: i, end: j };
        }
      }
    }
    return null;
  }
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsic3JjL21haW4udHMiLCAic3JjL2V4ZWN1dGlvbi9jb250YWluZXJSdW5uZXIudHMiLCAic3JjL2V4ZWN1dGlvbi9wcm9jZXNzUnVubmVyLnRzIiwgInNyYy91dGlscy9jb21tYW5kLnRzIiwgInNyYy9sbHZtSGlnaGxpZ2h0LnRzIiwgInNyYy91dGlscy9oYXNoLnRzIiwgInNyYy9wYXJzZXIudHMiLCAic3JjL3J1bm5lcnMvbm9kZS50cyIsICJzcmMvcnVubmVycy9jdXN0b20udHMiLCAic3JjL3J1bm5lcnMvaW50ZXJwcmV0ZWQudHMiLCAic3JjL3J1bm5lcnMvbGx2bS50cyIsICJzcmMvcnVubmVycy9tYW5hZ2VkQ29tcGlsZWQudHMiLCAic3JjL3J1bm5lcnMvbmF0aXZlQ29tcGlsZWQudHMiLCAic3JjL3J1bm5lcnMvb2NhbWwudHMiLCAic3JjL3J1bm5lcnMvcHl0aG9uLnRzIiwgInNyYy9ydW5uZXJzL3Byb29mLnRzIiwgInNyYy9ydW5uZXJzL3JlZ2lzdHJ5LnRzIiwgInNyYy9zZXR0aW5ncy50cyIsICJzcmMvdWkvY29kZUJsb2NrVG9vbGJhci50cyIsICJzcmMvdWkvb3V0cHV0UGFuZWwudHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImltcG9ydCB7XG4gIE1hcmtkb3duUmVuZGVyQ2hpbGQsXG4gIE1hcmtkb3duVmlldyxcbiAgTW9kYWwsXG4gIE5vdGljZSxcbiAgUGx1Z2luLFxuICBURmlsZSxcbiAgV29ya3NwYWNlTGVhZixcbn0gZnJvbSBcIm9ic2lkaWFuXCI7XG5pbXBvcnQgeyBSYW5nZVNldEJ1aWxkZXIsIFN0YXRlRWZmZWN0IH0gZnJvbSBcIkBjb2RlbWlycm9yL3N0YXRlXCI7XG5pbXBvcnQgeyBEZWNvcmF0aW9uLCBFZGl0b3JWaWV3LCBWaWV3UGx1Z2luLCBWaWV3VXBkYXRlLCBXaWRnZXRUeXBlIH0gZnJvbSBcIkBjb2RlbWlycm9yL3ZpZXdcIjtcbmltcG9ydCB7IGRpcm5hbWUgfSBmcm9tIFwicGF0aFwiO1xuaW1wb3J0IHsgbG9vbUNvbnRhaW5lclJ1bm5lciB9IGZyb20gXCIuL2V4ZWN1dGlvbi9jb250YWluZXJSdW5uZXJcIjtcbmltcG9ydCB7IGFkZExsdm1EZWNvcmF0aW9ucywgaGlnaGxpZ2h0TGx2bUVsZW1lbnQgfSBmcm9tIFwiLi9sbHZtSGlnaGxpZ2h0XCI7XG5pbXBvcnQgeyBmaW5kQmxvY2tBdExpbmUsIGdldFN1cHBvcnRlZExhbmd1YWdlQWxpYXNlcywgcGFyc2VNYXJrZG93bkNvZGVCbG9ja3MgfSBmcm9tIFwiLi9wYXJzZXJcIjtcbmltcG9ydCB7IE5vZGVSdW5uZXIgfSBmcm9tIFwiLi9ydW5uZXJzL25vZGVcIjtcbmltcG9ydCB7IEN1c3RvbUxhbmd1YWdlUnVubmVyIH0gZnJvbSBcIi4vcnVubmVycy9jdXN0b21cIjtcbmltcG9ydCB7IEludGVycHJldGVkUnVubmVyIH0gZnJvbSBcIi4vcnVubmVycy9pbnRlcnByZXRlZFwiO1xuaW1wb3J0IHsgTGx2bVJ1bm5lciB9IGZyb20gXCIuL3J1bm5lcnMvbGx2bVwiO1xuaW1wb3J0IHsgTWFuYWdlZENvbXBpbGVkUnVubmVyIH0gZnJvbSBcIi4vcnVubmVycy9tYW5hZ2VkQ29tcGlsZWRcIjtcbmltcG9ydCB7IE5hdGl2ZUNvbXBpbGVkUnVubmVyIH0gZnJvbSBcIi4vcnVubmVycy9uYXRpdmVDb21waWxlZFwiO1xuaW1wb3J0IHsgT2NhbWxSdW5uZXIgfSBmcm9tIFwiLi9ydW5uZXJzL29jYW1sXCI7XG5pbXBvcnQgeyBQeXRob25SdW5uZXIgfSBmcm9tIFwiLi9ydW5uZXJzL3B5dGhvblwiO1xuaW1wb3J0IHsgUHJvb2ZSdW5uZXIgfSBmcm9tIFwiLi9ydW5uZXJzL3Byb29mXCI7XG5pbXBvcnQgeyBsb29tUnVubmVyUmVnaXN0cnkgfSBmcm9tIFwiLi9ydW5uZXJzL3JlZ2lzdHJ5XCI7XG5pbXBvcnQgeyBERUZBVUxUX1NFVFRJTkdTLCBsb29tU2V0dGluZ1RhYiwgc2hvd0V4ZWN1dGlvbkRpc2FibGVkTm90aWNlIH0gZnJvbSBcIi4vc2V0dGluZ3NcIjtcbmltcG9ydCB7IGNyZWF0ZUNvZGVCbG9ja1Rvb2xiYXIgfSBmcm9tIFwiLi91aS9jb2RlQmxvY2tUb29sYmFyXCI7XG5pbXBvcnQgeyBjcmVhdGVPdXRwdXRQYW5lbCwgY3JlYXRlUnVubmluZ1BhbmVsIH0gZnJvbSBcIi4vdWkvb3V0cHV0UGFuZWxcIjtcbmltcG9ydCB0eXBlIHsgbG9vbUNvZGVCbG9jaywgbG9vbVBsdWdpblNldHRpbmdzLCBsb29tU3RvcmVkT3V0cHV0IH0gZnJvbSBcIi4vdHlwZXNcIjtcblxuY29uc3QgbG9vbVJlZnJlc2hFZmZlY3QgPSBTdGF0ZUVmZmVjdC5kZWZpbmU8dm9pZD4oKTtcblxuY2xhc3MgRXhlY3V0aW9uQ29uc2VudE1vZGFsIGV4dGVuZHMgTW9kYWwge1xuICBjb25zdHJ1Y3RvcihcbiAgICBhcHA6IFBsdWdpbltcImFwcFwiXSxcbiAgICBwcml2YXRlIHJlYWRvbmx5IG9uQ29uZmlybTogKCkgPT4gUHJvbWlzZTx2b2lkPixcbiAgKSB7XG4gICAgc3VwZXIoYXBwKTtcbiAgfVxuXG4gIG9uT3BlbigpOiB2b2lkIHtcbiAgICBjb25zdCB7IGNvbnRlbnRFbCB9ID0gdGhpcztcbiAgICBjb250ZW50RWwuZW1wdHkoKTtcbiAgICBjb250ZW50RWwuY3JlYXRlRWwoXCJoMlwiLCB7IHRleHQ6IFwiRW5hYmxlIGxvb20gbG9jYWwgZXhlY3V0aW9uP1wiIH0pO1xuICAgIGNvbnRlbnRFbC5jcmVhdGVFbChcInBcIiwge1xuICAgICAgdGV4dDogXCJsb29tIHJ1bnMgY29kZSBmcm9tIHlvdXIgbm90ZXMgb24geW91ciBsb2NhbCBtYWNoaW5lIHVzaW5nIHRoZSBjb25maWd1cmVkIGV4ZWN1dGFibGVzLiBJdCBkb2VzIG5vdCBzYW5kYm94IG9yIGlzb2xhdGUgdGhlIHByb2Nlc3MuXCIsXG4gICAgfSk7XG5cbiAgICBjb25zdCBhY3Rpb25zID0gY29udGVudEVsLmNyZWF0ZURpdih7IGNsczogXCJsb29tLW1vZGFsLWFjdGlvbnNcIiB9KTtcbiAgICBjb25zdCBjYW5jZWxCdXR0b24gPSBhY3Rpb25zLmNyZWF0ZUVsKFwiYnV0dG9uXCIsIHsgdGV4dDogXCJDYW5jZWxcIiB9KTtcbiAgICBjb25zdCBlbmFibGVCdXR0b24gPSBhY3Rpb25zLmNyZWF0ZUVsKFwiYnV0dG9uXCIsIHsgdGV4dDogXCJFbmFibGUgYW5kIHJ1blwiLCBjbHM6IFwibW9kLWN0YVwiIH0pO1xuXG4gICAgY2FuY2VsQnV0dG9uLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoKSA9PiB0aGlzLmNsb3NlKCkpO1xuICAgIGVuYWJsZUJ1dHRvbi5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgYXN5bmMgKCkgPT4ge1xuICAgICAgYXdhaXQgdGhpcy5vbkNvbmZpcm0oKTtcbiAgICAgIHRoaXMuY2xvc2UoKTtcbiAgICB9KTtcbiAgfVxufVxuXG5jbGFzcyBsb29tVG9vbGJhclJlbmRlckNoaWxkIGV4dGVuZHMgTWFya2Rvd25SZW5kZXJDaGlsZCB7XG4gIHByaXZhdGUgcGFuZWxDb250YWluZXI6IEhUTUxEaXZFbGVtZW50IHwgbnVsbCA9IG51bGw7XG4gIHByaXZhdGUgdW5yZWdpc3Rlck91dHB1dExpc3RlbmVyOiAoKCkgPT4gdm9pZCkgfCBudWxsID0gbnVsbDtcblxuICBjb25zdHJ1Y3RvcihcbiAgICBjb250YWluZXJFbDogSFRNTEVsZW1lbnQsXG4gICAgcHJpdmF0ZSByZWFkb25seSBwbHVnaW46IGxvb21QbHVnaW4sXG4gICAgcHJpdmF0ZSByZWFkb25seSBibG9jazogbG9vbUNvZGVCbG9jayxcbiAgICBwcml2YXRlIHJlYWRvbmx5IGNvZGVFbGVtZW50OiBIVE1MRWxlbWVudCxcbiAgKSB7XG4gICAgc3VwZXIoY29udGFpbmVyRWwpO1xuICB9XG5cbiAgb25sb2FkKCk6IHZvaWQge1xuICAgIHRoaXMuY29kZUVsZW1lbnQucGFyZW50RWxlbWVudD8uYWRkQ2xhc3MoXCJsb29tLWNvZGVibG9jay1zaGVsbFwiKTtcbiAgICB0aGlzLmNvZGVFbGVtZW50LnBhcmVudEVsZW1lbnQ/LmFwcGVuZENoaWxkKHRoaXMucGx1Z2luLmNyZWF0ZVRvb2xiYXJFbGVtZW50KHRoaXMuYmxvY2spKTtcblxuICAgIGlmICh0aGlzLnBsdWdpbi5zZXR0aW5ncy5wZGZFeHBvcnRNb2RlID09PSBcIm91dHB1dFwiKSB7XG4gICAgICB0aGlzLmNvZGVFbGVtZW50LmNsYXNzTGlzdC5hZGQoXCJsb29tLXByaW50LWhpZGUtY29kZVwiKTtcbiAgICB9XG5cbiAgICBjb25zdCBob3N0Q2xhc3NlcyA9IFtcImxvb20taW5saW5lLW91dHB1dC1ob3N0XCJdO1xuICAgIGlmICh0aGlzLnBsdWdpbi5zZXR0aW5ncy5wZGZFeHBvcnRNb2RlID09PSBcImNvZGVcIikge1xuICAgICAgaG9zdENsYXNzZXMucHVzaChcImxvb20tcHJpbnQtaGlkZS1vdXRwdXRcIik7XG4gICAgfVxuICAgIHRoaXMucGFuZWxDb250YWluZXIgPSB0aGlzLmNvbnRhaW5lckVsLmNyZWF0ZURpdih7IGNsczogaG9zdENsYXNzZXMuam9pbihcIiBcIikgfSk7XG5cbiAgICB0aGlzLnBsdWdpbi5yZW5kZXJPdXRwdXRJbnRvKHRoaXMuYmxvY2suaWQsIHRoaXMucGFuZWxDb250YWluZXIpO1xuICAgIHRoaXMudW5yZWdpc3Rlck91dHB1dExpc3RlbmVyID0gdGhpcy5wbHVnaW4ucmVnaXN0ZXJPdXRwdXRMaXN0ZW5lcih0aGlzLmJsb2NrLmlkLCAoKSA9PiB7XG4gICAgICBpZiAodGhpcy5wYW5lbENvbnRhaW5lcikge1xuICAgICAgICB0aGlzLnBsdWdpbi5yZW5kZXJPdXRwdXRJbnRvKHRoaXMuYmxvY2suaWQsIHRoaXMucGFuZWxDb250YWluZXIpO1xuICAgICAgfVxuICAgIH0pO1xuICB9XG5cbiAgb251bmxvYWQoKTogdm9pZCB7XG4gICAgdGhpcy51bnJlZ2lzdGVyT3V0cHV0TGlzdGVuZXI/LigpO1xuICB9XG59XG5cbmNsYXNzIGxvb21Ub29sYmFyV2lkZ2V0IGV4dGVuZHMgV2lkZ2V0VHlwZSB7XG4gIHByaXZhdGUgcmVhZG9ubHkgaXNSdW5uaW5nOiBib29sZWFuO1xuXG4gIGNvbnN0cnVjdG9yKFxuICAgIHByaXZhdGUgcmVhZG9ubHkgcGx1Z2luOiBsb29tUGx1Z2luLFxuICAgIHByaXZhdGUgcmVhZG9ubHkgYmxvY2s6IGxvb21Db2RlQmxvY2ssXG4gICkge1xuICAgIHN1cGVyKCk7XG4gICAgdGhpcy5pc1J1bm5pbmcgPSBwbHVnaW4uaXNCbG9ja1J1bm5pbmcoYmxvY2suaWQpO1xuICB9XG5cbiAgZXEob3RoZXI6IGxvb21Ub29sYmFyV2lkZ2V0KTogYm9vbGVhbiB7XG4gICAgcmV0dXJuIG90aGVyLmJsb2NrLmlkID09PSB0aGlzLmJsb2NrLmlkICYmIG90aGVyLmlzUnVubmluZyA9PT0gdGhpcy5pc1J1bm5pbmc7XG4gIH1cblxuICB0b0RPTSgpOiBIVE1MRWxlbWVudCB7XG4gICAgcmV0dXJuIHRoaXMucGx1Z2luLmNyZWF0ZVRvb2xiYXJFbGVtZW50KHRoaXMuYmxvY2spO1xuICB9XG59XG5cbmNsYXNzIGxvb21PdXRwdXRXaWRnZXQgZXh0ZW5kcyBXaWRnZXRUeXBlIHtcbiAgY29uc3RydWN0b3IoXG4gICAgcHJpdmF0ZSByZWFkb25seSBwbHVnaW46IGxvb21QbHVnaW4sXG4gICAgcHJpdmF0ZSByZWFkb25seSBibG9ja0lkOiBzdHJpbmcsXG4gICkge1xuICAgIHN1cGVyKCk7XG4gIH1cblxuICBlcShvdGhlcjogbG9vbU91dHB1dFdpZGdldCk6IGJvb2xlYW4ge1xuICAgIHJldHVybiBmYWxzZTtcbiAgfVxuXG4gIHRvRE9NKCk6IEhUTUxFbGVtZW50IHtcbiAgICBjb25zdCB3cmFwcGVyID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcImRpdlwiKTtcbiAgICB3cmFwcGVyLmNsYXNzTmFtZSA9IFwibG9vbS1pbmxpbmUtb3V0cHV0LWhvc3RcIjtcbiAgICB0aGlzLnBsdWdpbi5yZW5kZXJPdXRwdXRJbnRvKHRoaXMuYmxvY2tJZCwgd3JhcHBlcik7XG4gICAgcmV0dXJuIHdyYXBwZXI7XG4gIH1cbn1cblxuZXhwb3J0IGRlZmF1bHQgY2xhc3MgbG9vbVBsdWdpbiBleHRlbmRzIFBsdWdpbiB7XG4gIHNldHRpbmdzOiBsb29tUGx1Z2luU2V0dGluZ3MgPSBERUZBVUxUX1NFVFRJTkdTO1xuICByZWFkb25seSByZWdpc3RyeSA9IG5ldyBsb29tUnVubmVyUmVnaXN0cnkoW1xuICAgIG5ldyBQeXRob25SdW5uZXIoKSxcbiAgICBuZXcgTm9kZVJ1bm5lcigpLFxuICAgIG5ldyBPY2FtbFJ1bm5lcigpLFxuICAgIG5ldyBOYXRpdmVDb21waWxlZFJ1bm5lcigpLFxuICAgIG5ldyBJbnRlcnByZXRlZFJ1bm5lcigpLFxuICAgIG5ldyBNYW5hZ2VkQ29tcGlsZWRSdW5uZXIoKSxcbiAgICBuZXcgTGx2bVJ1bm5lcigpLFxuICAgIG5ldyBQcm9vZlJ1bm5lcigpLFxuICAgIG5ldyBDdXN0b21MYW5ndWFnZVJ1bm5lcigpLFxuICBdKTtcbiAgLy8gRXhwb3NlZCBhcyBwdWJsaWMgYW5kIHJlYWRvbmx5IHNvIHRoZSBzZXR0aW5ncyBwYW5lbCBhbmQgbW9kYWxzIGNhbiBhY2Nlc3MgY29udGFpbmVyIGNvbmZpZ3VyYXRpb25zIGFuZCBkZWZhdWx0IGxhbmd1YWdlIG1hcHBpbmcgaGVscGVycy5cbiAgcHVibGljIHJlYWRvbmx5IGNvbnRhaW5lclJ1bm5lciA9IG5ldyBsb29tQ29udGFpbmVyUnVubmVyKHRoaXMuYXBwLCB0aGlzLm1hbmlmZXN0LmRpciA/PyBcIi5vYnNpZGlhbi9wbHVnaW5zL2xvb21cIik7XG4gIHByaXZhdGUgcmVhZG9ubHkgcmVnaXN0ZXJlZENvZGVCbG9ja0FsaWFzZXMgPSBuZXcgU2V0PHN0cmluZz4oKTtcbiAgcHJpdmF0ZSByZWFkb25seSBvdXRwdXRzID0gbmV3IE1hcDxzdHJpbmcsIGxvb21TdG9yZWRPdXRwdXQ+KCk7XG4gIHByaXZhdGUgcmVhZG9ubHkgcnVubmluZyA9IG5ldyBNYXA8c3RyaW5nLCBBYm9ydENvbnRyb2xsZXI+KCk7XG4gIHByaXZhdGUgcmVhZG9ubHkgb3V0cHV0TGlzdGVuZXJzID0gbmV3IE1hcDxzdHJpbmcsIFNldDwoKSA9PiB2b2lkPj4oKTtcbiAgcHJpdmF0ZSBzdGF0dXNCYXJJdGVtRWwhOiBIVE1MRWxlbWVudDtcbiAgcHJpdmF0ZSBlZGl0b3JWaWV3cyA9IG5ldyBTZXQ8RWRpdG9yVmlldz4oKTtcbiAgcHJpdmF0ZSBsYXN0TWFya2Rvd25GaWxlUGF0aDogc3RyaW5nIHwgbnVsbCA9IG51bGw7XG5cbiAgYXN5bmMgb25sb2FkKCk6IFByb21pc2U8dm9pZD4ge1xuICAgIGF3YWl0IHRoaXMubG9hZFNldHRpbmdzKCk7XG4gICAgdGhpcy5hZGRTZXR0aW5nVGFiKG5ldyBsb29tU2V0dGluZ1RhYih0aGlzKSk7XG4gICAgdGhpcy5zdGF0dXNCYXJJdGVtRWwgPSB0aGlzLmFkZFN0YXR1c0Jhckl0ZW0oKTtcbiAgICB0aGlzLnVwZGF0ZVN0YXR1c0JhcigpO1xuICAgIHRoaXMuYXBwLndvcmtzcGFjZS5vbkxheW91dFJlYWR5KCgpID0+IHtcbiAgICAgIHRoaXMubGFzdE1hcmtkb3duRmlsZVBhdGggPSB0aGlzLmdldEFjdGl2ZU1hcmtkb3duRmlsZSgpPy5wYXRoID8/IHRoaXMubGFzdE1hcmtkb3duRmlsZVBhdGg7XG4gICAgICB2b2lkIHRoaXMuZW5mb3JjZVNvdXJjZU1vZGVGb3JBY3RpdmVWaWV3KCk7XG4gICAgfSk7XG5cbiAgICB0aGlzLmFkZENvbW1hbmQoe1xuICAgICAgaWQ6IFwibG9vbS1ydW4tY3VycmVudC1jb2RlLWJsb2NrXCIsXG4gICAgICBuYW1lOiBcImxvb206IFJ1biBDdXJyZW50IENvZGUgQmxvY2tcIixcbiAgICAgIGVkaXRvckNhbGxiYWNrOiBhc3luYyAoZWRpdG9yLCB2aWV3KSA9PiB7XG4gICAgICAgIGNvbnN0IGZpbGUgPSB2aWV3LmZpbGU7XG4gICAgICAgIGlmICghZmlsZSkge1xuICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IGJsb2NrcyA9IHBhcnNlTWFya2Rvd25Db2RlQmxvY2tzKGZpbGUucGF0aCwgZWRpdG9yLmdldFZhbHVlKCksIHRoaXMuc2V0dGluZ3MpO1xuICAgICAgICBjb25zdCBibG9jayA9IGZpbmRCbG9ja0F0TGluZShibG9ja3MsIGVkaXRvci5nZXRDdXJzb3IoKS5saW5lKTtcbiAgICAgICAgaWYgKCFibG9jaykge1xuICAgICAgICAgIG5ldyBOb3RpY2UoXCJObyBzdXBwb3J0ZWQgbG9vbSBibG9jayBhdCB0aGUgY3VycmVudCBjdXJzb3IuXCIpO1xuICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICBhd2FpdCB0aGlzLnJ1bkJsb2NrKGZpbGUsIGJsb2NrKTtcbiAgICAgIH0sXG4gICAgfSk7XG5cbiAgICB0aGlzLmFkZENvbW1hbmQoe1xuICAgICAgaWQ6IFwibG9vbS1ydW4tYWxsLWNvZGUtYmxvY2tzXCIsXG4gICAgICBuYW1lOiBcImxvb206IFJ1biBBbGwgU3VwcG9ydGVkIENvZGUgQmxvY2tzIGluIEN1cnJlbnQgTm90ZVwiLFxuICAgICAgY2hlY2tDYWxsYmFjazogKGNoZWNraW5nKSA9PiB7XG4gICAgICAgIGNvbnN0IGZpbGUgPSB0aGlzLmdldEFjdGl2ZU1hcmtkb3duRmlsZSgpO1xuICAgICAgICBpZiAoIWZpbGUpIHtcbiAgICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKCFjaGVja2luZykge1xuICAgICAgICAgIHZvaWQgdGhpcy5ydW5BbGxCbG9ja3NJbkZpbGUoZmlsZSk7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgICB9LFxuICAgIH0pO1xuXG4gICAgdGhpcy5hZGRDb21tYW5kKHtcbiAgICAgIGlkOiBcImxvb20tY2xlYXItbm90ZS1vdXRwdXRzXCIsXG4gICAgICBuYW1lOiBcImxvb206IENsZWFyIGxvb20gT3V0cHV0cyBpbiBDdXJyZW50IE5vdGVcIixcbiAgICAgIGNoZWNrQ2FsbGJhY2s6IChjaGVja2luZykgPT4ge1xuICAgICAgICBjb25zdCBmaWxlID0gdGhpcy5nZXRBY3RpdmVNYXJrZG93bkZpbGUoKTtcbiAgICAgICAgaWYgKCFmaWxlKSB7XG4gICAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgICB9XG4gICAgICAgIGlmICghY2hlY2tpbmcpIHtcbiAgICAgICAgICB2b2lkIHRoaXMuY2xlYXJPdXRwdXRzRm9yRmlsZShmaWxlKTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICAgIH0sXG4gICAgfSk7XG5cbiAgICB0aGlzLnJlZ2lzdGVyQ29kZUJsb2NrUHJvY2Vzc29ycygpO1xuXG4gICAgdGhpcy5yZWdpc3RlckVkaXRvckV4dGVuc2lvbih0aGlzLmNyZWF0ZUxpdmVQcmV2aWV3RXh0ZW5zaW9uKCkpO1xuXG4gICAgdGhpcy5yZWdpc3RlckV2ZW50KFxuICAgICAgdGhpcy5hcHAud29ya3NwYWNlLm9uKFwiZmlsZS1vcGVuXCIsIChmaWxlKSA9PiB7XG4gICAgICAgIHRoaXMubGFzdE1hcmtkb3duRmlsZVBhdGggPSBmaWxlPy5wYXRoID8/IHRoaXMubGFzdE1hcmtkb3duRmlsZVBhdGg7XG4gICAgICAgIHRoaXMucmVmcmVzaEFsbFZpZXdzKCk7XG4gICAgICAgIHZvaWQgdGhpcy5lbmZvcmNlU291cmNlTW9kZUZvckFjdGl2ZVZpZXcoKTtcbiAgICAgICAgaWYgKGZpbGUgJiYgdGhpcy5zZXR0aW5ncy5hdXRvUnVuT25GaWxlT3Blbikge1xuICAgICAgICAgIHZvaWQgdGhpcy5ydW5BbGxCbG9ja3NJbkZpbGUoZmlsZSk7XG4gICAgICAgIH1cbiAgICAgIH0pLFxuICAgICk7XG5cbiAgICB0aGlzLmFkZENvbW1hbmQoe1xuICAgICAgaWQ6IFwibG9vbS12YWxpZGF0ZS1jb250YWluZXItZ3JvdXBzXCIsXG4gICAgICBuYW1lOiBcImxvb206IFZhbGlkYXRlIENvbnRhaW5lciBHcm91cHNcIixcbiAgICAgIGNhbGxiYWNrOiBhc3luYyAoKSA9PiB7XG4gICAgICAgIGNvbnN0IGdyb3VwcyA9IGF3YWl0IHRoaXMuZ2V0Q29udGFpbmVyR3JvdXBTdW1tYXJpZXMoKTtcbiAgICAgICAgbmV3IE5vdGljZShncm91cHMubGVuZ3RoID8gZ3JvdXBzLm1hcCgoZ3JvdXApID0+IGAke2dyb3VwLm5hbWV9OiAke2dyb3VwLnN0YXR1c31gKS5qb2luKFwiXFxuXCIpIDogXCJObyBsb29tIGNvbnRhaW5lciBncm91cHMgZm91bmQuXCIsIDgwMDApO1xuICAgICAgfSxcbiAgICB9KTtcblxuICAgIHRoaXMucmVnaXN0ZXJFdmVudChcbiAgICAgIHRoaXMuYXBwLndvcmtzcGFjZS5vbihcImFjdGl2ZS1sZWFmLWNoYW5nZVwiLCAoKSA9PiB7XG4gICAgICAgIHRoaXMubGFzdE1hcmtkb3duRmlsZVBhdGggPSB0aGlzLmdldEFjdGl2ZU1hcmtkb3duRmlsZSgpPy5wYXRoID8/IHRoaXMubGFzdE1hcmtkb3duRmlsZVBhdGg7XG4gICAgICAgIHZvaWQgdGhpcy5lbmZvcmNlU291cmNlTW9kZUZvckFjdGl2ZVZpZXcoKTtcbiAgICAgIH0pLFxuICAgICk7XG5cbiAgICB0aGlzLnJlZ2lzdGVyRXZlbnQoXG4gICAgICB0aGlzLmFwcC53b3Jrc3BhY2Uub24oXCJlZGl0b3ItY2hhbmdlXCIsIChfZWRpdG9yLCBjdHgpID0+IHtcbiAgICAgICAgaWYgKGN0eCBpbnN0YW5jZW9mIE1hcmtkb3duVmlldykge1xuICAgICAgICAgIHZvaWQgdGhpcy5lbmZvcmNlU291cmNlTW9kZUZvckxlYWYoY3R4LmxlYWYpO1xuICAgICAgICB9XG4gICAgICB9KSxcbiAgICApO1xuICB9XG5cbiAgb251bmxvYWQoKTogdm9pZCB7XG4gICAgZm9yIChjb25zdCBjb250cm9sbGVyIG9mIHRoaXMucnVubmluZy52YWx1ZXMoKSkge1xuICAgICAgY29udHJvbGxlci5hYm9ydCgpO1xuICAgIH1cbiAgfVxuXG4gIGFzeW5jIGxvYWRTZXR0aW5ncygpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICB0aGlzLnNldHRpbmdzID0ge1xuICAgICAgLi4uREVGQVVMVF9TRVRUSU5HUyxcbiAgICAgIC4uLihhd2FpdCB0aGlzLmxvYWREYXRhKCkpLFxuICAgIH07XG4gIH1cblxuICBhc3luYyBzYXZlU2V0dGluZ3MoKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgYXdhaXQgdGhpcy5zYXZlRGF0YSh0aGlzLnNldHRpbmdzKTtcbiAgICB0aGlzLnJlZ2lzdGVyQ29kZUJsb2NrUHJvY2Vzc29ycygpO1xuICAgIHRoaXMucmVmcmVzaEFsbFZpZXdzKCk7XG4gIH1cblxuICBpc0Jsb2NrUnVubmluZyhibG9ja0lkOiBzdHJpbmcpOiBib29sZWFuIHtcbiAgICByZXR1cm4gdGhpcy5ydW5uaW5nLmhhcyhibG9ja0lkKTtcbiAgfVxuXG4gIHJlZ2lzdGVyT3V0cHV0TGlzdGVuZXIoYmxvY2tJZDogc3RyaW5nLCBsaXN0ZW5lcjogKCkgPT4gdm9pZCk6ICgpID0+IHZvaWQge1xuICAgIGlmICghdGhpcy5vdXRwdXRMaXN0ZW5lcnMuaGFzKGJsb2NrSWQpKSB7XG4gICAgICB0aGlzLm91dHB1dExpc3RlbmVycy5zZXQoYmxvY2tJZCwgbmV3IFNldCgpKTtcbiAgICB9XG4gICAgdGhpcy5vdXRwdXRMaXN0ZW5lcnMuZ2V0KGJsb2NrSWQpPy5hZGQobGlzdGVuZXIpO1xuICAgIHJldHVybiAoKSA9PiB7XG4gICAgICB0aGlzLm91dHB1dExpc3RlbmVycy5nZXQoYmxvY2tJZCk/LmRlbGV0ZShsaXN0ZW5lcik7XG4gICAgfTtcbiAgfVxuXG4gIGNyZWF0ZVRvb2xiYXJFbGVtZW50KGJsb2NrOiBsb29tQ29kZUJsb2NrKTogSFRNTEVsZW1lbnQge1xuICAgIHJldHVybiBjcmVhdGVDb2RlQmxvY2tUb29sYmFyKGJsb2NrLmlkLCB0aGlzLmlzQmxvY2tSdW5uaW5nKGJsb2NrLmlkKSwge1xuICAgICAgb25SdW46ICgpID0+IHZvaWQgdGhpcy5ydW5BY3RpdmVCbG9ja0J5SWQoYmxvY2suaWQpLFxuICAgICAgb25Db3B5OiBhc3luYyAoKSA9PiB7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgYXdhaXQgbmF2aWdhdG9yLmNsaXBib2FyZC53cml0ZVRleHQoYmxvY2suY29udGVudCk7XG4gICAgICAgICAgbmV3IE5vdGljZShcIkNvZGUgY29waWVkXCIpO1xuICAgICAgICB9IGNhdGNoIHtcbiAgICAgICAgICBuZXcgTm90aWNlKFwiQ2xpcGJvYXJkIHdyaXRlIGZhaWxlZC5cIik7XG4gICAgICAgIH1cbiAgICAgIH0sXG4gICAgICBvblJlbW92ZTogKCkgPT4gdm9pZCB0aGlzLnJlbW92ZVNuaXBwZXRCeUlkKGJsb2NrLmlkKSxcbiAgICAgIG9uVG9nZ2xlT3V0cHV0OiAoKSA9PiB7XG4gICAgICAgIGNvbnN0IG91dHB1dCA9IHRoaXMub3V0cHV0cy5nZXQoYmxvY2suaWQpO1xuICAgICAgICBpZiAoIW91dHB1dCkge1xuICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICBvdXRwdXQudmlzaWJsZSA9ICFvdXRwdXQudmlzaWJsZTtcbiAgICAgICAgdGhpcy5ub3RpZnlPdXRwdXRDaGFuZ2VkKGJsb2NrLmlkKTtcbiAgICAgIH0sXG4gICAgfSk7XG4gIH1cblxuICByZW5kZXJPdXRwdXRJbnRvKGJsb2NrSWQ6IHN0cmluZywgY29udGFpbmVyOiBIVE1MRWxlbWVudCk6IHZvaWQge1xuICAgIGNvbnRhaW5lci5lbXB0eSgpO1xuXG4gICAgY29uc3Qgb3V0cHV0ID0gdGhpcy5vdXRwdXRzLmdldChibG9ja0lkKTtcbiAgICBpZiAodGhpcy5ydW5uaW5nLmhhcyhibG9ja0lkKSkge1xuICAgICAgY29udGFpbmVyLmFwcGVuZENoaWxkKGNyZWF0ZVJ1bm5pbmdQYW5lbCgpKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBpZiAoIW91dHB1dCB8fCAhb3V0cHV0LnZpc2libGUpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBjb250YWluZXIuYXBwZW5kQ2hpbGQoY3JlYXRlT3V0cHV0UGFuZWwob3V0cHV0KSk7XG4gIH1cblxuICBhc3luYyBydW5BY3RpdmVCbG9ja0J5SWQoYmxvY2tJZDogc3RyaW5nKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3QgYmxvY2sgPSB0aGlzLmZpbmRBY3RpdmVCbG9ja0J5SWQoYmxvY2tJZCk7XG4gICAgY29uc3QgZmlsZSA9IHRoaXMuZ2V0QWN0aXZlTWFya2Rvd25GaWxlKCk7XG4gICAgaWYgKCFibG9jayB8fCAhZmlsZSkge1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBhd2FpdCB0aGlzLnJ1bkJsb2NrKGZpbGUsIGJsb2NrKTtcbiAgfVxuXG4gIGFzeW5jIHJlbW92ZVNuaXBwZXRCeUlkKGJsb2NrSWQ6IHN0cmluZyk6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IGJsb2NrID0gdGhpcy5maW5kQWN0aXZlQmxvY2tCeUlkKGJsb2NrSWQpO1xuICAgIGlmICghYmxvY2spIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBjb25zdCBmaWxlID0gdGhpcy5hcHAudmF1bHQuZ2V0QWJzdHJhY3RGaWxlQnlQYXRoKGJsb2NrLmZpbGVQYXRoKTtcbiAgICBpZiAoIShmaWxlIGluc3RhbmNlb2YgVEZpbGUpKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgdGhpcy5ydW5uaW5nLmdldChibG9ja0lkKT8uYWJvcnQoKTtcbiAgICB0aGlzLnJ1bm5pbmcuZGVsZXRlKGJsb2NrSWQpO1xuICAgIHRoaXMub3V0cHV0cy5kZWxldGUoYmxvY2tJZCk7XG5cbiAgICBhd2FpdCB0aGlzLmFwcC52YXVsdC5wcm9jZXNzKGZpbGUsIChjb250ZW50KSA9PiB7XG4gICAgICBjb25zdCBsaW5lcyA9IGNvbnRlbnQuc3BsaXQoL1xccj9cXG4vKTtcbiAgICAgIGNvbnN0IGJsb2NrcyA9IHBhcnNlTWFya2Rvd25Db2RlQmxvY2tzKGZpbGUucGF0aCwgY29udGVudCwgdGhpcy5zZXR0aW5ncyk7XG4gICAgICBjb25zdCBjdXJyZW50QmxvY2sgPSBibG9ja3MuZmluZCgoY2FuZGlkYXRlKSA9PiBjYW5kaWRhdGUuaWQgPT09IGJsb2NrSWQpO1xuICAgICAgaWYgKCFjdXJyZW50QmxvY2spIHtcbiAgICAgICAgcmV0dXJuIGNvbnRlbnQ7XG4gICAgICB9XG5cbiAgICAgIGNvbnN0IG1hbmFnZWRSYW5nZSA9IHRoaXMuZmluZE1hbmFnZWRPdXRwdXRSYW5nZShsaW5lcywgYmxvY2tJZCk7XG4gICAgICBjb25zdCByZW1vdmFsU3RhcnQgPSBjdXJyZW50QmxvY2suc3RhcnRMaW5lO1xuICAgICAgY29uc3QgcmVtb3ZhbEVuZCA9IG1hbmFnZWRSYW5nZSA/IG1hbmFnZWRSYW5nZS5lbmQgOiBjdXJyZW50QmxvY2suZW5kTGluZTtcbiAgICAgIGxpbmVzLnNwbGljZShyZW1vdmFsU3RhcnQsIHJlbW92YWxFbmQgLSByZW1vdmFsU3RhcnQgKyAxKTtcblxuICAgICAgd2hpbGUgKHJlbW92YWxTdGFydCA8IGxpbmVzLmxlbmd0aCAtIDEgJiYgbGluZXNbcmVtb3ZhbFN0YXJ0XSA9PT0gXCJcIiAmJiBsaW5lc1tyZW1vdmFsU3RhcnQgKyAxXSA9PT0gXCJcIikge1xuICAgICAgICBsaW5lcy5zcGxpY2UocmVtb3ZhbFN0YXJ0LCAxKTtcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIGxpbmVzLmpvaW4oXCJcXG5cIik7XG4gICAgfSk7XG5cbiAgICB0aGlzLm5vdGlmeU91dHB1dENoYW5nZWQoYmxvY2tJZCk7XG4gICAgdGhpcy51cGRhdGVTdGF0dXNCYXIoKTtcbiAgICBuZXcgTm90aWNlKFwibG9vbSBzbmlwcGV0IHJlbW92ZWQuXCIpO1xuICB9XG5cbiAgYXN5bmMgcnVuQWxsQmxvY2tzSW5GaWxlKGZpbGU6IFRGaWxlKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3Qgc291cmNlID0gYXdhaXQgdGhpcy5hcHAudmF1bHQuY2FjaGVkUmVhZChmaWxlKTtcbiAgICBjb25zdCBibG9ja3MgPSBwYXJzZU1hcmtkb3duQ29kZUJsb2NrcyhmaWxlLnBhdGgsIHNvdXJjZSwgdGhpcy5zZXR0aW5ncyk7XG4gICAgY29uc3QgY29udGFpbmVyR3JvdXAgPSB0aGlzLmNvbnRhaW5lclJ1bm5lci5nZXRDb250YWluZXJHcm91cE5hbWUoZmlsZSkgfHwgdGhpcy5zZXR0aW5ncy5kZWZhdWx0Q29udGFpbmVyR3JvdXA7XG4gICAgY29uc3Qgc3VwcG9ydGVkQmxvY2tzID0gY29udGFpbmVyR3JvdXAgPyBibG9ja3MgOiBibG9ja3MuZmlsdGVyKChibG9jaykgPT4gdGhpcy5yZWdpc3RyeS5nZXRSdW5uZXJGb3JCbG9jayhibG9jaywgdGhpcy5zZXR0aW5ncykpO1xuXG4gICAgaWYgKCFzdXBwb3J0ZWRCbG9ja3MubGVuZ3RoKSB7XG4gICAgICBuZXcgTm90aWNlKFwiTm8gc3VwcG9ydGVkIGxvb20gYmxvY2tzIGZvdW5kIGluIHRoZSBjdXJyZW50IG5vdGUuXCIpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGZvciAoY29uc3QgYmxvY2sgb2Ygc3VwcG9ydGVkQmxvY2tzKSB7XG4gICAgICBhd2FpdCB0aGlzLnJ1bkJsb2NrKGZpbGUsIGJsb2NrKTtcbiAgICB9XG4gIH1cblxuICBhc3luYyBjbGVhck91dHB1dHNGb3JGaWxlKGZpbGU6IFRGaWxlKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3Qgc291cmNlID0gYXdhaXQgdGhpcy5hcHAudmF1bHQuY2FjaGVkUmVhZChmaWxlKTtcbiAgICBjb25zdCBibG9ja3MgPSBwYXJzZU1hcmtkb3duQ29kZUJsb2NrcyhmaWxlLnBhdGgsIHNvdXJjZSwgdGhpcy5zZXR0aW5ncyk7XG4gICAgZm9yIChjb25zdCBibG9jayBvZiBibG9ja3MpIHtcbiAgICAgIHRoaXMub3V0cHV0cy5kZWxldGUoYmxvY2suaWQpO1xuICAgICAgdGhpcy5ub3RpZnlPdXRwdXRDaGFuZ2VkKGJsb2NrLmlkKTtcbiAgICAgIGF3YWl0IHRoaXMucmVtb3ZlTWFuYWdlZE91dHB1dEJsb2NrKGZpbGUucGF0aCwgYmxvY2suaWQpO1xuICAgIH1cbiAgICBuZXcgTm90aWNlKFwibG9vbSBvdXRwdXRzIGNsZWFyZWQuXCIpO1xuICB9XG5cbiAgYXN5bmMgcnVuQmxvY2soZmlsZTogVEZpbGUsIGJsb2NrOiBsb29tQ29kZUJsb2NrKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgdGhpcy5sYXN0TWFya2Rvd25GaWxlUGF0aCA9IGZpbGUucGF0aDtcbiAgICBpZiAodGhpcy5ydW5uaW5nLmhhcyhibG9jay5pZCkpIHtcbiAgICAgIG5ldyBOb3RpY2UoXCJUaGlzIGxvb20gYmxvY2sgaXMgYWxyZWFkeSBydW5uaW5nLlwiKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBpZiAoIShhd2FpdCB0aGlzLmVuc3VyZUV4ZWN1dGlvbkVuYWJsZWQoKSkpIHtcbiAgICAgIHNob3dFeGVjdXRpb25EaXNhYmxlZE5vdGljZSgpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGNvbnN0IHdvcmtpbmdEaXJlY3RvcnkgPSB0aGlzLnJlc29sdmVXb3JraW5nRGlyZWN0b3J5KGZpbGUpO1xuICAgIGNvbnN0IGNvbnRhaW5lckdyb3VwID0gdGhpcy5jb250YWluZXJSdW5uZXIuZ2V0Q29udGFpbmVyR3JvdXBOYW1lKGZpbGUpIHx8IHRoaXMuc2V0dGluZ3MuZGVmYXVsdENvbnRhaW5lckdyb3VwO1xuICAgIGNvbnN0IHJ1bm5lciA9IGNvbnRhaW5lckdyb3VwID8gbnVsbCA6IHRoaXMucmVnaXN0cnkuZ2V0UnVubmVyRm9yQmxvY2soYmxvY2ssIHRoaXMuc2V0dGluZ3MpO1xuICAgIGlmICghcnVubmVyKSB7XG4gICAgICBpZiAoIWNvbnRhaW5lckdyb3VwKSB7XG4gICAgICAgIG5ldyBOb3RpY2UoYE5vIGNvbmZpZ3VyZWQgcnVubmVyIGZvciAke2Jsb2NrLmxhbmd1YWdlfS5gKTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuICAgIH1cblxuICAgIGNvbnN0IGNvbnRyb2xsZXIgPSBuZXcgQWJvcnRDb250cm9sbGVyKCk7XG4gICAgY29uc3QgcnVuQ29udGV4dCA9IHtcbiAgICAgIGZpbGUsXG4gICAgICB3b3JraW5nRGlyZWN0b3J5LFxuICAgICAgdGltZW91dE1zOiB0aGlzLnNldHRpbmdzLmRlZmF1bHRUaW1lb3V0TXMsXG4gICAgICBzaWduYWw6IGNvbnRyb2xsZXIuc2lnbmFsLFxuICAgIH07XG4gICAgdGhpcy5ydW5uaW5nLnNldChibG9jay5pZCwgY29udHJvbGxlcik7XG4gICAgdGhpcy5ub3RpZnlPdXRwdXRDaGFuZ2VkKGJsb2NrLmlkKTtcbiAgICB0aGlzLnVwZGF0ZVN0YXR1c0JhcigpO1xuXG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHJlc3VsdCA9IGNvbnRhaW5lckdyb3VwXG4gICAgICAgID8gYXdhaXQgdGhpcy5jb250YWluZXJSdW5uZXIucnVuKGJsb2NrLCBydW5Db250ZXh0LCB0aGlzLnNldHRpbmdzLCBjb250YWluZXJHcm91cClcbiAgICAgICAgOiBhd2FpdCBydW5uZXIhLnJ1bihibG9jaywgcnVuQ29udGV4dCwgdGhpcy5zZXR0aW5ncyk7XG5cbiAgICAgIGlmIChyZXN1bHQudGltZWRPdXQpIHtcbiAgICAgICAgcmVzdWx0LnN0ZGVyciA9IHJlc3VsdC5zdGRlcnIgfHwgYEV4ZWN1dGlvbiB0aW1lZCBvdXQgYWZ0ZXIgJHt0aGlzLnNldHRpbmdzLmRlZmF1bHRUaW1lb3V0TXN9IG1zLmA7XG4gICAgICB9IGVsc2UgaWYgKHJlc3VsdC5jYW5jZWxsZWQpIHtcbiAgICAgICAgcmVzdWx0LnN0ZGVyciA9IHJlc3VsdC5zdGRlcnIgfHwgXCJFeGVjdXRpb24gY2FuY2VsbGVkLlwiO1xuICAgICAgfSBlbHNlIGlmICghcmVzdWx0LnN1Y2Nlc3MgJiYgIXJlc3VsdC5zdGRlcnIudHJpbSgpKSB7XG4gICAgICAgIHJlc3VsdC5zdGRlcnIgPSBcIlByb2Nlc3MgZXhpdGVkIHVuc3VjY2Vzc2Z1bGx5LlwiO1xuICAgICAgfVxuXG4gICAgICB0aGlzLm91dHB1dHMuc2V0KGJsb2NrLmlkLCB7XG4gICAgICAgIGJsb2NrSWQ6IGJsb2NrLmlkLFxuICAgICAgICBibG9jayxcbiAgICAgICAgcmVzdWx0LFxuICAgICAgICBjb2xsYXBzZWQ6IGZhbHNlLFxuICAgICAgICB2aXNpYmxlOiB0cnVlLFxuICAgICAgfSk7XG5cbiAgICAgIGlmICh0aGlzLnNldHRpbmdzLndyaXRlT3V0cHV0VG9Ob3RlKSB7XG4gICAgICAgIGF3YWl0IHRoaXMud3JpdGVNYW5hZ2VkT3V0cHV0QmxvY2soZmlsZSwgYmxvY2ssIHJlc3VsdCk7XG4gICAgICB9XG5cbiAgICAgIGNvbnN0IHJ1bm5lck5hbWUgPSBjb250YWluZXJHcm91cCA/IGBjb250YWluZXIgJHtjb250YWluZXJHcm91cH1gIDogcnVubmVyIS5kaXNwbGF5TmFtZTtcbiAgICAgIG5ldyBOb3RpY2UocmVzdWx0LnN1Y2Nlc3MgPyBgbG9vbSByYW4gJHtydW5uZXJOYW1lfSBibG9jay5gIDogYGxvb20gcnVuIGZhaWxlZCBmb3IgJHtydW5uZXJOYW1lfS5gKTtcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgY29uc3QgbWVzc2FnZSA9IGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogU3RyaW5nKGVycm9yKTtcbiAgICAgIHRoaXMub3V0cHV0cy5zZXQoYmxvY2suaWQsIHtcbiAgICAgICAgYmxvY2tJZDogYmxvY2suaWQsXG4gICAgICAgIGJsb2NrLFxuICAgICAgICBjb2xsYXBzZWQ6IGZhbHNlLFxuICAgICAgICB2aXNpYmxlOiB0cnVlLFxuICAgICAgICByZXN1bHQ6IHtcbiAgICAgICAgICBydW5uZXJJZDogY29udGFpbmVyR3JvdXAgPyBgY29udGFpbmVyOiR7Y29udGFpbmVyR3JvdXB9YCA6IHJ1bm5lcj8uaWQgPz8gXCJ1bmtub3duXCIsXG4gICAgICAgICAgcnVubmVyTmFtZTogY29udGFpbmVyR3JvdXAgPyBgQ29udGFpbmVyICR7Y29udGFpbmVyR3JvdXB9YCA6IHJ1bm5lcj8uZGlzcGxheU5hbWUgPz8gXCJVbmtub3duXCIsXG4gICAgICAgICAgc3RhcnRlZEF0OiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXG4gICAgICAgICAgZmluaXNoZWRBdDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpLFxuICAgICAgICAgIGR1cmF0aW9uTXM6IDAsXG4gICAgICAgICAgZXhpdENvZGU6IC0xLFxuICAgICAgICAgIHN0ZG91dDogXCJcIixcbiAgICAgICAgICBzdGRlcnI6IG1lc3NhZ2UsXG4gICAgICAgICAgc3VjY2VzczogZmFsc2UsXG4gICAgICAgICAgdGltZWRPdXQ6IGZhbHNlLFxuICAgICAgICAgIGNhbmNlbGxlZDogZmFsc2UsXG4gICAgICAgIH0sXG4gICAgICB9KTtcbiAgICAgIG5ldyBOb3RpY2UoYGxvb20gZXJyb3I6ICR7bWVzc2FnZX1gKTtcbiAgICB9IGZpbmFsbHkge1xuICAgICAgdGhpcy5ydW5uaW5nLmRlbGV0ZShibG9jay5pZCk7XG4gICAgICB0aGlzLm5vdGlmeU91dHB1dENoYW5nZWQoYmxvY2suaWQpO1xuICAgICAgdGhpcy51cGRhdGVTdGF0dXNCYXIoKTtcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIGVuc3VyZUV4ZWN1dGlvbkVuYWJsZWQoKTogUHJvbWlzZTxib29sZWFuPiB7XG4gICAgaWYgKHRoaXMuc2V0dGluZ3MuZW5hYmxlTG9jYWxFeGVjdXRpb24gJiYgdGhpcy5zZXR0aW5ncy5oYXNBY2tub3dsZWRnZWRFeGVjdXRpb25SaXNrKSB7XG4gICAgICByZXR1cm4gdHJ1ZTtcbiAgICB9XG5cbiAgICByZXR1cm4gYXdhaXQgbmV3IFByb21pc2U8Ym9vbGVhbj4oKHJlc29sdmUpID0+IHtcbiAgICAgIGxldCBzZXR0bGVkID0gZmFsc2U7XG4gICAgICBjb25zdCBzZXR0bGUgPSAodmFsdWU6IGJvb2xlYW4pID0+IHtcbiAgICAgICAgaWYgKCFzZXR0bGVkKSB7XG4gICAgICAgICAgc2V0dGxlZCA9IHRydWU7XG4gICAgICAgICAgcmVzb2x2ZSh2YWx1ZSk7XG4gICAgICAgIH1cbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IG1vZGFsID0gbmV3IEV4ZWN1dGlvbkNvbnNlbnRNb2RhbCh0aGlzLmFwcCwgYXN5bmMgKCkgPT4ge1xuICAgICAgICB0aGlzLnNldHRpbmdzLmVuYWJsZUxvY2FsRXhlY3V0aW9uID0gdHJ1ZTtcbiAgICAgICAgdGhpcy5zZXR0aW5ncy5oYXNBY2tub3dsZWRnZWRFeGVjdXRpb25SaXNrID0gdHJ1ZTtcbiAgICAgICAgYXdhaXQgdGhpcy5zYXZlU2V0dGluZ3MoKTtcbiAgICAgICAgc2V0dGxlKHRydWUpO1xuICAgICAgfSk7XG5cbiAgICAgIGNvbnN0IG9yaWdpbmFsQ2xvc2UgPSBtb2RhbC5jbG9zZS5iaW5kKG1vZGFsKTtcbiAgICAgIG1vZGFsLmNsb3NlID0gKCkgPT4ge1xuICAgICAgICBvcmlnaW5hbENsb3NlKCk7XG4gICAgICAgIHNldHRsZSh0aGlzLnNldHRpbmdzLmVuYWJsZUxvY2FsRXhlY3V0aW9uICYmIHRoaXMuc2V0dGluZ3MuaGFzQWNrbm93bGVkZ2VkRXhlY3V0aW9uUmlzayk7XG4gICAgICB9O1xuICAgICAgbW9kYWwub3BlbigpO1xuICAgIH0pO1xuICB9XG5cbiAgcHJpdmF0ZSByZXNvbHZlV29ya2luZ0RpcmVjdG9yeShmaWxlOiBURmlsZSk6IHN0cmluZyB7XG4gICAgaWYgKHRoaXMuc2V0dGluZ3Mud29ya2luZ0RpcmVjdG9yeS50cmltKCkpIHtcbiAgICAgIHJldHVybiB0aGlzLnNldHRpbmdzLndvcmtpbmdEaXJlY3RvcnkudHJpbSgpO1xuICAgIH1cblxuICAgIGNvbnN0IGFkYXB0ZXJCYXNlUGF0aCA9ICh0aGlzLmFwcC52YXVsdC5hZGFwdGVyIGFzIHsgYmFzZVBhdGg/OiBzdHJpbmcgfSkuYmFzZVBhdGggPz8gXCJcIjtcbiAgICBjb25zdCBmaWxlRm9sZGVyID0gZGlybmFtZShmaWxlLnBhdGgpO1xuICAgIGNvbnN0IHJlc29sdmVkID0gZmlsZUZvbGRlciA9PT0gXCIuXCIgPyBhZGFwdGVyQmFzZVBhdGggOiBgJHthZGFwdGVyQmFzZVBhdGh9LyR7ZmlsZUZvbGRlcn1gO1xuICAgIHJldHVybiByZXNvbHZlZCB8fCBwcm9jZXNzLmN3ZCgpO1xuICB9XG5cbiAgYXN5bmMgZ2V0Q29udGFpbmVyR3JvdXBTdW1tYXJpZXMoKTogUHJvbWlzZTxBcnJheTx7IG5hbWU6IHN0cmluZzsgc3RhdHVzOiBzdHJpbmcgfT4+IHtcbiAgICByZXR1cm4gdGhpcy5jb250YWluZXJSdW5uZXIuZ2V0R3JvdXBTdW1tYXJpZXMoKTtcbiAgfVxuXG4gIGFzeW5jIGJ1aWxkQ29udGFpbmVyR3JvdXAobmFtZTogc3RyaW5nKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3QgY29udHJvbGxlciA9IG5ldyBBYm9ydENvbnRyb2xsZXIoKTtcbiAgICBjb25zdCByZXN1bHQgPSBhd2FpdCB0aGlzLmNvbnRhaW5lclJ1bm5lci5idWlsZEdyb3VwKG5hbWUsIE1hdGgubWF4KHRoaXMuc2V0dGluZ3MuZGVmYXVsdFRpbWVvdXRNcywgMTIwXzAwMCksIGNvbnRyb2xsZXIuc2lnbmFsKTtcbiAgICBuZXcgTm90aWNlKHJlc3VsdC5zdWNjZXNzID8gYGxvb20gYnVpbHQgY29udGFpbmVyIGdyb3VwICR7bmFtZX0uYCA6IGBsb29tIGNvbnRhaW5lciBidWlsZCBmYWlsZWQgZm9yICR7bmFtZX0uYCwgODAwMCk7XG4gIH1cblxuICByZWdpc3RlckNvZGVCbG9ja1Byb2Nlc3NvcnMoKTogdm9pZCB7XG4gICAgZm9yIChjb25zdCBhbGlhcyBvZiBnZXRTdXBwb3J0ZWRMYW5ndWFnZUFsaWFzZXModGhpcy5zZXR0aW5ncykpIHtcbiAgICAgIGNvbnN0IG5vcm1hbGl6ZWRBbGlhcyA9IGFsaWFzLnRvTG93ZXJDYXNlKCk7XG4gICAgICBpZiAodGhpcy5yZWdpc3RlcmVkQ29kZUJsb2NrQWxpYXNlcy5oYXMobm9ybWFsaXplZEFsaWFzKSkge1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cblxuICAgICAgaWYgKC9bXmEtekEtWjAtOV8tXS8udGVzdChub3JtYWxpemVkQWxpYXMpKSB7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuXG4gICAgICB0aGlzLnJlZ2lzdGVyZWRDb2RlQmxvY2tBbGlhc2VzLmFkZChub3JtYWxpemVkQWxpYXMpO1xuICAgICAgdGhpcy5yZWdpc3Rlck1hcmtkb3duQ29kZUJsb2NrUHJvY2Vzc29yKG5vcm1hbGl6ZWRBbGlhcywgYXN5bmMgKHNvdXJjZSwgZWwsIGN0eCkgPT4ge1xuICAgICAgICBjb25zdCBmaWxlUGF0aCA9IGN0eC5zb3VyY2VQYXRoO1xuICAgICAgICBjb25zdCBmaWxlID0gdGhpcy5hcHAudmF1bHQuZ2V0QWJzdHJhY3RGaWxlQnlQYXRoKGZpbGVQYXRoKTtcbiAgICAgICAgaWYgKCEoZmlsZSBpbnN0YW5jZW9mIFRGaWxlKSkge1xuICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IGZ1bGxUZXh0ID0gYXdhaXQgdGhpcy5hcHAudmF1bHQuY2FjaGVkUmVhZChmaWxlKTtcbiAgICAgICAgY29uc3QgYmxvY2tzID0gcGFyc2VNYXJrZG93bkNvZGVCbG9ja3MoZmlsZVBhdGgsIGZ1bGxUZXh0LCB0aGlzLnNldHRpbmdzKTtcbiAgICAgICAgY29uc3Qgc2VjdGlvbiA9IChjdHggJiYgdHlwZW9mIGN0eC5nZXRTZWN0aW9uSW5mbyA9PT0gXCJmdW5jdGlvblwiKSA/IGN0eC5nZXRTZWN0aW9uSW5mbyhlbCkgOiBudWxsO1xuICAgICAgICBsZXQgYmxvY2s6IGxvb21Db2RlQmxvY2sgfCB1bmRlZmluZWQ7XG4gICAgICAgIGlmIChzZWN0aW9uKSB7XG4gICAgICAgICAgY29uc3QgbGluZVN0YXJ0ID0gc2VjdGlvbi5saW5lU3RhcnQ7XG4gICAgICAgICAgYmxvY2sgPSBibG9ja3MuZmluZCgoY2FuZGlkYXRlKSA9PiBjYW5kaWRhdGUuc3RhcnRMaW5lID09PSBsaW5lU3RhcnQgJiYgY2FuZGlkYXRlLmNvbnRlbnQgPT09IHNvdXJjZSk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgYmxvY2sgPSBibG9ja3MuZmluZCgoY2FuZGlkYXRlKSA9PiBjYW5kaWRhdGUuY29udGVudCA9PT0gc291cmNlKTtcbiAgICAgICAgfVxuICAgICAgICBpZiAoIWJsb2NrKSB7XG4gICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgbGV0IHByZSA9IGVsLnF1ZXJ5U2VsZWN0b3IoXCJwcmVcIikgYXMgSFRNTEVsZW1lbnQgfCBudWxsO1xuICAgICAgICBpZiAoIXByZSkge1xuICAgICAgICAgIHByZSA9IGVsLmNyZWF0ZUVsKFwicHJlXCIpO1xuICAgICAgICAgIHByZS5hZGRDbGFzcyhgbGFuZ3VhZ2UtJHtub3JtYWxpemVkQWxpYXN9YCk7XG4gICAgICAgICAgY29uc3QgY29kZSA9IHByZS5jcmVhdGVFbChcImNvZGVcIik7XG4gICAgICAgICAgY29kZS5hZGRDbGFzcyhgbGFuZ3VhZ2UtJHtub3JtYWxpemVkQWxpYXN9YCk7XG4gICAgICAgICAgY29kZS5zZXRUZXh0KHNvdXJjZSk7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAoYmxvY2subGFuZ3VhZ2UgPT09IFwibGx2bS1pclwiKSB7XG4gICAgICAgICAgY29uc3QgY29kZSA9IChwcmUucXVlcnlTZWxlY3RvcihcImNvZGVcIikgYXMgSFRNTEVsZW1lbnQgfCBudWxsKSA/PyBwcmU7XG4gICAgICAgICAgaGlnaGxpZ2h0TGx2bUVsZW1lbnQoY29kZSwgc291cmNlKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGN0eC5hZGRDaGlsZChuZXcgbG9vbVRvb2xiYXJSZW5kZXJDaGlsZChlbCwgdGhpcywgYmxvY2ssIHByZSkpO1xuICAgICAgfSk7XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSB1cGRhdGVTdGF0dXNCYXIoKTogdm9pZCB7XG4gICAgY29uc3QgYWN0aXZlUnVucyA9IHRoaXMucnVubmluZy5zaXplO1xuICAgIHRoaXMuc3RhdHVzQmFySXRlbUVsLnNldFRleHQoYWN0aXZlUnVucyA/IGBsb29tOiAke2FjdGl2ZVJ1bnN9IEFjdGl2ZSBSdW4ke2FjdGl2ZVJ1bnMgPT09IDEgPyBcIlwiIDogXCJzXCJ9YCA6IFwibG9vbTogSWRsZVwiKTtcbiAgfVxuXG4gIHByaXZhdGUgbm90aWZ5T3V0cHV0Q2hhbmdlZChibG9ja0lkOiBzdHJpbmcpOiB2b2lkIHtcbiAgICB0aGlzLm91dHB1dExpc3RlbmVycy5nZXQoYmxvY2tJZCk/LmZvckVhY2goKGxpc3RlbmVyKSA9PiBsaXN0ZW5lcigpKTtcbiAgICB0aGlzLnJlZnJlc2hBbGxWaWV3cygpO1xuICB9XG5cbiAgcHJpdmF0ZSByZWZyZXNoQWxsVmlld3MoKTogdm9pZCB7XG4gICAgdGhpcy5hcHAud29ya3NwYWNlLmdldExlYXZlc09mVHlwZShcIm1hcmtkb3duXCIpLmZvckVhY2goKGxlYWYpID0+IHtcbiAgICAgIGNvbnN0IHZpZXcgPSBsZWFmLnZpZXcgYXMgTWFya2Rvd25WaWV3O1xuICAgICAgY29uc3QgcHJldmlld01vZGUgPSAodmlldyBhcyB7IHByZXZpZXdNb2RlPzogeyByZXJlbmRlcj86IChmb3JjZT86IGJvb2xlYW4pID0+IHZvaWQgfSB9KS5wcmV2aWV3TW9kZTtcbiAgICAgIHByZXZpZXdNb2RlPy5yZXJlbmRlcj8uKHRydWUpO1xuICAgIH0pO1xuXG4gICAgZm9yIChjb25zdCBlZGl0b3JWaWV3IG9mIHRoaXMuZWRpdG9yVmlld3MpIHtcbiAgICAgIGVkaXRvclZpZXcuZGlzcGF0Y2goeyBlZmZlY3RzOiBsb29tUmVmcmVzaEVmZmVjdC5vZih1bmRlZmluZWQpIH0pO1xuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgZ2V0QWN0aXZlTWFya2Rvd25GaWxlKCk6IFRGaWxlIHwgbnVsbCB7XG4gICAgY29uc3QgdmlldyA9IHRoaXMuYXBwLndvcmtzcGFjZS5nZXRBY3RpdmVWaWV3T2ZUeXBlKE1hcmtkb3duVmlldyk7XG4gICAgcmV0dXJuIHZpZXc/LmZpbGUgPz8gbnVsbDtcbiAgfVxuXG4gIHByaXZhdGUgZ2V0Q3VycmVudEVkaXRvckZpbGVQYXRoKCk6IHN0cmluZyB8IG51bGwge1xuICAgIHJldHVybiB0aGlzLmdldEFjdGl2ZU1hcmtkb3duRmlsZSgpPy5wYXRoID8/IHRoaXMubGFzdE1hcmtkb3duRmlsZVBhdGg7XG4gIH1cblxuICBhc3luYyBlbmZvcmNlU291cmNlTW9kZUZvckFjdGl2ZVZpZXcoKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3QgdmlldyA9IHRoaXMuYXBwLndvcmtzcGFjZS5nZXRBY3RpdmVWaWV3T2ZUeXBlKE1hcmtkb3duVmlldyk7XG4gICAgaWYgKCF2aWV3KSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgYXdhaXQgdGhpcy5lbmZvcmNlU291cmNlTW9kZUZvckxlYWYodmlldy5sZWFmKTtcbiAgfVxuXG4gIGFzeW5jIGRpc2FibGVTb3VyY2VNb2RlRm9yQWN0aXZlVmlldygpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCB2aWV3ID0gdGhpcy5hcHAud29ya3NwYWNlLmdldEFjdGl2ZVZpZXdPZlR5cGUoTWFya2Rvd25WaWV3KTtcbiAgICBpZiAoIXZpZXcpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBjb25zdCBsZWFmID0gdmlldy5sZWFmO1xuICAgIGNvbnN0IHZpZXdTdGF0ZSA9IGxlYWYuZ2V0Vmlld1N0YXRlKCk7XG4gICAgY29uc3Qgc3RhdGUgPSB7IC4uLih2aWV3U3RhdGUuc3RhdGUgPz8ge30pIH0gYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj47XG4gICAgXG4gICAgaWYgKHN0YXRlLm1vZGUgPT09IFwic291cmNlXCIgJiYgc3RhdGUuc291cmNlID09PSB0cnVlKSB7XG4gICAgICBzdGF0ZS5zb3VyY2UgPSBmYWxzZTtcbiAgICAgIGF3YWl0IGxlYWYuc2V0Vmlld1N0YXRlKHtcbiAgICAgICAgLi4udmlld1N0YXRlLFxuICAgICAgICBzdGF0ZSxcbiAgICAgIH0pO1xuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgZW5mb3JjZVNvdXJjZU1vZGVGb3JMZWFmKGxlYWY6IFdvcmtzcGFjZUxlYWYpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBpZiAoIXRoaXMuc2V0dGluZ3MucHJlc2VydmVTb3VyY2VNb2RlKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgaWYgKGxlYWYuaXNEZWZlcnJlZCkge1xuICAgICAgYXdhaXQgbGVhZi5sb2FkSWZEZWZlcnJlZCgpO1xuICAgIH1cblxuICAgIGNvbnN0IHZpZXcgPSBsZWFmLnZpZXc7XG4gICAgaWYgKCEodmlldyBpbnN0YW5jZW9mIE1hcmtkb3duVmlldykgfHwgIXZpZXcuZmlsZSkge1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGNvbnN0IHNvdXJjZSA9IHZpZXcuZWRpdG9yPy5nZXRWYWx1ZT8uKCkgPz8gKGF3YWl0IHRoaXMuYXBwLnZhdWx0LmNhY2hlZFJlYWQodmlldy5maWxlKSk7XG4gICAgY29uc3QgYmxvY2tzID0gcGFyc2VNYXJrZG93bkNvZGVCbG9ja3Modmlldy5maWxlLnBhdGgsIHNvdXJjZSwgdGhpcy5zZXR0aW5ncyk7XG4gICAgaWYgKCFibG9ja3MubGVuZ3RoKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgY29uc3Qgdmlld1N0YXRlID0gbGVhZi5nZXRWaWV3U3RhdGUoKTtcbiAgICBjb25zdCBzdGF0ZSA9IHsgLi4uKHZpZXdTdGF0ZS5zdGF0ZSA/PyB7fSkgfSBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPjtcbiAgICBpZiAoc3RhdGUubW9kZSA9PT0gXCJzb3VyY2VcIiAmJiBzdGF0ZS5zb3VyY2UgPT09IHRydWUpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBzdGF0ZS5tb2RlID0gXCJzb3VyY2VcIjtcbiAgICBzdGF0ZS5zb3VyY2UgPSB0cnVlO1xuXG4gICAgYXdhaXQgbGVhZi5zZXRWaWV3U3RhdGUoe1xuICAgICAgLi4udmlld1N0YXRlLFxuICAgICAgc3RhdGUsXG4gICAgfSk7XG4gIH1cblxuICBwcml2YXRlIGZpbmRBY3RpdmVCbG9ja0J5SWQoYmxvY2tJZDogc3RyaW5nKTogbG9vbUNvZGVCbG9jayB8IG51bGwge1xuICAgIGNvbnN0IHZpZXcgPSB0aGlzLmFwcC53b3Jrc3BhY2UuZ2V0QWN0aXZlVmlld09mVHlwZShNYXJrZG93blZpZXcpO1xuICAgIGNvbnN0IGZpbGUgPSB2aWV3Py5maWxlO1xuICAgIGNvbnN0IGVkaXRvciA9IHZpZXc/LmVkaXRvcjtcbiAgICBpZiAoIWZpbGUgfHwgIWVkaXRvcikge1xuICAgICAgcmV0dXJuIHRoaXMub3V0cHV0cy5nZXQoYmxvY2tJZCk/LmJsb2NrID8/IG51bGw7XG4gICAgfVxuXG4gICAgY29uc3QgYmxvY2tzID0gcGFyc2VNYXJrZG93bkNvZGVCbG9ja3MoZmlsZS5wYXRoLCBlZGl0b3IuZ2V0VmFsdWUoKSwgdGhpcy5zZXR0aW5ncyk7XG4gICAgcmV0dXJuIGJsb2Nrcy5maW5kKChibG9jaykgPT4gYmxvY2suaWQgPT09IGJsb2NrSWQpID8/IHRoaXMub3V0cHV0cy5nZXQoYmxvY2tJZCk/LmJsb2NrID8/IG51bGw7XG4gIH1cblxuICBwcml2YXRlIGNyZWF0ZUxpdmVQcmV2aWV3RXh0ZW5zaW9uKCkge1xuICAgIGNvbnN0IHBsdWdpbiA9IHRoaXM7XG5cbiAgICByZXR1cm4gVmlld1BsdWdpbi5mcm9tQ2xhc3MoXG4gICAgICBjbGFzcyB7XG4gICAgICAgIGRlY29yYXRpb25zO1xuXG4gICAgICAgIGNvbnN0cnVjdG9yKHByaXZhdGUgcmVhZG9ubHkgdmlldzogRWRpdG9yVmlldykge1xuICAgICAgICAgIHBsdWdpbi5lZGl0b3JWaWV3cy5hZGQodmlldyk7XG4gICAgICAgICAgdGhpcy5kZWNvcmF0aW9ucyA9IHRoaXMuYnVpbGREZWNvcmF0aW9ucygpO1xuICAgICAgICB9XG5cbiAgICAgICAgdXBkYXRlKHVwZGF0ZTogVmlld1VwZGF0ZSk6IHZvaWQge1xuICAgICAgICAgIGlmICh1cGRhdGUuZG9jQ2hhbmdlZCB8fCB1cGRhdGUudmlld3BvcnRDaGFuZ2VkIHx8IHVwZGF0ZS50cmFuc2FjdGlvbnMuc29tZSgodHIpID0+IHRyLmVmZmVjdHMuc29tZSgoZWZmZWN0KSA9PiBlZmZlY3QuaXMobG9vbVJlZnJlc2hFZmZlY3QpKSkpIHtcbiAgICAgICAgICAgIHRoaXMuZGVjb3JhdGlvbnMgPSB0aGlzLmJ1aWxkRGVjb3JhdGlvbnMoKTtcbiAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICBkZXN0cm95KCk6IHZvaWQge1xuICAgICAgICAgIHBsdWdpbi5lZGl0b3JWaWV3cy5kZWxldGUodGhpcy52aWV3KTtcbiAgICAgICAgfVxuXG4gICAgICAgIHByaXZhdGUgYnVpbGREZWNvcmF0aW9ucygpIHtcbiAgICAgICAgICBjb25zdCBmaWxlUGF0aCA9IHBsdWdpbi5nZXRDdXJyZW50RWRpdG9yRmlsZVBhdGgoKTtcbiAgICAgICAgICBpZiAoIWZpbGVQYXRoKSB7XG4gICAgICAgICAgICByZXR1cm4gRGVjb3JhdGlvbi5ub25lO1xuICAgICAgICAgIH1cblxuICAgICAgICAgIGNvbnN0IHNvdXJjZSA9IHRoaXMudmlldy5zdGF0ZS5kb2MudG9TdHJpbmcoKTtcbiAgICAgICAgICBjb25zdCBibG9ja3MgPSBwYXJzZU1hcmtkb3duQ29kZUJsb2NrcyhmaWxlUGF0aCwgc291cmNlLCBwbHVnaW4uc2V0dGluZ3MpO1xuICAgICAgICAgIGNvbnN0IGJ1aWxkZXIgPSBuZXcgUmFuZ2VTZXRCdWlsZGVyPERlY29yYXRpb24+KCk7XG5cbiAgICAgICAgICBmb3IgKGNvbnN0IGJsb2NrIG9mIGJsb2Nrcykge1xuICAgICAgICAgICAgY29uc3Qgc3RhcnRMaW5lID0gdGhpcy52aWV3LnN0YXRlLmRvYy5saW5lKGJsb2NrLnN0YXJ0TGluZSArIDEpO1xuICAgICAgICAgICAgYnVpbGRlci5hZGQoXG4gICAgICAgICAgICAgIHN0YXJ0TGluZS5mcm9tLFxuICAgICAgICAgICAgICBzdGFydExpbmUuZnJvbSxcbiAgICAgICAgICAgICAgRGVjb3JhdGlvbi53aWRnZXQoe1xuICAgICAgICAgICAgICAgIHdpZGdldDogbmV3IGxvb21Ub29sYmFyV2lkZ2V0KHBsdWdpbiwgYmxvY2spLFxuICAgICAgICAgICAgICAgIHNpZGU6IC0xLFxuICAgICAgICAgICAgICB9KSxcbiAgICAgICAgICAgICk7XG5cbiAgICAgICAgICAgIGlmIChwbHVnaW4ub3V0cHV0cy5oYXMoYmxvY2suaWQpIHx8IHBsdWdpbi5ydW5uaW5nLmhhcyhibG9jay5pZCkpIHtcbiAgICAgICAgICAgICAgY29uc3QgZW5kTGluZSA9IHRoaXMudmlldy5zdGF0ZS5kb2MubGluZShibG9jay5lbmRMaW5lICsgMSk7XG4gICAgICAgICAgICAgIGJ1aWxkZXIuYWRkKFxuICAgICAgICAgICAgICAgIGVuZExpbmUudG8sXG4gICAgICAgICAgICAgICAgZW5kTGluZS50byxcbiAgICAgICAgICAgICAgICBEZWNvcmF0aW9uLndpZGdldCh7XG4gICAgICAgICAgICAgICAgICB3aWRnZXQ6IG5ldyBsb29tT3V0cHV0V2lkZ2V0KHBsdWdpbiwgYmxvY2suaWQpLFxuICAgICAgICAgICAgICAgICAgc2lkZTogMSxcbiAgICAgICAgICAgICAgICB9KSxcbiAgICAgICAgICAgICAgKTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgaWYgKGJsb2NrLmxhbmd1YWdlID09PSBcImxsdm0taXJcIikge1xuICAgICAgICAgICAgICBhZGRMbHZtRGVjb3JhdGlvbnMoYnVpbGRlciwgdGhpcy52aWV3LCBibG9jayk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfVxuXG4gICAgICAgICAgcmV0dXJuIGJ1aWxkZXIuZmluaXNoKCk7XG4gICAgICAgIH1cbiAgICAgIH0sXG4gICAgICB7XG4gICAgICAgIGRlY29yYXRpb25zOiAodmFsdWUpID0+IHZhbHVlLmRlY29yYXRpb25zLFxuICAgICAgfSxcbiAgICApO1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyB3cml0ZU1hbmFnZWRPdXRwdXRCbG9jayhmaWxlOiBURmlsZSwgYmxvY2s6IGxvb21Db2RlQmxvY2ssIHJlc3VsdDogbG9vbVN0b3JlZE91dHB1dFtcInJlc3VsdFwiXSk6IFByb21pc2U8dm9pZD4ge1xuICAgIGF3YWl0IHRoaXMuYXBwLnZhdWx0LnByb2Nlc3MoZmlsZSwgKGNvbnRlbnQpID0+IHtcbiAgICAgIGNvbnN0IGxpbmVzID0gY29udGVudC5zcGxpdCgvXFxyP1xcbi8pO1xuICAgICAgY29uc3QgYmxvY2tzID0gcGFyc2VNYXJrZG93bkNvZGVCbG9ja3MoZmlsZS5wYXRoLCBjb250ZW50LCB0aGlzLnNldHRpbmdzKTtcbiAgICAgIGNvbnN0IGN1cnJlbnRCbG9jayA9IGJsb2Nrcy5maW5kKChjYW5kaWRhdGUpID0+IGNhbmRpZGF0ZS5pZCA9PT0gYmxvY2suaWQpO1xuICAgICAgY29uc3QgcmVuZGVyZWQgPSB0aGlzLnJlbmRlck1hbmFnZWRPdXRwdXRNYXJrZG93bihibG9jay5pZCwgcmVzdWx0KTtcbiAgICAgIGNvbnN0IGV4aXN0aW5nUmFuZ2UgPSB0aGlzLmZpbmRNYW5hZ2VkT3V0cHV0UmFuZ2UobGluZXMsIGJsb2NrLmlkKTtcblxuICAgICAgaWYgKGV4aXN0aW5nUmFuZ2UpIHtcbiAgICAgICAgbGluZXMuc3BsaWNlKGV4aXN0aW5nUmFuZ2Uuc3RhcnQsIGV4aXN0aW5nUmFuZ2UuZW5kIC0gZXhpc3RpbmdSYW5nZS5zdGFydCArIDEsIC4uLnJlbmRlcmVkKTtcbiAgICAgICAgcmV0dXJuIGxpbmVzLmpvaW4oXCJcXG5cIik7XG4gICAgICB9XG5cbiAgICAgIGlmICghY3VycmVudEJsb2NrKSB7XG4gICAgICAgIHJldHVybiBjb250ZW50O1xuICAgICAgfVxuXG4gICAgICBsaW5lcy5zcGxpY2UoY3VycmVudEJsb2NrLmVuZExpbmUgKyAxLCAwLCAuLi5yZW5kZXJlZCk7XG4gICAgICByZXR1cm4gbGluZXMuam9pbihcIlxcblwiKTtcbiAgICB9KTtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgcmVtb3ZlTWFuYWdlZE91dHB1dEJsb2NrKGZpbGVQYXRoOiBzdHJpbmcsIGJsb2NrSWQ6IHN0cmluZyk6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IGZpbGUgPSB0aGlzLmFwcC52YXVsdC5nZXRBYnN0cmFjdEZpbGVCeVBhdGgoZmlsZVBhdGgpO1xuICAgIGlmICghKGZpbGUgaW5zdGFuY2VvZiBURmlsZSkpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBhd2FpdCB0aGlzLmFwcC52YXVsdC5wcm9jZXNzKGZpbGUsIChjb250ZW50KSA9PiB7XG4gICAgICBjb25zdCBsaW5lcyA9IGNvbnRlbnQuc3BsaXQoL1xccj9cXG4vKTtcbiAgICAgIGNvbnN0IHJhbmdlID0gdGhpcy5maW5kTWFuYWdlZE91dHB1dFJhbmdlKGxpbmVzLCBibG9ja0lkKTtcbiAgICAgIGlmICghcmFuZ2UpIHtcbiAgICAgICAgcmV0dXJuIGNvbnRlbnQ7XG4gICAgICB9XG4gICAgICBsaW5lcy5zcGxpY2UocmFuZ2Uuc3RhcnQsIHJhbmdlLmVuZCAtIHJhbmdlLnN0YXJ0ICsgMSk7XG4gICAgICByZXR1cm4gbGluZXMuam9pbihcIlxcblwiKTtcbiAgICB9KTtcbiAgfVxuXG4gIHByaXZhdGUgcmVuZGVyTWFuYWdlZE91dHB1dE1hcmtkb3duKGJsb2NrSWQ6IHN0cmluZywgcmVzdWx0OiBsb29tU3RvcmVkT3V0cHV0W1wicmVzdWx0XCJdKTogc3RyaW5nW10ge1xuICAgIGNvbnN0IGJvZHkgPSBbXG4gICAgICBgcnVubmVyPSR7cmVzdWx0LnJ1bm5lck5hbWV9YCxcbiAgICAgIGBleGl0PSR7cmVzdWx0LmV4aXRDb2RlID8/IFwiP1wifWAsXG4gICAgICBgZHVyYXRpb249JHtyZXN1bHQuZHVyYXRpb25Nc31tc2AsXG4gICAgICBgdGltZXN0YW1wPSR7cmVzdWx0LmZpbmlzaGVkQXR9YCxcbiAgICAgIHJlc3VsdC5zdGRvdXQgPyBgc3Rkb3V0OlxcbiR7cmVzdWx0LnN0ZG91dH1gIDogXCJcIixcbiAgICAgIHJlc3VsdC53YXJuaW5nID8gYHdhcm5pbmc6XFxuJHtyZXN1bHQud2FybmluZ31gIDogXCJcIixcbiAgICAgIHJlc3VsdC5zdGRlcnIgPyBgc3RkZXJyOlxcbiR7cmVzdWx0LnN0ZGVycn1gIDogXCJcIixcbiAgICBdXG4gICAgICAuZmlsdGVyKEJvb2xlYW4pXG4gICAgICAuam9pbihcIlxcblxcblwiKTtcblxuICAgIHJldHVybiBbXG4gICAgICBgPCEtLSBsb29tOm91dHB1dDpzdGFydCBpZD0ke2Jsb2NrSWR9IC0tPmAsXG4gICAgICBcImBgYHRleHRcIixcbiAgICAgIGJvZHksXG4gICAgICBcImBgYFwiLFxuICAgICAgXCI8IS0tIGxvb206b3V0cHV0OmVuZCAtLT5cIixcbiAgICBdO1xuICB9XG5cbiAgcHJpdmF0ZSBmaW5kTWFuYWdlZE91dHB1dFJhbmdlKGxpbmVzOiBzdHJpbmdbXSwgYmxvY2tJZDogc3RyaW5nKTogeyBzdGFydDogbnVtYmVyOyBlbmQ6IG51bWJlciB9IHwgbnVsbCB7XG4gICAgY29uc3Qgc3RhcnRNYXJrZXIgPSBgPCEtLSBsb29tOm91dHB1dDpzdGFydCBpZD0ke2Jsb2NrSWR9IC0tPmA7XG4gICAgZm9yIChsZXQgaSA9IDA7IGkgPCBsaW5lcy5sZW5ndGg7IGkgKz0gMSkge1xuICAgICAgaWYgKGxpbmVzW2ldLnRyaW0oKSAhPT0gc3RhcnRNYXJrZXIpIHtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG5cbiAgICAgIGZvciAobGV0IGogPSBpICsgMTsgaiA8IGxpbmVzLmxlbmd0aDsgaiArPSAxKSB7XG4gICAgICAgIGlmIChsaW5lc1tqXS50cmltKCkgPT09IFwiPCEtLSBsb29tOm91dHB1dDplbmQgLS0+XCIpIHtcbiAgICAgICAgICByZXR1cm4geyBzdGFydDogaSwgZW5kOiBqIH07XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cbn1cbiIsICJpbXBvcnQgeyBOb3RpY2UsIHR5cGUgQXBwLCB0eXBlIFRGaWxlIH0gZnJvbSBcIm9ic2lkaWFuXCI7XG5pbXBvcnQgeyBjbG9zZVN5bmMsIGV4aXN0c1N5bmMsIG9wZW5TeW5jIH0gZnJvbSBcImZzXCI7XG5pbXBvcnQgeyBta2RpciwgcmVhZEZpbGUsIHJlYWRkaXIsIHJtLCB3cml0ZUZpbGUgfSBmcm9tIFwiZnMvcHJvbWlzZXNcIjtcbmltcG9ydCB7IGJhc2VuYW1lLCBqb2luLCBub3JtYWxpemUgYXMgbm9ybWFsaXplRnNQYXRoLCBwb3NpeCBhcyBwb3NpeFBhdGggfSBmcm9tIFwicGF0aFwiO1xuaW1wb3J0IHsgc3Bhd24gfSBmcm9tIFwiY2hpbGRfcHJvY2Vzc1wiO1xuaW1wb3J0IHsgcnVuUHJvY2VzcyB9IGZyb20gXCIuL3Byb2Nlc3NSdW5uZXJcIjtcbmltcG9ydCB7IHNwbGl0Q29tbWFuZExpbmUgfSBmcm9tIFwiLi4vdXRpbHMvY29tbWFuZFwiO1xuaW1wb3J0IHR5cGUgeyBsb29tQ29kZUJsb2NrLCBsb29tUGx1Z2luU2V0dGluZ3MsIGxvb21SdW5Db250ZXh0LCBsb29tUnVuUmVzdWx0IH0gZnJvbSBcIi4uL3R5cGVzXCI7XG5cbnR5cGUgbG9vbUNvbnRhaW5lclJ1bnRpbWUgPSBcImRvY2tlclwiIHwgXCJwb2RtYW5cIiB8IFwicWVtdVwiIHwgXCJ3c2xcIiB8IFwiY3VzdG9tXCI7XG5cbmludGVyZmFjZSBsb29tQ29udGFpbmVyTGFuZ3VhZ2VDb25maWcge1xuICBjb21tYW5kPzogc3RyaW5nO1xuICBleHRlbnNpb24/OiBzdHJpbmc7XG4gIHVzZURlZmF1bHQ/OiBib29sZWFuO1xufVxuXG5pbnRlcmZhY2UgbG9vbUNvbW1hbmRFeHBlY3RhdGlvbiB7XG4gIGNvbW1hbmQ6IHN0cmluZztcbiAgcG9zaXRpdmVSZXNwb25zZT86IHN0cmluZztcbiAgbmVnYXRpdmVSZXNwb25zZT86IHN0cmluZztcbn1cblxuaW50ZXJmYWNlIGxvb21RZW11Q29uZmlnIHtcbiAgc3NoVGFyZ2V0OiBzdHJpbmc7XG4gIHJlbW90ZVdvcmtzcGFjZTogc3RyaW5nO1xuICBzc2hFeGVjdXRhYmxlPzogc3RyaW5nO1xuICBzc2hBcmdzPzogc3RyaW5nO1xuICBzdGFydENvbW1hbmQ/OiBzdHJpbmc7XG4gIGJ1aWxkQ29tbWFuZD86IHN0cmluZztcbiAgdGVhcmRvd25Db21tYW5kPzogc3RyaW5nO1xuICBoZWFsdGhDaGVjaz86IGxvb21Db21tYW5kRXhwZWN0YXRpb247XG4gIG1hbmFnZXI/OiBsb29tUWVtdU1hbmFnZXJDb25maWc7XG59XG5cbmludGVyZmFjZSBsb29tUWVtdU1hbmFnZXJDb25maWcge1xuICBlbmFibGVkOiBib29sZWFuO1xuICBleGVjdXRhYmxlPzogc3RyaW5nO1xuICBhcmdzPzogc3RyaW5nO1xuICBpbWFnZT86IHN0cmluZztcbiAgaW1hZ2VGb3JtYXQ/OiBzdHJpbmc7XG4gIHBpZEZpbGU/OiBzdHJpbmc7XG4gIGxvZ0ZpbGU/OiBzdHJpbmc7XG4gIHJlYWRpbmVzc1RpbWVvdXRNcz86IG51bWJlcjtcbiAgcmVhZGluZXNzSW50ZXJ2YWxNcz86IG51bWJlcjtcbiAgYm9vdERlbGF5TXM/OiBudW1iZXI7XG4gIHNodXRkb3duQ29tbWFuZD86IHN0cmluZztcbiAgc2h1dGRvd25UaW1lb3V0TXM/OiBudW1iZXI7XG4gIGtpbGxTaWduYWw/OiBOb2RlSlMuU2lnbmFscztcbiAgcGVyc2lzdD86IGJvb2xlYW47XG59XG5cbmludGVyZmFjZSBsb29tQ3VzdG9tUnVudGltZUNvbmZpZyB7XG4gIGV4ZWN1dGFibGU6IHN0cmluZztcbiAgYXJncz86IHN0cmluZztcbiAgYnVpbGQ/OiBzdHJpbmc7XG4gIGNvbW1hbmRTdHJ1Y3R1cmU/OiBzdHJpbmc7XG4gIHRlYXJkb3duPzogc3RyaW5nO1xuICBoZWFsdGhDaGVjaz86IGxvb21Db21tYW5kRXhwZWN0YXRpb247XG59XG5cbmludGVyZmFjZSBsb29tV3NsQ29uZmlnIHtcbiAgaW50ZXJhY3RpdmU/OiBib29sZWFuO1xufVxuXG5pbnRlcmZhY2UgbG9vbUNvbnRhaW5lckNvbmZpZyB7XG4gIHJ1bnRpbWU6IGxvb21Db250YWluZXJSdW50aW1lO1xuICBleGVjdXRhYmxlPzogc3RyaW5nO1xuICBpbWFnZT86IHN0cmluZztcbiAgd3NsPzogbG9vbVdzbENvbmZpZztcbiAgaGVhbHRoQ2hlY2s/OiBsb29tQ29tbWFuZEV4cGVjdGF0aW9uO1xuICBxZW11PzogbG9vbVFlbXVDb25maWc7XG4gIGN1c3RvbT86IGxvb21DdXN0b21SdW50aW1lQ29uZmlnO1xuICBsYW5ndWFnZXM6IFJlY29yZDxzdHJpbmcsIGxvb21Db250YWluZXJMYW5ndWFnZUNvbmZpZz47XG59XG5cbmludGVyZmFjZSBsb29tQ3VzdG9tUnVudGltZVJlcXVlc3Qge1xuICBhY3Rpb246IFwiYnVpbGRcIiB8IFwicnVuXCIgfCBcInRlYXJkb3duXCI7XG4gIGdyb3VwTmFtZTogc3RyaW5nO1xuICBncm91cFBhdGg6IHN0cmluZztcbiAgcnVudGltZTogbG9vbUNvbnRhaW5lclJ1bnRpbWU7XG4gIGltYWdlPzogc3RyaW5nO1xuICBidWlsZD86IHN0cmluZztcbiAgY29tbWFuZFN0cnVjdHVyZT86IHN0cmluZztcbiAgdGVhcmRvd24/OiBzdHJpbmc7XG4gIGxhbmd1YWdlPzogc3RyaW5nO1xuICBsYW5ndWFnZUFsaWFzPzogc3RyaW5nO1xuICBmaWxlTmFtZT86IHN0cmluZztcbiAgZmlsZVBhdGg/OiBzdHJpbmc7XG4gIGNvbW1hbmQ/OiBzdHJpbmc7XG4gIHRpbWVvdXRNczogbnVtYmVyO1xuICBjb25maWc6IHtcbiAgICBleGVjdXRhYmxlPzogc3RyaW5nO1xuICAgIGN1c3RvbT86IGxvb21DdXN0b21SdW50aW1lQ29uZmlnO1xuICAgIHFlbXU/OiBsb29tUWVtdUNvbmZpZztcbiAgICBoZWFsdGhDaGVjaz86IGxvb21Db21tYW5kRXhwZWN0YXRpb247XG4gIH07XG59XG5cbmV4cG9ydCBjbGFzcyBsb29tQ29udGFpbmVyUnVubmVyIHtcbiAgcHJpdmF0ZSByZWFkb25seSBidWlsdEltYWdlcyA9IG5ldyBTZXQ8c3RyaW5nPigpO1xuXG4gIGNvbnN0cnVjdG9yKFxuICAgIHByaXZhdGUgcmVhZG9ubHkgYXBwOiBBcHAsXG4gICAgcHJpdmF0ZSByZWFkb25seSBwbHVnaW5EaXI6IHN0cmluZyxcbiAgKSB7IH1cblxuICBnZXRDb250YWluZXJHcm91cE5hbWUoZmlsZTogVEZpbGUpOiBzdHJpbmcgfCBudWxsIHtcbiAgICBjb25zdCBmcm9udG1hdHRlciA9IHRoaXMuYXBwLm1ldGFkYXRhQ2FjaGUuZ2V0RmlsZUNhY2hlKGZpbGUpPy5mcm9udG1hdHRlcjtcbiAgICBjb25zdCB2YWx1ZSA9IGZyb250bWF0dGVyPy5bXCJsb29tLWNvbnRhaW5lclwiXTtcbiAgICByZXR1cm4gdHlwZW9mIHZhbHVlID09PSBcInN0cmluZ1wiICYmIHZhbHVlLnRyaW0oKSA/IHZhbHVlLnRyaW0oKSA6IG51bGw7XG4gIH1cblxuICBhc3luYyBnZXRHcm91cFN1bW1hcmllcygpOiBQcm9taXNlPEFycmF5PHsgbmFtZTogc3RyaW5nOyBzdGF0dXM6IHN0cmluZyB9Pj4ge1xuICAgIGNvbnN0IGNvbnRhaW5lcnNQYXRoID0gdGhpcy5nZXRDb250YWluZXJzUGF0aCgpO1xuICAgIGlmICghZXhpc3RzU3luYyhjb250YWluZXJzUGF0aCkpIHtcbiAgICAgIHJldHVybiBbXTtcbiAgICB9XG5cbiAgICBjb25zdCBlbnRyaWVzID0gYXdhaXQgcmVhZGRpcihjb250YWluZXJzUGF0aCwgeyB3aXRoRmlsZVR5cGVzOiB0cnVlIH0pO1xuICAgIHJldHVybiBQcm9taXNlLmFsbChcbiAgICAgIGVudHJpZXNcbiAgICAgICAgLmZpbHRlcigoZW50cnkpID0+IGVudHJ5LmlzRGlyZWN0b3J5KCkpXG4gICAgICAgIC5tYXAoYXN5bmMgKGVudHJ5KSA9PiB7XG4gICAgICAgICAgY29uc3QgZ3JvdXBQYXRoID0gam9pbihjb250YWluZXJzUGF0aCwgZW50cnkubmFtZSk7XG4gICAgICAgICAgY29uc3QgaGFzQ29uZmlnID0gZXhpc3RzU3luYyhqb2luKGdyb3VwUGF0aCwgXCJjb25maWcuanNvblwiKSk7XG4gICAgICAgICAgY29uc3QgaGFzRG9ja2VyZmlsZSA9IGV4aXN0c1N5bmMoam9pbihncm91cFBhdGgsIFwiRG9ja2VyZmlsZVwiKSk7XG4gICAgICAgICAgaWYgKCFoYXNDb25maWcpIHtcbiAgICAgICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICAgIG5hbWU6IGVudHJ5Lm5hbWUsXG4gICAgICAgICAgICAgIHN0YXR1czogXCJtaXNzaW5nIGNvbmZpZy5qc29uXCIsXG4gICAgICAgICAgICB9O1xuICAgICAgICAgIH1cbiAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgY29uc3QgY29uZmlnID0gYXdhaXQgdGhpcy5yZWFkQ29uZmlnKGdyb3VwUGF0aCk7XG4gICAgICAgICAgICBjb25zdCBwaWVjZXMgPSBbYHJ1bnRpbWU6ICR7Y29uZmlnLnJ1bnRpbWV9YF07XG4gICAgICAgICAgICBpZiAoKGNvbmZpZy5ydW50aW1lID09PSBcImRvY2tlclwiIHx8IGNvbmZpZy5ydW50aW1lID09PSBcInBvZG1hblwiKSAmJiBoYXNEb2NrZXJmaWxlKSB7XG4gICAgICAgICAgICAgIHBpZWNlcy5wdXNoKFwiRG9ja2VyZmlsZVwiKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmIChjb25maWcucnVudGltZSA9PT0gXCJxZW11XCIgJiYgY29uZmlnLnFlbXU/LnNzaFRhcmdldCkge1xuICAgICAgICAgICAgICBwaWVjZXMucHVzaChgc3NoOiAke2NvbmZpZy5xZW11LnNzaFRhcmdldH1gKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmIChjb25maWcucnVudGltZSA9PT0gXCJxZW11XCIgJiYgY29uZmlnLnFlbXU/Lm1hbmFnZXI/LmVuYWJsZWQpIHtcbiAgICAgICAgICAgICAgcGllY2VzLnB1c2goYG1hbmFnZXI6ICR7YXdhaXQgdGhpcy5nZXRNYW5hZ2VkUWVtdVN0YXR1cyhncm91cFBhdGgsIGNvbmZpZy5xZW11Lm1hbmFnZXIpfWApO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKGNvbmZpZy5ydW50aW1lID09PSBcImN1c3RvbVwiICYmIGNvbmZpZy5jdXN0b20/LmV4ZWN1dGFibGUpIHtcbiAgICAgICAgICAgICAgcGllY2VzLnB1c2goYHdyYXBwZXI6ICR7Y29uZmlnLmN1c3RvbS5leGVjdXRhYmxlfWApO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgY29uc3QgbGFuZ3VhZ2VDb3VudCA9IE9iamVjdC5rZXlzKGNvbmZpZy5sYW5ndWFnZXMpLmxlbmd0aDtcbiAgICAgICAgICAgIHBpZWNlcy5wdXNoKGAke2xhbmd1YWdlQ291bnR9IGxhbmd1YWdlJHtsYW5ndWFnZUNvdW50ID09PSAxID8gXCJcIiA6IFwic1wifWApO1xuICAgICAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgICAgbmFtZTogZW50cnkubmFtZSxcbiAgICAgICAgICAgICAgc3RhdHVzOiBwaWVjZXMuam9pbihcIiwgXCIpLFxuICAgICAgICAgICAgfTtcbiAgICAgICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgICAgbmFtZTogZW50cnkubmFtZSxcbiAgICAgICAgICAgICAgc3RhdHVzOiBgaW52YWxpZCBjb25maWcuanNvbjogJHtlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IubWVzc2FnZSA6IFN0cmluZyhlcnJvcil9YCxcbiAgICAgICAgICAgIH07XG4gICAgICAgICAgfVxuICAgICAgICB9KSxcbiAgICApO1xuICB9XG5cbiAgYXN5bmMgcnVuKGJsb2NrOiBsb29tQ29kZUJsb2NrLCBjb250ZXh0OiBsb29tUnVuQ29udGV4dCwgc2V0dGluZ3M6IGxvb21QbHVnaW5TZXR0aW5ncywgZ3JvdXBOYW1lOiBzdHJpbmcpOiBQcm9taXNlPGxvb21SdW5SZXN1bHQ+IHtcbiAgICBjb25zdCBncm91cFBhdGggPSB0aGlzLnJlc29sdmVHcm91cFBhdGgoZ3JvdXBOYW1lKTtcbiAgICBjb25zdCBjb25maWcgPSBhd2FpdCB0aGlzLnJlYWRDb25maWcoZ3JvdXBQYXRoKTtcbiAgICBjb25zdCBjb25maWdMYW5nID0gY29uZmlnLmxhbmd1YWdlc1tibG9jay5sYW5ndWFnZV0gPz8gY29uZmlnLmxhbmd1YWdlc1tibG9jay5sYW5ndWFnZUFsaWFzXTtcblxuICAgIGxldCBpc0ZhbGxiYWNrID0gZmFsc2U7XG4gICAgbGV0IGxhbmd1YWdlOiBsb29tQ29udGFpbmVyTGFuZ3VhZ2VDb25maWcgfCBudWxsID0gbnVsbDtcblxuICAgIGlmIChjb25maWdMYW5nKSB7XG4gICAgICBpZiAoY29uZmlnTGFuZy51c2VEZWZhdWx0KSB7XG4gICAgICAgIGxhbmd1YWdlID0gdGhpcy5nZXREZWZhdWx0TGFuZ3VhZ2VDb25maWcoYmxvY2subGFuZ3VhZ2UsIHNldHRpbmdzKSA/PyB0aGlzLmdldERlZmF1bHRMYW5ndWFnZUNvbmZpZyhibG9jay5sYW5ndWFnZUFsaWFzLCBzZXR0aW5ncyk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBsYW5ndWFnZSA9IGNvbmZpZ0xhbmc7XG4gICAgICB9XG4gICAgfSBlbHNlIHtcbiAgICAgIGxhbmd1YWdlID0gdGhpcy5nZXREZWZhdWx0TGFuZ3VhZ2VDb25maWcoYmxvY2subGFuZ3VhZ2UsIHNldHRpbmdzKSA/PyB0aGlzLmdldERlZmF1bHRMYW5ndWFnZUNvbmZpZyhibG9jay5sYW5ndWFnZUFsaWFzLCBzZXR0aW5ncyk7XG4gICAgICBpc0ZhbGxiYWNrID0gdHJ1ZTtcbiAgICB9XG5cbiAgICBpZiAoIWxhbmd1YWdlIHx8ICFsYW5ndWFnZS5jb21tYW5kIHx8ICFsYW5ndWFnZS5leHRlbnNpb24pIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgQ29udGFpbmVyIGdyb3VwICR7Z3JvdXBOYW1lfSBoYXMgbm8gY29tbWFuZCBmb3IgJHtibG9jay5sYW5ndWFnZX0uYCk7XG4gICAgfVxuXG4gICAgYXdhaXQgbWtkaXIoZ3JvdXBQYXRoLCB7IHJlY3Vyc2l2ZTogdHJ1ZSB9KTtcbiAgICBhd2FpdCB0aGlzLnJ1bkhlYWx0aENoZWNrKGNvbmZpZy5oZWFsdGhDaGVjaywgZ3JvdXBQYXRoLCBjb250ZXh0LnRpbWVvdXRNcywgY29udGV4dC5zaWduYWwsIGBjb250YWluZXI6JHtncm91cE5hbWV9OmhlYWx0aGAsIGBDb250YWluZXIgJHtncm91cE5hbWV9IGhlYWx0aCBjaGVja2ApO1xuICAgIGNvbnN0IHRlbXBGaWxlTmFtZSA9IGB0ZW1wXyR7RGF0ZS5ub3coKX1fJHtNYXRoLnJhbmRvbSgpLnRvU3RyaW5nKDE2KS5zbGljZSgyKX0ke25vcm1hbGl6ZUV4dGVuc2lvbihsYW5ndWFnZS5leHRlbnNpb24pfWA7XG4gICAgY29uc3QgdGVtcEZpbGVQYXRoID0gam9pbihncm91cFBhdGgsIHRlbXBGaWxlTmFtZSk7XG5cbiAgICB0cnkge1xuICAgICAgYXdhaXQgd3JpdGVGaWxlKHRlbXBGaWxlUGF0aCwgYmxvY2suY29udGVudCwgXCJ1dGY4XCIpO1xuICAgICAgbGV0IHJlc3VsdDogbG9vbVJ1blJlc3VsdDtcbiAgICAgIHN3aXRjaCAoY29uZmlnLnJ1bnRpbWUpIHtcbiAgICAgICAgY2FzZSBcImRvY2tlclwiOlxuICAgICAgICBjYXNlIFwicG9kbWFuXCI6XG4gICAgICAgICAgcmVzdWx0ID0gYXdhaXQgdGhpcy5ydW5PY2lDb250YWluZXIoZ3JvdXBOYW1lLCBncm91cFBhdGgsIGNvbmZpZywgbGFuZ3VhZ2UsIHRlbXBGaWxlTmFtZSwgY29udGV4dCwgc2V0dGluZ3MpO1xuICAgICAgICAgIGJyZWFrO1xuICAgICAgICBjYXNlIFwicWVtdVwiOlxuICAgICAgICAgIHJlc3VsdCA9IGF3YWl0IHRoaXMucnVuUWVtdShncm91cE5hbWUsIGdyb3VwUGF0aCwgY29uZmlnLCBsYW5ndWFnZSwgdGVtcEZpbGVOYW1lLCBjb250ZXh0KTtcbiAgICAgICAgICBicmVhaztcbiAgICAgICAgY2FzZSBcImN1c3RvbVwiOlxuICAgICAgICAgIHJlc3VsdCA9IGF3YWl0IHRoaXMucnVuQ3VzdG9tKGdyb3VwTmFtZSwgZ3JvdXBQYXRoLCBjb25maWcsIGJsb2NrLCBsYW5ndWFnZSwgdGVtcEZpbGVOYW1lLCB0ZW1wRmlsZVBhdGgsIGNvbnRleHQpO1xuICAgICAgICAgIGJyZWFrO1xuICAgICAgICBjYXNlIFwid3NsXCI6XG4gICAgICAgICAgcmVzdWx0ID0gYXdhaXQgdGhpcy5ydW5Xc2xDb250YWluZXIoZ3JvdXBOYW1lLCBncm91cFBhdGgsIGNvbmZpZywgbGFuZ3VhZ2UsIHRlbXBGaWxlTmFtZSwgY29udGV4dCk7XG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgIGRlZmF1bHQ6XG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBVbnN1cHBvcnRlZCBydW50aW1lOiAke2NvbmZpZy5ydW50aW1lfWApO1xuICAgICAgfVxuXG4gICAgICBpZiAoaXNGYWxsYmFjaykge1xuICAgICAgICBjb25zdCBmYWxsYmFja01zZyA9IGBbTG9vbV0gTGFuZ3VhZ2UgJyR7YmxvY2subGFuZ3VhZ2V9JyB3YXMgbm90IGRlY2xhcmVkIGluIGNvbnRhaW5lciBncm91cC4gUnVubmluZyB1c2luZyBkZWZhdWx0IGNvbW1hbmQ6ICR7bGFuZ3VhZ2UuY29tbWFuZH1gO1xuICAgICAgICByZXN1bHQud2FybmluZyA9IHJlc3VsdC53YXJuaW5nID8gYCR7cmVzdWx0Lndhcm5pbmd9XFxuJHtmYWxsYmFja01zZ31gIDogZmFsbGJhY2tNc2c7XG4gICAgICB9XG4gICAgICByZXR1cm4gcmVzdWx0O1xuICAgIH0gZmluYWxseSB7XG4gICAgICBhd2FpdCBybSh0ZW1wRmlsZVBhdGgsIHsgZm9yY2U6IHRydWUgfSk7XG4gICAgfVxuICB9XG5cbiAgYXN5bmMgYnVpbGRHcm91cChncm91cE5hbWU6IHN0cmluZywgdGltZW91dE1zOiBudW1iZXIsIHNpZ25hbDogQWJvcnRTaWduYWwpOiBQcm9taXNlPGxvb21SdW5SZXN1bHQ+IHtcbiAgICBjb25zdCBncm91cFBhdGggPSB0aGlzLnJlc29sdmVHcm91cFBhdGgoZ3JvdXBOYW1lKTtcbiAgICBjb25zdCBjb25maWcgPSBhd2FpdCB0aGlzLnJlYWRDb25maWcoZ3JvdXBQYXRoKTtcbiAgICBhd2FpdCBta2Rpcihncm91cFBhdGgsIHsgcmVjdXJzaXZlOiB0cnVlIH0pO1xuICAgIGF3YWl0IHRoaXMucnVuSGVhbHRoQ2hlY2soY29uZmlnLmhlYWx0aENoZWNrLCBncm91cFBhdGgsIHRpbWVvdXRNcywgc2lnbmFsLCBgY29udGFpbmVyOiR7Z3JvdXBOYW1lfTpoZWFsdGhgLCBgQ29udGFpbmVyICR7Z3JvdXBOYW1lfSBoZWFsdGggY2hlY2tgKTtcbiAgICBzd2l0Y2ggKGNvbmZpZy5ydW50aW1lKSB7XG4gICAgICBjYXNlIFwiZG9ja2VyXCI6XG4gICAgICBjYXNlIFwicG9kbWFuXCI6XG4gICAgICAgIHJldHVybiB0aGlzLmJ1aWxkSW1hZ2UoZ3JvdXBOYW1lLCBncm91cFBhdGgsIGNvbmZpZywgdGltZW91dE1zLCBzaWduYWwpO1xuICAgICAgY2FzZSBcInFlbXVcIjpcbiAgICAgICAgcmV0dXJuIHRoaXMuYnVpbGRRZW11KGdyb3VwTmFtZSwgZ3JvdXBQYXRoLCBjb25maWcsIHRpbWVvdXRNcywgc2lnbmFsKTtcbiAgICAgIGNhc2UgXCJjdXN0b21cIjpcbiAgICAgICAgcmV0dXJuIHRoaXMucnVuQ3VzdG9tV3JhcHBlcihncm91cE5hbWUsIGdyb3VwUGF0aCwgY29uZmlnLCB0aGlzLmNyZWF0ZUN1c3RvbVJlcXVlc3QoXCJidWlsZFwiLCBncm91cE5hbWUsIGdyb3VwUGF0aCwgY29uZmlnLCB0aW1lb3V0TXMpLCB0aW1lb3V0TXMsIHNpZ25hbCk7XG4gICAgICBjYXNlIFwid3NsXCI6XG4gICAgICAgIHJldHVybiB0aGlzLmNyZWF0ZVN5bnRoZXRpY1Jlc3VsdChcbiAgICAgICAgICBgY29udGFpbmVyOiR7Z3JvdXBOYW1lfTp3c2w6YnVpbGRgLFxuICAgICAgICAgIGBXU0wgJHtncm91cE5hbWV9IGJ1aWxkYCxcbiAgICAgICAgICBgV1NMIGVudmlyb25tZW50ICR7Y29uZmlnLmltYWdlIHx8IFwiKGRlZmF1bHQpXCJ9IGRvZXMgbm90IHJlcXVpcmUgYSBidWlsZCBzdGVwLlxcbmAsXG4gICAgICAgICk7XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBydW5PY2lDb250YWluZXIoXG4gICAgZ3JvdXBOYW1lOiBzdHJpbmcsXG4gICAgZ3JvdXBQYXRoOiBzdHJpbmcsXG4gICAgY29uZmlnOiBsb29tQ29udGFpbmVyQ29uZmlnLFxuICAgIGxhbmd1YWdlOiBsb29tQ29udGFpbmVyTGFuZ3VhZ2VDb25maWcsXG4gICAgdGVtcEZpbGVOYW1lOiBzdHJpbmcsXG4gICAgY29udGV4dDogbG9vbVJ1bkNvbnRleHQsXG4gICAgc2V0dGluZ3M6IGxvb21QbHVnaW5TZXR0aW5ncyxcbiAgKTogUHJvbWlzZTxsb29tUnVuUmVzdWx0PiB7XG4gICAgY29uc3QgaW1hZ2UgPSBhd2FpdCB0aGlzLnJlc29sdmVJbWFnZShncm91cE5hbWUsIGdyb3VwUGF0aCwgY29uZmlnLCBjb250ZXh0LCBzZXR0aW5ncyk7XG4gICAgY29uc3QgY29tbWFuZCA9IHNwbGl0Q29tbWFuZExpbmUobGFuZ3VhZ2UuY29tbWFuZCEucmVwbGFjZUFsbChcIntmaWxlfVwiLCB0ZW1wRmlsZU5hbWUpKTtcbiAgICBpZiAoIWNvbW1hbmQubGVuZ3RoKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJDb250YWluZXIgY29tbWFuZCBpcyBlbXB0eS5cIik7XG4gICAgfVxuXG4gICAgcmV0dXJuIGF3YWl0IHJ1blByb2Nlc3Moe1xuICAgICAgcnVubmVySWQ6IGBjb250YWluZXI6JHtncm91cE5hbWV9YCxcbiAgICAgIHJ1bm5lck5hbWU6IGAke3J1bnRpbWVMYWJlbChjb25maWcucnVudGltZSl9ICR7Z3JvdXBOYW1lfWAsXG4gICAgICBleGVjdXRhYmxlOiB0aGlzLnJ1bnRpbWVFeGVjdXRhYmxlKGNvbmZpZyksXG4gICAgICBhcmdzOiBbXG4gICAgICAgIFwicnVuXCIsXG4gICAgICAgIFwiLS1ybVwiLFxuICAgICAgICBcIi12XCIsXG4gICAgICAgIGAke2dyb3VwUGF0aH06L3dvcmtzcGFjZWAsXG4gICAgICAgIFwiLXdcIixcbiAgICAgICAgXCIvd29ya3NwYWNlXCIsXG4gICAgICAgIGltYWdlLFxuICAgICAgICAuLi5jb21tYW5kLFxuICAgICAgXSxcbiAgICAgIHdvcmtpbmdEaXJlY3Rvcnk6IGdyb3VwUGF0aCxcbiAgICAgIHRpbWVvdXRNczogY29udGV4dC50aW1lb3V0TXMsXG4gICAgICBzaWduYWw6IGNvbnRleHQuc2lnbmFsLFxuICAgIH0pO1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBydW5RZW11KFxuICAgIGdyb3VwTmFtZTogc3RyaW5nLFxuICAgIGdyb3VwUGF0aDogc3RyaW5nLFxuICAgIGNvbmZpZzogbG9vbUNvbnRhaW5lckNvbmZpZyxcbiAgICBsYW5ndWFnZTogbG9vbUNvbnRhaW5lckxhbmd1YWdlQ29uZmlnLFxuICAgIHRlbXBGaWxlTmFtZTogc3RyaW5nLFxuICAgIGNvbnRleHQ6IGxvb21SdW5Db250ZXh0LFxuICApOiBQcm9taXNlPGxvb21SdW5SZXN1bHQ+IHtcbiAgICBjb25zdCBxZW11ID0gdGhpcy5yZXF1aXJlUWVtdUNvbmZpZyhjb25maWcpO1xuICAgIGF3YWl0IHRoaXMucnVuT3B0aW9uYWxDb21tYW5kKHFlbXUuc3RhcnRDb21tYW5kLCBncm91cFBhdGgsIGNvbnRleHQudGltZW91dE1zLCBjb250ZXh0LnNpZ25hbCwgYGNvbnRhaW5lcjoke2dyb3VwTmFtZX06cWVtdTpzdGFydGAsIGBRRU1VICR7Z3JvdXBOYW1lfSBzdGFydGApO1xuICAgIGF3YWl0IHRoaXMuZW5zdXJlTWFuYWdlZFFlbXUoZ3JvdXBOYW1lLCBncm91cFBhdGgsIHFlbXUsIGNvbnRleHQudGltZW91dE1zLCBjb250ZXh0LnNpZ25hbCk7XG4gICAgYXdhaXQgdGhpcy5ydW5IZWFsdGhDaGVjayhxZW11LmhlYWx0aENoZWNrLCBncm91cFBhdGgsIGNvbnRleHQudGltZW91dE1zLCBjb250ZXh0LnNpZ25hbCwgYGNvbnRhaW5lcjoke2dyb3VwTmFtZX06cWVtdTpoZWFsdGhgLCBgUUVNVSAke2dyb3VwTmFtZX0gaGVhbHRoIGNoZWNrYCk7XG5cbiAgICB0cnkge1xuICAgICAgY29uc3QgcmVtb3RlRmlsZSA9IHBvc2l4UGF0aC5qb2luKHFlbXUucmVtb3RlV29ya3NwYWNlLCB0ZW1wRmlsZU5hbWUpO1xuICAgICAgY29uc3QgcmVtb3RlQ29tbWFuZCA9IGxhbmd1YWdlLmNvbW1hbmQhLnJlcGxhY2VBbGwoXCJ7ZmlsZX1cIiwgc2hlbGxRdW90ZShyZW1vdGVGaWxlKSk7XG4gICAgICBpZiAoIXJlbW90ZUNvbW1hbmQudHJpbSgpKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihcIlFFTVUgY29tbWFuZCBpcyBlbXB0eS5cIik7XG4gICAgICB9XG5cbiAgICAgIHJldHVybiBhd2FpdCBydW5Qcm9jZXNzKHtcbiAgICAgICAgcnVubmVySWQ6IGBjb250YWluZXI6JHtncm91cE5hbWV9OnFlbXVgLFxuICAgICAgICBydW5uZXJOYW1lOiBgUUVNVSAke2dyb3VwTmFtZX1gLFxuICAgICAgICBleGVjdXRhYmxlOiBxZW11LnNzaEV4ZWN1dGFibGUgfHwgXCJzc2hcIixcbiAgICAgICAgYXJnczogW1xuICAgICAgICAgIC4uLnNwbGl0Q29tbWFuZExpbmUocWVtdS5zc2hBcmdzIHx8IFwiXCIpLFxuICAgICAgICAgIHFlbXUuc3NoVGFyZ2V0LFxuICAgICAgICAgIGBjZCAke3NoZWxsUXVvdGUocWVtdS5yZW1vdGVXb3Jrc3BhY2UpfSAmJiAke3JlbW90ZUNvbW1hbmR9YCxcbiAgICAgICAgXSxcbiAgICAgICAgd29ya2luZ0RpcmVjdG9yeTogZ3JvdXBQYXRoLFxuICAgICAgICB0aW1lb3V0TXM6IGNvbnRleHQudGltZW91dE1zLFxuICAgICAgICBzaWduYWw6IGNvbnRleHQuc2lnbmFsLFxuICAgICAgfSk7XG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIGF3YWl0IHRoaXMucnVuT3B0aW9uYWxDb21tYW5kKHFlbXUudGVhcmRvd25Db21tYW5kLCBncm91cFBhdGgsIGNvbnRleHQudGltZW91dE1zLCBjb250ZXh0LnNpZ25hbCwgYGNvbnRhaW5lcjoke2dyb3VwTmFtZX06cWVtdTp0ZWFyZG93bmAsIGBRRU1VICR7Z3JvdXBOYW1lfSB0ZWFyZG93bmApO1xuICAgICAgYXdhaXQgdGhpcy5zdG9wTWFuYWdlZFFlbXVJZk5lZWRlZChncm91cE5hbWUsIGdyb3VwUGF0aCwgcWVtdSwgY29udGV4dC50aW1lb3V0TXMsIGNvbnRleHQuc2lnbmFsKTtcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIHJ1bkN1c3RvbShcbiAgICBncm91cE5hbWU6IHN0cmluZyxcbiAgICBncm91cFBhdGg6IHN0cmluZyxcbiAgICBjb25maWc6IGxvb21Db250YWluZXJDb25maWcsXG4gICAgYmxvY2s6IGxvb21Db2RlQmxvY2ssXG4gICAgbGFuZ3VhZ2U6IGxvb21Db250YWluZXJMYW5ndWFnZUNvbmZpZyxcbiAgICB0ZW1wRmlsZU5hbWU6IHN0cmluZyxcbiAgICB0ZW1wRmlsZVBhdGg6IHN0cmluZyxcbiAgICBjb250ZXh0OiBsb29tUnVuQ29udGV4dCxcbiAgKTogUHJvbWlzZTxsb29tUnVuUmVzdWx0PiB7XG4gICAgY29uc3QgY29tbWFuZCA9IGxhbmd1YWdlLmNvbW1hbmQhLnJlcGxhY2VBbGwoXCJ7ZmlsZX1cIiwgdGVtcEZpbGVOYW1lKTtcbiAgICBjb25zdCByZXN1bHQgPSBhd2FpdCB0aGlzLnJ1bkN1c3RvbVdyYXBwZXIoXG4gICAgICBncm91cE5hbWUsXG4gICAgICBncm91cFBhdGgsXG4gICAgICBjb25maWcsXG4gICAgICB0aGlzLmNyZWF0ZUN1c3RvbVJlcXVlc3QoXCJydW5cIiwgZ3JvdXBOYW1lLCBncm91cFBhdGgsIGNvbmZpZywgY29udGV4dC50aW1lb3V0TXMsIHtcbiAgICAgICAgbGFuZ3VhZ2U6IGJsb2NrLmxhbmd1YWdlLFxuICAgICAgICBsYW5ndWFnZUFsaWFzOiBibG9jay5sYW5ndWFnZUFsaWFzLFxuICAgICAgICBmaWxlTmFtZTogdGVtcEZpbGVOYW1lLFxuICAgICAgICBmaWxlUGF0aDogdGVtcEZpbGVQYXRoLFxuICAgICAgICBjb21tYW5kLFxuICAgICAgfSksXG4gICAgICBjb250ZXh0LnRpbWVvdXRNcyxcbiAgICAgIGNvbnRleHQuc2lnbmFsLFxuICAgICk7XG5cbiAgICBpZiAoY29uZmlnLmN1c3RvbT8udGVhcmRvd24pIHtcbiAgICAgIGNvbnN0IHRlYXJkb3duID0gYXdhaXQgdGhpcy5ydW5DdXN0b21XcmFwcGVyKFxuICAgICAgICBncm91cE5hbWUsXG4gICAgICAgIGdyb3VwUGF0aCxcbiAgICAgICAgY29uZmlnLFxuICAgICAgICB0aGlzLmNyZWF0ZUN1c3RvbVJlcXVlc3QoXCJ0ZWFyZG93blwiLCBncm91cE5hbWUsIGdyb3VwUGF0aCwgY29uZmlnLCBjb250ZXh0LnRpbWVvdXRNcywge1xuICAgICAgICAgIGxhbmd1YWdlOiBibG9jay5sYW5ndWFnZSxcbiAgICAgICAgICBsYW5ndWFnZUFsaWFzOiBibG9jay5sYW5ndWFnZUFsaWFzLFxuICAgICAgICAgIGZpbGVOYW1lOiB0ZW1wRmlsZU5hbWUsXG4gICAgICAgICAgZmlsZVBhdGg6IHRlbXBGaWxlUGF0aCxcbiAgICAgICAgICBjb21tYW5kLFxuICAgICAgICB9KSxcbiAgICAgICAgY29udGV4dC50aW1lb3V0TXMsXG4gICAgICAgIGNvbnRleHQuc2lnbmFsLFxuICAgICAgKTtcbiAgICAgIGlmICghdGVhcmRvd24uc3VjY2Vzcykge1xuICAgICAgICByZXN1bHQud2FybmluZyA9IGBDdXN0b20gcnVudGltZSB0ZWFyZG93biBmYWlsZWQ6ICR7dGVhcmRvd24uc3RkZXJyIHx8IHRlYXJkb3duLnN0ZG91dCB8fCBgZXhpdCAke3RlYXJkb3duLmV4aXRDb2RlfWB9YDtcbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gcmVzdWx0O1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBydW5Xc2xDb250YWluZXIoXG4gICAgZ3JvdXBOYW1lOiBzdHJpbmcsXG4gICAgZ3JvdXBQYXRoOiBzdHJpbmcsXG4gICAgY29uZmlnOiBsb29tQ29udGFpbmVyQ29uZmlnLFxuICAgIGxhbmd1YWdlOiBsb29tQ29udGFpbmVyTGFuZ3VhZ2VDb25maWcsXG4gICAgdGVtcEZpbGVOYW1lOiBzdHJpbmcsXG4gICAgY29udGV4dDogbG9vbVJ1bkNvbnRleHQsXG4gICk6IFByb21pc2U8bG9vbVJ1blJlc3VsdD4ge1xuICAgIGNvbnN0IHdzbEdyb3VwUGF0aCA9IHRoaXMudHJhbnNsYXRlVG9Xc2xQYXRoKGdyb3VwUGF0aCk7XG4gICAgY29uc3QgY29tbWFuZCA9IGxhbmd1YWdlLmNvbW1hbmQhLnJlcGxhY2VBbGwoXCJ7ZmlsZX1cIiwgdGVtcEZpbGVOYW1lKTtcbiAgICBpZiAoIWNvbW1hbmQudHJpbSgpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJXU0wgY29tbWFuZCBpcyBlbXB0eS5cIik7XG4gICAgfVxuXG4gICAgY29uc3Qgc2hlbGxGbGFncyA9IGNvbmZpZy53c2w/LmludGVyYWN0aXZlID8gW1wiLWlcIiwgXCItbFwiLCBcIi1jXCJdIDogW1wiLWxcIiwgXCItY1wiXTtcbiAgICBjb25zdCB3c2xBcmdzID0gW1wiYmFzaFwiLCAuLi5zaGVsbEZsYWdzLCBgY2QgXCIke3dzbEdyb3VwUGF0aC5yZXBsYWNlQWxsKCdcIicsICdcXFxcXCInKX1cIiAmJiAke2NvbW1hbmR9YF07XG4gICAgaWYgKGNvbmZpZy5pbWFnZT8udHJpbSgpKSB7XG4gICAgICB3c2xBcmdzLnVuc2hpZnQoXCItZFwiLCBjb25maWcuaW1hZ2UudHJpbSgpKTtcbiAgICB9XG5cbiAgICByZXR1cm4gYXdhaXQgcnVuUHJvY2Vzcyh7XG4gICAgICBydW5uZXJJZDogYGNvbnRhaW5lcjoke2dyb3VwTmFtZX06d3NsYCxcbiAgICAgIHJ1bm5lck5hbWU6IGBXU0wgJHtncm91cE5hbWV9YCxcbiAgICAgIGV4ZWN1dGFibGU6IFwid3NsXCIsXG4gICAgICBhcmdzOiB3c2xBcmdzLFxuICAgICAgd29ya2luZ0RpcmVjdG9yeTogZ3JvdXBQYXRoLFxuICAgICAgdGltZW91dE1zOiBjb250ZXh0LnRpbWVvdXRNcyxcbiAgICAgIHNpZ25hbDogY29udGV4dC5zaWduYWwsXG4gICAgfSk7XG4gIH1cblxuICBwcml2YXRlIHRyYW5zbGF0ZVRvV3NsUGF0aCh3aW5kb3dzUGF0aDogc3RyaW5nKTogc3RyaW5nIHtcbiAgICBjb25zdCBtYXRjaCA9IHdpbmRvd3NQYXRoLm1hdGNoKC9eKFtBLVphLXpdKTpcXFxcKC4qKS8pO1xuICAgIGlmIChtYXRjaCkge1xuICAgICAgY29uc3QgZHJpdmUgPSBtYXRjaFsxXS50b0xvd2VyQ2FzZSgpO1xuICAgICAgY29uc3QgcmVzdCA9IG1hdGNoWzJdLnJlcGxhY2UoL1xcXFwvZywgXCIvXCIpO1xuICAgICAgcmV0dXJuIGAvbW50LyR7ZHJpdmV9LyR7cmVzdH1gO1xuICAgIH1cbiAgICBpZiAod2luZG93c1BhdGguaW5jbHVkZXMoXCJcXFxcXCIpKSB7XG4gICAgICByZXR1cm4gd2luZG93c1BhdGgucmVwbGFjZSgvXFxcXC9nLCBcIi9cIik7XG4gICAgfVxuICAgIHJldHVybiB3aW5kb3dzUGF0aDtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgcmVzb2x2ZUltYWdlKFxuICAgIGdyb3VwTmFtZTogc3RyaW5nLFxuICAgIGdyb3VwUGF0aDogc3RyaW5nLFxuICAgIGNvbmZpZzogbG9vbUNvbnRhaW5lckNvbmZpZyxcbiAgICBjb250ZXh0OiBsb29tUnVuQ29udGV4dCxcbiAgICBzZXR0aW5nczogbG9vbVBsdWdpblNldHRpbmdzLFxuICApOiBQcm9taXNlPHN0cmluZz4ge1xuICAgIGNvbnN0IGRvY2tlcmZpbGUgPSBqb2luKGdyb3VwUGF0aCwgXCJEb2NrZXJmaWxlXCIpO1xuICAgIGlmICghZXhpc3RzU3luYyhkb2NrZXJmaWxlKSkge1xuICAgICAgcmV0dXJuIGNvbmZpZy5pbWFnZSB8fCBcInVidW50dTpsYXRlc3RcIjtcbiAgICB9XG5cbiAgICBjb25zdCBpbWFnZSA9IHRoaXMuaW1hZ2VOYW1lRm9yR3JvdXAoZ3JvdXBOYW1lKTtcbiAgICBjb25zdCBjYWNoZUtleSA9IGAke3RoaXMucnVudGltZUV4ZWN1dGFibGUoY29uZmlnKX06JHtpbWFnZX1gO1xuICAgIGlmICh0aGlzLmJ1aWx0SW1hZ2VzLmhhcyhjYWNoZUtleSkpIHtcbiAgICAgIHJldHVybiBpbWFnZTtcbiAgICB9XG5cbiAgICBjb25zdCByZXN1bHQgPSBhd2FpdCB0aGlzLmJ1aWxkSW1hZ2UoZ3JvdXBOYW1lLCBncm91cFBhdGgsIGNvbmZpZywgTWF0aC5tYXgoY29udGV4dC50aW1lb3V0TXMsIHNldHRpbmdzLmRlZmF1bHRUaW1lb3V0TXMsIDEyMF8wMDApLCBjb250ZXh0LnNpZ25hbCk7XG4gICAgaWYgKCFyZXN1bHQuc3VjY2Vzcykge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKHJlc3VsdC5zdGRlcnIgfHwgcmVzdWx0LnN0ZG91dCB8fCBgJHtydW50aW1lTGFiZWwoY29uZmlnLnJ1bnRpbWUpfSBidWlsZCBmYWlsZWQgZm9yICR7Z3JvdXBOYW1lfS5gKTtcbiAgICB9XG5cbiAgICB0aGlzLmJ1aWx0SW1hZ2VzLmFkZChjYWNoZUtleSk7XG4gICAgcmV0dXJuIGltYWdlO1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBidWlsZEltYWdlKFxuICAgIGdyb3VwTmFtZTogc3RyaW5nLFxuICAgIGdyb3VwUGF0aDogc3RyaW5nLFxuICAgIGNvbmZpZzogbG9vbUNvbnRhaW5lckNvbmZpZyxcbiAgICB0aW1lb3V0TXM6IG51bWJlcixcbiAgICBzaWduYWw6IEFib3J0U2lnbmFsLFxuICApOiBQcm9taXNlPGxvb21SdW5SZXN1bHQ+IHtcbiAgICBjb25zdCBpbWFnZSA9IHRoaXMuaW1hZ2VOYW1lRm9yR3JvdXAoZ3JvdXBOYW1lKTtcbiAgICBpZiAoIWV4aXN0c1N5bmMoam9pbihncm91cFBhdGgsIFwiRG9ja2VyZmlsZVwiKSkpIHtcbiAgICAgIHJldHVybiB0aGlzLmNyZWF0ZVN5bnRoZXRpY1Jlc3VsdChcbiAgICAgICAgYGNvbnRhaW5lcjoke2dyb3VwTmFtZX06YnVpbGRgLFxuICAgICAgICBgJHtydW50aW1lTGFiZWwoY29uZmlnLnJ1bnRpbWUpfSAke2dyb3VwTmFtZX0gYnVpbGRgLFxuICAgICAgICBgTm8gRG9ja2VyZmlsZSBjb25maWd1cmVkLiBVc2luZyBpbWFnZSAke2NvbmZpZy5pbWFnZSB8fCBcInVidW50dTpsYXRlc3RcIn0uXFxuYCxcbiAgICAgICk7XG4gICAgfVxuICAgIHJldHVybiBydW5Qcm9jZXNzKHtcbiAgICAgIHJ1bm5lcklkOiBgY29udGFpbmVyOiR7Z3JvdXBOYW1lfTpidWlsZGAsXG4gICAgICBydW5uZXJOYW1lOiBgJHtydW50aW1lTGFiZWwoY29uZmlnLnJ1bnRpbWUpfSAke2dyb3VwTmFtZX0gYnVpbGRgLFxuICAgICAgZXhlY3V0YWJsZTogdGhpcy5ydW50aW1lRXhlY3V0YWJsZShjb25maWcpLFxuICAgICAgYXJnczogW1wiYnVpbGRcIiwgXCItdFwiLCBpbWFnZSwgZ3JvdXBQYXRoXSxcbiAgICAgIHdvcmtpbmdEaXJlY3Rvcnk6IGdyb3VwUGF0aCxcbiAgICAgIHRpbWVvdXRNcyxcbiAgICAgIHNpZ25hbCxcbiAgICB9KTtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgYnVpbGRRZW11KGdyb3VwTmFtZTogc3RyaW5nLCBncm91cFBhdGg6IHN0cmluZywgY29uZmlnOiBsb29tQ29udGFpbmVyQ29uZmlnLCB0aW1lb3V0TXM6IG51bWJlciwgc2lnbmFsOiBBYm9ydFNpZ25hbCk6IFByb21pc2U8bG9vbVJ1blJlc3VsdD4ge1xuICAgIGNvbnN0IHFlbXUgPSB0aGlzLnJlcXVpcmVRZW11Q29uZmlnKGNvbmZpZyk7XG4gICAgaWYgKCFxZW11LmJ1aWxkQ29tbWFuZD8udHJpbSgpKSB7XG4gICAgICByZXR1cm4gdGhpcy5jcmVhdGVTeW50aGV0aWNSZXN1bHQoYGNvbnRhaW5lcjoke2dyb3VwTmFtZX06cWVtdTpidWlsZGAsIGBRRU1VICR7Z3JvdXBOYW1lfSBidWlsZGAsIFwiTm8gUUVNVSBidWlsZCBjb21tYW5kIGNvbmZpZ3VyZWQuXFxuXCIpO1xuICAgIH1cbiAgICByZXR1cm4gdGhpcy5ydW5Db21tYW5kTGluZShxZW11LmJ1aWxkQ29tbWFuZCwgZ3JvdXBQYXRoLCB0aW1lb3V0TXMsIHNpZ25hbCwgYGNvbnRhaW5lcjoke2dyb3VwTmFtZX06cWVtdTpidWlsZGAsIGBRRU1VICR7Z3JvdXBOYW1lfSBidWlsZGApO1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyByZWFkQ29uZmlnKGdyb3VwUGF0aDogc3RyaW5nKTogUHJvbWlzZTxsb29tQ29udGFpbmVyQ29uZmlnPiB7XG4gICAgY29uc3QgY29uZmlnUGF0aCA9IGpvaW4oZ3JvdXBQYXRoLCBcImNvbmZpZy5qc29uXCIpO1xuICAgIGxldCByYXc6IHVua25vd247XG4gICAgdHJ5IHtcbiAgICAgIHJhdyA9IEpTT04ucGFyc2UoYXdhaXQgcmVhZEZpbGUoY29uZmlnUGF0aCwgXCJ1dGY4XCIpKTtcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBVbmFibGUgdG8gcmVhZCBjb250YWluZXIgY29uZmlnICR7Y29uZmlnUGF0aH06ICR7ZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiBTdHJpbmcoZXJyb3IpfWApO1xuICAgIH1cblxuICAgIGlmICghcmF3IHx8IHR5cGVvZiByYXcgIT09IFwib2JqZWN0XCIgfHwgQXJyYXkuaXNBcnJheShyYXcpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJDb250YWluZXIgY29uZmlnIG11c3QgYmUgYW4gb2JqZWN0LlwiKTtcbiAgICB9XG5cbiAgICBjb25zdCBkYXRhID0gcmF3IGFzIHtcbiAgICAgIHJ1bnRpbWU/OiB1bmtub3duO1xuICAgICAgZXhlY3V0YWJsZT86IHVua25vd247XG4gICAgICBpbWFnZT86IHVua25vd247XG4gICAgICB3c2w/OiB1bmtub3duO1xuICAgICAgaGVhbHRoQ2hlY2s/OiB1bmtub3duO1xuICAgICAgcWVtdT86IHVua25vd247XG4gICAgICBjdXN0b20/OiB1bmtub3duO1xuICAgICAgbGFuZ3VhZ2VzPzogdW5rbm93bjtcbiAgICB9O1xuICAgIGNvbnN0IHJ1bnRpbWUgPSB0aGlzLnJlYWRSdW50aW1lKGRhdGEucnVudGltZSk7XG4gICAgaWYgKGRhdGEuZXhlY3V0YWJsZSAhPSBudWxsICYmIHR5cGVvZiBkYXRhLmV4ZWN1dGFibGUgIT09IFwic3RyaW5nXCIpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIkNvbnRhaW5lciBjb25maWcgZXhlY3V0YWJsZSBtdXN0IGJlIGEgc3RyaW5nLlwiKTtcbiAgICB9XG4gICAgaWYgKGRhdGEuaW1hZ2UgIT0gbnVsbCAmJiB0eXBlb2YgZGF0YS5pbWFnZSAhPT0gXCJzdHJpbmdcIikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiQ29udGFpbmVyIGNvbmZpZyBpbWFnZSBtdXN0IGJlIGEgc3RyaW5nLlwiKTtcbiAgICB9XG4gICAgaWYgKCFkYXRhLmxhbmd1YWdlcyB8fCB0eXBlb2YgZGF0YS5sYW5ndWFnZXMgIT09IFwib2JqZWN0XCIgfHwgQXJyYXkuaXNBcnJheShkYXRhLmxhbmd1YWdlcykpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIkNvbnRhaW5lciBjb25maWcgbGFuZ3VhZ2VzIG11c3QgYmUgYW4gb2JqZWN0LlwiKTtcbiAgICB9XG5cbiAgICBjb25zdCBsYW5ndWFnZXM6IFJlY29yZDxzdHJpbmcsIGxvb21Db250YWluZXJMYW5ndWFnZUNvbmZpZz4gPSB7fTtcbiAgICBmb3IgKGNvbnN0IFtsYW5ndWFnZSwgdmFsdWVdIG9mIE9iamVjdC5lbnRyaWVzKGRhdGEubGFuZ3VhZ2VzIGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+KSkge1xuICAgICAgaWYgKCF2YWx1ZSB8fCB0eXBlb2YgdmFsdWUgIT09IFwib2JqZWN0XCIgfHwgQXJyYXkuaXNBcnJheSh2YWx1ZSkpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBDb250YWluZXIgbGFuZ3VhZ2UgJHtsYW5ndWFnZX0gbXVzdCBiZSBhbiBvYmplY3QuYCk7XG4gICAgICB9XG4gICAgICBjb25zdCBsYW5ndWFnZUNvbmZpZyA9IHZhbHVlIGFzIHsgY29tbWFuZD86IHVua25vd247IGV4dGVuc2lvbj86IHVua25vd247IHVzZURlZmF1bHQ/OiB1bmtub3duIH07XG4gICAgICBjb25zdCB1c2VEZWZhdWx0ID0gbGFuZ3VhZ2VDb25maWcudXNlRGVmYXVsdCA9PT0gdHJ1ZTtcblxuICAgICAgaWYgKCF1c2VEZWZhdWx0ICYmICh0eXBlb2YgbGFuZ3VhZ2VDb25maWcuY29tbWFuZCAhPT0gXCJzdHJpbmdcIiB8fCAhbGFuZ3VhZ2VDb25maWcuY29tbWFuZC50cmltKCkpKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgQ29udGFpbmVyIGxhbmd1YWdlICR7bGFuZ3VhZ2V9IG11c3QgZGVmaW5lIGNvbW1hbmQgb3IgdXNlRGVmYXVsdC5gKTtcbiAgICAgIH1cblxuICAgICAgbGFuZ3VhZ2VzW2xhbmd1YWdlXSA9IHtcbiAgICAgICAgY29tbWFuZDogdHlwZW9mIGxhbmd1YWdlQ29uZmlnLmNvbW1hbmQgPT09IFwic3RyaW5nXCIgPyBsYW5ndWFnZUNvbmZpZy5jb21tYW5kIDogdW5kZWZpbmVkLFxuICAgICAgICBleHRlbnNpb246IHR5cGVvZiBsYW5ndWFnZUNvbmZpZy5leHRlbnNpb24gPT09IFwic3RyaW5nXCIgPyBsYW5ndWFnZUNvbmZpZy5leHRlbnNpb24gOiB1c2VEZWZhdWx0ID8gdW5kZWZpbmVkIDogYC4ke2xhbmd1YWdlfWAsXG4gICAgICAgIHVzZURlZmF1bHQ6IHVzZURlZmF1bHQgfHwgdW5kZWZpbmVkLFxuICAgICAgfTtcbiAgICB9XG5cbiAgICByZXR1cm4ge1xuICAgICAgcnVudGltZSxcbiAgICAgIGV4ZWN1dGFibGU6IHR5cGVvZiBkYXRhLmV4ZWN1dGFibGUgPT09IFwic3RyaW5nXCIgJiYgZGF0YS5leGVjdXRhYmxlLnRyaW0oKSA/IGRhdGEuZXhlY3V0YWJsZS50cmltKCkgOiB1bmRlZmluZWQsXG4gICAgICBpbWFnZTogdHlwZW9mIGRhdGEuaW1hZ2UgPT09IFwic3RyaW5nXCIgPyBkYXRhLmltYWdlIDogdW5kZWZpbmVkLFxuICAgICAgd3NsOiB0aGlzLnJlYWRXc2xDb25maWcoZGF0YS53c2wpLFxuICAgICAgaGVhbHRoQ2hlY2s6IHRoaXMucmVhZEhlYWx0aENoZWNrKGRhdGEuaGVhbHRoQ2hlY2ssIFwiQ29udGFpbmVyIGNvbmZpZyBoZWFsdGhDaGVja1wiKSxcbiAgICAgIHFlbXU6IHRoaXMucmVhZFFlbXVDb25maWcoZGF0YS5xZW11KSxcbiAgICAgIGN1c3RvbTogdGhpcy5yZWFkQ3VzdG9tQ29uZmlnKGRhdGEuY3VzdG9tKSxcbiAgICAgIGxhbmd1YWdlcyxcbiAgICB9O1xuICB9XG5cbiAgcHJpdmF0ZSByZWFkUnVudGltZSh2YWx1ZTogdW5rbm93bik6IGxvb21Db250YWluZXJSdW50aW1lIHtcbiAgICBpZiAodmFsdWUgPT0gbnVsbCkge1xuICAgICAgcmV0dXJuIFwiZG9ja2VyXCI7XG4gICAgfVxuICAgIGlmICh2YWx1ZSA9PT0gXCJkb2NrZXJcIiB8fCB2YWx1ZSA9PT0gXCJwb2RtYW5cIiB8fCB2YWx1ZSA9PT0gXCJxZW11XCIgfHwgdmFsdWUgPT09IFwiY3VzdG9tXCIgfHwgdmFsdWUgPT09IFwid3NsXCIpIHtcbiAgICAgIHJldHVybiB2YWx1ZTtcbiAgICB9XG4gICAgdGhyb3cgbmV3IEVycm9yKFwiQ29udGFpbmVyIGNvbmZpZyBydW50aW1lIG11c3QgYmUgZG9ja2VyLCBwb2RtYW4sIHFlbXUsIGN1c3RvbSwgb3Igd3NsLlwiKTtcbiAgfVxuXG4gIHByaXZhdGUgcmVhZFdzbENvbmZpZyh2YWx1ZTogdW5rbm93bik6IGxvb21Xc2xDb25maWcgfCB1bmRlZmluZWQge1xuICAgIGlmICh2YWx1ZSA9PSBudWxsKSB7XG4gICAgICByZXR1cm4gdW5kZWZpbmVkO1xuICAgIH1cbiAgICBpZiAoIXZhbHVlIHx8IHR5cGVvZiB2YWx1ZSAhPT0gXCJvYmplY3RcIiB8fCBBcnJheS5pc0FycmF5KHZhbHVlKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiQ29udGFpbmVyIGNvbmZpZyB3c2wgbXVzdCBiZSBhbiBvYmplY3QuXCIpO1xuICAgIH1cbiAgICBjb25zdCBkYXRhID0gdmFsdWUgYXMgeyBpbnRlcmFjdGl2ZT86IHVua25vd24gfTtcbiAgICByZXR1cm4ge1xuICAgICAgaW50ZXJhY3RpdmU6IGRhdGEuaW50ZXJhY3RpdmUgPT09IHRydWUsXG4gICAgfTtcbiAgfVxuXG4gIHByaXZhdGUgcmVhZFFlbXVDb25maWcodmFsdWU6IHVua25vd24pOiBsb29tUWVtdUNvbmZpZyB8IHVuZGVmaW5lZCB7XG4gICAgaWYgKHZhbHVlID09IG51bGwpIHtcbiAgICAgIHJldHVybiB1bmRlZmluZWQ7XG4gICAgfVxuICAgIGlmICghdmFsdWUgfHwgdHlwZW9mIHZhbHVlICE9PSBcIm9iamVjdFwiIHx8IEFycmF5LmlzQXJyYXkodmFsdWUpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJDb250YWluZXIgY29uZmlnIHFlbXUgbXVzdCBiZSBhbiBvYmplY3QuXCIpO1xuICAgIH1cbiAgICBjb25zdCBkYXRhID0gdmFsdWUgYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj47XG4gICAgaWYgKHR5cGVvZiBkYXRhLnNzaFRhcmdldCAhPT0gXCJzdHJpbmdcIiB8fCAhZGF0YS5zc2hUYXJnZXQudHJpbSgpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJDb250YWluZXIgY29uZmlnIHFlbXUuc3NoVGFyZ2V0IG11c3QgYmUgYSBzdHJpbmcuXCIpO1xuICAgIH1cbiAgICBpZiAodHlwZW9mIGRhdGEucmVtb3RlV29ya3NwYWNlICE9PSBcInN0cmluZ1wiIHx8ICFkYXRhLnJlbW90ZVdvcmtzcGFjZS50cmltKCkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIkNvbnRhaW5lciBjb25maWcgcWVtdS5yZW1vdGVXb3Jrc3BhY2UgbXVzdCBiZSBhIHN0cmluZy5cIik7XG4gICAgfVxuXG4gICAgcmV0dXJuIHtcbiAgICAgIHNzaFRhcmdldDogZGF0YS5zc2hUYXJnZXQudHJpbSgpLFxuICAgICAgcmVtb3RlV29ya3NwYWNlOiBkYXRhLnJlbW90ZVdvcmtzcGFjZS50cmltKCksXG4gICAgICBzc2hFeGVjdXRhYmxlOiBvcHRpb25hbFN0cmluZyhkYXRhLnNzaEV4ZWN1dGFibGUpLFxuICAgICAgc3NoQXJnczogb3B0aW9uYWxTdHJpbmcoZGF0YS5zc2hBcmdzKSxcbiAgICAgIHN0YXJ0Q29tbWFuZDogb3B0aW9uYWxTdHJpbmcoZGF0YS5zdGFydENvbW1hbmQpLFxuICAgICAgYnVpbGRDb21tYW5kOiBvcHRpb25hbFN0cmluZyhkYXRhLmJ1aWxkQ29tbWFuZCksXG4gICAgICB0ZWFyZG93bkNvbW1hbmQ6IG9wdGlvbmFsU3RyaW5nKGRhdGEudGVhcmRvd25Db21tYW5kKSxcbiAgICAgIGhlYWx0aENoZWNrOiB0aGlzLnJlYWRIZWFsdGhDaGVjayhkYXRhLmhlYWx0aENoZWNrLCBcIkNvbnRhaW5lciBjb25maWcgcWVtdS5oZWFsdGhDaGVja1wiKSxcbiAgICAgIG1hbmFnZXI6IHRoaXMucmVhZFFlbXVNYW5hZ2VyQ29uZmlnKGRhdGEubWFuYWdlciksXG4gICAgfTtcbiAgfVxuXG4gIHByaXZhdGUgcmVhZFFlbXVNYW5hZ2VyQ29uZmlnKHZhbHVlOiB1bmtub3duKTogbG9vbVFlbXVNYW5hZ2VyQ29uZmlnIHwgdW5kZWZpbmVkIHtcbiAgICBpZiAodmFsdWUgPT0gbnVsbCkge1xuICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICB9XG4gICAgaWYgKCF2YWx1ZSB8fCB0eXBlb2YgdmFsdWUgIT09IFwib2JqZWN0XCIgfHwgQXJyYXkuaXNBcnJheSh2YWx1ZSkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIkNvbnRhaW5lciBjb25maWcgcWVtdS5tYW5hZ2VyIG11c3QgYmUgYW4gb2JqZWN0LlwiKTtcbiAgICB9XG4gICAgY29uc3QgZGF0YSA9IHZhbHVlIGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+O1xuICAgIHJldHVybiB7XG4gICAgICBlbmFibGVkOiBkYXRhLmVuYWJsZWQgIT09IGZhbHNlLFxuICAgICAgZXhlY3V0YWJsZTogb3B0aW9uYWxTdHJpbmcoZGF0YS5leGVjdXRhYmxlKSxcbiAgICAgIGFyZ3M6IG9wdGlvbmFsU3RyaW5nKGRhdGEuYXJncyksXG4gICAgICBpbWFnZTogb3B0aW9uYWxTdHJpbmcoZGF0YS5pbWFnZSksXG4gICAgICBpbWFnZUZvcm1hdDogb3B0aW9uYWxTdHJpbmcoZGF0YS5pbWFnZUZvcm1hdCksXG4gICAgICBwaWRGaWxlOiBvcHRpb25hbFN0cmluZyhkYXRhLnBpZEZpbGUpLFxuICAgICAgbG9nRmlsZTogb3B0aW9uYWxTdHJpbmcoZGF0YS5sb2dGaWxlKSxcbiAgICAgIHJlYWRpbmVzc1RpbWVvdXRNczogb3B0aW9uYWxQb3NpdGl2ZUludGVnZXIoZGF0YS5yZWFkaW5lc3NUaW1lb3V0TXMsIFwiQ29udGFpbmVyIGNvbmZpZyBxZW11Lm1hbmFnZXIucmVhZGluZXNzVGltZW91dE1zXCIpLFxuICAgICAgcmVhZGluZXNzSW50ZXJ2YWxNczogb3B0aW9uYWxQb3NpdGl2ZUludGVnZXIoZGF0YS5yZWFkaW5lc3NJbnRlcnZhbE1zLCBcIkNvbnRhaW5lciBjb25maWcgcWVtdS5tYW5hZ2VyLnJlYWRpbmVzc0ludGVydmFsTXNcIiksXG4gICAgICBib290RGVsYXlNczogb3B0aW9uYWxOb25OZWdhdGl2ZUludGVnZXIoZGF0YS5ib290RGVsYXlNcywgXCJDb250YWluZXIgY29uZmlnIHFlbXUubWFuYWdlci5ib290RGVsYXlNc1wiKSxcbiAgICAgIHNodXRkb3duQ29tbWFuZDogb3B0aW9uYWxTdHJpbmcoZGF0YS5zaHV0ZG93bkNvbW1hbmQpLFxuICAgICAgc2h1dGRvd25UaW1lb3V0TXM6IG9wdGlvbmFsUG9zaXRpdmVJbnRlZ2VyKGRhdGEuc2h1dGRvd25UaW1lb3V0TXMsIFwiQ29udGFpbmVyIGNvbmZpZyBxZW11Lm1hbmFnZXIuc2h1dGRvd25UaW1lb3V0TXNcIiksXG4gICAgICBraWxsU2lnbmFsOiBvcHRpb25hbFNpZ25hbChkYXRhLmtpbGxTaWduYWwsIFwiQ29udGFpbmVyIGNvbmZpZyBxZW11Lm1hbmFnZXIua2lsbFNpZ25hbFwiKSxcbiAgICAgIHBlcnNpc3Q6IHR5cGVvZiBkYXRhLnBlcnNpc3QgPT09IFwiYm9vbGVhblwiID8gZGF0YS5wZXJzaXN0IDogdW5kZWZpbmVkLFxuICAgIH07XG4gIH1cblxuICBwcml2YXRlIHJlYWRDdXN0b21Db25maWcodmFsdWU6IHVua25vd24pOiBsb29tQ3VzdG9tUnVudGltZUNvbmZpZyB8IHVuZGVmaW5lZCB7XG4gICAgaWYgKHZhbHVlID09IG51bGwpIHtcbiAgICAgIHJldHVybiB1bmRlZmluZWQ7XG4gICAgfVxuICAgIGlmICghdmFsdWUgfHwgdHlwZW9mIHZhbHVlICE9PSBcIm9iamVjdFwiIHx8IEFycmF5LmlzQXJyYXkodmFsdWUpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJDb250YWluZXIgY29uZmlnIGN1c3RvbSBtdXN0IGJlIGFuIG9iamVjdC5cIik7XG4gICAgfVxuICAgIGNvbnN0IGRhdGEgPSB2YWx1ZSBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPjtcbiAgICBpZiAodHlwZW9mIGRhdGEuZXhlY3V0YWJsZSAhPT0gXCJzdHJpbmdcIiB8fCAhZGF0YS5leGVjdXRhYmxlLnRyaW0oKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiQ29udGFpbmVyIGNvbmZpZyBjdXN0b20uZXhlY3V0YWJsZSBtdXN0IGJlIGEgc3RyaW5nLlwiKTtcbiAgICB9XG4gICAgcmV0dXJuIHtcbiAgICAgIGV4ZWN1dGFibGU6IGRhdGEuZXhlY3V0YWJsZS50cmltKCksXG4gICAgICBhcmdzOiBvcHRpb25hbFN0cmluZyhkYXRhLmFyZ3MpLFxuICAgICAgYnVpbGQ6IG9wdGlvbmFsU3RyaW5nKGRhdGEuYnVpbGQpLFxuICAgICAgY29tbWFuZFN0cnVjdHVyZTogb3B0aW9uYWxTdHJpbmcoZGF0YS5jb21tYW5kU3RydWN0dXJlKSxcbiAgICAgIHRlYXJkb3duOiBvcHRpb25hbFN0cmluZyhkYXRhLnRlYXJkb3duKSxcbiAgICAgIGhlYWx0aENoZWNrOiB0aGlzLnJlYWRIZWFsdGhDaGVjayhkYXRhLmhlYWx0aENoZWNrLCBcIkNvbnRhaW5lciBjb25maWcgY3VzdG9tLmhlYWx0aENoZWNrXCIpLFxuICAgIH07XG4gIH1cblxuICBwcml2YXRlIHJlYWRIZWFsdGhDaGVjayh2YWx1ZTogdW5rbm93biwgbGFiZWw6IHN0cmluZyk6IGxvb21Db21tYW5kRXhwZWN0YXRpb24gfCB1bmRlZmluZWQge1xuICAgIGlmICh2YWx1ZSA9PSBudWxsKSB7XG4gICAgICByZXR1cm4gdW5kZWZpbmVkO1xuICAgIH1cbiAgICBpZiAoIXZhbHVlIHx8IHR5cGVvZiB2YWx1ZSAhPT0gXCJvYmplY3RcIiB8fCBBcnJheS5pc0FycmF5KHZhbHVlKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGAke2xhYmVsfSBtdXN0IGJlIGFuIG9iamVjdC5gKTtcbiAgICB9XG4gICAgY29uc3QgZGF0YSA9IHZhbHVlIGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+O1xuICAgIGlmICh0eXBlb2YgZGF0YS5jb21tYW5kICE9PSBcInN0cmluZ1wiIHx8ICFkYXRhLmNvbW1hbmQudHJpbSgpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYCR7bGFiZWx9LmNvbW1hbmQgbXVzdCBiZSBhIHN0cmluZy5gKTtcbiAgICB9XG4gICAgcmV0dXJuIHtcbiAgICAgIGNvbW1hbmQ6IGRhdGEuY29tbWFuZC50cmltKCksXG4gICAgICBwb3NpdGl2ZVJlc3BvbnNlOiBvcHRpb25hbFN0cmluZyhkYXRhLnBvc2l0aXZlUmVzcG9uc2UgPz8gZGF0YS5wb3NpdGl2ZV9yZXNwb25zZSA/PyBkYXRhW1wicG9zaXRpdmUgcmVzcG9uc2VcIl0gPz8gZGF0YS5wb3NzaXRpdmVSZXNwb25zZSksXG4gICAgICBuZWdhdGl2ZVJlc3BvbnNlOiBvcHRpb25hbFN0cmluZyhkYXRhLm5lZ2F0aXZlUmVzcG9uc2UgPz8gZGF0YS5uZWdhdGl2ZV9yZXNwb25zZSA/PyBkYXRhW1wibmVnYXRpdmUgcmVzcG9uc2VcIl0pLFxuICAgIH07XG4gIH1cblxuICBwcml2YXRlIHJlcXVpcmVRZW11Q29uZmlnKGNvbmZpZzogbG9vbUNvbnRhaW5lckNvbmZpZyk6IGxvb21RZW11Q29uZmlnIHtcbiAgICBpZiAoIWNvbmZpZy5xZW11KSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJRRU1VIHJ1bnRpbWUgcmVxdWlyZXMgYSBxZW11IGNvbmZpZyBvYmplY3QuXCIpO1xuICAgIH1cbiAgICByZXR1cm4gY29uZmlnLnFlbXU7XG4gIH1cblxuICBwcml2YXRlIHJlcXVpcmVDdXN0b21Db25maWcoY29uZmlnOiBsb29tQ29udGFpbmVyQ29uZmlnKTogbG9vbUN1c3RvbVJ1bnRpbWVDb25maWcge1xuICAgIGlmICghY29uZmlnLmN1c3RvbSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiQ3VzdG9tIHJ1bnRpbWUgcmVxdWlyZXMgYSBjdXN0b20gY29uZmlnIG9iamVjdC5cIik7XG4gICAgfVxuICAgIHJldHVybiBjb25maWcuY3VzdG9tO1xuICB9XG5cbiAgcHJpdmF0ZSBydW50aW1lRXhlY3V0YWJsZShjb25maWc6IGxvb21Db250YWluZXJDb25maWcpOiBzdHJpbmcge1xuICAgIGlmIChjb25maWcuZXhlY3V0YWJsZT8udHJpbSgpKSB7XG4gICAgICByZXR1cm4gY29uZmlnLmV4ZWN1dGFibGUudHJpbSgpO1xuICAgIH1cbiAgICByZXR1cm4gY29uZmlnLnJ1bnRpbWUgPT09IFwicG9kbWFuXCIgPyBcInBvZG1hblwiIDogXCJkb2NrZXJcIjtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgcnVuSGVhbHRoQ2hlY2soXG4gICAgaGVhbHRoQ2hlY2s6IGxvb21Db21tYW5kRXhwZWN0YXRpb24gfCB1bmRlZmluZWQsXG4gICAgd29ya2luZ0RpcmVjdG9yeTogc3RyaW5nLFxuICAgIHRpbWVvdXRNczogbnVtYmVyLFxuICAgIHNpZ25hbDogQWJvcnRTaWduYWwsXG4gICAgcnVubmVySWQ6IHN0cmluZyxcbiAgICBydW5uZXJOYW1lOiBzdHJpbmcsXG4gICk6IFByb21pc2U8dm9pZD4ge1xuICAgIGlmICghaGVhbHRoQ2hlY2spIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBjb25zdCByZXN1bHQgPSBhd2FpdCB0aGlzLnJ1bkNvbW1hbmRMaW5lKGhlYWx0aENoZWNrLmNvbW1hbmQsIHdvcmtpbmdEaXJlY3RvcnksIHRpbWVvdXRNcywgc2lnbmFsLCBydW5uZXJJZCwgcnVubmVyTmFtZSk7XG4gICAgY29uc3QgY29tYmluZWRPdXRwdXQgPSBgJHtyZXN1bHQuc3Rkb3V0fVxcbiR7cmVzdWx0LnN0ZGVycn1gO1xuICAgIGlmICghcmVzdWx0LnN1Y2Nlc3MpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgJHtydW5uZXJOYW1lfSBmYWlsZWQ6ICR7cmVzdWx0LnN0ZGVyciB8fCByZXN1bHQuc3Rkb3V0IHx8IGBleGl0ICR7cmVzdWx0LmV4aXRDb2RlfWB9YCk7XG4gICAgfVxuICAgIGlmIChoZWFsdGhDaGVjay5uZWdhdGl2ZVJlc3BvbnNlICYmIGNvbWJpbmVkT3V0cHV0LmluY2x1ZGVzKGhlYWx0aENoZWNrLm5lZ2F0aXZlUmVzcG9uc2UpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYCR7cnVubmVyTmFtZX0gcmV0dXJuZWQgbmVnYXRpdmUgcmVzcG9uc2U6ICR7aGVhbHRoQ2hlY2submVnYXRpdmVSZXNwb25zZX1gKTtcbiAgICB9XG4gICAgaWYgKGhlYWx0aENoZWNrLnBvc2l0aXZlUmVzcG9uc2UgJiYgIWNvbWJpbmVkT3V0cHV0LmluY2x1ZGVzKGhlYWx0aENoZWNrLnBvc2l0aXZlUmVzcG9uc2UpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYCR7cnVubmVyTmFtZX0gZGlkIG5vdCByZXR1cm4gcG9zaXRpdmUgcmVzcG9uc2U6ICR7aGVhbHRoQ2hlY2sucG9zaXRpdmVSZXNwb25zZX1gKTtcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIHJ1bk9wdGlvbmFsQ29tbWFuZChcbiAgICBjb21tYW5kOiBzdHJpbmcgfCB1bmRlZmluZWQsXG4gICAgd29ya2luZ0RpcmVjdG9yeTogc3RyaW5nLFxuICAgIHRpbWVvdXRNczogbnVtYmVyLFxuICAgIHNpZ25hbDogQWJvcnRTaWduYWwsXG4gICAgcnVubmVySWQ6IHN0cmluZyxcbiAgICBydW5uZXJOYW1lOiBzdHJpbmcsXG4gICk6IFByb21pc2U8dm9pZD4ge1xuICAgIGlmICghY29tbWFuZD8udHJpbSgpKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHRoaXMucnVuQ29tbWFuZExpbmUoY29tbWFuZCwgd29ya2luZ0RpcmVjdG9yeSwgdGltZW91dE1zLCBzaWduYWwsIHJ1bm5lcklkLCBydW5uZXJOYW1lKTtcbiAgICBpZiAoIXJlc3VsdC5zdWNjZXNzKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYCR7cnVubmVyTmFtZX0gZmFpbGVkOiAke3Jlc3VsdC5zdGRlcnIgfHwgcmVzdWx0LnN0ZG91dCB8fCBgZXhpdCAke3Jlc3VsdC5leGl0Q29kZX1gfWApO1xuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgcnVuQ29tbWFuZExpbmUoXG4gICAgY29tbWFuZDogc3RyaW5nLFxuICAgIHdvcmtpbmdEaXJlY3Rvcnk6IHN0cmluZyxcbiAgICB0aW1lb3V0TXM6IG51bWJlcixcbiAgICBzaWduYWw6IEFib3J0U2lnbmFsLFxuICAgIHJ1bm5lcklkOiBzdHJpbmcsXG4gICAgcnVubmVyTmFtZTogc3RyaW5nLFxuICApOiBQcm9taXNlPGxvb21SdW5SZXN1bHQ+IHtcbiAgICBjb25zdCBwYXJ0cyA9IHNwbGl0Q29tbWFuZExpbmUoY29tbWFuZCk7XG4gICAgaWYgKCFwYXJ0cy5sZW5ndGgpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgJHtydW5uZXJOYW1lfSBjb21tYW5kIGlzIGVtcHR5LmApO1xuICAgIH1cbiAgICByZXR1cm4gcnVuUHJvY2Vzcyh7XG4gICAgICBydW5uZXJJZCxcbiAgICAgIHJ1bm5lck5hbWUsXG4gICAgICBleGVjdXRhYmxlOiBwYXJ0c1swXSxcbiAgICAgIGFyZ3M6IHBhcnRzLnNsaWNlKDEpLFxuICAgICAgd29ya2luZ0RpcmVjdG9yeSxcbiAgICAgIHRpbWVvdXRNcyxcbiAgICAgIHNpZ25hbCxcbiAgICB9KTtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgZW5zdXJlTWFuYWdlZFFlbXUoZ3JvdXBOYW1lOiBzdHJpbmcsIGdyb3VwUGF0aDogc3RyaW5nLCBxZW11OiBsb29tUWVtdUNvbmZpZywgdGltZW91dE1zOiBudW1iZXIsIHNpZ25hbDogQWJvcnRTaWduYWwpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCBtYW5hZ2VyID0gcWVtdS5tYW5hZ2VyO1xuICAgIGlmICghbWFuYWdlcj8uZW5hYmxlZCkge1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGNvbnN0IHBpZFBhdGggPSB0aGlzLnJlc29sdmVHcm91cEZpbGVQYXRoKGdyb3VwUGF0aCwgbWFuYWdlci5waWRGaWxlIHx8IFwiLmxvb20tcWVtdS5waWRcIik7XG4gICAgY29uc3QgZXhpc3RpbmdQaWQgPSBhd2FpdCB0aGlzLnJlYWRQaWRGaWxlKHBpZFBhdGgpO1xuICAgIGlmIChleGlzdGluZ1BpZCAmJiB0aGlzLmlzUHJvY2Vzc1J1bm5pbmcoZXhpc3RpbmdQaWQpKSB7XG4gICAgICBhd2FpdCB0aGlzLndhaXRGb3JNYW5hZ2VkUWVtdVJlYWRpbmVzcyhncm91cE5hbWUsIGdyb3VwUGF0aCwgcWVtdSwgdGltZW91dE1zLCBzaWduYWwpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGlmIChleGlzdGluZ1BpZCkge1xuICAgICAgYXdhaXQgcm0ocGlkUGF0aCwgeyBmb3JjZTogdHJ1ZSB9KTtcbiAgICB9XG5cbiAgICBjb25zdCBleGVjdXRhYmxlID0gbWFuYWdlci5leGVjdXRhYmxlIHx8IFwicWVtdS1zeXN0ZW0teDg2XzY0XCI7XG4gICAgY29uc3QgYXJncyA9IHRoaXMuYnVpbGRNYW5hZ2VkUWVtdUFyZ3MoZ3JvdXBQYXRoLCBtYW5hZ2VyKTtcbiAgICBpZiAoIWFyZ3MubGVuZ3RoKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYFFFTVUgbWFuYWdlciBmb3IgJHtncm91cE5hbWV9IG5lZWRzIHFlbXUubWFuYWdlci5hcmdzIG9yIHFlbXUubWFuYWdlci5pbWFnZS5gKTtcbiAgICB9XG5cbiAgICBjb25zdCBsb2dQYXRoID0gbWFuYWdlci5sb2dGaWxlID8gdGhpcy5yZXNvbHZlR3JvdXBGaWxlUGF0aChncm91cFBhdGgsIG1hbmFnZXIubG9nRmlsZSkgOiBudWxsO1xuICAgIGNvbnN0IGxvZ0ZkID0gbG9nUGF0aCA/IG9wZW5TeW5jKGxvZ1BhdGgsIFwiYVwiKSA6IG51bGw7XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IGNoaWxkID0gc3Bhd24oZXhlY3V0YWJsZSwgYXJncywge1xuICAgICAgICBjd2Q6IGdyb3VwUGF0aCxcbiAgICAgICAgZGV0YWNoZWQ6IHRydWUsXG4gICAgICAgIHN0ZGlvOiBbXCJpZ25vcmVcIiwgbG9nRmQgPz8gXCJpZ25vcmVcIiwgbG9nRmQgPz8gXCJpZ25vcmVcIl0sXG4gICAgICB9KTtcblxuICAgICAgY2hpbGQub24oXCJlcnJvclwiLCAoKSA9PiB1bmRlZmluZWQpO1xuICAgICAgY2hpbGQudW5yZWYoKTtcblxuICAgICAgaWYgKCFjaGlsZC5waWQpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBRRU1VIG1hbmFnZXIgZm9yICR7Z3JvdXBOYW1lfSBkaWQgbm90IHJldHVybiBhIHByb2Nlc3MgaWQuYCk7XG4gICAgICB9XG5cbiAgICAgIGF3YWl0IHdyaXRlRmlsZShwaWRQYXRoLCBgJHtjaGlsZC5waWR9XFxuYCwgXCJ1dGY4XCIpO1xuICAgICAgYXdhaXQgdGhpcy53YWl0Rm9yTWFuYWdlZFFlbXVSZWFkaW5lc3MoZ3JvdXBOYW1lLCBncm91cFBhdGgsIHFlbXUsIHRpbWVvdXRNcywgc2lnbmFsKTtcbiAgICB9IGZpbmFsbHkge1xuICAgICAgaWYgKGxvZ0ZkICE9IG51bGwpIHtcbiAgICAgICAgY2xvc2VTeW5jKGxvZ0ZkKTtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICBwcml2YXRlIGJ1aWxkTWFuYWdlZFFlbXVBcmdzKGdyb3VwUGF0aDogc3RyaW5nLCBtYW5hZ2VyOiBsb29tUWVtdU1hbmFnZXJDb25maWcpOiBzdHJpbmdbXSB7XG4gICAgY29uc3QgYXJncyA9IHNwbGl0Q29tbWFuZExpbmUobWFuYWdlci5hcmdzIHx8IFwiXCIpO1xuICAgIGlmIChtYW5hZ2VyLmltYWdlKSB7XG4gICAgICBjb25zdCBpbWFnZVBhdGggPSB0aGlzLnJlc29sdmVHcm91cEZpbGVQYXRoKGdyb3VwUGF0aCwgbWFuYWdlci5pbWFnZSk7XG4gICAgICBhcmdzLnB1c2goXCItZHJpdmVcIiwgYGZpbGU9JHtpbWFnZVBhdGh9LGlmPXZpcnRpbyxmb3JtYXQ9JHttYW5hZ2VyLmltYWdlRm9ybWF0IHx8IFwicWNvdzJcIn1gKTtcbiAgICB9XG4gICAgcmV0dXJuIGFyZ3M7XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIHdhaXRGb3JNYW5hZ2VkUWVtdVJlYWRpbmVzcyhcbiAgICBncm91cE5hbWU6IHN0cmluZyxcbiAgICBncm91cFBhdGg6IHN0cmluZyxcbiAgICBxZW11OiBsb29tUWVtdUNvbmZpZyxcbiAgICB0aW1lb3V0TXM6IG51bWJlcixcbiAgICBzaWduYWw6IEFib3J0U2lnbmFsLFxuICApOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCBtYW5hZ2VyID0gcWVtdS5tYW5hZ2VyO1xuICAgIGlmICghbWFuYWdlcj8uZW5hYmxlZCkge1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGlmICghcWVtdS5oZWFsdGhDaGVjaykge1xuICAgICAgYXdhaXQgc2xlZXBXaXRoU2lnbmFsKG1hbmFnZXIuYm9vdERlbGF5TXMgPz8gMCwgc2lnbmFsKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBjb25zdCB0aW1lb3V0ID0gTWF0aC5taW4obWFuYWdlci5yZWFkaW5lc3NUaW1lb3V0TXMgPz8gNjBfMDAwLCBNYXRoLm1heCh0aW1lb3V0TXMsIDEpKTtcbiAgICBjb25zdCBpbnRlcnZhbCA9IG1hbmFnZXIucmVhZGluZXNzSW50ZXJ2YWxNcyA/PyAxXzAwMDtcbiAgICBjb25zdCBzdGFydGVkQXQgPSBEYXRlLm5vdygpO1xuICAgIGxldCBsYXN0RXJyb3IgPSBcIlwiO1xuXG4gICAgd2hpbGUgKERhdGUubm93KCkgLSBzdGFydGVkQXQgPD0gdGltZW91dCkge1xuICAgICAgaWYgKHNpZ25hbC5hYm9ydGVkKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgUUVNVSAke2dyb3VwTmFtZX0gcmVhZGluZXNzIHdhaXQgY2FuY2VsbGVkLmApO1xuICAgICAgfVxuXG4gICAgICB0cnkge1xuICAgICAgICBhd2FpdCB0aGlzLnJ1bkhlYWx0aENoZWNrKHFlbXUuaGVhbHRoQ2hlY2ssIGdyb3VwUGF0aCwgTWF0aC5taW4oaW50ZXJ2YWwsIHRpbWVvdXQpLCBzaWduYWwsIGBjb250YWluZXI6JHtncm91cE5hbWV9OnFlbXU6cmVhZHlgLCBgUUVNVSAke2dyb3VwTmFtZX0gcmVhZGluZXNzIGNoZWNrYCk7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIGxhc3RFcnJvciA9IGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogU3RyaW5nKGVycm9yKTtcbiAgICAgIH1cblxuICAgICAgYXdhaXQgc2xlZXBXaXRoU2lnbmFsKGludGVydmFsLCBzaWduYWwpO1xuICAgIH1cblxuICAgIHRocm93IG5ldyBFcnJvcihgUUVNVSAke2dyb3VwTmFtZX0gZGlkIG5vdCBiZWNvbWUgcmVhZHkgd2l0aGluICR7dGltZW91dH0gbXMke2xhc3RFcnJvciA/IGA6ICR7bGFzdEVycm9yfWAgOiBcIi5cIn1gKTtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgc3RvcE1hbmFnZWRRZW11SWZOZWVkZWQoZ3JvdXBOYW1lOiBzdHJpbmcsIGdyb3VwUGF0aDogc3RyaW5nLCBxZW11OiBsb29tUWVtdUNvbmZpZywgdGltZW91dE1zOiBudW1iZXIsIHNpZ25hbDogQWJvcnRTaWduYWwpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCBtYW5hZ2VyID0gcWVtdS5tYW5hZ2VyO1xuICAgIGlmICghbWFuYWdlcj8uZW5hYmxlZCB8fCBtYW5hZ2VyLnBlcnNpc3QgIT09IGZhbHNlKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgY29uc3QgcGlkUGF0aCA9IHRoaXMucmVzb2x2ZUdyb3VwRmlsZVBhdGgoZ3JvdXBQYXRoLCBtYW5hZ2VyLnBpZEZpbGUgfHwgXCIubG9vbS1xZW11LnBpZFwiKTtcbiAgICBjb25zdCBwaWQgPSBhd2FpdCB0aGlzLnJlYWRQaWRGaWxlKHBpZFBhdGgpO1xuICAgIGlmICghcGlkKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgaWYgKG1hbmFnZXIuc2h1dGRvd25Db21tYW5kKSB7XG4gICAgICBhd2FpdCB0aGlzLnJ1bk9wdGlvbmFsQ29tbWFuZChcbiAgICAgICAgbWFuYWdlci5zaHV0ZG93bkNvbW1hbmQsXG4gICAgICAgIGdyb3VwUGF0aCxcbiAgICAgICAgTWF0aC5taW4obWFuYWdlci5zaHV0ZG93blRpbWVvdXRNcyA/PyB0aW1lb3V0TXMsIHRpbWVvdXRNcyksXG4gICAgICAgIHNpZ25hbCxcbiAgICAgICAgYGNvbnRhaW5lcjoke2dyb3VwTmFtZX06cWVtdTpzaHV0ZG93bmAsXG4gICAgICAgIGBRRU1VICR7Z3JvdXBOYW1lfSBzaHV0ZG93bmAsXG4gICAgICApO1xuICAgIH0gZWxzZSBpZiAodGhpcy5pc1Byb2Nlc3NSdW5uaW5nKHBpZCkpIHtcbiAgICAgIHByb2Nlc3Mua2lsbChwaWQsIG1hbmFnZXIua2lsbFNpZ25hbCB8fCBcIlNJR1RFUk1cIik7XG4gICAgfVxuXG4gICAgY29uc3Qgc3RvcHBlZCA9IGF3YWl0IHRoaXMud2FpdEZvclByb2Nlc3NFeGl0KHBpZCwgbWFuYWdlci5zaHV0ZG93blRpbWVvdXRNcyA/PyAxMF8wMDAsIHNpZ25hbCk7XG4gICAgaWYgKCFzdG9wcGVkICYmIHRoaXMuaXNQcm9jZXNzUnVubmluZyhwaWQpKSB7XG4gICAgICBwcm9jZXNzLmtpbGwocGlkLCBcIlNJR0tJTExcIik7XG4gICAgICBhd2FpdCB0aGlzLndhaXRGb3JQcm9jZXNzRXhpdChwaWQsIDJfMDAwLCBzaWduYWwpO1xuICAgIH1cblxuICAgIGF3YWl0IHJtKHBpZFBhdGgsIHsgZm9yY2U6IHRydWUgfSk7XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIGdldE1hbmFnZWRRZW11U3RhdHVzKGdyb3VwUGF0aDogc3RyaW5nLCBtYW5hZ2VyOiBsb29tUWVtdU1hbmFnZXJDb25maWcpOiBQcm9taXNlPHN0cmluZz4ge1xuICAgIGNvbnN0IHBpZFBhdGggPSB0aGlzLnJlc29sdmVHcm91cEZpbGVQYXRoKGdyb3VwUGF0aCwgbWFuYWdlci5waWRGaWxlIHx8IFwiLmxvb20tcWVtdS5waWRcIik7XG4gICAgY29uc3QgcGlkID0gYXdhaXQgdGhpcy5yZWFkUGlkRmlsZShwaWRQYXRoKTtcbiAgICBpZiAoIXBpZCkge1xuICAgICAgcmV0dXJuIFwic3RvcHBlZFwiO1xuICAgIH1cbiAgICByZXR1cm4gdGhpcy5pc1Byb2Nlc3NSdW5uaW5nKHBpZCkgPyBgcnVubmluZyBwaWQgJHtwaWR9YCA6IGBzdGFsZSBwaWQgJHtwaWR9YDtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgcmVhZFBpZEZpbGUocGlkUGF0aDogc3RyaW5nKTogUHJvbWlzZTxudW1iZXIgfCBudWxsPiB7XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHZhbHVlID0gKGF3YWl0IHJlYWRGaWxlKHBpZFBhdGgsIFwidXRmOFwiKSkudHJpbSgpO1xuICAgICAgY29uc3QgcGlkID0gTnVtYmVyLnBhcnNlSW50KHZhbHVlLCAxMCk7XG4gICAgICByZXR1cm4gTnVtYmVyLmlzSW50ZWdlcihwaWQpICYmIHBpZCA+IDAgPyBwaWQgOiBudWxsO1xuICAgIH0gY2F0Y2gge1xuICAgICAgcmV0dXJuIG51bGw7XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBpc1Byb2Nlc3NSdW5uaW5nKHBpZDogbnVtYmVyKTogYm9vbGVhbiB7XG4gICAgdHJ5IHtcbiAgICAgIHByb2Nlc3Mua2lsbChwaWQsIDApO1xuICAgICAgcmV0dXJuIHRydWU7XG4gICAgfSBjYXRjaCB7XG4gICAgICByZXR1cm4gZmFsc2U7XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyB3YWl0Rm9yUHJvY2Vzc0V4aXQocGlkOiBudW1iZXIsIHRpbWVvdXRNczogbnVtYmVyLCBzaWduYWw6IEFib3J0U2lnbmFsKTogUHJvbWlzZTxib29sZWFuPiB7XG4gICAgY29uc3Qgc3RhcnRlZEF0ID0gRGF0ZS5ub3coKTtcbiAgICB3aGlsZSAoRGF0ZS5ub3coKSAtIHN0YXJ0ZWRBdCA8PSB0aW1lb3V0TXMpIHtcbiAgICAgIGlmIChzaWduYWwuYWJvcnRlZCkge1xuICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICB9XG4gICAgICBpZiAoIXRoaXMuaXNQcm9jZXNzUnVubmluZyhwaWQpKSB7XG4gICAgICAgIHJldHVybiB0cnVlO1xuICAgICAgfVxuICAgICAgYXdhaXQgc2xlZXBXaXRoU2lnbmFsKDI1MCwgc2lnbmFsKTtcbiAgICB9XG4gICAgcmV0dXJuICF0aGlzLmlzUHJvY2Vzc1J1bm5pbmcocGlkKTtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgcnVuQ3VzdG9tV3JhcHBlcihcbiAgICBncm91cE5hbWU6IHN0cmluZyxcbiAgICBncm91cFBhdGg6IHN0cmluZyxcbiAgICBjb25maWc6IGxvb21Db250YWluZXJDb25maWcsXG4gICAgcmVxdWVzdDogbG9vbUN1c3RvbVJ1bnRpbWVSZXF1ZXN0LFxuICAgIHRpbWVvdXRNczogbnVtYmVyLFxuICAgIHNpZ25hbDogQWJvcnRTaWduYWwsXG4gICk6IFByb21pc2U8bG9vbVJ1blJlc3VsdD4ge1xuICAgIGNvbnN0IGN1c3RvbSA9IHRoaXMucmVxdWlyZUN1c3RvbUNvbmZpZyhjb25maWcpO1xuICAgIGF3YWl0IHRoaXMucnVuSGVhbHRoQ2hlY2soY3VzdG9tLmhlYWx0aENoZWNrLCBncm91cFBhdGgsIHRpbWVvdXRNcywgc2lnbmFsLCBgY29udGFpbmVyOiR7Z3JvdXBOYW1lfTpjdXN0b206aGVhbHRoYCwgYEN1c3RvbSAke2dyb3VwTmFtZX0gaGVhbHRoIGNoZWNrYCk7XG5cbiAgICBjb25zdCByZXF1ZXN0RmlsZU5hbWUgPSBgcmVxdWVzdF8ke0RhdGUubm93KCl9XyR7TWF0aC5yYW5kb20oKS50b1N0cmluZygxNikuc2xpY2UoMil9Lmpzb25gO1xuICAgIGNvbnN0IHJlcXVlc3RQYXRoID0gam9pbihncm91cFBhdGgsIHJlcXVlc3RGaWxlTmFtZSk7XG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IHdyaXRlRmlsZShyZXF1ZXN0UGF0aCwgYCR7SlNPTi5zdHJpbmdpZnkocmVxdWVzdCwgbnVsbCwgMil9XFxuYCwgXCJ1dGY4XCIpO1xuICAgICAgY29uc3QgYXJncyA9IHNwbGl0Q29tbWFuZExpbmUoY3VzdG9tLmFyZ3MgfHwgXCJ7cmVxdWVzdH1cIikubWFwKChhcmcpID0+XG4gICAgICAgIGFyZ1xuICAgICAgICAgIC5yZXBsYWNlQWxsKFwie3JlcXVlc3R9XCIsIHJlcXVlc3RQYXRoKVxuICAgICAgICAgIC5yZXBsYWNlQWxsKFwie2dyb3VwfVwiLCBncm91cE5hbWUpXG4gICAgICAgICAgLnJlcGxhY2VBbGwoXCJ7Z3JvdXBQYXRofVwiLCBncm91cFBhdGgpLFxuICAgICAgKTtcbiAgICAgIHJldHVybiBhd2FpdCBydW5Qcm9jZXNzKHtcbiAgICAgICAgcnVubmVySWQ6IGBjb250YWluZXI6JHtncm91cE5hbWV9OmN1c3RvbToke3JlcXVlc3QuYWN0aW9ufWAsXG4gICAgICAgIHJ1bm5lck5hbWU6IGBDdXN0b20gJHtncm91cE5hbWV9ICR7cmVxdWVzdC5hY3Rpb259YCxcbiAgICAgICAgZXhlY3V0YWJsZTogY3VzdG9tLmV4ZWN1dGFibGUsXG4gICAgICAgIGFyZ3MsXG4gICAgICAgIHdvcmtpbmdEaXJlY3Rvcnk6IGdyb3VwUGF0aCxcbiAgICAgICAgdGltZW91dE1zLFxuICAgICAgICBzaWduYWwsXG4gICAgICB9KTtcbiAgICB9IGZpbmFsbHkge1xuICAgICAgYXdhaXQgcm0ocmVxdWVzdFBhdGgsIHsgZm9yY2U6IHRydWUgfSk7XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBjcmVhdGVDdXN0b21SZXF1ZXN0KFxuICAgIGFjdGlvbjogbG9vbUN1c3RvbVJ1bnRpbWVSZXF1ZXN0W1wiYWN0aW9uXCJdLFxuICAgIGdyb3VwTmFtZTogc3RyaW5nLFxuICAgIGdyb3VwUGF0aDogc3RyaW5nLFxuICAgIGNvbmZpZzogbG9vbUNvbnRhaW5lckNvbmZpZyxcbiAgICB0aW1lb3V0TXM6IG51bWJlcixcbiAgICBleHRyYTogUGFydGlhbDxsb29tQ3VzdG9tUnVudGltZVJlcXVlc3Q+ID0ge30sXG4gICk6IGxvb21DdXN0b21SdW50aW1lUmVxdWVzdCB7XG4gICAgcmV0dXJuIHtcbiAgICAgIGFjdGlvbixcbiAgICAgIGdyb3VwTmFtZSxcbiAgICAgIGdyb3VwUGF0aCxcbiAgICAgIHJ1bnRpbWU6IGNvbmZpZy5ydW50aW1lLFxuICAgICAgaW1hZ2U6IGNvbmZpZy5pbWFnZSxcbiAgICAgIGJ1aWxkOiBjb25maWcuY3VzdG9tPy5idWlsZCxcbiAgICAgIGNvbW1hbmRTdHJ1Y3R1cmU6IGNvbmZpZy5jdXN0b20/LmNvbW1hbmRTdHJ1Y3R1cmUsXG4gICAgICB0ZWFyZG93bjogY29uZmlnLmN1c3RvbT8udGVhcmRvd24sXG4gICAgICB0aW1lb3V0TXMsXG4gICAgICBjb25maWc6IHtcbiAgICAgICAgZXhlY3V0YWJsZTogY29uZmlnLmV4ZWN1dGFibGUsXG4gICAgICAgIGN1c3RvbTogY29uZmlnLmN1c3RvbSxcbiAgICAgICAgcWVtdTogY29uZmlnLnFlbXUsXG4gICAgICAgIGhlYWx0aENoZWNrOiBjb25maWcuaGVhbHRoQ2hlY2ssXG4gICAgICB9LFxuICAgICAgLi4uZXh0cmEsXG4gICAgfTtcbiAgfVxuXG4gIHByaXZhdGUgY3JlYXRlU3ludGhldGljUmVzdWx0KHJ1bm5lcklkOiBzdHJpbmcsIHJ1bm5lck5hbWU6IHN0cmluZywgc3Rkb3V0OiBzdHJpbmcsIHN1Y2Nlc3MgPSB0cnVlKTogbG9vbVJ1blJlc3VsdCB7XG4gICAgY29uc3Qgbm93ID0gbmV3IERhdGUoKS50b0lTT1N0cmluZygpO1xuICAgIHJldHVybiB7XG4gICAgICBydW5uZXJJZCxcbiAgICAgIHJ1bm5lck5hbWUsXG4gICAgICBzdGFydGVkQXQ6IG5vdyxcbiAgICAgIGZpbmlzaGVkQXQ6IG5vdyxcbiAgICAgIGR1cmF0aW9uTXM6IDAsXG4gICAgICBleGl0Q29kZTogc3VjY2VzcyA/IDAgOiAtMSxcbiAgICAgIHN0ZG91dCxcbiAgICAgIHN0ZGVycjogXCJcIixcbiAgICAgIHN1Y2Nlc3MsXG4gICAgICB0aW1lZE91dDogZmFsc2UsXG4gICAgICBjYW5jZWxsZWQ6IGZhbHNlLFxuICAgIH07XG4gIH1cblxuICBwcml2YXRlIGdldENvbnRhaW5lcnNQYXRoKCk6IHN0cmluZyB7XG4gICAgY29uc3QgYWRhcHRlckJhc2VQYXRoID0gKHRoaXMuYXBwLnZhdWx0LmFkYXB0ZXIgYXMgeyBiYXNlUGF0aD86IHN0cmluZyB9KS5iYXNlUGF0aCA/PyBcIlwiO1xuICAgIHJldHVybiBub3JtYWxpemVGc1BhdGgoam9pbihhZGFwdGVyQmFzZVBhdGgsIHRoaXMucGx1Z2luRGlyLCBcImNvbnRhaW5lcnNcIikpO1xuICB9XG5cbiAgcHJpdmF0ZSByZXNvbHZlR3JvdXBQYXRoKGdyb3VwTmFtZTogc3RyaW5nKTogc3RyaW5nIHtcbiAgICBjb25zdCBzYWZlTmFtZSA9IGJhc2VuYW1lKGdyb3VwTmFtZSk7XG4gICAgaWYgKCFzYWZlTmFtZSB8fCBzYWZlTmFtZSAhPT0gZ3JvdXBOYW1lKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYEludmFsaWQgY29udGFpbmVyIGdyb3VwIG5hbWU6ICR7Z3JvdXBOYW1lfWApO1xuICAgIH1cbiAgICByZXR1cm4gbm9ybWFsaXplRnNQYXRoKGpvaW4odGhpcy5nZXRDb250YWluZXJzUGF0aCgpLCBzYWZlTmFtZSkpO1xuICB9XG5cbiAgcHJpdmF0ZSByZXNvbHZlR3JvdXBGaWxlUGF0aChncm91cFBhdGg6IHN0cmluZywgZmlsZVBhdGg6IHN0cmluZyk6IHN0cmluZyB7XG4gICAgY29uc3Qgc2FmZVBhdGggPSBub3JtYWxpemVGc1BhdGgoam9pbihncm91cFBhdGgsIGZpbGVQYXRoKSk7XG4gICAgY29uc3Qgbm9ybWFsaXplZEdyb3VwUGF0aCA9IG5vcm1hbGl6ZUZzUGF0aChncm91cFBhdGgpO1xuICAgIGNvbnN0IHBvc2l4U2FmZVBhdGggPSBzYWZlUGF0aC5yZXBsYWNlKC9cXFxcL2csIFwiL1wiKTtcbiAgICBjb25zdCBwb3NpeEdyb3VwUGF0aCA9IG5vcm1hbGl6ZWRHcm91cFBhdGgucmVwbGFjZSgvXFxcXC9nLCBcIi9cIik7XG4gICAgaWYgKHBvc2l4U2FmZVBhdGggIT09IHBvc2l4R3JvdXBQYXRoICYmICFwb3NpeFNhZmVQYXRoLnN0YXJ0c1dpdGgoYCR7cG9zaXhHcm91cFBhdGh9L2ApKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYEludmFsaWQgUUVNVSBtYW5hZ2VyIHBhdGggb3V0c2lkZSBjb250YWluZXIgZ3JvdXA6ICR7ZmlsZVBhdGh9YCk7XG4gICAgfVxuICAgIHJldHVybiBzYWZlUGF0aDtcbiAgfVxuXG4gIHByaXZhdGUgaW1hZ2VOYW1lRm9yR3JvdXAoZ3JvdXBOYW1lOiBzdHJpbmcpOiBzdHJpbmcge1xuICAgIHJldHVybiBgbG9vbS1jb250YWluZXItJHtncm91cE5hbWUudG9Mb3dlckNhc2UoKS5yZXBsYWNlKC9bXmEtejAtOV8uLV0vZywgXCItXCIpfWA7XG4gIH1cblxuICBwdWJsaWMgZ2V0RGVmYXVsdExhbmd1YWdlQ29uZmlnKGxhbmdJZDogc3RyaW5nLCBzZXR0aW5nczogbG9vbVBsdWdpblNldHRpbmdzKTogbG9vbUNvbnRhaW5lckxhbmd1YWdlQ29uZmlnIHwgbnVsbCB7XG4gICAgaWYgKCFsYW5nSWQpIHJldHVybiBudWxsO1xuICAgIGNvbnN0IG5vcm1hbGl6ZWQgPSBsYW5nSWQudG9Mb3dlckNhc2UoKS50cmltKCk7XG5cbiAgICAvLyBDaGVjayBjdXN0b20gbGFuZ3VhZ2VzIGZpcnN0XG4gICAgY29uc3QgY3VzdG9tID0gc2V0dGluZ3MuY3VzdG9tTGFuZ3VhZ2VzLmZpbmQoKGMpID0+IHtcbiAgICAgIGNvbnN0IG5hbWVzID0gW2MubmFtZSwgLi4uYy5hbGlhc2VzLnNwbGl0KFwiLFwiKS5tYXAoKHMpID0+IHMudHJpbSgpKV0ubWFwKChuKSA9PiBuLnRvTG93ZXJDYXNlKCkpO1xuICAgICAgcmV0dXJuIG5hbWVzLmluY2x1ZGVzKG5vcm1hbGl6ZWQpO1xuICAgIH0pO1xuICAgIGlmIChjdXN0b20pIHtcbiAgICAgIHJldHVybiB7XG4gICAgICAgIGNvbW1hbmQ6IGAke2N1c3RvbS5leGVjdXRhYmxlfSAke2N1c3RvbS5hcmdzfWAudHJpbSgpLFxuICAgICAgICBleHRlbnNpb246IGN1c3RvbS5leHRlbnNpb24gfHwgXCIudHh0XCIsXG4gICAgICB9O1xuICAgIH1cblxuICAgIC8vIFN0YW5kYXJkIGJ1aWx0LWluc1xuICAgIHN3aXRjaCAobm9ybWFsaXplZCkge1xuICAgICAgY2FzZSBcInB5dGhvblwiOlxuICAgICAgY2FzZSBcInB5XCI6XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgY29tbWFuZDogYCR7c2V0dGluZ3MucHl0aG9uRXhlY3V0YWJsZS50cmltKCkgfHwgXCJweXRob24zXCJ9IHtmaWxlfWAsXG4gICAgICAgICAgZXh0ZW5zaW9uOiBcIi5weVwiLFxuICAgICAgICB9O1xuICAgICAgY2FzZSBcImphdmFzY3JpcHRcIjpcbiAgICAgIGNhc2UgXCJqc1wiOlxuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgIGNvbW1hbmQ6IGAke3NldHRpbmdzLm5vZGVFeGVjdXRhYmxlLnRyaW0oKSB8fCBcIm5vZGVcIn0ge2ZpbGV9YCxcbiAgICAgICAgICBleHRlbnNpb246IFwiLmpzXCIsXG4gICAgICAgIH07XG4gICAgICBjYXNlIFwidHlwZXNjcmlwdFwiOlxuICAgICAgY2FzZSBcInRzXCI6XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgY29tbWFuZDogYCR7c2V0dGluZ3MudHlwZXNjcmlwdFRyYW5zcGlsZXJFeGVjdXRhYmxlLnRyaW0oKSB8fCBcInRzLW5vZGVcIn0ge2ZpbGV9YCxcbiAgICAgICAgICBleHRlbnNpb246IFwiLnRzXCIsXG4gICAgICAgIH07XG4gICAgICBjYXNlIFwic2hlbGxcIjpcbiAgICAgIGNhc2UgXCJzaFwiOlxuICAgICAgY2FzZSBcImJhc2hcIjpcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICBjb21tYW5kOiBgJHtzZXR0aW5ncy5zaGVsbEV4ZWN1dGFibGUudHJpbSgpIHx8IFwiYmFzaFwifSB7ZmlsZX1gLFxuICAgICAgICAgIGV4dGVuc2lvbjogXCIuc2hcIixcbiAgICAgICAgfTtcbiAgICAgIGNhc2UgXCJydWJ5XCI6XG4gICAgICBjYXNlIFwicmJcIjpcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICBjb21tYW5kOiBgJHtzZXR0aW5ncy5ydWJ5RXhlY3V0YWJsZS50cmltKCkgfHwgXCJydWJ5XCJ9IHtmaWxlfWAsXG4gICAgICAgICAgZXh0ZW5zaW9uOiBcIi5yYlwiLFxuICAgICAgICB9O1xuICAgICAgY2FzZSBcInBlcmxcIjpcbiAgICAgIGNhc2UgXCJwbFwiOlxuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgIGNvbW1hbmQ6IGAke3NldHRpbmdzLnBlcmxFeGVjdXRhYmxlLnRyaW0oKSB8fCBcInBlcmxcIn0ge2ZpbGV9YCxcbiAgICAgICAgICBleHRlbnNpb246IFwiLnBsXCIsXG4gICAgICAgIH07XG4gICAgICBjYXNlIFwibHVhXCI6XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgY29tbWFuZDogYCR7c2V0dGluZ3MubHVhRXhlY3V0YWJsZS50cmltKCkgfHwgXCJsdWFcIn0ge2ZpbGV9YCxcbiAgICAgICAgICBleHRlbnNpb246IFwiLmx1YVwiLFxuICAgICAgICB9O1xuICAgICAgY2FzZSBcInBocFwiOlxuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgIGNvbW1hbmQ6IGAke3NldHRpbmdzLnBocEV4ZWN1dGFibGUudHJpbSgpIHx8IFwicGhwXCJ9IHtmaWxlfWAsXG4gICAgICAgICAgZXh0ZW5zaW9uOiBcIi5waHBcIixcbiAgICAgICAgfTtcbiAgICAgIGNhc2UgXCJnb1wiOlxuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgIGNvbW1hbmQ6IGAke3NldHRpbmdzLmdvRXhlY3V0YWJsZS50cmltKCkgfHwgXCJnb1wifSBydW4ge2ZpbGV9YCxcbiAgICAgICAgICBleHRlbnNpb246IFwiLmdvXCIsXG4gICAgICAgIH07XG4gICAgICBjYXNlIFwiaGFza2VsbFwiOlxuICAgICAgY2FzZSBcImhzXCI6XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgY29tbWFuZDogYCR7c2V0dGluZ3MuaGFza2VsbEV4ZWN1dGFibGUudHJpbSgpIHx8IFwicnVuZ2hjXCJ9IHtmaWxlfWAsXG4gICAgICAgICAgZXh0ZW5zaW9uOiBcIi5oc1wiLFxuICAgICAgICB9O1xuICAgICAgY2FzZSBcIm9jYW1sXCI6XG4gICAgICBjYXNlIFwibWxcIjpcbiAgICAgICAgaWYgKHNldHRpbmdzLm9jYW1sTW9kZSA9PT0gXCJkdW5lXCIpIHtcbiAgICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgY29tbWFuZDogYCR7c2V0dGluZ3Mub2NhbWxFeGVjdXRhYmxlLnRyaW0oKSB8fCBcImR1bmVcIn0gZXhlYyAtLSBvY2FtbCB7ZmlsZX1gLFxuICAgICAgICAgICAgZXh0ZW5zaW9uOiBcIi5tbFwiLFxuICAgICAgICAgIH07XG4gICAgICAgIH1cbiAgICAgICAgaWYgKHNldHRpbmdzLm9jYW1sTW9kZSA9PT0gXCJvY2FtbGNcIikge1xuICAgICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICBjb21tYW5kOiBzaGVsbENvbW1hbmQoYCR7c2V0dGluZ3Mub2NhbWxFeGVjdXRhYmxlLnRyaW0oKSB8fCBcIm9jYW1sY1wifSAtbyAvdG1wL2xvb20tb2NhbWwgXCIkMVwiICYmIC90bXAvbG9vbS1vY2FtbGApLFxuICAgICAgICAgICAgZXh0ZW5zaW9uOiBcIi5tbFwiLFxuICAgICAgICAgIH07XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICBjb21tYW5kOiBgJHtzZXR0aW5ncy5vY2FtbEV4ZWN1dGFibGUudHJpbSgpIHx8IFwib2NhbWxcIn0ge2ZpbGV9YCxcbiAgICAgICAgICBleHRlbnNpb246IFwiLm1sXCIsXG4gICAgICAgIH07XG4gICAgICBjYXNlIFwiY1wiOlxuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgIGNvbW1hbmQ6IHNoZWxsQ29tbWFuZChgJHtzZXR0aW5ncy5jRXhlY3V0YWJsZS50cmltKCkgfHwgXCJnY2NcIn0gXCIkMVwiIC1vIC90bXAvbG9vbS1jICYmIC90bXAvbG9vbS1jYCksXG4gICAgICAgICAgZXh0ZW5zaW9uOiBcIi5jXCIsXG4gICAgICAgIH07XG4gICAgICBjYXNlIFwiY3BwXCI6XG4gICAgICBjYXNlIFwiYysrXCI6XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgY29tbWFuZDogc2hlbGxDb21tYW5kKGAke3NldHRpbmdzLmNwcEV4ZWN1dGFibGUudHJpbSgpIHx8IFwiZysrXCJ9IFwiJDFcIiAtbyAvdG1wL2xvb20tY3BwICYmIC90bXAvbG9vbS1jcHBgKSxcbiAgICAgICAgICBleHRlbnNpb246IFwiLmNwcFwiLFxuICAgICAgICB9O1xuICAgICAgY2FzZSBcInJ1c3RcIjpcbiAgICAgIGNhc2UgXCJyc1wiOlxuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgIGNvbW1hbmQ6IHNoZWxsQ29tbWFuZChgJHtzZXR0aW5ncy5ydXN0RXhlY3V0YWJsZS50cmltKCkgfHwgXCJydXN0Y1wifSBcIiQxXCIgLW8gL3RtcC9sb29tLXJ1c3QgJiYgL3RtcC9sb29tLXJ1c3RgKSxcbiAgICAgICAgICBleHRlbnNpb246IFwiLnJzXCIsXG4gICAgICAgIH07XG4gICAgICBjYXNlIFwiamF2YVwiOiB7XG4gICAgICAgIGNvbnN0IGNvbXBpbGVyID0gc2V0dGluZ3MuamF2YUNvbXBpbGVyRXhlY3V0YWJsZS50cmltKCkgfHwgXCJqYXZhY1wiO1xuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgIGNvbW1hbmQ6IHNoZWxsQ29tbWFuZChgdG1wPS90bXAvbG9vbS1qYXZhLSQkICYmIG1rZGlyIC1wIFwiJHRtcFwiICYmIGNwIFwiJDFcIiBcIiR0bXAvTWFpbi5qYXZhXCIgJiYgJHtjb21waWxlcn0gXCIkdG1wL01haW4uamF2YVwiICYmICR7c2V0dGluZ3MuamF2YUV4ZWN1dGFibGUudHJpbSgpIHx8IFwiamF2YVwifSAtY3AgXCIkdG1wXCIgTWFpbmApLFxuICAgICAgICAgIGV4dGVuc2lvbjogXCIuamF2YVwiLFxuICAgICAgICB9O1xuICAgICAgfVxuICAgICAgY2FzZSBcImxsdm0taXJcIjpcbiAgICAgIGNhc2UgXCJsbHZtXCI6XG4gICAgICBjYXNlIFwibGxcIjpcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICBjb21tYW5kOiBgJHtzZXR0aW5ncy5sbHZtSW50ZXJwcmV0ZXJFeGVjdXRhYmxlLnRyaW0oKSB8fCBcImxsaVwifSB7ZmlsZX1gLFxuICAgICAgICAgIGV4dGVuc2lvbjogXCIubGxcIixcbiAgICAgICAgfTtcbiAgICAgIGNhc2UgXCJsZWFuXCI6XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgY29tbWFuZDogYCR7c2V0dGluZ3MubGVhbkV4ZWN1dGFibGUudHJpbSgpIHx8IFwibGVhblwifSB7ZmlsZX1gLFxuICAgICAgICAgIGV4dGVuc2lvbjogXCIubGVhblwiLFxuICAgICAgICB9O1xuICAgICAgY2FzZSBcImNvcVwiOlxuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgIGNvbW1hbmQ6IGAke3NldHRpbmdzLmNvcUV4ZWN1dGFibGUudHJpbSgpIHx8IFwiY29xY1wifSAtcSB7ZmlsZX1gLFxuICAgICAgICAgIGV4dGVuc2lvbjogXCIudlwiLFxuICAgICAgICB9O1xuICAgICAgY2FzZSBcInNtdGxpYlwiOlxuICAgICAgY2FzZSBcInNtdFwiOlxuICAgICAgY2FzZSBcInNtdC1saWJcIjpcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICBjb21tYW5kOiBgJHtzZXR0aW5ncy5zbXRFeGVjdXRhYmxlLnRyaW0oKSB8fCBcInozXCJ9IHtmaWxlfWAsXG4gICAgICAgICAgZXh0ZW5zaW9uOiBcIi5zbXQyXCIsXG4gICAgICAgIH07XG4gICAgfVxuICAgIHJldHVybiBudWxsO1xuICB9XG59XG5cbmZ1bmN0aW9uIHNoZWxsQ29tbWFuZChjb21tYW5kOiBzdHJpbmcpOiBzdHJpbmcge1xuICByZXR1cm4gYHNoIC1sYyAke3F1b3RlQ29tbWFuZEFyZyhjb21tYW5kKX0gc2gge2ZpbGV9YDtcbn1cblxuZnVuY3Rpb24gbm9ybWFsaXplRXh0ZW5zaW9uKGV4dGVuc2lvbjogc3RyaW5nKTogc3RyaW5nIHtcbiAgY29uc3QgdHJpbW1lZCA9IGV4dGVuc2lvbi50cmltKCk7XG4gIHJldHVybiB0cmltbWVkLnN0YXJ0c1dpdGgoXCIuXCIpID8gdHJpbW1lZCA6IGAuJHt0cmltbWVkfWA7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBzaG93RG9ja2VyTm90aWNlKG1lc3NhZ2U6IHN0cmluZyk6IHZvaWQge1xuICBuZXcgTm90aWNlKG1lc3NhZ2UsIDgwMDApO1xufVxuXG5mdW5jdGlvbiBvcHRpb25hbFN0cmluZyh2YWx1ZTogdW5rbm93bik6IHN0cmluZyB8IHVuZGVmaW5lZCB7XG4gIHJldHVybiB0eXBlb2YgdmFsdWUgPT09IFwic3RyaW5nXCIgJiYgdmFsdWUudHJpbSgpID8gdmFsdWUudHJpbSgpIDogdW5kZWZpbmVkO1xufVxuXG5mdW5jdGlvbiBvcHRpb25hbFBvc2l0aXZlSW50ZWdlcih2YWx1ZTogdW5rbm93biwgbGFiZWw6IHN0cmluZyk6IG51bWJlciB8IHVuZGVmaW5lZCB7XG4gIGlmICh2YWx1ZSA9PSBudWxsKSB7XG4gICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgfVxuICBpZiAodHlwZW9mIHZhbHVlICE9PSBcIm51bWJlclwiIHx8ICFOdW1iZXIuaXNJbnRlZ2VyKHZhbHVlKSB8fCB2YWx1ZSA8PSAwKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGAke2xhYmVsfSBtdXN0IGJlIGEgcG9zaXRpdmUgaW50ZWdlci5gKTtcbiAgfVxuICByZXR1cm4gdmFsdWU7XG59XG5cbmZ1bmN0aW9uIG9wdGlvbmFsTm9uTmVnYXRpdmVJbnRlZ2VyKHZhbHVlOiB1bmtub3duLCBsYWJlbDogc3RyaW5nKTogbnVtYmVyIHwgdW5kZWZpbmVkIHtcbiAgaWYgKHZhbHVlID09IG51bGwpIHtcbiAgICByZXR1cm4gdW5kZWZpbmVkO1xuICB9XG4gIGlmICh0eXBlb2YgdmFsdWUgIT09IFwibnVtYmVyXCIgfHwgIU51bWJlci5pc0ludGVnZXIodmFsdWUpIHx8IHZhbHVlIDwgMCkge1xuICAgIHRocm93IG5ldyBFcnJvcihgJHtsYWJlbH0gbXVzdCBiZSBhIG5vbi1uZWdhdGl2ZSBpbnRlZ2VyLmApO1xuICB9XG4gIHJldHVybiB2YWx1ZTtcbn1cblxuZnVuY3Rpb24gb3B0aW9uYWxTaWduYWwodmFsdWU6IHVua25vd24sIGxhYmVsOiBzdHJpbmcpOiBOb2RlSlMuU2lnbmFscyB8IHVuZGVmaW5lZCB7XG4gIGlmICh2YWx1ZSA9PSBudWxsKSB7XG4gICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgfVxuICBpZiAodHlwZW9mIHZhbHVlICE9PSBcInN0cmluZ1wiIHx8ICEvXlNJR1tBLVowLTldKyQvLnRlc3QodmFsdWUpKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGAke2xhYmVsfSBtdXN0IGJlIGEgc2lnbmFsIG5hbWUgbGlrZSBTSUdURVJNLmApO1xuICB9XG4gIHJldHVybiB2YWx1ZSBhcyBOb2RlSlMuU2lnbmFscztcbn1cblxuYXN5bmMgZnVuY3Rpb24gc2xlZXBXaXRoU2lnbmFsKGR1cmF0aW9uTXM6IG51bWJlciwgc2lnbmFsOiBBYm9ydFNpZ25hbCk6IFByb21pc2U8dm9pZD4ge1xuICBpZiAoZHVyYXRpb25NcyA8PSAwIHx8IHNpZ25hbC5hYm9ydGVkKSB7XG4gICAgcmV0dXJuO1xuICB9XG5cbiAgYXdhaXQgbmV3IFByb21pc2U8dm9pZD4oKHJlc29sdmUpID0+IHtcbiAgICBjb25zdCB0aW1lb3V0ID0gc2V0VGltZW91dChyZXNvbHZlLCBkdXJhdGlvbk1zKTtcbiAgICBjb25zdCBhYm9ydCA9ICgpID0+IHtcbiAgICAgIGNsZWFyVGltZW91dCh0aW1lb3V0KTtcbiAgICAgIHJlc29sdmUoKTtcbiAgICB9O1xuICAgIHNpZ25hbC5hZGRFdmVudExpc3RlbmVyKFwiYWJvcnRcIiwgYWJvcnQsIHsgb25jZTogdHJ1ZSB9KTtcbiAgfSk7XG59XG5cbmZ1bmN0aW9uIHJ1bnRpbWVMYWJlbChydW50aW1lOiBsb29tQ29udGFpbmVyUnVudGltZSk6IHN0cmluZyB7XG4gIHN3aXRjaCAocnVudGltZSkge1xuICAgIGNhc2UgXCJkb2NrZXJcIjpcbiAgICAgIHJldHVybiBcIkRvY2tlclwiO1xuICAgIGNhc2UgXCJwb2RtYW5cIjpcbiAgICAgIHJldHVybiBcIlBvZG1hblwiO1xuICAgIGNhc2UgXCJxZW11XCI6XG4gICAgICByZXR1cm4gXCJRRU1VXCI7XG4gICAgY2FzZSBcImN1c3RvbVwiOlxuICAgICAgcmV0dXJuIFwiQ3VzdG9tXCI7XG4gICAgY2FzZSBcIndzbFwiOlxuICAgICAgcmV0dXJuIFwiV1NMXCI7XG4gIH1cbn1cblxuZnVuY3Rpb24gc2hlbGxRdW90ZSh2YWx1ZTogc3RyaW5nKTogc3RyaW5nIHtcbiAgcmV0dXJuIGAnJHt2YWx1ZS5yZXBsYWNlQWxsKFwiJ1wiLCBcIidcXFxcJydcIil9J2A7XG59XG5cbmZ1bmN0aW9uIHF1b3RlQ29tbWFuZEFyZyh2YWx1ZTogc3RyaW5nKTogc3RyaW5nIHtcbiAgcmV0dXJuIGAnJHt2YWx1ZS5yZXBsYWNlQWxsKFwiJ1wiLCBcIidcXFxcJydcIil9J2A7XG59XG4iLCAiaW1wb3J0IHsgbWtkdGVtcCwgcm0sIHdyaXRlRmlsZSB9IGZyb20gXCJmcy9wcm9taXNlc1wiO1xuaW1wb3J0IHsgdG1wZGlyIH0gZnJvbSBcIm9zXCI7XG5pbXBvcnQgeyBqb2luIH0gZnJvbSBcInBhdGhcIjtcbmltcG9ydCB7IHNwYXduIH0gZnJvbSBcImNoaWxkX3Byb2Nlc3NcIjtcbmltcG9ydCB0eXBlIHsgbG9vbVJ1blJlc3VsdCB9IGZyb20gXCIuLi90eXBlc1wiO1xuXG5leHBvcnQgaW50ZXJmYWNlIGxvb21Qcm9jZXNzU3BlYyB7XG4gIHJ1bm5lcklkOiBzdHJpbmc7XG4gIHJ1bm5lck5hbWU6IHN0cmluZztcbiAgZXhlY3V0YWJsZTogc3RyaW5nO1xuICBhcmdzOiBzdHJpbmdbXTtcbiAgd29ya2luZ0RpcmVjdG9yeTogc3RyaW5nO1xuICB0aW1lb3V0TXM6IG51bWJlcjtcbiAgc2lnbmFsOiBBYm9ydFNpZ25hbDtcbiAgZW52PzogTm9kZUpTLlByb2Nlc3NFbnY7XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgbG9vbVRlbXBTb3VyY2VTcGVjIGV4dGVuZHMgbG9vbVByb2Nlc3NTcGVjIHtcbiAgZmlsZUV4dGVuc2lvbjogc3RyaW5nO1xuICBzb3VyY2U6IHN0cmluZztcbn1cblxuZXhwb3J0IGludGVyZmFjZSBsb29tVGVtcFNvdXJjZUhhbmRsZSB7XG4gIHRlbXBEaXI6IHN0cmluZztcbiAgdGVtcEZpbGU6IHN0cmluZztcbn1cblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHdpdGhOYW1lZFRlbXBTb3VyY2VGaWxlPFQ+KFxuICBmaWxlTmFtZTogc3RyaW5nLFxuICBzb3VyY2U6IHN0cmluZyxcbiAgY2FsbGJhY2s6IChoYW5kbGU6IGxvb21UZW1wU291cmNlSGFuZGxlKSA9PiBQcm9taXNlPFQ+LFxuKTogUHJvbWlzZTxUPiB7XG4gIGNvbnN0IHRlbXBEaXIgPSBhd2FpdCBta2R0ZW1wKGpvaW4odG1wZGlyKCksIFwibG9vbS1cIikpO1xuICBjb25zdCB0ZW1wRmlsZSA9IGpvaW4odGVtcERpciwgZmlsZU5hbWUpO1xuXG4gIHRyeSB7XG4gICAgYXdhaXQgd3JpdGVGaWxlKHRlbXBGaWxlLCBub3JtYWxpemVFeGVjdXRhYmxlU291cmNlKHNvdXJjZSksIFwidXRmOFwiKTtcbiAgICByZXR1cm4gYXdhaXQgY2FsbGJhY2soeyB0ZW1wRGlyLCB0ZW1wRmlsZSB9KTtcbiAgfSBmaW5hbGx5IHtcbiAgICBhd2FpdCBybSh0ZW1wRGlyLCB7IHJlY3Vyc2l2ZTogdHJ1ZSwgZm9yY2U6IHRydWUgfSk7XG4gIH1cbn1cblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHdpdGhUZW1wU291cmNlRmlsZTxUPihcbiAgZmlsZUV4dGVuc2lvbjogc3RyaW5nLFxuICBzb3VyY2U6IHN0cmluZyxcbiAgY2FsbGJhY2s6IChoYW5kbGU6IGxvb21UZW1wU291cmNlSGFuZGxlKSA9PiBQcm9taXNlPFQ+LFxuKTogUHJvbWlzZTxUPiB7XG4gIHJldHVybiB3aXRoTmFtZWRUZW1wU291cmNlRmlsZShgc25pcHBldCR7ZmlsZUV4dGVuc2lvbn1gLCBzb3VyY2UsIGNhbGxiYWNrKTtcbn1cblxuZnVuY3Rpb24gbm9ybWFsaXplRXhlY3V0YWJsZVNvdXJjZShzb3VyY2U6IHN0cmluZyk6IHN0cmluZyB7XG4gIGNvbnN0IGxpbmVzID0gc291cmNlLnNwbGl0KFwiXFxuXCIpO1xuICBjb25zdCBub25FbXB0eUxpbmVzID0gbGluZXMuZmlsdGVyKChsaW5lKSA9PiBsaW5lLnRyaW0oKS5sZW5ndGggPiAwKTtcbiAgaWYgKCFub25FbXB0eUxpbmVzLmxlbmd0aCkge1xuICAgIHJldHVybiBzb3VyY2U7XG4gIH1cblxuICBsZXQgc2hhcmVkSW5kZW50ID0gZ2V0TGVhZGluZ1doaXRlc3BhY2Uobm9uRW1wdHlMaW5lc1swXSk7XG4gIGZvciAoY29uc3QgbGluZSBvZiBub25FbXB0eUxpbmVzLnNsaWNlKDEpKSB7XG4gICAgc2hhcmVkSW5kZW50ID0gc2hhcmVkV2hpdGVzcGFjZVByZWZpeChzaGFyZWRJbmRlbnQsIGdldExlYWRpbmdXaGl0ZXNwYWNlKGxpbmUpKTtcbiAgICBpZiAoIXNoYXJlZEluZGVudCkge1xuICAgICAgcmV0dXJuIHNvdXJjZTtcbiAgICB9XG4gIH1cblxuICBpZiAoIXNoYXJlZEluZGVudCkge1xuICAgIHJldHVybiBzb3VyY2U7XG4gIH1cblxuICByZXR1cm4gbGluZXNcbiAgICAubWFwKChsaW5lKSA9PiAobGluZS50cmltKCkubGVuZ3RoID09PSAwID8gbGluZSA6IGxpbmUuc3RhcnRzV2l0aChzaGFyZWRJbmRlbnQpID8gbGluZS5zbGljZShzaGFyZWRJbmRlbnQubGVuZ3RoKSA6IGxpbmUpKVxuICAgIC5qb2luKFwiXFxuXCIpO1xufVxuXG5mdW5jdGlvbiBnZXRMZWFkaW5nV2hpdGVzcGFjZShsaW5lOiBzdHJpbmcpOiBzdHJpbmcge1xuICBjb25zdCBtYXRjaCA9IGxpbmUubWF0Y2goL15bXFx0IF0qLyk7XG4gIHJldHVybiBtYXRjaD8uWzBdID8/IFwiXCI7XG59XG5cbmZ1bmN0aW9uIHNoYXJlZFdoaXRlc3BhY2VQcmVmaXgobGVmdDogc3RyaW5nLCByaWdodDogc3RyaW5nKTogc3RyaW5nIHtcbiAgbGV0IGluZGV4ID0gMDtcbiAgd2hpbGUgKGluZGV4IDwgbGVmdC5sZW5ndGggJiYgaW5kZXggPCByaWdodC5sZW5ndGggJiYgbGVmdFtpbmRleF0gPT09IHJpZ2h0W2luZGV4XSkge1xuICAgIGluZGV4ICs9IDE7XG4gIH1cbiAgcmV0dXJuIGxlZnQuc2xpY2UoMCwgaW5kZXgpO1xufVxuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gcnVuUHJvY2VzcyhzcGVjOiBsb29tUHJvY2Vzc1NwZWMpOiBQcm9taXNlPGxvb21SdW5SZXN1bHQ+IHtcbiAgY29uc3Qgc3RhcnRlZEF0ID0gbmV3IERhdGUoKTtcbiAgbGV0IHN0ZG91dCA9IFwiXCI7XG4gIGxldCBzdGRlcnIgPSBcIlwiO1xuICBsZXQgZXhpdENvZGU6IG51bWJlciB8IG51bGwgPSBudWxsO1xuICBsZXQgdGltZWRPdXQgPSBmYWxzZTtcbiAgbGV0IGNhbmNlbGxlZCA9IGZhbHNlO1xuICBsZXQgY2hpbGQ6IFJldHVyblR5cGU8dHlwZW9mIHNwYXduPiB8IG51bGwgPSBudWxsO1xuICBsZXQgdGltZW91dEhhbmRsZTogTm9kZUpTLlRpbWVvdXQgfCBudWxsID0gbnVsbDtcbiAgbGV0IGFib3J0SGFuZGxlcjogKCgpID0+IHZvaWQpIHwgbnVsbCA9IG51bGw7XG5cbiAgdHJ5IHtcbiAgICBhd2FpdCBuZXcgUHJvbWlzZTx2b2lkPigocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG4gICAgICBjaGlsZCA9IHNwYXduKHNwZWMuZXhlY3V0YWJsZSwgc3BlYy5hcmdzLCB7XG4gICAgICAgIGN3ZDogc3BlYy53b3JraW5nRGlyZWN0b3J5LFxuICAgICAgICBzaGVsbDogZmFsc2UsXG4gICAgICAgIGVudjoge1xuICAgICAgICAgIC4uLnByb2Nlc3MuZW52LFxuICAgICAgICAgIC4uLnNwZWMuZW52LFxuICAgICAgICB9LFxuICAgICAgfSk7XG5cbiAgICAgIGNvbnN0IGFib3J0ID0gKCkgPT4ge1xuICAgICAgICBjYW5jZWxsZWQgPSB0cnVlO1xuICAgICAgICBjaGlsZD8ua2lsbChcIlNJR1RFUk1cIik7XG4gICAgICB9O1xuICAgICAgYWJvcnRIYW5kbGVyID0gYWJvcnQ7XG5cbiAgICAgIGlmIChzcGVjLnNpZ25hbC5hYm9ydGVkKSB7XG4gICAgICAgIGFib3J0KCk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBzcGVjLnNpZ25hbC5hZGRFdmVudExpc3RlbmVyKFwiYWJvcnRcIiwgYWJvcnQsIHsgb25jZTogdHJ1ZSB9KTtcbiAgICAgIH1cblxuICAgICAgdGltZW91dEhhbmRsZSA9IHNldFRpbWVvdXQoKCkgPT4ge1xuICAgICAgICB0aW1lZE91dCA9IHRydWU7XG4gICAgICAgIGNoaWxkPy5raWxsKFwiU0lHVEVSTVwiKTtcbiAgICAgIH0sIHNwZWMudGltZW91dE1zKTtcblxuICAgICAgY2hpbGQuc3Rkb3V0Py5vbihcImRhdGFcIiwgKGNodW5rKSA9PiB7XG4gICAgICAgIHN0ZG91dCArPSBjaHVuay50b1N0cmluZygpO1xuICAgICAgfSk7XG5cbiAgICAgIGNoaWxkLnN0ZGVycj8ub24oXCJkYXRhXCIsIChjaHVuaykgPT4ge1xuICAgICAgICBzdGRlcnIgKz0gY2h1bmsudG9TdHJpbmcoKTtcbiAgICAgIH0pO1xuXG4gICAgICBjaGlsZC5vbihcImVycm9yXCIsIChlcnJvcikgPT4ge1xuICAgICAgICByZWplY3QoZXJyb3IpO1xuICAgICAgfSk7XG5cbiAgICAgIGNoaWxkLm9uKFwiY2xvc2VcIiwgKGNvZGUpID0+IHtcbiAgICAgICAgZXhpdENvZGUgPSBjb2RlO1xuICAgICAgICByZXNvbHZlKCk7XG4gICAgICB9KTtcbiAgICB9KTtcbiAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICBzdGRlcnIgPSBzdGRlcnIgfHwgZm9ybWF0UHJvY2Vzc0Vycm9yKGVycm9yLCBzcGVjLmV4ZWN1dGFibGUpO1xuICAgIGV4aXRDb2RlID0gZXhpdENvZGUgPz8gLTE7XG4gIH0gZmluYWxseSB7XG4gICAgaWYgKGFib3J0SGFuZGxlcikge1xuICAgICAgc3BlYy5zaWduYWwucmVtb3ZlRXZlbnRMaXN0ZW5lcihcImFib3J0XCIsIGFib3J0SGFuZGxlcik7XG4gICAgfVxuICAgIGlmICh0aW1lb3V0SGFuZGxlKSB7XG4gICAgICBjbGVhclRpbWVvdXQodGltZW91dEhhbmRsZSk7XG4gICAgfVxuICB9XG5cbiAgY29uc3QgZmluaXNoZWRBdCA9IG5ldyBEYXRlKCk7XG4gIGNvbnN0IGR1cmF0aW9uTXMgPSBmaW5pc2hlZEF0LmdldFRpbWUoKSAtIHN0YXJ0ZWRBdC5nZXRUaW1lKCk7XG4gIGNvbnN0IHN1Y2Nlc3MgPSAhdGltZWRPdXQgJiYgIWNhbmNlbGxlZCAmJiBleGl0Q29kZSA9PT0gMDtcblxuICByZXR1cm4ge1xuICAgIHJ1bm5lcklkOiBzcGVjLnJ1bm5lcklkLFxuICAgIHJ1bm5lck5hbWU6IHNwZWMucnVubmVyTmFtZSxcbiAgICBzdGFydGVkQXQ6IHN0YXJ0ZWRBdC50b0lTT1N0cmluZygpLFxuICAgIGZpbmlzaGVkQXQ6IGZpbmlzaGVkQXQudG9JU09TdHJpbmcoKSxcbiAgICBkdXJhdGlvbk1zLFxuICAgIGV4aXRDb2RlLFxuICAgIHN0ZG91dCxcbiAgICBzdGRlcnIsXG4gICAgc3VjY2VzcyxcbiAgICB0aW1lZE91dCxcbiAgICBjYW5jZWxsZWQsXG4gIH07XG59XG5cbmZ1bmN0aW9uIGZvcm1hdFByb2Nlc3NFcnJvcihlcnJvcjogdW5rbm93biwgZXhlY3V0YWJsZTogc3RyaW5nKTogc3RyaW5nIHtcbiAgaWYgKGVycm9yIGluc3RhbmNlb2YgRXJyb3IgJiYgXCJjb2RlXCIgaW4gZXJyb3IgJiYgKGVycm9yIGFzIE5vZGVKUy5FcnJub0V4Y2VwdGlvbikuY29kZSA9PT0gXCJFTk9FTlRcIikge1xuICAgIHJldHVybiBgRXhlY3V0YWJsZSBub3QgZm91bmQ6ICR7ZXhlY3V0YWJsZX1gO1xuICB9XG5cbiAgcmV0dXJuIGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogU3RyaW5nKGVycm9yKTtcbn1cblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHJ1blRlbXBGaWxlUHJvY2VzcyhzcGVjOiBsb29tVGVtcFNvdXJjZVNwZWMpOiBQcm9taXNlPGxvb21SdW5SZXN1bHQ+IHtcbiAgcmV0dXJuIHdpdGhUZW1wU291cmNlRmlsZShzcGVjLmZpbGVFeHRlbnNpb24sIHNwZWMuc291cmNlLCBhc3luYyAoeyB0ZW1wRmlsZSwgdGVtcERpciB9KSA9PlxuICAgIHJ1blByb2Nlc3Moe1xuICAgICAgcnVubmVySWQ6IHNwZWMucnVubmVySWQsXG4gICAgICBydW5uZXJOYW1lOiBzcGVjLnJ1bm5lck5hbWUsXG4gICAgICBleGVjdXRhYmxlOiBzcGVjLmV4ZWN1dGFibGUsXG4gICAgICBhcmdzOiBzcGVjLmFyZ3MubWFwKCh2YWx1ZSkgPT4gdmFsdWUucmVwbGFjZUFsbChcIntmaWxlfVwiLCB0ZW1wRmlsZSkucmVwbGFjZUFsbChcInt0ZW1wRGlyfVwiLCB0ZW1wRGlyKSksXG4gICAgICB3b3JraW5nRGlyZWN0b3J5OiBzcGVjLndvcmtpbmdEaXJlY3RvcnksXG4gICAgICB0aW1lb3V0TXM6IHNwZWMudGltZW91dE1zLFxuICAgICAgc2lnbmFsOiBzcGVjLnNpZ25hbCxcbiAgICAgIGVudjogZXhwYW5kVGVtcGxhdGVkRW52KHNwZWMuZW52LCB0ZW1wRmlsZSwgdGVtcERpciksXG4gICAgfSksXG4gICk7XG59XG5cbmZ1bmN0aW9uIGV4cGFuZFRlbXBsYXRlZEVudihlbnY6IE5vZGVKUy5Qcm9jZXNzRW52IHwgdW5kZWZpbmVkLCB0ZW1wRmlsZTogc3RyaW5nLCB0ZW1wRGlyOiBzdHJpbmcpOiBOb2RlSlMuUHJvY2Vzc0VudiB8IHVuZGVmaW5lZCB7XG4gIGlmICghZW52KSB7XG4gICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgfVxuXG4gIHJldHVybiBPYmplY3QuZnJvbUVudHJpZXMoXG4gICAgT2JqZWN0LmVudHJpZXMoZW52KS5tYXAoKFtrZXksIHZhbHVlXSkgPT4gW1xuICAgICAga2V5LFxuICAgICAgdHlwZW9mIHZhbHVlID09PSBcInN0cmluZ1wiID8gdmFsdWUucmVwbGFjZUFsbChcIntmaWxlfVwiLCB0ZW1wRmlsZSkucmVwbGFjZUFsbChcInt0ZW1wRGlyfVwiLCB0ZW1wRGlyKSA6IHZhbHVlLFxuICAgIF0pLFxuICApO1xufVxuIiwgImV4cG9ydCBmdW5jdGlvbiBzcGxpdENvbW1hbmRMaW5lKGlucHV0OiBzdHJpbmcpOiBzdHJpbmdbXSB7XG4gIGNvbnN0IHBhcnRzOiBzdHJpbmdbXSA9IFtdO1xuICBsZXQgY3VycmVudCA9IFwiXCI7XG4gIGxldCBxdW90ZTogXCInXCIgfCBcIlxcXCJcIiB8IG51bGwgPSBudWxsO1xuICBsZXQgZXNjYXBpbmcgPSBmYWxzZTtcblxuICBmb3IgKGNvbnN0IGNoYXIgb2YgaW5wdXQudHJpbSgpKSB7XG4gICAgaWYgKGVzY2FwaW5nKSB7XG4gICAgICBjdXJyZW50ICs9IGNoYXI7XG4gICAgICBlc2NhcGluZyA9IGZhbHNlO1xuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgaWYgKGNoYXIgPT09IFwiXFxcXFwiKSB7XG4gICAgICBlc2NhcGluZyA9IHRydWU7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICBpZiAoKGNoYXIgPT09IFwiJ1wiIHx8IGNoYXIgPT09IFwiXFxcIlwiKSAmJiAhcXVvdGUpIHtcbiAgICAgIHF1b3RlID0gY2hhcjtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cblxuICAgIGlmIChjaGFyID09PSBxdW90ZSkge1xuICAgICAgcXVvdGUgPSBudWxsO1xuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgaWYgKC9cXHMvLnRlc3QoY2hhcikgJiYgIXF1b3RlKSB7XG4gICAgICBpZiAoY3VycmVudCkge1xuICAgICAgICBwYXJ0cy5wdXNoKGN1cnJlbnQpO1xuICAgICAgICBjdXJyZW50ID0gXCJcIjtcbiAgICAgIH1cbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cblxuICAgIGN1cnJlbnQgKz0gY2hhcjtcbiAgfVxuXG4gIGlmIChjdXJyZW50KSB7XG4gICAgcGFydHMucHVzaChjdXJyZW50KTtcbiAgfVxuXG4gIHJldHVybiBwYXJ0cztcbn1cbiIsICJpbXBvcnQgeyBEZWNvcmF0aW9uLCB0eXBlIEVkaXRvclZpZXcgfSBmcm9tIFwiQGNvZGVtaXJyb3Ivdmlld1wiO1xuaW1wb3J0IHR5cGUgeyBSYW5nZVNldEJ1aWxkZXIgfSBmcm9tIFwiQGNvZGVtaXJyb3Ivc3RhdGVcIjtcbmltcG9ydCB0eXBlIHsgbG9vbUNvZGVCbG9jayB9IGZyb20gXCIuL3R5cGVzXCI7XG5cbmludGVyZmFjZSBMbHZtVG9rZW4ge1xuICBmcm9tOiBudW1iZXI7XG4gIHRvOiBudW1iZXI7XG4gIGNsYXNzTmFtZTogc3RyaW5nO1xufVxuXG5jb25zdCBMTFZNX0tFWVdPUkRTID0gbmV3IE1hcDxzdHJpbmcsIHN0cmluZz4oW1xuICAuLi5tYXBXb3JkcyhcImxvb20tbGx2bS1rZXl3b3JkLWNvbnRyb2xcIiwgW1xuICAgIFwicmV0XCIsIFwiYnJcIiwgXCJzd2l0Y2hcIiwgXCJpbmRpcmVjdGJyXCIsIFwiaW52b2tlXCIsIFwiY2FsbGJyXCIsIFwicmVzdW1lXCIsIFwidW5yZWFjaGFibGVcIiwgXCJjbGVhbnVwcmV0XCIsIFwiY2F0Y2hyZXRcIiwgXCJjYXRjaHN3aXRjaFwiLFxuICBdKSxcbiAgLi4ubWFwV29yZHMoXCJsb29tLWxsdm0ta2V5d29yZC1kZWNsYXJhdGlvblwiLCBbXG4gICAgXCJkZWZpbmVcIiwgXCJkZWNsYXJlXCIsIFwidHlwZVwiLCBcImdsb2JhbFwiLCBcImNvbnN0YW50XCIsIFwiYWxpYXNcIiwgXCJpZnVuY1wiLCBcImNvbWRhdFwiLCBcImF0dHJpYnV0ZXNcIiwgXCJzZWN0aW9uXCIsIFwiZ2NcIiwgXCJwcmVmaXhcIiwgXCJwcm9sb2d1ZVwiLFxuICAgIFwicGVyc29uYWxpdHlcIiwgXCJ1c2VsaXN0b3JkZXJcIiwgXCJ1c2VsaXN0b3JkZXJfYmJcIiwgXCJtb2R1bGVcIiwgXCJhc21cIiwgXCJzb3VyY2VfZmlsZW5hbWVcIiwgXCJ0YXJnZXRcIixcbiAgXSksXG4gIC4uLm1hcFdvcmRzKFwibG9vbS1sbHZtLWtleXdvcmQtbWVtb3J5XCIsIFtcbiAgICBcImFsbG9jYVwiLCBcImxvYWRcIiwgXCJzdG9yZVwiLCBcImdldGVsZW1lbnRwdHJcIiwgXCJmZW5jZVwiLCBcImNtcHhjaGdcIiwgXCJhdG9taWNybXdcIiwgXCJleHRyYWN0dmFsdWVcIiwgXCJpbnNlcnR2YWx1ZVwiLCBcImV4dHJhY3RlbGVtZW50XCIsXG4gICAgXCJpbnNlcnRlbGVtZW50XCIsIFwic2h1ZmZsZXZlY3RvclwiLFxuICBdKSxcbiAgLi4ubWFwV29yZHMoXCJsb29tLWxsdm0ta2V5d29yZC1hcml0aG1ldGljXCIsIFtcbiAgICBcImFkZFwiLCBcInN1YlwiLCBcIm11bFwiLCBcInVkaXZcIiwgXCJzZGl2XCIsIFwidXJlbVwiLCBcInNyZW1cIiwgXCJzaGxcIiwgXCJsc2hyXCIsIFwiYXNoclwiLCBcImFuZFwiLCBcIm9yXCIsIFwieG9yXCIsIFwiZm5lZ1wiLCBcImZhZGRcIiwgXCJmc3ViXCIsIFwiZm11bFwiLFxuICAgIFwiZmRpdlwiLCBcImZyZW1cIixcbiAgXSksXG4gIC4uLm1hcFdvcmRzKFwibG9vbS1sbHZtLWtleXdvcmQtY29tcGFyaXNvblwiLCBbXCJpY21wXCIsIFwiZmNtcFwiXSksXG4gIC4uLm1hcFdvcmRzKFwibG9vbS1sbHZtLWtleXdvcmQtY2FzdFwiLCBbXG4gICAgXCJ0cnVuY1wiLCBcInpleHRcIiwgXCJzZXh0XCIsIFwiZnB0cnVuY1wiLCBcImZwZXh0XCIsIFwiZnB0b3VpXCIsIFwiZnB0b3NpXCIsIFwidWl0b2ZwXCIsIFwic2l0b2ZwXCIsIFwicHRydG9pbnRcIiwgXCJpbnR0b3B0clwiLCBcImJpdGNhc3RcIiwgXCJhZGRyc3BhY2VjYXN0XCIsXG4gIF0pLFxuICAuLi5tYXBXb3JkcyhcImxvb20tbGx2bS1rZXl3b3JkLW90aGVyXCIsIFtcInBoaVwiLCBcInNlbGVjdFwiLCBcImZyZWV6ZVwiLCBcImNhbGxcIiwgXCJsYW5kaW5ncGFkXCIsIFwiY2F0Y2hwYWRcIiwgXCJjbGVhbnVwcGFkXCIsIFwidmFfYXJnXCJdKSxcbiAgLi4ubWFwV29yZHMoXCJsb29tLWxsdm0ta2V5d29yZC1tb2RpZmllclwiLCBbXG4gICAgXCJwcml2YXRlXCIsIFwiaW50ZXJuYWxcIiwgXCJhdmFpbGFibGVfZXh0ZXJuYWxseVwiLCBcImxpbmtvbmNlXCIsIFwid2Vha1wiLCBcImNvbW1vblwiLCBcImFwcGVuZGluZ1wiLCBcImV4dGVybl93ZWFrXCIsIFwibGlua29uY2Vfb2RyXCIsIFwid2Vha19vZHJcIixcbiAgICBcImV4dGVybmFsXCIsIFwiZGVmYXVsdFwiLCBcImhpZGRlblwiLCBcInByb3RlY3RlZFwiLCBcImRsbGltcG9ydFwiLCBcImRsbGV4cG9ydFwiLCBcImRzb19sb2NhbFwiLCBcImRzb19wcmVlbXB0YWJsZVwiLCBcImV4dGVybmFsbHlfaW5pdGlhbGl6ZWRcIixcbiAgICBcInRocmVhZF9sb2NhbFwiLCBcImxvY2FsZHluYW1pY1wiLCBcImluaXRpYWxleGVjXCIsIFwibG9jYWxleGVjXCIsIFwidW5uYW1lZF9hZGRyXCIsIFwibG9jYWxfdW5uYW1lZF9hZGRyXCIsIFwiYXRvbWljXCIsIFwidW5vcmRlcmVkXCIsIFwibW9ub3RvbmljXCIsXG4gICAgXCJhY3F1aXJlXCIsIFwicmVsZWFzZVwiLCBcImFjcV9yZWxcIiwgXCJzZXFfY3N0XCIsIFwic3luY3Njb3BlXCIsIFwidm9sYXRpbGVcIiwgXCJzaW5nbGV0aHJlYWRcIiwgXCJjY2NcIiwgXCJmYXN0Y2NcIiwgXCJjb2xkY2NcIiwgXCJ3ZWJraXRfanNjY1wiLFxuICAgIFwiYW55cmVnY2NcIiwgXCJwcmVzZXJ2ZV9tb3N0Y2NcIiwgXCJwcmVzZXJ2ZV9hbGxjY1wiLCBcImN4eF9mYXN0X3Rsc2NjXCIsIFwic3dpZnRjY1wiLCBcInRhaWxjY1wiLCBcImNmZ3VhcmRfY2hlY2tjY1wiLCBcInRhaWxcIiwgXCJtdXN0dGFpbFwiLCBcIm5vdGFpbFwiLFxuICAgIFwiZmFzdFwiLCBcIm5uYW5cIiwgXCJuaW5mXCIsIFwibnN6XCIsIFwiYXJjcFwiLCBcImNvbnRyYWN0XCIsIFwiYWZuXCIsIFwicmVhc3NvY1wiLCBcIm51d1wiLCBcIm5zd1wiLCBcImV4YWN0XCIsIFwiaW5ib3VuZHNcIiwgXCJ0b1wiLCBcInhcIixcbiAgXSksXG4gIC4uLm1hcFdvcmRzKFwibG9vbS1sbHZtLXByZWRpY2F0ZVwiLCBbXG4gICAgXCJlcVwiLCBcIm5lXCIsIFwidWd0XCIsIFwidWdlXCIsIFwidWx0XCIsIFwidWxlXCIsIFwic2d0XCIsIFwic2dlXCIsIFwic2x0XCIsIFwic2xlXCIsIFwib2VxXCIsIFwib2d0XCIsIFwib2dlXCIsIFwib2x0XCIsIFwib2xlXCIsIFwib25lXCIsIFwib3JkXCIsIFwidWVxXCIsIFwidW5lXCIsXG4gICAgXCJ1bm9cIixcbiAgXSksXG4gIC4uLm1hcFdvcmRzKFwibG9vbS1sbHZtLWF0dHJpYnV0ZVwiLCBbXG4gICAgXCJhbHdheXNpbmxpbmVcIiwgXCJhcmdtZW1vbmx5XCIsIFwiYnVpbHRpblwiLCBcImJ5cmVmXCIsIFwiYnl2YWxcIiwgXCJjb2xkXCIsIFwiY29udmVyZ2VudFwiLCBcImRlcmVmZXJlbmNlYWJsZVwiLCBcImRlcmVmZXJlbmNlYWJsZV9vcl9udWxsXCIsIFwiZGlzdGluY3RcIixcbiAgICBcImltbWFyZ1wiLCBcImluYWxsb2NhXCIsIFwiaW5yZWdcIiwgXCJtdXN0cHJvZ3Jlc3NcIiwgXCJuZXN0XCIsIFwibm9hbGlhc1wiLCBcIm5vY2FsbGJhY2tcIiwgXCJub2NhcHR1cmVcIiwgXCJub2ZyZWVcIiwgXCJub2lubGluZVwiLCBcIm5vbmxhenliaW5kXCIsXG4gICAgXCJub25udWxsXCIsIFwibm9yZWN1cnNlXCIsIFwibm9yZWR6b25lXCIsIFwibm9yZXR1cm5cIiwgXCJub3N5bmNcIiwgXCJub3Vud2luZFwiLCBcIm51bGxfcG9pbnRlcl9pc192YWxpZFwiLCBcIm9wYXF1ZVwiLCBcIm9wdG5vbmVcIiwgXCJvcHRzaXplXCIsXG4gICAgXCJwcmVhbGxvY2F0ZWRcIiwgXCJyZWFkbm9uZVwiLCBcInJlYWRvbmx5XCIsIFwicmV0dXJuZWRcIiwgXCJyZXR1cm5zX3R3aWNlXCIsIFwic2FuaXRpemVfYWRkcmVzc1wiLCBcInNhbml0aXplX2h3YWRkcmVzc1wiLCBcInNhbml0aXplX21lbW9yeVwiLFxuICAgIFwic2FuaXRpemVfdGhyZWFkXCIsIFwic2lnbmV4dFwiLCBcInNwZWN1bGF0YWJsZVwiLCBcInNyZXRcIiwgXCJzc3BcIiwgXCJzc3ByZXFcIiwgXCJzc3BzdHJvbmdcIiwgXCJzd2lmdGFzeW5jXCIsIFwic3dpZnRzZWxmXCIsIFwic3dpZnRlcnJvclwiLCBcInV3dGFibGVcIixcbiAgICBcIndpbGxyZXR1cm5cIiwgXCJ3cml0ZW9ubHlcIiwgXCJ6ZXJvZXh0XCIsXG4gIF0pLFxuICAuLi5tYXBXb3JkcyhcImxvb20tbGx2bS1jb25zdGFudFwiLCBbXCJ0cnVlXCIsIFwiZmFsc2VcIiwgXCJudWxsXCIsIFwibm9uZVwiLCBcInVuZGVmXCIsIFwicG9pc29uXCIsIFwiemVyb2luaXRpYWxpemVyXCJdKSxcbl0pO1xuXG5jb25zdCBMTFZNX1BSSU1JVElWRV9UWVBFUyA9IG5ldyBTZXQoW1xuICBcInZvaWRcIiwgXCJsYWJlbFwiLCBcInRva2VuXCIsIFwibWV0YWRhdGFcIiwgXCJ4ODZfbW14XCIsIFwieDg2X2FteFwiLCBcImhhbGZcIiwgXCJiZmxvYXRcIiwgXCJmbG9hdFwiLCBcImRvdWJsZVwiLCBcImZwMTI4XCIsIFwieDg2X2ZwODBcIiwgXCJwcGNfZnAxMjhcIiwgXCJwdHJcIixcbl0pO1xuXG5jb25zdCBQVU5DVFVBVElPTl9DTEFTUyA9IFwibG9vbS1sbHZtLXB1bmN0dWF0aW9uXCI7XG5cbmV4cG9ydCBmdW5jdGlvbiBoaWdobGlnaHRMbHZtRWxlbWVudChjb2RlRWxlbWVudDogSFRNTEVsZW1lbnQsIHNvdXJjZTogc3RyaW5nKTogdm9pZCB7XG4gIGNvZGVFbGVtZW50LmVtcHR5KCk7XG4gIGNvZGVFbGVtZW50LmFkZENsYXNzKFwibG9vbS1sbHZtLWNvZGVcIik7XG5cbiAgY29uc3QgbGluZXMgPSBzb3VyY2Uuc3BsaXQoXCJcXG5cIik7XG4gIGxpbmVzLmZvckVhY2goKGxpbmUsIGluZGV4KSA9PiB7XG4gICAgYXBwZW5kSGlnaGxpZ2h0ZWRMaW5lKGNvZGVFbGVtZW50LCBsaW5lKTtcbiAgICBpZiAoaW5kZXggPCBsaW5lcy5sZW5ndGggLSAxKSB7XG4gICAgICBjb2RlRWxlbWVudC5hcHBlbmRUZXh0KFwiXFxuXCIpO1xuICAgIH1cbiAgfSk7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBhZGRMbHZtRGVjb3JhdGlvbnMoXG4gIGJ1aWxkZXI6IFJhbmdlU2V0QnVpbGRlcjxEZWNvcmF0aW9uPixcbiAgdmlldzogRWRpdG9yVmlldyxcbiAgYmxvY2s6IGxvb21Db2RlQmxvY2ssXG4pOiB2b2lkIHtcbiAgY29uc3QgY29udGVudExpbmVDb3VudCA9IGdldENvbnRlbnRMaW5lQ291bnQoYmxvY2spO1xuICBpZiAoIWNvbnRlbnRMaW5lQ291bnQpIHtcbiAgICByZXR1cm47XG4gIH1cblxuICBjb25zdCBsaW5lcyA9IGJsb2NrLmNvbnRlbnQuc3BsaXQoXCJcXG5cIik7XG4gIGZvciAobGV0IGluZGV4ID0gMDsgaW5kZXggPCBjb250ZW50TGluZUNvdW50OyBpbmRleCArPSAxKSB7XG4gICAgY29uc3QgbGluZSA9IGxpbmVzW2luZGV4XSA/PyBcIlwiO1xuICAgIGNvbnN0IHRva2VucyA9IHRva2VuaXplTGx2bUxpbmUobGluZSk7XG4gICAgaWYgKCF0b2tlbnMubGVuZ3RoKSB7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICBjb25zdCBkb2NMaW5lID0gdmlldy5zdGF0ZS5kb2MubGluZShibG9jay5zdGFydExpbmUgKyAyICsgaW5kZXgpO1xuICAgIGZvciAoY29uc3QgdG9rZW4gb2YgdG9rZW5zKSB7XG4gICAgICBpZiAodG9rZW4uZnJvbSA9PT0gdG9rZW4udG8pIHtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICBidWlsZGVyLmFkZChcbiAgICAgICAgZG9jTGluZS5mcm9tICsgdG9rZW4uZnJvbSxcbiAgICAgICAgZG9jTGluZS5mcm9tICsgdG9rZW4udG8sXG4gICAgICAgIERlY29yYXRpb24ubWFyayh7IGNsYXNzOiB0b2tlbi5jbGFzc05hbWUgfSksXG4gICAgICApO1xuICAgIH1cbiAgfVxufVxuXG5mdW5jdGlvbiBhcHBlbmRIaWdobGlnaHRlZExpbmUoY29udGFpbmVyOiBIVE1MRWxlbWVudCwgbGluZTogc3RyaW5nKTogdm9pZCB7XG4gIGxldCBjdXJzb3IgPSAwO1xuXG4gIGZvciAoY29uc3QgdG9rZW4gb2YgdG9rZW5pemVMbHZtTGluZShsaW5lKSkge1xuICAgIGlmICh0b2tlbi5mcm9tID4gY3Vyc29yKSB7XG4gICAgICBjb250YWluZXIuYXBwZW5kVGV4dChsaW5lLnNsaWNlKGN1cnNvciwgdG9rZW4uZnJvbSkpO1xuICAgIH1cblxuICAgIGNvbnN0IHNwYW4gPSBjb250YWluZXIuY3JlYXRlU3Bhbih7IGNsczogdG9rZW4uY2xhc3NOYW1lIH0pO1xuICAgIHNwYW4uc2V0VGV4dChsaW5lLnNsaWNlKHRva2VuLmZyb20sIHRva2VuLnRvKSk7XG4gICAgY3Vyc29yID0gdG9rZW4udG87XG4gIH1cblxuICBpZiAoY3Vyc29yIDwgbGluZS5sZW5ndGgpIHtcbiAgICBjb250YWluZXIuYXBwZW5kVGV4dChsaW5lLnNsaWNlKGN1cnNvcikpO1xuICB9XG59XG5cbmZ1bmN0aW9uIHRva2VuaXplTGx2bUxpbmUobGluZTogc3RyaW5nKTogTGx2bVRva2VuW10ge1xuICBjb25zdCB0b2tlbnM6IExsdm1Ub2tlbltdID0gW107XG4gIGxldCBpbmRleCA9IDA7XG5cbiAgYWRkTGFiZWxUb2tlbihsaW5lLCB0b2tlbnMpO1xuXG4gIHdoaWxlIChpbmRleCA8IGxpbmUubGVuZ3RoKSB7XG4gICAgY29uc3QgY3VycmVudCA9IGxpbmVbaW5kZXhdO1xuICAgIGlmIChjdXJyZW50ID09PSBcIjtcIikge1xuICAgICAgdG9rZW5zLnB1c2goeyBmcm9tOiBpbmRleCwgdG86IGxpbmUubGVuZ3RoLCBjbGFzc05hbWU6IFwibG9vbS1sbHZtLWNvbW1lbnRcIiB9KTtcbiAgICAgIGJyZWFrO1xuICAgIH1cblxuICAgIGlmICgvXFxzLy50ZXN0KGN1cnJlbnQpKSB7XG4gICAgICBpbmRleCArPSAxO1xuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgY29uc3Qgc3RyaW5nVG9rZW4gPSByZWFkU3RyaW5nVG9rZW4obGluZSwgaW5kZXgpO1xuICAgIGlmIChzdHJpbmdUb2tlbikge1xuICAgICAgaWYgKHN0cmluZ1Rva2VuLnByZWZpeEVuZCA+IGluZGV4KSB7XG4gICAgICAgIHRva2Vucy5wdXNoKHsgZnJvbTogaW5kZXgsIHRvOiBzdHJpbmdUb2tlbi5wcmVmaXhFbmQsIGNsYXNzTmFtZTogXCJsb29tLWxsdm0tc3RyaW5nLXByZWZpeFwiIH0pO1xuICAgICAgfVxuICAgICAgdG9rZW5zLnB1c2goeyBmcm9tOiBzdHJpbmdUb2tlbi52YWx1ZVN0YXJ0LCB0bzogc3RyaW5nVG9rZW4udmFsdWVFbmQsIGNsYXNzTmFtZTogXCJsb29tLWxsdm0tc3RyaW5nXCIgfSk7XG4gICAgICBpbmRleCA9IHN0cmluZ1Rva2VuLnZhbHVlRW5kO1xuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgY29uc3QgbWF0Y2hlZCA9XG4gICAgICBtYXRjaFJlZ2V4VG9rZW4obGluZSwgaW5kZXgsIC9AbGx2bVxcLltBLVphLXokLl8wLTldKy95LCBcImxvb20tbGx2bS1pbnRyaW5zaWNcIiwgdG9rZW5zKSB8fFxuICAgICAgbWF0Y2hSZWdleFRva2VuKGxpbmUsIGluZGV4LCAvQFtBLVphLXokLl8tXVtBLVphLXokLl8wLTktXSp8QFxcZCtcXGIveSwgXCJsb29tLWxsdm0tZ2xvYmFsXCIsIHRva2VucykgfHxcbiAgICAgIG1hdGNoUmVnZXhUb2tlbihsaW5lLCBpbmRleCwgLyVbQS1aYS16JC5fLV1bQS1aYS16JC5fMC05LV0qfCVcXGQrXFxiL3ksIFwibG9vbS1sbHZtLWxvY2FsXCIsIHRva2VucykgfHxcbiAgICAgIG1hdGNoUmVnZXhUb2tlbihsaW5lLCBpbmRleCwgLyFbQS1aYS16JC5fLV1bQS1aYS16JC5fMC05LV0qfCFcXGQrXFxiL3ksIFwibG9vbS1sbHZtLW1ldGFkYXRhXCIsIHRva2VucykgfHxcbiAgICAgIG1hdGNoUmVnZXhUb2tlbihsaW5lLCBpbmRleCwgL1xcJFtBLVphLXokLl8tXVtBLVphLXokLl8wLTktXSoveSwgXCJsb29tLWxsdm0tY29tZGF0XCIsIHRva2VucykgfHxcbiAgICAgIG1hdGNoUmVnZXhUb2tlbihsaW5lLCBpbmRleCwgLyNcXGQrXFxiL3ksIFwibG9vbS1sbHZtLWF0dHJpYnV0ZS1ncm91cFwiLCB0b2tlbnMpIHx8XG4gICAgICBtYXRjaFJlZ2V4VG9rZW4obGluZSwgaW5kZXgsIC9cXGJhZGRyc3BhY2VcXHMqXFwoXFxzKlxcZCtcXHMqXFwpL3ksIFwibG9vbS1sbHZtLXR5cGVcIiwgdG9rZW5zKSB8fFxuICAgICAgbWF0Y2hSZWdleFRva2VuKGxpbmUsIGluZGV4LCAvWy0rXT8weFswLTlBLUZhLWZdK1xcYi95LCBcImxvb20tbGx2bS1udW1iZXJcIiwgdG9rZW5zKSB8fFxuICAgICAgbWF0Y2hSZWdleFRva2VuKGxpbmUsIGluZGV4LCAvWy0rXT8oPzpcXGQrXFwuXFxkKnxcXC5cXGQrfFxcZCspKD86W2VFXVstK10/XFxkKylcXGIveSwgXCJsb29tLWxsdm0tbnVtYmVyXCIsIHRva2VucykgfHxcbiAgICAgIG1hdGNoUmVnZXhUb2tlbihsaW5lLCBpbmRleCwgL1stK10/KD86XFxkK1xcLlxcZCp8XFwuXFxkKylcXGIveSwgXCJsb29tLWxsdm0tbnVtYmVyXCIsIHRva2VucykgfHxcbiAgICAgIG1hdGNoUmVnZXhUb2tlbihsaW5lLCBpbmRleCwgL1stK10/XFxkK1xcYi95LCBcImxvb20tbGx2bS1udW1iZXJcIiwgdG9rZW5zKSB8fFxuICAgICAgbWF0Y2hSZWdleFRva2VuKGxpbmUsIGluZGV4LCAvXFwuXFwuXFwuL3ksIFwibG9vbS1sbHZtLXB1bmN0dWF0aW9uXCIsIHRva2Vucyk7XG5cbiAgICBpZiAobWF0Y2hlZCkge1xuICAgICAgaW5kZXggPSBtYXRjaGVkO1xuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgY29uc3Qgd29yZCA9IHJlYWRXb3JkKGxpbmUsIGluZGV4KTtcbiAgICBpZiAod29yZCkge1xuICAgICAgdG9rZW5zLnB1c2goe1xuICAgICAgICBmcm9tOiBpbmRleCxcbiAgICAgICAgdG86IHdvcmQuZW5kLFxuICAgICAgICBjbGFzc05hbWU6IGNsYXNzaWZ5V29yZCh3b3JkLnZhbHVlKSxcbiAgICAgIH0pO1xuICAgICAgaW5kZXggPSB3b3JkLmVuZDtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cblxuICAgIGlmIChcIigpW117fTw+LDo9KlwiLmluY2x1ZGVzKGN1cnJlbnQpKSB7XG4gICAgICB0b2tlbnMucHVzaCh7IGZyb206IGluZGV4LCB0bzogaW5kZXggKyAxLCBjbGFzc05hbWU6IFBVTkNUVUFUSU9OX0NMQVNTIH0pO1xuICAgICAgaW5kZXggKz0gMTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cblxuICAgIGluZGV4ICs9IDE7XG4gIH1cblxuICByZXR1cm4gbm9ybWFsaXplVG9rZW5zKHRva2Vucyk7XG59XG5cbmZ1bmN0aW9uIGFkZExhYmVsVG9rZW4obGluZTogc3RyaW5nLCB0b2tlbnM6IExsdm1Ub2tlbltdKTogdm9pZCB7XG4gIGNvbnN0IG1hdGNoID0gbGluZS5tYXRjaCgvXihcXHMqKSg/OihbQS1aYS16JC5fLV1bQS1aYS16JC5fMC05LV0qfFxcZCspfCglW0EtWmEteiQuXy1dW0EtWmEteiQuXzAtOS1dKnwlXFxkKykpKDopLyk7XG4gIGlmICghbWF0Y2ggfHwgbWF0Y2guaW5kZXggPT0gbnVsbCkge1xuICAgIHJldHVybjtcbiAgfVxuXG4gIGNvbnN0IGxhYmVsU3RhcnQgPSBtYXRjaFsxXS5sZW5ndGg7XG4gIGNvbnN0IGxhYmVsVGV4dCA9IG1hdGNoWzJdID8/IG1hdGNoWzNdO1xuICBpZiAoIWxhYmVsVGV4dCkge1xuICAgIHJldHVybjtcbiAgfVxuXG4gIHRva2Vucy5wdXNoKHtcbiAgICBmcm9tOiBsYWJlbFN0YXJ0LFxuICAgIHRvOiBsYWJlbFN0YXJ0ICsgbGFiZWxUZXh0Lmxlbmd0aCxcbiAgICBjbGFzc05hbWU6IFwibG9vbS1sbHZtLWxhYmVsXCIsXG4gIH0pO1xuICB0b2tlbnMucHVzaCh7XG4gICAgZnJvbTogbGFiZWxTdGFydCArIGxhYmVsVGV4dC5sZW5ndGgsXG4gICAgdG86IGxhYmVsU3RhcnQgKyBsYWJlbFRleHQubGVuZ3RoICsgMSxcbiAgICBjbGFzc05hbWU6IFBVTkNUVUFUSU9OX0NMQVNTLFxuICB9KTtcbn1cblxuZnVuY3Rpb24gY2xhc3NpZnlXb3JkKHdvcmQ6IHN0cmluZyk6IHN0cmluZyB7XG4gIGlmICgvXmlcXGQrJC8udGVzdCh3b3JkKSB8fCBMTFZNX1BSSU1JVElWRV9UWVBFUy5oYXMod29yZCkpIHtcbiAgICByZXR1cm4gXCJsb29tLWxsdm0tdHlwZVwiO1xuICB9XG5cbiAgcmV0dXJuIExMVk1fS0VZV09SRFMuZ2V0KHdvcmQpID8/IFwibG9vbS1sbHZtLXBsYWluXCI7XG59XG5cbmZ1bmN0aW9uIHJlYWRXb3JkKGxpbmU6IHN0cmluZywgaW5kZXg6IG51bWJlcik6IHsgdmFsdWU6IHN0cmluZzsgZW5kOiBudW1iZXIgfSB8IG51bGwge1xuICBjb25zdCBtYXRjaCA9IC9bQS1aYS16X11bQS1aYS16MC05Xy4tXSoveTtcbiAgbWF0Y2gubGFzdEluZGV4ID0gaW5kZXg7XG4gIGNvbnN0IHJlc3VsdCA9IG1hdGNoLmV4ZWMobGluZSk7XG4gIGlmICghcmVzdWx0KSB7XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cblxuICByZXR1cm4ge1xuICAgIHZhbHVlOiByZXN1bHRbMF0sXG4gICAgZW5kOiBtYXRjaC5sYXN0SW5kZXgsXG4gIH07XG59XG5cbmZ1bmN0aW9uIHJlYWRTdHJpbmdUb2tlbihsaW5lOiBzdHJpbmcsIGluZGV4OiBudW1iZXIpOiB7IHByZWZpeEVuZDogbnVtYmVyOyB2YWx1ZVN0YXJ0OiBudW1iZXI7IHZhbHVlRW5kOiBudW1iZXIgfSB8IG51bGwge1xuICBsZXQgY3Vyc29yID0gaW5kZXg7XG4gIGlmIChsaW5lW2N1cnNvcl0gPT09IFwiY1wiICYmIGxpbmVbY3Vyc29yICsgMV0gPT09IFwiXFxcIlwiKSB7XG4gICAgY3Vyc29yICs9IDE7XG4gIH1cblxuICBpZiAobGluZVtjdXJzb3JdICE9PSBcIlxcXCJcIikge1xuICAgIHJldHVybiBudWxsO1xuICB9XG5cbiAgY29uc3QgdmFsdWVTdGFydCA9IGN1cnNvcjtcbiAgY3Vyc29yICs9IDE7XG4gIHdoaWxlIChjdXJzb3IgPCBsaW5lLmxlbmd0aCkge1xuICAgIGlmIChsaW5lW2N1cnNvcl0gPT09IFwiXFxcXFwiKSB7XG4gICAgICBjdXJzb3IgKz0gMjtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAobGluZVtjdXJzb3JdID09PSBcIlxcXCJcIikge1xuICAgICAgY3Vyc29yICs9IDE7XG4gICAgICBicmVhaztcbiAgICB9XG4gICAgY3Vyc29yICs9IDE7XG4gIH1cblxuICByZXR1cm4ge1xuICAgIHByZWZpeEVuZDogdmFsdWVTdGFydCxcbiAgICB2YWx1ZVN0YXJ0LFxuICAgIHZhbHVlRW5kOiBjdXJzb3IsXG4gIH07XG59XG5cbmZ1bmN0aW9uIG1hdGNoUmVnZXhUb2tlbihcbiAgbGluZTogc3RyaW5nLFxuICBpbmRleDogbnVtYmVyLFxuICByZWdleDogUmVnRXhwLFxuICBjbGFzc05hbWU6IHN0cmluZyxcbiAgdG9rZW5zOiBMbHZtVG9rZW5bXSxcbik6IG51bWJlciB8IG51bGwge1xuICByZWdleC5sYXN0SW5kZXggPSBpbmRleDtcbiAgY29uc3QgbWF0Y2ggPSByZWdleC5leGVjKGxpbmUpO1xuICBpZiAoIW1hdGNoKSB7XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cblxuICB0b2tlbnMucHVzaCh7IGZyb206IGluZGV4LCB0bzogcmVnZXgubGFzdEluZGV4LCBjbGFzc05hbWUgfSk7XG4gIHJldHVybiByZWdleC5sYXN0SW5kZXg7XG59XG5cbmZ1bmN0aW9uIG5vcm1hbGl6ZVRva2Vucyh0b2tlbnM6IExsdm1Ub2tlbltdKTogTGx2bVRva2VuW10ge1xuICB0b2tlbnMuc29ydCgobGVmdCwgcmlnaHQpID0+IGxlZnQuZnJvbSAtIHJpZ2h0LmZyb20gfHwgbGVmdC50byAtIHJpZ2h0LnRvKTtcbiAgY29uc3Qgbm9ybWFsaXplZDogTGx2bVRva2VuW10gPSBbXTtcbiAgbGV0IGN1cnNvciA9IDA7XG5cbiAgZm9yIChjb25zdCB0b2tlbiBvZiB0b2tlbnMpIHtcbiAgICBpZiAodG9rZW4udG8gPD0gY3Vyc29yKSB7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICBjb25zdCBmcm9tID0gTWF0aC5tYXgodG9rZW4uZnJvbSwgY3Vyc29yKTtcbiAgICBub3JtYWxpemVkLnB1c2goeyAuLi50b2tlbiwgZnJvbSB9KTtcbiAgICBjdXJzb3IgPSB0b2tlbi50bztcbiAgfVxuXG4gIHJldHVybiBub3JtYWxpemVkO1xufVxuXG5mdW5jdGlvbiBnZXRDb250ZW50TGluZUNvdW50KGJsb2NrOiBsb29tQ29kZUJsb2NrKTogbnVtYmVyIHtcbiAgaWYgKGJsb2NrLmVuZExpbmUgPT09IGJsb2NrLnN0YXJ0TGluZSkge1xuICAgIHJldHVybiAwO1xuICB9XG5cbiAgaWYgKGJsb2NrLmNvbnRlbnQubGVuZ3RoID09PSAwKSB7XG4gICAgcmV0dXJuIGJsb2NrLmVuZExpbmUgPiBibG9jay5zdGFydExpbmUgKyAxID8gMSA6IDA7XG4gIH1cblxuICByZXR1cm4gYmxvY2suY29udGVudC5zcGxpdChcIlxcblwiKS5sZW5ndGg7XG59XG5cbmZ1bmN0aW9uIG1hcFdvcmRzKGNsYXNzTmFtZTogc3RyaW5nLCB3b3Jkczogc3RyaW5nW10pOiBBcnJheTxbc3RyaW5nLCBzdHJpbmddPiB7XG4gIHJldHVybiB3b3Jkcy5tYXAoKHdvcmQpID0+IFt3b3JkLCBjbGFzc05hbWVdKTtcbn1cbiIsICJpbXBvcnQgeyBjcmVhdGVIYXNoIH0gZnJvbSBcImNyeXB0b1wiO1xuXG5leHBvcnQgZnVuY3Rpb24gc2hvcnRIYXNoKGlucHV0OiBzdHJpbmcpOiBzdHJpbmcge1xuICByZXR1cm4gY3JlYXRlSGFzaChcInNoYTI1NlwiKS51cGRhdGUoaW5wdXQpLmRpZ2VzdChcImhleFwiKS5zbGljZSgwLCAxNik7XG59XG4iLCAiaW1wb3J0IHsgc2hvcnRIYXNoIH0gZnJvbSBcIi4vdXRpbHMvaGFzaFwiO1xuaW1wb3J0IHR5cGUgeyBsb29tQ29kZUJsb2NrLCBsb29tTm9ybWFsaXplZExhbmd1YWdlLCBsb29tUGx1Z2luU2V0dGluZ3MgfSBmcm9tIFwiLi90eXBlc1wiO1xuXG5jb25zdCBMQU5HVUFHRV9BTElBU0VTOiBSZWNvcmQ8c3RyaW5nLCBsb29tTm9ybWFsaXplZExhbmd1YWdlPiA9IHtcbiAgcHl0aG9uOiBcInB5dGhvblwiLFxuICBweTogXCJweXRob25cIixcbiAgamF2YXNjcmlwdDogXCJqYXZhc2NyaXB0XCIsXG4gIGpzOiBcImphdmFzY3JpcHRcIixcbiAgdHlwZXNjcmlwdDogXCJ0eXBlc2NyaXB0XCIsXG4gIHRzOiBcInR5cGVzY3JpcHRcIixcbiAgb2NhbWw6IFwib2NhbWxcIixcbiAgbWw6IFwib2NhbWxcIixcbiAgYzogXCJjXCIsXG4gIGg6IFwiY1wiLFxuICBjcHA6IFwiY3BwXCIsXG4gIGN4eDogXCJjcHBcIixcbiAgY2M6IFwiY3BwXCIsXG4gIFwiYysrXCI6IFwiY3BwXCIsXG4gIHNoZWxsOiBcInNoZWxsXCIsXG4gIHNoOiBcInNoZWxsXCIsXG4gIGJhc2g6IFwic2hlbGxcIixcbiAgenNoOiBcInNoZWxsXCIsXG4gIHJ1Ynk6IFwicnVieVwiLFxuICByYjogXCJydWJ5XCIsXG4gIHBlcmw6IFwicGVybFwiLFxuICBwbDogXCJwZXJsXCIsXG4gIGx1YTogXCJsdWFcIixcbiAgcGhwOiBcInBocFwiLFxuICBnbzogXCJnb1wiLFxuICBnb2xhbmc6IFwiZ29cIixcbiAgcnVzdDogXCJydXN0XCIsXG4gIHJzOiBcInJ1c3RcIixcbiAgaGFza2VsbDogXCJoYXNrZWxsXCIsXG4gIGhzOiBcImhhc2tlbGxcIixcbiAgamF2YTogXCJqYXZhXCIsXG4gIGxsdm06IFwibGx2bS1pclwiLFxuICBsbHZtaXI6IFwibGx2bS1pclwiLFxuICBcImxsdm0taXJcIjogXCJsbHZtLWlyXCIsXG4gIGxsOiBcImxsdm0taXJcIixcbiAgbGVhbjogXCJsZWFuXCIsXG4gIGxlYW40OiBcImxlYW5cIixcbiAgY29xOiBcImNvcVwiLFxuICB2OiBcImNvcVwiLFxuICBzbXQ6IFwic210bGliXCIsXG4gIHNtdDI6IFwic210bGliXCIsXG4gIHNtdGxpYjogXCJzbXRsaWJcIixcbiAgXCJzbXQtbGliXCI6IFwic210bGliXCIsXG4gIHozOiBcInNtdGxpYlwiLFxufTtcblxuY29uc3QgT1VUUFVUX1NUQVJUID0gL148IS0tXFxzKmxvb206b3V0cHV0OnN0YXJ0XFxzK2lkPShbYS1mMC05XSspXFxzKi0tPiQvaTtcbmNvbnN0IE9VVFBVVF9FTkQgPSAvXjwhLS1cXHMqbG9vbTpvdXRwdXQ6ZW5kXFxzKi0tPiQvaTtcbmNvbnN0IEZFTkNFX1NUQVJUID0gL14oYGBgK3x+fn4rKVxccyooW15cXHNgXSopPy4qJC87XG5cbmV4cG9ydCBmdW5jdGlvbiBub3JtYWxpemVMYW5ndWFnZShyYXdMYW5ndWFnZTogc3RyaW5nLCBzZXR0aW5ncz86IGxvb21QbHVnaW5TZXR0aW5ncyk6IGxvb21Ob3JtYWxpemVkTGFuZ3VhZ2UgfCBudWxsIHtcbiAgY29uc3Qgbm9ybWFsaXplZCA9IHJhd0xhbmd1YWdlLnRyaW0oKS50b0xvd2VyQ2FzZSgpO1xuXG4gIGZvciAoY29uc3QgbGFuZ3VhZ2Ugb2Ygc2V0dGluZ3M/LmN1c3RvbUxhbmd1YWdlcyA/PyBbXSkge1xuICAgIGNvbnN0IG5hbWUgPSBsYW5ndWFnZS5uYW1lLnRyaW0oKS50b0xvd2VyQ2FzZSgpO1xuICAgIGNvbnN0IGFsaWFzZXMgPSBwYXJzZUFsaWFzTGlzdChsYW5ndWFnZS5hbGlhc2VzKTtcbiAgICBpZiAobmFtZSAmJiAobmFtZSA9PT0gbm9ybWFsaXplZCB8fCBhbGlhc2VzLmluY2x1ZGVzKG5vcm1hbGl6ZWQpKSkge1xuICAgICAgcmV0dXJuIGxhbmd1YWdlLm5hbWUudHJpbSgpO1xuICAgIH1cbiAgfVxuXG4gIHJldHVybiBMQU5HVUFHRV9BTElBU0VTW25vcm1hbGl6ZWRdID8/IG51bGw7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBnZXRTdXBwb3J0ZWRMYW5ndWFnZUFsaWFzZXMoc2V0dGluZ3M/OiBsb29tUGx1Z2luU2V0dGluZ3MpOiBzdHJpbmdbXSB7XG4gIHJldHVybiBbXG4gICAgLi4uT2JqZWN0LmtleXMoTEFOR1VBR0VfQUxJQVNFUyksXG4gICAgLi4uKHNldHRpbmdzPy5jdXN0b21MYW5ndWFnZXMgPz8gW10pLmZsYXRNYXAoKGxhbmd1YWdlKSA9PiBbbGFuZ3VhZ2UubmFtZSwgLi4ucGFyc2VBbGlhc0xpc3QobGFuZ3VhZ2UuYWxpYXNlcyldKSxcbiAgXS5tYXAoKGFsaWFzKSA9PiBhbGlhcy50b0xvd2VyQ2FzZSgpKTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHBhcnNlTWFya2Rvd25Db2RlQmxvY2tzKGZpbGVQYXRoOiBzdHJpbmcsIHNvdXJjZTogc3RyaW5nLCBzZXR0aW5ncz86IGxvb21QbHVnaW5TZXR0aW5ncyk6IGxvb21Db2RlQmxvY2tbXSB7XG4gIGNvbnN0IGxpbmVzID0gc291cmNlLnNwbGl0KC9cXHI/XFxuLyk7XG4gIGNvbnN0IGJsb2NrczogbG9vbUNvZGVCbG9ja1tdID0gW107XG4gIGxldCBvcmRpbmFsID0gMDtcbiAgbGV0IGluc2lkZU1hbmFnZWRPdXRwdXQgPSBmYWxzZTtcblxuICBmb3IgKGxldCBpID0gMDsgaSA8IGxpbmVzLmxlbmd0aDsgaSArPSAxKSB7XG4gICAgY29uc3QgbGluZSA9IGxpbmVzW2ldO1xuXG4gICAgaWYgKGluc2lkZU1hbmFnZWRPdXRwdXQpIHtcbiAgICAgIGlmIChPVVRQVVRfRU5ELnRlc3QobGluZS50cmltKCkpKSB7XG4gICAgICAgIGluc2lkZU1hbmFnZWRPdXRwdXQgPSBmYWxzZTtcbiAgICAgIH1cbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cblxuICAgIGlmIChPVVRQVVRfU1RBUlQudGVzdChsaW5lLnRyaW0oKSkpIHtcbiAgICAgIGluc2lkZU1hbmFnZWRPdXRwdXQgPSB0cnVlO1xuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgY29uc3QgZmVuY2VNYXRjaCA9IGxpbmUubWF0Y2goRkVOQ0VfU1RBUlQpO1xuICAgIGlmICghZmVuY2VNYXRjaCkge1xuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgY29uc3Qgc3RhcnRMaW5lID0gaTtcbiAgICBjb25zdCBmZW5jZUluZGVudCA9IGdldExlYWRpbmdXaGl0ZXNwYWNlKGxpbmUpO1xuICAgIGNvbnN0IGZlbmNlVG9rZW4gPSBmZW5jZU1hdGNoWzFdO1xuICAgIGNvbnN0IHNvdXJjZUxhbmd1YWdlID0gKGZlbmNlTWF0Y2hbMl0gPz8gXCJcIikudHJpbSgpO1xuICAgIGNvbnN0IGxhbmd1YWdlID0gbm9ybWFsaXplTGFuZ3VhZ2Uoc291cmNlTGFuZ3VhZ2UsIHNldHRpbmdzKTtcblxuICAgIGxldCBlbmRMaW5lID0gaTtcbiAgICBjb25zdCBjb250ZW50TGluZXM6IHN0cmluZ1tdID0gW107XG5cbiAgICBmb3IgKGxldCBqID0gaSArIDE7IGogPCBsaW5lcy5sZW5ndGg7IGogKz0gMSkge1xuICAgICAgY29uc3QgaW5uZXJMaW5lID0gbGluZXNbal07XG4gICAgICBjb25zdCB0cmltbWVkID0gaW5uZXJMaW5lLnRyaW0oKTtcblxuICAgICAgaWYgKHRyaW1tZWQuc3RhcnRzV2l0aChmZW5jZVRva2VuKSAmJiAvXihgYGArfH5+fispXFxzKiQvLnRlc3QodHJpbW1lZCkpIHtcbiAgICAgICAgZW5kTGluZSA9IGo7XG4gICAgICAgIGkgPSBqO1xuICAgICAgICBicmVhaztcbiAgICAgIH1cblxuICAgICAgY29udGVudExpbmVzLnB1c2goc3RyaXBGZW5jZUluZGVudChpbm5lckxpbmUsIGZlbmNlSW5kZW50KSk7XG4gICAgICBlbmRMaW5lID0gajtcbiAgICB9XG5cbiAgICBpZiAoIWxhbmd1YWdlKSB7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICBvcmRpbmFsICs9IDE7XG4gICAgY29uc3QgY29udGVudCA9IGNvbnRlbnRMaW5lcy5qb2luKFwiXFxuXCIpO1xuICAgIGNvbnN0IGNvbnRlbnRIYXNoID0gc2hvcnRIYXNoKGNvbnRlbnQpO1xuICAgIGNvbnN0IGlkID0gc2hvcnRIYXNoKGAke2ZpbGVQYXRofToke29yZGluYWx9OiR7bGFuZ3VhZ2V9OiR7Y29udGVudEhhc2h9YCk7XG5cbiAgICBibG9ja3MucHVzaCh7XG4gICAgICBpZCxcbiAgICAgIG9yZGluYWwsXG4gICAgICBmaWxlUGF0aCxcbiAgICAgIGxhbmd1YWdlLFxuICAgICAgbGFuZ3VhZ2VBbGlhczogc291cmNlTGFuZ3VhZ2UudG9Mb3dlckNhc2UoKSxcbiAgICAgIHNvdXJjZUxhbmd1YWdlLFxuICAgICAgY29udGVudCxcbiAgICAgIHN0YXJ0TGluZSxcbiAgICAgIGVuZExpbmUsXG4gICAgICBmZW5jZVN0YXJ0OiAwLFxuICAgICAgZmVuY2VFbmQ6IDAsXG4gICAgfSk7XG4gIH1cblxuICByZXR1cm4gYmxvY2tzO1xufVxuXG5mdW5jdGlvbiBwYXJzZUFsaWFzTGlzdCh2YWx1ZTogc3RyaW5nKTogc3RyaW5nW10ge1xuICByZXR1cm4gdmFsdWVcbiAgICAuc3BsaXQoXCIsXCIpXG4gICAgLm1hcCgoYWxpYXMpID0+IGFsaWFzLnRyaW0oKS50b0xvd2VyQ2FzZSgpKVxuICAgIC5maWx0ZXIoQm9vbGVhbik7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBmaW5kQmxvY2tBdExpbmUoYmxvY2tzOiBsb29tQ29kZUJsb2NrW10sIGxpbmU6IG51bWJlcik6IGxvb21Db2RlQmxvY2sgfCBudWxsIHtcbiAgcmV0dXJuIGJsb2Nrcy5maW5kKChibG9jaykgPT4gbGluZSA+PSBibG9jay5zdGFydExpbmUgJiYgbGluZSA8PSBibG9jay5lbmRMaW5lKSA/PyBudWxsO1xufVxuXG5mdW5jdGlvbiBnZXRMZWFkaW5nV2hpdGVzcGFjZShsaW5lOiBzdHJpbmcpOiBzdHJpbmcge1xuICBjb25zdCBtYXRjaCA9IGxpbmUubWF0Y2goL15bXFx0IF0qLyk7XG4gIHJldHVybiBtYXRjaD8uWzBdID8/IFwiXCI7XG59XG5cbmZ1bmN0aW9uIHN0cmlwRmVuY2VJbmRlbnQobGluZTogc3RyaW5nLCBmZW5jZUluZGVudDogc3RyaW5nKTogc3RyaW5nIHtcbiAgaWYgKCFmZW5jZUluZGVudCkge1xuICAgIHJldHVybiBsaW5lO1xuICB9XG5cbiAgbGV0IGluZGV4ID0gMDtcbiAgd2hpbGUgKGluZGV4IDwgZmVuY2VJbmRlbnQubGVuZ3RoICYmIGluZGV4IDwgbGluZS5sZW5ndGggJiYgbGluZVtpbmRleF0gPT09IGZlbmNlSW5kZW50W2luZGV4XSkge1xuICAgIGluZGV4ICs9IDE7XG4gIH1cblxuICByZXR1cm4gbGluZS5zbGljZShpbmRleCk7XG59XG4iLCAiaW1wb3J0IHsgcnVuVGVtcEZpbGVQcm9jZXNzIH0gZnJvbSBcIi4uL2V4ZWN1dGlvbi9wcm9jZXNzUnVubmVyXCI7XG5pbXBvcnQgdHlwZSB7IGxvb21Db2RlQmxvY2ssIGxvb21QbHVnaW5TZXR0aW5ncywgbG9vbVJ1bkNvbnRleHQsIGxvb21SdW5SZXN1bHQsIGxvb21SdW5uZXIgfSBmcm9tIFwiLi4vdHlwZXNcIjtcblxuZXhwb3J0IGNsYXNzIE5vZGVSdW5uZXIgaW1wbGVtZW50cyBsb29tUnVubmVyIHtcbiAgaWQgPSBcIm5vZGVcIjtcbiAgZGlzcGxheU5hbWUgPSBcIk5vZGUuanNcIjtcbiAgbGFuZ3VhZ2VzID0gW1wiamF2YXNjcmlwdFwiLCBcInR5cGVzY3JpcHRcIl0gYXMgY29uc3Q7XG5cbiAgY2FuUnVuKGJsb2NrOiBsb29tQ29kZUJsb2NrLCBzZXR0aW5nczogbG9vbVBsdWdpblNldHRpbmdzKTogYm9vbGVhbiB7XG4gICAgaWYgKGJsb2NrLmxhbmd1YWdlID09PSBcImphdmFzY3JpcHRcIikge1xuICAgICAgcmV0dXJuIEJvb2xlYW4oc2V0dGluZ3Mubm9kZUV4ZWN1dGFibGUudHJpbSgpKTtcbiAgICB9XG5cbiAgICByZXR1cm4gQm9vbGVhbihzZXR0aW5ncy50eXBlc2NyaXB0VHJhbnNwaWxlckV4ZWN1dGFibGUudHJpbSgpKTtcbiAgfVxuXG4gIGFzeW5jIHJ1bihibG9jazogbG9vbUNvZGVCbG9jaywgY29udGV4dDogbG9vbVJ1bkNvbnRleHQsIHNldHRpbmdzOiBsb29tUGx1Z2luU2V0dGluZ3MpOiBQcm9taXNlPGxvb21SdW5SZXN1bHQ+IHtcbiAgICBpZiAoYmxvY2subGFuZ3VhZ2UgPT09IFwiamF2YXNjcmlwdFwiKSB7XG4gICAgICByZXR1cm4gcnVuVGVtcEZpbGVQcm9jZXNzKHtcbiAgICAgICAgcnVubmVySWQ6IHRoaXMuaWQsXG4gICAgICAgIHJ1bm5lck5hbWU6IHRoaXMuZGlzcGxheU5hbWUsXG4gICAgICAgIGV4ZWN1dGFibGU6IHNldHRpbmdzLm5vZGVFeGVjdXRhYmxlLnRyaW0oKSxcbiAgICAgICAgYXJnczogW1wie2ZpbGV9XCJdLFxuICAgICAgICBmaWxlRXh0ZW5zaW9uOiBcIi5qc1wiLFxuICAgICAgICBzb3VyY2U6IGJsb2NrLmNvbnRlbnQsXG4gICAgICAgIHdvcmtpbmdEaXJlY3Rvcnk6IGNvbnRleHQud29ya2luZ0RpcmVjdG9yeSxcbiAgICAgICAgdGltZW91dE1zOiBjb250ZXh0LnRpbWVvdXRNcyxcbiAgICAgICAgc2lnbmFsOiBjb250ZXh0LnNpZ25hbCxcbiAgICAgIH0pO1xuICAgIH1cblxuICAgIGNvbnN0IGV4ZWN1dGFibGUgPSBzZXR0aW5ncy50eXBlc2NyaXB0VHJhbnNwaWxlckV4ZWN1dGFibGUudHJpbSgpO1xuICAgIGNvbnN0IHJ1bm5lck5hbWUgPSBzZXR0aW5ncy50eXBlc2NyaXB0TW9kZSA9PT0gXCJ0c3hcIiA/IFwiVHlwZVNjcmlwdCAodHN4KVwiIDogXCJUeXBlU2NyaXB0ICh0cy1ub2RlKVwiO1xuXG4gICAgcmV0dXJuIHJ1blRlbXBGaWxlUHJvY2Vzcyh7XG4gICAgICBydW5uZXJJZDogYCR7dGhpcy5pZH06JHtzZXR0aW5ncy50eXBlc2NyaXB0TW9kZX1gLFxuICAgICAgcnVubmVyTmFtZSxcbiAgICAgIGV4ZWN1dGFibGUsXG4gICAgICBhcmdzOiBbXCJ7ZmlsZX1cIl0sXG4gICAgICBmaWxlRXh0ZW5zaW9uOiBcIi50c1wiLFxuICAgICAgc291cmNlOiBibG9jay5jb250ZW50LFxuICAgICAgd29ya2luZ0RpcmVjdG9yeTogY29udGV4dC53b3JraW5nRGlyZWN0b3J5LFxuICAgICAgdGltZW91dE1zOiBjb250ZXh0LnRpbWVvdXRNcyxcbiAgICAgIHNpZ25hbDogY29udGV4dC5zaWduYWwsXG4gICAgfSk7XG4gIH1cbn1cbiIsICJpbXBvcnQgeyBydW5UZW1wRmlsZVByb2Nlc3MgfSBmcm9tIFwiLi4vZXhlY3V0aW9uL3Byb2Nlc3NSdW5uZXJcIjtcbmltcG9ydCB7IHNwbGl0Q29tbWFuZExpbmUgfSBmcm9tIFwiLi4vdXRpbHMvY29tbWFuZFwiO1xuaW1wb3J0IHR5cGUgeyBsb29tQ29kZUJsb2NrLCBsb29tQ3VzdG9tTGFuZ3VhZ2UsIGxvb21QbHVnaW5TZXR0aW5ncywgbG9vbVJ1bkNvbnRleHQsIGxvb21SdW5SZXN1bHQsIGxvb21SdW5uZXIgfSBmcm9tIFwiLi4vdHlwZXNcIjtcblxuZXhwb3J0IGNsYXNzIEN1c3RvbUxhbmd1YWdlUnVubmVyIGltcGxlbWVudHMgbG9vbVJ1bm5lciB7XG4gIGlkID0gXCJjdXN0b21cIjtcbiAgZGlzcGxheU5hbWUgPSBcIkN1c3RvbSBsYW5ndWFnZVwiO1xuICBsYW5ndWFnZXMgPSBbXSBhcyBjb25zdDtcblxuICBjYW5SdW4oYmxvY2s6IGxvb21Db2RlQmxvY2ssIHNldHRpbmdzOiBsb29tUGx1Z2luU2V0dGluZ3MpOiBib29sZWFuIHtcbiAgICByZXR1cm4gQm9vbGVhbih0aGlzLmdldEN1c3RvbUxhbmd1YWdlKGJsb2NrLCBzZXR0aW5ncyk/LmV4ZWN1dGFibGUudHJpbSgpKTtcbiAgfVxuXG4gIHJ1bihibG9jazogbG9vbUNvZGVCbG9jaywgY29udGV4dDogbG9vbVJ1bkNvbnRleHQsIHNldHRpbmdzOiBsb29tUGx1Z2luU2V0dGluZ3MpOiBQcm9taXNlPGxvb21SdW5SZXN1bHQ+IHtcbiAgICBjb25zdCBsYW5ndWFnZSA9IHRoaXMuZ2V0Q3VzdG9tTGFuZ3VhZ2UoYmxvY2ssIHNldHRpbmdzKTtcbiAgICBpZiAoIWxhbmd1YWdlKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYFVuc3VwcG9ydGVkIGN1c3RvbSBsYW5ndWFnZTogJHtibG9jay5sYW5ndWFnZX1gKTtcbiAgICB9XG5cbiAgICByZXR1cm4gcnVuVGVtcEZpbGVQcm9jZXNzKHtcbiAgICAgIHJ1bm5lcklkOiBgJHt0aGlzLmlkfToke2xhbmd1YWdlLm5hbWV9YCxcbiAgICAgIHJ1bm5lck5hbWU6IGxhbmd1YWdlLm5hbWUsXG4gICAgICBleGVjdXRhYmxlOiBsYW5ndWFnZS5leGVjdXRhYmxlLnRyaW0oKSxcbiAgICAgIGFyZ3M6IHNwbGl0Q29tbWFuZExpbmUobGFuZ3VhZ2UuYXJncyB8fCBcIntmaWxlfVwiKSxcbiAgICAgIGZpbGVFeHRlbnNpb246IG5vcm1hbGl6ZUV4dGVuc2lvbihsYW5ndWFnZS5leHRlbnNpb24sIGxhbmd1YWdlLm5hbWUpLFxuICAgICAgc291cmNlOiBibG9jay5jb250ZW50LFxuICAgICAgd29ya2luZ0RpcmVjdG9yeTogY29udGV4dC53b3JraW5nRGlyZWN0b3J5LFxuICAgICAgdGltZW91dE1zOiBjb250ZXh0LnRpbWVvdXRNcyxcbiAgICAgIHNpZ25hbDogY29udGV4dC5zaWduYWwsXG4gICAgfSk7XG4gIH1cblxuICBwcml2YXRlIGdldEN1c3RvbUxhbmd1YWdlKGJsb2NrOiBsb29tQ29kZUJsb2NrLCBzZXR0aW5nczogbG9vbVBsdWdpblNldHRpbmdzKTogbG9vbUN1c3RvbUxhbmd1YWdlIHwgdW5kZWZpbmVkIHtcbiAgICBjb25zdCBub3JtYWxpemVkID0gYmxvY2subGFuZ3VhZ2UudHJpbSgpLnRvTG93ZXJDYXNlKCk7XG4gICAgcmV0dXJuIHNldHRpbmdzLmN1c3RvbUxhbmd1YWdlcy5maW5kKChsYW5ndWFnZSkgPT4ge1xuICAgICAgY29uc3QgbmFtZSA9IGxhbmd1YWdlLm5hbWUudHJpbSgpLnRvTG93ZXJDYXNlKCk7XG4gICAgICBjb25zdCBhbGlhc2VzID0gbGFuZ3VhZ2UuYWxpYXNlc1xuICAgICAgICAuc3BsaXQoXCIsXCIpXG4gICAgICAgIC5tYXAoKGFsaWFzKSA9PiBhbGlhcy50cmltKCkudG9Mb3dlckNhc2UoKSlcbiAgICAgICAgLmZpbHRlcihCb29sZWFuKTtcbiAgICAgIHJldHVybiBuYW1lID09PSBub3JtYWxpemVkIHx8IGFsaWFzZXMuaW5jbHVkZXMobm9ybWFsaXplZCk7XG4gICAgfSk7XG4gIH1cbn1cblxuZnVuY3Rpb24gbm9ybWFsaXplRXh0ZW5zaW9uKGV4dGVuc2lvbjogc3RyaW5nLCBuYW1lOiBzdHJpbmcpOiBzdHJpbmcge1xuICBjb25zdCB0cmltbWVkID0gZXh0ZW5zaW9uLnRyaW0oKTtcbiAgaWYgKCF0cmltbWVkKSB7XG4gICAgcmV0dXJuIGAuJHtuYW1lfWA7XG4gIH1cbiAgcmV0dXJuIHRyaW1tZWQuc3RhcnRzV2l0aChcIi5cIikgPyB0cmltbWVkIDogYC4ke3RyaW1tZWR9YDtcbn1cbiIsICJpbXBvcnQgeyBydW5UZW1wRmlsZVByb2Nlc3MgfSBmcm9tIFwiLi4vZXhlY3V0aW9uL3Byb2Nlc3NSdW5uZXJcIjtcbmltcG9ydCB0eXBlIHsgbG9vbUNvZGVCbG9jaywgbG9vbU5vcm1hbGl6ZWRMYW5ndWFnZSwgbG9vbVBsdWdpblNldHRpbmdzLCBsb29tUnVuQ29udGV4dCwgbG9vbVJ1blJlc3VsdCwgbG9vbVJ1bm5lciB9IGZyb20gXCIuLi90eXBlc1wiO1xuXG5pbnRlcmZhY2UgSW50ZXJwcmV0ZWRTcGVjIHtcbiAgbGFuZ3VhZ2U6IGxvb21Ob3JtYWxpemVkTGFuZ3VhZ2U7XG4gIGRpc3BsYXlOYW1lOiBzdHJpbmc7XG4gIGV4ZWN1dGFibGU6IChzZXR0aW5nczogbG9vbVBsdWdpblNldHRpbmdzKSA9PiBzdHJpbmc7XG4gIGZpbGVFeHRlbnNpb246IHN0cmluZztcbiAgYXJncz86IHN0cmluZ1tdO1xuICBlbnY/OiBOb2RlSlMuUHJvY2Vzc0VudjtcbiAgbWluaW11bVRpbWVvdXRNcz86IG51bWJlcjtcbn1cblxuY29uc3QgSU5URVJQUkVURURfU1BFQ1M6IEludGVycHJldGVkU3BlY1tdID0gW1xuICB7XG4gICAgbGFuZ3VhZ2U6IFwic2hlbGxcIixcbiAgICBkaXNwbGF5TmFtZTogXCJTaGVsbFwiLFxuICAgIGV4ZWN1dGFibGU6IChzZXR0aW5ncykgPT4gc2V0dGluZ3Muc2hlbGxFeGVjdXRhYmxlLFxuICAgIGZpbGVFeHRlbnNpb246IFwiLnNoXCIsXG4gIH0sXG4gIHtcbiAgICBsYW5ndWFnZTogXCJydWJ5XCIsXG4gICAgZGlzcGxheU5hbWU6IFwiUnVieVwiLFxuICAgIGV4ZWN1dGFibGU6IChzZXR0aW5ncykgPT4gc2V0dGluZ3MucnVieUV4ZWN1dGFibGUsXG4gICAgZmlsZUV4dGVuc2lvbjogXCIucmJcIixcbiAgfSxcbiAge1xuICAgIGxhbmd1YWdlOiBcInBlcmxcIixcbiAgICBkaXNwbGF5TmFtZTogXCJQZXJsXCIsXG4gICAgZXhlY3V0YWJsZTogKHNldHRpbmdzKSA9PiBzZXR0aW5ncy5wZXJsRXhlY3V0YWJsZSxcbiAgICBmaWxlRXh0ZW5zaW9uOiBcIi5wbFwiLFxuICB9LFxuICB7XG4gICAgbGFuZ3VhZ2U6IFwibHVhXCIsXG4gICAgZGlzcGxheU5hbWU6IFwiTHVhXCIsXG4gICAgZXhlY3V0YWJsZTogKHNldHRpbmdzKSA9PiBzZXR0aW5ncy5sdWFFeGVjdXRhYmxlLFxuICAgIGZpbGVFeHRlbnNpb246IFwiLmx1YVwiLFxuICB9LFxuICB7XG4gICAgbGFuZ3VhZ2U6IFwicGhwXCIsXG4gICAgZGlzcGxheU5hbWU6IFwiUEhQXCIsXG4gICAgZXhlY3V0YWJsZTogKHNldHRpbmdzKSA9PiBzZXR0aW5ncy5waHBFeGVjdXRhYmxlLFxuICAgIGZpbGVFeHRlbnNpb246IFwiLnBocFwiLFxuICB9LFxuICB7XG4gICAgbGFuZ3VhZ2U6IFwiZ29cIixcbiAgICBkaXNwbGF5TmFtZTogXCJHb1wiLFxuICAgIGV4ZWN1dGFibGU6IChzZXR0aW5ncykgPT4gc2V0dGluZ3MuZ29FeGVjdXRhYmxlLFxuICAgIGZpbGVFeHRlbnNpb246IFwiLmdvXCIsXG4gICAgYXJnczogW1wicnVuXCIsIFwie2ZpbGV9XCJdLFxuICAgIGVudjoge1xuICAgICAgR09DQUNIRTogXCJ7dGVtcERpcn0vZ29jYWNoZVwiLFxuICAgIH0sXG4gICAgbWluaW11bVRpbWVvdXRNczogMzBfMDAwLFxuICB9LFxuICB7XG4gICAgbGFuZ3VhZ2U6IFwiaGFza2VsbFwiLFxuICAgIGRpc3BsYXlOYW1lOiBcIkhhc2tlbGxcIixcbiAgICBleGVjdXRhYmxlOiAoc2V0dGluZ3MpID0+IHNldHRpbmdzLmhhc2tlbGxFeGVjdXRhYmxlLFxuICAgIGZpbGVFeHRlbnNpb246IFwiLmhzXCIsXG4gICAgbWluaW11bVRpbWVvdXRNczogMzBfMDAwLFxuICB9LFxuXTtcblxuZXhwb3J0IGNsYXNzIEludGVycHJldGVkUnVubmVyIGltcGxlbWVudHMgbG9vbVJ1bm5lciB7XG4gIGlkID0gXCJpbnRlcnByZXRlZFwiO1xuICBkaXNwbGF5TmFtZSA9IFwiSW50ZXJwcmV0ZWRcIjtcbiAgbGFuZ3VhZ2VzID0gSU5URVJQUkVURURfU1BFQ1MubWFwKChzcGVjKSA9PiBzcGVjLmxhbmd1YWdlKTtcblxuICBjYW5SdW4oYmxvY2s6IGxvb21Db2RlQmxvY2ssIHNldHRpbmdzOiBsb29tUGx1Z2luU2V0dGluZ3MpOiBib29sZWFuIHtcbiAgICBjb25zdCBzcGVjID0gdGhpcy5nZXRTcGVjKGJsb2NrLmxhbmd1YWdlKTtcbiAgICByZXR1cm4gQm9vbGVhbihzcGVjPy5leGVjdXRhYmxlKHNldHRpbmdzKS50cmltKCkpO1xuICB9XG5cbiAgcnVuKGJsb2NrOiBsb29tQ29kZUJsb2NrLCBjb250ZXh0OiBsb29tUnVuQ29udGV4dCwgc2V0dGluZ3M6IGxvb21QbHVnaW5TZXR0aW5ncyk6IFByb21pc2U8bG9vbVJ1blJlc3VsdD4ge1xuICAgIGNvbnN0IHNwZWMgPSB0aGlzLmdldFNwZWMoYmxvY2subGFuZ3VhZ2UpO1xuICAgIGlmICghc3BlYykge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBVbnN1cHBvcnRlZCBsYW5ndWFnZTogJHtibG9jay5sYW5ndWFnZX1gKTtcbiAgICB9XG5cbiAgICByZXR1cm4gcnVuVGVtcEZpbGVQcm9jZXNzKHtcbiAgICAgIHJ1bm5lcklkOiBgJHt0aGlzLmlkfToke2Jsb2NrLmxhbmd1YWdlfWAsXG4gICAgICBydW5uZXJOYW1lOiBzcGVjLmRpc3BsYXlOYW1lLFxuICAgICAgZXhlY3V0YWJsZTogc3BlYy5leGVjdXRhYmxlKHNldHRpbmdzKS50cmltKCksXG4gICAgICBhcmdzOiBzcGVjLmFyZ3MgPz8gW1wie2ZpbGV9XCJdLFxuICAgICAgZmlsZUV4dGVuc2lvbjogc3BlYy5maWxlRXh0ZW5zaW9uLFxuICAgICAgc291cmNlOiBibG9jay5jb250ZW50LFxuICAgICAgd29ya2luZ0RpcmVjdG9yeTogY29udGV4dC53b3JraW5nRGlyZWN0b3J5LFxuICAgICAgdGltZW91dE1zOiBNYXRoLm1heChjb250ZXh0LnRpbWVvdXRNcywgc3BlYy5taW5pbXVtVGltZW91dE1zID8/IDApLFxuICAgICAgc2lnbmFsOiBjb250ZXh0LnNpZ25hbCxcbiAgICAgIGVudjogc3BlYy5lbnYsXG4gICAgfSk7XG4gIH1cblxuICBwcml2YXRlIGdldFNwZWMobGFuZ3VhZ2U6IGxvb21Ob3JtYWxpemVkTGFuZ3VhZ2UpOiBJbnRlcnByZXRlZFNwZWMgfCB1bmRlZmluZWQge1xuICAgIHJldHVybiBJTlRFUlBSRVRFRF9TUEVDUy5maW5kKChzcGVjKSA9PiBzcGVjLmxhbmd1YWdlID09PSBsYW5ndWFnZSk7XG4gIH1cbn1cbiIsICJpbXBvcnQgeyBydW5UZW1wRmlsZVByb2Nlc3MgfSBmcm9tIFwiLi4vZXhlY3V0aW9uL3Byb2Nlc3NSdW5uZXJcIjtcbmltcG9ydCB0eXBlIHsgbG9vbUNvZGVCbG9jaywgbG9vbVBsdWdpblNldHRpbmdzLCBsb29tUnVuQ29udGV4dCwgbG9vbVJ1blJlc3VsdCwgbG9vbVJ1bm5lciB9IGZyb20gXCIuLi90eXBlc1wiO1xuXG5leHBvcnQgY2xhc3MgTGx2bVJ1bm5lciBpbXBsZW1lbnRzIGxvb21SdW5uZXIge1xuICBpZCA9IFwibGx2bS1pclwiO1xuICBkaXNwbGF5TmFtZSA9IFwiTExWTSBJUlwiO1xuICBsYW5ndWFnZXMgPSBbXCJsbHZtLWlyXCJdIGFzIGNvbnN0O1xuXG4gIGNhblJ1bihibG9jazogbG9vbUNvZGVCbG9jaywgc2V0dGluZ3M6IGxvb21QbHVnaW5TZXR0aW5ncyk6IGJvb2xlYW4ge1xuICAgIHJldHVybiBibG9jay5sYW5ndWFnZSA9PT0gXCJsbHZtLWlyXCIgJiYgQm9vbGVhbihzZXR0aW5ncy5sbHZtSW50ZXJwcmV0ZXJFeGVjdXRhYmxlLnRyaW0oKSk7XG4gIH1cblxuICBhc3luYyBydW4oYmxvY2s6IGxvb21Db2RlQmxvY2ssIGNvbnRleHQ6IGxvb21SdW5Db250ZXh0LCBzZXR0aW5nczogbG9vbVBsdWdpblNldHRpbmdzKTogUHJvbWlzZTxsb29tUnVuUmVzdWx0PiB7XG4gICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgcnVuVGVtcEZpbGVQcm9jZXNzKHtcbiAgICAgIHJ1bm5lcklkOiB0aGlzLmlkLFxuICAgICAgcnVubmVyTmFtZTogdGhpcy5kaXNwbGF5TmFtZSxcbiAgICAgIGV4ZWN1dGFibGU6IHNldHRpbmdzLmxsdm1JbnRlcnByZXRlckV4ZWN1dGFibGUudHJpbSgpLFxuICAgICAgYXJnczogW1wie2ZpbGV9XCJdLFxuICAgICAgZmlsZUV4dGVuc2lvbjogXCIubGxcIixcbiAgICAgIHNvdXJjZTogYmxvY2suY29udGVudCxcbiAgICAgIHdvcmtpbmdEaXJlY3Rvcnk6IGNvbnRleHQud29ya2luZ0RpcmVjdG9yeSxcbiAgICAgIHRpbWVvdXRNczogTWF0aC5tYXgoY29udGV4dC50aW1lb3V0TXMsIDMwXzAwMCksXG4gICAgICBzaWduYWw6IGNvbnRleHQuc2lnbmFsLFxuICAgIH0pO1xuXG4gICAgaWYgKCFyZXN1bHQudGltZWRPdXQgJiYgIXJlc3VsdC5jYW5jZWxsZWQgJiYgcmVzdWx0LmV4aXRDb2RlICE9IG51bGwgJiYgIXJlc3VsdC5zdGRlcnIudHJpbSgpKSB7XG4gICAgICBpZiAocmVzdWx0LmV4aXRDb2RlICE9PSAwKSB7XG4gICAgICAgIHJlc3VsdC5zdWNjZXNzID0gdHJ1ZTtcbiAgICAgICAgcmVzdWx0Lndhcm5pbmcgPSBgUHJvZ3JhbSByZXR1cm5lZCBpMzIgJHtyZXN1bHQuZXhpdENvZGV9LiBVbmRlciBsbGksIHRoYXQgYmVjb21lcyB0aGUgcHJvY2VzcyBleGl0IHN0YXR1cy5gO1xuICAgICAgfVxuXG4gICAgICBpZiAoIXJlc3VsdC5zdGRvdXQudHJpbSgpKSB7XG4gICAgICAgIHJlc3VsdC5zdGRvdXQgPSByZXN1bHQuZXhpdENvZGUgPT09IDBcbiAgICAgICAgICA/IFwiTExWTSBwcm9ncmFtIGV4aXRlZCB3aXRoIGNvZGUgMC5cIlxuICAgICAgICAgIDogYExMVk0gcHJvZ3JhbSByZXR1cm5lZCBpMzIgJHtyZXN1bHQuZXhpdENvZGV9LlxcblVzZSBzdGRvdXQgaW4gdGhlIElSIGl0c2VsZiBpZiB5b3Ugd2FudCBwcmludGFibGUgcHJvZ3JhbSBvdXRwdXQuYDtcbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gcmVzdWx0O1xuICB9XG59XG4iLCAiaW1wb3J0IHsgam9pbiB9IGZyb20gXCJwYXRoXCI7XG5pbXBvcnQgeyBydW5Qcm9jZXNzLCB3aXRoTmFtZWRUZW1wU291cmNlRmlsZSwgd2l0aFRlbXBTb3VyY2VGaWxlIH0gZnJvbSBcIi4uL2V4ZWN1dGlvbi9wcm9jZXNzUnVubmVyXCI7XG5pbXBvcnQgdHlwZSB7IGxvb21Db2RlQmxvY2ssIGxvb21QbHVnaW5TZXR0aW5ncywgbG9vbVJ1bkNvbnRleHQsIGxvb21SdW5SZXN1bHQsIGxvb21SdW5uZXIgfSBmcm9tIFwiLi4vdHlwZXNcIjtcblxuZXhwb3J0IGNsYXNzIE1hbmFnZWRDb21waWxlZFJ1bm5lciBpbXBsZW1lbnRzIGxvb21SdW5uZXIge1xuICBpZCA9IFwibWFuYWdlZC1jb21waWxlZFwiO1xuICBkaXNwbGF5TmFtZSA9IFwiTWFuYWdlZCBjb21waWxlclwiO1xuICBsYW5ndWFnZXMgPSBbXCJydXN0XCIsIFwiamF2YVwiXSBhcyBjb25zdDtcblxuICBjYW5SdW4oYmxvY2s6IGxvb21Db2RlQmxvY2ssIHNldHRpbmdzOiBsb29tUGx1Z2luU2V0dGluZ3MpOiBib29sZWFuIHtcbiAgICBpZiAoYmxvY2subGFuZ3VhZ2UgPT09IFwicnVzdFwiKSB7XG4gICAgICByZXR1cm4gQm9vbGVhbihzZXR0aW5ncy5ydXN0RXhlY3V0YWJsZS50cmltKCkpO1xuICAgIH1cblxuICAgIGlmIChibG9jay5sYW5ndWFnZSA9PT0gXCJqYXZhXCIpIHtcbiAgICAgIHJldHVybiBCb29sZWFuKHNldHRpbmdzLmphdmFFeGVjdXRhYmxlLnRyaW0oKSk7XG4gICAgfVxuXG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG5cbiAgYXN5bmMgcnVuKGJsb2NrOiBsb29tQ29kZUJsb2NrLCBjb250ZXh0OiBsb29tUnVuQ29udGV4dCwgc2V0dGluZ3M6IGxvb21QbHVnaW5TZXR0aW5ncyk6IFByb21pc2U8bG9vbVJ1blJlc3VsdD4ge1xuICAgIGlmIChibG9jay5sYW5ndWFnZSA9PT0gXCJydXN0XCIpIHtcbiAgICAgIHJldHVybiB0aGlzLnJ1blJ1c3QoYmxvY2ssIGNvbnRleHQsIHNldHRpbmdzKTtcbiAgICB9XG5cbiAgICBpZiAoYmxvY2subGFuZ3VhZ2UgPT09IFwiamF2YVwiKSB7XG4gICAgICByZXR1cm4gdGhpcy5ydW5KYXZhKGJsb2NrLCBjb250ZXh0LCBzZXR0aW5ncyk7XG4gICAgfVxuXG4gICAgdGhyb3cgbmV3IEVycm9yKGBVbnN1cHBvcnRlZCBsYW5ndWFnZTogJHtibG9jay5sYW5ndWFnZX1gKTtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgcnVuUnVzdChibG9jazogbG9vbUNvZGVCbG9jaywgY29udGV4dDogbG9vbVJ1bkNvbnRleHQsIHNldHRpbmdzOiBsb29tUGx1Z2luU2V0dGluZ3MpOiBQcm9taXNlPGxvb21SdW5SZXN1bHQ+IHtcbiAgICByZXR1cm4gd2l0aFRlbXBTb3VyY2VGaWxlKFwiLnJzXCIsIGJsb2NrLmNvbnRlbnQsIGFzeW5jICh7IHRlbXBEaXIsIHRlbXBGaWxlIH0pID0+IHtcbiAgICAgIGNvbnN0IGJpbmFyeVBhdGggPSBqb2luKHRlbXBEaXIsIFwic25pcHBldC5vdXRcIik7XG4gICAgICBjb25zdCBjb21waWxlUmVzdWx0ID0gYXdhaXQgcnVuUHJvY2Vzcyh7XG4gICAgICAgIHJ1bm5lcklkOiBgJHt0aGlzLmlkfTpydXN0OmNvbXBpbGVgLFxuICAgICAgICBydW5uZXJOYW1lOiBcIlJ1c3RcIixcbiAgICAgICAgZXhlY3V0YWJsZTogc2V0dGluZ3MucnVzdEV4ZWN1dGFibGUudHJpbSgpLFxuICAgICAgICBhcmdzOiBbdGVtcEZpbGUsIFwiLW9cIiwgYmluYXJ5UGF0aF0sXG4gICAgICAgIHdvcmtpbmdEaXJlY3Rvcnk6IGNvbnRleHQud29ya2luZ0RpcmVjdG9yeSxcbiAgICAgICAgdGltZW91dE1zOiBNYXRoLm1heChjb250ZXh0LnRpbWVvdXRNcywgMzBfMDAwKSxcbiAgICAgICAgc2lnbmFsOiBjb250ZXh0LnNpZ25hbCxcbiAgICAgIH0pO1xuXG4gICAgICBpZiAoIWNvbXBpbGVSZXN1bHQuc3VjY2Vzcykge1xuICAgICAgICByZXR1cm4gY29tcGlsZVJlc3VsdDtcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIHJ1blByb2Nlc3Moe1xuICAgICAgICBydW5uZXJJZDogYCR7dGhpcy5pZH06cnVzdDpydW5gLFxuICAgICAgICBydW5uZXJOYW1lOiBcIlJ1c3RcIixcbiAgICAgICAgZXhlY3V0YWJsZTogYmluYXJ5UGF0aCxcbiAgICAgICAgYXJnczogW10sXG4gICAgICAgIHdvcmtpbmdEaXJlY3Rvcnk6IGNvbnRleHQud29ya2luZ0RpcmVjdG9yeSxcbiAgICAgICAgdGltZW91dE1zOiBNYXRoLm1heChjb250ZXh0LnRpbWVvdXRNcywgMzBfMDAwKSxcbiAgICAgICAgc2lnbmFsOiBjb250ZXh0LnNpZ25hbCxcbiAgICAgIH0pO1xuICAgIH0pO1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBydW5KYXZhKGJsb2NrOiBsb29tQ29kZUJsb2NrLCBjb250ZXh0OiBsb29tUnVuQ29udGV4dCwgc2V0dGluZ3M6IGxvb21QbHVnaW5TZXR0aW5ncyk6IFByb21pc2U8bG9vbVJ1blJlc3VsdD4ge1xuICAgIHJldHVybiB3aXRoTmFtZWRUZW1wU291cmNlRmlsZShcIk1haW4uamF2YVwiLCBibG9jay5jb250ZW50LCBhc3luYyAoeyB0ZW1wRGlyLCB0ZW1wRmlsZSB9KSA9PiB7XG4gICAgICBpZiAoIXNldHRpbmdzLmphdmFDb21waWxlckV4ZWN1dGFibGUudHJpbSgpKSB7XG4gICAgICAgIHJldHVybiBydW5Qcm9jZXNzKHtcbiAgICAgICAgICBydW5uZXJJZDogYCR7dGhpcy5pZH06amF2YTpzb3VyY2VgLFxuICAgICAgICAgIHJ1bm5lck5hbWU6IFwiSmF2YVwiLFxuICAgICAgICAgIGV4ZWN1dGFibGU6IHNldHRpbmdzLmphdmFFeGVjdXRhYmxlLnRyaW0oKSxcbiAgICAgICAgICBhcmdzOiBbdGVtcEZpbGVdLFxuICAgICAgICAgIHdvcmtpbmdEaXJlY3Rvcnk6IGNvbnRleHQud29ya2luZ0RpcmVjdG9yeSxcbiAgICAgICAgICB0aW1lb3V0TXM6IE1hdGgubWF4KGNvbnRleHQudGltZW91dE1zLCAzMF8wMDApLFxuICAgICAgICAgIHNpZ25hbDogY29udGV4dC5zaWduYWwsXG4gICAgICAgIH0pO1xuICAgICAgfVxuXG4gICAgICBjb25zdCBjb21waWxlUmVzdWx0ID0gYXdhaXQgcnVuUHJvY2Vzcyh7XG4gICAgICAgIHJ1bm5lcklkOiBgJHt0aGlzLmlkfTpqYXZhOmNvbXBpbGVgLFxuICAgICAgICBydW5uZXJOYW1lOiBcIkphdmFcIixcbiAgICAgICAgZXhlY3V0YWJsZTogc2V0dGluZ3MuamF2YUNvbXBpbGVyRXhlY3V0YWJsZS50cmltKCksXG4gICAgICAgIGFyZ3M6IFt0ZW1wRmlsZV0sXG4gICAgICAgIHdvcmtpbmdEaXJlY3Rvcnk6IHRlbXBEaXIsXG4gICAgICAgIHRpbWVvdXRNczogTWF0aC5tYXgoY29udGV4dC50aW1lb3V0TXMsIDMwXzAwMCksXG4gICAgICAgIHNpZ25hbDogY29udGV4dC5zaWduYWwsXG4gICAgICB9KTtcblxuICAgICAgaWYgKCFjb21waWxlUmVzdWx0LnN1Y2Nlc3MpIHtcbiAgICAgICAgcmV0dXJuIGNvbXBpbGVSZXN1bHQ7XG4gICAgICB9XG5cbiAgICAgIHJldHVybiBydW5Qcm9jZXNzKHtcbiAgICAgICAgcnVubmVySWQ6IGAke3RoaXMuaWR9OmphdmE6cnVuYCxcbiAgICAgICAgcnVubmVyTmFtZTogXCJKYXZhXCIsXG4gICAgICAgIGV4ZWN1dGFibGU6IHNldHRpbmdzLmphdmFFeGVjdXRhYmxlLnRyaW0oKSxcbiAgICAgICAgYXJnczogW1wiLWNwXCIsIHRlbXBEaXIsIFwiTWFpblwiXSxcbiAgICAgICAgd29ya2luZ0RpcmVjdG9yeTogY29udGV4dC53b3JraW5nRGlyZWN0b3J5LFxuICAgICAgICB0aW1lb3V0TXM6IE1hdGgubWF4KGNvbnRleHQudGltZW91dE1zLCAzMF8wMDApLFxuICAgICAgICBzaWduYWw6IGNvbnRleHQuc2lnbmFsLFxuICAgICAgfSk7XG4gICAgfSk7XG4gIH1cbn1cbiIsICJpbXBvcnQgeyBqb2luIH0gZnJvbSBcInBhdGhcIjtcbmltcG9ydCB7IHJ1blByb2Nlc3MsIHdpdGhUZW1wU291cmNlRmlsZSB9IGZyb20gXCIuLi9leGVjdXRpb24vcHJvY2Vzc1J1bm5lclwiO1xuaW1wb3J0IHR5cGUgeyBsb29tQ29kZUJsb2NrLCBsb29tUGx1Z2luU2V0dGluZ3MsIGxvb21SdW5Db250ZXh0LCBsb29tUnVuUmVzdWx0LCBsb29tUnVubmVyIH0gZnJvbSBcIi4uL3R5cGVzXCI7XG5cbmV4cG9ydCBjbGFzcyBOYXRpdmVDb21waWxlZFJ1bm5lciBpbXBsZW1lbnRzIGxvb21SdW5uZXIge1xuICBpZCA9IFwibmF0aXZlLWNvbXBpbGVkXCI7XG4gIGRpc3BsYXlOYW1lID0gXCJOYXRpdmUgY29tcGlsZXJcIjtcbiAgbGFuZ3VhZ2VzID0gW1wiY1wiLCBcImNwcFwiXSBhcyBjb25zdDtcblxuICBjYW5SdW4oYmxvY2s6IGxvb21Db2RlQmxvY2ssIHNldHRpbmdzOiBsb29tUGx1Z2luU2V0dGluZ3MpOiBib29sZWFuIHtcbiAgICBpZiAoYmxvY2subGFuZ3VhZ2UgPT09IFwiY1wiKSB7XG4gICAgICByZXR1cm4gQm9vbGVhbihzZXR0aW5ncy5jRXhlY3V0YWJsZS50cmltKCkpO1xuICAgIH1cblxuICAgIGlmIChibG9jay5sYW5ndWFnZSA9PT0gXCJjcHBcIikge1xuICAgICAgcmV0dXJuIEJvb2xlYW4oc2V0dGluZ3MuY3BwRXhlY3V0YWJsZS50cmltKCkpO1xuICAgIH1cblxuICAgIHJldHVybiBmYWxzZTtcbiAgfVxuXG4gIGFzeW5jIHJ1bihibG9jazogbG9vbUNvZGVCbG9jaywgY29udGV4dDogbG9vbVJ1bkNvbnRleHQsIHNldHRpbmdzOiBsb29tUGx1Z2luU2V0dGluZ3MpOiBQcm9taXNlPGxvb21SdW5SZXN1bHQ+IHtcbiAgICBjb25zdCBleGVjdXRhYmxlID0gYmxvY2subGFuZ3VhZ2UgPT09IFwiY1wiID8gc2V0dGluZ3MuY0V4ZWN1dGFibGUudHJpbSgpIDogc2V0dGluZ3MuY3BwRXhlY3V0YWJsZS50cmltKCk7XG4gICAgY29uc3QgZmlsZUV4dGVuc2lvbiA9IGJsb2NrLmxhbmd1YWdlID09PSBcImNcIiA/IFwiLmNcIiA6IFwiLmNwcFwiO1xuICAgIGNvbnN0IHJ1bm5lck5hbWUgPSBibG9jay5sYW5ndWFnZSA9PT0gXCJjXCIgPyBcIkMgKEdDQylcIiA6IFwiQysrIChHKyspXCI7XG5cbiAgICByZXR1cm4gd2l0aFRlbXBTb3VyY2VGaWxlKGZpbGVFeHRlbnNpb24sIGJsb2NrLmNvbnRlbnQsIGFzeW5jICh7IHRlbXBEaXIsIHRlbXBGaWxlIH0pID0+IHtcbiAgICAgIGNvbnN0IGJpbmFyeVBhdGggPSBqb2luKHRlbXBEaXIsIFwic25pcHBldC5vdXRcIik7XG4gICAgICBjb25zdCBjb21waWxlUmVzdWx0ID0gYXdhaXQgcnVuUHJvY2Vzcyh7XG4gICAgICAgIHJ1bm5lcklkOiBgJHt0aGlzLmlkfToke2Jsb2NrLmxhbmd1YWdlfTpjb21waWxlYCxcbiAgICAgICAgcnVubmVyTmFtZSxcbiAgICAgICAgZXhlY3V0YWJsZSxcbiAgICAgICAgYXJnczogW3RlbXBGaWxlLCBcIi1vXCIsIGJpbmFyeVBhdGhdLFxuICAgICAgICB3b3JraW5nRGlyZWN0b3J5OiBjb250ZXh0LndvcmtpbmdEaXJlY3RvcnksXG4gICAgICAgIHRpbWVvdXRNczogTWF0aC5tYXgoY29udGV4dC50aW1lb3V0TXMsIDMwXzAwMCksXG4gICAgICAgIHNpZ25hbDogY29udGV4dC5zaWduYWwsXG4gICAgICB9KTtcblxuICAgICAgaWYgKCFjb21waWxlUmVzdWx0LnN1Y2Nlc3MpIHtcbiAgICAgICAgcmV0dXJuIGNvbXBpbGVSZXN1bHQ7XG4gICAgICB9XG5cbiAgICAgIHJldHVybiBydW5Qcm9jZXNzKHtcbiAgICAgICAgcnVubmVySWQ6IGAke3RoaXMuaWR9OiR7YmxvY2subGFuZ3VhZ2V9OnJ1bmAsXG4gICAgICAgIHJ1bm5lck5hbWUsXG4gICAgICAgIGV4ZWN1dGFibGU6IGJpbmFyeVBhdGgsXG4gICAgICAgIGFyZ3M6IFtdLFxuICAgICAgICB3b3JraW5nRGlyZWN0b3J5OiBjb250ZXh0LndvcmtpbmdEaXJlY3RvcnksXG4gICAgICAgIHRpbWVvdXRNczogTWF0aC5tYXgoY29udGV4dC50aW1lb3V0TXMsIDMwXzAwMCksXG4gICAgICAgIHNpZ25hbDogY29udGV4dC5zaWduYWwsXG4gICAgICB9KTtcbiAgICB9KTtcbiAgfVxufVxuIiwgImltcG9ydCB7IGpvaW4gfSBmcm9tIFwicGF0aFwiO1xuaW1wb3J0IHsgcnVuUHJvY2VzcywgcnVuVGVtcEZpbGVQcm9jZXNzLCB3aXRoVGVtcFNvdXJjZUZpbGUgfSBmcm9tIFwiLi4vZXhlY3V0aW9uL3Byb2Nlc3NSdW5uZXJcIjtcbmltcG9ydCB0eXBlIHsgbG9vbUNvZGVCbG9jaywgbG9vbVBsdWdpblNldHRpbmdzLCBsb29tUnVuQ29udGV4dCwgbG9vbVJ1blJlc3VsdCwgbG9vbVJ1bm5lciB9IGZyb20gXCIuLi90eXBlc1wiO1xuXG5leHBvcnQgY2xhc3MgT2NhbWxSdW5uZXIgaW1wbGVtZW50cyBsb29tUnVubmVyIHtcbiAgaWQgPSBcIm9jYW1sXCI7XG4gIGRpc3BsYXlOYW1lID0gXCJPQ2FtbFwiO1xuICBsYW5ndWFnZXMgPSBbXCJvY2FtbFwiXSBhcyBjb25zdDtcblxuICBjYW5SdW4oYmxvY2s6IGxvb21Db2RlQmxvY2ssIHNldHRpbmdzOiBsb29tUGx1Z2luU2V0dGluZ3MpOiBib29sZWFuIHtcbiAgICByZXR1cm4gYmxvY2subGFuZ3VhZ2UgPT09IFwib2NhbWxcIiAmJiBCb29sZWFuKHNldHRpbmdzLm9jYW1sRXhlY3V0YWJsZS50cmltKCkpO1xuICB9XG5cbiAgYXN5bmMgcnVuKGJsb2NrOiBsb29tQ29kZUJsb2NrLCBjb250ZXh0OiBsb29tUnVuQ29udGV4dCwgc2V0dGluZ3M6IGxvb21QbHVnaW5TZXR0aW5ncyk6IFByb21pc2U8bG9vbVJ1blJlc3VsdD4ge1xuICAgIGNvbnN0IG1vZGUgPSBzZXR0aW5ncy5vY2FtbE1vZGU7XG4gICAgY29uc3QgZXhlY3V0YWJsZSA9IHNldHRpbmdzLm9jYW1sRXhlY3V0YWJsZS50cmltKCk7XG5cbiAgICBpZiAobW9kZSA9PT0gXCJvY2FtbFwiKSB7XG4gICAgICByZXR1cm4gcnVuVGVtcEZpbGVQcm9jZXNzKHtcbiAgICAgICAgcnVubmVySWQ6IGAke3RoaXMuaWR9Om9jYW1sYCxcbiAgICAgICAgcnVubmVyTmFtZTogXCJPQ2FtbFwiLFxuICAgICAgICBleGVjdXRhYmxlLFxuICAgICAgICBhcmdzOiBbXCJ7ZmlsZX1cIl0sXG4gICAgICAgIGZpbGVFeHRlbnNpb246IFwiLm1sXCIsXG4gICAgICAgIHNvdXJjZTogYmxvY2suY29udGVudCxcbiAgICAgICAgd29ya2luZ0RpcmVjdG9yeTogY29udGV4dC53b3JraW5nRGlyZWN0b3J5LFxuICAgICAgICB0aW1lb3V0TXM6IGNvbnRleHQudGltZW91dE1zLFxuICAgICAgICBzaWduYWw6IGNvbnRleHQuc2lnbmFsLFxuICAgICAgfSk7XG4gICAgfVxuXG4gICAgaWYgKG1vZGUgPT09IFwiZHVuZVwiKSB7XG4gICAgICByZXR1cm4gcnVuVGVtcEZpbGVQcm9jZXNzKHtcbiAgICAgICAgcnVubmVySWQ6IGAke3RoaXMuaWR9OmR1bmVgLFxuICAgICAgICBydW5uZXJOYW1lOiBcIkR1bmUgLyBPQ2FtbFwiLFxuICAgICAgICBleGVjdXRhYmxlLFxuICAgICAgICBhcmdzOiBbXCJleGVjXCIsIFwiLS1cIiwgXCJvY2FtbFwiLCBcIntmaWxlfVwiXSxcbiAgICAgICAgZmlsZUV4dGVuc2lvbjogXCIubWxcIixcbiAgICAgICAgc291cmNlOiBibG9jay5jb250ZW50LFxuICAgICAgICB3b3JraW5nRGlyZWN0b3J5OiBjb250ZXh0LndvcmtpbmdEaXJlY3RvcnksXG4gICAgICAgIHRpbWVvdXRNczogY29udGV4dC50aW1lb3V0TXMsXG4gICAgICAgIHNpZ25hbDogY29udGV4dC5zaWduYWwsXG4gICAgICB9KTtcbiAgICB9XG5cbiAgICByZXR1cm4gd2l0aFRlbXBTb3VyY2VGaWxlKFwiLm1sXCIsIGJsb2NrLmNvbnRlbnQsIGFzeW5jICh7IHRlbXBEaXIsIHRlbXBGaWxlIH0pID0+IHtcbiAgICAgIGNvbnN0IGJpbmFyeVBhdGggPSBqb2luKHRlbXBEaXIsIFwic25pcHBldC5vdXRcIik7XG4gICAgICBjb25zdCBjb21waWxlUmVzdWx0ID0gYXdhaXQgcnVuUHJvY2Vzcyh7XG4gICAgICAgIHJ1bm5lcklkOiBgJHt0aGlzLmlkfTpvY2FtbGMtY29tcGlsZWAsXG4gICAgICAgIHJ1bm5lck5hbWU6IFwiT0NhbWxjXCIsXG4gICAgICAgIGV4ZWN1dGFibGUsXG4gICAgICAgIGFyZ3M6IFtcIi1vXCIsIGJpbmFyeVBhdGgsIHRlbXBGaWxlXSxcbiAgICAgICAgd29ya2luZ0RpcmVjdG9yeTogY29udGV4dC53b3JraW5nRGlyZWN0b3J5LFxuICAgICAgICB0aW1lb3V0TXM6IGNvbnRleHQudGltZW91dE1zLFxuICAgICAgICBzaWduYWw6IGNvbnRleHQuc2lnbmFsLFxuICAgICAgfSk7XG5cbiAgICAgIGlmICghY29tcGlsZVJlc3VsdC5zdWNjZXNzKSB7XG4gICAgICAgIHJldHVybiBjb21waWxlUmVzdWx0O1xuICAgICAgfVxuXG4gICAgICByZXR1cm4gcnVuUHJvY2Vzcyh7XG4gICAgICAgIHJ1bm5lcklkOiBgJHt0aGlzLmlkfTpvY2FtbGMtcnVuYCxcbiAgICAgICAgcnVubmVyTmFtZTogXCJPQ2FtbGNcIixcbiAgICAgICAgZXhlY3V0YWJsZTogYmluYXJ5UGF0aCxcbiAgICAgICAgYXJnczogW10sXG4gICAgICAgIHdvcmtpbmdEaXJlY3Rvcnk6IGNvbnRleHQud29ya2luZ0RpcmVjdG9yeSxcbiAgICAgICAgdGltZW91dE1zOiBjb250ZXh0LnRpbWVvdXRNcyxcbiAgICAgICAgc2lnbmFsOiBjb250ZXh0LnNpZ25hbCxcbiAgICAgIH0pO1xuICAgIH0pO1xuICB9XG59XG4iLCAiaW1wb3J0IHsgcnVuVGVtcEZpbGVQcm9jZXNzIH0gZnJvbSBcIi4uL2V4ZWN1dGlvbi9wcm9jZXNzUnVubmVyXCI7XG5pbXBvcnQgdHlwZSB7IGxvb21Db2RlQmxvY2ssIGxvb21QbHVnaW5TZXR0aW5ncywgbG9vbVJ1bkNvbnRleHQsIGxvb21SdW5SZXN1bHQsIGxvb21SdW5uZXIgfSBmcm9tIFwiLi4vdHlwZXNcIjtcblxuZXhwb3J0IGNsYXNzIFB5dGhvblJ1bm5lciBpbXBsZW1lbnRzIGxvb21SdW5uZXIge1xuICBpZCA9IFwicHl0aG9uXCI7XG4gIGRpc3BsYXlOYW1lID0gXCJQeXRob25cIjtcbiAgbGFuZ3VhZ2VzID0gW1wicHl0aG9uXCJdIGFzIGNvbnN0O1xuXG4gIGNhblJ1bihibG9jazogbG9vbUNvZGVCbG9jaywgc2V0dGluZ3M6IGxvb21QbHVnaW5TZXR0aW5ncyk6IGJvb2xlYW4ge1xuICAgIHJldHVybiBibG9jay5sYW5ndWFnZSA9PT0gXCJweXRob25cIiAmJiBCb29sZWFuKHNldHRpbmdzLnB5dGhvbkV4ZWN1dGFibGUudHJpbSgpKTtcbiAgfVxuXG4gIHJ1bihibG9jazogbG9vbUNvZGVCbG9jaywgY29udGV4dDogbG9vbVJ1bkNvbnRleHQsIHNldHRpbmdzOiBsb29tUGx1Z2luU2V0dGluZ3MpOiBQcm9taXNlPGxvb21SdW5SZXN1bHQ+IHtcbiAgICByZXR1cm4gcnVuVGVtcEZpbGVQcm9jZXNzKHtcbiAgICAgIHJ1bm5lcklkOiB0aGlzLmlkLFxuICAgICAgcnVubmVyTmFtZTogdGhpcy5kaXNwbGF5TmFtZSxcbiAgICAgIGV4ZWN1dGFibGU6IHNldHRpbmdzLnB5dGhvbkV4ZWN1dGFibGUudHJpbSgpLFxuICAgICAgYXJnczogW1wie2ZpbGV9XCJdLFxuICAgICAgZmlsZUV4dGVuc2lvbjogXCIucHlcIixcbiAgICAgIHNvdXJjZTogYmxvY2suY29udGVudCxcbiAgICAgIHdvcmtpbmdEaXJlY3Rvcnk6IGNvbnRleHQud29ya2luZ0RpcmVjdG9yeSxcbiAgICAgIHRpbWVvdXRNczogY29udGV4dC50aW1lb3V0TXMsXG4gICAgICBzaWduYWw6IGNvbnRleHQuc2lnbmFsLFxuICAgIH0pO1xuICB9XG59XG4iLCAiaW1wb3J0IHsgZXhpc3RzU3luYyB9IGZyb20gXCJmc1wiO1xuaW1wb3J0IHsgam9pbiB9IGZyb20gXCJwYXRoXCI7XG5pbXBvcnQgeyBydW5UZW1wRmlsZVByb2Nlc3MgfSBmcm9tIFwiLi4vZXhlY3V0aW9uL3Byb2Nlc3NSdW5uZXJcIjtcbmltcG9ydCB0eXBlIHsgbG9vbUNvZGVCbG9jaywgbG9vbVBsdWdpblNldHRpbmdzLCBsb29tUnVuQ29udGV4dCwgbG9vbVJ1blJlc3VsdCwgbG9vbVJ1bm5lciB9IGZyb20gXCIuLi90eXBlc1wiO1xuXG5leHBvcnQgY2xhc3MgUHJvb2ZSdW5uZXIgaW1wbGVtZW50cyBsb29tUnVubmVyIHtcbiAgaWQgPSBcInByb29mXCI7XG4gIGRpc3BsYXlOYW1lID0gXCJQcm9vZiBjaGVja2VyXCI7XG4gIGxhbmd1YWdlcyA9IFtcImxlYW5cIiwgXCJjb3FcIiwgXCJzbXRsaWJcIl0gYXMgY29uc3Q7XG5cbiAgY2FuUnVuKGJsb2NrOiBsb29tQ29kZUJsb2NrLCBzZXR0aW5nczogbG9vbVBsdWdpblNldHRpbmdzKTogYm9vbGVhbiB7XG4gICAgaWYgKGJsb2NrLmxhbmd1YWdlID09PSBcImxlYW5cIikge1xuICAgICAgcmV0dXJuIEJvb2xlYW4oc2V0dGluZ3MubGVhbkV4ZWN1dGFibGUudHJpbSgpKTtcbiAgICB9XG5cbiAgICBpZiAoYmxvY2subGFuZ3VhZ2UgPT09IFwiY29xXCIpIHtcbiAgICAgIHJldHVybiBCb29sZWFuKHJlc29sdmVDb3FFeGVjdXRhYmxlKHNldHRpbmdzKS50cmltKCkpO1xuICAgIH1cblxuICAgIGlmIChibG9jay5sYW5ndWFnZSA9PT0gXCJzbXRsaWJcIikge1xuICAgICAgcmV0dXJuIEJvb2xlYW4oc2V0dGluZ3Muc210RXhlY3V0YWJsZS50cmltKCkpO1xuICAgIH1cblxuICAgIHJldHVybiBmYWxzZTtcbiAgfVxuXG4gIHJ1bihibG9jazogbG9vbUNvZGVCbG9jaywgY29udGV4dDogbG9vbVJ1bkNvbnRleHQsIHNldHRpbmdzOiBsb29tUGx1Z2luU2V0dGluZ3MpOiBQcm9taXNlPGxvb21SdW5SZXN1bHQ+IHtcbiAgICBpZiAoYmxvY2subGFuZ3VhZ2UgPT09IFwibGVhblwiKSB7XG4gICAgICByZXR1cm4gcnVuVGVtcEZpbGVQcm9jZXNzKHtcbiAgICAgICAgcnVubmVySWQ6IGAke3RoaXMuaWR9OmxlYW5gLFxuICAgICAgICBydW5uZXJOYW1lOiBcIkxlYW5cIixcbiAgICAgICAgZXhlY3V0YWJsZTogc2V0dGluZ3MubGVhbkV4ZWN1dGFibGUudHJpbSgpLFxuICAgICAgICBhcmdzOiBbXCJ7ZmlsZX1cIl0sXG4gICAgICAgIGZpbGVFeHRlbnNpb246IFwiLmxlYW5cIixcbiAgICAgICAgc291cmNlOiBibG9jay5jb250ZW50LFxuICAgICAgICB3b3JraW5nRGlyZWN0b3J5OiBjb250ZXh0LndvcmtpbmdEaXJlY3RvcnksXG4gICAgICAgIHRpbWVvdXRNczogTWF0aC5tYXgoY29udGV4dC50aW1lb3V0TXMsIDMwXzAwMCksXG4gICAgICAgIHNpZ25hbDogY29udGV4dC5zaWduYWwsXG4gICAgICB9KTtcbiAgICB9XG5cbiAgICBpZiAoYmxvY2subGFuZ3VhZ2UgPT09IFwiY29xXCIpIHtcbiAgICAgIHJldHVybiBydW5UZW1wRmlsZVByb2Nlc3Moe1xuICAgICAgICBydW5uZXJJZDogYCR7dGhpcy5pZH06Y29xYCxcbiAgICAgICAgcnVubmVyTmFtZTogXCJDb3FcIixcbiAgICAgICAgZXhlY3V0YWJsZTogcmVzb2x2ZUNvcUV4ZWN1dGFibGUoc2V0dGluZ3MpLFxuICAgICAgICBhcmdzOiBbXCItcVwiLCBcIntmaWxlfVwiXSxcbiAgICAgICAgZmlsZUV4dGVuc2lvbjogXCIudlwiLFxuICAgICAgICBzb3VyY2U6IGJsb2NrLmNvbnRlbnQsXG4gICAgICAgIHdvcmtpbmdEaXJlY3Rvcnk6IGNvbnRleHQud29ya2luZ0RpcmVjdG9yeSxcbiAgICAgICAgdGltZW91dE1zOiBNYXRoLm1heChjb250ZXh0LnRpbWVvdXRNcywgMzBfMDAwKSxcbiAgICAgICAgc2lnbmFsOiBjb250ZXh0LnNpZ25hbCxcbiAgICAgIH0pO1xuICAgIH1cblxuICAgIGlmIChibG9jay5sYW5ndWFnZSA9PT0gXCJzbXRsaWJcIikge1xuICAgICAgcmV0dXJuIHJ1blRlbXBGaWxlUHJvY2Vzcyh7XG4gICAgICAgIHJ1bm5lcklkOiBgJHt0aGlzLmlkfTpzbXRsaWJgLFxuICAgICAgICBydW5uZXJOYW1lOiBcIlNNVC1MSUIgKFozKVwiLFxuICAgICAgICBleGVjdXRhYmxlOiBzZXR0aW5ncy5zbXRFeGVjdXRhYmxlLnRyaW0oKSxcbiAgICAgICAgYXJnczogW1wie2ZpbGV9XCJdLFxuICAgICAgICBmaWxlRXh0ZW5zaW9uOiBcIi5zbXQyXCIsXG4gICAgICAgIHNvdXJjZTogYmxvY2suY29udGVudCxcbiAgICAgICAgd29ya2luZ0RpcmVjdG9yeTogY29udGV4dC53b3JraW5nRGlyZWN0b3J5LFxuICAgICAgICB0aW1lb3V0TXM6IE1hdGgubWF4KGNvbnRleHQudGltZW91dE1zLCAzMF8wMDApLFxuICAgICAgICBzaWduYWw6IGNvbnRleHQuc2lnbmFsLFxuICAgICAgfSk7XG4gICAgfVxuXG4gICAgdGhyb3cgbmV3IEVycm9yKGBVbnN1cHBvcnRlZCBwcm9vZiBsYW5ndWFnZTogJHtibG9jay5sYW5ndWFnZX1gKTtcbiAgfVxufVxuXG5mdW5jdGlvbiByZXNvbHZlQ29xRXhlY3V0YWJsZShzZXR0aW5nczogbG9vbVBsdWdpblNldHRpbmdzKTogc3RyaW5nIHtcbiAgY29uc3QgY29uZmlndXJlZCA9IHNldHRpbmdzLmNvcUV4ZWN1dGFibGUudHJpbSgpO1xuICBpZiAoY29uZmlndXJlZCAmJiBjb25maWd1cmVkICE9PSBcImNvcWNcIikge1xuICAgIHJldHVybiBjb25maWd1cmVkO1xuICB9XG5cbiAgY29uc3Qgb3BhbUNvcWMgPSBqb2luKHByb2Nlc3MuZW52LkhPTUUgPz8gXCJcIiwgXCIub3BhbVwiLCBcImRlZmF1bHRcIiwgXCJiaW5cIiwgXCJjb3FjXCIpO1xuICByZXR1cm4gZXhpc3RzU3luYyhvcGFtQ29xYykgPyBvcGFtQ29xYyA6IGNvbmZpZ3VyZWQgfHwgXCJjb3FjXCI7XG59XG4iLCAiaW1wb3J0IHR5cGUgeyBsb29tQ29kZUJsb2NrLCBsb29tUGx1Z2luU2V0dGluZ3MsIGxvb21SdW5uZXIgfSBmcm9tIFwiLi4vdHlwZXNcIjtcblxuZXhwb3J0IGNsYXNzIGxvb21SdW5uZXJSZWdpc3RyeSB7XG4gIGNvbnN0cnVjdG9yKHByaXZhdGUgcmVhZG9ubHkgcnVubmVyczogbG9vbVJ1bm5lcltdKSB7fVxuXG4gIGdldFJ1bm5lckZvckJsb2NrKGJsb2NrOiBsb29tQ29kZUJsb2NrLCBzZXR0aW5nczogbG9vbVBsdWdpblNldHRpbmdzKTogbG9vbVJ1bm5lciB8IG51bGwge1xuICAgIHJldHVybiB0aGlzLnJ1bm5lcnMuZmluZCgocnVubmVyKSA9PiAoIXJ1bm5lci5sYW5ndWFnZXMubGVuZ3RoIHx8IHJ1bm5lci5sYW5ndWFnZXMuaW5jbHVkZXMoYmxvY2subGFuZ3VhZ2UpKSAmJiBydW5uZXIuY2FuUnVuKGJsb2NrLCBzZXR0aW5ncykpID8/IG51bGw7XG4gIH1cblxuICBnZXRTdXBwb3J0ZWRMYW5ndWFnZXMoKTogc3RyaW5nW10ge1xuICAgIHJldHVybiBbLi4ubmV3IFNldCh0aGlzLnJ1bm5lcnMuZmxhdE1hcCgocnVubmVyKSA9PiBydW5uZXIubGFuZ3VhZ2VzKSldO1xuICB9XG59XG4iLCAiaW1wb3J0IHsgQXBwLCBNb2RhbCwgTm90aWNlLCBQbHVnaW5TZXR0aW5nVGFiLCBTZXR0aW5nLCBub3JtYWxpemVQYXRoIH0gZnJvbSBcIm9ic2lkaWFuXCI7XG5pbXBvcnQgdHlwZSBsb29tUGx1Z2luIGZyb20gXCIuL21haW5cIjtcbmltcG9ydCB0eXBlIHsgbG9vbUN1c3RvbUxhbmd1YWdlLCBsb29tUGx1Z2luU2V0dGluZ3MgfSBmcm9tIFwiLi90eXBlc1wiO1xuXG5leHBvcnQgY29uc3QgREVGQVVMVF9TRVRUSU5HUzogbG9vbVBsdWdpblNldHRpbmdzID0ge1xuICBlbmFibGVMb2NhbEV4ZWN1dGlvbjogZmFsc2UsXG4gIGhhc0Fja25vd2xlZGdlZEV4ZWN1dGlvblJpc2s6IGZhbHNlLFxuICBwcmVzZXJ2ZVNvdXJjZU1vZGU6IHRydWUsXG4gIGRlZmF1bHRUaW1lb3V0TXM6IDgwMDAsXG4gIHdvcmtpbmdEaXJlY3Rvcnk6IFwiXCIsXG4gIHB5dGhvbkV4ZWN1dGFibGU6IFwicHl0aG9uM1wiLFxuICBub2RlRXhlY3V0YWJsZTogXCJub2RlXCIsXG4gIHR5cGVzY3JpcHRNb2RlOiBcInRzLW5vZGVcIixcbiAgdHlwZXNjcmlwdFRyYW5zcGlsZXJFeGVjdXRhYmxlOiBcInRzLW5vZGVcIixcbiAgb2NhbWxNb2RlOiBcIm9jYW1sXCIsXG4gIG9jYW1sRXhlY3V0YWJsZTogXCJvY2FtbFwiLFxuICBjRXhlY3V0YWJsZTogXCJnY2NcIixcbiAgY3BwRXhlY3V0YWJsZTogXCJnKytcIixcbiAgc2hlbGxFeGVjdXRhYmxlOiBcImJhc2hcIixcbiAgcnVieUV4ZWN1dGFibGU6IFwicnVieVwiLFxuICBwZXJsRXhlY3V0YWJsZTogXCJwZXJsXCIsXG4gIGx1YUV4ZWN1dGFibGU6IFwibHVhXCIsXG4gIHBocEV4ZWN1dGFibGU6IFwicGhwXCIsXG4gIGdvRXhlY3V0YWJsZTogXCJnb1wiLFxuICBydXN0RXhlY3V0YWJsZTogXCJydXN0Y1wiLFxuICBoYXNrZWxsRXhlY3V0YWJsZTogXCJydW5naGNcIixcbiAgamF2YUNvbXBpbGVyRXhlY3V0YWJsZTogXCJcIixcbiAgamF2YUV4ZWN1dGFibGU6IFwiamF2YVwiLFxuICBsbHZtSW50ZXJwcmV0ZXJFeGVjdXRhYmxlOiBcImxsaVwiLFxuICBsZWFuRXhlY3V0YWJsZTogXCJsZWFuXCIsXG4gIGNvcUV4ZWN1dGFibGU6IFwiY29xY1wiLFxuICBzbXRFeGVjdXRhYmxlOiBcInozXCIsXG4gIHdyaXRlT3V0cHV0VG9Ob3RlOiBmYWxzZSxcbiAgYXV0b1J1bk9uRmlsZU9wZW46IGZhbHNlLFxuICBjdXN0b21MYW5ndWFnZXM6IFtdLFxuICBwZGZFeHBvcnRNb2RlOiBcImJvdGhcIixcbiAgZGVmYXVsdENvbnRhaW5lckdyb3VwOiBcIlwiLFxufTtcblxuZXhwb3J0IGNsYXNzIGxvb21TZXR0aW5nVGFiIGV4dGVuZHMgUGx1Z2luU2V0dGluZ1RhYiB7XG4gIGNvbnN0cnVjdG9yKHByaXZhdGUgcmVhZG9ubHkgbG9vbVBsdWdpbjogbG9vbVBsdWdpbikge1xuICAgIHN1cGVyKGxvb21QbHVnaW4uYXBwLCBsb29tUGx1Z2luKTtcbiAgfVxuXG4gIGRpc3BsYXkoKTogdm9pZCB7XG4gICAgY29uc3QgeyBjb250YWluZXJFbCB9ID0gdGhpcztcbiAgICBjb250YWluZXJFbC5lbXB0eSgpO1xuICAgIGNvbnRhaW5lckVsLmNyZWF0ZUVsKFwiaDJcIiwgeyB0ZXh0OiBcImxvb21cIiB9KTtcbiAgICBjb250YWluZXJFbC5jcmVhdGVFbChcInBcIiwgeyB0ZXh0OiBcIlJ1biBzdXBwb3J0ZWQgY29kZSBmZW5jZXMgZGlyZWN0bHkgZnJvbSBub3RlcyB3aGlsZSBwcmVzZXJ2aW5nIG5hdGl2ZSBzeW50YXggaGlnaGxpZ2h0aW5nLlwiIH0pO1xuXG4gICAgdGhpcy5yZW5kZXJHZW5lcmFsU2V0dGluZ3ModGhpcy5jcmVhdGVTZWN0aW9uKGNvbnRhaW5lckVsLCBcIkdlbmVyYWwgU2V0dGluZ3NcIiwgdHJ1ZSkpO1xuICAgIHRoaXMucmVuZGVyQnVpbHRJblJ1bnRpbWVzKHRoaXMuY3JlYXRlU2VjdGlvbihjb250YWluZXJFbCwgXCJCdWlsdC1pbiBSdW50aW1lc1wiKSk7XG4gICAgdGhpcy5yZW5kZXJDdXN0b21MYW5ndWFnZXModGhpcy5jcmVhdGVTZWN0aW9uKGNvbnRhaW5lckVsLCBcIkN1c3RvbSBMYW5ndWFnZXNcIikpO1xuICAgIHZvaWQgdGhpcy5yZW5kZXJDb250YWluZXJHcm91cHModGhpcy5jcmVhdGVTZWN0aW9uKGNvbnRhaW5lckVsLCBcIkNvbnRhaW5lcml6YXRpb24gR3JvdXBzXCIpKTtcbiAgfVxuXG4gIHByaXZhdGUgY3JlYXRlU2VjdGlvbihjb250YWluZXJFbDogSFRNTEVsZW1lbnQsIHRpdGxlOiBzdHJpbmcsIG9wZW4gPSBmYWxzZSk6IEhUTUxFbGVtZW50IHtcbiAgICBjb25zdCBkZXRhaWxzID0gY29udGFpbmVyRWwuY3JlYXRlRWwoXCJkZXRhaWxzXCIsIHsgY2xzOiBcImxvb20tc2V0dGluZ3Mtc2VjdGlvblwiIH0pO1xuICAgIGRldGFpbHMub3BlbiA9IG9wZW47XG4gICAgZGV0YWlscy5jcmVhdGVFbChcInN1bW1hcnlcIiwgeyB0ZXh0OiB0aXRsZSwgY2xzOiBcImxvb20tc2V0dGluZ3Mtc3VtbWFyeVwiIH0pO1xuICAgIHJldHVybiBkZXRhaWxzLmNyZWF0ZURpdih7IGNsczogXCJsb29tLXNldHRpbmdzLXNlY3Rpb24tYm9keVwiIH0pO1xuICB9XG5cbiAgcHJpdmF0ZSByZW5kZXJHZW5lcmFsU2V0dGluZ3MoY29udGFpbmVyRWw6IEhUTUxFbGVtZW50KTogdm9pZCB7XG4gICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAuc2V0TmFtZShcIkVuYWJsZSBsb2NhbCBleGVjdXRpb25cIilcbiAgICAgIC5zZXREZXNjKFwiRGlzYWJsZWQgYnkgZGVmYXVsdC4gbG9vbSBydW5zIGNvZGUgb24geW91ciBsb2NhbCBtYWNoaW5lIGFuZCBkb2VzIG5vdCBwcm92aWRlIHNhbmRib3hpbmcuXCIpXG4gICAgICAuYWRkVG9nZ2xlKCh0b2dnbGUpID0+XG4gICAgICAgIHRvZ2dsZS5zZXRWYWx1ZSh0aGlzLmxvb21QbHVnaW4uc2V0dGluZ3MuZW5hYmxlTG9jYWxFeGVjdXRpb24pLm9uQ2hhbmdlKGFzeW5jICh2YWx1ZSkgPT4ge1xuICAgICAgICAgIHRoaXMubG9vbVBsdWdpbi5zZXR0aW5ncy5lbmFibGVMb2NhbEV4ZWN1dGlvbiA9IHZhbHVlO1xuICAgICAgICAgIGlmICh2YWx1ZSkge1xuICAgICAgICAgICAgdGhpcy5sb29tUGx1Z2luLnNldHRpbmdzLmhhc0Fja25vd2xlZGdlZEV4ZWN1dGlvblJpc2sgPSB0cnVlO1xuICAgICAgICAgIH1cbiAgICAgICAgICBhd2FpdCB0aGlzLmxvb21QbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICAgIH0pLFxuICAgICAgKTtcblxuICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxuICAgICAgLnNldE5hbWUoXCJLZWVwIGxvb20gbm90ZXMgaW4gc291cmNlIG1vZGVcIilcbiAgICAgIC5zZXREZXNjKFwiUHJlc2VydmUgcmF3IGZlbmNlZCBjb2RlIGluIHRoZSBlZGl0b3IgaW5zdGVhZCBvZiBsZXR0aW5nIGxpdmUgcHJldmlldyBjb2xsYXBzZSByZXNlYXJjaCBzbmlwcGV0cy5cIilcbiAgICAgIC5hZGRUb2dnbGUoKHRvZ2dsZSkgPT5cbiAgICAgICAgdG9nZ2xlLnNldFZhbHVlKHRoaXMubG9vbVBsdWdpbi5zZXR0aW5ncy5wcmVzZXJ2ZVNvdXJjZU1vZGUpLm9uQ2hhbmdlKGFzeW5jICh2YWx1ZSkgPT4ge1xuICAgICAgICAgIHRoaXMubG9vbVBsdWdpbi5zZXR0aW5ncy5wcmVzZXJ2ZVNvdXJjZU1vZGUgPSB2YWx1ZTtcbiAgICAgICAgICBhd2FpdCB0aGlzLmxvb21QbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICAgICAgaWYgKHZhbHVlKSB7XG4gICAgICAgICAgICB2b2lkIHRoaXMubG9vbVBsdWdpbi5lbmZvcmNlU291cmNlTW9kZUZvckFjdGl2ZVZpZXcoKTtcbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgdm9pZCB0aGlzLmxvb21QbHVnaW4uZGlzYWJsZVNvdXJjZU1vZGVGb3JBY3RpdmVWaWV3KCk7XG4gICAgICAgICAgfVxuICAgICAgICB9KSxcbiAgICAgICk7XG5cbiAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgIC5zZXROYW1lKFwiRGVmYXVsdCB0aW1lb3V0XCIpXG4gICAgICAuc2V0RGVzYyhcIk1heGltdW0gZXhlY3V0aW9uIHRpbWUgaW4gbWlsbGlzZWNvbmRzIGJlZm9yZSBsb29tIHRlcm1pbmF0ZXMgdGhlIHByb2Nlc3MuXCIpXG4gICAgICAuYWRkVGV4dCgodGV4dCkgPT5cbiAgICAgICAgdGV4dC5zZXRQbGFjZWhvbGRlcihcIjgwMDBcIikuc2V0VmFsdWUoU3RyaW5nKHRoaXMubG9vbVBsdWdpbi5zZXR0aW5ncy5kZWZhdWx0VGltZW91dE1zKSkub25DaGFuZ2UoYXN5bmMgKHZhbHVlKSA9PiB7XG4gICAgICAgICAgY29uc3QgcGFyc2VkID0gTnVtYmVyLnBhcnNlSW50KHZhbHVlLCAxMCk7XG4gICAgICAgICAgaWYgKCFOdW1iZXIuaXNOYU4ocGFyc2VkKSAmJiBwYXJzZWQgPiAwKSB7XG4gICAgICAgICAgICB0aGlzLmxvb21QbHVnaW4uc2V0dGluZ3MuZGVmYXVsdFRpbWVvdXRNcyA9IHBhcnNlZDtcbiAgICAgICAgICAgIGF3YWl0IHRoaXMubG9vbVBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgICAgICB9XG4gICAgICAgIH0pLFxuICAgICAgKTtcblxuICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxuICAgICAgLnNldE5hbWUoXCJXb3JraW5nIGRpcmVjdG9yeVwiKVxuICAgICAgLnNldERlc2MoXCJPcHRpb25hbC4gRW1wdHkgdXNlcyB0aGUgY3VycmVudCBub3RlIGZvbGRlciB3aGVuIHBvc3NpYmxlLCBvdGhlcndpc2UgdGhlIHZhdWx0IHJvb3QuXCIpXG4gICAgICAuYWRkVGV4dCgodGV4dCkgPT5cbiAgICAgICAgdGV4dC5zZXRQbGFjZWhvbGRlcihcIlZhdWx0IHJvb3RcIikuc2V0VmFsdWUodGhpcy5sb29tUGx1Z2luLnNldHRpbmdzLndvcmtpbmdEaXJlY3RvcnkpLm9uQ2hhbmdlKGFzeW5jICh2YWx1ZSkgPT4ge1xuICAgICAgICAgIHRoaXMubG9vbVBsdWdpbi5zZXR0aW5ncy53b3JraW5nRGlyZWN0b3J5ID0gdmFsdWUudHJpbSgpID8gbm9ybWFsaXplUGF0aCh2YWx1ZS50cmltKCkpIDogXCJcIjtcbiAgICAgICAgICBhd2FpdCB0aGlzLmxvb21QbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICAgIH0pLFxuICAgICAgKTtcblxuICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxuICAgICAgLnNldE5hbWUoXCJXcml0ZSBvdXRwdXQgYmFjayB0byBub3RlXCIpXG4gICAgICAuc2V0RGVzYyhcIkluc2VydCBtYW5hZ2VkIGxvb20gb3V0cHV0IHNlY3Rpb25zIGJlbmVhdGggY29kZSBibG9ja3MgaW5zdGVhZCBvZiBrZWVwaW5nIHJlc3VsdHMgcHVyZWx5IGluIHRoZSBVSS5cIilcbiAgICAgIC5hZGRUb2dnbGUoKHRvZ2dsZSkgPT5cbiAgICAgICAgdG9nZ2xlLnNldFZhbHVlKHRoaXMubG9vbVBsdWdpbi5zZXR0aW5ncy53cml0ZU91dHB1dFRvTm90ZSkub25DaGFuZ2UoYXN5bmMgKHZhbHVlKSA9PiB7XG4gICAgICAgICAgdGhpcy5sb29tUGx1Z2luLnNldHRpbmdzLndyaXRlT3V0cHV0VG9Ob3RlID0gdmFsdWU7XG4gICAgICAgICAgYXdhaXQgdGhpcy5sb29tUGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgICAgICB9KSxcbiAgICAgICk7XG5cbiAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgIC5zZXROYW1lKFwiQXV0by1ydW4gb24gZmlsZSBvcGVuXCIpXG4gICAgICAuc2V0RGVzYyhcIlJ1biBhbGwgc3VwcG9ydGVkIGJsb2NrcyBpbiB0aGUgYWN0aXZlIG5vdGUgd2hlbiBpdCBvcGVucy4gRGlzYWJsZWQgYnkgZGVmYXVsdC5cIilcbiAgICAgIC5hZGRUb2dnbGUoKHRvZ2dsZSkgPT5cbiAgICAgICAgdG9nZ2xlLnNldFZhbHVlKHRoaXMubG9vbVBsdWdpbi5zZXR0aW5ncy5hdXRvUnVuT25GaWxlT3Blbikub25DaGFuZ2UoYXN5bmMgKHZhbHVlKSA9PiB7XG4gICAgICAgICAgdGhpcy5sb29tUGx1Z2luLnNldHRpbmdzLmF1dG9SdW5PbkZpbGVPcGVuID0gdmFsdWU7XG4gICAgICAgICAgYXdhaXQgdGhpcy5sb29tUGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgICAgICB9KSxcbiAgICAgICk7XG5cbiAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgIC5zZXROYW1lKFwiUERGIGV4cG9ydCBtb2RlXCIpXG4gICAgICAuc2V0RGVzYyhcIkNob29zZSB3aGF0IHRvIGluY2x1ZGUgd2hlbiBleHBvcnRpbmcgbm90ZXMgY29udGFpbmluZyBsb29tIGNvZGUgYmxvY2tzIHRvIFBERi5cIilcbiAgICAgIC5hZGREcm9wZG93bigoZHJvcGRvd24pID0+XG4gICAgICAgIGRyb3Bkb3duXG4gICAgICAgICAgLmFkZE9wdGlvbihcImJvdGhcIiwgXCJCb3RoIENvZGUgYW5kIE91dHB1dFwiKVxuICAgICAgICAgIC5hZGRPcHRpb24oXCJjb2RlXCIsIFwiQ29kZSBCbG9jayBPbmx5XCIpXG4gICAgICAgICAgLmFkZE9wdGlvbihcIm91dHB1dFwiLCBcIk91dHB1dCBPbmx5XCIpXG4gICAgICAgICAgLnNldFZhbHVlKHRoaXMubG9vbVBsdWdpbi5zZXR0aW5ncy5wZGZFeHBvcnRNb2RlIHx8IFwiYm90aFwiKVxuICAgICAgICAgIC5vbkNoYW5nZShhc3luYyAodmFsdWUpID0+IHtcbiAgICAgICAgICAgIHRoaXMubG9vbVBsdWdpbi5zZXR0aW5ncy5wZGZFeHBvcnRNb2RlID0gdmFsdWUgYXMgXCJib3RoXCIgfCBcImNvZGVcIiB8IFwib3V0cHV0XCI7XG4gICAgICAgICAgICBhd2FpdCB0aGlzLmxvb21QbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICAgICAgfSksXG4gICAgICApO1xuICB9XG5cbiAgcHJpdmF0ZSByZW5kZXJCdWlsdEluUnVudGltZXMoY29udGFpbmVyRWw6IEhUTUxFbGVtZW50KTogdm9pZCB7XG4gICAgdGhpcy5hZGRUZXh0U2V0dGluZyhjb250YWluZXJFbCwgXCJQeXRob24gZXhlY3V0YWJsZVwiLCBcIlBhdGggb3IgY29tbWFuZCBuYW1lIGZvciBQeXRob24uXCIsIFwicHl0aG9uRXhlY3V0YWJsZVwiKTtcbiAgICB0aGlzLmFkZFRleHRTZXR0aW5nKGNvbnRhaW5lckVsLCBcIk5vZGUgZXhlY3V0YWJsZVwiLCBcIlBhdGggb3IgY29tbWFuZCBuYW1lIGZvciBKYXZhU2NyaXB0IGV4ZWN1dGlvbi5cIiwgXCJub2RlRXhlY3V0YWJsZVwiKTtcblxuICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxuICAgICAgLnNldE5hbWUoXCJUeXBlU2NyaXB0IHJ1bm5lciBtb2RlXCIpXG4gICAgICAuc2V0RGVzYyhcIlVzZSB0cy1ub2RlIG9yIHRzeCBmb3IgVHlwZVNjcmlwdCBibG9ja3MuXCIpXG4gICAgICAuYWRkRHJvcGRvd24oKGRyb3Bkb3duKSA9PlxuICAgICAgICBkcm9wZG93blxuICAgICAgICAgIC5hZGRPcHRpb24oXCJ0cy1ub2RlXCIsIFwidHMtbm9kZVwiKVxuICAgICAgICAgIC5hZGRPcHRpb24oXCJ0c3hcIiwgXCJ0c3hcIilcbiAgICAgICAgICAuc2V0VmFsdWUodGhpcy5sb29tUGx1Z2luLnNldHRpbmdzLnR5cGVzY3JpcHRNb2RlKVxuICAgICAgICAgIC5vbkNoYW5nZShhc3luYyAodmFsdWUpID0+IHtcbiAgICAgICAgICAgIHRoaXMubG9vbVBsdWdpbi5zZXR0aW5ncy50eXBlc2NyaXB0TW9kZSA9IHZhbHVlIGFzIFwidHMtbm9kZVwiIHwgXCJ0c3hcIjtcbiAgICAgICAgICAgIGF3YWl0IHRoaXMubG9vbVBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgICAgICB9KSxcbiAgICAgICk7XG5cbiAgICB0aGlzLmFkZFRleHRTZXR0aW5nKGNvbnRhaW5lckVsLCBcIlR5cGVTY3JpcHQgdHJhbnNwaWxlciBleGVjdXRhYmxlXCIsIFwiQ29tbWFuZCBvciBwYXRoIGZvciB0cy1ub2RlIG9yIHRzeC5cIiwgXCJ0eXBlc2NyaXB0VHJhbnNwaWxlckV4ZWN1dGFibGVcIik7XG5cbiAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgIC5zZXROYW1lKFwiT0NhbWwgbW9kZVwiKVxuICAgICAgLnNldERlc2MoXCJDaG9vc2UgYmV0d2VlbiB0aGUgT0NhbWwgdG9wbGV2ZWwsIG9jYW1sYyBjb21waWxhdGlvbiwgb3IgZHVuZSBleGVjLlwiKVxuICAgICAgLmFkZERyb3Bkb3duKChkcm9wZG93bikgPT5cbiAgICAgICAgZHJvcGRvd25cbiAgICAgICAgICAuYWRkT3B0aW9uKFwib2NhbWxcIiwgXCJvY2FtbFwiKVxuICAgICAgICAgIC5hZGRPcHRpb24oXCJvY2FtbGNcIiwgXCJvY2FtbGNcIilcbiAgICAgICAgICAuYWRkT3B0aW9uKFwiZHVuZVwiLCBcImR1bmVcIilcbiAgICAgICAgICAuc2V0VmFsdWUodGhpcy5sb29tUGx1Z2luLnNldHRpbmdzLm9jYW1sTW9kZSlcbiAgICAgICAgICAub25DaGFuZ2UoYXN5bmMgKHZhbHVlKSA9PiB7XG4gICAgICAgICAgICB0aGlzLmxvb21QbHVnaW4uc2V0dGluZ3Mub2NhbWxNb2RlID0gdmFsdWUgYXMgXCJvY2FtbFwiIHwgXCJvY2FtbGNcIiB8IFwiZHVuZVwiO1xuICAgICAgICAgICAgYXdhaXQgdGhpcy5sb29tUGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgICAgICAgIH0pLFxuICAgICAgKTtcblxuICAgIHRoaXMuYWRkVGV4dFNldHRpbmcoY29udGFpbmVyRWwsIFwiT0NhbWwgZXhlY3V0YWJsZVwiLCBcIkNvbW1hbmQgb3IgcGF0aCBmb3Igb2NhbWwsIG9jYW1sYywgb3IgZHVuZSBkZXBlbmRpbmcgb24gdGhlIHNlbGVjdGVkIG1vZGUuXCIsIFwib2NhbWxFeGVjdXRhYmxlXCIpO1xuICAgIHRoaXMuYWRkVGV4dFNldHRpbmcoY29udGFpbmVyRWwsIFwiQyBjb21waWxlclwiLCBcIkNvbW1hbmQgb3IgcGF0aCBmb3IgY29tcGlsaW5nIEMgYmxvY2tzLlwiLCBcImNFeGVjdXRhYmxlXCIpO1xuICAgIHRoaXMuYWRkVGV4dFNldHRpbmcoY29udGFpbmVyRWwsIFwiQysrIGNvbXBpbGVyXCIsIFwiQ29tbWFuZCBvciBwYXRoIGZvciBjb21waWxpbmcgQysrIGJsb2Nrcy5cIiwgXCJjcHBFeGVjdXRhYmxlXCIpO1xuICAgIHRoaXMuYWRkVGV4dFNldHRpbmcoY29udGFpbmVyRWwsIFwiU2hlbGwgZXhlY3V0YWJsZVwiLCBcIkNvbW1hbmQgb3IgcGF0aCBmb3IgU2hlbGwsIEJhc2gsIGFuZCBzaCBibG9ja3MuXCIsIFwic2hlbGxFeGVjdXRhYmxlXCIpO1xuICAgIHRoaXMuYWRkVGV4dFNldHRpbmcoY29udGFpbmVyRWwsIFwiUnVieSBleGVjdXRhYmxlXCIsIFwiQ29tbWFuZCBvciBwYXRoIGZvciBSdWJ5IGJsb2Nrcy5cIiwgXCJydWJ5RXhlY3V0YWJsZVwiKTtcbiAgICB0aGlzLmFkZFRleHRTZXR0aW5nKGNvbnRhaW5lckVsLCBcIlBlcmwgZXhlY3V0YWJsZVwiLCBcIkNvbW1hbmQgb3IgcGF0aCBmb3IgUGVybCBibG9ja3MuXCIsIFwicGVybEV4ZWN1dGFibGVcIik7XG4gICAgdGhpcy5hZGRUZXh0U2V0dGluZyhjb250YWluZXJFbCwgXCJMdWEgZXhlY3V0YWJsZVwiLCBcIkNvbW1hbmQgb3IgcGF0aCBmb3IgTHVhIGJsb2Nrcy5cIiwgXCJsdWFFeGVjdXRhYmxlXCIpO1xuICAgIHRoaXMuYWRkVGV4dFNldHRpbmcoY29udGFpbmVyRWwsIFwiUEhQIGV4ZWN1dGFibGVcIiwgXCJDb21tYW5kIG9yIHBhdGggZm9yIFBIUCBibG9ja3MuXCIsIFwicGhwRXhlY3V0YWJsZVwiKTtcbiAgICB0aGlzLmFkZFRleHRTZXR0aW5nKGNvbnRhaW5lckVsLCBcIkdvIGV4ZWN1dGFibGVcIiwgXCJDb21tYW5kIG9yIHBhdGggZm9yIEdvIGJsb2Nrcy5cIiwgXCJnb0V4ZWN1dGFibGVcIik7XG4gICAgdGhpcy5hZGRUZXh0U2V0dGluZyhjb250YWluZXJFbCwgXCJSdXN0IGNvbXBpbGVyXCIsIFwiQ29tbWFuZCBvciBwYXRoIGZvciBjb21waWxpbmcgUnVzdCBibG9ja3MuXCIsIFwicnVzdEV4ZWN1dGFibGVcIik7XG4gICAgdGhpcy5hZGRUZXh0U2V0dGluZyhjb250YWluZXJFbCwgXCJIYXNrZWxsIGV4ZWN1dGFibGVcIiwgXCJDb21tYW5kIG9yIHBhdGggZm9yIEhhc2tlbGwgYmxvY2tzLiBEZWZhdWx0cyB0byBydW5naGMuXCIsIFwiaGFza2VsbEV4ZWN1dGFibGVcIik7XG4gICAgdGhpcy5hZGRUZXh0U2V0dGluZyhjb250YWluZXJFbCwgXCJKYXZhIGNvbXBpbGVyXCIsIFwiT3B0aW9uYWwgY29tbWFuZCBvciBwYXRoIGZvciBqYXZhYy4gTGVhdmUgZW1wdHkgdG8gdXNlIEphdmEgc291cmNlLWZpbGUgbW9kZS5cIiwgXCJqYXZhQ29tcGlsZXJFeGVjdXRhYmxlXCIpO1xuICAgIHRoaXMuYWRkVGV4dFNldHRpbmcoY29udGFpbmVyRWwsIFwiSmF2YSBleGVjdXRhYmxlXCIsIFwiQ29tbWFuZCBvciBwYXRoIGZvciBydW5uaW5nIGNvbXBpbGVkIEphdmEgYmxvY2tzLlwiLCBcImphdmFFeGVjdXRhYmxlXCIpO1xuICAgIHRoaXMuYWRkVGV4dFNldHRpbmcoY29udGFpbmVyRWwsIFwiTExWTSBJUiBpbnRlcnByZXRlclwiLCBcIkNvbW1hbmQgb3IgcGF0aCBmb3IgcnVubmluZyBMTFZNIElSIGJsb2NrcyB3aXRoIGxsaS5cIiwgXCJsbHZtSW50ZXJwcmV0ZXJFeGVjdXRhYmxlXCIpO1xuICAgIHRoaXMuYWRkVGV4dFNldHRpbmcoY29udGFpbmVyRWwsIFwiTGVhbiBleGVjdXRhYmxlXCIsIFwiQ29tbWFuZCBvciBwYXRoIGZvciBjaGVja2luZyBMZWFuIGJsb2Nrcy5cIiwgXCJsZWFuRXhlY3V0YWJsZVwiKTtcbiAgICB0aGlzLmFkZFRleHRTZXR0aW5nKGNvbnRhaW5lckVsLCBcIkNvcSBleGVjdXRhYmxlXCIsIFwiQ29tbWFuZCBvciBwYXRoIGZvciBjaGVja2luZyBDb3EgYmxvY2tzIHdpdGggY29xYy5cIiwgXCJjb3FFeGVjdXRhYmxlXCIpO1xuICAgIHRoaXMuYWRkVGV4dFNldHRpbmcoY29udGFpbmVyRWwsIFwiU01UIHNvbHZlclwiLCBcIkNvbW1hbmQgb3IgcGF0aCBmb3IgU01ULUxJQiBibG9ja3MuIERlZmF1bHRzIHRvIHozLlwiLCBcInNtdEV4ZWN1dGFibGVcIik7XG4gIH1cblxuICBwcml2YXRlIHJlbmRlckN1c3RvbUxhbmd1YWdlcyhjb250YWluZXJFbDogSFRNTEVsZW1lbnQpOiB2b2lkIHtcbiAgICBjb25zdCBsaXN0RWwgPSBjb250YWluZXJFbC5jcmVhdGVEaXYoeyBjbHM6IFwibG9vbS1jdXN0b20tbGFuZ3VhZ2UtbGlzdFwiIH0pO1xuICAgIHRoaXMucmVuZGVyQ3VzdG9tTGFuZ3VhZ2VMaXN0KGxpc3RFbCk7XG5cbiAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgIC5zZXROYW1lKFwiQWRkIGN1c3RvbSBsYW5ndWFnZVwiKVxuICAgICAgLnNldERlc2MoXCJDcmVhdGUgYSBuZXcgbG9jYWwgY29tbWFuZC1iYWNrZWQgbGFuZ3VhZ2UuXCIpXG4gICAgICAuYWRkQnV0dG9uKChidXR0b24pID0+XG4gICAgICAgIGJ1dHRvbi5zZXRCdXR0b25UZXh0KFwiK1wiKS5vbkNsaWNrKGFzeW5jICgpID0+IHtcbiAgICAgICAgICB0aGlzLmxvb21QbHVnaW4uc2V0dGluZ3MuY3VzdG9tTGFuZ3VhZ2VzLnB1c2goe1xuICAgICAgICAgICAgbmFtZTogXCJjdXN0b20tbGFuZ3VhZ2VcIixcbiAgICAgICAgICAgIGFsaWFzZXM6IFwiXCIsXG4gICAgICAgICAgICBleGVjdXRhYmxlOiBcIlwiLFxuICAgICAgICAgICAgYXJnczogXCJ7ZmlsZX1cIixcbiAgICAgICAgICAgIGV4dGVuc2lvbjogXCIudHh0XCIsXG4gICAgICAgICAgfSk7XG4gICAgICAgICAgYXdhaXQgdGhpcy5sb29tUGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgICAgICAgIHRoaXMuZGlzcGxheSgpO1xuICAgICAgICB9KSxcbiAgICAgICk7XG4gIH1cblxuICBwcml2YXRlIHJlbmRlckN1c3RvbUxhbmd1YWdlTGlzdChjb250YWluZXJFbDogSFRNTEVsZW1lbnQpOiB2b2lkIHtcbiAgICBjb250YWluZXJFbC5lbXB0eSgpO1xuXG4gICAgaWYgKCF0aGlzLmxvb21QbHVnaW4uc2V0dGluZ3MuY3VzdG9tTGFuZ3VhZ2VzLmxlbmd0aCkge1xuICAgICAgY29udGFpbmVyRWwuY3JlYXRlRWwoXCJwXCIsIHtcbiAgICAgICAgdGV4dDogXCJObyBjdXN0b20gbGFuZ3VhZ2VzIGNvbmZpZ3VyZWQuXCIsXG4gICAgICAgIGNsczogXCJzZXR0aW5nLWl0ZW0tZGVzY3JpcHRpb25cIixcbiAgICAgIH0pO1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIHRoaXMubG9vbVBsdWdpbi5zZXR0aW5ncy5jdXN0b21MYW5ndWFnZXMuZm9yRWFjaCgobGFuZ3VhZ2UsIGluZGV4KSA9PiB7XG4gICAgICBjb25zdCBkZXRhaWxzID0gY29udGFpbmVyRWwuY3JlYXRlRWwoXCJkZXRhaWxzXCIsIHsgY2xzOiBcImxvb20tY3VzdG9tLWxhbmd1YWdlXCIgfSk7XG4gICAgICBkZXRhaWxzLm9wZW4gPSB0cnVlO1xuICAgICAgZGV0YWlscy5jcmVhdGVFbChcInN1bW1hcnlcIiwgeyB0ZXh0OiBsYW5ndWFnZS5uYW1lIHx8IGBDdXN0b20gbGFuZ3VhZ2UgJHtpbmRleCArIDF9YCB9KTtcbiAgICAgIGNvbnN0IGJvZHkgPSBkZXRhaWxzLmNyZWF0ZURpdih7IGNsczogXCJsb29tLWN1c3RvbS1sYW5ndWFnZS1ib2R5XCIgfSk7XG5cbiAgICAgIHRoaXMuYWRkQ3VzdG9tTGFuZ3VhZ2VUZXh0U2V0dGluZyhib2R5LCBsYW5ndWFnZSwgXCJOYW1lXCIsIFwiTm9ybWFsaXplZCBsYW5ndWFnZSBpZCB1c2VkIGJ5IGxvb20uXCIsIFwibmFtZVwiKTtcbiAgICAgIHRoaXMuYWRkQ3VzdG9tTGFuZ3VhZ2VUZXh0U2V0dGluZyhib2R5LCBsYW5ndWFnZSwgXCJBbGlhc2VzXCIsIFwiQ29tbWEtc2VwYXJhdGVkIGZlbmNlIGFsaWFzZXMuXCIsIFwiYWxpYXNlc1wiKTtcbiAgICAgIHRoaXMuYWRkQ3VzdG9tTGFuZ3VhZ2VUZXh0U2V0dGluZyhib2R5LCBsYW5ndWFnZSwgXCJFeGVjdXRhYmxlXCIsIFwiTG9jYWwgY29tbWFuZCBvciBhYnNvbHV0ZSBleGVjdXRhYmxlIHBhdGguXCIsIFwiZXhlY3V0YWJsZVwiKTtcbiAgICAgIHRoaXMuYWRkQ3VzdG9tTGFuZ3VhZ2VUZXh0U2V0dGluZyhib2R5LCBsYW5ndWFnZSwgXCJBcmd1bWVudHNcIiwgXCJTcGFjZS1zZXBhcmF0ZWQgYXJndW1lbnRzLiBVc2Uge2ZpbGV9IGZvciB0aGUgdGVtcCBzb3VyY2UgZmlsZS5cIiwgXCJhcmdzXCIpO1xuICAgICAgdGhpcy5hZGRDdXN0b21MYW5ndWFnZVRleHRTZXR0aW5nKGJvZHksIGxhbmd1YWdlLCBcIkV4dGVuc2lvblwiLCBcIlRlbXAgc291cmNlIGZpbGUgZXh0ZW5zaW9uLCBmb3IgZXhhbXBsZSAucHkuXCIsIFwiZXh0ZW5zaW9uXCIpO1xuXG4gICAgICBuZXcgU2V0dGluZyhib2R5KVxuICAgICAgICAuc2V0TmFtZShcIkRlbGV0ZSBsYW5ndWFnZVwiKVxuICAgICAgICAuc2V0RGVzYyhcIlJlbW92ZSB0aGlzIGN1c3RvbSBsYW5ndWFnZS5cIilcbiAgICAgICAgLmFkZEJ1dHRvbigoYnV0dG9uKSA9PlxuICAgICAgICAgIGJ1dHRvbi5zZXRCdXR0b25UZXh0KFwiRGVsZXRlXCIpLnNldFdhcm5pbmcoKS5vbkNsaWNrKGFzeW5jICgpID0+IHtcbiAgICAgICAgICAgIHRoaXMubG9vbVBsdWdpbi5zZXR0aW5ncy5jdXN0b21MYW5ndWFnZXMuc3BsaWNlKGluZGV4LCAxKTtcbiAgICAgICAgICAgIGF3YWl0IHRoaXMubG9vbVBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgICAgICAgIHRoaXMuZGlzcGxheSgpO1xuICAgICAgICAgIH0pLFxuICAgICAgICApO1xuICAgIH0pO1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyByZW5kZXJDb250YWluZXJHcm91cHMoY29udGFpbmVyRWw6IEhUTUxFbGVtZW50KTogUHJvbWlzZTx2b2lkPiB7XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IGdyb3VwcyA9IGF3YWl0IHRoaXMubG9vbVBsdWdpbi5nZXRDb250YWluZXJHcm91cFN1bW1hcmllcygpO1xuXG4gICAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgICAgLnNldE5hbWUoXCJEZWZhdWx0IGNvbnRhaW5lcml6YXRpb24gZ3JvdXBcIilcbiAgICAgICAgLnNldERlc2MoXCJUaGUgY29udGFpbmVyIGdyb3VwIHRvIHJ1biBjb2RlIGJsb2NrcyBpbiBieSBkZWZhdWx0IGlmIHRoZSBub3RlIGRvZXMgbm90IHNwZWNpZnkgb25lLlwiKVxuICAgICAgICAuYWRkRHJvcGRvd24oKGRyb3Bkb3duKSA9PiB7XG4gICAgICAgICAgZHJvcGRvd24uYWRkT3B0aW9uKFwiXCIsIFwiTm9uZVwiKTtcbiAgICAgICAgICBmb3IgKGNvbnN0IGdyb3VwIG9mIGdyb3Vwcykge1xuICAgICAgICAgICAgZHJvcGRvd24uYWRkT3B0aW9uKGdyb3VwLm5hbWUsIGdyb3VwLm5hbWUpO1xuICAgICAgICAgIH1cbiAgICAgICAgICBkcm9wZG93bi5zZXRWYWx1ZSh0aGlzLmxvb21QbHVnaW4uc2V0dGluZ3MuZGVmYXVsdENvbnRhaW5lckdyb3VwIHx8IFwiXCIpO1xuICAgICAgICAgIGRyb3Bkb3duLm9uQ2hhbmdlKGFzeW5jICh2YWx1ZSkgPT4ge1xuICAgICAgICAgICAgdGhpcy5sb29tUGx1Z2luLnNldHRpbmdzLmRlZmF1bHRDb250YWluZXJHcm91cCA9IHZhbHVlO1xuICAgICAgICAgICAgYXdhaXQgdGhpcy5sb29tUGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgICAgICAgIH0pO1xuICAgICAgICB9KTtcblxuICAgICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAgIC5zZXROYW1lKFwiQWRkIG5ldyBjb250YWluZXJpemF0aW9uIGdyb3VwXCIpXG4gICAgICAgIC5zZXREZXNjKFwiQ3JlYXRlIGEgbmV3IGNvbnRhaW5lcml6YXRpb24gZ3JvdXAgY29uZmlndXJhdGlvbiBmb2xkZXIuXCIpXG4gICAgICAgIC5hZGRCdXR0b24oKGJ1dHRvbikgPT5cbiAgICAgICAgICBidXR0b24uc2V0QnV0dG9uVGV4dChcIitcIikub25DbGljaygoKSA9PiB7XG4gICAgICAgICAgICBuZXcgQ29udGFpbmVyR3JvdXBOYW1lTW9kYWwodGhpcy5hcHAsIGFzeW5jIChncm91cE5hbWUpID0+IHtcbiAgICAgICAgICAgICAgY29uc3QgY2xlYW5OYW1lID0gZ3JvdXBOYW1lLnRyaW0oKS50b0xvd2VyQ2FzZSgpLnJlcGxhY2UoL1teYS16MC05Xy1dL2csIFwiLVwiKTtcbiAgICAgICAgICAgICAgaWYgKCFjbGVhbk5hbWUpIHtcbiAgICAgICAgICAgICAgICBuZXcgTm90aWNlKFwiSW52YWxpZCBncm91cCBuYW1lLlwiKTtcbiAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICBjb25zdCBwbHVnaW5EaXIgPSB0aGlzLmxvb21QbHVnaW4ubWFuaWZlc3QuZGlyID8/IFwiLm9ic2lkaWFuL3BsdWdpbnMvbG9vbVwiO1xuICAgICAgICAgICAgICBjb25zdCBncm91cFJlbGF0aXZlUGF0aCA9IGAke3BsdWdpbkRpcn0vY29udGFpbmVycy8ke2NsZWFuTmFtZX1gO1xuICAgICAgICAgICAgICBjb25zdCBjb25maWdQYXRoID0gYCR7Z3JvdXBSZWxhdGl2ZVBhdGh9L2NvbmZpZy5qc29uYDtcblxuICAgICAgICAgICAgICBjb25zdCBhZGFwdGVyID0gdGhpcy5hcHAudmF1bHQuYWRhcHRlcjtcbiAgICAgICAgICAgICAgaWYgKGF3YWl0IGFkYXB0ZXIuZXhpc3RzKGdyb3VwUmVsYXRpdmVQYXRoKSkge1xuICAgICAgICAgICAgICAgIG5ldyBOb3RpY2UoXCJDb250YWluZXIgZ3JvdXAgZm9sZGVyIGFscmVhZHkgZXhpc3RzLlwiKTtcbiAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICBhd2FpdCBhZGFwdGVyLm1rZGlyKGdyb3VwUmVsYXRpdmVQYXRoKTtcbiAgICAgICAgICAgICAgY29uc3QgZGVmYXVsdENvbmZpZyA9IHtcbiAgICAgICAgICAgICAgICBydW50aW1lOiBcImRvY2tlclwiLFxuICAgICAgICAgICAgICAgIGltYWdlOiBcInVidW50dTpsYXRlc3RcIixcbiAgICAgICAgICAgICAgICBsYW5ndWFnZXM6IHtcbiAgICAgICAgICAgICAgICAgIHB5dGhvbjoge1xuICAgICAgICAgICAgICAgICAgICBjb21tYW5kOiBcInB5dGhvbjMge2ZpbGV9XCIsXG4gICAgICAgICAgICAgICAgICAgIGV4dGVuc2lvbjogXCIucHlcIlxuICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgfTtcbiAgICAgICAgICAgICAgYXdhaXQgYWRhcHRlci53cml0ZShjb25maWdQYXRoLCBKU09OLnN0cmluZ2lmeShkZWZhdWx0Q29uZmlnLCBudWxsLCAyKSk7XG4gICAgICAgICAgICAgIG5ldyBOb3RpY2UoYENvbnRhaW5lciBncm91cCBcIiR7Y2xlYW5OYW1lfVwiIGNyZWF0ZWQuYCk7XG4gICAgICAgICAgICAgIHRoaXMuZGlzcGxheSgpO1xuICAgICAgICAgICAgfSkub3BlbigpO1xuICAgICAgICAgIH0pLFxuICAgICAgICApO1xuXG4gICAgICBjb25zdCBsaXN0RWwgPSBjb250YWluZXJFbC5jcmVhdGVEaXYoeyBjbHM6IFwibG9vbS1jb250YWluZXItZ3JvdXAtbGlzdFwiIH0pO1xuICAgICAgaWYgKCFncm91cHMubGVuZ3RoKSB7XG4gICAgICAgIGxpc3RFbC5jcmVhdGVFbChcInBcIiwge1xuICAgICAgICAgIHRleHQ6IFwiTm8gY29udGFpbmVyIGdyb3VwcyBmb3VuZCBpbiAub2JzaWRpYW4vcGx1Z2lucy9sb29tL2NvbnRhaW5lcnMuXCIsXG4gICAgICAgICAgY2xzOiBcInNldHRpbmctaXRlbS1kZXNjcmlwdGlvblwiLFxuICAgICAgICB9KTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuXG4gICAgICBmb3IgKGNvbnN0IGdyb3VwIG9mIGdyb3Vwcykge1xuICAgICAgICBuZXcgU2V0dGluZyhsaXN0RWwpXG4gICAgICAgICAgLnNldE5hbWUoZ3JvdXAubmFtZSlcbiAgICAgICAgICAuc2V0RGVzYyhncm91cC5zdGF0dXMpXG4gICAgICAgICAgLmFkZEJ1dHRvbigoYnV0dG9uKSA9PlxuICAgICAgICAgICAgYnV0dG9uLnNldEJ1dHRvblRleHQoXCJCdWlsZCAvIHJlYnVpbGRcIikub25DbGljayhhc3luYyAoKSA9PiB7XG4gICAgICAgICAgICAgIGF3YWl0IHRoaXMubG9vbVBsdWdpbi5idWlsZENvbnRhaW5lckdyb3VwKGdyb3VwLm5hbWUpO1xuICAgICAgICAgICAgfSksXG4gICAgICAgICAgKVxuICAgICAgICAgIC5hZGRCdXR0b24oKGJ1dHRvbikgPT5cbiAgICAgICAgICAgIGJ1dHRvbi5zZXRCdXR0b25UZXh0KFwiRWRpdFwiKS5vbkNsaWNrKCgpID0+IHtcbiAgICAgICAgICAgICAgY29uc3QgcGx1Z2luRGlyID0gdGhpcy5sb29tUGx1Z2luLm1hbmlmZXN0LmRpciA/PyBcIi5vYnNpZGlhbi9wbHVnaW5zL2xvb21cIjtcbiAgICAgICAgICAgICAgbmV3IEVkaXRDb250YWluZXJHcm91cE1vZGFsKHRoaXMubG9vbVBsdWdpbiwgZ3JvdXAubmFtZSwgcGx1Z2luRGlyLCAoKSA9PiB7XG4gICAgICAgICAgICAgICAgdGhpcy5kaXNwbGF5KCk7XG4gICAgICAgICAgICAgIH0pLm9wZW4oKTtcbiAgICAgICAgICAgIH0pLFxuICAgICAgICAgICk7XG4gICAgICB9XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGNvbnRhaW5lckVsLmVtcHR5KCk7XG4gICAgICBjb250YWluZXJFbC5jcmVhdGVFbChcInBcIiwge1xuICAgICAgICB0ZXh0OiBgRXJyb3IgbG9hZGluZyBjb250YWluZXIgZ3JvdXBzOiAke2Vycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogU3RyaW5nKGVycm9yKX1gLFxuICAgICAgICBjbHM6IFwibG9vbS1zZXR0aW5ncy1lcnJvclwiLFxuICAgICAgICBhdHRyOiB7IHN0eWxlOiBcImNvbG9yOiB2YXIoLS10ZXh0LWVycm9yKTsgZm9udC13ZWlnaHQ6IGJvbGQ7IG1hcmdpbjogMWVtIDA7XCIgfVxuICAgICAgfSk7XG4gICAgICBjb25zb2xlLmVycm9yKFwibG9vbTogZmFpbGVkIHRvIHJlbmRlciBjb250YWluZXIgZ3JvdXBzOlwiLCBlcnJvcik7XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBhZGRUZXh0U2V0dGluZzxLIGV4dGVuZHMga2V5b2YgbG9vbVBsdWdpblNldHRpbmdzPihjb250YWluZXJFbDogSFRNTEVsZW1lbnQsIG5hbWU6IHN0cmluZywgZGVzY3JpcHRpb246IHN0cmluZywga2V5OiBLKTogdm9pZCB7XG4gICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAuc2V0TmFtZShuYW1lKVxuICAgICAgLnNldERlc2MoZGVzY3JpcHRpb24pXG4gICAgICAuYWRkVGV4dCgodGV4dCkgPT5cbiAgICAgICAgdGV4dC5zZXRWYWx1ZShTdHJpbmcodGhpcy5sb29tUGx1Z2luLnNldHRpbmdzW2tleV0gPz8gXCJcIikpLm9uQ2hhbmdlKGFzeW5jICh2YWx1ZSkgPT4ge1xuICAgICAgICAgICh0aGlzLmxvb21QbHVnaW4uc2V0dGluZ3Nba2V5XSBhcyBzdHJpbmcpID0gdmFsdWUudHJpbSgpO1xuICAgICAgICAgIGF3YWl0IHRoaXMubG9vbVBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgICAgfSksXG4gICAgICApO1xuICB9XG5cbiAgcHJpdmF0ZSBhZGRDdXN0b21MYW5ndWFnZVRleHRTZXR0aW5nPEsgZXh0ZW5kcyBrZXlvZiBsb29tQ3VzdG9tTGFuZ3VhZ2U+KFxuICAgIGNvbnRhaW5lckVsOiBIVE1MRWxlbWVudCxcbiAgICBsYW5ndWFnZTogbG9vbUN1c3RvbUxhbmd1YWdlLFxuICAgIG5hbWU6IHN0cmluZyxcbiAgICBkZXNjcmlwdGlvbjogc3RyaW5nLFxuICAgIGtleTogSyxcbiAgKTogdm9pZCB7XG4gICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAuc2V0TmFtZShuYW1lKVxuICAgICAgLnNldERlc2MoZGVzY3JpcHRpb24pXG4gICAgICAuYWRkVGV4dCgodGV4dCkgPT5cbiAgICAgICAgdGV4dC5zZXRWYWx1ZShsYW5ndWFnZVtrZXldKS5vbkNoYW5nZShhc3luYyAodmFsdWUpID0+IHtcbiAgICAgICAgICBsYW5ndWFnZVtrZXldID0gdmFsdWUudHJpbSgpO1xuICAgICAgICAgIGF3YWl0IHRoaXMubG9vbVBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgICAgfSksXG4gICAgICApO1xuICB9XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBzaG93RXhlY3V0aW9uRGlzYWJsZWROb3RpY2UoKTogdm9pZCB7XG4gIG5ldyBOb3RpY2UoXCJsb29tIGxvY2FsIGV4ZWN1dGlvbiBpcyBkaXNhYmxlZC4gRW5hYmxlIGl0IGluIHNldHRpbmdzIG9yIGNvbmZpcm0gdGhlIGV4ZWN1dGlvbiB3YXJuaW5nIGZpcnN0LlwiKTtcbn1cblxuY2xhc3MgQ29udGFpbmVyR3JvdXBOYW1lTW9kYWwgZXh0ZW5kcyBNb2RhbCB7XG4gIHByaXZhdGUgbmFtZSA9IFwiXCI7XG5cbiAgY29uc3RydWN0b3IoXG4gICAgYXBwOiBBcHAsXG4gICAgcHJpdmF0ZSByZWFkb25seSBvblN1Ym1pdDogKG5hbWU6IHN0cmluZykgPT4gUHJvbWlzZTx2b2lkPixcbiAgKSB7XG4gICAgc3VwZXIoYXBwKTtcbiAgfVxuXG4gIG9uT3BlbigpIHtcbiAgICBjb25zdCB7IGNvbnRlbnRFbCB9ID0gdGhpcztcbiAgICBjb250ZW50RWwuZW1wdHkoKTtcbiAgICBjb250ZW50RWwuY3JlYXRlRWwoXCJoMlwiLCB7IHRleHQ6IFwiTmV3IENvbnRhaW5lciBHcm91cCBOYW1lXCIgfSk7XG5cbiAgICBuZXcgU2V0dGluZyhjb250ZW50RWwpXG4gICAgICAuc2V0TmFtZShcIkdyb3VwIE5hbWVcIilcbiAgICAgIC5zZXREZXNjKFwiVXNlIGxvd2VyY2FzZSBsZXR0ZXJzLCBudW1iZXJzLCBoeXBoZW5zLCBhbmQgdW5kZXJzY29yZXMuXCIpXG4gICAgICAuYWRkVGV4dCgodGV4dCkgPT5cbiAgICAgICAgdGV4dC5vbkNoYW5nZSgodmFsdWUpID0+IHtcbiAgICAgICAgICB0aGlzLm5hbWUgPSB2YWx1ZTtcbiAgICAgICAgfSksXG4gICAgICApO1xuXG4gICAgbmV3IFNldHRpbmcoY29udGVudEVsKVxuICAgICAgLmFkZEJ1dHRvbigoYnRuKSA9PlxuICAgICAgICBidG5cbiAgICAgICAgICAuc2V0QnV0dG9uVGV4dChcIkNyZWF0ZVwiKVxuICAgICAgICAgIC5zZXRDdGEoKVxuICAgICAgICAgIC5vbkNsaWNrKGFzeW5jICgpID0+IHtcbiAgICAgICAgICAgIGF3YWl0IHRoaXMub25TdWJtaXQodGhpcy5uYW1lKTtcbiAgICAgICAgICAgIHRoaXMuY2xvc2UoKTtcbiAgICAgICAgICB9KSxcbiAgICAgICk7XG4gIH1cbn1cblxuY2xhc3MgRWRpdENvbnRhaW5lckdyb3VwTW9kYWwgZXh0ZW5kcyBNb2RhbCB7XG4gIHByaXZhdGUgYWN0aXZlVGFiOiBcImdlbmVyYWxcIiB8IFwibGFuZ3VhZ2VzXCIgfCBcImRvY2tlcmZpbGVcIiB8IFwicmF3XCIgPSBcImdlbmVyYWxcIjtcbiAgcHJpdmF0ZSBjb25maWdPYmo6IGFueSA9IHt9O1xuICBwcml2YXRlIHJhd0pzb25UZXh0ID0gXCJcIjtcbiAgcHJpdmF0ZSBkb2NrZXJmaWxlVGV4dDogc3RyaW5nIHwgbnVsbCA9IG51bGw7XG4gIHByaXZhdGUgbmV3TGFuZ3VhZ2VOYW1lID0gXCJcIjtcbiAgcHJpdmF0ZSB0YWJIZWFkZXJFbCE6IEhUTUxFbGVtZW50O1xuICBwcml2YXRlIHRhYkNvbnRlbnRFbCE6IEhUTUxFbGVtZW50O1xuXG4gIGNvbnN0cnVjdG9yKFxuICAgIHByaXZhdGUgcmVhZG9ubHkgbG9vbVBsdWdpbjogbG9vbVBsdWdpbixcbiAgICBwcml2YXRlIHJlYWRvbmx5IGdyb3VwTmFtZTogc3RyaW5nLFxuICAgIHByaXZhdGUgcmVhZG9ubHkgcGx1Z2luRGlyOiBzdHJpbmcsXG4gICAgcHJpdmF0ZSByZWFkb25seSBvblNhdmU6ICgpID0+IHZvaWRcbiAgKSB7XG4gICAgc3VwZXIobG9vbVBsdWdpbi5hcHApO1xuICB9XG5cbiAgYXN5bmMgb25PcGVuKCkge1xuICAgIGNvbnN0IHsgY29udGVudEVsIH0gPSB0aGlzO1xuICAgIGNvbnRlbnRFbC5lbXB0eSgpO1xuICAgIGNvbnRlbnRFbC5jcmVhdGVFbChcImgyXCIsIHsgdGV4dDogYEVkaXQgQ29uZmlnOiAke3RoaXMuZ3JvdXBOYW1lfWAgfSk7XG5cbiAgICBjb25zdCBjb25maWdQYXRoID0gYCR7dGhpcy5wbHVnaW5EaXJ9L2NvbnRhaW5lcnMvJHt0aGlzLmdyb3VwTmFtZX0vY29uZmlnLmpzb25gO1xuICAgIGNvbnN0IGRvY2tlcmZpbGVQYXRoID0gYCR7dGhpcy5wbHVnaW5EaXJ9L2NvbnRhaW5lcnMvJHt0aGlzLmdyb3VwTmFtZX0vRG9ja2VyZmlsZWA7XG4gICAgY29uc3QgYWRhcHRlciA9IHRoaXMuYXBwLnZhdWx0LmFkYXB0ZXI7XG5cbiAgICB0cnkge1xuICAgICAgY29uc3QgcmF3Q29uZmlnID0gYXdhaXQgYWRhcHRlci5yZWFkKGNvbmZpZ1BhdGgpO1xuICAgICAgdGhpcy5jb25maWdPYmogPSBKU09OLnBhcnNlKHJhd0NvbmZpZyk7XG4gICAgICB0aGlzLnJhd0pzb25UZXh0ID0gcmF3Q29uZmlnO1xuICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgIG5ldyBOb3RpY2UoXCJDb3VsZCBub3QgcmVhZCBjb25maWd1cmF0aW9uIGZpbGUuXCIpO1xuICAgICAgdGhpcy5jbG9zZSgpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIHRyeSB7XG4gICAgICBpZiAoYXdhaXQgYWRhcHRlci5leGlzdHMoZG9ja2VyZmlsZVBhdGgpKSB7XG4gICAgICAgIHRoaXMuZG9ja2VyZmlsZVRleHQgPSBhd2FpdCBhZGFwdGVyLnJlYWQoZG9ja2VyZmlsZVBhdGgpO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgdGhpcy5kb2NrZXJmaWxlVGV4dCA9IG51bGw7XG4gICAgICB9XG4gICAgfSBjYXRjaCAoZSkge1xuICAgICAgdGhpcy5kb2NrZXJmaWxlVGV4dCA9IG51bGw7XG4gICAgfVxuXG4gICAgY29uc3QgY29udGFpbmVyID0gY29udGVudEVsLmNyZWF0ZURpdih7IGNsczogXCJsb29tLXRhYi1jb250YWluZXJcIiB9KTtcblxuICAgIC8vIFJlbmRlciBUYWIgSGVhZGVyXG4gICAgdGhpcy50YWJIZWFkZXJFbCA9IGNvbnRhaW5lci5jcmVhdGVEaXYoeyBjbHM6IFwibG9vbS10YWItaGVhZGVyXCIgfSk7XG4gICAgdGhpcy5yZW5kZXJUYWJzKCk7XG5cbiAgICAvLyBSZW5kZXIgVGFiIENvbnRlbnQgQXJlYVxuICAgIHRoaXMudGFiQ29udGVudEVsID0gY29udGFpbmVyLmNyZWF0ZURpdih7IGNsczogXCJsb29tLXRhYi1jb250ZW50XCIgfSk7XG5cbiAgICAvLyBSZW5kZXIgQWN0aW9ucyBGb290ZXJcbiAgICBjb25zdCBhY3Rpb25zID0gY29udGVudEVsLmNyZWF0ZURpdih7IGNsczogXCJsb29tLW1vZGFsLWFjdGlvbnNcIiB9KTtcbiAgICBhY3Rpb25zLmNyZWF0ZUVsKFwiYnV0dG9uXCIsIHsgdGV4dDogXCJDYW5jZWxcIiB9KS5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKCkgPT4gdGhpcy5jbG9zZSgpKTtcbiAgICBjb25zdCBzYXZlQnRuID0gYWN0aW9ucy5jcmVhdGVFbChcImJ1dHRvblwiLCB7IHRleHQ6IFwiU2F2ZVwiLCBjbHM6IFwibW9kLWN0YVwiIH0pO1xuICAgIHNhdmVCdG4uYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsIGFzeW5jICgpID0+IHtcbiAgICAgIGF3YWl0IHRoaXMuc2F2ZUFuZENsb3NlKCk7XG4gICAgfSk7XG5cbiAgICB0aGlzLnJlbmRlckFjdGl2ZVRhYigpO1xuICB9XG5cbiAgcmVuZGVyVGFicygpIHtcbiAgICB0aGlzLnRhYkhlYWRlckVsLmVtcHR5KCk7XG4gICAgY29uc3QgdGFiczogQXJyYXk8eyBpZDogXCJnZW5lcmFsXCIgfCBcImxhbmd1YWdlc1wiIHwgXCJkb2NrZXJmaWxlXCIgfCBcInJhd1wiOyBsYWJlbDogc3RyaW5nIH0+ID0gW1xuICAgICAgeyBpZDogXCJnZW5lcmFsXCIsIGxhYmVsOiBcIkdlbmVyYWxcIiB9LFxuICAgICAgeyBpZDogXCJsYW5ndWFnZXNcIiwgbGFiZWw6IFwiTGFuZ3VhZ2VzXCIgfSxcbiAgICAgIHsgaWQ6IFwiZG9ja2VyZmlsZVwiLCBsYWJlbDogXCJEb2NrZXJmaWxlXCIgfSxcbiAgICAgIHsgaWQ6IFwicmF3XCIsIGxhYmVsOiBcIlJhdyBKU09OXCIgfSxcbiAgICBdO1xuXG4gICAgZm9yIChjb25zdCB0YWIgb2YgdGFicykge1xuICAgICAgY29uc3QgYnRuID0gdGhpcy50YWJIZWFkZXJFbC5jcmVhdGVFbChcImJ1dHRvblwiLCB7XG4gICAgICAgIHRleHQ6IHRhYi5sYWJlbCxcbiAgICAgICAgY2xzOiBcImxvb20tdGFiLWJ0blwiICsgKHRoaXMuYWN0aXZlVGFiID09PSB0YWIuaWQgPyBcIiBpcy1hY3RpdmVcIiA6IFwiXCIpLFxuICAgICAgfSk7XG4gICAgICBidG4uYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsICgpID0+IHtcbiAgICAgICAgdm9pZCB0aGlzLnN3aXRjaFRhYih0YWIuaWQpO1xuICAgICAgfSk7XG4gICAgfVxuICB9XG5cbiAgYXN5bmMgc3dpdGNoVGFiKHRhYjogXCJnZW5lcmFsXCIgfCBcImxhbmd1YWdlc1wiIHwgXCJkb2NrZXJmaWxlXCIgfCBcInJhd1wiKSB7XG4gICAgaWYgKHRoaXMuYWN0aXZlVGFiID09PSBcInJhd1wiKSB7XG4gICAgICB0cnkge1xuICAgICAgICB0aGlzLmNvbmZpZ09iaiA9IEpTT04ucGFyc2UodGhpcy5yYXdKc29uVGV4dCk7XG4gICAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgIG5ldyBOb3RpY2UoXCJJbnZhbGlkIEpTT04gc3ludGF4IGluIFJhdyBKU09OIHRhYi4gUGxlYXNlIGZpeCBpdCBiZWZvcmUgc3dpdGNoaW5nLlwiKTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuICAgIH1cbiAgICB0aGlzLmFjdGl2ZVRhYiA9IHRhYjtcbiAgICB0aGlzLnJlbmRlclRhYnMoKTtcbiAgICB0aGlzLnJlbmRlckFjdGl2ZVRhYigpO1xuICB9XG5cbiAgcmVuZGVyQWN0aXZlVGFiKCkge1xuICAgIHRoaXMudGFiQ29udGVudEVsLmVtcHR5KCk7XG4gICAgaWYgKHRoaXMuYWN0aXZlVGFiID09PSBcImdlbmVyYWxcIikge1xuICAgICAgdGhpcy5yZW5kZXJHZW5lcmFsVGFiKHRoaXMudGFiQ29udGVudEVsKTtcbiAgICB9IGVsc2UgaWYgKHRoaXMuYWN0aXZlVGFiID09PSBcImxhbmd1YWdlc1wiKSB7XG4gICAgICB0aGlzLnJlbmRlckxhbmd1YWdlc1RhYih0aGlzLnRhYkNvbnRlbnRFbCk7XG4gICAgfSBlbHNlIGlmICh0aGlzLmFjdGl2ZVRhYiA9PT0gXCJkb2NrZXJmaWxlXCIpIHtcbiAgICAgIHRoaXMucmVuZGVyRG9ja2VyZmlsZVRhYih0aGlzLnRhYkNvbnRlbnRFbCk7XG4gICAgfSBlbHNlIGlmICh0aGlzLmFjdGl2ZVRhYiA9PT0gXCJyYXdcIikge1xuICAgICAgdGhpcy5yZW5kZXJSYXdUYWIodGhpcy50YWJDb250ZW50RWwpO1xuICAgIH1cbiAgfVxuXG4gIHJlbmRlckdlbmVyYWxUYWIoY29udGFpbmVyRWw6IEhUTUxFbGVtZW50KSB7XG4gICAgLy8gUnVudGltZSBzZWxlY3QgZHJvcGRvd25cbiAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgIC5zZXROYW1lKFwiUnVudGltZVwiKVxuICAgICAgLnNldERlc2MoXCJDaG9vc2UgdGhlIGNvbnRhaW5lci9lbnZpcm9ubWVudCBtYW5hZ2VyIHJ1bnRpbWUuXCIpXG4gICAgICAuYWRkRHJvcGRvd24oKGRyb3Bkb3duKSA9PiB7XG4gICAgICAgIGRyb3Bkb3duXG4gICAgICAgICAgLmFkZE9wdGlvbihcImRvY2tlclwiLCBcIkRvY2tlclwiKVxuICAgICAgICAgIC5hZGRPcHRpb24oXCJwb2RtYW5cIiwgXCJQb2RtYW5cIilcbiAgICAgICAgICAuYWRkT3B0aW9uKFwid3NsXCIsIFwiV1NMXCIpXG4gICAgICAgICAgLmFkZE9wdGlvbihcInFlbXVcIiwgXCJRRU1VXCIpXG4gICAgICAgICAgLmFkZE9wdGlvbihcImN1c3RvbVwiLCBcIkN1c3RvbVwiKVxuICAgICAgICAgIC5zZXRWYWx1ZSh0aGlzLmNvbmZpZ09iai5ydW50aW1lIHx8IFwiZG9ja2VyXCIpXG4gICAgICAgICAgLm9uQ2hhbmdlKCh2YWx1ZSkgPT4ge1xuICAgICAgICAgICAgdGhpcy5jb25maWdPYmoucnVudGltZSA9IHZhbHVlO1xuICAgICAgICAgICAgdGhpcy5yZW5kZXJBY3RpdmVUYWIoKTtcbiAgICAgICAgICB9KTtcbiAgICAgIH0pO1xuXG4gICAgLy8gQ29uZGl0aW9uYWwgaW1hZ2UvZGlzdHJvIG5hbWVcbiAgICBpZiAoXG4gICAgICB0aGlzLmNvbmZpZ09iai5ydW50aW1lID09PSBcImRvY2tlclwiIHx8XG4gICAgICB0aGlzLmNvbmZpZ09iai5ydW50aW1lID09PSBcInBvZG1hblwiIHx8XG4gICAgICB0aGlzLmNvbmZpZ09iai5ydW50aW1lID09PSBcIndzbFwiXG4gICAgKSB7XG4gICAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgICAgLnNldE5hbWUodGhpcy5jb25maWdPYmoucnVudGltZSA9PT0gXCJ3c2xcIiA/IFwiV1NMIERpc3Ryb1wiIDogXCJCYXNlIEltYWdlXCIpXG4gICAgICAgIC5zZXREZXNjKFxuICAgICAgICAgIHRoaXMuY29uZmlnT2JqLnJ1bnRpbWUgPT09IFwid3NsXCJcbiAgICAgICAgICAgID8gXCJPcHRpb25hbC4gVGhlIHRhcmdldCBXU0wgZGlzdHJvIG5hbWUgKGxlYXZlIGVtcHR5IGZvciBkZWZhdWx0IGRpc3RybykuXCJcbiAgICAgICAgICAgIDogXCJGYWxsYmFjayBEb2NrZXIvUG9kbWFuIGltYWdlIGlmIG5vIERvY2tlcmZpbGUgaXMgcHJlc2VudC5cIlxuICAgICAgICApXG4gICAgICAgIC5hZGRUZXh0KCh0ZXh0KSA9PiB7XG4gICAgICAgICAgdGV4dFxuICAgICAgICAgICAgLnNldFZhbHVlKHRoaXMuY29uZmlnT2JqLmltYWdlIHx8IFwiXCIpXG4gICAgICAgICAgICAub25DaGFuZ2UoKHZhbCkgPT4ge1xuICAgICAgICAgICAgICB0aGlzLmNvbmZpZ09iai5pbWFnZSA9IHZhbC50cmltKCk7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgaWYgKHRoaXMuY29uZmlnT2JqLnJ1bnRpbWUgPT09IFwid3NsXCIpIHtcbiAgICAgIGlmICghdGhpcy5jb25maWdPYmoud3NsKSB7XG4gICAgICAgIHRoaXMuY29uZmlnT2JqLndzbCA9IHt9O1xuICAgICAgfVxuICAgICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAgIC5zZXROYW1lKFwiVXNlIEludGVyYWN0aXZlIFNoZWxsXCIpXG4gICAgICAgIC5zZXREZXNjKFwiVXNlIGludGVyYWN0aXZlIGxvZ2luIHNoZWxsIGZsYWdzICgtaSAtbCkgdG8gZW5zdXJlIH4vLmJhc2hyYyBpbml0aWFsaXphdGlvbiB3b3JrcyAoZS5nLiwgZm9yIE5WTSkuXCIpXG4gICAgICAgIC5hZGRUb2dnbGUoKHRvZ2dsZSkgPT4ge1xuICAgICAgICAgIHRvZ2dsZVxuICAgICAgICAgICAgLnNldFZhbHVlKHRoaXMuY29uZmlnT2JqLndzbC5pbnRlcmFjdGl2ZSA/PyBmYWxzZSlcbiAgICAgICAgICAgIC5vbkNoYW5nZSgodmFsKSA9PiB7XG4gICAgICAgICAgICAgIHRoaXMuY29uZmlnT2JqLndzbC5pbnRlcmFjdGl2ZSA9IHZhbDtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICAvLyBDb25kaXRpb25hbCBRRU1VIFNldHRpbmdzXG4gICAgaWYgKHRoaXMuY29uZmlnT2JqLnJ1bnRpbWUgPT09IFwicWVtdVwiKSB7XG4gICAgICBpZiAoIXRoaXMuY29uZmlnT2JqLnFlbXUpIHtcbiAgICAgICAgdGhpcy5jb25maWdPYmoucWVtdSA9IHsgc3NoVGFyZ2V0OiBcIlwiLCByZW1vdGVXb3Jrc3BhY2U6IFwiXCIgfTtcbiAgICAgIH1cblxuICAgICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAgIC5zZXROYW1lKFwiU1NIIFRhcmdldFwiKVxuICAgICAgICAuc2V0RGVzYyhcIlNTSCB0YXJnZXQgYWRkcmVzcyAoZS5nLiB1c2VyQGhvc3RuYW1lIG9yIGxvY2FsaG9zdCAtcCAyMjIyKS5cIilcbiAgICAgICAgLmFkZFRleHQoKHRleHQpID0+IHtcbiAgICAgICAgICB0ZXh0XG4gICAgICAgICAgICAuc2V0VmFsdWUodGhpcy5jb25maWdPYmoucWVtdS5zc2hUYXJnZXQgfHwgXCJcIilcbiAgICAgICAgICAgIC5vbkNoYW5nZSgodmFsKSA9PiB7XG4gICAgICAgICAgICAgIHRoaXMuY29uZmlnT2JqLnFlbXUuc3NoVGFyZ2V0ID0gdmFsLnRyaW0oKTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9KTtcblxuICAgICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAgIC5zZXROYW1lKFwiUmVtb3RlIFdvcmtzcGFjZVwiKVxuICAgICAgICAuc2V0RGVzYyhcIlJlbW90ZSBmb2xkZXIgcGF0aCB0byBjb3B5IGNvZGUgc25pcHBldHMgYW5kIHJ1biBjb21tYW5kcyAoZS5nLiwgL2hvbWUvdXNlci93b3Jrc3BhY2UpLlwiKVxuICAgICAgICAuYWRkVGV4dCgodGV4dCkgPT4ge1xuICAgICAgICAgIHRleHRcbiAgICAgICAgICAgIC5zZXRWYWx1ZSh0aGlzLmNvbmZpZ09iai5xZW11LnJlbW90ZVdvcmtzcGFjZSB8fCBcIlwiKVxuICAgICAgICAgICAgLm9uQ2hhbmdlKCh2YWwpID0+IHtcbiAgICAgICAgICAgICAgdGhpcy5jb25maWdPYmoucWVtdS5yZW1vdGVXb3Jrc3BhY2UgPSB2YWwudHJpbSgpO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgIH0pO1xuXG4gICAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgICAgLnNldE5hbWUoXCJTU0ggRXhlY3V0YWJsZVwiKVxuICAgICAgICAuc2V0RGVzYyhcIk9wdGlvbmFsLiBQYXRoIHRvIFNTSCBjbGllbnQgZXhlY3V0YWJsZSAoZGVmYXVsdHMgdG8gc3NoKS5cIilcbiAgICAgICAgLmFkZFRleHQoKHRleHQpID0+IHtcbiAgICAgICAgICB0ZXh0XG4gICAgICAgICAgICAuc2V0VmFsdWUodGhpcy5jb25maWdPYmoucWVtdS5zc2hFeGVjdXRhYmxlIHx8IFwiXCIpXG4gICAgICAgICAgICAub25DaGFuZ2UoKHZhbCkgPT4ge1xuICAgICAgICAgICAgICB0aGlzLmNvbmZpZ09iai5xZW11LnNzaEV4ZWN1dGFibGUgPSB2YWwudHJpbSgpIHx8IHVuZGVmaW5lZDtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9KTtcblxuICAgICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAgIC5zZXROYW1lKFwiU1NIIEFyZ3VtZW50c1wiKVxuICAgICAgICAuc2V0RGVzYyhcIk9wdGlvbmFsLiBBZGRpdGlvbmFsIFNTSCBDTEkgZmxhZ3MuXCIpXG4gICAgICAgIC5hZGRUZXh0KCh0ZXh0KSA9PiB7XG4gICAgICAgICAgdGV4dFxuICAgICAgICAgICAgLnNldFZhbHVlKHRoaXMuY29uZmlnT2JqLnFlbXUuc3NoQXJncyB8fCBcIlwiKVxuICAgICAgICAgICAgLm9uQ2hhbmdlKCh2YWwpID0+IHtcbiAgICAgICAgICAgICAgdGhpcy5jb25maWdPYmoucWVtdS5zc2hBcmdzID0gdmFsLnRyaW0oKSB8fCB1bmRlZmluZWQ7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgLy8gQ29uZGl0aW9uYWwgQ3VzdG9tIFNldHRpbmdzXG4gICAgaWYgKHRoaXMuY29uZmlnT2JqLnJ1bnRpbWUgPT09IFwiY3VzdG9tXCIpIHtcbiAgICAgIGlmICghdGhpcy5jb25maWdPYmouY3VzdG9tKSB7XG4gICAgICAgIHRoaXMuY29uZmlnT2JqLmN1c3RvbSA9IHsgZXhlY3V0YWJsZTogXCJcIiB9O1xuICAgICAgfVxuXG4gICAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgICAgLnNldE5hbWUoXCJDdXN0b20gRXhlY3V0YWJsZVwiKVxuICAgICAgICAuc2V0RGVzYyhcIlBhdGggdG8gY3VzdG9tIHJ1bnRpbWUgd3JhcHBlciBleGVjdXRhYmxlIG9yIHNjcmlwdC5cIilcbiAgICAgICAgLmFkZFRleHQoKHRleHQpID0+IHtcbiAgICAgICAgICB0ZXh0XG4gICAgICAgICAgICAuc2V0VmFsdWUodGhpcy5jb25maWdPYmouY3VzdG9tLmV4ZWN1dGFibGUgfHwgXCJcIilcbiAgICAgICAgICAgIC5vbkNoYW5nZSgodmFsKSA9PiB7XG4gICAgICAgICAgICAgIHRoaXMuY29uZmlnT2JqLmN1c3RvbS5leGVjdXRhYmxlID0gdmFsLnRyaW0oKTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9KTtcblxuICAgICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAgIC5zZXROYW1lKFwiQ3VzdG9tIEFyZ3VtZW50c1wiKVxuICAgICAgICAuc2V0RGVzYyhcIk9wdGlvbmFsLiBDb21tYW5kIGFyZ3VtZW50cy4gVXNlIHtyZXF1ZXN0fSBmb3IgSlNPTiBjb25maWcgcGF0aC5cIilcbiAgICAgICAgLmFkZFRleHQoKHRleHQpID0+IHtcbiAgICAgICAgICB0ZXh0XG4gICAgICAgICAgICAuc2V0VmFsdWUodGhpcy5jb25maWdPYmouY3VzdG9tLmFyZ3MgfHwgXCJcIilcbiAgICAgICAgICAgIC5vbkNoYW5nZSgodmFsKSA9PiB7XG4gICAgICAgICAgICAgIHRoaXMuY29uZmlnT2JqLmN1c3RvbS5hcmdzID0gdmFsLnRyaW0oKSB8fCB1bmRlZmluZWQ7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfSk7XG4gICAgfVxuICB9XG5cbiAgcmVuZGVyTGFuZ3VhZ2VzVGFiKGNvbnRhaW5lckVsOiBIVE1MRWxlbWVudCkge1xuICAgIGNvbnRhaW5lckVsLmNyZWF0ZUVsKFwiaDNcIiwgeyB0ZXh0OiBcIkNvbmZpZ3VyZWQgTGFuZ3VhZ2VzXCIgfSk7XG5cbiAgICBpZiAoIXRoaXMuY29uZmlnT2JqLmxhbmd1YWdlcykge1xuICAgICAgdGhpcy5jb25maWdPYmoubGFuZ3VhZ2VzID0ge307XG4gICAgfVxuXG4gICAgY29uc3QgbGFuZ3NMaXN0RWwgPSBjb250YWluZXJFbC5jcmVhdGVEaXYoeyBjbHM6IFwibG9vbS1sYW5ndWFnZXMtbGlzdFwiIH0pO1xuICAgIGNvbnN0IGxhbmd1YWdlcyA9IE9iamVjdC5lbnRyaWVzKHRoaXMuY29uZmlnT2JqLmxhbmd1YWdlcyBhcyBSZWNvcmQ8c3RyaW5nLCB7IGNvbW1hbmQ/OiBzdHJpbmc7IGV4dGVuc2lvbj86IHN0cmluZzsgdXNlRGVmYXVsdD86IGJvb2xlYW4gfT4pO1xuXG4gICAgaWYgKGxhbmd1YWdlcy5sZW5ndGggPT09IDApIHtcbiAgICAgIGxhbmdzTGlzdEVsLmNyZWF0ZUVsKFwicFwiLCB7IHRleHQ6IFwiTm8gbGFuZ3VhZ2VzIGNvbmZpZ3VyZWQgZm9yIHRoaXMgZ3JvdXAuXCIsIGNsczogXCJzZXR0aW5nLWl0ZW0tZGVzY3JpcHRpb25cIiB9KTtcbiAgICB9IGVsc2Uge1xuICAgICAgZm9yIChjb25zdCBbbGFuZ05hbWUsIGxhbmdDb25maWddIG9mIGxhbmd1YWdlcykge1xuICAgICAgICBjb25zdCBjYXJkID0gbGFuZ3NMaXN0RWwuY3JlYXRlRGl2KHsgY2xzOiBcImxvb20tbGFuZ3VhZ2UtY2FyZFwiIH0pO1xuICAgICAgICBjYXJkLmNyZWF0ZUVsKFwic3Ryb25nXCIsIHsgdGV4dDogbGFuZ05hbWUsIGF0dHI6IHsgc3R5bGU6IFwiZGlzcGxheTogYmxvY2s7IG1hcmdpbi1ib3R0b206IDAuNXJlbTsgZm9udC1zaXplOiAxLjFlbTtcIiB9IH0pO1xuXG4gICAgICAgIGNvbnN0IGlzRGVmYXVsdCA9IChsYW5nQ29uZmlnIGFzIGFueSkudXNlRGVmYXVsdCA9PT0gdHJ1ZTtcblxuICAgICAgICBuZXcgU2V0dGluZyhjYXJkKVxuICAgICAgICAgIC5zZXROYW1lKFwiVXNlIGRlZmF1bHQgY29uZmlndXJhdGlvblwiKVxuICAgICAgICAgIC5zZXREZXNjKFwiSWYgY2hlY2tlZCwgTG9vbSB3aWxsIHJ1biB0aGlzIGxhbmd1YWdlIHVzaW5nIGl0cyBidWlsdC1pbiBjb21tYW5kcy9leHRlbnNpb25zLlwiKVxuICAgICAgICAgIC5hZGRUb2dnbGUoKHRvZ2dsZSkgPT4ge1xuICAgICAgICAgICAgdG9nZ2xlXG4gICAgICAgICAgICAgIC5zZXRWYWx1ZShpc0RlZmF1bHQpXG4gICAgICAgICAgICAgIC5vbkNoYW5nZSgodmFsKSA9PiB7XG4gICAgICAgICAgICAgICAgaWYgKHZhbCkge1xuICAgICAgICAgICAgICAgICAgKGxhbmdDb25maWcgYXMgYW55KS51c2VEZWZhdWx0ID0gdHJ1ZTtcbiAgICAgICAgICAgICAgICAgIGRlbGV0ZSBsYW5nQ29uZmlnLmNvbW1hbmQ7XG4gICAgICAgICAgICAgICAgICBkZWxldGUgbGFuZ0NvbmZpZy5leHRlbnNpb247XG4gICAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAgIGRlbGV0ZSAobGFuZ0NvbmZpZyBhcyBhbnkpLnVzZURlZmF1bHQ7XG4gICAgICAgICAgICAgICAgICBjb25zdCBkZWZhdWx0cyA9IHRoaXMubG9vbVBsdWdpbi5jb250YWluZXJSdW5uZXIuZ2V0RGVmYXVsdExhbmd1YWdlQ29uZmlnKGxhbmdOYW1lLCB0aGlzLmxvb21QbHVnaW4uc2V0dGluZ3MpO1xuICAgICAgICAgICAgICAgICAgbGFuZ0NvbmZpZy5jb21tYW5kID0gZGVmYXVsdHM/LmNvbW1hbmQgfHwgXCJcIjtcbiAgICAgICAgICAgICAgICAgIGxhbmdDb25maWcuZXh0ZW5zaW9uID0gZGVmYXVsdHM/LmV4dGVuc2lvbiB8fCBcIlwiO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB0aGlzLnJlbmRlckFjdGl2ZVRhYigpO1xuICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICB9KTtcblxuICAgICAgICBuZXcgU2V0dGluZyhjYXJkKVxuICAgICAgICAgIC5zZXROYW1lKFwiQ29tbWFuZFwiKVxuICAgICAgICAgIC5zZXREZXNjKFwiRXhlY3V0aW9uIGNvbW1hbmQuIFVzZSB7ZmlsZX0gZm9yIHRoZSBjb2RlIHNuaXBwZXQgZmlsZW5hbWUuXCIpXG4gICAgICAgICAgLmFkZFRleHQoKHRleHQpID0+IHtcbiAgICAgICAgICAgIGNvbnN0IGRlZmF1bHRzID0gdGhpcy5sb29tUGx1Z2luLmNvbnRhaW5lclJ1bm5lci5nZXREZWZhdWx0TGFuZ3VhZ2VDb25maWcobGFuZ05hbWUsIHRoaXMubG9vbVBsdWdpbi5zZXR0aW5ncyk7XG4gICAgICAgICAgICB0ZXh0XG4gICAgICAgICAgICAgIC5zZXRQbGFjZWhvbGRlcihkZWZhdWx0cz8uY29tbWFuZCB8fCBcIlwiKVxuICAgICAgICAgICAgICAuc2V0VmFsdWUobGFuZ0NvbmZpZy5jb21tYW5kIHx8IFwiXCIpXG4gICAgICAgICAgICAgIC5zZXREaXNhYmxlZChpc0RlZmF1bHQpXG4gICAgICAgICAgICAgIC5vbkNoYW5nZSgodmFsKSA9PiB7XG4gICAgICAgICAgICAgICAgbGFuZ0NvbmZpZy5jb21tYW5kID0gdmFsLnRyaW0oKTtcbiAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgfSk7XG5cbiAgICAgICAgbmV3IFNldHRpbmcoY2FyZClcbiAgICAgICAgICAuc2V0TmFtZShcIkV4dGVuc2lvblwiKVxuICAgICAgICAgIC5zZXREZXNjKFwiU291cmNlIGZpbGUgZXh0ZW5zaW9uIChlLmcuIC5weSwgLmpzKS5cIilcbiAgICAgICAgICAuYWRkVGV4dCgodGV4dCkgPT4ge1xuICAgICAgICAgICAgY29uc3QgZGVmYXVsdHMgPSB0aGlzLmxvb21QbHVnaW4uY29udGFpbmVyUnVubmVyLmdldERlZmF1bHRMYW5ndWFnZUNvbmZpZyhsYW5nTmFtZSwgdGhpcy5sb29tUGx1Z2luLnNldHRpbmdzKTtcbiAgICAgICAgICAgIHRleHRcbiAgICAgICAgICAgICAgLnNldFBsYWNlaG9sZGVyKGRlZmF1bHRzPy5leHRlbnNpb24gfHwgXCJcIilcbiAgICAgICAgICAgICAgLnNldFZhbHVlKGxhbmdDb25maWcuZXh0ZW5zaW9uIHx8IFwiXCIpXG4gICAgICAgICAgICAgIC5zZXREaXNhYmxlZChpc0RlZmF1bHQpXG4gICAgICAgICAgICAgIC5vbkNoYW5nZSgodmFsKSA9PiB7XG4gICAgICAgICAgICAgICAgbGFuZ0NvbmZpZy5leHRlbnNpb24gPSB2YWwudHJpbSgpO1xuICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICB9KTtcblxuICAgICAgICBuZXcgU2V0dGluZyhjYXJkKVxuICAgICAgICAgIC5hZGRCdXR0b24oKGJ0bikgPT4ge1xuICAgICAgICAgICAgYnRuXG4gICAgICAgICAgICAgIC5zZXRCdXR0b25UZXh0KFwiUmVtb3ZlIExhbmd1YWdlXCIpXG4gICAgICAgICAgICAgIC5zZXRXYXJuaW5nKClcbiAgICAgICAgICAgICAgLm9uQ2xpY2soKCkgPT4ge1xuICAgICAgICAgICAgICAgIGRlbGV0ZSB0aGlzLmNvbmZpZ09iai5sYW5ndWFnZXNbbGFuZ05hbWVdO1xuICAgICAgICAgICAgICAgIHRoaXMucmVuZGVyQWN0aXZlVGFiKCk7XG4gICAgICAgICAgICAgIH0pO1xuICAgICAgICAgIH0pO1xuICAgICAgfVxuICAgIH1cblxuICAgIC8vIEFkZCBMYW5ndWFnZSBTZWN0aW9uXG4gICAgY29udGFpbmVyRWwuY3JlYXRlRWwoXCJoM1wiLCB7IHRleHQ6IFwiQWRkIExhbmd1YWdlIE1hcHBpbmdcIiwgYXR0cjogeyBzdHlsZTogXCJtYXJnaW4tdG9wOiAxLjVyZW07XCIgfSB9KTtcbiAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgIC5zZXROYW1lKFwiTGFuZ3VhZ2UgSURcIilcbiAgICAgIC5zZXREZXNjKFwiZS5nLiBweXRob24sIGphdmFzY3JpcHQsIG5vZGUsIHNoXCIpXG4gICAgICAuYWRkVGV4dCgodGV4dCkgPT4ge1xuICAgICAgICB0ZXh0LnNldFZhbHVlKHRoaXMubmV3TGFuZ3VhZ2VOYW1lKS5vbkNoYW5nZSgodmFsKSA9PiB7XG4gICAgICAgICAgdGhpcy5uZXdMYW5ndWFnZU5hbWUgPSB2YWwudHJpbSgpLnRvTG93ZXJDYXNlKCk7XG4gICAgICAgIH0pO1xuICAgICAgfSlcbiAgICAgIC5hZGRCdXR0b24oKGJ0bikgPT4ge1xuICAgICAgICBidG4uc2V0QnV0dG9uVGV4dChcIisgQWRkXCIpLnNldEN0YSgpLm9uQ2xpY2soKCkgPT4ge1xuICAgICAgICAgIGlmICghdGhpcy5uZXdMYW5ndWFnZU5hbWUpIHtcbiAgICAgICAgICAgIG5ldyBOb3RpY2UoXCJQbGVhc2UgZW50ZXIgYSBsYW5ndWFnZSBuYW1lLlwiKTtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICB9XG4gICAgICAgICAgaWYgKHRoaXMuY29uZmlnT2JqLmxhbmd1YWdlc1t0aGlzLm5ld0xhbmd1YWdlTmFtZV0pIHtcbiAgICAgICAgICAgIG5ldyBOb3RpY2UoXCJMYW5ndWFnZSBhbHJlYWR5IGNvbmZpZ3VyZWQuXCIpO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgIH1cbiAgICAgICAgICB0aGlzLmNvbmZpZ09iai5sYW5ndWFnZXNbdGhpcy5uZXdMYW5ndWFnZU5hbWVdID0ge1xuICAgICAgICAgICAgY29tbWFuZDogYCR7dGhpcy5uZXdMYW5ndWFnZU5hbWV9IHtmaWxlfWAsXG4gICAgICAgICAgICBleHRlbnNpb246IGAuJHt0aGlzLm5ld0xhbmd1YWdlTmFtZX1gLFxuICAgICAgICAgIH07XG4gICAgICAgICAgdGhpcy5uZXdMYW5ndWFnZU5hbWUgPSBcIlwiO1xuICAgICAgICAgIHRoaXMucmVuZGVyQWN0aXZlVGFiKCk7XG4gICAgICAgIH0pO1xuICAgICAgfSk7XG4gIH1cblxuICByZW5kZXJEb2NrZXJmaWxlVGFiKGNvbnRhaW5lckVsOiBIVE1MRWxlbWVudCkge1xuICAgIGlmICh0aGlzLmNvbmZpZ09iai5ydW50aW1lICE9PSBcImRvY2tlclwiICYmIHRoaXMuY29uZmlnT2JqLnJ1bnRpbWUgIT09IFwicG9kbWFuXCIpIHtcbiAgICAgIGNvbnRhaW5lckVsLmNyZWF0ZUVsKFwicFwiLCB7XG4gICAgICAgIHRleHQ6IGBEb2NrZXJmaWxlIGVkaXRpbmcgaXMgb25seSBhdmFpbGFibGUgZm9yIERvY2tlciBhbmQgUG9kbWFuIHJ1bnRpbWVzLiBDdXJyZW50bHkgdXNpbmc6ICR7dGhpcy5jb25maWdPYmoucnVudGltZX1gLFxuICAgICAgICBjbHM6IFwic2V0dGluZy1pdGVtLWRlc2NyaXB0aW9uXCIsXG4gICAgICB9KTtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBpZiAodGhpcy5kb2NrZXJmaWxlVGV4dCA9PT0gbnVsbCkge1xuICAgICAgY29udGFpbmVyRWwuY3JlYXRlRWwoXCJwXCIsIHtcbiAgICAgICAgdGV4dDogXCJObyBEb2NrZXJmaWxlIGV4aXN0cyBpbiB0aGlzIGNvbnRhaW5lciBncm91cCBkaXJlY3RvcnkuXCIsXG4gICAgICAgIGNsczogXCJzZXR0aW5nLWl0ZW0tZGVzY3JpcHRpb25cIixcbiAgICAgIH0pO1xuXG4gICAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgICAgLmFkZEJ1dHRvbigoYnRuKSA9PiB7XG4gICAgICAgICAgYnRuXG4gICAgICAgICAgICAuc2V0QnV0dG9uVGV4dChcIkNyZWF0ZSBEb2NrZXJmaWxlXCIpXG4gICAgICAgICAgICAuc2V0Q3RhKClcbiAgICAgICAgICAgIC5vbkNsaWNrKCgpID0+IHtcbiAgICAgICAgICAgICAgdGhpcy5kb2NrZXJmaWxlVGV4dCA9IFtcbiAgICAgICAgICAgICAgICBcIkZST00gdWJ1bnR1OmxhdGVzdFwiLFxuICAgICAgICAgICAgICAgIFwiXCIsXG4gICAgICAgICAgICAgICAgXCIjIEluc3RhbGwgcGFja2FnZXNcIixcbiAgICAgICAgICAgICAgICBcIlJVTiBhcHQtZ2V0IHVwZGF0ZSAmJiBhcHQtZ2V0IGluc3RhbGwgLXkgXFxcXFwiLFxuICAgICAgICAgICAgICAgIFwiICAgIHB5dGhvbjMgXFxcXFwiLFxuICAgICAgICAgICAgICAgIFwiICAgIG5vZGVqcyBcXFxcXCIsXG4gICAgICAgICAgICAgICAgXCIgICAgJiYgcm0gLXJmIC92YXIvbGliL2FwdC9saXN0cy8qXCIsXG4gICAgICAgICAgICAgICAgXCJcIixcbiAgICAgICAgICAgICAgXS5qb2luKFwiXFxuXCIpO1xuICAgICAgICAgICAgICB0aGlzLnJlbmRlckFjdGl2ZVRhYigpO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgIH0pO1xuICAgIH0gZWxzZSB7XG4gICAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgICAgLnNldE5hbWUoXCJEb2NrZXJmaWxlIENvbnRlbnRcIilcbiAgICAgICAgLnNldERlc2MoXCJEZWZpbmUgdGhlIGJ1aWxkIHN0ZXBzIGZvciB5b3VyIGVudmlyb25tZW50IGNvbnRhaW5lci5cIilcbiAgICAgICAgLmFkZFRleHRBcmVhKCh0ZXh0KSA9PiB7XG4gICAgICAgICAgdGV4dC5pbnB1dEVsLnJvd3MgPSAxNTtcbiAgICAgICAgICB0ZXh0LmlucHV0RWwuc3R5bGUuZm9udEZhbWlseSA9IFwibW9ub3NwYWNlXCI7XG4gICAgICAgICAgdGV4dC5pbnB1dEVsLnN0eWxlLndpZHRoID0gXCIxMDAlXCI7XG4gICAgICAgICAgdGV4dC5zZXRWYWx1ZSh0aGlzLmRvY2tlcmZpbGVUZXh0IHx8IFwiXCIpO1xuICAgICAgICAgIHRleHQub25DaGFuZ2UoKHZhbCkgPT4ge1xuICAgICAgICAgICAgdGhpcy5kb2NrZXJmaWxlVGV4dCA9IHZhbDtcbiAgICAgICAgICB9KTtcbiAgICAgICAgfSk7XG4gICAgfVxuICB9XG5cbiAgcmVuZGVyUmF3VGFiKGNvbnRhaW5lckVsOiBIVE1MRWxlbWVudCkge1xuICAgIHRoaXMucmF3SnNvblRleHQgPSBKU09OLnN0cmluZ2lmeSh0aGlzLmNvbmZpZ09iaiwgbnVsbCwgMik7XG4gICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAuc2V0TmFtZShcIkNvbmZpZ3VyYXRpb24gSlNPTlwiKVxuICAgICAgLmFkZFRleHRBcmVhKCh0ZXh0KSA9PiB7XG4gICAgICAgIHRleHQuaW5wdXRFbC5yb3dzID0gMTU7XG4gICAgICAgIHRleHQuaW5wdXRFbC5zdHlsZS5mb250RmFtaWx5ID0gXCJtb25vc3BhY2VcIjtcbiAgICAgICAgdGV4dC5pbnB1dEVsLnN0eWxlLndpZHRoID0gXCIxMDAlXCI7XG4gICAgICAgIHRleHQuc2V0VmFsdWUodGhpcy5yYXdKc29uVGV4dCk7XG4gICAgICAgIHRleHQub25DaGFuZ2UoKHZhbCkgPT4ge1xuICAgICAgICAgIHRoaXMucmF3SnNvblRleHQgPSB2YWw7XG4gICAgICAgIH0pO1xuICAgICAgfSk7XG4gIH1cblxuICBhc3luYyBzYXZlQW5kQ2xvc2UoKSB7XG4gICAgLy8gSWYgdGhlIGFjdGl2ZSB0YWIgaXMgcmF3IEpTT04sIHBhcnNlIGl0IGZpcnN0IHRvIGVuc3VyZSB3ZSBjYXB0dXJlIGVkaXRzXG4gICAgaWYgKHRoaXMuYWN0aXZlVGFiID09PSBcInJhd1wiKSB7XG4gICAgICB0cnkge1xuICAgICAgICB0aGlzLmNvbmZpZ09iaiA9IEpTT04ucGFyc2UodGhpcy5yYXdKc29uVGV4dCk7XG4gICAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgIG5ldyBOb3RpY2UoXCJJbnZhbGlkIEpTT04gc3ludGF4IGluIFJhdyBKU09OIHRhYi4gUGxlYXNlIGZpeCBpdCBiZWZvcmUgc2F2aW5nLlwiKTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuICAgIH1cblxuICAgIC8vIEJhc2ljIFZhbGlkYXRpb25cbiAgICBpZiAoIXRoaXMuY29uZmlnT2JqLnJ1bnRpbWUpIHtcbiAgICAgIG5ldyBOb3RpY2UoXCJSdW50aW1lIGlzIHJlcXVpcmVkLlwiKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgaWYgKHRoaXMuY29uZmlnT2JqLnJ1bnRpbWUgPT09IFwicWVtdVwiICYmICghdGhpcy5jb25maWdPYmoucWVtdT8uc3NoVGFyZ2V0IHx8ICF0aGlzLmNvbmZpZ09iai5xZW11Py5yZW1vdGVXb3Jrc3BhY2UpKSB7XG4gICAgICBuZXcgTm90aWNlKFwiUUVNVSBydW50aW1lIHJlcXVpcmVzIFNTSCBUYXJnZXQgYW5kIFJlbW90ZSBXb3Jrc3BhY2UuXCIpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBpZiAodGhpcy5jb25maWdPYmoucnVudGltZSA9PT0gXCJjdXN0b21cIiAmJiAhdGhpcy5jb25maWdPYmouY3VzdG9tPy5leGVjdXRhYmxlKSB7XG4gICAgICBuZXcgTm90aWNlKFwiQ3VzdG9tIHJ1bnRpbWUgcmVxdWlyZXMgQ3VzdG9tIEV4ZWN1dGFibGUuXCIpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGNvbnN0IGFkYXB0ZXIgPSB0aGlzLmFwcC52YXVsdC5hZGFwdGVyO1xuICAgIGNvbnN0IGNvbmZpZ1BhdGggPSBgJHt0aGlzLnBsdWdpbkRpcn0vY29udGFpbmVycy8ke3RoaXMuZ3JvdXBOYW1lfS9jb25maWcuanNvbmA7XG4gICAgY29uc3QgZG9ja2VyZmlsZVBhdGggPSBgJHt0aGlzLnBsdWdpbkRpcn0vY29udGFpbmVycy8ke3RoaXMuZ3JvdXBOYW1lfS9Eb2NrZXJmaWxlYDtcblxuICAgIHRyeSB7XG4gICAgICAvLyBTYXZlIGNvbmZpZy5qc29uXG4gICAgICBjb25zdCBjb25maWdTdHIgPSBKU09OLnN0cmluZ2lmeSh0aGlzLmNvbmZpZ09iaiwgbnVsbCwgMik7XG4gICAgICBhd2FpdCBhZGFwdGVyLndyaXRlKGNvbmZpZ1BhdGgsIGNvbmZpZ1N0cik7XG5cbiAgICAgIC8vIFNhdmUgRG9ja2VyZmlsZVxuICAgICAgaWYgKHRoaXMuY29uZmlnT2JqLnJ1bnRpbWUgPT09IFwiZG9ja2VyXCIgfHwgdGhpcy5jb25maWdPYmoucnVudGltZSA9PT0gXCJwb2RtYW5cIikge1xuICAgICAgICBpZiAodGhpcy5kb2NrZXJmaWxlVGV4dCAhPT0gbnVsbCkge1xuICAgICAgICAgIGF3YWl0IGFkYXB0ZXIud3JpdGUoZG9ja2VyZmlsZVBhdGgsIHRoaXMuZG9ja2VyZmlsZVRleHQpO1xuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIG5ldyBOb3RpY2UoXCJDb250YWluZXIgZ3JvdXAgY29uZmlndXJhdGlvbnMgc2F2ZWQuXCIpO1xuICAgICAgdGhpcy5vblNhdmUoKTtcbiAgICAgIHRoaXMuY2xvc2UoKTtcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgbmV3IE5vdGljZShgU2F2ZSBmYWlsZWQ6ICR7ZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiBTdHJpbmcoZXJyb3IpfWApO1xuICAgIH1cbiAgfVxufVxuXG5cblxuIiwgImltcG9ydCB7IHNldEljb24gfSBmcm9tIFwib2JzaWRpYW5cIjtcblxuZXhwb3J0IGludGVyZmFjZSBsb29tVG9vbGJhckhhbmRsZXJzIHtcbiAgb25SdW46ICgpID0+IHZvaWQ7XG4gIG9uQ29weTogKCkgPT4gdm9pZDtcbiAgb25SZW1vdmU6ICgpID0+IHZvaWQ7XG4gIG9uVG9nZ2xlT3V0cHV0OiAoKSA9PiB2b2lkO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gY3JlYXRlQ29kZUJsb2NrVG9vbGJhcihcbiAgYmxvY2tJZDogc3RyaW5nLFxuICBpc1J1bm5pbmc6IGJvb2xlYW4sXG4gIGhhbmRsZXJzOiBsb29tVG9vbGJhckhhbmRsZXJzLFxuKTogSFRNTERpdkVsZW1lbnQge1xuICBjb25zdCB0b29sYmFyID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcImRpdlwiKTtcbiAgdG9vbGJhci5jbGFzc05hbWUgPSBcImxvb20tY29kZS10b29sYmFyXCI7XG4gIHRvb2xiYXIuZGF0YXNldC5sb29tQmxvY2tJZCA9IGJsb2NrSWQ7XG5cbiAgdG9vbGJhci5hcHBlbmRDaGlsZChjcmVhdGVCdXR0b24oXCJSdW4gYmxvY2tcIiwgaXNSdW5uaW5nID8gXCJsb2FkZXItY2lyY2xlXCIgOiBcInBsYXlcIiwgaGFuZGxlcnMub25SdW4sIGlzUnVubmluZykpO1xuICB0b29sYmFyLmFwcGVuZENoaWxkKGNyZWF0ZUJ1dHRvbihcIkNvcHkgY29kZVwiLCBcImNvcHlcIiwgaGFuZGxlcnMub25Db3B5LCBmYWxzZSkpO1xuICB0b29sYmFyLmFwcGVuZENoaWxkKGNyZWF0ZUJ1dHRvbihcIlJlbW92ZSBzbmlwcGV0XCIsIFwidHJhc2gtMlwiLCBoYW5kbGVycy5vblJlbW92ZSwgZmFsc2UpKTtcbiAgdG9vbGJhci5hcHBlbmRDaGlsZChjcmVhdGVCdXR0b24oXCJUb2dnbGUgb3V0cHV0XCIsIFwicGFuZWwtYm90dG9tLW9wZW5cIiwgaGFuZGxlcnMub25Ub2dnbGVPdXRwdXQsIGZhbHNlKSk7XG5cbiAgcmV0dXJuIHRvb2xiYXI7XG59XG5cbmZ1bmN0aW9uIGNyZWF0ZUJ1dHRvbihsYWJlbDogc3RyaW5nLCBpY29uTmFtZTogc3RyaW5nLCBvbkNsaWNrOiAoKSA9PiB2b2lkLCBzcGlubmluZzogYm9vbGVhbik6IEhUTUxCdXR0b25FbGVtZW50IHtcbiAgY29uc3QgYnV0dG9uID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcImJ1dHRvblwiKTtcbiAgYnV0dG9uLmNsYXNzTmFtZSA9IGBsb29tLXRvb2xiYXItYnV0dG9uJHtzcGlubmluZyA/IFwiIGlzLXJ1bm5pbmdcIiA6IFwiXCJ9YDtcbiAgYnV0dG9uLnR5cGUgPSBcImJ1dHRvblwiO1xuICBidXR0b24uc2V0QXR0cmlidXRlKFwiYXJpYS1sYWJlbFwiLCBsYWJlbCk7XG4gIGJ1dHRvbi5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKGV2ZW50KSA9PiB7XG4gICAgZXZlbnQucHJldmVudERlZmF1bHQoKTtcbiAgICBldmVudC5zdG9wUHJvcGFnYXRpb24oKTtcbiAgICBvbkNsaWNrKCk7XG4gIH0pO1xuICBzZXRJY29uKGJ1dHRvbiwgaWNvbk5hbWUpO1xuICByZXR1cm4gYnV0dG9uO1xufVxuIiwgImltcG9ydCB7IHNldEljb24gfSBmcm9tIFwib2JzaWRpYW5cIjtcbmltcG9ydCB0eXBlIHsgbG9vbVN0b3JlZE91dHB1dCB9IGZyb20gXCIuLi90eXBlc1wiO1xuXG5mdW5jdGlvbiBnZXRTdGF0dXNLaW5kKG91dHB1dDogbG9vbVN0b3JlZE91dHB1dCk6IFwic3VjY2Vzc1wiIHwgXCJ3YXJuaW5nXCIgfCBcImZhaWx1cmVcIiB7XG4gIGlmIChvdXRwdXQucmVzdWx0LnN1Y2Nlc3MpIHtcbiAgICByZXR1cm4gb3V0cHV0LnJlc3VsdC5zdGRlcnIudHJpbSgpIHx8IG91dHB1dC5yZXN1bHQud2FybmluZz8udHJpbSgpID8gXCJ3YXJuaW5nXCIgOiBcInN1Y2Nlc3NcIjtcbiAgfVxuXG4gIHJldHVybiBcImZhaWx1cmVcIjtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGNyZWF0ZU91dHB1dFBhbmVsKG91dHB1dDogbG9vbVN0b3JlZE91dHB1dCk6IEhUTUxEaXZFbGVtZW50IHtcbiAgY29uc3QgcGFuZWwgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwiZGl2XCIpO1xuICBwYW5lbC5jbGFzc05hbWUgPSBgbG9vbS1vdXRwdXQtcGFuZWwgaXMtJHtnZXRTdGF0dXNLaW5kKG91dHB1dCl9JHtvdXRwdXQudmlzaWJsZSA/IFwiXCIgOiBcIiBpcy1oaWRkZW5cIn1gO1xuICBwYW5lbC5kYXRhc2V0Lmxvb21CbG9ja0lkID0gb3V0cHV0LmJsb2NrSWQ7XG4gIHJlbmRlck91dHB1dFBhbmVsKHBhbmVsLCBvdXRwdXQpO1xuICByZXR1cm4gcGFuZWw7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiByZW5kZXJPdXRwdXRQYW5lbChwYW5lbDogSFRNTEVsZW1lbnQsIG91dHB1dDogbG9vbVN0b3JlZE91dHB1dCk6IHZvaWQge1xuICBjb25zdCBraW5kID0gZ2V0U3RhdHVzS2luZChvdXRwdXQpO1xuICBwYW5lbC5jbGFzc05hbWUgPSBgbG9vbS1vdXRwdXQtcGFuZWwgaXMtJHtraW5kfSR7b3V0cHV0LnZpc2libGUgPyBcIlwiIDogXCIgaXMtaGlkZGVuXCJ9JHtvdXRwdXQuY29sbGFwc2VkID8gXCIgaXMtY29sbGFwc2VkXCIgOiBcIlwifWA7XG4gIHBhbmVsLmVtcHR5KCk7XG5cbiAgY29uc3QgaGVhZGVyID0gcGFuZWwuY3JlYXRlRGl2KHsgY2xzOiBcImxvb20tb3V0cHV0LWhlYWRlclwiIH0pO1xuICBjb25zdCBiYWRnZSA9IGhlYWRlci5jcmVhdGVEaXYoeyBjbHM6IFwibG9vbS1vdXRwdXQtYmFkZ2VcIiB9KTtcbiAgc2V0SWNvbihiYWRnZSwga2luZCA9PT0gXCJzdWNjZXNzXCIgPyBcImNoZWNrLWNpcmNsZS0yXCIgOiBraW5kID09PSBcIndhcm5pbmdcIiA/IFwiYWxlcnQtdHJpYW5nbGVcIiA6IFwieC1jaXJjbGVcIik7XG5cbiAgY29uc3QgdGl0bGUgPSBoZWFkZXIuY3JlYXRlRGl2KHsgY2xzOiBcImxvb20tb3V0cHV0LXRpdGxlXCIgfSk7XG4gIHRpdGxlLnNldFRleHQoYCR7b3V0cHV0LnJlc3VsdC5ydW5uZXJOYW1lfSBcdTAwQjcgZXhpdCAke291dHB1dC5yZXN1bHQuZXhpdENvZGUgPz8gXCI/XCJ9YCk7XG5cbiAgY29uc3QgbWV0YSA9IGhlYWRlci5jcmVhdGVEaXYoeyBjbHM6IFwibG9vbS1vdXRwdXQtbWV0YVwiIH0pO1xuICBtZXRhLnNldFRleHQoYCR7b3V0cHV0LnJlc3VsdC5kdXJhdGlvbk1zfSBtcyBcdTAwQjcgJHtuZXcgRGF0ZShvdXRwdXQucmVzdWx0LmZpbmlzaGVkQXQpLnRvTG9jYWxlVGltZVN0cmluZygpfWApO1xuXG4gIGNvbnN0IGJvZHkgPSBwYW5lbC5jcmVhdGVEaXYoeyBjbHM6IFwibG9vbS1vdXRwdXQtYm9keVwiIH0pO1xuICBpZiAob3V0cHV0LnJlc3VsdC5zdGRvdXQudHJpbSgpKSB7XG4gICAgY3JlYXRlU3RyZWFtKGJvZHksIFwiU3Rkb3V0XCIsIG91dHB1dC5yZXN1bHQuc3Rkb3V0KTtcbiAgfVxuICBpZiAob3V0cHV0LnJlc3VsdC53YXJuaW5nPy50cmltKCkpIHtcbiAgICBjcmVhdGVTdHJlYW0oYm9keSwgXCJXYXJuaW5nXCIsIG91dHB1dC5yZXN1bHQud2FybmluZyk7XG4gIH1cbiAgaWYgKG91dHB1dC5yZXN1bHQuc3RkZXJyLnRyaW0oKSkge1xuICAgIGNyZWF0ZVN0cmVhbShib2R5LCBcIlN0ZGVyclwiLCBvdXRwdXQucmVzdWx0LnN0ZGVycik7XG4gIH1cbiAgaWYgKCFvdXRwdXQucmVzdWx0LnN0ZG91dC50cmltKCkgJiYgIW91dHB1dC5yZXN1bHQud2FybmluZz8udHJpbSgpICYmICFvdXRwdXQucmVzdWx0LnN0ZGVyci50cmltKCkpIHtcbiAgICBjb25zdCBlbXB0eSA9IGJvZHkuY3JlYXRlRGl2KHsgY2xzOiBcImxvb20tb3V0cHV0LWVtcHR5XCIgfSk7XG4gICAgZW1wdHkuc2V0VGV4dChcIk5vIG91dHB1dFwiKTtcbiAgfVxufVxuXG5mdW5jdGlvbiBjcmVhdGVTdHJlYW0oY29udGFpbmVyOiBIVE1MRWxlbWVudCwgbGFiZWw6IHN0cmluZywgY29udGVudDogc3RyaW5nKTogdm9pZCB7XG4gIGNvbnN0IHNlY3Rpb24gPSBjb250YWluZXIuY3JlYXRlRGl2KHsgY2xzOiBcImxvb20tb3V0cHV0LXN0cmVhbVwiIH0pO1xuICBzZWN0aW9uLmNyZWF0ZURpdih7IGNsczogXCJsb29tLW91dHB1dC1zdHJlYW0tbGFiZWxcIiwgdGV4dDogbGFiZWwgfSk7XG4gIHNlY3Rpb24uY3JlYXRlRWwoXCJwcmVcIiwgeyBjbHM6IFwibG9vbS1vdXRwdXQtcHJlXCIsIHRleHQ6IGNvbnRlbnQgfSk7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBjcmVhdGVSdW5uaW5nUGFuZWwoKTogSFRNTERpdkVsZW1lbnQge1xuICBjb25zdCBwYW5lbCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJkaXZcIik7XG4gIHBhbmVsLmNsYXNzTmFtZSA9IFwibG9vbS1vdXRwdXQtcGFuZWwgaXMtcnVubmluZ1wiO1xuXG4gIGNvbnN0IGhlYWRlciA9IHBhbmVsLmNyZWF0ZURpdih7IGNsczogXCJsb29tLW91dHB1dC1oZWFkZXJcIiB9KTtcbiAgY29uc3Qgc3Bpbm5lciA9IGhlYWRlci5jcmVhdGVEaXYoeyBjbHM6IFwibG9vbS1zcGlubmVyXCIgfSk7XG4gIHNldEljb24oc3Bpbm5lciwgXCJsb2FkZXItY2lyY2xlXCIpO1xuICBjb25zdCB0aXRsZSA9IGhlYWRlci5jcmVhdGVEaXYoeyBjbHM6IFwibG9vbS1vdXRwdXQtdGl0bGVcIiB9KTtcbiAgdGl0bGUuc2V0VGV4dChcIlJ1bm5pbmdcIik7XG4gIGNvbnN0IG1ldGEgPSBoZWFkZXIuY3JlYXRlRGl2KHsgY2xzOiBcImxvb20tb3V0cHV0LW1ldGFcIiB9KTtcbiAgbWV0YS5zZXRUZXh0KFwiRXhlY3V0aW5nLi4uXCIpO1xuICBzcGlubmVyLnNldEF0dHJpYnV0ZShcImFyaWEtaGlkZGVuXCIsIFwidHJ1ZVwiKTtcblxuICByZXR1cm4gcGFuZWw7XG59XG4iXSwKICAibWFwcGluZ3MiOiAiOzs7Ozs7Ozs7Ozs7Ozs7Ozs7OztBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQSxJQUFBQSxtQkFRTztBQUNQLG1CQUE2QztBQUM3QyxJQUFBQyxlQUEyRTtBQUMzRSxJQUFBQyxlQUF3Qjs7O0FDWHhCLHNCQUE2QztBQUM3QyxnQkFBZ0Q7QUFDaEQsSUFBQUMsbUJBQXdEO0FBQ3hELElBQUFDLGVBQWlGO0FBQ2pGLElBQUFDLHdCQUFzQjs7O0FDSnRCLHNCQUF1QztBQUN2QyxnQkFBdUI7QUFDdkIsa0JBQXFCO0FBQ3JCLDJCQUFzQjtBQXdCdEIsZUFBc0Isd0JBQ3BCLFVBQ0EsUUFDQSxVQUNZO0FBQ1osUUFBTSxVQUFVLFVBQU0sNkJBQVEsc0JBQUssa0JBQU8sR0FBRyxPQUFPLENBQUM7QUFDckQsUUFBTSxlQUFXLGtCQUFLLFNBQVMsUUFBUTtBQUV2QyxNQUFJO0FBQ0YsY0FBTSwyQkFBVSxVQUFVLDBCQUEwQixNQUFNLEdBQUcsTUFBTTtBQUNuRSxXQUFPLE1BQU0sU0FBUyxFQUFFLFNBQVMsU0FBUyxDQUFDO0FBQUEsRUFDN0Ms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QUs7QUFBQSxNQUNqRCxPQUFPLFNBQVM7QUFBQSxFQUFZLE9BQU8sTUFBTSxLQUFLO0FBQUEsSUFDaEQsRUFDRyxPQUFPLE9BQU8sRUFDZCxLQUFLLE1BQU07QUFFZCxXQUFPO0FBQUEsTUFDTCw2QkFBNkIsT0FBTztBQUFBLE1BQ3BDO0FBQUEsTUFDQTtBQUFBLE1BQ0E7QUFBQSxNQUNBO0FBQUEsSUFDRjtBQUFBLEVBQ0Y7QUFBQSxFQUVRLHVCQUF1QixPQUFpQixTQUF3RDtBQUN0RyxVQUFNLGNBQWMsNkJBQTZCLE9BQU87QUFDeEQsYUFBUyxJQUFJLEdBQUcsSUFBSSxNQUFNLFFBQVEsS0FBSyxHQUFHO0FBQ3hDLFVBQUksTUFBTSxDQUFDLEVBQUUsS0FBSyxNQUFNLGFBQWE7QUFDbkM7QUFBQSxNQUNGO0FBRUEsZUFBUyxJQUFJLElBQUksR0FBRyxJQUFJLE1BQU0sUUFBUSxLQUFLLEdBQUc7QUFDNUMsWUFBSSxNQUFNLENBQUMsRUFBRSxLQUFLLE1BQU0sNEJBQTRCO0FBQ2xELGlCQUFPLEVBQUUsT0FBTyxHQUFHLEtBQUssRUFBRTtBQUFBLFFBQzVCO0FBQUEsTUFDRjtBQUFBLElBQ0Y7QUFDQSxXQUFPO0FBQUEsRUFDVDtBQUNGOyIsCiAgIm5hbWVzIjogWyJpbXBvcnRfb2JzaWRpYW4iLCAiaW1wb3J0X3ZpZXciLCAiaW1wb3J0X3BhdGgiLCAiaW1wb3J0X3Byb21pc2VzIiwgImltcG9ydF9wYXRoIiwgImltcG9ydF9jaGlsZF9wcm9jZXNzIiwgInBvc2l4UGF0aCIsICJub3JtYWxpemVGc1BhdGgiLCAiZ2V0TGVhZGluZ1doaXRlc3BhY2UiLCAibm9ybWFsaXplRXh0ZW5zaW9uIiwgImltcG9ydF9wYXRoIiwgImltcG9ydF9wYXRoIiwgImltcG9ydF9wYXRoIiwgImltcG9ydF9mcyIsICJpbXBvcnRfcGF0aCIsICJpbXBvcnRfb2JzaWRpYW4iLCAibG9vbVBsdWdpbiIsICJpbXBvcnRfb2JzaWRpYW4iLCAiaW1wb3J0X29ic2lkaWFuIl0KfQo=
