import { initializeApp } from "firebase-admin/app";

import { runCheck } from "../lib/check.js";

initializeApp();

export const handler = async () => {
  await runCheck();
};
