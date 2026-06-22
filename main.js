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
var import_path8 = require("path");

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
var FENCE_START = /^(```+|~~~+)\s*([^\s`]*)?(.*)$/;
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
    const sourceReference = parseSourceReference(fenceMatch[3] ?? "");
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
    const referenceHash = sourceReference ? `:${JSON.stringify(sourceReference)}` : "";
    const contentHash = shortHash(`${content}${referenceHash}`);
    const id = shortHash(`${filePath}:${ordinal}:${language}:${contentHash}`);
    blocks.push({
      id,
      ordinal,
      filePath,
      language,
      languageAlias: sourceLanguage.toLowerCase(),
      sourceLanguage,
      content,
      sourceReference,
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
function parseSourceReference(infoTail) {
  const attrs = parseInfoAttributes(infoTail);
  const filePath = attrs["loom-file"] ?? attrs.file ?? attrs.src ?? attrs.source;
  if (!filePath) {
    return void 0;
  }
  const lines = attrs["loom-lines"] ?? attrs.lines ?? attrs.line;
  const lineRange = lines ? parseLineRange(lines) : null;
  const symbolName = attrs["loom-symbol"] ?? attrs.symbol ?? attrs.fn ?? attrs.function;
  const traceValue = attrs["loom-deps"] ?? attrs.deps ?? attrs.trace;
  const callExpression = attrs["loom-call"] ?? attrs.call;
  const callArgs = attrs["loom-args"] ?? attrs.args;
  const printValue = attrs["loom-print"] ?? attrs.print;
  const call = callExpression != null || callArgs != null ? {
    expression: normalizeBooleanAttribute(callExpression) === "true" ? void 0 : callExpression,
    args: callArgs,
    print: printValue == null ? true : !["0", "false", "no", "off"].includes(printValue.toLowerCase())
  } : void 0;
  return {
    filePath,
    lineStart: lineRange?.start,
    lineEnd: lineRange?.end,
    symbolName,
    traceDependencies: traceValue == null ? true : !["0", "false", "no", "off"].includes(traceValue.toLowerCase()),
    call
  };
}
function normalizeBooleanAttribute(value) {
  return value == null ? void 0 : value.trim().toLowerCase();
}
function parseInfoAttributes(input) {
  const attrs = {};
  const pattern = /([A-Za-z0-9_-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s]+))/g;
  let match;
  while ((match = pattern.exec(input)) != null) {
    attrs[match[1].toLowerCase()] = match[2] ?? match[3] ?? match[4] ?? "";
  }
  return attrs;
}
function parseLineRange(value) {
  const match = value.trim().match(/^L?(\d+)(?:\s*[-:]\s*L?(\d+))?$/i);
  if (!match) {
    return null;
  }
  const start = Number.parseInt(match[1], 10);
  const end = Number.parseInt(match[2] ?? match[1], 10);
  if (!Number.isInteger(start) || !Number.isInteger(end) || start <= 0 || end < start) {
    return null;
  }
  return { start, end };
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

// src/languageCapabilities.ts
var BUILT_IN_CAPABILITIES = {
  python: {
    language: "python",
    symbolExtraction: "ast",
    dependencyTracing: "ast",
    callHarness: "built-in",
    sourcePreview: true
  },
  javascript: {
    language: "javascript",
    symbolExtraction: "top-level",
    dependencyTracing: "top-level",
    callHarness: "built-in",
    sourcePreview: true
  },
  typescript: {
    language: "typescript",
    symbolExtraction: "top-level",
    dependencyTracing: "top-level",
    callHarness: "built-in",
    sourcePreview: true
  },
  c: {
    language: "c",
    symbolExtraction: "top-level",
    dependencyTracing: "top-level",
    callHarness: "built-in",
    sourcePreview: true
  },
  cpp: {
    language: "cpp",
    symbolExtraction: "top-level",
    dependencyTracing: "top-level",
    callHarness: "built-in",
    sourcePreview: true
  },
  "llvm-ir": {
    language: "llvm-ir",
    symbolExtraction: "top-level",
    dependencyTracing: "top-level",
    callHarness: "raw",
    sourcePreview: true
  },
  haskell: {
    language: "haskell",
    symbolExtraction: "top-level",
    dependencyTracing: "top-level",
    callHarness: "raw",
    sourcePreview: true
  },
  ocaml: {
    language: "ocaml",
    symbolExtraction: "top-level",
    dependencyTracing: "top-level",
    callHarness: "built-in",
    sourcePreview: true
  },
  java: {
    language: "java",
    symbolExtraction: "top-level",
    dependencyTracing: "top-level",
    callHarness: "raw",
    sourcePreview: true
  }
};
function getLanguageCapability(language, hasExternalExtractor = false) {
  if (hasExternalExtractor) {
    return {
      language,
      symbolExtraction: "external",
      dependencyTracing: "external",
      callHarness: "external",
      sourcePreview: true
    };
  }
  return BUILT_IN_CAPABILITIES[language] ?? {
    language,
    symbolExtraction: "generic",
    dependencyTracing: "generic",
    callHarness: "raw",
    sourcePreview: true
  };
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
  extractedSourcePreviewMode: "collapsed",
  showLanguageCapabilityMetadata: true,
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
    new import_obsidian2.Setting(containerEl).setName("Extracted source preview").setDesc("Choose how loom shows the materialized source for blocks that use loom-file.").addDropdown(
      (dropdown) => dropdown.addOption("collapsed", "Collapsed").addOption("expanded", "Expanded").addOption("hidden", "Hidden").setValue(this.loomPlugin.settings.extractedSourcePreviewMode || "collapsed").onChange(async (value) => {
        this.loomPlugin.settings.extractedSourcePreviewMode = value;
        await this.loomPlugin.saveSettings();
      })
    );
    new import_obsidian2.Setting(containerEl).setName("Show capability metadata").setDesc("Show symbol, dependency, and harness capability metadata in extracted source preview headers.").addToggle(
      (toggle) => toggle.setValue(this.loomPlugin.settings.showLanguageCapabilityMetadata ?? true).onChange(async (value) => {
        this.loomPlugin.settings.showLanguageCapabilityMetadata = value;
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
          extension: ".txt",
          extractorMode: "command",
          extractorExecutable: "",
          extractorArgs: "{request}",
          transpileExecutable: "",
          transpileArgs: "{request}"
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
      new import_obsidian2.Setting(body).setName("Partial extraction strategy").setDesc("Choose how this custom language supports partial runnable source.").addDropdown(
        (dropdown) => dropdown.addOption("command", "Extractor command").addOption("transpile-c", "Transpile to C").setValue(language.extractorMode || "command").onChange(async (value) => {
          language.extractorMode = value;
          await this.loomPlugin.saveSettings();
        })
      );
      this.addCustomLanguageTextSetting(body, language, "Extractor executable", "Optional command for partial source extraction. Leave empty to use generic line and symbol extraction.", "extractorExecutable");
      this.addCustomLanguageTextSetting(body, language, "Extractor arguments", "Arguments for the extractor. Use {request}, {source}, {harness}, {symbol}, {lineStart}, {lineEnd}, {deps}, and {language}.", "extractorArgs");
      this.addCustomLanguageTextSetting(body, language, "Transpile to C executable", "Optional command that emits generated C and a symbol map as JSON.", "transpileExecutable");
      this.addCustomLanguageTextSetting(body, language, "Transpile to C arguments", "Arguments for the transpiler. Use the same placeholders as extractor arguments.", "transpileArgs");
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
      (text) => text.setValue(String(language[key] ?? "")).onChange(async (value) => {
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

// src/sourceExtract.ts
var import_child_process3 = require("child_process");
var import_promises3 = require("fs/promises");
var import_os2 = require("os");
var import_path7 = require("path");
async function resolveReferencedSource(source, reference, language, harness, host) {
  if (host?.externalExtractor?.executable.trim()) {
    return host.externalExtractor.mode === "transpile-c" ? resolveTranspileToCReferencedSource(source, reference, language, harness, host.externalExtractor) : resolveExternalReferencedSource(source, reference, language, harness, host.externalExtractor);
  }
  if (language === "python" && host) {
    return resolvePythonReferencedSource(source, reference, harness, host);
  }
  return resolveReferencedSourceFallback(source, reference, language, harness);
}
function resolveReferencedSourceFallback(source, reference, language, harness) {
  const lines = source.split(/\r?\n/);
  const selectedRange = reference.symbolName ? findSymbolRange(lines, language, reference.symbolName) : findLineRange(lines, reference);
  if (!selectedRange) {
    const target = reference.symbolName ? `symbol ${reference.symbolName}` : "line range";
    throw new Error(`Unable to extract ${target} from ${reference.filePath}.`);
  }
  const selected = renderRange(lines, selectedRange);
  const dependencies = reference.traceDependencies ? collectDependencySource(lines, language, selectedRange, selected) : "";
  const content = [dependencies, selected, harness.trim() ? harness : ""].filter((part) => part.trim()).join("\n\n");
  return {
    content,
    description: formatSourceDescription(reference, selectedRange)
  };
}
async function resolveExternalReferencedSource(source, reference, language, harness, extractor) {
  const tempDir = await (0, import_promises3.mkdtemp)((0, import_path7.join)((0, import_os2.tmpdir)(), "loom-extract-"));
  const sourceFile = (0, import_path7.join)(tempDir, "source.txt");
  const harnessFile = (0, import_path7.join)(tempDir, "harness.txt");
  const requestFile = (0, import_path7.join)(tempDir, "request.json");
  try {
    const request = {
      language,
      filePath: reference.filePath,
      symbolName: reference.symbolName ?? null,
      lineStart: reference.lineStart ?? null,
      lineEnd: reference.lineEnd ?? null,
      traceDependencies: reference.traceDependencies,
      sourceFile,
      harnessFile
    };
    await (0, import_promises3.writeFile)(sourceFile, source, "utf8");
    await (0, import_promises3.writeFile)(harnessFile, harness, "utf8");
    await (0, import_promises3.writeFile)(requestFile, JSON.stringify(request, null, 2), "utf8");
    const output = await runExternalExtractor(extractor, {
      language,
      sourceFile,
      harnessFile,
      requestFile,
      reference
    });
    const result = parseExternalExtractorResult(output);
    const content = result.content ?? [
      ...result.imports ?? [],
      ...result.dependencies ?? [],
      result.selected ?? "",
      harness.trim() ? harness : ""
    ].filter((part) => part.trim()).join("\n\n");
    if (!content.trim()) {
      throw new Error("Custom source extractor returned no content.");
    }
    return {
      content,
      description: result.description?.trim() || formatSourceDescription(reference, null)
    };
  } finally {
    await (0, import_promises3.rm)(tempDir, { recursive: true, force: true });
  }
}
async function resolveTranspileToCReferencedSource(source, reference, language, harness, extractor) {
  const tempDir = await (0, import_promises3.mkdtemp)((0, import_path7.join)((0, import_os2.tmpdir)(), "loom-extract-"));
  const sourceFile = (0, import_path7.join)(tempDir, "source.txt");
  const harnessFile = (0, import_path7.join)(tempDir, "harness.txt");
  const requestFile = (0, import_path7.join)(tempDir, "request.json");
  try {
    const request = {
      language,
      filePath: reference.filePath,
      symbolName: reference.symbolName ?? null,
      lineStart: reference.lineStart ?? null,
      lineEnd: reference.lineEnd ?? null,
      traceDependencies: reference.traceDependencies,
      sourceFile,
      harnessFile,
      targetLanguage: "c"
    };
    await (0, import_promises3.writeFile)(sourceFile, source, "utf8");
    await (0, import_promises3.writeFile)(harnessFile, harness, "utf8");
    await (0, import_promises3.writeFile)(requestFile, JSON.stringify(request, null, 2), "utf8");
    const output = await runExternalExtractor(extractor, {
      language,
      sourceFile,
      harnessFile,
      requestFile,
      reference
    });
    const result = parseTranspileToCResult(output);
    const generatedLanguage = result.language === "cpp" ? "cpp" : "c";
    const mappedSymbol = reference.symbolName ? result.symbols?.[reference.symbolName] ?? reference.symbolName : void 0;
    const generatedReference = {
      ...reference,
      filePath: `${reference.filePath}:generated.${generatedLanguage === "cpp" ? "cpp" : "c"}`,
      symbolName: mappedSymbol
    };
    const resolved = resolveReferencedSourceFallback(result.generatedSource, generatedReference, generatedLanguage, result.harness ?? harness);
    return {
      content: resolved.content,
      description: result.description?.trim() || `${reference.filePath}#${reference.symbolName ?? "generated-c"}`
    };
  } finally {
    await (0, import_promises3.rm)(tempDir, { recursive: true, force: true });
  }
}
async function runExternalExtractor(extractor, values) {
  const args = extractor.args.map((arg) => arg.replaceAll("{request}", values.requestFile).replaceAll("{source}", values.sourceFile).replaceAll("{file}", values.sourceFile).replaceAll("{harness}", values.harnessFile).replaceAll("{symbol}", values.reference.symbolName ?? "").replaceAll("{lineStart}", values.reference.lineStart == null ? "" : String(values.reference.lineStart)).replaceAll("{lineEnd}", values.reference.lineEnd == null ? "" : String(values.reference.lineEnd)).replaceAll("{deps}", values.reference.traceDependencies ? "true" : "false").replaceAll("{language}", values.language));
  return new Promise((resolve, reject) => {
    const child = (0, import_child_process3.spawn)(extractor.executable, args, {
      cwd: extractor.workingDirectory,
      stdio: ["pipe", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`Custom source extractor timed out after ${extractor.timeoutMs} ms.`));
    }, extractor.timeoutMs);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code !== 0) {
        reject(new Error((stderr || stdout || `Custom source extractor exited with code ${code}.`).trim()));
        return;
      }
      resolve(stdout);
    });
    child.stdin.end(JSON.stringify({
      requestFile: values.requestFile,
      sourceFile: values.sourceFile,
      harnessFile: values.harnessFile,
      language: values.language,
      filePath: values.reference.filePath,
      symbolName: values.reference.symbolName ?? null,
      lineStart: values.reference.lineStart ?? null,
      lineEnd: values.reference.lineEnd ?? null,
      traceDependencies: values.reference.traceDependencies
    }));
  });
}
function parseExternalExtractorResult(output) {
  try {
    const parsed = JSON.parse(output);
    if (typeof parsed !== "object" || parsed == null) {
      throw new Error("Custom source extractor must return a JSON object.");
    }
    return parsed;
  } catch (error) {
    throw new Error(`Custom source extractor returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}
function parseTranspileToCResult(output) {
  try {
    const parsed = JSON.parse(output);
    if (typeof parsed !== "object" || parsed == null || typeof parsed.generatedSource !== "string") {
      throw new Error("Transpile to C extractor must return generatedSource.");
    }
    if (parsed.language != null && parsed.language !== "c" && parsed.language !== "cpp") {
      throw new Error("Transpile to C language must be c or cpp.");
    }
    if (parsed.symbols != null && (typeof parsed.symbols !== "object" || Array.isArray(parsed.symbols))) {
      throw new Error("Transpile to C symbols must be an object.");
    }
    return parsed;
  } catch (error) {
    throw new Error(`Transpile to C extractor returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}
async function resolvePythonReferencedSource(source, reference, harness, host) {
  const lines = source.split(/\r?\n/);
  const moduleInfo = await inspectPythonModule(source, host);
  const selectedRange = reference.symbolName ? findPythonSymbolRange(moduleInfo, reference.symbolName) : findLineRange(lines, reference);
  if (!selectedRange) {
    const target = reference.symbolName ? `symbol ${reference.symbolName}` : "line range";
    throw new Error(`Unable to extract ${target} from ${reference.filePath}.`);
  }
  const selected = renderRange(lines, selectedRange);
  const state = createPythonDependencyState();
  const dependencies = reference.traceDependencies ? await collectPythonDependencySource(source, reference.filePath, selectedRange, selected, harness, host, state) : "";
  const content = [dependencies, selected, harness.trim() ? harness : ""].filter((part) => part.trim()).join("\n\n");
  return {
    content,
    description: formatSourceDescription(reference, selectedRange)
  };
}
function createPythonDependencyState() {
  return {
    includedRanges: /* @__PURE__ */ new Set(),
    includedImports: /* @__PURE__ */ new Set(),
    aliases: /* @__PURE__ */ new Set(),
    namespaceBindings: /* @__PURE__ */ new Map(),
    visitingSymbols: /* @__PURE__ */ new Set(),
    needsNamespaceRuntime: false
  };
}
async function collectPythonDependencySource(source, filePath, selectedRange, selected, harness, host, state) {
  const parts = [];
  await collectPythonDependencies(source, filePath, selectedRange, `${selected}
${harness}`, host, state, parts);
  const namespace = renderPythonNamespaceBindings(state);
  return [...state.includedImports, ...parts, namespace].filter((part) => part.trim()).join("\n\n");
}
async function collectPythonDependencies(source, filePath, selectedRange, seed, host, state, parts) {
  const lines = source.split(/\r?\n/);
  const moduleInfo = await inspectPythonModule(source, host);
  let haystack = seed;
  let collected = "";
  let changed = true;
  while (changed) {
    changed = false;
    const usage = await inspectPythonUsage(haystack, host);
    for (const definition of moduleInfo.definitions) {
      if (rangesOverlap(definition, selectedRange) || !pythonDefinitionIsUsed(definition, usage)) {
        continue;
      }
      const text = addPythonRange(lines, filePath, definition, state, parts);
      if (text) {
        const nested = await collectPythonDependencies(source, filePath, definition, text, host, state, parts);
        haystack += `
${text}
`;
        if (nested) {
          haystack += `
${nested}
`;
        }
        collected += `${nested}
${text}
`;
        changed = true;
      }
    }
    for (const importNode of moduleInfo.imports) {
      const text = await resolvePythonImportDependency(importNode, lines, filePath, usage, host, state, parts);
      if (text) {
        haystack += `
${text}
`;
        collected += `${text}
`;
        changed = true;
      }
    }
  }
  return collected;
}
async function resolvePythonImportDependency(importNode, lines, filePath, usage, host, state, parts) {
  if (importNode.kind === "from") {
    return resolvePythonFromImportDependency(importNode, lines, filePath, usage, host, state, parts);
  }
  return resolvePythonPlainImportDependency(importNode, lines, filePath, usage, host, state, parts);
}
async function resolvePythonFromImportDependency(importNode, lines, filePath, usage, host, state, parts) {
  const localModulePath = await host.resolvePythonImport(filePath, importNode.module, importNode.level);
  let added = "";
  for (const alias of importNode.names) {
    if (alias.name === "*") {
      if (!localModulePath) {
        if (usesUnknownImportedNames(usage) && addPythonImportLine(lines, importNode, state)) {
          added += `${renderRange(lines, importNode)}
`;
        }
        continue;
      }
      const source = await host.readFile(localModulePath);
      if (!source) {
        continue;
      }
      const moduleInfo = await inspectPythonModule(source, host);
      for (const definition of moduleInfo.definitions) {
        if (!pythonDefinitionIsUsed(definition, usage)) {
          continue;
        }
        added += await extractPythonSymbolFromFile(localModulePath, definition.name, host, state, parts);
      }
      continue;
    }
    const exposedName = alias.asname ?? alias.name;
    if (!usage.names.includes(exposedName)) {
      continue;
    }
    const submodulePath = await host.resolvePythonImport(filePath, joinPythonModule(importNode.module, alias.name), importNode.level);
    const importTargetPath = localModulePath ?? submodulePath;
    if (!importTargetPath) {
      if (addPythonImportLine(lines, importNode, state)) {
        added += `${renderRange(lines, importNode)}
`;
      }
      continue;
    }
    const extracted = await extractPythonSymbolFromFile(importTargetPath, alias.name, host, state, parts);
    if (extracted) {
      added += extracted;
      if (alias.asname && alias.asname !== alias.name) {
        added += addPythonAlias(alias.name, alias.asname, state, parts);
      }
      continue;
    }
    const moduleBinding = alias.asname ?? alias.name;
    const moduleAttributes = usage.attributes[moduleBinding] ?? [];
    if (submodulePath && moduleAttributes.length) {
      for (const attribute of moduleAttributes) {
        added += await extractPythonSymbolFromFile(submodulePath, attribute, host, state, parts);
        addPythonNamespaceBinding(moduleBinding, attribute, state);
      }
    }
  }
  return added;
}
async function resolvePythonPlainImportDependency(importNode, lines, filePath, usage, host, state, parts) {
  let added = "";
  for (const alias of importNode.names) {
    const binding = alias.asname ?? alias.name.split(".")[0];
    const usedAttributes = usage.attributes[binding] ?? [];
    const bindingIsUsed = usage.names.includes(binding) || usedAttributes.length > 0;
    if (!bindingIsUsed) {
      continue;
    }
    const localModulePath = await host.resolvePythonImport(filePath, alias.name, 0);
    if (!localModulePath) {
      if (addPythonImportLine(lines, importNode, state)) {
        added += `${renderRange(lines, importNode)}
`;
      }
      continue;
    }
    for (const attribute of usedAttributes) {
      added += await extractPythonSymbolFromFile(localModulePath, attribute, host, state, parts);
      addPythonNamespaceBinding(binding, attribute, state);
    }
  }
  return added;
}
async function extractPythonSymbolFromFile(filePath, symbolName, host, state, parts) {
  const visitKey = `${filePath}#${symbolName}`;
  if (state.visitingSymbols.has(visitKey)) {
    return "";
  }
  const source = await host.readFile(filePath);
  if (!source) {
    return "";
  }
  state.visitingSymbols.add(visitKey);
  try {
    const lines = source.split(/\r?\n/);
    const moduleInfo = await inspectPythonModule(source, host);
    const definition = moduleInfo.definitions.find((candidate) => (candidate.names ?? [candidate.name]).includes(symbolName));
    if (!definition) {
      return "";
    }
    const text = renderRange(lines, definition);
    const dependencyText = await collectPythonDependencies(source, filePath, definition, text, host, state, parts);
    const added = addPythonRange(lines, filePath, definition, state, parts);
    return [dependencyText, added].filter((part) => part.trim()).join("\n");
  } finally {
    state.visitingSymbols.delete(visitKey);
  }
}
function addPythonRange(lines, filePath, range, state, parts) {
  const key = `${filePath}:L${range.start + 1}-L${range.end + 1}`;
  if (state.includedRanges.has(key)) {
    return "";
  }
  state.includedRanges.add(key);
  const text = renderRange(lines, range);
  parts.push(text);
  return text;
}
function addPythonImportLine(lines, range, state) {
  const text = renderRange(lines, range);
  if (state.includedImports.has(text)) {
    return false;
  }
  state.includedImports.add(text);
  return true;
}
function addPythonAlias(name, asname, state, parts) {
  const key = `${asname}=${name}`;
  if (state.aliases.has(key)) {
    return "";
  }
  state.aliases.add(key);
  const text = `${asname} = ${name}`;
  parts.push(text);
  return `${text}
`;
}
function addPythonNamespaceBinding(binding, attribute, state) {
  state.needsNamespaceRuntime = true;
  const attributes = state.namespaceBindings.get(binding) ?? /* @__PURE__ */ new Set();
  attributes.add(attribute);
  state.namespaceBindings.set(binding, attributes);
}
function renderPythonNamespaceBindings(state) {
  if (!state.namespaceBindings.size) {
    return "";
  }
  const lines = state.needsNamespaceRuntime ? ["import types as _loom_types"] : [];
  for (const [binding, attributes] of state.namespaceBindings) {
    lines.push(`${binding} = _loom_types.SimpleNamespace()`);
    for (const attribute of attributes) {
      lines.push(`${binding}.${attribute} = ${attribute}`);
    }
  }
  return lines.join("\n");
}
function findPythonSymbolRange(moduleInfo, symbolName) {
  const exact = moduleInfo.definitions.find((definition) => (definition.names ?? [definition.name]).includes(symbolName));
  return exact ? { start: exact.start, end: exact.end } : null;
}
function pythonDefinitionIsUsed(definition, usage) {
  return (definition.names ?? [definition.name]).some((name) => usage.names.includes(name));
}
function usesUnknownImportedNames(usage) {
  return usage.names.length > 0;
}
function joinPythonModule(moduleName, name) {
  return moduleName ? `${moduleName}.${name}` : name;
}
async function inspectPythonModule(source, host) {
  return runPythonAst(source, "module", host);
}
async function inspectPythonUsage(source, host) {
  return runPythonAst(source, "usage", host);
}
async function runPythonAst(source, mode, host) {
  const command = splitCommandLine(host.pythonExecutable?.trim() || "python3");
  const executable = command[0] ?? "python3";
  const args = [...command.slice(1), "-c", PYTHON_AST_HELPER];
  return new Promise((resolve, reject) => {
    const child = (0, import_child_process3.spawn)(executable, args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error((stderr || stdout || `Python AST helper exited with code ${code}.`).trim()));
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch (error) {
        reject(error);
      }
    });
    child.stdin.end(JSON.stringify({ mode, source }));
  });
}
function findLineRange(lines, reference) {
  const start = Math.max((reference.lineStart ?? 1) - 1, 0);
  const end = Math.min((reference.lineEnd ?? reference.lineStart ?? lines.length) - 1, lines.length - 1);
  if (start > end || start >= lines.length) {
    return null;
  }
  return { start, end };
}
function findSymbolRange(lines, language, symbolName) {
  const definitions = collectDefinitions(lines, language);
  const exact = definitions.find((definition) => definitionNames(definition).includes(symbolName));
  if (exact) {
    return { start: exact.start, end: exact.end };
  }
  const symbolPattern = new RegExp(`\\b${escapeRegex(symbolName)}\\b`);
  const line = lines.findIndex((candidate) => symbolPattern.test(candidate));
  if (line < 0) {
    return null;
  }
  return lines[line].includes("{") ? { start: line, end: findBraceRangeEnd(lines, line) } : { start: line, end: line };
}
function collectDependencySource(lines, language, selectedRange, selected) {
  const prologue = collectPrologue(lines, language, selectedRange.start);
  const definitions = collectDefinitions(lines, language).filter((definition) => !rangesOverlap(definition, selectedRange));
  const selectedDefinitions = traceDefinitions(selected, definitions, lines);
  return [...prologue, ...selectedDefinitions.map((definition) => renderRange(lines, definition))].filter((part) => part.trim()).join("\n\n");
}
function traceDefinitions(seed, definitions, lines) {
  const selected = [];
  const selectedKeys = /* @__PURE__ */ new Set();
  let haystack = seed;
  let changed = true;
  while (changed) {
    changed = false;
    for (const definition of definitions) {
      const key = `${definition.start}:${definition.end}:${definition.name}`;
      if (selectedKeys.has(key)) {
        continue;
      }
      if (!definitionNames(definition).some((name) => sourceUsesName(haystack, name))) {
        continue;
      }
      selectedKeys.add(key);
      selected.push(definition);
      haystack += `
${renderRange(lines, definition)}
`;
      changed = true;
    }
  }
  return selected.sort((left, right) => left.start - right.start);
}
function collectPrologue(lines, language, beforeLine) {
  const prologue = [];
  const max = Math.max(beforeLine, 0);
  for (let index = 0; index < max; index += 1) {
    const line = lines[index];
    if (isPrologueLine(line, language)) {
      prologue.push(line);
    }
  }
  return prologue.length ? [prologue.join("\n")] : [];
}
function isPrologueLine(line, language) {
  const trimmed = line.trim();
  if (!trimmed) {
    return false;
  }
  switch (language) {
    case "python":
      return /^(from\s+\S+\s+import\s+|import\s+)/.test(trimmed);
    case "javascript":
    case "typescript":
      return /^(import\s+|export\s+.*\s+from\s+|(?:const|let|var)\s+\w+\s*=\s*require\s*\()/.test(trimmed);
    case "c":
    case "cpp":
    case "llvm-ir":
      return trimmed.startsWith("#") || trimmed.startsWith("target ") || trimmed.startsWith("source_filename");
    case "haskell":
      return /^(module\s+|import\s+)/.test(trimmed);
    case "ocaml":
      return /^(open\s+|include\s+|#use\s+)/.test(trimmed);
    case "java":
      return /^(package\s+|import\s+)/.test(trimmed);
    default:
      return false;
  }
}
function collectDefinitions(lines, language) {
  switch (language) {
    case "python":
      return collectPythonDefinitions(lines);
    case "javascript":
    case "typescript":
      return collectBraceDefinitions(lines, /^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\b|^(?:export\s+)?class\s+([A-Za-z_$][\w$]*)\b|^(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/);
    case "c":
      return collectCDefinitions(lines, false);
    case "cpp":
      return collectCDefinitions(lines, true);
    case "haskell":
      return collectHaskellDefinitions(lines);
    case "ocaml":
      return collectOcamlDefinitions(lines);
    case "java":
      return collectBraceDefinitions(lines, /^\s*(?:public|private|protected|static|final|abstract|\s)*\s*(?:class|interface|enum|record)\s+([A-Za-z_]\w*)\b|^\s*(?:public|private|protected|static|final|synchronized|native|\s)+[\w<>\[\],.?]+\s+([A-Za-z_]\w*)\s*\([^;]*\)\s*\{/);
    case "llvm-ir":
      return collectLlvmDefinitions(lines);
    default:
      return [];
  }
}
function collectPythonDefinitions(lines) {
  const definitions = [];
  for (let index = 0; index < lines.length; index += 1) {
    const assignment = lines[index].match(/^([A-Za-z_]\w*)\s*[:=]/);
    if (assignment) {
      definitions.push({ name: assignment[1], start: index, end: index });
      continue;
    }
    const match = lines[index].match(/^(\s*)(?:async\s+)?(?:def|class)\s+([A-Za-z_]\w*)\b/);
    if (!match) {
      continue;
    }
    const indent = match[1].length;
    let start = index;
    while (start > 0 && lines[start - 1].trim().startsWith("@") && getIndent(lines[start - 1]) === indent) {
      start -= 1;
    }
    let end = index;
    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      if (lines[cursor].trim() && getIndent(lines[cursor]) <= indent) {
        break;
      }
      end = cursor;
    }
    definitions.push({ name: match[2], start, end });
  }
  return definitions;
}
function collectCDefinitions(lines, isCpp) {
  const definitions = [];
  let depth = 0;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();
    const topLevel = depth === 0;
    if (topLevel && trimmed) {
      const macro = trimmed.match(/^#\s*define\s+([A-Za-z_]\w*)\b/);
      if (macro) {
        definitions.push({ name: macro[1], start: index, end: index });
      } else if (!trimmed.startsWith("#") && !isCCommentLine(trimmed)) {
        const typeDefinition = matchCTypeDefinition(lines, index, isCpp);
        if (typeDefinition) {
          definitions.push(typeDefinition);
          index = Math.max(index, typeDefinition.end);
        } else {
          const functionDefinition = matchCFunctionDefinition(lines, index);
          if (functionDefinition) {
            definitions.push(functionDefinition);
            index = Math.max(index, functionDefinition.end);
          } else {
            const globalDefinition = matchCGlobalDefinition(line, index);
            if (globalDefinition) {
              definitions.push(globalDefinition);
            }
          }
        }
      }
    }
    depth += braceDelta(line);
    if (depth < 0) {
      depth = 0;
    }
  }
  return definitions;
}
function matchCTypeDefinition(lines, start, isCpp) {
  const header = lines.slice(start, Math.min(lines.length, start + 8)).join(" ");
  const keywordPattern = isCpp ? "(?:typedef\\s+)?(?:struct|class|enum|union)" : "(?:typedef\\s+)?(?:struct|enum|union)";
  const named = header.match(new RegExp(`^\\s*${keywordPattern}\\s+([A-Za-z_]\\w*)\\b`));
  const anonymousTypedef = header.match(/^\s*typedef\s+(?:struct|enum|union)\b[\s\S]*?\}\s*([A-Za-z_]\w*)\s*;/);
  const name = named?.[1] ?? anonymousTypedef?.[1];
  if (!name) {
    return null;
  }
  const end = findCDeclarationEnd(lines, start);
  return { name, names: [name], start, end };
}
function matchCFunctionDefinition(lines, start) {
  const headerLines = lines.slice(start, Math.min(lines.length, start + 12));
  const joined = headerLines.join(" ");
  const braceOffset = headerLines.findIndex((line) => line.includes("{"));
  if (braceOffset < 0 || joined.indexOf(";") >= 0 && joined.indexOf(";") < joined.indexOf("{")) {
    return null;
  }
  const matches = [...joined.matchAll(/([A-Za-z_]\w*(?:::[A-Za-z_]\w*)?|operator\s*[^\s(]+)\s*\([^;{}]*\)\s*(?:const\b[^{}]*)?(?:noexcept\b[^{}]*)?(?:->\s*[^{}]+)?\{/g)];
  const name = matches[0]?.[1]?.replace(/\s+/g, "");
  if (!name || isCControlKeyword(name)) {
    return null;
  }
  const braceLine = start + braceOffset;
  const shortName = name.includes("::") ? name.split("::").pop() ?? name : name;
  return {
    name: shortName,
    names: [.../* @__PURE__ */ new Set([shortName, name])],
    start,
    end: findBraceRangeEnd(lines, braceLine)
  };
}
function matchCGlobalDefinition(line, index) {
  const trimmed = line.trim();
  if (!trimmed.endsWith(";") || trimmed.includes("(") || /^(return|using|namespace|template)\b/.test(trimmed)) {
    return null;
  }
  const withoutInitializer = trimmed.split("=")[0].replace(/\[[^\]]*]/g, "");
  const match = withoutInitializer.match(/([A-Za-z_]\w*)\s*(?:[,;]|$)/g)?.pop()?.match(/([A-Za-z_]\w*)/);
  const name = match?.[1];
  if (!name || /^(const|static|extern|volatile|unsigned|signed|long|short|int|char|float|double|void|auto)$/.test(name)) {
    return null;
  }
  return { name, start: index, end: index };
}
function collectLlvmDefinitions(lines) {
  const definitions = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const symbol = line.match(/^\s*(?:define|declare)\b.*@([A-Za-z$._-][A-Za-z$._0-9-]*)\s*\(/);
    if (symbol) {
      const end = line.trimStart().startsWith("define") ? findBraceRangeEnd(lines, index) : index;
      definitions.push({ name: symbol[1], names: [symbol[1], `@${symbol[1]}`], start: index, end });
      continue;
    }
    const global = line.match(/^\s*@([A-Za-z$._-][A-Za-z$._0-9-]*)\s*=/);
    if (global) {
      definitions.push({ name: global[1], names: [global[1], `@${global[1]}`], start: index, end: index });
    }
  }
  return definitions;
}
function collectHaskellDefinitions(lines) {
  const definitions = [];
  for (let index = 0; index < lines.length; index += 1) {
    const trimmed = lines[index].trim();
    if (!trimmed || getIndent(lines[index]) > 0 || /^(module|import)\b/.test(trimmed)) {
      continue;
    }
    const names = getHaskellDefinitionNames(trimmed);
    if (!names.length) {
      continue;
    }
    const end = findHaskellRangeEnd(lines, index, names[0]);
    definitions.push({ name: names[0], names, start: index, end });
    index = end;
  }
  return definitions;
}
function collectOcamlDefinitions(lines) {
  const definitions = [];
  for (let index = 0; index < lines.length; index += 1) {
    const trimmed = lines[index].trim();
    if (!trimmed || getIndent(lines[index]) > 0 || /^(open|include|#use)\b/.test(trimmed)) {
      continue;
    }
    const names = getOcamlDefinitionNames(trimmed);
    if (!names.length) {
      continue;
    }
    const end = findLayoutRangeEnd(lines, index, isOcamlTopLevelStart);
    definitions.push({ name: names[0], names, start: index, end });
    index = end;
  }
  return definitions;
}
function collectBraceDefinitions(lines, pattern) {
  const definitions = [];
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(pattern);
    const name = match?.slice(1).find(Boolean);
    if (!name) {
      continue;
    }
    definitions.push({ name, start: index, end: findBraceRangeEnd(lines, index) });
  }
  return definitions;
}
function findBraceRangeEnd(lines, start) {
  if (!lines[start].includes("{")) {
    return start;
  }
  let depth = 0;
  let sawBrace = false;
  for (let index = start; index < lines.length; index += 1) {
    for (const char of lines[index]) {
      if (char === "{") {
        depth += 1;
        sawBrace = true;
      } else if (char === "}") {
        depth -= 1;
      }
    }
    if (sawBrace && depth <= 0) {
      return index;
    }
  }
  return start;
}
function findCDeclarationEnd(lines, start) {
  let sawBrace = false;
  let depth = 0;
  for (let index = start; index < lines.length; index += 1) {
    for (const char of lines[index]) {
      if (char === "{") {
        depth += 1;
        sawBrace = true;
      } else if (char === "}") {
        depth -= 1;
      }
    }
    if ((!sawBrace || depth <= 0) && lines[index].includes(";")) {
      return index;
    }
  }
  return start;
}
function braceDelta(line) {
  let delta = 0;
  for (const char of line) {
    if (char === "{") {
      delta += 1;
    } else if (char === "}") {
      delta -= 1;
    }
  }
  return delta;
}
function isCCommentLine(trimmed) {
  return trimmed.startsWith("//") || trimmed.startsWith("/*") || trimmed.startsWith("*");
}
function isCControlKeyword(name) {
  return ["if", "for", "while", "switch", "catch"].includes(name);
}
function getHaskellDefinitionNames(trimmed) {
  const signature = trimmed.match(/^([a-z_][\w']*)\s*::/);
  if (signature) {
    return [signature[1]];
  }
  const binding = trimmed.match(/^([a-z_][\w']*)\b.*=/);
  if (binding) {
    return [binding[1]];
  }
  const typeLike = trimmed.match(/^(?:data|newtype|type|class)\s+([A-Z][\w']*)\b/);
  if (typeLike) {
    return [typeLike[1]];
  }
  const instance = trimmed.match(/^instance\b.*?\b([A-Z][\w']*)\b/);
  return instance ? [instance[1]] : [];
}
function getOcamlDefinitionNames(trimmed) {
  const letBinding = trimmed.match(/^let\s+(?:rec\s+)?(?:\(([^)]+)\)|([a-z_][\w']*))/);
  if (letBinding) {
    return [letBinding[1] ?? letBinding[2]];
  }
  const typeBinding = trimmed.match(/^type\s+([a-z_][\w']*)/);
  if (typeBinding) {
    return [typeBinding[1]];
  }
  const moduleBinding = trimmed.match(/^module\s+([A-Z][\w']*)/);
  if (moduleBinding) {
    return [moduleBinding[1]];
  }
  return [];
}
function findLayoutRangeEnd(lines, start, isTopLevelStart) {
  let end = start;
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.trim() && getIndent(line) === 0 && isTopLevelStart(line.trim())) {
      break;
    }
    end = index;
  }
  return end;
}
function findHaskellRangeEnd(lines, start, name) {
  let end = start;
  let allowMatchingEquation = lines[start].trim().startsWith(`${name} ::`);
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();
    if (trimmed && getIndent(line) === 0 && isHaskellTopLevelStart(trimmed)) {
      if (allowMatchingEquation && trimmed.startsWith(`${name} `) && trimmed.includes("=")) {
        allowMatchingEquation = false;
        end = index;
        continue;
      }
      break;
    }
    end = index;
  }
  return end;
}
function isHaskellTopLevelStart(trimmed) {
  return /^(module|import|data|newtype|type|class|instance)\b/.test(trimmed) || /^[a-z_][\w']*\s*(?:::|.*=)/.test(trimmed);
}
function isOcamlTopLevelStart(trimmed) {
  return /^(open|include|#use|let|type|module)\b/.test(trimmed);
}
function renderRange(lines, range) {
  return lines.slice(range.start, range.end + 1).join("\n");
}
function rangesOverlap(left, right) {
  return left.start <= right.end && right.start <= left.end;
}
function getIndent(line) {
  return line.match(/^\s*/)?.[0].length ?? 0;
}
function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function definitionNames(definition) {
  return definition.names?.length ? definition.names : [definition.name];
}
function sourceUsesName(source, name) {
  if (name.startsWith("@")) {
    return new RegExp(`${escapeRegex(name)}\\b`).test(source);
  }
  return new RegExp(`\\b${escapeRegex(name)}\\b`).test(source);
}
function formatSourceDescription(reference, range) {
  if (reference.symbolName) {
    return `${reference.filePath}#${reference.symbolName}`;
  }
  if (range) {
    return `${reference.filePath}:L${range.start + 1}-L${range.end + 1}`;
  }
  return reference.filePath;
}
var PYTHON_AST_HELPER = String.raw`
import ast
import json
import sys

payload = json.loads(sys.stdin.read())
source = payload.get("source", "")
mode = payload.get("mode", "module")

def range_start(node):
    lineno = getattr(node, "lineno", 1)
    decorators = getattr(node, "decorator_list", None) or []
    if decorators:
        lineno = min(lineno, *(getattr(decorator, "lineno", lineno) for decorator in decorators))
    return lineno - 1

def range_end(node):
    return getattr(node, "end_lineno", getattr(node, "lineno", 1)) - 1

def target_names(target):
    if isinstance(target, ast.Name):
        return [target.id]
    if isinstance(target, (ast.Tuple, ast.List)):
        names = []
        for item in target.elts:
            names.extend(target_names(item))
        return names
    return []

def definition_names(node):
    if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
        return [node.name]
    if isinstance(node, ast.Assign):
        names = []
        for target in node.targets:
            names.extend(target_names(target))
        return names
    if isinstance(node, (ast.AnnAssign, ast.AugAssign)):
        return target_names(node.target)
    return []

def inspect_module(tree):
    definitions = []
    imports = []
    for node in tree.body:
        names = definition_names(node)
        if names:
            definitions.append({
                "name": names[0],
                "names": names,
                "start": range_start(node),
                "end": range_end(node),
            })
            continue
        if isinstance(node, ast.Import):
            imports.append({
                "kind": "import",
                "module": "",
                "level": 0,
                "names": [{"name": item.name, "asname": item.asname} for item in node.names],
                "start": range_start(node),
                "end": range_end(node),
            })
            continue
        if isinstance(node, ast.ImportFrom):
            imports.append({
                "kind": "from",
                "module": node.module or "",
                "level": node.level,
                "names": [{"name": item.name, "asname": item.asname} for item in node.names],
                "start": range_start(node),
                "end": range_end(node),
            })
    return {"definitions": definitions, "imports": imports}

def attribute_chain(node):
    chain = []
    current = node
    while isinstance(current, ast.Attribute):
        chain.append(current.attr)
        current = current.value
    if isinstance(current, ast.Name):
        chain.append(current.id)
        chain.reverse()
        return chain
    return []

class UsageVisitor(ast.NodeVisitor):
    def __init__(self):
        self.names = set()
        self.attributes = {}

    def visit_Name(self, node):
        if isinstance(node.ctx, ast.Load):
            self.names.add(node.id)

    def visit_Attribute(self, node):
        chain = attribute_chain(node)
        if len(chain) >= 2:
            self.names.add(chain[0])
            self.attributes.setdefault(chain[0], set()).add(chain[1])
        self.generic_visit(node)

def inspect_usage(tree):
    visitor = UsageVisitor()
    visitor.visit(tree)
    return {
        "names": sorted(visitor.names),
        "attributes": {key: sorted(value) for key, value in visitor.attributes.items()},
    }

try:
    tree = ast.parse(source)
except SyntaxError:
    print(json.dumps({"definitions": [], "imports": []} if mode == "module" else {"names": [], "attributes": {}}))
    raise SystemExit(0)

if mode == "module":
    print(json.dumps(inspect_module(tree)))
else:
    print(json.dumps(inspect_usage(tree)))
`;

// src/sourceHarness.ts
function buildSourceReferenceHarness(block) {
  const call = block.sourceReference?.call;
  if (!call) {
    return block.content;
  }
  const symbolName = block.sourceReference?.symbolName?.trim();
  const input = block.content.trim();
  const expression = call.expression?.trim() ? renderSourceCallTemplate(call.expression, input, symbolName) : renderDefaultSourceCall(symbolName, call.args, input);
  return renderLanguageCallHarness(block.language, expression, call.print);
}
function renderDefaultSourceCall(symbolName, args, input) {
  if (!symbolName) {
    throw new Error("loom-call needs loom-symbol when no call expression is provided.");
  }
  const renderedArgs = renderSourceCallTemplate(args?.trim() || "{input}", input, symbolName);
  return `${symbolName}(${renderedArgs})`;
}
function renderSourceCallTemplate(template, input, symbolName) {
  return template.replaceAll("{input}", input).replaceAll("{symbol}", symbolName ?? "");
}
function renderLanguageCallHarness(language, expression, print) {
  if (!print) {
    return renderExpressionStatement(language, expression);
  }
  switch (language) {
    case "python":
      return `print(${expression})`;
    case "javascript":
    case "typescript":
      return `console.log(${expression});`;
    case "c":
      return `#include <stdio.h>
int main(void) { printf("%d\\n", ${expression}); return 0; }`;
    case "cpp":
      return `#include <iostream>
int main() { std::cout << (${expression}) << "\\n"; return 0; }`;
    case "ocaml":
      return `let () = print_endline (${expression})`;
    default:
      throw new Error(`loom-call cannot generate a printed harness for ${language}. Use loom-print=false or write the harness in the block body.`);
  }
}
function renderExpressionStatement(language, expression) {
  switch (language) {
    case "python":
    case "ocaml":
      return expression;
    default:
      return expression.endsWith(";") ? expression : `${expression};`;
  }
}

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
  if (output.sourcePreview?.content.trim()) {
    createSourcePreview(body, output.sourcePreview);
  }
  if (!output.result.stdout.trim() && !output.result.warning?.trim() && !output.result.stderr.trim() && !output.sourcePreview?.content.trim()) {
    const empty = body.createDiv({ cls: "loom-output-empty" });
    empty.setText("No output");
  }
}
function createStream(container, label, content) {
  const section = container.createDiv({ cls: "loom-output-stream" });
  section.createDiv({ cls: "loom-output-stream-label", text: label });
  section.createEl("pre", { cls: "loom-output-pre", text: content });
}
function createSourcePreview(container, preview) {
  const details = container.createEl("details", { cls: "loom-source-preview" });
  details.open = preview.expanded;
  const summary = details.createEl("summary", { cls: "loom-source-preview-summary" });
  summary.createSpan({ text: "Extracted source" });
  summary.createSpan({ cls: "loom-source-preview-meta", text: formatSourcePreviewMeta(preview) });
  details.createEl("pre", { cls: "loom-output-pre loom-source-preview-pre", text: preview.content });
}
function formatSourcePreviewMeta(preview) {
  const capability = preview.capability;
  if (!capability || !preview.showCapabilityMetadata) {
    return `${preview.language} \xB7 ${preview.description}`;
  }
  return [
    preview.language,
    preview.description,
    `symbols:${capability.symbolExtraction}`,
    `deps:${capability.dependencyTracing}`,
    `call:${capability.callHarness}`
  ].join(" \xB7 ");
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
      const resolvedBlock = await this.resolveExecutableBlock(file, block);
      const result = containerGroup ? await this.containerRunner.run(resolvedBlock.block, runContext, this.settings, containerGroup) : await runner.run(resolvedBlock.block, runContext, this.settings);
      if (result.timedOut) {
        result.stderr = result.stderr || `Execution timed out after ${this.settings.defaultTimeoutMs} ms.`;
      } else if (result.cancelled) {
        result.stderr = result.stderr || "Execution cancelled.";
      } else if (!result.success && !result.stderr.trim()) {
        result.stderr = "Process exited unsuccessfully.";
      }
      if (resolvedBlock.sourcePreview) {
        const sourceNotice = `Ran extracted source from ${resolvedBlock.sourcePreview.description}.`;
        result.warning = result.warning ? `${sourceNotice}
${result.warning}` : sourceNotice;
      }
      this.outputs.set(block.id, {
        blockId: block.id,
        block,
        result,
        sourcePreview: resolvedBlock.sourcePreview,
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
    const fileFolder = (0, import_path8.dirname)(file.path);
    const resolved = fileFolder === "." ? adapterBasePath : `${adapterBasePath}/${fileFolder}`;
    return resolved || process.cwd();
  }
  async resolveExecutableBlock(file, block) {
    if (!block.sourceReference) {
      return { block };
    }
    const referencePath = this.resolveReferencedVaultPath(file, block.sourceReference.filePath);
    const sourceFile = this.app.vault.getAbstractFileByPath(referencePath);
    if (!(sourceFile instanceof import_obsidian5.TFile)) {
      throw new Error(`Referenced source file not found: ${referencePath}`);
    }
    const harness = buildSourceReferenceHarness(block);
    const externalExtractor = this.getCustomLanguageExtractor(block.language, file);
    const resolved = await resolveReferencedSource(
      await this.app.vault.cachedRead(sourceFile),
      { ...block.sourceReference, filePath: referencePath },
      block.language,
      harness,
      {
        pythonExecutable: this.settings.pythonExecutable.trim() || "python3",
        externalExtractor,
        readFile: async (filePath) => {
          const importedFile = this.app.vault.getAbstractFileByPath((0, import_obsidian5.normalizePath)(filePath));
          return importedFile instanceof import_obsidian5.TFile ? this.app.vault.cachedRead(importedFile) : null;
        },
        resolvePythonImport: async (fromFilePath, moduleName, level) => this.resolvePythonImportVaultPath(fromFilePath, moduleName, level)
      }
    );
    const capability = getLanguageCapability(block.language, Boolean(externalExtractor));
    const shouldShowPreview = (this.settings.extractedSourcePreviewMode || "collapsed") !== "hidden";
    return {
      block: {
        ...block,
        content: resolved.content
      },
      sourcePreview: shouldShowPreview ? {
        description: resolved.description,
        language: block.language,
        content: resolved.content,
        capability,
        expanded: this.settings.extractedSourcePreviewMode === "expanded",
        showCapabilityMetadata: this.settings.showLanguageCapabilityMetadata ?? true
      } : void 0
    };
  }
  resolveReferencedVaultPath(file, referencePath) {
    const trimmed = referencePath.trim();
    if (!trimmed) {
      return trimmed;
    }
    if (trimmed.startsWith("/")) {
      return (0, import_obsidian5.normalizePath)(trimmed.slice(1));
    }
    const baseDir = (0, import_path8.dirname)(file.path);
    return (0, import_obsidian5.normalizePath)(baseDir === "." ? trimmed : `${baseDir}/${trimmed}`);
  }
  resolvePythonImportVaultPath(fromFilePath, moduleName, level) {
    const modulePath = moduleName.split(".").map((part) => part.trim()).filter(Boolean).join("/");
    const fromDir = (0, import_path8.dirname)(fromFilePath);
    const baseDirs = level > 0 ? [this.ascendVaultPath(fromDir === "." ? "" : fromDir, level - 1)] : [fromDir === "." ? "" : fromDir, ""];
    for (const baseDir of baseDirs) {
      const candidates = this.getPythonImportCandidates(baseDir, modulePath);
      for (const candidate of candidates) {
        const normalized = (0, import_obsidian5.normalizePath)(candidate);
        if (this.app.vault.getAbstractFileByPath(normalized) instanceof import_obsidian5.TFile) {
          return normalized;
        }
      }
    }
    return null;
  }
  getPythonImportCandidates(baseDir, modulePath) {
    const prefix = baseDir ? `${baseDir}/` : "";
    if (!modulePath) {
      return [`${prefix}__init__.py`];
    }
    return [
      `${prefix}${modulePath}.py`,
      `${prefix}${modulePath}/__init__.py`
    ];
  }
  ascendVaultPath(path, levels) {
    let current = path;
    for (let index = 0; index < levels; index += 1) {
      const next = (0, import_path8.dirname)(current);
      current = next === "." ? "" : next;
    }
    return current;
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
  getCustomLanguageExtractor(languageId, file) {
    const normalized = languageId.trim().toLowerCase();
    const language = this.settings.customLanguages.find((candidate) => {
      const name = candidate.name.trim().toLowerCase();
      const aliases = candidate.aliases.split(",").map((alias) => alias.trim().toLowerCase()).filter(Boolean);
      return name === normalized || aliases.includes(normalized);
    });
    if (!language) {
      return void 0;
    }
    const mode = language.extractorMode || "command";
    const executable = mode === "transpile-c" ? language.transpileExecutable?.trim() : language.extractorExecutable?.trim();
    const args = mode === "transpile-c" ? language.transpileArgs || "{request}" : language.extractorArgs || "{request}";
    if (!executable) {
      return void 0;
    }
    return {
      mode,
      language: language.name,
      executable,
      args: splitCommandLine(args),
      workingDirectory: this.resolveWorkingDirectory(file),
      timeoutMs: this.settings.defaultTimeoutMs
    };
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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsic3JjL21haW4udHMiLCAic3JjL2V4ZWN1dGlvbi9jb250YWluZXJSdW5uZXIudHMiLCAic3JjL2V4ZWN1dGlvbi9wcm9jZXNzUnVubmVyLnRzIiwgInNyYy91dGlscy9jb21tYW5kLnRzIiwgInNyYy9sbHZtSGlnaGxpZ2h0LnRzIiwgInNyYy91dGlscy9oYXNoLnRzIiwgInNyYy9wYXJzZXIudHMiLCAic3JjL2xhbmd1YWdlQ2FwYWJpbGl0aWVzLnRzIiwgInNyYy9ydW5uZXJzL25vZGUudHMiLCAic3JjL3J1bm5lcnMvY3VzdG9tLnRzIiwgInNyYy9ydW5uZXJzL2ludGVycHJldGVkLnRzIiwgInNyYy9ydW5uZXJzL2xsdm0udHMiLCAic3JjL3J1bm5lcnMvbWFuYWdlZENvbXBpbGVkLnRzIiwgInNyYy9ydW5uZXJzL25hdGl2ZUNvbXBpbGVkLnRzIiwgInNyYy9ydW5uZXJzL29jYW1sLnRzIiwgInNyYy9ydW5uZXJzL3B5dGhvbi50cyIsICJzcmMvcnVubmVycy9wcm9vZi50cyIsICJzcmMvcnVubmVycy9yZWdpc3RyeS50cyIsICJzcmMvc2V0dGluZ3MudHMiLCAic3JjL3NvdXJjZUV4dHJhY3QudHMiLCAic3JjL3NvdXJjZUhhcm5lc3MudHMiLCAic3JjL3VpL2NvZGVCbG9ja1Rvb2xiYXIudHMiLCAic3JjL3VpL291dHB1dFBhbmVsLnRzIl0sCiAgInNvdXJjZXNDb250ZW50IjogWyJpbXBvcnQge1xuICBNYXJrZG93blJlbmRlckNoaWxkLFxuICBNYXJrZG93blZpZXcsXG4gIE1vZGFsLFxuICBOb3RpY2UsXG4gIFBsdWdpbixcbiAgVEZpbGUsXG4gIFdvcmtzcGFjZUxlYWYsXG4gIG5vcm1hbGl6ZVBhdGgsXG59IGZyb20gXCJvYnNpZGlhblwiO1xuaW1wb3J0IHsgUmFuZ2VTZXRCdWlsZGVyLCBTdGF0ZUVmZmVjdCB9IGZyb20gXCJAY29kZW1pcnJvci9zdGF0ZVwiO1xuaW1wb3J0IHsgRGVjb3JhdGlvbiwgRWRpdG9yVmlldywgVmlld1BsdWdpbiwgVmlld1VwZGF0ZSwgV2lkZ2V0VHlwZSB9IGZyb20gXCJAY29kZW1pcnJvci92aWV3XCI7XG5pbXBvcnQgeyBkaXJuYW1lIH0gZnJvbSBcInBhdGhcIjtcbmltcG9ydCB7IGxvb21Db250YWluZXJSdW5uZXIgfSBmcm9tIFwiLi9leGVjdXRpb24vY29udGFpbmVyUnVubmVyXCI7XG5pbXBvcnQgeyBhZGRMbHZtRGVjb3JhdGlvbnMsIGhpZ2hsaWdodExsdm1FbGVtZW50IH0gZnJvbSBcIi4vbGx2bUhpZ2hsaWdodFwiO1xuaW1wb3J0IHsgZmluZEJsb2NrQXRMaW5lLCBnZXRTdXBwb3J0ZWRMYW5ndWFnZUFsaWFzZXMsIHBhcnNlTWFya2Rvd25Db2RlQmxvY2tzIH0gZnJvbSBcIi4vcGFyc2VyXCI7XG5pbXBvcnQgeyBnZXRMYW5ndWFnZUNhcGFiaWxpdHkgfSBmcm9tIFwiLi9sYW5ndWFnZUNhcGFiaWxpdGllc1wiO1xuaW1wb3J0IHsgTm9kZVJ1bm5lciB9IGZyb20gXCIuL3J1bm5lcnMvbm9kZVwiO1xuaW1wb3J0IHsgQ3VzdG9tTGFuZ3VhZ2VSdW5uZXIgfSBmcm9tIFwiLi9ydW5uZXJzL2N1c3RvbVwiO1xuaW1wb3J0IHsgSW50ZXJwcmV0ZWRSdW5uZXIgfSBmcm9tIFwiLi9ydW5uZXJzL2ludGVycHJldGVkXCI7XG5pbXBvcnQgeyBMbHZtUnVubmVyIH0gZnJvbSBcIi4vcnVubmVycy9sbHZtXCI7XG5pbXBvcnQgeyBNYW5hZ2VkQ29tcGlsZWRSdW5uZXIgfSBmcm9tIFwiLi9ydW5uZXJzL21hbmFnZWRDb21waWxlZFwiO1xuaW1wb3J0IHsgTmF0aXZlQ29tcGlsZWRSdW5uZXIgfSBmcm9tIFwiLi9ydW5uZXJzL25hdGl2ZUNvbXBpbGVkXCI7XG5pbXBvcnQgeyBPY2FtbFJ1bm5lciB9IGZyb20gXCIuL3J1bm5lcnMvb2NhbWxcIjtcbmltcG9ydCB7IFB5dGhvblJ1bm5lciB9IGZyb20gXCIuL3J1bm5lcnMvcHl0aG9uXCI7XG5pbXBvcnQgeyBQcm9vZlJ1bm5lciB9IGZyb20gXCIuL3J1bm5lcnMvcHJvb2ZcIjtcbmltcG9ydCB7IGxvb21SdW5uZXJSZWdpc3RyeSB9IGZyb20gXCIuL3J1bm5lcnMvcmVnaXN0cnlcIjtcbmltcG9ydCB7IERFRkFVTFRfU0VUVElOR1MsIGxvb21TZXR0aW5nVGFiLCBzaG93RXhlY3V0aW9uRGlzYWJsZWROb3RpY2UgfSBmcm9tIFwiLi9zZXR0aW5nc1wiO1xuaW1wb3J0IHsgcmVzb2x2ZVJlZmVyZW5jZWRTb3VyY2UgfSBmcm9tIFwiLi9zb3VyY2VFeHRyYWN0XCI7XG5pbXBvcnQgeyBidWlsZFNvdXJjZVJlZmVyZW5jZUhhcm5lc3MgfSBmcm9tIFwiLi9zb3VyY2VIYXJuZXNzXCI7XG5pbXBvcnQgeyBjcmVhdGVDb2RlQmxvY2tUb29sYmFyIH0gZnJvbSBcIi4vdWkvY29kZUJsb2NrVG9vbGJhclwiO1xuaW1wb3J0IHsgY3JlYXRlT3V0cHV0UGFuZWwsIGNyZWF0ZVJ1bm5pbmdQYW5lbCB9IGZyb20gXCIuL3VpL291dHB1dFBhbmVsXCI7XG5pbXBvcnQgeyBzcGxpdENvbW1hbmRMaW5lIH0gZnJvbSBcIi4vdXRpbHMvY29tbWFuZFwiO1xuaW1wb3J0IHR5cGUgeyBsb29tQ29kZUJsb2NrLCBsb29tUGx1Z2luU2V0dGluZ3MsIGxvb21TdG9yZWRPdXRwdXQgfSBmcm9tIFwiLi90eXBlc1wiO1xuXG5jb25zdCBsb29tUmVmcmVzaEVmZmVjdCA9IFN0YXRlRWZmZWN0LmRlZmluZTx2b2lkPigpO1xuXG5jbGFzcyBFeGVjdXRpb25Db25zZW50TW9kYWwgZXh0ZW5kcyBNb2RhbCB7XG4gIGNvbnN0cnVjdG9yKFxuICAgIGFwcDogUGx1Z2luW1wiYXBwXCJdLFxuICAgIHByaXZhdGUgcmVhZG9ubHkgb25Db25maXJtOiAoKSA9PiBQcm9taXNlPHZvaWQ+LFxuICApIHtcbiAgICBzdXBlcihhcHApO1xuICB9XG5cbiAgb25PcGVuKCk6IHZvaWQge1xuICAgIGNvbnN0IHsgY29udGVudEVsIH0gPSB0aGlzO1xuICAgIGNvbnRlbnRFbC5lbXB0eSgpO1xuICAgIGNvbnRlbnRFbC5jcmVhdGVFbChcImgyXCIsIHsgdGV4dDogXCJFbmFibGUgbG9vbSBsb2NhbCBleGVjdXRpb24/XCIgfSk7XG4gICAgY29udGVudEVsLmNyZWF0ZUVsKFwicFwiLCB7XG4gICAgICB0ZXh0OiBcImxvb20gcnVucyBjb2RlIGZyb20geW91ciBub3RlcyBvbiB5b3VyIGxvY2FsIG1hY2hpbmUgdXNpbmcgdGhlIGNvbmZpZ3VyZWQgZXhlY3V0YWJsZXMuIEl0IGRvZXMgbm90IHNhbmRib3ggb3IgaXNvbGF0ZSB0aGUgcHJvY2Vzcy5cIixcbiAgICB9KTtcblxuICAgIGNvbnN0IGFjdGlvbnMgPSBjb250ZW50RWwuY3JlYXRlRGl2KHsgY2xzOiBcImxvb20tbW9kYWwtYWN0aW9uc1wiIH0pO1xuICAgIGNvbnN0IGNhbmNlbEJ1dHRvbiA9IGFjdGlvbnMuY3JlYXRlRWwoXCJidXR0b25cIiwgeyB0ZXh0OiBcIkNhbmNlbFwiIH0pO1xuICAgIGNvbnN0IGVuYWJsZUJ1dHRvbiA9IGFjdGlvbnMuY3JlYXRlRWwoXCJidXR0b25cIiwgeyB0ZXh0OiBcIkVuYWJsZSBhbmQgcnVuXCIsIGNsczogXCJtb2QtY3RhXCIgfSk7XG5cbiAgICBjYW5jZWxCdXR0b24uYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsICgpID0+IHRoaXMuY2xvc2UoKSk7XG4gICAgZW5hYmxlQnV0dG9uLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCBhc3luYyAoKSA9PiB7XG4gICAgICBhd2FpdCB0aGlzLm9uQ29uZmlybSgpO1xuICAgICAgdGhpcy5jbG9zZSgpO1xuICAgIH0pO1xuICB9XG59XG5cbmNsYXNzIGxvb21Ub29sYmFyUmVuZGVyQ2hpbGQgZXh0ZW5kcyBNYXJrZG93blJlbmRlckNoaWxkIHtcbiAgcHJpdmF0ZSBwYW5lbENvbnRhaW5lcjogSFRNTERpdkVsZW1lbnQgfCBudWxsID0gbnVsbDtcbiAgcHJpdmF0ZSB1bnJlZ2lzdGVyT3V0cHV0TGlzdGVuZXI6ICgoKSA9PiB2b2lkKSB8IG51bGwgPSBudWxsO1xuXG4gIGNvbnN0cnVjdG9yKFxuICAgIGNvbnRhaW5lckVsOiBIVE1MRWxlbWVudCxcbiAgICBwcml2YXRlIHJlYWRvbmx5IHBsdWdpbjogbG9vbVBsdWdpbixcbiAgICBwcml2YXRlIHJlYWRvbmx5IGJsb2NrOiBsb29tQ29kZUJsb2NrLFxuICAgIHByaXZhdGUgcmVhZG9ubHkgY29kZUVsZW1lbnQ6IEhUTUxFbGVtZW50LFxuICApIHtcbiAgICBzdXBlcihjb250YWluZXJFbCk7XG4gIH1cblxuICBvbmxvYWQoKTogdm9pZCB7XG4gICAgdGhpcy5jb2RlRWxlbWVudC5wYXJlbnRFbGVtZW50Py5hZGRDbGFzcyhcImxvb20tY29kZWJsb2NrLXNoZWxsXCIpO1xuICAgIHRoaXMuY29kZUVsZW1lbnQucGFyZW50RWxlbWVudD8uYXBwZW5kQ2hpbGQodGhpcy5wbHVnaW4uY3JlYXRlVG9vbGJhckVsZW1lbnQodGhpcy5ibG9jaykpO1xuXG4gICAgaWYgKHRoaXMucGx1Z2luLnNldHRpbmdzLnBkZkV4cG9ydE1vZGUgPT09IFwib3V0cHV0XCIpIHtcbiAgICAgIHRoaXMuY29kZUVsZW1lbnQuY2xhc3NMaXN0LmFkZChcImxvb20tcHJpbnQtaGlkZS1jb2RlXCIpO1xuICAgIH1cblxuICAgIGNvbnN0IGhvc3RDbGFzc2VzID0gW1wibG9vbS1pbmxpbmUtb3V0cHV0LWhvc3RcIl07XG4gICAgaWYgKHRoaXMucGx1Z2luLnNldHRpbmdzLnBkZkV4cG9ydE1vZGUgPT09IFwiY29kZVwiKSB7XG4gICAgICBob3N0Q2xhc3Nlcy5wdXNoKFwibG9vbS1wcmludC1oaWRlLW91dHB1dFwiKTtcbiAgICB9XG4gICAgdGhpcy5wYW5lbENvbnRhaW5lciA9IHRoaXMuY29udGFpbmVyRWwuY3JlYXRlRGl2KHsgY2xzOiBob3N0Q2xhc3Nlcy5qb2luKFwiIFwiKSB9KTtcblxuICAgIHRoaXMucGx1Z2luLnJlbmRlck91dHB1dEludG8odGhpcy5ibG9jay5pZCwgdGhpcy5wYW5lbENvbnRhaW5lcik7XG4gICAgdGhpcy51bnJlZ2lzdGVyT3V0cHV0TGlzdGVuZXIgPSB0aGlzLnBsdWdpbi5yZWdpc3Rlck91dHB1dExpc3RlbmVyKHRoaXMuYmxvY2suaWQsICgpID0+IHtcbiAgICAgIGlmICh0aGlzLnBhbmVsQ29udGFpbmVyKSB7XG4gICAgICAgIHRoaXMucGx1Z2luLnJlbmRlck91dHB1dEludG8odGhpcy5ibG9jay5pZCwgdGhpcy5wYW5lbENvbnRhaW5lcik7XG4gICAgICB9XG4gICAgfSk7XG4gIH1cblxuICBvbnVubG9hZCgpOiB2b2lkIHtcbiAgICB0aGlzLnVucmVnaXN0ZXJPdXRwdXRMaXN0ZW5lcj8uKCk7XG4gIH1cbn1cblxuY2xhc3MgbG9vbVRvb2xiYXJXaWRnZXQgZXh0ZW5kcyBXaWRnZXRUeXBlIHtcbiAgcHJpdmF0ZSByZWFkb25seSBpc1J1bm5pbmc6IGJvb2xlYW47XG5cbiAgY29uc3RydWN0b3IoXG4gICAgcHJpdmF0ZSByZWFkb25seSBwbHVnaW46IGxvb21QbHVnaW4sXG4gICAgcHJpdmF0ZSByZWFkb25seSBibG9jazogbG9vbUNvZGVCbG9jayxcbiAgKSB7XG4gICAgc3VwZXIoKTtcbiAgICB0aGlzLmlzUnVubmluZyA9IHBsdWdpbi5pc0Jsb2NrUnVubmluZyhibG9jay5pZCk7XG4gIH1cblxuICBlcShvdGhlcjogbG9vbVRvb2xiYXJXaWRnZXQpOiBib29sZWFuIHtcbiAgICByZXR1cm4gb3RoZXIuYmxvY2suaWQgPT09IHRoaXMuYmxvY2suaWQgJiYgb3RoZXIuaXNSdW5uaW5nID09PSB0aGlzLmlzUnVubmluZztcbiAgfVxuXG4gIHRvRE9NKCk6IEhUTUxFbGVtZW50IHtcbiAgICByZXR1cm4gdGhpcy5wbHVnaW4uY3JlYXRlVG9vbGJhckVsZW1lbnQodGhpcy5ibG9jayk7XG4gIH1cbn1cblxuY2xhc3MgbG9vbU91dHB1dFdpZGdldCBleHRlbmRzIFdpZGdldFR5cGUge1xuICBjb25zdHJ1Y3RvcihcbiAgICBwcml2YXRlIHJlYWRvbmx5IHBsdWdpbjogbG9vbVBsdWdpbixcbiAgICBwcml2YXRlIHJlYWRvbmx5IGJsb2NrSWQ6IHN0cmluZyxcbiAgKSB7XG4gICAgc3VwZXIoKTtcbiAgfVxuXG4gIGVxKG90aGVyOiBsb29tT3V0cHV0V2lkZ2V0KTogYm9vbGVhbiB7XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG5cbiAgdG9ET00oKTogSFRNTEVsZW1lbnQge1xuICAgIGNvbnN0IHdyYXBwZXIgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwiZGl2XCIpO1xuICAgIHdyYXBwZXIuY2xhc3NOYW1lID0gXCJsb29tLWlubGluZS1vdXRwdXQtaG9zdFwiO1xuICAgIHRoaXMucGx1Z2luLnJlbmRlck91dHB1dEludG8odGhpcy5ibG9ja0lkLCB3cmFwcGVyKTtcbiAgICByZXR1cm4gd3JhcHBlcjtcbiAgfVxufVxuXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBsb29tUGx1Z2luIGV4dGVuZHMgUGx1Z2luIHtcbiAgc2V0dGluZ3M6IGxvb21QbHVnaW5TZXR0aW5ncyA9IERFRkFVTFRfU0VUVElOR1M7XG4gIHJlYWRvbmx5IHJlZ2lzdHJ5ID0gbmV3IGxvb21SdW5uZXJSZWdpc3RyeShbXG4gICAgbmV3IFB5dGhvblJ1bm5lcigpLFxuICAgIG5ldyBOb2RlUnVubmVyKCksXG4gICAgbmV3IE9jYW1sUnVubmVyKCksXG4gICAgbmV3IE5hdGl2ZUNvbXBpbGVkUnVubmVyKCksXG4gICAgbmV3IEludGVycHJldGVkUnVubmVyKCksXG4gICAgbmV3IE1hbmFnZWRDb21waWxlZFJ1bm5lcigpLFxuICAgIG5ldyBMbHZtUnVubmVyKCksXG4gICAgbmV3IFByb29mUnVubmVyKCksXG4gICAgbmV3IEN1c3RvbUxhbmd1YWdlUnVubmVyKCksXG4gIF0pO1xuICAvLyBFeHBvc2VkIGFzIHB1YmxpYyBhbmQgcmVhZG9ubHkgc28gdGhlIHNldHRpbmdzIHBhbmVsIGFuZCBtb2RhbHMgY2FuIGFjY2VzcyBjb250YWluZXIgY29uZmlndXJhdGlvbnMgYW5kIGRlZmF1bHQgbGFuZ3VhZ2UgbWFwcGluZyBoZWxwZXJzLlxuICBwdWJsaWMgcmVhZG9ubHkgY29udGFpbmVyUnVubmVyID0gbmV3IGxvb21Db250YWluZXJSdW5uZXIodGhpcy5hcHAsIHRoaXMubWFuaWZlc3QuZGlyID8/IFwiLm9ic2lkaWFuL3BsdWdpbnMvbG9vbVwiKTtcbiAgcHJpdmF0ZSByZWFkb25seSByZWdpc3RlcmVkQ29kZUJsb2NrQWxpYXNlcyA9IG5ldyBTZXQ8c3RyaW5nPigpO1xuICBwcml2YXRlIHJlYWRvbmx5IG91dHB1dHMgPSBuZXcgTWFwPHN0cmluZywgbG9vbVN0b3JlZE91dHB1dD4oKTtcbiAgcHJpdmF0ZSByZWFkb25seSBydW5uaW5nID0gbmV3IE1hcDxzdHJpbmcsIEFib3J0Q29udHJvbGxlcj4oKTtcbiAgcHJpdmF0ZSByZWFkb25seSBvdXRwdXRMaXN0ZW5lcnMgPSBuZXcgTWFwPHN0cmluZywgU2V0PCgpID0+IHZvaWQ+PigpO1xuICBwcml2YXRlIHN0YXR1c0Jhckl0ZW1FbCE6IEhUTUxFbGVtZW50O1xuICBwcml2YXRlIGVkaXRvclZpZXdzID0gbmV3IFNldDxFZGl0b3JWaWV3PigpO1xuICBwcml2YXRlIGxhc3RNYXJrZG93bkZpbGVQYXRoOiBzdHJpbmcgfCBudWxsID0gbnVsbDtcblxuICBhc3luYyBvbmxvYWQoKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgYXdhaXQgdGhpcy5sb2FkU2V0dGluZ3MoKTtcbiAgICB0aGlzLmFkZFNldHRpbmdUYWIobmV3IGxvb21TZXR0aW5nVGFiKHRoaXMpKTtcbiAgICB0aGlzLnN0YXR1c0Jhckl0ZW1FbCA9IHRoaXMuYWRkU3RhdHVzQmFySXRlbSgpO1xuICAgIHRoaXMudXBkYXRlU3RhdHVzQmFyKCk7XG4gICAgdGhpcy5hcHAud29ya3NwYWNlLm9uTGF5b3V0UmVhZHkoKCkgPT4ge1xuICAgICAgdGhpcy5sYXN0TWFya2Rvd25GaWxlUGF0aCA9IHRoaXMuZ2V0QWN0aXZlTWFya2Rvd25GaWxlKCk/LnBhdGggPz8gdGhpcy5sYXN0TWFya2Rvd25GaWxlUGF0aDtcbiAgICAgIHZvaWQgdGhpcy5lbmZvcmNlU291cmNlTW9kZUZvckFjdGl2ZVZpZXcoKTtcbiAgICB9KTtcblxuICAgIHRoaXMuYWRkQ29tbWFuZCh7XG4gICAgICBpZDogXCJsb29tLXJ1bi1jdXJyZW50LWNvZGUtYmxvY2tcIixcbiAgICAgIG5hbWU6IFwibG9vbTogUnVuIEN1cnJlbnQgQ29kZSBCbG9ja1wiLFxuICAgICAgZWRpdG9yQ2FsbGJhY2s6IGFzeW5jIChlZGl0b3IsIHZpZXcpID0+IHtcbiAgICAgICAgY29uc3QgZmlsZSA9IHZpZXcuZmlsZTtcbiAgICAgICAgaWYgKCFmaWxlKSB7XG4gICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgYmxvY2tzID0gcGFyc2VNYXJrZG93bkNvZGVCbG9ja3MoZmlsZS5wYXRoLCBlZGl0b3IuZ2V0VmFsdWUoKSwgdGhpcy5zZXR0aW5ncyk7XG4gICAgICAgIGNvbnN0IGJsb2NrID0gZmluZEJsb2NrQXRMaW5lKGJsb2NrcywgZWRpdG9yLmdldEN1cnNvcigpLmxpbmUpO1xuICAgICAgICBpZiAoIWJsb2NrKSB7XG4gICAgICAgICAgbmV3IE5vdGljZShcIk5vIHN1cHBvcnRlZCBsb29tIGJsb2NrIGF0IHRoZSBjdXJyZW50IGN1cnNvci5cIik7XG4gICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIGF3YWl0IHRoaXMucnVuQmxvY2soZmlsZSwgYmxvY2spO1xuICAgICAgfSxcbiAgICB9KTtcblxuICAgIHRoaXMuYWRkQ29tbWFuZCh7XG4gICAgICBpZDogXCJsb29tLXJ1bi1hbGwtY29kZS1ibG9ja3NcIixcbiAgICAgIG5hbWU6IFwibG9vbTogUnVuIEFsbCBTdXBwb3J0ZWQgQ29kZSBCbG9ja3MgaW4gQ3VycmVudCBOb3RlXCIsXG4gICAgICBjaGVja0NhbGxiYWNrOiAoY2hlY2tpbmcpID0+IHtcbiAgICAgICAgY29uc3QgZmlsZSA9IHRoaXMuZ2V0QWN0aXZlTWFya2Rvd25GaWxlKCk7XG4gICAgICAgIGlmICghZmlsZSkge1xuICAgICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgICAgfVxuICAgICAgICBpZiAoIWNoZWNraW5nKSB7XG4gICAgICAgICAgdm9pZCB0aGlzLnJ1bkFsbEJsb2Nrc0luRmlsZShmaWxlKTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICAgIH0sXG4gICAgfSk7XG5cbiAgICB0aGlzLmFkZENvbW1hbmQoe1xuICAgICAgaWQ6IFwibG9vbS1jbGVhci1ub3RlLW91dHB1dHNcIixcbiAgICAgIG5hbWU6IFwibG9vbTogQ2xlYXIgbG9vbSBPdXRwdXRzIGluIEN1cnJlbnQgTm90ZVwiLFxuICAgICAgY2hlY2tDYWxsYmFjazogKGNoZWNraW5nKSA9PiB7XG4gICAgICAgIGNvbnN0IGZpbGUgPSB0aGlzLmdldEFjdGl2ZU1hcmtkb3duRmlsZSgpO1xuICAgICAgICBpZiAoIWZpbGUpIHtcbiAgICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKCFjaGVja2luZykge1xuICAgICAgICAgIHZvaWQgdGhpcy5jbGVhck91dHB1dHNGb3JGaWxlKGZpbGUpO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiB0cnVlO1xuICAgICAgfSxcbiAgICB9KTtcblxuICAgIHRoaXMucmVnaXN0ZXJDb2RlQmxvY2tQcm9jZXNzb3JzKCk7XG5cbiAgICB0aGlzLnJlZ2lzdGVyRWRpdG9yRXh0ZW5zaW9uKHRoaXMuY3JlYXRlTGl2ZVByZXZpZXdFeHRlbnNpb24oKSk7XG5cbiAgICB0aGlzLnJlZ2lzdGVyRXZlbnQoXG4gICAgICB0aGlzLmFwcC53b3Jrc3BhY2Uub24oXCJmaWxlLW9wZW5cIiwgKGZpbGUpID0+IHtcbiAgICAgICAgdGhpcy5sYXN0TWFya2Rvd25GaWxlUGF0aCA9IGZpbGU/LnBhdGggPz8gdGhpcy5sYXN0TWFya2Rvd25GaWxlUGF0aDtcbiAgICAgICAgdGhpcy5yZWZyZXNoQWxsVmlld3MoKTtcbiAgICAgICAgdm9pZCB0aGlzLmVuZm9yY2VTb3VyY2VNb2RlRm9yQWN0aXZlVmlldygpO1xuICAgICAgICBpZiAoZmlsZSAmJiB0aGlzLnNldHRpbmdzLmF1dG9SdW5PbkZpbGVPcGVuKSB7XG4gICAgICAgICAgdm9pZCB0aGlzLnJ1bkFsbEJsb2Nrc0luRmlsZShmaWxlKTtcbiAgICAgICAgfVxuICAgICAgfSksXG4gICAgKTtcblxuICAgIHRoaXMuYWRkQ29tbWFuZCh7XG4gICAgICBpZDogXCJsb29tLXZhbGlkYXRlLWNvbnRhaW5lci1ncm91cHNcIixcbiAgICAgIG5hbWU6IFwibG9vbTogVmFsaWRhdGUgQ29udGFpbmVyIEdyb3Vwc1wiLFxuICAgICAgY2FsbGJhY2s6IGFzeW5jICgpID0+IHtcbiAgICAgICAgY29uc3QgZ3JvdXBzID0gYXdhaXQgdGhpcy5nZXRDb250YWluZXJHcm91cFN1bW1hcmllcygpO1xuICAgICAgICBuZXcgTm90aWNlKGdyb3Vwcy5sZW5ndGggPyBncm91cHMubWFwKChncm91cCkgPT4gYCR7Z3JvdXAubmFtZX06ICR7Z3JvdXAuc3RhdHVzfWApLmpvaW4oXCJcXG5cIikgOiBcIk5vIGxvb20gY29udGFpbmVyIGdyb3VwcyBmb3VuZC5cIiwgODAwMCk7XG4gICAgICB9LFxuICAgIH0pO1xuXG4gICAgdGhpcy5yZWdpc3RlckV2ZW50KFxuICAgICAgdGhpcy5hcHAud29ya3NwYWNlLm9uKFwiYWN0aXZlLWxlYWYtY2hhbmdlXCIsICgpID0+IHtcbiAgICAgICAgdGhpcy5sYXN0TWFya2Rvd25GaWxlUGF0aCA9IHRoaXMuZ2V0QWN0aXZlTWFya2Rvd25GaWxlKCk/LnBhdGggPz8gdGhpcy5sYXN0TWFya2Rvd25GaWxlUGF0aDtcbiAgICAgICAgdm9pZCB0aGlzLmVuZm9yY2VTb3VyY2VNb2RlRm9yQWN0aXZlVmlldygpO1xuICAgICAgfSksXG4gICAgKTtcblxuICAgIHRoaXMucmVnaXN0ZXJFdmVudChcbiAgICAgIHRoaXMuYXBwLndvcmtzcGFjZS5vbihcImVkaXRvci1jaGFuZ2VcIiwgKF9lZGl0b3IsIGN0eCkgPT4ge1xuICAgICAgICBpZiAoY3R4IGluc3RhbmNlb2YgTWFya2Rvd25WaWV3KSB7XG4gICAgICAgICAgdm9pZCB0aGlzLmVuZm9yY2VTb3VyY2VNb2RlRm9yTGVhZihjdHgubGVhZik7XG4gICAgICAgIH1cbiAgICAgIH0pLFxuICAgICk7XG4gIH1cblxuICBvbnVubG9hZCgpOiB2b2lkIHtcbiAgICBmb3IgKGNvbnN0IGNvbnRyb2xsZXIgb2YgdGhpcy5ydW5uaW5nLnZhbHVlcygpKSB7XG4gICAgICBjb250cm9sbGVyLmFib3J0KCk7XG4gICAgfVxuICB9XG5cbiAgYXN5bmMgbG9hZFNldHRpbmdzKCk6IFByb21pc2U8dm9pZD4ge1xuICAgIHRoaXMuc2V0dGluZ3MgPSB7XG4gICAgICAuLi5ERUZBVUxUX1NFVFRJTkdTLFxuICAgICAgLi4uKGF3YWl0IHRoaXMubG9hZERhdGEoKSksXG4gICAgfTtcbiAgfVxuXG4gIGFzeW5jIHNhdmVTZXR0aW5ncygpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBhd2FpdCB0aGlzLnNhdmVEYXRhKHRoaXMuc2V0dGluZ3MpO1xuICAgIHRoaXMucmVnaXN0ZXJDb2RlQmxvY2tQcm9jZXNzb3JzKCk7XG4gICAgdGhpcy5yZWZyZXNoQWxsVmlld3MoKTtcbiAgfVxuXG4gIGlzQmxvY2tSdW5uaW5nKGJsb2NrSWQ6IHN0cmluZyk6IGJvb2xlYW4ge1xuICAgIHJldHVybiB0aGlzLnJ1bm5pbmcuaGFzKGJsb2NrSWQpO1xuICB9XG5cbiAgcmVnaXN0ZXJPdXRwdXRMaXN0ZW5lcihibG9ja0lkOiBzdHJpbmcsIGxpc3RlbmVyOiAoKSA9PiB2b2lkKTogKCkgPT4gdm9pZCB7XG4gICAgaWYgKCF0aGlzLm91dHB1dExpc3RlbmVycy5oYXMoYmxvY2tJZCkpIHtcbiAgICAgIHRoaXMub3V0cHV0TGlzdGVuZXJzLnNldChibG9ja0lkLCBuZXcgU2V0KCkpO1xuICAgIH1cbiAgICB0aGlzLm91dHB1dExpc3RlbmVycy5nZXQoYmxvY2tJZCk/LmFkZChsaXN0ZW5lcik7XG4gICAgcmV0dXJuICgpID0+IHtcbiAgICAgIHRoaXMub3V0cHV0TGlzdGVuZXJzLmdldChibG9ja0lkKT8uZGVsZXRlKGxpc3RlbmVyKTtcbiAgICB9O1xuICB9XG5cbiAgY3JlYXRlVG9vbGJhckVsZW1lbnQoYmxvY2s6IGxvb21Db2RlQmxvY2spOiBIVE1MRWxlbWVudCB7XG4gICAgcmV0dXJuIGNyZWF0ZUNvZGVCbG9ja1Rvb2xiYXIoYmxvY2suaWQsIHRoaXMuaXNCbG9ja1J1bm5pbmcoYmxvY2suaWQpLCB7XG4gICAgICBvblJ1bjogKCkgPT4gdm9pZCB0aGlzLnJ1bkFjdGl2ZUJsb2NrQnlJZChibG9jay5pZCksXG4gICAgICBvbkNvcHk6IGFzeW5jICgpID0+IHtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICBhd2FpdCBuYXZpZ2F0b3IuY2xpcGJvYXJkLndyaXRlVGV4dChibG9jay5jb250ZW50KTtcbiAgICAgICAgICBuZXcgTm90aWNlKFwiQ29kZSBjb3BpZWRcIik7XG4gICAgICAgIH0gY2F0Y2gge1xuICAgICAgICAgIG5ldyBOb3RpY2UoXCJDbGlwYm9hcmQgd3JpdGUgZmFpbGVkLlwiKTtcbiAgICAgICAgfVxuICAgICAgfSxcbiAgICAgIG9uUmVtb3ZlOiAoKSA9PiB2b2lkIHRoaXMucmVtb3ZlU25pcHBldEJ5SWQoYmxvY2suaWQpLFxuICAgICAgb25Ub2dnbGVPdXRwdXQ6ICgpID0+IHtcbiAgICAgICAgY29uc3Qgb3V0cHV0ID0gdGhpcy5vdXRwdXRzLmdldChibG9jay5pZCk7XG4gICAgICAgIGlmICghb3V0cHV0KSB7XG4gICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIG91dHB1dC52aXNpYmxlID0gIW91dHB1dC52aXNpYmxlO1xuICAgICAgICB0aGlzLm5vdGlmeU91dHB1dENoYW5nZWQoYmxvY2suaWQpO1xuICAgICAgfSxcbiAgICB9KTtcbiAgfVxuXG4gIHJlbmRlck91dHB1dEludG8oYmxvY2tJZDogc3RyaW5nLCBjb250YWluZXI6IEhUTUxFbGVtZW50KTogdm9pZCB7XG4gICAgY29udGFpbmVyLmVtcHR5KCk7XG5cbiAgICBjb25zdCBvdXRwdXQgPSB0aGlzLm91dHB1dHMuZ2V0KGJsb2NrSWQpO1xuICAgIGlmICh0aGlzLnJ1bm5pbmcuaGFzKGJsb2NrSWQpKSB7XG4gICAgICBjb250YWluZXIuYXBwZW5kQ2hpbGQoY3JlYXRlUnVubmluZ1BhbmVsKCkpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGlmICghb3V0cHV0IHx8ICFvdXRwdXQudmlzaWJsZSkge1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGNvbnRhaW5lci5hcHBlbmRDaGlsZChjcmVhdGVPdXRwdXRQYW5lbChvdXRwdXQpKTtcbiAgfVxuXG4gIGFzeW5jIHJ1bkFjdGl2ZUJsb2NrQnlJZChibG9ja0lkOiBzdHJpbmcpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCBibG9jayA9IHRoaXMuZmluZEFjdGl2ZUJsb2NrQnlJZChibG9ja0lkKTtcbiAgICBjb25zdCBmaWxlID0gdGhpcy5nZXRBY3RpdmVNYXJrZG93bkZpbGUoKTtcbiAgICBpZiAoIWJsb2NrIHx8ICFmaWxlKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIGF3YWl0IHRoaXMucnVuQmxvY2soZmlsZSwgYmxvY2spO1xuICB9XG5cbiAgYXN5bmMgcmVtb3ZlU25pcHBldEJ5SWQoYmxvY2tJZDogc3RyaW5nKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3QgYmxvY2sgPSB0aGlzLmZpbmRBY3RpdmVCbG9ja0J5SWQoYmxvY2tJZCk7XG4gICAgaWYgKCFibG9jaykge1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGNvbnN0IGZpbGUgPSB0aGlzLmFwcC52YXVsdC5nZXRBYnN0cmFjdEZpbGVCeVBhdGgoYmxvY2suZmlsZVBhdGgpO1xuICAgIGlmICghKGZpbGUgaW5zdGFuY2VvZiBURmlsZSkpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICB0aGlzLnJ1bm5pbmcuZ2V0KGJsb2NrSWQpPy5hYm9ydCgpO1xuICAgIHRoaXMucnVubmluZy5kZWxldGUoYmxvY2tJZCk7XG4gICAgdGhpcy5vdXRwdXRzLmRlbGV0ZShibG9ja0lkKTtcblxuICAgIGF3YWl0IHRoaXMuYXBwLnZhdWx0LnByb2Nlc3MoZmlsZSwgKGNvbnRlbnQpID0+IHtcbiAgICAgIGNvbnN0IGxpbmVzID0gY29udGVudC5zcGxpdCgvXFxyP1xcbi8pO1xuICAgICAgY29uc3QgYmxvY2tzID0gcGFyc2VNYXJrZG93bkNvZGVCbG9ja3MoZmlsZS5wYXRoLCBjb250ZW50LCB0aGlzLnNldHRpbmdzKTtcbiAgICAgIGNvbnN0IGN1cnJlbnRCbG9jayA9IGJsb2Nrcy5maW5kKChjYW5kaWRhdGUpID0+IGNhbmRpZGF0ZS5pZCA9PT0gYmxvY2tJZCk7XG4gICAgICBpZiAoIWN1cnJlbnRCbG9jaykge1xuICAgICAgICByZXR1cm4gY29udGVudDtcbiAgICAgIH1cblxuICAgICAgY29uc3QgbWFuYWdlZFJhbmdlID0gdGhpcy5maW5kTWFuYWdlZE91dHB1dFJhbmdlKGxpbmVzLCBibG9ja0lkKTtcbiAgICAgIGNvbnN0IHJlbW92YWxTdGFydCA9IGN1cnJlbnRCbG9jay5zdGFydExpbmU7XG4gICAgICBjb25zdCByZW1vdmFsRW5kID0gbWFuYWdlZFJhbmdlID8gbWFuYWdlZFJhbmdlLmVuZCA6IGN1cnJlbnRCbG9jay5lbmRMaW5lO1xuICAgICAgbGluZXMuc3BsaWNlKHJlbW92YWxTdGFydCwgcmVtb3ZhbEVuZCAtIHJlbW92YWxTdGFydCArIDEpO1xuXG4gICAgICB3aGlsZSAocmVtb3ZhbFN0YXJ0IDwgbGluZXMubGVuZ3RoIC0gMSAmJiBsaW5lc1tyZW1vdmFsU3RhcnRdID09PSBcIlwiICYmIGxpbmVzW3JlbW92YWxTdGFydCArIDFdID09PSBcIlwiKSB7XG4gICAgICAgIGxpbmVzLnNwbGljZShyZW1vdmFsU3RhcnQsIDEpO1xuICAgICAgfVxuXG4gICAgICByZXR1cm4gbGluZXMuam9pbihcIlxcblwiKTtcbiAgICB9KTtcblxuICAgIHRoaXMubm90aWZ5T3V0cHV0Q2hhbmdlZChibG9ja0lkKTtcbiAgICB0aGlzLnVwZGF0ZVN0YXR1c0JhcigpO1xuICAgIG5ldyBOb3RpY2UoXCJsb29tIHNuaXBwZXQgcmVtb3ZlZC5cIik7XG4gIH1cblxuICBhc3luYyBydW5BbGxCbG9ja3NJbkZpbGUoZmlsZTogVEZpbGUpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCBzb3VyY2UgPSBhd2FpdCB0aGlzLmFwcC52YXVsdC5jYWNoZWRSZWFkKGZpbGUpO1xuICAgIGNvbnN0IGJsb2NrcyA9IHBhcnNlTWFya2Rvd25Db2RlQmxvY2tzKGZpbGUucGF0aCwgc291cmNlLCB0aGlzLnNldHRpbmdzKTtcbiAgICBjb25zdCBjb250YWluZXJHcm91cCA9IHRoaXMuY29udGFpbmVyUnVubmVyLmdldENvbnRhaW5lckdyb3VwTmFtZShmaWxlKSB8fCB0aGlzLnNldHRpbmdzLmRlZmF1bHRDb250YWluZXJHcm91cDtcbiAgICBjb25zdCBzdXBwb3J0ZWRCbG9ja3MgPSBjb250YWluZXJHcm91cCA/IGJsb2NrcyA6IGJsb2Nrcy5maWx0ZXIoKGJsb2NrKSA9PiB0aGlzLnJlZ2lzdHJ5LmdldFJ1bm5lckZvckJsb2NrKGJsb2NrLCB0aGlzLnNldHRpbmdzKSk7XG5cbiAgICBpZiAoIXN1cHBvcnRlZEJsb2Nrcy5sZW5ndGgpIHtcbiAgICAgIG5ldyBOb3RpY2UoXCJObyBzdXBwb3J0ZWQgbG9vbSBibG9ja3MgZm91bmQgaW4gdGhlIGN1cnJlbnQgbm90ZS5cIik7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgZm9yIChjb25zdCBibG9jayBvZiBzdXBwb3J0ZWRCbG9ja3MpIHtcbiAgICAgIGF3YWl0IHRoaXMucnVuQmxvY2soZmlsZSwgYmxvY2spO1xuICAgIH1cbiAgfVxuXG4gIGFzeW5jIGNsZWFyT3V0cHV0c0ZvckZpbGUoZmlsZTogVEZpbGUpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCBzb3VyY2UgPSBhd2FpdCB0aGlzLmFwcC52YXVsdC5jYWNoZWRSZWFkKGZpbGUpO1xuICAgIGNvbnN0IGJsb2NrcyA9IHBhcnNlTWFya2Rvd25Db2RlQmxvY2tzKGZpbGUucGF0aCwgc291cmNlLCB0aGlzLnNldHRpbmdzKTtcbiAgICBmb3IgKGNvbnN0IGJsb2NrIG9mIGJsb2Nrcykge1xuICAgICAgdGhpcy5vdXRwdXRzLmRlbGV0ZShibG9jay5pZCk7XG4gICAgICB0aGlzLm5vdGlmeU91dHB1dENoYW5nZWQoYmxvY2suaWQpO1xuICAgICAgYXdhaXQgdGhpcy5yZW1vdmVNYW5hZ2VkT3V0cHV0QmxvY2soZmlsZS5wYXRoLCBibG9jay5pZCk7XG4gICAgfVxuICAgIG5ldyBOb3RpY2UoXCJsb29tIG91dHB1dHMgY2xlYXJlZC5cIik7XG4gIH1cblxuICBhc3luYyBydW5CbG9jayhmaWxlOiBURmlsZSwgYmxvY2s6IGxvb21Db2RlQmxvY2spOiBQcm9taXNlPHZvaWQ+IHtcbiAgICB0aGlzLmxhc3RNYXJrZG93bkZpbGVQYXRoID0gZmlsZS5wYXRoO1xuICAgIGlmICh0aGlzLnJ1bm5pbmcuaGFzKGJsb2NrLmlkKSkge1xuICAgICAgbmV3IE5vdGljZShcIlRoaXMgbG9vbSBibG9jayBpcyBhbHJlYWR5IHJ1bm5pbmcuXCIpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGlmICghKGF3YWl0IHRoaXMuZW5zdXJlRXhlY3V0aW9uRW5hYmxlZCgpKSkge1xuICAgICAgc2hvd0V4ZWN1dGlvbkRpc2FibGVkTm90aWNlKCk7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgY29uc3Qgd29ya2luZ0RpcmVjdG9yeSA9IHRoaXMucmVzb2x2ZVdvcmtpbmdEaXJlY3RvcnkoZmlsZSk7XG4gICAgY29uc3QgY29udGFpbmVyR3JvdXAgPSB0aGlzLmNvbnRhaW5lclJ1bm5lci5nZXRDb250YWluZXJHcm91cE5hbWUoZmlsZSkgfHwgdGhpcy5zZXR0aW5ncy5kZWZhdWx0Q29udGFpbmVyR3JvdXA7XG4gICAgY29uc3QgcnVubmVyID0gY29udGFpbmVyR3JvdXAgPyBudWxsIDogdGhpcy5yZWdpc3RyeS5nZXRSdW5uZXJGb3JCbG9jayhibG9jaywgdGhpcy5zZXR0aW5ncyk7XG4gICAgaWYgKCFydW5uZXIpIHtcbiAgICAgIGlmICghY29udGFpbmVyR3JvdXApIHtcbiAgICAgICAgbmV3IE5vdGljZShgTm8gY29uZmlndXJlZCBydW5uZXIgZm9yICR7YmxvY2subGFuZ3VhZ2V9LmApO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG4gICAgfVxuXG4gICAgY29uc3QgY29udHJvbGxlciA9IG5ldyBBYm9ydENvbnRyb2xsZXIoKTtcbiAgICBjb25zdCBydW5Db250ZXh0ID0ge1xuICAgICAgZmlsZSxcbiAgICAgIHdvcmtpbmdEaXJlY3RvcnksXG4gICAgICB0aW1lb3V0TXM6IHRoaXMuc2V0dGluZ3MuZGVmYXVsdFRpbWVvdXRNcyxcbiAgICAgIHNpZ25hbDogY29udHJvbGxlci5zaWduYWwsXG4gICAgfTtcbiAgICB0aGlzLnJ1bm5pbmcuc2V0KGJsb2NrLmlkLCBjb250cm9sbGVyKTtcbiAgICB0aGlzLm5vdGlmeU91dHB1dENoYW5nZWQoYmxvY2suaWQpO1xuICAgIHRoaXMudXBkYXRlU3RhdHVzQmFyKCk7XG5cbiAgICB0cnkge1xuICAgICAgY29uc3QgcmVzb2x2ZWRCbG9jayA9IGF3YWl0IHRoaXMucmVzb2x2ZUV4ZWN1dGFibGVCbG9jayhmaWxlLCBibG9jayk7XG4gICAgICBjb25zdCByZXN1bHQgPSBjb250YWluZXJHcm91cFxuICAgICAgICA/IGF3YWl0IHRoaXMuY29udGFpbmVyUnVubmVyLnJ1bihyZXNvbHZlZEJsb2NrLmJsb2NrLCBydW5Db250ZXh0LCB0aGlzLnNldHRpbmdzLCBjb250YWluZXJHcm91cClcbiAgICAgICAgOiBhd2FpdCBydW5uZXIhLnJ1bihyZXNvbHZlZEJsb2NrLmJsb2NrLCBydW5Db250ZXh0LCB0aGlzLnNldHRpbmdzKTtcblxuICAgICAgaWYgKHJlc3VsdC50aW1lZE91dCkge1xuICAgICAgICByZXN1bHQuc3RkZXJyID0gcmVzdWx0LnN0ZGVyciB8fCBgRXhlY3V0aW9uIHRpbWVkIG91dCBhZnRlciAke3RoaXMuc2V0dGluZ3MuZGVmYXVsdFRpbWVvdXRNc30gbXMuYDtcbiAgICAgIH0gZWxzZSBpZiAocmVzdWx0LmNhbmNlbGxlZCkge1xuICAgICAgICByZXN1bHQuc3RkZXJyID0gcmVzdWx0LnN0ZGVyciB8fCBcIkV4ZWN1dGlvbiBjYW5jZWxsZWQuXCI7XG4gICAgICB9IGVsc2UgaWYgKCFyZXN1bHQuc3VjY2VzcyAmJiAhcmVzdWx0LnN0ZGVyci50cmltKCkpIHtcbiAgICAgICAgcmVzdWx0LnN0ZGVyciA9IFwiUHJvY2VzcyBleGl0ZWQgdW5zdWNjZXNzZnVsbHkuXCI7XG4gICAgICB9XG5cbiAgICAgIGlmIChyZXNvbHZlZEJsb2NrLnNvdXJjZVByZXZpZXcpIHtcbiAgICAgICAgY29uc3Qgc291cmNlTm90aWNlID0gYFJhbiBleHRyYWN0ZWQgc291cmNlIGZyb20gJHtyZXNvbHZlZEJsb2NrLnNvdXJjZVByZXZpZXcuZGVzY3JpcHRpb259LmA7XG4gICAgICAgIHJlc3VsdC53YXJuaW5nID0gcmVzdWx0Lndhcm5pbmcgPyBgJHtzb3VyY2VOb3RpY2V9XFxuJHtyZXN1bHQud2FybmluZ31gIDogc291cmNlTm90aWNlO1xuICAgICAgfVxuXG4gICAgICB0aGlzLm91dHB1dHMuc2V0KGJsb2NrLmlkLCB7XG4gICAgICAgIGJsb2NrSWQ6IGJsb2NrLmlkLFxuICAgICAgICBibG9jayxcbiAgICAgICAgcmVzdWx0LFxuICAgICAgICBzb3VyY2VQcmV2aWV3OiByZXNvbHZlZEJsb2NrLnNvdXJjZVByZXZpZXcsXG4gICAgICAgIGNvbGxhcHNlZDogZmFsc2UsXG4gICAgICAgIHZpc2libGU6IHRydWUsXG4gICAgICB9KTtcblxuICAgICAgaWYgKHRoaXMuc2V0dGluZ3Mud3JpdGVPdXRwdXRUb05vdGUpIHtcbiAgICAgICAgYXdhaXQgdGhpcy53cml0ZU1hbmFnZWRPdXRwdXRCbG9jayhmaWxlLCBibG9jaywgcmVzdWx0KTtcbiAgICAgIH1cblxuICAgICAgY29uc3QgcnVubmVyTmFtZSA9IGNvbnRhaW5lckdyb3VwID8gYGNvbnRhaW5lciAke2NvbnRhaW5lckdyb3VwfWAgOiBydW5uZXIhLmRpc3BsYXlOYW1lO1xuICAgICAgbmV3IE5vdGljZShyZXN1bHQuc3VjY2VzcyA/IGBsb29tIHJhbiAke3J1bm5lck5hbWV9IGJsb2NrLmAgOiBgbG9vbSBydW4gZmFpbGVkIGZvciAke3J1bm5lck5hbWV9LmApO1xuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBjb25zdCBtZXNzYWdlID0gZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiBTdHJpbmcoZXJyb3IpO1xuICAgICAgdGhpcy5vdXRwdXRzLnNldChibG9jay5pZCwge1xuICAgICAgICBibG9ja0lkOiBibG9jay5pZCxcbiAgICAgICAgYmxvY2ssXG4gICAgICAgIGNvbGxhcHNlZDogZmFsc2UsXG4gICAgICAgIHZpc2libGU6IHRydWUsXG4gICAgICAgIHJlc3VsdDoge1xuICAgICAgICAgIHJ1bm5lcklkOiBjb250YWluZXJHcm91cCA/IGBjb250YWluZXI6JHtjb250YWluZXJHcm91cH1gIDogcnVubmVyPy5pZCA/PyBcInVua25vd25cIixcbiAgICAgICAgICBydW5uZXJOYW1lOiBjb250YWluZXJHcm91cCA/IGBDb250YWluZXIgJHtjb250YWluZXJHcm91cH1gIDogcnVubmVyPy5kaXNwbGF5TmFtZSA/PyBcIlVua25vd25cIixcbiAgICAgICAgICBzdGFydGVkQXQ6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSxcbiAgICAgICAgICBmaW5pc2hlZEF0OiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXG4gICAgICAgICAgZHVyYXRpb25NczogMCxcbiAgICAgICAgICBleGl0Q29kZTogLTEsXG4gICAgICAgICAgc3Rkb3V0OiBcIlwiLFxuICAgICAgICAgIHN0ZGVycjogbWVzc2FnZSxcbiAgICAgICAgICBzdWNjZXNzOiBmYWxzZSxcbiAgICAgICAgICB0aW1lZE91dDogZmFsc2UsXG4gICAgICAgICAgY2FuY2VsbGVkOiBmYWxzZSxcbiAgICAgICAgfSxcbiAgICAgIH0pO1xuICAgICAgbmV3IE5vdGljZShgbG9vbSBlcnJvcjogJHttZXNzYWdlfWApO1xuICAgIH0gZmluYWxseSB7XG4gICAgICB0aGlzLnJ1bm5pbmcuZGVsZXRlKGJsb2NrLmlkKTtcbiAgICAgIHRoaXMubm90aWZ5T3V0cHV0Q2hhbmdlZChibG9jay5pZCk7XG4gICAgICB0aGlzLnVwZGF0ZVN0YXR1c0JhcigpO1xuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgZW5zdXJlRXhlY3V0aW9uRW5hYmxlZCgpOiBQcm9taXNlPGJvb2xlYW4+IHtcbiAgICBpZiAodGhpcy5zZXR0aW5ncy5lbmFibGVMb2NhbEV4ZWN1dGlvbiAmJiB0aGlzLnNldHRpbmdzLmhhc0Fja25vd2xlZGdlZEV4ZWN1dGlvblJpc2spIHtcbiAgICAgIHJldHVybiB0cnVlO1xuICAgIH1cblxuICAgIHJldHVybiBhd2FpdCBuZXcgUHJvbWlzZTxib29sZWFuPigocmVzb2x2ZSkgPT4ge1xuICAgICAgbGV0IHNldHRsZWQgPSBmYWxzZTtcbiAgICAgIGNvbnN0IHNldHRsZSA9ICh2YWx1ZTogYm9vbGVhbikgPT4ge1xuICAgICAgICBpZiAoIXNldHRsZWQpIHtcbiAgICAgICAgICBzZXR0bGVkID0gdHJ1ZTtcbiAgICAgICAgICByZXNvbHZlKHZhbHVlKTtcbiAgICAgICAgfVxuICAgICAgfTtcblxuICAgICAgY29uc3QgbW9kYWwgPSBuZXcgRXhlY3V0aW9uQ29uc2VudE1vZGFsKHRoaXMuYXBwLCBhc3luYyAoKSA9PiB7XG4gICAgICAgIHRoaXMuc2V0dGluZ3MuZW5hYmxlTG9jYWxFeGVjdXRpb24gPSB0cnVlO1xuICAgICAgICB0aGlzLnNldHRpbmdzLmhhc0Fja25vd2xlZGdlZEV4ZWN1dGlvblJpc2sgPSB0cnVlO1xuICAgICAgICBhd2FpdCB0aGlzLnNhdmVTZXR0aW5ncygpO1xuICAgICAgICBzZXR0bGUodHJ1ZSk7XG4gICAgICB9KTtcblxuICAgICAgY29uc3Qgb3JpZ2luYWxDbG9zZSA9IG1vZGFsLmNsb3NlLmJpbmQobW9kYWwpO1xuICAgICAgbW9kYWwuY2xvc2UgPSAoKSA9PiB7XG4gICAgICAgIG9yaWdpbmFsQ2xvc2UoKTtcbiAgICAgICAgc2V0dGxlKHRoaXMuc2V0dGluZ3MuZW5hYmxlTG9jYWxFeGVjdXRpb24gJiYgdGhpcy5zZXR0aW5ncy5oYXNBY2tub3dsZWRnZWRFeGVjdXRpb25SaXNrKTtcbiAgICAgIH07XG4gICAgICBtb2RhbC5vcGVuKCk7XG4gICAgfSk7XG4gIH1cblxuICBwcml2YXRlIHJlc29sdmVXb3JraW5nRGlyZWN0b3J5KGZpbGU6IFRGaWxlKTogc3RyaW5nIHtcbiAgICBpZiAodGhpcy5zZXR0aW5ncy53b3JraW5nRGlyZWN0b3J5LnRyaW0oKSkge1xuICAgICAgcmV0dXJuIHRoaXMuc2V0dGluZ3Mud29ya2luZ0RpcmVjdG9yeS50cmltKCk7XG4gICAgfVxuXG4gICAgY29uc3QgYWRhcHRlckJhc2VQYXRoID0gKHRoaXMuYXBwLnZhdWx0LmFkYXB0ZXIgYXMgeyBiYXNlUGF0aD86IHN0cmluZyB9KS5iYXNlUGF0aCA/PyBcIlwiO1xuICAgIGNvbnN0IGZpbGVGb2xkZXIgPSBkaXJuYW1lKGZpbGUucGF0aCk7XG4gICAgY29uc3QgcmVzb2x2ZWQgPSBmaWxlRm9sZGVyID09PSBcIi5cIiA/IGFkYXB0ZXJCYXNlUGF0aCA6IGAke2FkYXB0ZXJCYXNlUGF0aH0vJHtmaWxlRm9sZGVyfWA7XG4gICAgcmV0dXJuIHJlc29sdmVkIHx8IHByb2Nlc3MuY3dkKCk7XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIHJlc29sdmVFeGVjdXRhYmxlQmxvY2soZmlsZTogVEZpbGUsIGJsb2NrOiBsb29tQ29kZUJsb2NrKTogUHJvbWlzZTx7IGJsb2NrOiBsb29tQ29kZUJsb2NrOyBzb3VyY2VQcmV2aWV3PzogbG9vbVN0b3JlZE91dHB1dFtcInNvdXJjZVByZXZpZXdcIl0gfT4ge1xuICAgIGlmICghYmxvY2suc291cmNlUmVmZXJlbmNlKSB7XG4gICAgICByZXR1cm4geyBibG9jayB9O1xuICAgIH1cblxuICAgIGNvbnN0IHJlZmVyZW5jZVBhdGggPSB0aGlzLnJlc29sdmVSZWZlcmVuY2VkVmF1bHRQYXRoKGZpbGUsIGJsb2NrLnNvdXJjZVJlZmVyZW5jZS5maWxlUGF0aCk7XG4gICAgY29uc3Qgc291cmNlRmlsZSA9IHRoaXMuYXBwLnZhdWx0LmdldEFic3RyYWN0RmlsZUJ5UGF0aChyZWZlcmVuY2VQYXRoKTtcbiAgICBpZiAoIShzb3VyY2VGaWxlIGluc3RhbmNlb2YgVEZpbGUpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYFJlZmVyZW5jZWQgc291cmNlIGZpbGUgbm90IGZvdW5kOiAke3JlZmVyZW5jZVBhdGh9YCk7XG4gICAgfVxuXG4gICAgY29uc3QgaGFybmVzcyA9IGJ1aWxkU291cmNlUmVmZXJlbmNlSGFybmVzcyhibG9jayk7XG4gICAgY29uc3QgZXh0ZXJuYWxFeHRyYWN0b3IgPSB0aGlzLmdldEN1c3RvbUxhbmd1YWdlRXh0cmFjdG9yKGJsb2NrLmxhbmd1YWdlLCBmaWxlKTtcbiAgICBjb25zdCByZXNvbHZlZCA9IGF3YWl0IHJlc29sdmVSZWZlcmVuY2VkU291cmNlKFxuICAgICAgYXdhaXQgdGhpcy5hcHAudmF1bHQuY2FjaGVkUmVhZChzb3VyY2VGaWxlKSxcbiAgICAgIHsgLi4uYmxvY2suc291cmNlUmVmZXJlbmNlLCBmaWxlUGF0aDogcmVmZXJlbmNlUGF0aCB9LFxuICAgICAgYmxvY2subGFuZ3VhZ2UsXG4gICAgICBoYXJuZXNzLFxuICAgICAge1xuICAgICAgICBweXRob25FeGVjdXRhYmxlOiB0aGlzLnNldHRpbmdzLnB5dGhvbkV4ZWN1dGFibGUudHJpbSgpIHx8IFwicHl0aG9uM1wiLFxuICAgICAgICBleHRlcm5hbEV4dHJhY3RvcixcbiAgICAgICAgcmVhZEZpbGU6IGFzeW5jIChmaWxlUGF0aCkgPT4ge1xuICAgICAgICAgIGNvbnN0IGltcG9ydGVkRmlsZSA9IHRoaXMuYXBwLnZhdWx0LmdldEFic3RyYWN0RmlsZUJ5UGF0aChub3JtYWxpemVQYXRoKGZpbGVQYXRoKSk7XG4gICAgICAgICAgcmV0dXJuIGltcG9ydGVkRmlsZSBpbnN0YW5jZW9mIFRGaWxlID8gdGhpcy5hcHAudmF1bHQuY2FjaGVkUmVhZChpbXBvcnRlZEZpbGUpIDogbnVsbDtcbiAgICAgICAgfSxcbiAgICAgICAgcmVzb2x2ZVB5dGhvbkltcG9ydDogYXN5bmMgKGZyb21GaWxlUGF0aCwgbW9kdWxlTmFtZSwgbGV2ZWwpID0+IHRoaXMucmVzb2x2ZVB5dGhvbkltcG9ydFZhdWx0UGF0aChmcm9tRmlsZVBhdGgsIG1vZHVsZU5hbWUsIGxldmVsKSxcbiAgICAgIH0sXG4gICAgKTtcbiAgICBjb25zdCBjYXBhYmlsaXR5ID0gZ2V0TGFuZ3VhZ2VDYXBhYmlsaXR5KGJsb2NrLmxhbmd1YWdlLCBCb29sZWFuKGV4dGVybmFsRXh0cmFjdG9yKSk7XG4gICAgY29uc3Qgc2hvdWxkU2hvd1ByZXZpZXcgPSAodGhpcy5zZXR0aW5ncy5leHRyYWN0ZWRTb3VyY2VQcmV2aWV3TW9kZSB8fCBcImNvbGxhcHNlZFwiKSAhPT0gXCJoaWRkZW5cIjtcblxuICAgIHJldHVybiB7XG4gICAgICBibG9jazoge1xuICAgICAgICAuLi5ibG9jayxcbiAgICAgICAgY29udGVudDogcmVzb2x2ZWQuY29udGVudCxcbiAgICAgIH0sXG4gICAgICBzb3VyY2VQcmV2aWV3OiBzaG91bGRTaG93UHJldmlldyA/IHtcbiAgICAgICAgZGVzY3JpcHRpb246IHJlc29sdmVkLmRlc2NyaXB0aW9uLFxuICAgICAgICBsYW5ndWFnZTogYmxvY2subGFuZ3VhZ2UsXG4gICAgICAgIGNvbnRlbnQ6IHJlc29sdmVkLmNvbnRlbnQsXG4gICAgICAgIGNhcGFiaWxpdHksXG4gICAgICAgIGV4cGFuZGVkOiB0aGlzLnNldHRpbmdzLmV4dHJhY3RlZFNvdXJjZVByZXZpZXdNb2RlID09PSBcImV4cGFuZGVkXCIsXG4gICAgICAgIHNob3dDYXBhYmlsaXR5TWV0YWRhdGE6IHRoaXMuc2V0dGluZ3Muc2hvd0xhbmd1YWdlQ2FwYWJpbGl0eU1ldGFkYXRhID8/IHRydWUsXG4gICAgICB9IDogdW5kZWZpbmVkLFxuICAgIH07XG4gIH1cblxuICBwcml2YXRlIHJlc29sdmVSZWZlcmVuY2VkVmF1bHRQYXRoKGZpbGU6IFRGaWxlLCByZWZlcmVuY2VQYXRoOiBzdHJpbmcpOiBzdHJpbmcge1xuICAgIGNvbnN0IHRyaW1tZWQgPSByZWZlcmVuY2VQYXRoLnRyaW0oKTtcbiAgICBpZiAoIXRyaW1tZWQpIHtcbiAgICAgIHJldHVybiB0cmltbWVkO1xuICAgIH1cbiAgICBpZiAodHJpbW1lZC5zdGFydHNXaXRoKFwiL1wiKSkge1xuICAgICAgcmV0dXJuIG5vcm1hbGl6ZVBhdGgodHJpbW1lZC5zbGljZSgxKSk7XG4gICAgfVxuXG4gICAgY29uc3QgYmFzZURpciA9IGRpcm5hbWUoZmlsZS5wYXRoKTtcbiAgICByZXR1cm4gbm9ybWFsaXplUGF0aChiYXNlRGlyID09PSBcIi5cIiA/IHRyaW1tZWQgOiBgJHtiYXNlRGlyfS8ke3RyaW1tZWR9YCk7XG4gIH1cblxuICBwcml2YXRlIHJlc29sdmVQeXRob25JbXBvcnRWYXVsdFBhdGgoZnJvbUZpbGVQYXRoOiBzdHJpbmcsIG1vZHVsZU5hbWU6IHN0cmluZywgbGV2ZWw6IG51bWJlcik6IHN0cmluZyB8IG51bGwge1xuICAgIGNvbnN0IG1vZHVsZVBhdGggPSBtb2R1bGVOYW1lXG4gICAgICAuc3BsaXQoXCIuXCIpXG4gICAgICAubWFwKChwYXJ0KSA9PiBwYXJ0LnRyaW0oKSlcbiAgICAgIC5maWx0ZXIoQm9vbGVhbilcbiAgICAgIC5qb2luKFwiL1wiKTtcbiAgICBjb25zdCBmcm9tRGlyID0gZGlybmFtZShmcm9tRmlsZVBhdGgpO1xuICAgIGNvbnN0IGJhc2VEaXJzID0gbGV2ZWwgPiAwXG4gICAgICA/IFt0aGlzLmFzY2VuZFZhdWx0UGF0aChmcm9tRGlyID09PSBcIi5cIiA/IFwiXCIgOiBmcm9tRGlyLCBsZXZlbCAtIDEpXVxuICAgICAgOiBbZnJvbURpciA9PT0gXCIuXCIgPyBcIlwiIDogZnJvbURpciwgXCJcIl07XG5cbiAgICBmb3IgKGNvbnN0IGJhc2VEaXIgb2YgYmFzZURpcnMpIHtcbiAgICAgIGNvbnN0IGNhbmRpZGF0ZXMgPSB0aGlzLmdldFB5dGhvbkltcG9ydENhbmRpZGF0ZXMoYmFzZURpciwgbW9kdWxlUGF0aCk7XG4gICAgICBmb3IgKGNvbnN0IGNhbmRpZGF0ZSBvZiBjYW5kaWRhdGVzKSB7XG4gICAgICAgIGNvbnN0IG5vcm1hbGl6ZWQgPSBub3JtYWxpemVQYXRoKGNhbmRpZGF0ZSk7XG4gICAgICAgIGlmICh0aGlzLmFwcC52YXVsdC5nZXRBYnN0cmFjdEZpbGVCeVBhdGgobm9ybWFsaXplZCkgaW5zdGFuY2VvZiBURmlsZSkge1xuICAgICAgICAgIHJldHVybiBub3JtYWxpemVkO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIG51bGw7XG4gIH1cblxuICBwcml2YXRlIGdldFB5dGhvbkltcG9ydENhbmRpZGF0ZXMoYmFzZURpcjogc3RyaW5nLCBtb2R1bGVQYXRoOiBzdHJpbmcpOiBzdHJpbmdbXSB7XG4gICAgY29uc3QgcHJlZml4ID0gYmFzZURpciA/IGAke2Jhc2VEaXJ9L2AgOiBcIlwiO1xuICAgIGlmICghbW9kdWxlUGF0aCkge1xuICAgICAgcmV0dXJuIFtgJHtwcmVmaXh9X19pbml0X18ucHlgXTtcbiAgICB9XG4gICAgcmV0dXJuIFtcbiAgICAgIGAke3ByZWZpeH0ke21vZHVsZVBhdGh9LnB5YCxcbiAgICAgIGAke3ByZWZpeH0ke21vZHVsZVBhdGh9L19faW5pdF9fLnB5YCxcbiAgICBdO1xuICB9XG5cbiAgcHJpdmF0ZSBhc2NlbmRWYXVsdFBhdGgocGF0aDogc3RyaW5nLCBsZXZlbHM6IG51bWJlcik6IHN0cmluZyB7XG4gICAgbGV0IGN1cnJlbnQgPSBwYXRoO1xuICAgIGZvciAobGV0IGluZGV4ID0gMDsgaW5kZXggPCBsZXZlbHM7IGluZGV4ICs9IDEpIHtcbiAgICAgIGNvbnN0IG5leHQgPSBkaXJuYW1lKGN1cnJlbnQpO1xuICAgICAgY3VycmVudCA9IG5leHQgPT09IFwiLlwiID8gXCJcIiA6IG5leHQ7XG4gICAgfVxuICAgIHJldHVybiBjdXJyZW50O1xuICB9XG5cbiAgYXN5bmMgZ2V0Q29udGFpbmVyR3JvdXBTdW1tYXJpZXMoKTogUHJvbWlzZTxBcnJheTx7IG5hbWU6IHN0cmluZzsgc3RhdHVzOiBzdHJpbmcgfT4+IHtcbiAgICByZXR1cm4gdGhpcy5jb250YWluZXJSdW5uZXIuZ2V0R3JvdXBTdW1tYXJpZXMoKTtcbiAgfVxuXG4gIGFzeW5jIGJ1aWxkQ29udGFpbmVyR3JvdXAobmFtZTogc3RyaW5nKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3QgY29udHJvbGxlciA9IG5ldyBBYm9ydENvbnRyb2xsZXIoKTtcbiAgICBjb25zdCByZXN1bHQgPSBhd2FpdCB0aGlzLmNvbnRhaW5lclJ1bm5lci5idWlsZEdyb3VwKG5hbWUsIE1hdGgubWF4KHRoaXMuc2V0dGluZ3MuZGVmYXVsdFRpbWVvdXRNcywgMTIwXzAwMCksIGNvbnRyb2xsZXIuc2lnbmFsKTtcbiAgICBuZXcgTm90aWNlKHJlc3VsdC5zdWNjZXNzID8gYGxvb20gYnVpbHQgY29udGFpbmVyIGdyb3VwICR7bmFtZX0uYCA6IGBsb29tIGNvbnRhaW5lciBidWlsZCBmYWlsZWQgZm9yICR7bmFtZX0uYCwgODAwMCk7XG4gIH1cblxuICByZWdpc3RlckNvZGVCbG9ja1Byb2Nlc3NvcnMoKTogdm9pZCB7XG4gICAgZm9yIChjb25zdCBhbGlhcyBvZiBnZXRTdXBwb3J0ZWRMYW5ndWFnZUFsaWFzZXModGhpcy5zZXR0aW5ncykpIHtcbiAgICAgIGNvbnN0IG5vcm1hbGl6ZWRBbGlhcyA9IGFsaWFzLnRvTG93ZXJDYXNlKCk7XG4gICAgICBpZiAodGhpcy5yZWdpc3RlcmVkQ29kZUJsb2NrQWxpYXNlcy5oYXMobm9ybWFsaXplZEFsaWFzKSkge1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cblxuICAgICAgaWYgKC9bXmEtekEtWjAtOV8tXS8udGVzdChub3JtYWxpemVkQWxpYXMpKSB7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuXG4gICAgICB0aGlzLnJlZ2lzdGVyZWRDb2RlQmxvY2tBbGlhc2VzLmFkZChub3JtYWxpemVkQWxpYXMpO1xuICAgICAgdGhpcy5yZWdpc3Rlck1hcmtkb3duQ29kZUJsb2NrUHJvY2Vzc29yKG5vcm1hbGl6ZWRBbGlhcywgYXN5bmMgKHNvdXJjZSwgZWwsIGN0eCkgPT4ge1xuICAgICAgICBjb25zdCBmaWxlUGF0aCA9IGN0eC5zb3VyY2VQYXRoO1xuICAgICAgICBjb25zdCBmaWxlID0gdGhpcy5hcHAudmF1bHQuZ2V0QWJzdHJhY3RGaWxlQnlQYXRoKGZpbGVQYXRoKTtcbiAgICAgICAgaWYgKCEoZmlsZSBpbnN0YW5jZW9mIFRGaWxlKSkge1xuICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IGZ1bGxUZXh0ID0gYXdhaXQgdGhpcy5hcHAudmF1bHQuY2FjaGVkUmVhZChmaWxlKTtcbiAgICAgICAgY29uc3QgYmxvY2tzID0gcGFyc2VNYXJrZG93bkNvZGVCbG9ja3MoZmlsZVBhdGgsIGZ1bGxUZXh0LCB0aGlzLnNldHRpbmdzKTtcbiAgICAgICAgY29uc3Qgc2VjdGlvbiA9IChjdHggJiYgdHlwZW9mIGN0eC5nZXRTZWN0aW9uSW5mbyA9PT0gXCJmdW5jdGlvblwiKSA/IGN0eC5nZXRTZWN0aW9uSW5mbyhlbCkgOiBudWxsO1xuICAgICAgICBsZXQgYmxvY2s6IGxvb21Db2RlQmxvY2sgfCB1bmRlZmluZWQ7XG4gICAgICAgIGlmIChzZWN0aW9uKSB7XG4gICAgICAgICAgY29uc3QgbGluZVN0YXJ0ID0gc2VjdGlvbi5saW5lU3RhcnQ7XG4gICAgICAgICAgYmxvY2sgPSBibG9ja3MuZmluZCgoY2FuZGlkYXRlKSA9PiBjYW5kaWRhdGUuc3RhcnRMaW5lID09PSBsaW5lU3RhcnQgJiYgY2FuZGlkYXRlLmNvbnRlbnQgPT09IHNvdXJjZSk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgYmxvY2sgPSBibG9ja3MuZmluZCgoY2FuZGlkYXRlKSA9PiBjYW5kaWRhdGUuY29udGVudCA9PT0gc291cmNlKTtcbiAgICAgICAgfVxuICAgICAgICBpZiAoIWJsb2NrKSB7XG4gICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgbGV0IHByZSA9IGVsLnF1ZXJ5U2VsZWN0b3IoXCJwcmVcIikgYXMgSFRNTEVsZW1lbnQgfCBudWxsO1xuICAgICAgICBpZiAoIXByZSkge1xuICAgICAgICAgIHByZSA9IGVsLmNyZWF0ZUVsKFwicHJlXCIpO1xuICAgICAgICAgIHByZS5hZGRDbGFzcyhgbGFuZ3VhZ2UtJHtub3JtYWxpemVkQWxpYXN9YCk7XG4gICAgICAgICAgY29uc3QgY29kZSA9IHByZS5jcmVhdGVFbChcImNvZGVcIik7XG4gICAgICAgICAgY29kZS5hZGRDbGFzcyhgbGFuZ3VhZ2UtJHtub3JtYWxpemVkQWxpYXN9YCk7XG4gICAgICAgICAgY29kZS5zZXRUZXh0KHNvdXJjZSk7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAoYmxvY2subGFuZ3VhZ2UgPT09IFwibGx2bS1pclwiKSB7XG4gICAgICAgICAgY29uc3QgY29kZSA9IChwcmUucXVlcnlTZWxlY3RvcihcImNvZGVcIikgYXMgSFRNTEVsZW1lbnQgfCBudWxsKSA/PyBwcmU7XG4gICAgICAgICAgaGlnaGxpZ2h0TGx2bUVsZW1lbnQoY29kZSwgc291cmNlKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGN0eC5hZGRDaGlsZChuZXcgbG9vbVRvb2xiYXJSZW5kZXJDaGlsZChlbCwgdGhpcywgYmxvY2ssIHByZSkpO1xuICAgICAgfSk7XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSB1cGRhdGVTdGF0dXNCYXIoKTogdm9pZCB7XG4gICAgY29uc3QgYWN0aXZlUnVucyA9IHRoaXMucnVubmluZy5zaXplO1xuICAgIHRoaXMuc3RhdHVzQmFySXRlbUVsLnNldFRleHQoYWN0aXZlUnVucyA/IGBsb29tOiAke2FjdGl2ZVJ1bnN9IEFjdGl2ZSBSdW4ke2FjdGl2ZVJ1bnMgPT09IDEgPyBcIlwiIDogXCJzXCJ9YCA6IFwibG9vbTogSWRsZVwiKTtcbiAgfVxuXG4gIHByaXZhdGUgbm90aWZ5T3V0cHV0Q2hhbmdlZChibG9ja0lkOiBzdHJpbmcpOiB2b2lkIHtcbiAgICB0aGlzLm91dHB1dExpc3RlbmVycy5nZXQoYmxvY2tJZCk/LmZvckVhY2goKGxpc3RlbmVyKSA9PiBsaXN0ZW5lcigpKTtcbiAgICB0aGlzLnJlZnJlc2hBbGxWaWV3cygpO1xuICB9XG5cbiAgcHJpdmF0ZSByZWZyZXNoQWxsVmlld3MoKTogdm9pZCB7XG4gICAgdGhpcy5hcHAud29ya3NwYWNlLmdldExlYXZlc09mVHlwZShcIm1hcmtkb3duXCIpLmZvckVhY2goKGxlYWYpID0+IHtcbiAgICAgIGNvbnN0IHZpZXcgPSBsZWFmLnZpZXcgYXMgTWFya2Rvd25WaWV3O1xuICAgICAgY29uc3QgcHJldmlld01vZGUgPSAodmlldyBhcyB7IHByZXZpZXdNb2RlPzogeyByZXJlbmRlcj86IChmb3JjZT86IGJvb2xlYW4pID0+IHZvaWQgfSB9KS5wcmV2aWV3TW9kZTtcbiAgICAgIHByZXZpZXdNb2RlPy5yZXJlbmRlcj8uKHRydWUpO1xuICAgIH0pO1xuXG4gICAgZm9yIChjb25zdCBlZGl0b3JWaWV3IG9mIHRoaXMuZWRpdG9yVmlld3MpIHtcbiAgICAgIGVkaXRvclZpZXcuZGlzcGF0Y2goeyBlZmZlY3RzOiBsb29tUmVmcmVzaEVmZmVjdC5vZih1bmRlZmluZWQpIH0pO1xuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgZ2V0QWN0aXZlTWFya2Rvd25GaWxlKCk6IFRGaWxlIHwgbnVsbCB7XG4gICAgY29uc3QgdmlldyA9IHRoaXMuYXBwLndvcmtzcGFjZS5nZXRBY3RpdmVWaWV3T2ZUeXBlKE1hcmtkb3duVmlldyk7XG4gICAgcmV0dXJuIHZpZXc/LmZpbGUgPz8gbnVsbDtcbiAgfVxuXG4gIHByaXZhdGUgZ2V0Q3VycmVudEVkaXRvckZpbGVQYXRoKCk6IHN0cmluZyB8IG51bGwge1xuICAgIHJldHVybiB0aGlzLmdldEFjdGl2ZU1hcmtkb3duRmlsZSgpPy5wYXRoID8/IHRoaXMubGFzdE1hcmtkb3duRmlsZVBhdGg7XG4gIH1cblxuICBhc3luYyBlbmZvcmNlU291cmNlTW9kZUZvckFjdGl2ZVZpZXcoKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3QgdmlldyA9IHRoaXMuYXBwLndvcmtzcGFjZS5nZXRBY3RpdmVWaWV3T2ZUeXBlKE1hcmtkb3duVmlldyk7XG4gICAgaWYgKCF2aWV3KSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgYXdhaXQgdGhpcy5lbmZvcmNlU291cmNlTW9kZUZvckxlYWYodmlldy5sZWFmKTtcbiAgfVxuXG4gIGFzeW5jIGRpc2FibGVTb3VyY2VNb2RlRm9yQWN0aXZlVmlldygpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCB2aWV3ID0gdGhpcy5hcHAud29ya3NwYWNlLmdldEFjdGl2ZVZpZXdPZlR5cGUoTWFya2Rvd25WaWV3KTtcbiAgICBpZiAoIXZpZXcpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBjb25zdCBsZWFmID0gdmlldy5sZWFmO1xuICAgIGNvbnN0IHZpZXdTdGF0ZSA9IGxlYWYuZ2V0Vmlld1N0YXRlKCk7XG4gICAgY29uc3Qgc3RhdGUgPSB7IC4uLih2aWV3U3RhdGUuc3RhdGUgPz8ge30pIH0gYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj47XG4gICAgXG4gICAgaWYgKHN0YXRlLm1vZGUgPT09IFwic291cmNlXCIgJiYgc3RhdGUuc291cmNlID09PSB0cnVlKSB7XG4gICAgICBzdGF0ZS5zb3VyY2UgPSBmYWxzZTtcbiAgICAgIGF3YWl0IGxlYWYuc2V0Vmlld1N0YXRlKHtcbiAgICAgICAgLi4udmlld1N0YXRlLFxuICAgICAgICBzdGF0ZSxcbiAgICAgIH0pO1xuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgZW5mb3JjZVNvdXJjZU1vZGVGb3JMZWFmKGxlYWY6IFdvcmtzcGFjZUxlYWYpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBpZiAoIXRoaXMuc2V0dGluZ3MucHJlc2VydmVTb3VyY2VNb2RlKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgaWYgKGxlYWYuaXNEZWZlcnJlZCkge1xuICAgICAgYXdhaXQgbGVhZi5sb2FkSWZEZWZlcnJlZCgpO1xuICAgIH1cblxuICAgIGNvbnN0IHZpZXcgPSBsZWFmLnZpZXc7XG4gICAgaWYgKCEodmlldyBpbnN0YW5jZW9mIE1hcmtkb3duVmlldykgfHwgIXZpZXcuZmlsZSkge1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGNvbnN0IHNvdXJjZSA9IHZpZXcuZWRpdG9yPy5nZXRWYWx1ZT8uKCkgPz8gKGF3YWl0IHRoaXMuYXBwLnZhdWx0LmNhY2hlZFJlYWQodmlldy5maWxlKSk7XG4gICAgY29uc3QgYmxvY2tzID0gcGFyc2VNYXJrZG93bkNvZGVCbG9ja3Modmlldy5maWxlLnBhdGgsIHNvdXJjZSwgdGhpcy5zZXR0aW5ncyk7XG4gICAgaWYgKCFibG9ja3MubGVuZ3RoKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgY29uc3Qgdmlld1N0YXRlID0gbGVhZi5nZXRWaWV3U3RhdGUoKTtcbiAgICBjb25zdCBzdGF0ZSA9IHsgLi4uKHZpZXdTdGF0ZS5zdGF0ZSA/PyB7fSkgfSBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPjtcbiAgICBpZiAoc3RhdGUubW9kZSA9PT0gXCJzb3VyY2VcIiAmJiBzdGF0ZS5zb3VyY2UgPT09IHRydWUpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBzdGF0ZS5tb2RlID0gXCJzb3VyY2VcIjtcbiAgICBzdGF0ZS5zb3VyY2UgPSB0cnVlO1xuXG4gICAgYXdhaXQgbGVhZi5zZXRWaWV3U3RhdGUoe1xuICAgICAgLi4udmlld1N0YXRlLFxuICAgICAgc3RhdGUsXG4gICAgfSk7XG4gIH1cblxuICBwcml2YXRlIGZpbmRBY3RpdmVCbG9ja0J5SWQoYmxvY2tJZDogc3RyaW5nKTogbG9vbUNvZGVCbG9jayB8IG51bGwge1xuICAgIGNvbnN0IHZpZXcgPSB0aGlzLmFwcC53b3Jrc3BhY2UuZ2V0QWN0aXZlVmlld09mVHlwZShNYXJrZG93blZpZXcpO1xuICAgIGNvbnN0IGZpbGUgPSB2aWV3Py5maWxlO1xuICAgIGNvbnN0IGVkaXRvciA9IHZpZXc/LmVkaXRvcjtcbiAgICBpZiAoIWZpbGUgfHwgIWVkaXRvcikge1xuICAgICAgcmV0dXJuIHRoaXMub3V0cHV0cy5nZXQoYmxvY2tJZCk/LmJsb2NrID8/IG51bGw7XG4gICAgfVxuXG4gICAgY29uc3QgYmxvY2tzID0gcGFyc2VNYXJrZG93bkNvZGVCbG9ja3MoZmlsZS5wYXRoLCBlZGl0b3IuZ2V0VmFsdWUoKSwgdGhpcy5zZXR0aW5ncyk7XG4gICAgcmV0dXJuIGJsb2Nrcy5maW5kKChibG9jaykgPT4gYmxvY2suaWQgPT09IGJsb2NrSWQpID8/IHRoaXMub3V0cHV0cy5nZXQoYmxvY2tJZCk/LmJsb2NrID8/IG51bGw7XG4gIH1cblxuICBwcml2YXRlIGNyZWF0ZUxpdmVQcmV2aWV3RXh0ZW5zaW9uKCkge1xuICAgIGNvbnN0IHBsdWdpbiA9IHRoaXM7XG5cbiAgICByZXR1cm4gVmlld1BsdWdpbi5mcm9tQ2xhc3MoXG4gICAgICBjbGFzcyB7XG4gICAgICAgIGRlY29yYXRpb25zO1xuXG4gICAgICAgIGNvbnN0cnVjdG9yKHByaXZhdGUgcmVhZG9ubHkgdmlldzogRWRpdG9yVmlldykge1xuICAgICAgICAgIHBsdWdpbi5lZGl0b3JWaWV3cy5hZGQodmlldyk7XG4gICAgICAgICAgdGhpcy5kZWNvcmF0aW9ucyA9IHRoaXMuYnVpbGREZWNvcmF0aW9ucygpO1xuICAgICAgICB9XG5cbiAgICAgICAgdXBkYXRlKHVwZGF0ZTogVmlld1VwZGF0ZSk6IHZvaWQge1xuICAgICAgICAgIGlmICh1cGRhdGUuZG9jQ2hhbmdlZCB8fCB1cGRhdGUudmlld3BvcnRDaGFuZ2VkIHx8IHVwZGF0ZS50cmFuc2FjdGlvbnMuc29tZSgodHIpID0+IHRyLmVmZmVjdHMuc29tZSgoZWZmZWN0KSA9PiBlZmZlY3QuaXMobG9vbVJlZnJlc2hFZmZlY3QpKSkpIHtcbiAgICAgICAgICAgIHRoaXMuZGVjb3JhdGlvbnMgPSB0aGlzLmJ1aWxkRGVjb3JhdGlvbnMoKTtcbiAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICBkZXN0cm95KCk6IHZvaWQge1xuICAgICAgICAgIHBsdWdpbi5lZGl0b3JWaWV3cy5kZWxldGUodGhpcy52aWV3KTtcbiAgICAgICAgfVxuXG4gICAgICAgIHByaXZhdGUgYnVpbGREZWNvcmF0aW9ucygpIHtcbiAgICAgICAgICBjb25zdCBmaWxlUGF0aCA9IHBsdWdpbi5nZXRDdXJyZW50RWRpdG9yRmlsZVBhdGgoKTtcbiAgICAgICAgICBpZiAoIWZpbGVQYXRoKSB7XG4gICAgICAgICAgICByZXR1cm4gRGVjb3JhdGlvbi5ub25lO1xuICAgICAgICAgIH1cblxuICAgICAgICAgIGNvbnN0IHNvdXJjZSA9IHRoaXMudmlldy5zdGF0ZS5kb2MudG9TdHJpbmcoKTtcbiAgICAgICAgICBjb25zdCBibG9ja3MgPSBwYXJzZU1hcmtkb3duQ29kZUJsb2NrcyhmaWxlUGF0aCwgc291cmNlLCBwbHVnaW4uc2V0dGluZ3MpO1xuICAgICAgICAgIGNvbnN0IGJ1aWxkZXIgPSBuZXcgUmFuZ2VTZXRCdWlsZGVyPERlY29yYXRpb24+KCk7XG5cbiAgICAgICAgICBmb3IgKGNvbnN0IGJsb2NrIG9mIGJsb2Nrcykge1xuICAgICAgICAgICAgY29uc3Qgc3RhcnRMaW5lID0gdGhpcy52aWV3LnN0YXRlLmRvYy5saW5lKGJsb2NrLnN0YXJ0TGluZSArIDEpO1xuICAgICAgICAgICAgYnVpbGRlci5hZGQoXG4gICAgICAgICAgICAgIHN0YXJ0TGluZS5mcm9tLFxuICAgICAgICAgICAgICBzdGFydExpbmUuZnJvbSxcbiAgICAgICAgICAgICAgRGVjb3JhdGlvbi53aWRnZXQoe1xuICAgICAgICAgICAgICAgIHdpZGdldDogbmV3IGxvb21Ub29sYmFyV2lkZ2V0KHBsdWdpbiwgYmxvY2spLFxuICAgICAgICAgICAgICAgIHNpZGU6IC0xLFxuICAgICAgICAgICAgICB9KSxcbiAgICAgICAgICAgICk7XG5cbiAgICAgICAgICAgIGlmIChwbHVnaW4ub3V0cHV0cy5oYXMoYmxvY2suaWQpIHx8IHBsdWdpbi5ydW5uaW5nLmhhcyhibG9jay5pZCkpIHtcbiAgICAgICAgICAgICAgY29uc3QgZW5kTGluZSA9IHRoaXMudmlldy5zdGF0ZS5kb2MubGluZShibG9jay5lbmRMaW5lICsgMSk7XG4gICAgICAgICAgICAgIGJ1aWxkZXIuYWRkKFxuICAgICAgICAgICAgICAgIGVuZExpbmUudG8sXG4gICAgICAgICAgICAgICAgZW5kTGluZS50byxcbiAgICAgICAgICAgICAgICBEZWNvcmF0aW9uLndpZGdldCh7XG4gICAgICAgICAgICAgICAgICB3aWRnZXQ6IG5ldyBsb29tT3V0cHV0V2lkZ2V0KHBsdWdpbiwgYmxvY2suaWQpLFxuICAgICAgICAgICAgICAgICAgc2lkZTogMSxcbiAgICAgICAgICAgICAgICB9KSxcbiAgICAgICAgICAgICAgKTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgaWYgKGJsb2NrLmxhbmd1YWdlID09PSBcImxsdm0taXJcIikge1xuICAgICAgICAgICAgICBhZGRMbHZtRGVjb3JhdGlvbnMoYnVpbGRlciwgdGhpcy52aWV3LCBibG9jayk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfVxuXG4gICAgICAgICAgcmV0dXJuIGJ1aWxkZXIuZmluaXNoKCk7XG4gICAgICAgIH1cbiAgICAgIH0sXG4gICAgICB7XG4gICAgICAgIGRlY29yYXRpb25zOiAodmFsdWUpID0+IHZhbHVlLmRlY29yYXRpb25zLFxuICAgICAgfSxcbiAgICApO1xuICB9XG5cbiAgcHJpdmF0ZSBnZXRDdXN0b21MYW5ndWFnZUV4dHJhY3RvcihsYW5ndWFnZUlkOiBzdHJpbmcsIGZpbGU6IFRGaWxlKTogeyBtb2RlOiBcImNvbW1hbmRcIiB8IFwidHJhbnNwaWxlLWNcIjsgbGFuZ3VhZ2U6IHN0cmluZzsgZXhlY3V0YWJsZTogc3RyaW5nOyBhcmdzOiBzdHJpbmdbXTsgd29ya2luZ0RpcmVjdG9yeTogc3RyaW5nOyB0aW1lb3V0TXM6IG51bWJlciB9IHwgdW5kZWZpbmVkIHtcbiAgICBjb25zdCBub3JtYWxpemVkID0gbGFuZ3VhZ2VJZC50cmltKCkudG9Mb3dlckNhc2UoKTtcbiAgICBjb25zdCBsYW5ndWFnZSA9IHRoaXMuc2V0dGluZ3MuY3VzdG9tTGFuZ3VhZ2VzLmZpbmQoKGNhbmRpZGF0ZSkgPT4ge1xuICAgICAgY29uc3QgbmFtZSA9IGNhbmRpZGF0ZS5uYW1lLnRyaW0oKS50b0xvd2VyQ2FzZSgpO1xuICAgICAgY29uc3QgYWxpYXNlcyA9IGNhbmRpZGF0ZS5hbGlhc2VzXG4gICAgICAgIC5zcGxpdChcIixcIilcbiAgICAgICAgLm1hcCgoYWxpYXMpID0+IGFsaWFzLnRyaW0oKS50b0xvd2VyQ2FzZSgpKVxuICAgICAgICAuZmlsdGVyKEJvb2xlYW4pO1xuICAgICAgcmV0dXJuIG5hbWUgPT09IG5vcm1hbGl6ZWQgfHwgYWxpYXNlcy5pbmNsdWRlcyhub3JtYWxpemVkKTtcbiAgICB9KTtcbiAgICBpZiAoIWxhbmd1YWdlKSB7XG4gICAgICByZXR1cm4gdW5kZWZpbmVkO1xuICAgIH1cblxuICAgIGNvbnN0IG1vZGUgPSBsYW5ndWFnZS5leHRyYWN0b3JNb2RlIHx8IFwiY29tbWFuZFwiO1xuICAgIGNvbnN0IGV4ZWN1dGFibGUgPSBtb2RlID09PSBcInRyYW5zcGlsZS1jXCIgPyBsYW5ndWFnZS50cmFuc3BpbGVFeGVjdXRhYmxlPy50cmltKCkgOiBsYW5ndWFnZS5leHRyYWN0b3JFeGVjdXRhYmxlPy50cmltKCk7XG4gICAgY29uc3QgYXJncyA9IG1vZGUgPT09IFwidHJhbnNwaWxlLWNcIiA/IGxhbmd1YWdlLnRyYW5zcGlsZUFyZ3MgfHwgXCJ7cmVxdWVzdH1cIiA6IGxhbmd1YWdlLmV4dHJhY3RvckFyZ3MgfHwgXCJ7cmVxdWVzdH1cIjtcbiAgICBpZiAoIWV4ZWN1dGFibGUpIHtcbiAgICAgIHJldHVybiB1bmRlZmluZWQ7XG4gICAgfVxuXG4gICAgcmV0dXJuIHtcbiAgICAgIG1vZGUsXG4gICAgICBsYW5ndWFnZTogbGFuZ3VhZ2UubmFtZSxcbiAgICAgIGV4ZWN1dGFibGUsXG4gICAgICBhcmdzOiBzcGxpdENvbW1hbmRMaW5lKGFyZ3MpLFxuICAgICAgd29ya2luZ0RpcmVjdG9yeTogdGhpcy5yZXNvbHZlV29ya2luZ0RpcmVjdG9yeShmaWxlKSxcbiAgICAgIHRpbWVvdXRNczogdGhpcy5zZXR0aW5ncy5kZWZhdWx0VGltZW91dE1zLFxuICAgIH07XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIHdyaXRlTWFuYWdlZE91dHB1dEJsb2NrKGZpbGU6IFRGaWxlLCBibG9jazogbG9vbUNvZGVCbG9jaywgcmVzdWx0OiBsb29tU3RvcmVkT3V0cHV0W1wicmVzdWx0XCJdKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgYXdhaXQgdGhpcy5hcHAudmF1bHQucHJvY2VzcyhmaWxlLCAoY29udGVudCkgPT4ge1xuICAgICAgY29uc3QgbGluZXMgPSBjb250ZW50LnNwbGl0KC9cXHI/XFxuLyk7XG4gICAgICBjb25zdCBibG9ja3MgPSBwYXJzZU1hcmtkb3duQ29kZUJsb2NrcyhmaWxlLnBhdGgsIGNvbnRlbnQsIHRoaXMuc2V0dGluZ3MpO1xuICAgICAgY29uc3QgY3VycmVudEJsb2NrID0gYmxvY2tzLmZpbmQoKGNhbmRpZGF0ZSkgPT4gY2FuZGlkYXRlLmlkID09PSBibG9jay5pZCk7XG4gICAgICBjb25zdCByZW5kZXJlZCA9IHRoaXMucmVuZGVyTWFuYWdlZE91dHB1dE1hcmtkb3duKGJsb2NrLmlkLCByZXN1bHQpO1xuICAgICAgY29uc3QgZXhpc3RpbmdSYW5nZSA9IHRoaXMuZmluZE1hbmFnZWRPdXRwdXRSYW5nZShsaW5lcywgYmxvY2suaWQpO1xuXG4gICAgICBpZiAoZXhpc3RpbmdSYW5nZSkge1xuICAgICAgICBsaW5lcy5zcGxpY2UoZXhpc3RpbmdSYW5nZS5zdGFydCwgZXhpc3RpbmdSYW5nZS5lbmQgLSBleGlzdGluZ1JhbmdlLnN0YXJ0ICsgMSwgLi4ucmVuZGVyZWQpO1xuICAgICAgICByZXR1cm4gbGluZXMuam9pbihcIlxcblwiKTtcbiAgICAgIH1cblxuICAgICAgaWYgKCFjdXJyZW50QmxvY2spIHtcbiAgICAgICAgcmV0dXJuIGNvbnRlbnQ7XG4gICAgICB9XG5cbiAgICAgIGxpbmVzLnNwbGljZShjdXJyZW50QmxvY2suZW5kTGluZSArIDEsIDAsIC4uLnJlbmRlcmVkKTtcbiAgICAgIHJldHVybiBsaW5lcy5qb2luKFwiXFxuXCIpO1xuICAgIH0pO1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyByZW1vdmVNYW5hZ2VkT3V0cHV0QmxvY2soZmlsZVBhdGg6IHN0cmluZywgYmxvY2tJZDogc3RyaW5nKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3QgZmlsZSA9IHRoaXMuYXBwLnZhdWx0LmdldEFic3RyYWN0RmlsZUJ5UGF0aChmaWxlUGF0aCk7XG4gICAgaWYgKCEoZmlsZSBpbnN0YW5jZW9mIFRGaWxlKSkge1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGF3YWl0IHRoaXMuYXBwLnZhdWx0LnByb2Nlc3MoZmlsZSwgKGNvbnRlbnQpID0+IHtcbiAgICAgIGNvbnN0IGxpbmVzID0gY29udGVudC5zcGxpdCgvXFxyP1xcbi8pO1xuICAgICAgY29uc3QgcmFuZ2UgPSB0aGlzLmZpbmRNYW5hZ2VkT3V0cHV0UmFuZ2UobGluZXMsIGJsb2NrSWQpO1xuICAgICAgaWYgKCFyYW5nZSkge1xuICAgICAgICByZXR1cm4gY29udGVudDtcbiAgICAgIH1cbiAgICAgIGxpbmVzLnNwbGljZShyYW5nZS5zdGFydCwgcmFuZ2UuZW5kIC0gcmFuZ2Uuc3RhcnQgKyAxKTtcbiAgICAgIHJldHVybiBsaW5lcy5qb2luKFwiXFxuXCIpO1xuICAgIH0pO1xuICB9XG5cbiAgcHJpdmF0ZSByZW5kZXJNYW5hZ2VkT3V0cHV0TWFya2Rvd24oYmxvY2tJZDogc3RyaW5nLCByZXN1bHQ6IGxvb21TdG9yZWRPdXRwdXRbXCJyZXN1bHRcIl0pOiBzdHJpbmdbXSB7XG4gICAgY29uc3QgYm9keSA9IFtcbiAgICAgIGBydW5uZXI9JHtyZXN1bHQucnVubmVyTmFtZX1gLFxuICAgICAgYGV4aXQ9JHtyZXN1bHQuZXhpdENvZGUgPz8gXCI/XCJ9YCxcbiAgICAgIGBkdXJhdGlvbj0ke3Jlc3VsdC5kdXJhdGlvbk1zfW1zYCxcbiAgICAgIGB0aW1lc3RhbXA9JHtyZXN1bHQuZmluaXNoZWRBdH1gLFxuICAgICAgcmVzdWx0LnN0ZG91dCA/IGBzdGRvdXQ6XFxuJHtyZXN1bHQuc3Rkb3V0fWAgOiBcIlwiLFxuICAgICAgcmVzdWx0Lndhcm5pbmcgPyBgd2FybmluZzpcXG4ke3Jlc3VsdC53YXJuaW5nfWAgOiBcIlwiLFxuICAgICAgcmVzdWx0LnN0ZGVyciA/IGBzdGRlcnI6XFxuJHtyZXN1bHQuc3RkZXJyfWAgOiBcIlwiLFxuICAgIF1cbiAgICAgIC5maWx0ZXIoQm9vbGVhbilcbiAgICAgIC5qb2luKFwiXFxuXFxuXCIpO1xuXG4gICAgcmV0dXJuIFtcbiAgICAgIGA8IS0tIGxvb206b3V0cHV0OnN0YXJ0IGlkPSR7YmxvY2tJZH0gLS0+YCxcbiAgICAgIFwiYGBgdGV4dFwiLFxuICAgICAgYm9keSxcbiAgICAgIFwiYGBgXCIsXG4gICAgICBcIjwhLS0gbG9vbTpvdXRwdXQ6ZW5kIC0tPlwiLFxuICAgIF07XG4gIH1cblxuICBwcml2YXRlIGZpbmRNYW5hZ2VkT3V0cHV0UmFuZ2UobGluZXM6IHN0cmluZ1tdLCBibG9ja0lkOiBzdHJpbmcpOiB7IHN0YXJ0OiBudW1iZXI7IGVuZDogbnVtYmVyIH0gfCBudWxsIHtcbiAgICBjb25zdCBzdGFydE1hcmtlciA9IGA8IS0tIGxvb206b3V0cHV0OnN0YXJ0IGlkPSR7YmxvY2tJZH0gLS0+YDtcbiAgICBmb3IgKGxldCBpID0gMDsgaSA8IGxpbmVzLmxlbmd0aDsgaSArPSAxKSB7XG4gICAgICBpZiAobGluZXNbaV0udHJpbSgpICE9PSBzdGFydE1hcmtlcikge1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cblxuICAgICAgZm9yIChsZXQgaiA9IGkgKyAxOyBqIDwgbGluZXMubGVuZ3RoOyBqICs9IDEpIHtcbiAgICAgICAgaWYgKGxpbmVzW2pdLnRyaW0oKSA9PT0gXCI8IS0tIGxvb206b3V0cHV0OmVuZCAtLT5cIikge1xuICAgICAgICAgIHJldHVybiB7IHN0YXJ0OiBpLCBlbmQ6IGogfTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cbiAgICByZXR1cm4gbnVsbDtcbiAgfVxufVxuIiwgImltcG9ydCB7IE5vdGljZSwgdHlwZSBBcHAsIHR5cGUgVEZpbGUgfSBmcm9tIFwib2JzaWRpYW5cIjtcbmltcG9ydCB7IGNsb3NlU3luYywgZXhpc3RzU3luYywgb3BlblN5bmMgfSBmcm9tIFwiZnNcIjtcbmltcG9ydCB7IG1rZGlyLCByZWFkRmlsZSwgcmVhZGRpciwgcm0sIHdyaXRlRmlsZSB9IGZyb20gXCJmcy9wcm9taXNlc1wiO1xuaW1wb3J0IHsgYmFzZW5hbWUsIGpvaW4sIG5vcm1hbGl6ZSBhcyBub3JtYWxpemVGc1BhdGgsIHBvc2l4IGFzIHBvc2l4UGF0aCB9IGZyb20gXCJwYXRoXCI7XG5pbXBvcnQgeyBzcGF3biB9IGZyb20gXCJjaGlsZF9wcm9jZXNzXCI7XG5pbXBvcnQgeyBydW5Qcm9jZXNzIH0gZnJvbSBcIi4vcHJvY2Vzc1J1bm5lclwiO1xuaW1wb3J0IHsgc3BsaXRDb21tYW5kTGluZSB9IGZyb20gXCIuLi91dGlscy9jb21tYW5kXCI7XG5pbXBvcnQgdHlwZSB7IGxvb21Db2RlQmxvY2ssIGxvb21QbHVnaW5TZXR0aW5ncywgbG9vbVJ1bkNvbnRleHQsIGxvb21SdW5SZXN1bHQgfSBmcm9tIFwiLi4vdHlwZXNcIjtcblxudHlwZSBsb29tQ29udGFpbmVyUnVudGltZSA9IFwiZG9ja2VyXCIgfCBcInBvZG1hblwiIHwgXCJxZW11XCIgfCBcIndzbFwiIHwgXCJjdXN0b21cIjtcblxuaW50ZXJmYWNlIGxvb21Db250YWluZXJMYW5ndWFnZUNvbmZpZyB7XG4gIGNvbW1hbmQ/OiBzdHJpbmc7XG4gIGV4dGVuc2lvbj86IHN0cmluZztcbiAgdXNlRGVmYXVsdD86IGJvb2xlYW47XG59XG5cbmludGVyZmFjZSBsb29tQ29tbWFuZEV4cGVjdGF0aW9uIHtcbiAgY29tbWFuZDogc3RyaW5nO1xuICBwb3NpdGl2ZVJlc3BvbnNlPzogc3RyaW5nO1xuICBuZWdhdGl2ZVJlc3BvbnNlPzogc3RyaW5nO1xufVxuXG5pbnRlcmZhY2UgbG9vbVFlbXVDb25maWcge1xuICBzc2hUYXJnZXQ6IHN0cmluZztcbiAgcmVtb3RlV29ya3NwYWNlOiBzdHJpbmc7XG4gIHNzaEV4ZWN1dGFibGU/OiBzdHJpbmc7XG4gIHNzaEFyZ3M/OiBzdHJpbmc7XG4gIHN0YXJ0Q29tbWFuZD86IHN0cmluZztcbiAgYnVpbGRDb21tYW5kPzogc3RyaW5nO1xuICB0ZWFyZG93bkNvbW1hbmQ/OiBzdHJpbmc7XG4gIGhlYWx0aENoZWNrPzogbG9vbUNvbW1hbmRFeHBlY3RhdGlvbjtcbiAgbWFuYWdlcj86IGxvb21RZW11TWFuYWdlckNvbmZpZztcbn1cblxuaW50ZXJmYWNlIGxvb21RZW11TWFuYWdlckNvbmZpZyB7XG4gIGVuYWJsZWQ6IGJvb2xlYW47XG4gIGV4ZWN1dGFibGU/OiBzdHJpbmc7XG4gIGFyZ3M/OiBzdHJpbmc7XG4gIGltYWdlPzogc3RyaW5nO1xuICBpbWFnZUZvcm1hdD86IHN0cmluZztcbiAgcGlkRmlsZT86IHN0cmluZztcbiAgbG9nRmlsZT86IHN0cmluZztcbiAgcmVhZGluZXNzVGltZW91dE1zPzogbnVtYmVyO1xuICByZWFkaW5lc3NJbnRlcnZhbE1zPzogbnVtYmVyO1xuICBib290RGVsYXlNcz86IG51bWJlcjtcbiAgc2h1dGRvd25Db21tYW5kPzogc3RyaW5nO1xuICBzaHV0ZG93blRpbWVvdXRNcz86IG51bWJlcjtcbiAga2lsbFNpZ25hbD86IE5vZGVKUy5TaWduYWxzO1xuICBwZXJzaXN0PzogYm9vbGVhbjtcbn1cblxuaW50ZXJmYWNlIGxvb21DdXN0b21SdW50aW1lQ29uZmlnIHtcbiAgZXhlY3V0YWJsZTogc3RyaW5nO1xuICBhcmdzPzogc3RyaW5nO1xuICBidWlsZD86IHN0cmluZztcbiAgY29tbWFuZFN0cnVjdHVyZT86IHN0cmluZztcbiAgdGVhcmRvd24/OiBzdHJpbmc7XG4gIGhlYWx0aENoZWNrPzogbG9vbUNvbW1hbmRFeHBlY3RhdGlvbjtcbn1cblxuaW50ZXJmYWNlIGxvb21Xc2xDb25maWcge1xuICBpbnRlcmFjdGl2ZT86IGJvb2xlYW47XG59XG5cbmludGVyZmFjZSBsb29tQ29udGFpbmVyQ29uZmlnIHtcbiAgcnVudGltZTogbG9vbUNvbnRhaW5lclJ1bnRpbWU7XG4gIGV4ZWN1dGFibGU/OiBzdHJpbmc7XG4gIGltYWdlPzogc3RyaW5nO1xuICB3c2w/OiBsb29tV3NsQ29uZmlnO1xuICBoZWFsdGhDaGVjaz86IGxvb21Db21tYW5kRXhwZWN0YXRpb247XG4gIHFlbXU/OiBsb29tUWVtdUNvbmZpZztcbiAgY3VzdG9tPzogbG9vbUN1c3RvbVJ1bnRpbWVDb25maWc7XG4gIGxhbmd1YWdlczogUmVjb3JkPHN0cmluZywgbG9vbUNvbnRhaW5lckxhbmd1YWdlQ29uZmlnPjtcbn1cblxuaW50ZXJmYWNlIGxvb21DdXN0b21SdW50aW1lUmVxdWVzdCB7XG4gIGFjdGlvbjogXCJidWlsZFwiIHwgXCJydW5cIiB8IFwidGVhcmRvd25cIjtcbiAgZ3JvdXBOYW1lOiBzdHJpbmc7XG4gIGdyb3VwUGF0aDogc3RyaW5nO1xuICBydW50aW1lOiBsb29tQ29udGFpbmVyUnVudGltZTtcbiAgaW1hZ2U/OiBzdHJpbmc7XG4gIGJ1aWxkPzogc3RyaW5nO1xuICBjb21tYW5kU3RydWN0dXJlPzogc3RyaW5nO1xuICB0ZWFyZG93bj86IHN0cmluZztcbiAgbGFuZ3VhZ2U/OiBzdHJpbmc7XG4gIGxhbmd1YWdlQWxpYXM/OiBzdHJpbmc7XG4gIGZpbGVOYW1lPzogc3RyaW5nO1xuICBmaWxlUGF0aD86IHN0cmluZztcbiAgY29tbWFuZD86IHN0cmluZztcbiAgdGltZW91dE1zOiBudW1iZXI7XG4gIGNvbmZpZzoge1xuICAgIGV4ZWN1dGFibGU/OiBzdHJpbmc7XG4gICAgY3VzdG9tPzogbG9vbUN1c3RvbVJ1bnRpbWVDb25maWc7XG4gICAgcWVtdT86IGxvb21RZW11Q29uZmlnO1xuICAgIGhlYWx0aENoZWNrPzogbG9vbUNvbW1hbmRFeHBlY3RhdGlvbjtcbiAgfTtcbn1cblxuZXhwb3J0IGNsYXNzIGxvb21Db250YWluZXJSdW5uZXIge1xuICBwcml2YXRlIHJlYWRvbmx5IGJ1aWx0SW1hZ2VzID0gbmV3IFNldDxzdHJpbmc+KCk7XG5cbiAgY29uc3RydWN0b3IoXG4gICAgcHJpdmF0ZSByZWFkb25seSBhcHA6IEFwcCxcbiAgICBwcml2YXRlIHJlYWRvbmx5IHBsdWdpbkRpcjogc3RyaW5nLFxuICApIHsgfVxuXG4gIGdldENvbnRhaW5lckdyb3VwTmFtZShmaWxlOiBURmlsZSk6IHN0cmluZyB8IG51bGwge1xuICAgIGNvbnN0IGZyb250bWF0dGVyID0gdGhpcy5hcHAubWV0YWRhdGFDYWNoZS5nZXRGaWxlQ2FjaGUoZmlsZSk/LmZyb250bWF0dGVyO1xuICAgIGNvbnN0IHZhbHVlID0gZnJvbnRtYXR0ZXI/LltcImxvb20tY29udGFpbmVyXCJdO1xuICAgIHJldHVybiB0eXBlb2YgdmFsdWUgPT09IFwic3RyaW5nXCIgJiYgdmFsdWUudHJpbSgpID8gdmFsdWUudHJpbSgpIDogbnVsbDtcbiAgfVxuXG4gIGFzeW5jIGdldEdyb3VwU3VtbWFyaWVzKCk6IFByb21pc2U8QXJyYXk8eyBuYW1lOiBzdHJpbmc7IHN0YXR1czogc3RyaW5nIH0+PiB7XG4gICAgY29uc3QgY29udGFpbmVyc1BhdGggPSB0aGlzLmdldENvbnRhaW5lcnNQYXRoKCk7XG4gICAgaWYgKCFleGlzdHNTeW5jKGNvbnRhaW5lcnNQYXRoKSkge1xuICAgICAgcmV0dXJuIFtdO1xuICAgIH1cblxuICAgIGNvbnN0IGVudHJpZXMgPSBhd2FpdCByZWFkZGlyKGNvbnRhaW5lcnNQYXRoLCB7IHdpdGhGaWxlVHlwZXM6IHRydWUgfSk7XG4gICAgcmV0dXJuIFByb21pc2UuYWxsKFxuICAgICAgZW50cmllc1xuICAgICAgICAuZmlsdGVyKChlbnRyeSkgPT4gZW50cnkuaXNEaXJlY3RvcnkoKSlcbiAgICAgICAgLm1hcChhc3luYyAoZW50cnkpID0+IHtcbiAgICAgICAgICBjb25zdCBncm91cFBhdGggPSBqb2luKGNvbnRhaW5lcnNQYXRoLCBlbnRyeS5uYW1lKTtcbiAgICAgICAgICBjb25zdCBoYXNDb25maWcgPSBleGlzdHNTeW5jKGpvaW4oZ3JvdXBQYXRoLCBcImNvbmZpZy5qc29uXCIpKTtcbiAgICAgICAgICBjb25zdCBoYXNEb2NrZXJmaWxlID0gZXhpc3RzU3luYyhqb2luKGdyb3VwUGF0aCwgXCJEb2NrZXJmaWxlXCIpKTtcbiAgICAgICAgICBpZiAoIWhhc0NvbmZpZykge1xuICAgICAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgICAgbmFtZTogZW50cnkubmFtZSxcbiAgICAgICAgICAgICAgc3RhdHVzOiBcIm1pc3NpbmcgY29uZmlnLmpzb25cIixcbiAgICAgICAgICAgIH07XG4gICAgICAgICAgfVxuICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICBjb25zdCBjb25maWcgPSBhd2FpdCB0aGlzLnJlYWRDb25maWcoZ3JvdXBQYXRoKTtcbiAgICAgICAgICAgIGNvbnN0IHBpZWNlcyA9IFtgcnVudGltZTogJHtjb25maWcucnVudGltZX1gXTtcbiAgICAgICAgICAgIGlmICgoY29uZmlnLnJ1bnRpbWUgPT09IFwiZG9ja2VyXCIgfHwgY29uZmlnLnJ1bnRpbWUgPT09IFwicG9kbWFuXCIpICYmIGhhc0RvY2tlcmZpbGUpIHtcbiAgICAgICAgICAgICAgcGllY2VzLnB1c2goXCJEb2NrZXJmaWxlXCIpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKGNvbmZpZy5ydW50aW1lID09PSBcInFlbXVcIiAmJiBjb25maWcucWVtdT8uc3NoVGFyZ2V0KSB7XG4gICAgICAgICAgICAgIHBpZWNlcy5wdXNoKGBzc2g6ICR7Y29uZmlnLnFlbXUuc3NoVGFyZ2V0fWApO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKGNvbmZpZy5ydW50aW1lID09PSBcInFlbXVcIiAmJiBjb25maWcucWVtdT8ubWFuYWdlcj8uZW5hYmxlZCkge1xuICAgICAgICAgICAgICBwaWVjZXMucHVzaChgbWFuYWdlcjogJHthd2FpdCB0aGlzLmdldE1hbmFnZWRRZW11U3RhdHVzKGdyb3VwUGF0aCwgY29uZmlnLnFlbXUubWFuYWdlcil9YCk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZiAoY29uZmlnLnJ1bnRpbWUgPT09IFwiY3VzdG9tXCIgJiYgY29uZmlnLmN1c3RvbT8uZXhlY3V0YWJsZSkge1xuICAgICAgICAgICAgICBwaWVjZXMucHVzaChgd3JhcHBlcjogJHtjb25maWcuY3VzdG9tLmV4ZWN1dGFibGV9YCk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBjb25zdCBsYW5ndWFnZUNvdW50ID0gT2JqZWN0LmtleXMoY29uZmlnLmxhbmd1YWdlcykubGVuZ3RoO1xuICAgICAgICAgICAgcGllY2VzLnB1c2goYCR7bGFuZ3VhZ2VDb3VudH0gbGFuZ3VhZ2Uke2xhbmd1YWdlQ291bnQgPT09IDEgPyBcIlwiIDogXCJzXCJ9YCk7XG4gICAgICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgICBuYW1lOiBlbnRyeS5uYW1lLFxuICAgICAgICAgICAgICBzdGF0dXM6IHBpZWNlcy5qb2luKFwiLCBcIiksXG4gICAgICAgICAgICB9O1xuICAgICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgICBuYW1lOiBlbnRyeS5uYW1lLFxuICAgICAgICAgICAgICBzdGF0dXM6IGBpbnZhbGlkIGNvbmZpZy5qc29uOiAke2Vycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogU3RyaW5nKGVycm9yKX1gLFxuICAgICAgICAgICAgfTtcbiAgICAgICAgICB9XG4gICAgICAgIH0pLFxuICAgICk7XG4gIH1cblxuICBhc3luYyBydW4oYmxvY2s6IGxvb21Db2RlQmxvY2ssIGNvbnRleHQ6IGxvb21SdW5Db250ZXh0LCBzZXR0aW5nczogbG9vbVBsdWdpblNldHRpbmdzLCBncm91cE5hbWU6IHN0cmluZyk6IFByb21pc2U8bG9vbVJ1blJlc3VsdD4ge1xuICAgIGNvbnN0IGdyb3VwUGF0aCA9IHRoaXMucmVzb2x2ZUdyb3VwUGF0aChncm91cE5hbWUpO1xuICAgIGNvbnN0IGNvbmZpZyA9IGF3YWl0IHRoaXMucmVhZENvbmZpZyhncm91cFBhdGgpO1xuICAgIGNvbnN0IGNvbmZpZ0xhbmcgPSBjb25maWcubGFuZ3VhZ2VzW2Jsb2NrLmxhbmd1YWdlXSA/PyBjb25maWcubGFuZ3VhZ2VzW2Jsb2NrLmxhbmd1YWdlQWxpYXNdO1xuXG4gICAgbGV0IGlzRmFsbGJhY2sgPSBmYWxzZTtcbiAgICBsZXQgbGFuZ3VhZ2U6IGxvb21Db250YWluZXJMYW5ndWFnZUNvbmZpZyB8IG51bGwgPSBudWxsO1xuXG4gICAgaWYgKGNvbmZpZ0xhbmcpIHtcbiAgICAgIGlmIChjb25maWdMYW5nLnVzZURlZmF1bHQpIHtcbiAgICAgICAgbGFuZ3VhZ2UgPSB0aGlzLmdldERlZmF1bHRMYW5ndWFnZUNvbmZpZyhibG9jay5sYW5ndWFnZSwgc2V0dGluZ3MpID8/IHRoaXMuZ2V0RGVmYXVsdExhbmd1YWdlQ29uZmlnKGJsb2NrLmxhbmd1YWdlQWxpYXMsIHNldHRpbmdzKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGxhbmd1YWdlID0gY29uZmlnTGFuZztcbiAgICAgIH1cbiAgICB9IGVsc2Uge1xuICAgICAgbGFuZ3VhZ2UgPSB0aGlzLmdldERlZmF1bHRMYW5ndWFnZUNvbmZpZyhibG9jay5sYW5ndWFnZSwgc2V0dGluZ3MpID8/IHRoaXMuZ2V0RGVmYXVsdExhbmd1YWdlQ29uZmlnKGJsb2NrLmxhbmd1YWdlQWxpYXMsIHNldHRpbmdzKTtcbiAgICAgIGlzRmFsbGJhY2sgPSB0cnVlO1xuICAgIH1cblxuICAgIGlmICghbGFuZ3VhZ2UgfHwgIWxhbmd1YWdlLmNvbW1hbmQgfHwgIWxhbmd1YWdlLmV4dGVuc2lvbikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBDb250YWluZXIgZ3JvdXAgJHtncm91cE5hbWV9IGhhcyBubyBjb21tYW5kIGZvciAke2Jsb2NrLmxhbmd1YWdlfS5gKTtcbiAgICB9XG5cbiAgICBhd2FpdCBta2Rpcihncm91cFBhdGgsIHsgcmVjdXJzaXZlOiB0cnVlIH0pO1xuICAgIGF3YWl0IHRoaXMucnVuSGVhbHRoQ2hlY2soY29uZmlnLmhlYWx0aENoZWNrLCBncm91cFBhdGgsIGNvbnRleHQudGltZW91dE1zLCBjb250ZXh0LnNpZ25hbCwgYGNvbnRhaW5lcjoke2dyb3VwTmFtZX06aGVhbHRoYCwgYENvbnRhaW5lciAke2dyb3VwTmFtZX0gaGVhbHRoIGNoZWNrYCk7XG4gICAgY29uc3QgdGVtcEZpbGVOYW1lID0gYHRlbXBfJHtEYXRlLm5vdygpfV8ke01hdGgucmFuZG9tKCkudG9TdHJpbmcoMTYpLnNsaWNlKDIpfSR7bm9ybWFsaXplRXh0ZW5zaW9uKGxhbmd1YWdlLmV4dGVuc2lvbil9YDtcbiAgICBjb25zdCB0ZW1wRmlsZVBhdGggPSBqb2luKGdyb3VwUGF0aCwgdGVtcEZpbGVOYW1lKTtcblxuICAgIHRyeSB7XG4gICAgICBhd2FpdCB3cml0ZUZpbGUodGVtcEZpbGVQYXRoLCBibG9jay5jb250ZW50LCBcInV0ZjhcIik7XG4gICAgICBsZXQgcmVzdWx0OiBsb29tUnVuUmVzdWx0O1xuICAgICAgc3dpdGNoIChjb25maWcucnVudGltZSkge1xuICAgICAgICBjYXNlIFwiZG9ja2VyXCI6XG4gICAgICAgIGNhc2UgXCJwb2RtYW5cIjpcbiAgICAgICAgICByZXN1bHQgPSBhd2FpdCB0aGlzLnJ1bk9jaUNvbnRhaW5lcihncm91cE5hbWUsIGdyb3VwUGF0aCwgY29uZmlnLCBsYW5ndWFnZSwgdGVtcEZpbGVOYW1lLCBjb250ZXh0LCBzZXR0aW5ncyk7XG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgIGNhc2UgXCJxZW11XCI6XG4gICAgICAgICAgcmVzdWx0ID0gYXdhaXQgdGhpcy5ydW5RZW11KGdyb3VwTmFtZSwgZ3JvdXBQYXRoLCBjb25maWcsIGxhbmd1YWdlLCB0ZW1wRmlsZU5hbWUsIGNvbnRleHQpO1xuICAgICAgICAgIGJyZWFrO1xuICAgICAgICBjYXNlIFwiY3VzdG9tXCI6XG4gICAgICAgICAgcmVzdWx0ID0gYXdhaXQgdGhpcy5ydW5DdXN0b20oZ3JvdXBOYW1lLCBncm91cFBhdGgsIGNvbmZpZywgYmxvY2ssIGxhbmd1YWdlLCB0ZW1wRmlsZU5hbWUsIHRlbXBGaWxlUGF0aCwgY29udGV4dCk7XG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgIGNhc2UgXCJ3c2xcIjpcbiAgICAgICAgICByZXN1bHQgPSBhd2FpdCB0aGlzLnJ1bldzbENvbnRhaW5lcihncm91cE5hbWUsIGdyb3VwUGF0aCwgY29uZmlnLCBsYW5ndWFnZSwgdGVtcEZpbGVOYW1lLCBjb250ZXh0KTtcbiAgICAgICAgICBicmVhaztcbiAgICAgICAgZGVmYXVsdDpcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYFVuc3VwcG9ydGVkIHJ1bnRpbWU6ICR7Y29uZmlnLnJ1bnRpbWV9YCk7XG4gICAgICB9XG5cbiAgICAgIGlmIChpc0ZhbGxiYWNrKSB7XG4gICAgICAgIGNvbnN0IGZhbGxiYWNrTXNnID0gYFtMb29tXSBMYW5ndWFnZSAnJHtibG9jay5sYW5ndWFnZX0nIHdhcyBub3QgZGVjbGFyZWQgaW4gY29udGFpbmVyIGdyb3VwLiBSdW5uaW5nIHVzaW5nIGRlZmF1bHQgY29tbWFuZDogJHtsYW5ndWFnZS5jb21tYW5kfWA7XG4gICAgICAgIHJlc3VsdC53YXJuaW5nID0gcmVzdWx0Lndhcm5pbmcgPyBgJHtyZXN1bHQud2FybmluZ31cXG4ke2ZhbGxiYWNrTXNnfWAgOiBmYWxsYmFja01zZztcbiAgICAgIH1cbiAgICAgIHJldHVybiByZXN1bHQ7XG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIGF3YWl0IHJtKHRlbXBGaWxlUGF0aCwgeyBmb3JjZTogdHJ1ZSB9KTtcbiAgICB9XG4gIH1cblxuICBhc3luYyBidWlsZEdyb3VwKGdyb3VwTmFtZTogc3RyaW5nLCB0aW1lb3V0TXM6IG51bWJlciwgc2lnbmFsOiBBYm9ydFNpZ25hbCk6IFByb21pc2U8bG9vbVJ1blJlc3VsdD4ge1xuICAgIGNvbnN0IGdyb3VwUGF0aCA9IHRoaXMucmVzb2x2ZUdyb3VwUGF0aChncm91cE5hbWUpO1xuICAgIGNvbnN0IGNvbmZpZyA9IGF3YWl0IHRoaXMucmVhZENvbmZpZyhncm91cFBhdGgpO1xuICAgIGF3YWl0IG1rZGlyKGdyb3VwUGF0aCwgeyByZWN1cnNpdmU6IHRydWUgfSk7XG4gICAgYXdhaXQgdGhpcy5ydW5IZWFsdGhDaGVjayhjb25maWcuaGVhbHRoQ2hlY2ssIGdyb3VwUGF0aCwgdGltZW91dE1zLCBzaWduYWwsIGBjb250YWluZXI6JHtncm91cE5hbWV9OmhlYWx0aGAsIGBDb250YWluZXIgJHtncm91cE5hbWV9IGhlYWx0aCBjaGVja2ApO1xuICAgIHN3aXRjaCAoY29uZmlnLnJ1bnRpbWUpIHtcbiAgICAgIGNhc2UgXCJkb2NrZXJcIjpcbiAgICAgIGNhc2UgXCJwb2RtYW5cIjpcbiAgICAgICAgcmV0dXJuIHRoaXMuYnVpbGRJbWFnZShncm91cE5hbWUsIGdyb3VwUGF0aCwgY29uZmlnLCB0aW1lb3V0TXMsIHNpZ25hbCk7XG4gICAgICBjYXNlIFwicWVtdVwiOlxuICAgICAgICByZXR1cm4gdGhpcy5idWlsZFFlbXUoZ3JvdXBOYW1lLCBncm91cFBhdGgsIGNvbmZpZywgdGltZW91dE1zLCBzaWduYWwpO1xuICAgICAgY2FzZSBcImN1c3RvbVwiOlxuICAgICAgICByZXR1cm4gdGhpcy5ydW5DdXN0b21XcmFwcGVyKGdyb3VwTmFtZSwgZ3JvdXBQYXRoLCBjb25maWcsIHRoaXMuY3JlYXRlQ3VzdG9tUmVxdWVzdChcImJ1aWxkXCIsIGdyb3VwTmFtZSwgZ3JvdXBQYXRoLCBjb25maWcsIHRpbWVvdXRNcyksIHRpbWVvdXRNcywgc2lnbmFsKTtcbiAgICAgIGNhc2UgXCJ3c2xcIjpcbiAgICAgICAgcmV0dXJuIHRoaXMuY3JlYXRlU3ludGhldGljUmVzdWx0KFxuICAgICAgICAgIGBjb250YWluZXI6JHtncm91cE5hbWV9OndzbDpidWlsZGAsXG4gICAgICAgICAgYFdTTCAke2dyb3VwTmFtZX0gYnVpbGRgLFxuICAgICAgICAgIGBXU0wgZW52aXJvbm1lbnQgJHtjb25maWcuaW1hZ2UgfHwgXCIoZGVmYXVsdClcIn0gZG9lcyBub3QgcmVxdWlyZSBhIGJ1aWxkIHN0ZXAuXFxuYCxcbiAgICAgICAgKTtcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIHJ1bk9jaUNvbnRhaW5lcihcbiAgICBncm91cE5hbWU6IHN0cmluZyxcbiAgICBncm91cFBhdGg6IHN0cmluZyxcbiAgICBjb25maWc6IGxvb21Db250YWluZXJDb25maWcsXG4gICAgbGFuZ3VhZ2U6IGxvb21Db250YWluZXJMYW5ndWFnZUNvbmZpZyxcbiAgICB0ZW1wRmlsZU5hbWU6IHN0cmluZyxcbiAgICBjb250ZXh0OiBsb29tUnVuQ29udGV4dCxcbiAgICBzZXR0aW5nczogbG9vbVBsdWdpblNldHRpbmdzLFxuICApOiBQcm9taXNlPGxvb21SdW5SZXN1bHQ+IHtcbiAgICBjb25zdCBpbWFnZSA9IGF3YWl0IHRoaXMucmVzb2x2ZUltYWdlKGdyb3VwTmFtZSwgZ3JvdXBQYXRoLCBjb25maWcsIGNvbnRleHQsIHNldHRpbmdzKTtcbiAgICBjb25zdCBjb21tYW5kID0gc3BsaXRDb21tYW5kTGluZShsYW5ndWFnZS5jb21tYW5kIS5yZXBsYWNlQWxsKFwie2ZpbGV9XCIsIHRlbXBGaWxlTmFtZSkpO1xuICAgIGlmICghY29tbWFuZC5sZW5ndGgpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIkNvbnRhaW5lciBjb21tYW5kIGlzIGVtcHR5LlwiKTtcbiAgICB9XG5cbiAgICByZXR1cm4gYXdhaXQgcnVuUHJvY2Vzcyh7XG4gICAgICBydW5uZXJJZDogYGNvbnRhaW5lcjoke2dyb3VwTmFtZX1gLFxuICAgICAgcnVubmVyTmFtZTogYCR7cnVudGltZUxhYmVsKGNvbmZpZy5ydW50aW1lKX0gJHtncm91cE5hbWV9YCxcbiAgICAgIGV4ZWN1dGFibGU6IHRoaXMucnVudGltZUV4ZWN1dGFibGUoY29uZmlnKSxcbiAgICAgIGFyZ3M6IFtcbiAgICAgICAgXCJydW5cIixcbiAgICAgICAgXCItLXJtXCIsXG4gICAgICAgIFwiLXZcIixcbiAgICAgICAgYCR7Z3JvdXBQYXRofTovd29ya3NwYWNlYCxcbiAgICAgICAgXCItd1wiLFxuICAgICAgICBcIi93b3Jrc3BhY2VcIixcbiAgICAgICAgaW1hZ2UsXG4gICAgICAgIC4uLmNvbW1hbmQsXG4gICAgICBdLFxuICAgICAgd29ya2luZ0RpcmVjdG9yeTogZ3JvdXBQYXRoLFxuICAgICAgdGltZW91dE1zOiBjb250ZXh0LnRpbWVvdXRNcyxcbiAgICAgIHNpZ25hbDogY29udGV4dC5zaWduYWwsXG4gICAgfSk7XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIHJ1blFlbXUoXG4gICAgZ3JvdXBOYW1lOiBzdHJpbmcsXG4gICAgZ3JvdXBQYXRoOiBzdHJpbmcsXG4gICAgY29uZmlnOiBsb29tQ29udGFpbmVyQ29uZmlnLFxuICAgIGxhbmd1YWdlOiBsb29tQ29udGFpbmVyTGFuZ3VhZ2VDb25maWcsXG4gICAgdGVtcEZpbGVOYW1lOiBzdHJpbmcsXG4gICAgY29udGV4dDogbG9vbVJ1bkNvbnRleHQsXG4gICk6IFByb21pc2U8bG9vbVJ1blJlc3VsdD4ge1xuICAgIGNvbnN0IHFlbXUgPSB0aGlzLnJlcXVpcmVRZW11Q29uZmlnKGNvbmZpZyk7XG4gICAgYXdhaXQgdGhpcy5ydW5PcHRpb25hbENvbW1hbmQocWVtdS5zdGFydENvbW1hbmQsIGdyb3VwUGF0aCwgY29udGV4dC50aW1lb3V0TXMsIGNvbnRleHQuc2lnbmFsLCBgY29udGFpbmVyOiR7Z3JvdXBOYW1lfTpxZW11OnN0YXJ0YCwgYFFFTVUgJHtncm91cE5hbWV9IHN0YXJ0YCk7XG4gICAgYXdhaXQgdGhpcy5lbnN1cmVNYW5hZ2VkUWVtdShncm91cE5hbWUsIGdyb3VwUGF0aCwgcWVtdSwgY29udGV4dC50aW1lb3V0TXMsIGNvbnRleHQuc2lnbmFsKTtcbiAgICBhd2FpdCB0aGlzLnJ1bkhlYWx0aENoZWNrKHFlbXUuaGVhbHRoQ2hlY2ssIGdyb3VwUGF0aCwgY29udGV4dC50aW1lb3V0TXMsIGNvbnRleHQuc2lnbmFsLCBgY29udGFpbmVyOiR7Z3JvdXBOYW1lfTpxZW11OmhlYWx0aGAsIGBRRU1VICR7Z3JvdXBOYW1lfSBoZWFsdGggY2hlY2tgKTtcblxuICAgIHRyeSB7XG4gICAgICBjb25zdCByZW1vdGVGaWxlID0gcG9zaXhQYXRoLmpvaW4ocWVtdS5yZW1vdGVXb3Jrc3BhY2UsIHRlbXBGaWxlTmFtZSk7XG4gICAgICBjb25zdCByZW1vdGVDb21tYW5kID0gbGFuZ3VhZ2UuY29tbWFuZCEucmVwbGFjZUFsbChcIntmaWxlfVwiLCBzaGVsbFF1b3RlKHJlbW90ZUZpbGUpKTtcbiAgICAgIGlmICghcmVtb3RlQ29tbWFuZC50cmltKCkpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKFwiUUVNVSBjb21tYW5kIGlzIGVtcHR5LlwiKTtcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIGF3YWl0IHJ1blByb2Nlc3Moe1xuICAgICAgICBydW5uZXJJZDogYGNvbnRhaW5lcjoke2dyb3VwTmFtZX06cWVtdWAsXG4gICAgICAgIHJ1bm5lck5hbWU6IGBRRU1VICR7Z3JvdXBOYW1lfWAsXG4gICAgICAgIGV4ZWN1dGFibGU6IHFlbXUuc3NoRXhlY3V0YWJsZSB8fCBcInNzaFwiLFxuICAgICAgICBhcmdzOiBbXG4gICAgICAgICAgLi4uc3BsaXRDb21tYW5kTGluZShxZW11LnNzaEFyZ3MgfHwgXCJcIiksXG4gICAgICAgICAgcWVtdS5zc2hUYXJnZXQsXG4gICAgICAgICAgYGNkICR7c2hlbGxRdW90ZShxZW11LnJlbW90ZVdvcmtzcGFjZSl9ICYmICR7cmVtb3RlQ29tbWFuZH1gLFxuICAgICAgICBdLFxuICAgICAgICB3b3JraW5nRGlyZWN0b3J5OiBncm91cFBhdGgsXG4gICAgICAgIHRpbWVvdXRNczogY29udGV4dC50aW1lb3V0TXMsXG4gICAgICAgIHNpZ25hbDogY29udGV4dC5zaWduYWwsXG4gICAgICB9KTtcbiAgICB9IGZpbmFsbHkge1xuICAgICAgYXdhaXQgdGhpcy5ydW5PcHRpb25hbENvbW1hbmQocWVtdS50ZWFyZG93bkNvbW1hbmQsIGdyb3VwUGF0aCwgY29udGV4dC50aW1lb3V0TXMsIGNvbnRleHQuc2lnbmFsLCBgY29udGFpbmVyOiR7Z3JvdXBOYW1lfTpxZW11OnRlYXJkb3duYCwgYFFFTVUgJHtncm91cE5hbWV9IHRlYXJkb3duYCk7XG4gICAgICBhd2FpdCB0aGlzLnN0b3BNYW5hZ2VkUWVtdUlmTmVlZGVkKGdyb3VwTmFtZSwgZ3JvdXBQYXRoLCBxZW11LCBjb250ZXh0LnRpbWVvdXRNcywgY29udGV4dC5zaWduYWwpO1xuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgcnVuQ3VzdG9tKFxuICAgIGdyb3VwTmFtZTogc3RyaW5nLFxuICAgIGdyb3VwUGF0aDogc3RyaW5nLFxuICAgIGNvbmZpZzogbG9vbUNvbnRhaW5lckNvbmZpZyxcbiAgICBibG9jazogbG9vbUNvZGVCbG9jayxcbiAgICBsYW5ndWFnZTogbG9vbUNvbnRhaW5lckxhbmd1YWdlQ29uZmlnLFxuICAgIHRlbXBGaWxlTmFtZTogc3RyaW5nLFxuICAgIHRlbXBGaWxlUGF0aDogc3RyaW5nLFxuICAgIGNvbnRleHQ6IGxvb21SdW5Db250ZXh0LFxuICApOiBQcm9taXNlPGxvb21SdW5SZXN1bHQ+IHtcbiAgICBjb25zdCBjb21tYW5kID0gbGFuZ3VhZ2UuY29tbWFuZCEucmVwbGFjZUFsbChcIntmaWxlfVwiLCB0ZW1wRmlsZU5hbWUpO1xuICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHRoaXMucnVuQ3VzdG9tV3JhcHBlcihcbiAgICAgIGdyb3VwTmFtZSxcbiAgICAgIGdyb3VwUGF0aCxcbiAgICAgIGNvbmZpZyxcbiAgICAgIHRoaXMuY3JlYXRlQ3VzdG9tUmVxdWVzdChcInJ1blwiLCBncm91cE5hbWUsIGdyb3VwUGF0aCwgY29uZmlnLCBjb250ZXh0LnRpbWVvdXRNcywge1xuICAgICAgICBsYW5ndWFnZTogYmxvY2subGFuZ3VhZ2UsXG4gICAgICAgIGxhbmd1YWdlQWxpYXM6IGJsb2NrLmxhbmd1YWdlQWxpYXMsXG4gICAgICAgIGZpbGVOYW1lOiB0ZW1wRmlsZU5hbWUsXG4gICAgICAgIGZpbGVQYXRoOiB0ZW1wRmlsZVBhdGgsXG4gICAgICAgIGNvbW1hbmQsXG4gICAgICB9KSxcbiAgICAgIGNvbnRleHQudGltZW91dE1zLFxuICAgICAgY29udGV4dC5zaWduYWwsXG4gICAgKTtcblxuICAgIGlmIChjb25maWcuY3VzdG9tPy50ZWFyZG93bikge1xuICAgICAgY29uc3QgdGVhcmRvd24gPSBhd2FpdCB0aGlzLnJ1bkN1c3RvbVdyYXBwZXIoXG4gICAgICAgIGdyb3VwTmFtZSxcbiAgICAgICAgZ3JvdXBQYXRoLFxuICAgICAgICBjb25maWcsXG4gICAgICAgIHRoaXMuY3JlYXRlQ3VzdG9tUmVxdWVzdChcInRlYXJkb3duXCIsIGdyb3VwTmFtZSwgZ3JvdXBQYXRoLCBjb25maWcsIGNvbnRleHQudGltZW91dE1zLCB7XG4gICAgICAgICAgbGFuZ3VhZ2U6IGJsb2NrLmxhbmd1YWdlLFxuICAgICAgICAgIGxhbmd1YWdlQWxpYXM6IGJsb2NrLmxhbmd1YWdlQWxpYXMsXG4gICAgICAgICAgZmlsZU5hbWU6IHRlbXBGaWxlTmFtZSxcbiAgICAgICAgICBmaWxlUGF0aDogdGVtcEZpbGVQYXRoLFxuICAgICAgICAgIGNvbW1hbmQsXG4gICAgICAgIH0pLFxuICAgICAgICBjb250ZXh0LnRpbWVvdXRNcyxcbiAgICAgICAgY29udGV4dC5zaWduYWwsXG4gICAgICApO1xuICAgICAgaWYgKCF0ZWFyZG93bi5zdWNjZXNzKSB7XG4gICAgICAgIHJlc3VsdC53YXJuaW5nID0gYEN1c3RvbSBydW50aW1lIHRlYXJkb3duIGZhaWxlZDogJHt0ZWFyZG93bi5zdGRlcnIgfHwgdGVhcmRvd24uc3Rkb3V0IHx8IGBleGl0ICR7dGVhcmRvd24uZXhpdENvZGV9YH1gO1xuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiByZXN1bHQ7XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIHJ1bldzbENvbnRhaW5lcihcbiAgICBncm91cE5hbWU6IHN0cmluZyxcbiAgICBncm91cFBhdGg6IHN0cmluZyxcbiAgICBjb25maWc6IGxvb21Db250YWluZXJDb25maWcsXG4gICAgbGFuZ3VhZ2U6IGxvb21Db250YWluZXJMYW5ndWFnZUNvbmZpZyxcbiAgICB0ZW1wRmlsZU5hbWU6IHN0cmluZyxcbiAgICBjb250ZXh0OiBsb29tUnVuQ29udGV4dCxcbiAgKTogUHJvbWlzZTxsb29tUnVuUmVzdWx0PiB7XG4gICAgY29uc3Qgd3NsR3JvdXBQYXRoID0gdGhpcy50cmFuc2xhdGVUb1dzbFBhdGgoZ3JvdXBQYXRoKTtcbiAgICBjb25zdCBjb21tYW5kID0gbGFuZ3VhZ2UuY29tbWFuZCEucmVwbGFjZUFsbChcIntmaWxlfVwiLCB0ZW1wRmlsZU5hbWUpO1xuICAgIGlmICghY29tbWFuZC50cmltKCkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIldTTCBjb21tYW5kIGlzIGVtcHR5LlwiKTtcbiAgICB9XG5cbiAgICBjb25zdCBzaGVsbEZsYWdzID0gY29uZmlnLndzbD8uaW50ZXJhY3RpdmUgPyBbXCItaVwiLCBcIi1sXCIsIFwiLWNcIl0gOiBbXCItbFwiLCBcIi1jXCJdO1xuICAgIGNvbnN0IHdzbEFyZ3MgPSBbXCJiYXNoXCIsIC4uLnNoZWxsRmxhZ3MsIGBjZCBcIiR7d3NsR3JvdXBQYXRoLnJlcGxhY2VBbGwoJ1wiJywgJ1xcXFxcIicpfVwiICYmICR7Y29tbWFuZH1gXTtcbiAgICBpZiAoY29uZmlnLmltYWdlPy50cmltKCkpIHtcbiAgICAgIHdzbEFyZ3MudW5zaGlmdChcIi1kXCIsIGNvbmZpZy5pbWFnZS50cmltKCkpO1xuICAgIH1cblxuICAgIHJldHVybiBhd2FpdCBydW5Qcm9jZXNzKHtcbiAgICAgIHJ1bm5lcklkOiBgY29udGFpbmVyOiR7Z3JvdXBOYW1lfTp3c2xgLFxuICAgICAgcnVubmVyTmFtZTogYFdTTCAke2dyb3VwTmFtZX1gLFxuICAgICAgZXhlY3V0YWJsZTogXCJ3c2xcIixcbiAgICAgIGFyZ3M6IHdzbEFyZ3MsXG4gICAgICB3b3JraW5nRGlyZWN0b3J5OiBncm91cFBhdGgsXG4gICAgICB0aW1lb3V0TXM6IGNvbnRleHQudGltZW91dE1zLFxuICAgICAgc2lnbmFsOiBjb250ZXh0LnNpZ25hbCxcbiAgICB9KTtcbiAgfVxuXG4gIHByaXZhdGUgdHJhbnNsYXRlVG9Xc2xQYXRoKHdpbmRvd3NQYXRoOiBzdHJpbmcpOiBzdHJpbmcge1xuICAgIGNvbnN0IG1hdGNoID0gd2luZG93c1BhdGgubWF0Y2goL14oW0EtWmEtel0pOlxcXFwoLiopLyk7XG4gICAgaWYgKG1hdGNoKSB7XG4gICAgICBjb25zdCBkcml2ZSA9IG1hdGNoWzFdLnRvTG93ZXJDYXNlKCk7XG4gICAgICBjb25zdCByZXN0ID0gbWF0Y2hbMl0ucmVwbGFjZSgvXFxcXC9nLCBcIi9cIik7XG4gICAgICByZXR1cm4gYC9tbnQvJHtkcml2ZX0vJHtyZXN0fWA7XG4gICAgfVxuICAgIGlmICh3aW5kb3dzUGF0aC5pbmNsdWRlcyhcIlxcXFxcIikpIHtcbiAgICAgIHJldHVybiB3aW5kb3dzUGF0aC5yZXBsYWNlKC9cXFxcL2csIFwiL1wiKTtcbiAgICB9XG4gICAgcmV0dXJuIHdpbmRvd3NQYXRoO1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyByZXNvbHZlSW1hZ2UoXG4gICAgZ3JvdXBOYW1lOiBzdHJpbmcsXG4gICAgZ3JvdXBQYXRoOiBzdHJpbmcsXG4gICAgY29uZmlnOiBsb29tQ29udGFpbmVyQ29uZmlnLFxuICAgIGNvbnRleHQ6IGxvb21SdW5Db250ZXh0LFxuICAgIHNldHRpbmdzOiBsb29tUGx1Z2luU2V0dGluZ3MsXG4gICk6IFByb21pc2U8c3RyaW5nPiB7XG4gICAgY29uc3QgZG9ja2VyZmlsZSA9IGpvaW4oZ3JvdXBQYXRoLCBcIkRvY2tlcmZpbGVcIik7XG4gICAgaWYgKCFleGlzdHNTeW5jKGRvY2tlcmZpbGUpKSB7XG4gICAgICByZXR1cm4gY29uZmlnLmltYWdlIHx8IFwidWJ1bnR1OmxhdGVzdFwiO1xuICAgIH1cblxuICAgIGNvbnN0IGltYWdlID0gdGhpcy5pbWFnZU5hbWVGb3JHcm91cChncm91cE5hbWUpO1xuICAgIGNvbnN0IGNhY2hlS2V5ID0gYCR7dGhpcy5ydW50aW1lRXhlY3V0YWJsZShjb25maWcpfToke2ltYWdlfWA7XG4gICAgaWYgKHRoaXMuYnVpbHRJbWFnZXMuaGFzKGNhY2hlS2V5KSkge1xuICAgICAgcmV0dXJuIGltYWdlO1xuICAgIH1cblxuICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHRoaXMuYnVpbGRJbWFnZShncm91cE5hbWUsIGdyb3VwUGF0aCwgY29uZmlnLCBNYXRoLm1heChjb250ZXh0LnRpbWVvdXRNcywgc2V0dGluZ3MuZGVmYXVsdFRpbWVvdXRNcywgMTIwXzAwMCksIGNvbnRleHQuc2lnbmFsKTtcbiAgICBpZiAoIXJlc3VsdC5zdWNjZXNzKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IocmVzdWx0LnN0ZGVyciB8fCByZXN1bHQuc3Rkb3V0IHx8IGAke3J1bnRpbWVMYWJlbChjb25maWcucnVudGltZSl9IGJ1aWxkIGZhaWxlZCBmb3IgJHtncm91cE5hbWV9LmApO1xuICAgIH1cblxuICAgIHRoaXMuYnVpbHRJbWFnZXMuYWRkKGNhY2hlS2V5KTtcbiAgICByZXR1cm4gaW1hZ2U7XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIGJ1aWxkSW1hZ2UoXG4gICAgZ3JvdXBOYW1lOiBzdHJpbmcsXG4gICAgZ3JvdXBQYXRoOiBzdHJpbmcsXG4gICAgY29uZmlnOiBsb29tQ29udGFpbmVyQ29uZmlnLFxuICAgIHRpbWVvdXRNczogbnVtYmVyLFxuICAgIHNpZ25hbDogQWJvcnRTaWduYWwsXG4gICk6IFByb21pc2U8bG9vbVJ1blJlc3VsdD4ge1xuICAgIGNvbnN0IGltYWdlID0gdGhpcy5pbWFnZU5hbWVGb3JHcm91cChncm91cE5hbWUpO1xuICAgIGlmICghZXhpc3RzU3luYyhqb2luKGdyb3VwUGF0aCwgXCJEb2NrZXJmaWxlXCIpKSkge1xuICAgICAgcmV0dXJuIHRoaXMuY3JlYXRlU3ludGhldGljUmVzdWx0KFxuICAgICAgICBgY29udGFpbmVyOiR7Z3JvdXBOYW1lfTpidWlsZGAsXG4gICAgICAgIGAke3J1bnRpbWVMYWJlbChjb25maWcucnVudGltZSl9ICR7Z3JvdXBOYW1lfSBidWlsZGAsXG4gICAgICAgIGBObyBEb2NrZXJmaWxlIGNvbmZpZ3VyZWQuIFVzaW5nIGltYWdlICR7Y29uZmlnLmltYWdlIHx8IFwidWJ1bnR1OmxhdGVzdFwifS5cXG5gLFxuICAgICAgKTtcbiAgICB9XG4gICAgcmV0dXJuIHJ1blByb2Nlc3Moe1xuICAgICAgcnVubmVySWQ6IGBjb250YWluZXI6JHtncm91cE5hbWV9OmJ1aWxkYCxcbiAgICAgIHJ1bm5lck5hbWU6IGAke3J1bnRpbWVMYWJlbChjb25maWcucnVudGltZSl9ICR7Z3JvdXBOYW1lfSBidWlsZGAsXG4gICAgICBleGVjdXRhYmxlOiB0aGlzLnJ1bnRpbWVFeGVjdXRhYmxlKGNvbmZpZyksXG4gICAgICBhcmdzOiBbXCJidWlsZFwiLCBcIi10XCIsIGltYWdlLCBncm91cFBhdGhdLFxuICAgICAgd29ya2luZ0RpcmVjdG9yeTogZ3JvdXBQYXRoLFxuICAgICAgdGltZW91dE1zLFxuICAgICAgc2lnbmFsLFxuICAgIH0pO1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBidWlsZFFlbXUoZ3JvdXBOYW1lOiBzdHJpbmcsIGdyb3VwUGF0aDogc3RyaW5nLCBjb25maWc6IGxvb21Db250YWluZXJDb25maWcsIHRpbWVvdXRNczogbnVtYmVyLCBzaWduYWw6IEFib3J0U2lnbmFsKTogUHJvbWlzZTxsb29tUnVuUmVzdWx0PiB7XG4gICAgY29uc3QgcWVtdSA9IHRoaXMucmVxdWlyZVFlbXVDb25maWcoY29uZmlnKTtcbiAgICBpZiAoIXFlbXUuYnVpbGRDb21tYW5kPy50cmltKCkpIHtcbiAgICAgIHJldHVybiB0aGlzLmNyZWF0ZVN5bnRoZXRpY1Jlc3VsdChgY29udGFpbmVyOiR7Z3JvdXBOYW1lfTpxZW11OmJ1aWxkYCwgYFFFTVUgJHtncm91cE5hbWV9IGJ1aWxkYCwgXCJObyBRRU1VIGJ1aWxkIGNvbW1hbmQgY29uZmlndXJlZC5cXG5cIik7XG4gICAgfVxuICAgIHJldHVybiB0aGlzLnJ1bkNvbW1hbmRMaW5lKHFlbXUuYnVpbGRDb21tYW5kLCBncm91cFBhdGgsIHRpbWVvdXRNcywgc2lnbmFsLCBgY29udGFpbmVyOiR7Z3JvdXBOYW1lfTpxZW11OmJ1aWxkYCwgYFFFTVUgJHtncm91cE5hbWV9IGJ1aWxkYCk7XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIHJlYWRDb25maWcoZ3JvdXBQYXRoOiBzdHJpbmcpOiBQcm9taXNlPGxvb21Db250YWluZXJDb25maWc+IHtcbiAgICBjb25zdCBjb25maWdQYXRoID0gam9pbihncm91cFBhdGgsIFwiY29uZmlnLmpzb25cIik7XG4gICAgbGV0IHJhdzogdW5rbm93bjtcbiAgICB0cnkge1xuICAgICAgcmF3ID0gSlNPTi5wYXJzZShhd2FpdCByZWFkRmlsZShjb25maWdQYXRoLCBcInV0ZjhcIikpO1xuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYFVuYWJsZSB0byByZWFkIGNvbnRhaW5lciBjb25maWcgJHtjb25maWdQYXRofTogJHtlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IubWVzc2FnZSA6IFN0cmluZyhlcnJvcil9YCk7XG4gICAgfVxuXG4gICAgaWYgKCFyYXcgfHwgdHlwZW9mIHJhdyAhPT0gXCJvYmplY3RcIiB8fCBBcnJheS5pc0FycmF5KHJhdykpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIkNvbnRhaW5lciBjb25maWcgbXVzdCBiZSBhbiBvYmplY3QuXCIpO1xuICAgIH1cblxuICAgIGNvbnN0IGRhdGEgPSByYXcgYXMge1xuICAgICAgcnVudGltZT86IHVua25vd247XG4gICAgICBleGVjdXRhYmxlPzogdW5rbm93bjtcbiAgICAgIGltYWdlPzogdW5rbm93bjtcbiAgICAgIHdzbD86IHVua25vd247XG4gICAgICBoZWFsdGhDaGVjaz86IHVua25vd247XG4gICAgICBxZW11PzogdW5rbm93bjtcbiAgICAgIGN1c3RvbT86IHVua25vd247XG4gICAgICBsYW5ndWFnZXM/OiB1bmtub3duO1xuICAgIH07XG4gICAgY29uc3QgcnVudGltZSA9IHRoaXMucmVhZFJ1bnRpbWUoZGF0YS5ydW50aW1lKTtcbiAgICBpZiAoZGF0YS5leGVjdXRhYmxlICE9IG51bGwgJiYgdHlwZW9mIGRhdGEuZXhlY3V0YWJsZSAhPT0gXCJzdHJpbmdcIikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiQ29udGFpbmVyIGNvbmZpZyBleGVjdXRhYmxlIG11c3QgYmUgYSBzdHJpbmcuXCIpO1xuICAgIH1cbiAgICBpZiAoZGF0YS5pbWFnZSAhPSBudWxsICYmIHR5cGVvZiBkYXRhLmltYWdlICE9PSBcInN0cmluZ1wiKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJDb250YWluZXIgY29uZmlnIGltYWdlIG11c3QgYmUgYSBzdHJpbmcuXCIpO1xuICAgIH1cbiAgICBpZiAoIWRhdGEubGFuZ3VhZ2VzIHx8IHR5cGVvZiBkYXRhLmxhbmd1YWdlcyAhPT0gXCJvYmplY3RcIiB8fCBBcnJheS5pc0FycmF5KGRhdGEubGFuZ3VhZ2VzKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiQ29udGFpbmVyIGNvbmZpZyBsYW5ndWFnZXMgbXVzdCBiZSBhbiBvYmplY3QuXCIpO1xuICAgIH1cblxuICAgIGNvbnN0IGxhbmd1YWdlczogUmVjb3JkPHN0cmluZywgbG9vbUNvbnRhaW5lckxhbmd1YWdlQ29uZmlnPiA9IHt9O1xuICAgIGZvciAoY29uc3QgW2xhbmd1YWdlLCB2YWx1ZV0gb2YgT2JqZWN0LmVudHJpZXMoZGF0YS5sYW5ndWFnZXMgYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj4pKSB7XG4gICAgICBpZiAoIXZhbHVlIHx8IHR5cGVvZiB2YWx1ZSAhPT0gXCJvYmplY3RcIiB8fCBBcnJheS5pc0FycmF5KHZhbHVlKSkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYENvbnRhaW5lciBsYW5ndWFnZSAke2xhbmd1YWdlfSBtdXN0IGJlIGFuIG9iamVjdC5gKTtcbiAgICAgIH1cbiAgICAgIGNvbnN0IGxhbmd1YWdlQ29uZmlnID0gdmFsdWUgYXMgeyBjb21tYW5kPzogdW5rbm93bjsgZXh0ZW5zaW9uPzogdW5rbm93bjsgdXNlRGVmYXVsdD86IHVua25vd24gfTtcbiAgICAgIGNvbnN0IHVzZURlZmF1bHQgPSBsYW5ndWFnZUNvbmZpZy51c2VEZWZhdWx0ID09PSB0cnVlO1xuXG4gICAgICBpZiAoIXVzZURlZmF1bHQgJiYgKHR5cGVvZiBsYW5ndWFnZUNvbmZpZy5jb21tYW5kICE9PSBcInN0cmluZ1wiIHx8ICFsYW5ndWFnZUNvbmZpZy5jb21tYW5kLnRyaW0oKSkpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBDb250YWluZXIgbGFuZ3VhZ2UgJHtsYW5ndWFnZX0gbXVzdCBkZWZpbmUgY29tbWFuZCBvciB1c2VEZWZhdWx0LmApO1xuICAgICAgfVxuXG4gICAgICBsYW5ndWFnZXNbbGFuZ3VhZ2VdID0ge1xuICAgICAgICBjb21tYW5kOiB0eXBlb2YgbGFuZ3VhZ2VDb25maWcuY29tbWFuZCA9PT0gXCJzdHJpbmdcIiA/IGxhbmd1YWdlQ29uZmlnLmNvbW1hbmQgOiB1bmRlZmluZWQsXG4gICAgICAgIGV4dGVuc2lvbjogdHlwZW9mIGxhbmd1YWdlQ29uZmlnLmV4dGVuc2lvbiA9PT0gXCJzdHJpbmdcIiA/IGxhbmd1YWdlQ29uZmlnLmV4dGVuc2lvbiA6IHVzZURlZmF1bHQgPyB1bmRlZmluZWQgOiBgLiR7bGFuZ3VhZ2V9YCxcbiAgICAgICAgdXNlRGVmYXVsdDogdXNlRGVmYXVsdCB8fCB1bmRlZmluZWQsXG4gICAgICB9O1xuICAgIH1cblxuICAgIHJldHVybiB7XG4gICAgICBydW50aW1lLFxuICAgICAgZXhlY3V0YWJsZTogdHlwZW9mIGRhdGEuZXhlY3V0YWJsZSA9PT0gXCJzdHJpbmdcIiAmJiBkYXRhLmV4ZWN1dGFibGUudHJpbSgpID8gZGF0YS5leGVjdXRhYmxlLnRyaW0oKSA6IHVuZGVmaW5lZCxcbiAgICAgIGltYWdlOiB0eXBlb2YgZGF0YS5pbWFnZSA9PT0gXCJzdHJpbmdcIiA/IGRhdGEuaW1hZ2UgOiB1bmRlZmluZWQsXG4gICAgICB3c2w6IHRoaXMucmVhZFdzbENvbmZpZyhkYXRhLndzbCksXG4gICAgICBoZWFsdGhDaGVjazogdGhpcy5yZWFkSGVhbHRoQ2hlY2soZGF0YS5oZWFsdGhDaGVjaywgXCJDb250YWluZXIgY29uZmlnIGhlYWx0aENoZWNrXCIpLFxuICAgICAgcWVtdTogdGhpcy5yZWFkUWVtdUNvbmZpZyhkYXRhLnFlbXUpLFxuICAgICAgY3VzdG9tOiB0aGlzLnJlYWRDdXN0b21Db25maWcoZGF0YS5jdXN0b20pLFxuICAgICAgbGFuZ3VhZ2VzLFxuICAgIH07XG4gIH1cblxuICBwcml2YXRlIHJlYWRSdW50aW1lKHZhbHVlOiB1bmtub3duKTogbG9vbUNvbnRhaW5lclJ1bnRpbWUge1xuICAgIGlmICh2YWx1ZSA9PSBudWxsKSB7XG4gICAgICByZXR1cm4gXCJkb2NrZXJcIjtcbiAgICB9XG4gICAgaWYgKHZhbHVlID09PSBcImRvY2tlclwiIHx8IHZhbHVlID09PSBcInBvZG1hblwiIHx8IHZhbHVlID09PSBcInFlbXVcIiB8fCB2YWx1ZSA9PT0gXCJjdXN0b21cIiB8fCB2YWx1ZSA9PT0gXCJ3c2xcIikge1xuICAgICAgcmV0dXJuIHZhbHVlO1xuICAgIH1cbiAgICB0aHJvdyBuZXcgRXJyb3IoXCJDb250YWluZXIgY29uZmlnIHJ1bnRpbWUgbXVzdCBiZSBkb2NrZXIsIHBvZG1hbiwgcWVtdSwgY3VzdG9tLCBvciB3c2wuXCIpO1xuICB9XG5cbiAgcHJpdmF0ZSByZWFkV3NsQ29uZmlnKHZhbHVlOiB1bmtub3duKTogbG9vbVdzbENvbmZpZyB8IHVuZGVmaW5lZCB7XG4gICAgaWYgKHZhbHVlID09IG51bGwpIHtcbiAgICAgIHJldHVybiB1bmRlZmluZWQ7XG4gICAgfVxuICAgIGlmICghdmFsdWUgfHwgdHlwZW9mIHZhbHVlICE9PSBcIm9iamVjdFwiIHx8IEFycmF5LmlzQXJyYXkodmFsdWUpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJDb250YWluZXIgY29uZmlnIHdzbCBtdXN0IGJlIGFuIG9iamVjdC5cIik7XG4gICAgfVxuICAgIGNvbnN0IGRhdGEgPSB2YWx1ZSBhcyB7IGludGVyYWN0aXZlPzogdW5rbm93biB9O1xuICAgIHJldHVybiB7XG4gICAgICBpbnRlcmFjdGl2ZTogZGF0YS5pbnRlcmFjdGl2ZSA9PT0gdHJ1ZSxcbiAgICB9O1xuICB9XG5cbiAgcHJpdmF0ZSByZWFkUWVtdUNvbmZpZyh2YWx1ZTogdW5rbm93bik6IGxvb21RZW11Q29uZmlnIHwgdW5kZWZpbmVkIHtcbiAgICBpZiAodmFsdWUgPT0gbnVsbCkge1xuICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICB9XG4gICAgaWYgKCF2YWx1ZSB8fCB0eXBlb2YgdmFsdWUgIT09IFwib2JqZWN0XCIgfHwgQXJyYXkuaXNBcnJheSh2YWx1ZSkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIkNvbnRhaW5lciBjb25maWcgcWVtdSBtdXN0IGJlIGFuIG9iamVjdC5cIik7XG4gICAgfVxuICAgIGNvbnN0IGRhdGEgPSB2YWx1ZSBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPjtcbiAgICBpZiAodHlwZW9mIGRhdGEuc3NoVGFyZ2V0ICE9PSBcInN0cmluZ1wiIHx8ICFkYXRhLnNzaFRhcmdldC50cmltKCkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIkNvbnRhaW5lciBjb25maWcgcWVtdS5zc2hUYXJnZXQgbXVzdCBiZSBhIHN0cmluZy5cIik7XG4gICAgfVxuICAgIGlmICh0eXBlb2YgZGF0YS5yZW1vdGVXb3Jrc3BhY2UgIT09IFwic3RyaW5nXCIgfHwgIWRhdGEucmVtb3RlV29ya3NwYWNlLnRyaW0oKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiQ29udGFpbmVyIGNvbmZpZyBxZW11LnJlbW90ZVdvcmtzcGFjZSBtdXN0IGJlIGEgc3RyaW5nLlwiKTtcbiAgICB9XG5cbiAgICByZXR1cm4ge1xuICAgICAgc3NoVGFyZ2V0OiBkYXRhLnNzaFRhcmdldC50cmltKCksXG4gICAgICByZW1vdGVXb3Jrc3BhY2U6IGRhdGEucmVtb3RlV29ya3NwYWNlLnRyaW0oKSxcbiAgICAgIHNzaEV4ZWN1dGFibGU6IG9wdGlvbmFsU3RyaW5nKGRhdGEuc3NoRXhlY3V0YWJsZSksXG4gICAgICBzc2hBcmdzOiBvcHRpb25hbFN0cmluZyhkYXRhLnNzaEFyZ3MpLFxuICAgICAgc3RhcnRDb21tYW5kOiBvcHRpb25hbFN0cmluZyhkYXRhLnN0YXJ0Q29tbWFuZCksXG4gICAgICBidWlsZENvbW1hbmQ6IG9wdGlvbmFsU3RyaW5nKGRhdGEuYnVpbGRDb21tYW5kKSxcbiAgICAgIHRlYXJkb3duQ29tbWFuZDogb3B0aW9uYWxTdHJpbmcoZGF0YS50ZWFyZG93bkNvbW1hbmQpLFxuICAgICAgaGVhbHRoQ2hlY2s6IHRoaXMucmVhZEhlYWx0aENoZWNrKGRhdGEuaGVhbHRoQ2hlY2ssIFwiQ29udGFpbmVyIGNvbmZpZyBxZW11LmhlYWx0aENoZWNrXCIpLFxuICAgICAgbWFuYWdlcjogdGhpcy5yZWFkUWVtdU1hbmFnZXJDb25maWcoZGF0YS5tYW5hZ2VyKSxcbiAgICB9O1xuICB9XG5cbiAgcHJpdmF0ZSByZWFkUWVtdU1hbmFnZXJDb25maWcodmFsdWU6IHVua25vd24pOiBsb29tUWVtdU1hbmFnZXJDb25maWcgfCB1bmRlZmluZWQge1xuICAgIGlmICh2YWx1ZSA9PSBudWxsKSB7XG4gICAgICByZXR1cm4gdW5kZWZpbmVkO1xuICAgIH1cbiAgICBpZiAoIXZhbHVlIHx8IHR5cGVvZiB2YWx1ZSAhPT0gXCJvYmplY3RcIiB8fCBBcnJheS5pc0FycmF5KHZhbHVlKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiQ29udGFpbmVyIGNvbmZpZyBxZW11Lm1hbmFnZXIgbXVzdCBiZSBhbiBvYmplY3QuXCIpO1xuICAgIH1cbiAgICBjb25zdCBkYXRhID0gdmFsdWUgYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj47XG4gICAgcmV0dXJuIHtcbiAgICAgIGVuYWJsZWQ6IGRhdGEuZW5hYmxlZCAhPT0gZmFsc2UsXG4gICAgICBleGVjdXRhYmxlOiBvcHRpb25hbFN0cmluZyhkYXRhLmV4ZWN1dGFibGUpLFxuICAgICAgYXJnczogb3B0aW9uYWxTdHJpbmcoZGF0YS5hcmdzKSxcbiAgICAgIGltYWdlOiBvcHRpb25hbFN0cmluZyhkYXRhLmltYWdlKSxcbiAgICAgIGltYWdlRm9ybWF0OiBvcHRpb25hbFN0cmluZyhkYXRhLmltYWdlRm9ybWF0KSxcbiAgICAgIHBpZEZpbGU6IG9wdGlvbmFsU3RyaW5nKGRhdGEucGlkRmlsZSksXG4gICAgICBsb2dGaWxlOiBvcHRpb25hbFN0cmluZyhkYXRhLmxvZ0ZpbGUpLFxuICAgICAgcmVhZGluZXNzVGltZW91dE1zOiBvcHRpb25hbFBvc2l0aXZlSW50ZWdlcihkYXRhLnJlYWRpbmVzc1RpbWVvdXRNcywgXCJDb250YWluZXIgY29uZmlnIHFlbXUubWFuYWdlci5yZWFkaW5lc3NUaW1lb3V0TXNcIiksXG4gICAgICByZWFkaW5lc3NJbnRlcnZhbE1zOiBvcHRpb25hbFBvc2l0aXZlSW50ZWdlcihkYXRhLnJlYWRpbmVzc0ludGVydmFsTXMsIFwiQ29udGFpbmVyIGNvbmZpZyBxZW11Lm1hbmFnZXIucmVhZGluZXNzSW50ZXJ2YWxNc1wiKSxcbiAgICAgIGJvb3REZWxheU1zOiBvcHRpb25hbE5vbk5lZ2F0aXZlSW50ZWdlcihkYXRhLmJvb3REZWxheU1zLCBcIkNvbnRhaW5lciBjb25maWcgcWVtdS5tYW5hZ2VyLmJvb3REZWxheU1zXCIpLFxuICAgICAgc2h1dGRvd25Db21tYW5kOiBvcHRpb25hbFN0cmluZyhkYXRhLnNodXRkb3duQ29tbWFuZCksXG4gICAgICBzaHV0ZG93blRpbWVvdXRNczogb3B0aW9uYWxQb3NpdGl2ZUludGVnZXIoZGF0YS5zaHV0ZG93blRpbWVvdXRNcywgXCJDb250YWluZXIgY29uZmlnIHFlbXUubWFuYWdlci5zaHV0ZG93blRpbWVvdXRNc1wiKSxcbiAgICAgIGtpbGxTaWduYWw6IG9wdGlvbmFsU2lnbmFsKGRhdGEua2lsbFNpZ25hbCwgXCJDb250YWluZXIgY29uZmlnIHFlbXUubWFuYWdlci5raWxsU2lnbmFsXCIpLFxuICAgICAgcGVyc2lzdDogdHlwZW9mIGRhdGEucGVyc2lzdCA9PT0gXCJib29sZWFuXCIgPyBkYXRhLnBlcnNpc3QgOiB1bmRlZmluZWQsXG4gICAgfTtcbiAgfVxuXG4gIHByaXZhdGUgcmVhZEN1c3RvbUNvbmZpZyh2YWx1ZTogdW5rbm93bik6IGxvb21DdXN0b21SdW50aW1lQ29uZmlnIHwgdW5kZWZpbmVkIHtcbiAgICBpZiAodmFsdWUgPT0gbnVsbCkge1xuICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICB9XG4gICAgaWYgKCF2YWx1ZSB8fCB0eXBlb2YgdmFsdWUgIT09IFwib2JqZWN0XCIgfHwgQXJyYXkuaXNBcnJheSh2YWx1ZSkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIkNvbnRhaW5lciBjb25maWcgY3VzdG9tIG11c3QgYmUgYW4gb2JqZWN0LlwiKTtcbiAgICB9XG4gICAgY29uc3QgZGF0YSA9IHZhbHVlIGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+O1xuICAgIGlmICh0eXBlb2YgZGF0YS5leGVjdXRhYmxlICE9PSBcInN0cmluZ1wiIHx8ICFkYXRhLmV4ZWN1dGFibGUudHJpbSgpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJDb250YWluZXIgY29uZmlnIGN1c3RvbS5leGVjdXRhYmxlIG11c3QgYmUgYSBzdHJpbmcuXCIpO1xuICAgIH1cbiAgICByZXR1cm4ge1xuICAgICAgZXhlY3V0YWJsZTogZGF0YS5leGVjdXRhYmxlLnRyaW0oKSxcbiAgICAgIGFyZ3M6IG9wdGlvbmFsU3RyaW5nKGRhdGEuYXJncyksXG4gICAgICBidWlsZDogb3B0aW9uYWxTdHJpbmcoZGF0YS5idWlsZCksXG4gICAgICBjb21tYW5kU3RydWN0dXJlOiBvcHRpb25hbFN0cmluZyhkYXRhLmNvbW1hbmRTdHJ1Y3R1cmUpLFxuICAgICAgdGVhcmRvd246IG9wdGlvbmFsU3RyaW5nKGRhdGEudGVhcmRvd24pLFxuICAgICAgaGVhbHRoQ2hlY2s6IHRoaXMucmVhZEhlYWx0aENoZWNrKGRhdGEuaGVhbHRoQ2hlY2ssIFwiQ29udGFpbmVyIGNvbmZpZyBjdXN0b20uaGVhbHRoQ2hlY2tcIiksXG4gICAgfTtcbiAgfVxuXG4gIHByaXZhdGUgcmVhZEhlYWx0aENoZWNrKHZhbHVlOiB1bmtub3duLCBsYWJlbDogc3RyaW5nKTogbG9vbUNvbW1hbmRFeHBlY3RhdGlvbiB8IHVuZGVmaW5lZCB7XG4gICAgaWYgKHZhbHVlID09IG51bGwpIHtcbiAgICAgIHJldHVybiB1bmRlZmluZWQ7XG4gICAgfVxuICAgIGlmICghdmFsdWUgfHwgdHlwZW9mIHZhbHVlICE9PSBcIm9iamVjdFwiIHx8IEFycmF5LmlzQXJyYXkodmFsdWUpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYCR7bGFiZWx9IG11c3QgYmUgYW4gb2JqZWN0LmApO1xuICAgIH1cbiAgICBjb25zdCBkYXRhID0gdmFsdWUgYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj47XG4gICAgaWYgKHR5cGVvZiBkYXRhLmNvbW1hbmQgIT09IFwic3RyaW5nXCIgfHwgIWRhdGEuY29tbWFuZC50cmltKCkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgJHtsYWJlbH0uY29tbWFuZCBtdXN0IGJlIGEgc3RyaW5nLmApO1xuICAgIH1cbiAgICByZXR1cm4ge1xuICAgICAgY29tbWFuZDogZGF0YS5jb21tYW5kLnRyaW0oKSxcbiAgICAgIHBvc2l0aXZlUmVzcG9uc2U6IG9wdGlvbmFsU3RyaW5nKGRhdGEucG9zaXRpdmVSZXNwb25zZSA/PyBkYXRhLnBvc2l0aXZlX3Jlc3BvbnNlID8/IGRhdGFbXCJwb3NpdGl2ZSByZXNwb25zZVwiXSA/PyBkYXRhLnBvc3NpdGl2ZVJlc3BvbnNlKSxcbiAgICAgIG5lZ2F0aXZlUmVzcG9uc2U6IG9wdGlvbmFsU3RyaW5nKGRhdGEubmVnYXRpdmVSZXNwb25zZSA/PyBkYXRhLm5lZ2F0aXZlX3Jlc3BvbnNlID8/IGRhdGFbXCJuZWdhdGl2ZSByZXNwb25zZVwiXSksXG4gICAgfTtcbiAgfVxuXG4gIHByaXZhdGUgcmVxdWlyZVFlbXVDb25maWcoY29uZmlnOiBsb29tQ29udGFpbmVyQ29uZmlnKTogbG9vbVFlbXVDb25maWcge1xuICAgIGlmICghY29uZmlnLnFlbXUpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIlFFTVUgcnVudGltZSByZXF1aXJlcyBhIHFlbXUgY29uZmlnIG9iamVjdC5cIik7XG4gICAgfVxuICAgIHJldHVybiBjb25maWcucWVtdTtcbiAgfVxuXG4gIHByaXZhdGUgcmVxdWlyZUN1c3RvbUNvbmZpZyhjb25maWc6IGxvb21Db250YWluZXJDb25maWcpOiBsb29tQ3VzdG9tUnVudGltZUNvbmZpZyB7XG4gICAgaWYgKCFjb25maWcuY3VzdG9tKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJDdXN0b20gcnVudGltZSByZXF1aXJlcyBhIGN1c3RvbSBjb25maWcgb2JqZWN0LlwiKTtcbiAgICB9XG4gICAgcmV0dXJuIGNvbmZpZy5jdXN0b207XG4gIH1cblxuICBwcml2YXRlIHJ1bnRpbWVFeGVjdXRhYmxlKGNvbmZpZzogbG9vbUNvbnRhaW5lckNvbmZpZyk6IHN0cmluZyB7XG4gICAgaWYgKGNvbmZpZy5leGVjdXRhYmxlPy50cmltKCkpIHtcbiAgICAgIHJldHVybiBjb25maWcuZXhlY3V0YWJsZS50cmltKCk7XG4gICAgfVxuICAgIHJldHVybiBjb25maWcucnVudGltZSA9PT0gXCJwb2RtYW5cIiA/IFwicG9kbWFuXCIgOiBcImRvY2tlclwiO1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBydW5IZWFsdGhDaGVjayhcbiAgICBoZWFsdGhDaGVjazogbG9vbUNvbW1hbmRFeHBlY3RhdGlvbiB8IHVuZGVmaW5lZCxcbiAgICB3b3JraW5nRGlyZWN0b3J5OiBzdHJpbmcsXG4gICAgdGltZW91dE1zOiBudW1iZXIsXG4gICAgc2lnbmFsOiBBYm9ydFNpZ25hbCxcbiAgICBydW5uZXJJZDogc3RyaW5nLFxuICAgIHJ1bm5lck5hbWU6IHN0cmluZyxcbiAgKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgaWYgKCFoZWFsdGhDaGVjaykge1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHRoaXMucnVuQ29tbWFuZExpbmUoaGVhbHRoQ2hlY2suY29tbWFuZCwgd29ya2luZ0RpcmVjdG9yeSwgdGltZW91dE1zLCBzaWduYWwsIHJ1bm5lcklkLCBydW5uZXJOYW1lKTtcbiAgICBjb25zdCBjb21iaW5lZE91dHB1dCA9IGAke3Jlc3VsdC5zdGRvdXR9XFxuJHtyZXN1bHQuc3RkZXJyfWA7XG4gICAgaWYgKCFyZXN1bHQuc3VjY2Vzcykge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGAke3J1bm5lck5hbWV9IGZhaWxlZDogJHtyZXN1bHQuc3RkZXJyIHx8IHJlc3VsdC5zdGRvdXQgfHwgYGV4aXQgJHtyZXN1bHQuZXhpdENvZGV9YH1gKTtcbiAgICB9XG4gICAgaWYgKGhlYWx0aENoZWNrLm5lZ2F0aXZlUmVzcG9uc2UgJiYgY29tYmluZWRPdXRwdXQuaW5jbHVkZXMoaGVhbHRoQ2hlY2submVnYXRpdmVSZXNwb25zZSkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgJHtydW5uZXJOYW1lfSByZXR1cm5lZCBuZWdhdGl2ZSByZXNwb25zZTogJHtoZWFsdGhDaGVjay5uZWdhdGl2ZVJlc3BvbnNlfWApO1xuICAgIH1cbiAgICBpZiAoaGVhbHRoQ2hlY2sucG9zaXRpdmVSZXNwb25zZSAmJiAhY29tYmluZWRPdXRwdXQuaW5jbHVkZXMoaGVhbHRoQ2hlY2sucG9zaXRpdmVSZXNwb25zZSkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgJHtydW5uZXJOYW1lfSBkaWQgbm90IHJldHVybiBwb3NpdGl2ZSByZXNwb25zZTogJHtoZWFsdGhDaGVjay5wb3NpdGl2ZVJlc3BvbnNlfWApO1xuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgcnVuT3B0aW9uYWxDb21tYW5kKFxuICAgIGNvbW1hbmQ6IHN0cmluZyB8IHVuZGVmaW5lZCxcbiAgICB3b3JraW5nRGlyZWN0b3J5OiBzdHJpbmcsXG4gICAgdGltZW91dE1zOiBudW1iZXIsXG4gICAgc2lnbmFsOiBBYm9ydFNpZ25hbCxcbiAgICBydW5uZXJJZDogc3RyaW5nLFxuICAgIHJ1bm5lck5hbWU6IHN0cmluZyxcbiAgKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgaWYgKCFjb21tYW5kPy50cmltKCkpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgdGhpcy5ydW5Db21tYW5kTGluZShjb21tYW5kLCB3b3JraW5nRGlyZWN0b3J5LCB0aW1lb3V0TXMsIHNpZ25hbCwgcnVubmVySWQsIHJ1bm5lck5hbWUpO1xuICAgIGlmICghcmVzdWx0LnN1Y2Nlc3MpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgJHtydW5uZXJOYW1lfSBmYWlsZWQ6ICR7cmVzdWx0LnN0ZGVyciB8fCByZXN1bHQuc3Rkb3V0IHx8IGBleGl0ICR7cmVzdWx0LmV4aXRDb2RlfWB9YCk7XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBydW5Db21tYW5kTGluZShcbiAgICBjb21tYW5kOiBzdHJpbmcsXG4gICAgd29ya2luZ0RpcmVjdG9yeTogc3RyaW5nLFxuICAgIHRpbWVvdXRNczogbnVtYmVyLFxuICAgIHNpZ25hbDogQWJvcnRTaWduYWwsXG4gICAgcnVubmVySWQ6IHN0cmluZyxcbiAgICBydW5uZXJOYW1lOiBzdHJpbmcsXG4gICk6IFByb21pc2U8bG9vbVJ1blJlc3VsdD4ge1xuICAgIGNvbnN0IHBhcnRzID0gc3BsaXRDb21tYW5kTGluZShjb21tYW5kKTtcbiAgICBpZiAoIXBhcnRzLmxlbmd0aCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGAke3J1bm5lck5hbWV9IGNvbW1hbmQgaXMgZW1wdHkuYCk7XG4gICAgfVxuICAgIHJldHVybiBydW5Qcm9jZXNzKHtcbiAgICAgIHJ1bm5lcklkLFxuICAgICAgcnVubmVyTmFtZSxcbiAgICAgIGV4ZWN1dGFibGU6IHBhcnRzWzBdLFxuICAgICAgYXJnczogcGFydHMuc2xpY2UoMSksXG4gICAgICB3b3JraW5nRGlyZWN0b3J5LFxuICAgICAgdGltZW91dE1zLFxuICAgICAgc2lnbmFsLFxuICAgIH0pO1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBlbnN1cmVNYW5hZ2VkUWVtdShncm91cE5hbWU6IHN0cmluZywgZ3JvdXBQYXRoOiBzdHJpbmcsIHFlbXU6IGxvb21RZW11Q29uZmlnLCB0aW1lb3V0TXM6IG51bWJlciwgc2lnbmFsOiBBYm9ydFNpZ25hbCk6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IG1hbmFnZXIgPSBxZW11Lm1hbmFnZXI7XG4gICAgaWYgKCFtYW5hZ2VyPy5lbmFibGVkKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgY29uc3QgcGlkUGF0aCA9IHRoaXMucmVzb2x2ZUdyb3VwRmlsZVBhdGgoZ3JvdXBQYXRoLCBtYW5hZ2VyLnBpZEZpbGUgfHwgXCIubG9vbS1xZW11LnBpZFwiKTtcbiAgICBjb25zdCBleGlzdGluZ1BpZCA9IGF3YWl0IHRoaXMucmVhZFBpZEZpbGUocGlkUGF0aCk7XG4gICAgaWYgKGV4aXN0aW5nUGlkICYmIHRoaXMuaXNQcm9jZXNzUnVubmluZyhleGlzdGluZ1BpZCkpIHtcbiAgICAgIGF3YWl0IHRoaXMud2FpdEZvck1hbmFnZWRRZW11UmVhZGluZXNzKGdyb3VwTmFtZSwgZ3JvdXBQYXRoLCBxZW11LCB0aW1lb3V0TXMsIHNpZ25hbCk7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgaWYgKGV4aXN0aW5nUGlkKSB7XG4gICAgICBhd2FpdCBybShwaWRQYXRoLCB7IGZvcmNlOiB0cnVlIH0pO1xuICAgIH1cblxuICAgIGNvbnN0IGV4ZWN1dGFibGUgPSBtYW5hZ2VyLmV4ZWN1dGFibGUgfHwgXCJxZW11LXN5c3RlbS14ODZfNjRcIjtcbiAgICBjb25zdCBhcmdzID0gdGhpcy5idWlsZE1hbmFnZWRRZW11QXJncyhncm91cFBhdGgsIG1hbmFnZXIpO1xuICAgIGlmICghYXJncy5sZW5ndGgpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgUUVNVSBtYW5hZ2VyIGZvciAke2dyb3VwTmFtZX0gbmVlZHMgcWVtdS5tYW5hZ2VyLmFyZ3Mgb3IgcWVtdS5tYW5hZ2VyLmltYWdlLmApO1xuICAgIH1cblxuICAgIGNvbnN0IGxvZ1BhdGggPSBtYW5hZ2VyLmxvZ0ZpbGUgPyB0aGlzLnJlc29sdmVHcm91cEZpbGVQYXRoKGdyb3VwUGF0aCwgbWFuYWdlci5sb2dGaWxlKSA6IG51bGw7XG4gICAgY29uc3QgbG9nRmQgPSBsb2dQYXRoID8gb3BlblN5bmMobG9nUGF0aCwgXCJhXCIpIDogbnVsbDtcbiAgICB0cnkge1xuICAgICAgY29uc3QgY2hpbGQgPSBzcGF3bihleGVjdXRhYmxlLCBhcmdzLCB7XG4gICAgICAgIGN3ZDogZ3JvdXBQYXRoLFxuICAgICAgICBkZXRhY2hlZDogdHJ1ZSxcbiAgICAgICAgc3RkaW86IFtcImlnbm9yZVwiLCBsb2dGZCA/PyBcImlnbm9yZVwiLCBsb2dGZCA/PyBcImlnbm9yZVwiXSxcbiAgICAgIH0pO1xuXG4gICAgICBjaGlsZC5vbihcImVycm9yXCIsICgpID0+IHVuZGVmaW5lZCk7XG4gICAgICBjaGlsZC51bnJlZigpO1xuXG4gICAgICBpZiAoIWNoaWxkLnBpZCkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYFFFTVUgbWFuYWdlciBmb3IgJHtncm91cE5hbWV9IGRpZCBub3QgcmV0dXJuIGEgcHJvY2VzcyBpZC5gKTtcbiAgICAgIH1cblxuICAgICAgYXdhaXQgd3JpdGVGaWxlKHBpZFBhdGgsIGAke2NoaWxkLnBpZH1cXG5gLCBcInV0ZjhcIik7XG4gICAgICBhd2FpdCB0aGlzLndhaXRGb3JNYW5hZ2VkUWVtdVJlYWRpbmVzcyhncm91cE5hbWUsIGdyb3VwUGF0aCwgcWVtdSwgdGltZW91dE1zLCBzaWduYWwpO1xuICAgIH0gZmluYWxseSB7XG4gICAgICBpZiAobG9nRmQgIT0gbnVsbCkge1xuICAgICAgICBjbG9zZVN5bmMobG9nRmQpO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgYnVpbGRNYW5hZ2VkUWVtdUFyZ3MoZ3JvdXBQYXRoOiBzdHJpbmcsIG1hbmFnZXI6IGxvb21RZW11TWFuYWdlckNvbmZpZyk6IHN0cmluZ1tdIHtcbiAgICBjb25zdCBhcmdzID0gc3BsaXRDb21tYW5kTGluZShtYW5hZ2VyLmFyZ3MgfHwgXCJcIik7XG4gICAgaWYgKG1hbmFnZXIuaW1hZ2UpIHtcbiAgICAgIGNvbnN0IGltYWdlUGF0aCA9IHRoaXMucmVzb2x2ZUdyb3VwRmlsZVBhdGgoZ3JvdXBQYXRoLCBtYW5hZ2VyLmltYWdlKTtcbiAgICAgIGFyZ3MucHVzaChcIi1kcml2ZVwiLCBgZmlsZT0ke2ltYWdlUGF0aH0saWY9dmlydGlvLGZvcm1hdD0ke21hbmFnZXIuaW1hZ2VGb3JtYXQgfHwgXCJxY293MlwifWApO1xuICAgIH1cbiAgICByZXR1cm4gYXJncztcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgd2FpdEZvck1hbmFnZWRRZW11UmVhZGluZXNzKFxuICAgIGdyb3VwTmFtZTogc3RyaW5nLFxuICAgIGdyb3VwUGF0aDogc3RyaW5nLFxuICAgIHFlbXU6IGxvb21RZW11Q29uZmlnLFxuICAgIHRpbWVvdXRNczogbnVtYmVyLFxuICAgIHNpZ25hbDogQWJvcnRTaWduYWwsXG4gICk6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IG1hbmFnZXIgPSBxZW11Lm1hbmFnZXI7XG4gICAgaWYgKCFtYW5hZ2VyPy5lbmFibGVkKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgaWYgKCFxZW11LmhlYWx0aENoZWNrKSB7XG4gICAgICBhd2FpdCBzbGVlcFdpdGhTaWduYWwobWFuYWdlci5ib290RGVsYXlNcyA/PyAwLCBzaWduYWwpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGNvbnN0IHRpbWVvdXQgPSBNYXRoLm1pbihtYW5hZ2VyLnJlYWRpbmVzc1RpbWVvdXRNcyA/PyA2MF8wMDAsIE1hdGgubWF4KHRpbWVvdXRNcywgMSkpO1xuICAgIGNvbnN0IGludGVydmFsID0gbWFuYWdlci5yZWFkaW5lc3NJbnRlcnZhbE1zID8/IDFfMDAwO1xuICAgIGNvbnN0IHN0YXJ0ZWRBdCA9IERhdGUubm93KCk7XG4gICAgbGV0IGxhc3RFcnJvciA9IFwiXCI7XG5cbiAgICB3aGlsZSAoRGF0ZS5ub3coKSAtIHN0YXJ0ZWRBdCA8PSB0aW1lb3V0KSB7XG4gICAgICBpZiAoc2lnbmFsLmFib3J0ZWQpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBRRU1VICR7Z3JvdXBOYW1lfSByZWFkaW5lc3Mgd2FpdCBjYW5jZWxsZWQuYCk7XG4gICAgICB9XG5cbiAgICAgIHRyeSB7XG4gICAgICAgIGF3YWl0IHRoaXMucnVuSGVhbHRoQ2hlY2socWVtdS5oZWFsdGhDaGVjaywgZ3JvdXBQYXRoLCBNYXRoLm1pbihpbnRlcnZhbCwgdGltZW91dCksIHNpZ25hbCwgYGNvbnRhaW5lcjoke2dyb3VwTmFtZX06cWVtdTpyZWFkeWAsIGBRRU1VICR7Z3JvdXBOYW1lfSByZWFkaW5lc3MgY2hlY2tgKTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgbGFzdEVycm9yID0gZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiBTdHJpbmcoZXJyb3IpO1xuICAgICAgfVxuXG4gICAgICBhd2FpdCBzbGVlcFdpdGhTaWduYWwoaW50ZXJ2YWwsIHNpZ25hbCk7XG4gICAgfVxuXG4gICAgdGhyb3cgbmV3IEVycm9yKGBRRU1VICR7Z3JvdXBOYW1lfSBkaWQgbm90IGJlY29tZSByZWFkeSB3aXRoaW4gJHt0aW1lb3V0fSBtcyR7bGFzdEVycm9yID8gYDogJHtsYXN0RXJyb3J9YCA6IFwiLlwifWApO1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBzdG9wTWFuYWdlZFFlbXVJZk5lZWRlZChncm91cE5hbWU6IHN0cmluZywgZ3JvdXBQYXRoOiBzdHJpbmcsIHFlbXU6IGxvb21RZW11Q29uZmlnLCB0aW1lb3V0TXM6IG51bWJlciwgc2lnbmFsOiBBYm9ydFNpZ25hbCk6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IG1hbmFnZXIgPSBxZW11Lm1hbmFnZXI7XG4gICAgaWYgKCFtYW5hZ2VyPy5lbmFibGVkIHx8IG1hbmFnZXIucGVyc2lzdCAhPT0gZmFsc2UpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBjb25zdCBwaWRQYXRoID0gdGhpcy5yZXNvbHZlR3JvdXBGaWxlUGF0aChncm91cFBhdGgsIG1hbmFnZXIucGlkRmlsZSB8fCBcIi5sb29tLXFlbXUucGlkXCIpO1xuICAgIGNvbnN0IHBpZCA9IGF3YWl0IHRoaXMucmVhZFBpZEZpbGUocGlkUGF0aCk7XG4gICAgaWYgKCFwaWQpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBpZiAobWFuYWdlci5zaHV0ZG93bkNvbW1hbmQpIHtcbiAgICAgIGF3YWl0IHRoaXMucnVuT3B0aW9uYWxDb21tYW5kKFxuICAgICAgICBtYW5hZ2VyLnNodXRkb3duQ29tbWFuZCxcbiAgICAgICAgZ3JvdXBQYXRoLFxuICAgICAgICBNYXRoLm1pbihtYW5hZ2VyLnNodXRkb3duVGltZW91dE1zID8/IHRpbWVvdXRNcywgdGltZW91dE1zKSxcbiAgICAgICAgc2lnbmFsLFxuICAgICAgICBgY29udGFpbmVyOiR7Z3JvdXBOYW1lfTpxZW11OnNodXRkb3duYCxcbiAgICAgICAgYFFFTVUgJHtncm91cE5hbWV9IHNodXRkb3duYCxcbiAgICAgICk7XG4gICAgfSBlbHNlIGlmICh0aGlzLmlzUHJvY2Vzc1J1bm5pbmcocGlkKSkge1xuICAgICAgcHJvY2Vzcy5raWxsKHBpZCwgbWFuYWdlci5raWxsU2lnbmFsIHx8IFwiU0lHVEVSTVwiKTtcbiAgICB9XG5cbiAgICBjb25zdCBzdG9wcGVkID0gYXdhaXQgdGhpcy53YWl0Rm9yUHJvY2Vzc0V4aXQocGlkLCBtYW5hZ2VyLnNodXRkb3duVGltZW91dE1zID8/IDEwXzAwMCwgc2lnbmFsKTtcbiAgICBpZiAoIXN0b3BwZWQgJiYgdGhpcy5pc1Byb2Nlc3NSdW5uaW5nKHBpZCkpIHtcbiAgICAgIHByb2Nlc3Mua2lsbChwaWQsIFwiU0lHS0lMTFwiKTtcbiAgICAgIGF3YWl0IHRoaXMud2FpdEZvclByb2Nlc3NFeGl0KHBpZCwgMl8wMDAsIHNpZ25hbCk7XG4gICAgfVxuXG4gICAgYXdhaXQgcm0ocGlkUGF0aCwgeyBmb3JjZTogdHJ1ZSB9KTtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgZ2V0TWFuYWdlZFFlbXVTdGF0dXMoZ3JvdXBQYXRoOiBzdHJpbmcsIG1hbmFnZXI6IGxvb21RZW11TWFuYWdlckNvbmZpZyk6IFByb21pc2U8c3RyaW5nPiB7XG4gICAgY29uc3QgcGlkUGF0aCA9IHRoaXMucmVzb2x2ZUdyb3VwRmlsZVBhdGgoZ3JvdXBQYXRoLCBtYW5hZ2VyLnBpZEZpbGUgfHwgXCIubG9vbS1xZW11LnBpZFwiKTtcbiAgICBjb25zdCBwaWQgPSBhd2FpdCB0aGlzLnJlYWRQaWRGaWxlKHBpZFBhdGgpO1xuICAgIGlmICghcGlkKSB7XG4gICAgICByZXR1cm4gXCJzdG9wcGVkXCI7XG4gICAgfVxuICAgIHJldHVybiB0aGlzLmlzUHJvY2Vzc1J1bm5pbmcocGlkKSA/IGBydW5uaW5nIHBpZCAke3BpZH1gIDogYHN0YWxlIHBpZCAke3BpZH1gO1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyByZWFkUGlkRmlsZShwaWRQYXRoOiBzdHJpbmcpOiBQcm9taXNlPG51bWJlciB8IG51bGw+IHtcbiAgICB0cnkge1xuICAgICAgY29uc3QgdmFsdWUgPSAoYXdhaXQgcmVhZEZpbGUocGlkUGF0aCwgXCJ1dGY4XCIpKS50cmltKCk7XG4gICAgICBjb25zdCBwaWQgPSBOdW1iZXIucGFyc2VJbnQodmFsdWUsIDEwKTtcbiAgICAgIHJldHVybiBOdW1iZXIuaXNJbnRlZ2VyKHBpZCkgJiYgcGlkID4gMCA/IHBpZCA6IG51bGw7XG4gICAgfSBjYXRjaCB7XG4gICAgICByZXR1cm4gbnVsbDtcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIGlzUHJvY2Vzc1J1bm5pbmcocGlkOiBudW1iZXIpOiBib29sZWFuIHtcbiAgICB0cnkge1xuICAgICAgcHJvY2Vzcy5raWxsKHBpZCwgMCk7XG4gICAgICByZXR1cm4gdHJ1ZTtcbiAgICB9IGNhdGNoIHtcbiAgICAgIHJldHVybiBmYWxzZTtcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIHdhaXRGb3JQcm9jZXNzRXhpdChwaWQ6IG51bWJlciwgdGltZW91dE1zOiBudW1iZXIsIHNpZ25hbDogQWJvcnRTaWduYWwpOiBQcm9taXNlPGJvb2xlYW4+IHtcbiAgICBjb25zdCBzdGFydGVkQXQgPSBEYXRlLm5vdygpO1xuICAgIHdoaWxlIChEYXRlLm5vdygpIC0gc3RhcnRlZEF0IDw9IHRpbWVvdXRNcykge1xuICAgICAgaWYgKHNpZ25hbC5hYm9ydGVkKSB7XG4gICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgIH1cbiAgICAgIGlmICghdGhpcy5pc1Byb2Nlc3NSdW5uaW5nKHBpZCkpIHtcbiAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgICB9XG4gICAgICBhd2FpdCBzbGVlcFdpdGhTaWduYWwoMjUwLCBzaWduYWwpO1xuICAgIH1cbiAgICByZXR1cm4gIXRoaXMuaXNQcm9jZXNzUnVubmluZyhwaWQpO1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBydW5DdXN0b21XcmFwcGVyKFxuICAgIGdyb3VwTmFtZTogc3RyaW5nLFxuICAgIGdyb3VwUGF0aDogc3RyaW5nLFxuICAgIGNvbmZpZzogbG9vbUNvbnRhaW5lckNvbmZpZyxcbiAgICByZXF1ZXN0OiBsb29tQ3VzdG9tUnVudGltZVJlcXVlc3QsXG4gICAgdGltZW91dE1zOiBudW1iZXIsXG4gICAgc2lnbmFsOiBBYm9ydFNpZ25hbCxcbiAgKTogUHJvbWlzZTxsb29tUnVuUmVzdWx0PiB7XG4gICAgY29uc3QgY3VzdG9tID0gdGhpcy5yZXF1aXJlQ3VzdG9tQ29uZmlnKGNvbmZpZyk7XG4gICAgYXdhaXQgdGhpcy5ydW5IZWFsdGhDaGVjayhjdXN0b20uaGVhbHRoQ2hlY2ssIGdyb3VwUGF0aCwgdGltZW91dE1zLCBzaWduYWwsIGBjb250YWluZXI6JHtncm91cE5hbWV9OmN1c3RvbTpoZWFsdGhgLCBgQ3VzdG9tICR7Z3JvdXBOYW1lfSBoZWFsdGggY2hlY2tgKTtcblxuICAgIGNvbnN0IHJlcXVlc3RGaWxlTmFtZSA9IGByZXF1ZXN0XyR7RGF0ZS5ub3coKX1fJHtNYXRoLnJhbmRvbSgpLnRvU3RyaW5nKDE2KS5zbGljZSgyKX0uanNvbmA7XG4gICAgY29uc3QgcmVxdWVzdFBhdGggPSBqb2luKGdyb3VwUGF0aCwgcmVxdWVzdEZpbGVOYW1lKTtcbiAgICB0cnkge1xuICAgICAgYXdhaXQgd3JpdGVGaWxlKHJlcXVlc3RQYXRoLCBgJHtKU09OLnN0cmluZ2lmeShyZXF1ZXN0LCBudWxsLCAyKX1cXG5gLCBcInV0ZjhcIik7XG4gICAgICBjb25zdCBhcmdzID0gc3BsaXRDb21tYW5kTGluZShjdXN0b20uYXJncyB8fCBcIntyZXF1ZXN0fVwiKS5tYXAoKGFyZykgPT5cbiAgICAgICAgYXJnXG4gICAgICAgICAgLnJlcGxhY2VBbGwoXCJ7cmVxdWVzdH1cIiwgcmVxdWVzdFBhdGgpXG4gICAgICAgICAgLnJlcGxhY2VBbGwoXCJ7Z3JvdXB9XCIsIGdyb3VwTmFtZSlcbiAgICAgICAgICAucmVwbGFjZUFsbChcIntncm91cFBhdGh9XCIsIGdyb3VwUGF0aCksXG4gICAgICApO1xuICAgICAgcmV0dXJuIGF3YWl0IHJ1blByb2Nlc3Moe1xuICAgICAgICBydW5uZXJJZDogYGNvbnRhaW5lcjoke2dyb3VwTmFtZX06Y3VzdG9tOiR7cmVxdWVzdC5hY3Rpb259YCxcbiAgICAgICAgcnVubmVyTmFtZTogYEN1c3RvbSAke2dyb3VwTmFtZX0gJHtyZXF1ZXN0LmFjdGlvbn1gLFxuICAgICAgICBleGVjdXRhYmxlOiBjdXN0b20uZXhlY3V0YWJsZSxcbiAgICAgICAgYXJncyxcbiAgICAgICAgd29ya2luZ0RpcmVjdG9yeTogZ3JvdXBQYXRoLFxuICAgICAgICB0aW1lb3V0TXMsXG4gICAgICAgIHNpZ25hbCxcbiAgICAgIH0pO1xuICAgIH0gZmluYWxseSB7XG4gICAgICBhd2FpdCBybShyZXF1ZXN0UGF0aCwgeyBmb3JjZTogdHJ1ZSB9KTtcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIGNyZWF0ZUN1c3RvbVJlcXVlc3QoXG4gICAgYWN0aW9uOiBsb29tQ3VzdG9tUnVudGltZVJlcXVlc3RbXCJhY3Rpb25cIl0sXG4gICAgZ3JvdXBOYW1lOiBzdHJpbmcsXG4gICAgZ3JvdXBQYXRoOiBzdHJpbmcsXG4gICAgY29uZmlnOiBsb29tQ29udGFpbmVyQ29uZmlnLFxuICAgIHRpbWVvdXRNczogbnVtYmVyLFxuICAgIGV4dHJhOiBQYXJ0aWFsPGxvb21DdXN0b21SdW50aW1lUmVxdWVzdD4gPSB7fSxcbiAgKTogbG9vbUN1c3RvbVJ1bnRpbWVSZXF1ZXN0IHtcbiAgICByZXR1cm4ge1xuICAgICAgYWN0aW9uLFxuICAgICAgZ3JvdXBOYW1lLFxuICAgICAgZ3JvdXBQYXRoLFxuICAgICAgcnVudGltZTogY29uZmlnLnJ1bnRpbWUsXG4gICAgICBpbWFnZTogY29uZmlnLmltYWdlLFxuICAgICAgYnVpbGQ6IGNvbmZpZy5jdXN0b20/LmJ1aWxkLFxuICAgICAgY29tbWFuZFN0cnVjdHVyZTogY29uZmlnLmN1c3RvbT8uY29tbWFuZFN0cnVjdHVyZSxcbiAgICAgIHRlYXJkb3duOiBjb25maWcuY3VzdG9tPy50ZWFyZG93bixcbiAgICAgIHRpbWVvdXRNcyxcbiAgICAgIGNvbmZpZzoge1xuICAgICAgICBleGVjdXRhYmxlOiBjb25maWcuZXhlY3V0YWJsZSxcbiAgICAgICAgY3VzdG9tOiBjb25maWcuY3VzdG9tLFxuICAgICAgICBxZW11OiBjb25maWcucWVtdSxcbiAgICAgICAgaGVhbHRoQ2hlY2s6IGNvbmZpZy5oZWFsdGhDaGVjayxcbiAgICAgIH0sXG4gICAgICAuLi5leHRyYSxcbiAgICB9O1xuICB9XG5cbiAgcHJpdmF0ZSBjcmVhdGVTeW50aGV0aWNSZXN1bHQocnVubmVySWQ6IHN0cmluZywgcnVubmVyTmFtZTogc3RyaW5nLCBzdGRvdXQ6IHN0cmluZywgc3VjY2VzcyA9IHRydWUpOiBsb29tUnVuUmVzdWx0IHtcbiAgICBjb25zdCBub3cgPSBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCk7XG4gICAgcmV0dXJuIHtcbiAgICAgIHJ1bm5lcklkLFxuICAgICAgcnVubmVyTmFtZSxcbiAgICAgIHN0YXJ0ZWRBdDogbm93LFxuICAgICAgZmluaXNoZWRBdDogbm93LFxuICAgICAgZHVyYXRpb25NczogMCxcbiAgICAgIGV4aXRDb2RlOiBzdWNjZXNzID8gMCA6IC0xLFxuICAgICAgc3Rkb3V0LFxuICAgICAgc3RkZXJyOiBcIlwiLFxuICAgICAgc3VjY2VzcyxcbiAgICAgIHRpbWVkT3V0OiBmYWxzZSxcbiAgICAgIGNhbmNlbGxlZDogZmFsc2UsXG4gICAgfTtcbiAgfVxuXG4gIHByaXZhdGUgZ2V0Q29udGFpbmVyc1BhdGgoKTogc3RyaW5nIHtcbiAgICBjb25zdCBhZGFwdGVyQmFzZVBhdGggPSAodGhpcy5hcHAudmF1bHQuYWRhcHRlciBhcyB7IGJhc2VQYXRoPzogc3RyaW5nIH0pLmJhc2VQYXRoID8/IFwiXCI7XG4gICAgcmV0dXJuIG5vcm1hbGl6ZUZzUGF0aChqb2luKGFkYXB0ZXJCYXNlUGF0aCwgdGhpcy5wbHVnaW5EaXIsIFwiY29udGFpbmVyc1wiKSk7XG4gIH1cblxuICBwcml2YXRlIHJlc29sdmVHcm91cFBhdGgoZ3JvdXBOYW1lOiBzdHJpbmcpOiBzdHJpbmcge1xuICAgIGNvbnN0IHNhZmVOYW1lID0gYmFzZW5hbWUoZ3JvdXBOYW1lKTtcbiAgICBpZiAoIXNhZmVOYW1lIHx8IHNhZmVOYW1lICE9PSBncm91cE5hbWUpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgSW52YWxpZCBjb250YWluZXIgZ3JvdXAgbmFtZTogJHtncm91cE5hbWV9YCk7XG4gICAgfVxuICAgIHJldHVybiBub3JtYWxpemVGc1BhdGgoam9pbih0aGlzLmdldENvbnRhaW5lcnNQYXRoKCksIHNhZmVOYW1lKSk7XG4gIH1cblxuICBwcml2YXRlIHJlc29sdmVHcm91cEZpbGVQYXRoKGdyb3VwUGF0aDogc3RyaW5nLCBmaWxlUGF0aDogc3RyaW5nKTogc3RyaW5nIHtcbiAgICBjb25zdCBzYWZlUGF0aCA9IG5vcm1hbGl6ZUZzUGF0aChqb2luKGdyb3VwUGF0aCwgZmlsZVBhdGgpKTtcbiAgICBjb25zdCBub3JtYWxpemVkR3JvdXBQYXRoID0gbm9ybWFsaXplRnNQYXRoKGdyb3VwUGF0aCk7XG4gICAgY29uc3QgcG9zaXhTYWZlUGF0aCA9IHNhZmVQYXRoLnJlcGxhY2UoL1xcXFwvZywgXCIvXCIpO1xuICAgIGNvbnN0IHBvc2l4R3JvdXBQYXRoID0gbm9ybWFsaXplZEdyb3VwUGF0aC5yZXBsYWNlKC9cXFxcL2csIFwiL1wiKTtcbiAgICBpZiAocG9zaXhTYWZlUGF0aCAhPT0gcG9zaXhHcm91cFBhdGggJiYgIXBvc2l4U2FmZVBhdGguc3RhcnRzV2l0aChgJHtwb3NpeEdyb3VwUGF0aH0vYCkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgSW52YWxpZCBRRU1VIG1hbmFnZXIgcGF0aCBvdXRzaWRlIGNvbnRhaW5lciBncm91cDogJHtmaWxlUGF0aH1gKTtcbiAgICB9XG4gICAgcmV0dXJuIHNhZmVQYXRoO1xuICB9XG5cbiAgcHJpdmF0ZSBpbWFnZU5hbWVGb3JHcm91cChncm91cE5hbWU6IHN0cmluZyk6IHN0cmluZyB7XG4gICAgcmV0dXJuIGBsb29tLWNvbnRhaW5lci0ke2dyb3VwTmFtZS50b0xvd2VyQ2FzZSgpLnJlcGxhY2UoL1teYS16MC05Xy4tXS9nLCBcIi1cIil9YDtcbiAgfVxuXG4gIHB1YmxpYyBnZXREZWZhdWx0TGFuZ3VhZ2VDb25maWcobGFuZ0lkOiBzdHJpbmcsIHNldHRpbmdzOiBsb29tUGx1Z2luU2V0dGluZ3MpOiBsb29tQ29udGFpbmVyTGFuZ3VhZ2VDb25maWcgfCBudWxsIHtcbiAgICBpZiAoIWxhbmdJZCkgcmV0dXJuIG51bGw7XG4gICAgY29uc3Qgbm9ybWFsaXplZCA9IGxhbmdJZC50b0xvd2VyQ2FzZSgpLnRyaW0oKTtcblxuICAgIC8vIENoZWNrIGN1c3RvbSBsYW5ndWFnZXMgZmlyc3RcbiAgICBjb25zdCBjdXN0b20gPSBzZXR0aW5ncy5jdXN0b21MYW5ndWFnZXMuZmluZCgoYykgPT4ge1xuICAgICAgY29uc3QgbmFtZXMgPSBbYy5uYW1lLCAuLi5jLmFsaWFzZXMuc3BsaXQoXCIsXCIpLm1hcCgocykgPT4gcy50cmltKCkpXS5tYXAoKG4pID0+IG4udG9Mb3dlckNhc2UoKSk7XG4gICAgICByZXR1cm4gbmFtZXMuaW5jbHVkZXMobm9ybWFsaXplZCk7XG4gICAgfSk7XG4gICAgaWYgKGN1c3RvbSkge1xuICAgICAgcmV0dXJuIHtcbiAgICAgICAgY29tbWFuZDogYCR7Y3VzdG9tLmV4ZWN1dGFibGV9ICR7Y3VzdG9tLmFyZ3N9YC50cmltKCksXG4gICAgICAgIGV4dGVuc2lvbjogY3VzdG9tLmV4dGVuc2lvbiB8fCBcIi50eHRcIixcbiAgICAgIH07XG4gICAgfVxuXG4gICAgLy8gU3RhbmRhcmQgYnVpbHQtaW5zXG4gICAgc3dpdGNoIChub3JtYWxpemVkKSB7XG4gICAgICBjYXNlIFwicHl0aG9uXCI6XG4gICAgICBjYXNlIFwicHlcIjpcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICBjb21tYW5kOiBgJHtzZXR0aW5ncy5weXRob25FeGVjdXRhYmxlLnRyaW0oKSB8fCBcInB5dGhvbjNcIn0ge2ZpbGV9YCxcbiAgICAgICAgICBleHRlbnNpb246IFwiLnB5XCIsXG4gICAgICAgIH07XG4gICAgICBjYXNlIFwiamF2YXNjcmlwdFwiOlxuICAgICAgY2FzZSBcImpzXCI6XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgY29tbWFuZDogYCR7c2V0dGluZ3Mubm9kZUV4ZWN1dGFibGUudHJpbSgpIHx8IFwibm9kZVwifSB7ZmlsZX1gLFxuICAgICAgICAgIGV4dGVuc2lvbjogXCIuanNcIixcbiAgICAgICAgfTtcbiAgICAgIGNhc2UgXCJ0eXBlc2NyaXB0XCI6XG4gICAgICBjYXNlIFwidHNcIjpcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICBjb21tYW5kOiBgJHtzZXR0aW5ncy50eXBlc2NyaXB0VHJhbnNwaWxlckV4ZWN1dGFibGUudHJpbSgpIHx8IFwidHMtbm9kZVwifSB7ZmlsZX1gLFxuICAgICAgICAgIGV4dGVuc2lvbjogXCIudHNcIixcbiAgICAgICAgfTtcbiAgICAgIGNhc2UgXCJzaGVsbFwiOlxuICAgICAgY2FzZSBcInNoXCI6XG4gICAgICBjYXNlIFwiYmFzaFwiOlxuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgIGNvbW1hbmQ6IGAke3NldHRpbmdzLnNoZWxsRXhlY3V0YWJsZS50cmltKCkgfHwgXCJiYXNoXCJ9IHtmaWxlfWAsXG4gICAgICAgICAgZXh0ZW5zaW9uOiBcIi5zaFwiLFxuICAgICAgICB9O1xuICAgICAgY2FzZSBcInJ1YnlcIjpcbiAgICAgIGNhc2UgXCJyYlwiOlxuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgIGNvbW1hbmQ6IGAke3NldHRpbmdzLnJ1YnlFeGVjdXRhYmxlLnRyaW0oKSB8fCBcInJ1YnlcIn0ge2ZpbGV9YCxcbiAgICAgICAgICBleHRlbnNpb246IFwiLnJiXCIsXG4gICAgICAgIH07XG4gICAgICBjYXNlIFwicGVybFwiOlxuICAgICAgY2FzZSBcInBsXCI6XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgY29tbWFuZDogYCR7c2V0dGluZ3MucGVybEV4ZWN1dGFibGUudHJpbSgpIHx8IFwicGVybFwifSB7ZmlsZX1gLFxuICAgICAgICAgIGV4dGVuc2lvbjogXCIucGxcIixcbiAgICAgICAgfTtcbiAgICAgIGNhc2UgXCJsdWFcIjpcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICBjb21tYW5kOiBgJHtzZXR0aW5ncy5sdWFFeGVjdXRhYmxlLnRyaW0oKSB8fCBcImx1YVwifSB7ZmlsZX1gLFxuICAgICAgICAgIGV4dGVuc2lvbjogXCIubHVhXCIsXG4gICAgICAgIH07XG4gICAgICBjYXNlIFwicGhwXCI6XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgY29tbWFuZDogYCR7c2V0dGluZ3MucGhwRXhlY3V0YWJsZS50cmltKCkgfHwgXCJwaHBcIn0ge2ZpbGV9YCxcbiAgICAgICAgICBleHRlbnNpb246IFwiLnBocFwiLFxuICAgICAgICB9O1xuICAgICAgY2FzZSBcImdvXCI6XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgY29tbWFuZDogYCR7c2V0dGluZ3MuZ29FeGVjdXRhYmxlLnRyaW0oKSB8fCBcImdvXCJ9IHJ1biB7ZmlsZX1gLFxuICAgICAgICAgIGV4dGVuc2lvbjogXCIuZ29cIixcbiAgICAgICAgfTtcbiAgICAgIGNhc2UgXCJoYXNrZWxsXCI6XG4gICAgICBjYXNlIFwiaHNcIjpcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICBjb21tYW5kOiBgJHtzZXR0aW5ncy5oYXNrZWxsRXhlY3V0YWJsZS50cmltKCkgfHwgXCJydW5naGNcIn0ge2ZpbGV9YCxcbiAgICAgICAgICBleHRlbnNpb246IFwiLmhzXCIsXG4gICAgICAgIH07XG4gICAgICBjYXNlIFwib2NhbWxcIjpcbiAgICAgIGNhc2UgXCJtbFwiOlxuICAgICAgICBpZiAoc2V0dGluZ3Mub2NhbWxNb2RlID09PSBcImR1bmVcIikge1xuICAgICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICBjb21tYW5kOiBgJHtzZXR0aW5ncy5vY2FtbEV4ZWN1dGFibGUudHJpbSgpIHx8IFwiZHVuZVwifSBleGVjIC0tIG9jYW1sIHtmaWxlfWAsXG4gICAgICAgICAgICBleHRlbnNpb246IFwiLm1sXCIsXG4gICAgICAgICAgfTtcbiAgICAgICAgfVxuICAgICAgICBpZiAoc2V0dGluZ3Mub2NhbWxNb2RlID09PSBcIm9jYW1sY1wiKSB7XG4gICAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIGNvbW1hbmQ6IHNoZWxsQ29tbWFuZChgJHtzZXR0aW5ncy5vY2FtbEV4ZWN1dGFibGUudHJpbSgpIHx8IFwib2NhbWxjXCJ9IC1vIC90bXAvbG9vbS1vY2FtbCBcIiQxXCIgJiYgL3RtcC9sb29tLW9jYW1sYCksXG4gICAgICAgICAgICBleHRlbnNpb246IFwiLm1sXCIsXG4gICAgICAgICAgfTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgIGNvbW1hbmQ6IGAke3NldHRpbmdzLm9jYW1sRXhlY3V0YWJsZS50cmltKCkgfHwgXCJvY2FtbFwifSB7ZmlsZX1gLFxuICAgICAgICAgIGV4dGVuc2lvbjogXCIubWxcIixcbiAgICAgICAgfTtcbiAgICAgIGNhc2UgXCJjXCI6XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgY29tbWFuZDogc2hlbGxDb21tYW5kKGAke3NldHRpbmdzLmNFeGVjdXRhYmxlLnRyaW0oKSB8fCBcImdjY1wifSBcIiQxXCIgLW8gL3RtcC9sb29tLWMgJiYgL3RtcC9sb29tLWNgKSxcbiAgICAgICAgICBleHRlbnNpb246IFwiLmNcIixcbiAgICAgICAgfTtcbiAgICAgIGNhc2UgXCJjcHBcIjpcbiAgICAgIGNhc2UgXCJjKytcIjpcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICBjb21tYW5kOiBzaGVsbENvbW1hbmQoYCR7c2V0dGluZ3MuY3BwRXhlY3V0YWJsZS50cmltKCkgfHwgXCJnKytcIn0gXCIkMVwiIC1vIC90bXAvbG9vbS1jcHAgJiYgL3RtcC9sb29tLWNwcGApLFxuICAgICAgICAgIGV4dGVuc2lvbjogXCIuY3BwXCIsXG4gICAgICAgIH07XG4gICAgICBjYXNlIFwicnVzdFwiOlxuICAgICAgY2FzZSBcInJzXCI6XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgY29tbWFuZDogc2hlbGxDb21tYW5kKGAke3NldHRpbmdzLnJ1c3RFeGVjdXRhYmxlLnRyaW0oKSB8fCBcInJ1c3RjXCJ9IFwiJDFcIiAtbyAvdG1wL2xvb20tcnVzdCAmJiAvdG1wL2xvb20tcnVzdGApLFxuICAgICAgICAgIGV4dGVuc2lvbjogXCIucnNcIixcbiAgICAgICAgfTtcbiAgICAgIGNhc2UgXCJqYXZhXCI6IHtcbiAgICAgICAgY29uc3QgY29tcGlsZXIgPSBzZXR0aW5ncy5qYXZhQ29tcGlsZXJFeGVjdXRhYmxlLnRyaW0oKSB8fCBcImphdmFjXCI7XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgY29tbWFuZDogc2hlbGxDb21tYW5kKGB0bXA9L3RtcC9sb29tLWphdmEtJCQgJiYgbWtkaXIgLXAgXCIkdG1wXCIgJiYgY3AgXCIkMVwiIFwiJHRtcC9NYWluLmphdmFcIiAmJiAke2NvbXBpbGVyfSBcIiR0bXAvTWFpbi5qYXZhXCIgJiYgJHtzZXR0aW5ncy5qYXZhRXhlY3V0YWJsZS50cmltKCkgfHwgXCJqYXZhXCJ9IC1jcCBcIiR0bXBcIiBNYWluYCksXG4gICAgICAgICAgZXh0ZW5zaW9uOiBcIi5qYXZhXCIsXG4gICAgICAgIH07XG4gICAgICB9XG4gICAgICBjYXNlIFwibGx2bS1pclwiOlxuICAgICAgY2FzZSBcImxsdm1cIjpcbiAgICAgIGNhc2UgXCJsbFwiOlxuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgIGNvbW1hbmQ6IGAke3NldHRpbmdzLmxsdm1JbnRlcnByZXRlckV4ZWN1dGFibGUudHJpbSgpIHx8IFwibGxpXCJ9IHtmaWxlfWAsXG4gICAgICAgICAgZXh0ZW5zaW9uOiBcIi5sbFwiLFxuICAgICAgICB9O1xuICAgICAgY2FzZSBcImxlYW5cIjpcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICBjb21tYW5kOiBgJHtzZXR0aW5ncy5sZWFuRXhlY3V0YWJsZS50cmltKCkgfHwgXCJsZWFuXCJ9IHtmaWxlfWAsXG4gICAgICAgICAgZXh0ZW5zaW9uOiBcIi5sZWFuXCIsXG4gICAgICAgIH07XG4gICAgICBjYXNlIFwiY29xXCI6XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgY29tbWFuZDogYCR7c2V0dGluZ3MuY29xRXhlY3V0YWJsZS50cmltKCkgfHwgXCJjb3FjXCJ9IC1xIHtmaWxlfWAsXG4gICAgICAgICAgZXh0ZW5zaW9uOiBcIi52XCIsXG4gICAgICAgIH07XG4gICAgICBjYXNlIFwic210bGliXCI6XG4gICAgICBjYXNlIFwic210XCI6XG4gICAgICBjYXNlIFwic210LWxpYlwiOlxuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgIGNvbW1hbmQ6IGAke3NldHRpbmdzLnNtdEV4ZWN1dGFibGUudHJpbSgpIHx8IFwiejNcIn0ge2ZpbGV9YCxcbiAgICAgICAgICBleHRlbnNpb246IFwiLnNtdDJcIixcbiAgICAgICAgfTtcbiAgICB9XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cbn1cblxuZnVuY3Rpb24gc2hlbGxDb21tYW5kKGNvbW1hbmQ6IHN0cmluZyk6IHN0cmluZyB7XG4gIHJldHVybiBgc2ggLWxjICR7cXVvdGVDb21tYW5kQXJnKGNvbW1hbmQpfSBzaCB7ZmlsZX1gO1xufVxuXG5mdW5jdGlvbiBub3JtYWxpemVFeHRlbnNpb24oZXh0ZW5zaW9uOiBzdHJpbmcpOiBzdHJpbmcge1xuICBjb25zdCB0cmltbWVkID0gZXh0ZW5zaW9uLnRyaW0oKTtcbiAgcmV0dXJuIHRyaW1tZWQuc3RhcnRzV2l0aChcIi5cIikgPyB0cmltbWVkIDogYC4ke3RyaW1tZWR9YDtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHNob3dEb2NrZXJOb3RpY2UobWVzc2FnZTogc3RyaW5nKTogdm9pZCB7XG4gIG5ldyBOb3RpY2UobWVzc2FnZSwgODAwMCk7XG59XG5cbmZ1bmN0aW9uIG9wdGlvbmFsU3RyaW5nKHZhbHVlOiB1bmtub3duKTogc3RyaW5nIHwgdW5kZWZpbmVkIHtcbiAgcmV0dXJuIHR5cGVvZiB2YWx1ZSA9PT0gXCJzdHJpbmdcIiAmJiB2YWx1ZS50cmltKCkgPyB2YWx1ZS50cmltKCkgOiB1bmRlZmluZWQ7XG59XG5cbmZ1bmN0aW9uIG9wdGlvbmFsUG9zaXRpdmVJbnRlZ2VyKHZhbHVlOiB1bmtub3duLCBsYWJlbDogc3RyaW5nKTogbnVtYmVyIHwgdW5kZWZpbmVkIHtcbiAgaWYgKHZhbHVlID09IG51bGwpIHtcbiAgICByZXR1cm4gdW5kZWZpbmVkO1xuICB9XG4gIGlmICh0eXBlb2YgdmFsdWUgIT09IFwibnVtYmVyXCIgfHwgIU51bWJlci5pc0ludGVnZXIodmFsdWUpIHx8IHZhbHVlIDw9IDApIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYCR7bGFiZWx9IG11c3QgYmUgYSBwb3NpdGl2ZSBpbnRlZ2VyLmApO1xuICB9XG4gIHJldHVybiB2YWx1ZTtcbn1cblxuZnVuY3Rpb24gb3B0aW9uYWxOb25OZWdhdGl2ZUludGVnZXIodmFsdWU6IHVua25vd24sIGxhYmVsOiBzdHJpbmcpOiBudW1iZXIgfCB1bmRlZmluZWQge1xuICBpZiAodmFsdWUgPT0gbnVsbCkge1xuICAgIHJldHVybiB1bmRlZmluZWQ7XG4gIH1cbiAgaWYgKHR5cGVvZiB2YWx1ZSAhPT0gXCJudW1iZXJcIiB8fCAhTnVtYmVyLmlzSW50ZWdlcih2YWx1ZSkgfHwgdmFsdWUgPCAwKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGAke2xhYmVsfSBtdXN0IGJlIGEgbm9uLW5lZ2F0aXZlIGludGVnZXIuYCk7XG4gIH1cbiAgcmV0dXJuIHZhbHVlO1xufVxuXG5mdW5jdGlvbiBvcHRpb25hbFNpZ25hbCh2YWx1ZTogdW5rbm93biwgbGFiZWw6IHN0cmluZyk6IE5vZGVKUy5TaWduYWxzIHwgdW5kZWZpbmVkIHtcbiAgaWYgKHZhbHVlID09IG51bGwpIHtcbiAgICByZXR1cm4gdW5kZWZpbmVkO1xuICB9XG4gIGlmICh0eXBlb2YgdmFsdWUgIT09IFwic3RyaW5nXCIgfHwgIS9eU0lHW0EtWjAtOV0rJC8udGVzdCh2YWx1ZSkpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYCR7bGFiZWx9IG11c3QgYmUgYSBzaWduYWwgbmFtZSBsaWtlIFNJR1RFUk0uYCk7XG4gIH1cbiAgcmV0dXJuIHZhbHVlIGFzIE5vZGVKUy5TaWduYWxzO1xufVxuXG5hc3luYyBmdW5jdGlvbiBzbGVlcFdpdGhTaWduYWwoZHVyYXRpb25NczogbnVtYmVyLCBzaWduYWw6IEFib3J0U2lnbmFsKTogUHJvbWlzZTx2b2lkPiB7XG4gIGlmIChkdXJhdGlvbk1zIDw9IDAgfHwgc2lnbmFsLmFib3J0ZWQpIHtcbiAgICByZXR1cm47XG4gIH1cblxuICBhd2FpdCBuZXcgUHJvbWlzZTx2b2lkPigocmVzb2x2ZSkgPT4ge1xuICAgIGNvbnN0IHRpbWVvdXQgPSBzZXRUaW1lb3V0KHJlc29sdmUsIGR1cmF0aW9uTXMpO1xuICAgIGNvbnN0IGFib3J0ID0gKCkgPT4ge1xuICAgICAgY2xlYXJUaW1lb3V0KHRpbWVvdXQpO1xuICAgICAgcmVzb2x2ZSgpO1xuICAgIH07XG4gICAgc2lnbmFsLmFkZEV2ZW50TGlzdGVuZXIoXCJhYm9ydFwiLCBhYm9ydCwgeyBvbmNlOiB0cnVlIH0pO1xuICB9KTtcbn1cblxuZnVuY3Rpb24gcnVudGltZUxhYmVsKHJ1bnRpbWU6IGxvb21Db250YWluZXJSdW50aW1lKTogc3RyaW5nIHtcbiAgc3dpdGNoIChydW50aW1lKSB7XG4gICAgY2FzZSBcImRvY2tlclwiOlxuICAgICAgcmV0dXJuIFwiRG9ja2VyXCI7XG4gICAgY2FzZSBcInBvZG1hblwiOlxuICAgICAgcmV0dXJuIFwiUG9kbWFuXCI7XG4gICAgY2FzZSBcInFlbXVcIjpcbiAgICAgIHJldHVybiBcIlFFTVVcIjtcbiAgICBjYXNlIFwiY3VzdG9tXCI6XG4gICAgICByZXR1cm4gXCJDdXN0b21cIjtcbiAgICBjYXNlIFwid3NsXCI6XG4gICAgICByZXR1cm4gXCJXU0xcIjtcbiAgfVxufVxuXG5mdW5jdGlvbiBzaGVsbFF1b3RlKHZhbHVlOiBzdHJpbmcpOiBzdHJpbmcge1xuICByZXR1cm4gYCcke3ZhbHVlLnJlcGxhY2VBbGwoXCInXCIsIFwiJ1xcXFwnJ1wiKX0nYDtcbn1cblxuZnVuY3Rpb24gcXVvdGVDb21tYW5kQXJnKHZhbHVlOiBzdHJpbmcpOiBzdHJpbmcge1xuICByZXR1cm4gYCcke3ZhbHVlLnJlcGxhY2VBbGwoXCInXCIsIFwiJ1xcXFwnJ1wiKX0nYDtcbn1cbiIsICJpbXBvcnQgeyBta2R0ZW1wLCBybSwgd3JpdGVGaWxlIH0gZnJvbSBcImZzL3Byb21pc2VzXCI7XG5pbXBvcnQgeyB0bXBkaXIgfSBmcm9tIFwib3NcIjtcbmltcG9ydCB7IGpvaW4gfSBmcm9tIFwicGF0aFwiO1xuaW1wb3J0IHsgc3Bhd24gfSBmcm9tIFwiY2hpbGRfcHJvY2Vzc1wiO1xuaW1wb3J0IHR5cGUgeyBsb29tUnVuUmVzdWx0IH0gZnJvbSBcIi4uL3R5cGVzXCI7XG5cbmV4cG9ydCBpbnRlcmZhY2UgbG9vbVByb2Nlc3NTcGVjIHtcbiAgcnVubmVySWQ6IHN0cmluZztcbiAgcnVubmVyTmFtZTogc3RyaW5nO1xuICBleGVjdXRhYmxlOiBzdHJpbmc7XG4gIGFyZ3M6IHN0cmluZ1tdO1xuICB3b3JraW5nRGlyZWN0b3J5OiBzdHJpbmc7XG4gIHRpbWVvdXRNczogbnVtYmVyO1xuICBzaWduYWw6IEFib3J0U2lnbmFsO1xuICBlbnY/OiBOb2RlSlMuUHJvY2Vzc0Vudjtcbn1cblxuZXhwb3J0IGludGVyZmFjZSBsb29tVGVtcFNvdXJjZVNwZWMgZXh0ZW5kcyBsb29tUHJvY2Vzc1NwZWMge1xuICBmaWxlRXh0ZW5zaW9uOiBzdHJpbmc7XG4gIHNvdXJjZTogc3RyaW5nO1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIGxvb21UZW1wU291cmNlSGFuZGxlIHtcbiAgdGVtcERpcjogc3RyaW5nO1xuICB0ZW1wRmlsZTogc3RyaW5nO1xufVxuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gd2l0aE5hbWVkVGVtcFNvdXJjZUZpbGU8VD4oXG4gIGZpbGVOYW1lOiBzdHJpbmcsXG4gIHNvdXJjZTogc3RyaW5nLFxuICBjYWxsYmFjazogKGhhbmRsZTogbG9vbVRlbXBTb3VyY2VIYW5kbGUpID0+IFByb21pc2U8VD4sXG4pOiBQcm9taXNlPFQ+IHtcbiAgY29uc3QgdGVtcERpciA9IGF3YWl0IG1rZHRlbXAoam9pbih0bXBkaXIoKSwgXCJsb29tLVwiKSk7XG4gIGNvbnN0IHRlbXBGaWxlID0gam9pbih0ZW1wRGlyLCBmaWxlTmFtZSk7XG5cbiAgdHJ5IHtcbiAgICBhd2FpdCB3cml0ZUZpbGUodGVtcEZpbGUsIG5vcm1hbGl6ZUV4ZWN1dGFibGVTb3VyY2Uoc291cmNlKSwgXCJ1dGY4XCIpO1xuICAgIHJldHVybiBhd2FpdCBjYWxsYmFjayh7IHRlbXBEaXIsIHRlbXBGaWxlIH0pO1xuICB9IGZpbmFsbHkge1xuICAgIGF3YWl0IHJtKHRlbXBEaXIsIHsgcmVjdXJzaXZlOiB0cnVlLCBmb3JjZTogdHJ1ZSB9KTtcbiAgfVxufVxuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gd2l0aFRlbXBTb3VyY2VGaWxlPFQ+KFxuICBmaWxlRXh0ZW5zaW9uOiBzdHJpbmcsXG4gIHNvdXJjZTogc3RyaW5nLFxuICBjYWxsYmFjazogKGhhbmRsZTogbG9vbVRlbXBTb3VyY2VIYW5kbGUpID0+IFByb21pc2U8VD4sXG4pOiBQcm9taXNlPFQ+IHtcbiAgcmV0dXJuIHdpdGhOYW1lZFRlbXBTb3VyY2VGaWxlKGBzbmlwcGV0JHtmaWxlRXh0ZW5zaW9ufWAsIHNvdXJjZSwgY2FsbGJhY2spO1xufVxuXG5mdW5jdGlvbiBub3JtYWxpemVFeGVjdXRhYmxlU291cmNlKHNvdXJjZTogc3RyaW5nKTogc3RyaW5nIHtcbiAgY29uc3QgbGluZXMgPSBzb3VyY2Uuc3BsaXQoXCJcXG5cIik7XG4gIGNvbnN0IG5vbkVtcHR5TGluZXMgPSBsaW5lcy5maWx0ZXIoKGxpbmUpID0+IGxpbmUudHJpbSgpLmxlbmd0aCA+IDApO1xuICBpZiAoIW5vbkVtcHR5TGluZXMubGVuZ3RoKSB7XG4gICAgcmV0dXJuIHNvdXJjZTtcbiAgfVxuXG4gIGxldCBzaGFyZWRJbmRlbnQgPSBnZXRMZWFkaW5nV2hpdGVzcGFjZShub25FbXB0eUxpbmVzWzBdKTtcbiAgZm9yIChjb25zdCBsaW5lIG9mIG5vbkVtcHR5TGluZXMuc2xpY2UoMSkpIHtcbiAgICBzaGFyZWRJbmRlbnQgPSBzaGFyZWRXaGl0ZXNwYWNlUHJlZml4KHNoYXJlZEluZGVudCwgZ2V0TGVhZGluZ1doaXRlc3BhY2UobGluZSkpO1xuICAgIGlmICghc2hhcmVkSW5kZW50KSB7XG4gICAgICByZXR1cm4gc291cmNlO1xuICAgIH1cbiAgfVxuXG4gIGlmICghc2hhcmVkSW5kZW50KSB7XG4gICAgcmV0dXJuIHNvdXJjZTtcbiAgfVxuXG4gIHJldHVybiBsaW5lc1xuICAgIC5tYXAoKGxpbmUpID0+IChsaW5lLnRyaW0oKS5sZW5ndGggPT09IDAgPyBsaW5lIDogbGluZS5zdGFydHNXaXRoKHNoYXJlZEluZGVudCkgPyBsaW5lLnNsaWNlKHNoYXJlZEluZGVudC5sZW5ndGgpIDogbGluZSkpXG4gICAgLmpvaW4oXCJcXG5cIik7XG59XG5cbmZ1bmN0aW9uIGdldExlYWRpbmdXaGl0ZXNwYWNlKGxpbmU6IHN0cmluZyk6IHN0cmluZyB7XG4gIGNvbnN0IG1hdGNoID0gbGluZS5tYXRjaCgvXltcXHQgXSovKTtcbiAgcmV0dXJuIG1hdGNoPy5bMF0gPz8gXCJcIjtcbn1cblxuZnVuY3Rpb24gc2hhcmVkV2hpdGVzcGFjZVByZWZpeChsZWZ0OiBzdHJpbmcsIHJpZ2h0OiBzdHJpbmcpOiBzdHJpbmcge1xuICBsZXQgaW5kZXggPSAwO1xuICB3aGlsZSAoaW5kZXggPCBsZWZ0Lmxlbmd0aCAmJiBpbmRleCA8IHJpZ2h0Lmxlbmd0aCAmJiBsZWZ0W2luZGV4XSA9PT0gcmlnaHRbaW5kZXhdKSB7XG4gICAgaW5kZXggKz0gMTtcbiAgfVxuICByZXR1cm4gbGVmdC5zbGljZSgwLCBpbmRleCk7XG59XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBydW5Qcm9jZXNzKHNwZWM6IGxvb21Qcm9jZXNzU3BlYyk6IFByb21pc2U8bG9vbVJ1blJlc3VsdD4ge1xuICBjb25zdCBzdGFydGVkQXQgPSBuZXcgRGF0ZSgpO1xuICBsZXQgc3Rkb3V0ID0gXCJcIjtcbiAgbGV0IHN0ZGVyciA9IFwiXCI7XG4gIGxldCBleGl0Q29kZTogbnVtYmVyIHwgbnVsbCA9IG51bGw7XG4gIGxldCB0aW1lZE91dCA9IGZhbHNlO1xuICBsZXQgY2FuY2VsbGVkID0gZmFsc2U7XG4gIGxldCBjaGlsZDogUmV0dXJuVHlwZTx0eXBlb2Ygc3Bhd24+IHwgbnVsbCA9IG51bGw7XG4gIGxldCB0aW1lb3V0SGFuZGxlOiBOb2RlSlMuVGltZW91dCB8IG51bGwgPSBudWxsO1xuICBsZXQgYWJvcnRIYW5kbGVyOiAoKCkgPT4gdm9pZCkgfCBudWxsID0gbnVsbDtcblxuICB0cnkge1xuICAgIGF3YWl0IG5ldyBQcm9taXNlPHZvaWQ+KChyZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICAgIGNoaWxkID0gc3Bhd24oc3BlYy5leGVjdXRhYmxlLCBzcGVjLmFyZ3MsIHtcbiAgICAgICAgY3dkOiBzcGVjLndvcmtpbmdEaXJlY3RvcnksXG4gICAgICAgIHNoZWxsOiBmYWxzZSxcbiAgICAgICAgZW52OiB7XG4gICAgICAgICAgLi4ucHJvY2Vzcy5lbnYsXG4gICAgICAgICAgLi4uc3BlYy5lbnYsXG4gICAgICAgIH0sXG4gICAgICB9KTtcblxuICAgICAgY29uc3QgYWJvcnQgPSAoKSA9PiB7XG4gICAgICAgIGNhbmNlbGxlZCA9IHRydWU7XG4gICAgICAgIGNoaWxkPy5raWxsKFwiU0lHVEVSTVwiKTtcbiAgICAgIH07XG4gICAgICBhYm9ydEhhbmRsZXIgPSBhYm9ydDtcblxuICAgICAgaWYgKHNwZWMuc2lnbmFsLmFib3J0ZWQpIHtcbiAgICAgICAgYWJvcnQoKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHNwZWMuc2lnbmFsLmFkZEV2ZW50TGlzdGVuZXIoXCJhYm9ydFwiLCBhYm9ydCwgeyBvbmNlOiB0cnVlIH0pO1xuICAgICAgfVxuXG4gICAgICB0aW1lb3V0SGFuZGxlID0gc2V0VGltZW91dCgoKSA9PiB7XG4gICAgICAgIHRpbWVkT3V0ID0gdHJ1ZTtcbiAgICAgICAgY2hpbGQ/LmtpbGwoXCJTSUdURVJNXCIpO1xuICAgICAgfSwgc3BlYy50aW1lb3V0TXMpO1xuXG4gICAgICBjaGlsZC5zdGRvdXQ/Lm9uKFwiZGF0YVwiLCAoY2h1bmspID0+IHtcbiAgICAgICAgc3Rkb3V0ICs9IGNodW5rLnRvU3RyaW5nKCk7XG4gICAgICB9KTtcblxuICAgICAgY2hpbGQuc3RkZXJyPy5vbihcImRhdGFcIiwgKGNodW5rKSA9PiB7XG4gICAgICAgIHN0ZGVyciArPSBjaHVuay50b1N0cmluZygpO1xuICAgICAgfSk7XG5cbiAgICAgIGNoaWxkLm9uKFwiZXJyb3JcIiwgKGVycm9yKSA9PiB7XG4gICAgICAgIHJlamVjdChlcnJvcik7XG4gICAgICB9KTtcblxuICAgICAgY2hpbGQub24oXCJjbG9zZVwiLCAoY29kZSkgPT4ge1xuICAgICAgICBleGl0Q29kZSA9IGNvZGU7XG4gICAgICAgIHJlc29sdmUoKTtcbiAgICAgIH0pO1xuICAgIH0pO1xuICB9IGNhdGNoIChlcnJvcikge1xuICAgIHN0ZGVyciA9IHN0ZGVyciB8fCBmb3JtYXRQcm9jZXNzRXJyb3IoZXJyb3IsIHNwZWMuZXhlY3V0YWJsZSk7XG4gICAgZXhpdENvZGUgPSBleGl0Q29kZSA/PyAtMTtcbiAgfSBmaW5hbGx5IHtcbiAgICBpZiAoYWJvcnRIYW5kbGVyKSB7XG4gICAgICBzcGVjLnNpZ25hbC5yZW1vdmVFdmVudExpc3RlbmVyKFwiYWJvcnRcIiwgYWJvcnRIYW5kbGVyKTtcbiAgICB9XG4gICAgaWYgKHRpbWVvdXRIYW5kbGUpIHtcbiAgICAgIGNsZWFyVGltZW91dCh0aW1lb3V0SGFuZGxlKTtcbiAgICB9XG4gIH1cblxuICBjb25zdCBmaW5pc2hlZEF0ID0gbmV3IERhdGUoKTtcbiAgY29uc3QgZHVyYXRpb25NcyA9IGZpbmlzaGVkQXQuZ2V0VGltZSgpIC0gc3RhcnRlZEF0LmdldFRpbWUoKTtcbiAgY29uc3Qgc3VjY2VzcyA9ICF0aW1lZE91dCAmJiAhY2FuY2VsbGVkICYmIGV4aXRDb2RlID09PSAwO1xuXG4gIHJldHVybiB7XG4gICAgcnVubmVySWQ6IHNwZWMucnVubmVySWQsXG4gICAgcnVubmVyTmFtZTogc3BlYy5ydW5uZXJOYW1lLFxuICAgIHN0YXJ0ZWRBdDogc3RhcnRlZEF0LnRvSVNPU3RyaW5nKCksXG4gICAgZmluaXNoZWRBdDogZmluaXNoZWRBdC50b0lTT1N0cmluZygpLFxuICAgIGR1cmF0aW9uTXMsXG4gICAgZXhpdENvZGUsXG4gICAgc3Rkb3V0LFxuICAgIHN0ZGVycixcbiAgICBzdWNjZXNzLFxuICAgIHRpbWVkT3V0LFxuICAgIGNhbmNlbGxlZCxcbiAgfTtcbn1cblxuZnVuY3Rpb24gZm9ybWF0UHJvY2Vzc0Vycm9yKGVycm9yOiB1bmtub3duLCBleGVjdXRhYmxlOiBzdHJpbmcpOiBzdHJpbmcge1xuICBpZiAoZXJyb3IgaW5zdGFuY2VvZiBFcnJvciAmJiBcImNvZGVcIiBpbiBlcnJvciAmJiAoZXJyb3IgYXMgTm9kZUpTLkVycm5vRXhjZXB0aW9uKS5jb2RlID09PSBcIkVOT0VOVFwiKSB7XG4gICAgcmV0dXJuIGBFeGVjdXRhYmxlIG5vdCBmb3VuZDogJHtleGVjdXRhYmxlfWA7XG4gIH1cblxuICByZXR1cm4gZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiBTdHJpbmcoZXJyb3IpO1xufVxuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gcnVuVGVtcEZpbGVQcm9jZXNzKHNwZWM6IGxvb21UZW1wU291cmNlU3BlYyk6IFByb21pc2U8bG9vbVJ1blJlc3VsdD4ge1xuICByZXR1cm4gd2l0aFRlbXBTb3VyY2VGaWxlKHNwZWMuZmlsZUV4dGVuc2lvbiwgc3BlYy5zb3VyY2UsIGFzeW5jICh7IHRlbXBGaWxlLCB0ZW1wRGlyIH0pID0+XG4gICAgcnVuUHJvY2Vzcyh7XG4gICAgICBydW5uZXJJZDogc3BlYy5ydW5uZXJJZCxcbiAgICAgIHJ1bm5lck5hbWU6IHNwZWMucnVubmVyTmFtZSxcbiAgICAgIGV4ZWN1dGFibGU6IHNwZWMuZXhlY3V0YWJsZSxcbiAgICAgIGFyZ3M6IHNwZWMuYXJncy5tYXAoKHZhbHVlKSA9PiB2YWx1ZS5yZXBsYWNlQWxsKFwie2ZpbGV9XCIsIHRlbXBGaWxlKS5yZXBsYWNlQWxsKFwie3RlbXBEaXJ9XCIsIHRlbXBEaXIpKSxcbiAgICAgIHdvcmtpbmdEaXJlY3Rvcnk6IHNwZWMud29ya2luZ0RpcmVjdG9yeSxcbiAgICAgIHRpbWVvdXRNczogc3BlYy50aW1lb3V0TXMsXG4gICAgICBzaWduYWw6IHNwZWMuc2lnbmFsLFxuICAgICAgZW52OiBleHBhbmRUZW1wbGF0ZWRFbnYoc3BlYy5lbnYsIHRlbXBGaWxlLCB0ZW1wRGlyKSxcbiAgICB9KSxcbiAgKTtcbn1cblxuZnVuY3Rpb24gZXhwYW5kVGVtcGxhdGVkRW52KGVudjogTm9kZUpTLlByb2Nlc3NFbnYgfCB1bmRlZmluZWQsIHRlbXBGaWxlOiBzdHJpbmcsIHRlbXBEaXI6IHN0cmluZyk6IE5vZGVKUy5Qcm9jZXNzRW52IHwgdW5kZWZpbmVkIHtcbiAgaWYgKCFlbnYpIHtcbiAgICByZXR1cm4gdW5kZWZpbmVkO1xuICB9XG5cbiAgcmV0dXJuIE9iamVjdC5mcm9tRW50cmllcyhcbiAgICBPYmplY3QuZW50cmllcyhlbnYpLm1hcCgoW2tleSwgdmFsdWVdKSA9PiBbXG4gICAgICBrZXksXG4gICAgICB0eXBlb2YgdmFsdWUgPT09IFwic3RyaW5nXCIgPyB2YWx1ZS5yZXBsYWNlQWxsKFwie2ZpbGV9XCIsIHRlbXBGaWxlKS5yZXBsYWNlQWxsKFwie3RlbXBEaXJ9XCIsIHRlbXBEaXIpIDogdmFsdWUsXG4gICAgXSksXG4gICk7XG59XG4iLCAiZXhwb3J0IGZ1bmN0aW9uIHNwbGl0Q29tbWFuZExpbmUoaW5wdXQ6IHN0cmluZyk6IHN0cmluZ1tdIHtcbiAgY29uc3QgcGFydHM6IHN0cmluZ1tdID0gW107XG4gIGxldCBjdXJyZW50ID0gXCJcIjtcbiAgbGV0IHF1b3RlOiBcIidcIiB8IFwiXFxcIlwiIHwgbnVsbCA9IG51bGw7XG4gIGxldCBlc2NhcGluZyA9IGZhbHNlO1xuXG4gIGZvciAoY29uc3QgY2hhciBvZiBpbnB1dC50cmltKCkpIHtcbiAgICBpZiAoZXNjYXBpbmcpIHtcbiAgICAgIGN1cnJlbnQgKz0gY2hhcjtcbiAgICAgIGVzY2FwaW5nID0gZmFsc2U7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICBpZiAoY2hhciA9PT0gXCJcXFxcXCIpIHtcbiAgICAgIGVzY2FwaW5nID0gdHJ1ZTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cblxuICAgIGlmICgoY2hhciA9PT0gXCInXCIgfHwgY2hhciA9PT0gXCJcXFwiXCIpICYmICFxdW90ZSkge1xuICAgICAgcXVvdGUgPSBjaGFyO1xuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgaWYgKGNoYXIgPT09IHF1b3RlKSB7XG4gICAgICBxdW90ZSA9IG51bGw7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICBpZiAoL1xccy8udGVzdChjaGFyKSAmJiAhcXVvdGUpIHtcbiAgICAgIGlmIChjdXJyZW50KSB7XG4gICAgICAgIHBhcnRzLnB1c2goY3VycmVudCk7XG4gICAgICAgIGN1cnJlbnQgPSBcIlwiO1xuICAgICAgfVxuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgY3VycmVudCArPSBjaGFyO1xuICB9XG5cbiAgaWYgKGN1cnJlbnQpIHtcbiAgICBwYXJ0cy5wdXNoKGN1cnJlbnQpO1xuICB9XG5cbiAgcmV0dXJuIHBhcnRzO1xufVxuIiwgImltcG9ydCB7IERlY29yYXRpb24sIHR5cGUgRWRpdG9yVmlldyB9IGZyb20gXCJAY29kZW1pcnJvci92aWV3XCI7XG5pbXBvcnQgdHlwZSB7IFJhbmdlU2V0QnVpbGRlciB9IGZyb20gXCJAY29kZW1pcnJvci9zdGF0ZVwiO1xuaW1wb3J0IHR5cGUgeyBsb29tQ29kZUJsb2NrIH0gZnJvbSBcIi4vdHlwZXNcIjtcblxuaW50ZXJmYWNlIExsdm1Ub2tlbiB7XG4gIGZyb206IG51bWJlcjtcbiAgdG86IG51bWJlcjtcbiAgY2xhc3NOYW1lOiBzdHJpbmc7XG59XG5cbmNvbnN0IExMVk1fS0VZV09SRFMgPSBuZXcgTWFwPHN0cmluZywgc3RyaW5nPihbXG4gIC4uLm1hcFdvcmRzKFwibG9vbS1sbHZtLWtleXdvcmQtY29udHJvbFwiLCBbXG4gICAgXCJyZXRcIiwgXCJiclwiLCBcInN3aXRjaFwiLCBcImluZGlyZWN0YnJcIiwgXCJpbnZva2VcIiwgXCJjYWxsYnJcIiwgXCJyZXN1bWVcIiwgXCJ1bnJlYWNoYWJsZVwiLCBcImNsZWFudXByZXRcIiwgXCJjYXRjaHJldFwiLCBcImNhdGNoc3dpdGNoXCIsXG4gIF0pLFxuICAuLi5tYXBXb3JkcyhcImxvb20tbGx2bS1rZXl3b3JkLWRlY2xhcmF0aW9uXCIsIFtcbiAgICBcImRlZmluZVwiLCBcImRlY2xhcmVcIiwgXCJ0eXBlXCIsIFwiZ2xvYmFsXCIsIFwiY29uc3RhbnRcIiwgXCJhbGlhc1wiLCBcImlmdW5jXCIsIFwiY29tZGF0XCIsIFwiYXR0cmlidXRlc1wiLCBcInNlY3Rpb25cIiwgXCJnY1wiLCBcInByZWZpeFwiLCBcInByb2xvZ3VlXCIsXG4gICAgXCJwZXJzb25hbGl0eVwiLCBcInVzZWxpc3RvcmRlclwiLCBcInVzZWxpc3RvcmRlcl9iYlwiLCBcIm1vZHVsZVwiLCBcImFzbVwiLCBcInNvdXJjZV9maWxlbmFtZVwiLCBcInRhcmdldFwiLFxuICBdKSxcbiAgLi4ubWFwV29yZHMoXCJsb29tLWxsdm0ta2V5d29yZC1tZW1vcnlcIiwgW1xuICAgIFwiYWxsb2NhXCIsIFwibG9hZFwiLCBcInN0b3JlXCIsIFwiZ2V0ZWxlbWVudHB0clwiLCBcImZlbmNlXCIsIFwiY21weGNoZ1wiLCBcImF0b21pY3Jtd1wiLCBcImV4dHJhY3R2YWx1ZVwiLCBcImluc2VydHZhbHVlXCIsIFwiZXh0cmFjdGVsZW1lbnRcIixcbiAgICBcImluc2VydGVsZW1lbnRcIiwgXCJzaHVmZmxldmVjdG9yXCIsXG4gIF0pLFxuICAuLi5tYXBXb3JkcyhcImxvb20tbGx2bS1rZXl3b3JkLWFyaXRobWV0aWNcIiwgW1xuICAgIFwiYWRkXCIsIFwic3ViXCIsIFwibXVsXCIsIFwidWRpdlwiLCBcInNkaXZcIiwgXCJ1cmVtXCIsIFwic3JlbVwiLCBcInNobFwiLCBcImxzaHJcIiwgXCJhc2hyXCIsIFwiYW5kXCIsIFwib3JcIiwgXCJ4b3JcIiwgXCJmbmVnXCIsIFwiZmFkZFwiLCBcImZzdWJcIiwgXCJmbXVsXCIsXG4gICAgXCJmZGl2XCIsIFwiZnJlbVwiLFxuICBdKSxcbiAgLi4ubWFwV29yZHMoXCJsb29tLWxsdm0ta2V5d29yZC1jb21wYXJpc29uXCIsIFtcImljbXBcIiwgXCJmY21wXCJdKSxcbiAgLi4ubWFwV29yZHMoXCJsb29tLWxsdm0ta2V5d29yZC1jYXN0XCIsIFtcbiAgICBcInRydW5jXCIsIFwiemV4dFwiLCBcInNleHRcIiwgXCJmcHRydW5jXCIsIFwiZnBleHRcIiwgXCJmcHRvdWlcIiwgXCJmcHRvc2lcIiwgXCJ1aXRvZnBcIiwgXCJzaXRvZnBcIiwgXCJwdHJ0b2ludFwiLCBcImludHRvcHRyXCIsIFwiYml0Y2FzdFwiLCBcImFkZHJzcGFjZWNhc3RcIixcbiAgXSksXG4gIC4uLm1hcFdvcmRzKFwibG9vbS1sbHZtLWtleXdvcmQtb3RoZXJcIiwgW1wicGhpXCIsIFwic2VsZWN0XCIsIFwiZnJlZXplXCIsIFwiY2FsbFwiLCBcImxhbmRpbmdwYWRcIiwgXCJjYXRjaHBhZFwiLCBcImNsZWFudXBwYWRcIiwgXCJ2YV9hcmdcIl0pLFxuICAuLi5tYXBXb3JkcyhcImxvb20tbGx2bS1rZXl3b3JkLW1vZGlmaWVyXCIsIFtcbiAgICBcInByaXZhdGVcIiwgXCJpbnRlcm5hbFwiLCBcImF2YWlsYWJsZV9leHRlcm5hbGx5XCIsIFwibGlua29uY2VcIiwgXCJ3ZWFrXCIsIFwiY29tbW9uXCIsIFwiYXBwZW5kaW5nXCIsIFwiZXh0ZXJuX3dlYWtcIiwgXCJsaW5rb25jZV9vZHJcIiwgXCJ3ZWFrX29kclwiLFxuICAgIFwiZXh0ZXJuYWxcIiwgXCJkZWZhdWx0XCIsIFwiaGlkZGVuXCIsIFwicHJvdGVjdGVkXCIsIFwiZGxsaW1wb3J0XCIsIFwiZGxsZXhwb3J0XCIsIFwiZHNvX2xvY2FsXCIsIFwiZHNvX3ByZWVtcHRhYmxlXCIsIFwiZXh0ZXJuYWxseV9pbml0aWFsaXplZFwiLFxuICAgIFwidGhyZWFkX2xvY2FsXCIsIFwibG9jYWxkeW5hbWljXCIsIFwiaW5pdGlhbGV4ZWNcIiwgXCJsb2NhbGV4ZWNcIiwgXCJ1bm5hbWVkX2FkZHJcIiwgXCJsb2NhbF91bm5hbWVkX2FkZHJcIiwgXCJhdG9taWNcIiwgXCJ1bm9yZGVyZWRcIiwgXCJtb25vdG9uaWNcIixcbiAgICBcImFjcXVpcmVcIiwgXCJyZWxlYXNlXCIsIFwiYWNxX3JlbFwiLCBcInNlcV9jc3RcIiwgXCJzeW5jc2NvcGVcIiwgXCJ2b2xhdGlsZVwiLCBcInNpbmdsZXRocmVhZFwiLCBcImNjY1wiLCBcImZhc3RjY1wiLCBcImNvbGRjY1wiLCBcIndlYmtpdF9qc2NjXCIsXG4gICAgXCJhbnlyZWdjY1wiLCBcInByZXNlcnZlX21vc3RjY1wiLCBcInByZXNlcnZlX2FsbGNjXCIsIFwiY3h4X2Zhc3RfdGxzY2NcIiwgXCJzd2lmdGNjXCIsIFwidGFpbGNjXCIsIFwiY2ZndWFyZF9jaGVja2NjXCIsIFwidGFpbFwiLCBcIm11c3R0YWlsXCIsIFwibm90YWlsXCIsXG4gICAgXCJmYXN0XCIsIFwibm5hblwiLCBcIm5pbmZcIiwgXCJuc3pcIiwgXCJhcmNwXCIsIFwiY29udHJhY3RcIiwgXCJhZm5cIiwgXCJyZWFzc29jXCIsIFwibnV3XCIsIFwibnN3XCIsIFwiZXhhY3RcIiwgXCJpbmJvdW5kc1wiLCBcInRvXCIsIFwieFwiLFxuICBdKSxcbiAgLi4ubWFwV29yZHMoXCJsb29tLWxsdm0tcHJlZGljYXRlXCIsIFtcbiAgICBcImVxXCIsIFwibmVcIiwgXCJ1Z3RcIiwgXCJ1Z2VcIiwgXCJ1bHRcIiwgXCJ1bGVcIiwgXCJzZ3RcIiwgXCJzZ2VcIiwgXCJzbHRcIiwgXCJzbGVcIiwgXCJvZXFcIiwgXCJvZ3RcIiwgXCJvZ2VcIiwgXCJvbHRcIiwgXCJvbGVcIiwgXCJvbmVcIiwgXCJvcmRcIiwgXCJ1ZXFcIiwgXCJ1bmVcIixcbiAgICBcInVub1wiLFxuICBdKSxcbiAgLi4ubWFwV29yZHMoXCJsb29tLWxsdm0tYXR0cmlidXRlXCIsIFtcbiAgICBcImFsd2F5c2lubGluZVwiLCBcImFyZ21lbW9ubHlcIiwgXCJidWlsdGluXCIsIFwiYnlyZWZcIiwgXCJieXZhbFwiLCBcImNvbGRcIiwgXCJjb252ZXJnZW50XCIsIFwiZGVyZWZlcmVuY2VhYmxlXCIsIFwiZGVyZWZlcmVuY2VhYmxlX29yX251bGxcIiwgXCJkaXN0aW5jdFwiLFxuICAgIFwiaW1tYXJnXCIsIFwiaW5hbGxvY2FcIiwgXCJpbnJlZ1wiLCBcIm11c3Rwcm9ncmVzc1wiLCBcIm5lc3RcIiwgXCJub2FsaWFzXCIsIFwibm9jYWxsYmFja1wiLCBcIm5vY2FwdHVyZVwiLCBcIm5vZnJlZVwiLCBcIm5vaW5saW5lXCIsIFwibm9ubGF6eWJpbmRcIixcbiAgICBcIm5vbm51bGxcIiwgXCJub3JlY3Vyc2VcIiwgXCJub3JlZHpvbmVcIiwgXCJub3JldHVyblwiLCBcIm5vc3luY1wiLCBcIm5vdW53aW5kXCIsIFwibnVsbF9wb2ludGVyX2lzX3ZhbGlkXCIsIFwib3BhcXVlXCIsIFwib3B0bm9uZVwiLCBcIm9wdHNpemVcIixcbiAgICBcInByZWFsbG9jYXRlZFwiLCBcInJlYWRub25lXCIsIFwicmVhZG9ubHlcIiwgXCJyZXR1cm5lZFwiLCBcInJldHVybnNfdHdpY2VcIiwgXCJzYW5pdGl6ZV9hZGRyZXNzXCIsIFwic2FuaXRpemVfaHdhZGRyZXNzXCIsIFwic2FuaXRpemVfbWVtb3J5XCIsXG4gICAgXCJzYW5pdGl6ZV90aHJlYWRcIiwgXCJzaWduZXh0XCIsIFwic3BlY3VsYXRhYmxlXCIsIFwic3JldFwiLCBcInNzcFwiLCBcInNzcHJlcVwiLCBcInNzcHN0cm9uZ1wiLCBcInN3aWZ0YXN5bmNcIiwgXCJzd2lmdHNlbGZcIiwgXCJzd2lmdGVycm9yXCIsIFwidXd0YWJsZVwiLFxuICAgIFwid2lsbHJldHVyblwiLCBcIndyaXRlb25seVwiLCBcInplcm9leHRcIixcbiAgXSksXG4gIC4uLm1hcFdvcmRzKFwibG9vbS1sbHZtLWNvbnN0YW50XCIsIFtcInRydWVcIiwgXCJmYWxzZVwiLCBcIm51bGxcIiwgXCJub25lXCIsIFwidW5kZWZcIiwgXCJwb2lzb25cIiwgXCJ6ZXJvaW5pdGlhbGl6ZXJcIl0pLFxuXSk7XG5cbmNvbnN0IExMVk1fUFJJTUlUSVZFX1RZUEVTID0gbmV3IFNldChbXG4gIFwidm9pZFwiLCBcImxhYmVsXCIsIFwidG9rZW5cIiwgXCJtZXRhZGF0YVwiLCBcIng4Nl9tbXhcIiwgXCJ4ODZfYW14XCIsIFwiaGFsZlwiLCBcImJmbG9hdFwiLCBcImZsb2F0XCIsIFwiZG91YmxlXCIsIFwiZnAxMjhcIiwgXCJ4ODZfZnA4MFwiLCBcInBwY19mcDEyOFwiLCBcInB0clwiLFxuXSk7XG5cbmNvbnN0IFBVTkNUVUFUSU9OX0NMQVNTID0gXCJsb29tLWxsdm0tcHVuY3R1YXRpb25cIjtcblxuZXhwb3J0IGZ1bmN0aW9uIGhpZ2hsaWdodExsdm1FbGVtZW50KGNvZGVFbGVtZW50OiBIVE1MRWxlbWVudCwgc291cmNlOiBzdHJpbmcpOiB2b2lkIHtcbiAgY29kZUVsZW1lbnQuZW1wdHkoKTtcbiAgY29kZUVsZW1lbnQuYWRkQ2xhc3MoXCJsb29tLWxsdm0tY29kZVwiKTtcblxuICBjb25zdCBsaW5lcyA9IHNvdXJjZS5zcGxpdChcIlxcblwiKTtcbiAgbGluZXMuZm9yRWFjaCgobGluZSwgaW5kZXgpID0+IHtcbiAgICBhcHBlbmRIaWdobGlnaHRlZExpbmUoY29kZUVsZW1lbnQsIGxpbmUpO1xuICAgIGlmIChpbmRleCA8IGxpbmVzLmxlbmd0aCAtIDEpIHtcbiAgICAgIGNvZGVFbGVtZW50LmFwcGVuZFRleHQoXCJcXG5cIik7XG4gICAgfVxuICB9KTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGFkZExsdm1EZWNvcmF0aW9ucyhcbiAgYnVpbGRlcjogUmFuZ2VTZXRCdWlsZGVyPERlY29yYXRpb24+LFxuICB2aWV3OiBFZGl0b3JWaWV3LFxuICBibG9jazogbG9vbUNvZGVCbG9jayxcbik6IHZvaWQge1xuICBjb25zdCBjb250ZW50TGluZUNvdW50ID0gZ2V0Q29udGVudExpbmVDb3VudChibG9jayk7XG4gIGlmICghY29udGVudExpbmVDb3VudCkge1xuICAgIHJldHVybjtcbiAgfVxuXG4gIGNvbnN0IGxpbmVzID0gYmxvY2suY29udGVudC5zcGxpdChcIlxcblwiKTtcbiAgZm9yIChsZXQgaW5kZXggPSAwOyBpbmRleCA8IGNvbnRlbnRMaW5lQ291bnQ7IGluZGV4ICs9IDEpIHtcbiAgICBjb25zdCBsaW5lID0gbGluZXNbaW5kZXhdID8/IFwiXCI7XG4gICAgY29uc3QgdG9rZW5zID0gdG9rZW5pemVMbHZtTGluZShsaW5lKTtcbiAgICBpZiAoIXRva2Vucy5sZW5ndGgpIHtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cblxuICAgIGNvbnN0IGRvY0xpbmUgPSB2aWV3LnN0YXRlLmRvYy5saW5lKGJsb2NrLnN0YXJ0TGluZSArIDIgKyBpbmRleCk7XG4gICAgZm9yIChjb25zdCB0b2tlbiBvZiB0b2tlbnMpIHtcbiAgICAgIGlmICh0b2tlbi5mcm9tID09PSB0b2tlbi50bykge1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIGJ1aWxkZXIuYWRkKFxuICAgICAgICBkb2NMaW5lLmZyb20gKyB0b2tlbi5mcm9tLFxuICAgICAgICBkb2NMaW5lLmZyb20gKyB0b2tlbi50byxcbiAgICAgICAgRGVjb3JhdGlvbi5tYXJrKHsgY2xhc3M6IHRva2VuLmNsYXNzTmFtZSB9KSxcbiAgICAgICk7XG4gICAgfVxuICB9XG59XG5cbmZ1bmN0aW9uIGFwcGVuZEhpZ2hsaWdodGVkTGluZShjb250YWluZXI6IEhUTUxFbGVtZW50LCBsaW5lOiBzdHJpbmcpOiB2b2lkIHtcbiAgbGV0IGN1cnNvciA9IDA7XG5cbiAgZm9yIChjb25zdCB0b2tlbiBvZiB0b2tlbml6ZUxsdm1MaW5lKGxpbmUpKSB7XG4gICAgaWYgKHRva2VuLmZyb20gPiBjdXJzb3IpIHtcbiAgICAgIGNvbnRhaW5lci5hcHBlbmRUZXh0KGxpbmUuc2xpY2UoY3Vyc29yLCB0b2tlbi5mcm9tKSk7XG4gICAgfVxuXG4gICAgY29uc3Qgc3BhbiA9IGNvbnRhaW5lci5jcmVhdGVTcGFuKHsgY2xzOiB0b2tlbi5jbGFzc05hbWUgfSk7XG4gICAgc3Bhbi5zZXRUZXh0KGxpbmUuc2xpY2UodG9rZW4uZnJvbSwgdG9rZW4udG8pKTtcbiAgICBjdXJzb3IgPSB0b2tlbi50bztcbiAgfVxuXG4gIGlmIChjdXJzb3IgPCBsaW5lLmxlbmd0aCkge1xuICAgIGNvbnRhaW5lci5hcHBlbmRUZXh0KGxpbmUuc2xpY2UoY3Vyc29yKSk7XG4gIH1cbn1cblxuZnVuY3Rpb24gdG9rZW5pemVMbHZtTGluZShsaW5lOiBzdHJpbmcpOiBMbHZtVG9rZW5bXSB7XG4gIGNvbnN0IHRva2VuczogTGx2bVRva2VuW10gPSBbXTtcbiAgbGV0IGluZGV4ID0gMDtcblxuICBhZGRMYWJlbFRva2VuKGxpbmUsIHRva2Vucyk7XG5cbiAgd2hpbGUgKGluZGV4IDwgbGluZS5sZW5ndGgpIHtcbiAgICBjb25zdCBjdXJyZW50ID0gbGluZVtpbmRleF07XG4gICAgaWYgKGN1cnJlbnQgPT09IFwiO1wiKSB7XG4gICAgICB0b2tlbnMucHVzaCh7IGZyb206IGluZGV4LCB0bzogbGluZS5sZW5ndGgsIGNsYXNzTmFtZTogXCJsb29tLWxsdm0tY29tbWVudFwiIH0pO1xuICAgICAgYnJlYWs7XG4gICAgfVxuXG4gICAgaWYgKC9cXHMvLnRlc3QoY3VycmVudCkpIHtcbiAgICAgIGluZGV4ICs9IDE7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICBjb25zdCBzdHJpbmdUb2tlbiA9IHJlYWRTdHJpbmdUb2tlbihsaW5lLCBpbmRleCk7XG4gICAgaWYgKHN0cmluZ1Rva2VuKSB7XG4gICAgICBpZiAoc3RyaW5nVG9rZW4ucHJlZml4RW5kID4gaW5kZXgpIHtcbiAgICAgICAgdG9rZW5zLnB1c2goeyBmcm9tOiBpbmRleCwgdG86IHN0cmluZ1Rva2VuLnByZWZpeEVuZCwgY2xhc3NOYW1lOiBcImxvb20tbGx2bS1zdHJpbmctcHJlZml4XCIgfSk7XG4gICAgICB9XG4gICAgICB0b2tlbnMucHVzaCh7IGZyb206IHN0cmluZ1Rva2VuLnZhbHVlU3RhcnQsIHRvOiBzdHJpbmdUb2tlbi52YWx1ZUVuZCwgY2xhc3NOYW1lOiBcImxvb20tbGx2bS1zdHJpbmdcIiB9KTtcbiAgICAgIGluZGV4ID0gc3RyaW5nVG9rZW4udmFsdWVFbmQ7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICBjb25zdCBtYXRjaGVkID1cbiAgICAgIG1hdGNoUmVnZXhUb2tlbihsaW5lLCBpbmRleCwgL0BsbHZtXFwuW0EtWmEteiQuXzAtOV0rL3ksIFwibG9vbS1sbHZtLWludHJpbnNpY1wiLCB0b2tlbnMpIHx8XG4gICAgICBtYXRjaFJlZ2V4VG9rZW4obGluZSwgaW5kZXgsIC9AW0EtWmEteiQuXy1dW0EtWmEteiQuXzAtOS1dKnxAXFxkK1xcYi95LCBcImxvb20tbGx2bS1nbG9iYWxcIiwgdG9rZW5zKSB8fFxuICAgICAgbWF0Y2hSZWdleFRva2VuKGxpbmUsIGluZGV4LCAvJVtBLVphLXokLl8tXVtBLVphLXokLl8wLTktXSp8JVxcZCtcXGIveSwgXCJsb29tLWxsdm0tbG9jYWxcIiwgdG9rZW5zKSB8fFxuICAgICAgbWF0Y2hSZWdleFRva2VuKGxpbmUsIGluZGV4LCAvIVtBLVphLXokLl8tXVtBLVphLXokLl8wLTktXSp8IVxcZCtcXGIveSwgXCJsb29tLWxsdm0tbWV0YWRhdGFcIiwgdG9rZW5zKSB8fFxuICAgICAgbWF0Y2hSZWdleFRva2VuKGxpbmUsIGluZGV4LCAvXFwkW0EtWmEteiQuXy1dW0EtWmEteiQuXzAtOS1dKi95LCBcImxvb20tbGx2bS1jb21kYXRcIiwgdG9rZW5zKSB8fFxuICAgICAgbWF0Y2hSZWdleFRva2VuKGxpbmUsIGluZGV4LCAvI1xcZCtcXGIveSwgXCJsb29tLWxsdm0tYXR0cmlidXRlLWdyb3VwXCIsIHRva2VucykgfHxcbiAgICAgIG1hdGNoUmVnZXhUb2tlbihsaW5lLCBpbmRleCwgL1xcYmFkZHJzcGFjZVxccypcXChcXHMqXFxkK1xccypcXCkveSwgXCJsb29tLWxsdm0tdHlwZVwiLCB0b2tlbnMpIHx8XG4gICAgICBtYXRjaFJlZ2V4VG9rZW4obGluZSwgaW5kZXgsIC9bLStdPzB4WzAtOUEtRmEtZl0rXFxiL3ksIFwibG9vbS1sbHZtLW51bWJlclwiLCB0b2tlbnMpIHx8XG4gICAgICBtYXRjaFJlZ2V4VG9rZW4obGluZSwgaW5kZXgsIC9bLStdPyg/OlxcZCtcXC5cXGQqfFxcLlxcZCt8XFxkKykoPzpbZUVdWy0rXT9cXGQrKVxcYi95LCBcImxvb20tbGx2bS1udW1iZXJcIiwgdG9rZW5zKSB8fFxuICAgICAgbWF0Y2hSZWdleFRva2VuKGxpbmUsIGluZGV4LCAvWy0rXT8oPzpcXGQrXFwuXFxkKnxcXC5cXGQrKVxcYi95LCBcImxvb20tbGx2bS1udW1iZXJcIiwgdG9rZW5zKSB8fFxuICAgICAgbWF0Y2hSZWdleFRva2VuKGxpbmUsIGluZGV4LCAvWy0rXT9cXGQrXFxiL3ksIFwibG9vbS1sbHZtLW51bWJlclwiLCB0b2tlbnMpIHx8XG4gICAgICBtYXRjaFJlZ2V4VG9rZW4obGluZSwgaW5kZXgsIC9cXC5cXC5cXC4veSwgXCJsb29tLWxsdm0tcHVuY3R1YXRpb25cIiwgdG9rZW5zKTtcblxuICAgIGlmIChtYXRjaGVkKSB7XG4gICAgICBpbmRleCA9IG1hdGNoZWQ7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICBjb25zdCB3b3JkID0gcmVhZFdvcmQobGluZSwgaW5kZXgpO1xuICAgIGlmICh3b3JkKSB7XG4gICAgICB0b2tlbnMucHVzaCh7XG4gICAgICAgIGZyb206IGluZGV4LFxuICAgICAgICB0bzogd29yZC5lbmQsXG4gICAgICAgIGNsYXNzTmFtZTogY2xhc3NpZnlXb3JkKHdvcmQudmFsdWUpLFxuICAgICAgfSk7XG4gICAgICBpbmRleCA9IHdvcmQuZW5kO1xuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgaWYgKFwiKClbXXt9PD4sOj0qXCIuaW5jbHVkZXMoY3VycmVudCkpIHtcbiAgICAgIHRva2Vucy5wdXNoKHsgZnJvbTogaW5kZXgsIHRvOiBpbmRleCArIDEsIGNsYXNzTmFtZTogUFVOQ1RVQVRJT05fQ0xBU1MgfSk7XG4gICAgICBpbmRleCArPSAxO1xuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgaW5kZXggKz0gMTtcbiAgfVxuXG4gIHJldHVybiBub3JtYWxpemVUb2tlbnModG9rZW5zKTtcbn1cblxuZnVuY3Rpb24gYWRkTGFiZWxUb2tlbihsaW5lOiBzdHJpbmcsIHRva2VuczogTGx2bVRva2VuW10pOiB2b2lkIHtcbiAgY29uc3QgbWF0Y2ggPSBsaW5lLm1hdGNoKC9eKFxccyopKD86KFtBLVphLXokLl8tXVtBLVphLXokLl8wLTktXSp8XFxkKyl8KCVbQS1aYS16JC5fLV1bQS1aYS16JC5fMC05LV0qfCVcXGQrKSkoOikvKTtcbiAgaWYgKCFtYXRjaCB8fCBtYXRjaC5pbmRleCA9PSBudWxsKSB7XG4gICAgcmV0dXJuO1xuICB9XG5cbiAgY29uc3QgbGFiZWxTdGFydCA9IG1hdGNoWzFdLmxlbmd0aDtcbiAgY29uc3QgbGFiZWxUZXh0ID0gbWF0Y2hbMl0gPz8gbWF0Y2hbM107XG4gIGlmICghbGFiZWxUZXh0KSB7XG4gICAgcmV0dXJuO1xuICB9XG5cbiAgdG9rZW5zLnB1c2goe1xuICAgIGZyb206IGxhYmVsU3RhcnQsXG4gICAgdG86IGxhYmVsU3RhcnQgKyBsYWJlbFRleHQubGVuZ3RoLFxuICAgIGNsYXNzTmFtZTogXCJsb29tLWxsdm0tbGFiZWxcIixcbiAgfSk7XG4gIHRva2Vucy5wdXNoKHtcbiAgICBmcm9tOiBsYWJlbFN0YXJ0ICsgbGFiZWxUZXh0Lmxlbmd0aCxcbiAgICB0bzogbGFiZWxTdGFydCArIGxhYmVsVGV4dC5sZW5ndGggKyAxLFxuICAgIGNsYXNzTmFtZTogUFVOQ1RVQVRJT05fQ0xBU1MsXG4gIH0pO1xufVxuXG5mdW5jdGlvbiBjbGFzc2lmeVdvcmQod29yZDogc3RyaW5nKTogc3RyaW5nIHtcbiAgaWYgKC9eaVxcZCskLy50ZXN0KHdvcmQpIHx8IExMVk1fUFJJTUlUSVZFX1RZUEVTLmhhcyh3b3JkKSkge1xuICAgIHJldHVybiBcImxvb20tbGx2bS10eXBlXCI7XG4gIH1cblxuICByZXR1cm4gTExWTV9LRVlXT1JEUy5nZXQod29yZCkgPz8gXCJsb29tLWxsdm0tcGxhaW5cIjtcbn1cblxuZnVuY3Rpb24gcmVhZFdvcmQobGluZTogc3RyaW5nLCBpbmRleDogbnVtYmVyKTogeyB2YWx1ZTogc3RyaW5nOyBlbmQ6IG51bWJlciB9IHwgbnVsbCB7XG4gIGNvbnN0IG1hdGNoID0gL1tBLVphLXpfXVtBLVphLXowLTlfLi1dKi95O1xuICBtYXRjaC5sYXN0SW5kZXggPSBpbmRleDtcbiAgY29uc3QgcmVzdWx0ID0gbWF0Y2guZXhlYyhsaW5lKTtcbiAgaWYgKCFyZXN1bHQpIHtcbiAgICByZXR1cm4gbnVsbDtcbiAgfVxuXG4gIHJldHVybiB7XG4gICAgdmFsdWU6IHJlc3VsdFswXSxcbiAgICBlbmQ6IG1hdGNoLmxhc3RJbmRleCxcbiAgfTtcbn1cblxuZnVuY3Rpb24gcmVhZFN0cmluZ1Rva2VuKGxpbmU6IHN0cmluZywgaW5kZXg6IG51bWJlcik6IHsgcHJlZml4RW5kOiBudW1iZXI7IHZhbHVlU3RhcnQ6IG51bWJlcjsgdmFsdWVFbmQ6IG51bWJlciB9IHwgbnVsbCB7XG4gIGxldCBjdXJzb3IgPSBpbmRleDtcbiAgaWYgKGxpbmVbY3Vyc29yXSA9PT0gXCJjXCIgJiYgbGluZVtjdXJzb3IgKyAxXSA9PT0gXCJcXFwiXCIpIHtcbiAgICBjdXJzb3IgKz0gMTtcbiAgfVxuXG4gIGlmIChsaW5lW2N1cnNvcl0gIT09IFwiXFxcIlwiKSB7XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cblxuICBjb25zdCB2YWx1ZVN0YXJ0ID0gY3Vyc29yO1xuICBjdXJzb3IgKz0gMTtcbiAgd2hpbGUgKGN1cnNvciA8IGxpbmUubGVuZ3RoKSB7XG4gICAgaWYgKGxpbmVbY3Vyc29yXSA9PT0gXCJcXFxcXCIpIHtcbiAgICAgIGN1cnNvciArPSAyO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChsaW5lW2N1cnNvcl0gPT09IFwiXFxcIlwiKSB7XG4gICAgICBjdXJzb3IgKz0gMTtcbiAgICAgIGJyZWFrO1xuICAgIH1cbiAgICBjdXJzb3IgKz0gMTtcbiAgfVxuXG4gIHJldHVybiB7XG4gICAgcHJlZml4RW5kOiB2YWx1ZVN0YXJ0LFxuICAgIHZhbHVlU3RhcnQsXG4gICAgdmFsdWVFbmQ6IGN1cnNvcixcbiAgfTtcbn1cblxuZnVuY3Rpb24gbWF0Y2hSZWdleFRva2VuKFxuICBsaW5lOiBzdHJpbmcsXG4gIGluZGV4OiBudW1iZXIsXG4gIHJlZ2V4OiBSZWdFeHAsXG4gIGNsYXNzTmFtZTogc3RyaW5nLFxuICB0b2tlbnM6IExsdm1Ub2tlbltdLFxuKTogbnVtYmVyIHwgbnVsbCB7XG4gIHJlZ2V4Lmxhc3RJbmRleCA9IGluZGV4O1xuICBjb25zdCBtYXRjaCA9IHJlZ2V4LmV4ZWMobGluZSk7XG4gIGlmICghbWF0Y2gpIHtcbiAgICByZXR1cm4gbnVsbDtcbiAgfVxuXG4gIHRva2Vucy5wdXNoKHsgZnJvbTogaW5kZXgsIHRvOiByZWdleC5sYXN0SW5kZXgsIGNsYXNzTmFtZSB9KTtcbiAgcmV0dXJuIHJlZ2V4Lmxhc3RJbmRleDtcbn1cblxuZnVuY3Rpb24gbm9ybWFsaXplVG9rZW5zKHRva2VuczogTGx2bVRva2VuW10pOiBMbHZtVG9rZW5bXSB7XG4gIHRva2Vucy5zb3J0KChsZWZ0LCByaWdodCkgPT4gbGVmdC5mcm9tIC0gcmlnaHQuZnJvbSB8fCBsZWZ0LnRvIC0gcmlnaHQudG8pO1xuICBjb25zdCBub3JtYWxpemVkOiBMbHZtVG9rZW5bXSA9IFtdO1xuICBsZXQgY3Vyc29yID0gMDtcblxuICBmb3IgKGNvbnN0IHRva2VuIG9mIHRva2Vucykge1xuICAgIGlmICh0b2tlbi50byA8PSBjdXJzb3IpIHtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cblxuICAgIGNvbnN0IGZyb20gPSBNYXRoLm1heCh0b2tlbi5mcm9tLCBjdXJzb3IpO1xuICAgIG5vcm1hbGl6ZWQucHVzaCh7IC4uLnRva2VuLCBmcm9tIH0pO1xuICAgIGN1cnNvciA9IHRva2VuLnRvO1xuICB9XG5cbiAgcmV0dXJuIG5vcm1hbGl6ZWQ7XG59XG5cbmZ1bmN0aW9uIGdldENvbnRlbnRMaW5lQ291bnQoYmxvY2s6IGxvb21Db2RlQmxvY2spOiBudW1iZXIge1xuICBpZiAoYmxvY2suZW5kTGluZSA9PT0gYmxvY2suc3RhcnRMaW5lKSB7XG4gICAgcmV0dXJuIDA7XG4gIH1cblxuICBpZiAoYmxvY2suY29udGVudC5sZW5ndGggPT09IDApIHtcbiAgICByZXR1cm4gYmxvY2suZW5kTGluZSA+IGJsb2NrLnN0YXJ0TGluZSArIDEgPyAxIDogMDtcbiAgfVxuXG4gIHJldHVybiBibG9jay5jb250ZW50LnNwbGl0KFwiXFxuXCIpLmxlbmd0aDtcbn1cblxuZnVuY3Rpb24gbWFwV29yZHMoY2xhc3NOYW1lOiBzdHJpbmcsIHdvcmRzOiBzdHJpbmdbXSk6IEFycmF5PFtzdHJpbmcsIHN0cmluZ10+IHtcbiAgcmV0dXJuIHdvcmRzLm1hcCgod29yZCkgPT4gW3dvcmQsIGNsYXNzTmFtZV0pO1xufVxuIiwgImltcG9ydCB7IGNyZWF0ZUhhc2ggfSBmcm9tIFwiY3J5cHRvXCI7XG5cbmV4cG9ydCBmdW5jdGlvbiBzaG9ydEhhc2goaW5wdXQ6IHN0cmluZyk6IHN0cmluZyB7XG4gIHJldHVybiBjcmVhdGVIYXNoKFwic2hhMjU2XCIpLnVwZGF0ZShpbnB1dCkuZGlnZXN0KFwiaGV4XCIpLnNsaWNlKDAsIDE2KTtcbn1cbiIsICJpbXBvcnQgeyBzaG9ydEhhc2ggfSBmcm9tIFwiLi91dGlscy9oYXNoXCI7XG5pbXBvcnQgdHlwZSB7IGxvb21Db2RlQmxvY2ssIGxvb21Ob3JtYWxpemVkTGFuZ3VhZ2UsIGxvb21QbHVnaW5TZXR0aW5ncywgbG9vbVNvdXJjZVJlZmVyZW5jZSB9IGZyb20gXCIuL3R5cGVzXCI7XG5cbmNvbnN0IExBTkdVQUdFX0FMSUFTRVM6IFJlY29yZDxzdHJpbmcsIGxvb21Ob3JtYWxpemVkTGFuZ3VhZ2U+ID0ge1xuICBweXRob246IFwicHl0aG9uXCIsXG4gIHB5OiBcInB5dGhvblwiLFxuICBqYXZhc2NyaXB0OiBcImphdmFzY3JpcHRcIixcbiAganM6IFwiamF2YXNjcmlwdFwiLFxuICB0eXBlc2NyaXB0OiBcInR5cGVzY3JpcHRcIixcbiAgdHM6IFwidHlwZXNjcmlwdFwiLFxuICBvY2FtbDogXCJvY2FtbFwiLFxuICBtbDogXCJvY2FtbFwiLFxuICBjOiBcImNcIixcbiAgaDogXCJjXCIsXG4gIGNwcDogXCJjcHBcIixcbiAgY3h4OiBcImNwcFwiLFxuICBjYzogXCJjcHBcIixcbiAgXCJjKytcIjogXCJjcHBcIixcbiAgc2hlbGw6IFwic2hlbGxcIixcbiAgc2g6IFwic2hlbGxcIixcbiAgYmFzaDogXCJzaGVsbFwiLFxuICB6c2g6IFwic2hlbGxcIixcbiAgcnVieTogXCJydWJ5XCIsXG4gIHJiOiBcInJ1YnlcIixcbiAgcGVybDogXCJwZXJsXCIsXG4gIHBsOiBcInBlcmxcIixcbiAgbHVhOiBcImx1YVwiLFxuICBwaHA6IFwicGhwXCIsXG4gIGdvOiBcImdvXCIsXG4gIGdvbGFuZzogXCJnb1wiLFxuICBydXN0OiBcInJ1c3RcIixcbiAgcnM6IFwicnVzdFwiLFxuICBoYXNrZWxsOiBcImhhc2tlbGxcIixcbiAgaHM6IFwiaGFza2VsbFwiLFxuICBqYXZhOiBcImphdmFcIixcbiAgbGx2bTogXCJsbHZtLWlyXCIsXG4gIGxsdm1pcjogXCJsbHZtLWlyXCIsXG4gIFwibGx2bS1pclwiOiBcImxsdm0taXJcIixcbiAgbGw6IFwibGx2bS1pclwiLFxuICBsZWFuOiBcImxlYW5cIixcbiAgbGVhbjQ6IFwibGVhblwiLFxuICBjb3E6IFwiY29xXCIsXG4gIHY6IFwiY29xXCIsXG4gIHNtdDogXCJzbXRsaWJcIixcbiAgc210MjogXCJzbXRsaWJcIixcbiAgc210bGliOiBcInNtdGxpYlwiLFxuICBcInNtdC1saWJcIjogXCJzbXRsaWJcIixcbiAgejM6IFwic210bGliXCIsXG59O1xuXG5jb25zdCBPVVRQVVRfU1RBUlQgPSAvXjwhLS1cXHMqbG9vbTpvdXRwdXQ6c3RhcnRcXHMraWQ9KFthLWYwLTldKylcXHMqLS0+JC9pO1xuY29uc3QgT1VUUFVUX0VORCA9IC9ePCEtLVxccypsb29tOm91dHB1dDplbmRcXHMqLS0+JC9pO1xuY29uc3QgRkVOQ0VfU1RBUlQgPSAvXihgYGArfH5+fispXFxzKihbXlxcc2BdKik/KC4qKSQvO1xuXG5leHBvcnQgZnVuY3Rpb24gbm9ybWFsaXplTGFuZ3VhZ2UocmF3TGFuZ3VhZ2U6IHN0cmluZywgc2V0dGluZ3M/OiBsb29tUGx1Z2luU2V0dGluZ3MpOiBsb29tTm9ybWFsaXplZExhbmd1YWdlIHwgbnVsbCB7XG4gIGNvbnN0IG5vcm1hbGl6ZWQgPSByYXdMYW5ndWFnZS50cmltKCkudG9Mb3dlckNhc2UoKTtcblxuICBmb3IgKGNvbnN0IGxhbmd1YWdlIG9mIHNldHRpbmdzPy5jdXN0b21MYW5ndWFnZXMgPz8gW10pIHtcbiAgICBjb25zdCBuYW1lID0gbGFuZ3VhZ2UubmFtZS50cmltKCkudG9Mb3dlckNhc2UoKTtcbiAgICBjb25zdCBhbGlhc2VzID0gcGFyc2VBbGlhc0xpc3QobGFuZ3VhZ2UuYWxpYXNlcyk7XG4gICAgaWYgKG5hbWUgJiYgKG5hbWUgPT09IG5vcm1hbGl6ZWQgfHwgYWxpYXNlcy5pbmNsdWRlcyhub3JtYWxpemVkKSkpIHtcbiAgICAgIHJldHVybiBsYW5ndWFnZS5uYW1lLnRyaW0oKTtcbiAgICB9XG4gIH1cblxuICByZXR1cm4gTEFOR1VBR0VfQUxJQVNFU1tub3JtYWxpemVkXSA/PyBudWxsO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gZ2V0U3VwcG9ydGVkTGFuZ3VhZ2VBbGlhc2VzKHNldHRpbmdzPzogbG9vbVBsdWdpblNldHRpbmdzKTogc3RyaW5nW10ge1xuICByZXR1cm4gW1xuICAgIC4uLk9iamVjdC5rZXlzKExBTkdVQUdFX0FMSUFTRVMpLFxuICAgIC4uLihzZXR0aW5ncz8uY3VzdG9tTGFuZ3VhZ2VzID8/IFtdKS5mbGF0TWFwKChsYW5ndWFnZSkgPT4gW2xhbmd1YWdlLm5hbWUsIC4uLnBhcnNlQWxpYXNMaXN0KGxhbmd1YWdlLmFsaWFzZXMpXSksXG4gIF0ubWFwKChhbGlhcykgPT4gYWxpYXMudG9Mb3dlckNhc2UoKSk7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBwYXJzZU1hcmtkb3duQ29kZUJsb2NrcyhmaWxlUGF0aDogc3RyaW5nLCBzb3VyY2U6IHN0cmluZywgc2V0dGluZ3M/OiBsb29tUGx1Z2luU2V0dGluZ3MpOiBsb29tQ29kZUJsb2NrW10ge1xuICBjb25zdCBsaW5lcyA9IHNvdXJjZS5zcGxpdCgvXFxyP1xcbi8pO1xuICBjb25zdCBibG9ja3M6IGxvb21Db2RlQmxvY2tbXSA9IFtdO1xuICBsZXQgb3JkaW5hbCA9IDA7XG4gIGxldCBpbnNpZGVNYW5hZ2VkT3V0cHV0ID0gZmFsc2U7XG5cbiAgZm9yIChsZXQgaSA9IDA7IGkgPCBsaW5lcy5sZW5ndGg7IGkgKz0gMSkge1xuICAgIGNvbnN0IGxpbmUgPSBsaW5lc1tpXTtcblxuICAgIGlmIChpbnNpZGVNYW5hZ2VkT3V0cHV0KSB7XG4gICAgICBpZiAoT1VUUFVUX0VORC50ZXN0KGxpbmUudHJpbSgpKSkge1xuICAgICAgICBpbnNpZGVNYW5hZ2VkT3V0cHV0ID0gZmFsc2U7XG4gICAgICB9XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICBpZiAoT1VUUFVUX1NUQVJULnRlc3QobGluZS50cmltKCkpKSB7XG4gICAgICBpbnNpZGVNYW5hZ2VkT3V0cHV0ID0gdHJ1ZTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cblxuICAgIGNvbnN0IGZlbmNlTWF0Y2ggPSBsaW5lLm1hdGNoKEZFTkNFX1NUQVJUKTtcbiAgICBpZiAoIWZlbmNlTWF0Y2gpIHtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cblxuICAgIGNvbnN0IHN0YXJ0TGluZSA9IGk7XG4gICAgY29uc3QgZmVuY2VJbmRlbnQgPSBnZXRMZWFkaW5nV2hpdGVzcGFjZShsaW5lKTtcbiAgICBjb25zdCBmZW5jZVRva2VuID0gZmVuY2VNYXRjaFsxXTtcbiAgICBjb25zdCBzb3VyY2VMYW5ndWFnZSA9IChmZW5jZU1hdGNoWzJdID8/IFwiXCIpLnRyaW0oKTtcbiAgICBjb25zdCBzb3VyY2VSZWZlcmVuY2UgPSBwYXJzZVNvdXJjZVJlZmVyZW5jZShmZW5jZU1hdGNoWzNdID8/IFwiXCIpO1xuICAgIGNvbnN0IGxhbmd1YWdlID0gbm9ybWFsaXplTGFuZ3VhZ2Uoc291cmNlTGFuZ3VhZ2UsIHNldHRpbmdzKTtcblxuICAgIGxldCBlbmRMaW5lID0gaTtcbiAgICBjb25zdCBjb250ZW50TGluZXM6IHN0cmluZ1tdID0gW107XG5cbiAgICBmb3IgKGxldCBqID0gaSArIDE7IGogPCBsaW5lcy5sZW5ndGg7IGogKz0gMSkge1xuICAgICAgY29uc3QgaW5uZXJMaW5lID0gbGluZXNbal07XG4gICAgICBjb25zdCB0cmltbWVkID0gaW5uZXJMaW5lLnRyaW0oKTtcblxuICAgICAgaWYgKHRyaW1tZWQuc3RhcnRzV2l0aChmZW5jZVRva2VuKSAmJiAvXihgYGArfH5+fispXFxzKiQvLnRlc3QodHJpbW1lZCkpIHtcbiAgICAgICAgZW5kTGluZSA9IGo7XG4gICAgICAgIGkgPSBqO1xuICAgICAgICBicmVhaztcbiAgICAgIH1cblxuICAgICAgY29udGVudExpbmVzLnB1c2goc3RyaXBGZW5jZUluZGVudChpbm5lckxpbmUsIGZlbmNlSW5kZW50KSk7XG4gICAgICBlbmRMaW5lID0gajtcbiAgICB9XG5cbiAgICBpZiAoIWxhbmd1YWdlKSB7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICBvcmRpbmFsICs9IDE7XG4gICAgY29uc3QgY29udGVudCA9IGNvbnRlbnRMaW5lcy5qb2luKFwiXFxuXCIpO1xuICAgIGNvbnN0IHJlZmVyZW5jZUhhc2ggPSBzb3VyY2VSZWZlcmVuY2UgPyBgOiR7SlNPTi5zdHJpbmdpZnkoc291cmNlUmVmZXJlbmNlKX1gIDogXCJcIjtcbiAgICBjb25zdCBjb250ZW50SGFzaCA9IHNob3J0SGFzaChgJHtjb250ZW50fSR7cmVmZXJlbmNlSGFzaH1gKTtcbiAgICBjb25zdCBpZCA9IHNob3J0SGFzaChgJHtmaWxlUGF0aH06JHtvcmRpbmFsfToke2xhbmd1YWdlfToke2NvbnRlbnRIYXNofWApO1xuXG4gICAgYmxvY2tzLnB1c2goe1xuICAgICAgaWQsXG4gICAgICBvcmRpbmFsLFxuICAgICAgZmlsZVBhdGgsXG4gICAgICBsYW5ndWFnZSxcbiAgICAgIGxhbmd1YWdlQWxpYXM6IHNvdXJjZUxhbmd1YWdlLnRvTG93ZXJDYXNlKCksXG4gICAgICBzb3VyY2VMYW5ndWFnZSxcbiAgICAgIGNvbnRlbnQsXG4gICAgICBzb3VyY2VSZWZlcmVuY2UsXG4gICAgICBzdGFydExpbmUsXG4gICAgICBlbmRMaW5lLFxuICAgICAgZmVuY2VTdGFydDogMCxcbiAgICAgIGZlbmNlRW5kOiAwLFxuICAgIH0pO1xuICB9XG5cbiAgcmV0dXJuIGJsb2Nrcztcbn1cblxuZnVuY3Rpb24gcGFyc2VBbGlhc0xpc3QodmFsdWU6IHN0cmluZyk6IHN0cmluZ1tdIHtcbiAgcmV0dXJuIHZhbHVlXG4gICAgLnNwbGl0KFwiLFwiKVxuICAgIC5tYXAoKGFsaWFzKSA9PiBhbGlhcy50cmltKCkudG9Mb3dlckNhc2UoKSlcbiAgICAuZmlsdGVyKEJvb2xlYW4pO1xufVxuXG5mdW5jdGlvbiBwYXJzZVNvdXJjZVJlZmVyZW5jZShpbmZvVGFpbDogc3RyaW5nKTogbG9vbVNvdXJjZVJlZmVyZW5jZSB8IHVuZGVmaW5lZCB7XG4gIGNvbnN0IGF0dHJzID0gcGFyc2VJbmZvQXR0cmlidXRlcyhpbmZvVGFpbCk7XG4gIGNvbnN0IGZpbGVQYXRoID0gYXR0cnNbXCJsb29tLWZpbGVcIl0gPz8gYXR0cnMuZmlsZSA/PyBhdHRycy5zcmMgPz8gYXR0cnMuc291cmNlO1xuICBpZiAoIWZpbGVQYXRoKSB7XG4gICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgfVxuXG4gIGNvbnN0IGxpbmVzID0gYXR0cnNbXCJsb29tLWxpbmVzXCJdID8/IGF0dHJzLmxpbmVzID8/IGF0dHJzLmxpbmU7XG4gIGNvbnN0IGxpbmVSYW5nZSA9IGxpbmVzID8gcGFyc2VMaW5lUmFuZ2UobGluZXMpIDogbnVsbDtcbiAgY29uc3Qgc3ltYm9sTmFtZSA9IGF0dHJzW1wibG9vbS1zeW1ib2xcIl0gPz8gYXR0cnMuc3ltYm9sID8/IGF0dHJzLmZuID8/IGF0dHJzLmZ1bmN0aW9uO1xuICBjb25zdCB0cmFjZVZhbHVlID0gYXR0cnNbXCJsb29tLWRlcHNcIl0gPz8gYXR0cnMuZGVwcyA/PyBhdHRycy50cmFjZTtcbiAgY29uc3QgY2FsbEV4cHJlc3Npb24gPSBhdHRyc1tcImxvb20tY2FsbFwiXSA/PyBhdHRycy5jYWxsO1xuICBjb25zdCBjYWxsQXJncyA9IGF0dHJzW1wibG9vbS1hcmdzXCJdID8/IGF0dHJzLmFyZ3M7XG4gIGNvbnN0IHByaW50VmFsdWUgPSBhdHRyc1tcImxvb20tcHJpbnRcIl0gPz8gYXR0cnMucHJpbnQ7XG4gIGNvbnN0IGNhbGwgPSBjYWxsRXhwcmVzc2lvbiAhPSBudWxsIHx8IGNhbGxBcmdzICE9IG51bGxcbiAgICA/IHtcbiAgICAgIGV4cHJlc3Npb246IG5vcm1hbGl6ZUJvb2xlYW5BdHRyaWJ1dGUoY2FsbEV4cHJlc3Npb24pID09PSBcInRydWVcIiA/IHVuZGVmaW5lZCA6IGNhbGxFeHByZXNzaW9uLFxuICAgICAgYXJnczogY2FsbEFyZ3MsXG4gICAgICBwcmludDogcHJpbnRWYWx1ZSA9PSBudWxsID8gdHJ1ZSA6ICFbXCIwXCIsIFwiZmFsc2VcIiwgXCJub1wiLCBcIm9mZlwiXS5pbmNsdWRlcyhwcmludFZhbHVlLnRvTG93ZXJDYXNlKCkpLFxuICAgIH1cbiAgICA6IHVuZGVmaW5lZDtcblxuICByZXR1cm4ge1xuICAgIGZpbGVQYXRoLFxuICAgIGxpbmVTdGFydDogbGluZVJhbmdlPy5zdGFydCxcbiAgICBsaW5lRW5kOiBsaW5lUmFuZ2U/LmVuZCxcbiAgICBzeW1ib2xOYW1lLFxuICAgIHRyYWNlRGVwZW5kZW5jaWVzOiB0cmFjZVZhbHVlID09IG51bGwgPyB0cnVlIDogIVtcIjBcIiwgXCJmYWxzZVwiLCBcIm5vXCIsIFwib2ZmXCJdLmluY2x1ZGVzKHRyYWNlVmFsdWUudG9Mb3dlckNhc2UoKSksXG4gICAgY2FsbCxcbiAgfTtcbn1cblxuZnVuY3Rpb24gbm9ybWFsaXplQm9vbGVhbkF0dHJpYnV0ZSh2YWx1ZTogc3RyaW5nIHwgdW5kZWZpbmVkKTogc3RyaW5nIHwgdW5kZWZpbmVkIHtcbiAgcmV0dXJuIHZhbHVlID09IG51bGwgPyB1bmRlZmluZWQgOiB2YWx1ZS50cmltKCkudG9Mb3dlckNhc2UoKTtcbn1cblxuZnVuY3Rpb24gcGFyc2VJbmZvQXR0cmlidXRlcyhpbnB1dDogc3RyaW5nKTogUmVjb3JkPHN0cmluZywgc3RyaW5nPiB7XG4gIGNvbnN0IGF0dHJzOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+ID0ge307XG4gIGNvbnN0IHBhdHRlcm4gPSAvKFtBLVphLXowLTlfLV0rKVxccyo9XFxzKig/OlwiKFteXCJdKilcInwnKFteJ10qKSd8KFteXFxzXSspKS9nO1xuICBsZXQgbWF0Y2g6IFJlZ0V4cEV4ZWNBcnJheSB8IG51bGw7XG4gIHdoaWxlICgobWF0Y2ggPSBwYXR0ZXJuLmV4ZWMoaW5wdXQpKSAhPSBudWxsKSB7XG4gICAgYXR0cnNbbWF0Y2hbMV0udG9Mb3dlckNhc2UoKV0gPSBtYXRjaFsyXSA/PyBtYXRjaFszXSA/PyBtYXRjaFs0XSA/PyBcIlwiO1xuICB9XG4gIHJldHVybiBhdHRycztcbn1cblxuZnVuY3Rpb24gcGFyc2VMaW5lUmFuZ2UodmFsdWU6IHN0cmluZyk6IHsgc3RhcnQ6IG51bWJlcjsgZW5kOiBudW1iZXIgfSB8IG51bGwge1xuICBjb25zdCBtYXRjaCA9IHZhbHVlLnRyaW0oKS5tYXRjaCgvXkw/KFxcZCspKD86XFxzKlstOl1cXHMqTD8oXFxkKykpPyQvaSk7XG4gIGlmICghbWF0Y2gpIHtcbiAgICByZXR1cm4gbnVsbDtcbiAgfVxuICBjb25zdCBzdGFydCA9IE51bWJlci5wYXJzZUludChtYXRjaFsxXSwgMTApO1xuICBjb25zdCBlbmQgPSBOdW1iZXIucGFyc2VJbnQobWF0Y2hbMl0gPz8gbWF0Y2hbMV0sIDEwKTtcbiAgaWYgKCFOdW1iZXIuaXNJbnRlZ2VyKHN0YXJ0KSB8fCAhTnVtYmVyLmlzSW50ZWdlcihlbmQpIHx8IHN0YXJ0IDw9IDAgfHwgZW5kIDwgc3RhcnQpIHtcbiAgICByZXR1cm4gbnVsbDtcbiAgfVxuICByZXR1cm4geyBzdGFydCwgZW5kIH07XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBmaW5kQmxvY2tBdExpbmUoYmxvY2tzOiBsb29tQ29kZUJsb2NrW10sIGxpbmU6IG51bWJlcik6IGxvb21Db2RlQmxvY2sgfCBudWxsIHtcbiAgcmV0dXJuIGJsb2Nrcy5maW5kKChibG9jaykgPT4gbGluZSA+PSBibG9jay5zdGFydExpbmUgJiYgbGluZSA8PSBibG9jay5lbmRMaW5lKSA/PyBudWxsO1xufVxuXG5mdW5jdGlvbiBnZXRMZWFkaW5nV2hpdGVzcGFjZShsaW5lOiBzdHJpbmcpOiBzdHJpbmcge1xuICBjb25zdCBtYXRjaCA9IGxpbmUubWF0Y2goL15bXFx0IF0qLyk7XG4gIHJldHVybiBtYXRjaD8uWzBdID8/IFwiXCI7XG59XG5cbmZ1bmN0aW9uIHN0cmlwRmVuY2VJbmRlbnQobGluZTogc3RyaW5nLCBmZW5jZUluZGVudDogc3RyaW5nKTogc3RyaW5nIHtcbiAgaWYgKCFmZW5jZUluZGVudCkge1xuICAgIHJldHVybiBsaW5lO1xuICB9XG5cbiAgbGV0IGluZGV4ID0gMDtcbiAgd2hpbGUgKGluZGV4IDwgZmVuY2VJbmRlbnQubGVuZ3RoICYmIGluZGV4IDwgbGluZS5sZW5ndGggJiYgbGluZVtpbmRleF0gPT09IGZlbmNlSW5kZW50W2luZGV4XSkge1xuICAgIGluZGV4ICs9IDE7XG4gIH1cblxuICByZXR1cm4gbGluZS5zbGljZShpbmRleCk7XG59XG4iLCAiaW1wb3J0IHR5cGUgeyBsb29tTm9ybWFsaXplZExhbmd1YWdlIH0gZnJvbSBcIi4vdHlwZXNcIjtcblxuZXhwb3J0IGludGVyZmFjZSBsb29tTGFuZ3VhZ2VDYXBhYmlsaXR5IHtcbiAgbGFuZ3VhZ2U6IGxvb21Ob3JtYWxpemVkTGFuZ3VhZ2U7XG4gIHN5bWJvbEV4dHJhY3Rpb246IFwiYXN0XCIgfCBcInRvcC1sZXZlbFwiIHwgXCJnZW5lcmljXCIgfCBcImV4dGVybmFsXCI7XG4gIGRlcGVuZGVuY3lUcmFjaW5nOiBcImFzdFwiIHwgXCJ0b3AtbGV2ZWxcIiB8IFwiZ2VuZXJpY1wiIHwgXCJleHRlcm5hbFwiO1xuICBjYWxsSGFybmVzczogXCJidWlsdC1pblwiIHwgXCJyYXdcIiB8IFwiZXh0ZXJuYWxcIjtcbiAgc291cmNlUHJldmlldzogYm9vbGVhbjtcbn1cblxuY29uc3QgQlVJTFRfSU5fQ0FQQUJJTElUSUVTOiBSZWNvcmQ8c3RyaW5nLCBsb29tTGFuZ3VhZ2VDYXBhYmlsaXR5PiA9IHtcbiAgcHl0aG9uOiB7XG4gICAgbGFuZ3VhZ2U6IFwicHl0aG9uXCIsXG4gICAgc3ltYm9sRXh0cmFjdGlvbjogXCJhc3RcIixcbiAgICBkZXBlbmRlbmN5VHJhY2luZzogXCJhc3RcIixcbiAgICBjYWxsSGFybmVzczogXCJidWlsdC1pblwiLFxuICAgIHNvdXJjZVByZXZpZXc6IHRydWUsXG4gIH0sXG4gIGphdmFzY3JpcHQ6IHtcbiAgICBsYW5ndWFnZTogXCJqYXZhc2NyaXB0XCIsXG4gICAgc3ltYm9sRXh0cmFjdGlvbjogXCJ0b3AtbGV2ZWxcIixcbiAgICBkZXBlbmRlbmN5VHJhY2luZzogXCJ0b3AtbGV2ZWxcIixcbiAgICBjYWxsSGFybmVzczogXCJidWlsdC1pblwiLFxuICAgIHNvdXJjZVByZXZpZXc6IHRydWUsXG4gIH0sXG4gIHR5cGVzY3JpcHQ6IHtcbiAgICBsYW5ndWFnZTogXCJ0eXBlc2NyaXB0XCIsXG4gICAgc3ltYm9sRXh0cmFjdGlvbjogXCJ0b3AtbGV2ZWxcIixcbiAgICBkZXBlbmRlbmN5VHJhY2luZzogXCJ0b3AtbGV2ZWxcIixcbiAgICBjYWxsSGFybmVzczogXCJidWlsdC1pblwiLFxuICAgIHNvdXJjZVByZXZpZXc6IHRydWUsXG4gIH0sXG4gIGM6IHtcbiAgICBsYW5ndWFnZTogXCJjXCIsXG4gICAgc3ltYm9sRXh0cmFjdGlvbjogXCJ0b3AtbGV2ZWxcIixcbiAgICBkZXBlbmRlbmN5VHJhY2luZzogXCJ0b3AtbGV2ZWxcIixcbiAgICBjYWxsSGFybmVzczogXCJidWlsdC1pblwiLFxuICAgIHNvdXJjZVByZXZpZXc6IHRydWUsXG4gIH0sXG4gIGNwcDoge1xuICAgIGxhbmd1YWdlOiBcImNwcFwiLFxuICAgIHN5bWJvbEV4dHJhY3Rpb246IFwidG9wLWxldmVsXCIsXG4gICAgZGVwZW5kZW5jeVRyYWNpbmc6IFwidG9wLWxldmVsXCIsXG4gICAgY2FsbEhhcm5lc3M6IFwiYnVpbHQtaW5cIixcbiAgICBzb3VyY2VQcmV2aWV3OiB0cnVlLFxuICB9LFxuICBcImxsdm0taXJcIjoge1xuICAgIGxhbmd1YWdlOiBcImxsdm0taXJcIixcbiAgICBzeW1ib2xFeHRyYWN0aW9uOiBcInRvcC1sZXZlbFwiLFxuICAgIGRlcGVuZGVuY3lUcmFjaW5nOiBcInRvcC1sZXZlbFwiLFxuICAgIGNhbGxIYXJuZXNzOiBcInJhd1wiLFxuICAgIHNvdXJjZVByZXZpZXc6IHRydWUsXG4gIH0sXG4gIGhhc2tlbGw6IHtcbiAgICBsYW5ndWFnZTogXCJoYXNrZWxsXCIsXG4gICAgc3ltYm9sRXh0cmFjdGlvbjogXCJ0b3AtbGV2ZWxcIixcbiAgICBkZXBlbmRlbmN5VHJhY2luZzogXCJ0b3AtbGV2ZWxcIixcbiAgICBjYWxsSGFybmVzczogXCJyYXdcIixcbiAgICBzb3VyY2VQcmV2aWV3OiB0cnVlLFxuICB9LFxuICBvY2FtbDoge1xuICAgIGxhbmd1YWdlOiBcIm9jYW1sXCIsXG4gICAgc3ltYm9sRXh0cmFjdGlvbjogXCJ0b3AtbGV2ZWxcIixcbiAgICBkZXBlbmRlbmN5VHJhY2luZzogXCJ0b3AtbGV2ZWxcIixcbiAgICBjYWxsSGFybmVzczogXCJidWlsdC1pblwiLFxuICAgIHNvdXJjZVByZXZpZXc6IHRydWUsXG4gIH0sXG4gIGphdmE6IHtcbiAgICBsYW5ndWFnZTogXCJqYXZhXCIsXG4gICAgc3ltYm9sRXh0cmFjdGlvbjogXCJ0b3AtbGV2ZWxcIixcbiAgICBkZXBlbmRlbmN5VHJhY2luZzogXCJ0b3AtbGV2ZWxcIixcbiAgICBjYWxsSGFybmVzczogXCJyYXdcIixcbiAgICBzb3VyY2VQcmV2aWV3OiB0cnVlLFxuICB9LFxufTtcblxuZXhwb3J0IGZ1bmN0aW9uIGdldExhbmd1YWdlQ2FwYWJpbGl0eShsYW5ndWFnZTogbG9vbU5vcm1hbGl6ZWRMYW5ndWFnZSwgaGFzRXh0ZXJuYWxFeHRyYWN0b3IgPSBmYWxzZSk6IGxvb21MYW5ndWFnZUNhcGFiaWxpdHkge1xuICBpZiAoaGFzRXh0ZXJuYWxFeHRyYWN0b3IpIHtcbiAgICByZXR1cm4ge1xuICAgICAgbGFuZ3VhZ2UsXG4gICAgICBzeW1ib2xFeHRyYWN0aW9uOiBcImV4dGVybmFsXCIsXG4gICAgICBkZXBlbmRlbmN5VHJhY2luZzogXCJleHRlcm5hbFwiLFxuICAgICAgY2FsbEhhcm5lc3M6IFwiZXh0ZXJuYWxcIixcbiAgICAgIHNvdXJjZVByZXZpZXc6IHRydWUsXG4gICAgfTtcbiAgfVxuXG4gIHJldHVybiBCVUlMVF9JTl9DQVBBQklMSVRJRVNbbGFuZ3VhZ2VdID8/IHtcbiAgICBsYW5ndWFnZSxcbiAgICBzeW1ib2xFeHRyYWN0aW9uOiBcImdlbmVyaWNcIixcbiAgICBkZXBlbmRlbmN5VHJhY2luZzogXCJnZW5lcmljXCIsXG4gICAgY2FsbEhhcm5lc3M6IFwicmF3XCIsXG4gICAgc291cmNlUHJldmlldzogdHJ1ZSxcbiAgfTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGdldEJ1aWx0SW5MYW5ndWFnZUNhcGFiaWxpdGllcygpOiBsb29tTGFuZ3VhZ2VDYXBhYmlsaXR5W10ge1xuICByZXR1cm4gT2JqZWN0LnZhbHVlcyhCVUlMVF9JTl9DQVBBQklMSVRJRVMpO1xufVxuIiwgImltcG9ydCB7IHJ1blRlbXBGaWxlUHJvY2VzcyB9IGZyb20gXCIuLi9leGVjdXRpb24vcHJvY2Vzc1J1bm5lclwiO1xuaW1wb3J0IHR5cGUgeyBsb29tQ29kZUJsb2NrLCBsb29tUGx1Z2luU2V0dGluZ3MsIGxvb21SdW5Db250ZXh0LCBsb29tUnVuUmVzdWx0LCBsb29tUnVubmVyIH0gZnJvbSBcIi4uL3R5cGVzXCI7XG5cbmV4cG9ydCBjbGFzcyBOb2RlUnVubmVyIGltcGxlbWVudHMgbG9vbVJ1bm5lciB7XG4gIGlkID0gXCJub2RlXCI7XG4gIGRpc3BsYXlOYW1lID0gXCJOb2RlLmpzXCI7XG4gIGxhbmd1YWdlcyA9IFtcImphdmFzY3JpcHRcIiwgXCJ0eXBlc2NyaXB0XCJdIGFzIGNvbnN0O1xuXG4gIGNhblJ1bihibG9jazogbG9vbUNvZGVCbG9jaywgc2V0dGluZ3M6IGxvb21QbHVnaW5TZXR0aW5ncyk6IGJvb2xlYW4ge1xuICAgIGlmIChibG9jay5sYW5ndWFnZSA9PT0gXCJqYXZhc2NyaXB0XCIpIHtcbiAgICAgIHJldHVybiBCb29sZWFuKHNldHRpbmdzLm5vZGVFeGVjdXRhYmxlLnRyaW0oKSk7XG4gICAgfVxuXG4gICAgcmV0dXJuIEJvb2xlYW4oc2V0dGluZ3MudHlwZXNjcmlwdFRyYW5zcGlsZXJFeGVjdXRhYmxlLnRyaW0oKSk7XG4gIH1cblxuICBhc3luYyBydW4oYmxvY2s6IGxvb21Db2RlQmxvY2ssIGNvbnRleHQ6IGxvb21SdW5Db250ZXh0LCBzZXR0aW5nczogbG9vbVBsdWdpblNldHRpbmdzKTogUHJvbWlzZTxsb29tUnVuUmVzdWx0PiB7XG4gICAgaWYgKGJsb2NrLmxhbmd1YWdlID09PSBcImphdmFzY3JpcHRcIikge1xuICAgICAgcmV0dXJuIHJ1blRlbXBGaWxlUHJvY2Vzcyh7XG4gICAgICAgIHJ1bm5lcklkOiB0aGlzLmlkLFxuICAgICAgICBydW5uZXJOYW1lOiB0aGlzLmRpc3BsYXlOYW1lLFxuICAgICAgICBleGVjdXRhYmxlOiBzZXR0aW5ncy5ub2RlRXhlY3V0YWJsZS50cmltKCksXG4gICAgICAgIGFyZ3M6IFtcIntmaWxlfVwiXSxcbiAgICAgICAgZmlsZUV4dGVuc2lvbjogXCIuanNcIixcbiAgICAgICAgc291cmNlOiBibG9jay5jb250ZW50LFxuICAgICAgICB3b3JraW5nRGlyZWN0b3J5OiBjb250ZXh0LndvcmtpbmdEaXJlY3RvcnksXG4gICAgICAgIHRpbWVvdXRNczogY29udGV4dC50aW1lb3V0TXMsXG4gICAgICAgIHNpZ25hbDogY29udGV4dC5zaWduYWwsXG4gICAgICB9KTtcbiAgICB9XG5cbiAgICBjb25zdCBleGVjdXRhYmxlID0gc2V0dGluZ3MudHlwZXNjcmlwdFRyYW5zcGlsZXJFeGVjdXRhYmxlLnRyaW0oKTtcbiAgICBjb25zdCBydW5uZXJOYW1lID0gc2V0dGluZ3MudHlwZXNjcmlwdE1vZGUgPT09IFwidHN4XCIgPyBcIlR5cGVTY3JpcHQgKHRzeClcIiA6IFwiVHlwZVNjcmlwdCAodHMtbm9kZSlcIjtcblxuICAgIHJldHVybiBydW5UZW1wRmlsZVByb2Nlc3Moe1xuICAgICAgcnVubmVySWQ6IGAke3RoaXMuaWR9OiR7c2V0dGluZ3MudHlwZXNjcmlwdE1vZGV9YCxcbiAgICAgIHJ1bm5lck5hbWUsXG4gICAgICBleGVjdXRhYmxlLFxuICAgICAgYXJnczogW1wie2ZpbGV9XCJdLFxuICAgICAgZmlsZUV4dGVuc2lvbjogXCIudHNcIixcbiAgICAgIHNvdXJjZTogYmxvY2suY29udGVudCxcbiAgICAgIHdvcmtpbmdEaXJlY3Rvcnk6IGNvbnRleHQud29ya2luZ0RpcmVjdG9yeSxcbiAgICAgIHRpbWVvdXRNczogY29udGV4dC50aW1lb3V0TXMsXG4gICAgICBzaWduYWw6IGNvbnRleHQuc2lnbmFsLFxuICAgIH0pO1xuICB9XG59XG4iLCAiaW1wb3J0IHsgcnVuVGVtcEZpbGVQcm9jZXNzIH0gZnJvbSBcIi4uL2V4ZWN1dGlvbi9wcm9jZXNzUnVubmVyXCI7XG5pbXBvcnQgeyBzcGxpdENvbW1hbmRMaW5lIH0gZnJvbSBcIi4uL3V0aWxzL2NvbW1hbmRcIjtcbmltcG9ydCB0eXBlIHsgbG9vbUNvZGVCbG9jaywgbG9vbUN1c3RvbUxhbmd1YWdlLCBsb29tUGx1Z2luU2V0dGluZ3MsIGxvb21SdW5Db250ZXh0LCBsb29tUnVuUmVzdWx0LCBsb29tUnVubmVyIH0gZnJvbSBcIi4uL3R5cGVzXCI7XG5cbmV4cG9ydCBjbGFzcyBDdXN0b21MYW5ndWFnZVJ1bm5lciBpbXBsZW1lbnRzIGxvb21SdW5uZXIge1xuICBpZCA9IFwiY3VzdG9tXCI7XG4gIGRpc3BsYXlOYW1lID0gXCJDdXN0b20gbGFuZ3VhZ2VcIjtcbiAgbGFuZ3VhZ2VzID0gW10gYXMgY29uc3Q7XG5cbiAgY2FuUnVuKGJsb2NrOiBsb29tQ29kZUJsb2NrLCBzZXR0aW5nczogbG9vbVBsdWdpblNldHRpbmdzKTogYm9vbGVhbiB7XG4gICAgcmV0dXJuIEJvb2xlYW4odGhpcy5nZXRDdXN0b21MYW5ndWFnZShibG9jaywgc2V0dGluZ3MpPy5leGVjdXRhYmxlLnRyaW0oKSk7XG4gIH1cblxuICBydW4oYmxvY2s6IGxvb21Db2RlQmxvY2ssIGNvbnRleHQ6IGxvb21SdW5Db250ZXh0LCBzZXR0aW5nczogbG9vbVBsdWdpblNldHRpbmdzKTogUHJvbWlzZTxsb29tUnVuUmVzdWx0PiB7XG4gICAgY29uc3QgbGFuZ3VhZ2UgPSB0aGlzLmdldEN1c3RvbUxhbmd1YWdlKGJsb2NrLCBzZXR0aW5ncyk7XG4gICAgaWYgKCFsYW5ndWFnZSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBVbnN1cHBvcnRlZCBjdXN0b20gbGFuZ3VhZ2U6ICR7YmxvY2subGFuZ3VhZ2V9YCk7XG4gICAgfVxuXG4gICAgcmV0dXJuIHJ1blRlbXBGaWxlUHJvY2Vzcyh7XG4gICAgICBydW5uZXJJZDogYCR7dGhpcy5pZH06JHtsYW5ndWFnZS5uYW1lfWAsXG4gICAgICBydW5uZXJOYW1lOiBsYW5ndWFnZS5uYW1lLFxuICAgICAgZXhlY3V0YWJsZTogbGFuZ3VhZ2UuZXhlY3V0YWJsZS50cmltKCksXG4gICAgICBhcmdzOiBzcGxpdENvbW1hbmRMaW5lKGxhbmd1YWdlLmFyZ3MgfHwgXCJ7ZmlsZX1cIiksXG4gICAgICBmaWxlRXh0ZW5zaW9uOiBub3JtYWxpemVFeHRlbnNpb24obGFuZ3VhZ2UuZXh0ZW5zaW9uLCBsYW5ndWFnZS5uYW1lKSxcbiAgICAgIHNvdXJjZTogYmxvY2suY29udGVudCxcbiAgICAgIHdvcmtpbmdEaXJlY3Rvcnk6IGNvbnRleHQud29ya2luZ0RpcmVjdG9yeSxcbiAgICAgIHRpbWVvdXRNczogY29udGV4dC50aW1lb3V0TXMsXG4gICAgICBzaWduYWw6IGNvbnRleHQuc2lnbmFsLFxuICAgIH0pO1xuICB9XG5cbiAgcHJpdmF0ZSBnZXRDdXN0b21MYW5ndWFnZShibG9jazogbG9vbUNvZGVCbG9jaywgc2V0dGluZ3M6IGxvb21QbHVnaW5TZXR0aW5ncyk6IGxvb21DdXN0b21MYW5ndWFnZSB8IHVuZGVmaW5lZCB7XG4gICAgY29uc3Qgbm9ybWFsaXplZCA9IGJsb2NrLmxhbmd1YWdlLnRyaW0oKS50b0xvd2VyQ2FzZSgpO1xuICAgIHJldHVybiBzZXR0aW5ncy5jdXN0b21MYW5ndWFnZXMuZmluZCgobGFuZ3VhZ2UpID0+IHtcbiAgICAgIGNvbnN0IG5hbWUgPSBsYW5ndWFnZS5uYW1lLnRyaW0oKS50b0xvd2VyQ2FzZSgpO1xuICAgICAgY29uc3QgYWxpYXNlcyA9IGxhbmd1YWdlLmFsaWFzZXNcbiAgICAgICAgLnNwbGl0KFwiLFwiKVxuICAgICAgICAubWFwKChhbGlhcykgPT4gYWxpYXMudHJpbSgpLnRvTG93ZXJDYXNlKCkpXG4gICAgICAgIC5maWx0ZXIoQm9vbGVhbik7XG4gICAgICByZXR1cm4gbmFtZSA9PT0gbm9ybWFsaXplZCB8fCBhbGlhc2VzLmluY2x1ZGVzKG5vcm1hbGl6ZWQpO1xuICAgIH0pO1xuICB9XG59XG5cbmZ1bmN0aW9uIG5vcm1hbGl6ZUV4dGVuc2lvbihleHRlbnNpb246IHN0cmluZywgbmFtZTogc3RyaW5nKTogc3RyaW5nIHtcbiAgY29uc3QgdHJpbW1lZCA9IGV4dGVuc2lvbi50cmltKCk7XG4gIGlmICghdHJpbW1lZCkge1xuICAgIHJldHVybiBgLiR7bmFtZX1gO1xuICB9XG4gIHJldHVybiB0cmltbWVkLnN0YXJ0c1dpdGgoXCIuXCIpID8gdHJpbW1lZCA6IGAuJHt0cmltbWVkfWA7XG59XG4iLCAiaW1wb3J0IHsgcnVuVGVtcEZpbGVQcm9jZXNzIH0gZnJvbSBcIi4uL2V4ZWN1dGlvbi9wcm9jZXNzUnVubmVyXCI7XG5pbXBvcnQgdHlwZSB7IGxvb21Db2RlQmxvY2ssIGxvb21Ob3JtYWxpemVkTGFuZ3VhZ2UsIGxvb21QbHVnaW5TZXR0aW5ncywgbG9vbVJ1bkNvbnRleHQsIGxvb21SdW5SZXN1bHQsIGxvb21SdW5uZXIgfSBmcm9tIFwiLi4vdHlwZXNcIjtcblxuaW50ZXJmYWNlIEludGVycHJldGVkU3BlYyB7XG4gIGxhbmd1YWdlOiBsb29tTm9ybWFsaXplZExhbmd1YWdlO1xuICBkaXNwbGF5TmFtZTogc3RyaW5nO1xuICBleGVjdXRhYmxlOiAoc2V0dGluZ3M6IGxvb21QbHVnaW5TZXR0aW5ncykgPT4gc3RyaW5nO1xuICBmaWxlRXh0ZW5zaW9uOiBzdHJpbmc7XG4gIGFyZ3M/OiBzdHJpbmdbXTtcbiAgZW52PzogTm9kZUpTLlByb2Nlc3NFbnY7XG4gIG1pbmltdW1UaW1lb3V0TXM/OiBudW1iZXI7XG59XG5cbmNvbnN0IElOVEVSUFJFVEVEX1NQRUNTOiBJbnRlcnByZXRlZFNwZWNbXSA9IFtcbiAge1xuICAgIGxhbmd1YWdlOiBcInNoZWxsXCIsXG4gICAgZGlzcGxheU5hbWU6IFwiU2hlbGxcIixcbiAgICBleGVjdXRhYmxlOiAoc2V0dGluZ3MpID0+IHNldHRpbmdzLnNoZWxsRXhlY3V0YWJsZSxcbiAgICBmaWxlRXh0ZW5zaW9uOiBcIi5zaFwiLFxuICB9LFxuICB7XG4gICAgbGFuZ3VhZ2U6IFwicnVieVwiLFxuICAgIGRpc3BsYXlOYW1lOiBcIlJ1YnlcIixcbiAgICBleGVjdXRhYmxlOiAoc2V0dGluZ3MpID0+IHNldHRpbmdzLnJ1YnlFeGVjdXRhYmxlLFxuICAgIGZpbGVFeHRlbnNpb246IFwiLnJiXCIsXG4gIH0sXG4gIHtcbiAgICBsYW5ndWFnZTogXCJwZXJsXCIsXG4gICAgZGlzcGxheU5hbWU6IFwiUGVybFwiLFxuICAgIGV4ZWN1dGFibGU6IChzZXR0aW5ncykgPT4gc2V0dGluZ3MucGVybEV4ZWN1dGFibGUsXG4gICAgZmlsZUV4dGVuc2lvbjogXCIucGxcIixcbiAgfSxcbiAge1xuICAgIGxhbmd1YWdlOiBcImx1YVwiLFxuICAgIGRpc3BsYXlOYW1lOiBcIkx1YVwiLFxuICAgIGV4ZWN1dGFibGU6IChzZXR0aW5ncykgPT4gc2V0dGluZ3MubHVhRXhlY3V0YWJsZSxcbiAgICBmaWxlRXh0ZW5zaW9uOiBcIi5sdWFcIixcbiAgfSxcbiAge1xuICAgIGxhbmd1YWdlOiBcInBocFwiLFxuICAgIGRpc3BsYXlOYW1lOiBcIlBIUFwiLFxuICAgIGV4ZWN1dGFibGU6IChzZXR0aW5ncykgPT4gc2V0dGluZ3MucGhwRXhlY3V0YWJsZSxcbiAgICBmaWxlRXh0ZW5zaW9uOiBcIi5waHBcIixcbiAgfSxcbiAge1xuICAgIGxhbmd1YWdlOiBcImdvXCIsXG4gICAgZGlzcGxheU5hbWU6IFwiR29cIixcbiAgICBleGVjdXRhYmxlOiAoc2V0dGluZ3MpID0+IHNldHRpbmdzLmdvRXhlY3V0YWJsZSxcbiAgICBmaWxlRXh0ZW5zaW9uOiBcIi5nb1wiLFxuICAgIGFyZ3M6IFtcInJ1blwiLCBcIntmaWxlfVwiXSxcbiAgICBlbnY6IHtcbiAgICAgIEdPQ0FDSEU6IFwie3RlbXBEaXJ9L2dvY2FjaGVcIixcbiAgICB9LFxuICAgIG1pbmltdW1UaW1lb3V0TXM6IDMwXzAwMCxcbiAgfSxcbiAge1xuICAgIGxhbmd1YWdlOiBcImhhc2tlbGxcIixcbiAgICBkaXNwbGF5TmFtZTogXCJIYXNrZWxsXCIsXG4gICAgZXhlY3V0YWJsZTogKHNldHRpbmdzKSA9PiBzZXR0aW5ncy5oYXNrZWxsRXhlY3V0YWJsZSxcbiAgICBmaWxlRXh0ZW5zaW9uOiBcIi5oc1wiLFxuICAgIG1pbmltdW1UaW1lb3V0TXM6IDMwXzAwMCxcbiAgfSxcbl07XG5cbmV4cG9ydCBjbGFzcyBJbnRlcnByZXRlZFJ1bm5lciBpbXBsZW1lbnRzIGxvb21SdW5uZXIge1xuICBpZCA9IFwiaW50ZXJwcmV0ZWRcIjtcbiAgZGlzcGxheU5hbWUgPSBcIkludGVycHJldGVkXCI7XG4gIGxhbmd1YWdlcyA9IElOVEVSUFJFVEVEX1NQRUNTLm1hcCgoc3BlYykgPT4gc3BlYy5sYW5ndWFnZSk7XG5cbiAgY2FuUnVuKGJsb2NrOiBsb29tQ29kZUJsb2NrLCBzZXR0aW5nczogbG9vbVBsdWdpblNldHRpbmdzKTogYm9vbGVhbiB7XG4gICAgY29uc3Qgc3BlYyA9IHRoaXMuZ2V0U3BlYyhibG9jay5sYW5ndWFnZSk7XG4gICAgcmV0dXJuIEJvb2xlYW4oc3BlYz8uZXhlY3V0YWJsZShzZXR0aW5ncykudHJpbSgpKTtcbiAgfVxuXG4gIHJ1bihibG9jazogbG9vbUNvZGVCbG9jaywgY29udGV4dDogbG9vbVJ1bkNvbnRleHQsIHNldHRpbmdzOiBsb29tUGx1Z2luU2V0dGluZ3MpOiBQcm9taXNlPGxvb21SdW5SZXN1bHQ+IHtcbiAgICBjb25zdCBzcGVjID0gdGhpcy5nZXRTcGVjKGJsb2NrLmxhbmd1YWdlKTtcbiAgICBpZiAoIXNwZWMpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgVW5zdXBwb3J0ZWQgbGFuZ3VhZ2U6ICR7YmxvY2subGFuZ3VhZ2V9YCk7XG4gICAgfVxuXG4gICAgcmV0dXJuIHJ1blRlbXBGaWxlUHJvY2Vzcyh7XG4gICAgICBydW5uZXJJZDogYCR7dGhpcy5pZH06JHtibG9jay5sYW5ndWFnZX1gLFxuICAgICAgcnVubmVyTmFtZTogc3BlYy5kaXNwbGF5TmFtZSxcbiAgICAgIGV4ZWN1dGFibGU6IHNwZWMuZXhlY3V0YWJsZShzZXR0aW5ncykudHJpbSgpLFxuICAgICAgYXJnczogc3BlYy5hcmdzID8/IFtcIntmaWxlfVwiXSxcbiAgICAgIGZpbGVFeHRlbnNpb246IHNwZWMuZmlsZUV4dGVuc2lvbixcbiAgICAgIHNvdXJjZTogYmxvY2suY29udGVudCxcbiAgICAgIHdvcmtpbmdEaXJlY3Rvcnk6IGNvbnRleHQud29ya2luZ0RpcmVjdG9yeSxcbiAgICAgIHRpbWVvdXRNczogTWF0aC5tYXgoY29udGV4dC50aW1lb3V0TXMsIHNwZWMubWluaW11bVRpbWVvdXRNcyA/PyAwKSxcbiAgICAgIHNpZ25hbDogY29udGV4dC5zaWduYWwsXG4gICAgICBlbnY6IHNwZWMuZW52LFxuICAgIH0pO1xuICB9XG5cbiAgcHJpdmF0ZSBnZXRTcGVjKGxhbmd1YWdlOiBsb29tTm9ybWFsaXplZExhbmd1YWdlKTogSW50ZXJwcmV0ZWRTcGVjIHwgdW5kZWZpbmVkIHtcbiAgICByZXR1cm4gSU5URVJQUkVURURfU1BFQ1MuZmluZCgoc3BlYykgPT4gc3BlYy5sYW5ndWFnZSA9PT0gbGFuZ3VhZ2UpO1xuICB9XG59XG4iLCAiaW1wb3J0IHsgcnVuVGVtcEZpbGVQcm9jZXNzIH0gZnJvbSBcIi4uL2V4ZWN1dGlvbi9wcm9jZXNzUnVubmVyXCI7XG5pbXBvcnQgdHlwZSB7IGxvb21Db2RlQmxvY2ssIGxvb21QbHVnaW5TZXR0aW5ncywgbG9vbVJ1bkNvbnRleHQsIGxvb21SdW5SZXN1bHQsIGxvb21SdW5uZXIgfSBmcm9tIFwiLi4vdHlwZXNcIjtcblxuZXhwb3J0IGNsYXNzIExsdm1SdW5uZXIgaW1wbGVtZW50cyBsb29tUnVubmVyIHtcbiAgaWQgPSBcImxsdm0taXJcIjtcbiAgZGlzcGxheU5hbWUgPSBcIkxMVk0gSVJcIjtcbiAgbGFuZ3VhZ2VzID0gW1wibGx2bS1pclwiXSBhcyBjb25zdDtcblxuICBjYW5SdW4oYmxvY2s6IGxvb21Db2RlQmxvY2ssIHNldHRpbmdzOiBsb29tUGx1Z2luU2V0dGluZ3MpOiBib29sZWFuIHtcbiAgICByZXR1cm4gYmxvY2subGFuZ3VhZ2UgPT09IFwibGx2bS1pclwiICYmIEJvb2xlYW4oc2V0dGluZ3MubGx2bUludGVycHJldGVyRXhlY3V0YWJsZS50cmltKCkpO1xuICB9XG5cbiAgYXN5bmMgcnVuKGJsb2NrOiBsb29tQ29kZUJsb2NrLCBjb250ZXh0OiBsb29tUnVuQ29udGV4dCwgc2V0dGluZ3M6IGxvb21QbHVnaW5TZXR0aW5ncyk6IFByb21pc2U8bG9vbVJ1blJlc3VsdD4ge1xuICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHJ1blRlbXBGaWxlUHJvY2Vzcyh7XG4gICAgICBydW5uZXJJZDogdGhpcy5pZCxcbiAgICAgIHJ1bm5lck5hbWU6IHRoaXMuZGlzcGxheU5hbWUsXG4gICAgICBleGVjdXRhYmxlOiBzZXR0aW5ncy5sbHZtSW50ZXJwcmV0ZXJFeGVjdXRhYmxlLnRyaW0oKSxcbiAgICAgIGFyZ3M6IFtcIntmaWxlfVwiXSxcbiAgICAgIGZpbGVFeHRlbnNpb246IFwiLmxsXCIsXG4gICAgICBzb3VyY2U6IGJsb2NrLmNvbnRlbnQsXG4gICAgICB3b3JraW5nRGlyZWN0b3J5OiBjb250ZXh0LndvcmtpbmdEaXJlY3RvcnksXG4gICAgICB0aW1lb3V0TXM6IE1hdGgubWF4KGNvbnRleHQudGltZW91dE1zLCAzMF8wMDApLFxuICAgICAgc2lnbmFsOiBjb250ZXh0LnNpZ25hbCxcbiAgICB9KTtcblxuICAgIGlmICghcmVzdWx0LnRpbWVkT3V0ICYmICFyZXN1bHQuY2FuY2VsbGVkICYmIHJlc3VsdC5leGl0Q29kZSAhPSBudWxsICYmICFyZXN1bHQuc3RkZXJyLnRyaW0oKSkge1xuICAgICAgaWYgKHJlc3VsdC5leGl0Q29kZSAhPT0gMCkge1xuICAgICAgICByZXN1bHQuc3VjY2VzcyA9IHRydWU7XG4gICAgICAgIHJlc3VsdC53YXJuaW5nID0gYFByb2dyYW0gcmV0dXJuZWQgaTMyICR7cmVzdWx0LmV4aXRDb2RlfS4gVW5kZXIgbGxpLCB0aGF0IGJlY29tZXMgdGhlIHByb2Nlc3MgZXhpdCBzdGF0dXMuYDtcbiAgICAgIH1cblxuICAgICAgaWYgKCFyZXN1bHQuc3Rkb3V0LnRyaW0oKSkge1xuICAgICAgICByZXN1bHQuc3Rkb3V0ID0gcmVzdWx0LmV4aXRDb2RlID09PSAwXG4gICAgICAgICAgPyBcIkxMVk0gcHJvZ3JhbSBleGl0ZWQgd2l0aCBjb2RlIDAuXCJcbiAgICAgICAgICA6IGBMTFZNIHByb2dyYW0gcmV0dXJuZWQgaTMyICR7cmVzdWx0LmV4aXRDb2RlfS5cXG5Vc2Ugc3Rkb3V0IGluIHRoZSBJUiBpdHNlbGYgaWYgeW91IHdhbnQgcHJpbnRhYmxlIHByb2dyYW0gb3V0cHV0LmA7XG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIHJlc3VsdDtcbiAgfVxufVxuIiwgImltcG9ydCB7IGpvaW4gfSBmcm9tIFwicGF0aFwiO1xuaW1wb3J0IHsgcnVuUHJvY2Vzcywgd2l0aE5hbWVkVGVtcFNvdXJjZUZpbGUsIHdpdGhUZW1wU291cmNlRmlsZSB9IGZyb20gXCIuLi9leGVjdXRpb24vcHJvY2Vzc1J1bm5lclwiO1xuaW1wb3J0IHR5cGUgeyBsb29tQ29kZUJsb2NrLCBsb29tUGx1Z2luU2V0dGluZ3MsIGxvb21SdW5Db250ZXh0LCBsb29tUnVuUmVzdWx0LCBsb29tUnVubmVyIH0gZnJvbSBcIi4uL3R5cGVzXCI7XG5cbmV4cG9ydCBjbGFzcyBNYW5hZ2VkQ29tcGlsZWRSdW5uZXIgaW1wbGVtZW50cyBsb29tUnVubmVyIHtcbiAgaWQgPSBcIm1hbmFnZWQtY29tcGlsZWRcIjtcbiAgZGlzcGxheU5hbWUgPSBcIk1hbmFnZWQgY29tcGlsZXJcIjtcbiAgbGFuZ3VhZ2VzID0gW1wicnVzdFwiLCBcImphdmFcIl0gYXMgY29uc3Q7XG5cbiAgY2FuUnVuKGJsb2NrOiBsb29tQ29kZUJsb2NrLCBzZXR0aW5nczogbG9vbVBsdWdpblNldHRpbmdzKTogYm9vbGVhbiB7XG4gICAgaWYgKGJsb2NrLmxhbmd1YWdlID09PSBcInJ1c3RcIikge1xuICAgICAgcmV0dXJuIEJvb2xlYW4oc2V0dGluZ3MucnVzdEV4ZWN1dGFibGUudHJpbSgpKTtcbiAgICB9XG5cbiAgICBpZiAoYmxvY2subGFuZ3VhZ2UgPT09IFwiamF2YVwiKSB7XG4gICAgICByZXR1cm4gQm9vbGVhbihzZXR0aW5ncy5qYXZhRXhlY3V0YWJsZS50cmltKCkpO1xuICAgIH1cblxuICAgIHJldHVybiBmYWxzZTtcbiAgfVxuXG4gIGFzeW5jIHJ1bihibG9jazogbG9vbUNvZGVCbG9jaywgY29udGV4dDogbG9vbVJ1bkNvbnRleHQsIHNldHRpbmdzOiBsb29tUGx1Z2luU2V0dGluZ3MpOiBQcm9taXNlPGxvb21SdW5SZXN1bHQ+IHtcbiAgICBpZiAoYmxvY2subGFuZ3VhZ2UgPT09IFwicnVzdFwiKSB7XG4gICAgICByZXR1cm4gdGhpcy5ydW5SdXN0KGJsb2NrLCBjb250ZXh0LCBzZXR0aW5ncyk7XG4gICAgfVxuXG4gICAgaWYgKGJsb2NrLmxhbmd1YWdlID09PSBcImphdmFcIikge1xuICAgICAgcmV0dXJuIHRoaXMucnVuSmF2YShibG9jaywgY29udGV4dCwgc2V0dGluZ3MpO1xuICAgIH1cblxuICAgIHRocm93IG5ldyBFcnJvcihgVW5zdXBwb3J0ZWQgbGFuZ3VhZ2U6ICR7YmxvY2subGFuZ3VhZ2V9YCk7XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIHJ1blJ1c3QoYmxvY2s6IGxvb21Db2RlQmxvY2ssIGNvbnRleHQ6IGxvb21SdW5Db250ZXh0LCBzZXR0aW5nczogbG9vbVBsdWdpblNldHRpbmdzKTogUHJvbWlzZTxsb29tUnVuUmVzdWx0PiB7XG4gICAgcmV0dXJuIHdpdGhUZW1wU291cmNlRmlsZShcIi5yc1wiLCBibG9jay5jb250ZW50LCBhc3luYyAoeyB0ZW1wRGlyLCB0ZW1wRmlsZSB9KSA9PiB7XG4gICAgICBjb25zdCBiaW5hcnlQYXRoID0gam9pbih0ZW1wRGlyLCBcInNuaXBwZXQub3V0XCIpO1xuICAgICAgY29uc3QgY29tcGlsZVJlc3VsdCA9IGF3YWl0IHJ1blByb2Nlc3Moe1xuICAgICAgICBydW5uZXJJZDogYCR7dGhpcy5pZH06cnVzdDpjb21waWxlYCxcbiAgICAgICAgcnVubmVyTmFtZTogXCJSdXN0XCIsXG4gICAgICAgIGV4ZWN1dGFibGU6IHNldHRpbmdzLnJ1c3RFeGVjdXRhYmxlLnRyaW0oKSxcbiAgICAgICAgYXJnczogW3RlbXBGaWxlLCBcIi1vXCIsIGJpbmFyeVBhdGhdLFxuICAgICAgICB3b3JraW5nRGlyZWN0b3J5OiBjb250ZXh0LndvcmtpbmdEaXJlY3RvcnksXG4gICAgICAgIHRpbWVvdXRNczogTWF0aC5tYXgoY29udGV4dC50aW1lb3V0TXMsIDMwXzAwMCksXG4gICAgICAgIHNpZ25hbDogY29udGV4dC5zaWduYWwsXG4gICAgICB9KTtcblxuICAgICAgaWYgKCFjb21waWxlUmVzdWx0LnN1Y2Nlc3MpIHtcbiAgICAgICAgcmV0dXJuIGNvbXBpbGVSZXN1bHQ7XG4gICAgICB9XG5cbiAgICAgIHJldHVybiBydW5Qcm9jZXNzKHtcbiAgICAgICAgcnVubmVySWQ6IGAke3RoaXMuaWR9OnJ1c3Q6cnVuYCxcbiAgICAgICAgcnVubmVyTmFtZTogXCJSdXN0XCIsXG4gICAgICAgIGV4ZWN1dGFibGU6IGJpbmFyeVBhdGgsXG4gICAgICAgIGFyZ3M6IFtdLFxuICAgICAgICB3b3JraW5nRGlyZWN0b3J5OiBjb250ZXh0LndvcmtpbmdEaXJlY3RvcnksXG4gICAgICAgIHRpbWVvdXRNczogTWF0aC5tYXgoY29udGV4dC50aW1lb3V0TXMsIDMwXzAwMCksXG4gICAgICAgIHNpZ25hbDogY29udGV4dC5zaWduYWwsXG4gICAgICB9KTtcbiAgICB9KTtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgcnVuSmF2YShibG9jazogbG9vbUNvZGVCbG9jaywgY29udGV4dDogbG9vbVJ1bkNvbnRleHQsIHNldHRpbmdzOiBsb29tUGx1Z2luU2V0dGluZ3MpOiBQcm9taXNlPGxvb21SdW5SZXN1bHQ+IHtcbiAgICByZXR1cm4gd2l0aE5hbWVkVGVtcFNvdXJjZUZpbGUoXCJNYWluLmphdmFcIiwgYmxvY2suY29udGVudCwgYXN5bmMgKHsgdGVtcERpciwgdGVtcEZpbGUgfSkgPT4ge1xuICAgICAgaWYgKCFzZXR0aW5ncy5qYXZhQ29tcGlsZXJFeGVjdXRhYmxlLnRyaW0oKSkge1xuICAgICAgICByZXR1cm4gcnVuUHJvY2Vzcyh7XG4gICAgICAgICAgcnVubmVySWQ6IGAke3RoaXMuaWR9OmphdmE6c291cmNlYCxcbiAgICAgICAgICBydW5uZXJOYW1lOiBcIkphdmFcIixcbiAgICAgICAgICBleGVjdXRhYmxlOiBzZXR0aW5ncy5qYXZhRXhlY3V0YWJsZS50cmltKCksXG4gICAgICAgICAgYXJnczogW3RlbXBGaWxlXSxcbiAgICAgICAgICB3b3JraW5nRGlyZWN0b3J5OiBjb250ZXh0LndvcmtpbmdEaXJlY3RvcnksXG4gICAgICAgICAgdGltZW91dE1zOiBNYXRoLm1heChjb250ZXh0LnRpbWVvdXRNcywgMzBfMDAwKSxcbiAgICAgICAgICBzaWduYWw6IGNvbnRleHQuc2lnbmFsLFxuICAgICAgICB9KTtcbiAgICAgIH1cblxuICAgICAgY29uc3QgY29tcGlsZVJlc3VsdCA9IGF3YWl0IHJ1blByb2Nlc3Moe1xuICAgICAgICBydW5uZXJJZDogYCR7dGhpcy5pZH06amF2YTpjb21waWxlYCxcbiAgICAgICAgcnVubmVyTmFtZTogXCJKYXZhXCIsXG4gICAgICAgIGV4ZWN1dGFibGU6IHNldHRpbmdzLmphdmFDb21waWxlckV4ZWN1dGFibGUudHJpbSgpLFxuICAgICAgICBhcmdzOiBbdGVtcEZpbGVdLFxuICAgICAgICB3b3JraW5nRGlyZWN0b3J5OiB0ZW1wRGlyLFxuICAgICAgICB0aW1lb3V0TXM6IE1hdGgubWF4KGNvbnRleHQudGltZW91dE1zLCAzMF8wMDApLFxuICAgICAgICBzaWduYWw6IGNvbnRleHQuc2lnbmFsLFxuICAgICAgfSk7XG5cbiAgICAgIGlmICghY29tcGlsZVJlc3VsdC5zdWNjZXNzKSB7XG4gICAgICAgIHJldHVybiBjb21waWxlUmVzdWx0O1xuICAgICAgfVxuXG4gICAgICByZXR1cm4gcnVuUHJvY2Vzcyh7XG4gICAgICAgIHJ1bm5lcklkOiBgJHt0aGlzLmlkfTpqYXZhOnJ1bmAsXG4gICAgICAgIHJ1bm5lck5hbWU6IFwiSmF2YVwiLFxuICAgICAgICBleGVjdXRhYmxlOiBzZXR0aW5ncy5qYXZhRXhlY3V0YWJsZS50cmltKCksXG4gICAgICAgIGFyZ3M6IFtcIi1jcFwiLCB0ZW1wRGlyLCBcIk1haW5cIl0sXG4gICAgICAgIHdvcmtpbmdEaXJlY3Rvcnk6IGNvbnRleHQud29ya2luZ0RpcmVjdG9yeSxcbiAgICAgICAgdGltZW91dE1zOiBNYXRoLm1heChjb250ZXh0LnRpbWVvdXRNcywgMzBfMDAwKSxcbiAgICAgICAgc2lnbmFsOiBjb250ZXh0LnNpZ25hbCxcbiAgICAgIH0pO1xuICAgIH0pO1xuICB9XG59XG4iLCAiaW1wb3J0IHsgam9pbiB9IGZyb20gXCJwYXRoXCI7XG5pbXBvcnQgeyBydW5Qcm9jZXNzLCB3aXRoVGVtcFNvdXJjZUZpbGUgfSBmcm9tIFwiLi4vZXhlY3V0aW9uL3Byb2Nlc3NSdW5uZXJcIjtcbmltcG9ydCB0eXBlIHsgbG9vbUNvZGVCbG9jaywgbG9vbVBsdWdpblNldHRpbmdzLCBsb29tUnVuQ29udGV4dCwgbG9vbVJ1blJlc3VsdCwgbG9vbVJ1bm5lciB9IGZyb20gXCIuLi90eXBlc1wiO1xuXG5leHBvcnQgY2xhc3MgTmF0aXZlQ29tcGlsZWRSdW5uZXIgaW1wbGVtZW50cyBsb29tUnVubmVyIHtcbiAgaWQgPSBcIm5hdGl2ZS1jb21waWxlZFwiO1xuICBkaXNwbGF5TmFtZSA9IFwiTmF0aXZlIGNvbXBpbGVyXCI7XG4gIGxhbmd1YWdlcyA9IFtcImNcIiwgXCJjcHBcIl0gYXMgY29uc3Q7XG5cbiAgY2FuUnVuKGJsb2NrOiBsb29tQ29kZUJsb2NrLCBzZXR0aW5nczogbG9vbVBsdWdpblNldHRpbmdzKTogYm9vbGVhbiB7XG4gICAgaWYgKGJsb2NrLmxhbmd1YWdlID09PSBcImNcIikge1xuICAgICAgcmV0dXJuIEJvb2xlYW4oc2V0dGluZ3MuY0V4ZWN1dGFibGUudHJpbSgpKTtcbiAgICB9XG5cbiAgICBpZiAoYmxvY2subGFuZ3VhZ2UgPT09IFwiY3BwXCIpIHtcbiAgICAgIHJldHVybiBCb29sZWFuKHNldHRpbmdzLmNwcEV4ZWN1dGFibGUudHJpbSgpKTtcbiAgICB9XG5cbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cblxuICBhc3luYyBydW4oYmxvY2s6IGxvb21Db2RlQmxvY2ssIGNvbnRleHQ6IGxvb21SdW5Db250ZXh0LCBzZXR0aW5nczogbG9vbVBsdWdpblNldHRpbmdzKTogUHJvbWlzZTxsb29tUnVuUmVzdWx0PiB7XG4gICAgY29uc3QgZXhlY3V0YWJsZSA9IGJsb2NrLmxhbmd1YWdlID09PSBcImNcIiA/IHNldHRpbmdzLmNFeGVjdXRhYmxlLnRyaW0oKSA6IHNldHRpbmdzLmNwcEV4ZWN1dGFibGUudHJpbSgpO1xuICAgIGNvbnN0IGZpbGVFeHRlbnNpb24gPSBibG9jay5sYW5ndWFnZSA9PT0gXCJjXCIgPyBcIi5jXCIgOiBcIi5jcHBcIjtcbiAgICBjb25zdCBydW5uZXJOYW1lID0gYmxvY2subGFuZ3VhZ2UgPT09IFwiY1wiID8gXCJDIChHQ0MpXCIgOiBcIkMrKyAoRysrKVwiO1xuXG4gICAgcmV0dXJuIHdpdGhUZW1wU291cmNlRmlsZShmaWxlRXh0ZW5zaW9uLCBibG9jay5jb250ZW50LCBhc3luYyAoeyB0ZW1wRGlyLCB0ZW1wRmlsZSB9KSA9PiB7XG4gICAgICBjb25zdCBiaW5hcnlQYXRoID0gam9pbih0ZW1wRGlyLCBcInNuaXBwZXQub3V0XCIpO1xuICAgICAgY29uc3QgY29tcGlsZVJlc3VsdCA9IGF3YWl0IHJ1blByb2Nlc3Moe1xuICAgICAgICBydW5uZXJJZDogYCR7dGhpcy5pZH06JHtibG9jay5sYW5ndWFnZX06Y29tcGlsZWAsXG4gICAgICAgIHJ1bm5lck5hbWUsXG4gICAgICAgIGV4ZWN1dGFibGUsXG4gICAgICAgIGFyZ3M6IFt0ZW1wRmlsZSwgXCItb1wiLCBiaW5hcnlQYXRoXSxcbiAgICAgICAgd29ya2luZ0RpcmVjdG9yeTogY29udGV4dC53b3JraW5nRGlyZWN0b3J5LFxuICAgICAgICB0aW1lb3V0TXM6IE1hdGgubWF4KGNvbnRleHQudGltZW91dE1zLCAzMF8wMDApLFxuICAgICAgICBzaWduYWw6IGNvbnRleHQuc2lnbmFsLFxuICAgICAgfSk7XG5cbiAgICAgIGlmICghY29tcGlsZVJlc3VsdC5zdWNjZXNzKSB7XG4gICAgICAgIHJldHVybiBjb21waWxlUmVzdWx0O1xuICAgICAgfVxuXG4gICAgICByZXR1cm4gcnVuUHJvY2Vzcyh7XG4gICAgICAgIHJ1bm5lcklkOiBgJHt0aGlzLmlkfToke2Jsb2NrLmxhbmd1YWdlfTpydW5gLFxuICAgICAgICBydW5uZXJOYW1lLFxuICAgICAgICBleGVjdXRhYmxlOiBiaW5hcnlQYXRoLFxuICAgICAgICBhcmdzOiBbXSxcbiAgICAgICAgd29ya2luZ0RpcmVjdG9yeTogY29udGV4dC53b3JraW5nRGlyZWN0b3J5LFxuICAgICAgICB0aW1lb3V0TXM6IE1hdGgubWF4KGNvbnRleHQudGltZW91dE1zLCAzMF8wMDApLFxuICAgICAgICBzaWduYWw6IGNvbnRleHQuc2lnbmFsLFxuICAgICAgfSk7XG4gICAgfSk7XG4gIH1cbn1cbiIsICJpbXBvcnQgeyBqb2luIH0gZnJvbSBcInBhdGhcIjtcbmltcG9ydCB7IHJ1blByb2Nlc3MsIHJ1blRlbXBGaWxlUHJvY2Vzcywgd2l0aFRlbXBTb3VyY2VGaWxlIH0gZnJvbSBcIi4uL2V4ZWN1dGlvbi9wcm9jZXNzUnVubmVyXCI7XG5pbXBvcnQgdHlwZSB7IGxvb21Db2RlQmxvY2ssIGxvb21QbHVnaW5TZXR0aW5ncywgbG9vbVJ1bkNvbnRleHQsIGxvb21SdW5SZXN1bHQsIGxvb21SdW5uZXIgfSBmcm9tIFwiLi4vdHlwZXNcIjtcblxuZXhwb3J0IGNsYXNzIE9jYW1sUnVubmVyIGltcGxlbWVudHMgbG9vbVJ1bm5lciB7XG4gIGlkID0gXCJvY2FtbFwiO1xuICBkaXNwbGF5TmFtZSA9IFwiT0NhbWxcIjtcbiAgbGFuZ3VhZ2VzID0gW1wib2NhbWxcIl0gYXMgY29uc3Q7XG5cbiAgY2FuUnVuKGJsb2NrOiBsb29tQ29kZUJsb2NrLCBzZXR0aW5nczogbG9vbVBsdWdpblNldHRpbmdzKTogYm9vbGVhbiB7XG4gICAgcmV0dXJuIGJsb2NrLmxhbmd1YWdlID09PSBcIm9jYW1sXCIgJiYgQm9vbGVhbihzZXR0aW5ncy5vY2FtbEV4ZWN1dGFibGUudHJpbSgpKTtcbiAgfVxuXG4gIGFzeW5jIHJ1bihibG9jazogbG9vbUNvZGVCbG9jaywgY29udGV4dDogbG9vbVJ1bkNvbnRleHQsIHNldHRpbmdzOiBsb29tUGx1Z2luU2V0dGluZ3MpOiBQcm9taXNlPGxvb21SdW5SZXN1bHQ+IHtcbiAgICBjb25zdCBtb2RlID0gc2V0dGluZ3Mub2NhbWxNb2RlO1xuICAgIGNvbnN0IGV4ZWN1dGFibGUgPSBzZXR0aW5ncy5vY2FtbEV4ZWN1dGFibGUudHJpbSgpO1xuXG4gICAgaWYgKG1vZGUgPT09IFwib2NhbWxcIikge1xuICAgICAgcmV0dXJuIHJ1blRlbXBGaWxlUHJvY2Vzcyh7XG4gICAgICAgIHJ1bm5lcklkOiBgJHt0aGlzLmlkfTpvY2FtbGAsXG4gICAgICAgIHJ1bm5lck5hbWU6IFwiT0NhbWxcIixcbiAgICAgICAgZXhlY3V0YWJsZSxcbiAgICAgICAgYXJnczogW1wie2ZpbGV9XCJdLFxuICAgICAgICBmaWxlRXh0ZW5zaW9uOiBcIi5tbFwiLFxuICAgICAgICBzb3VyY2U6IGJsb2NrLmNvbnRlbnQsXG4gICAgICAgIHdvcmtpbmdEaXJlY3Rvcnk6IGNvbnRleHQud29ya2luZ0RpcmVjdG9yeSxcbiAgICAgICAgdGltZW91dE1zOiBjb250ZXh0LnRpbWVvdXRNcyxcbiAgICAgICAgc2lnbmFsOiBjb250ZXh0LnNpZ25hbCxcbiAgICAgIH0pO1xuICAgIH1cblxuICAgIGlmIChtb2RlID09PSBcImR1bmVcIikge1xuICAgICAgcmV0dXJuIHJ1blRlbXBGaWxlUHJvY2Vzcyh7XG4gICAgICAgIHJ1bm5lcklkOiBgJHt0aGlzLmlkfTpkdW5lYCxcbiAgICAgICAgcnVubmVyTmFtZTogXCJEdW5lIC8gT0NhbWxcIixcbiAgICAgICAgZXhlY3V0YWJsZSxcbiAgICAgICAgYXJnczogW1wiZXhlY1wiLCBcIi0tXCIsIFwib2NhbWxcIiwgXCJ7ZmlsZX1cIl0sXG4gICAgICAgIGZpbGVFeHRlbnNpb246IFwiLm1sXCIsXG4gICAgICAgIHNvdXJjZTogYmxvY2suY29udGVudCxcbiAgICAgICAgd29ya2luZ0RpcmVjdG9yeTogY29udGV4dC53b3JraW5nRGlyZWN0b3J5LFxuICAgICAgICB0aW1lb3V0TXM6IGNvbnRleHQudGltZW91dE1zLFxuICAgICAgICBzaWduYWw6IGNvbnRleHQuc2lnbmFsLFxuICAgICAgfSk7XG4gICAgfVxuXG4gICAgcmV0dXJuIHdpdGhUZW1wU291cmNlRmlsZShcIi5tbFwiLCBibG9jay5jb250ZW50LCBhc3luYyAoeyB0ZW1wRGlyLCB0ZW1wRmlsZSB9KSA9PiB7XG4gICAgICBjb25zdCBiaW5hcnlQYXRoID0gam9pbih0ZW1wRGlyLCBcInNuaXBwZXQub3V0XCIpO1xuICAgICAgY29uc3QgY29tcGlsZVJlc3VsdCA9IGF3YWl0IHJ1blByb2Nlc3Moe1xuICAgICAgICBydW5uZXJJZDogYCR7dGhpcy5pZH06b2NhbWxjLWNvbXBpbGVgLFxuICAgICAgICBydW5uZXJOYW1lOiBcIk9DYW1sY1wiLFxuICAgICAgICBleGVjdXRhYmxlLFxuICAgICAgICBhcmdzOiBbXCItb1wiLCBiaW5hcnlQYXRoLCB0ZW1wRmlsZV0sXG4gICAgICAgIHdvcmtpbmdEaXJlY3Rvcnk6IGNvbnRleHQud29ya2luZ0RpcmVjdG9yeSxcbiAgICAgICAgdGltZW91dE1zOiBjb250ZXh0LnRpbWVvdXRNcyxcbiAgICAgICAgc2lnbmFsOiBjb250ZXh0LnNpZ25hbCxcbiAgICAgIH0pO1xuXG4gICAgICBpZiAoIWNvbXBpbGVSZXN1bHQuc3VjY2Vzcykge1xuICAgICAgICByZXR1cm4gY29tcGlsZVJlc3VsdDtcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIHJ1blByb2Nlc3Moe1xuICAgICAgICBydW5uZXJJZDogYCR7dGhpcy5pZH06b2NhbWxjLXJ1bmAsXG4gICAgICAgIHJ1bm5lck5hbWU6IFwiT0NhbWxjXCIsXG4gICAgICAgIGV4ZWN1dGFibGU6IGJpbmFyeVBhdGgsXG4gICAgICAgIGFyZ3M6IFtdLFxuICAgICAgICB3b3JraW5nRGlyZWN0b3J5OiBjb250ZXh0LndvcmtpbmdEaXJlY3RvcnksXG4gICAgICAgIHRpbWVvdXRNczogY29udGV4dC50aW1lb3V0TXMsXG4gICAgICAgIHNpZ25hbDogY29udGV4dC5zaWduYWwsXG4gICAgICB9KTtcbiAgICB9KTtcbiAgfVxufVxuIiwgImltcG9ydCB7IHJ1blRlbXBGaWxlUHJvY2VzcyB9IGZyb20gXCIuLi9leGVjdXRpb24vcHJvY2Vzc1J1bm5lclwiO1xuaW1wb3J0IHR5cGUgeyBsb29tQ29kZUJsb2NrLCBsb29tUGx1Z2luU2V0dGluZ3MsIGxvb21SdW5Db250ZXh0LCBsb29tUnVuUmVzdWx0LCBsb29tUnVubmVyIH0gZnJvbSBcIi4uL3R5cGVzXCI7XG5cbmV4cG9ydCBjbGFzcyBQeXRob25SdW5uZXIgaW1wbGVtZW50cyBsb29tUnVubmVyIHtcbiAgaWQgPSBcInB5dGhvblwiO1xuICBkaXNwbGF5TmFtZSA9IFwiUHl0aG9uXCI7XG4gIGxhbmd1YWdlcyA9IFtcInB5dGhvblwiXSBhcyBjb25zdDtcblxuICBjYW5SdW4oYmxvY2s6IGxvb21Db2RlQmxvY2ssIHNldHRpbmdzOiBsb29tUGx1Z2luU2V0dGluZ3MpOiBib29sZWFuIHtcbiAgICByZXR1cm4gYmxvY2subGFuZ3VhZ2UgPT09IFwicHl0aG9uXCIgJiYgQm9vbGVhbihzZXR0aW5ncy5weXRob25FeGVjdXRhYmxlLnRyaW0oKSk7XG4gIH1cblxuICBydW4oYmxvY2s6IGxvb21Db2RlQmxvY2ssIGNvbnRleHQ6IGxvb21SdW5Db250ZXh0LCBzZXR0aW5nczogbG9vbVBsdWdpblNldHRpbmdzKTogUHJvbWlzZTxsb29tUnVuUmVzdWx0PiB7XG4gICAgcmV0dXJuIHJ1blRlbXBGaWxlUHJvY2Vzcyh7XG4gICAgICBydW5uZXJJZDogdGhpcy5pZCxcbiAgICAgIHJ1bm5lck5hbWU6IHRoaXMuZGlzcGxheU5hbWUsXG4gICAgICBleGVjdXRhYmxlOiBzZXR0aW5ncy5weXRob25FeGVjdXRhYmxlLnRyaW0oKSxcbiAgICAgIGFyZ3M6IFtcIntmaWxlfVwiXSxcbiAgICAgIGZpbGVFeHRlbnNpb246IFwiLnB5XCIsXG4gICAgICBzb3VyY2U6IGJsb2NrLmNvbnRlbnQsXG4gICAgICB3b3JraW5nRGlyZWN0b3J5OiBjb250ZXh0LndvcmtpbmdEaXJlY3RvcnksXG4gICAgICB0aW1lb3V0TXM6IGNvbnRleHQudGltZW91dE1zLFxuICAgICAgc2lnbmFsOiBjb250ZXh0LnNpZ25hbCxcbiAgICB9KTtcbiAgfVxufVxuIiwgImltcG9ydCB7IGV4aXN0c1N5bmMgfSBmcm9tIFwiZnNcIjtcbmltcG9ydCB7IGpvaW4gfSBmcm9tIFwicGF0aFwiO1xuaW1wb3J0IHsgcnVuVGVtcEZpbGVQcm9jZXNzIH0gZnJvbSBcIi4uL2V4ZWN1dGlvbi9wcm9jZXNzUnVubmVyXCI7XG5pbXBvcnQgdHlwZSB7IGxvb21Db2RlQmxvY2ssIGxvb21QbHVnaW5TZXR0aW5ncywgbG9vbVJ1bkNvbnRleHQsIGxvb21SdW5SZXN1bHQsIGxvb21SdW5uZXIgfSBmcm9tIFwiLi4vdHlwZXNcIjtcblxuZXhwb3J0IGNsYXNzIFByb29mUnVubmVyIGltcGxlbWVudHMgbG9vbVJ1bm5lciB7XG4gIGlkID0gXCJwcm9vZlwiO1xuICBkaXNwbGF5TmFtZSA9IFwiUHJvb2YgY2hlY2tlclwiO1xuICBsYW5ndWFnZXMgPSBbXCJsZWFuXCIsIFwiY29xXCIsIFwic210bGliXCJdIGFzIGNvbnN0O1xuXG4gIGNhblJ1bihibG9jazogbG9vbUNvZGVCbG9jaywgc2V0dGluZ3M6IGxvb21QbHVnaW5TZXR0aW5ncyk6IGJvb2xlYW4ge1xuICAgIGlmIChibG9jay5sYW5ndWFnZSA9PT0gXCJsZWFuXCIpIHtcbiAgICAgIHJldHVybiBCb29sZWFuKHNldHRpbmdzLmxlYW5FeGVjdXRhYmxlLnRyaW0oKSk7XG4gICAgfVxuXG4gICAgaWYgKGJsb2NrLmxhbmd1YWdlID09PSBcImNvcVwiKSB7XG4gICAgICByZXR1cm4gQm9vbGVhbihyZXNvbHZlQ29xRXhlY3V0YWJsZShzZXR0aW5ncykudHJpbSgpKTtcbiAgICB9XG5cbiAgICBpZiAoYmxvY2subGFuZ3VhZ2UgPT09IFwic210bGliXCIpIHtcbiAgICAgIHJldHVybiBCb29sZWFuKHNldHRpbmdzLnNtdEV4ZWN1dGFibGUudHJpbSgpKTtcbiAgICB9XG5cbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cblxuICBydW4oYmxvY2s6IGxvb21Db2RlQmxvY2ssIGNvbnRleHQ6IGxvb21SdW5Db250ZXh0LCBzZXR0aW5nczogbG9vbVBsdWdpblNldHRpbmdzKTogUHJvbWlzZTxsb29tUnVuUmVzdWx0PiB7XG4gICAgaWYgKGJsb2NrLmxhbmd1YWdlID09PSBcImxlYW5cIikge1xuICAgICAgcmV0dXJuIHJ1blRlbXBGaWxlUHJvY2Vzcyh7XG4gICAgICAgIHJ1bm5lcklkOiBgJHt0aGlzLmlkfTpsZWFuYCxcbiAgICAgICAgcnVubmVyTmFtZTogXCJMZWFuXCIsXG4gICAgICAgIGV4ZWN1dGFibGU6IHNldHRpbmdzLmxlYW5FeGVjdXRhYmxlLnRyaW0oKSxcbiAgICAgICAgYXJnczogW1wie2ZpbGV9XCJdLFxuICAgICAgICBmaWxlRXh0ZW5zaW9uOiBcIi5sZWFuXCIsXG4gICAgICAgIHNvdXJjZTogYmxvY2suY29udGVudCxcbiAgICAgICAgd29ya2luZ0RpcmVjdG9yeTogY29udGV4dC53b3JraW5nRGlyZWN0b3J5LFxuICAgICAgICB0aW1lb3V0TXM6IE1hdGgubWF4KGNvbnRleHQudGltZW91dE1zLCAzMF8wMDApLFxuICAgICAgICBzaWduYWw6IGNvbnRleHQuc2lnbmFsLFxuICAgICAgfSk7XG4gICAgfVxuXG4gICAgaWYgKGJsb2NrLmxhbmd1YWdlID09PSBcImNvcVwiKSB7XG4gICAgICByZXR1cm4gcnVuVGVtcEZpbGVQcm9jZXNzKHtcbiAgICAgICAgcnVubmVySWQ6IGAke3RoaXMuaWR9OmNvcWAsXG4gICAgICAgIHJ1bm5lck5hbWU6IFwiQ29xXCIsXG4gICAgICAgIGV4ZWN1dGFibGU6IHJlc29sdmVDb3FFeGVjdXRhYmxlKHNldHRpbmdzKSxcbiAgICAgICAgYXJnczogW1wiLXFcIiwgXCJ7ZmlsZX1cIl0sXG4gICAgICAgIGZpbGVFeHRlbnNpb246IFwiLnZcIixcbiAgICAgICAgc291cmNlOiBibG9jay5jb250ZW50LFxuICAgICAgICB3b3JraW5nRGlyZWN0b3J5OiBjb250ZXh0LndvcmtpbmdEaXJlY3RvcnksXG4gICAgICAgIHRpbWVvdXRNczogTWF0aC5tYXgoY29udGV4dC50aW1lb3V0TXMsIDMwXzAwMCksXG4gICAgICAgIHNpZ25hbDogY29udGV4dC5zaWduYWwsXG4gICAgICB9KTtcbiAgICB9XG5cbiAgICBpZiAoYmxvY2subGFuZ3VhZ2UgPT09IFwic210bGliXCIpIHtcbiAgICAgIHJldHVybiBydW5UZW1wRmlsZVByb2Nlc3Moe1xuICAgICAgICBydW5uZXJJZDogYCR7dGhpcy5pZH06c210bGliYCxcbiAgICAgICAgcnVubmVyTmFtZTogXCJTTVQtTElCIChaMylcIixcbiAgICAgICAgZXhlY3V0YWJsZTogc2V0dGluZ3Muc210RXhlY3V0YWJsZS50cmltKCksXG4gICAgICAgIGFyZ3M6IFtcIntmaWxlfVwiXSxcbiAgICAgICAgZmlsZUV4dGVuc2lvbjogXCIuc210MlwiLFxuICAgICAgICBzb3VyY2U6IGJsb2NrLmNvbnRlbnQsXG4gICAgICAgIHdvcmtpbmdEaXJlY3Rvcnk6IGNvbnRleHQud29ya2luZ0RpcmVjdG9yeSxcbiAgICAgICAgdGltZW91dE1zOiBNYXRoLm1heChjb250ZXh0LnRpbWVvdXRNcywgMzBfMDAwKSxcbiAgICAgICAgc2lnbmFsOiBjb250ZXh0LnNpZ25hbCxcbiAgICAgIH0pO1xuICAgIH1cblxuICAgIHRocm93IG5ldyBFcnJvcihgVW5zdXBwb3J0ZWQgcHJvb2YgbGFuZ3VhZ2U6ICR7YmxvY2subGFuZ3VhZ2V9YCk7XG4gIH1cbn1cblxuZnVuY3Rpb24gcmVzb2x2ZUNvcUV4ZWN1dGFibGUoc2V0dGluZ3M6IGxvb21QbHVnaW5TZXR0aW5ncyk6IHN0cmluZyB7XG4gIGNvbnN0IGNvbmZpZ3VyZWQgPSBzZXR0aW5ncy5jb3FFeGVjdXRhYmxlLnRyaW0oKTtcbiAgaWYgKGNvbmZpZ3VyZWQgJiYgY29uZmlndXJlZCAhPT0gXCJjb3FjXCIpIHtcbiAgICByZXR1cm4gY29uZmlndXJlZDtcbiAgfVxuXG4gIGNvbnN0IG9wYW1Db3FjID0gam9pbihwcm9jZXNzLmVudi5IT01FID8/IFwiXCIsIFwiLm9wYW1cIiwgXCJkZWZhdWx0XCIsIFwiYmluXCIsIFwiY29xY1wiKTtcbiAgcmV0dXJuIGV4aXN0c1N5bmMob3BhbUNvcWMpID8gb3BhbUNvcWMgOiBjb25maWd1cmVkIHx8IFwiY29xY1wiO1xufVxuIiwgImltcG9ydCB0eXBlIHsgbG9vbUNvZGVCbG9jaywgbG9vbVBsdWdpblNldHRpbmdzLCBsb29tUnVubmVyIH0gZnJvbSBcIi4uL3R5cGVzXCI7XG5cbmV4cG9ydCBjbGFzcyBsb29tUnVubmVyUmVnaXN0cnkge1xuICBjb25zdHJ1Y3Rvcihwcml2YXRlIHJlYWRvbmx5IHJ1bm5lcnM6IGxvb21SdW5uZXJbXSkge31cblxuICBnZXRSdW5uZXJGb3JCbG9jayhibG9jazogbG9vbUNvZGVCbG9jaywgc2V0dGluZ3M6IGxvb21QbHVnaW5TZXR0aW5ncyk6IGxvb21SdW5uZXIgfCBudWxsIHtcbiAgICByZXR1cm4gdGhpcy5ydW5uZXJzLmZpbmQoKHJ1bm5lcikgPT4gKCFydW5uZXIubGFuZ3VhZ2VzLmxlbmd0aCB8fCBydW5uZXIubGFuZ3VhZ2VzLmluY2x1ZGVzKGJsb2NrLmxhbmd1YWdlKSkgJiYgcnVubmVyLmNhblJ1bihibG9jaywgc2V0dGluZ3MpKSA/PyBudWxsO1xuICB9XG5cbiAgZ2V0U3VwcG9ydGVkTGFuZ3VhZ2VzKCk6IHN0cmluZ1tdIHtcbiAgICByZXR1cm4gWy4uLm5ldyBTZXQodGhpcy5ydW5uZXJzLmZsYXRNYXAoKHJ1bm5lcikgPT4gcnVubmVyLmxhbmd1YWdlcykpXTtcbiAgfVxufVxuIiwgImltcG9ydCB7IEFwcCwgTW9kYWwsIE5vdGljZSwgUGx1Z2luU2V0dGluZ1RhYiwgU2V0dGluZywgbm9ybWFsaXplUGF0aCB9IGZyb20gXCJvYnNpZGlhblwiO1xuaW1wb3J0IHR5cGUgbG9vbVBsdWdpbiBmcm9tIFwiLi9tYWluXCI7XG5pbXBvcnQgdHlwZSB7IGxvb21DdXN0b21MYW5ndWFnZSwgbG9vbVBsdWdpblNldHRpbmdzIH0gZnJvbSBcIi4vdHlwZXNcIjtcblxuZXhwb3J0IGNvbnN0IERFRkFVTFRfU0VUVElOR1M6IGxvb21QbHVnaW5TZXR0aW5ncyA9IHtcbiAgZW5hYmxlTG9jYWxFeGVjdXRpb246IGZhbHNlLFxuICBoYXNBY2tub3dsZWRnZWRFeGVjdXRpb25SaXNrOiBmYWxzZSxcbiAgcHJlc2VydmVTb3VyY2VNb2RlOiB0cnVlLFxuICBkZWZhdWx0VGltZW91dE1zOiA4MDAwLFxuICB3b3JraW5nRGlyZWN0b3J5OiBcIlwiLFxuICBweXRob25FeGVjdXRhYmxlOiBcInB5dGhvbjNcIixcbiAgbm9kZUV4ZWN1dGFibGU6IFwibm9kZVwiLFxuICB0eXBlc2NyaXB0TW9kZTogXCJ0cy1ub2RlXCIsXG4gIHR5cGVzY3JpcHRUcmFuc3BpbGVyRXhlY3V0YWJsZTogXCJ0cy1ub2RlXCIsXG4gIG9jYW1sTW9kZTogXCJvY2FtbFwiLFxuICBvY2FtbEV4ZWN1dGFibGU6IFwib2NhbWxcIixcbiAgY0V4ZWN1dGFibGU6IFwiZ2NjXCIsXG4gIGNwcEV4ZWN1dGFibGU6IFwiZysrXCIsXG4gIHNoZWxsRXhlY3V0YWJsZTogXCJiYXNoXCIsXG4gIHJ1YnlFeGVjdXRhYmxlOiBcInJ1YnlcIixcbiAgcGVybEV4ZWN1dGFibGU6IFwicGVybFwiLFxuICBsdWFFeGVjdXRhYmxlOiBcImx1YVwiLFxuICBwaHBFeGVjdXRhYmxlOiBcInBocFwiLFxuICBnb0V4ZWN1dGFibGU6IFwiZ29cIixcbiAgcnVzdEV4ZWN1dGFibGU6IFwicnVzdGNcIixcbiAgaGFza2VsbEV4ZWN1dGFibGU6IFwicnVuZ2hjXCIsXG4gIGphdmFDb21waWxlckV4ZWN1dGFibGU6IFwiXCIsXG4gIGphdmFFeGVjdXRhYmxlOiBcImphdmFcIixcbiAgbGx2bUludGVycHJldGVyRXhlY3V0YWJsZTogXCJsbGlcIixcbiAgbGVhbkV4ZWN1dGFibGU6IFwibGVhblwiLFxuICBjb3FFeGVjdXRhYmxlOiBcImNvcWNcIixcbiAgc210RXhlY3V0YWJsZTogXCJ6M1wiLFxuICB3cml0ZU91dHB1dFRvTm90ZTogZmFsc2UsXG4gIGF1dG9SdW5PbkZpbGVPcGVuOiBmYWxzZSxcbiAgZXh0cmFjdGVkU291cmNlUHJldmlld01vZGU6IFwiY29sbGFwc2VkXCIsXG4gIHNob3dMYW5ndWFnZUNhcGFiaWxpdHlNZXRhZGF0YTogdHJ1ZSxcbiAgY3VzdG9tTGFuZ3VhZ2VzOiBbXSxcbiAgcGRmRXhwb3J0TW9kZTogXCJib3RoXCIsXG4gIGRlZmF1bHRDb250YWluZXJHcm91cDogXCJcIixcbn07XG5cbmV4cG9ydCBjbGFzcyBsb29tU2V0dGluZ1RhYiBleHRlbmRzIFBsdWdpblNldHRpbmdUYWIge1xuICBjb25zdHJ1Y3Rvcihwcml2YXRlIHJlYWRvbmx5IGxvb21QbHVnaW46IGxvb21QbHVnaW4pIHtcbiAgICBzdXBlcihsb29tUGx1Z2luLmFwcCwgbG9vbVBsdWdpbik7XG4gIH1cblxuICBkaXNwbGF5KCk6IHZvaWQge1xuICAgIGNvbnN0IHsgY29udGFpbmVyRWwgfSA9IHRoaXM7XG4gICAgY29udGFpbmVyRWwuZW1wdHkoKTtcbiAgICBjb250YWluZXJFbC5jcmVhdGVFbChcImgyXCIsIHsgdGV4dDogXCJsb29tXCIgfSk7XG4gICAgY29udGFpbmVyRWwuY3JlYXRlRWwoXCJwXCIsIHsgdGV4dDogXCJSdW4gc3VwcG9ydGVkIGNvZGUgZmVuY2VzIGRpcmVjdGx5IGZyb20gbm90ZXMgd2hpbGUgcHJlc2VydmluZyBuYXRpdmUgc3ludGF4IGhpZ2hsaWdodGluZy5cIiB9KTtcblxuICAgIHRoaXMucmVuZGVyR2VuZXJhbFNldHRpbmdzKHRoaXMuY3JlYXRlU2VjdGlvbihjb250YWluZXJFbCwgXCJHZW5lcmFsIFNldHRpbmdzXCIsIHRydWUpKTtcbiAgICB0aGlzLnJlbmRlckJ1aWx0SW5SdW50aW1lcyh0aGlzLmNyZWF0ZVNlY3Rpb24oY29udGFpbmVyRWwsIFwiQnVpbHQtaW4gUnVudGltZXNcIikpO1xuICAgIHRoaXMucmVuZGVyQ3VzdG9tTGFuZ3VhZ2VzKHRoaXMuY3JlYXRlU2VjdGlvbihjb250YWluZXJFbCwgXCJDdXN0b20gTGFuZ3VhZ2VzXCIpKTtcbiAgICB2b2lkIHRoaXMucmVuZGVyQ29udGFpbmVyR3JvdXBzKHRoaXMuY3JlYXRlU2VjdGlvbihjb250YWluZXJFbCwgXCJDb250YWluZXJpemF0aW9uIEdyb3Vwc1wiKSk7XG4gIH1cblxuICBwcml2YXRlIGNyZWF0ZVNlY3Rpb24oY29udGFpbmVyRWw6IEhUTUxFbGVtZW50LCB0aXRsZTogc3RyaW5nLCBvcGVuID0gZmFsc2UpOiBIVE1MRWxlbWVudCB7XG4gICAgY29uc3QgZGV0YWlscyA9IGNvbnRhaW5lckVsLmNyZWF0ZUVsKFwiZGV0YWlsc1wiLCB7IGNsczogXCJsb29tLXNldHRpbmdzLXNlY3Rpb25cIiB9KTtcbiAgICBkZXRhaWxzLm9wZW4gPSBvcGVuO1xuICAgIGRldGFpbHMuY3JlYXRlRWwoXCJzdW1tYXJ5XCIsIHsgdGV4dDogdGl0bGUsIGNsczogXCJsb29tLXNldHRpbmdzLXN1bW1hcnlcIiB9KTtcbiAgICByZXR1cm4gZGV0YWlscy5jcmVhdGVEaXYoeyBjbHM6IFwibG9vbS1zZXR0aW5ncy1zZWN0aW9uLWJvZHlcIiB9KTtcbiAgfVxuXG4gIHByaXZhdGUgcmVuZGVyR2VuZXJhbFNldHRpbmdzKGNvbnRhaW5lckVsOiBIVE1MRWxlbWVudCk6IHZvaWQge1xuICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxuICAgICAgLnNldE5hbWUoXCJFbmFibGUgbG9jYWwgZXhlY3V0aW9uXCIpXG4gICAgICAuc2V0RGVzYyhcIkRpc2FibGVkIGJ5IGRlZmF1bHQuIGxvb20gcnVucyBjb2RlIG9uIHlvdXIgbG9jYWwgbWFjaGluZSBhbmQgZG9lcyBub3QgcHJvdmlkZSBzYW5kYm94aW5nLlwiKVxuICAgICAgLmFkZFRvZ2dsZSgodG9nZ2xlKSA9PlxuICAgICAgICB0b2dnbGUuc2V0VmFsdWUodGhpcy5sb29tUGx1Z2luLnNldHRpbmdzLmVuYWJsZUxvY2FsRXhlY3V0aW9uKS5vbkNoYW5nZShhc3luYyAodmFsdWUpID0+IHtcbiAgICAgICAgICB0aGlzLmxvb21QbHVnaW4uc2V0dGluZ3MuZW5hYmxlTG9jYWxFeGVjdXRpb24gPSB2YWx1ZTtcbiAgICAgICAgICBpZiAodmFsdWUpIHtcbiAgICAgICAgICAgIHRoaXMubG9vbVBsdWdpbi5zZXR0aW5ncy5oYXNBY2tub3dsZWRnZWRFeGVjdXRpb25SaXNrID0gdHJ1ZTtcbiAgICAgICAgICB9XG4gICAgICAgICAgYXdhaXQgdGhpcy5sb29tUGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgICAgICB9KSxcbiAgICAgICk7XG5cbiAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgIC5zZXROYW1lKFwiS2VlcCBsb29tIG5vdGVzIGluIHNvdXJjZSBtb2RlXCIpXG4gICAgICAuc2V0RGVzYyhcIlByZXNlcnZlIHJhdyBmZW5jZWQgY29kZSBpbiB0aGUgZWRpdG9yIGluc3RlYWQgb2YgbGV0dGluZyBsaXZlIHByZXZpZXcgY29sbGFwc2UgcmVzZWFyY2ggc25pcHBldHMuXCIpXG4gICAgICAuYWRkVG9nZ2xlKCh0b2dnbGUpID0+XG4gICAgICAgIHRvZ2dsZS5zZXRWYWx1ZSh0aGlzLmxvb21QbHVnaW4uc2V0dGluZ3MucHJlc2VydmVTb3VyY2VNb2RlKS5vbkNoYW5nZShhc3luYyAodmFsdWUpID0+IHtcbiAgICAgICAgICB0aGlzLmxvb21QbHVnaW4uc2V0dGluZ3MucHJlc2VydmVTb3VyY2VNb2RlID0gdmFsdWU7XG4gICAgICAgICAgYXdhaXQgdGhpcy5sb29tUGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgICAgICAgIGlmICh2YWx1ZSkge1xuICAgICAgICAgICAgdm9pZCB0aGlzLmxvb21QbHVnaW4uZW5mb3JjZVNvdXJjZU1vZGVGb3JBY3RpdmVWaWV3KCk7XG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHZvaWQgdGhpcy5sb29tUGx1Z2luLmRpc2FibGVTb3VyY2VNb2RlRm9yQWN0aXZlVmlldygpO1xuICAgICAgICAgIH1cbiAgICAgICAgfSksXG4gICAgICApO1xuXG4gICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAuc2V0TmFtZShcIkRlZmF1bHQgdGltZW91dFwiKVxuICAgICAgLnNldERlc2MoXCJNYXhpbXVtIGV4ZWN1dGlvbiB0aW1lIGluIG1pbGxpc2Vjb25kcyBiZWZvcmUgbG9vbSB0ZXJtaW5hdGVzIHRoZSBwcm9jZXNzLlwiKVxuICAgICAgLmFkZFRleHQoKHRleHQpID0+XG4gICAgICAgIHRleHQuc2V0UGxhY2Vob2xkZXIoXCI4MDAwXCIpLnNldFZhbHVlKFN0cmluZyh0aGlzLmxvb21QbHVnaW4uc2V0dGluZ3MuZGVmYXVsdFRpbWVvdXRNcykpLm9uQ2hhbmdlKGFzeW5jICh2YWx1ZSkgPT4ge1xuICAgICAgICAgIGNvbnN0IHBhcnNlZCA9IE51bWJlci5wYXJzZUludCh2YWx1ZSwgMTApO1xuICAgICAgICAgIGlmICghTnVtYmVyLmlzTmFOKHBhcnNlZCkgJiYgcGFyc2VkID4gMCkge1xuICAgICAgICAgICAgdGhpcy5sb29tUGx1Z2luLnNldHRpbmdzLmRlZmF1bHRUaW1lb3V0TXMgPSBwYXJzZWQ7XG4gICAgICAgICAgICBhd2FpdCB0aGlzLmxvb21QbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICAgICAgfVxuICAgICAgICB9KSxcbiAgICAgICk7XG5cbiAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgIC5zZXROYW1lKFwiV29ya2luZyBkaXJlY3RvcnlcIilcbiAgICAgIC5zZXREZXNjKFwiT3B0aW9uYWwuIEVtcHR5IHVzZXMgdGhlIGN1cnJlbnQgbm90ZSBmb2xkZXIgd2hlbiBwb3NzaWJsZSwgb3RoZXJ3aXNlIHRoZSB2YXVsdCByb290LlwiKVxuICAgICAgLmFkZFRleHQoKHRleHQpID0+XG4gICAgICAgIHRleHQuc2V0UGxhY2Vob2xkZXIoXCJWYXVsdCByb290XCIpLnNldFZhbHVlKHRoaXMubG9vbVBsdWdpbi5zZXR0aW5ncy53b3JraW5nRGlyZWN0b3J5KS5vbkNoYW5nZShhc3luYyAodmFsdWUpID0+IHtcbiAgICAgICAgICB0aGlzLmxvb21QbHVnaW4uc2V0dGluZ3Mud29ya2luZ0RpcmVjdG9yeSA9IHZhbHVlLnRyaW0oKSA/IG5vcm1hbGl6ZVBhdGgodmFsdWUudHJpbSgpKSA6IFwiXCI7XG4gICAgICAgICAgYXdhaXQgdGhpcy5sb29tUGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgICAgICB9KSxcbiAgICAgICk7XG5cbiAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgIC5zZXROYW1lKFwiV3JpdGUgb3V0cHV0IGJhY2sgdG8gbm90ZVwiKVxuICAgICAgLnNldERlc2MoXCJJbnNlcnQgbWFuYWdlZCBsb29tIG91dHB1dCBzZWN0aW9ucyBiZW5lYXRoIGNvZGUgYmxvY2tzIGluc3RlYWQgb2Yga2VlcGluZyByZXN1bHRzIHB1cmVseSBpbiB0aGUgVUkuXCIpXG4gICAgICAuYWRkVG9nZ2xlKCh0b2dnbGUpID0+XG4gICAgICAgIHRvZ2dsZS5zZXRWYWx1ZSh0aGlzLmxvb21QbHVnaW4uc2V0dGluZ3Mud3JpdGVPdXRwdXRUb05vdGUpLm9uQ2hhbmdlKGFzeW5jICh2YWx1ZSkgPT4ge1xuICAgICAgICAgIHRoaXMubG9vbVBsdWdpbi5zZXR0aW5ncy53cml0ZU91dHB1dFRvTm90ZSA9IHZhbHVlO1xuICAgICAgICAgIGF3YWl0IHRoaXMubG9vbVBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgICAgfSksXG4gICAgICApO1xuXG4gICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAuc2V0TmFtZShcIkF1dG8tcnVuIG9uIGZpbGUgb3BlblwiKVxuICAgICAgLnNldERlc2MoXCJSdW4gYWxsIHN1cHBvcnRlZCBibG9ja3MgaW4gdGhlIGFjdGl2ZSBub3RlIHdoZW4gaXQgb3BlbnMuIERpc2FibGVkIGJ5IGRlZmF1bHQuXCIpXG4gICAgICAuYWRkVG9nZ2xlKCh0b2dnbGUpID0+XG4gICAgICAgIHRvZ2dsZS5zZXRWYWx1ZSh0aGlzLmxvb21QbHVnaW4uc2V0dGluZ3MuYXV0b1J1bk9uRmlsZU9wZW4pLm9uQ2hhbmdlKGFzeW5jICh2YWx1ZSkgPT4ge1xuICAgICAgICAgIHRoaXMubG9vbVBsdWdpbi5zZXR0aW5ncy5hdXRvUnVuT25GaWxlT3BlbiA9IHZhbHVlO1xuICAgICAgICAgIGF3YWl0IHRoaXMubG9vbVBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgICAgfSksXG4gICAgICApO1xuXG4gICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAuc2V0TmFtZShcIkV4dHJhY3RlZCBzb3VyY2UgcHJldmlld1wiKVxuICAgICAgLnNldERlc2MoXCJDaG9vc2UgaG93IGxvb20gc2hvd3MgdGhlIG1hdGVyaWFsaXplZCBzb3VyY2UgZm9yIGJsb2NrcyB0aGF0IHVzZSBsb29tLWZpbGUuXCIpXG4gICAgICAuYWRkRHJvcGRvd24oKGRyb3Bkb3duKSA9PlxuICAgICAgICBkcm9wZG93blxuICAgICAgICAgIC5hZGRPcHRpb24oXCJjb2xsYXBzZWRcIiwgXCJDb2xsYXBzZWRcIilcbiAgICAgICAgICAuYWRkT3B0aW9uKFwiZXhwYW5kZWRcIiwgXCJFeHBhbmRlZFwiKVxuICAgICAgICAgIC5hZGRPcHRpb24oXCJoaWRkZW5cIiwgXCJIaWRkZW5cIilcbiAgICAgICAgICAuc2V0VmFsdWUodGhpcy5sb29tUGx1Z2luLnNldHRpbmdzLmV4dHJhY3RlZFNvdXJjZVByZXZpZXdNb2RlIHx8IFwiY29sbGFwc2VkXCIpXG4gICAgICAgICAgLm9uQ2hhbmdlKGFzeW5jICh2YWx1ZSkgPT4ge1xuICAgICAgICAgICAgdGhpcy5sb29tUGx1Z2luLnNldHRpbmdzLmV4dHJhY3RlZFNvdXJjZVByZXZpZXdNb2RlID0gdmFsdWUgYXMgXCJjb2xsYXBzZWRcIiB8IFwiZXhwYW5kZWRcIiB8IFwiaGlkZGVuXCI7XG4gICAgICAgICAgICBhd2FpdCB0aGlzLmxvb21QbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICAgICAgfSksXG4gICAgICApO1xuXG4gICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAuc2V0TmFtZShcIlNob3cgY2FwYWJpbGl0eSBtZXRhZGF0YVwiKVxuICAgICAgLnNldERlc2MoXCJTaG93IHN5bWJvbCwgZGVwZW5kZW5jeSwgYW5kIGhhcm5lc3MgY2FwYWJpbGl0eSBtZXRhZGF0YSBpbiBleHRyYWN0ZWQgc291cmNlIHByZXZpZXcgaGVhZGVycy5cIilcbiAgICAgIC5hZGRUb2dnbGUoKHRvZ2dsZSkgPT5cbiAgICAgICAgdG9nZ2xlLnNldFZhbHVlKHRoaXMubG9vbVBsdWdpbi5zZXR0aW5ncy5zaG93TGFuZ3VhZ2VDYXBhYmlsaXR5TWV0YWRhdGEgPz8gdHJ1ZSkub25DaGFuZ2UoYXN5bmMgKHZhbHVlKSA9PiB7XG4gICAgICAgICAgdGhpcy5sb29tUGx1Z2luLnNldHRpbmdzLnNob3dMYW5ndWFnZUNhcGFiaWxpdHlNZXRhZGF0YSA9IHZhbHVlO1xuICAgICAgICAgIGF3YWl0IHRoaXMubG9vbVBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgICAgfSksXG4gICAgICApO1xuXG4gICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAuc2V0TmFtZShcIlBERiBleHBvcnQgbW9kZVwiKVxuICAgICAgLnNldERlc2MoXCJDaG9vc2Ugd2hhdCB0byBpbmNsdWRlIHdoZW4gZXhwb3J0aW5nIG5vdGVzIGNvbnRhaW5pbmcgbG9vbSBjb2RlIGJsb2NrcyB0byBQREYuXCIpXG4gICAgICAuYWRkRHJvcGRvd24oKGRyb3Bkb3duKSA9PlxuICAgICAgICBkcm9wZG93blxuICAgICAgICAgIC5hZGRPcHRpb24oXCJib3RoXCIsIFwiQm90aCBDb2RlIGFuZCBPdXRwdXRcIilcbiAgICAgICAgICAuYWRkT3B0aW9uKFwiY29kZVwiLCBcIkNvZGUgQmxvY2sgT25seVwiKVxuICAgICAgICAgIC5hZGRPcHRpb24oXCJvdXRwdXRcIiwgXCJPdXRwdXQgT25seVwiKVxuICAgICAgICAgIC5zZXRWYWx1ZSh0aGlzLmxvb21QbHVnaW4uc2V0dGluZ3MucGRmRXhwb3J0TW9kZSB8fCBcImJvdGhcIilcbiAgICAgICAgICAub25DaGFuZ2UoYXN5bmMgKHZhbHVlKSA9PiB7XG4gICAgICAgICAgICB0aGlzLmxvb21QbHVnaW4uc2V0dGluZ3MucGRmRXhwb3J0TW9kZSA9IHZhbHVlIGFzIFwiYm90aFwiIHwgXCJjb2RlXCIgfCBcIm91dHB1dFwiO1xuICAgICAgICAgICAgYXdhaXQgdGhpcy5sb29tUGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgICAgICAgIH0pLFxuICAgICAgKTtcbiAgfVxuXG4gIHByaXZhdGUgcmVuZGVyQnVpbHRJblJ1bnRpbWVzKGNvbnRhaW5lckVsOiBIVE1MRWxlbWVudCk6IHZvaWQge1xuICAgIHRoaXMuYWRkVGV4dFNldHRpbmcoY29udGFpbmVyRWwsIFwiUHl0aG9uIGV4ZWN1dGFibGVcIiwgXCJQYXRoIG9yIGNvbW1hbmQgbmFtZSBmb3IgUHl0aG9uLlwiLCBcInB5dGhvbkV4ZWN1dGFibGVcIik7XG4gICAgdGhpcy5hZGRUZXh0U2V0dGluZyhjb250YWluZXJFbCwgXCJOb2RlIGV4ZWN1dGFibGVcIiwgXCJQYXRoIG9yIGNvbW1hbmQgbmFtZSBmb3IgSmF2YVNjcmlwdCBleGVjdXRpb24uXCIsIFwibm9kZUV4ZWN1dGFibGVcIik7XG5cbiAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgIC5zZXROYW1lKFwiVHlwZVNjcmlwdCBydW5uZXIgbW9kZVwiKVxuICAgICAgLnNldERlc2MoXCJVc2UgdHMtbm9kZSBvciB0c3ggZm9yIFR5cGVTY3JpcHQgYmxvY2tzLlwiKVxuICAgICAgLmFkZERyb3Bkb3duKChkcm9wZG93bikgPT5cbiAgICAgICAgZHJvcGRvd25cbiAgICAgICAgICAuYWRkT3B0aW9uKFwidHMtbm9kZVwiLCBcInRzLW5vZGVcIilcbiAgICAgICAgICAuYWRkT3B0aW9uKFwidHN4XCIsIFwidHN4XCIpXG4gICAgICAgICAgLnNldFZhbHVlKHRoaXMubG9vbVBsdWdpbi5zZXR0aW5ncy50eXBlc2NyaXB0TW9kZSlcbiAgICAgICAgICAub25DaGFuZ2UoYXN5bmMgKHZhbHVlKSA9PiB7XG4gICAgICAgICAgICB0aGlzLmxvb21QbHVnaW4uc2V0dGluZ3MudHlwZXNjcmlwdE1vZGUgPSB2YWx1ZSBhcyBcInRzLW5vZGVcIiB8IFwidHN4XCI7XG4gICAgICAgICAgICBhd2FpdCB0aGlzLmxvb21QbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICAgICAgfSksXG4gICAgICApO1xuXG4gICAgdGhpcy5hZGRUZXh0U2V0dGluZyhjb250YWluZXJFbCwgXCJUeXBlU2NyaXB0IHRyYW5zcGlsZXIgZXhlY3V0YWJsZVwiLCBcIkNvbW1hbmQgb3IgcGF0aCBmb3IgdHMtbm9kZSBvciB0c3guXCIsIFwidHlwZXNjcmlwdFRyYW5zcGlsZXJFeGVjdXRhYmxlXCIpO1xuXG4gICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAuc2V0TmFtZShcIk9DYW1sIG1vZGVcIilcbiAgICAgIC5zZXREZXNjKFwiQ2hvb3NlIGJldHdlZW4gdGhlIE9DYW1sIHRvcGxldmVsLCBvY2FtbGMgY29tcGlsYXRpb24sIG9yIGR1bmUgZXhlYy5cIilcbiAgICAgIC5hZGREcm9wZG93bigoZHJvcGRvd24pID0+XG4gICAgICAgIGRyb3Bkb3duXG4gICAgICAgICAgLmFkZE9wdGlvbihcIm9jYW1sXCIsIFwib2NhbWxcIilcbiAgICAgICAgICAuYWRkT3B0aW9uKFwib2NhbWxjXCIsIFwib2NhbWxjXCIpXG4gICAgICAgICAgLmFkZE9wdGlvbihcImR1bmVcIiwgXCJkdW5lXCIpXG4gICAgICAgICAgLnNldFZhbHVlKHRoaXMubG9vbVBsdWdpbi5zZXR0aW5ncy5vY2FtbE1vZGUpXG4gICAgICAgICAgLm9uQ2hhbmdlKGFzeW5jICh2YWx1ZSkgPT4ge1xuICAgICAgICAgICAgdGhpcy5sb29tUGx1Z2luLnNldHRpbmdzLm9jYW1sTW9kZSA9IHZhbHVlIGFzIFwib2NhbWxcIiB8IFwib2NhbWxjXCIgfCBcImR1bmVcIjtcbiAgICAgICAgICAgIGF3YWl0IHRoaXMubG9vbVBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgICAgICB9KSxcbiAgICAgICk7XG5cbiAgICB0aGlzLmFkZFRleHRTZXR0aW5nKGNvbnRhaW5lckVsLCBcIk9DYW1sIGV4ZWN1dGFibGVcIiwgXCJDb21tYW5kIG9yIHBhdGggZm9yIG9jYW1sLCBvY2FtbGMsIG9yIGR1bmUgZGVwZW5kaW5nIG9uIHRoZSBzZWxlY3RlZCBtb2RlLlwiLCBcIm9jYW1sRXhlY3V0YWJsZVwiKTtcbiAgICB0aGlzLmFkZFRleHRTZXR0aW5nKGNvbnRhaW5lckVsLCBcIkMgY29tcGlsZXJcIiwgXCJDb21tYW5kIG9yIHBhdGggZm9yIGNvbXBpbGluZyBDIGJsb2Nrcy5cIiwgXCJjRXhlY3V0YWJsZVwiKTtcbiAgICB0aGlzLmFkZFRleHRTZXR0aW5nKGNvbnRhaW5lckVsLCBcIkMrKyBjb21waWxlclwiLCBcIkNvbW1hbmQgb3IgcGF0aCBmb3IgY29tcGlsaW5nIEMrKyBibG9ja3MuXCIsIFwiY3BwRXhlY3V0YWJsZVwiKTtcbiAgICB0aGlzLmFkZFRleHRTZXR0aW5nKGNvbnRhaW5lckVsLCBcIlNoZWxsIGV4ZWN1dGFibGVcIiwgXCJDb21tYW5kIG9yIHBhdGggZm9yIFNoZWxsLCBCYXNoLCBhbmQgc2ggYmxvY2tzLlwiLCBcInNoZWxsRXhlY3V0YWJsZVwiKTtcbiAgICB0aGlzLmFkZFRleHRTZXR0aW5nKGNvbnRhaW5lckVsLCBcIlJ1YnkgZXhlY3V0YWJsZVwiLCBcIkNvbW1hbmQgb3IgcGF0aCBmb3IgUnVieSBibG9ja3MuXCIsIFwicnVieUV4ZWN1dGFibGVcIik7XG4gICAgdGhpcy5hZGRUZXh0U2V0dGluZyhjb250YWluZXJFbCwgXCJQZXJsIGV4ZWN1dGFibGVcIiwgXCJDb21tYW5kIG9yIHBhdGggZm9yIFBlcmwgYmxvY2tzLlwiLCBcInBlcmxFeGVjdXRhYmxlXCIpO1xuICAgIHRoaXMuYWRkVGV4dFNldHRpbmcoY29udGFpbmVyRWwsIFwiTHVhIGV4ZWN1dGFibGVcIiwgXCJDb21tYW5kIG9yIHBhdGggZm9yIEx1YSBibG9ja3MuXCIsIFwibHVhRXhlY3V0YWJsZVwiKTtcbiAgICB0aGlzLmFkZFRleHRTZXR0aW5nKGNvbnRhaW5lckVsLCBcIlBIUCBleGVjdXRhYmxlXCIsIFwiQ29tbWFuZCBvciBwYXRoIGZvciBQSFAgYmxvY2tzLlwiLCBcInBocEV4ZWN1dGFibGVcIik7XG4gICAgdGhpcy5hZGRUZXh0U2V0dGluZyhjb250YWluZXJFbCwgXCJHbyBleGVjdXRhYmxlXCIsIFwiQ29tbWFuZCBvciBwYXRoIGZvciBHbyBibG9ja3MuXCIsIFwiZ29FeGVjdXRhYmxlXCIpO1xuICAgIHRoaXMuYWRkVGV4dFNldHRpbmcoY29udGFpbmVyRWwsIFwiUnVzdCBjb21waWxlclwiLCBcIkNvbW1hbmQgb3IgcGF0aCBmb3IgY29tcGlsaW5nIFJ1c3QgYmxvY2tzLlwiLCBcInJ1c3RFeGVjdXRhYmxlXCIpO1xuICAgIHRoaXMuYWRkVGV4dFNldHRpbmcoY29udGFpbmVyRWwsIFwiSGFza2VsbCBleGVjdXRhYmxlXCIsIFwiQ29tbWFuZCBvciBwYXRoIGZvciBIYXNrZWxsIGJsb2Nrcy4gRGVmYXVsdHMgdG8gcnVuZ2hjLlwiLCBcImhhc2tlbGxFeGVjdXRhYmxlXCIpO1xuICAgIHRoaXMuYWRkVGV4dFNldHRpbmcoY29udGFpbmVyRWwsIFwiSmF2YSBjb21waWxlclwiLCBcIk9wdGlvbmFsIGNvbW1hbmQgb3IgcGF0aCBmb3IgamF2YWMuIExlYXZlIGVtcHR5IHRvIHVzZSBKYXZhIHNvdXJjZS1maWxlIG1vZGUuXCIsIFwiamF2YUNvbXBpbGVyRXhlY3V0YWJsZVwiKTtcbiAgICB0aGlzLmFkZFRleHRTZXR0aW5nKGNvbnRhaW5lckVsLCBcIkphdmEgZXhlY3V0YWJsZVwiLCBcIkNvbW1hbmQgb3IgcGF0aCBmb3IgcnVubmluZyBjb21waWxlZCBKYXZhIGJsb2Nrcy5cIiwgXCJqYXZhRXhlY3V0YWJsZVwiKTtcbiAgICB0aGlzLmFkZFRleHRTZXR0aW5nKGNvbnRhaW5lckVsLCBcIkxMVk0gSVIgaW50ZXJwcmV0ZXJcIiwgXCJDb21tYW5kIG9yIHBhdGggZm9yIHJ1bm5pbmcgTExWTSBJUiBibG9ja3Mgd2l0aCBsbGkuXCIsIFwibGx2bUludGVycHJldGVyRXhlY3V0YWJsZVwiKTtcbiAgICB0aGlzLmFkZFRleHRTZXR0aW5nKGNvbnRhaW5lckVsLCBcIkxlYW4gZXhlY3V0YWJsZVwiLCBcIkNvbW1hbmQgb3IgcGF0aCBmb3IgY2hlY2tpbmcgTGVhbiBibG9ja3MuXCIsIFwibGVhbkV4ZWN1dGFibGVcIik7XG4gICAgdGhpcy5hZGRUZXh0U2V0dGluZyhjb250YWluZXJFbCwgXCJDb3EgZXhlY3V0YWJsZVwiLCBcIkNvbW1hbmQgb3IgcGF0aCBmb3IgY2hlY2tpbmcgQ29xIGJsb2NrcyB3aXRoIGNvcWMuXCIsIFwiY29xRXhlY3V0YWJsZVwiKTtcbiAgICB0aGlzLmFkZFRleHRTZXR0aW5nKGNvbnRhaW5lckVsLCBcIlNNVCBzb2x2ZXJcIiwgXCJDb21tYW5kIG9yIHBhdGggZm9yIFNNVC1MSUIgYmxvY2tzLiBEZWZhdWx0cyB0byB6My5cIiwgXCJzbXRFeGVjdXRhYmxlXCIpO1xuICB9XG5cbiAgcHJpdmF0ZSByZW5kZXJDdXN0b21MYW5ndWFnZXMoY29udGFpbmVyRWw6IEhUTUxFbGVtZW50KTogdm9pZCB7XG4gICAgY29uc3QgbGlzdEVsID0gY29udGFpbmVyRWwuY3JlYXRlRGl2KHsgY2xzOiBcImxvb20tY3VzdG9tLWxhbmd1YWdlLWxpc3RcIiB9KTtcbiAgICB0aGlzLnJlbmRlckN1c3RvbUxhbmd1YWdlTGlzdChsaXN0RWwpO1xuXG4gICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAuc2V0TmFtZShcIkFkZCBjdXN0b20gbGFuZ3VhZ2VcIilcbiAgICAgIC5zZXREZXNjKFwiQ3JlYXRlIGEgbmV3IGxvY2FsIGNvbW1hbmQtYmFja2VkIGxhbmd1YWdlLlwiKVxuICAgICAgLmFkZEJ1dHRvbigoYnV0dG9uKSA9PlxuICAgICAgICBidXR0b24uc2V0QnV0dG9uVGV4dChcIitcIikub25DbGljayhhc3luYyAoKSA9PiB7XG4gICAgICAgICAgdGhpcy5sb29tUGx1Z2luLnNldHRpbmdzLmN1c3RvbUxhbmd1YWdlcy5wdXNoKHtcbiAgICAgICAgICAgIG5hbWU6IFwiY3VzdG9tLWxhbmd1YWdlXCIsXG4gICAgICAgICAgICBhbGlhc2VzOiBcIlwiLFxuICAgICAgICAgICAgZXhlY3V0YWJsZTogXCJcIixcbiAgICAgICAgICAgIGFyZ3M6IFwie2ZpbGV9XCIsXG4gICAgICAgICAgICBleHRlbnNpb246IFwiLnR4dFwiLFxuICAgICAgICAgICAgZXh0cmFjdG9yTW9kZTogXCJjb21tYW5kXCIsXG4gICAgICAgICAgICBleHRyYWN0b3JFeGVjdXRhYmxlOiBcIlwiLFxuICAgICAgICAgICAgZXh0cmFjdG9yQXJnczogXCJ7cmVxdWVzdH1cIixcbiAgICAgICAgICAgIHRyYW5zcGlsZUV4ZWN1dGFibGU6IFwiXCIsXG4gICAgICAgICAgICB0cmFuc3BpbGVBcmdzOiBcIntyZXF1ZXN0fVwiLFxuICAgICAgICAgIH0pO1xuICAgICAgICAgIGF3YWl0IHRoaXMubG9vbVBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgICAgICB0aGlzLmRpc3BsYXkoKTtcbiAgICAgICAgfSksXG4gICAgICApO1xuICB9XG5cbiAgcHJpdmF0ZSByZW5kZXJDdXN0b21MYW5ndWFnZUxpc3QoY29udGFpbmVyRWw6IEhUTUxFbGVtZW50KTogdm9pZCB7XG4gICAgY29udGFpbmVyRWwuZW1wdHkoKTtcblxuICAgIGlmICghdGhpcy5sb29tUGx1Z2luLnNldHRpbmdzLmN1c3RvbUxhbmd1YWdlcy5sZW5ndGgpIHtcbiAgICAgIGNvbnRhaW5lckVsLmNyZWF0ZUVsKFwicFwiLCB7XG4gICAgICAgIHRleHQ6IFwiTm8gY3VzdG9tIGxhbmd1YWdlcyBjb25maWd1cmVkLlwiLFxuICAgICAgICBjbHM6IFwic2V0dGluZy1pdGVtLWRlc2NyaXB0aW9uXCIsXG4gICAgICB9KTtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICB0aGlzLmxvb21QbHVnaW4uc2V0dGluZ3MuY3VzdG9tTGFuZ3VhZ2VzLmZvckVhY2goKGxhbmd1YWdlLCBpbmRleCkgPT4ge1xuICAgICAgY29uc3QgZGV0YWlscyA9IGNvbnRhaW5lckVsLmNyZWF0ZUVsKFwiZGV0YWlsc1wiLCB7IGNsczogXCJsb29tLWN1c3RvbS1sYW5ndWFnZVwiIH0pO1xuICAgICAgZGV0YWlscy5vcGVuID0gdHJ1ZTtcbiAgICAgIGRldGFpbHMuY3JlYXRlRWwoXCJzdW1tYXJ5XCIsIHsgdGV4dDogbGFuZ3VhZ2UubmFtZSB8fCBgQ3VzdG9tIGxhbmd1YWdlICR7aW5kZXggKyAxfWAgfSk7XG4gICAgICBjb25zdCBib2R5ID0gZGV0YWlscy5jcmVhdGVEaXYoeyBjbHM6IFwibG9vbS1jdXN0b20tbGFuZ3VhZ2UtYm9keVwiIH0pO1xuXG4gICAgICB0aGlzLmFkZEN1c3RvbUxhbmd1YWdlVGV4dFNldHRpbmcoYm9keSwgbGFuZ3VhZ2UsIFwiTmFtZVwiLCBcIk5vcm1hbGl6ZWQgbGFuZ3VhZ2UgaWQgdXNlZCBieSBsb29tLlwiLCBcIm5hbWVcIik7XG4gICAgICB0aGlzLmFkZEN1c3RvbUxhbmd1YWdlVGV4dFNldHRpbmcoYm9keSwgbGFuZ3VhZ2UsIFwiQWxpYXNlc1wiLCBcIkNvbW1hLXNlcGFyYXRlZCBmZW5jZSBhbGlhc2VzLlwiLCBcImFsaWFzZXNcIik7XG4gICAgICB0aGlzLmFkZEN1c3RvbUxhbmd1YWdlVGV4dFNldHRpbmcoYm9keSwgbGFuZ3VhZ2UsIFwiRXhlY3V0YWJsZVwiLCBcIkxvY2FsIGNvbW1hbmQgb3IgYWJzb2x1dGUgZXhlY3V0YWJsZSBwYXRoLlwiLCBcImV4ZWN1dGFibGVcIik7XG4gICAgICB0aGlzLmFkZEN1c3RvbUxhbmd1YWdlVGV4dFNldHRpbmcoYm9keSwgbGFuZ3VhZ2UsIFwiQXJndW1lbnRzXCIsIFwiU3BhY2Utc2VwYXJhdGVkIGFyZ3VtZW50cy4gVXNlIHtmaWxlfSBmb3IgdGhlIHRlbXAgc291cmNlIGZpbGUuXCIsIFwiYXJnc1wiKTtcbiAgICAgIHRoaXMuYWRkQ3VzdG9tTGFuZ3VhZ2VUZXh0U2V0dGluZyhib2R5LCBsYW5ndWFnZSwgXCJFeHRlbnNpb25cIiwgXCJUZW1wIHNvdXJjZSBmaWxlIGV4dGVuc2lvbiwgZm9yIGV4YW1wbGUgLnB5LlwiLCBcImV4dGVuc2lvblwiKTtcblxuICAgICAgbmV3IFNldHRpbmcoYm9keSlcbiAgICAgICAgLnNldE5hbWUoXCJQYXJ0aWFsIGV4dHJhY3Rpb24gc3RyYXRlZ3lcIilcbiAgICAgICAgLnNldERlc2MoXCJDaG9vc2UgaG93IHRoaXMgY3VzdG9tIGxhbmd1YWdlIHN1cHBvcnRzIHBhcnRpYWwgcnVubmFibGUgc291cmNlLlwiKVxuICAgICAgICAuYWRkRHJvcGRvd24oKGRyb3Bkb3duKSA9PlxuICAgICAgICAgIGRyb3Bkb3duXG4gICAgICAgICAgICAuYWRkT3B0aW9uKFwiY29tbWFuZFwiLCBcIkV4dHJhY3RvciBjb21tYW5kXCIpXG4gICAgICAgICAgICAuYWRkT3B0aW9uKFwidHJhbnNwaWxlLWNcIiwgXCJUcmFuc3BpbGUgdG8gQ1wiKVxuICAgICAgICAgICAgLnNldFZhbHVlKGxhbmd1YWdlLmV4dHJhY3Rvck1vZGUgfHwgXCJjb21tYW5kXCIpXG4gICAgICAgICAgICAub25DaGFuZ2UoYXN5bmMgKHZhbHVlKSA9PiB7XG4gICAgICAgICAgICAgIGxhbmd1YWdlLmV4dHJhY3Rvck1vZGUgPSB2YWx1ZSBhcyBcImNvbW1hbmRcIiB8IFwidHJhbnNwaWxlLWNcIjtcbiAgICAgICAgICAgICAgYXdhaXQgdGhpcy5sb29tUGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgICAgICAgICAgfSksXG4gICAgICAgICk7XG5cbiAgICAgIHRoaXMuYWRkQ3VzdG9tTGFuZ3VhZ2VUZXh0U2V0dGluZyhib2R5LCBsYW5ndWFnZSwgXCJFeHRyYWN0b3IgZXhlY3V0YWJsZVwiLCBcIk9wdGlvbmFsIGNvbW1hbmQgZm9yIHBhcnRpYWwgc291cmNlIGV4dHJhY3Rpb24uIExlYXZlIGVtcHR5IHRvIHVzZSBnZW5lcmljIGxpbmUgYW5kIHN5bWJvbCBleHRyYWN0aW9uLlwiLCBcImV4dHJhY3RvckV4ZWN1dGFibGVcIik7XG4gICAgICB0aGlzLmFkZEN1c3RvbUxhbmd1YWdlVGV4dFNldHRpbmcoYm9keSwgbGFuZ3VhZ2UsIFwiRXh0cmFjdG9yIGFyZ3VtZW50c1wiLCBcIkFyZ3VtZW50cyBmb3IgdGhlIGV4dHJhY3Rvci4gVXNlIHtyZXF1ZXN0fSwge3NvdXJjZX0sIHtoYXJuZXNzfSwge3N5bWJvbH0sIHtsaW5lU3RhcnR9LCB7bGluZUVuZH0sIHtkZXBzfSwgYW5kIHtsYW5ndWFnZX0uXCIsIFwiZXh0cmFjdG9yQXJnc1wiKTtcbiAgICAgIHRoaXMuYWRkQ3VzdG9tTGFuZ3VhZ2VUZXh0U2V0dGluZyhib2R5LCBsYW5ndWFnZSwgXCJUcmFuc3BpbGUgdG8gQyBleGVjdXRhYmxlXCIsIFwiT3B0aW9uYWwgY29tbWFuZCB0aGF0IGVtaXRzIGdlbmVyYXRlZCBDIGFuZCBhIHN5bWJvbCBtYXAgYXMgSlNPTi5cIiwgXCJ0cmFuc3BpbGVFeGVjdXRhYmxlXCIpO1xuICAgICAgdGhpcy5hZGRDdXN0b21MYW5ndWFnZVRleHRTZXR0aW5nKGJvZHksIGxhbmd1YWdlLCBcIlRyYW5zcGlsZSB0byBDIGFyZ3VtZW50c1wiLCBcIkFyZ3VtZW50cyBmb3IgdGhlIHRyYW5zcGlsZXIuIFVzZSB0aGUgc2FtZSBwbGFjZWhvbGRlcnMgYXMgZXh0cmFjdG9yIGFyZ3VtZW50cy5cIiwgXCJ0cmFuc3BpbGVBcmdzXCIpO1xuXG4gICAgICBuZXcgU2V0dGluZyhib2R5KVxuICAgICAgICAuc2V0TmFtZShcIkRlbGV0ZSBsYW5ndWFnZVwiKVxuICAgICAgICAuc2V0RGVzYyhcIlJlbW92ZSB0aGlzIGN1c3RvbSBsYW5ndWFnZS5cIilcbiAgICAgICAgLmFkZEJ1dHRvbigoYnV0dG9uKSA9PlxuICAgICAgICAgIGJ1dHRvbi5zZXRCdXR0b25UZXh0KFwiRGVsZXRlXCIpLnNldFdhcm5pbmcoKS5vbkNsaWNrKGFzeW5jICgpID0+IHtcbiAgICAgICAgICAgIHRoaXMubG9vbVBsdWdpbi5zZXR0aW5ncy5jdXN0b21MYW5ndWFnZXMuc3BsaWNlKGluZGV4LCAxKTtcbiAgICAgICAgICAgIGF3YWl0IHRoaXMubG9vbVBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgICAgICAgIHRoaXMuZGlzcGxheSgpO1xuICAgICAgICAgIH0pLFxuICAgICAgICApO1xuICAgIH0pO1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyByZW5kZXJDb250YWluZXJHcm91cHMoY29udGFpbmVyRWw6IEhUTUxFbGVtZW50KTogUHJvbWlzZTx2b2lkPiB7XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IGdyb3VwcyA9IGF3YWl0IHRoaXMubG9vbVBsdWdpbi5nZXRDb250YWluZXJHcm91cFN1bW1hcmllcygpO1xuXG4gICAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgICAgLnNldE5hbWUoXCJEZWZhdWx0IGNvbnRhaW5lcml6YXRpb24gZ3JvdXBcIilcbiAgICAgICAgLnNldERlc2MoXCJUaGUgY29udGFpbmVyIGdyb3VwIHRvIHJ1biBjb2RlIGJsb2NrcyBpbiBieSBkZWZhdWx0IGlmIHRoZSBub3RlIGRvZXMgbm90IHNwZWNpZnkgb25lLlwiKVxuICAgICAgICAuYWRkRHJvcGRvd24oKGRyb3Bkb3duKSA9PiB7XG4gICAgICAgICAgZHJvcGRvd24uYWRkT3B0aW9uKFwiXCIsIFwiTm9uZVwiKTtcbiAgICAgICAgICBmb3IgKGNvbnN0IGdyb3VwIG9mIGdyb3Vwcykge1xuICAgICAgICAgICAgZHJvcGRvd24uYWRkT3B0aW9uKGdyb3VwLm5hbWUsIGdyb3VwLm5hbWUpO1xuICAgICAgICAgIH1cbiAgICAgICAgICBkcm9wZG93bi5zZXRWYWx1ZSh0aGlzLmxvb21QbHVnaW4uc2V0dGluZ3MuZGVmYXVsdENvbnRhaW5lckdyb3VwIHx8IFwiXCIpO1xuICAgICAgICAgIGRyb3Bkb3duLm9uQ2hhbmdlKGFzeW5jICh2YWx1ZSkgPT4ge1xuICAgICAgICAgICAgdGhpcy5sb29tUGx1Z2luLnNldHRpbmdzLmRlZmF1bHRDb250YWluZXJHcm91cCA9IHZhbHVlO1xuICAgICAgICAgICAgYXdhaXQgdGhpcy5sb29tUGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgICAgICAgIH0pO1xuICAgICAgICB9KTtcblxuICAgICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAgIC5zZXROYW1lKFwiQWRkIG5ldyBjb250YWluZXJpemF0aW9uIGdyb3VwXCIpXG4gICAgICAgIC5zZXREZXNjKFwiQ3JlYXRlIGEgbmV3IGNvbnRhaW5lcml6YXRpb24gZ3JvdXAgY29uZmlndXJhdGlvbiBmb2xkZXIuXCIpXG4gICAgICAgIC5hZGRCdXR0b24oKGJ1dHRvbikgPT5cbiAgICAgICAgICBidXR0b24uc2V0QnV0dG9uVGV4dChcIitcIikub25DbGljaygoKSA9PiB7XG4gICAgICAgICAgICBuZXcgQ29udGFpbmVyR3JvdXBOYW1lTW9kYWwodGhpcy5hcHAsIGFzeW5jIChncm91cE5hbWUpID0+IHtcbiAgICAgICAgICAgICAgY29uc3QgY2xlYW5OYW1lID0gZ3JvdXBOYW1lLnRyaW0oKS50b0xvd2VyQ2FzZSgpLnJlcGxhY2UoL1teYS16MC05Xy1dL2csIFwiLVwiKTtcbiAgICAgICAgICAgICAgaWYgKCFjbGVhbk5hbWUpIHtcbiAgICAgICAgICAgICAgICBuZXcgTm90aWNlKFwiSW52YWxpZCBncm91cCBuYW1lLlwiKTtcbiAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICBjb25zdCBwbHVnaW5EaXIgPSB0aGlzLmxvb21QbHVnaW4ubWFuaWZlc3QuZGlyID8/IFwiLm9ic2lkaWFuL3BsdWdpbnMvbG9vbVwiO1xuICAgICAgICAgICAgICBjb25zdCBncm91cFJlbGF0aXZlUGF0aCA9IGAke3BsdWdpbkRpcn0vY29udGFpbmVycy8ke2NsZWFuTmFtZX1gO1xuICAgICAgICAgICAgICBjb25zdCBjb25maWdQYXRoID0gYCR7Z3JvdXBSZWxhdGl2ZVBhdGh9L2NvbmZpZy5qc29uYDtcblxuICAgICAgICAgICAgICBjb25zdCBhZGFwdGVyID0gdGhpcy5hcHAudmF1bHQuYWRhcHRlcjtcbiAgICAgICAgICAgICAgaWYgKGF3YWl0IGFkYXB0ZXIuZXhpc3RzKGdyb3VwUmVsYXRpdmVQYXRoKSkge1xuICAgICAgICAgICAgICAgIG5ldyBOb3RpY2UoXCJDb250YWluZXIgZ3JvdXAgZm9sZGVyIGFscmVhZHkgZXhpc3RzLlwiKTtcbiAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICBhd2FpdCBhZGFwdGVyLm1rZGlyKGdyb3VwUmVsYXRpdmVQYXRoKTtcbiAgICAgICAgICAgICAgY29uc3QgZGVmYXVsdENvbmZpZyA9IHtcbiAgICAgICAgICAgICAgICBydW50aW1lOiBcImRvY2tlclwiLFxuICAgICAgICAgICAgICAgIGltYWdlOiBcInVidW50dTpsYXRlc3RcIixcbiAgICAgICAgICAgICAgICBsYW5ndWFnZXM6IHtcbiAgICAgICAgICAgICAgICAgIHB5dGhvbjoge1xuICAgICAgICAgICAgICAgICAgICBjb21tYW5kOiBcInB5dGhvbjMge2ZpbGV9XCIsXG4gICAgICAgICAgICAgICAgICAgIGV4dGVuc2lvbjogXCIucHlcIlxuICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgfTtcbiAgICAgICAgICAgICAgYXdhaXQgYWRhcHRlci53cml0ZShjb25maWdQYXRoLCBKU09OLnN0cmluZ2lmeShkZWZhdWx0Q29uZmlnLCBudWxsLCAyKSk7XG4gICAgICAgICAgICAgIG5ldyBOb3RpY2UoYENvbnRhaW5lciBncm91cCBcIiR7Y2xlYW5OYW1lfVwiIGNyZWF0ZWQuYCk7XG4gICAgICAgICAgICAgIHRoaXMuZGlzcGxheSgpO1xuICAgICAgICAgICAgfSkub3BlbigpO1xuICAgICAgICAgIH0pLFxuICAgICAgICApO1xuXG4gICAgICBjb25zdCBsaXN0RWwgPSBjb250YWluZXJFbC5jcmVhdGVEaXYoeyBjbHM6IFwibG9vbS1jb250YWluZXItZ3JvdXAtbGlzdFwiIH0pO1xuICAgICAgaWYgKCFncm91cHMubGVuZ3RoKSB7XG4gICAgICAgIGxpc3RFbC5jcmVhdGVFbChcInBcIiwge1xuICAgICAgICAgIHRleHQ6IFwiTm8gY29udGFpbmVyIGdyb3VwcyBmb3VuZCBpbiAub2JzaWRpYW4vcGx1Z2lucy9sb29tL2NvbnRhaW5lcnMuXCIsXG4gICAgICAgICAgY2xzOiBcInNldHRpbmctaXRlbS1kZXNjcmlwdGlvblwiLFxuICAgICAgICB9KTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuXG4gICAgICBmb3IgKGNvbnN0IGdyb3VwIG9mIGdyb3Vwcykge1xuICAgICAgICBuZXcgU2V0dGluZyhsaXN0RWwpXG4gICAgICAgICAgLnNldE5hbWUoZ3JvdXAubmFtZSlcbiAgICAgICAgICAuc2V0RGVzYyhncm91cC5zdGF0dXMpXG4gICAgICAgICAgLmFkZEJ1dHRvbigoYnV0dG9uKSA9PlxuICAgICAgICAgICAgYnV0dG9uLnNldEJ1dHRvblRleHQoXCJCdWlsZCAvIHJlYnVpbGRcIikub25DbGljayhhc3luYyAoKSA9PiB7XG4gICAgICAgICAgICAgIGF3YWl0IHRoaXMubG9vbVBsdWdpbi5idWlsZENvbnRhaW5lckdyb3VwKGdyb3VwLm5hbWUpO1xuICAgICAgICAgICAgfSksXG4gICAgICAgICAgKVxuICAgICAgICAgIC5hZGRCdXR0b24oKGJ1dHRvbikgPT5cbiAgICAgICAgICAgIGJ1dHRvbi5zZXRCdXR0b25UZXh0KFwiRWRpdFwiKS5vbkNsaWNrKCgpID0+IHtcbiAgICAgICAgICAgICAgY29uc3QgcGx1Z2luRGlyID0gdGhpcy5sb29tUGx1Z2luLm1hbmlmZXN0LmRpciA/PyBcIi5vYnNpZGlhbi9wbHVnaW5zL2xvb21cIjtcbiAgICAgICAgICAgICAgbmV3IEVkaXRDb250YWluZXJHcm91cE1vZGFsKHRoaXMubG9vbVBsdWdpbiwgZ3JvdXAubmFtZSwgcGx1Z2luRGlyLCAoKSA9PiB7XG4gICAgICAgICAgICAgICAgdGhpcy5kaXNwbGF5KCk7XG4gICAgICAgICAgICAgIH0pLm9wZW4oKTtcbiAgICAgICAgICAgIH0pLFxuICAgICAgICAgICk7XG4gICAgICB9XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGNvbnRhaW5lckVsLmVtcHR5KCk7XG4gICAgICBjb250YWluZXJFbC5jcmVhdGVFbChcInBcIiwge1xuICAgICAgICB0ZXh0OiBgRXJyb3IgbG9hZGluZyBjb250YWluZXIgZ3JvdXBzOiAke2Vycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogU3RyaW5nKGVycm9yKX1gLFxuICAgICAgICBjbHM6IFwibG9vbS1zZXR0aW5ncy1lcnJvclwiLFxuICAgICAgICBhdHRyOiB7IHN0eWxlOiBcImNvbG9yOiB2YXIoLS10ZXh0LWVycm9yKTsgZm9udC13ZWlnaHQ6IGJvbGQ7IG1hcmdpbjogMWVtIDA7XCIgfVxuICAgICAgfSk7XG4gICAgICBjb25zb2xlLmVycm9yKFwibG9vbTogZmFpbGVkIHRvIHJlbmRlciBjb250YWluZXIgZ3JvdXBzOlwiLCBlcnJvcik7XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBhZGRUZXh0U2V0dGluZzxLIGV4dGVuZHMga2V5b2YgbG9vbVBsdWdpblNldHRpbmdzPihjb250YWluZXJFbDogSFRNTEVsZW1lbnQsIG5hbWU6IHN0cmluZywgZGVzY3JpcHRpb246IHN0cmluZywga2V5OiBLKTogdm9pZCB7XG4gICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAuc2V0TmFtZShuYW1lKVxuICAgICAgLnNldERlc2MoZGVzY3JpcHRpb24pXG4gICAgICAuYWRkVGV4dCgodGV4dCkgPT5cbiAgICAgICAgdGV4dC5zZXRWYWx1ZShTdHJpbmcodGhpcy5sb29tUGx1Z2luLnNldHRpbmdzW2tleV0gPz8gXCJcIikpLm9uQ2hhbmdlKGFzeW5jICh2YWx1ZSkgPT4ge1xuICAgICAgICAgICh0aGlzLmxvb21QbHVnaW4uc2V0dGluZ3Nba2V5XSBhcyBzdHJpbmcpID0gdmFsdWUudHJpbSgpO1xuICAgICAgICAgIGF3YWl0IHRoaXMubG9vbVBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgICAgfSksXG4gICAgICApO1xuICB9XG5cbiAgcHJpdmF0ZSBhZGRDdXN0b21MYW5ndWFnZVRleHRTZXR0aW5nPEsgZXh0ZW5kcyBrZXlvZiBsb29tQ3VzdG9tTGFuZ3VhZ2U+KFxuICAgIGNvbnRhaW5lckVsOiBIVE1MRWxlbWVudCxcbiAgICBsYW5ndWFnZTogbG9vbUN1c3RvbUxhbmd1YWdlLFxuICAgIG5hbWU6IHN0cmluZyxcbiAgICBkZXNjcmlwdGlvbjogc3RyaW5nLFxuICAgIGtleTogSyxcbiAgKTogdm9pZCB7XG4gICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAuc2V0TmFtZShuYW1lKVxuICAgICAgLnNldERlc2MoZGVzY3JpcHRpb24pXG4gICAgICAuYWRkVGV4dCgodGV4dCkgPT5cbiAgICAgICAgdGV4dC5zZXRWYWx1ZShTdHJpbmcobGFuZ3VhZ2Vba2V5XSA/PyBcIlwiKSkub25DaGFuZ2UoYXN5bmMgKHZhbHVlKSA9PiB7XG4gICAgICAgICAgKGxhbmd1YWdlW2tleV0gYXMgc3RyaW5nIHwgdW5kZWZpbmVkKSA9IHZhbHVlLnRyaW0oKTtcbiAgICAgICAgICBhd2FpdCB0aGlzLmxvb21QbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICAgIH0pLFxuICAgICAgKTtcbiAgfVxufVxuXG5leHBvcnQgZnVuY3Rpb24gc2hvd0V4ZWN1dGlvbkRpc2FibGVkTm90aWNlKCk6IHZvaWQge1xuICBuZXcgTm90aWNlKFwibG9vbSBsb2NhbCBleGVjdXRpb24gaXMgZGlzYWJsZWQuIEVuYWJsZSBpdCBpbiBzZXR0aW5ncyBvciBjb25maXJtIHRoZSBleGVjdXRpb24gd2FybmluZyBmaXJzdC5cIik7XG59XG5cbmNsYXNzIENvbnRhaW5lckdyb3VwTmFtZU1vZGFsIGV4dGVuZHMgTW9kYWwge1xuICBwcml2YXRlIG5hbWUgPSBcIlwiO1xuXG4gIGNvbnN0cnVjdG9yKFxuICAgIGFwcDogQXBwLFxuICAgIHByaXZhdGUgcmVhZG9ubHkgb25TdWJtaXQ6IChuYW1lOiBzdHJpbmcpID0+IFByb21pc2U8dm9pZD4sXG4gICkge1xuICAgIHN1cGVyKGFwcCk7XG4gIH1cblxuICBvbk9wZW4oKSB7XG4gICAgY29uc3QgeyBjb250ZW50RWwgfSA9IHRoaXM7XG4gICAgY29udGVudEVsLmVtcHR5KCk7XG4gICAgY29udGVudEVsLmNyZWF0ZUVsKFwiaDJcIiwgeyB0ZXh0OiBcIk5ldyBDb250YWluZXIgR3JvdXAgTmFtZVwiIH0pO1xuXG4gICAgbmV3IFNldHRpbmcoY29udGVudEVsKVxuICAgICAgLnNldE5hbWUoXCJHcm91cCBOYW1lXCIpXG4gICAgICAuc2V0RGVzYyhcIlVzZSBsb3dlcmNhc2UgbGV0dGVycywgbnVtYmVycywgaHlwaGVucywgYW5kIHVuZGVyc2NvcmVzLlwiKVxuICAgICAgLmFkZFRleHQoKHRleHQpID0+XG4gICAgICAgIHRleHQub25DaGFuZ2UoKHZhbHVlKSA9PiB7XG4gICAgICAgICAgdGhpcy5uYW1lID0gdmFsdWU7XG4gICAgICAgIH0pLFxuICAgICAgKTtcblxuICAgIG5ldyBTZXR0aW5nKGNvbnRlbnRFbClcbiAgICAgIC5hZGRCdXR0b24oKGJ0bikgPT5cbiAgICAgICAgYnRuXG4gICAgICAgICAgLnNldEJ1dHRvblRleHQoXCJDcmVhdGVcIilcbiAgICAgICAgICAuc2V0Q3RhKClcbiAgICAgICAgICAub25DbGljayhhc3luYyAoKSA9PiB7XG4gICAgICAgICAgICBhd2FpdCB0aGlzLm9uU3VibWl0KHRoaXMubmFtZSk7XG4gICAgICAgICAgICB0aGlzLmNsb3NlKCk7XG4gICAgICAgICAgfSksXG4gICAgICApO1xuICB9XG59XG5cbmNsYXNzIEVkaXRDb250YWluZXJHcm91cE1vZGFsIGV4dGVuZHMgTW9kYWwge1xuICBwcml2YXRlIGFjdGl2ZVRhYjogXCJnZW5lcmFsXCIgfCBcImxhbmd1YWdlc1wiIHwgXCJkb2NrZXJmaWxlXCIgfCBcInJhd1wiID0gXCJnZW5lcmFsXCI7XG4gIHByaXZhdGUgY29uZmlnT2JqOiBhbnkgPSB7fTtcbiAgcHJpdmF0ZSByYXdKc29uVGV4dCA9IFwiXCI7XG4gIHByaXZhdGUgZG9ja2VyZmlsZVRleHQ6IHN0cmluZyB8IG51bGwgPSBudWxsO1xuICBwcml2YXRlIG5ld0xhbmd1YWdlTmFtZSA9IFwiXCI7XG4gIHByaXZhdGUgdGFiSGVhZGVyRWwhOiBIVE1MRWxlbWVudDtcbiAgcHJpdmF0ZSB0YWJDb250ZW50RWwhOiBIVE1MRWxlbWVudDtcblxuICBjb25zdHJ1Y3RvcihcbiAgICBwcml2YXRlIHJlYWRvbmx5IGxvb21QbHVnaW46IGxvb21QbHVnaW4sXG4gICAgcHJpdmF0ZSByZWFkb25seSBncm91cE5hbWU6IHN0cmluZyxcbiAgICBwcml2YXRlIHJlYWRvbmx5IHBsdWdpbkRpcjogc3RyaW5nLFxuICAgIHByaXZhdGUgcmVhZG9ubHkgb25TYXZlOiAoKSA9PiB2b2lkXG4gICkge1xuICAgIHN1cGVyKGxvb21QbHVnaW4uYXBwKTtcbiAgfVxuXG4gIGFzeW5jIG9uT3BlbigpIHtcbiAgICBjb25zdCB7IGNvbnRlbnRFbCB9ID0gdGhpcztcbiAgICBjb250ZW50RWwuZW1wdHkoKTtcbiAgICBjb250ZW50RWwuY3JlYXRlRWwoXCJoMlwiLCB7IHRleHQ6IGBFZGl0IENvbmZpZzogJHt0aGlzLmdyb3VwTmFtZX1gIH0pO1xuXG4gICAgY29uc3QgY29uZmlnUGF0aCA9IGAke3RoaXMucGx1Z2luRGlyfS9jb250YWluZXJzLyR7dGhpcy5ncm91cE5hbWV9L2NvbmZpZy5qc29uYDtcbiAgICBjb25zdCBkb2NrZXJmaWxlUGF0aCA9IGAke3RoaXMucGx1Z2luRGlyfS9jb250YWluZXJzLyR7dGhpcy5ncm91cE5hbWV9L0RvY2tlcmZpbGVgO1xuICAgIGNvbnN0IGFkYXB0ZXIgPSB0aGlzLmFwcC52YXVsdC5hZGFwdGVyO1xuXG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHJhd0NvbmZpZyA9IGF3YWl0IGFkYXB0ZXIucmVhZChjb25maWdQYXRoKTtcbiAgICAgIHRoaXMuY29uZmlnT2JqID0gSlNPTi5wYXJzZShyYXdDb25maWcpO1xuICAgICAgdGhpcy5yYXdKc29uVGV4dCA9IHJhd0NvbmZpZztcbiAgICB9IGNhdGNoIChlKSB7XG4gICAgICBuZXcgTm90aWNlKFwiQ291bGQgbm90IHJlYWQgY29uZmlndXJhdGlvbiBmaWxlLlwiKTtcbiAgICAgIHRoaXMuY2xvc2UoKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICB0cnkge1xuICAgICAgaWYgKGF3YWl0IGFkYXB0ZXIuZXhpc3RzKGRvY2tlcmZpbGVQYXRoKSkge1xuICAgICAgICB0aGlzLmRvY2tlcmZpbGVUZXh0ID0gYXdhaXQgYWRhcHRlci5yZWFkKGRvY2tlcmZpbGVQYXRoKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHRoaXMuZG9ja2VyZmlsZVRleHQgPSBudWxsO1xuICAgICAgfVxuICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgIHRoaXMuZG9ja2VyZmlsZVRleHQgPSBudWxsO1xuICAgIH1cblxuICAgIGNvbnN0IGNvbnRhaW5lciA9IGNvbnRlbnRFbC5jcmVhdGVEaXYoeyBjbHM6IFwibG9vbS10YWItY29udGFpbmVyXCIgfSk7XG5cbiAgICAvLyBSZW5kZXIgVGFiIEhlYWRlclxuICAgIHRoaXMudGFiSGVhZGVyRWwgPSBjb250YWluZXIuY3JlYXRlRGl2KHsgY2xzOiBcImxvb20tdGFiLWhlYWRlclwiIH0pO1xuICAgIHRoaXMucmVuZGVyVGFicygpO1xuXG4gICAgLy8gUmVuZGVyIFRhYiBDb250ZW50IEFyZWFcbiAgICB0aGlzLnRhYkNvbnRlbnRFbCA9IGNvbnRhaW5lci5jcmVhdGVEaXYoeyBjbHM6IFwibG9vbS10YWItY29udGVudFwiIH0pO1xuXG4gICAgLy8gUmVuZGVyIEFjdGlvbnMgRm9vdGVyXG4gICAgY29uc3QgYWN0aW9ucyA9IGNvbnRlbnRFbC5jcmVhdGVEaXYoeyBjbHM6IFwibG9vbS1tb2RhbC1hY3Rpb25zXCIgfSk7XG4gICAgYWN0aW9ucy5jcmVhdGVFbChcImJ1dHRvblwiLCB7IHRleHQ6IFwiQ2FuY2VsXCIgfSkuYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsICgpID0+IHRoaXMuY2xvc2UoKSk7XG4gICAgY29uc3Qgc2F2ZUJ0biA9IGFjdGlvbnMuY3JlYXRlRWwoXCJidXR0b25cIiwgeyB0ZXh0OiBcIlNhdmVcIiwgY2xzOiBcIm1vZC1jdGFcIiB9KTtcbiAgICBzYXZlQnRuLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCBhc3luYyAoKSA9PiB7XG4gICAgICBhd2FpdCB0aGlzLnNhdmVBbmRDbG9zZSgpO1xuICAgIH0pO1xuXG4gICAgdGhpcy5yZW5kZXJBY3RpdmVUYWIoKTtcbiAgfVxuXG4gIHJlbmRlclRhYnMoKSB7XG4gICAgdGhpcy50YWJIZWFkZXJFbC5lbXB0eSgpO1xuICAgIGNvbnN0IHRhYnM6IEFycmF5PHsgaWQ6IFwiZ2VuZXJhbFwiIHwgXCJsYW5ndWFnZXNcIiB8IFwiZG9ja2VyZmlsZVwiIHwgXCJyYXdcIjsgbGFiZWw6IHN0cmluZyB9PiA9IFtcbiAgICAgIHsgaWQ6IFwiZ2VuZXJhbFwiLCBsYWJlbDogXCJHZW5lcmFsXCIgfSxcbiAgICAgIHsgaWQ6IFwibGFuZ3VhZ2VzXCIsIGxhYmVsOiBcIkxhbmd1YWdlc1wiIH0sXG4gICAgICB7IGlkOiBcImRvY2tlcmZpbGVcIiwgbGFiZWw6IFwiRG9ja2VyZmlsZVwiIH0sXG4gICAgICB7IGlkOiBcInJhd1wiLCBsYWJlbDogXCJSYXcgSlNPTlwiIH0sXG4gICAgXTtcblxuICAgIGZvciAoY29uc3QgdGFiIG9mIHRhYnMpIHtcbiAgICAgIGNvbnN0IGJ0biA9IHRoaXMudGFiSGVhZGVyRWwuY3JlYXRlRWwoXCJidXR0b25cIiwge1xuICAgICAgICB0ZXh0OiB0YWIubGFiZWwsXG4gICAgICAgIGNsczogXCJsb29tLXRhYi1idG5cIiArICh0aGlzLmFjdGl2ZVRhYiA9PT0gdGFiLmlkID8gXCIgaXMtYWN0aXZlXCIgOiBcIlwiKSxcbiAgICAgIH0pO1xuICAgICAgYnRuLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoKSA9PiB7XG4gICAgICAgIHZvaWQgdGhpcy5zd2l0Y2hUYWIodGFiLmlkKTtcbiAgICAgIH0pO1xuICAgIH1cbiAgfVxuXG4gIGFzeW5jIHN3aXRjaFRhYih0YWI6IFwiZ2VuZXJhbFwiIHwgXCJsYW5ndWFnZXNcIiB8IFwiZG9ja2VyZmlsZVwiIHwgXCJyYXdcIikge1xuICAgIGlmICh0aGlzLmFjdGl2ZVRhYiA9PT0gXCJyYXdcIikge1xuICAgICAgdHJ5IHtcbiAgICAgICAgdGhpcy5jb25maWdPYmogPSBKU09OLnBhcnNlKHRoaXMucmF3SnNvblRleHQpO1xuICAgICAgfSBjYXRjaCAoZSkge1xuICAgICAgICBuZXcgTm90aWNlKFwiSW52YWxpZCBKU09OIHN5bnRheCBpbiBSYXcgSlNPTiB0YWIuIFBsZWFzZSBmaXggaXQgYmVmb3JlIHN3aXRjaGluZy5cIik7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cbiAgICB9XG4gICAgdGhpcy5hY3RpdmVUYWIgPSB0YWI7XG4gICAgdGhpcy5yZW5kZXJUYWJzKCk7XG4gICAgdGhpcy5yZW5kZXJBY3RpdmVUYWIoKTtcbiAgfVxuXG4gIHJlbmRlckFjdGl2ZVRhYigpIHtcbiAgICB0aGlzLnRhYkNvbnRlbnRFbC5lbXB0eSgpO1xuICAgIGlmICh0aGlzLmFjdGl2ZVRhYiA9PT0gXCJnZW5lcmFsXCIpIHtcbiAgICAgIHRoaXMucmVuZGVyR2VuZXJhbFRhYih0aGlzLnRhYkNvbnRlbnRFbCk7XG4gICAgfSBlbHNlIGlmICh0aGlzLmFjdGl2ZVRhYiA9PT0gXCJsYW5ndWFnZXNcIikge1xuICAgICAgdGhpcy5yZW5kZXJMYW5ndWFnZXNUYWIodGhpcy50YWJDb250ZW50RWwpO1xuICAgIH0gZWxzZSBpZiAodGhpcy5hY3RpdmVUYWIgPT09IFwiZG9ja2VyZmlsZVwiKSB7XG4gICAgICB0aGlzLnJlbmRlckRvY2tlcmZpbGVUYWIodGhpcy50YWJDb250ZW50RWwpO1xuICAgIH0gZWxzZSBpZiAodGhpcy5hY3RpdmVUYWIgPT09IFwicmF3XCIpIHtcbiAgICAgIHRoaXMucmVuZGVyUmF3VGFiKHRoaXMudGFiQ29udGVudEVsKTtcbiAgICB9XG4gIH1cblxuICByZW5kZXJHZW5lcmFsVGFiKGNvbnRhaW5lckVsOiBIVE1MRWxlbWVudCkge1xuICAgIC8vIFJ1bnRpbWUgc2VsZWN0IGRyb3Bkb3duXG4gICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAuc2V0TmFtZShcIlJ1bnRpbWVcIilcbiAgICAgIC5zZXREZXNjKFwiQ2hvb3NlIHRoZSBjb250YWluZXIvZW52aXJvbm1lbnQgbWFuYWdlciBydW50aW1lLlwiKVxuICAgICAgLmFkZERyb3Bkb3duKChkcm9wZG93bikgPT4ge1xuICAgICAgICBkcm9wZG93blxuICAgICAgICAgIC5hZGRPcHRpb24oXCJkb2NrZXJcIiwgXCJEb2NrZXJcIilcbiAgICAgICAgICAuYWRkT3B0aW9uKFwicG9kbWFuXCIsIFwiUG9kbWFuXCIpXG4gICAgICAgICAgLmFkZE9wdGlvbihcIndzbFwiLCBcIldTTFwiKVxuICAgICAgICAgIC5hZGRPcHRpb24oXCJxZW11XCIsIFwiUUVNVVwiKVxuICAgICAgICAgIC5hZGRPcHRpb24oXCJjdXN0b21cIiwgXCJDdXN0b21cIilcbiAgICAgICAgICAuc2V0VmFsdWUodGhpcy5jb25maWdPYmoucnVudGltZSB8fCBcImRvY2tlclwiKVxuICAgICAgICAgIC5vbkNoYW5nZSgodmFsdWUpID0+IHtcbiAgICAgICAgICAgIHRoaXMuY29uZmlnT2JqLnJ1bnRpbWUgPSB2YWx1ZTtcbiAgICAgICAgICAgIHRoaXMucmVuZGVyQWN0aXZlVGFiKCk7XG4gICAgICAgICAgfSk7XG4gICAgICB9KTtcblxuICAgIC8vIENvbmRpdGlvbmFsIGltYWdlL2Rpc3RybyBuYW1lXG4gICAgaWYgKFxuICAgICAgdGhpcy5jb25maWdPYmoucnVudGltZSA9PT0gXCJkb2NrZXJcIiB8fFxuICAgICAgdGhpcy5jb25maWdPYmoucnVudGltZSA9PT0gXCJwb2RtYW5cIiB8fFxuICAgICAgdGhpcy5jb25maWdPYmoucnVudGltZSA9PT0gXCJ3c2xcIlxuICAgICkge1xuICAgICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAgIC5zZXROYW1lKHRoaXMuY29uZmlnT2JqLnJ1bnRpbWUgPT09IFwid3NsXCIgPyBcIldTTCBEaXN0cm9cIiA6IFwiQmFzZSBJbWFnZVwiKVxuICAgICAgICAuc2V0RGVzYyhcbiAgICAgICAgICB0aGlzLmNvbmZpZ09iai5ydW50aW1lID09PSBcIndzbFwiXG4gICAgICAgICAgICA/IFwiT3B0aW9uYWwuIFRoZSB0YXJnZXQgV1NMIGRpc3RybyBuYW1lIChsZWF2ZSBlbXB0eSBmb3IgZGVmYXVsdCBkaXN0cm8pLlwiXG4gICAgICAgICAgICA6IFwiRmFsbGJhY2sgRG9ja2VyL1BvZG1hbiBpbWFnZSBpZiBubyBEb2NrZXJmaWxlIGlzIHByZXNlbnQuXCJcbiAgICAgICAgKVxuICAgICAgICAuYWRkVGV4dCgodGV4dCkgPT4ge1xuICAgICAgICAgIHRleHRcbiAgICAgICAgICAgIC5zZXRWYWx1ZSh0aGlzLmNvbmZpZ09iai5pbWFnZSB8fCBcIlwiKVxuICAgICAgICAgICAgLm9uQ2hhbmdlKCh2YWwpID0+IHtcbiAgICAgICAgICAgICAgdGhpcy5jb25maWdPYmouaW1hZ2UgPSB2YWwudHJpbSgpO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIGlmICh0aGlzLmNvbmZpZ09iai5ydW50aW1lID09PSBcIndzbFwiKSB7XG4gICAgICBpZiAoIXRoaXMuY29uZmlnT2JqLndzbCkge1xuICAgICAgICB0aGlzLmNvbmZpZ09iai53c2wgPSB7fTtcbiAgICAgIH1cbiAgICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxuICAgICAgICAuc2V0TmFtZShcIlVzZSBJbnRlcmFjdGl2ZSBTaGVsbFwiKVxuICAgICAgICAuc2V0RGVzYyhcIlVzZSBpbnRlcmFjdGl2ZSBsb2dpbiBzaGVsbCBmbGFncyAoLWkgLWwpIHRvIGVuc3VyZSB+Ly5iYXNocmMgaW5pdGlhbGl6YXRpb24gd29ya3MgKGUuZy4sIGZvciBOVk0pLlwiKVxuICAgICAgICAuYWRkVG9nZ2xlKCh0b2dnbGUpID0+IHtcbiAgICAgICAgICB0b2dnbGVcbiAgICAgICAgICAgIC5zZXRWYWx1ZSh0aGlzLmNvbmZpZ09iai53c2wuaW50ZXJhY3RpdmUgPz8gZmFsc2UpXG4gICAgICAgICAgICAub25DaGFuZ2UoKHZhbCkgPT4ge1xuICAgICAgICAgICAgICB0aGlzLmNvbmZpZ09iai53c2wuaW50ZXJhY3RpdmUgPSB2YWw7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgLy8gQ29uZGl0aW9uYWwgUUVNVSBTZXR0aW5nc1xuICAgIGlmICh0aGlzLmNvbmZpZ09iai5ydW50aW1lID09PSBcInFlbXVcIikge1xuICAgICAgaWYgKCF0aGlzLmNvbmZpZ09iai5xZW11KSB7XG4gICAgICAgIHRoaXMuY29uZmlnT2JqLnFlbXUgPSB7IHNzaFRhcmdldDogXCJcIiwgcmVtb3RlV29ya3NwYWNlOiBcIlwiIH07XG4gICAgICB9XG5cbiAgICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxuICAgICAgICAuc2V0TmFtZShcIlNTSCBUYXJnZXRcIilcbiAgICAgICAgLnNldERlc2MoXCJTU0ggdGFyZ2V0IGFkZHJlc3MgKGUuZy4gdXNlckBob3N0bmFtZSBvciBsb2NhbGhvc3QgLXAgMjIyMikuXCIpXG4gICAgICAgIC5hZGRUZXh0KCh0ZXh0KSA9PiB7XG4gICAgICAgICAgdGV4dFxuICAgICAgICAgICAgLnNldFZhbHVlKHRoaXMuY29uZmlnT2JqLnFlbXUuc3NoVGFyZ2V0IHx8IFwiXCIpXG4gICAgICAgICAgICAub25DaGFuZ2UoKHZhbCkgPT4ge1xuICAgICAgICAgICAgICB0aGlzLmNvbmZpZ09iai5xZW11LnNzaFRhcmdldCA9IHZhbC50cmltKCk7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfSk7XG5cbiAgICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxuICAgICAgICAuc2V0TmFtZShcIlJlbW90ZSBXb3Jrc3BhY2VcIilcbiAgICAgICAgLnNldERlc2MoXCJSZW1vdGUgZm9sZGVyIHBhdGggdG8gY29weSBjb2RlIHNuaXBwZXRzIGFuZCBydW4gY29tbWFuZHMgKGUuZy4sIC9ob21lL3VzZXIvd29ya3NwYWNlKS5cIilcbiAgICAgICAgLmFkZFRleHQoKHRleHQpID0+IHtcbiAgICAgICAgICB0ZXh0XG4gICAgICAgICAgICAuc2V0VmFsdWUodGhpcy5jb25maWdPYmoucWVtdS5yZW1vdGVXb3Jrc3BhY2UgfHwgXCJcIilcbiAgICAgICAgICAgIC5vbkNoYW5nZSgodmFsKSA9PiB7XG4gICAgICAgICAgICAgIHRoaXMuY29uZmlnT2JqLnFlbXUucmVtb3RlV29ya3NwYWNlID0gdmFsLnRyaW0oKTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9KTtcblxuICAgICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAgIC5zZXROYW1lKFwiU1NIIEV4ZWN1dGFibGVcIilcbiAgICAgICAgLnNldERlc2MoXCJPcHRpb25hbC4gUGF0aCB0byBTU0ggY2xpZW50IGV4ZWN1dGFibGUgKGRlZmF1bHRzIHRvIHNzaCkuXCIpXG4gICAgICAgIC5hZGRUZXh0KCh0ZXh0KSA9PiB7XG4gICAgICAgICAgdGV4dFxuICAgICAgICAgICAgLnNldFZhbHVlKHRoaXMuY29uZmlnT2JqLnFlbXUuc3NoRXhlY3V0YWJsZSB8fCBcIlwiKVxuICAgICAgICAgICAgLm9uQ2hhbmdlKCh2YWwpID0+IHtcbiAgICAgICAgICAgICAgdGhpcy5jb25maWdPYmoucWVtdS5zc2hFeGVjdXRhYmxlID0gdmFsLnRyaW0oKSB8fCB1bmRlZmluZWQ7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfSk7XG5cbiAgICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxuICAgICAgICAuc2V0TmFtZShcIlNTSCBBcmd1bWVudHNcIilcbiAgICAgICAgLnNldERlc2MoXCJPcHRpb25hbC4gQWRkaXRpb25hbCBTU0ggQ0xJIGZsYWdzLlwiKVxuICAgICAgICAuYWRkVGV4dCgodGV4dCkgPT4ge1xuICAgICAgICAgIHRleHRcbiAgICAgICAgICAgIC5zZXRWYWx1ZSh0aGlzLmNvbmZpZ09iai5xZW11LnNzaEFyZ3MgfHwgXCJcIilcbiAgICAgICAgICAgIC5vbkNoYW5nZSgodmFsKSA9PiB7XG4gICAgICAgICAgICAgIHRoaXMuY29uZmlnT2JqLnFlbXUuc3NoQXJncyA9IHZhbC50cmltKCkgfHwgdW5kZWZpbmVkO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIC8vIENvbmRpdGlvbmFsIEN1c3RvbSBTZXR0aW5nc1xuICAgIGlmICh0aGlzLmNvbmZpZ09iai5ydW50aW1lID09PSBcImN1c3RvbVwiKSB7XG4gICAgICBpZiAoIXRoaXMuY29uZmlnT2JqLmN1c3RvbSkge1xuICAgICAgICB0aGlzLmNvbmZpZ09iai5jdXN0b20gPSB7IGV4ZWN1dGFibGU6IFwiXCIgfTtcbiAgICAgIH1cblxuICAgICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAgIC5zZXROYW1lKFwiQ3VzdG9tIEV4ZWN1dGFibGVcIilcbiAgICAgICAgLnNldERlc2MoXCJQYXRoIHRvIGN1c3RvbSBydW50aW1lIHdyYXBwZXIgZXhlY3V0YWJsZSBvciBzY3JpcHQuXCIpXG4gICAgICAgIC5hZGRUZXh0KCh0ZXh0KSA9PiB7XG4gICAgICAgICAgdGV4dFxuICAgICAgICAgICAgLnNldFZhbHVlKHRoaXMuY29uZmlnT2JqLmN1c3RvbS5leGVjdXRhYmxlIHx8IFwiXCIpXG4gICAgICAgICAgICAub25DaGFuZ2UoKHZhbCkgPT4ge1xuICAgICAgICAgICAgICB0aGlzLmNvbmZpZ09iai5jdXN0b20uZXhlY3V0YWJsZSA9IHZhbC50cmltKCk7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfSk7XG5cbiAgICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxuICAgICAgICAuc2V0TmFtZShcIkN1c3RvbSBBcmd1bWVudHNcIilcbiAgICAgICAgLnNldERlc2MoXCJPcHRpb25hbC4gQ29tbWFuZCBhcmd1bWVudHMuIFVzZSB7cmVxdWVzdH0gZm9yIEpTT04gY29uZmlnIHBhdGguXCIpXG4gICAgICAgIC5hZGRUZXh0KCh0ZXh0KSA9PiB7XG4gICAgICAgICAgdGV4dFxuICAgICAgICAgICAgLnNldFZhbHVlKHRoaXMuY29uZmlnT2JqLmN1c3RvbS5hcmdzIHx8IFwiXCIpXG4gICAgICAgICAgICAub25DaGFuZ2UoKHZhbCkgPT4ge1xuICAgICAgICAgICAgICB0aGlzLmNvbmZpZ09iai5jdXN0b20uYXJncyA9IHZhbC50cmltKCkgfHwgdW5kZWZpbmVkO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgIH0pO1xuICAgIH1cbiAgfVxuXG4gIHJlbmRlckxhbmd1YWdlc1RhYihjb250YWluZXJFbDogSFRNTEVsZW1lbnQpIHtcbiAgICBjb250YWluZXJFbC5jcmVhdGVFbChcImgzXCIsIHsgdGV4dDogXCJDb25maWd1cmVkIExhbmd1YWdlc1wiIH0pO1xuXG4gICAgaWYgKCF0aGlzLmNvbmZpZ09iai5sYW5ndWFnZXMpIHtcbiAgICAgIHRoaXMuY29uZmlnT2JqLmxhbmd1YWdlcyA9IHt9O1xuICAgIH1cblxuICAgIGNvbnN0IGxhbmdzTGlzdEVsID0gY29udGFpbmVyRWwuY3JlYXRlRGl2KHsgY2xzOiBcImxvb20tbGFuZ3VhZ2VzLWxpc3RcIiB9KTtcbiAgICBjb25zdCBsYW5ndWFnZXMgPSBPYmplY3QuZW50cmllcyh0aGlzLmNvbmZpZ09iai5sYW5ndWFnZXMgYXMgUmVjb3JkPHN0cmluZywgeyBjb21tYW5kPzogc3RyaW5nOyBleHRlbnNpb24/OiBzdHJpbmc7IHVzZURlZmF1bHQ/OiBib29sZWFuIH0+KTtcblxuICAgIGlmIChsYW5ndWFnZXMubGVuZ3RoID09PSAwKSB7XG4gICAgICBsYW5nc0xpc3RFbC5jcmVhdGVFbChcInBcIiwgeyB0ZXh0OiBcIk5vIGxhbmd1YWdlcyBjb25maWd1cmVkIGZvciB0aGlzIGdyb3VwLlwiLCBjbHM6IFwic2V0dGluZy1pdGVtLWRlc2NyaXB0aW9uXCIgfSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIGZvciAoY29uc3QgW2xhbmdOYW1lLCBsYW5nQ29uZmlnXSBvZiBsYW5ndWFnZXMpIHtcbiAgICAgICAgY29uc3QgY2FyZCA9IGxhbmdzTGlzdEVsLmNyZWF0ZURpdih7IGNsczogXCJsb29tLWxhbmd1YWdlLWNhcmRcIiB9KTtcbiAgICAgICAgY2FyZC5jcmVhdGVFbChcInN0cm9uZ1wiLCB7IHRleHQ6IGxhbmdOYW1lLCBhdHRyOiB7IHN0eWxlOiBcImRpc3BsYXk6IGJsb2NrOyBtYXJnaW4tYm90dG9tOiAwLjVyZW07IGZvbnQtc2l6ZTogMS4xZW07XCIgfSB9KTtcblxuICAgICAgICBjb25zdCBpc0RlZmF1bHQgPSAobGFuZ0NvbmZpZyBhcyBhbnkpLnVzZURlZmF1bHQgPT09IHRydWU7XG5cbiAgICAgICAgbmV3IFNldHRpbmcoY2FyZClcbiAgICAgICAgICAuc2V0TmFtZShcIlVzZSBkZWZhdWx0IGNvbmZpZ3VyYXRpb25cIilcbiAgICAgICAgICAuc2V0RGVzYyhcIklmIGNoZWNrZWQsIExvb20gd2lsbCBydW4gdGhpcyBsYW5ndWFnZSB1c2luZyBpdHMgYnVpbHQtaW4gY29tbWFuZHMvZXh0ZW5zaW9ucy5cIilcbiAgICAgICAgICAuYWRkVG9nZ2xlKCh0b2dnbGUpID0+IHtcbiAgICAgICAgICAgIHRvZ2dsZVxuICAgICAgICAgICAgICAuc2V0VmFsdWUoaXNEZWZhdWx0KVxuICAgICAgICAgICAgICAub25DaGFuZ2UoKHZhbCkgPT4ge1xuICAgICAgICAgICAgICAgIGlmICh2YWwpIHtcbiAgICAgICAgICAgICAgICAgIChsYW5nQ29uZmlnIGFzIGFueSkudXNlRGVmYXVsdCA9IHRydWU7XG4gICAgICAgICAgICAgICAgICBkZWxldGUgbGFuZ0NvbmZpZy5jb21tYW5kO1xuICAgICAgICAgICAgICAgICAgZGVsZXRlIGxhbmdDb25maWcuZXh0ZW5zaW9uO1xuICAgICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgICBkZWxldGUgKGxhbmdDb25maWcgYXMgYW55KS51c2VEZWZhdWx0O1xuICAgICAgICAgICAgICAgICAgY29uc3QgZGVmYXVsdHMgPSB0aGlzLmxvb21QbHVnaW4uY29udGFpbmVyUnVubmVyLmdldERlZmF1bHRMYW5ndWFnZUNvbmZpZyhsYW5nTmFtZSwgdGhpcy5sb29tUGx1Z2luLnNldHRpbmdzKTtcbiAgICAgICAgICAgICAgICAgIGxhbmdDb25maWcuY29tbWFuZCA9IGRlZmF1bHRzPy5jb21tYW5kIHx8IFwiXCI7XG4gICAgICAgICAgICAgICAgICBsYW5nQ29uZmlnLmV4dGVuc2lvbiA9IGRlZmF1bHRzPy5leHRlbnNpb24gfHwgXCJcIjtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgdGhpcy5yZW5kZXJBY3RpdmVUYWIoKTtcbiAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgfSk7XG5cbiAgICAgICAgbmV3IFNldHRpbmcoY2FyZClcbiAgICAgICAgICAuc2V0TmFtZShcIkNvbW1hbmRcIilcbiAgICAgICAgICAuc2V0RGVzYyhcIkV4ZWN1dGlvbiBjb21tYW5kLiBVc2Uge2ZpbGV9IGZvciB0aGUgY29kZSBzbmlwcGV0IGZpbGVuYW1lLlwiKVxuICAgICAgICAgIC5hZGRUZXh0KCh0ZXh0KSA9PiB7XG4gICAgICAgICAgICBjb25zdCBkZWZhdWx0cyA9IHRoaXMubG9vbVBsdWdpbi5jb250YWluZXJSdW5uZXIuZ2V0RGVmYXVsdExhbmd1YWdlQ29uZmlnKGxhbmdOYW1lLCB0aGlzLmxvb21QbHVnaW4uc2V0dGluZ3MpO1xuICAgICAgICAgICAgdGV4dFxuICAgICAgICAgICAgICAuc2V0UGxhY2Vob2xkZXIoZGVmYXVsdHM/LmNvbW1hbmQgfHwgXCJcIilcbiAgICAgICAgICAgICAgLnNldFZhbHVlKGxhbmdDb25maWcuY29tbWFuZCB8fCBcIlwiKVxuICAgICAgICAgICAgICAuc2V0RGlzYWJsZWQoaXNEZWZhdWx0KVxuICAgICAgICAgICAgICAub25DaGFuZ2UoKHZhbCkgPT4ge1xuICAgICAgICAgICAgICAgIGxhbmdDb25maWcuY29tbWFuZCA9IHZhbC50cmltKCk7XG4gICAgICAgICAgICAgIH0pO1xuICAgICAgICAgIH0pO1xuXG4gICAgICAgIG5ldyBTZXR0aW5nKGNhcmQpXG4gICAgICAgICAgLnNldE5hbWUoXCJFeHRlbnNpb25cIilcbiAgICAgICAgICAuc2V0RGVzYyhcIlNvdXJjZSBmaWxlIGV4dGVuc2lvbiAoZS5nLiAucHksIC5qcykuXCIpXG4gICAgICAgICAgLmFkZFRleHQoKHRleHQpID0+IHtcbiAgICAgICAgICAgIGNvbnN0IGRlZmF1bHRzID0gdGhpcy5sb29tUGx1Z2luLmNvbnRhaW5lclJ1bm5lci5nZXREZWZhdWx0TGFuZ3VhZ2VDb25maWcobGFuZ05hbWUsIHRoaXMubG9vbVBsdWdpbi5zZXR0aW5ncyk7XG4gICAgICAgICAgICB0ZXh0XG4gICAgICAgICAgICAgIC5zZXRQbGFjZWhvbGRlcihkZWZhdWx0cz8uZXh0ZW5zaW9uIHx8IFwiXCIpXG4gICAgICAgICAgICAgIC5zZXRWYWx1ZShsYW5nQ29uZmlnLmV4dGVuc2lvbiB8fCBcIlwiKVxuICAgICAgICAgICAgICAuc2V0RGlzYWJsZWQoaXNEZWZhdWx0KVxuICAgICAgICAgICAgICAub25DaGFuZ2UoKHZhbCkgPT4ge1xuICAgICAgICAgICAgICAgIGxhbmdDb25maWcuZXh0ZW5zaW9uID0gdmFsLnRyaW0oKTtcbiAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgfSk7XG5cbiAgICAgICAgbmV3IFNldHRpbmcoY2FyZClcbiAgICAgICAgICAuYWRkQnV0dG9uKChidG4pID0+IHtcbiAgICAgICAgICAgIGJ0blxuICAgICAgICAgICAgICAuc2V0QnV0dG9uVGV4dChcIlJlbW92ZSBMYW5ndWFnZVwiKVxuICAgICAgICAgICAgICAuc2V0V2FybmluZygpXG4gICAgICAgICAgICAgIC5vbkNsaWNrKCgpID0+IHtcbiAgICAgICAgICAgICAgICBkZWxldGUgdGhpcy5jb25maWdPYmoubGFuZ3VhZ2VzW2xhbmdOYW1lXTtcbiAgICAgICAgICAgICAgICB0aGlzLnJlbmRlckFjdGl2ZVRhYigpO1xuICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICB9KTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBBZGQgTGFuZ3VhZ2UgU2VjdGlvblxuICAgIGNvbnRhaW5lckVsLmNyZWF0ZUVsKFwiaDNcIiwgeyB0ZXh0OiBcIkFkZCBMYW5ndWFnZSBNYXBwaW5nXCIsIGF0dHI6IHsgc3R5bGU6IFwibWFyZ2luLXRvcDogMS41cmVtO1wiIH0gfSk7XG4gICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAuc2V0TmFtZShcIkxhbmd1YWdlIElEXCIpXG4gICAgICAuc2V0RGVzYyhcImUuZy4gcHl0aG9uLCBqYXZhc2NyaXB0LCBub2RlLCBzaFwiKVxuICAgICAgLmFkZFRleHQoKHRleHQpID0+IHtcbiAgICAgICAgdGV4dC5zZXRWYWx1ZSh0aGlzLm5ld0xhbmd1YWdlTmFtZSkub25DaGFuZ2UoKHZhbCkgPT4ge1xuICAgICAgICAgIHRoaXMubmV3TGFuZ3VhZ2VOYW1lID0gdmFsLnRyaW0oKS50b0xvd2VyQ2FzZSgpO1xuICAgICAgICB9KTtcbiAgICAgIH0pXG4gICAgICAuYWRkQnV0dG9uKChidG4pID0+IHtcbiAgICAgICAgYnRuLnNldEJ1dHRvblRleHQoXCIrIEFkZFwiKS5zZXRDdGEoKS5vbkNsaWNrKCgpID0+IHtcbiAgICAgICAgICBpZiAoIXRoaXMubmV3TGFuZ3VhZ2VOYW1lKSB7XG4gICAgICAgICAgICBuZXcgTm90aWNlKFwiUGxlYXNlIGVudGVyIGEgbGFuZ3VhZ2UgbmFtZS5cIik7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgfVxuICAgICAgICAgIGlmICh0aGlzLmNvbmZpZ09iai5sYW5ndWFnZXNbdGhpcy5uZXdMYW5ndWFnZU5hbWVdKSB7XG4gICAgICAgICAgICBuZXcgTm90aWNlKFwiTGFuZ3VhZ2UgYWxyZWFkeSBjb25maWd1cmVkLlwiKTtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICB9XG4gICAgICAgICAgdGhpcy5jb25maWdPYmoubGFuZ3VhZ2VzW3RoaXMubmV3TGFuZ3VhZ2VOYW1lXSA9IHtcbiAgICAgICAgICAgIGNvbW1hbmQ6IGAke3RoaXMubmV3TGFuZ3VhZ2VOYW1lfSB7ZmlsZX1gLFxuICAgICAgICAgICAgZXh0ZW5zaW9uOiBgLiR7dGhpcy5uZXdMYW5ndWFnZU5hbWV9YCxcbiAgICAgICAgICB9O1xuICAgICAgICAgIHRoaXMubmV3TGFuZ3VhZ2VOYW1lID0gXCJcIjtcbiAgICAgICAgICB0aGlzLnJlbmRlckFjdGl2ZVRhYigpO1xuICAgICAgICB9KTtcbiAgICAgIH0pO1xuICB9XG5cbiAgcmVuZGVyRG9ja2VyZmlsZVRhYihjb250YWluZXJFbDogSFRNTEVsZW1lbnQpIHtcbiAgICBpZiAodGhpcy5jb25maWdPYmoucnVudGltZSAhPT0gXCJkb2NrZXJcIiAmJiB0aGlzLmNvbmZpZ09iai5ydW50aW1lICE9PSBcInBvZG1hblwiKSB7XG4gICAgICBjb250YWluZXJFbC5jcmVhdGVFbChcInBcIiwge1xuICAgICAgICB0ZXh0OiBgRG9ja2VyZmlsZSBlZGl0aW5nIGlzIG9ubHkgYXZhaWxhYmxlIGZvciBEb2NrZXIgYW5kIFBvZG1hbiBydW50aW1lcy4gQ3VycmVudGx5IHVzaW5nOiAke3RoaXMuY29uZmlnT2JqLnJ1bnRpbWV9YCxcbiAgICAgICAgY2xzOiBcInNldHRpbmctaXRlbS1kZXNjcmlwdGlvblwiLFxuICAgICAgfSk7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgaWYgKHRoaXMuZG9ja2VyZmlsZVRleHQgPT09IG51bGwpIHtcbiAgICAgIGNvbnRhaW5lckVsLmNyZWF0ZUVsKFwicFwiLCB7XG4gICAgICAgIHRleHQ6IFwiTm8gRG9ja2VyZmlsZSBleGlzdHMgaW4gdGhpcyBjb250YWluZXIgZ3JvdXAgZGlyZWN0b3J5LlwiLFxuICAgICAgICBjbHM6IFwic2V0dGluZy1pdGVtLWRlc2NyaXB0aW9uXCIsXG4gICAgICB9KTtcblxuICAgICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAgIC5hZGRCdXR0b24oKGJ0bikgPT4ge1xuICAgICAgICAgIGJ0blxuICAgICAgICAgICAgLnNldEJ1dHRvblRleHQoXCJDcmVhdGUgRG9ja2VyZmlsZVwiKVxuICAgICAgICAgICAgLnNldEN0YSgpXG4gICAgICAgICAgICAub25DbGljaygoKSA9PiB7XG4gICAgICAgICAgICAgIHRoaXMuZG9ja2VyZmlsZVRleHQgPSBbXG4gICAgICAgICAgICAgICAgXCJGUk9NIHVidW50dTpsYXRlc3RcIixcbiAgICAgICAgICAgICAgICBcIlwiLFxuICAgICAgICAgICAgICAgIFwiIyBJbnN0YWxsIHBhY2thZ2VzXCIsXG4gICAgICAgICAgICAgICAgXCJSVU4gYXB0LWdldCB1cGRhdGUgJiYgYXB0LWdldCBpbnN0YWxsIC15IFxcXFxcIixcbiAgICAgICAgICAgICAgICBcIiAgICBweXRob24zIFxcXFxcIixcbiAgICAgICAgICAgICAgICBcIiAgICBub2RlanMgXFxcXFwiLFxuICAgICAgICAgICAgICAgIFwiICAgICYmIHJtIC1yZiAvdmFyL2xpYi9hcHQvbGlzdHMvKlwiLFxuICAgICAgICAgICAgICAgIFwiXCIsXG4gICAgICAgICAgICAgIF0uam9pbihcIlxcblwiKTtcbiAgICAgICAgICAgICAgdGhpcy5yZW5kZXJBY3RpdmVUYWIoKTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9KTtcbiAgICB9IGVsc2Uge1xuICAgICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAgIC5zZXROYW1lKFwiRG9ja2VyZmlsZSBDb250ZW50XCIpXG4gICAgICAgIC5zZXREZXNjKFwiRGVmaW5lIHRoZSBidWlsZCBzdGVwcyBmb3IgeW91ciBlbnZpcm9ubWVudCBjb250YWluZXIuXCIpXG4gICAgICAgIC5hZGRUZXh0QXJlYSgodGV4dCkgPT4ge1xuICAgICAgICAgIHRleHQuaW5wdXRFbC5yb3dzID0gMTU7XG4gICAgICAgICAgdGV4dC5pbnB1dEVsLnN0eWxlLmZvbnRGYW1pbHkgPSBcIm1vbm9zcGFjZVwiO1xuICAgICAgICAgIHRleHQuaW5wdXRFbC5zdHlsZS53aWR0aCA9IFwiMTAwJVwiO1xuICAgICAgICAgIHRleHQuc2V0VmFsdWUodGhpcy5kb2NrZXJmaWxlVGV4dCB8fCBcIlwiKTtcbiAgICAgICAgICB0ZXh0Lm9uQ2hhbmdlKCh2YWwpID0+IHtcbiAgICAgICAgICAgIHRoaXMuZG9ja2VyZmlsZVRleHQgPSB2YWw7XG4gICAgICAgICAgfSk7XG4gICAgICAgIH0pO1xuICAgIH1cbiAgfVxuXG4gIHJlbmRlclJhd1RhYihjb250YWluZXJFbDogSFRNTEVsZW1lbnQpIHtcbiAgICB0aGlzLnJhd0pzb25UZXh0ID0gSlNPTi5zdHJpbmdpZnkodGhpcy5jb25maWdPYmosIG51bGwsIDIpO1xuICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxuICAgICAgLnNldE5hbWUoXCJDb25maWd1cmF0aW9uIEpTT05cIilcbiAgICAgIC5hZGRUZXh0QXJlYSgodGV4dCkgPT4ge1xuICAgICAgICB0ZXh0LmlucHV0RWwucm93cyA9IDE1O1xuICAgICAgICB0ZXh0LmlucHV0RWwuc3R5bGUuZm9udEZhbWlseSA9IFwibW9ub3NwYWNlXCI7XG4gICAgICAgIHRleHQuaW5wdXRFbC5zdHlsZS53aWR0aCA9IFwiMTAwJVwiO1xuICAgICAgICB0ZXh0LnNldFZhbHVlKHRoaXMucmF3SnNvblRleHQpO1xuICAgICAgICB0ZXh0Lm9uQ2hhbmdlKCh2YWwpID0+IHtcbiAgICAgICAgICB0aGlzLnJhd0pzb25UZXh0ID0gdmFsO1xuICAgICAgICB9KTtcbiAgICAgIH0pO1xuICB9XG5cbiAgYXN5bmMgc2F2ZUFuZENsb3NlKCkge1xuICAgIC8vIElmIHRoZSBhY3RpdmUgdGFiIGlzIHJhdyBKU09OLCBwYXJzZSBpdCBmaXJzdCB0byBlbnN1cmUgd2UgY2FwdHVyZSBlZGl0c1xuICAgIGlmICh0aGlzLmFjdGl2ZVRhYiA9PT0gXCJyYXdcIikge1xuICAgICAgdHJ5IHtcbiAgICAgICAgdGhpcy5jb25maWdPYmogPSBKU09OLnBhcnNlKHRoaXMucmF3SnNvblRleHQpO1xuICAgICAgfSBjYXRjaCAoZSkge1xuICAgICAgICBuZXcgTm90aWNlKFwiSW52YWxpZCBKU09OIHN5bnRheCBpbiBSYXcgSlNPTiB0YWIuIFBsZWFzZSBmaXggaXQgYmVmb3JlIHNhdmluZy5cIik7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBCYXNpYyBWYWxpZGF0aW9uXG4gICAgaWYgKCF0aGlzLmNvbmZpZ09iai5ydW50aW1lKSB7XG4gICAgICBuZXcgTm90aWNlKFwiUnVudGltZSBpcyByZXF1aXJlZC5cIik7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIGlmICh0aGlzLmNvbmZpZ09iai5ydW50aW1lID09PSBcInFlbXVcIiAmJiAoIXRoaXMuY29uZmlnT2JqLnFlbXU/LnNzaFRhcmdldCB8fCAhdGhpcy5jb25maWdPYmoucWVtdT8ucmVtb3RlV29ya3NwYWNlKSkge1xuICAgICAgbmV3IE5vdGljZShcIlFFTVUgcnVudGltZSByZXF1aXJlcyBTU0ggVGFyZ2V0IGFuZCBSZW1vdGUgV29ya3NwYWNlLlwiKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgaWYgKHRoaXMuY29uZmlnT2JqLnJ1bnRpbWUgPT09IFwiY3VzdG9tXCIgJiYgIXRoaXMuY29uZmlnT2JqLmN1c3RvbT8uZXhlY3V0YWJsZSkge1xuICAgICAgbmV3IE5vdGljZShcIkN1c3RvbSBydW50aW1lIHJlcXVpcmVzIEN1c3RvbSBFeGVjdXRhYmxlLlwiKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBjb25zdCBhZGFwdGVyID0gdGhpcy5hcHAudmF1bHQuYWRhcHRlcjtcbiAgICBjb25zdCBjb25maWdQYXRoID0gYCR7dGhpcy5wbHVnaW5EaXJ9L2NvbnRhaW5lcnMvJHt0aGlzLmdyb3VwTmFtZX0vY29uZmlnLmpzb25gO1xuICAgIGNvbnN0IGRvY2tlcmZpbGVQYXRoID0gYCR7dGhpcy5wbHVnaW5EaXJ9L2NvbnRhaW5lcnMvJHt0aGlzLmdyb3VwTmFtZX0vRG9ja2VyZmlsZWA7XG5cbiAgICB0cnkge1xuICAgICAgLy8gU2F2ZSBjb25maWcuanNvblxuICAgICAgY29uc3QgY29uZmlnU3RyID0gSlNPTi5zdHJpbmdpZnkodGhpcy5jb25maWdPYmosIG51bGwsIDIpO1xuICAgICAgYXdhaXQgYWRhcHRlci53cml0ZShjb25maWdQYXRoLCBjb25maWdTdHIpO1xuXG4gICAgICAvLyBTYXZlIERvY2tlcmZpbGVcbiAgICAgIGlmICh0aGlzLmNvbmZpZ09iai5ydW50aW1lID09PSBcImRvY2tlclwiIHx8IHRoaXMuY29uZmlnT2JqLnJ1bnRpbWUgPT09IFwicG9kbWFuXCIpIHtcbiAgICAgICAgaWYgKHRoaXMuZG9ja2VyZmlsZVRleHQgIT09IG51bGwpIHtcbiAgICAgICAgICBhd2FpdCBhZGFwdGVyLndyaXRlKGRvY2tlcmZpbGVQYXRoLCB0aGlzLmRvY2tlcmZpbGVUZXh0KTtcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICBuZXcgTm90aWNlKFwiQ29udGFpbmVyIGdyb3VwIGNvbmZpZ3VyYXRpb25zIHNhdmVkLlwiKTtcbiAgICAgIHRoaXMub25TYXZlKCk7XG4gICAgICB0aGlzLmNsb3NlKCk7XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIG5ldyBOb3RpY2UoYFNhdmUgZmFpbGVkOiAke2Vycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogU3RyaW5nKGVycm9yKX1gKTtcbiAgICB9XG4gIH1cbn1cbiIsICJpbXBvcnQgeyBzcGF3biB9IGZyb20gXCJjaGlsZF9wcm9jZXNzXCI7XG5pbXBvcnQgeyBta2R0ZW1wLCBybSwgd3JpdGVGaWxlIH0gZnJvbSBcImZzL3Byb21pc2VzXCI7XG5pbXBvcnQgeyB0bXBkaXIgfSBmcm9tIFwib3NcIjtcbmltcG9ydCB7IGpvaW4gfSBmcm9tIFwicGF0aFwiO1xuaW1wb3J0IHR5cGUgeyBsb29tTm9ybWFsaXplZExhbmd1YWdlLCBsb29tU291cmNlUmVmZXJlbmNlIH0gZnJvbSBcIi4vdHlwZXNcIjtcbmltcG9ydCB7IHNwbGl0Q29tbWFuZExpbmUgfSBmcm9tIFwiLi91dGlscy9jb21tYW5kXCI7XG5cbmludGVyZmFjZSBTb3VyY2VSYW5nZSB7XG4gIHN0YXJ0OiBudW1iZXI7XG4gIGVuZDogbnVtYmVyO1xufVxuXG5pbnRlcmZhY2UgU291cmNlRGVmaW5pdGlvbiBleHRlbmRzIFNvdXJjZVJhbmdlIHtcbiAgbmFtZTogc3RyaW5nO1xuICBuYW1lcz86IHN0cmluZ1tdO1xufVxuXG5pbnRlcmZhY2UgUHl0aG9uQWxpYXMge1xuICBuYW1lOiBzdHJpbmc7XG4gIGFzbmFtZTogc3RyaW5nIHwgbnVsbDtcbn1cblxuaW50ZXJmYWNlIFB5dGhvbkltcG9ydCBleHRlbmRzIFNvdXJjZVJhbmdlIHtcbiAga2luZDogXCJpbXBvcnRcIiB8IFwiZnJvbVwiO1xuICBtb2R1bGU6IHN0cmluZztcbiAgbGV2ZWw6IG51bWJlcjtcbiAgbmFtZXM6IFB5dGhvbkFsaWFzW107XG59XG5cbmludGVyZmFjZSBQeXRob25Nb2R1bGVJbmZvIHtcbiAgZGVmaW5pdGlvbnM6IFNvdXJjZURlZmluaXRpb25bXTtcbiAgaW1wb3J0czogUHl0aG9uSW1wb3J0W107XG59XG5cbmludGVyZmFjZSBQeXRob25Vc2FnZSB7XG4gIG5hbWVzOiBzdHJpbmdbXTtcbiAgYXR0cmlidXRlczogUmVjb3JkPHN0cmluZywgc3RyaW5nW10+O1xufVxuXG5pbnRlcmZhY2UgUHl0aG9uRGVwZW5kZW5jeVN0YXRlIHtcbiAgcmVhZG9ubHkgaW5jbHVkZWRSYW5nZXM6IFNldDxzdHJpbmc+O1xuICByZWFkb25seSBpbmNsdWRlZEltcG9ydHM6IFNldDxzdHJpbmc+O1xuICByZWFkb25seSBhbGlhc2VzOiBTZXQ8c3RyaW5nPjtcbiAgcmVhZG9ubHkgbmFtZXNwYWNlQmluZGluZ3M6IE1hcDxzdHJpbmcsIFNldDxzdHJpbmc+PjtcbiAgcmVhZG9ubHkgdmlzaXRpbmdTeW1ib2xzOiBTZXQ8c3RyaW5nPjtcbiAgbmVlZHNOYW1lc3BhY2VSdW50aW1lOiBib29sZWFuO1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIGxvb21Tb3VyY2VFeHRyYWN0aW9uSG9zdCB7XG4gIHB5dGhvbkV4ZWN1dGFibGU/OiBzdHJpbmc7XG4gIGV4dGVybmFsRXh0cmFjdG9yPzogbG9vbUV4dGVybmFsU291cmNlRXh0cmFjdG9yO1xuICByZWFkRmlsZShmaWxlUGF0aDogc3RyaW5nKTogUHJvbWlzZTxzdHJpbmcgfCBudWxsPjtcbiAgcmVzb2x2ZVB5dGhvbkltcG9ydChmcm9tRmlsZVBhdGg6IHN0cmluZywgbW9kdWxlTmFtZTogc3RyaW5nLCBsZXZlbDogbnVtYmVyKTogUHJvbWlzZTxzdHJpbmcgfCBudWxsPjtcbn1cblxuZXhwb3J0IGludGVyZmFjZSBsb29tRXh0ZXJuYWxTb3VyY2VFeHRyYWN0b3Ige1xuICBtb2RlOiBcImNvbW1hbmRcIiB8IFwidHJhbnNwaWxlLWNcIjtcbiAgbGFuZ3VhZ2U6IHN0cmluZztcbiAgZXhlY3V0YWJsZTogc3RyaW5nO1xuICBhcmdzOiBzdHJpbmdbXTtcbiAgd29ya2luZ0RpcmVjdG9yeTogc3RyaW5nO1xuICB0aW1lb3V0TXM6IG51bWJlcjtcbn1cblxuaW50ZXJmYWNlIEV4dGVybmFsRXh0cmFjdG9yUmVzdWx0IHtcbiAgY29udGVudD86IHN0cmluZztcbiAgc2VsZWN0ZWQ/OiBzdHJpbmc7XG4gIGRlcGVuZGVuY2llcz86IHN0cmluZ1tdO1xuICBpbXBvcnRzPzogc3RyaW5nW107XG4gIGRlc2NyaXB0aW9uPzogc3RyaW5nO1xufVxuXG5pbnRlcmZhY2UgVHJhbnNwaWxlVG9DUmVzdWx0IHtcbiAgZ2VuZXJhdGVkU291cmNlOiBzdHJpbmc7XG4gIHN5bWJvbHM/OiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+O1xuICBoYXJuZXNzPzogc3RyaW5nO1xuICBsYW5ndWFnZT86IFwiY1wiIHwgXCJjcHBcIjtcbiAgZGVzY3JpcHRpb24/OiBzdHJpbmc7XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgbG9vbVJlc29sdmVkU291cmNlIHtcbiAgY29udGVudDogc3RyaW5nO1xuICBkZXNjcmlwdGlvbjogc3RyaW5nO1xufVxuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gcmVzb2x2ZVJlZmVyZW5jZWRTb3VyY2UoXG4gIHNvdXJjZTogc3RyaW5nLFxuICByZWZlcmVuY2U6IGxvb21Tb3VyY2VSZWZlcmVuY2UsXG4gIGxhbmd1YWdlOiBsb29tTm9ybWFsaXplZExhbmd1YWdlLFxuICBoYXJuZXNzOiBzdHJpbmcsXG4gIGhvc3Q/OiBsb29tU291cmNlRXh0cmFjdGlvbkhvc3QsXG4pOiBQcm9taXNlPGxvb21SZXNvbHZlZFNvdXJjZT4ge1xuICBpZiAoaG9zdD8uZXh0ZXJuYWxFeHRyYWN0b3I/LmV4ZWN1dGFibGUudHJpbSgpKSB7XG4gICAgcmV0dXJuIGhvc3QuZXh0ZXJuYWxFeHRyYWN0b3IubW9kZSA9PT0gXCJ0cmFuc3BpbGUtY1wiXG4gICAgICA/IHJlc29sdmVUcmFuc3BpbGVUb0NSZWZlcmVuY2VkU291cmNlKHNvdXJjZSwgcmVmZXJlbmNlLCBsYW5ndWFnZSwgaGFybmVzcywgaG9zdC5leHRlcm5hbEV4dHJhY3RvcilcbiAgICAgIDogcmVzb2x2ZUV4dGVybmFsUmVmZXJlbmNlZFNvdXJjZShzb3VyY2UsIHJlZmVyZW5jZSwgbGFuZ3VhZ2UsIGhhcm5lc3MsIGhvc3QuZXh0ZXJuYWxFeHRyYWN0b3IpO1xuICB9XG5cbiAgaWYgKGxhbmd1YWdlID09PSBcInB5dGhvblwiICYmIGhvc3QpIHtcbiAgICByZXR1cm4gcmVzb2x2ZVB5dGhvblJlZmVyZW5jZWRTb3VyY2Uoc291cmNlLCByZWZlcmVuY2UsIGhhcm5lc3MsIGhvc3QpO1xuICB9XG5cbiAgcmV0dXJuIHJlc29sdmVSZWZlcmVuY2VkU291cmNlRmFsbGJhY2soc291cmNlLCByZWZlcmVuY2UsIGxhbmd1YWdlLCBoYXJuZXNzKTtcbn1cblxuZnVuY3Rpb24gcmVzb2x2ZVJlZmVyZW5jZWRTb3VyY2VGYWxsYmFjayhcbiAgc291cmNlOiBzdHJpbmcsXG4gIHJlZmVyZW5jZTogbG9vbVNvdXJjZVJlZmVyZW5jZSxcbiAgbGFuZ3VhZ2U6IGxvb21Ob3JtYWxpemVkTGFuZ3VhZ2UsXG4gIGhhcm5lc3M6IHN0cmluZyxcbik6IGxvb21SZXNvbHZlZFNvdXJjZSB7XG4gIGNvbnN0IGxpbmVzID0gc291cmNlLnNwbGl0KC9cXHI/XFxuLyk7XG4gIGNvbnN0IHNlbGVjdGVkUmFuZ2UgPSByZWZlcmVuY2Uuc3ltYm9sTmFtZVxuICAgID8gZmluZFN5bWJvbFJhbmdlKGxpbmVzLCBsYW5ndWFnZSwgcmVmZXJlbmNlLnN5bWJvbE5hbWUpXG4gICAgOiBmaW5kTGluZVJhbmdlKGxpbmVzLCByZWZlcmVuY2UpO1xuXG4gIGlmICghc2VsZWN0ZWRSYW5nZSkge1xuICAgIGNvbnN0IHRhcmdldCA9IHJlZmVyZW5jZS5zeW1ib2xOYW1lID8gYHN5bWJvbCAke3JlZmVyZW5jZS5zeW1ib2xOYW1lfWAgOiBcImxpbmUgcmFuZ2VcIjtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYFVuYWJsZSB0byBleHRyYWN0ICR7dGFyZ2V0fSBmcm9tICR7cmVmZXJlbmNlLmZpbGVQYXRofS5gKTtcbiAgfVxuXG4gIGNvbnN0IHNlbGVjdGVkID0gcmVuZGVyUmFuZ2UobGluZXMsIHNlbGVjdGVkUmFuZ2UpO1xuICBjb25zdCBkZXBlbmRlbmNpZXMgPSByZWZlcmVuY2UudHJhY2VEZXBlbmRlbmNpZXNcbiAgICA/IGNvbGxlY3REZXBlbmRlbmN5U291cmNlKGxpbmVzLCBsYW5ndWFnZSwgc2VsZWN0ZWRSYW5nZSwgc2VsZWN0ZWQpXG4gICAgOiBcIlwiO1xuICBjb25zdCBjb250ZW50ID0gW2RlcGVuZGVuY2llcywgc2VsZWN0ZWQsIGhhcm5lc3MudHJpbSgpID8gaGFybmVzcyA6IFwiXCJdXG4gICAgLmZpbHRlcigocGFydCkgPT4gcGFydC50cmltKCkpXG4gICAgLmpvaW4oXCJcXG5cXG5cIik7XG5cbiAgcmV0dXJuIHtcbiAgICBjb250ZW50LFxuICAgIGRlc2NyaXB0aW9uOiBmb3JtYXRTb3VyY2VEZXNjcmlwdGlvbihyZWZlcmVuY2UsIHNlbGVjdGVkUmFuZ2UpLFxuICB9O1xufVxuXG5hc3luYyBmdW5jdGlvbiByZXNvbHZlRXh0ZXJuYWxSZWZlcmVuY2VkU291cmNlKFxuICBzb3VyY2U6IHN0cmluZyxcbiAgcmVmZXJlbmNlOiBsb29tU291cmNlUmVmZXJlbmNlLFxuICBsYW5ndWFnZTogbG9vbU5vcm1hbGl6ZWRMYW5ndWFnZSxcbiAgaGFybmVzczogc3RyaW5nLFxuICBleHRyYWN0b3I6IGxvb21FeHRlcm5hbFNvdXJjZUV4dHJhY3Rvcixcbik6IFByb21pc2U8bG9vbVJlc29sdmVkU291cmNlPiB7XG4gIGNvbnN0IHRlbXBEaXIgPSBhd2FpdCBta2R0ZW1wKGpvaW4odG1wZGlyKCksIFwibG9vbS1leHRyYWN0LVwiKSk7XG4gIGNvbnN0IHNvdXJjZUZpbGUgPSBqb2luKHRlbXBEaXIsIFwic291cmNlLnR4dFwiKTtcbiAgY29uc3QgaGFybmVzc0ZpbGUgPSBqb2luKHRlbXBEaXIsIFwiaGFybmVzcy50eHRcIik7XG4gIGNvbnN0IHJlcXVlc3RGaWxlID0gam9pbih0ZW1wRGlyLCBcInJlcXVlc3QuanNvblwiKTtcblxuICB0cnkge1xuICAgIGNvbnN0IHJlcXVlc3QgPSB7XG4gICAgICBsYW5ndWFnZSxcbiAgICAgIGZpbGVQYXRoOiByZWZlcmVuY2UuZmlsZVBhdGgsXG4gICAgICBzeW1ib2xOYW1lOiByZWZlcmVuY2Uuc3ltYm9sTmFtZSA/PyBudWxsLFxuICAgICAgbGluZVN0YXJ0OiByZWZlcmVuY2UubGluZVN0YXJ0ID8/IG51bGwsXG4gICAgICBsaW5lRW5kOiByZWZlcmVuY2UubGluZUVuZCA/PyBudWxsLFxuICAgICAgdHJhY2VEZXBlbmRlbmNpZXM6IHJlZmVyZW5jZS50cmFjZURlcGVuZGVuY2llcyxcbiAgICAgIHNvdXJjZUZpbGUsXG4gICAgICBoYXJuZXNzRmlsZSxcbiAgICB9O1xuICAgIGF3YWl0IHdyaXRlRmlsZShzb3VyY2VGaWxlLCBzb3VyY2UsIFwidXRmOFwiKTtcbiAgICBhd2FpdCB3cml0ZUZpbGUoaGFybmVzc0ZpbGUsIGhhcm5lc3MsIFwidXRmOFwiKTtcbiAgICBhd2FpdCB3cml0ZUZpbGUocmVxdWVzdEZpbGUsIEpTT04uc3RyaW5naWZ5KHJlcXVlc3QsIG51bGwsIDIpLCBcInV0ZjhcIik7XG5cbiAgICBjb25zdCBvdXRwdXQgPSBhd2FpdCBydW5FeHRlcm5hbEV4dHJhY3RvcihleHRyYWN0b3IsIHtcbiAgICAgIGxhbmd1YWdlLFxuICAgICAgc291cmNlRmlsZSxcbiAgICAgIGhhcm5lc3NGaWxlLFxuICAgICAgcmVxdWVzdEZpbGUsXG4gICAgICByZWZlcmVuY2UsXG4gICAgfSk7XG4gICAgY29uc3QgcmVzdWx0ID0gcGFyc2VFeHRlcm5hbEV4dHJhY3RvclJlc3VsdChvdXRwdXQpO1xuICAgIGNvbnN0IGNvbnRlbnQgPSByZXN1bHQuY29udGVudCA/PyBbXG4gICAgICAuLi4ocmVzdWx0LmltcG9ydHMgPz8gW10pLFxuICAgICAgLi4uKHJlc3VsdC5kZXBlbmRlbmNpZXMgPz8gW10pLFxuICAgICAgcmVzdWx0LnNlbGVjdGVkID8/IFwiXCIsXG4gICAgICBoYXJuZXNzLnRyaW0oKSA/IGhhcm5lc3MgOiBcIlwiLFxuICAgIF0uZmlsdGVyKChwYXJ0KSA9PiBwYXJ0LnRyaW0oKSkuam9pbihcIlxcblxcblwiKTtcblxuICAgIGlmICghY29udGVudC50cmltKCkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIkN1c3RvbSBzb3VyY2UgZXh0cmFjdG9yIHJldHVybmVkIG5vIGNvbnRlbnQuXCIpO1xuICAgIH1cblxuICAgIHJldHVybiB7XG4gICAgICBjb250ZW50LFxuICAgICAgZGVzY3JpcHRpb246IHJlc3VsdC5kZXNjcmlwdGlvbj8udHJpbSgpIHx8IGZvcm1hdFNvdXJjZURlc2NyaXB0aW9uKHJlZmVyZW5jZSwgbnVsbCksXG4gICAgfTtcbiAgfSBmaW5hbGx5IHtcbiAgICBhd2FpdCBybSh0ZW1wRGlyLCB7IHJlY3Vyc2l2ZTogdHJ1ZSwgZm9yY2U6IHRydWUgfSk7XG4gIH1cbn1cblxuYXN5bmMgZnVuY3Rpb24gcmVzb2x2ZVRyYW5zcGlsZVRvQ1JlZmVyZW5jZWRTb3VyY2UoXG4gIHNvdXJjZTogc3RyaW5nLFxuICByZWZlcmVuY2U6IGxvb21Tb3VyY2VSZWZlcmVuY2UsXG4gIGxhbmd1YWdlOiBsb29tTm9ybWFsaXplZExhbmd1YWdlLFxuICBoYXJuZXNzOiBzdHJpbmcsXG4gIGV4dHJhY3RvcjogbG9vbUV4dGVybmFsU291cmNlRXh0cmFjdG9yLFxuKTogUHJvbWlzZTxsb29tUmVzb2x2ZWRTb3VyY2U+IHtcbiAgY29uc3QgdGVtcERpciA9IGF3YWl0IG1rZHRlbXAoam9pbih0bXBkaXIoKSwgXCJsb29tLWV4dHJhY3QtXCIpKTtcbiAgY29uc3Qgc291cmNlRmlsZSA9IGpvaW4odGVtcERpciwgXCJzb3VyY2UudHh0XCIpO1xuICBjb25zdCBoYXJuZXNzRmlsZSA9IGpvaW4odGVtcERpciwgXCJoYXJuZXNzLnR4dFwiKTtcbiAgY29uc3QgcmVxdWVzdEZpbGUgPSBqb2luKHRlbXBEaXIsIFwicmVxdWVzdC5qc29uXCIpO1xuXG4gIHRyeSB7XG4gICAgY29uc3QgcmVxdWVzdCA9IHtcbiAgICAgIGxhbmd1YWdlLFxuICAgICAgZmlsZVBhdGg6IHJlZmVyZW5jZS5maWxlUGF0aCxcbiAgICAgIHN5bWJvbE5hbWU6IHJlZmVyZW5jZS5zeW1ib2xOYW1lID8/IG51bGwsXG4gICAgICBsaW5lU3RhcnQ6IHJlZmVyZW5jZS5saW5lU3RhcnQgPz8gbnVsbCxcbiAgICAgIGxpbmVFbmQ6IHJlZmVyZW5jZS5saW5lRW5kID8/IG51bGwsXG4gICAgICB0cmFjZURlcGVuZGVuY2llczogcmVmZXJlbmNlLnRyYWNlRGVwZW5kZW5jaWVzLFxuICAgICAgc291cmNlRmlsZSxcbiAgICAgIGhhcm5lc3NGaWxlLFxuICAgICAgdGFyZ2V0TGFuZ3VhZ2U6IFwiY1wiLFxuICAgIH07XG4gICAgYXdhaXQgd3JpdGVGaWxlKHNvdXJjZUZpbGUsIHNvdXJjZSwgXCJ1dGY4XCIpO1xuICAgIGF3YWl0IHdyaXRlRmlsZShoYXJuZXNzRmlsZSwgaGFybmVzcywgXCJ1dGY4XCIpO1xuICAgIGF3YWl0IHdyaXRlRmlsZShyZXF1ZXN0RmlsZSwgSlNPTi5zdHJpbmdpZnkocmVxdWVzdCwgbnVsbCwgMiksIFwidXRmOFwiKTtcblxuICAgIGNvbnN0IG91dHB1dCA9IGF3YWl0IHJ1bkV4dGVybmFsRXh0cmFjdG9yKGV4dHJhY3Rvciwge1xuICAgICAgbGFuZ3VhZ2UsXG4gICAgICBzb3VyY2VGaWxlLFxuICAgICAgaGFybmVzc0ZpbGUsXG4gICAgICByZXF1ZXN0RmlsZSxcbiAgICAgIHJlZmVyZW5jZSxcbiAgICB9KTtcbiAgICBjb25zdCByZXN1bHQgPSBwYXJzZVRyYW5zcGlsZVRvQ1Jlc3VsdChvdXRwdXQpO1xuICAgIGNvbnN0IGdlbmVyYXRlZExhbmd1YWdlID0gcmVzdWx0Lmxhbmd1YWdlID09PSBcImNwcFwiID8gXCJjcHBcIiA6IFwiY1wiO1xuICAgIGNvbnN0IG1hcHBlZFN5bWJvbCA9IHJlZmVyZW5jZS5zeW1ib2xOYW1lID8gcmVzdWx0LnN5bWJvbHM/LltyZWZlcmVuY2Uuc3ltYm9sTmFtZV0gPz8gcmVmZXJlbmNlLnN5bWJvbE5hbWUgOiB1bmRlZmluZWQ7XG4gICAgY29uc3QgZ2VuZXJhdGVkUmVmZXJlbmNlOiBsb29tU291cmNlUmVmZXJlbmNlID0ge1xuICAgICAgLi4ucmVmZXJlbmNlLFxuICAgICAgZmlsZVBhdGg6IGAke3JlZmVyZW5jZS5maWxlUGF0aH06Z2VuZXJhdGVkLiR7Z2VuZXJhdGVkTGFuZ3VhZ2UgPT09IFwiY3BwXCIgPyBcImNwcFwiIDogXCJjXCJ9YCxcbiAgICAgIHN5bWJvbE5hbWU6IG1hcHBlZFN5bWJvbCxcbiAgICB9O1xuICAgIGNvbnN0IHJlc29sdmVkID0gcmVzb2x2ZVJlZmVyZW5jZWRTb3VyY2VGYWxsYmFjayhyZXN1bHQuZ2VuZXJhdGVkU291cmNlLCBnZW5lcmF0ZWRSZWZlcmVuY2UsIGdlbmVyYXRlZExhbmd1YWdlLCByZXN1bHQuaGFybmVzcyA/PyBoYXJuZXNzKTtcblxuICAgIHJldHVybiB7XG4gICAgICBjb250ZW50OiByZXNvbHZlZC5jb250ZW50LFxuICAgICAgZGVzY3JpcHRpb246IHJlc3VsdC5kZXNjcmlwdGlvbj8udHJpbSgpIHx8IGAke3JlZmVyZW5jZS5maWxlUGF0aH0jJHtyZWZlcmVuY2Uuc3ltYm9sTmFtZSA/PyBcImdlbmVyYXRlZC1jXCJ9YCxcbiAgICB9O1xuICB9IGZpbmFsbHkge1xuICAgIGF3YWl0IHJtKHRlbXBEaXIsIHsgcmVjdXJzaXZlOiB0cnVlLCBmb3JjZTogdHJ1ZSB9KTtcbiAgfVxufVxuXG5hc3luYyBmdW5jdGlvbiBydW5FeHRlcm5hbEV4dHJhY3RvcihcbiAgZXh0cmFjdG9yOiBsb29tRXh0ZXJuYWxTb3VyY2VFeHRyYWN0b3IsXG4gIHZhbHVlczoge1xuICAgIGxhbmd1YWdlOiBzdHJpbmc7XG4gICAgc291cmNlRmlsZTogc3RyaW5nO1xuICAgIGhhcm5lc3NGaWxlOiBzdHJpbmc7XG4gICAgcmVxdWVzdEZpbGU6IHN0cmluZztcbiAgICByZWZlcmVuY2U6IGxvb21Tb3VyY2VSZWZlcmVuY2U7XG4gIH0sXG4pOiBQcm9taXNlPHN0cmluZz4ge1xuICBjb25zdCBhcmdzID0gZXh0cmFjdG9yLmFyZ3MubWFwKChhcmcpID0+IGFyZ1xuICAgIC5yZXBsYWNlQWxsKFwie3JlcXVlc3R9XCIsIHZhbHVlcy5yZXF1ZXN0RmlsZSlcbiAgICAucmVwbGFjZUFsbChcIntzb3VyY2V9XCIsIHZhbHVlcy5zb3VyY2VGaWxlKVxuICAgIC5yZXBsYWNlQWxsKFwie2ZpbGV9XCIsIHZhbHVlcy5zb3VyY2VGaWxlKVxuICAgIC5yZXBsYWNlQWxsKFwie2hhcm5lc3N9XCIsIHZhbHVlcy5oYXJuZXNzRmlsZSlcbiAgICAucmVwbGFjZUFsbChcIntzeW1ib2x9XCIsIHZhbHVlcy5yZWZlcmVuY2Uuc3ltYm9sTmFtZSA/PyBcIlwiKVxuICAgIC5yZXBsYWNlQWxsKFwie2xpbmVTdGFydH1cIiwgdmFsdWVzLnJlZmVyZW5jZS5saW5lU3RhcnQgPT0gbnVsbCA/IFwiXCIgOiBTdHJpbmcodmFsdWVzLnJlZmVyZW5jZS5saW5lU3RhcnQpKVxuICAgIC5yZXBsYWNlQWxsKFwie2xpbmVFbmR9XCIsIHZhbHVlcy5yZWZlcmVuY2UubGluZUVuZCA9PSBudWxsID8gXCJcIiA6IFN0cmluZyh2YWx1ZXMucmVmZXJlbmNlLmxpbmVFbmQpKVxuICAgIC5yZXBsYWNlQWxsKFwie2RlcHN9XCIsIHZhbHVlcy5yZWZlcmVuY2UudHJhY2VEZXBlbmRlbmNpZXMgPyBcInRydWVcIiA6IFwiZmFsc2VcIilcbiAgICAucmVwbGFjZUFsbChcIntsYW5ndWFnZX1cIiwgdmFsdWVzLmxhbmd1YWdlKSk7XG5cbiAgcmV0dXJuIG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICBjb25zdCBjaGlsZCA9IHNwYXduKGV4dHJhY3Rvci5leGVjdXRhYmxlLCBhcmdzLCB7XG4gICAgICBjd2Q6IGV4dHJhY3Rvci53b3JraW5nRGlyZWN0b3J5LFxuICAgICAgc3RkaW86IFtcInBpcGVcIiwgXCJwaXBlXCIsIFwicGlwZVwiXSxcbiAgICB9KTtcbiAgICBsZXQgc3Rkb3V0ID0gXCJcIjtcbiAgICBsZXQgc3RkZXJyID0gXCJcIjtcbiAgICBjb25zdCB0aW1lb3V0ID0gc2V0VGltZW91dCgoKSA9PiB7XG4gICAgICBjaGlsZC5raWxsKFwiU0lHVEVSTVwiKTtcbiAgICAgIHJlamVjdChuZXcgRXJyb3IoYEN1c3RvbSBzb3VyY2UgZXh0cmFjdG9yIHRpbWVkIG91dCBhZnRlciAke2V4dHJhY3Rvci50aW1lb3V0TXN9IG1zLmApKTtcbiAgICB9LCBleHRyYWN0b3IudGltZW91dE1zKTtcblxuICAgIGNoaWxkLnN0ZG91dC5zZXRFbmNvZGluZyhcInV0ZjhcIik7XG4gICAgY2hpbGQuc3RkZXJyLnNldEVuY29kaW5nKFwidXRmOFwiKTtcbiAgICBjaGlsZC5zdGRvdXQub24oXCJkYXRhXCIsIChjaHVuazogc3RyaW5nKSA9PiB7XG4gICAgICBzdGRvdXQgKz0gY2h1bms7XG4gICAgfSk7XG4gICAgY2hpbGQuc3RkZXJyLm9uKFwiZGF0YVwiLCAoY2h1bms6IHN0cmluZykgPT4ge1xuICAgICAgc3RkZXJyICs9IGNodW5rO1xuICAgIH0pO1xuICAgIGNoaWxkLm9uKFwiZXJyb3JcIiwgKGVycm9yKSA9PiB7XG4gICAgICBjbGVhclRpbWVvdXQodGltZW91dCk7XG4gICAgICByZWplY3QoZXJyb3IpO1xuICAgIH0pO1xuICAgIGNoaWxkLm9uKFwiY2xvc2VcIiwgKGNvZGUpID0+IHtcbiAgICAgIGNsZWFyVGltZW91dCh0aW1lb3V0KTtcbiAgICAgIGlmIChjb2RlICE9PSAwKSB7XG4gICAgICAgIHJlamVjdChuZXcgRXJyb3IoKHN0ZGVyciB8fCBzdGRvdXQgfHwgYEN1c3RvbSBzb3VyY2UgZXh0cmFjdG9yIGV4aXRlZCB3aXRoIGNvZGUgJHtjb2RlfS5gKS50cmltKCkpKTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuICAgICAgcmVzb2x2ZShzdGRvdXQpO1xuICAgIH0pO1xuXG4gICAgY2hpbGQuc3RkaW4uZW5kKEpTT04uc3RyaW5naWZ5KHtcbiAgICAgIHJlcXVlc3RGaWxlOiB2YWx1ZXMucmVxdWVzdEZpbGUsXG4gICAgICBzb3VyY2VGaWxlOiB2YWx1ZXMuc291cmNlRmlsZSxcbiAgICAgIGhhcm5lc3NGaWxlOiB2YWx1ZXMuaGFybmVzc0ZpbGUsXG4gICAgICBsYW5ndWFnZTogdmFsdWVzLmxhbmd1YWdlLFxuICAgICAgZmlsZVBhdGg6IHZhbHVlcy5yZWZlcmVuY2UuZmlsZVBhdGgsXG4gICAgICBzeW1ib2xOYW1lOiB2YWx1ZXMucmVmZXJlbmNlLnN5bWJvbE5hbWUgPz8gbnVsbCxcbiAgICAgIGxpbmVTdGFydDogdmFsdWVzLnJlZmVyZW5jZS5saW5lU3RhcnQgPz8gbnVsbCxcbiAgICAgIGxpbmVFbmQ6IHZhbHVlcy5yZWZlcmVuY2UubGluZUVuZCA/PyBudWxsLFxuICAgICAgdHJhY2VEZXBlbmRlbmNpZXM6IHZhbHVlcy5yZWZlcmVuY2UudHJhY2VEZXBlbmRlbmNpZXMsXG4gICAgfSkpO1xuICB9KTtcbn1cblxuZnVuY3Rpb24gcGFyc2VFeHRlcm5hbEV4dHJhY3RvclJlc3VsdChvdXRwdXQ6IHN0cmluZyk6IEV4dGVybmFsRXh0cmFjdG9yUmVzdWx0IHtcbiAgdHJ5IHtcbiAgICBjb25zdCBwYXJzZWQgPSBKU09OLnBhcnNlKG91dHB1dCkgYXMgRXh0ZXJuYWxFeHRyYWN0b3JSZXN1bHQ7XG4gICAgaWYgKHR5cGVvZiBwYXJzZWQgIT09IFwib2JqZWN0XCIgfHwgcGFyc2VkID09IG51bGwpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIkN1c3RvbSBzb3VyY2UgZXh0cmFjdG9yIG11c3QgcmV0dXJuIGEgSlNPTiBvYmplY3QuXCIpO1xuICAgIH1cbiAgICByZXR1cm4gcGFyc2VkO1xuICB9IGNhdGNoIChlcnJvcikge1xuICAgIHRocm93IG5ldyBFcnJvcihgQ3VzdG9tIHNvdXJjZSBleHRyYWN0b3IgcmV0dXJuZWQgaW52YWxpZCBKU09OOiAke2Vycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogU3RyaW5nKGVycm9yKX1gKTtcbiAgfVxufVxuXG5mdW5jdGlvbiBwYXJzZVRyYW5zcGlsZVRvQ1Jlc3VsdChvdXRwdXQ6IHN0cmluZyk6IFRyYW5zcGlsZVRvQ1Jlc3VsdCB7XG4gIHRyeSB7XG4gICAgY29uc3QgcGFyc2VkID0gSlNPTi5wYXJzZShvdXRwdXQpIGFzIFRyYW5zcGlsZVRvQ1Jlc3VsdDtcbiAgICBpZiAodHlwZW9mIHBhcnNlZCAhPT0gXCJvYmplY3RcIiB8fCBwYXJzZWQgPT0gbnVsbCB8fCB0eXBlb2YgcGFyc2VkLmdlbmVyYXRlZFNvdXJjZSAhPT0gXCJzdHJpbmdcIikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiVHJhbnNwaWxlIHRvIEMgZXh0cmFjdG9yIG11c3QgcmV0dXJuIGdlbmVyYXRlZFNvdXJjZS5cIik7XG4gICAgfVxuICAgIGlmIChwYXJzZWQubGFuZ3VhZ2UgIT0gbnVsbCAmJiBwYXJzZWQubGFuZ3VhZ2UgIT09IFwiY1wiICYmIHBhcnNlZC5sYW5ndWFnZSAhPT0gXCJjcHBcIikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiVHJhbnNwaWxlIHRvIEMgbGFuZ3VhZ2UgbXVzdCBiZSBjIG9yIGNwcC5cIik7XG4gICAgfVxuICAgIGlmIChwYXJzZWQuc3ltYm9scyAhPSBudWxsICYmICh0eXBlb2YgcGFyc2VkLnN5bWJvbHMgIT09IFwib2JqZWN0XCIgfHwgQXJyYXkuaXNBcnJheShwYXJzZWQuc3ltYm9scykpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJUcmFuc3BpbGUgdG8gQyBzeW1ib2xzIG11c3QgYmUgYW4gb2JqZWN0LlwiKTtcbiAgICB9XG4gICAgcmV0dXJuIHBhcnNlZDtcbiAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYFRyYW5zcGlsZSB0byBDIGV4dHJhY3RvciByZXR1cm5lZCBpbnZhbGlkIEpTT046ICR7ZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiBTdHJpbmcoZXJyb3IpfWApO1xuICB9XG59XG5cbmFzeW5jIGZ1bmN0aW9uIHJlc29sdmVQeXRob25SZWZlcmVuY2VkU291cmNlKFxuICBzb3VyY2U6IHN0cmluZyxcbiAgcmVmZXJlbmNlOiBsb29tU291cmNlUmVmZXJlbmNlLFxuICBoYXJuZXNzOiBzdHJpbmcsXG4gIGhvc3Q6IGxvb21Tb3VyY2VFeHRyYWN0aW9uSG9zdCxcbik6IFByb21pc2U8bG9vbVJlc29sdmVkU291cmNlPiB7XG4gIGNvbnN0IGxpbmVzID0gc291cmNlLnNwbGl0KC9cXHI/XFxuLyk7XG4gIGNvbnN0IG1vZHVsZUluZm8gPSBhd2FpdCBpbnNwZWN0UHl0aG9uTW9kdWxlKHNvdXJjZSwgaG9zdCk7XG4gIGNvbnN0IHNlbGVjdGVkUmFuZ2UgPSByZWZlcmVuY2Uuc3ltYm9sTmFtZVxuICAgID8gZmluZFB5dGhvblN5bWJvbFJhbmdlKG1vZHVsZUluZm8sIHJlZmVyZW5jZS5zeW1ib2xOYW1lKVxuICAgIDogZmluZExpbmVSYW5nZShsaW5lcywgcmVmZXJlbmNlKTtcblxuICBpZiAoIXNlbGVjdGVkUmFuZ2UpIHtcbiAgICBjb25zdCB0YXJnZXQgPSByZWZlcmVuY2Uuc3ltYm9sTmFtZSA/IGBzeW1ib2wgJHtyZWZlcmVuY2Uuc3ltYm9sTmFtZX1gIDogXCJsaW5lIHJhbmdlXCI7XG4gICAgdGhyb3cgbmV3IEVycm9yKGBVbmFibGUgdG8gZXh0cmFjdCAke3RhcmdldH0gZnJvbSAke3JlZmVyZW5jZS5maWxlUGF0aH0uYCk7XG4gIH1cblxuICBjb25zdCBzZWxlY3RlZCA9IHJlbmRlclJhbmdlKGxpbmVzLCBzZWxlY3RlZFJhbmdlKTtcbiAgY29uc3Qgc3RhdGUgPSBjcmVhdGVQeXRob25EZXBlbmRlbmN5U3RhdGUoKTtcbiAgY29uc3QgZGVwZW5kZW5jaWVzID0gcmVmZXJlbmNlLnRyYWNlRGVwZW5kZW5jaWVzXG4gICAgPyBhd2FpdCBjb2xsZWN0UHl0aG9uRGVwZW5kZW5jeVNvdXJjZShzb3VyY2UsIHJlZmVyZW5jZS5maWxlUGF0aCwgc2VsZWN0ZWRSYW5nZSwgc2VsZWN0ZWQsIGhhcm5lc3MsIGhvc3QsIHN0YXRlKVxuICAgIDogXCJcIjtcbiAgY29uc3QgY29udGVudCA9IFtkZXBlbmRlbmNpZXMsIHNlbGVjdGVkLCBoYXJuZXNzLnRyaW0oKSA/IGhhcm5lc3MgOiBcIlwiXVxuICAgIC5maWx0ZXIoKHBhcnQpID0+IHBhcnQudHJpbSgpKVxuICAgIC5qb2luKFwiXFxuXFxuXCIpO1xuXG4gIHJldHVybiB7XG4gICAgY29udGVudCxcbiAgICBkZXNjcmlwdGlvbjogZm9ybWF0U291cmNlRGVzY3JpcHRpb24ocmVmZXJlbmNlLCBzZWxlY3RlZFJhbmdlKSxcbiAgfTtcbn1cblxuZnVuY3Rpb24gY3JlYXRlUHl0aG9uRGVwZW5kZW5jeVN0YXRlKCk6IFB5dGhvbkRlcGVuZGVuY3lTdGF0ZSB7XG4gIHJldHVybiB7XG4gICAgaW5jbHVkZWRSYW5nZXM6IG5ldyBTZXQoKSxcbiAgICBpbmNsdWRlZEltcG9ydHM6IG5ldyBTZXQoKSxcbiAgICBhbGlhc2VzOiBuZXcgU2V0KCksXG4gICAgbmFtZXNwYWNlQmluZGluZ3M6IG5ldyBNYXAoKSxcbiAgICB2aXNpdGluZ1N5bWJvbHM6IG5ldyBTZXQoKSxcbiAgICBuZWVkc05hbWVzcGFjZVJ1bnRpbWU6IGZhbHNlLFxuICB9O1xufVxuXG5hc3luYyBmdW5jdGlvbiBjb2xsZWN0UHl0aG9uRGVwZW5kZW5jeVNvdXJjZShcbiAgc291cmNlOiBzdHJpbmcsXG4gIGZpbGVQYXRoOiBzdHJpbmcsXG4gIHNlbGVjdGVkUmFuZ2U6IFNvdXJjZVJhbmdlLFxuICBzZWxlY3RlZDogc3RyaW5nLFxuICBoYXJuZXNzOiBzdHJpbmcsXG4gIGhvc3Q6IGxvb21Tb3VyY2VFeHRyYWN0aW9uSG9zdCxcbiAgc3RhdGU6IFB5dGhvbkRlcGVuZGVuY3lTdGF0ZSxcbik6IFByb21pc2U8c3RyaW5nPiB7XG4gIGNvbnN0IHBhcnRzOiBzdHJpbmdbXSA9IFtdO1xuICBhd2FpdCBjb2xsZWN0UHl0aG9uRGVwZW5kZW5jaWVzKHNvdXJjZSwgZmlsZVBhdGgsIHNlbGVjdGVkUmFuZ2UsIGAke3NlbGVjdGVkfVxcbiR7aGFybmVzc31gLCBob3N0LCBzdGF0ZSwgcGFydHMpO1xuICBjb25zdCBuYW1lc3BhY2UgPSByZW5kZXJQeXRob25OYW1lc3BhY2VCaW5kaW5ncyhzdGF0ZSk7XG4gIHJldHVybiBbLi4uc3RhdGUuaW5jbHVkZWRJbXBvcnRzLCAuLi5wYXJ0cywgbmFtZXNwYWNlXVxuICAgIC5maWx0ZXIoKHBhcnQpID0+IHBhcnQudHJpbSgpKVxuICAgIC5qb2luKFwiXFxuXFxuXCIpO1xufVxuXG5hc3luYyBmdW5jdGlvbiBjb2xsZWN0UHl0aG9uRGVwZW5kZW5jaWVzKFxuICBzb3VyY2U6IHN0cmluZyxcbiAgZmlsZVBhdGg6IHN0cmluZyxcbiAgc2VsZWN0ZWRSYW5nZTogU291cmNlUmFuZ2UsXG4gIHNlZWQ6IHN0cmluZyxcbiAgaG9zdDogbG9vbVNvdXJjZUV4dHJhY3Rpb25Ib3N0LFxuICBzdGF0ZTogUHl0aG9uRGVwZW5kZW5jeVN0YXRlLFxuICBwYXJ0czogc3RyaW5nW10sXG4pOiBQcm9taXNlPHN0cmluZz4ge1xuICBjb25zdCBsaW5lcyA9IHNvdXJjZS5zcGxpdCgvXFxyP1xcbi8pO1xuICBjb25zdCBtb2R1bGVJbmZvID0gYXdhaXQgaW5zcGVjdFB5dGhvbk1vZHVsZShzb3VyY2UsIGhvc3QpO1xuICBsZXQgaGF5c3RhY2sgPSBzZWVkO1xuICBsZXQgY29sbGVjdGVkID0gXCJcIjtcbiAgbGV0IGNoYW5nZWQgPSB0cnVlO1xuXG4gIHdoaWxlIChjaGFuZ2VkKSB7XG4gICAgY2hhbmdlZCA9IGZhbHNlO1xuICAgIGNvbnN0IHVzYWdlID0gYXdhaXQgaW5zcGVjdFB5dGhvblVzYWdlKGhheXN0YWNrLCBob3N0KTtcblxuICAgIGZvciAoY29uc3QgZGVmaW5pdGlvbiBvZiBtb2R1bGVJbmZvLmRlZmluaXRpb25zKSB7XG4gICAgICBpZiAocmFuZ2VzT3ZlcmxhcChkZWZpbml0aW9uLCBzZWxlY3RlZFJhbmdlKSB8fCAhcHl0aG9uRGVmaW5pdGlvbklzVXNlZChkZWZpbml0aW9uLCB1c2FnZSkpIHtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICBjb25zdCB0ZXh0ID0gYWRkUHl0aG9uUmFuZ2UobGluZXMsIGZpbGVQYXRoLCBkZWZpbml0aW9uLCBzdGF0ZSwgcGFydHMpO1xuICAgICAgaWYgKHRleHQpIHtcbiAgICAgICAgY29uc3QgbmVzdGVkID0gYXdhaXQgY29sbGVjdFB5dGhvbkRlcGVuZGVuY2llcyhzb3VyY2UsIGZpbGVQYXRoLCBkZWZpbml0aW9uLCB0ZXh0LCBob3N0LCBzdGF0ZSwgcGFydHMpO1xuICAgICAgICBoYXlzdGFjayArPSBgXFxuJHt0ZXh0fVxcbmA7XG4gICAgICAgIGlmIChuZXN0ZWQpIHtcbiAgICAgICAgICBoYXlzdGFjayArPSBgXFxuJHtuZXN0ZWR9XFxuYDtcbiAgICAgICAgfVxuICAgICAgICBjb2xsZWN0ZWQgKz0gYCR7bmVzdGVkfVxcbiR7dGV4dH1cXG5gO1xuICAgICAgICBjaGFuZ2VkID0gdHJ1ZTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICBmb3IgKGNvbnN0IGltcG9ydE5vZGUgb2YgbW9kdWxlSW5mby5pbXBvcnRzKSB7XG4gICAgICBjb25zdCB0ZXh0ID0gYXdhaXQgcmVzb2x2ZVB5dGhvbkltcG9ydERlcGVuZGVuY3koaW1wb3J0Tm9kZSwgbGluZXMsIGZpbGVQYXRoLCB1c2FnZSwgaG9zdCwgc3RhdGUsIHBhcnRzKTtcbiAgICAgIGlmICh0ZXh0KSB7XG4gICAgICAgIGhheXN0YWNrICs9IGBcXG4ke3RleHR9XFxuYDtcbiAgICAgICAgY29sbGVjdGVkICs9IGAke3RleHR9XFxuYDtcbiAgICAgICAgY2hhbmdlZCA9IHRydWU7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIGNvbGxlY3RlZDtcbn1cblxuYXN5bmMgZnVuY3Rpb24gcmVzb2x2ZVB5dGhvbkltcG9ydERlcGVuZGVuY3koXG4gIGltcG9ydE5vZGU6IFB5dGhvbkltcG9ydCxcbiAgbGluZXM6IHN0cmluZ1tdLFxuICBmaWxlUGF0aDogc3RyaW5nLFxuICB1c2FnZTogUHl0aG9uVXNhZ2UsXG4gIGhvc3Q6IGxvb21Tb3VyY2VFeHRyYWN0aW9uSG9zdCxcbiAgc3RhdGU6IFB5dGhvbkRlcGVuZGVuY3lTdGF0ZSxcbiAgcGFydHM6IHN0cmluZ1tdLFxuKTogUHJvbWlzZTxzdHJpbmc+IHtcbiAgaWYgKGltcG9ydE5vZGUua2luZCA9PT0gXCJmcm9tXCIpIHtcbiAgICByZXR1cm4gcmVzb2x2ZVB5dGhvbkZyb21JbXBvcnREZXBlbmRlbmN5KGltcG9ydE5vZGUsIGxpbmVzLCBmaWxlUGF0aCwgdXNhZ2UsIGhvc3QsIHN0YXRlLCBwYXJ0cyk7XG4gIH1cblxuICByZXR1cm4gcmVzb2x2ZVB5dGhvblBsYWluSW1wb3J0RGVwZW5kZW5jeShpbXBvcnROb2RlLCBsaW5lcywgZmlsZVBhdGgsIHVzYWdlLCBob3N0LCBzdGF0ZSwgcGFydHMpO1xufVxuXG5hc3luYyBmdW5jdGlvbiByZXNvbHZlUHl0aG9uRnJvbUltcG9ydERlcGVuZGVuY3koXG4gIGltcG9ydE5vZGU6IFB5dGhvbkltcG9ydCxcbiAgbGluZXM6IHN0cmluZ1tdLFxuICBmaWxlUGF0aDogc3RyaW5nLFxuICB1c2FnZTogUHl0aG9uVXNhZ2UsXG4gIGhvc3Q6IGxvb21Tb3VyY2VFeHRyYWN0aW9uSG9zdCxcbiAgc3RhdGU6IFB5dGhvbkRlcGVuZGVuY3lTdGF0ZSxcbiAgcGFydHM6IHN0cmluZ1tdLFxuKTogUHJvbWlzZTxzdHJpbmc+IHtcbiAgY29uc3QgbG9jYWxNb2R1bGVQYXRoID0gYXdhaXQgaG9zdC5yZXNvbHZlUHl0aG9uSW1wb3J0KGZpbGVQYXRoLCBpbXBvcnROb2RlLm1vZHVsZSwgaW1wb3J0Tm9kZS5sZXZlbCk7XG4gIGxldCBhZGRlZCA9IFwiXCI7XG5cbiAgZm9yIChjb25zdCBhbGlhcyBvZiBpbXBvcnROb2RlLm5hbWVzKSB7XG4gICAgaWYgKGFsaWFzLm5hbWUgPT09IFwiKlwiKSB7XG4gICAgICBpZiAoIWxvY2FsTW9kdWxlUGF0aCkge1xuICAgICAgICBpZiAodXNlc1Vua25vd25JbXBvcnRlZE5hbWVzKHVzYWdlKSAmJiBhZGRQeXRob25JbXBvcnRMaW5lKGxpbmVzLCBpbXBvcnROb2RlLCBzdGF0ZSkpIHtcbiAgICAgICAgICBhZGRlZCArPSBgJHtyZW5kZXJSYW5nZShsaW5lcywgaW1wb3J0Tm9kZSl9XFxuYDtcbiAgICAgICAgfVxuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cblxuICAgICAgY29uc3Qgc291cmNlID0gYXdhaXQgaG9zdC5yZWFkRmlsZShsb2NhbE1vZHVsZVBhdGgpO1xuICAgICAgaWYgKCFzb3VyY2UpIHtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICBjb25zdCBtb2R1bGVJbmZvID0gYXdhaXQgaW5zcGVjdFB5dGhvbk1vZHVsZShzb3VyY2UsIGhvc3QpO1xuICAgICAgZm9yIChjb25zdCBkZWZpbml0aW9uIG9mIG1vZHVsZUluZm8uZGVmaW5pdGlvbnMpIHtcbiAgICAgICAgaWYgKCFweXRob25EZWZpbml0aW9uSXNVc2VkKGRlZmluaXRpb24sIHVzYWdlKSkge1xuICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICB9XG4gICAgICAgIGFkZGVkICs9IGF3YWl0IGV4dHJhY3RQeXRob25TeW1ib2xGcm9tRmlsZShsb2NhbE1vZHVsZVBhdGgsIGRlZmluaXRpb24ubmFtZSwgaG9zdCwgc3RhdGUsIHBhcnRzKTtcbiAgICAgIH1cbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cblxuICAgIGNvbnN0IGV4cG9zZWROYW1lID0gYWxpYXMuYXNuYW1lID8/IGFsaWFzLm5hbWU7XG4gICAgaWYgKCF1c2FnZS5uYW1lcy5pbmNsdWRlcyhleHBvc2VkTmFtZSkpIHtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cblxuICAgIGNvbnN0IHN1Ym1vZHVsZVBhdGggPSBhd2FpdCBob3N0LnJlc29sdmVQeXRob25JbXBvcnQoZmlsZVBhdGgsIGpvaW5QeXRob25Nb2R1bGUoaW1wb3J0Tm9kZS5tb2R1bGUsIGFsaWFzLm5hbWUpLCBpbXBvcnROb2RlLmxldmVsKTtcbiAgICBjb25zdCBpbXBvcnRUYXJnZXRQYXRoID0gbG9jYWxNb2R1bGVQYXRoID8/IHN1Ym1vZHVsZVBhdGg7XG4gICAgaWYgKCFpbXBvcnRUYXJnZXRQYXRoKSB7XG4gICAgICBpZiAoYWRkUHl0aG9uSW1wb3J0TGluZShsaW5lcywgaW1wb3J0Tm9kZSwgc3RhdGUpKSB7XG4gICAgICAgIGFkZGVkICs9IGAke3JlbmRlclJhbmdlKGxpbmVzLCBpbXBvcnROb2RlKX1cXG5gO1xuICAgICAgfVxuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgY29uc3QgZXh0cmFjdGVkID0gYXdhaXQgZXh0cmFjdFB5dGhvblN5bWJvbEZyb21GaWxlKGltcG9ydFRhcmdldFBhdGgsIGFsaWFzLm5hbWUsIGhvc3QsIHN0YXRlLCBwYXJ0cyk7XG4gICAgaWYgKGV4dHJhY3RlZCkge1xuICAgICAgYWRkZWQgKz0gZXh0cmFjdGVkO1xuICAgICAgaWYgKGFsaWFzLmFzbmFtZSAmJiBhbGlhcy5hc25hbWUgIT09IGFsaWFzLm5hbWUpIHtcbiAgICAgICAgYWRkZWQgKz0gYWRkUHl0aG9uQWxpYXMoYWxpYXMubmFtZSwgYWxpYXMuYXNuYW1lLCBzdGF0ZSwgcGFydHMpO1xuICAgICAgfVxuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgY29uc3QgbW9kdWxlQmluZGluZyA9IGFsaWFzLmFzbmFtZSA/PyBhbGlhcy5uYW1lO1xuICAgIGNvbnN0IG1vZHVsZUF0dHJpYnV0ZXMgPSB1c2FnZS5hdHRyaWJ1dGVzW21vZHVsZUJpbmRpbmddID8/IFtdO1xuICAgIGlmIChzdWJtb2R1bGVQYXRoICYmIG1vZHVsZUF0dHJpYnV0ZXMubGVuZ3RoKSB7XG4gICAgICBmb3IgKGNvbnN0IGF0dHJpYnV0ZSBvZiBtb2R1bGVBdHRyaWJ1dGVzKSB7XG4gICAgICAgIGFkZGVkICs9IGF3YWl0IGV4dHJhY3RQeXRob25TeW1ib2xGcm9tRmlsZShzdWJtb2R1bGVQYXRoLCBhdHRyaWJ1dGUsIGhvc3QsIHN0YXRlLCBwYXJ0cyk7XG4gICAgICAgIGFkZFB5dGhvbk5hbWVzcGFjZUJpbmRpbmcobW9kdWxlQmluZGluZywgYXR0cmlidXRlLCBzdGF0ZSk7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIGFkZGVkO1xufVxuXG5hc3luYyBmdW5jdGlvbiByZXNvbHZlUHl0aG9uUGxhaW5JbXBvcnREZXBlbmRlbmN5KFxuICBpbXBvcnROb2RlOiBQeXRob25JbXBvcnQsXG4gIGxpbmVzOiBzdHJpbmdbXSxcbiAgZmlsZVBhdGg6IHN0cmluZyxcbiAgdXNhZ2U6IFB5dGhvblVzYWdlLFxuICBob3N0OiBsb29tU291cmNlRXh0cmFjdGlvbkhvc3QsXG4gIHN0YXRlOiBQeXRob25EZXBlbmRlbmN5U3RhdGUsXG4gIHBhcnRzOiBzdHJpbmdbXSxcbik6IFByb21pc2U8c3RyaW5nPiB7XG4gIGxldCBhZGRlZCA9IFwiXCI7XG5cbiAgZm9yIChjb25zdCBhbGlhcyBvZiBpbXBvcnROb2RlLm5hbWVzKSB7XG4gICAgY29uc3QgYmluZGluZyA9IGFsaWFzLmFzbmFtZSA/PyBhbGlhcy5uYW1lLnNwbGl0KFwiLlwiKVswXTtcbiAgICBjb25zdCB1c2VkQXR0cmlidXRlcyA9IHVzYWdlLmF0dHJpYnV0ZXNbYmluZGluZ10gPz8gW107XG4gICAgY29uc3QgYmluZGluZ0lzVXNlZCA9IHVzYWdlLm5hbWVzLmluY2x1ZGVzKGJpbmRpbmcpIHx8IHVzZWRBdHRyaWJ1dGVzLmxlbmd0aCA+IDA7XG4gICAgaWYgKCFiaW5kaW5nSXNVc2VkKSB7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICBjb25zdCBsb2NhbE1vZHVsZVBhdGggPSBhd2FpdCBob3N0LnJlc29sdmVQeXRob25JbXBvcnQoZmlsZVBhdGgsIGFsaWFzLm5hbWUsIDApO1xuICAgIGlmICghbG9jYWxNb2R1bGVQYXRoKSB7XG4gICAgICBpZiAoYWRkUHl0aG9uSW1wb3J0TGluZShsaW5lcywgaW1wb3J0Tm9kZSwgc3RhdGUpKSB7XG4gICAgICAgIGFkZGVkICs9IGAke3JlbmRlclJhbmdlKGxpbmVzLCBpbXBvcnROb2RlKX1cXG5gO1xuICAgICAgfVxuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgZm9yIChjb25zdCBhdHRyaWJ1dGUgb2YgdXNlZEF0dHJpYnV0ZXMpIHtcbiAgICAgIGFkZGVkICs9IGF3YWl0IGV4dHJhY3RQeXRob25TeW1ib2xGcm9tRmlsZShsb2NhbE1vZHVsZVBhdGgsIGF0dHJpYnV0ZSwgaG9zdCwgc3RhdGUsIHBhcnRzKTtcbiAgICAgIGFkZFB5dGhvbk5hbWVzcGFjZUJpbmRpbmcoYmluZGluZywgYXR0cmlidXRlLCBzdGF0ZSk7XG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIGFkZGVkO1xufVxuXG5hc3luYyBmdW5jdGlvbiBleHRyYWN0UHl0aG9uU3ltYm9sRnJvbUZpbGUoXG4gIGZpbGVQYXRoOiBzdHJpbmcsXG4gIHN5bWJvbE5hbWU6IHN0cmluZyxcbiAgaG9zdDogbG9vbVNvdXJjZUV4dHJhY3Rpb25Ib3N0LFxuICBzdGF0ZTogUHl0aG9uRGVwZW5kZW5jeVN0YXRlLFxuICBwYXJ0czogc3RyaW5nW10sXG4pOiBQcm9taXNlPHN0cmluZz4ge1xuICBjb25zdCB2aXNpdEtleSA9IGAke2ZpbGVQYXRofSMke3N5bWJvbE5hbWV9YDtcbiAgaWYgKHN0YXRlLnZpc2l0aW5nU3ltYm9scy5oYXModmlzaXRLZXkpKSB7XG4gICAgcmV0dXJuIFwiXCI7XG4gIH1cblxuICBjb25zdCBzb3VyY2UgPSBhd2FpdCBob3N0LnJlYWRGaWxlKGZpbGVQYXRoKTtcbiAgaWYgKCFzb3VyY2UpIHtcbiAgICByZXR1cm4gXCJcIjtcbiAgfVxuXG4gIHN0YXRlLnZpc2l0aW5nU3ltYm9scy5hZGQodmlzaXRLZXkpO1xuICB0cnkge1xuICAgIGNvbnN0IGxpbmVzID0gc291cmNlLnNwbGl0KC9cXHI/XFxuLyk7XG4gICAgY29uc3QgbW9kdWxlSW5mbyA9IGF3YWl0IGluc3BlY3RQeXRob25Nb2R1bGUoc291cmNlLCBob3N0KTtcbiAgICBjb25zdCBkZWZpbml0aW9uID0gbW9kdWxlSW5mby5kZWZpbml0aW9ucy5maW5kKChjYW5kaWRhdGUpID0+IChjYW5kaWRhdGUubmFtZXMgPz8gW2NhbmRpZGF0ZS5uYW1lXSkuaW5jbHVkZXMoc3ltYm9sTmFtZSkpO1xuICAgIGlmICghZGVmaW5pdGlvbikge1xuICAgICAgcmV0dXJuIFwiXCI7XG4gICAgfVxuXG4gICAgY29uc3QgdGV4dCA9IHJlbmRlclJhbmdlKGxpbmVzLCBkZWZpbml0aW9uKTtcbiAgICBjb25zdCBkZXBlbmRlbmN5VGV4dCA9IGF3YWl0IGNvbGxlY3RQeXRob25EZXBlbmRlbmNpZXMoc291cmNlLCBmaWxlUGF0aCwgZGVmaW5pdGlvbiwgdGV4dCwgaG9zdCwgc3RhdGUsIHBhcnRzKTtcbiAgICBjb25zdCBhZGRlZCA9IGFkZFB5dGhvblJhbmdlKGxpbmVzLCBmaWxlUGF0aCwgZGVmaW5pdGlvbiwgc3RhdGUsIHBhcnRzKTtcbiAgICByZXR1cm4gW2RlcGVuZGVuY3lUZXh0LCBhZGRlZF0uZmlsdGVyKChwYXJ0KSA9PiBwYXJ0LnRyaW0oKSkuam9pbihcIlxcblwiKTtcbiAgfSBmaW5hbGx5IHtcbiAgICBzdGF0ZS52aXNpdGluZ1N5bWJvbHMuZGVsZXRlKHZpc2l0S2V5KTtcbiAgfVxufVxuXG5mdW5jdGlvbiBhZGRQeXRob25SYW5nZShcbiAgbGluZXM6IHN0cmluZ1tdLFxuICBmaWxlUGF0aDogc3RyaW5nLFxuICByYW5nZTogU291cmNlUmFuZ2UsXG4gIHN0YXRlOiBQeXRob25EZXBlbmRlbmN5U3RhdGUsXG4gIHBhcnRzOiBzdHJpbmdbXSxcbik6IHN0cmluZyB7XG4gIGNvbnN0IGtleSA9IGAke2ZpbGVQYXRofTpMJHtyYW5nZS5zdGFydCArIDF9LUwke3JhbmdlLmVuZCArIDF9YDtcbiAgaWYgKHN0YXRlLmluY2x1ZGVkUmFuZ2VzLmhhcyhrZXkpKSB7XG4gICAgcmV0dXJuIFwiXCI7XG4gIH1cbiAgc3RhdGUuaW5jbHVkZWRSYW5nZXMuYWRkKGtleSk7XG4gIGNvbnN0IHRleHQgPSByZW5kZXJSYW5nZShsaW5lcywgcmFuZ2UpO1xuICBwYXJ0cy5wdXNoKHRleHQpO1xuICByZXR1cm4gdGV4dDtcbn1cblxuZnVuY3Rpb24gYWRkUHl0aG9uSW1wb3J0TGluZShsaW5lczogc3RyaW5nW10sIHJhbmdlOiBTb3VyY2VSYW5nZSwgc3RhdGU6IFB5dGhvbkRlcGVuZGVuY3lTdGF0ZSk6IGJvb2xlYW4ge1xuICBjb25zdCB0ZXh0ID0gcmVuZGVyUmFuZ2UobGluZXMsIHJhbmdlKTtcbiAgaWYgKHN0YXRlLmluY2x1ZGVkSW1wb3J0cy5oYXModGV4dCkpIHtcbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cbiAgc3RhdGUuaW5jbHVkZWRJbXBvcnRzLmFkZCh0ZXh0KTtcbiAgcmV0dXJuIHRydWU7XG59XG5cbmZ1bmN0aW9uIGFkZFB5dGhvbkFsaWFzKG5hbWU6IHN0cmluZywgYXNuYW1lOiBzdHJpbmcsIHN0YXRlOiBQeXRob25EZXBlbmRlbmN5U3RhdGUsIHBhcnRzOiBzdHJpbmdbXSk6IHN0cmluZyB7XG4gIGNvbnN0IGtleSA9IGAke2FzbmFtZX09JHtuYW1lfWA7XG4gIGlmIChzdGF0ZS5hbGlhc2VzLmhhcyhrZXkpKSB7XG4gICAgcmV0dXJuIFwiXCI7XG4gIH1cbiAgc3RhdGUuYWxpYXNlcy5hZGQoa2V5KTtcbiAgY29uc3QgdGV4dCA9IGAke2FzbmFtZX0gPSAke25hbWV9YDtcbiAgcGFydHMucHVzaCh0ZXh0KTtcbiAgcmV0dXJuIGAke3RleHR9XFxuYDtcbn1cblxuZnVuY3Rpb24gYWRkUHl0aG9uTmFtZXNwYWNlQmluZGluZyhiaW5kaW5nOiBzdHJpbmcsIGF0dHJpYnV0ZTogc3RyaW5nLCBzdGF0ZTogUHl0aG9uRGVwZW5kZW5jeVN0YXRlKTogdm9pZCB7XG4gIHN0YXRlLm5lZWRzTmFtZXNwYWNlUnVudGltZSA9IHRydWU7XG4gIGNvbnN0IGF0dHJpYnV0ZXMgPSBzdGF0ZS5uYW1lc3BhY2VCaW5kaW5ncy5nZXQoYmluZGluZykgPz8gbmV3IFNldDxzdHJpbmc+KCk7XG4gIGF0dHJpYnV0ZXMuYWRkKGF0dHJpYnV0ZSk7XG4gIHN0YXRlLm5hbWVzcGFjZUJpbmRpbmdzLnNldChiaW5kaW5nLCBhdHRyaWJ1dGVzKTtcbn1cblxuZnVuY3Rpb24gcmVuZGVyUHl0aG9uTmFtZXNwYWNlQmluZGluZ3Moc3RhdGU6IFB5dGhvbkRlcGVuZGVuY3lTdGF0ZSk6IHN0cmluZyB7XG4gIGlmICghc3RhdGUubmFtZXNwYWNlQmluZGluZ3Muc2l6ZSkge1xuICAgIHJldHVybiBcIlwiO1xuICB9XG5cbiAgY29uc3QgbGluZXMgPSBzdGF0ZS5uZWVkc05hbWVzcGFjZVJ1bnRpbWUgPyBbXCJpbXBvcnQgdHlwZXMgYXMgX2xvb21fdHlwZXNcIl0gOiBbXTtcbiAgZm9yIChjb25zdCBbYmluZGluZywgYXR0cmlidXRlc10gb2Ygc3RhdGUubmFtZXNwYWNlQmluZGluZ3MpIHtcbiAgICBsaW5lcy5wdXNoKGAke2JpbmRpbmd9ID0gX2xvb21fdHlwZXMuU2ltcGxlTmFtZXNwYWNlKClgKTtcbiAgICBmb3IgKGNvbnN0IGF0dHJpYnV0ZSBvZiBhdHRyaWJ1dGVzKSB7XG4gICAgICBsaW5lcy5wdXNoKGAke2JpbmRpbmd9LiR7YXR0cmlidXRlfSA9ICR7YXR0cmlidXRlfWApO1xuICAgIH1cbiAgfVxuICByZXR1cm4gbGluZXMuam9pbihcIlxcblwiKTtcbn1cblxuZnVuY3Rpb24gZmluZFB5dGhvblN5bWJvbFJhbmdlKG1vZHVsZUluZm86IFB5dGhvbk1vZHVsZUluZm8sIHN5bWJvbE5hbWU6IHN0cmluZyk6IFNvdXJjZVJhbmdlIHwgbnVsbCB7XG4gIGNvbnN0IGV4YWN0ID0gbW9kdWxlSW5mby5kZWZpbml0aW9ucy5maW5kKChkZWZpbml0aW9uKSA9PiAoZGVmaW5pdGlvbi5uYW1lcyA/PyBbZGVmaW5pdGlvbi5uYW1lXSkuaW5jbHVkZXMoc3ltYm9sTmFtZSkpO1xuICByZXR1cm4gZXhhY3QgPyB7IHN0YXJ0OiBleGFjdC5zdGFydCwgZW5kOiBleGFjdC5lbmQgfSA6IG51bGw7XG59XG5cbmZ1bmN0aW9uIHB5dGhvbkRlZmluaXRpb25Jc1VzZWQoZGVmaW5pdGlvbjogU291cmNlRGVmaW5pdGlvbiwgdXNhZ2U6IFB5dGhvblVzYWdlKTogYm9vbGVhbiB7XG4gIHJldHVybiAoZGVmaW5pdGlvbi5uYW1lcyA/PyBbZGVmaW5pdGlvbi5uYW1lXSkuc29tZSgobmFtZSkgPT4gdXNhZ2UubmFtZXMuaW5jbHVkZXMobmFtZSkpO1xufVxuXG5mdW5jdGlvbiB1c2VzVW5rbm93bkltcG9ydGVkTmFtZXModXNhZ2U6IFB5dGhvblVzYWdlKTogYm9vbGVhbiB7XG4gIHJldHVybiB1c2FnZS5uYW1lcy5sZW5ndGggPiAwO1xufVxuXG5mdW5jdGlvbiBqb2luUHl0aG9uTW9kdWxlKG1vZHVsZU5hbWU6IHN0cmluZywgbmFtZTogc3RyaW5nKTogc3RyaW5nIHtcbiAgcmV0dXJuIG1vZHVsZU5hbWUgPyBgJHttb2R1bGVOYW1lfS4ke25hbWV9YCA6IG5hbWU7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGluc3BlY3RQeXRob25Nb2R1bGUoc291cmNlOiBzdHJpbmcsIGhvc3Q6IGxvb21Tb3VyY2VFeHRyYWN0aW9uSG9zdCk6IFByb21pc2U8UHl0aG9uTW9kdWxlSW5mbz4ge1xuICByZXR1cm4gcnVuUHl0aG9uQXN0PFB5dGhvbk1vZHVsZUluZm8+KHNvdXJjZSwgXCJtb2R1bGVcIiwgaG9zdCk7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGluc3BlY3RQeXRob25Vc2FnZShzb3VyY2U6IHN0cmluZywgaG9zdDogbG9vbVNvdXJjZUV4dHJhY3Rpb25Ib3N0KTogUHJvbWlzZTxQeXRob25Vc2FnZT4ge1xuICByZXR1cm4gcnVuUHl0aG9uQXN0PFB5dGhvblVzYWdlPihzb3VyY2UsIFwidXNhZ2VcIiwgaG9zdCk7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIHJ1blB5dGhvbkFzdDxUPihzb3VyY2U6IHN0cmluZywgbW9kZTogXCJtb2R1bGVcIiB8IFwidXNhZ2VcIiwgaG9zdDogbG9vbVNvdXJjZUV4dHJhY3Rpb25Ib3N0KTogUHJvbWlzZTxUPiB7XG4gIGNvbnN0IGNvbW1hbmQgPSBzcGxpdENvbW1hbmRMaW5lKGhvc3QucHl0aG9uRXhlY3V0YWJsZT8udHJpbSgpIHx8IFwicHl0aG9uM1wiKTtcbiAgY29uc3QgZXhlY3V0YWJsZSA9IGNvbW1hbmRbMF0gPz8gXCJweXRob24zXCI7XG4gIGNvbnN0IGFyZ3MgPSBbLi4uY29tbWFuZC5zbGljZSgxKSwgXCItY1wiLCBQWVRIT05fQVNUX0hFTFBFUl07XG5cbiAgcmV0dXJuIG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICBjb25zdCBjaGlsZCA9IHNwYXduKGV4ZWN1dGFibGUsIGFyZ3MsIHsgc3RkaW86IFtcInBpcGVcIiwgXCJwaXBlXCIsIFwicGlwZVwiXSB9KTtcbiAgICBsZXQgc3Rkb3V0ID0gXCJcIjtcbiAgICBsZXQgc3RkZXJyID0gXCJcIjtcblxuICAgIGNoaWxkLnN0ZG91dC5zZXRFbmNvZGluZyhcInV0ZjhcIik7XG4gICAgY2hpbGQuc3RkZXJyLnNldEVuY29kaW5nKFwidXRmOFwiKTtcbiAgICBjaGlsZC5zdGRvdXQub24oXCJkYXRhXCIsIChjaHVuazogc3RyaW5nKSA9PiB7XG4gICAgICBzdGRvdXQgKz0gY2h1bms7XG4gICAgfSk7XG4gICAgY2hpbGQuc3RkZXJyLm9uKFwiZGF0YVwiLCAoY2h1bms6IHN0cmluZykgPT4ge1xuICAgICAgc3RkZXJyICs9IGNodW5rO1xuICAgIH0pO1xuICAgIGNoaWxkLm9uKFwiZXJyb3JcIiwgcmVqZWN0KTtcbiAgICBjaGlsZC5vbihcImNsb3NlXCIsIChjb2RlKSA9PiB7XG4gICAgICBpZiAoY29kZSAhPT0gMCkge1xuICAgICAgICByZWplY3QobmV3IEVycm9yKChzdGRlcnIgfHwgc3Rkb3V0IHx8IGBQeXRob24gQVNUIGhlbHBlciBleGl0ZWQgd2l0aCBjb2RlICR7Y29kZX0uYCkudHJpbSgpKSk7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cbiAgICAgIHRyeSB7XG4gICAgICAgIHJlc29sdmUoSlNPTi5wYXJzZShzdGRvdXQpIGFzIFQpO1xuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgcmVqZWN0KGVycm9yKTtcbiAgICAgIH1cbiAgICB9KTtcblxuICAgIGNoaWxkLnN0ZGluLmVuZChKU09OLnN0cmluZ2lmeSh7IG1vZGUsIHNvdXJjZSB9KSk7XG4gIH0pO1xufVxuXG5mdW5jdGlvbiBmaW5kTGluZVJhbmdlKGxpbmVzOiBzdHJpbmdbXSwgcmVmZXJlbmNlOiBsb29tU291cmNlUmVmZXJlbmNlKTogU291cmNlUmFuZ2UgfCBudWxsIHtcbiAgY29uc3Qgc3RhcnQgPSBNYXRoLm1heCgocmVmZXJlbmNlLmxpbmVTdGFydCA/PyAxKSAtIDEsIDApO1xuICBjb25zdCBlbmQgPSBNYXRoLm1pbigocmVmZXJlbmNlLmxpbmVFbmQgPz8gcmVmZXJlbmNlLmxpbmVTdGFydCA/PyBsaW5lcy5sZW5ndGgpIC0gMSwgbGluZXMubGVuZ3RoIC0gMSk7XG4gIGlmIChzdGFydCA+IGVuZCB8fCBzdGFydCA+PSBsaW5lcy5sZW5ndGgpIHtcbiAgICByZXR1cm4gbnVsbDtcbiAgfVxuICByZXR1cm4geyBzdGFydCwgZW5kIH07XG59XG5cbmZ1bmN0aW9uIGZpbmRTeW1ib2xSYW5nZShsaW5lczogc3RyaW5nW10sIGxhbmd1YWdlOiBsb29tTm9ybWFsaXplZExhbmd1YWdlLCBzeW1ib2xOYW1lOiBzdHJpbmcpOiBTb3VyY2VSYW5nZSB8IG51bGwge1xuICBjb25zdCBkZWZpbml0aW9ucyA9IGNvbGxlY3REZWZpbml0aW9ucyhsaW5lcywgbGFuZ3VhZ2UpO1xuICBjb25zdCBleGFjdCA9IGRlZmluaXRpb25zLmZpbmQoKGRlZmluaXRpb24pID0+IGRlZmluaXRpb25OYW1lcyhkZWZpbml0aW9uKS5pbmNsdWRlcyhzeW1ib2xOYW1lKSk7XG4gIGlmIChleGFjdCkge1xuICAgIHJldHVybiB7IHN0YXJ0OiBleGFjdC5zdGFydCwgZW5kOiBleGFjdC5lbmQgfTtcbiAgfVxuXG4gIGNvbnN0IHN5bWJvbFBhdHRlcm4gPSBuZXcgUmVnRXhwKGBcXFxcYiR7ZXNjYXBlUmVnZXgoc3ltYm9sTmFtZSl9XFxcXGJgKTtcbiAgY29uc3QgbGluZSA9IGxpbmVzLmZpbmRJbmRleCgoY2FuZGlkYXRlKSA9PiBzeW1ib2xQYXR0ZXJuLnRlc3QoY2FuZGlkYXRlKSk7XG4gIGlmIChsaW5lIDwgMCkge1xuICAgIHJldHVybiBudWxsO1xuICB9XG4gIHJldHVybiBsaW5lc1tsaW5lXS5pbmNsdWRlcyhcIntcIikgPyB7IHN0YXJ0OiBsaW5lLCBlbmQ6IGZpbmRCcmFjZVJhbmdlRW5kKGxpbmVzLCBsaW5lKSB9IDogeyBzdGFydDogbGluZSwgZW5kOiBsaW5lIH07XG59XG5cbmZ1bmN0aW9uIGNvbGxlY3REZXBlbmRlbmN5U291cmNlKGxpbmVzOiBzdHJpbmdbXSwgbGFuZ3VhZ2U6IGxvb21Ob3JtYWxpemVkTGFuZ3VhZ2UsIHNlbGVjdGVkUmFuZ2U6IFNvdXJjZVJhbmdlLCBzZWxlY3RlZDogc3RyaW5nKTogc3RyaW5nIHtcbiAgY29uc3QgcHJvbG9ndWUgPSBjb2xsZWN0UHJvbG9ndWUobGluZXMsIGxhbmd1YWdlLCBzZWxlY3RlZFJhbmdlLnN0YXJ0KTtcbiAgY29uc3QgZGVmaW5pdGlvbnMgPSBjb2xsZWN0RGVmaW5pdGlvbnMobGluZXMsIGxhbmd1YWdlKVxuICAgIC5maWx0ZXIoKGRlZmluaXRpb24pID0+ICFyYW5nZXNPdmVybGFwKGRlZmluaXRpb24sIHNlbGVjdGVkUmFuZ2UpKTtcbiAgY29uc3Qgc2VsZWN0ZWREZWZpbml0aW9ucyA9IHRyYWNlRGVmaW5pdGlvbnMoc2VsZWN0ZWQsIGRlZmluaXRpb25zLCBsaW5lcyk7XG4gIHJldHVybiBbLi4ucHJvbG9ndWUsIC4uLnNlbGVjdGVkRGVmaW5pdGlvbnMubWFwKChkZWZpbml0aW9uKSA9PiByZW5kZXJSYW5nZShsaW5lcywgZGVmaW5pdGlvbikpXVxuICAgIC5maWx0ZXIoKHBhcnQpID0+IHBhcnQudHJpbSgpKVxuICAgIC5qb2luKFwiXFxuXFxuXCIpO1xufVxuXG5mdW5jdGlvbiB0cmFjZURlZmluaXRpb25zKHNlZWQ6IHN0cmluZywgZGVmaW5pdGlvbnM6IFNvdXJjZURlZmluaXRpb25bXSwgbGluZXM6IHN0cmluZ1tdKTogU291cmNlRGVmaW5pdGlvbltdIHtcbiAgY29uc3Qgc2VsZWN0ZWQ6IFNvdXJjZURlZmluaXRpb25bXSA9IFtdO1xuICBjb25zdCBzZWxlY3RlZEtleXMgPSBuZXcgU2V0PHN0cmluZz4oKTtcbiAgbGV0IGhheXN0YWNrID0gc2VlZDtcbiAgbGV0IGNoYW5nZWQgPSB0cnVlO1xuXG4gIHdoaWxlIChjaGFuZ2VkKSB7XG4gICAgY2hhbmdlZCA9IGZhbHNlO1xuICAgIGZvciAoY29uc3QgZGVmaW5pdGlvbiBvZiBkZWZpbml0aW9ucykge1xuICAgICAgY29uc3Qga2V5ID0gYCR7ZGVmaW5pdGlvbi5zdGFydH06JHtkZWZpbml0aW9uLmVuZH06JHtkZWZpbml0aW9uLm5hbWV9YDtcbiAgICAgIGlmIChzZWxlY3RlZEtleXMuaGFzKGtleSkpIHtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICBpZiAoIWRlZmluaXRpb25OYW1lcyhkZWZpbml0aW9uKS5zb21lKChuYW1lKSA9PiBzb3VyY2VVc2VzTmFtZShoYXlzdGFjaywgbmFtZSkpKSB7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgc2VsZWN0ZWRLZXlzLmFkZChrZXkpO1xuICAgICAgc2VsZWN0ZWQucHVzaChkZWZpbml0aW9uKTtcbiAgICAgIGhheXN0YWNrICs9IGBcXG4ke3JlbmRlclJhbmdlKGxpbmVzLCBkZWZpbml0aW9uKX1cXG5gO1xuICAgICAgY2hhbmdlZCA9IHRydWU7XG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIHNlbGVjdGVkLnNvcnQoKGxlZnQsIHJpZ2h0KSA9PiBsZWZ0LnN0YXJ0IC0gcmlnaHQuc3RhcnQpO1xufVxuXG5mdW5jdGlvbiBjb2xsZWN0UHJvbG9ndWUobGluZXM6IHN0cmluZ1tdLCBsYW5ndWFnZTogbG9vbU5vcm1hbGl6ZWRMYW5ndWFnZSwgYmVmb3JlTGluZTogbnVtYmVyKTogc3RyaW5nW10ge1xuICBjb25zdCBwcm9sb2d1ZTogc3RyaW5nW10gPSBbXTtcbiAgY29uc3QgbWF4ID0gTWF0aC5tYXgoYmVmb3JlTGluZSwgMCk7XG4gIGZvciAobGV0IGluZGV4ID0gMDsgaW5kZXggPCBtYXg7IGluZGV4ICs9IDEpIHtcbiAgICBjb25zdCBsaW5lID0gbGluZXNbaW5kZXhdO1xuICAgIGlmIChpc1Byb2xvZ3VlTGluZShsaW5lLCBsYW5ndWFnZSkpIHtcbiAgICAgIHByb2xvZ3VlLnB1c2gobGluZSk7XG4gICAgfVxuICB9XG4gIHJldHVybiBwcm9sb2d1ZS5sZW5ndGggPyBbcHJvbG9ndWUuam9pbihcIlxcblwiKV0gOiBbXTtcbn1cblxuZnVuY3Rpb24gaXNQcm9sb2d1ZUxpbmUobGluZTogc3RyaW5nLCBsYW5ndWFnZTogbG9vbU5vcm1hbGl6ZWRMYW5ndWFnZSk6IGJvb2xlYW4ge1xuICBjb25zdCB0cmltbWVkID0gbGluZS50cmltKCk7XG4gIGlmICghdHJpbW1lZCkge1xuICAgIHJldHVybiBmYWxzZTtcbiAgfVxuICBzd2l0Y2ggKGxhbmd1YWdlKSB7XG4gICAgY2FzZSBcInB5dGhvblwiOlxuICAgICAgcmV0dXJuIC9eKGZyb21cXHMrXFxTK1xccytpbXBvcnRcXHMrfGltcG9ydFxccyspLy50ZXN0KHRyaW1tZWQpO1xuICAgIGNhc2UgXCJqYXZhc2NyaXB0XCI6XG4gICAgY2FzZSBcInR5cGVzY3JpcHRcIjpcbiAgICAgIHJldHVybiAvXihpbXBvcnRcXHMrfGV4cG9ydFxccysuKlxccytmcm9tXFxzK3woPzpjb25zdHxsZXR8dmFyKVxccytcXHcrXFxzKj1cXHMqcmVxdWlyZVxccypcXCgpLy50ZXN0KHRyaW1tZWQpO1xuICAgIGNhc2UgXCJjXCI6XG4gICAgY2FzZSBcImNwcFwiOlxuICAgIGNhc2UgXCJsbHZtLWlyXCI6XG4gICAgICByZXR1cm4gdHJpbW1lZC5zdGFydHNXaXRoKFwiI1wiKSB8fCB0cmltbWVkLnN0YXJ0c1dpdGgoXCJ0YXJnZXQgXCIpIHx8IHRyaW1tZWQuc3RhcnRzV2l0aChcInNvdXJjZV9maWxlbmFtZVwiKTtcbiAgICBjYXNlIFwiaGFza2VsbFwiOlxuICAgICAgcmV0dXJuIC9eKG1vZHVsZVxccyt8aW1wb3J0XFxzKykvLnRlc3QodHJpbW1lZCk7XG4gICAgY2FzZSBcIm9jYW1sXCI6XG4gICAgICByZXR1cm4gL14ob3Blblxccyt8aW5jbHVkZVxccyt8I3VzZVxccyspLy50ZXN0KHRyaW1tZWQpO1xuICAgIGNhc2UgXCJqYXZhXCI6XG4gICAgICByZXR1cm4gL14ocGFja2FnZVxccyt8aW1wb3J0XFxzKykvLnRlc3QodHJpbW1lZCk7XG4gICAgZGVmYXVsdDpcbiAgICAgIHJldHVybiBmYWxzZTtcbiAgfVxufVxuXG5mdW5jdGlvbiBjb2xsZWN0RGVmaW5pdGlvbnMobGluZXM6IHN0cmluZ1tdLCBsYW5ndWFnZTogbG9vbU5vcm1hbGl6ZWRMYW5ndWFnZSk6IFNvdXJjZURlZmluaXRpb25bXSB7XG4gIHN3aXRjaCAobGFuZ3VhZ2UpIHtcbiAgICBjYXNlIFwicHl0aG9uXCI6XG4gICAgICByZXR1cm4gY29sbGVjdFB5dGhvbkRlZmluaXRpb25zKGxpbmVzKTtcbiAgICBjYXNlIFwiamF2YXNjcmlwdFwiOlxuICAgIGNhc2UgXCJ0eXBlc2NyaXB0XCI6XG4gICAgICByZXR1cm4gY29sbGVjdEJyYWNlRGVmaW5pdGlvbnMobGluZXMsIC9eKD86ZXhwb3J0XFxzKyk/KD86YXN5bmNcXHMrKT9mdW5jdGlvblxccysoW0EtWmEtel8kXVtcXHckXSopXFxifF4oPzpleHBvcnRcXHMrKT9jbGFzc1xccysoW0EtWmEtel8kXVtcXHckXSopXFxifF4oPzpleHBvcnRcXHMrKT8oPzpjb25zdHxsZXR8dmFyKVxccysoW0EtWmEtel8kXVtcXHckXSopXFxzKj0vKTtcbiAgICBjYXNlIFwiY1wiOlxuICAgICAgcmV0dXJuIGNvbGxlY3RDRGVmaW5pdGlvbnMobGluZXMsIGZhbHNlKTtcbiAgICBjYXNlIFwiY3BwXCI6XG4gICAgICByZXR1cm4gY29sbGVjdENEZWZpbml0aW9ucyhsaW5lcywgdHJ1ZSk7XG4gICAgY2FzZSBcImhhc2tlbGxcIjpcbiAgICAgIHJldHVybiBjb2xsZWN0SGFza2VsbERlZmluaXRpb25zKGxpbmVzKTtcbiAgICBjYXNlIFwib2NhbWxcIjpcbiAgICAgIHJldHVybiBjb2xsZWN0T2NhbWxEZWZpbml0aW9ucyhsaW5lcyk7XG4gICAgY2FzZSBcImphdmFcIjpcbiAgICAgIHJldHVybiBjb2xsZWN0QnJhY2VEZWZpbml0aW9ucyhsaW5lcywgL15cXHMqKD86cHVibGljfHByaXZhdGV8cHJvdGVjdGVkfHN0YXRpY3xmaW5hbHxhYnN0cmFjdHxcXHMpKlxccyooPzpjbGFzc3xpbnRlcmZhY2V8ZW51bXxyZWNvcmQpXFxzKyhbQS1aYS16X11cXHcqKVxcYnxeXFxzKig/OnB1YmxpY3xwcml2YXRlfHByb3RlY3RlZHxzdGF0aWN8ZmluYWx8c3luY2hyb25pemVkfG5hdGl2ZXxcXHMpK1tcXHc8PlxcW1xcXSwuP10rXFxzKyhbQS1aYS16X11cXHcqKVxccypcXChbXjtdKlxcKVxccypcXHsvKTtcbiAgICBjYXNlIFwibGx2bS1pclwiOlxuICAgICAgcmV0dXJuIGNvbGxlY3RMbHZtRGVmaW5pdGlvbnMobGluZXMpO1xuICAgIGRlZmF1bHQ6XG4gICAgICByZXR1cm4gW107XG4gIH1cbn1cblxuZnVuY3Rpb24gY29sbGVjdFB5dGhvbkRlZmluaXRpb25zKGxpbmVzOiBzdHJpbmdbXSk6IFNvdXJjZURlZmluaXRpb25bXSB7XG4gIGNvbnN0IGRlZmluaXRpb25zOiBTb3VyY2VEZWZpbml0aW9uW10gPSBbXTtcbiAgZm9yIChsZXQgaW5kZXggPSAwOyBpbmRleCA8IGxpbmVzLmxlbmd0aDsgaW5kZXggKz0gMSkge1xuICAgIGNvbnN0IGFzc2lnbm1lbnQgPSBsaW5lc1tpbmRleF0ubWF0Y2goL14oW0EtWmEtel9dXFx3KilcXHMqWzo9XS8pO1xuICAgIGlmIChhc3NpZ25tZW50KSB7XG4gICAgICBkZWZpbml0aW9ucy5wdXNoKHsgbmFtZTogYXNzaWdubWVudFsxXSwgc3RhcnQ6IGluZGV4LCBlbmQ6IGluZGV4IH0pO1xuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgY29uc3QgbWF0Y2ggPSBsaW5lc1tpbmRleF0ubWF0Y2goL14oXFxzKikoPzphc3luY1xccyspPyg/OmRlZnxjbGFzcylcXHMrKFtBLVphLXpfXVxcdyopXFxiLyk7XG4gICAgaWYgKCFtYXRjaCkge1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGNvbnN0IGluZGVudCA9IG1hdGNoWzFdLmxlbmd0aDtcbiAgICBsZXQgc3RhcnQgPSBpbmRleDtcbiAgICB3aGlsZSAoc3RhcnQgPiAwICYmIGxpbmVzW3N0YXJ0IC0gMV0udHJpbSgpLnN0YXJ0c1dpdGgoXCJAXCIpICYmIGdldEluZGVudChsaW5lc1tzdGFydCAtIDFdKSA9PT0gaW5kZW50KSB7XG4gICAgICBzdGFydCAtPSAxO1xuICAgIH1cbiAgICBsZXQgZW5kID0gaW5kZXg7XG4gICAgZm9yIChsZXQgY3Vyc29yID0gaW5kZXggKyAxOyBjdXJzb3IgPCBsaW5lcy5sZW5ndGg7IGN1cnNvciArPSAxKSB7XG4gICAgICBpZiAobGluZXNbY3Vyc29yXS50cmltKCkgJiYgZ2V0SW5kZW50KGxpbmVzW2N1cnNvcl0pIDw9IGluZGVudCkge1xuICAgICAgICBicmVhaztcbiAgICAgIH1cbiAgICAgIGVuZCA9IGN1cnNvcjtcbiAgICB9XG4gICAgZGVmaW5pdGlvbnMucHVzaCh7IG5hbWU6IG1hdGNoWzJdLCBzdGFydCwgZW5kIH0pO1xuICB9XG4gIHJldHVybiBkZWZpbml0aW9ucztcbn1cblxuZnVuY3Rpb24gY29sbGVjdENEZWZpbml0aW9ucyhsaW5lczogc3RyaW5nW10sIGlzQ3BwOiBib29sZWFuKTogU291cmNlRGVmaW5pdGlvbltdIHtcbiAgY29uc3QgZGVmaW5pdGlvbnM6IFNvdXJjZURlZmluaXRpb25bXSA9IFtdO1xuICBsZXQgZGVwdGggPSAwO1xuXG4gIGZvciAobGV0IGluZGV4ID0gMDsgaW5kZXggPCBsaW5lcy5sZW5ndGg7IGluZGV4ICs9IDEpIHtcbiAgICBjb25zdCBsaW5lID0gbGluZXNbaW5kZXhdO1xuICAgIGNvbnN0IHRyaW1tZWQgPSBsaW5lLnRyaW0oKTtcbiAgICBjb25zdCB0b3BMZXZlbCA9IGRlcHRoID09PSAwO1xuXG4gICAgaWYgKHRvcExldmVsICYmIHRyaW1tZWQpIHtcbiAgICAgIGNvbnN0IG1hY3JvID0gdHJpbW1lZC5tYXRjaCgvXiNcXHMqZGVmaW5lXFxzKyhbQS1aYS16X11cXHcqKVxcYi8pO1xuICAgICAgaWYgKG1hY3JvKSB7XG4gICAgICAgIGRlZmluaXRpb25zLnB1c2goeyBuYW1lOiBtYWNyb1sxXSwgc3RhcnQ6IGluZGV4LCBlbmQ6IGluZGV4IH0pO1xuICAgICAgfSBlbHNlIGlmICghdHJpbW1lZC5zdGFydHNXaXRoKFwiI1wiKSAmJiAhaXNDQ29tbWVudExpbmUodHJpbW1lZCkpIHtcbiAgICAgICAgY29uc3QgdHlwZURlZmluaXRpb24gPSBtYXRjaENUeXBlRGVmaW5pdGlvbihsaW5lcywgaW5kZXgsIGlzQ3BwKTtcbiAgICAgICAgaWYgKHR5cGVEZWZpbml0aW9uKSB7XG4gICAgICAgICAgZGVmaW5pdGlvbnMucHVzaCh0eXBlRGVmaW5pdGlvbik7XG4gICAgICAgICAgaW5kZXggPSBNYXRoLm1heChpbmRleCwgdHlwZURlZmluaXRpb24uZW5kKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBjb25zdCBmdW5jdGlvbkRlZmluaXRpb24gPSBtYXRjaENGdW5jdGlvbkRlZmluaXRpb24obGluZXMsIGluZGV4KTtcbiAgICAgICAgICBpZiAoZnVuY3Rpb25EZWZpbml0aW9uKSB7XG4gICAgICAgICAgICBkZWZpbml0aW9ucy5wdXNoKGZ1bmN0aW9uRGVmaW5pdGlvbik7XG4gICAgICAgICAgICBpbmRleCA9IE1hdGgubWF4KGluZGV4LCBmdW5jdGlvbkRlZmluaXRpb24uZW5kKTtcbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgY29uc3QgZ2xvYmFsRGVmaW5pdGlvbiA9IG1hdGNoQ0dsb2JhbERlZmluaXRpb24obGluZSwgaW5kZXgpO1xuICAgICAgICAgICAgaWYgKGdsb2JhbERlZmluaXRpb24pIHtcbiAgICAgICAgICAgICAgZGVmaW5pdGlvbnMucHVzaChnbG9iYWxEZWZpbml0aW9uKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG5cbiAgICBkZXB0aCArPSBicmFjZURlbHRhKGxpbmUpO1xuICAgIGlmIChkZXB0aCA8IDApIHtcbiAgICAgIGRlcHRoID0gMDtcbiAgICB9XG4gIH1cblxuICByZXR1cm4gZGVmaW5pdGlvbnM7XG59XG5cbmZ1bmN0aW9uIG1hdGNoQ1R5cGVEZWZpbml0aW9uKGxpbmVzOiBzdHJpbmdbXSwgc3RhcnQ6IG51bWJlciwgaXNDcHA6IGJvb2xlYW4pOiBTb3VyY2VEZWZpbml0aW9uIHwgbnVsbCB7XG4gIGNvbnN0IGhlYWRlciA9IGxpbmVzLnNsaWNlKHN0YXJ0LCBNYXRoLm1pbihsaW5lcy5sZW5ndGgsIHN0YXJ0ICsgOCkpLmpvaW4oXCIgXCIpO1xuICBjb25zdCBrZXl3b3JkUGF0dGVybiA9IGlzQ3BwID8gXCIoPzp0eXBlZGVmXFxcXHMrKT8oPzpzdHJ1Y3R8Y2xhc3N8ZW51bXx1bmlvbilcIiA6IFwiKD86dHlwZWRlZlxcXFxzKyk/KD86c3RydWN0fGVudW18dW5pb24pXCI7XG4gIGNvbnN0IG5hbWVkID0gaGVhZGVyLm1hdGNoKG5ldyBSZWdFeHAoYF5cXFxccyoke2tleXdvcmRQYXR0ZXJufVxcXFxzKyhbQS1aYS16X11cXFxcdyopXFxcXGJgKSk7XG4gIGNvbnN0IGFub255bW91c1R5cGVkZWYgPSBoZWFkZXIubWF0Y2goL15cXHMqdHlwZWRlZlxccysoPzpzdHJ1Y3R8ZW51bXx1bmlvbilcXGJbXFxzXFxTXSo/XFx9XFxzKihbQS1aYS16X11cXHcqKVxccyo7Lyk7XG4gIGNvbnN0IG5hbWUgPSBuYW1lZD8uWzFdID8/IGFub255bW91c1R5cGVkZWY/LlsxXTtcbiAgaWYgKCFuYW1lKSB7XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cblxuICBjb25zdCBlbmQgPSBmaW5kQ0RlY2xhcmF0aW9uRW5kKGxpbmVzLCBzdGFydCk7XG4gIHJldHVybiB7IG5hbWUsIG5hbWVzOiBbbmFtZV0sIHN0YXJ0LCBlbmQgfTtcbn1cblxuZnVuY3Rpb24gbWF0Y2hDRnVuY3Rpb25EZWZpbml0aW9uKGxpbmVzOiBzdHJpbmdbXSwgc3RhcnQ6IG51bWJlcik6IFNvdXJjZURlZmluaXRpb24gfCBudWxsIHtcbiAgY29uc3QgaGVhZGVyTGluZXMgPSBsaW5lcy5zbGljZShzdGFydCwgTWF0aC5taW4obGluZXMubGVuZ3RoLCBzdGFydCArIDEyKSk7XG4gIGNvbnN0IGpvaW5lZCA9IGhlYWRlckxpbmVzLmpvaW4oXCIgXCIpO1xuICBjb25zdCBicmFjZU9mZnNldCA9IGhlYWRlckxpbmVzLmZpbmRJbmRleCgobGluZSkgPT4gbGluZS5pbmNsdWRlcyhcIntcIikpO1xuICBpZiAoYnJhY2VPZmZzZXQgPCAwIHx8IGpvaW5lZC5pbmRleE9mKFwiO1wiKSA+PSAwICYmIGpvaW5lZC5pbmRleE9mKFwiO1wiKSA8IGpvaW5lZC5pbmRleE9mKFwie1wiKSkge1xuICAgIHJldHVybiBudWxsO1xuICB9XG5cbiAgY29uc3QgbWF0Y2hlcyA9IFsuLi5qb2luZWQubWF0Y2hBbGwoLyhbQS1aYS16X11cXHcqKD86OjpbQS1aYS16X11cXHcqKT98b3BlcmF0b3JcXHMqW15cXHMoXSspXFxzKlxcKFteO3t9XSpcXClcXHMqKD86Y29uc3RcXGJbXnt9XSopPyg/Om5vZXhjZXB0XFxiW157fV0qKT8oPzotPlxccypbXnt9XSspP1xcey9nKV07XG4gIGNvbnN0IG5hbWUgPSBtYXRjaGVzWzBdPy5bMV0/LnJlcGxhY2UoL1xccysvZywgXCJcIik7XG4gIGlmICghbmFtZSB8fCBpc0NDb250cm9sS2V5d29yZChuYW1lKSkge1xuICAgIHJldHVybiBudWxsO1xuICB9XG5cbiAgY29uc3QgYnJhY2VMaW5lID0gc3RhcnQgKyBicmFjZU9mZnNldDtcbiAgY29uc3Qgc2hvcnROYW1lID0gbmFtZS5pbmNsdWRlcyhcIjo6XCIpID8gbmFtZS5zcGxpdChcIjo6XCIpLnBvcCgpID8/IG5hbWUgOiBuYW1lO1xuICByZXR1cm4ge1xuICAgIG5hbWU6IHNob3J0TmFtZSxcbiAgICBuYW1lczogWy4uLm5ldyBTZXQoW3Nob3J0TmFtZSwgbmFtZV0pXSxcbiAgICBzdGFydCxcbiAgICBlbmQ6IGZpbmRCcmFjZVJhbmdlRW5kKGxpbmVzLCBicmFjZUxpbmUpLFxuICB9O1xufVxuXG5mdW5jdGlvbiBtYXRjaENHbG9iYWxEZWZpbml0aW9uKGxpbmU6IHN0cmluZywgaW5kZXg6IG51bWJlcik6IFNvdXJjZURlZmluaXRpb24gfCBudWxsIHtcbiAgY29uc3QgdHJpbW1lZCA9IGxpbmUudHJpbSgpO1xuICBpZiAoIXRyaW1tZWQuZW5kc1dpdGgoXCI7XCIpIHx8IHRyaW1tZWQuaW5jbHVkZXMoXCIoXCIpIHx8IC9eKHJldHVybnx1c2luZ3xuYW1lc3BhY2V8dGVtcGxhdGUpXFxiLy50ZXN0KHRyaW1tZWQpKSB7XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cblxuICBjb25zdCB3aXRob3V0SW5pdGlhbGl6ZXIgPSB0cmltbWVkLnNwbGl0KFwiPVwiKVswXS5yZXBsYWNlKC9cXFtbXlxcXV0qXS9nLCBcIlwiKTtcbiAgY29uc3QgbWF0Y2ggPSB3aXRob3V0SW5pdGlhbGl6ZXIubWF0Y2goLyhbQS1aYS16X11cXHcqKVxccyooPzpbLDtdfCQpL2cpPy5wb3AoKT8ubWF0Y2goLyhbQS1aYS16X11cXHcqKS8pO1xuICBjb25zdCBuYW1lID0gbWF0Y2g/LlsxXTtcbiAgaWYgKCFuYW1lIHx8IC9eKGNvbnN0fHN0YXRpY3xleHRlcm58dm9sYXRpbGV8dW5zaWduZWR8c2lnbmVkfGxvbmd8c2hvcnR8aW50fGNoYXJ8ZmxvYXR8ZG91YmxlfHZvaWR8YXV0bykkLy50ZXN0KG5hbWUpKSB7XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cblxuICByZXR1cm4geyBuYW1lLCBzdGFydDogaW5kZXgsIGVuZDogaW5kZXggfTtcbn1cblxuZnVuY3Rpb24gY29sbGVjdExsdm1EZWZpbml0aW9ucyhsaW5lczogc3RyaW5nW10pOiBTb3VyY2VEZWZpbml0aW9uW10ge1xuICBjb25zdCBkZWZpbml0aW9uczogU291cmNlRGVmaW5pdGlvbltdID0gW107XG4gIGZvciAobGV0IGluZGV4ID0gMDsgaW5kZXggPCBsaW5lcy5sZW5ndGg7IGluZGV4ICs9IDEpIHtcbiAgICBjb25zdCBsaW5lID0gbGluZXNbaW5kZXhdO1xuICAgIGNvbnN0IHN5bWJvbCA9IGxpbmUubWF0Y2goL15cXHMqKD86ZGVmaW5lfGRlY2xhcmUpXFxiLipAKFtBLVphLXokLl8tXVtBLVphLXokLl8wLTktXSopXFxzKlxcKC8pO1xuICAgIGlmIChzeW1ib2wpIHtcbiAgICAgIGNvbnN0IGVuZCA9IGxpbmUudHJpbVN0YXJ0KCkuc3RhcnRzV2l0aChcImRlZmluZVwiKSA/IGZpbmRCcmFjZVJhbmdlRW5kKGxpbmVzLCBpbmRleCkgOiBpbmRleDtcbiAgICAgIGRlZmluaXRpb25zLnB1c2goeyBuYW1lOiBzeW1ib2xbMV0sIG5hbWVzOiBbc3ltYm9sWzFdLCBgQCR7c3ltYm9sWzFdfWBdLCBzdGFydDogaW5kZXgsIGVuZCB9KTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cblxuICAgIGNvbnN0IGdsb2JhbCA9IGxpbmUubWF0Y2goL15cXHMqQChbQS1aYS16JC5fLV1bQS1aYS16JC5fMC05LV0qKVxccyo9Lyk7XG4gICAgaWYgKGdsb2JhbCkge1xuICAgICAgZGVmaW5pdGlvbnMucHVzaCh7IG5hbWU6IGdsb2JhbFsxXSwgbmFtZXM6IFtnbG9iYWxbMV0sIGBAJHtnbG9iYWxbMV19YF0sIHN0YXJ0OiBpbmRleCwgZW5kOiBpbmRleCB9KTtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIGRlZmluaXRpb25zO1xufVxuXG5mdW5jdGlvbiBjb2xsZWN0SGFza2VsbERlZmluaXRpb25zKGxpbmVzOiBzdHJpbmdbXSk6IFNvdXJjZURlZmluaXRpb25bXSB7XG4gIGNvbnN0IGRlZmluaXRpb25zOiBTb3VyY2VEZWZpbml0aW9uW10gPSBbXTtcbiAgZm9yIChsZXQgaW5kZXggPSAwOyBpbmRleCA8IGxpbmVzLmxlbmd0aDsgaW5kZXggKz0gMSkge1xuICAgIGNvbnN0IHRyaW1tZWQgPSBsaW5lc1tpbmRleF0udHJpbSgpO1xuICAgIGlmICghdHJpbW1lZCB8fCBnZXRJbmRlbnQobGluZXNbaW5kZXhdKSA+IDAgfHwgL14obW9kdWxlfGltcG9ydClcXGIvLnRlc3QodHJpbW1lZCkpIHtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cblxuICAgIGNvbnN0IG5hbWVzID0gZ2V0SGFza2VsbERlZmluaXRpb25OYW1lcyh0cmltbWVkKTtcbiAgICBpZiAoIW5hbWVzLmxlbmd0aCkge1xuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgY29uc3QgZW5kID0gZmluZEhhc2tlbGxSYW5nZUVuZChsaW5lcywgaW5kZXgsIG5hbWVzWzBdKTtcbiAgICBkZWZpbml0aW9ucy5wdXNoKHsgbmFtZTogbmFtZXNbMF0sIG5hbWVzLCBzdGFydDogaW5kZXgsIGVuZCB9KTtcbiAgICBpbmRleCA9IGVuZDtcbiAgfVxuICByZXR1cm4gZGVmaW5pdGlvbnM7XG59XG5cbmZ1bmN0aW9uIGNvbGxlY3RPY2FtbERlZmluaXRpb25zKGxpbmVzOiBzdHJpbmdbXSk6IFNvdXJjZURlZmluaXRpb25bXSB7XG4gIGNvbnN0IGRlZmluaXRpb25zOiBTb3VyY2VEZWZpbml0aW9uW10gPSBbXTtcbiAgZm9yIChsZXQgaW5kZXggPSAwOyBpbmRleCA8IGxpbmVzLmxlbmd0aDsgaW5kZXggKz0gMSkge1xuICAgIGNvbnN0IHRyaW1tZWQgPSBsaW5lc1tpbmRleF0udHJpbSgpO1xuICAgIGlmICghdHJpbW1lZCB8fCBnZXRJbmRlbnQobGluZXNbaW5kZXhdKSA+IDAgfHwgL14ob3BlbnxpbmNsdWRlfCN1c2UpXFxiLy50ZXN0KHRyaW1tZWQpKSB7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICBjb25zdCBuYW1lcyA9IGdldE9jYW1sRGVmaW5pdGlvbk5hbWVzKHRyaW1tZWQpO1xuICAgIGlmICghbmFtZXMubGVuZ3RoKSB7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICBjb25zdCBlbmQgPSBmaW5kTGF5b3V0UmFuZ2VFbmQobGluZXMsIGluZGV4LCBpc09jYW1sVG9wTGV2ZWxTdGFydCk7XG4gICAgZGVmaW5pdGlvbnMucHVzaCh7IG5hbWU6IG5hbWVzWzBdLCBuYW1lcywgc3RhcnQ6IGluZGV4LCBlbmQgfSk7XG4gICAgaW5kZXggPSBlbmQ7XG4gIH1cbiAgcmV0dXJuIGRlZmluaXRpb25zO1xufVxuXG5mdW5jdGlvbiBjb2xsZWN0QnJhY2VEZWZpbml0aW9ucyhsaW5lczogc3RyaW5nW10sIHBhdHRlcm46IFJlZ0V4cCk6IFNvdXJjZURlZmluaXRpb25bXSB7XG4gIGNvbnN0IGRlZmluaXRpb25zOiBTb3VyY2VEZWZpbml0aW9uW10gPSBbXTtcbiAgZm9yIChsZXQgaW5kZXggPSAwOyBpbmRleCA8IGxpbmVzLmxlbmd0aDsgaW5kZXggKz0gMSkge1xuICAgIGNvbnN0IG1hdGNoID0gbGluZXNbaW5kZXhdLm1hdGNoKHBhdHRlcm4pO1xuICAgIGNvbnN0IG5hbWUgPSBtYXRjaD8uc2xpY2UoMSkuZmluZChCb29sZWFuKTtcbiAgICBpZiAoIW5hbWUpIHtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBkZWZpbml0aW9ucy5wdXNoKHsgbmFtZSwgc3RhcnQ6IGluZGV4LCBlbmQ6IGZpbmRCcmFjZVJhbmdlRW5kKGxpbmVzLCBpbmRleCkgfSk7XG4gIH1cbiAgcmV0dXJuIGRlZmluaXRpb25zO1xufVxuXG5mdW5jdGlvbiBmaW5kQnJhY2VSYW5nZUVuZChsaW5lczogc3RyaW5nW10sIHN0YXJ0OiBudW1iZXIpOiBudW1iZXIge1xuICBpZiAoIWxpbmVzW3N0YXJ0XS5pbmNsdWRlcyhcIntcIikpIHtcbiAgICByZXR1cm4gc3RhcnQ7XG4gIH1cblxuICBsZXQgZGVwdGggPSAwO1xuICBsZXQgc2F3QnJhY2UgPSBmYWxzZTtcbiAgZm9yIChsZXQgaW5kZXggPSBzdGFydDsgaW5kZXggPCBsaW5lcy5sZW5ndGg7IGluZGV4ICs9IDEpIHtcbiAgICBmb3IgKGNvbnN0IGNoYXIgb2YgbGluZXNbaW5kZXhdKSB7XG4gICAgICBpZiAoY2hhciA9PT0gXCJ7XCIpIHtcbiAgICAgICAgZGVwdGggKz0gMTtcbiAgICAgICAgc2F3QnJhY2UgPSB0cnVlO1xuICAgICAgfSBlbHNlIGlmIChjaGFyID09PSBcIn1cIikge1xuICAgICAgICBkZXB0aCAtPSAxO1xuICAgICAgfVxuICAgIH1cbiAgICBpZiAoc2F3QnJhY2UgJiYgZGVwdGggPD0gMCkge1xuICAgICAgcmV0dXJuIGluZGV4O1xuICAgIH1cbiAgfVxuICByZXR1cm4gc3RhcnQ7XG59XG5cbmZ1bmN0aW9uIGZpbmRDRGVjbGFyYXRpb25FbmQobGluZXM6IHN0cmluZ1tdLCBzdGFydDogbnVtYmVyKTogbnVtYmVyIHtcbiAgbGV0IHNhd0JyYWNlID0gZmFsc2U7XG4gIGxldCBkZXB0aCA9IDA7XG4gIGZvciAobGV0IGluZGV4ID0gc3RhcnQ7IGluZGV4IDwgbGluZXMubGVuZ3RoOyBpbmRleCArPSAxKSB7XG4gICAgZm9yIChjb25zdCBjaGFyIG9mIGxpbmVzW2luZGV4XSkge1xuICAgICAgaWYgKGNoYXIgPT09IFwie1wiKSB7XG4gICAgICAgIGRlcHRoICs9IDE7XG4gICAgICAgIHNhd0JyYWNlID0gdHJ1ZTtcbiAgICAgIH0gZWxzZSBpZiAoY2hhciA9PT0gXCJ9XCIpIHtcbiAgICAgICAgZGVwdGggLT0gMTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAoKCFzYXdCcmFjZSB8fCBkZXB0aCA8PSAwKSAmJiBsaW5lc1tpbmRleF0uaW5jbHVkZXMoXCI7XCIpKSB7XG4gICAgICByZXR1cm4gaW5kZXg7XG4gICAgfVxuICB9XG4gIHJldHVybiBzdGFydDtcbn1cblxuZnVuY3Rpb24gYnJhY2VEZWx0YShsaW5lOiBzdHJpbmcpOiBudW1iZXIge1xuICBsZXQgZGVsdGEgPSAwO1xuICBmb3IgKGNvbnN0IGNoYXIgb2YgbGluZSkge1xuICAgIGlmIChjaGFyID09PSBcIntcIikge1xuICAgICAgZGVsdGEgKz0gMTtcbiAgICB9IGVsc2UgaWYgKGNoYXIgPT09IFwifVwiKSB7XG4gICAgICBkZWx0YSAtPSAxO1xuICAgIH1cbiAgfVxuICByZXR1cm4gZGVsdGE7XG59XG5cbmZ1bmN0aW9uIGlzQ0NvbW1lbnRMaW5lKHRyaW1tZWQ6IHN0cmluZyk6IGJvb2xlYW4ge1xuICByZXR1cm4gdHJpbW1lZC5zdGFydHNXaXRoKFwiLy9cIikgfHwgdHJpbW1lZC5zdGFydHNXaXRoKFwiLypcIikgfHwgdHJpbW1lZC5zdGFydHNXaXRoKFwiKlwiKTtcbn1cblxuZnVuY3Rpb24gaXNDQ29udHJvbEtleXdvcmQobmFtZTogc3RyaW5nKTogYm9vbGVhbiB7XG4gIHJldHVybiBbXCJpZlwiLCBcImZvclwiLCBcIndoaWxlXCIsIFwic3dpdGNoXCIsIFwiY2F0Y2hcIl0uaW5jbHVkZXMobmFtZSk7XG59XG5cbmZ1bmN0aW9uIGdldEhhc2tlbGxEZWZpbml0aW9uTmFtZXModHJpbW1lZDogc3RyaW5nKTogc3RyaW5nW10ge1xuICBjb25zdCBzaWduYXR1cmUgPSB0cmltbWVkLm1hdGNoKC9eKFthLXpfXVtcXHcnXSopXFxzKjo6Lyk7XG4gIGlmIChzaWduYXR1cmUpIHtcbiAgICByZXR1cm4gW3NpZ25hdHVyZVsxXV07XG4gIH1cblxuICBjb25zdCBiaW5kaW5nID0gdHJpbW1lZC5tYXRjaCgvXihbYS16X11bXFx3J10qKVxcYi4qPS8pO1xuICBpZiAoYmluZGluZykge1xuICAgIHJldHVybiBbYmluZGluZ1sxXV07XG4gIH1cblxuICBjb25zdCB0eXBlTGlrZSA9IHRyaW1tZWQubWF0Y2goL14oPzpkYXRhfG5ld3R5cGV8dHlwZXxjbGFzcylcXHMrKFtBLVpdW1xcdyddKilcXGIvKTtcbiAgaWYgKHR5cGVMaWtlKSB7XG4gICAgcmV0dXJuIFt0eXBlTGlrZVsxXV07XG4gIH1cblxuICBjb25zdCBpbnN0YW5jZSA9IHRyaW1tZWQubWF0Y2goL15pbnN0YW5jZVxcYi4qP1xcYihbQS1aXVtcXHcnXSopXFxiLyk7XG4gIHJldHVybiBpbnN0YW5jZSA/IFtpbnN0YW5jZVsxXV0gOiBbXTtcbn1cblxuZnVuY3Rpb24gZ2V0T2NhbWxEZWZpbml0aW9uTmFtZXModHJpbW1lZDogc3RyaW5nKTogc3RyaW5nW10ge1xuICBjb25zdCBsZXRCaW5kaW5nID0gdHJpbW1lZC5tYXRjaCgvXmxldFxccysoPzpyZWNcXHMrKT8oPzpcXCgoW14pXSspXFwpfChbYS16X11bXFx3J10qKSkvKTtcbiAgaWYgKGxldEJpbmRpbmcpIHtcbiAgICByZXR1cm4gW2xldEJpbmRpbmdbMV0gPz8gbGV0QmluZGluZ1syXV07XG4gIH1cblxuICBjb25zdCB0eXBlQmluZGluZyA9IHRyaW1tZWQubWF0Y2goL150eXBlXFxzKyhbYS16X11bXFx3J10qKS8pO1xuICBpZiAodHlwZUJpbmRpbmcpIHtcbiAgICByZXR1cm4gW3R5cGVCaW5kaW5nWzFdXTtcbiAgfVxuXG4gIGNvbnN0IG1vZHVsZUJpbmRpbmcgPSB0cmltbWVkLm1hdGNoKC9ebW9kdWxlXFxzKyhbQS1aXVtcXHcnXSopLyk7XG4gIGlmIChtb2R1bGVCaW5kaW5nKSB7XG4gICAgcmV0dXJuIFttb2R1bGVCaW5kaW5nWzFdXTtcbiAgfVxuXG4gIHJldHVybiBbXTtcbn1cblxuZnVuY3Rpb24gZmluZExheW91dFJhbmdlRW5kKGxpbmVzOiBzdHJpbmdbXSwgc3RhcnQ6IG51bWJlciwgaXNUb3BMZXZlbFN0YXJ0OiAobGluZTogc3RyaW5nKSA9PiBib29sZWFuKTogbnVtYmVyIHtcbiAgbGV0IGVuZCA9IHN0YXJ0O1xuICBmb3IgKGxldCBpbmRleCA9IHN0YXJ0ICsgMTsgaW5kZXggPCBsaW5lcy5sZW5ndGg7IGluZGV4ICs9IDEpIHtcbiAgICBjb25zdCBsaW5lID0gbGluZXNbaW5kZXhdO1xuICAgIGlmIChsaW5lLnRyaW0oKSAmJiBnZXRJbmRlbnQobGluZSkgPT09IDAgJiYgaXNUb3BMZXZlbFN0YXJ0KGxpbmUudHJpbSgpKSkge1xuICAgICAgYnJlYWs7XG4gICAgfVxuICAgIGVuZCA9IGluZGV4O1xuICB9XG4gIHJldHVybiBlbmQ7XG59XG5cbmZ1bmN0aW9uIGZpbmRIYXNrZWxsUmFuZ2VFbmQobGluZXM6IHN0cmluZ1tdLCBzdGFydDogbnVtYmVyLCBuYW1lOiBzdHJpbmcpOiBudW1iZXIge1xuICBsZXQgZW5kID0gc3RhcnQ7XG4gIGxldCBhbGxvd01hdGNoaW5nRXF1YXRpb24gPSBsaW5lc1tzdGFydF0udHJpbSgpLnN0YXJ0c1dpdGgoYCR7bmFtZX0gOjpgKTtcbiAgZm9yIChsZXQgaW5kZXggPSBzdGFydCArIDE7IGluZGV4IDwgbGluZXMubGVuZ3RoOyBpbmRleCArPSAxKSB7XG4gICAgY29uc3QgbGluZSA9IGxpbmVzW2luZGV4XTtcbiAgICBjb25zdCB0cmltbWVkID0gbGluZS50cmltKCk7XG4gICAgaWYgKHRyaW1tZWQgJiYgZ2V0SW5kZW50KGxpbmUpID09PSAwICYmIGlzSGFza2VsbFRvcExldmVsU3RhcnQodHJpbW1lZCkpIHtcbiAgICAgIGlmIChhbGxvd01hdGNoaW5nRXF1YXRpb24gJiYgdHJpbW1lZC5zdGFydHNXaXRoKGAke25hbWV9IGApICYmIHRyaW1tZWQuaW5jbHVkZXMoXCI9XCIpKSB7XG4gICAgICAgIGFsbG93TWF0Y2hpbmdFcXVhdGlvbiA9IGZhbHNlO1xuICAgICAgICBlbmQgPSBpbmRleDtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICBicmVhaztcbiAgICB9XG4gICAgZW5kID0gaW5kZXg7XG4gIH1cbiAgcmV0dXJuIGVuZDtcbn1cblxuZnVuY3Rpb24gaXNIYXNrZWxsVG9wTGV2ZWxTdGFydCh0cmltbWVkOiBzdHJpbmcpOiBib29sZWFuIHtcbiAgcmV0dXJuIC9eKG1vZHVsZXxpbXBvcnR8ZGF0YXxuZXd0eXBlfHR5cGV8Y2xhc3N8aW5zdGFuY2UpXFxiLy50ZXN0KHRyaW1tZWQpXG4gICAgfHwgL15bYS16X11bXFx3J10qXFxzKig/Ojo6fC4qPSkvLnRlc3QodHJpbW1lZCk7XG59XG5cbmZ1bmN0aW9uIGlzT2NhbWxUb3BMZXZlbFN0YXJ0KHRyaW1tZWQ6IHN0cmluZyk6IGJvb2xlYW4ge1xuICByZXR1cm4gL14ob3BlbnxpbmNsdWRlfCN1c2V8bGV0fHR5cGV8bW9kdWxlKVxcYi8udGVzdCh0cmltbWVkKTtcbn1cblxuZnVuY3Rpb24gcmVuZGVyUmFuZ2UobGluZXM6IHN0cmluZ1tdLCByYW5nZTogU291cmNlUmFuZ2UpOiBzdHJpbmcge1xuICByZXR1cm4gbGluZXMuc2xpY2UocmFuZ2Uuc3RhcnQsIHJhbmdlLmVuZCArIDEpLmpvaW4oXCJcXG5cIik7XG59XG5cbmZ1bmN0aW9uIHJhbmdlc092ZXJsYXAobGVmdDogU291cmNlUmFuZ2UsIHJpZ2h0OiBTb3VyY2VSYW5nZSk6IGJvb2xlYW4ge1xuICByZXR1cm4gbGVmdC5zdGFydCA8PSByaWdodC5lbmQgJiYgcmlnaHQuc3RhcnQgPD0gbGVmdC5lbmQ7XG59XG5cbmZ1bmN0aW9uIGdldEluZGVudChsaW5lOiBzdHJpbmcpOiBudW1iZXIge1xuICByZXR1cm4gbGluZS5tYXRjaCgvXlxccyovKT8uWzBdLmxlbmd0aCA/PyAwO1xufVxuXG5mdW5jdGlvbiBlc2NhcGVSZWdleCh2YWx1ZTogc3RyaW5nKTogc3RyaW5nIHtcbiAgcmV0dXJuIHZhbHVlLnJlcGxhY2UoL1suKis/XiR7fSgpfFtcXF1cXFxcXS9nLCBcIlxcXFwkJlwiKTtcbn1cblxuZnVuY3Rpb24gZGVmaW5pdGlvbk5hbWVzKGRlZmluaXRpb246IFNvdXJjZURlZmluaXRpb24pOiBzdHJpbmdbXSB7XG4gIHJldHVybiBkZWZpbml0aW9uLm5hbWVzPy5sZW5ndGggPyBkZWZpbml0aW9uLm5hbWVzIDogW2RlZmluaXRpb24ubmFtZV07XG59XG5cbmZ1bmN0aW9uIHNvdXJjZVVzZXNOYW1lKHNvdXJjZTogc3RyaW5nLCBuYW1lOiBzdHJpbmcpOiBib29sZWFuIHtcbiAgaWYgKG5hbWUuc3RhcnRzV2l0aChcIkBcIikpIHtcbiAgICByZXR1cm4gbmV3IFJlZ0V4cChgJHtlc2NhcGVSZWdleChuYW1lKX1cXFxcYmApLnRlc3Qoc291cmNlKTtcbiAgfVxuICByZXR1cm4gbmV3IFJlZ0V4cChgXFxcXGIke2VzY2FwZVJlZ2V4KG5hbWUpfVxcXFxiYCkudGVzdChzb3VyY2UpO1xufVxuXG5mdW5jdGlvbiBmb3JtYXRTb3VyY2VEZXNjcmlwdGlvbihyZWZlcmVuY2U6IGxvb21Tb3VyY2VSZWZlcmVuY2UsIHJhbmdlOiBTb3VyY2VSYW5nZSB8IG51bGwpOiBzdHJpbmcge1xuICBpZiAocmVmZXJlbmNlLnN5bWJvbE5hbWUpIHtcbiAgICByZXR1cm4gYCR7cmVmZXJlbmNlLmZpbGVQYXRofSMke3JlZmVyZW5jZS5zeW1ib2xOYW1lfWA7XG4gIH1cbiAgaWYgKHJhbmdlKSB7XG4gICAgcmV0dXJuIGAke3JlZmVyZW5jZS5maWxlUGF0aH06TCR7cmFuZ2Uuc3RhcnQgKyAxfS1MJHtyYW5nZS5lbmQgKyAxfWA7XG4gIH1cbiAgcmV0dXJuIHJlZmVyZW5jZS5maWxlUGF0aDtcbn1cblxuY29uc3QgUFlUSE9OX0FTVF9IRUxQRVIgPSBTdHJpbmcucmF3YFxuaW1wb3J0IGFzdFxuaW1wb3J0IGpzb25cbmltcG9ydCBzeXNcblxucGF5bG9hZCA9IGpzb24ubG9hZHMoc3lzLnN0ZGluLnJlYWQoKSlcbnNvdXJjZSA9IHBheWxvYWQuZ2V0KFwic291cmNlXCIsIFwiXCIpXG5tb2RlID0gcGF5bG9hZC5nZXQoXCJtb2RlXCIsIFwibW9kdWxlXCIpXG5cbmRlZiByYW5nZV9zdGFydChub2RlKTpcbiAgICBsaW5lbm8gPSBnZXRhdHRyKG5vZGUsIFwibGluZW5vXCIsIDEpXG4gICAgZGVjb3JhdG9ycyA9IGdldGF0dHIobm9kZSwgXCJkZWNvcmF0b3JfbGlzdFwiLCBOb25lKSBvciBbXVxuICAgIGlmIGRlY29yYXRvcnM6XG4gICAgICAgIGxpbmVubyA9IG1pbihsaW5lbm8sICooZ2V0YXR0cihkZWNvcmF0b3IsIFwibGluZW5vXCIsIGxpbmVubykgZm9yIGRlY29yYXRvciBpbiBkZWNvcmF0b3JzKSlcbiAgICByZXR1cm4gbGluZW5vIC0gMVxuXG5kZWYgcmFuZ2VfZW5kKG5vZGUpOlxuICAgIHJldHVybiBnZXRhdHRyKG5vZGUsIFwiZW5kX2xpbmVub1wiLCBnZXRhdHRyKG5vZGUsIFwibGluZW5vXCIsIDEpKSAtIDFcblxuZGVmIHRhcmdldF9uYW1lcyh0YXJnZXQpOlxuICAgIGlmIGlzaW5zdGFuY2UodGFyZ2V0LCBhc3QuTmFtZSk6XG4gICAgICAgIHJldHVybiBbdGFyZ2V0LmlkXVxuICAgIGlmIGlzaW5zdGFuY2UodGFyZ2V0LCAoYXN0LlR1cGxlLCBhc3QuTGlzdCkpOlxuICAgICAgICBuYW1lcyA9IFtdXG4gICAgICAgIGZvciBpdGVtIGluIHRhcmdldC5lbHRzOlxuICAgICAgICAgICAgbmFtZXMuZXh0ZW5kKHRhcmdldF9uYW1lcyhpdGVtKSlcbiAgICAgICAgcmV0dXJuIG5hbWVzXG4gICAgcmV0dXJuIFtdXG5cbmRlZiBkZWZpbml0aW9uX25hbWVzKG5vZGUpOlxuICAgIGlmIGlzaW5zdGFuY2Uobm9kZSwgKGFzdC5GdW5jdGlvbkRlZiwgYXN0LkFzeW5jRnVuY3Rpb25EZWYsIGFzdC5DbGFzc0RlZikpOlxuICAgICAgICByZXR1cm4gW25vZGUubmFtZV1cbiAgICBpZiBpc2luc3RhbmNlKG5vZGUsIGFzdC5Bc3NpZ24pOlxuICAgICAgICBuYW1lcyA9IFtdXG4gICAgICAgIGZvciB0YXJnZXQgaW4gbm9kZS50YXJnZXRzOlxuICAgICAgICAgICAgbmFtZXMuZXh0ZW5kKHRhcmdldF9uYW1lcyh0YXJnZXQpKVxuICAgICAgICByZXR1cm4gbmFtZXNcbiAgICBpZiBpc2luc3RhbmNlKG5vZGUsIChhc3QuQW5uQXNzaWduLCBhc3QuQXVnQXNzaWduKSk6XG4gICAgICAgIHJldHVybiB0YXJnZXRfbmFtZXMobm9kZS50YXJnZXQpXG4gICAgcmV0dXJuIFtdXG5cbmRlZiBpbnNwZWN0X21vZHVsZSh0cmVlKTpcbiAgICBkZWZpbml0aW9ucyA9IFtdXG4gICAgaW1wb3J0cyA9IFtdXG4gICAgZm9yIG5vZGUgaW4gdHJlZS5ib2R5OlxuICAgICAgICBuYW1lcyA9IGRlZmluaXRpb25fbmFtZXMobm9kZSlcbiAgICAgICAgaWYgbmFtZXM6XG4gICAgICAgICAgICBkZWZpbml0aW9ucy5hcHBlbmQoe1xuICAgICAgICAgICAgICAgIFwibmFtZVwiOiBuYW1lc1swXSxcbiAgICAgICAgICAgICAgICBcIm5hbWVzXCI6IG5hbWVzLFxuICAgICAgICAgICAgICAgIFwic3RhcnRcIjogcmFuZ2Vfc3RhcnQobm9kZSksXG4gICAgICAgICAgICAgICAgXCJlbmRcIjogcmFuZ2VfZW5kKG5vZGUpLFxuICAgICAgICAgICAgfSlcbiAgICAgICAgICAgIGNvbnRpbnVlXG4gICAgICAgIGlmIGlzaW5zdGFuY2Uobm9kZSwgYXN0LkltcG9ydCk6XG4gICAgICAgICAgICBpbXBvcnRzLmFwcGVuZCh7XG4gICAgICAgICAgICAgICAgXCJraW5kXCI6IFwiaW1wb3J0XCIsXG4gICAgICAgICAgICAgICAgXCJtb2R1bGVcIjogXCJcIixcbiAgICAgICAgICAgICAgICBcImxldmVsXCI6IDAsXG4gICAgICAgICAgICAgICAgXCJuYW1lc1wiOiBbe1wibmFtZVwiOiBpdGVtLm5hbWUsIFwiYXNuYW1lXCI6IGl0ZW0uYXNuYW1lfSBmb3IgaXRlbSBpbiBub2RlLm5hbWVzXSxcbiAgICAgICAgICAgICAgICBcInN0YXJ0XCI6IHJhbmdlX3N0YXJ0KG5vZGUpLFxuICAgICAgICAgICAgICAgIFwiZW5kXCI6IHJhbmdlX2VuZChub2RlKSxcbiAgICAgICAgICAgIH0pXG4gICAgICAgICAgICBjb250aW51ZVxuICAgICAgICBpZiBpc2luc3RhbmNlKG5vZGUsIGFzdC5JbXBvcnRGcm9tKTpcbiAgICAgICAgICAgIGltcG9ydHMuYXBwZW5kKHtcbiAgICAgICAgICAgICAgICBcImtpbmRcIjogXCJmcm9tXCIsXG4gICAgICAgICAgICAgICAgXCJtb2R1bGVcIjogbm9kZS5tb2R1bGUgb3IgXCJcIixcbiAgICAgICAgICAgICAgICBcImxldmVsXCI6IG5vZGUubGV2ZWwsXG4gICAgICAgICAgICAgICAgXCJuYW1lc1wiOiBbe1wibmFtZVwiOiBpdGVtLm5hbWUsIFwiYXNuYW1lXCI6IGl0ZW0uYXNuYW1lfSBmb3IgaXRlbSBpbiBub2RlLm5hbWVzXSxcbiAgICAgICAgICAgICAgICBcInN0YXJ0XCI6IHJhbmdlX3N0YXJ0KG5vZGUpLFxuICAgICAgICAgICAgICAgIFwiZW5kXCI6IHJhbmdlX2VuZChub2RlKSxcbiAgICAgICAgICAgIH0pXG4gICAgcmV0dXJuIHtcImRlZmluaXRpb25zXCI6IGRlZmluaXRpb25zLCBcImltcG9ydHNcIjogaW1wb3J0c31cblxuZGVmIGF0dHJpYnV0ZV9jaGFpbihub2RlKTpcbiAgICBjaGFpbiA9IFtdXG4gICAgY3VycmVudCA9IG5vZGVcbiAgICB3aGlsZSBpc2luc3RhbmNlKGN1cnJlbnQsIGFzdC5BdHRyaWJ1dGUpOlxuICAgICAgICBjaGFpbi5hcHBlbmQoY3VycmVudC5hdHRyKVxuICAgICAgICBjdXJyZW50ID0gY3VycmVudC52YWx1ZVxuICAgIGlmIGlzaW5zdGFuY2UoY3VycmVudCwgYXN0Lk5hbWUpOlxuICAgICAgICBjaGFpbi5hcHBlbmQoY3VycmVudC5pZClcbiAgICAgICAgY2hhaW4ucmV2ZXJzZSgpXG4gICAgICAgIHJldHVybiBjaGFpblxuICAgIHJldHVybiBbXVxuXG5jbGFzcyBVc2FnZVZpc2l0b3IoYXN0Lk5vZGVWaXNpdG9yKTpcbiAgICBkZWYgX19pbml0X18oc2VsZik6XG4gICAgICAgIHNlbGYubmFtZXMgPSBzZXQoKVxuICAgICAgICBzZWxmLmF0dHJpYnV0ZXMgPSB7fVxuXG4gICAgZGVmIHZpc2l0X05hbWUoc2VsZiwgbm9kZSk6XG4gICAgICAgIGlmIGlzaW5zdGFuY2Uobm9kZS5jdHgsIGFzdC5Mb2FkKTpcbiAgICAgICAgICAgIHNlbGYubmFtZXMuYWRkKG5vZGUuaWQpXG5cbiAgICBkZWYgdmlzaXRfQXR0cmlidXRlKHNlbGYsIG5vZGUpOlxuICAgICAgICBjaGFpbiA9IGF0dHJpYnV0ZV9jaGFpbihub2RlKVxuICAgICAgICBpZiBsZW4oY2hhaW4pID49IDI6XG4gICAgICAgICAgICBzZWxmLm5hbWVzLmFkZChjaGFpblswXSlcbiAgICAgICAgICAgIHNlbGYuYXR0cmlidXRlcy5zZXRkZWZhdWx0KGNoYWluWzBdLCBzZXQoKSkuYWRkKGNoYWluWzFdKVxuICAgICAgICBzZWxmLmdlbmVyaWNfdmlzaXQobm9kZSlcblxuZGVmIGluc3BlY3RfdXNhZ2UodHJlZSk6XG4gICAgdmlzaXRvciA9IFVzYWdlVmlzaXRvcigpXG4gICAgdmlzaXRvci52aXNpdCh0cmVlKVxuICAgIHJldHVybiB7XG4gICAgICAgIFwibmFtZXNcIjogc29ydGVkKHZpc2l0b3IubmFtZXMpLFxuICAgICAgICBcImF0dHJpYnV0ZXNcIjoge2tleTogc29ydGVkKHZhbHVlKSBmb3Iga2V5LCB2YWx1ZSBpbiB2aXNpdG9yLmF0dHJpYnV0ZXMuaXRlbXMoKX0sXG4gICAgfVxuXG50cnk6XG4gICAgdHJlZSA9IGFzdC5wYXJzZShzb3VyY2UpXG5leGNlcHQgU3ludGF4RXJyb3I6XG4gICAgcHJpbnQoanNvbi5kdW1wcyh7XCJkZWZpbml0aW9uc1wiOiBbXSwgXCJpbXBvcnRzXCI6IFtdfSBpZiBtb2RlID09IFwibW9kdWxlXCIgZWxzZSB7XCJuYW1lc1wiOiBbXSwgXCJhdHRyaWJ1dGVzXCI6IHt9fSkpXG4gICAgcmFpc2UgU3lzdGVtRXhpdCgwKVxuXG5pZiBtb2RlID09IFwibW9kdWxlXCI6XG4gICAgcHJpbnQoanNvbi5kdW1wcyhpbnNwZWN0X21vZHVsZSh0cmVlKSkpXG5lbHNlOlxuICAgIHByaW50KGpzb24uZHVtcHMoaW5zcGVjdF91c2FnZSh0cmVlKSkpXG5gO1xuIiwgImltcG9ydCB0eXBlIHsgbG9vbUNvZGVCbG9jayB9IGZyb20gXCIuL3R5cGVzXCI7XG5cbmV4cG9ydCBmdW5jdGlvbiBidWlsZFNvdXJjZVJlZmVyZW5jZUhhcm5lc3MoYmxvY2s6IGxvb21Db2RlQmxvY2spOiBzdHJpbmcge1xuICBjb25zdCBjYWxsID0gYmxvY2suc291cmNlUmVmZXJlbmNlPy5jYWxsO1xuICBpZiAoIWNhbGwpIHtcbiAgICByZXR1cm4gYmxvY2suY29udGVudDtcbiAgfVxuXG4gIGNvbnN0IHN5bWJvbE5hbWUgPSBibG9jay5zb3VyY2VSZWZlcmVuY2U/LnN5bWJvbE5hbWU/LnRyaW0oKTtcbiAgY29uc3QgaW5wdXQgPSBibG9jay5jb250ZW50LnRyaW0oKTtcbiAgY29uc3QgZXhwcmVzc2lvbiA9IGNhbGwuZXhwcmVzc2lvbj8udHJpbSgpXG4gICAgPyByZW5kZXJTb3VyY2VDYWxsVGVtcGxhdGUoY2FsbC5leHByZXNzaW9uLCBpbnB1dCwgc3ltYm9sTmFtZSlcbiAgICA6IHJlbmRlckRlZmF1bHRTb3VyY2VDYWxsKHN5bWJvbE5hbWUsIGNhbGwuYXJncywgaW5wdXQpO1xuXG4gIHJldHVybiByZW5kZXJMYW5ndWFnZUNhbGxIYXJuZXNzKGJsb2NrLmxhbmd1YWdlLCBleHByZXNzaW9uLCBjYWxsLnByaW50KTtcbn1cblxuZnVuY3Rpb24gcmVuZGVyRGVmYXVsdFNvdXJjZUNhbGwoc3ltYm9sTmFtZTogc3RyaW5nIHwgdW5kZWZpbmVkLCBhcmdzOiBzdHJpbmcgfCB1bmRlZmluZWQsIGlucHV0OiBzdHJpbmcpOiBzdHJpbmcge1xuICBpZiAoIXN5bWJvbE5hbWUpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXCJsb29tLWNhbGwgbmVlZHMgbG9vbS1zeW1ib2wgd2hlbiBubyBjYWxsIGV4cHJlc3Npb24gaXMgcHJvdmlkZWQuXCIpO1xuICB9XG5cbiAgY29uc3QgcmVuZGVyZWRBcmdzID0gcmVuZGVyU291cmNlQ2FsbFRlbXBsYXRlKGFyZ3M/LnRyaW0oKSB8fCBcIntpbnB1dH1cIiwgaW5wdXQsIHN5bWJvbE5hbWUpO1xuICByZXR1cm4gYCR7c3ltYm9sTmFtZX0oJHtyZW5kZXJlZEFyZ3N9KWA7XG59XG5cbmZ1bmN0aW9uIHJlbmRlclNvdXJjZUNhbGxUZW1wbGF0ZSh0ZW1wbGF0ZTogc3RyaW5nLCBpbnB1dDogc3RyaW5nLCBzeW1ib2xOYW1lOiBzdHJpbmcgfCB1bmRlZmluZWQpOiBzdHJpbmcge1xuICByZXR1cm4gdGVtcGxhdGVcbiAgICAucmVwbGFjZUFsbChcIntpbnB1dH1cIiwgaW5wdXQpXG4gICAgLnJlcGxhY2VBbGwoXCJ7c3ltYm9sfVwiLCBzeW1ib2xOYW1lID8/IFwiXCIpO1xufVxuXG5mdW5jdGlvbiByZW5kZXJMYW5ndWFnZUNhbGxIYXJuZXNzKGxhbmd1YWdlOiBzdHJpbmcsIGV4cHJlc3Npb246IHN0cmluZywgcHJpbnQ6IGJvb2xlYW4pOiBzdHJpbmcge1xuICBpZiAoIXByaW50KSB7XG4gICAgcmV0dXJuIHJlbmRlckV4cHJlc3Npb25TdGF0ZW1lbnQobGFuZ3VhZ2UsIGV4cHJlc3Npb24pO1xuICB9XG5cbiAgc3dpdGNoIChsYW5ndWFnZSkge1xuICAgIGNhc2UgXCJweXRob25cIjpcbiAgICAgIHJldHVybiBgcHJpbnQoJHtleHByZXNzaW9ufSlgO1xuICAgIGNhc2UgXCJqYXZhc2NyaXB0XCI6XG4gICAgY2FzZSBcInR5cGVzY3JpcHRcIjpcbiAgICAgIHJldHVybiBgY29uc29sZS5sb2coJHtleHByZXNzaW9ufSk7YDtcbiAgICBjYXNlIFwiY1wiOlxuICAgICAgcmV0dXJuIGAjaW5jbHVkZSA8c3RkaW8uaD5cXG5pbnQgbWFpbih2b2lkKSB7IHByaW50ZihcIiVkXFxcXG5cIiwgJHtleHByZXNzaW9ufSk7IHJldHVybiAwOyB9YDtcbiAgICBjYXNlIFwiY3BwXCI6XG4gICAgICByZXR1cm4gYCNpbmNsdWRlIDxpb3N0cmVhbT5cXG5pbnQgbWFpbigpIHsgc3RkOjpjb3V0IDw8ICgke2V4cHJlc3Npb259KSA8PCBcIlxcXFxuXCI7IHJldHVybiAwOyB9YDtcbiAgICBjYXNlIFwib2NhbWxcIjpcbiAgICAgIHJldHVybiBgbGV0ICgpID0gcHJpbnRfZW5kbGluZSAoJHtleHByZXNzaW9ufSlgO1xuICAgIGRlZmF1bHQ6XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYGxvb20tY2FsbCBjYW5ub3QgZ2VuZXJhdGUgYSBwcmludGVkIGhhcm5lc3MgZm9yICR7bGFuZ3VhZ2V9LiBVc2UgbG9vbS1wcmludD1mYWxzZSBvciB3cml0ZSB0aGUgaGFybmVzcyBpbiB0aGUgYmxvY2sgYm9keS5gKTtcbiAgfVxufVxuXG5mdW5jdGlvbiByZW5kZXJFeHByZXNzaW9uU3RhdGVtZW50KGxhbmd1YWdlOiBzdHJpbmcsIGV4cHJlc3Npb246IHN0cmluZyk6IHN0cmluZyB7XG4gIHN3aXRjaCAobGFuZ3VhZ2UpIHtcbiAgICBjYXNlIFwicHl0aG9uXCI6XG4gICAgY2FzZSBcIm9jYW1sXCI6XG4gICAgICByZXR1cm4gZXhwcmVzc2lvbjtcbiAgICBkZWZhdWx0OlxuICAgICAgcmV0dXJuIGV4cHJlc3Npb24uZW5kc1dpdGgoXCI7XCIpID8gZXhwcmVzc2lvbiA6IGAke2V4cHJlc3Npb259O2A7XG4gIH1cbn1cbiIsICJpbXBvcnQgeyBzZXRJY29uIH0gZnJvbSBcIm9ic2lkaWFuXCI7XG5cbmV4cG9ydCBpbnRlcmZhY2UgbG9vbVRvb2xiYXJIYW5kbGVycyB7XG4gIG9uUnVuOiAoKSA9PiB2b2lkO1xuICBvbkNvcHk6ICgpID0+IHZvaWQ7XG4gIG9uUmVtb3ZlOiAoKSA9PiB2b2lkO1xuICBvblRvZ2dsZU91dHB1dDogKCkgPT4gdm9pZDtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGNyZWF0ZUNvZGVCbG9ja1Rvb2xiYXIoXG4gIGJsb2NrSWQ6IHN0cmluZyxcbiAgaXNSdW5uaW5nOiBib29sZWFuLFxuICBoYW5kbGVyczogbG9vbVRvb2xiYXJIYW5kbGVycyxcbik6IEhUTUxEaXZFbGVtZW50IHtcbiAgY29uc3QgdG9vbGJhciA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJkaXZcIik7XG4gIHRvb2xiYXIuY2xhc3NOYW1lID0gXCJsb29tLWNvZGUtdG9vbGJhclwiO1xuICB0b29sYmFyLmRhdGFzZXQubG9vbUJsb2NrSWQgPSBibG9ja0lkO1xuXG4gIHRvb2xiYXIuYXBwZW5kQ2hpbGQoY3JlYXRlQnV0dG9uKFwiUnVuIGJsb2NrXCIsIGlzUnVubmluZyA/IFwibG9hZGVyLWNpcmNsZVwiIDogXCJwbGF5XCIsIGhhbmRsZXJzLm9uUnVuLCBpc1J1bm5pbmcpKTtcbiAgdG9vbGJhci5hcHBlbmRDaGlsZChjcmVhdGVCdXR0b24oXCJDb3B5IGNvZGVcIiwgXCJjb3B5XCIsIGhhbmRsZXJzLm9uQ29weSwgZmFsc2UpKTtcbiAgdG9vbGJhci5hcHBlbmRDaGlsZChjcmVhdGVCdXR0b24oXCJSZW1vdmUgc25pcHBldFwiLCBcInRyYXNoLTJcIiwgaGFuZGxlcnMub25SZW1vdmUsIGZhbHNlKSk7XG4gIHRvb2xiYXIuYXBwZW5kQ2hpbGQoY3JlYXRlQnV0dG9uKFwiVG9nZ2xlIG91dHB1dFwiLCBcInBhbmVsLWJvdHRvbS1vcGVuXCIsIGhhbmRsZXJzLm9uVG9nZ2xlT3V0cHV0LCBmYWxzZSkpO1xuXG4gIHJldHVybiB0b29sYmFyO1xufVxuXG5mdW5jdGlvbiBjcmVhdGVCdXR0b24obGFiZWw6IHN0cmluZywgaWNvbk5hbWU6IHN0cmluZywgb25DbGljazogKCkgPT4gdm9pZCwgc3Bpbm5pbmc6IGJvb2xlYW4pOiBIVE1MQnV0dG9uRWxlbWVudCB7XG4gIGNvbnN0IGJ1dHRvbiA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJidXR0b25cIik7XG4gIGJ1dHRvbi5jbGFzc05hbWUgPSBgbG9vbS10b29sYmFyLWJ1dHRvbiR7c3Bpbm5pbmcgPyBcIiBpcy1ydW5uaW5nXCIgOiBcIlwifWA7XG4gIGJ1dHRvbi50eXBlID0gXCJidXR0b25cIjtcbiAgYnV0dG9uLnNldEF0dHJpYnV0ZShcImFyaWEtbGFiZWxcIiwgbGFiZWwpO1xuICBidXR0b24uYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsIChldmVudCkgPT4ge1xuICAgIGV2ZW50LnByZXZlbnREZWZhdWx0KCk7XG4gICAgZXZlbnQuc3RvcFByb3BhZ2F0aW9uKCk7XG4gICAgb25DbGljaygpO1xuICB9KTtcbiAgc2V0SWNvbihidXR0b24sIGljb25OYW1lKTtcbiAgcmV0dXJuIGJ1dHRvbjtcbn1cbiIsICJpbXBvcnQgeyBzZXRJY29uIH0gZnJvbSBcIm9ic2lkaWFuXCI7XG5pbXBvcnQgdHlwZSB7IGxvb21TdG9yZWRPdXRwdXQgfSBmcm9tIFwiLi4vdHlwZXNcIjtcblxuZnVuY3Rpb24gZ2V0U3RhdHVzS2luZChvdXRwdXQ6IGxvb21TdG9yZWRPdXRwdXQpOiBcInN1Y2Nlc3NcIiB8IFwid2FybmluZ1wiIHwgXCJmYWlsdXJlXCIge1xuICBpZiAob3V0cHV0LnJlc3VsdC5zdWNjZXNzKSB7XG4gICAgcmV0dXJuIG91dHB1dC5yZXN1bHQuc3RkZXJyLnRyaW0oKSB8fCBvdXRwdXQucmVzdWx0Lndhcm5pbmc/LnRyaW0oKSA/IFwid2FybmluZ1wiIDogXCJzdWNjZXNzXCI7XG4gIH1cblxuICByZXR1cm4gXCJmYWlsdXJlXCI7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBjcmVhdGVPdXRwdXRQYW5lbChvdXRwdXQ6IGxvb21TdG9yZWRPdXRwdXQpOiBIVE1MRGl2RWxlbWVudCB7XG4gIGNvbnN0IHBhbmVsID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcImRpdlwiKTtcbiAgcGFuZWwuY2xhc3NOYW1lID0gYGxvb20tb3V0cHV0LXBhbmVsIGlzLSR7Z2V0U3RhdHVzS2luZChvdXRwdXQpfSR7b3V0cHV0LnZpc2libGUgPyBcIlwiIDogXCIgaXMtaGlkZGVuXCJ9YDtcbiAgcGFuZWwuZGF0YXNldC5sb29tQmxvY2tJZCA9IG91dHB1dC5ibG9ja0lkO1xuICByZW5kZXJPdXRwdXRQYW5lbChwYW5lbCwgb3V0cHV0KTtcbiAgcmV0dXJuIHBhbmVsO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gcmVuZGVyT3V0cHV0UGFuZWwocGFuZWw6IEhUTUxFbGVtZW50LCBvdXRwdXQ6IGxvb21TdG9yZWRPdXRwdXQpOiB2b2lkIHtcbiAgY29uc3Qga2luZCA9IGdldFN0YXR1c0tpbmQob3V0cHV0KTtcbiAgcGFuZWwuY2xhc3NOYW1lID0gYGxvb20tb3V0cHV0LXBhbmVsIGlzLSR7a2luZH0ke291dHB1dC52aXNpYmxlID8gXCJcIiA6IFwiIGlzLWhpZGRlblwifSR7b3V0cHV0LmNvbGxhcHNlZCA/IFwiIGlzLWNvbGxhcHNlZFwiIDogXCJcIn1gO1xuICBwYW5lbC5lbXB0eSgpO1xuXG4gIGNvbnN0IGhlYWRlciA9IHBhbmVsLmNyZWF0ZURpdih7IGNsczogXCJsb29tLW91dHB1dC1oZWFkZXJcIiB9KTtcbiAgY29uc3QgYmFkZ2UgPSBoZWFkZXIuY3JlYXRlRGl2KHsgY2xzOiBcImxvb20tb3V0cHV0LWJhZGdlXCIgfSk7XG4gIHNldEljb24oYmFkZ2UsIGtpbmQgPT09IFwic3VjY2Vzc1wiID8gXCJjaGVjay1jaXJjbGUtMlwiIDoga2luZCA9PT0gXCJ3YXJuaW5nXCIgPyBcImFsZXJ0LXRyaWFuZ2xlXCIgOiBcIngtY2lyY2xlXCIpO1xuXG4gIGNvbnN0IHRpdGxlID0gaGVhZGVyLmNyZWF0ZURpdih7IGNsczogXCJsb29tLW91dHB1dC10aXRsZVwiIH0pO1xuICB0aXRsZS5zZXRUZXh0KGAke291dHB1dC5yZXN1bHQucnVubmVyTmFtZX0gXHUwMEI3IGV4aXQgJHtvdXRwdXQucmVzdWx0LmV4aXRDb2RlID8/IFwiP1wifWApO1xuXG4gIGNvbnN0IG1ldGEgPSBoZWFkZXIuY3JlYXRlRGl2KHsgY2xzOiBcImxvb20tb3V0cHV0LW1ldGFcIiB9KTtcbiAgbWV0YS5zZXRUZXh0KGAke291dHB1dC5yZXN1bHQuZHVyYXRpb25Nc30gbXMgXHUwMEI3ICR7bmV3IERhdGUob3V0cHV0LnJlc3VsdC5maW5pc2hlZEF0KS50b0xvY2FsZVRpbWVTdHJpbmcoKX1gKTtcblxuICBjb25zdCBib2R5ID0gcGFuZWwuY3JlYXRlRGl2KHsgY2xzOiBcImxvb20tb3V0cHV0LWJvZHlcIiB9KTtcbiAgaWYgKG91dHB1dC5yZXN1bHQuc3Rkb3V0LnRyaW0oKSkge1xuICAgIGNyZWF0ZVN0cmVhbShib2R5LCBcIlN0ZG91dFwiLCBvdXRwdXQucmVzdWx0LnN0ZG91dCk7XG4gIH1cbiAgaWYgKG91dHB1dC5yZXN1bHQud2FybmluZz8udHJpbSgpKSB7XG4gICAgY3JlYXRlU3RyZWFtKGJvZHksIFwiV2FybmluZ1wiLCBvdXRwdXQucmVzdWx0Lndhcm5pbmcpO1xuICB9XG4gIGlmIChvdXRwdXQucmVzdWx0LnN0ZGVyci50cmltKCkpIHtcbiAgICBjcmVhdGVTdHJlYW0oYm9keSwgXCJTdGRlcnJcIiwgb3V0cHV0LnJlc3VsdC5zdGRlcnIpO1xuICB9XG4gIGlmIChvdXRwdXQuc291cmNlUHJldmlldz8uY29udGVudC50cmltKCkpIHtcbiAgICBjcmVhdGVTb3VyY2VQcmV2aWV3KGJvZHksIG91dHB1dC5zb3VyY2VQcmV2aWV3KTtcbiAgfVxuICBpZiAoIW91dHB1dC5yZXN1bHQuc3Rkb3V0LnRyaW0oKSAmJiAhb3V0cHV0LnJlc3VsdC53YXJuaW5nPy50cmltKCkgJiYgIW91dHB1dC5yZXN1bHQuc3RkZXJyLnRyaW0oKSAmJiAhb3V0cHV0LnNvdXJjZVByZXZpZXc/LmNvbnRlbnQudHJpbSgpKSB7XG4gICAgY29uc3QgZW1wdHkgPSBib2R5LmNyZWF0ZURpdih7IGNsczogXCJsb29tLW91dHB1dC1lbXB0eVwiIH0pO1xuICAgIGVtcHR5LnNldFRleHQoXCJObyBvdXRwdXRcIik7XG4gIH1cbn1cblxuZnVuY3Rpb24gY3JlYXRlU3RyZWFtKGNvbnRhaW5lcjogSFRNTEVsZW1lbnQsIGxhYmVsOiBzdHJpbmcsIGNvbnRlbnQ6IHN0cmluZyk6IHZvaWQge1xuICBjb25zdCBzZWN0aW9uID0gY29udGFpbmVyLmNyZWF0ZURpdih7IGNsczogXCJsb29tLW91dHB1dC1zdHJlYW1cIiB9KTtcbiAgc2VjdGlvbi5jcmVhdGVEaXYoeyBjbHM6IFwibG9vbS1vdXRwdXQtc3RyZWFtLWxhYmVsXCIsIHRleHQ6IGxhYmVsIH0pO1xuICBzZWN0aW9uLmNyZWF0ZUVsKFwicHJlXCIsIHsgY2xzOiBcImxvb20tb3V0cHV0LXByZVwiLCB0ZXh0OiBjb250ZW50IH0pO1xufVxuXG5mdW5jdGlvbiBjcmVhdGVTb3VyY2VQcmV2aWV3KGNvbnRhaW5lcjogSFRNTEVsZW1lbnQsIHByZXZpZXc6IE5vbk51bGxhYmxlPGxvb21TdG9yZWRPdXRwdXRbXCJzb3VyY2VQcmV2aWV3XCJdPik6IHZvaWQge1xuICBjb25zdCBkZXRhaWxzID0gY29udGFpbmVyLmNyZWF0ZUVsKFwiZGV0YWlsc1wiLCB7IGNsczogXCJsb29tLXNvdXJjZS1wcmV2aWV3XCIgfSk7XG4gIGRldGFpbHMub3BlbiA9IHByZXZpZXcuZXhwYW5kZWQ7XG4gIGNvbnN0IHN1bW1hcnkgPSBkZXRhaWxzLmNyZWF0ZUVsKFwic3VtbWFyeVwiLCB7IGNsczogXCJsb29tLXNvdXJjZS1wcmV2aWV3LXN1bW1hcnlcIiB9KTtcbiAgc3VtbWFyeS5jcmVhdGVTcGFuKHsgdGV4dDogXCJFeHRyYWN0ZWQgc291cmNlXCIgfSk7XG4gIHN1bW1hcnkuY3JlYXRlU3Bhbih7IGNsczogXCJsb29tLXNvdXJjZS1wcmV2aWV3LW1ldGFcIiwgdGV4dDogZm9ybWF0U291cmNlUHJldmlld01ldGEocHJldmlldykgfSk7XG4gIGRldGFpbHMuY3JlYXRlRWwoXCJwcmVcIiwgeyBjbHM6IFwibG9vbS1vdXRwdXQtcHJlIGxvb20tc291cmNlLXByZXZpZXctcHJlXCIsIHRleHQ6IHByZXZpZXcuY29udGVudCB9KTtcbn1cblxuZnVuY3Rpb24gZm9ybWF0U291cmNlUHJldmlld01ldGEocHJldmlldzogTm9uTnVsbGFibGU8bG9vbVN0b3JlZE91dHB1dFtcInNvdXJjZVByZXZpZXdcIl0+KTogc3RyaW5nIHtcbiAgY29uc3QgY2FwYWJpbGl0eSA9IHByZXZpZXcuY2FwYWJpbGl0eTtcbiAgaWYgKCFjYXBhYmlsaXR5IHx8ICFwcmV2aWV3LnNob3dDYXBhYmlsaXR5TWV0YWRhdGEpIHtcbiAgICByZXR1cm4gYCR7cHJldmlldy5sYW5ndWFnZX0gXHUwMEI3ICR7cHJldmlldy5kZXNjcmlwdGlvbn1gO1xuICB9XG4gIHJldHVybiBbXG4gICAgcHJldmlldy5sYW5ndWFnZSxcbiAgICBwcmV2aWV3LmRlc2NyaXB0aW9uLFxuICAgIGBzeW1ib2xzOiR7Y2FwYWJpbGl0eS5zeW1ib2xFeHRyYWN0aW9ufWAsXG4gICAgYGRlcHM6JHtjYXBhYmlsaXR5LmRlcGVuZGVuY3lUcmFjaW5nfWAsXG4gICAgYGNhbGw6JHtjYXBhYmlsaXR5LmNhbGxIYXJuZXNzfWAsXG4gIF0uam9pbihcIiBcdTAwQjcgXCIpO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gY3JlYXRlUnVubmluZ1BhbmVsKCk6IEhUTUxEaXZFbGVtZW50IHtcbiAgY29uc3QgcGFuZWwgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwiZGl2XCIpO1xuICBwYW5lbC5jbGFzc05hbWUgPSBcImxvb20tb3V0cHV0LXBhbmVsIGlzLXJ1bm5pbmdcIjtcblxuICBjb25zdCBoZWFkZXIgPSBwYW5lbC5jcmVhdGVEaXYoeyBjbHM6IFwibG9vbS1vdXRwdXQtaGVhZGVyXCIgfSk7XG4gIGNvbnN0IHNwaW5uZXIgPSBoZWFkZXIuY3JlYXRlRGl2KHsgY2xzOiBcImxvb20tc3Bpbm5lclwiIH0pO1xuICBzZXRJY29uKHNwaW5uZXIsIFwibG9hZGVyLWNpcmNsZVwiKTtcbiAgY29uc3QgdGl0bGUgPSBoZWFkZXIuY3JlYXRlRGl2KHsgY2xzOiBcImxvb20tb3V0cHV0LXRpdGxlXCIgfSk7XG4gIHRpdGxlLnNldFRleHQoXCJSdW5uaW5nXCIpO1xuICBjb25zdCBtZXRhID0gaGVhZGVyLmNyZWF0ZURpdih7IGNsczogXCJsb29tLW91dHB1dC1tZXRhXCIgfSk7XG4gIG1ldGEuc2V0VGV4dChcIkV4ZWN1dGluZy4uLlwiKTtcbiAgc3Bpbm5lci5zZXRBdHRyaWJ1dGUoXCJhcmlhLWhpZGRlblwiLCBcInRydWVcIik7XG5cbiAgcmV0dXJuIHBhbmVsO1xufVxuIl0sCiAgIm1hcHBpbmdzIjogIjs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUEsSUFBQUEsbUJBU087QUFDUCxtQkFBNkM7QUFDN0MsSUFBQUMsZUFBMkU7QUFDM0UsSUFBQUMsZUFBd0I7OztBQ1p4QixzQkFBNkM7QUFDN0MsZ0JBQWdEO0FBQ2hELElBQUFDLG1CQUF3RDtBQUN4RCxJQUFBQyxlQUFpRjtBQUNqRixJQUFBQyx3QkFBc0I7OztBQ0p0QixzQkFBdUM7QUFDdkMsZ0JBQXVCO0FBQ3ZCLGtCQUFxQjtBQUNyQiwyQkFBc0I7QUF3QnRCLGVBQXNCLHdCQUNwQixVQUNBLFFBQ0EsVUFDWTtBQUNaLFFBQU0sVUFBVSxVQUFNLDZCQUFRLHNCQUFLLGtCQUFPLEdBQUcsT0FBTyxDQUFDO0FBQ3JELFFBQU0sZUFBVyxrQkFBSyxTQUFTLFFBQVE7QUFFdkMsTUFBSTtBQUNGLGNBQU0sMkJBQVUsVUFBVSwwQkFBMEIsTUFBTSxHQUFHLE1BQU07QUFDbkUsV0FBTyxNQUFNLFNBQVMsRUFBRSxTQUFTLFNBQVMsQ0FBQztBQUFBLEVBQzdDLFVBQUU7QUFDQSxjQUFNLG9CQUFHLFNBQVMsRUFBRSxXQUFXLE1BQU0sT0FBTyxLQUFLLENBQUM7QUFBQSxFQUNwRDtBQUNGO0FBRUEsZUFBc0IsbUJBQ3BCLGVBQ0EsUUFDQSxVQUNZO0FBQ1osU0FBTyx3QkFBd0IsVUFBVSxhQUFhLElBQUksUUFBUSxRQUFRO0FBQzVFO0FBRUEsU0FBUywwQkFBMEIsUUFBd0I7QUFDekQsUUFBTSxRQUFRLE9BQU8sTUFBTSxJQUFJO0FBQy9CLFFBQU0sZ0JBQWdCLE1BQU0sT0FBTyxDQUFDLFNBQVMsS0FBSyxLQUFLLEVBQUUsU0FBUyxDQUFDO0FBQ25FLE1BQUksQ0FBQyxjQUFjLFFBQVE7QUFDekIsV0FB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QUc7QUFDeEMsVUFBSSxNQUFNLENBQUMsRUFBRSxLQUFLLE1BQU0sYUFBYTtBQUNuQztBQUFBLE1BQ0Y7QUFFQSxlQUFTLElBQUksSUFBSSxHQUFHLElBQUksTUFBTSxRQUFRLEtBQUssR0FBRztBQUM1QyxZQUFJLE1BQU0sQ0FBQyxFQUFFLEtBQUssTUFBTSw0QkFBNEI7QUFDbEQsaUJBQU8sRUFBRSxPQUFPLEdBQUcsS0FBSyxFQUFFO0FBQUEsUUFDNUI7QUFBQSxNQUNGO0FBQUEsSUFDRjtBQUNBLFdBQU87QUFBQSxFQUNUO0FBQ0Y7IiwKICAibmFtZXMiOiBbImltcG9ydF9vYnNpZGlhbiIsICJpbXBvcnRfdmlldyIsICJpbXBvcnRfcGF0aCIsICJpbXBvcnRfcHJvbWlzZXMiLCAiaW1wb3J0X3BhdGgiLCAiaW1wb3J0X2NoaWxkX3Byb2Nlc3MiLCAicG9zaXhQYXRoIiwgIm5vcm1hbGl6ZUZzUGF0aCIsICJnZXRMZWFkaW5nV2hpdGVzcGFjZSIsICJub3JtYWxpemVFeHRlbnNpb24iLCAiaW1wb3J0X3BhdGgiLCAiaW1wb3J0X3BhdGgiLCAiaW1wb3J0X3BhdGgiLCAiaW1wb3J0X2ZzIiwgImltcG9ydF9wYXRoIiwgImltcG9ydF9vYnNpZGlhbiIsICJsb29tUGx1Z2luIiwgImltcG9ydF9jaGlsZF9wcm9jZXNzIiwgImltcG9ydF9wcm9taXNlcyIsICJpbXBvcnRfb3MiLCAiaW1wb3J0X3BhdGgiLCAiaW1wb3J0X29ic2lkaWFuIiwgImltcG9ydF9vYnNpZGlhbiJdCn0K
