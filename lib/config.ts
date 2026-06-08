/** Whether the in-app document editing UI is shown. Default ON;
 *  operators opt out with EDIT_UI_ENABLED=false. UI-only — the edit API is not gated. */
export function isEditUiEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.EDIT_UI_ENABLED?.toLowerCase() !== "false";
}
