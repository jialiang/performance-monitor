import { PoolConfig } from "pg";

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
}[];

export const regions = env.REGIONS as string[];

export const postgres = {
  host: env.POSTGRES_HOST,
  port: parseInt(env.POSTGRES_PORT || "") || 5432,
  database: env.POSTGRES_DATABASE || "default",
  user: env.POSTGRES_USER || "postgres",
  password: env.POSTGRES_PASSWORD || "",
  max: Math.max(regions.length + 1, 10),
} as PoolConfig;
