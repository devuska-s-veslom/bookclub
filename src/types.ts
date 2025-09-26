export type BookStatus = "читаю сейчас" | "на паузе" | "буду читать" | "прочитано";

export type Entry = {
  id: string;
  weekKey: string;
  book: string;
  status: BookStatus;

  // то, что твой UI уже использует:
  user?: string;

  pagesFrom?: number;
  pagesTo?: number;

  // разные варианты страниц, которые встречаются в App.tsx
  pagesStart?: number;
  pagesEnd?: number;
  pagesCount?: number;

  summary?: string;
  liked?: boolean;

  // даты встречаются под разными именами — оставим оба
  createdAt?: string;
  updatedAt?: string;
  date?: string;
};
export type WeeksByKey = Record<string, Entry[]>;

// книга для недельного “бакета”
export type Book = {
  id: string;
  title: string;
  status: BookStatus;
  author?: string;
  coverDataUrl?: string;
  notes?: string;
  rating?: number;
};

// “бакет” за неделю: список книг
export type WeekBucket = { books: Book[] };

// словарь “ключ недели → бакет”
export type WeeksState = Record<string, WeekBucket>;
