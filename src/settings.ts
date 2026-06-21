import { Notice, PluginSettingTab, Setting, normalizePath } from "obsidian";
import type loomPlugin from "./main";
import type { loomCustomLanguage, loomPluginSettings } from "./types";

export const DEFAULT_SETTINGS: loomPluginSettings = {
  enableLocalExecution: false,
  hasAcknowledgedExecutionRisk: false,
  preserveSourceMode: true,
  defaultTimeoutMs: 8000,
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
};

export class loomSettingTab extends PluginSettingTab {
  constructor(private readonly loomPlugin: loomPlugin) {
    super(loomPlugin.app, loomPlugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "loom" });
    containerEl.createEl("p", { text: "Run supported code fences directly from notes while preserving native syntax highlighting." });

    this.renderGeneralSettings(this.createSection(containerEl, "General Settings", true));
    this.renderBuiltInRuntimes(this.createSection(containerEl, "Built-in Runtimes"));
    this.renderCustomLanguages(this.createSection(containerEl, "Custom Languages"));
    void this.renderContainerGroups(this.createSection(containerEl, "Containerization Groups"));
  }

  private createSection(containerEl: HTMLElement, title: string, open = false): HTMLElement {
    const details = containerEl.createEl("details", { cls: "loom-settings-section" });
    details.open = open;
    details.createEl("summary", { text: title, cls: "loom-settings-summary" });
    return details.createDiv({ cls: "loom-settings-section-body" });
  }

  private renderGeneralSettings(containerEl: HTMLElement): void {
    new Setting(containerEl)
      .setName("Enable local execution")
      .setDesc("Disabled by default. loom runs code on your local machine and does not provide sandboxing.")
      .addToggle((toggle) =>
        toggle.setValue(this.loomPlugin.settings.enableLocalExecution).onChange(async (value) => {
          this.loomPlugin.settings.enableLocalExecution = value;
          if (value) {
            this.loomPlugin.settings.hasAcknowledgedExecutionRisk = true;
          }
          await this.loomPlugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("Keep loom notes in source mode")
      .setDesc("Preserve raw fenced code in the editor instead of letting live preview collapse research snippets.")
      .addToggle((toggle) =>
        toggle.setValue(this.loomPlugin.settings.preserveSourceMode).onChange(async (value) => {
          this.loomPlugin.settings.preserveSourceMode = value;
          await this.loomPlugin.saveSettings();
          void this.loomPlugin.enforceSourceModeForActiveView();
        }),
      );

    new Setting(containerEl)
      .setName("Default timeout")
      .setDesc("Maximum execution time in milliseconds before loom terminates the process.")
      .addText((text) =>
        text.setPlaceholder("8000").setValue(String(this.loomPlugin.settings.defaultTimeoutMs)).onChange(async (value) => {
          const parsed = Number.parseInt(value, 10);
          if (!Number.isNaN(parsed) && parsed > 0) {
            this.loomPlugin.settings.defaultTimeoutMs = parsed;
            await this.loomPlugin.saveSettings();
          }
        }),
      );

    new Setting(containerEl)
      .setName("Working directory")
      .setDesc("Optional. Empty uses the current note folder when possible, otherwise the vault root.")
      .addText((text) =>
        text.setPlaceholder("Vault root").setValue(this.loomPlugin.settings.workingDirectory).onChange(async (value) => {
          this.loomPlugin.settings.workingDirectory = value.trim() ? normalizePath(value.trim()) : "";
          await this.loomPlugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("Write output back to note")
      .setDesc("Insert managed loom output sections beneath code blocks instead of keeping results purely in the UI.")
      .addToggle((toggle) =>
        toggle.setValue(this.loomPlugin.settings.writeOutputToNote).onChange(async (value) => {
          this.loomPlugin.settings.writeOutputToNote = value;
          await this.loomPlugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("Auto-run on file open")
      .setDesc("Run all supported blocks in the active note when it opens. Disabled by default.")
      .addToggle((toggle) =>
        toggle.setValue(this.loomPlugin.settings.autoRunOnFileOpen).onChange(async (value) => {
          this.loomPlugin.settings.autoRunOnFileOpen = value;
          await this.loomPlugin.saveSettings();
        }),
      );
  }

  private renderBuiltInRuntimes(containerEl: HTMLElement): void {
    this.addTextSetting(containerEl, "Python executable", "Path or command name for Python.", "pythonExecutable");
    this.addTextSetting(containerEl, "Node executable", "Path or command name for JavaScript execution.", "nodeExecutable");

    new Setting(containerEl)
      .setName("TypeScript runner mode")
      .setDesc("Use ts-node or tsx for TypeScript blocks.")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("ts-node", "ts-node")
          .addOption("tsx", "tsx")
          .setValue(this.loomPlugin.settings.typescriptMode)
          .onChange(async (value) => {
            this.loomPlugin.settings.typescriptMode = value as "ts-node" | "tsx";
            await this.loomPlugin.saveSettings();
          }),
      );

    this.addTextSetting(containerEl, "TypeScript transpiler executable", "Command or path for ts-node or tsx.", "typescriptTranspilerExecutable");

    new Setting(containerEl)
      .setName("OCaml mode")
      .setDesc("Choose between the OCaml toplevel, ocamlc compilation, or dune exec.")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("ocaml", "ocaml")
          .addOption("ocamlc", "ocamlc")
          .addOption("dune", "dune")
          .setValue(this.loomPlugin.settings.ocamlMode)
          .onChange(async (value) => {
            this.loomPlugin.settings.ocamlMode = value as "ocaml" | "ocamlc" | "dune";
            await this.loomPlugin.saveSettings();
          }),
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

  private renderCustomLanguages(containerEl: HTMLElement): void {
    const listEl = containerEl.createDiv({ cls: "loom-custom-language-list" });
    this.renderCustomLanguageList(listEl);

    new Setting(containerEl)
      .setName("Add custom language")
      .setDesc("Create a new local command-backed language.")
      .addButton((button) =>
        button.setButtonText("+").onClick(async () => {
          this.loomPlugin.settings.customLanguages.push({
            name: "custom-language",
            aliases: "",
            executable: "",
            args: "{file}",
            extension: ".txt",
          });
          await this.loomPlugin.saveSettings();
          this.display();
        }),
      );
  }

  private renderCustomLanguageList(containerEl: HTMLElement): void {
    containerEl.empty();

    if (!this.loomPlugin.settings.customLanguages.length) {
      containerEl.createEl("p", {
        text: "No custom languages configured.",
        cls: "setting-item-description",
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

      new Setting(body)
        .setName("Delete language")
        .setDesc("Remove this custom language.")
        .addButton((button) =>
          button.setButtonText("Delete").setWarning().onClick(async () => {
            this.loomPlugin.settings.customLanguages.splice(index, 1);
            await this.loomPlugin.saveSettings();
            this.display();
          }),
        );
    });
  }

  private async renderContainerGroups(containerEl: HTMLElement): Promise<void> {
    const listEl = containerEl.createDiv({ cls: "loom-container-group-list" });
    listEl.setText("Scanning container groups...");

    const groups = await this.loomPlugin.getContainerGroupSummaries();
    listEl.empty();

    if (!groups.length) {
      listEl.createEl("p", {
        text: "No container groups found in .obsidian/plugins/loom/containers.",
        cls: "setting-item-description",
      });
      return;
    }

    for (const group of groups) {
      new Setting(listEl)
        .setName(group.name)
        .setDesc(group.status)
        .addButton((button) =>
          button.setButtonText("Build / rebuild").onClick(async () => {
            await this.loomPlugin.buildContainerGroup(group.name);
          }),
        );
    }
  }

  private addTextSetting<K extends keyof loomPluginSettings>(containerEl: HTMLElement, name: string, description: string, key: K): void {
    new Setting(containerEl)
      .setName(name)
      .setDesc(description)
      .addText((text) =>
        text.setValue(String(this.loomPlugin.settings[key] ?? "")).onChange(async (value) => {
          (this.loomPlugin.settings[key] as string) = value.trim();
          await this.loomPlugin.saveSettings();
        }),
      );
  }

  private addCustomLanguageTextSetting<K extends keyof loomCustomLanguage>(
    containerEl: HTMLElement,
    language: loomCustomLanguage,
    name: string,
    description: string,
    key: K,
  ): void {
    new Setting(containerEl)
      .setName(name)
      .setDesc(description)
      .addText((text) =>
        text.setValue(language[key]).onChange(async (value) => {
          language[key] = value.trim();
          await this.loomPlugin.saveSettings();
        }),
      );
  }
}

export function showExecutionDisabledNotice(): void {
  new Notice("loom local execution is disabled. Enable it in settings or confirm the execution warning first.");
}
