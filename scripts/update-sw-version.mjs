import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

async function listFiles(directory) {
  let entries;
  try { entries = await readdir(directory, { withFileTypes: true }); }
  catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  const files = [];
  for (const entry of entries) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...await listFiles(path));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

// The worker itself is excluded to avoid hashing its generated version recursively.
export async function sourceVersion(root = projectRoot) {
  const files = (await Promise.all(["app", "components", "lib", "public/icons"].map((path) => listFiles(resolve(root, path))))).flat();
  // Explicit optional files cover configuration/dependency releases without reading environment values.
  for (const name of ["public/logo.png", "package.json", "package-lock.json", "next.config.ts", "postcss.config.mjs"]) {
    const path = resolve(root, name);
    try { await readFile(path); files.push(path); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  files.sort((a, b) => {
    const left = relative(root, a).replaceAll("\\", "/");
    const right = relative(root, b).replaceAll("\\", "/");
    return left < right ? -1 : left > right ? 1 : 0;
  });
  const hash = createHash("sha256");
  for (const path of files) {
    const name = relative(root, path).replaceAll("\\", "/");
    const contents = await readFile(path);
    hash.update(`${name.length}:${name}\0${contents.length}:`);
    hash.update(contents);
    hash.update("\0");
  }
  return hash.digest("hex").slice(0, 20);
}

export async function updateWorkerVersion(root = projectRoot) {
  const version = await sourceVersion(root);
  const path = resolve(root, "public/sw.js");
  const previous = await readFile(path, "utf8");
  const marker = /^const SHELL_CACHE = "nossa-viagem-shell-[A-Za-z0-9_-]+";$/m;
  if (!marker.test(previous)) throw new Error("O marcador de versão não foi encontrado no service worker.");
  const next = previous.replace(marker, `const SHELL_CACHE = "nossa-viagem-shell-${version}";`);
  if (previous !== next) await writeFile(path, next, "utf8");
  return version;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void updateWorkerVersion().then((version) => {
    console.log(`PWA: versão ${version} preparada para a publicação.`);
  }, (error) => {
    console.error("Não foi possível preparar a versão da PWA:", error.message);
    process.exitCode = 1;
  });
}
