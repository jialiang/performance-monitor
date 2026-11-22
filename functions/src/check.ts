import dns from "dns";
import http2 from "http2";

import { hostname } from "./config";
import { ConnectionEntry, RequestEntry } from "./definitions";
import { getResourcesToFetch } from "./remote-config";
import { startStallMonitor } from "./stall-monitor";
import { getElapsed, handleError, logToDatabase } from "./util";

export const runCheck = async () => {
  if (!hostname) throw "Missing environment variable: hostname";

  const resources = await getResourcesToFetch();

  const startTime = Date.now();
  const startMark = performance.now();

  const stallMonitor = startStallMonitor(startMark);

  const connection = {} as ConnectionEntry;
  let requests = [] as RequestEntry[];

  try {
    const client = http2.connect(hostname, {
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
    });

    socket.on("secureConnect", () => {
      connection.tlsDone = getElapsed(startMark);
    });

    const requestPromises = resources.map((resource) => {
      const { path, label, logToDatabase: isLoggedToDatabase } = resource;
      const entry = { filename: label } as RequestEntry;

      return new Promise((resolve) => {
        // Unlogged resources are only fetched to keep them in the CDN cache.
        // A HEAD request still counts as a cache hit but skips downloading the body.
        const stream = client.request({
          ":method": isLoggedToDatabase ? "GET" : "HEAD",
          ":path": path,
          "accept-encoding": "gzip, deflate",
          "Fastly-Debug": 1,
        });

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
      }) as Promise<RequestEntry>;
    });

    requests = await Promise.all(requestPromises);

    client.close();
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

  await logToDatabase(startTime, connection, requests, resources);
};
