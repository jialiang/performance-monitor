import { GoogleAuth } from "google-auth-library";

import { onRequest } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { initializeApp } from "firebase-admin/app";
import { error } from "firebase-functions/logger";

import dns from "dns";
import http2 from "http2";

import { handleError, logToDatabase, purgeOldData } from "./util";
import { ConnectionEntry, RequestEntry } from "./definitions";
import {
  schedulerServiceAccount,
  functionServiceAccount,
  hostname,
  resourcesToFetch,
  regions,
} from "./config";

const googleAuth = new GoogleAuth();

initializeApp();

export const triggerChecks = onSchedule(
  {
    schedule: "* * * * *",
    retryCount: 0,
    timeZone: "Asia/Singapore",
    preserveExternalChanges: true,
    timeoutSeconds: 30,
    cpu: 0.25,
    serviceAccount: schedulerServiceAccount,
    ingressSettings: "ALLOW_INTERNAL_ONLY",
  },
  async () => {
    const pendingRegions = {} as { [key: string]: string };

    const job = async () => {
      const promises = regions.map(async (region) => {
        const url = `https://${region}-${process.env.GCLOUD_PROJECT}.cloudfunctions.net/check`;

        if (process.env.FUNCTIONS_EMULATOR) {
          console.log(`Fetch ${url} ran.`);
          return 200;
        }

        pendingRegions[region] = "Getting ID Token";

        const client = await googleAuth.getIdTokenClient(url);

        pendingRegions[region] = "Requesting resource";

        const response = await client.request({ url });

        delete pendingRegions[region];

        if (response.status !== 200) {
          let message = response.data;

          if (typeof response.data === "object") message = JSON.stringify(response.data);

          error(`Error ${response.status} from ${region}: ${message}`);
        }

        return response.status;
      });

      promises.push(purgeOldData());

      await Promise.allSettled(promises).catch(error);

      return "ok";
    };

    const timer = async () => {
      await new Promise((resolve) => {
        setTimeout(resolve, 21000);
      });

      return "timeout";
    };

    const result = await Promise.race([job(), timer()]);

    if (result === "timeout") {
      if (Object.keys(pendingRegions).length === 0) error("Timeout purging old data");
      else error(`Timeout waiting for ${JSON.stringify(pendingRegions)}`);
    }
  }
);

export const check = onRequest(
  {
    region: regions,
    timeoutSeconds: 20,
    cpu: 0.25,
    serviceAccount: functionServiceAccount,
    invoker: schedulerServiceAccount,
  },
  async (request, response) => {
    const startTime = Date.now();
    const getElapsed = () => Date.now() - startTime;

    const connection = {} as ConnectionEntry;
    let requests = [] as RequestEntry[];

    if (!hostname) throw "Missing environment variable: hostname";

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

      const requestPromises = resourcesToFetch.map(({ path, label }) => {
        const entry = { filename: label } as RequestEntry;

        return new Promise((resolve) => {
          const stream = client.request({
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

    await logToDatabase(startTime, connection, requests);

    response.setHeader("Cache-Control", "no-store").send(`ok at ${Date.now()}`);
  }
);
