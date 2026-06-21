import { Notice, type App, type TFile } from "obsidian";
import { existsSync } from "fs";
import { mkdir, readFile, rm, writeFile } from "fs/promises";
import { basename, join, normalize as normalizeFsPath } from "path";
import { runProcess } from "./processRunner";
import { splitCommandLine } from "../utils/command";
import type { loomCodeBlock, loomPluginSettings, loomRunContext, loomRunResult } from "../types";

interface loomContainerLanguageConfig {
  command: string;
  extension: string;
}

interface loomContainerConfig {
  image?: string;
  languages: Record<string, loomContainerLanguageConfig>;
}

export class loomContainerRunner {
  private readonly builtImages = new Set<string>();

  constructor(
    private readonly app: App,
    private readonly pluginDir: string,
  ) {}

  getContainerGroupName(file: TFile): string | null {
    const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
    const value = frontmatter?.["loom-container"];
    return typeof value === "string" && value.trim() ? value.trim() : null;
  }

  async getGroupSummaries(): Promise<Array<{ name: string; status: string }>> {
    const containersPath = this.getContainersPath();
    if (!existsSync(containersPath)) {
      return [];
    }

    const { readdir } = await import("fs/promises");
    const entries = await readdir(containersPath, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => {
        const groupPath = join(containersPath, entry.name);
        const hasConfig = existsSync(join(groupPath, "config.json"));
        const hasDockerfile = existsSync(join(groupPath, "Dockerfile"));
        return {
          name: entry.name,
          status: hasConfig ? (hasDockerfile ? "config + Dockerfile" : "config only") : "missing config.json",
        };
      });
  }

  async run(block: loomCodeBlock, context: loomRunContext, settings: loomPluginSettings, groupName: string): Promise<loomRunResult> {
    const groupPath = this.resolveGroupPath(groupName);
    const config = await this.readConfig(groupPath);
    const language = config.languages[block.language] ?? config.languages[block.languageAlias];
    if (!language) {
      throw new Error(`Container group ${groupName} has no command for ${block.language}.`);
    }

    await mkdir(groupPath, { recursive: true });
    const image = await this.resolveImage(groupName, groupPath, config, context, settings);
    const tempFileName = `temp_${Date.now()}_${Math.random().toString(16).slice(2)}${normalizeExtension(language.extension)}`;
    const tempFilePath = join(groupPath, tempFileName);

    try {
      await writeFile(tempFilePath, block.content, "utf8");
      const command = splitCommandLine(language.command.replaceAll("{file}", tempFileName));
      if (!command.length) {
        throw new Error(`Container command for ${block.language} is empty.`);
      }

      return await runProcess({
        runnerId: `container:${groupName}:${block.language}`,
        runnerName: `Container ${groupName}`,
        executable: "docker",
        args: [
          "run",
          "--rm",
          "-v",
          `${groupPath}:/workspace`,
          "-w",
          "/workspace",
          image,
          ...command,
        ],
        workingDirectory: groupPath,
        timeoutMs: context.timeoutMs,
        signal: context.signal,
      });
    } finally {
      await rm(tempFilePath, { force: true });
    }
  }

  async buildGroup(groupName: string, timeoutMs: number, signal: AbortSignal): Promise<loomRunResult> {
    const groupPath = this.resolveGroupPath(groupName);
    const config = await this.readConfig(groupPath);
    return this.buildImage(groupName, groupPath, config, timeoutMs, signal);
  }

  private async resolveImage(
    groupName: string,
    groupPath: string,
    config: loomContainerConfig,
    context: loomRunContext,
    settings: loomPluginSettings,
  ): Promise<string> {
    const dockerfile = join(groupPath, "Dockerfile");
    if (!existsSync(dockerfile)) {
      return config.image || "ubuntu:latest";
    }

    const image = this.imageNameForGroup(groupName);
    if (this.builtImages.has(image)) {
      return image;
    }

    const result = await this.buildImage(groupName, groupPath, config, Math.max(context.timeoutMs, settings.defaultTimeoutMs, 120_000), context.signal);
    if (!result.success) {
      throw new Error(result.stderr || result.stdout || `Docker build failed for ${groupName}.`);
    }

    this.builtImages.add(image);
    return image;
  }

  private async buildImage(
    groupName: string,
    groupPath: string,
    _config: loomContainerConfig,
    timeoutMs: number,
    signal: AbortSignal,
  ): Promise<loomRunResult> {
    const image = this.imageNameForGroup(groupName);
    return runProcess({
      runnerId: `container:${groupName}:build`,
      runnerName: `Container ${groupName} build`,
      executable: "docker",
      args: ["build", "-t", image, groupPath],
      workingDirectory: groupPath,
      timeoutMs,
      signal,
    });
  }

  private async readConfig(groupPath: string): Promise<loomContainerConfig> {
    const configPath = join(groupPath, "config.json");
    let raw: unknown;
    try {
      raw = JSON.parse(await readFile(configPath, "utf8"));
    } catch (error) {
      throw new Error(`Unable to read container config ${configPath}: ${error instanceof Error ? error.message : String(error)}`);
    }

    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new Error("Container config must be an object.");
    }

    const data = raw as { image?: unknown; languages?: unknown };
    if (data.image != null && typeof data.image !== "string") {
      throw new Error("Container config image must be a string.");
    }
    if (!data.languages || typeof data.languages !== "object" || Array.isArray(data.languages)) {
      throw new Error("Container config languages must be an object.");
    }

    const languages: Record<string, loomContainerLanguageConfig> = {};
    for (const [language, value] of Object.entries(data.languages as Record<string, unknown>)) {
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error(`Container language ${language} must be an object.`);
      }
      const languageConfig = value as { command?: unknown; extension?: unknown };
      if (typeof languageConfig.command !== "string" || !languageConfig.command.trim()) {
        throw new Error(`Container language ${language} must define command.`);
      }
      languages[language] = {
        command: languageConfig.command,
        extension: typeof languageConfig.extension === "string" ? languageConfig.extension : `.${language}`,
      };
    }

    return {
      image: typeof data.image === "string" ? data.image : undefined,
      languages,
    };
  }

  private getContainersPath(): string {
    const adapterBasePath = (this.app.vault.adapter as { basePath?: string }).basePath ?? "";
    return normalizeFsPath(join(adapterBasePath, this.pluginDir, "containers"));
  }

  private resolveGroupPath(groupName: string): string {
    const safeName = basename(groupName);
    if (!safeName || safeName !== groupName) {
      throw new Error(`Invalid container group name: ${groupName}`);
    }
    return normalizeFsPath(join(this.getContainersPath(), safeName));
  }

  private imageNameForGroup(groupName: string): string {
    return `loom-container-${groupName.toLowerCase().replace(/[^a-z0-9_.-]/g, "-")}`;
  }
}

function normalizeExtension(extension: string): string {
  const trimmed = extension.trim();
  return trimmed.startsWith(".") ? trimmed : `.${trimmed}`;
}

export function showDockerNotice(message: string): void {
  new Notice(message, 8000);
}
