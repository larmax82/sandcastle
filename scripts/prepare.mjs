import { execSync } from "node:child_process";
import { existsSync } from "node:fs";

if (existsSync(".git")) {
  try {
    execSync("husky", { stdio: "inherit" });
  } catch {
    // husky setup is non-fatal; only useful in dev checkouts of the repo
  }
}

execSync("npm run build", { stdio: "inherit" });

if (!existsSync("dist/main.js")) {
  console.error(
    "ERROR: prepare finished but dist/main.js is missing — the build did not produce a working bin entry. Refusing to ship an empty package.",
  );
  process.exit(1);
}
