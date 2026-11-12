import { getRemoteConfig, ServerTemplate } from "firebase-admin/remote-config";
import { error } from "firebase-functions/logger";

import { Resource } from "./definitions";

const refreshIntervalMs = 5 * 60 * 1000;

let template: ServerTemplate | null = null;
let lastLoadedAt = 0;

const getTemplate = () => {
  if (template) return template;

  template = getRemoteConfig().initServerTemplate();
  return template;
};

const parseResources = (envJson: string) => {
  const env = JSON.parse(envJson) as { RESOURCES?: unknown };

  if (!Array.isArray(env.RESOURCES)) throw new Error("env.RESOURCES is not an array");

  return env.RESOURCES as Resource[];
};

export const getResourcesToFetch = async () => {
  const activeTemplate = getTemplate();

  if (Date.now() - lastLoadedAt > refreshIntervalMs) {
    try {
      await activeTemplate.load();
      lastLoadedAt = Date.now();
    } catch (loadError) {
      error("Remote Config load failed", loadError);
    }
  }

  try {
    return parseResources(activeTemplate.evaluate().getString("env"));
  } catch (evaluateError) {
    error("Remote Config env parameter is unusable", evaluateError);
    return [] as Resource[];
  }
};
