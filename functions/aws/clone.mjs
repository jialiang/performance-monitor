import { execFileSync } from "node:child_process";

import { awsRegions } from "../lib/config.js";

const awsDir = new URL(".", import.meta.url).pathname;

// SAM's upload bucket is shared by every SAM project in the region,
// so this project uploads under its own prefix and only cleans that up.
const uploadPrefix = "check";

const aws = (region, args) => {
  const output = execFileSync("aws", [...args, "--region", region, "--output", "json"], {
    encoding: "utf8",
  });

  return output.trim() ? JSON.parse(output) : null;
};

// Delete this project's uploads after deployment.
// samconfig.yaml has rollback off, so they're never needed again.
// Note storage in S3 bucket incurs cost and is only 0 because of rounding
const emptyUploadBucket = (region) => {
  const bucket = aws(region, [
    "cloudformation",
    "describe-stacks",
    "--stack-name",
    "aws-sam-cli-managed-default",
    "--query",
    "Stacks[0].Outputs[?OutputKey=='SourceBucket'].OutputValue | [0]",
  ]);

  const versions = aws(region, [
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
  aws(region, ["s3api", "delete-objects", "--bucket", bucket, "--delete", deletion]);
  console.log(`Deleted ${versions.length} uploads from ${bucket}`);
};

if (awsRegions.length === 0) {
  console.log("AWS_REGIONS is empty: nothing to deploy.");
  process.exit(0);
}

execFileSync("sam", ["build"], { cwd: awsDir, stdio: "inherit" });

for (const region of awsRegions) {
  console.log(`\nDeploying to ${region}`);
  const deployArgs = ["deploy", "--region", region, "--s3-prefix", uploadPrefix];
  execFileSync("sam", deployArgs, { cwd: awsDir, stdio: "inherit" });
  emptyUploadBucket(region);
}

