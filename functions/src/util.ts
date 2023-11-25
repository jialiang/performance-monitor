import { Pool } from "pg";

import { ConnectionEntry, RequestEntry, ERROR, ErrorEntry } from "./definitions";
import { postgres } from "./config";

const pool = postgres.host ? new Pool(postgres) : null;

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
      return `'${JSON.stringify(value)}'`;

    case "json[]":
      if (value instanceof Array && value.length === 0) {
        return `array[${value.map((v) => `'${JSON.stringify(v)}'`).join(",")}]`;
      }
  }

  return "null";
};

export const logToDatabase = async (
  startTime: number,
  connection: ConnectionEntry,
  requests: RequestEntry[]
) => {
  if (pool == null) return;

  const eventContext = process.env.EVENTARC_CLOUD_EVENT_SOURCE || "";
  const region = eventContext.split("/")[3] || "UNKNOWN_REGION";

  const connectionValues = [
    prepareValueForSql(region, "text"),
    prepareValueForSql(new Date(startTime).toISOString(), "text"),
    prepareValueForSql(connection.dnsLookupStart, "int"),
    prepareValueForSql(connection.dnsLookupEnd, "int"),
    prepareValueForSql(connection.tcpDone, "int"),
    prepareValueForSql(connection.tlsDone, "int"),
    prepareValueForSql(connection.errors, "json[]"),
  ];

  const requestValues = requests.map((request) => {
    const fields = [
      prepareValueForSql(request.filename, "text"),
      prepareValueForSql(request.requestSent, "int"),
      prepareValueForSql(request.responseStart, "int"),
      prepareValueForSql(request.responseEnd, "int"),
      prepareValueForSql(request.responseHeaders, "json"),
      prepareValueForSql(request.errors, "json[]"),
    ];

    return `(${fields.join(",")})`;
  });

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
    await pool.query(query);
  } catch (error) {
    sqlError = handleError(error as ERROR);
  }


  if (sqlError) throw sqlError;
};
