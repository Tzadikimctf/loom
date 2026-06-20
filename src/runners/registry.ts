import type { loomCodeBlock, loomPluginSettings, loomRunner } from "../types";

export class loomRunnerRegistry {
  constructor(private readonly runners: loomRunner[]) {}

  getRunnerForBlock(block: loomCodeBlock, settings: loomPluginSettings): loomRunner | null {
    return this.runners.find((runner) => (!runner.languages.length || runner.languages.includes(block.language)) && runner.canRun(block, settings)) ?? null;
  }

  getSupportedLanguages(): string[] {
    return [...new Set(this.runners.flatMap((runner) => runner.languages))];
  }
}
