import { exec, execFile } from "node:child_process";
import { copyFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { build } from "esbuild";

import { awsRegions } from "../lib/config.js";

const runFile = promisify(execFile);
const runShell = promisify(exec);

const awsDir = fileURLToPath(new URL(".", import.meta.url));
const functionsDir = fileURLToPath(new URL("..", import.meta.url));
const distDir = fileURLToPath(new URL("dist/", import.meta.url));

// SAM's upload bucket is shared by every SAM project in the region,
// so this project uploads under its own prefix and only cleans that up.
const uploadPrefix = "check";

const aws = async (region, args) => {
  const { stdout } = await runFile("aws", [...args, "--region", region, "--output", "json"]);
  return stdout.trim() ? JSON.parse(stdout) : null;
};

const bundle = async () => {
  rmSync(distDir, { recursive: true, force: true });

  await build({
    entryPoints: [`${awsDir}handler.mjs`],
    outfile: `${distDir}handler.js`,
    bundle: true,
    minify: true,
    platform: "node",
    target: "node24",
    // Bundled dependencies use require()
    format: "cjs",
    logLevel: "warning",
  });

  // Read from the working directory at runtime, on Lambda it is the package root
  copyFileSync(`${functionsDir}env.jsonc`, `${distDir}env.jsonc`);
  copyFileSync(`${awsDir}google-credentials.json`, `${distDir}google-credentials.json`);
};

// Delete this project's uploads after deployment.
// samconfig.yaml has rollback off, so they're never needed again.
// Note storage in S3 bucket incurs cost and is only 0 because of rounding
const emptyUploadBucket = async (region) => {
  const bucket = await aws(region, [
    "cloudformation",
    "describe-stacks",
    "--stack-name",
    "aws-sam-cli-managed-default",
    "--query",
    "Stacks[0].Outputs[?OutputKey=='SourceBucket'].OutputValue | [0]",
  ]);

  const versions = await aws(region, [
    "s3api",
    "list-object-versions",
    "--bucket",
    bucket,
    "--prefix",
    `${uploadPrefix}/`,
    "--query",
    "[Versions, DeleteMarkers][][].{Key: Key, VersionId: VersionId}",
  ]);

  if (!versions?.length) return;

  const deletion = JSON.stringify({ Objects: versions, Quiet: true });
  await aws(region, ["s3api", "delete-objects", "--bucket", bucket, "--delete", deletion]);
};

// On Windows sam is a batch file (sam.cmd), which only runs through a shell.
// Without --template-file, sam deploy prefers .aws-sam/build/template.yaml
// from any earlier `sam build` which would deploy an old package.
const deploy = async (region) => {
  const command = [
    "sam deploy",
    "--template-file template.yaml",
    `--region ${region}`,
    `--s3-prefix ${uploadPrefix}`,
  ].join(" ");

  await runShell(command, { cwd: awsDir, maxBuffer: 10 * 1024 * 1024 });
  await emptyUploadBucket(region);
  console.log(`Deployed to ${region}`);
};

if (awsRegions.length === 0) {
  console.log("AWS_REGIONS is empty: nothing to deploy.");
  process.exit(0);
}

await bundle();

const results = await Promise.allSettled(awsRegions.map(deploy));
const failures = results
  .map((result, index) => ({ result, region: awsRegions[index] }))
  .filter(({ result }) => result.status === "rejected");

for (const { result, region } of failures) {
  const { message, stdout = "", stderr = "" } = result.reason;
  console.error(`\nFailed to deploy to ${region}: ${message}\n${stdout}${stderr}`);
}

if (failures.length > 0) process.exit(1);
