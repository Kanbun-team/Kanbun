import spec from "../../../../../docs/openapi.json";
import { APP_VERSION } from "@/lib/version";

// The OpenAPI 3.1 description of this API (docs/openapi.json). Public, so
// tools can load it without a token.
export const dynamic = "force-static";

export function GET() {
  return Response.json({ ...spec, info: { ...spec.info, version: APP_VERSION } });
}
