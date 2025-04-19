import postgres from "postgres";

import { ConnectionEntry, RequestEntry, ERROR, ErrorEntry } from "./definitions";
import { postgresOptions, resourcesToFetch } from "./config";

const sql = postgresOptions.host ? postgres(postgresOptions) : null;

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

export const prepareValueForSql = (
  value: number | string | object | object[] | undefined,
  type: "int" | "text" | "json" | "json[]"
) => {
  if (value == null) return "null";

  switch (type) {
    case "int":
      return value;

    case "text":
      return `'${value}'`;

    case "json":
      return `'${JSON.stringify(value).replace(/'/g, "''")}'`;

    case "json[]":
      if (value instanceof Array && value.length === 0) {
        return `array[${value
          .map((v) => `'${JSON.stringify(v).replace(/'/g, "''")}'`)
          .join(",")}]`;
      }
  }

  return "null";
};

export const logToDatabase = async (
  startTime: number,
  connection: ConnectionEntry,
  requests: RequestEntry[]
) => {
  if (sql == null) return;

  const eventContext = process.env.EVENTARC_CLOUD_EVENT_SOURCE || "";
  const region = eventContext.split("/")[3] || "UNKNOWN_REGION";

  const shouldLogToDatabase = resourcesToFetch.reduce((shouldLogToDatabase, resource) => {
    if (resource.logToDatabase === true) shouldLogToDatabase[resource.label] = true;
    return shouldLogToDatabase;
  }, {} as { [key: string]: boolean });

  const connectionValues = [
    prepareValueForSql(region, "text"),
    prepareValueForSql(new Date(startTime).toISOString(), "text"),
    prepareValueForSql(connection.dnsLookupStart, "int"),
    prepareValueForSql(connection.dnsLookupEnd, "int"),
    prepareValueForSql(connection.tcpDone, "int"),
    prepareValueForSql(connection.tlsDone, "int"),
    prepareValueForSql(connection.errors, "json[]"),
  ];

  const requestValues = requests
    .map((request) => {
      if (!shouldLogToDatabase[request.filename]) return "";

      const fields = [
        prepareValueForSql(request.filename, "text"),
        prepareValueForSql(request.requestSent, "int"),
        prepareValueForSql(request.responseStart, "int"),
        prepareValueForSql(request.responseEnd, "int"),
        prepareValueForSql(request.responseHeaders, "json"),
        prepareValueForSql(request.errors, "json[]"),
      ];

      return `(${fields.join(",")})`;
    })
    .filter((request) => request);

  const query = `
    with connection as (
      insert into "Connections" (
        "region",
        "startTime",
        "dnsLookupStart",
        "dnsLookupEnd",
        "tcpDone",
        "tlsDone",
        "errors"
      ) values (${connectionValues.join(",")})
      returning "id"
    ),
    requests (
      "filename",
      "requestSent",
      "responseStart",
      "responseEnd",
      "responseHeaders",
      "errors"
    ) as (values ${requestValues.join(",")})

    insert into "Requests" (
      "connectionId",
      "filename",
      "requestSent",
      "responseStart",
      "responseEnd",
      "responseHeaders",
      "errors"
    ) select
      "connection"."id",
      "filename",
      "requestSent",
      "responseStart",
      "responseEnd",
      "responseHeaders"::json,
      "errors"::json[]
    from connection cross join requests;
  `;

  let sqlError;

  try {
    await sql.unsafe(query);
  } catch (error) {
    sqlError = handleError(error as ERROR);
  }

  if (sqlError) throw sqlError;
};

export const purgeOldData = async () => {
  if (sql == null) return 200;

  let sqlError;

  try {
    await sql`
      delete from "Connections"
      where "startTime" < current_timestamp - interval '7 days';
    `;
  } catch (error) {
    sqlError = handleError(error as ERROR);
  }

  if (sqlError) throw sqlError;

  return 200;
};
