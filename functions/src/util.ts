import { BigQuery } from "@google-cloud/bigquery";

import { error } from "firebase-functions/logger";

import { ConnectionEntry, RequestEntry, ERROR, ErrorEntry } from "./definitions";
import { bigQueryOptions, resourcesToFetch } from "./config";

const table =
  bigQueryOptions.datasetId != null
    ? new BigQuery({ projectId: bigQueryOptions.projectId })
      .dataset(bigQueryOptions.datasetId)
      .table(bigQueryOptions.tableId)
    : null;

export const handleError = (error: ERROR, parent?: ConnectionEntry | RequestEntry) => {
  const entry = {} as ErrorEntry;

  const keys = Object.getOwnPropertyNames(error) as (keyof ERROR)[];

  keys.forEach((key) => {
    const value = error[key];
    const type = typeof value;

    if (key === "stack") return;
    if (type !== "string" && type !== "number" && type !== "boolean") return;
    if (value == null) return;

    entry[key] = value;
  });

  if (parent) {
    if (Array.isArray(parent.errors)) parent.errors.push(entry);
    else parent.errors = [entry];
  }

  return entry;
};

const toJsonString = (value: object | object[] | undefined) => {
  if (value == null) return null;
  if (Array.isArray(value) && value.length === 0) return null;
  return JSON.stringify(value);
};

export const logToDatabase = async (
  startTime: number,
  connection: ConnectionEntry,
  requests: RequestEntry[]
) => {
  if (table == null) return;

  const eventContext = process.env.EVENTARC_CLOUD_EVENT_SOURCE || "";
  const region = eventContext.split("/")[3] || "UNKNOWN_REGION";

  const shouldLogToDatabase = resourcesToFetch.reduce((shouldLogToDatabase, resource) => {
    if (resource.logToDatabase === true) shouldLogToDatabase[resource.label] = true;
    return shouldLogToDatabase;
  }, {} as { [key: string]: boolean });

  const row = {
    region,
    startTime: new Date(startTime).toISOString(),
    dnsLookupStart: connection.dnsLookupStart ?? null,
    dnsLookupEnd: connection.dnsLookupEnd ?? null,
    tcpDone: connection.tcpDone ?? null,
    tlsDone: connection.tlsDone ?? null,
    errors: toJsonString(connection.errors),
    requests: requests
      .filter((request) => shouldLogToDatabase[request.filename])
      .map((request) => ({
        filename: request.filename,
        requestSent: request.requestSent ?? null,
        responseStart: request.responseStart ?? null,
        responseEnd: request.responseEnd ?? null,
        responseHeaders: toJsonString(request.responseHeaders),
        errors: toJsonString(request.errors),
      })),
  };

  try {
    await table.insert([row]);
  } catch (insertError) {
    // Log the raw error: a BigQuery PartialFailureError carries the per-row
    // failure detail in `.errors`, which must not be stripped.
    error("BigQuery insert failed", insertError);
  }
};
