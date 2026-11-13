import { initializeApp } from "firebase-admin/app";
import { error } from "firebase-functions/logger";
import { onRequest } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { gaxios, GoogleAuth } from "google-auth-library";

import { runCheck } from "./check";
import { callRegions, checkOptions, projectNumber, schedulerServiceAccount } from "./config";

const googleAuth = new GoogleAuth();

initializeApp();

export const triggerChecks = onSchedule(
  {
    schedule: "* * * * *",
    timeZone: "Asia/Singapore",
    retryCount: 0,

    timeoutSeconds: 30,
    maxInstances: 1,
    cpu: 0.25,
    serviceAccount: schedulerServiceAccount,
    ingressSettings: "ALLOW_INTERNAL_ONLY",
    preserveExternalChanges: true,
  },
  async () => {
    const pendingRegions = {} as { [key: string]: string };

    const job = async () => {
      const promises = callRegions.map(async (region) => {
        const url = `https://check-${projectNumber}.${region}.run.app`;

        if (process.env.FUNCTIONS_EMULATOR) {
          console.log(`Fetch ${url} ran.`);
          return 200;
        }

        pendingRegions[region] = "Getting ID Token";

        const client = await googleAuth.getIdTokenClient(url);

        pendingRegions[region] = "Requesting resource";

        const response = await client.request({
          url,
          retry: true,
          retryConfig: {
            onRetryAttempt: (gaxiosError: gaxios.GaxiosError) => {
              pendingRegions[region] = `Retrying after: ${gaxiosError.message}`;
            },
          },
        });

        delete pendingRegions[region];

        if (response.status !== 200) {
          let message = response.data;

          if (typeof response.data === "object") message = JSON.stringify(response.data);

          error(`Error ${response.status} from ${region}: ${message}`);
        }

        return response.status;
      });

      const results = await Promise.allSettled(promises);

      results.forEach((result) => {
        if (result.status === "rejected") error(result.reason);
      });

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
      if (Object.keys(pendingRegions).length === 0) error("Timeout running checks");
      else error(`Timeout waiting for ${JSON.stringify(pendingRegions)}`);
    }
  }
);

export const check = onRequest(checkOptions, async (request, response) => {
  await runCheck();

  response.setHeader("Cache-Control", "no-store").send(`ok at ${Date.now()}`);
});
