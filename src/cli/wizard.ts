// =============================================================================
// @migrare/cli — Interactive wizard
//
// Runs when `npx migrare` is called with no arguments.
// Guides the user through: detect → scan → review → migrate.
//
// DESIGN: The wizard is a simple async state machine — each step is a method
// that either resolves (moving to the next step) or loops (on invalid input).
// It uses Node's readline/promises API — no external prompt libraries.
//
// AUDIENCE: People who are comfortable enough to run npx but may not know the
// full CLI syntax. The wizard discovers and explains; the CLI commands execute.
//
// TONE: Matches the brand voice — direct, unhurried, no exclamation marks.
// Progress is shown as plain text with ANSI colour, not spinner animations.
// Runs when `npx migrare` is called with no arguments.
// Guides the user through: detect → scan → review → migrate
// =============================================================================

import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { createEngine } from "../index.js";
import { formatScanReport } from "./formatter.js";

const GREEN  = "\x1b[32m";
const DIM    = "\x1b[2m";
const BOLD   = "\x1b[1m";
const RESET  = "\x1b[0m";
const CYAN   = "\x1b[36m";
const YELLOW = "\x1b[33m";
const RED    = "\x1b[31m";

export class WizardFlow {
  private rl = readline.createInterface({ input, output });

  async run(): Promise<void> {
    this.printBanner();
    await this.sleep(400);

    try {
      await this.stepWelcome();
    } finally {
      this.rl.close();
    }
  }

  // ---------------------------------------------------------------------------
  // Steps
  // ---------------------------------------------------------------------------

  private async stepWelcome(): Promise<void> {
    this.line();
    this.print(`  ${DIM}Your code belongs to you.${RESET}`);
    this.print(`  migrare scans your project for vendor lock-in and migrates it`);
    this.print(`  to a clean, portable codebase you fully own.\n`);

    const choice = await this.select("What would you like to do?", [
      { key: "1", label: "Scan a project       — detect lock-in signals (read-only)" },
      { key: "2", label: "Migrate a project    — scan + transform + export" },
      { key: "3", label: "Open web UI          — browser interface (recommended)" },
      { key: "q", label: "Quit" },
    ]);

    switch (choice) {
      case "1": return this.stepScan();
      case "2": return this.stepMigrate();
      case "3": return this.stepOpenUI();
      case "q": return this.stepQuit();
    }
  }

  private async stepScan(): Promise<void> {
    this.line();
    const path = await this.ask(
      `  ${CYAN}Project path${RESET} ${DIM}(relative or absolute)${RESET}`,
      "./my-project"
    );

    this.print(`\n  ${DIM}Scanning...${RESET}\n`);
    const engine = await createEngine({ runtime: "cli" });

    try {
      const report = await engine.scan(path);
      formatScanReport(report, { quiet: false });

      if (report.summary.total > 0) {
        const migrate = await this.confirm(
          `\n  Found ${report.summary.total} signal(s). Ready to migrate?`
        );
        if (migrate) return this.stepMigrateWithPath(path);
      } else {
        this.print(`\n  ${GREEN}✓${RESET} No lock-in signals detected. Project looks portable!\n`);
      }
    } catch (err) {
      this.print(`\n  ${RED}✗${RESET} Scan failed: ${(err as Error).message}\n`);
    }

    await this.confirm("  Return to main menu?", true);
    return this.stepWelcome();
  }

  private async stepMigrate(): Promise<void> {
    this.line();
    const path = await this.ask(
      `  ${CYAN}Project path${RESET} ${DIM}(relative or absolute)${RESET}`,
      "./my-project"
    );
    return this.stepMigrateWithPath(path);
  }

