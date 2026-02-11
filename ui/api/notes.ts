import type { ApiContext } from "./context";
import type { NoteType } from "../../services/notesService";
import { handler, errorResponse } from "./helpers";

export function notesRoutes(ctx: ApiContext) {
  return {
    // GET /api/notes - List all notes
    "/api/notes": {
      GET: handler(async (req: Request) => {
        const url = new URL(req.url);
        const type = url.searchParams.get("type") as NoteType | null;
        const notes = await ctx.notesService.listNotes(type || undefined);
        return Response.json({ notes, notesDir: ctx.notesService.getNotesDir() });
      }),
    },

    // GET/PUT/DELETE /api/notes/:type/:id - Notes CRUD
    "/api/notes/:type/:id": {
      GET: handler(async (req: Request) => {
        const { type, id } = (req as any).params;
        if (type !== "ticket" && type !== "pr") {
          return errorResponse("Invalid note type", 400);
        }
        const note = await ctx.notesService.getNote(type as NoteType, id);
        return Response.json({ note });
      }),
      PUT: handler(async (req: Request) => {
        const { type, id } = (req as any).params;
        if (type !== "ticket" && type !== "pr") {
          return errorResponse("Invalid note type", 400);
        }
        const body = (await req.json()) as { content: string };
        if (typeof body.content !== "string") {
          return errorResponse("Content is required", 400);
        }
        const note = await ctx.notesService.saveNote(type as NoteType, id, body.content);
        return Response.json({ note });
      }),
      DELETE: handler(async (req: Request) => {
        const { type, id } = (req as any).params;
        if (type !== "ticket" && type !== "pr") {
          return errorResponse("Invalid note type", 400);
        }
        const deleted = await ctx.notesService.deleteNote(type as NoteType, id);
        return Response.json({ deleted });
      }),
    },

    // GET /api/notes/config - Notes configuration
    "/api/notes/config": {
      GET: handler(async () => {
        return Response.json({ notesDir: ctx.notesService.getNotesDir() });
      }),
    },
  };
}
