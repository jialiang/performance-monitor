import { adapt, managedwriter, protos } from "@google-cloud/bigquery-storage";

import { error } from "firebase-functions/logger";

import { ConnectionEntry, RequestEntry, ERROR, ErrorEntry } from "./definitions";
import { bigQueryOptions, resourcesToFetch } from "./config";

const { WriterClient, JSONWriter } = managedwriter;

const destinationTable =
  bigQueryOptions.datasetId != null
    ? `projects/${bigQueryOptions.projectId}/datasets/${bigQueryOptions.datasetId}` +
      `/tables/${bigQueryOptions.tableId}`
    : null;

let writeClient: InstanceType<typeof WriterClient> | null = null;
let writer: InstanceType<typeof JSONWriter> | null = null;

// Lazily create the Storage Write API stream and reuse it across invocations on a
// warm instance. Re-created on first use, or after the previous writer errored
// (the catch below clears `writer` so the next call rebuilds the connection).
const getWriter = async () => {
  if (writer) return writer;
  if (destinationTable == null) return null;

  const streamId = `${destinationTable}/streams/_default`;

  if (writeClient == null) {
    writeClient = new WriterClient({ projectId: bigQueryOptions.projectId });
  }

  const writeStream = await writeClient.getWriteStream({
    streamId,
    view: protos.google.cloud.bigquery.storage.v1.WriteStreamView.FULL,
  });

  if (writeStream.tableSchema == null) throw new Error("Missing table schema for write stream");

  const protoDescriptor = adapt.convertStorageSchemaToProto2Descriptor(
    writeStream.tableSchema,
    "root"
  );
  const connection = await writeClient.createStreamConnection({ streamId });

  writer = new JSONWriter({ connection, protoDescriptor });
  return writer;
};

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
  if (destinationTable == null) return;

  const eventContext = process.env.EVENTARC_CLOUD_EVENT_SOURCE || "";
  const region = eventContext.split("/")[3] || "UNKNOWN_REGION";

  const shouldLogToDatabase = resourcesToFetch.reduce((shouldLogToDatabase, resource) => {
    if (resource.logToDatabase === true) shouldLogToDatabase[resource.label] = true;
    return shouldLogToDatabase;
  }, {} as { [key: string]: boolean });

  const row = {
    region,
    // Storage Write API encodes TIMESTAMP as microseconds since the epoch.
    startTime: startTime * 1000,
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
    const activeWriter = await getWriter();
    if (activeWriter == null) return;

    const pendingWrite = activeWriter.appendRows([row]);
    await pendingWrite.getResult();
  } catch (appendError) {
    error("BigQuery Storage Write append failed", appendError);
    // Drop the cached writer so the next invocation rebuilds the stream.
    writer = null;
  }
};