  private async stepMigrateWithPath(projectPath: string): Promise<void> {
    this.line();

    const targetAdapter = await this.select("Output target?", [
      { key: "1", label: "Vite + React    — framework-agnostic (recommended)" },
      { key: "2", label: "Next.js         — App Router structure" },
    ]);
    const adapter = targetAdapter === "1" ? "vite" : "nextjs";

    const defaultOut = projectPath.replace(/\/$/, "") + "-migrated";
    const outputPath = await this.ask(
      `  ${CYAN}Output path${RESET}`,
      defaultOut
    );

    const dryRun = await this.confirm(
      `  Dry run first? ${DIM}(preview changes without writing files)${RESET}`
    );

    this.line();
    this.print(`  ${DIM}Summary${RESET}`);
    this.print(`  ${DIM}·${RESET} source   ${projectPath}`);
    this.print(`  ${DIM}·${RESET} target   ${adapter}`);
    this.print(`  ${DIM}·${RESET} output   ${outputPath}`);
    this.print(`  ${DIM}·${RESET} dry run  ${dryRun ? "yes" : "no"}\n`);

    const confirmed = await this.confirm("  Proceed?");
    if (!confirmed) {
      this.print(`\n  ${DIM}Cancelled.${RESET}\n`);
      return this.stepWelcome();
    }

    const engine = await createEngine({ runtime: "cli" });

    engine.on("progress", (event) => {
      const pct = Math.round((event.current / event.total) * 100);
      process.stdout.write(
        `\r  ${GREEN}▸${RESET} ${event.step.padEnd(42)} ${DIM}${pct}%${RESET}  `
      );
      if (event.current === event.total) process.stdout.write("\n");
    });

    try {
      const result = await engine.migrate(projectPath, {
        targetAdapter: adapter,
        targetPath: outputPath,
        dryRun,
      });

      this.line();
      if (result.success) {
        this.print(`  ${GREEN}✓ Migration complete${RESET}\n`);
        this.print(`  ${DIM}files written  ${RESET}${result.outputResult.written.length}`);
        this.print(`  ${DIM}duration       ${RESET}${result.duration}ms`);
        if (!dryRun) {
          this.print(`\n  ${DIM}Next steps:${RESET}`);
          this.print(`    cd ${outputPath}`);
          this.print(`    npm install`);
          this.print(`    npm run dev`);
        }
      } else {
        this.print(`  ${RED}✗ Migration completed with errors${RESET}`);
        for (const err of result.errors) {
          this.print(`    ${RED}·${RESET} [${err.code}] ${err.message}`);
        }
      }
    } catch (err) {
      this.print(`\n  ${RED}✗${RESET} Migration failed: ${(err as Error).message}\n`);
    }

    this.print("");
    await this.confirm("  Return to main menu?", true);
    return this.stepWelcome();
  }

  private async stepOpenUI(): Promise<void> {
    const { startServer } = await import("../server/index.js");
    const port = 4242;
    this.print(`\n  ${GREEN}▸${RESET} Starting web UI on port ${port}...\n`);
    await startServer({ port, openBrowser: true });
    // Server runs until killed — wizard ends here
  }

  private async stepQuit(): Promise<void> {
    this.print(`\n  ${DIM}migrare — your code belongs to you.${RESET}\n`);
    process.exit(0);
  }

  // ---------------------------------------------------------------------------
  // UI primitives
  // ---------------------------------------------------------------------------

  private async select(
    prompt: string,
    options: Array<{ key: string; label: string }>
  ): Promise<string> {
    this.print(`\n  ${BOLD}${prompt}${RESET}\n`);
    for (const opt of options) {
      this.print(`    ${DIM}[${opt.key}]${RESET}  ${opt.label}`);
    }
    this.print("");

    const validKeys = options.map((o) => o.key);
    while (true) {
      const answer = (await this.rl.question(`  ${DIM}›${RESET} `)).trim().toLowerCase();
      if (validKeys.includes(answer)) return answer;
      this.print(`  ${YELLOW}Please choose: ${validKeys.join(", ")}${RESET}`);
    }
  }

  private async ask(prompt: string, defaultVal?: string): Promise<string> {
    const hint = defaultVal ? ` ${DIM}[${defaultVal}]${RESET}` : "";
    const answer = (await this.rl.question(`\n${prompt}${hint}\n  ${DIM}›${RESET} `)).trim();
    return answer || defaultVal || "";
  }

  private async confirm(prompt: string, defaultYes = false): Promise<boolean> {
    const hint = defaultYes ? "Y/n" : "y/N";
    const answer = (
      await this.rl.question(`${prompt} ${DIM}(${hint})${RESET} `)
    ).trim().toLowerCase();
    if (!answer) return defaultYes;
    return answer === "y" || answer === "yes";
  }

  private printBanner(): void {
    console.clear();
    console.log(`
${GREEN}  ╔╦╗╦╔═╗╦═╗╔═╗╦═╗╔═╗${RESET}
${GREEN}  ║║║║║ ╦╠╦╝╠═╣╠╦╝║╣ ${RESET}
${GREEN}  ╩ ╩╩╚═╝╩╚═╩ ╩╩╚═╚═╝${RESET}
  ${DIM}v0.1.0 — escape vendor lock-in${RESET}
`);
  }

  private line(): void {
    console.log(`\n  ${DIM}${"─".repeat(52)}${RESET}`);
  }

  private print(msg: string): void {
    console.log(msg);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }
}
