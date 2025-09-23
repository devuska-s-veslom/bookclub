import React, { useEffect, useMemo, useRef, useState } from "react";

// ===== date & week helpers ==================================================
const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`);
const toISODate = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function getISOWeek(date: Date = new Date()) {
  // ISO week: Monday=1..Sunday=7. Week 1 is the week with Thursday in it
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7; // 1..7 (Mon..Sun)
  d.setUTCDate(d.getUTCDate() + 4 - dayNum); // Thursday of current week
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((+d - +yearStart) / 86400000 + 1) / 7);
  return { year: d.getUTCFullYear(), week: weekNo };
}
const weekKeyOf = (date: Date = new Date()) => {
  const { year, week } = getISOWeek(date);
  return `${year}-W${pad(week)}`; // e.g. 2025-W37
};

const WEEK_KEY_RE = /^(\d{4})-W(\d{2})$/;
const isValidWeekKey = (wk: string) => WEEK_KEY_RE.test(wk);
const parseWeekKey = (wk: string) => {
  const m = WEEK_KEY_RE.exec(wk);
  if (!m) return null;
  return { year: +m[1], week: +m[2] };
};
function getMondayOfISOWeek(year: number, week: number) {
  // find Monday of ISO week
  const simple = new Date(Date.UTC(year, 0, 1 + (week - 1) * 7));
  const dayOfWeek = simple.getUTCDay();
  const ISOThursday = new Date(simple);
  ISOThursday.setUTCDate(simple.getUTCDate() - ((dayOfWeek + 6) % 7) + 3);
  const monday = new Date(ISOThursday);
  monday.setUTCDate(ISOThursday.getUTCDate() - 3);
  monday.setUTCHours(0, 0, 0, 0);
  return monday;
}
function addDaysUTC(d: Date, days: number) {
  const x = new Date(d);
  x.setUTCDate(x.getUTCDate() + days);
  return x;
}
function ruDayMonth(d: Date) {
  return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short" }).format(d);
}
function formatWeekLabel(weekKey: string) {
  const p = parseWeekKey(weekKey);
  if (!p) return weekKey;
  const start = getMondayOfISOWeek(p.year, p.week);
  const end = addDaysUTC(start, 6);
  return `${ruDayMonth(start)} — ${ruDayMonth(end)} ${end.getUTCFullYear()}`;
}
function isoAddWeeks(weekKey: string, delta: number) {
  const p = parseWeekKey(weekKey);
  if (!p) return weekKey;
  return weekKeyOf(addDaysUTC(getMondayOfISOWeek(p.year, p.week), delta * 7));
}
function recentWeeks(n = 3, base = weekKeyOf(new Date())) {
  const arr: string[] = [];
  for (let i = 0; i < n; i++) arr.push(isoAddWeeks(base, -i));
  return arr;
}
// последние N недель от "реально текущей", сверху вниз: n, n-1, n-2...
function weeksFromCurrent(n: number, current: string = weekKeyOf(new Date())) {
  const arr: string[] = [];
  for (let i = 0; i < n; i++) arr.push(isoAddWeeks(current, -i));
  return arr;
}
// сравнение ISO-недель (старше → младше)
function compareWeekKeys(a: string, b: string) {
  const pa = parseWeekKey(a)!;
  const pb = parseWeekKey(b)!;
  if (pa.year !== pb.year) return pa.year - pb.year;
  return pa.week - pb.week;
}
function orderWeeksWithCurrentFirst(list: string[], current: string) {
  const uniq = Array.from(new Set(list)).sort(compareWeekKeys);
  return [current, ...uniq.filter((w) => w !== current)];
}
// ===== models & constants ====================================================
const DEFAULT_USERS = [
  "Стася",
  "Арсений",
  "Камила",
  "Айшатка",
  "Соня",
  "Татьяна",
  "Регина",
  "Андрей",
  "Марина",
];

const BOOK_STATUS = {
  READING: "читаю сейчас",
  PAUSED: "на паузе",
  WILL_READ: "буду читать",
  DONE: "прочитано",
} as const;
export type BookStatus = typeof BOOK_STATUS[keyof typeof BOOK_STATUS];
const STATUS_ORDER: BookStatus[] = [BOOK_STATUS.READING, BOOK_STATUS.PAUSED, BOOK_STATUS.WILL_READ, BOOK_STATUS.DONE];
const MIN_PAGES_OK = 40; // страйк засчитывается при >=40 стр/нед

// ===== storage ===============================================================
const lsKey = (wk: string) => `bookclub:${wk}`;
const profilesKey = `bookclub:profiles`;
const shortId = () => Math.random().toString(36).slice(2, 9);

function migrateProfiles(raw: any) {
  // Старые форматы профилей → к новому виду { [user]: { books: [] } }
  if (Array.isArray(raw)) {
    const names = raw.every((x) => typeof x === "string" && x.trim()) ? raw : DEFAULT_USERS;
    return Object.fromEntries(names.map((u) => [u, { books: [] }]));
  }
  if (!raw || (typeof raw === "object" && Object.keys(raw).every((k) => /^\d+$/.test(k)))) {
    return Object.fromEntries(DEFAULT_USERS.map((u) => [u, { books: [] }]));
  }
  return raw;
}

function loadProfiles() {
  try {
    const raw = localStorage.getItem(profilesKey);
    if (raw) return migrateProfiles(JSON.parse(raw));
  } catch {}
  const obj: Record<string, { books: { id: string; title: string; status: BookStatus; author?: string; coverDataUrl?: string; notes?: string; rating?: number }[] }>
    = Object.fromEntries(DEFAULT_USERS.map((u) => [u, { books: [] }]));
  localStorage.setItem(profilesKey, JSON.stringify(obj));
  return obj;
}
function saveProfiles(p: any) { localStorage.setItem(profilesKey, JSON.stringify(p)); }

function loadWeek(wk: string) {
  try { return JSON.parse(localStorage.getItem(lsKey(wk)) || "[]"); } catch { return []; }
}
function saveWeek(wk: string, entries: any[]) { localStorage.setItem(lsKey(wk), JSON.stringify(entries)); }

// ===== utils =================================================================
function classNames(...xs: Array<string | false | null | undefined>) { return xs.filter(Boolean).join(" "); }

// ===== main component ========================================================
export default function App() {
  const [today] = useState(() => new Date());
  const [weekKey, setWeekKey] = useState(() => weekKeyOf(today));
  const [entries, setEntries] = useState<any[]>(() => loadWeek(weekKey));
  const [profiles, setProfiles] = useState<Record<string, { books: { id: string; title: string; status: BookStatus; author?: string; coverDataUrl?: string; notes?: string; rating?: number }[] }>>(loadProfiles);

  const [tab, setTab] = useState<"input" | "week" | "archive" | "library" | "book">("input");
  const [bookRoute, setBookRoute] = useState<null | { user: string; bookId: string }>(null);

  // keep entries & profiles synced with localStorage
  useEffect(() => { setEntries(loadWeek(weekKey)); }, [weekKey]);
  useEffect(() => { saveWeek(weekKey, entries); }, [entries, weekKey]);
  useEffect(() => { saveProfiles(profiles); }, [profiles]);

  // ===== form state
  const [user, setUser] = useState("");
  const [bookId, setBookId] = useState("");
  const [pagesStart, setPagesStart] = useState("");
  const [pagesEnd, setPagesEnd] = useState("");
  const [summary, setSummary] = useState("");
  const [inputWeek, setInputWeek] = useState<string>(() => weekKey);
  const [showInputWeekPicker, setShowInputWeekPicker] = useState(false);
  useEffect(() => { setInputWeek(weekKey); }, [weekKey]);

  // edit modal state
  const [editOpen, setEditOpen] = useState(false);
  const [praiseOpen, setPraiseOpen] = useState(false);
  const [praiseText, setPraiseText] = useState("");
  const [editDraft, setEditDraft] = useState<null | {
    id: string; user: string; bookId: string; bookTitle: string;
    pagesStart: string; pagesEnd: string; summary: string;
    weekKey: string; originalWeekKey: string;
  }>(null);

  // book picker (dropdown + outside click)
  const [bookPickerOpen, setBookPickerOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const onDoc = (e: MouseEvent) => { if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) setBookPickerOpen(false); };
    document.addEventListener("click", onDoc);
    return () => document.removeEventListener("click", onDoc);
  }, []);

  // add/rename/status modals
  const [addBookOpen, setAddBookOpen] = useState(false);
  const [newBookTitle, setNewBookTitle] = useState("");
  const [bookSettingsOpen, setBookSettingsOpen] = useState<null | { user: string; id: string; title: string; status: BookStatus }>(null);

  // computed selections
  const currentUserBooks = useMemo(() => {
    const list = profiles[user]?.books || [];
    return [...list].sort((a, b) => {
      const s = STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status);
      return s !== 0 ? s : a.title.localeCompare(b.title, "ru");
    });
  }, [profiles, user]);

  const groupedBooks = useMemo(() => {
    const res: Record<BookStatus, { id: string; title: string; status: BookStatus }[]> = {
      [BOOK_STATUS.READING]: [],
      [BOOK_STATUS.PAUSED]: [],
      [BOOK_STATUS.WILL_READ]: [],
      [BOOK_STATUS.DONE]: [],
    } as any;
    for (const b of currentUserBooks) res[b.status].push(b as any);
    return res;
  }, [currentUserBooks]);

  const selectedBook = useMemo(() => currentUserBooks.find((b) => b.id === bookId) || null, [currentUserBooks, bookId]);

  const pagesCount = useMemo(() => {
    const a = parseInt(pagesStart, 10);
    const b = parseInt(pagesEnd, 10);
    return Number.isFinite(a) && Number.isFinite(b) && b >= a ? b - a + 1 : 0;
  }, [pagesStart, pagesEnd]);

  // ===== book helpers
  const addBookForUser = (userName: string, titleInput?: string): string => {
  const title = (titleInput ?? newBookTitle).trim();
  if (!userName || !title) return "";

  const id = shortId();

  setProfiles((prev) => {
    const p = { ...prev } as Record<string, { books: { id: string; title: string; status: string }[] }>;
    const list = p[userName]?.books ? [...p[userName].books] : [];
    list.push({ id, title, status: BOOK_STATUS.READING });
    p[userName] = { books: list };
    return p;                   // ← внутри коллбэка
  });                           // ← закрываем setProfiles(...)

  setNewBookTitle("");          // ← уже снаружи setProfiles
  return id;
};

  const updateBook = (userName: string, id: string, patch: Partial<{ title: string; status: BookStatus; author: string; coverDataUrl: string; notes: string; rating: number }>) => {
    setProfiles((prev) => {
      const p = { ...prev } as typeof prev;
      const list = p[userName]?.books ? [...p[userName].books] : [];
      const idx = list.findIndex((b) => b.id === id);
      if (idx >= 0) list[idx] = { ...list[idx], ...patch } as any;
      p[userName] = { books: list };
      return p;
    });
  };

  // ===== entry CRUD
  const openEdit = (e: any) => {
    const bid = (profiles[e.user]?.books || []).find((b) => b.title.toLowerCase() === String(e.book).toLowerCase())?.id || "";
    setEditDraft({
      id: e.id, user: e.user, bookId: bid, bookTitle: e.book,
      pagesStart: String(e.pagesStart ?? ""), pagesEnd: String(e.pagesEnd ?? ""), summary: e.summary ?? "",
      weekKey: e.weekKey, originalWeekKey: e.weekKey,
    });
    setEditOpen(true);
  };

  const saveEdit = () => {
    if (!editDraft) return;
    const a = parseInt(editDraft.pagesStart, 10);
    const b = parseInt(editDraft.pagesEnd, 10);
    const cnt = Number.isFinite(a) && Number.isFinite(b) && b >= a ? b - a + 1 : 0;
    const chosenBook = profiles[editDraft.user]?.books.find((x) => x.id === editDraft.bookId);
    const finalBookTitle = chosenBook ? chosenBook.title : editDraft.bookTitle;
    if (!editDraft.user?.trim() || !finalBookTitle?.trim() || !cnt || !editDraft.summary?.trim()) {
      alert("проверьте поля: читатель, книга, страницы и пересказ");
      return;
    }
    const now = toISODate(new Date());
    const updatedEntry = {
      id: editDraft.id,
      user: editDraft.user.trim(),
      book: finalBookTitle.trim(),
      pagesStart: a,
      pagesEnd: b,
      pagesCount: cnt,
      summary: editDraft.summary.trim(),
      weekKey: editDraft.weekKey,
      createdAt: (entries.find((x) => x.id === editDraft.id)?.createdAt || entries.find((x) => x.id === editDraft.id)?.date || now),
      date: (entries.find((x) => x.id === editDraft.id)?.date || now),
      updatedAt: now,
      liked: entries.find((x) => x.id === editDraft.id)?.liked || false,
    } as any;

    if (editDraft.weekKey === editDraft.originalWeekKey) {
      setEntries((prev) => prev.map((x) => (x.id === editDraft.id ? updatedEntry : x)));
      saveWeek(editDraft.weekKey, [updatedEntry, ...loadWeek(editDraft.weekKey).filter((x) => x.id !== editDraft.id)]);
    } else {
      // move between week buckets
      setEntries((prev) => prev.filter((x) => x.id !== editDraft.id));
      saveWeek(editDraft.weekKey, [updatedEntry, ...loadWeek(editDraft.weekKey)]);
      saveWeek(editDraft.originalWeekKey, loadWeek(editDraft.originalWeekKey).filter((x) => x.id !== editDraft.id));
    }

    setEditOpen(false);
    setEditDraft(null);
  };

  const addEntry = () => {
  if (!user.trim() || !selectedBook || !pagesCount || !summary.trim()) return;

  const now = toISODate(new Date());
  const e = {
    id: shortId(),
    user: user.trim(),
    book: selectedBook.title.trim(),
    pagesStart: Number(pagesStart),
    pagesEnd: Number(pagesEnd),
    pagesCount,
    summary: summary.trim(),
    createdAt: now,
    weekKey: inputWeek,
    liked: false,
  } as any;

  // сохраняем
  saveWeek(inputWeek, [e, ...loadWeek(inputWeek)]);
  if (inputWeek === weekKey) setEntries((prev) => [e, ...prev]);

  // очистка формы
  setPagesStart("");
  setPagesEnd("");
  setSummary("");

  // показать модалку и перейти на «Неделя»
  const phrases = [
    "Огонь! Очень мощно читаешь 🔥",
    "Крутой результат! Плюс к карме и мозгу ✨",
    "Респект, темп отличный! 📚",
  ];
  setPraiseText(phrases[Math.floor(Math.random() * phrases.length)]);
  setPraiseOpen(true);
  setTimeout(() => {
    setPraiseOpen(false);
    setTab("week");
  }, 1200);
};

  // ===== derived
  const usersRating = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of entries) m.set(e.user, (m.get(e.user) || 0) + (e.pagesCount || 0));
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [entries]);

  const allWeeks = useMemo(() => {
    const keys = Object.keys(localStorage).filter((k) => k.startsWith("bookclub:"));
    return keys.map((k) => k.split(":")[1]).filter((w): w is string => typeof w === "string" && isValidWeekKey(w)).sort();
  }, [entries, weekKey, profiles]);

  // streak: count consecutive weeks >= MIN_PAGES_OK; reset to 0 otherwise
  const streakMap = useMemo(() => {
    const map: Record<string, number> = {};
    const weeks = [...allWeeks].sort();
    if (!weeks.length) return map;
    const totalsPerWeek: Record<string, Map<string, number>> = {};
    for (const w of weeks) {
      const arr = loadWeek(w);
      const m = new Map<string, number>();
      for (const e of arr) m.set(e.user, (m.get(e.user) || 0) + (e.pagesCount || 0));
      totalsPerWeek[w] = m;
    }
    const users = new Set<string>(Object.keys(profiles));
    weeks.forEach((w) => {
      const m = totalsPerWeek[w];
      users.forEach((u) => {
        const prev = map[u] || 0;
        const pages = m.get(u) || 0;
        map[u] = pages >= MIN_PAGES_OK ? prev + 1 : 0;
      });
    });
    return map;
  }, [allWeeks, profiles, entries]);

  const allBooksFlat = useMemo(() => {
    const arr: Array<{ user: string; id: string; title: string; status: BookStatus; author?: string; coverDataUrl?: string; notes?: string; rating?: number }> = [];
    for (const u of Object.keys(profiles)) for (const b of profiles[u].books) arr.push({ user: u, ...b });
    return arr;
  }, [profiles]);

  const entriesForBook = (u: string, title: string) => {
    const res: any[] = [];
    for (const w of allWeeks) for (const e of loadWeek(w)) if (e.user === u && e.book.toLowerCase() === title.toLowerCase()) res.push({ ...e, weekKey: w });
    return res.sort((a, b) => (a.weekKey < b.weekKey ? 1 : a.weekKey > b.weekKey ? -1 : (b.createdAt || '').localeCompare(a.createdAt || '')));
  };

  // ===== render ==============================================================
  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-900 p-6">
      <div className="max-w-5xl mx-auto">
        <header className="flex flex-col gap-2 mb-6">
          <h1 className="text-3xl font-bold tracking-tight">Бесконечная книга</h1>
          <p className="text-sm text-neutral-600">пишем Бесконечную книгу вместе</p>
        </header>

        {/* tabs */}
        <div className="flex items-center gap-2 mb-4">
          {([
            ["input", "пересказ"],
            ["week", "неделя"],
            ["library", "библиотека"],
            ["archive", "архив"],
          ] as const).map(([k, label]) => (
            <button
              key={k}
              onClick={() => setTab(k)}
              className={classNames(
                "px-3 py-1.5 rounded-2xl text-sm border",
                tab === k ? "bg-black text-white border-black" : "bg-white hover:bg-neutral-100 border-neutral-300"
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === "input" && (
          <div className="grid gap-3 bg-white p-4 rounded-2xl shadow-sm border border-neutral-200">
            <div className="grid grid-cols-1 gap-3">
              {/* WEEK (first) */}
              <div>
                <label className="block text-sm font-medium mb-1">неделя</label>
                {!showInputWeekPicker ? (
                  <div className="flex items-center gap-2">
                    <span className="px-3 py-2 border rounded-lg text-sm bg-white">{formatWeekLabel(inputWeek)}</span>
                    <button type="button" className="text-sm text-blue-700 hover:underline" onClick={() => setShowInputWeekPicker(true)}>изменить</button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <select value={inputWeek} onChange={(e) => { setInputWeek(e.target.value); setWeekKey(e.target.value); }} className="w-full border rounded-lg px-3 py-2">
                      {weeksFromCurrent(3, weekKeyOf(new Date())).map((w) => (
  <option key={w} value={w}>{formatWeekLabel(w)}</option>
))}
                    </select>
                    <button type="button" className="text-sm text-neutral-700 hover:underline" onClick={() => setShowInputWeekPicker(false)}>готово</button>
                  </div>
                )}
              </div>

              {/* READER */}
              <div>
                <label className="block text-sm font-medium mb-1">читатель</label>
                <select value={user} onChange={(e) => { setUser(e.target.value); setBookId(""); }} className="w-full border rounded-lg px-3 py-2">
                  <option value="" disabled>выберите участника…</option>
                  {Object.keys(profiles).map((u) => (<option key={u} value={u}>{u}</option>))}
                </select>
              </div>

              {/* BOOK PICKER */}
              <div className="relative" ref={pickerRef}>
                <label className="block text-sm font-medium mb-1">книга</label>
                <button disabled={!user} onClick={() => setBookPickerOpen((v) => !v)} className="w-full border rounded-lg px-3 py-2 text-left disabled:bg-neutral-100">
                  {selectedBook ? `${selectedBook.title} • ${selectedBook.status}` : (user ? "выберите книгу…" : "сначала выберите пользователя")}
                </button>

                {bookPickerOpen && (
                  <div className="absolute z-20 mt-2 w-full max-h-72 overflow-auto bg-white border rounded-xl shadow-lg">
                    {STATUS_ORDER.map((st) => (
                      <div key={st} className="px-2 py-1">
                        <div className="px-2 py-1 text-xs uppercase tracking-wide text-neutral-500">{st}</div>
                        {(groupedBooks[st] || []).map((b) => (
                          <div key={b.id} className="flex items-center gap-2 px-2 py-1.5 hover:bg-neutral-100 rounded cursor-pointer">
                            <div className="flex-1" onClick={() => { setBookId(b.id); setBookPickerOpen(false); }}>{b.title}</div>
                            <button className="text-xs px-2 py-0.5 border rounded" onClick={() => setBookSettingsOpen({ user, ...b })} title="редактировать книгу">ред.</button>
                          </div>
                        ))}
                      </div>
                    ))}
                    <div className="border-t my-1" />
                    <button className="w-full text-left px-3 py-2 hover:bg-neutral-100" onClick={() => setAddBookOpen(true)}>добавить книгу…</button>
                  </div>
                )}
              </div>

              {/* PAGES */}
              <div>
                <label className="block text-sm font-medium mb-1">страницы</label>
                {(() => {
                  const a = parseInt(pagesStart, 10);
                  const b = parseInt(pagesEnd, 10);
                  const hasValues = pagesStart !== "" && pagesEnd !== "";
                  const error = hasValues && (!Number.isFinite(a) || !Number.isFinite(b) || b < a);
                  const baseCls = "w-24 border rounded-lg px-3 py-2";
                  return (
                    <div className="flex items-center gap-2">
                      <input value={pagesStart} inputMode="numeric" onChange={(e) => setPagesStart(e.target.value)} placeholder="250" className={error ? baseCls + " border-red-500" : baseCls} />
                      <span>—</span>
                      <input value={pagesEnd} inputMode="numeric" onChange={(e) => setPagesEnd(e.target.value)} placeholder="275" className={error ? baseCls + " border-red-500" : baseCls} />
                      {pagesCount > 0 && <span className="text-sm text-neutral-600">{pagesCount} стр.</span>}
                    </div>
                  );
                })()}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">пересказ</label>
              <textarea value={summary} onChange={(e) => setSummary(e.target.value)} rows={5} placeholder="о чём прочитанное: ключевые события, идеи, персонажи" className="w-full border rounded-lg px-3 py-2" />
            </div>
            <div className="flex items-center gap-3">
              <button onClick={addEntry} className="px-4 py-2 rounded-xl bg-black text-white disabled:opacity-40" disabled={!user || !selectedBook || !pagesCount || !summary}>добавить пересказ</button>
            </div>
          </div>
        )}

        {tab === "week" && (
          <div className="grid gap-4">
            {/* Week selector on top */}
            <div className="flex items-center gap-2">
              <label className="text-sm text-neutral-600">неделя</label>
              <select value={weekKey} onChange={(e) => setWeekKey(e.target.value)} className="border rounded-lg px-3 py-1.5">
                {weeksFromCurrent(24, weekKeyOf(new Date())).map((w) => (
  <option key={w} value={w}>{formatWeekLabel(w)}</option>
))}
              </select>
            </div>

            <section className="bg-white p-4 rounded-2xl shadow-sm border border-neutral-200">
              <h2 className="text-lg font-semibold mb-2">Рейтинг недели</h2>
              {usersRating.length ? (
                <ol className="list-decimal ml-5 space-y-1">
                  {usersRating.map(([u, p]) => (
                    <li key={u} className="flex items-center gap-2 pr-2">
                      <span className="font-medium flex-1">{u}</span>
                      <span className="tabular-nums">{p} стр.</span>
                      <span className="text-xs text-neutral-500 w-8 text-right">{streakMap[u] ? `x${streakMap[u]}` : ""}</span>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="text-neutral-600">пока нет записей</p>
              )}
            </section>

            <section className="bg-white p-4 rounded-2xl shadow-sm border border-neutral-200">
              <h2 className="text-lg font-semibold mb-2">Все пересказы</h2>
              {entries.length ? (
                <div className="divide-y">
                  {entries.map((e) => (
                    <div key={e.id} className="py-3 flex flex-col gap-1">
                      <div className="flex items-center gap-2 text-sm text-neutral-600">
                        <span className="px-2 py-0.5 rounded-full bg-neutral-100 border border-neutral-200">{e.user}</span>
                        <span>•</span>
                        <span className="font-medium">{e.book}</span>
                        <span>•</span>
                        <span className="tabular-nums">{e.pagesStart}–{e.pagesEnd} ({e.pagesCount} стр.)</span>
                        <span className="ml-auto text-neutral-500" title={e.updatedAt ? `обновлено: ${e.updatedAt}` : ""}>{e.createdAt || e.date}</span>
                      </div>
                      <div className="text-sm leading-relaxed whitespace-pre-wrap">{e.summary}</div>
                      <div className="pt-1 flex items-center gap-3">
                        <button onClick={() => openEdit(e)} className="text-xs text-blue-700 hover:underline">редактировать</button>
                        <button onClick={() => removeEntry(e.id)} className="text-xs text-red-600 hover:underline">удалить</button>
                        <button onClick={() => setEntries((prev) => prev.map((x) => x.id === e.id ? { ...x, liked: !x.liked } : x))} className={classNames("ml-auto text-sm", e.liked ? "text-pink-600" : "text-neutral-400 hover:text-neutral-600")} title={e.liked ? "убрать лайк" : "поставить лайк"} aria-label="лайк">
                          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill={e.liked ? "currentColor" : "none"} stroke="currentColor" className="w-5 h-5">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-neutral-600">записей нет</p>
              )}
            </section>
          </div>
        )}

        {tab === "archive" && (
          <div className="bg-white p-4 rounded-2xl shadow-sm border border-neutral-200">
            <h2 className="text-lg font-semibold mb-2">архив недель</h2>
            <ul className="space-y-1">
              {allWeeks.map((w) => (
                <li key={w} className="flex items-center justify-between">
                  <span>{formatWeekLabel(w)}</span>
                  <button onClick={() => { setWeekKey(w); setTab("week"); }} className="text-sm text-blue-700 hover:underline">открыть</button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* ===== Edit entry modal */}
        {editOpen && editDraft && (
          <div className="fixed inset-0 z-50 flex items-center justify-center">
            <div className="absolute inset-0 bg-black/40" onClick={() => { setEditOpen(false); setEditDraft(null); }} />
            <div className="relative bg-white rounded-2xl shadow-xl border border-neutral-200 w-full max-w-xl mx-4 p-4">
              <h3 className="text-lg font-semibold mb-3">редактировать запись</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
                <div>
                  <label className="block text-sm font-medium mb-1">читатель</label>
                  <select value={editDraft.user} onChange={(e) => {
                    const u = e.target.value; const maybeFirstBook = profiles[u]?.books?.[0];
                    setEditDraft((d) => ({ ...(d as any), user: u, bookId: maybeFirstBook?.id || "", bookTitle: maybeFirstBook?.title || (d?.bookTitle || "") }));
                  }} className="w-full border rounded-lg px-3 py-2">
                    {Object.keys(profiles).map((u) => (<option key={u} value={u}>{u}</option>))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">книга</label>
                  <select value={editDraft.bookId} onChange={(e) => {
                    const v = e.target.value; const chosen = profiles[editDraft.user]?.books.find((x) => x.id === v);
                    setEditDraft((d) => ({ ...(d as any), bookId: v, bookTitle: chosen?.title || (d?.bookTitle || "") }));
                  }} className="w-full border rounded-lg px-3 py-2">
                    {(profiles[editDraft.user]?.books || []).map((b) => (<option key={b.id} value={b.id}>{b.title} • {b.status}</option>))}
                    {!editDraft.bookId && editDraft.bookTitle && (<option value="" disabled>(не из списка): {editDraft.bookTitle}</option>)}
                  </select>
                </div>
                <div>
                 <label className="block text-sm font-medium mb-1">страницы</label>
{(() => {
  const a = parseInt(editDraft.pagesStart, 10);
  const b = parseInt(editDraft.pagesEnd, 10);
  const hasValues = editDraft.pagesStart !== "" && editDraft.pagesEnd !== "";
  const error = hasValues && (!Number.isFinite(a) || !Number.isFinite(b) || b < a);
  const baseCls = "w-full border rounded-lg px-3 py-2";
  return (
    <div className="flex items-center gap-2">
      <input
        value={editDraft.pagesStart}
        inputMode="numeric"
        onChange={(e) =>
          setEditDraft((d) => ({ ...(d as any), pagesStart: e.target.value }))
        }
        className={baseCls + " max-w-[120px]" + (error ? " border-red-500" : "")}
        placeholder="250"
      />
      <span>—</span>
      <input
        value={editDraft.pagesEnd}
        inputMode="numeric"
        onChange={(e) =>
          setEditDraft((d) => ({ ...(d as any), pagesEnd: e.target.value }))
        }
        className={baseCls + " max-w-[120px]" + (error ? " border-red-500" : "")}
        placeholder="275"
      />
      {Number.isFinite(a) && Number.isFinite(b) && b >= a && (
  <span className="text-sm text-neutral-600">{b - a + 1} стр.</span>
)}
    </div>
  );
})()}
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">неделя записи</label>
                  <select value={editDraft.weekKey} onChange={(e) => setEditDraft((d) => ({ ...(d as any), weekKey: e.target.value }))} className="w-full border rounded-lg px-3 py-2">
                    {weeksFromCurrent(3, weekKeyOf(new Date())).map((w) => (
  <option key={w} value={w}>{formatWeekLabel(w)}</option>
))}
                  </select>
                </div>
              </div>
              <div className="mb-4">
                <label className="block text-sm font-medium mb-1">пересказ</label>
                <textarea rows={5} value={editDraft.summary} onChange={(e) => setEditDraft((d) => ({ ...(d as any), summary: e.target.value }))} className="w-full border rounded-lg px-3 py-2" />
              </div>
              <div className="flex items-center justify-between gap-2">
                <button className="text-sm text-blue-700 hover:underline" onClick={() => { if (!editDraft.bookId) return; setBookRoute({ user: editDraft.user, bookId: editDraft.bookId }); setTab('book'); }}>расширенная правка книги</button>
                <div className="ml-auto flex items-center gap-2">
                  <button onClick={() => { setEditOpen(false); setEditDraft(null); }} className="px-4 py-2 rounded-xl border">отмена</button>
                  <button onClick={saveEdit} className="px-4 py-2 rounded-xl bg-black text-white">сохранить</button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ===== Add book modal */}
        {addBookOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center">
            <div className="absolute inset-0 bg-black/40" onClick={() => setAddBookOpen(false)} />
            <div className="relative bg-white rounded-2xl shadow-xl border border-neutral-200 w-full max-w-md mx-4 p-4">
              <h3 className="text-lg font-semibold mb-3">добавить книгу</h3>
              <div className="mb-3">
                <label className="block text-sm font-medium mb-1">название</label>
                <input value={newBookTitle} onChange={(e) => setNewBookTitle(e.target.value)} className="w-full border rounded-lg px-3 py-2" placeholder="Лис и пёс" />
              </div>
              <div className="flex items-center justify-end gap-2">
                <button className="px-4 py-2 rounded-xl border" onClick={() => setAddBookOpen(false)}>отмена</button>
                <button
  className="px-4 py-2 rounded-xl bg-black text-white"
  onClick={() => {
    const id = addBookForUser(user);
    setAddBookOpen(false);
    if (id) {
      setBookId(id);            // сразу выбираем новую книгу
      setBookPickerOpen(false); // закрываем выпадашку
    }
  }}
>
  добавить
</button>
              </div>
            </div>
          </div>
        )}

        {/* ===== Book settings modal */}
        {bookSettingsOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center">
            <div className="absolute inset-0 bg-black/40" onClick={() => setBookSettingsOpen(null)} />
            <div className="relative bg-white rounded-2xl shadow-xl border border-neutral-200 w-full max-w-md mx-4 p-4">
              <h3 className="text-lg font-semibold mb-3">настройки книги</h3>
              <div className="mb-3">
                <label className="block text-sm font-medium mb-1">название</label>
                <input value={bookSettingsOpen.title} onChange={(e) => setBookSettingsOpen((b) => (b ? { ...b, title: e.target.value } : b))} className="w-full border rounded-lg px-3 py-2" />
              </div>
              <div className="mb-3">
                <div className="block text-sm font-medium mb-1">статус</div>
                {STATUS_ORDER.map((st) => (
                  <label key={st} className="flex items-center gap-2 py-1">
                    <input type="radio" name="book-status" checked={bookSettingsOpen.status === st} onChange={() => setBookSettingsOpen((b) => (b ? { ...b, status: st } : b))} />
                    <span>{st}</span>
                  </label>
                ))}
              </div>
              <div className="flex items-center justify-between gap-2">
                <button className="text-sm text-blue-700 hover:underline" onClick={() => { setBookRoute({ user: bookSettingsOpen.user, bookId: bookSettingsOpen.id }); setTab('book'); setBookSettingsOpen(null); }}>расширенная правка книги</button>
                <div className="ml-auto flex items-center gap-2">
                  <button className="px-4 py-2 rounded-xl border" onClick={() => setBookSettingsOpen(null)}>отмена</button>
                  <button className="px-4 py-2 rounded-xl bg-black text-white" onClick={() => { updateBook(bookSettingsOpen.user, bookSettingsOpen.id, { title: bookSettingsOpen.title.trim(), status: bookSettingsOpen.status }); setBookSettingsOpen(null); }}>сохранить</button>
                </div>
              </div>
            </div>
          </div>
        )}

        {tab === "library" && (
          <div className="bg-white p-4 rounded-2xl shadow-sm border border-neutral-200">
            <h2 className="text-lg font-semibold mb-2">библиотека</h2>
            {allBooksFlat.length ? (
              <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-3">
                {allBooksFlat.map((b) => (
                  <div key={b.id + ':' + b.user} className="border rounded-xl p-3 flex flex-col gap-2">
                    <div className="text-sm text-neutral-500">{b.user}</div>
                    <div className="font-medium">{b.title}</div>
                    <div className="text-xs text-neutral-500">{b.status}</div>
                    <button className="text-sm text-blue-700 hover:underline mt-auto" onClick={() => { setBookRoute({ user: b.user, bookId: b.id }); setTab('book'); }}>открыть</button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-neutral-600">книг пока нет</p>
            )}
          </div>
        )}

        {tab === "book" && bookRoute && (() => {
          const b = profiles[bookRoute.user]?.books.find((x) => x.id === bookRoute.bookId);
          if (!b) return <div className="bg-white p-4 rounded-2xl border">книга не найдена</div>;
          const bookEntries = entriesForBook(bookRoute.user, b.title);
          return (
            <div className="grid gap-4">
              <div className="flex items-center gap-2">
                <button className="text-sm text-blue-700 hover:underline" onClick={() => setTab('library')}>← к библиотеке</button>
                <div className="text-sm text-neutral-500">читатель: {bookRoute.user}</div>
              </div>
              <div className="bg-white p-4 rounded-2xl shadow-sm border">
                <div className="grid md:grid-cols-2 gap-3">
                  <div>
                    {b.coverDataUrl ? (
                      <img src={b.coverDataUrl} alt="обложка" className="w-full rounded-xl border" />
                    ) : (
                      <div className="aspect-[3/4] w-full rounded-xl border flex items-center justify-center text-neutral-400">обложка</div>
                    )}
                    <div className="mt-2">
                      <label className="block text-sm font-medium mb-1">загрузить обложку</label>
                      <input type="file" accept="image/*" onChange={async (e) => {
                        const f = e.target.files?.[0]; if (!f) return;
                        const reader = new FileReader();
                        reader.onload = () => updateBook(bookRoute.user, b.id, { coverDataUrl: String(reader.result) });
                        reader.readAsDataURL(f);
                      }} />
                    </div>
                  </div>
                  <div className="grid gap-3">
                    <div>
                      <label className="block text-sm font-medium mb-1">название</label>
                      <input value={b.title} onChange={(e) => updateBook(bookRoute.user, b.id, { title: e.target.value })} className="w-full border rounded-lg px-3 py-2" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1">автор</label>
                      <input value={b.author || ''} onChange={(e) => updateBook(bookRoute.user, b.id, { author: e.target.value })} className="w-full border rounded-lg px-3 py-2" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1">заметки / впечатления</label>
                      <textarea rows={4} value={b.notes || ''} onChange={(e) => updateBook(bookRoute.user, b.id, { notes: e.target.value })} className="w-full border rounded-lg px-3 py-2" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1">оценка</label>
                      <div className="flex items-center gap-1">
                        {[1,2,3,4,5].map((n) => (
                          <button key={n} className={classNames("text-2xl", (b.rating || 0) >= n ? "text-yellow-500" : "text-neutral-300 hover:text-neutral-500")} onClick={() => updateBook(bookRoute.user, b.id, { rating: n })}>★</button>
                        ))}
                        {(b.rating || 0) > 0 && (
                          <button className="ml-2 text-sm text-neutral-500 hover:underline" onClick={() => updateBook(bookRoute.user, b.id, { rating: 0 })}>сбросить</button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="bg-white p-4 rounded-2xl shadow-sm border">
                <h3 className="text-lg font-semibold mb-2">все пересказы по книге</h3>
                {bookEntries.length ? (
                  <div className="divide-y">
                    {bookEntries.map((e) => (
                      <div key={e.id} className="py-3">
                        <div className="text-sm text-neutral-600 flex items-center gap-2">
                          <span className="px-2 py-0.5 rounded-full bg-neutral-100 border border-neutral-200">{e.user}</span>
                          <span>•</span>
                          <span>{formatWeekLabel(e.weekKey)}</span>
                          <span className="ml-auto text-neutral-500">{e.createdAt || e.date}</span>
                        </div>
                        <div className="text-sm whitespace-pre-wrap">{e.summary}</div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-neutral-600">записей по этой книге пока нет</p>
                )}
              </div>
            </div>
          );
        })()}
      {praiseOpen && (
  <div className="fixed inset-0 z-50 flex items-center justify-center">
    <div className="absolute inset-0 bg-black/40" />
    <div className="relative bg-white rounded-2xl shadow-xl border w-full max-w-md mx-4 p-6 text-center">
      <div className="text-2xl mb-2">🎉</div>
      <div className="text-lg font-semibold mb-1">Офигенно!</div>
      <div className="text-neutral-700">{praiseText}</div>
    </div>
  </div>
)}
      </div>
    </div>
  );
}
