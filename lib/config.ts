/** Whether the in-app document editing UI is shown. Default ON;
 *  operators opt out with EDIT_UI_ENABLED=false. UI-only — the edit API is not gated. */
export function isEditUiEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.EDIT_UI_ENABLED?.toLowerCase() !== "false";
}

/** The app's public origin, e.g. https://quorum.example. Falls back to localhost in dev. */
export function baseUrl(env: NodeJS.ProcessEnv = process.env): string {
  return env.BASE_URL ?? "http://localhost:3000";
}
