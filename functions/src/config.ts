import fs from "fs";
import path from "path";

import type { HttpsOptions } from "firebase-functions/v2/https";

const envPath = path.resolve(process.cwd(), "env.jsonc");
const envJsoncString = fs.readFileSync(envPath, { encoding: "utf-8" });
const envJsonString = envJsoncString.replace(/\s\/\/.*/gi, "");
const env = JSON.parse(envJsonString);

export const schedulerServiceAccount = env.SCHEDULER_SERVICE_ACCOUNT;
export const functionServiceAccount = env.FUNCTION_SERVICE_ACCOUNT;

export const hostname = env.HOSTNAME;

export const deployRegions = env.DEPLOY_REGIONS as string[];
export const callRegions = env.CALL_REGIONS as string[];

export const projectNumber = env.PROJECT_NUMBER as string;

export const checkOptions: HttpsOptions = {
  region: deployRegions,
  timeoutSeconds: 20,
  maxInstances: 1,
  concurrency: 1,
  cpu: 0.25,
  memory: "256MiB",
  serviceAccount: functionServiceAccount,
  invoker: schedulerServiceAccount,
};

export const bigQueryOptions = {
  projectId: env.BIGQUERY_PROJECT || process.env.GCLOUD_PROJECT || undefined,
  datasetId: env.BIGQUERY_DATASET as string | undefined,
  tableId: (env.BIGQUERY_TABLE as string) || "connections",
};
