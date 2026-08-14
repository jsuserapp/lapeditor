import { spawn } from "node:child_process";

const args = process.argv.slice(2);

// `pnpm dev` should not rebuild/restart on Rust edits.
// Keep manual restarts: stop and run the command again when needed.
if (args[0] === "dev" && !args.includes("--") && !args.includes("--no-watch")) {
  args.push("--no-watch");
}

const isWin = process.platform === "win32";
const bin = isWin ? "tauri.cmd" : "tauri";

function quoteForCmd(arg) {
  if (/^[a-zA-Z0-9_\-./:=+,]+$/.test(arg)) {
    return arg;
  }
  return `"${arg.replace(/"/g, '\\"')}"`;
}

let child;
if (isWin) {
  const command = [bin, ...args.map(quoteForCmd)].join(" ");
  child = spawn(command, { stdio: "inherit", shell: true });
} else {
  child = spawn(bin, args, { stdio: "inherit" });
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    if (!child.killed) {
      child.kill(signal);
    }
  });
}

child.on("close", (code) => {
  process.exit(code ?? 1);
});
