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
  return {
    filePath,
    lineStart: lineRange?.start,
    lineEnd: lineRange?.end,
    symbolName,
    traceDependencies: traceValue == null ? true : !["0", "false", "no", "off"].includes(traceValue.toLowerCase())
  };
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
      const resolvedBlock = await this.resolveExecutableBlock(file, block);
      const result = containerGroup ? await this.containerRunner.run(resolvedBlock.block, runContext, this.settings, containerGroup) : await runner.run(resolvedBlock.block, runContext, this.settings);
      if (result.timedOut) {
        result.stderr = result.stderr || `Execution timed out after ${this.settings.defaultTimeoutMs} ms.`;
      } else if (result.cancelled) {
        result.stderr = result.stderr || "Execution cancelled.";
      } else if (!result.success && !result.stderr.trim()) {
        result.stderr = "Process exited unsuccessfully.";
      }
      if (resolvedBlock.sourceDescription) {
        const sourceNotice = `Ran extracted source from ${resolvedBlock.sourceDescription}.`;
        result.warning = result.warning ? `${sourceNotice}
${result.warning}` : sourceNotice;
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
    const resolved = await resolveReferencedSource(
      await this.app.vault.cachedRead(sourceFile),
      { ...block.sourceReference, filePath: referencePath },
      block.language,
      block.content,
      {
        pythonExecutable: this.settings.pythonExecutable.trim() || "python3",
        externalExtractor: this.getCustomLanguageExtractor(block.language, file),
        readFile: async (filePath) => {
          const importedFile = this.app.vault.getAbstractFileByPath((0, import_obsidian5.normalizePath)(filePath));
          return importedFile instanceof import_obsidian5.TFile ? this.app.vault.cachedRead(importedFile) : null;
        },
        resolvePythonImport: async (fromFilePath, moduleName, level) => this.resolvePythonImportVaultPath(fromFilePath, moduleName, level)
      }
    );
    return {
      block: {
        ...block,
        content: resolved.content
      },
      sourceDescription: resolved.description
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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsic3JjL21haW4udHMiLCAic3JjL2V4ZWN1dGlvbi9jb250YWluZXJSdW5uZXIudHMiLCAic3JjL2V4ZWN1dGlvbi9wcm9jZXNzUnVubmVyLnRzIiwgInNyYy91dGlscy9jb21tYW5kLnRzIiwgInNyYy9sbHZtSGlnaGxpZ2h0LnRzIiwgInNyYy91dGlscy9oYXNoLnRzIiwgInNyYy9wYXJzZXIudHMiLCAic3JjL3J1bm5lcnMvbm9kZS50cyIsICJzcmMvcnVubmVycy9jdXN0b20udHMiLCAic3JjL3J1bm5lcnMvaW50ZXJwcmV0ZWQudHMiLCAic3JjL3J1bm5lcnMvbGx2bS50cyIsICJzcmMvcnVubmVycy9tYW5hZ2VkQ29tcGlsZWQudHMiLCAic3JjL3J1bm5lcnMvbmF0aXZlQ29tcGlsZWQudHMiLCAic3JjL3J1bm5lcnMvb2NhbWwudHMiLCAic3JjL3J1bm5lcnMvcHl0aG9uLnRzIiwgInNyYy9ydW5uZXJzL3Byb29mLnRzIiwgInNyYy9ydW5uZXJzL3JlZ2lzdHJ5LnRzIiwgInNyYy9zZXR0aW5ncy50cyIsICJzcmMvc291cmNlRXh0cmFjdC50cyIsICJzcmMvdWkvY29kZUJsb2NrVG9vbGJhci50cyIsICJzcmMvdWkvb3V0cHV0UGFuZWwudHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImltcG9ydCB7XG4gIE1hcmtkb3duUmVuZGVyQ2hpbGQsXG4gIE1hcmtkb3duVmlldyxcbiAgTW9kYWwsXG4gIE5vdGljZSxcbiAgUGx1Z2luLFxuICBURmlsZSxcbiAgV29ya3NwYWNlTGVhZixcbiAgbm9ybWFsaXplUGF0aCxcbn0gZnJvbSBcIm9ic2lkaWFuXCI7XG5pbXBvcnQgeyBSYW5nZVNldEJ1aWxkZXIsIFN0YXRlRWZmZWN0IH0gZnJvbSBcIkBjb2RlbWlycm9yL3N0YXRlXCI7XG5pbXBvcnQgeyBEZWNvcmF0aW9uLCBFZGl0b3JWaWV3LCBWaWV3UGx1Z2luLCBWaWV3VXBkYXRlLCBXaWRnZXRUeXBlIH0gZnJvbSBcIkBjb2RlbWlycm9yL3ZpZXdcIjtcbmltcG9ydCB7IGRpcm5hbWUgfSBmcm9tIFwicGF0aFwiO1xuaW1wb3J0IHsgbG9vbUNvbnRhaW5lclJ1bm5lciB9IGZyb20gXCIuL2V4ZWN1dGlvbi9jb250YWluZXJSdW5uZXJcIjtcbmltcG9ydCB7IGFkZExsdm1EZWNvcmF0aW9ucywgaGlnaGxpZ2h0TGx2bUVsZW1lbnQgfSBmcm9tIFwiLi9sbHZtSGlnaGxpZ2h0XCI7XG5pbXBvcnQgeyBmaW5kQmxvY2tBdExpbmUsIGdldFN1cHBvcnRlZExhbmd1YWdlQWxpYXNlcywgcGFyc2VNYXJrZG93bkNvZGVCbG9ja3MgfSBmcm9tIFwiLi9wYXJzZXJcIjtcbmltcG9ydCB7IE5vZGVSdW5uZXIgfSBmcm9tIFwiLi9ydW5uZXJzL25vZGVcIjtcbmltcG9ydCB7IEN1c3RvbUxhbmd1YWdlUnVubmVyIH0gZnJvbSBcIi4vcnVubmVycy9jdXN0b21cIjtcbmltcG9ydCB7IEludGVycHJldGVkUnVubmVyIH0gZnJvbSBcIi4vcnVubmVycy9pbnRlcnByZXRlZFwiO1xuaW1wb3J0IHsgTGx2bVJ1bm5lciB9IGZyb20gXCIuL3J1bm5lcnMvbGx2bVwiO1xuaW1wb3J0IHsgTWFuYWdlZENvbXBpbGVkUnVubmVyIH0gZnJvbSBcIi4vcnVubmVycy9tYW5hZ2VkQ29tcGlsZWRcIjtcbmltcG9ydCB7IE5hdGl2ZUNvbXBpbGVkUnVubmVyIH0gZnJvbSBcIi4vcnVubmVycy9uYXRpdmVDb21waWxlZFwiO1xuaW1wb3J0IHsgT2NhbWxSdW5uZXIgfSBmcm9tIFwiLi9ydW5uZXJzL29jYW1sXCI7XG5pbXBvcnQgeyBQeXRob25SdW5uZXIgfSBmcm9tIFwiLi9ydW5uZXJzL3B5dGhvblwiO1xuaW1wb3J0IHsgUHJvb2ZSdW5uZXIgfSBmcm9tIFwiLi9ydW5uZXJzL3Byb29mXCI7XG5pbXBvcnQgeyBsb29tUnVubmVyUmVnaXN0cnkgfSBmcm9tIFwiLi9ydW5uZXJzL3JlZ2lzdHJ5XCI7XG5pbXBvcnQgeyBERUZBVUxUX1NFVFRJTkdTLCBsb29tU2V0dGluZ1RhYiwgc2hvd0V4ZWN1dGlvbkRpc2FibGVkTm90aWNlIH0gZnJvbSBcIi4vc2V0dGluZ3NcIjtcbmltcG9ydCB7IHJlc29sdmVSZWZlcmVuY2VkU291cmNlIH0gZnJvbSBcIi4vc291cmNlRXh0cmFjdFwiO1xuaW1wb3J0IHsgY3JlYXRlQ29kZUJsb2NrVG9vbGJhciB9IGZyb20gXCIuL3VpL2NvZGVCbG9ja1Rvb2xiYXJcIjtcbmltcG9ydCB7IGNyZWF0ZU91dHB1dFBhbmVsLCBjcmVhdGVSdW5uaW5nUGFuZWwgfSBmcm9tIFwiLi91aS9vdXRwdXRQYW5lbFwiO1xuaW1wb3J0IHsgc3BsaXRDb21tYW5kTGluZSB9IGZyb20gXCIuL3V0aWxzL2NvbW1hbmRcIjtcbmltcG9ydCB0eXBlIHsgbG9vbUNvZGVCbG9jaywgbG9vbVBsdWdpblNldHRpbmdzLCBsb29tU3RvcmVkT3V0cHV0IH0gZnJvbSBcIi4vdHlwZXNcIjtcblxuY29uc3QgbG9vbVJlZnJlc2hFZmZlY3QgPSBTdGF0ZUVmZmVjdC5kZWZpbmU8dm9pZD4oKTtcblxuY2xhc3MgRXhlY3V0aW9uQ29uc2VudE1vZGFsIGV4dGVuZHMgTW9kYWwge1xuICBjb25zdHJ1Y3RvcihcbiAgICBhcHA6IFBsdWdpbltcImFwcFwiXSxcbiAgICBwcml2YXRlIHJlYWRvbmx5IG9uQ29uZmlybTogKCkgPT4gUHJvbWlzZTx2b2lkPixcbiAgKSB7XG4gICAgc3VwZXIoYXBwKTtcbiAgfVxuXG4gIG9uT3BlbigpOiB2b2lkIHtcbiAgICBjb25zdCB7IGNvbnRlbnRFbCB9ID0gdGhpcztcbiAgICBjb250ZW50RWwuZW1wdHkoKTtcbiAgICBjb250ZW50RWwuY3JlYXRlRWwoXCJoMlwiLCB7IHRleHQ6IFwiRW5hYmxlIGxvb20gbG9jYWwgZXhlY3V0aW9uP1wiIH0pO1xuICAgIGNvbnRlbnRFbC5jcmVhdGVFbChcInBcIiwge1xuICAgICAgdGV4dDogXCJsb29tIHJ1bnMgY29kZSBmcm9tIHlvdXIgbm90ZXMgb24geW91ciBsb2NhbCBtYWNoaW5lIHVzaW5nIHRoZSBjb25maWd1cmVkIGV4ZWN1dGFibGVzLiBJdCBkb2VzIG5vdCBzYW5kYm94IG9yIGlzb2xhdGUgdGhlIHByb2Nlc3MuXCIsXG4gICAgfSk7XG5cbiAgICBjb25zdCBhY3Rpb25zID0gY29udGVudEVsLmNyZWF0ZURpdih7IGNsczogXCJsb29tLW1vZGFsLWFjdGlvbnNcIiB9KTtcbiAgICBjb25zdCBjYW5jZWxCdXR0b24gPSBhY3Rpb25zLmNyZWF0ZUVsKFwiYnV0dG9uXCIsIHsgdGV4dDogXCJDYW5jZWxcIiB9KTtcbiAgICBjb25zdCBlbmFibGVCdXR0b24gPSBhY3Rpb25zLmNyZWF0ZUVsKFwiYnV0dG9uXCIsIHsgdGV4dDogXCJFbmFibGUgYW5kIHJ1blwiLCBjbHM6IFwibW9kLWN0YVwiIH0pO1xuXG4gICAgY2FuY2VsQnV0dG9uLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoKSA9PiB0aGlzLmNsb3NlKCkpO1xuICAgIGVuYWJsZUJ1dHRvbi5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgYXN5bmMgKCkgPT4ge1xuICAgICAgYXdhaXQgdGhpcy5vbkNvbmZpcm0oKTtcbiAgICAgIHRoaXMuY2xvc2UoKTtcbiAgICB9KTtcbiAgfVxufVxuXG5jbGFzcyBsb29tVG9vbGJhclJlbmRlckNoaWxkIGV4dGVuZHMgTWFya2Rvd25SZW5kZXJDaGlsZCB7XG4gIHByaXZhdGUgcGFuZWxDb250YWluZXI6IEhUTUxEaXZFbGVtZW50IHwgbnVsbCA9IG51bGw7XG4gIHByaXZhdGUgdW5yZWdpc3Rlck91dHB1dExpc3RlbmVyOiAoKCkgPT4gdm9pZCkgfCBudWxsID0gbnVsbDtcblxuICBjb25zdHJ1Y3RvcihcbiAgICBjb250YWluZXJFbDogSFRNTEVsZW1lbnQsXG4gICAgcHJpdmF0ZSByZWFkb25seSBwbHVnaW46IGxvb21QbHVnaW4sXG4gICAgcHJpdmF0ZSByZWFkb25seSBibG9jazogbG9vbUNvZGVCbG9jayxcbiAgICBwcml2YXRlIHJlYWRvbmx5IGNvZGVFbGVtZW50OiBIVE1MRWxlbWVudCxcbiAgKSB7XG4gICAgc3VwZXIoY29udGFpbmVyRWwpO1xuICB9XG5cbiAgb25sb2FkKCk6IHZvaWQge1xuICAgIHRoaXMuY29kZUVsZW1lbnQucGFyZW50RWxlbWVudD8uYWRkQ2xhc3MoXCJsb29tLWNvZGVibG9jay1zaGVsbFwiKTtcbiAgICB0aGlzLmNvZGVFbGVtZW50LnBhcmVudEVsZW1lbnQ/LmFwcGVuZENoaWxkKHRoaXMucGx1Z2luLmNyZWF0ZVRvb2xiYXJFbGVtZW50KHRoaXMuYmxvY2spKTtcblxuICAgIGlmICh0aGlzLnBsdWdpbi5zZXR0aW5ncy5wZGZFeHBvcnRNb2RlID09PSBcIm91dHB1dFwiKSB7XG4gICAgICB0aGlzLmNvZGVFbGVtZW50LmNsYXNzTGlzdC5hZGQoXCJsb29tLXByaW50LWhpZGUtY29kZVwiKTtcbiAgICB9XG5cbiAgICBjb25zdCBob3N0Q2xhc3NlcyA9IFtcImxvb20taW5saW5lLW91dHB1dC1ob3N0XCJdO1xuICAgIGlmICh0aGlzLnBsdWdpbi5zZXR0aW5ncy5wZGZFeHBvcnRNb2RlID09PSBcImNvZGVcIikge1xuICAgICAgaG9zdENsYXNzZXMucHVzaChcImxvb20tcHJpbnQtaGlkZS1vdXRwdXRcIik7XG4gICAgfVxuICAgIHRoaXMucGFuZWxDb250YWluZXIgPSB0aGlzLmNvbnRhaW5lckVsLmNyZWF0ZURpdih7IGNsczogaG9zdENsYXNzZXMuam9pbihcIiBcIikgfSk7XG5cbiAgICB0aGlzLnBsdWdpbi5yZW5kZXJPdXRwdXRJbnRvKHRoaXMuYmxvY2suaWQsIHRoaXMucGFuZWxDb250YWluZXIpO1xuICAgIHRoaXMudW5yZWdpc3Rlck91dHB1dExpc3RlbmVyID0gdGhpcy5wbHVnaW4ucmVnaXN0ZXJPdXRwdXRMaXN0ZW5lcih0aGlzLmJsb2NrLmlkLCAoKSA9PiB7XG4gICAgICBpZiAodGhpcy5wYW5lbENvbnRhaW5lcikge1xuICAgICAgICB0aGlzLnBsdWdpbi5yZW5kZXJPdXRwdXRJbnRvKHRoaXMuYmxvY2suaWQsIHRoaXMucGFuZWxDb250YWluZXIpO1xuICAgICAgfVxuICAgIH0pO1xuICB9XG5cbiAgb251bmxvYWQoKTogdm9pZCB7XG4gICAgdGhpcy51bnJlZ2lzdGVyT3V0cHV0TGlzdGVuZXI/LigpO1xuICB9XG59XG5cbmNsYXNzIGxvb21Ub29sYmFyV2lkZ2V0IGV4dGVuZHMgV2lkZ2V0VHlwZSB7XG4gIHByaXZhdGUgcmVhZG9ubHkgaXNSdW5uaW5nOiBib29sZWFuO1xuXG4gIGNvbnN0cnVjdG9yKFxuICAgIHByaXZhdGUgcmVhZG9ubHkgcGx1Z2luOiBsb29tUGx1Z2luLFxuICAgIHByaXZhdGUgcmVhZG9ubHkgYmxvY2s6IGxvb21Db2RlQmxvY2ssXG4gICkge1xuICAgIHN1cGVyKCk7XG4gICAgdGhpcy5pc1J1bm5pbmcgPSBwbHVnaW4uaXNCbG9ja1J1bm5pbmcoYmxvY2suaWQpO1xuICB9XG5cbiAgZXEob3RoZXI6IGxvb21Ub29sYmFyV2lkZ2V0KTogYm9vbGVhbiB7XG4gICAgcmV0dXJuIG90aGVyLmJsb2NrLmlkID09PSB0aGlzLmJsb2NrLmlkICYmIG90aGVyLmlzUnVubmluZyA9PT0gdGhpcy5pc1J1bm5pbmc7XG4gIH1cblxuICB0b0RPTSgpOiBIVE1MRWxlbWVudCB7XG4gICAgcmV0dXJuIHRoaXMucGx1Z2luLmNyZWF0ZVRvb2xiYXJFbGVtZW50KHRoaXMuYmxvY2spO1xuICB9XG59XG5cbmNsYXNzIGxvb21PdXRwdXRXaWRnZXQgZXh0ZW5kcyBXaWRnZXRUeXBlIHtcbiAgY29uc3RydWN0b3IoXG4gICAgcHJpdmF0ZSByZWFkb25seSBwbHVnaW46IGxvb21QbHVnaW4sXG4gICAgcHJpdmF0ZSByZWFkb25seSBibG9ja0lkOiBzdHJpbmcsXG4gICkge1xuICAgIHN1cGVyKCk7XG4gIH1cblxuICBlcShvdGhlcjogbG9vbU91dHB1dFdpZGdldCk6IGJvb2xlYW4ge1xuICAgIHJldHVybiBmYWxzZTtcbiAgfVxuXG4gIHRvRE9NKCk6IEhUTUxFbGVtZW50IHtcbiAgICBjb25zdCB3cmFwcGVyID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcImRpdlwiKTtcbiAgICB3cmFwcGVyLmNsYXNzTmFtZSA9IFwibG9vbS1pbmxpbmUtb3V0cHV0LWhvc3RcIjtcbiAgICB0aGlzLnBsdWdpbi5yZW5kZXJPdXRwdXRJbnRvKHRoaXMuYmxvY2tJZCwgd3JhcHBlcik7XG4gICAgcmV0dXJuIHdyYXBwZXI7XG4gIH1cbn1cblxuZXhwb3J0IGRlZmF1bHQgY2xhc3MgbG9vbVBsdWdpbiBleHRlbmRzIFBsdWdpbiB7XG4gIHNldHRpbmdzOiBsb29tUGx1Z2luU2V0dGluZ3MgPSBERUZBVUxUX1NFVFRJTkdTO1xuICByZWFkb25seSByZWdpc3RyeSA9IG5ldyBsb29tUnVubmVyUmVnaXN0cnkoW1xuICAgIG5ldyBQeXRob25SdW5uZXIoKSxcbiAgICBuZXcgTm9kZVJ1bm5lcigpLFxuICAgIG5ldyBPY2FtbFJ1bm5lcigpLFxuICAgIG5ldyBOYXRpdmVDb21waWxlZFJ1bm5lcigpLFxuICAgIG5ldyBJbnRlcnByZXRlZFJ1bm5lcigpLFxuICAgIG5ldyBNYW5hZ2VkQ29tcGlsZWRSdW5uZXIoKSxcbiAgICBuZXcgTGx2bVJ1bm5lcigpLFxuICAgIG5ldyBQcm9vZlJ1bm5lcigpLFxuICAgIG5ldyBDdXN0b21MYW5ndWFnZVJ1bm5lcigpLFxuICBdKTtcbiAgLy8gRXhwb3NlZCBhcyBwdWJsaWMgYW5kIHJlYWRvbmx5IHNvIHRoZSBzZXR0aW5ncyBwYW5lbCBhbmQgbW9kYWxzIGNhbiBhY2Nlc3MgY29udGFpbmVyIGNvbmZpZ3VyYXRpb25zIGFuZCBkZWZhdWx0IGxhbmd1YWdlIG1hcHBpbmcgaGVscGVycy5cbiAgcHVibGljIHJlYWRvbmx5IGNvbnRhaW5lclJ1bm5lciA9IG5ldyBsb29tQ29udGFpbmVyUnVubmVyKHRoaXMuYXBwLCB0aGlzLm1hbmlmZXN0LmRpciA/PyBcIi5vYnNpZGlhbi9wbHVnaW5zL2xvb21cIik7XG4gIHByaXZhdGUgcmVhZG9ubHkgcmVnaXN0ZXJlZENvZGVCbG9ja0FsaWFzZXMgPSBuZXcgU2V0PHN0cmluZz4oKTtcbiAgcHJpdmF0ZSByZWFkb25seSBvdXRwdXRzID0gbmV3IE1hcDxzdHJpbmcsIGxvb21TdG9yZWRPdXRwdXQ+KCk7XG4gIHByaXZhdGUgcmVhZG9ubHkgcnVubmluZyA9IG5ldyBNYXA8c3RyaW5nLCBBYm9ydENvbnRyb2xsZXI+KCk7XG4gIHByaXZhdGUgcmVhZG9ubHkgb3V0cHV0TGlzdGVuZXJzID0gbmV3IE1hcDxzdHJpbmcsIFNldDwoKSA9PiB2b2lkPj4oKTtcbiAgcHJpdmF0ZSBzdGF0dXNCYXJJdGVtRWwhOiBIVE1MRWxlbWVudDtcbiAgcHJpdmF0ZSBlZGl0b3JWaWV3cyA9IG5ldyBTZXQ8RWRpdG9yVmlldz4oKTtcbiAgcHJpdmF0ZSBsYXN0TWFya2Rvd25GaWxlUGF0aDogc3RyaW5nIHwgbnVsbCA9IG51bGw7XG5cbiAgYXN5bmMgb25sb2FkKCk6IFByb21pc2U8dm9pZD4ge1xuICAgIGF3YWl0IHRoaXMubG9hZFNldHRpbmdzKCk7XG4gICAgdGhpcy5hZGRTZXR0aW5nVGFiKG5ldyBsb29tU2V0dGluZ1RhYih0aGlzKSk7XG4gICAgdGhpcy5zdGF0dXNCYXJJdGVtRWwgPSB0aGlzLmFkZFN0YXR1c0Jhckl0ZW0oKTtcbiAgICB0aGlzLnVwZGF0ZVN0YXR1c0JhcigpO1xuICAgIHRoaXMuYXBwLndvcmtzcGFjZS5vbkxheW91dFJlYWR5KCgpID0+IHtcbiAgICAgIHRoaXMubGFzdE1hcmtkb3duRmlsZVBhdGggPSB0aGlzLmdldEFjdGl2ZU1hcmtkb3duRmlsZSgpPy5wYXRoID8/IHRoaXMubGFzdE1hcmtkb3duRmlsZVBhdGg7XG4gICAgICB2b2lkIHRoaXMuZW5mb3JjZVNvdXJjZU1vZGVGb3JBY3RpdmVWaWV3KCk7XG4gICAgfSk7XG5cbiAgICB0aGlzLmFkZENvbW1hbmQoe1xuICAgICAgaWQ6IFwibG9vbS1ydW4tY3VycmVudC1jb2RlLWJsb2NrXCIsXG4gICAgICBuYW1lOiBcImxvb206IFJ1biBDdXJyZW50IENvZGUgQmxvY2tcIixcbiAgICAgIGVkaXRvckNhbGxiYWNrOiBhc3luYyAoZWRpdG9yLCB2aWV3KSA9PiB7XG4gICAgICAgIGNvbnN0IGZpbGUgPSB2aWV3LmZpbGU7XG4gICAgICAgIGlmICghZmlsZSkge1xuICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IGJsb2NrcyA9IHBhcnNlTWFya2Rvd25Db2RlQmxvY2tzKGZpbGUucGF0aCwgZWRpdG9yLmdldFZhbHVlKCksIHRoaXMuc2V0dGluZ3MpO1xuICAgICAgICBjb25zdCBibG9jayA9IGZpbmRCbG9ja0F0TGluZShibG9ja3MsIGVkaXRvci5nZXRDdXJzb3IoKS5saW5lKTtcbiAgICAgICAgaWYgKCFibG9jaykge1xuICAgICAgICAgIG5ldyBOb3RpY2UoXCJObyBzdXBwb3J0ZWQgbG9vbSBibG9jayBhdCB0aGUgY3VycmVudCBjdXJzb3IuXCIpO1xuICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICBhd2FpdCB0aGlzLnJ1bkJsb2NrKGZpbGUsIGJsb2NrKTtcbiAgICAgIH0sXG4gICAgfSk7XG5cbiAgICB0aGlzLmFkZENvbW1hbmQoe1xuICAgICAgaWQ6IFwibG9vbS1ydW4tYWxsLWNvZGUtYmxvY2tzXCIsXG4gICAgICBuYW1lOiBcImxvb206IFJ1biBBbGwgU3VwcG9ydGVkIENvZGUgQmxvY2tzIGluIEN1cnJlbnQgTm90ZVwiLFxuICAgICAgY2hlY2tDYWxsYmFjazogKGNoZWNraW5nKSA9PiB7XG4gICAgICAgIGNvbnN0IGZpbGUgPSB0aGlzLmdldEFjdGl2ZU1hcmtkb3duRmlsZSgpO1xuICAgICAgICBpZiAoIWZpbGUpIHtcbiAgICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKCFjaGVja2luZykge1xuICAgICAgICAgIHZvaWQgdGhpcy5ydW5BbGxCbG9ja3NJbkZpbGUoZmlsZSk7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgICB9LFxuICAgIH0pO1xuXG4gICAgdGhpcy5hZGRDb21tYW5kKHtcbiAgICAgIGlkOiBcImxvb20tY2xlYXItbm90ZS1vdXRwdXRzXCIsXG4gICAgICBuYW1lOiBcImxvb206IENsZWFyIGxvb20gT3V0cHV0cyBpbiBDdXJyZW50IE5vdGVcIixcbiAgICAgIGNoZWNrQ2FsbGJhY2s6IChjaGVja2luZykgPT4ge1xuICAgICAgICBjb25zdCBmaWxlID0gdGhpcy5nZXRBY3RpdmVNYXJrZG93bkZpbGUoKTtcbiAgICAgICAgaWYgKCFmaWxlKSB7XG4gICAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgICB9XG4gICAgICAgIGlmICghY2hlY2tpbmcpIHtcbiAgICAgICAgICB2b2lkIHRoaXMuY2xlYXJPdXRwdXRzRm9yRmlsZShmaWxlKTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICAgIH0sXG4gICAgfSk7XG5cbiAgICB0aGlzLnJlZ2lzdGVyQ29kZUJsb2NrUHJvY2Vzc29ycygpO1xuXG4gICAgdGhpcy5yZWdpc3RlckVkaXRvckV4dGVuc2lvbih0aGlzLmNyZWF0ZUxpdmVQcmV2aWV3RXh0ZW5zaW9uKCkpO1xuXG4gICAgdGhpcy5yZWdpc3RlckV2ZW50KFxuICAgICAgdGhpcy5hcHAud29ya3NwYWNlLm9uKFwiZmlsZS1vcGVuXCIsIChmaWxlKSA9PiB7XG4gICAgICAgIHRoaXMubGFzdE1hcmtkb3duRmlsZVBhdGggPSBmaWxlPy5wYXRoID8/IHRoaXMubGFzdE1hcmtkb3duRmlsZVBhdGg7XG4gICAgICAgIHRoaXMucmVmcmVzaEFsbFZpZXdzKCk7XG4gICAgICAgIHZvaWQgdGhpcy5lbmZvcmNlU291cmNlTW9kZUZvckFjdGl2ZVZpZXcoKTtcbiAgICAgICAgaWYgKGZpbGUgJiYgdGhpcy5zZXR0aW5ncy5hdXRvUnVuT25GaWxlT3Blbikge1xuICAgICAgICAgIHZvaWQgdGhpcy5ydW5BbGxCbG9ja3NJbkZpbGUoZmlsZSk7XG4gICAgICAgIH1cbiAgICAgIH0pLFxuICAgICk7XG5cbiAgICB0aGlzLmFkZENvbW1hbmQoe1xuICAgICAgaWQ6IFwibG9vbS12YWxpZGF0ZS1jb250YWluZXItZ3JvdXBzXCIsXG4gICAgICBuYW1lOiBcImxvb206IFZhbGlkYXRlIENvbnRhaW5lciBHcm91cHNcIixcbiAgICAgIGNhbGxiYWNrOiBhc3luYyAoKSA9PiB7XG4gICAgICAgIGNvbnN0IGdyb3VwcyA9IGF3YWl0IHRoaXMuZ2V0Q29udGFpbmVyR3JvdXBTdW1tYXJpZXMoKTtcbiAgICAgICAgbmV3IE5vdGljZShncm91cHMubGVuZ3RoID8gZ3JvdXBzLm1hcCgoZ3JvdXApID0+IGAke2dyb3VwLm5hbWV9OiAke2dyb3VwLnN0YXR1c31gKS5qb2luKFwiXFxuXCIpIDogXCJObyBsb29tIGNvbnRhaW5lciBncm91cHMgZm91bmQuXCIsIDgwMDApO1xuICAgICAgfSxcbiAgICB9KTtcblxuICAgIHRoaXMucmVnaXN0ZXJFdmVudChcbiAgICAgIHRoaXMuYXBwLndvcmtzcGFjZS5vbihcImFjdGl2ZS1sZWFmLWNoYW5nZVwiLCAoKSA9PiB7XG4gICAgICAgIHRoaXMubGFzdE1hcmtkb3duRmlsZVBhdGggPSB0aGlzLmdldEFjdGl2ZU1hcmtkb3duRmlsZSgpPy5wYXRoID8/IHRoaXMubGFzdE1hcmtkb3duRmlsZVBhdGg7XG4gICAgICAgIHZvaWQgdGhpcy5lbmZvcmNlU291cmNlTW9kZUZvckFjdGl2ZVZpZXcoKTtcbiAgICAgIH0pLFxuICAgICk7XG5cbiAgICB0aGlzLnJlZ2lzdGVyRXZlbnQoXG4gICAgICB0aGlzLmFwcC53b3Jrc3BhY2Uub24oXCJlZGl0b3ItY2hhbmdlXCIsIChfZWRpdG9yLCBjdHgpID0+IHtcbiAgICAgICAgaWYgKGN0eCBpbnN0YW5jZW9mIE1hcmtkb3duVmlldykge1xuICAgICAgICAgIHZvaWQgdGhpcy5lbmZvcmNlU291cmNlTW9kZUZvckxlYWYoY3R4LmxlYWYpO1xuICAgICAgICB9XG4gICAgICB9KSxcbiAgICApO1xuICB9XG5cbiAgb251bmxvYWQoKTogdm9pZCB7XG4gICAgZm9yIChjb25zdCBjb250cm9sbGVyIG9mIHRoaXMucnVubmluZy52YWx1ZXMoKSkge1xuICAgICAgY29udHJvbGxlci5hYm9ydCgpO1xuICAgIH1cbiAgfVxuXG4gIGFzeW5jIGxvYWRTZXR0aW5ncygpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICB0aGlzLnNldHRpbmdzID0ge1xuICAgICAgLi4uREVGQVVMVF9TRVRUSU5HUyxcbiAgICAgIC4uLihhd2FpdCB0aGlzLmxvYWREYXRhKCkpLFxuICAgIH07XG4gIH1cblxuICBhc3luYyBzYXZlU2V0dGluZ3MoKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgYXdhaXQgdGhpcy5zYXZlRGF0YSh0aGlzLnNldHRpbmdzKTtcbiAgICB0aGlzLnJlZ2lzdGVyQ29kZUJsb2NrUHJvY2Vzc29ycygpO1xuICAgIHRoaXMucmVmcmVzaEFsbFZpZXdzKCk7XG4gIH1cblxuICBpc0Jsb2NrUnVubmluZyhibG9ja0lkOiBzdHJpbmcpOiBib29sZWFuIHtcbiAgICByZXR1cm4gdGhpcy5ydW5uaW5nLmhhcyhibG9ja0lkKTtcbiAgfVxuXG4gIHJlZ2lzdGVyT3V0cHV0TGlzdGVuZXIoYmxvY2tJZDogc3RyaW5nLCBsaXN0ZW5lcjogKCkgPT4gdm9pZCk6ICgpID0+IHZvaWQge1xuICAgIGlmICghdGhpcy5vdXRwdXRMaXN0ZW5lcnMuaGFzKGJsb2NrSWQpKSB7XG4gICAgICB0aGlzLm91dHB1dExpc3RlbmVycy5zZXQoYmxvY2tJZCwgbmV3IFNldCgpKTtcbiAgICB9XG4gICAgdGhpcy5vdXRwdXRMaXN0ZW5lcnMuZ2V0KGJsb2NrSWQpPy5hZGQobGlzdGVuZXIpO1xuICAgIHJldHVybiAoKSA9PiB7XG4gICAgICB0aGlzLm91dHB1dExpc3RlbmVycy5nZXQoYmxvY2tJZCk/LmRlbGV0ZShsaXN0ZW5lcik7XG4gICAgfTtcbiAgfVxuXG4gIGNyZWF0ZVRvb2xiYXJFbGVtZW50KGJsb2NrOiBsb29tQ29kZUJsb2NrKTogSFRNTEVsZW1lbnQge1xuICAgIHJldHVybiBjcmVhdGVDb2RlQmxvY2tUb29sYmFyKGJsb2NrLmlkLCB0aGlzLmlzQmxvY2tSdW5uaW5nKGJsb2NrLmlkKSwge1xuICAgICAgb25SdW46ICgpID0+IHZvaWQgdGhpcy5ydW5BY3RpdmVCbG9ja0J5SWQoYmxvY2suaWQpLFxuICAgICAgb25Db3B5OiBhc3luYyAoKSA9PiB7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgYXdhaXQgbmF2aWdhdG9yLmNsaXBib2FyZC53cml0ZVRleHQoYmxvY2suY29udGVudCk7XG4gICAgICAgICAgbmV3IE5vdGljZShcIkNvZGUgY29waWVkXCIpO1xuICAgICAgICB9IGNhdGNoIHtcbiAgICAgICAgICBuZXcgTm90aWNlKFwiQ2xpcGJvYXJkIHdyaXRlIGZhaWxlZC5cIik7XG4gICAgICAgIH1cbiAgICAgIH0sXG4gICAgICBvblJlbW92ZTogKCkgPT4gdm9pZCB0aGlzLnJlbW92ZVNuaXBwZXRCeUlkKGJsb2NrLmlkKSxcbiAgICAgIG9uVG9nZ2xlT3V0cHV0OiAoKSA9PiB7XG4gICAgICAgIGNvbnN0IG91dHB1dCA9IHRoaXMub3V0cHV0cy5nZXQoYmxvY2suaWQpO1xuICAgICAgICBpZiAoIW91dHB1dCkge1xuICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICBvdXRwdXQudmlzaWJsZSA9ICFvdXRwdXQudmlzaWJsZTtcbiAgICAgICAgdGhpcy5ub3RpZnlPdXRwdXRDaGFuZ2VkKGJsb2NrLmlkKTtcbiAgICAgIH0sXG4gICAgfSk7XG4gIH1cblxuICByZW5kZXJPdXRwdXRJbnRvKGJsb2NrSWQ6IHN0cmluZywgY29udGFpbmVyOiBIVE1MRWxlbWVudCk6IHZvaWQge1xuICAgIGNvbnRhaW5lci5lbXB0eSgpO1xuXG4gICAgY29uc3Qgb3V0cHV0ID0gdGhpcy5vdXRwdXRzLmdldChibG9ja0lkKTtcbiAgICBpZiAodGhpcy5ydW5uaW5nLmhhcyhibG9ja0lkKSkge1xuICAgICAgY29udGFpbmVyLmFwcGVuZENoaWxkKGNyZWF0ZVJ1bm5pbmdQYW5lbCgpKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBpZiAoIW91dHB1dCB8fCAhb3V0cHV0LnZpc2libGUpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBjb250YWluZXIuYXBwZW5kQ2hpbGQoY3JlYXRlT3V0cHV0UGFuZWwob3V0cHV0KSk7XG4gIH1cblxuICBhc3luYyBydW5BY3RpdmVCbG9ja0J5SWQoYmxvY2tJZDogc3RyaW5nKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3QgYmxvY2sgPSB0aGlzLmZpbmRBY3RpdmVCbG9ja0J5SWQoYmxvY2tJZCk7XG4gICAgY29uc3QgZmlsZSA9IHRoaXMuZ2V0QWN0aXZlTWFya2Rvd25GaWxlKCk7XG4gICAgaWYgKCFibG9jayB8fCAhZmlsZSkge1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBhd2FpdCB0aGlzLnJ1bkJsb2NrKGZpbGUsIGJsb2NrKTtcbiAgfVxuXG4gIGFzeW5jIHJlbW92ZVNuaXBwZXRCeUlkKGJsb2NrSWQ6IHN0cmluZyk6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IGJsb2NrID0gdGhpcy5maW5kQWN0aXZlQmxvY2tCeUlkKGJsb2NrSWQpO1xuICAgIGlmICghYmxvY2spIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBjb25zdCBmaWxlID0gdGhpcy5hcHAudmF1bHQuZ2V0QWJzdHJhY3RGaWxlQnlQYXRoKGJsb2NrLmZpbGVQYXRoKTtcbiAgICBpZiAoIShmaWxlIGluc3RhbmNlb2YgVEZpbGUpKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgdGhpcy5ydW5uaW5nLmdldChibG9ja0lkKT8uYWJvcnQoKTtcbiAgICB0aGlzLnJ1bm5pbmcuZGVsZXRlKGJsb2NrSWQpO1xuICAgIHRoaXMub3V0cHV0cy5kZWxldGUoYmxvY2tJZCk7XG5cbiAgICBhd2FpdCB0aGlzLmFwcC52YXVsdC5wcm9jZXNzKGZpbGUsIChjb250ZW50KSA9PiB7XG4gICAgICBjb25zdCBsaW5lcyA9IGNvbnRlbnQuc3BsaXQoL1xccj9cXG4vKTtcbiAgICAgIGNvbnN0IGJsb2NrcyA9IHBhcnNlTWFya2Rvd25Db2RlQmxvY2tzKGZpbGUucGF0aCwgY29udGVudCwgdGhpcy5zZXR0aW5ncyk7XG4gICAgICBjb25zdCBjdXJyZW50QmxvY2sgPSBibG9ja3MuZmluZCgoY2FuZGlkYXRlKSA9PiBjYW5kaWRhdGUuaWQgPT09IGJsb2NrSWQpO1xuICAgICAgaWYgKCFjdXJyZW50QmxvY2spIHtcbiAgICAgICAgcmV0dXJuIGNvbnRlbnQ7XG4gICAgICB9XG5cbiAgICAgIGNvbnN0IG1hbmFnZWRSYW5nZSA9IHRoaXMuZmluZE1hbmFnZWRPdXRwdXRSYW5nZShsaW5lcywgYmxvY2tJZCk7XG4gICAgICBjb25zdCByZW1vdmFsU3RhcnQgPSBjdXJyZW50QmxvY2suc3RhcnRMaW5lO1xuICAgICAgY29uc3QgcmVtb3ZhbEVuZCA9IG1hbmFnZWRSYW5nZSA/IG1hbmFnZWRSYW5nZS5lbmQgOiBjdXJyZW50QmxvY2suZW5kTGluZTtcbiAgICAgIGxpbmVzLnNwbGljZShyZW1vdmFsU3RhcnQsIHJlbW92YWxFbmQgLSByZW1vdmFsU3RhcnQgKyAxKTtcblxuICAgICAgd2hpbGUgKHJlbW92YWxTdGFydCA8IGxpbmVzLmxlbmd0aCAtIDEgJiYgbGluZXNbcmVtb3ZhbFN0YXJ0XSA9PT0gXCJcIiAmJiBsaW5lc1tyZW1vdmFsU3RhcnQgKyAxXSA9PT0gXCJcIikge1xuICAgICAgICBsaW5lcy5zcGxpY2UocmVtb3ZhbFN0YXJ0LCAxKTtcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIGxpbmVzLmpvaW4oXCJcXG5cIik7XG4gICAgfSk7XG5cbiAgICB0aGlzLm5vdGlmeU91dHB1dENoYW5nZWQoYmxvY2tJZCk7XG4gICAgdGhpcy51cGRhdGVTdGF0dXNCYXIoKTtcbiAgICBuZXcgTm90aWNlKFwibG9vbSBzbmlwcGV0IHJlbW92ZWQuXCIpO1xuICB9XG5cbiAgYXN5bmMgcnVuQWxsQmxvY2tzSW5GaWxlKGZpbGU6IFRGaWxlKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3Qgc291cmNlID0gYXdhaXQgdGhpcy5hcHAudmF1bHQuY2FjaGVkUmVhZChmaWxlKTtcbiAgICBjb25zdCBibG9ja3MgPSBwYXJzZU1hcmtkb3duQ29kZUJsb2NrcyhmaWxlLnBhdGgsIHNvdXJjZSwgdGhpcy5zZXR0aW5ncyk7XG4gICAgY29uc3QgY29udGFpbmVyR3JvdXAgPSB0aGlzLmNvbnRhaW5lclJ1bm5lci5nZXRDb250YWluZXJHcm91cE5hbWUoZmlsZSkgfHwgdGhpcy5zZXR0aW5ncy5kZWZhdWx0Q29udGFpbmVyR3JvdXA7XG4gICAgY29uc3Qgc3VwcG9ydGVkQmxvY2tzID0gY29udGFpbmVyR3JvdXAgPyBibG9ja3MgOiBibG9ja3MuZmlsdGVyKChibG9jaykgPT4gdGhpcy5yZWdpc3RyeS5nZXRSdW5uZXJGb3JCbG9jayhibG9jaywgdGhpcy5zZXR0aW5ncykpO1xuXG4gICAgaWYgKCFzdXBwb3J0ZWRCbG9ja3MubGVuZ3RoKSB7XG4gICAgICBuZXcgTm90aWNlKFwiTm8gc3VwcG9ydGVkIGxvb20gYmxvY2tzIGZvdW5kIGluIHRoZSBjdXJyZW50IG5vdGUuXCIpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGZvciAoY29uc3QgYmxvY2sgb2Ygc3VwcG9ydGVkQmxvY2tzKSB7XG4gICAgICBhd2FpdCB0aGlzLnJ1bkJsb2NrKGZpbGUsIGJsb2NrKTtcbiAgICB9XG4gIH1cblxuICBhc3luYyBjbGVhck91dHB1dHNGb3JGaWxlKGZpbGU6IFRGaWxlKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3Qgc291cmNlID0gYXdhaXQgdGhpcy5hcHAudmF1bHQuY2FjaGVkUmVhZChmaWxlKTtcbiAgICBjb25zdCBibG9ja3MgPSBwYXJzZU1hcmtkb3duQ29kZUJsb2NrcyhmaWxlLnBhdGgsIHNvdXJjZSwgdGhpcy5zZXR0aW5ncyk7XG4gICAgZm9yIChjb25zdCBibG9jayBvZiBibG9ja3MpIHtcbiAgICAgIHRoaXMub3V0cHV0cy5kZWxldGUoYmxvY2suaWQpO1xuICAgICAgdGhpcy5ub3RpZnlPdXRwdXRDaGFuZ2VkKGJsb2NrLmlkKTtcbiAgICAgIGF3YWl0IHRoaXMucmVtb3ZlTWFuYWdlZE91dHB1dEJsb2NrKGZpbGUucGF0aCwgYmxvY2suaWQpO1xuICAgIH1cbiAgICBuZXcgTm90aWNlKFwibG9vbSBvdXRwdXRzIGNsZWFyZWQuXCIpO1xuICB9XG5cbiAgYXN5bmMgcnVuQmxvY2soZmlsZTogVEZpbGUsIGJsb2NrOiBsb29tQ29kZUJsb2NrKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgdGhpcy5sYXN0TWFya2Rvd25GaWxlUGF0aCA9IGZpbGUucGF0aDtcbiAgICBpZiAodGhpcy5ydW5uaW5nLmhhcyhibG9jay5pZCkpIHtcbiAgICAgIG5ldyBOb3RpY2UoXCJUaGlzIGxvb20gYmxvY2sgaXMgYWxyZWFkeSBydW5uaW5nLlwiKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBpZiAoIShhd2FpdCB0aGlzLmVuc3VyZUV4ZWN1dGlvbkVuYWJsZWQoKSkpIHtcbiAgICAgIHNob3dFeGVjdXRpb25EaXNhYmxlZE5vdGljZSgpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGNvbnN0IHdvcmtpbmdEaXJlY3RvcnkgPSB0aGlzLnJlc29sdmVXb3JraW5nRGlyZWN0b3J5KGZpbGUpO1xuICAgIGNvbnN0IGNvbnRhaW5lckdyb3VwID0gdGhpcy5jb250YWluZXJSdW5uZXIuZ2V0Q29udGFpbmVyR3JvdXBOYW1lKGZpbGUpIHx8IHRoaXMuc2V0dGluZ3MuZGVmYXVsdENvbnRhaW5lckdyb3VwO1xuICAgIGNvbnN0IHJ1bm5lciA9IGNvbnRhaW5lckdyb3VwID8gbnVsbCA6IHRoaXMucmVnaXN0cnkuZ2V0UnVubmVyRm9yQmxvY2soYmxvY2ssIHRoaXMuc2V0dGluZ3MpO1xuICAgIGlmICghcnVubmVyKSB7XG4gICAgICBpZiAoIWNvbnRhaW5lckdyb3VwKSB7XG4gICAgICAgIG5ldyBOb3RpY2UoYE5vIGNvbmZpZ3VyZWQgcnVubmVyIGZvciAke2Jsb2NrLmxhbmd1YWdlfS5gKTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuICAgIH1cblxuICAgIGNvbnN0IGNvbnRyb2xsZXIgPSBuZXcgQWJvcnRDb250cm9sbGVyKCk7XG4gICAgY29uc3QgcnVuQ29udGV4dCA9IHtcbiAgICAgIGZpbGUsXG4gICAgICB3b3JraW5nRGlyZWN0b3J5LFxuICAgICAgdGltZW91dE1zOiB0aGlzLnNldHRpbmdzLmRlZmF1bHRUaW1lb3V0TXMsXG4gICAgICBzaWduYWw6IGNvbnRyb2xsZXIuc2lnbmFsLFxuICAgIH07XG4gICAgdGhpcy5ydW5uaW5nLnNldChibG9jay5pZCwgY29udHJvbGxlcik7XG4gICAgdGhpcy5ub3RpZnlPdXRwdXRDaGFuZ2VkKGJsb2NrLmlkKTtcbiAgICB0aGlzLnVwZGF0ZVN0YXR1c0JhcigpO1xuXG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHJlc29sdmVkQmxvY2sgPSBhd2FpdCB0aGlzLnJlc29sdmVFeGVjdXRhYmxlQmxvY2soZmlsZSwgYmxvY2spO1xuICAgICAgY29uc3QgcmVzdWx0ID0gY29udGFpbmVyR3JvdXBcbiAgICAgICAgPyBhd2FpdCB0aGlzLmNvbnRhaW5lclJ1bm5lci5ydW4ocmVzb2x2ZWRCbG9jay5ibG9jaywgcnVuQ29udGV4dCwgdGhpcy5zZXR0aW5ncywgY29udGFpbmVyR3JvdXApXG4gICAgICAgIDogYXdhaXQgcnVubmVyIS5ydW4ocmVzb2x2ZWRCbG9jay5ibG9jaywgcnVuQ29udGV4dCwgdGhpcy5zZXR0aW5ncyk7XG5cbiAgICAgIGlmIChyZXN1bHQudGltZWRPdXQpIHtcbiAgICAgICAgcmVzdWx0LnN0ZGVyciA9IHJlc3VsdC5zdGRlcnIgfHwgYEV4ZWN1dGlvbiB0aW1lZCBvdXQgYWZ0ZXIgJHt0aGlzLnNldHRpbmdzLmRlZmF1bHRUaW1lb3V0TXN9IG1zLmA7XG4gICAgICB9IGVsc2UgaWYgKHJlc3VsdC5jYW5jZWxsZWQpIHtcbiAgICAgICAgcmVzdWx0LnN0ZGVyciA9IHJlc3VsdC5zdGRlcnIgfHwgXCJFeGVjdXRpb24gY2FuY2VsbGVkLlwiO1xuICAgICAgfSBlbHNlIGlmICghcmVzdWx0LnN1Y2Nlc3MgJiYgIXJlc3VsdC5zdGRlcnIudHJpbSgpKSB7XG4gICAgICAgIHJlc3VsdC5zdGRlcnIgPSBcIlByb2Nlc3MgZXhpdGVkIHVuc3VjY2Vzc2Z1bGx5LlwiO1xuICAgICAgfVxuXG4gICAgICBpZiAocmVzb2x2ZWRCbG9jay5zb3VyY2VEZXNjcmlwdGlvbikge1xuICAgICAgICBjb25zdCBzb3VyY2VOb3RpY2UgPSBgUmFuIGV4dHJhY3RlZCBzb3VyY2UgZnJvbSAke3Jlc29sdmVkQmxvY2suc291cmNlRGVzY3JpcHRpb259LmA7XG4gICAgICAgIHJlc3VsdC53YXJuaW5nID0gcmVzdWx0Lndhcm5pbmcgPyBgJHtzb3VyY2VOb3RpY2V9XFxuJHtyZXN1bHQud2FybmluZ31gIDogc291cmNlTm90aWNlO1xuICAgICAgfVxuXG4gICAgICB0aGlzLm91dHB1dHMuc2V0KGJsb2NrLmlkLCB7XG4gICAgICAgIGJsb2NrSWQ6IGJsb2NrLmlkLFxuICAgICAgICBibG9jayxcbiAgICAgICAgcmVzdWx0LFxuICAgICAgICBjb2xsYXBzZWQ6IGZhbHNlLFxuICAgICAgICB2aXNpYmxlOiB0cnVlLFxuICAgICAgfSk7XG5cbiAgICAgIGlmICh0aGlzLnNldHRpbmdzLndyaXRlT3V0cHV0VG9Ob3RlKSB7XG4gICAgICAgIGF3YWl0IHRoaXMud3JpdGVNYW5hZ2VkT3V0cHV0QmxvY2soZmlsZSwgYmxvY2ssIHJlc3VsdCk7XG4gICAgICB9XG5cbiAgICAgIGNvbnN0IHJ1bm5lck5hbWUgPSBjb250YWluZXJHcm91cCA/IGBjb250YWluZXIgJHtjb250YWluZXJHcm91cH1gIDogcnVubmVyIS5kaXNwbGF5TmFtZTtcbiAgICAgIG5ldyBOb3RpY2UocmVzdWx0LnN1Y2Nlc3MgPyBgbG9vbSByYW4gJHtydW5uZXJOYW1lfSBibG9jay5gIDogYGxvb20gcnVuIGZhaWxlZCBmb3IgJHtydW5uZXJOYW1lfS5gKTtcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgY29uc3QgbWVzc2FnZSA9IGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogU3RyaW5nKGVycm9yKTtcbiAgICAgIHRoaXMub3V0cHV0cy5zZXQoYmxvY2suaWQsIHtcbiAgICAgICAgYmxvY2tJZDogYmxvY2suaWQsXG4gICAgICAgIGJsb2NrLFxuICAgICAgICBjb2xsYXBzZWQ6IGZhbHNlLFxuICAgICAgICB2aXNpYmxlOiB0cnVlLFxuICAgICAgICByZXN1bHQ6IHtcbiAgICAgICAgICBydW5uZXJJZDogY29udGFpbmVyR3JvdXAgPyBgY29udGFpbmVyOiR7Y29udGFpbmVyR3JvdXB9YCA6IHJ1bm5lcj8uaWQgPz8gXCJ1bmtub3duXCIsXG4gICAgICAgICAgcnVubmVyTmFtZTogY29udGFpbmVyR3JvdXAgPyBgQ29udGFpbmVyICR7Y29udGFpbmVyR3JvdXB9YCA6IHJ1bm5lcj8uZGlzcGxheU5hbWUgPz8gXCJVbmtub3duXCIsXG4gICAgICAgICAgc3RhcnRlZEF0OiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXG4gICAgICAgICAgZmluaXNoZWRBdDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpLFxuICAgICAgICAgIGR1cmF0aW9uTXM6IDAsXG4gICAgICAgICAgZXhpdENvZGU6IC0xLFxuICAgICAgICAgIHN0ZG91dDogXCJcIixcbiAgICAgICAgICBzdGRlcnI6IG1lc3NhZ2UsXG4gICAgICAgICAgc3VjY2VzczogZmFsc2UsXG4gICAgICAgICAgdGltZWRPdXQ6IGZhbHNlLFxuICAgICAgICAgIGNhbmNlbGxlZDogZmFsc2UsXG4gICAgICAgIH0sXG4gICAgICB9KTtcbiAgICAgIG5ldyBOb3RpY2UoYGxvb20gZXJyb3I6ICR7bWVzc2FnZX1gKTtcbiAgICB9IGZpbmFsbHkge1xuICAgICAgdGhpcy5ydW5uaW5nLmRlbGV0ZShibG9jay5pZCk7XG4gICAgICB0aGlzLm5vdGlmeU91dHB1dENoYW5nZWQoYmxvY2suaWQpO1xuICAgICAgdGhpcy51cGRhdGVTdGF0dXNCYXIoKTtcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIGVuc3VyZUV4ZWN1dGlvbkVuYWJsZWQoKTogUHJvbWlzZTxib29sZWFuPiB7XG4gICAgaWYgKHRoaXMuc2V0dGluZ3MuZW5hYmxlTG9jYWxFeGVjdXRpb24gJiYgdGhpcy5zZXR0aW5ncy5oYXNBY2tub3dsZWRnZWRFeGVjdXRpb25SaXNrKSB7XG4gICAgICByZXR1cm4gdHJ1ZTtcbiAgICB9XG5cbiAgICByZXR1cm4gYXdhaXQgbmV3IFByb21pc2U8Ym9vbGVhbj4oKHJlc29sdmUpID0+IHtcbiAgICAgIGxldCBzZXR0bGVkID0gZmFsc2U7XG4gICAgICBjb25zdCBzZXR0bGUgPSAodmFsdWU6IGJvb2xlYW4pID0+IHtcbiAgICAgICAgaWYgKCFzZXR0bGVkKSB7XG4gICAgICAgICAgc2V0dGxlZCA9IHRydWU7XG4gICAgICAgICAgcmVzb2x2ZSh2YWx1ZSk7XG4gICAgICAgIH1cbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IG1vZGFsID0gbmV3IEV4ZWN1dGlvbkNvbnNlbnRNb2RhbCh0aGlzLmFwcCwgYXN5bmMgKCkgPT4ge1xuICAgICAgICB0aGlzLnNldHRpbmdzLmVuYWJsZUxvY2FsRXhlY3V0aW9uID0gdHJ1ZTtcbiAgICAgICAgdGhpcy5zZXR0aW5ncy5oYXNBY2tub3dsZWRnZWRFeGVjdXRpb25SaXNrID0gdHJ1ZTtcbiAgICAgICAgYXdhaXQgdGhpcy5zYXZlU2V0dGluZ3MoKTtcbiAgICAgICAgc2V0dGxlKHRydWUpO1xuICAgICAgfSk7XG5cbiAgICAgIGNvbnN0IG9yaWdpbmFsQ2xvc2UgPSBtb2RhbC5jbG9zZS5iaW5kKG1vZGFsKTtcbiAgICAgIG1vZGFsLmNsb3NlID0gKCkgPT4ge1xuICAgICAgICBvcmlnaW5hbENsb3NlKCk7XG4gICAgICAgIHNldHRsZSh0aGlzLnNldHRpbmdzLmVuYWJsZUxvY2FsRXhlY3V0aW9uICYmIHRoaXMuc2V0dGluZ3MuaGFzQWNrbm93bGVkZ2VkRXhlY3V0aW9uUmlzayk7XG4gICAgICB9O1xuICAgICAgbW9kYWwub3BlbigpO1xuICAgIH0pO1xuICB9XG5cbiAgcHJpdmF0ZSByZXNvbHZlV29ya2luZ0RpcmVjdG9yeShmaWxlOiBURmlsZSk6IHN0cmluZyB7XG4gICAgaWYgKHRoaXMuc2V0dGluZ3Mud29ya2luZ0RpcmVjdG9yeS50cmltKCkpIHtcbiAgICAgIHJldHVybiB0aGlzLnNldHRpbmdzLndvcmtpbmdEaXJlY3RvcnkudHJpbSgpO1xuICAgIH1cblxuICAgIGNvbnN0IGFkYXB0ZXJCYXNlUGF0aCA9ICh0aGlzLmFwcC52YXVsdC5hZGFwdGVyIGFzIHsgYmFzZVBhdGg/OiBzdHJpbmcgfSkuYmFzZVBhdGggPz8gXCJcIjtcbiAgICBjb25zdCBmaWxlRm9sZGVyID0gZGlybmFtZShmaWxlLnBhdGgpO1xuICAgIGNvbnN0IHJlc29sdmVkID0gZmlsZUZvbGRlciA9PT0gXCIuXCIgPyBhZGFwdGVyQmFzZVBhdGggOiBgJHthZGFwdGVyQmFzZVBhdGh9LyR7ZmlsZUZvbGRlcn1gO1xuICAgIHJldHVybiByZXNvbHZlZCB8fCBwcm9jZXNzLmN3ZCgpO1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyByZXNvbHZlRXhlY3V0YWJsZUJsb2NrKGZpbGU6IFRGaWxlLCBibG9jazogbG9vbUNvZGVCbG9jayk6IFByb21pc2U8eyBibG9jazogbG9vbUNvZGVCbG9jazsgc291cmNlRGVzY3JpcHRpb24/OiBzdHJpbmcgfT4ge1xuICAgIGlmICghYmxvY2suc291cmNlUmVmZXJlbmNlKSB7XG4gICAgICByZXR1cm4geyBibG9jayB9O1xuICAgIH1cblxuICAgIGNvbnN0IHJlZmVyZW5jZVBhdGggPSB0aGlzLnJlc29sdmVSZWZlcmVuY2VkVmF1bHRQYXRoKGZpbGUsIGJsb2NrLnNvdXJjZVJlZmVyZW5jZS5maWxlUGF0aCk7XG4gICAgY29uc3Qgc291cmNlRmlsZSA9IHRoaXMuYXBwLnZhdWx0LmdldEFic3RyYWN0RmlsZUJ5UGF0aChyZWZlcmVuY2VQYXRoKTtcbiAgICBpZiAoIShzb3VyY2VGaWxlIGluc3RhbmNlb2YgVEZpbGUpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYFJlZmVyZW5jZWQgc291cmNlIGZpbGUgbm90IGZvdW5kOiAke3JlZmVyZW5jZVBhdGh9YCk7XG4gICAgfVxuXG4gICAgY29uc3QgcmVzb2x2ZWQgPSBhd2FpdCByZXNvbHZlUmVmZXJlbmNlZFNvdXJjZShcbiAgICAgIGF3YWl0IHRoaXMuYXBwLnZhdWx0LmNhY2hlZFJlYWQoc291cmNlRmlsZSksXG4gICAgICB7IC4uLmJsb2NrLnNvdXJjZVJlZmVyZW5jZSwgZmlsZVBhdGg6IHJlZmVyZW5jZVBhdGggfSxcbiAgICAgIGJsb2NrLmxhbmd1YWdlLFxuICAgICAgYmxvY2suY29udGVudCxcbiAgICAgIHtcbiAgICAgICAgcHl0aG9uRXhlY3V0YWJsZTogdGhpcy5zZXR0aW5ncy5weXRob25FeGVjdXRhYmxlLnRyaW0oKSB8fCBcInB5dGhvbjNcIixcbiAgICAgICAgZXh0ZXJuYWxFeHRyYWN0b3I6IHRoaXMuZ2V0Q3VzdG9tTGFuZ3VhZ2VFeHRyYWN0b3IoYmxvY2subGFuZ3VhZ2UsIGZpbGUpLFxuICAgICAgICByZWFkRmlsZTogYXN5bmMgKGZpbGVQYXRoKSA9PiB7XG4gICAgICAgICAgY29uc3QgaW1wb3J0ZWRGaWxlID0gdGhpcy5hcHAudmF1bHQuZ2V0QWJzdHJhY3RGaWxlQnlQYXRoKG5vcm1hbGl6ZVBhdGgoZmlsZVBhdGgpKTtcbiAgICAgICAgICByZXR1cm4gaW1wb3J0ZWRGaWxlIGluc3RhbmNlb2YgVEZpbGUgPyB0aGlzLmFwcC52YXVsdC5jYWNoZWRSZWFkKGltcG9ydGVkRmlsZSkgOiBudWxsO1xuICAgICAgICB9LFxuICAgICAgICByZXNvbHZlUHl0aG9uSW1wb3J0OiBhc3luYyAoZnJvbUZpbGVQYXRoLCBtb2R1bGVOYW1lLCBsZXZlbCkgPT4gdGhpcy5yZXNvbHZlUHl0aG9uSW1wb3J0VmF1bHRQYXRoKGZyb21GaWxlUGF0aCwgbW9kdWxlTmFtZSwgbGV2ZWwpLFxuICAgICAgfSxcbiAgICApO1xuXG4gICAgcmV0dXJuIHtcbiAgICAgIGJsb2NrOiB7XG4gICAgICAgIC4uLmJsb2NrLFxuICAgICAgICBjb250ZW50OiByZXNvbHZlZC5jb250ZW50LFxuICAgICAgfSxcbiAgICAgIHNvdXJjZURlc2NyaXB0aW9uOiByZXNvbHZlZC5kZXNjcmlwdGlvbixcbiAgICB9O1xuICB9XG5cbiAgcHJpdmF0ZSByZXNvbHZlUmVmZXJlbmNlZFZhdWx0UGF0aChmaWxlOiBURmlsZSwgcmVmZXJlbmNlUGF0aDogc3RyaW5nKTogc3RyaW5nIHtcbiAgICBjb25zdCB0cmltbWVkID0gcmVmZXJlbmNlUGF0aC50cmltKCk7XG4gICAgaWYgKCF0cmltbWVkKSB7XG4gICAgICByZXR1cm4gdHJpbW1lZDtcbiAgICB9XG4gICAgaWYgKHRyaW1tZWQuc3RhcnRzV2l0aChcIi9cIikpIHtcbiAgICAgIHJldHVybiBub3JtYWxpemVQYXRoKHRyaW1tZWQuc2xpY2UoMSkpO1xuICAgIH1cblxuICAgIGNvbnN0IGJhc2VEaXIgPSBkaXJuYW1lKGZpbGUucGF0aCk7XG4gICAgcmV0dXJuIG5vcm1hbGl6ZVBhdGgoYmFzZURpciA9PT0gXCIuXCIgPyB0cmltbWVkIDogYCR7YmFzZURpcn0vJHt0cmltbWVkfWApO1xuICB9XG5cbiAgcHJpdmF0ZSByZXNvbHZlUHl0aG9uSW1wb3J0VmF1bHRQYXRoKGZyb21GaWxlUGF0aDogc3RyaW5nLCBtb2R1bGVOYW1lOiBzdHJpbmcsIGxldmVsOiBudW1iZXIpOiBzdHJpbmcgfCBudWxsIHtcbiAgICBjb25zdCBtb2R1bGVQYXRoID0gbW9kdWxlTmFtZVxuICAgICAgLnNwbGl0KFwiLlwiKVxuICAgICAgLm1hcCgocGFydCkgPT4gcGFydC50cmltKCkpXG4gICAgICAuZmlsdGVyKEJvb2xlYW4pXG4gICAgICAuam9pbihcIi9cIik7XG4gICAgY29uc3QgZnJvbURpciA9IGRpcm5hbWUoZnJvbUZpbGVQYXRoKTtcbiAgICBjb25zdCBiYXNlRGlycyA9IGxldmVsID4gMFxuICAgICAgPyBbdGhpcy5hc2NlbmRWYXVsdFBhdGgoZnJvbURpciA9PT0gXCIuXCIgPyBcIlwiIDogZnJvbURpciwgbGV2ZWwgLSAxKV1cbiAgICAgIDogW2Zyb21EaXIgPT09IFwiLlwiID8gXCJcIiA6IGZyb21EaXIsIFwiXCJdO1xuXG4gICAgZm9yIChjb25zdCBiYXNlRGlyIG9mIGJhc2VEaXJzKSB7XG4gICAgICBjb25zdCBjYW5kaWRhdGVzID0gdGhpcy5nZXRQeXRob25JbXBvcnRDYW5kaWRhdGVzKGJhc2VEaXIsIG1vZHVsZVBhdGgpO1xuICAgICAgZm9yIChjb25zdCBjYW5kaWRhdGUgb2YgY2FuZGlkYXRlcykge1xuICAgICAgICBjb25zdCBub3JtYWxpemVkID0gbm9ybWFsaXplUGF0aChjYW5kaWRhdGUpO1xuICAgICAgICBpZiAodGhpcy5hcHAudmF1bHQuZ2V0QWJzdHJhY3RGaWxlQnlQYXRoKG5vcm1hbGl6ZWQpIGluc3RhbmNlb2YgVEZpbGUpIHtcbiAgICAgICAgICByZXR1cm4gbm9ybWFsaXplZDtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiBudWxsO1xuICB9XG5cbiAgcHJpdmF0ZSBnZXRQeXRob25JbXBvcnRDYW5kaWRhdGVzKGJhc2VEaXI6IHN0cmluZywgbW9kdWxlUGF0aDogc3RyaW5nKTogc3RyaW5nW10ge1xuICAgIGNvbnN0IHByZWZpeCA9IGJhc2VEaXIgPyBgJHtiYXNlRGlyfS9gIDogXCJcIjtcbiAgICBpZiAoIW1vZHVsZVBhdGgpIHtcbiAgICAgIHJldHVybiBbYCR7cHJlZml4fV9faW5pdF9fLnB5YF07XG4gICAgfVxuICAgIHJldHVybiBbXG4gICAgICBgJHtwcmVmaXh9JHttb2R1bGVQYXRofS5weWAsXG4gICAgICBgJHtwcmVmaXh9JHttb2R1bGVQYXRofS9fX2luaXRfXy5weWAsXG4gICAgXTtcbiAgfVxuXG4gIHByaXZhdGUgYXNjZW5kVmF1bHRQYXRoKHBhdGg6IHN0cmluZywgbGV2ZWxzOiBudW1iZXIpOiBzdHJpbmcge1xuICAgIGxldCBjdXJyZW50ID0gcGF0aDtcbiAgICBmb3IgKGxldCBpbmRleCA9IDA7IGluZGV4IDwgbGV2ZWxzOyBpbmRleCArPSAxKSB7XG4gICAgICBjb25zdCBuZXh0ID0gZGlybmFtZShjdXJyZW50KTtcbiAgICAgIGN1cnJlbnQgPSBuZXh0ID09PSBcIi5cIiA/IFwiXCIgOiBuZXh0O1xuICAgIH1cbiAgICByZXR1cm4gY3VycmVudDtcbiAgfVxuXG4gIGFzeW5jIGdldENvbnRhaW5lckdyb3VwU3VtbWFyaWVzKCk6IFByb21pc2U8QXJyYXk8eyBuYW1lOiBzdHJpbmc7IHN0YXR1czogc3RyaW5nIH0+PiB7XG4gICAgcmV0dXJuIHRoaXMuY29udGFpbmVyUnVubmVyLmdldEdyb3VwU3VtbWFyaWVzKCk7XG4gIH1cblxuICBhc3luYyBidWlsZENvbnRhaW5lckdyb3VwKG5hbWU6IHN0cmluZyk6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IGNvbnRyb2xsZXIgPSBuZXcgQWJvcnRDb250cm9sbGVyKCk7XG4gICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgdGhpcy5jb250YWluZXJSdW5uZXIuYnVpbGRHcm91cChuYW1lLCBNYXRoLm1heCh0aGlzLnNldHRpbmdzLmRlZmF1bHRUaW1lb3V0TXMsIDEyMF8wMDApLCBjb250cm9sbGVyLnNpZ25hbCk7XG4gICAgbmV3IE5vdGljZShyZXN1bHQuc3VjY2VzcyA/IGBsb29tIGJ1aWx0IGNvbnRhaW5lciBncm91cCAke25hbWV9LmAgOiBgbG9vbSBjb250YWluZXIgYnVpbGQgZmFpbGVkIGZvciAke25hbWV9LmAsIDgwMDApO1xuICB9XG5cbiAgcmVnaXN0ZXJDb2RlQmxvY2tQcm9jZXNzb3JzKCk6IHZvaWQge1xuICAgIGZvciAoY29uc3QgYWxpYXMgb2YgZ2V0U3VwcG9ydGVkTGFuZ3VhZ2VBbGlhc2VzKHRoaXMuc2V0dGluZ3MpKSB7XG4gICAgICBjb25zdCBub3JtYWxpemVkQWxpYXMgPSBhbGlhcy50b0xvd2VyQ2FzZSgpO1xuICAgICAgaWYgKHRoaXMucmVnaXN0ZXJlZENvZGVCbG9ja0FsaWFzZXMuaGFzKG5vcm1hbGl6ZWRBbGlhcykpIHtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG5cbiAgICAgIGlmICgvW15hLXpBLVowLTlfLV0vLnRlc3Qobm9ybWFsaXplZEFsaWFzKSkge1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cblxuICAgICAgdGhpcy5yZWdpc3RlcmVkQ29kZUJsb2NrQWxpYXNlcy5hZGQobm9ybWFsaXplZEFsaWFzKTtcbiAgICAgIHRoaXMucmVnaXN0ZXJNYXJrZG93bkNvZGVCbG9ja1Byb2Nlc3Nvcihub3JtYWxpemVkQWxpYXMsIGFzeW5jIChzb3VyY2UsIGVsLCBjdHgpID0+IHtcbiAgICAgICAgY29uc3QgZmlsZVBhdGggPSBjdHguc291cmNlUGF0aDtcbiAgICAgICAgY29uc3QgZmlsZSA9IHRoaXMuYXBwLnZhdWx0LmdldEFic3RyYWN0RmlsZUJ5UGF0aChmaWxlUGF0aCk7XG4gICAgICAgIGlmICghKGZpbGUgaW5zdGFuY2VvZiBURmlsZSkpIHtcbiAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBmdWxsVGV4dCA9IGF3YWl0IHRoaXMuYXBwLnZhdWx0LmNhY2hlZFJlYWQoZmlsZSk7XG4gICAgICAgIGNvbnN0IGJsb2NrcyA9IHBhcnNlTWFya2Rvd25Db2RlQmxvY2tzKGZpbGVQYXRoLCBmdWxsVGV4dCwgdGhpcy5zZXR0aW5ncyk7XG4gICAgICAgIGNvbnN0IHNlY3Rpb24gPSAoY3R4ICYmIHR5cGVvZiBjdHguZ2V0U2VjdGlvbkluZm8gPT09IFwiZnVuY3Rpb25cIikgPyBjdHguZ2V0U2VjdGlvbkluZm8oZWwpIDogbnVsbDtcbiAgICAgICAgbGV0IGJsb2NrOiBsb29tQ29kZUJsb2NrIHwgdW5kZWZpbmVkO1xuICAgICAgICBpZiAoc2VjdGlvbikge1xuICAgICAgICAgIGNvbnN0IGxpbmVTdGFydCA9IHNlY3Rpb24ubGluZVN0YXJ0O1xuICAgICAgICAgIGJsb2NrID0gYmxvY2tzLmZpbmQoKGNhbmRpZGF0ZSkgPT4gY2FuZGlkYXRlLnN0YXJ0TGluZSA9PT0gbGluZVN0YXJ0ICYmIGNhbmRpZGF0ZS5jb250ZW50ID09PSBzb3VyY2UpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIGJsb2NrID0gYmxvY2tzLmZpbmQoKGNhbmRpZGF0ZSkgPT4gY2FuZGlkYXRlLmNvbnRlbnQgPT09IHNvdXJjZSk7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKCFibG9jaykge1xuICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuXG4gICAgICAgIGxldCBwcmUgPSBlbC5xdWVyeVNlbGVjdG9yKFwicHJlXCIpIGFzIEhUTUxFbGVtZW50IHwgbnVsbDtcbiAgICAgICAgaWYgKCFwcmUpIHtcbiAgICAgICAgICBwcmUgPSBlbC5jcmVhdGVFbChcInByZVwiKTtcbiAgICAgICAgICBwcmUuYWRkQ2xhc3MoYGxhbmd1YWdlLSR7bm9ybWFsaXplZEFsaWFzfWApO1xuICAgICAgICAgIGNvbnN0IGNvZGUgPSBwcmUuY3JlYXRlRWwoXCJjb2RlXCIpO1xuICAgICAgICAgIGNvZGUuYWRkQ2xhc3MoYGxhbmd1YWdlLSR7bm9ybWFsaXplZEFsaWFzfWApO1xuICAgICAgICAgIGNvZGUuc2V0VGV4dChzb3VyY2UpO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKGJsb2NrLmxhbmd1YWdlID09PSBcImxsdm0taXJcIikge1xuICAgICAgICAgIGNvbnN0IGNvZGUgPSAocHJlLnF1ZXJ5U2VsZWN0b3IoXCJjb2RlXCIpIGFzIEhUTUxFbGVtZW50IHwgbnVsbCkgPz8gcHJlO1xuICAgICAgICAgIGhpZ2hsaWdodExsdm1FbGVtZW50KGNvZGUsIHNvdXJjZSk7XG4gICAgICAgIH1cblxuICAgICAgICBjdHguYWRkQ2hpbGQobmV3IGxvb21Ub29sYmFyUmVuZGVyQ2hpbGQoZWwsIHRoaXMsIGJsb2NrLCBwcmUpKTtcbiAgICAgIH0pO1xuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgdXBkYXRlU3RhdHVzQmFyKCk6IHZvaWQge1xuICAgIGNvbnN0IGFjdGl2ZVJ1bnMgPSB0aGlzLnJ1bm5pbmcuc2l6ZTtcbiAgICB0aGlzLnN0YXR1c0Jhckl0ZW1FbC5zZXRUZXh0KGFjdGl2ZVJ1bnMgPyBgbG9vbTogJHthY3RpdmVSdW5zfSBBY3RpdmUgUnVuJHthY3RpdmVSdW5zID09PSAxID8gXCJcIiA6IFwic1wifWAgOiBcImxvb206IElkbGVcIik7XG4gIH1cblxuICBwcml2YXRlIG5vdGlmeU91dHB1dENoYW5nZWQoYmxvY2tJZDogc3RyaW5nKTogdm9pZCB7XG4gICAgdGhpcy5vdXRwdXRMaXN0ZW5lcnMuZ2V0KGJsb2NrSWQpPy5mb3JFYWNoKChsaXN0ZW5lcikgPT4gbGlzdGVuZXIoKSk7XG4gICAgdGhpcy5yZWZyZXNoQWxsVmlld3MoKTtcbiAgfVxuXG4gIHByaXZhdGUgcmVmcmVzaEFsbFZpZXdzKCk6IHZvaWQge1xuICAgIHRoaXMuYXBwLndvcmtzcGFjZS5nZXRMZWF2ZXNPZlR5cGUoXCJtYXJrZG93blwiKS5mb3JFYWNoKChsZWFmKSA9PiB7XG4gICAgICBjb25zdCB2aWV3ID0gbGVhZi52aWV3IGFzIE1hcmtkb3duVmlldztcbiAgICAgIGNvbnN0IHByZXZpZXdNb2RlID0gKHZpZXcgYXMgeyBwcmV2aWV3TW9kZT86IHsgcmVyZW5kZXI/OiAoZm9yY2U/OiBib29sZWFuKSA9PiB2b2lkIH0gfSkucHJldmlld01vZGU7XG4gICAgICBwcmV2aWV3TW9kZT8ucmVyZW5kZXI/Lih0cnVlKTtcbiAgICB9KTtcblxuICAgIGZvciAoY29uc3QgZWRpdG9yVmlldyBvZiB0aGlzLmVkaXRvclZpZXdzKSB7XG4gICAgICBlZGl0b3JWaWV3LmRpc3BhdGNoKHsgZWZmZWN0czogbG9vbVJlZnJlc2hFZmZlY3Qub2YodW5kZWZpbmVkKSB9KTtcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIGdldEFjdGl2ZU1hcmtkb3duRmlsZSgpOiBURmlsZSB8IG51bGwge1xuICAgIGNvbnN0IHZpZXcgPSB0aGlzLmFwcC53b3Jrc3BhY2UuZ2V0QWN0aXZlVmlld09mVHlwZShNYXJrZG93blZpZXcpO1xuICAgIHJldHVybiB2aWV3Py5maWxlID8/IG51bGw7XG4gIH1cblxuICBwcml2YXRlIGdldEN1cnJlbnRFZGl0b3JGaWxlUGF0aCgpOiBzdHJpbmcgfCBudWxsIHtcbiAgICByZXR1cm4gdGhpcy5nZXRBY3RpdmVNYXJrZG93bkZpbGUoKT8ucGF0aCA/PyB0aGlzLmxhc3RNYXJrZG93bkZpbGVQYXRoO1xuICB9XG5cbiAgYXN5bmMgZW5mb3JjZVNvdXJjZU1vZGVGb3JBY3RpdmVWaWV3KCk6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IHZpZXcgPSB0aGlzLmFwcC53b3Jrc3BhY2UuZ2V0QWN0aXZlVmlld09mVHlwZShNYXJrZG93blZpZXcpO1xuICAgIGlmICghdmlldykge1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGF3YWl0IHRoaXMuZW5mb3JjZVNvdXJjZU1vZGVGb3JMZWFmKHZpZXcubGVhZik7XG4gIH1cblxuICBhc3luYyBkaXNhYmxlU291cmNlTW9kZUZvckFjdGl2ZVZpZXcoKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3QgdmlldyA9IHRoaXMuYXBwLndvcmtzcGFjZS5nZXRBY3RpdmVWaWV3T2ZUeXBlKE1hcmtkb3duVmlldyk7XG4gICAgaWYgKCF2aWV3KSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgY29uc3QgbGVhZiA9IHZpZXcubGVhZjtcbiAgICBjb25zdCB2aWV3U3RhdGUgPSBsZWFmLmdldFZpZXdTdGF0ZSgpO1xuICAgIGNvbnN0IHN0YXRlID0geyAuLi4odmlld1N0YXRlLnN0YXRlID8/IHt9KSB9IGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+O1xuICAgIFxuICAgIGlmIChzdGF0ZS5tb2RlID09PSBcInNvdXJjZVwiICYmIHN0YXRlLnNvdXJjZSA9PT0gdHJ1ZSkge1xuICAgICAgc3RhdGUuc291cmNlID0gZmFsc2U7XG4gICAgICBhd2FpdCBsZWFmLnNldFZpZXdTdGF0ZSh7XG4gICAgICAgIC4uLnZpZXdTdGF0ZSxcbiAgICAgICAgc3RhdGUsXG4gICAgICB9KTtcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIGVuZm9yY2VTb3VyY2VNb2RlRm9yTGVhZihsZWFmOiBXb3Jrc3BhY2VMZWFmKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgaWYgKCF0aGlzLnNldHRpbmdzLnByZXNlcnZlU291cmNlTW9kZSkge1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGlmIChsZWFmLmlzRGVmZXJyZWQpIHtcbiAgICAgIGF3YWl0IGxlYWYubG9hZElmRGVmZXJyZWQoKTtcbiAgICB9XG5cbiAgICBjb25zdCB2aWV3ID0gbGVhZi52aWV3O1xuICAgIGlmICghKHZpZXcgaW5zdGFuY2VvZiBNYXJrZG93blZpZXcpIHx8ICF2aWV3LmZpbGUpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBjb25zdCBzb3VyY2UgPSB2aWV3LmVkaXRvcj8uZ2V0VmFsdWU/LigpID8/IChhd2FpdCB0aGlzLmFwcC52YXVsdC5jYWNoZWRSZWFkKHZpZXcuZmlsZSkpO1xuICAgIGNvbnN0IGJsb2NrcyA9IHBhcnNlTWFya2Rvd25Db2RlQmxvY2tzKHZpZXcuZmlsZS5wYXRoLCBzb3VyY2UsIHRoaXMuc2V0dGluZ3MpO1xuICAgIGlmICghYmxvY2tzLmxlbmd0aCkge1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGNvbnN0IHZpZXdTdGF0ZSA9IGxlYWYuZ2V0Vmlld1N0YXRlKCk7XG4gICAgY29uc3Qgc3RhdGUgPSB7IC4uLih2aWV3U3RhdGUuc3RhdGUgPz8ge30pIH0gYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj47XG4gICAgaWYgKHN0YXRlLm1vZGUgPT09IFwic291cmNlXCIgJiYgc3RhdGUuc291cmNlID09PSB0cnVlKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgc3RhdGUubW9kZSA9IFwic291cmNlXCI7XG4gICAgc3RhdGUuc291cmNlID0gdHJ1ZTtcblxuICAgIGF3YWl0IGxlYWYuc2V0Vmlld1N0YXRlKHtcbiAgICAgIC4uLnZpZXdTdGF0ZSxcbiAgICAgIHN0YXRlLFxuICAgIH0pO1xuICB9XG5cbiAgcHJpdmF0ZSBmaW5kQWN0aXZlQmxvY2tCeUlkKGJsb2NrSWQ6IHN0cmluZyk6IGxvb21Db2RlQmxvY2sgfCBudWxsIHtcbiAgICBjb25zdCB2aWV3ID0gdGhpcy5hcHAud29ya3NwYWNlLmdldEFjdGl2ZVZpZXdPZlR5cGUoTWFya2Rvd25WaWV3KTtcbiAgICBjb25zdCBmaWxlID0gdmlldz8uZmlsZTtcbiAgICBjb25zdCBlZGl0b3IgPSB2aWV3Py5lZGl0b3I7XG4gICAgaWYgKCFmaWxlIHx8ICFlZGl0b3IpIHtcbiAgICAgIHJldHVybiB0aGlzLm91dHB1dHMuZ2V0KGJsb2NrSWQpPy5ibG9jayA/PyBudWxsO1xuICAgIH1cblxuICAgIGNvbnN0IGJsb2NrcyA9IHBhcnNlTWFya2Rvd25Db2RlQmxvY2tzKGZpbGUucGF0aCwgZWRpdG9yLmdldFZhbHVlKCksIHRoaXMuc2V0dGluZ3MpO1xuICAgIHJldHVybiBibG9ja3MuZmluZCgoYmxvY2spID0+IGJsb2NrLmlkID09PSBibG9ja0lkKSA/PyB0aGlzLm91dHB1dHMuZ2V0KGJsb2NrSWQpPy5ibG9jayA/PyBudWxsO1xuICB9XG5cbiAgcHJpdmF0ZSBjcmVhdGVMaXZlUHJldmlld0V4dGVuc2lvbigpIHtcbiAgICBjb25zdCBwbHVnaW4gPSB0aGlzO1xuXG4gICAgcmV0dXJuIFZpZXdQbHVnaW4uZnJvbUNsYXNzKFxuICAgICAgY2xhc3Mge1xuICAgICAgICBkZWNvcmF0aW9ucztcblxuICAgICAgICBjb25zdHJ1Y3Rvcihwcml2YXRlIHJlYWRvbmx5IHZpZXc6IEVkaXRvclZpZXcpIHtcbiAgICAgICAgICBwbHVnaW4uZWRpdG9yVmlld3MuYWRkKHZpZXcpO1xuICAgICAgICAgIHRoaXMuZGVjb3JhdGlvbnMgPSB0aGlzLmJ1aWxkRGVjb3JhdGlvbnMoKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHVwZGF0ZSh1cGRhdGU6IFZpZXdVcGRhdGUpOiB2b2lkIHtcbiAgICAgICAgICBpZiAodXBkYXRlLmRvY0NoYW5nZWQgfHwgdXBkYXRlLnZpZXdwb3J0Q2hhbmdlZCB8fCB1cGRhdGUudHJhbnNhY3Rpb25zLnNvbWUoKHRyKSA9PiB0ci5lZmZlY3RzLnNvbWUoKGVmZmVjdCkgPT4gZWZmZWN0LmlzKGxvb21SZWZyZXNoRWZmZWN0KSkpKSB7XG4gICAgICAgICAgICB0aGlzLmRlY29yYXRpb25zID0gdGhpcy5idWlsZERlY29yYXRpb25zKCk7XG4gICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgZGVzdHJveSgpOiB2b2lkIHtcbiAgICAgICAgICBwbHVnaW4uZWRpdG9yVmlld3MuZGVsZXRlKHRoaXMudmlldyk7XG4gICAgICAgIH1cblxuICAgICAgICBwcml2YXRlIGJ1aWxkRGVjb3JhdGlvbnMoKSB7XG4gICAgICAgICAgY29uc3QgZmlsZVBhdGggPSBwbHVnaW4uZ2V0Q3VycmVudEVkaXRvckZpbGVQYXRoKCk7XG4gICAgICAgICAgaWYgKCFmaWxlUGF0aCkge1xuICAgICAgICAgICAgcmV0dXJuIERlY29yYXRpb24ubm9uZTtcbiAgICAgICAgICB9XG5cbiAgICAgICAgICBjb25zdCBzb3VyY2UgPSB0aGlzLnZpZXcuc3RhdGUuZG9jLnRvU3RyaW5nKCk7XG4gICAgICAgICAgY29uc3QgYmxvY2tzID0gcGFyc2VNYXJrZG93bkNvZGVCbG9ja3MoZmlsZVBhdGgsIHNvdXJjZSwgcGx1Z2luLnNldHRpbmdzKTtcbiAgICAgICAgICBjb25zdCBidWlsZGVyID0gbmV3IFJhbmdlU2V0QnVpbGRlcjxEZWNvcmF0aW9uPigpO1xuXG4gICAgICAgICAgZm9yIChjb25zdCBibG9jayBvZiBibG9ja3MpIHtcbiAgICAgICAgICAgIGNvbnN0IHN0YXJ0TGluZSA9IHRoaXMudmlldy5zdGF0ZS5kb2MubGluZShibG9jay5zdGFydExpbmUgKyAxKTtcbiAgICAgICAgICAgIGJ1aWxkZXIuYWRkKFxuICAgICAgICAgICAgICBzdGFydExpbmUuZnJvbSxcbiAgICAgICAgICAgICAgc3RhcnRMaW5lLmZyb20sXG4gICAgICAgICAgICAgIERlY29yYXRpb24ud2lkZ2V0KHtcbiAgICAgICAgICAgICAgICB3aWRnZXQ6IG5ldyBsb29tVG9vbGJhcldpZGdldChwbHVnaW4sIGJsb2NrKSxcbiAgICAgICAgICAgICAgICBzaWRlOiAtMSxcbiAgICAgICAgICAgICAgfSksXG4gICAgICAgICAgICApO1xuXG4gICAgICAgICAgICBpZiAocGx1Z2luLm91dHB1dHMuaGFzKGJsb2NrLmlkKSB8fCBwbHVnaW4ucnVubmluZy5oYXMoYmxvY2suaWQpKSB7XG4gICAgICAgICAgICAgIGNvbnN0IGVuZExpbmUgPSB0aGlzLnZpZXcuc3RhdGUuZG9jLmxpbmUoYmxvY2suZW5kTGluZSArIDEpO1xuICAgICAgICAgICAgICBidWlsZGVyLmFkZChcbiAgICAgICAgICAgICAgICBlbmRMaW5lLnRvLFxuICAgICAgICAgICAgICAgIGVuZExpbmUudG8sXG4gICAgICAgICAgICAgICAgRGVjb3JhdGlvbi53aWRnZXQoe1xuICAgICAgICAgICAgICAgICAgd2lkZ2V0OiBuZXcgbG9vbU91dHB1dFdpZGdldChwbHVnaW4sIGJsb2NrLmlkKSxcbiAgICAgICAgICAgICAgICAgIHNpZGU6IDEsXG4gICAgICAgICAgICAgICAgfSksXG4gICAgICAgICAgICAgICk7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGlmIChibG9jay5sYW5ndWFnZSA9PT0gXCJsbHZtLWlyXCIpIHtcbiAgICAgICAgICAgICAgYWRkTGx2bURlY29yYXRpb25zKGJ1aWxkZXIsIHRoaXMudmlldywgYmxvY2spO1xuICAgICAgICAgICAgfVxuICAgICAgICAgIH1cblxuICAgICAgICAgIHJldHVybiBidWlsZGVyLmZpbmlzaCgpO1xuICAgICAgICB9XG4gICAgICB9LFxuICAgICAge1xuICAgICAgICBkZWNvcmF0aW9uczogKHZhbHVlKSA9PiB2YWx1ZS5kZWNvcmF0aW9ucyxcbiAgICAgIH0sXG4gICAgKTtcbiAgfVxuXG4gIHByaXZhdGUgZ2V0Q3VzdG9tTGFuZ3VhZ2VFeHRyYWN0b3IobGFuZ3VhZ2VJZDogc3RyaW5nLCBmaWxlOiBURmlsZSk6IHsgbW9kZTogXCJjb21tYW5kXCIgfCBcInRyYW5zcGlsZS1jXCI7IGxhbmd1YWdlOiBzdHJpbmc7IGV4ZWN1dGFibGU6IHN0cmluZzsgYXJnczogc3RyaW5nW107IHdvcmtpbmdEaXJlY3Rvcnk6IHN0cmluZzsgdGltZW91dE1zOiBudW1iZXIgfSB8IHVuZGVmaW5lZCB7XG4gICAgY29uc3Qgbm9ybWFsaXplZCA9IGxhbmd1YWdlSWQudHJpbSgpLnRvTG93ZXJDYXNlKCk7XG4gICAgY29uc3QgbGFuZ3VhZ2UgPSB0aGlzLnNldHRpbmdzLmN1c3RvbUxhbmd1YWdlcy5maW5kKChjYW5kaWRhdGUpID0+IHtcbiAgICAgIGNvbnN0IG5hbWUgPSBjYW5kaWRhdGUubmFtZS50cmltKCkudG9Mb3dlckNhc2UoKTtcbiAgICAgIGNvbnN0IGFsaWFzZXMgPSBjYW5kaWRhdGUuYWxpYXNlc1xuICAgICAgICAuc3BsaXQoXCIsXCIpXG4gICAgICAgIC5tYXAoKGFsaWFzKSA9PiBhbGlhcy50cmltKCkudG9Mb3dlckNhc2UoKSlcbiAgICAgICAgLmZpbHRlcihCb29sZWFuKTtcbiAgICAgIHJldHVybiBuYW1lID09PSBub3JtYWxpemVkIHx8IGFsaWFzZXMuaW5jbHVkZXMobm9ybWFsaXplZCk7XG4gICAgfSk7XG4gICAgaWYgKCFsYW5ndWFnZSkge1xuICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICB9XG5cbiAgICBjb25zdCBtb2RlID0gbGFuZ3VhZ2UuZXh0cmFjdG9yTW9kZSB8fCBcImNvbW1hbmRcIjtcbiAgICBjb25zdCBleGVjdXRhYmxlID0gbW9kZSA9PT0gXCJ0cmFuc3BpbGUtY1wiID8gbGFuZ3VhZ2UudHJhbnNwaWxlRXhlY3V0YWJsZT8udHJpbSgpIDogbGFuZ3VhZ2UuZXh0cmFjdG9yRXhlY3V0YWJsZT8udHJpbSgpO1xuICAgIGNvbnN0IGFyZ3MgPSBtb2RlID09PSBcInRyYW5zcGlsZS1jXCIgPyBsYW5ndWFnZS50cmFuc3BpbGVBcmdzIHx8IFwie3JlcXVlc3R9XCIgOiBsYW5ndWFnZS5leHRyYWN0b3JBcmdzIHx8IFwie3JlcXVlc3R9XCI7XG4gICAgaWYgKCFleGVjdXRhYmxlKSB7XG4gICAgICByZXR1cm4gdW5kZWZpbmVkO1xuICAgIH1cblxuICAgIHJldHVybiB7XG4gICAgICBtb2RlLFxuICAgICAgbGFuZ3VhZ2U6IGxhbmd1YWdlLm5hbWUsXG4gICAgICBleGVjdXRhYmxlLFxuICAgICAgYXJnczogc3BsaXRDb21tYW5kTGluZShhcmdzKSxcbiAgICAgIHdvcmtpbmdEaXJlY3Rvcnk6IHRoaXMucmVzb2x2ZVdvcmtpbmdEaXJlY3RvcnkoZmlsZSksXG4gICAgICB0aW1lb3V0TXM6IHRoaXMuc2V0dGluZ3MuZGVmYXVsdFRpbWVvdXRNcyxcbiAgICB9O1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyB3cml0ZU1hbmFnZWRPdXRwdXRCbG9jayhmaWxlOiBURmlsZSwgYmxvY2s6IGxvb21Db2RlQmxvY2ssIHJlc3VsdDogbG9vbVN0b3JlZE91dHB1dFtcInJlc3VsdFwiXSk6IFByb21pc2U8dm9pZD4ge1xuICAgIGF3YWl0IHRoaXMuYXBwLnZhdWx0LnByb2Nlc3MoZmlsZSwgKGNvbnRlbnQpID0+IHtcbiAgICAgIGNvbnN0IGxpbmVzID0gY29udGVudC5zcGxpdCgvXFxyP1xcbi8pO1xuICAgICAgY29uc3QgYmxvY2tzID0gcGFyc2VNYXJrZG93bkNvZGVCbG9ja3MoZmlsZS5wYXRoLCBjb250ZW50LCB0aGlzLnNldHRpbmdzKTtcbiAgICAgIGNvbnN0IGN1cnJlbnRCbG9jayA9IGJsb2Nrcy5maW5kKChjYW5kaWRhdGUpID0+IGNhbmRpZGF0ZS5pZCA9PT0gYmxvY2suaWQpO1xuICAgICAgY29uc3QgcmVuZGVyZWQgPSB0aGlzLnJlbmRlck1hbmFnZWRPdXRwdXRNYXJrZG93bihibG9jay5pZCwgcmVzdWx0KTtcbiAgICAgIGNvbnN0IGV4aXN0aW5nUmFuZ2UgPSB0aGlzLmZpbmRNYW5hZ2VkT3V0cHV0UmFuZ2UobGluZXMsIGJsb2NrLmlkKTtcblxuICAgICAgaWYgKGV4aXN0aW5nUmFuZ2UpIHtcbiAgICAgICAgbGluZXMuc3BsaWNlKGV4aXN0aW5nUmFuZ2Uuc3RhcnQsIGV4aXN0aW5nUmFuZ2UuZW5kIC0gZXhpc3RpbmdSYW5nZS5zdGFydCArIDEsIC4uLnJlbmRlcmVkKTtcbiAgICAgICAgcmV0dXJuIGxpbmVzLmpvaW4oXCJcXG5cIik7XG4gICAgICB9XG5cbiAgICAgIGlmICghY3VycmVudEJsb2NrKSB7XG4gICAgICAgIHJldHVybiBjb250ZW50O1xuICAgICAgfVxuXG4gICAgICBsaW5lcy5zcGxpY2UoY3VycmVudEJsb2NrLmVuZExpbmUgKyAxLCAwLCAuLi5yZW5kZXJlZCk7XG4gICAgICByZXR1cm4gbGluZXMuam9pbihcIlxcblwiKTtcbiAgICB9KTtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgcmVtb3ZlTWFuYWdlZE91dHB1dEJsb2NrKGZpbGVQYXRoOiBzdHJpbmcsIGJsb2NrSWQ6IHN0cmluZyk6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IGZpbGUgPSB0aGlzLmFwcC52YXVsdC5nZXRBYnN0cmFjdEZpbGVCeVBhdGgoZmlsZVBhdGgpO1xuICAgIGlmICghKGZpbGUgaW5zdGFuY2VvZiBURmlsZSkpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBhd2FpdCB0aGlzLmFwcC52YXVsdC5wcm9jZXNzKGZpbGUsIChjb250ZW50KSA9PiB7XG4gICAgICBjb25zdCBsaW5lcyA9IGNvbnRlbnQuc3BsaXQoL1xccj9cXG4vKTtcbiAgICAgIGNvbnN0IHJhbmdlID0gdGhpcy5maW5kTWFuYWdlZE91dHB1dFJhbmdlKGxpbmVzLCBibG9ja0lkKTtcbiAgICAgIGlmICghcmFuZ2UpIHtcbiAgICAgICAgcmV0dXJuIGNvbnRlbnQ7XG4gICAgICB9XG4gICAgICBsaW5lcy5zcGxpY2UocmFuZ2Uuc3RhcnQsIHJhbmdlLmVuZCAtIHJhbmdlLnN0YXJ0ICsgMSk7XG4gICAgICByZXR1cm4gbGluZXMuam9pbihcIlxcblwiKTtcbiAgICB9KTtcbiAgfVxuXG4gIHByaXZhdGUgcmVuZGVyTWFuYWdlZE91dHB1dE1hcmtkb3duKGJsb2NrSWQ6IHN0cmluZywgcmVzdWx0OiBsb29tU3RvcmVkT3V0cHV0W1wicmVzdWx0XCJdKTogc3RyaW5nW10ge1xuICAgIGNvbnN0IGJvZHkgPSBbXG4gICAgICBgcnVubmVyPSR7cmVzdWx0LnJ1bm5lck5hbWV9YCxcbiAgICAgIGBleGl0PSR7cmVzdWx0LmV4aXRDb2RlID8/IFwiP1wifWAsXG4gICAgICBgZHVyYXRpb249JHtyZXN1bHQuZHVyYXRpb25Nc31tc2AsXG4gICAgICBgdGltZXN0YW1wPSR7cmVzdWx0LmZpbmlzaGVkQXR9YCxcbiAgICAgIHJlc3VsdC5zdGRvdXQgPyBgc3Rkb3V0OlxcbiR7cmVzdWx0LnN0ZG91dH1gIDogXCJcIixcbiAgICAgIHJlc3VsdC53YXJuaW5nID8gYHdhcm5pbmc6XFxuJHtyZXN1bHQud2FybmluZ31gIDogXCJcIixcbiAgICAgIHJlc3VsdC5zdGRlcnIgPyBgc3RkZXJyOlxcbiR7cmVzdWx0LnN0ZGVycn1gIDogXCJcIixcbiAgICBdXG4gICAgICAuZmlsdGVyKEJvb2xlYW4pXG4gICAgICAuam9pbihcIlxcblxcblwiKTtcblxuICAgIHJldHVybiBbXG4gICAgICBgPCEtLSBsb29tOm91dHB1dDpzdGFydCBpZD0ke2Jsb2NrSWR9IC0tPmAsXG4gICAgICBcImBgYHRleHRcIixcbiAgICAgIGJvZHksXG4gICAgICBcImBgYFwiLFxuICAgICAgXCI8IS0tIGxvb206b3V0cHV0OmVuZCAtLT5cIixcbiAgICBdO1xuICB9XG5cbiAgcHJpdmF0ZSBmaW5kTWFuYWdlZE91dHB1dFJhbmdlKGxpbmVzOiBzdHJpbmdbXSwgYmxvY2tJZDogc3RyaW5nKTogeyBzdGFydDogbnVtYmVyOyBlbmQ6IG51bWJlciB9IHwgbnVsbCB7XG4gICAgY29uc3Qgc3RhcnRNYXJrZXIgPSBgPCEtLSBsb29tOm91dHB1dDpzdGFydCBpZD0ke2Jsb2NrSWR9IC0tPmA7XG4gICAgZm9yIChsZXQgaSA9IDA7IGkgPCBsaW5lcy5sZW5ndGg7IGkgKz0gMSkge1xuICAgICAgaWYgKGxpbmVzW2ldLnRyaW0oKSAhPT0gc3RhcnRNYXJrZXIpIHtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG5cbiAgICAgIGZvciAobGV0IGogPSBpICsgMTsgaiA8IGxpbmVzLmxlbmd0aDsgaiArPSAxKSB7XG4gICAgICAgIGlmIChsaW5lc1tqXS50cmltKCkgPT09IFwiPCEtLSBsb29tOm91dHB1dDplbmQgLS0+XCIpIHtcbiAgICAgICAgICByZXR1cm4geyBzdGFydDogaSwgZW5kOiBqIH07XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cbn1cbiIsICJpbXBvcnQgeyBOb3RpY2UsIHR5cGUgQXBwLCB0eXBlIFRGaWxlIH0gZnJvbSBcIm9ic2lkaWFuXCI7XG5pbXBvcnQgeyBjbG9zZVN5bmMsIGV4aXN0c1N5bmMsIG9wZW5TeW5jIH0gZnJvbSBcImZzXCI7XG5pbXBvcnQgeyBta2RpciwgcmVhZEZpbGUsIHJlYWRkaXIsIHJtLCB3cml0ZUZpbGUgfSBmcm9tIFwiZnMvcHJvbWlzZXNcIjtcbmltcG9ydCB7IGJhc2VuYW1lLCBqb2luLCBub3JtYWxpemUgYXMgbm9ybWFsaXplRnNQYXRoLCBwb3NpeCBhcyBwb3NpeFBhdGggfSBmcm9tIFwicGF0aFwiO1xuaW1wb3J0IHsgc3Bhd24gfSBmcm9tIFwiY2hpbGRfcHJvY2Vzc1wiO1xuaW1wb3J0IHsgcnVuUHJvY2VzcyB9IGZyb20gXCIuL3Byb2Nlc3NSdW5uZXJcIjtcbmltcG9ydCB7IHNwbGl0Q29tbWFuZExpbmUgfSBmcm9tIFwiLi4vdXRpbHMvY29tbWFuZFwiO1xuaW1wb3J0IHR5cGUgeyBsb29tQ29kZUJsb2NrLCBsb29tUGx1Z2luU2V0dGluZ3MsIGxvb21SdW5Db250ZXh0LCBsb29tUnVuUmVzdWx0IH0gZnJvbSBcIi4uL3R5cGVzXCI7XG5cbnR5cGUgbG9vbUNvbnRhaW5lclJ1bnRpbWUgPSBcImRvY2tlclwiIHwgXCJwb2RtYW5cIiB8IFwicWVtdVwiIHwgXCJ3c2xcIiB8IFwiY3VzdG9tXCI7XG5cbmludGVyZmFjZSBsb29tQ29udGFpbmVyTGFuZ3VhZ2VDb25maWcge1xuICBjb21tYW5kPzogc3RyaW5nO1xuICBleHRlbnNpb24/OiBzdHJpbmc7XG4gIHVzZURlZmF1bHQ/OiBib29sZWFuO1xufVxuXG5pbnRlcmZhY2UgbG9vbUNvbW1hbmRFeHBlY3RhdGlvbiB7XG4gIGNvbW1hbmQ6IHN0cmluZztcbiAgcG9zaXRpdmVSZXNwb25zZT86IHN0cmluZztcbiAgbmVnYXRpdmVSZXNwb25zZT86IHN0cmluZztcbn1cblxuaW50ZXJmYWNlIGxvb21RZW11Q29uZmlnIHtcbiAgc3NoVGFyZ2V0OiBzdHJpbmc7XG4gIHJlbW90ZVdvcmtzcGFjZTogc3RyaW5nO1xuICBzc2hFeGVjdXRhYmxlPzogc3RyaW5nO1xuICBzc2hBcmdzPzogc3RyaW5nO1xuICBzdGFydENvbW1hbmQ/OiBzdHJpbmc7XG4gIGJ1aWxkQ29tbWFuZD86IHN0cmluZztcbiAgdGVhcmRvd25Db21tYW5kPzogc3RyaW5nO1xuICBoZWFsdGhDaGVjaz86IGxvb21Db21tYW5kRXhwZWN0YXRpb247XG4gIG1hbmFnZXI/OiBsb29tUWVtdU1hbmFnZXJDb25maWc7XG59XG5cbmludGVyZmFjZSBsb29tUWVtdU1hbmFnZXJDb25maWcge1xuICBlbmFibGVkOiBib29sZWFuO1xuICBleGVjdXRhYmxlPzogc3RyaW5nO1xuICBhcmdzPzogc3RyaW5nO1xuICBpbWFnZT86IHN0cmluZztcbiAgaW1hZ2VGb3JtYXQ/OiBzdHJpbmc7XG4gIHBpZEZpbGU/OiBzdHJpbmc7XG4gIGxvZ0ZpbGU/OiBzdHJpbmc7XG4gIHJlYWRpbmVzc1RpbWVvdXRNcz86IG51bWJlcjtcbiAgcmVhZGluZXNzSW50ZXJ2YWxNcz86IG51bWJlcjtcbiAgYm9vdERlbGF5TXM/OiBudW1iZXI7XG4gIHNodXRkb3duQ29tbWFuZD86IHN0cmluZztcbiAgc2h1dGRvd25UaW1lb3V0TXM/OiBudW1iZXI7XG4gIGtpbGxTaWduYWw/OiBOb2RlSlMuU2lnbmFscztcbiAgcGVyc2lzdD86IGJvb2xlYW47XG59XG5cbmludGVyZmFjZSBsb29tQ3VzdG9tUnVudGltZUNvbmZpZyB7XG4gIGV4ZWN1dGFibGU6IHN0cmluZztcbiAgYXJncz86IHN0cmluZztcbiAgYnVpbGQ/OiBzdHJpbmc7XG4gIGNvbW1hbmRTdHJ1Y3R1cmU/OiBzdHJpbmc7XG4gIHRlYXJkb3duPzogc3RyaW5nO1xuICBoZWFsdGhDaGVjaz86IGxvb21Db21tYW5kRXhwZWN0YXRpb247XG59XG5cbmludGVyZmFjZSBsb29tV3NsQ29uZmlnIHtcbiAgaW50ZXJhY3RpdmU/OiBib29sZWFuO1xufVxuXG5pbnRlcmZhY2UgbG9vbUNvbnRhaW5lckNvbmZpZyB7XG4gIHJ1bnRpbWU6IGxvb21Db250YWluZXJSdW50aW1lO1xuICBleGVjdXRhYmxlPzogc3RyaW5nO1xuICBpbWFnZT86IHN0cmluZztcbiAgd3NsPzogbG9vbVdzbENvbmZpZztcbiAgaGVhbHRoQ2hlY2s/OiBsb29tQ29tbWFuZEV4cGVjdGF0aW9uO1xuICBxZW11PzogbG9vbVFlbXVDb25maWc7XG4gIGN1c3RvbT86IGxvb21DdXN0b21SdW50aW1lQ29uZmlnO1xuICBsYW5ndWFnZXM6IFJlY29yZDxzdHJpbmcsIGxvb21Db250YWluZXJMYW5ndWFnZUNvbmZpZz47XG59XG5cbmludGVyZmFjZSBsb29tQ3VzdG9tUnVudGltZVJlcXVlc3Qge1xuICBhY3Rpb246IFwiYnVpbGRcIiB8IFwicnVuXCIgfCBcInRlYXJkb3duXCI7XG4gIGdyb3VwTmFtZTogc3RyaW5nO1xuICBncm91cFBhdGg6IHN0cmluZztcbiAgcnVudGltZTogbG9vbUNvbnRhaW5lclJ1bnRpbWU7XG4gIGltYWdlPzogc3RyaW5nO1xuICBidWlsZD86IHN0cmluZztcbiAgY29tbWFuZFN0cnVjdHVyZT86IHN0cmluZztcbiAgdGVhcmRvd24/OiBzdHJpbmc7XG4gIGxhbmd1YWdlPzogc3RyaW5nO1xuICBsYW5ndWFnZUFsaWFzPzogc3RyaW5nO1xuICBmaWxlTmFtZT86IHN0cmluZztcbiAgZmlsZVBhdGg/OiBzdHJpbmc7XG4gIGNvbW1hbmQ/OiBzdHJpbmc7XG4gIHRpbWVvdXRNczogbnVtYmVyO1xuICBjb25maWc6IHtcbiAgICBleGVjdXRhYmxlPzogc3RyaW5nO1xuICAgIGN1c3RvbT86IGxvb21DdXN0b21SdW50aW1lQ29uZmlnO1xuICAgIHFlbXU/OiBsb29tUWVtdUNvbmZpZztcbiAgICBoZWFsdGhDaGVjaz86IGxvb21Db21tYW5kRXhwZWN0YXRpb247XG4gIH07XG59XG5cbmV4cG9ydCBjbGFzcyBsb29tQ29udGFpbmVyUnVubmVyIHtcbiAgcHJpdmF0ZSByZWFkb25seSBidWlsdEltYWdlcyA9IG5ldyBTZXQ8c3RyaW5nPigpO1xuXG4gIGNvbnN0cnVjdG9yKFxuICAgIHByaXZhdGUgcmVhZG9ubHkgYXBwOiBBcHAsXG4gICAgcHJpdmF0ZSByZWFkb25seSBwbHVnaW5EaXI6IHN0cmluZyxcbiAgKSB7IH1cblxuICBnZXRDb250YWluZXJHcm91cE5hbWUoZmlsZTogVEZpbGUpOiBzdHJpbmcgfCBudWxsIHtcbiAgICBjb25zdCBmcm9udG1hdHRlciA9IHRoaXMuYXBwLm1ldGFkYXRhQ2FjaGUuZ2V0RmlsZUNhY2hlKGZpbGUpPy5mcm9udG1hdHRlcjtcbiAgICBjb25zdCB2YWx1ZSA9IGZyb250bWF0dGVyPy5bXCJsb29tLWNvbnRhaW5lclwiXTtcbiAgICByZXR1cm4gdHlwZW9mIHZhbHVlID09PSBcInN0cmluZ1wiICYmIHZhbHVlLnRyaW0oKSA/IHZhbHVlLnRyaW0oKSA6IG51bGw7XG4gIH1cblxuICBhc3luYyBnZXRHcm91cFN1bW1hcmllcygpOiBQcm9taXNlPEFycmF5PHsgbmFtZTogc3RyaW5nOyBzdGF0dXM6IHN0cmluZyB9Pj4ge1xuICAgIGNvbnN0IGNvbnRhaW5lcnNQYXRoID0gdGhpcy5nZXRDb250YWluZXJzUGF0aCgpO1xuICAgIGlmICghZXhpc3RzU3luYyhjb250YWluZXJzUGF0aCkpIHtcbiAgICAgIHJldHVybiBbXTtcbiAgICB9XG5cbiAgICBjb25zdCBlbnRyaWVzID0gYXdhaXQgcmVhZGRpcihjb250YWluZXJzUGF0aCwgeyB3aXRoRmlsZVR5cGVzOiB0cnVlIH0pO1xuICAgIHJldHVybiBQcm9taXNlLmFsbChcbiAgICAgIGVudHJpZXNcbiAgICAgICAgLmZpbHRlcigoZW50cnkpID0+IGVudHJ5LmlzRGlyZWN0b3J5KCkpXG4gICAgICAgIC5tYXAoYXN5bmMgKGVudHJ5KSA9PiB7XG4gICAgICAgICAgY29uc3QgZ3JvdXBQYXRoID0gam9pbihjb250YWluZXJzUGF0aCwgZW50cnkubmFtZSk7XG4gICAgICAgICAgY29uc3QgaGFzQ29uZmlnID0gZXhpc3RzU3luYyhqb2luKGdyb3VwUGF0aCwgXCJjb25maWcuanNvblwiKSk7XG4gICAgICAgICAgY29uc3QgaGFzRG9ja2VyZmlsZSA9IGV4aXN0c1N5bmMoam9pbihncm91cFBhdGgsIFwiRG9ja2VyZmlsZVwiKSk7XG4gICAgICAgICAgaWYgKCFoYXNDb25maWcpIHtcbiAgICAgICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICAgIG5hbWU6IGVudHJ5Lm5hbWUsXG4gICAgICAgICAgICAgIHN0YXR1czogXCJtaXNzaW5nIGNvbmZpZy5qc29uXCIsXG4gICAgICAgICAgICB9O1xuICAgICAgICAgIH1cbiAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgY29uc3QgY29uZmlnID0gYXdhaXQgdGhpcy5yZWFkQ29uZmlnKGdyb3VwUGF0aCk7XG4gICAgICAgICAgICBjb25zdCBwaWVjZXMgPSBbYHJ1bnRpbWU6ICR7Y29uZmlnLnJ1bnRpbWV9YF07XG4gICAgICAgICAgICBpZiAoKGNvbmZpZy5ydW50aW1lID09PSBcImRvY2tlclwiIHx8IGNvbmZpZy5ydW50aW1lID09PSBcInBvZG1hblwiKSAmJiBoYXNEb2NrZXJmaWxlKSB7XG4gICAgICAgICAgICAgIHBpZWNlcy5wdXNoKFwiRG9ja2VyZmlsZVwiKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmIChjb25maWcucnVudGltZSA9PT0gXCJxZW11XCIgJiYgY29uZmlnLnFlbXU/LnNzaFRhcmdldCkge1xuICAgICAgICAgICAgICBwaWVjZXMucHVzaChgc3NoOiAke2NvbmZpZy5xZW11LnNzaFRhcmdldH1gKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmIChjb25maWcucnVudGltZSA9PT0gXCJxZW11XCIgJiYgY29uZmlnLnFlbXU/Lm1hbmFnZXI/LmVuYWJsZWQpIHtcbiAgICAgICAgICAgICAgcGllY2VzLnB1c2goYG1hbmFnZXI6ICR7YXdhaXQgdGhpcy5nZXRNYW5hZ2VkUWVtdVN0YXR1cyhncm91cFBhdGgsIGNvbmZpZy5xZW11Lm1hbmFnZXIpfWApO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKGNvbmZpZy5ydW50aW1lID09PSBcImN1c3RvbVwiICYmIGNvbmZpZy5jdXN0b20/LmV4ZWN1dGFibGUpIHtcbiAgICAgICAgICAgICAgcGllY2VzLnB1c2goYHdyYXBwZXI6ICR7Y29uZmlnLmN1c3RvbS5leGVjdXRhYmxlfWApO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgY29uc3QgbGFuZ3VhZ2VDb3VudCA9IE9iamVjdC5rZXlzKGNvbmZpZy5sYW5ndWFnZXMpLmxlbmd0aDtcbiAgICAgICAgICAgIHBpZWNlcy5wdXNoKGAke2xhbmd1YWdlQ291bnR9IGxhbmd1YWdlJHtsYW5ndWFnZUNvdW50ID09PSAxID8gXCJcIiA6IFwic1wifWApO1xuICAgICAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgICAgbmFtZTogZW50cnkubmFtZSxcbiAgICAgICAgICAgICAgc3RhdHVzOiBwaWVjZXMuam9pbihcIiwgXCIpLFxuICAgICAgICAgICAgfTtcbiAgICAgICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgICAgbmFtZTogZW50cnkubmFtZSxcbiAgICAgICAgICAgICAgc3RhdHVzOiBgaW52YWxpZCBjb25maWcuanNvbjogJHtlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IubWVzc2FnZSA6IFN0cmluZyhlcnJvcil9YCxcbiAgICAgICAgICAgIH07XG4gICAgICAgICAgfVxuICAgICAgICB9KSxcbiAgICApO1xuICB9XG5cbiAgYXN5bmMgcnVuKGJsb2NrOiBsb29tQ29kZUJsb2NrLCBjb250ZXh0OiBsb29tUnVuQ29udGV4dCwgc2V0dGluZ3M6IGxvb21QbHVnaW5TZXR0aW5ncywgZ3JvdXBOYW1lOiBzdHJpbmcpOiBQcm9taXNlPGxvb21SdW5SZXN1bHQ+IHtcbiAgICBjb25zdCBncm91cFBhdGggPSB0aGlzLnJlc29sdmVHcm91cFBhdGgoZ3JvdXBOYW1lKTtcbiAgICBjb25zdCBjb25maWcgPSBhd2FpdCB0aGlzLnJlYWRDb25maWcoZ3JvdXBQYXRoKTtcbiAgICBjb25zdCBjb25maWdMYW5nID0gY29uZmlnLmxhbmd1YWdlc1tibG9jay5sYW5ndWFnZV0gPz8gY29uZmlnLmxhbmd1YWdlc1tibG9jay5sYW5ndWFnZUFsaWFzXTtcblxuICAgIGxldCBpc0ZhbGxiYWNrID0gZmFsc2U7XG4gICAgbGV0IGxhbmd1YWdlOiBsb29tQ29udGFpbmVyTGFuZ3VhZ2VDb25maWcgfCBudWxsID0gbnVsbDtcblxuICAgIGlmIChjb25maWdMYW5nKSB7XG4gICAgICBpZiAoY29uZmlnTGFuZy51c2VEZWZhdWx0KSB7XG4gICAgICAgIGxhbmd1YWdlID0gdGhpcy5nZXREZWZhdWx0TGFuZ3VhZ2VDb25maWcoYmxvY2subGFuZ3VhZ2UsIHNldHRpbmdzKSA/PyB0aGlzLmdldERlZmF1bHRMYW5ndWFnZUNvbmZpZyhibG9jay5sYW5ndWFnZUFsaWFzLCBzZXR0aW5ncyk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBsYW5ndWFnZSA9IGNvbmZpZ0xhbmc7XG4gICAgICB9XG4gICAgfSBlbHNlIHtcbiAgICAgIGxhbmd1YWdlID0gdGhpcy5nZXREZWZhdWx0TGFuZ3VhZ2VDb25maWcoYmxvY2subGFuZ3VhZ2UsIHNldHRpbmdzKSA/PyB0aGlzLmdldERlZmF1bHRMYW5ndWFnZUNvbmZpZyhibG9jay5sYW5ndWFnZUFsaWFzLCBzZXR0aW5ncyk7XG4gICAgICBpc0ZhbGxiYWNrID0gdHJ1ZTtcbiAgICB9XG5cbiAgICBpZiAoIWxhbmd1YWdlIHx8ICFsYW5ndWFnZS5jb21tYW5kIHx8ICFsYW5ndWFnZS5leHRlbnNpb24pIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgQ29udGFpbmVyIGdyb3VwICR7Z3JvdXBOYW1lfSBoYXMgbm8gY29tbWFuZCBmb3IgJHtibG9jay5sYW5ndWFnZX0uYCk7XG4gICAgfVxuXG4gICAgYXdhaXQgbWtkaXIoZ3JvdXBQYXRoLCB7IHJlY3Vyc2l2ZTogdHJ1ZSB9KTtcbiAgICBhd2FpdCB0aGlzLnJ1bkhlYWx0aENoZWNrKGNvbmZpZy5oZWFsdGhDaGVjaywgZ3JvdXBQYXRoLCBjb250ZXh0LnRpbWVvdXRNcywgY29udGV4dC5zaWduYWwsIGBjb250YWluZXI6JHtncm91cE5hbWV9OmhlYWx0aGAsIGBDb250YWluZXIgJHtncm91cE5hbWV9IGhlYWx0aCBjaGVja2ApO1xuICAgIGNvbnN0IHRlbXBGaWxlTmFtZSA9IGB0ZW1wXyR7RGF0ZS5ub3coKX1fJHtNYXRoLnJhbmRvbSgpLnRvU3RyaW5nKDE2KS5zbGljZSgyKX0ke25vcm1hbGl6ZUV4dGVuc2lvbihsYW5ndWFnZS5leHRlbnNpb24pfWA7XG4gICAgY29uc3QgdGVtcEZpbGVQYXRoID0gam9pbihncm91cFBhdGgsIHRlbXBGaWxlTmFtZSk7XG5cbiAgICB0cnkge1xuICAgICAgYXdhaXQgd3JpdGVGaWxlKHRlbXBGaWxlUGF0aCwgYmxvY2suY29udGVudCwgXCJ1dGY4XCIpO1xuICAgICAgbGV0IHJlc3VsdDogbG9vbVJ1blJlc3VsdDtcbiAgICAgIHN3aXRjaCAoY29uZmlnLnJ1bnRpbWUpIHtcbiAgICAgICAgY2FzZSBcImRvY2tlclwiOlxuICAgICAgICBjYXNlIFwicG9kbWFuXCI6XG4gICAgICAgICAgcmVzdWx0ID0gYXdhaXQgdGhpcy5ydW5PY2lDb250YWluZXIoZ3JvdXBOYW1lLCBncm91cFBhdGgsIGNvbmZpZywgbGFuZ3VhZ2UsIHRlbXBGaWxlTmFtZSwgY29udGV4dCwgc2V0dGluZ3MpO1xuICAgICAgICAgIGJyZWFrO1xuICAgICAgICBjYXNlIFwicWVtdVwiOlxuICAgICAgICAgIHJlc3VsdCA9IGF3YWl0IHRoaXMucnVuUWVtdShncm91cE5hbWUsIGdyb3VwUGF0aCwgY29uZmlnLCBsYW5ndWFnZSwgdGVtcEZpbGVOYW1lLCBjb250ZXh0KTtcbiAgICAgICAgICBicmVhaztcbiAgICAgICAgY2FzZSBcImN1c3RvbVwiOlxuICAgICAgICAgIHJlc3VsdCA9IGF3YWl0IHRoaXMucnVuQ3VzdG9tKGdyb3VwTmFtZSwgZ3JvdXBQYXRoLCBjb25maWcsIGJsb2NrLCBsYW5ndWFnZSwgdGVtcEZpbGVOYW1lLCB0ZW1wRmlsZVBhdGgsIGNvbnRleHQpO1xuICAgICAgICAgIGJyZWFrO1xuICAgICAgICBjYXNlIFwid3NsXCI6XG4gICAgICAgICAgcmVzdWx0ID0gYXdhaXQgdGhpcy5ydW5Xc2xDb250YWluZXIoZ3JvdXBOYW1lLCBncm91cFBhdGgsIGNvbmZpZywgbGFuZ3VhZ2UsIHRlbXBGaWxlTmFtZSwgY29udGV4dCk7XG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgIGRlZmF1bHQ6XG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBVbnN1cHBvcnRlZCBydW50aW1lOiAke2NvbmZpZy5ydW50aW1lfWApO1xuICAgICAgfVxuXG4gICAgICBpZiAoaXNGYWxsYmFjaykge1xuICAgICAgICBjb25zdCBmYWxsYmFja01zZyA9IGBbTG9vbV0gTGFuZ3VhZ2UgJyR7YmxvY2subGFuZ3VhZ2V9JyB3YXMgbm90IGRlY2xhcmVkIGluIGNvbnRhaW5lciBncm91cC4gUnVubmluZyB1c2luZyBkZWZhdWx0IGNvbW1hbmQ6ICR7bGFuZ3VhZ2UuY29tbWFuZH1gO1xuICAgICAgICByZXN1bHQud2FybmluZyA9IHJlc3VsdC53YXJuaW5nID8gYCR7cmVzdWx0Lndhcm5pbmd9XFxuJHtmYWxsYmFja01zZ31gIDogZmFsbGJhY2tNc2c7XG4gICAgICB9XG4gICAgICByZXR1cm4gcmVzdWx0O1xuICAgIH0gZmluYWxseSB7XG4gICAgICBhd2FpdCBybSh0ZW1wRmlsZVBhdGgsIHsgZm9yY2U6IHRydWUgfSk7XG4gICAgfVxuICB9XG5cbiAgYXN5bmMgYnVpbGRHcm91cChncm91cE5hbWU6IHN0cmluZywgdGltZW91dE1zOiBudW1iZXIsIHNpZ25hbDogQWJvcnRTaWduYWwpOiBQcm9taXNlPGxvb21SdW5SZXN1bHQ+IHtcbiAgICBjb25zdCBncm91cFBhdGggPSB0aGlzLnJlc29sdmVHcm91cFBhdGgoZ3JvdXBOYW1lKTtcbiAgICBjb25zdCBjb25maWcgPSBhd2FpdCB0aGlzLnJlYWRDb25maWcoZ3JvdXBQYXRoKTtcbiAgICBhd2FpdCBta2Rpcihncm91cFBhdGgsIHsgcmVjdXJzaXZlOiB0cnVlIH0pO1xuICAgIGF3YWl0IHRoaXMucnVuSGVhbHRoQ2hlY2soY29uZmlnLmhlYWx0aENoZWNrLCBncm91cFBhdGgsIHRpbWVvdXRNcywgc2lnbmFsLCBgY29udGFpbmVyOiR7Z3JvdXBOYW1lfTpoZWFsdGhgLCBgQ29udGFpbmVyICR7Z3JvdXBOYW1lfSBoZWFsdGggY2hlY2tgKTtcbiAgICBzd2l0Y2ggKGNvbmZpZy5ydW50aW1lKSB7XG4gICAgICBjYXNlIFwiZG9ja2VyXCI6XG4gICAgICBjYXNlIFwicG9kbWFuXCI6XG4gICAgICAgIHJldHVybiB0aGlzLmJ1aWxkSW1hZ2UoZ3JvdXBOYW1lLCBncm91cFBhdGgsIGNvbmZpZywgdGltZW91dE1zLCBzaWduYWwpO1xuICAgICAgY2FzZSBcInFlbXVcIjpcbiAgICAgICAgcmV0dXJuIHRoaXMuYnVpbGRRZW11KGdyb3VwTmFtZSwgZ3JvdXBQYXRoLCBjb25maWcsIHRpbWVvdXRNcywgc2lnbmFsKTtcbiAgICAgIGNhc2UgXCJjdXN0b21cIjpcbiAgICAgICAgcmV0dXJuIHRoaXMucnVuQ3VzdG9tV3JhcHBlcihncm91cE5hbWUsIGdyb3VwUGF0aCwgY29uZmlnLCB0aGlzLmNyZWF0ZUN1c3RvbVJlcXVlc3QoXCJidWlsZFwiLCBncm91cE5hbWUsIGdyb3VwUGF0aCwgY29uZmlnLCB0aW1lb3V0TXMpLCB0aW1lb3V0TXMsIHNpZ25hbCk7XG4gICAgICBjYXNlIFwid3NsXCI6XG4gICAgICAgIHJldHVybiB0aGlzLmNyZWF0ZVN5bnRoZXRpY1Jlc3VsdChcbiAgICAgICAgICBgY29udGFpbmVyOiR7Z3JvdXBOYW1lfTp3c2w6YnVpbGRgLFxuICAgICAgICAgIGBXU0wgJHtncm91cE5hbWV9IGJ1aWxkYCxcbiAgICAgICAgICBgV1NMIGVudmlyb25tZW50ICR7Y29uZmlnLmltYWdlIHx8IFwiKGRlZmF1bHQpXCJ9IGRvZXMgbm90IHJlcXVpcmUgYSBidWlsZCBzdGVwLlxcbmAsXG4gICAgICAgICk7XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBydW5PY2lDb250YWluZXIoXG4gICAgZ3JvdXBOYW1lOiBzdHJpbmcsXG4gICAgZ3JvdXBQYXRoOiBzdHJpbmcsXG4gICAgY29uZmlnOiBsb29tQ29udGFpbmVyQ29uZmlnLFxuICAgIGxhbmd1YWdlOiBsb29tQ29udGFpbmVyTGFuZ3VhZ2VDb25maWcsXG4gICAgdGVtcEZpbGVOYW1lOiBzdHJpbmcsXG4gICAgY29udGV4dDogbG9vbVJ1bkNvbnRleHQsXG4gICAgc2V0dGluZ3M6IGxvb21QbHVnaW5TZXR0aW5ncyxcbiAgKTogUHJvbWlzZTxsb29tUnVuUmVzdWx0PiB7XG4gICAgY29uc3QgaW1hZ2UgPSBhd2FpdCB0aGlzLnJlc29sdmVJbWFnZShncm91cE5hbWUsIGdyb3VwUGF0aCwgY29uZmlnLCBjb250ZXh0LCBzZXR0aW5ncyk7XG4gICAgY29uc3QgY29tbWFuZCA9IHNwbGl0Q29tbWFuZExpbmUobGFuZ3VhZ2UuY29tbWFuZCEucmVwbGFjZUFsbChcIntmaWxlfVwiLCB0ZW1wRmlsZU5hbWUpKTtcbiAgICBpZiAoIWNvbW1hbmQubGVuZ3RoKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJDb250YWluZXIgY29tbWFuZCBpcyBlbXB0eS5cIik7XG4gICAgfVxuXG4gICAgcmV0dXJuIGF3YWl0IHJ1blByb2Nlc3Moe1xuICAgICAgcnVubmVySWQ6IGBjb250YWluZXI6JHtncm91cE5hbWV9YCxcbiAgICAgIHJ1bm5lck5hbWU6IGAke3J1bnRpbWVMYWJlbChjb25maWcucnVudGltZSl9ICR7Z3JvdXBOYW1lfWAsXG4gICAgICBleGVjdXRhYmxlOiB0aGlzLnJ1bnRpbWVFeGVjdXRhYmxlKGNvbmZpZyksXG4gICAgICBhcmdzOiBbXG4gICAgICAgIFwicnVuXCIsXG4gICAgICAgIFwiLS1ybVwiLFxuICAgICAgICBcIi12XCIsXG4gICAgICAgIGAke2dyb3VwUGF0aH06L3dvcmtzcGFjZWAsXG4gICAgICAgIFwiLXdcIixcbiAgICAgICAgXCIvd29ya3NwYWNlXCIsXG4gICAgICAgIGltYWdlLFxuICAgICAgICAuLi5jb21tYW5kLFxuICAgICAgXSxcbiAgICAgIHdvcmtpbmdEaXJlY3Rvcnk6IGdyb3VwUGF0aCxcbiAgICAgIHRpbWVvdXRNczogY29udGV4dC50aW1lb3V0TXMsXG4gICAgICBzaWduYWw6IGNvbnRleHQuc2lnbmFsLFxuICAgIH0pO1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBydW5RZW11KFxuICAgIGdyb3VwTmFtZTogc3RyaW5nLFxuICAgIGdyb3VwUGF0aDogc3RyaW5nLFxuICAgIGNvbmZpZzogbG9vbUNvbnRhaW5lckNvbmZpZyxcbiAgICBsYW5ndWFnZTogbG9vbUNvbnRhaW5lckxhbmd1YWdlQ29uZmlnLFxuICAgIHRlbXBGaWxlTmFtZTogc3RyaW5nLFxuICAgIGNvbnRleHQ6IGxvb21SdW5Db250ZXh0LFxuICApOiBQcm9taXNlPGxvb21SdW5SZXN1bHQ+IHtcbiAgICBjb25zdCBxZW11ID0gdGhpcy5yZXF1aXJlUWVtdUNvbmZpZyhjb25maWcpO1xuICAgIGF3YWl0IHRoaXMucnVuT3B0aW9uYWxDb21tYW5kKHFlbXUuc3RhcnRDb21tYW5kLCBncm91cFBhdGgsIGNvbnRleHQudGltZW91dE1zLCBjb250ZXh0LnNpZ25hbCwgYGNvbnRhaW5lcjoke2dyb3VwTmFtZX06cWVtdTpzdGFydGAsIGBRRU1VICR7Z3JvdXBOYW1lfSBzdGFydGApO1xuICAgIGF3YWl0IHRoaXMuZW5zdXJlTWFuYWdlZFFlbXUoZ3JvdXBOYW1lLCBncm91cFBhdGgsIHFlbXUsIGNvbnRleHQudGltZW91dE1zLCBjb250ZXh0LnNpZ25hbCk7XG4gICAgYXdhaXQgdGhpcy5ydW5IZWFsdGhDaGVjayhxZW11LmhlYWx0aENoZWNrLCBncm91cFBhdGgsIGNvbnRleHQudGltZW91dE1zLCBjb250ZXh0LnNpZ25hbCwgYGNvbnRhaW5lcjoke2dyb3VwTmFtZX06cWVtdTpoZWFsdGhgLCBgUUVNVSAke2dyb3VwTmFtZX0gaGVhbHRoIGNoZWNrYCk7XG5cbiAgICB0cnkge1xuICAgICAgY29uc3QgcmVtb3RlRmlsZSA9IHBvc2l4UGF0aC5qb2luKHFlbXUucmVtb3RlV29ya3NwYWNlLCB0ZW1wRmlsZU5hbWUpO1xuICAgICAgY29uc3QgcmVtb3RlQ29tbWFuZCA9IGxhbmd1YWdlLmNvbW1hbmQhLnJlcGxhY2VBbGwoXCJ7ZmlsZX1cIiwgc2hlbGxRdW90ZShyZW1vdGVGaWxlKSk7XG4gICAgICBpZiAoIXJlbW90ZUNvbW1hbmQudHJpbSgpKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihcIlFFTVUgY29tbWFuZCBpcyBlbXB0eS5cIik7XG4gICAgICB9XG5cbiAgICAgIHJldHVybiBhd2FpdCBydW5Qcm9jZXNzKHtcbiAgICAgICAgcnVubmVySWQ6IGBjb250YWluZXI6JHtncm91cE5hbWV9OnFlbXVgLFxuICAgICAgICBydW5uZXJOYW1lOiBgUUVNVSAke2dyb3VwTmFtZX1gLFxuICAgICAgICBleGVjdXRhYmxlOiBxZW11LnNzaEV4ZWN1dGFibGUgfHwgXCJzc2hcIixcbiAgICAgICAgYXJnczogW1xuICAgICAgICAgIC4uLnNwbGl0Q29tbWFuZExpbmUocWVtdS5zc2hBcmdzIHx8IFwiXCIpLFxuICAgICAgICAgIHFlbXUuc3NoVGFyZ2V0LFxuICAgICAgICAgIGBjZCAke3NoZWxsUXVvdGUocWVtdS5yZW1vdGVXb3Jrc3BhY2UpfSAmJiAke3JlbW90ZUNvbW1hbmR9YCxcbiAgICAgICAgXSxcbiAgICAgICAgd29ya2luZ0RpcmVjdG9yeTogZ3JvdXBQYXRoLFxuICAgICAgICB0aW1lb3V0TXM6IGNvbnRleHQudGltZW91dE1zLFxuICAgICAgICBzaWduYWw6IGNvbnRleHQuc2lnbmFsLFxuICAgICAgfSk7XG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIGF3YWl0IHRoaXMucnVuT3B0aW9uYWxDb21tYW5kKHFlbXUudGVhcmRvd25Db21tYW5kLCBncm91cFBhdGgsIGNvbnRleHQudGltZW91dE1zLCBjb250ZXh0LnNpZ25hbCwgYGNvbnRhaW5lcjoke2dyb3VwTmFtZX06cWVtdTp0ZWFyZG93bmAsIGBRRU1VICR7Z3JvdXBOYW1lfSB0ZWFyZG93bmApO1xuICAgICAgYXdhaXQgdGhpcy5zdG9wTWFuYWdlZFFlbXVJZk5lZWRlZChncm91cE5hbWUsIGdyb3VwUGF0aCwgcWVtdSwgY29udGV4dC50aW1lb3V0TXMsIGNvbnRleHQuc2lnbmFsKTtcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIHJ1bkN1c3RvbShcbiAgICBncm91cE5hbWU6IHN0cmluZyxcbiAgICBncm91cFBhdGg6IHN0cmluZyxcbiAgICBjb25maWc6IGxvb21Db250YWluZXJDb25maWcsXG4gICAgYmxvY2s6IGxvb21Db2RlQmxvY2ssXG4gICAgbGFuZ3VhZ2U6IGxvb21Db250YWluZXJMYW5ndWFnZUNvbmZpZyxcbiAgICB0ZW1wRmlsZU5hbWU6IHN0cmluZyxcbiAgICB0ZW1wRmlsZVBhdGg6IHN0cmluZyxcbiAgICBjb250ZXh0OiBsb29tUnVuQ29udGV4dCxcbiAgKTogUHJvbWlzZTxsb29tUnVuUmVzdWx0PiB7XG4gICAgY29uc3QgY29tbWFuZCA9IGxhbmd1YWdlLmNvbW1hbmQhLnJlcGxhY2VBbGwoXCJ7ZmlsZX1cIiwgdGVtcEZpbGVOYW1lKTtcbiAgICBjb25zdCByZXN1bHQgPSBhd2FpdCB0aGlzLnJ1bkN1c3RvbVdyYXBwZXIoXG4gICAgICBncm91cE5hbWUsXG4gICAgICBncm91cFBhdGgsXG4gICAgICBjb25maWcsXG4gICAgICB0aGlzLmNyZWF0ZUN1c3RvbVJlcXVlc3QoXCJydW5cIiwgZ3JvdXBOYW1lLCBncm91cFBhdGgsIGNvbmZpZywgY29udGV4dC50aW1lb3V0TXMsIHtcbiAgICAgICAgbGFuZ3VhZ2U6IGJsb2NrLmxhbmd1YWdlLFxuICAgICAgICBsYW5ndWFnZUFsaWFzOiBibG9jay5sYW5ndWFnZUFsaWFzLFxuICAgICAgICBmaWxlTmFtZTogdGVtcEZpbGVOYW1lLFxuICAgICAgICBmaWxlUGF0aDogdGVtcEZpbGVQYXRoLFxuICAgICAgICBjb21tYW5kLFxuICAgICAgfSksXG4gICAgICBjb250ZXh0LnRpbWVvdXRNcyxcbiAgICAgIGNvbnRleHQuc2lnbmFsLFxuICAgICk7XG5cbiAgICBpZiAoY29uZmlnLmN1c3RvbT8udGVhcmRvd24pIHtcbiAgICAgIGNvbnN0IHRlYXJkb3duID0gYXdhaXQgdGhpcy5ydW5DdXN0b21XcmFwcGVyKFxuICAgICAgICBncm91cE5hbWUsXG4gICAgICAgIGdyb3VwUGF0aCxcbiAgICAgICAgY29uZmlnLFxuICAgICAgICB0aGlzLmNyZWF0ZUN1c3RvbVJlcXVlc3QoXCJ0ZWFyZG93blwiLCBncm91cE5hbWUsIGdyb3VwUGF0aCwgY29uZmlnLCBjb250ZXh0LnRpbWVvdXRNcywge1xuICAgICAgICAgIGxhbmd1YWdlOiBibG9jay5sYW5ndWFnZSxcbiAgICAgICAgICBsYW5ndWFnZUFsaWFzOiBibG9jay5sYW5ndWFnZUFsaWFzLFxuICAgICAgICAgIGZpbGVOYW1lOiB0ZW1wRmlsZU5hbWUsXG4gICAgICAgICAgZmlsZVBhdGg6IHRlbXBGaWxlUGF0aCxcbiAgICAgICAgICBjb21tYW5kLFxuICAgICAgICB9KSxcbiAgICAgICAgY29udGV4dC50aW1lb3V0TXMsXG4gICAgICAgIGNvbnRleHQuc2lnbmFsLFxuICAgICAgKTtcbiAgICAgIGlmICghdGVhcmRvd24uc3VjY2Vzcykge1xuICAgICAgICByZXN1bHQud2FybmluZyA9IGBDdXN0b20gcnVudGltZSB0ZWFyZG93biBmYWlsZWQ6ICR7dGVhcmRvd24uc3RkZXJyIHx8IHRlYXJkb3duLnN0ZG91dCB8fCBgZXhpdCAke3RlYXJkb3duLmV4aXRDb2RlfWB9YDtcbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gcmVzdWx0O1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBydW5Xc2xDb250YWluZXIoXG4gICAgZ3JvdXBOYW1lOiBzdHJpbmcsXG4gICAgZ3JvdXBQYXRoOiBzdHJpbmcsXG4gICAgY29uZmlnOiBsb29tQ29udGFpbmVyQ29uZmlnLFxuICAgIGxhbmd1YWdlOiBsb29tQ29udGFpbmVyTGFuZ3VhZ2VDb25maWcsXG4gICAgdGVtcEZpbGVOYW1lOiBzdHJpbmcsXG4gICAgY29udGV4dDogbG9vbVJ1bkNvbnRleHQsXG4gICk6IFByb21pc2U8bG9vbVJ1blJlc3VsdD4ge1xuICAgIGNvbnN0IHdzbEdyb3VwUGF0aCA9IHRoaXMudHJhbnNsYXRlVG9Xc2xQYXRoKGdyb3VwUGF0aCk7XG4gICAgY29uc3QgY29tbWFuZCA9IGxhbmd1YWdlLmNvbW1hbmQhLnJlcGxhY2VBbGwoXCJ7ZmlsZX1cIiwgdGVtcEZpbGVOYW1lKTtcbiAgICBpZiAoIWNvbW1hbmQudHJpbSgpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJXU0wgY29tbWFuZCBpcyBlbXB0eS5cIik7XG4gICAgfVxuXG4gICAgY29uc3Qgc2hlbGxGbGFncyA9IGNvbmZpZy53c2w/LmludGVyYWN0aXZlID8gW1wiLWlcIiwgXCItbFwiLCBcIi1jXCJdIDogW1wiLWxcIiwgXCItY1wiXTtcbiAgICBjb25zdCB3c2xBcmdzID0gW1wiYmFzaFwiLCAuLi5zaGVsbEZsYWdzLCBgY2QgXCIke3dzbEdyb3VwUGF0aC5yZXBsYWNlQWxsKCdcIicsICdcXFxcXCInKX1cIiAmJiAke2NvbW1hbmR9YF07XG4gICAgaWYgKGNvbmZpZy5pbWFnZT8udHJpbSgpKSB7XG4gICAgICB3c2xBcmdzLnVuc2hpZnQoXCItZFwiLCBjb25maWcuaW1hZ2UudHJpbSgpKTtcbiAgICB9XG5cbiAgICByZXR1cm4gYXdhaXQgcnVuUHJvY2Vzcyh7XG4gICAgICBydW5uZXJJZDogYGNvbnRhaW5lcjoke2dyb3VwTmFtZX06d3NsYCxcbiAgICAgIHJ1bm5lck5hbWU6IGBXU0wgJHtncm91cE5hbWV9YCxcbiAgICAgIGV4ZWN1dGFibGU6IFwid3NsXCIsXG4gICAgICBhcmdzOiB3c2xBcmdzLFxuICAgICAgd29ya2luZ0RpcmVjdG9yeTogZ3JvdXBQYXRoLFxuICAgICAgdGltZW91dE1zOiBjb250ZXh0LnRpbWVvdXRNcyxcbiAgICAgIHNpZ25hbDogY29udGV4dC5zaWduYWwsXG4gICAgfSk7XG4gIH1cblxuICBwcml2YXRlIHRyYW5zbGF0ZVRvV3NsUGF0aCh3aW5kb3dzUGF0aDogc3RyaW5nKTogc3RyaW5nIHtcbiAgICBjb25zdCBtYXRjaCA9IHdpbmRvd3NQYXRoLm1hdGNoKC9eKFtBLVphLXpdKTpcXFxcKC4qKS8pO1xuICAgIGlmIChtYXRjaCkge1xuICAgICAgY29uc3QgZHJpdmUgPSBtYXRjaFsxXS50b0xvd2VyQ2FzZSgpO1xuICAgICAgY29uc3QgcmVzdCA9IG1hdGNoWzJdLnJlcGxhY2UoL1xcXFwvZywgXCIvXCIpO1xuICAgICAgcmV0dXJuIGAvbW50LyR7ZHJpdmV9LyR7cmVzdH1gO1xuICAgIH1cbiAgICBpZiAod2luZG93c1BhdGguaW5jbHVkZXMoXCJcXFxcXCIpKSB7XG4gICAgICByZXR1cm4gd2luZG93c1BhdGgucmVwbGFjZSgvXFxcXC9nLCBcIi9cIik7XG4gICAgfVxuICAgIHJldHVybiB3aW5kb3dzUGF0aDtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgcmVzb2x2ZUltYWdlKFxuICAgIGdyb3VwTmFtZTogc3RyaW5nLFxuICAgIGdyb3VwUGF0aDogc3RyaW5nLFxuICAgIGNvbmZpZzogbG9vbUNvbnRhaW5lckNvbmZpZyxcbiAgICBjb250ZXh0OiBsb29tUnVuQ29udGV4dCxcbiAgICBzZXR0aW5nczogbG9vbVBsdWdpblNldHRpbmdzLFxuICApOiBQcm9taXNlPHN0cmluZz4ge1xuICAgIGNvbnN0IGRvY2tlcmZpbGUgPSBqb2luKGdyb3VwUGF0aCwgXCJEb2NrZXJmaWxlXCIpO1xuICAgIGlmICghZXhpc3RzU3luYyhkb2NrZXJmaWxlKSkge1xuICAgICAgcmV0dXJuIGNvbmZpZy5pbWFnZSB8fCBcInVidW50dTpsYXRlc3RcIjtcbiAgICB9XG5cbiAgICBjb25zdCBpbWFnZSA9IHRoaXMuaW1hZ2VOYW1lRm9yR3JvdXAoZ3JvdXBOYW1lKTtcbiAgICBjb25zdCBjYWNoZUtleSA9IGAke3RoaXMucnVudGltZUV4ZWN1dGFibGUoY29uZmlnKX06JHtpbWFnZX1gO1xuICAgIGlmICh0aGlzLmJ1aWx0SW1hZ2VzLmhhcyhjYWNoZUtleSkpIHtcbiAgICAgIHJldHVybiBpbWFnZTtcbiAgICB9XG5cbiAgICBjb25zdCByZXN1bHQgPSBhd2FpdCB0aGlzLmJ1aWxkSW1hZ2UoZ3JvdXBOYW1lLCBncm91cFBhdGgsIGNvbmZpZywgTWF0aC5tYXgoY29udGV4dC50aW1lb3V0TXMsIHNldHRpbmdzLmRlZmF1bHRUaW1lb3V0TXMsIDEyMF8wMDApLCBjb250ZXh0LnNpZ25hbCk7XG4gICAgaWYgKCFyZXN1bHQuc3VjY2Vzcykge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKHJlc3VsdC5zdGRlcnIgfHwgcmVzdWx0LnN0ZG91dCB8fCBgJHtydW50aW1lTGFiZWwoY29uZmlnLnJ1bnRpbWUpfSBidWlsZCBmYWlsZWQgZm9yICR7Z3JvdXBOYW1lfS5gKTtcbiAgICB9XG5cbiAgICB0aGlzLmJ1aWx0SW1hZ2VzLmFkZChjYWNoZUtleSk7XG4gICAgcmV0dXJuIGltYWdlO1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBidWlsZEltYWdlKFxuICAgIGdyb3VwTmFtZTogc3RyaW5nLFxuICAgIGdyb3VwUGF0aDogc3RyaW5nLFxuICAgIGNvbmZpZzogbG9vbUNvbnRhaW5lckNvbmZpZyxcbiAgICB0aW1lb3V0TXM6IG51bWJlcixcbiAgICBzaWduYWw6IEFib3J0U2lnbmFsLFxuICApOiBQcm9taXNlPGxvb21SdW5SZXN1bHQ+IHtcbiAgICBjb25zdCBpbWFnZSA9IHRoaXMuaW1hZ2VOYW1lRm9yR3JvdXAoZ3JvdXBOYW1lKTtcbiAgICBpZiAoIWV4aXN0c1N5bmMoam9pbihncm91cFBhdGgsIFwiRG9ja2VyZmlsZVwiKSkpIHtcbiAgICAgIHJldHVybiB0aGlzLmNyZWF0ZVN5bnRoZXRpY1Jlc3VsdChcbiAgICAgICAgYGNvbnRhaW5lcjoke2dyb3VwTmFtZX06YnVpbGRgLFxuICAgICAgICBgJHtydW50aW1lTGFiZWwoY29uZmlnLnJ1bnRpbWUpfSAke2dyb3VwTmFtZX0gYnVpbGRgLFxuICAgICAgICBgTm8gRG9ja2VyZmlsZSBjb25maWd1cmVkLiBVc2luZyBpbWFnZSAke2NvbmZpZy5pbWFnZSB8fCBcInVidW50dTpsYXRlc3RcIn0uXFxuYCxcbiAgICAgICk7XG4gICAgfVxuICAgIHJldHVybiBydW5Qcm9jZXNzKHtcbiAgICAgIHJ1bm5lcklkOiBgY29udGFpbmVyOiR7Z3JvdXBOYW1lfTpidWlsZGAsXG4gICAgICBydW5uZXJOYW1lOiBgJHtydW50aW1lTGFiZWwoY29uZmlnLnJ1bnRpbWUpfSAke2dyb3VwTmFtZX0gYnVpbGRgLFxuICAgICAgZXhlY3V0YWJsZTogdGhpcy5ydW50aW1lRXhlY3V0YWJsZShjb25maWcpLFxuICAgICAgYXJnczogW1wiYnVpbGRcIiwgXCItdFwiLCBpbWFnZSwgZ3JvdXBQYXRoXSxcbiAgICAgIHdvcmtpbmdEaXJlY3Rvcnk6IGdyb3VwUGF0aCxcbiAgICAgIHRpbWVvdXRNcyxcbiAgICAgIHNpZ25hbCxcbiAgICB9KTtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgYnVpbGRRZW11KGdyb3VwTmFtZTogc3RyaW5nLCBncm91cFBhdGg6IHN0cmluZywgY29uZmlnOiBsb29tQ29udGFpbmVyQ29uZmlnLCB0aW1lb3V0TXM6IG51bWJlciwgc2lnbmFsOiBBYm9ydFNpZ25hbCk6IFByb21pc2U8bG9vbVJ1blJlc3VsdD4ge1xuICAgIGNvbnN0IHFlbXUgPSB0aGlzLnJlcXVpcmVRZW11Q29uZmlnKGNvbmZpZyk7XG4gICAgaWYgKCFxZW11LmJ1aWxkQ29tbWFuZD8udHJpbSgpKSB7XG4gICAgICByZXR1cm4gdGhpcy5jcmVhdGVTeW50aGV0aWNSZXN1bHQoYGNvbnRhaW5lcjoke2dyb3VwTmFtZX06cWVtdTpidWlsZGAsIGBRRU1VICR7Z3JvdXBOYW1lfSBidWlsZGAsIFwiTm8gUUVNVSBidWlsZCBjb21tYW5kIGNvbmZpZ3VyZWQuXFxuXCIpO1xuICAgIH1cbiAgICByZXR1cm4gdGhpcy5ydW5Db21tYW5kTGluZShxZW11LmJ1aWxkQ29tbWFuZCwgZ3JvdXBQYXRoLCB0aW1lb3V0TXMsIHNpZ25hbCwgYGNvbnRhaW5lcjoke2dyb3VwTmFtZX06cWVtdTpidWlsZGAsIGBRRU1VICR7Z3JvdXBOYW1lfSBidWlsZGApO1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyByZWFkQ29uZmlnKGdyb3VwUGF0aDogc3RyaW5nKTogUHJvbWlzZTxsb29tQ29udGFpbmVyQ29uZmlnPiB7XG4gICAgY29uc3QgY29uZmlnUGF0aCA9IGpvaW4oZ3JvdXBQYXRoLCBcImNvbmZpZy5qc29uXCIpO1xuICAgIGxldCByYXc6IHVua25vd247XG4gICAgdHJ5IHtcbiAgICAgIHJhdyA9IEpTT04ucGFyc2UoYXdhaXQgcmVhZEZpbGUoY29uZmlnUGF0aCwgXCJ1dGY4XCIpKTtcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBVbmFibGUgdG8gcmVhZCBjb250YWluZXIgY29uZmlnICR7Y29uZmlnUGF0aH06ICR7ZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiBTdHJpbmcoZXJyb3IpfWApO1xuICAgIH1cblxuICAgIGlmICghcmF3IHx8IHR5cGVvZiByYXcgIT09IFwib2JqZWN0XCIgfHwgQXJyYXkuaXNBcnJheShyYXcpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJDb250YWluZXIgY29uZmlnIG11c3QgYmUgYW4gb2JqZWN0LlwiKTtcbiAgICB9XG5cbiAgICBjb25zdCBkYXRhID0gcmF3IGFzIHtcbiAgICAgIHJ1bnRpbWU/OiB1bmtub3duO1xuICAgICAgZXhlY3V0YWJsZT86IHVua25vd247XG4gICAgICBpbWFnZT86IHVua25vd247XG4gICAgICB3c2w/OiB1bmtub3duO1xuICAgICAgaGVhbHRoQ2hlY2s/OiB1bmtub3duO1xuICAgICAgcWVtdT86IHVua25vd247XG4gICAgICBjdXN0b20/OiB1bmtub3duO1xuICAgICAgbGFuZ3VhZ2VzPzogdW5rbm93bjtcbiAgICB9O1xuICAgIGNvbnN0IHJ1bnRpbWUgPSB0aGlzLnJlYWRSdW50aW1lKGRhdGEucnVudGltZSk7XG4gICAgaWYgKGRhdGEuZXhlY3V0YWJsZSAhPSBudWxsICYmIHR5cGVvZiBkYXRhLmV4ZWN1dGFibGUgIT09IFwic3RyaW5nXCIpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIkNvbnRhaW5lciBjb25maWcgZXhlY3V0YWJsZSBtdXN0IGJlIGEgc3RyaW5nLlwiKTtcbiAgICB9XG4gICAgaWYgKGRhdGEuaW1hZ2UgIT0gbnVsbCAmJiB0eXBlb2YgZGF0YS5pbWFnZSAhPT0gXCJzdHJpbmdcIikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiQ29udGFpbmVyIGNvbmZpZyBpbWFnZSBtdXN0IGJlIGEgc3RyaW5nLlwiKTtcbiAgICB9XG4gICAgaWYgKCFkYXRhLmxhbmd1YWdlcyB8fCB0eXBlb2YgZGF0YS5sYW5ndWFnZXMgIT09IFwib2JqZWN0XCIgfHwgQXJyYXkuaXNBcnJheShkYXRhLmxhbmd1YWdlcykpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIkNvbnRhaW5lciBjb25maWcgbGFuZ3VhZ2VzIG11c3QgYmUgYW4gb2JqZWN0LlwiKTtcbiAgICB9XG5cbiAgICBjb25zdCBsYW5ndWFnZXM6IFJlY29yZDxzdHJpbmcsIGxvb21Db250YWluZXJMYW5ndWFnZUNvbmZpZz4gPSB7fTtcbiAgICBmb3IgKGNvbnN0IFtsYW5ndWFnZSwgdmFsdWVdIG9mIE9iamVjdC5lbnRyaWVzKGRhdGEubGFuZ3VhZ2VzIGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+KSkge1xuICAgICAgaWYgKCF2YWx1ZSB8fCB0eXBlb2YgdmFsdWUgIT09IFwib2JqZWN0XCIgfHwgQXJyYXkuaXNBcnJheSh2YWx1ZSkpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBDb250YWluZXIgbGFuZ3VhZ2UgJHtsYW5ndWFnZX0gbXVzdCBiZSBhbiBvYmplY3QuYCk7XG4gICAgICB9XG4gICAgICBjb25zdCBsYW5ndWFnZUNvbmZpZyA9IHZhbHVlIGFzIHsgY29tbWFuZD86IHVua25vd247IGV4dGVuc2lvbj86IHVua25vd247IHVzZURlZmF1bHQ/OiB1bmtub3duIH07XG4gICAgICBjb25zdCB1c2VEZWZhdWx0ID0gbGFuZ3VhZ2VDb25maWcudXNlRGVmYXVsdCA9PT0gdHJ1ZTtcblxuICAgICAgaWYgKCF1c2VEZWZhdWx0ICYmICh0eXBlb2YgbGFuZ3VhZ2VDb25maWcuY29tbWFuZCAhPT0gXCJzdHJpbmdcIiB8fCAhbGFuZ3VhZ2VDb25maWcuY29tbWFuZC50cmltKCkpKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgQ29udGFpbmVyIGxhbmd1YWdlICR7bGFuZ3VhZ2V9IG11c3QgZGVmaW5lIGNvbW1hbmQgb3IgdXNlRGVmYXVsdC5gKTtcbiAgICAgIH1cblxuICAgICAgbGFuZ3VhZ2VzW2xhbmd1YWdlXSA9IHtcbiAgICAgICAgY29tbWFuZDogdHlwZW9mIGxhbmd1YWdlQ29uZmlnLmNvbW1hbmQgPT09IFwic3RyaW5nXCIgPyBsYW5ndWFnZUNvbmZpZy5jb21tYW5kIDogdW5kZWZpbmVkLFxuICAgICAgICBleHRlbnNpb246IHR5cGVvZiBsYW5ndWFnZUNvbmZpZy5leHRlbnNpb24gPT09IFwic3RyaW5nXCIgPyBsYW5ndWFnZUNvbmZpZy5leHRlbnNpb24gOiB1c2VEZWZhdWx0ID8gdW5kZWZpbmVkIDogYC4ke2xhbmd1YWdlfWAsXG4gICAgICAgIHVzZURlZmF1bHQ6IHVzZURlZmF1bHQgfHwgdW5kZWZpbmVkLFxuICAgICAgfTtcbiAgICB9XG5cbiAgICByZXR1cm4ge1xuICAgICAgcnVudGltZSxcbiAgICAgIGV4ZWN1dGFibGU6IHR5cGVvZiBkYXRhLmV4ZWN1dGFibGUgPT09IFwic3RyaW5nXCIgJiYgZGF0YS5leGVjdXRhYmxlLnRyaW0oKSA/IGRhdGEuZXhlY3V0YWJsZS50cmltKCkgOiB1bmRlZmluZWQsXG4gICAgICBpbWFnZTogdHlwZW9mIGRhdGEuaW1hZ2UgPT09IFwic3RyaW5nXCIgPyBkYXRhLmltYWdlIDogdW5kZWZpbmVkLFxuICAgICAgd3NsOiB0aGlzLnJlYWRXc2xDb25maWcoZGF0YS53c2wpLFxuICAgICAgaGVhbHRoQ2hlY2s6IHRoaXMucmVhZEhlYWx0aENoZWNrKGRhdGEuaGVhbHRoQ2hlY2ssIFwiQ29udGFpbmVyIGNvbmZpZyBoZWFsdGhDaGVja1wiKSxcbiAgICAgIHFlbXU6IHRoaXMucmVhZFFlbXVDb25maWcoZGF0YS5xZW11KSxcbiAgICAgIGN1c3RvbTogdGhpcy5yZWFkQ3VzdG9tQ29uZmlnKGRhdGEuY3VzdG9tKSxcbiAgICAgIGxhbmd1YWdlcyxcbiAgICB9O1xuICB9XG5cbiAgcHJpdmF0ZSByZWFkUnVudGltZSh2YWx1ZTogdW5rbm93bik6IGxvb21Db250YWluZXJSdW50aW1lIHtcbiAgICBpZiAodmFsdWUgPT0gbnVsbCkge1xuICAgICAgcmV0dXJuIFwiZG9ja2VyXCI7XG4gICAgfVxuICAgIGlmICh2YWx1ZSA9PT0gXCJkb2NrZXJcIiB8fCB2YWx1ZSA9PT0gXCJwb2RtYW5cIiB8fCB2YWx1ZSA9PT0gXCJxZW11XCIgfHwgdmFsdWUgPT09IFwiY3VzdG9tXCIgfHwgdmFsdWUgPT09IFwid3NsXCIpIHtcbiAgICAgIHJldHVybiB2YWx1ZTtcbiAgICB9XG4gICAgdGhyb3cgbmV3IEVycm9yKFwiQ29udGFpbmVyIGNvbmZpZyBydW50aW1lIG11c3QgYmUgZG9ja2VyLCBwb2RtYW4sIHFlbXUsIGN1c3RvbSwgb3Igd3NsLlwiKTtcbiAgfVxuXG4gIHByaXZhdGUgcmVhZFdzbENvbmZpZyh2YWx1ZTogdW5rbm93bik6IGxvb21Xc2xDb25maWcgfCB1bmRlZmluZWQge1xuICAgIGlmICh2YWx1ZSA9PSBudWxsKSB7XG4gICAgICByZXR1cm4gdW5kZWZpbmVkO1xuICAgIH1cbiAgICBpZiAoIXZhbHVlIHx8IHR5cGVvZiB2YWx1ZSAhPT0gXCJvYmplY3RcIiB8fCBBcnJheS5pc0FycmF5KHZhbHVlKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiQ29udGFpbmVyIGNvbmZpZyB3c2wgbXVzdCBiZSBhbiBvYmplY3QuXCIpO1xuICAgIH1cbiAgICBjb25zdCBkYXRhID0gdmFsdWUgYXMgeyBpbnRlcmFjdGl2ZT86IHVua25vd24gfTtcbiAgICByZXR1cm4ge1xuICAgICAgaW50ZXJhY3RpdmU6IGRhdGEuaW50ZXJhY3RpdmUgPT09IHRydWUsXG4gICAgfTtcbiAgfVxuXG4gIHByaXZhdGUgcmVhZFFlbXVDb25maWcodmFsdWU6IHVua25vd24pOiBsb29tUWVtdUNvbmZpZyB8IHVuZGVmaW5lZCB7XG4gICAgaWYgKHZhbHVlID09IG51bGwpIHtcbiAgICAgIHJldHVybiB1bmRlZmluZWQ7XG4gICAgfVxuICAgIGlmICghdmFsdWUgfHwgdHlwZW9mIHZhbHVlICE9PSBcIm9iamVjdFwiIHx8IEFycmF5LmlzQXJyYXkodmFsdWUpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJDb250YWluZXIgY29uZmlnIHFlbXUgbXVzdCBiZSBhbiBvYmplY3QuXCIpO1xuICAgIH1cbiAgICBjb25zdCBkYXRhID0gdmFsdWUgYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj47XG4gICAgaWYgKHR5cGVvZiBkYXRhLnNzaFRhcmdldCAhPT0gXCJzdHJpbmdcIiB8fCAhZGF0YS5zc2hUYXJnZXQudHJpbSgpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJDb250YWluZXIgY29uZmlnIHFlbXUuc3NoVGFyZ2V0IG11c3QgYmUgYSBzdHJpbmcuXCIpO1xuICAgIH1cbiAgICBpZiAodHlwZW9mIGRhdGEucmVtb3RlV29ya3NwYWNlICE9PSBcInN0cmluZ1wiIHx8ICFkYXRhLnJlbW90ZVdvcmtzcGFjZS50cmltKCkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIkNvbnRhaW5lciBjb25maWcgcWVtdS5yZW1vdGVXb3Jrc3BhY2UgbXVzdCBiZSBhIHN0cmluZy5cIik7XG4gICAgfVxuXG4gICAgcmV0dXJuIHtcbiAgICAgIHNzaFRhcmdldDogZGF0YS5zc2hUYXJnZXQudHJpbSgpLFxuICAgICAgcmVtb3RlV29ya3NwYWNlOiBkYXRhLnJlbW90ZVdvcmtzcGFjZS50cmltKCksXG4gICAgICBzc2hFeGVjdXRhYmxlOiBvcHRpb25hbFN0cmluZyhkYXRhLnNzaEV4ZWN1dGFibGUpLFxuICAgICAgc3NoQXJnczogb3B0aW9uYWxTdHJpbmcoZGF0YS5zc2hBcmdzKSxcbiAgICAgIHN0YXJ0Q29tbWFuZDogb3B0aW9uYWxTdHJpbmcoZGF0YS5zdGFydENvbW1hbmQpLFxuICAgICAgYnVpbGRDb21tYW5kOiBvcHRpb25hbFN0cmluZyhkYXRhLmJ1aWxkQ29tbWFuZCksXG4gICAgICB0ZWFyZG93bkNvbW1hbmQ6IG9wdGlvbmFsU3RyaW5nKGRhdGEudGVhcmRvd25Db21tYW5kKSxcbiAgICAgIGhlYWx0aENoZWNrOiB0aGlzLnJlYWRIZWFsdGhDaGVjayhkYXRhLmhlYWx0aENoZWNrLCBcIkNvbnRhaW5lciBjb25maWcgcWVtdS5oZWFsdGhDaGVja1wiKSxcbiAgICAgIG1hbmFnZXI6IHRoaXMucmVhZFFlbXVNYW5hZ2VyQ29uZmlnKGRhdGEubWFuYWdlciksXG4gICAgfTtcbiAgfVxuXG4gIHByaXZhdGUgcmVhZFFlbXVNYW5hZ2VyQ29uZmlnKHZhbHVlOiB1bmtub3duKTogbG9vbVFlbXVNYW5hZ2VyQ29uZmlnIHwgdW5kZWZpbmVkIHtcbiAgICBpZiAodmFsdWUgPT0gbnVsbCkge1xuICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICB9XG4gICAgaWYgKCF2YWx1ZSB8fCB0eXBlb2YgdmFsdWUgIT09IFwib2JqZWN0XCIgfHwgQXJyYXkuaXNBcnJheSh2YWx1ZSkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIkNvbnRhaW5lciBjb25maWcgcWVtdS5tYW5hZ2VyIG11c3QgYmUgYW4gb2JqZWN0LlwiKTtcbiAgICB9XG4gICAgY29uc3QgZGF0YSA9IHZhbHVlIGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+O1xuICAgIHJldHVybiB7XG4gICAgICBlbmFibGVkOiBkYXRhLmVuYWJsZWQgIT09IGZhbHNlLFxuICAgICAgZXhlY3V0YWJsZTogb3B0aW9uYWxTdHJpbmcoZGF0YS5leGVjdXRhYmxlKSxcbiAgICAgIGFyZ3M6IG9wdGlvbmFsU3RyaW5nKGRhdGEuYXJncyksXG4gICAgICBpbWFnZTogb3B0aW9uYWxTdHJpbmcoZGF0YS5pbWFnZSksXG4gICAgICBpbWFnZUZvcm1hdDogb3B0aW9uYWxTdHJpbmcoZGF0YS5pbWFnZUZvcm1hdCksXG4gICAgICBwaWRGaWxlOiBvcHRpb25hbFN0cmluZyhkYXRhLnBpZEZpbGUpLFxuICAgICAgbG9nRmlsZTogb3B0aW9uYWxTdHJpbmcoZGF0YS5sb2dGaWxlKSxcbiAgICAgIHJlYWRpbmVzc1RpbWVvdXRNczogb3B0aW9uYWxQb3NpdGl2ZUludGVnZXIoZGF0YS5yZWFkaW5lc3NUaW1lb3V0TXMsIFwiQ29udGFpbmVyIGNvbmZpZyBxZW11Lm1hbmFnZXIucmVhZGluZXNzVGltZW91dE1zXCIpLFxuICAgICAgcmVhZGluZXNzSW50ZXJ2YWxNczogb3B0aW9uYWxQb3NpdGl2ZUludGVnZXIoZGF0YS5yZWFkaW5lc3NJbnRlcnZhbE1zLCBcIkNvbnRhaW5lciBjb25maWcgcWVtdS5tYW5hZ2VyLnJlYWRpbmVzc0ludGVydmFsTXNcIiksXG4gICAgICBib290RGVsYXlNczogb3B0aW9uYWxOb25OZWdhdGl2ZUludGVnZXIoZGF0YS5ib290RGVsYXlNcywgXCJDb250YWluZXIgY29uZmlnIHFlbXUubWFuYWdlci5ib290RGVsYXlNc1wiKSxcbiAgICAgIHNodXRkb3duQ29tbWFuZDogb3B0aW9uYWxTdHJpbmcoZGF0YS5zaHV0ZG93bkNvbW1hbmQpLFxuICAgICAgc2h1dGRvd25UaW1lb3V0TXM6IG9wdGlvbmFsUG9zaXRpdmVJbnRlZ2VyKGRhdGEuc2h1dGRvd25UaW1lb3V0TXMsIFwiQ29udGFpbmVyIGNvbmZpZyBxZW11Lm1hbmFnZXIuc2h1dGRvd25UaW1lb3V0TXNcIiksXG4gICAgICBraWxsU2lnbmFsOiBvcHRpb25hbFNpZ25hbChkYXRhLmtpbGxTaWduYWwsIFwiQ29udGFpbmVyIGNvbmZpZyBxZW11Lm1hbmFnZXIua2lsbFNpZ25hbFwiKSxcbiAgICAgIHBlcnNpc3Q6IHR5cGVvZiBkYXRhLnBlcnNpc3QgPT09IFwiYm9vbGVhblwiID8gZGF0YS5wZXJzaXN0IDogdW5kZWZpbmVkLFxuICAgIH07XG4gIH1cblxuICBwcml2YXRlIHJlYWRDdXN0b21Db25maWcodmFsdWU6IHVua25vd24pOiBsb29tQ3VzdG9tUnVudGltZUNvbmZpZyB8IHVuZGVmaW5lZCB7XG4gICAgaWYgKHZhbHVlID09IG51bGwpIHtcbiAgICAgIHJldHVybiB1bmRlZmluZWQ7XG4gICAgfVxuICAgIGlmICghdmFsdWUgfHwgdHlwZW9mIHZhbHVlICE9PSBcIm9iamVjdFwiIHx8IEFycmF5LmlzQXJyYXkodmFsdWUpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJDb250YWluZXIgY29uZmlnIGN1c3RvbSBtdXN0IGJlIGFuIG9iamVjdC5cIik7XG4gICAgfVxuICAgIGNvbnN0IGRhdGEgPSB2YWx1ZSBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPjtcbiAgICBpZiAodHlwZW9mIGRhdGEuZXhlY3V0YWJsZSAhPT0gXCJzdHJpbmdcIiB8fCAhZGF0YS5leGVjdXRhYmxlLnRyaW0oKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiQ29udGFpbmVyIGNvbmZpZyBjdXN0b20uZXhlY3V0YWJsZSBtdXN0IGJlIGEgc3RyaW5nLlwiKTtcbiAgICB9XG4gICAgcmV0dXJuIHtcbiAgICAgIGV4ZWN1dGFibGU6IGRhdGEuZXhlY3V0YWJsZS50cmltKCksXG4gICAgICBhcmdzOiBvcHRpb25hbFN0cmluZyhkYXRhLmFyZ3MpLFxuICAgICAgYnVpbGQ6IG9wdGlvbmFsU3RyaW5nKGRhdGEuYnVpbGQpLFxuICAgICAgY29tbWFuZFN0cnVjdHVyZTogb3B0aW9uYWxTdHJpbmcoZGF0YS5jb21tYW5kU3RydWN0dXJlKSxcbiAgICAgIHRlYXJkb3duOiBvcHRpb25hbFN0cmluZyhkYXRhLnRlYXJkb3duKSxcbiAgICAgIGhlYWx0aENoZWNrOiB0aGlzLnJlYWRIZWFsdGhDaGVjayhkYXRhLmhlYWx0aENoZWNrLCBcIkNvbnRhaW5lciBjb25maWcgY3VzdG9tLmhlYWx0aENoZWNrXCIpLFxuICAgIH07XG4gIH1cblxuICBwcml2YXRlIHJlYWRIZWFsdGhDaGVjayh2YWx1ZTogdW5rbm93biwgbGFiZWw6IHN0cmluZyk6IGxvb21Db21tYW5kRXhwZWN0YXRpb24gfCB1bmRlZmluZWQge1xuICAgIGlmICh2YWx1ZSA9PSBudWxsKSB7XG4gICAgICByZXR1cm4gdW5kZWZpbmVkO1xuICAgIH1cbiAgICBpZiAoIXZhbHVlIHx8IHR5cGVvZiB2YWx1ZSAhPT0gXCJvYmplY3RcIiB8fCBBcnJheS5pc0FycmF5KHZhbHVlKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGAke2xhYmVsfSBtdXN0IGJlIGFuIG9iamVjdC5gKTtcbiAgICB9XG4gICAgY29uc3QgZGF0YSA9IHZhbHVlIGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+O1xuICAgIGlmICh0eXBlb2YgZGF0YS5jb21tYW5kICE9PSBcInN0cmluZ1wiIHx8ICFkYXRhLmNvbW1hbmQudHJpbSgpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYCR7bGFiZWx9LmNvbW1hbmQgbXVzdCBiZSBhIHN0cmluZy5gKTtcbiAgICB9XG4gICAgcmV0dXJuIHtcbiAgICAgIGNvbW1hbmQ6IGRhdGEuY29tbWFuZC50cmltKCksXG4gICAgICBwb3NpdGl2ZVJlc3BvbnNlOiBvcHRpb25hbFN0cmluZyhkYXRhLnBvc2l0aXZlUmVzcG9uc2UgPz8gZGF0YS5wb3NpdGl2ZV9yZXNwb25zZSA/PyBkYXRhW1wicG9zaXRpdmUgcmVzcG9uc2VcIl0gPz8gZGF0YS5wb3NzaXRpdmVSZXNwb25zZSksXG4gICAgICBuZWdhdGl2ZVJlc3BvbnNlOiBvcHRpb25hbFN0cmluZyhkYXRhLm5lZ2F0aXZlUmVzcG9uc2UgPz8gZGF0YS5uZWdhdGl2ZV9yZXNwb25zZSA/PyBkYXRhW1wibmVnYXRpdmUgcmVzcG9uc2VcIl0pLFxuICAgIH07XG4gIH1cblxuICBwcml2YXRlIHJlcXVpcmVRZW11Q29uZmlnKGNvbmZpZzogbG9vbUNvbnRhaW5lckNvbmZpZyk6IGxvb21RZW11Q29uZmlnIHtcbiAgICBpZiAoIWNvbmZpZy5xZW11KSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJRRU1VIHJ1bnRpbWUgcmVxdWlyZXMgYSBxZW11IGNvbmZpZyBvYmplY3QuXCIpO1xuICAgIH1cbiAgICByZXR1cm4gY29uZmlnLnFlbXU7XG4gIH1cblxuICBwcml2YXRlIHJlcXVpcmVDdXN0b21Db25maWcoY29uZmlnOiBsb29tQ29udGFpbmVyQ29uZmlnKTogbG9vbUN1c3RvbVJ1bnRpbWVDb25maWcge1xuICAgIGlmICghY29uZmlnLmN1c3RvbSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiQ3VzdG9tIHJ1bnRpbWUgcmVxdWlyZXMgYSBjdXN0b20gY29uZmlnIG9iamVjdC5cIik7XG4gICAgfVxuICAgIHJldHVybiBjb25maWcuY3VzdG9tO1xuICB9XG5cbiAgcHJpdmF0ZSBydW50aW1lRXhlY3V0YWJsZShjb25maWc6IGxvb21Db250YWluZXJDb25maWcpOiBzdHJpbmcge1xuICAgIGlmIChjb25maWcuZXhlY3V0YWJsZT8udHJpbSgpKSB7XG4gICAgICByZXR1cm4gY29uZmlnLmV4ZWN1dGFibGUudHJpbSgpO1xuICAgIH1cbiAgICByZXR1cm4gY29uZmlnLnJ1bnRpbWUgPT09IFwicG9kbWFuXCIgPyBcInBvZG1hblwiIDogXCJkb2NrZXJcIjtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgcnVuSGVhbHRoQ2hlY2soXG4gICAgaGVhbHRoQ2hlY2s6IGxvb21Db21tYW5kRXhwZWN0YXRpb24gfCB1bmRlZmluZWQsXG4gICAgd29ya2luZ0RpcmVjdG9yeTogc3RyaW5nLFxuICAgIHRpbWVvdXRNczogbnVtYmVyLFxuICAgIHNpZ25hbDogQWJvcnRTaWduYWwsXG4gICAgcnVubmVySWQ6IHN0cmluZyxcbiAgICBydW5uZXJOYW1lOiBzdHJpbmcsXG4gICk6IFByb21pc2U8dm9pZD4ge1xuICAgIGlmICghaGVhbHRoQ2hlY2spIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBjb25zdCByZXN1bHQgPSBhd2FpdCB0aGlzLnJ1bkNvbW1hbmRMaW5lKGhlYWx0aENoZWNrLmNvbW1hbmQsIHdvcmtpbmdEaXJlY3RvcnksIHRpbWVvdXRNcywgc2lnbmFsLCBydW5uZXJJZCwgcnVubmVyTmFtZSk7XG4gICAgY29uc3QgY29tYmluZWRPdXRwdXQgPSBgJHtyZXN1bHQuc3Rkb3V0fVxcbiR7cmVzdWx0LnN0ZGVycn1gO1xuICAgIGlmICghcmVzdWx0LnN1Y2Nlc3MpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgJHtydW5uZXJOYW1lfSBmYWlsZWQ6ICR7cmVzdWx0LnN0ZGVyciB8fCByZXN1bHQuc3Rkb3V0IHx8IGBleGl0ICR7cmVzdWx0LmV4aXRDb2RlfWB9YCk7XG4gICAgfVxuICAgIGlmIChoZWFsdGhDaGVjay5uZWdhdGl2ZVJlc3BvbnNlICYmIGNvbWJpbmVkT3V0cHV0LmluY2x1ZGVzKGhlYWx0aENoZWNrLm5lZ2F0aXZlUmVzcG9uc2UpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYCR7cnVubmVyTmFtZX0gcmV0dXJuZWQgbmVnYXRpdmUgcmVzcG9uc2U6ICR7aGVhbHRoQ2hlY2submVnYXRpdmVSZXNwb25zZX1gKTtcbiAgICB9XG4gICAgaWYgKGhlYWx0aENoZWNrLnBvc2l0aXZlUmVzcG9uc2UgJiYgIWNvbWJpbmVkT3V0cHV0LmluY2x1ZGVzKGhlYWx0aENoZWNrLnBvc2l0aXZlUmVzcG9uc2UpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYCR7cnVubmVyTmFtZX0gZGlkIG5vdCByZXR1cm4gcG9zaXRpdmUgcmVzcG9uc2U6ICR7aGVhbHRoQ2hlY2sucG9zaXRpdmVSZXNwb25zZX1gKTtcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIHJ1bk9wdGlvbmFsQ29tbWFuZChcbiAgICBjb21tYW5kOiBzdHJpbmcgfCB1bmRlZmluZWQsXG4gICAgd29ya2luZ0RpcmVjdG9yeTogc3RyaW5nLFxuICAgIHRpbWVvdXRNczogbnVtYmVyLFxuICAgIHNpZ25hbDogQWJvcnRTaWduYWwsXG4gICAgcnVubmVySWQ6IHN0cmluZyxcbiAgICBydW5uZXJOYW1lOiBzdHJpbmcsXG4gICk6IFByb21pc2U8dm9pZD4ge1xuICAgIGlmICghY29tbWFuZD8udHJpbSgpKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHRoaXMucnVuQ29tbWFuZExpbmUoY29tbWFuZCwgd29ya2luZ0RpcmVjdG9yeSwgdGltZW91dE1zLCBzaWduYWwsIHJ1bm5lcklkLCBydW5uZXJOYW1lKTtcbiAgICBpZiAoIXJlc3VsdC5zdWNjZXNzKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYCR7cnVubmVyTmFtZX0gZmFpbGVkOiAke3Jlc3VsdC5zdGRlcnIgfHwgcmVzdWx0LnN0ZG91dCB8fCBgZXhpdCAke3Jlc3VsdC5leGl0Q29kZX1gfWApO1xuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgcnVuQ29tbWFuZExpbmUoXG4gICAgY29tbWFuZDogc3RyaW5nLFxuICAgIHdvcmtpbmdEaXJlY3Rvcnk6IHN0cmluZyxcbiAgICB0aW1lb3V0TXM6IG51bWJlcixcbiAgICBzaWduYWw6IEFib3J0U2lnbmFsLFxuICAgIHJ1bm5lcklkOiBzdHJpbmcsXG4gICAgcnVubmVyTmFtZTogc3RyaW5nLFxuICApOiBQcm9taXNlPGxvb21SdW5SZXN1bHQ+IHtcbiAgICBjb25zdCBwYXJ0cyA9IHNwbGl0Q29tbWFuZExpbmUoY29tbWFuZCk7XG4gICAgaWYgKCFwYXJ0cy5sZW5ndGgpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgJHtydW5uZXJOYW1lfSBjb21tYW5kIGlzIGVtcHR5LmApO1xuICAgIH1cbiAgICByZXR1cm4gcnVuUHJvY2Vzcyh7XG4gICAgICBydW5uZXJJZCxcbiAgICAgIHJ1bm5lck5hbWUsXG4gICAgICBleGVjdXRhYmxlOiBwYXJ0c1swXSxcbiAgICAgIGFyZ3M6IHBhcnRzLnNsaWNlKDEpLFxuICAgICAgd29ya2luZ0RpcmVjdG9yeSxcbiAgICAgIHRpbWVvdXRNcyxcbiAgICAgIHNpZ25hbCxcbiAgICB9KTtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgZW5zdXJlTWFuYWdlZFFlbXUoZ3JvdXBOYW1lOiBzdHJpbmcsIGdyb3VwUGF0aDogc3RyaW5nLCBxZW11OiBsb29tUWVtdUNvbmZpZywgdGltZW91dE1zOiBudW1iZXIsIHNpZ25hbDogQWJvcnRTaWduYWwpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCBtYW5hZ2VyID0gcWVtdS5tYW5hZ2VyO1xuICAgIGlmICghbWFuYWdlcj8uZW5hYmxlZCkge1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGNvbnN0IHBpZFBhdGggPSB0aGlzLnJlc29sdmVHcm91cEZpbGVQYXRoKGdyb3VwUGF0aCwgbWFuYWdlci5waWRGaWxlIHx8IFwiLmxvb20tcWVtdS5waWRcIik7XG4gICAgY29uc3QgZXhpc3RpbmdQaWQgPSBhd2FpdCB0aGlzLnJlYWRQaWRGaWxlKHBpZFBhdGgpO1xuICAgIGlmIChleGlzdGluZ1BpZCAmJiB0aGlzLmlzUHJvY2Vzc1J1bm5pbmcoZXhpc3RpbmdQaWQpKSB7XG4gICAgICBhd2FpdCB0aGlzLndhaXRGb3JNYW5hZ2VkUWVtdVJlYWRpbmVzcyhncm91cE5hbWUsIGdyb3VwUGF0aCwgcWVtdSwgdGltZW91dE1zLCBzaWduYWwpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGlmIChleGlzdGluZ1BpZCkge1xuICAgICAgYXdhaXQgcm0ocGlkUGF0aCwgeyBmb3JjZTogdHJ1ZSB9KTtcbiAgICB9XG5cbiAgICBjb25zdCBleGVjdXRhYmxlID0gbWFuYWdlci5leGVjdXRhYmxlIHx8IFwicWVtdS1zeXN0ZW0teDg2XzY0XCI7XG4gICAgY29uc3QgYXJncyA9IHRoaXMuYnVpbGRNYW5hZ2VkUWVtdUFyZ3MoZ3JvdXBQYXRoLCBtYW5hZ2VyKTtcbiAgICBpZiAoIWFyZ3MubGVuZ3RoKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYFFFTVUgbWFuYWdlciBmb3IgJHtncm91cE5hbWV9IG5lZWRzIHFlbXUubWFuYWdlci5hcmdzIG9yIHFlbXUubWFuYWdlci5pbWFnZS5gKTtcbiAgICB9XG5cbiAgICBjb25zdCBsb2dQYXRoID0gbWFuYWdlci5sb2dGaWxlID8gdGhpcy5yZXNvbHZlR3JvdXBGaWxlUGF0aChncm91cFBhdGgsIG1hbmFnZXIubG9nRmlsZSkgOiBudWxsO1xuICAgIGNvbnN0IGxvZ0ZkID0gbG9nUGF0aCA/IG9wZW5TeW5jKGxvZ1BhdGgsIFwiYVwiKSA6IG51bGw7XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IGNoaWxkID0gc3Bhd24oZXhlY3V0YWJsZSwgYXJncywge1xuICAgICAgICBjd2Q6IGdyb3VwUGF0aCxcbiAgICAgICAgZGV0YWNoZWQ6IHRydWUsXG4gICAgICAgIHN0ZGlvOiBbXCJpZ25vcmVcIiwgbG9nRmQgPz8gXCJpZ25vcmVcIiwgbG9nRmQgPz8gXCJpZ25vcmVcIl0sXG4gICAgICB9KTtcblxuICAgICAgY2hpbGQub24oXCJlcnJvclwiLCAoKSA9PiB1bmRlZmluZWQpO1xuICAgICAgY2hpbGQudW5yZWYoKTtcblxuICAgICAgaWYgKCFjaGlsZC5waWQpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBRRU1VIG1hbmFnZXIgZm9yICR7Z3JvdXBOYW1lfSBkaWQgbm90IHJldHVybiBhIHByb2Nlc3MgaWQuYCk7XG4gICAgICB9XG5cbiAgICAgIGF3YWl0IHdyaXRlRmlsZShwaWRQYXRoLCBgJHtjaGlsZC5waWR9XFxuYCwgXCJ1dGY4XCIpO1xuICAgICAgYXdhaXQgdGhpcy53YWl0Rm9yTWFuYWdlZFFlbXVSZWFkaW5lc3MoZ3JvdXBOYW1lLCBncm91cFBhdGgsIHFlbXUsIHRpbWVvdXRNcywgc2lnbmFsKTtcbiAgICB9IGZpbmFsbHkge1xuICAgICAgaWYgKGxvZ0ZkICE9IG51bGwpIHtcbiAgICAgICAgY2xvc2VTeW5jKGxvZ0ZkKTtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICBwcml2YXRlIGJ1aWxkTWFuYWdlZFFlbXVBcmdzKGdyb3VwUGF0aDogc3RyaW5nLCBtYW5hZ2VyOiBsb29tUWVtdU1hbmFnZXJDb25maWcpOiBzdHJpbmdbXSB7XG4gICAgY29uc3QgYXJncyA9IHNwbGl0Q29tbWFuZExpbmUobWFuYWdlci5hcmdzIHx8IFwiXCIpO1xuICAgIGlmIChtYW5hZ2VyLmltYWdlKSB7XG4gICAgICBjb25zdCBpbWFnZVBhdGggPSB0aGlzLnJlc29sdmVHcm91cEZpbGVQYXRoKGdyb3VwUGF0aCwgbWFuYWdlci5pbWFnZSk7XG4gICAgICBhcmdzLnB1c2goXCItZHJpdmVcIiwgYGZpbGU9JHtpbWFnZVBhdGh9LGlmPXZpcnRpbyxmb3JtYXQ9JHttYW5hZ2VyLmltYWdlRm9ybWF0IHx8IFwicWNvdzJcIn1gKTtcbiAgICB9XG4gICAgcmV0dXJuIGFyZ3M7XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIHdhaXRGb3JNYW5hZ2VkUWVtdVJlYWRpbmVzcyhcbiAgICBncm91cE5hbWU6IHN0cmluZyxcbiAgICBncm91cFBhdGg6IHN0cmluZyxcbiAgICBxZW11OiBsb29tUWVtdUNvbmZpZyxcbiAgICB0aW1lb3V0TXM6IG51bWJlcixcbiAgICBzaWduYWw6IEFib3J0U2lnbmFsLFxuICApOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCBtYW5hZ2VyID0gcWVtdS5tYW5hZ2VyO1xuICAgIGlmICghbWFuYWdlcj8uZW5hYmxlZCkge1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGlmICghcWVtdS5oZWFsdGhDaGVjaykge1xuICAgICAgYXdhaXQgc2xlZXBXaXRoU2lnbmFsKG1hbmFnZXIuYm9vdERlbGF5TXMgPz8gMCwgc2lnbmFsKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBjb25zdCB0aW1lb3V0ID0gTWF0aC5taW4obWFuYWdlci5yZWFkaW5lc3NUaW1lb3V0TXMgPz8gNjBfMDAwLCBNYXRoLm1heCh0aW1lb3V0TXMsIDEpKTtcbiAgICBjb25zdCBpbnRlcnZhbCA9IG1hbmFnZXIucmVhZGluZXNzSW50ZXJ2YWxNcyA/PyAxXzAwMDtcbiAgICBjb25zdCBzdGFydGVkQXQgPSBEYXRlLm5vdygpO1xuICAgIGxldCBsYXN0RXJyb3IgPSBcIlwiO1xuXG4gICAgd2hpbGUgKERhdGUubm93KCkgLSBzdGFydGVkQXQgPD0gdGltZW91dCkge1xuICAgICAgaWYgKHNpZ25hbC5hYm9ydGVkKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgUUVNVSAke2dyb3VwTmFtZX0gcmVhZGluZXNzIHdhaXQgY2FuY2VsbGVkLmApO1xuICAgICAgfVxuXG4gICAgICB0cnkge1xuICAgICAgICBhd2FpdCB0aGlzLnJ1bkhlYWx0aENoZWNrKHFlbXUuaGVhbHRoQ2hlY2ssIGdyb3VwUGF0aCwgTWF0aC5taW4oaW50ZXJ2YWwsIHRpbWVvdXQpLCBzaWduYWwsIGBjb250YWluZXI6JHtncm91cE5hbWV9OnFlbXU6cmVhZHlgLCBgUUVNVSAke2dyb3VwTmFtZX0gcmVhZGluZXNzIGNoZWNrYCk7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIGxhc3RFcnJvciA9IGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogU3RyaW5nKGVycm9yKTtcbiAgICAgIH1cblxuICAgICAgYXdhaXQgc2xlZXBXaXRoU2lnbmFsKGludGVydmFsLCBzaWduYWwpO1xuICAgIH1cblxuICAgIHRocm93IG5ldyBFcnJvcihgUUVNVSAke2dyb3VwTmFtZX0gZGlkIG5vdCBiZWNvbWUgcmVhZHkgd2l0aGluICR7dGltZW91dH0gbXMke2xhc3RFcnJvciA/IGA6ICR7bGFzdEVycm9yfWAgOiBcIi5cIn1gKTtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgc3RvcE1hbmFnZWRRZW11SWZOZWVkZWQoZ3JvdXBOYW1lOiBzdHJpbmcsIGdyb3VwUGF0aDogc3RyaW5nLCBxZW11OiBsb29tUWVtdUNvbmZpZywgdGltZW91dE1zOiBudW1iZXIsIHNpZ25hbDogQWJvcnRTaWduYWwpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCBtYW5hZ2VyID0gcWVtdS5tYW5hZ2VyO1xuICAgIGlmICghbWFuYWdlcj8uZW5hYmxlZCB8fCBtYW5hZ2VyLnBlcnNpc3QgIT09IGZhbHNlKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgY29uc3QgcGlkUGF0aCA9IHRoaXMucmVzb2x2ZUdyb3VwRmlsZVBhdGgoZ3JvdXBQYXRoLCBtYW5hZ2VyLnBpZEZpbGUgfHwgXCIubG9vbS1xZW11LnBpZFwiKTtcbiAgICBjb25zdCBwaWQgPSBhd2FpdCB0aGlzLnJlYWRQaWRGaWxlKHBpZFBhdGgpO1xuICAgIGlmICghcGlkKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgaWYgKG1hbmFnZXIuc2h1dGRvd25Db21tYW5kKSB7XG4gICAgICBhd2FpdCB0aGlzLnJ1bk9wdGlvbmFsQ29tbWFuZChcbiAgICAgICAgbWFuYWdlci5zaHV0ZG93bkNvbW1hbmQsXG4gICAgICAgIGdyb3VwUGF0aCxcbiAgICAgICAgTWF0aC5taW4obWFuYWdlci5zaHV0ZG93blRpbWVvdXRNcyA/PyB0aW1lb3V0TXMsIHRpbWVvdXRNcyksXG4gICAgICAgIHNpZ25hbCxcbiAgICAgICAgYGNvbnRhaW5lcjoke2dyb3VwTmFtZX06cWVtdTpzaHV0ZG93bmAsXG4gICAgICAgIGBRRU1VICR7Z3JvdXBOYW1lfSBzaHV0ZG93bmAsXG4gICAgICApO1xuICAgIH0gZWxzZSBpZiAodGhpcy5pc1Byb2Nlc3NSdW5uaW5nKHBpZCkpIHtcbiAgICAgIHByb2Nlc3Mua2lsbChwaWQsIG1hbmFnZXIua2lsbFNpZ25hbCB8fCBcIlNJR1RFUk1cIik7XG4gICAgfVxuXG4gICAgY29uc3Qgc3RvcHBlZCA9IGF3YWl0IHRoaXMud2FpdEZvclByb2Nlc3NFeGl0KHBpZCwgbWFuYWdlci5zaHV0ZG93blRpbWVvdXRNcyA/PyAxMF8wMDAsIHNpZ25hbCk7XG4gICAgaWYgKCFzdG9wcGVkICYmIHRoaXMuaXNQcm9jZXNzUnVubmluZyhwaWQpKSB7XG4gICAgICBwcm9jZXNzLmtpbGwocGlkLCBcIlNJR0tJTExcIik7XG4gICAgICBhd2FpdCB0aGlzLndhaXRGb3JQcm9jZXNzRXhpdChwaWQsIDJfMDAwLCBzaWduYWwpO1xuICAgIH1cblxuICAgIGF3YWl0IHJtKHBpZFBhdGgsIHsgZm9yY2U6IHRydWUgfSk7XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIGdldE1hbmFnZWRRZW11U3RhdHVzKGdyb3VwUGF0aDogc3RyaW5nLCBtYW5hZ2VyOiBsb29tUWVtdU1hbmFnZXJDb25maWcpOiBQcm9taXNlPHN0cmluZz4ge1xuICAgIGNvbnN0IHBpZFBhdGggPSB0aGlzLnJlc29sdmVHcm91cEZpbGVQYXRoKGdyb3VwUGF0aCwgbWFuYWdlci5waWRGaWxlIHx8IFwiLmxvb20tcWVtdS5waWRcIik7XG4gICAgY29uc3QgcGlkID0gYXdhaXQgdGhpcy5yZWFkUGlkRmlsZShwaWRQYXRoKTtcbiAgICBpZiAoIXBpZCkge1xuICAgICAgcmV0dXJuIFwic3RvcHBlZFwiO1xuICAgIH1cbiAgICByZXR1cm4gdGhpcy5pc1Byb2Nlc3NSdW5uaW5nKHBpZCkgPyBgcnVubmluZyBwaWQgJHtwaWR9YCA6IGBzdGFsZSBwaWQgJHtwaWR9YDtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgcmVhZFBpZEZpbGUocGlkUGF0aDogc3RyaW5nKTogUHJvbWlzZTxudW1iZXIgfCBudWxsPiB7XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHZhbHVlID0gKGF3YWl0IHJlYWRGaWxlKHBpZFBhdGgsIFwidXRmOFwiKSkudHJpbSgpO1xuICAgICAgY29uc3QgcGlkID0gTnVtYmVyLnBhcnNlSW50KHZhbHVlLCAxMCk7XG4gICAgICByZXR1cm4gTnVtYmVyLmlzSW50ZWdlcihwaWQpICYmIHBpZCA+IDAgPyBwaWQgOiBudWxsO1xuICAgIH0gY2F0Y2gge1xuICAgICAgcmV0dXJuIG51bGw7XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBpc1Byb2Nlc3NSdW5uaW5nKHBpZDogbnVtYmVyKTogYm9vbGVhbiB7XG4gICAgdHJ5IHtcbiAgICAgIHByb2Nlc3Mua2lsbChwaWQsIDApO1xuICAgICAgcmV0dXJuIHRydWU7XG4gICAgfSBjYXRjaCB7XG4gICAgICByZXR1cm4gZmFsc2U7XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyB3YWl0Rm9yUHJvY2Vzc0V4aXQocGlkOiBudW1iZXIsIHRpbWVvdXRNczogbnVtYmVyLCBzaWduYWw6IEFib3J0U2lnbmFsKTogUHJvbWlzZTxib29sZWFuPiB7XG4gICAgY29uc3Qgc3RhcnRlZEF0ID0gRGF0ZS5ub3coKTtcbiAgICB3aGlsZSAoRGF0ZS5ub3coKSAtIHN0YXJ0ZWRBdCA8PSB0aW1lb3V0TXMpIHtcbiAgICAgIGlmIChzaWduYWwuYWJvcnRlZCkge1xuICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICB9XG4gICAgICBpZiAoIXRoaXMuaXNQcm9jZXNzUnVubmluZyhwaWQpKSB7XG4gICAgICAgIHJldHVybiB0cnVlO1xuICAgICAgfVxuICAgICAgYXdhaXQgc2xlZXBXaXRoU2lnbmFsKDI1MCwgc2lnbmFsKTtcbiAgICB9XG4gICAgcmV0dXJuICF0aGlzLmlzUHJvY2Vzc1J1bm5pbmcocGlkKTtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgcnVuQ3VzdG9tV3JhcHBlcihcbiAgICBncm91cE5hbWU6IHN0cmluZyxcbiAgICBncm91cFBhdGg6IHN0cmluZyxcbiAgICBjb25maWc6IGxvb21Db250YWluZXJDb25maWcsXG4gICAgcmVxdWVzdDogbG9vbUN1c3RvbVJ1bnRpbWVSZXF1ZXN0LFxuICAgIHRpbWVvdXRNczogbnVtYmVyLFxuICAgIHNpZ25hbDogQWJvcnRTaWduYWwsXG4gICk6IFByb21pc2U8bG9vbVJ1blJlc3VsdD4ge1xuICAgIGNvbnN0IGN1c3RvbSA9IHRoaXMucmVxdWlyZUN1c3RvbUNvbmZpZyhjb25maWcpO1xuICAgIGF3YWl0IHRoaXMucnVuSGVhbHRoQ2hlY2soY3VzdG9tLmhlYWx0aENoZWNrLCBncm91cFBhdGgsIHRpbWVvdXRNcywgc2lnbmFsLCBgY29udGFpbmVyOiR7Z3JvdXBOYW1lfTpjdXN0b206aGVhbHRoYCwgYEN1c3RvbSAke2dyb3VwTmFtZX0gaGVhbHRoIGNoZWNrYCk7XG5cbiAgICBjb25zdCByZXF1ZXN0RmlsZU5hbWUgPSBgcmVxdWVzdF8ke0RhdGUubm93KCl9XyR7TWF0aC5yYW5kb20oKS50b1N0cmluZygxNikuc2xpY2UoMil9Lmpzb25gO1xuICAgIGNvbnN0IHJlcXVlc3RQYXRoID0gam9pbihncm91cFBhdGgsIHJlcXVlc3RGaWxlTmFtZSk7XG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IHdyaXRlRmlsZShyZXF1ZXN0UGF0aCwgYCR7SlNPTi5zdHJpbmdpZnkocmVxdWVzdCwgbnVsbCwgMil9XFxuYCwgXCJ1dGY4XCIpO1xuICAgICAgY29uc3QgYXJncyA9IHNwbGl0Q29tbWFuZExpbmUoY3VzdG9tLmFyZ3MgfHwgXCJ7cmVxdWVzdH1cIikubWFwKChhcmcpID0+XG4gICAgICAgIGFyZ1xuICAgICAgICAgIC5yZXBsYWNlQWxsKFwie3JlcXVlc3R9XCIsIHJlcXVlc3RQYXRoKVxuICAgICAgICAgIC5yZXBsYWNlQWxsKFwie2dyb3VwfVwiLCBncm91cE5hbWUpXG4gICAgICAgICAgLnJlcGxhY2VBbGwoXCJ7Z3JvdXBQYXRofVwiLCBncm91cFBhdGgpLFxuICAgICAgKTtcbiAgICAgIHJldHVybiBhd2FpdCBydW5Qcm9jZXNzKHtcbiAgICAgICAgcnVubmVySWQ6IGBjb250YWluZXI6JHtncm91cE5hbWV9OmN1c3RvbToke3JlcXVlc3QuYWN0aW9ufWAsXG4gICAgICAgIHJ1bm5lck5hbWU6IGBDdXN0b20gJHtncm91cE5hbWV9ICR7cmVxdWVzdC5hY3Rpb259YCxcbiAgICAgICAgZXhlY3V0YWJsZTogY3VzdG9tLmV4ZWN1dGFibGUsXG4gICAgICAgIGFyZ3MsXG4gICAgICAgIHdvcmtpbmdEaXJlY3Rvcnk6IGdyb3VwUGF0aCxcbiAgICAgICAgdGltZW91dE1zLFxuICAgICAgICBzaWduYWwsXG4gICAgICB9KTtcbiAgICB9IGZpbmFsbHkge1xuICAgICAgYXdhaXQgcm0ocmVxdWVzdFBhdGgsIHsgZm9yY2U6IHRydWUgfSk7XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBjcmVhdGVDdXN0b21SZXF1ZXN0KFxuICAgIGFjdGlvbjogbG9vbUN1c3RvbVJ1bnRpbWVSZXF1ZXN0W1wiYWN0aW9uXCJdLFxuICAgIGdyb3VwTmFtZTogc3RyaW5nLFxuICAgIGdyb3VwUGF0aDogc3RyaW5nLFxuICAgIGNvbmZpZzogbG9vbUNvbnRhaW5lckNvbmZpZyxcbiAgICB0aW1lb3V0TXM6IG51bWJlcixcbiAgICBleHRyYTogUGFydGlhbDxsb29tQ3VzdG9tUnVudGltZVJlcXVlc3Q+ID0ge30sXG4gICk6IGxvb21DdXN0b21SdW50aW1lUmVxdWVzdCB7XG4gICAgcmV0dXJuIHtcbiAgICAgIGFjdGlvbixcbiAgICAgIGdyb3VwTmFtZSxcbiAgICAgIGdyb3VwUGF0aCxcbiAgICAgIHJ1bnRpbWU6IGNvbmZpZy5ydW50aW1lLFxuICAgICAgaW1hZ2U6IGNvbmZpZy5pbWFnZSxcbiAgICAgIGJ1aWxkOiBjb25maWcuY3VzdG9tPy5idWlsZCxcbiAgICAgIGNvbW1hbmRTdHJ1Y3R1cmU6IGNvbmZpZy5jdXN0b20/LmNvbW1hbmRTdHJ1Y3R1cmUsXG4gICAgICB0ZWFyZG93bjogY29uZmlnLmN1c3RvbT8udGVhcmRvd24sXG4gICAgICB0aW1lb3V0TXMsXG4gICAgICBjb25maWc6IHtcbiAgICAgICAgZXhlY3V0YWJsZTogY29uZmlnLmV4ZWN1dGFibGUsXG4gICAgICAgIGN1c3RvbTogY29uZmlnLmN1c3RvbSxcbiAgICAgICAgcWVtdTogY29uZmlnLnFlbXUsXG4gICAgICAgIGhlYWx0aENoZWNrOiBjb25maWcuaGVhbHRoQ2hlY2ssXG4gICAgICB9LFxuICAgICAgLi4uZXh0cmEsXG4gICAgfTtcbiAgfVxuXG4gIHByaXZhdGUgY3JlYXRlU3ludGhldGljUmVzdWx0KHJ1bm5lcklkOiBzdHJpbmcsIHJ1bm5lck5hbWU6IHN0cmluZywgc3Rkb3V0OiBzdHJpbmcsIHN1Y2Nlc3MgPSB0cnVlKTogbG9vbVJ1blJlc3VsdCB7XG4gICAgY29uc3Qgbm93ID0gbmV3IERhdGUoKS50b0lTT1N0cmluZygpO1xuICAgIHJldHVybiB7XG4gICAgICBydW5uZXJJZCxcbiAgICAgIHJ1bm5lck5hbWUsXG4gICAgICBzdGFydGVkQXQ6IG5vdyxcbiAgICAgIGZpbmlzaGVkQXQ6IG5vdyxcbiAgICAgIGR1cmF0aW9uTXM6IDAsXG4gICAgICBleGl0Q29kZTogc3VjY2VzcyA/IDAgOiAtMSxcbiAgICAgIHN0ZG91dCxcbiAgICAgIHN0ZGVycjogXCJcIixcbiAgICAgIHN1Y2Nlc3MsXG4gICAgICB0aW1lZE91dDogZmFsc2UsXG4gICAgICBjYW5jZWxsZWQ6IGZhbHNlLFxuICAgIH07XG4gIH1cblxuICBwcml2YXRlIGdldENvbnRhaW5lcnNQYXRoKCk6IHN0cmluZyB7XG4gICAgY29uc3QgYWRhcHRlckJhc2VQYXRoID0gKHRoaXMuYXBwLnZhdWx0LmFkYXB0ZXIgYXMgeyBiYXNlUGF0aD86IHN0cmluZyB9KS5iYXNlUGF0aCA/PyBcIlwiO1xuICAgIHJldHVybiBub3JtYWxpemVGc1BhdGgoam9pbihhZGFwdGVyQmFzZVBhdGgsIHRoaXMucGx1Z2luRGlyLCBcImNvbnRhaW5lcnNcIikpO1xuICB9XG5cbiAgcHJpdmF0ZSByZXNvbHZlR3JvdXBQYXRoKGdyb3VwTmFtZTogc3RyaW5nKTogc3RyaW5nIHtcbiAgICBjb25zdCBzYWZlTmFtZSA9IGJhc2VuYW1lKGdyb3VwTmFtZSk7XG4gICAgaWYgKCFzYWZlTmFtZSB8fCBzYWZlTmFtZSAhPT0gZ3JvdXBOYW1lKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYEludmFsaWQgY29udGFpbmVyIGdyb3VwIG5hbWU6ICR7Z3JvdXBOYW1lfWApO1xuICAgIH1cbiAgICByZXR1cm4gbm9ybWFsaXplRnNQYXRoKGpvaW4odGhpcy5nZXRDb250YWluZXJzUGF0aCgpLCBzYWZlTmFtZSkpO1xuICB9XG5cbiAgcHJpdmF0ZSByZXNvbHZlR3JvdXBGaWxlUGF0aChncm91cFBhdGg6IHN0cmluZywgZmlsZVBhdGg6IHN0cmluZyk6IHN0cmluZyB7XG4gICAgY29uc3Qgc2FmZVBhdGggPSBub3JtYWxpemVGc1BhdGgoam9pbihncm91cFBhdGgsIGZpbGVQYXRoKSk7XG4gICAgY29uc3Qgbm9ybWFsaXplZEdyb3VwUGF0aCA9IG5vcm1hbGl6ZUZzUGF0aChncm91cFBhdGgpO1xuICAgIGNvbnN0IHBvc2l4U2FmZVBhdGggPSBzYWZlUGF0aC5yZXBsYWNlKC9cXFxcL2csIFwiL1wiKTtcbiAgICBjb25zdCBwb3NpeEdyb3VwUGF0aCA9IG5vcm1hbGl6ZWRHcm91cFBhdGgucmVwbGFjZSgvXFxcXC9nLCBcIi9cIik7XG4gICAgaWYgKHBvc2l4U2FmZVBhdGggIT09IHBvc2l4R3JvdXBQYXRoICYmICFwb3NpeFNhZmVQYXRoLnN0YXJ0c1dpdGgoYCR7cG9zaXhHcm91cFBhdGh9L2ApKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYEludmFsaWQgUUVNVSBtYW5hZ2VyIHBhdGggb3V0c2lkZSBjb250YWluZXIgZ3JvdXA6ICR7ZmlsZVBhdGh9YCk7XG4gICAgfVxuICAgIHJldHVybiBzYWZlUGF0aDtcbiAgfVxuXG4gIHByaXZhdGUgaW1hZ2VOYW1lRm9yR3JvdXAoZ3JvdXBOYW1lOiBzdHJpbmcpOiBzdHJpbmcge1xuICAgIHJldHVybiBgbG9vbS1jb250YWluZXItJHtncm91cE5hbWUudG9Mb3dlckNhc2UoKS5yZXBsYWNlKC9bXmEtejAtOV8uLV0vZywgXCItXCIpfWA7XG4gIH1cblxuICBwdWJsaWMgZ2V0RGVmYXVsdExhbmd1YWdlQ29uZmlnKGxhbmdJZDogc3RyaW5nLCBzZXR0aW5nczogbG9vbVBsdWdpblNldHRpbmdzKTogbG9vbUNvbnRhaW5lckxhbmd1YWdlQ29uZmlnIHwgbnVsbCB7XG4gICAgaWYgKCFsYW5nSWQpIHJldHVybiBudWxsO1xuICAgIGNvbnN0IG5vcm1hbGl6ZWQgPSBsYW5nSWQudG9Mb3dlckNhc2UoKS50cmltKCk7XG5cbiAgICAvLyBDaGVjayBjdXN0b20gbGFuZ3VhZ2VzIGZpcnN0XG4gICAgY29uc3QgY3VzdG9tID0gc2V0dGluZ3MuY3VzdG9tTGFuZ3VhZ2VzLmZpbmQoKGMpID0+IHtcbiAgICAgIGNvbnN0IG5hbWVzID0gW2MubmFtZSwgLi4uYy5hbGlhc2VzLnNwbGl0KFwiLFwiKS5tYXAoKHMpID0+IHMudHJpbSgpKV0ubWFwKChuKSA9PiBuLnRvTG93ZXJDYXNlKCkpO1xuICAgICAgcmV0dXJuIG5hbWVzLmluY2x1ZGVzKG5vcm1hbGl6ZWQpO1xuICAgIH0pO1xuICAgIGlmIChjdXN0b20pIHtcbiAgICAgIHJldHVybiB7XG4gICAgICAgIGNvbW1hbmQ6IGAke2N1c3RvbS5leGVjdXRhYmxlfSAke2N1c3RvbS5hcmdzfWAudHJpbSgpLFxuICAgICAgICBleHRlbnNpb246IGN1c3RvbS5leHRlbnNpb24gfHwgXCIudHh0XCIsXG4gICAgICB9O1xuICAgIH1cblxuICAgIC8vIFN0YW5kYXJkIGJ1aWx0LWluc1xuICAgIHN3aXRjaCAobm9ybWFsaXplZCkge1xuICAgICAgY2FzZSBcInB5dGhvblwiOlxuICAgICAgY2FzZSBcInB5XCI6XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgY29tbWFuZDogYCR7c2V0dGluZ3MucHl0aG9uRXhlY3V0YWJsZS50cmltKCkgfHwgXCJweXRob24zXCJ9IHtmaWxlfWAsXG4gICAgICAgICAgZXh0ZW5zaW9uOiBcIi5weVwiLFxuICAgICAgICB9O1xuICAgICAgY2FzZSBcImphdmFzY3JpcHRcIjpcbiAgICAgIGNhc2UgXCJqc1wiOlxuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgIGNvbW1hbmQ6IGAke3NldHRpbmdzLm5vZGVFeGVjdXRhYmxlLnRyaW0oKSB8fCBcIm5vZGVcIn0ge2ZpbGV9YCxcbiAgICAgICAgICBleHRlbnNpb246IFwiLmpzXCIsXG4gICAgICAgIH07XG4gICAgICBjYXNlIFwidHlwZXNjcmlwdFwiOlxuICAgICAgY2FzZSBcInRzXCI6XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgY29tbWFuZDogYCR7c2V0dGluZ3MudHlwZXNjcmlwdFRyYW5zcGlsZXJFeGVjdXRhYmxlLnRyaW0oKSB8fCBcInRzLW5vZGVcIn0ge2ZpbGV9YCxcbiAgICAgICAgICBleHRlbnNpb246IFwiLnRzXCIsXG4gICAgICAgIH07XG4gICAgICBjYXNlIFwic2hlbGxcIjpcbiAgICAgIGNhc2UgXCJzaFwiOlxuICAgICAgY2FzZSBcImJhc2hcIjpcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICBjb21tYW5kOiBgJHtzZXR0aW5ncy5zaGVsbEV4ZWN1dGFibGUudHJpbSgpIHx8IFwiYmFzaFwifSB7ZmlsZX1gLFxuICAgICAgICAgIGV4dGVuc2lvbjogXCIuc2hcIixcbiAgICAgICAgfTtcbiAgICAgIGNhc2UgXCJydWJ5XCI6XG4gICAgICBjYXNlIFwicmJcIjpcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICBjb21tYW5kOiBgJHtzZXR0aW5ncy5ydWJ5RXhlY3V0YWJsZS50cmltKCkgfHwgXCJydWJ5XCJ9IHtmaWxlfWAsXG4gICAgICAgICAgZXh0ZW5zaW9uOiBcIi5yYlwiLFxuICAgICAgICB9O1xuICAgICAgY2FzZSBcInBlcmxcIjpcbiAgICAgIGNhc2UgXCJwbFwiOlxuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgIGNvbW1hbmQ6IGAke3NldHRpbmdzLnBlcmxFeGVjdXRhYmxlLnRyaW0oKSB8fCBcInBlcmxcIn0ge2ZpbGV9YCxcbiAgICAgICAgICBleHRlbnNpb246IFwiLnBsXCIsXG4gICAgICAgIH07XG4gICAgICBjYXNlIFwibHVhXCI6XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgY29tbWFuZDogYCR7c2V0dGluZ3MubHVhRXhlY3V0YWJsZS50cmltKCkgfHwgXCJsdWFcIn0ge2ZpbGV9YCxcbiAgICAgICAgICBleHRlbnNpb246IFwiLmx1YVwiLFxuICAgICAgICB9O1xuICAgICAgY2FzZSBcInBocFwiOlxuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgIGNvbW1hbmQ6IGAke3NldHRpbmdzLnBocEV4ZWN1dGFibGUudHJpbSgpIHx8IFwicGhwXCJ9IHtmaWxlfWAsXG4gICAgICAgICAgZXh0ZW5zaW9uOiBcIi5waHBcIixcbiAgICAgICAgfTtcbiAgICAgIGNhc2UgXCJnb1wiOlxuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgIGNvbW1hbmQ6IGAke3NldHRpbmdzLmdvRXhlY3V0YWJsZS50cmltKCkgfHwgXCJnb1wifSBydW4ge2ZpbGV9YCxcbiAgICAgICAgICBleHRlbnNpb246IFwiLmdvXCIsXG4gICAgICAgIH07XG4gICAgICBjYXNlIFwiaGFza2VsbFwiOlxuICAgICAgY2FzZSBcImhzXCI6XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgY29tbWFuZDogYCR7c2V0dGluZ3MuaGFza2VsbEV4ZWN1dGFibGUudHJpbSgpIHx8IFwicnVuZ2hjXCJ9IHtmaWxlfWAsXG4gICAgICAgICAgZXh0ZW5zaW9uOiBcIi5oc1wiLFxuICAgICAgICB9O1xuICAgICAgY2FzZSBcIm9jYW1sXCI6XG4gICAgICBjYXNlIFwibWxcIjpcbiAgICAgICAgaWYgKHNldHRpbmdzLm9jYW1sTW9kZSA9PT0gXCJkdW5lXCIpIHtcbiAgICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgY29tbWFuZDogYCR7c2V0dGluZ3Mub2NhbWxFeGVjdXRhYmxlLnRyaW0oKSB8fCBcImR1bmVcIn0gZXhlYyAtLSBvY2FtbCB7ZmlsZX1gLFxuICAgICAgICAgICAgZXh0ZW5zaW9uOiBcIi5tbFwiLFxuICAgICAgICAgIH07XG4gICAgICAgIH1cbiAgICAgICAgaWYgKHNldHRpbmdzLm9jYW1sTW9kZSA9PT0gXCJvY2FtbGNcIikge1xuICAgICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICBjb21tYW5kOiBzaGVsbENvbW1hbmQoYCR7c2V0dGluZ3Mub2NhbWxFeGVjdXRhYmxlLnRyaW0oKSB8fCBcIm9jYW1sY1wifSAtbyAvdG1wL2xvb20tb2NhbWwgXCIkMVwiICYmIC90bXAvbG9vbS1vY2FtbGApLFxuICAgICAgICAgICAgZXh0ZW5zaW9uOiBcIi5tbFwiLFxuICAgICAgICAgIH07XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICBjb21tYW5kOiBgJHtzZXR0aW5ncy5vY2FtbEV4ZWN1dGFibGUudHJpbSgpIHx8IFwib2NhbWxcIn0ge2ZpbGV9YCxcbiAgICAgICAgICBleHRlbnNpb246IFwiLm1sXCIsXG4gICAgICAgIH07XG4gICAgICBjYXNlIFwiY1wiOlxuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgIGNvbW1hbmQ6IHNoZWxsQ29tbWFuZChgJHtzZXR0aW5ncy5jRXhlY3V0YWJsZS50cmltKCkgfHwgXCJnY2NcIn0gXCIkMVwiIC1vIC90bXAvbG9vbS1jICYmIC90bXAvbG9vbS1jYCksXG4gICAgICAgICAgZXh0ZW5zaW9uOiBcIi5jXCIsXG4gICAgICAgIH07XG4gICAgICBjYXNlIFwiY3BwXCI6XG4gICAgICBjYXNlIFwiYysrXCI6XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgY29tbWFuZDogc2hlbGxDb21tYW5kKGAke3NldHRpbmdzLmNwcEV4ZWN1dGFibGUudHJpbSgpIHx8IFwiZysrXCJ9IFwiJDFcIiAtbyAvdG1wL2xvb20tY3BwICYmIC90bXAvbG9vbS1jcHBgKSxcbiAgICAgICAgICBleHRlbnNpb246IFwiLmNwcFwiLFxuICAgICAgICB9O1xuICAgICAgY2FzZSBcInJ1c3RcIjpcbiAgICAgIGNhc2UgXCJyc1wiOlxuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgIGNvbW1hbmQ6IHNoZWxsQ29tbWFuZChgJHtzZXR0aW5ncy5ydXN0RXhlY3V0YWJsZS50cmltKCkgfHwgXCJydXN0Y1wifSBcIiQxXCIgLW8gL3RtcC9sb29tLXJ1c3QgJiYgL3RtcC9sb29tLXJ1c3RgKSxcbiAgICAgICAgICBleHRlbnNpb246IFwiLnJzXCIsXG4gICAgICAgIH07XG4gICAgICBjYXNlIFwiamF2YVwiOiB7XG4gICAgICAgIGNvbnN0IGNvbXBpbGVyID0gc2V0dGluZ3MuamF2YUNvbXBpbGVyRXhlY3V0YWJsZS50cmltKCkgfHwgXCJqYXZhY1wiO1xuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgIGNvbW1hbmQ6IHNoZWxsQ29tbWFuZChgdG1wPS90bXAvbG9vbS1qYXZhLSQkICYmIG1rZGlyIC1wIFwiJHRtcFwiICYmIGNwIFwiJDFcIiBcIiR0bXAvTWFpbi5qYXZhXCIgJiYgJHtjb21waWxlcn0gXCIkdG1wL01haW4uamF2YVwiICYmICR7c2V0dGluZ3MuamF2YUV4ZWN1dGFibGUudHJpbSgpIHx8IFwiamF2YVwifSAtY3AgXCIkdG1wXCIgTWFpbmApLFxuICAgICAgICAgIGV4dGVuc2lvbjogXCIuamF2YVwiLFxuICAgICAgICB9O1xuICAgICAgfVxuICAgICAgY2FzZSBcImxsdm0taXJcIjpcbiAgICAgIGNhc2UgXCJsbHZtXCI6XG4gICAgICBjYXNlIFwibGxcIjpcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICBjb21tYW5kOiBgJHtzZXR0aW5ncy5sbHZtSW50ZXJwcmV0ZXJFeGVjdXRhYmxlLnRyaW0oKSB8fCBcImxsaVwifSB7ZmlsZX1gLFxuICAgICAgICAgIGV4dGVuc2lvbjogXCIubGxcIixcbiAgICAgICAgfTtcbiAgICAgIGNhc2UgXCJsZWFuXCI6XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgY29tbWFuZDogYCR7c2V0dGluZ3MubGVhbkV4ZWN1dGFibGUudHJpbSgpIHx8IFwibGVhblwifSB7ZmlsZX1gLFxuICAgICAgICAgIGV4dGVuc2lvbjogXCIubGVhblwiLFxuICAgICAgICB9O1xuICAgICAgY2FzZSBcImNvcVwiOlxuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgIGNvbW1hbmQ6IGAke3NldHRpbmdzLmNvcUV4ZWN1dGFibGUudHJpbSgpIHx8IFwiY29xY1wifSAtcSB7ZmlsZX1gLFxuICAgICAgICAgIGV4dGVuc2lvbjogXCIudlwiLFxuICAgICAgICB9O1xuICAgICAgY2FzZSBcInNtdGxpYlwiOlxuICAgICAgY2FzZSBcInNtdFwiOlxuICAgICAgY2FzZSBcInNtdC1saWJcIjpcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICBjb21tYW5kOiBgJHtzZXR0aW5ncy5zbXRFeGVjdXRhYmxlLnRyaW0oKSB8fCBcInozXCJ9IHtmaWxlfWAsXG4gICAgICAgICAgZXh0ZW5zaW9uOiBcIi5zbXQyXCIsXG4gICAgICAgIH07XG4gICAgfVxuICAgIHJldHVybiBudWxsO1xuICB9XG59XG5cbmZ1bmN0aW9uIHNoZWxsQ29tbWFuZChjb21tYW5kOiBzdHJpbmcpOiBzdHJpbmcge1xuICByZXR1cm4gYHNoIC1sYyAke3F1b3RlQ29tbWFuZEFyZyhjb21tYW5kKX0gc2gge2ZpbGV9YDtcbn1cblxuZnVuY3Rpb24gbm9ybWFsaXplRXh0ZW5zaW9uKGV4dGVuc2lvbjogc3RyaW5nKTogc3RyaW5nIHtcbiAgY29uc3QgdHJpbW1lZCA9IGV4dGVuc2lvbi50cmltKCk7XG4gIHJldHVybiB0cmltbWVkLnN0YXJ0c1dpdGgoXCIuXCIpID8gdHJpbW1lZCA6IGAuJHt0cmltbWVkfWA7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBzaG93RG9ja2VyTm90aWNlKG1lc3NhZ2U6IHN0cmluZyk6IHZvaWQge1xuICBuZXcgTm90aWNlKG1lc3NhZ2UsIDgwMDApO1xufVxuXG5mdW5jdGlvbiBvcHRpb25hbFN0cmluZyh2YWx1ZTogdW5rbm93bik6IHN0cmluZyB8IHVuZGVmaW5lZCB7XG4gIHJldHVybiB0eXBlb2YgdmFsdWUgPT09IFwic3RyaW5nXCIgJiYgdmFsdWUudHJpbSgpID8gdmFsdWUudHJpbSgpIDogdW5kZWZpbmVkO1xufVxuXG5mdW5jdGlvbiBvcHRpb25hbFBvc2l0aXZlSW50ZWdlcih2YWx1ZTogdW5rbm93biwgbGFiZWw6IHN0cmluZyk6IG51bWJlciB8IHVuZGVmaW5lZCB7XG4gIGlmICh2YWx1ZSA9PSBudWxsKSB7XG4gICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgfVxuICBpZiAodHlwZW9mIHZhbHVlICE9PSBcIm51bWJlclwiIHx8ICFOdW1iZXIuaXNJbnRlZ2VyKHZhbHVlKSB8fCB2YWx1ZSA8PSAwKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGAke2xhYmVsfSBtdXN0IGJlIGEgcG9zaXRpdmUgaW50ZWdlci5gKTtcbiAgfVxuICByZXR1cm4gdmFsdWU7XG59XG5cbmZ1bmN0aW9uIG9wdGlvbmFsTm9uTmVnYXRpdmVJbnRlZ2VyKHZhbHVlOiB1bmtub3duLCBsYWJlbDogc3RyaW5nKTogbnVtYmVyIHwgdW5kZWZpbmVkIHtcbiAgaWYgKHZhbHVlID09IG51bGwpIHtcbiAgICByZXR1cm4gdW5kZWZpbmVkO1xuICB9XG4gIGlmICh0eXBlb2YgdmFsdWUgIT09IFwibnVtYmVyXCIgfHwgIU51bWJlci5pc0ludGVnZXIodmFsdWUpIHx8IHZhbHVlIDwgMCkge1xuICAgIHRocm93IG5ldyBFcnJvcihgJHtsYWJlbH0gbXVzdCBiZSBhIG5vbi1uZWdhdGl2ZSBpbnRlZ2VyLmApO1xuICB9XG4gIHJldHVybiB2YWx1ZTtcbn1cblxuZnVuY3Rpb24gb3B0aW9uYWxTaWduYWwodmFsdWU6IHVua25vd24sIGxhYmVsOiBzdHJpbmcpOiBOb2RlSlMuU2lnbmFscyB8IHVuZGVmaW5lZCB7XG4gIGlmICh2YWx1ZSA9PSBudWxsKSB7XG4gICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgfVxuICBpZiAodHlwZW9mIHZhbHVlICE9PSBcInN0cmluZ1wiIHx8ICEvXlNJR1tBLVowLTldKyQvLnRlc3QodmFsdWUpKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGAke2xhYmVsfSBtdXN0IGJlIGEgc2lnbmFsIG5hbWUgbGlrZSBTSUdURVJNLmApO1xuICB9XG4gIHJldHVybiB2YWx1ZSBhcyBOb2RlSlMuU2lnbmFscztcbn1cblxuYXN5bmMgZnVuY3Rpb24gc2xlZXBXaXRoU2lnbmFsKGR1cmF0aW9uTXM6IG51bWJlciwgc2lnbmFsOiBBYm9ydFNpZ25hbCk6IFByb21pc2U8dm9pZD4ge1xuICBpZiAoZHVyYXRpb25NcyA8PSAwIHx8IHNpZ25hbC5hYm9ydGVkKSB7XG4gICAgcmV0dXJuO1xuICB9XG5cbiAgYXdhaXQgbmV3IFByb21pc2U8dm9pZD4oKHJlc29sdmUpID0+IHtcbiAgICBjb25zdCB0aW1lb3V0ID0gc2V0VGltZW91dChyZXNvbHZlLCBkdXJhdGlvbk1zKTtcbiAgICBjb25zdCBhYm9ydCA9ICgpID0+IHtcbiAgICAgIGNsZWFyVGltZW91dCh0aW1lb3V0KTtcbiAgICAgIHJlc29sdmUoKTtcbiAgICB9O1xuICAgIHNpZ25hbC5hZGRFdmVudExpc3RlbmVyKFwiYWJvcnRcIiwgYWJvcnQsIHsgb25jZTogdHJ1ZSB9KTtcbiAgfSk7XG59XG5cbmZ1bmN0aW9uIHJ1bnRpbWVMYWJlbChydW50aW1lOiBsb29tQ29udGFpbmVyUnVudGltZSk6IHN0cmluZyB7XG4gIHN3aXRjaCAocnVudGltZSkge1xuICAgIGNhc2UgXCJkb2NrZXJcIjpcbiAgICAgIHJldHVybiBcIkRvY2tlclwiO1xuICAgIGNhc2UgXCJwb2RtYW5cIjpcbiAgICAgIHJldHVybiBcIlBvZG1hblwiO1xuICAgIGNhc2UgXCJxZW11XCI6XG4gICAgICByZXR1cm4gXCJRRU1VXCI7XG4gICAgY2FzZSBcImN1c3RvbVwiOlxuICAgICAgcmV0dXJuIFwiQ3VzdG9tXCI7XG4gICAgY2FzZSBcIndzbFwiOlxuICAgICAgcmV0dXJuIFwiV1NMXCI7XG4gIH1cbn1cblxuZnVuY3Rpb24gc2hlbGxRdW90ZSh2YWx1ZTogc3RyaW5nKTogc3RyaW5nIHtcbiAgcmV0dXJuIGAnJHt2YWx1ZS5yZXBsYWNlQWxsKFwiJ1wiLCBcIidcXFxcJydcIil9J2A7XG59XG5cbmZ1bmN0aW9uIHF1b3RlQ29tbWFuZEFyZyh2YWx1ZTogc3RyaW5nKTogc3RyaW5nIHtcbiAgcmV0dXJuIGAnJHt2YWx1ZS5yZXBsYWNlQWxsKFwiJ1wiLCBcIidcXFxcJydcIil9J2A7XG59XG4iLCAiaW1wb3J0IHsgbWtkdGVtcCwgcm0sIHdyaXRlRmlsZSB9IGZyb20gXCJmcy9wcm9taXNlc1wiO1xuaW1wb3J0IHsgdG1wZGlyIH0gZnJvbSBcIm9zXCI7XG5pbXBvcnQgeyBqb2luIH0gZnJvbSBcInBhdGhcIjtcbmltcG9ydCB7IHNwYXduIH0gZnJvbSBcImNoaWxkX3Byb2Nlc3NcIjtcbmltcG9ydCB0eXBlIHsgbG9vbVJ1blJlc3VsdCB9IGZyb20gXCIuLi90eXBlc1wiO1xuXG5leHBvcnQgaW50ZXJmYWNlIGxvb21Qcm9jZXNzU3BlYyB7XG4gIHJ1bm5lcklkOiBzdHJpbmc7XG4gIHJ1bm5lck5hbWU6IHN0cmluZztcbiAgZXhlY3V0YWJsZTogc3RyaW5nO1xuICBhcmdzOiBzdHJpbmdbXTtcbiAgd29ya2luZ0RpcmVjdG9yeTogc3RyaW5nO1xuICB0aW1lb3V0TXM6IG51bWJlcjtcbiAgc2lnbmFsOiBBYm9ydFNpZ25hbDtcbiAgZW52PzogTm9kZUpTLlByb2Nlc3NFbnY7XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgbG9vbVRlbXBTb3VyY2VTcGVjIGV4dGVuZHMgbG9vbVByb2Nlc3NTcGVjIHtcbiAgZmlsZUV4dGVuc2lvbjogc3RyaW5nO1xuICBzb3VyY2U6IHN0cmluZztcbn1cblxuZXhwb3J0IGludGVyZmFjZSBsb29tVGVtcFNvdXJjZUhhbmRsZSB7XG4gIHRlbXBEaXI6IHN0cmluZztcbiAgdGVtcEZpbGU6IHN0cmluZztcbn1cblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHdpdGhOYW1lZFRlbXBTb3VyY2VGaWxlPFQ+KFxuICBmaWxlTmFtZTogc3RyaW5nLFxuICBzb3VyY2U6IHN0cmluZyxcbiAgY2FsbGJhY2s6IChoYW5kbGU6IGxvb21UZW1wU291cmNlSGFuZGxlKSA9PiBQcm9taXNlPFQ+LFxuKTogUHJvbWlzZTxUPiB7XG4gIGNvbnN0IHRlbXBEaXIgPSBhd2FpdCBta2R0ZW1wKGpvaW4odG1wZGlyKCksIFwibG9vbS1cIikpO1xuICBjb25zdCB0ZW1wRmlsZSA9IGpvaW4odGVtcERpciwgZmlsZU5hbWUpO1xuXG4gIHRyeSB7XG4gICAgYXdhaXQgd3JpdGVGaWxlKHRlbXBGaWxlLCBub3JtYWxpemVFeGVjdXRhYmxlU291cmNlKHNvdXJjZSksIFwidXRmOFwiKTtcbiAgICByZXR1cm4gYXdhaXQgY2FsbGJhY2soeyB0ZW1wRGlyLCB0ZW1wRmlsZSB9KTtcbiAgfSBmaW5hbGx5IHtcbiAgICBhd2FpdCBybSh0ZW1wRGlyLCB7IHJlY3Vyc2l2ZTogdHJ1ZSwgZm9yY2U6IHRydWUgfSk7XG4gIH1cbn1cblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHdpdGhUZW1wU291cmNlRmlsZTxUPihcbiAgZmlsZUV4dGVuc2lvbjogc3RyaW5nLFxuICBzb3VyY2U6IHN0cmluZyxcbiAgY2FsbGJhY2s6IChoYW5kbGU6IGxvb21UZW1wU291cmNlSGFuZGxlKSA9PiBQcm9taXNlPFQ+LFxuKTogUHJvbWlzZTxUPiB7XG4gIHJldHVybiB3aXRoTmFtZWRUZW1wU291cmNlRmlsZShgc25pcHBldCR7ZmlsZUV4dGVuc2lvbn1gLCBzb3VyY2UsIGNhbGxiYWNrKTtcbn1cblxuZnVuY3Rpb24gbm9ybWFsaXplRXhlY3V0YWJsZVNvdXJjZShzb3VyY2U6IHN0cmluZyk6IHN0cmluZyB7XG4gIGNvbnN0IGxpbmVzID0gc291cmNlLnNwbGl0KFwiXFxuXCIpO1xuICBjb25zdCBub25FbXB0eUxpbmVzID0gbGluZXMuZmlsdGVyKChsaW5lKSA9PiBsaW5lLnRyaW0oKS5sZW5ndGggPiAwKTtcbiAgaWYgKCFub25FbXB0eUxpbmVzLmxlbmd0aCkge1xuICAgIHJldHVybiBzb3VyY2U7XG4gIH1cblxuICBsZXQgc2hhcmVkSW5kZW50ID0gZ2V0TGVhZGluZ1doaXRlc3BhY2Uobm9uRW1wdHlMaW5lc1swXSk7XG4gIGZvciAoY29uc3QgbGluZSBvZiBub25FbXB0eUxpbmVzLnNsaWNlKDEpKSB7XG4gICAgc2hhcmVkSW5kZW50ID0gc2hhcmVkV2hpdGVzcGFjZVByZWZpeChzaGFyZWRJbmRlbnQsIGdldExlYWRpbmdXaGl0ZXNwYWNlKGxpbmUpKTtcbiAgICBpZiAoIXNoYXJlZEluZGVudCkge1xuICAgICAgcmV0dXJuIHNvdXJjZTtcbiAgICB9XG4gIH1cblxuICBpZiAoIXNoYXJlZEluZGVudCkge1xuICAgIHJldHVybiBzb3VyY2U7XG4gIH1cblxuICByZXR1cm4gbGluZXNcbiAgICAubWFwKChsaW5lKSA9PiAobGluZS50cmltKCkubGVuZ3RoID09PSAwID8gbGluZSA6IGxpbmUuc3RhcnRzV2l0aChzaGFyZWRJbmRlbnQpID8gbGluZS5zbGljZShzaGFyZWRJbmRlbnQubGVuZ3RoKSA6IGxpbmUpKVxuICAgIC5qb2luKFwiXFxuXCIpO1xufVxuXG5mdW5jdGlvbiBnZXRMZWFkaW5nV2hpdGVzcGFjZShsaW5lOiBzdHJpbmcpOiBzdHJpbmcge1xuICBjb25zdCBtYXRjaCA9IGxpbmUubWF0Y2goL15bXFx0IF0qLyk7XG4gIHJldHVybiBtYXRjaD8uWzBdID8/IFwiXCI7XG59XG5cbmZ1bmN0aW9uIHNoYXJlZFdoaXRlc3BhY2VQcmVmaXgobGVmdDogc3RyaW5nLCByaWdodDogc3RyaW5nKTogc3RyaW5nIHtcbiAgbGV0IGluZGV4ID0gMDtcbiAgd2hpbGUgKGluZGV4IDwgbGVmdC5sZW5ndGggJiYgaW5kZXggPCByaWdodC5sZW5ndGggJiYgbGVmdFtpbmRleF0gPT09IHJpZ2h0W2luZGV4XSkge1xuICAgIGluZGV4ICs9IDE7XG4gIH1cbiAgcmV0dXJuIGxlZnQuc2xpY2UoMCwgaW5kZXgpO1xufVxuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gcnVuUHJvY2VzcyhzcGVjOiBsb29tUHJvY2Vzc1NwZWMpOiBQcm9taXNlPGxvb21SdW5SZXN1bHQ+IHtcbiAgY29uc3Qgc3RhcnRlZEF0ID0gbmV3IERhdGUoKTtcbiAgbGV0IHN0ZG91dCA9IFwiXCI7XG4gIGxldCBzdGRlcnIgPSBcIlwiO1xuICBsZXQgZXhpdENvZGU6IG51bWJlciB8IG51bGwgPSBudWxsO1xuICBsZXQgdGltZWRPdXQgPSBmYWxzZTtcbiAgbGV0IGNhbmNlbGxlZCA9IGZhbHNlO1xuICBsZXQgY2hpbGQ6IFJldHVyblR5cGU8dHlwZW9mIHNwYXduPiB8IG51bGwgPSBudWxsO1xuICBsZXQgdGltZW91dEhhbmRsZTogTm9kZUpTLlRpbWVvdXQgfCBudWxsID0gbnVsbDtcbiAgbGV0IGFib3J0SGFuZGxlcjogKCgpID0+IHZvaWQpIHwgbnVsbCA9IG51bGw7XG5cbiAgdHJ5IHtcbiAgICBhd2FpdCBuZXcgUHJvbWlzZTx2b2lkPigocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG4gICAgICBjaGlsZCA9IHNwYXduKHNwZWMuZXhlY3V0YWJsZSwgc3BlYy5hcmdzLCB7XG4gICAgICAgIGN3ZDogc3BlYy53b3JraW5nRGlyZWN0b3J5LFxuICAgICAgICBzaGVsbDogZmFsc2UsXG4gICAgICAgIGVudjoge1xuICAgICAgICAgIC4uLnByb2Nlc3MuZW52LFxuICAgICAgICAgIC4uLnNwZWMuZW52LFxuICAgICAgICB9LFxuICAgICAgfSk7XG5cbiAgICAgIGNvbnN0IGFib3J0ID0gKCkgPT4ge1xuICAgICAgICBjYW5jZWxsZWQgPSB0cnVlO1xuICAgICAgICBjaGlsZD8ua2lsbChcIlNJR1RFUk1cIik7XG4gICAgICB9O1xuICAgICAgYWJvcnRIYW5kbGVyID0gYWJvcnQ7XG5cbiAgICAgIGlmIChzcGVjLnNpZ25hbC5hYm9ydGVkKSB7XG4gICAgICAgIGFib3J0KCk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBzcGVjLnNpZ25hbC5hZGRFdmVudExpc3RlbmVyKFwiYWJvcnRcIiwgYWJvcnQsIHsgb25jZTogdHJ1ZSB9KTtcbiAgICAgIH1cblxuICAgICAgdGltZW91dEhhbmRsZSA9IHNldFRpbWVvdXQoKCkgPT4ge1xuICAgICAgICB0aW1lZE91dCA9IHRydWU7XG4gICAgICAgIGNoaWxkPy5raWxsKFwiU0lHVEVSTVwiKTtcbiAgICAgIH0sIHNwZWMudGltZW91dE1zKTtcblxuICAgICAgY2hpbGQuc3Rkb3V0Py5vbihcImRhdGFcIiwgKGNodW5rKSA9PiB7XG4gICAgICAgIHN0ZG91dCArPSBjaHVuay50b1N0cmluZygpO1xuICAgICAgfSk7XG5cbiAgICAgIGNoaWxkLnN0ZGVycj8ub24oXCJkYXRhXCIsIChjaHVuaykgPT4ge1xuICAgICAgICBzdGRlcnIgKz0gY2h1bmsudG9TdHJpbmcoKTtcbiAgICAgIH0pO1xuXG4gICAgICBjaGlsZC5vbihcImVycm9yXCIsIChlcnJvcikgPT4ge1xuICAgICAgICByZWplY3QoZXJyb3IpO1xuICAgICAgfSk7XG5cbiAgICAgIGNoaWxkLm9uKFwiY2xvc2VcIiwgKGNvZGUpID0+IHtcbiAgICAgICAgZXhpdENvZGUgPSBjb2RlO1xuICAgICAgICByZXNvbHZlKCk7XG4gICAgICB9KTtcbiAgICB9KTtcbiAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICBzdGRlcnIgPSBzdGRlcnIgfHwgZm9ybWF0UHJvY2Vzc0Vycm9yKGVycm9yLCBzcGVjLmV4ZWN1dGFibGUpO1xuICAgIGV4aXRDb2RlID0gZXhpdENvZGUgPz8gLTE7XG4gIH0gZmluYWxseSB7XG4gICAgaWYgKGFib3J0SGFuZGxlcikge1xuICAgICAgc3BlYy5zaWduYWwucmVtb3ZlRXZlbnRMaXN0ZW5lcihcImFib3J0XCIsIGFib3J0SGFuZGxlcik7XG4gICAgfVxuICAgIGlmICh0aW1lb3V0SGFuZGxlKSB7XG4gICAgICBjbGVhclRpbWVvdXQodGltZW91dEhhbmRsZSk7XG4gICAgfVxuICB9XG5cbiAgY29uc3QgZmluaXNoZWRBdCA9IG5ldyBEYXRlKCk7XG4gIGNvbnN0IGR1cmF0aW9uTXMgPSBmaW5pc2hlZEF0LmdldFRpbWUoKSAtIHN0YXJ0ZWRBdC5nZXRUaW1lKCk7XG4gIGNvbnN0IHN1Y2Nlc3MgPSAhdGltZWRPdXQgJiYgIWNhbmNlbGxlZCAmJiBleGl0Q29kZSA9PT0gMDtcblxuICByZXR1cm4ge1xuICAgIHJ1bm5lcklkOiBzcGVjLnJ1bm5lcklkLFxuICAgIHJ1bm5lck5hbWU6IHNwZWMucnVubmVyTmFtZSxcbiAgICBzdGFydGVkQXQ6IHN0YXJ0ZWRBdC50b0lTT1N0cmluZygpLFxuICAgIGZpbmlzaGVkQXQ6IGZpbmlzaGVkQXQudG9JU09TdHJpbmcoKSxcbiAgICBkdXJhdGlvbk1zLFxuICAgIGV4aXRDb2RlLFxuICAgIHN0ZG91dCxcbiAgICBzdGRlcnIsXG4gICAgc3VjY2VzcyxcbiAgICB0aW1lZE91dCxcbiAgICBjYW5jZWxsZWQsXG4gIH07XG59XG5cbmZ1bmN0aW9uIGZvcm1hdFByb2Nlc3NFcnJvcihlcnJvcjogdW5rbm93biwgZXhlY3V0YWJsZTogc3RyaW5nKTogc3RyaW5nIHtcbiAgaWYgKGVycm9yIGluc3RhbmNlb2YgRXJyb3IgJiYgXCJjb2RlXCIgaW4gZXJyb3IgJiYgKGVycm9yIGFzIE5vZGVKUy5FcnJub0V4Y2VwdGlvbikuY29kZSA9PT0gXCJFTk9FTlRcIikge1xuICAgIHJldHVybiBgRXhlY3V0YWJsZSBub3QgZm91bmQ6ICR7ZXhlY3V0YWJsZX1gO1xuICB9XG5cbiAgcmV0dXJuIGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogU3RyaW5nKGVycm9yKTtcbn1cblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHJ1blRlbXBGaWxlUHJvY2VzcyhzcGVjOiBsb29tVGVtcFNvdXJjZVNwZWMpOiBQcm9taXNlPGxvb21SdW5SZXN1bHQ+IHtcbiAgcmV0dXJuIHdpdGhUZW1wU291cmNlRmlsZShzcGVjLmZpbGVFeHRlbnNpb24sIHNwZWMuc291cmNlLCBhc3luYyAoeyB0ZW1wRmlsZSwgdGVtcERpciB9KSA9PlxuICAgIHJ1blByb2Nlc3Moe1xuICAgICAgcnVubmVySWQ6IHNwZWMucnVubmVySWQsXG4gICAgICBydW5uZXJOYW1lOiBzcGVjLnJ1bm5lck5hbWUsXG4gICAgICBleGVjdXRhYmxlOiBzcGVjLmV4ZWN1dGFibGUsXG4gICAgICBhcmdzOiBzcGVjLmFyZ3MubWFwKCh2YWx1ZSkgPT4gdmFsdWUucmVwbGFjZUFsbChcIntmaWxlfVwiLCB0ZW1wRmlsZSkucmVwbGFjZUFsbChcInt0ZW1wRGlyfVwiLCB0ZW1wRGlyKSksXG4gICAgICB3b3JraW5nRGlyZWN0b3J5OiBzcGVjLndvcmtpbmdEaXJlY3RvcnksXG4gICAgICB0aW1lb3V0TXM6IHNwZWMudGltZW91dE1zLFxuICAgICAgc2lnbmFsOiBzcGVjLnNpZ25hbCxcbiAgICAgIGVudjogZXhwYW5kVGVtcGxhdGVkRW52KHNwZWMuZW52LCB0ZW1wRmlsZSwgdGVtcERpciksXG4gICAgfSksXG4gICk7XG59XG5cbmZ1bmN0aW9uIGV4cGFuZFRlbXBsYXRlZEVudihlbnY6IE5vZGVKUy5Qcm9jZXNzRW52IHwgdW5kZWZpbmVkLCB0ZW1wRmlsZTogc3RyaW5nLCB0ZW1wRGlyOiBzdHJpbmcpOiBOb2RlSlMuUHJvY2Vzc0VudiB8IHVuZGVmaW5lZCB7XG4gIGlmICghZW52KSB7XG4gICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgfVxuXG4gIHJldHVybiBPYmplY3QuZnJvbUVudHJpZXMoXG4gICAgT2JqZWN0LmVudHJpZXMoZW52KS5tYXAoKFtrZXksIHZhbHVlXSkgPT4gW1xuICAgICAga2V5LFxuICAgICAgdHlwZW9mIHZhbHVlID09PSBcInN0cmluZ1wiID8gdmFsdWUucmVwbGFjZUFsbChcIntmaWxlfVwiLCB0ZW1wRmlsZSkucmVwbGFjZUFsbChcInt0ZW1wRGlyfVwiLCB0ZW1wRGlyKSA6IHZhbHVlLFxuICAgIF0pLFxuICApO1xufVxuIiwgImV4cG9ydCBmdW5jdGlvbiBzcGxpdENvbW1hbmRMaW5lKGlucHV0OiBzdHJpbmcpOiBzdHJpbmdbXSB7XG4gIGNvbnN0IHBhcnRzOiBzdHJpbmdbXSA9IFtdO1xuICBsZXQgY3VycmVudCA9IFwiXCI7XG4gIGxldCBxdW90ZTogXCInXCIgfCBcIlxcXCJcIiB8IG51bGwgPSBudWxsO1xuICBsZXQgZXNjYXBpbmcgPSBmYWxzZTtcblxuICBmb3IgKGNvbnN0IGNoYXIgb2YgaW5wdXQudHJpbSgpKSB7XG4gICAgaWYgKGVzY2FwaW5nKSB7XG4gICAgICBjdXJyZW50ICs9IGNoYXI7XG4gICAgICBlc2NhcGluZyA9IGZhbHNlO1xuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgaWYgKGNoYXIgPT09IFwiXFxcXFwiKSB7XG4gICAgICBlc2NhcGluZyA9IHRydWU7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICBpZiAoKGNoYXIgPT09IFwiJ1wiIHx8IGNoYXIgPT09IFwiXFxcIlwiKSAmJiAhcXVvdGUpIHtcbiAgICAgIHF1b3RlID0gY2hhcjtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cblxuICAgIGlmIChjaGFyID09PSBxdW90ZSkge1xuICAgICAgcXVvdGUgPSBudWxsO1xuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgaWYgKC9cXHMvLnRlc3QoY2hhcikgJiYgIXF1b3RlKSB7XG4gICAgICBpZiAoY3VycmVudCkge1xuICAgICAgICBwYXJ0cy5wdXNoKGN1cnJlbnQpO1xuICAgICAgICBjdXJyZW50ID0gXCJcIjtcbiAgICAgIH1cbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cblxuICAgIGN1cnJlbnQgKz0gY2hhcjtcbiAgfVxuXG4gIGlmIChjdXJyZW50KSB7XG4gICAgcGFydHMucHVzaChjdXJyZW50KTtcbiAgfVxuXG4gIHJldHVybiBwYXJ0cztcbn1cbiIsICJpbXBvcnQgeyBEZWNvcmF0aW9uLCB0eXBlIEVkaXRvclZpZXcgfSBmcm9tIFwiQGNvZGVtaXJyb3Ivdmlld1wiO1xuaW1wb3J0IHR5cGUgeyBSYW5nZVNldEJ1aWxkZXIgfSBmcm9tIFwiQGNvZGVtaXJyb3Ivc3RhdGVcIjtcbmltcG9ydCB0eXBlIHsgbG9vbUNvZGVCbG9jayB9IGZyb20gXCIuL3R5cGVzXCI7XG5cbmludGVyZmFjZSBMbHZtVG9rZW4ge1xuICBmcm9tOiBudW1iZXI7XG4gIHRvOiBudW1iZXI7XG4gIGNsYXNzTmFtZTogc3RyaW5nO1xufVxuXG5jb25zdCBMTFZNX0tFWVdPUkRTID0gbmV3IE1hcDxzdHJpbmcsIHN0cmluZz4oW1xuICAuLi5tYXBXb3JkcyhcImxvb20tbGx2bS1rZXl3b3JkLWNvbnRyb2xcIiwgW1xuICAgIFwicmV0XCIsIFwiYnJcIiwgXCJzd2l0Y2hcIiwgXCJpbmRpcmVjdGJyXCIsIFwiaW52b2tlXCIsIFwiY2FsbGJyXCIsIFwicmVzdW1lXCIsIFwidW5yZWFjaGFibGVcIiwgXCJjbGVhbnVwcmV0XCIsIFwiY2F0Y2hyZXRcIiwgXCJjYXRjaHN3aXRjaFwiLFxuICBdKSxcbiAgLi4ubWFwV29yZHMoXCJsb29tLWxsdm0ta2V5d29yZC1kZWNsYXJhdGlvblwiLCBbXG4gICAgXCJkZWZpbmVcIiwgXCJkZWNsYXJlXCIsIFwidHlwZVwiLCBcImdsb2JhbFwiLCBcImNvbnN0YW50XCIsIFwiYWxpYXNcIiwgXCJpZnVuY1wiLCBcImNvbWRhdFwiLCBcImF0dHJpYnV0ZXNcIiwgXCJzZWN0aW9uXCIsIFwiZ2NcIiwgXCJwcmVmaXhcIiwgXCJwcm9sb2d1ZVwiLFxuICAgIFwicGVyc29uYWxpdHlcIiwgXCJ1c2VsaXN0b3JkZXJcIiwgXCJ1c2VsaXN0b3JkZXJfYmJcIiwgXCJtb2R1bGVcIiwgXCJhc21cIiwgXCJzb3VyY2VfZmlsZW5hbWVcIiwgXCJ0YXJnZXRcIixcbiAgXSksXG4gIC4uLm1hcFdvcmRzKFwibG9vbS1sbHZtLWtleXdvcmQtbWVtb3J5XCIsIFtcbiAgICBcImFsbG9jYVwiLCBcImxvYWRcIiwgXCJzdG9yZVwiLCBcImdldGVsZW1lbnRwdHJcIiwgXCJmZW5jZVwiLCBcImNtcHhjaGdcIiwgXCJhdG9taWNybXdcIiwgXCJleHRyYWN0dmFsdWVcIiwgXCJpbnNlcnR2YWx1ZVwiLCBcImV4dHJhY3RlbGVtZW50XCIsXG4gICAgXCJpbnNlcnRlbGVtZW50XCIsIFwic2h1ZmZsZXZlY3RvclwiLFxuICBdKSxcbiAgLi4ubWFwV29yZHMoXCJsb29tLWxsdm0ta2V5d29yZC1hcml0aG1ldGljXCIsIFtcbiAgICBcImFkZFwiLCBcInN1YlwiLCBcIm11bFwiLCBcInVkaXZcIiwgXCJzZGl2XCIsIFwidXJlbVwiLCBcInNyZW1cIiwgXCJzaGxcIiwgXCJsc2hyXCIsIFwiYXNoclwiLCBcImFuZFwiLCBcIm9yXCIsIFwieG9yXCIsIFwiZm5lZ1wiLCBcImZhZGRcIiwgXCJmc3ViXCIsIFwiZm11bFwiLFxuICAgIFwiZmRpdlwiLCBcImZyZW1cIixcbiAgXSksXG4gIC4uLm1hcFdvcmRzKFwibG9vbS1sbHZtLWtleXdvcmQtY29tcGFyaXNvblwiLCBbXCJpY21wXCIsIFwiZmNtcFwiXSksXG4gIC4uLm1hcFdvcmRzKFwibG9vbS1sbHZtLWtleXdvcmQtY2FzdFwiLCBbXG4gICAgXCJ0cnVuY1wiLCBcInpleHRcIiwgXCJzZXh0XCIsIFwiZnB0cnVuY1wiLCBcImZwZXh0XCIsIFwiZnB0b3VpXCIsIFwiZnB0b3NpXCIsIFwidWl0b2ZwXCIsIFwic2l0b2ZwXCIsIFwicHRydG9pbnRcIiwgXCJpbnR0b3B0clwiLCBcImJpdGNhc3RcIiwgXCJhZGRyc3BhY2VjYXN0XCIsXG4gIF0pLFxuICAuLi5tYXBXb3JkcyhcImxvb20tbGx2bS1rZXl3b3JkLW90aGVyXCIsIFtcInBoaVwiLCBcInNlbGVjdFwiLCBcImZyZWV6ZVwiLCBcImNhbGxcIiwgXCJsYW5kaW5ncGFkXCIsIFwiY2F0Y2hwYWRcIiwgXCJjbGVhbnVwcGFkXCIsIFwidmFfYXJnXCJdKSxcbiAgLi4ubWFwV29yZHMoXCJsb29tLWxsdm0ta2V5d29yZC1tb2RpZmllclwiLCBbXG4gICAgXCJwcml2YXRlXCIsIFwiaW50ZXJuYWxcIiwgXCJhdmFpbGFibGVfZXh0ZXJuYWxseVwiLCBcImxpbmtvbmNlXCIsIFwid2Vha1wiLCBcImNvbW1vblwiLCBcImFwcGVuZGluZ1wiLCBcImV4dGVybl93ZWFrXCIsIFwibGlua29uY2Vfb2RyXCIsIFwid2Vha19vZHJcIixcbiAgICBcImV4dGVybmFsXCIsIFwiZGVmYXVsdFwiLCBcImhpZGRlblwiLCBcInByb3RlY3RlZFwiLCBcImRsbGltcG9ydFwiLCBcImRsbGV4cG9ydFwiLCBcImRzb19sb2NhbFwiLCBcImRzb19wcmVlbXB0YWJsZVwiLCBcImV4dGVybmFsbHlfaW5pdGlhbGl6ZWRcIixcbiAgICBcInRocmVhZF9sb2NhbFwiLCBcImxvY2FsZHluYW1pY1wiLCBcImluaXRpYWxleGVjXCIsIFwibG9jYWxleGVjXCIsIFwidW5uYW1lZF9hZGRyXCIsIFwibG9jYWxfdW5uYW1lZF9hZGRyXCIsIFwiYXRvbWljXCIsIFwidW5vcmRlcmVkXCIsIFwibW9ub3RvbmljXCIsXG4gICAgXCJhY3F1aXJlXCIsIFwicmVsZWFzZVwiLCBcImFjcV9yZWxcIiwgXCJzZXFfY3N0XCIsIFwic3luY3Njb3BlXCIsIFwidm9sYXRpbGVcIiwgXCJzaW5nbGV0aHJlYWRcIiwgXCJjY2NcIiwgXCJmYXN0Y2NcIiwgXCJjb2xkY2NcIiwgXCJ3ZWJraXRfanNjY1wiLFxuICAgIFwiYW55cmVnY2NcIiwgXCJwcmVzZXJ2ZV9tb3N0Y2NcIiwgXCJwcmVzZXJ2ZV9hbGxjY1wiLCBcImN4eF9mYXN0X3Rsc2NjXCIsIFwic3dpZnRjY1wiLCBcInRhaWxjY1wiLCBcImNmZ3VhcmRfY2hlY2tjY1wiLCBcInRhaWxcIiwgXCJtdXN0dGFpbFwiLCBcIm5vdGFpbFwiLFxuICAgIFwiZmFzdFwiLCBcIm5uYW5cIiwgXCJuaW5mXCIsIFwibnN6XCIsIFwiYXJjcFwiLCBcImNvbnRyYWN0XCIsIFwiYWZuXCIsIFwicmVhc3NvY1wiLCBcIm51d1wiLCBcIm5zd1wiLCBcImV4YWN0XCIsIFwiaW5ib3VuZHNcIiwgXCJ0b1wiLCBcInhcIixcbiAgXSksXG4gIC4uLm1hcFdvcmRzKFwibG9vbS1sbHZtLXByZWRpY2F0ZVwiLCBbXG4gICAgXCJlcVwiLCBcIm5lXCIsIFwidWd0XCIsIFwidWdlXCIsIFwidWx0XCIsIFwidWxlXCIsIFwic2d0XCIsIFwic2dlXCIsIFwic2x0XCIsIFwic2xlXCIsIFwib2VxXCIsIFwib2d0XCIsIFwib2dlXCIsIFwib2x0XCIsIFwib2xlXCIsIFwib25lXCIsIFwib3JkXCIsIFwidWVxXCIsIFwidW5lXCIsXG4gICAgXCJ1bm9cIixcbiAgXSksXG4gIC4uLm1hcFdvcmRzKFwibG9vbS1sbHZtLWF0dHJpYnV0ZVwiLCBbXG4gICAgXCJhbHdheXNpbmxpbmVcIiwgXCJhcmdtZW1vbmx5XCIsIFwiYnVpbHRpblwiLCBcImJ5cmVmXCIsIFwiYnl2YWxcIiwgXCJjb2xkXCIsIFwiY29udmVyZ2VudFwiLCBcImRlcmVmZXJlbmNlYWJsZVwiLCBcImRlcmVmZXJlbmNlYWJsZV9vcl9udWxsXCIsIFwiZGlzdGluY3RcIixcbiAgICBcImltbWFyZ1wiLCBcImluYWxsb2NhXCIsIFwiaW5yZWdcIiwgXCJtdXN0cHJvZ3Jlc3NcIiwgXCJuZXN0XCIsIFwibm9hbGlhc1wiLCBcIm5vY2FsbGJhY2tcIiwgXCJub2NhcHR1cmVcIiwgXCJub2ZyZWVcIiwgXCJub2lubGluZVwiLCBcIm5vbmxhenliaW5kXCIsXG4gICAgXCJub25udWxsXCIsIFwibm9yZWN1cnNlXCIsIFwibm9yZWR6b25lXCIsIFwibm9yZXR1cm5cIiwgXCJub3N5bmNcIiwgXCJub3Vud2luZFwiLCBcIm51bGxfcG9pbnRlcl9pc192YWxpZFwiLCBcIm9wYXF1ZVwiLCBcIm9wdG5vbmVcIiwgXCJvcHRzaXplXCIsXG4gICAgXCJwcmVhbGxvY2F0ZWRcIiwgXCJyZWFkbm9uZVwiLCBcInJlYWRvbmx5XCIsIFwicmV0dXJuZWRcIiwgXCJyZXR1cm5zX3R3aWNlXCIsIFwic2FuaXRpemVfYWRkcmVzc1wiLCBcInNhbml0aXplX2h3YWRkcmVzc1wiLCBcInNhbml0aXplX21lbW9yeVwiLFxuICAgIFwic2FuaXRpemVfdGhyZWFkXCIsIFwic2lnbmV4dFwiLCBcInNwZWN1bGF0YWJsZVwiLCBcInNyZXRcIiwgXCJzc3BcIiwgXCJzc3ByZXFcIiwgXCJzc3BzdHJvbmdcIiwgXCJzd2lmdGFzeW5jXCIsIFwic3dpZnRzZWxmXCIsIFwic3dpZnRlcnJvclwiLCBcInV3dGFibGVcIixcbiAgICBcIndpbGxyZXR1cm5cIiwgXCJ3cml0ZW9ubHlcIiwgXCJ6ZXJvZXh0XCIsXG4gIF0pLFxuICAuLi5tYXBXb3JkcyhcImxvb20tbGx2bS1jb25zdGFudFwiLCBbXCJ0cnVlXCIsIFwiZmFsc2VcIiwgXCJudWxsXCIsIFwibm9uZVwiLCBcInVuZGVmXCIsIFwicG9pc29uXCIsIFwiemVyb2luaXRpYWxpemVyXCJdKSxcbl0pO1xuXG5jb25zdCBMTFZNX1BSSU1JVElWRV9UWVBFUyA9IG5ldyBTZXQoW1xuICBcInZvaWRcIiwgXCJsYWJlbFwiLCBcInRva2VuXCIsIFwibWV0YWRhdGFcIiwgXCJ4ODZfbW14XCIsIFwieDg2X2FteFwiLCBcImhhbGZcIiwgXCJiZmxvYXRcIiwgXCJmbG9hdFwiLCBcImRvdWJsZVwiLCBcImZwMTI4XCIsIFwieDg2X2ZwODBcIiwgXCJwcGNfZnAxMjhcIiwgXCJwdHJcIixcbl0pO1xuXG5jb25zdCBQVU5DVFVBVElPTl9DTEFTUyA9IFwibG9vbS1sbHZtLXB1bmN0dWF0aW9uXCI7XG5cbmV4cG9ydCBmdW5jdGlvbiBoaWdobGlnaHRMbHZtRWxlbWVudChjb2RlRWxlbWVudDogSFRNTEVsZW1lbnQsIHNvdXJjZTogc3RyaW5nKTogdm9pZCB7XG4gIGNvZGVFbGVtZW50LmVtcHR5KCk7XG4gIGNvZGVFbGVtZW50LmFkZENsYXNzKFwibG9vbS1sbHZtLWNvZGVcIik7XG5cbiAgY29uc3QgbGluZXMgPSBzb3VyY2Uuc3BsaXQoXCJcXG5cIik7XG4gIGxpbmVzLmZvckVhY2goKGxpbmUsIGluZGV4KSA9PiB7XG4gICAgYXBwZW5kSGlnaGxpZ2h0ZWRMaW5lKGNvZGVFbGVtZW50LCBsaW5lKTtcbiAgICBpZiAoaW5kZXggPCBsaW5lcy5sZW5ndGggLSAxKSB7XG4gICAgICBjb2RlRWxlbWVudC5hcHBlbmRUZXh0KFwiXFxuXCIpO1xuICAgIH1cbiAgfSk7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBhZGRMbHZtRGVjb3JhdGlvbnMoXG4gIGJ1aWxkZXI6IFJhbmdlU2V0QnVpbGRlcjxEZWNvcmF0aW9uPixcbiAgdmlldzogRWRpdG9yVmlldyxcbiAgYmxvY2s6IGxvb21Db2RlQmxvY2ssXG4pOiB2b2lkIHtcbiAgY29uc3QgY29udGVudExpbmVDb3VudCA9IGdldENvbnRlbnRMaW5lQ291bnQoYmxvY2spO1xuICBpZiAoIWNvbnRlbnRMaW5lQ291bnQpIHtcbiAgICByZXR1cm47XG4gIH1cblxuICBjb25zdCBsaW5lcyA9IGJsb2NrLmNvbnRlbnQuc3BsaXQoXCJcXG5cIik7XG4gIGZvciAobGV0IGluZGV4ID0gMDsgaW5kZXggPCBjb250ZW50TGluZUNvdW50OyBpbmRleCArPSAxKSB7XG4gICAgY29uc3QgbGluZSA9IGxpbmVzW2luZGV4XSA/PyBcIlwiO1xuICAgIGNvbnN0IHRva2VucyA9IHRva2VuaXplTGx2bUxpbmUobGluZSk7XG4gICAgaWYgKCF0b2tlbnMubGVuZ3RoKSB7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICBjb25zdCBkb2NMaW5lID0gdmlldy5zdGF0ZS5kb2MubGluZShibG9jay5zdGFydExpbmUgKyAyICsgaW5kZXgpO1xuICAgIGZvciAoY29uc3QgdG9rZW4gb2YgdG9rZW5zKSB7XG4gICAgICBpZiAodG9rZW4uZnJvbSA9PT0gdG9rZW4udG8pIHtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICBidWlsZGVyLmFkZChcbiAgICAgICAgZG9jTGluZS5mcm9tICsgdG9rZW4uZnJvbSxcbiAgICAgICAgZG9jTGluZS5mcm9tICsgdG9rZW4udG8sXG4gICAgICAgIERlY29yYXRpb24ubWFyayh7IGNsYXNzOiB0b2tlbi5jbGFzc05hbWUgfSksXG4gICAgICApO1xuICAgIH1cbiAgfVxufVxuXG5mdW5jdGlvbiBhcHBlbmRIaWdobGlnaHRlZExpbmUoY29udGFpbmVyOiBIVE1MRWxlbWVudCwgbGluZTogc3RyaW5nKTogdm9pZCB7XG4gIGxldCBjdXJzb3IgPSAwO1xuXG4gIGZvciAoY29uc3QgdG9rZW4gb2YgdG9rZW5pemVMbHZtTGluZShsaW5lKSkge1xuICAgIGlmICh0b2tlbi5mcm9tID4gY3Vyc29yKSB7XG4gICAgICBjb250YWluZXIuYXBwZW5kVGV4dChsaW5lLnNsaWNlKGN1cnNvciwgdG9rZW4uZnJvbSkpO1xuICAgIH1cblxuICAgIGNvbnN0IHNwYW4gPSBjb250YWluZXIuY3JlYXRlU3Bhbih7IGNsczogdG9rZW4uY2xhc3NOYW1lIH0pO1xuICAgIHNwYW4uc2V0VGV4dChsaW5lLnNsaWNlKHRva2VuLmZyb20sIHRva2VuLnRvKSk7XG4gICAgY3Vyc29yID0gdG9rZW4udG87XG4gIH1cblxuICBpZiAoY3Vyc29yIDwgbGluZS5sZW5ndGgpIHtcbiAgICBjb250YWluZXIuYXBwZW5kVGV4dChsaW5lLnNsaWNlKGN1cnNvcikpO1xuICB9XG59XG5cbmZ1bmN0aW9uIHRva2VuaXplTGx2bUxpbmUobGluZTogc3RyaW5nKTogTGx2bVRva2VuW10ge1xuICBjb25zdCB0b2tlbnM6IExsdm1Ub2tlbltdID0gW107XG4gIGxldCBpbmRleCA9IDA7XG5cbiAgYWRkTGFiZWxUb2tlbihsaW5lLCB0b2tlbnMpO1xuXG4gIHdoaWxlIChpbmRleCA8IGxpbmUubGVuZ3RoKSB7XG4gICAgY29uc3QgY3VycmVudCA9IGxpbmVbaW5kZXhdO1xuICAgIGlmIChjdXJyZW50ID09PSBcIjtcIikge1xuICAgICAgdG9rZW5zLnB1c2goeyBmcm9tOiBpbmRleCwgdG86IGxpbmUubGVuZ3RoLCBjbGFzc05hbWU6IFwibG9vbS1sbHZtLWNvbW1lbnRcIiB9KTtcbiAgICAgIGJyZWFrO1xuICAgIH1cblxuICAgIGlmICgvXFxzLy50ZXN0KGN1cnJlbnQpKSB7XG4gICAgICBpbmRleCArPSAxO1xuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgY29uc3Qgc3RyaW5nVG9rZW4gPSByZWFkU3RyaW5nVG9rZW4obGluZSwgaW5kZXgpO1xuICAgIGlmIChzdHJpbmdUb2tlbikge1xuICAgICAgaWYgKHN0cmluZ1Rva2VuLnByZWZpeEVuZCA+IGluZGV4KSB7XG4gICAgICAgIHRva2Vucy5wdXNoKHsgZnJvbTogaW5kZXgsIHRvOiBzdHJpbmdUb2tlbi5wcmVmaXhFbmQsIGNsYXNzTmFtZTogXCJsb29tLWxsdm0tc3RyaW5nLXByZWZpeFwiIH0pO1xuICAgICAgfVxuICAgICAgdG9rZW5zLnB1c2goeyBmcm9tOiBzdHJpbmdUb2tlbi52YWx1ZVN0YXJ0LCB0bzogc3RyaW5nVG9rZW4udmFsdWVFbmQsIGNsYXNzTmFtZTogXCJsb29tLWxsdm0tc3RyaW5nXCIgfSk7XG4gICAgICBpbmRleCA9IHN0cmluZ1Rva2VuLnZhbHVlRW5kO1xuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgY29uc3QgbWF0Y2hlZCA9XG4gICAgICBtYXRjaFJlZ2V4VG9rZW4obGluZSwgaW5kZXgsIC9AbGx2bVxcLltBLVphLXokLl8wLTldKy95LCBcImxvb20tbGx2bS1pbnRyaW5zaWNcIiwgdG9rZW5zKSB8fFxuICAgICAgbWF0Y2hSZWdleFRva2VuKGxpbmUsIGluZGV4LCAvQFtBLVphLXokLl8tXVtBLVphLXokLl8wLTktXSp8QFxcZCtcXGIveSwgXCJsb29tLWxsdm0tZ2xvYmFsXCIsIHRva2VucykgfHxcbiAgICAgIG1hdGNoUmVnZXhUb2tlbihsaW5lLCBpbmRleCwgLyVbQS1aYS16JC5fLV1bQS1aYS16JC5fMC05LV0qfCVcXGQrXFxiL3ksIFwibG9vbS1sbHZtLWxvY2FsXCIsIHRva2VucykgfHxcbiAgICAgIG1hdGNoUmVnZXhUb2tlbihsaW5lLCBpbmRleCwgLyFbQS1aYS16JC5fLV1bQS1aYS16JC5fMC05LV0qfCFcXGQrXFxiL3ksIFwibG9vbS1sbHZtLW1ldGFkYXRhXCIsIHRva2VucykgfHxcbiAgICAgIG1hdGNoUmVnZXhUb2tlbihsaW5lLCBpbmRleCwgL1xcJFtBLVphLXokLl8tXVtBLVphLXokLl8wLTktXSoveSwgXCJsb29tLWxsdm0tY29tZGF0XCIsIHRva2VucykgfHxcbiAgICAgIG1hdGNoUmVnZXhUb2tlbihsaW5lLCBpbmRleCwgLyNcXGQrXFxiL3ksIFwibG9vbS1sbHZtLWF0dHJpYnV0ZS1ncm91cFwiLCB0b2tlbnMpIHx8XG4gICAgICBtYXRjaFJlZ2V4VG9rZW4obGluZSwgaW5kZXgsIC9cXGJhZGRyc3BhY2VcXHMqXFwoXFxzKlxcZCtcXHMqXFwpL3ksIFwibG9vbS1sbHZtLXR5cGVcIiwgdG9rZW5zKSB8fFxuICAgICAgbWF0Y2hSZWdleFRva2VuKGxpbmUsIGluZGV4LCAvWy0rXT8weFswLTlBLUZhLWZdK1xcYi95LCBcImxvb20tbGx2bS1udW1iZXJcIiwgdG9rZW5zKSB8fFxuICAgICAgbWF0Y2hSZWdleFRva2VuKGxpbmUsIGluZGV4LCAvWy0rXT8oPzpcXGQrXFwuXFxkKnxcXC5cXGQrfFxcZCspKD86W2VFXVstK10/XFxkKylcXGIveSwgXCJsb29tLWxsdm0tbnVtYmVyXCIsIHRva2VucykgfHxcbiAgICAgIG1hdGNoUmVnZXhUb2tlbihsaW5lLCBpbmRleCwgL1stK10/KD86XFxkK1xcLlxcZCp8XFwuXFxkKylcXGIveSwgXCJsb29tLWxsdm0tbnVtYmVyXCIsIHRva2VucykgfHxcbiAgICAgIG1hdGNoUmVnZXhUb2tlbihsaW5lLCBpbmRleCwgL1stK10/XFxkK1xcYi95LCBcImxvb20tbGx2bS1udW1iZXJcIiwgdG9rZW5zKSB8fFxuICAgICAgbWF0Y2hSZWdleFRva2VuKGxpbmUsIGluZGV4LCAvXFwuXFwuXFwuL3ksIFwibG9vbS1sbHZtLXB1bmN0dWF0aW9uXCIsIHRva2Vucyk7XG5cbiAgICBpZiAobWF0Y2hlZCkge1xuICAgICAgaW5kZXggPSBtYXRjaGVkO1xuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgY29uc3Qgd29yZCA9IHJlYWRXb3JkKGxpbmUsIGluZGV4KTtcbiAgICBpZiAod29yZCkge1xuICAgICAgdG9rZW5zLnB1c2goe1xuICAgICAgICBmcm9tOiBpbmRleCxcbiAgICAgICAgdG86IHdvcmQuZW5kLFxuICAgICAgICBjbGFzc05hbWU6IGNsYXNzaWZ5V29yZCh3b3JkLnZhbHVlKSxcbiAgICAgIH0pO1xuICAgICAgaW5kZXggPSB3b3JkLmVuZDtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cblxuICAgIGlmIChcIigpW117fTw+LDo9KlwiLmluY2x1ZGVzKGN1cnJlbnQpKSB7XG4gICAgICB0b2tlbnMucHVzaCh7IGZyb206IGluZGV4LCB0bzogaW5kZXggKyAxLCBjbGFzc05hbWU6IFBVTkNUVUFUSU9OX0NMQVNTIH0pO1xuICAgICAgaW5kZXggKz0gMTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cblxuICAgIGluZGV4ICs9IDE7XG4gIH1cblxuICByZXR1cm4gbm9ybWFsaXplVG9rZW5zKHRva2Vucyk7XG59XG5cbmZ1bmN0aW9uIGFkZExhYmVsVG9rZW4obGluZTogc3RyaW5nLCB0b2tlbnM6IExsdm1Ub2tlbltdKTogdm9pZCB7XG4gIGNvbnN0IG1hdGNoID0gbGluZS5tYXRjaCgvXihcXHMqKSg/OihbQS1aYS16JC5fLV1bQS1aYS16JC5fMC05LV0qfFxcZCspfCglW0EtWmEteiQuXy1dW0EtWmEteiQuXzAtOS1dKnwlXFxkKykpKDopLyk7XG4gIGlmICghbWF0Y2ggfHwgbWF0Y2guaW5kZXggPT0gbnVsbCkge1xuICAgIHJldHVybjtcbiAgfVxuXG4gIGNvbnN0IGxhYmVsU3RhcnQgPSBtYXRjaFsxXS5sZW5ndGg7XG4gIGNvbnN0IGxhYmVsVGV4dCA9IG1hdGNoWzJdID8/IG1hdGNoWzNdO1xuICBpZiAoIWxhYmVsVGV4dCkge1xuICAgIHJldHVybjtcbiAgfVxuXG4gIHRva2Vucy5wdXNoKHtcbiAgICBmcm9tOiBsYWJlbFN0YXJ0LFxuICAgIHRvOiBsYWJlbFN0YXJ0ICsgbGFiZWxUZXh0Lmxlbmd0aCxcbiAgICBjbGFzc05hbWU6IFwibG9vbS1sbHZtLWxhYmVsXCIsXG4gIH0pO1xuICB0b2tlbnMucHVzaCh7XG4gICAgZnJvbTogbGFiZWxTdGFydCArIGxhYmVsVGV4dC5sZW5ndGgsXG4gICAgdG86IGxhYmVsU3RhcnQgKyBsYWJlbFRleHQubGVuZ3RoICsgMSxcbiAgICBjbGFzc05hbWU6IFBVTkNUVUFUSU9OX0NMQVNTLFxuICB9KTtcbn1cblxuZnVuY3Rpb24gY2xhc3NpZnlXb3JkKHdvcmQ6IHN0cmluZyk6IHN0cmluZyB7XG4gIGlmICgvXmlcXGQrJC8udGVzdCh3b3JkKSB8fCBMTFZNX1BSSU1JVElWRV9UWVBFUy5oYXMod29yZCkpIHtcbiAgICByZXR1cm4gXCJsb29tLWxsdm0tdHlwZVwiO1xuICB9XG5cbiAgcmV0dXJuIExMVk1fS0VZV09SRFMuZ2V0KHdvcmQpID8/IFwibG9vbS1sbHZtLXBsYWluXCI7XG59XG5cbmZ1bmN0aW9uIHJlYWRXb3JkKGxpbmU6IHN0cmluZywgaW5kZXg6IG51bWJlcik6IHsgdmFsdWU6IHN0cmluZzsgZW5kOiBudW1iZXIgfSB8IG51bGwge1xuICBjb25zdCBtYXRjaCA9IC9bQS1aYS16X11bQS1aYS16MC05Xy4tXSoveTtcbiAgbWF0Y2gubGFzdEluZGV4ID0gaW5kZXg7XG4gIGNvbnN0IHJlc3VsdCA9IG1hdGNoLmV4ZWMobGluZSk7XG4gIGlmICghcmVzdWx0KSB7XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cblxuICByZXR1cm4ge1xuICAgIHZhbHVlOiByZXN1bHRbMF0sXG4gICAgZW5kOiBtYXRjaC5sYXN0SW5kZXgsXG4gIH07XG59XG5cbmZ1bmN0aW9uIHJlYWRTdHJpbmdUb2tlbihsaW5lOiBzdHJpbmcsIGluZGV4OiBudW1iZXIpOiB7IHByZWZpeEVuZDogbnVtYmVyOyB2YWx1ZVN0YXJ0OiBudW1iZXI7IHZhbHVlRW5kOiBudW1iZXIgfSB8IG51bGwge1xuICBsZXQgY3Vyc29yID0gaW5kZXg7XG4gIGlmIChsaW5lW2N1cnNvcl0gPT09IFwiY1wiICYmIGxpbmVbY3Vyc29yICsgMV0gPT09IFwiXFxcIlwiKSB7XG4gICAgY3Vyc29yICs9IDE7XG4gIH1cblxuICBpZiAobGluZVtjdXJzb3JdICE9PSBcIlxcXCJcIikge1xuICAgIHJldHVybiBudWxsO1xuICB9XG5cbiAgY29uc3QgdmFsdWVTdGFydCA9IGN1cnNvcjtcbiAgY3Vyc29yICs9IDE7XG4gIHdoaWxlIChjdXJzb3IgPCBsaW5lLmxlbmd0aCkge1xuICAgIGlmIChsaW5lW2N1cnNvcl0gPT09IFwiXFxcXFwiKSB7XG4gICAgICBjdXJzb3IgKz0gMjtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAobGluZVtjdXJzb3JdID09PSBcIlxcXCJcIikge1xuICAgICAgY3Vyc29yICs9IDE7XG4gICAgICBicmVhaztcbiAgICB9XG4gICAgY3Vyc29yICs9IDE7XG4gIH1cblxuICByZXR1cm4ge1xuICAgIHByZWZpeEVuZDogdmFsdWVTdGFydCxcbiAgICB2YWx1ZVN0YXJ0LFxuICAgIHZhbHVlRW5kOiBjdXJzb3IsXG4gIH07XG59XG5cbmZ1bmN0aW9uIG1hdGNoUmVnZXhUb2tlbihcbiAgbGluZTogc3RyaW5nLFxuICBpbmRleDogbnVtYmVyLFxuICByZWdleDogUmVnRXhwLFxuICBjbGFzc05hbWU6IHN0cmluZyxcbiAgdG9rZW5zOiBMbHZtVG9rZW5bXSxcbik6IG51bWJlciB8IG51bGwge1xuICByZWdleC5sYXN0SW5kZXggPSBpbmRleDtcbiAgY29uc3QgbWF0Y2ggPSByZWdleC5leGVjKGxpbmUpO1xuICBpZiAoIW1hdGNoKSB7XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cblxuICB0b2tlbnMucHVzaCh7IGZyb206IGluZGV4LCB0bzogcmVnZXgubGFzdEluZGV4LCBjbGFzc05hbWUgfSk7XG4gIHJldHVybiByZWdleC5sYXN0SW5kZXg7XG59XG5cbmZ1bmN0aW9uIG5vcm1hbGl6ZVRva2Vucyh0b2tlbnM6IExsdm1Ub2tlbltdKTogTGx2bVRva2VuW10ge1xuICB0b2tlbnMuc29ydCgobGVmdCwgcmlnaHQpID0+IGxlZnQuZnJvbSAtIHJpZ2h0LmZyb20gfHwgbGVmdC50byAtIHJpZ2h0LnRvKTtcbiAgY29uc3Qgbm9ybWFsaXplZDogTGx2bVRva2VuW10gPSBbXTtcbiAgbGV0IGN1cnNvciA9IDA7XG5cbiAgZm9yIChjb25zdCB0b2tlbiBvZiB0b2tlbnMpIHtcbiAgICBpZiAodG9rZW4udG8gPD0gY3Vyc29yKSB7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICBjb25zdCBmcm9tID0gTWF0aC5tYXgodG9rZW4uZnJvbSwgY3Vyc29yKTtcbiAgICBub3JtYWxpemVkLnB1c2goeyAuLi50b2tlbiwgZnJvbSB9KTtcbiAgICBjdXJzb3IgPSB0b2tlbi50bztcbiAgfVxuXG4gIHJldHVybiBub3JtYWxpemVkO1xufVxuXG5mdW5jdGlvbiBnZXRDb250ZW50TGluZUNvdW50KGJsb2NrOiBsb29tQ29kZUJsb2NrKTogbnVtYmVyIHtcbiAgaWYgKGJsb2NrLmVuZExpbmUgPT09IGJsb2NrLnN0YXJ0TGluZSkge1xuICAgIHJldHVybiAwO1xuICB9XG5cbiAgaWYgKGJsb2NrLmNvbnRlbnQubGVuZ3RoID09PSAwKSB7XG4gICAgcmV0dXJuIGJsb2NrLmVuZExpbmUgPiBibG9jay5zdGFydExpbmUgKyAxID8gMSA6IDA7XG4gIH1cblxuICByZXR1cm4gYmxvY2suY29udGVudC5zcGxpdChcIlxcblwiKS5sZW5ndGg7XG59XG5cbmZ1bmN0aW9uIG1hcFdvcmRzKGNsYXNzTmFtZTogc3RyaW5nLCB3b3Jkczogc3RyaW5nW10pOiBBcnJheTxbc3RyaW5nLCBzdHJpbmddPiB7XG4gIHJldHVybiB3b3Jkcy5tYXAoKHdvcmQpID0+IFt3b3JkLCBjbGFzc05hbWVdKTtcbn1cbiIsICJpbXBvcnQgeyBjcmVhdGVIYXNoIH0gZnJvbSBcImNyeXB0b1wiO1xuXG5leHBvcnQgZnVuY3Rpb24gc2hvcnRIYXNoKGlucHV0OiBzdHJpbmcpOiBzdHJpbmcge1xuICByZXR1cm4gY3JlYXRlSGFzaChcInNoYTI1NlwiKS51cGRhdGUoaW5wdXQpLmRpZ2VzdChcImhleFwiKS5zbGljZSgwLCAxNik7XG59XG4iLCAiaW1wb3J0IHsgc2hvcnRIYXNoIH0gZnJvbSBcIi4vdXRpbHMvaGFzaFwiO1xuaW1wb3J0IHR5cGUgeyBsb29tQ29kZUJsb2NrLCBsb29tTm9ybWFsaXplZExhbmd1YWdlLCBsb29tUGx1Z2luU2V0dGluZ3MsIGxvb21Tb3VyY2VSZWZlcmVuY2UgfSBmcm9tIFwiLi90eXBlc1wiO1xuXG5jb25zdCBMQU5HVUFHRV9BTElBU0VTOiBSZWNvcmQ8c3RyaW5nLCBsb29tTm9ybWFsaXplZExhbmd1YWdlPiA9IHtcbiAgcHl0aG9uOiBcInB5dGhvblwiLFxuICBweTogXCJweXRob25cIixcbiAgamF2YXNjcmlwdDogXCJqYXZhc2NyaXB0XCIsXG4gIGpzOiBcImphdmFzY3JpcHRcIixcbiAgdHlwZXNjcmlwdDogXCJ0eXBlc2NyaXB0XCIsXG4gIHRzOiBcInR5cGVzY3JpcHRcIixcbiAgb2NhbWw6IFwib2NhbWxcIixcbiAgbWw6IFwib2NhbWxcIixcbiAgYzogXCJjXCIsXG4gIGg6IFwiY1wiLFxuICBjcHA6IFwiY3BwXCIsXG4gIGN4eDogXCJjcHBcIixcbiAgY2M6IFwiY3BwXCIsXG4gIFwiYysrXCI6IFwiY3BwXCIsXG4gIHNoZWxsOiBcInNoZWxsXCIsXG4gIHNoOiBcInNoZWxsXCIsXG4gIGJhc2g6IFwic2hlbGxcIixcbiAgenNoOiBcInNoZWxsXCIsXG4gIHJ1Ynk6IFwicnVieVwiLFxuICByYjogXCJydWJ5XCIsXG4gIHBlcmw6IFwicGVybFwiLFxuICBwbDogXCJwZXJsXCIsXG4gIGx1YTogXCJsdWFcIixcbiAgcGhwOiBcInBocFwiLFxuICBnbzogXCJnb1wiLFxuICBnb2xhbmc6IFwiZ29cIixcbiAgcnVzdDogXCJydXN0XCIsXG4gIHJzOiBcInJ1c3RcIixcbiAgaGFza2VsbDogXCJoYXNrZWxsXCIsXG4gIGhzOiBcImhhc2tlbGxcIixcbiAgamF2YTogXCJqYXZhXCIsXG4gIGxsdm06IFwibGx2bS1pclwiLFxuICBsbHZtaXI6IFwibGx2bS1pclwiLFxuICBcImxsdm0taXJcIjogXCJsbHZtLWlyXCIsXG4gIGxsOiBcImxsdm0taXJcIixcbiAgbGVhbjogXCJsZWFuXCIsXG4gIGxlYW40OiBcImxlYW5cIixcbiAgY29xOiBcImNvcVwiLFxuICB2OiBcImNvcVwiLFxuICBzbXQ6IFwic210bGliXCIsXG4gIHNtdDI6IFwic210bGliXCIsXG4gIHNtdGxpYjogXCJzbXRsaWJcIixcbiAgXCJzbXQtbGliXCI6IFwic210bGliXCIsXG4gIHozOiBcInNtdGxpYlwiLFxufTtcblxuY29uc3QgT1VUUFVUX1NUQVJUID0gL148IS0tXFxzKmxvb206b3V0cHV0OnN0YXJ0XFxzK2lkPShbYS1mMC05XSspXFxzKi0tPiQvaTtcbmNvbnN0IE9VVFBVVF9FTkQgPSAvXjwhLS1cXHMqbG9vbTpvdXRwdXQ6ZW5kXFxzKi0tPiQvaTtcbmNvbnN0IEZFTkNFX1NUQVJUID0gL14oYGBgK3x+fn4rKVxccyooW15cXHNgXSopPyguKikkLztcblxuZXhwb3J0IGZ1bmN0aW9uIG5vcm1hbGl6ZUxhbmd1YWdlKHJhd0xhbmd1YWdlOiBzdHJpbmcsIHNldHRpbmdzPzogbG9vbVBsdWdpblNldHRpbmdzKTogbG9vbU5vcm1hbGl6ZWRMYW5ndWFnZSB8IG51bGwge1xuICBjb25zdCBub3JtYWxpemVkID0gcmF3TGFuZ3VhZ2UudHJpbSgpLnRvTG93ZXJDYXNlKCk7XG5cbiAgZm9yIChjb25zdCBsYW5ndWFnZSBvZiBzZXR0aW5ncz8uY3VzdG9tTGFuZ3VhZ2VzID8/IFtdKSB7XG4gICAgY29uc3QgbmFtZSA9IGxhbmd1YWdlLm5hbWUudHJpbSgpLnRvTG93ZXJDYXNlKCk7XG4gICAgY29uc3QgYWxpYXNlcyA9IHBhcnNlQWxpYXNMaXN0KGxhbmd1YWdlLmFsaWFzZXMpO1xuICAgIGlmIChuYW1lICYmIChuYW1lID09PSBub3JtYWxpemVkIHx8IGFsaWFzZXMuaW5jbHVkZXMobm9ybWFsaXplZCkpKSB7XG4gICAgICByZXR1cm4gbGFuZ3VhZ2UubmFtZS50cmltKCk7XG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIExBTkdVQUdFX0FMSUFTRVNbbm9ybWFsaXplZF0gPz8gbnVsbDtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGdldFN1cHBvcnRlZExhbmd1YWdlQWxpYXNlcyhzZXR0aW5ncz86IGxvb21QbHVnaW5TZXR0aW5ncyk6IHN0cmluZ1tdIHtcbiAgcmV0dXJuIFtcbiAgICAuLi5PYmplY3Qua2V5cyhMQU5HVUFHRV9BTElBU0VTKSxcbiAgICAuLi4oc2V0dGluZ3M/LmN1c3RvbUxhbmd1YWdlcyA/PyBbXSkuZmxhdE1hcCgobGFuZ3VhZ2UpID0+IFtsYW5ndWFnZS5uYW1lLCAuLi5wYXJzZUFsaWFzTGlzdChsYW5ndWFnZS5hbGlhc2VzKV0pLFxuICBdLm1hcCgoYWxpYXMpID0+IGFsaWFzLnRvTG93ZXJDYXNlKCkpO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gcGFyc2VNYXJrZG93bkNvZGVCbG9ja3MoZmlsZVBhdGg6IHN0cmluZywgc291cmNlOiBzdHJpbmcsIHNldHRpbmdzPzogbG9vbVBsdWdpblNldHRpbmdzKTogbG9vbUNvZGVCbG9ja1tdIHtcbiAgY29uc3QgbGluZXMgPSBzb3VyY2Uuc3BsaXQoL1xccj9cXG4vKTtcbiAgY29uc3QgYmxvY2tzOiBsb29tQ29kZUJsb2NrW10gPSBbXTtcbiAgbGV0IG9yZGluYWwgPSAwO1xuICBsZXQgaW5zaWRlTWFuYWdlZE91dHB1dCA9IGZhbHNlO1xuXG4gIGZvciAobGV0IGkgPSAwOyBpIDwgbGluZXMubGVuZ3RoOyBpICs9IDEpIHtcbiAgICBjb25zdCBsaW5lID0gbGluZXNbaV07XG5cbiAgICBpZiAoaW5zaWRlTWFuYWdlZE91dHB1dCkge1xuICAgICAgaWYgKE9VVFBVVF9FTkQudGVzdChsaW5lLnRyaW0oKSkpIHtcbiAgICAgICAgaW5zaWRlTWFuYWdlZE91dHB1dCA9IGZhbHNlO1xuICAgICAgfVxuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgaWYgKE9VVFBVVF9TVEFSVC50ZXN0KGxpbmUudHJpbSgpKSkge1xuICAgICAgaW5zaWRlTWFuYWdlZE91dHB1dCA9IHRydWU7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICBjb25zdCBmZW5jZU1hdGNoID0gbGluZS5tYXRjaChGRU5DRV9TVEFSVCk7XG4gICAgaWYgKCFmZW5jZU1hdGNoKSB7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICBjb25zdCBzdGFydExpbmUgPSBpO1xuICAgIGNvbnN0IGZlbmNlSW5kZW50ID0gZ2V0TGVhZGluZ1doaXRlc3BhY2UobGluZSk7XG4gICAgY29uc3QgZmVuY2VUb2tlbiA9IGZlbmNlTWF0Y2hbMV07XG4gICAgY29uc3Qgc291cmNlTGFuZ3VhZ2UgPSAoZmVuY2VNYXRjaFsyXSA/PyBcIlwiKS50cmltKCk7XG4gICAgY29uc3Qgc291cmNlUmVmZXJlbmNlID0gcGFyc2VTb3VyY2VSZWZlcmVuY2UoZmVuY2VNYXRjaFszXSA/PyBcIlwiKTtcbiAgICBjb25zdCBsYW5ndWFnZSA9IG5vcm1hbGl6ZUxhbmd1YWdlKHNvdXJjZUxhbmd1YWdlLCBzZXR0aW5ncyk7XG5cbiAgICBsZXQgZW5kTGluZSA9IGk7XG4gICAgY29uc3QgY29udGVudExpbmVzOiBzdHJpbmdbXSA9IFtdO1xuXG4gICAgZm9yIChsZXQgaiA9IGkgKyAxOyBqIDwgbGluZXMubGVuZ3RoOyBqICs9IDEpIHtcbiAgICAgIGNvbnN0IGlubmVyTGluZSA9IGxpbmVzW2pdO1xuICAgICAgY29uc3QgdHJpbW1lZCA9IGlubmVyTGluZS50cmltKCk7XG5cbiAgICAgIGlmICh0cmltbWVkLnN0YXJ0c1dpdGgoZmVuY2VUb2tlbikgJiYgL14oYGBgK3x+fn4rKVxccyokLy50ZXN0KHRyaW1tZWQpKSB7XG4gICAgICAgIGVuZExpbmUgPSBqO1xuICAgICAgICBpID0gajtcbiAgICAgICAgYnJlYWs7XG4gICAgICB9XG5cbiAgICAgIGNvbnRlbnRMaW5lcy5wdXNoKHN0cmlwRmVuY2VJbmRlbnQoaW5uZXJMaW5lLCBmZW5jZUluZGVudCkpO1xuICAgICAgZW5kTGluZSA9IGo7XG4gICAgfVxuXG4gICAgaWYgKCFsYW5ndWFnZSkge1xuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgb3JkaW5hbCArPSAxO1xuICAgIGNvbnN0IGNvbnRlbnQgPSBjb250ZW50TGluZXMuam9pbihcIlxcblwiKTtcbiAgICBjb25zdCByZWZlcmVuY2VIYXNoID0gc291cmNlUmVmZXJlbmNlID8gYDoke0pTT04uc3RyaW5naWZ5KHNvdXJjZVJlZmVyZW5jZSl9YCA6IFwiXCI7XG4gICAgY29uc3QgY29udGVudEhhc2ggPSBzaG9ydEhhc2goYCR7Y29udGVudH0ke3JlZmVyZW5jZUhhc2h9YCk7XG4gICAgY29uc3QgaWQgPSBzaG9ydEhhc2goYCR7ZmlsZVBhdGh9OiR7b3JkaW5hbH06JHtsYW5ndWFnZX06JHtjb250ZW50SGFzaH1gKTtcblxuICAgIGJsb2Nrcy5wdXNoKHtcbiAgICAgIGlkLFxuICAgICAgb3JkaW5hbCxcbiAgICAgIGZpbGVQYXRoLFxuICAgICAgbGFuZ3VhZ2UsXG4gICAgICBsYW5ndWFnZUFsaWFzOiBzb3VyY2VMYW5ndWFnZS50b0xvd2VyQ2FzZSgpLFxuICAgICAgc291cmNlTGFuZ3VhZ2UsXG4gICAgICBjb250ZW50LFxuICAgICAgc291cmNlUmVmZXJlbmNlLFxuICAgICAgc3RhcnRMaW5lLFxuICAgICAgZW5kTGluZSxcbiAgICAgIGZlbmNlU3RhcnQ6IDAsXG4gICAgICBmZW5jZUVuZDogMCxcbiAgICB9KTtcbiAgfVxuXG4gIHJldHVybiBibG9ja3M7XG59XG5cbmZ1bmN0aW9uIHBhcnNlQWxpYXNMaXN0KHZhbHVlOiBzdHJpbmcpOiBzdHJpbmdbXSB7XG4gIHJldHVybiB2YWx1ZVxuICAgIC5zcGxpdChcIixcIilcbiAgICAubWFwKChhbGlhcykgPT4gYWxpYXMudHJpbSgpLnRvTG93ZXJDYXNlKCkpXG4gICAgLmZpbHRlcihCb29sZWFuKTtcbn1cblxuZnVuY3Rpb24gcGFyc2VTb3VyY2VSZWZlcmVuY2UoaW5mb1RhaWw6IHN0cmluZyk6IGxvb21Tb3VyY2VSZWZlcmVuY2UgfCB1bmRlZmluZWQge1xuICBjb25zdCBhdHRycyA9IHBhcnNlSW5mb0F0dHJpYnV0ZXMoaW5mb1RhaWwpO1xuICBjb25zdCBmaWxlUGF0aCA9IGF0dHJzW1wibG9vbS1maWxlXCJdID8/IGF0dHJzLmZpbGUgPz8gYXR0cnMuc3JjID8/IGF0dHJzLnNvdXJjZTtcbiAgaWYgKCFmaWxlUGF0aCkge1xuICAgIHJldHVybiB1bmRlZmluZWQ7XG4gIH1cblxuICBjb25zdCBsaW5lcyA9IGF0dHJzW1wibG9vbS1saW5lc1wiXSA/PyBhdHRycy5saW5lcyA/PyBhdHRycy5saW5lO1xuICBjb25zdCBsaW5lUmFuZ2UgPSBsaW5lcyA/IHBhcnNlTGluZVJhbmdlKGxpbmVzKSA6IG51bGw7XG4gIGNvbnN0IHN5bWJvbE5hbWUgPSBhdHRyc1tcImxvb20tc3ltYm9sXCJdID8/IGF0dHJzLnN5bWJvbCA/PyBhdHRycy5mbiA/PyBhdHRycy5mdW5jdGlvbjtcbiAgY29uc3QgdHJhY2VWYWx1ZSA9IGF0dHJzW1wibG9vbS1kZXBzXCJdID8/IGF0dHJzLmRlcHMgPz8gYXR0cnMudHJhY2U7XG5cbiAgcmV0dXJuIHtcbiAgICBmaWxlUGF0aCxcbiAgICBsaW5lU3RhcnQ6IGxpbmVSYW5nZT8uc3RhcnQsXG4gICAgbGluZUVuZDogbGluZVJhbmdlPy5lbmQsXG4gICAgc3ltYm9sTmFtZSxcbiAgICB0cmFjZURlcGVuZGVuY2llczogdHJhY2VWYWx1ZSA9PSBudWxsID8gdHJ1ZSA6ICFbXCIwXCIsIFwiZmFsc2VcIiwgXCJub1wiLCBcIm9mZlwiXS5pbmNsdWRlcyh0cmFjZVZhbHVlLnRvTG93ZXJDYXNlKCkpLFxuICB9O1xufVxuXG5mdW5jdGlvbiBwYXJzZUluZm9BdHRyaWJ1dGVzKGlucHV0OiBzdHJpbmcpOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+IHtcbiAgY29uc3QgYXR0cnM6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4gPSB7fTtcbiAgY29uc3QgcGF0dGVybiA9IC8oW0EtWmEtejAtOV8tXSspXFxzKj1cXHMqKD86XCIoW15cIl0qKVwifCcoW14nXSopJ3woW15cXHNdKykpL2c7XG4gIGxldCBtYXRjaDogUmVnRXhwRXhlY0FycmF5IHwgbnVsbDtcbiAgd2hpbGUgKChtYXRjaCA9IHBhdHRlcm4uZXhlYyhpbnB1dCkpICE9IG51bGwpIHtcbiAgICBhdHRyc1ttYXRjaFsxXS50b0xvd2VyQ2FzZSgpXSA9IG1hdGNoWzJdID8/IG1hdGNoWzNdID8/IG1hdGNoWzRdID8/IFwiXCI7XG4gIH1cbiAgcmV0dXJuIGF0dHJzO1xufVxuXG5mdW5jdGlvbiBwYXJzZUxpbmVSYW5nZSh2YWx1ZTogc3RyaW5nKTogeyBzdGFydDogbnVtYmVyOyBlbmQ6IG51bWJlciB9IHwgbnVsbCB7XG4gIGNvbnN0IG1hdGNoID0gdmFsdWUudHJpbSgpLm1hdGNoKC9eTD8oXFxkKykoPzpcXHMqWy06XVxccypMPyhcXGQrKSk/JC9pKTtcbiAgaWYgKCFtYXRjaCkge1xuICAgIHJldHVybiBudWxsO1xuICB9XG4gIGNvbnN0IHN0YXJ0ID0gTnVtYmVyLnBhcnNlSW50KG1hdGNoWzFdLCAxMCk7XG4gIGNvbnN0IGVuZCA9IE51bWJlci5wYXJzZUludChtYXRjaFsyXSA/PyBtYXRjaFsxXSwgMTApO1xuICBpZiAoIU51bWJlci5pc0ludGVnZXIoc3RhcnQpIHx8ICFOdW1iZXIuaXNJbnRlZ2VyKGVuZCkgfHwgc3RhcnQgPD0gMCB8fCBlbmQgPCBzdGFydCkge1xuICAgIHJldHVybiBudWxsO1xuICB9XG4gIHJldHVybiB7IHN0YXJ0LCBlbmQgfTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGZpbmRCbG9ja0F0TGluZShibG9ja3M6IGxvb21Db2RlQmxvY2tbXSwgbGluZTogbnVtYmVyKTogbG9vbUNvZGVCbG9jayB8IG51bGwge1xuICByZXR1cm4gYmxvY2tzLmZpbmQoKGJsb2NrKSA9PiBsaW5lID49IGJsb2NrLnN0YXJ0TGluZSAmJiBsaW5lIDw9IGJsb2NrLmVuZExpbmUpID8/IG51bGw7XG59XG5cbmZ1bmN0aW9uIGdldExlYWRpbmdXaGl0ZXNwYWNlKGxpbmU6IHN0cmluZyk6IHN0cmluZyB7XG4gIGNvbnN0IG1hdGNoID0gbGluZS5tYXRjaCgvXltcXHQgXSovKTtcbiAgcmV0dXJuIG1hdGNoPy5bMF0gPz8gXCJcIjtcbn1cblxuZnVuY3Rpb24gc3RyaXBGZW5jZUluZGVudChsaW5lOiBzdHJpbmcsIGZlbmNlSW5kZW50OiBzdHJpbmcpOiBzdHJpbmcge1xuICBpZiAoIWZlbmNlSW5kZW50KSB7XG4gICAgcmV0dXJuIGxpbmU7XG4gIH1cblxuICBsZXQgaW5kZXggPSAwO1xuICB3aGlsZSAoaW5kZXggPCBmZW5jZUluZGVudC5sZW5ndGggJiYgaW5kZXggPCBsaW5lLmxlbmd0aCAmJiBsaW5lW2luZGV4XSA9PT0gZmVuY2VJbmRlbnRbaW5kZXhdKSB7XG4gICAgaW5kZXggKz0gMTtcbiAgfVxuXG4gIHJldHVybiBsaW5lLnNsaWNlKGluZGV4KTtcbn1cbiIsICJpbXBvcnQgeyBydW5UZW1wRmlsZVByb2Nlc3MgfSBmcm9tIFwiLi4vZXhlY3V0aW9uL3Byb2Nlc3NSdW5uZXJcIjtcbmltcG9ydCB0eXBlIHsgbG9vbUNvZGVCbG9jaywgbG9vbVBsdWdpblNldHRpbmdzLCBsb29tUnVuQ29udGV4dCwgbG9vbVJ1blJlc3VsdCwgbG9vbVJ1bm5lciB9IGZyb20gXCIuLi90eXBlc1wiO1xuXG5leHBvcnQgY2xhc3MgTm9kZVJ1bm5lciBpbXBsZW1lbnRzIGxvb21SdW5uZXIge1xuICBpZCA9IFwibm9kZVwiO1xuICBkaXNwbGF5TmFtZSA9IFwiTm9kZS5qc1wiO1xuICBsYW5ndWFnZXMgPSBbXCJqYXZhc2NyaXB0XCIsIFwidHlwZXNjcmlwdFwiXSBhcyBjb25zdDtcblxuICBjYW5SdW4oYmxvY2s6IGxvb21Db2RlQmxvY2ssIHNldHRpbmdzOiBsb29tUGx1Z2luU2V0dGluZ3MpOiBib29sZWFuIHtcbiAgICBpZiAoYmxvY2subGFuZ3VhZ2UgPT09IFwiamF2YXNjcmlwdFwiKSB7XG4gICAgICByZXR1cm4gQm9vbGVhbihzZXR0aW5ncy5ub2RlRXhlY3V0YWJsZS50cmltKCkpO1xuICAgIH1cblxuICAgIHJldHVybiBCb29sZWFuKHNldHRpbmdzLnR5cGVzY3JpcHRUcmFuc3BpbGVyRXhlY3V0YWJsZS50cmltKCkpO1xuICB9XG5cbiAgYXN5bmMgcnVuKGJsb2NrOiBsb29tQ29kZUJsb2NrLCBjb250ZXh0OiBsb29tUnVuQ29udGV4dCwgc2V0dGluZ3M6IGxvb21QbHVnaW5TZXR0aW5ncyk6IFByb21pc2U8bG9vbVJ1blJlc3VsdD4ge1xuICAgIGlmIChibG9jay5sYW5ndWFnZSA9PT0gXCJqYXZhc2NyaXB0XCIpIHtcbiAgICAgIHJldHVybiBydW5UZW1wRmlsZVByb2Nlc3Moe1xuICAgICAgICBydW5uZXJJZDogdGhpcy5pZCxcbiAgICAgICAgcnVubmVyTmFtZTogdGhpcy5kaXNwbGF5TmFtZSxcbiAgICAgICAgZXhlY3V0YWJsZTogc2V0dGluZ3Mubm9kZUV4ZWN1dGFibGUudHJpbSgpLFxuICAgICAgICBhcmdzOiBbXCJ7ZmlsZX1cIl0sXG4gICAgICAgIGZpbGVFeHRlbnNpb246IFwiLmpzXCIsXG4gICAgICAgIHNvdXJjZTogYmxvY2suY29udGVudCxcbiAgICAgICAgd29ya2luZ0RpcmVjdG9yeTogY29udGV4dC53b3JraW5nRGlyZWN0b3J5LFxuICAgICAgICB0aW1lb3V0TXM6IGNvbnRleHQudGltZW91dE1zLFxuICAgICAgICBzaWduYWw6IGNvbnRleHQuc2lnbmFsLFxuICAgICAgfSk7XG4gICAgfVxuXG4gICAgY29uc3QgZXhlY3V0YWJsZSA9IHNldHRpbmdzLnR5cGVzY3JpcHRUcmFuc3BpbGVyRXhlY3V0YWJsZS50cmltKCk7XG4gICAgY29uc3QgcnVubmVyTmFtZSA9IHNldHRpbmdzLnR5cGVzY3JpcHRNb2RlID09PSBcInRzeFwiID8gXCJUeXBlU2NyaXB0ICh0c3gpXCIgOiBcIlR5cGVTY3JpcHQgKHRzLW5vZGUpXCI7XG5cbiAgICByZXR1cm4gcnVuVGVtcEZpbGVQcm9jZXNzKHtcbiAgICAgIHJ1bm5lcklkOiBgJHt0aGlzLmlkfToke3NldHRpbmdzLnR5cGVzY3JpcHRNb2RlfWAsXG4gICAgICBydW5uZXJOYW1lLFxuICAgICAgZXhlY3V0YWJsZSxcbiAgICAgIGFyZ3M6IFtcIntmaWxlfVwiXSxcbiAgICAgIGZpbGVFeHRlbnNpb246IFwiLnRzXCIsXG4gICAgICBzb3VyY2U6IGJsb2NrLmNvbnRlbnQsXG4gICAgICB3b3JraW5nRGlyZWN0b3J5OiBjb250ZXh0LndvcmtpbmdEaXJlY3RvcnksXG4gICAgICB0aW1lb3V0TXM6IGNvbnRleHQudGltZW91dE1zLFxuICAgICAgc2lnbmFsOiBjb250ZXh0LnNpZ25hbCxcbiAgICB9KTtcbiAgfVxufVxuIiwgImltcG9ydCB7IHJ1blRlbXBGaWxlUHJvY2VzcyB9IGZyb20gXCIuLi9leGVjdXRpb24vcHJvY2Vzc1J1bm5lclwiO1xuaW1wb3J0IHsgc3BsaXRDb21tYW5kTGluZSB9IGZyb20gXCIuLi91dGlscy9jb21tYW5kXCI7XG5pbXBvcnQgdHlwZSB7IGxvb21Db2RlQmxvY2ssIGxvb21DdXN0b21MYW5ndWFnZSwgbG9vbVBsdWdpblNldHRpbmdzLCBsb29tUnVuQ29udGV4dCwgbG9vbVJ1blJlc3VsdCwgbG9vbVJ1bm5lciB9IGZyb20gXCIuLi90eXBlc1wiO1xuXG5leHBvcnQgY2xhc3MgQ3VzdG9tTGFuZ3VhZ2VSdW5uZXIgaW1wbGVtZW50cyBsb29tUnVubmVyIHtcbiAgaWQgPSBcImN1c3RvbVwiO1xuICBkaXNwbGF5TmFtZSA9IFwiQ3VzdG9tIGxhbmd1YWdlXCI7XG4gIGxhbmd1YWdlcyA9IFtdIGFzIGNvbnN0O1xuXG4gIGNhblJ1bihibG9jazogbG9vbUNvZGVCbG9jaywgc2V0dGluZ3M6IGxvb21QbHVnaW5TZXR0aW5ncyk6IGJvb2xlYW4ge1xuICAgIHJldHVybiBCb29sZWFuKHRoaXMuZ2V0Q3VzdG9tTGFuZ3VhZ2UoYmxvY2ssIHNldHRpbmdzKT8uZXhlY3V0YWJsZS50cmltKCkpO1xuICB9XG5cbiAgcnVuKGJsb2NrOiBsb29tQ29kZUJsb2NrLCBjb250ZXh0OiBsb29tUnVuQ29udGV4dCwgc2V0dGluZ3M6IGxvb21QbHVnaW5TZXR0aW5ncyk6IFByb21pc2U8bG9vbVJ1blJlc3VsdD4ge1xuICAgIGNvbnN0IGxhbmd1YWdlID0gdGhpcy5nZXRDdXN0b21MYW5ndWFnZShibG9jaywgc2V0dGluZ3MpO1xuICAgIGlmICghbGFuZ3VhZ2UpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgVW5zdXBwb3J0ZWQgY3VzdG9tIGxhbmd1YWdlOiAke2Jsb2NrLmxhbmd1YWdlfWApO1xuICAgIH1cblxuICAgIHJldHVybiBydW5UZW1wRmlsZVByb2Nlc3Moe1xuICAgICAgcnVubmVySWQ6IGAke3RoaXMuaWR9OiR7bGFuZ3VhZ2UubmFtZX1gLFxuICAgICAgcnVubmVyTmFtZTogbGFuZ3VhZ2UubmFtZSxcbiAgICAgIGV4ZWN1dGFibGU6IGxhbmd1YWdlLmV4ZWN1dGFibGUudHJpbSgpLFxuICAgICAgYXJnczogc3BsaXRDb21tYW5kTGluZShsYW5ndWFnZS5hcmdzIHx8IFwie2ZpbGV9XCIpLFxuICAgICAgZmlsZUV4dGVuc2lvbjogbm9ybWFsaXplRXh0ZW5zaW9uKGxhbmd1YWdlLmV4dGVuc2lvbiwgbGFuZ3VhZ2UubmFtZSksXG4gICAgICBzb3VyY2U6IGJsb2NrLmNvbnRlbnQsXG4gICAgICB3b3JraW5nRGlyZWN0b3J5OiBjb250ZXh0LndvcmtpbmdEaXJlY3RvcnksXG4gICAgICB0aW1lb3V0TXM6IGNvbnRleHQudGltZW91dE1zLFxuICAgICAgc2lnbmFsOiBjb250ZXh0LnNpZ25hbCxcbiAgICB9KTtcbiAgfVxuXG4gIHByaXZhdGUgZ2V0Q3VzdG9tTGFuZ3VhZ2UoYmxvY2s6IGxvb21Db2RlQmxvY2ssIHNldHRpbmdzOiBsb29tUGx1Z2luU2V0dGluZ3MpOiBsb29tQ3VzdG9tTGFuZ3VhZ2UgfCB1bmRlZmluZWQge1xuICAgIGNvbnN0IG5vcm1hbGl6ZWQgPSBibG9jay5sYW5ndWFnZS50cmltKCkudG9Mb3dlckNhc2UoKTtcbiAgICByZXR1cm4gc2V0dGluZ3MuY3VzdG9tTGFuZ3VhZ2VzLmZpbmQoKGxhbmd1YWdlKSA9PiB7XG4gICAgICBjb25zdCBuYW1lID0gbGFuZ3VhZ2UubmFtZS50cmltKCkudG9Mb3dlckNhc2UoKTtcbiAgICAgIGNvbnN0IGFsaWFzZXMgPSBsYW5ndWFnZS5hbGlhc2VzXG4gICAgICAgIC5zcGxpdChcIixcIilcbiAgICAgICAgLm1hcCgoYWxpYXMpID0+IGFsaWFzLnRyaW0oKS50b0xvd2VyQ2FzZSgpKVxuICAgICAgICAuZmlsdGVyKEJvb2xlYW4pO1xuICAgICAgcmV0dXJuIG5hbWUgPT09IG5vcm1hbGl6ZWQgfHwgYWxpYXNlcy5pbmNsdWRlcyhub3JtYWxpemVkKTtcbiAgICB9KTtcbiAgfVxufVxuXG5mdW5jdGlvbiBub3JtYWxpemVFeHRlbnNpb24oZXh0ZW5zaW9uOiBzdHJpbmcsIG5hbWU6IHN0cmluZyk6IHN0cmluZyB7XG4gIGNvbnN0IHRyaW1tZWQgPSBleHRlbnNpb24udHJpbSgpO1xuICBpZiAoIXRyaW1tZWQpIHtcbiAgICByZXR1cm4gYC4ke25hbWV9YDtcbiAgfVxuICByZXR1cm4gdHJpbW1lZC5zdGFydHNXaXRoKFwiLlwiKSA/IHRyaW1tZWQgOiBgLiR7dHJpbW1lZH1gO1xufVxuIiwgImltcG9ydCB7IHJ1blRlbXBGaWxlUHJvY2VzcyB9IGZyb20gXCIuLi9leGVjdXRpb24vcHJvY2Vzc1J1bm5lclwiO1xuaW1wb3J0IHR5cGUgeyBsb29tQ29kZUJsb2NrLCBsb29tTm9ybWFsaXplZExhbmd1YWdlLCBsb29tUGx1Z2luU2V0dGluZ3MsIGxvb21SdW5Db250ZXh0LCBsb29tUnVuUmVzdWx0LCBsb29tUnVubmVyIH0gZnJvbSBcIi4uL3R5cGVzXCI7XG5cbmludGVyZmFjZSBJbnRlcnByZXRlZFNwZWMge1xuICBsYW5ndWFnZTogbG9vbU5vcm1hbGl6ZWRMYW5ndWFnZTtcbiAgZGlzcGxheU5hbWU6IHN0cmluZztcbiAgZXhlY3V0YWJsZTogKHNldHRpbmdzOiBsb29tUGx1Z2luU2V0dGluZ3MpID0+IHN0cmluZztcbiAgZmlsZUV4dGVuc2lvbjogc3RyaW5nO1xuICBhcmdzPzogc3RyaW5nW107XG4gIGVudj86IE5vZGVKUy5Qcm9jZXNzRW52O1xuICBtaW5pbXVtVGltZW91dE1zPzogbnVtYmVyO1xufVxuXG5jb25zdCBJTlRFUlBSRVRFRF9TUEVDUzogSW50ZXJwcmV0ZWRTcGVjW10gPSBbXG4gIHtcbiAgICBsYW5ndWFnZTogXCJzaGVsbFwiLFxuICAgIGRpc3BsYXlOYW1lOiBcIlNoZWxsXCIsXG4gICAgZXhlY3V0YWJsZTogKHNldHRpbmdzKSA9PiBzZXR0aW5ncy5zaGVsbEV4ZWN1dGFibGUsXG4gICAgZmlsZUV4dGVuc2lvbjogXCIuc2hcIixcbiAgfSxcbiAge1xuICAgIGxhbmd1YWdlOiBcInJ1YnlcIixcbiAgICBkaXNwbGF5TmFtZTogXCJSdWJ5XCIsXG4gICAgZXhlY3V0YWJsZTogKHNldHRpbmdzKSA9PiBzZXR0aW5ncy5ydWJ5RXhlY3V0YWJsZSxcbiAgICBmaWxlRXh0ZW5zaW9uOiBcIi5yYlwiLFxuICB9LFxuICB7XG4gICAgbGFuZ3VhZ2U6IFwicGVybFwiLFxuICAgIGRpc3BsYXlOYW1lOiBcIlBlcmxcIixcbiAgICBleGVjdXRhYmxlOiAoc2V0dGluZ3MpID0+IHNldHRpbmdzLnBlcmxFeGVjdXRhYmxlLFxuICAgIGZpbGVFeHRlbnNpb246IFwiLnBsXCIsXG4gIH0sXG4gIHtcbiAgICBsYW5ndWFnZTogXCJsdWFcIixcbiAgICBkaXNwbGF5TmFtZTogXCJMdWFcIixcbiAgICBleGVjdXRhYmxlOiAoc2V0dGluZ3MpID0+IHNldHRpbmdzLmx1YUV4ZWN1dGFibGUsXG4gICAgZmlsZUV4dGVuc2lvbjogXCIubHVhXCIsXG4gIH0sXG4gIHtcbiAgICBsYW5ndWFnZTogXCJwaHBcIixcbiAgICBkaXNwbGF5TmFtZTogXCJQSFBcIixcbiAgICBleGVjdXRhYmxlOiAoc2V0dGluZ3MpID0+IHNldHRpbmdzLnBocEV4ZWN1dGFibGUsXG4gICAgZmlsZUV4dGVuc2lvbjogXCIucGhwXCIsXG4gIH0sXG4gIHtcbiAgICBsYW5ndWFnZTogXCJnb1wiLFxuICAgIGRpc3BsYXlOYW1lOiBcIkdvXCIsXG4gICAgZXhlY3V0YWJsZTogKHNldHRpbmdzKSA9PiBzZXR0aW5ncy5nb0V4ZWN1dGFibGUsXG4gICAgZmlsZUV4dGVuc2lvbjogXCIuZ29cIixcbiAgICBhcmdzOiBbXCJydW5cIiwgXCJ7ZmlsZX1cIl0sXG4gICAgZW52OiB7XG4gICAgICBHT0NBQ0hFOiBcInt0ZW1wRGlyfS9nb2NhY2hlXCIsXG4gICAgfSxcbiAgICBtaW5pbXVtVGltZW91dE1zOiAzMF8wMDAsXG4gIH0sXG4gIHtcbiAgICBsYW5ndWFnZTogXCJoYXNrZWxsXCIsXG4gICAgZGlzcGxheU5hbWU6IFwiSGFza2VsbFwiLFxuICAgIGV4ZWN1dGFibGU6IChzZXR0aW5ncykgPT4gc2V0dGluZ3MuaGFza2VsbEV4ZWN1dGFibGUsXG4gICAgZmlsZUV4dGVuc2lvbjogXCIuaHNcIixcbiAgICBtaW5pbXVtVGltZW91dE1zOiAzMF8wMDAsXG4gIH0sXG5dO1xuXG5leHBvcnQgY2xhc3MgSW50ZXJwcmV0ZWRSdW5uZXIgaW1wbGVtZW50cyBsb29tUnVubmVyIHtcbiAgaWQgPSBcImludGVycHJldGVkXCI7XG4gIGRpc3BsYXlOYW1lID0gXCJJbnRlcnByZXRlZFwiO1xuICBsYW5ndWFnZXMgPSBJTlRFUlBSRVRFRF9TUEVDUy5tYXAoKHNwZWMpID0+IHNwZWMubGFuZ3VhZ2UpO1xuXG4gIGNhblJ1bihibG9jazogbG9vbUNvZGVCbG9jaywgc2V0dGluZ3M6IGxvb21QbHVnaW5TZXR0aW5ncyk6IGJvb2xlYW4ge1xuICAgIGNvbnN0IHNwZWMgPSB0aGlzLmdldFNwZWMoYmxvY2subGFuZ3VhZ2UpO1xuICAgIHJldHVybiBCb29sZWFuKHNwZWM/LmV4ZWN1dGFibGUoc2V0dGluZ3MpLnRyaW0oKSk7XG4gIH1cblxuICBydW4oYmxvY2s6IGxvb21Db2RlQmxvY2ssIGNvbnRleHQ6IGxvb21SdW5Db250ZXh0LCBzZXR0aW5nczogbG9vbVBsdWdpblNldHRpbmdzKTogUHJvbWlzZTxsb29tUnVuUmVzdWx0PiB7XG4gICAgY29uc3Qgc3BlYyA9IHRoaXMuZ2V0U3BlYyhibG9jay5sYW5ndWFnZSk7XG4gICAgaWYgKCFzcGVjKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYFVuc3VwcG9ydGVkIGxhbmd1YWdlOiAke2Jsb2NrLmxhbmd1YWdlfWApO1xuICAgIH1cblxuICAgIHJldHVybiBydW5UZW1wRmlsZVByb2Nlc3Moe1xuICAgICAgcnVubmVySWQ6IGAke3RoaXMuaWR9OiR7YmxvY2subGFuZ3VhZ2V9YCxcbiAgICAgIHJ1bm5lck5hbWU6IHNwZWMuZGlzcGxheU5hbWUsXG4gICAgICBleGVjdXRhYmxlOiBzcGVjLmV4ZWN1dGFibGUoc2V0dGluZ3MpLnRyaW0oKSxcbiAgICAgIGFyZ3M6IHNwZWMuYXJncyA/PyBbXCJ7ZmlsZX1cIl0sXG4gICAgICBmaWxlRXh0ZW5zaW9uOiBzcGVjLmZpbGVFeHRlbnNpb24sXG4gICAgICBzb3VyY2U6IGJsb2NrLmNvbnRlbnQsXG4gICAgICB3b3JraW5nRGlyZWN0b3J5OiBjb250ZXh0LndvcmtpbmdEaXJlY3RvcnksXG4gICAgICB0aW1lb3V0TXM6IE1hdGgubWF4KGNvbnRleHQudGltZW91dE1zLCBzcGVjLm1pbmltdW1UaW1lb3V0TXMgPz8gMCksXG4gICAgICBzaWduYWw6IGNvbnRleHQuc2lnbmFsLFxuICAgICAgZW52OiBzcGVjLmVudixcbiAgICB9KTtcbiAgfVxuXG4gIHByaXZhdGUgZ2V0U3BlYyhsYW5ndWFnZTogbG9vbU5vcm1hbGl6ZWRMYW5ndWFnZSk6IEludGVycHJldGVkU3BlYyB8IHVuZGVmaW5lZCB7XG4gICAgcmV0dXJuIElOVEVSUFJFVEVEX1NQRUNTLmZpbmQoKHNwZWMpID0+IHNwZWMubGFuZ3VhZ2UgPT09IGxhbmd1YWdlKTtcbiAgfVxufVxuIiwgImltcG9ydCB7IHJ1blRlbXBGaWxlUHJvY2VzcyB9IGZyb20gXCIuLi9leGVjdXRpb24vcHJvY2Vzc1J1bm5lclwiO1xuaW1wb3J0IHR5cGUgeyBsb29tQ29kZUJsb2NrLCBsb29tUGx1Z2luU2V0dGluZ3MsIGxvb21SdW5Db250ZXh0LCBsb29tUnVuUmVzdWx0LCBsb29tUnVubmVyIH0gZnJvbSBcIi4uL3R5cGVzXCI7XG5cbmV4cG9ydCBjbGFzcyBMbHZtUnVubmVyIGltcGxlbWVudHMgbG9vbVJ1bm5lciB7XG4gIGlkID0gXCJsbHZtLWlyXCI7XG4gIGRpc3BsYXlOYW1lID0gXCJMTFZNIElSXCI7XG4gIGxhbmd1YWdlcyA9IFtcImxsdm0taXJcIl0gYXMgY29uc3Q7XG5cbiAgY2FuUnVuKGJsb2NrOiBsb29tQ29kZUJsb2NrLCBzZXR0aW5nczogbG9vbVBsdWdpblNldHRpbmdzKTogYm9vbGVhbiB7XG4gICAgcmV0dXJuIGJsb2NrLmxhbmd1YWdlID09PSBcImxsdm0taXJcIiAmJiBCb29sZWFuKHNldHRpbmdzLmxsdm1JbnRlcnByZXRlckV4ZWN1dGFibGUudHJpbSgpKTtcbiAgfVxuXG4gIGFzeW5jIHJ1bihibG9jazogbG9vbUNvZGVCbG9jaywgY29udGV4dDogbG9vbVJ1bkNvbnRleHQsIHNldHRpbmdzOiBsb29tUGx1Z2luU2V0dGluZ3MpOiBQcm9taXNlPGxvb21SdW5SZXN1bHQ+IHtcbiAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBydW5UZW1wRmlsZVByb2Nlc3Moe1xuICAgICAgcnVubmVySWQ6IHRoaXMuaWQsXG4gICAgICBydW5uZXJOYW1lOiB0aGlzLmRpc3BsYXlOYW1lLFxuICAgICAgZXhlY3V0YWJsZTogc2V0dGluZ3MubGx2bUludGVycHJldGVyRXhlY3V0YWJsZS50cmltKCksXG4gICAgICBhcmdzOiBbXCJ7ZmlsZX1cIl0sXG4gICAgICBmaWxlRXh0ZW5zaW9uOiBcIi5sbFwiLFxuICAgICAgc291cmNlOiBibG9jay5jb250ZW50LFxuICAgICAgd29ya2luZ0RpcmVjdG9yeTogY29udGV4dC53b3JraW5nRGlyZWN0b3J5LFxuICAgICAgdGltZW91dE1zOiBNYXRoLm1heChjb250ZXh0LnRpbWVvdXRNcywgMzBfMDAwKSxcbiAgICAgIHNpZ25hbDogY29udGV4dC5zaWduYWwsXG4gICAgfSk7XG5cbiAgICBpZiAoIXJlc3VsdC50aW1lZE91dCAmJiAhcmVzdWx0LmNhbmNlbGxlZCAmJiByZXN1bHQuZXhpdENvZGUgIT0gbnVsbCAmJiAhcmVzdWx0LnN0ZGVyci50cmltKCkpIHtcbiAgICAgIGlmIChyZXN1bHQuZXhpdENvZGUgIT09IDApIHtcbiAgICAgICAgcmVzdWx0LnN1Y2Nlc3MgPSB0cnVlO1xuICAgICAgICByZXN1bHQud2FybmluZyA9IGBQcm9ncmFtIHJldHVybmVkIGkzMiAke3Jlc3VsdC5leGl0Q29kZX0uIFVuZGVyIGxsaSwgdGhhdCBiZWNvbWVzIHRoZSBwcm9jZXNzIGV4aXQgc3RhdHVzLmA7XG4gICAgICB9XG5cbiAgICAgIGlmICghcmVzdWx0LnN0ZG91dC50cmltKCkpIHtcbiAgICAgICAgcmVzdWx0LnN0ZG91dCA9IHJlc3VsdC5leGl0Q29kZSA9PT0gMFxuICAgICAgICAgID8gXCJMTFZNIHByb2dyYW0gZXhpdGVkIHdpdGggY29kZSAwLlwiXG4gICAgICAgICAgOiBgTExWTSBwcm9ncmFtIHJldHVybmVkIGkzMiAke3Jlc3VsdC5leGl0Q29kZX0uXFxuVXNlIHN0ZG91dCBpbiB0aGUgSVIgaXRzZWxmIGlmIHlvdSB3YW50IHByaW50YWJsZSBwcm9ncmFtIG91dHB1dC5gO1xuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiByZXN1bHQ7XG4gIH1cbn1cbiIsICJpbXBvcnQgeyBqb2luIH0gZnJvbSBcInBhdGhcIjtcbmltcG9ydCB7IHJ1blByb2Nlc3MsIHdpdGhOYW1lZFRlbXBTb3VyY2VGaWxlLCB3aXRoVGVtcFNvdXJjZUZpbGUgfSBmcm9tIFwiLi4vZXhlY3V0aW9uL3Byb2Nlc3NSdW5uZXJcIjtcbmltcG9ydCB0eXBlIHsgbG9vbUNvZGVCbG9jaywgbG9vbVBsdWdpblNldHRpbmdzLCBsb29tUnVuQ29udGV4dCwgbG9vbVJ1blJlc3VsdCwgbG9vbVJ1bm5lciB9IGZyb20gXCIuLi90eXBlc1wiO1xuXG5leHBvcnQgY2xhc3MgTWFuYWdlZENvbXBpbGVkUnVubmVyIGltcGxlbWVudHMgbG9vbVJ1bm5lciB7XG4gIGlkID0gXCJtYW5hZ2VkLWNvbXBpbGVkXCI7XG4gIGRpc3BsYXlOYW1lID0gXCJNYW5hZ2VkIGNvbXBpbGVyXCI7XG4gIGxhbmd1YWdlcyA9IFtcInJ1c3RcIiwgXCJqYXZhXCJdIGFzIGNvbnN0O1xuXG4gIGNhblJ1bihibG9jazogbG9vbUNvZGVCbG9jaywgc2V0dGluZ3M6IGxvb21QbHVnaW5TZXR0aW5ncyk6IGJvb2xlYW4ge1xuICAgIGlmIChibG9jay5sYW5ndWFnZSA9PT0gXCJydXN0XCIpIHtcbiAgICAgIHJldHVybiBCb29sZWFuKHNldHRpbmdzLnJ1c3RFeGVjdXRhYmxlLnRyaW0oKSk7XG4gICAgfVxuXG4gICAgaWYgKGJsb2NrLmxhbmd1YWdlID09PSBcImphdmFcIikge1xuICAgICAgcmV0dXJuIEJvb2xlYW4oc2V0dGluZ3MuamF2YUV4ZWN1dGFibGUudHJpbSgpKTtcbiAgICB9XG5cbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cblxuICBhc3luYyBydW4oYmxvY2s6IGxvb21Db2RlQmxvY2ssIGNvbnRleHQ6IGxvb21SdW5Db250ZXh0LCBzZXR0aW5nczogbG9vbVBsdWdpblNldHRpbmdzKTogUHJvbWlzZTxsb29tUnVuUmVzdWx0PiB7XG4gICAgaWYgKGJsb2NrLmxhbmd1YWdlID09PSBcInJ1c3RcIikge1xuICAgICAgcmV0dXJuIHRoaXMucnVuUnVzdChibG9jaywgY29udGV4dCwgc2V0dGluZ3MpO1xuICAgIH1cblxuICAgIGlmIChibG9jay5sYW5ndWFnZSA9PT0gXCJqYXZhXCIpIHtcbiAgICAgIHJldHVybiB0aGlzLnJ1bkphdmEoYmxvY2ssIGNvbnRleHQsIHNldHRpbmdzKTtcbiAgICB9XG5cbiAgICB0aHJvdyBuZXcgRXJyb3IoYFVuc3VwcG9ydGVkIGxhbmd1YWdlOiAke2Jsb2NrLmxhbmd1YWdlfWApO1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBydW5SdXN0KGJsb2NrOiBsb29tQ29kZUJsb2NrLCBjb250ZXh0OiBsb29tUnVuQ29udGV4dCwgc2V0dGluZ3M6IGxvb21QbHVnaW5TZXR0aW5ncyk6IFByb21pc2U8bG9vbVJ1blJlc3VsdD4ge1xuICAgIHJldHVybiB3aXRoVGVtcFNvdXJjZUZpbGUoXCIucnNcIiwgYmxvY2suY29udGVudCwgYXN5bmMgKHsgdGVtcERpciwgdGVtcEZpbGUgfSkgPT4ge1xuICAgICAgY29uc3QgYmluYXJ5UGF0aCA9IGpvaW4odGVtcERpciwgXCJzbmlwcGV0Lm91dFwiKTtcbiAgICAgIGNvbnN0IGNvbXBpbGVSZXN1bHQgPSBhd2FpdCBydW5Qcm9jZXNzKHtcbiAgICAgICAgcnVubmVySWQ6IGAke3RoaXMuaWR9OnJ1c3Q6Y29tcGlsZWAsXG4gICAgICAgIHJ1bm5lck5hbWU6IFwiUnVzdFwiLFxuICAgICAgICBleGVjdXRhYmxlOiBzZXR0aW5ncy5ydXN0RXhlY3V0YWJsZS50cmltKCksXG4gICAgICAgIGFyZ3M6IFt0ZW1wRmlsZSwgXCItb1wiLCBiaW5hcnlQYXRoXSxcbiAgICAgICAgd29ya2luZ0RpcmVjdG9yeTogY29udGV4dC53b3JraW5nRGlyZWN0b3J5LFxuICAgICAgICB0aW1lb3V0TXM6IE1hdGgubWF4KGNvbnRleHQudGltZW91dE1zLCAzMF8wMDApLFxuICAgICAgICBzaWduYWw6IGNvbnRleHQuc2lnbmFsLFxuICAgICAgfSk7XG5cbiAgICAgIGlmICghY29tcGlsZVJlc3VsdC5zdWNjZXNzKSB7XG4gICAgICAgIHJldHVybiBjb21waWxlUmVzdWx0O1xuICAgICAgfVxuXG4gICAgICByZXR1cm4gcnVuUHJvY2Vzcyh7XG4gICAgICAgIHJ1bm5lcklkOiBgJHt0aGlzLmlkfTpydXN0OnJ1bmAsXG4gICAgICAgIHJ1bm5lck5hbWU6IFwiUnVzdFwiLFxuICAgICAgICBleGVjdXRhYmxlOiBiaW5hcnlQYXRoLFxuICAgICAgICBhcmdzOiBbXSxcbiAgICAgICAgd29ya2luZ0RpcmVjdG9yeTogY29udGV4dC53b3JraW5nRGlyZWN0b3J5LFxuICAgICAgICB0aW1lb3V0TXM6IE1hdGgubWF4KGNvbnRleHQudGltZW91dE1zLCAzMF8wMDApLFxuICAgICAgICBzaWduYWw6IGNvbnRleHQuc2lnbmFsLFxuICAgICAgfSk7XG4gICAgfSk7XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIHJ1bkphdmEoYmxvY2s6IGxvb21Db2RlQmxvY2ssIGNvbnRleHQ6IGxvb21SdW5Db250ZXh0LCBzZXR0aW5nczogbG9vbVBsdWdpblNldHRpbmdzKTogUHJvbWlzZTxsb29tUnVuUmVzdWx0PiB7XG4gICAgcmV0dXJuIHdpdGhOYW1lZFRlbXBTb3VyY2VGaWxlKFwiTWFpbi5qYXZhXCIsIGJsb2NrLmNvbnRlbnQsIGFzeW5jICh7IHRlbXBEaXIsIHRlbXBGaWxlIH0pID0+IHtcbiAgICAgIGlmICghc2V0dGluZ3MuamF2YUNvbXBpbGVyRXhlY3V0YWJsZS50cmltKCkpIHtcbiAgICAgICAgcmV0dXJuIHJ1blByb2Nlc3Moe1xuICAgICAgICAgIHJ1bm5lcklkOiBgJHt0aGlzLmlkfTpqYXZhOnNvdXJjZWAsXG4gICAgICAgICAgcnVubmVyTmFtZTogXCJKYXZhXCIsXG4gICAgICAgICAgZXhlY3V0YWJsZTogc2V0dGluZ3MuamF2YUV4ZWN1dGFibGUudHJpbSgpLFxuICAgICAgICAgIGFyZ3M6IFt0ZW1wRmlsZV0sXG4gICAgICAgICAgd29ya2luZ0RpcmVjdG9yeTogY29udGV4dC53b3JraW5nRGlyZWN0b3J5LFxuICAgICAgICAgIHRpbWVvdXRNczogTWF0aC5tYXgoY29udGV4dC50aW1lb3V0TXMsIDMwXzAwMCksXG4gICAgICAgICAgc2lnbmFsOiBjb250ZXh0LnNpZ25hbCxcbiAgICAgICAgfSk7XG4gICAgICB9XG5cbiAgICAgIGNvbnN0IGNvbXBpbGVSZXN1bHQgPSBhd2FpdCBydW5Qcm9jZXNzKHtcbiAgICAgICAgcnVubmVySWQ6IGAke3RoaXMuaWR9OmphdmE6Y29tcGlsZWAsXG4gICAgICAgIHJ1bm5lck5hbWU6IFwiSmF2YVwiLFxuICAgICAgICBleGVjdXRhYmxlOiBzZXR0aW5ncy5qYXZhQ29tcGlsZXJFeGVjdXRhYmxlLnRyaW0oKSxcbiAgICAgICAgYXJnczogW3RlbXBGaWxlXSxcbiAgICAgICAgd29ya2luZ0RpcmVjdG9yeTogdGVtcERpcixcbiAgICAgICAgdGltZW91dE1zOiBNYXRoLm1heChjb250ZXh0LnRpbWVvdXRNcywgMzBfMDAwKSxcbiAgICAgICAgc2lnbmFsOiBjb250ZXh0LnNpZ25hbCxcbiAgICAgIH0pO1xuXG4gICAgICBpZiAoIWNvbXBpbGVSZXN1bHQuc3VjY2Vzcykge1xuICAgICAgICByZXR1cm4gY29tcGlsZVJlc3VsdDtcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIHJ1blByb2Nlc3Moe1xuICAgICAgICBydW5uZXJJZDogYCR7dGhpcy5pZH06amF2YTpydW5gLFxuICAgICAgICBydW5uZXJOYW1lOiBcIkphdmFcIixcbiAgICAgICAgZXhlY3V0YWJsZTogc2V0dGluZ3MuamF2YUV4ZWN1dGFibGUudHJpbSgpLFxuICAgICAgICBhcmdzOiBbXCItY3BcIiwgdGVtcERpciwgXCJNYWluXCJdLFxuICAgICAgICB3b3JraW5nRGlyZWN0b3J5OiBjb250ZXh0LndvcmtpbmdEaXJlY3RvcnksXG4gICAgICAgIHRpbWVvdXRNczogTWF0aC5tYXgoY29udGV4dC50aW1lb3V0TXMsIDMwXzAwMCksXG4gICAgICAgIHNpZ25hbDogY29udGV4dC5zaWduYWwsXG4gICAgICB9KTtcbiAgICB9KTtcbiAgfVxufVxuIiwgImltcG9ydCB7IGpvaW4gfSBmcm9tIFwicGF0aFwiO1xuaW1wb3J0IHsgcnVuUHJvY2Vzcywgd2l0aFRlbXBTb3VyY2VGaWxlIH0gZnJvbSBcIi4uL2V4ZWN1dGlvbi9wcm9jZXNzUnVubmVyXCI7XG5pbXBvcnQgdHlwZSB7IGxvb21Db2RlQmxvY2ssIGxvb21QbHVnaW5TZXR0aW5ncywgbG9vbVJ1bkNvbnRleHQsIGxvb21SdW5SZXN1bHQsIGxvb21SdW5uZXIgfSBmcm9tIFwiLi4vdHlwZXNcIjtcblxuZXhwb3J0IGNsYXNzIE5hdGl2ZUNvbXBpbGVkUnVubmVyIGltcGxlbWVudHMgbG9vbVJ1bm5lciB7XG4gIGlkID0gXCJuYXRpdmUtY29tcGlsZWRcIjtcbiAgZGlzcGxheU5hbWUgPSBcIk5hdGl2ZSBjb21waWxlclwiO1xuICBsYW5ndWFnZXMgPSBbXCJjXCIsIFwiY3BwXCJdIGFzIGNvbnN0O1xuXG4gIGNhblJ1bihibG9jazogbG9vbUNvZGVCbG9jaywgc2V0dGluZ3M6IGxvb21QbHVnaW5TZXR0aW5ncyk6IGJvb2xlYW4ge1xuICAgIGlmIChibG9jay5sYW5ndWFnZSA9PT0gXCJjXCIpIHtcbiAgICAgIHJldHVybiBCb29sZWFuKHNldHRpbmdzLmNFeGVjdXRhYmxlLnRyaW0oKSk7XG4gICAgfVxuXG4gICAgaWYgKGJsb2NrLmxhbmd1YWdlID09PSBcImNwcFwiKSB7XG4gICAgICByZXR1cm4gQm9vbGVhbihzZXR0aW5ncy5jcHBFeGVjdXRhYmxlLnRyaW0oKSk7XG4gICAgfVxuXG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG5cbiAgYXN5bmMgcnVuKGJsb2NrOiBsb29tQ29kZUJsb2NrLCBjb250ZXh0OiBsb29tUnVuQ29udGV4dCwgc2V0dGluZ3M6IGxvb21QbHVnaW5TZXR0aW5ncyk6IFByb21pc2U8bG9vbVJ1blJlc3VsdD4ge1xuICAgIGNvbnN0IGV4ZWN1dGFibGUgPSBibG9jay5sYW5ndWFnZSA9PT0gXCJjXCIgPyBzZXR0aW5ncy5jRXhlY3V0YWJsZS50cmltKCkgOiBzZXR0aW5ncy5jcHBFeGVjdXRhYmxlLnRyaW0oKTtcbiAgICBjb25zdCBmaWxlRXh0ZW5zaW9uID0gYmxvY2subGFuZ3VhZ2UgPT09IFwiY1wiID8gXCIuY1wiIDogXCIuY3BwXCI7XG4gICAgY29uc3QgcnVubmVyTmFtZSA9IGJsb2NrLmxhbmd1YWdlID09PSBcImNcIiA/IFwiQyAoR0NDKVwiIDogXCJDKysgKEcrKylcIjtcblxuICAgIHJldHVybiB3aXRoVGVtcFNvdXJjZUZpbGUoZmlsZUV4dGVuc2lvbiwgYmxvY2suY29udGVudCwgYXN5bmMgKHsgdGVtcERpciwgdGVtcEZpbGUgfSkgPT4ge1xuICAgICAgY29uc3QgYmluYXJ5UGF0aCA9IGpvaW4odGVtcERpciwgXCJzbmlwcGV0Lm91dFwiKTtcbiAgICAgIGNvbnN0IGNvbXBpbGVSZXN1bHQgPSBhd2FpdCBydW5Qcm9jZXNzKHtcbiAgICAgICAgcnVubmVySWQ6IGAke3RoaXMuaWR9OiR7YmxvY2subGFuZ3VhZ2V9OmNvbXBpbGVgLFxuICAgICAgICBydW5uZXJOYW1lLFxuICAgICAgICBleGVjdXRhYmxlLFxuICAgICAgICBhcmdzOiBbdGVtcEZpbGUsIFwiLW9cIiwgYmluYXJ5UGF0aF0sXG4gICAgICAgIHdvcmtpbmdEaXJlY3Rvcnk6IGNvbnRleHQud29ya2luZ0RpcmVjdG9yeSxcbiAgICAgICAgdGltZW91dE1zOiBNYXRoLm1heChjb250ZXh0LnRpbWVvdXRNcywgMzBfMDAwKSxcbiAgICAgICAgc2lnbmFsOiBjb250ZXh0LnNpZ25hbCxcbiAgICAgIH0pO1xuXG4gICAgICBpZiAoIWNvbXBpbGVSZXN1bHQuc3VjY2Vzcykge1xuICAgICAgICByZXR1cm4gY29tcGlsZVJlc3VsdDtcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIHJ1blByb2Nlc3Moe1xuICAgICAgICBydW5uZXJJZDogYCR7dGhpcy5pZH06JHtibG9jay5sYW5ndWFnZX06cnVuYCxcbiAgICAgICAgcnVubmVyTmFtZSxcbiAgICAgICAgZXhlY3V0YWJsZTogYmluYXJ5UGF0aCxcbiAgICAgICAgYXJnczogW10sXG4gICAgICAgIHdvcmtpbmdEaXJlY3Rvcnk6IGNvbnRleHQud29ya2luZ0RpcmVjdG9yeSxcbiAgICAgICAgdGltZW91dE1zOiBNYXRoLm1heChjb250ZXh0LnRpbWVvdXRNcywgMzBfMDAwKSxcbiAgICAgICAgc2lnbmFsOiBjb250ZXh0LnNpZ25hbCxcbiAgICAgIH0pO1xuICAgIH0pO1xuICB9XG59XG4iLCAiaW1wb3J0IHsgam9pbiB9IGZyb20gXCJwYXRoXCI7XG5pbXBvcnQgeyBydW5Qcm9jZXNzLCBydW5UZW1wRmlsZVByb2Nlc3MsIHdpdGhUZW1wU291cmNlRmlsZSB9IGZyb20gXCIuLi9leGVjdXRpb24vcHJvY2Vzc1J1bm5lclwiO1xuaW1wb3J0IHR5cGUgeyBsb29tQ29kZUJsb2NrLCBsb29tUGx1Z2luU2V0dGluZ3MsIGxvb21SdW5Db250ZXh0LCBsb29tUnVuUmVzdWx0LCBsb29tUnVubmVyIH0gZnJvbSBcIi4uL3R5cGVzXCI7XG5cbmV4cG9ydCBjbGFzcyBPY2FtbFJ1bm5lciBpbXBsZW1lbnRzIGxvb21SdW5uZXIge1xuICBpZCA9IFwib2NhbWxcIjtcbiAgZGlzcGxheU5hbWUgPSBcIk9DYW1sXCI7XG4gIGxhbmd1YWdlcyA9IFtcIm9jYW1sXCJdIGFzIGNvbnN0O1xuXG4gIGNhblJ1bihibG9jazogbG9vbUNvZGVCbG9jaywgc2V0dGluZ3M6IGxvb21QbHVnaW5TZXR0aW5ncyk6IGJvb2xlYW4ge1xuICAgIHJldHVybiBibG9jay5sYW5ndWFnZSA9PT0gXCJvY2FtbFwiICYmIEJvb2xlYW4oc2V0dGluZ3Mub2NhbWxFeGVjdXRhYmxlLnRyaW0oKSk7XG4gIH1cblxuICBhc3luYyBydW4oYmxvY2s6IGxvb21Db2RlQmxvY2ssIGNvbnRleHQ6IGxvb21SdW5Db250ZXh0LCBzZXR0aW5nczogbG9vbVBsdWdpblNldHRpbmdzKTogUHJvbWlzZTxsb29tUnVuUmVzdWx0PiB7XG4gICAgY29uc3QgbW9kZSA9IHNldHRpbmdzLm9jYW1sTW9kZTtcbiAgICBjb25zdCBleGVjdXRhYmxlID0gc2V0dGluZ3Mub2NhbWxFeGVjdXRhYmxlLnRyaW0oKTtcblxuICAgIGlmIChtb2RlID09PSBcIm9jYW1sXCIpIHtcbiAgICAgIHJldHVybiBydW5UZW1wRmlsZVByb2Nlc3Moe1xuICAgICAgICBydW5uZXJJZDogYCR7dGhpcy5pZH06b2NhbWxgLFxuICAgICAgICBydW5uZXJOYW1lOiBcIk9DYW1sXCIsXG4gICAgICAgIGV4ZWN1dGFibGUsXG4gICAgICAgIGFyZ3M6IFtcIntmaWxlfVwiXSxcbiAgICAgICAgZmlsZUV4dGVuc2lvbjogXCIubWxcIixcbiAgICAgICAgc291cmNlOiBibG9jay5jb250ZW50LFxuICAgICAgICB3b3JraW5nRGlyZWN0b3J5OiBjb250ZXh0LndvcmtpbmdEaXJlY3RvcnksXG4gICAgICAgIHRpbWVvdXRNczogY29udGV4dC50aW1lb3V0TXMsXG4gICAgICAgIHNpZ25hbDogY29udGV4dC5zaWduYWwsXG4gICAgICB9KTtcbiAgICB9XG5cbiAgICBpZiAobW9kZSA9PT0gXCJkdW5lXCIpIHtcbiAgICAgIHJldHVybiBydW5UZW1wRmlsZVByb2Nlc3Moe1xuICAgICAgICBydW5uZXJJZDogYCR7dGhpcy5pZH06ZHVuZWAsXG4gICAgICAgIHJ1bm5lck5hbWU6IFwiRHVuZSAvIE9DYW1sXCIsXG4gICAgICAgIGV4ZWN1dGFibGUsXG4gICAgICAgIGFyZ3M6IFtcImV4ZWNcIiwgXCItLVwiLCBcIm9jYW1sXCIsIFwie2ZpbGV9XCJdLFxuICAgICAgICBmaWxlRXh0ZW5zaW9uOiBcIi5tbFwiLFxuICAgICAgICBzb3VyY2U6IGJsb2NrLmNvbnRlbnQsXG4gICAgICAgIHdvcmtpbmdEaXJlY3Rvcnk6IGNvbnRleHQud29ya2luZ0RpcmVjdG9yeSxcbiAgICAgICAgdGltZW91dE1zOiBjb250ZXh0LnRpbWVvdXRNcyxcbiAgICAgICAgc2lnbmFsOiBjb250ZXh0LnNpZ25hbCxcbiAgICAgIH0pO1xuICAgIH1cblxuICAgIHJldHVybiB3aXRoVGVtcFNvdXJjZUZpbGUoXCIubWxcIiwgYmxvY2suY29udGVudCwgYXN5bmMgKHsgdGVtcERpciwgdGVtcEZpbGUgfSkgPT4ge1xuICAgICAgY29uc3QgYmluYXJ5UGF0aCA9IGpvaW4odGVtcERpciwgXCJzbmlwcGV0Lm91dFwiKTtcbiAgICAgIGNvbnN0IGNvbXBpbGVSZXN1bHQgPSBhd2FpdCBydW5Qcm9jZXNzKHtcbiAgICAgICAgcnVubmVySWQ6IGAke3RoaXMuaWR9Om9jYW1sYy1jb21waWxlYCxcbiAgICAgICAgcnVubmVyTmFtZTogXCJPQ2FtbGNcIixcbiAgICAgICAgZXhlY3V0YWJsZSxcbiAgICAgICAgYXJnczogW1wiLW9cIiwgYmluYXJ5UGF0aCwgdGVtcEZpbGVdLFxuICAgICAgICB3b3JraW5nRGlyZWN0b3J5OiBjb250ZXh0LndvcmtpbmdEaXJlY3RvcnksXG4gICAgICAgIHRpbWVvdXRNczogY29udGV4dC50aW1lb3V0TXMsXG4gICAgICAgIHNpZ25hbDogY29udGV4dC5zaWduYWwsXG4gICAgICB9KTtcblxuICAgICAgaWYgKCFjb21waWxlUmVzdWx0LnN1Y2Nlc3MpIHtcbiAgICAgICAgcmV0dXJuIGNvbXBpbGVSZXN1bHQ7XG4gICAgICB9XG5cbiAgICAgIHJldHVybiBydW5Qcm9jZXNzKHtcbiAgICAgICAgcnVubmVySWQ6IGAke3RoaXMuaWR9Om9jYW1sYy1ydW5gLFxuICAgICAgICBydW5uZXJOYW1lOiBcIk9DYW1sY1wiLFxuICAgICAgICBleGVjdXRhYmxlOiBiaW5hcnlQYXRoLFxuICAgICAgICBhcmdzOiBbXSxcbiAgICAgICAgd29ya2luZ0RpcmVjdG9yeTogY29udGV4dC53b3JraW5nRGlyZWN0b3J5LFxuICAgICAgICB0aW1lb3V0TXM6IGNvbnRleHQudGltZW91dE1zLFxuICAgICAgICBzaWduYWw6IGNvbnRleHQuc2lnbmFsLFxuICAgICAgfSk7XG4gICAgfSk7XG4gIH1cbn1cbiIsICJpbXBvcnQgeyBydW5UZW1wRmlsZVByb2Nlc3MgfSBmcm9tIFwiLi4vZXhlY3V0aW9uL3Byb2Nlc3NSdW5uZXJcIjtcbmltcG9ydCB0eXBlIHsgbG9vbUNvZGVCbG9jaywgbG9vbVBsdWdpblNldHRpbmdzLCBsb29tUnVuQ29udGV4dCwgbG9vbVJ1blJlc3VsdCwgbG9vbVJ1bm5lciB9IGZyb20gXCIuLi90eXBlc1wiO1xuXG5leHBvcnQgY2xhc3MgUHl0aG9uUnVubmVyIGltcGxlbWVudHMgbG9vbVJ1bm5lciB7XG4gIGlkID0gXCJweXRob25cIjtcbiAgZGlzcGxheU5hbWUgPSBcIlB5dGhvblwiO1xuICBsYW5ndWFnZXMgPSBbXCJweXRob25cIl0gYXMgY29uc3Q7XG5cbiAgY2FuUnVuKGJsb2NrOiBsb29tQ29kZUJsb2NrLCBzZXR0aW5nczogbG9vbVBsdWdpblNldHRpbmdzKTogYm9vbGVhbiB7XG4gICAgcmV0dXJuIGJsb2NrLmxhbmd1YWdlID09PSBcInB5dGhvblwiICYmIEJvb2xlYW4oc2V0dGluZ3MucHl0aG9uRXhlY3V0YWJsZS50cmltKCkpO1xuICB9XG5cbiAgcnVuKGJsb2NrOiBsb29tQ29kZUJsb2NrLCBjb250ZXh0OiBsb29tUnVuQ29udGV4dCwgc2V0dGluZ3M6IGxvb21QbHVnaW5TZXR0aW5ncyk6IFByb21pc2U8bG9vbVJ1blJlc3VsdD4ge1xuICAgIHJldHVybiBydW5UZW1wRmlsZVByb2Nlc3Moe1xuICAgICAgcnVubmVySWQ6IHRoaXMuaWQsXG4gICAgICBydW5uZXJOYW1lOiB0aGlzLmRpc3BsYXlOYW1lLFxuICAgICAgZXhlY3V0YWJsZTogc2V0dGluZ3MucHl0aG9uRXhlY3V0YWJsZS50cmltKCksXG4gICAgICBhcmdzOiBbXCJ7ZmlsZX1cIl0sXG4gICAgICBmaWxlRXh0ZW5zaW9uOiBcIi5weVwiLFxuICAgICAgc291cmNlOiBibG9jay5jb250ZW50LFxuICAgICAgd29ya2luZ0RpcmVjdG9yeTogY29udGV4dC53b3JraW5nRGlyZWN0b3J5LFxuICAgICAgdGltZW91dE1zOiBjb250ZXh0LnRpbWVvdXRNcyxcbiAgICAgIHNpZ25hbDogY29udGV4dC5zaWduYWwsXG4gICAgfSk7XG4gIH1cbn1cbiIsICJpbXBvcnQgeyBleGlzdHNTeW5jIH0gZnJvbSBcImZzXCI7XG5pbXBvcnQgeyBqb2luIH0gZnJvbSBcInBhdGhcIjtcbmltcG9ydCB7IHJ1blRlbXBGaWxlUHJvY2VzcyB9IGZyb20gXCIuLi9leGVjdXRpb24vcHJvY2Vzc1J1bm5lclwiO1xuaW1wb3J0IHR5cGUgeyBsb29tQ29kZUJsb2NrLCBsb29tUGx1Z2luU2V0dGluZ3MsIGxvb21SdW5Db250ZXh0LCBsb29tUnVuUmVzdWx0LCBsb29tUnVubmVyIH0gZnJvbSBcIi4uL3R5cGVzXCI7XG5cbmV4cG9ydCBjbGFzcyBQcm9vZlJ1bm5lciBpbXBsZW1lbnRzIGxvb21SdW5uZXIge1xuICBpZCA9IFwicHJvb2ZcIjtcbiAgZGlzcGxheU5hbWUgPSBcIlByb29mIGNoZWNrZXJcIjtcbiAgbGFuZ3VhZ2VzID0gW1wibGVhblwiLCBcImNvcVwiLCBcInNtdGxpYlwiXSBhcyBjb25zdDtcblxuICBjYW5SdW4oYmxvY2s6IGxvb21Db2RlQmxvY2ssIHNldHRpbmdzOiBsb29tUGx1Z2luU2V0dGluZ3MpOiBib29sZWFuIHtcbiAgICBpZiAoYmxvY2subGFuZ3VhZ2UgPT09IFwibGVhblwiKSB7XG4gICAgICByZXR1cm4gQm9vbGVhbihzZXR0aW5ncy5sZWFuRXhlY3V0YWJsZS50cmltKCkpO1xuICAgIH1cblxuICAgIGlmIChibG9jay5sYW5ndWFnZSA9PT0gXCJjb3FcIikge1xuICAgICAgcmV0dXJuIEJvb2xlYW4ocmVzb2x2ZUNvcUV4ZWN1dGFibGUoc2V0dGluZ3MpLnRyaW0oKSk7XG4gICAgfVxuXG4gICAgaWYgKGJsb2NrLmxhbmd1YWdlID09PSBcInNtdGxpYlwiKSB7XG4gICAgICByZXR1cm4gQm9vbGVhbihzZXR0aW5ncy5zbXRFeGVjdXRhYmxlLnRyaW0oKSk7XG4gICAgfVxuXG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG5cbiAgcnVuKGJsb2NrOiBsb29tQ29kZUJsb2NrLCBjb250ZXh0OiBsb29tUnVuQ29udGV4dCwgc2V0dGluZ3M6IGxvb21QbHVnaW5TZXR0aW5ncyk6IFByb21pc2U8bG9vbVJ1blJlc3VsdD4ge1xuICAgIGlmIChibG9jay5sYW5ndWFnZSA9PT0gXCJsZWFuXCIpIHtcbiAgICAgIHJldHVybiBydW5UZW1wRmlsZVByb2Nlc3Moe1xuICAgICAgICBydW5uZXJJZDogYCR7dGhpcy5pZH06bGVhbmAsXG4gICAgICAgIHJ1bm5lck5hbWU6IFwiTGVhblwiLFxuICAgICAgICBleGVjdXRhYmxlOiBzZXR0aW5ncy5sZWFuRXhlY3V0YWJsZS50cmltKCksXG4gICAgICAgIGFyZ3M6IFtcIntmaWxlfVwiXSxcbiAgICAgICAgZmlsZUV4dGVuc2lvbjogXCIubGVhblwiLFxuICAgICAgICBzb3VyY2U6IGJsb2NrLmNvbnRlbnQsXG4gICAgICAgIHdvcmtpbmdEaXJlY3Rvcnk6IGNvbnRleHQud29ya2luZ0RpcmVjdG9yeSxcbiAgICAgICAgdGltZW91dE1zOiBNYXRoLm1heChjb250ZXh0LnRpbWVvdXRNcywgMzBfMDAwKSxcbiAgICAgICAgc2lnbmFsOiBjb250ZXh0LnNpZ25hbCxcbiAgICAgIH0pO1xuICAgIH1cblxuICAgIGlmIChibG9jay5sYW5ndWFnZSA9PT0gXCJjb3FcIikge1xuICAgICAgcmV0dXJuIHJ1blRlbXBGaWxlUHJvY2Vzcyh7XG4gICAgICAgIHJ1bm5lcklkOiBgJHt0aGlzLmlkfTpjb3FgLFxuICAgICAgICBydW5uZXJOYW1lOiBcIkNvcVwiLFxuICAgICAgICBleGVjdXRhYmxlOiByZXNvbHZlQ29xRXhlY3V0YWJsZShzZXR0aW5ncyksXG4gICAgICAgIGFyZ3M6IFtcIi1xXCIsIFwie2ZpbGV9XCJdLFxuICAgICAgICBmaWxlRXh0ZW5zaW9uOiBcIi52XCIsXG4gICAgICAgIHNvdXJjZTogYmxvY2suY29udGVudCxcbiAgICAgICAgd29ya2luZ0RpcmVjdG9yeTogY29udGV4dC53b3JraW5nRGlyZWN0b3J5LFxuICAgICAgICB0aW1lb3V0TXM6IE1hdGgubWF4KGNvbnRleHQudGltZW91dE1zLCAzMF8wMDApLFxuICAgICAgICBzaWduYWw6IGNvbnRleHQuc2lnbmFsLFxuICAgICAgfSk7XG4gICAgfVxuXG4gICAgaWYgKGJsb2NrLmxhbmd1YWdlID09PSBcInNtdGxpYlwiKSB7XG4gICAgICByZXR1cm4gcnVuVGVtcEZpbGVQcm9jZXNzKHtcbiAgICAgICAgcnVubmVySWQ6IGAke3RoaXMuaWR9OnNtdGxpYmAsXG4gICAgICAgIHJ1bm5lck5hbWU6IFwiU01ULUxJQiAoWjMpXCIsXG4gICAgICAgIGV4ZWN1dGFibGU6IHNldHRpbmdzLnNtdEV4ZWN1dGFibGUudHJpbSgpLFxuICAgICAgICBhcmdzOiBbXCJ7ZmlsZX1cIl0sXG4gICAgICAgIGZpbGVFeHRlbnNpb246IFwiLnNtdDJcIixcbiAgICAgICAgc291cmNlOiBibG9jay5jb250ZW50LFxuICAgICAgICB3b3JraW5nRGlyZWN0b3J5OiBjb250ZXh0LndvcmtpbmdEaXJlY3RvcnksXG4gICAgICAgIHRpbWVvdXRNczogTWF0aC5tYXgoY29udGV4dC50aW1lb3V0TXMsIDMwXzAwMCksXG4gICAgICAgIHNpZ25hbDogY29udGV4dC5zaWduYWwsXG4gICAgICB9KTtcbiAgICB9XG5cbiAgICB0aHJvdyBuZXcgRXJyb3IoYFVuc3VwcG9ydGVkIHByb29mIGxhbmd1YWdlOiAke2Jsb2NrLmxhbmd1YWdlfWApO1xuICB9XG59XG5cbmZ1bmN0aW9uIHJlc29sdmVDb3FFeGVjdXRhYmxlKHNldHRpbmdzOiBsb29tUGx1Z2luU2V0dGluZ3MpOiBzdHJpbmcge1xuICBjb25zdCBjb25maWd1cmVkID0gc2V0dGluZ3MuY29xRXhlY3V0YWJsZS50cmltKCk7XG4gIGlmIChjb25maWd1cmVkICYmIGNvbmZpZ3VyZWQgIT09IFwiY29xY1wiKSB7XG4gICAgcmV0dXJuIGNvbmZpZ3VyZWQ7XG4gIH1cblxuICBjb25zdCBvcGFtQ29xYyA9IGpvaW4ocHJvY2Vzcy5lbnYuSE9NRSA/PyBcIlwiLCBcIi5vcGFtXCIsIFwiZGVmYXVsdFwiLCBcImJpblwiLCBcImNvcWNcIik7XG4gIHJldHVybiBleGlzdHNTeW5jKG9wYW1Db3FjKSA/IG9wYW1Db3FjIDogY29uZmlndXJlZCB8fCBcImNvcWNcIjtcbn1cbiIsICJpbXBvcnQgdHlwZSB7IGxvb21Db2RlQmxvY2ssIGxvb21QbHVnaW5TZXR0aW5ncywgbG9vbVJ1bm5lciB9IGZyb20gXCIuLi90eXBlc1wiO1xuXG5leHBvcnQgY2xhc3MgbG9vbVJ1bm5lclJlZ2lzdHJ5IHtcbiAgY29uc3RydWN0b3IocHJpdmF0ZSByZWFkb25seSBydW5uZXJzOiBsb29tUnVubmVyW10pIHt9XG5cbiAgZ2V0UnVubmVyRm9yQmxvY2soYmxvY2s6IGxvb21Db2RlQmxvY2ssIHNldHRpbmdzOiBsb29tUGx1Z2luU2V0dGluZ3MpOiBsb29tUnVubmVyIHwgbnVsbCB7XG4gICAgcmV0dXJuIHRoaXMucnVubmVycy5maW5kKChydW5uZXIpID0+ICghcnVubmVyLmxhbmd1YWdlcy5sZW5ndGggfHwgcnVubmVyLmxhbmd1YWdlcy5pbmNsdWRlcyhibG9jay5sYW5ndWFnZSkpICYmIHJ1bm5lci5jYW5SdW4oYmxvY2ssIHNldHRpbmdzKSkgPz8gbnVsbDtcbiAgfVxuXG4gIGdldFN1cHBvcnRlZExhbmd1YWdlcygpOiBzdHJpbmdbXSB7XG4gICAgcmV0dXJuIFsuLi5uZXcgU2V0KHRoaXMucnVubmVycy5mbGF0TWFwKChydW5uZXIpID0+IHJ1bm5lci5sYW5ndWFnZXMpKV07XG4gIH1cbn1cbiIsICJpbXBvcnQgeyBBcHAsIE1vZGFsLCBOb3RpY2UsIFBsdWdpblNldHRpbmdUYWIsIFNldHRpbmcsIG5vcm1hbGl6ZVBhdGggfSBmcm9tIFwib2JzaWRpYW5cIjtcbmltcG9ydCB0eXBlIGxvb21QbHVnaW4gZnJvbSBcIi4vbWFpblwiO1xuaW1wb3J0IHR5cGUgeyBsb29tQ3VzdG9tTGFuZ3VhZ2UsIGxvb21QbHVnaW5TZXR0aW5ncyB9IGZyb20gXCIuL3R5cGVzXCI7XG5cbmV4cG9ydCBjb25zdCBERUZBVUxUX1NFVFRJTkdTOiBsb29tUGx1Z2luU2V0dGluZ3MgPSB7XG4gIGVuYWJsZUxvY2FsRXhlY3V0aW9uOiBmYWxzZSxcbiAgaGFzQWNrbm93bGVkZ2VkRXhlY3V0aW9uUmlzazogZmFsc2UsXG4gIHByZXNlcnZlU291cmNlTW9kZTogdHJ1ZSxcbiAgZGVmYXVsdFRpbWVvdXRNczogODAwMCxcbiAgd29ya2luZ0RpcmVjdG9yeTogXCJcIixcbiAgcHl0aG9uRXhlY3V0YWJsZTogXCJweXRob24zXCIsXG4gIG5vZGVFeGVjdXRhYmxlOiBcIm5vZGVcIixcbiAgdHlwZXNjcmlwdE1vZGU6IFwidHMtbm9kZVwiLFxuICB0eXBlc2NyaXB0VHJhbnNwaWxlckV4ZWN1dGFibGU6IFwidHMtbm9kZVwiLFxuICBvY2FtbE1vZGU6IFwib2NhbWxcIixcbiAgb2NhbWxFeGVjdXRhYmxlOiBcIm9jYW1sXCIsXG4gIGNFeGVjdXRhYmxlOiBcImdjY1wiLFxuICBjcHBFeGVjdXRhYmxlOiBcImcrK1wiLFxuICBzaGVsbEV4ZWN1dGFibGU6IFwiYmFzaFwiLFxuICBydWJ5RXhlY3V0YWJsZTogXCJydWJ5XCIsXG4gIHBlcmxFeGVjdXRhYmxlOiBcInBlcmxcIixcbiAgbHVhRXhlY3V0YWJsZTogXCJsdWFcIixcbiAgcGhwRXhlY3V0YWJsZTogXCJwaHBcIixcbiAgZ29FeGVjdXRhYmxlOiBcImdvXCIsXG4gIHJ1c3RFeGVjdXRhYmxlOiBcInJ1c3RjXCIsXG4gIGhhc2tlbGxFeGVjdXRhYmxlOiBcInJ1bmdoY1wiLFxuICBqYXZhQ29tcGlsZXJFeGVjdXRhYmxlOiBcIlwiLFxuICBqYXZhRXhlY3V0YWJsZTogXCJqYXZhXCIsXG4gIGxsdm1JbnRlcnByZXRlckV4ZWN1dGFibGU6IFwibGxpXCIsXG4gIGxlYW5FeGVjdXRhYmxlOiBcImxlYW5cIixcbiAgY29xRXhlY3V0YWJsZTogXCJjb3FjXCIsXG4gIHNtdEV4ZWN1dGFibGU6IFwiejNcIixcbiAgd3JpdGVPdXRwdXRUb05vdGU6IGZhbHNlLFxuICBhdXRvUnVuT25GaWxlT3BlbjogZmFsc2UsXG4gIGN1c3RvbUxhbmd1YWdlczogW10sXG4gIHBkZkV4cG9ydE1vZGU6IFwiYm90aFwiLFxuICBkZWZhdWx0Q29udGFpbmVyR3JvdXA6IFwiXCIsXG59O1xuXG5leHBvcnQgY2xhc3MgbG9vbVNldHRpbmdUYWIgZXh0ZW5kcyBQbHVnaW5TZXR0aW5nVGFiIHtcbiAgY29uc3RydWN0b3IocHJpdmF0ZSByZWFkb25seSBsb29tUGx1Z2luOiBsb29tUGx1Z2luKSB7XG4gICAgc3VwZXIobG9vbVBsdWdpbi5hcHAsIGxvb21QbHVnaW4pO1xuICB9XG5cbiAgZGlzcGxheSgpOiB2b2lkIHtcbiAgICBjb25zdCB7IGNvbnRhaW5lckVsIH0gPSB0aGlzO1xuICAgIGNvbnRhaW5lckVsLmVtcHR5KCk7XG4gICAgY29udGFpbmVyRWwuY3JlYXRlRWwoXCJoMlwiLCB7IHRleHQ6IFwibG9vbVwiIH0pO1xuICAgIGNvbnRhaW5lckVsLmNyZWF0ZUVsKFwicFwiLCB7IHRleHQ6IFwiUnVuIHN1cHBvcnRlZCBjb2RlIGZlbmNlcyBkaXJlY3RseSBmcm9tIG5vdGVzIHdoaWxlIHByZXNlcnZpbmcgbmF0aXZlIHN5bnRheCBoaWdobGlnaHRpbmcuXCIgfSk7XG5cbiAgICB0aGlzLnJlbmRlckdlbmVyYWxTZXR0aW5ncyh0aGlzLmNyZWF0ZVNlY3Rpb24oY29udGFpbmVyRWwsIFwiR2VuZXJhbCBTZXR0aW5nc1wiLCB0cnVlKSk7XG4gICAgdGhpcy5yZW5kZXJCdWlsdEluUnVudGltZXModGhpcy5jcmVhdGVTZWN0aW9uKGNvbnRhaW5lckVsLCBcIkJ1aWx0LWluIFJ1bnRpbWVzXCIpKTtcbiAgICB0aGlzLnJlbmRlckN1c3RvbUxhbmd1YWdlcyh0aGlzLmNyZWF0ZVNlY3Rpb24oY29udGFpbmVyRWwsIFwiQ3VzdG9tIExhbmd1YWdlc1wiKSk7XG4gICAgdm9pZCB0aGlzLnJlbmRlckNvbnRhaW5lckdyb3Vwcyh0aGlzLmNyZWF0ZVNlY3Rpb24oY29udGFpbmVyRWwsIFwiQ29udGFpbmVyaXphdGlvbiBHcm91cHNcIikpO1xuICB9XG5cbiAgcHJpdmF0ZSBjcmVhdGVTZWN0aW9uKGNvbnRhaW5lckVsOiBIVE1MRWxlbWVudCwgdGl0bGU6IHN0cmluZywgb3BlbiA9IGZhbHNlKTogSFRNTEVsZW1lbnQge1xuICAgIGNvbnN0IGRldGFpbHMgPSBjb250YWluZXJFbC5jcmVhdGVFbChcImRldGFpbHNcIiwgeyBjbHM6IFwibG9vbS1zZXR0aW5ncy1zZWN0aW9uXCIgfSk7XG4gICAgZGV0YWlscy5vcGVuID0gb3BlbjtcbiAgICBkZXRhaWxzLmNyZWF0ZUVsKFwic3VtbWFyeVwiLCB7IHRleHQ6IHRpdGxlLCBjbHM6IFwibG9vbS1zZXR0aW5ncy1zdW1tYXJ5XCIgfSk7XG4gICAgcmV0dXJuIGRldGFpbHMuY3JlYXRlRGl2KHsgY2xzOiBcImxvb20tc2V0dGluZ3Mtc2VjdGlvbi1ib2R5XCIgfSk7XG4gIH1cblxuICBwcml2YXRlIHJlbmRlckdlbmVyYWxTZXR0aW5ncyhjb250YWluZXJFbDogSFRNTEVsZW1lbnQpOiB2b2lkIHtcbiAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgIC5zZXROYW1lKFwiRW5hYmxlIGxvY2FsIGV4ZWN1dGlvblwiKVxuICAgICAgLnNldERlc2MoXCJEaXNhYmxlZCBieSBkZWZhdWx0LiBsb29tIHJ1bnMgY29kZSBvbiB5b3VyIGxvY2FsIG1hY2hpbmUgYW5kIGRvZXMgbm90IHByb3ZpZGUgc2FuZGJveGluZy5cIilcbiAgICAgIC5hZGRUb2dnbGUoKHRvZ2dsZSkgPT5cbiAgICAgICAgdG9nZ2xlLnNldFZhbHVlKHRoaXMubG9vbVBsdWdpbi5zZXR0aW5ncy5lbmFibGVMb2NhbEV4ZWN1dGlvbikub25DaGFuZ2UoYXN5bmMgKHZhbHVlKSA9PiB7XG4gICAgICAgICAgdGhpcy5sb29tUGx1Z2luLnNldHRpbmdzLmVuYWJsZUxvY2FsRXhlY3V0aW9uID0gdmFsdWU7XG4gICAgICAgICAgaWYgKHZhbHVlKSB7XG4gICAgICAgICAgICB0aGlzLmxvb21QbHVnaW4uc2V0dGluZ3MuaGFzQWNrbm93bGVkZ2VkRXhlY3V0aW9uUmlzayA9IHRydWU7XG4gICAgICAgICAgfVxuICAgICAgICAgIGF3YWl0IHRoaXMubG9vbVBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgICAgfSksXG4gICAgICApO1xuXG4gICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAuc2V0TmFtZShcIktlZXAgbG9vbSBub3RlcyBpbiBzb3VyY2UgbW9kZVwiKVxuICAgICAgLnNldERlc2MoXCJQcmVzZXJ2ZSByYXcgZmVuY2VkIGNvZGUgaW4gdGhlIGVkaXRvciBpbnN0ZWFkIG9mIGxldHRpbmcgbGl2ZSBwcmV2aWV3IGNvbGxhcHNlIHJlc2VhcmNoIHNuaXBwZXRzLlwiKVxuICAgICAgLmFkZFRvZ2dsZSgodG9nZ2xlKSA9PlxuICAgICAgICB0b2dnbGUuc2V0VmFsdWUodGhpcy5sb29tUGx1Z2luLnNldHRpbmdzLnByZXNlcnZlU291cmNlTW9kZSkub25DaGFuZ2UoYXN5bmMgKHZhbHVlKSA9PiB7XG4gICAgICAgICAgdGhpcy5sb29tUGx1Z2luLnNldHRpbmdzLnByZXNlcnZlU291cmNlTW9kZSA9IHZhbHVlO1xuICAgICAgICAgIGF3YWl0IHRoaXMubG9vbVBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgICAgICBpZiAodmFsdWUpIHtcbiAgICAgICAgICAgIHZvaWQgdGhpcy5sb29tUGx1Z2luLmVuZm9yY2VTb3VyY2VNb2RlRm9yQWN0aXZlVmlldygpO1xuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICB2b2lkIHRoaXMubG9vbVBsdWdpbi5kaXNhYmxlU291cmNlTW9kZUZvckFjdGl2ZVZpZXcoKTtcbiAgICAgICAgICB9XG4gICAgICAgIH0pLFxuICAgICAgKTtcblxuICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxuICAgICAgLnNldE5hbWUoXCJEZWZhdWx0IHRpbWVvdXRcIilcbiAgICAgIC5zZXREZXNjKFwiTWF4aW11bSBleGVjdXRpb24gdGltZSBpbiBtaWxsaXNlY29uZHMgYmVmb3JlIGxvb20gdGVybWluYXRlcyB0aGUgcHJvY2Vzcy5cIilcbiAgICAgIC5hZGRUZXh0KCh0ZXh0KSA9PlxuICAgICAgICB0ZXh0LnNldFBsYWNlaG9sZGVyKFwiODAwMFwiKS5zZXRWYWx1ZShTdHJpbmcodGhpcy5sb29tUGx1Z2luLnNldHRpbmdzLmRlZmF1bHRUaW1lb3V0TXMpKS5vbkNoYW5nZShhc3luYyAodmFsdWUpID0+IHtcbiAgICAgICAgICBjb25zdCBwYXJzZWQgPSBOdW1iZXIucGFyc2VJbnQodmFsdWUsIDEwKTtcbiAgICAgICAgICBpZiAoIU51bWJlci5pc05hTihwYXJzZWQpICYmIHBhcnNlZCA+IDApIHtcbiAgICAgICAgICAgIHRoaXMubG9vbVBsdWdpbi5zZXR0aW5ncy5kZWZhdWx0VGltZW91dE1zID0gcGFyc2VkO1xuICAgICAgICAgICAgYXdhaXQgdGhpcy5sb29tUGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgICAgICAgIH1cbiAgICAgICAgfSksXG4gICAgICApO1xuXG4gICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAuc2V0TmFtZShcIldvcmtpbmcgZGlyZWN0b3J5XCIpXG4gICAgICAuc2V0RGVzYyhcIk9wdGlvbmFsLiBFbXB0eSB1c2VzIHRoZSBjdXJyZW50IG5vdGUgZm9sZGVyIHdoZW4gcG9zc2libGUsIG90aGVyd2lzZSB0aGUgdmF1bHQgcm9vdC5cIilcbiAgICAgIC5hZGRUZXh0KCh0ZXh0KSA9PlxuICAgICAgICB0ZXh0LnNldFBsYWNlaG9sZGVyKFwiVmF1bHQgcm9vdFwiKS5zZXRWYWx1ZSh0aGlzLmxvb21QbHVnaW4uc2V0dGluZ3Mud29ya2luZ0RpcmVjdG9yeSkub25DaGFuZ2UoYXN5bmMgKHZhbHVlKSA9PiB7XG4gICAgICAgICAgdGhpcy5sb29tUGx1Z2luLnNldHRpbmdzLndvcmtpbmdEaXJlY3RvcnkgPSB2YWx1ZS50cmltKCkgPyBub3JtYWxpemVQYXRoKHZhbHVlLnRyaW0oKSkgOiBcIlwiO1xuICAgICAgICAgIGF3YWl0IHRoaXMubG9vbVBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgICAgfSksXG4gICAgICApO1xuXG4gICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAuc2V0TmFtZShcIldyaXRlIG91dHB1dCBiYWNrIHRvIG5vdGVcIilcbiAgICAgIC5zZXREZXNjKFwiSW5zZXJ0IG1hbmFnZWQgbG9vbSBvdXRwdXQgc2VjdGlvbnMgYmVuZWF0aCBjb2RlIGJsb2NrcyBpbnN0ZWFkIG9mIGtlZXBpbmcgcmVzdWx0cyBwdXJlbHkgaW4gdGhlIFVJLlwiKVxuICAgICAgLmFkZFRvZ2dsZSgodG9nZ2xlKSA9PlxuICAgICAgICB0b2dnbGUuc2V0VmFsdWUodGhpcy5sb29tUGx1Z2luLnNldHRpbmdzLndyaXRlT3V0cHV0VG9Ob3RlKS5vbkNoYW5nZShhc3luYyAodmFsdWUpID0+IHtcbiAgICAgICAgICB0aGlzLmxvb21QbHVnaW4uc2V0dGluZ3Mud3JpdGVPdXRwdXRUb05vdGUgPSB2YWx1ZTtcbiAgICAgICAgICBhd2FpdCB0aGlzLmxvb21QbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICAgIH0pLFxuICAgICAgKTtcblxuICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxuICAgICAgLnNldE5hbWUoXCJBdXRvLXJ1biBvbiBmaWxlIG9wZW5cIilcbiAgICAgIC5zZXREZXNjKFwiUnVuIGFsbCBzdXBwb3J0ZWQgYmxvY2tzIGluIHRoZSBhY3RpdmUgbm90ZSB3aGVuIGl0IG9wZW5zLiBEaXNhYmxlZCBieSBkZWZhdWx0LlwiKVxuICAgICAgLmFkZFRvZ2dsZSgodG9nZ2xlKSA9PlxuICAgICAgICB0b2dnbGUuc2V0VmFsdWUodGhpcy5sb29tUGx1Z2luLnNldHRpbmdzLmF1dG9SdW5PbkZpbGVPcGVuKS5vbkNoYW5nZShhc3luYyAodmFsdWUpID0+IHtcbiAgICAgICAgICB0aGlzLmxvb21QbHVnaW4uc2V0dGluZ3MuYXV0b1J1bk9uRmlsZU9wZW4gPSB2YWx1ZTtcbiAgICAgICAgICBhd2FpdCB0aGlzLmxvb21QbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICAgIH0pLFxuICAgICAgKTtcblxuICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxuICAgICAgLnNldE5hbWUoXCJQREYgZXhwb3J0IG1vZGVcIilcbiAgICAgIC5zZXREZXNjKFwiQ2hvb3NlIHdoYXQgdG8gaW5jbHVkZSB3aGVuIGV4cG9ydGluZyBub3RlcyBjb250YWluaW5nIGxvb20gY29kZSBibG9ja3MgdG8gUERGLlwiKVxuICAgICAgLmFkZERyb3Bkb3duKChkcm9wZG93bikgPT5cbiAgICAgICAgZHJvcGRvd25cbiAgICAgICAgICAuYWRkT3B0aW9uKFwiYm90aFwiLCBcIkJvdGggQ29kZSBhbmQgT3V0cHV0XCIpXG4gICAgICAgICAgLmFkZE9wdGlvbihcImNvZGVcIiwgXCJDb2RlIEJsb2NrIE9ubHlcIilcbiAgICAgICAgICAuYWRkT3B0aW9uKFwib3V0cHV0XCIsIFwiT3V0cHV0IE9ubHlcIilcbiAgICAgICAgICAuc2V0VmFsdWUodGhpcy5sb29tUGx1Z2luLnNldHRpbmdzLnBkZkV4cG9ydE1vZGUgfHwgXCJib3RoXCIpXG4gICAgICAgICAgLm9uQ2hhbmdlKGFzeW5jICh2YWx1ZSkgPT4ge1xuICAgICAgICAgICAgdGhpcy5sb29tUGx1Z2luLnNldHRpbmdzLnBkZkV4cG9ydE1vZGUgPSB2YWx1ZSBhcyBcImJvdGhcIiB8IFwiY29kZVwiIHwgXCJvdXRwdXRcIjtcbiAgICAgICAgICAgIGF3YWl0IHRoaXMubG9vbVBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgICAgICB9KSxcbiAgICAgICk7XG4gIH1cblxuICBwcml2YXRlIHJlbmRlckJ1aWx0SW5SdW50aW1lcyhjb250YWluZXJFbDogSFRNTEVsZW1lbnQpOiB2b2lkIHtcbiAgICB0aGlzLmFkZFRleHRTZXR0aW5nKGNvbnRhaW5lckVsLCBcIlB5dGhvbiBleGVjdXRhYmxlXCIsIFwiUGF0aCBvciBjb21tYW5kIG5hbWUgZm9yIFB5dGhvbi5cIiwgXCJweXRob25FeGVjdXRhYmxlXCIpO1xuICAgIHRoaXMuYWRkVGV4dFNldHRpbmcoY29udGFpbmVyRWwsIFwiTm9kZSBleGVjdXRhYmxlXCIsIFwiUGF0aCBvciBjb21tYW5kIG5hbWUgZm9yIEphdmFTY3JpcHQgZXhlY3V0aW9uLlwiLCBcIm5vZGVFeGVjdXRhYmxlXCIpO1xuXG4gICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAuc2V0TmFtZShcIlR5cGVTY3JpcHQgcnVubmVyIG1vZGVcIilcbiAgICAgIC5zZXREZXNjKFwiVXNlIHRzLW5vZGUgb3IgdHN4IGZvciBUeXBlU2NyaXB0IGJsb2Nrcy5cIilcbiAgICAgIC5hZGREcm9wZG93bigoZHJvcGRvd24pID0+XG4gICAgICAgIGRyb3Bkb3duXG4gICAgICAgICAgLmFkZE9wdGlvbihcInRzLW5vZGVcIiwgXCJ0cy1ub2RlXCIpXG4gICAgICAgICAgLmFkZE9wdGlvbihcInRzeFwiLCBcInRzeFwiKVxuICAgICAgICAgIC5zZXRWYWx1ZSh0aGlzLmxvb21QbHVnaW4uc2V0dGluZ3MudHlwZXNjcmlwdE1vZGUpXG4gICAgICAgICAgLm9uQ2hhbmdlKGFzeW5jICh2YWx1ZSkgPT4ge1xuICAgICAgICAgICAgdGhpcy5sb29tUGx1Z2luLnNldHRpbmdzLnR5cGVzY3JpcHRNb2RlID0gdmFsdWUgYXMgXCJ0cy1ub2RlXCIgfCBcInRzeFwiO1xuICAgICAgICAgICAgYXdhaXQgdGhpcy5sb29tUGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgICAgICAgIH0pLFxuICAgICAgKTtcblxuICAgIHRoaXMuYWRkVGV4dFNldHRpbmcoY29udGFpbmVyRWwsIFwiVHlwZVNjcmlwdCB0cmFuc3BpbGVyIGV4ZWN1dGFibGVcIiwgXCJDb21tYW5kIG9yIHBhdGggZm9yIHRzLW5vZGUgb3IgdHN4LlwiLCBcInR5cGVzY3JpcHRUcmFuc3BpbGVyRXhlY3V0YWJsZVwiKTtcblxuICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxuICAgICAgLnNldE5hbWUoXCJPQ2FtbCBtb2RlXCIpXG4gICAgICAuc2V0RGVzYyhcIkNob29zZSBiZXR3ZWVuIHRoZSBPQ2FtbCB0b3BsZXZlbCwgb2NhbWxjIGNvbXBpbGF0aW9uLCBvciBkdW5lIGV4ZWMuXCIpXG4gICAgICAuYWRkRHJvcGRvd24oKGRyb3Bkb3duKSA9PlxuICAgICAgICBkcm9wZG93blxuICAgICAgICAgIC5hZGRPcHRpb24oXCJvY2FtbFwiLCBcIm9jYW1sXCIpXG4gICAgICAgICAgLmFkZE9wdGlvbihcIm9jYW1sY1wiLCBcIm9jYW1sY1wiKVxuICAgICAgICAgIC5hZGRPcHRpb24oXCJkdW5lXCIsIFwiZHVuZVwiKVxuICAgICAgICAgIC5zZXRWYWx1ZSh0aGlzLmxvb21QbHVnaW4uc2V0dGluZ3Mub2NhbWxNb2RlKVxuICAgICAgICAgIC5vbkNoYW5nZShhc3luYyAodmFsdWUpID0+IHtcbiAgICAgICAgICAgIHRoaXMubG9vbVBsdWdpbi5zZXR0aW5ncy5vY2FtbE1vZGUgPSB2YWx1ZSBhcyBcIm9jYW1sXCIgfCBcIm9jYW1sY1wiIHwgXCJkdW5lXCI7XG4gICAgICAgICAgICBhd2FpdCB0aGlzLmxvb21QbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICAgICAgfSksXG4gICAgICApO1xuXG4gICAgdGhpcy5hZGRUZXh0U2V0dGluZyhjb250YWluZXJFbCwgXCJPQ2FtbCBleGVjdXRhYmxlXCIsIFwiQ29tbWFuZCBvciBwYXRoIGZvciBvY2FtbCwgb2NhbWxjLCBvciBkdW5lIGRlcGVuZGluZyBvbiB0aGUgc2VsZWN0ZWQgbW9kZS5cIiwgXCJvY2FtbEV4ZWN1dGFibGVcIik7XG4gICAgdGhpcy5hZGRUZXh0U2V0dGluZyhjb250YWluZXJFbCwgXCJDIGNvbXBpbGVyXCIsIFwiQ29tbWFuZCBvciBwYXRoIGZvciBjb21waWxpbmcgQyBibG9ja3MuXCIsIFwiY0V4ZWN1dGFibGVcIik7XG4gICAgdGhpcy5hZGRUZXh0U2V0dGluZyhjb250YWluZXJFbCwgXCJDKysgY29tcGlsZXJcIiwgXCJDb21tYW5kIG9yIHBhdGggZm9yIGNvbXBpbGluZyBDKysgYmxvY2tzLlwiLCBcImNwcEV4ZWN1dGFibGVcIik7XG4gICAgdGhpcy5hZGRUZXh0U2V0dGluZyhjb250YWluZXJFbCwgXCJTaGVsbCBleGVjdXRhYmxlXCIsIFwiQ29tbWFuZCBvciBwYXRoIGZvciBTaGVsbCwgQmFzaCwgYW5kIHNoIGJsb2Nrcy5cIiwgXCJzaGVsbEV4ZWN1dGFibGVcIik7XG4gICAgdGhpcy5hZGRUZXh0U2V0dGluZyhjb250YWluZXJFbCwgXCJSdWJ5IGV4ZWN1dGFibGVcIiwgXCJDb21tYW5kIG9yIHBhdGggZm9yIFJ1YnkgYmxvY2tzLlwiLCBcInJ1YnlFeGVjdXRhYmxlXCIpO1xuICAgIHRoaXMuYWRkVGV4dFNldHRpbmcoY29udGFpbmVyRWwsIFwiUGVybCBleGVjdXRhYmxlXCIsIFwiQ29tbWFuZCBvciBwYXRoIGZvciBQZXJsIGJsb2Nrcy5cIiwgXCJwZXJsRXhlY3V0YWJsZVwiKTtcbiAgICB0aGlzLmFkZFRleHRTZXR0aW5nKGNvbnRhaW5lckVsLCBcIkx1YSBleGVjdXRhYmxlXCIsIFwiQ29tbWFuZCBvciBwYXRoIGZvciBMdWEgYmxvY2tzLlwiLCBcImx1YUV4ZWN1dGFibGVcIik7XG4gICAgdGhpcy5hZGRUZXh0U2V0dGluZyhjb250YWluZXJFbCwgXCJQSFAgZXhlY3V0YWJsZVwiLCBcIkNvbW1hbmQgb3IgcGF0aCBmb3IgUEhQIGJsb2Nrcy5cIiwgXCJwaHBFeGVjdXRhYmxlXCIpO1xuICAgIHRoaXMuYWRkVGV4dFNldHRpbmcoY29udGFpbmVyRWwsIFwiR28gZXhlY3V0YWJsZVwiLCBcIkNvbW1hbmQgb3IgcGF0aCBmb3IgR28gYmxvY2tzLlwiLCBcImdvRXhlY3V0YWJsZVwiKTtcbiAgICB0aGlzLmFkZFRleHRTZXR0aW5nKGNvbnRhaW5lckVsLCBcIlJ1c3QgY29tcGlsZXJcIiwgXCJDb21tYW5kIG9yIHBhdGggZm9yIGNvbXBpbGluZyBSdXN0IGJsb2Nrcy5cIiwgXCJydXN0RXhlY3V0YWJsZVwiKTtcbiAgICB0aGlzLmFkZFRleHRTZXR0aW5nKGNvbnRhaW5lckVsLCBcIkhhc2tlbGwgZXhlY3V0YWJsZVwiLCBcIkNvbW1hbmQgb3IgcGF0aCBmb3IgSGFza2VsbCBibG9ja3MuIERlZmF1bHRzIHRvIHJ1bmdoYy5cIiwgXCJoYXNrZWxsRXhlY3V0YWJsZVwiKTtcbiAgICB0aGlzLmFkZFRleHRTZXR0aW5nKGNvbnRhaW5lckVsLCBcIkphdmEgY29tcGlsZXJcIiwgXCJPcHRpb25hbCBjb21tYW5kIG9yIHBhdGggZm9yIGphdmFjLiBMZWF2ZSBlbXB0eSB0byB1c2UgSmF2YSBzb3VyY2UtZmlsZSBtb2RlLlwiLCBcImphdmFDb21waWxlckV4ZWN1dGFibGVcIik7XG4gICAgdGhpcy5hZGRUZXh0U2V0dGluZyhjb250YWluZXJFbCwgXCJKYXZhIGV4ZWN1dGFibGVcIiwgXCJDb21tYW5kIG9yIHBhdGggZm9yIHJ1bm5pbmcgY29tcGlsZWQgSmF2YSBibG9ja3MuXCIsIFwiamF2YUV4ZWN1dGFibGVcIik7XG4gICAgdGhpcy5hZGRUZXh0U2V0dGluZyhjb250YWluZXJFbCwgXCJMTFZNIElSIGludGVycHJldGVyXCIsIFwiQ29tbWFuZCBvciBwYXRoIGZvciBydW5uaW5nIExMVk0gSVIgYmxvY2tzIHdpdGggbGxpLlwiLCBcImxsdm1JbnRlcnByZXRlckV4ZWN1dGFibGVcIik7XG4gICAgdGhpcy5hZGRUZXh0U2V0dGluZyhjb250YWluZXJFbCwgXCJMZWFuIGV4ZWN1dGFibGVcIiwgXCJDb21tYW5kIG9yIHBhdGggZm9yIGNoZWNraW5nIExlYW4gYmxvY2tzLlwiLCBcImxlYW5FeGVjdXRhYmxlXCIpO1xuICAgIHRoaXMuYWRkVGV4dFNldHRpbmcoY29udGFpbmVyRWwsIFwiQ29xIGV4ZWN1dGFibGVcIiwgXCJDb21tYW5kIG9yIHBhdGggZm9yIGNoZWNraW5nIENvcSBibG9ja3Mgd2l0aCBjb3FjLlwiLCBcImNvcUV4ZWN1dGFibGVcIik7XG4gICAgdGhpcy5hZGRUZXh0U2V0dGluZyhjb250YWluZXJFbCwgXCJTTVQgc29sdmVyXCIsIFwiQ29tbWFuZCBvciBwYXRoIGZvciBTTVQtTElCIGJsb2Nrcy4gRGVmYXVsdHMgdG8gejMuXCIsIFwic210RXhlY3V0YWJsZVwiKTtcbiAgfVxuXG4gIHByaXZhdGUgcmVuZGVyQ3VzdG9tTGFuZ3VhZ2VzKGNvbnRhaW5lckVsOiBIVE1MRWxlbWVudCk6IHZvaWQge1xuICAgIGNvbnN0IGxpc3RFbCA9IGNvbnRhaW5lckVsLmNyZWF0ZURpdih7IGNsczogXCJsb29tLWN1c3RvbS1sYW5ndWFnZS1saXN0XCIgfSk7XG4gICAgdGhpcy5yZW5kZXJDdXN0b21MYW5ndWFnZUxpc3QobGlzdEVsKTtcblxuICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxuICAgICAgLnNldE5hbWUoXCJBZGQgY3VzdG9tIGxhbmd1YWdlXCIpXG4gICAgICAuc2V0RGVzYyhcIkNyZWF0ZSBhIG5ldyBsb2NhbCBjb21tYW5kLWJhY2tlZCBsYW5ndWFnZS5cIilcbiAgICAgIC5hZGRCdXR0b24oKGJ1dHRvbikgPT5cbiAgICAgICAgYnV0dG9uLnNldEJ1dHRvblRleHQoXCIrXCIpLm9uQ2xpY2soYXN5bmMgKCkgPT4ge1xuICAgICAgICAgIHRoaXMubG9vbVBsdWdpbi5zZXR0aW5ncy5jdXN0b21MYW5ndWFnZXMucHVzaCh7XG4gICAgICAgICAgICBuYW1lOiBcImN1c3RvbS1sYW5ndWFnZVwiLFxuICAgICAgICAgICAgYWxpYXNlczogXCJcIixcbiAgICAgICAgICAgIGV4ZWN1dGFibGU6IFwiXCIsXG4gICAgICAgICAgICBhcmdzOiBcIntmaWxlfVwiLFxuICAgICAgICAgICAgZXh0ZW5zaW9uOiBcIi50eHRcIixcbiAgICAgICAgICAgIGV4dHJhY3Rvck1vZGU6IFwiY29tbWFuZFwiLFxuICAgICAgICAgICAgZXh0cmFjdG9yRXhlY3V0YWJsZTogXCJcIixcbiAgICAgICAgICAgIGV4dHJhY3RvckFyZ3M6IFwie3JlcXVlc3R9XCIsXG4gICAgICAgICAgICB0cmFuc3BpbGVFeGVjdXRhYmxlOiBcIlwiLFxuICAgICAgICAgICAgdHJhbnNwaWxlQXJnczogXCJ7cmVxdWVzdH1cIixcbiAgICAgICAgICB9KTtcbiAgICAgICAgICBhd2FpdCB0aGlzLmxvb21QbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICAgICAgdGhpcy5kaXNwbGF5KCk7XG4gICAgICAgIH0pLFxuICAgICAgKTtcbiAgfVxuXG4gIHByaXZhdGUgcmVuZGVyQ3VzdG9tTGFuZ3VhZ2VMaXN0KGNvbnRhaW5lckVsOiBIVE1MRWxlbWVudCk6IHZvaWQge1xuICAgIGNvbnRhaW5lckVsLmVtcHR5KCk7XG5cbiAgICBpZiAoIXRoaXMubG9vbVBsdWdpbi5zZXR0aW5ncy5jdXN0b21MYW5ndWFnZXMubGVuZ3RoKSB7XG4gICAgICBjb250YWluZXJFbC5jcmVhdGVFbChcInBcIiwge1xuICAgICAgICB0ZXh0OiBcIk5vIGN1c3RvbSBsYW5ndWFnZXMgY29uZmlndXJlZC5cIixcbiAgICAgICAgY2xzOiBcInNldHRpbmctaXRlbS1kZXNjcmlwdGlvblwiLFxuICAgICAgfSk7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgdGhpcy5sb29tUGx1Z2luLnNldHRpbmdzLmN1c3RvbUxhbmd1YWdlcy5mb3JFYWNoKChsYW5ndWFnZSwgaW5kZXgpID0+IHtcbiAgICAgIGNvbnN0IGRldGFpbHMgPSBjb250YWluZXJFbC5jcmVhdGVFbChcImRldGFpbHNcIiwgeyBjbHM6IFwibG9vbS1jdXN0b20tbGFuZ3VhZ2VcIiB9KTtcbiAgICAgIGRldGFpbHMub3BlbiA9IHRydWU7XG4gICAgICBkZXRhaWxzLmNyZWF0ZUVsKFwic3VtbWFyeVwiLCB7IHRleHQ6IGxhbmd1YWdlLm5hbWUgfHwgYEN1c3RvbSBsYW5ndWFnZSAke2luZGV4ICsgMX1gIH0pO1xuICAgICAgY29uc3QgYm9keSA9IGRldGFpbHMuY3JlYXRlRGl2KHsgY2xzOiBcImxvb20tY3VzdG9tLWxhbmd1YWdlLWJvZHlcIiB9KTtcblxuICAgICAgdGhpcy5hZGRDdXN0b21MYW5ndWFnZVRleHRTZXR0aW5nKGJvZHksIGxhbmd1YWdlLCBcIk5hbWVcIiwgXCJOb3JtYWxpemVkIGxhbmd1YWdlIGlkIHVzZWQgYnkgbG9vbS5cIiwgXCJuYW1lXCIpO1xuICAgICAgdGhpcy5hZGRDdXN0b21MYW5ndWFnZVRleHRTZXR0aW5nKGJvZHksIGxhbmd1YWdlLCBcIkFsaWFzZXNcIiwgXCJDb21tYS1zZXBhcmF0ZWQgZmVuY2UgYWxpYXNlcy5cIiwgXCJhbGlhc2VzXCIpO1xuICAgICAgdGhpcy5hZGRDdXN0b21MYW5ndWFnZVRleHRTZXR0aW5nKGJvZHksIGxhbmd1YWdlLCBcIkV4ZWN1dGFibGVcIiwgXCJMb2NhbCBjb21tYW5kIG9yIGFic29sdXRlIGV4ZWN1dGFibGUgcGF0aC5cIiwgXCJleGVjdXRhYmxlXCIpO1xuICAgICAgdGhpcy5hZGRDdXN0b21MYW5ndWFnZVRleHRTZXR0aW5nKGJvZHksIGxhbmd1YWdlLCBcIkFyZ3VtZW50c1wiLCBcIlNwYWNlLXNlcGFyYXRlZCBhcmd1bWVudHMuIFVzZSB7ZmlsZX0gZm9yIHRoZSB0ZW1wIHNvdXJjZSBmaWxlLlwiLCBcImFyZ3NcIik7XG4gICAgICB0aGlzLmFkZEN1c3RvbUxhbmd1YWdlVGV4dFNldHRpbmcoYm9keSwgbGFuZ3VhZ2UsIFwiRXh0ZW5zaW9uXCIsIFwiVGVtcCBzb3VyY2UgZmlsZSBleHRlbnNpb24sIGZvciBleGFtcGxlIC5weS5cIiwgXCJleHRlbnNpb25cIik7XG5cbiAgICAgIG5ldyBTZXR0aW5nKGJvZHkpXG4gICAgICAgIC5zZXROYW1lKFwiUGFydGlhbCBleHRyYWN0aW9uIHN0cmF0ZWd5XCIpXG4gICAgICAgIC5zZXREZXNjKFwiQ2hvb3NlIGhvdyB0aGlzIGN1c3RvbSBsYW5ndWFnZSBzdXBwb3J0cyBwYXJ0aWFsIHJ1bm5hYmxlIHNvdXJjZS5cIilcbiAgICAgICAgLmFkZERyb3Bkb3duKChkcm9wZG93bikgPT5cbiAgICAgICAgICBkcm9wZG93blxuICAgICAgICAgICAgLmFkZE9wdGlvbihcImNvbW1hbmRcIiwgXCJFeHRyYWN0b3IgY29tbWFuZFwiKVxuICAgICAgICAgICAgLmFkZE9wdGlvbihcInRyYW5zcGlsZS1jXCIsIFwiVHJhbnNwaWxlIHRvIENcIilcbiAgICAgICAgICAgIC5zZXRWYWx1ZShsYW5ndWFnZS5leHRyYWN0b3JNb2RlIHx8IFwiY29tbWFuZFwiKVxuICAgICAgICAgICAgLm9uQ2hhbmdlKGFzeW5jICh2YWx1ZSkgPT4ge1xuICAgICAgICAgICAgICBsYW5ndWFnZS5leHRyYWN0b3JNb2RlID0gdmFsdWUgYXMgXCJjb21tYW5kXCIgfCBcInRyYW5zcGlsZS1jXCI7XG4gICAgICAgICAgICAgIGF3YWl0IHRoaXMubG9vbVBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgICAgICAgIH0pLFxuICAgICAgICApO1xuXG4gICAgICB0aGlzLmFkZEN1c3RvbUxhbmd1YWdlVGV4dFNldHRpbmcoYm9keSwgbGFuZ3VhZ2UsIFwiRXh0cmFjdG9yIGV4ZWN1dGFibGVcIiwgXCJPcHRpb25hbCBjb21tYW5kIGZvciBwYXJ0aWFsIHNvdXJjZSBleHRyYWN0aW9uLiBMZWF2ZSBlbXB0eSB0byB1c2UgZ2VuZXJpYyBsaW5lIGFuZCBzeW1ib2wgZXh0cmFjdGlvbi5cIiwgXCJleHRyYWN0b3JFeGVjdXRhYmxlXCIpO1xuICAgICAgdGhpcy5hZGRDdXN0b21MYW5ndWFnZVRleHRTZXR0aW5nKGJvZHksIGxhbmd1YWdlLCBcIkV4dHJhY3RvciBhcmd1bWVudHNcIiwgXCJBcmd1bWVudHMgZm9yIHRoZSBleHRyYWN0b3IuIFVzZSB7cmVxdWVzdH0sIHtzb3VyY2V9LCB7aGFybmVzc30sIHtzeW1ib2x9LCB7bGluZVN0YXJ0fSwge2xpbmVFbmR9LCB7ZGVwc30sIGFuZCB7bGFuZ3VhZ2V9LlwiLCBcImV4dHJhY3RvckFyZ3NcIik7XG4gICAgICB0aGlzLmFkZEN1c3RvbUxhbmd1YWdlVGV4dFNldHRpbmcoYm9keSwgbGFuZ3VhZ2UsIFwiVHJhbnNwaWxlIHRvIEMgZXhlY3V0YWJsZVwiLCBcIk9wdGlvbmFsIGNvbW1hbmQgdGhhdCBlbWl0cyBnZW5lcmF0ZWQgQyBhbmQgYSBzeW1ib2wgbWFwIGFzIEpTT04uXCIsIFwidHJhbnNwaWxlRXhlY3V0YWJsZVwiKTtcbiAgICAgIHRoaXMuYWRkQ3VzdG9tTGFuZ3VhZ2VUZXh0U2V0dGluZyhib2R5LCBsYW5ndWFnZSwgXCJUcmFuc3BpbGUgdG8gQyBhcmd1bWVudHNcIiwgXCJBcmd1bWVudHMgZm9yIHRoZSB0cmFuc3BpbGVyLiBVc2UgdGhlIHNhbWUgcGxhY2Vob2xkZXJzIGFzIGV4dHJhY3RvciBhcmd1bWVudHMuXCIsIFwidHJhbnNwaWxlQXJnc1wiKTtcblxuICAgICAgbmV3IFNldHRpbmcoYm9keSlcbiAgICAgICAgLnNldE5hbWUoXCJEZWxldGUgbGFuZ3VhZ2VcIilcbiAgICAgICAgLnNldERlc2MoXCJSZW1vdmUgdGhpcyBjdXN0b20gbGFuZ3VhZ2UuXCIpXG4gICAgICAgIC5hZGRCdXR0b24oKGJ1dHRvbikgPT5cbiAgICAgICAgICBidXR0b24uc2V0QnV0dG9uVGV4dChcIkRlbGV0ZVwiKS5zZXRXYXJuaW5nKCkub25DbGljayhhc3luYyAoKSA9PiB7XG4gICAgICAgICAgICB0aGlzLmxvb21QbHVnaW4uc2V0dGluZ3MuY3VzdG9tTGFuZ3VhZ2VzLnNwbGljZShpbmRleCwgMSk7XG4gICAgICAgICAgICBhd2FpdCB0aGlzLmxvb21QbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICAgICAgICB0aGlzLmRpc3BsYXkoKTtcbiAgICAgICAgICB9KSxcbiAgICAgICAgKTtcbiAgICB9KTtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgcmVuZGVyQ29udGFpbmVyR3JvdXBzKGNvbnRhaW5lckVsOiBIVE1MRWxlbWVudCk6IFByb21pc2U8dm9pZD4ge1xuICAgIHRyeSB7XG4gICAgICBjb25zdCBncm91cHMgPSBhd2FpdCB0aGlzLmxvb21QbHVnaW4uZ2V0Q29udGFpbmVyR3JvdXBTdW1tYXJpZXMoKTtcblxuICAgICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAgIC5zZXROYW1lKFwiRGVmYXVsdCBjb250YWluZXJpemF0aW9uIGdyb3VwXCIpXG4gICAgICAgIC5zZXREZXNjKFwiVGhlIGNvbnRhaW5lciBncm91cCB0byBydW4gY29kZSBibG9ja3MgaW4gYnkgZGVmYXVsdCBpZiB0aGUgbm90ZSBkb2VzIG5vdCBzcGVjaWZ5IG9uZS5cIilcbiAgICAgICAgLmFkZERyb3Bkb3duKChkcm9wZG93bikgPT4ge1xuICAgICAgICAgIGRyb3Bkb3duLmFkZE9wdGlvbihcIlwiLCBcIk5vbmVcIik7XG4gICAgICAgICAgZm9yIChjb25zdCBncm91cCBvZiBncm91cHMpIHtcbiAgICAgICAgICAgIGRyb3Bkb3duLmFkZE9wdGlvbihncm91cC5uYW1lLCBncm91cC5uYW1lKTtcbiAgICAgICAgICB9XG4gICAgICAgICAgZHJvcGRvd24uc2V0VmFsdWUodGhpcy5sb29tUGx1Z2luLnNldHRpbmdzLmRlZmF1bHRDb250YWluZXJHcm91cCB8fCBcIlwiKTtcbiAgICAgICAgICBkcm9wZG93bi5vbkNoYW5nZShhc3luYyAodmFsdWUpID0+IHtcbiAgICAgICAgICAgIHRoaXMubG9vbVBsdWdpbi5zZXR0aW5ncy5kZWZhdWx0Q29udGFpbmVyR3JvdXAgPSB2YWx1ZTtcbiAgICAgICAgICAgIGF3YWl0IHRoaXMubG9vbVBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgICAgICB9KTtcbiAgICAgICAgfSk7XG5cbiAgICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxuICAgICAgICAuc2V0TmFtZShcIkFkZCBuZXcgY29udGFpbmVyaXphdGlvbiBncm91cFwiKVxuICAgICAgICAuc2V0RGVzYyhcIkNyZWF0ZSBhIG5ldyBjb250YWluZXJpemF0aW9uIGdyb3VwIGNvbmZpZ3VyYXRpb24gZm9sZGVyLlwiKVxuICAgICAgICAuYWRkQnV0dG9uKChidXR0b24pID0+XG4gICAgICAgICAgYnV0dG9uLnNldEJ1dHRvblRleHQoXCIrXCIpLm9uQ2xpY2soKCkgPT4ge1xuICAgICAgICAgICAgbmV3IENvbnRhaW5lckdyb3VwTmFtZU1vZGFsKHRoaXMuYXBwLCBhc3luYyAoZ3JvdXBOYW1lKSA9PiB7XG4gICAgICAgICAgICAgIGNvbnN0IGNsZWFuTmFtZSA9IGdyb3VwTmFtZS50cmltKCkudG9Mb3dlckNhc2UoKS5yZXBsYWNlKC9bXmEtejAtOV8tXS9nLCBcIi1cIik7XG4gICAgICAgICAgICAgIGlmICghY2xlYW5OYW1lKSB7XG4gICAgICAgICAgICAgICAgbmV3IE5vdGljZShcIkludmFsaWQgZ3JvdXAgbmFtZS5cIik7XG4gICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgY29uc3QgcGx1Z2luRGlyID0gdGhpcy5sb29tUGx1Z2luLm1hbmlmZXN0LmRpciA/PyBcIi5vYnNpZGlhbi9wbHVnaW5zL2xvb21cIjtcbiAgICAgICAgICAgICAgY29uc3QgZ3JvdXBSZWxhdGl2ZVBhdGggPSBgJHtwbHVnaW5EaXJ9L2NvbnRhaW5lcnMvJHtjbGVhbk5hbWV9YDtcbiAgICAgICAgICAgICAgY29uc3QgY29uZmlnUGF0aCA9IGAke2dyb3VwUmVsYXRpdmVQYXRofS9jb25maWcuanNvbmA7XG5cbiAgICAgICAgICAgICAgY29uc3QgYWRhcHRlciA9IHRoaXMuYXBwLnZhdWx0LmFkYXB0ZXI7XG4gICAgICAgICAgICAgIGlmIChhd2FpdCBhZGFwdGVyLmV4aXN0cyhncm91cFJlbGF0aXZlUGF0aCkpIHtcbiAgICAgICAgICAgICAgICBuZXcgTm90aWNlKFwiQ29udGFpbmVyIGdyb3VwIGZvbGRlciBhbHJlYWR5IGV4aXN0cy5cIik7XG4gICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgYXdhaXQgYWRhcHRlci5ta2Rpcihncm91cFJlbGF0aXZlUGF0aCk7XG4gICAgICAgICAgICAgIGNvbnN0IGRlZmF1bHRDb25maWcgPSB7XG4gICAgICAgICAgICAgICAgcnVudGltZTogXCJkb2NrZXJcIixcbiAgICAgICAgICAgICAgICBpbWFnZTogXCJ1YnVudHU6bGF0ZXN0XCIsXG4gICAgICAgICAgICAgICAgbGFuZ3VhZ2VzOiB7XG4gICAgICAgICAgICAgICAgICBweXRob246IHtcbiAgICAgICAgICAgICAgICAgICAgY29tbWFuZDogXCJweXRob24zIHtmaWxlfVwiLFxuICAgICAgICAgICAgICAgICAgICBleHRlbnNpb246IFwiLnB5XCJcbiAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgIH07XG4gICAgICAgICAgICAgIGF3YWl0IGFkYXB0ZXIud3JpdGUoY29uZmlnUGF0aCwgSlNPTi5zdHJpbmdpZnkoZGVmYXVsdENvbmZpZywgbnVsbCwgMikpO1xuICAgICAgICAgICAgICBuZXcgTm90aWNlKGBDb250YWluZXIgZ3JvdXAgXCIke2NsZWFuTmFtZX1cIiBjcmVhdGVkLmApO1xuICAgICAgICAgICAgICB0aGlzLmRpc3BsYXkoKTtcbiAgICAgICAgICAgIH0pLm9wZW4oKTtcbiAgICAgICAgICB9KSxcbiAgICAgICAgKTtcblxuICAgICAgY29uc3QgbGlzdEVsID0gY29udGFpbmVyRWwuY3JlYXRlRGl2KHsgY2xzOiBcImxvb20tY29udGFpbmVyLWdyb3VwLWxpc3RcIiB9KTtcbiAgICAgIGlmICghZ3JvdXBzLmxlbmd0aCkge1xuICAgICAgICBsaXN0RWwuY3JlYXRlRWwoXCJwXCIsIHtcbiAgICAgICAgICB0ZXh0OiBcIk5vIGNvbnRhaW5lciBncm91cHMgZm91bmQgaW4gLm9ic2lkaWFuL3BsdWdpbnMvbG9vbS9jb250YWluZXJzLlwiLFxuICAgICAgICAgIGNsczogXCJzZXR0aW5nLWl0ZW0tZGVzY3JpcHRpb25cIixcbiAgICAgICAgfSk7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cblxuICAgICAgZm9yIChjb25zdCBncm91cCBvZiBncm91cHMpIHtcbiAgICAgICAgbmV3IFNldHRpbmcobGlzdEVsKVxuICAgICAgICAgIC5zZXROYW1lKGdyb3VwLm5hbWUpXG4gICAgICAgICAgLnNldERlc2MoZ3JvdXAuc3RhdHVzKVxuICAgICAgICAgIC5hZGRCdXR0b24oKGJ1dHRvbikgPT5cbiAgICAgICAgICAgIGJ1dHRvbi5zZXRCdXR0b25UZXh0KFwiQnVpbGQgLyByZWJ1aWxkXCIpLm9uQ2xpY2soYXN5bmMgKCkgPT4ge1xuICAgICAgICAgICAgICBhd2FpdCB0aGlzLmxvb21QbHVnaW4uYnVpbGRDb250YWluZXJHcm91cChncm91cC5uYW1lKTtcbiAgICAgICAgICAgIH0pLFxuICAgICAgICAgIClcbiAgICAgICAgICAuYWRkQnV0dG9uKChidXR0b24pID0+XG4gICAgICAgICAgICBidXR0b24uc2V0QnV0dG9uVGV4dChcIkVkaXRcIikub25DbGljaygoKSA9PiB7XG4gICAgICAgICAgICAgIGNvbnN0IHBsdWdpbkRpciA9IHRoaXMubG9vbVBsdWdpbi5tYW5pZmVzdC5kaXIgPz8gXCIub2JzaWRpYW4vcGx1Z2lucy9sb29tXCI7XG4gICAgICAgICAgICAgIG5ldyBFZGl0Q29udGFpbmVyR3JvdXBNb2RhbCh0aGlzLmxvb21QbHVnaW4sIGdyb3VwLm5hbWUsIHBsdWdpbkRpciwgKCkgPT4ge1xuICAgICAgICAgICAgICAgIHRoaXMuZGlzcGxheSgpO1xuICAgICAgICAgICAgICB9KS5vcGVuKCk7XG4gICAgICAgICAgICB9KSxcbiAgICAgICAgICApO1xuICAgICAgfVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBjb250YWluZXJFbC5lbXB0eSgpO1xuICAgICAgY29udGFpbmVyRWwuY3JlYXRlRWwoXCJwXCIsIHtcbiAgICAgICAgdGV4dDogYEVycm9yIGxvYWRpbmcgY29udGFpbmVyIGdyb3VwczogJHtlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IubWVzc2FnZSA6IFN0cmluZyhlcnJvcil9YCxcbiAgICAgICAgY2xzOiBcImxvb20tc2V0dGluZ3MtZXJyb3JcIixcbiAgICAgICAgYXR0cjogeyBzdHlsZTogXCJjb2xvcjogdmFyKC0tdGV4dC1lcnJvcik7IGZvbnQtd2VpZ2h0OiBib2xkOyBtYXJnaW46IDFlbSAwO1wiIH1cbiAgICAgIH0pO1xuICAgICAgY29uc29sZS5lcnJvcihcImxvb206IGZhaWxlZCB0byByZW5kZXIgY29udGFpbmVyIGdyb3VwczpcIiwgZXJyb3IpO1xuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgYWRkVGV4dFNldHRpbmc8SyBleHRlbmRzIGtleW9mIGxvb21QbHVnaW5TZXR0aW5ncz4oY29udGFpbmVyRWw6IEhUTUxFbGVtZW50LCBuYW1lOiBzdHJpbmcsIGRlc2NyaXB0aW9uOiBzdHJpbmcsIGtleTogSyk6IHZvaWQge1xuICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxuICAgICAgLnNldE5hbWUobmFtZSlcbiAgICAgIC5zZXREZXNjKGRlc2NyaXB0aW9uKVxuICAgICAgLmFkZFRleHQoKHRleHQpID0+XG4gICAgICAgIHRleHQuc2V0VmFsdWUoU3RyaW5nKHRoaXMubG9vbVBsdWdpbi5zZXR0aW5nc1trZXldID8/IFwiXCIpKS5vbkNoYW5nZShhc3luYyAodmFsdWUpID0+IHtcbiAgICAgICAgICAodGhpcy5sb29tUGx1Z2luLnNldHRpbmdzW2tleV0gYXMgc3RyaW5nKSA9IHZhbHVlLnRyaW0oKTtcbiAgICAgICAgICBhd2FpdCB0aGlzLmxvb21QbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICAgIH0pLFxuICAgICAgKTtcbiAgfVxuXG4gIHByaXZhdGUgYWRkQ3VzdG9tTGFuZ3VhZ2VUZXh0U2V0dGluZzxLIGV4dGVuZHMga2V5b2YgbG9vbUN1c3RvbUxhbmd1YWdlPihcbiAgICBjb250YWluZXJFbDogSFRNTEVsZW1lbnQsXG4gICAgbGFuZ3VhZ2U6IGxvb21DdXN0b21MYW5ndWFnZSxcbiAgICBuYW1lOiBzdHJpbmcsXG4gICAgZGVzY3JpcHRpb246IHN0cmluZyxcbiAgICBrZXk6IEssXG4gICk6IHZvaWQge1xuICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxuICAgICAgLnNldE5hbWUobmFtZSlcbiAgICAgIC5zZXREZXNjKGRlc2NyaXB0aW9uKVxuICAgICAgLmFkZFRleHQoKHRleHQpID0+XG4gICAgICAgIHRleHQuc2V0VmFsdWUoU3RyaW5nKGxhbmd1YWdlW2tleV0gPz8gXCJcIikpLm9uQ2hhbmdlKGFzeW5jICh2YWx1ZSkgPT4ge1xuICAgICAgICAgIChsYW5ndWFnZVtrZXldIGFzIHN0cmluZyB8IHVuZGVmaW5lZCkgPSB2YWx1ZS50cmltKCk7XG4gICAgICAgICAgYXdhaXQgdGhpcy5sb29tUGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgICAgICB9KSxcbiAgICAgICk7XG4gIH1cbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHNob3dFeGVjdXRpb25EaXNhYmxlZE5vdGljZSgpOiB2b2lkIHtcbiAgbmV3IE5vdGljZShcImxvb20gbG9jYWwgZXhlY3V0aW9uIGlzIGRpc2FibGVkLiBFbmFibGUgaXQgaW4gc2V0dGluZ3Mgb3IgY29uZmlybSB0aGUgZXhlY3V0aW9uIHdhcm5pbmcgZmlyc3QuXCIpO1xufVxuXG5jbGFzcyBDb250YWluZXJHcm91cE5hbWVNb2RhbCBleHRlbmRzIE1vZGFsIHtcbiAgcHJpdmF0ZSBuYW1lID0gXCJcIjtcblxuICBjb25zdHJ1Y3RvcihcbiAgICBhcHA6IEFwcCxcbiAgICBwcml2YXRlIHJlYWRvbmx5IG9uU3VibWl0OiAobmFtZTogc3RyaW5nKSA9PiBQcm9taXNlPHZvaWQ+LFxuICApIHtcbiAgICBzdXBlcihhcHApO1xuICB9XG5cbiAgb25PcGVuKCkge1xuICAgIGNvbnN0IHsgY29udGVudEVsIH0gPSB0aGlzO1xuICAgIGNvbnRlbnRFbC5lbXB0eSgpO1xuICAgIGNvbnRlbnRFbC5jcmVhdGVFbChcImgyXCIsIHsgdGV4dDogXCJOZXcgQ29udGFpbmVyIEdyb3VwIE5hbWVcIiB9KTtcblxuICAgIG5ldyBTZXR0aW5nKGNvbnRlbnRFbClcbiAgICAgIC5zZXROYW1lKFwiR3JvdXAgTmFtZVwiKVxuICAgICAgLnNldERlc2MoXCJVc2UgbG93ZXJjYXNlIGxldHRlcnMsIG51bWJlcnMsIGh5cGhlbnMsIGFuZCB1bmRlcnNjb3Jlcy5cIilcbiAgICAgIC5hZGRUZXh0KCh0ZXh0KSA9PlxuICAgICAgICB0ZXh0Lm9uQ2hhbmdlKCh2YWx1ZSkgPT4ge1xuICAgICAgICAgIHRoaXMubmFtZSA9IHZhbHVlO1xuICAgICAgICB9KSxcbiAgICAgICk7XG5cbiAgICBuZXcgU2V0dGluZyhjb250ZW50RWwpXG4gICAgICAuYWRkQnV0dG9uKChidG4pID0+XG4gICAgICAgIGJ0blxuICAgICAgICAgIC5zZXRCdXR0b25UZXh0KFwiQ3JlYXRlXCIpXG4gICAgICAgICAgLnNldEN0YSgpXG4gICAgICAgICAgLm9uQ2xpY2soYXN5bmMgKCkgPT4ge1xuICAgICAgICAgICAgYXdhaXQgdGhpcy5vblN1Ym1pdCh0aGlzLm5hbWUpO1xuICAgICAgICAgICAgdGhpcy5jbG9zZSgpO1xuICAgICAgICAgIH0pLFxuICAgICAgKTtcbiAgfVxufVxuXG5jbGFzcyBFZGl0Q29udGFpbmVyR3JvdXBNb2RhbCBleHRlbmRzIE1vZGFsIHtcbiAgcHJpdmF0ZSBhY3RpdmVUYWI6IFwiZ2VuZXJhbFwiIHwgXCJsYW5ndWFnZXNcIiB8IFwiZG9ja2VyZmlsZVwiIHwgXCJyYXdcIiA9IFwiZ2VuZXJhbFwiO1xuICBwcml2YXRlIGNvbmZpZ09iajogYW55ID0ge307XG4gIHByaXZhdGUgcmF3SnNvblRleHQgPSBcIlwiO1xuICBwcml2YXRlIGRvY2tlcmZpbGVUZXh0OiBzdHJpbmcgfCBudWxsID0gbnVsbDtcbiAgcHJpdmF0ZSBuZXdMYW5ndWFnZU5hbWUgPSBcIlwiO1xuICBwcml2YXRlIHRhYkhlYWRlckVsITogSFRNTEVsZW1lbnQ7XG4gIHByaXZhdGUgdGFiQ29udGVudEVsITogSFRNTEVsZW1lbnQ7XG5cbiAgY29uc3RydWN0b3IoXG4gICAgcHJpdmF0ZSByZWFkb25seSBsb29tUGx1Z2luOiBsb29tUGx1Z2luLFxuICAgIHByaXZhdGUgcmVhZG9ubHkgZ3JvdXBOYW1lOiBzdHJpbmcsXG4gICAgcHJpdmF0ZSByZWFkb25seSBwbHVnaW5EaXI6IHN0cmluZyxcbiAgICBwcml2YXRlIHJlYWRvbmx5IG9uU2F2ZTogKCkgPT4gdm9pZFxuICApIHtcbiAgICBzdXBlcihsb29tUGx1Z2luLmFwcCk7XG4gIH1cblxuICBhc3luYyBvbk9wZW4oKSB7XG4gICAgY29uc3QgeyBjb250ZW50RWwgfSA9IHRoaXM7XG4gICAgY29udGVudEVsLmVtcHR5KCk7XG4gICAgY29udGVudEVsLmNyZWF0ZUVsKFwiaDJcIiwgeyB0ZXh0OiBgRWRpdCBDb25maWc6ICR7dGhpcy5ncm91cE5hbWV9YCB9KTtcblxuICAgIGNvbnN0IGNvbmZpZ1BhdGggPSBgJHt0aGlzLnBsdWdpbkRpcn0vY29udGFpbmVycy8ke3RoaXMuZ3JvdXBOYW1lfS9jb25maWcuanNvbmA7XG4gICAgY29uc3QgZG9ja2VyZmlsZVBhdGggPSBgJHt0aGlzLnBsdWdpbkRpcn0vY29udGFpbmVycy8ke3RoaXMuZ3JvdXBOYW1lfS9Eb2NrZXJmaWxlYDtcbiAgICBjb25zdCBhZGFwdGVyID0gdGhpcy5hcHAudmF1bHQuYWRhcHRlcjtcblxuICAgIHRyeSB7XG4gICAgICBjb25zdCByYXdDb25maWcgPSBhd2FpdCBhZGFwdGVyLnJlYWQoY29uZmlnUGF0aCk7XG4gICAgICB0aGlzLmNvbmZpZ09iaiA9IEpTT04ucGFyc2UocmF3Q29uZmlnKTtcbiAgICAgIHRoaXMucmF3SnNvblRleHQgPSByYXdDb25maWc7XG4gICAgfSBjYXRjaCAoZSkge1xuICAgICAgbmV3IE5vdGljZShcIkNvdWxkIG5vdCByZWFkIGNvbmZpZ3VyYXRpb24gZmlsZS5cIik7XG4gICAgICB0aGlzLmNsb3NlKCk7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgdHJ5IHtcbiAgICAgIGlmIChhd2FpdCBhZGFwdGVyLmV4aXN0cyhkb2NrZXJmaWxlUGF0aCkpIHtcbiAgICAgICAgdGhpcy5kb2NrZXJmaWxlVGV4dCA9IGF3YWl0IGFkYXB0ZXIucmVhZChkb2NrZXJmaWxlUGF0aCk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICB0aGlzLmRvY2tlcmZpbGVUZXh0ID0gbnVsbDtcbiAgICAgIH1cbiAgICB9IGNhdGNoIChlKSB7XG4gICAgICB0aGlzLmRvY2tlcmZpbGVUZXh0ID0gbnVsbDtcbiAgICB9XG5cbiAgICBjb25zdCBjb250YWluZXIgPSBjb250ZW50RWwuY3JlYXRlRGl2KHsgY2xzOiBcImxvb20tdGFiLWNvbnRhaW5lclwiIH0pO1xuXG4gICAgLy8gUmVuZGVyIFRhYiBIZWFkZXJcbiAgICB0aGlzLnRhYkhlYWRlckVsID0gY29udGFpbmVyLmNyZWF0ZURpdih7IGNsczogXCJsb29tLXRhYi1oZWFkZXJcIiB9KTtcbiAgICB0aGlzLnJlbmRlclRhYnMoKTtcblxuICAgIC8vIFJlbmRlciBUYWIgQ29udGVudCBBcmVhXG4gICAgdGhpcy50YWJDb250ZW50RWwgPSBjb250YWluZXIuY3JlYXRlRGl2KHsgY2xzOiBcImxvb20tdGFiLWNvbnRlbnRcIiB9KTtcblxuICAgIC8vIFJlbmRlciBBY3Rpb25zIEZvb3RlclxuICAgIGNvbnN0IGFjdGlvbnMgPSBjb250ZW50RWwuY3JlYXRlRGl2KHsgY2xzOiBcImxvb20tbW9kYWwtYWN0aW9uc1wiIH0pO1xuICAgIGFjdGlvbnMuY3JlYXRlRWwoXCJidXR0b25cIiwgeyB0ZXh0OiBcIkNhbmNlbFwiIH0pLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoKSA9PiB0aGlzLmNsb3NlKCkpO1xuICAgIGNvbnN0IHNhdmVCdG4gPSBhY3Rpb25zLmNyZWF0ZUVsKFwiYnV0dG9uXCIsIHsgdGV4dDogXCJTYXZlXCIsIGNsczogXCJtb2QtY3RhXCIgfSk7XG4gICAgc2F2ZUJ0bi5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgYXN5bmMgKCkgPT4ge1xuICAgICAgYXdhaXQgdGhpcy5zYXZlQW5kQ2xvc2UoKTtcbiAgICB9KTtcblxuICAgIHRoaXMucmVuZGVyQWN0aXZlVGFiKCk7XG4gIH1cblxuICByZW5kZXJUYWJzKCkge1xuICAgIHRoaXMudGFiSGVhZGVyRWwuZW1wdHkoKTtcbiAgICBjb25zdCB0YWJzOiBBcnJheTx7IGlkOiBcImdlbmVyYWxcIiB8IFwibGFuZ3VhZ2VzXCIgfCBcImRvY2tlcmZpbGVcIiB8IFwicmF3XCI7IGxhYmVsOiBzdHJpbmcgfT4gPSBbXG4gICAgICB7IGlkOiBcImdlbmVyYWxcIiwgbGFiZWw6IFwiR2VuZXJhbFwiIH0sXG4gICAgICB7IGlkOiBcImxhbmd1YWdlc1wiLCBsYWJlbDogXCJMYW5ndWFnZXNcIiB9LFxuICAgICAgeyBpZDogXCJkb2NrZXJmaWxlXCIsIGxhYmVsOiBcIkRvY2tlcmZpbGVcIiB9LFxuICAgICAgeyBpZDogXCJyYXdcIiwgbGFiZWw6IFwiUmF3IEpTT05cIiB9LFxuICAgIF07XG5cbiAgICBmb3IgKGNvbnN0IHRhYiBvZiB0YWJzKSB7XG4gICAgICBjb25zdCBidG4gPSB0aGlzLnRhYkhlYWRlckVsLmNyZWF0ZUVsKFwiYnV0dG9uXCIsIHtcbiAgICAgICAgdGV4dDogdGFiLmxhYmVsLFxuICAgICAgICBjbHM6IFwibG9vbS10YWItYnRuXCIgKyAodGhpcy5hY3RpdmVUYWIgPT09IHRhYi5pZCA/IFwiIGlzLWFjdGl2ZVwiIDogXCJcIiksXG4gICAgICB9KTtcbiAgICAgIGJ0bi5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKCkgPT4ge1xuICAgICAgICB2b2lkIHRoaXMuc3dpdGNoVGFiKHRhYi5pZCk7XG4gICAgICB9KTtcbiAgICB9XG4gIH1cblxuICBhc3luYyBzd2l0Y2hUYWIodGFiOiBcImdlbmVyYWxcIiB8IFwibGFuZ3VhZ2VzXCIgfCBcImRvY2tlcmZpbGVcIiB8IFwicmF3XCIpIHtcbiAgICBpZiAodGhpcy5hY3RpdmVUYWIgPT09IFwicmF3XCIpIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIHRoaXMuY29uZmlnT2JqID0gSlNPTi5wYXJzZSh0aGlzLnJhd0pzb25UZXh0KTtcbiAgICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgbmV3IE5vdGljZShcIkludmFsaWQgSlNPTiBzeW50YXggaW4gUmF3IEpTT04gdGFiLiBQbGVhc2UgZml4IGl0IGJlZm9yZSBzd2l0Y2hpbmcuXCIpO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG4gICAgfVxuICAgIHRoaXMuYWN0aXZlVGFiID0gdGFiO1xuICAgIHRoaXMucmVuZGVyVGFicygpO1xuICAgIHRoaXMucmVuZGVyQWN0aXZlVGFiKCk7XG4gIH1cblxuICByZW5kZXJBY3RpdmVUYWIoKSB7XG4gICAgdGhpcy50YWJDb250ZW50RWwuZW1wdHkoKTtcbiAgICBpZiAodGhpcy5hY3RpdmVUYWIgPT09IFwiZ2VuZXJhbFwiKSB7XG4gICAgICB0aGlzLnJlbmRlckdlbmVyYWxUYWIodGhpcy50YWJDb250ZW50RWwpO1xuICAgIH0gZWxzZSBpZiAodGhpcy5hY3RpdmVUYWIgPT09IFwibGFuZ3VhZ2VzXCIpIHtcbiAgICAgIHRoaXMucmVuZGVyTGFuZ3VhZ2VzVGFiKHRoaXMudGFiQ29udGVudEVsKTtcbiAgICB9IGVsc2UgaWYgKHRoaXMuYWN0aXZlVGFiID09PSBcImRvY2tlcmZpbGVcIikge1xuICAgICAgdGhpcy5yZW5kZXJEb2NrZXJmaWxlVGFiKHRoaXMudGFiQ29udGVudEVsKTtcbiAgICB9IGVsc2UgaWYgKHRoaXMuYWN0aXZlVGFiID09PSBcInJhd1wiKSB7XG4gICAgICB0aGlzLnJlbmRlclJhd1RhYih0aGlzLnRhYkNvbnRlbnRFbCk7XG4gICAgfVxuICB9XG5cbiAgcmVuZGVyR2VuZXJhbFRhYihjb250YWluZXJFbDogSFRNTEVsZW1lbnQpIHtcbiAgICAvLyBSdW50aW1lIHNlbGVjdCBkcm9wZG93blxuICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxuICAgICAgLnNldE5hbWUoXCJSdW50aW1lXCIpXG4gICAgICAuc2V0RGVzYyhcIkNob29zZSB0aGUgY29udGFpbmVyL2Vudmlyb25tZW50IG1hbmFnZXIgcnVudGltZS5cIilcbiAgICAgIC5hZGREcm9wZG93bigoZHJvcGRvd24pID0+IHtcbiAgICAgICAgZHJvcGRvd25cbiAgICAgICAgICAuYWRkT3B0aW9uKFwiZG9ja2VyXCIsIFwiRG9ja2VyXCIpXG4gICAgICAgICAgLmFkZE9wdGlvbihcInBvZG1hblwiLCBcIlBvZG1hblwiKVxuICAgICAgICAgIC5hZGRPcHRpb24oXCJ3c2xcIiwgXCJXU0xcIilcbiAgICAgICAgICAuYWRkT3B0aW9uKFwicWVtdVwiLCBcIlFFTVVcIilcbiAgICAgICAgICAuYWRkT3B0aW9uKFwiY3VzdG9tXCIsIFwiQ3VzdG9tXCIpXG4gICAgICAgICAgLnNldFZhbHVlKHRoaXMuY29uZmlnT2JqLnJ1bnRpbWUgfHwgXCJkb2NrZXJcIilcbiAgICAgICAgICAub25DaGFuZ2UoKHZhbHVlKSA9PiB7XG4gICAgICAgICAgICB0aGlzLmNvbmZpZ09iai5ydW50aW1lID0gdmFsdWU7XG4gICAgICAgICAgICB0aGlzLnJlbmRlckFjdGl2ZVRhYigpO1xuICAgICAgICAgIH0pO1xuICAgICAgfSk7XG5cbiAgICAvLyBDb25kaXRpb25hbCBpbWFnZS9kaXN0cm8gbmFtZVxuICAgIGlmIChcbiAgICAgIHRoaXMuY29uZmlnT2JqLnJ1bnRpbWUgPT09IFwiZG9ja2VyXCIgfHxcbiAgICAgIHRoaXMuY29uZmlnT2JqLnJ1bnRpbWUgPT09IFwicG9kbWFuXCIgfHxcbiAgICAgIHRoaXMuY29uZmlnT2JqLnJ1bnRpbWUgPT09IFwid3NsXCJcbiAgICApIHtcbiAgICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxuICAgICAgICAuc2V0TmFtZSh0aGlzLmNvbmZpZ09iai5ydW50aW1lID09PSBcIndzbFwiID8gXCJXU0wgRGlzdHJvXCIgOiBcIkJhc2UgSW1hZ2VcIilcbiAgICAgICAgLnNldERlc2MoXG4gICAgICAgICAgdGhpcy5jb25maWdPYmoucnVudGltZSA9PT0gXCJ3c2xcIlxuICAgICAgICAgICAgPyBcIk9wdGlvbmFsLiBUaGUgdGFyZ2V0IFdTTCBkaXN0cm8gbmFtZSAobGVhdmUgZW1wdHkgZm9yIGRlZmF1bHQgZGlzdHJvKS5cIlxuICAgICAgICAgICAgOiBcIkZhbGxiYWNrIERvY2tlci9Qb2RtYW4gaW1hZ2UgaWYgbm8gRG9ja2VyZmlsZSBpcyBwcmVzZW50LlwiXG4gICAgICAgIClcbiAgICAgICAgLmFkZFRleHQoKHRleHQpID0+IHtcbiAgICAgICAgICB0ZXh0XG4gICAgICAgICAgICAuc2V0VmFsdWUodGhpcy5jb25maWdPYmouaW1hZ2UgfHwgXCJcIilcbiAgICAgICAgICAgIC5vbkNoYW5nZSgodmFsKSA9PiB7XG4gICAgICAgICAgICAgIHRoaXMuY29uZmlnT2JqLmltYWdlID0gdmFsLnRyaW0oKTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICBpZiAodGhpcy5jb25maWdPYmoucnVudGltZSA9PT0gXCJ3c2xcIikge1xuICAgICAgaWYgKCF0aGlzLmNvbmZpZ09iai53c2wpIHtcbiAgICAgICAgdGhpcy5jb25maWdPYmoud3NsID0ge307XG4gICAgICB9XG4gICAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgICAgLnNldE5hbWUoXCJVc2UgSW50ZXJhY3RpdmUgU2hlbGxcIilcbiAgICAgICAgLnNldERlc2MoXCJVc2UgaW50ZXJhY3RpdmUgbG9naW4gc2hlbGwgZmxhZ3MgKC1pIC1sKSB0byBlbnN1cmUgfi8uYmFzaHJjIGluaXRpYWxpemF0aW9uIHdvcmtzIChlLmcuLCBmb3IgTlZNKS5cIilcbiAgICAgICAgLmFkZFRvZ2dsZSgodG9nZ2xlKSA9PiB7XG4gICAgICAgICAgdG9nZ2xlXG4gICAgICAgICAgICAuc2V0VmFsdWUodGhpcy5jb25maWdPYmoud3NsLmludGVyYWN0aXZlID8/IGZhbHNlKVxuICAgICAgICAgICAgLm9uQ2hhbmdlKCh2YWwpID0+IHtcbiAgICAgICAgICAgICAgdGhpcy5jb25maWdPYmoud3NsLmludGVyYWN0aXZlID0gdmFsO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIC8vIENvbmRpdGlvbmFsIFFFTVUgU2V0dGluZ3NcbiAgICBpZiAodGhpcy5jb25maWdPYmoucnVudGltZSA9PT0gXCJxZW11XCIpIHtcbiAgICAgIGlmICghdGhpcy5jb25maWdPYmoucWVtdSkge1xuICAgICAgICB0aGlzLmNvbmZpZ09iai5xZW11ID0geyBzc2hUYXJnZXQ6IFwiXCIsIHJlbW90ZVdvcmtzcGFjZTogXCJcIiB9O1xuICAgICAgfVxuXG4gICAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgICAgLnNldE5hbWUoXCJTU0ggVGFyZ2V0XCIpXG4gICAgICAgIC5zZXREZXNjKFwiU1NIIHRhcmdldCBhZGRyZXNzIChlLmcuIHVzZXJAaG9zdG5hbWUgb3IgbG9jYWxob3N0IC1wIDIyMjIpLlwiKVxuICAgICAgICAuYWRkVGV4dCgodGV4dCkgPT4ge1xuICAgICAgICAgIHRleHRcbiAgICAgICAgICAgIC5zZXRWYWx1ZSh0aGlzLmNvbmZpZ09iai5xZW11LnNzaFRhcmdldCB8fCBcIlwiKVxuICAgICAgICAgICAgLm9uQ2hhbmdlKCh2YWwpID0+IHtcbiAgICAgICAgICAgICAgdGhpcy5jb25maWdPYmoucWVtdS5zc2hUYXJnZXQgPSB2YWwudHJpbSgpO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgIH0pO1xuXG4gICAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgICAgLnNldE5hbWUoXCJSZW1vdGUgV29ya3NwYWNlXCIpXG4gICAgICAgIC5zZXREZXNjKFwiUmVtb3RlIGZvbGRlciBwYXRoIHRvIGNvcHkgY29kZSBzbmlwcGV0cyBhbmQgcnVuIGNvbW1hbmRzIChlLmcuLCAvaG9tZS91c2VyL3dvcmtzcGFjZSkuXCIpXG4gICAgICAgIC5hZGRUZXh0KCh0ZXh0KSA9PiB7XG4gICAgICAgICAgdGV4dFxuICAgICAgICAgICAgLnNldFZhbHVlKHRoaXMuY29uZmlnT2JqLnFlbXUucmVtb3RlV29ya3NwYWNlIHx8IFwiXCIpXG4gICAgICAgICAgICAub25DaGFuZ2UoKHZhbCkgPT4ge1xuICAgICAgICAgICAgICB0aGlzLmNvbmZpZ09iai5xZW11LnJlbW90ZVdvcmtzcGFjZSA9IHZhbC50cmltKCk7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfSk7XG5cbiAgICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxuICAgICAgICAuc2V0TmFtZShcIlNTSCBFeGVjdXRhYmxlXCIpXG4gICAgICAgIC5zZXREZXNjKFwiT3B0aW9uYWwuIFBhdGggdG8gU1NIIGNsaWVudCBleGVjdXRhYmxlIChkZWZhdWx0cyB0byBzc2gpLlwiKVxuICAgICAgICAuYWRkVGV4dCgodGV4dCkgPT4ge1xuICAgICAgICAgIHRleHRcbiAgICAgICAgICAgIC5zZXRWYWx1ZSh0aGlzLmNvbmZpZ09iai5xZW11LnNzaEV4ZWN1dGFibGUgfHwgXCJcIilcbiAgICAgICAgICAgIC5vbkNoYW5nZSgodmFsKSA9PiB7XG4gICAgICAgICAgICAgIHRoaXMuY29uZmlnT2JqLnFlbXUuc3NoRXhlY3V0YWJsZSA9IHZhbC50cmltKCkgfHwgdW5kZWZpbmVkO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgIH0pO1xuXG4gICAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgICAgLnNldE5hbWUoXCJTU0ggQXJndW1lbnRzXCIpXG4gICAgICAgIC5zZXREZXNjKFwiT3B0aW9uYWwuIEFkZGl0aW9uYWwgU1NIIENMSSBmbGFncy5cIilcbiAgICAgICAgLmFkZFRleHQoKHRleHQpID0+IHtcbiAgICAgICAgICB0ZXh0XG4gICAgICAgICAgICAuc2V0VmFsdWUodGhpcy5jb25maWdPYmoucWVtdS5zc2hBcmdzIHx8IFwiXCIpXG4gICAgICAgICAgICAub25DaGFuZ2UoKHZhbCkgPT4ge1xuICAgICAgICAgICAgICB0aGlzLmNvbmZpZ09iai5xZW11LnNzaEFyZ3MgPSB2YWwudHJpbSgpIHx8IHVuZGVmaW5lZDtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICAvLyBDb25kaXRpb25hbCBDdXN0b20gU2V0dGluZ3NcbiAgICBpZiAodGhpcy5jb25maWdPYmoucnVudGltZSA9PT0gXCJjdXN0b21cIikge1xuICAgICAgaWYgKCF0aGlzLmNvbmZpZ09iai5jdXN0b20pIHtcbiAgICAgICAgdGhpcy5jb25maWdPYmouY3VzdG9tID0geyBleGVjdXRhYmxlOiBcIlwiIH07XG4gICAgICB9XG5cbiAgICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxuICAgICAgICAuc2V0TmFtZShcIkN1c3RvbSBFeGVjdXRhYmxlXCIpXG4gICAgICAgIC5zZXREZXNjKFwiUGF0aCB0byBjdXN0b20gcnVudGltZSB3cmFwcGVyIGV4ZWN1dGFibGUgb3Igc2NyaXB0LlwiKVxuICAgICAgICAuYWRkVGV4dCgodGV4dCkgPT4ge1xuICAgICAgICAgIHRleHRcbiAgICAgICAgICAgIC5zZXRWYWx1ZSh0aGlzLmNvbmZpZ09iai5jdXN0b20uZXhlY3V0YWJsZSB8fCBcIlwiKVxuICAgICAgICAgICAgLm9uQ2hhbmdlKCh2YWwpID0+IHtcbiAgICAgICAgICAgICAgdGhpcy5jb25maWdPYmouY3VzdG9tLmV4ZWN1dGFibGUgPSB2YWwudHJpbSgpO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgIH0pO1xuXG4gICAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgICAgLnNldE5hbWUoXCJDdXN0b20gQXJndW1lbnRzXCIpXG4gICAgICAgIC5zZXREZXNjKFwiT3B0aW9uYWwuIENvbW1hbmQgYXJndW1lbnRzLiBVc2Uge3JlcXVlc3R9IGZvciBKU09OIGNvbmZpZyBwYXRoLlwiKVxuICAgICAgICAuYWRkVGV4dCgodGV4dCkgPT4ge1xuICAgICAgICAgIHRleHRcbiAgICAgICAgICAgIC5zZXRWYWx1ZSh0aGlzLmNvbmZpZ09iai5jdXN0b20uYXJncyB8fCBcIlwiKVxuICAgICAgICAgICAgLm9uQ2hhbmdlKCh2YWwpID0+IHtcbiAgICAgICAgICAgICAgdGhpcy5jb25maWdPYmouY3VzdG9tLmFyZ3MgPSB2YWwudHJpbSgpIHx8IHVuZGVmaW5lZDtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9KTtcbiAgICB9XG4gIH1cblxuICByZW5kZXJMYW5ndWFnZXNUYWIoY29udGFpbmVyRWw6IEhUTUxFbGVtZW50KSB7XG4gICAgY29udGFpbmVyRWwuY3JlYXRlRWwoXCJoM1wiLCB7IHRleHQ6IFwiQ29uZmlndXJlZCBMYW5ndWFnZXNcIiB9KTtcblxuICAgIGlmICghdGhpcy5jb25maWdPYmoubGFuZ3VhZ2VzKSB7XG4gICAgICB0aGlzLmNvbmZpZ09iai5sYW5ndWFnZXMgPSB7fTtcbiAgICB9XG5cbiAgICBjb25zdCBsYW5nc0xpc3RFbCA9IGNvbnRhaW5lckVsLmNyZWF0ZURpdih7IGNsczogXCJsb29tLWxhbmd1YWdlcy1saXN0XCIgfSk7XG4gICAgY29uc3QgbGFuZ3VhZ2VzID0gT2JqZWN0LmVudHJpZXModGhpcy5jb25maWdPYmoubGFuZ3VhZ2VzIGFzIFJlY29yZDxzdHJpbmcsIHsgY29tbWFuZD86IHN0cmluZzsgZXh0ZW5zaW9uPzogc3RyaW5nOyB1c2VEZWZhdWx0PzogYm9vbGVhbiB9Pik7XG5cbiAgICBpZiAobGFuZ3VhZ2VzLmxlbmd0aCA9PT0gMCkge1xuICAgICAgbGFuZ3NMaXN0RWwuY3JlYXRlRWwoXCJwXCIsIHsgdGV4dDogXCJObyBsYW5ndWFnZXMgY29uZmlndXJlZCBmb3IgdGhpcyBncm91cC5cIiwgY2xzOiBcInNldHRpbmctaXRlbS1kZXNjcmlwdGlvblwiIH0pO1xuICAgIH0gZWxzZSB7XG4gICAgICBmb3IgKGNvbnN0IFtsYW5nTmFtZSwgbGFuZ0NvbmZpZ10gb2YgbGFuZ3VhZ2VzKSB7XG4gICAgICAgIGNvbnN0IGNhcmQgPSBsYW5nc0xpc3RFbC5jcmVhdGVEaXYoeyBjbHM6IFwibG9vbS1sYW5ndWFnZS1jYXJkXCIgfSk7XG4gICAgICAgIGNhcmQuY3JlYXRlRWwoXCJzdHJvbmdcIiwgeyB0ZXh0OiBsYW5nTmFtZSwgYXR0cjogeyBzdHlsZTogXCJkaXNwbGF5OiBibG9jazsgbWFyZ2luLWJvdHRvbTogMC41cmVtOyBmb250LXNpemU6IDEuMWVtO1wiIH0gfSk7XG5cbiAgICAgICAgY29uc3QgaXNEZWZhdWx0ID0gKGxhbmdDb25maWcgYXMgYW55KS51c2VEZWZhdWx0ID09PSB0cnVlO1xuXG4gICAgICAgIG5ldyBTZXR0aW5nKGNhcmQpXG4gICAgICAgICAgLnNldE5hbWUoXCJVc2UgZGVmYXVsdCBjb25maWd1cmF0aW9uXCIpXG4gICAgICAgICAgLnNldERlc2MoXCJJZiBjaGVja2VkLCBMb29tIHdpbGwgcnVuIHRoaXMgbGFuZ3VhZ2UgdXNpbmcgaXRzIGJ1aWx0LWluIGNvbW1hbmRzL2V4dGVuc2lvbnMuXCIpXG4gICAgICAgICAgLmFkZFRvZ2dsZSgodG9nZ2xlKSA9PiB7XG4gICAgICAgICAgICB0b2dnbGVcbiAgICAgICAgICAgICAgLnNldFZhbHVlKGlzRGVmYXVsdClcbiAgICAgICAgICAgICAgLm9uQ2hhbmdlKCh2YWwpID0+IHtcbiAgICAgICAgICAgICAgICBpZiAodmFsKSB7XG4gICAgICAgICAgICAgICAgICAobGFuZ0NvbmZpZyBhcyBhbnkpLnVzZURlZmF1bHQgPSB0cnVlO1xuICAgICAgICAgICAgICAgICAgZGVsZXRlIGxhbmdDb25maWcuY29tbWFuZDtcbiAgICAgICAgICAgICAgICAgIGRlbGV0ZSBsYW5nQ29uZmlnLmV4dGVuc2lvbjtcbiAgICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICAgZGVsZXRlIChsYW5nQ29uZmlnIGFzIGFueSkudXNlRGVmYXVsdDtcbiAgICAgICAgICAgICAgICAgIGNvbnN0IGRlZmF1bHRzID0gdGhpcy5sb29tUGx1Z2luLmNvbnRhaW5lclJ1bm5lci5nZXREZWZhdWx0TGFuZ3VhZ2VDb25maWcobGFuZ05hbWUsIHRoaXMubG9vbVBsdWdpbi5zZXR0aW5ncyk7XG4gICAgICAgICAgICAgICAgICBsYW5nQ29uZmlnLmNvbW1hbmQgPSBkZWZhdWx0cz8uY29tbWFuZCB8fCBcIlwiO1xuICAgICAgICAgICAgICAgICAgbGFuZ0NvbmZpZy5leHRlbnNpb24gPSBkZWZhdWx0cz8uZXh0ZW5zaW9uIHx8IFwiXCI7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIHRoaXMucmVuZGVyQWN0aXZlVGFiKCk7XG4gICAgICAgICAgICAgIH0pO1xuICAgICAgICAgIH0pO1xuXG4gICAgICAgIG5ldyBTZXR0aW5nKGNhcmQpXG4gICAgICAgICAgLnNldE5hbWUoXCJDb21tYW5kXCIpXG4gICAgICAgICAgLnNldERlc2MoXCJFeGVjdXRpb24gY29tbWFuZC4gVXNlIHtmaWxlfSBmb3IgdGhlIGNvZGUgc25pcHBldCBmaWxlbmFtZS5cIilcbiAgICAgICAgICAuYWRkVGV4dCgodGV4dCkgPT4ge1xuICAgICAgICAgICAgY29uc3QgZGVmYXVsdHMgPSB0aGlzLmxvb21QbHVnaW4uY29udGFpbmVyUnVubmVyLmdldERlZmF1bHRMYW5ndWFnZUNvbmZpZyhsYW5nTmFtZSwgdGhpcy5sb29tUGx1Z2luLnNldHRpbmdzKTtcbiAgICAgICAgICAgIHRleHRcbiAgICAgICAgICAgICAgLnNldFBsYWNlaG9sZGVyKGRlZmF1bHRzPy5jb21tYW5kIHx8IFwiXCIpXG4gICAgICAgICAgICAgIC5zZXRWYWx1ZShsYW5nQ29uZmlnLmNvbW1hbmQgfHwgXCJcIilcbiAgICAgICAgICAgICAgLnNldERpc2FibGVkKGlzRGVmYXVsdClcbiAgICAgICAgICAgICAgLm9uQ2hhbmdlKCh2YWwpID0+IHtcbiAgICAgICAgICAgICAgICBsYW5nQ29uZmlnLmNvbW1hbmQgPSB2YWwudHJpbSgpO1xuICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICB9KTtcblxuICAgICAgICBuZXcgU2V0dGluZyhjYXJkKVxuICAgICAgICAgIC5zZXROYW1lKFwiRXh0ZW5zaW9uXCIpXG4gICAgICAgICAgLnNldERlc2MoXCJTb3VyY2UgZmlsZSBleHRlbnNpb24gKGUuZy4gLnB5LCAuanMpLlwiKVxuICAgICAgICAgIC5hZGRUZXh0KCh0ZXh0KSA9PiB7XG4gICAgICAgICAgICBjb25zdCBkZWZhdWx0cyA9IHRoaXMubG9vbVBsdWdpbi5jb250YWluZXJSdW5uZXIuZ2V0RGVmYXVsdExhbmd1YWdlQ29uZmlnKGxhbmdOYW1lLCB0aGlzLmxvb21QbHVnaW4uc2V0dGluZ3MpO1xuICAgICAgICAgICAgdGV4dFxuICAgICAgICAgICAgICAuc2V0UGxhY2Vob2xkZXIoZGVmYXVsdHM/LmV4dGVuc2lvbiB8fCBcIlwiKVxuICAgICAgICAgICAgICAuc2V0VmFsdWUobGFuZ0NvbmZpZy5leHRlbnNpb24gfHwgXCJcIilcbiAgICAgICAgICAgICAgLnNldERpc2FibGVkKGlzRGVmYXVsdClcbiAgICAgICAgICAgICAgLm9uQ2hhbmdlKCh2YWwpID0+IHtcbiAgICAgICAgICAgICAgICBsYW5nQ29uZmlnLmV4dGVuc2lvbiA9IHZhbC50cmltKCk7XG4gICAgICAgICAgICAgIH0pO1xuICAgICAgICAgIH0pO1xuXG4gICAgICAgIG5ldyBTZXR0aW5nKGNhcmQpXG4gICAgICAgICAgLmFkZEJ1dHRvbigoYnRuKSA9PiB7XG4gICAgICAgICAgICBidG5cbiAgICAgICAgICAgICAgLnNldEJ1dHRvblRleHQoXCJSZW1vdmUgTGFuZ3VhZ2VcIilcbiAgICAgICAgICAgICAgLnNldFdhcm5pbmcoKVxuICAgICAgICAgICAgICAub25DbGljaygoKSA9PiB7XG4gICAgICAgICAgICAgICAgZGVsZXRlIHRoaXMuY29uZmlnT2JqLmxhbmd1YWdlc1tsYW5nTmFtZV07XG4gICAgICAgICAgICAgICAgdGhpcy5yZW5kZXJBY3RpdmVUYWIoKTtcbiAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgfSk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgLy8gQWRkIExhbmd1YWdlIFNlY3Rpb25cbiAgICBjb250YWluZXJFbC5jcmVhdGVFbChcImgzXCIsIHsgdGV4dDogXCJBZGQgTGFuZ3VhZ2UgTWFwcGluZ1wiLCBhdHRyOiB7IHN0eWxlOiBcIm1hcmdpbi10b3A6IDEuNXJlbTtcIiB9IH0pO1xuICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxuICAgICAgLnNldE5hbWUoXCJMYW5ndWFnZSBJRFwiKVxuICAgICAgLnNldERlc2MoXCJlLmcuIHB5dGhvbiwgamF2YXNjcmlwdCwgbm9kZSwgc2hcIilcbiAgICAgIC5hZGRUZXh0KCh0ZXh0KSA9PiB7XG4gICAgICAgIHRleHQuc2V0VmFsdWUodGhpcy5uZXdMYW5ndWFnZU5hbWUpLm9uQ2hhbmdlKCh2YWwpID0+IHtcbiAgICAgICAgICB0aGlzLm5ld0xhbmd1YWdlTmFtZSA9IHZhbC50cmltKCkudG9Mb3dlckNhc2UoKTtcbiAgICAgICAgfSk7XG4gICAgICB9KVxuICAgICAgLmFkZEJ1dHRvbigoYnRuKSA9PiB7XG4gICAgICAgIGJ0bi5zZXRCdXR0b25UZXh0KFwiKyBBZGRcIikuc2V0Q3RhKCkub25DbGljaygoKSA9PiB7XG4gICAgICAgICAgaWYgKCF0aGlzLm5ld0xhbmd1YWdlTmFtZSkge1xuICAgICAgICAgICAgbmV3IE5vdGljZShcIlBsZWFzZSBlbnRlciBhIGxhbmd1YWdlIG5hbWUuXCIpO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgIH1cbiAgICAgICAgICBpZiAodGhpcy5jb25maWdPYmoubGFuZ3VhZ2VzW3RoaXMubmV3TGFuZ3VhZ2VOYW1lXSkge1xuICAgICAgICAgICAgbmV3IE5vdGljZShcIkxhbmd1YWdlIGFscmVhZHkgY29uZmlndXJlZC5cIik7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgfVxuICAgICAgICAgIHRoaXMuY29uZmlnT2JqLmxhbmd1YWdlc1t0aGlzLm5ld0xhbmd1YWdlTmFtZV0gPSB7XG4gICAgICAgICAgICBjb21tYW5kOiBgJHt0aGlzLm5ld0xhbmd1YWdlTmFtZX0ge2ZpbGV9YCxcbiAgICAgICAgICAgIGV4dGVuc2lvbjogYC4ke3RoaXMubmV3TGFuZ3VhZ2VOYW1lfWAsXG4gICAgICAgICAgfTtcbiAgICAgICAgICB0aGlzLm5ld0xhbmd1YWdlTmFtZSA9IFwiXCI7XG4gICAgICAgICAgdGhpcy5yZW5kZXJBY3RpdmVUYWIoKTtcbiAgICAgICAgfSk7XG4gICAgICB9KTtcbiAgfVxuXG4gIHJlbmRlckRvY2tlcmZpbGVUYWIoY29udGFpbmVyRWw6IEhUTUxFbGVtZW50KSB7XG4gICAgaWYgKHRoaXMuY29uZmlnT2JqLnJ1bnRpbWUgIT09IFwiZG9ja2VyXCIgJiYgdGhpcy5jb25maWdPYmoucnVudGltZSAhPT0gXCJwb2RtYW5cIikge1xuICAgICAgY29udGFpbmVyRWwuY3JlYXRlRWwoXCJwXCIsIHtcbiAgICAgICAgdGV4dDogYERvY2tlcmZpbGUgZWRpdGluZyBpcyBvbmx5IGF2YWlsYWJsZSBmb3IgRG9ja2VyIGFuZCBQb2RtYW4gcnVudGltZXMuIEN1cnJlbnRseSB1c2luZzogJHt0aGlzLmNvbmZpZ09iai5ydW50aW1lfWAsXG4gICAgICAgIGNsczogXCJzZXR0aW5nLWl0ZW0tZGVzY3JpcHRpb25cIixcbiAgICAgIH0pO1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGlmICh0aGlzLmRvY2tlcmZpbGVUZXh0ID09PSBudWxsKSB7XG4gICAgICBjb250YWluZXJFbC5jcmVhdGVFbChcInBcIiwge1xuICAgICAgICB0ZXh0OiBcIk5vIERvY2tlcmZpbGUgZXhpc3RzIGluIHRoaXMgY29udGFpbmVyIGdyb3VwIGRpcmVjdG9yeS5cIixcbiAgICAgICAgY2xzOiBcInNldHRpbmctaXRlbS1kZXNjcmlwdGlvblwiLFxuICAgICAgfSk7XG5cbiAgICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxuICAgICAgICAuYWRkQnV0dG9uKChidG4pID0+IHtcbiAgICAgICAgICBidG5cbiAgICAgICAgICAgIC5zZXRCdXR0b25UZXh0KFwiQ3JlYXRlIERvY2tlcmZpbGVcIilcbiAgICAgICAgICAgIC5zZXRDdGEoKVxuICAgICAgICAgICAgLm9uQ2xpY2soKCkgPT4ge1xuICAgICAgICAgICAgICB0aGlzLmRvY2tlcmZpbGVUZXh0ID0gW1xuICAgICAgICAgICAgICAgIFwiRlJPTSB1YnVudHU6bGF0ZXN0XCIsXG4gICAgICAgICAgICAgICAgXCJcIixcbiAgICAgICAgICAgICAgICBcIiMgSW5zdGFsbCBwYWNrYWdlc1wiLFxuICAgICAgICAgICAgICAgIFwiUlVOIGFwdC1nZXQgdXBkYXRlICYmIGFwdC1nZXQgaW5zdGFsbCAteSBcXFxcXCIsXG4gICAgICAgICAgICAgICAgXCIgICAgcHl0aG9uMyBcXFxcXCIsXG4gICAgICAgICAgICAgICAgXCIgICAgbm9kZWpzIFxcXFxcIixcbiAgICAgICAgICAgICAgICBcIiAgICAmJiBybSAtcmYgL3Zhci9saWIvYXB0L2xpc3RzLypcIixcbiAgICAgICAgICAgICAgICBcIlwiLFxuICAgICAgICAgICAgICBdLmpvaW4oXCJcXG5cIik7XG4gICAgICAgICAgICAgIHRoaXMucmVuZGVyQWN0aXZlVGFiKCk7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxuICAgICAgICAuc2V0TmFtZShcIkRvY2tlcmZpbGUgQ29udGVudFwiKVxuICAgICAgICAuc2V0RGVzYyhcIkRlZmluZSB0aGUgYnVpbGQgc3RlcHMgZm9yIHlvdXIgZW52aXJvbm1lbnQgY29udGFpbmVyLlwiKVxuICAgICAgICAuYWRkVGV4dEFyZWEoKHRleHQpID0+IHtcbiAgICAgICAgICB0ZXh0LmlucHV0RWwucm93cyA9IDE1O1xuICAgICAgICAgIHRleHQuaW5wdXRFbC5zdHlsZS5mb250RmFtaWx5ID0gXCJtb25vc3BhY2VcIjtcbiAgICAgICAgICB0ZXh0LmlucHV0RWwuc3R5bGUud2lkdGggPSBcIjEwMCVcIjtcbiAgICAgICAgICB0ZXh0LnNldFZhbHVlKHRoaXMuZG9ja2VyZmlsZVRleHQgfHwgXCJcIik7XG4gICAgICAgICAgdGV4dC5vbkNoYW5nZSgodmFsKSA9PiB7XG4gICAgICAgICAgICB0aGlzLmRvY2tlcmZpbGVUZXh0ID0gdmFsO1xuICAgICAgICAgIH0pO1xuICAgICAgICB9KTtcbiAgICB9XG4gIH1cblxuICByZW5kZXJSYXdUYWIoY29udGFpbmVyRWw6IEhUTUxFbGVtZW50KSB7XG4gICAgdGhpcy5yYXdKc29uVGV4dCA9IEpTT04uc3RyaW5naWZ5KHRoaXMuY29uZmlnT2JqLCBudWxsLCAyKTtcbiAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgIC5zZXROYW1lKFwiQ29uZmlndXJhdGlvbiBKU09OXCIpXG4gICAgICAuYWRkVGV4dEFyZWEoKHRleHQpID0+IHtcbiAgICAgICAgdGV4dC5pbnB1dEVsLnJvd3MgPSAxNTtcbiAgICAgICAgdGV4dC5pbnB1dEVsLnN0eWxlLmZvbnRGYW1pbHkgPSBcIm1vbm9zcGFjZVwiO1xuICAgICAgICB0ZXh0LmlucHV0RWwuc3R5bGUud2lkdGggPSBcIjEwMCVcIjtcbiAgICAgICAgdGV4dC5zZXRWYWx1ZSh0aGlzLnJhd0pzb25UZXh0KTtcbiAgICAgICAgdGV4dC5vbkNoYW5nZSgodmFsKSA9PiB7XG4gICAgICAgICAgdGhpcy5yYXdKc29uVGV4dCA9IHZhbDtcbiAgICAgICAgfSk7XG4gICAgICB9KTtcbiAgfVxuXG4gIGFzeW5jIHNhdmVBbmRDbG9zZSgpIHtcbiAgICAvLyBJZiB0aGUgYWN0aXZlIHRhYiBpcyByYXcgSlNPTiwgcGFyc2UgaXQgZmlyc3QgdG8gZW5zdXJlIHdlIGNhcHR1cmUgZWRpdHNcbiAgICBpZiAodGhpcy5hY3RpdmVUYWIgPT09IFwicmF3XCIpIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIHRoaXMuY29uZmlnT2JqID0gSlNPTi5wYXJzZSh0aGlzLnJhd0pzb25UZXh0KTtcbiAgICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgbmV3IE5vdGljZShcIkludmFsaWQgSlNPTiBzeW50YXggaW4gUmF3IEpTT04gdGFiLiBQbGVhc2UgZml4IGl0IGJlZm9yZSBzYXZpbmcuXCIpO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG4gICAgfVxuXG4gICAgLy8gQmFzaWMgVmFsaWRhdGlvblxuICAgIGlmICghdGhpcy5jb25maWdPYmoucnVudGltZSkge1xuICAgICAgbmV3IE5vdGljZShcIlJ1bnRpbWUgaXMgcmVxdWlyZWQuXCIpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBpZiAodGhpcy5jb25maWdPYmoucnVudGltZSA9PT0gXCJxZW11XCIgJiYgKCF0aGlzLmNvbmZpZ09iai5xZW11Py5zc2hUYXJnZXQgfHwgIXRoaXMuY29uZmlnT2JqLnFlbXU/LnJlbW90ZVdvcmtzcGFjZSkpIHtcbiAgICAgIG5ldyBOb3RpY2UoXCJRRU1VIHJ1bnRpbWUgcmVxdWlyZXMgU1NIIFRhcmdldCBhbmQgUmVtb3RlIFdvcmtzcGFjZS5cIik7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIGlmICh0aGlzLmNvbmZpZ09iai5ydW50aW1lID09PSBcImN1c3RvbVwiICYmICF0aGlzLmNvbmZpZ09iai5jdXN0b20/LmV4ZWN1dGFibGUpIHtcbiAgICAgIG5ldyBOb3RpY2UoXCJDdXN0b20gcnVudGltZSByZXF1aXJlcyBDdXN0b20gRXhlY3V0YWJsZS5cIik7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgY29uc3QgYWRhcHRlciA9IHRoaXMuYXBwLnZhdWx0LmFkYXB0ZXI7XG4gICAgY29uc3QgY29uZmlnUGF0aCA9IGAke3RoaXMucGx1Z2luRGlyfS9jb250YWluZXJzLyR7dGhpcy5ncm91cE5hbWV9L2NvbmZpZy5qc29uYDtcbiAgICBjb25zdCBkb2NrZXJmaWxlUGF0aCA9IGAke3RoaXMucGx1Z2luRGlyfS9jb250YWluZXJzLyR7dGhpcy5ncm91cE5hbWV9L0RvY2tlcmZpbGVgO1xuXG4gICAgdHJ5IHtcbiAgICAgIC8vIFNhdmUgY29uZmlnLmpzb25cbiAgICAgIGNvbnN0IGNvbmZpZ1N0ciA9IEpTT04uc3RyaW5naWZ5KHRoaXMuY29uZmlnT2JqLCBudWxsLCAyKTtcbiAgICAgIGF3YWl0IGFkYXB0ZXIud3JpdGUoY29uZmlnUGF0aCwgY29uZmlnU3RyKTtcblxuICAgICAgLy8gU2F2ZSBEb2NrZXJmaWxlXG4gICAgICBpZiAodGhpcy5jb25maWdPYmoucnVudGltZSA9PT0gXCJkb2NrZXJcIiB8fCB0aGlzLmNvbmZpZ09iai5ydW50aW1lID09PSBcInBvZG1hblwiKSB7XG4gICAgICAgIGlmICh0aGlzLmRvY2tlcmZpbGVUZXh0ICE9PSBudWxsKSB7XG4gICAgICAgICAgYXdhaXQgYWRhcHRlci53cml0ZShkb2NrZXJmaWxlUGF0aCwgdGhpcy5kb2NrZXJmaWxlVGV4dCk7XG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgbmV3IE5vdGljZShcIkNvbnRhaW5lciBncm91cCBjb25maWd1cmF0aW9ucyBzYXZlZC5cIik7XG4gICAgICB0aGlzLm9uU2F2ZSgpO1xuICAgICAgdGhpcy5jbG9zZSgpO1xuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBuZXcgTm90aWNlKGBTYXZlIGZhaWxlZDogJHtlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IubWVzc2FnZSA6IFN0cmluZyhlcnJvcil9YCk7XG4gICAgfVxuICB9XG59XG4iLCAiaW1wb3J0IHsgc3Bhd24gfSBmcm9tIFwiY2hpbGRfcHJvY2Vzc1wiO1xuaW1wb3J0IHsgbWtkdGVtcCwgcm0sIHdyaXRlRmlsZSB9IGZyb20gXCJmcy9wcm9taXNlc1wiO1xuaW1wb3J0IHsgdG1wZGlyIH0gZnJvbSBcIm9zXCI7XG5pbXBvcnQgeyBqb2luIH0gZnJvbSBcInBhdGhcIjtcbmltcG9ydCB0eXBlIHsgbG9vbU5vcm1hbGl6ZWRMYW5ndWFnZSwgbG9vbVNvdXJjZVJlZmVyZW5jZSB9IGZyb20gXCIuL3R5cGVzXCI7XG5pbXBvcnQgeyBzcGxpdENvbW1hbmRMaW5lIH0gZnJvbSBcIi4vdXRpbHMvY29tbWFuZFwiO1xuXG5pbnRlcmZhY2UgU291cmNlUmFuZ2Uge1xuICBzdGFydDogbnVtYmVyO1xuICBlbmQ6IG51bWJlcjtcbn1cblxuaW50ZXJmYWNlIFNvdXJjZURlZmluaXRpb24gZXh0ZW5kcyBTb3VyY2VSYW5nZSB7XG4gIG5hbWU6IHN0cmluZztcbiAgbmFtZXM/OiBzdHJpbmdbXTtcbn1cblxuaW50ZXJmYWNlIFB5dGhvbkFsaWFzIHtcbiAgbmFtZTogc3RyaW5nO1xuICBhc25hbWU6IHN0cmluZyB8IG51bGw7XG59XG5cbmludGVyZmFjZSBQeXRob25JbXBvcnQgZXh0ZW5kcyBTb3VyY2VSYW5nZSB7XG4gIGtpbmQ6IFwiaW1wb3J0XCIgfCBcImZyb21cIjtcbiAgbW9kdWxlOiBzdHJpbmc7XG4gIGxldmVsOiBudW1iZXI7XG4gIG5hbWVzOiBQeXRob25BbGlhc1tdO1xufVxuXG5pbnRlcmZhY2UgUHl0aG9uTW9kdWxlSW5mbyB7XG4gIGRlZmluaXRpb25zOiBTb3VyY2VEZWZpbml0aW9uW107XG4gIGltcG9ydHM6IFB5dGhvbkltcG9ydFtdO1xufVxuXG5pbnRlcmZhY2UgUHl0aG9uVXNhZ2Uge1xuICBuYW1lczogc3RyaW5nW107XG4gIGF0dHJpYnV0ZXM6IFJlY29yZDxzdHJpbmcsIHN0cmluZ1tdPjtcbn1cblxuaW50ZXJmYWNlIFB5dGhvbkRlcGVuZGVuY3lTdGF0ZSB7XG4gIHJlYWRvbmx5IGluY2x1ZGVkUmFuZ2VzOiBTZXQ8c3RyaW5nPjtcbiAgcmVhZG9ubHkgaW5jbHVkZWRJbXBvcnRzOiBTZXQ8c3RyaW5nPjtcbiAgcmVhZG9ubHkgYWxpYXNlczogU2V0PHN0cmluZz47XG4gIHJlYWRvbmx5IG5hbWVzcGFjZUJpbmRpbmdzOiBNYXA8c3RyaW5nLCBTZXQ8c3RyaW5nPj47XG4gIHJlYWRvbmx5IHZpc2l0aW5nU3ltYm9sczogU2V0PHN0cmluZz47XG4gIG5lZWRzTmFtZXNwYWNlUnVudGltZTogYm9vbGVhbjtcbn1cblxuZXhwb3J0IGludGVyZmFjZSBsb29tU291cmNlRXh0cmFjdGlvbkhvc3Qge1xuICBweXRob25FeGVjdXRhYmxlPzogc3RyaW5nO1xuICBleHRlcm5hbEV4dHJhY3Rvcj86IGxvb21FeHRlcm5hbFNvdXJjZUV4dHJhY3RvcjtcbiAgcmVhZEZpbGUoZmlsZVBhdGg6IHN0cmluZyk6IFByb21pc2U8c3RyaW5nIHwgbnVsbD47XG4gIHJlc29sdmVQeXRob25JbXBvcnQoZnJvbUZpbGVQYXRoOiBzdHJpbmcsIG1vZHVsZU5hbWU6IHN0cmluZywgbGV2ZWw6IG51bWJlcik6IFByb21pc2U8c3RyaW5nIHwgbnVsbD47XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgbG9vbUV4dGVybmFsU291cmNlRXh0cmFjdG9yIHtcbiAgbW9kZTogXCJjb21tYW5kXCIgfCBcInRyYW5zcGlsZS1jXCI7XG4gIGxhbmd1YWdlOiBzdHJpbmc7XG4gIGV4ZWN1dGFibGU6IHN0cmluZztcbiAgYXJnczogc3RyaW5nW107XG4gIHdvcmtpbmdEaXJlY3Rvcnk6IHN0cmluZztcbiAgdGltZW91dE1zOiBudW1iZXI7XG59XG5cbmludGVyZmFjZSBFeHRlcm5hbEV4dHJhY3RvclJlc3VsdCB7XG4gIGNvbnRlbnQ/OiBzdHJpbmc7XG4gIHNlbGVjdGVkPzogc3RyaW5nO1xuICBkZXBlbmRlbmNpZXM/OiBzdHJpbmdbXTtcbiAgaW1wb3J0cz86IHN0cmluZ1tdO1xuICBkZXNjcmlwdGlvbj86IHN0cmluZztcbn1cblxuaW50ZXJmYWNlIFRyYW5zcGlsZVRvQ1Jlc3VsdCB7XG4gIGdlbmVyYXRlZFNvdXJjZTogc3RyaW5nO1xuICBzeW1ib2xzPzogUmVjb3JkPHN0cmluZywgc3RyaW5nPjtcbiAgaGFybmVzcz86IHN0cmluZztcbiAgbGFuZ3VhZ2U/OiBcImNcIiB8IFwiY3BwXCI7XG4gIGRlc2NyaXB0aW9uPzogc3RyaW5nO1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIGxvb21SZXNvbHZlZFNvdXJjZSB7XG4gIGNvbnRlbnQ6IHN0cmluZztcbiAgZGVzY3JpcHRpb246IHN0cmluZztcbn1cblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHJlc29sdmVSZWZlcmVuY2VkU291cmNlKFxuICBzb3VyY2U6IHN0cmluZyxcbiAgcmVmZXJlbmNlOiBsb29tU291cmNlUmVmZXJlbmNlLFxuICBsYW5ndWFnZTogbG9vbU5vcm1hbGl6ZWRMYW5ndWFnZSxcbiAgaGFybmVzczogc3RyaW5nLFxuICBob3N0PzogbG9vbVNvdXJjZUV4dHJhY3Rpb25Ib3N0LFxuKTogUHJvbWlzZTxsb29tUmVzb2x2ZWRTb3VyY2U+IHtcbiAgaWYgKGhvc3Q/LmV4dGVybmFsRXh0cmFjdG9yPy5leGVjdXRhYmxlLnRyaW0oKSkge1xuICAgIHJldHVybiBob3N0LmV4dGVybmFsRXh0cmFjdG9yLm1vZGUgPT09IFwidHJhbnNwaWxlLWNcIlxuICAgICAgPyByZXNvbHZlVHJhbnNwaWxlVG9DUmVmZXJlbmNlZFNvdXJjZShzb3VyY2UsIHJlZmVyZW5jZSwgbGFuZ3VhZ2UsIGhhcm5lc3MsIGhvc3QuZXh0ZXJuYWxFeHRyYWN0b3IpXG4gICAgICA6IHJlc29sdmVFeHRlcm5hbFJlZmVyZW5jZWRTb3VyY2Uoc291cmNlLCByZWZlcmVuY2UsIGxhbmd1YWdlLCBoYXJuZXNzLCBob3N0LmV4dGVybmFsRXh0cmFjdG9yKTtcbiAgfVxuXG4gIGlmIChsYW5ndWFnZSA9PT0gXCJweXRob25cIiAmJiBob3N0KSB7XG4gICAgcmV0dXJuIHJlc29sdmVQeXRob25SZWZlcmVuY2VkU291cmNlKHNvdXJjZSwgcmVmZXJlbmNlLCBoYXJuZXNzLCBob3N0KTtcbiAgfVxuXG4gIHJldHVybiByZXNvbHZlUmVmZXJlbmNlZFNvdXJjZUZhbGxiYWNrKHNvdXJjZSwgcmVmZXJlbmNlLCBsYW5ndWFnZSwgaGFybmVzcyk7XG59XG5cbmZ1bmN0aW9uIHJlc29sdmVSZWZlcmVuY2VkU291cmNlRmFsbGJhY2soXG4gIHNvdXJjZTogc3RyaW5nLFxuICByZWZlcmVuY2U6IGxvb21Tb3VyY2VSZWZlcmVuY2UsXG4gIGxhbmd1YWdlOiBsb29tTm9ybWFsaXplZExhbmd1YWdlLFxuICBoYXJuZXNzOiBzdHJpbmcsXG4pOiBsb29tUmVzb2x2ZWRTb3VyY2Uge1xuICBjb25zdCBsaW5lcyA9IHNvdXJjZS5zcGxpdCgvXFxyP1xcbi8pO1xuICBjb25zdCBzZWxlY3RlZFJhbmdlID0gcmVmZXJlbmNlLnN5bWJvbE5hbWVcbiAgICA/IGZpbmRTeW1ib2xSYW5nZShsaW5lcywgbGFuZ3VhZ2UsIHJlZmVyZW5jZS5zeW1ib2xOYW1lKVxuICAgIDogZmluZExpbmVSYW5nZShsaW5lcywgcmVmZXJlbmNlKTtcblxuICBpZiAoIXNlbGVjdGVkUmFuZ2UpIHtcbiAgICBjb25zdCB0YXJnZXQgPSByZWZlcmVuY2Uuc3ltYm9sTmFtZSA/IGBzeW1ib2wgJHtyZWZlcmVuY2Uuc3ltYm9sTmFtZX1gIDogXCJsaW5lIHJhbmdlXCI7XG4gICAgdGhyb3cgbmV3IEVycm9yKGBVbmFibGUgdG8gZXh0cmFjdCAke3RhcmdldH0gZnJvbSAke3JlZmVyZW5jZS5maWxlUGF0aH0uYCk7XG4gIH1cblxuICBjb25zdCBzZWxlY3RlZCA9IHJlbmRlclJhbmdlKGxpbmVzLCBzZWxlY3RlZFJhbmdlKTtcbiAgY29uc3QgZGVwZW5kZW5jaWVzID0gcmVmZXJlbmNlLnRyYWNlRGVwZW5kZW5jaWVzXG4gICAgPyBjb2xsZWN0RGVwZW5kZW5jeVNvdXJjZShsaW5lcywgbGFuZ3VhZ2UsIHNlbGVjdGVkUmFuZ2UsIHNlbGVjdGVkKVxuICAgIDogXCJcIjtcbiAgY29uc3QgY29udGVudCA9IFtkZXBlbmRlbmNpZXMsIHNlbGVjdGVkLCBoYXJuZXNzLnRyaW0oKSA/IGhhcm5lc3MgOiBcIlwiXVxuICAgIC5maWx0ZXIoKHBhcnQpID0+IHBhcnQudHJpbSgpKVxuICAgIC5qb2luKFwiXFxuXFxuXCIpO1xuXG4gIHJldHVybiB7XG4gICAgY29udGVudCxcbiAgICBkZXNjcmlwdGlvbjogZm9ybWF0U291cmNlRGVzY3JpcHRpb24ocmVmZXJlbmNlLCBzZWxlY3RlZFJhbmdlKSxcbiAgfTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gcmVzb2x2ZUV4dGVybmFsUmVmZXJlbmNlZFNvdXJjZShcbiAgc291cmNlOiBzdHJpbmcsXG4gIHJlZmVyZW5jZTogbG9vbVNvdXJjZVJlZmVyZW5jZSxcbiAgbGFuZ3VhZ2U6IGxvb21Ob3JtYWxpemVkTGFuZ3VhZ2UsXG4gIGhhcm5lc3M6IHN0cmluZyxcbiAgZXh0cmFjdG9yOiBsb29tRXh0ZXJuYWxTb3VyY2VFeHRyYWN0b3IsXG4pOiBQcm9taXNlPGxvb21SZXNvbHZlZFNvdXJjZT4ge1xuICBjb25zdCB0ZW1wRGlyID0gYXdhaXQgbWtkdGVtcChqb2luKHRtcGRpcigpLCBcImxvb20tZXh0cmFjdC1cIikpO1xuICBjb25zdCBzb3VyY2VGaWxlID0gam9pbih0ZW1wRGlyLCBcInNvdXJjZS50eHRcIik7XG4gIGNvbnN0IGhhcm5lc3NGaWxlID0gam9pbih0ZW1wRGlyLCBcImhhcm5lc3MudHh0XCIpO1xuICBjb25zdCByZXF1ZXN0RmlsZSA9IGpvaW4odGVtcERpciwgXCJyZXF1ZXN0Lmpzb25cIik7XG5cbiAgdHJ5IHtcbiAgICBjb25zdCByZXF1ZXN0ID0ge1xuICAgICAgbGFuZ3VhZ2UsXG4gICAgICBmaWxlUGF0aDogcmVmZXJlbmNlLmZpbGVQYXRoLFxuICAgICAgc3ltYm9sTmFtZTogcmVmZXJlbmNlLnN5bWJvbE5hbWUgPz8gbnVsbCxcbiAgICAgIGxpbmVTdGFydDogcmVmZXJlbmNlLmxpbmVTdGFydCA/PyBudWxsLFxuICAgICAgbGluZUVuZDogcmVmZXJlbmNlLmxpbmVFbmQgPz8gbnVsbCxcbiAgICAgIHRyYWNlRGVwZW5kZW5jaWVzOiByZWZlcmVuY2UudHJhY2VEZXBlbmRlbmNpZXMsXG4gICAgICBzb3VyY2VGaWxlLFxuICAgICAgaGFybmVzc0ZpbGUsXG4gICAgfTtcbiAgICBhd2FpdCB3cml0ZUZpbGUoc291cmNlRmlsZSwgc291cmNlLCBcInV0ZjhcIik7XG4gICAgYXdhaXQgd3JpdGVGaWxlKGhhcm5lc3NGaWxlLCBoYXJuZXNzLCBcInV0ZjhcIik7XG4gICAgYXdhaXQgd3JpdGVGaWxlKHJlcXVlc3RGaWxlLCBKU09OLnN0cmluZ2lmeShyZXF1ZXN0LCBudWxsLCAyKSwgXCJ1dGY4XCIpO1xuXG4gICAgY29uc3Qgb3V0cHV0ID0gYXdhaXQgcnVuRXh0ZXJuYWxFeHRyYWN0b3IoZXh0cmFjdG9yLCB7XG4gICAgICBsYW5ndWFnZSxcbiAgICAgIHNvdXJjZUZpbGUsXG4gICAgICBoYXJuZXNzRmlsZSxcbiAgICAgIHJlcXVlc3RGaWxlLFxuICAgICAgcmVmZXJlbmNlLFxuICAgIH0pO1xuICAgIGNvbnN0IHJlc3VsdCA9IHBhcnNlRXh0ZXJuYWxFeHRyYWN0b3JSZXN1bHQob3V0cHV0KTtcbiAgICBjb25zdCBjb250ZW50ID0gcmVzdWx0LmNvbnRlbnQgPz8gW1xuICAgICAgLi4uKHJlc3VsdC5pbXBvcnRzID8/IFtdKSxcbiAgICAgIC4uLihyZXN1bHQuZGVwZW5kZW5jaWVzID8/IFtdKSxcbiAgICAgIHJlc3VsdC5zZWxlY3RlZCA/PyBcIlwiLFxuICAgICAgaGFybmVzcy50cmltKCkgPyBoYXJuZXNzIDogXCJcIixcbiAgICBdLmZpbHRlcigocGFydCkgPT4gcGFydC50cmltKCkpLmpvaW4oXCJcXG5cXG5cIik7XG5cbiAgICBpZiAoIWNvbnRlbnQudHJpbSgpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJDdXN0b20gc291cmNlIGV4dHJhY3RvciByZXR1cm5lZCBubyBjb250ZW50LlwiKTtcbiAgICB9XG5cbiAgICByZXR1cm4ge1xuICAgICAgY29udGVudCxcbiAgICAgIGRlc2NyaXB0aW9uOiByZXN1bHQuZGVzY3JpcHRpb24/LnRyaW0oKSB8fCBmb3JtYXRTb3VyY2VEZXNjcmlwdGlvbihyZWZlcmVuY2UsIG51bGwpLFxuICAgIH07XG4gIH0gZmluYWxseSB7XG4gICAgYXdhaXQgcm0odGVtcERpciwgeyByZWN1cnNpdmU6IHRydWUsIGZvcmNlOiB0cnVlIH0pO1xuICB9XG59XG5cbmFzeW5jIGZ1bmN0aW9uIHJlc29sdmVUcmFuc3BpbGVUb0NSZWZlcmVuY2VkU291cmNlKFxuICBzb3VyY2U6IHN0cmluZyxcbiAgcmVmZXJlbmNlOiBsb29tU291cmNlUmVmZXJlbmNlLFxuICBsYW5ndWFnZTogbG9vbU5vcm1hbGl6ZWRMYW5ndWFnZSxcbiAgaGFybmVzczogc3RyaW5nLFxuICBleHRyYWN0b3I6IGxvb21FeHRlcm5hbFNvdXJjZUV4dHJhY3Rvcixcbik6IFByb21pc2U8bG9vbVJlc29sdmVkU291cmNlPiB7XG4gIGNvbnN0IHRlbXBEaXIgPSBhd2FpdCBta2R0ZW1wKGpvaW4odG1wZGlyKCksIFwibG9vbS1leHRyYWN0LVwiKSk7XG4gIGNvbnN0IHNvdXJjZUZpbGUgPSBqb2luKHRlbXBEaXIsIFwic291cmNlLnR4dFwiKTtcbiAgY29uc3QgaGFybmVzc0ZpbGUgPSBqb2luKHRlbXBEaXIsIFwiaGFybmVzcy50eHRcIik7XG4gIGNvbnN0IHJlcXVlc3RGaWxlID0gam9pbih0ZW1wRGlyLCBcInJlcXVlc3QuanNvblwiKTtcblxuICB0cnkge1xuICAgIGNvbnN0IHJlcXVlc3QgPSB7XG4gICAgICBsYW5ndWFnZSxcbiAgICAgIGZpbGVQYXRoOiByZWZlcmVuY2UuZmlsZVBhdGgsXG4gICAgICBzeW1ib2xOYW1lOiByZWZlcmVuY2Uuc3ltYm9sTmFtZSA/PyBudWxsLFxuICAgICAgbGluZVN0YXJ0OiByZWZlcmVuY2UubGluZVN0YXJ0ID8/IG51bGwsXG4gICAgICBsaW5lRW5kOiByZWZlcmVuY2UubGluZUVuZCA/PyBudWxsLFxuICAgICAgdHJhY2VEZXBlbmRlbmNpZXM6IHJlZmVyZW5jZS50cmFjZURlcGVuZGVuY2llcyxcbiAgICAgIHNvdXJjZUZpbGUsXG4gICAgICBoYXJuZXNzRmlsZSxcbiAgICAgIHRhcmdldExhbmd1YWdlOiBcImNcIixcbiAgICB9O1xuICAgIGF3YWl0IHdyaXRlRmlsZShzb3VyY2VGaWxlLCBzb3VyY2UsIFwidXRmOFwiKTtcbiAgICBhd2FpdCB3cml0ZUZpbGUoaGFybmVzc0ZpbGUsIGhhcm5lc3MsIFwidXRmOFwiKTtcbiAgICBhd2FpdCB3cml0ZUZpbGUocmVxdWVzdEZpbGUsIEpTT04uc3RyaW5naWZ5KHJlcXVlc3QsIG51bGwsIDIpLCBcInV0ZjhcIik7XG5cbiAgICBjb25zdCBvdXRwdXQgPSBhd2FpdCBydW5FeHRlcm5hbEV4dHJhY3RvcihleHRyYWN0b3IsIHtcbiAgICAgIGxhbmd1YWdlLFxuICAgICAgc291cmNlRmlsZSxcbiAgICAgIGhhcm5lc3NGaWxlLFxuICAgICAgcmVxdWVzdEZpbGUsXG4gICAgICByZWZlcmVuY2UsXG4gICAgfSk7XG4gICAgY29uc3QgcmVzdWx0ID0gcGFyc2VUcmFuc3BpbGVUb0NSZXN1bHQob3V0cHV0KTtcbiAgICBjb25zdCBnZW5lcmF0ZWRMYW5ndWFnZSA9IHJlc3VsdC5sYW5ndWFnZSA9PT0gXCJjcHBcIiA/IFwiY3BwXCIgOiBcImNcIjtcbiAgICBjb25zdCBtYXBwZWRTeW1ib2wgPSByZWZlcmVuY2Uuc3ltYm9sTmFtZSA/IHJlc3VsdC5zeW1ib2xzPy5bcmVmZXJlbmNlLnN5bWJvbE5hbWVdID8/IHJlZmVyZW5jZS5zeW1ib2xOYW1lIDogdW5kZWZpbmVkO1xuICAgIGNvbnN0IGdlbmVyYXRlZFJlZmVyZW5jZTogbG9vbVNvdXJjZVJlZmVyZW5jZSA9IHtcbiAgICAgIC4uLnJlZmVyZW5jZSxcbiAgICAgIGZpbGVQYXRoOiBgJHtyZWZlcmVuY2UuZmlsZVBhdGh9OmdlbmVyYXRlZC4ke2dlbmVyYXRlZExhbmd1YWdlID09PSBcImNwcFwiID8gXCJjcHBcIiA6IFwiY1wifWAsXG4gICAgICBzeW1ib2xOYW1lOiBtYXBwZWRTeW1ib2wsXG4gICAgfTtcbiAgICBjb25zdCByZXNvbHZlZCA9IHJlc29sdmVSZWZlcmVuY2VkU291cmNlRmFsbGJhY2socmVzdWx0LmdlbmVyYXRlZFNvdXJjZSwgZ2VuZXJhdGVkUmVmZXJlbmNlLCBnZW5lcmF0ZWRMYW5ndWFnZSwgcmVzdWx0Lmhhcm5lc3MgPz8gaGFybmVzcyk7XG5cbiAgICByZXR1cm4ge1xuICAgICAgY29udGVudDogcmVzb2x2ZWQuY29udGVudCxcbiAgICAgIGRlc2NyaXB0aW9uOiByZXN1bHQuZGVzY3JpcHRpb24/LnRyaW0oKSB8fCBgJHtyZWZlcmVuY2UuZmlsZVBhdGh9IyR7cmVmZXJlbmNlLnN5bWJvbE5hbWUgPz8gXCJnZW5lcmF0ZWQtY1wifWAsXG4gICAgfTtcbiAgfSBmaW5hbGx5IHtcbiAgICBhd2FpdCBybSh0ZW1wRGlyLCB7IHJlY3Vyc2l2ZTogdHJ1ZSwgZm9yY2U6IHRydWUgfSk7XG4gIH1cbn1cblxuYXN5bmMgZnVuY3Rpb24gcnVuRXh0ZXJuYWxFeHRyYWN0b3IoXG4gIGV4dHJhY3RvcjogbG9vbUV4dGVybmFsU291cmNlRXh0cmFjdG9yLFxuICB2YWx1ZXM6IHtcbiAgICBsYW5ndWFnZTogc3RyaW5nO1xuICAgIHNvdXJjZUZpbGU6IHN0cmluZztcbiAgICBoYXJuZXNzRmlsZTogc3RyaW5nO1xuICAgIHJlcXVlc3RGaWxlOiBzdHJpbmc7XG4gICAgcmVmZXJlbmNlOiBsb29tU291cmNlUmVmZXJlbmNlO1xuICB9LFxuKTogUHJvbWlzZTxzdHJpbmc+IHtcbiAgY29uc3QgYXJncyA9IGV4dHJhY3Rvci5hcmdzLm1hcCgoYXJnKSA9PiBhcmdcbiAgICAucmVwbGFjZUFsbChcIntyZXF1ZXN0fVwiLCB2YWx1ZXMucmVxdWVzdEZpbGUpXG4gICAgLnJlcGxhY2VBbGwoXCJ7c291cmNlfVwiLCB2YWx1ZXMuc291cmNlRmlsZSlcbiAgICAucmVwbGFjZUFsbChcIntmaWxlfVwiLCB2YWx1ZXMuc291cmNlRmlsZSlcbiAgICAucmVwbGFjZUFsbChcIntoYXJuZXNzfVwiLCB2YWx1ZXMuaGFybmVzc0ZpbGUpXG4gICAgLnJlcGxhY2VBbGwoXCJ7c3ltYm9sfVwiLCB2YWx1ZXMucmVmZXJlbmNlLnN5bWJvbE5hbWUgPz8gXCJcIilcbiAgICAucmVwbGFjZUFsbChcIntsaW5lU3RhcnR9XCIsIHZhbHVlcy5yZWZlcmVuY2UubGluZVN0YXJ0ID09IG51bGwgPyBcIlwiIDogU3RyaW5nKHZhbHVlcy5yZWZlcmVuY2UubGluZVN0YXJ0KSlcbiAgICAucmVwbGFjZUFsbChcIntsaW5lRW5kfVwiLCB2YWx1ZXMucmVmZXJlbmNlLmxpbmVFbmQgPT0gbnVsbCA/IFwiXCIgOiBTdHJpbmcodmFsdWVzLnJlZmVyZW5jZS5saW5lRW5kKSlcbiAgICAucmVwbGFjZUFsbChcIntkZXBzfVwiLCB2YWx1ZXMucmVmZXJlbmNlLnRyYWNlRGVwZW5kZW5jaWVzID8gXCJ0cnVlXCIgOiBcImZhbHNlXCIpXG4gICAgLnJlcGxhY2VBbGwoXCJ7bGFuZ3VhZ2V9XCIsIHZhbHVlcy5sYW5ndWFnZSkpO1xuXG4gIHJldHVybiBuZXcgUHJvbWlzZSgocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG4gICAgY29uc3QgY2hpbGQgPSBzcGF3bihleHRyYWN0b3IuZXhlY3V0YWJsZSwgYXJncywge1xuICAgICAgY3dkOiBleHRyYWN0b3Iud29ya2luZ0RpcmVjdG9yeSxcbiAgICAgIHN0ZGlvOiBbXCJwaXBlXCIsIFwicGlwZVwiLCBcInBpcGVcIl0sXG4gICAgfSk7XG4gICAgbGV0IHN0ZG91dCA9IFwiXCI7XG4gICAgbGV0IHN0ZGVyciA9IFwiXCI7XG4gICAgY29uc3QgdGltZW91dCA9IHNldFRpbWVvdXQoKCkgPT4ge1xuICAgICAgY2hpbGQua2lsbChcIlNJR1RFUk1cIik7XG4gICAgICByZWplY3QobmV3IEVycm9yKGBDdXN0b20gc291cmNlIGV4dHJhY3RvciB0aW1lZCBvdXQgYWZ0ZXIgJHtleHRyYWN0b3IudGltZW91dE1zfSBtcy5gKSk7XG4gICAgfSwgZXh0cmFjdG9yLnRpbWVvdXRNcyk7XG5cbiAgICBjaGlsZC5zdGRvdXQuc2V0RW5jb2RpbmcoXCJ1dGY4XCIpO1xuICAgIGNoaWxkLnN0ZGVyci5zZXRFbmNvZGluZyhcInV0ZjhcIik7XG4gICAgY2hpbGQuc3Rkb3V0Lm9uKFwiZGF0YVwiLCAoY2h1bms6IHN0cmluZykgPT4ge1xuICAgICAgc3Rkb3V0ICs9IGNodW5rO1xuICAgIH0pO1xuICAgIGNoaWxkLnN0ZGVyci5vbihcImRhdGFcIiwgKGNodW5rOiBzdHJpbmcpID0+IHtcbiAgICAgIHN0ZGVyciArPSBjaHVuaztcbiAgICB9KTtcbiAgICBjaGlsZC5vbihcImVycm9yXCIsIChlcnJvcikgPT4ge1xuICAgICAgY2xlYXJUaW1lb3V0KHRpbWVvdXQpO1xuICAgICAgcmVqZWN0KGVycm9yKTtcbiAgICB9KTtcbiAgICBjaGlsZC5vbihcImNsb3NlXCIsIChjb2RlKSA9PiB7XG4gICAgICBjbGVhclRpbWVvdXQodGltZW91dCk7XG4gICAgICBpZiAoY29kZSAhPT0gMCkge1xuICAgICAgICByZWplY3QobmV3IEVycm9yKChzdGRlcnIgfHwgc3Rkb3V0IHx8IGBDdXN0b20gc291cmNlIGV4dHJhY3RvciBleGl0ZWQgd2l0aCBjb2RlICR7Y29kZX0uYCkudHJpbSgpKSk7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cbiAgICAgIHJlc29sdmUoc3Rkb3V0KTtcbiAgICB9KTtcblxuICAgIGNoaWxkLnN0ZGluLmVuZChKU09OLnN0cmluZ2lmeSh7XG4gICAgICByZXF1ZXN0RmlsZTogdmFsdWVzLnJlcXVlc3RGaWxlLFxuICAgICAgc291cmNlRmlsZTogdmFsdWVzLnNvdXJjZUZpbGUsXG4gICAgICBoYXJuZXNzRmlsZTogdmFsdWVzLmhhcm5lc3NGaWxlLFxuICAgICAgbGFuZ3VhZ2U6IHZhbHVlcy5sYW5ndWFnZSxcbiAgICAgIGZpbGVQYXRoOiB2YWx1ZXMucmVmZXJlbmNlLmZpbGVQYXRoLFxuICAgICAgc3ltYm9sTmFtZTogdmFsdWVzLnJlZmVyZW5jZS5zeW1ib2xOYW1lID8/IG51bGwsXG4gICAgICBsaW5lU3RhcnQ6IHZhbHVlcy5yZWZlcmVuY2UubGluZVN0YXJ0ID8/IG51bGwsXG4gICAgICBsaW5lRW5kOiB2YWx1ZXMucmVmZXJlbmNlLmxpbmVFbmQgPz8gbnVsbCxcbiAgICAgIHRyYWNlRGVwZW5kZW5jaWVzOiB2YWx1ZXMucmVmZXJlbmNlLnRyYWNlRGVwZW5kZW5jaWVzLFxuICAgIH0pKTtcbiAgfSk7XG59XG5cbmZ1bmN0aW9uIHBhcnNlRXh0ZXJuYWxFeHRyYWN0b3JSZXN1bHQob3V0cHV0OiBzdHJpbmcpOiBFeHRlcm5hbEV4dHJhY3RvclJlc3VsdCB7XG4gIHRyeSB7XG4gICAgY29uc3QgcGFyc2VkID0gSlNPTi5wYXJzZShvdXRwdXQpIGFzIEV4dGVybmFsRXh0cmFjdG9yUmVzdWx0O1xuICAgIGlmICh0eXBlb2YgcGFyc2VkICE9PSBcIm9iamVjdFwiIHx8IHBhcnNlZCA9PSBudWxsKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJDdXN0b20gc291cmNlIGV4dHJhY3RvciBtdXN0IHJldHVybiBhIEpTT04gb2JqZWN0LlwiKTtcbiAgICB9XG4gICAgcmV0dXJuIHBhcnNlZDtcbiAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYEN1c3RvbSBzb3VyY2UgZXh0cmFjdG9yIHJldHVybmVkIGludmFsaWQgSlNPTjogJHtlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IubWVzc2FnZSA6IFN0cmluZyhlcnJvcil9YCk7XG4gIH1cbn1cblxuZnVuY3Rpb24gcGFyc2VUcmFuc3BpbGVUb0NSZXN1bHQob3V0cHV0OiBzdHJpbmcpOiBUcmFuc3BpbGVUb0NSZXN1bHQge1xuICB0cnkge1xuICAgIGNvbnN0IHBhcnNlZCA9IEpTT04ucGFyc2Uob3V0cHV0KSBhcyBUcmFuc3BpbGVUb0NSZXN1bHQ7XG4gICAgaWYgKHR5cGVvZiBwYXJzZWQgIT09IFwib2JqZWN0XCIgfHwgcGFyc2VkID09IG51bGwgfHwgdHlwZW9mIHBhcnNlZC5nZW5lcmF0ZWRTb3VyY2UgIT09IFwic3RyaW5nXCIpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIlRyYW5zcGlsZSB0byBDIGV4dHJhY3RvciBtdXN0IHJldHVybiBnZW5lcmF0ZWRTb3VyY2UuXCIpO1xuICAgIH1cbiAgICBpZiAocGFyc2VkLmxhbmd1YWdlICE9IG51bGwgJiYgcGFyc2VkLmxhbmd1YWdlICE9PSBcImNcIiAmJiBwYXJzZWQubGFuZ3VhZ2UgIT09IFwiY3BwXCIpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIlRyYW5zcGlsZSB0byBDIGxhbmd1YWdlIG11c3QgYmUgYyBvciBjcHAuXCIpO1xuICAgIH1cbiAgICBpZiAocGFyc2VkLnN5bWJvbHMgIT0gbnVsbCAmJiAodHlwZW9mIHBhcnNlZC5zeW1ib2xzICE9PSBcIm9iamVjdFwiIHx8IEFycmF5LmlzQXJyYXkocGFyc2VkLnN5bWJvbHMpKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiVHJhbnNwaWxlIHRvIEMgc3ltYm9scyBtdXN0IGJlIGFuIG9iamVjdC5cIik7XG4gICAgfVxuICAgIHJldHVybiBwYXJzZWQ7XG4gIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGBUcmFuc3BpbGUgdG8gQyBleHRyYWN0b3IgcmV0dXJuZWQgaW52YWxpZCBKU09OOiAke2Vycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogU3RyaW5nKGVycm9yKX1gKTtcbiAgfVxufVxuXG5hc3luYyBmdW5jdGlvbiByZXNvbHZlUHl0aG9uUmVmZXJlbmNlZFNvdXJjZShcbiAgc291cmNlOiBzdHJpbmcsXG4gIHJlZmVyZW5jZTogbG9vbVNvdXJjZVJlZmVyZW5jZSxcbiAgaGFybmVzczogc3RyaW5nLFxuICBob3N0OiBsb29tU291cmNlRXh0cmFjdGlvbkhvc3QsXG4pOiBQcm9taXNlPGxvb21SZXNvbHZlZFNvdXJjZT4ge1xuICBjb25zdCBsaW5lcyA9IHNvdXJjZS5zcGxpdCgvXFxyP1xcbi8pO1xuICBjb25zdCBtb2R1bGVJbmZvID0gYXdhaXQgaW5zcGVjdFB5dGhvbk1vZHVsZShzb3VyY2UsIGhvc3QpO1xuICBjb25zdCBzZWxlY3RlZFJhbmdlID0gcmVmZXJlbmNlLnN5bWJvbE5hbWVcbiAgICA/IGZpbmRQeXRob25TeW1ib2xSYW5nZShtb2R1bGVJbmZvLCByZWZlcmVuY2Uuc3ltYm9sTmFtZSlcbiAgICA6IGZpbmRMaW5lUmFuZ2UobGluZXMsIHJlZmVyZW5jZSk7XG5cbiAgaWYgKCFzZWxlY3RlZFJhbmdlKSB7XG4gICAgY29uc3QgdGFyZ2V0ID0gcmVmZXJlbmNlLnN5bWJvbE5hbWUgPyBgc3ltYm9sICR7cmVmZXJlbmNlLnN5bWJvbE5hbWV9YCA6IFwibGluZSByYW5nZVwiO1xuICAgIHRocm93IG5ldyBFcnJvcihgVW5hYmxlIHRvIGV4dHJhY3QgJHt0YXJnZXR9IGZyb20gJHtyZWZlcmVuY2UuZmlsZVBhdGh9LmApO1xuICB9XG5cbiAgY29uc3Qgc2VsZWN0ZWQgPSByZW5kZXJSYW5nZShsaW5lcywgc2VsZWN0ZWRSYW5nZSk7XG4gIGNvbnN0IHN0YXRlID0gY3JlYXRlUHl0aG9uRGVwZW5kZW5jeVN0YXRlKCk7XG4gIGNvbnN0IGRlcGVuZGVuY2llcyA9IHJlZmVyZW5jZS50cmFjZURlcGVuZGVuY2llc1xuICAgID8gYXdhaXQgY29sbGVjdFB5dGhvbkRlcGVuZGVuY3lTb3VyY2Uoc291cmNlLCByZWZlcmVuY2UuZmlsZVBhdGgsIHNlbGVjdGVkUmFuZ2UsIHNlbGVjdGVkLCBoYXJuZXNzLCBob3N0LCBzdGF0ZSlcbiAgICA6IFwiXCI7XG4gIGNvbnN0IGNvbnRlbnQgPSBbZGVwZW5kZW5jaWVzLCBzZWxlY3RlZCwgaGFybmVzcy50cmltKCkgPyBoYXJuZXNzIDogXCJcIl1cbiAgICAuZmlsdGVyKChwYXJ0KSA9PiBwYXJ0LnRyaW0oKSlcbiAgICAuam9pbihcIlxcblxcblwiKTtcblxuICByZXR1cm4ge1xuICAgIGNvbnRlbnQsXG4gICAgZGVzY3JpcHRpb246IGZvcm1hdFNvdXJjZURlc2NyaXB0aW9uKHJlZmVyZW5jZSwgc2VsZWN0ZWRSYW5nZSksXG4gIH07XG59XG5cbmZ1bmN0aW9uIGNyZWF0ZVB5dGhvbkRlcGVuZGVuY3lTdGF0ZSgpOiBQeXRob25EZXBlbmRlbmN5U3RhdGUge1xuICByZXR1cm4ge1xuICAgIGluY2x1ZGVkUmFuZ2VzOiBuZXcgU2V0KCksXG4gICAgaW5jbHVkZWRJbXBvcnRzOiBuZXcgU2V0KCksXG4gICAgYWxpYXNlczogbmV3IFNldCgpLFxuICAgIG5hbWVzcGFjZUJpbmRpbmdzOiBuZXcgTWFwKCksXG4gICAgdmlzaXRpbmdTeW1ib2xzOiBuZXcgU2V0KCksXG4gICAgbmVlZHNOYW1lc3BhY2VSdW50aW1lOiBmYWxzZSxcbiAgfTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gY29sbGVjdFB5dGhvbkRlcGVuZGVuY3lTb3VyY2UoXG4gIHNvdXJjZTogc3RyaW5nLFxuICBmaWxlUGF0aDogc3RyaW5nLFxuICBzZWxlY3RlZFJhbmdlOiBTb3VyY2VSYW5nZSxcbiAgc2VsZWN0ZWQ6IHN0cmluZyxcbiAgaGFybmVzczogc3RyaW5nLFxuICBob3N0OiBsb29tU291cmNlRXh0cmFjdGlvbkhvc3QsXG4gIHN0YXRlOiBQeXRob25EZXBlbmRlbmN5U3RhdGUsXG4pOiBQcm9taXNlPHN0cmluZz4ge1xuICBjb25zdCBwYXJ0czogc3RyaW5nW10gPSBbXTtcbiAgYXdhaXQgY29sbGVjdFB5dGhvbkRlcGVuZGVuY2llcyhzb3VyY2UsIGZpbGVQYXRoLCBzZWxlY3RlZFJhbmdlLCBgJHtzZWxlY3RlZH1cXG4ke2hhcm5lc3N9YCwgaG9zdCwgc3RhdGUsIHBhcnRzKTtcbiAgY29uc3QgbmFtZXNwYWNlID0gcmVuZGVyUHl0aG9uTmFtZXNwYWNlQmluZGluZ3Moc3RhdGUpO1xuICByZXR1cm4gWy4uLnN0YXRlLmluY2x1ZGVkSW1wb3J0cywgLi4ucGFydHMsIG5hbWVzcGFjZV1cbiAgICAuZmlsdGVyKChwYXJ0KSA9PiBwYXJ0LnRyaW0oKSlcbiAgICAuam9pbihcIlxcblxcblwiKTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gY29sbGVjdFB5dGhvbkRlcGVuZGVuY2llcyhcbiAgc291cmNlOiBzdHJpbmcsXG4gIGZpbGVQYXRoOiBzdHJpbmcsXG4gIHNlbGVjdGVkUmFuZ2U6IFNvdXJjZVJhbmdlLFxuICBzZWVkOiBzdHJpbmcsXG4gIGhvc3Q6IGxvb21Tb3VyY2VFeHRyYWN0aW9uSG9zdCxcbiAgc3RhdGU6IFB5dGhvbkRlcGVuZGVuY3lTdGF0ZSxcbiAgcGFydHM6IHN0cmluZ1tdLFxuKTogUHJvbWlzZTxzdHJpbmc+IHtcbiAgY29uc3QgbGluZXMgPSBzb3VyY2Uuc3BsaXQoL1xccj9cXG4vKTtcbiAgY29uc3QgbW9kdWxlSW5mbyA9IGF3YWl0IGluc3BlY3RQeXRob25Nb2R1bGUoc291cmNlLCBob3N0KTtcbiAgbGV0IGhheXN0YWNrID0gc2VlZDtcbiAgbGV0IGNvbGxlY3RlZCA9IFwiXCI7XG4gIGxldCBjaGFuZ2VkID0gdHJ1ZTtcblxuICB3aGlsZSAoY2hhbmdlZCkge1xuICAgIGNoYW5nZWQgPSBmYWxzZTtcbiAgICBjb25zdCB1c2FnZSA9IGF3YWl0IGluc3BlY3RQeXRob25Vc2FnZShoYXlzdGFjaywgaG9zdCk7XG5cbiAgICBmb3IgKGNvbnN0IGRlZmluaXRpb24gb2YgbW9kdWxlSW5mby5kZWZpbml0aW9ucykge1xuICAgICAgaWYgKHJhbmdlc092ZXJsYXAoZGVmaW5pdGlvbiwgc2VsZWN0ZWRSYW5nZSkgfHwgIXB5dGhvbkRlZmluaXRpb25Jc1VzZWQoZGVmaW5pdGlvbiwgdXNhZ2UpKSB7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgY29uc3QgdGV4dCA9IGFkZFB5dGhvblJhbmdlKGxpbmVzLCBmaWxlUGF0aCwgZGVmaW5pdGlvbiwgc3RhdGUsIHBhcnRzKTtcbiAgICAgIGlmICh0ZXh0KSB7XG4gICAgICAgIGNvbnN0IG5lc3RlZCA9IGF3YWl0IGNvbGxlY3RQeXRob25EZXBlbmRlbmNpZXMoc291cmNlLCBmaWxlUGF0aCwgZGVmaW5pdGlvbiwgdGV4dCwgaG9zdCwgc3RhdGUsIHBhcnRzKTtcbiAgICAgICAgaGF5c3RhY2sgKz0gYFxcbiR7dGV4dH1cXG5gO1xuICAgICAgICBpZiAobmVzdGVkKSB7XG4gICAgICAgICAgaGF5c3RhY2sgKz0gYFxcbiR7bmVzdGVkfVxcbmA7XG4gICAgICAgIH1cbiAgICAgICAgY29sbGVjdGVkICs9IGAke25lc3RlZH1cXG4ke3RleHR9XFxuYDtcbiAgICAgICAgY2hhbmdlZCA9IHRydWU7XG4gICAgICB9XG4gICAgfVxuXG4gICAgZm9yIChjb25zdCBpbXBvcnROb2RlIG9mIG1vZHVsZUluZm8uaW1wb3J0cykge1xuICAgICAgY29uc3QgdGV4dCA9IGF3YWl0IHJlc29sdmVQeXRob25JbXBvcnREZXBlbmRlbmN5KGltcG9ydE5vZGUsIGxpbmVzLCBmaWxlUGF0aCwgdXNhZ2UsIGhvc3QsIHN0YXRlLCBwYXJ0cyk7XG4gICAgICBpZiAodGV4dCkge1xuICAgICAgICBoYXlzdGFjayArPSBgXFxuJHt0ZXh0fVxcbmA7XG4gICAgICAgIGNvbGxlY3RlZCArPSBgJHt0ZXh0fVxcbmA7XG4gICAgICAgIGNoYW5nZWQgPSB0cnVlO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIHJldHVybiBjb2xsZWN0ZWQ7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIHJlc29sdmVQeXRob25JbXBvcnREZXBlbmRlbmN5KFxuICBpbXBvcnROb2RlOiBQeXRob25JbXBvcnQsXG4gIGxpbmVzOiBzdHJpbmdbXSxcbiAgZmlsZVBhdGg6IHN0cmluZyxcbiAgdXNhZ2U6IFB5dGhvblVzYWdlLFxuICBob3N0OiBsb29tU291cmNlRXh0cmFjdGlvbkhvc3QsXG4gIHN0YXRlOiBQeXRob25EZXBlbmRlbmN5U3RhdGUsXG4gIHBhcnRzOiBzdHJpbmdbXSxcbik6IFByb21pc2U8c3RyaW5nPiB7XG4gIGlmIChpbXBvcnROb2RlLmtpbmQgPT09IFwiZnJvbVwiKSB7XG4gICAgcmV0dXJuIHJlc29sdmVQeXRob25Gcm9tSW1wb3J0RGVwZW5kZW5jeShpbXBvcnROb2RlLCBsaW5lcywgZmlsZVBhdGgsIHVzYWdlLCBob3N0LCBzdGF0ZSwgcGFydHMpO1xuICB9XG5cbiAgcmV0dXJuIHJlc29sdmVQeXRob25QbGFpbkltcG9ydERlcGVuZGVuY3koaW1wb3J0Tm9kZSwgbGluZXMsIGZpbGVQYXRoLCB1c2FnZSwgaG9zdCwgc3RhdGUsIHBhcnRzKTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gcmVzb2x2ZVB5dGhvbkZyb21JbXBvcnREZXBlbmRlbmN5KFxuICBpbXBvcnROb2RlOiBQeXRob25JbXBvcnQsXG4gIGxpbmVzOiBzdHJpbmdbXSxcbiAgZmlsZVBhdGg6IHN0cmluZyxcbiAgdXNhZ2U6IFB5dGhvblVzYWdlLFxuICBob3N0OiBsb29tU291cmNlRXh0cmFjdGlvbkhvc3QsXG4gIHN0YXRlOiBQeXRob25EZXBlbmRlbmN5U3RhdGUsXG4gIHBhcnRzOiBzdHJpbmdbXSxcbik6IFByb21pc2U8c3RyaW5nPiB7XG4gIGNvbnN0IGxvY2FsTW9kdWxlUGF0aCA9IGF3YWl0IGhvc3QucmVzb2x2ZVB5dGhvbkltcG9ydChmaWxlUGF0aCwgaW1wb3J0Tm9kZS5tb2R1bGUsIGltcG9ydE5vZGUubGV2ZWwpO1xuICBsZXQgYWRkZWQgPSBcIlwiO1xuXG4gIGZvciAoY29uc3QgYWxpYXMgb2YgaW1wb3J0Tm9kZS5uYW1lcykge1xuICAgIGlmIChhbGlhcy5uYW1lID09PSBcIipcIikge1xuICAgICAgaWYgKCFsb2NhbE1vZHVsZVBhdGgpIHtcbiAgICAgICAgaWYgKHVzZXNVbmtub3duSW1wb3J0ZWROYW1lcyh1c2FnZSkgJiYgYWRkUHl0aG9uSW1wb3J0TGluZShsaW5lcywgaW1wb3J0Tm9kZSwgc3RhdGUpKSB7XG4gICAgICAgICAgYWRkZWQgKz0gYCR7cmVuZGVyUmFuZ2UobGluZXMsIGltcG9ydE5vZGUpfVxcbmA7XG4gICAgICAgIH1cbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG5cbiAgICAgIGNvbnN0IHNvdXJjZSA9IGF3YWl0IGhvc3QucmVhZEZpbGUobG9jYWxNb2R1bGVQYXRoKTtcbiAgICAgIGlmICghc291cmNlKSB7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgY29uc3QgbW9kdWxlSW5mbyA9IGF3YWl0IGluc3BlY3RQeXRob25Nb2R1bGUoc291cmNlLCBob3N0KTtcbiAgICAgIGZvciAoY29uc3QgZGVmaW5pdGlvbiBvZiBtb2R1bGVJbmZvLmRlZmluaXRpb25zKSB7XG4gICAgICAgIGlmICghcHl0aG9uRGVmaW5pdGlvbklzVXNlZChkZWZpbml0aW9uLCB1c2FnZSkpIHtcbiAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgfVxuICAgICAgICBhZGRlZCArPSBhd2FpdCBleHRyYWN0UHl0aG9uU3ltYm9sRnJvbUZpbGUobG9jYWxNb2R1bGVQYXRoLCBkZWZpbml0aW9uLm5hbWUsIGhvc3QsIHN0YXRlLCBwYXJ0cyk7XG4gICAgICB9XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICBjb25zdCBleHBvc2VkTmFtZSA9IGFsaWFzLmFzbmFtZSA/PyBhbGlhcy5uYW1lO1xuICAgIGlmICghdXNhZ2UubmFtZXMuaW5jbHVkZXMoZXhwb3NlZE5hbWUpKSB7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICBjb25zdCBzdWJtb2R1bGVQYXRoID0gYXdhaXQgaG9zdC5yZXNvbHZlUHl0aG9uSW1wb3J0KGZpbGVQYXRoLCBqb2luUHl0aG9uTW9kdWxlKGltcG9ydE5vZGUubW9kdWxlLCBhbGlhcy5uYW1lKSwgaW1wb3J0Tm9kZS5sZXZlbCk7XG4gICAgY29uc3QgaW1wb3J0VGFyZ2V0UGF0aCA9IGxvY2FsTW9kdWxlUGF0aCA/PyBzdWJtb2R1bGVQYXRoO1xuICAgIGlmICghaW1wb3J0VGFyZ2V0UGF0aCkge1xuICAgICAgaWYgKGFkZFB5dGhvbkltcG9ydExpbmUobGluZXMsIGltcG9ydE5vZGUsIHN0YXRlKSkge1xuICAgICAgICBhZGRlZCArPSBgJHtyZW5kZXJSYW5nZShsaW5lcywgaW1wb3J0Tm9kZSl9XFxuYDtcbiAgICAgIH1cbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cblxuICAgIGNvbnN0IGV4dHJhY3RlZCA9IGF3YWl0IGV4dHJhY3RQeXRob25TeW1ib2xGcm9tRmlsZShpbXBvcnRUYXJnZXRQYXRoLCBhbGlhcy5uYW1lLCBob3N0LCBzdGF0ZSwgcGFydHMpO1xuICAgIGlmIChleHRyYWN0ZWQpIHtcbiAgICAgIGFkZGVkICs9IGV4dHJhY3RlZDtcbiAgICAgIGlmIChhbGlhcy5hc25hbWUgJiYgYWxpYXMuYXNuYW1lICE9PSBhbGlhcy5uYW1lKSB7XG4gICAgICAgIGFkZGVkICs9IGFkZFB5dGhvbkFsaWFzKGFsaWFzLm5hbWUsIGFsaWFzLmFzbmFtZSwgc3RhdGUsIHBhcnRzKTtcbiAgICAgIH1cbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cblxuICAgIGNvbnN0IG1vZHVsZUJpbmRpbmcgPSBhbGlhcy5hc25hbWUgPz8gYWxpYXMubmFtZTtcbiAgICBjb25zdCBtb2R1bGVBdHRyaWJ1dGVzID0gdXNhZ2UuYXR0cmlidXRlc1ttb2R1bGVCaW5kaW5nXSA/PyBbXTtcbiAgICBpZiAoc3VibW9kdWxlUGF0aCAmJiBtb2R1bGVBdHRyaWJ1dGVzLmxlbmd0aCkge1xuICAgICAgZm9yIChjb25zdCBhdHRyaWJ1dGUgb2YgbW9kdWxlQXR0cmlidXRlcykge1xuICAgICAgICBhZGRlZCArPSBhd2FpdCBleHRyYWN0UHl0aG9uU3ltYm9sRnJvbUZpbGUoc3VibW9kdWxlUGF0aCwgYXR0cmlidXRlLCBob3N0LCBzdGF0ZSwgcGFydHMpO1xuICAgICAgICBhZGRQeXRob25OYW1lc3BhY2VCaW5kaW5nKG1vZHVsZUJpbmRpbmcsIGF0dHJpYnV0ZSwgc3RhdGUpO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIHJldHVybiBhZGRlZDtcbn1cblxuYXN5bmMgZnVuY3Rpb24gcmVzb2x2ZVB5dGhvblBsYWluSW1wb3J0RGVwZW5kZW5jeShcbiAgaW1wb3J0Tm9kZTogUHl0aG9uSW1wb3J0LFxuICBsaW5lczogc3RyaW5nW10sXG4gIGZpbGVQYXRoOiBzdHJpbmcsXG4gIHVzYWdlOiBQeXRob25Vc2FnZSxcbiAgaG9zdDogbG9vbVNvdXJjZUV4dHJhY3Rpb25Ib3N0LFxuICBzdGF0ZTogUHl0aG9uRGVwZW5kZW5jeVN0YXRlLFxuICBwYXJ0czogc3RyaW5nW10sXG4pOiBQcm9taXNlPHN0cmluZz4ge1xuICBsZXQgYWRkZWQgPSBcIlwiO1xuXG4gIGZvciAoY29uc3QgYWxpYXMgb2YgaW1wb3J0Tm9kZS5uYW1lcykge1xuICAgIGNvbnN0IGJpbmRpbmcgPSBhbGlhcy5hc25hbWUgPz8gYWxpYXMubmFtZS5zcGxpdChcIi5cIilbMF07XG4gICAgY29uc3QgdXNlZEF0dHJpYnV0ZXMgPSB1c2FnZS5hdHRyaWJ1dGVzW2JpbmRpbmddID8/IFtdO1xuICAgIGNvbnN0IGJpbmRpbmdJc1VzZWQgPSB1c2FnZS5uYW1lcy5pbmNsdWRlcyhiaW5kaW5nKSB8fCB1c2VkQXR0cmlidXRlcy5sZW5ndGggPiAwO1xuICAgIGlmICghYmluZGluZ0lzVXNlZCkge1xuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgY29uc3QgbG9jYWxNb2R1bGVQYXRoID0gYXdhaXQgaG9zdC5yZXNvbHZlUHl0aG9uSW1wb3J0KGZpbGVQYXRoLCBhbGlhcy5uYW1lLCAwKTtcbiAgICBpZiAoIWxvY2FsTW9kdWxlUGF0aCkge1xuICAgICAgaWYgKGFkZFB5dGhvbkltcG9ydExpbmUobGluZXMsIGltcG9ydE5vZGUsIHN0YXRlKSkge1xuICAgICAgICBhZGRlZCArPSBgJHtyZW5kZXJSYW5nZShsaW5lcywgaW1wb3J0Tm9kZSl9XFxuYDtcbiAgICAgIH1cbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cblxuICAgIGZvciAoY29uc3QgYXR0cmlidXRlIG9mIHVzZWRBdHRyaWJ1dGVzKSB7XG4gICAgICBhZGRlZCArPSBhd2FpdCBleHRyYWN0UHl0aG9uU3ltYm9sRnJvbUZpbGUobG9jYWxNb2R1bGVQYXRoLCBhdHRyaWJ1dGUsIGhvc3QsIHN0YXRlLCBwYXJ0cyk7XG4gICAgICBhZGRQeXRob25OYW1lc3BhY2VCaW5kaW5nKGJpbmRpbmcsIGF0dHJpYnV0ZSwgc3RhdGUpO1xuICAgIH1cbiAgfVxuXG4gIHJldHVybiBhZGRlZDtcbn1cblxuYXN5bmMgZnVuY3Rpb24gZXh0cmFjdFB5dGhvblN5bWJvbEZyb21GaWxlKFxuICBmaWxlUGF0aDogc3RyaW5nLFxuICBzeW1ib2xOYW1lOiBzdHJpbmcsXG4gIGhvc3Q6IGxvb21Tb3VyY2VFeHRyYWN0aW9uSG9zdCxcbiAgc3RhdGU6IFB5dGhvbkRlcGVuZGVuY3lTdGF0ZSxcbiAgcGFydHM6IHN0cmluZ1tdLFxuKTogUHJvbWlzZTxzdHJpbmc+IHtcbiAgY29uc3QgdmlzaXRLZXkgPSBgJHtmaWxlUGF0aH0jJHtzeW1ib2xOYW1lfWA7XG4gIGlmIChzdGF0ZS52aXNpdGluZ1N5bWJvbHMuaGFzKHZpc2l0S2V5KSkge1xuICAgIHJldHVybiBcIlwiO1xuICB9XG5cbiAgY29uc3Qgc291cmNlID0gYXdhaXQgaG9zdC5yZWFkRmlsZShmaWxlUGF0aCk7XG4gIGlmICghc291cmNlKSB7XG4gICAgcmV0dXJuIFwiXCI7XG4gIH1cblxuICBzdGF0ZS52aXNpdGluZ1N5bWJvbHMuYWRkKHZpc2l0S2V5KTtcbiAgdHJ5IHtcbiAgICBjb25zdCBsaW5lcyA9IHNvdXJjZS5zcGxpdCgvXFxyP1xcbi8pO1xuICAgIGNvbnN0IG1vZHVsZUluZm8gPSBhd2FpdCBpbnNwZWN0UHl0aG9uTW9kdWxlKHNvdXJjZSwgaG9zdCk7XG4gICAgY29uc3QgZGVmaW5pdGlvbiA9IG1vZHVsZUluZm8uZGVmaW5pdGlvbnMuZmluZCgoY2FuZGlkYXRlKSA9PiAoY2FuZGlkYXRlLm5hbWVzID8/IFtjYW5kaWRhdGUubmFtZV0pLmluY2x1ZGVzKHN5bWJvbE5hbWUpKTtcbiAgICBpZiAoIWRlZmluaXRpb24pIHtcbiAgICAgIHJldHVybiBcIlwiO1xuICAgIH1cblxuICAgIGNvbnN0IHRleHQgPSByZW5kZXJSYW5nZShsaW5lcywgZGVmaW5pdGlvbik7XG4gICAgY29uc3QgZGVwZW5kZW5jeVRleHQgPSBhd2FpdCBjb2xsZWN0UHl0aG9uRGVwZW5kZW5jaWVzKHNvdXJjZSwgZmlsZVBhdGgsIGRlZmluaXRpb24sIHRleHQsIGhvc3QsIHN0YXRlLCBwYXJ0cyk7XG4gICAgY29uc3QgYWRkZWQgPSBhZGRQeXRob25SYW5nZShsaW5lcywgZmlsZVBhdGgsIGRlZmluaXRpb24sIHN0YXRlLCBwYXJ0cyk7XG4gICAgcmV0dXJuIFtkZXBlbmRlbmN5VGV4dCwgYWRkZWRdLmZpbHRlcigocGFydCkgPT4gcGFydC50cmltKCkpLmpvaW4oXCJcXG5cIik7XG4gIH0gZmluYWxseSB7XG4gICAgc3RhdGUudmlzaXRpbmdTeW1ib2xzLmRlbGV0ZSh2aXNpdEtleSk7XG4gIH1cbn1cblxuZnVuY3Rpb24gYWRkUHl0aG9uUmFuZ2UoXG4gIGxpbmVzOiBzdHJpbmdbXSxcbiAgZmlsZVBhdGg6IHN0cmluZyxcbiAgcmFuZ2U6IFNvdXJjZVJhbmdlLFxuICBzdGF0ZTogUHl0aG9uRGVwZW5kZW5jeVN0YXRlLFxuICBwYXJ0czogc3RyaW5nW10sXG4pOiBzdHJpbmcge1xuICBjb25zdCBrZXkgPSBgJHtmaWxlUGF0aH06TCR7cmFuZ2Uuc3RhcnQgKyAxfS1MJHtyYW5nZS5lbmQgKyAxfWA7XG4gIGlmIChzdGF0ZS5pbmNsdWRlZFJhbmdlcy5oYXMoa2V5KSkge1xuICAgIHJldHVybiBcIlwiO1xuICB9XG4gIHN0YXRlLmluY2x1ZGVkUmFuZ2VzLmFkZChrZXkpO1xuICBjb25zdCB0ZXh0ID0gcmVuZGVyUmFuZ2UobGluZXMsIHJhbmdlKTtcbiAgcGFydHMucHVzaCh0ZXh0KTtcbiAgcmV0dXJuIHRleHQ7XG59XG5cbmZ1bmN0aW9uIGFkZFB5dGhvbkltcG9ydExpbmUobGluZXM6IHN0cmluZ1tdLCByYW5nZTogU291cmNlUmFuZ2UsIHN0YXRlOiBQeXRob25EZXBlbmRlbmN5U3RhdGUpOiBib29sZWFuIHtcbiAgY29uc3QgdGV4dCA9IHJlbmRlclJhbmdlKGxpbmVzLCByYW5nZSk7XG4gIGlmIChzdGF0ZS5pbmNsdWRlZEltcG9ydHMuaGFzKHRleHQpKSB7XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG4gIHN0YXRlLmluY2x1ZGVkSW1wb3J0cy5hZGQodGV4dCk7XG4gIHJldHVybiB0cnVlO1xufVxuXG5mdW5jdGlvbiBhZGRQeXRob25BbGlhcyhuYW1lOiBzdHJpbmcsIGFzbmFtZTogc3RyaW5nLCBzdGF0ZTogUHl0aG9uRGVwZW5kZW5jeVN0YXRlLCBwYXJ0czogc3RyaW5nW10pOiBzdHJpbmcge1xuICBjb25zdCBrZXkgPSBgJHthc25hbWV9PSR7bmFtZX1gO1xuICBpZiAoc3RhdGUuYWxpYXNlcy5oYXMoa2V5KSkge1xuICAgIHJldHVybiBcIlwiO1xuICB9XG4gIHN0YXRlLmFsaWFzZXMuYWRkKGtleSk7XG4gIGNvbnN0IHRleHQgPSBgJHthc25hbWV9ID0gJHtuYW1lfWA7XG4gIHBhcnRzLnB1c2godGV4dCk7XG4gIHJldHVybiBgJHt0ZXh0fVxcbmA7XG59XG5cbmZ1bmN0aW9uIGFkZFB5dGhvbk5hbWVzcGFjZUJpbmRpbmcoYmluZGluZzogc3RyaW5nLCBhdHRyaWJ1dGU6IHN0cmluZywgc3RhdGU6IFB5dGhvbkRlcGVuZGVuY3lTdGF0ZSk6IHZvaWQge1xuICBzdGF0ZS5uZWVkc05hbWVzcGFjZVJ1bnRpbWUgPSB0cnVlO1xuICBjb25zdCBhdHRyaWJ1dGVzID0gc3RhdGUubmFtZXNwYWNlQmluZGluZ3MuZ2V0KGJpbmRpbmcpID8/IG5ldyBTZXQ8c3RyaW5nPigpO1xuICBhdHRyaWJ1dGVzLmFkZChhdHRyaWJ1dGUpO1xuICBzdGF0ZS5uYW1lc3BhY2VCaW5kaW5ncy5zZXQoYmluZGluZywgYXR0cmlidXRlcyk7XG59XG5cbmZ1bmN0aW9uIHJlbmRlclB5dGhvbk5hbWVzcGFjZUJpbmRpbmdzKHN0YXRlOiBQeXRob25EZXBlbmRlbmN5U3RhdGUpOiBzdHJpbmcge1xuICBpZiAoIXN0YXRlLm5hbWVzcGFjZUJpbmRpbmdzLnNpemUpIHtcbiAgICByZXR1cm4gXCJcIjtcbiAgfVxuXG4gIGNvbnN0IGxpbmVzID0gc3RhdGUubmVlZHNOYW1lc3BhY2VSdW50aW1lID8gW1wiaW1wb3J0IHR5cGVzIGFzIF9sb29tX3R5cGVzXCJdIDogW107XG4gIGZvciAoY29uc3QgW2JpbmRpbmcsIGF0dHJpYnV0ZXNdIG9mIHN0YXRlLm5hbWVzcGFjZUJpbmRpbmdzKSB7XG4gICAgbGluZXMucHVzaChgJHtiaW5kaW5nfSA9IF9sb29tX3R5cGVzLlNpbXBsZU5hbWVzcGFjZSgpYCk7XG4gICAgZm9yIChjb25zdCBhdHRyaWJ1dGUgb2YgYXR0cmlidXRlcykge1xuICAgICAgbGluZXMucHVzaChgJHtiaW5kaW5nfS4ke2F0dHJpYnV0ZX0gPSAke2F0dHJpYnV0ZX1gKTtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIGxpbmVzLmpvaW4oXCJcXG5cIik7XG59XG5cbmZ1bmN0aW9uIGZpbmRQeXRob25TeW1ib2xSYW5nZShtb2R1bGVJbmZvOiBQeXRob25Nb2R1bGVJbmZvLCBzeW1ib2xOYW1lOiBzdHJpbmcpOiBTb3VyY2VSYW5nZSB8IG51bGwge1xuICBjb25zdCBleGFjdCA9IG1vZHVsZUluZm8uZGVmaW5pdGlvbnMuZmluZCgoZGVmaW5pdGlvbikgPT4gKGRlZmluaXRpb24ubmFtZXMgPz8gW2RlZmluaXRpb24ubmFtZV0pLmluY2x1ZGVzKHN5bWJvbE5hbWUpKTtcbiAgcmV0dXJuIGV4YWN0ID8geyBzdGFydDogZXhhY3Quc3RhcnQsIGVuZDogZXhhY3QuZW5kIH0gOiBudWxsO1xufVxuXG5mdW5jdGlvbiBweXRob25EZWZpbml0aW9uSXNVc2VkKGRlZmluaXRpb246IFNvdXJjZURlZmluaXRpb24sIHVzYWdlOiBQeXRob25Vc2FnZSk6IGJvb2xlYW4ge1xuICByZXR1cm4gKGRlZmluaXRpb24ubmFtZXMgPz8gW2RlZmluaXRpb24ubmFtZV0pLnNvbWUoKG5hbWUpID0+IHVzYWdlLm5hbWVzLmluY2x1ZGVzKG5hbWUpKTtcbn1cblxuZnVuY3Rpb24gdXNlc1Vua25vd25JbXBvcnRlZE5hbWVzKHVzYWdlOiBQeXRob25Vc2FnZSk6IGJvb2xlYW4ge1xuICByZXR1cm4gdXNhZ2UubmFtZXMubGVuZ3RoID4gMDtcbn1cblxuZnVuY3Rpb24gam9pblB5dGhvbk1vZHVsZShtb2R1bGVOYW1lOiBzdHJpbmcsIG5hbWU6IHN0cmluZyk6IHN0cmluZyB7XG4gIHJldHVybiBtb2R1bGVOYW1lID8gYCR7bW9kdWxlTmFtZX0uJHtuYW1lfWAgOiBuYW1lO1xufVxuXG5hc3luYyBmdW5jdGlvbiBpbnNwZWN0UHl0aG9uTW9kdWxlKHNvdXJjZTogc3RyaW5nLCBob3N0OiBsb29tU291cmNlRXh0cmFjdGlvbkhvc3QpOiBQcm9taXNlPFB5dGhvbk1vZHVsZUluZm8+IHtcbiAgcmV0dXJuIHJ1blB5dGhvbkFzdDxQeXRob25Nb2R1bGVJbmZvPihzb3VyY2UsIFwibW9kdWxlXCIsIGhvc3QpO1xufVxuXG5hc3luYyBmdW5jdGlvbiBpbnNwZWN0UHl0aG9uVXNhZ2Uoc291cmNlOiBzdHJpbmcsIGhvc3Q6IGxvb21Tb3VyY2VFeHRyYWN0aW9uSG9zdCk6IFByb21pc2U8UHl0aG9uVXNhZ2U+IHtcbiAgcmV0dXJuIHJ1blB5dGhvbkFzdDxQeXRob25Vc2FnZT4oc291cmNlLCBcInVzYWdlXCIsIGhvc3QpO1xufVxuXG5hc3luYyBmdW5jdGlvbiBydW5QeXRob25Bc3Q8VD4oc291cmNlOiBzdHJpbmcsIG1vZGU6IFwibW9kdWxlXCIgfCBcInVzYWdlXCIsIGhvc3Q6IGxvb21Tb3VyY2VFeHRyYWN0aW9uSG9zdCk6IFByb21pc2U8VD4ge1xuICBjb25zdCBjb21tYW5kID0gc3BsaXRDb21tYW5kTGluZShob3N0LnB5dGhvbkV4ZWN1dGFibGU/LnRyaW0oKSB8fCBcInB5dGhvbjNcIik7XG4gIGNvbnN0IGV4ZWN1dGFibGUgPSBjb21tYW5kWzBdID8/IFwicHl0aG9uM1wiO1xuICBjb25zdCBhcmdzID0gWy4uLmNvbW1hbmQuc2xpY2UoMSksIFwiLWNcIiwgUFlUSE9OX0FTVF9IRUxQRVJdO1xuXG4gIHJldHVybiBuZXcgUHJvbWlzZSgocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG4gICAgY29uc3QgY2hpbGQgPSBzcGF3bihleGVjdXRhYmxlLCBhcmdzLCB7IHN0ZGlvOiBbXCJwaXBlXCIsIFwicGlwZVwiLCBcInBpcGVcIl0gfSk7XG4gICAgbGV0IHN0ZG91dCA9IFwiXCI7XG4gICAgbGV0IHN0ZGVyciA9IFwiXCI7XG5cbiAgICBjaGlsZC5zdGRvdXQuc2V0RW5jb2RpbmcoXCJ1dGY4XCIpO1xuICAgIGNoaWxkLnN0ZGVyci5zZXRFbmNvZGluZyhcInV0ZjhcIik7XG4gICAgY2hpbGQuc3Rkb3V0Lm9uKFwiZGF0YVwiLCAoY2h1bms6IHN0cmluZykgPT4ge1xuICAgICAgc3Rkb3V0ICs9IGNodW5rO1xuICAgIH0pO1xuICAgIGNoaWxkLnN0ZGVyci5vbihcImRhdGFcIiwgKGNodW5rOiBzdHJpbmcpID0+IHtcbiAgICAgIHN0ZGVyciArPSBjaHVuaztcbiAgICB9KTtcbiAgICBjaGlsZC5vbihcImVycm9yXCIsIHJlamVjdCk7XG4gICAgY2hpbGQub24oXCJjbG9zZVwiLCAoY29kZSkgPT4ge1xuICAgICAgaWYgKGNvZGUgIT09IDApIHtcbiAgICAgICAgcmVqZWN0KG5ldyBFcnJvcigoc3RkZXJyIHx8IHN0ZG91dCB8fCBgUHl0aG9uIEFTVCBoZWxwZXIgZXhpdGVkIHdpdGggY29kZSAke2NvZGV9LmApLnRyaW0oKSkpO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG4gICAgICB0cnkge1xuICAgICAgICByZXNvbHZlKEpTT04ucGFyc2Uoc3Rkb3V0KSBhcyBUKTtcbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIHJlamVjdChlcnJvcik7XG4gICAgICB9XG4gICAgfSk7XG5cbiAgICBjaGlsZC5zdGRpbi5lbmQoSlNPTi5zdHJpbmdpZnkoeyBtb2RlLCBzb3VyY2UgfSkpO1xuICB9KTtcbn1cblxuZnVuY3Rpb24gZmluZExpbmVSYW5nZShsaW5lczogc3RyaW5nW10sIHJlZmVyZW5jZTogbG9vbVNvdXJjZVJlZmVyZW5jZSk6IFNvdXJjZVJhbmdlIHwgbnVsbCB7XG4gIGNvbnN0IHN0YXJ0ID0gTWF0aC5tYXgoKHJlZmVyZW5jZS5saW5lU3RhcnQgPz8gMSkgLSAxLCAwKTtcbiAgY29uc3QgZW5kID0gTWF0aC5taW4oKHJlZmVyZW5jZS5saW5lRW5kID8/IHJlZmVyZW5jZS5saW5lU3RhcnQgPz8gbGluZXMubGVuZ3RoKSAtIDEsIGxpbmVzLmxlbmd0aCAtIDEpO1xuICBpZiAoc3RhcnQgPiBlbmQgfHwgc3RhcnQgPj0gbGluZXMubGVuZ3RoKSB7XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cbiAgcmV0dXJuIHsgc3RhcnQsIGVuZCB9O1xufVxuXG5mdW5jdGlvbiBmaW5kU3ltYm9sUmFuZ2UobGluZXM6IHN0cmluZ1tdLCBsYW5ndWFnZTogbG9vbU5vcm1hbGl6ZWRMYW5ndWFnZSwgc3ltYm9sTmFtZTogc3RyaW5nKTogU291cmNlUmFuZ2UgfCBudWxsIHtcbiAgY29uc3QgZGVmaW5pdGlvbnMgPSBjb2xsZWN0RGVmaW5pdGlvbnMobGluZXMsIGxhbmd1YWdlKTtcbiAgY29uc3QgZXhhY3QgPSBkZWZpbml0aW9ucy5maW5kKChkZWZpbml0aW9uKSA9PiBkZWZpbml0aW9uTmFtZXMoZGVmaW5pdGlvbikuaW5jbHVkZXMoc3ltYm9sTmFtZSkpO1xuICBpZiAoZXhhY3QpIHtcbiAgICByZXR1cm4geyBzdGFydDogZXhhY3Quc3RhcnQsIGVuZDogZXhhY3QuZW5kIH07XG4gIH1cblxuICBjb25zdCBzeW1ib2xQYXR0ZXJuID0gbmV3IFJlZ0V4cChgXFxcXGIke2VzY2FwZVJlZ2V4KHN5bWJvbE5hbWUpfVxcXFxiYCk7XG4gIGNvbnN0IGxpbmUgPSBsaW5lcy5maW5kSW5kZXgoKGNhbmRpZGF0ZSkgPT4gc3ltYm9sUGF0dGVybi50ZXN0KGNhbmRpZGF0ZSkpO1xuICBpZiAobGluZSA8IDApIHtcbiAgICByZXR1cm4gbnVsbDtcbiAgfVxuICByZXR1cm4gbGluZXNbbGluZV0uaW5jbHVkZXMoXCJ7XCIpID8geyBzdGFydDogbGluZSwgZW5kOiBmaW5kQnJhY2VSYW5nZUVuZChsaW5lcywgbGluZSkgfSA6IHsgc3RhcnQ6IGxpbmUsIGVuZDogbGluZSB9O1xufVxuXG5mdW5jdGlvbiBjb2xsZWN0RGVwZW5kZW5jeVNvdXJjZShsaW5lczogc3RyaW5nW10sIGxhbmd1YWdlOiBsb29tTm9ybWFsaXplZExhbmd1YWdlLCBzZWxlY3RlZFJhbmdlOiBTb3VyY2VSYW5nZSwgc2VsZWN0ZWQ6IHN0cmluZyk6IHN0cmluZyB7XG4gIGNvbnN0IHByb2xvZ3VlID0gY29sbGVjdFByb2xvZ3VlKGxpbmVzLCBsYW5ndWFnZSwgc2VsZWN0ZWRSYW5nZS5zdGFydCk7XG4gIGNvbnN0IGRlZmluaXRpb25zID0gY29sbGVjdERlZmluaXRpb25zKGxpbmVzLCBsYW5ndWFnZSlcbiAgICAuZmlsdGVyKChkZWZpbml0aW9uKSA9PiAhcmFuZ2VzT3ZlcmxhcChkZWZpbml0aW9uLCBzZWxlY3RlZFJhbmdlKSk7XG4gIGNvbnN0IHNlbGVjdGVkRGVmaW5pdGlvbnMgPSB0cmFjZURlZmluaXRpb25zKHNlbGVjdGVkLCBkZWZpbml0aW9ucywgbGluZXMpO1xuICByZXR1cm4gWy4uLnByb2xvZ3VlLCAuLi5zZWxlY3RlZERlZmluaXRpb25zLm1hcCgoZGVmaW5pdGlvbikgPT4gcmVuZGVyUmFuZ2UobGluZXMsIGRlZmluaXRpb24pKV1cbiAgICAuZmlsdGVyKChwYXJ0KSA9PiBwYXJ0LnRyaW0oKSlcbiAgICAuam9pbihcIlxcblxcblwiKTtcbn1cblxuZnVuY3Rpb24gdHJhY2VEZWZpbml0aW9ucyhzZWVkOiBzdHJpbmcsIGRlZmluaXRpb25zOiBTb3VyY2VEZWZpbml0aW9uW10sIGxpbmVzOiBzdHJpbmdbXSk6IFNvdXJjZURlZmluaXRpb25bXSB7XG4gIGNvbnN0IHNlbGVjdGVkOiBTb3VyY2VEZWZpbml0aW9uW10gPSBbXTtcbiAgY29uc3Qgc2VsZWN0ZWRLZXlzID0gbmV3IFNldDxzdHJpbmc+KCk7XG4gIGxldCBoYXlzdGFjayA9IHNlZWQ7XG4gIGxldCBjaGFuZ2VkID0gdHJ1ZTtcblxuICB3aGlsZSAoY2hhbmdlZCkge1xuICAgIGNoYW5nZWQgPSBmYWxzZTtcbiAgICBmb3IgKGNvbnN0IGRlZmluaXRpb24gb2YgZGVmaW5pdGlvbnMpIHtcbiAgICAgIGNvbnN0IGtleSA9IGAke2RlZmluaXRpb24uc3RhcnR9OiR7ZGVmaW5pdGlvbi5lbmR9OiR7ZGVmaW5pdGlvbi5uYW1lfWA7XG4gICAgICBpZiAoc2VsZWN0ZWRLZXlzLmhhcyhrZXkpKSB7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgaWYgKCFkZWZpbml0aW9uTmFtZXMoZGVmaW5pdGlvbikuc29tZSgobmFtZSkgPT4gc291cmNlVXNlc05hbWUoaGF5c3RhY2ssIG5hbWUpKSkge1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIHNlbGVjdGVkS2V5cy5hZGQoa2V5KTtcbiAgICAgIHNlbGVjdGVkLnB1c2goZGVmaW5pdGlvbik7XG4gICAgICBoYXlzdGFjayArPSBgXFxuJHtyZW5kZXJSYW5nZShsaW5lcywgZGVmaW5pdGlvbil9XFxuYDtcbiAgICAgIGNoYW5nZWQgPSB0cnVlO1xuICAgIH1cbiAgfVxuXG4gIHJldHVybiBzZWxlY3RlZC5zb3J0KChsZWZ0LCByaWdodCkgPT4gbGVmdC5zdGFydCAtIHJpZ2h0LnN0YXJ0KTtcbn1cblxuZnVuY3Rpb24gY29sbGVjdFByb2xvZ3VlKGxpbmVzOiBzdHJpbmdbXSwgbGFuZ3VhZ2U6IGxvb21Ob3JtYWxpemVkTGFuZ3VhZ2UsIGJlZm9yZUxpbmU6IG51bWJlcik6IHN0cmluZ1tdIHtcbiAgY29uc3QgcHJvbG9ndWU6IHN0cmluZ1tdID0gW107XG4gIGNvbnN0IG1heCA9IE1hdGgubWF4KGJlZm9yZUxpbmUsIDApO1xuICBmb3IgKGxldCBpbmRleCA9IDA7IGluZGV4IDwgbWF4OyBpbmRleCArPSAxKSB7XG4gICAgY29uc3QgbGluZSA9IGxpbmVzW2luZGV4XTtcbiAgICBpZiAoaXNQcm9sb2d1ZUxpbmUobGluZSwgbGFuZ3VhZ2UpKSB7XG4gICAgICBwcm9sb2d1ZS5wdXNoKGxpbmUpO1xuICAgIH1cbiAgfVxuICByZXR1cm4gcHJvbG9ndWUubGVuZ3RoID8gW3Byb2xvZ3VlLmpvaW4oXCJcXG5cIildIDogW107XG59XG5cbmZ1bmN0aW9uIGlzUHJvbG9ndWVMaW5lKGxpbmU6IHN0cmluZywgbGFuZ3VhZ2U6IGxvb21Ob3JtYWxpemVkTGFuZ3VhZ2UpOiBib29sZWFuIHtcbiAgY29uc3QgdHJpbW1lZCA9IGxpbmUudHJpbSgpO1xuICBpZiAoIXRyaW1tZWQpIHtcbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cbiAgc3dpdGNoIChsYW5ndWFnZSkge1xuICAgIGNhc2UgXCJweXRob25cIjpcbiAgICAgIHJldHVybiAvXihmcm9tXFxzK1xcUytcXHMraW1wb3J0XFxzK3xpbXBvcnRcXHMrKS8udGVzdCh0cmltbWVkKTtcbiAgICBjYXNlIFwiamF2YXNjcmlwdFwiOlxuICAgIGNhc2UgXCJ0eXBlc2NyaXB0XCI6XG4gICAgICByZXR1cm4gL14oaW1wb3J0XFxzK3xleHBvcnRcXHMrLipcXHMrZnJvbVxccyt8KD86Y29uc3R8bGV0fHZhcilcXHMrXFx3K1xccyo9XFxzKnJlcXVpcmVcXHMqXFwoKS8udGVzdCh0cmltbWVkKTtcbiAgICBjYXNlIFwiY1wiOlxuICAgIGNhc2UgXCJjcHBcIjpcbiAgICBjYXNlIFwibGx2bS1pclwiOlxuICAgICAgcmV0dXJuIHRyaW1tZWQuc3RhcnRzV2l0aChcIiNcIikgfHwgdHJpbW1lZC5zdGFydHNXaXRoKFwidGFyZ2V0IFwiKSB8fCB0cmltbWVkLnN0YXJ0c1dpdGgoXCJzb3VyY2VfZmlsZW5hbWVcIik7XG4gICAgY2FzZSBcImhhc2tlbGxcIjpcbiAgICAgIHJldHVybiAvXihtb2R1bGVcXHMrfGltcG9ydFxccyspLy50ZXN0KHRyaW1tZWQpO1xuICAgIGNhc2UgXCJvY2FtbFwiOlxuICAgICAgcmV0dXJuIC9eKG9wZW5cXHMrfGluY2x1ZGVcXHMrfCN1c2VcXHMrKS8udGVzdCh0cmltbWVkKTtcbiAgICBjYXNlIFwiamF2YVwiOlxuICAgICAgcmV0dXJuIC9eKHBhY2thZ2VcXHMrfGltcG9ydFxccyspLy50ZXN0KHRyaW1tZWQpO1xuICAgIGRlZmF1bHQ6XG4gICAgICByZXR1cm4gZmFsc2U7XG4gIH1cbn1cblxuZnVuY3Rpb24gY29sbGVjdERlZmluaXRpb25zKGxpbmVzOiBzdHJpbmdbXSwgbGFuZ3VhZ2U6IGxvb21Ob3JtYWxpemVkTGFuZ3VhZ2UpOiBTb3VyY2VEZWZpbml0aW9uW10ge1xuICBzd2l0Y2ggKGxhbmd1YWdlKSB7XG4gICAgY2FzZSBcInB5dGhvblwiOlxuICAgICAgcmV0dXJuIGNvbGxlY3RQeXRob25EZWZpbml0aW9ucyhsaW5lcyk7XG4gICAgY2FzZSBcImphdmFzY3JpcHRcIjpcbiAgICBjYXNlIFwidHlwZXNjcmlwdFwiOlxuICAgICAgcmV0dXJuIGNvbGxlY3RCcmFjZURlZmluaXRpb25zKGxpbmVzLCAvXig/OmV4cG9ydFxccyspPyg/OmFzeW5jXFxzKyk/ZnVuY3Rpb25cXHMrKFtBLVphLXpfJF1bXFx3JF0qKVxcYnxeKD86ZXhwb3J0XFxzKyk/Y2xhc3NcXHMrKFtBLVphLXpfJF1bXFx3JF0qKVxcYnxeKD86ZXhwb3J0XFxzKyk/KD86Y29uc3R8bGV0fHZhcilcXHMrKFtBLVphLXpfJF1bXFx3JF0qKVxccyo9Lyk7XG4gICAgY2FzZSBcImNcIjpcbiAgICAgIHJldHVybiBjb2xsZWN0Q0RlZmluaXRpb25zKGxpbmVzLCBmYWxzZSk7XG4gICAgY2FzZSBcImNwcFwiOlxuICAgICAgcmV0dXJuIGNvbGxlY3RDRGVmaW5pdGlvbnMobGluZXMsIHRydWUpO1xuICAgIGNhc2UgXCJoYXNrZWxsXCI6XG4gICAgICByZXR1cm4gY29sbGVjdEhhc2tlbGxEZWZpbml0aW9ucyhsaW5lcyk7XG4gICAgY2FzZSBcIm9jYW1sXCI6XG4gICAgICByZXR1cm4gY29sbGVjdE9jYW1sRGVmaW5pdGlvbnMobGluZXMpO1xuICAgIGNhc2UgXCJqYXZhXCI6XG4gICAgICByZXR1cm4gY29sbGVjdEJyYWNlRGVmaW5pdGlvbnMobGluZXMsIC9eXFxzKig/OnB1YmxpY3xwcml2YXRlfHByb3RlY3RlZHxzdGF0aWN8ZmluYWx8YWJzdHJhY3R8XFxzKSpcXHMqKD86Y2xhc3N8aW50ZXJmYWNlfGVudW18cmVjb3JkKVxccysoW0EtWmEtel9dXFx3KilcXGJ8XlxccyooPzpwdWJsaWN8cHJpdmF0ZXxwcm90ZWN0ZWR8c3RhdGljfGZpbmFsfHN5bmNocm9uaXplZHxuYXRpdmV8XFxzKStbXFx3PD5cXFtcXF0sLj9dK1xccysoW0EtWmEtel9dXFx3KilcXHMqXFwoW147XSpcXClcXHMqXFx7Lyk7XG4gICAgY2FzZSBcImxsdm0taXJcIjpcbiAgICAgIHJldHVybiBjb2xsZWN0TGx2bURlZmluaXRpb25zKGxpbmVzKTtcbiAgICBkZWZhdWx0OlxuICAgICAgcmV0dXJuIFtdO1xuICB9XG59XG5cbmZ1bmN0aW9uIGNvbGxlY3RQeXRob25EZWZpbml0aW9ucyhsaW5lczogc3RyaW5nW10pOiBTb3VyY2VEZWZpbml0aW9uW10ge1xuICBjb25zdCBkZWZpbml0aW9uczogU291cmNlRGVmaW5pdGlvbltdID0gW107XG4gIGZvciAobGV0IGluZGV4ID0gMDsgaW5kZXggPCBsaW5lcy5sZW5ndGg7IGluZGV4ICs9IDEpIHtcbiAgICBjb25zdCBhc3NpZ25tZW50ID0gbGluZXNbaW5kZXhdLm1hdGNoKC9eKFtBLVphLXpfXVxcdyopXFxzKls6PV0vKTtcbiAgICBpZiAoYXNzaWdubWVudCkge1xuICAgICAgZGVmaW5pdGlvbnMucHVzaCh7IG5hbWU6IGFzc2lnbm1lbnRbMV0sIHN0YXJ0OiBpbmRleCwgZW5kOiBpbmRleCB9KTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cblxuICAgIGNvbnN0IG1hdGNoID0gbGluZXNbaW5kZXhdLm1hdGNoKC9eKFxccyopKD86YXN5bmNcXHMrKT8oPzpkZWZ8Y2xhc3MpXFxzKyhbQS1aYS16X11cXHcqKVxcYi8pO1xuICAgIGlmICghbWF0Y2gpIHtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBjb25zdCBpbmRlbnQgPSBtYXRjaFsxXS5sZW5ndGg7XG4gICAgbGV0IHN0YXJ0ID0gaW5kZXg7XG4gICAgd2hpbGUgKHN0YXJ0ID4gMCAmJiBsaW5lc1tzdGFydCAtIDFdLnRyaW0oKS5zdGFydHNXaXRoKFwiQFwiKSAmJiBnZXRJbmRlbnQobGluZXNbc3RhcnQgLSAxXSkgPT09IGluZGVudCkge1xuICAgICAgc3RhcnQgLT0gMTtcbiAgICB9XG4gICAgbGV0IGVuZCA9IGluZGV4O1xuICAgIGZvciAobGV0IGN1cnNvciA9IGluZGV4ICsgMTsgY3Vyc29yIDwgbGluZXMubGVuZ3RoOyBjdXJzb3IgKz0gMSkge1xuICAgICAgaWYgKGxpbmVzW2N1cnNvcl0udHJpbSgpICYmIGdldEluZGVudChsaW5lc1tjdXJzb3JdKSA8PSBpbmRlbnQpIHtcbiAgICAgICAgYnJlYWs7XG4gICAgICB9XG4gICAgICBlbmQgPSBjdXJzb3I7XG4gICAgfVxuICAgIGRlZmluaXRpb25zLnB1c2goeyBuYW1lOiBtYXRjaFsyXSwgc3RhcnQsIGVuZCB9KTtcbiAgfVxuICByZXR1cm4gZGVmaW5pdGlvbnM7XG59XG5cbmZ1bmN0aW9uIGNvbGxlY3RDRGVmaW5pdGlvbnMobGluZXM6IHN0cmluZ1tdLCBpc0NwcDogYm9vbGVhbik6IFNvdXJjZURlZmluaXRpb25bXSB7XG4gIGNvbnN0IGRlZmluaXRpb25zOiBTb3VyY2VEZWZpbml0aW9uW10gPSBbXTtcbiAgbGV0IGRlcHRoID0gMDtcblxuICBmb3IgKGxldCBpbmRleCA9IDA7IGluZGV4IDwgbGluZXMubGVuZ3RoOyBpbmRleCArPSAxKSB7XG4gICAgY29uc3QgbGluZSA9IGxpbmVzW2luZGV4XTtcbiAgICBjb25zdCB0cmltbWVkID0gbGluZS50cmltKCk7XG4gICAgY29uc3QgdG9wTGV2ZWwgPSBkZXB0aCA9PT0gMDtcblxuICAgIGlmICh0b3BMZXZlbCAmJiB0cmltbWVkKSB7XG4gICAgICBjb25zdCBtYWNybyA9IHRyaW1tZWQubWF0Y2goL14jXFxzKmRlZmluZVxccysoW0EtWmEtel9dXFx3KilcXGIvKTtcbiAgICAgIGlmIChtYWNybykge1xuICAgICAgICBkZWZpbml0aW9ucy5wdXNoKHsgbmFtZTogbWFjcm9bMV0sIHN0YXJ0OiBpbmRleCwgZW5kOiBpbmRleCB9KTtcbiAgICAgIH0gZWxzZSBpZiAoIXRyaW1tZWQuc3RhcnRzV2l0aChcIiNcIikgJiYgIWlzQ0NvbW1lbnRMaW5lKHRyaW1tZWQpKSB7XG4gICAgICAgIGNvbnN0IHR5cGVEZWZpbml0aW9uID0gbWF0Y2hDVHlwZURlZmluaXRpb24obGluZXMsIGluZGV4LCBpc0NwcCk7XG4gICAgICAgIGlmICh0eXBlRGVmaW5pdGlvbikge1xuICAgICAgICAgIGRlZmluaXRpb25zLnB1c2godHlwZURlZmluaXRpb24pO1xuICAgICAgICAgIGluZGV4ID0gTWF0aC5tYXgoaW5kZXgsIHR5cGVEZWZpbml0aW9uLmVuZCk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgY29uc3QgZnVuY3Rpb25EZWZpbml0aW9uID0gbWF0Y2hDRnVuY3Rpb25EZWZpbml0aW9uKGxpbmVzLCBpbmRleCk7XG4gICAgICAgICAgaWYgKGZ1bmN0aW9uRGVmaW5pdGlvbikge1xuICAgICAgICAgICAgZGVmaW5pdGlvbnMucHVzaChmdW5jdGlvbkRlZmluaXRpb24pO1xuICAgICAgICAgICAgaW5kZXggPSBNYXRoLm1heChpbmRleCwgZnVuY3Rpb25EZWZpbml0aW9uLmVuZCk7XG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIGNvbnN0IGdsb2JhbERlZmluaXRpb24gPSBtYXRjaENHbG9iYWxEZWZpbml0aW9uKGxpbmUsIGluZGV4KTtcbiAgICAgICAgICAgIGlmIChnbG9iYWxEZWZpbml0aW9uKSB7XG4gICAgICAgICAgICAgIGRlZmluaXRpb25zLnB1c2goZ2xvYmFsRGVmaW5pdGlvbik7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuXG4gICAgZGVwdGggKz0gYnJhY2VEZWx0YShsaW5lKTtcbiAgICBpZiAoZGVwdGggPCAwKSB7XG4gICAgICBkZXB0aCA9IDA7XG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIGRlZmluaXRpb25zO1xufVxuXG5mdW5jdGlvbiBtYXRjaENUeXBlRGVmaW5pdGlvbihsaW5lczogc3RyaW5nW10sIHN0YXJ0OiBudW1iZXIsIGlzQ3BwOiBib29sZWFuKTogU291cmNlRGVmaW5pdGlvbiB8IG51bGwge1xuICBjb25zdCBoZWFkZXIgPSBsaW5lcy5zbGljZShzdGFydCwgTWF0aC5taW4obGluZXMubGVuZ3RoLCBzdGFydCArIDgpKS5qb2luKFwiIFwiKTtcbiAgY29uc3Qga2V5d29yZFBhdHRlcm4gPSBpc0NwcCA/IFwiKD86dHlwZWRlZlxcXFxzKyk/KD86c3RydWN0fGNsYXNzfGVudW18dW5pb24pXCIgOiBcIig/OnR5cGVkZWZcXFxccyspPyg/OnN0cnVjdHxlbnVtfHVuaW9uKVwiO1xuICBjb25zdCBuYW1lZCA9IGhlYWRlci5tYXRjaChuZXcgUmVnRXhwKGBeXFxcXHMqJHtrZXl3b3JkUGF0dGVybn1cXFxccysoW0EtWmEtel9dXFxcXHcqKVxcXFxiYCkpO1xuICBjb25zdCBhbm9ueW1vdXNUeXBlZGVmID0gaGVhZGVyLm1hdGNoKC9eXFxzKnR5cGVkZWZcXHMrKD86c3RydWN0fGVudW18dW5pb24pXFxiW1xcc1xcU10qP1xcfVxccyooW0EtWmEtel9dXFx3KilcXHMqOy8pO1xuICBjb25zdCBuYW1lID0gbmFtZWQ/LlsxXSA/PyBhbm9ueW1vdXNUeXBlZGVmPy5bMV07XG4gIGlmICghbmFtZSkge1xuICAgIHJldHVybiBudWxsO1xuICB9XG5cbiAgY29uc3QgZW5kID0gZmluZENEZWNsYXJhdGlvbkVuZChsaW5lcywgc3RhcnQpO1xuICByZXR1cm4geyBuYW1lLCBuYW1lczogW25hbWVdLCBzdGFydCwgZW5kIH07XG59XG5cbmZ1bmN0aW9uIG1hdGNoQ0Z1bmN0aW9uRGVmaW5pdGlvbihsaW5lczogc3RyaW5nW10sIHN0YXJ0OiBudW1iZXIpOiBTb3VyY2VEZWZpbml0aW9uIHwgbnVsbCB7XG4gIGNvbnN0IGhlYWRlckxpbmVzID0gbGluZXMuc2xpY2Uoc3RhcnQsIE1hdGgubWluKGxpbmVzLmxlbmd0aCwgc3RhcnQgKyAxMikpO1xuICBjb25zdCBqb2luZWQgPSBoZWFkZXJMaW5lcy5qb2luKFwiIFwiKTtcbiAgY29uc3QgYnJhY2VPZmZzZXQgPSBoZWFkZXJMaW5lcy5maW5kSW5kZXgoKGxpbmUpID0+IGxpbmUuaW5jbHVkZXMoXCJ7XCIpKTtcbiAgaWYgKGJyYWNlT2Zmc2V0IDwgMCB8fCBqb2luZWQuaW5kZXhPZihcIjtcIikgPj0gMCAmJiBqb2luZWQuaW5kZXhPZihcIjtcIikgPCBqb2luZWQuaW5kZXhPZihcIntcIikpIHtcbiAgICByZXR1cm4gbnVsbDtcbiAgfVxuXG4gIGNvbnN0IG1hdGNoZXMgPSBbLi4uam9pbmVkLm1hdGNoQWxsKC8oW0EtWmEtel9dXFx3Kig/Ojo6W0EtWmEtel9dXFx3Kik/fG9wZXJhdG9yXFxzKlteXFxzKF0rKVxccypcXChbXjt7fV0qXFwpXFxzKig/OmNvbnN0XFxiW157fV0qKT8oPzpub2V4Y2VwdFxcYltee31dKik/KD86LT5cXHMqW157fV0rKT9cXHsvZyldO1xuICBjb25zdCBuYW1lID0gbWF0Y2hlc1swXT8uWzFdPy5yZXBsYWNlKC9cXHMrL2csIFwiXCIpO1xuICBpZiAoIW5hbWUgfHwgaXNDQ29udHJvbEtleXdvcmQobmFtZSkpIHtcbiAgICByZXR1cm4gbnVsbDtcbiAgfVxuXG4gIGNvbnN0IGJyYWNlTGluZSA9IHN0YXJ0ICsgYnJhY2VPZmZzZXQ7XG4gIGNvbnN0IHNob3J0TmFtZSA9IG5hbWUuaW5jbHVkZXMoXCI6OlwiKSA/IG5hbWUuc3BsaXQoXCI6OlwiKS5wb3AoKSA/PyBuYW1lIDogbmFtZTtcbiAgcmV0dXJuIHtcbiAgICBuYW1lOiBzaG9ydE5hbWUsXG4gICAgbmFtZXM6IFsuLi5uZXcgU2V0KFtzaG9ydE5hbWUsIG5hbWVdKV0sXG4gICAgc3RhcnQsXG4gICAgZW5kOiBmaW5kQnJhY2VSYW5nZUVuZChsaW5lcywgYnJhY2VMaW5lKSxcbiAgfTtcbn1cblxuZnVuY3Rpb24gbWF0Y2hDR2xvYmFsRGVmaW5pdGlvbihsaW5lOiBzdHJpbmcsIGluZGV4OiBudW1iZXIpOiBTb3VyY2VEZWZpbml0aW9uIHwgbnVsbCB7XG4gIGNvbnN0IHRyaW1tZWQgPSBsaW5lLnRyaW0oKTtcbiAgaWYgKCF0cmltbWVkLmVuZHNXaXRoKFwiO1wiKSB8fCB0cmltbWVkLmluY2x1ZGVzKFwiKFwiKSB8fCAvXihyZXR1cm58dXNpbmd8bmFtZXNwYWNlfHRlbXBsYXRlKVxcYi8udGVzdCh0cmltbWVkKSkge1xuICAgIHJldHVybiBudWxsO1xuICB9XG5cbiAgY29uc3Qgd2l0aG91dEluaXRpYWxpemVyID0gdHJpbW1lZC5zcGxpdChcIj1cIilbMF0ucmVwbGFjZSgvXFxbW15cXF1dKl0vZywgXCJcIik7XG4gIGNvbnN0IG1hdGNoID0gd2l0aG91dEluaXRpYWxpemVyLm1hdGNoKC8oW0EtWmEtel9dXFx3KilcXHMqKD86Wyw7XXwkKS9nKT8ucG9wKCk/Lm1hdGNoKC8oW0EtWmEtel9dXFx3KikvKTtcbiAgY29uc3QgbmFtZSA9IG1hdGNoPy5bMV07XG4gIGlmICghbmFtZSB8fCAvXihjb25zdHxzdGF0aWN8ZXh0ZXJufHZvbGF0aWxlfHVuc2lnbmVkfHNpZ25lZHxsb25nfHNob3J0fGludHxjaGFyfGZsb2F0fGRvdWJsZXx2b2lkfGF1dG8pJC8udGVzdChuYW1lKSkge1xuICAgIHJldHVybiBudWxsO1xuICB9XG5cbiAgcmV0dXJuIHsgbmFtZSwgc3RhcnQ6IGluZGV4LCBlbmQ6IGluZGV4IH07XG59XG5cbmZ1bmN0aW9uIGNvbGxlY3RMbHZtRGVmaW5pdGlvbnMobGluZXM6IHN0cmluZ1tdKTogU291cmNlRGVmaW5pdGlvbltdIHtcbiAgY29uc3QgZGVmaW5pdGlvbnM6IFNvdXJjZURlZmluaXRpb25bXSA9IFtdO1xuICBmb3IgKGxldCBpbmRleCA9IDA7IGluZGV4IDwgbGluZXMubGVuZ3RoOyBpbmRleCArPSAxKSB7XG4gICAgY29uc3QgbGluZSA9IGxpbmVzW2luZGV4XTtcbiAgICBjb25zdCBzeW1ib2wgPSBsaW5lLm1hdGNoKC9eXFxzKig/OmRlZmluZXxkZWNsYXJlKVxcYi4qQChbQS1aYS16JC5fLV1bQS1aYS16JC5fMC05LV0qKVxccypcXCgvKTtcbiAgICBpZiAoc3ltYm9sKSB7XG4gICAgICBjb25zdCBlbmQgPSBsaW5lLnRyaW1TdGFydCgpLnN0YXJ0c1dpdGgoXCJkZWZpbmVcIikgPyBmaW5kQnJhY2VSYW5nZUVuZChsaW5lcywgaW5kZXgpIDogaW5kZXg7XG4gICAgICBkZWZpbml0aW9ucy5wdXNoKHsgbmFtZTogc3ltYm9sWzFdLCBuYW1lczogW3N5bWJvbFsxXSwgYEAke3N5bWJvbFsxXX1gXSwgc3RhcnQ6IGluZGV4LCBlbmQgfSk7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICBjb25zdCBnbG9iYWwgPSBsaW5lLm1hdGNoKC9eXFxzKkAoW0EtWmEteiQuXy1dW0EtWmEteiQuXzAtOS1dKilcXHMqPS8pO1xuICAgIGlmIChnbG9iYWwpIHtcbiAgICAgIGRlZmluaXRpb25zLnB1c2goeyBuYW1lOiBnbG9iYWxbMV0sIG5hbWVzOiBbZ2xvYmFsWzFdLCBgQCR7Z2xvYmFsWzFdfWBdLCBzdGFydDogaW5kZXgsIGVuZDogaW5kZXggfSk7XG4gICAgfVxuICB9XG4gIHJldHVybiBkZWZpbml0aW9ucztcbn1cblxuZnVuY3Rpb24gY29sbGVjdEhhc2tlbGxEZWZpbml0aW9ucyhsaW5lczogc3RyaW5nW10pOiBTb3VyY2VEZWZpbml0aW9uW10ge1xuICBjb25zdCBkZWZpbml0aW9uczogU291cmNlRGVmaW5pdGlvbltdID0gW107XG4gIGZvciAobGV0IGluZGV4ID0gMDsgaW5kZXggPCBsaW5lcy5sZW5ndGg7IGluZGV4ICs9IDEpIHtcbiAgICBjb25zdCB0cmltbWVkID0gbGluZXNbaW5kZXhdLnRyaW0oKTtcbiAgICBpZiAoIXRyaW1tZWQgfHwgZ2V0SW5kZW50KGxpbmVzW2luZGV4XSkgPiAwIHx8IC9eKG1vZHVsZXxpbXBvcnQpXFxiLy50ZXN0KHRyaW1tZWQpKSB7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICBjb25zdCBuYW1lcyA9IGdldEhhc2tlbGxEZWZpbml0aW9uTmFtZXModHJpbW1lZCk7XG4gICAgaWYgKCFuYW1lcy5sZW5ndGgpIHtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cblxuICAgIGNvbnN0IGVuZCA9IGZpbmRIYXNrZWxsUmFuZ2VFbmQobGluZXMsIGluZGV4LCBuYW1lc1swXSk7XG4gICAgZGVmaW5pdGlvbnMucHVzaCh7IG5hbWU6IG5hbWVzWzBdLCBuYW1lcywgc3RhcnQ6IGluZGV4LCBlbmQgfSk7XG4gICAgaW5kZXggPSBlbmQ7XG4gIH1cbiAgcmV0dXJuIGRlZmluaXRpb25zO1xufVxuXG5mdW5jdGlvbiBjb2xsZWN0T2NhbWxEZWZpbml0aW9ucyhsaW5lczogc3RyaW5nW10pOiBTb3VyY2VEZWZpbml0aW9uW10ge1xuICBjb25zdCBkZWZpbml0aW9uczogU291cmNlRGVmaW5pdGlvbltdID0gW107XG4gIGZvciAobGV0IGluZGV4ID0gMDsgaW5kZXggPCBsaW5lcy5sZW5ndGg7IGluZGV4ICs9IDEpIHtcbiAgICBjb25zdCB0cmltbWVkID0gbGluZXNbaW5kZXhdLnRyaW0oKTtcbiAgICBpZiAoIXRyaW1tZWQgfHwgZ2V0SW5kZW50KGxpbmVzW2luZGV4XSkgPiAwIHx8IC9eKG9wZW58aW5jbHVkZXwjdXNlKVxcYi8udGVzdCh0cmltbWVkKSkge1xuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgY29uc3QgbmFtZXMgPSBnZXRPY2FtbERlZmluaXRpb25OYW1lcyh0cmltbWVkKTtcbiAgICBpZiAoIW5hbWVzLmxlbmd0aCkge1xuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgY29uc3QgZW5kID0gZmluZExheW91dFJhbmdlRW5kKGxpbmVzLCBpbmRleCwgaXNPY2FtbFRvcExldmVsU3RhcnQpO1xuICAgIGRlZmluaXRpb25zLnB1c2goeyBuYW1lOiBuYW1lc1swXSwgbmFtZXMsIHN0YXJ0OiBpbmRleCwgZW5kIH0pO1xuICAgIGluZGV4ID0gZW5kO1xuICB9XG4gIHJldHVybiBkZWZpbml0aW9ucztcbn1cblxuZnVuY3Rpb24gY29sbGVjdEJyYWNlRGVmaW5pdGlvbnMobGluZXM6IHN0cmluZ1tdLCBwYXR0ZXJuOiBSZWdFeHApOiBTb3VyY2VEZWZpbml0aW9uW10ge1xuICBjb25zdCBkZWZpbml0aW9uczogU291cmNlRGVmaW5pdGlvbltdID0gW107XG4gIGZvciAobGV0IGluZGV4ID0gMDsgaW5kZXggPCBsaW5lcy5sZW5ndGg7IGluZGV4ICs9IDEpIHtcbiAgICBjb25zdCBtYXRjaCA9IGxpbmVzW2luZGV4XS5tYXRjaChwYXR0ZXJuKTtcbiAgICBjb25zdCBuYW1lID0gbWF0Y2g/LnNsaWNlKDEpLmZpbmQoQm9vbGVhbik7XG4gICAgaWYgKCFuYW1lKSB7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgZGVmaW5pdGlvbnMucHVzaCh7IG5hbWUsIHN0YXJ0OiBpbmRleCwgZW5kOiBmaW5kQnJhY2VSYW5nZUVuZChsaW5lcywgaW5kZXgpIH0pO1xuICB9XG4gIHJldHVybiBkZWZpbml0aW9ucztcbn1cblxuZnVuY3Rpb24gZmluZEJyYWNlUmFuZ2VFbmQobGluZXM6IHN0cmluZ1tdLCBzdGFydDogbnVtYmVyKTogbnVtYmVyIHtcbiAgaWYgKCFsaW5lc1tzdGFydF0uaW5jbHVkZXMoXCJ7XCIpKSB7XG4gICAgcmV0dXJuIHN0YXJ0O1xuICB9XG5cbiAgbGV0IGRlcHRoID0gMDtcbiAgbGV0IHNhd0JyYWNlID0gZmFsc2U7XG4gIGZvciAobGV0IGluZGV4ID0gc3RhcnQ7IGluZGV4IDwgbGluZXMubGVuZ3RoOyBpbmRleCArPSAxKSB7XG4gICAgZm9yIChjb25zdCBjaGFyIG9mIGxpbmVzW2luZGV4XSkge1xuICAgICAgaWYgKGNoYXIgPT09IFwie1wiKSB7XG4gICAgICAgIGRlcHRoICs9IDE7XG4gICAgICAgIHNhd0JyYWNlID0gdHJ1ZTtcbiAgICAgIH0gZWxzZSBpZiAoY2hhciA9PT0gXCJ9XCIpIHtcbiAgICAgICAgZGVwdGggLT0gMTtcbiAgICAgIH1cbiAgICB9XG4gICAgaWYgKHNhd0JyYWNlICYmIGRlcHRoIDw9IDApIHtcbiAgICAgIHJldHVybiBpbmRleDtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIHN0YXJ0O1xufVxuXG5mdW5jdGlvbiBmaW5kQ0RlY2xhcmF0aW9uRW5kKGxpbmVzOiBzdHJpbmdbXSwgc3RhcnQ6IG51bWJlcik6IG51bWJlciB7XG4gIGxldCBzYXdCcmFjZSA9IGZhbHNlO1xuICBsZXQgZGVwdGggPSAwO1xuICBmb3IgKGxldCBpbmRleCA9IHN0YXJ0OyBpbmRleCA8IGxpbmVzLmxlbmd0aDsgaW5kZXggKz0gMSkge1xuICAgIGZvciAoY29uc3QgY2hhciBvZiBsaW5lc1tpbmRleF0pIHtcbiAgICAgIGlmIChjaGFyID09PSBcIntcIikge1xuICAgICAgICBkZXB0aCArPSAxO1xuICAgICAgICBzYXdCcmFjZSA9IHRydWU7XG4gICAgICB9IGVsc2UgaWYgKGNoYXIgPT09IFwifVwiKSB7XG4gICAgICAgIGRlcHRoIC09IDE7XG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKCghc2F3QnJhY2UgfHwgZGVwdGggPD0gMCkgJiYgbGluZXNbaW5kZXhdLmluY2x1ZGVzKFwiO1wiKSkge1xuICAgICAgcmV0dXJuIGluZGV4O1xuICAgIH1cbiAgfVxuICByZXR1cm4gc3RhcnQ7XG59XG5cbmZ1bmN0aW9uIGJyYWNlRGVsdGEobGluZTogc3RyaW5nKTogbnVtYmVyIHtcbiAgbGV0IGRlbHRhID0gMDtcbiAgZm9yIChjb25zdCBjaGFyIG9mIGxpbmUpIHtcbiAgICBpZiAoY2hhciA9PT0gXCJ7XCIpIHtcbiAgICAgIGRlbHRhICs9IDE7XG4gICAgfSBlbHNlIGlmIChjaGFyID09PSBcIn1cIikge1xuICAgICAgZGVsdGEgLT0gMTtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIGRlbHRhO1xufVxuXG5mdW5jdGlvbiBpc0NDb21tZW50TGluZSh0cmltbWVkOiBzdHJpbmcpOiBib29sZWFuIHtcbiAgcmV0dXJuIHRyaW1tZWQuc3RhcnRzV2l0aChcIi8vXCIpIHx8IHRyaW1tZWQuc3RhcnRzV2l0aChcIi8qXCIpIHx8IHRyaW1tZWQuc3RhcnRzV2l0aChcIipcIik7XG59XG5cbmZ1bmN0aW9uIGlzQ0NvbnRyb2xLZXl3b3JkKG5hbWU6IHN0cmluZyk6IGJvb2xlYW4ge1xuICByZXR1cm4gW1wiaWZcIiwgXCJmb3JcIiwgXCJ3aGlsZVwiLCBcInN3aXRjaFwiLCBcImNhdGNoXCJdLmluY2x1ZGVzKG5hbWUpO1xufVxuXG5mdW5jdGlvbiBnZXRIYXNrZWxsRGVmaW5pdGlvbk5hbWVzKHRyaW1tZWQ6IHN0cmluZyk6IHN0cmluZ1tdIHtcbiAgY29uc3Qgc2lnbmF0dXJlID0gdHJpbW1lZC5tYXRjaCgvXihbYS16X11bXFx3J10qKVxccyo6Oi8pO1xuICBpZiAoc2lnbmF0dXJlKSB7XG4gICAgcmV0dXJuIFtzaWduYXR1cmVbMV1dO1xuICB9XG5cbiAgY29uc3QgYmluZGluZyA9IHRyaW1tZWQubWF0Y2goL14oW2Etel9dW1xcdyddKilcXGIuKj0vKTtcbiAgaWYgKGJpbmRpbmcpIHtcbiAgICByZXR1cm4gW2JpbmRpbmdbMV1dO1xuICB9XG5cbiAgY29uc3QgdHlwZUxpa2UgPSB0cmltbWVkLm1hdGNoKC9eKD86ZGF0YXxuZXd0eXBlfHR5cGV8Y2xhc3MpXFxzKyhbQS1aXVtcXHcnXSopXFxiLyk7XG4gIGlmICh0eXBlTGlrZSkge1xuICAgIHJldHVybiBbdHlwZUxpa2VbMV1dO1xuICB9XG5cbiAgY29uc3QgaW5zdGFuY2UgPSB0cmltbWVkLm1hdGNoKC9eaW5zdGFuY2VcXGIuKj9cXGIoW0EtWl1bXFx3J10qKVxcYi8pO1xuICByZXR1cm4gaW5zdGFuY2UgPyBbaW5zdGFuY2VbMV1dIDogW107XG59XG5cbmZ1bmN0aW9uIGdldE9jYW1sRGVmaW5pdGlvbk5hbWVzKHRyaW1tZWQ6IHN0cmluZyk6IHN0cmluZ1tdIHtcbiAgY29uc3QgbGV0QmluZGluZyA9IHRyaW1tZWQubWF0Y2goL15sZXRcXHMrKD86cmVjXFxzKyk/KD86XFwoKFteKV0rKVxcKXwoW2Etel9dW1xcdyddKikpLyk7XG4gIGlmIChsZXRCaW5kaW5nKSB7XG4gICAgcmV0dXJuIFtsZXRCaW5kaW5nWzFdID8/IGxldEJpbmRpbmdbMl1dO1xuICB9XG5cbiAgY29uc3QgdHlwZUJpbmRpbmcgPSB0cmltbWVkLm1hdGNoKC9edHlwZVxccysoW2Etel9dW1xcdyddKikvKTtcbiAgaWYgKHR5cGVCaW5kaW5nKSB7XG4gICAgcmV0dXJuIFt0eXBlQmluZGluZ1sxXV07XG4gIH1cblxuICBjb25zdCBtb2R1bGVCaW5kaW5nID0gdHJpbW1lZC5tYXRjaCgvXm1vZHVsZVxccysoW0EtWl1bXFx3J10qKS8pO1xuICBpZiAobW9kdWxlQmluZGluZykge1xuICAgIHJldHVybiBbbW9kdWxlQmluZGluZ1sxXV07XG4gIH1cblxuICByZXR1cm4gW107XG59XG5cbmZ1bmN0aW9uIGZpbmRMYXlvdXRSYW5nZUVuZChsaW5lczogc3RyaW5nW10sIHN0YXJ0OiBudW1iZXIsIGlzVG9wTGV2ZWxTdGFydDogKGxpbmU6IHN0cmluZykgPT4gYm9vbGVhbik6IG51bWJlciB7XG4gIGxldCBlbmQgPSBzdGFydDtcbiAgZm9yIChsZXQgaW5kZXggPSBzdGFydCArIDE7IGluZGV4IDwgbGluZXMubGVuZ3RoOyBpbmRleCArPSAxKSB7XG4gICAgY29uc3QgbGluZSA9IGxpbmVzW2luZGV4XTtcbiAgICBpZiAobGluZS50cmltKCkgJiYgZ2V0SW5kZW50KGxpbmUpID09PSAwICYmIGlzVG9wTGV2ZWxTdGFydChsaW5lLnRyaW0oKSkpIHtcbiAgICAgIGJyZWFrO1xuICAgIH1cbiAgICBlbmQgPSBpbmRleDtcbiAgfVxuICByZXR1cm4gZW5kO1xufVxuXG5mdW5jdGlvbiBmaW5kSGFza2VsbFJhbmdlRW5kKGxpbmVzOiBzdHJpbmdbXSwgc3RhcnQ6IG51bWJlciwgbmFtZTogc3RyaW5nKTogbnVtYmVyIHtcbiAgbGV0IGVuZCA9IHN0YXJ0O1xuICBsZXQgYWxsb3dNYXRjaGluZ0VxdWF0aW9uID0gbGluZXNbc3RhcnRdLnRyaW0oKS5zdGFydHNXaXRoKGAke25hbWV9IDo6YCk7XG4gIGZvciAobGV0IGluZGV4ID0gc3RhcnQgKyAxOyBpbmRleCA8IGxpbmVzLmxlbmd0aDsgaW5kZXggKz0gMSkge1xuICAgIGNvbnN0IGxpbmUgPSBsaW5lc1tpbmRleF07XG4gICAgY29uc3QgdHJpbW1lZCA9IGxpbmUudHJpbSgpO1xuICAgIGlmICh0cmltbWVkICYmIGdldEluZGVudChsaW5lKSA9PT0gMCAmJiBpc0hhc2tlbGxUb3BMZXZlbFN0YXJ0KHRyaW1tZWQpKSB7XG4gICAgICBpZiAoYWxsb3dNYXRjaGluZ0VxdWF0aW9uICYmIHRyaW1tZWQuc3RhcnRzV2l0aChgJHtuYW1lfSBgKSAmJiB0cmltbWVkLmluY2x1ZGVzKFwiPVwiKSkge1xuICAgICAgICBhbGxvd01hdGNoaW5nRXF1YXRpb24gPSBmYWxzZTtcbiAgICAgICAgZW5kID0gaW5kZXg7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgYnJlYWs7XG4gICAgfVxuICAgIGVuZCA9IGluZGV4O1xuICB9XG4gIHJldHVybiBlbmQ7XG59XG5cbmZ1bmN0aW9uIGlzSGFza2VsbFRvcExldmVsU3RhcnQodHJpbW1lZDogc3RyaW5nKTogYm9vbGVhbiB7XG4gIHJldHVybiAvXihtb2R1bGV8aW1wb3J0fGRhdGF8bmV3dHlwZXx0eXBlfGNsYXNzfGluc3RhbmNlKVxcYi8udGVzdCh0cmltbWVkKVxuICAgIHx8IC9eW2Etel9dW1xcdyddKlxccyooPzo6OnwuKj0pLy50ZXN0KHRyaW1tZWQpO1xufVxuXG5mdW5jdGlvbiBpc09jYW1sVG9wTGV2ZWxTdGFydCh0cmltbWVkOiBzdHJpbmcpOiBib29sZWFuIHtcbiAgcmV0dXJuIC9eKG9wZW58aW5jbHVkZXwjdXNlfGxldHx0eXBlfG1vZHVsZSlcXGIvLnRlc3QodHJpbW1lZCk7XG59XG5cbmZ1bmN0aW9uIHJlbmRlclJhbmdlKGxpbmVzOiBzdHJpbmdbXSwgcmFuZ2U6IFNvdXJjZVJhbmdlKTogc3RyaW5nIHtcbiAgcmV0dXJuIGxpbmVzLnNsaWNlKHJhbmdlLnN0YXJ0LCByYW5nZS5lbmQgKyAxKS5qb2luKFwiXFxuXCIpO1xufVxuXG5mdW5jdGlvbiByYW5nZXNPdmVybGFwKGxlZnQ6IFNvdXJjZVJhbmdlLCByaWdodDogU291cmNlUmFuZ2UpOiBib29sZWFuIHtcbiAgcmV0dXJuIGxlZnQuc3RhcnQgPD0gcmlnaHQuZW5kICYmIHJpZ2h0LnN0YXJ0IDw9IGxlZnQuZW5kO1xufVxuXG5mdW5jdGlvbiBnZXRJbmRlbnQobGluZTogc3RyaW5nKTogbnVtYmVyIHtcbiAgcmV0dXJuIGxpbmUubWF0Y2goL15cXHMqLyk/LlswXS5sZW5ndGggPz8gMDtcbn1cblxuZnVuY3Rpb24gZXNjYXBlUmVnZXgodmFsdWU6IHN0cmluZyk6IHN0cmluZyB7XG4gIHJldHVybiB2YWx1ZS5yZXBsYWNlKC9bLiorP14ke30oKXxbXFxdXFxcXF0vZywgXCJcXFxcJCZcIik7XG59XG5cbmZ1bmN0aW9uIGRlZmluaXRpb25OYW1lcyhkZWZpbml0aW9uOiBTb3VyY2VEZWZpbml0aW9uKTogc3RyaW5nW10ge1xuICByZXR1cm4gZGVmaW5pdGlvbi5uYW1lcz8ubGVuZ3RoID8gZGVmaW5pdGlvbi5uYW1lcyA6IFtkZWZpbml0aW9uLm5hbWVdO1xufVxuXG5mdW5jdGlvbiBzb3VyY2VVc2VzTmFtZShzb3VyY2U6IHN0cmluZywgbmFtZTogc3RyaW5nKTogYm9vbGVhbiB7XG4gIGlmIChuYW1lLnN0YXJ0c1dpdGgoXCJAXCIpKSB7XG4gICAgcmV0dXJuIG5ldyBSZWdFeHAoYCR7ZXNjYXBlUmVnZXgobmFtZSl9XFxcXGJgKS50ZXN0KHNvdXJjZSk7XG4gIH1cbiAgcmV0dXJuIG5ldyBSZWdFeHAoYFxcXFxiJHtlc2NhcGVSZWdleChuYW1lKX1cXFxcYmApLnRlc3Qoc291cmNlKTtcbn1cblxuZnVuY3Rpb24gZm9ybWF0U291cmNlRGVzY3JpcHRpb24ocmVmZXJlbmNlOiBsb29tU291cmNlUmVmZXJlbmNlLCByYW5nZTogU291cmNlUmFuZ2UgfCBudWxsKTogc3RyaW5nIHtcbiAgaWYgKHJlZmVyZW5jZS5zeW1ib2xOYW1lKSB7XG4gICAgcmV0dXJuIGAke3JlZmVyZW5jZS5maWxlUGF0aH0jJHtyZWZlcmVuY2Uuc3ltYm9sTmFtZX1gO1xuICB9XG4gIGlmIChyYW5nZSkge1xuICAgIHJldHVybiBgJHtyZWZlcmVuY2UuZmlsZVBhdGh9Okwke3JhbmdlLnN0YXJ0ICsgMX0tTCR7cmFuZ2UuZW5kICsgMX1gO1xuICB9XG4gIHJldHVybiByZWZlcmVuY2UuZmlsZVBhdGg7XG59XG5cbmNvbnN0IFBZVEhPTl9BU1RfSEVMUEVSID0gU3RyaW5nLnJhd2BcbmltcG9ydCBhc3RcbmltcG9ydCBqc29uXG5pbXBvcnQgc3lzXG5cbnBheWxvYWQgPSBqc29uLmxvYWRzKHN5cy5zdGRpbi5yZWFkKCkpXG5zb3VyY2UgPSBwYXlsb2FkLmdldChcInNvdXJjZVwiLCBcIlwiKVxubW9kZSA9IHBheWxvYWQuZ2V0KFwibW9kZVwiLCBcIm1vZHVsZVwiKVxuXG5kZWYgcmFuZ2Vfc3RhcnQobm9kZSk6XG4gICAgbGluZW5vID0gZ2V0YXR0cihub2RlLCBcImxpbmVub1wiLCAxKVxuICAgIGRlY29yYXRvcnMgPSBnZXRhdHRyKG5vZGUsIFwiZGVjb3JhdG9yX2xpc3RcIiwgTm9uZSkgb3IgW11cbiAgICBpZiBkZWNvcmF0b3JzOlxuICAgICAgICBsaW5lbm8gPSBtaW4obGluZW5vLCAqKGdldGF0dHIoZGVjb3JhdG9yLCBcImxpbmVub1wiLCBsaW5lbm8pIGZvciBkZWNvcmF0b3IgaW4gZGVjb3JhdG9ycykpXG4gICAgcmV0dXJuIGxpbmVubyAtIDFcblxuZGVmIHJhbmdlX2VuZChub2RlKTpcbiAgICByZXR1cm4gZ2V0YXR0cihub2RlLCBcImVuZF9saW5lbm9cIiwgZ2V0YXR0cihub2RlLCBcImxpbmVub1wiLCAxKSkgLSAxXG5cbmRlZiB0YXJnZXRfbmFtZXModGFyZ2V0KTpcbiAgICBpZiBpc2luc3RhbmNlKHRhcmdldCwgYXN0Lk5hbWUpOlxuICAgICAgICByZXR1cm4gW3RhcmdldC5pZF1cbiAgICBpZiBpc2luc3RhbmNlKHRhcmdldCwgKGFzdC5UdXBsZSwgYXN0Lkxpc3QpKTpcbiAgICAgICAgbmFtZXMgPSBbXVxuICAgICAgICBmb3IgaXRlbSBpbiB0YXJnZXQuZWx0czpcbiAgICAgICAgICAgIG5hbWVzLmV4dGVuZCh0YXJnZXRfbmFtZXMoaXRlbSkpXG4gICAgICAgIHJldHVybiBuYW1lc1xuICAgIHJldHVybiBbXVxuXG5kZWYgZGVmaW5pdGlvbl9uYW1lcyhub2RlKTpcbiAgICBpZiBpc2luc3RhbmNlKG5vZGUsIChhc3QuRnVuY3Rpb25EZWYsIGFzdC5Bc3luY0Z1bmN0aW9uRGVmLCBhc3QuQ2xhc3NEZWYpKTpcbiAgICAgICAgcmV0dXJuIFtub2RlLm5hbWVdXG4gICAgaWYgaXNpbnN0YW5jZShub2RlLCBhc3QuQXNzaWduKTpcbiAgICAgICAgbmFtZXMgPSBbXVxuICAgICAgICBmb3IgdGFyZ2V0IGluIG5vZGUudGFyZ2V0czpcbiAgICAgICAgICAgIG5hbWVzLmV4dGVuZCh0YXJnZXRfbmFtZXModGFyZ2V0KSlcbiAgICAgICAgcmV0dXJuIG5hbWVzXG4gICAgaWYgaXNpbnN0YW5jZShub2RlLCAoYXN0LkFubkFzc2lnbiwgYXN0LkF1Z0Fzc2lnbikpOlxuICAgICAgICByZXR1cm4gdGFyZ2V0X25hbWVzKG5vZGUudGFyZ2V0KVxuICAgIHJldHVybiBbXVxuXG5kZWYgaW5zcGVjdF9tb2R1bGUodHJlZSk6XG4gICAgZGVmaW5pdGlvbnMgPSBbXVxuICAgIGltcG9ydHMgPSBbXVxuICAgIGZvciBub2RlIGluIHRyZWUuYm9keTpcbiAgICAgICAgbmFtZXMgPSBkZWZpbml0aW9uX25hbWVzKG5vZGUpXG4gICAgICAgIGlmIG5hbWVzOlxuICAgICAgICAgICAgZGVmaW5pdGlvbnMuYXBwZW5kKHtcbiAgICAgICAgICAgICAgICBcIm5hbWVcIjogbmFtZXNbMF0sXG4gICAgICAgICAgICAgICAgXCJuYW1lc1wiOiBuYW1lcyxcbiAgICAgICAgICAgICAgICBcInN0YXJ0XCI6IHJhbmdlX3N0YXJ0KG5vZGUpLFxuICAgICAgICAgICAgICAgIFwiZW5kXCI6IHJhbmdlX2VuZChub2RlKSxcbiAgICAgICAgICAgIH0pXG4gICAgICAgICAgICBjb250aW51ZVxuICAgICAgICBpZiBpc2luc3RhbmNlKG5vZGUsIGFzdC5JbXBvcnQpOlxuICAgICAgICAgICAgaW1wb3J0cy5hcHBlbmQoe1xuICAgICAgICAgICAgICAgIFwia2luZFwiOiBcImltcG9ydFwiLFxuICAgICAgICAgICAgICAgIFwibW9kdWxlXCI6IFwiXCIsXG4gICAgICAgICAgICAgICAgXCJsZXZlbFwiOiAwLFxuICAgICAgICAgICAgICAgIFwibmFtZXNcIjogW3tcIm5hbWVcIjogaXRlbS5uYW1lLCBcImFzbmFtZVwiOiBpdGVtLmFzbmFtZX0gZm9yIGl0ZW0gaW4gbm9kZS5uYW1lc10sXG4gICAgICAgICAgICAgICAgXCJzdGFydFwiOiByYW5nZV9zdGFydChub2RlKSxcbiAgICAgICAgICAgICAgICBcImVuZFwiOiByYW5nZV9lbmQobm9kZSksXG4gICAgICAgICAgICB9KVxuICAgICAgICAgICAgY29udGludWVcbiAgICAgICAgaWYgaXNpbnN0YW5jZShub2RlLCBhc3QuSW1wb3J0RnJvbSk6XG4gICAgICAgICAgICBpbXBvcnRzLmFwcGVuZCh7XG4gICAgICAgICAgICAgICAgXCJraW5kXCI6IFwiZnJvbVwiLFxuICAgICAgICAgICAgICAgIFwibW9kdWxlXCI6IG5vZGUubW9kdWxlIG9yIFwiXCIsXG4gICAgICAgICAgICAgICAgXCJsZXZlbFwiOiBub2RlLmxldmVsLFxuICAgICAgICAgICAgICAgIFwibmFtZXNcIjogW3tcIm5hbWVcIjogaXRlbS5uYW1lLCBcImFzbmFtZVwiOiBpdGVtLmFzbmFtZX0gZm9yIGl0ZW0gaW4gbm9kZS5uYW1lc10sXG4gICAgICAgICAgICAgICAgXCJzdGFydFwiOiByYW5nZV9zdGFydChub2RlKSxcbiAgICAgICAgICAgICAgICBcImVuZFwiOiByYW5nZV9lbmQobm9kZSksXG4gICAgICAgICAgICB9KVxuICAgIHJldHVybiB7XCJkZWZpbml0aW9uc1wiOiBkZWZpbml0aW9ucywgXCJpbXBvcnRzXCI6IGltcG9ydHN9XG5cbmRlZiBhdHRyaWJ1dGVfY2hhaW4obm9kZSk6XG4gICAgY2hhaW4gPSBbXVxuICAgIGN1cnJlbnQgPSBub2RlXG4gICAgd2hpbGUgaXNpbnN0YW5jZShjdXJyZW50LCBhc3QuQXR0cmlidXRlKTpcbiAgICAgICAgY2hhaW4uYXBwZW5kKGN1cnJlbnQuYXR0cilcbiAgICAgICAgY3VycmVudCA9IGN1cnJlbnQudmFsdWVcbiAgICBpZiBpc2luc3RhbmNlKGN1cnJlbnQsIGFzdC5OYW1lKTpcbiAgICAgICAgY2hhaW4uYXBwZW5kKGN1cnJlbnQuaWQpXG4gICAgICAgIGNoYWluLnJldmVyc2UoKVxuICAgICAgICByZXR1cm4gY2hhaW5cbiAgICByZXR1cm4gW11cblxuY2xhc3MgVXNhZ2VWaXNpdG9yKGFzdC5Ob2RlVmlzaXRvcik6XG4gICAgZGVmIF9faW5pdF9fKHNlbGYpOlxuICAgICAgICBzZWxmLm5hbWVzID0gc2V0KClcbiAgICAgICAgc2VsZi5hdHRyaWJ1dGVzID0ge31cblxuICAgIGRlZiB2aXNpdF9OYW1lKHNlbGYsIG5vZGUpOlxuICAgICAgICBpZiBpc2luc3RhbmNlKG5vZGUuY3R4LCBhc3QuTG9hZCk6XG4gICAgICAgICAgICBzZWxmLm5hbWVzLmFkZChub2RlLmlkKVxuXG4gICAgZGVmIHZpc2l0X0F0dHJpYnV0ZShzZWxmLCBub2RlKTpcbiAgICAgICAgY2hhaW4gPSBhdHRyaWJ1dGVfY2hhaW4obm9kZSlcbiAgICAgICAgaWYgbGVuKGNoYWluKSA+PSAyOlxuICAgICAgICAgICAgc2VsZi5uYW1lcy5hZGQoY2hhaW5bMF0pXG4gICAgICAgICAgICBzZWxmLmF0dHJpYnV0ZXMuc2V0ZGVmYXVsdChjaGFpblswXSwgc2V0KCkpLmFkZChjaGFpblsxXSlcbiAgICAgICAgc2VsZi5nZW5lcmljX3Zpc2l0KG5vZGUpXG5cbmRlZiBpbnNwZWN0X3VzYWdlKHRyZWUpOlxuICAgIHZpc2l0b3IgPSBVc2FnZVZpc2l0b3IoKVxuICAgIHZpc2l0b3IudmlzaXQodHJlZSlcbiAgICByZXR1cm4ge1xuICAgICAgICBcIm5hbWVzXCI6IHNvcnRlZCh2aXNpdG9yLm5hbWVzKSxcbiAgICAgICAgXCJhdHRyaWJ1dGVzXCI6IHtrZXk6IHNvcnRlZCh2YWx1ZSkgZm9yIGtleSwgdmFsdWUgaW4gdmlzaXRvci5hdHRyaWJ1dGVzLml0ZW1zKCl9LFxuICAgIH1cblxudHJ5OlxuICAgIHRyZWUgPSBhc3QucGFyc2Uoc291cmNlKVxuZXhjZXB0IFN5bnRheEVycm9yOlxuICAgIHByaW50KGpzb24uZHVtcHMoe1wiZGVmaW5pdGlvbnNcIjogW10sIFwiaW1wb3J0c1wiOiBbXX0gaWYgbW9kZSA9PSBcIm1vZHVsZVwiIGVsc2Uge1wibmFtZXNcIjogW10sIFwiYXR0cmlidXRlc1wiOiB7fX0pKVxuICAgIHJhaXNlIFN5c3RlbUV4aXQoMClcblxuaWYgbW9kZSA9PSBcIm1vZHVsZVwiOlxuICAgIHByaW50KGpzb24uZHVtcHMoaW5zcGVjdF9tb2R1bGUodHJlZSkpKVxuZWxzZTpcbiAgICBwcmludChqc29uLmR1bXBzKGluc3BlY3RfdXNhZ2UodHJlZSkpKVxuYDtcbiIsICJpbXBvcnQgeyBzZXRJY29uIH0gZnJvbSBcIm9ic2lkaWFuXCI7XG5cbmV4cG9ydCBpbnRlcmZhY2UgbG9vbVRvb2xiYXJIYW5kbGVycyB7XG4gIG9uUnVuOiAoKSA9PiB2b2lkO1xuICBvbkNvcHk6ICgpID0+IHZvaWQ7XG4gIG9uUmVtb3ZlOiAoKSA9PiB2b2lkO1xuICBvblRvZ2dsZU91dHB1dDogKCkgPT4gdm9pZDtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGNyZWF0ZUNvZGVCbG9ja1Rvb2xiYXIoXG4gIGJsb2NrSWQ6IHN0cmluZyxcbiAgaXNSdW5uaW5nOiBib29sZWFuLFxuICBoYW5kbGVyczogbG9vbVRvb2xiYXJIYW5kbGVycyxcbik6IEhUTUxEaXZFbGVtZW50IHtcbiAgY29uc3QgdG9vbGJhciA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJkaXZcIik7XG4gIHRvb2xiYXIuY2xhc3NOYW1lID0gXCJsb29tLWNvZGUtdG9vbGJhclwiO1xuICB0b29sYmFyLmRhdGFzZXQubG9vbUJsb2NrSWQgPSBibG9ja0lkO1xuXG4gIHRvb2xiYXIuYXBwZW5kQ2hpbGQoY3JlYXRlQnV0dG9uKFwiUnVuIGJsb2NrXCIsIGlzUnVubmluZyA/IFwibG9hZGVyLWNpcmNsZVwiIDogXCJwbGF5XCIsIGhhbmRsZXJzLm9uUnVuLCBpc1J1bm5pbmcpKTtcbiAgdG9vbGJhci5hcHBlbmRDaGlsZChjcmVhdGVCdXR0b24oXCJDb3B5IGNvZGVcIiwgXCJjb3B5XCIsIGhhbmRsZXJzLm9uQ29weSwgZmFsc2UpKTtcbiAgdG9vbGJhci5hcHBlbmRDaGlsZChjcmVhdGVCdXR0b24oXCJSZW1vdmUgc25pcHBldFwiLCBcInRyYXNoLTJcIiwgaGFuZGxlcnMub25SZW1vdmUsIGZhbHNlKSk7XG4gIHRvb2xiYXIuYXBwZW5kQ2hpbGQoY3JlYXRlQnV0dG9uKFwiVG9nZ2xlIG91dHB1dFwiLCBcInBhbmVsLWJvdHRvbS1vcGVuXCIsIGhhbmRsZXJzLm9uVG9nZ2xlT3V0cHV0LCBmYWxzZSkpO1xuXG4gIHJldHVybiB0b29sYmFyO1xufVxuXG5mdW5jdGlvbiBjcmVhdGVCdXR0b24obGFiZWw6IHN0cmluZywgaWNvbk5hbWU6IHN0cmluZywgb25DbGljazogKCkgPT4gdm9pZCwgc3Bpbm5pbmc6IGJvb2xlYW4pOiBIVE1MQnV0dG9uRWxlbWVudCB7XG4gIGNvbnN0IGJ1dHRvbiA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJidXR0b25cIik7XG4gIGJ1dHRvbi5jbGFzc05hbWUgPSBgbG9vbS10b29sYmFyLWJ1dHRvbiR7c3Bpbm5pbmcgPyBcIiBpcy1ydW5uaW5nXCIgOiBcIlwifWA7XG4gIGJ1dHRvbi50eXBlID0gXCJidXR0b25cIjtcbiAgYnV0dG9uLnNldEF0dHJpYnV0ZShcImFyaWEtbGFiZWxcIiwgbGFiZWwpO1xuICBidXR0b24uYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsIChldmVudCkgPT4ge1xuICAgIGV2ZW50LnByZXZlbnREZWZhdWx0KCk7XG4gICAgZXZlbnQuc3RvcFByb3BhZ2F0aW9uKCk7XG4gICAgb25DbGljaygpO1xuICB9KTtcbiAgc2V0SWNvbihidXR0b24sIGljb25OYW1lKTtcbiAgcmV0dXJuIGJ1dHRvbjtcbn1cbiIsICJpbXBvcnQgeyBzZXRJY29uIH0gZnJvbSBcIm9ic2lkaWFuXCI7XG5pbXBvcnQgdHlwZSB7IGxvb21TdG9yZWRPdXRwdXQgfSBmcm9tIFwiLi4vdHlwZXNcIjtcblxuZnVuY3Rpb24gZ2V0U3RhdHVzS2luZChvdXRwdXQ6IGxvb21TdG9yZWRPdXRwdXQpOiBcInN1Y2Nlc3NcIiB8IFwid2FybmluZ1wiIHwgXCJmYWlsdXJlXCIge1xuICBpZiAob3V0cHV0LnJlc3VsdC5zdWNjZXNzKSB7XG4gICAgcmV0dXJuIG91dHB1dC5yZXN1bHQuc3RkZXJyLnRyaW0oKSB8fCBvdXRwdXQucmVzdWx0Lndhcm5pbmc/LnRyaW0oKSA/IFwid2FybmluZ1wiIDogXCJzdWNjZXNzXCI7XG4gIH1cblxuICByZXR1cm4gXCJmYWlsdXJlXCI7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBjcmVhdGVPdXRwdXRQYW5lbChvdXRwdXQ6IGxvb21TdG9yZWRPdXRwdXQpOiBIVE1MRGl2RWxlbWVudCB7XG4gIGNvbnN0IHBhbmVsID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcImRpdlwiKTtcbiAgcGFuZWwuY2xhc3NOYW1lID0gYGxvb20tb3V0cHV0LXBhbmVsIGlzLSR7Z2V0U3RhdHVzS2luZChvdXRwdXQpfSR7b3V0cHV0LnZpc2libGUgPyBcIlwiIDogXCIgaXMtaGlkZGVuXCJ9YDtcbiAgcGFuZWwuZGF0YXNldC5sb29tQmxvY2tJZCA9IG91dHB1dC5ibG9ja0lkO1xuICByZW5kZXJPdXRwdXRQYW5lbChwYW5lbCwgb3V0cHV0KTtcbiAgcmV0dXJuIHBhbmVsO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gcmVuZGVyT3V0cHV0UGFuZWwocGFuZWw6IEhUTUxFbGVtZW50LCBvdXRwdXQ6IGxvb21TdG9yZWRPdXRwdXQpOiB2b2lkIHtcbiAgY29uc3Qga2luZCA9IGdldFN0YXR1c0tpbmQob3V0cHV0KTtcbiAgcGFuZWwuY2xhc3NOYW1lID0gYGxvb20tb3V0cHV0LXBhbmVsIGlzLSR7a2luZH0ke291dHB1dC52aXNpYmxlID8gXCJcIiA6IFwiIGlzLWhpZGRlblwifSR7b3V0cHV0LmNvbGxhcHNlZCA/IFwiIGlzLWNvbGxhcHNlZFwiIDogXCJcIn1gO1xuICBwYW5lbC5lbXB0eSgpO1xuXG4gIGNvbnN0IGhlYWRlciA9IHBhbmVsLmNyZWF0ZURpdih7IGNsczogXCJsb29tLW91dHB1dC1oZWFkZXJcIiB9KTtcbiAgY29uc3QgYmFkZ2UgPSBoZWFkZXIuY3JlYXRlRGl2KHsgY2xzOiBcImxvb20tb3V0cHV0LWJhZGdlXCIgfSk7XG4gIHNldEljb24oYmFkZ2UsIGtpbmQgPT09IFwic3VjY2Vzc1wiID8gXCJjaGVjay1jaXJjbGUtMlwiIDoga2luZCA9PT0gXCJ3YXJuaW5nXCIgPyBcImFsZXJ0LXRyaWFuZ2xlXCIgOiBcIngtY2lyY2xlXCIpO1xuXG4gIGNvbnN0IHRpdGxlID0gaGVhZGVyLmNyZWF0ZURpdih7IGNsczogXCJsb29tLW91dHB1dC10aXRsZVwiIH0pO1xuICB0aXRsZS5zZXRUZXh0KGAke291dHB1dC5yZXN1bHQucnVubmVyTmFtZX0gXHUwMEI3IGV4aXQgJHtvdXRwdXQucmVzdWx0LmV4aXRDb2RlID8/IFwiP1wifWApO1xuXG4gIGNvbnN0IG1ldGEgPSBoZWFkZXIuY3JlYXRlRGl2KHsgY2xzOiBcImxvb20tb3V0cHV0LW1ldGFcIiB9KTtcbiAgbWV0YS5zZXRUZXh0KGAke291dHB1dC5yZXN1bHQuZHVyYXRpb25Nc30gbXMgXHUwMEI3ICR7bmV3IERhdGUob3V0cHV0LnJlc3VsdC5maW5pc2hlZEF0KS50b0xvY2FsZVRpbWVTdHJpbmcoKX1gKTtcblxuICBjb25zdCBib2R5ID0gcGFuZWwuY3JlYXRlRGl2KHsgY2xzOiBcImxvb20tb3V0cHV0LWJvZHlcIiB9KTtcbiAgaWYgKG91dHB1dC5yZXN1bHQuc3Rkb3V0LnRyaW0oKSkge1xuICAgIGNyZWF0ZVN0cmVhbShib2R5LCBcIlN0ZG91dFwiLCBvdXRwdXQucmVzdWx0LnN0ZG91dCk7XG4gIH1cbiAgaWYgKG91dHB1dC5yZXN1bHQud2FybmluZz8udHJpbSgpKSB7XG4gICAgY3JlYXRlU3RyZWFtKGJvZHksIFwiV2FybmluZ1wiLCBvdXRwdXQucmVzdWx0Lndhcm5pbmcpO1xuICB9XG4gIGlmIChvdXRwdXQucmVzdWx0LnN0ZGVyci50cmltKCkpIHtcbiAgICBjcmVhdGVTdHJlYW0oYm9keSwgXCJTdGRlcnJcIiwgb3V0cHV0LnJlc3VsdC5zdGRlcnIpO1xuICB9XG4gIGlmICghb3V0cHV0LnJlc3VsdC5zdGRvdXQudHJpbSgpICYmICFvdXRwdXQucmVzdWx0Lndhcm5pbmc/LnRyaW0oKSAmJiAhb3V0cHV0LnJlc3VsdC5zdGRlcnIudHJpbSgpKSB7XG4gICAgY29uc3QgZW1wdHkgPSBib2R5LmNyZWF0ZURpdih7IGNsczogXCJsb29tLW91dHB1dC1lbXB0eVwiIH0pO1xuICAgIGVtcHR5LnNldFRleHQoXCJObyBvdXRwdXRcIik7XG4gIH1cbn1cblxuZnVuY3Rpb24gY3JlYXRlU3RyZWFtKGNvbnRhaW5lcjogSFRNTEVsZW1lbnQsIGxhYmVsOiBzdHJpbmcsIGNvbnRlbnQ6IHN0cmluZyk6IHZvaWQge1xuICBjb25zdCBzZWN0aW9uID0gY29udGFpbmVyLmNyZWF0ZURpdih7IGNsczogXCJsb29tLW91dHB1dC1zdHJlYW1cIiB9KTtcbiAgc2VjdGlvbi5jcmVhdGVEaXYoeyBjbHM6IFwibG9vbS1vdXRwdXQtc3RyZWFtLWxhYmVsXCIsIHRleHQ6IGxhYmVsIH0pO1xuICBzZWN0aW9uLmNyZWF0ZUVsKFwicHJlXCIsIHsgY2xzOiBcImxvb20tb3V0cHV0LXByZVwiLCB0ZXh0OiBjb250ZW50IH0pO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gY3JlYXRlUnVubmluZ1BhbmVsKCk6IEhUTUxEaXZFbGVtZW50IHtcbiAgY29uc3QgcGFuZWwgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwiZGl2XCIpO1xuICBwYW5lbC5jbGFzc05hbWUgPSBcImxvb20tb3V0cHV0LXBhbmVsIGlzLXJ1bm5pbmdcIjtcblxuICBjb25zdCBoZWFkZXIgPSBwYW5lbC5jcmVhdGVEaXYoeyBjbHM6IFwibG9vbS1vdXRwdXQtaGVhZGVyXCIgfSk7XG4gIGNvbnN0IHNwaW5uZXIgPSBoZWFkZXIuY3JlYXRlRGl2KHsgY2xzOiBcImxvb20tc3Bpbm5lclwiIH0pO1xuICBzZXRJY29uKHNwaW5uZXIsIFwibG9hZGVyLWNpcmNsZVwiKTtcbiAgY29uc3QgdGl0bGUgPSBoZWFkZXIuY3JlYXRlRGl2KHsgY2xzOiBcImxvb20tb3V0cHV0LXRpdGxlXCIgfSk7XG4gIHRpdGxlLnNldFRleHQoXCJSdW5uaW5nXCIpO1xuICBjb25zdCBtZXRhID0gaGVhZGVyLmNyZWF0ZURpdih7IGNsczogXCJsb29tLW91dHB1dC1tZXRhXCIgfSk7XG4gIG1ldGEuc2V0VGV4dChcIkV4ZWN1dGluZy4uLlwiKTtcbiAgc3Bpbm5lci5zZXRBdHRyaWJ1dGUoXCJhcmlhLWhpZGRlblwiLCBcInRydWVcIik7XG5cbiAgcmV0dXJuIHBhbmVsO1xufVxuIl0sCiAgIm1hcHBpbmdzIjogIjs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7QUFB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QUssR0FBRztBQUN4QyxVQUFJLE1BQU0sQ0FBQyxFQUFFLEtBQUssTUFBTSxhQUFhO0FBQ25DO0FBQUEsTUFDRjtBQUVBLGVBQVMsSUFBSSxJQUFJLEdBQUcsSUFBSSxNQUFNLFFBQVEsS0FBSyxHQUFHO0FBQzVDLFlBQUksTUFBTSxDQUFDLEVBQUUsS0FBSyxNQUFNLDRCQUE0QjtBQUNsRCxpQkFBTyxFQUFFLE9BQU8sR0FBRyxLQUFLLEVBQUU7QUFBQSxRQUM1QjtBQUFBLE1BQ0Y7QUFBQSxJQUNGO0FBQ0EsV0FBTztBQUFBLEVBQ1Q7QUFDRjsiLAogICJuYW1lcyI6IFsiaW1wb3J0X29ic2lkaWFuIiwgImltcG9ydF92aWV3IiwgImltcG9ydF9wYXRoIiwgImltcG9ydF9wcm9taXNlcyIsICJpbXBvcnRfcGF0aCIsICJpbXBvcnRfY2hpbGRfcHJvY2VzcyIsICJwb3NpeFBhdGgiLCAibm9ybWFsaXplRnNQYXRoIiwgImdldExlYWRpbmdXaGl0ZXNwYWNlIiwgIm5vcm1hbGl6ZUV4dGVuc2lvbiIsICJpbXBvcnRfcGF0aCIsICJpbXBvcnRfcGF0aCIsICJpbXBvcnRfcGF0aCIsICJpbXBvcnRfZnMiLCAiaW1wb3J0X3BhdGgiLCAiaW1wb3J0X29ic2lkaWFuIiwgImxvb21QbHVnaW4iLCAiaW1wb3J0X2NoaWxkX3Byb2Nlc3MiLCAiaW1wb3J0X3Byb21pc2VzIiwgImltcG9ydF9vcyIsICJpbXBvcnRfcGF0aCIsICJpbXBvcnRfb2JzaWRpYW4iLCAiaW1wb3J0X29ic2lkaWFuIl0KfQo=
