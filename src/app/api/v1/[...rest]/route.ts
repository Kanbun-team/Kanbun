import { errorResponse } from "@/server/api/http";

// Unknown API paths answer in the API's error shape instead of an HTML page.
const unknown = async () => errorResponse(404, "not_found", "No such API endpoint. See /api/v1/openapi.json.");

export const GET = unknown;
export const POST = unknown;
export const PATCH = unknown;
export const PUT = unknown;
export const DELETE = unknown;
