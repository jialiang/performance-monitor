import fs from "fs";
import path from "path";

const envPath = path.resolve(process.cwd(), "env.jsonc");
const envJsoncString = fs.readFileSync(envPath, { encoding: "utf-8" });
const envJsonString = envJsoncString.replace(/\s\/\/.*/gi, "");
const env = JSON.parse(envJsonString);

export const schedulerServiceAccount = env.SCHEDULER_SERVICE_ACCOUNT;
export const functionServiceAccount = env.FUNCTION_SERVICE_ACCOUNT;

export const hostname = env.HOSTNAME;

export const resourcesToFetch = env.RESOURCES as {
  path: string;
  label: string;
  logToDatabase?: boolean;
}[];

export const regions = env.REGIONS as string[];

export const bigQueryOptions = {
  projectId: env.BIGQUERY_PROJECT || process.env.GCLOUD_PROJECT || undefined,
  datasetId: env.BIGQUERY_DATASET as string | undefined,
  tableId: (env.BIGQUERY_TABLE as string) || "connections",
};
