import { forward } from '$lib/server/proxy';
import type { RequestHandler } from './$types';

const handler: RequestHandler = ({ request }) => forward(request);

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const DELETE = handler;
