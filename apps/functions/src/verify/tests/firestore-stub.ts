/**
 * Tiny in-memory Firestore double for verify tests. Implements only the
 * operations the verify path uses: doc().get(), collection().where(),
 * collectionGroup().where(), orderBy().limit(). Intentionally narrow —
 * not a general-purpose mock.
 */

import type { Firestore } from "firebase-admin/firestore";

export interface PathDoc {
  /** "companies", "users", "users/abc/role_credentials", etc. */
  collectionPath: string;
  id: string;
  data: Record<string, unknown>;
}

export class StubStore {
  private docs: PathDoc[] = [];

  set(collectionPath: string, id: string, data: Record<string, unknown>): this {
    const ix = this.docs.findIndex(
      (d) => d.collectionPath === collectionPath && d.id === id,
    );
    if (ix >= 0) this.docs[ix] = { collectionPath, id, data };
    else this.docs.push({ collectionPath, id, data });
    return this;
  }

  delete(collectionPath: string, id: string): this {
    this.docs = this.docs.filter(
      (d) => !(d.collectionPath === collectionPath && d.id === id),
    );
    return this;
  }

  // Internal: read by exact collectionPath.
  byCollection(collectionPath: string): PathDoc[] {
    return this.docs.filter((d) => d.collectionPath === collectionPath);
  }

  // Internal: collectionGroup queries by leaf segment.
  byLeafCollection(leaf: string): PathDoc[] {
    return this.docs.filter(
      (d) =>
        d.collectionPath === leaf || d.collectionPath.endsWith(`/${leaf}`),
    );
  }
}

interface QuerySnapshotShape {
  empty: boolean;
  docs: { id: string; data: () => Record<string, unknown> }[];
}

interface QueryShape {
  where(field: string, op: "==" | "!=", value: unknown): QueryShape;
  orderBy(field: string, dir?: "asc" | "desc"): QueryShape;
  limit(n: number): QueryShape;
  get(): Promise<QuerySnapshotShape>;
}

function makeQuery(initial: PathDoc[]): QueryShape {
  let docs = [...initial];
  const filters: ((d: PathDoc) => boolean)[] = [];
  let order:
    | { field: string; dir: "asc" | "desc" }
    | null = null;
  let take: number | null = null;

  const exec = (): PathDoc[] => {
    let result = docs.filter((d) => filters.every((f) => f(d)));
    if (order) {
      const { field, dir } = order;
      const sign = dir === "desc" ? -1 : 1;
      result = [...result].sort((a, b) => {
        const av = (a.data as Record<string, unknown>)[field];
        const bv = (b.data as Record<string, unknown>)[field];
        if (typeof av === "number" && typeof bv === "number")
          return (av - bv) * sign;
        return String(av).localeCompare(String(bv)) * sign;
      });
    }
    if (take !== null) result = result.slice(0, take);
    return result;
  };

  const q: QueryShape = {
    where(field, op, value) {
      filters.push((d) => {
        const v = (d.data as Record<string, unknown>)[field];
        if (op === "==") return v === value;
        return v !== value;
      });
      return q;
    },
    orderBy(field, dir = "asc") {
      order = { field, dir };
      return q;
    },
    limit(n) {
      take = n;
      return q;
    },
    async get() {
      const result = exec();
      return {
        empty: result.length === 0,
        docs: result.map((d) => ({ id: d.id, data: () => d.data })),
      };
    },
  };
  return q;
}

export function makeStubFirestore(store: StubStore): Firestore {
  // We only return the surface verify path actually uses — cast at the
  // boundary so the tests don't have to satisfy the full Firestore type.
  return {
    collection(collectionPath: string) {
      return {
        doc(id: string) {
          return {
            async get() {
              const found = store
                .byCollection(collectionPath)
                .find((d) => d.id === id);
              return {
                exists: Boolean(found),
                id,
                data: () => found?.data ?? null,
              };
            },
          };
        },
        where(field: string, op: "==" | "!=", value: unknown) {
          return makeQuery(store.byCollection(collectionPath)).where(
            field,
            op,
            value,
          );
        },
        orderBy(field: string, dir?: "asc" | "desc") {
          return makeQuery(store.byCollection(collectionPath)).orderBy(
            field,
            dir,
          );
        },
      };
    },
    collectionGroup(leaf: string) {
      return {
        where(field: string, op: "==" | "!=", value: unknown) {
          return makeQuery(store.byLeafCollection(leaf)).where(
            field,
            op,
            value,
          );
        },
      };
    },
  } as unknown as Firestore;
}
