import { join } from "path";
import { homedir } from "os";
import { mkdir } from "fs/promises";

export type NoteType = "ticket" | "pr";

export interface Note {
  type: NoteType;
  id: string;
  content: string;
  updatedAt: Date;
  createdAt: Date;
}

export interface NotesServiceOptions {
  notesDir?: string;
}

export class NotesService {
  private notesDir: string;

  constructor(options: NotesServiceOptions = {}) {
    this.notesDir = options.notesDir || join(homedir(), ".buddy", "notes");
  }

  private async ensureDir(): Promise<void> {
    await mkdir(this.notesDir, { recursive: true });
  }

  private getFilePath(type: NoteType, id: string): string {
    // Sanitize id to be safe for filenames
    const safeId = id.replace(/[^a-zA-Z0-9-_]/g, "_");
    return join(this.notesDir, `${type}-${safeId}.md`);
  }

  async getNote(type: NoteType, id: string): Promise<Note | null> {
    await this.ensureDir();
    const filePath = this.getFilePath(type, id);
    const file = Bun.file(filePath);

    if (!(await file.exists())) {
      return null;
    }

    const content = await file.text();
    const stats = await file.stat();

    return {
      type,
      id,
      content,
      updatedAt: stats?.mtime || new Date(),
      createdAt: stats?.birthtime || new Date(),
    };
  }

  async saveNote(type: NoteType, id: string, content: string): Promise<Note> {
    await this.ensureDir();
    const filePath = this.getFilePath(type, id);

    // Check if file exists for createdAt
    const file = Bun.file(filePath);
    const exists = await file.exists();
    const existingStats = exists ? await file.stat() : null;

    await Bun.write(filePath, content);

    const newStats = await Bun.file(filePath).stat();

    return {
      type,
      id,
      content,
      updatedAt: newStats?.mtime || new Date(),
      createdAt: existingStats?.birthtime || newStats?.birthtime || new Date(),
    };
  }

  async deleteNote(type: NoteType, id: string): Promise<boolean> {
    const filePath = this.getFilePath(type, id);
    const file = Bun.file(filePath);

    if (!(await file.exists())) {
      return false;
    }

    const { unlink } = await import("fs/promises");
    await unlink(filePath);
    return true;
  }

  async listNotes(type?: NoteType): Promise<Note[]> {
    await this.ensureDir();
    const { readdir } = await import("fs/promises");

    const files = await readdir(this.notesDir);
    const notes: Note[] = [];

    for (const filename of files) {
      if (!filename.endsWith(".md")) continue;

      const match = filename.match(/^(ticket|pr)-(.+)\.md$/);
      if (!match) continue;

      const [, fileType, id] = match;
      if (type && fileType !== type) continue;

      const note = await this.getNote(fileType as NoteType, id);
      if (note) {
        notes.push(note);
      }
    }

    return notes;
  }

  getNotesDir(): string {
    return this.notesDir;
  }

  getNotePath(type: NoteType, id: string): string {
    return this.getFilePath(type, id);
  }
}
