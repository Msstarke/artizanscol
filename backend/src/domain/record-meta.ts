export type PersistedRecord = {
  id: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  version: number;
};

export function createRecordMeta(args: {
  id: string;
  createdBy: string;
  now?: string;
}): PersistedRecord {
  const now = args.now || new Date().toISOString();

  return {
    id: args.id,
    createdAt: now,
    updatedAt: now,
    createdBy: args.createdBy,
    version: 1,
  };
}

export function touchRecordMeta<T extends PersistedRecord>(
  record: T,
  _updatedBy: string,
  now?: string,
): T {
  return {
    ...record,
    updatedAt: now || new Date().toISOString(),
    version: Number(record.version || 0) + 1,
  };
}
