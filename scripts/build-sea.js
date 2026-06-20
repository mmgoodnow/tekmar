import { spawn } from "node:child_process";
import { chmod, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build as viteBuild } from "vite";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const seaDir = join(repoRoot, "sea");
const entitlementsPath = join(repoRoot, "entitlements.plist");
const nodeVersion = process.env.NODE_VERSION ?? process.version;
const notaryProfile = process.env.NOTARY_PROFILE;
const targetFilter = process.env.SEA_TARGETS?.split(",").map((target) => target.trim()).filter(Boolean);

const targets = [
  { os: "darwin", arch: "x64", archive: "tar.xz", binPath: "bin/node" },
  { os: "darwin", arch: "arm64", archive: "tar.xz", binPath: "bin/node" },
  { os: "linux", arch: "x64", archive: "tar.xz", binPath: "bin/node" },
  { os: "linux", arch: "arm64", archive: "tar.xz", binPath: "bin/node" },
].filter(({ os, arch }) => !targetFilter || targetFilter.includes(`${os}-${arch}`));

function run(command, args, options = {}) {
  console.log(`> ${[command, ...args].join(" ")}`);
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: repoRoot,
      stdio: "inherit",
      ...options,
    });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) return resolve();
      reject(new Error(`${command} exited with ${signal ?? `status ${code}`}`));
    });
	});
}

function output(command, args, options = {}) {
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, {
			cwd: repoRoot,
			stdio: ["ignore", "pipe", "pipe"],
			...options,
		});
		let stdout = "";
		let stderr = "";
		child.stdout.on("data", (chunk) => {
			stdout += chunk;
		});
		child.stderr.on("data", (chunk) => {
			stderr += chunk;
		});
		child.on("error", reject);
		child.on("exit", (code, signal) => {
			if (code === 0) return resolve(stdout);
			reject(new Error(`${command} exited with ${signal ?? `status ${code}`}: ${stderr}`));
		});
	});
}

async function download(url, outputPath) {
  const response = await fetch(url);
  if (!response.ok || !response.body) {
    throw new Error(`Failed to download ${url}: ${response.status}`);
  }
  await writeFile(outputPath, new Uint8Array(await response.arrayBuffer()));
}

async function getNodeExecutable({ os, arch, archive, binPath }) {
  const distName = `node-${nodeVersion}-${os}-${arch}`;
  const archiveName = `${distName}.${archive}`;
  const archivePath = join(seaDir, archiveName);
  const extractDir = join(seaDir, "node-binaries", `${os}-${arch}`);
  const executablePath = join(extractDir, distName, binPath);

  await rm(extractDir, { recursive: true, force: true });
  await mkdir(extractDir, { recursive: true });

  const url = `https://nodejs.org/dist/${nodeVersion}/${archiveName}`;
  console.log(`Downloading ${url}`);
  await download(url, archivePath);
  await run("tar", ["-xf", archivePath, "-C", extractDir]);
  await rm(archivePath);
  await chmod(executablePath, 0o755);
  return executablePath;
}

async function buildBundle(bundlePath) {
  await viteBuild({
    configFile: false,
    root: repoRoot,
    publicDir: false,
    logLevel: "warn",
    build: {
      emptyOutDir: false,
      minify: false,
      outDir: seaDir,
      ssr: join(repoRoot, "dist/homekit-cli.js"),
      target: "node26",
      rollupOptions: {
        output: {
          banner: 'import { createRequire as __tekmarCreateRequire } from "node:module";\nconst require = __tekmarCreateRequire(import.meta.url);',
          entryFileNames: basename(bundlePath),
          format: "es",
        },
      },
    },
    ssr: {
      noExternal: true,
    },
  });
}

async function signDarwinBinary(outputPath) {
  if (process.platform !== "darwin") return;
  const identity = await codeSignIdentity();
  if (notaryProfile && !identity.startsWith("Developer ID Application:")) {
    throw new Error(`Notarization requires a Developer ID Application certificate. Found: ${identity}`);
  }
  await run("codesign", ["--force", "--timestamp", "--options", "runtime", "--entitlements", entitlementsPath, "--sign", identity, outputPath]);
  await run("codesign", ["--verify", "--strict", "--verbose=2", outputPath]);
  console.log(`Signed ${outputPath} with ${identity}`);
  await notarizeDarwinBinary(outputPath);
}

async function codeSignIdentity() {
	if (process.env.CODESIGN_IDENTITY) return process.env.CODESIGN_IDENTITY;
	const identities = await output("security", ["find-identity", "-v", "-p", "codesigning"]);
	const names = [...identities.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
	return (
		names.find((name) => name.startsWith("Developer ID Application:")) ??
		names.find((name) => name.startsWith("Apple Development:")) ??
		"-"
	);
}

async function notarizeDarwinBinary(outputPath) {
	if (!notaryProfile) return;
	const zipPath = `${outputPath}.zip`;
	await rm(zipPath, { force: true });
	await run("ditto", ["-c", "-k", "--keepParent", outputPath, zipPath]);
	const raw = await output("xcrun", ["notarytool", "submit", zipPath, "--keychain-profile", notaryProfile, "--wait", "--output-format", "json"]);
	const result = JSON.parse(raw);
	if (result.status !== "Accepted") {
		throw new Error(`Notarization ${result.id ?? "submission"} finished with status ${result.status}. Run: xcrun notarytool log ${result.id} --keychain-profile ${notaryProfile}`);
	}
	console.log(`Notarized ${outputPath} with profile ${notaryProfile}`);
}

async function buildTarget(target, bundlePath) {
  const targetName = `${target.os}-${target.arch}`;
  const nodeExecutable = await getNodeExecutable(target);
  const outputPath = join(seaDir, `tekmar-homekit-${targetName}${extname(basename(target.binPath))}`);
  const configPath = join(seaDir, `sea-${targetName}.json`);

  await rm(outputPath, { force: true });
  await writeFile(
    configPath,
    JSON.stringify(
      {
        main: bundlePath,
        mainFormat: "module",
        executable: nodeExecutable,
        output: outputPath,
        disableExperimentalSEAWarning: true,
        useCodeCache: false,
        useSnapshot: false,
      },
      null,
      2,
    ),
  );

  await run(process.execPath, ["--build-sea", configPath]);
  if (target.os === "darwin") await signDarwinBinary(outputPath);
  console.log(`Built ${outputPath}`);
}

async function main() {
  if (targets.length === 0) throw new Error("SEA_TARGETS did not match any known targets");
  await rm(seaDir, { recursive: true, force: true });
  await mkdir(seaDir, { recursive: true });

  const bundlePath = join(seaDir, "homekit-bundle.mjs");
  await buildBundle(bundlePath);
  for (const target of targets) await buildTarget(target, bundlePath);

  await rm(join(seaDir, "node-binaries"), { recursive: true, force: true });
  await rm(join(tmpdir(), "node-compile-cache"), { recursive: true, force: true });
}

await main();
