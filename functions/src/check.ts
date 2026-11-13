import dns from "dns";
import http2 from "http2";

import { hostname } from "./config";
import { ConnectionEntry, RequestEntry } from "./definitions";
import { getResourcesToFetch } from "./remote-config";
import { handleError, logToDatabase } from "./util";

export const runCheck = async () => {
  if (!hostname) throw "Missing environment variable: hostname";

  const resources = await getResourcesToFetch();

  const startTime = Date.now();
  const getElapsed = () => Date.now() - startTime;

  const connection = {} as ConnectionEntry;
  let requests = [] as RequestEntry[];

  try {
    const client = http2.connect(hostname, {
      lookup: (hostname, family, callback) => {
        connection.dnsLookupStart = getElapsed();
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

      connection.dnsLookupEnd = getElapsed();
    });

    socket.on("connect", () => {
      connection.tcpDone = getElapsed();
    });

    socket.on("secureConnect", () => {
      connection.tlsDone = getElapsed();
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
          entry.requestSent = getElapsed();
        });

        stream.on("response", (headers) => {
          entry.responseStart = getElapsed();
          entry.responseHeaders = headers;
        });

        stream.on("data", () => {});

        stream.on("end", () => {
          entry.responseEnd = getElapsed();
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

  await logToDatabase(startTime, connection, requests, resources);
};
