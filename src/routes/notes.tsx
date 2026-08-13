import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Plus, Trash2, Search, Bold, Italic, Underline, Strikethrough,
  List, ListOrdered, ListTodo, AlignLeft, AlignCenter, AlignRight,
  Link as LinkIcon, Pin, PinOff, ArrowLeft, Palette,
} from "lucide-react";
import { PageHeader } from "@/components/Stat";
import { useLocalState } from "@/lib/storage";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export const Route = createFileRoute("/notes")({
  head: () => ({ meta: [{ title: "Notes — Pace" }, { name: "description", content: "Vos notes, avec mise en forme riche." }] }),
  component: NotesPage,
});

type Note = {
  id: string;
  title: string;
  html: string;
  pinned: boolean;
  color: string;
  createdAt: number;
  updatedAt: number;
};

const COLORS = [
  { key: "default", cls: "bg-card" },
  { key: "amber", cls: "bg-amber-500/10" },
  { key: "rose", cls: "bg-rose-500/10" },
  { key: "emerald", cls: "bg-emerald-500/10" },
  { key: "sky", cls: "bg-sky-500/10" },
  { key: "violet", cls: "bg-violet-500/10" },
];

const FONTS = [
  { label: "Par défaut", value: "" },
  { label: "Serif", value: "Georgia, serif" },
  { label: "Manuscrite", value: "'Brush Script MT', cursive" },
  { label: "Monospace", value: "'Courier New', monospace" },
  { label: "Arial", value: "Arial, sans-serif" },
];

const SIZES = [
  { label: "Petit", value: "2" },
  { label: "Normal", value: "3" },
  { label: "Grand", value: "5" },
  { label: "Très grand", value: "7" },
];

function textPreview(html: string): string {
  const div = typeof document !== "undefined" ? document.createElement("div") : null;
  if (!div) return "";
  div.innerHTML = html;
  return (div.textContent || "").trim().slice(0, 120);
}

