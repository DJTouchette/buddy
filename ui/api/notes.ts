import type { ApiContext } from "./context";
import type { NoteType } from "../../services/notesService";

export function notesRoutes(ctx: ApiContext) {
  return {
    // GET /api/notes - List all notes
    "/api/notes": {
      GET: async (req: Request) => {
        try {
          const url = new URL(req.url);
          const type = url.searchParams.get("type") as NoteType | null;
          const notes = await ctx.notesService.listNotes(type || undefined);
          return Response.json({ notes, notesDir: ctx.notesService.getNotesDir() });
        } catch (error) {
          return Response.json({ error: String(error) }, { status: 500 });
        }
      },
    },

    // GET/PUT/DELETE /api/notes/:type/:id - Notes CRUD
    "/api/notes/:type/:id": {
      GET: async (req: Request & { params: { type: string; id: string } }) => {
        try {
          const { type, id } = req.params;
          if (type !== "ticket" && type !== "pr") {
            return Response.json({ error: "Invalid note type" }, { status: 400 });
          }
          const note = await ctx.notesService.getNote(type as NoteType, id);
          return Response.json({ note });
        } catch (error) {
          return Response.json({ error: String(error) }, { status: 500 });
        }
      },
      PUT: async (req: Request & { params: { type: string; id: string } }) => {
        try {
          const { type, id } = req.params;
          if (type !== "ticket" && type !== "pr") {
            return Response.json({ error: "Invalid note type" }, { status: 400 });
          }
          const body = (await req.json()) as { content: string };
          if (typeof body.content !== "string") {
            return Response.json({ error: "Content is required" }, { status: 400 });
          }
          const note = await ctx.notesService.saveNote(type as NoteType, id, body.content);
          return Response.json({ note });
        } catch (error) {
          return Response.json({ error: String(error) }, { status: 500 });
        }
      },
      DELETE: async (req: Request & { params: { type: string; id: string } }) => {
        try {
          const { type, id } = req.params;
          if (type !== "ticket" && type !== "pr") {
            return Response.json({ error: "Invalid note type" }, { status: 400 });
          }
          const deleted = await ctx.notesService.deleteNote(type as NoteType, id);
          return Response.json({ deleted });
        } catch (error) {
          return Response.json({ error: String(error) }, { status: 500 });
        }
      },
    },

    // GET /api/notes/config - Notes configuration
    "/api/notes/config": {
      GET: async () => {
        try {
          return Response.json({ notesDir: ctx.notesService.getNotesDir() });
        } catch (error) {
          return Response.json({ error: String(error) }, { status: 500 });
        }
      },
    },
  };
}
