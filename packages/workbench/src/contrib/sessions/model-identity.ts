import type { ManagementModel } from "../../services/management";

/** Public session identity; management database IDs never leave CRUD flows. */
export function runtimeModelID(
  model: Pick<ManagementModel, "providerId" | "upstreamModel">,
): string {
  return `${model.providerId}/${model.upstreamModel}`;
}