function NotesPage() {
  const [notes, setNotes] = useLocalState<Note[]>("pace.notes.list", []);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? notes.filter((n) => n.title.toLowerCase().includes(q) || textPreview(n.html).toLowerCase().includes(q))
      : notes;
    return [...list].sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || b.updatedAt - a.updatedAt);
  }, [notes, query]);

  const selected = notes.find((n) => n.id === selectedId) ?? null;

  const createNote = () => {
    const n: Note = { id: crypto.randomUUID(), title: "", html: "", pinned: false, color: "default", createdAt: Date.now(), updatedAt: Date.now() };
    setNotes((p) => [n, ...p]);
    setSelectedId(n.id);
  };

  const updateNote = (id: string, patch: Partial<Note>) => {
    setNotes((p) => p.map((n) => (n.id === id ? { ...n, ...patch, updatedAt: Date.now() } : n)));
  };

  const removeNote = (id: string) => {
    setNotes((p) => p.filter((n) => n.id !== id));
    if (selectedId === id) setSelectedId(null);
  };

  return (
    <div>
      <PageHeader title="Notes" subtitle="Tout écrire, mis en forme comme vous le voulez." />
      <div className="grid grid-cols-1 md:grid-cols-[320px_1fr] gap-4">
        <div className={`${selected ? "hidden md:block" : ""}`}>
          <div className="flex gap-2 mb-3">
            <div className="relative flex-1">
              <Search className="size-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input placeholder="Rechercher…" value={query} onChange={(e) => setQuery(e.target.value)} className="pl-8" />
            </div>
            <Button size="icon" onClick={createNote} className="rounded-xl shrink-0"><Plus className="size-4" /></Button>
          </div>
          <div className="space-y-2 max-h-[70vh] overflow-y-auto pr-1">
            {filtered.length === 0 ? (
              <div className="text-xs text-muted-foreground italic px-2 py-6 text-center">Aucune note.</div>
            ) : (
              filtered.map((n) => {
                const colorCls = COLORS.find((c) => c.key === n.color)?.cls ?? "bg-card";
                return (
                  <button
                    key={n.id}
                    onClick={() => setSelectedId(n.id)}
                    className={`w-full text-left rounded-xl glass-card ${colorCls} p-3 transition ${selectedId === n.id ? "ring-2 ring-primary" : "hover:opacity-90"}`}
                  >
                    <div className="flex items-center gap-1.5">
                      {n.pinned && <Pin className="size-3 text-primary shrink-0" />}
                      <div className="font-medium text-sm truncate">{n.title || "Sans titre"}</div>
                    </div>
                    <div className="text-xs text-muted-foreground truncate mt-0.5">{textPreview(n.html) || "Note vide"}</div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        <div className={selected ? "" : "hidden md:block"}>
          {selected ? (
            <NoteEditor
              key={selected.id}
              note={selected}
              onChange={(patch) => updateNote(selected.id, patch)}
              onDelete={() => removeNote(selected.id)}
              onBack={() => setSelectedId(null)}
            />
          ) : (
            <div className="hidden md:flex items-center justify-center h-[70vh] rounded-2xl glass-card text-sm text-muted-foreground">
              Sélectionnez une note ou créez-en une nouvelle.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function NoteEditor({ note, onChange, onDelete, onBack }: {
  note: Note;
  onChange: (patch: Partial<Note>) => void;
  onDelete: () => void;
  onBack: () => void;
}) {
  const editorRef = useRef<HTMLDivElement>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    if (editorRef.current && editorRef.current.innerHTML !== note.html) {
      editorRef.current.innerHTML = note.html;
    }
    // On ne resynchronise qu'au changement de note (id), jamais à chaque frappe —
    // sinon le curseur saute pendant la saisie.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note.id]);

  const scheduleSave = () => {
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      if (editorRef.current) onChange({ html: editorRef.current.innerHTML });
    }, 400);
  };

  const exec = (command: string, value?: string) => {
    editorRef.current?.focus();
    document.execCommand(command, false, value);
    scheduleSave();
  };

  const insertChecklist = () => {
    editorRef.current?.focus();
    document.execCommand(
      "insertHTML",
      false,
      `<div class="pace-check" style="display:flex;align-items:center;gap:6px;margin:2px 0"><input type="checkbox" onclick="this.parentElement.style.opacity=this.checked?0.5:1;this.nextSibling.style.textDecoration=this.checked?'line-through':'none'" /><span contenteditable="true">Élément</span></div><br/>`,
    );
    scheduleSave();
  };

  const insertLink = () => {
    const url = window.prompt("Lien (https://…)");
    if (!url) return;
    exec("createLink", url);
  };

  const colorCls = COLORS.find((c) => c.key === note.color)?.cls ?? "bg-card";

  return (
    <div className={`rounded-2xl glass-card ${colorCls} p-4 flex flex-col h-[75vh]`}>
      <div className="flex items-center gap-2 mb-2">
        <button onClick={onBack} className="md:hidden p-2 -ml-2 rounded-lg hover:bg-muted"><ArrowLeft className="size-4" /></button>
        <Input
          value={note.title}
          onChange={(e) => onChange({ title: e.target.value })}
          placeholder="Titre de la note"
          className="border-0 shadow-none bg-transparent text-lg font-display font-semibold px-1 focus-visible:ring-0"
        />
        <button onClick={() => onChange({ pinned: !note.pinned })} aria-label={note.pinned ? "Désépingler" : "Épingler"} className="p-2 rounded-lg hover:bg-muted shrink-0">
          {note.pinned ? <PinOff className="size-4" /> : <Pin className="size-4" />}
        </button>
        <button onClick={onDelete} aria-label="Supprimer la note" className="p-2 rounded-lg hover:bg-muted text-muted-foreground hover:text-destructive shrink-0">
          <Trash2 className="size-4" />
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-1 mb-2 pb-2 border-b border-border/50">
        <ToolbarBtn onClick={() => exec("bold")} label="Gras"><Bold className="size-3.5" /></ToolbarBtn>
        <ToolbarBtn onClick={() => exec("italic")} label="Italique"><Italic className="size-3.5" /></ToolbarBtn>
        <ToolbarBtn onClick={() => exec("underline")} label="Souligné"><Underline className="size-3.5" /></ToolbarBtn>
        <ToolbarBtn onClick={() => exec("strikeThrough")} label="Barré"><Strikethrough className="size-3.5" /></ToolbarBtn>
        <div className="w-px h-5 bg-border mx-1" />
        <ToolbarBtn onClick={() => exec("insertUnorderedList")} label="Liste à puces"><List className="size-3.5" /></ToolbarBtn>
        <ToolbarBtn onClick={() => exec("insertOrderedList")} label="Liste numérotée"><ListOrdered className="size-3.5" /></ToolbarBtn>
        <ToolbarBtn onClick={insertChecklist} label="Liste de tâches"><ListTodo className="size-3.5" /></ToolbarBtn>
        <div className="w-px h-5 bg-border mx-1" />
        <ToolbarBtn onClick={() => exec("justifyLeft")} label="Aligner à gauche"><AlignLeft className="size-3.5" /></ToolbarBtn>
        <ToolbarBtn onClick={() => exec("justifyCenter")} label="Centrer"><AlignCenter className="size-3.5" /></ToolbarBtn>
        <ToolbarBtn onClick={() => exec("justifyRight")} label="Aligner à droite"><AlignRight className="size-3.5" /></ToolbarBtn>
        <div className="w-px h-5 bg-border mx-1" />
        <ToolbarBtn onClick={insertLink} label="Insérer un lien"><LinkIcon className="size-3.5" /></ToolbarBtn>
        <label className="relative inline-flex items-center justify-center size-8 rounded-lg hover:bg-muted cursor-pointer" title="Couleur du texte">
          <Palette className="size-3.5" />
          <input type="color" onChange={(e) => exec("foreColor", e.target.value)} className="absolute inset-0 opacity-0 cursor-pointer" />
        </label>

        <Select onValueChange={(v) => exec("fontName", v)}>
          <SelectTrigger className="h-8 w-[110px] text-xs"><SelectValue placeholder="Police" /></SelectTrigger>
          <SelectContent>
            {FONTS.map((f) => <SelectItem key={f.label} value={f.value || "default"}>{f.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select onValueChange={(v) => exec("fontSize", v)}>
          <SelectTrigger className="h-8 w-[100px] text-xs"><SelectValue placeholder="Taille" /></SelectTrigger>
          <SelectContent>
            {SIZES.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <div className="flex items-center gap-1 ml-auto">
          {COLORS.map((c) => (
            <button
              key={c.key}
              onClick={() => onChange({ color: c.key })}
              aria-label={`Couleur ${c.key}`}
              className={`size-5 rounded-full ${c.cls} border ${note.color === c.key ? "border-primary border-2" : "border-border"}`}
              style={c.key === "default" ? { backgroundColor: "var(--muted)" } : undefined}
            />
          ))}
        </div>
      </div>

      <div
        ref={editorRef}
        contentEditable
        suppressContentEditableWarning
        onInput={scheduleSave}
        className="flex-1 overflow-y-auto outline-none text-sm leading-relaxed px-1 py-1"
        style={{ minHeight: 200 }}
      />
    </div>
  );
}

function ToolbarBtn({ onClick, label, children }: { onClick: () => void; label: string; children: React.ReactNode }) {
  return (
    <button onClick={onClick} aria-label={label} title={label} className="size-8 rounded-lg hover:bg-muted grid place-items-center text-foreground">
      {children}
    </button>
  );
}
