import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const metadataPath = path.join(__dirname, "..", "metadata.json");

try {
	const stdout = execSync("cargo metadata --format-version 1 --no-deps", {
		encoding: "utf8",
	});
	const parsed = JSON.parse(stdout);

	const metadata = {};
	if (parsed.packages && Array.isArray(parsed.packages)) {
		parsed.packages.forEach((pkg) => {
			if (pkg.name && pkg.version) {
				metadata[pkg.name] = pkg.version;
			}
		});
	}

	fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2), "utf8");
	console.log(
		`✓ Generated metadata.json with ${Object.keys(metadata).length} packages`,
	);
} catch (error) {
	console.error("Error generating metadata.json:", error.message);
	process.exit(1);
}
