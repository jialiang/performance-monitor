import dns from "dns";
import http2 from "http2";
import { TLSSocket } from "tls";

import { hostname } from "./config";
import { ConnectionEntry, RequestEntry, Resource } from "./definitions";
import { getResourcesToFetch } from "./remote-config";
import { startStallMonitor } from "./stall-monitor";
import { getElapsed, handleError, logToDatabase } from "./util";

type Client = http2.ClientHttp2Session;

const getRequestHeaders = (method: "GET" | "HEAD", path: string) => ({
  ":method": method,
  ":path": path,
  "accept-encoding": "gzip, deflate",
  "Fastly-Debug": 1,
});

const openConnection = (authority: string, connection: ConnectionEntry, startMark: number) => {
  const client = http2.connect(authority, {
    lookup: (hostname, family, callback) => {
      connection.dnsLookupStart = getElapsed(startMark);
      return dns.lookup(hostname, family, callback);
    },
  });

  client.on("error", (error) => {
    handleError(error, connection);
  });

  const { socket } = client;

  socket.on("lookup", (error) => {
    if (error) {
      handleError(error, connection);
      return;
    }

    connection.dnsLookupEnd = getElapsed(startMark);
  });

  socket.on("connect", () => {
    connection.tcpDone = getElapsed(startMark);
    connection.serverAddress = socket.remoteAddress;
  });

  // First key: on the server's first reply (TLS 1.3) or after its certificate (TLS 1.2)
  socket.on("keylog", () => {
    if (connection.firstKeyDerived != null) return;

    connection.firstKeyDerived = getElapsed(startMark);
    connection.tlsVersion = (socket as TLSSocket).getProtocol() ?? undefined;
  });

  socket.on("secureConnect", () => {
    connection.tlsDone = getElapsed(startMark);
  });

  return client;
};

const fetchTimed = (client: Client, resource: Resource, startMark: number) => {
  const entry = { filename: resource.label } as RequestEntry;

  return new Promise<RequestEntry>((resolve) => {
    const stream = client.request(getRequestHeaders("GET", resource.path));

    stream.on("ready", () => {
      entry.requestSent = getElapsed(startMark);
    });

    stream.on("response", (headers) => {
      entry.responseStart = getElapsed(startMark);
      entry.responseHeaders = headers;
    });

    stream.on("data", () => {});

    stream.on("end", () => {
      entry.responseEnd = getElapsed(startMark);
      resolve(entry);
    });

    stream.on("error", (error) => {
      handleError(error, entry);
      resolve(entry);
    });
  });
};

const fetchAllTimed = (client: Client, resources: Resource[], startMark: number) =>
  Promise.all(resources.map((resource) => fetchTimed(client, resource, startMark)));

const waitForConnection = (client: Client) =>
  new Promise<void>((resolve) => {
    client.once("connect", () => resolve());
    client.once("close", () => resolve());
  });

// Keeps unlogged resources in the CDN cache.
// A HEAD request still counts as a cache hit but skips downloading the body.
// Best effort: results and errors are ignored.
const warmCache = async (client: Client, resources: Resource[]) => {
  const pendingHeads = resources.map(
    (resource) =>
      new Promise<void>((resolve) => {
        const stream = client.request(getRequestHeaders("HEAD", resource.path));

        stream.on("error", () => {});
        stream.on("close", () => resolve());
        stream.resume();
      })
  );

  await Promise.allSettled(pendingHeads);
};

const closeClient = (client: Client | undefined) =>
  new Promise<void>((resolve) => {
    if (client == null || client.destroyed) return resolve();

    client.once("close", () => resolve());
    client.close();
  });

export const runCheck = async () => {
  if (!hostname) throw "Missing environment variable: hostname";

  const resources = await getResourcesToFetch();
  const loggedResources = resources.filter((resource) => resource.logToDatabase === true);
  const warmedResources = resources.filter((resource) => resource.logToDatabase !== true);

  const startTime = Date.now();
  const startMark = performance.now();

  const stallMonitor = startStallMonitor(startMark);

  const connection = {} as ConnectionEntry;
  let client: Client | undefined;
  let requests = [] as RequestEntry[];

  try {
    client = openConnection(hostname, connection, startMark);

    [requests] = await Promise.all([
      fetchAllTimed(client, loggedResources, startMark),
      waitForConnection(client),
    ]);
  } catch (error) {
    handleError(error as Error, connection);
  }

  stallMonitor.stop();

  const { getMaxStallBetween } = stallMonitor;
  const { dnsLookupStart, dnsLookupEnd, tcpDone, tlsDone } = connection;

  connection.maxStall = getMaxStallBetween(0, Infinity);
  connection.dnsMaxStall = getMaxStallBetween(dnsLookupStart, dnsLookupEnd);
  connection.tcpMaxStall = getMaxStallBetween(dnsLookupEnd, tcpDone);
  connection.tlsMaxStall = getMaxStallBetween(tcpDone, tlsDone);

  for (const request of requests) {
    request.requestMaxStall = getMaxStallBetween(request.requestSent, request.responseStart);
    request.downloadMaxStall = getMaxStallBetween(request.responseStart, request.responseEnd);
  }

  try {
    await Promise.all([
      logToDatabase(startTime, connection, requests),
      client && warmCache(client, warmedResources),
    ]);
  } finally {
    await closeClient(client);
  }
};
