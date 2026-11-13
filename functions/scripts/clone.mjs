import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

import { callRegions, checkOptions, deployRegions } from "../lib/config.js";

const firebaseRcPath = new URL("../../.firebaserc", import.meta.url);
const projectId = JSON.parse(readFileSync(firebaseRcPath, "utf-8")).projects.default;

const gcloud = (args, options) =>
  execFileSync("gcloud", [...args, `--project=${projectId}`], { encoding: "utf-8", ...options });

const cloneRegions = callRegions.filter((region) => !deployRegions.includes(region));

if (cloneRegions.length === 0) {
  console.log("Every region in CALL_REGIONS is in DEPLOY_REGIONS: nothing to clone.");
  process.exit(0);
}

const sourceRegion = deployRegions[0];
const sourceService = JSON.parse(
  gcloud(["run", "services", "describe", "check", `--region=${sourceRegion}`, "--format=json"])
);
const { metadata, spec } = sourceService.spec.template;
const image = spec.containers[0].image;

// Determine which Docker image to use, should correspond to runtime in firebase.json
const baseImages = metadata.annotations["run.googleapis.com/base-images"];
const sourceBaseImage = baseImages && JSON.parse(baseImages).worker;

for (const region of cloneRegions) {
  console.log(`\nCloning ${image} to ${region}`);

  const baseImage = sourceBaseImage?.replace(`${sourceRegion}-docker`, `${region}-docker`);

  // Environment variables used by the check that Firebase normally adds automatically.
  const environment = [
    "FUNCTION_TARGET=check",
    `GCLOUD_PROJECT=${projectId}`,
    `EVENTARC_CLOUD_EVENT_SOURCE=projects/${projectId}/locations/${region}/services/check`,
  ];

  // Firebase writes memory as "256MiB" where gcloud expects "256Mi".
  // It also turns on startup CPU boost by itself, with no option to mirror here.
  gcloud(
    [
      "run",
      "deploy",
      "check",
      `--region=${region}`,
      `--image=${image}`,
      ...(baseImage ? [`--base-image=${baseImage}`] : []),
      ...(checkOptions.serviceAccount ? [`--service-account=${checkOptions.serviceAccount}`] : []),
      "--no-allow-unauthenticated",
      `--cpu=${checkOptions.cpu}`,
      `--memory=${checkOptions.memory.replace(/B$/, "")}`,
      `--concurrency=${checkOptions.concurrency}`,
      `--max-instances=${checkOptions.maxInstances}`,
      `--timeout=${checkOptions.timeoutSeconds}`,
      "--cpu-boost",
      `--set-env-vars=${environment.join(",")}`,
    ],
    { stdio: "inherit" }
  );

  gcloud(
    [
      "run",
      "services",
      "add-iam-policy-binding",
      "check",
      `--region=${region}`,
      `--member=serviceAccount:${checkOptions.invoker}`,
      "--role=roles/run.invoker",
      "--format=none",
    ],
    { stdio: "inherit" }
  );
}
