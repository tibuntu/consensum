import { EventEmitter } from "node:events";

export type DocEvent =
  | { type: "annotation.created"; annotation: unknown }
  | { type: "comment.created"; annotationId: string; comment: unknown }
  | { type: "annotation.updated"; annotationId: string; status?: string; threadStatus?: string }
  | { type: "review.updated"; state: string }
  | { type: "version.created"; versionNumber: number; summary: unknown };

const globalForEvents = globalThis as unknown as { docEvents?: EventEmitter };
const emitter = globalForEvents.docEvents ?? new EventEmitter();
emitter.setMaxListeners(0); // many SSE clients per document
if (process.env.NODE_ENV !== "production") globalForEvents.docEvents = emitter;

export function publish(documentId: string, event: DocEvent): void {
  emitter.emit(documentId, event);
}

export function subscribe(documentId: string, handler: (e: DocEvent) => void): () => void {
  emitter.on(documentId, handler);
  return () => {
    emitter.off(documentId, handler);
  };
}
